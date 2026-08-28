from app.services.candidates import CandidateDraft
from app.services.usage_audit import candidate_quality_audit, estimate_ai_usage


def test_usage_estimator_is_safe_without_pricing_or_tokens():
    usage = estimate_ai_usage(
        "transcription",
        "openai",
        "whisper-1",
        audio_duration_seconds=125,
    )

    assert usage["quantity"] == 2.083
    assert usage["unit"] == "audio_minutes"
    assert usage["estimated_cost"] is None


def test_usage_estimator_uses_text_length_when_audio_is_unavailable():
    usage = estimate_ai_usage(
        "title_hook_generation",
        "openai",
        "gpt-5.5",
        input_text_length=240,
        output_text_length=80,
    )

    assert usage["quantity"] == 240
    assert usage["unit"] == "input_characters"


def test_candidate_quality_audit_exposes_v1a_ranking_components():
    candidate = CandidateDraft(
        start=10,
        end=55,
        text="Ternyata ini pembahasan penting dengan akhir yang lengkap.",
        scores={
            "hook_strength": 90,
            "completeness": 85,
            "topic_coherence": 80,
            "duration_fit": 95,
            "transcript_quality": 88,
            "_start_boundary_score": 90,
            "_end_boundary_score": 85,
        },
    )

    audit = candidate_quality_audit(candidate, rank=1)

    assert audit["rank"] == 1
    assert audit["start_time"] == 10
    assert audit["end_time"] == 55
    assert audit["duration"] == 45
    assert audit["hook_strength"] == 90
    assert audit["completeness"] == 85
    assert audit["topic_coherence"] == 80
    assert audit["duration_fit"] == 95
    assert audit["transcript_quality"] == 88
    assert audit["final_score"] > 0
    assert audit["reason"] == "strong_hook_start,complete_ending,ideal_duration"
