from dataclasses import dataclass, replace
from typing import Any

import structlog

logger = structlog.get_logger()


@dataclass(frozen=True)
class ExportTextStyle:
    key: str
    font_name: str
    text_color: str
    outline_color: str
    outline_width: float
    shadow_color: str | None
    shadow_offset: int
    background_color: str | None
    background_opacity: float
    bold: bool
    uppercase: bool


DEFAULT_TEXT_STYLE = ExportTextStyle(
    key="default",
    font_name="DejaVu Sans",
    text_color="#FFFFFF",
    outline_color="#111827",
    outline_width=0.5,
    shadow_color="#000000",
    shadow_offset=2,
    background_color=None,
    background_opacity=0.0,
    bold=True,
    uppercase=False,
)


TEXT_STYLE_EXPORT_PRESETS: dict[str, ExportTextStyle] = {
    "default": DEFAULT_TEXT_STYLE,
    "white_bold_shadow": ExportTextStyle(
        "white_bold_shadow", "DejaVu Sans", "#FFFFFF", "#111827", 0.6,
        "#000000", 2, None, 0.0, True, False,
    ),
    "yellow_viral": ExportTextStyle(
        "yellow_viral", "DejaVu Sans", "#FDE047", "#111827", 0.7,
        "#000000", 2, None, 0.0, True, True,
    ),
    "purple_pop": ExportTextStyle(
        "purple_pop", "DejaVu Sans", "#E9D5FF", "#581C87", 0.7,
        "#C084FC", 1, None, 0.0, True, False,
    ),
    "black_white": ExportTextStyle(
        "black_white", "DejaVu Sans", "#FFFFFF", "#000000", 1.1,
        None, 0, None, 0.0, True, True,
    ),
    "clean_white": ExportTextStyle(
        "clean_white", "DejaVu Sans", "#FFFFFF", "#111827", 0.35,
        "#000000", 1, None, 0.0, True, False,
    ),
    "neon_green": ExportTextStyle(
        "neon_green", "DejaVu Sans", "#86EFAC", "#052E16", 0.45,
        "#4ADE80", 1, None, 0.0, True, False,
    ),
    "red_alert": ExportTextStyle(
        "red_alert", "DejaVu Sans Condensed", "#FFFFFF", "#7F1D1D", 0.55,
        "#000000", 2, "#B91C1C", 0.82, True, True,
    ),
    "orange_highlight": ExportTextStyle(
        "orange_highlight", "DejaVu Sans", "#431407", "#431407", 0,
        None, 0, "#FB923C", 0.9, True, False,
    ),
    "blue_creator": ExportTextStyle(
        "blue_creator", "DejaVu Sans", "#BFDBFE", "#172554", 0.55,
        "#60A5FA", 1, None, 0.0, True, False,
    ),
    "pink_glow": ExportTextStyle(
        "pink_glow", "DejaVu Sans", "#FBCFE8", "#831843", 0.4,
        "#F472B6", 1, None, 0.0, True, False,
    ),
    "gold_premium": ExportTextStyle(
        "gold_premium", "DejaVu Serif", "#FDE68A", "#451A03", 0.45,
        "#000000", 2, None, 0.0, True, True,
    ),
    "minimal_serif": ExportTextStyle(
        "minimal_serif", "DejaVu Serif", "#FFFFFF", "#000000", 0,
        "#000000", 1, None, 0.0, False, False,
    ),
    "modern_sans": ExportTextStyle(
        "modern_sans", "DejaVu Sans", "#F8FAFC", "#0F172A", 0.3,
        "#000000", 2, None, 0.0, True, False,
    ),
}

