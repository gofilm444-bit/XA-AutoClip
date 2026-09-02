import type { Transformation } from "../types";

type TransformationStyleSource =
  | Pick<Transformation, "clipper_style_config">
  | null
  | undefined;

export function isManualEditorTransformation(transformation: TransformationStyleSource) {
  return Boolean(transformation?.clipper_style_config?.manual_editor_mode);
}

export function hasManualEditorTimelineVideo(transformation: TransformationStyleSource) {
  return Boolean(
    (transformation?.clipper_style_config?.video_sequence || []).length &&
      !transformation?.clipper_style_config?.video_track_deleted,
  );
}

export function initialEditorContext(transformation: TransformationStyleSource) {
  return isManualEditorTransformation(transformation) &&
    !hasManualEditorTimelineVideo(transformation)
    ? ("media" as const)
    : ("video" as const);
}

export type MediaSequenceSegment = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  start?: number;
  end?: number;
  duration?: number;
  speed?: number;
  locked?: boolean;
  visible?: boolean;
  muted?: boolean;
  asset_id?: string;
  name?: string;
  source_url?: string;
  sourceUrl?: string;
  source_path?: string;
  sourcePath?: string;
};

const finiteNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function effectiveMediaDuration(segment: {
  sourceStart?: number;
  sourceEnd?: number;
  source_start?: number;
  source_end?: number;
  speed?: number;
}): number {
  const sourceStart = finiteNumber(segment.sourceStart ?? segment.source_start, 0);
  const sourceEnd = finiteNumber(segment.sourceEnd ?? segment.source_end, sourceStart);
  const speed = Math.max(0.25, finiteNumber(segment.speed, 1));
  return Math.max(0, sourceEnd - sourceStart) / speed;
}

export function normalizeMediaSequence(value: unknown, legacyDuration?: number): MediaSequenceSegment[] {
  if (!Array.isArray(value)) return [];
  const result: MediaSequenceSegment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const sourceStart = Math.max(0, finiteNumber(rec.source_start ?? rec.sourceStart, 0));
    let sourceEnd = finiteNumber(rec.source_end ?? rec.sourceEnd, Number.NaN);
    if (!Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) {
      const storedDuration = finiteNumber(rec.duration, 0);
      if (storedDuration > 0) sourceEnd = sourceStart + storedDuration;
      else if (!rec.asset_id && legacyDuration && legacyDuration > sourceStart) sourceEnd = legacyDuration;
      else sourceEnd = sourceStart + 5;
    }
    if (!rec.asset_id && legacyDuration && legacyDuration > 0.1) {
      sourceEnd = Math.min(sourceEnd, legacyDuration);
    }
    if (sourceEnd - sourceStart < 0.05) continue;

    const speed = Math.max(0.25, Math.min(4, finiteNumber(rec.speed, 1)));
    const effectiveDuration = (sourceEnd - sourceStart) / speed;
    const storedStart = finiteNumber(rec.start, Number.NaN);
    const storedEnd = finiteNumber(rec.end, Number.NaN);
    const storedDuration = finiteNumber(rec.duration, Number.NaN);
    result.push({
      id: String(rec.id || `media-${index}`),
      sourceStart: Number(sourceStart.toFixed(3)),
      sourceEnd: Number(sourceEnd.toFixed(3)),
      start: Number.isFinite(storedStart) ? Number(storedStart.toFixed(3)) : undefined,
      end: Number.isFinite(storedEnd) ? Number(storedEnd.toFixed(3)) : undefined,
      duration: Number.isFinite(storedDuration)
        ? Number(storedDuration.toFixed(3))
        : Number(effectiveDuration.toFixed(3)),
      speed: Number(speed.toFixed(2)),
      asset_id: rec.asset_id ? String(rec.asset_id) : undefined,
      name: rec.name ? String(rec.name) : undefined,
      source_url: rec.source_url || rec.sourceUrl ? String(rec.source_url || rec.sourceUrl) : undefined,
      source_path: rec.source_path || rec.sourcePath ? String(rec.source_path || rec.sourcePath) : undefined,
      locked: rec.locked ? Boolean(rec.locked) : undefined,
      visible: rec.visible !== undefined ? Boolean(rec.visible) : undefined,
      muted: rec.muted ? Boolean(rec.muted) : undefined,
    });
  }
  return result;
}

