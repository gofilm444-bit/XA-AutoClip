from app.services.text_styles import (
    TEXT_STYLE_EXPORT_PRESETS,
    ass_color,
    ffmpeg_color,
    normalize_text_style_key,
    resolve_caption_export_style,
    resolve_export_text_style,
    resolve_hook_export_style,
    transform_export_text,
)


def test_all_unified_text_presets_resolve_without_error() -> None:
    expected = {
        "default",
        "white_bold_shadow",
        "yellow_viral",
        "purple_pop",
        "black_white",
        "clean_white",
        "neon_green",
        "red_alert",
        "orange_highlight",
        "blue_creator",
        "pink_glow",
        "gold_premium",
        "minimal_serif",
        "modern_sans",
        "clean_creator", "red_news_bar", "podcast_quote", "documentary", "gaming_neon",
        "luxury_gold", "minimal_black", "white_bubble", "glass_card", "meme_impact",
        "breaking_news", "soft_pastel", "tech_blue", "horror_story", "comedy_pop",
        "elegant_serif", "street_bold", "caption_karaoke", "clean_subtitle_pro",
        "creator_orange", "authority_blue", "warning_alert", "simple_top_label",
    }

    assert set(TEXT_STYLE_EXPORT_PRESETS) == expected
    assert all(resolve_export_text_style(key).key == key for key in expected)
    assert normalize_text_style_key("unknown-style") == "default"


def test_export_text_transform_and_color_conversion() -> None:
    uppercase_style = resolve_export_text_style("yellow_viral")
    normal_style = resolve_export_text_style("clean_white")

    assert transform_export_text("Kata penting", uppercase_style) == "KATA PENTING"
    assert transform_export_text("Kata penting", normal_style) == "Kata penting"
    assert ass_color("#123456") == "&H00563412"
    assert ffmpeg_color("#123456", 0.75) == "0x123456@0.75"


def test_hook_font_picker_uses_backend_safe_font_fallback() -> None:
    style = resolve_export_text_style("modern_sans", font_override="condensed_news")

    assert style.font_name == "DejaVu Sans Condensed"


def test_hook_template_maps_to_export_style_and_background() -> None:
    neon, neon_source, neon_fallbacks = resolve_hook_export_style(
        {"hook_text_template": "neon_text"}
    )
    news, news_source, _ = resolve_hook_export_style(
        {"hook_text_template": "breaking_news"}
    )

    assert neon.key == "neon_green"
    assert neon.text_color == "#86EFAC"
    assert neon_source == "editor_state.hook_text_template"
    assert neon_fallbacks == ()
    assert news.key == "red_alert"
    assert news.background_color == "#B91C1C"
    assert news.background_opacity == 0.95
    assert news_source == "editor_state.hook_text_template"


def test_explicit_hook_text_style_wins_without_mixing_legacy_style() -> None:
    style, source, _ = resolve_hook_export_style(
        {
            "hook_text_template": "minimal_white",
            "hook_text_style_preset": "gaming_neon",
            "hook_text_font": "modern_rounded",
        }
    )

    assert style.key == "gaming_neon"
    assert style.text_color != "#FFFFFF"
    assert source == "editor_state.hook_text_style_preset"


def test_caption_style_maps_manual_and_shared_preset_fields() -> None:
    manual, manual_fallbacks = resolve_caption_export_style(
        {
            "textPreset": "default",
            "textColor": "#ABCDEF",
            "outlineEnabled": True,
            "shadowEnabled": False,
            "backgroundEnabled": True,
            "backgroundOpacity": 0.7,
            "fontWeight": "normal",
        }
    )
    shared, shared_fallbacks = resolve_caption_export_style(
        {"textPreset": "yellow_viral", "displayMode": "karaoke"}
    )

    assert manual.text_color == "#ABCDEF"
    assert manual.outline_width > 0
    assert manual.shadow_offset == 0
    assert manual.background_opacity == 0.7
    assert manual.bold is False
    assert manual_fallbacks
    assert shared.text_color == "#FDE047"
    assert shared.uppercase is True
    assert (
        "display_mode_karaoke_uses_estimated_uniform_word_timing"
        in shared_fallbacks
    )


def test_rich_font_catalog_resolution() -> None:
    anton = resolve_export_text_style("modern_sans", font_override="anton")
    assert anton.font_name == "Anton"

    bangers = resolve_export_text_style("modern_sans", font_override="'Bangers', cursive")
    assert bangers.font_name == "Bangers"

    pacifico = resolve_export_text_style("modern_sans", font_override="pacifico")
    assert pacifico.font_name == "Pacifico"

    playfair = resolve_export_text_style("modern_sans", font_override="'Playfair Display', serif")
    assert playfair.font_name == "Playfair Display"

    caption_style, fallbacks = resolve_caption_export_style(
        {"textPreset": "default", "font_family": "'Permanent Marker', cursive"}
    )
    assert caption_style.font_name == "Permanent Marker"
    assert any("Permanent Marker" in fb for fb in fallbacks)


def test_caption_style_maps_snake_case_main_caption_style() -> None:
    style, fallbacks = resolve_caption_export_style(
        {
            "preset_id": "viral_yellow_punch",
            "color": "#FACC15",
            "font_family": "'Anton', sans-serif",
            "font_weight": "900",
            "stroke_enabled": True,
            "stroke_color": "#000000",
            "stroke_width": 4.0,
            "shadow_enabled": True,
            "shadow_color": "#000000",
            "shadow_y": 3,
            "background_enabled": True,
            "background_color": "#18181B",
            "background_opacity": 0.85,
            "case_mode": "uppercase",
            "karaoke_enabled": True,
        }
    )

    assert style.font_name == "Anton"
    assert style.text_color == "#FACC15"
    assert style.outline_width == 4.0
    assert style.shadow_offset == 3
    assert style.background_color == "#18181B"
    assert style.background_opacity == 0.85
    assert style.bold is True
    assert style.uppercase is True
    assert any("karaoke" in fb for fb in fallbacks)


def test_caption_style_preserves_engine_v3_template_type() -> None:
    lower_third, lt_fallbacks = resolve_caption_export_style(
        {
            "template_type": "lower_third",
            "color": "#FFFFFF",
            "background_enabled": True,
            "background_color": "#1E3A8A",
            "background_opacity": 0.95,
        }
    )
    assert lower_third.background_color == "#1E3A8A"
    assert "template_layout_lower_third" in lt_fallbacks

    typewriter, tw_fallbacks = resolve_caption_export_style(
        {
            "template_type": "typewriter",
            "color": "#38BDF8",
        }
    )
    assert typewriter.text_color == "#38BDF8"
    assert any("animation_typewriter" in fb for fb in tw_fallbacks)

