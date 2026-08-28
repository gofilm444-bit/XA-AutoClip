import hashlib
import traceback
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter

import structlog
from sqlalchemy import delete, func, select

from app.celery_app import celery_app
from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.core.state import ProjectStatus, validate_transition
from app.db.session import SessionLocal
from app.models import (
    ClipCandidate,
    MediaAsset,
    ProcessingJob,
    Project,
    Render,
    TranscriptSegment,
    TransformationPlan,
)
from app.providers.storage.local import LocalStorageProvider
from app.providers.transcription.factory import get_transcription_provider
from app.services.candidates import (
    audit_candidate_duplicates,
    generate_candidates,
    normalize_to_one_minute_candidates,
    weighted_score,
)
from app.services.clipper_style import (
    build_effect_timeline,
    extract_keywords,
    validate_effect_timeline,
)
from app.services.media import (
    AudioMixSource,
    assemble_media_sequence,
    extract_audio,
    extract_clip,
    extract_thumbnail,
    layout_mode,
    probe_audio_duration,
    probe_media,
    render_clean_vertical,
    render_vertical,
    validate_render_output,
)
from app.services.render_cache import render_fingerprint, write_render_cache_metadata
from app.services.render_plan import build_editor_render_plan, resolve_caption_render_cues
from app.services.render_result import verify_render_file_binding
from app.services.sports import (
    analyze_sports_video,
    generate_sports_candidates,
    sports_transcript,
)
from app.services.subtitles import transcript_cues, write_ass_cues
from app.services.titles import generate_candidate_copy
from app.services.translation import normalize_language, translate_texts
from app.services.usage_audit import candidate_quality_audit, estimate_ai_usage

logger = structlog.get_logger()

MISSING_SOURCE_RECOVERY_MESSAGE = (
    "File video sumber tidak ditemukan. Upload/link ulang sumber video untuk "
    "melanjutkan tanpa transkripsi ulang jika transcript sudah tersedia."
)


def _transition(project: Project, target: ProjectStatus) -> None:
    validate_transition(project.status, target)
    project.status = target


def _job_progress(job: ProcessingJob, progress: int, step: str) -> None:
    job.progress = progress
    job.current_step = step


def should_reuse_transcript(existing_segment_count: int, force_reprocess: bool) -> bool:
    return existing_segment_count > 0 and not force_reprocess


def ensure_source_file_available(
    project: Project,
    source_path: Path,
    *,
    transcript_segment_count: int,
    candidate_count: int,
    force_reprocess: bool,
) -> None:
    if source_path.is_file():
        return
    can_reuse_transcript = should_reuse_transcript(
        transcript_segment_count,
        force_reprocess,
    )
    logger.warning(
        "process_project_source_missing",
        project_id=str(project.id),
        source_path=str(source_path),
        transcript_segment_count=transcript_segment_count,
        candidate_count=candidate_count,
        can_reuse_transcript=can_reuse_transcript,
    )
    raise AppError(
        ErrorCode.INVALID_VIDEO,
        MISSING_SOURCE_RECOVERY_MESSAGE,
        409,
    )


def transition_to_segmenting(project: Project, *, reuse_transcript: bool) -> None:
    if reuse_transcript:
        from_status = project.status
        _transition(project, ProjectStatus.TRANSCRIBING)
        logger.info(
            "transcription_reuse_status_bridge",
            project_id=str(project.id),
            from_status=str(from_status),
            bridge_status=str(ProjectStatus.TRANSCRIBING),
            next_status=str(ProjectStatus.SEGMENTING),
        )
    _transition(project, ProjectStatus.SEGMENTING)


def build_process_project_timing_payload(
    project_id: str,
    timing: dict[str, float],
    *,
    title_hook_generation_call_count: int,
    total_process_project_duration_ms: float,
) -> dict[str, float | int | str]:
    payload: dict[str, float | int | str] = {
        "project_id": project_id,
        **{key: round(value, 2) for key, value in timing.items()},
    }
    payload["title_hook_generation_total_duration_ms"] = round(
        timing.get("title_hook_generation_total_duration_ms", 0.0),
        2,
    )
    payload["title_hook_generation_call_count"] = title_hook_generation_call_count
    payload["total_process_project_duration_ms"] = round(
        total_process_project_duration_ms,
        2,
    )
    return payload


def log_process_project_timing_completed(
    payload: dict[str, float | int | str],
) -> None:
    try:
        logger.info("process_project_timing_completed", **payload)
    except Exception as exc:
        with suppress(Exception):
            logger.warning(
                "process_project_timing_logging_failed",
                project_id=payload.get("project_id"),
                error=str(exc),
            )


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _audio_library_path(project_id: uuid.UUID, asset_id: str) -> Path | None:
    folder = LocalStorageProvider().resolve(f"{project_id}/audio-library")
    matches = [path for path in folder.glob(f"{asset_id}.*") if path.suffix.lower() in {".mp3", ".wav", ".m4a"}]
    return matches[0] if matches else None


