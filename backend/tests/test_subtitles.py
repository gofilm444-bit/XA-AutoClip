from types import SimpleNamespace

from app.services.subtitles import (
    MAX_SUBTITLE_CHARS,
    MAX_SUBTITLE_WORDS,
    ass_timestamp,
    filter_safe_cues,
    split_cues,
    transcript_cues,
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
