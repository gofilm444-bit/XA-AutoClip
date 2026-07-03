import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

OwnershipType = Literal[
    "self_owned",
    "client_owned",
    "licensed",
    "creative_commons",
    "public_domain",
    "third_party_commentary",
    "unknown",
]
TransformationPurpose = Literal[
    "analysis",
    "criticism",
    "review",
    "education",
    "fact_check",
    "comparison",
    "substantive_reaction",
    "news_commentary",
    "parody",
    "other",
]
ContentType = Literal["podcast", "sports"]


class SourceDeclarationInput(BaseModel):
    ownership_type: OwnershipType
    source_creator: str | None = Field(default=None, max_length=200)
    source_title: str | None = Field(default=None, max_length=300)
    source_description: str | None = Field(default=None, max_length=10_000)
    source_url: HttpUrl | None = None
    license_type: str | None = Field(default=None, max_length=100)
    intended_use: str = Field(min_length=3, max_length=2000)
    transformation_purpose: TransformationPurpose
    user_acknowledged: Literal[True]


class ProjectCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    content_type: ContentType = "podcast"
    source_declaration: SourceDeclarationInput


class ProjectPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class SourceMetadataRequest(BaseModel):
    url: HttpUrl


class SourceUrlInput(BaseModel):
    url: HttpUrl


class SourceMetadataRead(BaseModel):
    url: str
    title: str | None
    description: str | None
    creator: str | None
    site_name: str | None
    thumbnail_url: str | None
    is_direct_media: bool


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    description: str | None
    content_type: ContentType
    transcript_provider: str | None
    transcript_language: str | None
    status: str
    created_at: datetime
    updated_at: datetime
    original_duration: float | None = None
    total_top_clips: int = 0
    final_clips_count: int = 0
    storage_size_estimate: int = 0


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    status: str
    progress: int
    current_step: str
    error_code: str | None
    error_message: str | None


class CandidateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    rank: int
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    transcript_text: str
    suggested_title: str
    suggested_hook: str
    summary: str
    category: str
    hook_score: float
    context_score: float
    information_score: float
    emotion_score: float
    fluency_score: float
    duration_score: float
    discussion_score: float
    viral_potential_score: float
    reasons_json: list
    risks_json: list
    selected: bool
    short_source_clip_path: str | None = None
    clip_thumbnail_path: str | None = None
    file_missing: bool = False


class ProjectClipRead(CandidateRead):
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    clip_id: uuid.UUID
    transformation_id: uuid.UUID | None = None
    preview_render_id: uuid.UUID | None = None
    preview_status: str | None = None
    final_render_id: uuid.UUID | None = None
    final_status: str | None = None
    final_file_size_bytes: int | None = None


class CandidateSelectionRead(BaseModel):
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    clip_id: uuid.UUID
    transformation_id: uuid.UUID
    status: Literal["created", "existing"]
    message: str


class CandidatePatch(BaseModel):
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)


class CandidateTitlePatch(BaseModel):
    suggested_title: str = Field(min_length=5, max_length=300)


class TransformationCreate(BaseModel):
    purpose: TransformationPurpose
    audience: str = Field(min_length=2, max_length=200)


class TransformationPatch(BaseModel):
    purpose: TransformationPurpose | None = None
    audience: str | None = Field(default=None, min_length=2, max_length=200)
    new_angle: str | None = Field(default=None, min_length=10)
    original_hook: str | None = Field(default=None, min_length=5)
    commentary_script: str | None = Field(default=None, min_length=20)
    conclusion: str | None = Field(default=None, min_length=5)
    engagement_question: str | None = Field(default=None, min_length=5)
    social_caption: str | None = Field(default=None, min_length=20, max_length=5000)
    storyboard: list[dict] | None = None
    clipper_style_config: dict | None = None


class TransformationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    candidate_id: uuid.UUID
    purpose: str
    new_angle: str
    audience: str
    original_hook: str
    commentary_script: str
    conclusion: str
    engagement_question: str
    social_caption: str
    clipper_style_config: dict
    needs_fact_verification: bool
    status: str
    storyboard: list


class HookTextRead(BaseModel):
    transformation_id: uuid.UUID
    hook_text: str


class TransformationContextRead(BaseModel):
    project_title: str
    content_type: ContentType
    source_title: str | None
    source_creator: str | None
    source_url: str | None
    uploaded_filename: str | None
    clip_start_seconds: float
    clip_end_seconds: float
    clip_duration_seconds: float
    candidate_title: str
    candidate_transcript: str
    caption_cues: list[dict]
    transcription_provider: str | None
    configured_transcription_provider: str
    transcription_language: str | None
    transcription_is_demo: bool
    source_mismatch_warning: str | None


class OriginalityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    transformative_value_score: float
    creator_contribution_score: float
    new_information_score: float
    source_dependency_score: float
    repetition_risk_score: float
    copyright_risk_level: str
    overall_status: str
    checks_json: list
    warnings_json: list
    recommendations_json: list


class RenderCreate(BaseModel):
    preset: Literal[
        "blurred_background", "center_crop", "fit_background", "picture_in_picture"
    ] = "blurred_background"
    subtitle_language: Literal["id", "en"] = "id"


class RenderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: str
    preset: str
    subtitle_language: str
    width: int
    height: int
    frame_rate: float
    duration_seconds: float | None
    file_size_bytes: int | None
    error_message: str | None
    warning_message: str | None = None
    output_url: str | None = None