TEXT_STYLE_EXPORT_PRESETS.update({
    "clean_creator": ExportTextStyle("clean_creator", "DejaVu Sans", "#FFFFFF", "#0F172A", 0.4, "#000000", 3, None, 0.0, True, False),
    "red_news_bar": ExportTextStyle("red_news_bar", "DejaVu Sans Condensed", "#FFFFFF", "#7F1D1D", 0.5, "#000000", 2, "#B91C1C", 0.9, True, True),
    "podcast_quote": ExportTextStyle("podcast_quote", "DejaVu Serif", "#F8FAFC", "#0F172A", 0.2, "#000000", 2, None, 0.0, False, False),
    "documentary": ExportTextStyle("documentary", "DejaVu Sans Condensed", "#FEF3C7", "#292524", 0.35, "#000000", 2, None, 0.0, True, True),
    "gaming_neon": ExportTextStyle("gaming_neon", "DejaVu Sans", "#A3E635", "#14532D", 1.0, "#A3E635", 3, None, 0.0, True, True),
    "luxury_gold": ExportTextStyle("luxury_gold", "DejaVu Serif", "#FDE68A", "#78350F", 0.3, "#000000", 3, None, 0.0, True, False),
    "minimal_black": ExportTextStyle("minimal_black", "DejaVu Sans", "#111827", "#111827", 0.0, None, 0, "#FFFFFF", 0.92, True, False),
    "white_bubble": ExportTextStyle("white_bubble", "DejaVu Sans", "#111827", "#FFFFFF", 0.2, None, 0, "#FFFFFF", 0.94, True, False),
    "glass_card": ExportTextStyle("glass_card", "DejaVu Sans", "#FFFFFF", "#CBD5E1", 0.2, "#000000", 2, "#0F172A", 0.68, True, False),
    "meme_impact": ExportTextStyle("meme_impact", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 3, None, 0.0, True, True),
    "breaking_news": ExportTextStyle("breaking_news", "DejaVu Sans Condensed", "#FDE047", "#7F1D1D", 1.0, "#000000", 2, "#7F1D1D", 0.92, True, True),
    "soft_pastel": ExportTextStyle("soft_pastel", "DejaVu Sans", "#FCE7F3", "#831843", 0.25, "#000000", 1, "#4C1D95", 0.55, True, False),
    "tech_blue": ExportTextStyle("tech_blue", "DejaVu Sans", "#67E8F9", "#164E63", 0.7, "#22D3EE", 2, None, 0.0, True, False),
    "horror_story": ExportTextStyle("horror_story", "DejaVu Serif", "#FECACA", "#450A0A", 0.8, "#450A0A", 4, None, 0.0, True, False),
    "comedy_pop": ExportTextStyle("comedy_pop", "DejaVu Sans", "#FEF08A", "#7E22CE", 1.2, "#000000", 2, None, 0.0, True, True),
    "elegant_serif": ExportTextStyle("elegant_serif", "DejaVu Serif", "#FFFFFF", "#A16207", 0.25, "#000000", 2, None, 0.0, False, False),
    "street_bold": ExportTextStyle("street_bold", "DejaVu Sans", "#F8FAFC", "#020617", 1.2, "#EA580C", 3, None, 0.0, True, True),
    "caption_karaoke": ExportTextStyle("caption_karaoke", "DejaVu Sans", "#FFFFFF", "#000000", 0.8, "#000000", 2, None, 0.0, True, False),
    "clean_subtitle_pro": ExportTextStyle("clean_subtitle_pro", "DejaVu Sans", "#FFFFFF", "#000000", 0.45, "#000000", 1, None, 0.0, False, False),
    "creator_orange": ExportTextStyle("creator_orange", "DejaVu Sans", "#FFF7ED", "#9A3412", 0.7, "#000000", 2, "#EA580C", 0.86, True, False),
    "authority_blue": ExportTextStyle("authority_blue", "DejaVu Sans Condensed", "#FFFFFF", "#172554", 0.7, "#000000", 2, "#1E40AF", 0.86, True, True),
    "warning_alert": ExportTextStyle("warning_alert", "DejaVu Sans", "#111827", "#111827", 0.0, None, 0, "#FACC15", 0.94, True, True),
    "simple_top_label": ExportTextStyle("simple_top_label", "DejaVu Sans Condensed", "#E2E8F0", "#0F172A", 0.25, "#000000", 1, None, 0.0, False, True),
})

FONT_OVERRIDE_MAP = {
    "bold_sans": "DejaVu Sans",
    "elegant_serif": "DejaVu Serif",
    "modern_rounded": "DejaVu Sans",
    "condensed_news": "DejaVu Sans Condensed",
    "playful": "DejaVu Sans",
    "clean_sans": "DejaVu Sans",
}

