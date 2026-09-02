import { describe, expect, it } from "vitest";
import {
  FONT_CATEGORIES,
  FONT_CATALOG,
  getFontByFamily,
  getFontById,
  resolveFontFamily,
  searchFonts,
} from "./fontCatalog";

describe("fontCatalog", () => {
  it("contains at least 40 rich fonts with unique IDs", () => {
    expect(FONT_CATALOG.length).toBeGreaterThanOrEqual(40);
    const ids = FONT_CATALOG.map((f) => f.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(FONT_CATALOG.length);
  });

  it("every font has name, family, valid category, license, and tags", () => {
    for (const font of FONT_CATALOG) {
      expect(font.id).toBeTruthy();
      expect(font.name).toBeTruthy();
      expect(font.family).toBeTruthy();
      expect(font.category).toBeTruthy();
      expect(font.license).toBe("OFL-1.1");
      expect(font.tags.length).toBeGreaterThan(0);
    }
  });

  it("has valid categories defined", () => {
    expect(FONT_CATEGORIES.length).toBe(8);
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("bold");
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("comic");
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("retro");
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("handwriting");
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("elegant");
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("news");
    expect(FONT_CATEGORIES.map((c) => c.id)).toContain("modern");
  });

  it("search returns relevant fonts by name, id, category, and tags", () => {
    const bangers = searchFonts("Bangers");
    expect(bangers.some((f) => f.id === "bangers")).toBe(true);

    const comicFonts = searchFonts("", "comic");
    expect(comicFonts.length).toBeGreaterThanOrEqual(10);
    expect(comicFonts.every((f) => f.category === "comic")).toBe(true);

    const marker = searchFonts("Marker");
    expect(marker.some((f) => f.id === "permanent_marker")).toBe(true);

    const viral = searchFonts("Viral");
    expect(viral.length).toBeGreaterThan(0);
  });

  it("resolves legacy and font identifiers correctly", () => {
    expect(resolveFontFamily("bold_sans")).toContain("Anton");
    expect(resolveFontFamily("bangers")).toContain("Bangers");
    expect(resolveFontFamily("'Caveat', cursive")).toContain("Caveat");
    expect(resolveFontFamily("unknown_font_family")).toBe("unknown_font_family");
  });

  it("getFontById and getFontByFamily match catalog fonts", () => {
    const anton = getFontById("anton");
    expect(anton?.name).toBe("Anton");

    const lobster = getFontByFamily("'Lobster', cursive");
    expect(lobster?.name).toBe("Lobster");
  });
});
