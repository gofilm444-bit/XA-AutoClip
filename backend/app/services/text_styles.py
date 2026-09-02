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


# V6 Caption Template Export Presets (42 Templates)
CAPTION_TEMPLATE_EXPORT_PRESETS: dict[str, ExportTextStyle] = {
    # 1. Viral Bold Captions
    "viral_yellow_punch": ExportTextStyle("viral_yellow_punch", "Anton", "#FDE047", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_cyan_pulse": ExportTextStyle("viral_cyan_pulse", "Anton", "#06B6D4", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_green_growth": ExportTextStyle("viral_green_growth", "Anton", "#4ADE80", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_pink_punch": ExportTextStyle("viral_pink_punch", "Anton", "#F43F5E", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_orange_flame": ExportTextStyle("viral_orange_flame", "Anton", "#FB923C", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_lime_bold": ExportTextStyle("viral_lime_bold", "Anton", "#A3E635", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_purple_energy": ExportTextStyle("viral_purple_energy", "Anton", "#C084FC", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "viral_white_clean": ExportTextStyle("viral_white_clean", "Anton", "#FFFFFF", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),

    # 2. Meme Captions
    "meme_white_stroke": ExportTextStyle("meme_white_stroke", "Bangers", "#FFFFFF", "#000000", 2.5, "#000000", 4, None, 0.0, True, True),
    "meme_yellow_bottom": ExportTextStyle("meme_yellow_bottom", "Bangers", "#FACC15", "#000000", 2.5, "#000000", 4, None, 0.0, True, True),
    "meme_red_impact": ExportTextStyle("meme_red_impact", "Bangers", "#EF4444", "#000000", 2.5, "#000000", 4, None, 0.0, True, True),
    "meme_green_rage": ExportTextStyle("meme_green_rage", "Bangers", "#22C55E", "#000000", 2.5, "#000000", 4, None, 0.0, True, True),

    # 3. Bubble Captions
    "white_rounded_bubble": ExportTextStyle("white_rounded_bubble", "DejaVu Sans", "#000000", "#FFFFFF", 0.0, None, 0, "#FFFFFF", 0.95, True, False),
    "dark_glass_bubble": ExportTextStyle("dark_glass_bubble", "DejaVu Sans", "#FFFFFF", "#18181B", 0.0, None, 0, "#18181B", 0.85, True, False),
    "cyan_bubble": ExportTextStyle("cyan_bubble", "DejaVu Sans", "#082F49", "#38BDF8", 0.0, None, 0, "#38BDF8", 0.95, True, False),
    "amber_glow_bubble": ExportTextStyle("amber_glow_bubble", "DejaVu Sans", "#451A03", "#FBBF24", 0.0, None, 0, "#FBBF24", 0.95, True, False),
    "emerald_bubble": ExportTextStyle("emerald_bubble", "DejaVu Sans", "#FFFFFF", "#059669", 0.0, None, 0, "#059669", 0.95, True, False),
    "rose_bubble": ExportTextStyle("rose_bubble", "DejaVu Sans", "#FFFFFF", "#E11D48", 0.0, None, 0, "#E11D48", 0.95, True, False),
    "indigo_bubble": ExportTextStyle("indigo_bubble", "DejaVu Sans", "#FFFFFF", "#4F46E5", 0.0, None, 0, "#4F46E5", 0.95, True, False),

    # 4. News Lower Thirds
    "news_lower_third": ExportTextStyle("news_lower_third", "DejaVu Sans Condensed", "#FFFFFF", "#0F172A", 0.0, None, 0, "#0F172A", 0.95, True, False),
    "breaking_red_bar": ExportTextStyle("breaking_red_bar", "DejaVu Sans Condensed", "#FEF08A", "#7F1D1D", 0.0, None, 0, "#7F1D1D", 0.95, True, True),
    "podcast_speaker_bar": ExportTextStyle("podcast_speaker_bar", "DejaVu Sans Condensed", "#F8FAFC", "#1E293B", 0.0, None, 0, "#1E293B", 0.95, True, False),
    "investigasi_dark_bar": ExportTextStyle("investigasi_dark_bar", "DejaVu Sans Condensed", "#FDE047", "#18181B", 0.0, None, 0, "#18181B", 0.95, True, False),

    # 5. Word Highlights / Keywords
    "keyword_yellow_box": ExportTextStyle("keyword_yellow_box", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 2, None, 0.0, True, False),
    "keyword_cyan_pill": ExportTextStyle("keyword_cyan_pill", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 2, None, 0.0, True, False),
    "keyword_lime_pill": ExportTextStyle("keyword_lime_pill", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 2, None, 0.0, True, False),
    "keyword_orange_pill": ExportTextStyle("keyword_orange_pill", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 2, None, 0.0, True, False),
    "karaoke_yellow_fill": ExportTextStyle("karaoke_yellow_fill", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 2, None, 0.0, True, False),
    "karaoke_cyan_glow": ExportTextStyle("karaoke_cyan_glow", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#000000", 2, None, 0.0, True, False),

    # 6. Documentary & Serif
    "documentary_serif_gold": ExportTextStyle("documentary_serif_gold", "DejaVu Serif", "#FEF3C7", "#292524", 0.35, "#000000", 2, None, 0.0, True, False),
    "documentary_clean_white": ExportTextStyle("documentary_clean_white", "DejaVu Serif", "#FFFFFF", "#1C1917", 0.35, "#000000", 2, None, 0.0, True, False),
    "documentary_historic": ExportTextStyle("documentary_historic", "DejaVu Serif", "#FDE68A", "#451A03", 0.35, "#000000", 2, None, 0.0, True, False),
    "quote_gold_card": ExportTextStyle("quote_gold_card", "DejaVu Serif", "#FFFFFF", "#000000", 0.0, None, 0, "#18181B", 0.85, False, False),
    "education_slate_card": ExportTextStyle("education_slate_card", "DejaVu Sans", "#F1F5F9", "#000000", 0.0, None, 0, "#1E293B", 0.90, True, False),
    "debate_vs_card": ExportTextStyle("debate_vs_card", "DejaVu Sans", "#FFFFFF", "#000000", 0.0, None, 0, "#0F172A", 0.90, True, False),
    "sticker_tilted_yellow": ExportTextStyle("sticker_tilted_yellow", "Anton", "#000000", "#FFFFFF", 2.0, "#000000", 3, "#FACC15", 0.95, True, True),

    # 7. Animated / Effects
    "typewriter_clean": ExportTextStyle("typewriter_clean", "DejaVu Sans", "#E0F2FE", "#000000", 1.0, "#000000", 2, None, 0.0, True, False),
    "glitch_cyber_green": ExportTextStyle("glitch_cyber_green", "DejaVu Sans", "#4ADE80", "#000000", 1.5, "#06B6D4", 3, None, 0.0, True, True),
    "glitch_rgb_split": ExportTextStyle("glitch_rgb_split", "DejaVu Sans", "#FFFFFF", "#000000", 1.5, "#EC4899", 3, None, 0.0, True, True),
    "shake_emphasis": ExportTextStyle("shake_emphasis", "Anton", "#EF4444", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),
    "flash_yellow_pulse": ExportTextStyle("flash_yellow_pulse", "Anton", "#FDE047", "#000000", 2.0, "#000000", 3, None, 0.0, True, True),

    # 8. Clean Subtitles
    "clean_white_sub": ExportTextStyle("clean_white_sub", "DejaVu Sans", "#FFFFFF", "#111827", 0.35, "#000000", 1, None, 0.0, True, False),
    "clean_yellow_sub": ExportTextStyle("clean_yellow_sub", "DejaVu Sans", "#FEF08A", "#111827", 0.35, "#000000", 1, None, 0.0, True, False),
    "clean_black_box": ExportTextStyle("clean_black_box", "DejaVu Sans", "#FFFFFF", "#000000", 0.0, None, 0, "#000000", 0.80, True, False),
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

ALL_EXPORT_PRESETS: dict[str, ExportTextStyle] = {
    **TEXT_STYLE_EXPORT_PRESETS,
    **CAPTION_TEMPLATE_EXPORT_PRESETS,
}

FONT_OVERRIDE_MAP = {
    "bold_sans": "DejaVu Sans",
    "elegant_serif": "DejaVu Serif",
    "modern_rounded": "DejaVu Sans",
    "condensed_news": "DejaVu Sans Condensed",
    "playful": "DejaVu Sans",
    "clean_sans": "DejaVu Sans",
}

RICH_FONT_MAP: dict[str, str] = {
    # Bold / Viral
    "anton": "Anton",
    "bangers": "Bangers",
    "bebas_neue": "Bebas Neue",
    "bowlby_one_sc": "Bowlby One SC",
    "lilita_one": "Lilita One",
    "luckiest_guy": "Luckiest Guy",
    "titan_one": "Titan One",
    "archivo_black": "Archivo Black",
    "black_ops_one": "Black Ops One",
    "passion_one": "Passion One",
    "fugaz_one": "Fugaz One",
    "righteous": "Righteous",
    "shrikhand": "Shrikhand",
    "ultra": "Ultra",
    # Comic / Fun
    "bungee": "Bungee",
    "bungee_shade": "Bungee Shade",
    "bungee_inline": "Bungee Inline",
    "chewy": "Chewy",
    "fredoka": "Fredoka",
    "baloo_2": "Baloo 2",
    "coiny": "Coiny",
    "boogaloo": "Boogaloo",
    "mouse_memoirs": "Mouse Memoirs",
    "rubik_bubbles": "Rubik Bubbles",
    "sniglet": "Sniglet",
    "carter_one": "Carter One",
    # Retro
    "pacifico": "Pacifico",
    "lobster": "Lobster",
    "limelight": "Limelight",
    "monoton": "Monoton",
    "fascinate": "Fascinate",
    "yesteryear": "Yesteryear",
    "rye": "Rye",
    "special_elite": "Special Elite",
    # Handwriting
    "caveat": "Caveat",
    "kalam": "Kalam",
    "patrick_hand": "Patrick Hand",
    "permanent_marker": "Permanent Marker",
    "shadows_into_light": "Shadows Into Light",
    "gloria_hallelujah": "Gloria Hallelujah",
    "indie_flower": "Indie Flower",
    "architects_daughter": "Architects Daughter",
    "satisfy": "Satisfy",
    "kaushan_script": "Kaushan Script",
    # Elegant / Serif
    "playfair_display": "Playfair Display",
    "abril_fatface": "Abril Fatface",
    "dm_serif_display": "DM Serif Display",
    "cormorant_garamond": "Cormorant Garamond",
    "cinzel": "Cinzel",
    "prata": "Prata",
    "bodoni_moda": "Bodoni Moda",
    "yeseva_one": "Yeseva One",
    # Condensed / News
    "oswald": "Oswald",
    "roboto_condensed": "Roboto Condensed",
    "teko": "Teko",
    "saira_condensed": "Saira Condensed",
    "fjalla_one": "Fjalla One",
    "league_gothic": "League Gothic",
    "antonio": "Antonio",
    "big_shoulders_display": "Big Shoulders Display",
    # Modern / Clean
    "inter": "Inter",
    "montserrat": "Montserrat",
    "poppins": "Poppins",
    "plus_jakarta_sans": "Plus Jakarta Sans",
    "outfit": "Outfit",
    "rubik": "Rubik",
    # Legacy aliases
    "bold_sans": "DejaVu Sans",
    "elegant_serif": "DejaVu Serif",
    "modern_rounded": "DejaVu Sans",
    "condensed_news": "DejaVu Sans Condensed",
    "playful": "DejaVu Sans",
    "clean_sans": "DejaVu Sans",
}


def resolve_backend_font_name(font_spec: Any, default_font: str = "DejaVu Sans") -> str:
    if not font_spec:
        return default_font
    raw = str(font_spec).strip()
    if raw in RICH_FONT_MAP:
        return RICH_FONT_MAP[raw]
    
    primary = raw.replace('"', "").replace("'", "").split(",")[0].strip()
    key = primary.lower().replace(" ", "_").replace("-", "_")
    if key in RICH_FONT_MAP:
        return RICH_FONT_MAP[key]
    
    if primary and primary.lower() not in {"sans_serif", "sans-serif", "serif", "cursive", "system_ui", "system-ui"}:
        return primary
    return default_font


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
    if key in ALL_EXPORT_PRESETS:
        return key
    return "default"


def resolve_export_text_style(
    value: Any,
    *,
    font_override: Any = None,
) -> ExportTextStyle:
    key = normalize_text_style_key(value)
    style = ALL_EXPORT_PRESETS.get(key, DEFAULT_TEXT_STYLE)
    override_key = str(font_override or "").strip()
    if not override_key:
        return style
    font_name = resolve_backend_font_name(override_key, style.font_name)
    fallback_used = (font_name == style.font_name and override_key != style.font_name)
    logger.info(
        "text_style_font_fallback",
        requested_font=override_key,
        resolved_backend_font=font_name,
        text_style_preset=style.key,
        fallback_used=fallback_used,
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
    """Map the frontend caption style (main_caption_style or caption_style) to the closest safe ASS style."""
    config = caption_style if isinstance(caption_style, dict) else {}
    requested_preset = str(config.get("preset_id") or config.get("textPreset") or "default")
    preset_key = normalize_text_style_key(requested_preset)
    style = resolve_export_text_style(preset_key)
    fallbacks: list[str] = []
    if requested_preset != "default" and requested_preset != preset_key:
        fallbacks.append(f"unknown_text_preset:{requested_preset}->default")

    # Resolve text color
    raw_color = config.get("color") or config.get("textColor")
    if raw_color:
        text_color, invalid_text_color = _safe_hex_color(raw_color, style.text_color)
        if invalid_text_color:
            fallbacks.append("invalid_text_color")
        style = replace(style, text_color=text_color)

    # Resolve stroke / outline
    has_stroke = "stroke_enabled" in config or "outlineEnabled" in config
    if has_stroke:
        stroke_enabled = bool(config.get("stroke_enabled", config.get("outlineEnabled", False)))
        raw_stroke_color = config.get("stroke_color") or config.get("outlineColor") or "#000000"
        stroke_color, _ = _safe_hex_color(raw_stroke_color, "#000000")
        raw_width = config.get("stroke_width", config.get("outlineWidth", 0.75))
        try:
            stroke_width = float(raw_width) if stroke_enabled else 0.0
        except (TypeError, ValueError):
            stroke_width = 0.75 if stroke_enabled else 0.0
        style = replace(
            style,
            outline_color=stroke_color,
            outline_width=min(4.0, max(0.0, stroke_width)),
        )

    # Resolve shadow
    has_shadow = "shadow_enabled" in config or "shadowEnabled" in config
    if has_shadow:
        shadow_enabled = bool(config.get("shadow_enabled", config.get("shadowEnabled", True)))
        raw_shadow_color = config.get("shadow_color") or config.get("shadowColor") or "#000000"
        shadow_color, _ = _safe_hex_color(raw_shadow_color, "#000000")
        raw_offset = config.get("shadow_y", config.get("shadow_offset", 2))
        try:
            shadow_offset = int(raw_offset) if shadow_enabled else 0
        except (TypeError, ValueError):
            shadow_offset = 2 if shadow_enabled else 0
        style = replace(
            style,
            shadow_color=shadow_color if shadow_enabled else None,
            shadow_offset=max(0, min(4, shadow_offset)),
        )

    # Resolve background / bubble
    has_bg = "background_enabled" in config or "backgroundEnabled" in config
    if has_bg:
        background_enabled = bool(config.get("background_enabled", config.get("backgroundEnabled", False)))
        raw_bg_color = config.get("background_color") or config.get("backgroundColor") or "#000000"
        background_color, _ = _safe_hex_color(raw_bg_color, "#000000")
        raw_opacity = config.get("background_opacity", config.get("backgroundOpacity", 0.75))
        try:
            background_opacity = max(0.0, min(1.0, float(raw_opacity)))
        except (TypeError, ValueError):
            background_opacity = 0.75
            fallbacks.append("invalid_background_opacity")
        style = replace(
            style,
            background_color=background_color if background_enabled else None,
            background_opacity=background_opacity if background_enabled else 0.0,
        )

    # Resolve bold / font weight
    raw_weight = config.get("font_weight") or config.get("fontWeight")
    if raw_weight:
        is_bold = str(raw_weight) not in {"normal", "400", "500"}
        style = replace(style, bold=is_bold)

    # Resolve uppercase / case mode
    raw_case = config.get("case_mode") or config.get("caseMode")
    if raw_case == "uppercase" or bool(config.get("uppercase")):
        style = replace(style, uppercase=True)

    # Resolve display mode / karaoke / behavior
    display_mode = str(config.get("displayMode") or ("karaoke" if config.get("karaoke_enabled") else "segment"))
    if display_mode in {"karaoke", "word_by_word"} or config.get("karaoke_enabled"):
        fallbacks.append(
            f"display_mode_{display_mode}_uses_estimated_uniform_word_timing"
        )

    # Resolve template_type & animations
    template_type = str(config.get("template_type") or "basic_subtitle")
    if template_type in {"typewriter", "glitch", "shake", "flash"}:
        fallbacks.append(f"animation_{template_type}_uses_clean_export_fallback")
    elif template_type == "lower_third":
        fallbacks.append("template_layout_lower_third")
    elif template_type == "word_highlight":
        fallbacks.append("template_behavior_word_highlight")

    # Resolve font family
    custom_font = config.get("font_family") or config.get("fontFamily")
    if custom_font:
        resolved_name = resolve_backend_font_name(custom_font, style.font_name)
        style = replace(style, font_name=resolved_name)
        fallbacks.append(f"frontend_font_stack_mapped_to:{resolved_name}")
    else:
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
