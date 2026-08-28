from app.services.render_plan import (
    build_editor_render_plan,
    resolve_caption_render_cues,
    resolve_hook_render_events,
    resolve_hook_render_model,
)


def test_render_plan_uses_latest_editor_state_as_authoritative_input():
    plan = build_editor_render_plan(
        {
            "editor_state_version": 1,
            "video_sequence_initialized": True,
            "audio_sequence_initialized": True,
            "caption_timeline_initialized": True,
            "effect_timeline_initialized": True,
            "video_framing": {"x": 18, "y": -6, "scale": 1.35},
            "video_sequence": [
                {"id": "video-edit", "source_start": 2, "source_end": 7},
            ],
            "audio_extracted": True,
            "audio_sequence": [
                {"id": "audio-edit", "source_start": 3, "source_end": 8},
            ],
            "caption_timeline": [
                {"id": "caption-edit", "start": 0.2, "end": 1.4, "text": "Caption TEST"},
            ],
            "caption_style": {"textPreset": "clean_white"},
            "hook_text_style_preset": "modern_sans",
            "keyword_text_style_preset": "yellow_viral",
            "effect_timeline": [
                {"id": "hook-edit", "type": "hook_text", "start": 0, "end": 1, "text": "Hook TEST"},
                {"id": "keyword-edit", "type": "keyword_popup", "start": 1, "end": 2, "text": "KUNCI"},
                {"id": "effect-edit", "type": "punch_zoom", "start": 2, "end": 3},
            ],
        },
        candidate_duration=10,
    )

    assert plan.editor_state_found is True
    assert plan.style_config["video_framing"] == {"x": 18.0, "y": -6.0, "scale": 1.35}
    assert plan.video_sequence == [
        {"id": "video-edit", "source_start": 2.0, "source_end": 7.0},
    ]
    assert plan.audio_sequence == [
        {"id": "audio-edit", "source_start": 3.0, "source_end": 8.0},
    ]
    assert plan.caption_timeline[0]["text"] == "Caption TEST"
    assert plan.style_config["caption_style"]["textPreset"] == "clean_white"
    assert plan.style_config["hook_text_style_preset"] == "modern_sans"
    assert plan.style_config["keyword_text_style_preset"] == "yellow_viral"
    assert plan.effect_timeline[0] == {
        "id": "hook-edit",
        "type": "hook_text",
        "start": 0.0,
        "end": 1.0,
        "text": "Hook TEST",
    }
    assert plan.effect_timeline[1]["text"] == "KUNCI"


def test_render_plan_does_not_regenerate_intentionally_empty_editor_timelines():
    plan = build_editor_render_plan(
        {
            "editor_state_version": 1,
            "video_sequence_initialized": True,
            "audio_sequence_initialized": True,
            "caption_timeline_initialized": True,
            "effect_timeline_initialized": True,
            "video_sequence": [],
            "audio_sequence": [],
            "caption_timeline": [],
            "effect_timeline": [],
            "video_track_deleted": True,
            "audio_track_deleted": True,
        },
        candidate_duration=12,
    )

    assert plan.editor_state_found is True
    assert plan.video_sequence == []
    assert plan.audio_sequence == []
    assert plan.caption_timeline == []
    assert plan.effect_timeline == []
    assert plan.media_sequence == [
        {"id": "media-0", "source_start": 0.0, "source_end": 12.0},
    ]


def test_legacy_render_plan_can_still_fall_back_to_candidate_timing():
    plan = build_editor_render_plan({}, candidate_duration=9)

    assert plan.editor_state_found is False
    assert plan.video_sequence == [
        {"id": "media-0", "source_start": 0.0, "source_end": 9.0},
    ]
    assert plan.media_sequence == plan.video_sequence


def test_caption_renderer_uses_edited_editor_timeline_when_initialized():
    plan = build_editor_render_plan(
        {
            "editor_state_version": 1,
            "caption_timeline_initialized": True,
            "caption_timeline": [
                {"id": "caption-1", "start": 0, "end": 2, "text": "TEST CAPTION FINAL"},
            ],
        },
        candidate_duration=5,
    )

    selection = resolve_caption_render_cues(
        plan,
        [(0, 2, "Caption mentah")],
        render_duration=5,
    )

    assert selection.source == "editor_state"
    assert selection.cues == [(0.0, 2.0, "TEST CAPTION FINAL")]


def test_initialized_empty_caption_timeline_never_restores_transcript():
    plan = build_editor_render_plan(
        {
            "editor_state_version": 1,
            "caption_timeline_initialized": True,
            "caption_timeline": [],
        },
        candidate_duration=5,
    )

    selection = resolve_caption_render_cues(
        plan,
        [(0, 2, "Caption mentah")],
        render_duration=5,
    )

    assert selection.source == "editor_state"
    assert selection.cues == []


def test_editor_hook_event_suppresses_legacy_hook_text() -> None:
    selection = resolve_hook_render_events(
        {
            "editor_state_version": 1,
            "effect_timeline_initialized": True,
            "hook_text": "Hook legacy",
            "hook_text_enabled": True,
        },
        [{"type": "hook_text", "start": 1, "end": 3, "text": "Hook editor"}],
        "Fallback lama",
    )

    assert selection.source == "editor_state"
    assert [event["text"] for event in selection.events] == ["Hook editor"]
    assert selection.duplicate_suppressed is True


def test_initialized_empty_hook_timeline_never_restores_legacy_hook() -> None:
    selection = resolve_hook_render_events(
        {
            "editor_state_version": 1,
            "effect_timeline_initialized": True,
            "hook_text": "Hook lama",
            "hook_text_enabled": True,
        },
        [],
        "Fallback lama",
    )

    assert selection.source == "none"
    assert selection.events == []
    assert selection.duplicate_suppressed is True


def test_legacy_project_still_gets_one_safe_hook_fallback() -> None:
    selection = resolve_hook_render_events(
        {"hook_text": "Hook legacy", "hook_text_enabled": True},
        [],
    )

    assert selection.source == "legacy"
    assert len(selection.events) == 1
    assert selection.events[0]["text"] == "Hook legacy"


def test_hook_render_model_selects_one_deterministic_editor_event() -> None:
    model = resolve_hook_render_model(
        {"editor_state_version": 1, "effect_timeline_initialized": True},
        [
            {"id": "later", "type": "hook_text", "start": 2, "end": 4, "text": "Later"},
            {"id": "primary", "type": "hook_text", "start": 0, "end": 2, "text": "Primary"},
        ],
    )

    assert model is not None
    assert model.source == "editor_state"
    assert model.event_id == "primary"
    assert model.text == "Primary"
    assert model.hook_event_count == 2
    assert model.duplicate_suppressed is True
