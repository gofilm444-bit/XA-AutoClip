import json
import math
import re
import uuid
from pathlib import Path
from typing import Any

import structlog
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    ClipCandidate,
    MediaAsset,
    OriginalityReport,
    Project,
    Render,
    TranscriptSegment,
    TransformationPlan,
)
from app.providers.storage.local import LocalStorageProvider
from app.providers.transcription.factory import get_transcription_provider
from app.services.clipper_style import normalize_clipper_style, normalize_indonesian_text
from app.services.media import extract_audio, probe_media

logger = structlog.get_logger()


def _split_words(text: str) -> list[str]:
    return [w.strip() for w in re.split(r"\s+", text.strip()) if w.strip()]


def partition_balanced_words(items: list[Any], min_words: int = 3, max_words: int = 6) -> list[list[Any]]:
    """Partition a list of items into balanced word chunks between min_words and max_words."""
    n = len(items)
    if n == 0:
        return []
    if n <= max_words:
        return [items]
    c = math.ceil(n / max_words)
    while c > 1 and (n // c) < min_words:
        c -= 1
    b = n // c
    r = n % c
    chunks: list[list[Any]] = []
    offset = 0
    for i in range(c):
        size = b + 1 if i < r else b
        chunks.append(items[offset : offset + size])
        offset += size
    return chunks


def split_transcript_into_caption_cues(
    segments: list[Any],
    max_words_per_cue: int = 6,
    max_chars_per_cue: int = 38,
) -> list[dict[str, Any]]:
    """Convert transcript segments into balanced, 3-6 words per cue caption cues for 9:16 portrait video."""
    cues: list[dict[str, Any]] = []

    for seg in segments:
        if isinstance(seg, dict):
            start = max(0.0, float(seg.get("start") or seg.get("start_seconds") or 0.0))
            end = max(start + 0.1, float(seg.get("end") or seg.get("end_seconds") or start + 0.1))
            text = str(seg.get("text") or "").strip()
            words_data = seg.get("words") or seg.get("words_json") or []
        else:
            start = max(0.0, float(getattr(seg, "start_seconds", getattr(seg, "start", 0.0))))
            end = max(start + 0.1, float(getattr(seg, "end_seconds", getattr(seg, "end", start + 0.1))))
            text = str(getattr(seg, "text", "")).strip()
            words_data = getattr(seg, "words_json", getattr(seg, "words", [])) or []

        clean_text = normalize_indonesian_text(text)
        if not clean_text or end - start <= 0.05:
            continue

        words = _split_words(clean_text)
        if not words:
            continue

        # Case 1: Word-level timestamps available and match words
        if isinstance(words_data, list) and len(words_data) >= len(words) and len(words_data) > 0:
            valid_words = [w for w in words_data if str(w.get("word") or "").strip()]
            if valid_words:
                chunks = partition_balanced_words(valid_words, min_words=3, max_words=max_words_per_cue)
                for chunk in chunks:
                    c_text = " ".join(str(w.get("word") or "").strip() for w in chunk).strip()
                    if c_text:
                        c_start = max(0.0, float(chunk[0].get("start", start)))
                        c_end = max(c_start + 0.15, float(chunk[-1].get("end", end)))
                        cues.append({
                            "id": f"cue-{uuid.uuid4().hex[:8]}",
                            "start": round(c_start, 3),
                            "end": round(c_end, 3),
                            "text": c_text,
                        })

        # Case 2: No word timestamps -> split words into balanced chunks proportionally
        else:
            chunks = partition_balanced_words(words, min_words=3, max_words=max_words_per_cue)
            total_chars = max(1, sum(len(w) for w in words))
            seg_duration = max(0.2, end - start)
            running_chars = 0

            for chunk in chunks:
                chunk_chars = sum(len(w) for w in chunk)
                c_start = start + (running_chars / total_chars) * seg_duration
                c_end = start + ((running_chars + chunk_chars) / total_chars) * seg_duration
                running_chars += chunk_chars

                c_text = " ".join(chunk).strip()
                if c_text:
                    cues.append({
                        "id": f"cue-{uuid.uuid4().hex[:8]}",
                        "start": round(max(0.0, c_start), 3),
                        "end": round(max(c_start + 0.15, c_end), 3),
                        "text": c_text,
                    })

    # Sort and remove overlapping tiny cues
    cues.sort(key=lambda x: x["start"])
    return cues


def project_cues_through_multi_video_sequence(
    asset_transcripts: dict[str, list[dict[str, Any]]],
    video_sequence: list[dict[str, Any]],
    default_asset_id: str = "",
) -> list[dict[str, Any]]:
    """Project asset-specific source cues into timeline-time cues per video segment."""
    projected: list[dict[str, Any]] = []
    output_offset = 0.0

    for seg_idx, segment in enumerate(video_sequence):
        if not isinstance(segment, dict):
            continue
        try:
            source_start = float(segment.get("source_start", 0.0))
            source_end = float(segment.get("source_end", 0.0))
        except (TypeError, ValueError):
            continue

        if source_end <= source_start:
            continue

        speed = max(0.1, float(segment.get("speed") or 1.0))
        seg_start_pos = float(segment.get("start", output_offset))
        seg_id = str(segment.get("id") or f"seg-{seg_idx}")
        asset_id = str(segment.get("asset_id") or default_asset_id or "")

        # Lookup transcript for this specific asset
        raw_segments = asset_transcripts.get(asset_id)
        if not raw_segments and default_asset_id:
            raw_segments = asset_transcripts.get(default_asset_id)
        if not raw_segments and asset_transcripts:
            raw_segments = next(iter(asset_transcripts.values()), [])

        if not raw_segments:
            output_offset = max(output_offset, seg_start_pos + (source_end - source_start) / speed)
            continue

        # Split this asset transcript into local source-time caption cues
        local_cues = split_transcript_into_caption_cues(raw_segments)
        seg_mapped_cues: list[dict[str, Any]] = []

        for cue_idx, cue in enumerate(local_cues):
            c_start = float(cue["start"])
            c_end = float(cue["end"])

            overlap_start = max(source_start, c_start)
            overlap_end = min(source_end, c_end)

            if overlap_end - overlap_start <= 0.01:
                continue

            timeline_start = seg_start_pos + (overlap_start - source_start) / speed
            timeline_end = seg_start_pos + (overlap_end - source_start) / speed

            if timeline_end > timeline_start:
                mapped_cue = {
                    "id": f"cue-auto-{seg_idx}-{cue_idx}-{uuid.uuid4().hex[:6]}",
                    "start": round(timeline_start, 3),
                    "end": round(max(timeline_start + 0.15, timeline_end), 3),
                    "text": cue["text"],
                    "source_asset_id": asset_id,
                    "source_segment_id": seg_id,
                }
                projected.append(mapped_cue)
                seg_mapped_cues.append(mapped_cue)

        logger.info(
            "auto_caption_segment_mapping",
            segment_id=seg_id,
            asset_id=asset_id,
            local_cue_count=len(local_cues),
            timeline_cue_count=len(seg_mapped_cues),
            segment_start=seg_start_pos,
            segment_end=seg_start_pos + (source_end - source_start) / speed,
            source_start=source_start,
            source_end=source_end,
            speed=speed,
        )

        output_offset = max(output_offset, seg_start_pos + (source_end - source_start) / speed)

    return projected


def project_cues_through_sequence(
    cues: list[dict[str, Any]],
    video_sequence: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Legacy helper: project single source-time cues into timeline-time cues based on video segments."""
    projected: list[dict[str, Any]] = []
    output_offset = 0.0

    for seg_idx, segment in enumerate(video_sequence):
        if not isinstance(segment, dict):
            continue
        try:
            source_start = float(segment.get("source_start", 0.0))
            source_end = float(segment.get("source_end", 0.0))
        except (TypeError, ValueError):
            continue

        if source_end <= source_start:
            continue

        speed = max(0.1, float(segment.get("speed") or 1.0))
        seg_start_pos = float(segment.get("start", output_offset))

        for cue_idx, cue in enumerate(cues):
            c_start = cue["start"]
            c_end = cue["end"]

            overlap_start = max(source_start, c_start)
            overlap_end = min(source_end, c_end)

            if overlap_end - overlap_start <= 0.01:
                continue

            timeline_start = round(seg_start_pos + (overlap_start - source_start) / speed, 3)
            timeline_end = round(seg_start_pos + (overlap_end - source_start) / speed, 3)

            if timeline_end > timeline_start:
                projected.append({
                    "id": f"cue-auto-{seg_idx}-{cue_idx}-{uuid.uuid4().hex[:6]}",
                    "start": timeline_start,
                    "end": timeline_end,
                    "text": cue["text"],
                })

        output_offset = max(output_offset, seg_start_pos + (source_end - source_start) / speed)

    return projected


def get_or_transcribe_asset_transcript(
    db: Session,
    project: Project,
    asset_id: str | uuid.UUID | None,
    source_path: str | Path | None = None,
    language: str = "id",
) -> tuple[list[dict[str, Any]], bool]:
    """Retrieve existing transcript segments for a specific asset or transcribe it on-demand."""
    storage = LocalStorageProvider()
    cache_key = str(asset_id) if asset_id else "primary_source"
    cache_path = storage.resolve(f"{project.id}/transcripts/{cache_key}.json")

    # 1. Check disk cache for this asset
    if cache_path.is_file():
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and len(data) > 0:
                logger.info(
                    "auto_caption_asset_transcript",
                    asset_id=str(asset_id),
                    filename=cache_path.name,
                    transcript_reused=True,
                    transcription_requested=False,
                )
                return data, True
        except Exception as err:
            logger.warning("failed_reading_transcript_cache", path=str(cache_path), error=str(err))

    # 2. Check TranscriptSegment DB table if asset_id is None or matches primary source
    if not asset_id:
        existing_db = list(
            db.scalars(
                select(TranscriptSegment)
                .where(TranscriptSegment.project_id == project.id)
                .order_by(TranscriptSegment.start_seconds.asc(), TranscriptSegment.segment_index.asc())
            )
        )
        if existing_db:
            segments_data = [
                {
                    "start": s.start_seconds,
                    "end": s.end_seconds,
                    "text": s.text,
                    "words": s.words_json or [],
                    "confidence": s.confidence or 0.9,
                }
                for s in existing_db
            ]
            logger.info(
                "auto_caption_asset_transcript",
                asset_id=str(asset_id),
                filename="db_transcript_segments",
                transcript_reused=True,
                transcription_requested=False,
            )
            return segments_data, True

    # 3. Resolve media file for asset
    media_file: Path | None = None
    media_duration = 0.0

    if asset_id:
        try:
            asset_uuid = uuid.UUID(str(asset_id))
            db_asset = db.scalar(
                select(MediaAsset).where(
                    MediaAsset.id == asset_uuid,
                    MediaAsset.project_id == project.id,
                )
            )
            if db_asset and db_asset.storage_path and Path(db_asset.storage_path).is_file():
                media_file = Path(db_asset.storage_path)
                media_duration = float(db_asset.duration_seconds or 0.0)
        except (ValueError, TypeError):
            pass

    if not media_file and source_path and Path(source_path).is_file():
        media_file = Path(source_path)

    if not media_file:
        assets = list(db.scalars(select(MediaAsset).where(MediaAsset.project_id == project.id)))
        for a in assets:
            if a.storage_path and Path(a.storage_path).is_file():
                media_file = Path(a.storage_path)
                media_duration = float(a.duration_seconds or 0.0)
                break

    if not media_file or not media_file.is_file():
        logger.warning("auto_caption_media_file_not_found", asset_id=str(asset_id), source_path=str(source_path))
        return [], False

    if media_duration <= 0.0:
        try:
            meta = probe_media(media_file)
            media_duration = float(meta.duration or 0.0)
        except Exception:
            media_duration = 10.0

    # 4. Extract audio & transcribe with provider
    metadata = probe_media(media_file)
    wav_path = storage.resolve(f"{project.id}/audio/{uuid.uuid4()}.wav")
    wav_path.parent.mkdir(parents=True, exist_ok=True)

    logger.info(
        "editor_auto_captions_extracting_audio",
        project_id=str(project.id),
        asset_id=str(asset_id),
        media_path=str(media_file),
        duration=media_duration,
    )
    extract_audio(media_file, wav_path, metadata.has_audio)

    provider = get_transcription_provider()
    logger.info(
        "auto_caption_asset_transcript",
        asset_id=str(asset_id),
        filename=media_file.name,
        transcript_reused=False,
        transcription_requested=True,
    )
    result = provider.transcribe(wav_path, media_duration)

    segments_data = [
        {
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
            "words": seg.words or [],
            "confidence": seg.confidence or 0.9,
        }
        for seg in result.segments
    ]

    # Save to disk cache
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(segments_data, f, ensure_ascii=False, indent=2)
    except Exception as save_err:
        logger.warning("failed_saving_transcript_cache", path=str(cache_path), error=str(save_err))

    return segments_data, False


def resolve_editor_source_media(
    candidate: ClipCandidate,
    plan: TransformationPlan,
    db: Session,
) -> tuple[Path, float]:
    """Find valid source audio/video file for transcription."""
    # 1. Candidate short_source_clip_path
    if candidate.short_source_clip_path:
        p = Path(candidate.short_source_clip_path)
        if p.is_file():
            try:
                metadata = probe_media(p)
                duration = float(metadata.duration or candidate.duration_seconds or 0.0)
                if duration > 0:
                    return p, duration
            except Exception as probe_err:
                logger.warning(
                    "candidate_source_probe_failed",
                    candidate_id=str(candidate.id),
                    path=str(p),
                    error=str(probe_err),
                )

    # 2. Project MediaAssets
    assets = list(
        db.scalars(
            select(MediaAsset).where(
                MediaAsset.project_id == plan.project_id
            )
        )
    )

    for kind in ("source_video", "extracted_audio", "editor_video", "editor_audio"):
        for asset in assets:
            if asset.asset_type == kind:
                p = Path(asset.storage_path)
                if p.is_file():
                    try:
                        metadata = probe_media(p)
                        duration = float(metadata.duration or asset.duration_seconds or 0.0)
                        if duration > 0:
                            return p, duration
                    except Exception:
                        pass

    for asset in assets:
        p = Path(asset.storage_path)
        if p.is_file():
            try:
                metadata = probe_media(p)
                duration = float(metadata.duration or asset.duration_seconds or 0.0)
                if duration > 0:
                    return p, duration
            except Exception:
                pass

    raise HTTPException(
        status_code=404,
        detail="File sumber tidak ditemukan. Silakan impor ulang video.",
    )


def generate_editor_auto_captions(
    db: Session,
    transformation_id: uuid.UUID,
    language: str = "id",
    delete_current_captions: bool = True,
    identify_filler_words: bool = False,
    bilingual: str = "none",
) -> dict[str, Any]:
    """Run transcription if needed and produce structured caption cues for the manual editor."""
    plan = db.scalar(
        select(TransformationPlan).where(TransformationPlan.id == transformation_id)
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Transformation tidak ditemukan.")

    candidate = db.scalar(
        select(ClipCandidate).where(ClipCandidate.id == plan.candidate_id)
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate tidak ditemukan.")

    project = db.scalar(
        select(Project).where(Project.id == plan.project_id)
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project tidak ditemukan.")

    current_style = dict(plan.clipper_style_config or {})
    video_sequence = (
        current_style.get("video_sequence")
        or current_style.get("media_sequence")
        or []
    )

    reused_transcript = True

    if video_sequence and isinstance(video_sequence, list) and len(video_sequence) > 0:
        unique_asset_ids = list(dict.fromkeys(
            str(seg.get("asset_id")) for seg in video_sequence if seg.get("asset_id")
        ))
        logger.info(
            "auto_caption_sequence_start",
            total_segments=len(video_sequence),
            unique_assets=unique_asset_ids,
        )

        asset_transcripts: dict[str, list[dict[str, Any]]] = {}
        for asset_id in unique_asset_ids:
            matching_seg = next((s for s in video_sequence if str(s.get("asset_id")) == asset_id), {})
            source_path = matching_seg.get("source_path")

            logger.info(
                "auto_caption_source_audit",
                asset_id=asset_id,
                source_path=source_path,
                segment_id=matching_seg.get("id"),
                source_start=matching_seg.get("source_start"),
                source_end=matching_seg.get("source_end"),
                speed=matching_seg.get("speed"),
            )

            raw_segs, reused = get_or_transcribe_asset_transcript(
                db=db,
                project=project,
                asset_id=asset_id,
                source_path=source_path,
                language=language,
            )
            if not reused:
                reused_transcript = False
            asset_transcripts[asset_id] = raw_segs

        if not asset_transcripts:
            # Fallback if no asset_ids on segments
            media_path, _ = resolve_editor_source_media(candidate, plan, db)
            raw_segs, reused = get_or_transcribe_asset_transcript(
                db=db,
                project=project,
                asset_id=None,
                source_path=media_path,
                language=language,
            )
            reused_transcript = reused
            asset_transcripts["default"] = raw_segs

        projected_cues = project_cues_through_multi_video_sequence(
            asset_transcripts=asset_transcripts,
            video_sequence=video_sequence,
            default_asset_id=unique_asset_ids[0] if unique_asset_ids else "default",
        )
    else:
        # Legacy single candidate mode
        existing_segments = list(
            db.scalars(
                select(TranscriptSegment)
                .where(TranscriptSegment.project_id == project.id)
                .order_by(TranscriptSegment.start_seconds.asc(), TranscriptSegment.segment_index.asc())
            )
        )

        if existing_segments and len(existing_segments) > 0:
            reused_transcript = True
            segments_for_cues = existing_segments
        else:
            media_path, duration = resolve_editor_source_media(candidate, plan, db)
            raw_segs, reused = get_or_transcribe_asset_transcript(
                db=db,
                project=project,
                asset_id=None,
                source_path=media_path,
                language=language,
            )
            reused_transcript = reused
            segments_for_cues = raw_segs

        raw_cues = split_transcript_into_caption_cues(segments_for_cues)
        start_bound = float(candidate.start_seconds or 0.0)
        end_bound = float(candidate.end_seconds or candidate.duration_seconds or 999999.0)
        projected_cues = []
        for c in raw_cues:
            if c["end"] <= start_bound or c["start"] >= end_bound:
                continue
            cs = max(0.0, c["start"] - start_bound)
            ce = max(cs + 0.15, min(float(candidate.duration_seconds or 999999.0), c["end"] - start_bound))
            projected_cues.append({
                "id": c["id"],
                "start": round(cs, 3),
                "end": round(ce, 3),
                "text": c["text"],
            })

    # Sort projected cues
    projected_cues.sort(key=lambda x: float(x.get("start", 0.0)))

    logger.info(
        "auto_caption_final_cues",
        total_cues=len(projected_cues),
        asset_ids=list({c.get("source_asset_id") for c in projected_cues if c.get("source_asset_id")}),
        first_cue=projected_cues[0] if projected_cues else None,
        last_cue=projected_cues[-1] if projected_cues else None,
    )

    # Apply Delete Current Captions logic
    if delete_current_captions:
        final_cues = projected_cues
    else:
        existing_cues = current_style.get("caption_timeline") or []
        final_cues = sorted(
            [c for c in existing_cues if isinstance(c, dict)] + projected_cues,
            key=lambda x: float(x.get("start", 0.0)),
        )

    # Save to clipper_style_config without mutating video_sequence
    current_style["caption_timeline"] = final_cues
    current_style["caption_timeline_initialized"] = True
    current_style["editor_state_version"] = int(current_style.get("editor_state_version", 0)) + 1
    plan.clipper_style_config = normalize_clipper_style(current_style, plan.original_hook)

    # Invalidate rendered preview / renders
    db.execute(
        delete(OriginalityReport).where(
            OriginalityReport.transformation_plan_id == transformation_id
        )
    )
    db.execute(
        Render.__table__.update()
        .where(
            Render.transformation_plan_id == transformation_id,
            Render.status.in_(["queued", "running", "completed"]),
        )
        .values(status="superseded")
    )
    db.commit()

    message = f"Berhasil membuat {len(final_cues)} cue caption otomatis."
    if bilingual != "none":
        message += " (Catatan: Bilingual captions akan tersedia pada update berikutnya)."
    if identify_filler_words:
        message += " (Catatan: Deteksi filler words akan dikembangkan pada tahap berikutnya)."

    return {
        "success": True,
        "message": message,
        "language": project.transcript_language or language,
        "cues_count": len(final_cues),
        "cues": final_cues,
        "reused_transcript": reused_transcript,
    }
