from dataclasses import dataclass

HOOK_HORIZONTAL_MARGIN_RATIO = 0.09
HOOK_MAX_LINES = 2


@dataclass(frozen=True)
class HookSafeArea:
    top_px: int
    font_size_px: int
    line_count: int
    clamped: bool
    lines: tuple[str, ...]
    wrapped_text: str
    safe_width_px: int
    text_width_estimated: int
    wrap_applied: bool
    horizontal_clamped: bool
    truncated: bool
    font_size_clamped_reason: str | None


def _normalize_hook_text(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


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


def estimate_hook_text_width(text: str, font_size_px: int) -> int:
    return round(sum(_character_width_em(char) for char in text) * font_size_px)


def _split_long_word(word: str, font_size_px: int, safe_width_px: int) -> list[str]:
    if estimate_hook_text_width(word, font_size_px) <= safe_width_px:
        return [word]
    chunks: list[str] = []
    current = ""
    for char in word:
        candidate = f"{current}{char}"
        if current and estimate_hook_text_width(candidate, font_size_px) > safe_width_px:
            chunks.append(current)
            current = char
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _wrap_hook_lines(text: str, font_size_px: int, safe_width_px: int) -> list[str]:
    words = [
        chunk
        for word in text.split()
        for chunk in _split_long_word(word, font_size_px, safe_width_px)
    ]
    lines: list[str] = []
    current = ""
    for word in words:
        if not current:
            current = word
            continue
        candidate = f"{current} {word}".strip()
        if current and estimate_hook_text_width(candidate, font_size_px) > safe_width_px:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _truncate_two_lines(
    text: str,
    font_size_px: int,
    safe_width_px: int,
) -> tuple[str, ...]:
    words = [
        chunk
        for word in text.split()
        for chunk in _split_long_word(word, font_size_px, safe_width_px)
    ]
    lines: list[str] = []
    current = ""
    for word in words:
        if not current:
            current = word
            continue
        candidate = f"{current} {word}".strip()
        if estimate_hook_text_width(f"{candidate}...", font_size_px) <= safe_width_px:
            current = candidate
            continue
        if len(lines) < HOOK_MAX_LINES - 1 and current:
            lines.append(current)
            current = word
            continue
        break
    if current and len(lines) < HOOK_MAX_LINES:
        while current and estimate_hook_text_width(
            f"{current}...",
            font_size_px,
        ) > safe_width_px:
            current = current[:-1].rstrip()
        lines.append(f"{current}..." if current else "...")
    return tuple(lines[:HOOK_MAX_LINES])


def resolve_hook_safe_area(
    position: str,
    requested_font_size_px: int,
    text: str,
    frame_width_px: int,
    frame_height_px: int,
) -> HookSafeArea:
    normalized = _normalize_hook_text(text)
    requested_font = max(1, int(requested_font_size_px))
    height_limit = max(26, int(frame_height_px * 0.045))
    initial_font_size = min(requested_font, height_limit)
    min_font_size = max(18, round(frame_width_px * 0.032))
    outer_safe_width = frame_width_px * (1 - 2 * HOOK_HORIZONTAL_MARGIN_RATIO)
    edge_reserve = max(12, round(initial_font_size * 0.45))
    safe_width_px = max(80, round(outer_safe_width - 2 * edge_reserve))

    font_size_px = initial_font_size
    lines = _wrap_hook_lines(normalized, font_size_px, safe_width_px)
    while len(lines) > HOOK_MAX_LINES and font_size_px > min_font_size:
        font_size_px -= 1
        lines = _wrap_hook_lines(normalized, font_size_px, safe_width_px)

    truncated = len(lines) > HOOK_MAX_LINES
    lines_tuple = (
        _truncate_two_lines(normalized, font_size_px, safe_width_px)
        if truncated
        else tuple(lines[:HOOK_MAX_LINES]) or ("",)
    )
    line_count = len(lines_tuple)
    text_width_estimated = max(
        (estimate_hook_text_width(line, font_size_px) for line in lines_tuple),
        default=0,
    )
    wrap_applied = line_count > 1
    horizontal_clamped = font_size_px < initial_font_size or truncated
    reasons: list[str] = []
    if initial_font_size < requested_font:
        reasons.append("frame_height")
    if font_size_px < initial_font_size:
        reasons.append("safe_width")
    if truncated:
        reasons.append("extreme_text_truncated")

    outline_shadow_px = max(8, round(font_size_px * 0.16))
    padding_px = max(12, round(font_size_px * 0.35))
    safe_top_px = max(
        24,
        round(
            frame_height_px
            * (0.035 if position == "safe_top" else 0.07 if position == "top" else 0.13)
        ),
    )
    requested_top_px = (
        safe_top_px
        if position == "safe_top"
        else round(frame_height_px * (0.09 if position == "top" else 0.16))
    )
    line_height_px = round(font_size_px * 1.12)
    max_top_px = max(
        safe_top_px,
        frame_height_px
        - line_count * line_height_px
        - outline_shadow_px
        - padding_px,
    )
    top_px = min(max(safe_top_px, requested_top_px), max_top_px)
    return HookSafeArea(
        top_px=top_px,
        font_size_px=font_size_px,
        line_count=line_count,
        clamped=(
            top_px != requested_top_px
            or font_size_px != requested_font
            or horizontal_clamped
        ),
        lines=lines_tuple,
        wrapped_text="\n".join(lines_tuple),
        safe_width_px=safe_width_px,
        text_width_estimated=text_width_estimated,
        wrap_applied=wrap_applied,
        horizontal_clamped=horizontal_clamped,
        truncated=truncated,
        font_size_clamped_reason="+".join(reasons) or None,
    )
