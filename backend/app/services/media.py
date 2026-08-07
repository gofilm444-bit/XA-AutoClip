import json
import subprocess
import unicodedata
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any

import structlog

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.services.clipper_style import (
    normalize_audio_settings,
    sanitize_keyword_text,
    validate_effect_timeline,
)

logger = structlog.get_logger()


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
        logger.info("media_command_start", command=command)
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=get_settings().job_timeout_seconds,
        )
        logger.info(
            "media_command_completed",
            command=command,
            returncode=result.returncode,
            stderr=result.stderr[-4000:] if result.stderr else "",
        )
        return result
    except subprocess.TimeoutExpired as exc:
        logger.warning("media_command_timeout", command=command)
        raise AppError(ErrorCode.JOB_TIMEOUT, "Proses media melewati batas waktu.") from exc
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        detail = ""
        if isinstance(exc, subprocess.CalledProcessError):
            detail = (exc.stderr or exc.stdout or "").strip().splitlines()[-1:]
            detail = f" Detail: {detail[0]}" if detail else ""
            logger.warning(
                "media_command_failed",
                command=command,
                returncode=exc.returncode,
                stdout=exc.stdout[-4000:] if exc.stdout else "",
                stderr=exc.stderr[-4000:] if exc.stderr else "",
            )
        else:
            logger.warning("media_command_missing", command=command, error=str(exc))
        raise AppError(
            error_code,
            f"Proses media gagal. Periksa format dan codec file.{detail}",
        ) from exc


def probe_media_json(path: Path) -> dict:
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
    logger.info("media_probe_json", path=str(path), output=result.stdout[-4000:])
    return json.loads(result.stdout)


def probe_media(path: Path) -> MediaMetadata:
    payload = probe_media_json(path)
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


def extract_clip(source: Path, destination: Path, start: float, duration: float) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        str(start),
        "-i",
        str(source),
        "-t",
        str(duration),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    _run(command, ErrorCode.RENDER_FAILED)


