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


def split_transcript_into_caption_cues(
    segments: list[Any],
    max_words_per_cue: int = 7,
    max_chars_per_cue: int = 38,
) -> list[dict[str, Any]]:
    """Convert transcript segments into compact, vertical-video-optimized caption cues."""
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
            current_chunk: list[dict[str, Any]] = []
            current_len = 0

            for word_item in words_data:
                w_text = str(word_item.get("word") or "").strip()
                if not w_text:
                    continue
                w_start = float(word_item.get("start", start))
                w_end = float(word_item.get("end", end))

                if (
                    len(current_chunk) >= max_words_per_cue
                    or (current_len + len(w_text) + 1 > max_chars_per_cue and len(current_chunk) >= 3)
                ):
                    c_text = " ".join(str(w.get("word") or "").strip() for w in current_chunk).strip()
                    if c_text:
                        c_start = max(0.0, float(current_chunk[0].get("start", start)))
                        c_end = max(c_start + 0.15, float(current_chunk[-1].get("end", c_start + 0.4)))
                        cues.append({
                            "id": f"cue-{uuid.uuid4().hex[:8]}",
                            "start": round(c_start, 3),
                            "end": round(c_end, 3),
                            "text": c_text,
                        })
                    current_chunk = []
                    current_len = 0

                current_chunk.append({"word": w_text, "start": w_start, "end": w_end})
                current_len += len(w_text) + 1

            if current_chunk:
                c_text = " ".join(str(w.get("word") or "").strip() for w in current_chunk).strip()
                if c_text:
                    c_start = max(0.0, float(current_chunk[0].get("start", start)))
                    c_end = max(c_start + 0.15, float(current_chunk[-1].get("end", end)))
                    cues.append({
                        "id": f"cue-{uuid.uuid4().hex[:8]}",
                        "start": round(c_start, 3),
                        "end": round(c_end, 3),
                        "text": c_text,
                    })

        # Case 2: No word timestamps -> split proportionally
        else:
            chunks: list[list[str]] = []
            curr: list[str] = []
            curr_chars = 0

            for word in words:
                if len(curr) >= max_words_per_cue or (curr_chars + len(word) + 1 > max_chars_per_cue and len(curr) >= 3):
                    chunks.append(curr)
                    curr = []
                    curr_chars = 0
                curr.append(word)
                curr_chars += len(word) + 1
            if curr:
                chunks.append(curr)

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


def project_cues_through_sequence(
    cues: list[dict[str, Any]],
    video_sequence: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Project source-time cues into timeline-time cues based on video segments."""
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

        for cue_idx, cue in enumerate(cues):
            c_start = cue["start"]
            c_end = cue["end"]

            overlap_start = max(source_start, c_start)
            overlap_end = min(source_end, c_end)

            if overlap_end - overlap_start <= 0.01:
                continue

            timeline_start = round(output_offset + (overlap_start - source_start), 3)
            timeline_end = round(output_offset + (overlap_end - source_start), 3)

            if timeline_end > timeline_start:
                projected.append({
                    "id": f"cue-auto-{seg_idx}-{cue_idx}-{uuid.uuid4().hex[:6]}",
                    "start": timeline_start,
                    "end": timeline_end,
                    "text": cue["text"],
                })

        output_offset += (source_end - source_start)

    return projected


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

    # Check existing transcript segments
    existing_segments = list(
        db.scalars(
            select(TranscriptSegment)
            .where(TranscriptSegment.project_id == project.id)
            .order_by(TranscriptSegment.start_seconds.asc(), TranscriptSegment.segment_index.asc())
        )
    )

    reused_transcript = False
    if existing_segments and len(existing_segments) > 0:
        # Existing transcript available -> reuse it to save cost and time!
        reused_transcript = True
        logger.info(
            "editor_auto_captions_reused_transcript",
            transformation_id=str(transformation_id),
            project_id=str(project.id),
            segments_count=len(existing_segments),
        )
        segments_for_cues = existing_segments
    else:
        # Transcribe source media
        media_path, duration = resolve_editor_source_media(candidate, plan, db)
        metadata = probe_media(media_path)

        storage = LocalStorageProvider()
        wav_path = storage.resolve(f"{project.id}/audio/{uuid.uuid4()}.wav")

        logger.info(
            "editor_auto_captions_extracting_audio",
            transformation_id=str(transformation_id),
            media_path=str(media_path),
            duration=duration,
        )
        extract_audio(media_path, wav_path, metadata.has_audio)

        provider = get_transcription_provider()
        provider_name = getattr(provider, "provider_name", "groq")
        model = getattr(provider, "model", None)

        logger.info(
            "editor_auto_captions_transcribing",
            transformation_id=str(transformation_id),
            provider=provider_name,
            model=model,
            duration=duration,
            language=language,
        )
        result = provider.transcribe(wav_path, duration)

        # Clear old segments if any and persist new
        db.execute(delete(TranscriptSegment).where(TranscriptSegment.project_id == project.id))
        new_segments: list[TranscriptSegment] = []
        for index, seg in enumerate(result.segments):
            ts = TranscriptSegment(
                project_id=project.id,
                segment_index=index,
                start_seconds=seg.start,
                end_seconds=seg.end,
                text=seg.text,
                confidence=seg.confidence,
                words_json=seg.words,
            )
            db.add(ts)
            new_segments.append(ts)

        project.transcript_language = result.detected_language or language
        project.transcript_provider = result.provider_name
        db.flush()
        segments_for_cues = new_segments

    # Convert transcript segments to caption cues
    raw_cues = split_transcript_into_caption_cues(segments_for_cues)

    # Project cues through active video sequence or candidate bounds
    current_style = dict(plan.clipper_style_config or {})
    video_sequence = (
        current_style.get("video_sequence")
        or current_style.get("media_sequence")
        or []
    )

    if video_sequence and isinstance(video_sequence, list) and len(video_sequence) > 0:
        projected_cues = project_cues_through_sequence(raw_cues, video_sequence)
    else:
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

    # Apply Delete Current Captions logic
    if delete_current_captions:
        final_cues = projected_cues
    else:
        existing_cues = current_style.get("caption_timeline") or []
        final_cues = sorted(
            [c for c in existing_cues if isinstance(c, dict)] + projected_cues,
            key=lambda x: float(x.get("start", 0.0)),
        )

    # Save to clipper_style_config
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

