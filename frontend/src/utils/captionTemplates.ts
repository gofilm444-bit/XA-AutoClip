export type CaptionTemplateType =
  | "basic_subtitle"
  | "viral_caption"
  | "word_highlight"
  | "karaoke"
  | "bubble"
  | "meme"
  | "lower_third"
  | "quote"
  | "documentary"
  | "education"
  | "debate_marker"
  | "typewriter"
  | "glitch"
  | "shake"
  | "flash"
  | "sticker_text";

export type CaptionTemplateLayout = {
  position?: "bottom_center" | "middle_center" | "top_center" | "lower_third" | "bottom" | "middle" | "top";
  max_width_percent?: number;
  safe_margin_bottom?: number;
  box_style?: "none" | "rounded" | "pill" | "bar" | "glass" | "comic" | "outline_box";
  corner_radius?: number;
  padding_x?: number;
  padding_y?: number;
  anchor?: "center" | "left" | "right";
};

export type CaptionTemplateBehavior = {
  mode?: "static" | "per_word" | "keyword_highlight" | "line_reveal" | "typewriter" | "emphasis_word" | "word_progress";
  highlight_strategy?: "keywords" | "first_word" | "last_word" | "time_progress" | "manual" | "none";
  highlight_color?: string;
  secondary_color?: string;
  emphasis_scale?: number;
};

export type CaptionTemplateAnimation = {
  in?: "none" | "pop" | "fade" | "slide_up" | "typewriter" | "bounce" | "pop_in" | "bounce_in" | "fade_in" | "flash";
  loop?: "none" | "pulse" | "shake" | "glow" | "glitch" | "highlight_sweep" | "pulse_active_word" | "subtle_pulse" | "float" | "cursor_blink" | "badge_pulse";
  out?: "none" | "fade" | "slide_down" | "fade_out" | "pop";
};

export type MainCaptionStyle = {
  preset_id: string;
  template_type?: CaptionTemplateType;
  layout?: CaptionTemplateLayout;
  behavior?: CaptionTemplateBehavior;
  animation?: CaptionTemplateAnimation;
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
  source_asset_id?: string;
  source_segment_id?: string;
};

export type CaptionTemplateGroup = "basic" | "templates" | "bubble" | "effects";

export type CaptionTemplateCategory =
  | "All"
  | "Trending"
  | "Viral"
  | "Word"
  | "Bubble"
  | "Meme"
  | "Classic"
  | "Effects"
  | "Basic"
  | "NEW"
  | "Hits"
  | "Glow";

export type CaptionTemplate = {
  id: string;
  name: string;
  group: CaptionTemplateGroup;
  category: CaptionTemplateCategory;
  template_type: CaptionTemplateType;
  previewText: string;
  badge?: "Trending" | "Classic" | "NEW" | "Hits" | "Word" | "Glow" | "Basic" | "Bubble" | "Effects" | string;
  tags: string[];
  export_support: "full" | "partial" | "preview_only";
  export_support_note?: string;
  stylePatch: Partial<MainCaptionStyle>;
  layout: CaptionTemplateLayout;
  behavior: CaptionTemplateBehavior;
  animation: CaptionTemplateAnimation;
};

