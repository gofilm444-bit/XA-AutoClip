from pathlib import Path
from typing import Protocol


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


def split_cues(text: str, duration: float, max_words: int = 8) -> list[tuple[float, float, str]]:
    words = text.split()
    chunks = [words[index : index + max_words] for index in range(0, len(words), max_words)]
    if not chunks:
        return []
    cue_duration = duration / len(chunks)
    return [
        (index * cue_duration, min((index + 1) * cue_duration, duration), " ".join(chunk))
        for index, chunk in enumerate(chunks)
    ]


def transcript_cues(
    segments: list[TimedText],
    clip_start: float,
    clip_end: float,
    max_words: int = 8,
) -> list[tuple[float, float, str]]:
    cues: list[tuple[float, float, str]] = []
    for segment in segments:
        start = max(segment.start_seconds, clip_start)
        end = min(segment.end_seconds, clip_end)
        if end <= start or not segment.text.strip():
            continue
        words = segment.text.split()
        chunks = [
            words[index : index + max_words]
            for index in range(0, len(words), max_words)
        ]
        chunk_duration = (end - start) / len(chunks)
        for index, chunk in enumerate(chunks):
            cue_start = start - clip_start + (index * chunk_duration)
            cue_end = start - clip_start + ((index + 1) * chunk_duration)
            cues.append((cue_start, cue_end, " ".join(chunk)))
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
    events = [
        (
            f"Dialogue: 0,{ass_timestamp(start)},{ass_timestamp(end)},"
            f"Default,,0,0,0,,{_ass_text(cue)}"
        )
        for start, end, cue in cues
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def write_ass(path: Path, text: str, duration: float) -> None:
    write_ass_cues(path, split_cues(text, duration))
