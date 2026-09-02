from dataclasses import dataclass
from typing import Any

from app.services.clipper_style import normalize_clipper_style, resolve_media_sequence
from app.services.editor_elements import ElementRenderAudit, audit_editor_elements


@dataclass(frozen=True)
class EditorRenderPlan:
    style_config: dict[str, Any]
    editor_state_found: bool
    video_sequence_initialized: bool
    audio_sequence_initialized: bool
    caption_timeline_initialized: bool
    effect_timeline_initialized: bool
    video_sequence: list[dict[str, Any]]
    audio_sequence: list[dict[str, Any]]
    media_sequence: list[dict[str, Any]]
    caption_timeline: list[dict[str, Any]]
    effect_timeline: list[dict[str, Any]]
    element_audit: ElementRenderAudit


@dataclass(frozen=True)
class CaptionRenderSelection:
    source: str
    cues: list[tuple[float, float, str]]
    rich_cues: list[dict[str, Any]] = ()


@dataclass(frozen=True)
class HookRenderSelection:
    source: str
    events: list[dict[str, Any]]
    duplicate_suppressed: bool


@dataclass(frozen=True)
class HookRenderModel:
    source: str
    event_id: str | None
    text: str
    start: float
    end: float
    style_config: dict[str, Any]
    hook_event_count: int
    duplicate_suppressed: bool


def _timeline_initialized(config: dict[str, Any], key: str) -> bool:
    return bool(
        config.get("editor_state_version", 0) >= 1
        or config.get(f"{key}_initialized", False)
    )


def build_editor_render_plan(
    value: dict[str, Any] | None,
    *,
    candidate_duration: float,
    hook_fallback: str = "",
) -> EditorRenderPlan:
    """Resolve persisted editor state without treating intentional empty arrays as missing."""
    config = normalize_clipper_style(value, hook_fallback)
    video_initialized = _timeline_initialized(config, "video_sequence")
    audio_initialized = _timeline_initialized(config, "audio_sequence")
    caption_initialized = _timeline_initialized(config, "caption_timeline")
    effect_initialized = _timeline_initialized(config, "effect_timeline")
    editor_state_found = bool(
        config.get("editor_state_version", 0) >= 1
        or video_initialized
        or audio_initialized
        or caption_initialized
        or effect_initialized
    )

    fallback_sequence = resolve_media_sequence(
        config.get("media_sequence"),
        candidate_duration,
        config.get("media_trim"),
    )
    saved_video_sequence = config.get("video_sequence", [])
    if saved_video_sequence:
        video_sequence = resolve_media_sequence(
            saved_video_sequence,
            candidate_duration,
            config.get("media_trim"),
        )
    elif video_initialized:
        video_sequence = []
    else:
        video_sequence = fallback_sequence

    saved_audio_sequence = config.get("audio_sequence", [])
    if config.get("audio_extracted") and saved_audio_sequence:
        audio_sequence = resolve_media_sequence(
            saved_audio_sequence,
            candidate_duration,
            config.get("media_trim"),
        )
    elif config.get("audio_extracted") and audio_initialized:
        audio_sequence = []
    else:
        audio_sequence = video_sequence

    # FFmpeg still needs a source duration when a track was intentionally deleted.
    # The deleted-track flags blank/mute that source later in the compositor.
    media_sequence = video_sequence
    if not media_sequence:
        media_sequence = audio_sequence or fallback_sequence

    return EditorRenderPlan(
        style_config=config,
        editor_state_found=editor_state_found,
        video_sequence_initialized=video_initialized,
        audio_sequence_initialized=audio_initialized,
        caption_timeline_initialized=caption_initialized,
        effect_timeline_initialized=effect_initialized,
        video_sequence=video_sequence,
        audio_sequence=audio_sequence,
        media_sequence=media_sequence,
        caption_timeline=list(config.get("caption_timeline", [])),
        effect_timeline=list(config.get("effect_timeline", [])),
        element_audit=audit_editor_elements(config),
    )


def resolve_caption_render_cues(
    plan: EditorRenderPlan,
    fallback_cues: list[tuple[float, float, str]],
    *,
    render_duration: float,
) -> CaptionRenderSelection:
    """Select caption text without restoring transcript cues over editor state."""
    if plan.caption_timeline_initialized or plan.caption_timeline:
        valid_items = [
            dict(item)
            for item in plan.caption_timeline
            if float(item.get("start", 0)) < render_duration
            and min(render_duration, float(item.get("end", 0))) > float(item.get("start", 0))
        ]
        cues = [
            (
                max(0.0, float(item["start"])),
                min(render_duration, float(item["end"])),
                str(item.get("text", "")),
            )
            for item in valid_items
        ]
        return CaptionRenderSelection(source="editor_state", cues=cues, rich_cues=valid_items)

    fallback_rich = [
        {"id": f"cue-{i}", "start": start, "end": end, "text": text}
        for i, (start, end, text) in enumerate(fallback_cues)
    ]
    return CaptionRenderSelection(
        source="candidate_default",
        cues=list(fallback_cues),
        rich_cues=fallback_rich,
    )


def resolve_hook_render_events(
    style_config: dict[str, Any] | None,
    effect_timeline: list[dict[str, Any]],
    legacy_hook_text: str = "",
) -> HookRenderSelection:
    config = style_config if isinstance(style_config, dict) else {}
    hook_events = [
        dict(event)
        for event in effect_timeline
        if event.get("type") == "hook_text" and str(event.get("text") or "").strip()
    ]
    timeline_initialized = bool(
        int(config.get("editor_state_version") or 0) >= 1
        or config.get("effect_timeline_initialized")
    )
    if hook_events:
        hook_events.sort(
            key=lambda event: (
                float(event.get("start") or 0),
                str(event.get("id") or ""),
            )
        )
        configured_source = str(config.get("_hook_timeline_source") or "")
        return HookRenderSelection(
            source=(
                configured_source
                if configured_source in {"editor_state", "legacy"}
                else "editor_state"
            ),
            events=hook_events,
            duplicate_suppressed=bool(config.get("hook_text")),
        )
    if timeline_initialized:
        return HookRenderSelection(
            source="none",
            events=[],
            duplicate_suppressed=bool(config.get("hook_text") or legacy_hook_text),
        )

    fallback_text = str(config.get("hook_text") or legacy_hook_text or "").strip()
    if config.get("hook_text_enabled") and fallback_text:
        return HookRenderSelection(
            source="legacy",
            events=[{"type": "hook_text", "start": 0.0, "end": 3.0, "text": fallback_text}],
            duplicate_suppressed=False,
        )
    return HookRenderSelection(source="none", events=[], duplicate_suppressed=False)


def resolve_hook_render_model(
    style_config: dict[str, Any] | None,
    effect_timeline: list[dict[str, Any]],
    legacy_hook_text: str = "",
) -> HookRenderModel | None:
    config = style_config if isinstance(style_config, dict) else {}
    selection = resolve_hook_render_events(config, effect_timeline, legacy_hook_text)
    if not selection.events:
        return None
    event = selection.events[0]
    return HookRenderModel(
        source=selection.source,
        event_id=str(event.get("id")) if event.get("id") else None,
        text=str(event.get("text") or "").strip(),
        start=max(0.0, float(event.get("start") or 0.0)),
        end=max(0.0, float(event.get("end") or 3.0)),
        style_config=dict(config),
        hook_event_count=len(selection.events),
        duplicate_suppressed=selection.duplicate_suppressed
        or len(selection.events) > 1,
    )
