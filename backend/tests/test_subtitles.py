from types import SimpleNamespace

from app.services.subtitles import ass_timestamp, split_cues, transcript_cues


def test_ass_timestamp():
    assert ass_timestamp(65.25) == "0:01:05.25"


def test_subtitle_cues_cover_duration():
    cues = split_cues("satu dua tiga empat lima enam tujuh delapan sembilan", 9)
    assert cues[0][0] == 0
    assert cues[-1][1] == 9
    assert all(len(text.split()) <= 8 for _, _, text in cues)


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
    assert all(len(text.split()) <= 8 for _, _, text in cues)
