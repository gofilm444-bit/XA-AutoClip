export type Project = {
  id: string;
  title: string;
  description: string | null;
  content_type: "podcast" | "sports";
  transcript_provider: string | null;
  transcript_language: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  original_duration?: number | null;
  total_top_clips?: number;
  final_clips_count?: number;
  storage_size_estimate?: number;
  manual_editor_url?: string | null;
};

export type Candidate = {
  id: string;
  rank: number;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  transcript_text: string;
  suggested_title: string;
  suggested_hook: string;
  summary: string;
  category: string;
  hook_score: number;
  context_score: number;
  information_score: number;
  emotion_score: number;
  fluency_score: number;
  duration_score: number;
  discussion_score: number;
  viral_potential_score: number;
  reasons_json: string[];
  risks_json: string[];
  selected: boolean;
  short_source_clip_path?: string | null;
  clip_thumbnail_path?: string | null;
  file_missing?: boolean;
};

export type ProjectClip = Candidate & {
  candidate_id: string;
  job_id: string;
  clip_id: string;
  transformation_id: string | null;
  preview_render_id: string | null;
  preview_status: string | null;
  final_render_id: string | null;
  final_status: string | null;
  final_file_size_bytes: number | null;
};

export type Transformation = {
  id: string;
  project_id: string;
  candidate_id: string;
  purpose: string;
  new_angle: string;
  audience: string;
  original_hook: string;
  commentary_script: string;
  conclusion: string;
  engagement_question: string;
  social_caption: string;
  clipper_style_config: ClipperStyleConfig;
  needs_fact_verification: boolean;
  status: string;
  storyboard: Array<Record<string, unknown>>;
};

