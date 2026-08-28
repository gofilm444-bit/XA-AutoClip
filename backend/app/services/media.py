import json
import math
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from time import perf_counter
from typing import Any

import structlog

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.services.clipper_style import (
    normalize_audio_settings,
    normalize_video_framing,
    sanitize_keyword_text,
    validate_effect_timeline,
)
from app.services.hook_safe_area import resolve_hook_safe_area
from app.services.render_plan import resolve_hook_render_model
from app.services.text_styles import (
    ExportTextStyle,
    ffmpeg_color,
    resolve_export_text_style,
    resolve_hook_export_style,
    transform_export_text,
)

logger = structlog.get_logger()


def _caption_subtitle_filter(subtitle_path: Path | None) -> str:
    if not subtitle_path:
        return ""
    escaped_subtitle = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
    return f",subtitles='{escaped_subtitle}'"


def _ffmpeg_speed(stderr: str | None) -> str | None:
    if not stderr:
        return None
    matches = re.findall(r"\bspeed=\s*([^\s]+)", stderr)
    return matches[-1] if matches else None


@dataclass(frozen=True)
class MediaMetadata:
    duration: float
    width: int
    height: int
    frame_rate: float
    audio_sample_rate: int | None
    has_audio: bool


@dataclass(frozen=True)
class AudioMixSource:
    path: Path
    start: float = 0.0
    end: float | None = None
    volume: float = 1.0
    label: str = "audio"


def _run(command: list[str], error_code: ErrorCode) -> subprocess.CompletedProcess[str]:
    started_at = perf_counter()
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
            duration_seconds=round(perf_counter() - started_at, 3),
            ffmpeg_speed=_ffmpeg_speed(result.stderr) if command and command[0] == "ffmpeg" else None,
            stderr=result.stderr[-4000:] if result.stderr else "",
        )
        return result
    except subprocess.TimeoutExpired as exc:
        logger.warning(
            "media_command_timeout",
            command=command,
            duration_seconds=round(perf_counter() - started_at, 3),
        )
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
                duration_seconds=round(perf_counter() - started_at, 3),
                ffmpeg_speed=(
                    _ffmpeg_speed(exc.stderr)
                    if command and command[0] == "ffmpeg"
                    else None
                ),
                stdout=exc.stdout[-4000:] if exc.stdout else "",
                stderr=exc.stderr[-4000:] if exc.stderr else "",
            )
        else:
            logger.warning(
                "media_command_missing",
                command=command,
                error=str(exc),
                duration_seconds=round(perf_counter() - started_at, 3),
            )
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


