import math
import re
import unicodedata
from typing import Any

import structlog

logger = structlog.get_logger()

ClipperStylePreset = str

MAX_HOOK_CHARS = 70
MAX_HOOK_WORDS = 10
MAX_KEYWORDS = 3
VALID_EFFECT_TYPES = {"hook_text", "punch_zoom", "keyword_popup", "pattern_interrupt"}

DEFAULT_AUDIO_SETTINGS: dict[str, Any] = {
    "volume": 1.0,
    "muted": False,
    "fade_in": 0.0,
    "fade_out": 0.0,
}

DEFAULT_VIDEO_FRAMING: dict[str, float] = {
    "x": 0.0,
    "y": 0.0,
    "scale": 1.0,
}

IMPORTANT_EFFECT_KEYWORDS = (
    "penting",
    "ternyata",
    "masalah",
    "gagal",
    "jangan",
    "akhirnya",
    "bongkar",
    "uang",
    "kritik",
    "program",
    "efisiensi",
    "pendidikan",
    "kesehatan",
    "gratis",
    "sebenarnya",
    "intinya",
    "apbd",
    "anggaran",
)

STOPWORDS = {
    "ada",
    "akan",
    "aku",
    "anda",
    "atau",
    "begitu",
    "belum",
    "bisa",
    "cuma",
    "dalam",
    "dan",
    "dari",
    "dengan",
    "dia",
    "di",
    "ini",
    "itu",
    "iya",
    "jadi",
    "juga",
    "kalau",
    "kami",
    "kamu",
    "kan",
    "karena",
    "ke",
    "kita",
    "lah",
    "lagi",
    "mau",
    "memang",
    "mereka",
    "nggak",
    "pada",
    "punya",
    "sama",
    "saya",
    "sebagai",
    "sebelum",
    "setelah",
    "sudah",
    "tapi",
    "tidak",
    "tuh",
    "untuk",
    "ya",
    "yang",
    "hanya",
    "the",
    "and",
    "for",
    "you",
    "are",
    "this",
    "that",
    "with",
    "from",
}

DEFAULT_STYLE: dict[str, Any] = {
    "clipper_style_preset": "clean_podcast",
    "hook_text": "",
    "hook_text_enabled": False,
    "caption_mode": "short",
    "caption_max_words": 8,
    "caption_max_chars": 45,
    "punch_zoom_enabled": True,
    "pattern_interrupt_enabled": False,
    "keyword_popup_enabled": False,
    "style_intensity": "low",
    "effect_timeline": [],
    "audio_settings": DEFAULT_AUDIO_SETTINGS,
    "media_trim": {"start": 0.0, "end": None},
    "media_split_points": [],
    "media_sequence": [],
    "video_sequence": [],
    "audio_sequence": [],
    "audio_extracted": False,
    "video_track_deleted": False,
    "audio_track_deleted": False,
    "video_framing": DEFAULT_VIDEO_FRAMING,
    "editor_state_version": 0,
    "video_sequence_initialized": False,
    "audio_sequence_initialized": False,
    "caption_timeline_initialized": False,
    "effect_timeline_initialized": False,
    "layer_order": ["caption", "hook", "keyword", "punch", "pattern", "video", "audio"],
    "additional_audio_assets": [],
    "additional_audio_tracks": [],
    "caption_timeline": [],
}

PRESET_DEFAULTS: dict[ClipperStylePreset, dict[str, Any]] = {
    "clean_podcast": DEFAULT_STYLE,
    "viral_shorts": {
        **DEFAULT_STYLE,
        "clipper_style_preset": "viral_shorts",
        "hook_text_enabled": True,
        "punch_zoom_enabled": True,
        "pattern_interrupt_enabled": True,
        "keyword_popup_enabled": True,
        "style_intensity": "medium",
    },
    "story_drama": {
        **DEFAULT_STYLE,
        "clipper_style_preset": "story_drama",
        "hook_text_enabled": True,
        "punch_zoom_enabled": True,
        "pattern_interrupt_enabled": True,
        "keyword_popup_enabled": True,
        "style_intensity": "medium",
    },
    "education_explainer": {
        **DEFAULT_STYLE,
        "clipper_style_preset": "education_explainer",
        "keyword_popup_enabled": True,
        "punch_zoom_enabled": True,
        "style_intensity": "low",
    },
    "meme_comedy": {
        **DEFAULT_STYLE,
        "clipper_style_preset": "meme_comedy",
        "punch_zoom_enabled": True,
        "pattern_interrupt_enabled": True,
        "keyword_popup_enabled": True,
        "style_intensity": "high",
    },
    "custom": {**DEFAULT_STYLE, "clipper_style_preset": "custom"},
}