export type ClipperStyleConfig = {
  clipper_style_preset: string;
  manual_editor_mode?: boolean;
  hook_text: string;
  hook_text_enabled: boolean;
  hook_text_template?:
    | "capcut_clean"
    | "neon_text"
    | "soft_gradient_text"
    | "minimal_white"
    | "yellow_viral"
    | "elegant_modern"
    | "headline_bold"
    | "glass_card"
    | "breaking_news"
    | "clean_top"
    | "highlight_box";
  hook_text_position?: "safe_top" | "top" | "upper_center";
  hook_text_size?: "normal" | "large";
  hook_text_style_preset?: TextStylePresetKey;
  hook_text_color?: string;
  hook_text_font_weight?: string | number;
  hook_text_outline_color?: string;
  hook_text_outline_width?: number;
  hook_text_background_color?: string;
  hook_text_background_opacity?: number;
  hook_text_font?:
    | "bold_sans"
    | "elegant_serif"
    | "modern_rounded"
    | "condensed_news"
    | "playful"
    | "clean_sans";
  keyword_text_style_preset?: TextStylePresetKey;
  caption_mode: "short";
  caption_max_words: number;
  caption_max_chars: number;
  caption_style?: {
    preset: string;
    textPreset?: TextStylePresetKey;
    displayMode?: "segment" | "karaoke" | "word_by_word";
    fontSize: "small" | "medium" | "large";
    fontWeight: "normal" | "semibold" | "bold";
    position: "bottom" | "center_lower" | "center" | "top";
    textColor: string;
    highlightColor: string;
    outlineEnabled: boolean;
    shadowEnabled: boolean;
    backgroundEnabled: boolean;
    backgroundOpacity: number;
    maxWords: number;
    maxChars: number;
    karaokeEnabled: boolean;
  };
  punch_zoom_enabled: boolean;
  pattern_interrupt_enabled: boolean;
  keyword_popup_enabled: boolean;
  style_intensity: "low" | "medium" | "high";
  effect_timeline?: Array<{
    id?: string;
    type: string;
    start: number;
    end: number;
    zoom?: number;
    text?: string;
    reason?: string;
    locked?: boolean;
    visible?: boolean;
    position?: string;
    size?: string;
    preset?: string;
    font_family?: string;
    position_x_percent?: number;
    position_y_percent?: number;
    scale?: number;
    font_size?: number;
    font_weight?: string | number;
    font_style?: "normal" | "italic";
    text_decoration?: "none" | "underline";
    text_case?: "normal" | "uppercase" | "lowercase" | "titlecase";
    color?: string;
    letter_spacing?: number;
    line_height?: number;
    text_align?: "left" | "center" | "right";
    opacity?: number;
    stroke_enabled?: boolean;
    stroke_color?: string;
    stroke_width?: number;
    background_enabled?: boolean;
    background_color?: string;
    background_opacity?: number;
    background_radius?: number;
    shadow_enabled?: boolean;
    shadow_color?: string;
    shadow_blur?: number;
  }>;
  audio_settings?: {
    volume: number;
    muted: boolean;
    fade_in: number;
    fade_out: number;
    speed?: number;
  };
  media_trim?: {
    start: number;
    end: number | null;
  };
  media_split_points?: number[];
  media_sequence?: Array<{
    id: string;
    source_start: number;
    source_end: number;
    locked?: boolean;
    visible?: boolean;
    muted?: boolean;
  }>;
  video_sequence?: Array<{
    id: string;
    source_start: number;
    source_end: number;
    locked?: boolean;
    visible?: boolean;
  }>;
  audio_sequence?: Array<{
    id: string;
    source_start: number;
    source_end: number;
    locked?: boolean;
    muted?: boolean;
  }>;
  audio_extracted?: boolean;
  video_track_deleted?: boolean;
  audio_track_deleted?: boolean;
  video_framing?: {
    preset?: "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture" | "clean_podcast" | "studio_podcast" | "talking_head" | string;
    x: number;
    y: number;
    scale: number;
    mode?: "cover" | "contain" | "custom";
    rotation?: number;
    flip_h?: boolean;
    flip_v?: boolean;
    opacity?: number;
    blur_background?: boolean;
    blur_strength?: number;
    background_color?: string;
  };
  crop_aspect_ratio?: "9:16" | "1:1" | "16:9" | "4:5";
  video_adjustments?: {
    brightness: number;
    contrast: number;
    saturation: number;
    sharpness: number;
    temperature: number;
    vignette: number;
    blur?: number;
  };
  video_speed?: number;
  editor_state_version?: number;
  video_sequence_initialized?: boolean;
  audio_sequence_initialized?: boolean;
  caption_timeline_initialized?: boolean;
  caption_sync_required?: boolean;
  effect_timeline_initialized?: boolean;
  layer_order?: Array<"caption" | "hook" | "keyword" | "punch" | "pattern" | "video" | "audio">;
  visual_layer_order?: Array<"caption" | "hook" | "keyword" | "video">;
  track_order?: Array<"text" | "overlay" | "video" | "audio" | string>;
  track_locks?: {
    text?: boolean;
    overlay?: boolean;
    video?: boolean;
    audio?: boolean;
  };
  track_visibility?: {
    text?: boolean;
    overlay?: boolean;
    video?: boolean;
  };
  video_muted?: boolean;
  video_visible?: boolean;
  video_locked?: boolean;
  audio_locked?: boolean;
  editor_preferences?: {
    timeline_height?: number;
    timeline_zoom?: number;
    theme?: "dark" | "light";
  };
  additional_audio_assets?: Array<{
    id: string;
    name: string;
    mime_type: string;
    size_bytes: number;
    duration_seconds: number;
  }>;
  additional_audio_tracks?: Array<{
    id: string;
    asset_id: string;
    label: string;
    kind: "backsound" | "sfx";
    start: number;
    end: number;
    volume: number;
    speed?: number;
    fade_in?: number;
    fade_out?: number;
    muted?: boolean;
    locked?: boolean;
    loop?: boolean;
  }>;
  audio_tracks?: Array<{
    id: string;
    asset_id: string;
    label: string;
    kind: "backsound" | "sfx";
    start: number;
    end: number;
    volume: number;
    speed?: number;
    fade_in?: number;
    fade_out?: number;
    muted?: boolean;
    locked?: boolean;
    loop?: boolean;
  }>;
  caption_timeline?: Array<{
    id: string;
    start: number;
    end: number;
    text: string;
    locked?: boolean;
    visible?: boolean;
    type?: "main_caption" | string;
    style_id?: string | null;
    style_override?: Record<string, unknown> | null;
    source_asset_id?: string;
    source_segment_id?: string;
  }>;
  main_caption_style?: Record<string, unknown>;
  caption_apply_to_all?: boolean;
  editor_image_assets?: Array<{
    id: string;
    name: string;
    url: string;
    kind: string;
  }>;
  render_preset?: "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture";
};

export type EditorMediaAsset = {
  asset_id: string;
  kind: "video" | "audio" | "image";
  name: string;
  url: string;
  source_url?: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number;
  mime_type: string;
};

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

export type TransformationContext = {
  project_title: string;
  content_type: "podcast" | "sports";
  source_title: string | null;
  source_creator: string | null;
  source_url: string | null;
  uploaded_filename: string | null;
  clip_start_seconds: number;
  clip_end_seconds: number;
  clip_duration_seconds: number;
  candidate_title: string;
  candidate_transcript: string;
  caption_cues: Array<{ start: number; end: number; text: string }>;
  transcription_provider: string | null;
  configured_transcription_provider: string;
  transcription_language: string | null;
  transcription_is_demo: boolean;
  source_mismatch_warning: string | null;
};

export type OriginalityReport = {
  id: string;
  transformative_value_score: number;
  creator_contribution_score: number;
  new_information_score: number;
  source_dependency_score: number;
  repetition_risk_score: number;
  copyright_risk_level: "low" | "medium" | "high" | "unknown";
  overall_status:
    | "ready_for_manual_review"
    | "revision_recommended"
    | "transformation_required";
  checks_json: Array<{ name: string; passed: boolean }>;
  warnings_json: string[];
  recommendations_json: string[];
};
