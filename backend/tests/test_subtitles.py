from types import SimpleNamespace

import pytest

from app.services.subtitles import (
    ASS_PLAY_RES_X,
    BOX_CAPTION_SAFE_WIDTH_RATIO,
    CAPTION_SAFE_WIDTH_RATIO,
    MAX_SUBTITLE_CHARS,
    MAX_SUBTITLE_WORDS,
    _cue_font_size,
    _estimated_text_width,
    _layout_ass_caption,
    _wrap_ass_caption,
    ass_timestamp,
    filter_safe_cues,
    split_cues,
    transcript_cues,
    write_ass_cues,
)


def test_ass_timestamp():
    assert ass_timestamp(65.25) == "0:01:05.25"


def test_subtitle_cues_cover_duration():
    cues = split_cues("satu dua tiga empat lima enam tujuh delapan sembilan", 9)
    assert cues[0][0] == 0
    assert cues[-1][1] == 9
    assert all(len(text.split()) <= MAX_SUBTITLE_WORDS for _, _, text in cues)
    assert all(len(text) <= MAX_SUBTITLE_CHARS for _, _, text in cues)


def test_transcript_cues_follow_clip_timestamps():
    segments = [
        SimpleNamespace(
            start_seconds=20,
            end_seconds=30,
            text="Reporter menjelaskan serangan cepat dari sisi kanan lapangan",
        ),
        SimpleNamespace(
            start_seconds=30,
            end_seconds=36,
            text="dan peluang berakhir menjadi gol",
        ),
    ]

    cues = transcript_cues(segments, clip_start=24, clip_end=34)

    assert cues[0][0] == 0
    assert cues[-1][1] == 10
    assert "Reporter" in cues[0][2]
    assert "gol" in cues[-1][2]
    assert all(len(text.split()) <= MAX_SUBTITLE_WORDS for _, _, text in cues)
    assert all(len(text) <= MAX_SUBTITLE_CHARS for _, _, text in cues)


def test_transcript_cues_split_by_character_limit():
    segments = [
        SimpleNamespace(
            start_seconds=0,
            end_seconds=12,
            text=(
                "Komentator menjelaskan bagaimana tekanan tinggi membuat "
                "lawan kehilangan arah permainan"
            ),
        )
    ]

    cues = transcript_cues(segments, clip_start=0, clip_end=12)

    assert len(cues) > 1
    assert all(len(text) <= MAX_SUBTITLE_CHARS for _, _, text in cues)
    assert all(len(text.split()) <= MAX_SUBTITLE_WORDS for _, _, text in cues)


def test_filter_safe_cues_skips_long_captions():
    cues = [
        (0, 2, "Gol cepat"),
        (2, 4, "Kalimat subtitle yang terlalu panjang dan akan menutupi hampir seluruh video"),
    ]

    assert filter_safe_cues(cues) == [(0, 2, "Gol cepat")]


def test_ass_file_contains_edited_caption_text(tmp_path):
    subtitle_path = tmp_path / "edited-caption.ass"

    write_ass_cues(subtitle_path, [(0, 2, "TEST CAPTION FINAL")])

    assert "TEST CAPTION FINAL" in subtitle_path.read_text(encoding="utf-8")


def test_ass_file_applies_unified_caption_text_style(tmp_path):
    subtitle_path = tmp_path / "styled-caption.ass"

    write_ass_cues(
        subtitle_path,
        [(0, 2, "kata penting")],
        {
            "textPreset": "yellow_viral",
            "fontSize": "small",
            "position": "top",
        },
    )

    content = subtitle_path.read_text(encoding="utf-8")
    assert "Style: Default,DejaVu Sans,54,&H0047E0FD" in content
    assert ",8,76,76,150,1," in content
    assert "KATA PENTING" in content


@pytest.mark.parametrize(
    ("preset", "font_name", "primary_color", "expected_text"),
    [
        ("yellow_viral", "DejaVu Sans", "&H0047E0FD", "TEST STYLE"),
        ("white_bold_shadow", "DejaVu Sans", "&H00FFFFFF", "Test Style"),
        ("black_white", "DejaVu Sans", "&H00FFFFFF", "TEST STYLE"),
        ("modern_sans", "DejaVu Sans", "&H00FCFAF8", "Test Style"),
        ("red_alert", "DejaVu Sans Condensed", "&H00FFFFFF", "TEST STYLE"),
    ],
)
def test_ass_caption_presets_have_distinct_export_styles(
    tmp_path,
    preset,
    font_name,
    primary_color,
    expected_text,
):
    subtitle_path = tmp_path / f"{preset}.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 2, "Test Style")],
        {"textPreset": preset},
    )

    content = subtitle_path.read_text(encoding="utf-8")
    assert f"Style: Default,{font_name},64,{primary_color}" in content
    assert expected_text in content
    assert report.style_preset == preset
    assert report.cues_written == 1


