export type HookSafeAreaPosition = "safe_top" | "top" | "upper_center";

export type HookSafeArea = {
  topPercent: number;
  topPx: number;
  fontSizePx: number;
  lineCount: number;
  clamped: boolean;
  lines: string[];
  wrappedText: string;
  safeWidthPx: number;
  textWidthEstimated: number;
  wrapApplied: boolean;
  horizontalClamped: boolean;
  truncated: boolean;
  fontSizeClampedReason: string | null;
};

export type HookPreviewRenderState = {
  shouldRenderHookOverlay: boolean;
  hookPreviewRenderSource: "none" | "live_overlay" | "baked_render";
  hookPreviewDuplicateSuppressed: boolean;
};

const HORIZONTAL_MARGIN_RATIO = 0.09;
const MAX_LINES = 2;

export function resolveHookPreviewRenderState(
  hasActiveHook: boolean,
  hasRenderedPreview: boolean,
  renderedPreviewIsCleanFallback = false,
): HookPreviewRenderState {
  if (!hasActiveHook) {
    return {
      shouldRenderHookOverlay: false,
      hookPreviewRenderSource: "none",
      hookPreviewDuplicateSuppressed: false,
    };
  }
  if (hasRenderedPreview && !renderedPreviewIsCleanFallback) {
    return {
      shouldRenderHookOverlay: false,
      hookPreviewRenderSource: "baked_render",
      hookPreviewDuplicateSuppressed: true,
    };
  }
  return {
    shouldRenderHookOverlay: true,
    hookPreviewRenderSource: "live_overlay",
    hookPreviewDuplicateSuppressed: false,
  };
}

function normalizeHookText(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function characterWidthEm(character: string) {
  if (/\s/.test(character)) return 0.32;
  if ("ilIjtfr.,:;!'`|".includes(character)) return 0.3;
  if ("mwMW@%&QO".includes(character)) return 0.82;
  if (/[A-Z0-9]/.test(character)) return 0.62;
  return 0.54;
}

export function estimateHookTextWidth(text: string, fontSizePx: number) {
  return Math.round(
    [...text].reduce((total, character) => total + characterWidthEm(character), 0) *
      fontSizePx,
  );
}

function splitLongWord(word: string, fontSizePx: number, safeWidthPx: number) {
  if (estimateHookTextWidth(word, fontSizePx) <= safeWidthPx) return [word];
  const chunks: string[] = [];
  let current = "";
  for (const character of [...word]) {
    const candidate = `${current}${character}`;
    if (current && estimateHookTextWidth(candidate, fontSizePx) > safeWidthPx) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapHookLines(text: string, fontSizePx: number, safeWidthPx: number) {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => splitLongWord(word, fontSizePx, safeWidthPx));
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const candidate = `${current} ${word}`.trim();
    if (current && estimateHookTextWidth(candidate, fontSizePx) > safeWidthPx) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function truncateTwoLines(text: string, fontSizePx: number, safeWidthPx: number) {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => splitLongWord(word, fontSizePx, safeWidthPx));
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    const candidate = `${current} ${word}`.trim();
    if (estimateHookTextWidth(`${candidate}...`, fontSizePx) <= safeWidthPx) {
      current = candidate;
      continue;
    }
    if (lines.length < MAX_LINES - 1 && current) {
      lines.push(current);
      current = word;
      continue;
    }
    break;
  }
  if (current && lines.length < MAX_LINES) {
    while (current && estimateHookTextWidth(`${current}...`, fontSizePx) > safeWidthPx) {
      current = current.slice(0, -1).trimEnd();
    }
    lines.push(current ? `${current}...` : "...");
  }
  return lines.slice(0, MAX_LINES);
}

export function resolveHookSafeArea(
  position: HookSafeAreaPosition,
  requestedFontSizePx: number,
  text: string,
  frameWidthPx: number,
  frameHeightPx: number,
): HookSafeArea {
  const normalized = normalizeHookText(text);
  const requestedFont = Math.max(1, Math.floor(requestedFontSizePx));
  const heightLimit = Math.max(26, Math.floor(frameHeightPx * 0.045));
  const initialFontSize = Math.min(requestedFont, heightLimit);
  const minimumFontSize = Math.max(18, Math.round(frameWidthPx * 0.032));
  const outerSafeWidth = frameWidthPx * (1 - 2 * HORIZONTAL_MARGIN_RATIO);
  const edgeReserve = Math.max(12, Math.round(initialFontSize * 0.45));
  const safeWidthPx = Math.max(80, Math.round(outerSafeWidth - 2 * edgeReserve));

  let fontSizePx = initialFontSize;
  let lines = wrapHookLines(normalized, fontSizePx, safeWidthPx);
  while (lines.length > MAX_LINES && fontSizePx > minimumFontSize) {
    fontSizePx -= 1;
    lines = wrapHookLines(normalized, fontSizePx, safeWidthPx);
  }
  const truncated = lines.length > MAX_LINES;
  lines = truncated ? truncateTwoLines(normalized, fontSizePx, safeWidthPx) : lines.slice(0, 2);
  if (!lines.length) lines = [""];

  const textWidthEstimated = Math.max(
    0,
    ...lines.map((line) => estimateHookTextWidth(line, fontSizePx)),
  );
  const horizontalClamped = fontSizePx < initialFontSize || truncated;
  const reasons: string[] = [];
  if (initialFontSize < requestedFont) reasons.push("frame_height");
  if (fontSizePx < initialFontSize) reasons.push("safe_width");
  if (truncated) reasons.push("extreme_text_truncated");

  const outlineShadowPx = Math.max(8, Math.round(fontSizePx * 0.16));
  const paddingPx = Math.max(12, Math.round(fontSizePx * 0.35));
  const safeTopPx = Math.max(
    24,
    Math.round(
      frameHeightPx *
        (position === "safe_top" ? 0.035 : position === "top" ? 0.07 : 0.13),
    ),
  );
  const requestedTopPx =
    position === "safe_top"
      ? safeTopPx
      : Math.round(frameHeightPx * (position === "top" ? 0.09 : 0.16));
  const lineHeightPx = Math.round(fontSizePx * 1.12);
  const maxTopPx = Math.max(
    safeTopPx,
    frameHeightPx - lines.length * lineHeightPx - outlineShadowPx - paddingPx,
  );
  const topPx = Math.min(Math.max(safeTopPx, requestedTopPx), maxTopPx);
  return {
    topPercent: (topPx / Math.max(1, frameHeightPx)) * 100,
    topPx,
    fontSizePx,
    lineCount: lines.length,
    clamped:
      topPx !== requestedTopPx || fontSizePx !== requestedFont || horizontalClamped,
    lines,
    wrappedText: lines.join("\n"),
    safeWidthPx,
    textWidthEstimated,
    wrapApplied: lines.length > 1,
    horizontalClamped,
    truncated,
    fontSizeClampedReason: reasons.join("+") || null,
  };
}
