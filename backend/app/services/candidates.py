"""
Candidate Selection Quality v1A
Flexible duration, natural clip boundaries, and better local ranking.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import structlog

from app.models import TranscriptSegment

logger = structlog.get_logger()

# Duration constants (in seconds)
MIN_CLIP_DURATION_SECONDS = 20
IDEAL_MIN_CLIP_DURATION_SECONDS = 35
IDEAL_MAX_CLIP_DURATION_SECONDS = 95
MAX_CLIP_DURATION_SECONDS = 150

# Natural boundary padding so audio is not clipped mid-breath.
MIN_PREROLL_SECONDS = 0.5
MAX_PREROLL_SECONDS = 1.5
MIN_POSTROLL_SECONDS = 0.5
MAX_POSTROLL_SECONDS = 1.5

# Filler words that indicate weak start boundaries
FILLER_WORDS = {
    "jadi",
    "eee",
    "hmm",
    "nah",
    "oke",
    "terus",
    "lalu",
    "kemudian",
    "eh",
    "uh",
    "um",
    "anu",
    "gitu",
    "tuh",
    "loh",
    "nih",
}

# Strong hook words that attract attention
HOOK_WORDS = {
    "kenapa",
    "ternyata",
    "masalahnya",
    "justru",
    "tapi",
    "padahal",
    "akhirnya",
    "luar biasa",
    "gila",
    "salah",
    "benar",
    "penting",
    "rahasia",
    "unik",
    "krusial",
    "mengubah",
    "shock",
    "kontras",
}
MOMENT_ANCHOR_WORDS = HOOK_WORDS | {
    "gimana",
    "aneh",
    "ribet",
    "masalah",
    "paling",
    "beda",
    "menarik",
}

# Connecting words that suggest the sentence is not complete
CONNECTING_WORDS = {
    "tapi",
    "karena",
    "jadi",
    "kalau",
    "dan",
    "atau",
    "padahal",
    "tetapi",
    "jika",
    "apabila",
}

# Pronouns without clear reference
AMBIGUOUS_PRONOUNS = {"dia", "itu", "mereka", "beliau", "hal ini", "hal itu"}


@dataclass(frozen=True)
class CandidateDraft:
    start: float
    end: float
    text: str
    scores: dict[str, float]
    audit: dict[str, object] = field(default_factory=dict)


def weighted_score(scores: dict[str, float]) -> float:
    """Calculate weighted score using v1C schema (with old-schema fallback)."""
    if "hook_strength" in scores:
        return round(
            scores.get("hook_strength", 0) * 0.25
            + scores.get("completeness", 0) * 0.25
            + scores.get("topic_coherence", 0) * 0.15
            + scores.get("moment_anchor_strength", 50) * 0.15
            + scores.get("boundary_quality", 50) * 0.10
            + scores.get("duration_fit", 0) * 0.05
            + scores.get("transcript_quality", 0) * 0.05,
            2,
        )

    return round(
        scores.get("hook", 0) * 0.25
        + scores.get("context", 0) * 0.20
        + scores.get("information", 0) * 0.20
        + scores.get("emotion", 0) * 0.15
        + scores.get("fluency", 0) * 0.10
        + scores.get("duration", 0) * 0.05
        + scores.get("discussion", 0) * 0.05,
        2,
    )


def _normalize_text(text: str) -> str:
    """Clean and normalize text."""
    return re.sub(r"\s+", " ", text).strip().lower()


def _score_moment_anchor(text: str) -> float:
    normalized = _normalize_text(text)
    words = normalized.split()
    if not words:
        return 10.0
    score = 50.0
    first = words[0].strip(".,!?;:")
    score += sum(9 for word in MOMENT_ANCHOR_WORDS if word in normalized)
    if "?" in text:
        score += 22
    if any(word in normalized for word in ("fakta", "pertama", "terbesar", "berbeda")):
        score += 12
    if first in FILLER_WORDS:
        score -= 28
    connector_ratio = sum(word.strip(".,!?;:") in CONNECTING_WORDS for word in words) / len(words)
    if connector_ratio > 0.25:
        score -= 18
    if len(words) > 35 and not any(word in normalized for word in MOMENT_ANCHOR_WORDS):
        score -= 15
    return min(100.0, max(10.0, score))


def _ending_reason(text: str, score: float) -> str:
    last = _last_token(text)
    if last in CONNECTING_WORDS:
        return f"hanging_connector:{last}"
    if score >= 75:
        return "complete_statement"
    if any(marker in text for marker in ".!?"):
        return "natural_punctuation"
    return "unfinished_thought"


def _resolve_end_index(
    segments: list[TranscriptSegment],
    start_index: int,
    end_index: int,
) -> int:
    current_text = str(segments[end_index].text or "").strip()
    current_score = _score_end_boundary(current_text, float(segments[end_index].end_seconds))
    if current_score >= 60:
        return end_index

    best_index = end_index
    best_score = current_score
    for candidate_index in range(end_index + 1, min(len(segments), end_index + 4)):
        duration = (
            float(segments[candidate_index].end_seconds)
            - float(segments[start_index].start_seconds)
        )
        if duration > MAX_CLIP_DURATION_SECONDS:
            break
        candidate_text = str(segments[candidate_index].text or "").strip()
        candidate_score = _score_end_boundary(
            candidate_text,
            float(segments[candidate_index].end_seconds),
        )
        if candidate_score > best_score:
            best_index = candidate_index
            best_score = candidate_score
        if candidate_score >= 75:
            break
    return best_index


def _first_token(text: str) -> str:
    words = _normalize_text(text).split()
    if not words:
        return ""
    return words[0].rstrip(",:;?!.")


def _last_token(text: str) -> str:
    words = _normalize_text(text).split()
    if not words:
        return ""
    return words[-1].rstrip(",:;?!.")


def _score_start_boundary(segment_text: str, is_first: bool = False) -> float:
    """Score how natural/interesting a start boundary is."""
    normalized = _normalize_text(segment_text)
    words = normalized.split()

    if not words:
        return 30.0

    score = 60.0
    first_word = words[0].rstrip(",:;?!")

    # Strong openers
    if first_word in HOOK_WORDS:
        score += 25
    if any(word in HOOK_WORDS for word in words[:4]):
        score += 10

    # Questions / conflict / contrast / strong claims
    if "?" in segment_text:
        score += 18
    if any(
        word in normalized
        for word in ("kontras", "berbeda", "berlawanan", "vs", "versus", "konflik")
    ):
        score += 12
    if any(
        word in normalized
        for word in ("klaim", "bukti", "hasil", "terbukti", "penting", "salah", "benar")
    ):
        score += 10

    # Weak openers / fillers
    if first_word in FILLER_WORDS:
        score -= 30
    if any(word in FILLER_WORDS for word in words[:2]):
        score -= 10
    if first_word in AMBIGUOUS_PRONOUNS:
        score -= 15
    if normalized.startswith(("dalam hal", "mengenai hal", "soal itu")):
        score -= 10

    # Fragment penalty
    if len(words) < 3:
        score -= 20

    if is_first:
        score += 5

    return min(100.0, max(10.0, score))


def _score_end_boundary(segment_text: str, segment_end_time: float = 0.0) -> float:
    """Score how natural/complete an end boundary is."""
    del segment_end_time  # reserved for future timing heuristics
    normalized = _normalize_text(segment_text)
    words = normalized.split()

    if not words:
        return 30.0

    score = 60.0
    last_word = words[-1].rstrip(",:;?!")

    # Hanging connectors are bad endings
    if last_word in CONNECTING_WORDS:
        score -= 30
    if any(normalized.endswith(f" {word}") or normalized == word for word in CONNECTING_WORDS):
        score -= 10

    # Completed thought markers
    if any(marker in segment_text for marker in (".", "!", "?")):
        score += 18
    if any(
        pattern in normalized
        for pattern in (
            "kesimpulannya",
            "akhirnya",
            "jadi itu",
            "makanya",
            "oleh karena itu",
            "jawabannya",
            "itulah",
            "rahasianya",
        )
    ):
        score += 15
    if last_word in ("poin", "ide", "jawaban", "hal", "kesimpulan", "penting", "benar", "salah"):
        score += 12

    # Mid-sentence / hanging patterns
    if segment_text and not any(p in segment_text[-3:] for p in ".!?,;:"):
        score -= 12
    if normalized.endswith(
        ("yaitu", "seperti", "contohnya", "misalnya", "karena", "kalau", "tapi")
    ):
        score -= 18

    if len(words) < 4:
        score -= 20

    return min(100.0, max(10.0, score))


def _score_duration_fit(duration: float) -> float:
    """Score how well duration fits content (flexible, not locked to 60s)."""
    if duration < MIN_CLIP_DURATION_SECONDS:
        return 10.0
    if duration > MAX_CLIP_DURATION_SECONDS:
        return 10.0

    if IDEAL_MIN_CLIP_DURATION_SECONDS <= duration <= IDEAL_MAX_CLIP_DURATION_SECONDS:
        # Slight preference near the middle of the ideal band, not a hard 60s lock.
        center = (IDEAL_MIN_CLIP_DURATION_SECONDS + IDEAL_MAX_CLIP_DURATION_SECONDS) / 2
        distance = abs(duration - center) / max(center - IDEAL_MIN_CLIP_DURATION_SECONDS, 1)
        return 100.0 - min(15.0, distance * 15.0)

    if duration < IDEAL_MIN_CLIP_DURATION_SECONDS:
        ratio = (duration - MIN_CLIP_DURATION_SECONDS) / (
            IDEAL_MIN_CLIP_DURATION_SECONDS - MIN_CLIP_DURATION_SECONDS
        )
        return 50.0 + ratio * 50.0

    ratio = (MAX_CLIP_DURATION_SECONDS - duration) / (
        MAX_CLIP_DURATION_SECONDS - IDEAL_MAX_CLIP_DURATION_SECONDS
    )
    return 50.0 + ratio * 50.0


def _score_hook_strength(text: str) -> float:
    """Score how strong/compelling the opening is."""
    normalized = _normalize_text(text)
    words = normalized.split()

    if not words:
        return 30.0

    score = 60.0
    first_word = words[0].rstrip(",:;?!")

    if any(word in HOOK_WORDS for word in words[:5]):
        score += 25
    if "?" in text[:80]:
        score += 20
    if any(
        phrase in normalized[:100]
        for phrase in (
            "ternyata",
            "akhirnya",
            "rupanya",
            "gila",
            "luar biasa",
            "tidak disangka",
            "mengejutkan",
            "kontras",
            "masalahnya",
            "kenapa",
        )
    ):
        score += 15
    if first_word in FILLER_WORDS:
        score -= 25
    if any(word in normalized for word in ("mengapa", "kenapa", "bagaimana", "siapa", "dimana")):
        score += 10

    unique_words = len(set(words[:20]))
    if unique_words > 12:
        score += 8

    return min(100.0, max(10.0, score))


def _score_topic_coherence(text: str) -> float:
    """Score if text stays on one topic."""
    normalized = _normalize_text(text)
    words = normalized.split()

    if not words:
        return 50.0

    word_freq: dict[str, int] = {}
    for word in words:
        if len(word) > 3:
            word_freq[word] = word_freq.get(word, 0) + 1

    if not word_freq:
        return 50.0

    avg_freq = sum(word_freq.values()) / len(word_freq)
    coherence_score = min(100.0, 50.0 + avg_freq * 10.0)

    topic_switches = sum(1 for keyword in AMBIGUOUS_PRONOUNS if keyword in normalized)
    coherence_score -= topic_switches * 5

    return max(30.0, coherence_score)


def _score_completeness(text: str, segment_count: int = 1) -> float:
    """Score if clip has clear beginning, middle, end."""
    del segment_count
    normalized = _normalize_text(text)
    words = normalized.split()

    if not words:
        return 30.0

    score = 50.0

    if any(p in text for p in ".!?"):
        score += 20

    sentence_count = max(1, len(re.split(r"[.!?]+", text)) - 1)
    if sentence_count >= 2:
        score += 15
    if sentence_count >= 3:
        score += 10

    if len(words) > 30:
        score += 10
    if len(words) > 60:
        score += 8

    if any(
        word in normalized
        for word in ("kesimpulannya", "hasilnya", "akhirnya", "jawabannya", "itulah")
    ):
        score += 12

    # "jadi" alone is often filler; only reward when it looks conclusive.
    if "jadi " in normalized and any(p in text for p in ".!?"):
        score += 6

    if any(word in normalized for word in ("tapi", "padahal", "ternyata")) and "." in text:
        score += 10

    # Penalize hanging ending connectors in the full text tail.
    tail = _last_token(text)
    if tail in CONNECTING_WORDS:
        score -= 20

    return min(100.0, max(20.0, score))


def _score_transcript_quality(text: str) -> float:
    """Score clarity of transcript."""
    normalized = _normalize_text(text)
    words = normalized.split()

    if not words:
        return 50.0

    score = 70.0
    filler_ratio = sum(1 for word in words if word in FILLER_WORDS) / len(words)
    if filler_ratio > 0.2:
        score -= 30
    elif filler_ratio > 0.1:
        score -= 15

    ambiguous_ratio = sum(1 for word in words if word in AMBIGUOUS_PRONOUNS) / len(words)
    if ambiguous_ratio > 0.15:
        score -= 20

    unique_ratio = len(set(words)) / len(words)
    if unique_ratio < 0.4:
        score -= 15

    if any(artifact in normalized for artifact in ("[laugh]", "[pause]", " uh ", " um ", " hm ")):
        score -= 5

    return min(100.0, max(30.0, score))


def _score_discussion_potential(text: str) -> float:
    """Score likelihood of engagement/discussion (optional extra)."""
    normalized = _normalize_text(text)
    score = 60.0
    engagement_keywords = (
        "kontras",
        "berbeda",
        "salah",
        "benar",
        "perdebatan",
        "perbedaan",
        "pertentangan",
        "menarik",
        "mengejutkan",
        "tidak terduga",
        "ide",
        "argumen",
        "bukti",
    )
    score += sum(5 for kw in engagement_keywords if kw in normalized)
    if "?" in text:
        score += 15
    if any(word in normalized for word in ("anda", "kalian", "kita")):
        score += 10
    if any(
        phrase in normalized
        for phrase in ("menurut saya", "saya pikir", "saya rasa", "pendapat saya")
    ):
        score += 8
    return min(100.0, max(30.0, score))


def _score_curiosity_gap(text: str) -> float:
    """Score curiosity gap between opening and payoff (optional extra)."""
    normalized = _normalize_text(text)
    words = normalized.split()
    if not words:
        return 40.0

    score = 50.0
    if text.count("?") > 0:
        score += 20
    if any(word in normalized for word in ("ternyata", "akhirnya", "rupanya", "justru", "malah")):
        score += 15
    if any(word in normalized[:40] for word in ("tapi", "padahal")) and any(
        p in text[-40:] for p in ".!?"
    ):
        score += 12
    if re.search(r"\b\d+\b", text):
        score += 8
    if len(words) > 40:
        score += 8
    return min(100.0, max(20.0, score))


def score_candidate(
    text: str,
    duration: float,
    segment_count: int = 1,
    start_text: str = "",
    end_text: str = "",
) -> dict[str, float]:
    """Score a candidate using the v1A schema."""
    if not start_text:
        start_text = text
    if not end_text:
        end_text = text

    scores = {
        "hook_strength": _score_hook_strength(start_text),
        "completeness": _score_completeness(text, segment_count),
        "topic_coherence": _score_topic_coherence(text),
        "duration_fit": _score_duration_fit(duration),
        "transcript_quality": _score_transcript_quality(text),
        # Optional extras kept for richer ranking/logging
        "curiosity_gap": _score_curiosity_gap(text),
        "discussion_potential": _score_discussion_potential(text),
        "_start_boundary_score": _score_start_boundary(start_text, is_first=True),
        "_end_boundary_score": _score_end_boundary(end_text, 0.0),
    }
    scores["moment_anchor_strength"] = _score_moment_anchor(start_text)
    scores["boundary_quality"] = round(
        (scores["_start_boundary_score"] + scores["_end_boundary_score"]) / 2,
        2,
    )
    # ClipCandidate still persists these legacy columns. Keep aliases until the
    # storage contract is migrated; ranking continues to use the v1A fields.
    scores.update(
        {
            "hook": scores["hook_strength"],
            "context": scores["topic_coherence"],
            "information": scores["transcript_quality"],
            "emotion": scores["curiosity_gap"],
            "fluency": scores["transcript_quality"],
            "duration": scores["duration_fit"],
            "discussion": scores["discussion_potential"],
        }
    )
    return {key: round(min(value, 100.0), 2) for key, value in scores.items()}


def _apply_natural_boundaries(
    start: float,
    end: float,
    *,
    video_start: float,
    video_end: float,
    start_gap: float | None,
    end_gap: float | None,
) -> tuple[float, float]:
    """
    Add light pre-roll / post-roll so audio is not hard-cut on the first/last word.

    Pre-roll uses available silence/gap before the start segment (0.5-1.5s).
    Post-roll uses available silence/gap after the end segment (0.5-1.5s).
    """
    if start_gap is not None and start_gap > 0:
        preroll = min(MAX_PREROLL_SECONDS, max(MIN_PREROLL_SECONDS, start_gap * 0.5))
    else:
        preroll = MIN_PREROLL_SECONDS

    if end_gap is not None and end_gap > 0:
        postroll = min(MAX_POSTROLL_SECONDS, max(MIN_POSTROLL_SECONDS, end_gap * 0.5))
    else:
        postroll = MIN_POSTROLL_SECONDS

    natural_start = max(video_start, round(start - preroll, 3))
    natural_end = min(video_end, round(end + postroll, 3))

    # Keep duration constraints after padding.
    duration = natural_end - natural_start
    if duration > MAX_CLIP_DURATION_SECONDS:
        overflow = duration - MAX_CLIP_DURATION_SECONDS
        # Trim padding symmetrically when possible.
        trim_start = min(preroll, overflow / 2)
        natural_start = min(start, natural_start + trim_start)
        natural_end = max(end, natural_end - (overflow - trim_start))
        if natural_end - natural_start > MAX_CLIP_DURATION_SECONDS:
            natural_end = natural_start + MAX_CLIP_DURATION_SECONDS

    if natural_end - natural_start < MIN_CLIP_DURATION_SECONDS:
        # Fall back to unpadded bounds if padding somehow collapsed the window.
        natural_start = start
        natural_end = end

    return round(natural_start, 3), round(natural_end, 3)


def candidate_reason(scores: dict[str, float], duration: float) -> str:
    """Short human-readable reason for audit logs."""
    parts: list[str] = []
    hook = scores.get("hook_strength", 0)
    complete = scores.get("completeness", 0)
    start_b = scores.get("_start_boundary_score", 0)
    end_b = scores.get("_end_boundary_score", 0)
    duration_fit = scores.get("duration_fit", 0)

    if hook >= 75 and start_b >= 70:
        parts.append("strong_hook_start")
    elif start_b < 45:
        parts.append("weak_start")
    else:
        parts.append("neutral_start")

    if complete >= 75 and end_b >= 70:
        parts.append("complete_ending")
    elif end_b < 45:
        parts.append("hanging_end")
    else:
        parts.append("ok_ending")

    if IDEAL_MIN_CLIP_DURATION_SECONDS <= duration <= IDEAL_MAX_CLIP_DURATION_SECONDS:
        parts.append("ideal_duration")
    elif duration < IDEAL_MIN_CLIP_DURATION_SECONDS:
        parts.append("short_duration")
    else:
        parts.append("long_duration")

    if duration_fit < 40:
        parts.append("poor_duration_fit")

    return ",".join(parts)


def overlap_ratio(left: CandidateDraft, right: CandidateDraft) -> float:
    """Return overlap relative to the shorter candidate."""
    overlap = max(0.0, min(left.end, right.end) - max(left.start, right.start))
    shorter = min(left.end - left.start, right.end - right.start)
    return overlap / shorter if shorter > 0 else 0.0


def _topic_signature(text: str) -> set[str]:
    ignored = FILLER_WORDS | CONNECTING_WORDS | {
        "adalah",
        "dalam",
        "dengan",
        "dari",
        "ini",
        "itu",
        "kita",
        "mereka",
        "pada",
        "untuk",
        "yang",
    }
    return {
        word
        for word in re.findall(r"\b[\w'-]{4,}\b", _normalize_text(text), flags=re.UNICODE)
        if word not in ignored
    }


def topic_similarity(left: CandidateDraft, right: CandidateDraft) -> float:
    left_topics = _topic_signature(left.text)
    right_topics = _topic_signature(right.text)
    if not left_topics or not right_topics:
        return 0.0
    return len(left_topics & right_topics) / min(len(left_topics), len(right_topics))


def suppress_overlap_v2(
    drafts: list[CandidateDraft],
    limit: int = 5,
) -> list[CandidateDraft]:
    """Keep higher-ranked candidates and reject overlap above 60 percent."""
    selected: list[CandidateDraft] = []
    ranked = sorted(drafts, key=lambda item: weighted_score(item.scores), reverse=True)
    for draft in ranked:
        if any(overlap_ratio(draft, existing) > 0.60 for existing in selected):
            continue
        if any(topic_similarity(draft, existing) >= 0.75 for existing in selected):
            continue
        selected.append(draft)
        if len(selected) >= limit:
            break
    return selected


def suppress_overlap(drafts: list[CandidateDraft], limit: int = 5) -> list[CandidateDraft]:
    """Compatibility wrapper using the v1A overlap policy."""
    return suppress_overlap_v2(drafts, limit=limit)


def generate_candidates_flexible(
    segments: list[TranscriptSegment],
    limit: int = 5,
) -> list[CandidateDraft]:
    """Build locally-scored candidates with content-driven durations."""
    if not segments or limit <= 0:
        return []

    ordered = sorted(segments, key=lambda item: (item.start_seconds, item.end_seconds))
    video_start = max(0.0, float(ordered[0].start_seconds))
    video_end = float(ordered[-1].end_seconds)
    drafts: list[CandidateDraft] = []

    for start_index, start_segment in enumerate(ordered):
        raw_start = float(start_segment.start_seconds)
        start_text = str(start_segment.text or "").strip()
        start_gap = (
            raw_start - float(ordered[start_index - 1].end_seconds) if start_index > 0 else None
        )
        start_boundary_score = _score_start_boundary(
            start_text,
            is_first=start_index == 0,
        )

        for end_index in range(start_index, len(ordered)):
            end_index = _resolve_end_index(ordered, start_index, end_index)
            end_segment = ordered[end_index]
            raw_end = float(end_segment.end_seconds)
            raw_duration = raw_end - raw_start
            if raw_duration > MAX_CLIP_DURATION_SECONDS:
                break
            if raw_duration < MIN_CLIP_DURATION_SECONDS:
                continue

            end_gap = (
                float(ordered[end_index + 1].start_seconds) - raw_end
                if end_index + 1 < len(ordered)
                else None
            )
            natural_start, natural_end = _apply_natural_boundaries(
                raw_start,
                raw_end,
                video_start=video_start,
                video_end=video_end,
                start_gap=start_gap,
                end_gap=end_gap,
            )
            duration = natural_end - natural_start
            if not MIN_CLIP_DURATION_SECONDS <= duration <= MAX_CLIP_DURATION_SECONDS:
                continue

            selected = ordered[start_index : end_index + 1]
            text = " ".join(str(item.text or "").strip() for item in selected).strip()
            end_text = str(end_segment.text or "").strip()
            anchor_segment = max(
                selected,
                key=lambda item: _score_moment_anchor(str(item.text or "")),
            )
            anchor_score = _score_moment_anchor(str(anchor_segment.text or ""))
            seconds_to_anchor = max(
                0.0,
                float(anchor_segment.start_seconds) - natural_start,
            )
            position_factor = 1.0 if seconds_to_anchor <= 8 else max(
                0.35,
                1.0 - (seconds_to_anchor - 8) / 20,
            )
            scores = score_candidate(
                text,
                duration,
                len(selected),
                start_text,
                end_text,
            )
            scores["_start_boundary_score"] = start_boundary_score
            ending_score = _score_end_boundary(end_text, raw_end)
            scores["_end_boundary_score"] = ending_score
            scores["moment_anchor_strength"] = round(anchor_score * position_factor, 2)
            scores["boundary_quality"] = round(
                (start_boundary_score + ending_score) / 2,
                2,
            )
            drafts.append(
                CandidateDraft(
                    start=natural_start,
                    end=natural_end,
                    text=text,
                    scores=scores,
                    audit={
                        "moment_anchor_time": float(anchor_segment.start_seconds),
                        "moment_anchor_text_preview": str(anchor_segment.text or "")[:120],
                        "seconds_to_anchor": round(seconds_to_anchor, 3),
                        "anchor_score": round(anchor_score, 2),
                        "ending_score": round(ending_score, 2),
                        "ending_reason": _ending_reason(end_text, ending_score),
                        "end_text_preview": end_text[:120],
                    },
                )
            )

    selected = suppress_overlap_v2(drafts, limit=limit)
    logger.info(
        "candidate_duration_policy_applied",
        policy="flexible_natural_boundary_v1a",
        source_segment_count=len(ordered),
        generated_count=len(drafts),
        selected_count=len(selected),
        min_duration=MIN_CLIP_DURATION_SECONDS,
        ideal_duration_range=(
            IDEAL_MIN_CLIP_DURATION_SECONDS,
            IDEAL_MAX_CLIP_DURATION_SECONDS,
        ),
        max_duration=MAX_CLIP_DURATION_SECONDS,
    )
    return selected


def generate_candidates(
    segments: list[TranscriptSegment],
    limit: int = 5,
) -> list[CandidateDraft]:
    """Backward-compatible entry point for local candidate generation."""
    return generate_candidates_flexible(segments, limit=limit)


def normalize_to_one_minute_candidates(
    drafts: list[CandidateDraft],
    video_duration: float,
    limit: int = 5,
) -> list[CandidateDraft]:
    """Compatibility name that preserves natural duration instead of forcing 60s."""
    bounded = [
        draft
        for draft in drafts
        if MIN_CLIP_DURATION_SECONDS <= draft.end - draft.start <= MAX_CLIP_DURATION_SECONDS
        and draft.start >= 0
        and draft.end <= video_duration + 0.001
    ]
    logger.info(
        "candidate_duration_policy_applied",
        policy="flexible_natural_boundary_v1a",
        draft_count=len(drafts),
        bounded_count=len(bounded),
        video_duration=video_duration,
    )
    return suppress_overlap_v2(bounded, limit=limit)


def audit_candidate_duplicates(
    drafts: list[CandidateDraft],
) -> list[tuple[int, int, str]]:
    """Report candidates that violate the active overlap policy."""
    duplicates: list[tuple[int, int, str]] = []
    for left_index, left in enumerate(drafts):
        for right_index in range(left_index + 1, len(drafts)):
            right = drafts[right_index]
            if overlap_ratio(left, right) > 0.60:
                duplicates.append((left_index, right_index, "time_overlap"))
    return duplicates
