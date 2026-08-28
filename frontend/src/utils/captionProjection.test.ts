import { describe, expect, it } from "vitest";

import { projectCaptionCues } from "./captionProjection";

describe("projectCaptionCues", () => {
  it("moves a source cue to the beginning of the output timeline", () => {
    const result = projectCaptionCues(
      [{ start: 10, end: 15, text: "Bagian hook" }],
      [{ id: "hook", sourceStart: 10, sourceEnd: 15 }],
    );

    expect(result[0]).toMatchObject({ start: 0, end: 5, text: "Bagian hook" });
  });

  it("clamps a partially trimmed source cue", () => {
    const result = projectCaptionCues(
      [{ start: 10, end: 15, text: "Caption utuh" }],
      [{ id: "trimmed", sourceStart: 12, sourceEnd: 15 }],
    );

    expect(result[0]).toMatchObject({ start: 0, end: 3, text: "Caption utuh" });
  });

  it("follows reordered video segments", () => {
    const result = projectCaptionCues(
      [
        { start: 0, end: 5, text: "A" },
        { start: 10, end: 15, text: "B" },
      ],
      [
        { id: "segment-b", sourceStart: 10, sourceEnd: 15 },
        { id: "segment-a", sourceStart: 0, sourceEnd: 5 },
      ],
    );

    expect(result.map((cue) => [cue.text, cue.start, cue.end])).toEqual([
      ["B", 0, 5],
      ["A", 5, 10],
    ]);
  });

  it("creates separate caption instances for duplicated source ranges", () => {
    const result = projectCaptionCues(
      [{ start: 2, end: 4, text: "Ulang" }],
      [
        { id: "first", sourceStart: 0, sourceEnd: 5 },
        { id: "duplicate", sourceStart: 0, sourceEnd: 5 },
      ],
    );

    expect(result.map((cue) => [cue.start, cue.end])).toEqual([
      [2, 4],
      [7, 9],
    ]);
    expect(new Set(result.map((cue) => cue.id)).size).toBe(2);
  });

  it("returns an empty timeline when no source cue overlaps", () => {
    expect(
      projectCaptionCues(
        [{ start: 10, end: 12, text: "Di luar" }],
        [{ id: "start", sourceStart: 0, sourceEnd: 5 }],
      ),
    ).toEqual([]);
  });
});
