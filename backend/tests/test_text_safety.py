from app.services.clipper_style import (
    extract_keywords,
    normalize_audio_settings,
    normalize_caption_timeline,
    normalize_clipper_style,
    normalize_media_sequence,
    normalize_media_trim,
    resolve_media_sequence,
    resolve_media_trim,
    safe_hook_text,
    sanitize_keyword_text,
    validate_effect_timeline,
)
from app.services.media import (
    _audio_filter,
    _ffmpeg_text,
    _keyword_overlay_text,
)

PROBLEM_TEXT = (
    "Nah, APBD kita tuh, terus kita harus rapi-rapiin, cari efisiensi. "
    "Pendidikan-kesehatan gratis 100 hari. “Saya” bilang: 1,3 juta warga."
)
MOJIBAKE_TEXT = "é Â Ã � – — ’ “"


def test_keyword_and_hook_sanitizers_accept_indonesian_unicode_text():
    keywords = extract_keywords(PROBLEM_TEXT, MOJIBAKE_TEXT)

    assert keywords
    assert sanitize_keyword_text(PROBLEM_TEXT)
    assert safe_hook_text(PROBLEM_TEXT)


def test_invalid_keyword_events_are_skipped_without_throwing():
    events = [
        {
            "type": "keyword_popup",
            "start": 0,
            "end": 1.2,
            "text": MOJIBAKE_TEXT,
            "reason": "bad text",
        },
        {
            "type": "keyword_popup",
            "start": 2,
            "end": 3.2,
            "text": "APBD kita tuh",
            "reason": "valid text",
        },
    ]

    valid = validate_effect_timeline(events, 10)

    assert valid == [
        {
            "type": "keyword_popup",
            "start": 2,
            "end": 3.2,
            "reason": "valid text",
            "text": "APBD",
        }
    ]


def test_ffmpeg_text_escaping_handles_punctuation_and_mojibake():
    text = f"colon: comma, percent% quote' bracket[ok] slash\\ {MOJIBAKE_TEXT} {PROBLEM_TEXT}"
    escaped = _ffmpeg_text(text)

    assert "\\:" in escaped
    assert "\\," in escaped
    assert "\\%" in escaped
    assert "\\'" in escaped
    assert "\\[" in escaped
    assert "\\\\" in escaped
    assert "�" not in escaped


def test_keyword_overlay_text_skips_non_meaningful_mojibake():
    assert _keyword_overlay_text(MOJIBAKE_TEXT) == ""


def test_audio_settings_are_clamped_and_safe():
    assert normalize_audio_settings(
        {"volume": 9, "muted": True, "fade_in": -2, "fade_out": 12}
    ) == {
        "volume": 2.0,
        "muted": True,
        "fade_in": 0.0,
        "fade_out": 5.0,
    }


def test_deleted_track_flags_are_normalized():
    normalized = normalize_clipper_style(
        {
            "video_track_deleted": 1,
            "audio_track_deleted": True,
            "additional_audio_assets": [{"id": "asset-1"}],
            "additional_audio_tracks": [{"id": "track-1"}],
        }
    )

    assert normalized["video_track_deleted"] is True
    assert normalized["audio_track_deleted"] is True
    assert normalized["additional_audio_assets"] == [{"id": "asset-1"}]
    assert normalized["additional_audio_tracks"] == [{"id": "track-1"}]


def test_saved_editor_state_keeps_empty_tracks_and_normalizes_layer_order():
    normalized = normalize_clipper_style(
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
            "layer_order": ["hook", "caption", "hook", "invalid", "video"],
        }
    )

    assert normalized["editor_state_version"] == 1
    assert normalized["video_sequence"] == []
    assert normalized["audio_sequence"] == []
    assert normalized["caption_timeline"] == []
    assert normalized["effect_timeline"] == []
    assert normalized["layer_order"] == [
        "hook",
        "caption",
        "video",
        "keyword",
        "punch",
        "pattern",
        "audio",
    ]


def test_media_trim_is_normalized_and_resolved_inside_source_duration():
    assert normalize_media_trim({"start": -2, "end": "invalid"}) == {
        "start": 0.0,
        "end": None,
    }
    assert resolve_media_trim({"start": 10, "end": 30}, 60) == (10.0, 30.0)
    assert resolve_media_trim({"start": 99, "end": 2}, 60) == (59.9, 60.0)


def test_media_sequence_supports_ordered_and_repeated_source_ranges():
    sequence = [
        {"id": "a", "source_start": 2, "source_end": 5},
        {"id": "copy", "source_start": 2, "source_end": 5},
        {"id": "bad", "source_start": 8, "source_end": 7},
    ]

    assert normalize_media_sequence(sequence) == [
        {"id": "a", "source_start": 2.0, "source_end": 5.0},
        {"id": "copy", "source_start": 2.0, "source_end": 5.0},
    ]
    assert resolve_media_sequence(sequence, 10) == [
        {"id": "a", "source_start": 2.0, "source_end": 5.0},
        {"id": "copy", "source_start": 2.0, "source_end": 5.0},
    ]


def test_caption_timeline_keeps_only_valid_editable_cues():
    assert normalize_caption_timeline(
        [
            {"id": "a", "start": 1, "end": 2.5, "text": " Caption baru "},
            {"id": "bad", "start": 4, "end": 3, "text": "rusak"},
        ]
    ) == [{"id": "a", "start": 1.0, "end": 2.5, "text": "Caption baru"}]


def test_audio_filter_applies_volume_and_fades():
    value = _audio_filter(
        {
            "audio_settings": {
                "volume": 0.75,
                "muted": False,
                "fade_in": 1.5,
                "fade_out": 2,
            }
        },
        10,
    )

    assert value == "volume=0.75,afade=t=in:st=0:d=1.50,afade=t=out:st=8.00:d=2.00"
