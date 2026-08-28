from dataclasses import dataclass
from typing import Any, Literal

ExportStatus = Literal[
    "supported_export",
    "partial_export",
    "unsupported_export",
    "not_applicable",
]

CAPTION_STYLE_PARTIAL_REASON = (
    "Caption preset, text color, font fallback, size, weight, position, outline, "
    "shadow, uppercase transform, and simple background are exported. Karaoke and "
    "word-by-word use estimated uniform timing because word-level timestamps are "
    "unavailable, and ASS output is not pixel-perfect with the CSS preview."
)


@dataclass(frozen=True)
class EditorElementContract:
    element_type: str
    label: str
    editor_state_fields: tuple[str, ...]
    autosave_supported: bool
    preview_supported: bool
    render_plan_supported: bool
    export_status: ExportStatus
    fingerprint_fields: tuple[str, ...]
    timeline_track: str | None = None
    unsupported_reason: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class ElementRenderAudit:
    active_editor_elements: tuple[str, ...]
    supported_export_elements: tuple[str, ...]
    partial_export_elements: tuple[str, ...]
    unsupported_export_elements: tuple[str, ...]
    fingerprint_contributors: tuple[str, ...]
    fingerprint_fields_used: tuple[str, ...]
    element_statuses: dict[str, ExportStatus]
    unsupported_reasons: dict[str, str]

    def log_fields(self) -> dict[str, Any]:
        return {
            "active_editor_elements": list(self.active_editor_elements),
            "supported_export_elements": list(self.supported_export_elements),
            "partial_export_elements": list(self.partial_export_elements),
            "unsupported_export_elements": list(self.unsupported_export_elements),
            "fingerprint_contributors": list(self.fingerprint_contributors),
            "fingerprint_fields_used": list(self.fingerprint_fields_used),
            "element_export_statuses": self.element_statuses,
            "unsupported_export_reasons": self.unsupported_reasons,
        }