def test_ass_caption_default_preset_uses_manual_controls(tmp_path):
    subtitle_path = tmp_path / "manual-style.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 2, "Manual style")],
        {
            "textPreset": "default",
            "textColor": "#12AB34",
            "fontWeight": "normal",
            "outlineEnabled": True,
            "shadowEnabled": False,
            "backgroundEnabled": True,
            "backgroundOpacity": 0.6,
        },
    )

    content = subtitle_path.read_text(encoding="utf-8")
    assert "&H0034AB12" in content
    assert ",0,2,108,108,300,3," in content
    assert report.text_color == "#12AB34"
    assert report.outline["width"] > 0
    assert report.shadow["offset"] == 0
    assert report.background == {"color": "#000000", "opacity": 0.6}


def test_long_caption_is_wrapped_and_scaled_instead_of_dropped(tmp_path):
    subtitle_path = tmp_path / "long-caption.ass"
    text = (
        "Kalimat caption editan ini sengaja panjang agar tetap muncul lengkap "
        "dan tidak dibuang diam-diam oleh renderer export"
    )

    report = write_ass_cues(subtitle_path, [(0, 4, text)])

    content = subtitle_path.read_text(encoding="utf-8")
    assert report.cues_written == 1
    assert report.cues_skipped == 0
    assert "\\N" in content
    assert "{\\fs" in content
    assert "Kalimat caption editan ini" in content
    assert "renderer export" in content


def test_safe_wrap_uses_explicit_line_breaks_within_safe_width():
    text = "Kalau begini loh persoalannya bahwa publik harus tahu penjelasan lengkapnya"
    safe_width = round(ASS_PLAY_RES_X * CAPTION_SAFE_WIDTH_RATIO)

    layout = _layout_ass_caption(text, 64, safe_width)

    assert "\n" in _wrap_ass_caption(text)
    assert 2 <= len(layout.lines) <= 3
    assert all(
        _estimated_text_width(line, layout.font_size) <= safe_width
        for line in layout.lines
    )


def test_short_caption_is_not_wrapped_or_scaled():
    text = "Caption pendek"
    safe_width = round(ASS_PLAY_RES_X * CAPTION_SAFE_WIDTH_RATIO)

    layout = _layout_ass_caption(text, 64, safe_width)

    assert layout.lines == (text,)
    assert layout.font_size == 64
    assert _wrap_ass_caption(text) == text
    assert _cue_font_size(64, text) == 64


def test_very_long_caption_uses_at_most_three_safe_lines():
    text = " ".join(
        [
            "Penjelasan sangat panjang ini tetap harus muncul lengkap di dalam frame",
            "tanpa membuang satu kata pun meskipun membutuhkan ukuran font lebih kecil",
            "dan tiga baris visual yang aman untuk video vertikal",
        ]
    )
    safe_width = round(ASS_PLAY_RES_X * CAPTION_SAFE_WIDTH_RATIO)

    layout = _layout_ass_caption(text, 74, safe_width)

    assert 2 <= len(layout.lines) <= 3
    assert " ".join(layout.lines) == text
    assert layout.font_size < 74
    assert all(
        _estimated_text_width(line, layout.font_size) <= safe_width
        for line in layout.lines
    )


@pytest.mark.parametrize(
    "preset",
    ["yellow_viral", "white_bold_shadow", "red_alert", "black_white"],
)
def test_main_presets_write_long_caption_as_safe_explicit_lines(tmp_path, preset):
    subtitle_path = tmp_path / f"safe-{preset}.ass"
    text = "Kalau begini loh persoalannya bahwa publik harus tahu penjelasan lengkapnya"

    write_ass_cues(
        subtitle_path,
        [(0, 3, text)],
        {"textPreset": preset, "position": "center_lower"},
    )

    content = subtitle_path.read_text(encoding="utf-8")
    dialogue = next(line for line in content.splitlines() if line.startswith("Dialogue:"))
    assert "\\N" in dialogue
    assert "WrapStyle: 0" in content
    if preset == "red_alert":
        assert f",{round(ASS_PLAY_RES_X * (1 - BOX_CAPTION_SAFE_WIDTH_RATIO) / 2)}," in content