def assemble_media_sequence(
    source: Path,
    destination: Path,
    segments: list[tuple[float, float]],
) -> None:
    """Build one continuous A/V source from ordered source-time ranges."""
    if not segments:
        raise AppError(ErrorCode.RENDER_FAILED, "Urutan media untuk render kosong.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    metadata = probe_media(source)
    filters: list[str] = []
    concat_inputs: list[str] = []
    for index, (start, end) in enumerate(segments):
        filters.append(
            f"[0:v]trim=start={start:.3f}:end={end:.3f},setpts=PTS-STARTPTS[v{index}]"
        )
        concat_inputs.append(f"[v{index}]")
        if metadata.has_audio:
            filters.append(
                f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[a{index}]"
            )
            concat_inputs.append(f"[a{index}]")
    filters.append(
        "".join(concat_inputs)
        + f"concat=n={len(segments)}:v=1:a={1 if metadata.has_audio else 0}[vout]"
        + ("[aout]" if metadata.has_audio else "")
    )
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[vout]",
    ]
    if metadata.has_audio:
        command.extend(["-map", "[aout]"])
    command.extend(
        [
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


def extract_thumbnail(source: Path, destination: Path, at_seconds: float = 1.0) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        str(max(0.0, at_seconds)),
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        str(destination),
    ]
    _run(command, ErrorCode.RENDER_FAILED)


def _sanitize_overlay_text(text: str, max_chars: int = 90) -> str:
    normalized = unicodedata.normalize("NFKC", str(text or ""))
    cleaned = "".join(
        char
        for char in normalized
        if char == "\n"
        or (
            char >= " "
            and char != "\ufffd"
            and not unicodedata.category(char).startswith("C")
        )
    )
    cleaned = cleaned.replace("\r", "\n")
    cleaned = "\n".join(" ".join(line.split()) for line in cleaned.split("\n"))
    return cleaned.strip()[:max_chars].strip(" .,;:")


def _ffmpeg_text(text: str) -> str:
    safe = _sanitize_overlay_text(text)
    return (
        safe.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace(",", "\\,")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("\n", "\\n")
    )


def _trim_words(text: str, max_words: int) -> str:
    words = text.replace("\n", " ").split()
    return " ".join(words[:max_words]).strip(" .,;:")


def _wrap_overlay_text(text: str, width: int, fontsize: int, max_lines: int = 2) -> str:
    words = _trim_words(text, 10).split()
    if not words:
        return ""
    max_chars = max(12, min(28, int((width * 0.8) / max(fontsize * 0.52, 1))))
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > max_chars:
            lines.append(current)
            current = word
            if len(lines) == max_lines - 1:
                break
        else:
            current = candidate
    if current and len(lines) < max_lines:
        lines.append(current)
    return "\n".join(lines[:max_lines])


def _keyword_overlay_text(text: str) -> str:
    return sanitize_keyword_text(text.replace("_", " "), max_words=2)


def layout_mode(preset: str) -> str:
    return {
        "center_crop": "center_crop",
        "fit_background": "contain",
        "picture_in_picture": "picture_in_picture",
        "blurred_background": "blurred_background",
    }.get(preset, "blurred_background")


def _style_filter_suffix(
    style_config: dict[str, Any] | None,
    width: int,
    height: int,
    hook_text: str = "",
    keywords: list[str] | None = None,
    effect_timeline: list[dict[str, Any]] | None = None,
) -> str:
    if not style_config:
        return ""
    suffix = ""
    hook_events = [
        event
        for event in validate_effect_timeline(effect_timeline or [], 99999)
        if event.get("type") == "hook_text" and event.get("text")
    ]
    if style_config.get("hook_text_enabled") and (hook_text or hook_events):
        hook_fontsize = max(30, int(width * 0.07))
        hook_border = max(10, int(width * 0.025))
        hook_items = hook_events or [
            {"start": 0.0, "end": 3.0, "text": hook_text}
        ]
        for event in hook_items[:2]:
            hook_lines = _wrap_overlay_text(str(event.get("text") or hook_text), width, hook_fontsize)
            if not hook_lines:
                continue
            start = float(event.get("start") or 0.0)
            end = float(event.get("end") or 3.0)
            suffix += (
                ",drawtext="
                f"text='{_ffmpeg_text(hook_lines)}':"
                "x=max(w*0.10\\,(w-text_w)/2):y=h*0.10:"
                f"fontsize={hook_fontsize}:fontcolor=white:"
                "line_spacing=8:"
                "box=1:boxcolor=black@0.45:"
                f"boxborderw={hook_border}:"
                f"enable='between(t,{start},{end})'"
            )
    popup_events = [
        event
        for event in validate_effect_timeline(effect_timeline or [], 99999)
        if event.get("type") == "keyword_popup" and event.get("text")
    ]
    if style_config.get("keyword_popup_enabled"):
        keyword_fontsize = max(28, int(width * 0.075))
        keyword_border = max(8, int(width * 0.018))
        if popup_events:
            keyword_items = [
                (
                    str(event.get("text") or ""),
                    float(event.get("start") or 0.0),
                    float(event.get("end") or 0.0),
                )
                for event in popup_events[:3]
            ]
        else:
            keyword_items = [
                (_keyword_overlay_text(keyword), 5 + (index * 14), 6.2 + (index * 14))
                for index, keyword in enumerate((keywords or [])[:3])
            ]
        for keyword, start, end in keyword_items:
            keyword_text = _keyword_overlay_text(keyword)
            if not keyword_text:
                continue
            suffix += (
                ",drawtext="
                f"text='{_ffmpeg_text(keyword_text)}':"
                "x=max(w*0.12\\,(w-text_w)/2):y=h*0.68:"
                f"fontsize={keyword_fontsize}:fontcolor=yellow:"
                "box=1:boxcolor=black@0.42:"
                f"boxborderw={keyword_border}:"
                f"enable='between(t,{start},{end})'"
            )
    return suffix


def _enabled_punch_events(
    style_config: dict[str, Any] | None,
    effect_timeline: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not style_config or not style_config.get("punch_zoom_enabled"):
        return []
    events: list[dict[str, Any]] = []
    for event in validate_effect_timeline(effect_timeline or [], 99999):
        if event.get("type") != "punch_zoom":
            continue
        start = float(event.get("start") or 0.0)
        end = float(event.get("end") or 0.0)
        if end <= start:
            continue
        zoom = max(1.01, min(float(event.get("zoom") or 1.06), 1.20))
        events.append({"start": start, "end": end, "zoom": zoom})
    return events[:5]


def _append_punch_zoom_filter(
    graph: str,
    input_label: str,
    output_label: str,
    width: int,
    height: int,
    events: list[dict[str, Any]],
) -> str:
    if not events:
        return f"{graph};[{input_label}]null[{output_label}]"
    zoom = max(float(event["zoom"]) for event in events)
    zoomed_width = int(width * zoom + 0.5)
    zoomed_height = int(height * zoom + 0.5)
    zoomed_width += zoomed_width % 2
    zoomed_height += zoomed_height % 2
    enable = "+".join(
        f"between(t\\,{event['start']:.2f}\\,{event['end']:.2f})" for event in events
    )
    return (
        f"{graph};"
        f"[{input_label}]split=2[{input_label}main][{input_label}zoomsrc];"
        f"[{input_label}zoomsrc]scale={zoomed_width}:{zoomed_height},"
        f"crop={width}:{height}:(iw-{width})/2:(ih-{height})/2[{input_label}zoom];"
        f"[{input_label}main][{input_label}zoom]overlay=0:0:enable='{enable}'[{output_label}]"
    )


def validate_render_output(
    path: Path,
    expected_duration: float | None = None,
    min_size_bytes: int = 20_000,
) -> MediaMetadata:
    file_size = path.stat().st_size if path.is_file() else 0
    logger.info(
        "render_output_validation",
        checked_path=str(path),
        file_size=file_size,
        exists=path.is_file(),
    )
    if not path.is_file():
        raise AppError(
            ErrorCode.RENDER_FAILED,
            f"File render tidak terbentuk. Path dicek: {path}",
        )
    if file_size < min_size_bytes:
        raise AppError(
            ErrorCode.RENDER_FAILED,
            f"File render terlalu kecil atau kosong. Path: {path}. Size: {file_size} bytes.",
        )
    try:
        probe_payload = probe_media_json(path)
        stream_summary = [
            {
                "codec_type": stream.get("codec_type"),
                "codec_name": stream.get("codec_name"),
                "width": stream.get("width"),
                "height": stream.get("height"),
            }
            for stream in probe_payload.get("streams", [])
        ]
        logger.info(
            "render_output_validation_probe",
            checked_path=str(path),
            file_size=file_size,
            streams=stream_summary,
        )
        metadata = probe_media(path)
    except AppError as exc:
        raise AppError(
            ErrorCode.RENDER_FAILED,
            f"Output render invalid. Path: {path}. Size: {file_size} bytes. Detail: {exc.message}",
        ) from exc
    if expected_duration:
        minimum_duration = max(0.5, min(expected_duration * 0.5, 2.0))
        if metadata.duration < minimum_duration:
            raise AppError(
                ErrorCode.RENDER_FAILED,
                f"Durasi hasil render tidak valid. Path: {path}. Durasi: {metadata.duration:.2f}s.",
            )
    return metadata


def _audio_filter(style_config: dict[str, Any] | None, duration: float) -> str:
    settings = normalize_audio_settings((style_config or {}).get("audio_settings"))
    volume = 0.0 if settings["muted"] else float(settings["volume"])
    filters = [f"volume={volume:.2f}"]
    fade_in = min(float(settings["fade_in"]), max(0.0, duration))
    fade_out = min(float(settings["fade_out"]), max(0.0, duration))
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in:.2f}")
    if fade_out > 0:
        filters.append(f"afade=t=out:st={max(0.0, duration - fade_out):.2f}:d={fade_out:.2f}")
    return ",".join(filters)


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
    style_config: dict[str, Any] | None = None,
    hook_text: str = "",
    keywords: list[str] | None = None,
    effect_timeline: list[dict[str, Any]] | None = None,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subtitle_filter = ""
    if subtitle_path:
        escaped_subtitle = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
        subtitle_filter = f",subtitles='{escaped_subtitle}'"
    style_filter = _style_filter_suffix(
        style_config,
        width,
        height,
        hook_text,
        keywords,
        effect_timeline,
    )
    output_suffix = f"{style_filter}{subtitle_filter}"
    if preset == "center_crop":
        video_filter = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:(iw-{width})/2:(ih-{height})/2,"
            "setsar=1[base]"
        )
    elif preset == "fit_background":
        video_filter = (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
            "setsar=1[base]"
        )
    elif preset == "picture_in_picture":
        inset_width = int(width * 0.84)
        inset_height = int(height * 0.5)
        video_filter = (
            f"[0:v]split[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=20[blur];"
            f"[fg]scale={inset_width}:{inset_height}:force_original_aspect_ratio=decrease,"
            f"pad={inset_width}:{inset_height}:(ow-iw)/2:(oh-ih)/2:black[front];"
            "[blur][front]overlay=(W-w)/2:H-h-100,setsar=1[base]"
        )
    else:
        video_filter = (
            f"[0:v]split[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=20[blur];"
            f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[front];"
            "[blur][front]overlay=(W-w)/2:(H-h)/2,setsar=1[base]"
        )
    base_label = "base"
    if (style_config or {}).get("video_track_deleted"):
        video_filter = (
            f"{video_filter};[base]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill[blank]"
        )
        base_label = "blank"
    punch_events = _enabled_punch_events(style_config, effect_timeline)
    video_filter = _append_punch_zoom_filter(
        video_filter,
        base_label,
        "effected",
        width,
        height,
        punch_events,
    )
    video_filter = f"{video_filter};[effected]null{output_suffix}[vout]"
    logger.info(
        "render_layout_filter",
        preset=preset,
        layout_mode=layout_mode(preset),
        target_width=width,
        target_height=height,
        video_filter=video_filter,
        effect_timeline=effect_timeline or [],
        punch_event_count=len(punch_events),
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
            "-filter_complex",
            video_filter,
        ]
    )
    command.extend(["-map", "[vout]"])
    audio_filter = _audio_filter(style_config, duration)
    if voiceover:
        command.extend(
            [
                "-map",
                "1:a:0",
                "-af",
                f"loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.15,{audio_filter}",
            ]
        )
    else:
        command.extend(["-map", "0:a?", "-af", audio_filter])
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


