import { describe, expect, it } from "vitest";
import {
  CAPTION_TEMPLATES,
  DEFAULT_MAIN_CAPTION_STYLE,
  applyCaptionTemplateToCaptionItem,
  applyCaptionTemplateToMainStyle,
  computeKaraokeWordProgress,
  extractHighlightedWordIndices,
  formatCaptionCase,
  normalizeMainCaptionStyle,
  resolveCaptionStyle,
  searchCaptionTemplates,
  type CaptionCueItem,
} from "./captionTemplates";

describe("Caption Template Engine V8 - Karaoke Export Sync & Support Honesty", () => {
  it("includes at least 25 distinct templates with unique IDs", () => {
    expect(CAPTION_TEMPLATES.length).toBeGreaterThanOrEqual(25);
    const ids = CAPTION_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(CAPTION_TEMPLATES.length);
  });

  it("every template has template_type, layout, behavior, animation, export_support, and valid stylePatch", () => {
    for (const tpl of CAPTION_TEMPLATES) {
      expect(tpl.id).toBeTruthy();
      expect(tpl.name).toBeTruthy();
      expect(tpl.template_type).toBeTruthy();
      expect(tpl.category).toBeTruthy();
      expect(tpl.group).toBeTruthy();
      expect(tpl.layout).toBeDefined();
      expect(tpl.behavior).toBeDefined();
      expect(tpl.animation).toBeDefined();
      expect(tpl.export_support).toBeDefined();
      expect(["full", "partial", "preview_only"]).toContain(tpl.export_support);
      expect(tpl.tags.length).toBeGreaterThan(0);
      expect(tpl.previewText.length).toBeGreaterThan(0);
      expect(Object.keys(tpl.stylePatch).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("Trending category contains key high-impact animated templates with honest export support", () => {
    const trending = searchCaptionTemplates("", "Trending");
    const trendingIds = new Set(trending.map((t) => t.id));

    expect(trendingIds.has("viral_yellow_punch")).toBe(true);
    expect(trendingIds.has("karaoke_yellow")).toBe(true);
    expect(trendingIds.has("karaoke_cyan")).toBe(true);
    expect(trendingIds.has("word_pop")).toBe(true);
    expect(trendingIds.has("white_rounded_bubble")).toBe(true);
    expect(trendingIds.has("sticker_text")).toBe(true);
    expect(trendingIds.has("glitch_word")).toBe(true);
    expect(trendingIds.has("shake_word")).toBe(true);
    expect(trendingIds.has("flash_emphasis")).toBe(true);
    expect(trendingIds.has("typewriter")).toBe(true);
    expect(trendingIds.has("debate_marker")).toBe(true);
    expect(trendingIds.has("meme_white_stroke")).toBe(true);
    expect(trendingIds.has("creator_bold")).toBe(true);
    expect(trendingIds.has("question_pop")).toBe(true);
    expect(trendingIds.has("neon_cyan")).toBe(true);

    // Verify honest export support categorization
    const glitch = CAPTION_TEMPLATES.find((t) => t.id === "glitch_word")!;
    expect(glitch.export_support).toBe("partial");
    expect(glitch.export_support_note).toBeDefined();

    const shake = CAPTION_TEMPLATES.find((t) => t.id === "shake_word")!;
    expect(shake.export_support).toBe("partial");

    const bubble = CAPTION_TEMPLATES.find((t) => t.id === "white_rounded_bubble")!;
    expect(bubble.export_support).toBe("partial");

    const karaoke = CAPTION_TEMPLATES.find((t) => t.id === "karaoke_yellow")!;
    expect(karaoke.export_support).toBe("full");
  });

  it("computeKaraokeWordProgress calculates proportional word timings correctly", () => {
    const words = ["Standar", "hidup", "kita", "rusak", "karena", "kompetisi"];
    const cueStart = 1.0;
    const cueEnd = 4.0;

    // At cueStart, active word is 0
    const startResult = computeKaraokeWordProgress(words, cueStart, cueEnd, 1.0);
    expect(startResult.activeWordIndex).toBe(0);
    expect(startResult.progress).toBeCloseTo(0);

    // Mid point around 2.5s
    const midResult = computeKaraokeWordProgress(words, cueStart, cueEnd, 2.5);
    expect(midResult.activeWordIndex).toBeGreaterThanOrEqual(2);
    expect(midResult.activeWordIndex).toBeLessThanOrEqual(4);

    // At cueEnd, active word is the last word
    const endResult = computeKaraokeWordProgress(words, cueStart, cueEnd, 4.0);
    expect(endResult.activeWordIndex).toBe(5);
    expect(endResult.progress).toBeCloseTo(1.0);
  });

  it("karaoke template owns progressive word behavior and sweep animation", () => {
    const karaokeYellow = CAPTION_TEMPLATES.find((t) => t.id === "karaoke_yellow");
    expect(karaokeYellow).toBeDefined();
    expect(karaokeYellow?.behavior.mode).toBe("word_progress");
    expect(karaokeYellow?.behavior.highlight_strategy).toBe("time_progress");
    expect(karaokeYellow?.behavior.highlight_color).toBe("#FFD600");
    expect(karaokeYellow?.animation.loop).toBe("highlight_sweep");
    expect(karaokeYellow?.export_support).toBe("full");
  });

  it("applyCaptionTemplateToMainStyle applies full template metadata", () => {
    const karaokeCyan = CAPTION_TEMPLATES.find((t) => t.id === "karaoke_cyan")!;
    const applied = applyCaptionTemplateToMainStyle(DEFAULT_MAIN_CAPTION_STYLE, karaokeCyan);

    expect(applied.preset_id).toBe("karaoke_cyan");
    expect(applied.behavior?.mode).toBe("word_progress");
    expect(applied.behavior?.highlight_color).toBe("#22D3EE");
    expect(applied.animation?.loop).toBe("highlight_sweep");
    expect(applied.font_size).toBe(28);
  });

  it("applyCaptionTemplateToCaptionItem updates cue item override", () => {
    const glitch = CAPTION_TEMPLATES.find((t) => t.id === "glitch_word")!;
    const cue: CaptionCueItem = {
      id: "cue-1",
      start: 1.0,
      end: 3.5,
      text: "Cyber Future",
    };

    const updatedCue = applyCaptionTemplateToCaptionItem(cue, glitch);
    expect(updatedCue.style_id).toBe("glitch_word");
    expect(updatedCue.style_override?.template_type).toBe("glitch");
    expect(updatedCue.style_override?.animation?.loop).toBe("glitch");
    expect(updatedCue.style_override?.color).toBe("#4ADE80");
  });

  it("extractHighlightedWordIndices correctly identifies words to highlight", () => {
    const text = "Halo semua apa kabar hari ini?";
    const firstWordSet = extractHighlightedWordIndices(text, "first_word");
    expect(firstWordSet.has(0)).toBe(true);
    expect(firstWordSet.size).toBe(1);

    const lastWordSet = extractHighlightedWordIndices(text, "last_word");
    expect(lastWordSet.has(5)).toBe(true);

    const keywordSet = extractHighlightedWordIndices("INI SANGAT PENTING SEKALI!", "keywords");
    expect(keywordSet.size).toBeGreaterThan(0);
  });

  it("searchCaptionTemplates filters by query, category, and group", () => {
    const punch = searchCaptionTemplates("Yellow Punch");
    expect(punch.some((t) => t.id === "viral_yellow_punch")).toBe(true);

    const bubbleGroup = searchCaptionTemplates("", "All", "bubble");
    expect(bubbleGroup.length).toBeGreaterThanOrEqual(4);
    expect(bubbleGroup.every((t) => t.group === "bubble")).toBe(true);

    const lowerThird = searchCaptionTemplates("lower_third");
    expect(lowerThird.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes incomplete caption style while preserving template_type, layout, and behavior", () => {
    const emptyStyle = normalizeMainCaptionStyle(undefined);
    expect(emptyStyle.template_type).toBe(DEFAULT_MAIN_CAPTION_STYLE.template_type);
    expect(emptyStyle.layout?.position).toBe("bottom_center");
    expect(emptyStyle.behavior?.mode).toBe("static");

    const customStyle = normalizeMainCaptionStyle({
      template_type: "word_highlight",
      behavior: {
        mode: "keyword_highlight",
        highlight_color: "#FF0000",
      },
      font_size: 32,
      color: "#FFCC00",
    });
    expect(customStyle.template_type).toBe("word_highlight");
    expect(customStyle.behavior?.mode).toBe("keyword_highlight");
    expect(customStyle.behavior?.highlight_color).toBe("#FF0000");
    expect(customStyle.font_size).toBe(32);
  });

  it("resolves caption style according to applyToAll flag and cue overrides", () => {
    const mainStyle = normalizeMainCaptionStyle({
      color: "#FFFFFF",
      font_size: 24,
      template_type: "bubble",
    });

    const cueWithOverride: CaptionCueItem = {
      id: "cue-1",
      start: 0,
      end: 2,
      text: "Hello world",
      style_override: {
        color: "#FF0000",
        template_type: "viral_caption",
      },
    };

    const resolvedAll = resolveCaptionStyle(cueWithOverride, mainStyle, true);
    expect(resolvedAll.color).toBe("#FFFFFF");
    expect(resolvedAll.template_type).toBe("bubble");

    const resolvedIndividual = resolveCaptionStyle(cueWithOverride, mainStyle, false);
    expect(resolvedIndividual.color).toBe("#FF0000");
    expect(resolvedIndividual.template_type).toBe("viral_caption");
  });

  it("formats text case correctly based on case_mode", () => {
    const sample = "Halo dunia yang indah";
    expect(formatCaptionCase(sample, "uppercase")).toBe("HALO DUNIA YANG INDAH");
    expect(formatCaptionCase(sample, "lowercase")).toBe("halo dunia yang indah");
    expect(formatCaptionCase(sample, "title")).toBe("Halo Dunia Yang Indah");
    expect(formatCaptionCase(sample, "none")).toBe("Halo dunia yang indah");
  });
});
