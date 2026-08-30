export type PackedTimelineItem = {
  start: number;
  end: number;
  [key: string]: unknown;
};

/**
 * Packs timeline items into non-overlapping lanes using an interval scheduling/packing algorithm.
 * Items with identical time intervals or overlapping windows are branched into parallel lanes.
 * Touching endpoints (e.g. itemA.end <= itemB.start) are placed in the same lane.
 */
export function packTimelineItemsIntoLanes<T extends PackedTimelineItem>(items: T[]): T[][] {
  if (!items || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const lanes: T[][] = [];

  for (const item of sorted) {
    let placed = false;
    for (const lane of lanes) {
      const hasOverlap = lane.some(
        (existing) => item.start < existing.end - 0.01 && existing.start < item.end - 0.01,
      );
      if (!hasOverlap) {
        lane.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([item]);
    }
  }

  return lanes;
}
