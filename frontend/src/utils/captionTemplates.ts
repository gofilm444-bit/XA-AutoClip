export type MainCaptionStyle = {
  preset_id: string;
  font_family: string;
  font_size: number;
  font_weight: string;
  italic: boolean;
  underline: boolean;
  case_mode: "none" | "uppercase" | "lowercase" | "title";
  color: string;
  stroke_enabled: boolean;
  stroke_color: string;
  stroke_width: number;
  shadow_enabled: boolean;
  shadow_color: string;
  shadow_blur: number;
  shadow_x: number;
  shadow_y: number;
  background_enabled: boolean;
  background_color: string;
  background_opacity: number;
  background_radius: number;
  position: "bottom" | "middle" | "top";
  position_x_percent?: number;
  position_y_percent?: number;
  align: "center" | "left" | "right";
  max_width_percent: number;
  line_height: number;
  letter_spacing: number;
  word_spacing: number;
  animation_in: string;
  animation_out: string;
  animation_loop: string;
  effect: string;
  karaoke_enabled: boolean;
  karaoke_mode: "none" | "word" | "line" | "highlight";
  karaoke_active_color: string;
  karaoke_inactive_color: string;
  karaoke_highlight_color: string;
  karaoke_bar_enabled: boolean;
};

export type CaptionCueItem = {
  id: string;
  start: number;
  end: number;
  text: string;
  locked?: boolean;
  visible?: boolean;
  type?: "main_caption" | string;
  style_id?: string | null;
  style_override?: Partial<MainCaptionStyle> | null;
};

export type CaptionTemplateCategory =
  | "All"
  | "Trending"
  | "Classic"
  | "Karaoke"
  | "Clean"
  | "News"
  | "Social"
  | "Effects";

export type CaptionTemplate = {
  id: string;
  name: string;
  category: CaptionTemplateCategory;
  badge?: "Karaoke" | "Popular" | "Clean" | "New" | "Viral";
  previewText: string;
  stylePatch: Partial<MainCaptionStyle>;
};

export const DEFAULT_MAIN_CAPTION_STYLE: MainCaptionStyle = {
  preset_id: "clean_white",
  font_family: "Inter, Montserrat, sans-serif",
  font_size: 20,
  font_weight: "800",
  italic: false,
  underline: false,
  case_mode: "none",
  color: "#FFFFFF",
  stroke_enabled: true,
  stroke_color: "#000000",
  stroke_width: 2.5,
  shadow_enabled: true,
  shadow_color: "rgba(0,0,0,0.85)",
  shadow_blur: 4,
  shadow_x: 0,
  shadow_y: 2,
  background_enabled: false,
  background_color: "#000000",
  background_opacity: 0.65,
  background_radius: 6,
  position: "bottom",
  align: "center",
  max_width_percent: 86,
  line_height: 1.25,
  letter_spacing: 0,
  word_spacing: 0,
  animation_in: "none",
  animation_out: "none",
  animation_loop: "none",
  effect: "none",
  karaoke_enabled: false,
  karaoke_mode: "word",
  karaoke_active_color: "#FACC15",
  karaoke_inactive_color: "#FFFFFF",
  karaoke_highlight_color: "#38BDF8",
  karaoke_bar_enabled: false,
};