@celery_app.task(name="process_project")
def process_project(project_id: str, job_id: str, force_reprocess: bool = False) -> None:
    process_started = perf_counter()
    timing: dict[str, float] = {}
    title_hook_call_count = 0
    logger.info("process_project_timing_started", project_id=project_id)
    db = SessionLocal()
    project = db.get(Project, uuid.UUID(project_id))
    job = db.get(ProcessingJob, uuid.UUID(job_id))
    try:
        if not project or not job:
            return
        job.status = "running"
        job.started_at = datetime.now(UTC)
        source = db.scalar(
            select(MediaAsset).where(
                MediaAsset.project_id == project.id,
                MediaAsset.asset_type == "source_video",
            )
        )
        if not source:
            raise AppError(ErrorCode.INVALID_VIDEO, "Video sumber belum tersedia.")
        source_path = Path(source.storage_path)

        existing_transcript_count = db.scalar(
            select(func.count(TranscriptSegment.id)).where(
                TranscriptSegment.project_id == project.id
            )
        ) or 0
        existing_candidate_count = db.scalar(
            select(func.count(ClipCandidate.id)).where(
                ClipCandidate.project_id == project.id
            )
        ) or 0
        ensure_source_file_available(
            project,
            source_path,
            transcript_segment_count=int(existing_transcript_count),
            candidate_count=int(existing_candidate_count),
            force_reprocess=force_reprocess,
        )

        _transition(project, ProjectStatus.EXTRACTING_METADATA)
        _job_progress(job, 10, "Memvalidasi dan membaca metadata video")
        db.commit()
        stage_started = perf_counter()
        metadata = probe_media(source_path)
        timing["video_probe_duration_ms"] = (perf_counter() - stage_started) * 1000
        source.duration_seconds = metadata.duration
        source.width = metadata.width
        source.height = metadata.height
        source.frame_rate = metadata.frame_rate
        source.audio_sample_rate = metadata.audio_sample_rate

        reuse_transcript = should_reuse_transcript(
            int(existing_transcript_count), force_reprocess
        )
        if reuse_transcript:
            logger.info(
                "transcription_reuse_guard_hit",
                project_id=str(project.id),
                transcription_segments_reused=existing_transcript_count,
                force_reprocess=False,
            )
        else:
            logger.info(
                "transcription_reuse_guard_miss",
                project_id=str(project.id),
                existing_transcript_segments=existing_transcript_count,
                force_reprocess=force_reprocess,
            )
            if force_reprocess:
                logger.info("transcription_reprocess_forced", project_id=str(project.id))

        _transition(project, ProjectStatus.EXTRACTING_AUDIO)
        _job_progress(job, 25, "Mengekstrak audio")
        db.commit()
        storage = LocalStorageProvider()
        audio_path = storage.resolve(f"{project.id}/audio/{uuid.uuid4()}.wav")
        stage_started = perf_counter()
        extract_audio(source_path, audio_path, metadata.has_audio)
        timing["audio_extract_duration_ms"] = (perf_counter() - stage_started) * 1000
        db.add(
            MediaAsset(
                project_id=project.id,
                asset_type="extracted_audio",
                original_filename="audio.wav",
                stored_filename=audio_path.name,
                storage_path=str(audio_path),
                mime_type="audio/wav",
                size_bytes=audio_path.stat().st_size,
                duration_seconds=metadata.duration,
                width=None,
                height=None,
                frame_rate=None,
                audio_sample_rate=16000,
                checksum=_checksum(audio_path),
            )
        )

        if reuse_transcript:
            logger.info(
                "transcription_segments_reused",
                project_id=str(project.id),
                transcription_segments_reused=existing_transcript_count,
            )
        else:
            db.execute(delete(TranscriptSegment).where(TranscriptSegment.project_id == project.id))
            _transition(project, ProjectStatus.TRANSCRIBING)
            _job_progress(
                job,
                45,
                "Membaca komentar pertandingan" if project.content_type == "sports" else "Membuat transkrip",
            )
            db.commit()
            transcription_started = perf_counter()
            provider = get_transcription_provider()
            provider_name = getattr(
                provider,
                "provider_name",
                get_settings().transcription_provider,
            )
            model = getattr(provider, "model", None) or get_settings().transcription_model
            logger.info(
                "ai_call_started",
                ai_call_type="transcription",
                provider=provider_name,
                model=model,
                project_id=str(project.id),
                audio_duration_seconds=metadata.duration,
                retry_count=0,
            )
            try:
                result = provider.transcribe(audio_path, metadata.duration)
                project.transcript_language = normalize_language(result.detected_language)
                project.transcript_provider = result.provider_name
                for index, segment in enumerate(result.segments):
                    db.add(
                        TranscriptSegment(
                            project_id=project.id,
                            segment_index=index,
                            start_seconds=segment.start,
                            end_seconds=segment.end,
                            text=segment.text,
                            confidence=segment.confidence,
                            words_json=segment.words,
                        )
                    )
                logger.info(
                    "ai_call_completed",
                    ai_call_type="transcription",
                    provider=result.provider_name,
                    model=result.model_name,
                    project_id=str(project.id),
                    audio_duration_seconds=metadata.duration,
                    request_duration_ms=round((perf_counter() - transcription_started) * 1000),
                    cache_hit=False,
                    **estimate_ai_usage(
                        "transcription", result.provider_name, result.model_name,
                        audio_duration_seconds=metadata.duration,
                    ),
                )
            except Exception as exc:
                logger.warning(
                    "ai_call_failed",
                    ai_call_type="transcription",
                    provider=provider_name,
                    model=model,
                    project_id=str(project.id),
                    error=str(exc),
                    request_duration_ms=round((perf_counter() - transcription_started) * 1000),
                    **estimate_ai_usage(
                        "transcription", provider_name, model,
                        audio_duration_seconds=metadata.duration,
                    ),
                )
                if project.content_type != "sports":
                    raise
                project.transcript_provider = "unavailable"
                project.transcript_language = None

        transition_to_segmenting(project, reuse_transcript=reuse_transcript)
        _job_progress(
            job,
            65,
            (
                "Menganalisis sorakan, intensitas audio, dan perubahan adegan"
                if project.content_type == "sports"
                else "Menyegmentasi transkrip"
            ),
        )
        db.commit()
        segments = list(
            db.scalars(
                select(TranscriptSegment)
                .where(TranscriptSegment.project_id == project.id)
                .order_by(TranscriptSegment.segment_index)
            )
        )
        _transition(project, ProjectStatus.GENERATING_CANDIDATES)
        _job_progress(job, 80, "Memberi skor kandidat")
        db.commit()
        settings = get_settings()
        max_top_clips = max(1, settings.max_saved_top_clips)
        candidate_started = perf_counter()
        if project.content_type == "sports":
            sports_signals = analyze_sports_video(source_path, metadata.has_audio)
            drafts = generate_sports_candidates(
                sports_signals,
                metadata.duration,
                limit=max_top_clips,
            )
        else:
            drafts = generate_candidates(segments, limit=max(30, max_top_clips))
        timing["candidate_generation_duration_ms"] = (perf_counter() - candidate_started) * 1000
        duplicate_pairs = audit_candidate_duplicates(drafts)
        for left_index, right_index, reason in duplicate_pairs:
            logger.info(
                "candidate_duplicate_detected",
                project_id=str(project.id),
                left_candidate_index=left_index,
                right_candidate_index=right_index,
                reason=reason,
            )
        logger.info(
            "candidate_selection_summary",
            project_id=str(project.id),
            raw_candidate_count=len(drafts),
            final_candidate_count=min(len(drafts), max_top_clips),
            duplicate_count=len(duplicate_pairs),
            average_score=round(
                sum(weighted_score(draft.scores) for draft in drafts) / len(drafts), 2
            ) if drafts else 0.0,
            top_score=weighted_score(drafts[0].scores) if drafts else None,
            lowest_selected_score=weighted_score(drafts[min(len(drafts), max_top_clips) - 1].scores)
            if drafts else None,
        )
        if not drafts:
            raise AppError(
                ErrorCode.INVALID_TIMESTAMPS,
                (
                    "Tidak ditemukan lonjakan audio atau perubahan adegan yang cukup kuat."
                    if project.content_type == "sports"
                    else "Tidak ditemukan kandidat berdurasi 20-60 detik. "
                    "Pastikan video berdurasi minimal 20 detik."
                ),
            )
        final_drafts = (
            drafts
            if project.content_type == "sports"
            else normalize_to_one_minute_candidates(drafts, metadata.duration, limit=max_top_clips)
        )
        final_drafts = final_drafts[:max_top_clips]
        title_hook_started = perf_counter()
        existing_candidates = list(
            db.scalars(
                select(ClipCandidate)
                .where(ClipCandidate.project_id == project.id)
                .order_by(ClipCandidate.rank)
            )
        )
        if existing_candidates:
            logger.info(
                "process_project_retry_existing_candidates_detected",
                project_id=str(project.id),
                existing_candidate_count=len(existing_candidates),
                update_strategy="reuse_by_rank_delete_stale_overwrite_clip_files",
            )
        for rank, draft in enumerate(final_drafts, 1):
            logger.info(
                "candidate_quality_audit",
                project_id=str(project.id),
                candidate_rank=rank,
                **candidate_quality_audit(draft, rank=rank),
            )
            candidate = (
                existing_candidates[rank - 1]
                if rank <= len(existing_candidates)
                else ClipCandidate(project_id=project.id)
            )
            candidate.start_seconds = draft.start
            candidate.end_seconds = draft.end
            candidate.duration_seconds = round(draft.end - draft.start, 3)
            if project.content_type == "sports":
                candidate.transcript_text = (
                    sports_transcript(segments, draft.start, draft.end)
                    if project.transcript_provider not in {"mock", "unavailable"}
                    else ""
                )
                candidate_copy = generate_candidate_copy(
                    project.content_type,
                    candidate.transcript_text,
                    rank,
                    project.title,
                )
                title_hook_call_count += int(
                    bool(
                        settings.title_hook_ai_enabled
                        and settings.openai_api_key
                        and candidate.transcript_text.strip()
                    )
                )
                candidate.suggested_title = candidate_copy["title"]
                candidate.suggested_hook = candidate_copy["hook"]
                candidate.summary = (
                    "Kandidat dipilih dari kombinasi lonjakan sorakan atau suara komentator "
                    "dan aktivitas visual, termasuk build-up serta reaksi setelah kejadian."
                )
                candidate.category = "sports_highlight"
            else:
                candidate.transcript_text = draft.text
                candidate_copy = generate_candidate_copy(
                    project.content_type,
                    candidate.transcript_text,
                    rank,
                    project.title,
                )
                title_hook_call_count += int(
                    bool(
                        settings.title_hook_ai_enabled
                        and settings.openai_api_key
                        and candidate.transcript_text.strip()
                    )
                )
                candidate.suggested_title = candidate_copy["title"]
                candidate.suggested_hook = candidate_copy["hook"]
                candidate.summary = candidate_copy["description"]
                candidate.category = "podcast"
            candidate.hook_score = draft.scores["hook"]
            candidate.context_score = draft.scores["context"]
            candidate.information_score = draft.scores["information"]
            candidate.emotion_score = draft.scores["emotion"]
            candidate.fluency_score = draft.scores["fluency"]
            candidate.duration_score = draft.scores["duration"]
            candidate.discussion_score = draft.scores["discussion"]
            candidate.viral_potential_score = weighted_score(draft.scores)
            candidate.reasons_json = (
                [
                    "Lonjakan intensitas audio",
                    "Aktivitas atau perubahan adegan tinggi",
                    "Menyertakan build-up dan reaksi",
                ]
                if project.content_type == "sports"
                else ["Gagasan relatif lengkap", "Memiliki potensi diskusi"]
            )
            candidate.risks_json = [
                "Tetap memerlukan pemeriksaan konteks dan hak penggunaan"
            ]
            candidate.rank = rank
            candidate.selected = False
            db.add(candidate)
        for stale in existing_candidates[len(final_drafts) :]:
            db.delete(stale)
        db.flush()

        saved_candidates = list(
            db.scalars(
                select(ClipCandidate)
                .where(ClipCandidate.project_id == project.id)
                .order_by(ClipCandidate.rank)
            )
        )
        for candidate in saved_candidates[:max_top_clips]:
            clip_path = storage.resolve(f"{project.id}/clips/{candidate.id}.mp4")
            thumb_path = storage.resolve(f"{project.id}/thumbnails/{candidate.id}.jpg")
            extract_clip(
                source_path,
                clip_path,
                candidate.start_seconds,
                candidate.duration_seconds,
            )
            extract_thumbnail(clip_path, thumb_path, min(1.0, candidate.duration_seconds / 2))
            candidate.short_source_clip_path = str(clip_path)
            candidate.clip_thumbnail_path = str(thumb_path)
            candidate.file_missing = False
        _transition(project, ProjectStatus.CANDIDATES_READY)
        _job_progress(job, 100, f"{len(final_drafts)} kandidat siap")
        job.status = "completed"
        job.completed_at = datetime.now(UTC)
        db.commit()
        timing["title_hook_generation_total_duration_ms"] = (
            perf_counter() - title_hook_started
        ) * 1000
        timing_log_payload = build_process_project_timing_payload(
            str(project.id),
            timing,
            title_hook_generation_call_count=title_hook_call_count,
            total_process_project_duration_ms=(
                perf_counter() - process_started
            )
            * 1000,
        )
        log_process_project_timing_completed(timing_log_payload)
        logger.info(
            "ai_usage_summary",
            project_id=str(project.id),
            transcription_calls_count=0 if reuse_transcript else 1,
            title_hook_calls_count=title_hook_call_count,
            translation_calls_count=0,
            approximate_audio_duration_processed=0.0 if reuse_transcript else round(metadata.duration / 60, 3),
        )
    except Exception as exc:
        db.rollback()
        if project and job:
            project.status = ProjectStatus.FAILED
            job.status = "failed"
            job.error_code = exc.code if isinstance(exc, AppError) else "PROCESSING_FAILED"
            job.error_message = str(exc)[:1000]
            job.completed_at = datetime.now(UTC)
            db.commit()
        raise
    finally:
        db.close()


