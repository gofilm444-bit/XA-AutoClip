import { describe, expect, it } from "vitest";

import {
  TEXT_STYLE_PRESETS,
  normalizeTextStylePreset,
  resolveHookTextStylePreset,
  resolveTextOverlayStyle,
} from "./textStylePresets";

describe("textStylePresets", () => {
  it("contains unique compact text style presets", () => {
    const keys = TEXT_STYLE_PRESETS.map((preset) => preset.key);

    expect(TEXT_STYLE_PRESETS).toHaveLength(37);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TEXT_STYLE_PRESETS.every((preset) => preset.label && preset.fontFamilyKey)).toBe(true);
  });

  it("falls back to default for unknown persisted values", () => {
    expect(normalizeTextStylePreset("unknown-style")).toBe("default");
    expect(resolveTextOverlayStyle("unknown-style")).toEqual({});
  });

  it("resolves visual properties for a shared preset", () => {
    const style = resolveTextOverlayStyle("yellow_viral");

    expect(style.color).toBe("#fde047");
    expect(style.fontWeight).toBe(900);
    expect(style.WebkitTextStroke).toContain("#111827");
    expect(style.textTransform).toBe("uppercase");
  });

  it("maps Hook templates unless the editor saved an explicit text preset", () => {
    expect(resolveHookTextStylePreset("neon_text", undefined)).toBe("neon_green");
    expect(resolveHookTextStylePreset("breaking_news", undefined)).toBe("red_alert");
    expect(resolveHookTextStylePreset("neon_text", "gaming_neon")).toBe(
      "gaming_neon",
    );
  });
});