export function resolveVideoSourceTime(
  segment: MediaSequenceSegment & { start: number; end: number },
  timelineTime: number,
  endEpsilon: number = 0.03,
): number {
  const speed = Math.max(0.25, finiteNumber(segment.speed, 1));
  const requested = segment.sourceStart + Math.max(0, timelineTime - segment.start) * speed;
  const safeEnd = Math.max(segment.sourceStart, segment.sourceEnd - Math.max(0, endEpsilon));
  return Math.max(segment.sourceStart, Math.min(safeEnd, requested));
}

export function trimMediaSegmentRight(
  segment: MediaSequenceSegment,
  timelineStart: number,
  draggedTimelineEnd: number,
  assetDuration?: number | null,
  minimumDuration: number = 0.5,
): MediaSequenceSegment {
  const speed = Math.max(0.25, finiteNumber(segment.speed, 1));
  const currentSourceDuration = Math.max(0, segment.sourceEnd - segment.sourceStart);
  const maximumSourceEnd = assetDuration && assetDuration > 0
    ? assetDuration
    : segment.sourceStart + currentSourceDuration;
  const maximumTimelineDuration = Math.max(minimumDuration, (maximumSourceEnd - segment.sourceStart) / speed);
  const requestedDuration = Math.max(minimumDuration, draggedTimelineEnd - timelineStart);
  const duration = Math.min(maximumTimelineDuration, requestedDuration);
  const sourceEnd = Math.min(maximumSourceEnd, segment.sourceStart + duration * speed);
  return {
    ...segment,
    start: Number(timelineStart.toFixed(3)),
    end: Number((timelineStart + duration).toFixed(3)),
    duration: Number(duration.toFixed(3)),
    speed: Number(speed.toFixed(2)),
    sourceEnd: Number(sourceEnd.toFixed(3)),
  };
}

export function getTimelineDuration(
  videoSequence: unknown[],
  audioSequence: unknown[] = [],
  additionalAudioTracks: unknown[] = [],
  captions: unknown[] = [],
  effects: unknown[] = [],
  fallbackDuration: number = 0.0,
): number {
  const calcSeqEnd = (seq: unknown[]) => {
    if (!Array.isArray(seq) || seq.length === 0) return 0.0;
    return seq.reduce<number>((acc, item) => {
      if (!item || typeof item !== "object") return acc;
      const rec = item as Record<string, unknown>;
      const dur = effectiveMediaDuration(rec);
      return acc + dur;
    }, 0.0);
  };

  const videoEnd = calcSeqEnd(videoSequence);
  const audioEnd = calcSeqEnd(audioSequence);

  const calcMaxEnd = (items: unknown[]) => {
    if (!Array.isArray(items) || items.length === 0) return 0.0;
    return items.reduce<number>((maxVal, item) => {
      if (!item || typeof item !== "object") return maxVal;
      const rec = item as Record<string, unknown>;
      const endVal = Number(rec.end ?? 0);
      return Math.max(maxVal, Number.isFinite(endVal) ? endVal : 0);
    }, 0.0);
  };

  const additionalEnd = calcMaxEnd(additionalAudioTracks);
  const captionEnd = calcMaxEnd(captions);
  const effectEnd = calcMaxEnd(effects);

  const maxVideoAudio = Math.max(videoEnd, audioEnd);
  if (maxVideoAudio > 0.05) {
    return Number(maxVideoAudio.toFixed(3));
  }

  const maxAny = Math.max(maxVideoAudio, additionalEnd, captionEnd, effectEnd);
  if (maxAny > 0.05) {
    return Number(maxAny.toFixed(3));
  }

  return Math.max(0.0, Number(fallbackDuration) || 0.0);
}

export function getActiveVideoSegment<T extends { id: string; start: number; end: number }>(
  segments: T[],
  currentTime: number,
  epsilon: number = 0.001,
): T | null {
  if (!segments || segments.length === 0) return null;
  const found = segments.find(
    (s) => currentTime >= s.start - epsilon && currentTime < s.end - epsilon,
  );
  if (found) return found;
  if (currentTime >= segments[segments.length - 1].end - epsilon) {
    return segments[segments.length - 1];
  }
  return segments[0] || null;
}

export function getNextVideoSegment<T extends { id: string; start: number; end: number }>(
  segments: T[],
  currentSegmentId: string,
): T | null {
  if (!segments || segments.length === 0) return null;
  const idx = segments.findIndex((s) => s.id === currentSegmentId);
  if (idx >= 0 && idx < segments.length - 1) {
    return segments[idx + 1];
  }
  return null;
}

