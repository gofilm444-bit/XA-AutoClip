import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

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
from app.services.media import extract_audio, probe_media, render_vertical
from app.services.sports import (
    analyze_sports_video,
    generate_sports_candidates,
    sports_transcript,
)
from app.services.subtitles import transcript_cues, write_ass_cues
from app.services.titles import generate_candidate_copy
from app.services.translation import normalize_language, translate_texts


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
        if project.content_type == "sports":
            sports_signals = analyze_sports_video(source_path, metadata.has_audio)
            drafts = generate_sports_candidates(
                sports_signals,
                metadata.duration,
                limit=5,
            )
        else:
            drafts = generate_candidates(segments, limit=30)
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
            else normalize_to_one_minute_candidates(drafts, metadata.duration)
        )
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
def render_video(render_id: str, preview: bool) -> None:
    db = SessionLocal()
    render = db.get(Render, uuid.UUID(render_id))
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
        if not all((project, plan, candidate, source)):
            raise AppError(ErrorCode.RENDER_FAILED, "Data render tidak lengkap.")
        target_status = (
            ProjectStatus.RENDERING_PREVIEW if preview else ProjectStatus.RENDERING_FINAL
        )
        _transition(project, target_status)
        render.status = "running"
        db.commit()
        width, height = (540, 960) if preview else (1080, 1920)
        folder = "previews" if preview else "exports"
        destination = LocalStorageProvider().resolve(
            f"{project.id}/{folder}/{render.id}.mp4"
        )
        subtitle_path = LocalStorageProvider().resolve(
            f"{project.id}/subtitles/{render.id}.ass"
        )
        segments = list(
            db.scalars(
                select(TranscriptSegment)
                .where(
                    TranscriptSegment.project_id == project.id,
                    TranscriptSegment.end_seconds > candidate.start_seconds,
                    TranscriptSegment.start_seconds < candidate.end_seconds,
                )
                .order_by(TranscriptSegment.segment_index)
            )
        )
        if project.content_type == "sports" and project.transcript_provider == "mock":
            segments = []
        cues = transcript_cues(
            segments,
            candidate.start_seconds,
            candidate.end_seconds,
        )
        if not cues and project.content_type != "sports":
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Tidak ada ucapan bertimestamp pada klip yang dipilih.",
            )
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
        if cues:
            write_ass_cues(subtitle_path, cues)
        render_vertical(
            Path(source.storage_path),
            destination,
            candidate.start_seconds,
            candidate.duration_seconds,
            width,
            height,
            render.preset,
            None,
            subtitle_path if cues else None,
        )
        render.status = "completed"
        render.width = width
        render.height = height
        render.duration_seconds = candidate.duration_seconds
        render.file_size_bytes = destination.stat().st_size
        render.preview_path = str(destination) if preview else render.preview_path
        render.output_path = str(destination) if not preview else render.output_path
        render.completed_at = datetime.now(UTC)
        project.status = ProjectStatus.PREVIEW_READY if preview else ProjectStatus.COMPLETED
        db.commit()
    except Exception as exc:
        db.rollback()
        if render:
            render.status = "failed"
            render.error_message = str(exc)[:1000]
            project = db.get(Project, render.project_id)
            if project:
                project.status = ProjectStatus.FAILED
            db.commit()
        raise
    finally:
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