HOOK_TEMPLATE_EXPORT_PRESETS = {
    "capcut_clean": "modern_sans",
    "neon_text": "neon_green",
    "soft_gradient_text": "purple_pop",
    "minimal_white": "clean_white",
    "yellow_viral": "yellow_viral",
    "elegant_modern": "minimal_serif",
    "headline_bold": "black_white",
    "glass_card": "white_bold_shadow",
    "breaking_news": "red_alert",
    "clean_top": "clean_white",
    "highlight_box": "orange_highlight",
}

HOOK_TEMPLATE_BACKGROUNDS: dict[str, tuple[str, float]] = {
    "headline_bold": ("#000000", 0.25),
    "glass_card": ("#FFFFFF", 0.15),
    "breaking_news": ("#B91C1C", 0.95),
    "clean_top": ("#000000", 0.40),
    "highlight_box": ("#FDE047", 0.95),
}


def normalize_text_style_key(value: Any) -> str:
    key = str(value or "default")
    return key if key in TEXT_STYLE_EXPORT_PRESETS else "default"


def resolve_export_text_style(
    value: Any,
    *,
    font_override: Any = None,
) -> ExportTextStyle:
    style = TEXT_STYLE_EXPORT_PRESETS[normalize_text_style_key(value)]
    override_key = str(font_override or "")
    if not override_key:
        return style
    font_name = FONT_OVERRIDE_MAP.get(override_key, style.font_name)
    logger.info(
        "text_style_font_fallback",
        requested_font=override_key,
        resolved_backend_font=font_name,
        text_style_preset=style.key,
        fallback_used=True,
    )
    return ExportTextStyle(
        **{**style.__dict__, "font_name": font_name},
    )


def _safe_hex_color(value: Any, fallback: str) -> tuple[str, bool]:
    text = str(value or "")
    if len(text) == 7 and text.startswith("#"):
        try:
            int(text[1:], 16)
        except ValueError:
            pass
        else:
            return text.upper(), False
    return fallback, bool(value)


def resolve_hook_export_style(
    style_config: dict[str, Any] | None,
) -> tuple[ExportTextStyle, str, tuple[str, ...]]:
    config = style_config if isinstance(style_config, dict) else {}
    template = str(config.get("hook_text_template") or "capcut_clean")
    requested_preset = config.get("hook_text_style_preset")
    fallbacks: list[str] = []
    if requested_preset:
        preset = normalize_text_style_key(requested_preset)
        source = "editor_state.hook_text_style_preset"
        if str(requested_preset) != preset:
            fallbacks.append(f"unknown_hook_text_style_preset:{requested_preset}")
    elif template in HOOK_TEMPLATE_EXPORT_PRESETS:
        preset = HOOK_TEMPLATE_EXPORT_PRESETS[template]
        source = "editor_state.hook_text_template"
    else:
        preset = "modern_sans"
        source = "default"
        fallbacks.append(f"unknown_hook_text_template:{template}")

    style = resolve_export_text_style(
        preset,
        font_override=config.get("hook_text_font"),
    )
    template_background = HOOK_TEMPLATE_BACKGROUNDS.get(template)
    if template_background:
        style = replace(
            style,
            background_color=template_background[0],
            background_opacity=template_background[1],
        )
    if template == "soft_gradient_text":
        fallbacks.append("hook_gradient_approximated_with_purple_pop")

    text_color, invalid_text_color = _safe_hex_color(
        config.get("hook_text_color"),
        style.text_color,
    )
    if invalid_text_color:
        fallbacks.append("invalid_hook_text_color")
    outline_color, invalid_outline_color = _safe_hex_color(
        config.get("hook_text_outline_color"),
        style.outline_color,
    )
    if invalid_outline_color:
        fallbacks.append("invalid_hook_text_outline_color")
    background_color = style.background_color
    if config.get("hook_text_background_color") is not None:
        background_color, invalid_background_color = _safe_hex_color(
            config.get("hook_text_background_color"),
            style.background_color or "#000000",
        )
        if invalid_background_color:
            fallbacks.append("invalid_hook_text_background_color")
    try:
        outline_width = max(
            0.0,
            min(2.0, float(config.get("hook_text_outline_width", style.outline_width))),
        )
    except (TypeError, ValueError):
        outline_width = style.outline_width
        fallbacks.append("invalid_hook_text_outline_width")
    try:
        background_opacity = max(
            0.0,
            min(
                1.0,
                float(
                    config.get("hook_text_background_opacity", style.background_opacity)
                ),
            ),
        )
    except (TypeError, ValueError):
        background_opacity = style.background_opacity
        fallbacks.append("invalid_hook_text_background_opacity")
    style = replace(
        style,
        text_color=text_color,
        outline_color=outline_color,
        outline_width=outline_width,
        background_color=background_color,
        background_opacity=background_opacity if background_color else 0.0,
        bold=(
            str(config.get("hook_text_font_weight")) not in {"normal", "400", "500"}
            if config.get("hook_text_font_weight") is not None
            else style.bold
        ),
    )
    return style, source, tuple(fallbacks)


