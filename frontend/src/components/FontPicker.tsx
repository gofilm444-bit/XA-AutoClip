import React, { useEffect, useMemo, useState } from "react";
import {
  FONT_CATEGORIES,
  FONT_CATALOG,
  FontCategory,
  FontDefinition,
  getFontByFamily,
  getFontById,
  resolveFontFamily,
  searchFonts,
} from "../utils/fontCatalog";
import { ensureFontLoaded, injectGoogleFonts } from "../utils/fontLoader";

export interface FontPickerProps {
  value: string;
  onChange: (fontFamily: string, fontId: string) => void;
  onHoverPreview?: (fontFamily: string | null) => void;
  sampleText?: string;
  className?: string;
  compact?: boolean;
}

const ISOLATED_FONT_PREVIEW_STYLE: React.CSSProperties = {
  textShadow: "none",
  WebkitTextStroke: "0px transparent",
  filter: "none",
  background: "none",
  transform: "none",
  letterSpacing: "normal",
  wordSpacing: "normal",
  lineHeight: "1.2",
  fontStyle: "normal",
  WebkitFontSmoothing: "antialiased",
  MozOsxFontSmoothing: "grayscale",
};

export const FontPicker: React.FC<FontPickerProps> = ({
  value,
  onChange,
  onHoverPreview,
  className = "",
  compact = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FontCategory>("all");
  const [loadedFonts, setLoadedFonts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    injectGoogleFonts();
  }, []);

  const activeFont = useMemo(() => {
    return getFontById(value) || getFontByFamily(value) || FONT_CATALOG[0];
  }, [value]);

  const filteredFonts = useMemo(() => {
    return searchFonts(searchQuery, activeCategory);
  }, [searchQuery, activeCategory]);

  const handleItemHover = (font: FontDefinition) => {
    if (onHoverPreview) {
      onHoverPreview(font.family);
    }
    if (!loadedFonts[font.id]) {
      ensureFontLoaded(font.family, font.name).then((success) => {
        setLoadedFonts((prev) => ({ ...prev, [font.id]: success }));
      });
    }
  };

  const handleItemLeave = () => {
    if (onHoverPreview) {
      onHoverPreview(null);
    }
  };

  const handleSelect = (font: FontDefinition) => {
    onChange(font.family, font.id);
    if (onHoverPreview) {
      onHoverPreview(null);
    }
  };

  return (
    <div
      className={`space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5 shadow-inner ${className}`}
      onMouseLeave={handleItemLeave}
    >
      {/* 1. Header & Active font banner (Clean & Compact) */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[11px] font-semibold text-zinc-400 shrink-0">Font Aktif:</span>
          <span
            className="truncate text-xs font-bold text-cyan-300"
            style={{
              ...ISOLATED_FONT_PREVIEW_STYLE,
              fontFamily: activeFont ? activeFont.family : "inherit",
            }}
          >
            {activeFont ? activeFont.name : "Default"}
          </span>
        </div>
        {activeFont?.badge && (
          <span className="shrink-0 rounded bg-cyan-950/80 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-800/50">
            {activeFont.badge}
          </span>
        )}
      </div>

      {/* 2. Search Input */}
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
          🔍
        </span>
        <input
          type="text"
          placeholder="Cari font (Anton, Bangers, Marker...)"
          className="h-7.5 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-8 pr-7 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => setSearchQuery("")}
          >
            ✕
          </button>
        )}
      </div>

      {/* 3. Category Pills */}
      <div className="flex flex-wrap gap-1 pb-0.5">
        {FONT_CATEGORIES.map((cat) => {
          const isSelected = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                isSelected
                  ? "bg-cyan-500 text-zinc-950 font-bold shadow-sm"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span className="text-[10px]">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* 4. Font List (Scrollable CapCut-style visual cards: ~44px height, clean typography) */}
      <div
        className={`custom-scrollbar grid gap-1 overflow-y-auto pr-0.5 ${
          compact ? "max-h-56" : "max-h-80"
        }`}
      >
        {filteredFonts.length === 0 ? (
          <div className="py-6 text-center text-xs text-zinc-500">
            Tidak ada font yang cocok dengan "{searchQuery}"
          </div>
        ) : (
          filteredFonts.map((font) => {
            const isSelected =
              activeFont?.id === font.id ||
              value === font.family ||
              value === font.id ||
              resolveFontFamily(value) === font.family;

            return (
              <button
                key={font.id}
                type="button"
                className={`group relative flex h-11 w-full items-center justify-between rounded-lg border px-3 text-left transition-all ${
                  isSelected
                    ? "border-cyan-500/80 bg-cyan-950/40 ring-1 ring-cyan-500/50 shadow-sm"
                    : "border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/80"
                }`}
                onMouseEnter={() => handleItemHover(font)}
                onClick={() => handleSelect(font)}
              >
                {/* Left: Font Name rendered in its own font family */}
                <div className="flex items-center min-w-0 flex-1 pr-2">
                  <span
                    className={`truncate text-sm font-semibold ${
                      isSelected ? "text-cyan-300 font-bold" : "text-zinc-200 group-hover:text-white"
                    }`}
                    style={{
                      ...ISOLATED_FONT_PREVIEW_STYLE,
                      fontFamily: font.family,
                    }}
                  >
                    {font.name}
                  </span>
                </div>

                {/* Right: Category badge + Checkmark */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {font.badge && (
                    <span className="rounded bg-zinc-800/90 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-300">
                      {font.badge}
                    </span>
                  )}
                  {isSelected && (
                    <span className="text-xs font-bold text-cyan-400">✓</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
