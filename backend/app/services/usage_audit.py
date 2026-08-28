from typing import Any

import structlog

logger = structlog.get_logger()


def estimate_ai_usage(
    call_type: str,
    provider: str,
    model: str,
    *,
    audio_duration_seconds: float | None = None,
    input_text_length: int | None = None,
    output_text_length: int | None = None,
) -> dict[str, Any]:
    if audio_duration_seconds is not None:
        quantity = round(max(0.0, audio_duration_seconds) / 60.0, 3)
        unit = "audio_minutes"
    elif input_text_length is not None:
        quantity = max(0, int(input_text_length))
        unit = "input_characters"
    else:
        quantity = 1
        unit = "call"
    usage = {
        "quantity": quantity,
        "unit": unit,
        "estimated_cost": None,
        "pricing_source_note": "Pricing table belum dikonfigurasi; quantity dicatat untuk audit.",
    }
    logger.info(
        "ai_usage_cost_estimated",
        call_type=call_type,
        provider=provider,
        model=model,
        **usage,
    )
    return usage


def candidate_quality_audit(
    candidate: Any,
    *,
    rank: int | None = None,
    duplicate_suppressed: bool = False,
) -> dict[str, Any]:
    from app.services.candidates import candidate_reason, weighted_score

    scores = dict(getattr(candidate, "scores", {}) or {})
    candidate_audit = dict(getattr(candidate, "audit", {}) or {})
    duration = round(float(candidate.end) - float(candidate.start), 3)
    return {
        "rank": rank,
        "start_time": float(candidate.start),
        "end_time": float(candidate.end),
        "duration": duration,
        "hook_strength": scores.get("hook_strength", scores.get("hook", 0)),
        "completeness": scores.get("completeness", scores.get("context", 0)),
        "topic_coherence": scores.get("topic_coherence", scores.get("context", 0)),
        "duration_fit": scores.get("duration_fit", scores.get("duration", 0)),
        "transcript_quality": scores.get("transcript_quality", scores.get("fluency", 0)),
        "final_score": weighted_score(scores),
        "reason": candidate_reason(scores, duration),
        "moment_anchor_time": candidate_audit.get("moment_anchor_time"),
        "moment_anchor_text_preview": candidate_audit.get("moment_anchor_text_preview"),
        "seconds_to_anchor": candidate_audit.get("seconds_to_anchor"),
        "anchor_score": candidate_audit.get("anchor_score"),
        "ending_score": candidate_audit.get("ending_score"),
        "ending_reason": candidate_audit.get("ending_reason"),
        "end_text_preview": candidate_audit.get("end_text_preview"),
        "start_seconds": float(candidate.start),
        "end_seconds": float(candidate.end),
        "duration_seconds": duration,
        "score": scores and round(sum(scores.values()) / len(scores), 2),
        "score_components": scores,
        "transcript_length": len(str(getattr(candidate, "text", "") or "")),
        "duplicate_suppressed": duplicate_suppressed,
    }
