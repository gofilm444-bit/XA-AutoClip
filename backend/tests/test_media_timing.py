from pathlib import Path

import pytest

from app.services.hook_safe_area import (
    estimate_hook_text_width,
    resolve_hook_safe_area,
)
from app.services.media import (
    _audio_mix_filter,
    _caption_subtitle_filter,
    _ffmpeg_speed,
    _style_filter_suffix,
)


def test_ffmpeg_speed_returns_last_progress_value() -> None:
    stderr = "frame= 10 speed=0.82x\nframe= 20 speed=1.25x\n"

    assert _ffmpeg_speed(stderr) == "1.25x"


def test_ffmpeg_speed_handles_missing_progress() -> None:
    assert _ffmpeg_speed(None) is None
    assert _ffmpeg_speed("ffmpeg completed without progress output") is None


def test_caption_render_path_contains_exactly_one_subtitles_filter() -> None:
    caption_filter = _caption_subtitle_filter(Path("C:/render/caption.ass"))

    assert caption_filter.count("subtitles=") == 1
    assert "drawtext=" not in caption_filter


def test_audio_mix_filter_clamps_every_input_to_master_duration() -> None:
    graph = _audio_mix_filter(
        3,
        10.0,
        [0.0, 2.0, 8.0],
        [None, 20.0, 14.0],
        [1.0, 0.8, 0.5],
    )

    assert graph.count("amix=inputs=3") == 1
    assert graph.count("atrim=duration=10.000") == 5
    assert "adelay=2000:all=1" in graph
    assert "adelay=8000:all=1" in graph
    assert graph.endswith("atrim=duration=10.000,asetpts=PTS-STARTPTS[finalaudio]")


def test_text_overlay_filter_exports_timeline_timing_and_unified_styles() -> None:
    filter_suffix = _style_filter_suffix(
        {
            "hook_text_enabled": False,
            "hook_text_style_preset": "modern_sans",
            "hook_text_font": "condensed_news",
            "keyword_popup_enabled": False,
            "keyword_text_style_preset": "yellow_viral",
        },
        540,
        960,
        effect_timeline=[
            {"type": "hook_text", "start": 0.5, "end": 2.5, "text": "Hook aman"},
            {"type": "keyword_popup", "start": 3, "end": 4, "text": "kata kunci"},
        ],
    )

    assert "HOOK" not in filter_suffix
    assert "Hook aman" in filter_suffix
    assert "font='DejaVu Sans Condensed Bold'" in filter_suffix
    assert "enable='between(t,0.5,2.5)'" in filter_suffix
    assert "KATA KUNCI" in filter_suffix
    assert "fontcolor=0xFDE047" in filter_suffix
    assert "enable='between(t,3.0,4.0)'" in filter_suffix


def test_hook_export_renders_one_selected_event_with_editor_style() -> None:
    filter_suffix = _style_filter_suffix(
        {
            "editor_state_version": 1,
            "effect_timeline_initialized": True,
            "hook_text_style_preset": "gaming_neon",
            "hook_text_position": "safe_top",
            "hook_text_size": "large",
        },
        540,
        960,
        effect_timeline=[
            {"id": "first", "type": "hook_text", "start": 0, "end": 2, "text": "TES HOOK STYLE BARU 12345"},
            {"id": "second", "type": "hook_text", "start": 2, "end": 4, "text": "Jangan render"},
        ],
    )

    assert filter_suffix.count("drawtext=") == 2
    assert "TES HOOK STYLE BARU" in filter_suffix
    assert "12345" in filter_suffix
    assert "Jangan render" not in filter_suffix
    assert "0xA3E635" in filter_suffix


def test_hook_safe_area_clamps_large_top_hook_and_limits_two_lines() -> None:
    result = resolve_hook_safe_area(
        "safe_top",
        160,
        "Hook panjang " * 20,
        540,
        960,
    )

    assert result.top_px >= 24
    assert result.font_size_px <= 43
    assert result.line_count == 2
    assert result.truncated is True


@pytest.mark.parametrize(
    ("width", "height", "requested_font"),
    [(540, 960, 35), (720, 1280, 46), (1080, 1920, 69)],
)
def test_hook_layout_stays_inside_horizontal_safe_width(
    width,
    height,
    requested_font,
) -> None:
    result = resolve_hook_safe_area(
        "safe_top",
        requested_font,
        "Awalnya cuma niat baik, tapi kisahnya berubah jadi kacau",
        width,
        height,
    )

    assert 1 <= result.line_count <= 2
    assert all(
        estimate_hook_text_width(line, result.font_size_px) <= result.safe_width_px
        for line in result.lines
    )
    assert result.text_width_estimated <= result.safe_width_px


def test_hook_layout_clamps_font_then_truncates_extreme_text() -> None:
    result = resolve_hook_safe_area(
        "safe_top",
        48,
        " ".join(["keputusan"] * 80),
        540,
        960,
    )

    assert result.font_size_px < 48
    assert result.line_count == 2
    assert result.truncated is True
    assert result.lines[-1].endswith("...")
    assert result.font_size_clamped_reason == "frame_height+safe_width+extreme_text_truncated"


def test_hook_layout_normalizes_whitespace_without_merging_words() -> None:
    result = resolve_hook_safe_area(
        "safe_top",
        30,
        "Awalnya   cuma\nniat baik, tapi   kisahnya berubah",
        540,
        960,
    )

    assert "tapinkisa" not in result.wrapped_text
    assert "tapi kisahnya" in result.wrapped_text.replace("\n", " ")
    assert "  " not in result.wrapped_text


def test_short_hook_keeps_single_line_and_requested_font() -> None:
    result = resolve_hook_safe_area("safe_top", 30, "Hook aman", 540, 960)

    assert result.lines == ("Hook aman",)
    assert result.font_size_px == 30
    assert result.wrap_applied is False
    assert result.truncated is False


def test_hook_export_uses_wrapped_lines_and_clamped_x_expression() -> None:
    raw_hook = "Awalnya cuma niat baik, tapi kisahnya berubah jadi kacau"
    filter_suffix = _style_filter_suffix(
        {
            "hook_text_enabled": True,
            "hook_text_position": "safe_top",
            "hook_text_size": "large",
            "hook_text_style_preset": "red_alert",
        },
        540,
        960,
        hook_text=raw_hook,
    )

    assert filter_suffix.count("drawtext=") == 2
    assert "x=max(w*0.09\\,min((w-text_w)/2\\,w*0.91-text_w))" in filter_suffix
    assert f"text='{raw_hook}'" not in filter_suffix