def normalize_indonesian_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(text or ""))
    without_control = "".join(
        char for char in normalized if not unicodedata.category(char).startswith("C")
    )
    return re.sub(r"\s+", " ", without_control).strip()


def _tokenize_text(text: str) -> list[str]:
    cleaned = normalize_indonesian_text(text).lower()
    tokens: list[str] = []
    current: list[str] = []
    for char in cleaned:
        if char.isalnum():
            current.append(char)
        elif current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return tokens


def sanitize_keyword_text(text: str, max_words: int = 4) -> str:
    words = [
        token.upper()
        for token in _tokenize_text(text)
        if 2 <= len(token) <= 16 and token not in STOPWORDS
    ]
    return " ".join(words[:max_words])


def _meaningful_keyword(text: str) -> bool:
    tokens = [token.lower() for token in _tokenize_text(text)]
    if not tokens or all(token in STOPWORDS for token in tokens):
        return False
    return any(token.isdigit() or len(token) >= 4 for token in tokens)


def default_clipper_style(preset: str = "clean_podcast") -> dict[str, Any]:
    return dict(PRESET_DEFAULTS.get(preset, DEFAULT_STYLE))


def normalize_clipper_style(config: dict | None, hook_fallback: str = "") -> dict[str, Any]:
    preset = (config or {}).get("clipper_style_preset", "clean_podcast")
    normalized = default_clipper_style(str(preset))
    normalized.update(config or {})
    normalized["clipper_style_preset"] = str(normalized["clipper_style_preset"])
    normalized["hook_text"] = safe_hook_text(
        normalize_indonesian_text(str(normalized.get("hook_text") or hook_fallback or ""))
    )
    normalized["hook_text_enabled"] = bool(normalized.get("hook_text_enabled"))
    normalized["caption_mode"] = "short"
    normalized["caption_max_words"] = max(1, min(int(normalized.get("caption_max_words") or 8), 8))
    normalized["caption_max_chars"] = max(10, min(int(normalized.get("caption_max_chars") or 45), 45))
    normalized["punch_zoom_enabled"] = bool(normalized.get("punch_zoom_enabled"))
    normalized["pattern_interrupt_enabled"] = bool(normalized.get("pattern_interrupt_enabled"))
    normalized["keyword_popup_enabled"] = bool(normalized.get("keyword_popup_enabled"))
    if normalized.get("style_intensity") not in {"low", "medium", "high"}:
        normalized["style_intensity"] = "low"
    timeline = normalized.get("effect_timeline")
    normalized["effect_timeline"] = timeline if isinstance(timeline, list) else []
    normalized["audio_settings"] = normalize_audio_settings(normalized.get("audio_settings"))
    normalized["media_trim"] = normalize_media_trim(normalized.get("media_trim"))
    split_points = normalized.get("media_split_points")
    normalized["media_split_points"] = sorted(
        {
            round(float(point), 2)
            for point in (split_points if isinstance(split_points, list) else [])
            if isinstance(point, int | float) and float(point) > 0
        }
    )
    normalized["media_sequence"] = normalize_media_sequence(normalized.get("media_sequence"))
    normalized["video_sequence"] = normalize_media_sequence(normalized.get("video_sequence"))
    normalized["audio_sequence"] = normalize_media_sequence(normalized.get("audio_sequence"))
    normalized["audio_extracted"] = bool(normalized.get("audio_extracted", False))
    normalized["video_track_deleted"] = bool(normalized.get("video_track_deleted", False))
    normalized["audio_track_deleted"] = bool(normalized.get("audio_track_deleted", False))
    normalized["video_framing"] = normalize_video_framing(normalized.get("video_framing"))
    try:
        editor_state_version = int(normalized.get("editor_state_version") or 0)
    except (TypeError, ValueError):
        editor_state_version = 0
    normalized["editor_state_version"] = 1 if editor_state_version >= 1 else 0
    for initialized_key in (
        "video_sequence_initialized",
        "audio_sequence_initialized",
        "caption_timeline_initialized",
        "effect_timeline_initialized",
    ):
        normalized[initialized_key] = bool(normalized.get(initialized_key, False))
    valid_layers = ["caption", "hook", "keyword", "punch", "pattern", "video", "audio"]
    configured_layers = normalized.get("layer_order")
    layer_order: list[str] = []
    if isinstance(configured_layers, list):
        for layer in configured_layers:
            if layer in valid_layers and layer not in layer_order:
                layer_order.append(layer)
    normalized["layer_order"] = layer_order + [
        layer for layer in valid_layers if layer not in layer_order
    ]
    assets = normalized.get("additional_audio_assets")
    tracks = normalized.get("additional_audio_tracks")
    normalized["additional_audio_assets"] = assets if isinstance(assets, list) else []
    normalized["additional_audio_tracks"] = tracks if isinstance(tracks, list) else []
    normalized["caption_timeline"] = normalize_caption_timeline(
        normalized.get("caption_timeline")
    )
    return normalized


