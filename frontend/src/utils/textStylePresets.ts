export type TextStylePresetKey =
  | "default"
  | "white_bold_shadow"
  | "yellow_viral"
  | "purple_pop"
  | "black_white"
  | "clean_white"
  | "neon_green"
  | "red_alert"
  | "orange_highlight"
  | "blue_creator"
  | "pink_glow"
  | "gold_premium"
  | "minimal_serif"
  | "modern_sans"
  | "clean_creator"
  | "red_news_bar"
  | "podcast_quote"
  | "documentary"
  | "gaming_neon"
  | "luxury_gold"
  | "minimal_black"
  | "white_bubble"
  | "glass_card"
  | "meme_impact"
  | "breaking_news"
  | "soft_pastel"
  | "tech_blue"
  | "horror_story"
  | "comedy_pop"
  | "elegant_serif"
  | "street_bold"
  | "caption_karaoke"
  | "clean_subtitle_pro"
  | "creator_orange"
  | "authority_blue"
  | "warning_alert"
  | "simple_top_label";

export type TextFontFamilyKey =
  | "system"
  | "bold_sans"
  | "serif"
  | "rounded"
  | "condensed";

export type TextStylePreset = {
  key: TextStylePresetKey;
  label: string;
  fontFamilyKey: TextFontFamilyKey;
  textColor?: string;
  outlineColor?: string;
  outlineWidth: number;
  shadow?: string;
  backgroundColor?: string;
  weight: 500 | 600 | 700 | 800 | 900;
  transform: "none" | "uppercase";
  category?: "clean" | "viral" | "news" | "elegant" | "gaming" | "meme" | "formal";
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  highlightColor?: string;
  defaultPosition?: "top" | "center" | "bottom";
  defaultSize?: "small" | "medium" | "large";
  exportSupportLevel?: "full" | "partial";
};

export type ResolvedTextOverlayStyle = {
  color?: string;
  fontFamily?: string;
  fontWeight?: number;
  textTransform?: "none" | "uppercase";
  textShadow?: string;
  backgroundColor?: string;
  WebkitTextStroke?: string;
  paintOrder?: "stroke fill";
};

export const TEXT_FONT_STACKS: Record<TextFontFamilyKey, string> = {
  system: '"Segoe UI", Inter, Arial, sans-serif',
  bold_sans: '"Arial Black", Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif',
  condensed: '"Arial Narrow", Impact, "Segoe UI", sans-serif',
};