def render_clean_vertical(
    source: Path,
    destination: Path,
    start: float,
    duration: float,
    width: int,
    height: int,
    preset: str,
    subtitle_path: Path | None = None,
    style_config: dict[str, Any] | None = None,
    audio_source: Path | None = None,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subtitle_filter = ""
    if subtitle_path:
        escaped_subtitle = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
        subtitle_filter = f",subtitles='{escaped_subtitle}'"
    deleted_video_filter = (
        ",drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill"
        if (style_config or {}).get("video_track_deleted")
        else ""
    )
    if preset == "fit_background":
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
            f"{deleted_video_filter}{subtitle_filter}"
        )
    elif preset == "center_crop":
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:(iw-{width})/2:(ih-{height})/2,setsar=1"
            f"{deleted_video_filter}{subtitle_filter}"
        )
    else:
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},setsar=1"
            f"{deleted_video_filter}{subtitle_filter}"
        )
    logger.info(
        "render_clean_layout_filter",
        preset=preset,
        layout_mode=layout_mode(preset),
        target_width=width,
        target_height=height,
        video_filter=video_filter,
    )
    command = [
        "ffmpeg",
        "-y",
        "-ss",
        str(start),
        "-i",
        str(source),
    ]
    if audio_source:
        command.extend(["-i", str(audio_source)])
    command.extend(
        [
        "-t",
        str(duration),
        "-vf",
        video_filter,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0" if audio_source else "0:a?",
        "-af",
        _audio_filter(style_config, duration),
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
