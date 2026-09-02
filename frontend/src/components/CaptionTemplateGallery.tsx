import React, { useState, useMemo } from "react";
import {
  CaptionTemplate,
  CaptionTemplateCategory,
  CaptionTemplateGroup,
  searchCaptionTemplates,
} from "../utils/captionTemplates";
import { resolveFontFamily } from "../utils/fontCatalog";

export interface CaptionTemplateGalleryProps {
  currentPresetId?: string;
  activeTemplateId?: string;
  previewTemplateId?: string;
  activeGroup: CaptionTemplateGroup;
  onSelectTemplate: (template: CaptionTemplate) => void;
  onTemplateHover?: (template: CaptionTemplate) => void;
  onTemplateLeave?: () => void;
  className?: string;
}

const CATEGORY_PILLS: CaptionTemplateCategory[] = [
  "All",
  "Trending",
  "Viral",
  "Word",
  "Bubble",
  "Meme",
  "Classic",
  "Effects",
  "Basic",
];

export const CaptionTemplateGallery: React.FC<CaptionTemplateGalleryProps> = ({
  currentPresetId,
  activeTemplateId,
  previewTemplateId,
  activeGroup,
  onSelectTemplate,
  onTemplateHover,
  onTemplateLeave,
  className = "",
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CaptionTemplateCategory>("All");

  const effectiveActiveId = activeTemplateId || currentPresetId;

  const filteredTemplates = useMemo(() => {
    return searchCaptionTemplates(searchQuery, selectedCategory, activeGroup);
  }, [searchQuery, selectedCategory, activeGroup]);

  return (
    <div className={`space-y-2.5 ${className}`}>
      {/* 1. Search Bar */}
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400">
          🔍
        </span>
        <input
          type="text"
          placeholder="Search for text templates..."
          className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900 pl-8 pr-7 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
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

      {/* 2. Category Pills */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
        {CATEGORY_PILLS.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold transition-all ${
                isSelected
                  ? "bg-cyan-400 text-zinc-950 font-black shadow-sm"
                  : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* 3. Visual Thumbnail Grid (2 compact columns) */}
      <div
        className="custom-scrollbar grid grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-0.5"
        onMouseLeave={() => onTemplateLeave?.()}
      >
        {filteredTemplates.length === 0 ? (
          <div className="col-span-2 py-8 text-center text-xs text-zinc-500">
            Tidak ada template caption yang cocok dengan "{searchQuery}"
          </div>
        ) : (
          filteredTemplates.map((tpl) => {
            const isSelected = effectiveActiveId === tpl.id;
            const isHoverPreviewing = previewTemplateId === tpl.id;
            const patch = tpl.stylePatch;
            const behavior = tpl.behavior;

            // Accurate visual styling derived directly from template styles
            const fontFamily = resolveFontFamily(patch.font_family || "Inter, sans-serif");
            const textColor = patch.color || "#FFFFFF";
            const fontWeight = patch.font_weight || "800";
            const fontStyle = patch.italic ? "italic" : "normal";
            const textTransform = patch.case_mode === "uppercase" ? "uppercase" : "none";
            const stroke = patch.stroke_enabled
              ? `${patch.stroke_width || 2}px ${patch.stroke_color || "#000000"}`
              : undefined;
            const textShadow = patch.shadow_enabled
              ? `${patch.shadow_x || 0}px ${patch.shadow_y || 2}px ${patch.shadow_blur || 4}px ${
                  patch.shadow_color || "rgba(0,0,0,0.85)"
                }`
              : undefined;

            const bgBoxColor = patch.background_enabled
              ? patch.background_color || "#000000"
              : "transparent";
            const bgOpacity = patch.background_enabled ? patch.background_opacity ?? 0.85 : 0;
            const bgRadius = patch.background_enabled ? patch.background_radius || 6 : 0;

            const isLowerThird = tpl.template_type === "lower_third";
            const isBubble = tpl.template_type === "bubble";
            const isWordHighlight = tpl.template_type === "word_highlight";
            const isTypewriter = tpl.template_type === "typewriter";
            const isQuote = tpl.template_type === "quote";
            const isGlitch = tpl.template_type === "glitch";
            const isMeme = tpl.template_type === "meme";
            const isSticker = tpl.template_type === "sticker_text";

            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => onSelectTemplate(tpl)}
                onMouseEnter={() => onTemplateHover?.(tpl)}
                onMouseLeave={() => onTemplateLeave?.()}
                onFocus={() => onTemplateHover?.(tpl)}
                onBlur={() => onTemplateLeave?.()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectTemplate(tpl);
                  }
                }}
                className={`group relative flex flex-col justify-between rounded-xl border p-2 text-left transition-all ${
                  isSelected
                    ? "border-cyan-400 bg-cyan-950/40 ring-2 ring-cyan-400 shadow-md scale-[1.01]"
                    : isHoverPreviewing
                    ? "border-cyan-400/80 bg-cyan-950/25 ring-1 ring-cyan-400/80 shadow-md"
                    : "border-zinc-800 bg-[#18181b] hover:border-zinc-600 hover:bg-[#22252a]"
                }`}
              >
                {/* Visual Thumbnail Center Area */}
                <div
                  className={`relative flex h-16 w-full items-center justify-center overflow-hidden rounded-lg bg-zinc-950/90 p-1 border border-zinc-800/80 ${
                    isLowerThird ? "items-end pb-0" : ""
                  }`}
                >
                  {/* Lower Third Background Bar Preview */}
                  {isLowerThird ? (
                    <div
                      className="w-full flex flex-col items-start rounded-t-md overflow-hidden border-t border-cyan-400/60"
                      style={{
                        backgroundColor: bgBoxColor.startsWith("#")
                          ? `${bgBoxColor}${Math.round(bgOpacity * 255).toString(16).padStart(2, "0")}`
                          : bgBoxColor,
                      }}
                    >
                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-black/40 w-full">
                        <span className="size-1 rounded-full bg-red-400" />
                        <span className="text-[7px] font-black uppercase text-cyan-300">
                          {tpl.badge || "NEWS"}
                        </span>
                      </div>
                      <div className="px-2 py-0.5 w-full text-center truncate">
                        <span
                          style={{
                            fontFamily,
                            color: textColor,
                            fontWeight,
                            fontSize: 10,
                            textTransform,
                          }}
                        >
                          {tpl.previewText}
                        </span>
                      </div>
                    </div>
                  ) : isBubble ? (
                    <span
                      style={{
                        backgroundColor: bgBoxColor.startsWith("#")
                          ? `${bgBoxColor}${Math.round(bgOpacity * 255).toString(16).padStart(2, "0")}`
                          : bgBoxColor,
                        borderRadius: `${bgRadius}px`,
                        padding: "3px 10px",
                        boxShadow: "0 4px 10px rgba(0,0,0,0.5)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily,
                          color: textColor,
                          fontWeight,
                          fontSize: 12,
                          textTransform,
                        }}
                      >
                        {tpl.previewText}
                      </span>
                    </span>
                  ) : isSticker ? (
                    <div className="rounded-lg border-2 border-white bg-amber-300 px-2 py-0.5 shadow-md transform -rotate-2">
                      <span
                        style={{
                          fontFamily,
                          color: textColor,
                          fontWeight: "900",
                          fontSize: 11,
                          textTransform: "uppercase",
                        }}
                      >
                        {tpl.previewText}
                      </span>
                    </div>
                  ) : isQuote ? (
                    <div className="flex items-center gap-1 rounded bg-zinc-900/90 px-2 py-1 border-l-2 border-amber-400">
                      <span className="text-amber-400 font-serif text-xs">“</span>
                      <span
                        style={{
                          fontFamily,
                          color: textColor,
                          fontStyle: "italic",
                          fontSize: 11,
                        }}
                      >
                        {tpl.previewText}
                      </span>
                      <span className="text-amber-400 font-serif text-xs">”</span>
                    </div>
                  ) : isWordHighlight ? (
                    <span style={{ fontSize: 12 }}>
                      {(() => {
                        const words = tpl.previewText.split(" ");
                        if (words.length > 1) {
                          return (
                            <>
                              <span
                                className="rounded px-1 py-0.2"
                                style={{
                                  backgroundColor: behavior.highlight_color || "#FDE047",
                                  color: "#000000",
                                  fontWeight: "900",
                                }}
                              >
                                {words[0]}
                              </span>{" "}
                              <span style={{ color: textColor, fontWeight }}>{words.slice(1).join(" ")}</span>
                            </>
                          );
                        }
                        return (
                          <span
                            className="rounded px-1 py-0.2"
                            style={{
                              backgroundColor: behavior.highlight_color || "#FDE047",
                              color: "#000000",
                              fontWeight: "900",
                            }}
                          >
                            {tpl.previewText}
                          </span>
                        );
                      })()}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontFamily,
                        color: textColor,
                        fontWeight,
                        fontStyle,
                        textTransform,
                        WebkitTextStroke: stroke,
                        paintOrder: "stroke fill",
                        textShadow: isGlitch
                          ? "-2px 0 #06B6D4, 2px 0 #EC4899"
                          : isMeme
                          ? "2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000"
                          : textShadow,
                        fontSize: 13,
                        lineHeight: 1.1,
                        textAlign: "center",
                        letterSpacing: patch.letter_spacing ? `${patch.letter_spacing}px` : "normal",
                        zIndex: 2,
                      }}
                      className="truncate max-w-full select-none"
                    >
                      {tpl.previewText}
                      {isTypewriter && <span className="caption-typewriter-cursor">|</span>}
                    </span>
                  )}

                  {/* Hover Live Preview indicator badge */}
                  {isHoverPreviewing && (
                    <span className="absolute left-1 top-1 rounded bg-cyan-500/90 px-1 py-0.2 text-[8px] font-black uppercase text-zinc-950 shadow-sm animate-pulse">
                      Live
                    </span>
                  )}

                  {/* Partial export support warning badge if animation only */}
                  {tpl.export_support !== "full" && (
                    <span
                      className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-zinc-950/80 px-1 py-0.5 text-[8px] font-bold text-amber-400 border border-amber-500/30 opacity-80 group-hover:opacity-100"
                      title={tpl.export_support_note || "Animasi live di preview; ekspor video berupa style caption"}
                    >
                      <span>⚡</span>
                      <span>Partial</span>
                    </span>
                  )}
                </div>

                {/* Template Name & Category Footer */}
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span
                    className={`truncate text-[11px] font-bold ${
                      isSelected
                        ? "text-cyan-300 font-extrabold"
                        : isHoverPreviewing
                        ? "text-cyan-200"
                        : "text-zinc-300 group-hover:text-white"
                    }`}
                  >
                    {tpl.name}
                  </span>
                  {tpl.badge && (
                    <span
                      className={`shrink-0 rounded px-1 py-0.2 text-[8px] font-black uppercase ${
                        tpl.badge === "Trending" || tpl.badge === "Viral"
                          ? "bg-rose-500/20 text-rose-300"
                          : tpl.badge === "Bubble"
                          ? "bg-amber-400/20 text-amber-300"
                          : tpl.badge === "Glow"
                          ? "bg-fuchsia-400/20 text-fuchsia-300"
                          : tpl.badge === "Hits"
                          ? "bg-indigo-400/20 text-indigo-300"
                          : "bg-cyan-400/20 text-cyan-300"
                      }`}
                    >
                      {tpl.badge}
                    </span>
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
