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
  needs_fact_verification: boolean;
  status: string;
  storyboard: Array<Record<string, unknown>>;
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
