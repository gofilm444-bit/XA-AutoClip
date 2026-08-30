import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter
from urllib.parse import urljoin, urlparse

import httpx
import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.core.state import ProjectStatus, validate_transition
from app.db.session import get_db
from app.models import (
    ClipCandidate,
    MediaAsset,
    OriginalityReport,
    ProcessingJob,
    Project,
    Render,
    SourceDeclaration,
    TranscriptSegment,
    TransformationPlan,
)
from app.providers.ai.factory import get_ai_provider
from app.providers.storage.local import LocalStorageProvider
from app.schemas.api import (
    BlankManualEditorRead,
    CandidatePatch,
    CandidateRead,
    CandidateSelectionRead,
    CandidateTitlePatch,
    EditorAutoCaptionRequest,
    EditorAutoCaptionResponse,
    EditorMediaAssetRead,
    HookTextRead,
    JobRead,
    ManualEditorRead,
    OriginalityRead,
    ProjectClipRead,
    ProjectCreate,
    ProjectPatch,
    ProjectRead,
    RenderCreate,
    RenderRead,
    SourceMetadataRead,
    SourceMetadataRequest,
    SourceUrlInput,
    TransformationContextRead,
    TransformationCreate,
    TransformationPatch,
    TransformationRead,
)
from app.services.captions import generate_social_caption
from app.services.editor_captions import generate_editor_auto_captions
from app.services.clipper_style import (
    default_clipper_style,
    generate_hook_text_for_clip,
    is_generic_hook,
    normalize_clipper_style,
    normalize_video_framing,
)
from app.services.download_filename import filename_from_path, sanitize_download_filename
from app.services.media import layout_mode, probe_media
from app.services.originality import assess
from app.services.render_cache import read_render_cache_metadata, render_fingerprint
from app.services.render_plan import build_editor_render_plan
from app.services.render_result import same_file_path, verify_render_file_binding
from app.services.source_context import (
    content_title_from_filename,
    source_mismatch_warning,
)
from app.services.source_metadata import (
    MAX_REDIRECTS,
    inspect_source_url,
    is_youtube_url,
    validate_public_url,
)
from app.services.titles import generate_candidate_copy, needs_candidate_copy_refresh
from app.services.usage_audit import estimate_ai_usage
from app.services.video_download import download_page_video
from app.tasks import process_project, render_video

router = APIRouter(prefix="/api")
logger = structlog.get_logger()

PROCESSING_PROJECT_STATUSES = frozenset(
    {
        ProjectStatus.EXTRACTING_METADATA,
        ProjectStatus.EXTRACTING_AUDIO,
        ProjectStatus.TRANSCRIBING,
        ProjectStatus.SEGMENTING,
        ProjectStatus.GENERATING_CANDIDATES,
    }
)


def require(model, db: Session, item_id: uuid.UUID):
    item = db.get(model, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan.")
    return item


def get_source_asset(db: Session, project_id: uuid.UUID) -> MediaAsset | None:
    return db.scalar(
        select(MediaAsset)
        .where(
            MediaAsset.project_id == project_id,
            MediaAsset.asset_type == "source_video",
        )
        .order_by(MediaAsset.created_at.desc())
    )


def caption_content_title(
    declaration: SourceDeclaration,
    source_asset: MediaAsset | None,
) -> str | None:
    if declaration.source_url and declaration.source_title:
        return declaration.source_title
    return (
        content_title_from_filename(source_asset.original_filename)
        if source_asset
        else declaration.source_title
    )


def transition(project: Project, target: ProjectStatus) -> None:
    try:
        validate_transition(project.status, target)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    project.status = target


def begin_source_recovery(project: Project) -> None:
    if project.status == ProjectStatus.FAILED:
        logger.info(
            "source_recovery_relink_started",
            project_id=str(project.id),
            recovery_method="upload_or_source_url",
        )
        project.status = ProjectStatus.UPLOADING
        return
    transition(project, ProjectStatus.UPLOADING)


def is_stale_processing_project(
    project: Project,
    latest_job: ProcessingJob | None,
    candidate_count: int,
    timeout_minutes: int,
    *,
    now: datetime | None = None,
) -> bool:
    if ProjectStatus(project.status) not in PROCESSING_PROJECT_STATUSES:
        return False
    if candidate_count > 0:
        return False
    activity_times = [project.updated_at]
    if latest_job:
        activity_times.append(latest_job.updated_at)
    last_activity = max(_as_utc(value) for value in activity_times if value)
    stale_before = _as_utc(now or datetime.now(UTC)) - timedelta(
        minutes=max(1, timeout_minutes)
    )
    return last_activity <= stale_before


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def project_summary(project: Project, db: Session) -> dict:
    source = get_source_asset(db, project.id)
    top_clips = list(
        db.scalars(select(ClipCandidate).where(ClipCandidate.project_id == project.id))
    )
    final_count = db.scalar(
        select(func.count(Render.id))
        .join(TransformationPlan, Render.transformation_plan_id == TransformationPlan.id)
        .where(
            TransformationPlan.project_id == project.id,
            Render.status == "completed",
            Render.output_path.is_not(None),
        )
    )
    storage_size = 0
    for path_text in [
        source.storage_path if source else None,
        *(candidate.short_source_clip_path for candidate in top_clips),
        *(candidate.clip_thumbnail_path for candidate in top_clips),
    ]:
        if path_text and Path(path_text).is_file():
            storage_size += Path(path_text).stat().st_size
    manual_transformation_id = db.scalar(
        select(TransformationPlan.id)
        .join(ClipCandidate, TransformationPlan.candidate_id == ClipCandidate.id)
        .where(
            TransformationPlan.project_id == project.id,
            ClipCandidate.category == "manual_editor",
        )
        .order_by(TransformationPlan.created_at.desc())
    )
    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "content_type": project.content_type,
        "transcript_provider": project.transcript_provider,
        "transcript_language": project.transcript_language,
        "status": project.status,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "original_duration": source.duration_seconds if source else None,
        "total_top_clips": len(top_clips),
        "final_clips_count": final_count or 0,
        "storage_size_estimate": storage_size,
        "manual_editor_url": (
            f"/transformations/{manual_transformation_id}"
            if manual_transformation_id
            else None
        ),
    }


@router.post("/source-metadata/inspect", response_model=SourceMetadataRead)
def inspect_source(payload: SourceMetadataRequest):
    try:
        return inspect_source_url(str(payload.url))
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Halaman sumber merespons HTTP {exc.response.status_code}.",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=422,
            detail="Halaman sumber tidak dapat diakses.",
        ) from exc


@router.post("/projects", response_model=ProjectRead, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(
        title=payload.title,
        description=payload.description,
        content_type=payload.content_type,
    )
    declaration = payload.source_declaration
    project.source_declaration = SourceDeclaration(
        ownership_type=declaration.ownership_type,
        source_creator=declaration.source_creator,
        source_title=declaration.source_title,
        source_description=declaration.source_description,
        source_url=str(declaration.source_url) if declaration.source_url else None,
        license_type=declaration.license_type,
        intended_use=declaration.intended_use,
        transformation_purpose=declaration.transformation_purpose,
        user_acknowledged=declaration.user_acknowledged,
    )
    db.add(project)
    db.commit()
    return project


@router.get("/projects", response_model=list[ProjectRead])
def list_projects(db: Session = Depends(get_db)):
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.deleted_at.is_(None))
            .order_by(Project.created_at.desc())
        )
    )
    return [project_summary(project, db) for project in projects]


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    if project.deleted_at:
        raise HTTPException(status_code=404, detail="Proyek tidak ditemukan.")
    return project_summary(project, db)


