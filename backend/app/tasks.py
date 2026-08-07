import hashlib
import traceback
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path

import structlog
from sqlalchemy import delete, select

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
    generate_candidates,
    normalize_to_one_minute_candidates,
    weighted_score,
)
from app.services.clipper_style import (
    build_effect_timeline,
    extract_keywords,
    normalize_clipper_style,
    resolve_media_sequence,
    validate_effect_timeline,
)
from app.services.media import (
    assemble_media_sequence,
    extract_audio,
    extract_clip,
    extract_thumbnail,
    layout_mode,
    probe_media,
    render_clean_vertical,
    render_vertical,
    validate_render_output,
)
from app.services.sports import (
    analyze_sports_video,
    generate_sports_candidates,
    sports_transcript,
)
from app.services.subtitles import filter_safe_cues, transcript_cues, write_ass_cues
from app.services.titles import generate_candidate_copy
from app.services.translation import normalize_language, translate_texts

logger = structlog.get_logger()


def _transition(project: Project, target: ProjectStatus) -> None:
    validate_transition(project.status, target)
    project.status = target


def _job_progress(job: ProcessingJob, progress: int, step: str) -> None:
    job.progress = progress
    job.current_step = step


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


@celery_app.task(name="process_project")
def process_project(project_id: str, job_id: str) -> None:
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

        _transition(project, ProjectStatus.EXTRACTING_METADATA)
        _job_progress(job, 10, "Memvalidasi dan membaca metadata video")
        db.commit()
        metadata = probe_media(source_path)
        source.duration_seconds = metadata.duration
        source.width = metadata.width
        source.height = metadata.height
        source.frame_rate = metadata.frame_rate
        source.audio_sample_rate = metadata.audio_sample_rate

        _transition(project, ProjectStatus.EXTRACTING_AUDIO)
        _job_progress(job, 25, "Mengekstrak audio")
        db.commit()
        storage = LocalStorageProvider()
        audio_path = storage.resolve(f"{project.id}/audio/{uuid.uuid4()}.wav")
        extract_audio(source_path, audio_path, metadata.has_audio)
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

        db.execute(delete(TranscriptSegment).where(TranscriptSegment.project_id == project.id))
        _transition(project, ProjectStatus.TRANSCRIBING)
        _job_progress(
            job,
            45,
            "Membaca komentar pertandingan" if project.content_type == "sports" else "Membuat transkrip",
        )
        db.commit()
        try:
            result = get_transcription_provider().transcribe(audio_path, metadata.duration)
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
        except Exception:
            if project.content_type != "sports":
                raise
            project.transcript_provider = "unavailable"
            project.transcript_language = None

        _transition(project, ProjectStatus.SEGMENTING)
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
        if project.content_type == "sports":
            sports_signals = analyze_sports_video(source_path, metadata.has_audio)
            drafts = generate_sports_candidates(
                sports_signals,
                metadata.duration,
                limit=max_top_clips,
            )
        else:
            drafts = generate_candidates(segments, limit=max(30, max_top_clips))
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
        existing_candidates = list(
            db.scalars(
                select(ClipCandidate)
                .where(ClipCandidate.project_id == project.id)
                .order_by(ClipCandidate.rank)
            )
        )
        for rank, draft in enumerate(final_drafts, 1):
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
                candidate.suggested_title = candidate_copy["title"]
                candidate.suggested_hook = candidate_copy["hook"]
                candidate.summary = (
                    "Cuplikan membahas pentingnya konteks dan kontribusi kreator."
                )
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
    db = SessionLocal()
    render = db.get(Render, uuid.UUID(render_id))
    destination: Path | None = None
    sequence_source_path: Path | None = None
    audio_sequence_source_path: Path | None = None
    width = 0
    height = 0
    try:
        if not render:
            return
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
        style_config = normalize_clipper_style(plan.clipper_style_config, plan.original_hook)
        video_track_deleted = bool(style_config.get("video_track_deleted"))
        audio_track_deleted = bool(style_config.get("audio_track_deleted"))
        if audio_track_deleted or (
            video_track_deleted and not style_config.get("audio_extracted")
        ):
            style_config["audio_settings"] = {
                **style_config.get("audio_settings", {}),
                "muted": True,
            }
        base_sequence = style_config.get("media_sequence")
        video_sequence = resolve_media_sequence(
            style_config.get("video_sequence") or base_sequence,
            candidate.duration_seconds,
            style_config.get("media_trim"),
        )
        audio_sequence = (
            resolve_media_sequence(
                style_config.get("audio_sequence") or video_sequence,
                candidate.duration_seconds,
                style_config.get("media_trim"),
            )
            if style_config.get("audio_extracted")
            else video_sequence
        )
        media_sequence = video_sequence
        style_config["video_sequence"] = video_sequence
        style_config["audio_sequence"] = audio_sequence
        render_duration = sum(
            float(item["source_end"]) - float(item["source_start"])
            for item in media_sequence
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
        cues: list[tuple[float, float, str]] = []
        cue_offset = 0.0
        for range_start, range_end in source_ranges:
            range_cues = transcript_cues(
                segments,
                range_start,
                range_end,
                max_words=int(style_config.get("caption_max_words", 8)),
            )
            cues.extend(
                (start + cue_offset, end + cue_offset, text)
                for start, end, text in range_cues
            )
            cue_offset += range_end - range_start
        saved_caption_timeline = style_config.get("caption_timeline") or []
        if saved_caption_timeline:
            cues = [
                (
                    max(0.0, float(item["start"])),
                    min(render_duration, float(item["end"])),
                    str(item["text"]),
                )
                for item in saved_caption_timeline
                if float(item["start"]) < render_duration
                and min(render_duration, float(item["end"])) > float(item["start"])
            ]
        source_language = normalize_language(project.transcript_language)
        if cues and source_language != render.subtitle_language:
            translated = translate_texts(
                [text for _, _, text in cues],
                render.subtitle_language,
            )
            cues = [
                (start, end, translated[index])
                for index, (start, end, _) in enumerate(cues)
            ]
            cues = filter_safe_cues(cues)
        if cues:
            write_ass_cues(subtitle_path, cues)
        saved_effect_timeline = validate_effect_timeline(
            style_config.get("effect_timeline"),
            render_duration,
        )
        effect_timeline = saved_effect_timeline or build_effect_timeline(
            style_config,
            segments,
            effective_start,
            render_duration,
            candidate.transcript_text,
            plan.original_hook,
            plan.new_angle,
        )
        style_config["effect_timeline"] = effect_timeline
        plan.clipper_style_config = style_config
        db.commit()
        keywords = extract_keywords(candidate.transcript_text, plan.original_hook, plan.new_angle)
        uses_short_source = bool(
            candidate.short_source_clip_path
            and source_path == Path(candidate.short_source_clip_path)
        )
        original_source_path = source_path
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
        if audio_sequence != video_sequence:
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
        working_destination = destination.with_name(f"{destination.stem}.tmp{destination.suffix}")
        fallback_warning = None

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
            preview=preview,
            selected_style_preset=style_config.get("clipper_style_preset"),
            caption_enabled=bool(cues),
            caption_cue_count=len(cues),
            subtitle_path=str(subtitle_path) if cues else None,
            style_config=style_config,
            effect_timeline=effect_timeline,
        )

        def render_to_temp(
            attempt_name: str,
            config: dict | None = None,
            clean: bool = False,
            include_caption: bool = True,
        ) -> None:
            with suppress(FileNotFoundError):
                working_destination.unlink()
            active_subtitle_path = subtitle_path if include_caption and cues else None
            logger.info(
                "render_video_attempt",
                render_id=str(render.id),
                attempt=attempt_name,
                fallback=clean,
                include_caption=bool(active_subtitle_path),
                caption_cue_count=len(cues) if active_subtitle_path else 0,
                source_path=str(source_path),
                working_destination=str(working_destination),
            )
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
                )
            validate_render_output(working_destination, render_duration)
            logger.info(
                "render_video_attempt_valid",
                render_id=str(render.id),
                attempt=attempt_name,
                fallback=clean,
                include_caption=bool(active_subtitle_path),
                output_size=working_destination.stat().st_size,
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
                )
        else:
            raise last_error or AppError(ErrorCode.RENDER_FAILED, "Render gagal.")

        working_destination.replace(destination)
        output_metadata = validate_render_output(destination, render_duration)
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
        return {"status": "completed", "render_id": str(render.id)}
    except Exception as exc:
        db.rollback()
        if render:
            if destination:
                try:
                    output_metadata = validate_render_output(destination, None)
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
                    logger.warning(
                        "render_video_recovered_valid_destination",
                        render_id=render_id,
                        destination=str(destination),
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