def normalize_video_framing(value: Any) -> dict[str, float]:
    framing = value if isinstance(value, dict) else {}

    def finite_float(key: str, fallback: float) -> float:
        try:
            result = float(framing.get(key, fallback))
        except (TypeError, ValueError):
            return fallback
        return result if math.isfinite(result) else fallback

    return {
        "x": max(-40.0, min(40.0, finite_float("x", DEFAULT_VIDEO_FRAMING["x"]))),
        "y": max(-40.0, min(40.0, finite_float("y", DEFAULT_VIDEO_FRAMING["y"]))),
        "scale": max(1.0, min(2.0, finite_float("scale", DEFAULT_VIDEO_FRAMING["scale"]))),
    }


def normalize_audio_settings(value: Any) -> dict[str, Any]:
    settings = value if isinstance(value, dict) else {}
    try:
        volume = float(settings.get("volume", 1.0))
    except (TypeError, ValueError):
        volume = 1.0
    try:
        fade_in = float(settings.get("fade_in", 0.0))
    except (TypeError, ValueError):
        fade_in = 0.0
    try:
        fade_out = float(settings.get("fade_out", 0.0))
    except (TypeError, ValueError):
        fade_out = 0.0
    return {
        "volume": round(max(0.0, min(volume, 2.0)), 2),
        "muted": bool(settings.get("muted", False)),
        "fade_in": round(max(0.0, min(fade_in, 5.0)), 2),
        "fade_out": round(max(0.0, min(fade_out, 5.0)), 2),
    }


def normalize_media_trim(value: Any) -> dict[str, float | None]:
    trim = value if isinstance(value, dict) else {}
    try:
        start = max(0.0, float(trim.get("start", 0.0)))
    except (TypeError, ValueError):
        start = 0.0
    raw_end = trim.get("end")
    try:
        end = max(0.0, float(raw_end)) if raw_end is not None else None
    except (TypeError, ValueError):
        end = None
    return {"start": round(start, 2), "end": round(end, 2) if end is not None else None}


def resolve_media_trim(value: Any, duration_seconds: float) -> tuple[float, float]:
    duration = max(0.1, float(duration_seconds or 0.0))
    trim = normalize_media_trim(value)
    start = min(float(trim["start"] or 0.0), max(0.0, duration - 0.1))
    end = duration if trim["end"] is None else min(float(trim["end"]), duration)
    if end <= start:
        end = min(duration, start + 0.1)
    return round(start, 2), round(end, 2)


