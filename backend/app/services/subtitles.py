from pathlib import Path
from typing import Protocol

MAX_SUBTITLE_WORDS = 8
MAX_SUBTITLE_CHARS = 45


class TimedText(Protocol):
    start_seconds: float
    end_seconds: float
    text: str


def ass_timestamp(seconds: float) -> str:
    centiseconds = round(seconds * 100)
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    secs, cents = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{cents:02d}"


def _clean_subtitle_text(text: str) -> str:
    return " ".join(text.split()).strip()


def _safe_chunks(
    text: str,
    max_words: int = MAX_SUBTITLE_WORDS,
    max_chars: int = MAX_SUBTITLE_CHARS,
) -> list[str]:
    words = _clean_subtitle_text(text).split()
    chunks: list[str] = []
    current: list[str] = []
    for word in words:
        if len(word) > max_chars:
            if current:
                chunks.append(" ".join(current))
                current = []
            continue

        candidate = [*current, word]
        candidate_text = " ".join(candidate)
        if len(candidate) <= max_words and len(candidate_text) <= max_chars:
            current = candidate
            continue

        if current:
            chunks.append(" ".join(current))
        current = [word]

    if current:
        chunks.append(" ".join(current))

    return [
        chunk
        for chunk in chunks
        if len(chunk) <= max_chars and len(chunk.split()) <= max_words
    ]


def filter_safe_cues(
    cues: list[tuple[float, float, str]],
    max_words: int = MAX_SUBTITLE_WORDS,
    max_chars: int = MAX_SUBTITLE_CHARS,
) -> list[tuple[float, float, str]]:
    safe: list[tuple[float, float, str]] = []
    for start, end, text in cues:
        cleaned = _clean_subtitle_text(text)
        if end <= start or not cleaned:
            continue
        if len(cleaned) <= max_chars and len(cleaned.split()) <= max_words:
            safe.append((start, end, cleaned))
    return safe


def split_cues(
    text: str,
    duration: float,
    max_words: int = MAX_SUBTITLE_WORDS,
) -> list[tuple[float, float, str]]:
    chunks = _safe_chunks(text, max_words=max_words)
    if not chunks or duration <= 0:
        return []
    cue_duration = duration / len(chunks)
    return [
        (index * cue_duration, min((index + 1) * cue_duration, duration), chunk)
        for index, chunk in enumerate(chunks)
    ]


def transcript_cues(
    segments: list[TimedText],
    clip_start: float,
    clip_end: float,
    max_words: int = MAX_SUBTITLE_WORDS,
) -> list[tuple[float, float, str]]:
    cues: list[tuple[float, float, str]] = []
    for segment in segments:
        start = max(segment.start_seconds, clip_start)
        end = min(segment.end_seconds, clip_end)
        if end <= start or not segment.text.strip():
            continue
        chunks = _safe_chunks(segment.text, max_words=max_words)
        if not chunks:
            continue
        chunk_duration = (end - start) / len(chunks)
        for index, chunk in enumerate(chunks):
            cue_start = start - clip_start + (index * chunk_duration)
            cue_end = start - clip_start + ((index + 1) * chunk_duration)
            cues.append((cue_start, cue_end, chunk))
    return cues


def _ass_text(text: str) -> str:
    return text.replace("{", "(").replace("}", ")").replace("\n", r"\N")


def write_ass_cues(path: Path, cues: list[tuple[float, float, str]]) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Alignment,MarginL,MarginR,MarginV,Outline,Shadow
Style: Default,Arial,64,&H00FFFFFF,&H00000000,&H80000000,-1,2,80,80,180,3,0

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    safe_cues = filter_safe_cues(cues)
    events = [
        (
            f"Dialogue: 0,{ass_timestamp(start)},{ass_timestamp(end)},"
            f"Default,,0,0,0,,{_ass_text(cue)}"
        )
        for start, end, cue in safe_cues
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def write_ass(path: Path, text: str, duration: float) -> None:
    write_ass_cues(path, split_cues(text, duration))
