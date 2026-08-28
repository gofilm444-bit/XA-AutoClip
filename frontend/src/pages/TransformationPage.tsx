import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, candidateVideoUrl, downloadUrl, mediaUrl, upload, uploadedAudioUrl, uploadMedia } from "../api/client";
import type { LayoutOutletContext } from "../components/Layout";
import type {
  EditorMediaAsset,
  OriginalityReport,
  Transformation,
  TransformationContext,
} from "../types";
import { projectCaptionCues } from "../utils/captionProjection";
import { sanitizeDownloadFilename } from "../utils/downloadFilename";
import {
  hasManualEditorTimelineVideo,
  initialEditorContext,
  isManualEditorTransformation,
} from "../utils/manualEditor";
import {
  resolveHookPreviewRenderState,
  resolveHookSafeArea,
} from "../utils/hookSafeArea";
import {
  TEXT_STYLE_PRESETS,
  getTextStylePreset,
  normalizeTextStylePreset,
  resolveHookTextStylePreset,
  resolveTextOverlayStyle,
  type TextStylePresetKey,
} from "../utils/textStylePresets";

type Render = {
  id: string;
  status: string;
  preset: string;
  subtitle_language: string;
  width: number;
  height: number;
  frame_rate: number;
  duration_seconds?: number;
  file_size_bytes?: number;
  error_message?: string;
  warning_message?: string;
  output_url?: string;
  progress?: number;
  progress_percent?: number;
};

type EffectTimelineEvent = {
  id?: string;
  type: "punch_zoom" | "keyword_popup" | string;
  start: number;
  end: number;
  zoom?: number;
  text?: string;
  title?: string;
  content?: string;
  effect?: string;
  reason?: string;
};

type EditorContext = "media" | "video" | "audio" | "caption" | "hook" | "keyword" | "effect" | "timeline" | "render";
type EditorMediaKind = "video" | "audio" | "image";

const editorMediaInputConfig: Record<
  EditorMediaKind,
  { accept: string; label: string }
> = {
  video: {
    accept: ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm",
    label: "Import Video",
  },
  audio: {
    accept: ".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4",
    label: "Import Audio",
  },
  image: {
    accept: ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp",
    label: "Import Gambar",
  },
};

export function EditorMediaImportControls({
  className = "grid grid-cols-1 gap-2 sm:grid-cols-3",
  disabled = false,
  onImport,
  uploadingKind = null,
}: {
  className?: string;
  disabled?: boolean;
  onImport: (kind: EditorMediaKind, file: File) => void | Promise<void>;
  uploadingKind?: EditorMediaKind | null;
}) {
  return (
    <div className={className}>
      {(Object.keys(editorMediaInputConfig) as EditorMediaKind[]).map((kind) => {
        const config = editorMediaInputConfig[kind];
        return (
          <label className="relative" key={kind}>
            <span
              className={`btn-secondary flex min-h-10 w-full cursor-pointer items-center justify-center px-3 py-2 text-center text-xs font-black ${
                disabled ? "pointer-events-none opacity-50" : ""
              }`}
            >
              {uploadingKind === kind ? "Mengimpor..." : `+ ${config.label}`}
            </span>
            <input
              accept={config.accept}
              aria-label={`+ ${config.label}`}
              className="sr-only"
              disabled={disabled}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void onImport(kind, file);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
        );
      })}
    </div>
  );
}

type AudioSettings = {
  volume: number;
  muted: boolean;
  fade_in: number;
  fade_out: number;
};

type VideoFraming = {
  x: number;
  y: number;
  scale: number;
};

const defaultVideoFraming: VideoFraming = { x: 0, y: 0, scale: 1 };

function normalizeVideoFraming(value: unknown): VideoFraming {
  const raw = value && typeof value === "object" ? (value as Partial<VideoFraming>) : {};
  const finiteOr = (candidate: unknown, fallback: number) => {
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  return {
    x: Math.max(-40, Math.min(40, finiteOr(raw.x, defaultVideoFraming.x))),
    y: Math.max(-40, Math.min(40, finiteOr(raw.y, defaultVideoFraming.y))),
    scale: Math.max(1, Math.min(2, finiteOr(raw.scale, defaultVideoFraming.scale))),
  };
}

type MediaTrim = {
  start: number;
  end: number;
};

type MediaSequenceSegment = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
};

type EditableCaptionCue = {
  id: string;
  start: number;
  end: number;
  text: string;
};

type CopiedTimedItem =
  | { kind: "caption"; item: EditableCaptionCue }
  | { kind: "effect"; item: EffectTimelineEvent };

type MediaResizePreview = {
  track: "video" | "audio";
  sequence: MediaSequenceSegment[];
  events: EffectTimelineEvent[];
};

type AdditionalAudioAsset = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number;
};

type AdditionalAudioTrack = {
  id: string;
  asset_id: string;
  label: string;
  kind: "backsound" | "sfx";
  start: number;
  end: number;
  volume: number;
};

type TimelineTrackKey = "caption" | "hook" | "keyword" | "video" | "audio" | "punch" | "pattern";
type VisualLayerTrack = "caption" | "hook" | "keyword" | "video";

const defaultTrackOrder: TimelineTrackKey[] = [
  "caption",
  "hook",
  "keyword",
  "video",
  "audio",
  "punch",
  "pattern",
];

const defaultVisualLayerOrder: VisualLayerTrack[] = ["caption", "hook", "keyword", "video"];

function normalizeOrderedTracks<T extends string>(value: unknown, defaults: readonly T[]): T[] {
  const configured = Array.isArray(value) ? value : [];
  const order = configured.filter(
    (track, index): track is T =>
      defaults.includes(track as T) && configured.indexOf(track) === index,
  );
  return [...order, ...defaults.filter((track) => !order.includes(track))];
}

function normalizeTrackOrder(value: unknown): TimelineTrackKey[] {
  return normalizeOrderedTracks(value, defaultTrackOrder);
}

function normalizeVisualLayerOrder(value: unknown): VisualLayerTrack[] {
  return normalizeOrderedTracks(value, defaultVisualLayerOrder);
}

type TimelineItem = {
  id: string;
  eventId?: string;
  editable?: boolean;
  selectable?: boolean;
  sourceStart?: number;
  sourceEnd?: number;
  type?: string;
  start: number;
  end: number;
  label: string;
  title: string;
  colorClass: string;
  active?: boolean;
};

type SourceMetadata = {
  url: string;
  title: string | null;
  description: string | null;
  creator: string | null;
  site_name: string | null;
  thumbnail_url: string | null;
  is_direct_media: boolean;
};

type HookTextResponse = {
  transformation_id: string;
  hook_text: string;
};

type RenderPreset =
  | "blurred_background"
  | "center_crop"
  | "fit_background"
  | "picture_in_picture";
type ExportResolution = "540" | "720" | "1080";
type ExportQuality = "standard" | "high" | "higher";
const EXPORT_LONG_RUNNING_MS = 5 * 60 * 1000;
type CaptionStylePreset =
  | "clean_white"
  | "tiktok_bold"
  | "box_caption"
  | "yellow_pop"
  | "minimal_lower_third"
  | "karaoke_preview";
type CaptionDisplayMode = "segment" | "karaoke" | "word_by_word";
type HookTextTemplate =
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
type HookTextPosition = "safe_top" | "top" | "upper_center";
type HookTextSize = "normal" | "large";
type HookTextFont =
  | "bold_sans"
  | "elegant_serif"
  | "modern_rounded"
  | "condensed_news"
  | "playful"
  | "clean_sans";
type HookTemplateDefinition = {
  value: HookTextTemplate;
  label: string;
  description: string;
  containerClass: string;
  textClass: string;
  widthClass: string;
  paddingClass: string;
  lineClampClass: string;
  badge?: string;
  badgeClass?: string;
  textShadow?: string;
};
type HookFontDefinition = {
  value: HookTextFont;
  label: string;
  description: string;
  fontFamily: string;
};
type CaptionStyleConfig = {
  preset: CaptionStylePreset;
  textPreset: TextStylePresetKey;
  displayMode: CaptionDisplayMode;
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
const MAX_CAPTION_WORDS = 5;
const DEFAULT_CAPTION_TARGET_WORDS = 4;

const presetOptions: Array<{ value: RenderPreset; label: string; description: string }> = [
  {
    value: "blurred_background",
    label: "Latar buram",
    description: "Video utuh dengan latar blur vertikal.",
  },
  {
    value: "center_crop",
    label: "Potong tengah",
    description: "Memenuhi frame 9:16 dengan crop fokus tengah.",
  },
  {
    value: "fit_background",
    label: "Video penuh",
    description: "Seluruh frame asli terlihat dengan mode contain.",
  },
  {
    value: "picture_in_picture",
    label: "Picture in picture",
    description: "Video tampil sebagai inset di atas latar.",
  },
];

const hookTextTemplates: HookTemplateDefinition[] = [
  {
    value: "capcut_clean",
    label: "CapCut Clean",
    description: "Teks modern tanpa box untuk penggunaan umum.",
    containerClass: "text-white",
    textClass: "font-bold",
    widthClass: "left-[11%] right-[11%]",
    paddingClass: "px-1 py-1",
    lineClampClass: "line-clamp-3",
    textShadow: "0 2px 4px rgba(0,0,0,0.9)",
  },
  {
    value: "neon_text",
    label: "Neon Text",
    description: "Cyan terang dengan glow tipis tanpa panel.",
    containerClass: "text-cyan-300",
    textClass: "font-bold",
    widthClass: "left-[12%] right-[12%]",
    paddingClass: "px-1 py-1",
    lineClampClass: "line-clamp-3",
    textShadow: "0 0 5px rgba(34,211,238,0.85), 0 2px 3px rgba(0,0,0,0.9)",
  },
  {
    value: "soft_gradient_text",
    label: "Soft Gradient Text",
    description: "Aksen warna lembut untuk konten kreatif.",
    containerClass: "text-white",
    textClass: "bg-gradient-to-r from-fuchsia-200 via-white to-cyan-200 bg-clip-text font-bold text-transparent",
    widthClass: "left-[11%] right-[11%]",
    paddingClass: "px-1 py-1",
    lineClampClass: "line-clamp-3",
  },
  {
    value: "minimal_white",
    label: "Minimal White",
    description: "Putih minimal dengan shadow sangat ringan.",
    containerClass: "text-white",
    textClass: "font-semibold",
    widthClass: "left-[13%] right-[13%]",
    paddingClass: "px-1 py-1",
    lineClampClass: "line-clamp-3",
    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
  },
  {
    value: "yellow_viral",
    label: "Yellow Viral",
    description: "Kuning cerah tanpa box untuk hook singkat.",
    containerClass: "text-yellow-300",
    textClass: "font-black",
    widthClass: "left-[12%] right-[12%]",
    paddingClass: "px-1 py-1",
    lineClampClass: "line-clamp-2",
    textShadow: "0 2px 3px rgba(0,0,0,0.95)",
  },
  {
    value: "elegant_modern",
    label: "Elegant Modern",
    description: "Teks lembut untuk tema formal dan premium.",
    containerClass: "text-rose-100",
    textClass: "font-semibold",
    widthClass: "left-[13%] right-[13%]",
    paddingClass: "px-1 py-1",
    lineClampClass: "line-clamp-3",
    textShadow: "0 2px 4px rgba(0,0,0,0.8)",
  },
  {
    value: "headline_bold",
    label: "Headline Bold",
    description: "Headline tebal tanpa box berat.",
    containerClass: "bg-black/25 text-white shadow-md",
    textClass: "font-black uppercase",
    widthClass: "left-[10%] right-[10%]",
    paddingClass: "px-3 py-2",
    lineClampClass: "line-clamp-3",
    textShadow: "0 2px 5px rgba(0,0,0,0.95)",
  },
  {
    value: "glass_card",
    label: "Glass Card",
    description: "Panel kaca ringan dan modern.",
    containerClass: "border border-white/30 bg-white/15 text-white shadow-lg backdrop-blur-md",
    textClass: "font-bold",
    widthClass: "left-[10%] right-[10%]",
    paddingClass: "px-3 py-2",
    lineClampClass: "line-clamp-3",
    textShadow: "0 2px 4px rgba(0,0,0,0.8)",
  },
  {
    value: "breaking_news",
    label: "Breaking News",
    description: "Merah tegas untuk informasi penting.",
    containerClass: "border-l-2 border-red-200 bg-red-700/95 text-white shadow-md",
    textClass: "font-black uppercase",
    widthClass: "left-[13%] right-[13%]",
    paddingClass: "px-2.5 py-1.5",
    lineClampClass: "line-clamp-2",
    badge: "BREAKING",
    badgeClass: "mb-0.5 text-[7px] leading-none tracking-wide opacity-85",
  },
  {
    value: "clean_top",
    label: "Clean Top",
    description: "Minimal, tenang, dan mudah dibaca.",
    containerClass: "bg-black/40 text-white shadow-md",
    textClass: "font-semibold",
    widthClass: "left-[12%] right-[12%]",
    paddingClass: "px-2.5 py-1.5",
    lineClampClass: "line-clamp-3",
  },
  {
    value: "highlight_box",
    label: "Highlight Box",
    description: "Box kuning untuk poin utama.",
    containerClass: "bg-yellow-300/95 text-slate-950 shadow-md",
    textClass: "font-black",
    widthClass: "left-[11%] right-[11%]",
    paddingClass: "px-3 py-2",
    lineClampClass: "line-clamp-3",
  },
];

const hookTextFonts: HookFontDefinition[] = [
  {
    value: "bold_sans",
    label: "Bold Sans",
    description: "Kuat untuk konten umum dan viral.",
    fontFamily: '"Arial Black", Arial, Helvetica, sans-serif',
  },
  {
    value: "elegant_serif",
    label: "Elegant Serif",
    description: "Formal, editorial, dan elegan.",
    fontFamily: 'Georgia, "Times New Roman", serif',
  },
  {
    value: "modern_rounded",
    label: "Modern Rounded",
    description: "Ramah dengan bentuk huruf modern.",
    fontFamily: '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif',
  },
  {
    value: "condensed_news",
    label: "Condensed News",
    description: "Padat untuk headline dan berita.",
    fontFamily: '"Arial Narrow", Impact, "Segoe UI", sans-serif',
  },
  {
    value: "playful",
    label: "Playful",
    description: "Santai untuk konten kreatif.",
    fontFamily: '"Segoe Print", "Comic Sans MS", "Trebuchet MS", cursive',
  },
  {
    value: "clean_sans",
    label: "Clean Sans",
    description: "Minimal dan mudah dibaca.",
    fontFamily: '"Segoe UI", Inter, Arial, sans-serif',
  },
];

function normalizeHookTextTemplate(value: unknown): HookTextTemplate {
  return hookTextTemplates.some((template) => template.value === value)
    ? (value as HookTextTemplate)
    : "capcut_clean";
}

function normalizeHookTextFont(value: unknown): HookTextFont {
  return hookTextFonts.some((font) => font.value === value)
    ? (value as HookTextFont)
    : "clean_sans";
}

function hookOverlayTextSizeClass(
  text: string,
  requestedSize: HookTextSize,
  template: HookTextTemplate,
) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const characterCount = text.trim().length;
  const isLong = characterCount > 52 || wordCount > 10;
  const isMedium = characterCount > 36 || wordCount > 7;

  if (template === "breaking_news") {
    if (isLong) return "text-[10px] md:text-xs";
    if (isMedium) return "text-xs md:text-sm";
    return requestedSize === "large" ? "text-sm md:text-base" : "text-xs md:text-sm";
  }
  if (isLong) return "text-xs md:text-sm";
  if (isMedium) return "text-sm md:text-base";
  return requestedSize === "large" ? "text-base md:text-lg" : "text-sm md:text-base";
}

const defaultAudioSettings: AudioSettings = {
  volume: 1,
  muted: false,
  fade_in: 0,
  fade_out: 0,
};

function normalizeAudioSettings(value: Partial<AudioSettings> | undefined): AudioSettings {
  return {
    volume: Math.max(0, Math.min(2, Number(value?.volume ?? defaultAudioSettings.volume))),
    muted: Boolean(value?.muted ?? defaultAudioSettings.muted),
    fade_in: Math.max(0, Math.min(5, Number(value?.fade_in ?? defaultAudioSettings.fade_in))),
    fade_out: Math.max(0, Math.min(5, Number(value?.fade_out ?? defaultAudioSettings.fade_out))),
  };
}

function normalizeMediaTrim(
  value: { start?: number; end?: number | null } | undefined,
  duration: number,
): MediaTrim {
  const safeDuration = Math.max(0.1, Number(duration) || 0.1);
  const start = Math.min(
    Math.max(0, Number(value?.start) || 0),
    Math.max(0, safeDuration - 0.1),
  );
  const requestedEnd = value?.end == null ? safeDuration : Number(value.end);
  const end = Math.min(
    safeDuration,
    Math.max(start + 0.1, Number.isFinite(requestedEnd) ? requestedEnd : safeDuration),
  );
  return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)) };
}

function normalizeMediaSequence(value: unknown, duration: number): MediaSequenceSegment[] {
  if (!Array.isArray(value)) return [];
  const safeDuration = Math.max(0.1, Number(duration) || 0.1);
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const sourceStart = Math.max(0, Number((entry as Record<string, unknown>).source_start));
      const sourceEnd = Math.min(safeDuration, Number((entry as Record<string, unknown>).source_end));
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd - sourceStart < 0.1) {
        return null;
      }
      return {
        id: String((entry as Record<string, unknown>).id || `media-${index}`),
        sourceStart: Number(sourceStart.toFixed(3)),
        sourceEnd: Number(sourceEnd.toFixed(3)),
      };
    })
    .filter((segment): segment is MediaSequenceSegment => Boolean(segment));
}

const renderPresetValues = presetOptions.map((item) => item.value);

const captionStylePresets: Array<{
  value: CaptionStylePreset;
  label: string;
  description: string;
  config: CaptionStyleConfig;
}> = [
  {
    value: "clean_white",
    label: "Clean White",
    description: "Putih rapi untuk podcast.",
    config: {
      preset: "clean_white",
      textPreset: "default",
      displayMode: "segment",
      fontSize: "medium",
      fontWeight: "semibold",
      position: "center_lower",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: false,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: DEFAULT_CAPTION_TARGET_WORDS,
      maxChars: 45,
      karaokeEnabled: false,
    },
  },
  {
    value: "tiktok_bold",
    label: "TikTok Bold",
    description: "Tebal dan kuat.",
    config: {
      preset: "tiktok_bold",
      textPreset: "default",
      displayMode: "segment",
      fontSize: "large",
      fontWeight: "bold",
      position: "center_lower",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: DEFAULT_CAPTION_TARGET_WORDS,
      maxChars: 45,
      karaokeEnabled: false,
    },
  },
  {
    value: "box_caption",
    label: "Box Caption",
    description: "Box aman untuk visual ramai.",
    config: {
      preset: "box_caption",
      textPreset: "default",
      displayMode: "segment",
      fontSize: "medium",
      fontWeight: "semibold",
      position: "center_lower",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: false,
      shadowEnabled: false,
      backgroundEnabled: true,
      backgroundOpacity: 0.62,
      maxWords: DEFAULT_CAPTION_TARGET_WORDS,
      maxChars: 45,
      karaokeEnabled: false,
    },
  },
  {
    value: "yellow_pop",
    label: "Yellow Pop",
    description: "Kuning ekspresif.",
    config: {
      preset: "yellow_pop",
      textPreset: "default",
      displayMode: "segment",
      fontSize: "large",
      fontWeight: "bold",
      position: "center_lower",
      textColor: "#FFD400",
      highlightColor: "#FFFFFF",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: DEFAULT_CAPTION_TARGET_WORDS,
      maxChars: 45,
      karaokeEnabled: false,
    },
  },
  {
    value: "minimal_lower_third",
    label: "Minimal Lower Third",
    description: "Kecil dan tidak dominan.",
    config: {
      preset: "minimal_lower_third",
      textPreset: "default",
      displayMode: "segment",
      fontSize: "small",
      fontWeight: "normal",
      position: "center_lower",
      textColor: "#F8FAFC",
      highlightColor: "#CBD5E1",
      outlineEnabled: false,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.45,
      maxWords: DEFAULT_CAPTION_TARGET_WORDS,
      maxChars: 45,
      karaokeEnabled: false,
    },
  },
  {
    value: "karaoke_preview",
    label: "Karaoke Preview",
    description: "Highlight kata simulasi.",
    config: {
      preset: "karaoke_preview",
      textPreset: "default",
      displayMode: "karaoke",
      fontSize: "medium",
      fontWeight: "bold",
      position: "center_lower",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: DEFAULT_CAPTION_TARGET_WORDS,
      maxChars: 45,
      karaokeEnabled: true,
    },
  },
];
const defaultCaptionStyle = captionStylePresets[0].config;

function isRenderPreset(value: unknown): value is RenderPreset {
  return typeof value === "string" && renderPresetValues.includes(value as RenderPreset);
}

const stylePresets = [
  { value: "clean_podcast", label: "Clean Podcast" },
  { value: "viral_shorts", label: "Viral Shorts" },
  { value: "story_drama", label: "Story / Drama" },
  { value: "education_explainer", label: "Edukasi / Explainer" },
  { value: "meme_comedy", label: "Meme / Comedy" },
  { value: "custom", label: "Custom" },
] as const;

const styleDefaults = {
  clean_podcast: {
    clipper_style_preset: "clean_podcast",
    hook_text: "",
    hook_text_enabled: false,
    caption_mode: "short",
    caption_max_words: 8,
    caption_max_chars: 45,
    punch_zoom_enabled: true,
    pattern_interrupt_enabled: false,
    keyword_popup_enabled: false,
    style_intensity: "low",
  },
  viral_shorts: {
    clipper_style_preset: "viral_shorts",
    hook_text: "",
    hook_text_enabled: true,
    caption_mode: "short",
    caption_max_words: 8,
    caption_max_chars: 45,
    punch_zoom_enabled: true,
    pattern_interrupt_enabled: true,
    keyword_popup_enabled: true,
    style_intensity: "medium",
  },
  story_drama: {
    clipper_style_preset: "story_drama",
    hook_text: "",
    hook_text_enabled: true,
    caption_mode: "short",
    caption_max_words: 8,
    caption_max_chars: 45,
    punch_zoom_enabled: true,
    pattern_interrupt_enabled: true,
    keyword_popup_enabled: true,
    style_intensity: "medium",
  },
  education_explainer: {
    clipper_style_preset: "education_explainer",
    hook_text: "",
    hook_text_enabled: false,
    caption_mode: "short",
    caption_max_words: 8,
    caption_max_chars: 45,
    punch_zoom_enabled: true,
    pattern_interrupt_enabled: false,
    keyword_popup_enabled: true,
    style_intensity: "low",
  },
  meme_comedy: {
    clipper_style_preset: "meme_comedy",
    hook_text: "",
    hook_text_enabled: false,
    caption_mode: "short",
    caption_max_words: 8,
    caption_max_chars: 45,
    punch_zoom_enabled: true,
    pattern_interrupt_enabled: true,
    keyword_popup_enabled: true,
    style_intensity: "high",
  },
  custom: {
    clipper_style_preset: "custom",
    hook_text: "",
    hook_text_enabled: false,
    caption_mode: "short",
    caption_max_words: 8,
    caption_max_chars: 45,
    punch_zoom_enabled: true,
    pattern_interrupt_enabled: false,
    keyword_popup_enabled: false,
    style_intensity: "low",
  },
} as const;

const renderStatusLabels: Record<string, string> = {
  queued: "Menunggu antrean",
  running: "Mengekspor video",
  completed: "File siap diunduh",
  failed: "Export gagal",
  superseded: "Perlu diekspor ulang",
};

