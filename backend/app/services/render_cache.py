import hashlib
import json
from pathlib import Path
from typing import Any

from app.services.clipper_style import normalize_clipper_style, normalize_video_framing
from app.services.editor_elements import fingerprint_style_fields

RENDER_FINGERPRINT_VERSION = 3
RENDER_STYLE_KEYS = fingerprint_style_fields()


def render_fingerprint(
    style_config: dict[str, Any] | None,
    *,
    preset: str,
    subtitle_language: str,
    width: int,
    height: int,
    frame_rate: float,
    preview: bool,
    audio_identity: dict[str, Any] | None = None,
) -> str:
    normalized = normalize_clipper_style(style_config)
    payload = {
        "version": RENDER_FINGERPRINT_VERSION,
        "preset": preset,
        "subtitle_language": subtitle_language,
        "width": int(width),
        "height": int(height),
        "frame_rate": float(frame_rate),
        "preview": bool(preview),
        "style": {key: normalized.get(key) for key in RENDER_STYLE_KEYS},
        "audio_identity": audio_identity or {},
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def render_cache_metadata_path(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.name}.render-cache.json")


def read_render_cache_metadata(output_path: Path) -> dict[str, Any] | None:
    metadata_path = render_cache_metadata_path(output_path)
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("fingerprint"), str):
        return None
    return payload


def write_render_cache_metadata(
    output_path: Path,
    *,
    fingerprint: str,
    video_framing: Any,
) -> None:
    metadata_path = render_cache_metadata_path(output_path)
    temporary_path = metadata_path.with_suffix(f"{metadata_path.suffix}.tmp")
    payload = {
        "fingerprint": fingerprint,
        "video_framing": normalize_video_framing(video_framing),
    }
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    temporary_path.replace(metadata_path)
