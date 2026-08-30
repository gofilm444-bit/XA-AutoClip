import { describe, expect, it } from "vitest";
import { packTimelineItemsIntoLanes } from "./timelinePacking";

describe("packTimelineItemsIntoLanes", () => {
  it("mengembalikan array kosong jika input kosong", () => {
    expect(packTimelineItemsIntoLanes([])).toEqual([]);
  });

  it("menempatkan item non-overlap ke dalam satu lane", () => {
    const items = [
      { id: "1", start: 0, end: 5 },
      { id: "2", start: 6, end: 10 },
      { id: "3", start: 11, end: 15 },
    ];
    const lanes = packTimelineItemsIntoLanes(items);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toHaveLength(3);
    expect(lanes[0].map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("menempatkan item dengan endpoint bersentuhan ke dalam satu lane", () => {
    const items = [
      { id: "cue-1", start: 0, end: 2.5 },
      { id: "cue-2", start: 2.5, end: 5.0 },
      { id: "cue-3", start: 5.0, end: 7.5 },
    ];
    const lanes = packTimelineItemsIntoLanes(items);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toHaveLength(3);
  });

  it("membuat lane baru jika dua item overlap (misal Text A 0-5s dan Text B 3-8s)", () => {
    const items = [
      { id: "text-a", start: 0, end: 5 },
      { id: "text-b", start: 3, end: 8 },
    ];
    const lanes = packTimelineItemsIntoLanes(items);
    expect(lanes).toHaveLength(2);
    expect(lanes[0][0].id).toBe("text-a");
    expect(lanes[1][0].id).toBe("text-b");
  });

  it("mengelompokkan item ke lane yang tersedia jika waktu setelahnya sudah bebas", () => {
    const items = [
      { id: "caption-1", start: 0, end: 3 },
      { id: "hook-1", start: 0, end: 5 },
      { id: "caption-2", start: 3, end: 6 },
      { id: "text-late", start: 7, end: 10 },
    ];
    const lanes = packTimelineItemsIntoLanes(items);
    // caption-1 (0-3) in lane 0
    // hook-1 (0-5) overlaps lane 0 -> in lane 1
    // caption-2 (3-6) fits in lane 0 (since caption-1 ended at 3)
    // text-late (7-10) fits in lane 0
    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((i) => i.id)).toEqual(["caption-1", "caption-2", "text-late"]);
    expect(lanes[1].map((i) => i.id)).toEqual(["hook-1"]);
  });

  it("membuat 3 lane jika 3 item overlap pada waktu bersamaan", () => {
    const items = [
      { id: "overlay-1", start: 1, end: 6 },
      { id: "overlay-2", start: 2, end: 5 },
      { id: "overlay-3", start: 3, end: 7 },
    ];
    const lanes = packTimelineItemsIntoLanes(items);
    expect(lanes).toHaveLength(3);
  });
});
