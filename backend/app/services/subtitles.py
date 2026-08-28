from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import structlog

from app.services.text_styles import (
    ass_color,
    resolve_caption_export_style,
    transform_export_text,
)

MAX_SUBTITLE_WORDS = 8
MAX_SUBTITLE_CHARS = 45
ASS_PLAY_RES_X = 1080
CAPTION_SAFE_WIDTH_RATIO = 0.86
BOX_CAPTION_SAFE_WIDTH_RATIO = 0.80
MIN_CAPTION_FONT_SIZE = 24
logger = structlog.get_logger()


class TimedText(Protocol):
    start_seconds: float
    end_seconds: float
    text: str


@dataclass(frozen=True)
class SubtitleWriteReport:
    cues_written: int
    cues_skipped: int
    skip_reasons: dict[str, int]
    style_preset: str
    font_name: str
    text_color: str
    outline: dict[str, Any]
    shadow: dict[str, Any]
    background: dict[str, Any]
    style_fallbacks: tuple[str, ...]
    display_mode: str
    animation_mode: str
    source_cues_written: int


@dataclass(frozen=True)
class WrappedCaption:
    text: str
    lines: tuple[str, ...]
    font_size: int
    max_lines: int
    safe_width: int
    safe_wrap_applied: bool
    extreme_length: bool


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


def _character_width_em(char: str) -> float:
    if char.isspace():
        return 0.32
    if char in "ilIjtfr.,:;!'`|":
        return 0.3
    if char in "mwMW@%&QO":
        return 0.82
    if char.isupper() or char.isdigit():
        return 0.62
    return 0.54


def _estimated_text_width(text: str, font_size: int) -> float:
    return sum(_character_width_em(char) for char in text) * font_size


