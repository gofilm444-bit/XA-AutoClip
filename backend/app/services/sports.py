import math
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.models import TranscriptSegment
from app.services.candidates import CandidateDraft, overlap_ratio

PTS_RE = re.compile(r"pts_time:(?P<time>[\d.]+)")
LOUDNESS_RE = re.compile(r"lavfi\.r128\.M=(?P<loudness>-?[\d.]+)")
SCENE_RE = re.compile(r"Parsed_showinfo.*?pts_time:(?P<time>[\d.]+)")


@dataclass(frozen=True)
class SportsSignal:
    time: float
    loudness: float
    scene_activity: float


def format_transcript_timestamp(seconds: float) -> str:
    minutes = int(seconds // 60)
    remainder = int(seconds % 60)
    return f"{minutes:02d}:{remainder:02d}"


def sports_transcript(
    segments: list[TranscriptSegment],
    start: float,
    end: float,
) -> str:
    lines = [
        f"[{format_transcript_timestamp(segment.start_seconds)}] {segment.text.strip()}"
        for segment in segments
        if segment.end_seconds > start
        and segment.start_seconds < end
        and segment.text.strip()
    ]
    return "\n".join(lines)


def parse_sports_signals(output: str) -> list[SportsSignal]:
    loudness_points: list[tuple[float, float]] = []
    current_time: float | None = None
    for line in output.splitlines():
        timestamp = PTS_RE.search(line)
        if timestamp:
            current_time = float(timestamp.group("time"))
        loudness = LOUDNESS_RE.search(line)
        if loudness and current_time is not None:
            value = float(loudness.group("loudness"))
            if math.isfinite(value):
                loudness_points.append((current_time, value))
    scene_times = [float(match.group("time")) for match in SCENE_RE.finditer(output)]
    if not loudness_points and not scene_times:
        return []

    buckets: dict[int, list[float]] = {}
    for timestamp, loudness in loudness_points:
        buckets.setdefault(int(timestamp // 2), []).append(loudness)

    all_buckets = set(buckets)
    all_buckets.update(int(scene_time // 2) for scene_time in scene_times)
    signals: list[SportsSignal] = []
    for bucket in sorted(all_buckets):
        values = buckets.get(bucket, [-50.0])
        center = bucket * 2 + 1
        scene_count = sum(abs(scene_time - center) <= 3 for scene_time in scene_times)
        signals.append(
            SportsSignal(
                time=float(center),
                loudness=max(values),
                scene_activity=min(scene_count / 4, 1.0),
            )
        )
    return signals


def analyze_sports_video(source: Path, has_audio: bool = True) -> list[SportsSignal]:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-i",
        str(source),
    ]
    if has_audio:
        command.extend(
            [
                "-filter_complex",
                (
                    "[0:v]fps=2,select='gt(scene,0.18)',showinfo[v];"
                    "[0:a]ebur128=metadata=1,"
                    "ametadata=print:key=lavfi.r128.M[a]"
                ),
                "-map",
                "[v]",
                "-map",
                "[a]",
            ]
        )
    else:
        command.extend(
            [
                "-vf",
                "fps=2,select='gt(scene,0.18)',showinfo",
                "-an",
            ]
        )
    command.extend(["-f", "null", "-"])
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=get_settings().job_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise AppError(ErrorCode.JOB_TIMEOUT, "Analisis olahraga melewati batas waktu.") from exc
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise AppError(
            ErrorCode.MEDIA_PROBE_FAILED,
            "Analisis audio dan perubahan adegan olahraga gagal.",
        ) from exc
    return parse_sports_signals(f"{result.stdout}\n{result.stderr}")


def generate_sports_candidates(
    signals: list[SportsSignal],
    video_duration: float,
    limit: int = 5,
) -> list[CandidateDraft]:
    if not signals:
        return []

    loudness_values = sorted(signal.loudness for signal in signals)
    baseline = loudness_values[len(loudness_values) // 2]
    peaks = sorted(
        signals,
        key=lambda signal: (
            max(0.0, signal.loudness - baseline) * 0.75
            + signal.scene_activity * 8
        ),
        reverse=True,
    )
    drafts: list[CandidateDraft] = []
    for signal in peaks:
        excitement = min(100.0, 55 + max(0.0, signal.loudness - baseline) * 4)
        visual = min(100.0, 55 + signal.scene_activity * 45)
        start = max(0.0, signal.time - 12)
        end = min(video_duration, signal.time + 18)
        if end - start < 12:
            continue
        scores = {
            "hook": round(excitement, 2),
            "context": 78.0,
            "information": round(visual, 2),
            "emotion": round(excitement, 2),
            "fluency": 82.0,
            "duration": max(60.0, 100 - abs(30 - (end - start)) * 2),
            "discussion": round((excitement + visual) / 2, 2),
        }
        drafts.append(
            CandidateDraft(
                start=round(start, 3),
                end=round(end, 3),
                text=(
                    f"Momen olahraga berintensitas tinggi sekitar detik {signal.time:.0f}; "
                    "dipilih dari lonjakan audio penonton/komentator dan perubahan adegan."
                ),
                scores=scores,
            )
        )
    selected: list[CandidateDraft] = []
    for draft in drafts:
        if all(overlap_ratio(draft, existing) < 0.5 for existing in selected):
            selected.append(draft)
        if len(selected) == limit:
            break
    return selected
