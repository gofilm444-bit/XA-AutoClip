from dataclasses import dataclass

from app.models import TranscriptSegment


@dataclass(frozen=True)
class CandidateDraft:
    start: float
    end: float
    text: str
    scores: dict[str, float]


def weighted_score(scores: dict[str, float]) -> float:
    return round(
        scores["hook"] * 0.25
        + scores["context"] * 0.20
        + scores["information"] * 0.20
        + scores["emotion"] * 0.15
        + scores["fluency"] * 0.10
        + scores["duration"] * 0.05
        + scores["discussion"] * 0.05,
        2,
    )


def generate_candidates(
    segments: list[TranscriptSegment],
    limit: int = 5,
) -> list[CandidateDraft]:
    drafts: list[CandidateDraft] = []
    for start_index in range(len(segments)):
        for end_index in range(start_index + 1, len(segments)):
            selected = segments[start_index : end_index + 1]
            duration = selected[-1].end_seconds - selected[0].start_seconds
            if duration < 20:
                continue
            if duration > 60:
                break
            text = " ".join(segment.text for segment in selected)
            unclear = sum(text.lower().split().count(word) for word in ("ini", "itu", "dia"))
            scores = {
                "hook": max(55, 88 - unclear * 4 + min(len(text) / 40, 8)),
                "context": max(50, 92 - unclear * 5),
                "information": min(95, 64 + len(set(text.lower().split())) / 4),
                "emotion": 68 + (start_index % 4) * 4,
                "fluency": 90,
                "duration": max(50, 100 - abs(40 - duration) * 2),
                "discussion": 72 + (end_index % 4) * 5,
            }
            drafts.append(
                CandidateDraft(
                    start=selected[0].start_seconds,
                    end=selected[-1].end_seconds,
                    text=text,
                    scores={key: round(min(value, 100), 2) for key, value in scores.items()},
                )
            )
    return suppress_overlap(
        sorted(drafts, key=lambda item: weighted_score(item.scores), reverse=True),
        limit=limit,
    )


def normalize_to_one_minute_candidates(
    drafts: list[CandidateDraft],
    video_duration: float,
    limit: int = 5,
) -> list[CandidateDraft]:
    if not drafts:
        return []
    clip_duration = min(60.0, video_duration)
    if video_duration <= 60:
        draft = drafts[0]
        return [
            CandidateDraft(
                start=0.0,
                end=round(clip_duration, 3),
                text=draft.text,
                scores=draft.scores,
            )
        ]

    latest_start = video_duration - 60
    selected: list[CandidateDraft] = []

    for draft in drafts:
        start = round(min(draft.start, latest_start))
        candidate = CandidateDraft(
            start=float(start),
            end=float(start + 60),
            text=draft.text,
            scores=draft.scores,
        )
        if any(overlap_ratio(candidate, existing) >= 0.8 for existing in selected):
            continue
        selected.append(candidate)
        if len(selected) == limit:
            return selected

    for draft in drafts:
        start = round(min(draft.start, latest_start))
        if any(existing.start == start for existing in selected):
            continue
        selected.append(
            CandidateDraft(
                start=float(start),
                end=float(start + 60),
                text=draft.text,
                scores=draft.scores,
            )
        )
        if len(selected) == limit:
            break
    return selected


def overlap_ratio(left: CandidateDraft, right: CandidateDraft) -> float:
    overlap = max(0, min(left.end, right.end) - max(left.start, right.start))
    shorter = min(left.end - left.start, right.end - right.start)
    return overlap / shorter if shorter else 0


def suppress_overlap(drafts: list[CandidateDraft], limit: int = 5) -> list[CandidateDraft]:
    selected: list[CandidateDraft] = []
    for draft in drafts:
        if all(overlap_ratio(draft, existing) < 0.8 for existing in selected):
            selected.append(draft)
        if len(selected) == limit:
            return selected
    for draft in drafts:
        if draft not in selected:
            selected.append(draft)
        if len(selected) == limit:
            break
    return selected
