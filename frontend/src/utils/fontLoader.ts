import { FONT_CATALOG } from "./fontCatalog";

const GOOGLE_FONTS_LINK_ID = "xa-autoclip-google-fonts-link";
let fontsInjected = false;

export function buildGoogleFontsUrl(): string {
  const families = FONT_CATALOG.map((font) => font.googleFontFamily || font.name.replace(/\s+/g, "+"));
  const uniqueFamilies = Array.from(new Set(families));
  const familyParams = uniqueFamilies.map((fam) => `family=${fam}`).join("&");
  return `https://fonts.googleapis.com/css2?${familyParams}&display=swap`;
}

export function injectGoogleFonts(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(GOOGLE_FONTS_LINK_ID)) return;

  // 1. Preconnect to fonts.googleapis.com
  if (!document.querySelector('link[rel="preconnect"][href="https://fonts.googleapis.com"]')) {
    const preconnect1 = document.createElement("link");
    preconnect1.rel = "preconnect";
    preconnect1.href = "https://fonts.googleapis.com";
    document.head.appendChild(preconnect1);
  }

  // 2. Preconnect to fonts.gstatic.com
  if (!document.querySelector('link[rel="preconnect"][href="https://fonts.gstatic.com"]')) {
    const preconnect2 = document.createElement("link");
    preconnect2.rel = "preconnect";
    preconnect2.href = "https://fonts.gstatic.com";
    preconnect2.crossOrigin = "anonymous";
    document.head.appendChild(preconnect2);
  }

  // 3. Batch Google Fonts stylesheet
  const link = document.createElement("link");
  link.id = GOOGLE_FONTS_LINK_ID;
  link.rel = "stylesheet";
  link.href = buildGoogleFontsUrl();
  document.head.appendChild(link);
  fontsInjected = true;
}

export async function ensureFontLoaded(fontFamily: string, sampleText = "Contoh Teks"): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts) return true;
  if (!fontsInjected) {
    injectGoogleFonts();
  }

  const cleanFamily = fontFamily.replace(/['"]/g, "").split(",")[0].trim();
  const fontSpec = `16px "${cleanFamily}"`;

  try {
    if (document.fonts.check(fontSpec, sampleText)) {
      return true;
    }
    await document.fonts.load(fontSpec, sampleText);
    return document.fonts.check(fontSpec, sampleText);
  } catch {
    return false;
  }
}