export const DEFAULT_MAIN_CAPTION_STYLE: MainCaptionStyle = {
  preset_id: "clean_white",
  template_type: "basic_subtitle",
  layout: {
    position: "bottom_center",
    max_width_percent: 82,
    safe_margin_bottom: 16,
    box_style: "none",
    corner_radius: 6,
    padding_x: 0,
    padding_y: 0,
    anchor: "center",
  },
  behavior: {
    mode: "static",
    highlight_strategy: "none",
    highlight_color: "#FACC15",
    secondary_color: "#FFFFFF",
    emphasis_scale: 1.0,
  },
  animation: {
    in: "none",
    loop: "none",
    out: "none",
  },
  font_family: "Montserrat, sans-serif",
  font_size: 20,
  font_weight: "700",
  italic: false,
  underline: false,
  case_mode: "none",
  color: "#FFFFFF",
  stroke_enabled: true,
  stroke_color: "#000000",
  stroke_width: 2.0,
  shadow_enabled: true,
  shadow_color: "rgba(0,0,0,0.6)",
  shadow_blur: 4,
  shadow_x: 0,
  shadow_y: 2,
  background_enabled: false,
  background_color: "#000000",
  background_opacity: 0.5,
  background_radius: 6,
  position: "bottom",
  position_x_percent: 50,
  position_y_percent: 84,
  align: "center",
  max_width_percent: 82,
  line_height: 1.2,
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
  // ==========================================
  // A. TRENDING / HIGH-IMPACT ANIMATED STYLES
  // ==========================================
  {
    id: "viral_yellow_punch",
    name: "Viral Yellow Punch",
    group: "templates",
    category: "Trending",
    template_type: "viral_caption",
    previewText: "VIRAL PUNCH",
    badge: "Trending",
    tags: ["viral", "trending", "yellow", "impact", "bold", "punch"],
    export_support: "full",
    export_support_note: "Full export styling",
    layout: { position: "bottom_center", max_width_percent: 92, safe_margin_bottom: 18 },
    behavior: { mode: "emphasis_word", highlight_strategy: "keywords", highlight_color: "#FDE047", emphasis_scale: 1.12 },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "viral_yellow_punch",
      template_type: "viral_caption",
      color: "#FDE047",
      font_family: "Anton, Impact, sans-serif",
      font_weight: "900",
      font_size: 32,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 5.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "karaoke_yellow",
    name: "Karaoke Yellow Sweep",
    group: "templates",
    category: "Trending",
    template_type: "word_highlight",
    previewText: "KARAOKE SWEEP",
    badge: "Trending",
    tags: ["karaoke", "trending", "yellow", "word", "timing", "sweep"],
    export_support: "full",
    export_support_note: "Moving progressive word highlight synchronized with audio timing in export",
    layout: { position: "bottom_center", max_width_percent: 90, safe_margin_bottom: 18 },
    behavior: { mode: "word_progress", highlight_strategy: "time_progress", highlight_color: "#FFD600", secondary_color: "#FFFFFF", emphasis_scale: 1.15 },
    animation: { in: "pop", loop: "highlight_sweep", out: "fade" },
    stylePatch: {
      preset_id: "karaoke_yellow",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, 'Plus Jakarta Sans', sans-serif",
      font_weight: "900",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "uppercase",
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#FFD600",
      karaoke_inactive_color: "#FFFFFF",
      karaoke_highlight_color: "#FFD600",
    },
  },
  {
    id: "karaoke_cyan",
    name: "Karaoke Cyan Glow",
    group: "templates",
    category: "Trending",
    template_type: "word_highlight",
    previewText: "CYAN GLOW",
    badge: "Trending",
    tags: ["karaoke", "trending", "cyan", "cyber", "glow", "timing"],
    export_support: "full",
    export_support_note: "Moving progressive cyan highlight synchronized with audio timing in export",
    layout: { position: "bottom_center", max_width_percent: 90, safe_margin_bottom: 18 },
    behavior: { mode: "word_progress", highlight_strategy: "time_progress", highlight_color: "#22D3EE", secondary_color: "#94A3B8", emphasis_scale: 1.15 },
    animation: { in: "pop", loop: "highlight_sweep", out: "fade" },
    stylePatch: {
      preset_id: "karaoke_cyan",
      template_type: "word_highlight",
      color: "#94A3B8",
      font_family: "Montserrat, 'Plus Jakarta Sans', sans-serif",
      font_weight: "900",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#0F172A",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(6,182,212,0.8)",
      shadow_blur: 10,
      shadow_y: 3,
      case_mode: "uppercase",
      karaoke_enabled: true,
      karaoke_mode: "word",
      karaoke_active_color: "#22D3EE",
      karaoke_inactive_color: "#94A3B8",
      karaoke_highlight_color: "#22D3EE",
    },
  },
  {
    id: "word_pop",
    name: "Word Pop Highlight",
    group: "templates",
    category: "Trending",
    template_type: "word_highlight",
    previewText: "WORD POP",
    badge: "Trending",
    tags: ["word", "trending", "pop", "highlight", "active"],
    export_support: "full",
    export_support_note: "Keyword emphasis pop highlight in export",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "emphasis_word", highlight_strategy: "keywords", highlight_color: "#FDE047", emphasis_scale: 1.2 },
    animation: { in: "pop", loop: "pulse_active_word", out: "pop" },
    stylePatch: {
      preset_id: "word_pop",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Impact, 'Plus Jakarta Sans', sans-serif",
      font_weight: "900",
      font_size: 30,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 4.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "white_rounded_bubble",
    name: "Bubble Pop",
    group: "bubble",
    category: "Trending",
    template_type: "bubble",
    previewText: "BUBBLE POP",
    badge: "Trending",
    tags: ["bubble", "trending", "pop", "white", "clean"],
    export_support: "partial",
    export_support_note: "CSS pulse animation active in preview player; exported as clean styled static bubble",
    layout: { position: "bottom_center", max_width_percent: 84, box_style: "rounded", corner_radius: 24, padding_x: 24, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "subtle_pulse", out: "fade" },
    stylePatch: {
      preset_id: "white_rounded_bubble",
      template_type: "bubble",
      color: "#000000",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.4)",
      shadow_blur: 10,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#FFFFFF",
      background_opacity: 0.95,
      background_radius: 24,
      case_mode: "none",
    },
  },
  {
    id: "sticker_text",
    name: "Sticker Bounce",
    group: "templates",
    category: "Trending",
    template_type: "sticker_text",
    previewText: "STICKER BOUNCE",
    badge: "Trending",
    tags: ["sticker", "trending", "bounce", "badge", "pop"],
    export_support: "partial",
    export_support_note: "CSS kinetic bounce active in preview; exported as styled sticker text badge",
    layout: { position: "bottom_center", max_width_percent: 88, box_style: "outline_box", corner_radius: 16, padding_x: 20, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "bounce", loop: "float", out: "fade" },
    stylePatch: {
      preset_id: "sticker_text",
      template_type: "sticker_text",
      color: "#09090B",
      font_size: 28,
      font_family: "'Fredoka', 'Montserrat', sans-serif",
      font_weight: "900",
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      shadow_blur: 12,
      shadow_y: 6,
      background_enabled: true,
      background_color: "#FEF08A",
      background_opacity: 0.98,
      background_radius: 16,
      case_mode: "uppercase",
    },
  },
  {
    id: "glitch_word",
    name: "Glitch Word",
    group: "effects",
    category: "Trending",
    template_type: "glitch",
    previewText: "GLITCH IMPACT",
    badge: "Trending",
    tags: ["glitch", "trending", "cyber", "effects", "chromatic"],
    export_support: "partial",
    export_support_note: "CSS chromatic aberration active in preview; exported as cyber styled static caption",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "static" },
    animation: { in: "flash", loop: "glitch", out: "none" },
    stylePatch: {
      preset_id: "glitch_word",
      template_type: "glitch",
      color: "#4ADE80",
      font_family: "monospace, 'Plus Jakarta Sans', sans-serif",
      font_weight: "900",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#022C22",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(6,182,212,0.9)",
      shadow_blur: 12,
      shadow_x: -2,
      shadow_y: 2,
      case_mode: "uppercase",
    },
  },
  {
    id: "shake_word",
    name: "Shake Impact",
    group: "effects",
    category: "Trending",
    template_type: "shake",
    previewText: "SHAKE IMPACT",
    badge: "Trending",
    tags: ["shake", "trending", "punch", "effects", "kinetic"],
    export_support: "partial",
    export_support_note: "CSS kinetic shake active in preview; exported as punch styled static caption",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "shake", out: "none" },
    stylePatch: {
      preset_id: "shake_word",
      template_type: "shake",
      color: "#EF4444",
      font_family: "Impact, 'Plus Jakarta Sans', sans-serif",
      font_weight: "900",
      font_size: 32,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 5.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "flash_emphasis",
    name: "Flash Emphasis",
    group: "effects",
    category: "Trending",
    template_type: "flash",
    previewText: "FLASH EMPHASIS",
    badge: "Trending",
    tags: ["flash", "trending", "pulse", "glow", "effects"],
    export_support: "partial",
    export_support_note: "CSS pulse flash active in preview; exported as glow styled static caption",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "static" },
    animation: { in: "flash", loop: "pulse", out: "fade" },
    stylePatch: {
      preset_id: "flash_emphasis",
      template_type: "flash",
      color: "#FACC15",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "900",
      font_size: 30,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 4.0,
      shadow_enabled: true,
      shadow_color: "rgba(250,204,21,0.9)",
      shadow_blur: 16,
      shadow_y: 0,
      case_mode: "uppercase",
    },
  },
  {
    id: "typewriter",
    name: "Typewriter Reveal",
    group: "effects",
    category: "Trending",
    template_type: "typewriter",
    previewText: "TYPEWRITER REVEAL",
    badge: "Trending",
    tags: ["typewriter", "trending", "progressive", "monospace", "reveal"],
    export_support: "full",
    export_support_note: "Stepped progressive typewriter animation exported in video",
    layout: { position: "bottom_center", max_width_percent: 86, safe_margin_bottom: 18 },
    behavior: { mode: "typewriter" },
    animation: { in: "typewriter", loop: "cursor_blink", out: "none" },
    stylePatch: {
      preset_id: "typewriter",
      template_type: "typewriter",
      color: "#BAE6FD",
      font_family: "monospace, 'Plus Jakarta Sans', sans-serif",
      font_weight: "800",
      font_size: 25,
      stroke_enabled: true,
      stroke_color: "#0C4A6E",
      stroke_width: 3.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },
  {
    id: "debate_marker",
    name: "Debate Marker Pop",
    group: "templates",
    category: "Trending",
    template_type: "debate_marker",
    previewText: "DEBAT POP",
    badge: "Trending",
    tags: ["debate", "trending", "marker", "card", "pop"],
    export_support: "full",
    export_support_note: "Debate marker badge styling exported in video",
    layout: { position: "bottom_center", max_width_percent: 88, box_style: "glass", corner_radius: 12, padding_x: 16, padding_y: 12 },
    behavior: { mode: "static" },
    animation: { in: "slide_up", loop: "badge_pulse", out: "fade" },
    stylePatch: {
      preset_id: "debate_marker",
      template_type: "debate_marker",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.7)",
      shadow_blur: 8,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#09090B",
      background_opacity: 0.85,
      background_radius: 12,
      case_mode: "none",
    },
  },
  {
    id: "meme_white_stroke",
    name: "Meme Punch",
    group: "templates",
    category: "Trending",
    template_type: "meme",
    previewText: "MEME PUNCH",
    badge: "Trending",
    tags: ["meme", "trending", "impact", "punch", "classic"],
    export_support: "full",
    export_support_note: "Bold meme stroke exported in video",
    layout: { position: "bottom_center", max_width_percent: 94, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "meme_white_stroke",
      template_type: "meme",
      color: "#FFFFFF",
      font_family: "Impact, Bangers, sans-serif",
      font_weight: "900",
      font_size: 34,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 6.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 10,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "creator_bold",
    name: "Creator Pop",
    group: "templates",
    category: "Trending",
    template_type: "viral_caption",
    previewText: "CREATOR POP",
    badge: "Trending",
    tags: ["creator", "trending", "cyan", "bold", "viral"],
    export_support: "full",
    export_support_note: "Creator first-word highlight exported in video",
    layout: { position: "bottom_center", max_width_percent: 90, safe_margin_bottom: 18 },
    behavior: { mode: "emphasis_word", highlight_strategy: "first_word", highlight_color: "#38BDF8", emphasis_scale: 1.1 },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "creator_bold",
      template_type: "viral_caption",
      color: "#38BDF8",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "900",
      font_size: 30,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 4.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.85)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "question_pop",
    name: "Question Bounce",
    group: "templates",
    category: "Trending",
    template_type: "debate_marker",
    previewText: "QUESTION BOUNCE",
    badge: "Trending",
    tags: ["question", "trending", "bounce", "marker", "card"],
    export_support: "partial",
    export_support_note: "CSS bounce active in preview; exported as question card",
    layout: { position: "bottom_center", max_width_percent: 88, box_style: "glass", corner_radius: 12, padding_x: 16, padding_y: 12 },
    behavior: { mode: "static" },
    animation: { in: "bounce", loop: "badge_pulse", out: "fade" },
    stylePatch: {
      preset_id: "question_pop",
      template_type: "debate_marker",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.7)",
      shadow_blur: 8,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#09090B",
      background_opacity: 0.85,
      background_radius: 12,
      case_mode: "none",
    },
  },
  {
    id: "neon_cyan",
    name: "Neon Pulse",
    group: "effects",
    category: "Trending",
    template_type: "viral_caption",
    previewText: "NEON PULSE",
    badge: "Trending",
    tags: ["neon", "trending", "cyan", "pulse", "glow"],
    export_support: "partial",
    export_support_note: "CSS neon pulse active in preview; exported as neon styled text",
    layout: { position: "bottom_center", max_width_percent: 90, safe_margin_bottom: 18 },
    behavior: { mode: "static" },
    animation: { in: "fade", loop: "glow", out: "fade" },
    stylePatch: {
      preset_id: "neon_cyan",
      template_type: "viral_caption",
      color: "#22D3EE",
      font_family: "Montserrat, 'Plus Jakarta Sans', sans-serif",
      font_weight: "900",
      font_size: 30,
      stroke_enabled: true,
      stroke_color: "#083344",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(34,211,238,0.9)",
      shadow_blur: 16,
      shadow_y: 0,
      case_mode: "uppercase",
    },
  },

  // ==========================================
  // B. BASIC / CLEAN SUBTITLES
  // ==========================================
  {
    id: "clean_white",
    name: "Clean White",
    group: "basic",
    category: "Basic",
    template_type: "basic_subtitle",
    previewText: "CLEAN WHITE",
    badge: "Basic",
    tags: ["clean", "white", "basic", "subtitle", "simple"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 86, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "clean_white",
      template_type: "basic_subtitle",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', sans-serif",
      font_weight: "700",
      font_size: 26,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 2.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.6)",
      shadow_blur: 4,
      shadow_y: 2,
      case_mode: "none",
    },
  },
  {
    id: "white_stroke",
    name: "White Stroke",
    group: "basic",
    category: "Basic",
    template_type: "basic_subtitle",
    previewText: "WHITE STROKE",
    badge: "Basic",
    tags: ["stroke", "white", "clean", "basic"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 86, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "white_stroke",
      template_type: "basic_subtitle",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      font_size: 26,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "soft_subtitle",
    name: "Soft Subtitle",
    group: "basic",
    category: "Basic",
    template_type: "basic_subtitle",
    previewText: "SOFT SUBTITLE",
    badge: "Basic",
    tags: ["soft", "white", "minimal", "basic"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 86, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "soft_subtitle",
      template_type: "basic_subtitle",
      color: "#F1F5F9",
      font_family: "'Inter', sans-serif",
      font_weight: "600",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 2,
      case_mode: "none",
    },
  },
  {
    id: "minimal_gray",
    name: "Minimal Gray",
    group: "basic",
    category: "Basic",
    template_type: "basic_subtitle",
    previewText: "MINIMAL GRAY",
    badge: "Basic",
    tags: ["gray", "minimal", "clean", "basic"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 86, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "minimal_gray",
      template_type: "basic_subtitle",
      color: "#E2E8F0",
      font_family: "'Roboto', sans-serif",
      font_weight: "600",
      font_size: 24,
      stroke_enabled: true,
      stroke_color: "#1E293B",
      stroke_width: 1.5,
      shadow_enabled: false,
      case_mode: "none",
    },
  },
  {
    id: "compact_subtitle",
    name: "Compact Subtitle",
    group: "basic",
    category: "Basic",
    template_type: "basic_subtitle",
    previewText: "COMPACT SUBTITLE",
    badge: "Basic",
    tags: ["compact", "small", "clean", "basic"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 82, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "compact_subtitle",
      template_type: "basic_subtitle",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', sans-serif",
      font_weight: "700",
      font_size: 22,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 2.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.5)",
      shadow_blur: 3,
      shadow_y: 1,
      case_mode: "none",
    },
  },

  // ==========================================
  // C. WORD HIGHLIGHT / KEYWORDS
  // ==========================================
  {
    id: "keyword_yellow",
    name: "Keyword Yellow",
    group: "templates",
    category: "Word",
    template_type: "word_highlight",
    previewText: "KEYWORD YELLOW",
    badge: "Word",
    tags: ["keyword", "yellow", "word", "highlight"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "keyword_highlight", highlight_strategy: "keywords", highlight_color: "#FACC15" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "keyword_yellow",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },
  {
    id: "important_red",
    name: "Important Red",
    group: "templates",
    category: "Word",
    template_type: "word_highlight",
    previewText: "IMPORTANT RED",
    badge: "Word",
    tags: ["red", "important", "word", "highlight"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "keyword_highlight", highlight_strategy: "keywords", highlight_color: "#EF4444" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "important_red",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },
  {
    id: "question_blue",
    name: "Question Blue",
    group: "templates",
    category: "Word",
    template_type: "word_highlight",
    previewText: "QUESTION BLUE",
    badge: "Word",
    tags: ["blue", "question", "word", "highlight"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "keyword_highlight", highlight_strategy: "keywords", highlight_color: "#38BDF8" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "question_blue",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },
  {
    id: "money_green",
    name: "Money Green",
    group: "templates",
    category: "Word",
    template_type: "word_highlight",
    previewText: "MONEY GREEN",
    badge: "Word",
    tags: ["green", "money", "word", "highlight"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "keyword_highlight", highlight_strategy: "keywords", highlight_color: "#4ADE80" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "money_green",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },
  {
    id: "debate_highlight",
    name: "Debate Highlight",
    group: "templates",
    category: "Word",
    template_type: "word_highlight",
    previewText: "DEBATE HIGHLIGHT",
    badge: "Word",
    tags: ["orange", "debate", "word", "highlight"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "keyword_highlight", highlight_strategy: "keywords", highlight_color: "#FB923C" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "debate_highlight",
      template_type: "word_highlight",
      color: "#FFFFFF",
      font_family: "Montserrat, sans-serif",
      font_weight: "800",
      font_size: 28,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 3.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },

  // ==========================================
  // D. BUBBLE CAPTIONS
  // ==========================================
  {
    id: "yellow_bubble",
    name: "Yellow Bubble",
    group: "bubble",
    category: "Bubble",
    template_type: "bubble",
    previewText: "YELLOW BUBBLE",
    badge: "Bubble",
    tags: ["yellow", "bubble", "rounded", "box"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 84, box_style: "rounded", corner_radius: 20, padding_x: 22, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "yellow_bubble",
      template_type: "bubble",
      color: "#000000",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.4)",
      shadow_blur: 10,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#FDE047",
      background_opacity: 0.95,
      background_radius: 20,
      case_mode: "none",
    },
  },
  {
    id: "chat_bubble",
    name: "Chat Bubble",
    group: "bubble",
    category: "Bubble",
    template_type: "bubble",
    previewText: "CHAT BUBBLE",
    badge: "Bubble",
    tags: ["chat", "blue", "bubble", "rounded"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 84, box_style: "rounded", corner_radius: 20, padding_x: 22, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "chat_bubble",
      template_type: "bubble",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', sans-serif",
      font_weight: "700",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.5)",
      shadow_blur: 8,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#0284C7",
      background_opacity: 0.9,
      background_radius: 20,
      case_mode: "none",
    },
  },
  {
    id: "comic_bubble",
    name: "Comic Bubble",
    group: "bubble",
    category: "Bubble",
    template_type: "bubble",
    previewText: "COMIC BUBBLE",
    badge: "Bubble",
    tags: ["comic", "stroke", "bubble", "pop"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 84, box_style: "comic", corner_radius: 16, padding_x: 20, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "comic_bubble",
      template_type: "bubble",
      color: "#000000",
      font_family: "Bangers, Impact, sans-serif",
      font_weight: "900",
      font_size: 26,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 1.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 0,
      shadow_x: 4,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#FFFFFF",
      background_opacity: 1.0,
      background_radius: 16,
      case_mode: "uppercase",
    },
  },
  {
    id: "dark_glass_bubble",
    name: "Dark Glass Bubble",
    group: "bubble",
    category: "Bubble",
    template_type: "bubble",
    previewText: "DARK GLASS",
    badge: "Bubble",
    tags: ["dark", "glass", "bubble", "modern"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 84, box_style: "glass", corner_radius: 20, padding_x: 22, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "dark_glass_bubble",
      template_type: "bubble",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', sans-serif",
      font_weight: "700",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 12,
      shadow_y: 6,
      background_enabled: true,
      background_color: "#18181B",
      background_opacity: 0.85,
      background_radius: 20,
      case_mode: "none",
    },
  },

  // ==========================================
  // E. MEME CAPTIONS
  // ==========================================
  {
    id: "meme_top_bottom",
    name: "Meme Top Bottom",
    group: "templates",
    category: "Meme",
    template_type: "meme",
    previewText: "TOP BOTTOM MEME",
    badge: "Meme",
    tags: ["meme", "top", "bottom", "impact"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 94, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "none", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "meme_top_bottom",
      template_type: "meme",
      color: "#FFFFFF",
      font_family: "Impact, Bangers, sans-serif",
      font_weight: "900",
      font_size: 32,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 5.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "reaction_text",
    name: "Reaction Text",
    group: "templates",
    category: "Meme",
    template_type: "meme",
    previewText: "REACTION TEXT",
    badge: "Meme",
    tags: ["reaction", "meme", "yellow", "bold"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 94, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "reaction_text",
      template_type: "meme",
      color: "#FACC15",
      font_family: "Impact, sans-serif",
      font_weight: "900",
      font_size: 32,
      stroke_enabled: true,
      stroke_color: "#000000",
      stroke_width: 5.0,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },
  {
    id: "big_laugh",
    name: "Big Laugh",
    group: "templates",
    category: "Meme",
    template_type: "meme",
    previewText: "BIG LAUGH",
    badge: "Meme",
    tags: ["laugh", "meme", "funny", "bold"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 94, safe_margin_bottom: 16 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "none" },
    stylePatch: {
      preset_id: "big_laugh",
      template_type: "meme",
      color: "#FEF08A",
      font_family: "Bangers, Impact, sans-serif",
      font_weight: "900",
      font_size: 34,
      stroke_enabled: true,
      stroke_color: "#713F12",
      stroke_width: 4.5,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 8,
      shadow_y: 4,
      case_mode: "uppercase",
    },
  },

  // ==========================================
  // F. LOWER THIRD & BROADCAST
  // ==========================================
  {
    id: "news_lower_third",
    name: "News Lower Third",
    group: "templates",
    category: "Classic",
    template_type: "lower_third",
    previewText: "BERITA UTAMA",
    badge: "Classic",
    tags: ["news", "lower_third", "broadcast", "bar"],
    export_support: "full",
    layout: { position: "lower_third", max_width_percent: 92, box_style: "bar", corner_radius: 8, padding_x: 16, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "slide_up", loop: "none", out: "fade" },
    stylePatch: {
      preset_id: "news_lower_third",
      template_type: "lower_third",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 8,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#0F172A",
      background_opacity: 0.95,
      background_radius: 8,
      case_mode: "none",
    },
  },
  {
    id: "podcast_speaker",
    name: "Podcast Speaker",
    group: "templates",
    category: "Classic",
    template_type: "lower_third",
    previewText: "PODCAST SPEAKER",
    badge: "Classic",
    tags: ["podcast", "speaker", "lower_third", "bar"],
    export_support: "full",
    layout: { position: "lower_third", max_width_percent: 92, box_style: "bar", corner_radius: 8, padding_x: 16, padding_y: 10 },
    behavior: { mode: "static" },
    animation: { in: "slide_up", loop: "none", out: "fade" },
    stylePatch: {
      preset_id: "podcast_speaker",
      template_type: "lower_third",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 8,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#18181B",
      background_opacity: 0.9,
      background_radius: 8,
      case_mode: "none",
    },
  },
  {
    id: "quote_lower_third",
    name: "Quote Lower Third",
    group: "templates",
    category: "Classic",
    template_type: "quote",
    previewText: "KUTIPAN TOKOH",
    badge: "Classic",
    tags: ["quote", "kutipan", "serif", "classic"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, safe_margin_bottom: 18 },
    behavior: { mode: "static" },
    animation: { in: "fade", loop: "none", out: "fade" },
    stylePatch: {
      preset_id: "quote_lower_third",
      template_type: "quote",
      color: "#FEF3C7",
      font_family: "'Playfair Display', Georgia, serif",
      font_weight: "700",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.9)",
      shadow_blur: 8,
      shadow_y: 3,
      italic: true,
      case_mode: "none",
    },
  },
  {
    id: "documentary_serif",
    name: "Documentary Serif",
    group: "templates",
    category: "Classic",
    template_type: "documentary",
    previewText: "DOCUMENTARY SERIF",
    badge: "Classic",
    tags: ["documentary", "serif", "gold", "classic"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 86, safe_margin_bottom: 18 },
    behavior: { mode: "static" },
    animation: { in: "fade", loop: "none", out: "fade" },
    stylePatch: {
      preset_id: "documentary_serif",
      template_type: "documentary",
      color: "#FEF3C7",
      font_family: "Georgia, 'Playfair Display', serif",
      font_weight: "700",
      font_size: 26,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.8)",
      shadow_blur: 6,
      shadow_y: 3,
      case_mode: "none",
    },
  },
  {
    id: "education_highlight",
    name: "Education Highlight",
    group: "templates",
    category: "Classic",
    template_type: "education",
    previewText: "FAKTA MENARIK",
    badge: "Classic",
    tags: ["education", "highlight", "card", "fakta"],
    export_support: "full",
    layout: { position: "bottom_center", max_width_percent: 88, box_style: "glass", corner_radius: 12, padding_x: 16, padding_y: 12 },
    behavior: { mode: "static" },
    animation: { in: "pop", loop: "none", out: "fade" },
    stylePatch: {
      preset_id: "education_highlight",
      template_type: "education",
      color: "#FFFFFF",
      font_family: "'Plus Jakarta Sans', Montserrat, sans-serif",
      font_weight: "800",
      font_size: 24,
      stroke_enabled: false,
      shadow_enabled: true,
      shadow_color: "rgba(0,0,0,0.7)",
      shadow_blur: 8,
      shadow_y: 4,
      background_enabled: true,
      background_color: "#09090B",
      background_opacity: 0.85,
      background_radius: 12,
      case_mode: "none",
    },
  },
];

export function computeKaraokeWordProgress(
  words: string[],
  cueStart: number,
  cueEnd: number,
  currentTime: number,
): { activeWordIndex: number; progress: number } {
  if (words.length === 0) return { activeWordIndex: -1, progress: 0 };
  const totalDuration = Math.max(0.05, cueEnd - cueStart);
  const elapsed = Math.max(0, Math.min(totalDuration, currentTime - cueStart));
  const progress = elapsed / totalDuration;

  const weights = words.map((w) => 1.0 + w.replace(/[^a-zA-Z0-9]/g, "").length * 0.35);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let accumulatedTime = 0;
  for (let i = 0; i < words.length; i++) {
    const wordDur = (weights[i] / totalWeight) * totalDuration;
    accumulatedTime += wordDur;
    if (elapsed <= accumulatedTime || i === words.length - 1) {
      return { activeWordIndex: i, progress };
    }
  }
  return { activeWordIndex: words.length - 1, progress };
}

export function extractHighlightedWordIndices(
  text: string,
  strategy: CaptionTemplateBehavior["highlight_strategy"] = "keywords",
): Set<number> {
  const result = new Set<number>();
  if (!text || strategy === "none") return result;

  const words = text.trim().split(/\s+/);
  if (words.length === 0) return result;

  if (strategy === "first_word") {
    result.add(0);
    return result;
  }

  if (strategy === "last_word") {
    result.add(words.length - 1);
    return result;
  }

  // Keywords strategy: highlight long words, capitalized words, numbers, or words with punctuation
  words.forEach((w, idx) => {
    const clean = w.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length >= 5 || /\d+/.test(w) || /[!?,]/.test(w) || (clean.length >= 3 && clean === clean.toUpperCase())) {
      result.add(idx);
    }
  });

  // Fallback: if no keywords matched, highlight the first word
  if (result.size === 0 && words.length > 0) {
    result.add(0);
  }

  return result;
}

export function searchCaptionTemplates(
  query: string,
  category: CaptionTemplateCategory = "All",
  group?: CaptionTemplateGroup,
): CaptionTemplate[] {
  const normalizedQuery = (query || "").trim().toLowerCase();

  return CAPTION_TEMPLATES.filter((tpl) => {
    // 1. Category filter:
    if (category === "Trending") {
      if (tpl.category !== "Trending" && !tpl.tags.includes("trending") && tpl.badge !== "Trending") {
        return false;
      }
    } else if (category !== "All") {
      if (tpl.category !== category && !tpl.tags.includes(category.toLowerCase())) {
        return false;
      }
    }

    // 2. Group filter (if specified and not "templates" / "All")
    if (group && group !== "templates" && category === "All") {
      if (tpl.group !== group) return false;
    }

    // 3. Search query
    if (!normalizedQuery) return true;

    return (
      tpl.name.toLowerCase().includes(normalizedQuery) ||
      tpl.id.toLowerCase().includes(normalizedQuery) ||
      tpl.template_type.toLowerCase().includes(normalizedQuery) ||
      tpl.category.toLowerCase().includes(normalizedQuery) ||
      tpl.tags.some((t) => t.toLowerCase().includes(normalizedQuery))
    );
  });
}

export function getCaptionTemplatesByGroup(group: CaptionTemplateGroup): CaptionTemplate[] {
  if (group === "templates") {
    return CAPTION_TEMPLATES;
  }
  return CAPTION_TEMPLATES.filter((tpl) => tpl.group === group);
}

export function normalizeMainCaptionStyle(raw?: Partial<MainCaptionStyle> | null): MainCaptionStyle {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MAIN_CAPTION_STYLE };
  }
  return {
    preset_id: String(raw.preset_id || DEFAULT_MAIN_CAPTION_STYLE.preset_id),
    template_type: raw.template_type || DEFAULT_MAIN_CAPTION_STYLE.template_type,
    layout: {
      ...DEFAULT_MAIN_CAPTION_STYLE.layout,
      ...(raw.layout || {}),
    },
    behavior: {
      ...DEFAULT_MAIN_CAPTION_STYLE.behavior,
      ...(raw.behavior || {}),
    },
    animation: {
      ...DEFAULT_MAIN_CAPTION_STYLE.animation,
      ...(raw.animation || {}),
    },
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

export function applyCaptionTemplateToMainStyle(
  baseStyle: MainCaptionStyle,
  template: CaptionTemplate,
): MainCaptionStyle {
  return normalizeMainCaptionStyle({
    ...baseStyle,
    ...template.stylePatch,
    preset_id: template.id,
    template_type: template.template_type,
    layout: {
      ...(baseStyle.layout || {}),
      ...(template.layout || {}),
    },
    behavior: {
      ...(baseStyle.behavior || {}),
      ...(template.behavior || {}),
    },
    animation: {
      ...(baseStyle.animation || {}),
      ...(template.animation || {}),
    },
  });
}

export function applyCaptionTemplateToCaptionItem(
  cue: CaptionCueItem,
  template: CaptionTemplate,
): CaptionCueItem {
  const currentOverride = cue.style_override || {};
  const nextOverride: Partial<MainCaptionStyle> = {
    ...currentOverride,
    ...template.stylePatch,
    preset_id: template.id,
    template_type: template.template_type,
    layout: {
      ...(currentOverride.layout || {}),
      ...(template.layout || {}),
    },
    behavior: {
      ...(currentOverride.behavior || {}),
      ...(template.behavior || {}),
    },
    animation: {
      ...(currentOverride.animation || {}),
      ...(template.animation || {}),
    },
  };

  return {
    ...cue,
    style_id: template.id,
    style_override: nextOverride,
  };
}
