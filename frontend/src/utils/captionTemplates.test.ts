import { describe, expect, it } from "vitest";
import {
  CAPTION_TEMPLATES,
  DEFAULT_MAIN_CAPTION_STYLE,
  formatCaptionCase,
  normalizeMainCaptionStyle,
  resolveCaptionStyle,
  type CaptionCueItem,
} from "./captionTemplates";

describe("captionTemplates utility", () => {
  it("includes at least 20 templates and contains caption_karaoke_classic", () => {
    expect(CAPTION_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    const classicKaraoke = CAPTION_TEMPLATES.find(
      (tpl) => tpl.id === "caption_karaoke_classic",
    );
    expect(classicKaraoke).toBeDefined();
    expect(classicKaraoke?.stylePatch.karaoke_enabled).toBe(true);
  });

  it("normalizes incomplete caption style to default values", () => {
    const emptyStyle = normalizeMainCaptionStyle(undefined);
    expect(emptyStyle.font_family).toBe(DEFAULT_MAIN_CAPTION_STYLE.font_family);
    expect(emptyStyle.font_size).toBe(DEFAULT_MAIN_CAPTION_STYLE.font_size);
    expect(emptyStyle.color).toBe(DEFAULT_MAIN_CAPTION_STYLE.color);

    const customStyle = normalizeMainCaptionStyle({
      font_size: 32,
      color: "#FFCC00",
      stroke_enabled: true,
    });
    expect(customStyle.font_size).toBe(32);
    expect(customStyle.color).toBe("#FFCC00");
    expect(customStyle.stroke_enabled).toBe(true);
    expect(customStyle.font_weight).toBe(DEFAULT_MAIN_CAPTION_STYLE.font_weight);
  });

  it("resolves caption style according to applyToAll flag and cue overrides", () => {
    const mainStyle = normalizeMainCaptionStyle({
      color: "#FFFFFF",
      font_size: 24,
    });

    const cueWithOverride: CaptionCueItem = {
      id: "cue-1",
      start: 0,
      end: 2,
      text: "Hello world",
      style_override: {
        color: "#FF0000",
        font_size: 30,
      },
    };

    // When applyToAll is true, global mainStyle takes precedence
    const resolvedAll = resolveCaptionStyle(cueWithOverride, mainStyle, true);
    expect(resolvedAll.color).toBe("#FFFFFF");
    expect(resolvedAll.font_size).toBe(24);

    // When applyToAll is false, cue overrides are applied
    const resolvedIndividual = resolveCaptionStyle(
      cueWithOverride,
      mainStyle,
      false,
    );
    expect(resolvedIndividual.color).toBe("#FF0000");
    expect(resolvedIndividual.font_size).toBe(30);
  });

  it("formats text case correctly based on case_mode", () => {
    const sample = "Halo dunia yang indah";
    expect(formatCaptionCase(sample, "uppercase")).toBe("HALO DUNIA YANG INDAH");
    expect(formatCaptionCase(sample, "lowercase")).toBe("halo dunia yang indah");
    expect(formatCaptionCase(sample, "title")).toBe("Halo Dunia Yang Indah");
    expect(formatCaptionCase(sample, "none")).toBe("Halo dunia yang indah");
  });
});