export type MediaAssetRecord = {
  asset_id: string;
  kind?: string;
  name?: string;
  source_url?: string;
  url?: string;
  file_url?: string;
  [key: string]: unknown;
};

export function normalizeToAbsoluteApiUrl(url: string, baseUrl = "http://localhost:8000"): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  const cleanBase = (baseUrl || "http://localhost:8000").replace(/\/+$/, "");
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${cleanBase}${cleanPath}`;
}

export function resolveVideoSegmentSource(
  segment: {
    id?: string;
    asset_id?: string;
    source_url?: string;
    sourceUrl?: string;
    source_path?: string;
    sourcePath?: string;
    [key: string]: unknown;
  } | null | undefined,
  mediaAssetById: Record<string, MediaAssetRecord> | Map<string, MediaAssetRecord> | MediaAssetRecord[] | null | undefined,
  fallbackSourceClipUrl: string,
  transformationId?: string,
  apiBaseUrl: string = "http://localhost:8000",
): {
  resolvedSource: string;
  fallbackUsed: boolean;
  error?: string;
} {
  const safeFallback = normalizeToAbsoluteApiUrl(fallbackSourceClipUrl, apiBaseUrl);
  if (!segment) {
    return { resolvedSource: safeFallback, fallbackUsed: true };
  }

  // 1. Priority 1: segment.source_url / segment.sourceUrl
  const segUrl = segment.source_url || (segment as Record<string, unknown>).sourceUrl;
  if (segUrl && typeof segUrl === "string" && segUrl.trim().length > 0) {
    return { resolvedSource: normalizeToAbsoluteApiUrl(segUrl, apiBaseUrl), fallbackUsed: false };
  }

  // 2. Priority 2: mediaAssetById[segment.asset_id]
  const assetId = segment.asset_id ? String(segment.asset_id) : undefined;
  if (assetId) {
    let asset: MediaAssetRecord | undefined;
    if (Array.isArray(mediaAssetById)) {
      asset = mediaAssetById.find((a) => a && String(a.asset_id) === assetId);
    } else if (mediaAssetById instanceof Map) {
      asset = mediaAssetById.get(assetId);
    } else if (mediaAssetById && typeof mediaAssetById === "object") {
      asset = (mediaAssetById as Record<string, MediaAssetRecord>)[assetId];
    }

    if (asset) {
      const assetUrl = asset.source_url || asset.url || asset.file_url;
      if (assetUrl && typeof assetUrl === "string" && assetUrl.trim().length > 0) {
        return { resolvedSource: normalizeToAbsoluteApiUrl(assetUrl, apiBaseUrl), fallbackUsed: false };
      }
    }

    // Direct API route if transformationId is provided
    if (transformationId) {
      const cleanBase = (apiBaseUrl || "http://localhost:8000").replace(/\/+$/, "");
      const directUrl = `${cleanBase}/api/transformations/${transformationId}/media/${assetId}/source`;
      return { resolvedSource: directUrl, fallbackUsed: false };
    }
  }

  // Priority 3: Fallback sourceClipUrl only for single-source / legacy projects (no asset_id)
  if (!assetId) {
    return { resolvedSource: safeFallback, fallbackUsed: true };
  }

  return {
    resolvedSource: safeFallback,
    fallbackUsed: true,
    error: "Source media tidak ditemukan untuk segment ini",
  };
}

export function sameMediaSource(urlA?: string | null, urlB?: string | null, baseUrl = "http://localhost:8000"): boolean {
  if (!urlA || !urlB) return false;
  const cleanA = typeof urlA === "string" ? urlA.trim() : "";
  const cleanB = typeof urlB === "string" ? urlB.trim() : "";
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;

  const normA = normalizeToAbsoluteApiUrl(cleanA, baseUrl);
  const normB = normalizeToAbsoluteApiUrl(cleanB, baseUrl);
  if (normA && normB && normA === normB) return true;

  try {
    const getPath = (url: string) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return new URL(url).pathname.replace(/\/+$/, "");
      }
      return url.split("?")[0].replace(/\/+$/, "");
    };
    const pathA = getPath(cleanA);
    const pathB = getPath(cleanB);
    return Boolean(pathA && pathB && pathA === pathB);
  } catch {
    return false;
  }
}
