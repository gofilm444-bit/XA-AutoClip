import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, downloadUrl, sourceVideoUrl } from "../api/client";
import type { LayoutOutletContext } from "../components/Layout";
import { WorkflowSteps } from "../components/WorkflowSteps";
import type {
  OriginalityReport,
  Transformation,
  TransformationContext,
} from "../types";

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
};

type EffectTimelineEvent = {
  id?: string;
  type: "punch_zoom" | "keyword_popup" | string;
  start: number;
  end: number;
  zoom?: number;
  text?: string;
  effect?: string;
  reason?: string;
};

type EditorContext = "video" | "caption" | "hook" | "keyword" | "effect" | "timeline" | "render";

type TimelineItem = {
  id: string;
  eventId?: string;
  editable?: boolean;
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
type CaptionStylePreset =
  | "clean_white"
  | "tiktok_bold"
  | "box_caption"
  | "yellow_pop"
  | "minimal_lower_third"
  | "karaoke_preview";
type CaptionStyleConfig = {
  preset: CaptionStylePreset;
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

const presetOptions: Array<{ value: RenderPreset; label: string }> = [
  { value: "blurred_background", label: "Latar buram" },
  { value: "center_crop", label: "Potong tengah" },
  { value: "fit_background", label: "Video penuh" },
  { value: "picture_in_picture", label: "Picture in picture" },
];
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
      fontSize: "medium",
      fontWeight: "semibold",
      position: "bottom",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: 8,
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
      fontSize: "large",
      fontWeight: "bold",
      position: "center_lower",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: 8,
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
      fontSize: "medium",
      fontWeight: "semibold",
      position: "bottom",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: false,
      shadowEnabled: false,
      backgroundEnabled: true,
      backgroundOpacity: 0.62,
      maxWords: 8,
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
      fontSize: "large",
      fontWeight: "bold",
      position: "center_lower",
      textColor: "#FFD400",
      highlightColor: "#FFFFFF",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: 8,
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
      fontSize: "small",
      fontWeight: "normal",
      position: "bottom",
      textColor: "#F8FAFC",
      highlightColor: "#CBD5E1",
      outlineEnabled: false,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.45,
      maxWords: 8,
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
      fontSize: "medium",
      fontWeight: "bold",
      position: "center_lower",
      textColor: "#FFFFFF",
      highlightColor: "#FFD400",
      outlineEnabled: true,
      shadowEnabled: true,
      backgroundEnabled: false,
      backgroundOpacity: 0.55,
      maxWords: 8,
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
  running: "Sedang merender",
  completed: "Selesai",
  failed: "Gagal",
  superseded: "Perlu dibuat ulang",
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

function getSafeSubtitlePreview(text: string) {
  const cleaned = text
    .replace(/^\[\d{2}:\d{2}\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > 45) return null;
  if (cleaned.split(/\s+/).length > 8) return null;
  return cleaned;
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
  return {
    ...presetConfig,
    ...raw,
    preset,
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
    maxWords: Math.max(1, Math.min(8, Number(raw.maxWords || presetConfig.maxWords))),
    maxChars: Math.max(10, Math.min(45, Number(raw.maxChars || presetConfig.maxChars))),
    karaokeEnabled: Boolean(raw.karaokeEnabled ?? presetConfig.karaokeEnabled),
  };
}

function captionPositionClass(position: CaptionStyleConfig["position"]) {
  if (position === "top") return "top-[10%]";
  if (position === "center") return "top-1/2 -translate-y-1/2";
  if (position === "center_lower") return "bottom-[24%]";
  return "bottom-[10%]";
}

function captionSizeClass(fontSize: CaptionStyleConfig["fontSize"]) {
  if (fontSize === "large") return "text-lg md:text-xl";
  if (fontSize === "small") return "text-xs md:text-sm";
  return "text-sm md:text-base";
}

function captionWeightClass(fontWeight: CaptionStyleConfig["fontWeight"]) {
  if (fontWeight === "bold") return "font-black";
  if (fontWeight === "semibold") return "font-bold";
  return "font-semibold";
}

function activeCaptionCue(
  cues: Array<{ start: number; end: number; text: string }>,
  currentTime: number,
) {
  return cues.find((cue) => currentTime >= cue.start && currentTime <= cue.end);
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
  if (configured.length) return configured;
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
  if (!render) return "Source Preview";
  if (render.status === "completed" && renderedPreviewAvailable) {
    return render.width >= 1000 ? "Final Preview" : "Render Preview";
  }
  if (render.status === "failed") return "Render Gagal";
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
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">
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
    <section className="rounded-xl border border-slate-200 bg-slate-50">
      <button
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
        onClick={() => onToggle(id)}
        type="button"
      >
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-800">{title}</p>
          {summary && (
            <div className="mt-1 truncate text-xs font-semibold text-slate-500">{summary}</div>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-black text-slate-500">
          {isOpen ? "Sembunyikan" : "Lihat"}
        </span>
      </button>
      {isOpen && <div className="border-t border-slate-200 bg-white p-3">{children}</div>}
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
  emptyText = "Tidak ada event",
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
  emptyText?: string;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-3">
      <div className="truncate text-xs font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className="relative h-8 touch-none overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {typeof playheadPercent === "number" && (
          <span
            className="absolute bottom-0 top-0 z-10 w-0.5 bg-slate-950"
            style={{ left: `${playheadPercent}%` }}
          />
        )}
        {items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className={`absolute top-1/2 h-4 -translate-y-1/2 rounded-md px-2 text-[10px] font-black leading-4 shadow-sm ${
                item.active ? "ring-2 ring-slate-950 ring-offset-1" : ""
              } ${item.editable ? "cursor-move" : ""} ${item.colorClass}`}
              style={{
                left: eventLeft(item.start, duration),
                width: eventWidth(item.start, item.end, duration),
              }}
              onClick={(event) => {
                if (!item.editable) return;
                event.stopPropagation();
                onItemClick?.(item);
              }}
              onPointerDown={(event) => {
                if (!item.editable) return;
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
            </div>
          ))
        ) : (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
            {emptyText}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    queued: "bg-amber-50 text-amber-700 ring-amber-200",
    running: "bg-cyan-50 text-cyan-700 ring-cyan-200",
    completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    failed: "bg-red-50 text-red-700 ring-red-200",
    idle: "bg-slate-50 text-slate-600 ring-slate-200",
  };
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-black ring-1 ${
        styles[status] || styles.idle
      }`}
    >
      {renderStatusLabels[status] || (status === "idle" ? "Belum dibuat" : status)}
    </span>
  );
}

function RenderProgress({ status }: { status: string }) {
  if (!["queued", "running"].includes(status)) return null;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-500" />
    </div>
  );
}

function ProcessRow({
  detail,
  label,
  status,
}: {
  detail?: ReactNode;
  label: string;
  status: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-black text-slate-800">{label}</span>
        <StatusBadge status={status} />
      </div>
      {detail && <div className="mt-2 text-xs font-semibold text-slate-500">{detail}</div>}
      <RenderProgress status={status} />
    </div>
  );
}

function PresetVideo({
  src,
  preset,
  controls = false,
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
  controls?: boolean;
  className?: string;
  videoRef?: Ref<HTMLVideoElement>;
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (currentTime: number) => void;
  onSeeked?: (currentTime: number) => void;
}) {
  const playbackProps = {
    onPlay,
    onPause,
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) =>
      onLoadedMetadata?.(event.currentTarget.currentTime),
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
        muted={!controls}
        preload="metadata"
        ref={videoRef}
        src={src}
        {...playbackProps}
      />
    );
  }
  if (preset === "fit_background") {
    return (
      <video
        className={`h-full w-full bg-black object-contain ${className}`}
        controls={controls}
        muted={!controls}
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
        muted={!controls}
        preload="metadata"
        ref={videoRef}
        src={src}
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
  const [subtitleLanguage, setSubtitleLanguage] = useState<"id" | "en">("id");
  const [captionCopied, setCaptionCopied] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [message, setMessage] = useState("");
  const [openLeftSection, setOpenLeftSection] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [renderDirty, setRenderDirty] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [timelineHover, setTimelineHover] = useState<{
    percent: number;
    time: number;
  } | null>(null);
  const [selectedEditorContext, setSelectedEditorContext] = useState<EditorContext>("video");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [timelineDirty, setTimelineDirty] = useState(false);
  const [timelineError, setTimelineError] = useState("");
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
  const wasPlayingBeforeDrag = useRef(false);

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
      if (isRenderPreset(plan.data.clipper_style_config?.render_preset)) {
        setPreset(plan.data.clipper_style_config.render_preset);
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
  useEffect(() => {
    if (!timelineDirty) return;
    const warnUnsavedTimeline = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnUnsavedTimeline);
    return () => window.removeEventListener("beforeunload", warnUnsavedTimeline);
  }, [timelineDirty]);

  async function persistDraft() {
    if (!draft) throw new Error("Data transformasi belum tersedia.");
    const duration = context.data?.clip_duration_seconds || 0;
    const events = Array.isArray(draft.clipper_style_config?.effect_timeline)
      ? draft.clipper_style_config.effect_timeline
      : [];
    for (const event of events) {
      if (!["hook_text", "punch_zoom", "keyword_popup", "pattern_interrupt"].includes(event.type)) {
        throw new Error("Timeline efek berisi tipe event yang tidak valid.");
      }
      if (event.start < 0 || event.end > duration || event.end <= event.start) {
        throw new Error("Timeline efek berisi waktu event yang tidak valid.");
      }
      const bounds = eventDurationBounds(event.type);
      const eventDuration = event.end - event.start;
      if (eventDuration < bounds.min || eventDuration > bounds.max) {
        throw new Error(`Durasi event ${event.type} tidak valid.`);
      }
      if (event.type === "keyword_popup" && !isValidKeyword(event.text || "")) {
        throw new Error("Keyword pop-up belum valid. Gunakan 1-4 kata bermakna.");
      }
    }
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
    const saved = await api<Transformation>(
      `/api/transformations/${transformationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      },
    );
    setDraft(saved);
    client.setQueryData(["transformation", transformationId], saved);
    return saved;
  }

  const save = useMutation({
    mutationFn: persistDraft,
    onSuccess: () => {
      setEditorDirty(false);
      setTimelineDirty(false);
      setMessage("Perubahan berhasil disimpan.");
    },
  });
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
      await persistDraft();
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
      setRender(data);
      setEditorDirty(false);
      setRenderDirty(false);
      setTimelineDirty(false);
      setMessage("Render masuk antrean.");
    },
  });
  const reprocess = useMutation({
    mutationFn: () =>
      api(`/api/projects/${draft?.project_id}/reprocess`, { method: "POST" }),
    onSuccess: () => navigate(`/projects/${draft?.project_id}`),
  });
  const renderStatus = useQuery({
    queryKey: ["render", render?.id],
    queryFn: () => api<Render>(`/api/renders/${render?.id}`),
    enabled: Boolean(render?.id),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status || "")
        ? 2000
        : false,
  });
  const renderStatusData = renderStatus.data;
  useEffect(() => {
    const current = renderStatusData;
    if (!current) return;
    if (current.status === "completed") {
      setMessage(
        current.warning_message
          ? "Render selesai dengan mode aman. Beberapa efek dilewati."
          : current.width >= 1000
            ? "Render final selesai."
            : "Render preview selesai.",
      );
    }
    if (current.status === "failed") {
      setMessage("Render gagal. Lihat detail di status.");
    }
  }, [renderStatusData]);

  const toolbarActiveRender = renderStatus.data || render || latestRender.data;
  const toolbarTranscriptionReady = context.data ? !context.data.transcription_is_demo : false;
  const toolbarRenderedPreviewAvailable =
    !renderDirty &&
    toolbarActiveRender?.status === "completed" &&
    toolbarActiveRender.preset === preset &&
    Boolean(
      toolbarActiveRender.file_size_bytes === undefined ||
        toolbarActiveRender.file_size_bytes > 20_000,
    );
  const toolbarRenderFailed = toolbarActiveRender?.status === "failed";
  const toolbarRed = report?.overall_status === "transformation_required";
  const toolbarCanRenderPreview = Boolean(
    draft && context.data && toolbarTranscriptionReady && !queueRender.isPending,
  );
  const toolbarCanRenderFinal =
    toolbarRenderedPreviewAvailable &&
    !toolbarRenderFailed &&
    toolbarTranscriptionReady &&
    !queueRender.isPending &&
    !toolbarRed;
  const toolbarFinalDisabledReason = toolbarRenderedPreviewAvailable
    ? toolbarRed
      ? "Render final menunggu perbaikan transformasi."
      : null
    : "Render final tersedia setelah preview berhasil.";
  const toolbarRenderBusy = ["queued", "running"].includes(toolbarActiveRender?.status || "");
  const toolbarUnsaved =
    editorDirty ||
    timelineDirty ||
    Boolean(context.data && uploadTitle.trim() !== context.data.candidate_title);

  useEffect(() => {
    if (!draft || !context.data) {
      layout.setEditorToolbar(null);
      return undefined;
    }

    const title = uploadTitle || context.data.project_title;
    const meta = `${formatTime(context.data.clip_start_seconds)} - ${formatTime(
      context.data.clip_end_seconds,
    )} / ${formatTime(context.data.clip_duration_seconds)}`;
    const badge = toolbarUnsaved ? (
      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black uppercase text-amber-700">
        Belum disimpan
      </span>
    ) : null;
    const canDownload = toolbarActiveRender?.status === "completed";
    const previewLabel = toolbarRenderBusy ? "Rendering..." : "Render Preview";
    const saveLabel = save.isPending ? "Menyimpan..." : "Simpan";

    const actions = (
      <>
        <Link className="btn-secondary px-3 py-2 text-sm" to={`/jobs/${draft.project_id}/clips`}>
          Kembali ke Klip
        </Link>
        <button
          className="btn-secondary px-3 py-2 text-sm"
          disabled={!toolbarUnsaved || save.isPending}
          onClick={() => save.mutate()}
          type="button"
        >
          {saveLabel}
        </button>
        <button
          className="btn-secondary px-3 py-2 text-sm"
          disabled={!toolbarCanRenderPreview}
          onClick={() => {
            setSelectedEditorContext("render");
            queueRender.mutate(true);
          }}
          type="button"
        >
          {previewLabel}
        </button>
        <button
          className="btn px-3 py-2 text-sm"
          disabled={!toolbarCanRenderFinal}
          onClick={() => {
            setSelectedEditorContext("render");
            queueRender.mutate(false);
          }}
          title={toolbarFinalDisabledReason || undefined}
          type="button"
        >
          Render Final
        </button>
        {canDownload && (
          <a className="btn-secondary px-3 py-2 text-sm" href={downloadUrl(toolbarActiveRender.id)}>
            Download
          </a>
        )}
      </>
    );
    const compactActions = (
      <>
        <Link
          className="btn-secondary block w-full px-3 py-2 text-center text-sm"
          to={`/jobs/${draft.project_id}/clips`}
        >
          Kembali ke Klip
        </Link>
        <button
          className="btn-secondary w-full px-3 py-2 text-sm"
          disabled={!toolbarUnsaved || save.isPending}
          onClick={() => save.mutate()}
          type="button"
        >
          {saveLabel}
        </button>
        <button
          className="btn-secondary w-full px-3 py-2 text-sm"
          disabled={!toolbarCanRenderPreview}
          onClick={() => {
            setSelectedEditorContext("render");
            queueRender.mutate(true);
          }}
          type="button"
        >
          {previewLabel}
        </button>
        <button
          className="btn w-full px-3 py-2 text-sm"
          disabled={!toolbarCanRenderFinal}
          onClick={() => {
            setSelectedEditorContext("render");
            queueRender.mutate(false);
          }}
          title={toolbarFinalDisabledReason || undefined}
          type="button"
        >
          Render Final
        </button>
        {canDownload && (
          <a
            className="btn-secondary block w-full px-3 py-2 text-center text-sm"
            href={downloadUrl(toolbarActiveRender.id)}
          >
            Download
          </a>
        )}
        {!toolbarCanRenderFinal && toolbarFinalDisabledReason && (
          <p className="text-xs font-semibold text-slate-500">{toolbarFinalDisabledReason}</p>
        )}
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
    editorDirty,
    latestRender.data,
    layout,
    preset,
    queueRender,
    render,
    renderDirty,
    renderStatus.data,
    report,
    save,
    timelineDirty,
    toolbarActiveRender,
    toolbarCanRenderFinal,
    toolbarCanRenderPreview,
    toolbarFinalDisabledReason,
    toolbarRenderBusy,
    toolbarUnsaved,
    uploadTitle,
  ]);

  if (!draft || !context.data) {
    return <p className="py-20 text-center text-slate-500">Memuat editor...</p>;
  }

  const activeRender = renderStatus.data || render || latestRender.data;
  const red = report?.overall_status === "transformation_required";
  const transcriptionReady = !context.data.transcription_is_demo;
  const set = (key: keyof Transformation, value: unknown) => {
    setEditorDirty(true);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };
  const setStyle = (key: string, value: unknown) => {
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
  const error =
    save.error ||
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

  const sourceClipUrl = `${sourceVideoUrl(draft.project_id)}#t=${
    context.data.clip_start_seconds
  },${context.data.clip_end_seconds}`;
  const renderedPreviewAvailable =
    !renderDirty &&
    activeRender?.status === "completed" &&
    activeRender.preset === preset &&
    Boolean(activeRender.file_size_bytes === undefined || activeRender.file_size_bytes > 20_000);
  const renderedPreviewUrl =
    renderedPreviewAvailable && activeRender
      ? `${downloadUrl(activeRender.id)}?v=${activeRender.id}-${activeRender.status}-${activeRender.width}x${activeRender.height}-${activeRender.file_size_bytes || 0}`
      : null;
  const styleConfig = {
    ...styleDefaults.clean_podcast,
    ...(draft.clipper_style_config || {}),
    caption_style: normalizeCaptionStyleConfig(draft.clipper_style_config?.caption_style),
  };
  const hookPreview = safeHookPreview(styleConfig.hook_text);
  const keywordPreview = previewKeywords(
    context.data.candidate_transcript,
    draft.original_hook,
    draft.new_angle,
  );
  const effectTimeline = liveEffectTimeline(
    styleConfig as Record<string, unknown>,
    Math.max(0, context.data.clip_duration_seconds),
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
  const configuredEffectTimeline = Array.isArray(styleConfig.effect_timeline)
    ? (styleConfig.effect_timeline as EffectTimelineEvent[])
    : [];
  const clipDuration = Math.max(0, context.data.clip_duration_seconds);
  const captionStyle = styleConfig.caption_style;
  const currentCaptionCue = activeCaptionCue(context.data.caption_cues || [], previewTime);
  const subtitlePreview = currentCaptionCue
    ? getSafeSubtitlePreview(currentCaptionCue.text)
    : null;
  const karaokeWords = subtitlePreview ? subtitlePreview.split(/\s+/) : [];
  const karaokeActiveIndex =
    currentCaptionCue && karaokeWords.length
      ? Math.min(
          karaokeWords.length - 1,
          Math.max(
            0,
            Math.floor(
              ((previewTime - currentCaptionCue.start) /
                Math.max(0.1, currentCaptionCue.end - currentCaptionCue.start)) *
                karaokeWords.length,
            ),
          ),
        )
      : -1;
  const editableEffectTimeline = configuredEffectTimeline.map((event, index) => ({
    ...event,
    id: editableEventId(event, index),
  }));
  const selectedEvent =
    editableEffectTimeline.find((event) => event.id === selectedEventId) || null;
  const updateEffectTimeline = (events: EffectTimelineEvent[]) => {
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
            ? { ...base, text: hookPreview || "Hook video" }
            : { ...base, effect: "quick_zoom_shift" };
    updateEffectTimeline([...editableEffectTimeline, event]);
    setSelectedEventId(event.id || null);
    setSelectedEditorContext(contextFromEventType(event.type));
  };
  const timelineCaptionItems: TimelineItem[] = (context.data.caption_cues || [])
    .filter((cue) => cue.end > cue.start)
    .map((cue, index) => ({
      id: `caption-${index}`,
      start: cue.start,
      end: cue.end,
      label: "",
      active: previewTime >= cue.start && previewTime <= cue.end,
      title: `Caption\n${formatTimePrecise(cue.start)}-${formatTimePrecise(cue.end)}\n${cue.text}`,
      colorClass: "bg-violet-500/90 text-white",
    }));
  const hookEvents = editableEffectTimeline.filter((event) => event.type === "hook_text");
  const timelineHookItems: TimelineItem[] = (
    hookEvents.length
      ? hookEvents
      : styleConfig.hook_text_enabled && hookPreview
        ? [
            {
              id: "hook-preview",
              type: "hook_text",
              start: 0,
              end: Math.min(3, Math.max(1, clipDuration)),
              text: hookPreview,
            },
          ]
        : []
  ).map((event) => ({
    id: event.id || "hook-preview",
    eventId: event.id,
    editable: Boolean(event.id),
    type: "hook_text",
    start: event.start,
    end: event.end,
    label: "Hook",
    active: previewTime >= event.start && previewTime <= event.end,
    title: `Hook Text\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}\n${event.text || hookPreview}`,
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
    if (renderedPreviewUrl || videoTime <= clipDuration + 0.5) {
      return clampClipTime(videoTime);
    }
    return clampClipTime(videoTime - context.data.clip_start_seconds);
  };
  const videoTimeFromClipTime = (clipTime: number) =>
    renderedPreviewUrl ? clampClipTime(clipTime) : context.data.clip_start_seconds + clampClipTime(clipTime);
  const setPreviewTimeFromVideo = (videoTime: number) => {
    setPreviewTime(clipTimeFromVideoTime(videoTime));
  };
  const seekPreviewTo = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    const video = previewVideoRef.current;
    setPreviewTime(safeTime);
    if (video) {
      video.currentTime = videoTimeFromClipTime(safeTime);
    }
  };
  const timelineTimeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0;
    return {
      percent: ratio * 100,
      time: clampClipTime(ratio * clipDuration),
    };
  };
  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    wasPlayingBeforeDrag.current = Boolean(previewVideoRef.current && !previewVideoRef.current.paused);
    const target = timelineTimeFromPointer(event);
    setTimelineDragging(true);
    setTimelineHover(target);
    seekPreviewTo(target.time);
  };
  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = timelineTimeFromPointer(event);
    setTimelineHover(target);
    if (timelineDragging) {
      seekPreviewTo(target.time);
    }
  };
  const finishTimelineDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!timelineDragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setTimelineDragging(false);
    if (wasPlayingBeforeDrag.current && previewVideoRef.current?.paused) {
      void previewVideoRef.current.play();
    }
  };
  const timeFromClientX = (clientX: number, left: number, width: number) => {
    const ratio = width ? Math.min(1, Math.max(0, (clientX - left) / width)) : 0;
    return clampClipTime(ratio * clipDuration);
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
  };
  const handleEventClick = (item: TimelineItem) => {
    if (item.eventId) {
      setSelectedEventId(item.eventId);
      setSelectedEditorContext(contextFromEventType(item.type));
    }
  };
  const timelinePointerProps = {
    onPointerCancel: finishTimelineDrag,
    onPointerDown: handleTimelinePointerDown,
    onPointerLeave: () => {
      if (!timelineDragging) setTimelineHover(null);
    },
    onPointerMove: handleTimelinePointerMove,
    onPointerUp: finishTimelineDrag,
  };
  const editableMarkerProps = {
    onItemClick: handleEventClick,
    onItemPointerDown: handleEventPointerDown,
    onItemPointerMove: handleEventPointerMove,
    onItemPointerUp: handleEventPointerUp,
  };
  const finalDisabledReason = renderedPreviewAvailable
    ? red
      ? "Render final menunggu perbaikan transformasi."
      : null
    : "Render final tersedia setelah preview berhasil.";
  const previewModeText = renderedPreviewAvailable
    ? "Preview hasil render."
    : renderDirty
      ? "Live Preview dari perubahan editor."
      : "Preview sumber, belum hasil render.";
  const currentRenderLabel = renderLabel(activeRender, renderedPreviewAvailable);
  const previewStatus =
    activeRender && activeRender.width < 1000 ? activeRender.status : "idle";
  const finalStatus =
    activeRender && activeRender.width >= 1000 ? activeRender.status : "idle";
  const assessmentStatus = assess.isPending ? "running" : report ? "completed" : "idle";
  const playheadPercent = Math.min(
    100,
    Math.max(0, (previewTime / Math.max(1, clipDuration)) * 100),
  );
  const tickStep = clipDuration > 45 ? 10 : 5;
  const ticks = Array.from(
    new Set([
      ...Array.from(
        { length: Math.floor(clipDuration / tickStep) + 1 },
        (_, index) => index * tickStep,
      ).filter((tick) => tick <= clipDuration),
      clipDuration,
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

  return (
    <div className="flex min-h-[calc(100vh-96px)] flex-col gap-3 xl:overflow-hidden">
      <WorkflowSteps current={3} />

      <nav className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
        <Link className="text-violet-700 hover:underline" to="/">
          Projects
        </Link>
        <span>/</span>
        <Link
          className="text-violet-700 hover:underline"
          to={`/jobs/${draft.project_id}/clips`}
        >
          {context.data.project_title}
        </Link>
        <span>/</span>
        <span>5 Klip Terbaik</span>
        <span>/</span>
        <span className="text-slate-800">Edit Klip</span>
      </nav>

      <section className="-mx-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wide text-violet-600">
              Tahap 3 - Editing Klip
            </p>
            <h1 className="mt-1 max-w-[52rem] truncate text-lg font-black text-slate-950">
              {uploadTitle || context.data.project_title}
            </h1>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {formatTime(context.data.clip_start_seconds)} -{" "}
              {formatTime(context.data.clip_end_seconds)} / {formatTime(clipDuration)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
            <button
              onClick={() => setSelectedEditorContext("render")}
              type="button"
            >
              <StatusBadge status={previewStatus} />
            </button>
            {toolbarUnsaved && (
              <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-700">
                Belum disimpan
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-3 py-2">
              {presetOptions.find((item) => item.value === preset)?.label}
            </span>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 gap-4 xl:h-[calc(100vh-430px)] xl:max-h-[500px] xl:min-h-[340px] xl:grid-cols-[minmax(280px,330px)_minmax(440px,660px)_minmax(300px,340px)] xl:items-stretch xl:justify-center">
        <aside className="min-h-0 space-y-4 xl:h-full xl:overflow-y-auto xl:pr-1">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-950">Konten Klip</h2>
              {toolbarUnsaved && (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                  Belum disimpan
                </span>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <AccordionSection
                id="title"
                isOpen={openLeftSection === "title"}
                onToggle={toggleLeftSection}
                summary={uploadTitle || "Judul belum tersedia"}
                title="Judul Klip"
              >
                <label htmlFor="upload_title">Judul Klip</label>
                <input
                  id="upload_title"
                  maxLength={300}
                  value={uploadTitle}
                  onChange={(event) => {
                    setEditorDirty(true);
                    setUploadTitle(event.target.value);
                  }}
                />
                <button
                  className="btn-secondary mt-2 px-3 py-2 text-xs"
                  disabled={regenerate.isPending}
                  onClick={() => regenerate.mutate()}
                  type="button"
                >
                  {regenerate.isPending ? "Membuat..." : "Buat ulang judul"}
                </button>
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
                  <button
                    type="button"
                    className="btn-secondary px-3 py-2 text-xs"
                    disabled={regenerateHook.isPending}
                    onClick={() => regenerateHook.mutate()}
                  >
                    {regenerateHook.isPending ? "Membuat..." : "Buat ulang hook"}
                  </button>
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

              <AccordionSection
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
              </AccordionSection>

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
                  <button
                    className="btn-secondary px-3 py-2 text-xs"
                    disabled={regenerateCaption.isPending || applySource.isPending}
                    onClick={() => regenerateCaption.mutate()}
                    type="button"
                  >
                    {regenerateCaption.isPending ? "Membuat..." : "Buat ulang deskripsi"}
                  </button>
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

              <AccordionSection
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
              </AccordionSection>
            </div>
          </section>
        </aside>

        <main className="mx-auto flex min-h-0 w-full max-w-[660px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-md xl:h-full">
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
              setSelectedEditorContext("video");
            }}
          >
            <div className="relative aspect-[9/16] h-[clamp(300px,38vh,420px)] max-h-full max-w-full overflow-hidden rounded-xl bg-black shadow-xl">
              {renderedPreviewUrl ? (
                <video
                  className="h-full w-full object-cover"
                  controls
                  onLoadedMetadata={(event) => setPreviewTimeFromVideo(event.currentTarget.currentTime)}
                  onPause={() => setPreviewPlaying(false)}
                  onPlay={() => setPreviewPlaying(true)}
                  onSeeked={(event) => setPreviewTimeFromVideo(event.currentTarget.currentTime)}
                  onTimeUpdate={(event) => setPreviewTimeFromVideo(event.currentTarget.currentTime)}
                  preload="metadata"
                  ref={previewVideoRef}
                  src={renderedPreviewUrl}
                />
              ) : (
                <div className={`h-full w-full ${livePreviewFilterClass}`} style={liveZoomStyle}>
                  <PresetVideo
                    src={sourceClipUrl}
                    preset={preset}
                    controls
                    onLoadedMetadata={setPreviewTimeFromVideo}
                    onPause={() => setPreviewPlaying(false)}
                    onPlay={() => setPreviewPlaying(true)}
                    onSeeked={setPreviewTimeFromVideo}
                    onTimeUpdate={setPreviewTimeFromVideo}
                    videoRef={previewVideoRef}
                  />
                </div>
              )}
              {!renderedPreviewAvailable && (
                <>
                  {styleConfig.hook_text_enabled && hookPreview && (
                    <div
                      className="pointer-events-auto absolute left-8 right-8 top-8 cursor-pointer rounded-xl bg-black/55 p-3 text-center text-base font-black text-white"
                      onClick={(event) => {
                        event.stopPropagation();
                        const hookEvent = editableEffectTimeline.find((item) => item.type === "hook_text");
                        setSelectedEventId(hookEvent?.id || null);
                        setSelectedEditorContext("hook");
                      }}
                    >
                      {hookPreview}
                    </div>
                  )}
                  {styleConfig.keyword_popup_enabled && liveKeywordEvent?.text && (
                    <div
                      className="pointer-events-auto absolute bottom-32 left-10 right-10 cursor-pointer rounded-xl bg-yellow-300/90 px-3 py-2 text-center text-xl font-black text-slate-950 shadow-xl"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEventId(liveKeywordEvent.id || null);
                        setSelectedEditorContext("keyword");
                      }}
                    >
                      {liveKeywordEvent.text}
                    </div>
                  )}
                  {subtitlePreview && (
                    <div
                      className={`pointer-events-auto absolute left-[10%] right-[10%] z-20 cursor-pointer text-center leading-snug ${captionPositionClass(
                        captionStyle.position,
                      )} ${captionSizeClass(captionStyle.fontSize)} ${captionWeightClass(
                        captionStyle.fontWeight,
                      )}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedEditorContext("caption");
                      }}
                      style={{
                        color: captionStyle.textColor,
                        textShadow: [
                          captionStyle.outlineEnabled
                            ? "0 1px 2px #000, 1px 0 1px #000, -1px 0 1px #000, 0 -1px 1px #000"
                            : "",
                          captionStyle.shadowEnabled ? "0 4px 10px rgba(0,0,0,0.55)" : "",
                        ]
                          .filter(Boolean)
                          .join(", "),
                      }}
                    >
                      <span
                        className={`inline-block max-w-full rounded-lg px-3 py-2 ${
                          captionStyle.backgroundEnabled ? "" : "bg-transparent"
                        }`}
                        style={{
                          backgroundColor: captionStyle.backgroundEnabled
                            ? `rgba(0,0,0,${captionStyle.backgroundOpacity})`
                            : "transparent",
                        }}
                      >
                        {captionStyle.karaokeEnabled ? (
                          karaokeWords.map((word, index) => (
                            <span
                              key={`${word}-${index}`}
                              style={{
                                color:
                                  index <= karaokeActiveIndex
                                    ? captionStyle.highlightColor
                                    : captionStyle.textColor,
                              }}
                            >
                              {word}
                              {index < karaokeWords.length - 1 ? " " : ""}
                            </span>
                          ))
                        ) : (
                          subtitlePreview
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {activeRender?.status === "failed" && (
            <div className="mx-4 mb-3 rounded-xl bg-red-950/70 p-2.5 text-xs font-semibold text-red-100">
              {activeRender.error_message || "Render gagal."}
            </div>
          )}
          {keywordSkipped && (
            <div className="mx-4 mb-3 rounded-xl bg-amber-900/70 p-2.5 text-xs font-semibold text-amber-100">
              Keyword pop-up dilewati karena tidak ada kata/frasa penting yang layak.
            </div>
          )}
        </main>

        <aside className="min-h-0 space-y-3 xl:h-full xl:overflow-y-auto xl:pr-1">
          <section className="sticky top-0 z-10 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-violet-600">
                  Contextual Tools
                </p>
                <h2 className="mt-1 truncate text-base font-black text-slate-950">
                  {selectedEditorContext === "caption"
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
                              ? "Render Tools"
                              : "Video Tools"}
                </h2>
              </div>
              {toolbarUnsaved && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">
                  Belum disimpan
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-1">
              {[
                ["video", "Video"],
                ["caption", "Caption"],
                ["timeline", "Timeline"],
                ["render", "Render"],
              ].map(([contextValue, label]) => (
                <button
                  className={`rounded-lg px-2 py-2 text-xs font-black ${
                    selectedEditorContext === contextValue
                      ? "bg-violet-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                  key={contextValue}
                  onClick={() => {
                    setSelectedEventId(null);
                    setSelectedEditorContext(contextValue as EditorContext);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {selectedEditorContext === "video" && (
            <>
          <ToolSection title="Template Video">
            <div className="grid grid-cols-2 gap-2">
              {presetOptions.map(({ value, label }) => (
                <button
                  className={`rounded-xl border-2 p-2 text-left text-xs font-bold ${
                    preset === value
                      ? "border-violet-600 bg-violet-50 text-violet-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                  key={value}
                  onClick={() => selectPreset(value)}
                >
                  <div className="mb-2 aspect-[9/16] w-12 overflow-hidden rounded-md bg-black">
                    <PresetVideo src={sourceClipUrl} preset={value} />
                  </div>
                  {label}
                </button>
              ))}
            </div>
          </ToolSection>

          <ToolSection title="Gaya Editing">
            <div className="grid grid-cols-2 gap-2">
              {stylePresets.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  className={`rounded-xl border-2 p-2.5 text-left text-xs font-bold ${
                    styleConfig.clipper_style_preset === item.value
                      ? "border-violet-600 bg-violet-50 text-violet-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                  onClick={() => {
                    setRenderDirty(true);
                    setRender(undefined);
                    set("clipper_style_config", {
                      ...styleDefaults[item.value],
                      hook_text: styleConfig.hook_text,
                      effect_timeline: styleConfig.effect_timeline || [],
                      render_preset: preset,
                    });
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
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

          {selectedEditorContext === "caption" && (
            <ToolSection title="Caption Style Studio">
              <div className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                <p>Caption aktif dan sinkron</p>
                <p className="mt-1 text-emerald-800">
                  {timelineCaptionItems.length} cue / timing read-only / max{" "}
                  {captionStyle.maxWords} kata, {captionStyle.maxChars} karakter
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">
                  Preset Caption
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {captionStylePresets.map((item) => (
                    <button
                      className={`rounded-xl border-2 p-2 text-left text-xs font-bold ${
                        captionStyle.preset === item.value
                          ? "border-violet-600 bg-violet-50 text-violet-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                      key={item.value}
                      onClick={() => setCaptionStyle(item.config)}
                      type="button"
                    >
                      <span className="block">{item.label}</span>
                      <span className="mt-1 block text-[10px] font-semibold opacity-75">
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

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
                  <div>
                    <label htmlFor="caption_max_words">Kata</label>
                    <input
                      id="caption_max_words"
                      max={8}
                      min={1}
                      type="number"
                      value={captionStyle.maxWords}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        setCaptionStyle({ maxWords: value });
                      }}
                    />
                  </div>
                  <div>
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
                    ["karaokeEnabled", "Karaoke preview"],
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
                Perubahan style tampil di Live Preview. Render style ke MP4 akan dilanjutkan pada tahap berikutnya.
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
                          const maxEnd = Math.min(clipDuration, selectedEvent.start + bounds.max);
                          const nextEnd = Math.min(
                            maxEnd,
                            Math.max(selectedEvent.start + bounds.min, rawEnd),
                          );
                          replaceEvent(selectedEvent.id || "", { end: Number(nextEnd.toFixed(2)) });
                        }}
                      />
                    </div>
                  </div>
                  <p className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600">
                    Durasi: {(selectedEvent.end - selectedEvent.start).toFixed(1)} detik
                    {selectedEvent.reason ? ` / Reason: ${selectedEvent.reason}` : ""}
                  </p>
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
                  <button
                    className="rounded-lg bg-red-50 px-3 py-2 text-xs font-black text-red-700"
                    onClick={() => deleteEvent(selectedEvent.id || "")}
                    type="button"
                  >
                    Hapus event
                  </button>
                </>
              )}
            </ToolSection>
          )}

          {selectedEditorContext === "render" && (
          <ToolSection title="Render Queue">
            <select
              value={subtitleLanguage}
              onChange={(event) => setSubtitleLanguage(event.target.value as "id" | "en")}
            >
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </select>
            <ProcessRow
              label="Preview"
              status={previewStatus}
              detail={previewStatus === "failed" ? activeRender?.error_message : currentRenderLabel}
            />
            <ProcessRow
              label="Final"
              status={finalStatus}
              detail={finalStatus === "idle" ? finalDisabledReason : activeRender?.warning_message}
            />
            <ProcessRow
              label="Penilaian"
              status={assessmentStatus}
              detail={
                report
                  ? `Skor ${report.transformative_value_score.toFixed(0)} / Risiko ${report.copyright_risk_level}`
                  : "Belum dinilai"
              }
            />
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <div className="grid gap-2 text-xs font-semibold text-slate-500">
                <div className="flex items-center justify-between gap-3">
                  <span>Caption</span>
                  <span className="font-black text-emerald-700">Aktif dan sinkron</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Template</span>
                  <strong className="text-right text-slate-800">
                    {presetOptions.find((item) => item.value === preset)?.label}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Gaya</span>
                  <strong className="text-right text-slate-800">
                    {stylePresets.find((item) => item.value === styleConfig.clipper_style_preset)?.label}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Efek</span>
                  <strong className="text-right text-slate-800">
                    {effectSummary.punch} punch, {effectSummary.keyword} keyword, {effectSummary.pattern} pattern
                  </strong>
                </div>
              </div>
            </div>
            {activeRender?.status === "failed" && (
              <button
                className="btn-secondary w-full px-3 py-2 text-sm"
                disabled={!toolbarCanRenderPreview}
                onClick={() => queueRender.mutate(true)}
                type="button"
              >
                Coba render ulang
              </button>
            )}
            {activeRender?.warning_message && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                Fallback: {activeRender.warning_message}
              </div>
            )}
            {activeRender?.error_message && (
              <div className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
                Error: {activeRender.error_message}
              </div>
            )}
            {keywordSkipped && (
              <div className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                Keyword pop-up dilewati: tidak ada frasa penting yang cocok.
              </div>
            )}
            {activeRender?.status === "completed" && (
              <a className="btn w-full" href={downloadUrl(activeRender.id)}>
                Download MP4
              </a>
            )}
          </ToolSection>
          )}
        </aside>
      </div>

      <section
        className="min-h-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:h-[260px] xl:overflow-hidden"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          setSelectedEventId(null);
          setSelectedEditorContext("timeline");
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-950">Timeline Editing</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Durasi {formatTimeLabel(clipDuration)} - Playhead {formatTimeLabel(previewTime)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap gap-2 text-[11px] font-bold text-slate-600">
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
            {timelineDirty && (
              <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">
                Ada perubahan belum disimpan
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
              Detail event dibuka di panel kanan.
            </span>
          )}
        </div>

        <div className="mt-3 min-h-0 overflow-y-auto pr-1 xl:max-h-[168px]">
          <div className="grid grid-cols-[76px_minmax(0,1fr)] items-end gap-3">
            <div />
            <div className="relative h-7 touch-none border-b border-slate-200" {...timelinePointerProps}>
              {ticks.map((tick) => (
                <div
                  className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center gap-1"
                  key={tick}
                  style={{ left: eventLeft(tick, clipDuration) }}
                >
                  <span className="h-2 w-px bg-slate-300" />
                  <span className="text-[10px] font-bold text-slate-400">
                    {formatTimeLabel(tick)}
                  </span>
                </div>
              ))}
              {timelineHover && (
                <span
                  className="pointer-events-none absolute top-0 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-[10px] font-black text-white shadow"
                  style={{ left: `${timelineHover.percent}%` }}
                >
                  {formatTimeLabel(timelineHover.time)}
                </span>
              )}
            </div>
          </div>

          <div className="relative mt-2 space-y-1.5">
            <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3">
              <div />
              <div className="relative h-5 touch-none" {...timelinePointerProps}>
                <span
                  className="absolute -translate-x-1/2 cursor-ew-resize rounded bg-slate-950 px-2 py-1 text-[10px] font-black text-white"
                  style={{ left: `${playheadPercent}%` }}
                >
                  {formatTimeLabel(previewTime)}
                </span>
              </div>
            </div>
            <TimelineTrack
              duration={clipDuration}
              items={timelineCaptionItems}
              label="Caption"
              onItemClick={() => setSelectedEditorContext("caption")}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              emptyText="Belum ada cue caption"
            />
            <TimelineTrack
              duration={clipDuration}
              items={timelineHookItems}
              label="Hook"
              {...editableMarkerProps}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
            />
            <TimelineTrack
              duration={clipDuration}
              items={timelinePunchItems}
              label="Punch"
              {...editableMarkerProps}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              emptyText={styleConfig.punch_zoom_enabled ? "Belum ada momen efek" : "Tidak aktif"}
            />
            <TimelineTrack
              duration={clipDuration}
              items={timelineKeywordItems}
              label="Keyword"
              {...editableMarkerProps}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              emptyText={keywordSkipped ? "Tidak ada frasa penting" : "Tidak ada event"}
            />
            <TimelineTrack
              duration={clipDuration}
              items={timelinePatternItems}
              label="Pattern"
              {...editableMarkerProps}
              {...timelinePointerProps}
              playheadPercent={playheadPercent}
              emptyText={styleConfig.pattern_interrupt_enabled ? "Belum ada event valid" : "Tidak aktif"}
            />
          </div>
        </div>

        {!configuredEffectTimeline.length && (
          <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs font-semibold text-amber-800">
            Belum ada timeline efek tersimpan. Render preview akan membuat timeline efek dari transcript dan interval aman.
          </p>
        )}
      </section>

      {context.data.source_mismatch_warning && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          {context.data.source_mismatch_warning}
        </p>
      )}
      {message && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">
          {message}
        </div>
      )}
      {error && <p className="text-red-600">{error.message}</p>}
    </div>
  );
}
