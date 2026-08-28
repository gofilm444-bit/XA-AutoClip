import { describe, expect, it } from "vitest";
import {
  estimateHookTextWidth,
  resolveHookPreviewRenderState,
  resolveHookSafeArea,
} from "./hookSafeArea";

describe("resolveHookSafeArea", () => {
  it("keeps a long top hook inside the frame", () => {
    const result = resolveHookSafeArea("safe_top", 80, "A".repeat(120), 540, 960);

    expect(result.topPx).toBeGreaterThanOrEqual(16);
    expect(result.fontSizePx).toBeLessThanOrEqual(43.2);
    expect(result.lineCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it.each([
    [540, 960, 35],
    [720, 1280, 46],
    [1080, 1920, 69],
  ])("wraps a long hook within %ix%i safe width", (width, height, fontSize) => {
    const result = resolveHookSafeArea(
      "safe_top",
      fontSize,
      "Awalnya cuma niat baik, tapi kisahnya berubah jadi kacau",
      width,
      height,
    );

    expect(result.lineCount).toBeLessThanOrEqual(2);
    expect(result.lines.every((line) => estimateHookTextWidth(line, result.fontSizePx) <= result.safeWidthPx)).toBe(true);
  });

  it("normalizes whitespace without merging adjacent words", () => {
    const result = resolveHookSafeArea(
      "safe_top",
      30,
      "Awalnya   cuma\nniat baik, tapi   kisahnya berubah",
      540,
      960,
    );

    expect(result.wrappedText.replace("\n", " ")).toContain("tapi kisahnya");
    expect(result.wrappedText).not.toContain("tapinkisa");
  });

  it("clamps and truncates extreme hooks with an ellipsis", () => {
    const result = resolveHookSafeArea(
      "safe_top",
      48,
      Array.from({ length: 80 }, () => "keputusan").join(" "),
      540,
      960,
    );

    expect(result.fontSizePx).toBeLessThan(48);
    expect(result.lineCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.lines.at(-1)).toMatch(/\.\.\.$/);
  });

  it("keeps a short legacy hook unchanged", () => {
    const result = resolveHookSafeArea("safe_top", 30, "Hook aman", 540, 960);

    expect(result.lines).toEqual(["Hook aman"]);
    expect(result.fontSizePx).toBe(30);
    expect(result.wrapApplied).toBe(false);
  });

  it("suppresses the live Hook overlay when the rendered preview already contains it", () => {
    expect(resolveHookPreviewRenderState(true, true)).toEqual({
      shouldRenderHookOverlay: false,
      hookPreviewRenderSource: "baked_render",
      hookPreviewDuplicateSuppressed: true,
    });
  });

  it("keeps one live overlay on a clean fallback preview", () => {
    expect(resolveHookPreviewRenderState(true, true, true)).toEqual({
      shouldRenderHookOverlay: true,
      hookPreviewRenderSource: "live_overlay",
      hookPreviewDuplicateSuppressed: false,
    });
  });
});
