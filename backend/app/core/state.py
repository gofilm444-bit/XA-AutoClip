from enum import StrEnum


class ProjectStatus(StrEnum):
    CREATED = "created"
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    EXTRACTING_METADATA = "extracting_metadata"
    EXTRACTING_AUDIO = "extracting_audio"
    TRANSCRIBING = "transcribing"
    SEGMENTING = "segmenting"
    GENERATING_CANDIDATES = "generating_candidates"
    CANDIDATES_READY = "candidates_ready"
    TRANSFORMATION_DRAFT = "transformation_draft"
    AWAITING_COMMENTARY = "awaiting_commentary"
    ORIGINALITY_REVIEW = "originality_review"
    READY_TO_RENDER = "ready_to_render"
    RENDERING_PREVIEW = "rendering_preview"
    PREVIEW_READY = "preview_ready"
    RENDERING_FINAL = "rendering_final"
    COMPLETED = "completed"
    FAILED = "failed"


ALLOWED_TRANSITIONS: dict[ProjectStatus, set[ProjectStatus]] = {
    ProjectStatus.CREATED: {ProjectStatus.UPLOADING, ProjectStatus.FAILED},
    ProjectStatus.UPLOADING: {ProjectStatus.UPLOADED, ProjectStatus.FAILED},
    ProjectStatus.UPLOADED: {ProjectStatus.EXTRACTING_METADATA, ProjectStatus.FAILED},
    ProjectStatus.EXTRACTING_METADATA: {ProjectStatus.EXTRACTING_AUDIO, ProjectStatus.FAILED},
    ProjectStatus.EXTRACTING_AUDIO: {ProjectStatus.TRANSCRIBING, ProjectStatus.FAILED},
    ProjectStatus.TRANSCRIBING: {ProjectStatus.SEGMENTING, ProjectStatus.FAILED},
    ProjectStatus.SEGMENTING: {ProjectStatus.GENERATING_CANDIDATES, ProjectStatus.FAILED},
    ProjectStatus.GENERATING_CANDIDATES: {ProjectStatus.CANDIDATES_READY, ProjectStatus.FAILED},
    ProjectStatus.CANDIDATES_READY: {ProjectStatus.TRANSFORMATION_DRAFT, ProjectStatus.FAILED},
    ProjectStatus.TRANSFORMATION_DRAFT: {
        ProjectStatus.AWAITING_COMMENTARY,
        ProjectStatus.ORIGINALITY_REVIEW,
        ProjectStatus.RENDERING_PREVIEW,
        ProjectStatus.FAILED,
    },
    ProjectStatus.AWAITING_COMMENTARY: {
        ProjectStatus.ORIGINALITY_REVIEW,
        ProjectStatus.FAILED,
    },
    ProjectStatus.ORIGINALITY_REVIEW: {
        ProjectStatus.READY_TO_RENDER,
        ProjectStatus.TRANSFORMATION_DRAFT,
        ProjectStatus.FAILED,
    },
    ProjectStatus.READY_TO_RENDER: {
        ProjectStatus.ORIGINALITY_REVIEW,
        ProjectStatus.RENDERING_PREVIEW,
        ProjectStatus.RENDERING_FINAL,
        ProjectStatus.FAILED,
    },
    ProjectStatus.RENDERING_PREVIEW: {ProjectStatus.PREVIEW_READY, ProjectStatus.FAILED},
    ProjectStatus.PREVIEW_READY: {
        ProjectStatus.TRANSFORMATION_DRAFT,
        ProjectStatus.ORIGINALITY_REVIEW,
        ProjectStatus.RENDERING_PREVIEW,
        ProjectStatus.RENDERING_FINAL,
        ProjectStatus.FAILED,
    },
    ProjectStatus.RENDERING_FINAL: {ProjectStatus.COMPLETED, ProjectStatus.FAILED},
    ProjectStatus.COMPLETED: set(),
    ProjectStatus.FAILED: set(),
}


def validate_transition(current: str, target: str) -> None:
    current_status = ProjectStatus(current)
    target_status = ProjectStatus(target)
    if target_status not in ALLOWED_TRANSITIONS[current_status]:
        raise ValueError(f"Transisi status tidak valid: {current} -> {target}")
