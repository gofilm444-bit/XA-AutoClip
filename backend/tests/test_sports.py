from app.models import TranscriptSegment
from app.services.sports import (
    SportsSignal,
    generate_sports_candidates,
    parse_sports_signals,
    sports_transcript,
)


def test_parses_loudness_and_scene_activity():
    output = """
frame:1 pts:1600 pts_time:1.0
lavfi.r128.M=-28.0
frame:2 pts:4800 pts_time:3.0
lavfi.r128.M=-9.0
[Parsed_showinfo_2] n:1 pts:4 pts_time:3.5
[Parsed_showinfo_2] n:2 pts:5 pts_time:4.2
"""

    signals = parse_sports_signals(output)

    assert signals
    assert max(signal.loudness for signal in signals) == -9.0
    assert max(signal.scene_activity for signal in signals) > 0


def test_sports_candidates_include_build_up_and_aftermath():
    signals = [
        SportsSignal(time=20, loudness=-30, scene_activity=0.1),
        SportsSignal(time=70, loudness=-8, scene_activity=1.0),
        SportsSignal(time=130, loudness=-12, scene_activity=0.8),
    ]

    candidates = generate_sports_candidates(signals, video_duration=180, limit=2)

    assert len(candidates) == 2
    assert candidates[0].start == 58
    assert candidates[0].end == 88
    assert all(12 <= candidate.end - candidate.start <= 30 for candidate in candidates)
    assert candidates[0].scores["emotion"] > candidates[1].scores["emotion"]


def test_sports_transcript_keeps_absolute_timestamps():
    segments = [
        TranscriptSegment(
            project_id=None,
            segment_index=0,
            start_seconds=185,
            end_seconds=189,
            text="Well, excellent pace on it.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=1,
            start_seconds=190,
            end_seconds=196,
            text="It is a wonderful goal.",
        ),
        TranscriptSegment(
            project_id=None,
            segment_index=2,
            start_seconds=220,
            end_seconds=225,
            text="Di luar klip.",
        ),
    ]

    text = sports_transcript(segments, start=180, end=210)

    assert text == (
        "[03:05] Well, excellent pace on it.\n"
        "[03:10] It is a wonderful goal."
    )