export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = [
  {
    key: "default",
    label: "Default",
    fontFamilyKey: "system",
    outlineWidth: 0,
    weight: 700,
    transform: "none",
  },
  {
    key: "white_bold_shadow",
    label: "White Bold Shadow",
    fontFamilyKey: "bold_sans",
    textColor: "#ffffff",
    outlineColor: "#111827",
    outlineWidth: 0.6,
    shadow: "0 2px 4px rgba(0,0,0,0.9)",
    weight: 900,
    transform: "none",
  },
  {
    key: "yellow_viral",
    label: "Yellow Viral",
    fontFamilyKey: "bold_sans",
    textColor: "#fde047",
    outlineColor: "#111827",
    outlineWidth: 0.7,
    shadow: "0 2px 3px rgba(0,0,0,0.9)",
    weight: 900,
    transform: "uppercase",
  },
  {
    key: "purple_pop",
    label: "Purple Pop",
    fontFamilyKey: "rounded",
    textColor: "#e9d5ff",
    outlineColor: "#581c87",
    outlineWidth: 0.7,
    shadow: "0 0 5px rgba(192,132,252,0.8)",
    weight: 800,
    transform: "none",
  },
  {
    key: "black_white",
    label: "Black White",
    fontFamilyKey: "bold_sans",
    textColor: "#ffffff",
    outlineColor: "#000000",
    outlineWidth: 1.1,
    weight: 900,
    transform: "uppercase",
  },
  {
    key: "clean_white",
    label: "Clean White",
    fontFamilyKey: "system",
    textColor: "#ffffff",
    outlineColor: "#111827",
    outlineWidth: 0.35,
    shadow: "0 1px 3px rgba(0,0,0,0.8)",
    weight: 700,
    transform: "none",
  },
  {
    key: "neon_green",
    label: "Neon Green",
    fontFamilyKey: "rounded",
    textColor: "#86efac",
    outlineColor: "#052e16",
    outlineWidth: 0.45,
    shadow: "0 0 6px rgba(74,222,128,0.9)",
    weight: 800,
    transform: "none",
  },
  {
    key: "red_alert",
    label: "Red Alert",
    fontFamilyKey: "condensed",
    textColor: "#ffffff",
    outlineColor: "#7f1d1d",
    outlineWidth: 0.55,
    backgroundColor: "rgba(185,28,28,0.82)",
    shadow: "0 2px 3px rgba(0,0,0,0.65)",
    weight: 900,
    transform: "uppercase",
  },
  {
    key: "orange_highlight",
    label: "Orange Highlight",
    fontFamilyKey: "bold_sans",
    textColor: "#431407",
    outlineWidth: 0,
    backgroundColor: "rgba(251,146,60,0.9)",
    weight: 900,
    transform: "none",
  },
  {
    key: "blue_creator",
    label: "Blue Creator",
    fontFamilyKey: "rounded",
    textColor: "#bfdbfe",
    outlineColor: "#172554",
    outlineWidth: 0.55,
    shadow: "0 0 5px rgba(96,165,250,0.75)",
    weight: 800,
    transform: "none",
  },
  {
    key: "pink_glow",
    label: "Pink Glow",
    fontFamilyKey: "rounded",
    textColor: "#fbcfe8",
    outlineColor: "#831843",
    outlineWidth: 0.4,
    shadow: "0 0 6px rgba(244,114,182,0.9)",
    weight: 800,
    transform: "none",
  },
  {
    key: "gold_premium",
    label: "Gold Premium",
    fontFamilyKey: "serif",
    textColor: "#fde68a",
    outlineColor: "#451a03",
    outlineWidth: 0.45,
    shadow: "0 2px 4px rgba(0,0,0,0.85)",
    weight: 700,
    transform: "uppercase",
  },
  {
    key: "minimal_serif",
    label: "Minimal Serif",
    fontFamilyKey: "serif",
    textColor: "#ffffff",
    outlineWidth: 0,
    shadow: "0 1px 3px rgba(0,0,0,0.75)",
    weight: 600,
    transform: "none",
  },
  {
    key: "modern_sans",
    label: "Modern Sans",
    fontFamilyKey: "system",
    textColor: "#f8fafc",
    outlineColor: "#0f172a",
    outlineWidth: 0.3,
    shadow: "0 2px 3px rgba(0,0,0,0.75)",
    weight: 700,
    transform: "none",
  },
  { key: "clean_creator", label: "Clean Creator", fontFamilyKey: "system", textColor: "#FFFFFF", outlineColor: "#0F172A", outlineWidth: 0.4, shadow: "0 3px 8px rgba(0,0,0,.65)", weight: 800, transform: "none", category: "clean" },
  { key: "red_news_bar", label: "Red News Bar", fontFamilyKey: "condensed", textColor: "#FFFFFF", outlineColor: "#7F1D1D", outlineWidth: 0.5, backgroundColor: "rgba(185,28,28,.9)", weight: 900, transform: "uppercase", category: "news" },
  { key: "podcast_quote", label: "Podcast Quote", fontFamilyKey: "serif", textColor: "#F8FAFC", outlineColor: "#0F172A", outlineWidth: 0.2, shadow: "0 2px 4px rgba(0,0,0,.7)", weight: 600, transform: "none", category: "elegant" },
  { key: "documentary", label: "Documentary", fontFamilyKey: "condensed", textColor: "#FEF3C7", outlineColor: "#292524", outlineWidth: 0.35, shadow: "0 2px 3px rgba(0,0,0,.8)", weight: 700, transform: "uppercase", category: "formal", letterSpacing: 1 },
  { key: "gaming_neon", label: "Gaming Neon", fontFamilyKey: "rounded", textColor: "#A3E635", outlineColor: "#14532D", outlineWidth: 1, shadow: "0 0 10px rgba(163,230,53,.95)", weight: 900, transform: "uppercase", category: "gaming" },
  { key: "luxury_gold", label: "Luxury Gold", fontFamilyKey: "serif", textColor: "#FDE68A", outlineColor: "#78350F", outlineWidth: 0.3, shadow: "0 3px 6px rgba(0,0,0,.8)", weight: 700, transform: "none", category: "elegant" },
  { key: "minimal_black", label: "Minimal Black", fontFamilyKey: "system", textColor: "#111827", outlineWidth: 0, backgroundColor: "rgba(255,255,255,.92)", weight: 700, transform: "none", category: "clean" },
  { key: "white_bubble", label: "White Bubble", fontFamilyKey: "rounded", textColor: "#111827", outlineColor: "#FFFFFF", outlineWidth: 0.2, backgroundColor: "rgba(255,255,255,.94)", weight: 800, transform: "none", category: "clean" },
  { key: "glass_card", label: "Glass Card", fontFamilyKey: "system", textColor: "#FFFFFF", outlineColor: "#CBD5E1", outlineWidth: 0.2, backgroundColor: "rgba(15,23,42,.68)", shadow: "0 4px 12px rgba(0,0,0,.45)", weight: 700, transform: "none", category: "clean", exportSupportLevel: "partial" },
  { key: "meme_impact", label: "Meme Impact", fontFamilyKey: "bold_sans", textColor: "#FFFFFF", outlineColor: "#000000", outlineWidth: 1.5, shadow: "0 3px 4px rgba(0,0,0,.8)", weight: 900, transform: "uppercase", category: "meme" },
  { key: "breaking_news", label: "Breaking News", fontFamilyKey: "condensed", textColor: "#FDE047", outlineColor: "#7F1D1D", outlineWidth: 1, backgroundColor: "rgba(127,29,29,.92)", weight: 900, transform: "uppercase", category: "news" },
  { key: "soft_pastel", label: "Soft Pastel", fontFamilyKey: "rounded", textColor: "#FCE7F3", outlineColor: "#831843", outlineWidth: 0.25, backgroundColor: "rgba(76,29,149,.55)", weight: 600, transform: "none", category: "clean" },
  { key: "tech_blue", label: "Tech Blue", fontFamilyKey: "system", textColor: "#67E8F9", outlineColor: "#164E63", outlineWidth: 0.7, shadow: "0 0 7px rgba(34,211,238,.8)", weight: 800, transform: "none", category: "formal" },
  { key: "horror_story", label: "Horror Story", fontFamilyKey: "serif", textColor: "#FECACA", outlineColor: "#450A0A", outlineWidth: 0.8, shadow: "0 4px 9px rgba(69,10,10,.95)", weight: 700, transform: "none", category: "viral" },
  { key: "comedy_pop", label: "Comedy Pop", fontFamilyKey: "rounded", textColor: "#FEF08A", outlineColor: "#7E22CE", outlineWidth: 1.2, shadow: "0 2px 5px rgba(0,0,0,.75)", weight: 900, transform: "uppercase", category: "meme" },
  { key: "elegant_serif", label: "Elegant Serif", fontFamilyKey: "serif", textColor: "#FFFFFF", outlineColor: "#A16207", outlineWidth: 0.25, shadow: "0 2px 4px rgba(0,0,0,.7)", weight: 600, transform: "none", category: "elegant" },
  { key: "street_bold", label: "Street Bold", fontFamilyKey: "bold_sans", textColor: "#F8FAFC", outlineColor: "#020617", outlineWidth: 1.2, shadow: "3px 3px 0 #EA580C", weight: 900, transform: "uppercase", category: "viral", letterSpacing: 0.5 },
  { key: "caption_karaoke", label: "Caption Karaoke", fontFamilyKey: "bold_sans", textColor: "#FFFFFF", outlineColor: "#000000", outlineWidth: 0.8, highlightColor: "#FACC15", shadow: "0 2px 4px rgba(0,0,0,.8)", weight: 900, transform: "none", category: "viral" },
  { key: "clean_subtitle_pro", label: "Clean Subtitle Pro", fontFamilyKey: "system", textColor: "#FFFFFF", outlineColor: "#000000", outlineWidth: 0.45, shadow: "0 1px 3px rgba(0,0,0,.8)", weight: 600, transform: "none", category: "formal" },
  { key: "creator_orange", label: "Creator Orange", fontFamilyKey: "bold_sans", textColor: "#FFF7ED", outlineColor: "#9A3412", outlineWidth: 0.7, backgroundColor: "rgba(234,88,12,.86)", weight: 900, transform: "none", category: "viral" },
  { key: "authority_blue", label: "Authority Blue", fontFamilyKey: "condensed", textColor: "#FFFFFF", outlineColor: "#172554", outlineWidth: 0.7, backgroundColor: "rgba(30,64,175,.86)", weight: 800, transform: "uppercase", category: "formal" },
  { key: "warning_alert", label: "Warning Alert", fontFamilyKey: "bold_sans", textColor: "#111827", outlineWidth: 0, backgroundColor: "rgba(250,204,21,.94)", weight: 900, transform: "uppercase", category: "news" },
  { key: "simple_top_label", label: "Simple Top Label", fontFamilyKey: "condensed", textColor: "#E2E8F0", outlineColor: "#0F172A", outlineWidth: 0.25, shadow: "0 1px 2px rgba(0,0,0,.7)", weight: 600, transform: "uppercase", category: "clean", defaultPosition: "top", defaultSize: "small" },
] as const;

