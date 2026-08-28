from app.services.editor_elements import (
    EDITOR_ELEMENT_REGISTRY,
    audit_editor_elements,
    registry_by_type,
    registry_contract_errors,
)
from app.services.render_cache import RENDER_STYLE_KEYS, render_fingerprint
from app.services.render_plan import build_editor_render_plan

CORE_ELEMENT_TYPES = {
    "video_sequence",
    "audio_sequence",
    "caption_timeline",
    "caption_style",
    "hook_timeline",
    "hook_style",
    "keyword_event",
    "punch_zoom",
    "pattern_effect",
    "video_framing",
    "template_layout",
    "track_state",
}


def fingerprint(style_config: dict) -> str:
    return render_fingerprint(
        style_config,
        preset="center_crop",
        subtitle_language="id",
        width=540,
        height=960,
        frame_rate=30,
        preview=False,
    )


def active_style_config() -> dict:
    return {
        "editor_state_version": 1,
        "video_sequence_initialized": True,
        "audio_sequence_initialized": True,
        "caption_timeline_initialized": True,
        "effect_timeline_initialized": True,
        "video_sequence": [{"id": "v1", "source_start": 0, "source_end": 5}],
        "audio_extracted": True,
        "audio_sequence": [{"id": "a1", "source_start": 0, "source_end": 5}],
        "caption_timeline": [
            {"id": "c1", "start": 0, "end": 1, "text": "Caption"}
        ],
        "caption_style": {
            "preset": "clean_white",
            "textPreset": "clean_white",
            "displayMode": "segment",
        },
        "hook_text": "Hook audit",
        "hook_text_enabled": True,
        "hook_text_template": "breaking_news",
        "hook_text_font": "condensed_news",
        "hook_text_position": "top",
        "hook_text_size": "normal",
        "hook_text_style_preset": "modern_sans",
        "keyword_popup_enabled": True,
        "keyword_text_style_preset": "yellow_viral",
        "punch_zoom_enabled": True,
        "pattern_interrupt_enabled": True,
        "effect_timeline": [
            {"type": "hook_text", "start": 0, "end": 1, "text": "Hook audit"},
            {"type": "keyword_popup", "start": 1, "end": 2, "text": "ANGGARAN"},
            {"type": "punch_zoom", "start": 2, "end": 3, "zoom": 1.08},
            {
                "type": "pattern_interrupt",
                "start": 3,
                "end": 4,
                "effect": "flash_cut",
            },
        ],
        "video_framing": {"x": 10, "y": 0, "scale": 1.2},
        "video_track_deleted": False,
        "audio_track_deleted": False,
        "layer_order": ["caption", "hook", "keyword", "video"],
    }


def test_registry_contains_every_core_editor_element() -> None:
    assert CORE_ELEMENT_TYPES <= set(registry_by_type())
    assert registry_contract_errors() == []


def test_exported_elements_have_fingerprint_fields_registered() -> None:
    render_style_fields = set(RENDER_STYLE_KEYS)
    for contract in EDITOR_ELEMENT_REGISTRY:
        if contract.export_status not in {"supported_export", "partial_export"}:
            continue
        assert contract.fingerprint_fields
        assert all(
            field.startswith("render.") or field in render_style_fields
            for field in contract.fingerprint_fields
        )


def test_preview_elements_without_full_export_support_have_explicit_reason() -> None:
    for contract in EDITOR_ELEMENT_REGISTRY:
        if contract.preview_supported and contract.export_status != "supported_export":
            assert contract.unsupported_reason


def test_render_plan_audit_never_drops_an_active_element_without_status() -> None:
    plan = build_editor_render_plan(active_style_config(), candidate_duration=5)
    audit = plan.element_audit
    classified = set(audit.supported_export_elements) | set(
        audit.unsupported_export_elements
    )

    assert set(audit.active_editor_elements) == classified
    assert {
        "caption_timeline",
        "hook_timeline",
        "hook_style",
        "keyword_event",
        "punch_zoom",
        "pattern_effect",
        "video_framing",
        "template_layout",
    } <= set(audit.active_editor_elements)
    assert "hook_style" in audit.partial_export_elements
    assert "pattern_effect" in audit.unsupported_export_elements
    assert "caption_style" in audit.partial_export_elements
    assert "keyword_event" in audit.supported_export_elements


def test_hook_style_partial_export_fields_are_fingerprinted() -> None:
    contracts = registry_by_type()
    hook_style = contracts["hook_style"]
    audit = audit_editor_elements(active_style_config())

    assert hook_style.export_status == "partial_export"
    assert hook_style.unsupported_reason
    assert "hook_style" in audit.unsupported_export_elements
    assert "hook_text_template" in RENDER_STYLE_KEYS
    assert "hook_text_font" in RENDER_STYLE_KEYS
    assert "hook_text_position" in RENDER_STYLE_KEYS
    assert "hook_text_size" in RENDER_STYLE_KEYS
    assert "hook_text_style_preset" in hook_style.editor_state_fields
    assert "hook_text_style_preset" in RENDER_STYLE_KEYS


def test_caption_style_partial_reason_names_the_remaining_gap() -> None:
    caption_style = registry_by_type()["caption_style"]

    assert caption_style.export_status == "partial_export"
    assert "Karaoke" in str(caption_style.unsupported_reason)
    assert "estimated uniform timing" in str(caption_style.unsupported_reason)
    assert "not pixel-perfect" in str(caption_style.unsupported_reason)
    assert "caption_style" in RENDER_STYLE_KEYS


def test_supported_visual_inputs_change_render_fingerprint() -> None:
    base = active_style_config()
    base_fingerprint = fingerprint(base)

    assert fingerprint(
        {
            **base,
            "caption_timeline": [
                {"id": "c1", "start": 0, "end": 1, "text": "Caption edit"}
            ],
        }
    ) != base_fingerprint
    assert fingerprint(
        {**base, "video_framing": {"x": -10, "y": 0, "scale": 1.2}}
    ) != base_fingerprint
    assert fingerprint(
        {
            **base,
            "effect_timeline": [
                {"type": "punch_zoom", "start": 1, "end": 2, "zoom": 1.15}
            ],
        }
    ) != base_fingerprint