const keywordStopwords = new Set([
  "saya",
  "aku",
  "kamu",
  "dia",
  "kita",
  "kami",
  "mereka",
  "ini",
  "itu",
  "yang",
  "dan",
  "di",
  "ke",
  "dari",
  "untuk",
  "dengan",
  "karena",
  "tapi",
  "kalau",
  "lah",
  "kan",
  "tuh",
  "ya",
  "iya",
  "nggak",
  "tidak",
  "ada",
  "jadi",
  "cuma",
  "hanya",
  "bisa",
  "punya",
  "lagi",
  "begitu",
  "memang",
  "sebelum",
  "setelah",
  "sebagai",
  "dalam",
  "pada",
  "atau",
  "juga",
  "sudah",
  "belum",
  "akan",
  "mau",
  "sama",
]);

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatTimeLabel(value: number) {
  const safe = Math.max(0, value || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatTimePrecise(value: number) {
  return `${formatTimeLabel(value)}.${Math.floor((Math.max(0, value) % 1) * 10)}`;
}

function eventLeft(start: number, duration: number) {
  return `${Math.min(100, Math.max(0, (start / Math.max(1, duration)) * 100))}%`;
}

function eventWidth(start: number, end: number, duration: number) {
  return `${Math.max(0.7, Math.min(100, ((end - start) / Math.max(1, duration)) * 100))}%`;
}

function eventDurationBounds(type: string) {
  if (type === "keyword_popup") return { min: 0.6, max: 3 };
  if (type === "hook_text") return { min: 1, max: 5 };
  if (type === "pattern_interrupt") return { min: 0.4, max: 2 };
  return { min: 0.4, max: 2 };
}

function editableEventId(event: EffectTimelineEvent, index: number) {
  return event.id || `${event.type}-${event.start.toFixed(2)}-${event.end.toFixed(2)}-${index}`;
}

function contextFromEventType(type?: string): EditorContext {
  if (type === "video") return "video";
  if (type === "audio" || type === "additional_audio") return "audio";
  if (type === "caption") return "caption";
  if (type === "hook_text") return "hook";
  if (type === "keyword_popup") return "keyword";
  if (type === "punch_zoom" || type === "pattern_interrupt") return "effect";
  return "timeline";
}

function newEventId() {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeKeywordInput(text: string) {
  const words = (text.toUpperCase().match(/[\p{L}\p{N},.]+/gu) || [])
    .map((word) => word.replace(/^[,.]+|[,.]+$/g, ""))
    .filter(Boolean)
    .slice(0, 4);
  return words.join(" ");
}

function isValidKeyword(text: string) {
  const clean = sanitizeKeywordInput(text);
  if (!clean) return false;
  const words = clean.toLowerCase().split(/\s+/);
  if (words.length === 1 && keywordStopwords.has(words[0])) return false;
  return words.some((word) => word.length >= 3 || /\d/.test(word));
}

function getCaptionPreviewText(text: string) {
  const cleaned = text
    .replace(/^\[\d{2}:\d{2}\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function normalizeCaptionStyleConfig(value: unknown): CaptionStyleConfig {
  const raw = value && typeof value === "object" ? (value as Partial<CaptionStyleConfig>) : {};
  const preset: CaptionStylePreset = captionStylePresets.some((item) => item.value === raw.preset)
    ? (raw.preset as CaptionStylePreset)
    : defaultCaptionStyle.preset;
  const presetConfig =
    captionStylePresets.find((item) => item.value === preset)?.config || defaultCaptionStyle;
  const fontSize: CaptionStyleConfig["fontSize"] = ["small", "medium", "large"].includes(String(raw.fontSize))
    ? (raw.fontSize as CaptionStyleConfig["fontSize"])
    : presetConfig.fontSize;
  const fontWeight: CaptionStyleConfig["fontWeight"] = ["normal", "semibold", "bold"].includes(String(raw.fontWeight))
    ? (raw.fontWeight as CaptionStyleConfig["fontWeight"])
    : presetConfig.fontWeight;
  const position: CaptionStyleConfig["position"] = ["bottom", "center_lower", "center", "top"].includes(String(raw.position))
    ? (raw.position as CaptionStyleConfig["position"])
    : presetConfig.position;
  const displayMode: CaptionDisplayMode = ["segment", "karaoke", "word_by_word"].includes(
    String(raw.displayMode),
  )
    ? (raw.displayMode as CaptionDisplayMode)
    : raw.karaokeEnabled
      ? "karaoke"
      : presetConfig.displayMode;
  return {
    ...presetConfig,
    ...raw,
    preset,
    textPreset: normalizeTextStylePreset(raw.textPreset),
    displayMode,
    fontSize,
    fontWeight,
    position,
    textColor: /^#[0-9a-f]{6}$/i.test(String(raw.textColor || ""))
      ? String(raw.textColor)
      : presetConfig.textColor,
    highlightColor: /^#[0-9a-f]{6}$/i.test(String(raw.highlightColor || ""))
      ? String(raw.highlightColor)
      : presetConfig.highlightColor,
    outlineEnabled: Boolean(raw.outlineEnabled ?? presetConfig.outlineEnabled),
    shadowEnabled: Boolean(raw.shadowEnabled ?? presetConfig.shadowEnabled),
    backgroundEnabled: Boolean(raw.backgroundEnabled ?? presetConfig.backgroundEnabled),
    backgroundOpacity: Math.max(
      0,
      Math.min(0.85, Number(raw.backgroundOpacity ?? presetConfig.backgroundOpacity)),
    ),
    maxWords: Math.max(
      3,
      Math.min(MAX_CAPTION_WORDS, Number(raw.maxWords || presetConfig.maxWords)),
    ),
    maxChars: Math.max(10, Math.min(45, Number(raw.maxChars || presetConfig.maxChars))),
    karaokeEnabled: displayMode === "karaoke",
  };
}

function captionPositionClass(position: CaptionStyleConfig["position"]) {
  if (position === "top") return "top-[10%]";
  if (position === "center") return "top-1/2 -translate-y-1/2";
  if (position === "center_lower") return "bottom-[16%]";
  return "bottom-[10%]";
}

function captionSizeClass(
  fontSize: CaptionStyleConfig["fontSize"],
  preset?: CaptionStylePreset,
  wordCount = 0,
) {
  if (wordCount > 12) return "text-[10px] md:text-xs";
  if (wordCount > 8) return "text-xs md:text-sm";
  if (wordCount > MAX_CAPTION_WORDS) return "text-sm";
  if (preset === "tiktok_bold") return "text-base md:text-lg";
  if (preset === "yellow_pop") return "text-base md:text-lg";
  if (fontSize === "large") return "text-base md:text-lg";
  if (fontSize === "small") return "text-xs md:text-sm";
  return "text-sm md:text-base";
}

function captionWeightClass(fontWeight: CaptionStyleConfig["fontWeight"]) {
  if (fontWeight === "bold") return "font-black";
  if (fontWeight === "semibold") return "font-bold";
  return "font-semibold";
}

function captionTextShadow(style: CaptionStyleConfig) {
  if (style.preset === "tiktok_bold") {
    return "-1.25px -1.25px 0 #000, 1.25px -1.25px 0 #000, -1.25px 1.25px 0 #000, 1.25px 1.25px 0 #000, 0 3px 8px rgba(0,0,0,0.72)";
  }
  if (style.preset === "yellow_pop") {
    return "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 3px 8px rgba(0,0,0,0.68)";
  }
  return [
    style.outlineEnabled
      ? "0 1px 2px #000, 1px 0 1px #000, -1px 0 1px #000, 0 -1px 1px #000"
      : "",
    style.shadowEnabled ? "0 4px 10px rgba(0,0,0,0.55)" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function activeCaptionCue(
  cues: Array<{ id?: string; start: number; end: number; text: string }>,
  currentTime: number,
) {
  const boundaryTolerance = 0.04;
  return cues.reduce<(typeof cues)[number] | undefined>((active, cue) => {
    const inRange =
      currentTime >= cue.start - boundaryTolerance &&
      currentTime < cue.end + boundaryTolerance;
    if (!inRange) return active;
    if (!active || cue.start > active.start) return cue;
    return active;
  }, undefined);
}

function captionWords(text: string) {
  return String(text || "").trim().match(/\S+/g) || [];
}

function uniqueCaptionPartId(baseId: string, partNumber: number, usedIds: Set<string>) {
  const base = `${baseId}-part-${partNumber}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function reflowCaptionCue(
  cue: EditableCaptionCue,
  usedIds: Set<string>,
  maxWords = DEFAULT_CAPTION_TARGET_WORDS,
) {
  const words = captionWords(cue.text);
  if (words.length <= maxWords) {
    usedIds.add(cue.id);
    return [{ ...cue }];
  }

  const chunks: string[][] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords));
  }
  const duration = Math.max(0, cue.end - cue.start);
  let consumedWords = 0;
  return chunks.map((chunk, index) => {
    const chunkStart = cue.start + duration * (consumedWords / words.length);
    consumedWords += chunk.length;
    const chunkEnd = index === chunks.length - 1
      ? cue.end
      : cue.start + duration * (consumedWords / words.length);
    const id = index === 0
      ? cue.id
      : uniqueCaptionPartId(cue.id, index + 1, usedIds);
    usedIds.add(id);
    return {
      ...cue,
      id,
      start: Number(chunkStart.toFixed(3)),
      end: Number(chunkEnd.toFixed(3)),
      text: chunk.join(" "),
    };
  });
}

function safeHookPreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 70);
}

function previewKeywords(...texts: string[]) {
  const counts = new Map<string, number>();
  texts.join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.forEach((word) => {
    if (word.length >= 4 && !keywordStopwords.has(word)) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([word]) => word.toUpperCase());
}

function activeTimelineEvent(
  events: EffectTimelineEvent[],
  type: string,
  currentTime: number,
  isPlaying: boolean,
) {
  if (!isPlaying) return undefined;
  return events.find(
    (event) =>
      event.type === type &&
      Number.isFinite(event.start) &&
      Number.isFinite(event.end) &&
      currentTime >= event.start &&
      currentTime <= event.end,
  );
}

function defaultEffectStarts(duration: number) {
  return [3, 12, 24, 38, 52].filter((start) => start < Math.max(0.5, duration - 0.5));
}

function liveEffectTimeline(
  styleConfig: Record<string, unknown>,
  duration: number,
  keywords: string[],
): EffectTimelineEvent[] {
  const configured = Array.isArray(styleConfig.effect_timeline)
    ? (styleConfig.effect_timeline as EffectTimelineEvent[])
    : [];
  if (configured.length || Number(styleConfig.editor_state_version || 0) >= 1) return configured;
  const starts = defaultEffectStarts(duration);
  const events: EffectTimelineEvent[] = [];
  if (styleConfig.punch_zoom_enabled) {
    const intensity = String(styleConfig.style_intensity || "low");
    const zoom = intensity === "high" ? 1.14 : intensity === "medium" ? 1.1 : 1.05;
    starts.slice(0, intensity === "high" ? 5 : 3).forEach((start) => {
      events.push({
        type: "punch_zoom",
        start,
        end: Math.min(duration, start + 1.2),
        zoom,
        reason: "interval aman",
      });
    });
  }
  if (styleConfig.keyword_popup_enabled) {
    keywords.slice(0, 3).forEach((keyword, index) => {
      const start = starts[index] || 5 + index * 12;
      events.push({
        type: "keyword_popup",
        start,
        end: Math.min(duration, start + 1.2),
        text: keyword,
        reason: "keyword preview",
      });
    });
  }
  return events;
}

function hookWordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function renderLabel(render?: Render, renderedPreviewAvailable = false) {
  if (!render) return "Preview Editor";
  if (render.status === "completed" && renderedPreviewAvailable) {
    return render.width >= 1000 ? "File HD siap" : "File draft siap";
  }
  if (render.status === "failed") return "Export gagal";
  return renderStatusLabels[render.status] || render.status;
}

function ToolSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-700 bg-[#25282d] p-3 shadow-sm shadow-black/20">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-zinc-400">
        {title}
      </h3>
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </section>
  );
}

function AccordionSection({
  children,
  id,
  isOpen,
  onToggle,
  summary,
  title,
}: {
  children: ReactNode;
  id: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  summary?: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-700 bg-[#25282d]">
      <button
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
        onClick={() => onToggle(id)}
        type="button"
      >
        <div className="min-w-0">
          <p className="text-sm font-black text-zinc-100">{title}</p>
          {summary && (
            <div className="mt-1 truncate text-xs font-semibold text-zinc-500">{summary}</div>
          )}
        </div>
        <span className="shrink-0 rounded bg-zinc-800 px-2 py-1 text-[10px] font-black text-zinc-400">
          {isOpen ? "Sembunyikan" : "Lihat"}
        </span>
      </button>
      {isOpen && <div className="border-t border-zinc-700 bg-[#1d1f23] p-3">{children}</div>}
    </section>
  );
}

function TimelineTrack({
  label,
  items,
  duration,
  playheadPercent,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onItemPointerDown,
  onItemPointerMove,
  onItemPointerUp,
  onItemClick,
  onItemContextMenu,
  onItemResizePointerDown,
  onItemResizePointerMove,
  onItemResizePointerUp,
  resizable = false,
  selectedItemId,
  selected = false,
  emptyText = "Tidak ada event",
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  order,
}: {
  label: string;
  items: TimelineItem[];
  duration: number;
  playheadPercent?: number;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onItemPointerDown?: (
    event: ReactPointerEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  onItemPointerMove?: (
    event: ReactPointerEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  onItemPointerUp?: (
    event: ReactPointerEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  onItemClick?: (item: TimelineItem) => void;
  onItemContextMenu?: (
    event: ReactMouseEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => void;
  onItemResizePointerDown?: (
    event: ReactPointerEvent<HTMLSpanElement>,
    item: TimelineItem,
    edge: "left" | "right",
  ) => void;
  onItemResizePointerMove?: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  onItemResizePointerUp?: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  resizable?: boolean;
  selectedItemId?: string | null;
  selected?: boolean;
  emptyText?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  order?: number;
}) {
  return (
    <div
      className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3"
      style={typeof order === "number" ? { order } : undefined}
    >
      <div className={`flex min-w-0 items-center gap-1 text-xs font-black uppercase tracking-wide ${
        selected ? "text-cyan-300" : "text-zinc-500"
      }`}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {onMoveUp && (
          <button
            aria-label={`Naikkan track ${label}`}
            className="rounded px-1 text-[11px] text-zinc-400 hover:bg-zinc-700 hover:text-cyan-300 disabled:opacity-25"
            disabled={!canMoveUp}
            onClick={(event) => {
              event.stopPropagation();
              onMoveUp();
            }}
            title="Naik"
            type="button"
          >
            ↑
          </button>
        )}
        {onMoveDown && (
          <button
            aria-label={`Turunkan track ${label}`}
            className="rounded px-1 text-[11px] text-zinc-400 hover:bg-zinc-700 hover:text-cyan-300 disabled:opacity-25"
            disabled={!canMoveDown}
            onClick={(event) => {
              event.stopPropagation();
              onMoveDown();
            }}
            title="Turun"
            type="button"
          >
            ↓
          </button>
        )}
      </div>
      <div
        className={`relative h-8 touch-none overflow-hidden rounded-md border bg-[#22252a] ${
          selected ? "border-cyan-400 ring-1 ring-cyan-400/40" : "border-zinc-700"
        }`}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {typeof playheadPercent === "number" && (
          <span
            className="timeline-playhead-line absolute bottom-0 top-0 z-10 w-px bg-white/80"
            style={{ left: `${playheadPercent}%` }}
          />
        )}
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className={`absolute top-1/2 h-4 -translate-y-1/2 rounded-md px-2 text-[10px] font-black leading-4 shadow-sm ${
                item.id === selectedItemId || item.eventId === selectedItemId
                  ? "z-20 ring-2 ring-cyan-300 ring-offset-1 ring-offset-[#22252a]"
                  : item.active
                    ? "ring-1 ring-white ring-offset-1 ring-offset-[#22252a]"
                    : ""
              } ${item.editable ? "cursor-move" : item.selectable ? "cursor-pointer" : ""} ${item.colorClass}`}
              style={{
                left: eventLeft(item.start, duration),
                width: eventWidth(item.start, item.end, duration),
              }}
              onClick={(event) => {
                if (!item.editable && !item.selectable) return;
                event.stopPropagation();
                onItemClick?.(item);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onItemContextMenu?.(event, item);
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  event.stopPropagation();
                  return;
                }
                if (!item.editable) {
                  if (item.selectable) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                  return;
                }
                event.stopPropagation();
                onItemPointerDown?.(event, item);
              }}
              onPointerMove={(event) => {
                if (!item.editable) return;
                event.stopPropagation();
                onItemPointerMove?.(event, item);
              }}
              onPointerUp={(event) => {
                if (!item.editable) return;
                event.stopPropagation();
                onItemPointerUp?.(event, item);
              }}
              title={item.title}
            >
              <span className="block truncate">{item.label}</span>
              {resizable && (item.id === selectedItemId || item.eventId === selectedItemId) && (
                <>
                  <span
                    aria-label="Tarik ujung kiri track"
                    className="absolute -left-0.5 top-0 z-20 h-full w-2 cursor-ew-resize rounded-l bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                    onPointerDown={(event) => onItemResizePointerDown?.(event, item, "left")}
                    onPointerMove={onItemResizePointerMove}
                    onPointerUp={onItemResizePointerUp}
                    onPointerCancel={onItemResizePointerUp}
                    title="Tarik untuk mengubah awal bagian"
                  />
                  <span
                    aria-label="Tarik ujung kanan track"
                    className="absolute -right-0.5 top-0 z-20 h-full w-2 cursor-ew-resize rounded-r bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                    onPointerDown={(event) => onItemResizePointerDown?.(event, item, "right")}
                    onPointerMove={onItemResizePointerMove}
                    onPointerUp={onItemResizePointerUp}
                    onPointerCancel={onItemResizePointerUp}
                    title="Tarik untuk mengubah akhir bagian"
                  />
                </>
              )}
            </div>
          ))
        ) : (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-600">
            {emptyText}
          </span>
        )}
      </div>
    </div>
  );
}

function PresetVideo({
  src,
  preset,
  framing = defaultVideoFraming,
  controls = false,
  audioMuted = false,
  audioVolume = 1,
  className = "",
  videoRef,
  onPlay,
  onPause,
  onTimeUpdate,
  onLoadedMetadata,
  onSeeked,
}: {
  src: string;
  preset: RenderPreset;
  framing?: VideoFraming;
  controls?: boolean;
  audioMuted?: boolean;
  audioVolume?: number;
  className?: string;
  videoRef?: Ref<HTMLVideoElement>;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (currentTime: number) => void;
  onSeeked?: (currentTime: number) => void;
}) {
  const safeFraming = normalizeVideoFraming(framing);
  const cropFocusX = 50 - safeFraming.x;
  const cropFocusY = 50 - safeFraming.y;
  const centerCropFramingStyle: CSSProperties = {
    objectPosition: `${cropFocusX}% ${cropFocusY}%`,
    transform: `scale(${safeFraming.scale})`,
    transformOrigin: `${cropFocusX}% ${cropFocusY}%`,
    transition: "object-position 120ms ease-out, transform 120ms ease-out",
  };
  const containedForegroundFramingStyle: CSSProperties = {
    transform: `translate3d(${safeFraming.x}%, ${safeFraming.y}%, 0) scale(${safeFraming.scale})`,
    transformOrigin: "center center",
    transition: "transform 120ms ease-out",
  };
  const playbackProps = {
    onPlay,
    onPause,
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
      event.currentTarget.volume = Math.min(1, Math.max(0, audioVolume));
      onLoadedMetadata?.(event.currentTarget.currentTime);
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) =>
      onTimeUpdate?.(event.currentTarget.currentTime),
    onSeeked: (event: SyntheticEvent<HTMLVideoElement>) =>
      onSeeked?.(event.currentTarget.currentTime),
  };
  if (preset === "center_crop") {
    return (
      <video
        className={`h-full w-full object-cover ${className}`}
        controls={controls}
        muted={!controls || audioMuted}
        preload="metadata"
        ref={videoRef}
        src={src}
        style={centerCropFramingStyle}
        {...playbackProps}
      />
    );
  }
  if (preset === "fit_background") {
    return (
      <video
        className={`h-full w-full bg-black object-contain ${className}`}
        controls={controls}
        muted={!controls || audioMuted}
        preload="metadata"
        ref={videoRef}
        src={src}
        {...playbackProps}
      />
    );
  }
  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      <video
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-75"
        muted
        preload="metadata"
        src={src}
      />
      <video
        className={
          preset === "picture_in_picture"
            ? "absolute bottom-4 left-1/2 h-[46%] w-[82%] -translate-x-1/2 rounded-lg border-2 border-white/80 bg-black object-contain shadow-xl"
            : "relative h-full w-full object-contain"
        }
        controls={controls}
        muted={!controls || audioMuted}
        preload="metadata"
        ref={videoRef}
        src={src}
        style={preset === "blurred_background" ? containedForegroundFramingStyle : undefined}
        {...playbackProps}
      />
    </div>
  );
}

export function TransformationPage() {
  const { transformationId = "" } = useParams();
  const navigate = useNavigate();
  const layout = useOutletContext<LayoutOutletContext>();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Transformation>();
  const [report, setReport] = useState<OriginalityReport>();
  const [render, setRender] = useState<Render>();
  const [preset, setPreset] = useState<RenderPreset>("blurred_background");
  const subtitleLanguage = "id" as const;
  const [captionCopied, setCaptionCopied] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [openLeftSection, setOpenLeftSection] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [renderDirty, setRenderDirty] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [timelineHover, setTimelineHover] = useState<{
    percent: number;
    time: number;
  } | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem("autoclip-timeline-height"));
    return Number.isFinite(saved) && saved >= 220 ? saved : 320;
  });
  const [editorTheme, setEditorTheme] = useState<"dark" | "light">(() =>
    window.localStorage.getItem("autoclip-editor-theme") === "light" ? "light" : "dark",
  );
  const [editorMediaUploading, setEditorMediaUploading] = useState(false);
  const [editorMediaUploadKind, setEditorMediaUploadKind] = useState<
    "video" | "audio" | "image" | null
  >(null);
  const editorMediaQuery = useQuery({
    queryKey: ["editor-media", transformationId],
    queryFn: () => api<EditorMediaAsset[]>(`/api/transformations/${transformationId}/media`),
  });
  const [selectedEditorContext, setSelectedEditorContext] = useState<EditorContext>("video");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
  const [selectedMediaSegmentId, setSelectedMediaSegmentId] = useState<string | null>(null);
  const [selectedAdditionalAudioTrackId, setSelectedAdditionalAudioTrackId] = useState<string | null>(null);
  const [audioLibraryTab, setAudioLibraryTab] = useState<"music" | "sfx" | "uploads">("music");
  const [audioUploadProgress, setAudioUploadProgress] = useState(0);
  const [audioUploading, setAudioUploading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportResolution, setExportResolution] = useState<ExportResolution>("1080");
  const [exportQuality, setExportQuality] = useState<ExportQuality>("high");
  const [exportFrameRate, setExportFrameRate] = useState<"30" | "source">("30");
  const [exportFilename, setExportFilename] = useState("");
  const [exportAwaitingHd, setExportAwaitingHd] = useState(false);
  const [exportRenderId, setExportRenderId] = useState<string | null>(null);
  const [exportValidatedRenderId, setExportValidatedRenderId] = useState<string | null>(null);
  const [exportSubmissionStage, setExportSubmissionStage] = useState<"saving" | "preparing" | null>(null);
  const [exportWasClosedDuringTask, setExportWasClosedDuringTask] = useState(false);
  const [exportTaskObservation, setExportTaskObservation] = useState<{
    id: string;
    startedAt: number;
  } | null>(null);
  const [exportClock, setExportClock] = useState(() => Date.now());
  const [exportTechnicalOpen, setExportTechnicalOpen] = useState(false);
  const [copiedMediaSegment, setCopiedMediaSegment] = useState<MediaSequenceSegment | null>(null);
  const [copiedTimedItem, setCopiedTimedItem] = useState<CopiedTimedItem | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<{
    x: number;
    y: number;
    item: TimelineItem;
  } | null>(null);
  const [mediaResizePreview, setMediaResizePreview] = useState<MediaResizePreview | null>(null);
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [saveFailure, setSaveFailure] = useState(false);
  const [autosaveWakeRevision, setAutosaveWakeRevision] = useState(0);
  const [eventDrag, setEventDrag] = useState<{
    eventId: string;
    pointerId: number;
    startPointerTime: number;
    originalStart: number;
    originalEnd: number;
    trackLeft: number;
    trackWidth: number;
  } | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimeRef = useRef(0);
  const previewClockFrameRef = useRef<number | null>(null);
  const previewClockLastUpdateRef = useRef(0);
  const timelineDraggingRef = useRef(false);
  previewTimeRef.current = previewTime;
  const timelineResizeRef = useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);
  const mediaResizeRef = useRef<{
    pointerId: number;
    segmentIndex: number;
    track: "video" | "audio";
    edge: "left" | "right";
    trackLeft: number;
    trackWidth: number;
    sequence: MediaSequenceSegment[];
    events: EffectTimelineEvent[];
    duration: number;
    scaleDuration: number;
    preview?: MediaResizePreview;
  } | null>(null);
  const timedItemResizeRef = useRef<{
    pointerId: number;
    kind: "caption" | "effect";
    id: string;
    edge: "left" | "right";
    trackLeft: number;
    trackWidth: number;
  } | null>(null);
  const undoStackRef = useRef<Transformation[]>([]);
  const redoStackRef = useRef<Transformation[]>([]);
  const historyGroupRef = useRef<string | null>(null);
  const hydratedPreferencesRef = useRef<string | null>(null);
  const initializedManualContextRef = useRef<string | null>(null);
  const latestEditorSnapshotFingerprintRef = useRef("");
  const saveRequestSequenceRef = useRef(0);
  const latestSaveRequestIdRef = useRef(0);
  const saveInFlightRef = useRef(0);
  const [saveInFlightCount, setSaveInFlightCount] = useState(0);
  const [saveFailureMessage, setSaveFailureMessage] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);

  const cloneTransformation = (value: Transformation) => structuredClone(value);
  const recordEditorHistory = (
    snapshot: Transformation | undefined,
    group: string,
    force = false,
  ) => {
    if (!snapshot || (!force && historyGroupRef.current === group)) return;
    undoStackRef.current = [
      ...undoStackRef.current.slice(-99),
      cloneTransformation(snapshot),
    ];
    redoStackRef.current = [];
    historyGroupRef.current = group;
    setHistoryRevision((revision) => revision + 1);
  };
  const restoreHistorySnapshot = (snapshot: Transformation) => {
    setDraft(cloneTransformation(snapshot));
    if (isRenderPreset(snapshot.clipper_style_config?.render_preset)) {
      setPreset(snapshot.clipper_style_config.render_preset);
    }
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setSelectedEventId(null);
    setSelectedCaptionId(null);
    setSelectedMediaSegmentId(null);
    setSelectedAdditionalAudioTrackId(null);
    setMediaResizePreview(null);
    setTimelineError("");
    setPreviewTime(0);
  };
  const undoEditor = () => {
    if (!draft || !undoStackRef.current.length) return;
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(cloneTransformation(draft));
    historyGroupRef.current = null;
    restoreHistorySnapshot(previous);
    setHistoryRevision((revision) => revision + 1);
    setMessage("Perubahan terakhir dibatalkan.");
  };
  const redoEditor = () => {
    if (!draft || !redoStackRef.current.length) return;
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(cloneTransformation(draft));
    historyGroupRef.current = null;
    restoreHistorySnapshot(next);
    setHistoryRevision((revision) => revision + 1);
    setMessage("Perubahan diterapkan kembali.");
  };

  const plan = useQuery({
    queryKey: ["transformation", transformationId],
    queryFn: () => api<Transformation>(`/api/transformations/${transformationId}`),
  });
  const context = useQuery({
    queryKey: ["transformation-context", transformationId],
    queryFn: () =>
      api<TransformationContext>(`/api/transformations/${transformationId}/context`),
  });
  const existingReport = useQuery({
    queryKey: ["originality", transformationId],
    queryFn: () =>
      api<OriginalityReport>(
        `/api/transformations/${transformationId}/originality-report`,
      ),
    retry: false,
  });
  const latestRender = useQuery({
    queryKey: ["latest-render", transformationId],
    queryFn: () =>
      api<Render>(`/api/transformations/${transformationId}/latest-render`),
    retry: false,
  });

  useEffect(() => {
    if (plan.data) {
      setDraft(plan.data);
      if (
        initialEditorContext(plan.data) === "media" &&
        initializedManualContextRef.current !== plan.data.id
      ) {
        setSelectedEditorContext("media");
        initializedManualContextRef.current = plan.data.id;
      }
      if (isRenderPreset(plan.data.clipper_style_config?.render_preset)) {
        setPreset(plan.data.clipper_style_config.render_preset);
      }
      if (hydratedPreferencesRef.current !== plan.data.id) {
        const preferences = plan.data.clipper_style_config?.editor_preferences;
        if (preferences) {
          const savedHeight = Number(preferences.timeline_height);
          const savedZoom = Number(preferences.timeline_zoom);
          if (Number.isFinite(savedHeight)) {
            setTimelineHeight(
              Math.max(220, Math.min(savedHeight, Math.max(320, window.innerHeight - 280))),
            );
          }
          if (Number.isFinite(savedZoom)) {
            setTimelineZoom(Math.max(1, Math.min(4, savedZoom)));
          }
          if (preferences.theme === "dark" || preferences.theme === "light") {
            setEditorTheme(preferences.theme);
          }
        }
        hydratedPreferencesRef.current = plan.data.id;
      }
    }
  }, [plan.data]);
  useEffect(() => {
    if (
      !isRenderPreset(plan.data?.clipper_style_config?.render_preset) &&
      isRenderPreset(latestRender.data?.preset)
    ) {
      setPreset(latestRender.data.preset);
    }
  }, [latestRender.data, plan.data]);
  useEffect(() => {
    if (existingReport.data) setReport(existingReport.data);
  }, [existingReport.data]);
  useEffect(() => {
    if (context.data) {
      setUploadTitle(context.data.candidate_title);
      setSourceUrl(context.data.source_url || "");
    }
  }, [context.data]);
  const previewAudioSettings = normalizeAudioSettings(
    draft?.clipper_style_config?.audio_settings,
  );
  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.muted = previewAudioSettings.muted;
    audio.volume = previewAudioSettings.volume > 1 ? 1 : previewAudioSettings.volume;
  }, [previewAudioSettings.muted, previewAudioSettings.volume]);
  useEffect(() => {
    document.documentElement.dataset.editorTheme = editorTheme;
    window.localStorage.setItem("autoclip-editor-theme", editorTheme);
    return () => {
      delete document.documentElement.dataset.editorTheme;
    };
  }, [editorTheme]);
  useEffect(() => {
    window.localStorage.setItem("autoclip-timeline-height", String(Math.round(timelineHeight)));
  }, [timelineHeight]);
  useEffect(() => {
    if (!trackContextMenu) return;
    const closeContextMenu = () => setTrackContextMenu(null);
    const closeContextMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenuWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenuWithKeyboard);
    };
  }, [trackContextMenu]);
  useEffect(() => {
    const titleDirty = Boolean(
      context.data && uploadTitle.trim() !== context.data.candidate_title,
    );
    if (!editorDirty && !timelineDirty && !titleDirty) return;
    const warnUnsavedTimeline = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsavedTimeline);
    return () => window.removeEventListener("beforeunload", warnUnsavedTimeline);
  }, [context.data, editorDirty, timelineDirty, uploadTitle]);
  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    historyGroupRef.current = null;
    setHistoryRevision((revision) => revision + 1);
  }, [transformationId]);
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoEditor();
      } else if (key === "z") {
        event.preventDefault();
        undoEditor();
      } else if (key === "y") {
        event.preventDefault();
        redoEditor();
      }
    };
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  });

  function buildEditorStateSnapshot() {
    if (!draft) throw new Error("Data transformasi belum tersedia.");
    const roundTime = (value: number, fallback = 0) =>
      Number((Number.isFinite(value) ? value : fallback).toFixed(3));
    const serializeSequence = (sequence: MediaSequenceSegment[]) => sequence
      .filter(
        (segment) =>
          Number.isFinite(segment.sourceStart) &&
          Number.isFinite(segment.sourceEnd) &&
          segment.sourceEnd > segment.sourceStart,
      )
      .map((segment) => ({
        id: String(segment.id),
        source_start: roundTime(segment.sourceStart),
        source_end: roundTime(segment.sourceEnd),
      }));
    const serializedVideoSequence = serializeSequence(videoSequence);
    const serializedAudioSequence = audioExtracted ? serializeSequence(audioSequence) : [];
    const legacyMediaTrim = normalizeMediaTrim(
      draft.clipper_style_config?.media_trim,
      context.data?.clip_duration_seconds || 0.1,
    );

    // TODO: setiap fitur editor baru harus menambahkan field kanoniknya di snapshot ini.
    // Manual Save dan autosave memakai objek yang sama, sehingga tidak boleh membuat payload paralel.
    return {
      ...(draft.clipper_style_config || {}),
      editor_state_version: 1,
      video_sequence_initialized: true,
      audio_sequence_initialized: true,
      caption_timeline_initialized: true,
      effect_timeline_initialized: true,
      video_sequence: serializedVideoSequence,
      audio_sequence: serializedAudioSequence,
      media_sequence: serializedVideoSequence,
      media_trim: legacyMediaTrim,
      audio_extracted: audioExtracted,
      video_track_deleted: videoTrackDeleted || videoSequence.length === 0,
      audio_track_deleted: audioExtracted && (audioTrackDeleted || audioSequence.length === 0),
      video_framing: { ...videoFraming },
      caption_timeline: editableCaptionCues.map((cue) => ({
        id: String(cue.id),
        start: roundTime(cue.start),
        end: roundTime(cue.end, roundTime(cue.start) + 0.1),
        text: String(cue.text || ""),
      })),
      caption_style: captionStyle,
      caption_max_words: captionStyle.maxWords,
      caption_max_chars: captionStyle.maxChars,
      effect_timeline: editableEffectTimeline.map((event) => ({
        ...event,
        start: roundTime(event.start),
        end: roundTime(event.end, roundTime(event.start) + 0.1),
      })),
      layer_order: [...visualLayerOrder],
      track_order: [...trackOrder],
      audio_settings: audioSettings,
      additional_audio_assets: [...additionalAudioAssets],
      additional_audio_tracks: [...additionalAudioTracks],
      audio_tracks: [...additionalAudioTracks],
      editor_preferences: {
        timeline_height: Math.round(timelineHeight),
        timeline_zoom: timelineZoom,
        theme: editorTheme,
      },
    };
  }

  async function persistDraft(options: { saveTitle?: boolean } = {}) {
    if (!draft) throw new Error("Data transformasi belum tersedia.");
    const { saveTitle = true } = options;
    const persistedStyleConfig = buildEditorStateSnapshot();
    const snapshotFingerprint = JSON.stringify(persistedStyleConfig);
    const requestId = ++saveRequestSequenceRef.current;
    latestSaveRequestIdRef.current = requestId;
    saveInFlightRef.current += 1;
    setSaveInFlightCount(saveInFlightRef.current);
    setSaveFailure(false);
    setSaveFailureMessage("");

    try {
      if (saveTitle) {
        const cleanTitle = uploadTitle.trim();
        if (cleanTitle.length < 5) {
          throw new Error("Judul video minimal 5 karakter.");
        }
        const savedCandidate = await api<{ suggested_title: string }>(
          `/api/candidates/${draft.candidate_id}/title`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suggested_title: cleanTitle }),
          },
        );
        setUploadTitle(savedCandidate.suggested_title);
        client.setQueryData<TransformationContext>(
          ["transformation-context", transformationId],
          (current) =>
            current
              ? { ...current, candidate_title: savedCandidate.suggested_title }
              : current,
        );
      }

      const payload = {
        purpose: draft.purpose,
        audience: draft.audience,
        new_angle: draft.new_angle,
        original_hook: draft.original_hook,
        commentary_script: draft.commentary_script,
        conclusion: draft.conclusion,
        engagement_question: draft.engagement_question,
        social_caption: draft.social_caption,
        storyboard: draft.storyboard,
        clipper_style_config: persistedStyleConfig,
      };
      const saved = await api<Transformation>(
        `/api/transformations/${transformationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const isCurrent =
        latestSaveRequestIdRef.current === requestId &&
        latestEditorSnapshotFingerprintRef.current === snapshotFingerprint;
      if (isCurrent) {
        setSaveFailure(false);
        setSaveFailureMessage("");
        setDraft(saved);
        client.setQueryData(["transformation", transformationId], saved);
      }
      return { saved, isCurrent, requestId, snapshotFingerprint };
    } catch (saveError) {
      const rawMessage = saveError instanceof Error
        ? saveError.message
        : "Terjadi kesalahan yang tidak diketahui saat menyimpan editor.";
      const message = typeof rawMessage === "string" && rawMessage
        ? rawMessage
        : "Terjadi kesalahan yang tidak diketahui saat menyimpan editor.";
      const isCurrent =
        latestSaveRequestIdRef.current === requestId &&
        latestEditorSnapshotFingerprintRef.current === snapshotFingerprint;
      console.error("[XA AutoClip] Gagal menyimpan editor", {
        transformationId,
        requestId,
        saveTitle,
        isCurrent,
        message,
        error: saveError,
      });
      if (isCurrent) {
        setSaveFailure(true);
        setSaveFailureMessage(message);
      }
      throw saveError;
    } finally {
      saveInFlightRef.current = Math.max(0, saveInFlightRef.current - 1);
      setSaveInFlightCount(saveInFlightRef.current);
    }
  }

  const save = useMutation({
    mutationFn: () => persistDraft(),
    onSuccess: ({ isCurrent }) => {
      if (isCurrent) {
        setEditorDirty(false);
        setTimelineDirty(false);
        setMessage("Perubahan berhasil disimpan.");
      }
    },
  });
  const autosave = useMutation({
    mutationFn: () => persistDraft({ saveTitle: false }),
    onSuccess: ({ isCurrent }) => {
      if (isCurrent) {
        setEditorDirty(false);
        setTimelineDirty(false);
        setMessage("Perubahan tersimpan otomatis.");
      }
    },
  });
  const triggerAutosave = autosave.mutate;
  useEffect(() => {
    if (!draft || !context.data || (!editorDirty && !timelineDirty)) return undefined;
    if (saveInFlightCount > 0) return undefined;
    const timer = window.setTimeout(() => {
      const interactionActive = Boolean(
        eventDrag ||
        mediaResizePreview ||
        mediaResizeRef.current ||
        timedItemResizeRef.current ||
        timelineResizeRef.current ||
        timelineDraggingRef.current,
      );
      if (interactionActive) {
        setAutosaveWakeRevision((revision) => revision + 1);
        return;
      }
      triggerAutosave();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [
    autosave.isPending,
    autosaveWakeRevision,
    context.data,
    draft,
    editorDirty,
    editorTheme,
    eventDrag,
    mediaResizePreview,
    saveInFlightCount,
    timelineDirty,
    timelineHeight,
    timelineZoom,
    triggerAutosave,
  ]);
  const regenerate = useMutation({
    mutationFn: () =>
      api<Transformation>(
        `/api/transformations/${transformationId}/regenerate`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      setDraft(data);
      setReport(undefined);
      setRender(undefined);
      setMessage("Naskah AI berhasil dibuat ulang.");
      client.setQueryData(["transformation", transformationId], data);
    },
  });
  const regenerateCaption = useMutation({
    mutationFn: async () => {
      await persistDraft();
      return api<Transformation>(
        `/api/transformations/${transformationId}/caption`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      setDraft(data);
      setCaptionCopied(false);
      setMessage("Deskripsi berhasil dibuat ulang.");
    },
  });
  const regenerateHook = useMutation({
    mutationFn: async () => {
      await persistDraft();
      return api<HookTextResponse>(
        `/api/transformations/${transformationId}/regenerate-hook`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      setStyle("hook_text", data.hook_text);
      setRender(undefined);
      client.invalidateQueries({ queryKey: ["latest-render", transformationId] });
      setMessage("Hook video berhasil dibuat ulang.");
    },
  });
  const applySource = useMutation({
    mutationFn: async () => {
      const cleanUrl = sourceUrl.trim();
      if (!cleanUrl) throw new Error("Tempel link sumber terlebih dahulu.");
      await persistDraft();
      const metadata = await api<SourceMetadata>(
        `/api/transformations/${transformationId}/source-metadata`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanUrl }),
        },
      );
      const updated = await api<Transformation>(
        `/api/transformations/${transformationId}/caption`,
        { method: "POST" },
      );
      return { metadata, updated };
    },
    onSuccess: ({ metadata, updated }) => {
      const creator = metadata.creator || metadata.site_name;
      setSourceUrl(metadata.url);
      setDraft(updated);
      setCaptionCopied(false);
      client.setQueryData<TransformationContext>(
        ["transformation-context", transformationId],
        (current) =>
          current
            ? {
                ...current,
                source_url: metadata.url,
                source_title: metadata.title || current.source_title,
                source_creator: creator || current.source_creator,
              }
            : current,
      );
      setMessage(
        creator
          ? `Data sumber dari ${creator} berhasil diterapkan.`
          : "Data sumber berhasil diterapkan.",
      );
    },
  });
  const assess = useMutation({
    mutationFn: async () => {
      await persistDraft();
      return api<OriginalityReport>(
        `/api/transformations/${transformationId}/assess`,
        { method: "POST" },
      );
    },
    onSuccess: (data) => {
      setReport(data);
      setMessage("Penilaian selesai.");
    },
  });
  const queueRender = useMutation({
    mutationFn: async (preview: boolean) => {
      setExportRenderId(null);
      setExportValidatedRenderId(null);
      console.info("[XA AutoClip] export_ui_request", {
        transformationId,
        preview,
        preset,
        resolution: preview ? "540x960" : "1080x1920",
      });
      setExportSubmissionStage("saving");
      await persistDraft();
      setExportSubmissionStage("preparing");
      return api<Render>(
        `/api/transformations/${transformationId}/${preview ? "preview" : "render"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preset,
            subtitle_language: subtitleLanguage,
          }),
        },
      );
    },
    onSuccess: (data) => {
      setExportSubmissionStage(null);
      setRender(data);
      setExportRenderId(data.id);
      console.info("[XA AutoClip] export_ui_result", {
        render_id: data.id,
        status: data.status,
        render_download_url: data.output_url || null,
      });
      setEditorDirty(false);
      setRenderDirty(false);
      setTimelineDirty(false);
      setMessage(
        data.status === "completed"
          ? "Menggunakan hasil export tersimpan."
          : "Export masuk antrean.",
      );
    },
    onError: () => {
      setExportSubmissionStage(null);
      setExportAwaitingHd(false);
      setMessage("Export gagal.");
    },
  });
  const reprocess = useMutation({
    mutationFn: () =>
      api(`/api/projects/${draft?.project_id}/reprocess`, { method: "POST" }),
    onSuccess: () => navigate(`/projects/${draft?.project_id}`),
  });
  const monitoredRenderId = exportRenderId || render?.id || (
    latestRender.data && ["queued", "running"].includes(latestRender.data.status)
      ? latestRender.data.id
      : undefined
  );
  const renderStatus = useQuery({
    queryKey: ["render", monitoredRenderId],
    queryFn: () => api<Render>(`/api/renders/${monitoredRenderId}`),
    enabled: Boolean(monitoredRenderId),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status || "")
        ? 1500
        : false,
    refetchIntervalInBackground: true,
  });
  const renderStatusData = renderStatus.data;
  useEffect(() => {
    if (!renderStatusData || renderStatusData.id !== exportRenderId) return;
    console.info("[XA AutoClip] render_status_poll", {
      render_id: renderStatusData.id,
      status: renderStatusData.status,
      render_download_url: renderStatusData.output_url || null,
    });
  }, [exportRenderId, renderStatusData]);
  useEffect(() => {
    const current = exportRenderId
      ? renderStatusData?.id === exportRenderId
        ? renderStatusData
        : render?.id === exportRenderId
          ? render
          : undefined
      : undefined;
    if (!current) return;
    if (current.status === "completed") {
      if (exportAwaitingHd && current.width < 1000 && !queueRender.isPending) {
        setExportAwaitingHd(false);
        setExportValidatedRenderId(null);
        setMessage("Mengekspor video...");
        queueRender.mutate(false);
        return;
      }
      const matchesRequestedResolution = exportResolution === "540" || current.width >= 1000;
      if (!matchesRequestedResolution || exportValidatedRenderId === current.id) {
        if (exportValidatedRenderId === current.id) setMessage("File siap diunduh.");
        return;
      }
      setMessage("Memvalidasi file...");
      const validationTimer = window.setTimeout(() => {
        setExportValidatedRenderId(current.id);
        setMessage(
          current.warning_message
            ? "File siap diunduh. Beberapa efek dilewati dalam mode aman."
            : "File siap diunduh.",
        );
      }, 700);
      return () => window.clearTimeout(validationTimer);
    }
    if (current.status === "failed") {
      setExportAwaitingHd(false);
      setMessage("Export gagal.");
    }
  }, [
    exportAwaitingHd,
    exportRenderId,
    exportResolution,
    exportValidatedRenderId,
    queueRender,
    render,
    renderStatusData,
  ]);

  const toolbarActiveRender = renderStatus.data || render || latestRender.data;
  const toolbarManualEditorMode = isManualEditorTransformation(draft);
  const toolbarManualHasVideo = hasManualEditorTimelineVideo(draft);
  const toolbarTranscriptionReady = context.data
    ? toolbarManualEditorMode || !context.data.transcription_is_demo
    : false;
  const toolbarRenderedPreviewAvailable =
    !renderDirty &&
    toolbarActiveRender?.status === "completed" &&
    toolbarActiveRender.preset === preset &&
    Boolean(
      toolbarActiveRender.file_size_bytes === undefined ||
        toolbarActiveRender.file_size_bytes > 20_000,
    );
  const toolbarRed = report?.overall_status === "transformation_required";
  const canStartExport = Boolean(
    draft &&
    context.data &&
    toolbarTranscriptionReady &&
    (!toolbarManualEditorMode || toolbarManualHasVideo) &&
    !queueRender.isPending &&
    saveInFlightCount === 0,
  );
  const exportDisabledReason =
    toolbarManualEditorMode && !toolbarManualHasVideo
      ? "Import media dulu sebelum export"
      : !toolbarTranscriptionReady
        ? "Transkripsi sumber belum siap."
        : saveInFlightCount > 0
          ? "Tunggu perubahan selesai disimpan."
          : undefined;
  const toolbarExportBusy = ["queued", "running"].includes(toolbarActiveRender?.status || "");
  useEffect(() => {
    if (toolbarExportBusy && toolbarActiveRender?.id) {
      setExportTaskObservation((current) =>
        current?.id === toolbarActiveRender.id
          ? current
          : { id: toolbarActiveRender.id, startedAt: Date.now() },
      );
      return;
    }
    setExportTaskObservation(null);
    if (["completed", "failed"].includes(toolbarActiveRender?.status || "")) {
      setExportWasClosedDuringTask(false);
    }
  }, [toolbarActiveRender?.id, toolbarActiveRender?.status, toolbarExportBusy]);
  useEffect(() => {
    if (!exportTaskObservation) return undefined;
    setExportClock(Date.now());
    const clockTimer = window.setInterval(() => setExportClock(Date.now()), 15_000);
    return () => window.clearInterval(clockTimer);
  }, [exportTaskObservation]);
  const toolbarUnsaved =
    editorDirty ||
    timelineDirty ||
    Boolean(context.data && uploadTitle.trim() !== context.data.candidate_title);
  const isSavingEditor = saveInFlightCount > 0;
  const editorSaveStatus = isSavingEditor
    ? "saving"
    : saveFailure
      ? "failed"
      : toolbarUnsaved
        ? "dirty"
        : "saved";
  const editorSaveStatusLabel = {
    dirty: "Belum disimpan",
    saving: "Menyimpan...",
    saved: "Tersimpan otomatis",
    failed: "Gagal menyimpan",
  }[editorSaveStatus];
  const editorSaveStatusClass = {
    dirty: "bg-amber-50 text-amber-700",
    saving: "bg-blue-50 text-blue-700",
    saved: "bg-emerald-50 text-emerald-700",
    failed: "bg-red-50 text-red-700",
  }[editorSaveStatus];
  const editorSaveStatusTitle = saveFailure
    ? saveFailureMessage || "Penyimpanan gagal. Perubahan lokal tetap dipertahankan."
    : editorSaveStatusLabel;
  const openExportModal = useCallback(() => {
    const baseName = (uploadTitle || context.data?.candidate_title || "XA AutoClip")
      .replace(/[<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    setExportFilename((current) => current || `${baseName || "XA AutoClip"}.mp4`);
    setExportTechnicalOpen(false);
    setExportModalOpen(true);
  }, [context.data?.candidate_title, uploadTitle]);
  const closeExportModal = useCallback(() => {
    if (toolbarExportBusy || queueRender.isPending || Boolean(exportSubmissionStage)) {
      setExportWasClosedDuringTask(true);
      setMessage("Export tetap berjalan di latar belakang.");
    }
    setExportModalOpen(false);
  }, [exportSubmissionStage, queueRender.isPending, toolbarExportBusy]);

  useEffect(() => {
    if (!draft || !context.data) {
      layout.setEditorToolbar(null);
      return undefined;
    }

    const title = toolbarManualEditorMode
      ? "Editor Manual"
      : uploadTitle || context.data.project_title;
    const meta = toolbarManualEditorMode
      ? formatTime(context.data.clip_duration_seconds)
      : `${formatTime(context.data.clip_start_seconds)} - ${formatTime(
          context.data.clip_end_seconds,
        )} / ${formatTime(context.data.clip_duration_seconds)}`;
    const badge = (
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase ${editorSaveStatusClass}`}
        title={editorSaveStatusTitle}
      >
        {editorSaveStatusLabel}
      </span>
    );
    const actions = (
      <>
        {!toolbarManualEditorMode && (
          <Link className="btn-secondary px-3 py-2 text-sm" to={`/jobs/${draft.project_id}/clips`}>
            Kembali ke Klip
          </Link>
        )}
        <button
          className="btn px-3 py-2 text-sm"
          disabled={!canStartExport}
          onClick={openExportModal}
          title={exportDisabledReason}
          type="button"
        >
          Export
        </button>
      </>
    );
    const compactActions = (
      <>
        {!toolbarManualEditorMode && (
          <Link
            className="btn-secondary block w-full px-3 py-2 text-center text-sm"
            to={`/jobs/${draft.project_id}/clips`}
          >
            Kembali ke Klip
          </Link>
        )}
        <button
          className="btn w-full px-3 py-2 text-sm"
          disabled={!canStartExport}
          onClick={openExportModal}
          title={exportDisabledReason}
          type="button"
        >
          Export
        </button>
      </>
    );

    layout.setEditorToolbar({
      actions,
      badge,
      compactActions,
      meta,
      title,
    });
    return () => layout.setEditorToolbar(null);
  }, [
    context.data,
    draft,
    editorSaveStatusClass,
    editorSaveStatusLabel,
    editorSaveStatusTitle,
    exportDisabledReason,
    layout,
    openExportModal,
    canStartExport,
    toolbarManualEditorMode,
    uploadTitle,
  ]);

  if (!draft || !context.data) {
    return <p className="py-20 text-center text-slate-500">Memuat editor...</p>;
  }

  const activeRender = renderStatus.data || render || latestRender.data;
  const exportResultRender = exportRenderId
    ? renderStatus.data?.id === exportRenderId
      ? renderStatus.data
      : render?.id === exportRenderId
        ? render
        : undefined
    : undefined;
  const transcriptionReady = !context.data.transcription_is_demo;
  const set = (key: keyof Transformation, value: unknown) => {
    recordEditorHistory(draft, `field:${String(key)}`);
    setEditorDirty(true);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const setStyle = (key: string, value: unknown) => {
    recordEditorHistory(draft, `style:${key}`);
    setEditorDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              [key]: value,
            },
          }
        : current,
    );
  };
  const setCaptionStyle = (changes: Partial<CaptionStyleConfig>) => {
    recordEditorHistory(draft, "caption-style");
    setEditorDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setDraft((current) => {
      if (!current) return current;
      const currentStyle = normalizeCaptionStyleConfig(
        current.clipper_style_config?.caption_style,
      );
      return {
        ...current,
        clipper_style_config: {
          ...styleDefaults.clean_podcast,
          ...(current.clipper_style_config || {}),
          caption_style: normalizeCaptionStyleConfig({
            ...currentStyle,
            ...changes,
          }),
          caption_max_words:
            changes.maxWords ??
            current.clipper_style_config?.caption_max_words ??
            currentStyle.maxWords,
          caption_max_chars:
            changes.maxChars ??
            current.clipper_style_config?.caption_max_chars ??
            currentStyle.maxChars,
        },
      };
    });
  };
  const selectPreset = (value: RenderPreset) => {
    setPreset(value);
    setRenderDirty(true);
    setRender(undefined);
    setStyle("render_preset", value);
  };
  const currentSaveError = saveFailure
    ? save.error || autosave.error || new Error(saveFailureMessage || "Gagal menyimpan editor.")
    : null;
  const error =
    currentSaveError ||
    regenerate.error ||
    regenerateCaption.error ||
    regenerateHook.error ||
    applySource.error ||
    assess.error ||
    queueRender.error;

  async function copyCaption() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.social_caption);
    setCaptionCopied(true);
  }

  const styleConfig = {
    ...styleDefaults.clean_podcast,
    ...(draft.clipper_style_config || {}),
    caption_style: normalizeCaptionStyleConfig(draft.clipper_style_config?.caption_style),
  };
  const manualEditorMode = isManualEditorTransformation(draft);
  const savedEditorStateVersion = Number(styleConfig.editor_state_version || 0);
  const editorStateInitialized = savedEditorStateVersion >= 1;
  const trackOrder = normalizeTrackOrder(styleConfig.track_order);
  const visualLayerOrder = normalizeVisualLayerOrder(styleConfig.layer_order);
  const videoFraming = normalizeVideoFraming(styleConfig.video_framing);
  const setVideoFraming = (changes: Partial<VideoFraming>) => {
    const nextFraming = normalizeVideoFraming({ ...videoFraming, ...changes });
    setExportValidatedRenderId(null);
    setExportAwaitingHd(false);
    console.info("[XA AutoClip] render invalidated because video_framing changed", {
      transformationId,
      previous: videoFraming,
      next: nextFraming,
    });
    setStyle("video_framing", {
      x: Number(nextFraming.x.toFixed(2)),
      y: Number(nextFraming.y.toFixed(2)),
      scale: Number(nextFraming.scale.toFixed(2)),
    });
  };
  const moveTimelineTrack = (track: TimelineTrackKey, direction: -1 | 1) => {
    const index = trackOrder.indexOf(track);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= trackOrder.length) return;
    const nextOrder = [...trackOrder];
    [nextOrder[index], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[index]];
    setTimelineDirty(true);
    setStyle("track_order", nextOrder);
  };
  const visualLayerZIndex = (track: VisualLayerTrack) =>
    20 + visualLayerOrder.length - visualLayerOrder.indexOf(track);
  const additionalAudioAssets = (Array.isArray(styleConfig.additional_audio_assets)
    ? styleConfig.additional_audio_assets
    : []) as AdditionalAudioAsset[];
  const additionalAudioTracks = (Array.isArray(styleConfig.additional_audio_tracks)
    ? styleConfig.additional_audio_tracks
    : Array.isArray(styleConfig.audio_tracks)
      ? styleConfig.audio_tracks
    : []) as AdditionalAudioTrack[];
  const selectedAdditionalAudioTrack = additionalAudioTracks.find(
    (track) => track.id === selectedAdditionalAudioTrackId,
  ) || null;
  const originalClipDuration = Math.max(0.1, context.data.clip_duration_seconds);
  const savedMediaTrim = normalizeMediaTrim(styleConfig.media_trim, originalClipDuration);
  const savedSplitPoints = (Array.isArray(styleConfig.media_split_points)
    ? styleConfig.media_split_points
    : [])
    .map((value) => Number(value))
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value > savedMediaTrim.start + 0.05 &&
        value < savedMediaTrim.end - 0.05,
    )
    .sort((left, right) => left - right);
  const legacyBoundaries = [savedMediaTrim.start, ...savedSplitPoints, savedMediaTrim.end];
  const legacySequence = legacyBoundaries.slice(0, -1).map((sourceStart, index) => ({
    id: `media-${index}`,
    sourceStart,
    sourceEnd: legacyBoundaries[index + 1],
  }));
  const configuredMediaSequence = normalizeMediaSequence(
    styleConfig.media_sequence,
    originalClipDuration,
  );
  const baseMediaSequence = configuredMediaSequence.length
    ? configuredMediaSequence
    : legacySequence;
  const configuredVideoSequence = normalizeMediaSequence(
    styleConfig.video_sequence,
    originalClipDuration,
  );
  const configuredAudioSequence = normalizeMediaSequence(
    styleConfig.audio_sequence,
    originalClipDuration,
  );
  const videoSequenceInitialized = editorStateInitialized ||
    Boolean(styleConfig.video_sequence_initialized) || configuredVideoSequence.length > 0;
  const audioSequenceInitialized = editorStateInitialized ||
    Boolean(styleConfig.audio_sequence_initialized) || configuredAudioSequence.length > 0;
  const audioExtracted = Boolean(styleConfig.audio_extracted);
  const videoTrackDeleted = Boolean(styleConfig.video_track_deleted);
  const audioTrackDeleted = Boolean(styleConfig.audio_track_deleted);
  const videoSequence = videoTrackDeleted
    ? []
    : mediaResizePreview?.track === "video"
    ? mediaResizePreview.sequence
    : videoSequenceInitialized
      ? configuredVideoSequence
      : (configuredVideoSequence.length ? configuredVideoSequence : baseMediaSequence);
  const audioSequence = !audioExtracted
    ? videoSequence
    : audioTrackDeleted
      ? []
    : mediaResizePreview?.track === "audio"
      ? mediaResizePreview.sequence
      : audioSequenceInitialized
        ? configuredAudioSequence
        : (configuredAudioSequence.length ? configuredAudioSequence : videoSequence);
  const layoutSequence = (sequence: MediaSequenceSegment[]) => {
    let offset = 0;
    const segments = sequence.map((segment, index) => {
      const start = offset;
      const end = start + (segment.sourceEnd - segment.sourceStart);
      offset = end;
      return { ...segment, start, end, number: index + 1 };
    });
    return { segments, duration: offset };
  };
  const videoLayout = layoutSequence(videoSequence);
  const audioLayout = layoutSequence(audioSequence);
  const videoSegments = videoLayout.segments;
  const audioSegments = audioLayout.segments;
  const activeMediaTrack = audioExtracted && selectedEditorContext === "audio" ? "audio" : "video";
  const mediaSequence = activeMediaTrack === "audio" ? audioSequence : videoSequence;
  const mediaSegments = activeMediaTrack === "audio" ? audioSegments : videoSegments;
  const remainingMediaDuration = Math.max(videoLayout.duration, audioLayout.duration);
  const clipDuration = remainingMediaDuration > 0.05
    ? remainingMediaDuration
    : originalClipDuration;
  const timelineScaleDuration = Math.max(originalClipDuration, clipDuration);
  const timelineContentScale =
    timelineZoom * (timelineScaleDuration / Math.max(0.1, originalClipDuration));
  const sourceMediaUrl = candidateVideoUrl(draft.candidate_id);
  const latestImportedVideo = [...(editorMediaQuery.data || [])]
    .reverse()
    .find((asset) => asset.kind === "video");
  const sourceClipUrl =
    manualEditorMode && latestImportedVideo
      ? mediaUrl(transformationId, latestImportedVideo.asset_id)
      : sourceMediaUrl;
  const renderedPreviewAvailable =
    !renderDirty &&
    activeRender?.status === "completed" &&
    activeRender.preset === preset &&
    Boolean(activeRender.file_size_bytes === undefined || activeRender.file_size_bytes > 20_000);
  const renderedPreviewUrl =
    renderedPreviewAvailable && activeRender
      ? `${downloadUrl(activeRender.id)}?v=${activeRender.id}-${activeRender.status}-${activeRender.width}x${activeRender.height}-${activeRender.file_size_bytes || 0}`
      : null;
  const audioSettings = normalizeAudioSettings(styleConfig.audio_settings);
  const setAudioSettings = (changes: Partial<AudioSettings>) => {
    setTimelineDirty(true);
    setStyle("audio_settings", normalizeAudioSettings({ ...audioSettings, ...changes }));
  };
  const updateAdditionalAudioLibrary = (
    assets: AdditionalAudioAsset[],
    tracks: AdditionalAudioTrack[],
  ) => {
    recordEditorHistory(draft, "additional-audio", true);
    setEditorDirty(true);
    setTimelineDirty(true);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              additional_audio_assets: assets,
              additional_audio_tracks: tracks,
            },
          }
        : current,
    );
  };
  const addEditorMediaToTimeline = async (asset: EditorMediaAsset) => {
    if (asset.kind === "audio") {
      const exists = (styleConfig.additional_audio_assets || []).some(
        (item) => item.id === asset.asset_id,
      );
      if (exists) return;
    }
    const saved = await api<Transformation>(
      `/api/transformations/${transformationId}/media/${asset.asset_id}/add-to-timeline`,
      { method: "POST" },
    );
    setDraft(saved);
    setEditorDirty(true);
    setTimelineDirty(true);
    editorMediaQuery.refetch();
  };

  const importEditorMedia = async (
    kind: "video" | "audio" | "image",
    file?: File,
  ) => {
    if (!file) return;
    setEditorMediaUploading(true);
    setEditorMediaUploadKind(kind);
    try {
      const asset = await uploadMedia<EditorMediaAsset>(
        `/api/transformations/${transformationId}/media`,
        file,
        kind,
      );
      if (kind === "video") {
        const saved = await api<Transformation>(
          `/api/transformations/${transformationId}/media/${asset.asset_id}/add-to-timeline`,
          { method: "POST" },
        );
        setDraft(saved);
        setEditorDirty(true);
        setTimelineDirty(true);
        context.refetch();
      } else if (kind === "audio") {
        await addEditorMediaToTimeline(asset);
      }
      editorMediaQuery.refetch();
      setMessage(
        kind === "image"
          ? `${asset.name} tersimpan di media.`
          : `${asset.name} diimpor ke editor.`,
      );
    } catch (importError) {
      setMessage(
        importError instanceof Error ? importError.message : "Import media gagal.",
      );
    } finally {
      setEditorMediaUploading(false);
      setEditorMediaUploadKind(null);
    }
  };
  const handleAdditionalAudioUpload = async (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["mp3", "wav", "m4a"].includes(extension)) {
      setTimelineError("Gunakan file audio MP3, WAV, atau M4A.");
      return;
    }
    setAudioUploading(true);
    setAudioUploadProgress(0);
    setTimelineError("");
    try {
      const asset = await upload<AdditionalAudioAsset>(
        `/api/transformations/${transformationId}/audio-assets`,
        file,
        setAudioUploadProgress,
      );
      updateAdditionalAudioLibrary(
        [...additionalAudioAssets.filter((item) => item.id !== asset.id), asset],
        additionalAudioTracks,
      );
      setAudioLibraryTab("uploads");
      setMessage(`${asset.name} ditambahkan ke Upload Saya.`);
    } catch (uploadError) {
      setTimelineError(
        uploadError instanceof Error ? uploadError.message : "Upload audio gagal.",
      );
    } finally {
      setAudioUploading(false);
    }
  };
  const addAdditionalAudioTrack = (
    asset: AdditionalAudioAsset,
    kind: "backsound" | "sfx",
  ) => {
    const duration = Math.min(Math.max(0.1, asset.duration_seconds), timelineScaleDuration);
    const start = Math.min(
      Math.max(0, previewTime),
      Math.max(0, timelineScaleDuration - 0.1),
    );
    const end = Math.min(timelineScaleDuration, Math.max(start + 0.1, start + duration));
    const number = additionalAudioTracks.filter((track) => track.kind === kind).length + 1;
    const id = `additional-audio-${newEventId()}`;
    const track: AdditionalAudioTrack = {
      id,
      asset_id: asset.id,
      label: `${kind === "backsound" ? "Backsound" : "SFX"} ${number}`,
      kind,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      volume: 1,
    };
    updateAdditionalAudioLibrary(additionalAudioAssets, [...additionalAudioTracks, track]);
    setSelectedAdditionalAudioTrackId(id);
    setSelectedMediaSegmentId(null);
    setSelectedCaptionId(null);
    setSelectedEventId(null);
    setSelectedEditorContext("audio");
    setMessage(`${track.label} ditambahkan pada ${formatTimePrecise(start)}.`);
  };
  const hookFallbackText = safeHookPreview(
    styleConfig.hook_text || draft.original_hook || context.data.candidate_title || "",
  );
  const hookTextTemplate = normalizeHookTextTemplate(styleConfig.hook_text_template);
  const activeHookTemplate = hookTextTemplates.find(
    (template) => template.value === hookTextTemplate,
  ) || hookTextTemplates[0];
  const hookTextPosition: HookTextPosition =
    ["safe_top", "top", "upper_center"].includes(String(styleConfig.hook_text_position))
      ? (styleConfig.hook_text_position as HookTextPosition)
      : "safe_top";
  const hookTextSize: HookTextSize = styleConfig.hook_text_size === "large" ? "large" : "normal";
  const hookTextFont = normalizeHookTextFont(styleConfig.hook_text_font);
  const activeHookFont = hookTextFonts.find((font) => font.value === hookTextFont) || hookTextFonts[0];
  const hookTextStylePreset = resolveHookTextStylePreset(
    hookTextTemplate,
    styleConfig.hook_text_style_preset,
  );
  const keywordTextStylePreset = normalizeTextStylePreset(
    styleConfig.keyword_text_style_preset ?? "yellow_viral",
  );
  const hookUnifiedTextStyle = resolveTextOverlayStyle(hookTextStylePreset);
  const keywordUnifiedTextStyle = resolveTextOverlayStyle(keywordTextStylePreset);
  const keywordPreview = previewKeywords(
    context.data.candidate_transcript,
    draft.original_hook,
    draft.new_angle,
  );
  const effectTimelineInitialized = editorStateInitialized ||
    Boolean(styleConfig.effect_timeline_initialized) ||
    (Array.isArray(styleConfig.effect_timeline) && styleConfig.effect_timeline.length > 0);
  const effectTimeline = liveEffectTimeline(
    {
      ...styleConfig,
      editor_state_version: effectTimelineInitialized ? 1 : 0,
      effect_timeline: mediaResizePreview?.events || styleConfig.effect_timeline,
    } as Record<string, unknown>,
    clipDuration,
    keywordPreview,
  );
  const liveKeywordEvent = activeTimelineEvent(
    effectTimeline,
    "keyword_popup",
    previewTime,
    previewPlaying,
  );
  const livePunchEvent = activeTimelineEvent(
    effectTimeline,
    "punch_zoom",
    previewTime,
    previewPlaying,
  );
  const keywordSkipped =
    Boolean(styleConfig.keyword_popup_enabled) &&
    !effectTimeline.some((event) => event.type === "keyword_popup" && event.text);
  const baseEffectTimeline = mediaResizePreview?.events || effectTimeline;
  const configuredEffectTimeline = !effectTimelineInitialized &&
    styleConfig.hook_text_enabled && hookFallbackText &&
    !baseEffectTimeline.some((event) => event.type === "hook_text")
    ? [
        {
          id: "hook-initial",
          type: "hook_text",
          start: 0,
          end: Math.min(3, Math.max(1, clipDuration)),
          text: hookFallbackText,
          reason: "default timeline",
        } satisfies EffectTimelineEvent,
        ...baseEffectTimeline,
      ]
    : baseEffectTimeline;
  const generatedCaptionCues: EditableCaptionCue[] = projectCaptionCues(
    context.data.caption_cues || [],
    videoSequence,
  );
  const savedCaptionTimeline = Array.isArray(styleConfig.caption_timeline)
    ? (styleConfig.caption_timeline as EditableCaptionCue[])
        .map((cue, index) => ({
          id: String(cue.id || `caption-saved-${index}`),
          start: Math.max(0, Math.min(clipDuration, Number(cue.start) || 0)),
          end: Math.max(0, Math.min(clipDuration, Number(cue.end) || 0)),
          text: String(cue.text || "").trim(),
        }))
        .filter((cue) => cue.end > cue.start)
    : [];
  const captionTimelineInitialized = editorStateInitialized ||
    Boolean(styleConfig.caption_timeline_initialized) || savedCaptionTimeline.length > 0;
  const captionSyncRequired = Boolean(styleConfig.caption_sync_required);
  const editableCaptionCues = captionTimelineInitialized
    ? savedCaptionTimeline
    : generatedCaptionCues;
  const captionStyle = styleConfig.caption_style;
  const captionUnifiedTextStyle = resolveTextOverlayStyle(captionStyle.textPreset);
  const currentCaptionCue = activeCaptionCue(editableCaptionCues, previewTime);
  const subtitlePreview = currentCaptionCue
    ? getCaptionPreviewText(currentCaptionCue.text)
    : null;
  const karaokeWords = subtitlePreview ? captionWords(subtitlePreview) : [];
  const captionPreviewWordCount = karaokeWords.length;
  const karaokeCueDuration = currentCaptionCue
    ? Math.max(0, currentCaptionCue.end - currentCaptionCue.start)
    : 0;
  const karaokeCueProgress = currentCaptionCue &&
    previewTime >= currentCaptionCue.start &&
    previewTime < currentCaptionCue.end
    ? Math.min(
        0.999999,
        Math.max(0, (previewTime - currentCaptionCue.start) / Math.max(0.001, karaokeCueDuration)),
      )
    : null;
  // Estimasi karaoke proporsional dari durasi cue, bukan timing kata transcript asli.
  const karaokeActiveIndex =
    karaokeCueProgress !== null && karaokeCueDuration >= 0.35 && karaokeWords.length > 1
      ? Math.min(karaokeWords.length - 1, Math.floor(karaokeCueProgress * karaokeWords.length))
      : -1;
  const progressiveWordCount =
    karaokeCueProgress !== null && karaokeCueDuration >= 0.35 && karaokeWords.length > 1
      ? Math.min(
          karaokeWords.length,
          Math.max(1, Math.floor(karaokeCueProgress * karaokeWords.length) + 1),
        )
      : karaokeWords.length;
  const wordByWordPreview =
    karaokeCueProgress !== null
      ? karaokeWords.slice(0, progressiveWordCount).join(" ") || subtitlePreview
      : null;
  const captionOverlayText =
    captionStyle.displayMode === "word_by_word" ? wordByWordPreview : subtitlePreview;
  const editableEffectTimeline = configuredEffectTimeline.map((event, index) => ({
    ...event,
    id: editableEventId(event, index),
  }));
  const selectedEvent =
    editableEffectTimeline.find((event) => event.id === selectedEventId) || null;
  const liveHookEvent = activeHookCue(editableEffectTimeline, previewTime);
  const liveHookText = hookCueText(liveHookEvent, hookFallbackText);
  const renderedPreviewIsCleanFallback = Boolean(
    renderedPreviewUrl &&
      activeRender?.error_message?.includes("Sebagian efek gaya tidak diterapkan"),
  );
  const hookPreviewState = resolveHookPreviewRenderState(
    Boolean(liveHookEvent && liveHookText),
    Boolean(renderedPreviewUrl),
    renderedPreviewIsCleanFallback,
  );
  const hookSafeArea = resolveHookSafeArea(
    hookTextPosition,
    hookTextSize === "large" ? 48 : 36,
    liveHookText,
    540,
    960,
  );
  latestEditorSnapshotFingerprintRef.current = JSON.stringify(buildEditorStateSnapshot());
  const updateEffectTimeline = (
    events: EffectTimelineEvent[],
    recordHistory = true,
  ) => {
    if (recordHistory && !eventDrag) recordEditorHistory(draft, "effect-timeline", true);
    setTimelineError("");
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              effect_timeline_initialized: true,
              effect_timeline: events.map((event) => ({
                ...event,
                start: Math.max(0, Math.min(clipDuration, Number(event.start) || 0)),
                end: Math.max(0, Math.min(clipDuration, Number(event.end) || 0)),
              })),
            },
          }
        : current,
    );
  };
  const replaceEvent = (eventId: string, changes: Partial<EffectTimelineEvent>) => {
    const next = editableEffectTimeline.map((event) =>
      event.id === eventId ? { ...event, ...changes, id: event.id } : event,
    );
    updateEffectTimeline(next);
  };
  const deleteEvent = (eventId: string) => {
    if (!window.confirm("Hapus event ini?")) return;
    updateEffectTimeline(editableEffectTimeline.filter((event) => event.id !== eventId));
    setSelectedEventId(null);
    setSelectedEditorContext("timeline");
  };
  const addEvent = (type: "hook_text" | "punch_zoom" | "keyword_popup" | "pattern_interrupt") => {
    const start = Math.min(Math.max(0, previewTime), Math.max(0, clipDuration - 0.4));
    const intensity = String(styleConfig.style_intensity || "low");
    const zoom = intensity === "high" ? 1.14 : intensity === "medium" ? 1.1 : 1.06;
    const base = {
      id: newEventId(),
      type,
      start,
      end: Math.min(clipDuration, start + (type === "keyword_popup" ? 1.2 : type === "hook_text" ? 3 : 1)),
      reason: "manual timeline",
    } as EffectTimelineEvent;
    const event =
      type === "keyword_popup"
        ? { ...base, text: "" }
        : type === "punch_zoom"
          ? { ...base, zoom }
          : type === "hook_text"
            ? { ...base, text: hookFallbackText || "Hook video" }
            : { ...base, effect: "quick_zoom_shift" };
    updateEffectTimeline([...editableEffectTimeline, event]);
    setSelectedEventId(event.id || null);
    setSelectedEditorContext(contextFromEventType(event.type));
  };
  const timelineVideoItems: TimelineItem[] = videoSegments.map((segment) => ({
    ...segment,
    selectable: true,
    type: "video",
    label: `${segment.number}. ${context.data.uploaded_filename || context.data.source_title || "Video sumber"}${audioExtracted ? "" : " • Audio asli"}`,
    title: `Video bagian ${segment.number}\n${formatTimePrecise(segment.start)}-${formatTimePrecise(segment.end)}\n${audioExtracted ? "Track video" : "Video dengan audio asli tertaut"}`,
    active: selectedMediaSegmentId === segment.id,
    colorClass: "bg-blue-600 text-white",
  }));
  const timelineAudioItems: TimelineItem[] = audioSegments.map((segment) => ({
        ...segment,
        selectable: true,
        type: "audio",
        label: audioSettings.muted
          ? "Audio asli • Mute"
          : `Audio asli • ${Math.round(audioSettings.volume * 100)}%`,
        title: `Audio asli\nVolume ${Math.round(audioSettings.volume * 100)}%\nFade in ${audioSettings.fade_in.toFixed(1)}s • Fade out ${audioSettings.fade_out.toFixed(1)}s`,
        active: selectedMediaSegmentId === segment.id,
        colorClass: audioSettings.muted ? "bg-slate-400 text-white" : "bg-emerald-500 text-white",
      }));
  const timelineAdditionalAudioTracks = additionalAudioTracks.map((track) => {
    const asset = additionalAudioAssets.find((item) => item.id === track.asset_id);
    return {
      track,
      item: {
        id: track.id,
        selectable: true,
        type: "additional_audio",
        start: Math.max(0, track.start),
        end: Math.min(timelineScaleDuration, Math.max(track.start + 0.1, track.end)),
        label: asset?.name || track.label,
        title: `${track.label}\n${asset?.name || "Aset audio"}\nBelum ikut live preview/output export`,
        active: selectedAdditionalAudioTrackId === track.id,
        colorClass: track.kind === "sfx"
          ? "bg-amber-500 text-slate-950"
          : "bg-fuchsia-600 text-white",
      } satisfies TimelineItem,
    };
  });
  const timelineCaptionItems: TimelineItem[] = editableCaptionCues
    .map((cue, index) => ({
      id: cue.id || `caption-${index}`,
      eventId: cue.id,
      editable: true,
      selectable: true,
      type: "caption",
      start: cue.start,
      end: cue.end,
      label: "",
      active: currentCaptionCue?.id === cue.id,
      title: `Caption\n${formatTimePrecise(cue.start)}-${formatTimePrecise(cue.end)}\n${cue.text}`,
      colorClass: "bg-violet-500/90 text-white",
    }));
  const hookEvents = editableEffectTimeline.filter((event) => event.type === "hook_text");
  const timelineHookItems: TimelineItem[] = (
    hookEvents.length
      ? hookEvents
      : !effectTimelineInitialized && styleConfig.hook_text_enabled && hookFallbackText
        ? [
            {
              id: "hook-preview",
              type: "hook_text",
              start: 0,
              end: Math.min(3, Math.max(1, clipDuration)),
              text: hookFallbackText,
            },
          ]
        : []
  ).map((event) => ({
    id: event.id || "hook-preview",
    eventId: event.id,
    editable: Boolean(event.id),
    selectable: true,
    type: "hook_text",
    start: event.start,
    end: event.end,
    label: "Hook",
    active: previewTime >= event.start && previewTime <= event.end,
    title: `Hook Text\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}\n${hookCueText(event, hookFallbackText)}`,
    colorClass: "bg-cyan-500 text-white",
  }));
  const timelinePunchItems: TimelineItem[] = editableEffectTimeline
    .filter((event) => event.type === "punch_zoom" && event.end > event.start)
    .map((event, index) => ({
      id: `punch-${index}`,
      eventId: event.id,
      editable: true,
      type: event.type,
      start: event.start,
      end: event.end,
      label: `${event.zoom?.toFixed(2) || "1.08"}x`,
      active: previewTime >= event.start && previewTime <= event.end,
      title: `Punch Zoom\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)} - zoom ${
        event.zoom?.toFixed(2) || "1.08"
      }x${event.reason ? `\nReason: ${event.reason}` : ""}`,
      colorClass: "bg-rose-500 text-white",
    }));
  const timelineKeywordItems: TimelineItem[] = editableEffectTimeline
    .filter((event) => event.type === "keyword_popup" && event.end > event.start && event.text)
    .map((event, index) => ({
      id: `keyword-${index}`,
      eventId: event.id,
      editable: true,
      type: event.type,
      start: event.start,
      end: event.end,
      label: event.text || "Keyword",
      active: previewTime >= event.start && previewTime <= event.end,
      title: `Keyword Pop-up\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}\n"${
        event.text || ""
      }"${event.reason ? `\nReason: ${event.reason}` : ""}`,
      colorClass: "bg-yellow-300 text-slate-950",
    }));
  const timelinePatternItems: TimelineItem[] = editableEffectTimeline
    .filter((event) => event.type === "pattern_interrupt" && event.end > event.start)
    .map((event, index) => ({
      id: `pattern-${index}`,
      eventId: event.id,
      editable: true,
      type: event.type,
      start: event.start,
      end: event.end,
      label: "Pattern",
      active: previewTime >= event.start && previewTime <= event.end,
      title: `Pattern Interrupt\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}${
        event.reason ? `\nReason: ${event.reason}` : ""
      }`,
      colorClass: "bg-teal-500 text-white",
    }));
  const effectSummary = {
    punch: timelinePunchItems.length,
    keyword: timelineKeywordItems.length,
    pattern: timelinePatternItems.length,
  };
  const hookWords = hookWordCount(styleConfig.hook_text);
  const clampClipTime = (value: number) =>
    Math.min(Math.max(0, Number.isFinite(value) ? value : 0), Math.max(0, clipDuration));
  const clipTimeFromVideoTime = (videoTime: number) => {
    if (renderedPreviewUrl) {
      return clampClipTime(videoTime);
    }
    const sourceTime = videoTime;
    const currentIndex = videoSegments.findIndex(
      (segment) =>
        previewTimeRef.current >= segment.start - 0.05 &&
        previewTimeRef.current < segment.end - 0.05,
    );
    const segment = videoSegments[Math.max(0, currentIndex)] || videoSegments[0];
    if (!segment) return 0;
    if (sourceTime >= segment.sourceEnd - 0.03 && currentIndex < videoSegments.length - 1) {
      const next = videoSegments[currentIndex + 1];
      const video = previewVideoRef.current;
      if (video) video.currentTime = next.sourceStart;
      return next.start;
    }
    return clampClipTime(
      segment.start + Math.min(
        segment.sourceEnd - segment.sourceStart,
        Math.max(0, sourceTime - segment.sourceStart),
      ),
    );
  };
  const updateCaptionTimeline = (
    cues: EditableCaptionCue[],
    recordHistory = true,
    syncRequired?: boolean,
  ) => {
    if (recordHistory) recordEditorHistory(draft, "caption-timeline", true);
    setTimelineError("");
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              caption_timeline_initialized: true,
              caption_sync_required:
                syncRequired ?? Boolean(current.clipper_style_config?.caption_sync_required),
              caption_timeline: cues.map((cue) => ({
                ...cue,
                start: Math.max(0, Math.min(clipDuration, cue.start)),
                end: Math.max(0, Math.min(clipDuration, cue.end)),
              })),
            },
          }
        : current,
    );
  };
  const syncCaptionWithVideo = () => {
    if (
      captionTimelineInitialized &&
      editableCaptionCues.length > 0 &&
      !window.confirm(
        "Sinkronisasi akan menyusun ulang caption berdasarkan susunan video saat ini. Edit caption manual dapat berubah.",
      )
    ) {
      return;
    }
    const syncedCues = projectCaptionCues(context.data.caption_cues || [], videoSequence);
    updateCaptionTimeline(syncedCues, true, false);
    setSelectedCaptionId(null);
    setMessage(
      syncedCues.length
        ? `${syncedCues.length} caption disinkronkan dengan susunan video.`
        : "Sinkronisasi selesai, tetapi tidak ada segment caption yang overlap dengan video.",
    );
  };
  const videoTimeFromClipTime = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    if (renderedPreviewUrl) return safeTime;
    const segment = videoSegments.find(
      (item) => safeTime >= item.start && safeTime <= item.end,
    ) || videoSegments[videoSegments.length - 1];
    if (!segment) return 0;
    return segment.sourceStart + safeTime - segment.start;
  };
  const audioTimeFromClipTime = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    const segment = audioSegments.find(
      (item) => safeTime >= item.start && safeTime < item.end - 0.001,
    );
    if (!segment) return null;
    return segment.sourceStart + safeTime - segment.start;
  };
  const syncExtractedPreviewAudio = (clipTime: number, shouldPlay: boolean) => {
    if (!audioExtracted || renderedPreviewUrl) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    const sourceTime = audioTimeFromClipTime(clipTime);
    audio.muted = audioSettings.muted;
    audio.volume = Math.min(1, audioSettings.volume);
    if (sourceTime === null) {
      audio.pause();
      return;
    }
    if (Math.abs(audio.currentTime - sourceTime) > 0.18) {
      audio.currentTime = sourceTime;
    }
    if (shouldPlay && !audioSettings.muted && audio.paused) {
      void audio.play().catch(() => undefined);
    } else if (!shouldPlay || audioSettings.muted) {
      audio.pause();
    }
  };
  const setPreviewTimeFromVideo = (videoTime: number) => {
    if (timelineDraggingRef.current) return;
    const clipTime = clipTimeFromVideoTime(videoTime);
    previewTimeRef.current = clipTime;
    setPreviewTime(clipTime);
    syncExtractedPreviewAudio(clipTime, !previewVideoRef.current?.paused);
  };
  const seekPreviewTo = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    const video = previewVideoRef.current;
    previewTimeRef.current = safeTime;
    setPreviewTime(safeTime);
    if (video) {
      video.currentTime = videoTimeFromClipTime(safeTime);
    }
    syncExtractedPreviewAudio(safeTime, Boolean(video && !video.paused));
  };
  const stopPreviewClock = () => {
    if (previewClockFrameRef.current !== null) {
      window.cancelAnimationFrame(previewClockFrameRef.current);
      previewClockFrameRef.current = null;
    }
  };
  const startPreviewClock = () => {
    stopPreviewClock();
    previewClockLastUpdateRef.current = 0;
    const updateClock = (timestamp: number) => {
      const video = previewVideoRef.current;
      if (!video || video.paused || video.ended) {
        previewClockFrameRef.current = null;
        return;
      }
      if (timestamp - previewClockLastUpdateRef.current >= 50) {
        previewClockLastUpdateRef.current = timestamp;
        setPreviewTimeFromVideo(video.currentTime);
      }
      previewClockFrameRef.current = window.requestAnimationFrame(updateClock);
    };
    previewClockFrameRef.current = window.requestAnimationFrame(updateClock);
  };
  const handlePreviewPlay = () => {
    setPreviewPlaying(true);
    startPreviewClock();
    syncExtractedPreviewAudio(previewTime, true);
  };
  const handlePreviewPause = () => {
    setPreviewPlaying(false);
    stopPreviewClock();
    previewAudioRef.current?.pause();
  };
  const mediaTrackSelected =
    (selectedEditorContext === "video" || selectedEditorContext === "audio") &&
    Boolean(selectedMediaSegmentId);
  const canUndo = historyRevision >= 0 && undoStackRef.current.length > 0;
  const canRedo = historyRevision >= 0 && redoStackRef.current.length > 0;
  const commitMediaSequence = (
    sequence: MediaSequenceSegment[],
    events: EffectTimelineEvent[],
    track: "video" | "audio" = activeMediaTrack,
  ) => {
    recordEditorHistory(draft, "media-sequence", true);
    setTimelineError("");
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setSelectedEventId(null);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              [track === "audio" ? "audio_sequence_initialized" : "video_sequence_initialized"]: true,
              [track === "audio" ? "audio_sequence" : "video_sequence"]: sequence.map((segment) => ({
                id: segment.id,
                source_start: Number(segment.sourceStart.toFixed(3)),
                source_end: Number(segment.sourceEnd.toFixed(3)),
              })),
              [track === "audio" ? "audio_track_deleted" : "video_track_deleted"]:
                sequence.length === 0,
              caption_sync_required:
                track === "video" && captionTimelineInitialized
                  ? true
                  : Boolean(current.clipper_style_config?.caption_sync_required),
              effect_timeline: track === "audio"
                ? (current.clipper_style_config?.effect_timeline || [])
                : events,
            },
          }
        : current,
    );
  };
  const extractAudioTrack = () => {
    if (
      audioExtracted &&
      !window.confirm(
        "Ekstrak ulang Audio? Potongan dan susunan track Audio saat ini akan diganti dari track Video.",
      )
    ) {
      return;
    }
    recordEditorHistory(draft, "extract-audio", true);
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              audio_extracted: true,
              audio_sequence_initialized: true,
              audio_track_deleted: videoSequence.length === 0,
              audio_sequence: videoSequence.map((segment) => ({
                id: `audio-${segment.id}`,
                source_start: Number(segment.sourceStart.toFixed(3)),
                source_end: Number(segment.sourceEnd.toFixed(3)),
              })),
            },
          }
        : current,
    );
    setSelectedMediaSegmentId(null);
    setSelectedEventId(null);
    setSelectedCaptionId(null);
    setSelectedEditorContext("audio");
    setMessage(
      audioExtracted
        ? "Audio berhasil diekstrak ulang dari track Video."
        : "Audio klip berhasil diekstrak ke track terpisah.",
    );
  };
  const mergeAudioIntoVideoTrack = () => {
    if (!audioExtracted) return;
    if (
      !window.confirm(
        "Gabungkan Audio kembali ke Video? Potongan dan susunan track Audio terpisah akan dihapus.",
      )
    ) {
      return;
    }
    recordEditorHistory(draft, "merge-audio", true);
    previewAudioRef.current?.pause();
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              audio_extracted: false,
              audio_sequence_initialized: true,
              audio_track_deleted: false,
              audio_sequence: [],
            },
          }
        : current,
    );
    setSelectedMediaSegmentId(null);
    setSelectedEventId(null);
    setSelectedCaptionId(null);
    setSelectedEditorContext("video");
    setMessage("Audio kembali menyatu dengan track Video.");
  };
  const startMediaResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    item: TimelineItem,
    edge: "left" | "right",
  ) => {
    const segmentIndex = mediaSegments.findIndex((segment) => segment.id === item.id);
    const track = event.currentTarget.parentElement?.parentElement as HTMLDivElement | null;
    if (segmentIndex < 0 || !track) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewVideoRef.current?.pause();
    setSelectedMediaSegmentId(item.id);
    setSelectedEventId(null);
    setSelectedEditorContext(item.type === "audio" ? "audio" : "video");
    const rect = track.getBoundingClientRect();
    mediaResizeRef.current = {
      pointerId: event.pointerId,
      segmentIndex,
      track: item.type === "audio" ? "audio" : "video",
      edge,
      trackLeft: rect.left,
      trackWidth: rect.width,
      sequence: mediaSequence.map((segment) => ({ ...segment })),
      events: configuredEffectTimeline.map((timelineEvent) => ({ ...timelineEvent })),
      duration: clipDuration,
      scaleDuration: timelineScaleDuration,
    };
  };
  const moveMediaResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = mediaResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const ratio = resize.trackWidth
      ? (event.clientX - resize.trackLeft) / resize.trackWidth
      : 0;
    const timelinePoint = ratio * resize.scaleDuration;
    const minimumDuration = 0.25;
    const nextSequence = resize.sequence.map((segment) => ({ ...segment }));
    const segment = nextSequence[resize.segmentIndex];
    const timelineStart = resize.sequence
      .slice(0, resize.segmentIndex)
      .reduce((total, item) => total + item.sourceEnd - item.sourceStart, 0);
    const originalTimelineEnd = timelineStart + segment.sourceEnd - segment.sourceStart;
    const sourcePoint = segment.sourceStart + (timelinePoint - timelineStart);
    if (resize.edge === "left") {
      segment.sourceStart = Math.min(
        segment.sourceEnd - minimumDuration,
        Math.max(0, sourcePoint),
      );
    } else {
      segment.sourceEnd = Math.max(
        segment.sourceStart + minimumDuration,
        Math.min(originalClipDuration, sourcePoint),
      );
    }
    const durationDelta =
      segment.sourceEnd - segment.sourceStart -
      (resize.sequence[resize.segmentIndex].sourceEnd - resize.sequence[resize.segmentIndex].sourceStart);
    const nextDuration = resize.duration + durationDelta;
    const shiftedEvents = resize.events
      .map((timelineEvent) => ({
        ...timelineEvent,
        start: timelineEvent.start >= originalTimelineEnd
          ? timelineEvent.start + durationDelta
          : timelineEvent.start,
        end: timelineEvent.end >= originalTimelineEnd
          ? timelineEvent.end + durationDelta
          : timelineEvent.end,
      }))
      .map((timelineEvent) => ({
        ...timelineEvent,
        start: Math.max(0, Math.min(nextDuration, timelineEvent.start)),
        end: Math.max(0, Math.min(nextDuration, timelineEvent.end)),
      }))
      .filter((timelineEvent) => timelineEvent.end > timelineEvent.start);
    const nextEvents = resize.track === "audio" ? resize.events : shiftedEvents;
    const preview = { track: resize.track, sequence: nextSequence, events: nextEvents };
    resize.preview = preview;
    setMediaResizePreview(preview);
    setTimelineError("");
  };
  const finishMediaResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = mediaResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (resize.preview) {
      commitMediaSequence(resize.preview.sequence, resize.preview.events, resize.track);
      const nextDuration = resize.preview.sequence.reduce(
        (total, segment) => total + segment.sourceEnd - segment.sourceStart,
        0,
      );
      setPreviewTime((time) => Math.min(time, nextDuration));
    }
    mediaResizeRef.current = null;
    setMediaResizePreview(null);
    setAutosaveWakeRevision((revision) => revision + 1);
  };
  const startTimedItemResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    item: TimelineItem,
    edge: "left" | "right",
  ) => {
    if (!item.eventId) return;
    const track = event.currentTarget.parentElement?.parentElement as HTMLDivElement | null;
    if (!track) return;
    const kind = item.type === "caption" ? "caption" : "effect";
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = track.getBoundingClientRect();
    timedItemResizeRef.current = {
      pointerId: event.pointerId,
      kind,
      id: item.eventId,
      edge,
      trackLeft: rect.left,
      trackWidth: rect.width,
    };
    recordEditorHistory(draft, `${kind}-resize`, true);
    if (kind === "caption") {
      setSelectedCaptionId(item.eventId);
      setSelectedEventId(null);
      setSelectedEditorContext("caption");
    } else {
      setSelectedEventId(item.eventId);
      setSelectedCaptionId(null);
      setSelectedEditorContext(contextFromEventType(item.type));
    }
  };
  const moveTimedItemResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = timedItemResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const ratio = resize.trackWidth
      ? Math.min(1, Math.max(0, (event.clientX - resize.trackLeft) / resize.trackWidth))
      : 0;
    const targetTime = Math.min(clipDuration, ratio * timelineScaleDuration);
    const applyBounds = <T extends { id?: string; start: number; end: number }>(item: T): T => {
      if (item.id !== resize.id) return item;
      return resize.edge === "left"
        ? { ...item, start: Math.min(item.end - 0.1, Math.max(0, targetTime)) }
        : { ...item, end: Math.max(item.start + 0.1, Math.min(clipDuration, targetTime)) };
    };
    if (resize.kind === "caption") {
      updateCaptionTimeline(editableCaptionCues.map(applyBounds), false);
    } else {
      updateEffectTimeline(editableEffectTimeline.map(applyBounds), false);
    }
  };
  const finishTimedItemResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = timedItemResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    timedItemResizeRef.current = null;
    setAutosaveWakeRevision((revision) => revision + 1);
  };
  const splitSelectedMedia = () => {
    if (!mediaTrackSelected) {
      setTimelineError("Pilih bagian video atau audio yang ingin dipotong.");
      return;
    }
    if (previewTime <= 0.05 || previewTime >= clipDuration - 0.05) {
      setTimelineError("Letakkan playhead di dalam bagian track, bukan pada tepinya.");
      return;
    }
    const segmentIndex = mediaSegments.findIndex(
      (segment) => previewTime > segment.start + 0.05 && previewTime < segment.end - 0.05,
    );
    const segment = mediaSegments[segmentIndex];
    if (!segment || segment.id !== selectedMediaSegmentId) {
      setTimelineError("Playhead harus berada di dalam bagian track yang dipilih.");
      return;
    }
    const sourcePoint = segment.sourceStart + previewTime - segment.start;
    const rightId = `media-${newEventId()}`;
    const nextSequence = mediaSequence.flatMap((item, index) =>
      index === segmentIndex
        ? [
            { ...item, sourceEnd: sourcePoint },
            { id: rightId, sourceStart: sourcePoint, sourceEnd: item.sourceEnd },
          ]
        : [item],
    );
    commitMediaSequence(nextSequence, configuredEffectTimeline);
    setSelectedMediaSegmentId(rightId);
  };
  const deleteMediaLeft = () => {
    if (!mediaTrackSelected) {
      setTimelineError("Pilih bagian video atau audio terlebih dahulu.");
      return;
    }
    if (previewTime < 0.25 || clipDuration - previewTime < 0.25) {
      setTimelineError("Sisakan setidaknya 0,25 detik setelah titik potong.");
      return;
    }
    const nextSequence = mediaSegments.flatMap((segment) => {
      if (segment.end <= previewTime) return [];
      if (segment.start >= previewTime) return [{
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
      }];
      return [{
        id: segment.id,
        sourceStart: segment.sourceStart + previewTime - segment.start,
        sourceEnd: segment.sourceEnd,
      }];
    });
    const nextDuration = clipDuration - previewTime;
    const nextEvents = configuredEffectTimeline
      .filter((event) => event.end > previewTime)
      .map((event) => ({
        ...event,
        start: Math.max(0, event.start - previewTime),
        end: Math.min(nextDuration, event.end - previewTime),
      }))
      .filter((event) => event.end > event.start);
    commitMediaSequence(nextSequence, nextEvents);
    setSelectedMediaSegmentId(null);
    setPreviewTime(0);
    const video = previewVideoRef.current;
    if (video && !renderedPreviewUrl && nextSequence[0]) {
      video.currentTime = nextSequence[0].sourceStart;
    }
  };
  const deleteMediaRight = () => {
    if (!mediaTrackSelected) {
      setTimelineError("Pilih bagian video atau audio terlebih dahulu.");
      return;
    }
    if (previewTime < 0.25 || clipDuration - previewTime < 0.25) {
      setTimelineError("Sisakan setidaknya 0,25 detik sebelum titik potong.");
      return;
    }
    const nextSequence = mediaSegments.flatMap((segment) => {
      if (segment.start >= previewTime) return [];
      if (segment.end <= previewTime) return [{
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
      }];
      return [{
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceStart + previewTime - segment.start,
      }];
    });
    const nextEvents = configuredEffectTimeline
      .filter((event) => event.start < previewTime)
      .map((event) => ({ ...event, end: Math.min(previewTime, event.end) }))
      .filter((event) => event.end > event.start);
    commitMediaSequence(nextSequence, nextEvents);
    setSelectedMediaSegmentId(null);
    setPreviewTime(Math.min(previewTime, nextSequence.reduce(
      (total, segment) => total + segment.sourceEnd - segment.sourceStart,
      0,
    )));
  };
  const copySelectedMedia = () => {
    const selected = mediaSequence.find((segment) => segment.id === selectedMediaSegmentId);
    if (!mediaTrackSelected || !selected) {
      setTimelineError("Pilih bagian video atau audio yang ingin disalin.");
      return;
    }
    setCopiedMediaSegment({ ...selected });
    setTimelineError("");
    setMessage(`Bagian ${formatTimePrecise(selected.sourceEnd - selected.sourceStart)} disalin.`);
  };
  const pasteCopiedMedia = () => {
    if (!copiedMediaSegment) {
      setTimelineError("Belum ada bagian track yang disalin.");
      return;
    }
    const insertAt = Math.min(clipDuration, Math.max(0, previewTime));
    const before: MediaSequenceSegment[] = [];
    const after: MediaSequenceSegment[] = [];
    mediaSegments.forEach((segment) => {
      const plain = {
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
      };
      if (segment.end <= insertAt + 0.001) {
        before.push(plain);
      } else if (segment.start >= insertAt - 0.001) {
        after.push(plain);
      } else {
        const sourcePoint = segment.sourceStart + insertAt - segment.start;
        if (sourcePoint - segment.sourceStart >= 0.1) {
          before.push({ ...plain, sourceEnd: sourcePoint });
        }
        if (segment.sourceEnd - sourcePoint >= 0.1) {
          after.push({
            id: `media-${newEventId()}`,
            sourceStart: sourcePoint,
            sourceEnd: segment.sourceEnd,
          });
        }
      }
    });
    const pastedId = `media-${newEventId()}`;
    const pasted = { ...copiedMediaSegment, id: pastedId };
    const insertedDuration = pasted.sourceEnd - pasted.sourceStart;
    const nextEvents = configuredEffectTimeline.map((event) => {
      if (event.start >= insertAt) {
        return {
          ...event,
          start: event.start + insertedDuration,
          end: event.end + insertedDuration,
        };
      }
      if (event.end > insertAt) return { ...event, end: event.end + insertedDuration };
      return event;
    });
    commitMediaSequence([...before, pasted, ...after], nextEvents);
    setSelectedMediaSegmentId(pastedId);
    setPreviewTime(insertAt);
    setTimelineError("");
    setMessage(`Bagian ditempel di ${formatTimePrecise(insertAt)}.`);
  };
  const selectedCaption = editableCaptionCues.find((cue) => cue.id === selectedCaptionId) || null;
  const selectedCaptionText = String(selectedCaption?.text || "").trim();
  const selectedCaptionWordCount = captionWords(selectedCaption?.text || "").length;
  const selectedCaptionCharacterCount = selectedCaptionText.length;
  const selectedCaptionDuration = selectedCaption
    ? Math.max(0, selectedCaption.end - selectedCaption.start)
    : 0;
  const updateSelectedCaptionText = (text: string) => {
    if (!selectedCaption) return;
    recordEditorHistory(draft, `caption-text:${selectedCaption.id}`);
    updateCaptionTimeline(
      editableCaptionCues.map((cue) =>
        cue.id === selectedCaption.id ? { ...cue, text } : cue,
      ),
      false,
    );
  };
  const finishSelectedCaptionTextEdit = () => {
    historyGroupRef.current = null;
    setAutosaveWakeRevision((revision) => revision + 1);
  };
  const deleteSelectedCaptionCue = () => {
    if (!selectedCaption) return;
    updateCaptionTimeline(editableCaptionCues.filter((cue) => cue.id !== selectedCaption.id));
    setSelectedCaptionId(null);
    setMessage("Caption dihapus dari timeline.");
  };
  const reflowSelectedCaption = () => {
    if (!selectedCaption) return;
    const sourceCue = selectedCaption;
    const usedIds = new Set(editableCaptionCues.map((cue) => cue.id));
    const reflowed = reflowCaptionCue(sourceCue, usedIds, captionStyle.maxWords);
    const nextCues = editableCaptionCues.flatMap((cue) =>
      cue.id === selectedCaption.id ? reflowed : [cue],
    );
    updateCaptionTimeline(nextCues);
    setSelectedCaptionId(reflowed[0].id);
    setMessage(
      reflowed.length > 1
        ? `Caption dipecah menjadi ${reflowed.length} cue (maksimal ${captionStyle.maxWords} kata).`
        : `Caption sudah maksimal ${captionStyle.maxWords} kata.`,
    );
  };
  const reflowAllCaptions = () => {
    const sourceCues = editableCaptionCues;
    const usedIds = new Set(sourceCues.map((cue) => cue.id));
    const nextCues = sourceCues.flatMap((cue) =>
      reflowCaptionCue(cue, usedIds, captionStyle.maxWords),
    );
    updateCaptionTimeline(nextCues);
    setMessage(
      `Semua caption dirapikan menjadi ${nextCues.length} cue (maksimal ${captionStyle.maxWords} kata).`,
    );
  };
  const timedTrackSelected = Boolean(selectedCaption || selectedEvent);
  const anyTrackSelected = mediaTrackSelected || timedTrackSelected || Boolean(selectedAdditionalAudioTrack);
  const selectedTrackSupportsMediaEditing = mediaTrackSelected || timedTrackSelected;
  const copySelectedTrack = () => {
    if (mediaTrackSelected) {
      setCopiedTimedItem(null);
      copySelectedMedia();
      return;
    }
    if (selectedCaption) {
      setCopiedMediaSegment(null);
      setCopiedTimedItem({ kind: "caption", item: { ...selectedCaption } });
      setMessage("Caption disalin.");
      return;
    }
    if (selectedEvent) {
      setCopiedMediaSegment(null);
      setCopiedTimedItem({ kind: "effect", item: { ...selectedEvent } });
      setMessage("Event efek disalin.");
    }
  };
  const pasteSelectedTrack = () => {
    if (!copiedTimedItem) {
      pasteCopiedMedia();
      return;
    }
    const duration = copiedTimedItem.item.end - copiedTimedItem.item.start;
    const start = Math.min(Math.max(0, previewTime), Math.max(0, clipDuration - duration));
    const end = Math.min(clipDuration, start + duration);
    if (copiedTimedItem.kind === "caption") {
      const id = `caption-${newEventId()}`;
      updateCaptionTimeline([
        ...editableCaptionCues,
        { ...copiedTimedItem.item, id, start, end },
      ]);
      setSelectedCaptionId(id);
      setSelectedEventId(null);
      setSelectedEditorContext("caption");
    } else {
      const id = newEventId();
      updateEffectTimeline([
        ...editableEffectTimeline,
        { ...copiedTimedItem.item, id, start, end },
      ]);
      setSelectedEventId(id);
      setSelectedCaptionId(null);
      setSelectedEditorContext(contextFromEventType(copiedTimedItem.item.type));
    }
  };
  const splitSelectedTrack = () => {
    if (mediaTrackSelected) {
      splitSelectedMedia();
      return;
    }
    const item = selectedCaption || selectedEvent;
    if (!item || previewTime <= item.start + 0.05 || previewTime >= item.end - 0.05) {
      setTimelineError("Playhead harus berada di dalam item yang dipilih.");
      return;
    }
    if (selectedCaption) {
      const rightId = `caption-${newEventId()}`;
      updateCaptionTimeline(editableCaptionCues.flatMap((cue) =>
        cue.id === selectedCaption.id
          ? [{ ...cue, end: previewTime }, { ...cue, id: rightId, start: previewTime }]
          : [cue],
      ));
      setSelectedCaptionId(rightId);
    } else if (selectedEvent) {
      const rightId = newEventId();
      updateEffectTimeline(editableEffectTimeline.flatMap((event) =>
        event.id === selectedEvent.id
          ? [{ ...event, end: previewTime }, { ...event, id: rightId, start: previewTime }]
          : [event],
      ));
      setSelectedEventId(rightId);
    }
  };
  const trimSelectedTimedItem = (edge: "left" | "right") => {
    const item = selectedCaption || selectedEvent;
    if (!item || previewTime <= item.start || previewTime >= item.end) {
      setTimelineError("Playhead harus berada di dalam item yang dipilih.");
      return;
    }
    if (selectedCaption) {
      updateCaptionTimeline(editableCaptionCues.map((cue) =>
        cue.id === selectedCaption.id
          ? { ...cue, [edge === "left" ? "start" : "end"]: previewTime }
          : cue,
      ));
    } else if (selectedEvent) {
      updateEffectTimeline(editableEffectTimeline.map((event) =>
        event.id === selectedEvent.id
          ? { ...event, [edge === "left" ? "start" : "end"]: previewTime }
          : event,
      ));
    }
  };
  const deleteLeftSelectedTrack = () => {
    if (mediaTrackSelected) deleteMediaLeft();
    else trimSelectedTimedItem("left");
  };
  const deleteRightSelectedTrack = () => {
    if (mediaTrackSelected) deleteMediaRight();
    else trimSelectedTimedItem("right");
  };
  const deleteSelectedTrackItem = () => {
    if (selectedAdditionalAudioTrack) {
      updateAdditionalAudioLibrary(
        additionalAudioAssets,
        additionalAudioTracks.filter((track) => track.id !== selectedAdditionalAudioTrack.id),
      );
      setSelectedAdditionalAudioTrackId(null);
      setMessage(`${selectedAdditionalAudioTrack.label} dihapus dari timeline.`);
      return;
    }
    if (mediaTrackSelected) {
      const selectedIndex = mediaSegments.findIndex(
        (segment) => segment.id === selectedMediaSegmentId,
      );
      const selected = mediaSegments[selectedIndex];
      if (!selected) return;
      const removedDuration = selected.end - selected.start;
      const nextSequence = mediaSequence.filter((segment) => segment.id !== selected.id);
      const nextEvents = activeMediaTrack === "audio"
        ? configuredEffectTimeline
        : configuredEffectTimeline
            .map((event) => {
              if (event.end <= selected.start) return event;
              if (event.start >= selected.end) {
                return {
                  ...event,
                  start: event.start - removedDuration,
                  end: event.end - removedDuration,
                };
              }
              return {
                ...event,
                start: Math.min(event.start, selected.start),
                end: Math.max(selected.start, event.end - removedDuration),
              };
            })
            .filter((event) => event.end > event.start);
      commitMediaSequence(nextSequence, nextEvents);
      setSelectedMediaSegmentId(null);
      setPreviewTime(Math.min(selected.start, Math.max(0, clipDuration - removedDuration)));
      setMessage(`${activeMediaTrack === "audio" ? "Audio" : "Video"} terpilih dihapus.`);
      return;
    }
    if (selectedCaption) {
      updateCaptionTimeline(editableCaptionCues.filter((cue) => cue.id !== selectedCaption.id));
      setSelectedCaptionId(null);
      setMessage("Caption terpilih dihapus.");
      return;
    }
    if (selectedEvent) {
      updateEffectTimeline(editableEffectTimeline.filter((event) => event.id !== selectedEvent.id));
      setSelectedEventId(null);
      setMessage("Event terpilih dihapus.");
    }
  };
  const markEditorPreferenceDirty = () => {
    setEditorDirty(true);
    setSaveFailure(false);
    setSaveFailureMessage("");
  };
  const clampTimelineHeight = (value: number) =>
    Math.max(220, Math.min(value, Math.max(320, window.innerHeight - 280)));
  const handleTimelineResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    timelineResizeRef.current = {
      pointerId: event.pointerId,
      startHeight: timelineHeight,
      startY: event.clientY,
    };
  };
  const handleTimelineResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = timelineResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    markEditorPreferenceDirty();
    setTimelineHeight(clampTimelineHeight(resize.startHeight + resize.startY - event.clientY));
  };
  const handleTimelineResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = timelineResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    timelineResizeRef.current = null;
    setAutosaveWakeRevision((revision) => revision + 1);
  };
  const timelineTimeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0;
    return {
      percent: ratio * 100,
      time: clampClipTime(ratio * timelineScaleDuration),
    };
  };
  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const video = previewVideoRef.current;
    timelineDraggingRef.current = true;
    video?.pause();
    const target = timelineTimeFromPointer(event);
    setTimelineHover(target);
    seekPreviewTo(target.time);
  };
  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = timelineTimeFromPointer(event);
    setTimelineHover(target);
    if (timelineDraggingRef.current) {
      seekPreviewTo(target.time);
    }
  };
  const finishTimelineDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!timelineDraggingRef.current) return;
    timelineDraggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setAutosaveWakeRevision((revision) => revision + 1);
  };
  const timeFromClientX = (clientX: number, left: number, width: number) => {
    const ratio = width ? Math.min(1, Math.max(0, (clientX - left) / width)) : 0;
    return clampClipTime(ratio * timelineScaleDuration);
  };
  const handleEventPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => {
    if (!item.eventId) return;
    const track = event.currentTarget.parentElement as HTMLDivElement | null;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    recordEditorHistory(draft, "effect-drag", true);
    setSelectedEventId(item.eventId);
    setSelectedEditorContext(contextFromEventType(item.type));
    setEventDrag({
      eventId: item.eventId,
      pointerId: event.pointerId,
      startPointerTime: timeFromClientX(event.clientX, rect.left, rect.width),
      originalStart: item.start,
      originalEnd: item.end,
      trackLeft: rect.left,
      trackWidth: rect.width,
    });
  };
  const handleEventPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!eventDrag || event.pointerId !== eventDrag.pointerId) return;
    const targetTime = timeFromClientX(event.clientX, eventDrag.trackLeft, eventDrag.trackWidth);
    const duration = eventDrag.originalEnd - eventDrag.originalStart;
    const delta = targetTime - eventDrag.startPointerTime;
    const nextStart = clampClipTime(
      Math.min(Math.max(0, eventDrag.originalStart + delta), Math.max(0, clipDuration - duration)),
    );
    replaceEvent(eventDrag.eventId, {
      start: Number(nextStart.toFixed(2)),
      end: Number((nextStart + duration).toFixed(2)),
    });
    setTimelineHover({ percent: (nextStart / Math.max(1, clipDuration)) * 100, time: nextStart });
  };
  const handleEventPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!eventDrag || event.pointerId !== eventDrag.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setEventDrag(null);
    setAutosaveWakeRevision((revision) => revision + 1);
  };
  const selectTimelineItem = (item: TimelineItem) => {
    if (item.type === "additional_audio") {
      setSelectedAdditionalAudioTrackId(item.id);
      setSelectedEventId(null);
      setSelectedCaptionId(null);
      setSelectedMediaSegmentId(null);
      setSelectedEditorContext("audio");
      return;
    }
    setSelectedAdditionalAudioTrackId(null);
    if (item.type === "video" || item.type === "audio") {
      setSelectedEventId(null);
      setSelectedCaptionId(null);
      setSelectedMediaSegmentId(item.id);
      setSelectedEditorContext(item.type);
      return;
    }
    if (item.type === "caption") {
      const captionId = item.eventId || item.id;
      previewVideoRef.current?.pause();
      previewAudioRef.current?.pause();
      stopPreviewClock();
      setPreviewPlaying(false);
      seekPreviewTo(item.start);
      setSelectedCaptionId(captionId);
      setSelectedEventId(null);
      setSelectedMediaSegmentId(null);
      setSelectedEditorContext("caption");
      return;
    }
    setSelectedCaptionId(null);
    setSelectedMediaSegmentId(null);
    if (item.eventId) {
      setSelectedEventId(item.eventId);
      setSelectedEditorContext(contextFromEventType(item.type));
      return;
    }
    setSelectedEventId(null);
    setSelectedEditorContext(contextFromEventType(item.type));
  };
  const handleEventClick = (item: TimelineItem) => selectTimelineItem(item);
  const handleTrackItemContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    item: TimelineItem,
  ) => {
    selectTimelineItem(item);
    const menuWidth = 240;
    const menuHeight = 430;
    setTrackContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      item,
    });
  };
  const runTrackContextAction = (action: () => void) => {
    setTrackContextMenu(null);
    action();
  };
  const timelinePointerProps = {
    onPointerCancel: finishTimelineDrag,
    onPointerDown: handleTimelinePointerDown,
    onPointerLeave: () => {
      if (!timelineDraggingRef.current) setTimelineHover(null);
    },
    onPointerMove: handleTimelinePointerMove,
    onPointerUp: finishTimelineDrag,
  };
  const editableMarkerProps = {
    onItemClick: handleEventClick,
    onItemContextMenu: handleTrackItemContextMenu,
    onItemPointerDown: handleEventPointerDown,
    onItemPointerMove: handleEventPointerMove,
    onItemPointerUp: handleEventPointerUp,
  };
  const timelineTrackOrderProps = (track: TimelineTrackKey) => {
    const index = trackOrder.indexOf(track);
    return {
      order: index,
      canMoveUp: index > 0,
      canMoveDown: index >= 0 && index < trackOrder.length - 1,
      onMoveUp: () => moveTimelineTrack(track, -1),
      onMoveDown: () => moveTimelineTrack(track, 1),
    };
  };
  const previewModeText = renderedPreviewAvailable
    ? "Preview file hasil export."
    : renderDirty
      ? "Live Preview dari perubahan editor."
      : "Preview sumber sebelum export.";
  const currentRenderLabel = renderLabel(activeRender, renderedPreviewAvailable);
  const exportIsHd = exportResolution !== "540";
  const exportMatchesRequestedResolution = Boolean(
    exportResultRender?.status === "completed" &&
    exportResultRender.output_url &&
    (!exportIsHd || exportResultRender.width >= 1000),
  );
  const exportValidating = Boolean(
    exportMatchesRequestedResolution &&
    exportResultRender &&
    exportValidatedRenderId !== exportResultRender.id &&
    !exportAwaitingHd &&
    !queueRender.isPending,
  );
  const exportReady = Boolean(
    exportMatchesRequestedResolution &&
    exportResultRender &&
    exportValidatedRenderId === exportResultRender.id &&
    !renderDirty &&
    !exportAwaitingHd,
  );
  const exportFailed = exportResultRender?.status === "failed" || Boolean(queueRender.error);
  const exportBackendStatus = exportResultRender?.status;
  const exportInProgress = Boolean(
    exportSubmissionStage ||
    queueRender.isPending ||
    exportAwaitingHd ||
    exportValidating ||
    ["queued", "running"].includes(exportBackendStatus || ""),
  );
  const exportLongRunning = Boolean(
    exportTaskObservation &&
    exportTaskObservation.id === exportResultRender?.id &&
    exportInProgress &&
    exportClock - exportTaskObservation.startedAt >= EXPORT_LONG_RUNNING_MS,
  );
  const backendProgressValue = exportResultRender?.progress_percent ?? exportResultRender?.progress;
  const exportProgress = typeof backendProgressValue === "number" && Number.isFinite(backendProgressValue)
    ? Math.min(100, Math.max(0, backendProgressValue <= 1 ? backendProgressValue * 100 : backendProgressValue))
    : null;
  const exportStatusText = isSavingEditor || exportSubmissionStage === "saving"
    ? "Menyimpan perubahan sebelum export..."
    : exportBackendStatus === "running"
      ? "Mengekspor video..."
      : exportBackendStatus === "queued"
        ? "Menyiapkan file..."
        : exportSubmissionStage === "preparing" || queueRender.isPending || exportAwaitingHd
          ? "Menyiapkan file..."
          : exportValidating
            ? "Memvalidasi file..."
            : exportFailed
              ? "Export gagal"
              : exportReady
                ? "File siap diunduh."
                : toolbarUnsaved
                  ? "Perubahan akan disimpan sebelum export."
                  : "Siap untuk export.";
  const exportFileSize = exportReady && exportResultRender?.file_size_bytes
    ? `${(exportResultRender.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
    : "Tersedia setelah export";
  const sourceFrameRate = exportResultRender?.frame_rate && exportResultRender.frame_rate !== 30
    ? Math.round(exportResultRender.frame_rate)
    : null;
  const exportDownloadFilename = sanitizeDownloadFilename(
    exportFilename,
    uploadTitle,
    context.data?.candidate_title,
    context.data?.project_title,
  );
  const exportResultUrl = exportReady && exportResultRender?.output_url
    ? `${downloadUrl(exportResultRender.id)}?v=${exportResultRender.id}-${exportResultRender.file_size_bytes || 0}&output_filename=${encodeURIComponent(exportDownloadFilename)}`
    : null;
  const startExport = () => {
    if (!canStartExport || queueRender.isPending || toolbarExportBusy) return;
    setExportTechnicalOpen(false);
    setExportWasClosedDuringTask(false);
    setExportValidatedRenderId(null);
    setMessage(toolbarUnsaved ? "Menyimpan perubahan sebelum export..." : "Menyiapkan file...");
    if (exportIsHd && !toolbarRenderedPreviewAvailable) {
      setExportAwaitingHd(true);
      queueRender.mutate(true);
      return;
    }
    setExportAwaitingHd(false);
    queueRender.mutate(!exportIsHd);
  };
  const playheadPercent = Math.min(
    100,
    Math.max(0, (previewTime / Math.max(1, timelineScaleDuration)) * 100),
  );
  const tickStep = timelineScaleDuration > 45 ? 10 : 5;
  const ticks = Array.from(
    new Set([
      ...Array.from(
        { length: Math.floor(timelineScaleDuration / tickStep) + 1 },
        (_, index) => index * tickStep,
      ).filter((tick) => tick <= timelineScaleDuration),
      timelineScaleDuration,
    ]),
  );
  const livePreviewFilterClass = renderedPreviewUrl
    ? ""
    : styleConfig.clipper_style_preset === "viral_shorts"
      ? "saturate-125 contrast-110"
      : styleConfig.clipper_style_preset === "story_drama"
        ? "brightness-90 contrast-125"
        : styleConfig.clipper_style_preset === "education_explainer"
          ? "contrast-105"
          : styleConfig.clipper_style_preset === "meme_comedy"
            ? "saturate-150 contrast-125"
            : "";
  const liveZoomStyle =
    !renderedPreviewUrl && livePunchEvent
      ? {
          transform: `scale(${livePunchEvent.zoom || 1.08})`,
          transition: "transform 160ms ease-out",
          transformOrigin: "center center",
        }
      : undefined;
  const toggleLeftSection = (id: string) =>
    setOpenLeftSection((current) => (current === id ? null : id));
  const transcriptSummary = context.data.candidate_transcript
    ? `${context.data.candidate_transcript.slice(0, 64).trim()}${
        context.data.candidate_transcript.length > 64 ? "..." : ""
      }`
    : "Transkrip belum tersedia";
  const captionSummary = draft.social_caption
    ? `${draft.social_caption.slice(0, 64).trim()}${
        draft.social_caption.length > 64 ? "..." : ""
      }`
    : "Deskripsi belum tersedia";
  const contextualTabs: ReadonlyArray<readonly [EditorContext, string]> = manualEditorMode
    ? [
        ["media", "Media"],
        ["video", "Video"],
        ["audio", "Audio"],
        ["caption", "Caption"],
        ["hook", "Hook"],
        ["effect", "Efek"],
      ]
    : [
        ["video", "Video"],
        ["audio", "Audio"],
        ["caption", "Caption"],
        ["hook", "Hook"],
        ["keyword", "Keyword"],
        ["effect", "Efek"],
      ];

  return (
    <div className={`editor-workspace flex min-h-[calc(100vh-80px)] flex-col rounded-xl border border-zinc-800 bg-[#151719] shadow-2xl shadow-black/30 xl:h-[calc(100vh-80px)] xl:min-h-[720px] xl:overflow-hidden ${
      editorTheme === "light" ? "editor-theme-light" : "editor-theme-dark"
    }`}>
      <div className="grid min-h-0 flex-1 gap-px bg-zinc-800 xl:grid-cols-[290px_minmax(440px,1fr)_340px] xl:items-stretch">
        <aside className="editor-sidepanel min-h-0 bg-[#1d1f23] xl:h-full xl:overflow-y-auto">
          <section className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  {manualEditorMode ? "Video Utama" : "Konten Klip"}
                </h2>
                {manualEditorMode && (
                  <p className="text-xs font-semibold text-emerald-700">Mode edit manual</p>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-black ${editorSaveStatusClass}`}
                title={editorSaveStatusTitle}
              >
                {editorSaveStatusLabel}
              </span>
            </div>
            <div className="mt-4 space-y-2">
              <AccordionSection
                id="title"
                isOpen={openLeftSection === "title"}
                onToggle={toggleLeftSection}
                summary={uploadTitle || "Judul belum tersedia"}
                title={manualEditorMode ? "Judul Video" : "Judul Klip"}
              >
                <label htmlFor="upload_title">
                  {manualEditorMode ? "Judul Video" : "Judul Klip"}
                </label>
                <input
                  id="upload_title"
                  maxLength={300}
                  value={uploadTitle}
                  onChange={(event) => {
                    setEditorDirty(true);
                    setUploadTitle(event.target.value);
                  }}
                />
                {!manualEditorMode && (
                  <button
                    className="btn-secondary mt-2 px-3 py-2 text-xs"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate()}
                    type="button"
                  >
                    {regenerate.isPending ? "Membuat..." : "Buat ulang judul"}
                  </button>
                )}
              </AccordionSection>

              <AccordionSection
                id="hook"
                isOpen={openLeftSection === "hook"}
                onToggle={toggleLeftSection}
                summary={styleConfig.hook_text || "Hook belum tersedia"}
                title="Hook Pembuka"
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="mb-0" htmlFor="hook_text_panel">
                    Hook Pembuka
                  </label>
                  {!manualEditorMode && (
                    <button
                      type="button"
                      className="btn-secondary px-3 py-2 text-xs"
                      disabled={regenerateHook.isPending}
                      onClick={() => regenerateHook.mutate()}
                    >
                      {regenerateHook.isPending ? "Membuat..." : "Buat ulang hook"}
                    </button>
                  )}
                </div>
                <textarea
                  id="hook_text_panel"
                  rows={2}
                  maxLength={70}
                  value={styleConfig.hook_text}
                  placeholder="Hook pendek khusus klip ini"
                  onChange={(event) => setStyle("hook_text", event.target.value)}
                />
                <p className={`mt-1 text-xs ${hookWords > 12 ? "text-amber-700" : "text-slate-500"}`}>
                  Hook ideal 6-12 kata. Saat ini {hookWords || 0} kata.
                </p>
              </AccordionSection>

              {!manualEditorMode && <AccordionSection
                id="transcript"
                isOpen={openLeftSection === "transcript"}
                onToggle={(id) => {
                  setSelectedEditorContext("caption");
                  toggleLeftSection(id);
                }}
                summary={transcriptSummary}
                title="Transkrip Klip"
              >
                <div className="max-h-52 overflow-y-auto whitespace-pre-line text-sm leading-6 text-slate-700">
                  {context.data.candidate_transcript || "Transkrip suara belum tersedia untuk klip ini."}
                </div>
              </AccordionSection>}

              <AccordionSection
                id="caption"
                isOpen={openLeftSection === "caption"}
                onToggle={toggleLeftSection}
                summary={captionSummary}
                title="Deskripsi Posting"
              >
                <label htmlFor="social_caption">Deskripsi Posting</label>
                <textarea
                  id="social_caption"
                  rows={6}
                  value={draft.social_caption}
                  onChange={(event) => {
                    set("social_caption", event.target.value);
                    setCaptionCopied(false);
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {!manualEditorMode && (
                    <button
                      className="btn-secondary px-3 py-2 text-xs"
                      disabled={regenerateCaption.isPending || applySource.isPending}
                      onClick={() => regenerateCaption.mutate()}
                      type="button"
                    >
                      {regenerateCaption.isPending ? "Membuat..." : "Buat ulang deskripsi"}
                    </button>
                  )}
                  <button
                    className="btn-secondary px-3 py-2 text-xs"
                    disabled={!draft.social_caption}
                    onClick={copyCaption}
                    type="button"
                  >
                    {captionCopied ? "Tersalin" : "Salin"}
                  </button>
                </div>
              </AccordionSection>

              <AccordionSection
                id="source"
                isOpen={openLeftSection === "source"}
                onToggle={toggleLeftSection}
                summary={sourceUrl || "Link sumber belum diisi"}
                title="Link Sumber"
              >
                <label htmlFor="editor_source_url">Link sumber</label>
                <div className="flex gap-2">
                  <input
                    id="editor_source_url"
                    type="url"
                    placeholder="https://youtube.com/watch?v=..."
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary shrink-0 px-3 py-2 text-xs"
                    disabled={applySource.isPending || !sourceUrl.trim()}
                    onClick={() => applySource.mutate()}
                  >
                    {applySource.isPending ? "..." : "Ambil"}
                  </button>
                </div>
              </AccordionSection>

              {!manualEditorMode && <AccordionSection
                id="potential"
                isOpen={openLeftSection === "potential"}
                onToggle={toggleLeftSection}
                summary={
                  report
                    ? `Transformasi ${report.transformative_value_score.toFixed(0)} / Risiko ${report.copyright_risk_level}`
                    : "Belum dinilai"
                }
                title="Info Potensi"
              >
                <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50 p-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-violet-700">
                      Info Potensi
                    </p>
                    <p className="mt-1 text-sm text-slate-700">
                      {report
                        ? `Transformasi ${report.transformative_value_score.toFixed(0)} / Risiko ${report.copyright_risk_level}`
                        : "Belum dinilai. Jalankan penilaian jika perlu sebelum final."}
                    </p>
                  </div>
                  <button
                    className="btn-secondary px-3 py-2 text-xs"
                    disabled={assess.isPending}
                    onClick={() => assess.mutate()}
                    type="button"
                  >
                    {assess.isPending ? "Menilai..." : "Nilai"}
                  </button>
                </div>
                {report?.recommendations_json?.[0] && (
                  <p className="mt-2 text-xs text-violet-800">{report.recommendations_json[0]}</p>
                )}
              </AccordionSection>}
            </div>
          </section>
        </aside>

        <main className="flex min-h-0 w-full flex-col overflow-hidden bg-[#101214] xl:h-full">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide text-cyan-300">
                {currentRenderLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-300">{previewModeText}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-300">
              <span className="rounded-lg bg-white/10 px-2 py-1">9:16</span>
              <span className="rounded-lg bg-white/10 px-2 py-1">
                {presetOptions.find((item) => item.value === preset)?.label}
              </span>
              <span className="rounded-lg bg-white/10 px-2 py-1">
                {stylePresets.find((item) => item.value === styleConfig.clipper_style_preset)?.label}
              </span>
            </div>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center px-3 py-2.5"
            onClick={() => {
              setSelectedEventId(null);
              setSelectedEditorContext(
                manualEditorMode && videoSequence.length === 0 ? "media" : "video",
              );
            }}
          >
            <div className="relative aspect-[9/16] h-[clamp(320px,44vh,520px)] max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl shadow-black/50 ring-1 ring-white/10">
              {renderedPreviewUrl ? (
                <video
                  className="h-full w-full object-cover"
                  controls
                  muted={audioSettings.muted}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.volume = Math.min(1, audioSettings.volume);
                    setPreviewTimeFromVideo(event.currentTarget.currentTime);
                  }}
                  onPause={handlePreviewPause}
                  onPlay={handlePreviewPlay}
                  onSeeked={(event) => setPreviewTimeFromVideo(event.currentTarget.currentTime)}
                  onTimeUpdate={(event) => setPreviewTimeFromVideo(event.currentTarget.currentTime)}
                  preload="metadata"
                  ref={previewVideoRef}
                  src={renderedPreviewUrl}
                />
              ) : (
                <div
                  className={`absolute inset-0 h-full w-full ${livePreviewFilterClass}`}
                  style={{ ...liveZoomStyle, zIndex: visualLayerZIndex("video") }}
                >
                  <PresetVideo
                    audioMuted={videoTrackDeleted || audioExtracted || audioSettings.muted}
                    audioVolume={audioSettings.volume}
                    src={sourceClipUrl}
                    preset={preset}
                    framing={videoFraming}
                    controls
                    onLoadedMetadata={setPreviewTimeFromVideo}
                    onPause={handlePreviewPause}
                    onPlay={handlePreviewPlay}
                    onSeeked={setPreviewTimeFromVideo}
                    onTimeUpdate={setPreviewTimeFromVideo}
                    videoRef={previewVideoRef}
                  />
                </div>
              )}
              {manualEditorMode && videoSequence.length === 0 && (
                <div
                  className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-zinc-950 p-5 text-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div>
                    <p className="text-base font-black text-zinc-100">
                      Import media untuk mulai mengedit
                    </p>
                    <p className="mt-1 max-w-xs text-xs font-semibold text-zinc-400">
                      Video pertama akan otomatis masuk timeline.
                    </p>
                  </div>
                  <EditorMediaImportControls
                    className="grid w-full max-w-xs grid-cols-1 gap-2"
                    disabled={editorMediaUploading}
                    onImport={importEditorMedia}
                    uploadingKind={editorMediaUploadKind}
                  />
                </div>
              )}
              {audioExtracted && !audioTrackDeleted && !renderedPreviewUrl && (
                <audio
                  aria-label="Preview track audio terpisah"
                  className="hidden"
                  preload="metadata"
                  ref={previewAudioRef}
                  src={sourceMediaUrl}
                />
              )}
              {videoTrackDeleted && !renderedPreviewUrl && (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-10 top-0 flex items-center justify-center bg-black text-sm font-bold text-zinc-500"
                  style={{ zIndex: visualLayerZIndex("video") }}
                >
                  Track Video kosong
                </div>
              )}
              {hookPreviewState.shouldRenderHookOverlay && liveHookEvent && liveHookText && (
                <div
                  data-hook-duplicate-suppressed={
                    hookPreviewState.hookPreviewDuplicateSuppressed
                  }
                  data-hook-render-source={hookPreviewState.hookPreviewRenderSource}
                  className={`pointer-events-auto absolute max-h-20 cursor-pointer overflow-hidden rounded-lg text-center leading-tight ${
                    ""
                  } ${activeHookTemplate.widthClass} ${activeHookTemplate.paddingClass} ${
                    activeHookTemplate.containerClass
                  } ${hookOverlayTextSizeClass(liveHookText, hookTextSize, hookTextTemplate)}`}
                  style={{
                    ...hookUnifiedTextStyle,
                    top: `${hookSafeArea.topPercent}%`,
                    fontSize: `${hookSafeArea.fontSizePx}px`,
                    zIndex: visualLayerZIndex("hook"),
                    textShadow: hookUnifiedTextStyle.textShadow || activeHookTemplate.textShadow,
                    fontFamily: activeHookFont.fontFamily,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedEventId(liveHookEvent.id || null);
                    setSelectedEditorContext("hook");
                  }}
                >
                  {activeHookTemplate.badge && (
                    <span
                      className={`block font-black ${
                        activeHookTemplate.badgeClass || "mb-1 text-[8px] tracking-wide opacity-90"
                      }`}
                    >
                      {activeHookTemplate.badge}
                    </span>
                  )}
                  <span className={`block line-clamp-2 ${activeHookTemplate.textClass}`}>
                    {hookSafeArea.lines.map((line, index) => (
                      <span key={`${line}-${index}`} className="block whitespace-normal">
                        {line}
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {!renderedPreviewAvailable &&
                styleConfig.keyword_popup_enabled &&
                liveKeywordEvent?.text && (
                    <div
                      className="pointer-events-auto absolute bottom-32 left-[16%] right-[16%] max-h-14 cursor-pointer overflow-hidden rounded-md px-2 py-1.5 text-center text-sm leading-tight md:text-base"
                      style={{
                        ...keywordUnifiedTextStyle,
                        zIndex: visualLayerZIndex("keyword"),
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEventId(liveKeywordEvent.id || null);
                        setSelectedEditorContext("keyword");
                      }}
                    >
                      {liveKeywordEvent.text}
                    </div>
              )}
              {captionOverlayText && (
                <div
                  className={`pointer-events-auto absolute left-[8%] right-[8%] cursor-pointer text-center leading-tight ${captionPositionClass(
                    captionStyle.position,
                  )} ${captionSizeClass(
                    captionStyle.fontSize,
                    captionStyle.preset,
                    captionPreviewWordCount,
                  )} ${captionWeightClass(
                    captionStyle.fontWeight,
                  )}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedCaptionId(currentCaptionCue?.id || null);
                    setSelectedEditorContext("caption");
                  }}
                  style={{
                    zIndex: visualLayerZIndex("caption"),
                    color: captionUnifiedTextStyle.color || captionStyle.textColor,
                    fontFamily: captionUnifiedTextStyle.fontFamily,
                    fontWeight: captionUnifiedTextStyle.fontWeight,
                    textTransform: captionUnifiedTextStyle.textTransform,
                    textShadow:
                      captionUnifiedTextStyle.textShadow || captionTextShadow(captionStyle),
                    WebkitTextStroke: captionUnifiedTextStyle.WebkitTextStroke,
                    paintOrder: captionUnifiedTextStyle.paintOrder,
                  }}
                >
                  <span
                    className={`inline-block max-w-full rounded-md px-3 py-1.5 ${
                      captionStyle.backgroundEnabled ? "" : "bg-transparent"
                    }`}
                    style={{
                      backgroundColor: captionStyle.backgroundEnabled
                        ? captionUnifiedTextStyle.backgroundColor ||
                          `rgba(0,0,0,${captionStyle.backgroundOpacity})`
                        : captionUnifiedTextStyle.backgroundColor || "transparent",
                    }}
                  >
                    <span className="block break-words">
                      {captionStyle.displayMode === "karaoke" ? (
                        karaokeWords.map((word, index) => (
                          <span
                            key={`${word}-${index}`}
                            style={{
                              color:
                                index === karaokeActiveIndex
                                  ? captionStyle.highlightColor
                                  : captionUnifiedTextStyle.color || captionStyle.textColor,
                            }}
                          >
                            {word}
                            {index < karaokeWords.length - 1 ? " " : ""}
                          </span>
                        ))
                      ) : (
                        captionOverlayText
                      )}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
          {activeRender?.status === "failed" && (
            <div className="mx-4 mb-3 rounded-xl bg-red-950/70 p-2.5 text-xs font-semibold text-red-100">
              {activeRender.error_message || "Export gagal."}
            </div>
          )}
          {keywordSkipped && (
            <div className="mx-4 mb-3 rounded-xl bg-amber-900/70 p-2.5 text-xs font-semibold text-amber-100">
              Keyword pop-up dilewati karena tidak ada kata/frasa penting yang layak.
            </div>
          )}
        </main>

        <aside className="editor-sidepanel editor-inspector min-h-0 space-y-3 bg-[#1d1f23] p-3 xl:h-full xl:overflow-y-auto">
          <section className="sticky top-0 z-10 rounded-xl border border-zinc-700 bg-[#25282d]/95 p-3 shadow-lg backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-violet-600">
                  Contextual Tools
                </p>
                <h2 className="mt-1 truncate text-base font-black text-slate-950">
                  {selectedEditorContext === "media"
                    ? "Media Editor"
                    : selectedEditorContext === "audio"
                    ? "Audio Tools"
                    : selectedEditorContext === "caption"
                      ? "Caption Tools"
                      : selectedEditorContext === "hook"
                      ? "Hook Tools"
                      : selectedEditorContext === "keyword"
                        ? `Keyword: ${selectedEvent?.text || "Pilih keyword"}`
                        : selectedEditorContext === "effect"
                          ? selectedEvent?.type === "pattern_interrupt"
                            ? "Pattern Tools"
                            : "Punch Zoom Tools"
                          : selectedEditorContext === "timeline"
                            ? "Timeline Tools"
                            : selectedEditorContext === "render"
                              ? "Export Tools"
                              : "Video Tools"}
                </h2>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${editorSaveStatusClass}`}
                title={editorSaveStatusTitle}
              >
                {editorSaveStatusLabel}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1">
              {contextualTabs.map(([contextValue, label]) => (
                <button
                  className={`rounded-lg px-2 py-2 text-xs font-black ${
                    selectedEditorContext === contextValue
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                  key={contextValue}
                  onClick={() => {
                    if (contextValue === "hook") {
                      setSelectedEventId(hookEvents[0]?.id || null);
                    } else if (contextValue === "keyword") {
                      setSelectedEventId(
                        editableEffectTimeline.find((event) => event.type === "keyword_popup")?.id || null,
                      );
                    } else if (contextValue === "effect") {
                      setSelectedEventId(
                        editableEffectTimeline.find(
                          (event) => event.type === "punch_zoom" || event.type === "pattern_interrupt",
                        )?.id || null,
                      );
                    } else {
                      setSelectedEventId(null);
                    }
                    setSelectedEditorContext(contextValue);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {(!manualEditorMode || selectedEditorContext === "media") && (
          <ToolSection title="Media Editor">
            <p className="text-[11px] font-semibold text-zinc-500">
              Impor video, audio, atau gambar langsung dari editor.
            </p>
            <EditorMediaImportControls
              className="mt-2 grid grid-cols-1 gap-2"
              disabled={editorMediaUploading}
              onImport={importEditorMedia}
              uploadingKind={editorMediaUploadKind}
            />
            {editorMediaQuery.isLoading ? (
              <p className="mt-3 text-xs font-semibold text-zinc-400">Memuat media...</p>
            ) : editorMediaQuery.data?.length ? (
              <div className="mt-3 space-y-2">
                {editorMediaQuery.data.map((asset) => (
                  <div
                    className="rounded-xl border border-zinc-700 bg-[#25282d] p-2"
                    key={asset.asset_id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-black text-zinc-100">
                        {asset.name}
                      </span>
                      <span className="shrink-0 rounded bg-zinc-700 px-1 text-[10px] uppercase text-zinc-300">
                        {asset.kind}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      {asset.kind === "image" ? (
                        <span className="px-1 py-1 text-[10px] font-bold text-emerald-600">
                          Tersimpan di media
                        </span>
                      ) : (
                        <button
                          className="btn-secondary px-2 py-1 text-[10px]"
                          onClick={() => addEditorMediaToTimeline(asset)}
                          type="button"
                        >
                          + Timeline
                        </button>
                      )}
                      {asset.kind !== "image" && (
                        <a
                          className="btn-secondary px-2 py-1 text-[10px]"
                          href={mediaUrl(transformationId, asset.asset_id)}
                          target="_blank"
                        >
                          Putar
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-semibold text-zinc-500">
                Belum ada media diimpor.
              </p>
            )}
          </ToolSection>
          )}

          {selectedEditorContext === "video" && (
            <>
          <ToolSection title="Track Video">
            <div className="rounded-xl bg-blue-50 p-3 text-xs font-semibold text-blue-800">
              <p className="font-black">Video utama • {formatTimeLabel(clipDuration)}</p>
              <p className="mt-1">Track video aktif penuh. Pilih template di bawah untuk crop dan layout hasil export.</p>
            </div>
          </ToolSection>
          <ToolSection title="Frame Position">
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => setVideoFraming({ x: videoFraming.x - 5 })}
                type="button"
              >
                Geser Kiri
              </button>
              <button
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => setVideoFraming({ x: videoFraming.x + 5 })}
                type="button"
              >
                Geser Kanan
              </button>
              <button
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => setVideoFraming({ y: videoFraming.y - 5 })}
                type="button"
              >
                Geser Atas
              </button>
              <button
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => setVideoFraming({ y: videoFraming.y + 5 })}
                type="button"
              >
                Geser Bawah
              </button>
              <button
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => setVideoFraming({ scale: videoFraming.scale - 0.05 })}
                type="button"
              >
                Zoom -
              </button>
              <button
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => setVideoFraming({ scale: videoFraming.scale + 0.05 })}
                type="button"
              >
                Zoom +
              </button>
            </div>

            <div className="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3">
              <label className="text-xs font-bold text-slate-700" htmlFor="video_framing_x">
                <span className="flex items-center justify-between gap-2">
                  <span>Posisi X</span>
                  <span>{videoFraming.x.toFixed(0)}</span>
                </span>
                <input
                  className="mt-1 w-full accent-violet-600"
                  id="video_framing_x"
                  max={40}
                  min={-40}
                  onChange={(event) => setVideoFraming({ x: Number(event.target.value) })}
                  step={1}
                  type="range"
                  value={videoFraming.x}
                />
              </label>
              <label className="text-xs font-bold text-slate-700" htmlFor="video_framing_y">
                <span className="flex items-center justify-between gap-2">
                  <span>Posisi Y</span>
                  <span>{videoFraming.y.toFixed(0)}</span>
                </span>
                <input
                  className="mt-1 w-full accent-violet-600"
                  id="video_framing_y"
                  max={40}
                  min={-40}
                  onChange={(event) => setVideoFraming({ y: Number(event.target.value) })}
                  step={1}
                  type="range"
                  value={videoFraming.y}
                />
              </label>
              <label className="text-xs font-bold text-slate-700" htmlFor="video_framing_scale">
                <span className="flex items-center justify-between gap-2">
                  <span>Zoom</span>
                  <span>{videoFraming.scale.toFixed(2)}x</span>
                </span>
                <input
                  className="mt-1 w-full accent-violet-600"
                  id="video_framing_scale"
                  max={2}
                  min={1}
                  onChange={(event) => setVideoFraming({ scale: Number(event.target.value) })}
                  step={0.05}
                  type="range"
                  value={videoFraming.scale}
                />
              </label>
            </div>

            <button
              className="btn-secondary mt-3 w-full px-3 py-2 text-xs"
              onClick={() => setVideoFraming(defaultVideoFraming)}
              type="button"
            >
              Reset Framing
            </button>
            <p className="mt-3 text-[11px] font-semibold leading-relaxed text-slate-500">
              Framing berlaku untuk Potong tengah dan foreground Latar buram pada Live Preview
              serta file export.
            </p>
          </ToolSection>
          <ToolSection title="Template Video">
            <select
              className="w-full"
              id="context_video_template"
              onChange={(event) => selectPreset(event.target.value as RenderPreset)}
              value={preset}
            >
              {presetOptions.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] font-semibold leading-tight text-slate-500">
              {presetOptions.find((item) => item.value === preset)?.description}
            </p>
          </ToolSection>

          <ToolSection title="Gaya Editing">
            <select
              className="w-full"
              id="context_editing_style"
              onChange={(event) => {
                const nextStyle = event.target.value as keyof typeof styleDefaults;
                setRenderDirty(true);
                setRender(undefined);
                set("clipper_style_config", {
                  ...styleDefaults[nextStyle],
                  hook_text: styleConfig.hook_text,
                  hook_text_template: styleConfig.hook_text_template,
                  hook_text_font: styleConfig.hook_text_font,
                  hook_text_position: styleConfig.hook_text_position,
                  hook_text_size: styleConfig.hook_text_size,
                  hook_text_style_preset: styleConfig.hook_text_style_preset,
                  keyword_text_style_preset: styleConfig.keyword_text_style_preset,
                  caption_style: styleConfig.caption_style,
                  effect_timeline: styleConfig.effect_timeline || [],
                  audio_settings: audioSettings,
                  media_trim: styleConfig.media_trim,
                  media_split_points: styleConfig.media_split_points || [],
                  media_sequence: styleConfig.media_sequence || [],
                  video_sequence: styleConfig.video_sequence || [],
                  audio_sequence: styleConfig.audio_sequence || [],
                  audio_extracted: audioExtracted,
                  video_track_deleted: videoTrackDeleted,
                  audio_track_deleted: audioTrackDeleted,
                  video_framing: videoFraming,
                  editor_state_version: styleConfig.editor_state_version || 0,
                  video_sequence_initialized:
                    styleConfig.video_sequence_initialized || false,
                  audio_sequence_initialized:
                    styleConfig.audio_sequence_initialized || false,
                  caption_timeline_initialized:
                    styleConfig.caption_timeline_initialized || false,
                  effect_timeline_initialized:
                    styleConfig.effect_timeline_initialized || false,
                  layer_order: visualLayerOrder,
                  track_order: trackOrder,
                  additional_audio_assets: additionalAudioAssets,
                  additional_audio_tracks: additionalAudioTracks,
                  caption_timeline: styleConfig.caption_timeline || [],
                  render_preset: preset,
                });
              }}
              value={styleConfig.clipper_style_preset}
            >
              {stylePresets.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </ToolSection>

          <ToolSection title="Efek Gaya">
            <div className="grid gap-2">
              {[
                ["hook_text_enabled", "Hook text awal"],
                ["punch_zoom_enabled", "Punch zoom"],
                ["pattern_interrupt_enabled", "Pattern interrupt"],
                ["keyword_popup_enabled", "Keyword pop-up"],
              ].map(([key, label]) => (
                <label
                  className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-sm font-bold"
                  key={key}
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    className="size-5 w-5 accent-violet-600"
                    checked={Boolean(styleConfig[key as keyof typeof styleConfig])}
                    onChange={(event) => setStyle(key, event.target.checked)}
                  />
                </label>
              ))}
            </div>
            <div>
              <label htmlFor="style_intensity">Intensity</label>
              <select
                id="style_intensity"
                value={styleConfig.style_intensity}
                onChange={(event) => setStyle("style_intensity", event.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600">
              <p>Effect timeline</p>
              <p className="mt-1">
                Punch zoom: {effectSummary.punch} momen / Keyword pop-up:{" "}
                {effectSummary.keyword} momen / Pattern: {effectSummary.pattern} momen
              </p>
              {styleConfig.pattern_interrupt_enabled && effectSummary.pattern === 0 && (
                <p className="mt-1 text-amber-700">
                  Pattern interrupt disimpan sebagai opsi aman, belum ditampilkan jika tidak ada event valid.
                </p>
              )}
              {keywordSkipped && (
                <p className="mt-1 text-amber-700">
                  Keyword pop-up dilewati karena tidak ada kata/frasa penting yang layak.
                </p>
              )}
            </div>
          </ToolSection>
            </>
          )}

          {selectedEditorContext === "audio" && (
            <>
            <ToolSection title="Audio Asli">
              <div className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                <p className="font-black">Track audio sumber • {formatTimeLabel(clipDuration)}</p>
                <p className="mt-1">Perubahan diterapkan pada live preview dan file hasil export.</p>
              </div>

              <label className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-bold">
                <span>Mute audio</span>
                <input
                  checked={audioSettings.muted}
                  className="size-5 accent-violet-600"
                  onChange={(event) => setAudioSettings({ muted: event.target.checked })}
                  type="checkbox"
                />
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="source_audio_volume">Volume</label>
                  <strong className="text-xs text-slate-600">{Math.round(audioSettings.volume * 100)}%</strong>
                </div>
                <input
                  className="w-full accent-violet-600"
                  disabled={audioSettings.muted}
                  id="source_audio_volume"
                  max={2}
                  min={0}
                  onChange={(event) => setAudioSettings({ volume: Number(event.target.value) })}
                  step={0.05}
                  type="range"
                  value={audioSettings.volume}
                />
                <p className="mt-1 text-[11px] font-semibold text-slate-400">0% hingga 200%</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="source_audio_fade_in">Fade in (detik)</label>
                  <input
                    id="source_audio_fade_in"
                    max={5}
                    min={0}
                    onChange={(event) => setAudioSettings({ fade_in: Number(event.target.value) })}
                    step={0.1}
                    type="number"
                    value={audioSettings.fade_in}
                  />
                </div>
                <div>
                  <label htmlFor="source_audio_fade_out">Fade out (detik)</label>
                  <input
                    id="source_audio_fade_out"
                    max={5}
                    min={0}
                    onChange={(event) => setAudioSettings({ fade_out: Number(event.target.value) })}
                    step={0.1}
                    type="number"
                    value={audioSettings.fade_out}
                  />
                </div>
              </div>

              <button
                className="btn-secondary w-full px-3 py-2 text-xs"
                onClick={() => setAudioSettings(defaultAudioSettings)}
                type="button"
              >
                Reset audio
              </button>
            </ToolSection>
            <ToolSection title="Library Audio">
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                {([
                  ["music", "Musik / Backsound"],
                  ["sfx", "Sound Effect"],
                  ["uploads", "Upload Saya"],
                ] as const).map(([value, label]) => (
                  <button
                    className={`rounded-md px-2 py-2 text-[10px] font-black ${
                      audioLibraryTab === value
                        ? "bg-violet-600 text-white"
                        : "text-slate-600 hover:bg-white"
                    }`}
                    key={value}
                    onClick={() => setAudioLibraryTab(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {audioLibraryTab !== "uploads" ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs font-semibold text-slate-500">
                  Belum ada aset musik bebas royalti. Upload audio sendiri atau tambahkan file ke library lokal.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-black text-slate-700">Upload Saya</p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      MP3, WAV, atau M4A · maksimal 50 MB.
                    </p>
                    <label className="btn-secondary mt-3 block cursor-pointer px-3 py-2 text-center text-xs">
                      {audioUploading ? `Mengupload ${audioUploadProgress}%` : "Upload Audio"}
                      <input
                        accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
                        className="hidden"
                        disabled={audioUploading}
                        onChange={(event) => {
                          void handleAdditionalAudioUpload(event.target.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                  </div>

                  {!additionalAudioAssets.length ? (
                    <p className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-500">
                      Belum ada audio yang diupload.
                    </p>
                  ) : (
                    additionalAudioAssets.map((asset) => (
                      <div className="rounded-xl border border-slate-200 bg-white p-3" key={asset.id}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-black text-slate-800">{asset.name}</p>
                            <p className="mt-1 text-[10px] font-semibold text-slate-500">
                              {formatTimeLabel(asset.duration_seconds)} · {(asset.size_bytes / 1024 / 1024).toFixed(1)} MB
                            </p>
                          </div>
                        </div>
                        <audio
                          className="mt-2 h-8 w-full"
                          controls
                          preload="metadata"
                          src={uploadedAudioUrl(transformationId, asset.id)}
                        />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            className="btn-secondary px-2 py-2 text-[10px]"
                            onClick={() => addAdditionalAudioTrack(asset, "backsound")}
                            type="button"
                          >
                            + Backsound
                          </button>
                          <button
                            className="btn-secondary px-2 py-2 text-[10px]"
                            onClick={() => addAdditionalAudioTrack(asset, "sfx")}
                            type="button"
                          >
                            + Sound Effect
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {selectedAdditionalAudioTrack && (
                <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-xs text-fuchsia-900">
                  <p className="font-black">{selectedAdditionalAudioTrack.label} terpilih</p>
                  <p className="mt-1 font-semibold">
                    {formatTimePrecise(selectedAdditionalAudioTrack.start)}–{formatTimePrecise(selectedAdditionalAudioTrack.end)}
                  </p>
                  <button
                    className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                    onClick={deleteSelectedTrackItem}
                    type="button"
                  >
                    Hapus dari Timeline
                  </button>
                </div>
              )}

              <p className="rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">
                Mix audio tambahan ke live preview/output export akan disempurnakan pada tahap berikutnya. Export saat ini tetap memakai audio asli.
              </p>
            </ToolSection>
            </>
          )}

          {selectedEditorContext === "caption" && (
            <ToolSection title="Caption Style Studio">
              {captionSyncRequired && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <p className="text-xs font-black">
                    Susunan video berubah. Caption mungkin perlu disinkronkan ulang.
                  </p>
                </div>
              )}
              <button
                className="btn-secondary w-full px-3 py-2 text-xs"
                onClick={syncCaptionWithVideo}
                type="button"
              >
                Sinkronkan Caption dengan Video
              </button>
              {selectedCaption ? (
                <div className="rounded-xl border-2 border-cyan-300 bg-cyan-50 p-3 text-slate-800 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-wide text-cyan-800">
                      Caption Terpilih
                    </p>
                    <span className="rounded-full bg-cyan-200 px-2 py-1 text-[10px] font-black text-cyan-900">
                      Dipilih user
                    </span>
                  </div>
                  <label className="mt-3 block text-xs font-black text-slate-700" htmlFor="selected_caption_text">
                    Teks caption
                  </label>
                  <textarea
                    className="mt-1 min-h-24 w-full resize-y rounded-lg border border-cyan-200 bg-white p-3 text-sm font-semibold leading-relaxed text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                    id="selected_caption_text"
                    onBlur={finishSelectedCaptionTextEdit}
                    onChange={(event) => updateSelectedCaptionText(event.target.value)}
                    placeholder="Caption ini kosong."
                    value={selectedCaption.text || ""}
                  />
                  {!selectedCaptionText && (
                    <p className="mt-2 text-xs font-bold text-slate-500">Caption ini kosong.</p>
                  )}
                  {selectedCaptionWordCount > captionStyle.maxWords && (
                    <p className="mt-2 rounded-lg bg-amber-100 p-2 text-xs font-bold text-amber-900">
                      Cue ini panjang. Gunakan Rapikan Cue Ini.
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white p-2">
                      <p className="font-semibold text-slate-500">Mulai</p>
                      <p className="mt-1 font-black text-slate-800">
                        {formatTimePrecise(selectedCaption.start)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      <p className="font-semibold text-slate-500">Selesai</p>
                      <p className="mt-1 font-black text-slate-800">
                        {formatTimePrecise(selectedCaption.end)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      <p className="font-semibold text-slate-500">Durasi</p>
                      <p className="mt-1 font-black text-slate-800">
                        {selectedCaptionDuration.toFixed(2)} detik
                      </p>
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      <p className="font-semibold text-slate-500">Isi</p>
                      <p className="mt-1 font-black text-slate-800">
                        {selectedCaptionWordCount} kata / {selectedCaptionCharacterCount} karakter
                      </p>
                    </div>
                  </div>
                  {import.meta.env.DEV && (
                    <p className="mt-2 break-all font-mono text-[10px] text-cyan-800">
                      Cue ID: {selectedCaption.id}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      className="btn-secondary px-3 py-2 text-xs"
                      onClick={reflowSelectedCaption}
                      type="button"
                    >
                      Rapikan Cue Ini
                    </button>
                    <button
                      className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100"
                      onClick={deleteSelectedCaptionCue}
                      type="button"
                    >
                      Hapus Caption
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                  <p className="text-sm font-bold text-slate-700">
                    Klik salah satu caption di timeline untuk melihat teksnya.
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {timelineCaptionItems.length} cue tersedia.
                  </p>
                </div>
              )}

              <button
                className="btn-secondary w-full px-3 py-2 text-xs"
                disabled={!editableCaptionCues.length}
                onClick={reflowAllCaptions}
                type="button"
              >
                Rapikan Semua Caption
              </button>

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                  Mode Tampilan Caption
                </p>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                  {([
                    ["segment", "Segment"],
                    ["karaoke", "Karaoke"],
                    ["word_by_word", "Word by Word"],
                  ] as Array<[CaptionDisplayMode, string]>).map(([value, label]) => (
                    <button
                      className={`min-h-9 rounded-md px-2 text-[11px] font-black transition-colors ${
                        captionStyle.displayMode === value
                          ? "bg-white text-violet-700 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                      key={value}
                      onClick={() =>
                        setCaptionStyle({
                          displayMode: value,
                          karaokeEnabled: value === "karaoke",
                        })
                      }
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs font-black text-slate-600">Target kata per cue</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[3, 4, 5].map((wordTarget) => (
                    <button
                      className={`rounded-lg border px-3 py-2 text-xs font-black ${
                        captionStyle.maxWords === wordTarget
                          ? "border-violet-600 bg-violet-50 text-violet-700"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                      key={wordTarget}
                      onClick={() => setCaptionStyle({ maxWords: wordTarget })}
                      type="button"
                    >
                      {wordTarget} kata
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] font-semibold leading-relaxed text-slate-500">
                  Mode Word by Word dan Karaoke masih estimasi sampai tersedia timing kata per kata.
                </p>
              </div>

              {previewPlaying && currentCaptionCue && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-wide text-violet-800">
                      Caption aktif saat ini
                    </p>
                    <span className="rounded-full bg-violet-200 px-2 py-1 text-[10px] font-black text-violet-900">
                      Mengikuti playhead
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-slate-900">
                    {String(currentCaptionCue.text || "").trim() || "Caption ini kosong."}
                  </p>
                  <p className="mt-2 text-xs font-bold text-violet-800">
                    {formatTimePrecise(currentCaptionCue.start)} - {formatTimePrecise(currentCaptionCue.end)}
                  </p>
                </div>
              )}

              <div>
                <label
                  className="text-xs font-black uppercase tracking-wide text-slate-500"
                  htmlFor="caption_style_preset"
                >
                  Preset Caption
                </label>
                <select
                  className="mt-2 w-full"
                  id="caption_style_preset"
                  onChange={(event) => {
                    const selectedPreset = captionStylePresets.find(
                      (item) => item.value === event.target.value,
                    );
                    if (!selectedPreset) return;
                    setCaptionStyle({
                      ...selectedPreset.config,
                      displayMode: captionStyle.displayMode,
                      maxWords: captionStyle.maxWords,
                      karaokeEnabled: captionStyle.displayMode === "karaoke",
                    });
                  }}
                  value={captionStyle.preset}
                >
                  {captionStylePresets.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[10px] font-semibold leading-tight text-slate-500">
                  {captionStylePresets.find((item) => item.value === captionStyle.preset)?.description}
                </p>
              </div>

              <TextStylePresetSelector
                label="Gaya Teks Caption"
                onChange={(value) => setCaptionStyle({ textPreset: value })}
                value={captionStyle.textPreset}
              />

              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Pengaturan dasar
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="caption_font_size">Ukuran</label>
                    <select
                      id="caption_font_size"
                      value={captionStyle.fontSize}
                      onChange={(event) =>
                        setCaptionStyle({
                          fontSize: event.target.value as CaptionStyleConfig["fontSize"],
                        })
                      }
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="caption_font_weight">Weight</label>
                    <select
                      id="caption_font_weight"
                      value={captionStyle.fontWeight}
                      onChange={(event) =>
                        setCaptionStyle({
                          fontWeight: event.target.value as CaptionStyleConfig["fontWeight"],
                        })
                      }
                    >
                      <option value="normal">Normal</option>
                      <option value="semibold">Semibold</option>
                      <option value="bold">Bold</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="caption_position">Posisi</label>
                    <select
                      id="caption_position"
                      value={captionStyle.position}
                      onChange={(event) =>
                        setCaptionStyle({
                          position: event.target.value as CaptionStyleConfig["position"],
                        })
                      }
                    >
                      <option value="bottom">Bottom</option>
                      <option value="center_lower">Center lower</option>
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="caption_text_color">Text</label>
                    <input
                      id="caption_text_color"
                      type="color"
                      value={captionStyle.textColor}
                      onChange={(event) => setCaptionStyle({ textColor: event.target.value })}
                    />
                  </div>
                  <div>
                    <label htmlFor="caption_highlight_color">Highlight</label>
                    <input
                      id="caption_highlight_color"
                      type="color"
                      value={captionStyle.highlightColor}
                      onChange={(event) => setCaptionStyle({ highlightColor: event.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="caption_max_chars">Karakter</label>
                    <input
                      id="caption_max_chars"
                      max={45}
                      min={10}
                      type="number"
                      value={captionStyle.maxChars}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setCaptionStyle({ maxChars: value });
                      }}
                    />
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {[
                    ["outlineEnabled", "Outline"],
                    ["shadowEnabled", "Shadow"],
                    ["backgroundEnabled", "Background box"],
                  ].map(([key, label]) => (
                    <label
                      className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700"
                      key={key}
                    >
                      <span>{label}</span>
                      <input
                        checked={Boolean(captionStyle[key as keyof CaptionStyleConfig])}
                        className="size-4 accent-violet-600"
                        onChange={(event) =>
                          setCaptionStyle({
                            [key]: event.target.checked,
                          } as Partial<CaptionStyleConfig>)
                        }
                        type="checkbox"
                      />
                    </label>
                  ))}
                </div>
                {captionStyle.backgroundEnabled && (
                  <div className="mt-3">
                    <label htmlFor="caption_background_opacity">Background opacity</label>
                    <input
                      id="caption_background_opacity"
                      max={0.85}
                      min={0}
                      step={0.05}
                      type="range"
                      value={captionStyle.backgroundOpacity}
                      onChange={(event) =>
                        setCaptionStyle({ backgroundOpacity: Number(event.target.value) })
                      }
                    />
                  </div>
                )}
              </div>

              <p className="rounded-xl bg-violet-50 p-3 text-xs font-semibold text-violet-800">
                Teks, timing, dan gaya dasar Caption diterapkan ke Live Preview serta file export.
                Mode tampilan tertentu dapat memiliki perbedaan kecil pada MP4.
              </p>
              {!transcriptionReady && (
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  Subtitle audio asli belum aktif.
                  {context.data.configured_transcription_provider !== "mock" && (
                    <button className="mt-2 block font-bold underline" onClick={() => reprocess.mutate()}>
                      Proses ulang speech-to-text
                    </button>
                  )}
                </div>
              )}
            </ToolSection>
          )}

          {selectedEditorContext === "timeline" && (
            <ToolSection title="Timeline Tools">
              {manualEditorMode &&
                !styleConfig.video_sequence?.length &&
                !(styleConfig.additional_audio_assets?.length) &&
                !(styleConfig.editor_image_assets?.length) && (
                  <div className="mb-3 rounded-xl border border-dashed border-zinc-300 bg-slate-50 p-3 text-xs font-semibold text-slate-500">
                    Tambahkan video, audio, atau gambar ke timeline dari panel Media.
                  </div>
                )}
              <div className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                Playhead: <strong>{formatTimeLabel(previewTime)}</strong>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-secondary px-3 py-2 text-xs" onClick={() => addEvent("punch_zoom")}>
                  + Punch
                </button>
                <button className="btn-secondary px-3 py-2 text-xs" onClick={() => addEvent("keyword_popup")}>
                  + Keyword
                </button>
                <button className="btn-secondary px-3 py-2 text-xs" onClick={() => addEvent("pattern_interrupt")}>
                  + Pattern
                </button>
                {!editableEffectTimeline.some((event) => event.type === "hook_text") && (
                  <button className="btn-secondary px-3 py-2 text-xs" onClick={() => addEvent("hook_text")}>
                    + Hook
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-xs font-semibold text-slate-600">
                Caption: {timelineCaptionItems.length} cue / Hook: {timelineHookItems.length} / Punch:{" "}
                {effectSummary.punch} / Keyword: {effectSummary.keyword} / Pattern: {effectSummary.pattern}
              </div>
              <p className="text-xs font-semibold text-slate-500">
                Klik marker untuk mengedit detail event.
              </p>
            </ToolSection>
          )}

          {(selectedEditorContext === "hook" ||
            selectedEditorContext === "keyword" ||
            selectedEditorContext === "effect") && (
            <ToolSection
              title={
                selectedEditorContext === "hook"
                  ? "Hook Tools"
                  : selectedEditorContext === "keyword"
                    ? "Keyword Tools"
                    : "Effect Tools"
              }
            >
              {selectedEditorContext === "hook" && (
                <>
                  <div>
                    <label
                      className="text-xs font-black uppercase tracking-wide text-slate-500"
                      htmlFor="hook_text_template"
                    >
                      Template Hook
                    </label>
                    <select
                      className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-violet-500"
                      id="hook_text_template"
                      onChange={(event) => setStyle("hook_text_template", event.target.value)}
                      value={hookTextTemplate}
                    >
                      {hookTextTemplates.map((template) => (
                        <option key={template.value} value={template.value}>
                          {template.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[10px] font-semibold leading-tight text-slate-500">
                      {activeHookTemplate.description}
                    </p>
                  </div>

                  <TextStylePresetSelector
                    label="Gaya Teks Hook"
                    onChange={(value) => setStyle("hook_text_style_preset", value)}
                    value={hookTextStylePreset}
                  />

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label
                      className="text-xs font-black uppercase tracking-wide text-slate-500"
                      htmlFor="hook_text_font"
                    >
                      Font Hook
                    </label>
                    <select
                      className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-violet-500"
                      id="hook_text_font"
                      onChange={(event) => setStyle("hook_text_font", event.target.value)}
                      style={{ fontFamily: activeHookFont.fontFamily }}
                      value={hookTextFont}
                    >
                      {hookTextFonts.map((font) => (
                        <option key={font.value} value={font.value}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[10px] font-semibold leading-tight text-slate-500">
                      {activeHookFont.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
                    <div>
                      <p className="text-xs font-black text-slate-600">Posisi</p>
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        {(["safe_top", "top", "upper_center"] as HookTextPosition[]).map((position) => (
                          <button
                            className={`rounded-md px-2 py-2 text-[10px] font-black ${
                              hookTextPosition === position
                                ? "bg-violet-600 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                            key={position}
                            onClick={() => setStyle("hook_text_position", position)}
                            type="button"
                          >
                            {position === "safe_top"
                              ? "Paling Atas"
                              : position === "top"
                                ? "Atas"
                                : "Tengah Atas"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-600">Ukuran</p>
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        {(["normal", "large"] as HookTextSize[]).map((size) => (
                          <button
                            className={`rounded-md px-2 py-2 text-[10px] font-black ${
                              hookTextSize === size
                                ? "bg-violet-600 text-white"
                                : "bg-slate-100 text-slate-600"
                            }`}
                            key={size}
                            onClick={() => setStyle("hook_text_size", size)}
                            type="button"
                          >
                            {size === "normal" ? "Normal" : "Besar"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] font-semibold leading-relaxed text-slate-500">
                    Style Hook berlaku untuk Live Preview. Hook tetap dapat dihapus dari timeline.
                  </p>
                </>
              )}
              {selectedEditorContext === "keyword" && (
                <TextStylePresetSelector
                  label="Gaya Teks Keyword"
                  onChange={(value) => setStyle("keyword_text_style_preset", value)}
                  value={keywordTextStylePreset}
                />
              )}
              {!selectedEvent ? (
                <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                  Pilih marker di timeline untuk mengedit detail event.
                </p>
              ) : (
                <>
                  {(selectedEditorContext === "hook" || selectedEditorContext === "keyword") && (
                    <div>
                      <label htmlFor="context_event_text">
                        {selectedEditorContext === "hook" ? "Text hook" : "Keyword"}
                      </label>
                      <input
                        id="context_event_text"
                        value={selectedEvent.text || ""}
                        onChange={(event) => {
                          const text =
                            selectedEditorContext === "keyword"
                              ? sanitizeKeywordInput(event.target.value)
                              : event.target.value.slice(0, 70);
                          if (selectedEditorContext === "keyword") {
                            setTimelineError(
                              text && !isValidKeyword(text)
                                ? "Keyword belum layak. Hindari stopword tunggal."
                                : "",
                            );
                          }
                          replaceEvent(selectedEvent.id || "", { text });
                        }}
                      />
                      {selectedEditorContext === "keyword" && selectedEvent.text && !isValidKeyword(selectedEvent.text) && (
                        <p className="mt-1 text-xs font-semibold text-red-600">
                          Keyword tidak valid. Gunakan 1-4 kata bermakna.
                        </p>
                      )}
                    </div>
                  )}
                  {selectedEditorContext !== "hook" && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="context_event_start">Start</label>
                          <input
                            id="context_event_start"
                            max={clipDuration}
                            min={0}
                            step={0.1}
                            type="number"
                            value={selectedEvent.start}
                            onChange={(event) => {
                              const bounds = eventDurationBounds(selectedEvent.type);
                              const nextStart = clampClipTime(Number(event.target.value));
                              const nextEnd = Math.min(
                                clipDuration,
                                Math.max(nextStart + bounds.min, selectedEvent.end),
                              );
                              replaceEvent(selectedEvent.id || "", {
                                start: Number(nextStart.toFixed(2)),
                                end: Number(nextEnd.toFixed(2)),
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label htmlFor="context_event_end">End</label>
                          <input
                            id="context_event_end"
                            max={clipDuration}
                            min={0}
                            step={0.1}
                            type="number"
                            value={selectedEvent.end}
                            onChange={(event) => {
                              const bounds = eventDurationBounds(selectedEvent.type);
                              const rawEnd = clampClipTime(Number(event.target.value));
                              const maxEnd = Math.min(
                                clipDuration,
                                selectedEvent.start + bounds.max,
                              );
                              const nextEnd = Math.min(
                                maxEnd,
                                Math.max(selectedEvent.start + bounds.min, rawEnd),
                              );
                              replaceEvent(selectedEvent.id || "", {
                                end: Number(nextEnd.toFixed(2)),
                              });
                            }}
                          />
                        </div>
                      </div>
                      <p className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600">
                        Durasi: {(selectedEvent.end - selectedEvent.start).toFixed(1)} detik
                        {selectedEvent.reason ? ` / Reason: ${selectedEvent.reason}` : ""}
                      </p>
                    </>
                  )}
                  {selectedEvent.type === "punch_zoom" && (
                    <div>
                      <label htmlFor="context_event_zoom">Zoom</label>
                      <input
                        id="context_event_zoom"
                        max={1.18}
                        min={1.01}
                        step={0.01}
                        type="number"
                        value={selectedEvent.zoom || 1.1}
                        onChange={(event) =>
                          replaceEvent(selectedEvent.id || "", {
                            zoom: Number(Number(event.target.value).toFixed(2)),
                          })
                        }
                      />
                    </div>
                  )}
                  {selectedEvent.type === "pattern_interrupt" && (
                    <div>
                      <label htmlFor="context_event_pattern">Effect type</label>
                      <select
                        id="context_event_pattern"
                        value={selectedEvent.effect || "quick_zoom_shift"}
                        onChange={(event) =>
                          replaceEvent(selectedEvent.id || "", { effect: event.target.value })
                        }
                      >
                        <option value="quick_zoom_shift">quick_zoom_shift</option>
                        <option value="flash_cut">flash_cut</option>
                      </select>
                    </div>
                  )}
                  {selectedEditorContext !== "hook" && (
                    <button
                      className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                      onClick={() => deleteEvent(selectedEvent.id || "")}
                      type="button"
                    >
                      Hapus event
                    </button>
                  )}
                </>
              )}
            </ToolSection>
          )}

        </aside>
      </div>

      <section
        className="editor-timeline relative min-h-0 shrink-0 border-t border-zinc-700 bg-[#181a1e] p-3 text-zinc-100 xl:overflow-hidden"
        style={{ height: `${timelineHeight}px` }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          setSelectedEventId(null);
          setSelectedEditorContext("timeline");
        }}
      >
        <div
          aria-label="Ubah tinggi timeline"
          aria-orientation="horizontal"
          aria-valuemax={Math.max(320, window.innerHeight - 280)}
          aria-valuemin={220}
          aria-valuenow={Math.round(timelineHeight)}
          className="timeline-resize-handle group absolute -top-1.5 left-0 right-0 z-30 flex h-3 touch-none cursor-ns-resize items-center justify-center"
          onDoubleClick={() => {
            markEditorPreferenceDirty();
            setTimelineHeight(320);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              markEditorPreferenceDirty();
              setTimelineHeight((height) => clampTimelineHeight(height + 20));
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              markEditorPreferenceDirty();
              setTimelineHeight((height) => clampTimelineHeight(height - 20));
            }
            if (event.key === "Home") {
              event.preventDefault();
              markEditorPreferenceDirty();
              setTimelineHeight(320);
            }
          }}
          onPointerCancel={handleTimelineResizeEnd}
          onPointerDown={handleTimelineResizeStart}
          onPointerMove={handleTimelineResizeMove}
          onPointerUp={handleTimelineResizeEnd}
          role="separator"
          tabIndex={0}
          title="Tarik ke atas atau bawah. Klik dua kali untuk reset."
        >
          <span className="h-1 w-16 rounded-full bg-zinc-600 transition group-hover:w-24 group-hover:bg-cyan-400" />
          <span className="pointer-events-none absolute -top-7 rounded bg-zinc-950 px-2 py-1 text-[10px] font-bold text-zinc-300 opacity-0 shadow-lg transition group-hover:opacity-100">
            Tarik untuk ubah tinggi
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-zinc-100">Timeline</h2>
            <p className="mt-1 text-xs font-semibold text-zinc-500">
              Durasi {formatTimeLabel(clipDuration)} - Playhead {formatTimeLabel(previewTime)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              className="theme-toggle rounded-md border border-zinc-700 bg-[#25282d] px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-cyan-400 hover:text-cyan-300"
              onClick={() => {
                markEditorPreferenceDirty();
                setEditorTheme((theme) => (theme === "dark" ? "light" : "dark"));
              }}
              type="button"
            >
              {editorTheme === "dark" ? "☀ Mode cerah" : "☾ Mode gelap"}
            </button>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-blue-600" /> Video
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-emerald-500" /> Audio
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-violet-500" /> Caption
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-cyan-500" /> Hook
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-rose-500" /> Punch
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-yellow-300" /> Keyword
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-teal-500" /> Pattern
              </span>
            </div>
            {(editorDirty || timelineDirty || isSavingEditor || saveFailure) && (
              <span
                className="rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-black text-cyan-300"
                title={editorSaveStatusTitle}
              >
                {editorSaveStatusLabel}
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-[#22252a] p-1">
            <button
              aria-label="Undo perubahan terakhir"
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canUndo}
              onClick={undoEditor}
              title="Undo (Ctrl+Z)"
              type="button"
            >
              ↶ Undo
            </button>
            <button
              aria-label="Redo perubahan terakhir"
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canRedo}
              onClick={redoEditor}
              title="Redo (Ctrl+Shift+Z atau Ctrl+Y)"
              type="button"
            >
              ↷ Redo
            </button>
          </div>
          <div className="mr-1 flex items-center gap-1 rounded-md border border-zinc-700 bg-[#22252a] p-1">
            <button
              className="rounded bg-cyan-400 px-3 py-1 text-xs font-black text-slate-950 transition hover:bg-cyan-300"
              onClick={extractAudioTrack}
              title={
                audioExtracted
                  ? "Ekstrak ulang audio dari track Video dan ganti track Audio saat ini"
                  : "Pisahkan audio dari file klip kerja ke track Audio"
              }
              type="button"
            >
              Ekstrak Audio
            </button>
            {audioExtracted && (
              <button
                className="rounded px-3 py-1 text-xs font-black text-amber-300 transition hover:bg-amber-950/60"
                onClick={mergeAudioIntoVideoTrack}
                title="Hapus track Audio terpisah dan gunakan kembali audio bawaan Video"
                type="button"
              >
                Gabungkan Audio
              </button>
            )}
            <button
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={copySelectedTrack}
              title="Salin item track yang dipilih"
              type="button"
            >
              Copy
            </button>
            <button
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!copiedMediaSegment && !copiedTimedItem}
              onClick={pasteSelectedTrack}
              title="Tempel item yang disalin pada posisi playhead"
              type="button"
            >
              Paste
            </button>
            <span className="mx-1 h-4 w-px bg-zinc-700" />
            <button
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={splitSelectedTrack}
              title="Split item yang dipilih pada posisi playhead"
              type="button"
            >
              Split
            </button>
            <button
              className="rounded px-3 py-1 text-xs font-black text-red-300 transition hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!anyTrackSelected}
              onClick={deleteSelectedTrackItem}
              title="Hapus seluruh item track yang dipilih"
              type="button"
            >
              Hapus
            </button>
            <button
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={deleteLeftSelectedTrack}
              title="Potong sisi kiri item terpilih hingga playhead"
              type="button"
            >
              Hapus kiri
            </button>
            <button
              className="rounded px-3 py-1 text-xs font-black text-zinc-200 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={deleteRightSelectedTrack}
              title="Potong sisi kanan item terpilih hingga playhead"
              type="button"
            >
              Hapus kanan
            </button>
          </div>
          <span className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold text-cyan-300">
            {audioExtracted ? "Audio sudah diekstrak • Track mandiri" : "Audio masih menyatu di file klip kerja"}
          </span>
          {anyTrackSelected && (
            <span className="text-[10px] font-semibold text-zinc-400">
              Tarik handle putih di ujung bagian untuk mengubah durasi.
            </span>
          )}
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => addEvent("punch_zoom")}>
            + Punch Zoom
          </button>
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => addEvent("keyword_popup")}>
            + Keyword
          </button>
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => addEvent("pattern_interrupt")}>
            + Pattern
          </button>
          {!editableEffectTimeline.some((event) => event.type === "hook_text") && (
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => addEvent("hook_text")}>
              + Hook Text
            </button>
          )}
          {timelineError && (
            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700">
              {timelineError}
            </span>
          )}
          {selectedEvent && (
            <span className="rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-300">
              Detail event dibuka di panel kanan.
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 rounded-md border border-zinc-700 bg-[#22252a] px-2 py-1">
            <button
              className="text-sm font-black text-zinc-400 hover:text-cyan-300"
              onClick={() => {
                markEditorPreferenceDirty();
                setTimelineZoom((value) => Math.max(1, value - 0.5));
              }}
              title="Perkecil timeline"
              type="button"
            >
              −
            </button>
            <input
              aria-label="Zoom timeline"
              className="h-1 w-24 accent-cyan-400"
              max={4}
              min={1}
              onChange={(event) => {
                markEditorPreferenceDirty();
                setTimelineZoom(Number(event.target.value));
              }}
              step={0.5}
              type="range"
              value={timelineZoom}
            />
            <button
              className="text-sm font-black text-zinc-400 hover:text-cyan-300"
              onClick={() => {
                markEditorPreferenceDirty();
                setTimelineZoom((value) => Math.min(4, value + 0.5));
              }}
              title="Perbesar timeline"
              type="button"
            >
              +
            </button>
            <span className="min-w-8 text-right text-[10px] font-bold text-zinc-500">
              {timelineZoom.toFixed(1)}x
            </span>
          </div>
        </div>

        <div className="mt-3 min-h-0 overflow-auto pr-1 xl:max-h-[216px]">
          <div className="min-w-full" style={{ width: `${timelineContentScale * 100}%` }}>
          <div className="grid grid-cols-[112px_minmax(0,1fr)] items-end gap-3">
            <div />
            <div className="relative h-7 touch-none border-b border-zinc-700" {...timelinePointerProps}>
              {ticks.map((tick) => (
                <div
                  className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center gap-1"
                  key={tick}
                  style={{ left: eventLeft(tick, timelineScaleDuration) }}
                >
                  <span className="h-2 w-px bg-zinc-600" />
                  <span className="text-[10px] font-bold text-zinc-500">
                    {formatTimeLabel(tick)}
                  </span>
                </div>
              ))}
              {timelineHover && (
                <span
                  className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-cyan-400 px-2 py-1 text-[10px] font-black text-slate-950 shadow"
                  style={{ left: `${timelineHover.percent}%` }}
                >
                  {formatTimeLabel(timelineHover.time)}
                </span>
              )}
            </div>
          </div>

          <div className="relative mt-2 flex flex-col gap-1.5">
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3" style={{ order: -1 }}>
              <div />
              <div className="relative h-5 touch-none" {...timelinePointerProps}>
                <span
                  className="absolute -translate-x-1/2 cursor-ew-resize rounded bg-cyan-400 px-2 py-1 text-[10px] font-black text-slate-950 shadow"
                  style={{ left: `${playheadPercent}%` }}
                >
                  {formatTimeLabel(previewTime)}
                </span>
              </div>
            </div>
            <TimelineTrack
              {...timelineTrackOrderProps("video")}
              duration={timelineScaleDuration}
              items={timelineVideoItems}
              label="Video"
              onItemClick={selectTimelineItem}
              onItemContextMenu={handleTrackItemContextMenu}
              onItemResizePointerDown={startMediaResize}
              onItemResizePointerMove={moveMediaResize}
              onItemResizePointerUp={finishMediaResize}
              resizable={selectedEditorContext === "video"}
              selectedItemId={selectedMediaSegmentId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "video"}
              emptyText={
                manualEditorMode && videoSequence.length === 0
                  ? "Belum ada media di timeline"
                  : "Track Video kosong"
              }
            />
            {manualEditorMode && videoSequence.length === 0 && (
              <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
                <div />
                <label className="w-fit">
                  <span className="btn-secondary inline-flex cursor-pointer px-3 py-1.5 text-[11px] font-black">
                    Import media
                  </span>
                  <input
                    accept={editorMediaInputConfig.video.accept}
                    aria-label="Import media ke timeline"
                    className="sr-only"
                    disabled={editorMediaUploading}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importEditorMedia("video", file);
                      event.currentTarget.value = "";
                    }}
                    type="file"
                  />
                </label>
              </div>
            )}
            {audioExtracted && (
            <TimelineTrack
              {...timelineTrackOrderProps("audio")}
              duration={timelineScaleDuration}
              items={timelineAudioItems}
              label="Audio"
              onItemClick={selectTimelineItem}
              onItemContextMenu={handleTrackItemContextMenu}
              onItemResizePointerDown={startMediaResize}
              onItemResizePointerMove={moveMediaResize}
              onItemResizePointerUp={finishMediaResize}
              resizable={selectedEditorContext === "audio"}
              selectedItemId={selectedMediaSegmentId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "audio"}
              emptyText="Track Audio kosong"
            />
            )}
            {timelineAdditionalAudioTracks.map(({ track, item }) => (
              <TimelineTrack
                duration={timelineScaleDuration}
                items={[item]}
                key={track.id}
                label={track.label}
                onItemClick={selectTimelineItem}
                onItemContextMenu={handleTrackItemContextMenu}
                selected={selectedAdditionalAudioTrackId === track.id}
                selectedItemId={selectedAdditionalAudioTrackId}
                order={trackOrder.indexOf("audio")}
                {...timelinePointerProps}
                playheadPercent={playheadPercent}
                emptyText={`${track.label} kosong`}
              />
            ))}
            <TimelineTrack
              {...timelineTrackOrderProps("caption")}
              duration={timelineScaleDuration}
              items={timelineCaptionItems}
              label="Caption"
              onItemClick={selectTimelineItem}
              onItemContextMenu={handleTrackItemContextMenu}
              onItemResizePointerDown={startTimedItemResize}
              onItemResizePointerMove={moveTimedItemResize}
              onItemResizePointerUp={finishTimedItemResize}
              resizable={selectedEditorContext === "caption"}
              selectedItemId={selectedCaptionId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "caption"}
              emptyText="Belum ada cue caption"
            />
            <TimelineTrack
              {...timelineTrackOrderProps("hook")}
              duration={timelineScaleDuration}
              items={timelineHookItems}
              label="Hook"
              {...editableMarkerProps}
              onItemResizePointerDown={startTimedItemResize}
              onItemResizePointerMove={moveTimedItemResize}
              onItemResizePointerUp={finishTimedItemResize}
              resizable={selectedEditorContext === "hook"}
              selectedItemId={selectedEventId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "hook"}
            />
            <TimelineTrack
              {...timelineTrackOrderProps("punch")}
              duration={timelineScaleDuration}
              items={timelinePunchItems}
              label="Punch"
              {...editableMarkerProps}
              onItemResizePointerDown={startTimedItemResize}
              onItemResizePointerMove={moveTimedItemResize}
              onItemResizePointerUp={finishTimedItemResize}
              resizable={selectedEditorContext === "effect"}
              selectedItemId={selectedEventId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "effect" && selectedEvent?.type === "punch_zoom"}
              emptyText={styleConfig.punch_zoom_enabled ? "Belum ada momen efek" : "Tidak aktif"}
            />
            <TimelineTrack
              {...timelineTrackOrderProps("keyword")}
              duration={timelineScaleDuration}
              items={timelineKeywordItems}
              label="Keyword"
              {...editableMarkerProps}
              onItemResizePointerDown={startTimedItemResize}
              onItemResizePointerMove={moveTimedItemResize}
              onItemResizePointerUp={finishTimedItemResize}
              resizable={selectedEditorContext === "keyword"}
              selectedItemId={selectedEventId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "keyword"}
              emptyText={keywordSkipped ? "Tidak ada frasa penting" : "Tidak ada event"}
            />
            <TimelineTrack
              {...timelineTrackOrderProps("pattern")}
              duration={timelineScaleDuration}
              items={timelinePatternItems}
              label="Pattern"
              {...editableMarkerProps}
              onItemResizePointerDown={startTimedItemResize}
              onItemResizePointerMove={moveTimedItemResize}
              onItemResizePointerUp={finishTimedItemResize}
              resizable={selectedEditorContext === "effect"}
              selectedItemId={selectedEventId}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              selected={selectedEditorContext === "effect" && selectedEvent?.type === "pattern_interrupt"}
              emptyText={styleConfig.pattern_interrupt_enabled ? "Belum ada event valid" : "Tidak aktif"}
            />
          </div>
          </div>
        </div>

        {!manualEditorMode && !configuredEffectTimeline.length && (
          <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-semibold text-amber-800">
            Belum ada timeline efek tersimpan. Export draft akan membuat timeline efek dari transcript dan interval aman.
          </p>
        )}
        <p className="mt-2 text-[10px] font-semibold text-zinc-500">
          Urutan track tersimpan untuk timeline. Urutan layer visual diterapkan pada Live Preview;
          compositor output export belum sepenuhnya mengikuti layer_order.
        </p>
      </section>

      {exportModalOpen && (
        <div
          aria-label="Export video"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExportModal();
          }}
          role="dialog"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-[#202226] text-zinc-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-700 px-5 py-4">
              <div>
                <h2 className="text-lg font-black">Export</h2>
                <p className="mt-1 text-xs font-semibold text-zinc-400">Atur kualitas file video Anda.</p>
              </div>
              <button
                aria-label="Tutup modal export"
                className="rounded-lg px-3 py-2 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                onClick={closeExportModal}
                type="button"
              >
                &times;
              </button>
            </div>

            <div className="grid gap-5 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <div className="mx-auto aspect-[9/16] max-h-72 overflow-hidden rounded-xl bg-black ring-1 ring-zinc-700">
                  <video
                    className="h-full w-full object-cover"
                    muted
                    preload="metadata"
                    src={exportResultUrl || sourceClipUrl}
                  />
                </div>
                <div className="mt-3 grid gap-2 rounded-xl bg-zinc-800 p-3 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-400">Durasi</span>
                    <strong>{formatTimeLabel(clipDuration)}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-400">Ukuran file</span>
                    <strong>{exportFileSize}</strong>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-400">Format</span>
                    <strong>MP4</strong>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-black uppercase tracking-wide text-zinc-400" htmlFor="export_filename">
                    Nama file/output
                  </label>
                  <input
                    className="mt-2 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-sm text-white"
                    id="export_filename"
                    onChange={(event) => setExportFilename(event.target.value)}
                    value={exportFilename}
                  />
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-zinc-400">Resolution</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {([
                      ["540", "540x960", "Preview"],
                      ["720", "720x1280", "HD"],
                      ["1080", "1080x1920", "Full HD"],
                    ] as const).map(([value, label, detail]) => (
                      <button
                        className={`rounded-xl border p-3 text-left text-xs transition ${
                          exportResolution === value
                            ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                            : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500"
                        }`}
                        key={value}
                        onClick={() => setExportResolution(value)}
                        type="button"
                      >
                        <strong className="block">{label}</strong>
                        <span className="mt-1 block text-[10px] opacity-70">{detail}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-zinc-400">Quality / Bitrate</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(["standard", "high", "higher"] as const).map((value) => (
                      <button
                        className={`rounded-lg border px-3 py-2 text-xs font-bold capitalize ${
                          exportQuality === value
                            ? "border-cyan-400 bg-cyan-400/10 text-cyan-200"
                            : "border-zinc-700 bg-zinc-800 text-zinc-300"
                        }`}
                        key={value}
                        onClick={() => setExportQuality(value)}
                        type="button"
                      >
                        {value === "standard" ? "Standard" : value === "high" ? "High" : "Higher"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-black uppercase tracking-wide text-zinc-400" htmlFor="export_format">Format</label>
                    <select className="mt-2" disabled id="export_format" value="mp4">
                      <option value="mp4">MP4</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-black uppercase tracking-wide text-zinc-400" htmlFor="export_fps">Frame rate</label>
                    <select
                      className="mt-2"
                      id="export_fps"
                      onChange={(event) => setExportFrameRate(event.target.value as "30" | "source")}
                      value={exportFrameRate}
                    >
                      <option value="30">30fps</option>
                      {sourceFrameRate && <option value="source">Source ({sourceFrameRate}fps)</option>}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-black uppercase tracking-wide text-zinc-400" htmlFor="export_codec">Codec</label>
                    <select className="mt-2" disabled id="export_codec" value="h264">
                      <option value="h264">H.264</option>
                    </select>
                  </div>
                </div>

                <div className={`rounded-xl p-3 text-sm font-bold ${
                  exportFailed ? "bg-red-950/60 text-red-200" : exportReady ? "bg-emerald-950/60 text-emerald-200" : "bg-zinc-800 text-zinc-300"
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <span>{exportStatusText}</span>
                    {exportInProgress && exportProgress !== null && (
                      <span className="tabular-nums">{Math.round(exportProgress)}%</span>
                    )}
                  </div>
                  {exportInProgress && (
                    <div
                      aria-label={exportProgress === null ? "Export sedang diproses" : `Progress export ${Math.round(exportProgress)}%`}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-700"
                      role="progressbar"
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={exportProgress === null ? undefined : Math.round(exportProgress)}
                    >
                      <div
                        className={`h-full rounded-full bg-cyan-400 transition-[width] duration-500 ${exportProgress === null ? "w-2/3 animate-pulse" : ""}`}
                        style={exportProgress === null ? undefined : { width: `${exportProgress}%` }}
                      />
                    </div>
                  )}
                </div>
                {(editableCaptionCues.length > 0 ||
                  editableEffectTimeline.some((event) =>
                    ["hook_text", "pattern_interrupt"].includes(event.type),
                  ) ||
                  additionalAudioTracks.length > 0) && (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-950/35 p-3 text-xs text-amber-100">
                    <p className="font-black">Catatan kompatibilitas export</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 font-semibold text-amber-100/80">
                      {editableCaptionCues.length > 0 && (
                        <li>Mode tampilan Caption tertentu belum sepenuhnya identik dengan Live Preview.</li>
                      )}
                      {editableEffectTimeline.some((event) => event.type === "hook_text") && (
                        <li>Template box Hook lama dapat berbeda, tetapi teks, timing, dan gaya dasarnya tetap diekspor.</li>
                      )}
                      {editableEffectTimeline.some((event) => event.type === "pattern_interrupt") && (
                        <li>Pattern Effect belum diterapkan pada file export.</li>
                      )}
                      {additionalAudioTracks.length > 0 && (
                        <li>Audio tambahan belum dicampur ke file export.</li>
                      )}
                    </ul>
                  </div>
                )}
                {exportWasClosedDuringTask && toolbarExportBusy && (
                  <div className="rounded-xl border border-cyan-400/30 bg-cyan-950/30 p-3">
                    <p className="text-sm font-black text-cyan-100">
                      Export sebelumnya masih berjalan.
                    </p>
                    <p className="mt-1 text-xs font-semibold text-cyan-200/80">
                      Export tetap berjalan di latar belakang. Backend saat ini belum mendukung pembatalan task yang aman.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-black text-zinc-950"
                        onClick={() => {
                          setMessage("Memeriksa status export...");
                          void renderStatus.refetch();
                        }}
                        type="button"
                      >
                        Lihat proses
                      </button>
                      <button
                        className="rounded-lg border border-zinc-600 px-3 py-2 text-xs font-black text-zinc-500"
                        disabled
                        title="Tunggu proses sebelumnya selesai atau gagal sebelum memulai ulang."
                        type="button"
                      >
                        Mulai ulang jika aman
                      </button>
                    </div>
                  </div>
                )}
                {toolbarExportBusy && !exportWasClosedDuringTask && (
                  <p className="text-xs font-semibold text-zinc-400">
                    Anda dapat menutup modal. Export tetap berjalan di latar belakang.
                  </p>
                )}
                {exportLongRunning && (
                  <p className="rounded-lg bg-amber-950/50 p-3 text-xs font-semibold text-amber-200">
                    Export masih diproses. Cek log worker jika terlalu lama.
                  </p>
                )}
                {exportResolution === "1080" && (
                  <p className="text-xs font-semibold text-zinc-400">
                    Export Full HD dapat memakan waktu lebih lama.
                  </p>
                )}
                {toolbarRed && exportIsHd && (
                  <p className="rounded-lg bg-amber-950/50 p-3 text-xs font-semibold text-amber-200">
                    Export HD menunggu perbaikan transformasi. Pilih 540x960 untuk membuat export draft.
                  </p>
                )}
                {exportFailed && (
                  <div>
                    <button
                      className="text-xs font-bold text-red-300 underline"
                      onClick={() => setExportTechnicalOpen((open) => !open)}
                      type="button"
                    >
                      {exportTechnicalOpen ? "Sembunyikan detail teknis" : "Lihat detail teknis"}
                    </button>
                    {exportTechnicalOpen && (
                      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-[10px] text-red-200">
                        {queueRender.error?.message || exportResultRender?.error_message || "Proses export tidak dapat diselesaikan."}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-700 px-5 py-4">
              <button
                className="btn-secondary px-4 py-2 text-sm"
                onClick={closeExportModal}
                type="button"
              >
                Tutup
              </button>
              {exportReady && exportResultRender && exportResultUrl ? (
                <a
                  className="btn px-5 py-2 text-sm"
                  download={exportDownloadFilename}
                  href={exportResultUrl}
                  onClick={() => console.info("[XA AutoClip] export_download", {
                    download_render_id: exportResultRender.id,
                    render_download_url: exportResultUrl,
                  })}
                >
                  Unduh MP4
                </a>
              ) : (
                <button
                  className="btn px-5 py-2 text-sm"
                  disabled={
                    !canStartExport ||
                    isSavingEditor ||
                    exportInProgress ||
                    (toolbarRed && exportIsHd)
                  }
                  onClick={startExport}
                  type="button"
                >
                  {exportInProgress ? "Mengekspor..." : exportFailed ? "Coba Lagi" : "Export"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {trackContextMenu && (
        <div
          aria-label="Menu editor track"
          className="fixed z-[100] w-60 overflow-hidden rounded-xl border border-zinc-600 bg-[#25282d] p-1.5 text-zinc-100 shadow-2xl shadow-black/60"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: trackContextMenu.x, top: trackContextMenu.y }}
        >
          <div className="border-b border-zinc-700 px-3 py-2">
            <p className="truncate text-xs font-black text-white">
              {trackContextMenu.item.label || trackContextMenu.item.title.split("\n")[0]}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
              {contextFromEventType(trackContextMenu.item.type)} · {formatTimePrecise(trackContextMenu.item.start)}–{formatTimePrecise(trackContextMenu.item.end)}
            </p>
          </div>
          <div className="py-1">
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700"
              onClick={() => setTrackContextMenu(null)}
              role="menuitem"
              type="button"
            >
              Buka pengaturan
              <span className="text-[10px] text-zinc-500">Panel kanan</span>
            </button>
            {trackContextMenu.item.type === "video" && (
              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold text-cyan-300 hover:bg-zinc-700"
                onClick={() => runTrackContextAction(extractAudioTrack)}
                role="menuitem"
                type="button"
              >
                Ekstrak Audio
                <span className="text-[10px] text-zinc-500">Dari klip</span>
              </button>
            )}
            {trackContextMenu.item.type === "video" && audioExtracted && (
              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold text-amber-300 hover:bg-amber-950/60"
                onClick={() => runTrackContextAction(mergeAudioIntoVideoTrack)}
                role="menuitem"
                type="button"
              >
                Gabungkan Audio
                <span className="text-[10px] text-zinc-500">Kembali ke Video</span>
              </button>
            )}
          </div>
          <div className="border-t border-zinc-700 py-1">
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={() => runTrackContextAction(splitSelectedTrack)}
              role="menuitem"
              type="button"
            >
              Split
              <span className="text-[10px] text-zinc-500">Di playhead</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold text-red-300 hover:bg-red-950/60 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!anyTrackSelected}
              onClick={() => runTrackContextAction(deleteSelectedTrackItem)}
              role="menuitem"
              type="button"
            >
              Hapus
              <span className="text-[10px] text-red-400/70">Seluruh item</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={() => runTrackContextAction(copySelectedTrack)}
              role="menuitem"
              type="button"
            >
              Copy
              <span className="text-[10px] text-zinc-500">Item terpilih</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!copiedMediaSegment && !copiedTimedItem}
              onClick={() => runTrackContextAction(pasteSelectedTrack)}
              role="menuitem"
              type="button"
            >
              Paste
              <span className="text-[10px] text-zinc-500">Di playhead</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={() => runTrackContextAction(deleteLeftSelectedTrack)}
              role="menuitem"
              type="button"
            >
              Hapus kiri
              <span className="text-[10px] text-zinc-500">Ke playhead</span>
            </button>
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!selectedTrackSupportsMediaEditing}
              onClick={() => runTrackContextAction(deleteRightSelectedTrack)}
              role="menuitem"
              type="button"
            >
              Hapus kanan
              <span className="text-[10px] text-zinc-500">Dari playhead</span>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 border-t border-zinc-700 pt-1">
            <button
              className="rounded-lg px-3 py-2 text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!canUndo}
              onClick={() => runTrackContextAction(undoEditor)}
              role="menuitem"
              type="button"
            >
              Undo
            </button>
            <button
              className="rounded-lg px-3 py-2 text-xs font-bold hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!canRedo}
              onClick={() => runTrackContextAction(redoEditor)}
              role="menuitem"
              type="button"
            >
              Redo
            </button>
          </div>
        </div>
      )}

      {context.data.source_mismatch_warning && (
        <p className="fixed bottom-5 right-5 z-50 max-w-md rounded-lg border border-amber-400/30 bg-amber-950/95 p-3 text-sm text-amber-200 shadow-xl">
          {context.data.source_mismatch_warning}
        </p>
      )}
      {message && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">
          {message}
        </div>
      )}
      {error && (
        <p className="fixed bottom-5 right-5 z-50 max-w-md rounded-lg border border-red-400/30 bg-red-950/95 p-3 text-sm text-red-200 shadow-xl">
          {error.message}
        </p>
      )}
    </div>
  );
}

function TextStylePresetSelector({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: TextStylePresetKey) => void;
  value: TextStylePresetKey;
}) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {TEXT_STYLE_PRESETS.map((preset) => {
          const previewStyle = resolveTextOverlayStyle(preset.key);
          return (
            <button
              aria-label={preset.label}
              className={`aspect-square min-w-0 rounded-md border text-[11px] leading-none transition-colors ${
                value === preset.key
                  ? "border-violet-500 ring-2 ring-violet-200"
                  : "border-slate-300 hover:border-slate-500"
              }`}
              key={preset.key}
              onClick={() => onChange(preset.key)}
              style={{
                ...previewStyle,
                backgroundColor: previewStyle.backgroundColor || "#27272a",
                color: previewStyle.color || "#ffffff",
              }}
              title={preset.label}
              type="button"
            >
              Aa
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] font-semibold text-slate-500">
        {getTextStylePreset(value).label}
      </p>
    </div>
  );
}

function activeHookCue(events: EffectTimelineEvent[], currentTime: number) {
  return events.find(
    (event) =>
      event.type === "hook_text" &&
      Number.isFinite(event.start) &&
      Number.isFinite(event.end) &&
      event.end > event.start &&
      currentTime >= event.start &&
      currentTime < event.end,
  );
}

function hookCueText(event: EffectTimelineEvent | undefined, fallback: string) {
  return safeHookPreview(
    String(event?.text || event?.title || event?.content || fallback || ""),
  );
}