export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  {
    id: "clean_white",
    name: "Clean White",
    category: "Clean",
    badge: "Clean",
    previewText: "Sub Judul Bersih",
    stylePatch: {
      preset_id: "clean_white",
      color: "#FFFFFF",
      font_family: "Inter, sans-serif",
      font_weight: "700",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 2,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 4,
      background_enabled: false,
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "bold_yellow_stroke",
    name: "Bold Yellow Stroke",
    category: "Trending",
    badge: "Popular",
    previewText: "TEXT VIRAL KUNING",
    stylePatch: {
      preset_id: "bold_yellow_stroke",
      color: "#FACC15",
      font_family: "Montserrat, Impact, sans-serif",
      font_weight: "900",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 6,
      background_enabled: false,
      karaoke_enabled: false,
      case_mode: "uppercase",
    },
  },
  {
    id: "caption_karaoke_classic",
    name: "Caption Karaoke Classic",
    category: "Karaoke",
    badge: "Karaoke",
    previewText: "Karaoke Kata Klasik",
    stylePatch: {
      preset_id: "caption_karaoke_classic",
      color: "#FFFFFF",
      font_family: "Montserrat, Inter, sans-serif",
      font_weight: "800",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 2.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      shadow_blur: 4,
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#FACC15",
      karaoke_inactive_color: "#FFFFFF",
      karaoke_highlight_color: "#FACC15",
      case_mode: "none",
    },
  },
  {
    id: "karaoke_yellow",
    name: "Karaoke Yellow",
    category: "Karaoke",
    badge: "Karaoke",
    previewText: "Highlight Kuning Menyala",
    stylePatch: {
      preset_id: "karaoke_yellow",
      color: "#FFFFFF",
      font_family: "Inter, sans-serif",
      font_weight: "800",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 2.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#FACC15",
      karaoke_inactive_color: "#E2E8F0",
      case_mode: "none",
    },
  },
  {
    id: "karaoke_cyan",
    name: "Karaoke Cyan",
    category: "Karaoke",
    badge: "Karaoke",
    previewText: "Cyber Cyan Active",
    stylePatch: {
      preset_id: "karaoke_cyan",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      stroke_enabled: true,
      stroke_color: "#083344",
      stroke_width: 2.5,
      shadow_enabled: true,
      shadow_color: "rgba(6,182,212,0.6)",
      shadow_blur: 8,
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#22D3EE",
      karaoke_inactive_color: "#94A3B8",
      case_mode: "none",
    },
  },
  {
    id: "podcast_subtitle",
    name: "Podcast Subtitle",
    category: "Clean",
    badge: "Clean",
    previewText: "Subtitle Podcast Gelap",
    stylePatch: {
      preset_id: "podcast_subtitle",
      color: "#F8FAFC",
      font_family: "Inter, sans-serif",
      font_weight: "600",
      stroke_enabled: false,
      stroke_width: 0,
      shadow_enabled: false,
      background_enabled: true,
      background_color: "#000000",
      background_opacity: 0.75,
      background_radius: 8,
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "news_lower_caption",
    name: "News Lower Caption",
    category: "News",
    badge: "Popular",
    previewText: "BERITA UTAMA HARI INI",
    stylePatch: {
      preset_id: "news_lower_caption",
      color: "#FFFFFF",
      font_family: "Oswald, Inter, sans-serif",
      font_weight: "700",
      stroke_enabled: false,
      stroke_width: 0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.5)",
      background_enabled: true,
      background_color: "#1E3A8A",
      background_opacity: 0.9,
      background_radius: 4,
      position: "bottom",
      case_mode: "uppercase",
      letter_spacing: 1,
      karaoke_enabled: false,
    },
  },
  {
    id: "breaking_red",
    name: "Breaking Red",
    category: "News",
    badge: "Viral",
    previewText: "BREAKING: INFORMASI VIRAL",
    stylePatch: {
      preset_id: "breaking_red",
      color: "#FFFFFF",
      font_family: "Impact, Montserrat, sans-serif",
      font_weight: "900",
      stroke_enabled: true,
      stroke_color: "#7F1D1D",
      stroke_width: 1.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      background_enabled: true,
      background_color: "#DC2626",
      background_opacity: 0.95,
      background_radius: 4,
      case_mode: "uppercase",
      letter_spacing: 0.5,
      karaoke_enabled: false,
    },
  },
  {
    id: "tiktok_pop",
    name: "TikTok Pop",
    category: "Social",
    badge: "Viral",
    previewText: "GAYA POP TIKTOK",
    stylePatch: {
      preset_id: "tiktok_pop",
      color: "#FEF08A",
      font_family: "Montserrat, sans-serif",
      font_weight: "900",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 6,
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#FACC15",
      karaoke_inactive_color: "#FFFFFF",
      animation_in: "pop_in",
      effect: "word_pop",
      case_mode: "uppercase",
    },
  },
  {
    id: "minimal_elegant",
    name: "Minimal Elegant",
    category: "Classic",
    badge: "Clean",
    previewText: "Ungkapan Elegan Modern",
    stylePatch: {
      preset_id: "minimal_elegant",
      color: "#FFFFFF",
      font_family: "Georgia, 'Playfair Display', serif",
      font_weight: "600",
      italic: true,
      stroke_enabled: false,
      stroke_width: 0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.7)",
      shadow_blur: 6,
      background_enabled: false,
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "military_green",
    name: "Military Green",
    category: "Classic",
    previewText: "TACTICAL BRIEFING",
    stylePatch: {
      preset_id: "military_green",
      color: "#A3E635",
      font_family: "Oswald, Impact, sans-serif",
      font_weight: "800",
      stroke_enabled: true,
      stroke_color: "#14532D",
      stroke_width: 2.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      background_enabled: false,
      karaoke_enabled: false,
      case_mode: "uppercase",
      letter_spacing: 1,
    },
  },
  {
    id: "documentary",
    name: "Documentary",
    category: "Classic",
    previewText: "Kisah dokumenter bersejarah",
    stylePatch: {
      preset_id: "documentary",
      color: "#F1F5F9",
      font_family: "Inter, sans-serif",
      font_weight: "500",
      stroke_enabled: false,
      stroke_width: 0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 5,
      background_enabled: false,
      letter_spacing: 1.5,
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "quote_bubble",
    name: "Quote Bubble",
    category: "Social",
    badge: "Popular",
    previewText: "Kutipan penting hari ini",
    stylePatch: {
      preset_id: "quote_bubble",
      color: "#FFFFFF",
      font_family: "Inter, sans-serif",
      font_weight: "700",
      stroke_enabled: false,
      shadow_enabled: false,
      background_enabled: true,
      background_color: "#111827",
      background_opacity: 0.85,
      background_radius: 12,
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "big_impact",
    name: "Big Impact",
    category: "Trending",
    badge: "Viral",
    previewText: "DAMPAK SANGAT BESAR",
    stylePatch: {
      preset_id: "big_impact",
      color: "#FEF08A",
      font_family: "Impact, Montserrat, sans-serif",
      font_weight: "900",
      font_size: 24,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 4,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.95)",
      shadow_blur: 6,
      background_enabled: false,
      case_mode: "uppercase",
      letter_spacing: 1,
      karaoke_enabled: false,
    },
  },
  {
    id: "neon_cyan",
    name: "Neon Cyan",
    category: "Effects",
    badge: "New",
    previewText: "Cyber Neon Glow",
    stylePatch: {
      preset_id: "neon_cyan",
      color: "#67E8F9",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      stroke_enabled: true,
      stroke_color: "#083344",
      stroke_width: 1.5,
      shadow_enabled: true,
      shadow_color: "#06B6D4",
      shadow_blur: 14,
      shadow_x: 0,
      shadow_y: 0,
      background_enabled: false,
      effect: "neon",
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "orange_highlight",
    name: "Orange Highlight",
    category: "Trending",
    badge: "Popular",
    previewText: "Sorotan Oranye Hangat",
    stylePatch: {
      preset_id: "orange_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      stroke_enabled: true,
      stroke_color: "#431407",
      stroke_width: 2.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#FB923C",
      karaoke_inactive_color: "#FFFFFF",
      karaoke_highlight_color: "#EA580C",
      case_mode: "none",
    },
  },
  {
    id: "word_highlight_box",
    name: "Word Highlight Box",
    category: "Karaoke",
    badge: "Karaoke",
    previewText: "Kotak Aktif Sorotan",
    stylePatch: {
      preset_id: "word_highlight_box",
      color: "#FFFFFF",
      font_family: "Inter, sans-serif",
      font_weight: "800",
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.75)",
      background_enabled: true,
      background_color: "#18181B",
      background_opacity: 0.7,
      background_radius: 6,
      karaoke_enabled: true,
      karaoke_mode: "highlight",
      karaoke_active_color: "#FFFFFF",
      karaoke_highlight_color: "#0284C7",
      case_mode: "none",
    },
  },
  {
    id: "clean_academic",
    name: "Clean Academic",
    category: "Clean",
    previewText: "Pendidikan & Sains Jelas",
    stylePatch: {
      preset_id: "clean_academic",
      color: "#FFFFFF",
      font_family: "Inter, sans-serif",
      font_weight: "600",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 1.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.6)",
      shadow_blur: 3,
      background_enabled: false,
      karaoke_enabled: false,
      case_mode: "none",
      letter_spacing: 0.5,
    },
  },
  {
    id: "social_reel",
    name: "Social Reel",
    category: "Social",
    badge: "Popular",
    previewText: "Reels & Shorts Viral",
    stylePatch: {
      preset_id: "social_reel",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "900",
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      background_enabled: false,
      position: "bottom",
      line_height: 1.15,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#38BDF8",
      karaoke_inactive_color: "#FFFFFF",
      case_mode: "none",
    },
  },
  {
    id: "dark_box",
    name: "Dark Box",
    category: "Clean",
    previewText: "Latar Kotak Hitam",
    stylePatch: {
      preset_id: "dark_box",
      color: "#FFFFFF",
      font_family: "Inter, sans-serif",
      font_weight: "700",
      stroke_enabled: false,
      shadow_enabled: false,
      background_enabled: true,
      background_color: "#09090B",
      background_opacity: 0.85,
      background_radius: 8,
      karaoke_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "gradient_sunset",
    name: "Sunset Glow",
    category: "Effects",
    badge: "New",
    previewText: "GRADASI SUNSET INDAH",
    stylePatch: {
      preset_id: "gradient_sunset",
      color: "#FED7AA",
      font_family: "Montserrat, sans-serif",
      font_weight: "900",
      stroke_enabled: true,
      stroke_color: "#831843",
      stroke_width: 2.5,
      shadow_enabled: true,
      shadow_color: "#BE185D",
      shadow_blur: 8,
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#F43F5E",
      karaoke_inactive_color: "#FED7AA",
      case_mode: "uppercase",
    },
  },
  {
    id: "cyberpunk_purple",
    name: "Cyberpunk Pop",
    category: "Effects",
    badge: "Viral",
    previewText: "CYBERPUNK VIRAL",
    stylePatch: {
      preset_id: "cyberpunk_purple",
      color: "#E879F9",
      font_family: "Montserrat, sans-serif",
      font_weight: "900",
      stroke_enabled: true,
      stroke_color: "#581C87",
      stroke_width: 3,
      shadow_enabled: true,
      shadow_color: "#A855F7",
      shadow_blur: 10,
      background_enabled: false,
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#F472B6",
      karaoke_inactive_color: "#E879F9",
      case_mode: "uppercase",
    },
  },
];

export function normalizeMainCaptionStyle(raw?: Partial<MainCaptionStyle> | null): MainCaptionStyle {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MAIN_CAPTION_STYLE };
  }
  return {
    preset_id: String(raw.preset_id || DEFAULT_MAIN_CAPTION_STYLE.preset_id),
    font_family: String(raw.font_family || DEFAULT_MAIN_CAPTION_STYLE.font_family),
    font_size: Number.isFinite(raw.font_size) ? Number(raw.font_size) : DEFAULT_MAIN_CAPTION_STYLE.font_size,
    font_weight: String(raw.font_weight || DEFAULT_MAIN_CAPTION_STYLE.font_weight),
    italic: Boolean(raw.italic),
    underline: Boolean(raw.underline),
    case_mode: ["none", "uppercase", "lowercase", "title"].includes(String(raw.case_mode))
      ? (raw.case_mode as MainCaptionStyle["case_mode"])
      : DEFAULT_MAIN_CAPTION_STYLE.case_mode,
    color: String(raw.color || DEFAULT_MAIN_CAPTION_STYLE.color),
    stroke_enabled: Boolean(raw.stroke_enabled),
    stroke_color: String(raw.stroke_color || DEFAULT_MAIN_CAPTION_STYLE.stroke_color),
    stroke_width: Number.isFinite(raw.stroke_width) ? Number(raw.stroke_width) : DEFAULT_MAIN_CAPTION_STYLE.stroke_width,
    shadow_enabled: Boolean(raw.shadow_enabled),
    shadow_color: String(raw.shadow_color || DEFAULT_MAIN_CAPTION_STYLE.shadow_color),
    shadow_blur: Number.isFinite(raw.shadow_blur) ? Number(raw.shadow_blur) : DEFAULT_MAIN_CAPTION_STYLE.shadow_blur,
    shadow_x: Number.isFinite(raw.shadow_x) ? Number(raw.shadow_x) : DEFAULT_MAIN_CAPTION_STYLE.shadow_x,
    shadow_y: Number.isFinite(raw.shadow_y) ? Number(raw.shadow_y) : DEFAULT_MAIN_CAPTION_STYLE.shadow_y,
    background_enabled: Boolean(raw.background_enabled),
    background_color: String(raw.background_color || DEFAULT_MAIN_CAPTION_STYLE.background_color),
    background_opacity: Number.isFinite(raw.background_opacity)
      ? Math.max(0, Math.min(1, Number(raw.background_opacity)))
      : DEFAULT_MAIN_CAPTION_STYLE.background_opacity,
    background_radius: Number.isFinite(raw.background_radius)
      ? Number(raw.background_radius)
      : DEFAULT_MAIN_CAPTION_STYLE.background_radius,
    position: ["bottom", "middle", "top"].includes(String(raw.position))
      ? (raw.position as MainCaptionStyle["position"])
      : DEFAULT_MAIN_CAPTION_STYLE.position,
    position_x_percent: Number.isFinite(raw.position_x_percent)
      ? Number(raw.position_x_percent)
      : undefined,
    position_y_percent: Number.isFinite(raw.position_y_percent)
      ? Number(raw.position_y_percent)
      : undefined,
    align: ["center", "left", "right"].includes(String(raw.align))
      ? (raw.align as MainCaptionStyle["align"])
      : DEFAULT_MAIN_CAPTION_STYLE.align,
    max_width_percent: Number.isFinite(raw.max_width_percent)
      ? Math.max(40, Math.min(100, Number(raw.max_width_percent)))
      : DEFAULT_MAIN_CAPTION_STYLE.max_width_percent,
    line_height: Number.isFinite(raw.line_height)
      ? Math.max(0.8, Math.min(2.5, Number(raw.line_height)))
      : DEFAULT_MAIN_CAPTION_STYLE.line_height,
    letter_spacing: Number.isFinite(raw.letter_spacing)
      ? Number(raw.letter_spacing)
      : DEFAULT_MAIN_CAPTION_STYLE.letter_spacing,
    word_spacing: Number.isFinite(raw.word_spacing)
      ? Number(raw.word_spacing)
      : DEFAULT_MAIN_CAPTION_STYLE.word_spacing,
    animation_in: String(raw.animation_in || DEFAULT_MAIN_CAPTION_STYLE.animation_in),
    animation_out: String(raw.animation_out || DEFAULT_MAIN_CAPTION_STYLE.animation_out),
    animation_loop: String(raw.animation_loop || DEFAULT_MAIN_CAPTION_STYLE.animation_loop),
    effect: String(raw.effect || DEFAULT_MAIN_CAPTION_STYLE.effect),
    karaoke_enabled: Boolean(raw.karaoke_enabled),
    karaoke_mode: ["none", "word", "line", "highlight"].includes(String(raw.karaoke_mode))
      ? (raw.karaoke_mode as MainCaptionStyle["karaoke_mode"])
      : DEFAULT_MAIN_CAPTION_STYLE.karaoke_mode,
    karaoke_active_color: String(raw.karaoke_active_color || DEFAULT_MAIN_CAPTION_STYLE.karaoke_active_color),
    karaoke_inactive_color: String(raw.karaoke_inactive_color || DEFAULT_MAIN_CAPTION_STYLE.karaoke_inactive_color),
    karaoke_highlight_color: String(raw.karaoke_highlight_color || DEFAULT_MAIN_CAPTION_STYLE.karaoke_highlight_color),
    karaoke_bar_enabled: Boolean(raw.karaoke_bar_enabled),
  };
}

export function resolveCaptionStyle(
  cue: CaptionCueItem | undefined,
  mainStyle: MainCaptionStyle,
  applyToAll: boolean,
): MainCaptionStyle {
  if (applyToAll || !cue?.style_override) {
    return mainStyle;
  }
  return normalizeMainCaptionStyle({
    ...mainStyle,
    ...cue.style_override,
  });
}

export function formatCaptionCase(text: string, caseMode: MainCaptionStyle["case_mode"]): string {
  if (!text) return "";
  if (caseMode === "uppercase") return text.toUpperCase();
  if (caseMode === "lowercase") return text.toLowerCase();
  if (caseMode === "title") {
    return text.replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return text;
}

