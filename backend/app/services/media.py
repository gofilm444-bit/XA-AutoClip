import json
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode


@dataclass(frozen=True)
class MediaMetadata:
    duration: float
    width: int
    height: int
    frame_rate: float
    audio_sample_rate: int | None
    has_audio: bool


def _run(command: list[str], error_code: ErrorCode) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=get_settings().job_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise AppError(ErrorCode.JOB_TIMEOUT, "Proses media melewati batas waktu.") from exc
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise AppError(error_code, "Proses media gagal. Periksa format dan codec file.") from exc


def probe_media(path: Path) -> MediaMetadata:
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(path),
        ],
        ErrorCode.MEDIA_PROBE_FAILED,
    )
    payload = json.loads(result.stdout)
    video = next((stream for stream in payload["streams"] if stream["codec_type"] == "video"), None)
    audio = next((stream for stream in payload["streams"] if stream["codec_type"] == "audio"), None)
    if not video:
        raise AppError(ErrorCode.INVALID_VIDEO, "File tidak memiliki stream video.")
    duration = float(payload.get("format", {}).get("duration") or video.get("duration") or 0)
    if duration <= 0:
        raise AppError(ErrorCode.INVALID_VIDEO, "Durasi video tidak valid.")
    if duration > get_settings().max_video_duration_seconds:
        raise AppError(ErrorCode.VIDEO_TOO_LONG, "Durasi video melebihi batas.")
    rate = Fraction(video.get("avg_frame_rate", "0/1"))
    return MediaMetadata(
        duration=duration,
        width=int(video["width"]),
        height=int(video["height"]),
        frame_rate=float(rate),
        audio_sample_rate=int(audio["sample_rate"]) if audio and audio.get("sample_rate") else None,
        has_audio=audio is not None,
    )


def extract_audio(source: Path, destination: Path, has_audio: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if has_audio:
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ]
    else:
        command = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=16000:cl=mono",
            "-t",
            "1",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ]
    _run(command, ErrorCode.AUDIO_EXTRACTION_FAILED)


def render_vertical(
    source: Path,
    destination: Path,
    start: float,
    duration: float,
    width: int,
    height: int,
    preset: str,
    voiceover: Path | None = None,
    subtitle_path: Path | None = None,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subtitle_filter = ""
    if subtitle_path:
        escaped_subtitle = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
        subtitle_filter = f",subtitles='{escaped_subtitle}'"
    use_complex_filter = False
    if preset == "center_crop":
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}{subtitle_filter}"
        )
    elif preset == "fit_background":
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black{subtitle_filter}"
        )
    elif preset == "picture_in_picture":
        use_complex_filter = True
        inset_width = int(width * 0.84)
        inset_height = int(height * 0.5)
        video_filter = (
            f"split[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=20[blur];"
            f"[fg]scale={inset_width}:{inset_height}:force_original_aspect_ratio=decrease,"
            f"pad={inset_width}:{inset_height}:(ow-iw)/2:(oh-ih)/2:black[front];"
            f"[blur][front]overlay=(W-w)/2:H-h-100{subtitle_filter}[vout]"
        )
    else:
        use_complex_filter = True
        video_filter = (
            f"split[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=20[blur];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[front];"
            f"[blur][front]overlay=(W-w)/2:(H-h)/2{subtitle_filter}[vout]"
        )
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        str(start),
        "-i",
        str(source),
    ]
    if voiceover:
        command.extend(["-i", str(voiceover)])
    command.extend(
        [
            "-t",
            str(duration),
            "-filter_complex" if use_complex_filter else "-vf",
            video_filter,
        ]
    )
    if use_complex_filter:
        command.extend(["-map", "[vout]"])
    if voiceover:
        command.extend(["-map", "1:a:0", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.15"])
    else:
        command.extend(["-map", "0:a?"])
    command.extend(
        [
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(destination),
        ]
    )
    _run(command, ErrorCode.RENDER_FAILED)