def _split_word_for_width(word: str, font_size: int, safe_width: int) -> list[str]:
    if _estimated_text_width(word, font_size) <= safe_width:
        return [word]
    chunks: list[str] = []
    current = ""
    for char in word:
        candidate = f"{current}{char}"
        if current and _estimated_text_width(candidate, font_size) > safe_width:
            chunks.append(current)
            current = char
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _wrap_words_for_width(text: str, font_size: int, safe_width: int) -> list[str]:
    words = [
        chunk
        for word in text.split()
        for chunk in _split_word_for_width(word, font_size, safe_width)
    ]
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and _estimated_text_width(candidate, font_size) > safe_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _balanced_fallback_lines(text: str, max_lines: int) -> list[str]:
    words = text.split()
    if not words:
        return []
    if len(words) == 1:
        chunk_size = max(1, (len(words[0]) + max_lines - 1) // max_lines)
        return [
            words[0][index : index + chunk_size]
            for index in range(0, len(words[0]), chunk_size)
        ][:max_lines]
    lines: list[str] = []
    remaining_words = list(words)
    while remaining_words and len(lines) < max_lines:
        remaining_slots = max_lines - len(lines)
        if remaining_slots == 1:
            lines.append(" ".join(remaining_words))
            break
        target_length = max(
            1,
            round(len(" ".join(remaining_words)) / remaining_slots),
        )
        line_words: list[str] = []
        while remaining_words:
            candidate = " ".join([*line_words, remaining_words[0]])
            if line_words and len(candidate) > target_length:
                break
            line_words.append(remaining_words.pop(0))
        lines.append(" ".join(line_words))
    return lines


def _layout_ass_caption(
    text: str,
    base_font_size: int,
    safe_width: int,
) -> WrappedCaption:
    word_count = len(text.split())
    max_lines = 3 if len(text) > 110 or word_count > 18 else 2
    for font_size in range(base_font_size, MIN_CAPTION_FONT_SIZE - 1, -2):
        lines = _wrap_words_for_width(text, font_size, safe_width)
        if len(lines) <= max_lines:
            return WrappedCaption(
                text="\n".join(lines),
                lines=tuple(lines),
                font_size=font_size,
                max_lines=max_lines,
                safe_width=safe_width,
                safe_wrap_applied=len(lines) > 1 or font_size != base_font_size,
                extreme_length=False,
            )

    lines = _balanced_fallback_lines(text, max_lines)
    widest_at_unit_size = max(
        (_estimated_text_width(line, 1) for line in lines),
        default=1.0,
    )
    emergency_font_size = max(10, min(base_font_size, int(safe_width / widest_at_unit_size)))
    return WrappedCaption(
        text="\n".join(lines),
        lines=tuple(lines),
        font_size=emergency_font_size,
        max_lines=max_lines,
        safe_width=safe_width,
        safe_wrap_applied=True,
        extreme_length=True,
    )


def _wrap_ass_caption(
    text: str,
    base_font_size: int = 64,
    safe_width: int = round(ASS_PLAY_RES_X * CAPTION_SAFE_WIDTH_RATIO),
) -> str:
    return _layout_ass_caption(text, base_font_size, safe_width).text


def _cue_font_size(
    base_font_size: int,
    text: str,
    safe_width: int = round(ASS_PLAY_RES_X * CAPTION_SAFE_WIDTH_RATIO),
) -> int:
    return _layout_ass_caption(text, base_font_size, safe_width).font_size


def _inline_ass_color(hex_color: str) -> str:
    color = ass_color(hex_color)
    return f"&H{color[4:10]}&"


def _safe_caption_color(value: Any, fallback: str) -> str:
    text = str(value or "")
    if len(text) == 7 and text.startswith("#"):
        try:
            int(text[1:], 16)
        except ValueError:
            pass
        else:
            return text.upper()
    return fallback


def _highlight_wrapped_word(
    lines: tuple[str, ...],
    active_index: int,
    base_color: str,
    highlight_color: str,
) -> str:
    word_index = 0
    rendered_lines: list[str] = []
    base_tag = f"{{\\c{_inline_ass_color(base_color)}}}"
    highlight_tag = f"{{\\c{_inline_ass_color(highlight_color)}}}"
    for line in lines:
        rendered_words: list[str] = []
        for word in line.split():
            safe_word = _ass_text(word)
            if word_index == active_index:
                rendered_words.append(f"{highlight_tag}{safe_word}{base_tag}")
            else:
                rendered_words.append(safe_word)
            word_index += 1
        rendered_lines.append(" ".join(rendered_words))
    return r"\N".join(rendered_lines)


def _ass_event(
    start: float,
    end: float,
    text: str,
    font_size: int,
    base_font_size: int,
    *,
    text_is_ass: bool = False,
) -> str:
    size_override = f"{{\\fs{font_size}}}" if font_size != base_font_size else ""
    event_text = text if text_is_ass else _ass_text(text)
    return (
        f"Dialogue: 0,{ass_timestamp(start)},{ass_timestamp(end)},"
        f"Default,,0,0,0,,{size_override}{event_text}"
    )


def _normalize_non_overlapping_cues(
    cues: list[tuple[float, float, str]],
) -> tuple[list[tuple[float, float, str]], dict[str, int]]:
    valid: list[list[Any]] = []
    skip_reasons: dict[str, int] = {}
    for start, end, cue in sorted(cues, key=lambda item: (item[0], item[1])):
        cleaned = _clean_subtitle_text(str(cue or ""))
        reason = None
        if end <= start:
            reason = "invalid_timing"
        elif not cleaned:
            reason = "empty_text"
        if reason:
            skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
            logger.warning(
                "subtitle_cue_skipped",
                reason=reason,
                start=start,
                end=end,
                text_length=len(cleaned),
            )
            continue
        if valid and start < float(valid[-1][1]):
            previous_start = float(valid[-1][0])
            previous_end = float(valid[-1][1])
            valid[-1][1] = start
            logger.warning(
                "caption_overlap_trimmed",
                previous_start=previous_start,
                previous_end=previous_end,
                trimmed_end=start,
                next_start=start,
            )
            if float(valid[-1][1]) <= previous_start:
                valid.pop()
                reason = "overlapped_by_later_cue"
                skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
        valid.append([float(start), float(end), cleaned])
    return [tuple(item) for item in valid], skip_reasons


def write_ass_cues(
    path: Path,
    cues: list[tuple[float, float, str]],
    caption_style: dict[str, Any] | None = None,
) -> SubtitleWriteReport:
    config = caption_style if isinstance(caption_style, dict) else {}
    style, style_fallbacks = resolve_caption_export_style(config)
    font_size = {"small": 54, "medium": 64, "large": 74}.get(
        str(config.get("fontSize")),
        64,
    )
    position = str(config.get("position") or "center_lower")
    alignment = {"top": 8, "center": 5}.get(position, 2)
    margin_v = {
        "top": 150,
        "center": 0,
        "center_lower": 300,
        "bottom": 180,
    }.get(position, 300)
    background_alpha = round((1.0 - style.background_opacity) * 255)
    back_color = ass_color(
        style.background_color or "#000000",
        background_alpha if style.background_color else 128,
    )
    border_style = 3 if style.background_color else 1
    outline = round(max(0.0, min(4.0, style.outline_width * 3)), 2)
    shadow = max(0, min(4, style.shadow_offset))
    safe_width_ratio = (
        BOX_CAPTION_SAFE_WIDTH_RATIO
        if style.background_color
        else CAPTION_SAFE_WIDTH_RATIO
    )
    safe_width = round(ASS_PLAY_RES_X * safe_width_ratio)
    horizontal_margin = round((ASS_PLAY_RES_X - safe_width) / 2)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Alignment,MarginL,MarginR,MarginV,BorderStyle,Outline,Shadow
Style: Default,{style.font_name},{font_size},{ass_color(style.text_color)},{ass_color(style.outline_color)},{back_color},{-1 if style.bold else 0},{alignment},{horizontal_margin},{horizontal_margin},{margin_v},{border_style},{outline:.1f},{shadow}

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    requested_display_mode = str(config.get("displayMode") or "segment")
    display_mode = (
        requested_display_mode
        if requested_display_mode in {"segment", "karaoke", "word_by_word"}
        else "segment"
    )
    highlight_color = _safe_caption_color(config.get("highlightColor"), "#FFD400")
    prepared_cues, skip_reasons = _normalize_non_overlapping_cues(cues)
    events: list[str] = []
    animation_modes: set[str] = set()
    for start, end, cleaned in prepared_cues:
        styled_text = transform_export_text(cleaned, style)
        words = styled_text.split()
        wrapped = _layout_ass_caption(styled_text, font_size, safe_width)
        duration = end - start
        can_animate = duration >= 0.35 and len(words) > 1
        event_count_before = len(events)
        estimated_word_duration: float | None = None

        if display_mode == "karaoke" and can_animate:
            estimated_word_duration = duration / len(words)
            for index in range(len(words)):
                event_start = start + (index * estimated_word_duration)
                event_end = (
                    end
                    if index == len(words) - 1
                    else start + ((index + 1) * estimated_word_duration)
                )
                events.append(
                    _ass_event(
                        event_start,
                        event_end,
                        _highlight_wrapped_word(
                            wrapped.lines,
                            index,
                            style.text_color,
                            highlight_color,
                        ),
                        wrapped.font_size,
                        font_size,
                        text_is_ass=True,
                    )
                )
            cue_animation_mode = "micro_cues"
        elif display_mode == "word_by_word" and can_animate:
            estimated_word_duration = duration / len(words)
            for index in range(len(words)):
                event_start = start + (index * estimated_word_duration)
                event_end = (
                    end
                    if index == len(words) - 1
                    else start + ((index + 1) * estimated_word_duration)
                )
                progressive_layout = _layout_ass_caption(
                    " ".join(words[: index + 1]),
                    wrapped.font_size,
                    safe_width,
                )
                events.append(
                    _ass_event(
                        event_start,
                        event_end,
                        progressive_layout.text,
                        progressive_layout.font_size,
                        font_size,
                    )
                )
            cue_animation_mode = "micro_cues"
        else:
            events.append(
                _ass_event(
                    start,
                    end,
                    wrapped.text,
                    wrapped.font_size,
                    font_size,
                )
            )
            cue_animation_mode = (
                "segment_static" if display_mode == "segment" else "static_fallback"
            )

        animation_modes.add(cue_animation_mode)
        logger.info(
            "caption_animation_export",
            caption_display_mode=display_mode,
            karaoke_export_mode=(
                cue_animation_mode if display_mode == "karaoke" else None
            ),
            word_by_word_export_mode=(
                cue_animation_mode if display_mode == "word_by_word" else None
            ),
            word_count=len(words),
            estimated_word_duration=(
                round(estimated_word_duration, 3)
                if estimated_word_duration is not None
                else None
            ),
            source_start=round(start, 3),
            source_end=round(end, 3),
            generated_event_count=len(events) - event_count_before,
        )
        wrap_log = logger.warning if wrapped.extreme_length else logger.info
        wrap_log(
            "caption_safe_wrap",
            original_text_length=len(cleaned),
            original_word_count=len(cleaned.split()),
            wrapped_line_count=len(wrapped.lines),
            wrapped_text_preview=wrapped.text[:160],
            selected_font_size=wrapped.font_size,
            max_lines=wrapped.max_lines,
            safe_width=wrapped.safe_width,
            safe_width_ratio=safe_width_ratio,
            caption_safe_wrap_applied=wrapped.safe_wrap_applied,
            extreme_length=wrapped.extreme_length,
            skipped_reason=None,
        )
    animation_mode = (
        "mixed"
        if len(animation_modes) > 1
        else next(iter(animation_modes), "segment_static")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    logger.info(
        "caption_text_style_export_applied",
        preset=style.key,
        font_name=style.font_name,
        cue_count=len(events),
        position=position,
        font_size=font_size,
        caption_text_color=style.text_color,
        caption_outline={"color": style.outline_color, "width": outline},
        caption_shadow={"color": style.shadow_color, "offset": shadow},
        caption_background={
            "color": style.background_color,
            "opacity": style.background_opacity,
        },
        caption_style_fallbacks=list(style_fallbacks),
        caption_display_mode=display_mode,
        caption_animation_mode=animation_mode,
        source_caption_cues_written=len(prepared_cues),
        subtitle_cues_written=len(events),
        subtitle_cues_skipped=sum(skip_reasons.values()),
        subtitle_skip_reasons=skip_reasons,
    )
    return SubtitleWriteReport(
        cues_written=len(events),
        cues_skipped=sum(skip_reasons.values()),
        skip_reasons=skip_reasons,
        style_preset=style.key,
        font_name=style.font_name,
        text_color=style.text_color,
        outline={"color": style.outline_color, "width": outline},
        shadow={"color": style.shadow_color, "offset": shadow},
        background={
            "color": style.background_color,
            "opacity": style.background_opacity,
        },
        style_fallbacks=style_fallbacks,
        display_mode=display_mode,
        animation_mode=animation_mode,
        source_cues_written=len(prepared_cues),
    )


def write_ass(path: Path, text: str, duration: float) -> None:
    write_ass_cues(path, split_cues(text, duration))
