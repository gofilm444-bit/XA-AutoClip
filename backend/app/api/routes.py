import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, select, update
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
    CandidateTitlePatch,
    JobRead,
    OriginalityRead,
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
    return list(
        db.scalars(
            select(Project)
            .where(Project.deleted_at.is_(None))
            .order_by(Project.created_at.desc())
        )
    )


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: uuid.UUID, db: Session = Depends(get_db)):
    project = require(Project, db, project_id)
    if project.deleted_at:
        raise HTTPException(status_code=404, detail="Proyek tidak ditemukan.")
    return project


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


@router.post("/candidates/{candidate_id}/select", response_model=CandidateRead)
def select_candidate(candidate_id: uuid.UUID, db: Session = Depends(get_db)):
    candidate = require(ClipCandidate, db, candidate_id)
    project = require(Project, db, candidate.project_id)
    if project.status != ProjectStatus.CANDIDATES_READY:
        raise HTTPException(status_code=409, detail="Kandidat belum siap dipilih.")
    db.execute(
        ClipCandidate.__table__.update()
        .where(ClipCandidate.project_id == candidate.project_id)
        .values(selected=False)
    )
    candidate.selected = True
    db.commit()
    return candidate


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
    if not candidate.selected:
        raise HTTPException(status_code=409, detail="Pilih kandidat terlebih dahulu.")
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
        payload.purpose,
        payload.audience,
        declaration.source_description if not mismatch_warning else None,
        declaration.source_title,
        source_asset.original_filename if source_asset else None,
    )
    generated.pop("storyboard", None)
    plan = TransformationPlan(
        project_id=project.id,
        candidate_id=candidate.id,
        purpose=payload.purpose,
        audience=payload.audience,
        storyboard=[],
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
    transition(project, ProjectStatus.TRANSFORMATION_DRAFT)
    db.commit()
    return plan


@router.get("/transformations/{transformation_id}", response_model=TransformationRead)
def get_transformation(transformation_id: uuid.UUID, db: Session = Depends(get_db)):
    return require(TransformationPlan, db, transformation_id)


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
    transition(project, ProjectStatus.ORIGINALITY_REVIEW)
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
        transition(project, ProjectStatus.TRANSFORMATION_DRAFT)
    else:
        transition(project, ProjectStatus.READY_TO_RENDER)
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
    report = db.scalar(
        select(OriginalityReport)
        .where(OriginalityReport.transformation_plan_id == plan.id)
        .order_by(OriginalityReport.created_at.desc())
    )
    if not preview and (
        not report or report.overall_status == "transformation_required"
    ):
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
        ProjectStatus.TRANSFORMATION_DRAFT,
        ProjectStatus.READY_TO_RENDER,
        ProjectStatus.PREVIEW_READY,
    }
    if project.status not in allowed:
        raise HTTPException(status_code=409, detail="Proyek belum siap dirender.")
    render = Render(
        project_id=project.id,
        transformation_plan_id=plan.id,
        preset=payload.preset,
        subtitle_language=payload.subtitle_language,
        width=540 if preview else 1080,
        height=960 if preview else 1920,
        frame_rate=30,
    )
    db.add(render)
    db.commit()
    render_video.delay(str(render.id), preview)
    return render


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


@router.get("/renders/{render_id}", response_model=RenderRead)
def get_render(render_id: uuid.UUID, db: Session = Depends(get_db)):
    return require(Render, db, render_id)


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
    return render


@router.get("/renders/{render_id}/download")
def download_render(render_id: uuid.UUID, db: Session = Depends(get_db)):
    render = require(Render, db, render_id)
    path = render.output_path or render.preview_path
    if render.status != "completed" or not path or not Path(path).is_file():
        raise HTTPException(status_code=409, detail="File render belum tersedia.")
    return FileResponse(path, media_type="video/mp4", filename=f"autoclip-{render.id}.mp4")