@router.patch("/projects/{project_id}", response_model=ProjectRead)
def patch_project(
    project_id: uuid.UUID, payload: ProjectPatch, db: Session = Depends(get_db)
):
    project = require(Project, db, project_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    db.commit()
    return project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    project.deleted_at = datetime.now(UTC)
    db.commit()
    LocalStorageProvider().delete_project(project_id)


@router.post("/projects/{project_id}/source", status_code=201)
async def upload_source(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    project = require(Project, db, project_id)
    begin_source_recovery(project)
    db.commit()
    path: Path | None = None
    try:
        path, size, checksum, stored_name = await LocalStorageProvider().save_upload(
            project_id, file
        )
        asset = MediaAsset(
            project_id=project_id,
            asset_type="source_video",
            original_filename=Path(file.filename or "video").name,
            stored_filename=stored_name,
            storage_path=str(path),
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=size,
            duration_seconds=None,
            width=None,
            height=None,
            frame_rate=None,
            audio_sample_rate=None,
            checksum=checksum,
        )
        db.add(asset)
        transition(project, ProjectStatus.UPLOADED)
        db.commit()
        return {"asset_id": asset.id, "size_bytes": size}
    except Exception:
        db.rollback()
        if path:
            path.unlink(missing_ok=True)
        project = db.get(Project, project_id)
        if project:
            project.status = ProjectStatus.FAILED
            db.commit()
        raise


@router.post("/projects/{project_id}/source-url", status_code=201)
def import_source_url(
    project_id: uuid.UUID,
    payload: SourceUrlInput,
    db: Session = Depends(get_db),
):
    project = require(Project, db, project_id)
    begin_source_recovery(project)
    db.commit()
    path: Path | None = None
    current_url = str(payload.url)
    headers = {
        "User-Agent": "XA-AutoClip/0.1 (+direct-video-import)",
        "Accept": "video/*,application/octet-stream;q=0.8",
    }
    try:
        if is_youtube_url(current_url):
            path, size, checksum, stored_name, original_filename = (
                download_page_video(project_id, current_url)
            )
            asset = MediaAsset(
                project_id=project_id,
                asset_type="source_video",
                original_filename=original_filename,
                stored_filename=stored_name,
                storage_path=str(path),
                mime_type="video/mp4" if path.suffix.lower() == ".mp4" else "video/webm",
                size_bytes=size,
                duration_seconds=None,
                width=None,
                height=None,
                frame_rate=None,
                audio_sample_rate=None,
                checksum=checksum,
            )
            db.add(asset)
            transition(project, ProjectStatus.UPLOADED)
            db.commit()
            return {"asset_id": asset.id, "size_bytes": size}
        with httpx.Client(timeout=60, follow_redirects=False, headers=headers) as client:
            for _ in range(MAX_REDIRECTS + 1):
                validate_public_url(current_url)
                with client.stream("GET", current_url) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise AppError(
                                ErrorCode.INVALID_VIDEO,
                                "Redirect sumber video tidak valid.",
                            )
                        current_url = urljoin(current_url, location)
                        continue
                    response.raise_for_status()
                    mime_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                    extension_by_mime = {
                        "video/mp4": ".mp4",
                        "video/quicktime": ".mov",
                        "video/webm": ".webm",
                    }
                    extension = extension_by_mime.get(mime_type)
                    url_extension = Path(urlparse(str(response.url)).path).suffix.lower()
                    if (
                        not extension
                        and mime_type == "application/octet-stream"
                        and url_extension in {".mp4", ".mov", ".webm"}
                    ):
                        extension = url_extension
                    if not extension:
                        raise AppError(
                            ErrorCode.UNSUPPORTED_FORMAT,
                            "Link harus mengarah langsung ke file video MP4, MOV, atau WebM.",
                            422,
                        )
                    path, size, checksum, stored_name = (
                        LocalStorageProvider().save_video_chunks(
                            project_id,
                            response.iter_bytes(),
                            extension,
                        )
                    )
                    original_filename = (
                        Path(urlparse(str(response.url)).path).name
                        or f"video-sumber{extension}"
                    )
                    asset = MediaAsset(
                        project_id=project_id,
                        asset_type="source_video",
                        original_filename=original_filename[:300],
                        stored_filename=stored_name,
                        storage_path=str(path),
                        mime_type=mime_type,
                        size_bytes=size,
                        duration_seconds=None,
                        width=None,
                        height=None,
                        frame_rate=None,
                        audio_sample_rate=None,
                        checksum=checksum,
                    )
                    db.add(asset)
                    transition(project, ProjectStatus.UPLOADED)
                    db.commit()
                    return {"asset_id": asset.id, "size_bytes": size}
        raise AppError(ErrorCode.INVALID_VIDEO, "Terlalu banyak redirect pada URL video.")
    except Exception as exc:
        db.rollback()
        if path:
            path.unlink(missing_ok=True)
        project = db.get(Project, project_id)
        if project:
            project.status = ProjectStatus.FAILED
            db.commit()
        if isinstance(exc, httpx.HTTPError):
            raise AppError(
                ErrorCode.INVALID_VIDEO,
                "Video dari link tidak dapat diunduh.",
                422,
            ) from exc
        raise


@router.post("/projects/{project_id}/voiceover", status_code=201)
async def upload_voiceover(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require(Project, db, project_id)
    path, size, checksum, stored_name = await LocalStorageProvider().save_upload(
        project_id, file, "voiceovers"
    )
    asset = MediaAsset(
        project_id=project_id,
        asset_type="voiceover",
        original_filename=Path(file.filename or "voiceover").name,
        stored_filename=stored_name,
        storage_path=str(path),
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        duration_seconds=None,
        width=None,
        height=None,
        frame_rate=None,
        audio_sample_rate=None,
        checksum=checksum,
    )
    db.add(asset)
    db.commit()
    return {"asset_id": asset.id}


@router.post("/projects/{project_id}/creator-video", status_code=201)
async def upload_creator_video(
    project_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    require(Project, db, project_id)
    path, size, checksum, stored_name = await LocalStorageProvider().save_upload(
        project_id, file, "creator-video"
    )
    asset = MediaAsset(
        project_id=project_id,
        asset_type="creator_video",
        original_filename=Path(file.filename or "creator-video").name,
        stored_filename=stored_name,
        storage_path=str(path),
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size,
        duration_seconds=None,
        width=None,
        height=None,
        frame_rate=None,
        audio_sample_rate=None,
        checksum=checksum,
    )
    db.add(asset)
    db.commit()
    return {"asset_id": asset.id}


@router.post("/projects/{project_id}/process", response_model=JobRead, status_code=202)
def start_processing(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    latest_job = db.scalar(
        select(ProcessingJob)
        .where(ProcessingJob.project_id == project_id)
        .order_by(ProcessingJob.created_at.desc())
    )
    candidate_count = db.scalar(
        select(func.count(ClipCandidate.id)).where(
            ClipCandidate.project_id == project_id
        )
    ) or 0
    timeout_minutes = max(1, get_settings().processing_stale_timeout_minutes)
    stale_processing = is_stale_processing_project(
        project,
        latest_job,
        int(candidate_count),
        timeout_minutes,
    )
    if stale_processing:
        previous_status = str(project.status)
        previous_updated_at = project.updated_at
        active_jobs = list(
            db.scalars(
                select(ProcessingJob).where(
                    ProcessingJob.project_id == project_id,
                    ProcessingJob.status.in_(["queued", "running"]),
                )
            )
        )
        for stale_job in active_jobs:
            stale_job.status = "failed"
            stale_job.error_code = "STALE_PROCESSING_RECOVERED"
            stale_job.error_message = "Job stale digantikan oleh job recovery baru."
            stale_job.completed_at = datetime.now(UTC)
        project.status = ProjectStatus.UPLOADED
        job = ProcessingJob(
            project_id=project_id,
            job_type="full_pipeline",
            status="queued",
            progress=0,
            current_step="Menunggu pemulihan proses",
        )
        db.add(job)
        db.commit()
        logger.warning(
            "stale_processing_project_recovered",
            project_id=str(project.id),
            previous_status=previous_status,
            previous_job_id=str(latest_job.id) if latest_job else None,
            new_job_id=str(job.id),
            updated_at=(
                previous_updated_at.isoformat() if previous_updated_at else None
            ),
            timeout_minutes=timeout_minutes,
        )
        process_project.delay(str(project_id), str(job.id))
        return job
    if ProjectStatus(project.status) in PROCESSING_PROJECT_STATUSES:
        raise HTTPException(status_code=409, detail="Proyek masih diproses.")
    if project.status != ProjectStatus.UPLOADED:
        raise HTTPException(status_code=409, detail="Video belum siap diproses.")
    active_job = db.scalar(
        select(ProcessingJob).where(
            ProcessingJob.project_id == project_id,
            ProcessingJob.status.in_(["queued", "running"]),
        )
    )
    if active_job:
        raise HTTPException(status_code=409, detail="Proyek sedang diproses.")
    job = ProcessingJob(project_id=project_id, job_type="full_pipeline")
    db.add(job)
    db.commit()
    process_project.delay(str(project_id), str(job.id))
    return job


@router.post("/projects/{project_id}/reprocess", response_model=JobRead, status_code=202)
def reprocess_project(
    project_id: uuid.UUID,
    force_reprocess: bool = False,
    db: Session = Depends(get_db),
):
    project = require(Project, db, project_id)
    if (
        get_settings().transcription_provider == "mock"
        and project.content_type != "sports"
    ):
        raise AppError(
            ErrorCode.TRANSCRIPTION_FAILED,
            "Aktifkan provider speech-to-text asli sebelum memproses ulang video.",
            409,
        )
    if not get_source_asset(db, project_id):
        raise AppError(ErrorCode.INVALID_VIDEO, "Video sumber belum tersedia.")
    active_job = db.scalar(
        select(ProcessingJob).where(
            ProcessingJob.project_id == project_id,
            ProcessingJob.status.in_(["queued", "running"]),
        )
    )
    if active_job:
        raise HTTPException(status_code=409, detail="Proyek sedang diproses.")

    project.status = ProjectStatus.UPLOADED
    job = ProcessingJob(project_id=project_id, job_type="full_pipeline")
    db.add(job)
    db.commit()
    process_project.delay(str(project_id), str(job.id), force_reprocess)
    return job


@router.get("/projects/{project_id}/status")
def project_status(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    job = db.scalar(
        select(ProcessingJob)
        .where(ProcessingJob.project_id == project_id)
        .order_by(ProcessingJob.created_at.desc())
    )
    candidate_count = db.scalar(
        select(func.count(ClipCandidate.id)).where(
            ClipCandidate.project_id == project_id
        )
    ) or 0
    stale_processing = is_stale_processing_project(
        project,
        job,
        int(candidate_count),
        max(1, get_settings().processing_stale_timeout_minutes),
    )
    return {
        "project_id": project.id,
        "job_id": job.id if job else None,
        "status": project.status,
        "progress": job.progress if job else 0,
        "current_step": job.current_step if job else "Belum diproses",
        "error_code": job.error_code if job else None,
        "error_message": job.error_message if job else None,
        "is_stale": stale_processing,
        "recovery_available": stale_processing,
    }


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: uuid.UUID, db: Session = Depends(get_db)):
    return require(ProcessingJob, db, job_id)


@router.post("/jobs/{job_id}/retry", response_model=JobRead, status_code=202)
def retry_job(job_id: uuid.UUID, db: Session = Depends(get_db)):
    job = require(ProcessingJob, db, job_id)
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Hanya job gagal yang dapat diulang.")
    project = require(Project, db, job.project_id)
    project.status = ProjectStatus.UPLOADED
    job.status = "queued"
    job.progress = 0
    job.retry_count += 1
    job.error_code = None
    job.error_message = None
    db.commit()
    process_project.delay(str(project.id), str(job.id))
    return job


@router.get("/projects/{project_id}/transcript")
def transcript(project_id: uuid.UUID, db: Session = Depends(get_db)):
    require(Project, db, project_id)
    return list(
        db.scalars(
            select(TranscriptSegment)
            .where(TranscriptSegment.project_id == project_id)
            .order_by(TranscriptSegment.segment_index)
        )
    )


@router.get("/projects/{project_id}/source-file")
def source_file(project_id: uuid.UUID, db: Session = Depends(get_db)):
    require(Project, db, project_id)
    asset = db.scalar(
        select(MediaAsset).where(
            MediaAsset.project_id == project_id,
            MediaAsset.asset_type == "source_video",
        )
    )
    if not asset or not Path(asset.storage_path).is_file():
        raise HTTPException(status_code=404, detail="Video sumber tidak tersedia.")
    return FileResponse(asset.storage_path, media_type=asset.mime_type)


@router.get("/candidates/{candidate_id}/source-file")
def candidate_source_file(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    candidate = require(ClipCandidate, db, candidate_id)
    if not candidate.short_source_clip_path or not Path(candidate.short_source_clip_path).is_file():
        candidate.file_missing = True
        db.commit()
        raise HTTPException(status_code=404, detail="File short clip tidak tersedia.")
    return FileResponse(candidate.short_source_clip_path, media_type="video/mp4")


@router.get("/candidates/{candidate_id}/thumbnail")
def candidate_thumbnail(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    candidate = require(ClipCandidate, db, candidate_id)
    if not candidate.clip_thumbnail_path or not Path(candidate.clip_thumbnail_path).is_file():
        raise HTTPException(status_code=404, detail="Thumbnail klip tidak tersedia.")
    return FileResponse(candidate.clip_thumbnail_path, media_type="image/jpeg")


def clip_read(candidate: ClipCandidate, db: Session) -> dict:
    plan = db.scalar(
        select(TransformationPlan)
        .where(TransformationPlan.candidate_id == candidate.id)
        .order_by(TransformationPlan.created_at.desc())
    )
    preview = None
    final = None
    if plan:
        preview = db.scalar(
            select(Render)
            .where(
                Render.transformation_plan_id == plan.id,
                Render.preview_path.is_not(None),
            )
            .order_by(Render.created_at.desc())
        )
        final = db.scalar(
            select(Render)
            .where(
                Render.transformation_plan_id == plan.id,
                Render.output_path.is_not(None),
            )
            .order_by(Render.created_at.desc())
        )
    return {
        **CandidateRead.model_validate(candidate).model_dump(),
        "candidate_id": candidate.id,
        "job_id": candidate.project_id,
        "clip_id": candidate.id,
        "transformation_id": plan.id if plan else None,
        "preview_render_id": preview.id if preview else None,
        "preview_status": preview.status if preview else None,
        "final_render_id": final.id if final else None,
        "final_status": final.status if final else None,
        "final_file_size_bytes": final.file_size_bytes if final else None,
    }


@router.get("/projects/{project_id}/candidates", response_model=list[CandidateRead])
def candidates(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    items = list(
        db.scalars(
            select(ClipCandidate)
            .where(ClipCandidate.project_id == project_id)
            .order_by(ClipCandidate.rank)
        )
    )
    changed = False
    for candidate in items:
        if needs_candidate_copy_refresh(
            candidate.suggested_title,
            candidate.suggested_hook,
        ):
            generated = generate_candidate_copy(
                project.content_type,
                candidate.transcript_text,
                candidate.rank,
                project.title,
                use_ai=False,
            )
            candidate.suggested_title = generated["title"]
            candidate.suggested_hook = generated["hook"]
            changed = True
    if changed:
        db.commit()
    return items


@router.get("/projects/{project_id}/clips", response_model=list[ProjectClipRead])
def project_clips(project_id: uuid.UUID, db: Session = Depends(get_db)):
    require(Project, db, project_id)
    items = list(
        db.scalars(
            select(ClipCandidate)
            .where(ClipCandidate.project_id == project_id)
            .order_by(ClipCandidate.rank)
            .limit(get_settings().max_saved_top_clips)
        )
    )
    return [clip_read(candidate, db) for candidate in items]


@router.get("/jobs/{project_id}/clips", response_model=list[ProjectClipRead])
def job_clips(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return project_clips(project_id, db)


@router.get("/candidates/{candidate_id}", response_model=CandidateRead)
def get_candidate(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    return require(ClipCandidate, db, candidate_id)


@router.patch("/candidates/{candidate_id}", response_model=CandidateRead)
def patch_candidate(
    candidate_id: uuid.UUID, payload: CandidatePatch, db: Session = Depends(get_db)
):
    candidate = require(ClipCandidate, db, candidate_id)
    source = db.scalar(
        select(MediaAsset).where(
            MediaAsset.project_id == candidate.project_id,
            MediaAsset.asset_type == "source_video",
        )
    )
    duration = payload.end_seconds - payload.start_seconds
    project = require(Project, db, candidate.project_id)
    minimum_duration = 12 if project.content_type == "sports" else 20
    if payload.start_seconds >= payload.end_seconds or not minimum_duration <= duration <= 60:
        raise HTTPException(
            status_code=422,
            detail=f"Durasi kandidat harus {minimum_duration}-60 detik.",
        )
    if source and source.duration_seconds and payload.end_seconds > source.duration_seconds:
        raise HTTPException(status_code=422, detail="Timestamp melebihi durasi video.")
    candidate.start_seconds = payload.start_seconds
    candidate.end_seconds = payload.end_seconds
    candidate.duration_seconds = duration
    db.commit()
    return candidate


@router.patch("/candidates/{candidate_id}/title", response_model=CandidateRead)
def patch_candidate_title(
    candidate_id: uuid.UUID,
    payload: CandidateTitlePatch,
    db: Session = Depends(get_db),
):
    candidate = require(ClipCandidate, db, candidate_id)
    candidate.suggested_title = payload.suggested_title.strip()
    db.commit()
    return candidate


@router.post("/candidates/{candidate_id}/regenerate-copy", response_model=CandidateRead)
def regenerate_candidate_copy(
    candidate_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    candidate = require(ClipCandidate, db, candidate_id)
    project = require(Project, db, candidate.project_id)
    generated = generate_candidate_copy(
        project.content_type,
        candidate.transcript_text,
        candidate.rank,
        project.title,
    )
    candidate.suggested_title = generated["title"]
    candidate.suggested_hook = generated["hook"]
    db.commit()
    return candidate


def get_or_create_transformation(
    candidate: ClipCandidate,
    db: Session,
    purpose: str = "analysis",
    audience: str = "Kreator konten Indonesia",
) -> tuple[TransformationPlan, bool]:
    existing = db.scalar(
        select(TransformationPlan)
        .where(TransformationPlan.candidate_id == candidate.id)
        .order_by(TransformationPlan.created_at.desc())
    )
    if existing:
        candidate.selected = True
        db.commit()
        return existing, False

    candidate.selected = True
    project = require(Project, db, candidate.project_id)
    declaration = project.source_declaration
    if not declaration:
        raise HTTPException(status_code=409, detail="Deklarasi sumber tidak tersedia.")
    source_asset = get_source_asset(db, project.id)
    mismatch_warning = source_mismatch_warning(
        source_asset.original_filename if source_asset else None,
        declaration.source_title,
    )
    transformation_started = perf_counter()
    transformation_provider = get_ai_provider()
    logger.info(
        "ai_call_started",
        ai_call_type="transformation_generation",
        provider=transformation_provider.__class__.__name__,
        model=get_settings().ai_model or "default",
        project_id=str(project.id),
        candidate_id=str(candidate.id),
        retry_count=0,
        **estimate_ai_usage(
            "transformation_generation",
            transformation_provider.__class__.__name__,
            get_settings().ai_model or "default",
        ),
    )
    generated = transformation_provider.transformation(
        candidate,
        purpose,
        audience,
        declaration.source_description if not mismatch_warning else None,
        declaration.source_title,
        source_asset.original_filename if source_asset else None,
    )
    generated.pop("storyboard", None)
    style_config = default_clipper_style("clean_podcast")
    style_config["hook_text"] = generate_hook_text_for_clip(
        candidate.transcript_text,
        candidate.suggested_title or project.title,
        candidate.rank,
        candidate.suggested_hook,
    )
    plan = TransformationPlan(
        project_id=project.id,
        candidate_id=candidate.id,
        purpose=purpose,
        audience=audience,
        storyboard=[],
        clipper_style_config=style_config,
        **generated,
    )
    plan.needs_fact_verification = bool(mismatch_warning)
    plan.social_caption = generate_social_caption(
        project,
        declaration,
        plan,
        candidate,
        caption_content_title(declaration, source_asset),
        include_source_context=not mismatch_warning,
    )
    db.add(plan)
    logger.info(
        "ai_call_completed",
        ai_call_type="transformation_generation",
        provider=transformation_provider.__class__.__name__,
        model=get_settings().ai_model or "default",
        project_id=str(project.id),
        candidate_id=str(candidate.id),
        request_duration_ms=round((perf_counter() - transformation_started) * 1000),
        cache_hit=False,
        **estimate_ai_usage(
            "transformation_generation",
            transformation_provider.__class__.__name__,
            get_settings().ai_model or "default",
        ),
    )
    if project.status == ProjectStatus.CANDIDATES_READY:
        transition(project, ProjectStatus.TRANSFORMATION_DRAFT)
    elif project.status not in {
        ProjectStatus.READY_TO_RENDER,
        ProjectStatus.PREVIEW_READY,
        ProjectStatus.COMPLETED,
    }:
        project.status = ProjectStatus.TRANSFORMATION_DRAFT
    db.commit()
    return plan, True


def create_manual_editor_resources(
    project: Project,
    source_asset: MediaAsset,
    db: Session,
) -> tuple[ClipCandidate, TransformationPlan, float]:
    source_path = Path(source_asset.storage_path)
    if not source_path.is_file():
        raise HTTPException(
            status_code=409,
            detail="File video sumber tidak ditemukan. Upload atau link ulang video terlebih dahulu.",
        )

    metadata = probe_media(source_path)
    duration = round(float(metadata.duration), 3)
    source_asset.duration_seconds = duration
    source_asset.width = metadata.width
    source_asset.height = metadata.height
    source_asset.frame_rate = metadata.frame_rate
    source_asset.audio_sample_rate = metadata.audio_sample_rate

    candidate = db.scalar(
        select(ClipCandidate)
        .where(
            ClipCandidate.project_id == project.id,
            ClipCandidate.category == "manual_editor",
        )
        .order_by(ClipCandidate.created_at.desc())
    )
    if not candidate:
        candidate = ClipCandidate(
            project_id=project.id,
            start_seconds=0,
            end_seconds=duration,
            duration_seconds=duration,
            transcript_text="",
            suggested_title="Video Utama",
            suggested_hook="",
            summary="Video utama untuk mode edit manual.",
            category="manual_editor",
            hook_score=0,
            context_score=0,
            information_score=0,
            emotion_score=0,
            fluency_score=0,
            duration_score=0,
            discussion_score=0,
            viral_potential_score=0,
            reasons_json=["Diimpor langsung ke editor"],
            risks_json=[],
            rank=1,
            selected=True,
            short_source_clip_path=str(source_path),
            file_missing=False,
        )
        db.add(candidate)
        db.flush()
    else:
        candidate.end_seconds = duration
        candidate.duration_seconds = duration
        candidate.short_source_clip_path = str(source_path)
        candidate.file_missing = False
        candidate.selected = True

    plan = db.scalar(
        select(TransformationPlan)
        .where(TransformationPlan.candidate_id == candidate.id)
        .order_by(TransformationPlan.created_at.desc())
    )
    if not plan:
        sequence = [{"id": "manual-video-1", "source_start": 0.0, "source_end": duration}]
        style_config = default_clipper_style("clean_podcast")
        style_config.update(
            {
                "manual_editor_mode": True,
                "editor_state_version": 1,
                "video_sequence_initialized": True,
                "audio_sequence_initialized": True,
                "caption_timeline_initialized": True,
                "effect_timeline_initialized": True,
                "video_sequence": sequence,
                "audio_sequence": [],
                "media_sequence": sequence,
                "media_trim": {"start": 0.0, "end": duration},
                "audio_extracted": False,
                "video_track_deleted": False,
                "audio_track_deleted": False,
                "caption_timeline": [],
                "effect_timeline": [],
                "hook_text": "",
                "hook_text_enabled": False,
                "keyword_popup_enabled": False,
                "punch_zoom_enabled": False,
                "pattern_interrupt_enabled": False,
                "layer_order": ["caption", "hook", "keyword", "video"],
                "track_order": [
                    "caption",
                    "hook",
                    "keyword",
                    "video",
                    "audio",
                    "punch",
                    "pattern",
                ],
                "additional_audio_assets": [],
                "additional_audio_tracks": [],
            }
        )
        plan = TransformationPlan(
            project_id=project.id,
            candidate_id=candidate.id,
            purpose="other",
            new_angle="Edit manual video utama.",
            audience="Editor manual",
            original_hook="",
            commentary_script="",
            conclusion="",
            engagement_question="",
            social_caption="",
            clipper_style_config=style_config,
            needs_fact_verification=False,
            status="draft",
            storyboard=[],
        )
        db.add(plan)
        db.flush()
        logger.info(
            "manual_editor_editor_state_created",
            project_id=str(project.id),
            candidate_id=str(candidate.id),
            transformation_id=str(plan.id),
            duration=duration,
        )

    project.status = ProjectStatus.TRANSFORMATION_DRAFT
    project.transcript_provider = "manual_skipped"
    project.transcript_language = None
    db.commit()
    return candidate, plan, duration


@router.post(
    "/projects/{project_id}/manual-editor",
    response_model=ManualEditorRead,
    status_code=201,
)
def create_manual_editor(
    project_id: uuid.UUID,
    response: Response,
    db: Session = Depends(get_db),
):
    project = require(Project, db, project_id)
    source_asset = get_source_asset(db, project.id)
    if not source_asset:
        raise HTTPException(status_code=409, detail="Upload atau link video sumber terlebih dahulu.")

    existing_candidate = db.scalar(
        select(ClipCandidate).where(
            ClipCandidate.project_id == project.id,
            ClipCandidate.category == "manual_editor",
        )
    )
    candidate, plan, duration = create_manual_editor_resources(project, source_asset, db)
    response.status_code = 200 if existing_candidate else 201
    logger.info(
        "manual_editor_project_created",
        project_id=str(project.id),
        candidate_id=str(candidate.id),
        transformation_id=str(plan.id),
        reused=bool(existing_candidate),
    )
    logger.info(
        "manual_editor_source_ready",
        project_id=str(project.id),
        source_asset_id=str(source_asset.id),
        source_path=source_asset.storage_path,
        duration=duration,
    )
    logger.info(
        "manual_editor_ai_skipped",
        project_id=str(project.id),
        transcription_skipped=True,
        candidate_generation_skipped=True,
        openai_skipped=True,
        groq_skipped=True,
    )
    return {
        "project_id": project.id,
        "candidate_id": candidate.id,
        "transformation_id": plan.id,
        "editor_url": f"/transformations/{plan.id}",
        "status": "ready_for_edit",
        "duration": duration,
        "source_asset_id": source_asset.id,
        "source_filename": source_asset.original_filename,
    }


def create_blank_manual_editor_resources(
    project: Project,
    db: Session,
) -> tuple[ClipCandidate, TransformationPlan, float]:
    style_config = default_clipper_style("clean_podcast")
    style_config.update(
        {
            "manual_editor_mode": True,
            "editor_state_version": 1,
            "video_sequence_initialized": True,
            "audio_sequence_initialized": True,
            "caption_timeline_initialized": True,
            "effect_timeline_initialized": True,
            "video_sequence": [],
            "audio_sequence": [],
            "media_sequence": [],
            "media_trim": {"start": 0.0, "end": None},
            "audio_extracted": False,
            "video_track_deleted": False,
            "audio_track_deleted": False,
            "caption_timeline": [],
            "effect_timeline": [],
            "hook_text": "",
            "hook_text_enabled": False,
            "keyword_popup_enabled": False,
            "punch_zoom_enabled": False,
            "pattern_interrupt_enabled": False,
            "layer_order": [
                "caption",
                "hook",
                "keyword",
                "punch",
                "pattern",
                "video",
                "audio",
            ],
            "track_order": [
                "caption",
                "hook",
                "keyword",
                "video",
                "audio",
                "punch",
                "pattern",
            ],
            "additional_audio_assets": [],
            "additional_audio_tracks": [],
            "editor_image_assets": [],
        }
    )
    candidate = ClipCandidate(
        project_id=project.id,
        start_seconds=0,
        end_seconds=0,
        duration_seconds=0,
        transcript_text="",
        suggested_title="Editor Manual",
        suggested_hook="",
        summary="Editor manual langsung dari beranda.",
        category="manual_editor",
        hook_score=0,
        context_score=0,
        information_score=0,
        emotion_score=0,
        fluency_score=0,
        duration_score=0,
        discussion_score=0,
        viral_potential_score=0,
        reasons_json=["Dibuat langsung sebagai editor manual"],
        risks_json=[],
        rank=1,
        selected=True,
        short_source_clip_path=None,
        file_missing=False,
    )
    db.add(candidate)
    db.flush()
    plan = TransformationPlan(
        project_id=project.id,
        candidate_id=candidate.id,
        purpose="other",
        new_angle="Edit manual video utama.",
        audience="Editor manual",
        original_hook="",
        commentary_script="",
        conclusion="",
        engagement_question="",
        social_caption="",
        clipper_style_config=style_config,
        needs_fact_verification=False,
        status="draft",
        storyboard=[],
    )
    db.add(plan)
    db.commit()
    logger.info(
        "manual_editor_blank_created",
        project_id=str(project.id),
        candidate_id=str(candidate.id),
        transformation_id=str(plan.id),
    )
    return candidate, plan, 0.0


@router.post(
    "/projects/manual-editor/blank",
    response_model=BlankManualEditorRead,
    status_code=200,
)
def create_blank_manual_editor(db: Session = Depends(get_db)):
    project = Project(
        title="Editor Manual",
        description=None,
        content_type="podcast",
        status=ProjectStatus.TRANSFORMATION_DRAFT,
        transcript_provider="manual_skipped",
        transcript_language=None,
        deleted_at=None,
    )
    db.add(project)
    db.commit()
    _candidate, plan, _duration = create_blank_manual_editor_resources(project, db)
    return {
        "project_id": project.id,
        "transformation_id": plan.id,
        "editor_url": f"/transformations/{plan.id}",
        "status": "transformation_draft",
    }


@router.post("/candidates/{candidate_id}/select", response_model=CandidateSelectionRead)
def select_candidate(
    candidate_id: uuid.UUID,
    response: Response,
    db: Session = Depends(get_db),
):
    candidate = require(ClipCandidate, db, candidate_id)
    plan, created = get_or_create_transformation(candidate, db)
    response.status_code = 201 if created else 200
    return {
        "candidate_id": candidate.id,
        "job_id": candidate.project_id,
        "clip_id": candidate.id,
        "transformation_id": plan.id,
        "status": "created" if created else "existing",
        "message": "Editor klip dibuat." if created else "Editor klip yang sudah ada dibuka.",
    }


@router.post(
    "/candidates/{candidate_id}/transformation",
    response_model=TransformationRead,
    status_code=201,
)
def create_transformation(
    candidate_id: uuid.UUID,
    payload: TransformationCreate,
    db: Session = Depends(get_db),
):
    candidate = require(ClipCandidate, db, candidate_id)
    plan, _ = get_or_create_transformation(
        candidate,
        db,
        payload.purpose,
        payload.audience,
    )
    return plan


@router.get("/transformations/{transformation_id}", response_model=TransformationRead)
def get_transformation(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    plan = require(TransformationPlan, db, transformation_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    current_config = normalize_clipper_style(
        plan.clipper_style_config or default_clipper_style("clean_podcast"),
        plan.original_hook,
    )
    if not current_config.get("manual_editor_mode") and is_generic_hook(
        current_config.get("hook_text")
    ):
        current_config["hook_text"] = generate_hook_text_for_clip(
            candidate.transcript_text,
            candidate.suggested_title,
            candidate.rank,
            candidate.suggested_hook,
        )
    if current_config != plan.clipper_style_config:
        plan.clipper_style_config = current_config
        db.commit()
    return plan


@router.post("/transformations/{transformation_id}/audio-assets", status_code=201)
async def upload_transformation_audio_asset(
    transformation_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".mp3", ".wav", ".m4a"}:
        raise HTTPException(status_code=415, detail="Gunakan file audio MP3, WAV, atau M4A.")
    path, size, _checksum, stored_name = await LocalStorageProvider().save_upload(
        plan.project_id,
        file,
        kind="audio-library",
    )
    if size > 50 * 1024 * 1024:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="Ukuran audio maksimal 50 MB.")
    try:
        duration = max(0.1, float(probe_media(path).duration_seconds))
    except Exception:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="File audio tidak dapat dibaca.") from None
    return {
        "id": Path(stored_name).stem,
        "name": Path(file.filename or "audio").name,
        "mime_type": file.content_type or "application/octet-stream",
        "size_bytes": size,
        "duration_seconds": round(duration, 3),
    }


@router.get("/transformations/{transformation_id}/audio-assets/{asset_id}")
def transformation_audio_asset(
    transformation_id: uuid.UUID,
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    folder = LocalStorageProvider().resolve(f"{plan.project_id}/audio-library")
    matches = list(folder.glob(f"{asset_id}.*")) if folder.is_dir() else []
    if not matches or matches[0].suffix.lower() not in {".mp3", ".wav", ".m4a"}:
        raise HTTPException(status_code=404, detail="Aset audio tidak tersedia.")
    media_type = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
    }[matches[0].suffix.lower()]
    return FileResponse(matches[0], media_type=media_type)


def _serialize_editor_asset(transformation_id: uuid.UUID, asset: MediaAsset) -> EditorMediaAssetRead:
    kind = (asset.asset_type or "video").replace("editor_", "")
    return EditorMediaAssetRead(
        asset_id=str(asset.id),
        kind=kind,
        name=asset.original_filename,
        url=f"/api/transformations/{transformation_id}/media/{asset.id}",
        duration_seconds=asset.duration_seconds,
        width=asset.width,
        height=asset.height,
        size_bytes=asset.size_bytes,
        mime_type=asset.mime_type or "application/octet-stream",
    )


@router.get("/transformations/{transformation_id}/media", response_model=list[EditorMediaAssetRead])
def list_transformation_media(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    plan = require(TransformationPlan, db, transformation_id)
    assets = list(
        db.scalars(
            select(MediaAsset).where(
                MediaAsset.project_id == plan.project_id,
                MediaAsset.asset_type.like("editor_%"),
            )
        )
    )
    return [_serialize_editor_asset(transformation_id, asset) for asset in assets]


@router.post(
    "/transformations/{transformation_id}/media",
    response_model=EditorMediaAssetRead,
    status_code=201,
)
async def upload_transformation_media(
    transformation_id: uuid.UUID,
    file: UploadFile = File(...),
    kind: str = Form("video"),
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    if kind not in {"video", "audio", "image"}:
        raise HTTPException(status_code=400, detail="Jenis media tidak didukung.")
    path, size, _checksum, stored_name = await LocalStorageProvider().save_media_upload(
        plan.project_id, file, kind
    )
    duration = None
    width = None
    height = None
    if kind in {"video", "audio"}:
        try:
            metadata = probe_media(path)
            duration = float(metadata.duration) if metadata.duration else None
            width = metadata.width
            height = metadata.height
        except Exception as exc:
            logger.warning(
                "transformation_media_probe_failed",
                transformation_id=str(transformation_id),
                kind=kind,
                error=str(exc),
            )
    asset = MediaAsset(
        project_id=plan.project_id,
        asset_type=f"editor_{kind}",
        original_filename=Path(file.filename or "media").name,
        stored_filename=stored_name,
        storage_path=str(path),
        mime_type=(file.content_type or "application/octet-stream"),
        size_bytes=size,
        duration_seconds=duration,
        width=width,
        height=height,
        checksum="",
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _serialize_editor_asset(transformation_id, asset)


@router.get("/transformations/{transformation_id}/media/{asset_id}")
def transformation_media_asset(
    transformation_id: uuid.UUID,
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    asset = db.get(MediaAsset, asset_id)
    if not asset or asset.project_id != plan.project_id or not asset.asset_type.startswith("editor_"):
        raise HTTPException(status_code=404, detail="Aset media tidak tersedia.")
    media_path = Path(asset.storage_path)
    if not media_path.is_file():
        raise HTTPException(status_code=404, detail="File media tidak tersedia.")
    return FileResponse(media_path, media_type=asset.mime_type or "application/octet-stream")


@router.post("/transformations/{transformation_id}/media/{asset_id}/add-to-timeline")
def add_media_to_timeline(
    transformation_id: uuid.UUID,
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    asset = db.get(MediaAsset, asset_id)
    if not asset or asset.project_id != plan.project_id or not asset.asset_type.startswith("editor_"):
        raise HTTPException(status_code=404, detail="Aset media tidak tersedia.")
    kind = asset.asset_type.replace("editor_", "")
    current_config = dict(plan.clipper_style_config or {})
    current_config["manual_editor_mode"] = True

    if kind == "video":
        candidate = require(ClipCandidate, db, plan.candidate_id)
        candidate.short_source_clip_path = asset.storage_path
        duration = max(0.1, float(asset.duration_seconds or 0.1))
        candidate.duration_seconds = duration
        sequence = [
            {
                "id": "manual-video-1",
                "source_start": 0.0,
                "source_end": round(duration, 3),
            }
        ]
        current_config.update(
            video_sequence=sequence,
            media_sequence=sequence,
            media_trim={"start": 0.0, "end": round(duration, 3)},
            video_sequence_initialized=True,
            audio_sequence_initialized=True,
            video_track_deleted=False,
        )
    elif kind == "audio":
        assets = list(current_config.get("additional_audio_assets") or [])
        assets.append(
            {
                "id": str(asset.id),
                "name": asset.original_filename,
                "mime_type": asset.mime_type,
                "size_bytes": asset.size_bytes,
                "duration_seconds": asset.duration_seconds or 0,
            }
        )
        current_config["additional_audio_assets"] = assets
        tracks = list(current_config.get("additional_audio_tracks") or [])
        audio_duration = max(0.1, float(asset.duration_seconds or 0.1))
        tracks.append(
            {
                "id": f"additional-audio-{asset.id}",
                "asset_id": str(asset.id),
                "label": "Backsound",
                "kind": "backsound",
                "start": 0.0,
                "end": round(audio_duration, 3),
                "volume": 1,
            }
        )
        current_config["additional_audio_tracks"] = tracks
    else:
        assets = list(current_config.get("editor_image_assets") or [])
        assets.append(
            {
                "id": str(asset.id),
                "name": asset.original_filename,
                "url": f"/api/transformations/{transformation_id}/media/{asset.id}",
                "kind": "image",
            }
        )
        current_config["editor_image_assets"] = assets

    plan.clipper_style_config = current_config
    db.commit()
    return plan


@router.get(
    "/transformations/{transformation_id}/context",
    response_model=TransformationContextRead,
)
def transformation_context(
    transformation_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    project = require(Project, db, plan.project_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    declaration = project.source_declaration
    source_asset = get_source_asset(db, project.id)
    transcription_provider = (
        project.transcript_provider or get_settings().transcription_provider
    )
    configured_transcription_provider = get_settings().transcription_provider
    caption_segments = list(
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
    caption_cues = [
        {
            "start": round(max(0.0, segment.start_seconds - candidate.start_seconds), 3),
            "end": round(
                min(candidate.duration_seconds, segment.end_seconds - candidate.start_seconds),
                3,
            ),
            "text": segment.text,
        }
        for segment in caption_segments
        if segment.end_seconds > segment.start_seconds
    ]
    return {
        "project_title": project.title,
        "content_type": project.content_type,
        "source_title": declaration.source_title if declaration else None,
        "source_creator": declaration.source_creator if declaration else None,
        "source_url": declaration.source_url if declaration else None,
        "uploaded_filename": source_asset.original_filename if source_asset else None,
        "clip_start_seconds": candidate.start_seconds,
        "clip_end_seconds": candidate.end_seconds,
        "clip_duration_seconds": candidate.duration_seconds,
        "candidate_title": candidate.suggested_title,
        "candidate_transcript": candidate.transcript_text,
        "caption_cues": caption_cues,
        "transcription_provider": transcription_provider,
        "configured_transcription_provider": configured_transcription_provider,
        "transcription_language": project.transcript_language,
        "transcription_is_demo": transcription_provider == "mock",
        "source_mismatch_warning": source_mismatch_warning(
            source_asset.original_filename if source_asset else None,
            declaration.source_title if declaration else None,
        ),
    }


@router.post(
    "/transformations/{transformation_id}/source-metadata",
    response_model=SourceMetadataRead,
)
def apply_transformation_source_metadata(
    transformation_id: uuid.UUID,
    payload: SourceMetadataRequest,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    project = require(Project, db, plan.project_id)
    declaration = project.source_declaration
    if not declaration:
        raise HTTPException(status_code=409, detail="Deklarasi sumber tidak tersedia.")

    metadata = inspect_source(payload)
    declaration.source_url = metadata["url"]
    declaration.source_creator = (
        metadata["creator"] or metadata["site_name"] or declaration.source_creator
    )
    declaration.source_title = metadata["title"] or declaration.source_title
    declaration.source_description = (
        metadata["description"] or declaration.source_description
    )
    if declaration.ownership_type == "unknown":
        declaration.ownership_type = "third_party_commentary"
    db.commit()
    return metadata


@router.post(
    "/transformations/{transformation_id}/regenerate",
    response_model=TransformationRead,
)
def regenerate_transformation(
    transformation_id: uuid.UUID,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    project = require(Project, db, plan.project_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    declaration = project.source_declaration
    if not declaration:
        raise HTTPException(status_code=409, detail="Deklarasi sumber tidak tersedia.")
    source_asset = get_source_asset(db, project.id)
    mismatch_warning = source_mismatch_warning(
        source_asset.original_filename if source_asset else None,
        declaration.source_title,
    )
    transformation_started = perf_counter()
    transformation_provider = get_ai_provider()
    logger.info(
        "ai_call_started",
        ai_call_type="transformation_generation",
        provider=transformation_provider.__class__.__name__,
        model=get_settings().ai_model or "default",
        project_id=str(project.id),
        candidate_id=str(candidate.id),
        transformation_id=str(plan.id),
        retry_count=0,
        **estimate_ai_usage(
            "transformation_generation",
            transformation_provider.__class__.__name__,
            get_settings().ai_model or "default",
        ),
    )
    generated = transformation_provider.transformation(
        candidate,
        plan.purpose,
        plan.audience,
        declaration.source_description if not mismatch_warning else None,
        declaration.source_title,
        source_asset.original_filename if source_asset else None,
    )
    generated.pop("storyboard", None)
    for key, value in generated.items():
        setattr(plan, key, value)
    plan.storyboard = []
    plan.needs_fact_verification = bool(mismatch_warning)
    plan.social_caption = generate_social_caption(
        project,
        declaration,
        plan,
        candidate,
        caption_content_title(declaration, source_asset),
        include_source_context=not mismatch_warning,
    )
    logger.info(
        "ai_call_completed",
        ai_call_type="transformation_generation",
        provider=transformation_provider.__class__.__name__,
        model=get_settings().ai_model or "default",
        project_id=str(project.id),
        candidate_id=str(candidate.id),
        transformation_id=str(plan.id),
        request_duration_ms=round((perf_counter() - transformation_started) * 1000),
        cache_hit=False,
        **estimate_ai_usage(
            "transformation_generation",
            transformation_provider.__class__.__name__,
            get_settings().ai_model or "default",
        ),
    )
    db.execute(
        delete(OriginalityReport).where(
            OriginalityReport.transformation_plan_id == transformation_id
        )
    )
    db.execute(
        update(Render)
        .where(
            Render.transformation_plan_id == transformation_id,
            Render.status.in_(["queued", "running", "completed"]),
        )
        .values(status="superseded")
    )
    project.status = ProjectStatus.TRANSFORMATION_DRAFT
    db.commit()
    return plan


@router.get(
    "/projects/{project_id}/latest-transformation",
    response_model=TransformationRead,
)
def latest_transformation(project_id: uuid.UUID, db: Session = Depends(get_db)):
    require(Project, db, project_id)
    plan = db.scalar(
        select(TransformationPlan)
        .where(TransformationPlan.project_id == project_id)
        .order_by(TransformationPlan.created_at.desc())
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Transformasi belum tersedia.")
    return plan


@router.patch("/transformations/{transformation_id}", response_model=TransformationRead)
def patch_transformation(
    transformation_id: uuid.UUID,
    payload: TransformationPatch,
    db: Session = Depends(get_db),
):
    plan = require(TransformationPlan, db, transformation_id)
    previous_style_config = plan.clipper_style_config or {}
    changes = payload.model_dump(exclude_unset=True)
    if "clipper_style_config" in changes:
        style_config = normalize_clipper_style(
            changes["clipper_style_config"],
            plan.original_hook,
        )
        if is_generic_hook(style_config.get("hook_text")):
            candidate = require(ClipCandidate, db, plan.candidate_id)
            style_config["hook_text"] = generate_hook_text_for_clip(
                candidate.transcript_text,
                candidate.suggested_title,
                candidate.rank,
            )
        changes["clipper_style_config"] = style_config
    affects_output = any(getattr(plan, key) != value for key, value in changes.items())
    for key, value in changes.items():
        setattr(plan, key, value)
    if affects_output:
        next_style_config = changes.get("clipper_style_config", previous_style_config)
        previous_framing = normalize_video_framing(previous_style_config.get("video_framing"))
        next_framing = normalize_video_framing(next_style_config.get("video_framing"))
        framing_changed = previous_framing != next_framing
        logger.info(
            "render_cache_invalidated",
            message=(
                "render invalidated because video_framing changed"
                if framing_changed
                else "render invalidated because transformation output changed"
            ),
            transformation_id=str(transformation_id),
            previous_video_framing=previous_framing,
            video_framing=next_framing,
        )
        db.execute(
            delete(OriginalityReport).where(
                OriginalityReport.transformation_plan_id == transformation_id
            )
        )
        db.execute(
            update(Render)
            .where(
                Render.transformation_plan_id == transformation_id,
                Render.status.in_(["queued", "running", "completed"]),
            )
            .values(status="superseded")
        )
        project = require(Project, db, plan.project_id)
        project.status = ProjectStatus.TRANSFORMATION_DRAFT
    db.commit()
    return plan


@router.post(
    "/transformations/{transformation_id}/regenerate-hook",
    response_model=HookTextRead,
)
def regenerate_hook_text(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    plan = require(TransformationPlan, db, transformation_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    config = normalize_clipper_style(plan.clipper_style_config)
    hook_text = generate_hook_text_for_clip(
        candidate.transcript_text,
        candidate.suggested_title,
        candidate.rank,
    )
    config["hook_text"] = hook_text
    plan.clipper_style_config = config
    db.execute(
        update(Render)
        .where(
            Render.transformation_plan_id == transformation_id,
            Render.status.in_(["queued", "running", "completed"]),
        )
        .values(status="superseded")
    )
    db.commit()
    return {"transformation_id": plan.id, "hook_text": hook_text}


@router.post(
    "/transformations/{transformation_id}/caption",
    response_model=TransformationRead,
)
def regenerate_caption(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    plan = require(TransformationPlan, db, transformation_id)
    project = require(Project, db, plan.project_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    declaration = project.source_declaration
    if not declaration:
        raise HTTPException(status_code=409, detail="Deklarasi sumber tidak tersedia.")
    source_asset = get_source_asset(db, project.id)
    mismatch_warning = source_mismatch_warning(
        source_asset.original_filename if source_asset else None,
        declaration.source_title,
    )
    plan.social_caption = generate_social_caption(
        project,
        declaration,
        plan,
        candidate,
        caption_content_title(declaration, source_asset),
        include_source_context=not mismatch_warning,
    )
    db.commit()
    return plan


@router.post(
    "/transformations/{transformation_id}/auto-captions",
    response_model=EditorAutoCaptionResponse,
)
def generate_auto_captions(
    transformation_id: uuid.UUID,
    payload: EditorAutoCaptionRequest,
    db: Session = Depends(get_db),
):
    return generate_editor_auto_captions(
        db=db,
        transformation_id=transformation_id,
        language=payload.language,
        delete_current_captions=payload.delete_current_captions,
        identify_filler_words=payload.identify_filler_words,
        bilingual=payload.bilingual,
    )


@router.patch(
    "/transformations/{transformation_id}/storyboard", response_model=TransformationRead
)
def patch_storyboard(
    transformation_id: uuid.UUID, storyboard: list[dict], db: Session = Depends(get_db)
):
    plan = require(TransformationPlan, db, transformation_id)
    plan.storyboard = storyboard
    db.commit()
    return plan


@router.post(
    "/transformations/{transformation_id}/assess",
    response_model=OriginalityRead,
    status_code=201,
)
def assess_originality(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    plan = require(TransformationPlan, db, transformation_id)
    project = require(Project, db, plan.project_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    if project.status not in {ProjectStatus.COMPLETED, ProjectStatus.PREVIEW_READY}:
        project.status = ProjectStatus.ORIGINALITY_REVIEW
    report = OriginalityReport(
        project_id=project.id,
        candidate_id=candidate.id,
        transformation_plan_id=plan.id,
        **assess(
            plan,
            candidate,
            list(
                db.scalars(
                    select(TransformationPlan.commentary_script).where(
                        TransformationPlan.id != plan.id
                    )
                )
            ),
        ),
    )
    db.execute(
        delete(OriginalityReport).where(
            OriginalityReport.transformation_plan_id == transformation_id
        )
    )
    db.add(report)
    if report.overall_status == "transformation_required":
        project.status = ProjectStatus.TRANSFORMATION_DRAFT
    elif project.status != ProjectStatus.COMPLETED:
        project.status = ProjectStatus.READY_TO_RENDER
    db.commit()
    return report


@router.get(
    "/transformations/{transformation_id}/originality-report",
    response_model=OriginalityRead,
)
def get_originality(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    report = db.scalar(
        select(OriginalityReport)
        .where(OriginalityReport.transformation_plan_id == transformation_id)
        .order_by(OriginalityReport.created_at.desc())
    )
    if not report:
        raise HTTPException(status_code=404, detail="Laporan belum tersedia.")
    return report


def queue_render(
    transformation_id: uuid.UUID,
    payload: RenderCreate,
    preview: bool,
    db: Session,
):
    plan = require(TransformationPlan, db, transformation_id)
    project = require(Project, db, plan.project_id)
    candidate = require(ClipCandidate, db, plan.candidate_id)
    settings = get_settings()
    render_width = settings.preview_width if preview else settings.final_width
    render_height = settings.preview_height if preview else settings.final_height
    active_render = db.scalar(
        select(Render)
        .where(
            Render.transformation_plan_id == plan.id,
            Render.status.in_(["queued", "running"]),
            Render.width == render_width,
            Render.height == render_height,
            Render.preset == payload.preset,
            Render.subtitle_language == payload.subtitle_language,
        )
        .order_by(Render.created_at.desc())
    )
    if active_render:
        raise HTTPException(
            status_code=409,
            detail="Render preview sedang berjalan." if preview else "Render final sedang berjalan.",
        )
    editor_render_plan = build_editor_render_plan(
        plan.clipper_style_config,
        candidate_duration=candidate.duration_seconds,
        hook_fallback=plan.original_hook,
    )
    render_style_config = editor_render_plan.style_config
    logger.info(
        "export_render_plan_audit",
        transformation_id=str(plan.id),
        candidate_id=str(candidate.id),
        render_id=None,
        editor_state_found=editor_render_plan.editor_state_found,
        video_framing=render_style_config.get("video_framing"),
        video_sequence_count=len(editor_render_plan.video_sequence),
        audio_sequence_count=len(editor_render_plan.audio_sequence),
        caption_timeline_count=len(editor_render_plan.caption_timeline),
        first_caption_text_from_editor_state=(
            editor_render_plan.caption_timeline[0].get("text")
            if editor_render_plan.caption_timeline
            else None
        ),
        caption_initialized=editor_render_plan.caption_timeline_initialized,
        editor_state_version=render_style_config.get("editor_state_version", 0),
        effect_timeline_count=len(editor_render_plan.effect_timeline),
        template=payload.preset,
        layout=layout_mode(payload.preset),
        style=render_style_config.get("clipper_style_preset"),
        resolution=f"{render_width}x{render_height}",
        output_path=None,
    )
    logger.info(
        "render_element_contract_audit",
        phase="queue_render",
        transformation_id=str(plan.id),
        candidate_id=str(candidate.id),
        render_id=None,
        template=payload.preset,
        resolution=f"{render_width}x{render_height}",
        **editor_render_plan.element_audit.log_fields(),
    )
    if editor_render_plan.element_audit.unsupported_export_elements:
        logger.warning(
            "render_contains_unsupported_export_elements",
            transformation_id=str(plan.id),
            candidate_id=str(candidate.id),
            unsupported_export_elements=list(
                editor_render_plan.element_audit.unsupported_export_elements
            ),
            unsupported_export_reasons=(
                editor_render_plan.element_audit.unsupported_reasons
            ),
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
    audio_library = LocalStorageProvider().resolve(f"{project.id}/audio-library")
    additional_audio_identity = []
    for track in render_style_config.get("additional_audio_tracks", []):
        if not isinstance(track, dict):
            continue
        asset_id = str(track.get("asset_id") or "")
        matches = [
            path
            for path in audio_library.glob(f"{asset_id}.*")
            if path.suffix.lower() in {".mp3", ".wav", ".m4a"}
        ]
        additional_audio_identity.append(
            {
                "asset_id": asset_id,
                "path": str(matches[0]) if matches else None,
                "start": track.get("start", 0),
                "end": track.get("end"),
                "volume": track.get("volume", 1),
            }
        )
    audio_identity = {
        "voiceover": {
            "asset_id": str(voiceover_asset.id) if voiceover_asset else None,
            "path": voiceover_asset.storage_path if voiceover_asset else None,
            "checksum": voiceover_asset.checksum if voiceover_asset else None,
            "start": render_style_config.get("voiceover_start", 0),
            "end": render_style_config.get("voiceover_end"),
        },
        "additional_audio": additional_audio_identity,
    }
    cache_lookup_started_at = perf_counter()
    expected_fingerprint = render_fingerprint(
        render_style_config,
        preset=payload.preset,
        subtitle_language=payload.subtitle_language,
        width=render_width,
        height=render_height,
        frame_rate=30,
        preview=preview,
        audio_identity=audio_identity,
    )
    fingerprint_short = expected_fingerprint[:12]
    completed_renders = list(
        db.scalars(
            select(Render)
            .where(
                Render.transformation_plan_id == plan.id,
                Render.status == "completed",
                Render.preset == payload.preset,
                Render.subtitle_language == payload.subtitle_language,
                Render.width == render_width,
                Render.height == render_height,
                Render.preview_path.is_not(None)
                if preview
                else Render.output_path.is_not(None),
            )
            .order_by(Render.created_at.desc())
        )
    )
    current_framing = normalize_video_framing(render_style_config.get("video_framing"))
    cache_miss_reason = "no_completed_render"
    for completed_render in completed_renders:
        cached_path_value = (
            completed_render.preview_path if preview else completed_render.output_path
        )
        cached_path = Path(cached_path_value) if cached_path_value else None
        if not cached_path or not cached_path.is_file():
            cache_miss_reason = "cached_output_missing"
            continue
        cache_metadata = read_render_cache_metadata(cached_path)
        if cache_metadata and cache_metadata.get("fingerprint") == expected_fingerprint:
            try:
                verify_render_file_binding(
                    cached_path,
                    preview=preview,
                    forbidden_source_paths=(candidate.short_source_clip_path,),
                )
            except AppError as exc:
                logger.error(
                    "cached_render_file_binding_invalid",
                    render_id=str(completed_render.id),
                    render_output_path=str(cached_path),
                    error=exc.message,
                )
                cache_miss_reason = "cached_output_binding_invalid"
                continue
            cache_lookup_duration = perf_counter() - cache_lookup_started_at
            logger.info(
                "using_cached_render",
                message="using cached render",
                render_id=str(completed_render.id),
                cached_render_id=str(completed_render.id),
                cached_output_path=str(cached_path),
                transformation_id=str(plan.id),
                preset=payload.preset,
                resolution=f"{render_width}x{render_height}",
                video_framing=current_framing,
                fingerprint=fingerprint_short,
                cache_lookup_duration=round(cache_lookup_duration, 3),
            )
            return render_payload(completed_render, db)
        framing_changed = bool(
            cache_metadata
            and cache_metadata.get("video_framing") != current_framing
        )
        logger.info(
            "render_cache_invalidated",
            message=(
                "render invalidated because video_framing changed"
                if framing_changed
                else "render invalidated because render inputs changed"
            ),
            cached_render_id=str(completed_render.id),
            transformation_id=str(plan.id),
            cached_fingerprint=(cache_metadata or {}).get("fingerprint"),
            expected_fingerprint=expected_fingerprint,
            cached_video_framing=(cache_metadata or {}).get("video_framing"),
            video_framing=current_framing,
            preset=payload.preset,
            resolution=f"{render_width}x{render_height}",
        )
        cache_miss_reason = (
            "video_framing_changed" if framing_changed else "render_inputs_changed"
        )
    logger.info(
        "cache_miss",
        transformation_id=str(plan.id),
        candidate_id=str(candidate.id),
        reason=cache_miss_reason,
        completed_render_count=len(completed_renders),
        fingerprint=fingerprint_short,
        cache_lookup_duration=round(perf_counter() - cache_lookup_started_at, 3),
        preset=payload.preset,
        resolution=f"{render_width}x{render_height}",
        video_framing=current_framing,
    )
    report = db.scalar(
        select(OriginalityReport)
        .where(OriginalityReport.transformation_plan_id == plan.id)
        .order_by(OriginalityReport.created_at.desc())
    )
    if not preview and report and report.overall_status == "transformation_required":
        raise AppError(
            ErrorCode.ORIGINALITY_REQUIREMENTS_NOT_MET,
            "Render final memerlukan perbaikan transformasi dan tinjauan manual.",
            409,
        )
    transcription_provider = (
        project.transcript_provider or get_settings().transcription_provider
    )
    if transcription_provider == "mock" and project.content_type != "sports":
        raise AppError(
            ErrorCode.TRANSCRIPTION_FAILED,
            "Subtitle ucapan asli belum aktif. Atur TRANSCRIPTION_PROVIDER=openai, "
            "isi OPENAI_API_KEY, lalu proses ulang video.",
            409,
        )
    allowed = {
        ProjectStatus.CANDIDATES_READY,
        ProjectStatus.TRANSFORMATION_DRAFT,
        ProjectStatus.READY_TO_RENDER,
        ProjectStatus.PREVIEW_READY,
        ProjectStatus.COMPLETED,
    }
    if project.status not in allowed:
        raise HTTPException(status_code=409, detail="Proyek belum siap dirender.")
    render = Render(
        project_id=project.id,
        transformation_plan_id=plan.id,
        preset=payload.preset,
        subtitle_language=payload.subtitle_language,
        width=render_width,
        height=render_height,
        frame_rate=30,
    )
    db.add(render)
    db.commit()
    logger.info(
        "export_render_queued",
        transformation_id=str(plan.id),
        candidate_id=str(candidate.id),
        render_id=str(render.id),
        editor_state_found=editor_render_plan.editor_state_found,
        video_framing=render_style_config.get("video_framing"),
        video_sequence_count=len(editor_render_plan.video_sequence),
        audio_sequence_count=len(editor_render_plan.audio_sequence),
        caption_timeline_count=len(editor_render_plan.caption_timeline),
        effect_timeline_count=len(editor_render_plan.effect_timeline),
        template=payload.preset,
        resolution=f"{render_width}x{render_height}",
    )
    render_video.delay(str(render.id), preview)
    return render_payload(render, db)


def _render_source_paths(render: Render, db: Session) -> tuple[str | None, str | None]:
    plan = db.get(TransformationPlan, render.transformation_plan_id)
    candidate = db.get(ClipCandidate, plan.candidate_id) if plan else None
    source = db.scalar(
        select(MediaAsset).where(
            MediaAsset.project_id == render.project_id,
            MediaAsset.asset_type == "source_video",
        )
    )
    return (
        candidate.short_source_clip_path if candidate else None,
        source.storage_path if source else None,
    )


def render_payload(render: Render, db: Session | None = None) -> dict:
    path_value = render.output_path or render.preview_path
    response_status = render.status
    response_error = render.error_message if render.status == "failed" else None
    has_verified_file = False
    if render.status == "completed":
        try:
            verify_render_file_binding(
                path_value,
                preview=not bool(render.output_path),
                forbidden_source_paths=_render_source_paths(render, db) if db else (),
            )
            has_verified_file = True
        except AppError as exc:
            response_status = "failed"
            response_error = exc.message
            logger.error(
                "render_result_binding_invalid",
                render_id=str(render.id),
                render_output_path=path_value,
                error=exc.message,
            )
    output_url = (
        f"/api/renders/{render.id}/download" if has_verified_file else None
    )
    return {
        "id": render.id,
        "status": response_status,
        "preset": render.preset,
        "subtitle_language": render.subtitle_language,
        "width": render.width,
        "height": render.height,
        "frame_rate": render.frame_rate,
        "duration_seconds": render.duration_seconds,
        "file_size_bytes": render.file_size_bytes,
        "error_message": response_error,
        "warning_message": render.error_message if response_status == "completed" else None,
        "output_url": output_url,
    }


@router.post(
    "/transformations/{transformation_id}/preview",
    response_model=RenderRead,
    status_code=202,
)
def create_preview(
    transformation_id: uuid.UUID,
    payload: RenderCreate,
    db: Session = Depends(get_db),
):
    return queue_render(transformation_id, payload, True, db)


@router.post(
    "/transformations/{transformation_id}/render-preview",
    response_model=RenderRead,
    status_code=202,
)
def create_preview_alias(
    transformation_id: uuid.UUID,
    payload: RenderCreate,
    db: Session = Depends(get_db),
):
    return queue_render(transformation_id, payload, True, db)


@router.post(
    "/transformations/{transformation_id}/render",
    response_model=RenderRead,
    status_code=202,
)
def create_final_render(
    transformation_id: uuid.UUID,
    payload: RenderCreate,
    db: Session = Depends(get_db),
):
    return queue_render(transformation_id, payload, False, db)


@router.post(
    "/transformations/{transformation_id}/render-final",
    response_model=RenderRead,
    status_code=202,
)
def create_final_render_alias(
    transformation_id: uuid.UUID,
    payload: RenderCreate,
    db: Session = Depends(get_db),
):
    return queue_render(transformation_id, payload, False, db)


@router.get("/renders/{render_id}", response_model=RenderRead)
def get_render(render_id: uuid.UUID, db: Session = Depends(get_db)):
    render = require(Render, db, render_id)
    payload = render_payload(render, db)
    logger.info(
        "render_status_poll",
        render_id=str(render.id),
        status=payload["status"],
        render_output_path=render.output_path or render.preview_path,
        render_download_url=payload["output_url"],
    )
    return payload


@router.get(
    "/transformations/{transformation_id}/latest-render",
    response_model=RenderRead,
)
def latest_render(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    require(TransformationPlan, db, transformation_id)
    render = db.scalar(
        select(Render)
        .where(Render.transformation_plan_id == transformation_id)
        .order_by(Render.created_at.desc())
    )
    if not render:
        raise HTTPException(status_code=404, detail="Render belum tersedia.")
    return render_payload(render, db)


@router.get("/renders/{render_id}/download")
def download_render(
    render_id: uuid.UUID,
    output_filename: str | None = None,
    db: Session = Depends(get_db),
):
    render = require(Render, db, render_id)
    plan = db.get(TransformationPlan, render.transformation_plan_id)
    candidate = db.get(ClipCandidate, plan.candidate_id) if plan else None
    project = db.get(Project, render.project_id)
    path_value = render.output_path or render.preview_path
    source_paths = _render_source_paths(render, db)
    same_as_source = bool(
        path_value
        and any(source and same_file_path(path_value, source) for source in source_paths)
    )
    logger.info(
        "render_download_audit",
        download_render_id=str(render.id),
        download_file_path=path_value,
        render_output_path=render.output_path,
        render_preview_path=render.preview_path,
        path_same_as_source_or_candidate=same_as_source,
    )
    if render.status != "completed":
        raise HTTPException(status_code=409, detail="File render belum tersedia.")
    try:
        path = verify_render_file_binding(
            path_value,
            preview=not bool(render.output_path),
            forbidden_source_paths=source_paths,
        )
    except AppError as exc:
        logger.error(
            "render_download_binding_rejected",
            download_render_id=str(render.id),
            download_file_path=path_value,
            error=exc.message,
        )
        raise HTTPException(status_code=409, detail=exc.message) from exc
    download_filename = sanitize_download_filename(
        output_filename,
        candidate.suggested_title if candidate else None,
        project.title if project else None,
        filename_from_path(path.name),
        f"autoclip-{render.id}",
    )
    logger.info(
        "render_download_filename",
        download_render_id=str(render.id),
        requested_filename=output_filename,
        download_filename=download_filename,
    )
    return FileResponse(path, media_type="video/mp4", filename=download_filename)
