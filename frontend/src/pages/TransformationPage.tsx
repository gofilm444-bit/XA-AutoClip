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
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  API_URL,
  api,
  candidateVideoUrl,
  downloadUrl,
  generateEditorAutoCaptions,
  mediaUrl,
  upload,
  uploadedAudioUrl,
  uploadMedia,
} from "../api/client";
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
  getActiveVideoSegment,
  getNextVideoSegment,
  getTimelineDuration,
  hasManualEditorTimelineVideo,
  initialEditorContext,
  isManualEditorTransformation,
  normalizeMediaSequence,
  resolveVideoSegmentSource,
  resolveVideoSourceTime,
  trimMediaSegmentRight,
  effectiveMediaDuration,
  sameMediaSource,
  type MediaSequenceSegment,
} from "../utils/manualEditor";
import {
  resolveHookPreviewRenderState,
  resolveHookSafeArea,
} from "../utils/hookSafeArea";
import {
  TEXT_STYLE_PRESETS,
  getTextStylePreset,
  normalizeTextStylePreset,
  resolveTextOverlayStyle,
  type TextStylePresetKey,
} from "../utils/textStylePresets";
import {
  DEFAULT_MAIN_CAPTION_STYLE,
  applyCaptionTemplateToCaptionItem,
  applyCaptionTemplateToMainStyle,
  computeKaraokeWordProgress,
  extractHighlightedWordIndices,
  formatCaptionCase,
  normalizeMainCaptionStyle,
  resolveCaptionStyle,
  type CaptionCueItem,
  type CaptionTemplate,
  type MainCaptionStyle,
} from "../utils/captionTemplates";
import { packTimelineItemsIntoLanes } from "../utils/timelinePacking";
import { FontPicker } from "../components/FontPicker";
import { CaptionTemplateGallery } from "../components/CaptionTemplateGallery";
import {
  FONT_CATALOG,
  getFontByFamily,
  getFontById,
  resolveFontFamily,
} from "../utils/fontCatalog";

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
  manifest_hash?: string;
  cache_reused?: boolean;
  progress?: number;
  progress_percent?: number;
};

type EffectTimelineEvent = {
  id?: string;
  type: "punch_zoom" | "keyword_popup" | "pattern_interrupt" | "hook_text" | string;
  start: number;
  end: number;
  locked?: boolean;
  visible?: boolean;
  zoom?: number;
  text?: string;
  title?: string;
  content?: string;
  effect?: string;
  reason?: string;
  position?: string;
  size?: string;
  preset?: TextStylePresetKey | string;
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
};

type EditorContext = "details" | "media" | "video" | "audio" | "caption" | "hook" | "keyword" | "effect" | "timeline" | "render";
export type EditorNavTab =
  | "autoclip"
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "effects"
  | "effect"
  | "transitions"
  | "caption"
  | "templates";
type EditorMediaKind = "video" | "audio" | "image";

const defaultMusicTracks = [
  { id: "mus-1", name: "Clean Corporate", duration: 60, desc: "Instrumen ceria dan modern untuk konten bisnis/edukasi" },
  { id: "mus-2", name: "Soft Podcast Bed", duration: 90, desc: "Latar nada santai dan hangat untuk podcast obrolan" },
  { id: "mus-3", name: "Upbeat Short", duration: 30, desc: "Ketukan dinamis untuk video pendek TikTok / Reels" },
  { id: "mus-4", name: "Dramatic News", duration: 45, desc: "Ketegangan ritmik untuk cuplikan berita penting" },
  { id: "mus-5", name: "Calm Ambient", duration: 120, desc: "Suasana tenang untuk konten vlog atau relaksasi" },
];

const textTemplates: Array<{
  id: string;
  label: string;
  preset: TextStylePresetKey;
  sample: string;
  category: string;
  tag?: string;
}> = [
  { id: "tpl-hook", label: "Viral Hook", preset: "yellow_viral", sample: "WAJIB TAHU INI!", category: "Trending", tag: "Viral" },
  { id: "tpl-clean", label: "Clean Title", preset: "clean_white", sample: "Judul Modern", category: "Trending", tag: "Clean" },
  { id: "tpl-thanks", label: "Thanks for Watching", preset: "clean_subtitle_pro", sample: "Thanks for Watching!", category: "Outro", tag: "Outro" },
  { id: "tpl-qcomment", label: "Question Comment", preset: "clean_creator", sample: "Gimana menurut kalian?", category: "Social", tag: "Social" },
  { id: "tpl-ri", label: "Republik Indonesia", preset: "authority_blue", sample: "REPUBLIK INDONESIA", category: "Trending", tag: "Title" },
  { id: "tpl-news", label: "Breaking News", preset: "breaking_news", sample: "BREAKING NEWS", category: "Trending", tag: "News" },
  { id: "tpl-podcast", label: "Podcast Quote", preset: "podcast_quote", sample: "“Kutipan Penting”", category: "Podcast", tag: "Quote" },
  { id: "tpl-subtitle-box", label: "Subtitle Box", preset: "black_white", sample: "HIGHLIGHT BOX", category: "Box", tag: "Box" },
  { id: "tpl-bold", label: "Big Bold Caption", preset: "white_bold_shadow", sample: "POIN UTAMA", category: "Bold", tag: "Bold" },
  { id: "tpl-pop", label: "Pop Keyword", preset: "purple_pop", sample: "Pop Highlight", category: "Pop", tag: "Pop" },
  { id: "tpl-lowerthird", label: "Lower Third", preset: "authority_blue", sample: "Nama & Jabatan", category: "Lower Third", tag: "Lower Third" },
];

const textEffectsList = [
  { id: "fx-glow", label: "Glow Cyan", preset: "neon_cyan" as TextStylePresetKey, icon: "💡", sample: "Glow Effect", desc: "Cyan glow menyala terang" },
  { id: "fx-shadow", label: "Deep Shadow", preset: "white_bold_shadow" as TextStylePresetKey, icon: "🌑", sample: "Shadow Effect", desc: "Drop shadow pekat kontras" },
  { id: "fx-stroke", label: "Bold Stroke", preset: "bold_stroke_impact" as TextStylePresetKey, icon: "🔲", sample: "Stroke Effect", desc: "Garis luar tebal berani" },
  { id: "fx-pop", label: "Yellow Pop", preset: "yellow_viral" as TextStylePresetKey, icon: "💥", sample: "Pop Effect", desc: "Kuning cerah popup viral" },
  { id: "fx-neon", label: "Neon Glow", preset: "neon_cyan" as TextStylePresetKey, icon: "⚡", sample: "Neon Effect", desc: "Efek lampu neon futuristik" },
  { id: "fx-bounce", label: "Bounce Accent", preset: "purple_pop" as TextStylePresetKey, icon: "🏀", sample: "Bounce Effect", desc: "Animasi punch aksen dinamis" },
  { id: "fx-typewriter", label: "Typewriter", preset: "clean_white" as TextStylePresetKey, icon: "⌨️", sample: "Type Effect", desc: "Efek ketikan teks klasik" },
];

const stickerDirectories = [
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "emoji", label: "Emoji", icon: "😀" },
  { id: "badges", label: "Badges", icon: "🏷️" },
  { id: "arrows", label: "Arrows", icon: "➡️" },
  { id: "shapes", label: "Shapes", icon: "⭕" },
  { id: "social", label: "Social", icon: "💬" },
  { id: "callouts", label: "Callouts", icon: "🗨️" },
  { id: "yours", label: "Yours", icon: "📁" },
] as const;

const stickerItems: Array<{
  id: string;
  icon: string;
  label: string;
  category: string;
  badge?: boolean;
}> = [
  // Arrows
  { id: "stk-arrow-down", icon: "⬇️", label: "Panah Bawah", category: "arrows" },
  { id: "stk-arrow-up", icon: "⬆️", label: "Panah Atas", category: "arrows" },
  { id: "stk-arrow-right", icon: "➡️", label: "Panah Kanan", category: "arrows" },
  { id: "stk-arrow-left", icon: "⬅️", label: "Panah Kiri", category: "arrows" },
  { id: "stk-target", icon: "🎯", label: "Target Pin", category: "arrows" },
  { id: "stk-pin", icon: "📌", label: "Pin Lokasi", category: "arrows" },
  // Shapes
  { id: "stk-circle-red", icon: "⭕", label: "Lingkaran Merah", category: "shapes" },
  { id: "stk-circle-fill", icon: "🔴", label: "Titik Rekam", category: "shapes" },
  { id: "stk-square", icon: "🔲", label: "Kotak Sorotan", category: "shapes" },
  { id: "stk-star", icon: "⭐", label: "Bintang Emas", category: "shapes" },
  { id: "stk-sparkles", icon: "✨", label: "Kilau Sparkles", category: "shapes" },
  { id: "stk-check", icon: "✅", label: "Checklist", category: "shapes" },
  { id: "stk-cross", icon: "❌", label: "Silang Merah", category: "shapes" },
  // Trending & Emoji
  { id: "stk-fire", icon: "🔥", label: "Api Viral", category: "trending" },
  { id: "stk-bulb", icon: "💡", label: "Ide Baru", category: "trending" },
  { id: "stk-shock", icon: "😱", label: "Kaget", category: "emoji" },
  { id: "stk-mindblown", icon: "🤯", label: "Mindblown", category: "emoji" },
  { id: "stk-laugh", icon: "😂", label: "Ketawa", category: "emoji" },
  { id: "stk-clap", icon: "👏", label: "Tepuk Tangan", category: "emoji" },
  { id: "stk-100", icon: "💯", label: "Seratus", category: "trending" },
  { id: "stk-rocket", icon: "🚀", label: "Roket", category: "trending" },
  // Badges / Labels
  { id: "stk-lbl-hot", icon: "🔥 HOT", label: "Label HOT", category: "badges", badge: true },
  { id: "stk-lbl-new", icon: "✨ NEW", label: "Label NEW", category: "badges", badge: true },
  { id: "stk-lbl-viral", icon: "⚡ VIRAL", label: "Label VIRAL", category: "badges", badge: true },
  { id: "stk-lbl-top", icon: "👑 TOP", label: "Label TOP", category: "badges", badge: true },
  { id: "stk-lbl-pro", icon: "💎 PRO", label: "Label PRO", category: "badges", badge: true },
  // Callouts
  { id: "stk-bubble", icon: "💬", label: "Bubble Chat", category: "callouts" },
  { id: "stk-quote", icon: "🗨️", label: "Balon Obrolan", category: "callouts" },
  { id: "stk-alert", icon: "⚠️", label: "Peringatan", category: "callouts" },
  { id: "stk-exclaim", icon: "❗", label: "Tanda Seru", category: "callouts" },
  { id: "stk-bell", icon: "🔔", label: "Lonceng Sub", category: "callouts" },
  { id: "stk-horn", icon: "📢", label: "Pengeras Suara", category: "callouts" },
  // Social
  { id: "stk-like", icon: "👍", label: "Jempol Like", category: "social" },
  { id: "stk-heart", icon: "❤️", label: "Hati Cinta", category: "social" },
  { id: "stk-phone", icon: "📱", label: "Smartphone", category: "social" },
  { id: "stk-cam", icon: "📸", label: "Kamera", category: "social" },
  { id: "stk-music", icon: "🎵", label: "Musik Nada", category: "social" },
];

const transitionDirectories = [
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "basic", label: "Basic", icon: "✂️" },
  { id: "slide", label: "Slide", icon: "↔️" },
  { id: "zoom", label: "Zoom", icon: "🔍" },
  { id: "blur", label: "Blur", icon: "🌫️" },
  { id: "glitch", label: "Glitch", icon: "⚡" },
  { id: "classic", label: "Classic", icon: "🎞️" },
] as const;

const transitionItems = [
  { id: "tr-cut", name: "Cut", category: "basic", icon: "✂️", desc: "Potongan instan antar klip video" },
  { id: "tr-fade", name: "Fade Black", category: "basic", icon: "⬛", desc: "Transisi memudar halus ke hitam" },
  { id: "tr-fade-white", name: "Fade White", category: "basic", icon: "⬜", desc: "Transisi memudar terang ke putih" },
  { id: "tr-cross", name: "Cross Dissolve", category: "basic", icon: "🔀", desc: "Peleburan halus dua frame berdampingan" },
  { id: "tr-flash", name: "White Flash", category: "trending", icon: "⚡", desc: "Kilatan cahaya putih dramatis" },
  { id: "tr-slide-l", name: "Slide Left", category: "slide", icon: "⬅️", desc: "Geser masuk dari kanan ke kiri" },
  { id: "tr-slide-r", name: "Slide Right", category: "slide", icon: "➡️", desc: "Geser masuk dari kiri ke kanan" },
  { id: "tr-slide-u", name: "Slide Up", category: "slide", icon: "⬆️", desc: "Geser masuk dari bawah ke atas" },
  { id: "tr-slide-d", name: "Slide Down", category: "slide", icon: "⬇️", desc: "Geser masuk dari atas ke bawah" },
  { id: "tr-zoom-in", name: "Zoom In", category: "zoom", icon: "🔍", desc: "Mendekat cepat ke frame berikutnya" },
  { id: "tr-zoom-out", name: "Zoom Out", category: "zoom", icon: "🔎", desc: "Menjauh dinamis dari frame sebelumnya" },
  { id: "tr-blur-fade", name: "Blur Fade", category: "blur", icon: "🌫️", desc: "Transisi kabur fokus modern halus" },
  { id: "tr-glitch", name: "Glitch Cut", category: "glitch", icon: "📺", desc: "Distorsi sinyal digital chromatic glitch" },
  { id: "tr-wipe-l", name: "Wipe Left", category: "classic", icon: "🎞️", desc: "Sapuan linear klasik dari sisi kanan" },
];

const sfxList = [
  { id: "sfx-whoosh", label: "Whoosh", category: "Whoosh", icon: "💨", desc: "Suara desiran transisi cepat", sound: "whoosh" as const },
  { id: "sfx-pop", label: "Pop", category: "Pop", icon: "🎈", desc: "Suara pop munculan elemen", sound: "pop" as const },
  { id: "sfx-click", label: "Click", category: "Click", icon: "🖱️", desc: "Suara klik tombol modern", sound: "click" as const },
  { id: "sfx-hit", label: "Hit Impact", category: "Hit", icon: "🥊", desc: "Suara benturan punchy", sound: "hit" as const },
  { id: "sfx-notif", label: "Notification", category: "Notification", icon: "🔔", desc: "Suara notifikasi bel aplikasi", sound: "notification" as const },
  { id: "sfx-camera", label: "Camera Shutter", category: "Camera", icon: "📸", desc: "Suara jepretan kamera potret", sound: "shutter" as const },
];

const visualEffectsList = [
  { id: "ef-punch", type: "punch_zoom" as const, label: "Punch Zoom", icon: "🔍", desc: "Zoom fokus penegas kata kunci", category: "zoom", effectName: "punch_zoom" },
  { id: "ef-quick-zoom", type: "pattern_interrupt" as const, label: "Quick Zoom", icon: "🔎", desc: "Zoom instan dramatis penegas momen", category: "zoom", effectName: "quick_zoom" },
  { id: "ef-flash", type: "pattern_interrupt" as const, label: "Flash Cut", icon: "✨", desc: "Kilatan cahaya putih memotong momen", category: "light", effectName: "flash_cut" },
  { id: "ef-light-leak", type: "pattern_interrupt" as const, label: "Light Leak", icon: "💡", desc: "Sinar hangat anamorphic flare", category: "light", effectName: "light_leak" },
  { id: "ef-shake", type: "pattern_interrupt" as const, label: "Quick Shake", icon: "📳", desc: "Goncangan halus dinamis kamera", category: "shake", effectName: "quick_shake" },
  { id: "ef-earthquake", type: "pattern_interrupt" as const, label: "Earthquake", icon: "🌋", desc: "Getaran kuat multi-axis dramatis", category: "shake", effectName: "earthquake" },
  { id: "ef-blur-pulse", type: "pattern_interrupt" as const, label: "Blur Pulse", icon: "🌫️", desc: "Denyut fokus lembut visual", category: "blur", effectName: "blur_pulse" },
  { id: "ef-glitch-pop", type: "pattern_interrupt" as const, label: "Glitch Pop", icon: "📺", desc: "Distorsi sinyal digital singkat", category: "glitch", effectName: "glitch_pop" },
  { id: "ef-digital-noise", type: "pattern_interrupt" as const, label: "Digital Noise", icon: "📡", desc: "Noise scanline digital artistik", category: "glitch", effectName: "digital_noise" },
  { id: "ef-freeze-flash", type: "pattern_interrupt" as const, label: "Freeze Flash", icon: "❄️", desc: "Jeda sesaat dramatis sebelum transisi", category: "trending", effectName: "freeze_flash" },
];

const mediaDirectories = [
  { id: "project_media", label: "Project Media", icon: "📁" },
  { id: "video", label: "Video", icon: "🎬" },
  { id: "audio", label: "Audio", icon: "🎵" },
  { id: "images", label: "Images", icon: "🖼️" },
  { id: "import", label: "Import", icon: "📥" },
] as const;

const audioDirectories = [
  { id: "music", label: "Music", icon: "🎵" },
  { id: "sfx", label: "Sound effects", icon: "🔊" },
  { id: "yours", label: "Yours", icon: "📁" },
  { id: "import", label: "Import", icon: "📥" },
  { id: "copyright", label: "Copyright", icon: "🛡️" },
] as const;

const textDirectories = [
  { id: "add_text", label: "Add text", icon: "➕" },
  { id: "yours", label: "Yours", icon: "👤" },
  { id: "text_effects", label: "Text effects", icon: "✨" },
  { id: "text_template", label: "Text template", icon: "📋" },
  { id: "auto_captions", label: "Auto captions", icon: "💬" },
  { id: "local_captions", label: "Local captions", icon: "📄" },
] as const;

const effectDirectories = [
  { id: "video_effects", label: "All Effects", icon: "✨" },
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "zoom", label: "Zoom", icon: "🔍" },
  { id: "shake", label: "Shake", icon: "📳" },
  { id: "glitch", label: "Glitch", icon: "⚡" },
  { id: "blur", label: "Blur", icon: "🌫️" },
  { id: "light", label: "Light", icon: "💡" },
] as const;

const captionDirectories = [
  { id: "auto_captions", label: "Auto captions", icon: "🤖" },
  { id: "templates", label: "Templates", icon: "🎨" },
  { id: "auto_lyrics", label: "Auto lyrics", icon: "🎵" },
  { id: "add_captions", label: "Add captions", icon: "➕" },
  { id: "local_captions", label: "Local captions", icon: "📄" },
] as const;

function LeftPanelDirectoryLayout<T extends string>({
  directories,
  activeDirectory,
  onSelectDirectory,
  children,
}: {
  directories: readonly { readonly id: T; readonly label: string; readonly icon?: string; readonly badge?: string }[];
  activeDirectory: T;
  onSelectDirectory: (id: T) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 w-full h-full">
      {/* 1. Sub-Directory Sidebar */}
      <div className="w-28 shrink-0 border-r border-zinc-800/80 bg-[#131518] p-1.5 flex flex-col gap-0.5 overflow-y-auto no-scrollbar">
        {directories.map((dir) => {
          const isActive = activeDirectory === dir.id;
          return (
            <button
              key={dir.id}
              type="button"
              onClick={() => onSelectDirectory(dir.id)}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-bold transition ${
                isActive
                  ? "bg-[#23272e] text-cyan-400 border border-cyan-500/30 shadow-sm"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              }`}
            >
              {dir.icon && <span className="text-xs shrink-0">{dir.icon}</span>}
              <span className="truncate flex-1">{dir.label}</span>
              {dir.badge && (
                <span className="rounded bg-cyan-400/20 px-1 py-0.2 text-[8px] font-black text-cyan-300">
                  {dir.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 2. Content / Library Area */}
      <div className="flex-1 min-w-0 p-3 space-y-3 overflow-y-auto custom-scrollbar bg-[#17191c]">
        {children}
      </div>
    </div>
  );
}

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch (err) {
    console.warn("WebAudio context unavailable", err);
    return null;
  }
}

function playSynthesizedSound(
  soundType: "whoosh" | "pop" | "click" | "hit" | "notification" | "shutter" | "music_preview",
  volume = 1,
) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const gainNode = ctx.createGain();
    const safeVolume = Math.min(1, Math.max(0, volume));
    gainNode.gain.setValueAtTime(safeVolume, now);
    gainNode.connect(ctx.destination);

    if (soundType === "whoosh") {
      const bufferSize = ctx.sampleRate * 0.45;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(250, now);
      filter.frequency.exponentialRampToValueAtTime(1600, now + 0.22);
      filter.frequency.exponentialRampToValueAtTime(200, now + 0.45);
      filter.Q.setValueAtTime(3.5, now);

      gainNode.gain.setValueAtTime(0.01, now);
      gainNode.gain.linearRampToValueAtTime(0.7 * safeVolume, now + 0.22);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      noise.connect(filter);
      filter.connect(gainNode);
      noise.start(now);
      noise.stop(now + 0.45);
    } else if (soundType === "pop") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.15);

      gainNode.gain.setValueAtTime(0.85 * safeVolume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gainNode);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (soundType === "click") {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(2200, now);
      osc.frequency.exponentialRampToValueAtTime(500, now + 0.04);

      gainNode.gain.setValueAtTime(0.6 * safeVolume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gainNode);
      osc.start(now);
      osc.stop(now + 0.04);
    } else if (soundType === "hit") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.35);

      gainNode.gain.setValueAtTime(0.9 * safeVolume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      osc.connect(gainNode);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (soundType === "notification") {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(1046.5, now);
      osc2.frequency.setValueAtTime(1567.98, now);

      gainNode.gain.setValueAtTime(0.5 * safeVolume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.65);
      osc2.stop(now + 0.65);
    } else if (soundType === "shutter") {
      const click1 = ctx.createOscillator();
      click1.type = "square";
      click1.frequency.setValueAtTime(1200, now);
      click1.frequency.exponentialRampToValueAtTime(300, now + 0.05);

      const click2 = ctx.createOscillator();
      click2.type = "triangle";
      click2.frequency.setValueAtTime(950, now + 0.07);
      click2.frequency.exponentialRampToValueAtTime(220, now + 0.13);

      gainNode.gain.setValueAtTime(0.5 * safeVolume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      click1.connect(gainNode);
      click2.connect(gainNode);
      click1.start(now);
      click1.stop(now + 0.05);
      click2.start(now + 0.07);
      click2.stop(now + 0.14);
    } else if (soundType === "music_preview") {
      const freqs = [261.63, 329.63, 392.0, 523.25, 440.0, 349.23];
      freqs.forEach((f, idx) => {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const noteGain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, now + idx * 0.22);
        noteGain.gain.setValueAtTime(0, now + idx * 0.22);
        noteGain.gain.linearRampToValueAtTime(0.25 * safeVolume, now + idx * 0.22 + 0.04);
        noteGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.22 + 0.5);
        osc.connect(noteGain);
        noteGain.connect(gainNode);
        osc.start(now + idx * 0.22);
        osc.stop(now + idx * 0.22 + 0.55);
      });
    }
  } catch (err) {
    console.warn("WebAudio synthesis playback error:", err);
  }
}

function sfxIdToSoundType(id: string): "whoosh" | "pop" | "click" | "hit" | "notification" | "shutter" {
  if (id === "sfx-1" || id.includes("whoosh")) return "whoosh";
  if (id === "sfx-2" || id.includes("pop")) return "pop";
  if (id === "sfx-3" || id.includes("click")) return "click";
  if (id === "sfx-4" || id.includes("hit") || id.includes("impact")) return "hit";
  if (id === "sfx-5" || id.includes("notification") || id.includes("bell")) return "notification";
  return "shutter";
}

const editorMediaInputConfig: Record<
  EditorMediaKind,
  { accept: string; label: string; icon: string; shortLabel: string }
> = {
  video: {
    accept: ".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm",
    label: "Import Video",
    icon: "🎥",
    shortLabel: "Video",
  },
  audio: {
    accept: ".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4",
    label: "Import Audio",
    icon: "🎵",
    shortLabel: "Audio",
  },
  image: {
    accept: ".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp",
    label: "Import Gambar",
    icon: "🖼️",
    shortLabel: "Gambar",
  },
};


function formatMediaDuration(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function EditorMediaImportControls({
  className = "flex items-center gap-1.5",
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
          <label
            className="relative flex-1 min-w-0"
            key={kind}
            title={config.label}
          >
            <span
              className={`flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-700/80 bg-[#22252a] px-2 py-1 text-center text-xs font-bold text-zinc-200 transition hover:border-cyan-500/60 hover:bg-[#2b2f36] hover:text-cyan-300 ${
                disabled ? "pointer-events-none opacity-50" : ""
              }`}
              title={config.label}
            >
              <span className="text-xs">{config.icon}</span>
              {uploadingKind === kind ? (
                <span className="text-[10px] animate-pulse">Upload...</span>
              ) : (
                <span className="text-[11px] font-semibold truncate">{config.shortLabel}</span>
              )}
            </span>
            <input
              accept={config.accept}
              aria-label={config.label}
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
  speed?: number;
};

type VideoFraming = {
  preset?: "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture" | "clean_podcast" | "studio_podcast" | "talking_head" | string;
  x: number;
  y: number;
  scale: number;
  rotation?: number;
  flip_h?: boolean;
  flip_v?: boolean;
  opacity?: number;
  blur_background?: boolean;
  blur_strength?: number;
  background_color?: string;
};

const defaultVideoFraming: VideoFraming = {
  preset: "blurred_background",
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  blur_background: true,
  blur_strength: 20,
  background_color: "#000000",
};

type VideoAdjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  temperature: number;
  vignette: number;
  blur: number;
};

const defaultVideoAdjustments: VideoAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpness: 0,
  temperature: 0,
  vignette: 0,
  blur: 0,
};

export function WysiwygInlineTextEditor({
  value,
  onChange,
  onBlur,
  placeholder = "Ketik teks...",
  className = "",
  style = {},
  autoFocus = true,
}: {
  value: string;
  onChange: (nextText: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isComposingRef = useRef(false);

  useLayoutEffect(() => {
    if (ref.current) {
      if (document.activeElement !== ref.current && ref.current.textContent !== value) {
        ref.current.textContent = value;
      }
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [autoFocus]);

  return (
    <span
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      data-placeholder={placeholder}
      className={`wysiwyg-text-editor ${className}`}
      style={{
        display: "inline-block",
        outline: "none",
        border: "none",
        background: "transparent",
        padding: 0,
        margin: 0,
        boxShadow: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowWrap: "break-word",
        cursor: "text",
        userSelect: "text",
        WebkitUserSelect: "text",
        minWidth: "1ch",
        ...style,
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false;
        onChange(e.currentTarget.textContent || "");
      }}
      onInput={(e) => {
        if (!isComposingRef.current) {
          onChange(e.currentTarget.textContent || "");
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
      }}
      onBlur={() => {
        if (onBlur) onBlur();
      }}
    />
  );
}

function normalizeVideoFraming(value: unknown): VideoFraming {
  const raw = value && typeof value === "object" ? (value as Partial<VideoFraming>) : {};
  const finiteOr = (candidate: unknown, fallback: number) => {
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  return {
    preset: typeof raw.preset === "string" ? raw.preset : undefined,
    x: Math.max(-40, Math.min(40, finiteOr(raw.x, defaultVideoFraming.x))),
    y: Math.max(-40, Math.min(40, finiteOr(raw.y, defaultVideoFraming.y))),
    scale: Math.max(0.5, Math.min(2.5, finiteOr(raw.scale, defaultVideoFraming.scale))),
    rotation: Math.max(-180, Math.min(180, finiteOr(raw.rotation, defaultVideoFraming.rotation || 0))),
    flip_h: Boolean(raw.flip_h),
    flip_v: Boolean(raw.flip_v),
    opacity: Math.max(0, Math.min(1, finiteOr(raw.opacity, defaultVideoFraming.opacity || 1))),
    blur_background: raw.blur_background !== undefined ? Boolean(raw.blur_background) : Boolean(defaultVideoFraming.blur_background),
    blur_strength: Math.max(1, Math.min(50, finiteOr(raw.blur_strength, defaultVideoFraming.blur_strength || 20))),
    background_color: typeof raw.background_color === "string" ? raw.background_color : "#000000",
  };
}

function normalizeVideoAdjustments(value: unknown): VideoAdjustments {
  const raw = value && typeof value === "object" ? (value as Partial<VideoAdjustments>) : {};
  const finiteOr = (candidate: unknown, fallback: number) => {
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  return {
    brightness: Math.max(-100, Math.min(100, finiteOr(raw.brightness, 0))),
    contrast: Math.max(-100, Math.min(100, finiteOr(raw.contrast, 0))),
    saturation: Math.max(-100, Math.min(100, finiteOr(raw.saturation, 0))),
    sharpness: Math.max(0, Math.min(100, finiteOr(raw.sharpness, 0))),
    temperature: Math.max(-100, Math.min(100, finiteOr(raw.temperature, 0))),
    vignette: Math.max(0, Math.min(100, finiteOr(raw.vignette, 0))),
    blur: Math.max(0, Math.min(20, finiteOr(raw.blur, 0))),
  };
}

type MediaTrim = {
  start: number;
  end: number;
};

type EditableCaptionCue = {
  id: string;
  start: number;
  end: number;
  text: string;
  locked?: boolean;
  visible?: boolean;
  type?: string;
  style_id?: string | null;
  style_override?: Record<string, unknown> | null;
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
  muted?: boolean;
  locked?: boolean;
  fade_in?: number;
  fade_out?: number;
  speed?: number;
  base_duration?: number;
  loop?: boolean;
};

type TimelineTrackKey = "text" | "overlay" | "video" | "audio" | "caption" | "hook" | "keyword" | "punch" | "pattern";
type VisualLayerTrack = "caption" | "hook" | "keyword" | "video";

const defaultTrackOrder: TimelineTrackKey[] = [
  "text",
  "overlay",
  "video",
  "audio",
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
  const canonicalOrder: TimelineTrackKey[] = ["text", "overlay", "video", "audio"];
  if (!Array.isArray(value)) return canonicalOrder;
  const mapped = value.map((t) =>
    t === "caption" || t === "hook" || t === "keyword"
      ? "text"
      : t === "punch" || t === "pattern"
      ? "overlay"
      : t
  );
  const videoIndex = mapped.indexOf("video");
  const overlayIndex = mapped.indexOf("overlay");
  if (videoIndex !== -1 && overlayIndex !== -1 && overlayIndex > videoIndex) {
    return canonicalOrder;
  }
  const unique = mapped.filter(
    (track, index): track is TimelineTrackKey =>
      canonicalOrder.includes(track as TimelineTrackKey) && mapped.indexOf(track) === index,
  );
  return [...unique, ...canonicalOrder.filter((track) => !unique.includes(track))];
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
  locked?: boolean;
  visible?: boolean;
  muted?: boolean;
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
  | "clean_sans"
  | (string & {});
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
  ...FONT_CATALOG.map((f) => ({
    value: f.id as HookTextFont,
    label: f.name,
    description: f.description || f.name,
    fontFamily: f.family,
  })),
  {
    value: "bold_sans",
    label: "Bold Sans",
    description: "Kuat untuk konten umum dan viral.",
    fontFamily: "'Anton', 'Arial Black', sans-serif",
  },
  {
    value: "elegant_serif",
    label: "Elegant Serif",
    description: "Formal, editorial, dan elegan.",
    fontFamily: "'Playfair Display', Georgia, serif",
  },
  {
    value: "modern_rounded",
    label: "Modern Rounded",
    description: "Ramah dengan bentuk huruf modern.",
    fontFamily: "'Fredoka', 'Baloo 2', sans-serif",
  },
  {
    value: "condensed_news",
    label: "Condensed News",
    description: "Padat untuk headline dan berita.",
    fontFamily: "'Oswald', 'Roboto Condensed', sans-serif",
  },
  {
    value: "playful",
    label: "Playful",
    description: "Santai untuk konten kreatif.",
    fontFamily: "'Caveat', 'Patrick Hand', cursive",
  },
  {
    value: "clean_sans",
    label: "Clean Sans",
    description: "Minimal dan mudah dibaca.",
    fontFamily: "'Inter', sans-serif",
  },
];

function normalizeHookTextTemplate(value: unknown): HookTextTemplate {
  return hookTextTemplates.some((template) => template.value === value)
    ? (value as HookTextTemplate)
    : "capcut_clean";
}

function normalizeHookTextFont(value: unknown): HookTextFont {
  if (typeof value !== "string" || !value) return "inter";
  const found = hookTextFonts.find((font) => font.value === value || font.fontFamily === value);
  if (found) return found.value;
  const match = getFontById(value) || getFontByFamily(value);
  if (match) return match.id;
  return value;
}

const defaultAudioSettings: AudioSettings = {
  volume: 1,
  muted: false,
  fade_in: 0,
  fade_out: 0,
  speed: 1,
};

function normalizeAudioSettings(value: Partial<AudioSettings> | undefined): AudioSettings {
  return {
    volume: Math.max(0, Math.min(2, Number(value?.volume ?? defaultAudioSettings.volume))),
    muted: Boolean(value?.muted ?? defaultAudioSettings.muted),
    fade_in: Math.max(0, Math.min(10, Number(value?.fade_in ?? defaultAudioSettings.fade_in))),
    fade_out: Math.max(0, Math.min(10, Number(value?.fade_out ?? defaultAudioSettings.fade_out))),
    speed: Math.max(0.5, Math.min(2, Number(value?.speed ?? defaultAudioSettings.speed ?? 1))),
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
  return `${Math.min(100, Math.max(0, (start / Math.max(0.1, duration)) * 100))}%`;
}

function eventWidth(start: number, end: number, duration: number) {
  return `${Math.max(0.7, Math.min(100, ((end - start) / Math.max(0.1, duration)) * 100))}%`;
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

function activeCaptionCue<T extends { id?: string; start: number; end: number; text: string }>(
  cues: T[],
  currentTime: number,
): T | undefined {
  const boundaryTolerance = 0.04;
  return cues.reduce<T | undefined>((active, cue) => {
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

function chunkWordsBalanced<T>(items: T[], minWords = 3, maxWords = 6): T[][] {
  const n = items.length;
  if (n === 0) return [];
  if (n <= maxWords) return [items];
  let c = Math.ceil(n / maxWords);
  while (c > 1 && Math.floor(n / c) < minWords) {
    c--;
  }
  const b = Math.floor(n / c);
  const r = n % c;
  const chunks: T[][] = [];
  let offset = 0;
  for (let i = 0; i < c; i++) {
    const size = i < r ? b + 1 : b;
    chunks.push(items.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function reflowCaptionCue(
  cue: EditableCaptionCue,
  usedIds: Set<string>,
  maxWords = 6,
) {
  const words = captionWords(cue.text);
  if (words.length <= maxWords) {
    usedIds.add(cue.id);
    return [{ ...cue }];
  }

  const chunks = chunkWordsBalanced(words, 3, maxWords);
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

function SourceNavTabStrip({
  tabs,
  activeTab,
  onSelectTab,
}: {
  tabs: Array<{ id: EditorNavTab; label: string; icon: string }>;
  activeTab: EditorNavTab;
  onSelectTab: (tab: EditorNavTab) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, tabs]);

  const scrollBy = (offset: number) => {
    containerRef.current?.scrollBy({ left: offset, behavior: "smooth" });
  };

  return (
    <div className="relative flex h-full min-w-0 items-center overflow-hidden border-r border-zinc-800/40 px-1 xl:border-r-0">
      {/* Left Arrow Button */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollBy(-120)}
          aria-label="Scroll tab ke kiri"
          title="Scroll tab ke kiri"
          className="absolute left-0.5 z-10 flex h-7 w-6 sm:w-7 items-center justify-center rounded-md border border-zinc-700/80 bg-[#1e2126] text-sm sm:text-base font-black text-zinc-200 shadow-md transition hover:border-cyan-400 hover:bg-[#282c34] hover:text-cyan-300 active:scale-95"
        >
          ‹
        </button>
      )}

      {/* Tabs Viewport */}
      <div
        ref={containerRef}
        className="flex items-center gap-1 overflow-x-auto no-scrollbar scroll-smooth py-0.5 px-0.5"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-[#22252b] text-cyan-300 shadow-sm ring-1 ring-cyan-500/40 font-black"
                : "text-zinc-400 hover:bg-[#1c1f24] hover:text-zinc-200"
            }`}
          >
            <span className="text-xs opacity-90">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Right Arrow Button */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollBy(120)}
          aria-label="Scroll tab ke kanan"
          title="Scroll tab ke kanan"
          className="absolute right-0.5 z-10 flex h-7 w-6 sm:w-7 items-center justify-center rounded-md border border-zinc-700/80 bg-[#1e2126] text-sm sm:text-base font-black text-zinc-200 shadow-md transition hover:border-cyan-400 hover:bg-[#282c34] hover:text-cyan-300 active:scale-95"
        >
          ›
        </button>
      )}
    </div>
  );
}

function ToolSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-700/80 bg-[#22252a] p-2.5 shadow-sm shadow-black/20">
      <h3 className="text-[11px] font-black uppercase tracking-[0.1em] text-zinc-400">
        {title}
      </h3>
      <div className="mt-2 space-y-2">{children}</div>
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
  laneId,
  trackKey = "text",
  locked = false,
  onToggleLock,
  visible = true,
  onToggleVisibility,
  muted = false,
  onToggleMute,
  muteDisabled = false,
  muteTooltip,
  label = "Track",
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
  onSelectLane,
  onOpenLaneMenu,
  isLaneSelected = false,
  resizable = false,
  selectedItemId,
  selected = false,
  emptyText = "Tidak ada event",
  order,
  transitions,
  onTransitionClick,
}: {
  laneId?: string;
  trackKey?: "text" | "overlay" | "video" | "audio";
  locked?: boolean;
  onToggleLock?: () => void;
  visible?: boolean;
  onToggleVisibility?: () => void;
  muted?: boolean;
  onToggleMute?: () => void;
  muteDisabled?: boolean;
  muteTooltip?: string;
  label?: string;
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
  onSelectLane?: () => void;
  onOpenLaneMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  isLaneSelected?: boolean;
  resizable?: boolean;
  selectedItemId?: string | null;
  selected?: boolean;
  emptyText?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  order?: number;
  transitions?: Array<{
    id: string;
    eventId: string;
    time: number;
    duration: number;
    name: string;
    effect: string;
    active: boolean;
    selected: boolean;
    beforeNumber: number;
    afterNumber: number;
  }>;
  onTransitionClick?: (eventId: string) => void;
}) {
  const isText = trackKey === "text";
  const isOverlay = trackKey === "overlay";
  const isVideo = trackKey === "video";
  const isAudio = trackKey === "audio";

  return (
    <div
      className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-2"
      data-lane-id={laneId}
      style={typeof order === "number" ? { order } : undefined}
    >
      {/* COMPACT ICON-ONLY LANE HEADER */}
      <div
        className={`flex items-center gap-1 px-1 py-0.5 rounded-lg select-none cursor-pointer transition ${
          isLaneSelected || selected
            ? "bg-cyan-950/40 border border-cyan-800/40 ring-1 ring-cyan-400/30"
            : "bg-transparent border border-transparent hover:bg-zinc-800/40"
        }`}
        onClick={() => onSelectLane?.()}
      >
        {/* 1. Category Icon Badge */}
        {isText && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 shadow-sm"
            title={`${label} (Klik untuk pilih track)`}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
          </span>
        )}
        {isOverlay && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded bg-fuchsia-950/80 border border-fuchsia-800/60 text-fuchsia-300 shadow-sm"
            title={`${label} (Klik untuk pilih track)`}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </span>
        )}
        {isVideo && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded bg-blue-950/80 border border-blue-800/60 text-blue-300 shadow-sm"
            title={`${label} (Klik untuk pilih track)`}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </span>
        )}
        {isAudio && (
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 shadow-sm"
            title={`${label} (Klik untuk pilih track)`}
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </span>
        )}

        {/* 2. Lock / Unlock Toggle Button */}
        <button
          type="button"
          aria-label={locked ? "Buka kunci track" : "Kunci track"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleLock?.();
          }}
          title={locked ? "Buka kunci track" : "Kunci track"}
          className={`flex size-6 shrink-0 items-center justify-center rounded transition ${
            locked
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          }`}
        >
          {locked ? (
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          )}
        </button>

        {/* 3. Show / Hide (Eye) Toggle Button (Text, Overlay, Video) */}
        {!isAudio && (
          <button
            type="button"
            aria-label={visible !== false ? "Sembunyikan track" : "Tampilkan track"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleVisibility?.();
            }}
            title={visible !== false ? "Sembunyikan track" : "Tampilkan track"}
            className={`flex size-6 shrink-0 items-center justify-center rounded transition ${
              visible === false
                ? "bg-zinc-800 text-zinc-500 border border-zinc-700"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {visible === false ? (
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}

        {/* 4. Speaker / Mute Toggle Button (Video, Audio) */}
        {(isVideo || isAudio) && (
          <button
            type="button"
            disabled={muteDisabled}
            aria-label={
              muteDisabled
                ? (muteTooltip || "Audio sudah dipisah ke track AUDIO")
                : muted
                ? "Aktifkan suara track"
                : "Mute track"
            }
            onClick={(event) => {
              event.stopPropagation();
              if (!muteDisabled) onToggleMute?.();
            }}
            title={
              muteDisabled
                ? (muteTooltip || "Audio sudah dipisah ke track AUDIO")
                : muted
                ? "Aktifkan suara track"
                : "Mute track"
            }
            className={`flex size-6 shrink-0 items-center justify-center rounded transition ${
              muteDisabled
                ? "opacity-25 cursor-not-allowed text-zinc-600"
                : muted
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {muted ? (
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
        )}

        {/* 5. Track Level Actions Menu (...) Button */}
        <button
          type="button"
          aria-label="Menu opsi track"
          onClick={(event) => {
            event.stopPropagation();
            onOpenLaneMenu?.(event);
          }}
          title="Opsi & Hapus isi track"
          className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-cyan-300 transition"
        >
          <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </button>
      </div>

      {/* TRACK LANE BODY */}
      <div
        className={`relative h-8 touch-none overflow-hidden rounded-md border bg-[#22252a] ${
          selected ? "border-cyan-400 ring-1 ring-cyan-400/40" : "border-zinc-700"
        } ${visible === false ? "opacity-40 border-dashed" : ""}`}
        onPointerCancel={locked ? undefined : onPointerCancel}
        onPointerDown={locked ? undefined : onPointerDown}
        onPointerLeave={locked ? undefined : onPointerLeave}
        onPointerMove={locked ? undefined : onPointerMove}
        onPointerUp={locked ? undefined : onPointerUp}
      >
        {typeof playheadPercent === "number" && (
          <span
            className="timeline-playhead-line absolute bottom-0 top-0 z-10 w-px bg-white/80"
            style={{ left: `${playheadPercent}%` }}
          />
        )}
        {items.length ? (
          items.map((item) => {
            const isItemLocked = locked || Boolean(item.locked);
            const isItemVisible = (visible !== false) && (item.visible !== false);
            return (
              <div
                key={item.id}
                className={`absolute top-1/2 h-4 -translate-y-1/2 rounded-md px-2 text-[10px] font-black leading-4 shadow-sm ${
                  item.id === selectedItemId || item.eventId === selectedItemId
                    ? "z-20 ring-2 ring-cyan-300 ring-offset-1 ring-offset-[#22252a]"
                    : item.active
                      ? "ring-1 ring-white ring-offset-1 ring-offset-[#22252a]"
                      : ""
                } ${
                  isItemLocked
                    ? "cursor-not-allowed border border-dashed border-amber-300/40 opacity-75"
                    : item.editable
                    ? "cursor-move"
                    : item.selectable
                    ? "cursor-pointer"
                    : ""
                } ${
                  !isItemVisible ? "opacity-35 border-dashed" : ""
                } ${item.colorClass}`}
                style={{
                  left: eventLeft(item.start, duration),
                  width: eventWidth(item.start, item.end, duration),
                  minWidth: "14px",
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
                  if (event.button !== 0 || isItemLocked) {
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
                  if (!item.editable || isItemLocked) return;
                  event.stopPropagation();
                  onItemPointerMove?.(event, item);
                }}
                onPointerUp={(event) => {
                  if (!item.editable || isItemLocked) return;
                  event.stopPropagation();
                  onItemPointerUp?.(event, item);
                }}
                title={isItemLocked ? `${item.title || item.label} [Terkunci]` : item.title}
              >
                <span className="flex items-center gap-1 truncate">
                  {isItemLocked && <span className="text-[9px] opacity-80 shrink-0">🔒</span>}
                  <span className="truncate">{item.label}</span>
                </span>
                {resizable && !isItemLocked && (item.id === selectedItemId || item.eventId === selectedItemId) && (
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
            );
          })
        ) : (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-600">
            {emptyText}
          </span>
        )}
        {transitions && transitions.length > 0 && (
          transitions.map((trans) => {
            const leftPercent = (trans.time / duration) * 100;
            return (
              <div
                key={trans.id}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-30 flex h-5 w-5 items-center justify-center rounded border transition-all duration-150 cursor-pointer shadow-md select-none ${
                  trans.selected
                    ? "bg-cyan-400 text-slate-950 border-white ring-2 ring-cyan-300 ring-offset-1 ring-offset-[#181a1e] scale-110 shadow-cyan-500/50"
                    : trans.active
                    ? "bg-indigo-500 text-white border-white ring-2 ring-white animate-pulse scale-110"
                    : "bg-[#181a1e] text-cyan-300 border-cyan-400/90 hover:bg-cyan-500/20 hover:scale-110 hover:border-cyan-300"
                }`}
                style={{
                  left: `${leftPercent}%`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTransitionClick?.(trans.eventId);
                }}
                title={`Transisi: ${trans.name}\nDi antara Klip ${trans.beforeNumber} dan Klip ${trans.afterNumber}\nKlik untuk mengatur transisi`}
              >
                <span className="text-[11px] font-black leading-none">⇄</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PresetVideo({
  src,
  preset,
  framing = defaultVideoFraming,
  adjustments = defaultVideoAdjustments,
  speed = 1.0,
  controls = false,
  audioMuted = false,
  audioVolume = 1,
  className = "",
  videoRef,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onLoadedMetadata,
  onCanPlay,
  onSeeked,
  onError,
}: {
  src: string;
  preset: "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture" | "clean_podcast" | RenderPreset | string;
  framing?: VideoFraming;
  adjustments?: VideoAdjustments;
  speed?: number;
  controls?: boolean;
  audioMuted?: boolean;
  audioVolume?: number;
  className?: string;
  videoRef?: Ref<HTMLVideoElement>;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onLoadedMetadata?: (currentTime: number, element: HTMLVideoElement) => void;
  onCanPlay?: (element: HTMLVideoElement) => void;
  onSeeked?: (currentTime: number) => void;
  onError?: (element: HTMLVideoElement) => void;
}) {
  const safeFraming = normalizeVideoFraming(framing);
  const safeAdjustments = normalizeVideoAdjustments(adjustments);
  const clampedSpeed = Math.max(0.25, Math.min(4.0, Number(speed) || 1.0));
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("[preview_video_component_mount]", {
        src,
        preset,
      });
    }
    return () => {
      if (import.meta.env.DEV) {
        console.log("[preview_video_component_unmount]", {
          src,
          preset,
        });
      }
    };
  }, [src, preset]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (el.playbackRate !== clampedSpeed) {
      el.playbackRate = clampedSpeed;
    }
  }, [clampedSpeed]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, audioVolume));
    el.muted = audioMuted;
  }, [audioVolume, audioMuted]);

  // Keep background blur video in sync with foreground video
  const syncBgVideo = useCallback(() => {
    if (localVideoRef.current && bgVideoRef.current) {
      const cur = localVideoRef.current.currentTime;
      if (Math.abs(bgVideoRef.current.currentTime - cur) > 0.15) {
        bgVideoRef.current.currentTime = cur;
      }
    }
  }, []);

  const blurBgEnabled = safeFraming.blur_background || preset === "blurred_background";
  const blurPx = safeFraming.blur_strength || 20;
  const bgColor = safeFraming.background_color || "#000000";

  useEffect(() => {
    if (localVideoRef.current && bgVideoRef.current) {
      bgVideoRef.current.currentTime = localVideoRef.current.currentTime;
    }
  }, [src, blurBgEnabled]);

  const setCombinedRef = useCallback(
    (node: HTMLVideoElement | null) => {
      localVideoRef.current = node;
      if (typeof videoRef === "function") {
        videoRef(node);
      } else if (videoRef && typeof videoRef === "object") {
        (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
      }
      if (node) {
        if (node.playbackRate !== clampedSpeed) {
          node.playbackRate = clampedSpeed;
        }
        node.volume = Math.min(1, Math.max(0, audioVolume));
        node.muted = audioMuted;
        if (bgVideoRef.current) {
          bgVideoRef.current.currentTime = node.currentTime;
        }
      }
    },
    [videoRef, clampedSpeed, audioVolume, audioMuted],
  );

  // Compute CSS filter from adjustments
  const filterParts: string[] = [];
  if (safeAdjustments.brightness !== 0) {
    filterParts.push(`brightness(${1 + safeAdjustments.brightness / 100})`);
  }
  if (safeAdjustments.contrast !== 0) {
    filterParts.push(`contrast(${1 + safeAdjustments.contrast / 100})`);
  }
  if (safeAdjustments.saturation !== 0) {
    filterParts.push(`saturate(${1 + safeAdjustments.saturation / 100})`);
  }
  if (safeAdjustments.blur > 0) {
    filterParts.push(`blur(${safeAdjustments.blur}px)`);
  }
  if (safeAdjustments.temperature !== 0) {
    filterParts.push(`hue-rotate(${safeAdjustments.temperature * 0.3}deg)`);
    if (safeAdjustments.temperature > 0) {
      filterParts.push(`sepia(${safeAdjustments.temperature * 0.2}%)`);
    }
  }
  const computedFilter = filterParts.length > 0 ? filterParts.join(" ") : undefined;

  // Compute transform
  const transformList: string[] = [];
  if (safeFraming.x !== 0 || safeFraming.y !== 0) {
    transformList.push(`translate3d(${safeFraming.x}%, ${safeFraming.y}%, 0)`);
  }
  if (safeFraming.scale !== 1) {
    transformList.push(`scale(${safeFraming.scale})`);
  }
  if (safeFraming.rotation && safeFraming.rotation !== 0) {
    transformList.push(`rotate(${safeFraming.rotation}deg)`);
  }
  if (safeFraming.flip_h || safeFraming.flip_v) {
    transformList.push(`scale(${safeFraming.flip_h ? -1 : 1}, ${safeFraming.flip_v ? -1 : 1})`);
  }
  const computedTransform = transformList.length > 0 ? transformList.join(" ") : undefined;

  const cropFocusX = 50 - safeFraming.x;
  const cropFocusY = 50 - safeFraming.y;
  const centerCropFramingStyle: CSSProperties = {
    objectFit: "cover",
    objectPosition: `${cropFocusX}% ${cropFocusY}%`,
    transform: computedTransform || `scale(${safeFraming.scale})`,
    transformOrigin: `${cropFocusX}% ${cropFocusY}%`,
    opacity: safeFraming.opacity,
    filter: computedFilter,
    transition: "object-position 120ms ease-out, transform 120ms ease-out",
  };

  const podcastCropX = 50 - safeFraming.x;
  const podcastCropY = 32 - safeFraming.y;
  const cleanPodcastFramingStyle: CSSProperties = {
    objectFit: "cover",
    objectPosition: `${podcastCropX}% ${podcastCropY}%`,
    transform: computedTransform || `scale(${Math.max(1.05, safeFraming.scale)})`,
    transformOrigin: `${podcastCropX}% ${podcastCropY}%`,
    opacity: safeFraming.opacity,
    filter: computedFilter,
    transition: "object-position 120ms ease-out, transform 120ms ease-out",
  };

  const talkingHeadCropX = 50 - safeFraming.x;
  const talkingHeadCropY = 24 - safeFraming.y;
  const talkingHeadFramingStyle: CSSProperties = {
    objectFit: "cover",
    objectPosition: `${talkingHeadCropX}% ${talkingHeadCropY}%`,
    transform: computedTransform || `scale(${Math.max(1.15, safeFraming.scale)})`,
    transformOrigin: `${talkingHeadCropX}% ${talkingHeadCropY}%`,
    opacity: safeFraming.opacity,
    filter: computedFilter,
    transition: "object-position 120ms ease-out, transform 120ms ease-out",
  };

  const studioPodcastFramingStyle: CSSProperties = {
    objectFit: "contain",
    transform:
      computedTransform ||
      `translate3d(${safeFraming.x}%, ${safeFraming.y}%, 0) scale(${Math.max(1.05, safeFraming.scale)})`,
    transformOrigin: "center center",
    opacity: safeFraming.opacity,
    filter: computedFilter,
    transition: "transform 120ms ease-out",
  };

  const containedForegroundFramingStyle: CSSProperties = {
    objectFit: "contain",
    transform:
      computedTransform ||
      `translate3d(${safeFraming.x}%, ${safeFraming.y}%, 0) scale(${safeFraming.scale})`,
    transformOrigin: "center center",
    opacity: safeFraming.opacity,
    filter: computedFilter,
    transition: "transform 120ms ease-out",
  };

  const fitFramingStyle: CSSProperties = {
    objectFit: "contain",
    transform: computedTransform,
    transformOrigin: "center center",
    opacity: safeFraming.opacity,
    filter: computedFilter,
    transition: "transform 120ms ease-out",
  };

  const playbackProps = {
    onPlay: () => {
      const el = localVideoRef.current;
      if (el && el.playbackRate !== clampedSpeed) {
        el.playbackRate = clampedSpeed;
      }
      if (bgVideoRef.current) {
        bgVideoRef.current.playbackRate = clampedSpeed;
        bgVideoRef.current.currentTime = el?.currentTime || 0;
        void bgVideoRef.current.play().catch(() => {});
      }
      onPlay?.();
    },
    onPause: () => {
      if (bgVideoRef.current) {
        bgVideoRef.current.pause();
        syncBgVideo();
      }
      onPause?.();
    },
    onEnded: () => {
      if (bgVideoRef.current) {
        bgVideoRef.current.pause();
      }
      onEnded?.();
    },
    onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => {
      event.currentTarget.volume = Math.min(1, Math.max(0, audioVolume));
      event.currentTarget.playbackRate = clampedSpeed;
      if (bgVideoRef.current) {
        bgVideoRef.current.playbackRate = clampedSpeed;
        bgVideoRef.current.currentTime = event.currentTarget.currentTime;
      }
      onLoadedMetadata?.(event.currentTarget.currentTime, event.currentTarget);
    },
    onCanPlay: (event: SyntheticEvent<HTMLVideoElement>) => {
      onCanPlay?.(event.currentTarget);
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => {
      syncBgVideo();
      onTimeUpdate?.(event.currentTarget.currentTime);
    },
    onSeeked: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (bgVideoRef.current) {
        bgVideoRef.current.currentTime = event.currentTarget.currentTime;
      }
      onSeeked?.(event.currentTarget.currentTime);
    },
    onError: (event: SyntheticEvent<HTMLVideoElement>) => {
      onError?.(event.currentTarget);
    },
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${className}`}
      style={{ backgroundColor: bgColor }}
    >
      {blurBgEnabled && (
        <video
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-80"
          style={{ filter: `blur(${blurPx}px)` }}
          muted
          playsInline
          preload="auto"
          ref={bgVideoRef}
          src={src}
        />
      )}
      {preset === "center_crop" ? (
        <video
          className="h-full w-full object-cover"
          controls={controls}
          muted={!controls || audioMuted}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          ref={setCombinedRef}
          src={src}
          style={centerCropFramingStyle}
          {...playbackProps}
        />
      ) : preset === "clean_podcast" ? (
        <video
          className="h-full w-full object-cover"
          controls={controls}
          muted={!controls || audioMuted}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          ref={setCombinedRef}
          src={src}
          style={cleanPodcastFramingStyle}
          {...playbackProps}
        />
      ) : preset === "talking_head" ? (
        <video
          className="h-full w-full object-cover"
          controls={controls}
          muted={!controls || audioMuted}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          ref={setCombinedRef}
          src={src}
          style={talkingHeadFramingStyle}
          {...playbackProps}
        />
      ) : preset === "studio_podcast" ? (
        <video
          className="h-full w-full object-contain"
          controls={controls}
          muted={!controls || audioMuted}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          ref={setCombinedRef}
          src={src}
          style={studioPodcastFramingStyle}
          {...playbackProps}
        />
      ) : preset === "fit_background" ? (
        <video
          className="h-full w-full object-contain"
          controls={controls}
          muted={!controls || audioMuted}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          ref={setCombinedRef}
          src={src}
          style={fitFramingStyle}
          {...playbackProps}
        />
      ) : (
        <video
          className={
            preset === "picture_in_picture"
              ? "absolute bottom-4 left-1/2 h-[46%] w-[82%] -translate-x-1/2 rounded-xl border-2 border-white/80 bg-black object-contain shadow-2xl"
              : "relative h-full w-full object-contain"
          }
          controls={controls}
          muted={!controls || audioMuted}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          ref={setCombinedRef}
          src={src}
          style={containedForegroundFramingStyle}
          {...playbackProps}
        />
      )}
      {safeAdjustments.vignette > 0 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle, transparent 40%, rgba(0,0,0,${
              safeAdjustments.vignette / 100
            }) 100%)`,
          }}
        />
      )}
    </div>
  );
}

type VideoFramingPresetDefinition = {
  id: string;
  label: string;
  subLabel: string;
  desc: string;
  renderPreset: RenderPreset;
  clipperStylePreset?: string;
  blurBackground?: boolean;
};

const videoFramingPresets: VideoFramingPresetDefinition[] = [
  {
    id: "blurred_background",
    label: "Latar Buram",
    subLabel: "Fit + Blur BG",
    desc: "Video landscape di tengah dengan latar blur vertikal",
    renderPreset: "blurred_background",
    clipperStylePreset: "blurred_background",
    blurBackground: true,
  },
  {
    id: "center_crop",
    label: "Potong Tengah",
    subLabel: "Fill 9:16 Crop",
    desc: "Center crop fokus subjek utama memenuhi layar",
    renderPreset: "center_crop",
    clipperStylePreset: "center_crop",
    blurBackground: false,
  },
  {
    id: "fit_background",
    label: "Video Penuh",
    subLabel: "Fit Letterbox",
    desc: "Seluruh frame terlihat dengan letterbox atas-bawah",
    renderPreset: "fit_background",
    clipperStylePreset: "fit_background",
    blurBackground: false,
  },
  {
    id: "clean_podcast",
    label: "Clean Podcast",
    subLabel: "Portrait Headshot",
    desc: "Framing rapi untuk podcast portrait 9:16",
    renderPreset: "center_crop",
    clipperStylePreset: "clean_podcast",
    blurBackground: false,
  },
  {
    id: "studio_podcast",
    label: "Studio Podcast",
    subLabel: "Studio Blur BG",
    desc: "Framing studio podcast dengan background blur & video proporsional",
    renderPreset: "blurred_background",
    clipperStylePreset: "studio_podcast",
    blurBackground: true,
  },
  {
    id: "talking_head",
    label: "Talking Head",
    subLabel: "Presenter Focus",
    desc: "Fokus portrait presenter / creator di area atas kanvas",
    renderPreset: "center_crop",
    clipperStylePreset: "talking_head",
    blurBackground: false,
  },
  {
    id: "picture_in_picture",
    label: "Picture in Picture",
    subLabel: "Inset Video (PiP)",
    desc: "Video inset kecil di atas latar canvas",
    renderPreset: "picture_in_picture",
    clipperStylePreset: "picture_in_picture",
    blurBackground: false,
  },
];

function FramingThumbnailPreview({ presetId }: { presetId: string }) {
  if (presetId === "blurred_background") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center">
        {/* Blurred background representation */}
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-900/70 via-indigo-900/60 to-blue-800/70 blur-[3px] scale-125 opacity-80" />
        {/* Centered horizontal letterbox video bar */}
        <div className="relative z-10 w-[92%] h-[38%] rounded-[2px] bg-gradient-to-r from-blue-500 to-indigo-500 border border-white/50 shadow flex items-center justify-center">
          <span className="text-[7px] font-black text-white/90 leading-none">16:9</span>
        </div>
      </div>
    );
  }

  if (presetId === "center_crop") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-gradient-to-b from-blue-600 via-indigo-600 to-cyan-600 border border-zinc-700/60 shadow-inner flex items-center justify-center">
        {/* Full 9:16 fill with center crop guide */}
        <div className="w-[82%] h-[88%] rounded-[2px] border border-dashed border-white/70 bg-white/10 flex flex-col items-center justify-center">
          <div className="size-3 rounded-full bg-white/40 mb-0.5" />
          <div className="w-4 h-1.5 rounded-t-full bg-white/40" />
        </div>
      </div>
    );
  }

  if (presetId === "fit_background") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-black border border-zinc-700/60 shadow-inner flex flex-col justify-between py-1 items-center">
        {/* Dark letterbox top band */}
        <div className="w-full h-1.5 bg-zinc-900/80" />
        {/* Centered horizontal video */}
        <div className="w-[92%] h-[40%] rounded-[2px] bg-blue-600 border border-zinc-500 shadow flex items-center justify-center">
          <span className="text-[6px] font-black text-white/90 leading-none">FIT</span>
        </div>
        {/* Dark letterbox bottom band */}
        <div className="w-full h-1.5 bg-zinc-900/80" />
      </div>
    );
  }

  if (presetId === "clean_podcast") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-zinc-900 border border-zinc-700/60 shadow-inner flex items-center justify-center">
        {/* Clean podcast safe area + portrait silhouette */}
        <div className="w-[84%] h-[88%] rounded-[3px] border border-cyan-500/40 bg-cyan-950/20 flex flex-col items-center justify-center p-0.5">
          <div className="size-3.5 rounded-full bg-cyan-400/60 mb-0.5" />
          <div className="w-5 h-2 rounded-t-full bg-cyan-400/50" />
          <div className="mt-0.5 w-5 h-1 rounded bg-amber-400/70" />
        </div>
      </div>
    );
  }

  if (presetId === "studio_podcast") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center">
        {/* Studio blur gradient */}
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-950 via-slate-900 to-indigo-950 blur-[2px] scale-125 opacity-90" />
        {/* Centered studio box with mic icon */}
        <div className="relative z-10 w-[88%] h-[50%] rounded-[2px] bg-zinc-900/90 border border-cyan-500/50 shadow flex flex-col items-center justify-center">
          <span className="text-[9px] leading-none mb-0.5">🎙️</span>
          <span className="text-[5.5px] font-black text-cyan-300 leading-none">STUDIO</span>
        </div>
      </div>
    );
  }

  if (presetId === "talking_head") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-gradient-to-b from-slate-900 via-indigo-950 to-zinc-950 border border-zinc-700/60 shadow-inner flex flex-col items-center pt-1.5">
        {/* Upper presenter portrait focus */}
        <div className="w-[78%] h-[65%] rounded-[3px] border border-cyan-400/80 bg-cyan-900/30 flex flex-col items-center justify-center shadow-sm">
          <div className="size-3.5 rounded-full bg-cyan-400/80 mb-0.5 ring-1 ring-cyan-300/40" />
          <div className="w-5 h-2 rounded-t-full bg-cyan-400/70" />
        </div>
        <div className="mt-1 w-6 h-1 rounded bg-zinc-700/60" />
      </div>
    );
  }

  if (presetId === "picture_in_picture") {
    return (
      <div className="relative aspect-[9/16] h-[68px] w-[38px] shrink-0 overflow-hidden rounded bg-zinc-950 border border-zinc-700/60 shadow-inner p-0.5 flex flex-col justify-between">
        {/* Main background canvas */}
        <div className="w-full h-[40%] rounded-[2px] bg-zinc-800/70 border border-zinc-700/50" />
        {/* Small Inset Video (PiP) */}
        <div className="w-[84%] mx-auto h-[44%] rounded-[2px] bg-blue-600 border border-white/90 shadow-md flex items-center justify-center">
          <span className="text-[6px] font-black text-white leading-none">PiP</span>
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-[9/16] h-[68px] w-[38px] shrink-0 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs text-zinc-400">
      📱
    </div>
  );
}

function TransitionThumbnailPreview({
  transitionId,
  isDemoing,
}: {
  transitionId: string;
  isDemoing?: boolean;
}) {
  const animClass = isDemoing ? "animate-pulse scale-105" : "";

  if (transitionId === "tr-cut") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-y-0 left-0 w-1/2 bg-blue-600/70 flex items-center justify-center">
          <span className="text-[9px] font-black text-white/80">A</span>
        </div>
        <div className="absolute inset-y-0 right-0 w-1/2 bg-purple-600/70 flex items-center justify-center">
          <span className="text-[9px] font-black text-white/80">B</span>
        </div>
        <div className="relative z-10 h-full w-[2px] bg-white shadow flex items-center justify-center">
          <span className="text-[10px] bg-zinc-900 rounded-full px-0.5 border border-white/60">✂️</span>
        </div>
      </div>
    );
  }

  if (transitionId === "tr-fade") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-black border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-gradient-to-r from-blue-700/40 via-black to-indigo-700/40" />
        <div className="relative z-10 size-8 rounded-full bg-black/90 border border-zinc-700/80 flex items-center justify-center shadow-lg">
          <div className="size-4 rounded-full bg-black border border-zinc-600" />
        </div>
      </div>
    );
  }

  if (transitionId === "tr-fade-white") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-indigo-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/60 via-white/80 to-purple-900/60" />
        <div className="relative z-10 size-8 rounded-full bg-white/90 shadow-xl flex items-center justify-center">
          <div className="size-3 rounded-full bg-white ring-2 ring-white/60" />
        </div>
      </div>
    );
  }

  if (transitionId === "tr-cross") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute left-2 size-9 rounded bg-cyan-500/60 border border-cyan-300/60 flex items-center justify-center text-[8px] font-black text-white">
          A
        </div>
        <div className="absolute right-2 size-9 rounded bg-fuchsia-500/60 border border-fuchsia-300/60 flex items-center justify-center text-[8px] font-black text-white">
          B
        </div>
        <div className="relative z-10 text-[11px] font-black text-white bg-black/50 px-1 py-0.5 rounded border border-white/20">
          🔀
        </div>
      </div>
    );
  }

  if (transitionId === "tr-flash") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-radial from-white via-cyan-400/40 to-transparent" />
        <div className="relative z-10 flex size-9 items-center justify-center rounded-full bg-white/90 shadow-[0_0_15px_rgba(255,255,255,0.9)]">
          <span className="text-sm">⚡</span>
        </div>
      </div>
    );
  }

  if (transitionId === "tr-slide-l") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-between px-2 ${animClass}`}>
        <div className="h-9 w-9 rounded bg-blue-600/80 border border-blue-400/60 flex items-center justify-center text-[8px] font-bold text-white shadow">
          A
        </div>
        <div className="flex items-center text-cyan-400 font-black text-sm animate-pulse">
          ⬅️
        </div>
        <div className="h-9 w-9 rounded bg-indigo-600/80 border border-indigo-400/60 flex items-center justify-center text-[8px] font-bold text-white shadow">
          B
        </div>
      </div>
    );
  }

  if (transitionId === "tr-slide-r") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-between px-2 ${animClass}`}>
        <div className="h-9 w-9 rounded bg-indigo-600/80 border border-indigo-400/60 flex items-center justify-center text-[8px] font-bold text-white shadow">
          A
        </div>
        <div className="flex items-center text-cyan-400 font-black text-sm animate-pulse">
          ➡️
        </div>
        <div className="h-9 w-9 rounded bg-blue-600/80 border border-blue-400/60 flex items-center justify-center text-[8px] font-bold text-white shadow">
          B
        </div>
      </div>
    );
  }

  if (transitionId === "tr-slide-u") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex flex-col items-center justify-between py-1 ${animClass}`}>
        <div className="h-4 w-16 rounded bg-blue-600/80 border border-blue-400/60 flex items-center justify-center text-[7px] font-bold text-white">
          A
        </div>
        <div className="text-cyan-400 font-black text-xs">⬆️</div>
        <div className="h-4 w-16 rounded bg-purple-600/80 border border-purple-400/60 flex items-center justify-center text-[7px] font-bold text-white">
          B
        </div>
      </div>
    );
  }

  if (transitionId === "tr-slide-d") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex flex-col items-center justify-between py-1 ${animClass}`}>
        <div className="h-4 w-16 rounded bg-purple-600/80 border border-purple-400/60 flex items-center justify-center text-[7px] font-bold text-white">
          A
        </div>
        <div className="text-cyan-400 font-black text-xs">⬇️</div>
        <div className="h-4 w-16 rounded bg-blue-600/80 border border-blue-400/60 flex items-center justify-center text-[7px] font-bold text-white">
          B
        </div>
      </div>
    );
  }

  if (transitionId === "tr-zoom-in") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute size-12 rounded border border-dashed border-cyan-500/40" />
        <div className="absolute size-8 rounded border border-dashed border-cyan-400/70 bg-cyan-950/30" />
        <div className="relative z-10 size-4 rounded bg-cyan-400 shadow flex items-center justify-center text-[7px] font-black text-black">
          +
        </div>
      </div>
    );
  }

  if (transitionId === "tr-zoom-out") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute size-4 rounded bg-indigo-500/60 border border-indigo-400/70" />
        <div className="relative z-10 size-10 rounded border border-dashed border-indigo-300/80 flex items-center justify-center text-[8px] font-black text-indigo-300">
          -
        </div>
      </div>
    );
  }

  if (transitionId === "tr-cross-zoom") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-radial from-cyan-500/50 via-purple-600/30 to-transparent blur-[2px]" />
        <div className="relative z-10 size-8 rounded-full border-2 border-dashed border-white/80 flex items-center justify-center shadow-lg">
          <span className="text-xs">🌀</span>
        </div>
      </div>
    );
  }

  if (transitionId === "tr-blur-fade") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-900 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-2 rounded bg-gradient-to-tr from-cyan-600 to-indigo-600 blur-[4px] opacity-80" />
        <div className="relative z-10 rounded-md bg-black/40 px-2 py-0.5 backdrop-blur-sm border border-white/30 text-[9px] font-bold text-white">
          🌫️ Blur
        </div>
      </div>
    );
  }

  if (transitionId === "tr-radial-blur") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute size-11 rounded-full border-2 border-dashed border-cyan-400/60 animate-spin" />
        <div className="relative z-10 size-6 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-500 flex items-center justify-center text-[9px]">
          💫
        </div>
      </div>
    );
  }

  if (transitionId === "tr-glitch") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-black border border-zinc-700/60 shadow-inner flex flex-col justify-center gap-0.5 px-2 ${animClass}`}>
        <div className="h-2 w-full bg-cyan-400/80 -translate-x-1 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
        <div className="h-3 w-full bg-fuchsia-500/80 translate-x-1 flex items-center justify-center text-[7px] font-mono font-black text-black">
          GLITCH
        </div>
        <div className="h-1.5 w-full bg-amber-400/80 -translate-x-0.5" />
      </div>
    );
  }

  if (transitionId === "tr-scanline") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex flex-col justify-between py-1 px-1.5 ${animClass}`}>
        <div className="h-0.5 w-full bg-cyan-400/40" />
        <div className="h-0.5 w-full bg-cyan-400/70" />
        <div className="text-center font-mono text-[8px] font-bold text-cyan-300">
          📺 CRT SCAN
        </div>
        <div className="h-0.5 w-full bg-cyan-400/70" />
        <div className="h-0.5 w-full bg-cyan-400/40" />
      </div>
    );
  }

  if (transitionId === "tr-wipe-l") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center ${animClass}`}>
        <div className="h-full w-3/5 bg-gradient-to-r from-blue-700 to-cyan-500 flex items-center justify-center text-[8px] font-bold text-white shadow-md">
          WIPE
        </div>
        <div className="h-full w-2/5 bg-zinc-900" />
      </div>
    );
  }

  if (transitionId === "tr-clock-wipe") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="size-10 rounded-full bg-gradient-to-tr from-cyan-500 via-indigo-600 to-zinc-900 border border-white/40 flex items-center justify-center">
          <div className="size-1 rounded-full bg-white shadow" />
          <div className="absolute h-4 w-0.5 bg-white origin-bottom -translate-y-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-16 w-full rounded-md bg-zinc-900 border border-zinc-700 flex items-center justify-center text-xs text-zinc-400">
      🎞️
    </div>
  );
}

function EffectThumbnailPreview({
  effectId,
  isDemoing,
}: {
  effectId: string;
  isDemoing?: boolean;
}) {
  const animClass = isDemoing ? "animate-pulse scale-105" : "";

  if (effectId === "ef-punch") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute size-11 rounded-full border border-dashed border-cyan-400/80 bg-cyan-950/30 flex items-center justify-center">
          <div className="size-5 rounded-full bg-cyan-400/50" />
        </div>
        <div className="relative z-10 rounded bg-cyan-500 px-1 py-0.2 text-[7px] font-black text-black shadow">
          1.25x
        </div>
      </div>
    );
  }

  if (effectId === "ef-quick-zoom") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner p-1.5 flex flex-col justify-between ${animClass}`}>
        <div className="flex justify-between text-cyan-400 font-mono text-[8px] leading-none">
          <span>⌜</span>
          <span>⌝</span>
        </div>
        <div className="mx-auto size-7 rounded bg-blue-600/70 border border-cyan-400/70 flex items-center justify-center text-[8px] font-black text-white shadow">
          🔍
        </div>
        <div className="flex justify-between text-cyan-400 font-mono text-[8px] leading-none">
          <span>⌞</span>
          <span>⌟</span>
        </div>
      </div>
    );
  }

  if (effectId === "ef-pattern") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center gap-1.5 ${animClass}`}>
        <div className="h-10 w-2.5 -skew-x-12 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
        <div className="h-10 w-2.5 -skew-x-12 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
        <div className="h-10 w-2.5 -skew-x-12 bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.6)]" />
      </div>
    );
  }

  if (effectId === "ef-flash") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-radial from-white via-amber-300/40 to-transparent" />
        <div className="relative z-10 size-8 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,1)] flex items-center justify-center">
          <span className="text-xs">✨</span>
        </div>
      </div>
    );
  }

  if (effectId === "ef-light-leak") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute -top-3 -right-3 size-14 rounded-full bg-gradient-to-br from-amber-400 via-rose-500 to-transparent blur-[4px] opacity-90" />
        <div className="absolute -bottom-3 -left-3 size-12 rounded-full bg-gradient-to-tr from-cyan-400 to-transparent blur-[4px] opacity-70" />
        <div className="relative z-10 rounded bg-black/40 px-1.5 py-0.5 border border-white/20 text-[8px] font-bold text-amber-200">
          💡 Flare
        </div>
      </div>
    );
  }

  if (effectId === "ef-shake") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute size-9 rounded border border-rose-500/80 -translate-x-1.5 -translate-y-0.5 opacity-70" />
        <div className="absolute size-9 rounded border border-cyan-400/80 translate-x-1.5 translate-y-0.5 opacity-70" />
        <div className="relative z-10 size-9 rounded border border-white/90 bg-zinc-800/80 flex items-center justify-center text-xs shadow-md">
          📳
        </div>
      </div>
    );
  }

  if (effectId === "ef-earthquake") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex flex-col items-center justify-center ${animClass}`}>
        <div className="text-[9px] font-black text-rose-400 tracking-wider">
          ⚡ RUMBLE ⚡
        </div>
        <div className="mt-0.5 flex gap-1 items-center">
          <span className="text-xs">🌋</span>
          <div className="h-1.5 w-10 rounded bg-gradient-to-r from-rose-500 via-amber-400 to-rose-500 animate-pulse" />
        </div>
      </div>
    );
  }

  if (effectId === "ef-blur-pulse") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-900 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-1 rounded bg-gradient-to-tr from-cyan-600 via-indigo-600 to-purple-600 blur-[5px] opacity-80" />
        <div className="relative z-10 size-6 rounded-full bg-cyan-300/80 border border-white shadow flex items-center justify-center text-[8px]">
          🌫️
        </div>
      </div>
    );
  }

  if (effectId === "ef-soft-glow") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-slate-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-gradient-to-tr from-rose-950/60 via-purple-900/50 to-cyan-950/60 blur-[3px]" />
        <div className="relative z-10 size-7 rounded-full bg-rose-400/70 border border-white/60 shadow-[0_0_12px_rgba(251,113,133,0.8)] flex items-center justify-center text-[9px]">
          🌸
        </div>
      </div>
    );
  }

  if (effectId === "ef-glitch-pop") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-black border border-zinc-700/60 shadow-inner flex flex-col justify-center gap-0.5 px-2 ${animClass}`}>
        <div className="h-2 w-4/5 bg-cyan-400/90 shadow-[0_0_6px_rgba(34,211,238,0.8)] translate-x-2" />
        <div className="h-3 w-full bg-fuchsia-600/90 -translate-x-1 flex items-center justify-center text-[7px] font-mono font-black text-white">
          POP
        </div>
        <div className="h-2 w-3/5 bg-amber-400/90 translate-x-1" />
      </div>
    );
  }

  if (effectId === "ef-digital-noise") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-zinc-950 border border-zinc-700/60 shadow-inner flex flex-col items-center justify-center gap-1 p-1 ${animClass}`}>
        <div className="font-mono text-[8px] font-bold text-emerald-400 tracking-widest">
          01011001
        </div>
        <div className="h-1 w-full bg-emerald-500/40" />
        <div className="font-mono text-[7px] text-zinc-400">
          DIGITAL NOISE
        </div>
      </div>
    );
  }

  if (effectId === "ef-freeze-flash") {
    return (
      <div className={`relative h-16 w-full overflow-hidden rounded-md bg-sky-950 border border-zinc-700/60 shadow-inner flex items-center justify-center ${animClass}`}>
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-400/40 via-sky-200/50 to-white/70" />
        <div className="relative z-10 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 border border-cyan-300 text-[8px] font-bold text-cyan-200 shadow">
          <span>❄️</span>
          <span>FREEZE</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-16 w-full rounded-md bg-zinc-900 border border-zinc-700 flex items-center justify-center text-xs text-zinc-400">
      ✨
    </div>
  );
}

export function TransformationPage() {
  const { transformationId = "" } = useParams();
  const layout = useOutletContext<LayoutOutletContext>();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Transformation>();
  const [report, setReport] = useState<OriginalityReport>();
  const [render, setRender] = useState<Render>();
  const [preset, setPreset] = useState<RenderPreset>("blurred_background");
  const [spokenLanguage, setSpokenLanguage] = useState<string>("id");
  const [bilingualMode, setBilingualMode] = useState<string>("none");
  const [identifyFillerWords, setIdentifyFillerWords] = useState<boolean>(false);
  const [deleteCurrentCaptions, setDeleteCurrentCaptions] = useState<boolean>(true);
  const [autoCaptionGenerating, setAutoCaptionGenerating] = useState<boolean>(false);
  const [autoCaptionError, setAutoCaptionError] = useState<string>("");
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
  const [previewVideoError, setPreviewVideoError] = useState<{
    source: string;
    assetId?: string;
    segmentId?: string;
    message: string;
    code?: number;
    timestamp: number;
  } | null>(null);
  const prevLoggedVideoSourceRef = useRef<string | null>(null);
  const [timelineHover, setTimelineHover] = useState<{
    percent: number;
    time: number;
  } | null>(null);
  const [timelineZoomPercent, setTimelineZoomPercent] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem("xa_timeline_zoom_percent"));
      if (Number.isFinite(saved) && saved >= 25 && saved <= 400) {
        return Math.round(saved / 25) * 25;
      }
    } catch {
      // fallback to default 100%
    }
    return 100;
  });

  const updateTimelineZoomPercent = (value: number | ((prev: number) => number)) => {
    setTimelineZoomPercent((prev) => {
      const nextRaw = typeof value === "function" ? value(prev) : value;
      const clamped = Math.max(25, Math.min(400, Math.round(nextRaw / 25) * 25));
      try {
        window.localStorage.setItem("xa_timeline_zoom_percent", String(clamped));
      } catch {
        // ignore
      }
      return clamped;
    });
  };

  const timelineZoom = timelineZoomPercent / 100;
  const [timelineAddMenuOpen, setTimelineAddMenuOpen] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem("autoclip-timeline-height"));
    return Number.isFinite(saved) && saved >= 180 ? saved : 230;
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
  const [mediaDirectory, setMediaDirectory] = useState<"project_media" | "video" | "audio" | "images" | "import">("project_media");
  const [mediaSearch, setMediaSearch] = useState<string>("");
  const [selectedMediaAssetId, setSelectedMediaAssetId] = useState<string | null>(null);
  const [audioDirectory, setAudioDirectory] = useState<"music" | "sfx" | "yours" | "import" | "copyright">("music");
  const [textDirectory, setTextDirectory] = useState<"add_text" | "yours" | "text_effects" | "text_template" | "auto_captions" | "local_captions">("add_text");
  const [stickerDirectory, setStickerDirectory] = useState<string>("trending");
  const [transitionDirectory, setTransitionDirectory] = useState<string>("trending");
  const [effectDirectory, setEffectDirectory] = useState<string>("video_effects");
  const [captionDirectory, setCaptionDirectory] = useState<"auto_captions" | "templates" | "auto_lyrics" | "add_captions" | "local_captions">("auto_captions");

  const [textSearch, setTextSearch] = useState<string>("");
  const [audioSearch, setAudioSearch] = useState<string>("");
  const [effectSearch, setEffectSearch] = useState<string>("");
  const [stickerSearch, setStickerSearch] = useState<string>("");
  const [transitionSearch, setTransitionSearch] = useState<string>("");
  const [videoInspectorTab, setVideoInspectorTab] = useState<"video" | "adjust" | "speed" | "audio">("video");
  const [audioInspectorTab, setAudioInspectorTab] = useState<"audio" | "fade" | "speed" | "timing">("audio");
  const [textInspectorTab, setTextInspectorTab] = useState<"text" | "animation" | "tracking" | "tts">("text");
  const [captionInspectorTab, setCaptionInspectorTab] = useState<"captions" | "text" | "animation" | "tracking" | "tts">("captions");
  const [captionTextSubTab, setCaptionTextSubTab] = useState<"basic" | "templates" | "bubble" | "effects">("basic");
  const [captionAnimationSubTab, setCaptionAnimationSubTab] = useState<"in" | "out" | "loop" | "captions">("captions");
  const [captionCueSearch, setCaptionCueSearch] = useState<string>("");
  const [effectInspectorTab, setEffectInspectorTab] = useState<"effect" | "timing">("effect");
  const [activeNavTab, setActiveNavTab] = useState<EditorNavTab>("media");
  const [libraryPreviewAudioId, setLibraryPreviewAudioId] = useState<string | null>(null);
  const [previewingTransitionId, setPreviewingTransitionId] = useState<string | null>(null);
  const [previewingEffectId, setPreviewingEffectId] = useState<string | null>(null);
  const [previewDemoTransition, setPreviewDemoTransition] = useState<{
    effect: string;
    name: string;
  } | null>(null);
  const [demoTransitionProgress, setDemoTransitionProgress] = useState<number>(0);
  const [hoveredFontPreview, setHoveredFontPreview] = useState<string | null>(null);
  const [hoveredCaptionTemplate, setHoveredCaptionTemplate] = useState<CaptionTemplate | null>(null);

  const triggerTransitionDemo = (item: (typeof transitionItems)[number]) => {
    setPreviewingTransitionId(item.id);
    const effectType = item.name.toLowerCase().replace(/\s+/g, "_");
    setPreviewDemoTransition({ effect: effectType, name: item.name });
    setDemoTransitionProgress(0);

    const durationMs = 1200;
    const startTime = performance.now();

    const animFrame = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      setDemoTransitionProgress(progress);
      if (progress < 1) {
        requestAnimationFrame(animFrame);
      } else {
        setTimeout(() => {
          setPreviewDemoTransition(null);
          setPreviewingTransitionId((cur) => (cur === item.id ? null : cur));
          setDemoTransitionProgress(0);
        }, 80);
      }
    };
    requestAnimationFrame(animFrame);
  };

  const triggerEffectDemo = (item: (typeof visualEffectsList)[number]) => {
    setPreviewingEffectId(item.id);
    const effectType = (item.effectName || item.label).toLowerCase().replace(/\s+/g, "_");
    setPreviewDemoTransition({ effect: effectType, name: item.label });
    setDemoTransitionProgress(0);

    const durationMs = 1200;
    const startTime = performance.now();

    const animFrame = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      setDemoTransitionProgress(progress);
      if (progress < 1) {
        requestAnimationFrame(animFrame);
      } else {
        setTimeout(() => {
          setPreviewDemoTransition(null);
          setPreviewingEffectId((cur) => (cur === item.id ? null : cur));
          setDemoTransitionProgress(0);
        }, 80);
      }
    };
    requestAnimationFrame(animFrame);
  };
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
  const [selectedTimelineLaneId, setSelectedTimelineLaneId] = useState<string | null>(null);
  const [trackDeleteConfirm, setTrackDeleteConfirm] = useState<{
    laneId: string;
    trackKey: "text" | "overlay" | "video" | "audio";
    label: string;
    itemCount: number;
    items: TimelineItem[];
  } | null>(null);
  const [laneContextMenu, setLaneContextMenu] = useState<{
    x: number;
    y: number;
    laneId: string;
    trackKey: "text" | "overlay" | "video" | "audio";
    label: string;
    items: TimelineItem[];
    locked: boolean;
  } | null>(null);

  const requestDeleteLaneContents = (
    laneId: string,
    trackKey: "text" | "overlay" | "video" | "audio",
    label: string,
    items: TimelineItem[],
    locked: boolean,
  ) => {
    if (locked) {
      setTimelineError("Track sedang dikunci. Buka kunci sebelum menghapus.");
      setMessage("Track terkunci. Buka kunci sebelum menghapus.");
      return;
    }
    if (!items || items.length === 0) {
      setMessage("Track sudah kosong.");
      return;
    }
    setTrackDeleteConfirm({
      laneId,
      trackKey,
      label,
      itemCount: items.length,
      items,
    });
  };

  const selectAllLaneItems = (
    trackKey: "text" | "overlay" | "video" | "audio",
    items: TimelineItem[],
  ) => {
    if (items.length === 0) return;
    const firstItem = items[0];
    if (trackKey === "video") {
      setSelectedMediaSegmentId(firstItem.id);
      setSelectedEditorContext("video");
    } else if (trackKey === "audio") {
      if (firstItem.type === "audio") {
        setSelectedMediaSegmentId(firstItem.id);
        setSelectedEditorContext("audio");
      } else {
        setSelectedAdditionalAudioTrackId(firstItem.id);
        setSelectedEditorContext("audio");
      }
    } else if (trackKey === "text") {
      if (firstItem.type === "caption") {
        setSelectedCaptionId(firstItem.id);
        setSelectedEditorContext("caption");
      } else {
        setSelectedEventId(firstItem.eventId || firstItem.id);
        setSelectedEditorContext("hook");
      }
    } else if (trackKey === "overlay") {
      setSelectedEventId(firstItem.eventId || firstItem.id);
      setSelectedEditorContext("effect");
    }
  };

  const deleteTimelineLaneContents = (
    trackKey: "text" | "overlay" | "video" | "audio",
    items: TimelineItem[],
  ) => {
    recordEditorHistory(draft, `delete-track-${trackKey}`, true);
    setTimelineError("");
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);

    if (trackKey === "text") {
      const deletedCueIds = new Set(
        items.filter((i) => i.type === "caption").map((i) => i.id || i.eventId || ""),
      );
      const deletedEventIds = new Set(
        items.filter((i) => i.type !== "caption").map((i) => i.eventId || i.id || ""),
      );

      const nextCaptionCues = editableCaptionCues.filter(
        (cue) => !deletedCueIds.has(cue.id),
      );
      const nextEffectEvents = configuredEffectTimeline.filter(
        (event) => !deletedEventIds.has(event.id || ""),
      );

      if (selectedCaptionId && deletedCueIds.has(selectedCaptionId)) {
        setSelectedCaptionId(null);
      }
      if (selectedEventId && deletedEventIds.has(selectedEventId)) {
        setSelectedEventId(null);
      }

      setDraft((current) => {
        if (!current) return current;
        return {
          ...current,
          clipper_style_config: {
            ...styleDefaults.clean_podcast,
            ...(current.clipper_style_config || {}),
            caption_timeline_initialized: true,
            caption_timeline: nextCaptionCues.map((cue) => ({
              ...cue,
              style_id: cue.style_id || null,
              style_override: cue.style_override || null,
            })),
            effect_timeline: nextEffectEvents,
          },
        };
      });

      setAutosaveWakeRevision((r) => r + 1);
      setMessage(`${items.length} item pada track Text berhasil dihapus.`);
    } else if (trackKey === "overlay") {
      const deletedEventIds = new Set(
        items.map((i) => i.eventId || i.id || ""),
      );
      const nextEffectEvents = configuredEffectTimeline.filter(
        (event) => !deletedEventIds.has(event.id || ""),
      );

      if (selectedEventId && deletedEventIds.has(selectedEventId)) {
        setSelectedEventId(null);
      }

      setDraft((current) => {
        if (!current) return current;
        return {
          ...current,
          clipper_style_config: {
            ...styleDefaults.clean_podcast,
            ...(current.clipper_style_config || {}),
            effect_timeline: nextEffectEvents,
          },
        };
      });

      setAutosaveWakeRevision((r) => r + 1);
      setMessage(`${items.length} item pada track Overlay berhasil dihapus.`);
    } else if (trackKey === "video") {
      const deletedSegIds = new Set(items.map((i) => i.id));
      const nextSequence = videoSequence.filter((seg) => !deletedSegIds.has(seg.id));

      if (selectedMediaSegmentId && deletedSegIds.has(selectedMediaSegmentId)) {
        setSelectedMediaSegmentId(null);
      }

      commitMediaSequence(nextSequence, configuredEffectTimeline, "video");
      if (nextSequence.length === 0) {
        setPreviewTime(0);
      }
      setMessage("Seluruh isi track Video berhasil dihapus.");
    } else if (trackKey === "audio") {
      const deletedAudioSegIds = new Set(
        items.filter((i) => i.type === "audio").map((i) => i.id),
      );
      const deletedAdditionalIds = new Set(
        items.filter((i) => i.type === "additional_audio").map((i) => i.id),
      );

      if (deletedAudioSegIds.size > 0) {
        const nextAudioSeq = audioSequence.filter((seg) => !deletedAudioSegIds.has(seg.id));
        commitMediaSequence(nextAudioSeq, configuredEffectTimeline, "audio");
      }

      if (deletedAdditionalIds.size > 0) {
        const nextAdditional = additionalAudioTracks.filter(
          (track) => !deletedAdditionalIds.has(track.id),
        );
        updateAdditionalAudioLibrary(additionalAudioAssets, nextAdditional);
      }

      if (selectedMediaSegmentId && deletedAudioSegIds.has(selectedMediaSegmentId)) {
        setSelectedMediaSegmentId(null);
      }
      if (
        selectedAdditionalAudioTrackId &&
        deletedAdditionalIds.has(selectedAdditionalAudioTrackId)
      ) {
        setSelectedAdditionalAudioTrackId(null);
      }

      setMessage("Seluruh isi track Audio berhasil dihapus.");
    }
  };

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
  const activeAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastTriggeredSfxRef = useRef<Set<string>>(new Set());
  const previewTimeRef = useRef(0);
  const previewClockFrameRef = useRef<number | null>(null);
  const previewClockLastUpdateRef = useRef(0);
  const timelineDraggingRef = useRef(false);
  const previewPlayingRef = useRef(false);
  const prevActiveSegmentIdRef = useRef<string | null>(null);
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
  const previewCanvasContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasManipulationRef = useRef<{
    pointerId: number;
    mode: "drag" | "resize";
    handle?: "tl" | "tr" | "bl" | "br";
    targetType: "hook" | "sticker" | "keyword" | "caption";
    targetId: string;
    startX: number;
    startY: number;
    initialPosX: number;
    initialPosY: number;
    initialScale: number;
    initialFontSize?: number;
    canvasWidth: number;
    canvasHeight: number;
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
      setActiveNavTab(isManualEditorTransformation(plan.data) ? "media" : "autoclip");
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
            const zoomPercent = savedZoom <= 4 ? savedZoom * 100 : savedZoom;
            updateTimelineZoomPercent(zoomPercent);
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

  const previewVideoSpeed = Math.max(
    0.25,
    Math.min(4, Number(draft?.clipper_style_config?.video_speed || 1.0)),
  );
  const previewAudioSpeed = Math.max(
    0.5,
    Math.min(2.0, Number(draft?.clipper_style_config?.audio_settings?.speed || 1.0)),
  );
  useEffect(() => {
    if (previewVideoRef.current) {
      const clamped = Math.max(0.25, Math.min(4.0, previewVideoSpeed || 1.0));
      if (previewVideoRef.current.playbackRate !== clamped) {
        previewVideoRef.current.playbackRate = clamped;
      }
    }
  }, [previewVideoSpeed]);

  useEffect(() => {
    if (previewAudioRef.current) {
      const targetSpeed = Math.max(0.5, Math.min(2.0, previewAudioSpeed || 1.0));
      if (previewAudioRef.current.playbackRate !== targetSpeed) {
        previewAudioRef.current.playbackRate = targetSpeed;
      }
    }
  }, [previewAudioSpeed]);
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
    if (!trackContextMenu && !laneContextMenu) return;
    const closeContextMenu = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="menu"]')) return;
      setTrackContextMenu(null);
      setLaneContextMenu(null);
    };
    const closeContextMenuWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackContextMenu(null);
        setLaneContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeContextMenuWithKeyboard);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeContextMenuWithKeyboard);
    };
  }, [trackContextMenu, laneContextMenu]);
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
    const handleTimelineDeleteShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }

      if (anyTrackSelected) {
        event.preventDefault();
        deleteSelectedTrackItem();
        return;
      }

      if (selectedTimelineLaneId) {
        const allTimelineLanes: Array<{
          laneId: string;
          trackKey: "text" | "overlay" | "video" | "audio";
          label: string;
          items: TimelineItem[];
          locked: boolean;
        }> = [
          ...textLanes.map((items, idx) => ({
            laneId: `text-lane-${idx}`,
            trackKey: "text" as const,
            label: `Track Text ${idx + 1}`,
            items,
            locked: items.length > 0 && items.every((i) => Boolean(i.locked)),
          })),
          ...overlayLanes.map((items, idx) => ({
            laneId: `overlay-lane-${idx}`,
            trackKey: "overlay" as const,
            label: `Track Overlay ${idx + 1}`,
            items,
            locked: items.length > 0 && items.every((i) => Boolean(i.locked)),
          })),
          ...videoLanes.map((items, idx) => ({
            laneId: `video-lane-${idx}`,
            trackKey: "video" as const,
            label: `Track Video ${idx + 1}`,
            items,
            locked: items.length > 0 && items.every((i) => Boolean(i.locked)),
          })),
          ...audioLanes.map((items, idx) => ({
            laneId: `audio-lane-${idx}`,
            trackKey: "audio" as const,
            label: `Track Audio ${idx + 1}`,
            items,
            locked: items.length > 0 && items.every((i) => Boolean(i.locked)),
          })),
        ];

        const lane = allTimelineLanes.find((l) => l.laneId === selectedTimelineLaneId);
        if (lane) {
          event.preventDefault();
          requestDeleteLaneContents(lane.laneId, lane.trackKey, lane.label, lane.items, lane.locked);
        }
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    window.addEventListener("keydown", handleTimelineDeleteShortcut);
    return () => {
      window.removeEventListener("keydown", handleHistoryShortcut);
      window.removeEventListener("keydown", handleTimelineDeleteShortcut);
    };
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
        start: segment.start == null ? undefined : roundTime(segment.start),
        end: segment.end == null ? undefined : roundTime(segment.end),
        duration: roundTime(segment.duration ?? effectiveMediaDuration(segment)),
        speed: roundTime(segment.speed ?? 1, 1),
        asset_id: segment.asset_id || undefined,
        name: segment.name || undefined,
        source_url: segment.source_url || (segment as Record<string, unknown>).sourceUrl || undefined,
        source_path: segment.source_path || (segment as Record<string, unknown>).sourcePath || undefined,
        locked: segment.locked || undefined,
        visible: segment.visible !== undefined ? segment.visible : undefined,
        muted: segment.muted || undefined,
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
        type: cue.type || "main_caption",
        style_id: cue.style_id || null,
        style_override: cue.style_override || null,
      })),
      main_caption_style: mainCaptionStyle,
      caption_apply_to_all: captionApplyToAll,
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
        timeline_zoom: timelineZoomPercent,
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
    timelineZoomPercent,
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
  const generateAutoCaptionsMutation = useMutation({
    mutationFn: async () => {
      setAutoCaptionGenerating(true);
      setAutoCaptionError("");
      return generateEditorAutoCaptions(transformationId, {
        language: (spokenLanguage as "id" | "en" | "auto") || "id",
        delete_current_captions: deleteCurrentCaptions,
        identify_filler_words: identifyFillerWords,
        bilingual: bilingualMode,
      });
    },
    onSuccess: (res) => {
      setAutoCaptionGenerating(false);
      if (res.cues) {
        setTimelineError("");
        setEditorDirty(true);
        setTimelineDirty(true);
        console.log('[caption_chunking_audit]', {
          total_cues: res.cues.length,
          sample: res.cues.slice(0, 3).map((c) => ({
            text: c.text,
            word_count: c.text.trim().split(/\s+/).length,
            start: c.start,
            end: c.end,
          })),
        });
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
                  caption_timeline: res.cues.map((cue) => ({
                    ...cue,
                    start: Math.max(0, cue.start),
                    end: Math.max(0, cue.end),
                  })),
                },
              }
            : current,
        );
        if (res.cues.length > 0) {
          setSelectedCaptionId(res.cues[0].id);
          setSelectedEditorContext("caption");
        }
      }
      setMessage(res.message);
      setAutosaveWakeRevision((r) => r + 1);
    },
    onError: (err: unknown) => {
      setAutoCaptionGenerating(false);
      const errorMsg = err instanceof Error ? err.message : "Gagal membuat auto caption.";
      setAutoCaptionError(errorMsg);
      setMessage(`Error: ${errorMsg}`);
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
      const targetResolution = preview ? "540" : exportResolution;
      console.info("[XA AutoClip] export_ui_request", {
        transformationId,
        preview,
        preset,
        resolution: targetResolution === "540" ? "540x960" : targetResolution === "720" ? "720x1280" : "1080x1920",
        quality: exportQuality,
        force: true,
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
            resolution: targetResolution,
            quality: exportQuality,
            frame_rate: exportFrameRate === "source" ? 30 : Number(exportFrameRate),
            force: true,
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
      const expectedWidth = exportResolution === "540" ? 540 : exportResolution === "720" ? 720 : 1080;
      const matchesRequestedResolution = Math.abs((current.width || 0) - expectedWidth) < 50;
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
        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${editorSaveStatusClass}`}
        title={editorSaveStatusTitle}
      >
        {editorSaveStatusLabel}
      </span>
    );
    const actions = (
      <>
        {!toolbarManualEditorMode && (
          <Link className="btn-secondary px-2.5 py-1 text-xs font-bold" to={`/jobs/${draft.project_id}/clips`}>
            Kembali ke Klip
          </Link>
        )}
        <button
          className="btn px-2.5 py-1 text-xs font-bold"
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
            className="btn-secondary block w-full px-2.5 py-1 text-center text-xs font-bold"
            to={`/jobs/${draft.project_id}/clips`}
          >
            Kembali ke Klip
          </Link>
        )}
        <button
          className="btn w-full px-2.5 py-1 text-xs font-bold"
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
    main_caption_style: normalizeMainCaptionStyle(draft.clipper_style_config?.main_caption_style as Partial<MainCaptionStyle> | undefined),
    caption_apply_to_all: draft.clipper_style_config?.caption_apply_to_all ?? true,
  };
  const mainCaptionStyle: MainCaptionStyle = normalizeMainCaptionStyle(
    styleConfig.main_caption_style as Partial<MainCaptionStyle> | undefined,
  );
  const captionApplyToAll: boolean = styleConfig.caption_apply_to_all ?? true;

  const updateMainCaptionStyle = (changes: Partial<MainCaptionStyle>) => {
    recordEditorHistory(draft, "main-caption-style");
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);

    if (captionApplyToAll) {
      setDraft((current) => {
        if (!current) return current;
        const currentMain = normalizeMainCaptionStyle(
          current.clipper_style_config?.main_caption_style as Partial<MainCaptionStyle> | undefined,
        );
        const nextMain = normalizeMainCaptionStyle({
          ...currentMain,
          ...changes,
        });
        return {
          ...current,
          clipper_style_config: {
            ...styleDefaults.clean_podcast,
            ...(current.clipper_style_config || {}),
            main_caption_style: nextMain,
          },
        };
      });
    } else if (selectedCaptionId) {
      setDraft((current) => {
        if (!current) return current;
        const cues = Array.isArray(current.clipper_style_config?.caption_timeline)
          ? [...current.clipper_style_config.caption_timeline]
          : [];
        const nextCues = cues.map((cue) => {
          if (cue.id === selectedCaptionId) {
            const currentOverride = cue.style_override || {};
            return {
              ...cue,
              style_override: {
                ...currentOverride,
                ...changes,
              },
            };
          }
          return cue;
        });
        return {
          ...current,
          clipper_style_config: {
            ...styleDefaults.clean_podcast,
            ...(current.clipper_style_config || {}),
            caption_timeline: nextCues,
          },
        };
      });
    }
  };

  const handleTemplateHover = (tpl: CaptionTemplate) => {
    setHoveredCaptionTemplate(tpl);
    const targetId = selectedCaptionId || currentCaptionCue?.id || (editableCaptionCues[0]?.id ?? "all");
    console.debug("[caption_template_preview]", {
      template_id: tpl.id,
      template_type: tpl.template_type,
      target_caption_ids: captionApplyToAll ? "all" : [targetId],
      apply_to_all: captionApplyToAll,
      preview_time: previewTime,
    });
  };

  const handleTemplateLeave = () => {
    setHoveredCaptionTemplate(null);
  };

  const applyCaptionTemplate = (tpl: CaptionTemplate) => {
    recordEditorHistory(draft, `caption-template:${tpl.id}`);
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setHoveredCaptionTemplate(null);

    console.debug("[caption_template_apply]", {
      template_id: tpl.id,
      template_type: tpl.template_type,
      affected_caption_count: captionApplyToAll ? editableCaptionCues.length : 1,
      layout: tpl.layout,
      behavior: tpl.behavior,
      animation: tpl.animation,
    });

    setDraft((current) => {
      if (!current) return current;
      const currentMain = normalizeMainCaptionStyle(
        current.clipper_style_config?.main_caption_style as Partial<MainCaptionStyle> | undefined,
      );
      const nextMain = applyCaptionTemplateToMainStyle(currentMain, tpl);

      const cues = Array.isArray(current.clipper_style_config?.caption_timeline) && (current.clipper_style_config?.caption_timeline || []).length > 0
        ? [...current.clipper_style_config.caption_timeline]
        : [...editableCaptionCues];

      if (captionApplyToAll) {
        const nextCues = cues.map((cue) => ({
          ...cue,
          style_id: tpl.id,
          style_override: null,
        }));
        return {
          ...current,
          clipper_style_config: {
            ...styleDefaults.clean_podcast,
            ...(current.clipper_style_config || {}),
            main_caption_style: nextMain,
            caption_timeline: nextCues,
          },
        };
      } else {
        const targetId =
          selectedCaptionId ||
          currentCaptionCue?.id ||
          (cues.length > 0 ? cues[0].id : null);

        const nextCues = cues.map((cue) => {
          if (targetId && cue.id === targetId) {
            return applyCaptionTemplateToCaptionItem(cue, tpl);
          }
          return cue;
        });

        return {
          ...current,
          clipper_style_config: {
            ...styleDefaults.clean_podcast,
            ...(current.clipper_style_config || {}),
            main_caption_style: nextMain,
            caption_timeline: nextCues,
          },
        };
      }
    });

    setMessage(`Template "${tpl.name}" diterapkan.`);
  };

  const setCaptionApplyToAll = (val: boolean) => {
    recordEditorHistory(draft, "caption-apply-to-all");
    setEditorDirty(true);
    setTimelineDirty(true);
    setDraft((current) =>
      current
        ? {
            ...current,
            clipper_style_config: {
              ...styleDefaults.clean_podcast,
              ...(current.clipper_style_config || {}),
              caption_apply_to_all: val,
            },
          }
        : current,
    );
  };

  const applyCurrentStyleToAllCaptions = () => {
    recordEditorHistory(draft, "apply-style-to-all");
    setEditorDirty(true);
    setTimelineDirty(true);
    setDraft((current) => {
      if (!current) return current;
      const cues = Array.isArray(current.clipper_style_config?.caption_timeline)
        ? [...current.clipper_style_config.caption_timeline]
        : [];
      const selectedCue = cues.find((c) => c.id === selectedCaptionId);
      const activeStyle = resolveCaptionStyle(selectedCue, mainCaptionStyle, false);
      const cleanCues = cues.map((cue) => ({
        ...cue,
        style_override: null,
      }));
      return {
        ...current,
        clipper_style_config: {
          ...styleDefaults.clean_podcast,
          ...(current.clipper_style_config || {}),
          main_caption_style: activeStyle,
          caption_timeline: cleanCues,
          caption_apply_to_all: true,
        },
      };
    });
    setMessage("Style caption berhasil diterapkan ke semua cue.");
  };

  const resetCaptionStyle = () => {
    recordEditorHistory(draft, "reset-caption-style");
    setEditorDirty(true);
    setTimelineDirty(true);
    setDraft((current) => {
      if (!current) return current;
      const cues = Array.isArray(current.clipper_style_config?.caption_timeline)
        ? [...current.clipper_style_config.caption_timeline]
        : [];
      const cleanCues = cues.map((cue) => ({
        ...cue,
        style_override: null,
      }));
      return {
        ...current,
        clipper_style_config: {
          ...styleDefaults.clean_podcast,
          ...(current.clipper_style_config || {}),
          main_caption_style: { ...DEFAULT_MAIN_CAPTION_STYLE },
          caption_timeline: cleanCues,
          caption_apply_to_all: true,
        },
      };
    });
    setMessage("Style caption direset ke default.");
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
    setStyle("video_framing", nextFraming);
  };
  const effectiveFramingPreset: "blurred_background" | "center_crop" | "fit_background" | "clean_podcast" | "studio_podcast" | "talking_head" | "picture_in_picture" =
    (videoFraming.preset &&
    ["blurred_background", "center_crop", "fit_background", "clean_podcast", "studio_podcast", "talking_head", "picture_in_picture"].includes(videoFraming.preset)
      ? (videoFraming.preset as "blurred_background" | "center_crop" | "fit_background" | "clean_podcast" | "studio_podcast" | "talking_head" | "picture_in_picture")
      : undefined) ||
    (styleConfig.clipper_style_preset === "studio_podcast" ? "studio_podcast" : undefined) ||
    (styleConfig.clipper_style_preset === "talking_head" ? "talking_head" : undefined) ||
    (styleConfig.clipper_style_preset === "clean_podcast" ? "clean_podcast" : undefined) ||
    (videoFraming.blur_background ? "blurred_background" : undefined) ||
    (styleConfig.render_preset as "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture" | undefined) ||
    (preset as "blurred_background" | "center_crop" | "fit_background" | "picture_in_picture") ||
    "blurred_background";
  const isFramingPresetActive = (id: string) => {
    return effectiveFramingPreset === id;
  };
  const applyVideoFramingPreset = (presetId: string) => {
    recordEditorHistory(draft, `framing-preset-${presetId}`, true);
    setEditorDirty(true);
    setTimelineDirty(true);
    setRenderDirty(true);
    setRender(undefined);
    setExportValidatedRenderId(null);
    setExportAwaitingHd(false);

    let targetRenderPreset: RenderPreset = "blurred_background";
    let targetClipperPreset = presetId;
    let nextFramingPatch: Partial<VideoFraming> = {
      preset: presetId,
    };

    if (presetId === "blurred_background") {
      targetRenderPreset = "blurred_background";
      targetClipperPreset = "blurred_background";
      nextFramingPatch = {
        preset: "blurred_background",
        blur_background: true,
        scale: 1,
        x: 0,
        y: 0,
      };
    } else if (presetId === "center_crop") {
      targetRenderPreset = "center_crop";
      targetClipperPreset = "center_crop";
      nextFramingPatch = {
        preset: "center_crop",
        blur_background: false,
        scale: 1,
        x: 0,
        y: 0,
      };
    } else if (presetId === "fit_background") {
      targetRenderPreset = "fit_background";
      targetClipperPreset = "fit_background";
      nextFramingPatch = {
        preset: "fit_background",
        blur_background: false,
        scale: 1,
        x: 0,
        y: 0,
      };
    } else if (presetId === "clean_podcast") {
      targetRenderPreset = "center_crop";
      targetClipperPreset = "clean_podcast";
      nextFramingPatch = {
        preset: "clean_podcast",
        blur_background: false,
        scale: 1,
        x: 0,
        y: 0,
      };
    } else if (presetId === "studio_podcast") {
      targetRenderPreset = "blurred_background";
      targetClipperPreset = "studio_podcast";
      nextFramingPatch = {
        preset: "studio_podcast",
        blur_background: true,
        scale: 1.05,
        x: 0,
        y: 0,
      };
    } else if (presetId === "talking_head") {
      targetRenderPreset = "center_crop";
      targetClipperPreset = "talking_head";
      nextFramingPatch = {
        preset: "talking_head",
        blur_background: false,
        scale: 1.15,
        x: 0,
        y: 0,
      };
    } else if (presetId === "picture_in_picture") {
      targetRenderPreset = "picture_in_picture";
      targetClipperPreset = "picture_in_picture";
      nextFramingPatch = {
        preset: "picture_in_picture",
        blur_background: false,
      };
    }

    setPreset(targetRenderPreset);
    setDraft((current) => {
      if (!current) return current;
      const currentFraming = normalizeVideoFraming(current.clipper_style_config?.video_framing);
      const updatedFraming = normalizeVideoFraming({
        ...currentFraming,
        ...nextFramingPatch,
      });
      return {
        ...current,
        clipper_style_config: {
          ...styleDefaults.clean_podcast,
          ...(current.clipper_style_config || {}),
          render_preset: targetRenderPreset,
          clipper_style_preset: targetClipperPreset,
          video_framing: updatedFraming,
        },
      };
    });

    const matched = videoFramingPresets.find((p) => p.id === presetId);
    setMessage(`Preset framing "${matched?.label || presetId}" aktif.`);
  };
  const videoAdjustments = normalizeVideoAdjustments(styleConfig.video_adjustments);
  const setVideoAdjustments = (changes: Partial<VideoAdjustments>) => {
    const nextAdjustments = normalizeVideoAdjustments({ ...videoAdjustments, ...changes });
    setStyle("video_adjustments", nextAdjustments);
  };
  const videoSpeed = Math.max(0.25, Math.min(4, Number(styleConfig.video_speed || 1.0)));
  const setVideoSpeed = (speed: number) => {
    const clamped = Number(Math.max(0.25, Math.min(4, speed)).toFixed(2));
    if (previewVideoRef.current) {
      previewVideoRef.current.playbackRate = clamped;
    }
    setStyle("video_speed", clamped);
  };
  const audioSettings = normalizeAudioSettings(styleConfig.audio_settings);
  const setAudioSettings = (changes: Partial<AudioSettings>) => {
    const next = normalizeAudioSettings({ ...audioSettings, ...changes });
    if (previewAudioRef.current && next.speed !== undefined) {
      previewAudioRef.current.playbackRate = next.speed;
    }
    setTimelineDirty(true);
    setStyle("audio_settings", next);
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
  const videoMuted = Boolean(styleConfig.video_muted);

  const toggleVideoMuted = () => {
    if (audioExtracted) return;
    const next = !videoMuted;
    setStyle("video_muted", next);
    if (previewVideoRef.current) {
      previewVideoRef.current.muted = next || audioSettings.muted;
    }
    setMessage(next ? "Audio video dibisukan (mute)." : "Audio video diaktifkan kembali.");
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
  const legacySequence: MediaSequenceSegment[] = legacyBoundaries.slice(0, -1).map((sourceStart, index) => ({
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
  const layoutSequence = (sequence: MediaSequenceSegment[], speed: number = 1.0) => {
    const fallbackSpeed = Math.max(0.25, Math.min(4.0, Number.isFinite(speed) && speed > 0 ? speed : 1.0));
    let offset = 0;
    const segments = sequence.map((segment, index) => {
      const start = offset;
      const segmentSpeed = Math.max(0.25, Math.min(4.0, Number(segment.speed) || fallbackSpeed));
      const baseDuration = Math.max(0, segment.sourceEnd - segment.sourceStart);
      const effectiveDuration = baseDuration / segmentSpeed;
      const end = start + effectiveDuration;
      offset = end;
      return {
        ...segment,
        start,
        end,
        duration: effectiveDuration,
        baseDuration,
        effectiveDuration,
        speed: segmentSpeed,
        number: index + 1,
      };
    });
    return { segments, duration: offset };
  };
  const videoLayout = layoutSequence(videoSequence, videoSpeed);
  const audioLayout = layoutSequence(
    audioSequence,
    audioExtracted ? (audioSettings.speed || 1.0) : videoSpeed,
  );
  const videoSegments = videoLayout.segments;
  const audioSegments = audioLayout.segments;
  const videoClipBoundaries = (() => {
    if (videoSegments.length < 2) return [];
    const boundaries: Array<{
      index: number;
      time: number;
      beforeSegment: (typeof videoSegments)[number];
      afterSegment: (typeof videoSegments)[number];
      boundaryId: string;
    }> = [];
    for (let i = 0; i < videoSegments.length - 1; i++) {
      const before = videoSegments[i];
      const after = videoSegments[i + 1];
      boundaries.push({
        index: i,
        time: before.end,
        beforeSegment: before,
        afterSegment: after,
        boundaryId: `${before.id || i}:${after.id || i + 1}`,
      });
    }
    return boundaries;
  })();
  const activeMediaTrack = audioExtracted && selectedEditorContext === "audio" ? "audio" : "video";
  const mediaSequence = activeMediaTrack === "audio" ? audioSequence : videoSequence;
  const mediaSegments = activeMediaTrack === "audio" ? audioSegments : videoSegments;
  const clipDuration = getTimelineDuration(
    videoSequence,
    audioSequence,
    additionalAudioTracks,
    styleConfig.caption_timeline,
    styleConfig.effect_timeline,
    manualEditorMode ? 0.0 : originalClipDuration,
  );
  const timelineScaleDuration = Math.max(
    0.1,
    (manualEditorMode || videoSequence.length > 0)
      ? (clipDuration > 0.05 ? clipDuration : (manualEditorMode ? 0.1 : originalClipDuration))
      : (clipDuration || originalClipDuration),
  );
  const timelineContentScale = Math.max(0.25, Math.min(4.0, timelineZoom));

  if (import.meta.env.DEV) {
    videoSegments.forEach((segment) => {
      console.log("[timeline_segment_regression_audit]", {
        segment_id: segment.id,
        asset_id: segment.asset_id,
        name: segment.name,
        start: segment.start,
        end: segment.end,
        duration: segment.duration,
        source_start: segment.sourceStart,
        source_end: segment.sourceEnd,
        speed: segment.speed,
        effective_duration: segment.effectiveDuration,
      });
    });

    console.log("[timeline_layout_regression_audit]", {
      clipDuration,
      timelineDuration: timelineScaleDuration,
      visibleTimelineDuration: timelineScaleDuration,
      timelineZoom,
      pixelsPerSecond: (1000 * timelineZoom) / Math.max(1, timelineScaleDuration),
      segments: videoSegments.map((s) => ({
        segment_id: s.id,
        segmentStart: s.start,
        segmentEnd: s.end,
        segmentDuration: s.duration,
        calculatedLeft: eventLeft(s.start, timelineScaleDuration),
        calculatedWidth: eventWidth(s.start, s.end, timelineScaleDuration),
      })),
    });
  }
  const sourceMediaUrl = candidateVideoUrl(draft.candidate_id);
  const timelineFirstVideoAssetId = videoSequence.find((seg) => seg.asset_id)?.asset_id;
  const firstTimelineVideo = timelineFirstVideoAssetId
    ? (editorMediaQuery.data || []).find((asset) => asset.asset_id === timelineFirstVideoAssetId)
    : (editorMediaQuery.data || []).find((asset) => asset.kind === "video");
  const sourceClipUrl =
    manualEditorMode && firstTimelineVideo
      ? mediaUrl(transformationId, firstTimelineVideo.asset_id)
      : sourceMediaUrl;

  const activeVideoSegment = getActiveVideoSegment(videoSegments, previewTime);

  const activeMediaAsset = activeVideoSegment?.asset_id
    ? (editorMediaQuery.data || []).find((asset) => asset.asset_id === activeVideoSegment.asset_id)
    : null;

  const resolvedSourceInfo = resolveVideoSegmentSource(
    activeVideoSegment,
    editorMediaQuery.data,
    sourceClipUrl,
    transformationId,
    API_URL,
  );
  const activeVideoSource = resolvedSourceInfo.resolvedSource;

  // Clear error state when active segment switches
  if (activeVideoSegment && prevActiveSegmentIdRef.current && prevActiveSegmentIdRef.current !== activeVideoSegment.id) {
    if (previewVideoError) {
      if (import.meta.env.DEV) {
        console.log("[preview_video_error_state]", {
          action: "reset_on_segment_switch",
          active_source: activeVideoSource,
          active_asset_id: activeVideoSegment.asset_id,
          active_segment_id: activeVideoSegment.id,
          cleared_error: previewVideoError,
        });
      }
      setPreviewVideoError(null);
    }
  }

  // Log source change only when activeVideoSource actually changes
  if (activeVideoSource !== prevLoggedVideoSourceRef.current) {
    if (import.meta.env.DEV) {
      console.log("[preview_video_source_change]", {
        from_source: prevLoggedVideoSourceRef.current,
        to_source: activeVideoSource,
        active_segment_id: activeVideoSegment?.id,
        active_asset_id: activeVideoSegment?.asset_id,
        preview_time: previewTime,
      });
    }
    prevLoggedVideoSourceRef.current = activeVideoSource;
  }

  const activeSourceHasError = Boolean(
    previewVideoError &&
    activeVideoSource &&
    (sameMediaSource(previewVideoError.source, activeVideoSource) ||
     (activeVideoSegment?.asset_id && previewVideoError.assetId === activeVideoSegment.asset_id))
  );

  if (import.meta.env.DEV) {
    console.log("[video_sequence_debug]", videoSegments.map((segment, index) => ({
      index,
      segment_id: segment.id,
      asset_id: segment.asset_id,
      name: segment.name,
      source_url: segment.source_url,
      source_path: segment.source_path,
      start: segment.start,
      end: segment.end,
      duration: segment.duration,
      source_start: segment.sourceStart,
      source_end: segment.sourceEnd,
      speed: segment.speed,
    })));
  }

  const activeSourceTime = activeVideoSegment
    ? resolveVideoSourceTime(activeVideoSegment, previewTime)
    : 0;

  if (import.meta.env.DEV) {
    console.log("[resolve_video_segment_source]", {
      preview_time: previewTime,
      segment_id: activeVideoSegment?.id,
      asset_id: activeVideoSegment?.asset_id,
      segment_source_url: activeVideoSegment?.source_url || (activeVideoSegment as unknown as Record<string, unknown>)?.sourceUrl,
      asset_source_url: (activeMediaAsset as unknown as Record<string, unknown>)?.source_url,
      fallback_used: resolvedSourceInfo.fallbackUsed,
      resolved_source: activeVideoSource,
    });
  }

  // Track active segment transitions for DEV logging (inline, no hook)
  if (activeVideoSegment && prevActiveSegmentIdRef.current && prevActiveSegmentIdRef.current !== activeVideoSegment.id) {
    if (import.meta.env.DEV) {
      const activeIdx = videoSegments.findIndex((s) => s.id === activeVideoSegment.id);
      console.log("[timeline_segment_switch]", {
        active_index: activeIdx,
        active_segment_asset_id: activeVideoSegment.asset_id,
        active_segment_url: activeVideoSource,
        currentTime: previewTime,
      });
      console.log("[active_video_segment_switch]", {
        fromSegmentId: prevActiveSegmentIdRef.current,
        toSegmentId: activeVideoSegment.id,
        fromAssetId: videoSegments.find((s) => s.id === prevActiveSegmentIdRef.current)?.asset_id,
        toAssetId: activeVideoSegment.asset_id,
        previewTime,
        sourceUrl: activeVideoSource,
      });
    }
  }
  if (activeVideoSegment) {
    prevActiveSegmentIdRef.current = activeVideoSegment.id;
  }

  if (import.meta.env.DEV) {
    console.log("[timeline_duration_computed]", {
      video_sequence_count: videoSequence.length,
      video_sequence_ends: videoSegments.map((s) => s.end),
      timeline_duration: clipDuration,
    });
    console.log("[active_video_source]", {
      preview_time: previewTime,
      active_segment_id: activeVideoSegment?.id,
      asset_id: activeVideoSegment?.asset_id,
      source_url: activeVideoSource,
      source_time: activeSourceTime,
      segment_start: activeVideoSegment?.start,
      segment_end: activeVideoSegment?.end,
    });
  }
  const renderedPreviewAvailable =
    !renderDirty &&
    activeRender?.status === "completed" &&
    activeRender.preset === preset &&
    Boolean(activeRender.file_size_bytes === undefined || activeRender.file_size_bytes > 20_000);
  const renderedPreviewUrl =
    renderedPreviewAvailable && activeRender
      ? `${downloadUrl(activeRender.id)}?render_id=${activeRender.id}&v=${activeRender.manifest_hash || activeRender.id}-${activeRender.status}-${activeRender.width}x${activeRender.height}-${activeRender.file_size_bytes || 0}&t=${Date.now()}`
      : null;
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
    if (import.meta.env.DEV) {
      console.log("[media_add_to_timeline_request]", {
        requested_asset_id: asset.asset_id,
        requested_filename: asset.name,
        requested_duration: asset.duration_seconds,
      });
    }
    if (asset.kind === "video") {
      const duration = Math.max(0.1, Number(asset.duration_seconds || 5.0));
      const start = Number(videoLayout.duration.toFixed(3));
      const newSegment: MediaSequenceSegment = {
        id: `media-${asset.asset_id.slice(0, 8)}-${Date.now()}`,
        sourceStart: 0.0,
        sourceEnd: duration,
        start,
        end: Number((start + duration).toFixed(3)),
        duration: Number(duration.toFixed(3)),
        speed: 1,
        asset_id: asset.asset_id,
        name: asset.name,
        source_url: asset.source_url || mediaUrl(transformationId, asset.asset_id),
      };
      const nextSequence = [...videoSequence, newSegment];
      commitMediaSequence(nextSequence, effectTimeline, "video");
      setMessage(`${asset.name} ditambahkan ke timeline.`);
      try {
        const saved = await api<Transformation>(
          `/api/transformations/${transformationId}/media/${asset.asset_id}/add-to-timeline`,
          { method: "POST" },
        );
        setDraft(saved);
        if (import.meta.env.DEV) {
          const savedSeq = (saved.clipper_style_config?.video_sequence || []) as Array<Record<string, unknown>>;
          const addedSeg = savedSeq.find((s) => s.asset_id === asset.asset_id || String(s.id).includes(asset.asset_id));
          console.log("[media_add_to_timeline_response]", {
            new_segment_asset_id: addedSeg?.asset_id || asset.asset_id,
            new_segment_name: addedSeg?.name || asset.name,
            new_segment_duration: addedSeg?.duration || (addedSeg ? (Number(addedSeg.source_end) - Number(addedSeg.source_start)) : duration),
            all_segment_asset_ids: savedSeq.map((s) => s.asset_id),
            all_segment_names: savedSeq.map((s) => s.name),
          });
        }
      } catch (err) {
        console.warn("Failed to sync add-to-timeline with backend:", err);
      }
    } else if (asset.kind === "audio") {
      const audioDuration = Math.max(0.1, Number(asset.duration_seconds || 5.0));
      const start = Math.min(Math.max(0, previewTime), Math.max(0, timelineScaleDuration - 0.1));
      const end = Math.min(timelineScaleDuration, Math.max(start + 0.1, start + audioDuration));
      const number = additionalAudioTracks.length + 1;
      const id = `additional-audio-${newEventId()}`;
      const track: AdditionalAudioTrack = {
        id,
        asset_id: asset.asset_id,
        label: asset.name || `Audio ${number}`,
        kind: "backsound",
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        volume: 1,
      };
      const newAssetItem: AdditionalAudioAsset = {
        id: asset.asset_id,
        name: asset.name,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        duration_seconds: audioDuration,
      };
      updateAdditionalAudioLibrary(
        [...additionalAudioAssets.filter((a) => a.id !== asset.asset_id), newAssetItem],
        [...additionalAudioTracks, track],
      );
      setMessage(`${asset.name} ditambahkan ke track audio.`);
      try {
        const saved = await api<Transformation>(
          `/api/transformations/${transformationId}/media/${asset.asset_id}/add-to-timeline`,
          { method: "POST" },
        );
        setDraft(saved);
      } catch (err) {
        console.warn("Failed to sync add-to-timeline with backend:", err);
      }
    } else if (asset.kind === "image") {
      try {
        const saved = await api<Transformation>(
          `/api/transformations/${transformationId}/media/${asset.asset_id}/add-to-timeline`,
          { method: "POST" },
        );
        setDraft(saved);
        setEditorDirty(true);
        setMessage(`${asset.name} ditambahkan ke project.`);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Gagal menambahkan gambar.");
      }
    }
    await editorMediaQuery.refetch();
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
      // Library-first: refetch media assets and switch to Project Media view
      const refreshed = await editorMediaQuery.refetch();
      setMediaDirectory("project_media");
      setSelectedMediaAssetId(asset.asset_id);
      setMessage(`Media ${asset.name} berhasil ditambahkan ke library.`);

      if (import.meta.env.DEV) {
        console.log("[media_import_success]", {
          asset_id: asset.asset_id,
          filename: asset.name,
          type: asset.kind,
        });
        console.log("[media_library_refreshed]", {
          total_assets: (refreshed.data || []).length,
          asset_ids: (refreshed.data || []).map((a) => a.asset_id),
        });
      }
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
      setAudioDirectory("yours");
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
  const updateAdditionalAudioTrack = (
    trackId: string,
    patch: Partial<AdditionalAudioTrack>,
  ) => {
    if (patch.speed !== undefined) {
      const audioEl = activeAudioElementsRef.current.get(trackId);
      if (audioEl) {
        audioEl.playbackRate = Math.max(0.5, Math.min(2.0, patch.speed));
      }
    }
    const nextTracks = additionalAudioTracks.map((t) => {
      if (t.id !== trackId) return t;
      const baseDuration = t.base_duration || Math.max(0.1, t.end - t.start);
      return { ...t, base_duration: baseDuration, ...patch };
    });
    updateAdditionalAudioLibrary(additionalAudioAssets, nextTracks);
    setTimelineError("");
    setEditorDirty(true);
    setTimelineDirty(true);
  };
  const deleteAdditionalAudioTrack = (trackId: string) => {
    const audioEl = activeAudioElementsRef.current.get(trackId);
    if (audioEl) {
      audioEl.pause();
      audioEl.src = "";
      activeAudioElementsRef.current.delete(trackId);
    }
    lastTriggeredSfxRef.current.delete(trackId);
    const nextTracks = additionalAudioTracks.filter((t) => t.id !== trackId);
    updateAdditionalAudioLibrary(additionalAudioAssets, nextTracks);
    if (selectedAdditionalAudioTrackId === trackId) {
      setSelectedAdditionalAudioTrackId(null);
    }
    setTimelineError("");
    setEditorDirty(true);
    setTimelineDirty(true);
    setMessage("Track audio dihapus dari timeline.");
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
  const livePunchEvent = activeTimelineEvent(
    effectTimeline,
    "punch_zoom",
    previewTime,
    previewPlaying,
  );
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
  const generatedCaptionCues: CaptionCueItem[] = projectCaptionCues(
    context.data.caption_cues || [],
    videoSequence,
  ).map((c) => ({
    ...c,
    type: "main_caption",
    style_id: null,
    style_override: null,
    locked: false,
    visible: true,
  }));
  const savedCaptionTimeline = Array.isArray(styleConfig.caption_timeline)
    ? (styleConfig.caption_timeline as CaptionCueItem[])
        .map((cue, index) => ({
          id: String(cue.id || `caption-saved-${index}`),
          start: Math.max(0, Math.min(clipDuration, Number(cue.start) || 0)),
          end: Math.max(0, Math.min(clipDuration, Number(cue.end) || 0)),
          text: String(cue.text || "").trim(),
          type: cue.type || "main_caption",
          style_id: cue.style_id || null,
          style_override: cue.style_override || null,
          locked: Boolean(cue.locked),
          visible: cue.visible !== false,
        }))
        .filter((cue) => cue.end > cue.start)
    : [];
  const captionTimelineInitialized = editorStateInitialized ||
    Boolean(styleConfig.caption_timeline_initialized) || savedCaptionTimeline.length > 0;
  const editableCaptionCues = captionTimelineInitialized
    ? savedCaptionTimeline
    : generatedCaptionCues;
  const currentCaptionCue = activeCaptionCue(editableCaptionCues, previewTime);
  const baseCurrentCaptionStyle = resolveCaptionStyle(
    currentCaptionCue,
    mainCaptionStyle,
    captionApplyToAll,
  );
  const resolvedCurrentCaptionStyle = hoveredCaptionTemplate
    ? applyCaptionTemplateToMainStyle(baseCurrentCaptionStyle, hoveredCaptionTemplate)
    : baseCurrentCaptionStyle;
  const rawSubtitlePreview = currentCaptionCue
    ? getCaptionPreviewText(currentCaptionCue.text)
    : null;
  const subtitlePreview = rawSubtitlePreview
    ? formatCaptionCase(rawSubtitlePreview, resolvedCurrentCaptionStyle.case_mode)
    : null;
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
  const editableEffectTimeline = configuredEffectTimeline.map((event, index) => ({
    ...event,
    id: editableEventId(event, index),
  }));
  const selectedEvent =
    editableEffectTimeline.find((event) => event.id === selectedEventId) || null;
  const liveHookEvent = activeHookCue(editableEffectTimeline, previewTime);
  const liveHookText = hookCueText(liveHookEvent, hookFallbackText);
  const liveStickerEvent = editableEffectTimeline.find(
    (event) =>
      (event.type === "keyword_popup" || event.type === "sticker") &&
      Boolean(event.reason?.toLowerCase().includes("sticker") || event.type === "sticker") &&
      Number.isFinite(event.start) &&
      Number.isFinite(event.end) &&
      previewTime >= event.start &&
      previewTime <= event.end,
  );
  const liveKeywordEvent = editableEffectTimeline.find(
    (event) =>
      event.type === "keyword_popup" &&
      !event.reason?.toLowerCase().includes("sticker") &&
      Number.isFinite(event.start) &&
      Number.isFinite(event.end) &&
      previewTime >= event.start &&
      previewTime <= event.end,
  );
  const hookResponsiveFontSize = (() => {
    const len = (liveHookText || "").trim().length;
    if (hookTextSize === "large") {
      if (len > 50) return "clamp(11px, 2.7vh, 14px)";
      if (len > 30) return "clamp(12px, 3.1vh, 16px)";
      return "clamp(14px, 3.6vh, 18px)";
    }
    // normal size
    if (len > 50) return "clamp(10px, 2.2vh, 12px)";
    if (len > 30) return "clamp(11px, 2.5vh, 13.5px)";
    return "clamp(12px, 2.9vh, 15px)";
  })();
  const liveTransitionEvent =
    videoSegments.length >= 2
      ? editableEffectTimeline.find(
          (event) =>
            event.type === "pattern_interrupt" &&
            Boolean(event.reason?.startsWith("transition")) &&
            Number.isFinite(event.start) &&
            Number.isFinite(event.end) &&
            previewTime >= event.start &&
            previewTime <= event.end,
        )
      : undefined;

  const liveEffectEvent = editableEffectTimeline.find(
    (event) =>
      (event.type === "pattern_interrupt" || event.type === "punch_zoom" || event.type === "effect") &&
      !event.reason?.startsWith("transition") &&
      Number.isFinite(event.start) &&
      Number.isFinite(event.end) &&
      previewTime >= event.start &&
      previewTime <= event.end,
  );

  const isVisualModifierActive = Boolean(
    liveTransitionEvent || previewDemoTransition || liveEffectEvent,
  );

  const visualModifierProgress = previewDemoTransition
    ? demoTransitionProgress
    : liveTransitionEvent
    ? Math.min(
        1,
        Math.max(
          0,
          (previewTime - liveTransitionEvent.start) /
            Math.max(0.01, liveTransitionEvent.end - liveTransitionEvent.start),
        ),
      )
    : liveEffectEvent
    ? Math.min(
        1,
        Math.max(
          0,
          (previewTime - liveEffectEvent.start) /
            Math.max(0.01, liveEffectEvent.end - liveEffectEvent.start),
        ),
      )
    : 0;

  const activeVisualEffectType = (
    previewDemoTransition?.effect ||
    liveTransitionEvent?.effect ||
    liveEffectEvent?.effect ||
    (liveEffectEvent?.type === "punch_zoom" ? "punch_zoom" : "fade")
  ).toLowerCase();

  let transitionOverlayColor: string | null = null;
  let transitionOverlayOpacity = 0;
  let transitionTransformStyle: React.CSSProperties | undefined = undefined;
  let transitionFilterStyle: string | undefined = undefined;

  if (isVisualModifierActive) {
    const p = Math.min(1, Math.max(0, visualModifierProgress));
    if (activeVisualEffectType.includes("flash") || activeVisualEffectType.includes("white")) {
      transitionOverlayColor = "#ffffff";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.95;
      transitionFilterStyle = `brightness(${1 + Math.sin(p * Math.PI) * 0.8})`;
    } else if (
      activeVisualEffectType.includes("fade_black") ||
      activeVisualEffectType === "fade" ||
      (activeVisualEffectType.includes("fade") &&
        !activeVisualEffectType.includes("white") &&
        !activeVisualEffectType.includes("blur"))
    ) {
      transitionOverlayColor = "#000000";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.9;
    } else if (activeVisualEffectType.includes("cross") || activeVisualEffectType.includes("dissolve")) {
      transitionOverlayColor = "#0f172a";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.6;
      const blurDip = Math.sin(p * Math.PI) * 6;
      const brightDip = 1 - Math.sin(p * Math.PI) * 0.25;
      transitionFilterStyle = `blur(${blurDip}px) brightness(${brightDip})`;
    } else if (
      activeVisualEffectType.includes("slide_l") ||
      activeVisualEffectType.includes("slide-l") ||
      activeVisualEffectType.includes("slide_left")
    ) {
      const offsetPercent = -p * 100;
      transitionTransformStyle = {
        transform: `translateX(${offsetPercent}%)`,
        transition: "none",
      };
      transitionOverlayColor = "#09090b";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.3;
    } else if (
      activeVisualEffectType.includes("slide_r") ||
      activeVisualEffectType.includes("slide-r") ||
      activeVisualEffectType.includes("slide_right")
    ) {
      const offsetPercent = p * 100;
      transitionTransformStyle = {
        transform: `translateX(${offsetPercent}%)`,
        transition: "none",
      };
      transitionOverlayColor = "#09090b";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.3;
    } else if (
      activeVisualEffectType.includes("slide_u") ||
      activeVisualEffectType.includes("slide-u") ||
      activeVisualEffectType.includes("slide_up")
    ) {
      const offsetPercent = -p * 100;
      transitionTransformStyle = {
        transform: `translateY(${offsetPercent}%)`,
        transition: "none",
      };
      transitionOverlayColor = "#09090b";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.3;
    } else if (
      activeVisualEffectType.includes("slide_d") ||
      activeVisualEffectType.includes("slide-d") ||
      activeVisualEffectType.includes("slide_down")
    ) {
      const offsetPercent = p * 100;
      transitionTransformStyle = {
        transform: `translateY(${offsetPercent}%)`,
        transition: "none",
      };
      transitionOverlayColor = "#09090b";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.3;
    } else if (activeVisualEffectType.includes("zoom_in") || activeVisualEffectType.includes("zoom-in")) {
      const scale = 1 + Math.sin(p * Math.PI) * 0.4;
      const blurPx = Math.sin(p * Math.PI) * 4;
      transitionTransformStyle = {
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      };
      transitionFilterStyle = blurPx > 0.5 ? `blur(${blurPx}px)` : undefined;
    } else if (activeVisualEffectType.includes("zoom_out") || activeVisualEffectType.includes("zoom-out")) {
      const scale = 1 - Math.sin(p * Math.PI) * 0.28;
      transitionTransformStyle = {
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      };
    } else if (activeVisualEffectType.includes("punch")) {
      const scale = 1 + Math.sin(p * Math.PI) * 0.32;
      transitionTransformStyle = {
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      };
    } else if (activeVisualEffectType.includes("quick_zoom") || activeVisualEffectType.includes("zoom")) {
      const scale = 1 + Math.sin(p * Math.PI) * 0.26;
      transitionTransformStyle = {
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      };
    } else if (activeVisualEffectType.includes("blur")) {
      const blurPx = Math.sin(p * Math.PI) * 16;
      transitionFilterStyle = `blur(${blurPx}px)`;
      transitionOverlayColor = "#000000";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.35;
    } else if (activeVisualEffectType.includes("glitch")) {
      const skew = Math.sin(p * Math.PI * 6) * 10;
      const shiftX = Math.sin(p * Math.PI * 8) * 20;
      const hue = Math.sin(p * Math.PI * 4) * 180;
      transitionTransformStyle = {
        transform: `skewX(${skew}deg) translateX(${shiftX}px)`,
      };
      transitionFilterStyle = `hue-rotate(${hue}deg) contrast(180%) saturate(220%)`;
    } else if (activeVisualEffectType.includes("noise") || activeVisualEffectType.includes("scanline")) {
      const shiftY = Math.sin(p * Math.PI * 10) * 8;
      transitionTransformStyle = {
        transform: `translateY(${shiftY}px)`,
      };
      transitionFilterStyle = `contrast(200%) saturate(150%) brightness(1.2) hue-rotate(90deg)`;
    } else if (activeVisualEffectType.includes("shake") || activeVisualEffectType.includes("earthquake")) {
      const isQuake = activeVisualEffectType.includes("earthquake");
      const shakeAmp = (isQuake ? 32 : 16) * Math.sin(p * Math.PI);
      const shakeX = Math.sin(p * Math.PI * (isQuake ? 14 : 12)) * shakeAmp;
      const shakeY = Math.cos(p * Math.PI * (isQuake ? 16 : 14)) * (shakeAmp * 0.75);
      const rot = Math.sin(p * Math.PI * (isQuake ? 12 : 10)) * (isQuake ? 4.5 : 2.5);
      transitionTransformStyle = {
        transform: `translate3d(${shakeX}px, ${shakeY}px, 0) rotate(${rot}deg)`,
      };
    } else if (
      activeVisualEffectType.includes("light_leak") ||
      activeVisualEffectType.includes("leak") ||
      activeVisualEffectType.includes("light")
    ) {
      transitionOverlayColor = "#f59e0b";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.5;
      transitionFilterStyle = `brightness(${1 + Math.sin(p * Math.PI) * 0.4}) saturate(${1 + Math.sin(p * Math.PI) * 0.5})`;
    } else if (activeVisualEffectType.includes("freeze")) {
      transitionOverlayColor = "#0284c7";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.4;
      transitionFilterStyle = `contrast(${1 + Math.sin(p * Math.PI) * 0.5}) brightness(${1 + Math.sin(p * Math.PI) * 0.3}) saturate(0.6)`;
    } else if (activeVisualEffectType.includes("wipe")) {
      const offsetPercent = -p * 100;
      transitionTransformStyle = {
        transform: `translateX(${offsetPercent}%)`,
      };
      transitionOverlayColor = "#09090b";
      transitionOverlayOpacity = Math.sin(p * Math.PI) * 0.35;
    }
  }
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

  const isItemIdLocked = (itemId: string | null | undefined): boolean => {
    if (!itemId) return false;
    const cue = editableCaptionCues.find((c) => c.id === itemId);
    if (cue) return Boolean(cue.locked);
    const event = editableEffectTimeline.find((e) => e.id === itemId);
    if (event) return Boolean(event.locked);
    const video = videoSegments.find((v) => v.id === itemId);
    if (video) return Boolean(video.locked || styleConfig.video_locked);
    const audio = audioSegments.find((a) => a.id === itemId);
    if (audio) return Boolean(audio.locked || styleConfig.audio_locked);
    const addAudio = additionalAudioTracks.find((t) => t.id === itemId);
    if (addAudio) return Boolean(addAudio.locked);
    return false;
  };

  const startCanvasDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    targetType: "hook" | "sticker" | "keyword" | "caption",
    targetId: string,
    currentPosX: number,
    currentPosY: number,
    currentScale = 1.0,
    currentFontSize?: number,
  ) => {
    if (isItemIdLocked(targetId)) {
      setMessage("Item sedang dikunci.");
      return;
    }
    const canvas = previewCanvasContainerRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    recordEditorHistory(draft, `canvas-drag-${targetType}`, true);

    if (targetType === "caption") {
      setSelectedCaptionId(targetId);
      setSelectedEventId(null);
      setSelectedEditorContext("caption");
      setCaptionInspectorTab("text");
    } else {
      setSelectedEventId(targetId);
      setSelectedCaptionId(null);
      setSelectedEditorContext(targetType === "sticker" ? "keyword" : targetType);
      setTextInspectorTab("text");
    }

    canvasManipulationRef.current = {
      pointerId: event.pointerId,
      mode: "drag",
      targetType,
      targetId,
      startX: event.clientX,
      startY: event.clientY,
      initialPosX: currentPosX,
      initialPosY: currentPosY,
      initialScale: currentScale,
      initialFontSize: currentFontSize,
      canvasWidth: rect.width || 1,
      canvasHeight: rect.height || 1,
    };
  };

  const startCanvasResize = (
    event: ReactPointerEvent<HTMLDivElement>,
    handle: "tl" | "tr" | "bl" | "br",
    targetType: "hook" | "sticker" | "keyword" | "caption",
    targetId: string,
    currentPosX: number,
    currentPosY: number,
    currentScale = 1.0,
    currentFontSize?: number,
  ) => {
    if (isItemIdLocked(targetId)) {
      setMessage("Item sedang dikunci.");
      return;
    }
    const canvas = previewCanvasContainerRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    recordEditorHistory(draft, `canvas-resize-${targetType}`, true);

    canvasManipulationRef.current = {
      pointerId: event.pointerId,
      mode: "resize",
      handle,
      targetType,
      targetId,
      startX: event.clientX,
      startY: event.clientY,
      initialPosX: currentPosX,
      initialPosY: currentPosY,
      initialScale: currentScale,
      initialFontSize: currentFontSize,
      canvasWidth: rect.width || 1,
      canvasHeight: rect.height || 1,
    };
  };

  const handleCanvasManipulationMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = canvasManipulationRef.current;
    if (!action || action.pointerId !== event.pointerId) return;

    if (action.mode === "drag") {
      const deltaXPercent = ((event.clientX - action.startX) / action.canvasWidth) * 100;
      const deltaYPercent = ((event.clientY - action.startY) / action.canvasHeight) * 100;
      const nextX = Math.max(5, Math.min(95, Number((action.initialPosX + deltaXPercent).toFixed(1))));
      const nextY = Math.max(5, Math.min(95, Number((action.initialPosY + deltaYPercent).toFixed(1))));

      if (action.targetType === "caption") {
        updateMainCaptionStyle({
          position_x_percent: nextX,
          position_y_percent: nextY,
        });
      } else {
        replaceEvent(action.targetId, {
          position_x_percent: nextX,
          position_y_percent: nextY,
        });
      }
    } else if (action.mode === "resize") {
      const deltaX = event.clientX - action.startX;
      const deltaY = event.clientY - action.startY;
      const signX = action.handle === "tr" || action.handle === "br" ? 1 : -1;
      const signY = action.handle === "bl" || action.handle === "br" ? 1 : -1;
      const avgDelta = (deltaX * signX + deltaY * signY) / 2;
      const scaleDelta = avgDelta / (action.canvasWidth * 0.35);

      if (action.targetType === "caption") {
        const baseSize = action.initialFontSize || resolvedCurrentCaptionStyle.font_size || 28;
        const fontDelta = Math.round(avgDelta * 0.25);
        const nextFontSize = Math.max(10, Math.min(96, baseSize + fontDelta));
        updateMainCaptionStyle({
          font_size: nextFontSize,
        });
      } else {
        const nextScale = Math.max(
          action.targetType === "sticker" ? 0.2 : 0.4,
          Math.min(4.0, Number((action.initialScale + scaleDelta).toFixed(2))),
        );
        replaceEvent(action.targetId, {
          scale: nextScale,
        });
      }
    }
  };

  const handleCanvasManipulationUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = canvasManipulationRef.current;
    if (!action || action.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    canvasManipulationRef.current = null;
    setAutosaveWakeRevision((r) => r + 1);
  };
  const deleteEvent = (eventId: string) => {
    if (!window.confirm("Hapus event ini?")) return;
    updateEffectTimeline(editableEffectTimeline.filter((event) => event.id !== eventId));
    setSelectedEventId(null);
    setSelectedEditorContext("timeline");
  };
  const addEvent = (
    type: "hook_text" | "punch_zoom" | "keyword_popup" | "pattern_interrupt",
    customReason?: string,
    customText?: string,
    customPreset?: TextStylePresetKey,
    customEffectName?: string,
  ) => {
    const start = Math.min(Math.max(0, previewTime), Math.max(0, clipDuration - 0.4));
    const intensity = String(styleConfig.style_intensity || "low");
    const zoom = intensity === "high" ? 1.25 : intensity === "medium" ? 1.20 : 1.18;
    const eventId = newEventId();
    const defaultText =
      customText ||
      (customReason?.includes("lower_third")
        ? "Nama / Jabatan"
        : customReason?.includes("quote")
        ? "“Kutipan menarik di sini”"
        : customReason?.includes("big_title")
        ? "JUDUL BESAR"
        : customReason?.includes("hook")
        ? (hookFallbackText || "WAJIB TAHU INI!")
        : "Teks Baru");
    const defaultDuration =
      type === "keyword_popup" ? 1.2 : type === "hook_text" ? 3 : type === "punch_zoom" ? 0.8 : 0.7;
    const base: EffectTimelineEvent = {
      id: eventId,
      type,
      start,
      end: Math.min(clipDuration, start + defaultDuration),
      reason: customReason || (type === "hook_text" ? "text:basic_text" : "manual timeline"),
    };
    if (customPreset) {
      base.preset = customPreset;
    }
    const resolvedEffect =
      customEffectName ||
      (customReason?.startsWith("effect:")
        ? customReason.replace("effect:", "").replace(/^ef-/, "").replace(/-/g, "_")
        : "quick_zoom");
    const event: EffectTimelineEvent =
      type === "keyword_popup"
        ? { ...base, text: customText || "KEYWORD" }
        : type === "punch_zoom"
          ? { ...base, zoom, effect: "punch_zoom" }
          : type === "hook_text"
            ? { ...base, text: defaultText }
            : { ...base, effect: resolvedEffect };
    updateEffectTimeline([...editableEffectTimeline, event]);
    setSelectedEventId(event.id || null);
    setSelectedCaptionId(null);
    setSelectedEditorContext(type === "keyword_popup" ? "keyword" : type === "hook_text" ? "hook" : "effect");
    if (type === "hook_text" || type === "keyword_popup") {
      setTextInspectorTab("text");
    } else {
      setEffectInspectorTab("effect");
    }
  };
  const timelineVideoItems: TimelineItem[] = videoSegments.map((segment) => {
    const assetName =
      segment.name ||
      (segment.asset_id
        ? (editorMediaQuery.data || []).find((a) => a.asset_id === segment.asset_id)?.name
        : undefined) ||
      context.data.uploaded_filename ||
      context.data.source_title ||
      "Video sumber";

    return {
      ...segment,
      selectable: true,
      type: "video",
      label: `${segment.number}. ${assetName}${audioExtracted ? "" : " • Audio asli"}`,
      title: `${assetName} (bagian ${segment.number})\n${formatTimePrecise(segment.start)}-${formatTimePrecise(segment.end)}\n${audioExtracted ? "Track video" : "Video dengan audio asli tertaut"}`,
      active: selectedMediaSegmentId === segment.id,
      colorClass: "bg-blue-600 text-white",
      locked: Boolean(segment.locked || styleConfig.video_locked),
      visible: segment.visible !== false && styleConfig.video_visible !== false,
    };
  });
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
    locked: Boolean(segment.locked || styleConfig.audio_locked),
    muted: Boolean(segment.muted || audioSettings.muted),
  }));
  const timelineAdditionalAudioTracks = additionalAudioTracks.map((track) => {
    const asset = additionalAudioAssets.find((item) => item.id === track.asset_id);
    const trackSpeed = Math.max(0.5, Math.min(2.0, track.speed || 1.0));
    const baseDuration = Number(track.base_duration) || (asset?.duration_seconds ? Number(asset.duration_seconds) : Math.max(0.1, track.end - track.start));
    const effectiveDuration = baseDuration / trackSpeed;
    const effectiveEnd = track.start + effectiveDuration;
    return {
      track,
      item: {
        id: track.id,
        selectable: true,
        type: "additional_audio",
        start: Math.max(0, track.start),
        end: Math.min(timelineScaleDuration, Math.max(track.start + 0.1, effectiveEnd)),
        label: asset?.name || track.label,
        title: `${track.label}\n${asset?.name || "Aset audio"}\nSpeed: ${trackSpeed.toFixed(2)}x`,
        active: selectedAdditionalAudioTrackId === track.id,
        colorClass: track.kind === "sfx"
          ? "bg-amber-500 text-slate-950"
          : "bg-fuchsia-600 text-white",
        locked: Boolean(track.locked),
        muted: Boolean(track.muted),
      } satisfies TimelineItem,
    };
  });
  const hookEvents = editableEffectTimeline.filter((event) => event.type === "hook_text");

  const textTimelineItems: TimelineItem[] = [
    // 1. Caption Cues
    ...editableCaptionCues.map((cue, index) => ({
      id: cue.id || `caption-${index}`,
      eventId: cue.id,
      editable: !cue.locked,
      selectable: true,
      type: "caption",
      start: cue.start,
      end: cue.end,
      label: cue.text ? `Caption: ${cue.text.length > 20 ? cue.text.slice(0, 20) + "..." : cue.text}` : "Caption",
      active: currentCaptionCue?.id === cue.id,
      title: `Caption\n${formatTimePrecise(cue.start)}-${formatTimePrecise(cue.end)}\n${cue.text}`,
      colorClass: "bg-violet-600/90 text-white font-medium",
      locked: Boolean(cue.locked),
      visible: cue.visible !== false,
    })),

    // 2. Hook & Text items (hook_text, basic_text, lower_third, quote, big_title, title_overlay, property_of)
    ...(
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
                reason: "hook",
              },
            ]
          : []
    ).map((event) => {
      const rawText = hookCueText(event, hookFallbackText);
      const reasonLower = (event.reason || "").toLowerCase();
      const badge = reasonLower.includes("lower_third")
        ? "Lower Third"
        : reasonLower.includes("quote")
        ? "Quote"
        : reasonLower.includes("big_title")
        ? "Big Title"
        : reasonLower.includes("property_of")
        ? "Property Of"
        : reasonLower.includes("title_overlay")
        ? "Title"
        : reasonLower.includes("basic_text") || reasonLower.includes("default_text")
        ? "Text"
        : "Hook";
      const displayLabel = rawText
        ? `${badge}: ${rawText.length > 20 ? rawText.slice(0, 20) + "..." : rawText}`
        : badge;
      return {
        id: event.id || "hook-preview",
        eventId: event.id,
        editable: Boolean(event.id) && !event.locked,
        selectable: true,
        type: "hook_text",
        start: event.start,
        end: event.end,
        label: displayLabel,
        active: previewTime >= event.start && previewTime <= event.end,
        title: `${badge}\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}\n${rawText}`,
        colorClass: "bg-cyan-600 text-white font-semibold",
        locked: Boolean(event.locked),
        visible: event.visible !== false,
      };
    }),

    // 3. Keyword text items (type: "keyword_popup" when NOT a sticker)
    ...editableEffectTimeline
      .filter(
        (event) =>
          event.type === "keyword_popup" &&
          event.end > event.start &&
          event.text &&
          !event.reason?.toLowerCase().includes("sticker"),
      )
      .map((event, index) => {
        const text = event.text || "";
        const label = `Keyword: ${text || "KEYWORD"}`;
        const displayLabel = text ? (label.length > 22 ? label.slice(0, 22) + "..." : label) : "Keyword";
        return {
          id: event.id || `keyword-${index}`,
          eventId: event.id,
          editable: !event.locked,
          type: event.type,
          start: event.start,
          end: event.end,
          label: displayLabel,
          active: previewTime >= event.start && previewTime <= event.end,
          title: `Keyword Pop-up\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}\n"${
            event.text || ""
          }"${event.reason ? `\nReason: ${event.reason}` : ""}`,
          colorClass: "bg-yellow-300 text-slate-950 font-semibold",
          locked: Boolean(event.locked),
          visible: event.visible !== false,
        };
      }),
  ];

  const overlayTimelineItems: TimelineItem[] = [
    // 1. Stickers (Sticker, Emoji, Shapes, Arrows, Badges)
    ...editableEffectTimeline
      .filter(
        (event) =>
          event.type === "keyword_popup" &&
          Boolean(event.reason?.toLowerCase().includes("sticker")) &&
          event.end > event.start &&
          event.text,
      )
      .map((event, index) => {
        const text = event.text || "";
        const reasonLower = (event.reason || "").toLowerCase();
        const badge = reasonLower.includes("arrow")
          ? "Arrow"
          : reasonLower.includes("shape")
          ? "Shape"
          : reasonLower.includes("badge")
          ? "Badge"
          : "Sticker";
        const label = `${badge}: ${text}`;
        return {
          id: event.id || `sticker-${index}`,
          eventId: event.id,
          editable: !event.locked,
          type: "keyword_popup",
          start: event.start,
          end: event.end,
          label: label.length > 22 ? label.slice(0, 22) + "..." : label,
          active: previewTime >= event.start && previewTime <= event.end,
          title: `${badge}: ${event.text}\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}`,
          colorClass: "bg-amber-400 text-slate-950 font-bold",
          locked: Boolean(event.locked),
          visible: event.visible !== false,
        };
      }),

    // 2. Punch Zoom
    ...editableEffectTimeline
      .filter((event) => event.type === "punch_zoom" && event.end > event.start)
      .map((event, index) => ({
        id: event.id || `punch-${index}`,
        eventId: event.id,
        editable: !event.locked,
        type: event.type,
        start: event.start,
        end: event.end,
        label: `Punch: ${event.zoom?.toFixed(2) || "1.08"}x`,
        active: previewTime >= event.start && previewTime <= event.end,
        title: `Punch Zoom\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)} - zoom ${
          event.zoom?.toFixed(2) || "1.08"
        }x${event.reason ? `\nReason: ${event.reason}` : ""}`,
        colorClass: "bg-rose-500 text-white font-medium",
        locked: Boolean(event.locked),
        visible: event.visible !== false,
      })),

    // 3. Pattern Interrupt / Effects
    ...editableEffectTimeline
      .filter(
        (event) =>
          event.type === "pattern_interrupt" &&
          event.end > event.start &&
          !event.reason?.startsWith("transition"),
      )
      .map((event, index) => {
        const effectLabel = event.effect?.replace(/_/g, " ") || "Pattern";
        return {
          id: event.id || `pattern-${index}`,
          eventId: event.id,
          editable: !event.locked,
          type: event.type,
          start: event.start,
          end: event.end,
          label: `Effect: ${effectLabel}`,
          active: previewTime >= event.start && previewTime <= event.end,
          title: `Pattern Interrupt\n${formatTimePrecise(event.start)}-${formatTimePrecise(event.end)}\nEffect: ${effectLabel}`,
          colorClass: "bg-teal-500 text-white font-medium",
          locked: Boolean(event.locked),
          visible: event.visible !== false,
        };
      }),
  ];

  const timelineTransitionMarkers = (() => {
    if (videoClipBoundaries.length === 0) return [];
    const transitionEvents = editableEffectTimeline.filter(
      (e) => e.type === "pattern_interrupt" && e.reason?.startsWith("transition"),
    );

    const markers: Array<{
      id: string;
      eventId: string;
      time: number;
      duration: number;
      name: string;
      effect: string;
      active: boolean;
      selected: boolean;
      beforeNumber: number;
      afterNumber: number;
    }> = [];

    videoClipBoundaries.forEach((boundary) => {
      const matching = transitionEvents.find((e) => {
        const mid = (e.start + e.end) / 2;
        return (
          Math.abs(mid - boundary.time) <= 0.4 ||
          Math.abs(e.start - boundary.time) <= 0.4 ||
          Math.abs(e.end - boundary.time) <= 0.4
        );
      });

      if (matching) {
        const name = matching.reason?.replace("transition:", "") || "Transisi";
        markers.push({
          id: `trans-marker-${boundary.boundaryId}`,
          eventId: matching.id || `trans-${boundary.index}`,
          time: boundary.time,
          duration: matching.end - matching.start,
          name,
          effect: matching.effect || "fade",
          active: previewTime >= matching.start && previewTime <= matching.end,
          selected: selectedEventId === matching.id,
          beforeNumber: boundary.beforeSegment.number,
          afterNumber: boundary.afterSegment.number,
        });
      }
    });

    return markers;
  })();
  const selectedTransitionBoundary = (() => {
    if (!selectedEvent || !selectedEvent.reason?.startsWith("transition")) return null;
    const mid = (selectedEvent.start + selectedEvent.end) / 2;
    return (
      videoClipBoundaries.find(
        (b) =>
          Math.abs(b.time - mid) <= 0.4 ||
          Math.abs(b.time - selectedEvent.start) <= 0.4 ||
          Math.abs(b.time - selectedEvent.end) <= 0.4,
      ) || null
    );
  })();
  const audioTimelineItems: TimelineItem[] = [
    ...(audioExtracted ? timelineAudioItems : []),
    ...timelineAdditionalAudioTracks.map((t) => t.item),
  ];

  const textLanes = packTimelineItemsIntoLanes(textTimelineItems);
  const overlayLanes = packTimelineItemsIntoLanes(overlayTimelineItems);
  const videoLanes = packTimelineItemsIntoLanes(timelineVideoItems);
  const audioLanes = packTimelineItemsIntoLanes(audioTimelineItems);

  const hasAnyTimelineTracks = Boolean(
    textLanes.length > 0 ||
      overlayLanes.length > 0 ||
      videoLanes.length > 0 ||
      audioLanes.length > 0,
  );
  const hookWords = hookWordCount(styleConfig.hook_text);
  const clampClipTime = (value: number) =>
    Math.min(Math.max(0, Number.isFinite(value) ? value : 0), Math.max(0, clipDuration));
  const clipTimeFromVideoTime = (videoTime: number) => {
    if (renderedPreviewUrl) {
      return clampClipTime(videoTime);
    }
    if (videoSegments.length === 0) return 0;
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
    const relativeSourceTime = Math.min(
      segment.sourceEnd - segment.sourceStart,
      Math.max(0, sourceTime - segment.sourceStart),
    );
    const relativeTimelineTime = relativeSourceTime / videoSpeed;
    return clampClipTime(segment.start + relativeTimelineTime);
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

  const toggleLaneLock = (laneItems: TimelineItem[]) => {
    if (!laneItems.length) return;
    const allLocked = laneItems.every((item) => Boolean(item.locked));
    const targetLocked = !allLocked;
    const itemIds = new Set(laneItems.map((item) => item.id || item.eventId).filter(Boolean));

    const matchingCues = editableCaptionCues.filter((c) => itemIds.has(c.id));
    if (matchingCues.length > 0) {
      updateCaptionTimeline(
        editableCaptionCues.map((c) =>
          itemIds.has(c.id) ? { ...c, locked: targetLocked } : c,
        ),
        true,
      );
    }

    const matchingEffects = editableEffectTimeline.filter((e) => itemIds.has(e.id));
    if (matchingEffects.length > 0) {
      updateEffectTimeline(
        editableEffectTimeline.map((e) =>
          itemIds.has(e.id) ? { ...e, locked: targetLocked } : e,
        ),
        true,
      );
    }

    const matchingVideos = videoSegments.filter((v) => itemIds.has(v.id));
    if (matchingVideos.length > 0) {
      if (videoSequence.length > 0) {
        const nextVideoSeq = videoSequence.map((v) =>
          itemIds.has(v.id) ? { ...v, locked: targetLocked } : v,
        );
        commitMediaSequence(nextVideoSeq, configuredEffectTimeline, "video");
      } else {
        setStyle("video_locked", targetLocked);
      }
    }

    const matchingAudios = audioSegments.filter((a) => itemIds.has(a.id));
    if (matchingAudios.length > 0) {
      if (audioSequence.length > 0) {
        const nextAudioSeq = audioSequence.map((a) =>
          itemIds.has(a.id) ? { ...a, locked: targetLocked } : a,
        );
        commitMediaSequence(nextAudioSeq, configuredEffectTimeline, "audio");
      } else {
        setStyle("audio_locked", targetLocked);
      }
    }

    const matchingAddTracks = additionalAudioTracks.filter((t) => itemIds.has(t.id));
    if (matchingAddTracks.length > 0) {
      const nextAddTracks = additionalAudioTracks.map((t) =>
        itemIds.has(t.id) ? { ...t, locked: targetLocked } : t,
      );
      updateAdditionalAudioLibrary(additionalAudioAssets, nextAddTracks);
    }

    setMessage(targetLocked ? "Item pada lane dikunci." : "Kunci item pada lane dibuka.");
  };

  const toggleLaneVisibility = (laneItems: TimelineItem[]) => {
    if (!laneItems.length) return;
    const allVisible = laneItems.every((item) => item.visible !== false);
    const targetVisible = !allVisible;
    const itemIds = new Set(laneItems.map((item) => item.id || item.eventId).filter(Boolean));

    const matchingCues = editableCaptionCues.filter((c) => itemIds.has(c.id));
    if (matchingCues.length > 0) {
      updateCaptionTimeline(
        editableCaptionCues.map((c) =>
          itemIds.has(c.id) ? { ...c, visible: targetVisible } : c,
        ),
        true,
      );
    }

    const matchingEffects = editableEffectTimeline.filter((e) => itemIds.has(e.id));
    if (matchingEffects.length > 0) {
      updateEffectTimeline(
        editableEffectTimeline.map((e) =>
          itemIds.has(e.id) ? { ...e, visible: targetVisible } : e,
        ),
        true,
      );
    }

    const matchingVideos = videoSegments.filter((v) => itemIds.has(v.id));
    if (matchingVideos.length > 0) {
      if (videoSequence.length > 0) {
        const nextVideoSeq = videoSequence.map((v) =>
          itemIds.has(v.id) ? { ...v, visible: targetVisible } : v,
        );
        commitMediaSequence(nextVideoSeq, configuredEffectTimeline, "video");
      } else {
        setStyle("video_visible", targetVisible);
      }
    }

    setMessage(targetVisible ? "Item pada lane ditampilkan." : "Item pada lane disembunyikan dari preview.");
  };

  const toggleLaneMute = (laneItems: TimelineItem[]) => {
    if (!laneItems.length) return;
    const isExtractedAudioLane = laneItems.some((item) => item.type === "audio");
    if (isExtractedAudioLane) {
      const nextMuted = !audioSettings.muted;
      setAudioSettings({ muted: nextMuted });
      if (audioSequence.length > 0) {
        const nextAudioSeq = audioSequence.map((a) => ({ ...a, muted: nextMuted }));
        commitMediaSequence(nextAudioSeq, configuredEffectTimeline, "audio");
      }
      setMessage(nextMuted ? "Audio asli dibisukan (mute)." : "Audio asli diaktifkan kembali.");
      return;
    }

    const itemIds = new Set(laneItems.map((item) => item.id));
    const laneTracks = additionalAudioTracks.filter((t) => itemIds.has(t.id));
    const allMuted = laneTracks.length > 0 && laneTracks.every((t) => t.muted);
    const nextMuted = !allMuted;
    const nextTracks = additionalAudioTracks.map((t) =>
      itemIds.has(t.id) ? { ...t, muted: nextMuted } : t,
    );
    updateAdditionalAudioLibrary(additionalAudioAssets, nextTracks);
    setMessage(nextMuted ? "Track audio dibisukan (mute)." : "Track audio diaktifkan kembali.");
  };

  const hasTimelineMedia = Boolean(
    (videoSegments.length > 0 && !videoTrackDeleted) ||
      (audioSegments.length > 0 && !audioTrackDeleted) ||
      additionalAudioTracks.length > 0 ||
      Boolean(context.data?.uploaded_filename) ||
        Boolean(draft?.candidate_id),
  );
  const videoTimeFromClipTime = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    if (renderedPreviewUrl) return safeTime;
    if (videoSegments.length === 0) return 0;
    const segment = getActiveVideoSegment(videoSegments, safeTime);
    if (!segment) return 0;
    return resolveVideoSourceTime(segment, safeTime);
  };
  const audioTimeFromClipTime = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    if (audioSegments.length === 0) return null;
    const currentAudioSpeed = audioExtracted
      ? Math.max(0.5, Math.min(2.0, audioSettings.speed || 1.0))
      : videoSpeed;
    const segment = audioSegments.find(
      (item) => safeTime >= item.start && safeTime < item.end - 0.001,
    );
    if (!segment) return null;
    const relativeTime = Math.max(0, safeTime - segment.start);
    const sourceOffset = relativeTime * currentAudioSpeed;
    return Math.min(segment.sourceEnd, segment.sourceStart + sourceOffset);
  };
  const syncExtractedPreviewAudio = (
    clipTime: number,
    shouldPlay: boolean,
    isSeeking = false,
  ) => {
    if (!audioExtracted || renderedPreviewUrl || audioTrackDeleted) {
      if (previewAudioRef.current && !previewAudioRef.current.paused) {
        previewAudioRef.current.pause();
      }
      return;
    }
    const audio = previewAudioRef.current;
    if (!audio) return;
    const sourceTime = audioTimeFromClipTime(clipTime);
    audio.muted = audioSettings.muted;
    const speed = Math.max(0.5, Math.min(2.0, audioSettings.speed || 1.0));
    if (audio.playbackRate !== speed) {
      audio.playbackRate = speed;
    }
    let fadeFactor = 1.0;
    if (audioSettings.fade_in && audioSettings.fade_in > 0 && clipTime < audioSettings.fade_in) {
      fadeFactor = Math.max(0, clipTime / audioSettings.fade_in);
    }
    const remainingTime = clipDuration - clipTime;
    if (audioSettings.fade_out && audioSettings.fade_out > 0 && remainingTime < audioSettings.fade_out) {
      fadeFactor = Math.min(fadeFactor, Math.max(0, remainingTime / audioSettings.fade_out));
    }
    const targetVolume = audioSettings.muted ? 0 : Math.min(1, Math.max(0, audioSettings.volume * fadeFactor));
    if (audio.volume !== targetVolume) {
      audio.volume = targetVolume;
    }

    if (sourceTime === null || clipTime >= audioLayout.duration) {
      if (!audio.paused) audio.pause();
      return;
    }

    if (isSeeking) {
      audio.currentTime = sourceTime;
    } else {
      const drift = Math.abs(audio.currentTime - sourceTime);
      const DRIFT_TOLERANCE = 0.25;
      if (drift > DRIFT_TOLERANCE) {
        audio.currentTime = sourceTime;
      }
    }

    if (shouldPlay && !audioSettings.muted && targetVolume > 0) {
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
    } else if (!shouldPlay || audioSettings.muted || targetVolume === 0) {
      if (!audio.paused) {
        audio.pause();
      }
    }
  };
  const syncAdditionalAudioTracks = (
    clipTime: number,
    shouldPlay: boolean,
    isSeeking = false,
  ) => {
    if (renderedPreviewUrl) {
      activeAudioElementsRef.current.forEach((el) => {
        if (!el.paused) el.pause();
      });
      return;
    }
    const currentTrackIds = new Set(additionalAudioTracks.map((t) => t.id));
    for (const [id, el] of activeAudioElementsRef.current.entries()) {
      if (!currentTrackIds.has(id)) {
        el.pause();
        el.src = "";
        activeAudioElementsRef.current.delete(id);
      }
    }

    additionalAudioTracks.forEach((track) => {
      const trackSpeed = Math.max(0.5, Math.min(2.0, track.speed || 1.0));
      const baseDuration = track.base_duration || Math.max(0.1, track.end - track.start);
      const effectiveDuration = baseDuration / trackSpeed;
      const effectiveEnd = track.start + effectiveDuration;
      const isWithinTrack = clipTime >= track.start && clipTime <= effectiveEnd;
      const isSeedSfx = track.asset_id.startsWith("sfx-");
      const isSeedMusic = track.asset_id.startsWith("mus-");
      const isTrackMuted = Boolean(track.muted);
      const baseVol = isTrackMuted ? 0 : Math.min(2, Math.max(0, track.volume ?? 1));

      let fadeFactor = 1.0;
      if (isWithinTrack && baseVol > 0) {
        const offset = clipTime - track.start;
        const remaining = effectiveEnd - clipTime;
        if (track.fade_in && track.fade_in > 0 && offset < track.fade_in) {
          fadeFactor = Math.max(0, offset / track.fade_in);
        }
        if (track.fade_out && track.fade_out > 0 && remaining < track.fade_out) {
          fadeFactor = Math.min(fadeFactor, Math.max(0, remaining / track.fade_out));
        }
      }
      const effectiveVol = Math.min(1, Math.max(0, baseVol * fadeFactor));

      if (isSeedSfx) {
        if (shouldPlay && isWithinTrack && effectiveVol > 0) {
          if (!lastTriggeredSfxRef.current.has(track.id) && clipTime - track.start < 0.25) {
            playSynthesizedSound(sfxIdToSoundType(track.asset_id), effectiveVol);
            lastTriggeredSfxRef.current.add(track.id);
          }
        } else if (clipTime < track.start || clipTime > effectiveEnd) {
          lastTriggeredSfxRef.current.delete(track.id);
        }
      } else if (isSeedMusic) {
        if (shouldPlay && isWithinTrack && effectiveVol > 0) {
          if (!lastTriggeredSfxRef.current.has(track.id) && clipTime - track.start < 0.25) {
            playSynthesizedSound("music_preview", effectiveVol * 0.6);
            lastTriggeredSfxRef.current.add(track.id);
          }
        } else if (clipTime < track.start || clipTime > effectiveEnd) {
          lastTriggeredSfxRef.current.delete(track.id);
        }
      } else {
        let audioEl = activeAudioElementsRef.current.get(track.id);
        if (!audioEl) {
          audioEl = new Audio(uploadedAudioUrl(transformationId, track.asset_id));
          audioEl.preload = "auto";
          activeAudioElementsRef.current.set(track.id, audioEl);
        }
        audioEl.muted = isTrackMuted || effectiveVol === 0;
        if (audioEl.volume !== effectiveVol) {
          audioEl.volume = effectiveVol;
        }
        audioEl.loop = Boolean(track.loop);
        if (audioEl.playbackRate !== trackSpeed) {
          audioEl.playbackRate = trackSpeed;
        }

        const trackOffset = Math.max(0, (clipTime - track.start) * trackSpeed);
        if (isWithinTrack && shouldPlay && effectiveVol > 0) {
          if (isSeeking) {
            audioEl.currentTime = trackOffset;
          } else {
            const drift = Math.abs(audioEl.currentTime - trackOffset);
            const DRIFT_TOLERANCE = 0.25;
            if (drift > DRIFT_TOLERANCE) {
              audioEl.currentTime = trackOffset;
            }
          }
          if (audioEl.paused) {
            void audioEl.play().catch(() => {});
          }
        } else {
          if (!audioEl.paused) {
            audioEl.pause();
          }
          if (isSeeking && isWithinTrack) {
            audioEl.currentTime = trackOffset;
          }
        }
      }
    });
  };
  previewPlayingRef.current = previewPlaying;

  const setPreviewTimeFromVideo = (_videoTime: number) => {
    if (timelineDraggingRef.current) return;
    // When playback is paused or scrubbing, user interaction is the sole authority on previewTime.
    // Video timeupdate while paused must never overwrite user-positioned playhead.
    if (!previewPlayingRef.current) {
      return;
    }
  };
  const handleVideoSeeked = (videoTime: number) => {
    if (timelineDraggingRef.current) return;
    const clipTime = clipTimeFromVideoTime(videoTime);
    if (previewPlayingRef.current) {
      previewTimeRef.current = clipTime;
      setPreviewTime(clipTime);
    }
    const isPlaying = previewPlayingRef.current;
    syncExtractedPreviewAudio(previewTimeRef.current, isPlaying, true);
    syncAdditionalAudioTracks(previewTimeRef.current, isPlaying, true);
  };
  const seekPreviewTo = (clipTime: number) => {
    const safeTime = clampClipTime(clipTime);
    const video = previewVideoRef.current;
    previewTimeRef.current = safeTime;
    setPreviewTime(safeTime);
    if (video) {
      if (safeTime < videoLayout.duration) {
        const targetVideoTime = videoTimeFromClipTime(safeTime);
        if (Math.abs(video.currentTime - targetVideoTime) > 0.05) {
          video.currentTime = targetVideoTime;
        }
      } else {
        const lastSegment = videoSegments[videoSegments.length - 1];
        if (lastSegment) {
          video.currentTime = lastSegment.sourceEnd;
        }
      }
    }
    const isPlaying = previewPlayingRef.current;
    syncExtractedPreviewAudio(safeTime, isPlaying, true);
    syncAdditionalAudioTracks(safeTime, isPlaying, true);
  };
  const stopPreviewClock = () => {
    if (previewClockFrameRef.current !== null) {
      window.cancelAnimationFrame(previewClockFrameRef.current);
      previewClockFrameRef.current = null;
    }
  };
  const startPreviewClock = () => {
    stopPreviewClock();
    previewClockLastUpdateRef.current = performance.now();
    const updateClock = (timestamp: number) => {
      if (timelineDraggingRef.current || !previewPlayingRef.current) {
        return;
      }

      if (previewTimeRef.current >= clipDuration) {
        handlePreviewPause();
        return;
      }

      const delta = (timestamp - previewClockLastUpdateRef.current) / 1000;
      previewClockLastUpdateRef.current = timestamp;

      if (delta > 0) {
        const nextClipTime = Math.min(clipDuration, previewTimeRef.current + delta * videoSpeed);
        previewTimeRef.current = nextClipTime;
        setPreviewTime(nextClipTime);

        // Keep video element synced with global timeline time
        if (previewVideoRef.current && !previewVideoRef.current.seeking) {
          const targetVideoTime = videoTimeFromClipTime(nextClipTime);
          const currentVideoTime = previewVideoRef.current.currentTime;
          if (Math.abs(currentVideoTime - targetVideoTime) > 0.35) {
            previewVideoRef.current.currentTime = targetVideoTime;
          }
          if (previewVideoRef.current.paused && nextClipTime < videoLayout.duration) {
            void previewVideoRef.current.play().catch(() => undefined);
          }
        }

        syncExtractedPreviewAudio(nextClipTime, true, false);
        syncAdditionalAudioTracks(nextClipTime, true, false);

        if (import.meta.env.DEV) {
          const activeSeg = getActiveVideoSegment(videoSegments, nextClipTime);
          const localCalculatedTime = videoTimeFromClipTime(nextClipTime);
          console.log("[video_playback_state]", {
            isPlaying: previewPlayingRef.current,
            currentTime: Number(nextClipTime.toFixed(3)),
            localCalculatedTime: Number(localCalculatedTime.toFixed(3)),
            readyState: previewVideoRef.current?.readyState,
          });
          console.log("[multi_video_playback_tick]", {
            previewTime: Number(nextClipTime.toFixed(3)),
            clipDuration,
            activeSegmentId: activeSeg?.id,
            activeAssetId: activeSeg?.asset_id,
            activeSegmentStart: activeSeg?.start,
            activeSegmentEnd: activeSeg?.end,
            isPlaying: true,
          });
        }

        if (nextClipTime >= clipDuration) {
          handlePreviewPause();
          return;
        }
      }

      previewClockFrameRef.current = window.requestAnimationFrame(updateClock);
    };
    previewClockFrameRef.current = window.requestAnimationFrame(updateClock);
  };
  const handlePreviewPlay = () => {
    if (clipDuration <= 0.05) return;
    if (previewTime >= clipDuration - 0.05) {
      seekPreviewTo(0);
    }
    setPreviewPlaying(true);
    previewPlayingRef.current = true;
    if (previewVideoRef.current) {
      const clamped = Math.max(0.25, Math.min(4.0, videoSpeed || 1.0));
      if (previewVideoRef.current.playbackRate !== clamped) {
        previewVideoRef.current.playbackRate = clamped;
      }
      if (previewVideoRef.current.paused) {
        void previewVideoRef.current.play().catch(() => undefined);
      }
    }
    startPreviewClock();
    syncExtractedPreviewAudio(previewTime, true, false);
    syncAdditionalAudioTracks(previewTime, true, false);
  };
  const handlePreviewPause = () => {
    if (import.meta.env.DEV) {
      console.log("[preview_pause_requested]", {
        preview_time: previewTimeRef.current,
        active_segment_id: activeVideoSegment?.id,
        previewPlayingRef_before: previewPlayingRef.current,
        raf_active: previewClockFrameRef.current !== null,
      });
    }
    setPreviewPlaying(false);
    previewPlayingRef.current = false;
    stopPreviewClock();
    if (previewVideoRef.current && !previewVideoRef.current.paused) {
      previewVideoRef.current.pause();
    }
    if (previewAudioRef.current && !previewAudioRef.current.paused) {
      previewAudioRef.current.pause();
    }
    syncAdditionalAudioTracks(previewTimeRef.current, false, false);
    if (import.meta.env.DEV) {
      console.log("[preview_pause_applied]", {
        preview_time: previewTimeRef.current,
        previewPlayingRef_after: previewPlayingRef.current,
        video_paused: previewVideoRef.current?.paused,
      });
    }
  };
  const handleVideoEnded = () => {
    if (timelineDraggingRef.current) return;
    const nextSeg = activeVideoSegment ? getNextVideoSegment(videoSegments, activeVideoSegment.id) : null;
    if (import.meta.env.DEV) {
      console.log("[video_element_ended]", {
        segmentId: activeVideoSegment?.id,
        assetId: activeVideoSegment?.asset_id,
        isLastSegment: !nextSeg,
        nextSegmentId: nextSeg?.id,
        action: nextSeg && previewTimeRef.current < clipDuration ? "continue" : "stop",
      });
    }
    if (nextSeg && previewTimeRef.current < clipDuration - 0.05) {
      previewTimeRef.current = nextSeg.start;
      setPreviewTime(nextSeg.start);
      return;
    }
    if (previewTimeRef.current >= clipDuration - 0.05) {
      handlePreviewPause();
    }
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
    if (import.meta.env.DEV && track === "video") {
      console.log("[autosave_video_sequence]", sequence.map((segment) => ({
        segment_id: segment.id,
        start: segment.start,
        end: segment.end,
        source_start: segment.sourceStart,
        source_end: segment.sourceEnd,
        duration: segment.duration ?? effectiveMediaDuration(segment),
      })));
    }
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
                start: segment.start == null ? undefined : Number(segment.start.toFixed(3)),
                end: segment.end == null ? undefined : Number(segment.end.toFixed(3)),
                duration: Number((segment.duration ?? effectiveMediaDuration(segment)).toFixed(3)),
                speed: Number((segment.speed ?? 1).toFixed(2)),
                asset_id: segment.asset_id || undefined,
                name: segment.name || undefined,
                source_url: segment.source_url || (segment as Record<string, unknown>).sourceUrl || undefined,
                source_path: segment.source_path || (segment as Record<string, unknown>).sourcePath || undefined,
                locked: segment.locked || undefined,
                visible: segment.visible !== undefined ? segment.visible : undefined,
                muted: segment.muted || undefined,
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
    if (item.locked || isItemIdLocked(item.id)) return;
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
    const timelinePoint = Math.max(0, ratio * resize.scaleDuration);
    const minimumDuration = 0.5;
    const nextSequence = resize.sequence.map((segment) => ({ ...segment }));
    let segment = nextSequence[resize.segmentIndex];
    const timelineStart = resize.sequence
      .slice(0, resize.segmentIndex)
      .reduce((total, item) => total + effectiveMediaDuration(item), 0);
    const originalTimelineEnd = timelineStart + effectiveMediaDuration(segment);
    const originalSegment = { ...segment };

    if (resize.edge === "left") {
      const newDuration = Math.max(minimumDuration, originalTimelineEnd - timelinePoint);
      const speed = Math.max(0.25, Number(segment.speed) || 1);
      segment.sourceStart = Number(Math.max(0, segment.sourceEnd - newDuration * speed).toFixed(3));
    } else {
      const assetDuration = segment.asset_id
        ? (editorMediaQuery.data || []).find((asset) => asset.asset_id === segment.asset_id)?.duration_seconds
        : undefined;
      segment = trimMediaSegmentRight(
        segment,
        timelineStart,
        timelinePoint,
        assetDuration,
        minimumDuration,
      );
      nextSequence[resize.segmentIndex] = segment;
    }
    let nextOffset = 0;
    nextSequence.forEach((item) => {
      const itemDuration = effectiveMediaDuration(item);
      item.start = Number(nextOffset.toFixed(3));
      item.end = Number((nextOffset + itemDuration).toFixed(3));
      item.duration = Number(itemDuration.toFixed(3));
      item.speed = Math.max(0.25, Number(item.speed) || 1);
      nextOffset += itemDuration;
    });
    const durationDelta =
      effectiveMediaDuration(segment) - effectiveMediaDuration(originalSegment);
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
    if (import.meta.env.DEV && resize.edge === "right") {
      console.log("[trim_segment_update]", {
        segment_id: segment.id,
        old_end: originalTimelineEnd,
        new_end: segment.end,
        old_source_end: originalSegment.sourceEnd,
        new_source_end: segment.sourceEnd,
        duration: segment.duration,
      });
    }
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
        (total, segment) => total + effectiveMediaDuration(segment),
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
    if (!item.eventId || item.locked || isItemIdLocked(item.eventId)) return;
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
    if (resize.kind === "caption") {
      updateCaptionTimeline(
        editableCaptionCues.map((item) => (item.id !== resize.id ? item : {
          ...item,
          start: resize.edge === "left" ? Math.min(item.end - 0.1, Math.max(0, targetTime)) : item.start,
          end: resize.edge === "left" ? item.end : Math.max(item.start + 0.1, Math.min(clipDuration, targetTime)),
        })),
        false,
      );
    } else {
      updateEffectTimeline(
        editableEffectTimeline.map((item) => (item.id !== resize.id ? item : {
          ...item,
          start: resize.edge === "left" ? Math.min(item.end - 0.1, Math.max(0, targetTime)) : item.start,
          end: resize.edge === "left" ? item.end : Math.max(item.start + 0.1, Math.min(clipDuration, targetTime)),
        })),
        false,
      );
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
    const activeSpeed = activeMediaTrack === "audio" ? (audioSettings.speed || 1.0) : videoSpeed;
    const sourcePoint = segment.sourceStart + (previewTime - segment.start) * activeSpeed;
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
    const activeSpeed = activeMediaTrack === "audio" ? (audioSettings.speed || 1.0) : videoSpeed;
    const nextSequence = mediaSegments.flatMap((segment) => {
      if (segment.end <= previewTime) return [];
      if (segment.start >= previewTime) return [{
        id: segment.id,
        sourceStart: segment.sourceStart,
        sourceEnd: segment.sourceEnd,
      }];
      return [{
        id: segment.id,
        sourceStart: segment.sourceStart + (previewTime - segment.start) * activeSpeed,
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
    const activeSpeed = activeMediaTrack === "audio" ? (audioSettings.speed || 1.0) : videoSpeed;
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
        sourceEnd: segment.sourceStart + (previewTime - segment.start) * activeSpeed,
      }];
    });
    const nextEvents = configuredEffectTimeline
      .filter((event) => event.start < previewTime)
      .map((event) => ({ ...event, end: Math.min(previewTime, event.end) }))
      .filter((event) => event.end > event.start);
    commitMediaSequence(nextSequence, nextEvents);
    setSelectedMediaSegmentId(null);
    setPreviewTime(Math.min(previewTime, nextSequence.reduce(
      (total, segment) => total + (segment.sourceEnd - segment.sourceStart) / activeSpeed,
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
    const reflowed = reflowCaptionCue(sourceCue, usedIds, MAX_CAPTION_WORDS);
    const nextCues = editableCaptionCues.flatMap((cue) =>
      cue.id === selectedCaption.id ? reflowed : [cue],
    );
    updateCaptionTimeline(nextCues);
    setSelectedCaptionId(reflowed[0].id);
    setMessage(
      reflowed.length > 1
        ? `Caption dipecah menjadi ${reflowed.length} cue (maksimal ${MAX_CAPTION_WORDS} kata).`
        : `Caption sudah maksimal ${MAX_CAPTION_WORDS} kata.`,
    );
  };
  const reflowAllCaptions = () => {
    const sourceCues = editableCaptionCues;
    const usedIds = new Set(sourceCues.map((cue) => cue.id));
    const nextCues = sourceCues.flatMap((cue) =>
      reflowCaptionCue(cue, usedIds, MAX_CAPTION_WORDS),
    );
    updateCaptionTimeline(nextCues);
    setMessage(
      `Semua caption dirapikan menjadi ${nextCues.length} cue (maksimal ${MAX_CAPTION_WORDS} kata).`,
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
      const selectedSeg = mediaSegments.find((s) => s.id === selectedMediaSegmentId);
      if (selectedSeg?.locked || (activeMediaTrack === "video" ? styleConfig.video_locked : styleConfig.audio_locked)) {
        setTimelineError("Item media sedang dikunci.");
        return;
      }
      splitSelectedMedia();
      return;
    }
    if (selectedCaption && selectedCaption.locked) {
      setTimelineError("Caption sedang dikunci.");
      return;
    }
    if (selectedEvent && selectedEvent.locked) {
      setTimelineError("Event sedang dikunci.");
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
          ? [{ ...cue, end: previewTime }, { ...cue, id: rightId, start: previewTime, locked: false }]
          : [cue],
      ));
      setSelectedCaptionId(rightId);
    } else if (selectedEvent) {
      const rightId = newEventId();
      updateEffectTimeline(editableEffectTimeline.flatMap((event) =>
        event.id === selectedEvent.id
          ? [{ ...event, end: previewTime }, { ...event, id: rightId, start: previewTime, locked: false }]
          : [event],
      ));
      setSelectedEventId(rightId);
    }
  };
  const trimSelectedTimedItem = (edge: "left" | "right") => {
    if (selectedCaption && selectedCaption.locked) {
      setTimelineError("Caption sedang dikunci.");
      return;
    }
    if (selectedEvent && selectedEvent.locked) {
      setTimelineError("Event sedang dikunci.");
      return;
    }
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
    if (mediaTrackSelected) {
      const selectedSeg = mediaSegments.find((s) => s.id === selectedMediaSegmentId);
      if (selectedSeg?.locked || (activeMediaTrack === "video" ? styleConfig.video_locked : styleConfig.audio_locked)) {
        setTimelineError("Item media sedang dikunci.");
        return;
      }
      deleteMediaLeft();
    } else {
      trimSelectedTimedItem("left");
    }
  };
  const deleteRightSelectedTrack = () => {
    if (mediaTrackSelected) {
      const selectedSeg = mediaSegments.find((s) => s.id === selectedMediaSegmentId);
      if (selectedSeg?.locked || (activeMediaTrack === "video" ? styleConfig.video_locked : styleConfig.audio_locked)) {
        setTimelineError("Item media sedang dikunci.");
        return;
      }
      deleteMediaRight();
    } else {
      trimSelectedTimedItem("right");
    }
  };
  const deleteSelectedTrackItem = () => {
    if (selectedAdditionalAudioTrack) {
      if (selectedAdditionalAudioTrack.locked) {
        setTimelineError("Track audio sedang dikunci.");
        return;
      }
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
      if (selected.locked || (activeMediaTrack === "video" ? styleConfig.video_locked : styleConfig.audio_locked)) {
        setTimelineError("Item media sedang dikunci.");
        return;
      }
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
                  start: Math.max(0, event.start - removedDuration),
                  end: Math.max(0, event.end - removedDuration),
                };
              }
              return {
                ...event,
                end: Math.max(event.start, event.end - removedDuration),
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
      if (selectedCaption.locked) {
        setTimelineError("Caption terpilih sedang dikunci.");
        return;
      }
      updateCaptionTimeline(editableCaptionCues.filter((cue) => cue.id !== selectedCaption.id));
      setSelectedCaptionId(null);
      setMessage("Caption terpilih dihapus.");
      return;
    }
    if (selectedEvent) {
      if (selectedEvent.locked) {
        setTimelineError("Event terpilih sedang dikunci.");
        return;
      }
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
    Math.max(180, Math.min(value, Math.max(230, window.innerHeight - 260)));
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
    handlePreviewPause();
    timelineDraggingRef.current = true;
    const target = timelineTimeFromPointer(event);
    setTimelineHover(target);
    seekPreviewTo(target.time);
  };
  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = timelineTimeFromPointer(event);
    setTimelineHover(target);
    if (timelineDraggingRef.current) {
      if (previewPlayingRef.current) {
        handlePreviewPause();
      }
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
    if (!item.eventId || item.locked || isItemIdLocked(item.eventId)) return;
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
      setAudioInspectorTab("audio");
      return;
    }
    setSelectedAdditionalAudioTrackId(null);
    if (item.type === "video" || item.type === "audio") {
      setSelectedEventId(null);
      setSelectedCaptionId(null);
      setSelectedMediaSegmentId(item.id);
      setSelectedEditorContext(item.type);
      if (item.type === "video") {
        setVideoInspectorTab("video");
      } else {
        setAudioInspectorTab("audio");
      }
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
      setCaptionInspectorTab("captions");
      return;
    }
    setSelectedCaptionId(null);
    setSelectedMediaSegmentId(null);
    if (item.eventId) {
      setSelectedEventId(item.eventId);
      const nextContext = contextFromEventType(item.type);
      setSelectedEditorContext(nextContext);
      if (nextContext === "hook" || nextContext === "keyword") {
        setTextInspectorTab("text");
      } else if (nextContext === "effect") {
        setEffectInspectorTab("effect");
      }
      return;
    }
    setSelectedEventId(null);
    const nextContext = contextFromEventType(item.type);
    setSelectedEditorContext(nextContext);
    if (nextContext === "hook" || nextContext === "keyword") {
      setTextInspectorTab("text");
    } else if (nextContext === "effect") {
      setEffectInspectorTab("effect");
    }
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
    const effectiveKey =
      track === "caption" || track === "hook" || track === "keyword"
        ? "text"
        : track === "punch" || track === "pattern"
        ? "overlay"
        : track;
    const index = trackOrder.indexOf(effectiveKey);
    const safeIndex = index >= 0 ? index : defaultTrackOrder.indexOf(effectiveKey);
    return {
      order: safeIndex >= 0 ? safeIndex : 0,
      canMoveUp: safeIndex > 0,
      canMoveDown: safeIndex >= 0 && safeIndex < trackOrder.length - 1,
      onMoveUp: () => moveTimelineTrack(effectiveKey, -1),
      onMoveDown: () => moveTimelineTrack(effectiveKey, 1),
    };
  };
  const previewModeText = renderedPreviewAvailable
    ? "Preview file hasil export."
    : renderDirty
      ? "Live Preview dari perubahan editor."
      : "Preview sumber sebelum export.";
  const currentRenderLabel = renderLabel(activeRender, renderedPreviewAvailable);
  const exportIsHd = exportResolution !== "540";
  const expectedExportWidth = exportResolution === "540" ? 540 : exportResolution === "720" ? 720 : 1080;
  const exportMatchesRequestedResolution = Boolean(
    exportResultRender?.status === "completed" &&
    exportResultRender.output_url &&
    Math.abs((exportResultRender.width || 0) - expectedExportWidth) < 50,
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
    ? `${downloadUrl(exportResultRender.id)}?render_id=${exportResultRender.id}&v=${exportResultRender.manifest_hash || exportResultRender.id}-${exportResultRender.file_size_bytes || 0}&t=${Date.now()}&output_filename=${encodeURIComponent(exportDownloadFilename)}`
    : null;
  const startExport = () => {
    if (!canStartExport || queueRender.isPending || toolbarExportBusy) return;
    setExportTechnicalOpen(false);
    setExportWasClosedDuringTask(false);
    setExportValidatedRenderId(null);
    setMessage(toolbarUnsaved ? "Menyimpan perubahan sebelum export..." : "Menyiapkan file...");
    setExportAwaitingHd(false);
    queueRender.mutate(exportResolution === "540");
  };
  const playheadPercent = Math.min(
    100,
    Math.max(0, (previewTime / Math.max(1, timelineScaleDuration)) * 100),
  );
  const tickStep = (() => {
    if (timelineZoomPercent <= 25) return timelineScaleDuration > 30 ? 15 : 10;
    if (timelineZoomPercent <= 50) return timelineScaleDuration > 45 ? 15 : 10;
    if (timelineZoomPercent <= 100) return timelineScaleDuration > 45 ? 10 : 5;
    if (timelineZoomPercent <= 200) return timelineScaleDuration > 45 ? 5 : 2;
    return timelineScaleDuration > 45 ? 2 : 1;
  })();
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
    !renderedPreviewUrl && livePunchEvent && livePunchEvent.visible !== false
      ? {
          transform: `scale(${livePunchEvent.zoom || 1.08})`,
          transition: "transform 160ms ease-out",
          transformOrigin: "center center",
        }
      : undefined;
  const toggleLeftSection = (id: string) =>
    setOpenLeftSection((current) => (current === id ? null : id));
  const captionSummary = draft.social_caption
    ? `${draft.social_caption.slice(0, 64).trim()}${
        draft.social_caption.length > 64 ? "..." : ""
      }`
    : "Deskripsi belum tersedia";
  const availableNavTabs: Array<{ id: EditorNavTab; label: string; icon: string }> = [
    { id: "media" as const, label: "Media", icon: "📁" },
    { id: "audio" as const, label: "Audio", icon: "🎵" },
    { id: "text" as const, label: "Text", icon: "T" },
    { id: "stickers" as const, label: "Stickers", icon: "😀" },
    { id: "transitions" as const, label: "Transitions", icon: "⇄" },
    { id: "effects" as const, label: "Effects", icon: "✦" },
    { id: "caption" as const, label: "Captions", icon: "💬" },
    { id: "templates" as const, label: "Templates", icon: "📐" },
    ...(!manualEditorMode ? [{ id: "autoclip" as const, label: "AutoClip", icon: "✨" }] : []),
  ];
  const inspectorContext: "details" | "video" | "audio" | "caption" | "hook" | "keyword" | "effect" =
    selectedEvent
      ? selectedEvent.type === "keyword_popup"
        ? "keyword"
        : selectedEvent.type === "hook_text"
        ? "hook"
        : "effect"
      : selectedCaption
      ? "caption"
      : anyTrackSelected && selectedEditorContext === "video"
      ? "video"
      : anyTrackSelected && selectedEditorContext === "audio"
      ? "audio"
      : selectedEditorContext === "hook"
      ? "hook"
      : selectedEditorContext === "keyword"
      ? "keyword"
      : selectedEditorContext === "caption"
      ? "caption"
      : selectedEditorContext === "effect"
      ? "effect"
      : "details";

  return (
    <div className={`editor-workspace flex min-h-[calc(100vh-50px)] flex-col rounded-xl border border-zinc-800 bg-[#151719] shadow-2xl shadow-black/30 xl:h-[calc(100vh-50px)] xl:min-h-[580px] xl:overflow-hidden ${
      editorTheme === "light" ? "editor-theme-light" : "editor-theme-dark"
    }`}>
      {/* 1. TOP ROW BAR (Left Source Tabs | Center Info | Right Inspector Tabs) */}
      <div className="grid h-9 shrink-0 border-b border-zinc-800/90 bg-[#16181b] z-20 xl:grid-cols-[360px_minmax(400px,1fr)_330px] items-center">
        {/* Left Cell: Source / Library Tabs with Arrow Navigation (CapCut style) */}
        <SourceNavTabStrip
          tabs={availableNavTabs}
          activeTab={activeNavTab}
          onSelectTab={setActiveNavTab}
        />

        {/* Center Cell: Preview Editor Title (Aligned with Top Tabs) */}
        <div className="hidden items-center justify-center gap-2 px-3 xl:flex">
          <span
            className="text-xs font-bold uppercase tracking-wider text-zinc-400 cursor-default"
            title={`${currentRenderLabel} • ${previewModeText}`}
          >
            Preview Editor
          </span>
        </div>

        {/* Right Cell: Inspector Sub-Tabs (Aligned Horizontally with Source Tabs) */}
        <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar px-3 py-0.5 border-l border-zinc-800/40 xl:border-l-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {inspectorContext === "details" ? (
              <span className="relative pb-1 text-xs font-bold text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full whitespace-nowrap">
                Details
              </span>
            ) : inspectorContext === "video" ? (
              (
                [
                  { id: "video", label: "Video" },
                  { id: "adjust", label: "Adjust" },
                  { id: "speed", label: "Speed" },
                  { id: "audio", label: "Audio" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVideoInspectorTab(tab.id)}
                  className={`relative pb-1 text-xs font-bold transition whitespace-nowrap px-1 ${
                    videoInspectorTab === tab.id
                      ? "text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))
            ) : inspectorContext === "audio" ? (
              (
                [
                  { id: "audio", label: "Audio", title: "Pengaturan audio dasar" },
                  { id: "fade", label: "Fade", title: "Fade In & Fade Out" },
                  { id: "speed", label: "Speed", title: "Kecepatan Audio" },
                  { id: "timing", label: "Timing", title: "Durasi & Posisi Audio" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.title}
                  onClick={() => setAudioInspectorTab(tab.id)}
                  className={`relative pb-1 text-xs font-bold transition whitespace-nowrap px-1 ${
                    audioInspectorTab === tab.id
                      ? "text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))
            ) : inspectorContext === "hook" || inspectorContext === "keyword" ? (
              (
                selectedEvent?.reason?.toLowerCase().includes("sticker")
                  ? ([
                      { id: "text", label: "Sticker", title: "Sticker" },
                      { id: "animation", label: "Animation", title: "Animation" },
                    ] as const)
                  : ([
                      { id: "text", label: "Text", title: "Text" },
                      { id: "animation", label: "Animation", title: "Animation" },
                      { id: "tracking", label: "Tracking", title: "Tracking" },
                      { id: "tts", label: "TTS", title: "Text to speech" },
                    ] as const)
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.title}
                  onClick={() => setTextInspectorTab(tab.id)}
                  className={`relative pb-1 text-xs font-bold transition whitespace-nowrap px-1 ${
                    textInspectorTab === tab.id
                      ? "text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))
            ) : inspectorContext === "caption" ? (
              (
                [
                  { id: "captions", label: "Captions", title: "Captions" },
                  { id: "text", label: "Text", title: "Text Style & Templates" },
                  { id: "animation", label: "Animation", title: "Animation" },
                  { id: "tracking", label: "Tracking", title: "Tracking" },
                  { id: "tts", label: "TTS", title: "Text to speech" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.title}
                  onClick={() => setCaptionInspectorTab(tab.id)}
                  className={`relative pb-1 text-xs font-bold transition whitespace-nowrap px-1 ${
                    captionInspectorTab === tab.id
                      ? "text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))
            ) : inspectorContext === "effect" ? (
              (
                [
                  {
                    id: "effect",
                    label: selectedEvent?.reason?.startsWith("transition")
                      ? "Transition"
                      : "Effect",
                  },
                  { id: "timing", label: "Timing" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setEffectInspectorTab(tab.id)}
                  className={`relative pb-1 text-xs font-bold transition whitespace-nowrap px-1 ${
                    effectInspectorTab === tab.id
                      ? "text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))
            ) : (
              <span className="relative pb-1 text-xs font-bold text-cyan-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-cyan-400 after:rounded-full whitespace-nowrap">
                Details
              </span>
            )}
          </div>

          {/* Subtle Mini Autosave Indicator Dot */}
          <div
            className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-zinc-400 pl-1"
            title={editorSaveStatusTitle}
          >
            <span
              className={`size-1.5 rounded-full ${
                editorSaveStatusClass.includes("emerald")
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                  : editorSaveStatusClass.includes("amber")
                  ? "bg-amber-400 animate-pulse"
                  : "bg-zinc-500"
              }`}
            />
          </div>
        </div>
      </div>

      {/* 2. MIDDLE 3-PANEL GRID */}
      {/* 2. MIDDLE 3-PANEL GRID */}
      <div className="grid min-h-0 flex-1 gap-px bg-zinc-800 xl:grid-cols-[360px_minmax(400px,1fr)_330px] xl:items-stretch overflow-hidden">
        {/* LEFT SOURCE PANEL (Input / Library / Preset / Add Asset) */}
        <aside className="editor-sidepanel min-h-0 bg-[#17191c] xl:h-full xl:overflow-hidden flex flex-col">
          {/* TAB A: AUTOCLIP (Hanya AutoClip Mode) */}
          {activeNavTab === "autoclip" && !manualEditorMode && (
            <div className="p-3.5 space-y-3 overflow-y-auto custom-scrollbar flex-1">
              <div>
                <h2 className="text-sm font-black text-slate-950 uppercase tracking-wide text-cyan-400">
                  Ringkasan Klip (AutoClip AI)
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">Hasil ekstraksi otomatis kandidat klip AI.</p>
              </div>

              <div className="space-y-2">
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
                    <label className="mb-0" htmlFor="hook_text_panel">Hook Pembuka</label>
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
                  id="caption"
                  isOpen={openLeftSection === "caption"}
                  onToggle={toggleLeftSection}
                  summary={captionSummary}
                  title="Deskripsi Posting"
                >
                  <label htmlFor="social_caption">Deskripsi Posting</label>
                  <textarea
                    id="social_caption"
                    rows={5}
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
                  id="metadata"
                  isOpen={openLeftSection === "metadata"}
                  onToggle={toggleLeftSection}
                  summary={`Durasi ${formatTimeLabel(clipDuration)}`}
                  title="Info Kandidat"
                >
                  <div className="space-y-2 text-xs text-zinc-300">
                    <div className="flex justify-between py-1 border-b border-zinc-800">
                      <span className="text-zinc-500">Durasi Klip</span>
                      <span className="font-bold">{formatTime(context.data.clip_start_seconds)} - {formatTime(context.data.clip_end_seconds)} ({formatTimeLabel(clipDuration)})</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-800">
                      <span className="text-zinc-500">Model AI</span>
                      <span className="font-bold">Groq / OpenAI</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-zinc-800">
                      <span className="text-zinc-500">Tipe Konten</span>
                      <span className="font-bold capitalize">{context.data.content_type || "Podcast"}</span>
                    </div>
                    <Link
                      to={`/jobs/${draft.project_id}/clips`}
                      className="btn-secondary mt-2 block w-full py-2 text-center text-xs font-bold text-cyan-300 hover:text-cyan-200"
                    >
                      Lihat Semua Kandidat
                    </Link>
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
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-900/50 bg-violet-950/30 p-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-violet-400">Info Potensi</p>
                      <p className="mt-1 text-xs text-slate-300">
                        {report
                          ? `Transformasi ${report.transformative_value_score.toFixed(0)} / Risiko ${report.copyright_risk_level}`
                          : "Belum dinilai. Jalankan penilaian jika perlu."}
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
                </AccordionSection>
              </div>
            </div>
          )}

          {/* TAB B: MEDIA (CapCut-Style Media Bin & Library) */}
          {activeNavTab === "media" && (
            <LeftPanelDirectoryLayout
              directories={mediaDirectories}
              activeDirectory={mediaDirectory}
              onSelectDirectory={setMediaDirectory}
            >
              <div className="space-y-3">
                {/* 1. TOP TOOLBAR: Import Button, Search Input, and Category Header */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs">
                        {mediaDirectory === "video"
                          ? "🎬"
                          : mediaDirectory === "audio"
                          ? "🎵"
                          : mediaDirectory === "images"
                          ? "🖼️"
                          : mediaDirectory === "import"
                          ? "📥"
                          : "📁"}
                      </span>
                      <span className="text-xs font-black uppercase tracking-wide text-zinc-200 truncate">
                        {mediaDirectory === "project_media"
                          ? "Project Media"
                          : mediaDirectory === "video"
                          ? "Asset Video"
                          : mediaDirectory === "audio"
                          ? "Asset Audio"
                          : mediaDirectory === "images"
                          ? "Asset Gambar"
                          : "Import Media"}
                      </span>
                      <span className="text-[10px] font-bold text-zinc-500">
                        (
                        {(editorMediaQuery.data || []).filter((a) =>
                          mediaDirectory === "video"
                            ? a.kind === "video"
                            : mediaDirectory === "audio"
                            ? a.kind === "audio"
                            : mediaDirectory === "images"
                            ? a.kind === "image"
                            : true,
                        ).length}
                        )
                      </span>
                    </div>

                    {/* Universal Import Button */}
                    <label className="shrink-0 cursor-pointer">
                      <span
                        className={`btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-cyan-400/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-400/25 transition shadow-sm ${
                          editorMediaUploading ? "opacity-50 pointer-events-none" : ""
                        }`}
                        title="Import Video, Audio, atau Gambar ke Media Library"
                      >
                        <span>📥</span>
                        <span>{editorMediaUploading ? "Mengunggah..." : "+ Import"}</span>
                      </span>
                      <input
                        type="file"
                        multiple
                        accept=".mp4,.mov,.webm,.mp3,.wav,.m4a,.png,.jpg,.jpeg,.webp"
                        className="sr-only"
                        disabled={editorMediaUploading}
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0];
                          if (file) {
                            const ext = file.name.split(".").pop()?.toLowerCase() || "";
                            const isAudio = ["mp3", "wav", "m4a"].includes(ext) || file.type.startsWith("audio/");
                            const isImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || file.type.startsWith("image/");
                            const kind: EditorMediaKind = isAudio ? "audio" : isImage ? "image" : "video";
                            void importEditorMedia(kind, file);
                          }
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>

                  {/* Search Bar */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cari media di library..."
                      value={mediaSearch}
                      onChange={(e) => setMediaSearch(e.target.value)}
                      className="w-full text-xs rounded-lg bg-[#202328] border border-zinc-700/70 px-2.5 py-1.5 text-zinc-100 placeholder-zinc-500 focus:border-cyan-400 focus:outline-none"
                    />
                    {mediaSearch && (
                      <button
                        type="button"
                        onClick={() => setMediaSearch("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. DEDICATED IMPORT TAB VIEW (If user specifically clicks Import subtab) */}
                {mediaDirectory === "import" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-dashed border-cyan-500/40 bg-[#1c222b] p-3 text-center space-y-2">
                      <p className="text-xs font-bold text-cyan-300">Pilih Jenis File Media</p>
                      <EditorMediaImportControls
                        className="flex flex-col gap-2"
                        disabled={editorMediaUploading}
                        onImport={importEditorMedia}
                        uploadingKind={editorMediaUploadKind}
                      />
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-[#1e2126] p-2.5 text-[11px] text-zinc-400 space-y-1">
                      <p className="font-bold text-zinc-300">💡 Alur Media Library (CapCut Flow):</p>
                      <p>
                        Media yang diimpor otomatis masuk ke <b>Project Media</b>. Gunakan tombol <b>+</b> pada kartu thumbnail untuk memasukkan media ke timeline edit.
                      </p>
                    </div>
                  </div>
                )}

                {/* 3. CAPCUT-STYLE MEDIA THUMBNAIL GRID */}
                {mediaDirectory !== "import" && (() => {
                  const allAssets = editorMediaQuery.data || [];
                  const categoryFiltered = allAssets.filter((a) =>
                    mediaDirectory === "video"
                      ? a.kind === "video"
                      : mediaDirectory === "audio"
                      ? a.kind === "audio"
                      : mediaDirectory === "images"
                      ? a.kind === "image"
                      : true,
                  );
                  const searchFiltered = mediaSearch
                    ? categoryFiltered.filter((a) => a.name.toLowerCase().includes(mediaSearch.toLowerCase()))
                    : categoryFiltered;

                  if (import.meta.env.DEV) {
                    console.log("[media_grid_render]", {
                      active_tab: mediaDirectory,
                      visible_count: searchFiltered.length,
                    });
                  }

                  if (editorMediaQuery.isLoading) {
                    return (
                      <div className="p-4 text-center text-xs font-semibold text-zinc-400">
                        Memuat media library...
                      </div>
                    );
                  }

                  if (searchFiltered.length === 0) {
                    return (
                      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-5 text-center text-xs text-zinc-400 space-y-2.5">
                        <span className="text-2xl block">📁</span>
                        <p className="font-bold text-zinc-300">
                          {mediaSearch
                            ? "Tidak ada media yang cocok dengan pencarian."
                            : `Belum ada ${mediaDirectory === "video" ? "video" : mediaDirectory === "audio" ? "audio" : mediaDirectory === "images" ? "gambar" : "media"} di library.`}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          Import file media untuk mulai menyusun klip pada timeline.
                        </p>
                        <label className="inline-block cursor-pointer">
                          <span className="btn-secondary px-3 py-1.5 text-xs font-bold text-cyan-300 border-cyan-500/40 hover:bg-cyan-400/20">
                            + Import Media Sekarang
                          </span>
                          <input
                            type="file"
                            multiple
                            accept=".mp4,.mov,.webm,.mp3,.wav,.m4a,.png,.jpg,.jpeg,.webp"
                            className="sr-only"
                            disabled={editorMediaUploading}
                            onChange={(e) => {
                              const file = e.currentTarget.files?.[0];
                              if (file) {
                                const ext = file.name.split(".").pop()?.toLowerCase() || "";
                                const isAudio = ["mp3", "wav", "m4a"].includes(ext) || file.type.startsWith("audio/");
                                const isImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || file.type.startsWith("image/");
                                const kind: EditorMediaKind = isAudio ? "audio" : isImage ? "image" : "video";
                                void importEditorMedia(kind, file);
                              }
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-2 gap-2.5">
                      {searchFiltered.map((asset) => {
                        const isAdded = asset.kind === "video"
                          ? videoSequence.some((s) => s.asset_id === asset.asset_id || s.name === asset.name)
                          : asset.kind === "audio"
                          ? additionalAudioTracks.some((t) => t.asset_id === asset.asset_id)
                          : (styleConfig.editor_image_assets || []).some((img: { id?: string }) => img.id === asset.asset_id);
                        const isSelected = selectedMediaAssetId === asset.asset_id;

                        return (
                          <div
                            key={asset.asset_id}
                            onClick={() => setSelectedMediaAssetId(asset.asset_id)}
                            className={`group relative flex flex-col rounded-xl overflow-hidden border transition cursor-pointer ${
                              isSelected
                                ? "border-cyan-400 ring-2 ring-cyan-400/30 bg-[#1e252e]"
                                : isAdded
                                ? "border-emerald-500/40 bg-[#1b2222] hover:border-emerald-400/60"
                                : "border-zinc-800 bg-[#1c1f24] hover:border-zinc-600 hover:bg-[#22262d]"
                            }`}
                          >
                            {/* Thumbnail / Visual Preview Box */}
                            <div className="relative aspect-video w-full bg-black/60 overflow-hidden flex items-center justify-center">
                              {asset.kind === "video" ? (
                                <video
                                  src={mediaUrl(transformationId, asset.asset_id)}
                                  preload="metadata"
                                  className="w-full h-full object-cover pointer-events-none"
                                  muted
                                />
                              ) : asset.kind === "image" ? (
                                <img
                                  src={mediaUrl(transformationId, asset.asset_id)}
                                  alt={asset.name}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-emerald-950/60 via-zinc-900 to-zinc-950 flex flex-col items-center justify-center gap-1 text-emerald-400">
                                  <span className="text-xl">🎵</span>
                                  <div className="flex items-center gap-0.5 h-3">
                                    <span className="w-0.5 h-2 bg-emerald-400 animate-pulse" />
                                    <span className="w-0.5 h-3 bg-emerald-400 animate-pulse delay-75" />
                                    <span className="w-0.5 h-1.5 bg-emerald-400 animate-pulse delay-150" />
                                    <span className="w-0.5 h-2.5 bg-emerald-400 animate-pulse delay-100" />
                                  </div>
                                </div>
                              )}

                              {/* Duration Badge (Top Right) */}
                              {asset.duration_seconds && asset.duration_seconds > 0 ? (
                                <span className="absolute top-1.5 right-1.5 rounded bg-black/80 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-mono font-bold text-white shadow-sm">
                                  {formatMediaDuration(asset.duration_seconds)}
                                </span>
                              ) : asset.kind === "image" ? (
                                <span className="absolute top-1.5 right-1.5 rounded bg-purple-950/80 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-extrabold text-purple-200">
                                  IMG
                                </span>
                              ) : null}

                              {/* Added Status Badge (Top Left) */}
                              {isAdded && (
                                <span className="absolute top-1.5 left-1.5 rounded bg-emerald-500 px-1.5 py-0.5 text-[8px] font-black text-black shadow-sm flex items-center gap-0.5">
                                  ✓ Added
                                </span>
                              )}

                              {/* Hover Overlay with Quick Action Buttons */}
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[1px]">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (import.meta.env.DEV) {
                                      console.log("[media_card_add_clicked]", {
                                        clicked_asset_id: asset.asset_id,
                                        clicked_filename: asset.name,
                                        clicked_duration: asset.duration_seconds,
                                        selectedMediaAssetId,
                                      });
                                    }
                                    void addEditorMediaToTimeline(asset);
                                  }}
                                  title="Tambah ke timeline"
                                  className="h-8 w-8 rounded-full bg-cyan-400 hover:bg-cyan-300 active:scale-95 text-black flex items-center justify-center font-extrabold text-base shadow-lg transition"
                                >
                                  +
                                </button>
                                {asset.kind !== "image" && (
                                  <a
                                    href={mediaUrl(transformationId, asset.asset_id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Putar preview"
                                    className="h-8 w-8 rounded-full bg-zinc-700/90 hover:bg-zinc-600 active:scale-95 text-white flex items-center justify-center text-xs shadow-lg transition"
                                  >
                                    ▶
                                  </a>
                                )}
                              </div>
                            </div>

                            {/* Card Footer Details (Compact without redundant button) */}
                            <div className="p-2 flex flex-col justify-center">
                              <div className="min-w-0">
                                <span
                                  className="block truncate text-[11px] font-bold text-zinc-100 group-hover:text-cyan-300 transition"
                                  title={asset.name}
                                >
                                  {asset.name}
                                </span>
                                <div className="mt-1 flex items-center justify-between text-[9px] text-zinc-400 font-medium">
                                  <span>{(asset.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                                  <span className="uppercase text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                    {asset.kind}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB C: AUDIO (Audio Library / Add Audio Only) */}
          {activeNavTab === "audio" && (
            <LeftPanelDirectoryLayout
              directories={audioDirectories}
              activeDirectory={audioDirectory}
              onSelectDirectory={setAudioDirectory}
            >
              {audioDirectory === "music" && (
                <div className="space-y-2.5">
                  <div>
                    <input
                      type="text"
                      placeholder="Cari musik latar..."
                      value={audioSearch}
                      onChange={(e) => setAudioSearch(e.target.value)}
                      className="w-full text-xs"
                    />
                  </div>

                  {(() => {
                    const filtered = defaultMusicTracks.filter((track) =>
                      audioSearch
                        ? track.name.toLowerCase().includes(audioSearch.toLowerCase()) ||
                          track.desc.toLowerCase().includes(audioSearch.toLowerCase())
                        : true,
                    );

                    return (
                      <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                          Musik Bawaan ({filtered.length})
                        </p>
                        {filtered.map((track) => (
                          <div
                            key={track.id}
                            className="rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 transition hover:border-zinc-500"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-black text-zinc-100">{track.name}</p>
                                <p className="mt-0.5 text-[10px] text-zinc-400 line-clamp-1">{track.desc}</p>
                              </div>
                              <span className="shrink-0 rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                                {formatTimeLabel(track.duration)}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  if (libraryPreviewAudioId === track.id) {
                                    setLibraryPreviewAudioId(null);
                                  } else {
                                    setLibraryPreviewAudioId(track.id);
                                    playSynthesizedSound("music_preview", 0.75);
                                    setTimeout(() => {
                                      setLibraryPreviewAudioId((cur) => (cur === track.id ? null : cur));
                                    }, 3500);
                                  }
                                }}
                                className={`btn-secondary py-1 px-2 text-[10px] font-bold transition ${
                                  libraryPreviewAudioId === track.id
                                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-400"
                                    : "text-zinc-300 hover:text-cyan-300"
                                }`}
                              >
                                {libraryPreviewAudioId === track.id ? "⏹ Stop" : "▶ Sample"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  addAdditionalAudioTrack(
                                    {
                                      id: track.id,
                                      name: track.name,
                                      duration_seconds: track.duration,
                                      size_bytes: 1024 * 1024,
                                      mime_type: "audio/mp3",
                                    },
                                    "backsound",
                                  );
                                  setMessage(`Musik "${track.name}" ditambahkan ke timeline.`);
                                }}
                                className="btn-secondary py-1 px-2 text-[10px] font-bold text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/10"
                              >
                                + Tambah
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {audioDirectory === "sfx" && (
                <div className="space-y-2.5">
                  <div>
                    <input
                      type="text"
                      placeholder="Cari efek suara SFX..."
                      value={audioSearch}
                      onChange={(e) => setAudioSearch(e.target.value)}
                      className="w-full text-xs"
                    />
                  </div>

                  {(() => {
                    const filtered = sfxList.filter((sfx) =>
                      audioSearch
                        ? sfx.label.toLowerCase().includes(audioSearch.toLowerCase()) ||
                          sfx.desc.toLowerCase().includes(audioSearch.toLowerCase()) ||
                          sfx.category.toLowerCase().includes(audioSearch.toLowerCase())
                        : true,
                    );

                    return (
                      <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                          Sound Effects ({filtered.length})
                        </p>
                        {filtered.map((sfx) => (
                          <div
                            key={sfx.id}
                            className="rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 transition hover:border-zinc-500"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-sm shrink-0">{sfx.icon}</span>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-black text-zinc-100">{sfx.label}</p>
                                  <p className="mt-0.5 text-[10px] text-zinc-400 line-clamp-1">{sfx.desc}</p>
                                </div>
                              </div>
                              <span className="shrink-0 rounded bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold text-purple-300">
                                {sfx.category}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => playSynthesizedSound(sfx.sound, 0.9)}
                                className="btn-secondary py-1 px-2 text-[10px] font-bold text-zinc-300 hover:text-purple-300"
                              >
                                ▶ Tes
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  addAdditionalAudioTrack(
                                    {
                                      id: sfx.id,
                                      name: sfx.label,
                                      duration_seconds: 0.5,
                                      size_bytes: 1024 * 256,
                                      mime_type: "audio/mp3",
                                    },
                                    "sfx",
                                  );
                                  setMessage(`SFX "${sfx.label}" ditambahkan ke timeline.`);
                                }}
                                className="btn-secondary py-1 px-2 text-[10px] font-bold text-purple-300 border-purple-500/30 hover:bg-purple-500/10"
                              >
                                + Tambah
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {audioDirectory === "yours" && (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Audio Upload Anda ({additionalAudioAssets.length})
                  </p>
                  {additionalAudioAssets.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                      Belum ada audio kustom. Buka direktori Import untuk mengunggah file mp3/wav.
                    </div>
                  ) : (
                    additionalAudioAssets.map((asset) => (
                      <div className="rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5" key={asset.id}>
                        <div className="flex items-center justify-between">
                          <p className="truncate text-xs font-black text-zinc-200">{asset.name}</p>
                          <span className="text-[10px] text-zinc-400">{formatTimeLabel(asset.duration_seconds)}</span>
                        </div>
                        <audio
                          className="mt-2 h-6 w-full"
                          controls
                          preload="metadata"
                          src={uploadedAudioUrl(transformationId, asset.id)}
                        />
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <button
                            className="btn-secondary px-2 py-1 text-[10px] font-bold text-cyan-300"
                            onClick={() => addAdditionalAudioTrack(asset, "backsound")}
                            type="button"
                          >
                            + Backsound
                          </button>
                          <button
                            className="btn-secondary px-2 py-1 text-[10px] font-bold text-purple-300"
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

              {audioDirectory === "import" && (
                <div className="space-y-3">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Import File Audio
                  </p>
                  <label className="btn-secondary block cursor-pointer px-3 py-2.5 text-center text-xs font-black">
                    {audioUploading ? `Mengupload ${audioUploadProgress}%` : "+ Upload File Audio (.mp3, .wav, .m4a)"}
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
              )}

              {audioDirectory === "copyright" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                    <p className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <span>🛡️</span>
                      <span>Audio Bebas Royalti</span>
                    </p>
                    <p className="mt-1 text-[11px] text-emerald-300/90 leading-relaxed">
                      Seluruh musik latar dan sound effects bawaan XA AutoClip 100% aman dan bebas royalti untuk video komersial dan media sosial (TikTok, Reels, Shorts).
                    </p>
                  </div>
                </div>
              )}
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB D: TEXT (Text Templates & Library Only - No Presets Grid) */}
          {activeNavTab === "text" && (
            <LeftPanelDirectoryLayout
              directories={textDirectories}
              activeDirectory={textDirectory}
              onSelectDirectory={setTextDirectory}
            >
              {textDirectory === "add_text" && (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Quick Add Text
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStyle("hook_text_style_preset", "clean_white");
                        addEvent("hook_text", "text:basic_text", "Teks Baru", "clean_white");
                        setMessage("Teks default ditambahkan ke timeline.");
                      }}
                      className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34]"
                    >
                      <span className="text-sm">🔤</span>
                      <span className="mt-1 block text-xs font-black text-zinc-100">Default text</span>
                      <span className="text-[10px] text-zinc-400">Teks judul standar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStyle("hook_text_style_preset", "yellow_viral");
                        addEvent("hook_text", "hook", styleConfig.hook_text || draft.original_hook || "WAJIB TAHU INI!", "yellow_viral");
                        setMessage("Hook title ditambahkan ke timeline.");
                      }}
                      className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34]"
                    >
                      <span className="text-sm">⚡</span>
                      <span className="mt-1 block text-xs font-black text-amber-300">Hook title</span>
                      <span className="text-[10px] text-zinc-400">Teks pembuka viral</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStyle("hook_text_style_preset", "authority_blue");
                        addEvent("hook_text", "text:lower_third", "Nama / Jabatan", "authority_blue");
                        setMessage("Lower third ditambahkan ke timeline.");
                      }}
                      className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34]"
                    >
                      <span className="text-sm">🏷️</span>
                      <span className="mt-1 block text-xs font-black text-cyan-300">Lower third</span>
                      <span className="text-[10px] text-zinc-400">Nama / info bawah</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStyle("hook_text_style_preset", "podcast_quote");
                        addEvent("hook_text", "text:quote", "“Kutipan menarik di sini”", "podcast_quote");
                        setMessage("Quote text ditambahkan ke timeline.");
                      }}
                      className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34]"
                    >
                      <span className="text-sm">💬</span>
                      <span className="mt-1 block text-xs font-black text-rose-300">Quote</span>
                      <span className="text-[10px] text-zinc-400">Format kutipan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStyle("hook_text_style_preset", "white_bold_shadow");
                        addEvent("hook_text", "text:big_title", "JUDUL BESAR", "white_bold_shadow");
                        setMessage("Big title ditambahkan ke timeline.");
                      }}
                      className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34]"
                    >
                      <span className="text-sm">📢</span>
                      <span className="mt-1 block text-xs font-black text-zinc-100">Big title</span>
                      <span className="text-[10px] text-zinc-400">Judul tebal besar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        addEvent("keyword_popup", "keyword", "KEYWORD", "yellow_viral");
                        setMessage("Keyword popup ditambahkan ke timeline.");
                      }}
                      className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34]"
                    >
                      <span className="text-sm">🎯</span>
                      <span className="mt-1 block text-xs font-black text-yellow-300">Keyword popup</span>
                      <span className="text-[10px] text-zinc-400">Highlight singkat</span>
                    </button>
                  </div>
                </div>
              )}

              {textDirectory === "text_template" && (
                <div className="space-y-2.5">
                  <div>
                    <input
                      type="text"
                      placeholder="Search for text templates..."
                      value={textSearch}
                      onChange={(e) => setTextSearch(e.target.value)}
                      className="w-full text-xs"
                    />
                  </div>

                  {(() => {
                    const filtered = textTemplates.filter((tpl) =>
                      textSearch
                        ? tpl.label.toLowerCase().includes(textSearch.toLowerCase()) ||
                          tpl.sample.toLowerCase().includes(textSearch.toLowerCase()) ||
                          tpl.category.toLowerCase().includes(textSearch.toLowerCase())
                        : true,
                    );

                    return (
                      <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                          Trending ({filtered.length})
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {filtered.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => {
                                setStyle("hook_text_style_preset", tpl.preset);
                                addEvent("hook_text", `template:${tpl.id}`, tpl.sample, tpl.preset);
                                setMessage(`Template "${tpl.label}" ditambahkan ke timeline.`);
                              }}
                              className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2 text-left transition hover:border-cyan-400 hover:bg-[#282c34] group"
                            >
                              <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-cyan-300">
                                {tpl.category}
                              </span>
                              <span className="mt-1 block text-xs font-black text-zinc-100 group-hover:text-cyan-200">
                                {tpl.label}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-zinc-400 truncate w-full italic">
                                {tpl.sample}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {textDirectory === "text_effects" && (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Text Effects ({textEffectsList.length})
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {textEffectsList.map((fx) => (
                      <button
                        key={fx.id}
                        type="button"
                        onClick={() => {
                          setStyle("hook_text_style_preset", fx.preset);
                          addEvent("hook_text", `effect:${fx.id}`, fx.sample, fx.preset);
                          setMessage(`Efek teks "${fx.label}" ditambahkan ke timeline.`);
                        }}
                        className="flex flex-col items-start rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400 hover:bg-[#282c34] group"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{fx.icon}</span>
                          <span className="text-xs font-black text-zinc-100 group-hover:text-cyan-200">
                            {fx.label}
                          </span>
                        </div>
                        <span className="mt-1 block text-[10px] text-zinc-400 line-clamp-1">
                          {fx.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {textDirectory === "yours" && (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Teks Tersimpan & Project
                  </p>
                  {styleConfig.hook_text || draft.original_hook || context.data?.candidate_title ? (
                    <div className="space-y-2">
                      {styleConfig.hook_text && (
                        <button
                          type="button"
                          onClick={() => addEvent("hook_text", "hook", styleConfig.hook_text, (styleConfig.hook_text_style_preset as TextStylePresetKey) || "clean_white")}
                          className="w-full rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400"
                        >
                          <span className="text-[9px] font-bold text-cyan-400 uppercase">Hook Aktif</span>
                          <p className="text-xs font-bold text-zinc-100 mt-0.5">{styleConfig.hook_text}</p>
                        </button>
                      )}
                      {context.data?.candidate_title && (
                        <button
                          type="button"
                          onClick={() => {
                            setStyle("hook_text", context.data.candidate_title || "");
                            addEvent("hook_text");
                          }}
                          className="w-full rounded-xl border border-zinc-700/80 bg-[#22252a] p-2.5 text-left transition hover:border-cyan-400"
                        >
                          <span className="text-[9px] font-bold text-zinc-400 uppercase">Judul AI</span>
                          <p className="text-xs font-bold text-zinc-100 mt-0.5">{context.data.candidate_title}</p>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                      Belum ada teks tersimpan.
                    </div>
                  )}
                </div>
              )}

              {(textDirectory === "auto_captions" || textDirectory === "local_captions") && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-cyan-800/60 bg-cyan-950/30 p-3 text-xs text-cyan-200">
                    <p className="font-bold text-cyan-300">💬 Navigasi ke Captions</p>
                    <p className="mt-1 text-[11px] text-cyan-300/85">
                      Gunakan tab Captions di atas untuk sinkronisasi caption otomatis atau import file subtitle lokal.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveNavTab("caption")}
                      className="btn-secondary mt-2.5 w-full py-1.5 text-xs font-bold text-cyan-300"
                    >
                      Buka Tab Captions →
                    </button>
                  </div>
                </div>
              )}
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB E: STICKERS (Stickers, Emojis & Badges Library) */}
          {activeNavTab === "stickers" && (
            <LeftPanelDirectoryLayout
              directories={stickerDirectories}
              activeDirectory={stickerDirectory}
              onSelectDirectory={setStickerDirectory}
            >
              <div className="space-y-2.5">
                <div>
                  <input
                    type="text"
                    placeholder="Cari sticker (misal: panah, api, hot)..."
                    value={stickerSearch}
                    onChange={(e) => setStickerSearch(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>

                {(() => {
                  const filtered = stickerItems.filter((item) => {
                    const matchDir = stickerDirectory === "trending" ? true : item.category === stickerDirectory;
                    const matchSearch = stickerSearch
                      ? item.label.toLowerCase().includes(stickerSearch.toLowerCase()) ||
                        item.icon.toLowerCase().includes(stickerSearch.toLowerCase()) ||
                        item.category.toLowerCase().includes(stickerSearch.toLowerCase())
                      : true;
                    return matchDir && matchSearch;
                  });

                  if (stickerDirectory === "yours" && !stickerSearch) {
                    return (
                      <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                        Belum ada sticker kustom di library Anda.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                        Koleksi ({filtered.length})
                      </p>
                      {filtered.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                          Tidak ada sticker yang cocok dengan "{stickerSearch}".
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {filtered.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                const start = Math.min(Math.max(0, previewTime), Math.max(0, clipDuration - 0.4));
                                const newStickerEvent: EffectTimelineEvent = {
                                  id: newEventId(),
                                  type: "keyword_popup",
                                  start: Number(start.toFixed(2)),
                                  end: Number(Math.min(clipDuration, start + 1.5).toFixed(2)),
                                  text: item.icon,
                                  reason: "sticker",
                                  position: "center",
                                  size: "medium",
                                };
                                updateEffectTimeline([...editableEffectTimeline, newStickerEvent]);
                                setSelectedEventId(newStickerEvent.id || null);
                                setSelectedEditorContext("keyword");
                                setTextInspectorTab("text");
                                setMessage(`Sticker "${item.label}" ditambahkan ke timeline.`);
                              }}
                              className="flex flex-col items-center justify-center rounded-xl border border-zinc-700/80 bg-[#22252a] p-2 text-center transition hover:border-cyan-400 hover:bg-[#282c34] group"
                              title={`Tambah ${item.label} ke timeline`}
                            >
                              <span className={`block text-xl group-hover:scale-110 transition-transform ${item.badge ? "text-xs font-black text-amber-300" : ""}`}>
                                {item.icon}
                              </span>
                              <span className="mt-1 block text-[10px] font-bold text-zinc-400 group-hover:text-zinc-200 truncate w-full">
                                {item.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB F: EFFECTS (Visual Effects Library) */}
          {(activeNavTab === "effects" || activeNavTab === "effect") && (
            <LeftPanelDirectoryLayout
              directories={effectDirectories}
              activeDirectory={effectDirectory}
              onSelectDirectory={setEffectDirectory}
            >
              <div className="space-y-2.5">
                <div>
                  <input
                    type="text"
                    placeholder="Cari effect video (misal: zoom, flash, shake)..."
                    value={effectSearch}
                    onChange={(e) => setEffectSearch(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>

                {(() => {
                  const filtered = visualEffectsList.filter((ef) => {
                    const matchDir = effectDirectory === "video_effects" ? true : ef.category === effectDirectory;
                    const matchSearch = effectSearch
                      ? ef.label.toLowerCase().includes(effectSearch.toLowerCase()) ||
                        ef.desc.toLowerCase().includes(effectSearch.toLowerCase()) ||
                        ef.category.toLowerCase().includes(effectSearch.toLowerCase())
                      : true;
                    return matchDir && matchSearch;
                  });

                  const currentDirObj = effectDirectories.find((d) => d.id === effectDirectory);
                  const titleLabel = currentDirObj ? currentDirObj.label : "Pilihan Efek";

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                          {titleLabel} ({filtered.length})
                        </p>
                      </div>
                      {filtered.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                          {effectSearch
                            ? `Tidak ada efek yang cocok dengan "${effectSearch}".`
                            : "Preset akan ditambahkan bertahap."}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {filtered.map((item) => {
                            const isDemoing = previewingEffectId === item.id;
                            const isApplied = editableEffectTimeline.some(
                              (e) =>
                                e.id === selectedEventId &&
                                (e.effect === item.effectName ||
                                  (e.type === item.type && e.type === "punch_zoom" && item.type === "punch_zoom") ||
                                  (e.reason && e.reason.includes(item.id))),
                            );

                            return (
                              <div
                                key={item.id}
                                className={`group relative flex flex-col justify-between rounded-xl border p-2 text-left transition-all ${
                                  isApplied
                                    ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.3)] ring-1 ring-cyan-400/40"
                                    : "border-zinc-700/80 bg-[#1e2024] hover:border-zinc-500 hover:bg-[#25282e]"
                                }`}
                              >
                                {/* 1. Thumbnail Preview with Play/Demo Overlay */}
                                <div className="relative w-full overflow-hidden rounded-lg">
                                  <EffectThumbnailPreview
                                    effectId={item.id}
                                    isDemoing={isDemoing}
                                  />
                                  {/* Play/Demo button overlay */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      triggerEffectDemo(item);
                                    }}
                                    title={`Demo efek ${item.label}`}
                                    className={`absolute top-1 right-1 flex size-6 items-center justify-center rounded-full backdrop-blur-md transition shadow ${
                                      isDemoing
                                        ? "bg-cyan-500 text-black shadow-cyan-500/50 scale-110"
                                        : "bg-black/60 text-zinc-200 hover:bg-cyan-500 hover:text-black opacity-80 group-hover:opacity-100"
                                    }`}
                                  >
                                    <span className="text-[10px] font-black">{isDemoing ? "⏳" : "▶"}</span>
                                  </button>
                                </div>

                                {/* 2. Text Info */}
                                <div className="w-full min-w-0 mt-1">
                                  <p className="truncate text-xs font-black text-zinc-100 group-hover:text-cyan-200">
                                    {item.label}
                                  </p>
                                  <p className="truncate text-[10px] text-zinc-400">
                                    {item.desc}
                                  </p>
                                </div>

                                {/* 3. Tambah Action Button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    addEvent(item.type, `effect:${item.id}`, undefined, undefined, item.effectName);
                                    setMessage(`Efek "${item.label}" ditambahkan ke timeline.`);
                                  }}
                                  className="btn-secondary w-full py-1 mt-1 text-[10px] font-bold text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20"
                                >
                                  + Tambah
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB G: TRANSITIONS (Transitions Library) */}
          {activeNavTab === "transitions" && (
            <LeftPanelDirectoryLayout
              directories={transitionDirectories}
              activeDirectory={transitionDirectory}
              onSelectDirectory={setTransitionDirectory}
            >
              <div className="space-y-2.5">
                {videoSegments.length < 2 && (
                  <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-2 text-xs text-amber-200">
                    <p className="font-bold flex items-center gap-1 text-amber-300 text-[11px]">
                      <span>⚠️</span>
                      <span>Info Sambungan Klip</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-amber-300/85">
                      Transisi butuh minimal 2 klip video. Potong klip (✂) atau tambahkan klip kedua.
                    </p>
                  </div>
                )}

                <div>
                  <input
                    type="text"
                    placeholder="Cari transisi (misal: fade, slide, zoom)..."
                    value={transitionSearch}
                    onChange={(e) => setTransitionSearch(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>

                {(() => {
                  const filtered = transitionItems.filter((item) => {
                    const matchDir = transitionDirectory === "trending" ? true : item.category === transitionDirectory;
                    const matchSearch = transitionSearch
                      ? item.name.toLowerCase().includes(transitionSearch.toLowerCase()) ||
                        item.desc.toLowerCase().includes(transitionSearch.toLowerCase()) ||
                        item.category.toLowerCase().includes(transitionSearch.toLowerCase())
                      : true;
                    return matchDir && matchSearch;
                  });

                  const currentDirObj = transitionDirectories.find((d) => d.id === transitionDirectory);
                  const titleLabel = currentDirObj ? currentDirObj.label : "Pilihan Transisi";

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                          {titleLabel} ({filtered.length})
                        </p>
                      </div>
                      {filtered.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                          {transitionSearch
                            ? `Tidak ada transisi yang cocok dengan "${transitionSearch}".`
                            : "Preset akan ditambahkan bertahap."}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {filtered.map((item) => {
                            const isDemoing = previewingTransitionId === item.id;
                            const isApplied = editableEffectTimeline.some(
                              (e) =>
                                e.type === "pattern_interrupt" &&
                                e.reason?.startsWith("transition") &&
                                (e.effect === item.name.toLowerCase().replace(/\s+/g, "_") ||
                                  e.reason?.toLowerCase().includes(item.name.toLowerCase())),
                            );

                            return (
                              <div
                                key={item.id}
                                className={`group relative flex flex-col justify-between rounded-xl border p-2 text-left transition-all ${
                                  isApplied
                                    ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.3)] ring-1 ring-cyan-400/40"
                                    : "border-zinc-700/80 bg-[#1e2024] hover:border-zinc-500 hover:bg-[#25282e]"
                                }`}
                              >
                                {/* 1. Thumbnail Preview with Play/Demo Overlay */}
                                <div className="relative w-full overflow-hidden rounded-lg">
                                  <TransitionThumbnailPreview
                                    transitionId={item.id}
                                    isDemoing={isDemoing}
                                  />
                                  {/* Play/Demo button overlay */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      triggerTransitionDemo(item);
                                    }}
                                    title={`Demo transisi ${item.name}`}
                                    className={`absolute top-1 right-1 flex size-6 items-center justify-center rounded-full backdrop-blur-md transition shadow ${
                                      isDemoing
                                        ? "bg-cyan-500 text-black shadow-cyan-500/50 scale-110"
                                        : "bg-black/60 text-zinc-200 hover:bg-cyan-500 hover:text-black opacity-80 group-hover:opacity-100"
                                    }`}
                                  >
                                    <span className="text-[10px] font-black">{isDemoing ? "⏳" : "▶"}</span>
                                  </button>
                                  {isApplied && (
                                    <span className="absolute bottom-1 left-1 rounded bg-cyan-500/90 px-1 py-0.2 text-[8px] font-black text-black">
                                      ✓ AKTIF
                                    </span>
                                  )}
                                </div>

                                {/* 2. Text Info */}
                                <div className="w-full min-w-0 mt-1">
                                  <p className="truncate text-xs font-black text-zinc-100 group-hover:text-cyan-200">
                                    {item.name}
                                  </p>
                                  <p className="truncate text-[10px] text-zinc-400">
                                    {item.desc}
                                  </p>
                                </div>

                                {/* 3. Terapkan Action Button */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (videoClipBoundaries.length === 0) {
                                      setMessage(
                                        "Transisi membutuhkan minimal dua klip video. Silakan potong (split ✂) video terlebih dahulu.",
                                      );
                                      return;
                                    }
                                    const nearestBoundary = videoClipBoundaries.reduce((prev, curr) =>
                                      Math.abs(curr.time - previewTime) < Math.abs(prev.time - previewTime)
                                        ? curr
                                        : prev,
                                    );
                                    const dur = 0.5;
                                    const start = Number(
                                      Math.max(0, nearestBoundary.time - dur / 2).toFixed(2),
                                    );
                                    const end = Number(
                                      Math.min(clipDuration, nearestBoundary.time + dur / 2).toFixed(2),
                                    );
                                    const effectType = item.name.toLowerCase().replace(/\s+/g, "_");

                                    const existingTransition = editableEffectTimeline.find(
                                      (e) =>
                                        e.type === "pattern_interrupt" &&
                                        e.reason?.startsWith("transition") &&
                                        Math.abs((e.start + e.end) / 2 - nearestBoundary.time) <= 0.4,
                                    );

                                    let nextTimeline: EffectTimelineEvent[];
                                    const transId = existingTransition?.id || newEventId();
                                    const transEvent: EffectTimelineEvent = {
                                      id: transId,
                                      type: "pattern_interrupt",
                                      start,
                                      end,
                                      effect: effectType,
                                      reason: `transition:${item.name}`,
                                    };

                                    if (existingTransition) {
                                      nextTimeline = editableEffectTimeline.map((e) =>
                                        e.id === existingTransition.id ? transEvent : e,
                                      );
                                      setMessage(
                                        `Transisi antara Klip ${nearestBoundary.beforeSegment.number} & ${nearestBoundary.afterSegment.number} diganti menjadi "${item.name}".`,
                                      );
                                    } else {
                                      nextTimeline = [...editableEffectTimeline, transEvent];
                                      setMessage(
                                        `Transisi "${item.name}" diterapkan antara Klip ${nearestBoundary.beforeSegment.number} & ${nearestBoundary.afterSegment.number}.`,
                                      );
                                    }

                                    updateEffectTimeline(nextTimeline);
                                    setSelectedEventId(transId);
                                    setSelectedEditorContext("effect");
                                    setEffectInspectorTab("effect");
                                  }}
                                  className="btn-secondary w-full py-1 mt-1 text-[10px] font-bold text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20"
                                >
                                  Terapkan
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB H: CAPTIONS (Caption Workflow & Presets) */}
          {activeNavTab === "caption" && (
            <LeftPanelDirectoryLayout
              directories={captionDirectories}
              activeDirectory={captionDirectory}
              onSelectDirectory={setCaptionDirectory}
            >
              {captionDirectory === "auto_captions" && (
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-wide text-cyan-400">
                      Auto Captions
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      Buat subtitle otomatis dari audio video di timeline secara instan.
                    </p>
                  </div>

                  {/* 1. Spoken Language */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-300 block">
                      Spoken language
                    </label>
                    <select
                      value={spokenLanguage}
                      onChange={(e) => setSpokenLanguage(e.target.value)}
                      disabled={autoCaptionGenerating}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="id">Bahasa Indonesia</option>
                      <option value="en">English</option>
                      <option value="auto">Auto detect</option>
                    </select>
                  </div>

                  {/* 2. Bilingual Captions */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-zinc-300 block">
                      Bilingual captions
                    </label>
                    <select
                      value={bilingualMode}
                      onChange={(e) => setBilingualMode(e.target.value)}
                      disabled={autoCaptionGenerating}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="none">None</option>
                      <option value="id_en">Indonesia → English (placeholder)</option>
                      <option value="en_id">English → Indonesia (placeholder)</option>
                    </select>
                    {bilingualMode !== "none" && (
                      <p className="text-[10px] text-amber-400">
                        Bilingual captions akan tersedia pada update berikutnya.
                      </p>
                    )}
                  </div>

                  {/* 3. Identify Filler Words */}
                  <div className="rounded-lg border border-zinc-800 bg-[#202226] p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-300 font-medium">Identify filler words</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={identifyFillerWords}
                        disabled={autoCaptionGenerating}
                        onClick={() => setIdentifyFillerWords((v) => !v)}
                        className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          identifyFillerWords ? "bg-cyan-500" : "bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            identifyFillerWords ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                    {identifyFillerWords && (
                      <p className="text-[10px] text-zinc-400">
                        Deteksi filler words akan dikembangkan pada tahap berikutnya.
                      </p>
                    )}
                  </div>

                  {/* 4. Delete Current Captions */}
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={deleteCurrentCaptions}
                        disabled={autoCaptionGenerating}
                        onChange={(e) => setDeleteCurrentCaptions(e.target.checked)}
                        className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-0"
                      />
                      <span>Delete current captions</span>
                    </label>
                    {!deleteCurrentCaptions && (
                      <p className="text-[10px] text-amber-400/90 pl-5">
                        Caption baru akan digabungkan dengan caption yang sudah ada.
                      </p>
                    )}
                  </div>

                  {/* 5. Button Generate */}
                  <div className="pt-1 space-y-2">
                    <button
                      type="button"
                      disabled={!hasTimelineMedia || autoCaptionGenerating}
                      onClick={() => generateAutoCaptionsMutation.mutate()}
                      className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                        !hasTimelineMedia
                          ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50"
                          : autoCaptionGenerating
                          ? "bg-cyan-600/50 text-cyan-200 cursor-wait animate-pulse"
                          : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 active:scale-[0.98]"
                      }`}
                    >
                      {autoCaptionGenerating ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-cyan-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span>Membuat caption...</span>
                        </>
                      ) : (
                        <span>Buat Caption</span>
                      )}
                    </button>

                    {!hasTimelineMedia && (
                      <p className="text-[10px] text-amber-400 text-center">
                        Tambahkan video atau audio ke timeline terlebih dahulu.
                      </p>
                    )}

                    {autoCaptionError && (
                      <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-[11px] text-red-300">
                        {autoCaptionError}
                      </div>
                    )}
                  </div>

                  {/* Secondary helpers */}
                  <div className="border-t border-zinc-800/80 pt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className="btn-secondary px-2 py-1.5 text-[11px] font-bold text-zinc-300 hover:text-cyan-300"
                        onClick={syncCaptionWithVideo}
                        type="button"
                      >
                        ⚡ Sinkronkan
                      </button>
                      <button
                        className="btn-secondary px-2 py-1.5 text-[11px] font-bold text-zinc-300"
                        disabled={!editableCaptionCues.length}
                        onClick={reflowAllCaptions}
                        type="button"
                      >
                        ✨ Rapikan
                      </button>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-[#202226] p-2.5 text-xs text-zinc-400">
                      <p className="font-bold text-zinc-300">Status Caption:</p>
                      <p className="mt-0.5 text-[11px]">
                        {editableCaptionCues.length} cue aktif di timeline. Klik cue untuk mengedit di inspector kanan.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {captionDirectory === "templates" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                      Template Gaya Caption
                    </p>
                    <span className="text-[10px] text-cyan-400 font-bold">CapCut Style</span>
                  </div>
                  <CaptionTemplateGallery
                    activeGroup="templates"
                    currentPresetId={mainCaptionStyle.preset_id}
                    previewTemplateId={hoveredCaptionTemplate?.id}
                    onSelectTemplate={applyCaptionTemplate}
                    onTemplateHover={handleTemplateHover}
                    onTemplateLeave={handleTemplateLeave}
                  />
                </div>
              )}

              {captionDirectory === "local_captions" && (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Daftar Cue Subtitle ({editableCaptionCues.length})
                  </p>
                  {editableCaptionCues.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 text-center text-xs font-semibold text-zinc-400">
                      Belum ada subtitle cue.
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                      {editableCaptionCues.map((cue) => (
                        <div
                          key={cue.id}
                          onClick={() => {
                            setSelectedCaptionId(cue.id);
                            setSelectedEditorContext("caption");
                          }}
                          className={`cursor-pointer rounded-lg border p-2 text-xs transition ${
                            selectedCaptionId === cue.id
                              ? "border-cyan-400 bg-cyan-500/10 text-cyan-200"
                              : "border-zinc-800 bg-[#22252a] text-zinc-300 hover:border-zinc-600"
                          }`}
                        >
                          <div className="flex justify-between text-[10px] text-zinc-500 font-bold">
                            <span>{formatTimePrecise(cue.start)} - {formatTimePrecise(cue.end)}</span>
                            <span>{(cue.end - cue.start).toFixed(1)}s</span>
                          </div>
                          <p className="mt-0.5 font-semibold line-clamp-2">{cue.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(captionDirectory === "add_captions" || captionDirectory === "auto_lyrics") && (
                <div className="space-y-3">
                  <p className="text-[11px] font-black uppercase tracking-wide text-zinc-400">
                    Tambah Caption Manual
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const start = Math.min(Math.max(0, previewTime), Math.max(0, clipDuration - 0.5));
                      const newCue: EditableCaptionCue = {
                        id: newEventId(),
                        start: Number(start.toFixed(2)),
                        end: Number(Math.min(clipDuration, start + 2).toFixed(2)),
                        text: "Teks Caption Baru",
                      };
                      const next = [...editableCaptionCues, newCue].sort((a, b) => a.start - b.start);
                      updateCaptionTimeline(next);
                      setSelectedCaptionId(newCue.id);
                      setSelectedEditorContext("caption");
                      setMessage("Caption baru ditambahkan.");
                    }}
                    className="btn-secondary w-full py-2 text-xs font-bold text-cyan-300"
                  >
                    + Tambah Cue pada Playhead ({formatTimePrecise(previewTime)})
                  </button>
                </div>
              )}
            </LeftPanelDirectoryLayout>
          )}

          {/* TAB I: TEMPLATES (Templates & Project Scene Library) */}
          {activeNavTab === "templates" && (
            <div className="flex flex-1 min-h-0 w-full h-full flex-col items-center justify-center p-6 text-center bg-[#17191c]">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-zinc-700/60 bg-[#22252a] text-2xl shadow-inner mb-3 text-cyan-400">
                🎨
              </div>
              <h3 className="text-sm font-bold text-zinc-100 mb-1">
                Template belum tersedia
              </h3>
              <p className="max-w-xs text-xs leading-relaxed text-zinc-400 mb-4">
                Template scene akan ditambahkan setelah struktur template final siap. Untuk pengaturan framing video, pilih track <span className="font-semibold text-cyan-400">VIDEO</span> lalu gunakan <span className="font-semibold text-zinc-200">Framing & Canvas</span> di panel kanan.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedEditorContext("video");
                  setVideoInspectorTab("video");
                  setSelectedEventId(null);
                  setSelectedCaptionId(null);
                  if (videoSegments.length > 0) {
                    setSelectedMediaSegmentId(videoSegments[0].id);
                  }
                  setMessage("Navigasi ke Video Inspector → Framing & Canvas.");
                }}
                className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold shadow-lg shadow-cyan-500/10"
              >
                <span>🎬</span>
                <span>Pilih video untuk atur framing</span>
              </button>
            </div>
          )}
        </aside>

        {/* CENTER PREVIEW PLAYER */}
        <main className="flex min-h-0 w-full flex-col overflow-hidden bg-[#101214] xl:h-full">
          <div
            className="flex min-h-0 flex-1 items-center justify-center px-3 py-2"
            onClick={() => {
              setSelectedEventId(null);
              setSelectedCaptionId(null);
              setSelectedMediaSegmentId(null);
              setSelectedAdditionalAudioTrackId(null);
              setSelectedEditorContext("details");
            }}
          >
            <div
              ref={previewCanvasContainerRef}
              className="relative aspect-[9/16] h-[clamp(300px,42vh,500px)] max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl shadow-black/50 ring-1 ring-white/10 select-none"
            >
              {/* Diagnostics logging */}
              {(() => {
                if (import.meta.env.DEV) {
                  const videoElement = previewVideoRef.current;
                  console.log("[active_video_debug]", {
                    preview_time: previewTime,
                    active_segment_id: activeVideoSegment?.id,
                    active_asset_id: activeVideoSegment?.asset_id,
                    active_source_url: activeVideoSegment?.source_url,
                    resolved_source: activeVideoSource,
                    source_error: (activeSourceHasError ? previewVideoError?.message : "") || resolvedSourceInfo.error,
                    video_element_src: videoElement?.currentSrc || videoElement?.src,
                    video_ready_state: videoElement?.readyState,
                    video_network_state: videoElement?.networkState,
                    video_error: videoElement?.error?.message,
                  });
                }
                return null;
              })()}
              {renderedPreviewUrl ? (
                <video
                  className="h-full w-full object-cover"
                  style={{
                    ...transitionTransformStyle,
                    filter: transitionFilterStyle ? transitionFilterStyle : undefined,
                  }}
                  controls={false}
                  muted={audioSettings.muted}
                  onLoadedMetadata={(event) => {
                    event.currentTarget.volume = Math.min(1, audioSettings.volume);
                    const clampedSpeed = Math.max(0.25, Math.min(4.0, videoSpeed || 1.0));
                    event.currentTarget.playbackRate = clampedSpeed;
                    setPreviewTimeFromVideo(event.currentTarget.currentTime);
                  }}
                  onPause={handlePreviewPause}
                  onPlay={handlePreviewPlay}
                  onSeeked={(event) => handleVideoSeeked(event.currentTarget.currentTime)}
                  onTimeUpdate={(event) => setPreviewTimeFromVideo(event.currentTarget.currentTime)}
                  preload="metadata"
                  ref={previewVideoRef}
                  src={renderedPreviewUrl}
                />
              ) : (
                <div
                  className={`absolute inset-0 h-full w-full ${livePreviewFilterClass} ${
                    (videoSegments.length > 0
                      ? ((videoSegments.find((s) => previewTime >= s.start - 0.05 && previewTime < s.end - 0.05) || videoSegments[0])?.visible === false)
                      : (styleConfig.video_visible === false))
                      ? "opacity-0 pointer-events-none"
                      : ""
                  }`}
                  style={{
                    ...liveZoomStyle,
                    ...transitionTransformStyle,
                    filter: transitionFilterStyle ? transitionFilterStyle : undefined,
                    zIndex: visualLayerZIndex("video"),
                  }}
                >
                  <PresetVideo
                    key={`${activeVideoSegment?.id || "legacy"}:${activeVideoSegment?.asset_id || "source"}:${activeVideoSource}`}
                    audioMuted={videoTrackDeleted || audioExtracted || videoMuted || audioSettings.muted}
                    audioVolume={audioSettings.volume}
                    src={activeVideoSource}
                    preset={effectiveFramingPreset}
                    framing={videoFraming}
                    adjustments={videoAdjustments}
                    speed={videoSpeed}
                    controls={false}
                    onCanPlay={(element) => {
                      if (import.meta.env.DEV) {
                        console.log("[preview_video_canplay]", {
                          src: element?.currentSrc || element?.src,
                          active_source: activeVideoSource,
                          ready_state: element?.readyState,
                        });
                      }
                      if (previewVideoError && sameMediaSource(element?.currentSrc || element?.src, activeVideoSource)) {
                        setPreviewVideoError(null);
                      }
                      if (previewVideoRef.current && previewPlayingRef.current && previewVideoRef.current.paused) {
                        void previewVideoRef.current.play().catch(() => undefined);
                      }
                    }}
                    onLoadedMetadata={(videoTime, element) => {
                      if (import.meta.env.DEV) {
                        console.log("[preview_video_loadedmetadata]", {
                          src: element.currentSrc || element.src,
                          active_source: activeVideoSource,
                          duration: element.duration,
                          videoWidth: element.videoWidth,
                          videoHeight: element.videoHeight,
                        });
                      }
                      if (previewVideoError && sameMediaSource(element.currentSrc || element.src, activeVideoSource)) {
                        setPreviewVideoError(null);
                      }
                      if (previewVideoRef.current) {
                        const target = videoTimeFromClipTime(previewTimeRef.current);
                        if (Math.abs(previewVideoRef.current.currentTime - target) > 0.05) {
                          previewVideoRef.current.currentTime = target;
                        }
                        if (previewPlayingRef.current && previewVideoRef.current.paused) {
                          void previewVideoRef.current.play().catch(() => undefined);
                        }
                      }
                      setPreviewTimeFromVideo(videoTime);
                    }}
                    onError={(element) => {
                      const eventSrc = element.currentSrc || element.src || "";
                      const isCurrent = sameMediaSource(eventSrc, activeVideoSource);
                      const errorMessage = element.error?.message || "Source video gagal dimuat.";

                      if (import.meta.env.DEV) {
                        console.log("[preview_video_error_event]", {
                          event_src: eventSrc,
                          active_source: activeVideoSource,
                          active_asset_id: activeVideoSegment?.asset_id,
                          is_current_source: isCurrent,
                          action: isCurrent ? "set_error" : "ignore_stale",
                        });
                      }

                      if (!isCurrent) {
                        // Ignore stale error from previous/aborted source
                        return;
                      }

                      if (import.meta.env.DEV) {
                        console.error("[preview_video_media_error]", {
                          current_src: eventSrc,
                          active_source: activeVideoSource,
                          error_code: element.error?.code,
                          error_message: errorMessage,
                          ready_state: element.readyState,
                          network_state: element.networkState,
                        });
                      }

                      setPreviewVideoError({
                        source: activeVideoSource,
                        assetId: activeVideoSegment?.asset_id,
                        segmentId: activeVideoSegment?.id,
                        message: errorMessage,
                        code: element.error?.code,
                        timestamp: Date.now(),
                      });
                    }}
                    onPause={() => {
                      if (!previewPlayingRef.current || previewTimeRef.current >= clipDuration - 0.05) {
                        handlePreviewPause();
                      }
                    }}
                    onPlay={handlePreviewPlay}
                    onEnded={handleVideoEnded}
                    onSeeked={handleVideoSeeked}
                    onTimeUpdate={setPreviewTimeFromVideo}
                    videoRef={previewVideoRef}
                  />
                </div>
              )}

              {!renderedPreviewUrl && (!activeVideoSource || activeSourceHasError) && videoSequence.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-5 text-center text-sm font-semibold text-white">
                  Source video tidak ditemukan
                </div>
              )}

              {isVisualModifierActive && transitionOverlayColor && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundColor: transitionOverlayColor,
                    opacity: transitionOverlayOpacity,
                    zIndex: 28,
                  }}
                />
              )}

              {manualEditorMode && videoSequence.length === 0 && (
                <div
                  className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-zinc-950/85 p-4 text-center pointer-events-none"
                >
                  <div className="flex size-10 items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-base text-cyan-400">
                    🎬
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-200">
                      Editor Siap
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      Pilih media dari panel kiri untuk mulai mengedit
                    </p>
                  </div>
                </div>
              )}

              {audioExtracted && !audioTrackDeleted && !renderedPreviewUrl && (
                <audio
                  aria-label="Preview track audio terpisah"
                  className="hidden"
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const speed = Math.max(0.5, Math.min(2.0, audioSettings.speed || 1.0));
                    e.currentTarget.playbackRate = speed;
                  }}
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

              {hookPreviewState.shouldRenderHookOverlay && liveHookEvent && liveHookEvent.visible !== false && (() => {
                const eventPreset = normalizeTextStylePreset(
                  (liveHookEvent.preset as TextStylePresetKey) || styleConfig.hook_text_style_preset || "clean_white"
                );
                const eventStyle = resolveTextOverlayStyle(eventPreset);
                const isSelected = selectedEventId === liveHookEvent.id || selectedEditorContext === "hook";
                const baseFont = liveHookEvent.font_family
                  ? resolveFontFamily(liveHookEvent.font_family)
                  : resolveFontFamily(activeHookFont.fontFamily);
                const eventFont = (hoveredFontPreview && isSelected) ? hoveredFontPreview : baseFont;
                const defaultHookPosY =
                  liveHookEvent.position === "bottom"
                    ? 84
                    : liveHookEvent.position === "center"
                    ? 50
                    : liveHookEvent.position === "top"
                    ? 10
                    : liveHookEvent.position === "upper_center"
                    ? 18
                    : (hookSafeArea.topPercent || 18);
                const posX = liveHookEvent.position_x_percent ?? 50;
                const posY = liveHookEvent.position_y_percent ?? defaultHookPosY;
                const scale = liveHookEvent.scale ?? 1.0;
                const currentText = liveHookEvent.text ?? (styleConfig.hook_text || hookFallbackText || "");

                const resolvedColor = liveHookEvent.color || eventStyle.color || "#ffffff";
                const resolvedWeight = liveHookEvent.font_weight || eventStyle.fontWeight || 700;
                const resolvedStyle = liveHookEvent.font_style || "normal";
                const resolvedDecoration = liveHookEvent.text_decoration || "none";
                const resolvedTransform =
                  liveHookEvent.text_case === "uppercase"
                    ? "uppercase"
                    : liveHookEvent.text_case === "lowercase"
                    ? "lowercase"
                    : liveHookEvent.text_case === "titlecase"
                    ? "capitalize"
                    : eventStyle.textTransform || "none";
                const resolvedLetterSpacing =
                  liveHookEvent.letter_spacing !== undefined ? `${liveHookEvent.letter_spacing}px` : undefined;
                const resolvedLineHeight =
                  liveHookEvent.line_height !== undefined ? liveHookEvent.line_height : 1.15;
                const resolvedAlign = (liveHookEvent.text_align || "center") as CSSProperties["textAlign"];
                const resolvedOpacity = liveHookEvent.opacity !== undefined ? liveHookEvent.opacity : 1;
                const resolvedFontSize = liveHookEvent.font_size
                  ? `${liveHookEvent.font_size}px`
                  : hookResponsiveFontSize;
                const resolvedStroke =
                  liveHookEvent.stroke_enabled !== undefined
                    ? liveHookEvent.stroke_enabled
                      ? `${liveHookEvent.stroke_width || 2}px ${liveHookEvent.stroke_color || "#000000"}`
                      : undefined
                    : eventStyle.WebkitTextStroke;
                const resolvedBackground =
                  liveHookEvent.background_enabled !== undefined
                    ? liveHookEvent.background_enabled
                      ? `${liveHookEvent.background_color || "#000000"}${Math.round(
                          (liveHookEvent.background_opacity ?? 0.8) * 255,
                        )
                          .toString(16)
                          .padStart(2, "0")}`
                      : "transparent"
                    : eventStyle.backgroundColor;
                const resolvedRadius =
                  liveHookEvent.background_radius !== undefined
                    ? `${liveHookEvent.background_radius}px`
                    : undefined;
                const resolvedShadow =
                  liveHookEvent.shadow_enabled !== undefined
                    ? liveHookEvent.shadow_enabled
                      ? `0 2px ${liveHookEvent.shadow_blur || 4}px ${
                          liveHookEvent.shadow_color || "rgba(0,0,0,0.85)"
                        }`
                      : undefined
                    : eventStyle.textShadow ||
                      activeHookTemplate.textShadow ||
                      "0 2px 4px rgba(0,0,0,0.85)";

                return (
                  <div
                    data-hook-duplicate-suppressed={
                      hookPreviewState.hookPreviewDuplicateSuppressed
                    }
                    data-hook-render-source={hookPreviewState.hookPreviewRenderSource}
                    className={`pointer-events-auto absolute select-none rounded-lg text-center ${
                      activeHookTemplate.paddingClass || "px-2 py-1"
                    } ${activeHookTemplate.containerClass || "text-white"}`}
                    style={{
                      ...eventStyle,
                      left: `${posX}%`,
                      top: `${posY}%`,
                      transform: `translate(-50%, -50%) scale(${scale})`,
                      width: "86%",
                      maxWidth: "88%",
                      fontSize: resolvedFontSize,
                      zIndex: visualLayerZIndex("hook"),
                      color: resolvedColor,
                      fontWeight: resolvedWeight,
                      fontStyle: resolvedStyle,
                      textDecoration: resolvedDecoration,
                      textTransform: resolvedTransform,
                      letterSpacing: resolvedLetterSpacing,
                      lineHeight: resolvedLineHeight,
                      textAlign: resolvedAlign,
                      opacity: resolvedOpacity,
                      WebkitTextStroke: resolvedStroke,
                      paintOrder: resolvedStroke ? "stroke fill" : undefined,
                      backgroundColor: resolvedBackground,
                      borderRadius: resolvedRadius,
                      textShadow: resolvedShadow,
                      fontFamily: eventFont,
                      whiteSpace: "normal",
                      overflowWrap: "break-word",
                      wordBreak: "break-word",
                    }}
                  >
                    {/* Bounding Box Frame (Drag Borders + Resize Handles) */}
                    {isSelected && (
                      <div className="pointer-events-none absolute -inset-2 rounded border-2 border-cyan-400 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]">

                    {/* 4 Border Drag Strips */}
                        <div
                          className="pointer-events-auto absolute -top-2 inset-x-2 h-3.5 cursor-move"
                          title="Geser posisi teks"
                          onPointerDown={(e) =>
                            startCanvasDrag(e, "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          className="pointer-events-auto absolute -bottom-2 inset-x-2 h-3.5 cursor-move"
                          title="Geser posisi teks"
                          onPointerDown={(e) =>
                            startCanvasDrag(e, "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          className="pointer-events-auto absolute -left-2 inset-y-2 w-3.5 cursor-move"
                          title="Geser posisi teks"
                          onPointerDown={(e) =>
                            startCanvasDrag(e, "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          className="pointer-events-auto absolute -right-2 inset-y-2 w-3.5 cursor-move"
                          title="Geser posisi teks"
                          onPointerDown={(e) =>
                            startCanvasDrag(e, "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />

                        {/* 4 Corner Resize Handles */}
                        <div
                          aria-label="Resize Top Left"
                          className="pointer-events-auto absolute -left-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "tl", "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                        />
                        <div
                          aria-label="Resize Top Right"
                          className="pointer-events-auto absolute -right-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "tr", "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                        />
                        <div
                          aria-label="Resize Bottom Left"
                          className="pointer-events-auto absolute -left-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "bl", "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                        />
                        <div
                          aria-label="Resize Bottom Right"
                          className="pointer-events-auto absolute -right-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "br", "hook", liveHookEvent.id || "hook-event", posX, posY, scale)
                          }
                        />
                      </div>
                    )}

                    {activeHookTemplate.badge && (
                      <span
                        className={`block font-black uppercase ${
                          activeHookTemplate.badgeClass || "mb-0.5 text-[8px] tracking-wider opacity-90"
                        }`}
                      >
                        {activeHookTemplate.badge}
                      </span>
                    )}

                    {isSelected ? (
                      <WysiwygInlineTextEditor
                        value={currentText}
                        placeholder="Ketik teks di sini..."
                        className={`block ${activeHookTemplate.textClass || "font-bold"}`}
                        style={{
                          whiteSpace: "normal",
                          overflowWrap: "break-word",
                          wordBreak: "break-word",
                          lineHeight: 1.15,
                        }}
                        onChange={(nextText) => {
                          if (liveHookEvent.id) {
                            replaceEvent(liveHookEvent.id, { text: nextText });
                          }
                          setStyle("hook_text", nextText);
                        }}
                      />
                    ) : (
                      <span
                        className={`block line-clamp-2 cursor-text ${activeHookTemplate.textClass || "font-bold"}`}
                        style={{
                          whiteSpace: "normal",
                          overflowWrap: "break-word",
                          wordBreak: "break-word",
                          lineHeight: 1.15,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEventId(liveHookEvent.id || null);
                          setSelectedEditorContext("hook");
                          setTextInspectorTab("text");
                        }}
                      >
                        {currentText}
                      </span>
                    )}
                  </div>
                );
              })()}

              {liveStickerEvent?.text && liveStickerEvent.visible !== false && (() => {
                const defaultStickerPosY =
                  liveStickerEvent.position === "top_left" || liveStickerEvent.position === "top_right"
                    ? 16
                    : liveStickerEvent.position === "bottom_left" || liveStickerEvent.position === "bottom_right"
                    ? 76
                    : 45;
                const defaultStickerPosX =
                  liveStickerEvent.position === "top_left" || liveStickerEvent.position === "bottom_left"
                    ? 20
                    : liveStickerEvent.position === "top_right" || liveStickerEvent.position === "bottom_right"
                    ? 80
                    : 50;
                const posX = liveStickerEvent.position_x_percent ?? defaultStickerPosX;
                const posY = liveStickerEvent.position_y_percent ?? defaultStickerPosY;
                const scale = liveStickerEvent.scale ?? 1.0;
                const isSelected = selectedEventId === liveStickerEvent.id;

                return (
                  <div
                    className="pointer-events-auto absolute flex items-center justify-center cursor-move select-none"
                    style={{
                      left: `${posX}%`,
                      top: `${posY}%`,
                      transform: `translate(-50%, -50%) scale(${scale})`,
                      fontSize:
                        liveStickerEvent.size === "large"
                          ? "clamp(42px, 8vh, 60px)"
                          : liveStickerEvent.size === "small"
                          ? "clamp(22px, 4vh, 28px)"
                          : "clamp(32px, 6vh, 42px)",
                      zIndex: 35,
                      filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.75))",
                    }}
                    onPointerDown={(event) =>
                      startCanvasDrag(
                        event,
                        "sticker",
                        liveStickerEvent.id || "sticker-event",
                        posX,
                        posY,
                        scale,
                      )
                    }
                    onPointerMove={handleCanvasManipulationMove}
                    onPointerUp={handleCanvasManipulationUp}
                    title="Geser posisi atau tarik sudut untuk memperbesar"
                  >
                    {isSelected && (
                      <div className="pointer-events-none absolute -inset-2 rounded border-2 border-cyan-400 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]">
                        <div
                          aria-label="Resize Top Left"
                          className="pointer-events-auto absolute -left-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "tl", "sticker", liveStickerEvent.id || "sticker-event", posX, posY, scale)
                          }
                        />
                        <div
                          aria-label="Resize Top Right"
                          className="pointer-events-auto absolute -right-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "tr", "sticker", liveStickerEvent.id || "sticker-event", posX, posY, scale)
                          }
                        />
                        <div
                          aria-label="Resize Bottom Left"
                          className="pointer-events-auto absolute -left-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "bl", "sticker", liveStickerEvent.id || "sticker-event", posX, posY, scale)
                          }
                        />
                        <div
                          aria-label="Resize Bottom Right"
                          className="pointer-events-auto absolute -right-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(e, "br", "sticker", liveStickerEvent.id || "sticker-event", posX, posY, scale)
                          }
                        />
                      </div>
                    )}
                    {liveStickerEvent.text.startsWith("🔥 HOT") ||
                    liveStickerEvent.text.startsWith("✨ NEW") ||
                    liveStickerEvent.text.startsWith("⚡ VIRAL") ||
                    liveStickerEvent.text.startsWith("👑 TOP") ||
                    liveStickerEvent.text.startsWith("💎 PRO") ? (
                      <span className="rounded-xl bg-gradient-to-r from-amber-500 via-rose-500 to-pink-500 px-3.5 py-1.5 text-xs font-black text-white shadow-xl shadow-amber-950/60 uppercase tracking-wider border border-white/20">
                        {liveStickerEvent.text}
                      </span>
                    ) : (
                      <span className="leading-none select-none">{liveStickerEvent.text}</span>
                    )}
                  </div>
                );
              })()}

              {styleConfig.keyword_popup_enabled &&
                liveKeywordEvent &&
                !liveKeywordEvent.reason?.toLowerCase().includes("sticker") &&
                liveKeywordEvent.visible !== false && (() => {
                  const posX = liveKeywordEvent.position_x_percent ?? 50;
                  const posY = liveKeywordEvent.position_y_percent ?? 74;
                  const scale = liveKeywordEvent.scale ?? 1.0;
                  const isSelected = selectedEventId === liveKeywordEvent.id;
                  const currentText = liveKeywordEvent.text || "";

                  return (
                    <div
                      className="pointer-events-auto absolute select-none rounded-lg px-3 py-1 text-center shadow-lg"
                      style={{
                        ...resolveTextOverlayStyle(
                          normalizeTextStylePreset(
                            liveKeywordEvent.preset || styleConfig.keyword_text_style_preset || "yellow_viral",
                          ),
                        ),
                        left: `${posX}%`,
                        top: `${posY}%`,
                        transform: `translate(-50%, -50%) scale(${scale})`,
                        width: "auto",
                        maxWidth: "75%",
                        fontSize: "clamp(10px, 2.4vh, 13px)",
                        lineHeight: 1.2,
                        whiteSpace: "normal",
                        overflowWrap: "break-word",
                        wordBreak: "break-word",
                        zIndex: visualLayerZIndex("keyword"),
                      }}
                    >
                      {isSelected && (
                        <div className="pointer-events-none absolute -inset-2 rounded border-2 border-cyan-400 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]">
                          {/* 4 Border Drag Strips */}
                          <div
                            className="pointer-events-auto absolute -top-2 inset-x-2 h-3.5 cursor-move"
                            title="Geser posisi keyword"
                            onPointerDown={(e) =>
                              startCanvasDrag(e, "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                            onPointerMove={handleCanvasManipulationMove}
                            onPointerUp={handleCanvasManipulationUp}
                          />
                          <div
                            className="pointer-events-auto absolute -bottom-2 inset-x-2 h-3.5 cursor-move"
                            title="Geser posisi keyword"
                            onPointerDown={(e) =>
                              startCanvasDrag(e, "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                            onPointerMove={handleCanvasManipulationMove}
                            onPointerUp={handleCanvasManipulationUp}
                          />
                          <div
                            className="pointer-events-auto absolute -left-2 inset-y-2 w-3.5 cursor-move"
                            title="Geser posisi keyword"
                            onPointerDown={(e) =>
                              startCanvasDrag(e, "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                            onPointerMove={handleCanvasManipulationMove}
                            onPointerUp={handleCanvasManipulationUp}
                          />
                          <div
                            className="pointer-events-auto absolute -right-2 inset-y-2 w-3.5 cursor-move"
                            title="Geser posisi keyword"
                            onPointerDown={(e) =>
                              startCanvasDrag(e, "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                            onPointerMove={handleCanvasManipulationMove}
                            onPointerUp={handleCanvasManipulationUp}
                          />

                          {/* 4 Corner Resize Handles */}
                          <div
                            aria-label="Resize Top Left"
                            className="pointer-events-auto absolute -left-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                            onPointerDown={(e) =>
                              startCanvasResize(e, "tl", "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                          />
                          <div
                            aria-label="Resize Top Right"
                            className="pointer-events-auto absolute -right-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                            onPointerDown={(e) =>
                              startCanvasResize(e, "tr", "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                          />
                          <div
                            aria-label="Resize Bottom Left"
                            className="pointer-events-auto absolute -left-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                            onPointerDown={(e) =>
                              startCanvasResize(e, "bl", "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                          />
                          <div
                            aria-label="Resize Bottom Right"
                            className="pointer-events-auto absolute -right-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                            onPointerDown={(e) =>
                              startCanvasResize(e, "br", "keyword", liveKeywordEvent.id || "keyword-event", posX, posY, scale)
                            }
                          />
                        </div>
                      )}

                      {isSelected ? (
                        <WysiwygInlineTextEditor
                          value={currentText}
                          placeholder="KEYWORD"
                          className="font-black block"
                          style={{
                            lineHeight: 1.2,
                            whiteSpace: "normal",
                            overflowWrap: "break-word",
                            wordBreak: "break-word",
                          }}
                          onChange={(nextText) => {
                            const text = sanitizeKeywordInput(nextText);
                            if (liveKeywordEvent.id) {
                              replaceEvent(liveKeywordEvent.id, { text });
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="font-black cursor-text"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEventId(liveKeywordEvent.id || null);
                            setSelectedEditorContext("keyword");
                            setTextInspectorTab("text");
                          }}
                        >
                          {currentText}
                        </span>
                      )}
                    </div>
                  );
                })()}

              {subtitlePreview && currentCaptionCue && currentCaptionCue.visible !== false && (() => {
                const templateType = resolvedCurrentCaptionStyle.template_type || "basic_subtitle";
                const behavior = resolvedCurrentCaptionStyle.behavior || {};
                const layout = resolvedCurrentCaptionStyle.layout || {};
                const animation = resolvedCurrentCaptionStyle.animation || {};

                const isLowerThird = templateType === "lower_third" || layout.position === "lower_third";
                const defaultCaptionPosY = isLowerThird
                  ? 88
                  : resolvedCurrentCaptionStyle.position === "top"
                  ? 12
                  : resolvedCurrentCaptionStyle.position === "middle"
                  ? 50
                  : 84;
                const posX = resolvedCurrentCaptionStyle.position_x_percent ?? 50;
                const posY = resolvedCurrentCaptionStyle.position_y_percent ?? defaultCaptionPosY;
                const isSelected =
                  Boolean(currentCaptionCue?.id && selectedCaptionId === currentCaptionCue.id) ||
                  selectedEditorContext === "caption";
                const currentText = currentCaptionCue?.text || subtitlePreview || "";

                const isQuote = templateType === "quote";
                const isTypewriter = templateType === "typewriter" || behavior.mode === "typewriter" || animation.in === "typewriter";
                const isGlitch = templateType === "glitch" || animation.loop === "glitch" || resolvedCurrentCaptionStyle.animation_loop === "glitch" || resolvedCurrentCaptionStyle.effect === "glitch";
                const isShake = templateType === "shake" || animation.loop === "shake" || resolvedCurrentCaptionStyle.animation_loop === "shake";
                const isFlash = templateType === "flash" || animation.loop === "pulse" || animation.loop === "glow" || resolvedCurrentCaptionStyle.animation_loop === "pulse" || resolvedCurrentCaptionStyle.effect === "flash";
                const isMeme = templateType === "meme";
                const isBubble = templateType === "bubble";
                const isEducation = templateType === "education";
                const isDebate = templateType === "debate_marker";
                const isSticker = templateType === "sticker_text";

                // Word progress / sweep (Karaoke / progressive highlight)
                const isWordProgress =
                  behavior.mode === "word_progress" ||
                  templateType === "karaoke" ||
                  resolvedCurrentCaptionStyle.karaoke_enabled ||
                  animation.loop === "highlight_sweep";

                // Word highlight calculation
                const isWordHighlight =
                  !isWordProgress &&
                  (templateType === "word_highlight" ||
                    behavior.mode === "emphasis_word" ||
                    behavior.mode === "keyword_highlight");

                // Typewriter progressive text calculation
                const typedLength = isTypewriter && (previewPlaying && karaokeCueProgress !== null)
                  ? Math.max(1, Math.floor(karaokeCueProgress * (subtitlePreview?.length || 1)))
                  : (subtitlePreview?.length || 0);
                const displayedText = isTypewriter ? (subtitlePreview || "").slice(0, typedLength) : subtitlePreview;

                const words = (displayedText || "").split(/\s+/).filter(Boolean);

                const highlightIndices = isWordHighlight
                  ? extractHighlightedWordIndices(displayedText || "", behavior.highlight_strategy || "keywords")
                  : new Set<number>();

                // Progressive active index for word_progress
                const { activeWordIndex, progress: computedProgress } = (() => {
                  if (words.length <= 0) return { activeWordIndex: -1, progress: 0 };
                  if (previewPlaying && currentCaptionCue) {
                    return computeKaraokeWordProgress(words, currentCaptionCue.start, currentCaptionCue.end, previewTime);
                  }
                  if (hoveredCaptionTemplate && isWordProgress) {
                    return { activeWordIndex: Math.min(words.length - 1, Math.floor(words.length / 2)), progress: 0.5 };
                  }
                  if (currentCaptionCue && previewTime >= currentCaptionCue.start && previewTime <= currentCaptionCue.end) {
                    return computeKaraokeWordProgress(words, currentCaptionCue.start, currentCaptionCue.end, previewTime);
                  }
                  return { activeWordIndex: 0, progress: 0 };
                })();

                if (isWordProgress && currentCaptionCue && previewPlaying) {
                  console.debug("[karaoke_preview_model]", {
                    caption_id: currentCaptionCue.id,
                    words_count: words.length,
                    active_word_index: activeWordIndex,
                    progress: computedProgress,
                  });
                }

                const onSelectThisCaption = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  setSelectedCaptionId(currentCaptionCue?.id || null);
                  setSelectedEditorContext("caption");
                  setCaptionInspectorTab("text");
                };

                // Determine container animation class
                const animClass = [
                  isGlitch ? "caption-effect-glitch" : "",
                  isShake ? "caption-effect-shake" : "",
                  isFlash ? "caption-effect-pulse" : "",
                  animation.in === "pop" || animation.in === "pop_in" ? "caption-anim-pop" : "",
                  animation.in === "bounce" ? "caption-anim-bounce" : "",
                  animation.loop === "float" ? "caption-anim-float" : "",
                  animation.loop === "subtle_pulse" ? "caption-anim-subtle-pulse" : "",
                  animation.loop === "badge_pulse" ? "caption-anim-badge-pulse" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <div
                    className={`pointer-events-auto absolute select-none leading-tight transition-all duration-100 ${animClass}`}
                    style={{
                      zIndex: visualLayerZIndex("caption"),
                      left: `${posX}%`,
                      top: `${posY}%`,
                      transform: "translate(-50%, -50%)",
                      width: `${Math.min(84, resolvedCurrentCaptionStyle.max_width_percent || 82)}%`,
                      maxWidth: "84%",
                      textAlign: resolvedCurrentCaptionStyle.align,
                      fontFamily: (hoveredFontPreview && (selectedEditorContext === "caption" || Boolean(selectedCaption) || activeNavTab === "caption"))
                        ? hoveredFontPreview
                        : resolveFontFamily(resolvedCurrentCaptionStyle.font_family),
                      fontSize: `${resolvedCurrentCaptionStyle.font_size}px`,
                      fontWeight: resolvedCurrentCaptionStyle.font_weight,
                      fontStyle: resolvedCurrentCaptionStyle.italic ? "italic" : "normal",
                      textDecoration: resolvedCurrentCaptionStyle.underline ? "underline" : "none",
                      lineHeight: resolvedCurrentCaptionStyle.line_height,
                      letterSpacing: `${resolvedCurrentCaptionStyle.letter_spacing}px`,
                      wordSpacing: `${resolvedCurrentCaptionStyle.word_spacing}px`,
                      WebkitTextStroke: resolvedCurrentCaptionStyle.stroke_enabled
                        ? `${resolvedCurrentCaptionStyle.stroke_width}px ${resolvedCurrentCaptionStyle.stroke_color}`
                        : undefined,
                      paintOrder: "stroke fill",
                      textShadow: isMeme
                        ? "3px 3px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 0 4px 10px rgba(0,0,0,0.9)"
                        : resolvedCurrentCaptionStyle.shadow_enabled
                        ? `${resolvedCurrentCaptionStyle.shadow_x}px ${resolvedCurrentCaptionStyle.shadow_y}px ${resolvedCurrentCaptionStyle.shadow_blur}px ${resolvedCurrentCaptionStyle.shadow_color}`
                        : undefined,
                    }}
                  >
                    {hoveredCaptionTemplate && (
                      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-cyan-400 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-zinc-950 shadow-lg shadow-cyan-500/30 backdrop-blur-sm animate-pulse z-30 whitespace-nowrap">
                        <span>👁️ Live Preview: {hoveredCaptionTemplate.name}</span>
                      </div>
                    )}
                    {isSelected && (
                      <div className="pointer-events-none absolute -inset-2 rounded border-2 border-cyan-400 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]">
                        {/* 4 Border Drag Strips */}
                        <div
                          className="pointer-events-auto absolute -top-2 inset-x-2 h-3.5 cursor-move"
                          title="Geser posisi caption"
                          onPointerDown={(e) =>
                            startCanvasDrag(
                              e,
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          className="pointer-events-auto absolute -bottom-2 inset-x-2 h-3.5 cursor-move"
                          title="Geser posisi caption"
                          onPointerDown={(e) =>
                            startCanvasDrag(
                              e,
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          className="pointer-events-auto absolute -left-2 inset-y-2 w-3.5 cursor-move"
                          title="Geser posisi caption"
                          onPointerDown={(e) =>
                            startCanvasDrag(
                              e,
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          className="pointer-events-auto absolute -right-2 inset-y-2 w-3.5 cursor-move"
                          title="Geser posisi caption"
                          onPointerDown={(e) =>
                            startCanvasDrag(
                              e,
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />

                        {/* 4 Corner Resize Handles */}
                        <div
                          aria-label="Resize Top Left"
                          className="pointer-events-auto absolute -left-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(
                              e,
                              "tl",
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          aria-label="Resize Top Right"
                          className="pointer-events-auto absolute -right-1.5 -top-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(
                              e,
                              "tr",
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          aria-label="Resize Bottom Left"
                          className="pointer-events-auto absolute -left-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nesw-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(
                              e,
                              "bl",
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                        <div
                          aria-label="Resize Bottom Right"
                          className="pointer-events-auto absolute -right-1.5 -bottom-1.5 size-3.5 rounded-full border-2 border-cyan-400 bg-white shadow-md cursor-nwse-resize hover:scale-125 transition-transform"
                          onPointerDown={(e) =>
                            startCanvasResize(
                              e,
                              "br",
                              "caption",
                              currentCaptionCue?.id || "current-caption",
                              posX,
                              posY,
                              1.0,
                              resolvedCurrentCaptionStyle.font_size,
                            )
                          }
                          onPointerMove={handleCanvasManipulationMove}
                          onPointerUp={handleCanvasManipulationUp}
                        />
                      </div>
                    )}

                    {/* DEDICATED TEMPLATE_TYPE RENDERERS */}
                    {isSelected ? (
                      <WysiwygInlineTextEditor
                        value={currentText}
                        placeholder="Ketik caption..."
                        className="block break-words"
                        style={{
                          color: resolvedCurrentCaptionStyle.color,
                          textAlign: resolvedCurrentCaptionStyle.align,
                        }}
                        onChange={(nextText) => {
                          updateSelectedCaptionText(nextText);
                        }}
                        onBlur={finishSelectedCaptionTextEdit}
                      />
                    ) : isLowerThird ? (
                      <div
                        onClick={onSelectThisCaption}
                        className="cursor-text flex flex-col items-start w-full overflow-hidden shadow-2xl rounded-lg border-l-4 border-cyan-400"
                        style={{
                          backgroundColor: resolvedCurrentCaptionStyle.background_color.startsWith("#")
                            ? `${resolvedCurrentCaptionStyle.background_color}${Math.round(resolvedCurrentCaptionStyle.background_opacity * 255).toString(16).padStart(2, "0")}`
                            : resolvedCurrentCaptionStyle.background_color,
                          backdropFilter: "blur(8px)",
                        }}
                      >
                        {/* Live News / Speaker Header Badge */}
                        <div className="flex items-center gap-1.5 px-3 py-1 bg-black/40 w-full border-b border-white/10">
                          <span className="inline-block size-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                            {resolvedCurrentCaptionStyle.preset_id === "breaking_point"
                              ? "BREAKING NEWS"
                              : resolvedCurrentCaptionStyle.preset_id === "podcast_speaker"
                              ? "PODCAST"
                              : resolvedCurrentCaptionStyle.preset_id === "interview_name_bar"
                              ? "INTERVIEW"
                              : "BERITA UTAMA"}
                          </span>
                        </div>
                        {/* Headline Text */}
                        <div className="px-4 py-2 text-left w-full">
                          <span style={{ color: resolvedCurrentCaptionStyle.color }}>{displayedText}</span>
                        </div>
                      </div>
                    ) : isBubble ? (
                      <div
                        onClick={onSelectThisCaption}
                        className={`cursor-text inline-block shadow-2xl transition-transform ${
                          layout.box_style === "comic" || resolvedCurrentCaptionStyle.preset_id === "comic_bubble"
                            ? "border-3 border-black shadow-[4px_4px_0px_#000]"
                            : layout.box_style === "glass" || resolvedCurrentCaptionStyle.preset_id === "dark_glass_bubble"
                            ? "border border-white/20 backdrop-blur-md"
                            : ""
                        }`}
                        style={{
                          backgroundColor: resolvedCurrentCaptionStyle.background_color.startsWith("#")
                            ? `${resolvedCurrentCaptionStyle.background_color}${Math.round(resolvedCurrentCaptionStyle.background_opacity * 255).toString(16).padStart(2, "0")}`
                            : resolvedCurrentCaptionStyle.background_color,
                          borderRadius: `${resolvedCurrentCaptionStyle.background_radius || 24}px`,
                          padding: layout.box_style === "comic" ? "8px 18px" : "10px 24px",
                          boxShadow: layout.box_style === "comic"
                            ? "4px 4px 0px #000000"
                            : "0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.4)",
                        }}
                      >
                        <span style={{ color: resolvedCurrentCaptionStyle.color }}>{displayedText}</span>
                      </div>
                    ) : isQuote ? (
                      <div
                        onClick={onSelectThisCaption}
                        className="cursor-text flex items-start gap-2.5 rounded-xl border-l-4 border-amber-400 bg-zinc-950/85 p-3.5 shadow-2xl backdrop-blur-md text-left"
                      >
                        <span className="text-2xl font-serif leading-none text-amber-400 select-none">“</span>
                        <span className="flex-1 font-serif italic" style={{ color: resolvedCurrentCaptionStyle.color }}>
                          {displayedText}
                        </span>
                        <span className="text-2xl font-serif leading-none text-amber-400 self-end select-none">”</span>
                      </div>
                    ) : isEducation || isDebate ? (
                      <div
                        onClick={onSelectThisCaption}
                        className="cursor-text inline-flex flex-col items-center gap-1 rounded-xl bg-zinc-950/85 p-3 shadow-2xl border border-zinc-700/80 backdrop-blur-md"
                      >
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                            isDebate
                              ? "bg-amber-500 text-zinc-950 font-black"
                              : "bg-cyan-500 text-zinc-950 font-black"
                          }`}
                        >
                          {isDebate
                            ? resolvedCurrentCaptionStyle.preset_id === "question_pop"
                              ? "❓ PERTANYAAN"
                              : "🔥 DEBAT"
                            : resolvedCurrentCaptionStyle.preset_id === "definition_box"
                            ? "📖 DEFINISI"
                            : "💡 FAKTA"}
                        </span>
                        <span style={{ color: resolvedCurrentCaptionStyle.color }}>{displayedText}</span>
                      </div>
                    ) : isSticker ? (
                      <div
                        onClick={onSelectThisCaption}
                        className="cursor-text inline-block rounded-2xl border-4 border-white bg-amber-300 px-5 py-2.5 shadow-[0_12px_24px_rgba(0,0,0,0.6)] transform -rotate-2"
                      >
                        <span className="font-black text-zinc-950">{displayedText}</span>
                      </div>
                    ) : isWordProgress ? (
                      <span onClick={onSelectThisCaption} className="cursor-text inline-block">
                        {words.map((word, index) => {
                          const isActive = index === activeWordIndex;
                          const isPast = index < activeWordIndex;
                          const activeColor = behavior.highlight_color || resolvedCurrentCaptionStyle.karaoke_active_color || "#FFD600";
                          const inactiveColor = behavior.secondary_color || resolvedCurrentCaptionStyle.karaoke_inactive_color || "rgba(255,255,255,0.7)";
                          const pastColor = resolvedCurrentCaptionStyle.color || "#FFFFFF";
                          const isBoxHighlight = resolvedCurrentCaptionStyle.preset_id === "karaoke_box" || layout.box_style === "pill";

                          if (isActive) {
                            return (
                              <span
                                key={`${word}-${index}`}
                                className={`inline-block rounded-md px-1.5 py-0.5 mx-0.5 shadow-md ${
                                  isBoxHighlight ? "bg-cyan-600 text-white" : ""
                                }`}
                                style={{
                                  backgroundColor: isBoxHighlight
                                    ? undefined
                                    : "transparent",
                                  color: isBoxHighlight ? "#FFFFFF" : activeColor,
                                  fontWeight: "900",
                                  transform: `scale(${behavior.emphasis_scale || 1.15})`,
                                  textShadow: isBoxHighlight
                                    ? undefined
                                    : `0 0 12px ${activeColor}cc, 0 2px 4px rgba(0,0,0,0.9)`,
                                  transition: "all 0.12s ease",
                                }}
                              >
                                {word}
                                {index < words.length - 1 ? " " : ""}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={`${word}-${index}`}
                              style={{
                                color: isPast ? pastColor : inactiveColor,
                                opacity: isPast ? 0.95 : 0.65,
                                transition: "color 0.12s ease, opacity 0.12s ease",
                              }}
                            >
                              {word}
                              {index < words.length - 1 ? " " : ""}
                            </span>
                          );
                        })}
                      </span>
                    ) : isWordHighlight ? (
                      <span onClick={onSelectThisCaption} className="cursor-text inline-block">
                        {words.map((word, index) => {
                          const isHighlighted = highlightIndices.has(index);
                          const hlColor = behavior.highlight_color || "#FDE047";
                          const secColor = behavior.secondary_color || resolvedCurrentCaptionStyle.color;

                          if (isHighlighted) {
                            return (
                              <span
                                key={`${word}-${index}`}
                                className="inline-block rounded-md px-1.5 py-0.5 mx-0.5 shadow-md"
                                style={{
                                  backgroundColor: hlColor,
                                  color: "#000000",
                                  fontWeight: "900",
                                  transform: `scale(${behavior.emphasis_scale || 1.12})`,
                                  WebkitTextStroke: "0px transparent",
                                  transition: "transform 0.15s ease",
                                }}
                              >
                                {word}
                                {index < words.length - 1 ? " " : ""}
                              </span>
                            );
                          }
                          return (
                            <span
                              key={`${word}-${index}`}
                              style={{
                                color: secColor,
                              }}
                            >
                              {word}
                              {index < words.length - 1 ? " " : ""}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span
                        onClick={onSelectThisCaption}
                        className="cursor-text"
                        style={{ color: resolvedCurrentCaptionStyle.color }}
                      >
                        {displayedText}
                        {isTypewriter && <span className="caption-typewriter-cursor">|</span>}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* PLAYBACK CONTROL BAR (CapCut Style: Centered directly below 9:16 preview canvas) */}
          <div className="border-t border-zinc-800/80 bg-[#16181b] px-4 py-2.5 text-xs select-none">
            <div className="mx-auto flex max-w-[clamp(280px,36vw,460px)] items-center justify-center gap-3">
              {/* Reset to start button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  seekPreviewTo(0);
                }}
                title="Kembali ke Awal (00:00)"
                aria-label="Kembali ke Awal"
                className="flex h-8 items-center justify-center rounded-lg border border-zinc-700/80 bg-[#1f2227] px-2.5 text-xs text-zinc-400 hover:border-zinc-600 hover:text-cyan-300 active:scale-95 transition"
              >
                <span>⏮ Awal</span>
              </button>

              {/* Main Play / Pause Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (previewPlaying) {
                    handlePreviewPause();
                  } else {
                    handlePreviewPlay();
                  }
                }}
                title={previewPlaying ? "Jeda (Pause)" : "Putar (Play)"}
                aria-label={previewPlaying ? "Jeda" : "Putar"}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-3.5 font-bold active:scale-95 transition ${
                  previewPlaying
                    ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                    : "bg-cyan-500 text-black hover:bg-cyan-400 font-black shadow-md shadow-cyan-500/25"
                }`}
              >
                <span className="text-sm">{previewPlaying ? "⏸" : "▶"}</span>
                <span>{previewPlaying ? "Jeda" : "Putar"}</span>
              </button>

              {/* Clock Timer Indicator */}
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-[#1f2227] px-2.5 py-1 font-mono text-xs font-semibold text-zinc-300 shadow-inner">
                <span className="text-cyan-300 font-bold">{formatTimeLabel(previewTime)}</span>
                <span className="text-zinc-500">/</span>
                <span className="text-zinc-400">{formatTimeLabel(clipDuration)}</span>
              </div>

              {/* Audio Mute / Unmute Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAudioSettings({ muted: !audioSettings.muted });
                }}
                title={audioSettings.muted ? "Bunyikan Suara (Unmute)" : "Bisukan Suara (Mute)"}
                aria-label={audioSettings.muted ? "Bunyikan Suara" : "Bisukan Suara"}
                className={`flex h-8 items-center justify-center rounded-lg border px-2.5 text-xs font-semibold active:scale-95 transition ${
                  audioSettings.muted
                    ? "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                    : "border-zinc-700/80 bg-[#1f2227] text-zinc-300 hover:border-zinc-600 hover:text-white"
                }`}
              >
                <span>{audioSettings.muted ? "🔇 Muted" : "🔊 Audio"}</span>
              </button>
            </div>
          </div>

          {activeRender?.status === "failed" && (
            <div className="mx-4 mb-2 rounded-xl bg-red-950/70 p-2.5 text-xs font-semibold text-red-100">
              {activeRender.error_message || "Export gagal."}
            </div>
          )}
        </main>

        {/* RIGHT INSPECTOR PANEL (Context-Aware Item Properties) */}
        <aside className="editor-sidepanel editor-inspector min-h-0 bg-[#17191c] xl:h-full xl:overflow-y-auto p-3.5 space-y-4">
          {/* 1. PROJECT DETAILS (No Item Selected) */}
          {/* 1. PROJECT DETAILS (No Item Selected) */}
          {inspectorContext === "details" && (() => {
            const videoFileName =
              (manualEditorMode && (firstTimelineVideo?.name || (editorMediaQuery.data || [])[0]?.name)) ||
              context.data?.candidate_title ||
              draft?.original_hook ||
              "source_clip.mp4";

            const textEventsCount = effectTimeline.filter(
              (e) =>
                e.type === "hook_text" ||
                e.type === "keyword_popup" ||
                e.type === "text" ||
                e.type === "title" ||
                e.type === "quote" ||
                e.type === "lower_third" ||
                e.type === "watermark",
            ).length;
            const totalTextItems = editableCaptionCues.length + textEventsCount;

            const overlayEventsCount = effectTimeline.filter(
              (e) =>
                e.type === "sticker" ||
                e.type === "emoji" ||
                e.type === "shape" ||
                e.type === "arrow" ||
                e.type === "badge" ||
                e.type === "punch_zoom" ||
                e.type === "pattern_interrupt" ||
                e.type === "transition",
            ).length;

            const totalAudioTracks =
              (audioExtracted && !audioTrackDeleted ? 1 : 0) + additionalAudioTracks.length;

            return (
              <>
                <ToolSection title="Project & Clip">
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="inspector_project_title">Nama Project</label>
                      <input
                        id="inspector_project_title"
                        onChange={(event) => setUploadTitle(event.target.value)}
                        placeholder="Beri nama project..."
                        value={uploadTitle}
                      />
                    </div>
                  </div>
                </ToolSection>

                <ToolSection title="Informasi Video">
                  <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-[#1a1c20] p-2.5 text-xs">
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Source Video</span>
                      <span
                        className="max-w-[140px] truncate font-medium text-zinc-200"
                        title={videoFileName}
                      >
                        {videoFileName}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Mode Editor</span>
                      <span className="font-semibold text-zinc-200">
                        {manualEditorMode ? "Editor Manual" : "AutoClip AI"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Durasi Video</span>
                      <span className="font-mono font-bold text-cyan-300">
                        {formatTimeLabel(clipDuration)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Rasio & Resolusi</span>
                      <span className="font-mono text-zinc-200">
                        1080 × 1920 (9:16)
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-zinc-400">Status Media</span>
                      <span className="rounded bg-cyan-950/80 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
                        {manualEditorMode && videoSequence.length > 1
                          ? `Sequence (${videoSequence.length} file)`
                          : "Klip Utama"}
                      </span>
                    </div>
                  </div>
                </ToolSection>

                <ToolSection title="Ringkasan Layer & Item">
                  <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-[#1a1c20] p-2.5 text-xs">
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-cyan-400 font-bold">T</span>
                        <span>Item TEXT</span>
                      </span>
                      <span className="font-mono font-semibold text-zinc-200">
                        {totalTextItems} item {editableCaptionCues.length > 0 ? `(${editableCaptionCues.length} cue)` : ""}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-amber-400">★</span>
                        <span>Item OVERLAY</span>
                      </span>
                      <span className="font-mono font-semibold text-zinc-200">
                        {overlayEventsCount} item
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span className="text-emerald-400">🎵</span>
                        <span>Item AUDIO</span>
                      </span>
                      <span className="font-mono font-semibold text-zinc-200">
                        {totalAudioTracks > 0
                          ? `${totalAudioTracks} track ${audioExtracted ? "(Terpisah)" : ""}`
                          : audioExtracted
                          ? "1 track (Terpisah)"
                          : "Audio bawaan video"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span>💬</span>
                        <span>Status Caption</span>
                      </span>
                      <span className={`font-semibold ${editableCaptionCues.length > 0 ? "text-cyan-300" : "text-zinc-500"}`}>
                        {editableCaptionCues.length > 0 ? `Aktif (${editableCaptionCues.length} cue)` : "Belum dibuat"}
                      </span>
                    </div>
                  </div>
                </ToolSection>

                <ToolSection title="Status Editor">
                  <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-[#1a1c20] p-2.5 text-xs">
                    <div className="flex items-center justify-between py-0.5 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Autosave</span>
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
                        <span>Tersimpan otomatis</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-zinc-400">Preview Engine</span>
                      <span className="font-mono text-[11px] text-zinc-300">
                        {renderedPreviewUrl ? "Preview HD" : "Realtime Canvas"}
                      </span>
                    </div>
                  </div>
                </ToolSection>

                <ToolSection title="Export">
                  <button
                    className="btn-primary w-full py-2 text-xs font-bold shadow-lg shadow-cyan-950/40"
                    disabled={!canStartExport}
                    onClick={openExportModal}
                    type="button"
                  >
                    Export Video
                  </button>
                </ToolSection>
              </>
            );
          })()}

                {/* 2. VIDEO INSPECTOR */}
                {inspectorContext === "video" && (
                  <>
                    {/* TAB 1: VIDEO (Framing, Transform, Canvas, Blend, Timing, Actions) */}
                    {videoInspectorTab === "video" && (
                      <>
                        {/* 1. FRAMING */}
                          <ToolSection title="Framing & Canvas">
                            <div className="grid grid-cols-2 gap-2">
                              {videoFramingPresets.map((opt) => {
                                const isActive = isFramingPresetActive(opt.id);
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                      applyVideoFramingPreset(opt.id);
                                    }}
                                    className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-left transition-all ${
                                      isActive
                                        ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.3)] ring-1 ring-cyan-400/40"
                                        : "border-zinc-700/80 bg-[#1e2024] hover:border-zinc-500 hover:bg-[#25282e]"
                                    }`}
                                    title={`${opt.label}: ${opt.desc}`}
                                  >
                                    {/* 9:16 Visual Preview Thumbnail */}
                                    <div className="flex w-full items-center justify-center">
                                      <FramingThumbnailPreview presetId={opt.id} />
                                    </div>

                                    {/* Text Info */}
                                    <div className="w-full min-w-0 text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        <p className="truncate text-xs font-black text-zinc-100 group-hover:text-white">
                                          {opt.label}
                                        </p>
                                        {isActive && (
                                          <span className="size-1.5 rounded-full bg-cyan-400 shrink-0" />
                                        )}
                                      </div>
                                      <p className="truncate text-[10px] font-semibold text-zinc-400 group-hover:text-zinc-300">
                                        {opt.subLabel}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </ToolSection>

                          {/* 3. TRANSFORM */}
                          <ToolSection title="Transform">
                            <div className="space-y-3">
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-zinc-400">Scale / Zoom</span>
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoFraming.scale.toFixed(2)}x
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min="0.5"
                                    max="2.5"
                                    step="0.05"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={videoFraming.scale}
                                    onChange={(e) =>
                                      setVideoFraming({ scale: Number(e.target.value) })
                                    }
                                  />
                                  <input
                                    type="number"
                                    min="0.5"
                                    max="2.5"
                                    step="0.05"
                                    className="h-7 w-14 text-center font-mono text-xs"
                                    value={videoFraming.scale}
                                    onChange={(e) =>
                                      setVideoFraming({ scale: Number(e.target.value) })
                                    }
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Posisi X</span>
                                    <span className="font-mono font-bold text-zinc-300">
                                      {videoFraming.x.toFixed(0)}
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min="-40"
                                    max="40"
                                    step="1"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={videoFraming.x}
                                    onChange={(e) =>
                                      setVideoFraming({ x: Number(e.target.value) })
                                    }
                                  />
                                </div>
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Posisi Y</span>
                                    <span className="font-mono font-bold text-zinc-300">
                                      {videoFraming.y.toFixed(0)}
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min="-40"
                                    max="40"
                                    step="1"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={videoFraming.y}
                                    onChange={(e) =>
                                      setVideoFraming({ y: Number(e.target.value) })
                                    }
                                  />
                                </div>
                              </div>

                              <div>
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-zinc-400">Rotasi</span>
                                  <span className="font-mono font-bold text-zinc-300">
                                    {(videoFraming.rotation || 0).toFixed(0)}°
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="-180"
                                  max="180"
                                  step="1"
                                  className="h-1.5 w-full accent-cyan-400"
                                  value={videoFraming.rotation || 0}
                                  onChange={(e) =>
                                    setVideoFraming({ rotation: Number(e.target.value) })
                                  }
                                />
                              </div>

                              {/* Quick Nudge + Reset Buttons */}
                              <div className="flex items-center gap-1.5 border-t border-zinc-800/80 pt-1">
                                <div className="grid flex-1 grid-cols-4 gap-1">
                                  <button
                                    type="button"
                                    className="btn-secondary h-7 px-1 text-center text-xs font-bold"
                                    onClick={() =>
                                      setVideoFraming({ x: Math.max(-40, videoFraming.x - 2) })
                                    }
                                    title="Geser Kiri"
                                  >
                                    ←
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary h-7 px-1 text-center text-xs font-bold"
                                    onClick={() =>
                                      setVideoFraming({ y: Math.max(-40, videoFraming.y - 2) })
                                    }
                                    title="Geser Atas"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary h-7 px-1 text-center text-xs font-bold"
                                    onClick={() =>
                                      setVideoFraming({ y: Math.min(40, videoFraming.y + 2) })
                                    }
                                    title="Geser Bawah"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-secondary h-7 px-1 text-center text-xs font-bold"
                                    onClick={() =>
                                      setVideoFraming({ x: Math.min(40, videoFraming.x + 2) })
                                    }
                                    title="Geser Kanan"
                                  >
                                    →
                                  </button>
                                </div>
                                <button
                                  type="button"
                                  className="btn-secondary h-7 px-2.5 text-xs font-semibold text-zinc-300"
                                  onClick={() =>
                                    setVideoFraming({ x: 0, y: 0, scale: 1, rotation: 0 })
                                  }
                                  title="Reset Transform"
                                >
                                  Reset
                                </button>
                              </div>
                            </div>
                          </ToolSection>

                          {/* 4. FLIP */}
                          <CollapsibleToolSection
                            title="Flip & Cermin"
                            badge={
                              videoFraming.flip_h || videoFraming.flip_v ? "Aktif" : undefined
                            }
                          >
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition ${
                                  videoFraming.flip_h
                                    ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                    : "border-zinc-700/80 bg-[#1e2024] text-zinc-300 hover:text-white"
                                }`}
                                onClick={() =>
                                  setVideoFraming({ flip_h: !videoFraming.flip_h })
                                }
                              >
                                <span>⇄</span>
                                <span>Horizontal</span>
                              </button>
                              <button
                                type="button"
                                className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition ${
                                  videoFraming.flip_v
                                    ? "border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                    : "border-zinc-700/80 bg-[#1e2024] text-zinc-300 hover:text-white"
                                }`}
                                onClick={() =>
                                  setVideoFraming({ flip_v: !videoFraming.flip_v })
                                }
                              >
                                <span>⇅</span>
                                <span>Vertical</span>
                              </button>
                            </div>
                          </CollapsibleToolSection>

                          {/* 5. CANVAS / BACKGROUND */}
                          <CollapsibleToolSection
                            title="Canvas & Background"
                            badge={
                              videoFraming.blur_background || preset === "blurred_background"
                                ? "Blur"
                                : undefined
                            }
                          >
                            <div className="space-y-3">
                              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200">
                                <input
                                  type="checkbox"
                                  className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                  checked={
                                    videoFraming.blur_background ||
                                    preset === "blurred_background"
                                  }
                                  onChange={(e) => {
                                    const isChecked = e.target.checked;
                                    if (isChecked) {
                                      applyVideoFramingPreset("blurred_background");
                                    } else {
                                      applyVideoFramingPreset("fit_background");
                                    }
                                  }}
                                />
                                <span className="font-medium">Aktifkan Background Blur</span>
                              </label>

                              {(videoFraming.blur_background ||
                                preset === "blurred_background") && (
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">
                                      Intensitas Blur
                                    </span>
                                    <span className="font-mono font-bold text-cyan-300">
                                      {videoFraming.blur_strength || 20}px
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min="5"
                                    max="50"
                                    step="1"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={videoFraming.blur_strength || 20}
                                    onChange={(e) =>
                                      setVideoFraming({
                                        blur_strength: Number(e.target.value),
                                      })
                                    }
                                  />
                                </div>
                              )}

                              <div>
                                <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                                  Warna Latar (Canvas Color)
                                </label>
                                <div className="flex items-center gap-2">
                                  <div className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
                                    <input
                                      type="color"
                                      aria-label="Pilih warna latar canvas"
                                      className="absolute -inset-2 size-12 cursor-pointer opacity-0"
                                      value={videoFraming.background_color || "#000000"}
                                      onChange={(e) =>
                                        setVideoFraming({ background_color: e.target.value })
                                      }
                                    />
                                    <div
                                      className="size-full rounded-lg"
                                      style={{
                                        backgroundColor:
                                          videoFraming.background_color || "#000000",
                                      }}
                                    />
                                  </div>
                                  <input
                                    type="text"
                                    aria-label="Hex warna latar canvas"
                                    className="h-8 flex-1 font-mono text-xs uppercase"
                                    value={videoFraming.background_color || "#000000"}
                                    onChange={(e) =>
                                      setVideoFraming({ background_color: e.target.value })
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          </CollapsibleToolSection>

                          {/* 6. BLEND */}
                          <CollapsibleToolSection
                            title="Blend & Opacity"
                            badge={`${Math.round((videoFraming.opacity ?? 1) * 100)}%`}
                          >
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-400">Opacity Video</span>
                                <span className="font-mono font-bold text-cyan-300">
                                  {Math.round((videoFraming.opacity ?? 1) * 100)}%
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoFraming.opacity ?? 1}
                                onChange={(e) =>
                                  setVideoFraming({ opacity: Number(e.target.value) })
                                }
                              />
                            </div>
                          </CollapsibleToolSection>

                          {/* 7. TIMING */}
                          <CollapsibleToolSection title="Timing Video">
                            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                              <div className="rounded-lg bg-zinc-800/80 p-2">
                                <span className="block text-[10px] text-zinc-500">Mulai</span>
                                <p className="font-mono font-bold text-zinc-100">0.00s</p>
                              </div>
                              <div className="rounded-lg bg-zinc-800/80 p-2">
                                <span className="block text-[10px] text-zinc-500">Selesai</span>
                                <p className="font-mono font-bold text-zinc-100">
                                  {clipDuration.toFixed(2)}s
                                </p>
                              </div>
                              <div className="rounded-lg bg-zinc-800/80 p-2">
                                <span className="block text-[10px] text-zinc-500">Durasi</span>
                                <p className="font-mono font-bold text-cyan-300">
                                  {clipDuration.toFixed(2)}s
                                </p>
                              </div>
                            </div>
                          </CollapsibleToolSection>

                          {/* 8. ACTIONS */}
                          <ToolSection title="Actions">
                            <div className="space-y-2">
                              <button
                                type="button"
                                className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                                onClick={() => {
                                  setVideoAdjustments(defaultVideoAdjustments);
                                  setVideoSpeed(1.0);
                                  applyVideoFramingPreset("blurred_background");
                                  setMessage("Pengaturan video direset ke default.");
                                }}
                              >
                                Reset Video Style
                              </button>
                              <button
                                type="button"
                                className={`w-full rounded-lg border py-1.5 text-xs font-bold transition ${
                                  videoTrackDeleted
                                    ? "border-emerald-800/60 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60"
                                    : "border-red-800/60 bg-red-900/40 text-red-300 hover:bg-red-900/60"
                                }`}
                                onClick={() => {
                                  setStyle("video_track_deleted", !videoTrackDeleted);
                                  setMessage(
                                    videoTrackDeleted
                                      ? "Video track dipulihkan."
                                      : "Video track dinonaktifkan.",
                                  );
                                }}
                              >
                                {videoTrackDeleted ? "Pulihkan Video Track" : "Hapus Video Track"}
                              </button>
                            </div>
                          </ToolSection>
                        </>
                      )}

                    {/* TAB 2: ADJUST */}
                    {videoInspectorTab === "adjust" && (
                      <>
                        <ToolSection title="Koreksi Warna Dasar">
                          <div className="space-y-3">
                            {/* Brightness */}
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-300">Brightness</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoAdjustments.brightness > 0
                                      ? `+${videoAdjustments.brightness}`
                                      : videoAdjustments.brightness}
                                    %
                                  </span>
                                  {videoAdjustments.brightness !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setVideoAdjustments({ brightness: 0 })}
                                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                      title="Reset Brightness"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoAdjustments.brightness}
                                onChange={(e) =>
                                  setVideoAdjustments({ brightness: Number(e.target.value) })
                                }
                              />
                            </div>

                            {/* Contrast */}
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-300">Contrast</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoAdjustments.contrast > 0
                                      ? `+${videoAdjustments.contrast}`
                                      : videoAdjustments.contrast}
                                    %
                                  </span>
                                  {videoAdjustments.contrast !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setVideoAdjustments({ contrast: 0 })}
                                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                      title="Reset Contrast"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoAdjustments.contrast}
                                onChange={(e) =>
                                  setVideoAdjustments({ contrast: Number(e.target.value) })
                                }
                              />
                            </div>

                            {/* Saturation */}
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-300">Saturation</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoAdjustments.saturation > 0
                                      ? `+${videoAdjustments.saturation}`
                                      : videoAdjustments.saturation}
                                    %
                                  </span>
                                  {videoAdjustments.saturation !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setVideoAdjustments({ saturation: 0 })}
                                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                      title="Reset Saturation"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoAdjustments.saturation}
                                onChange={(e) =>
                                  setVideoAdjustments({ saturation: Number(e.target.value) })
                                }
                              />
                            </div>

                            {/* Temperature */}
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-300">Temperature</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoAdjustments.temperature > 0
                                      ? `+${videoAdjustments.temperature} (Warm)`
                                      : videoAdjustments.temperature < 0
                                      ? `${videoAdjustments.temperature} (Cool)`
                                      : "0"}
                                  </span>
                                  {videoAdjustments.temperature !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setVideoAdjustments({ temperature: 0 })}
                                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                      title="Reset Temperature"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min="-100"
                                max="100"
                                step="1"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoAdjustments.temperature}
                                onChange={(e) =>
                                  setVideoAdjustments({ temperature: Number(e.target.value) })
                                }
                              />
                            </div>

                            {/* Blur */}
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-300">Blur</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoAdjustments.blur}px
                                  </span>
                                  {videoAdjustments.blur !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setVideoAdjustments({ blur: 0 })}
                                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                      title="Reset Blur"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="20"
                                step="0.5"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoAdjustments.blur}
                                onChange={(e) =>
                                  setVideoAdjustments({ blur: Number(e.target.value) })
                                }
                              />
                            </div>

                            {/* Vignette */}
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-300">Vignette</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-cyan-300">
                                    {videoAdjustments.vignette}%
                                  </span>
                                  {videoAdjustments.vignette !== 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setVideoAdjustments({ vignette: 0 })}
                                      className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                      title="Reset Vignette"
                                    >
                                      ↺
                                    </button>
                                  )}
                                </div>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoAdjustments.vignette}
                                onChange={(e) =>
                                  setVideoAdjustments({ vignette: Number(e.target.value) })
                                }
                              />
                            </div>
                          </div>
                        </ToolSection>

                        <ToolSection title="Actions">
                          <button
                            type="button"
                            className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                            onClick={() => {
                              setVideoAdjustments(defaultVideoAdjustments);
                              setMessage("Koreksi warna video direset.");
                            }}
                          >
                            Reset Semua Koreksi Warna
                          </button>
                        </ToolSection>
                      </>
                    )}

                    {/* TAB 3: SPEED */}
                    {videoInspectorTab === "speed" && (
                      <>
                        <ToolSection title="Kecepatan Putar (Playback Speed)">
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-zinc-400">Kecepatan</span>
                                <span className="font-mono font-bold text-cyan-300">
                                  {videoSpeed.toFixed(2)}x{" "}
                                  {videoSpeed === 1
                                    ? "(Normal)"
                                    : videoSpeed > 1
                                    ? "(Cepat)"
                                    : "(Lambat)"}
                                </span>
                              </div>
                              <input
                                type="range"
                                min="0.25"
                                max="4.0"
                                step="0.05"
                                className="h-1.5 w-full accent-cyan-400"
                                value={videoSpeed}
                                onChange={(e) => setVideoSpeed(Number(e.target.value))}
                              />
                            </div>

                            {/* Quick Speed Preset Buttons */}
                            <div>
                              <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                Preset Kecepatan
                              </span>
                              <div className="grid grid-cols-4 gap-1">
                                {[0.5, 1.0, 1.5, 2.0].map((spd) => (
                                  <button
                                    key={spd}
                                    type="button"
                                    className={`h-7 rounded text-xs font-semibold transition ${
                                      videoSpeed === spd
                                        ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 font-bold"
                                        : "border border-zinc-700/80 bg-[#1e2024] text-zinc-400 hover:text-zinc-200"
                                    }`}
                                    onClick={() => setVideoSpeed(spd)}
                                  >
                                    {spd}x
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Duration Preview Card */}
                            {(() => {
                              const videoBaseDuration = videoSequence.reduce(
                                (acc, s) => acc + Math.max(0, s.sourceEnd - s.sourceStart),
                                0,
                              ) || originalClipDuration;
                              return (
                                <div className="rounded-lg border border-zinc-800 bg-[#1a1c20] p-2.5 text-[11px]">
                                  <div className="flex items-center justify-between text-zinc-400">
                                    <span>Durasi Asli Track</span>
                                    <span className="font-mono text-zinc-300">
                                      {videoBaseDuration.toFixed(2)}s
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between border-t border-zinc-800/60 pt-1 text-zinc-400">
                                    <span>Durasi Efektif ({videoSpeed.toFixed(2)}x)</span>
                                    <span className="font-mono font-bold text-cyan-300">
                                      {videoLayout.duration.toFixed(2)}s
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </ToolSection>

                        <ToolSection title="Actions">
                          <button
                            type="button"
                            className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                            onClick={() => {
                              setVideoSpeed(1.0);
                              setMessage("Kecepatan video dikembalikan ke 1.0x (Normal).");
                            }}
                          >
                            Reset Speed (1.0x)
                          </button>
                        </ToolSection>
                      </>
                    )}

                    {/* TAB 4: AUDIO */}
                    {videoInspectorTab === "audio" && (
                      <>
                        {audioExtracted ? (
                          <>
                            <ToolSection title="Status Audio">
                              <div className="rounded-lg border border-cyan-800/60 bg-cyan-950/30 p-3 text-xs">
                                <div className="mb-1 flex items-center gap-1.5 font-bold text-cyan-300">
                                  <span>ℹ️</span>
                                  <span>Audio Sudah Dipisahkan</span>
                                </div>
                                <p className="text-[11px] leading-relaxed text-zinc-300">
                                  Audio video sudah diekstrak ke track <strong>AUDIO</strong>. Atur volume, mute, fade, dan timing melalui <strong>Audio Inspector</strong> dengan memilih track Audio pada timeline.
                                </p>
                              </div>
                            </ToolSection>

                            <ToolSection title="Ekstrak & Gabungkan">
                              <button
                                className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                                onClick={mergeAudioIntoVideoTrack}
                                type="button"
                              >
                                Gabungkan Audio ke Video
                              </button>
                            </ToolSection>
                          </>
                        ) : (
                          <>
                            <ToolSection title="Audio Bawaan Video">
                              <div className="space-y-3">
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Volume Klip</span>
                                    <span className="font-mono font-bold text-cyan-300">
                                      {Math.round(audioSettings.volume * 100)}%
                                    </span>
                                  </div>
                                  <input
                                    className="h-1.5 w-full accent-cyan-400"
                                    id="inspector_video_audio_volume"
                                    max="2"
                                    min="0"
                                    step="0.05"
                                    type="range"
                                    value={audioSettings.volume}
                                    onChange={(e) =>
                                      setAudioSettings({ volume: Number(e.target.value) })
                                    }
                                  />
                                </div>

                                <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-zinc-200">
                                  <input
                                    checked={audioSettings.muted}
                                    className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                    type="checkbox"
                                    onChange={(e) =>
                                      setAudioSettings({ muted: e.target.checked })
                                    }
                                  />
                                  <span className="font-medium">Bisukan Suara Video (Mute)</span>
                                </label>
                              </div>
                            </ToolSection>

                            <CollapsibleToolSection
                              title="Fade Audio"
                              badge={
                                audioSettings.fade_in || audioSettings.fade_out ? "Aktif" : undefined
                              }
                            >
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Fade In</span>
                                    <span className="font-mono font-bold text-zinc-300">
                                      {(audioSettings.fade_in || 0).toFixed(1)}s
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="5"
                                    step="0.1"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={audioSettings.fade_in || 0}
                                    onChange={(e) =>
                                      setAudioSettings({ fade_in: Number(e.target.value) })
                                    }
                                  />
                                </div>
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Fade Out</span>
                                    <span className="font-mono font-bold text-zinc-300">
                                      {(audioSettings.fade_out || 0).toFixed(1)}s
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="5"
                                    step="0.1"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={audioSettings.fade_out || 0}
                                    onChange={(e) =>
                                      setAudioSettings({ fade_out: Number(e.target.value) })
                                    }
                                  />
                                </div>
                              </div>
                            </CollapsibleToolSection>

                            <ToolSection title="Ekstrak Track Audio">
                              <button
                                className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                                onClick={extractAudioTrack}
                                type="button"
                              >
                                Ekstrak Audio ke Track Terpisah
                              </button>
                            </ToolSection>

                            <ToolSection title="Actions">
                              <button
                                type="button"
                                className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                                onClick={() => {
                                  setAudioSettings({
                                    volume: 1.0,
                                    muted: false,
                                    fade_in: 0,
                                    fade_out: 0,
                                  });
                                  setMessage("Pengaturan audio video direset.");
                                }}
                              >
                                Reset Audio
                              </button>
                            </ToolSection>
                          </>
                        )}
                      </>
                    )}
                  </>
                )}

                {/* 3. AUDIO INSPECTOR */}
                {inspectorContext === "audio" && (() => {
                  const selectedTrack = selectedAdditionalAudioTrackId
                    ? additionalAudioTracks.find((t) => t.id === selectedAdditionalAudioTrackId)
                    : null;
                  const isAdditional = Boolean(selectedTrack);

                  const currentVolume = isAdditional
                    ? selectedTrack?.volume ?? 1
                    : audioSettings.volume;
                  const currentMuted = isAdditional
                    ? Boolean(selectedTrack?.muted)
                    : audioSettings.muted;
                  const currentFadeIn = isAdditional
                    ? selectedTrack?.fade_in || 0
                    : audioSettings.fade_in || 0;
                  const currentFadeOut = isAdditional
                    ? selectedTrack?.fade_out || 0
                    : audioSettings.fade_out || 0;
                  const currentSpeed = isAdditional
                    ? selectedTrack?.speed || 1.0
                    : audioSettings.speed || 1.0;
                  const audioBaseDuration = audioSequence.reduce(
                    (acc, s) => acc + Math.max(0, s.sourceEnd - s.sourceStart),
                    0,
                  ) || originalClipDuration;
                  const currentBaseDuration = isAdditional
                    ? (selectedTrack?.base_duration || Math.max(0.1, (selectedTrack?.end ?? 0) - (selectedTrack?.start ?? 0)))
                    : audioBaseDuration;
                  const currentEffectiveDuration = isAdditional
                    ? (currentBaseDuration / currentSpeed)
                    : audioLayout.duration;

                  const updateVolume = (val: number) => {
                    const clean = Math.max(0, Math.min(2, val));
                    if (isAdditional && selectedTrack) {
                      updateAdditionalAudioTrack(selectedTrack.id, { volume: clean });
                    } else {
                      setAudioSettings({ volume: clean });
                    }
                  };
                  const updateMuted = (muted: boolean) => {
                    if (isAdditional && selectedTrack) {
                      updateAdditionalAudioTrack(selectedTrack.id, { muted });
                    } else {
                      setAudioSettings({ muted });
                    }
                  };
                  const updateFade = (patch: { fade_in?: number; fade_out?: number }) => {
                    if (isAdditional && selectedTrack) {
                      updateAdditionalAudioTrack(selectedTrack.id, patch);
                    } else {
                      setAudioSettings(patch);
                    }
                  };
                  const updateSpeed = (speed: number) => {
                    const clean = Math.max(0.5, Math.min(2.0, speed));
                    if (isAdditional && selectedTrack) {
                      updateAdditionalAudioTrack(selectedTrack.id, { speed: clean });
                    } else {
                      setAudioSettings({ speed: clean });
                    }
                  };
                  const resetAudio = () => {
                    if (isAdditional && selectedTrack) {
                      updateAdditionalAudioTrack(selectedTrack.id, {
                        volume: 1.0,
                        muted: false,
                        fade_in: 0,
                        fade_out: 0,
                        speed: 1.0,
                        loop: false,
                      });
                    } else {
                      setAudioSettings({
                        volume: 1.0,
                        muted: false,
                        fade_in: 0,
                        fade_out: 0,
                        speed: 1.0,
                      });
                    }
                    setMessage("Pengaturan audio direset ke default.");
                  };

                  const trackTypeBadge = isAdditional
                    ? selectedTrack?.asset_id.startsWith("sfx-") || selectedTrack?.kind === "sfx"
                      ? { label: "Sound Effect", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" }
                      : selectedTrack?.asset_id.startsWith("mus-") || selectedTrack?.kind === "backsound"
                      ? { label: "Backsound", color: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30" }
                      : { label: "Upload", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" }
                    : { label: "Extracted", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" };

                  const trackDisplayName = isAdditional
                    ? selectedTrack?.label || "Audio Track"
                    : "Audio Asli Video";

                  return (
                    <>
                      {/* TAB 1: AUDIO */}
                      {audioInspectorTab === "audio" && (
                        <>
                          {/* 1. AUDIO IDENTITY */}
                          <ToolSection title="Identitas Audio">
                            <div className="space-y-2.5 rounded-lg border border-zinc-800/80 bg-[#1a1c20] p-2.5 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-zinc-400">Tipe Audio</span>
                                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${trackTypeBadge.color}`}>
                                  {trackTypeBadge.label}
                                </span>
                              </div>
                              {isAdditional && selectedTrack ? (
                                <div>
                                  <label htmlFor="inspector_audio_label" className="text-zinc-400 text-[11px] block mb-1">
                                    Nama Track
                                  </label>
                                  <input
                                    id="inspector_audio_label"
                                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-cyan-400"
                                    value={selectedTrack.label}
                                    onChange={(e) =>
                                      updateAdditionalAudioTrack(selectedTrack.id, {
                                        label: e.target.value,
                                      })
                                    }
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center justify-between border-t border-zinc-800/60 pt-1.5">
                                  <span className="text-zinc-400">Sumber</span>
                                  <span className="font-medium text-zinc-200 truncate max-w-[150px]">
                                    {trackDisplayName}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between border-t border-zinc-800/60 pt-1.5">
                                <span className="text-zinc-400">Durasi</span>
                                <span className="font-mono font-bold text-cyan-300">
                                  {currentEffectiveDuration.toFixed(2)}s
                                </span>
                              </div>
                            </div>
                          </ToolSection>

                          {/* 2. VOLUME */}
                          <ToolSection title="Volume & Mute">
                            <div className="space-y-3">
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-zinc-400">Volume</span>
                                  <span className="font-mono font-bold text-cyan-300">
                                    {Math.round(currentVolume * 100)}%
                                  </span>
                                </div>
                                <input
                                  className="h-1.5 w-full accent-cyan-400"
                                  id="inspector_audio_volume_slider"
                                  max="2"
                                  min="0"
                                  step="0.05"
                                  type="range"
                                  value={currentVolume}
                                  onChange={(e) => updateVolume(Number(e.target.value))}
                                />
                              </div>

                              {/* Quick volume preset buttons */}
                              <div>
                                <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                  Preset Volume
                                </span>
                                <div className="grid grid-cols-4 gap-1">
                                  {[0, 0.5, 1.0, 1.5].map((vol) => (
                                    <button
                                      key={vol}
                                      type="button"
                                      className={`h-7 rounded text-xs font-semibold transition ${
                                        Math.abs(currentVolume - vol) < 0.01
                                          ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 font-bold"
                                          : "border border-zinc-700/80 bg-[#1e2024] text-zinc-400 hover:text-zinc-200"
                                      }`}
                                      onClick={() => updateVolume(vol)}
                                    >
                                      {Math.round(vol * 100)}%
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-zinc-200">
                                <input
                                  checked={currentMuted}
                                  className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                  type="checkbox"
                                  onChange={(e) => updateMuted(e.target.checked)}
                                />
                                <span className="font-medium">Bisukan Suara (Mute)</span>
                              </label>
                            </div>
                          </ToolSection>

                          {/* 3. PLAYBACK (Loop for BGM/Upload) */}
                          {isAdditional && selectedTrack && selectedTrack.kind !== "sfx" && (
                            <ToolSection title="Playback">
                              <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-zinc-200">
                                <input
                                  checked={Boolean(selectedTrack.loop)}
                                  className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                  type="checkbox"
                                  onChange={(e) =>
                                    updateAdditionalAudioTrack(selectedTrack.id, {
                                      loop: e.target.checked,
                                    })
                                  }
                                />
                                <span className="font-medium">Loop Audio (Ulangi Otomatis)</span>
                              </label>
                            </ToolSection>
                          )}

                          {/* 4. AUDIO ACTIONS */}
                          <ToolSection title="Actions">
                            <div className="space-y-2">
                              {!isAdditional && (
                                <button
                                  className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                                  onClick={mergeAudioIntoVideoTrack}
                                  type="button"
                                >
                                  Gabungkan Audio ke Video
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                                onClick={resetAudio}
                              >
                                Reset Audio
                              </button>
                              {isAdditional && selectedTrack && (
                                <button
                                  type="button"
                                  onClick={() => deleteAdditionalAudioTrack(selectedTrack.id)}
                                  className="w-full rounded-lg border border-red-800/60 bg-red-900/40 py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60 transition"
                                >
                                  Hapus Track Audio
                                </button>
                              )}
                              {!isAdditional && (
                                <button
                                  type="button"
                                  className={`w-full rounded-lg border py-1.5 text-xs font-bold transition ${
                                    audioTrackDeleted
                                      ? "border-emerald-800/60 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60"
                                      : "border-red-800/60 bg-red-900/40 text-red-300 hover:bg-red-900/60"
                                  }`}
                                  onClick={() => {
                                    setStyle("audio_track_deleted", !audioTrackDeleted);
                                    setMessage(
                                      audioTrackDeleted
                                        ? "Audio track dipulihkan."
                                        : "Audio track dinonaktifkan.",
                                    );
                                  }}
                                >
                                  {audioTrackDeleted ? "Pulihkan Track Audio" : "Hapus Track Audio"}
                                </button>
                              )}
                            </div>
                          </ToolSection>
                        </>
                      )}

                      {/* TAB 2: FADE */}
                      {audioInspectorTab === "fade" && (
                        <>
                          <ToolSection title="Fade Audio">
                            <div className="space-y-3">
                              {/* Fade In */}
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-zinc-400">Fade In</span>
                                  <span className="font-mono font-bold text-zinc-300">
                                    {currentFadeIn.toFixed(1)}s
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="10"
                                  step="0.1"
                                  className="h-1.5 w-full accent-cyan-400"
                                  value={currentFadeIn}
                                  onChange={(e) => updateFade({ fade_in: Number(e.target.value) })}
                                />
                              </div>

                              {/* Fade Out */}
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-zinc-400">Fade Out</span>
                                  <span className="font-mono font-bold text-zinc-300">
                                    {currentFadeOut.toFixed(1)}s
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="10"
                                  step="0.1"
                                  className="h-1.5 w-full accent-cyan-400"
                                  value={currentFadeOut}
                                  onChange={(e) => updateFade({ fade_out: Number(e.target.value) })}
                                />
                              </div>

                              {/* Quick Fade Presets */}
                              <div>
                                <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                  Preset Fade
                                </span>
                                <div className="grid grid-cols-4 gap-1">
                                  {[
                                    { label: "None", inVal: 0, outVal: 0 },
                                    { label: "Soft", inVal: 0.5, outVal: 0.5 },
                                    { label: "Medium", inVal: 1.5, outVal: 1.5 },
                                    { label: "Long", inVal: 3.0, outVal: 3.0 },
                                  ].map((p) => (
                                    <button
                                      key={p.label}
                                      type="button"
                                      className={`h-7 rounded text-xs font-semibold transition ${
                                        Math.abs(currentFadeIn - p.inVal) < 0.05 &&
                                        Math.abs(currentFadeOut - p.outVal) < 0.05
                                          ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 font-bold"
                                          : "border border-zinc-700/80 bg-[#1e2024] text-zinc-400 hover:text-zinc-200"
                                      }`}
                                      onClick={() =>
                                        updateFade({ fade_in: p.inVal, fade_out: p.outVal })
                                      }
                                    >
                                      {p.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </ToolSection>

                          <ToolSection title="Actions">
                            <button
                              type="button"
                              className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                              onClick={() => updateFade({ fade_in: 0, fade_out: 0 })}
                            >
                              Reset Fade
                            </button>
                          </ToolSection>
                        </>
                      )}

                      {/* TAB 3: SPEED */}
                      {audioInspectorTab === "speed" && (
                        <>
                          <ToolSection title="Kecepatan Putar Audio">
                            <div className="space-y-3">
                              {/* Slider Speed */}
                              <div>
                                <div className="mb-1 flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-zinc-300">Kecepatan</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-cyan-300">
                                      {currentSpeed.toFixed(2)}x
                                    </span>
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                        currentSpeed === 1
                                          ? "bg-zinc-800 text-zinc-400"
                                          : currentSpeed > 1
                                          ? "bg-cyan-950 text-cyan-300 border border-cyan-800/60"
                                          : "bg-amber-950 text-amber-300 border border-amber-800/60"
                                      }`}
                                    >
                                      {currentSpeed === 1
                                        ? "Normal"
                                        : currentSpeed > 1
                                        ? "Cepat"
                                        : "Lambat"}
                                    </span>
                                  </div>
                                </div>
                                <input
                                  type="range"
                                  min="0.5"
                                  max="2.0"
                                  step="0.05"
                                  className="h-1.5 w-full accent-cyan-400"
                                  value={currentSpeed}
                                  onChange={(e) => updateSpeed(Number(e.target.value))}
                                />
                              </div>

                              {/* Quick Speed Presets */}
                              <div>
                                <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                  Preset Kecepatan
                                </span>
                                <div className="grid grid-cols-4 gap-1">
                                  {[0.75, 1.0, 1.25, 1.5].map((spd) => (
                                    <button
                                      key={spd}
                                      type="button"
                                      className={`h-7 rounded text-xs font-semibold transition ${
                                        Math.abs(currentSpeed - spd) < 0.01
                                          ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 font-bold"
                                          : "border border-zinc-700/80 bg-[#1e2024] text-zinc-400 hover:text-zinc-200"
                                      }`}
                                      onClick={() => updateSpeed(spd)}
                                    >
                                      {spd}x
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Duration Preview Card */}
                              <div className="rounded-lg border border-zinc-800 bg-[#1a1c20] p-2.5 text-[11px]">
                                <div className="flex items-center justify-between text-zinc-400">
                                  <span>Durasi Asli Track</span>
                                  <span className="font-mono text-zinc-300">
                                    {currentBaseDuration.toFixed(2)}s
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between border-t border-zinc-800/60 pt-1 text-zinc-400">
                                  <span>Durasi Efektif ({currentSpeed.toFixed(2)}x)</span>
                                  <span className="font-mono font-bold text-cyan-300">
                                    {currentEffectiveDuration.toFixed(2)}s
                                  </span>
                                </div>
                              </div>
                            </div>
                          </ToolSection>

                          <ToolSection title="Actions">
                            <button
                              type="button"
                              className="btn-secondary w-full py-1.5 text-xs font-bold text-zinc-300 hover:text-white"
                              onClick={() => updateSpeed(1.0)}
                            >
                              Reset Speed (1.0x)
                            </button>
                          </ToolSection>
                        </>
                      )}

                      {/* TAB 4: TIMING */}
                      {audioInspectorTab === "timing" && (
                        <>
                          <ToolSection title="Durasi & Posisi Audio">
                            {isAdditional && selectedTrack ? (
                              <div className="space-y-3">
                                {/* Start Time with Nudge */}
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Waktu Mulai</span>
                                    <span className="font-mono font-bold text-zinc-200">
                                      {selectedTrack.start.toFixed(2)}s
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="btn-secondary h-7 flex-1 text-xs font-semibold"
                                      onClick={() => {
                                        const newStart = Math.max(0, Number((selectedTrack.start - 0.1).toFixed(2)));
                                        if (newStart < selectedTrack.end) {
                                          updateAdditionalAudioTrack(selectedTrack.id, { start: newStart });
                                        }
                                      }}
                                    >
                                      ← -0.1s
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary h-7 flex-1 text-xs font-semibold"
                                      onClick={() => {
                                        const newStart = Math.min(selectedTrack.end - 0.1, Number((selectedTrack.start + 0.1).toFixed(2)));
                                        updateAdditionalAudioTrack(selectedTrack.id, { start: Math.max(0, newStart) });
                                      }}
                                    >
                                      +0.1s →
                                    </button>
                                  </div>
                                </div>

                                {/* End Time with Nudge */}
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Waktu Selesai</span>
                                    <span className="font-mono font-bold text-zinc-200">
                                      {selectedTrack.end.toFixed(2)}s
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      className="btn-secondary h-7 flex-1 text-xs font-semibold"
                                      onClick={() => {
                                        const newEnd = Math.max(selectedTrack.start + 0.1, Number((selectedTrack.end - 0.1).toFixed(2)));
                                        updateAdditionalAudioTrack(selectedTrack.id, { end: newEnd });
                                      }}
                                    >
                                      ← -0.1s
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary h-7 flex-1 text-xs font-semibold"
                                      onClick={() => {
                                        const newEnd = Math.min(clipDuration, Number((selectedTrack.end + 0.1).toFixed(2)));
                                        updateAdditionalAudioTrack(selectedTrack.id, { end: newEnd });
                                      }}
                                    >
                                      +0.1s →
                                    </button>
                                  </div>
                                </div>

                                {/* Duration & Position Nudge Card */}
                                <div className="space-y-2 rounded-lg border border-zinc-800 bg-[#1a1c20] p-2.5 text-xs">
                                  <div className="flex items-center justify-between">
                                    <span className="text-zinc-400">Total Durasi</span>
                                    <span className="font-mono font-bold text-cyan-300">
                                      {(selectedTrack.end - selectedTrack.start).toFixed(2)}s
                                    </span>
                                  </div>
                                  <div className="border-t border-zinc-800/60 pt-2">
                                    <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                      Geser Posisi Track
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        className="btn-secondary h-7 flex-1 text-xs font-semibold"
                                        onClick={() => {
                                          const dur = selectedTrack.end - selectedTrack.start;
                                          const newStart = Math.max(0, Number((selectedTrack.start - 0.5).toFixed(2)));
                                          updateAdditionalAudioTrack(selectedTrack.id, {
                                            start: newStart,
                                            end: Number((newStart + dur).toFixed(2)),
                                          });
                                        }}
                                      >
                                        ← Geser -0.5s
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-secondary h-7 flex-1 text-xs font-semibold"
                                        onClick={() => {
                                          const dur = selectedTrack.end - selectedTrack.start;
                                          const newStart = Math.min(
                                            Math.max(0, clipDuration - dur),
                                            Number((selectedTrack.start + 0.5).toFixed(2)),
                                          );
                                          updateAdditionalAudioTrack(selectedTrack.id, {
                                            start: newStart,
                                            end: Number((newStart + dur).toFixed(2)),
                                          });
                                        }}
                                      >
                                        Geser +0.5s →
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2 rounded-lg border border-zinc-800 bg-[#1a1c20] p-2.5 text-xs">
                                <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
                                  <span className="text-zinc-400">Mulai</span>
                                  <span className="font-mono font-bold text-zinc-200">0.00s</span>
                                </div>
                                <div className="flex items-center justify-between border-b border-zinc-800/60 py-1.5">
                                  <span className="text-zinc-400">Selesai</span>
                                  <span className="font-mono font-bold text-zinc-200">
                                    {clipDuration.toFixed(2)}s
                                  </span>
                                </div>
                                <div className="flex items-center justify-between pt-1">
                                  <span className="text-zinc-400">Durasi</span>
                                  <span className="font-mono font-bold text-cyan-300">
                                    {clipDuration.toFixed(2)}s
                                  </span>
                                </div>
                                <p className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/60">
                                  Track audio utama ini terkunci mengikuti durasi klip video.
                                </p>
                              </div>
                            )}
                          </ToolSection>
                        </>
                      )}
                    </>
                  );
                })()}

                {/* 4. TEXT / HOOK / KEYWORD INSPECTOR */}
                {(inspectorContext === "hook" || inspectorContext === "keyword") && (
                  <>
                    {textInspectorTab === "text" && (
                      <>
                        {inspectorContext === "hook" && (() => {
                          const currentText = selectedEvent?.text ?? (styleConfig.hook_text || "");
                          const currentPreset = normalizeTextStylePreset(
                            (selectedEvent?.preset as TextStylePresetKey) ||
                              styleConfig.hook_text_style_preset ||
                              "clean_white",
                          );
                          const presetStyle = resolveTextOverlayStyle(currentPreset);
                          const currentFont = selectedEvent?.font_family || hookTextFont;
                          const fontSizeVal =
                            selectedEvent?.font_size ?? (hookTextSize === "large" ? 36 : 26);
                          const isBold = selectedEvent?.font_weight
                            ? Number(selectedEvent.font_weight) >= 700
                            : (presetStyle.fontWeight ?? 700) >= 700;
                          const isItalic = selectedEvent?.font_style === "italic";
                          const isUnderline = selectedEvent?.text_decoration === "underline";
                          const currentCase =
                            selectedEvent?.text_case ||
                            (presetStyle.textTransform === "uppercase" ? "uppercase" : "normal");
                          const textColorVal = selectedEvent?.color || presetStyle.color || "#ffffff";
                          const letterSpacingVal = selectedEvent?.letter_spacing ?? 0;
                          const lineHeightVal = selectedEvent?.line_height ?? 1.15;
                          const textAlignVal = selectedEvent?.text_align || "center";
                          const scaleVal = selectedEvent?.scale ?? 1.0;
                          const posXVal = selectedEvent?.position_x_percent ?? 50;
                          const defaultPosY =
                            selectedEvent?.position === "bottom"
                              ? 84
                              : selectedEvent?.position === "center"
                              ? 50
                              : selectedEvent?.position === "top"
                              ? 10
                              : 18;
                          const posYVal = selectedEvent?.position_y_percent ?? defaultPosY;
                          const opacityVal = selectedEvent?.opacity ?? 1.0;
                          const isStrokeEnabled =
                            selectedEvent?.stroke_enabled ?? Boolean(presetStyle.WebkitTextStroke);
                          const strokeColorVal = selectedEvent?.stroke_color || "#000000";
                          const strokeWidthVal = selectedEvent?.stroke_width ?? 2;
                          const isBgEnabled =
                            selectedEvent?.background_enabled ?? Boolean(presetStyle.backgroundColor);
                          const bgColorVal = selectedEvent?.background_color || "#000000";
                          const bgOpacityVal = selectedEvent?.background_opacity ?? 0.8;
                          const bgRadiusVal = selectedEvent?.background_radius ?? 8;
                          const isShadowEnabled =
                            selectedEvent?.shadow_enabled ?? Boolean(presetStyle.textShadow);
                          const shadowColorVal = selectedEvent?.shadow_color || "rgba(0,0,0,0.85)";
                          const shadowBlurVal = selectedEvent?.shadow_blur ?? 4;

                          const updateSelectedText = (patch: Partial<EffectTimelineEvent>) => {
                            if (selectedEvent) {
                              replaceEvent(selectedEvent.id || "", patch);
                            }
                            if (patch.text !== undefined) {
                              setStyle("hook_text", patch.text);
                            }
                            if (patch.preset !== undefined) {
                              setStyle("hook_text_style_preset", patch.preset as TextStylePresetKey);
                            }
                            if (patch.font_family !== undefined) {
                              setStyle("hook_text_font", patch.font_family as HookTextFont);
                            }
                          };

                          return (
                            <>
                              {/* 1. TEXT CONTENT */}
                              <ToolSection title="Isi Teks">
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                                    <span className="font-semibold text-zinc-300">
                                      {selectedEvent?.reason?.includes("lower_third")
                                        ? "Lower Third"
                                        : selectedEvent?.reason?.includes("quote")
                                        ? "Kutipan"
                                        : selectedEvent?.reason?.includes("big_title")
                                        ? "Big Title"
                                        : selectedEvent?.reason?.includes("basic_text")
                                        ? "Basic Text"
                                        : "Teks Hook"}
                                    </span>
                                    <span className="font-mono text-[10px]">
                                      {currentText.length}/120
                                    </span>
                                  </div>
                                  <textarea
                                    id="inspector_hook_text"
                                    className="h-16 min-h-16 w-full resize-none text-xs font-medium"
                                    maxLength={120}
                                    placeholder="Ketik teks di sini..."
                                    value={currentText}
                                    onChange={(e) => updateSelectedText({ text: e.target.value })}
                                  />
                                </div>
                              </ToolSection>

                              {/* 2. FONT */}
                              <ToolSection title="Font & Typography">
                                <div className="space-y-2.5">
                                  <div>
                                    <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                                      Font Family
                                    </label>
                                    <FontPicker
                                      value={currentFont}
                                      onHoverPreview={setHoveredFontPreview}
                                      onChange={(fontFamily, fontId) => {
                                        updateSelectedText({ font_family: fontFamily });
                                        setStyle("hook_text_font", fontId as HookTextFont);
                                      }}
                                    />
                                  </div>

                                  <div>
                                    <div className="mb-1 flex items-center justify-between text-[11px]">
                                      <span className="font-medium text-zinc-400">Font Size</span>
                                      <span className="font-mono font-bold text-cyan-300">
                                        {fontSizeVal}px
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min="12"
                                        max="80"
                                        step="1"
                                        className="h-1.5 w-full accent-cyan-400"
                                        value={fontSizeVal}
                                        onChange={(e) =>
                                          updateSelectedText({ font_size: Number(e.target.value) })
                                        }
                                      />
                                      <input
                                        type="number"
                                        min="12"
                                        max="80"
                                        className="h-7 w-14 text-center font-mono text-xs"
                                        value={fontSizeVal}
                                        onChange={(e) =>
                                          updateSelectedText({ font_size: Number(e.target.value) })
                                        }
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2 pt-1">
                                    <div>
                                      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                        Style
                                      </span>
                                      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700/80 bg-[#1e2024] p-0.5">
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded text-xs font-black transition ${
                                            isBold
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({
                                              font_weight: isBold ? 400 : 800,
                                            })
                                          }
                                          title="Bold"
                                        >
                                          B
                                        </button>
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded font-serif text-xs italic transition ${
                                            isItalic
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({
                                              font_style: isItalic ? "normal" : "italic",
                                            })
                                          }
                                          title="Italic"
                                        >
                                          I
                                        </button>
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded text-xs font-medium underline transition ${
                                            isUnderline
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({
                                              text_decoration: isUnderline ? "none" : "underline",
                                            })
                                          }
                                          title="Underline"
                                        >
                                          U
                                        </button>
                                      </div>
                                    </div>

                                    <div>
                                      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-400">
                                        Case
                                      </span>
                                      <div className="flex items-center gap-0.5 rounded-lg border border-zinc-700/80 bg-[#1e2024] p-0.5">
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded text-[10px] font-bold transition ${
                                            currentCase === "normal"
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({ text_case: "normal" })
                                          }
                                          title="Normal Case (Aa)"
                                        >
                                          Aa
                                        </button>
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded text-[10px] font-black uppercase transition ${
                                            currentCase === "uppercase"
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({ text_case: "uppercase" })
                                          }
                                          title="Uppercase (TT)"
                                        >
                                          TT
                                        </button>
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded text-[10px] font-medium lowercase transition ${
                                            currentCase === "lowercase"
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({ text_case: "lowercase" })
                                          }
                                          title="Lowercase (tt)"
                                        >
                                          tt
                                        </button>
                                        <button
                                          type="button"
                                          className={`h-7 flex-1 rounded text-[10px] font-medium capitalize transition ${
                                            currentCase === "titlecase"
                                              ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                              : "text-zinc-400 hover:text-zinc-200"
                                          }`}
                                          onClick={() =>
                                            updateSelectedText({ text_case: "titlecase" })
                                          }
                                          title="Title Case (Tt)"
                                        >
                                          Tt
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </ToolSection>

                              {/* 3. COLOR */}
                              <ToolSection title="Warna Teks">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <div className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
                                      <input
                                        type="color"
                                        aria-label="Pilih warna teks"
                                        className="absolute -inset-2 size-12 cursor-pointer opacity-0"
                                        value={textColorVal.startsWith("#") ? textColorVal.slice(0, 7) : "#ffffff"}
                                        onChange={(e) => updateSelectedText({ color: e.target.value })}
                                      />
                                      <div
                                        className="size-full rounded-lg"
                                        style={{ backgroundColor: textColorVal }}
                                      />
                                    </div>
                                    <input
                                      type="text"
                                      aria-label="Hex warna teks"
                                      className="h-8 flex-1 font-mono text-xs uppercase"
                                      value={textColorVal}
                                      onChange={(e) => updateSelectedText({ color: e.target.value })}
                                    />
                                  </div>
                                  <div className="flex items-center gap-1.5 pt-0.5">
                                    {["#ffffff", "#ffeb3b", "#00e5ff", "#ff1744", "#00e676", "#ff9100", "#e040fb"].map(
                                      (swatch) => (
                                        <button
                                          key={swatch}
                                          type="button"
                                          className="size-5 rounded-full border border-zinc-600 shadow-sm transition hover:scale-110"
                                          style={{ backgroundColor: swatch }}
                                          onClick={() => updateSelectedText({ color: swatch })}
                                          title={swatch}
                                        />
                                      ),
                                    )}
                                  </div>
                                </div>
                              </ToolSection>

                              {/* 4. SPACING */}
                              <ToolSection title="Spacing">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <div className="mb-1 flex items-center justify-between text-[11px]">
                                      <span className="font-medium text-zinc-400">Karakter</span>
                                      <span className="font-mono font-bold text-zinc-300">
                                        {letterSpacingVal}px
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="-2"
                                      max="10"
                                      step="0.5"
                                      className="h-1.5 w-full accent-cyan-400"
                                      value={letterSpacingVal}
                                      onChange={(e) =>
                                        updateSelectedText({
                                          letter_spacing: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                  <div>
                                    <div className="mb-1 flex items-center justify-between text-[11px]">
                                      <span className="font-medium text-zinc-400">Baris</span>
                                      <span className="font-mono font-bold text-zinc-300">
                                        {lineHeightVal.toFixed(2)}
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.8"
                                      max="2.0"
                                      step="0.05"
                                      className="h-1.5 w-full accent-cyan-400"
                                      value={lineHeightVal}
                                      onChange={(e) =>
                                        updateSelectedText({
                                          line_height: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                              </ToolSection>

                              {/* 5. ALIGNMENT */}
                              <ToolSection title="Alignment">
                                <div className="flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-[#1e2024] p-1">
                                  <button
                                    type="button"
                                    className={`flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs font-semibold transition ${
                                      textAlignVal === "left"
                                        ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                        : "text-zinc-400 hover:text-zinc-200"
                                    }`}
                                    onClick={() => updateSelectedText({ text_align: "left" })}
                                  >
                                    <span>⇤</span>
                                    <span>Kiri</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs font-semibold transition ${
                                      textAlignVal === "center"
                                        ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                        : "text-zinc-400 hover:text-zinc-200"
                                    }`}
                                    onClick={() => updateSelectedText({ text_align: "center" })}
                                  >
                                    <span>≡</span>
                                    <span>Tengah</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs font-semibold transition ${
                                      textAlignVal === "right"
                                        ? "border border-cyan-500/40 bg-cyan-500/20 text-cyan-300"
                                        : "text-zinc-400 hover:text-zinc-200"
                                    }`}
                                    onClick={() => updateSelectedText({ text_align: "right" })}
                                  >
                                    <span>⇥</span>
                                    <span>Kanan</span>
                                  </button>
                                </div>
                              </ToolSection>

                              {/* 6. PRESET STYLE */}
                              <ToolSection title="Preset Gaya Teks">
                                <TextStylePresetSelector
                                  value={currentPreset}
                                  onChange={(value) => updateSelectedText({ preset: value })}
                                />
                              </ToolSection>

                              {/* 7. TRANSFORM (Collapsible) */}
                              <CollapsibleToolSection title="Transform" badge={`${Math.round(scaleVal * 100)}%`}>
                                <div className="space-y-3">
                                  <div>
                                    <div className="mb-1 flex items-center justify-between text-[11px]">
                                      <span className="font-medium text-zinc-400">Scale</span>
                                      <span className="font-mono font-bold text-cyan-300">
                                        {scaleVal.toFixed(2)}x
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0.5"
                                      max="2.5"
                                      step="0.05"
                                      className="h-1.5 w-full accent-cyan-400"
                                      value={scaleVal}
                                      onChange={(e) =>
                                        updateSelectedText({ scale: Number(e.target.value) })
                                      }
                                    />
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <div className="mb-1 flex items-center justify-between text-[11px]">
                                        <span className="font-medium text-zinc-400">Posisi X</span>
                                        <span className="font-mono font-bold text-zinc-300">
                                          {Math.round(posXVal)}%
                                        </span>
                                      </div>
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        className="h-1.5 w-full accent-cyan-400"
                                        value={posXVal}
                                        onChange={(e) =>
                                          updateSelectedText({
                                            position_x_percent: Number(e.target.value),
                                          })
                                        }
                                      />
                                    </div>

                                    <div>
                                      <div className="mb-1 flex items-center justify-between text-[11px]">
                                        <span className="font-medium text-zinc-400">Posisi Y</span>
                                        <span className="font-mono font-bold text-zinc-300">
                                          {Math.round(posYVal)}%
                                        </span>
                                      </div>
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="1"
                                        className="h-1.5 w-full accent-cyan-400"
                                        value={posYVal}
                                        onChange={(e) =>
                                          updateSelectedText({
                                            position_y_percent: Number(e.target.value),
                                          })
                                        }
                                      />
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-4 gap-1 pt-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedText({ position_x_percent: 50, position_y_percent: 18 })
                                      }
                                      className="rounded bg-zinc-800 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-700"
                                    >
                                      Atas
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedText({ position_x_percent: 50, position_y_percent: 50 })
                                      }
                                      className="rounded bg-zinc-800 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-700"
                                    >
                                      Tengah
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedText({ position_x_percent: 50, position_y_percent: 84 })
                                      }
                                      className="rounded bg-zinc-800 py-1 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-700"
                                    >
                                      Bawah
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedText({ scale: 1.0, position_x_percent: 50, position_y_percent: 18 })
                                      }
                                      className="rounded bg-zinc-800 py-1 text-[10px] font-semibold text-cyan-300 hover:bg-zinc-700"
                                    >
                                      Reset
                                    </button>
                                  </div>
                                </div>
                              </CollapsibleToolSection>

                              {/* 8. BLEND (Collapsible) */}
                              <CollapsibleToolSection title="Blend & Opacity" badge={`${Math.round(opacityVal * 100)}%`}>
                                <div>
                                  <div className="mb-1 flex items-center justify-between text-[11px]">
                                    <span className="font-medium text-zinc-400">Opacity</span>
                                    <span className="font-mono font-bold text-cyan-300">
                                      {Math.round(opacityVal * 100)}%
                                    </span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    className="h-1.5 w-full accent-cyan-400"
                                    value={opacityVal}
                                    onChange={(e) =>
                                      updateSelectedText({ opacity: Number(e.target.value) })
                                    }
                                  />
                                </div>
                              </CollapsibleToolSection>

                              {/* 9. STROKE (Collapsible) */}
                              <CollapsibleToolSection
                                title="Stroke / Outline"
                                badge={isStrokeEnabled ? `${strokeWidthVal}px` : "Nonaktif"}
                              >
                                <div className="space-y-3">
                                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200">
                                    <input
                                      type="checkbox"
                                      className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                      checked={isStrokeEnabled}
                                      onChange={(e) =>
                                        updateSelectedText({ stroke_enabled: e.target.checked })
                                      }
                                    />
                                    <span className="font-medium">Aktifkan Stroke Teks</span>
                                  </label>

                                  {isStrokeEnabled && (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <div className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
                                          <input
                                            type="color"
                                            aria-label="Pilih warna stroke"
                                            className="absolute -inset-2 size-12 cursor-pointer opacity-0"
                                            value={strokeColorVal.startsWith("#") ? strokeColorVal.slice(0, 7) : "#000000"}
                                            onChange={(e) =>
                                              updateSelectedText({ stroke_color: e.target.value })
                                            }
                                          />
                                          <div
                                            className="size-full rounded-lg"
                                            style={{ backgroundColor: strokeColorVal }}
                                          />
                                        </div>
                                        <input
                                          type="text"
                                          aria-label="Hex warna stroke"
                                          className="h-8 flex-1 font-mono text-xs uppercase"
                                          value={strokeColorVal}
                                          onChange={(e) =>
                                            updateSelectedText({ stroke_color: e.target.value })
                                          }
                                        />
                                      </div>

                                      <div>
                                        <div className="mb-1 flex items-center justify-between text-[11px]">
                                          <span className="font-medium text-zinc-400">Ketebalan</span>
                                          <span className="font-mono font-bold text-cyan-300">
                                            {strokeWidthVal}px
                                          </span>
                                        </div>
                                        <input
                                          type="range"
                                          min="0.5"
                                          max="12"
                                          step="0.5"
                                          className="h-1.5 w-full accent-cyan-400"
                                          value={strokeWidthVal}
                                          onChange={(e) =>
                                            updateSelectedText({
                                              stroke_width: Number(e.target.value),
                                            })
                                          }
                                        />
                                      </div>
                                    </>
                                  )}
                                </div>
                              </CollapsibleToolSection>

                              {/* 10. BACKGROUND (Collapsible) */}
                              <CollapsibleToolSection
                                title="Background Box"
                                badge={isBgEnabled ? `${Math.round(bgOpacityVal * 100)}%` : "Nonaktif"}
                              >
                                <div className="space-y-3">
                                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200">
                                    <input
                                      type="checkbox"
                                      className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                      checked={isBgEnabled}
                                      onChange={(e) =>
                                        updateSelectedText({ background_enabled: e.target.checked })
                                      }
                                    />
                                    <span className="font-medium">Aktifkan Background Box</span>
                                  </label>

                                  {isBgEnabled && (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <div className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
                                          <input
                                            type="color"
                                            aria-label="Pilih warna background"
                                            className="absolute -inset-2 size-12 cursor-pointer opacity-0"
                                            value={bgColorVal.startsWith("#") ? bgColorVal.slice(0, 7) : "#000000"}
                                            onChange={(e) =>
                                              updateSelectedText({ background_color: e.target.value })
                                            }
                                          />
                                          <div
                                            className="size-full rounded-lg"
                                            style={{ backgroundColor: bgColorVal }}
                                          />
                                        </div>
                                        <input
                                          type="text"
                                          aria-label="Hex warna background"
                                          className="h-8 flex-1 font-mono text-xs uppercase"
                                          value={bgColorVal}
                                          onChange={(e) =>
                                            updateSelectedText({ background_color: e.target.value })
                                          }
                                        />
                                      </div>

                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <div className="mb-1 flex items-center justify-between text-[11px]">
                                            <span className="font-medium text-zinc-400">Opacity</span>
                                            <span className="font-mono font-bold text-zinc-300">
                                              {Math.round(bgOpacityVal * 100)}%
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.05"
                                            className="h-1.5 w-full accent-cyan-400"
                                            value={bgOpacityVal}
                                            onChange={(e) =>
                                              updateSelectedText({
                                                background_opacity: Number(e.target.value),
                                              })
                                            }
                                          />
                                        </div>
                                        <div>
                                          <div className="mb-1 flex items-center justify-between text-[11px]">
                                            <span className="font-medium text-zinc-400">Radius</span>
                                            <span className="font-mono font-bold text-zinc-300">
                                              {bgRadiusVal}px
                                            </span>
                                          </div>
                                          <input
                                            type="range"
                                            min="0"
                                            max="24"
                                            step="1"
                                            className="h-1.5 w-full accent-cyan-400"
                                            value={bgRadiusVal}
                                            onChange={(e) =>
                                              updateSelectedText({
                                                background_radius: Number(e.target.value),
                                              })
                                            }
                                          />
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </CollapsibleToolSection>

                              {/* 11. GLOW / SHADOW (Collapsible) */}
                              <CollapsibleToolSection
                                title="Shadow / Bayangan"
                                badge={isShadowEnabled ? `${shadowBlurVal}px` : "Nonaktif"}
                              >
                                <div className="space-y-3">
                                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200">
                                    <input
                                      type="checkbox"
                                      className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                      checked={isShadowEnabled}
                                      onChange={(e) =>
                                        updateSelectedText({ shadow_enabled: e.target.checked })
                                      }
                                    />
                                    <span className="font-medium">Aktifkan Bayangan Teks</span>
                                  </label>

                                  {isShadowEnabled && (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <div className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-zinc-700 shadow-sm">
                                          <input
                                            type="color"
                                            aria-label="Pilih warna bayangan"
                                            className="absolute -inset-2 size-12 cursor-pointer opacity-0"
                                            value={shadowColorVal.startsWith("#") ? shadowColorVal.slice(0, 7) : "#000000"}
                                            onChange={(e) =>
                                              updateSelectedText({ shadow_color: e.target.value })
                                            }
                                          />
                                          <div
                                            className="size-full rounded-lg"
                                            style={{ backgroundColor: shadowColorVal }}
                                          />
                                        </div>
                                        <input
                                          type="text"
                                          aria-label="Hex warna bayangan"
                                          className="h-8 flex-1 font-mono text-xs uppercase"
                                          value={shadowColorVal}
                                          onChange={(e) =>
                                            updateSelectedText({ shadow_color: e.target.value })
                                          }
                                        />
                                      </div>

                                      <div>
                                        <div className="mb-1 flex items-center justify-between text-[11px]">
                                          <span className="font-medium text-zinc-400">Blur Radius</span>
                                          <span className="font-mono font-bold text-cyan-300">
                                            {shadowBlurVal}px
                                          </span>
                                        </div>
                                        <input
                                          type="range"
                                          min="0"
                                          max="20"
                                          step="1"
                                          className="h-1.5 w-full accent-cyan-400"
                                          value={shadowBlurVal}
                                          onChange={(e) =>
                                            updateSelectedText({
                                              shadow_blur: Number(e.target.value),
                                            })
                                          }
                                        />
                                      </div>
                                    </>
                                  )}
                                </div>
                              </CollapsibleToolSection>

                              {/* TIMING & ACTIONS */}
                              {selectedEvent && (
                                <ToolSection title="Timing">
                                  <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                                    <div className="rounded-lg bg-zinc-800/80 p-2">
                                      <span className="block text-[10px] text-zinc-500">Mulai</span>
                                      <p className="font-mono font-bold text-zinc-100">
                                        {formatTimePrecise(selectedEvent.start)}
                                      </p>
                                    </div>
                                    <div className="rounded-lg bg-zinc-800/80 p-2">
                                      <span className="block text-[10px] text-zinc-500">Selesai</span>
                                      <p className="font-mono font-bold text-zinc-100">
                                        {formatTimePrecise(selectedEvent.end)}
                                      </p>
                                    </div>
                                    <div className="rounded-lg bg-zinc-800/80 p-2">
                                      <span className="block text-[10px] text-zinc-500">Durasi</span>
                                      <p className="font-mono font-bold text-cyan-300">
                                        {(selectedEvent.end - selectedEvent.start).toFixed(2)}s
                                      </p>
                                    </div>
                                  </div>
                                </ToolSection>
                              )}

                              <ToolSection title="Actions">
                                <button
                                  className="w-full rounded-lg border border-red-800/60 bg-red-900/40 py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60"
                                  onClick={() => {
                                    if (selectedEvent) {
                                      deleteEvent(selectedEvent.id || "");
                                    } else {
                                      setStyle("hook_text_enabled", false);
                                      setMessage("Hook dinonaktifkan.");
                                    }
                                  }}
                                  type="button"
                                >
                                  Hapus Teks
                                </button>
                              </ToolSection>
                            </>
                          );
                        })()}

                        {inspectorContext === "keyword" && (
                          <>
                            {selectedEvent ? (
                              selectedEvent.reason?.toLowerCase().includes("sticker") || selectedEvent.type === "sticker" ? (
                                <>
                                  <ToolSection title="Sticker Properties">
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-center rounded-xl bg-zinc-900/60 p-4 border border-zinc-800">
                                        <span className="text-4xl filter drop-shadow-md">
                                          {selectedEvent.text}
                                        </span>
                                      </div>
                                      <div>
                                        <label htmlFor="inspector_sticker_pos">Posisi Layar</label>
                                        <select
                                          id="inspector_sticker_pos"
                                          value={selectedEvent.position || "center"}
                                          onChange={(e) =>
                                            replaceEvent(selectedEvent.id || "", {
                                              position: e.target.value,
                                            })
                                          }
                                        >
                                          <option value="center">Tengah Layar (Center)</option>
                                          <option value="top_right">Kanan Atas</option>
                                          <option value="top_left">Kiri Atas</option>
                                          <option value="bottom_right">Kanan Bawah</option>
                                          <option value="bottom_left">Kiri Bawah</option>
                                        </select>
                                      </div>
                                      <div>
                                        <label htmlFor="inspector_sticker_size">Ukuran Sticker</label>
                                        <select
                                          id="inspector_sticker_size"
                                          value={selectedEvent.size || "medium"}
                                          onChange={(e) =>
                                            replaceEvent(selectedEvent.id || "", {
                                              size: e.target.value,
                                            })
                                          }
                                        >
                                          <option value="small">Kecil</option>
                                          <option value="medium">Sedang (Default)</option>
                                          <option value="large">Besar</option>
                                        </select>
                                      </div>
                                    </div>
                                  </ToolSection>

                                  <ToolSection title="Timing">
                                    <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                                      <div className="rounded-lg bg-zinc-800/80 p-2">
                                        <span className="block text-[10px] text-zinc-500">Mulai</span>
                                        <p className="font-mono font-bold text-zinc-100">
                                          {formatTimePrecise(selectedEvent.start)}
                                        </p>
                                      </div>
                                      <div className="rounded-lg bg-zinc-800/80 p-2">
                                        <span className="block text-[10px] text-zinc-500">Selesai</span>
                                        <p className="font-mono font-bold text-zinc-100">
                                          {formatTimePrecise(selectedEvent.end)}
                                        </p>
                                      </div>
                                      <div className="rounded-lg bg-zinc-800/80 p-2">
                                        <span className="block text-[10px] text-zinc-500">Durasi</span>
                                        <p className="font-mono font-bold text-cyan-300">
                                          {(selectedEvent.end - selectedEvent.start).toFixed(2)}s
                                        </p>
                                      </div>
                                    </div>
                                  </ToolSection>

                                  <ToolSection title="Actions">
                                    <button
                                      className="rounded-lg border border-red-800/60 bg-red-900/40 w-full py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60"
                                      onClick={() => deleteEvent(selectedEvent.id || "")}
                                      type="button"
                                    >
                                      Hapus Sticker
                                    </button>
                                  </ToolSection>
                                </>
                              ) : (
                                <>
                                  <ToolSection title="Keyword Text">
                                    <div>
                                      <label htmlFor="inspector_keyword_text">Teks Keyword</label>
                                      <input
                                        id="inspector_keyword_text"
                                        onChange={(event) => {
                                          const text = sanitizeKeywordInput(event.target.value);
                                          replaceEvent(selectedEvent.id || "", { text });
                                        }}
                                        value={selectedEvent.text || ""}
                                      />
                                    </div>
                                  </ToolSection>

                                  <ToolSection title="Gaya Teks Keyword">
                                    <TextStylePresetSelector
                                      label="Preset Gaya Teks"
                                      onChange={(value) => {
                                        replaceEvent(selectedEvent.id || "", { preset: value });
                                        setStyle("keyword_text_style_preset", value);
                                      }}
                                      value={
                                        normalizeTextStylePreset(
                                          (selectedEvent.preset as TextStylePresetKey) ||
                                            styleConfig.keyword_text_style_preset ||
                                            "yellow_viral",
                                        )
                                      }
                                    />
                                  </ToolSection>

                                  <ToolSection title="Timing">
                                    <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                                      <div className="rounded-lg bg-zinc-800/80 p-2">
                                        <span className="block text-[10px] text-zinc-500">Mulai</span>
                                        <p className="font-mono font-bold text-zinc-100">
                                          {formatTimePrecise(selectedEvent.start)}
                                        </p>
                                      </div>
                                      <div className="rounded-lg bg-zinc-800/80 p-2">
                                        <span className="block text-[10px] text-zinc-500">Selesai</span>
                                        <p className="font-mono font-bold text-zinc-100">
                                          {formatTimePrecise(selectedEvent.end)}
                                        </p>
                                      </div>
                                      <div className="rounded-lg bg-zinc-800/80 p-2">
                                        <span className="block text-[10px] text-zinc-500">Durasi</span>
                                        <p className="font-mono font-bold text-cyan-300">
                                          {(selectedEvent.end - selectedEvent.start).toFixed(2)}s
                                        </p>
                                      </div>
                                    </div>
                                  </ToolSection>

                                  <ToolSection title="Actions">
                                    <button
                                      className="rounded-lg border border-red-800/60 bg-red-900/40 w-full py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60"
                                      onClick={() => deleteEvent(selectedEvent.id || "")}
                                      type="button"
                                    >
                                      Hapus Keyword
                                    </button>
                                  </ToolSection>
                                </>
                              )
                            ) : (
                              <ToolSection title="Keyword / Sticker">
                                <p className="rounded-xl bg-zinc-850 p-3 text-xs text-zinc-400">
                                  Pilih keyword atau sticker di timeline untuk mengedit teks atau properti.
                                </p>
                              </ToolSection>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {(textInspectorTab === "animation" ||
                      textInspectorTab === "tracking" ||
                      textInspectorTab === "tts") && (
                      <ToolSection title="Coming Soon">
                        <div className="rounded-xl border border-zinc-800 bg-[#202226] p-4 text-center text-xs text-zinc-400">
                          <p className="font-bold text-zinc-300 capitalize">
                            {textInspectorTab === "tts" ? "Text to Speech" : textInspectorTab}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            Fitur {textInspectorTab === "tts" ? "text to speech" : textInspectorTab} teks akan aktif pada update berikutnya.
                          </p>
                        </div>
                      </ToolSection>
                    )}
                  </>
                )}

                {/* 5. CAPTION INSPECTOR (CapCut Structure: Captions | Text | Animation | Tracking | TTS) */}
                {inspectorContext === "caption" && (
                  <>
                    {/* TAB 1: CAPTIONS (Cue Search, List, Global Apply to All, Actions) */}
                    {captionInspectorTab === "captions" && (
                      <>
                        <ToolSection title="Caption Manager">
                          <div className="space-y-3">
                            <label className="flex items-center justify-between gap-2 cursor-pointer text-xs font-bold text-zinc-200 bg-zinc-900/90 p-2.5 rounded-xl border border-zinc-800 shadow-sm">
                              <span className="flex items-center gap-1.5">
                                <span className="text-cyan-400">✨</span>
                                <span>Apply to all main captions</span>
                              </span>
                              <input
                                type="checkbox"
                                checked={captionApplyToAll}
                                onChange={(e) => setCaptionApplyToAll(e.target.checked)}
                                className="accent-cyan-400 h-4 w-4 rounded cursor-pointer"
                              />
                            </label>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  if (editableCaptionCues.length > 0) {
                                    setSelectedCaptionId(editableCaptionCues[0].id);
                                    setMessage(`Semua caption (${editableCaptionCues.length} cue) siap diedit massal.`);
                                  }
                                }}
                                className="btn-secondary flex-1 py-1.5 text-[11px] font-bold"
                              >
                                Pilih Semua ({editableCaptionCues.length})
                              </button>
                              <button
                                type="button"
                                onClick={applyCurrentStyleToAllCaptions}
                                className="btn-secondary flex-1 py-1.5 text-[11px] font-bold text-cyan-300"
                                title="Terapkan style aktif ke semua cue"
                              >
                                Terapkan ke Semua
                              </button>
                              <button
                                type="button"
                                onClick={resetCaptionStyle}
                                className="btn-secondary px-2.5 py-1.5 text-[11px] font-bold text-zinc-400 hover:text-zinc-200"
                                title="Reset style caption ke default"
                              >
                                Reset
                              </button>
                            </div>

                            <div>
                              <input
                                placeholder="Cari isi teks caption..."
                                value={captionCueSearch}
                                onChange={(e) => setCaptionCueSearch(e.target.value)}
                                className="w-full text-xs"
                              />
                            </div>

                            {/* Cues List */}
                            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                              {editableCaptionCues
                                .filter((cue) =>
                                  !captionCueSearch
                                    ? true
                                    : cue.text.toLowerCase().includes(captionCueSearch.toLowerCase()),
                                )
                                .map((cue, idx) => {
                                  const isSelected = selectedCaptionId === cue.id;
                                  return (
                                    <div
                                      key={cue.id}
                                      onClick={() => {
                                        seekPreviewTo(cue.start);
                                        setSelectedCaptionId(cue.id);
                                        setSelectedEditorContext("caption");
                                      }}
                                      className={`group cursor-pointer rounded-lg border p-2 text-xs transition ${
                                        isSelected
                                          ? "border-cyan-400 bg-cyan-500/10 shadow-sm"
                                          : "border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                                        <span className="font-mono font-bold text-zinc-300">
                                          #{idx + 1} [{formatTimePrecise(cue.start)} - {formatTimePrecise(cue.end)}]
                                        </span>
                                        <span className="font-mono text-cyan-400">
                                          {(cue.end - cue.start).toFixed(2)}s
                                        </span>
                                      </div>
                                      <p className="line-clamp-2 font-medium text-zinc-200">{cue.text}</p>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </ToolSection>

                        {selectedCaption && (
                          <ToolSection title="Active Cue Editor">
                            <div className="space-y-3">
                              <div>
                                <label htmlFor="inspector_active_caption_text">Teks Cue Terpilih</label>
                                <textarea
                                  className="min-h-16 w-full text-xs"
                                  id="inspector_active_caption_text"
                                  onBlur={finishSelectedCaptionTextEdit}
                                  onChange={(event) => updateSelectedCaptionText(event.target.value)}
                                  value={selectedCaption.text || ""}
                                />
                              </div>

                              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                                <div className="rounded-lg bg-zinc-800/80 p-2">
                                  <span className="block text-[10px] text-zinc-500">Mulai</span>
                                  <p className="font-mono font-bold text-zinc-100">
                                    {formatTimePrecise(selectedCaption.start)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-zinc-800/80 p-2">
                                  <span className="block text-[10px] text-zinc-500">Selesai</span>
                                  <p className="font-mono font-bold text-zinc-100">
                                    {formatTimePrecise(selectedCaption.end)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-zinc-800/80 p-2">
                                  <span className="block text-[10px] text-zinc-500">Durasi</span>
                                  <p className="font-mono font-bold text-cyan-300">
                                    {selectedCaptionDuration.toFixed(2)}s
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
                                <span>
                                  Kata: <strong className="text-zinc-200">{selectedCaptionWordCount}</strong>
                                </span>
                                <span>
                                  Karakter: <strong className="text-zinc-200">{selectedCaptionCharacterCount}</strong>
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <button
                                  className="btn-secondary px-3 py-1.5 text-xs font-bold"
                                  onClick={reflowSelectedCaption}
                                  type="button"
                                >
                                  Rapikan Cue
                                </button>
                                <button
                                  className="rounded-lg border border-red-800/60 bg-red-900/40 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60"
                                  onClick={deleteSelectedCaptionCue}
                                  type="button"
                                >
                                  Hapus Cue
                                </button>
                              </div>
                            </div>
                          </ToolSection>
                        )}
                      </>
                    )}

                    {/* TAB 2: TEXT (Sub-tabs: Basic | Templates | Effects) */}
                    {captionInspectorTab === "text" && (
                      <>
                        {/* Sub-tab Pill Strip */}
                        <div className="flex items-center gap-1 rounded-xl bg-zinc-900/90 p-1 border border-zinc-800/80">
                          {(
                            [
                              { id: "basic", label: "Basic" },
                              { id: "templates", label: "Templates" },
                              { id: "bubble", label: "Bubble" },
                              { id: "effects", label: "Effects" },
                            ] as const
                          ).map((sub) => (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => setCaptionTextSubTab(sub.id)}
                              className={`flex-1 rounded-lg py-1 text-xs font-bold transition ${
                                captionTextSubTab === sub.id
                                  ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                                  : "text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              {sub.label}
                            </button>
                          ))}
                        </div>

                        {/* Global Apply Banner */}
                        <label className="flex items-center justify-between gap-2 cursor-pointer text-xs font-bold text-zinc-200 bg-zinc-900/90 p-2.5 rounded-xl border border-zinc-800 shadow-sm">
                          <span className="flex items-center gap-1.5">
                            <span className="text-cyan-400">✨</span>
                            <span>Apply to all main captions</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={captionApplyToAll}
                            onChange={(e) => setCaptionApplyToAll(e.target.checked)}
                            className="accent-cyan-400 h-4 w-4 rounded cursor-pointer"
                          />
                        </label>

                        {/* Sub-tab 1: BASIC TYPOGRAPHY CONTROLS */}
                        {captionTextSubTab === "basic" && (
                          <ToolSection title="Typography & Colors">
                            <div className="space-y-3.5">
                              {selectedCaption && (
                                <div>
                                  <label htmlFor="caption_text_quick_edit">Teks Cue Terpilih</label>
                                  <textarea
                                    className="min-h-16 w-full text-xs font-medium"
                                    id="caption_text_quick_edit"
                                    onBlur={finishSelectedCaptionTextEdit}
                                    onChange={(event) => updateSelectedCaptionText(event.target.value)}
                                    value={selectedCaption.text || ""}
                                  />
                                </div>
                              )}

                              {/* Font Family */}
                              <div className="space-y-1.5">
                                <label className="text-[11px] font-medium text-zinc-400">Font Family</label>
                                <FontPicker
                                  value={mainCaptionStyle.font_family}
                                  onHoverPreview={setHoveredFontPreview}
                                  onChange={(fontFamily) =>
                                    updateMainCaptionStyle({ font_family: fontFamily })
                                  }
                                />
                              </div>

                              {/* Font Size & Weight */}
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <label htmlFor="caption_font_size_slider">Ukuran Font</label>
                                    <span className="font-mono text-cyan-300 font-bold">
                                      {mainCaptionStyle.font_size}px
                                    </span>
                                  </div>
                                  <input
                                    id="caption_font_size_slider"
                                    type="range"
                                    min="12"
                                    max="44"
                                    step="1"
                                    value={mainCaptionStyle.font_size}
                                    onChange={(e) => updateMainCaptionStyle({ font_size: Number(e.target.value) })}
                                    className="w-full accent-cyan-400"
                                  />
                                </div>
                                <div>
                                  <label htmlFor="caption_font_weight_select">Ketebalan</label>
                                  <select
                                    id="caption_font_weight_select"
                                    value={mainCaptionStyle.font_weight}
                                    onChange={(e) => updateMainCaptionStyle({ font_weight: e.target.value })}
                                  >
                                    <option value="400">Normal (400)</option>
                                    <option value="600">Semi Bold (600)</option>
                                    <option value="700">Bold (700)</option>
                                    <option value="800">Extra Bold (800)</option>
                                    <option value="900">Black (900)</option>
                                  </select>
                                </div>
                              </div>

                              {/* Style Buttons (Bold / Italic / Underline / Case Mode) */}
                              <div className="flex items-center gap-1 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateMainCaptionStyle({
                                      font_weight: mainCaptionStyle.font_weight === "800" ? "400" : "800",
                                    })
                                  }
                                  className={`flex-1 rounded-lg py-1.5 text-xs font-black transition border ${
                                    mainCaptionStyle.font_weight === "800" || mainCaptionStyle.font_weight === "900"
                                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                      : "border-zinc-800 bg-zinc-900 text-zinc-400"
                                  }`}
                                  title="Tebal (Bold)"
                                >
                                  B
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateMainCaptionStyle({ italic: !mainCaptionStyle.italic })}
                                  className={`flex-1 rounded-lg py-1.5 text-xs font-serif italic transition border ${
                                    mainCaptionStyle.italic
                                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                      : "border-zinc-800 bg-zinc-900 text-zinc-400"
                                  }`}
                                  title="Miring (Italic)"
                                >
                                  I
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateMainCaptionStyle({ underline: !mainCaptionStyle.underline })}
                                  className={`flex-1 rounded-lg py-1.5 text-xs underline transition border ${
                                    mainCaptionStyle.underline
                                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                      : "border-zinc-800 bg-zinc-900 text-zinc-400"
                                  }`}
                                  title="Garis Bawah (Underline)"
                                >
                                  U
                                </button>
                                {(
                                  [
                                    { mode: "none", label: "Normal" },
                                    { mode: "uppercase", label: "TT" },
                                    { mode: "lowercase", label: "tt" },
                                    { mode: "title", label: "Tt" },
                                  ] as const
                                ).map((item) => (
                                  <button
                                    key={item.mode}
                                    type="button"
                                    onClick={() => updateMainCaptionStyle({ case_mode: item.mode })}
                                    className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition border ${
                                      mainCaptionStyle.case_mode === item.mode
                                        ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                        : "border-zinc-800 bg-zinc-900 text-zinc-400"
                                    }`}
                                    title={`Format huruf: ${item.label}`}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>

                              {/* Color Controls */}
                              <div>
                                <label htmlFor="caption_primary_color">Warna Teks Utama</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                                    id="caption_primary_color"
                                    type="color"
                                    value={mainCaptionStyle.color}
                                    onChange={(event) =>
                                      updateMainCaptionStyle({ color: event.target.value })
                                    }
                                  />
                                  <input
                                    className="flex-1 font-mono text-xs"
                                    type="text"
                                    value={mainCaptionStyle.color}
                                    onChange={(event) =>
                                      updateMainCaptionStyle({ color: event.target.value })
                                    }
                                  />
                                </div>
                              </div>

                              {/* Stroke / Outline */}
                              <div className="space-y-2 border-t border-zinc-800/80 pt-2.5">
                                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                                  <input
                                    checked={mainCaptionStyle.stroke_enabled}
                                    className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                    type="checkbox"
                                    onChange={(event) =>
                                      updateMainCaptionStyle({ stroke_enabled: event.target.checked })
                                    }
                                  />
                                  <span className="font-bold">Garis Luar (Stroke / Outline)</span>
                                </label>
                                {mainCaptionStyle.stroke_enabled && (
                                  <div className="space-y-2 pl-6 pt-1">
                                    <div className="flex items-center gap-2">
                                      <input
                                        className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                                        type="color"
                                        value={mainCaptionStyle.stroke_color}
                                        onChange={(e) => updateMainCaptionStyle({ stroke_color: e.target.value })}
                                      />
                                      <input
                                        className="flex-1 font-mono text-xs"
                                        type="text"
                                        value={mainCaptionStyle.stroke_color}
                                        onChange={(e) => updateMainCaptionStyle({ stroke_color: e.target.value })}
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                                        <span>Ketebalan Stroke</span>
                                        <span className="font-mono text-zinc-200">{mainCaptionStyle.stroke_width}px</span>
                                      </div>
                                      <input
                                        type="range"
                                        min="1"
                                        max="8"
                                        step="0.5"
                                        value={mainCaptionStyle.stroke_width}
                                        onChange={(e) => updateMainCaptionStyle({ stroke_width: Number(e.target.value) })}
                                        className="w-full accent-cyan-400"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Shadow */}
                              <div className="space-y-2 border-t border-zinc-800/80 pt-2.5">
                                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                                  <input
                                    checked={mainCaptionStyle.shadow_enabled}
                                    className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                    type="checkbox"
                                    onChange={(event) =>
                                      updateMainCaptionStyle({ shadow_enabled: event.target.checked })
                                    }
                                  />
                                  <span className="font-bold">Bayangan (Shadow)</span>
                                </label>
                                {mainCaptionStyle.shadow_enabled && (
                                  <div className="space-y-2 pl-6 pt-1">
                                    <div>
                                      <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                                        <span>Radius Blur</span>
                                        <span className="font-mono text-zinc-200">{mainCaptionStyle.shadow_blur}px</span>
                                      </div>
                                      <input
                                        type="range"
                                        min="0"
                                        max="20"
                                        step="1"
                                        value={mainCaptionStyle.shadow_blur}
                                        onChange={(e) => updateMainCaptionStyle({ shadow_blur: Number(e.target.value) })}
                                        className="w-full accent-cyan-400"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Background Box */}
                              <div className="space-y-2 border-t border-zinc-800/80 pt-2.5">
                                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                                  <input
                                    checked={mainCaptionStyle.background_enabled}
                                    className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-cyan-400"
                                    type="checkbox"
                                    onChange={(event) =>
                                      updateMainCaptionStyle({ background_enabled: event.target.checked })
                                    }
                                  />
                                  <span className="font-bold">Latar Belakang (Background Box)</span>
                                </label>
                                {mainCaptionStyle.background_enabled && (
                                  <div className="space-y-2 pl-6 pt-1">
                                    <div className="flex items-center gap-2">
                                      <input
                                        className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                                        type="color"
                                        value={mainCaptionStyle.background_color}
                                        onChange={(e) => updateMainCaptionStyle({ background_color: e.target.value })}
                                      />
                                      <input
                                        className="flex-1 font-mono text-xs"
                                        type="text"
                                        value={mainCaptionStyle.background_color}
                                        onChange={(e) => updateMainCaptionStyle({ background_color: e.target.value })}
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                                        <span>Transparansi Latar</span>
                                        <span className="font-mono text-zinc-200">
                                          {Math.round(mainCaptionStyle.background_opacity * 100)}%
                                        </span>
                                      </div>
                                      <input
                                        type="range"
                                        min="0.1"
                                        max="1"
                                        step="0.05"
                                        value={mainCaptionStyle.background_opacity}
                                        onChange={(e) => updateMainCaptionStyle({ background_opacity: Number(e.target.value) })}
                                        className="w-full accent-cyan-400"
                                      />
                                    </div>
                                    <div>
                                      <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                                        <span>Sudut Membulat (Radius)</span>
                                        <span className="font-mono text-zinc-200">{mainCaptionStyle.background_radius}px</span>
                                      </div>
                                      <input
                                        type="range"
                                        min="0"
                                        max="20"
                                        step="1"
                                        value={mainCaptionStyle.background_radius}
                                        onChange={(e) => updateMainCaptionStyle({ background_radius: Number(e.target.value) })}
                                        className="w-full accent-cyan-400"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </ToolSection>
                        )}

                        {/* Sub-tab 2: TEMPLATES GALLERY (Trending, Classic, Hits, Word, Glow) */}
                        {captionTextSubTab === "templates" && (
                          <ToolSection title="Template Caption Gallery">
                            <CaptionTemplateGallery
                              activeGroup="templates"
                              currentPresetId={mainCaptionStyle.preset_id}
                              previewTemplateId={hoveredCaptionTemplate?.id}
                              onSelectTemplate={applyCaptionTemplate}
                              onTemplateHover={handleTemplateHover}
                              onTemplateLeave={handleTemplateLeave}
                            />
                          </ToolSection>
                        )}

                        {/* Sub-tab 3: BUBBLE & BOX PRESETS */}
                        {captionTextSubTab === "bubble" && (
                          <ToolSection title="Bubble & Box Templates">
                            <CaptionTemplateGallery
                              activeGroup="bubble"
                              currentPresetId={mainCaptionStyle.preset_id}
                              previewTemplateId={hoveredCaptionTemplate?.id}
                              onSelectTemplate={applyCaptionTemplate}
                              onTemplateHover={handleTemplateHover}
                              onTemplateLeave={handleTemplateLeave}
                            />
                          </ToolSection>
                        )}

                        {/* Sub-tab 4: EFFECTS PRESETS */}
                        {captionTextSubTab === "effects" && (
                          <ToolSection title="Effects & Animation Presets">
                            <CaptionTemplateGallery
                              activeGroup="effects"
                              currentPresetId={mainCaptionStyle.preset_id}
                              previewTemplateId={hoveredCaptionTemplate?.id}
                              onSelectTemplate={applyCaptionTemplate}
                              onTemplateHover={handleTemplateHover}
                              onTemplateLeave={handleTemplateLeave}
                            />
                          </ToolSection>
                        )}
                      </>
                    )}

                    {/* TAB 3: ANIMATION (Sub-tabs: In | Out | Loop | Captions) */}
                    {captionInspectorTab === "animation" && (
                      <>
                        <div className="flex items-center gap-1 rounded-xl bg-zinc-900/90 p-1 border border-zinc-800/80">
                          {(
                            [
                              { id: "in", label: "In" },
                              { id: "out", label: "Out" },
                              { id: "loop", label: "Loop" },
                              { id: "captions", label: "Captions" },
                            ] as const
                          ).map((sub) => (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => setCaptionAnimationSubTab(sub.id)}
                              className={`flex-1 rounded-lg py-1 text-xs font-bold transition ${
                                captionAnimationSubTab === sub.id
                                  ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                                  : "text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              {sub.label}
                            </button>
                          ))}
                        </div>

                        {captionAnimationSubTab === "in" && (
                          <ToolSection title="In Animation">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { id: "none", label: "None" },
                                { id: "fade_in", label: "Fade In" },
                                { id: "slide_up", label: "Slide Up" },
                                { id: "pop_in", label: "Pop In" },
                                { id: "typewriter", label: "Typewriter" },
                                { id: "zoom_in", label: "Zoom In" },
                              ].map((anim) => (
                                <button
                                  key={anim.id}
                                  type="button"
                                  onClick={() => {
                                    updateMainCaptionStyle({ animation_in: anim.id });
                                    setMessage(`Animasi Masuk "${anim.label}" aktif.`);
                                  }}
                                  className={`rounded-xl border p-2 text-xs font-bold transition text-left ${
                                    mainCaptionStyle.animation_in === anim.id
                                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                      : "border-zinc-800 bg-[#22252a] text-zinc-300 hover:border-zinc-700"
                                  }`}
                                >
                                  {anim.label}
                                </button>
                              ))}
                            </div>
                          </ToolSection>
                        )}

                        {captionAnimationSubTab === "out" && (
                          <ToolSection title="Out Animation">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { id: "none", label: "None" },
                                { id: "fade_out", label: "Fade Out" },
                                { id: "slide_down", label: "Slide Down" },
                                { id: "pop_out", label: "Pop Out" },
                              ].map((anim) => (
                                <button
                                  key={anim.id}
                                  type="button"
                                  onClick={() => {
                                    updateMainCaptionStyle({ animation_out: anim.id });
                                    setMessage(`Animasi Keluar "${anim.label}" aktif.`);
                                  }}
                                  className={`rounded-xl border p-2 text-xs font-bold transition text-left ${
                                    mainCaptionStyle.animation_out === anim.id
                                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                      : "border-zinc-800 bg-[#22252a] text-zinc-300 hover:border-zinc-700"
                                  }`}
                                >
                                  {anim.label}
                                </button>
                              ))}
                            </div>
                          </ToolSection>
                        )}

                        {captionAnimationSubTab === "loop" && (
                          <ToolSection title="Loop Animation">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { id: "none", label: "None" },
                                { id: "pulse", label: "Pulse" },
                                { id: "subtle_bounce", label: "Subtle Bounce" },
                                { id: "glow_pulse", label: "Glow Pulse" },
                                { id: "karaoke_pulse", label: "Karaoke Pulse" },
                              ].map((anim) => (
                                <button
                                  key={anim.id}
                                  type="button"
                                  onClick={() => {
                                    updateMainCaptionStyle({ animation_loop: anim.id });
                                    setMessage(`Animasi Loop "${anim.label}" aktif.`);
                                  }}
                                  className={`rounded-xl border p-2 text-xs font-bold transition text-left ${
                                    mainCaptionStyle.animation_loop === anim.id
                                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                                      : "border-zinc-800 bg-[#22252a] text-zinc-300 hover:border-zinc-700"
                                  }`}
                                >
                                  {anim.label}
                                </button>
                              ))}
                            </div>
                          </ToolSection>
                        )}

                        {captionAnimationSubTab === "captions" && (
                          <ToolSection title="Word Timing & Synchronized Highlight">
                            <div className="space-y-3.5">
                              <label className="flex items-center justify-between gap-2 cursor-pointer text-xs font-bold text-zinc-200 bg-zinc-900/90 p-2.5 rounded-xl border border-zinc-800 shadow-sm">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-amber-400">🎤</span>
                                  <span>Word-by-Word Highlight Sync</span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={mainCaptionStyle.karaoke_enabled}
                                  onChange={(e) =>
                                    updateMainCaptionStyle({ karaoke_enabled: e.target.checked })
                                  }
                                  className="accent-cyan-400 h-4 w-4 rounded cursor-pointer"
                                />
                              </label>

                              {mainCaptionStyle.karaoke_enabled && (
                                <div className="space-y-3 pl-1">
                                  <div>
                                    <label htmlFor="caption_karaoke_mode_select">Tipe Sorotan Karaoke</label>
                                    <select
                                      id="caption_karaoke_mode_select"
                                      value={mainCaptionStyle.karaoke_mode}
                                      onChange={(e) =>
                                        updateMainCaptionStyle({
                                          karaoke_mode: e.target.value as MainCaptionStyle["karaoke_mode"],
                                        })
                                      }
                                    >
                                      <option value="word">Kata per Kata (Word by Word)</option>
                                      <option value="highlight">Kotak Sorotan (Highlight Box)</option>
                                      <option value="line">Satu Baris (Line Highlight)</option>
                                    </select>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label htmlFor="caption_karaoke_active_color">Warna Kata Aktif</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                                          id="caption_karaoke_active_color"
                                          type="color"
                                          value={mainCaptionStyle.karaoke_active_color}
                                          onChange={(e) =>
                                            updateMainCaptionStyle({ karaoke_active_color: e.target.value })
                                          }
                                        />
                                        <input
                                          className="flex-1 font-mono text-xs"
                                          type="text"
                                          value={mainCaptionStyle.karaoke_active_color}
                                          onChange={(e) =>
                                            updateMainCaptionStyle({ karaoke_active_color: e.target.value })
                                          }
                                        />
                                      </div>
                                    </div>

                                    <div>
                                      <label htmlFor="caption_karaoke_inactive_color">Warna Kata Lain</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                                          id="caption_karaoke_inactive_color"
                                          type="color"
                                          value={mainCaptionStyle.karaoke_inactive_color}
                                          onChange={(e) =>
                                            updateMainCaptionStyle({ karaoke_inactive_color: e.target.value })
                                          }
                                        />
                                        <input
                                          className="flex-1 font-mono text-xs"
                                          type="text"
                                          value={mainCaptionStyle.karaoke_inactive_color}
                                          onChange={(e) =>
                                            updateMainCaptionStyle({ karaoke_inactive_color: e.target.value })
                                          }
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {mainCaptionStyle.karaoke_mode === "highlight" && (
                                    <div>
                                      <label htmlFor="caption_karaoke_highlight_color">Warna Kotak Sorotan</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                                          id="caption_karaoke_highlight_color"
                                          type="color"
                                          value={mainCaptionStyle.karaoke_highlight_color}
                                          onChange={(e) =>
                                            updateMainCaptionStyle({ karaoke_highlight_color: e.target.value })
                                          }
                                        />
                                        <input
                                          className="flex-1 font-mono text-xs"
                                          type="text"
                                          value={mainCaptionStyle.karaoke_highlight_color}
                                          onChange={(e) =>
                                            updateMainCaptionStyle({ karaoke_highlight_color: e.target.value })
                                          }
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </ToolSection>
                        )}
                      </>
                    )}

                    {/* TAB 4: TRACKING (Detailed Spacing, Margins, Alignment) */}
                    {captionInspectorTab === "tracking" && (
                      <ToolSection title="Typography Spacing & Margins">
                        <div className="space-y-3.5">
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <label htmlFor="caption_letter_spacing_slider">Letter Spacing (Jarak Huruf)</label>
                              <span className="font-mono text-cyan-300 font-bold">
                                {mainCaptionStyle.letter_spacing}px
                              </span>
                            </div>
                            <input
                              id="caption_letter_spacing_slider"
                              type="range"
                              min="-2"
                              max="10"
                              step="0.5"
                              value={mainCaptionStyle.letter_spacing}
                              onChange={(e) => updateMainCaptionStyle({ letter_spacing: Number(e.target.value) })}
                              className="w-full accent-cyan-400"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <label htmlFor="caption_word_spacing_slider">Word Spacing (Jarak Kata)</label>
                              <span className="font-mono text-cyan-300 font-bold">
                                {mainCaptionStyle.word_spacing}px
                              </span>
                            </div>
                            <input
                              id="caption_word_spacing_slider"
                              type="range"
                              min="-2"
                              max="15"
                              step="0.5"
                              value={mainCaptionStyle.word_spacing}
                              onChange={(e) => updateMainCaptionStyle({ word_spacing: Number(e.target.value) })}
                              className="w-full accent-cyan-400"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <label htmlFor="caption_line_height_slider">Line Height (Jarak Baris)</label>
                              <span className="font-mono text-cyan-300 font-bold">
                                {mainCaptionStyle.line_height.toFixed(2)}
                              </span>
                            </div>
                            <input
                              id="caption_line_height_slider"
                              type="range"
                              min="1"
                              max="2"
                              step="0.05"
                              value={mainCaptionStyle.line_height}
                              onChange={(e) => updateMainCaptionStyle({ line_height: Number(e.target.value) })}
                              className="w-full accent-cyan-400"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <label htmlFor="caption_max_width_slider">Lebar Maksimal Teks</label>
                              <span className="font-mono text-cyan-300 font-bold">
                                {mainCaptionStyle.max_width_percent}%
                              </span>
                            </div>
                            <input
                              id="caption_max_width_slider"
                              type="range"
                              min="50"
                              max="100"
                              step="2"
                              value={mainCaptionStyle.max_width_percent}
                              onChange={(e) => updateMainCaptionStyle({ max_width_percent: Number(e.target.value) })}
                              className="w-full accent-cyan-400"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label htmlFor="caption_position_select">Posisi Layar</label>
                              <select
                                id="caption_position_select"
                                value={mainCaptionStyle.position}
                                onChange={(e) =>
                                  updateMainCaptionStyle({
                                    position: e.target.value as MainCaptionStyle["position"],
                                  })
                                }
                              >
                                <option value="bottom">Bawah (Bottom)</option>
                                <option value="middle">Tengah (Middle)</option>
                                <option value="top">Atas (Top)</option>
                              </select>
                            </div>
                            <div>
                              <label htmlFor="caption_align_select">Rata Teks</label>
                              <select
                                id="caption_align_select"
                                value={mainCaptionStyle.align}
                                onChange={(e) =>
                                  updateMainCaptionStyle({
                                    align: e.target.value as MainCaptionStyle["align"],
                                  })
                                }
                              >
                                <option value="center">Rata Tengah (Center)</option>
                                <option value="left">Rata Kiri (Left)</option>
                                <option value="right">Rata Kanan (Right)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </ToolSection>
                    )}

                    {/* TAB 5: TTS (Text to Speech Placeholder) */}
                    {captionInspectorTab === "tts" && (
                      <ToolSection title="Text to Speech">
                        <div className="rounded-xl border border-zinc-800 bg-[#202226] p-4 text-center text-xs text-zinc-400">
                          <p className="font-bold text-zinc-300">Text to Speech</p>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            TTS belum aktif. Akan tersedia pada tahap Audio/Voice/TTS.
                          </p>
                        </div>
                      </ToolSection>
                    )}
                  </>
                )}

                {/* 6. EFFECT INSPECTOR */}
                {inspectorContext === "effect" && (
                  <>
                    {effectInspectorTab === "effect" && (
                      <>
                        <ToolSection title={selectedEvent?.reason?.startsWith("transition") ? "TRANSITION PARAMETERS" : "Effect Parameters"}>
                          {selectedEvent ? (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">
                                  {selectedEvent.reason?.startsWith("transition")
                                    ? "Kategori"
                                    : "Tipe Efek"}
                                </span>
                                <span
                                  className={`rounded-lg px-2 py-0.5 font-semibold text-[11px] ${
                                    selectedEvent.reason?.startsWith("transition")
                                      ? "bg-cyan-500/20 text-cyan-300"
                                      : "bg-teal-500/20 text-teal-300"
                                  }`}
                                >
                                  {selectedEvent.reason?.startsWith("transition")
                                    ? `Transisi: ${selectedEvent.reason.replace("transition:", "")}`
                                    : selectedEvent.type === "punch_zoom"
                                    ? "Punch Zoom"
                                    : selectedEvent.type === "pattern_interrupt"
                                    ? "Pattern Interrupt"
                                    : selectedEvent.type}
                                </span>
                              </div>

                              {selectedEvent.reason?.startsWith("transition") ? (
                                <div className="space-y-3">
                                  {selectedTransitionBoundary && (
                                    <div className="rounded-xl border border-zinc-700/80 bg-[#1c1f24] p-2.5 text-xs text-zinc-300">
                                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-semibold mb-1">
                                        <span>Posisi Sambungan</span>
                                        <span className="font-mono text-cyan-300 font-bold">
                                          @ {formatTimePrecise(selectedTransitionBoundary.time)}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-center gap-2 rounded-lg bg-zinc-800/90 py-1.5 px-2 text-xs font-bold text-zinc-100">
                                        <span className="rounded bg-blue-500/20 text-blue-300 px-1.5 py-0.5 text-[10px]">
                                          Klip {selectedTransitionBoundary.beforeSegment.number}
                                        </span>
                                        <span className="text-cyan-400">➔</span>
                                        <span className="rounded bg-blue-500/20 text-blue-300 px-1.5 py-0.5 text-[10px]">
                                          Klip {selectedTransitionBoundary.afterSegment.number}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  <div>
                                    <label htmlFor="inspector_trans_type">Jenis Efek Transisi</label>
                                    <select
                                      id="inspector_trans_type"
                                      value={selectedEvent.effect || "fade"}
                                      onChange={(e) =>
                                        replaceEvent(selectedEvent.id || "", {
                                          effect: e.target.value,
                                          reason: `transition:${e.target.options[e.target.selectedIndex].text}`,
                                        })
                                      }
                                    >
                                      <option value="fade">Fade Black</option>
                                      <option value="fade_white">Fade White</option>
                                      <option value="flash">White Flash</option>
                                      <option value="cross_dissolve">Cross Dissolve</option>
                                      <option value="slide_left">Slide Left</option>
                                      <option value="slide_right">Slide Right</option>
                                      <option value="slide_up">Slide Up</option>
                                      <option value="slide_down">Slide Down</option>
                                      <option value="zoom_in">Zoom In</option>
                                      <option value="zoom_out">Zoom Out</option>
                                      <option value="blur_fade">Blur Fade</option>
                                      <option value="glitch_cut">Glitch Cut</option>
                                      <option value="wipe_left">Wipe Left</option>
                                    </select>
                                  </div>

                                  <div>
                                    <div className="flex items-center justify-between text-xs font-medium text-zinc-300 mb-1">
                                      <label htmlFor="inspector_trans_duration">Durasi Transisi</label>
                                      <span className="font-mono text-cyan-300 font-bold">
                                        {(selectedEvent.end - selectedEvent.start).toFixed(2)}s
                                      </span>
                                    </div>
                                    <input
                                      className="w-full accent-cyan-400"
                                      id="inspector_trans_duration"
                                      max="1.5"
                                      min="0.2"
                                      step="0.05"
                                      type="range"
                                      value={Number((selectedEvent.end - selectedEvent.start).toFixed(2))}
                                      onChange={(event) => {
                                        const newDur = Number(event.target.value);
                                        const center = selectedTransitionBoundary
                                          ? selectedTransitionBoundary.time
                                          : (selectedEvent.start + selectedEvent.end) / 2;
                                        const newStart = Number(Math.max(0, center - newDur / 2).toFixed(2));
                                        const newEnd = Number(Math.min(clipDuration, center + newDur / 2).toFixed(2));
                                        replaceEvent(selectedEvent.id || "", {
                                          start: newStart,
                                          end: newEnd,
                                        });
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : selectedEvent.type === "punch_zoom" ? (
                                <div>
                                  <div className="flex items-center justify-between text-xs font-medium text-zinc-300 mb-1">
                                    <label htmlFor="inspector_punch_level">Zoom Level</label>
                                    <span className="font-mono text-cyan-300 font-bold">
                                      {(selectedEvent.zoom || 1.2).toFixed(2)}x
                                    </span>
                                  </div>
                                  <input
                                    className="w-full accent-cyan-400"
                                    id="inspector_punch_level"
                                    max="1.40"
                                    min="1.05"
                                    onChange={(event) =>
                                      replaceEvent(selectedEvent.id || "", {
                                        zoom: Number(Number(event.target.value).toFixed(2)),
                                      })
                                    }
                                    step="0.01"
                                    type="range"
                                    value={selectedEvent.zoom || 1.2}
                                  />
                                </div>
                              ) : selectedEvent.type === "pattern_interrupt" ? (
                                <div>
                                  <label htmlFor="inspector_pattern_effect">Jenis Efek Visual</label>
                                  <select
                                    id="inspector_pattern_effect"
                                    onChange={(event) =>
                                      replaceEvent(selectedEvent.id || "", {
                                        effect: event.target.value,
                                      })
                                    }
                                    value={selectedEvent.effect || "quick_zoom"}
                                  >
                                    <option value="quick_zoom">Quick Zoom</option>
                                    <option value="flash_cut">Flash Cut</option>
                                    <option value="light_leak">Light Leak</option>
                                    <option value="quick_shake">Quick Shake</option>
                                    <option value="earthquake">Earthquake</option>
                                    <option value="blur_pulse">Blur Pulse</option>
                                    <option value="glitch_pop">Glitch Pop</option>
                                    <option value="digital_noise">Digital Noise</option>
                                    <option value="freeze_flash">Freeze Flash</option>
                                  </select>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <p className="rounded-xl bg-zinc-850 p-3 text-xs text-zinc-400">
                              Pilih event efek atau transisi di timeline untuk mengatur parameter.
                            </p>
                          )}
                        </ToolSection>

                        {selectedEvent && (
                          <ToolSection title="Actions">
                            <button
                              className="rounded-lg border border-red-800/60 bg-red-900/40 w-full py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60"
                              onClick={() => deleteEvent(selectedEvent.id || "")}
                              type="button"
                            >
                              {selectedEvent.reason?.startsWith("transition") ? "Hapus Transisi" : "Hapus Event"}
                            </button>
                          </ToolSection>
                        )}
                      </>
                    )}

                    {effectInspectorTab === "timing" && (
                      <>
                        <ToolSection title="Effect Timing">
                          {selectedEvent ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                                <div className="rounded-lg bg-zinc-800/80 p-2">
                                  <span className="block text-[10px] text-zinc-500">Mulai</span>
                                  <p className="font-mono font-bold text-zinc-100">
                                    {formatTimePrecise(selectedEvent.start)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-zinc-800/80 p-2">
                                  <span className="block text-[10px] text-zinc-500">Selesai</span>
                                  <p className="font-mono font-bold text-zinc-100">
                                    {formatTimePrecise(selectedEvent.end)}
                                  </p>
                                </div>
                                <div className="rounded-lg bg-zinc-800/80 p-2">
                                  <span className="block text-[10px] text-zinc-500">Durasi</span>
                                  <p className="font-mono font-bold text-cyan-300">
                                    {(selectedEvent.end - selectedEvent.start).toFixed(2)}s
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="rounded-xl bg-zinc-850 p-3 text-xs text-zinc-400">
                              Pilih event efek di timeline untuk melihat detail timing.
                            </p>
                          )}
                        </ToolSection>

                        {selectedEvent && (
                          <ToolSection title="Actions">
                            <button
                              className="rounded-lg border border-red-800/60 bg-red-900/40 w-full py-1.5 text-xs font-bold text-red-300 hover:bg-red-900/60"
                              onClick={() => deleteEvent(selectedEvent.id || "")}
                              type="button"
                            >
                              Hapus Event
                            </button>
                          </ToolSection>
                        )}
                      </>
                    )}
                  </>
                )}
        </aside>
      </div>

        <section
          className="editor-timeline relative min-h-0 shrink-0 border-t border-zinc-700 bg-[#181a1e] p-3 text-zinc-100 xl:overflow-hidden"
          style={{ height: `${timelineHeight}px` }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            setSelectedEventId(null);
            setSelectedCaptionId(null);
            setSelectedMediaSegmentId(null);
            setSelectedAdditionalAudioTrackId(null);
            setSelectedEditorContext("details");
          }}
        >
        <div
          aria-label="Ubah tinggi timeline"
          aria-orientation="horizontal"
          aria-valuemax={Math.max(320, window.innerHeight - 260)}
          aria-valuemin={180}
          aria-valuenow={Math.round(timelineHeight)}
          className="timeline-resize-handle group absolute -top-1.5 left-0 right-0 z-30 flex h-3 touch-none cursor-ns-resize items-center justify-center"
          onDoubleClick={() => {
            markEditorPreferenceDirty();
            setTimelineHeight(230);
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
              setTimelineHeight(230);
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
        {/* TIMELINE TOP TOOLBAR (1-Row CapCut Minimalist) */}
        <div className="flex h-9 sm:h-10 items-center justify-between gap-2 border-b border-zinc-800/90 pb-1.5 pt-0.5">
          {/* A. LEFT: Primary Edit Actions */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* 1. Add / Insert Element Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setTimelineAddMenuOpen((open) => !open)}
                title="Tambah Elemen (Punch Zoom, Keyword, Pattern, Hook)"
                aria-label="Tambah Elemen"
                className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-sm sm:text-base font-black transition shadow-sm ${
                  timelineAddMenuOpen
                    ? "bg-cyan-400 text-slate-950 shadow-cyan-500/20"
                    : "bg-[#25282e] text-cyan-300 border border-zinc-700/80 hover:border-cyan-400/80 hover:bg-[#2f333b] hover:text-cyan-200"
                }`}
              >
                +
              </button>
              {timelineAddMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setTimelineAddMenuOpen(false)}
                  />
                  <div className="absolute left-0 top-9 z-50 w-48 rounded-xl border border-zinc-700/90 bg-[#1e2126] p-1.5 shadow-2xl shadow-black/80 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        addEvent("punch_zoom");
                        setTimelineAddMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-rose-300 transition"
                    >
                      <span className="size-2.5 rounded-full bg-rose-500 shrink-0" />
                      <span>Punch Zoom</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        addEvent("keyword_popup");
                        setTimelineAddMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-yellow-300 transition"
                    >
                      <span className="size-2.5 rounded-full bg-yellow-400 shrink-0" />
                      <span>Keyword Popup</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        addEvent("pattern_interrupt");
                        setTimelineAddMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-teal-300 transition"
                    >
                      <span className="size-2.5 rounded-full bg-teal-500 shrink-0" />
                      <span>Pattern Interrupt</span>
                    </button>
                    {!editableEffectTimeline.some((event) => event.type === "hook_text") && (
                      <button
                        type="button"
                        onClick={() => {
                          addEvent("hook_text");
                          setTimelineAddMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-cyan-300 transition"
                      >
                        <span className="size-2.5 rounded-full bg-cyan-400 shrink-0" />
                        <span>Hook Text</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 2. History (Undo / Redo) */}
            <div className="flex items-center rounded-lg border border-zinc-700/80 bg-[#22252a] p-0.5">
              <button
                type="button"
                onClick={undoEditor}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded text-sm font-bold text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ↶
              </button>
              <button
                type="button"
                onClick={redoEditor}
                disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z atau Ctrl+Y)"
                aria-label="Redo"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded text-sm font-bold text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ↷
              </button>
            </div>

            <span className="h-4 w-px bg-zinc-700/60 mx-0.5" />

            {/* 3. Primary Edit Tool Group (Split, Trim L, Trim R, Delete, Copy, Paste) */}
            <div className="flex items-center rounded-lg border border-zinc-700/80 bg-[#22252a] p-0.5">
              <button
                type="button"
                onClick={splitSelectedTrack}
                disabled={!selectedTrackSupportsMediaEditing}
                title="Split / Bagi item terpilih pada playhead"
                aria-label="Split"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded text-sm text-zinc-300 hover:bg-zinc-700 hover:text-cyan-300 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ✂
              </button>
              <button
                type="button"
                onClick={deleteLeftSelectedTrack}
                disabled={!selectedTrackSupportsMediaEditing}
                title="Potong sisi kiri item terpilih hingga playhead"
                aria-label="Potong sisi kiri"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded font-mono text-xs sm:text-sm text-zinc-300 hover:bg-zinc-700 hover:text-cyan-300 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ⇤
              </button>
              <button
                type="button"
                onClick={deleteRightSelectedTrack}
                disabled={!selectedTrackSupportsMediaEditing}
                title="Potong sisi kanan item terpilih hingga playhead"
                aria-label="Potong sisi kanan"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded font-mono text-xs sm:text-sm text-zinc-300 hover:bg-zinc-700 hover:text-cyan-300 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ⇥
              </button>
              <button
                type="button"
                onClick={deleteSelectedTrackItem}
                disabled={!anyTrackSelected}
                title="Hapus seluruh item terpilih"
                aria-label="Hapus"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded text-sm text-red-300 hover:bg-red-950/60 hover:text-red-200 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                🗑
              </button>
              <span className="h-4 w-px bg-zinc-700/60 mx-0.5" />
              <button
                type="button"
                onClick={copySelectedTrack}
                disabled={!selectedTrackSupportsMediaEditing}
                title="Salin item track yang dipilih (Ctrl+C)"
                aria-label="Copy"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded text-sm text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                📋
              </button>
              <button
                type="button"
                onClick={pasteSelectedTrack}
                disabled={!copiedMediaSegment && !copiedTimedItem}
                title="Tempel item yang disalin pada playhead (Ctrl+V)"
                aria-label="Paste"
                className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded text-sm text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                📥
              </button>
            </div>

            {/* 4. Extract / Merge Audio Icon Button */}
            {audioExtracted ? (
              <button
                type="button"
                onClick={mergeAudioIntoVideoTrack}
                title="Gabungkan Audio kembali ke Video"
                aria-label="Gabungkan Audio"
                className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm text-amber-300 hover:bg-amber-500/20 transition"
              >
                🔗
              </button>
            ) : (
              <button
                type="button"
                onClick={extractAudioTrack}
                title="Ekstrak Audio dari Video ke track terpisah"
                aria-label="Ekstrak Audio"
                className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-sm text-cyan-300 hover:bg-cyan-500/20 transition"
              >
                🎵
              </button>
            )}

            {timelineError && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-bold text-red-300 truncate max-w-[140px]" title={timelineError}>
                {timelineError}
              </span>
            )}
          </div>

          {/* B. CENTER: Time Summary Pill */}
          <div className="flex items-center justify-center">
            <span className="rounded-lg border border-zinc-700/70 bg-[#22252a] px-2.5 py-1 font-mono text-xs font-bold tracking-wider text-cyan-300 shadow-inner">
              {formatTimeLabel(previewTime)} / {formatTimeLabel(clipDuration)}
            </span>
          </div>

          {/* C. RIGHT: View & Zoom Controls */}
          <div className="flex items-center gap-2">
            {/* Track Legend Dots */}
            <div className="hidden lg:flex items-center gap-1.5 rounded-lg border border-zinc-700/50 bg-[#22252a] px-2.5 py-1">
              <span className="size-2.5 rounded-full bg-cyan-500 cursor-help" title="Track Text" />
              <span className="size-2.5 rounded-full bg-amber-400 cursor-help" title="Track Overlay" />
              <span className="size-2.5 rounded-full bg-blue-600 cursor-help" title="Track Video" />
              <span className="size-2.5 rounded-full bg-emerald-500 cursor-help" title="Track Audio" />
            </div>

            {/* Theme Toggle (Icon Only) */}
            <button
              type="button"
              onClick={() => {
                markEditorPreferenceDirty();
                setEditorTheme((theme) => (theme === "dark" ? "light" : "dark"));
              }}
              title={editorTheme === "dark" ? "Ubah ke Mode Cerah" : "Ubah ke Mode Gelap"}
              aria-label="Ubah tema editor"
              className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-zinc-700 bg-[#22252a] text-sm text-zinc-300 hover:border-cyan-400 hover:text-cyan-300 transition"
            >
              {editorTheme === "dark" ? "☀" : "☾"}
            </button>

            {/* Zoom Controls (CapCut Style: [ - ] [ Slider (25..400) ] [ + ] [ 100% ]) */}
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-[#22252a] px-2 h-7 sm:h-8">
              <button
                type="button"
                onClick={() => {
                  markEditorPreferenceDirty();
                  updateTimelineZoomPercent((value) => Math.max(25, value - 25));
                }}
                disabled={timelineZoomPercent <= 25}
                title="Perkecil zoom timeline (Zoom Out)"
                aria-label="Perkecil zoom timeline"
                className="text-sm font-black text-zinc-400 hover:text-cyan-300 disabled:opacity-30 disabled:pointer-events-none transition px-0.5"
              >
                −
              </button>
              <input
                aria-label="Zoom timeline"
                className="h-1 w-14 sm:w-16 md:w-20 accent-cyan-400 cursor-pointer"
                max={400}
                min={25}
                onChange={(event) => {
                  markEditorPreferenceDirty();
                  updateTimelineZoomPercent(Number(event.target.value));
                }}
                step={25}
                type="range"
                value={timelineZoomPercent}
              />
              <button
                type="button"
                onClick={() => {
                  markEditorPreferenceDirty();
                  updateTimelineZoomPercent((value) => Math.min(400, value + 25));
                }}
                disabled={timelineZoomPercent >= 400}
                title="Perbesar zoom timeline (Zoom In)"
                aria-label="Perbesar zoom timeline"
                className="text-sm font-black text-zinc-400 hover:text-cyan-300 disabled:opacity-30 disabled:pointer-events-none transition px-0.5"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => {
                  markEditorPreferenceDirty();
                  updateTimelineZoomPercent(100);
                }}
                title="Klik untuk reset zoom ke 100%"
                className="min-w-8 text-right font-mono text-[10px] sm:text-xs font-bold text-zinc-400 hover:text-cyan-300 transition"
              >
                {timelineZoomPercent}%
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 min-h-0 overflow-auto pr-1 xl:max-h-[216px]">
          <div style={{ width: `${Math.max(25, timelineContentScale * 100)}%`, minWidth: "240px" }}>
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
            <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-3" style={{ order: -1 }}>
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
            {!hasAnyTimelineTracks ? (
              <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2 py-2">
                <div />
                <div
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-800 bg-[#191b1f]/60 py-6 px-4 text-center transition hover:border-zinc-700"
                  {...timelinePointerProps}
                >
                  <span className="text-xl mb-1 text-zinc-500">🎬</span>
                  <p className="text-xs font-bold text-zinc-300">
                    Timeline Kosong
                  </p>
                  <p className="mt-1 text-[11px] text-zinc-500 max-w-sm">
                    Import media dari panel kiri atau klik tombol <span className="font-bold text-cyan-400">+</span> pada toolbar timeline untuk mulai menyusun klip.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {textLanes.map((laneItems, laneIndex) => {
                  const laneId = `text-lane-${laneIndex}`;
                  const isLaneLocked = laneItems.length > 0 && laneItems.every((item) => Boolean(item.locked));
                  const isLaneVisible = laneItems.every((item) => item.visible !== false);
                  const isSelectedLane = selectedTimelineLaneId === laneId;
                  return (
                    <TimelineTrack
                      laneId={laneId}
                      trackKey="text"
                      locked={isLaneLocked}
                      onToggleLock={() => toggleLaneLock(laneItems)}
                      visible={isLaneVisible}
                      onToggleVisibility={() => toggleLaneVisibility(laneItems)}
                      onSelectLane={() => setSelectedTimelineLaneId(laneId)}
                      onOpenLaneMenu={(e) => {
                        setLaneContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          laneId,
                          trackKey: "text",
                          label: `Track Text ${laneIndex + 1}`,
                          items: laneItems,
                          locked: isLaneLocked,
                        });
                      }}
                      isLaneSelected={isSelectedLane}
                      {...timelineTrackOrderProps("text")}
                      duration={timelineScaleDuration}
                      items={laneItems}
                      key={laneId}
                      label="Text"
                      {...editableMarkerProps}
                      onItemResizePointerDown={startTimedItemResize}
                      onItemResizePointerMove={moveTimedItemResize}
                      onItemResizePointerUp={finishTimedItemResize}
                      resizable={
                        !isLaneLocked && (
                          selectedEditorContext === "hook" ||
                          selectedEditorContext === "caption" ||
                          (selectedEditorContext === "keyword" && !selectedEvent?.reason?.toLowerCase().includes("sticker"))
                        )
                      }
                      selectedItemId={selectedEventId || selectedCaptionId}
                      {...timelinePointerProps}
                      playheadPercent={playheadPercent}
                      selected={
                        selectedEditorContext === "hook" ||
                        selectedEditorContext === "caption" ||
                        (selectedEditorContext === "keyword" && !selectedEvent?.reason?.toLowerCase().includes("sticker"))
                      }
                    />
                  );
                })}
                {overlayLanes.map((laneItems, laneIndex) => {
                  const laneId = `overlay-lane-${laneIndex}`;
                  const isLaneLocked = laneItems.length > 0 && laneItems.every((item) => Boolean(item.locked));
                  const isLaneVisible = laneItems.every((item) => item.visible !== false);
                  const isSelectedLane = selectedTimelineLaneId === laneId;
                  return (
                    <TimelineTrack
                      laneId={laneId}
                      trackKey="overlay"
                      locked={isLaneLocked}
                      onToggleLock={() => toggleLaneLock(laneItems)}
                      visible={isLaneVisible}
                      onToggleVisibility={() => toggleLaneVisibility(laneItems)}
                      onSelectLane={() => setSelectedTimelineLaneId(laneId)}
                      onOpenLaneMenu={(e) => {
                        setLaneContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          laneId,
                          trackKey: "overlay",
                          label: `Track Overlay ${laneIndex + 1}`,
                          items: laneItems,
                          locked: isLaneLocked,
                        });
                      }}
                      isLaneSelected={isSelectedLane}
                      {...timelineTrackOrderProps("overlay")}
                      duration={timelineScaleDuration}
                      items={laneItems}
                      key={laneId}
                      label="Overlay"
                      {...editableMarkerProps}
                      onItemResizePointerDown={startTimedItemResize}
                      onItemResizePointerMove={moveTimedItemResize}
                      onItemResizePointerUp={finishTimedItemResize}
                      resizable={
                        !isLaneLocked && (
                          selectedEditorContext === "effect" ||
                          (selectedEditorContext === "keyword" && Boolean(selectedEvent?.reason?.toLowerCase().includes("sticker")))
                        )
                      }
                      selectedItemId={selectedEventId}
                      {...timelinePointerProps}
                      playheadPercent={playheadPercent}
                      selected={
                        selectedEditorContext === "effect" ||
                        (selectedEditorContext === "keyword" && Boolean(selectedEvent?.reason?.toLowerCase().includes("sticker")))
                      }
                    />
                  );
                })}
                {videoLanes.map((laneItems, laneIndex) => {
                  const laneId = `video-lane-${laneIndex}`;
                  const isLaneLocked = laneItems.length > 0 && laneItems.every((item) => Boolean(item.locked));
                  const isLaneVisible = laneItems.every((item) => item.visible !== false);
                  const isSelectedLane = selectedTimelineLaneId === laneId;
                  return (
                    <TimelineTrack
                      laneId={laneId}
                      trackKey="video"
                      locked={isLaneLocked}
                      onToggleLock={() => toggleLaneLock(laneItems)}
                      visible={isLaneVisible}
                      onToggleVisibility={() => toggleLaneVisibility(laneItems)}
                      muted={audioExtracted ? true : (videoMuted || audioSettings.muted)}
                      onToggleMute={toggleVideoMuted}
                      muteDisabled={audioExtracted}
                      muteTooltip={audioExtracted ? "Audio sudah dipisah ke track AUDIO" : undefined}
                      onSelectLane={() => setSelectedTimelineLaneId(laneId)}
                      onOpenLaneMenu={(e) => {
                        setLaneContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          laneId,
                          trackKey: "video",
                          label: `Track Video ${laneIndex + 1}`,
                          items: laneItems,
                          locked: isLaneLocked,
                        });
                      }}
                      isLaneSelected={isSelectedLane}
                      {...timelineTrackOrderProps("video")}
                      duration={timelineScaleDuration}
                      items={laneItems}
                      key={laneId}
                      label="Video"
                      onItemClick={selectTimelineItem}
                      onItemContextMenu={handleTrackItemContextMenu}
                      onItemResizePointerDown={startMediaResize}
                      onItemResizePointerMove={moveMediaResize}
                      onItemResizePointerUp={finishMediaResize}
                      resizable={!isLaneLocked && selectedEditorContext === "video"}
                      selectedItemId={selectedMediaSegmentId}
                      {...timelinePointerProps}
                      playheadPercent={playheadPercent}
                      selected={selectedEditorContext === "video"}
                      transitions={timelineTransitionMarkers}
                      onTransitionClick={(eventId) => {
                        setSelectedEventId(eventId);
                        setSelectedEditorContext("effect");
                        setEffectInspectorTab("effect");
                      }}
                    />
                  );
                })}
                {audioLanes.map((laneItems, laneIndex) => {
                  const laneId = `audio-lane-${laneIndex}`;
                  const isExtractedAudioLane = laneItems.some((item) => item.type === "audio");
                  const isLaneLocked = laneItems.length > 0 && laneItems.every((item) => Boolean(item.locked));
                  const isLaneMuted = isExtractedAudioLane
                    ? audioSettings.muted
                    : laneItems.length > 0 && laneItems.every((item) => Boolean(item.muted));
                  const isSelectedLane = selectedTimelineLaneId === laneId;

                  return (
                    <TimelineTrack
                      laneId={laneId}
                      trackKey="audio"
                      locked={isLaneLocked}
                      onToggleLock={() => toggleLaneLock(laneItems)}
                      muted={isLaneMuted}
                      onToggleMute={() => toggleLaneMute(laneItems)}
                      onSelectLane={() => setSelectedTimelineLaneId(laneId)}
                      onOpenLaneMenu={(e) => {
                        setLaneContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          laneId,
                          trackKey: "audio",
                          label: `Track Audio ${laneIndex + 1}`,
                          items: laneItems,
                          locked: isLaneLocked,
                        });
                      }}
                      isLaneSelected={isSelectedLane}
                      {...timelineTrackOrderProps("audio")}
                      duration={timelineScaleDuration}
                      items={laneItems}
                      key={laneId}
                      label="Audio"
                      onItemClick={selectTimelineItem}
                      onItemContextMenu={handleTrackItemContextMenu}
                      onItemResizePointerDown={startMediaResize}
                      onItemResizePointerMove={moveMediaResize}
                      onItemResizePointerUp={finishMediaResize}
                      resizable={!isLaneLocked && selectedEditorContext === "audio"}
                      selectedItemId={selectedMediaSegmentId || selectedAdditionalAudioTrackId}
                      {...timelinePointerProps}
                      playheadPercent={playheadPercent}
                      selected={selectedEditorContext === "audio"}
                    />
                  );
                })}
              </>
            )}
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
                        onClick={() => {
                          setExportResolution(value);
                          setRenderDirty(true);
                          setExportRenderId(null);
                          setExportValidatedRenderId(null);
                        }}
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
                        onClick={() => {
                          setExportQuality(value);
                          setRenderDirty(true);
                          setExportRenderId(null);
                          setExportValidatedRenderId(null);
                        }}
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

                {renderDirty && (
                  <div className="rounded-xl border border-amber-400/40 bg-amber-950/40 p-3 text-xs font-bold text-amber-200 flex items-center gap-2">
                    <span className="text-base">⚠️</span>
                    <span>Ada perubahan, render ulang diperlukan</span>
                  </div>
                )}
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
                    ["hook_text", "pattern_interrupt", "keyword_popup"].includes(event.type),
                  ) ||
                  additionalAudioTracks.length > 0) && (
                  <div className="rounded-lg border border-amber-400/30 bg-amber-950/35 p-3 text-xs text-amber-100">
                    <p className="font-black">Catatan Kompatibilitas Export v1</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 font-semibold text-amber-100/80">
                      {editableCaptionCues.length > 0 && (
                        <li>Mode tampilan Caption tertentu disesuaikan dengan pipeline render aktif.</li>
                      )}
                      {editableEffectTimeline.some((event) => event.type === "hook_text") && (
                        <li>Teks, timing, dan gaya dasar hook tetap diekspor.</li>
                      )}
                      {editableEffectTimeline.some(
                        (event) =>
                          event.type === "keyword_popup" &&
                          event.reason?.startsWith("sticker"),
                      ) && (
                        <li>Sticker overlay emoji aktif di Live Preview editor; render final akan mengikuti pipeline saat ini.</li>
                      )}
                      {editableEffectTimeline.some(
                        (event) =>
                          event.type === "pattern_interrupt" &&
                          event.reason?.startsWith("transition"),
                      ) && (
                        <li>Efek transisi visual aktif pada Live Preview editor.</li>
                      )}
                      {additionalAudioTracks.length > 0 && (
                        <li>Audio/SFX tambahan aktif di Live Preview editor dan akan dicampur bertahap pada update export pipeline.</li>
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

      {/* LANE CONTEXT MENU */}
      {laneContextMenu && (
        <div
          aria-label="Menu opsi track"
          className="fixed z-[100] w-56 overflow-hidden rounded-xl border border-zinc-600 bg-[#25282d] p-1.5 text-zinc-100 shadow-2xl shadow-black/60"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{
            left: Math.max(8, Math.min(laneContextMenu.x, window.innerWidth - 240)),
            top: Math.max(8, Math.min(laneContextMenu.y, window.innerHeight - 180)),
          }}
        >
          <div className="border-b border-zinc-700 px-3 py-2">
            <p className="truncate text-xs font-black text-white">
              {laneContextMenu.label}
            </p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">
              {laneContextMenu.items.length} item • {laneContextMenu.locked ? "Terkunci" : "Aktif"}
            </p>
          </div>
          <div className="py-1">
            <button
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-zinc-700 transition"
              onClick={() => {
                selectAllLaneItems(laneContextMenu.trackKey, laneContextMenu.items);
                setLaneContextMenu(null);
              }}
              role="menuitem"
              type="button"
            >
              <span>Pilih Semua Item</span>
              <span className="text-[10px] text-zinc-400 font-normal">Track</span>
            </button>
            <button
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold transition ${
                laneContextMenu.locked
                  ? "text-zinc-500 opacity-50 cursor-not-allowed"
                  : "text-red-400 hover:bg-red-950/60 hover:text-red-300"
              }`}
              onClick={() => {
                const { laneId, trackKey, label, items, locked } = laneContextMenu;
                setLaneContextMenu(null);
                requestDeleteLaneContents(laneId, trackKey, label, items, locked);
              }}
              role="menuitem"
              type="button"
            >
              <span className="flex items-center gap-1.5">
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Hapus Isi Track
              </span>
              <span className="text-[10px] text-red-400/80 font-normal">Seluruh item</span>
            </button>
          </div>
        </div>
      )}

      {/* TRACK DELETE CONFIRMATION MODAL */}
      {trackDeleteConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700/80 bg-[#1e2126] p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-950/80 border border-red-800/60 text-red-400">
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-100">
                  Hapus Seluruh Isi {trackDeleteConfirm.label}?
                </h3>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  <span className="font-bold text-red-300">{trackDeleteConfirm.itemCount} item</span> pada track ini akan dihapus dari timeline secara sekaligus.
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setTrackDeleteConfirm(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const { trackKey, items } = trackDeleteConfirm;
                  setTrackDeleteConfirm(null);
                  deleteTimelineLaneContents(trackKey, items);
                }}
                className="rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md hover:bg-red-500 transition"
              >
                Hapus Track
              </button>
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

function CollapsibleToolSection({
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#181a1d] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-2.5 text-left text-xs font-bold text-zinc-300 hover:bg-zinc-800/40 transition"
      >
        <span className="flex items-center gap-2">
          <span
            className="text-[10px] text-zinc-500 transition-transform duration-200 inline-block"
            style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            ▶
          </span>
          <span className="uppercase text-[11px] tracking-wider text-zinc-300">{title}</span>
        </span>
        {badge && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-300">
            {badge}
          </span>
        )}
      </button>
      {isOpen && <div className="border-t border-zinc-800/80 p-3 space-y-3">{children}</div>}
    </div>
  );
}

function TextStylePresetSelector({
  label,
  onChange,
  value,
}: {
  label?: string;
  onChange: (value: TextStylePresetKey) => void;
  value: TextStylePresetKey;
}) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>}
      <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto pr-1">
        {TEXT_STYLE_PRESETS.map((preset) => {
          const previewStyle = resolveTextOverlayStyle(preset.key);
          const isCurrent = value === preset.key;
          return (
            <button
              aria-label={preset.label}
              className={`flex flex-col items-center justify-center rounded-lg border p-1.5 transition-all text-center ${
                isCurrent
                  ? "border-cyan-400 bg-cyan-950/30 ring-2 ring-cyan-400/40 shadow-sm"
                  : "border-zinc-800 bg-[#1e2024] hover:border-zinc-600 hover:bg-[#25282e]"
              }`}
              key={preset.key}
              onClick={() => onChange(preset.key)}
              title={preset.label}
              type="button"
            >
              <span
                className="block text-xs font-black leading-none mb-1 select-none"
                style={{
                  color: previewStyle.color || "#ffffff",
                  textShadow: previewStyle.textShadow,
                  WebkitTextStroke: previewStyle.WebkitTextStroke,
                  fontFamily: previewStyle.fontFamily,
                  textTransform: previewStyle.textTransform,
                }}
              >
                Aa
              </span>
              <span className="block truncate text-[9px] font-medium text-zinc-400 w-full">
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] font-medium text-zinc-400">
        Preset aktif: <span className="text-cyan-300 font-bold">{getTextStylePreset(value).label}</span>
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
