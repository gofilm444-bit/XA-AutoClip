import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.services.clipper_style import normalize_clipper_style, normalize_video_framing
from app.services.editor_elements import fingerprint_style_fields

RENDER_FINGERPRINT_VERSION = 4
RENDER_STYLE_KEYS = fingerprint_style_fields()


def build_render_manifest(
    style_config: dict[str, Any] | None,
    *,
    preset: str,
    subtitle_language: str,
    width: int,
    height: int,
    frame_rate: float = 30.0,
    preview: bool = False,
    quality: str = "high",
    audio_identity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized = normalize_clipper_style(style_config)
    main_caption_style = (
        normalized.get("main_caption_style")
        or normalized.get("caption_style")
        or {}
    )
    return {
        "version": RENDER_FINGERPRINT_VERSION,
        "preset": str(preset),
        "subtitle_language": str(subtitle_language),
        "width": int(width),
        "height": int(height),
        "frame_rate": float(frame_rate),
        "preview": bool(preview),
        "quality": str(quality),
        "video_framing": normalize_video_framing(normalized.get("video_framing")),
        "main_caption_style": main_caption_style,
        "video_sequence": normalized.get("video_sequence") or [],
        "audio_sequence": normalized.get("audio_sequence") or [],
        "caption_timeline": normalized.get("caption_timeline") or [],
        "effect_timeline": normalized.get("effect_timeline") or [],
        "additional_audio_tracks": normalized.get("additional_audio_tracks") or [],
        "style": {key: normalized.get(key) for key in RENDER_STYLE_KEYS},
        "audio_identity": audio_identity or {},
    }


def render_manifest_hash(
    style_config: dict[str, Any] | None,
    *,
    preset: str,
    subtitle_language: str,
    width: int,
    height: int,
    frame_rate: float = 30.0,
    preview: bool = False,
    quality: str = "high",
    audio_identity: dict[str, Any] | None = None,
) -> str:
    manifest = build_render_manifest(
        style_config,
        preset=preset,
        subtitle_language=subtitle_language,
        width=width,
        height=height,
        frame_rate=frame_rate,
        preview=preview,
        quality=quality,
        audio_identity=audio_identity,
    )
    encoded = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def render_fingerprint(
    style_config: dict[str, Any] | None,
    *,
    preset: str,
    subtitle_language: str,
    width: int,
    height: int,
    frame_rate: float = 30.0,
    preview: bool = False,
    quality: str = "high",
    audio_identity: dict[str, Any] | None = None,
) -> str:
    return render_manifest_hash(
        style_config,
        preset=preset,
        subtitle_language=subtitle_language,
        width=width,
        height=height,
        frame_rate=frame_rate,
        preview=preview,
        quality=quality,
        audio_identity=audio_identity,
    )


def render_cache_metadata_path(output_path: Path) -> Path:
    return output_path.with_name(f"{output_path.name}.render-cache.json")


def read_render_cache_metadata(output_path: Path) -> dict[str, Any] | None:
    metadata_path = render_cache_metadata_path(output_path)
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    hash_val = payload.get("manifest_hash") or payload.get("fingerprint")
    if not isinstance(hash_val, str):
        return None
    return payload


def write_render_cache_metadata(
    output_path: Path,
    *,
    fingerprint: str | None = None,
    manifest_hash: str | None = None,
    video_framing: Any = None,
    width: int | None = None,
    height: int | None = None,
    template_id: str | None = None,
    template_type: str | None = None,
) -> None:
    resolved_hash = manifest_hash or fingerprint or ""
    metadata_path = render_cache_metadata_path(output_path)
    temporary_path = metadata_path.with_suffix(f"{metadata_path.suffix}.tmp")
    payload = {
        "fingerprint": resolved_hash,
        "manifest_hash": resolved_hash,
        "video_framing": normalize_video_framing(video_framing),
        "width": width,
        "height": height,
        "resolution": f"{width}x{height}" if width and height else None,
        "template_id": template_id,
        "template_type": template_type,
        "created_at": datetime.now(UTC).isoformat(),
    }
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    temporary_path.replace(metadata_path)