@celery_app.task(name="render_video")
def render_video(render_id: str, preview: bool) -> dict | None:
    render_started_at = perf_counter()
    db = SessionLocal()
    render = db.get(Render, uuid.UUID(render_id))
    destination: Path | None = None
    sequence_source_path: Path | None = None
    audio_sequence_source_path: Path | None = None
    width = 0
    height = 0
    style_config = None
    audit_fingerprint: str | None = None
    source_check_duration = 0.0
    prepare_plan_duration = 0.0
    sequence_build_duration = 0.0
    layout_render_duration = 0.0
    output_validation_duration = 0.0
    metadata_write_duration = 0.0
    try:
        if not render:
            return
        if render.status == "superseded":
            logger.info("render_video_skipped_superseded", render_id=render_id)
            return {"status": "superseded", "render_id": render_id}
        source_check_started_at = perf_counter()
        project = db.get(Project, render.project_id)
        plan = db.get(TransformationPlan, render.transformation_plan_id)
        candidate = db.get(ClipCandidate, plan.candidate_id) if plan else None
        source = db.scalar(
            select(MediaAsset).where(
                MediaAsset.project_id == render.project_id,
                MediaAsset.asset_type == "source_video",
            )
        )
        if not all((project, plan, candidate)):
            raise AppError(ErrorCode.RENDER_FAILED, "Data render tidak lengkap.")
        source_candidates = [
            Path(candidate.short_source_clip_path)
            if candidate.short_source_clip_path
            else None,
            Path(source.storage_path) if source else None,
        ]
        source_path = None
        source_validation_errors: list[str] = []
        for possible_source in source_candidates:
            if not possible_source:
                continue
            if not possible_source.is_file() or possible_source.stat().st_size <= 0:
                source_validation_errors.append(f"{possible_source}: file tidak ada atau kosong")
                continue
            try:
                probe_media(possible_source)
            except AppError as exc:
                source_validation_errors.append(f"{possible_source}: {exc.message}")
                continue
            source_path = possible_source
            break
        if not source_path:
            candidate.file_missing = True
            raise AppError(
                ErrorCode.RENDER_FAILED,
                "Source video tidak valid untuk render. "
                f"Checked: {'; '.join(source_validation_errors) or 'tidak ada source tersedia'}",
            )
        source_check_duration = perf_counter() - source_check_started_at
        logger.info(
            "render_stage_completed",
            render_id=render_id,
            stage="source_check",
            source_check_duration=round(source_check_duration, 3),
            source_path=str(source_path),
            source_size_bytes=source_path.stat().st_size,
        )
        render.status = "running"
        db.commit()
        settings = get_settings()
        width, height = (
            (settings.preview_width, settings.preview_height)
            if preview
            else (settings.final_width, settings.final_height)
        )
        folder = "previews" if preview else "exports"
        destination = LocalStorageProvider().resolve(
            f"{project.id}/{folder}/{render.id}.mp4"
        )
        subtitle_path = LocalStorageProvider().resolve(
            f"{project.id}/subtitles/{render.id}.ass"
        )
        prepare_plan_started_at = perf_counter()
        editor_render_plan = build_editor_render_plan(
            plan.clipper_style_config,
            candidate_duration=candidate.duration_seconds,
            hook_fallback=plan.original_hook,
        )
        requested_style_config = editor_render_plan.style_config
        style_config = dict(requested_style_config)
        logger.info(
            "render_element_contract_audit",
            phase="worker_render_plan",
            render_id=str(render.id),
            transformation_id=str(plan.id),
            candidate_id=str(candidate.id),
            template=render.preset,
            resolution=f"{width}x{height}",
            **editor_render_plan.element_audit.log_fields(),
        )
        video_track_deleted = bool(style_config.get("video_track_deleted"))
        audio_track_deleted = bool(style_config.get("audio_track_deleted"))
        if audio_track_deleted or (
            video_track_deleted and not style_config.get("audio_extracted")
        ):
            style_config["audio_settings"] = {
                **style_config.get("audio_settings", {}),
                "muted": True,
            }
        video_sequence = editor_render_plan.video_sequence
        audio_sequence = editor_render_plan.audio_sequence
        media_sequence = editor_render_plan.media_sequence
        render_duration = sum(
            float(item["source_end"]) - float(item["source_start"])
            for item in media_sequence
        )
        voiceover_assets = list(
            db.scalars(
                select(MediaAsset)
                .where(
                    MediaAsset.project_id == project.id,
                    MediaAsset.asset_type == "voiceover",
                )
                .order_by(MediaAsset.created_at.desc())
            )
        )
        voiceover_asset = voiceover_assets[0] if voiceover_assets else None
        voiceover_path = Path(voiceover_asset.storage_path) if voiceover_asset else None
        voiceover_duration = 0.0
        if voiceover_path:
            if not voiceover_path.is_file() or voiceover_path.stat().st_size <= 0:
                logger.error(
                    "voiceover_asset_missing",
                    render_id=str(render.id),
                    voiceover_source_path=str(voiceover_path),
                )
                raise AppError(ErrorCode.RENDER_FAILED, "File voice-over tidak tersedia.")
            voiceover_duration = probe_audio_duration(voiceover_path)
        additional_audio_sources: list[AudioMixSource] = []
        additional_audio_identity: list[dict[str, object]] = []
        audio_warning: str | None = None
        for track in editor_render_plan.style_config.get("additional_audio_tracks", []):
            if not isinstance(track, dict):
                continue
            asset_id = str(track.get("asset_id") or "")
            track_path = _audio_library_path(project.id, asset_id)
            if not track_path:
                audio_warning = (
                    "Sebagian audio tambahan tidak ditemukan dan tidak ikut export."
                )
                logger.warning(
                    "additional_audio_asset_missing",
                    render_id=str(render.id),
                    asset_id=asset_id,
                    track_id=track.get("id"),
                )
                continue
            additional_audio_sources.append(
                AudioMixSource(
                    track_path,
                    start=max(0.0, float(track.get("start", 0) or 0)),
                    end=max(0.0, float(track.get("end", render_duration) or render_duration)),
                    volume=max(0.0, min(2.0, float(track.get("volume", 1) or 1))),
                    label=str(track.get("label") or "additional_audio"),
                )
            )
            additional_audio_identity.append(
                {
                    "asset_id": asset_id,
                    "path": str(track_path),
                    "start": track.get("start", 0),
                    "end": track.get("end"),
                    "volume": track.get("volume", 1),
                }
            )
        audio_identity = {
            "voiceover": {
                "asset_id": str(voiceover_asset.id) if voiceover_asset else None,
                "path": str(voiceover_path) if voiceover_path else None,
                "checksum": voiceover_asset.checksum if voiceover_asset else None,
                "start": style_config.get("voiceover_start", 0),
                "end": style_config.get("voiceover_end"),
            },
            "additional_audio": additional_audio_identity,
        }
        logger.info(
            "render_audio_master_clock",
            render_id=str(render.id),
            master_duration=round(render_duration, 3),
            voiceover_asset_found=bool(voiceover_asset),
            voiceover_source_path=str(voiceover_path) if voiceover_path else None,
            voiceover_start=style_config.get("voiceover_start", 0),
            voiceover_duration=round(voiceover_duration, 3),
            voiceover_clamped_duration=round(
                min(render_duration, max(0.0, voiceover_duration - float(style_config.get("voiceover_start", 0) or 0))),
                3,
            ) if voiceover_duration else 0.0,
            additional_audio_count=len(additional_audio_sources),
        )
        source_ranges = [
            (
                candidate.start_seconds + float(item["source_start"]),
                candidate.start_seconds + float(item["source_end"]),
            )
            for item in media_sequence
        ]
        effective_start = min(start for start, _ in source_ranges)
        effective_end = max(end for _, end in source_ranges)
        segments = list(
            db.scalars(
                select(TranscriptSegment)
                .where(
                    TranscriptSegment.project_id == project.id,
                    TranscriptSegment.end_seconds > effective_start,
                    TranscriptSegment.start_seconds < effective_end,
                )
                .order_by(TranscriptSegment.segment_index)
            )
        )
        if project.content_type == "sports" and project.transcript_provider == "mock":
            segments = []
        fallback_cues: list[tuple[float, float, str]] = []
        cue_offset = 0.0
        for range_start, range_end in source_ranges:
            range_cues = transcript_cues(
                segments,
                range_start,
                range_end,
                max_words=int(style_config.get("caption_max_words", 8)),
            )
            fallback_cues.extend(
                (start + cue_offset, end + cue_offset, text)
                for start, end, text in range_cues
            )
            cue_offset += range_end - range_start
        saved_caption_timeline = editor_render_plan.caption_timeline
        caption_selection = resolve_caption_render_cues(
            editor_render_plan,
            fallback_cues,
            render_duration=render_duration,
        )
        cues = caption_selection.cues
        source_language = normalize_language(project.transcript_language)
        if (
            cues
            and caption_selection.source != "editor_state"
            and source_language != render.subtitle_language
        ):
            translated = translate_texts(
                [text for _, _, text in cues],
                render.subtitle_language,
            )
            cues = [
                (start, end, translated[index])
                for index, (start, end, _) in enumerate(cues)
            ]
        renderer_cues = cues
        caption_write_report = None
        if renderer_cues:
            caption_write_report = write_ass_cues(
                subtitle_path,
                renderer_cues,
                style_config.get("caption_style"),
            )
            if caption_write_report.cues_written == 0:
                with suppress(FileNotFoundError):
                    subtitle_path.unlink()
        else:
            with suppress(FileNotFoundError):
                subtitle_path.unlink()
        caption_audit = editor_render_plan.element_audit
        caption_style_status = caption_audit.element_statuses.get(
            "caption_style",
            "not_applicable",
        )
        caption_style_partial_reason = caption_audit.unsupported_reasons.get(
            "caption_style"
        )
        logger.info(
            "render_caption_binding",
            render_id=str(render.id),
            transformation_id=str(plan.id),
            caption_source=caption_selection.source,
            caption_initialized=editor_render_plan.caption_timeline_initialized,
            editor_state_version=style_config.get("editor_state_version", 0),
            caption_timeline_count=len(saved_caption_timeline),
            first_caption_text_in_render_plan=(
                saved_caption_timeline[0].get("text")
                if saved_caption_timeline
                else None
            ),
            selected_caption_count=len(cues),
            renderer_caption_count=(
                caption_write_report.cues_written if caption_write_report else 0
            ),
            first_caption_text_used_by_renderer=(
                renderer_cues[0][2] if renderer_cues else None
            ),
            skipped_unsafe_caption_count=(
                caption_write_report.cues_skipped if caption_write_report else 0
            ),
            caption_style_preset=(
                caption_write_report.style_preset
                if caption_write_report
                else None
            ),
            caption_text_color=(
                caption_write_report.text_color if caption_write_report else None
            ),
            caption_font_key=(
                caption_write_report.font_name if caption_write_report else None
            ),
            caption_outline=(
                caption_write_report.outline if caption_write_report else None
            ),
            caption_shadow=(
                caption_write_report.shadow if caption_write_report else None
            ),
            caption_background=(
                caption_write_report.background if caption_write_report else None
            ),
            caption_style_export_status=caption_style_status,
            caption_style_partial_reason=caption_style_partial_reason,
            caption_style_fallbacks=(
                list(caption_write_report.style_fallbacks)
                if caption_write_report
                else []
            ),
            subtitle_cues_written=(
                caption_write_report.cues_written if caption_write_report else 0
            ),
            subtitle_cues_skipped=(
                caption_write_report.cues_skipped if caption_write_report else 0
            ),
            subtitle_skip_reasons=(
                caption_write_report.skip_reasons if caption_write_report else {}
            ),
            caption_render_path=(
                "ass_subtitles_filter"
                if caption_write_report and caption_write_report.cues_written
                else "none"
            ),
            caption_overlay_applied_once=bool(
                caption_write_report and caption_write_report.cues_written
            ),
            legacy_caption_path_disabled=True,
            caption_display_mode=(
                caption_write_report.display_mode if caption_write_report else None
            ),
            karaoke_export_mode=(
                caption_write_report.animation_mode
                if caption_write_report
                and caption_write_report.display_mode == "karaoke"
                else None
            ),
            word_by_word_export_mode=(
                caption_write_report.animation_mode
                if caption_write_report
                and caption_write_report.display_mode == "word_by_word"
                else None
            ),
            source_caption_cues_written=(
                caption_write_report.source_cues_written
                if caption_write_report
                else 0
            ),
        )
        saved_effect_timeline = validate_effect_timeline(
            editor_render_plan.effect_timeline,
            render_duration,
        )
        uses_editor_effect_timeline = bool(
            editor_render_plan.effect_timeline_initialized or saved_effect_timeline
        )
        effect_timeline = (
            saved_effect_timeline
            if uses_editor_effect_timeline
            else build_effect_timeline(
                style_config,
                segments,
                effective_start,
                render_duration,
                candidate.transcript_text,
                plan.original_hook,
                plan.new_angle,
            )
        )
        style_config["_hook_timeline_source"] = (
            "editor_state" if uses_editor_effect_timeline else "legacy"
        )
        style_config["effect_timeline"] = effect_timeline
        keywords = extract_keywords(candidate.transcript_text, plan.original_hook, plan.new_angle)
        prepare_plan_duration = perf_counter() - prepare_plan_started_at
        logger.info(
            "render_stage_completed",
            render_id=render_id,
            stage="prepare_plan",
            prepare_plan_duration=round(prepare_plan_duration, 3),
        )
        uses_short_source = bool(
            candidate.short_source_clip_path
            and source_path == Path(candidate.short_source_clip_path)
        )
        original_source_path = source_path
        sequence_build_started_at = perf_counter()
        if len(media_sequence) > 1:
            sequence_source_path = destination.with_name(
                f"{destination.stem}.sequence{destination.suffix}"
            )
            sequence_ranges = [
                (
                    float(item["source_start"])
                    if uses_short_source
                    else candidate.start_seconds + float(item["source_start"]),
                    float(item["source_end"])
                    if uses_short_source
                    else candidate.start_seconds + float(item["source_end"]),
                )
                for item in media_sequence
            ]
            assemble_media_sequence(source_path, sequence_source_path, sequence_ranges)
            source_path = sequence_source_path
            render_start = 0.0
        else:
            only_segment = media_sequence[0]
            render_start = (
                float(only_segment["source_start"])
                if uses_short_source
                else candidate.start_seconds + float(only_segment["source_start"])
            )
        if audio_sequence and audio_sequence != media_sequence:
            audio_sequence_source_path = destination.with_name(
                f"{destination.stem}.audio-sequence{destination.suffix}"
            )
            audio_ranges = [
                (
                    float(item["source_start"])
                    if uses_short_source
                    else candidate.start_seconds + float(item["source_start"]),
                    float(item["source_end"])
                    if uses_short_source
                    else candidate.start_seconds + float(item["source_end"]),
                )
                for item in audio_sequence
            ]
            assemble_media_sequence(
                original_source_path,
                audio_sequence_source_path,
                audio_ranges,
            )
        sequence_build_duration = perf_counter() - sequence_build_started_at
        logger.info(
            "render_stage_completed",
            render_id=render_id,
            stage="sequence_build",
            sequence_build_duration=round(sequence_build_duration, 3),
            video_sequence_assembled=len(media_sequence) > 1,
            audio_sequence_assembled=bool(
                audio_sequence and audio_sequence != media_sequence
            ),
        )
        working_destination = destination.with_name(f"{destination.stem}.tmp{destination.suffix}")
        fallback_warning = None
        if audio_warning:
            fallback_warning = audio_warning
        audit_fingerprint = render_fingerprint(
            requested_style_config,
            preset=render.preset,
            subtitle_language=render.subtitle_language,
            width=width,
            height=height,
            frame_rate=render.frame_rate,
            preview=preview,
            audio_identity=audio_identity,
        )
        hook_event_count = sum(
            1 for event in effect_timeline if event.get("type") == "hook_text"
        )
        keyword_event_count = sum(
            1 for event in effect_timeline if event.get("type") == "keyword_popup"
        )

        logger.info(
            "render_pipeline_timing_start",
            render_id=str(render.id),
            transformation_id=str(plan.id),
            candidate_id=str(candidate.id),
            resolution=f"{width}x{height}",
            frame_rate=render.frame_rate,
            video_codec="libx264",
            encoder_preset="veryfast",
            video_quality="crf_23_default",
            audio_codec="aac",
            audio_bitrate="160k",
            template=render.preset,
            layout=layout_mode(render.preset),
            duration=round(render_duration, 3),
            video_sequence_count=len(video_sequence),
            audio_sequence_count=len(audio_sequence),
            caption_timeline_count=len(saved_caption_timeline),
            hook_event_count=hook_event_count,
            keyword_event_count=keyword_event_count,
            effect_timeline_count=len(effect_timeline),
            unsupported_export_elements=list(
                editor_render_plan.element_audit.unsupported_export_elements
            ),
            video_framing=style_config.get("video_framing"),
            cache_status="miss",
            fingerprint=audit_fingerprint[:12],
            output_path=str(destination),
        )

        logger.info(
            "render_using_editor_state"
            if editor_render_plan.editor_state_found
            else "editor_state_empty_using_candidate_default",
            transformation_id=str(plan.id),
            candidate_id=str(candidate.id),
            render_id=str(render.id),
            editor_state_found=editor_render_plan.editor_state_found,
            video_framing=style_config.get("video_framing"),
            video_sequence_count=len(video_sequence),
            audio_sequence_count=len(audio_sequence),
            caption_timeline_count=len(saved_caption_timeline),
            caption_source=caption_selection.source,
            caption_initialized=editor_render_plan.caption_timeline_initialized,
            editor_state_version=style_config.get("editor_state_version", 0),
            first_caption_text_in_render_plan=(
                saved_caption_timeline[0].get("text")
                if saved_caption_timeline
                else None
            ),
            first_caption_text_used_by_renderer=(
                renderer_cues[0][2] if renderer_cues else None
            ),
            effect_timeline_count=len(editor_render_plan.effect_timeline),
            applied_effect_count=len(effect_timeline),
            template=render.preset,
            layout=layout_mode(render.preset),
            style=style_config.get("clipper_style_preset"),
            source_path=str(source_path),
            candidate_source_path=candidate.short_source_clip_path,
            using_candidate_short_source=uses_short_source,
            output_path=str(destination),
        )
        logger.info(
            "render_video_start",
            render_id=str(render.id),
            transformation_id=str(plan.id),
            candidate_id=str(candidate.id),
            source_path=str(source_path),
            working_destination=str(working_destination),
            final_destination=str(destination),
            preset=render.preset,
            selected_template_label={
                "blurred_background": "Latar buram",
                "center_crop": "Potong tengah",
                "fit_background": "Video penuh",
                "picture_in_picture": "Picture in picture",
            }.get(render.preset, render.preset),
            selected_template_internal_value=render.preset,
            resolved_layout_mode=layout_mode(render.preset),
            target_resolution=f"{width}x{height}",
            video_framing=style_config.get("video_framing"),
            preview=preview,
            selected_style_preset=style_config.get("clipper_style_preset"),
            caption_enabled=bool(renderer_cues),
            caption_cue_count=len(renderer_cues),
            subtitle_path=str(subtitle_path) if renderer_cues else None,
            style_config=style_config,
            effect_timeline=effect_timeline,
        )

        def render_to_temp(
            attempt_name: str,
            config: dict | None = None,
            clean: bool = False,
            include_caption: bool = True,
        ) -> None:
            nonlocal layout_render_duration, output_validation_duration
            with suppress(FileNotFoundError):
                working_destination.unlink()
            active_subtitle_path = (
                subtitle_path if include_caption and renderer_cues else None
            )
            logger.info(
                "render_video_attempt",
                render_id=str(render.id),
                attempt=attempt_name,
                fallback=clean,
                include_caption=bool(active_subtitle_path),
                caption_cue_count=len(renderer_cues) if active_subtitle_path else 0,
                source_path=str(source_path),
                working_destination=str(working_destination),
            )
            layout_started_at = perf_counter()
            if clean:
                render_clean_vertical(
                    source_path,
                    working_destination,
                    render_start,
                    render_duration,
                    width,
                    height,
                    render.preset,
                    active_subtitle_path,
                    style_config,
                    audio_sequence_source_path,
                    audio_mix_sources=(
                        ([
                            AudioMixSource(
                                voiceover_path,
                                start=max(0.0, float(style_config.get("voiceover_start", 0) or 0)),
                                end=style_config.get("voiceover_end"),
                                label="voiceover",
                            )
                        ] if voiceover_path else [])
                        + additional_audio_sources
                    ),
                )
            else:
                render_vertical(
                    source_path,
                    working_destination,
                    render_start,
                    render_duration,
                    width,
                    height,
                    render.preset,
                    audio_sequence_source_path,
                    active_subtitle_path,
                    config,
                    (config or {}).get("hook_text", ""),
                    keywords if config else None,
                    (config or {}).get("effect_timeline", []) if config else None,
                    audio_mix_sources=(
                        ([
                            AudioMixSource(
                                voiceover_path,
                                start=max(0.0, float(style_config.get("voiceover_start", 0) or 0)),
                                end=style_config.get("voiceover_end"),
                                label="voiceover",
                            )
                        ] if voiceover_path else [])
                        + additional_audio_sources
                    ),
                )
            attempt_layout_duration = perf_counter() - layout_started_at
            layout_render_duration += attempt_layout_duration
            validation_started_at = perf_counter()
            attempt_metadata = validate_render_output(
                working_destination,
                render_duration,
            )
            attempt_validation_duration = perf_counter() - validation_started_at
            output_validation_duration += attempt_validation_duration
            logger.info(
                "render_video_attempt_valid",
                render_id=str(render.id),
                attempt=attempt_name,
                fallback=clean,
                include_caption=bool(active_subtitle_path),
                output_size=working_destination.stat().st_size,
                output_duration=round(attempt_metadata.duration, 3),
                layout_caption_effect_render_duration=round(
                    attempt_layout_duration,
                    3,
                ),
                final_encode_duration=None,
                output_validation_duration=round(
                    attempt_validation_duration,
                    3,
                ),
                stage_note="layout_caption_effect_and_encode_are_one_ffmpeg_stage",
            )

        without_keyword = {
            **style_config,
            "keyword_popup_enabled": False,
            "effect_timeline": [
                event for event in effect_timeline if event.get("type") != "keyword_popup"
            ],
        }
        without_pattern = {
            **without_keyword,
            "pattern_interrupt_enabled": False,
            "effect_timeline": [
                event
                for event in without_keyword["effect_timeline"]
                if event.get("type") != "pattern_interrupt"
            ],
        }
        without_punch = {
            **without_pattern,
            "punch_zoom_enabled": False,
            "effect_timeline": [
                event for event in without_pattern["effect_timeline"] if event.get("type") != "punch_zoom"
            ],
        }
        attempts = [
            (
                "style_with_caption",
                style_config,
                False,
                True,
                None,
            ),
            (
                "without_keyword_popup",
                without_keyword,
                False,
                True,
                "Keyword pop-up gagal diproses, render dilanjutkan tanpa keyword.",
            ),
            (
                "without_pattern_interrupt",
                without_pattern,
                False,
                True,
                "Pattern interrupt gagal diproses, render dilanjutkan tanpa pattern interrupt.",
            ),
            (
                "without_punch_zoom",
                without_punch,
                False,
                True,
                "Punch zoom gagal, preview dibuat dengan mode aman.",
            ),
            (
                "clean_template_with_caption",
                None,
                True,
                True,
                "Sebagian efek gaya tidak diterapkan.",
            ),
            (
                "clean_template_video_only",
                None,
                True,
                False,
                "Caption gagal dirender, preview dibuat tanpa caption.",
            ),
        ]
        last_error: AppError | None = None
        for attempt_name, attempt_config, clean, include_caption, warning in attempts:
            attempt_started_at = perf_counter()
            try:
                render_to_temp(attempt_name, attempt_config, clean, include_caption)
                if attempt_name != "style_with_caption":
                    fallback_warning = warning or "Sebagian efek gaya tidak diterapkan."
                    render.error_message = fallback_warning[:1000]
                    db.commit()
                break
            except AppError as attempt_error:
                last_error = attempt_error
                logger.warning(
                    "render_video_attempt_failed",
                    render_id=str(render.id),
                    attempt=attempt_name,
                    include_caption=include_caption,
                    error=attempt_error.message,
                    attempt_duration=round(perf_counter() - attempt_started_at, 3),
                )
        else:
            raise last_error or AppError(ErrorCode.RENDER_FAILED, "Render gagal.")

        db.refresh(render, attribute_names=["status"])
        if render.status == "superseded":
            with suppress(FileNotFoundError):
                working_destination.unlink()
            logger.info(
                "render_video_discarded_superseded",
                render_id=render_id,
                transformation_id=str(plan.id),
            )
            return {"status": "superseded", "render_id": render_id}
        final_validation_started_at = perf_counter()
        working_destination.replace(destination)
        verify_render_file_binding(
            destination,
            preview=preview,
            forbidden_source_paths=(
                candidate.short_source_clip_path,
                source.storage_path if source else None,
                original_source_path,
            ),
        )
        output_metadata = validate_render_output(destination, render_duration)
        output_audio_duration = 0.0
        if output_metadata.has_audio:
            output_audio_duration = probe_audio_duration(destination)
        base_audio_duration = sum(
            float(item["source_end"]) - float(item["source_start"])
            for item in audio_sequence
        )
        caption_timeline_duration = max(
            (float(item.get("end", 0)) for item in saved_caption_timeline),
            default=0.0,
        )
        logger.info(
            "render_audio_master_clock_completed",
            render_id=str(render.id),
            master_duration=round(render_duration, 3),
            video_output_duration=round(output_metadata.duration, 3),
            base_audio_duration=round(base_audio_duration, 3),
            voiceover_duration=round(voiceover_duration, 3),
            additional_audio_count=len(additional_audio_sources),
            final_audio_duration=round(output_audio_duration, 3),
            caption_timeline_duration=round(caption_timeline_duration, 3),
            av_duration_delta=round(output_metadata.duration - output_audio_duration, 3)
            if output_audio_duration
            else None,
        )
        final_validation_duration = perf_counter() - final_validation_started_at
        output_validation_duration += final_validation_duration
        metadata_write_started_at = perf_counter()
        output_fingerprint = audit_fingerprint or render_fingerprint(
            requested_style_config,
            preset=render.preset,
            subtitle_language=render.subtitle_language,
            width=width,
            height=height,
            frame_rate=render.frame_rate,
            preview=preview,
        )
        write_render_cache_metadata(
            destination,
            fingerprint=output_fingerprint,
            video_framing=style_config.get("video_framing"),
        )
        logger.info(
            "render_cache_metadata_written",
            render_id=render_id,
            fingerprint=output_fingerprint,
            video_framing=style_config.get("video_framing"),
            preset=render.preset,
            resolution=f"{width}x{height}",
        )
        render.status = "completed"
        render.width = width
        render.height = height
        render.duration_seconds = output_metadata.duration
        render.file_size_bytes = destination.stat().st_size
        render.preview_path = str(destination) if preview else render.preview_path
        render.output_path = str(destination) if not preview else render.output_path
        render.completed_at = datetime.now(UTC)
        render.error_message = fallback_warning[:1000] if fallback_warning else None
        if preview and project.status not in {ProjectStatus.COMPLETED, ProjectStatus.FAILED}:
            project.status = ProjectStatus.PREVIEW_READY
        elif not preview:
            project.status = ProjectStatus.COMPLETED
        db.commit()
        metadata_write_duration = perf_counter() - metadata_write_started_at
        total_render_duration = perf_counter() - render_started_at
        logger.info(
            "render_pipeline_timing_completed",
            status="completed",
            render_id=str(render.id),
            transformation_id=str(plan.id),
            candidate_id=str(candidate.id),
            output_path=str(destination),
            output_size_bytes=destination.stat().st_size,
            output_duration=round(output_metadata.duration, 3),
            resolution=f"{width}x{height}",
            template=render.preset,
            layout=layout_mode(render.preset),
            caption_timeline_count=len(saved_caption_timeline),
            hook_event_count=hook_event_count,
            keyword_event_count=keyword_event_count,
            effect_timeline_count=len(effect_timeline),
            unsupported_export_elements=list(
                editor_render_plan.element_audit.unsupported_export_elements
            ),
            fingerprint=output_fingerprint[:12],
            prepare_plan_duration=round(prepare_plan_duration, 3),
            source_check_duration=round(source_check_duration, 3),
            sequence_build_duration=round(sequence_build_duration, 3),
            combined_layout_caption_effect_encode_duration=round(
                layout_render_duration,
                3,
            ),
            layout_render_duration=None,
            text_overlay_render_duration=None,
            effect_render_duration=None,
            caption_effect_render_duration=None,
            final_encode_duration=None,
            output_validation_duration=round(output_validation_duration, 3),
            metadata_write_duration=round(metadata_write_duration, 3),
            total_render_duration=round(total_render_duration, 3),
            stage_note="layout_caption_effect_and_encode_are_one_ffmpeg_stage",
        )
        return {"status": "completed", "render_id": str(render.id)}
    except Exception as exc:
        db.rollback()
        if render:
            if destination:
                try:
                    verify_render_file_binding(
                        destination,
                        preview=preview,
                        forbidden_source_paths=(
                            candidate.short_source_clip_path if candidate else None,
                            source.storage_path if source else None,
                        ),
                    )
                    output_metadata = validate_render_output(destination, None)
                    db.refresh(render, attribute_names=["status"])
                    if render.status == "superseded":
                        return {"status": "superseded", "render_id": render_id}
                    if style_config:
                        output_fingerprint = render_fingerprint(
                            requested_style_config,
                            preset=render.preset,
                            subtitle_language=render.subtitle_language,
                            width=width or output_metadata.width,
                            height=height or output_metadata.height,
                            frame_rate=render.frame_rate,
                            preview=preview,
                        )
                        write_render_cache_metadata(
                            destination,
                            fingerprint=output_fingerprint,
                            video_framing=style_config.get("video_framing"),
                        )
                    render.status = "completed"
                    render.width = width or output_metadata.width
                    render.height = height or output_metadata.height
                    render.duration_seconds = output_metadata.duration
                    render.file_size_bytes = destination.stat().st_size
                    render.preview_path = str(destination) if preview else render.preview_path
                    render.output_path = str(destination) if not preview else render.output_path
                    render.completed_at = datetime.now(UTC)
                    render.error_message = None
                    db.commit()
                    total_render_duration = perf_counter() - render_started_at
                    logger.warning(
                        "render_video_recovered_valid_destination",
                        render_id=render_id,
                        destination=str(destination),
                        output_size_bytes=destination.stat().st_size,
                        output_duration=round(output_metadata.duration, 3),
                        prepare_plan_duration=round(prepare_plan_duration, 3),
                        source_check_duration=round(source_check_duration, 3),
                        sequence_build_duration=round(sequence_build_duration, 3),
                        combined_layout_caption_effect_encode_duration=round(
                            layout_render_duration,
                            3,
                        ),
                        output_validation_duration=round(
                            output_validation_duration,
                            3,
                        ),
                        total_render_duration=round(total_render_duration, 3),
                    )
                    return {"status": "completed", "render_id": render_id}
                except Exception:
                    db.rollback()
            render.status = "failed"
            message = exc.message if isinstance(exc, AppError) else str(exc)
            render.error_message = message[:1000]
            render.completed_at = datetime.now(UTC)
            logger.error(
                "render_video_failed",
                render_id=render_id,
                error=message,
                output_path=str(destination) if destination else None,
                output_size_bytes=(
                    destination.stat().st_size
                    if destination and destination.is_file()
                    else 0
                ),
                prepare_plan_duration=round(prepare_plan_duration, 3),
                source_check_duration=round(source_check_duration, 3),
                sequence_build_duration=round(sequence_build_duration, 3),
                combined_layout_caption_effect_encode_duration=round(
                    layout_render_duration,
                    3,
                ),
                output_validation_duration=round(output_validation_duration, 3),
                metadata_write_duration=round(metadata_write_duration, 3),
                total_render_duration=round(perf_counter() - render_started_at, 3),
                traceback=traceback.format_exc()[-4000:],
            )
            db.commit()
        return {"status": "failed", "error": str(exc)}
    finally:
        if sequence_source_path:
            with suppress(FileNotFoundError):
                sequence_source_path.unlink()
        if audio_sequence_source_path:
            with suppress(FileNotFoundError):
                audio_sequence_source_path.unlink()
        db.close()


@celery_app.task(name="cleanup_expired_media")
def cleanup_expired_media() -> int:
    cutoff = datetime.now(UTC) - timedelta(days=get_settings().media_retention_days)
    deleted = 0
    with SessionLocal() as db:
        projects = list(
            db.scalars(
                select(Project).where(
                    Project.deleted_at.is_not(None),
                    Project.deleted_at < cutoff,
                )
            )
        )
        storage = LocalStorageProvider()
        for project in projects:
            storage.delete_project(project.id)
            deleted += 1
    return deleted