def test_background_box_wraps_before_ass_event_is_written(tmp_path):
    subtitle_path = tmp_path / "box-wrap.ass"
    text = "Background caption ini harus mengikuti teks yang sudah terbagi menjadi beberapa baris"

    report = write_ass_cues(
        subtitle_path,
        [(0, 3, text)],
        {"textPreset": "red_alert"},
    )

    content = subtitle_path.read_text(encoding="utf-8")
    dialogue = next(line for line in content.splitlines() if line.startswith("Dialogue:"))
    assert report.background["color"] == "#B91C1C"
    assert ",3," in content
    assert "\\N" in dialogue


def test_invalid_caption_cues_are_skipped_with_reasons(tmp_path):
    report = write_ass_cues(
        tmp_path / "invalid-caption.ass",
        [(2, 1, "Timing salah"), (0, 1, "   ")],
    )

    assert report.cues_written == 0
    assert report.cues_skipped == 2
    assert report.skip_reasons == {"invalid_timing": 1, "empty_text": 1}


def _dialogue_lines(content: str) -> list[str]:
    return [line for line in content.splitlines() if line.startswith("Dialogue:")]


def test_segment_mode_writes_one_safe_static_event(tmp_path):
    subtitle_path = tmp_path / "segment.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 3, "Caption segment panjang tetap dibungkus aman dalam frame vertikal")],
        {"displayMode": "segment"},
    )

    content = subtitle_path.read_text(encoding="utf-8")
    assert len(_dialogue_lines(content)) == 1
    assert "\\N" in content
    assert report.display_mode == "segment"
    assert report.animation_mode == "segment_static"
    assert report.source_cues_written == 1


def test_karaoke_mode_writes_one_highlighted_micro_cue_per_word(tmp_path):
    subtitle_path = tmp_path / "karaoke.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 4, "Satu dua tiga empat")],
        {
            "displayMode": "karaoke",
            "textColor": "#FFFFFF",
            "highlightColor": "#FFD400",
        },
    )

    dialogues = _dialogue_lines(subtitle_path.read_text(encoding="utf-8"))
    assert len(dialogues) == 4
    assert all("{\\c&H00D4FF&}" in line for line in dialogues)
    assert dialogues[0].startswith("Dialogue: 0,0:00:00.00,0:00:01.00")
    assert dialogues[-1].startswith("Dialogue: 0,0:00:03.00,0:00:04.00")
    assert report.display_mode == "karaoke"
    assert report.animation_mode == "micro_cues"
    assert report.source_cues_written == 1


def test_word_by_word_mode_writes_progressive_micro_cues(tmp_path):
    subtitle_path = tmp_path / "word-by-word.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 3, "Satu dua tiga")],
        {"displayMode": "word_by_word"},
    )

    dialogues = _dialogue_lines(subtitle_path.read_text(encoding="utf-8"))
    assert len(dialogues) == 3
    assert dialogues[0].endswith("Satu")
    assert dialogues[1].endswith("Satu dua")
    assert dialogues[2].endswith("Satu dua tiga")
    assert report.display_mode == "word_by_word"
    assert report.animation_mode == "micro_cues"


@pytest.mark.parametrize("display_mode", ["karaoke", "word_by_word"])
@pytest.mark.parametrize(
    "cue",
    [(0, 0.3, "Dua kata"), (0, 2, "Tunggal")],
)
def test_animated_modes_fall_back_safely_for_short_or_single_word_cues(
    tmp_path,
    display_mode,
    cue,
):
    report = write_ass_cues(
        tmp_path / f"fallback-{display_mode}.ass",
        [cue],
        {"displayMode": display_mode},
    )

    content = (tmp_path / f"fallback-{display_mode}.ass").read_text(encoding="utf-8")
    assert len(_dialogue_lines(content)) == 1
    assert report.animation_mode == "static_fallback"


def test_overlapping_caption_cues_are_trimmed_so_only_one_is_active(tmp_path):
    subtitle_path = tmp_path / "overlap.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 2, "Cue pertama"), (1, 3, "Cue kedua")],
    )

    dialogues = _dialogue_lines(subtitle_path.read_text(encoding="utf-8"))
    assert len(dialogues) == 2
    assert dialogues[0].startswith("Dialogue: 0,0:00:00.00,0:00:01.00")
    assert dialogues[1].startswith("Dialogue: 0,0:00:01.00,0:00:03.00")
    assert report.source_cues_written == 2


def test_same_start_caption_keeps_later_preview_winner(tmp_path):
    subtitle_path = tmp_path / "same-start.ass"

    report = write_ass_cues(
        subtitle_path,
        [(0, 2, "Cue lama"), (0, 3, "Cue terbaru")],
    )

    dialogues = _dialogue_lines(subtitle_path.read_text(encoding="utf-8"))
    assert len(dialogues) == 1
    assert dialogues[0].endswith("Cue terbaru")
    assert report.skip_reasons == {"overlapped_by_later_cue": 1}
