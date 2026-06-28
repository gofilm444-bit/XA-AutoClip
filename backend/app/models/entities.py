import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.state import ProjectStatus
from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(String(20), default="podcast")
    status: Mapped[str] = mapped_column(String(40), default=ProjectStatus.CREATED)
    transcript_language: Mapped[str | None] = mapped_column(String(20))
    transcript_provider: Mapped[str | None] = mapped_column(String(40))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_declaration: Mapped["SourceDeclaration | None"] = relationship(
        cascade="all, delete-orphan"
    )
    assets: Mapped[list["MediaAsset"]] = relationship(cascade="all, delete-orphan")


class SourceDeclaration(Base):
    __tablename__ = "source_declarations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), unique=True)
    ownership_type: Mapped[str] = mapped_column(String(40))
    source_creator: Mapped[str | None] = mapped_column(String(200))
    source_title: Mapped[str | None] = mapped_column(String(300))
    source_description: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    license_type: Mapped[str | None] = mapped_column(String(100))
    intended_use: Mapped[str] = mapped_column(Text)
    transformation_purpose: Mapped[str] = mapped_column(String(40))
    user_acknowledged: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    asset_type: Mapped[str] = mapped_column(String(40))
    original_filename: Mapped[str] = mapped_column(String(300))
    stored_filename: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(1000))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    frame_rate: Mapped[float | None] = mapped_column(Float)
    audio_sample_rate: Mapped[int | None] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProcessingJob(TimestampMixin, Base):
    __tablename__ = "processing_jobs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    job_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[str] = mapped_column(String(100), default="Menunggu")
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    segment_index: Mapped[int] = mapped_column(Integer)
    speaker_label: Mapped[str | None] = mapped_column(String(50))
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float | None] = mapped_column(Float)
    words_json: Mapped[list | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ClipCandidate(TimestampMixin, Base):
    __tablename__ = "clip_candidates"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    start_seconds: Mapped[float] = mapped_column(Float)
    end_seconds: Mapped[float] = mapped_column(Float)
    duration_seconds: Mapped[float] = mapped_column(Float)
    transcript_text: Mapped[str] = mapped_column(Text)
    suggested_title: Mapped[str] = mapped_column(String(300))
    suggested_hook: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(80))
    hook_score: Mapped[float] = mapped_column(Float)
    context_score: Mapped[float] = mapped_column(Float)
    information_score: Mapped[float] = mapped_column(Float)
    emotion_score: Mapped[float] = mapped_column(Float)
    fluency_score: Mapped[float] = mapped_column(Float)
    duration_score: Mapped[float] = mapped_column(Float)
    discussion_score: Mapped[float] = mapped_column(Float)
    viral_potential_score: Mapped[float] = mapped_column(Float)
    reasons_json: Mapped[list] = mapped_column(JSON, default=list)
    risks_json: Mapped[list] = mapped_column(JSON, default=list)
    overlap_group: Mapped[str | None] = mapped_column(String(50))
    rank: Mapped[int] = mapped_column(Integer)
    selected: Mapped[bool] = mapped_column(Boolean, default=False)


class TransformationPlan(TimestampMixin, Base):
    __tablename__ = "transformation_plans"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    candidate_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clip_candidates.id"))
    purpose: Mapped[str] = mapped_column(String(40))
    new_angle: Mapped[str] = mapped_column(Text)
    audience: Mapped[str] = mapped_column(String(200))
    original_hook: Mapped[str] = mapped_column(Text)
    commentary_script: Mapped[str] = mapped_column(Text)
    conclusion: Mapped[str] = mapped_column(Text)
    engagement_question: Mapped[str] = mapped_column(Text)
    social_caption: Mapped[str] = mapped_column(Text, default="")
    needs_fact_verification: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    storyboard: Mapped[list] = mapped_column(JSON, default=list)


class OriginalityReport(Base):
    __tablename__ = "originality_reports"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clip_candidates.id"))
    transformation_plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transformation_plans.id")
    )
    transformative_value_score: Mapped[float] = mapped_column(Float)
    creator_contribution_score: Mapped[float] = mapped_column(Float)
    new_information_score: Mapped[float] = mapped_column(Float)
    source_dependency_score: Mapped[float] = mapped_column(Float)
    repetition_risk_score: Mapped[float] = mapped_column(Float)
    copyright_risk_level: Mapped[str] = mapped_column(String(20))
    overall_status: Mapped[str] = mapped_column(String(40))
    checks_json: Mapped[list] = mapped_column(JSON)
    warnings_json: Mapped[list] = mapped_column(JSON)
    recommendations_json: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Render(Base):
    __tablename__ = "renders"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    transformation_plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transformation_plans.id")
    )
    status: Mapped[str] = mapped_column(String(30), default="queued")
    preset: Mapped[str] = mapped_column(String(40))
    subtitle_language: Mapped[str] = mapped_column(String(10), default="id")
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    frame_rate: Mapped[float] = mapped_column(Float, default=30)
    output_path: Mapped[str | None] = mapped_column(String(1000))
    preview_path: Mapped[str | None] = mapped_column(String(1000))
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
