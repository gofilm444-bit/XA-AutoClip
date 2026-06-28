from app.models import TranscriptSegment
from app.providers.transcription.mock import MockTranscriptionProvider
from app.services.candidates import (
    CandidateDraft,
    generate_candidates,
    normalize_to_one_minute_candidates,
    overlap_ratio,
)


def make_segments():
    return [
        TranscriptSegment(
            project_id=None,
            segment_index=index,
            start_seconds=index * 5,
            end_seconds=(index + 1) * 5,
            text=f"Kalimat lengkap nomor {index} memberi konteks dan informasi penting.",
        )
        for index in range(12)
    ]


def test_generates_five_valid_candidates():
    candidates = generate_candidates(make_segments())
    assert len(candidates) == 5
    assert all(20 <= item.end - item.start <= 60 for item in candidates)


def test_overlap_ratio():
    candidates = generate_candidates(make_segments())
    assert overlap_ratio(candidates[0], candidates[0]) == 1


def test_mock_transcription_splits_long_video_into_clip_sized_segments(tmp_path):
    result = MockTranscriptionProvider().transcribe(tmp_path / "audio.wav", 375.954)

    assert len(result.segments) > 8
    assert max(segment.end - segment.start for segment in result.segments) <= 8.1
    assert result.segments[-1].end == 375.954
    assert len(generate_candidates([
        TranscriptSegment(
            project_id=None,
            segment_index=index,
            start_seconds=segment.start,
            end_seconds=segment.end,
            text=segment.text,
        )
        for index, segment in enumerate(result.segments)
    ])) == 5


def test_normalizes_long_video_candidates_to_one_minute():
    drafts = [
        CandidateDraft(
            start=24,
            end=64,
            text="Momen terbaik",
            scores={
                "hook": 90,
                "context": 90,
                "information": 90,
                "emotion": 90,
                "fluency": 90,
                "duration": 100,
                "discussion": 90,
            },
        ),
        *generate_candidates(make_segments(), limit=30),
    ]
    candidates = normalize_to_one_minute_candidates(drafts, video_duration=375.954)

    assert len(candidates) == 5
    assert all(candidate.end - candidate.start == 60 for candidate in candidates)
    assert candidates[0].start == 24
    assert candidates[0].end == 84
    assert len({candidate.start for candidate in candidates}) == 5