def resolve_caption_export_style(
    caption_style: dict[str, Any] | None,
) -> tuple[ExportTextStyle, tuple[str, ...]]:
    """Map the frontend caption style to the closest safe ASS style."""
    config = caption_style if isinstance(caption_style, dict) else {}
    requested_preset = str(config.get("textPreset") or "default")
    preset_key = normalize_text_style_key(requested_preset)
    style = resolve_export_text_style(preset_key)
    fallbacks: list[str] = []
    if requested_preset != preset_key:
        fallbacks.append(f"unknown_text_preset:{requested_preset}->default")

    if preset_key == "default":
        text_color, invalid_text_color = _safe_hex_color(
            config.get("textColor"),
            style.text_color,
        )
        if invalid_text_color:
            fallbacks.append("invalid_text_color")
        outline_enabled = bool(config.get("outlineEnabled", False))
        shadow_enabled = bool(config.get("shadowEnabled", True))
        background_enabled = bool(config.get("backgroundEnabled", False))
        try:
            background_opacity = max(
                0.0,
                min(0.85, float(config.get("backgroundOpacity", 0.55))),
            )
        except (TypeError, ValueError):
            background_opacity = 0.55
            fallbacks.append("invalid_background_opacity")
        style = replace(
            style,
            text_color=text_color,
            outline_color="#000000",
            outline_width=0.75 if outline_enabled else 0.0,
            shadow_color="#000000" if shadow_enabled else None,
            shadow_offset=2 if shadow_enabled else 0,
            background_color="#000000" if background_enabled else None,
            background_opacity=background_opacity if background_enabled else 0.0,
            bold=str(config.get("fontWeight") or "semibold") != "normal",
        )
    elif bool(config.get("backgroundEnabled")) and not style.background_color:
        try:
            background_opacity = max(
                0.0,
                min(0.85, float(config.get("backgroundOpacity", 0.55))),
            )
        except (TypeError, ValueError):
            background_opacity = 0.55
            fallbacks.append("invalid_background_opacity")
        style = replace(
            style,
            background_color="#000000",
            background_opacity=background_opacity,
        )

    display_mode = str(config.get("displayMode") or "segment")
    if display_mode in {"karaoke", "word_by_word"}:
        fallbacks.append(
            f"display_mode_{display_mode}_uses_estimated_uniform_word_timing"
        )
    fallbacks.append(f"frontend_font_stack_mapped_to:{style.font_name}")
    return style, tuple(fallbacks)


def transform_export_text(text: str, style: ExportTextStyle) -> str:
    return text.upper() if style.uppercase else text


def ass_color(hex_color: str, alpha: int = 0) -> str:
    value = hex_color.lstrip("#")
    if len(value) != 6:
        value = "FFFFFF"
    red, green, blue = value[0:2], value[2:4], value[4:6]
    return f"&H{max(0, min(255, alpha)):02X}{blue}{green}{red}"


def ffmpeg_color(hex_color: str, opacity: float | None = None) -> str:
    color = f"0x{hex_color.lstrip('#')}"
    if opacity is None:
        return color
    return f"{color}@{max(0.0, min(1.0, opacity)):.2f}"
