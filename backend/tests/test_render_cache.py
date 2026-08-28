from app.services.render_cache import (
    read_render_cache_metadata,
    render_cache_metadata_path,
    render_fingerprint,
    write_render_cache_metadata,
)


def fingerprint(style_config=None, **overrides):
    options = {
        "preset": "center_crop",
        "subtitle_language": "id",
        "width": 540,
        "height": 960,
        "frame_rate": 30,
        "preview": True,
        **overrides,
    }
    return render_fingerprint(style_config, **options)


def test_render_fingerprint_is_stable_for_equivalent_config():
    first = fingerprint(
        {
            "video_framing": {"x": 10, "y": -5, "scale": 1.25},
            "video_sequence": [{"id": "a", "source_start": 0, "source_end": 10}],
        }
    )
    second = fingerprint(
        {
            "video_sequence": [{"source_end": 10, "source_start": 0, "id": "a"}],
            "video_framing": {"scale": 1.25, "y": -5, "x": 10},
        }
    )

    assert first == second


def test_render_fingerprint_changes_for_each_important_render_input():
    base_style = {
        "video_framing": {"x": 0, "y": 0, "scale": 1},
        "video_sequence": [{"id": "v1", "source_start": 0, "source_end": 10}],
        "audio_sequence": [{"id": "a1", "source_start": 0, "source_end": 10}],
        "caption_timeline": [{"id": "c1", "start": 0, "end": 1, "text": "Halo"}],
        "caption_style": {"textPreset": "clean_white"},
        "effect_timeline": [{"id": "e1", "type": "punch_zoom", "start": 1, "end": 2}],
        "hook_text_style_preset": "modern_sans",
        "keyword_text_style_preset": "yellow_viral",
    }
    base = fingerprint(base_style)

    assert fingerprint({**base_style, "video_framing": {"x": 5, "y": 0, "scale": 1}}) != base
    assert fingerprint({**base_style, "video_sequence": []}) != base
    assert fingerprint({**base_style, "audio_sequence": []}) != base
    assert fingerprint({**base_style, "caption_timeline": []}) != base
    assert fingerprint({**base_style, "effect_timeline": []}) != base
    assert fingerprint(
        {**base_style, "caption_style": {"textPreset": "yellow_viral"}}
    ) != base
    assert fingerprint(
        {
            **base_style,
            "caption_style": {
                "textPreset": "clean_white",
                "textColor": "#12AB34",
                "outlineEnabled": True,
            },
        }
    ) != base
    assert fingerprint(
        {**base_style, "hook_text_style_preset": "gold_premium"}
    ) != base
    assert fingerprint(
        {**base_style, "keyword_text_style_preset": "red_alert"}
    ) != base
    assert fingerprint(base_style, preset="blurred_background") != base
    assert fingerprint(base_style, width=720, height=1280) != base


def test_render_fingerprint_changes_when_voiceover_or_additional_audio_changes():
    voiceover = {
        "voiceover": {
            "asset_id": "voice-1",
            "path": "/storage/voice-1.webm",
            "checksum": "checksum-a",
            "start": 0,
            "end": None,
        },
        "additional_audio": [
            {"asset_id": "music-1", "path": "/storage/music-1.mp3", "start": 1, "end": 9, "volume": 0.5}
        ],
    }
    base = fingerprint({}, audio_identity=voiceover)

    assert fingerprint({}, audio_identity={**voiceover, "voiceover": {**voiceover["voiceover"], "checksum": "checksum-b"}}) != base
    assert fingerprint({}, audio_identity={**voiceover, "additional_audio": [{**voiceover["additional_audio"][0], "start": 2}]}) != base


def test_render_fingerprint_distinguishes_initialized_empty_editor_state():
    legacy = fingerprint({"caption_timeline": [], "effect_timeline": []})
    initialized = fingerprint(
        {
            "editor_state_version": 1,
            "caption_timeline_initialized": True,
            "effect_timeline_initialized": True,
            "caption_timeline": [],
            "effect_timeline": [],
        }
    )

    assert initialized != legacy


def test_render_fingerprint_changes_when_caption_text_is_edited():
    original = fingerprint(
        {"caption_timeline": [{"id": "c1", "start": 0, "end": 2, "text": "Asli"}]}
    )
    edited = fingerprint(
        {
            "caption_timeline": [
                {"id": "c1", "start": 0, "end": 2, "text": "TEST CAPTION FINAL"}
            ]
        }
    )

    assert edited != original


def test_render_fingerprint_changes_for_caption_display_mode_and_highlight():
    base_style = {
        "caption_style": {
            "textPreset": "red_alert",
            "displayMode": "segment",
            "highlightColor": "#FFD400",
        }
    }
    base = fingerprint(base_style)

    assert fingerprint(
        {
            "caption_style": {
                **base_style["caption_style"],
                "displayMode": "karaoke",
            }
        }
    ) != base
    assert fingerprint(
        {
            "caption_style": {
                **base_style["caption_style"],
                "highlightColor": "#22C55E",
            }
        }
    ) != base


def test_render_cache_metadata_round_trip(tmp_path):
    output_path = tmp_path / "render.mp4"
    output_path.write_bytes(b"video")
    expected_fingerprint = fingerprint(
        {"video_framing": {"x": 12, "y": -8, "scale": 1.3}}
    )

    write_render_cache_metadata(
        output_path,
        fingerprint=expected_fingerprint,
        video_framing={"x": 12, "y": -8, "scale": 1.3},
    )

    assert read_render_cache_metadata(output_path) == {
        "fingerprint": expected_fingerprint,
        "video_framing": {"x": 12.0, "y": -8.0, "scale": 1.3},
    }
    assert render_cache_metadata_path(output_path).is_file()


def test_missing_or_invalid_render_cache_metadata_is_a_cache_miss(tmp_path):
    output_path = tmp_path / "legacy.mp4"
    output_path.write_bytes(b"legacy")
    assert read_render_cache_metadata(output_path) is None

    render_cache_metadata_path(output_path).write_text("not-json", encoding="utf-8")
    assert read_render_cache_metadata(output_path) is None