# New editor elements must be registered here with explicit editor state, autosave,
# preview, render-plan, fingerprint, and export behavior before they ship.
EDITOR_ELEMENT_REGISTRY: tuple[EditorElementContract, ...] = (
    EditorElementContract(
        element_type="video_sequence",
        label="Video Sequence",
        editor_state_fields=(
            "video_sequence",
            "video_sequence_initialized",
            "media_sequence",
            "media_trim",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=(
            "video_sequence",
            "video_sequence_initialized",
            "media_sequence",
            "media_trim",
        ),
        timeline_track="video",
    ),
    EditorElementContract(
        element_type="audio_sequence",
        label="Audio Sequence",
        editor_state_fields=(
            "audio_sequence",
            "audio_sequence_initialized",
            "audio_extracted",
            "audio_settings",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=(
            "audio_sequence",
            "audio_sequence_initialized",
            "audio_extracted",
            "audio_settings",
        ),
        timeline_track="audio",
    ),
    EditorElementContract(
        element_type="caption_timeline",
        label="Caption Timeline",
        editor_state_fields=("caption_timeline", "caption_timeline_initialized"),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=("caption_timeline", "caption_timeline_initialized"),
        timeline_track="caption",
    ),
    EditorElementContract(
        element_type="caption_style",
        label="Caption Style",
        editor_state_fields=(
            "caption_style",
            "caption_mode",
            "caption_max_words",
            "caption_max_chars",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="partial_export",
        fingerprint_fields=(
            "caption_style",
            "caption_mode",
            "caption_max_words",
            "caption_max_chars",
        ),
        timeline_track="caption",
        unsupported_reason=CAPTION_STYLE_PARTIAL_REASON,
    ),
    EditorElementContract(
        element_type="hook_timeline",
        label="Hook Timeline",
        editor_state_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "hook_text",
            "hook_text_enabled",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "hook_text",
            "hook_text_enabled",
        ),
        timeline_track="hook",
    ),
    EditorElementContract(
        element_type="hook_style",
        label="Hook Style",
        editor_state_fields=(
            "hook_text_template",
            "hook_text_font",
            "hook_text_position",
            "hook_text_size",
            "hook_text_style_preset",
            "hook_text_color",
            "hook_text_font_weight",
            "hook_text_outline_color",
            "hook_text_outline_width",
            "hook_text_background_color",
            "hook_text_background_opacity",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="partial_export",
        fingerprint_fields=(
            "hook_text_template",
            "hook_text_font",
            "hook_text_position",
            "hook_text_size",
            "hook_text_style_preset",
            "hook_text_color",
            "hook_text_font_weight",
            "hook_text_outline_color",
            "hook_text_outline_width",
            "hook_text_background_color",
            "hook_text_background_opacity",
        ),
        timeline_track="hook",
        unsupported_reason=(
            "Unified Hook text style, font fallback, position, and size are exported, but "
            "legacy hook_text_template box treatments are not yet reproduced exactly."
        ),
    ),
    EditorElementContract(
        element_type="keyword_event",
        label="Keyword Event",
        editor_state_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "keyword_popup_enabled",
            "keyword_text_style_preset",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "keyword_popup_enabled",
            "keyword_text_style_preset",
        ),
        timeline_track="keyword",
    ),
    EditorElementContract(
        element_type="punch_zoom",
        label="Punch Zoom",
        editor_state_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "punch_zoom_enabled",
            "style_intensity",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "punch_zoom_enabled",
            "style_intensity",
        ),
        timeline_track="punch",
    ),
    EditorElementContract(
        element_type="pattern_effect",
        label="Pattern Effect",
        editor_state_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "pattern_interrupt_enabled",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="unsupported_export",
        fingerprint_fields=(
            "effect_timeline",
            "effect_timeline_initialized",
            "pattern_interrupt_enabled",
        ),
        timeline_track="pattern",
        unsupported_reason=(
            "Pattern events are preserved in the render plan but no matching FFmpeg effect "
            "is currently applied."
        ),
    ),
    EditorElementContract(
        element_type="video_framing",
        label="Video Framing",
        editor_state_fields=("video_framing",),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=("video_framing",),
        timeline_track="video",
    ),
    EditorElementContract(
        element_type="template_layout",
        label="Template Layout",
        editor_state_fields=("clipper_style_preset",),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=("clipper_style_preset", "render.preset"),
        timeline_track="video",
    ),
    EditorElementContract(
        element_type="track_state",
        label="Track State",
        editor_state_fields=(
            "video_track_deleted",
            "audio_track_deleted",
            "layer_order",
            "track_order",
            "editor_state_version",
        ),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="partial_export",
        fingerprint_fields=(
            "video_track_deleted",
            "audio_track_deleted",
            "editor_state_version",
        ),
        unsupported_reason=(
            "Deleted video/audio track state is exported, but layer_order and track_order "
            "do not yet drive a complete export compositor."
        ),
    ),
    EditorElementContract(
        element_type="additional_audio",
        label="Additional Audio",
        editor_state_fields=("additional_audio_assets", "additional_audio_tracks"),
        autosave_supported=True,
        preview_supported=True,
        render_plan_supported=True,
        export_status="supported_export",
        fingerprint_fields=("additional_audio_assets", "additional_audio_tracks"),
        timeline_track="audio",
    ),
)


def registry_by_type() -> dict[str, EditorElementContract]:
    return {contract.element_type: contract for contract in EDITOR_ELEMENT_REGISTRY}


def fingerprint_style_fields() -> tuple[str, ...]:
    fields: list[str] = []
    for contract in EDITOR_ELEMENT_REGISTRY:
        for field in contract.fingerprint_fields:
            if field.startswith("render.") or field in fields:
                continue
            fields.append(field)
    return tuple(fields)


def registry_contract_errors() -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for contract in EDITOR_ELEMENT_REGISTRY:
        if contract.element_type in seen:
            errors.append(f"duplicate element_type: {contract.element_type}")
        seen.add(contract.element_type)
        if contract.export_status in {"supported_export", "partial_export"}:
            if not contract.fingerprint_fields:
                errors.append(
                    f"{contract.element_type} affects export but has no fingerprint_fields"
                )
        if contract.preview_supported and contract.export_status != "supported_export":
            if not contract.unsupported_reason:
                errors.append(
                    f"{contract.element_type} is not fully export-supported without a reason"
                )
    return errors


def _event_types(config: dict[str, Any]) -> set[str]:
    events = config.get("effect_timeline")
    if not isinstance(events, list):
        return set()
    return {
        str(event.get("type"))
        for event in events
        if isinstance(event, dict) and event.get("type")
    }


def _has_sequence_state(config: dict[str, Any], name: str) -> bool:
    return bool(
        config.get(name)
        or config.get(f"{name}_initialized")
        or config.get("editor_state_version", 0) >= 1
    )


def _is_active(
    contract: EditorElementContract,
    config: dict[str, Any],
    event_types: set[str],
) -> bool:
    element_type = contract.element_type
    if element_type == "video_sequence":
        return _has_sequence_state(config, "video_sequence")
    if element_type == "audio_sequence":
        return _has_sequence_state(config, "audio_sequence") or bool(
            config.get("audio_extracted")
        )
    if element_type == "caption_timeline":
        return _has_sequence_state(config, "caption_timeline")
    if element_type == "caption_style":
        return _has_sequence_state(config, "caption_timeline") or bool(
            config.get("caption_style")
        )
    if element_type == "hook_timeline":
        return "hook_text" in event_types or bool(config.get("hook_text"))
    if element_type == "hook_style":
        return ("hook_text" in event_types or bool(config.get("hook_text"))) and any(
            config.get(field) is not None for field in contract.editor_state_fields
        )
    if element_type == "keyword_event":
        return "keyword_popup" in event_types or bool(config.get("keyword_popup_enabled"))
    if element_type == "punch_zoom":
        return "punch_zoom" in event_types
    if element_type == "pattern_effect":
        return "pattern_interrupt" in event_types
    if element_type in {"video_framing", "template_layout"}:
        return True
    if element_type == "track_state":
        return any(
            bool(config.get(field))
            for field in ("video_track_deleted", "audio_track_deleted", "layer_order", "track_order")
        )
    if element_type == "additional_audio":
        return bool(config.get("additional_audio_assets") or config.get("additional_audio_tracks"))
    return any(config.get(field) is not None for field in contract.editor_state_fields)


def audit_editor_elements(
    style_config: dict[str, Any],
) -> ElementRenderAudit:
    event_types = _event_types(style_config)
    active_contracts = [
        contract
        for contract in EDITOR_ELEMENT_REGISTRY
        if _is_active(contract, style_config, event_types)
    ]
    supported = [
        contract.element_type
        for contract in active_contracts
        if contract.export_status == "supported_export"
    ]
    partial = [
        contract.element_type
        for contract in active_contracts
        if contract.export_status == "partial_export"
    ]
    unsupported_contracts = [
        contract
        for contract in active_contracts
        if contract.export_status in {"partial_export", "unsupported_export"}
    ]
    fingerprint_fields: list[str] = []
    contributors: list[str] = []
    for contract in active_contracts:
        if contract.fingerprint_fields:
            contributors.append(contract.element_type)
        for field in contract.fingerprint_fields:
            if field not in fingerprint_fields:
                fingerprint_fields.append(field)

    return ElementRenderAudit(
        active_editor_elements=tuple(
            contract.element_type for contract in active_contracts
        ),
        supported_export_elements=tuple(supported),
        partial_export_elements=tuple(partial),
        unsupported_export_elements=tuple(
            contract.element_type for contract in unsupported_contracts
        ),
        fingerprint_contributors=tuple(contributors),
        fingerprint_fields_used=tuple(fingerprint_fields),
        element_statuses={
            contract.element_type: contract.export_status
            for contract in active_contracts
        },
        unsupported_reasons={
            contract.element_type: str(contract.unsupported_reason)
            for contract in unsupported_contracts
        },
    )
