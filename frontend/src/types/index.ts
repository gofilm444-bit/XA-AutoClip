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
  hook_text: string;
  hook_text_enabled: boolean;
  caption_mode: "short";
  caption_max_words: number;
  caption_max_chars: number;
  caption_style?: {
    preset: string;
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
    type: string;
    start: number;
    end: number;
    zoom?: number;
    text?: string;
    reason?: string;
  }>;
  audio_settings?: {
    volume: number;
    muted: boolean;
    fade_in: number;
    fade_out: number;
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
  }>;
  video_sequence?: Array<{
    id: string;
    source_start: number;
    source_end: number;
  }>;
  audio_sequence?: Array<{
    id: string;
    source_start: number;
    source_end: number;
  }>;
  audio_extracted?: boolean;
  video_track_deleted?: boolean;
  audio_track_deleted?: boolean;
  editor_state_version?: number;
  video_sequence_initialized?: boolean;
  audio_sequence_initialized?: boolean;
  caption_timeline_initialized?: boolean;
  effect_timeline_initialized?: boolean;
  layer_order?: Array<"caption" | "hook" | "keyword" | "punch" | "pattern" | "video" | "audio">;
  track_order?: Array<"caption" | "hook" | "keyword" | "punch" | "pattern" | "video" | "audio">;
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
  }>;
  audio_tracks?: Array<{
    id: string;
    asset_id: string;
    label: string;
    kind: "backsound" | "sfx";
    start: number;
    end: number;
    volume: number;
  }>;
  caption_timeline?: Array<{
    id: string;
    start: number;
    end: number;
    text: string;
  }>;
  render_preset?: "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture";
};

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