def normalize_media_sequence(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(value[:200]):
        if not isinstance(item, dict):
            continue
        try:
            source_start = max(0.0, float(item.get("source_start", 0.0)))
            source_end = max(0.0, float(item.get("source_end", 0.0)))
        except (TypeError, ValueError):
            continue
        if source_end - source_start < 0.1:
            continue
        normalized.append(
            {
                "id": str(item.get("id") or f"media-{index}")[:80],
                "source_start": round(source_start, 3),
                "source_end": round(source_end, 3),
            }
        )
    return normalized


def resolve_media_sequence(
    value: Any,
    duration_seconds: float,
    fallback_trim: Any = None,
) -> list[dict[str, Any]]:
    duration = max(0.1, float(duration_seconds or 0.0))
    resolved: list[dict[str, Any]] = []
    for item in normalize_media_sequence(value):
        start = min(float(item["source_start"]), max(0.0, duration - 0.1))
        end = min(float(item["source_end"]), duration)
        if end - start < 0.1:
            continue
        resolved.append({**item, "source_start": round(start, 3), "source_end": round(end, 3)})
    if resolved:
        return resolved
    start, end = resolve_media_trim(fallback_trim, duration)
    return [{"id": "media-0", "source_start": start, "source_end": end}]


def normalize_caption_timeline(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(value[:500]):
        if not isinstance(item, dict):
            continue
        try:
            start = max(0.0, float(item.get("start", 0.0)))
            end = max(0.0, float(item.get("end", 0.0)))
        except (TypeError, ValueError):
            continue
        text = normalize_indonesian_text(str(item.get("text") or ""))[:200].strip()
        if not text or end - start < 0.05:
            continue
        normalized.append(
            {
                "id": str(item.get("id") or f"caption-{index}")[:80],
                "start": round(start, 3),
                "end": round(end, 3),
                "text": text,
            }
        )
    return normalized


def _intensity_zoom(style_config: dict[str, Any]) -> float:
    preset = str(style_config.get("clipper_style_preset") or "clean_podcast")
    intensity = str(style_config.get("style_intensity") or "low")
    if preset == "meme_comedy":
        values = {"low": 1.10, "medium": 1.13, "high": 1.16}
    elif preset in {"viral_shorts", "story_drama"}:
        values = {"low": 1.06, "medium": 1.10, "high": 1.12}
    else:
        values = {"low": 1.04, "medium": 1.06, "high": 1.08}
    return values.get(intensity, values["low"])


def _default_effect_starts(duration: float) -> list[float]:
    starts = [3.0, 12.0, 24.0, 38.0, 52.0]
    if duration <= 0:
        return []
    return [start for start in starts if start < max(0.5, duration - 0.5)]


def validate_effect_timeline(
    events: list[dict[str, Any]] | None,
    duration_seconds: float,
) -> list[dict[str, Any]]:
    duration = max(0.0, float(duration_seconds or 0.0))
    valid: list[dict[str, Any]] = []
    for event in events or []:
        try:
            event_type = str(event.get("type") or "")
            if event_type not in VALID_EFFECT_TYPES:
                raise ValueError("unknown effect type")
            start = max(0.0, float(event.get("start") or 0.0))
            end = min(duration, float(event.get("end") or 0.0))
            if end <= start or start >= duration:
                raise ValueError("invalid timing")
            normalized: dict[str, Any] = {
                "type": event_type,
                "start": round(start, 2),
                "end": round(end, 2),
                "reason": normalize_indonesian_text(str(event.get("reason") or ""))[:80],
            }
            if event.get("id"):
                normalized["id"] = str(event["id"])[:120]
            if event_type == "punch_zoom":
                normalized["zoom"] = max(1.01, min(float(event.get("zoom") or 1.06), 1.18))
            elif event_type == "keyword_popup":
                keyword = sanitize_keyword_text(str(event.get("text") or ""), max_words=4)
                if not keyword or not _meaningful_keyword(keyword):
                    raise ValueError("invalid keyword")
                normalized["text"] = keyword
            elif event_type == "hook_text":
                text = safe_hook_text(str(event.get("text") or ""))
                if not text:
                    raise ValueError("invalid hook text")
                normalized["text"] = text
            elif event_type == "pattern_interrupt":
                normalized["effect"] = normalize_indonesian_text(
                    str(event.get("effect") or "quick_zoom_shift")
                )[:40]
            valid.append(normalized)
        except (TypeError, ValueError) as exc:
            logger.info("effect_timeline_event_skipped", skipped_event=event, error=str(exc))
    return sorted(valid, key=lambda item: (float(item.get("start", 0)), str(item.get("type", ""))))


def _segment_text(segment: Any) -> str:
    if isinstance(segment, dict):
        return str(segment.get("text") or "")
    return str(getattr(segment, "text", "") or "")


def _segment_start(segment: Any, clip_start: float) -> float:
    raw = segment.get("start_seconds", segment.get("start", 0.0)) if isinstance(segment, dict) else getattr(segment, "start_seconds", 0.0)
    return max(0.0, float(raw or 0.0) - clip_start)


def build_effect_timeline(
    style_config: dict[str, Any],
    segments: list[Any],
    clip_start_seconds: float,
    duration_seconds: float,
    transcript_excerpt: str = "",
    title: str = "",
    reason: str = "",
) -> list[dict[str, Any]]:
    normalized = normalize_clipper_style(style_config)
    duration = max(0.0, float(duration_seconds or 0.0))
    zoom = _intensity_zoom(normalized)
    timeline: list[dict[str, Any]] = []
    keyword_moments: list[tuple[float, str]] = []

    for segment in segments:
        text = normalize_indonesian_text(_segment_text(segment))
        lowered = text.lower()
        matched = next((word for word in IMPORTANT_EFFECT_KEYWORDS if word in lowered), "")
        if matched:
            keyword_moments.append((_segment_start(segment, clip_start_seconds), matched))

    if normalized.get("punch_zoom_enabled"):
        starts = [start for start, _ in keyword_moments]
        starts.extend(_default_effect_starts(duration))
        max_events = {"low": 2, "medium": 3, "high": 5}.get(str(normalized.get("style_intensity")), 2)
        seen: set[int] = set()
        for start in starts:
            key = int(start * 10)
            if key in seen or start >= duration:
                continue
            seen.add(key)
            timeline.append(
                {
                    "type": "punch_zoom",
                    "start": round(start, 2),
                    "end": round(min(duration, start + 1.2), 2),
                    "zoom": zoom,
                    "reason": "keyword penting" if any(abs(start - item[0]) < 0.01 for item in keyword_moments) else "interval aman",
                }
            )
            if len([item for item in timeline if item["type"] == "punch_zoom"]) >= max_events:
                break

    selected_keywords = extract_keywords(transcript_excerpt, title, reason)
    if normalized.get("keyword_popup_enabled") and selected_keywords:
        starts = [start for start, _ in keyword_moments] or _default_effect_starts(duration)
        for index, keyword in enumerate(selected_keywords[:3]):
            if index >= len(starts):
                break
            start = starts[index]
            timeline.append(
                {
                    "type": "keyword_popup",
                    "start": round(start, 2),
                    "end": round(min(duration, start + 1.2), 2),
                    "text": keyword,
                    "reason": "keyword transcript",
                }
            )

    validated = validate_effect_timeline(timeline, duration)
    logger.info(
        "effect_timeline_built",
        preset=normalized.get("clipper_style_preset"),
        enabled_effects={
            "punch_zoom": normalized.get("punch_zoom_enabled"),
            "keyword_popup": normalized.get("keyword_popup_enabled"),
            "pattern_interrupt": normalized.get("pattern_interrupt_enabled"),
        },
        raw_keyword_candidates=[word for _, word in keyword_moments],
        filtered_keyword_candidates=selected_keywords,
        effect_timeline=validated,
    )
    return validated


def safe_hook_text(text: str) -> str:
    cleaned = normalize_indonesian_text(text)
    if not cleaned:
        return ""
    first_sentence = re.split(r"(?<=[.!?])\s+", cleaned, maxsplit=1)[0]
    words = first_sentence.split()
    shortened = " ".join(words[:MAX_HOOK_WORDS])
    return shortened[:MAX_HOOK_CHARS].rstrip(" .,;:")


GENERIC_HOOK_FRAGMENTS = {
    "ada satu gagasan penting",
    "bagian ini penting",
    "momen ini penting",
    "ini bagian penting",
    "simak bagian ini",
    "poin ini menjelaskan",
    "konteks soal",
    "isu utamanya",
}


def is_generic_hook(text: str | None) -> bool:
    cleaned = normalize_indonesian_text(text or "").lower()
    if not cleaned:
        return True
    return any(fragment in cleaned for fragment in GENERIC_HOOK_FRAGMENTS)


def _clean_transcript(text: str) -> str:
    cleaned = re.sub(r"\[\d{1,2}:\d{2}(?::\d{2})?\]", " ", normalize_indonesian_text(text or ""))
    return normalize_indonesian_text(cleaned)


def _topic_from_text(*texts: str) -> str:
    keywords = extract_keywords(*texts)
    if not keywords:
        return "isu utamanya"
    return keywords[0].lower()[:24].rstrip()


def _trim_words(text: str, max_words: int = MAX_HOOK_WORDS) -> str:
    words = text.strip(" .,;:").split()
    if len(words) <= max_words:
        return safe_hook_text(text)
    return safe_hook_text(" ".join(words[:max_words]))


def _sentence_candidates(text: str) -> list[str]:
    return [
        sentence.strip(" .,;:")
        for sentence in re.split(r"(?<=[.!?])\s+|[\n\r]+", text)
        if sentence.strip(" .,;:")
    ]


def generate_hook_text_for_clip(
    transcript: str,
    title: str = "",
    rank: int | None = None,
    existing_hook: str = "",
) -> str:
    if existing_hook and not is_generic_hook(existing_hook):
        return safe_hook_text(existing_hook)

    cleaned = _clean_transcript(transcript)
    priority_words = (
        "ternyata",
        "masalah",
        "alasan",
        "penting",
        "gagal",
        "risiko",
        "uang",
        "anggaran",
        "program",
        "keputusan",
        "bongkar",
        "terjadi",
    )
    for sentence in _sentence_candidates(cleaned):
        lowered = sentence.lower()
        words = sentence.split()
        if 6 <= len(words) <= MAX_HOOK_WORDS and len(sentence) <= MAX_HOOK_CHARS:
            if any(word in lowered for word in priority_words):
                return safe_hook_text(sentence)
        if len(words) > MAX_HOOK_WORDS and any(word in lowered for word in priority_words):
            return _trim_words(sentence)

    topic = _topic_from_text(cleaned, title)
    templates = [
        f"Bagian ini membuka inti {topic}.",
        f"Konteks {topic} mulai terlihat di sini.",
        f"Detail {topic} ini sering terlewat.",
        f"Kalimat ini jadi kunci soal {topic}.",
        f"Di sini arah {topic} mulai jelas.",
    ] if topic and topic not in {"isu", "utama", "utamanya"} else [
        "Bagian ini membuka inti masalahnya.",
        "Dia menjelaskan alasan yang sering terlewat.",
        "Di sini konteks sebenarnya mulai terlihat.",
        "Kalimat ini jadi kunci pembahasannya.",
        "Momen ini mengubah arah pembahasan.",
    ]
    return safe_hook_text(templates[((rank or 1) - 1) % len(templates)])


def extract_keywords(*texts: str) -> list[str]:
    counts: dict[str, int] = {}
    phrases: dict[str, int] = {}
    for text in texts:
        tokens = [
            token
            for token in _tokenize_text(text)
            if token not in STOPWORDS and 3 <= len(token) <= 16
        ]
        for word in tokens:
            if len(word) >= 4 or word.isdigit():
                counts[word] = counts.get(word, 0) + 1
        for size in (2, 3, 4):
            for index in range(0, max(0, len(tokens) - size + 1)):
                phrase_tokens = tokens[index : index + size]
                phrase = " ".join(phrase_tokens)
                if any(token.isdigit() for token in phrase_tokens) or any(
                    token in IMPORTANT_EFFECT_KEYWORDS for token in phrase_tokens
                ):
                    phrases[phrase] = phrases.get(phrase, 0) + 2

    ranked = [
        sanitize_keyword_text(phrase, max_words=4)
        for phrase, _ in sorted(phrases.items(), key=lambda item: (-item[1], item[0]))
    ]
    ranked.extend(
        sanitize_keyword_text(word, max_words=1)
        for word, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    )
    unique: list[str] = []
    for keyword in ranked:
        if keyword and keyword not in unique and _meaningful_keyword(keyword):
            unique.append(keyword)
        if len(unique) >= MAX_KEYWORDS:
            break
    logger.info("keyword_candidates_filtered", raw_text_count=len(texts), selected_keywords=unique)
    return unique


def _keyword_text(text: str) -> str:
    return sanitize_keyword_text(text, max_words=2)
