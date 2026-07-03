import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
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
    CandidatePatch,
    CandidateRead,
    CandidateSelectionRead,
    CandidateTitlePatch,
    HookTextRead,
    JobRead,
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
from app.services.clipper_style import (
    default_clipper_style,
    generate_hook_text_for_clip,
    is_generic_hook,
    normalize_clipper_style,
)
from app.services.originality import assess
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
from app.services.video_download import download_page_video
from app.tasks import process_project, render_video

router = APIRouter(prefix="/api")


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
    transition(project, ProjectStatus.UPLOADING)
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
    transition(project, ProjectStatus.UPLOADING)
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
    if project.status != ProjectStatus.UPLOADED:
        raise HTTPException(status_code=409, detail="Video belum siap diproses.")
    job = ProcessingJob(project_id=project_id, job_type="full_pipeline")
    db.add(job)
    db.commit()
    process_project.delay(str(project_id), str(job.id))
    return job


@router.post("/projects/{project_id}/reprocess", response_model=JobRead, status_code=202)
def reprocess_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
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
    process_project.delay(str(project_id), str(job.id))
    return job


@router.get("/projects/{project_id}/status")
def project_status(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    job = db.scalar(
        select(ProcessingJob)
        .where(ProcessingJob.project_id == project_id)
        .order_by(ProcessingJob.created_at.desc())
    )
    return {
        "project_id": project.id,
        "job_id": job.id if job else None,
        "status": project.status,
        "progress": job.progress if job else 0,
        "current_step": job.current_step if job else "Belum diproses",
        "error_code": job.error_code if job else None,
        "error_message": job.error_message if job else None,
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
    generated = get_ai_provider().transformation(
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
    current_config = dict(plan.clipper_style_config or default_clipper_style("clean_podcast"))
    if is_generic_hook(current_config.get("hook_text")):
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
    generated = get_ai_provider().transformation(
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
    settings = get_settings()
    render_width = settings.preview_width if preview else settings.final_width
    render_height = settings.preview_height if preview else settings.final_height
    active_render = db.scalar(
        select(Render)
        .where(
            Render.transformation_plan_id == plan.id,
            Render.status.in_(["queued", "running"]),
            Render.width == render_width,
        )
        .order_by(Render.created_at.desc())
    )
    if active_render:
        raise HTTPException(
            status_code=409,
            detail="Render preview sedang berjalan." if preview else "Render final sedang berjalan.",
        )
    completed_render = db.scalar(
        select(Render)
        .where(
            Render.transformation_plan_id == plan.id,
            Render.status == "completed",
            Render.preview_path.is_not(None) if preview else Render.output_path.is_not(None),
        )
        .order_by(Render.created_at.desc())
    )
    if completed_render and not preview:
        return completed_render
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
    render_video.delay(str(render.id), preview)
    return render


def render_payload(render: Render) -> dict:
    has_file = bool(render.output_path or render.preview_path)
    return {
        "id": render.id,
        "status": render.status,
        "preset": render.preset,
        "subtitle_language": render.subtitle_language,
        "width": render.width,
        "height": render.height,
        "frame_rate": render.frame_rate,
        "duration_seconds": render.duration_seconds,
        "file_size_bytes": render.file_size_bytes,
        "error_message": render.error_message if render.status == "failed" else None,
        "warning_message": render.error_message if render.status == "completed" else None,
        "output_url": f"/api/renders/{render.id}/download" if render.status == "completed" and has_file else None,
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
    return render_payload(require(Render, db, render_id))


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
    return render_payload(render)


@router.get("/renders/{render_id}/download")
def download_render(render_id: uuid.UUID, db: Session = Depends(get_db)):
    render = require(Render, db, render_id)
    path = render.output_path or render.preview_path
    if render.status != "completed" or not path or not Path(path).is_file():
        raise HTTPException(status_code=409, detail="File render belum tersedia.")
    return FileResponse(path, media_type="video/mp4", filename=f"autoclip-{render.id}.mp4")