export function normalizeTextStylePreset(value: unknown): TextStylePresetKey {
  return TEXT_STYLE_PRESETS.some((preset) => preset.key === value)
    ? (value as TextStylePresetKey)
    : "default";
}

export function getTextStylePreset(value: unknown): TextStylePreset {
  const key = normalizeTextStylePreset(value);
  return TEXT_STYLE_PRESETS.find((preset) => preset.key === key) || TEXT_STYLE_PRESETS[0];
}

const HOOK_TEMPLATE_TEXT_PRESETS: Record<string, TextStylePresetKey> = {
  capcut_clean: "modern_sans",
  neon_text: "neon_green",
  soft_gradient_text: "purple_pop",
  minimal_white: "clean_white",
  yellow_viral: "yellow_viral",
  elegant_modern: "minimal_serif",
  headline_bold: "black_white",
  glass_card: "white_bold_shadow",
  breaking_news: "red_alert",
  clean_top: "clean_white",
  highlight_box: "orange_highlight",
};

export function resolveHookTextStylePreset(
  template: unknown,
  explicitPreset: unknown,
): TextStylePresetKey {
  if (typeof explicitPreset === "string" && explicitPreset) {
    return normalizeTextStylePreset(explicitPreset);
  }
  return HOOK_TEMPLATE_TEXT_PRESETS[String(template || "")] || "modern_sans";
}

export function resolveTextOverlayStyle(value: unknown): ResolvedTextOverlayStyle {
  const preset = getTextStylePreset(value);
  if (preset.key === "default") return {};
  return {
    color: preset.textColor,
    fontFamily: TEXT_FONT_STACKS[preset.fontFamilyKey],
    fontWeight: preset.weight,
    textTransform: preset.transform,
    textShadow: preset.shadow,
    backgroundColor: preset.backgroundColor,
    WebkitTextStroke:
      preset.outlineWidth > 0 && preset.outlineColor
        ? `${preset.outlineWidth}px ${preset.outlineColor}`
        : undefined,
    paintOrder: preset.outlineWidth > 0 ? "stroke fill" : undefined,
  };
}