def probe_audio_duration(path: Path) -> float:
    payload = probe_media_json(path)
    audio = next(
        (stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"),
        None,
    )
    duration = float(payload.get("format", {}).get("duration") or (audio or {}).get("duration") or 0)
    if duration <= 0:
        raise AppError(ErrorCode.MEDIA_PROBE_FAILED, "Durasi audio tidak valid.")
    return duration


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


def _keyword_overlay_text(text: str) -> str:
    return sanitize_keyword_text(text.replace("_", " "), max_words=2)


def _drawtext_style_options(style: ExportTextStyle, width: int) -> str:
    scale = max(1.0, width / 540.0)
    border_width = max(0, round(style.outline_width * 2 * scale))
    shadow_offset = max(0, round(style.shadow_offset * scale))
    font_name = f"{style.font_name} Bold" if style.bold else style.font_name
    options = (
        f"font='{_ffmpeg_text(font_name)}':"
        f"fontcolor={ffmpeg_color(style.text_color)}:"
        f"bordercolor={ffmpeg_color(style.outline_color)}:"
        f"borderw={border_width}:"
        f"shadowcolor={ffmpeg_color(style.shadow_color or '#000000')}:"
        f"shadowx={shadow_offset}:shadowy={shadow_offset}:"
    )
    if style.background_color:
        box_border = max(6, round(width * 0.015))
        options += (
            f"box=1:boxcolor={ffmpeg_color(style.background_color, style.background_opacity)}:"
            f"boxborderw={box_border}:"
        )
    else:
        options += "box=0:"
    return options


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
    validated_effects = validate_effect_timeline(effect_timeline or [], 99999)
    hook_model = resolve_hook_render_model(style_config, validated_effects, hook_text)
    logger.info(
        "hook_render_decision",
        hook_render_source=hook_model.source if hook_model else "none",
        hook_event_count=hook_model.hook_event_count if hook_model else 0,
        hook_selected_event_id=hook_model.event_id if hook_model else None,
        hook_overlay_duplicate_suppressed=bool(
            hook_model and hook_model.duplicate_suppressed
        ),
        hook_legacy_fallback_disabled=bool(
            hook_model and hook_model.source == "editor_state"
        ),
    )
    if hook_model and hook_model.duplicate_suppressed:
        logger.info(
            "hook_overlay_duplicate_suppressed",
            hook_render_source=hook_model.source,
            hook_event_count=hook_model.hook_event_count,
            hook_selected_event_id=hook_model.event_id,
        )
        logger.info(
            "hook_legacy_duplicate_suppressed",
            hook_export_style_source=hook_model.source,
            editor_state_version=style_config.get("editor_state_version", 0),
            effect_timeline_initialized=style_config.get(
                "effect_timeline_initialized",
                False,
            ),
        )
    if hook_model:
        hook_size = str(style_config.get("hook_text_size") or "normal")
        hook_fontsize = max(
            26,
            int(width * (0.065 if hook_size == "large" else 0.055)),
        )
        hook_position = str(style_config.get("hook_text_position") or "safe_top")
        hook_style, hook_style_binding, hook_style_fallbacks = (
            resolve_hook_export_style(style_config)
        )
        raw_hook_text = " ".join(hook_model.text.split())
        styled_hook_text = transform_export_text(raw_hook_text, hook_style)
        hook_safe_area = resolve_hook_safe_area(
            hook_position,
            hook_fontsize,
            styled_hook_text,
            width,
            height,
        )
        if styled_hook_text:
            start = hook_model.start
            end = hook_model.end
            line_height = round(hook_safe_area.font_size_px * 1.12)
            for line_index, line in enumerate(hook_safe_area.lines):
                line_y = hook_safe_area.top_px + line_index * line_height
                suffix += (
                    ",drawtext="
                    f"text='{_ffmpeg_text(line)}':"
                    "x=max(w*0.09\\,min((w-text_w)/2\\,w*0.91-text_w)):"
                    f"y={line_y}:"
                    f"fontsize={hook_safe_area.font_size_px}:"
                    f"{_drawtext_style_options(hook_style, width)}"
                    f"enable='between(t,{start},{end})'"
                )
            logger.info(
                "hook_text_safe_layout_export_applied",
                preset=hook_style.key,
                font_name=hook_style.font_name,
                position=hook_position,
                hook_safe_width=hook_safe_area.safe_width_px,
                hook_text_width_estimated=hook_safe_area.text_width_estimated,
                hook_wrap_applied=hook_safe_area.wrap_applied,
                hook_horizontal_clamped=hook_safe_area.horizontal_clamped,
                hook_wrapped_text_preview=hook_safe_area.wrapped_text[:160],
                hook_line_count=hook_safe_area.line_count,
                hook_truncated=hook_safe_area.truncated,
                hook_font_size_requested=hook_fontsize,
                hook_font_size_resolved=hook_safe_area.font_size_px,
                hook_font_size_clamped_reason=(
                    hook_safe_area.font_size_clamped_reason
                ),
                hook_clamped_to_safe_area=hook_safe_area.clamped,
                hook_render_source=hook_model.source,
                hook_export_style_source=hook_style_binding,
                hook_style_binding=hook_style_binding,
                hook_export_preset=hook_style.key,
                hook_export_position=hook_position,
                hook_export_font_size=hook_safe_area.font_size_px,
                hook_export_color=hook_style.text_color,
                hook_export_background={
                    "color": hook_style.background_color,
                    "opacity": hook_style.background_opacity,
                },
                hook_export_text_preview=raw_hook_text[:120],
                hook_export_style_fallback=list(hook_style_fallbacks) or None,
                hook_event_count=hook_model.hook_event_count,
                hook_selected_event_id=hook_model.event_id,
                hook_legacy_fallback_disabled=hook_model.source == "editor_state",
            )
    popup_events = [
        event
        for event in validated_effects
        if event.get("type") == "keyword_popup" and event.get("text")
    ]
    if popup_events or style_config.get("keyword_popup_enabled"):
        keyword_fontsize = max(24, int(width * 0.055))
        keyword_style = resolve_export_text_style(
            style_config.get("keyword_text_style_preset") or "yellow_viral"
        )
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
            keyword_text = transform_export_text(keyword_text, keyword_style)
            suffix += (
                ",drawtext="
                f"text='{_ffmpeg_text(keyword_text)}':"
                "x=max(w*0.12\\,(w-text_w)/2):y=h*0.68:"
                f"fontsize={keyword_fontsize}:"
                f"{_drawtext_style_options(keyword_style, width)}"
                f"enable='between(t,{start},{end})'"
            )
        logger.info(
            "keyword_text_style_export_applied",
            preset=keyword_style.key,
            font_name=keyword_style.font_name,
            event_count=min(3, len(keyword_items)),
            font_size=keyword_fontsize,
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


def _audio_mix_filter(
    source_count: int,
    master_duration: float,
    starts: list[float],
    ends: list[float | None],
    volumes: list[float],
) -> str:
    if source_count <= 0:
        return (
            f"anullsrc=r=48000:cl=stereo,atrim=duration={master_duration:.3f},"
            "asetpts=PTS-STARTPTS[finalaudio]"
        )
    labels: list[str] = []
    for index in range(source_count):
        input_label = f"[{index}:a]"
        output_label = f"[mix{index}]"
        delay = max(0.0, float(starts[index]))
        volume = max(0.0, min(2.0, float(volumes[index])))
        source_duration = max(
            0.01,
            min(
                master_duration - delay,
                (float(ends[index]) if ends[index] is not None else master_duration) - delay,
            ),
        )
        filters = [
            f"atrim=duration={source_duration:.3f}",
            "asetpts=PTS-STARTPTS",
            f"volume={volume:.3f}",
        ]
        if delay > 0:
            filters.append(f"adelay={delay * 1000:.0f}:all=1")
        filters.extend(
            [
                f"atrim=duration={master_duration:.3f}",
                "asetpts=PTS-STARTPTS",
            ]
        )
        labels.append(output_label)
        yield_filter = f"{input_label}{','.join(filters)}{output_label}"
        if index == 0:
            graph = yield_filter
        else:
            graph += f";{yield_filter}"
    joined = "".join(labels)
    return (
        f"{graph};{joined}amix=inputs={source_count}:duration=longest:dropout_transition=0,"
        f"atrim=duration={master_duration:.3f},asetpts=PTS-STARTPTS[finalaudio]"
    )


def _center_crop_filter_chain(
    width: int,
    height: int,
    style_config: dict[str, Any] | None,
) -> str:
    framing = normalize_video_framing((style_config or {}).get("video_framing"))
    scaled_width = max(2, math.ceil(width * framing["scale"] / 2) * 2)
    scaled_height = max(2, math.ceil(height * framing["scale"] / 2) * 2)
    crop_x_ratio = 0.5 - framing["x"] / 80.0
    crop_y_ratio = 0.5 - framing["y"] / 80.0
    return (
        f"scale={scaled_width}:{scaled_height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height}:(iw-{width})*{crop_x_ratio:.6f}:"
        f"(ih-{height})*{crop_y_ratio:.6f},setsar=1"
    )


def _blurred_background_filter_graph(
    width: int,
    height: int,
    style_config: dict[str, Any] | None,
    output_label: str = "base",
) -> str:
    framing = normalize_video_framing((style_config or {}).get("video_framing"))
    foreground_scale = ""
    if framing["scale"] > 1.0:
        foreground_scale = (
            f",scale=trunc(iw*{framing['scale']:.6f}/2)*2:"
            f"trunc(ih*{framing['scale']:.6f}/2)*2"
        )
    overlay_x = f"(W-w)/2+w*{framing['x'] / 100.0:.6f}"
    overlay_y = f"(H-h)/2+h*{framing['y'] / 100.0:.6f}"
    return (
        f"[0:v]split[bg][fg];"
        f"[bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},boxblur=20[blur];"
        f"[fg]scale={width}:{height}:force_original_aspect_ratio=decrease"
        f"{foreground_scale}[front];"
        f"[blur][front]overlay={overlay_x}:{overlay_y},setsar=1[{output_label}]"
    )


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
    audio_mix_sources: list[AudioMixSource] | None = None,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subtitle_filter = ""
    if subtitle_path:
        escaped_subtitle = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
        subtitle_filter = f",subtitles='{escaped_subtitle}'"
    subtitle_filter = _caption_subtitle_filter(subtitle_path)
    style_filter = _style_filter_suffix(
        style_config,
        width,
        height,
        hook_text,
        keywords,
        effect_timeline,
    )
    output_suffix = f"{style_filter}{subtitle_filter}"
    video_framing = normalize_video_framing((style_config or {}).get("video_framing"))
    if preset == "center_crop":
        video_filter = f"[0:v]{_center_crop_filter_chain(width, height, style_config)}[base]"
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
        video_filter = _blurred_background_filter_graph(width, height, style_config)
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
        video_framing=video_framing,
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
    mix_sources = list(audio_mix_sources or [])
    if voiceover:
        command.extend(["-i", str(voiceover)])
    for audio_source in mix_sources:
        command.extend(["-i", str(audio_source.path)])
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
    if mix_sources:
        input_sources = [
            AudioMixSource(voiceover, label="base_audio")
            if voiceover
            else AudioMixSource(source, label="video_audio")
        ] + mix_sources
        starts = [item.start for item in input_sources]
        ends = [item.end for item in input_sources]
        volumes = [1.0 for item in input_sources]
        if style_config:
            volumes[0] = 1.0
        volumes[1:] = [item.volume for item in mix_sources]
        audio_filter_graph = _audio_mix_filter(
            len(input_sources), duration, starts, ends, volumes
        )
        input_offset = 1 if voiceover else 0
        for index in range(len(input_sources) - 1, -1, -1):
            audio_filter_graph = audio_filter_graph.replace(
                f"[{index}:a]", f"[{index + input_offset}:a]"
            )
        audio_filter_graph = audio_filter_graph.replace(
            "[finalaudio]", f",{audio_filter}[finalaudio]"
        )
        filter_complex_index = command.index("-filter_complex") + 1
        command[filter_complex_index] = f"{video_filter};{audio_filter_graph}"
        command.extend(["-map", "[finalaudio]"])
    elif voiceover:
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
    audio_mix_sources: list[AudioMixSource] | None = None,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    video_framing = normalize_video_framing((style_config or {}).get("video_framing"))
    subtitle_filter = ""
    if subtitle_path:
        escaped_subtitle = str(subtitle_path).replace("\\", "/").replace(":", "\\:")
        subtitle_filter = f",subtitles='{escaped_subtitle}'"
    subtitle_filter = _caption_subtitle_filter(subtitle_path)
    deleted_video_filter = (
        ",drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill"
        if (style_config or {}).get("video_track_deleted")
        else ""
    )
    uses_complex_video_filter = False
    if preset == "fit_background":
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
            f"{deleted_video_filter}{subtitle_filter}"
        )
    elif preset == "center_crop":
        video_filter = (
            f"{_center_crop_filter_chain(width, height, style_config)}"
            f"{deleted_video_filter}{subtitle_filter}"
        )
    elif preset == "blurred_background":
        uses_complex_video_filter = True
        video_filter = (
            f"{_blurred_background_filter_graph(width, height, style_config)};"
            f"[base]null{deleted_video_filter}{subtitle_filter}[vout]"
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
        video_framing=video_framing,
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
    mix_sources = list(audio_mix_sources or [])
    for audio_mix_source in mix_sources:
        command.extend(["-i", str(audio_mix_source.path)])
    if mix_sources:
        input_sources = [
            AudioMixSource(audio_source, label="base_audio")
            if audio_source
            else AudioMixSource(source, label="video_audio")
        ] + mix_sources
        audio_filter_graph = _audio_mix_filter(
            len(input_sources),
            duration,
            [item.start for item in input_sources],
            [item.end for item in input_sources],
            [1.0, *[item.volume for item in mix_sources]],
        )
        input_offset = 1 if audio_source else 0
        for index in range(len(input_sources) - 1, -1, -1):
            audio_filter_graph = audio_filter_graph.replace(
                f"[{index}:a]", f"[{index + input_offset}:a]"
            )
        audio_filter_graph = audio_filter_graph.replace(
            "[finalaudio]", f",{_audio_filter(style_config, duration)}[finalaudio]"
        )
        if uses_complex_video_filter:
            video_filter = f"{video_filter};{audio_filter_graph}"
        else:
            video_filter = f"[0:v]{video_filter}[vout];{audio_filter_graph}"
            uses_complex_video_filter = True
    video_filter_args = (
        ["-filter_complex", video_filter, "-map", "[vout]"]
        if uses_complex_video_filter
        else ["-vf", video_filter, "-map", "0:v:0"]
    )
    command.extend(
        [
            "-t",
            str(duration),
            *video_filter_args,
            "-map",
            "[finalaudio]" if mix_sources else ("1:a:0" if audio_source else "0:a?"),
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
