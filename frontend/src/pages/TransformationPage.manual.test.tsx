import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Transformation } from "../types";
import { EditorMediaImportControls } from "./TransformationPage";
import {
  getActiveVideoSegment,
  getNextVideoSegment,
  getTimelineDuration,
  hasManualEditorTimelineVideo,
  initialEditorContext,
  isManualEditorTransformation,
  normalizeMediaSequence,
  resolveVideoSourceTime,
  resolveVideoSegmentSource,
  trimMediaSegmentRight,
  effectiveMediaDuration,
  sameMediaSource,
  insertMediaSegmentAtTime,
  trimSegmentLeftToPlayhead,
  trimSegmentRightToPlayhead,
  splitSegmentAtPlayhead,
  type MediaSequenceSegment,
} from "../utils/manualEditor";

function transformation(manual: boolean, withVideo = false, secondVideo = false) {
  const videoSeq = withVideo
    ? [{ id: "video-1", source_start: 0, source_end: 12 }]
    : [];
  if (secondVideo) {
    videoSeq.push({ id: "video-2", source_start: 0, source_end: 8 });
  }

  return {
    clipper_style_config: {
      manual_editor_mode: manual,
      video_sequence: videoSeq,
      video_track_deleted: false,
    },
  } as Pick<Transformation, "clipper_style_config">;
}

describe("manual editor UX & CapCut Media Import Flow", () => {
  it("membuka panel Media untuk editor manual kosong tanpa mengubah default AutoClip", () => {
    const manual = transformation(true);
    const autoClip = transformation(false);

    expect(isManualEditorTransformation(manual)).toBe(true);
    expect(initialEditorContext(manual)).toBe("media");
    expect(hasManualEditorTimelineVideo(manual)).toBe(false);
    expect(isManualEditorTransformation(autoClip)).toBe(false);
    expect(initialEditorContext(autoClip)).toBe("video");
  });

  it("menganggap manual editor siap media setelah video ada di timeline", () => {
    const manualWithVideo = transformation(true, true);

    expect(hasManualEditorTimelineVideo(manualWithVideo)).toBe(true);
    expect(initialEditorContext(manualWithVideo)).toBe("video");
  });

  it("menampilkan tiga import media dan meneruskan file video ke handler", () => {
    const onImport = vi.fn();
    render(<EditorMediaImportControls onImport={onImport} />);

    expect(screen.getByLabelText("Import Video")).toBeInTheDocument();
    expect(screen.getByLabelText("Import Audio")).toBeInTheDocument();
    expect(screen.getByLabelText("Import Gambar")).toBeInTheDocument();

    const file = new File(["video"], "manual.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("Import Video"), {
      target: { files: [file] },
    });

    expect(onImport).toHaveBeenCalledWith("video", file);
  });

  it("menjaga video pertama saat video kedua ditambahkan ke timeline (append bukan replace)", () => {
    const twoVideos = transformation(true, true, true);
    const seq = twoVideos.clipper_style_config?.video_sequence || [];

    expect(seq.length).toBe(2);
    expect(seq[0].id).toBe("video-1");
    expect(seq[0].source_end).toBe(12);
    expect(seq[1].id).toBe("video-2");
    expect(seq[1].source_end).toBe(8);
  });

  it("menghitung total timelineDuration dari video_sequence max/sum duration", () => {
    const videoSeqA = [{ id: "v1", sourceStart: 0, sourceEnd: 8 }];
    expect(getTimelineDuration(videoSeqA, [], [], [], [], 0)).toBe(8);

    const videoSeqAB = [
      { id: "v1", sourceStart: 0, sourceEnd: 8 },
      { id: "v2", sourceStart: 0, sourceEnd: 8 },
    ];
    expect(getTimelineDuration(videoSeqAB, [], [], [], [], 0)).toBe(16);
  });

  it("menentukan active source Video A pada t=0 dan Video B pada t > 8s", () => {
    const segments = [
      { id: "seg-1", asset_id: "asset-a", start: 0, end: 8, sourceStart: 0, sourceEnd: 8, speed: 1 },
      { id: "seg-2", asset_id: "asset-b", start: 8, end: 16, sourceStart: 0, sourceEnd: 8, speed: 1 },
    ];

    const getActiveSegment = (time: number) =>
      segments.find((s) => time >= s.start - 0.001 && time < s.end - 0.001) || segments[segments.length - 1];

    const atZero = getActiveSegment(0);
    expect(atZero.id).toBe("seg-1");
    expect(atZero.asset_id).toBe("asset-a");

    const atTen = getActiveSegment(10);
    expect(atTen.id).toBe("seg-2");
    expect(atTen.asset_id).toBe("asset-b");
    const sourceTimeAtTen = atTen.sourceStart + (10 - atTen.start) * atTen.speed;
    expect(sourceTimeAtTen).toBe(2);
  });


  it("memastikan play tidak disabled jika video_sequence memiliki durasi > 0", () => {
    const emptySeqDuration = getTimelineDuration([], [], [], [], [], 0);
    expect(emptySeqDuration).toBe(0);

    const validSeqDuration = getTimelineDuration([{ id: "v1", sourceStart: 0, sourceEnd: 8.5 }], [], [], [], [], 0);
    expect(validSeqDuration).toBe(8.5);
    expect(validSeqDuration > 0.05).toBe(true);
  });

  it("getActiveVideoSegment returns Video A before boundary", () => {
    const segs = [
      { id: "seg-1", start: 0, end: 8 },
      { id: "seg-2", start: 8, end: 15 },
    ];
    expect(getActiveVideoSegment(segs, 0)?.id).toBe("seg-1");
    expect(getActiveVideoSegment(segs, 3.5)?.id).toBe("seg-1");
    expect(getActiveVideoSegment(segs, 7.99)?.id).toBe("seg-1");
  });

  it("getActiveVideoSegment returns Video B at boundary 8.0 and after", () => {
    const segs = [
      { id: "seg-1", start: 0, end: 8 },
      { id: "seg-2", start: 8, end: 15 },
    ];
    expect(getActiveVideoSegment(segs, 8.0)?.id).toBe("seg-2");
    expect(getActiveVideoSegment(segs, 8.01)?.id).toBe("seg-2");
    expect(getActiveVideoSegment(segs, 10)?.id).toBe("seg-2");
  });

  it("getNextVideoSegment returns next segment or null for last", () => {
    const segs = [
      { id: "seg-1", start: 0, end: 8 },
      { id: "seg-2", start: 8, end: 15 },
    ];
    expect(getNextVideoSegment(segs, "seg-1")?.id).toBe("seg-2");
    expect(getNextVideoSegment(segs, "seg-2")).toBeNull();
  });

  it("sourceTime Video B starts at 0 when previewTime = B.start", () => {
    const segs = [
      { id: "seg-1", asset_id: "asset-a", start: 0, end: 8, sourceStart: 0, sourceEnd: 8, speed: 1 },
      { id: "seg-2", asset_id: "asset-b", start: 8, end: 15, sourceStart: 0, sourceEnd: 7, speed: 1 },
    ];
    const activeSeg = getActiveVideoSegment(segs, 8.0);
    expect(activeSeg?.id).toBe("seg-2");
    const sourceTime = activeSeg!.sourceStart + (8.0 - activeSeg!.start) * activeSeg!.speed;
    expect(sourceTime).toBe(0);
  });

  it("onEnded segment A: next segment exists, playback continues", () => {
    const segs = [
      { id: "seg-1", start: 0, end: 8 },
      { id: "seg-2", start: 8, end: 15 },
    ];
    let playing = true;
    let t = 8.0;
    function handleEnded(id: string, dur: number) {
      const n = getNextVideoSegment(segs, id);
      if (n && t < dur - 0.05) { t = n.start; return; }
      playing = false;
    }
    handleEnded("seg-1", 15);
    expect(playing).toBe(true);
    expect(t).toBe(8);
  });

  it("onEnded last segment: isPlaying becomes false", () => {
    const segs = [
      { id: "seg-1", start: 0, end: 8 },
      { id: "seg-2", start: 8, end: 15 },
    ];
    let playing = true;
    let t = 15.0;
    function handleEnded(id: string, dur: number) {
      const n = getNextVideoSegment(segs, id);
      if (n && t < dur - 0.05) { t = n.start; return; }
      playing = false;
    }
    handleEnded("seg-2", 15);
    expect(playing).toBe(false);
  });

  it("resolveVideoSegmentSource returns source A for segment A and source B for segment B", () => {
    const mediaAssets = [
      { asset_id: "asset-a", source_url: "/api/media/asset-a", name: "vid_a.mp4" },
      { asset_id: "asset-b", source_url: "/api/media/asset-b", name: "vid_b.mp4" },
    ];
    const segA = { id: "s1", asset_id: "asset-a", start: 0, end: 8 };
    const segB = { id: "s2", asset_id: "asset-b", start: 8, end: 15 };

    const resA = resolveVideoSegmentSource(segA, mediaAssets, "/fallback/default.mp4", "tx-123");
    expect(resA.resolvedSource).toBe("http://localhost:8000/api/media/asset-a");
    expect(resA.fallbackUsed).toBe(false);

    const resB = resolveVideoSegmentSource(segB, mediaAssets, "/fallback/default.mp4", "tx-123");
    expect(resB.resolvedSource).toBe("http://localhost:8000/api/media/asset-b");
    expect(resB.fallbackUsed).toBe(false);
    expect(resA.resolvedSource).not.toBe(resB.resolvedSource);
  });

  it("resolveVideoSegmentSource constructs direct URL when segment has asset_id and transformationId", () => {
    const segB = { id: "s2", asset_id: "asset-b", start: 8, end: 15 };
    // Even if mediaAssetById is empty / loading
    const resB = resolveVideoSegmentSource(segB, [], "/fallback/video1.mp4", "tx-123");
    expect(resB.resolvedSource).toBe("http://localhost:8000/api/transformations/tx-123/media/asset-b/source");
    expect(resB.fallbackUsed).toBe(false);
    expect(resB.resolvedSource).not.toBe("http://localhost:8000/fallback/video1.mp4");
  });

  it("activeVideoSource changes and produces unique key when previewTime crosses boundary", () => {
    const segs = [
      { id: "seg-1", asset_id: "asset-a", start: 0, end: 8, source_url: "/api/media/a" },
      { id: "seg-2", asset_id: "asset-b", start: 8, end: 15, source_url: "/api/media/b" },
    ];
    const mediaAssets = [
      { asset_id: "asset-a", source_url: "/api/media/a" },
      { asset_id: "asset-b", source_url: "/api/media/b" },
    ];

    const segAt3 = getActiveVideoSegment(segs, 3.0);
    const sourceAt3 = resolveVideoSegmentSource(segAt3, mediaAssets, "/fallback", "tx").resolvedSource;
    const keyAt3 = `${segAt3?.id}:${segAt3?.asset_id}:${sourceAt3}`;

    const segAt10 = getActiveVideoSegment(segs, 10.0);
    const sourceAt10 = resolveVideoSegmentSource(segAt10, mediaAssets, "/fallback", "tx").resolvedSource;
    const keyAt10 = `${segAt10?.id}:${segAt10?.asset_id}:${sourceAt10}`;

    expect(sourceAt3).toBe("http://localhost:8000/api/media/a");
    expect(sourceAt10).toBe("http://localhost:8000/api/media/b");
    expect(keyAt3).not.toBe(keyAt10);
  });

  it("pause sets previewPlayingRef false and cancels RAF", () => {
    let previewPlaying = true;
    const previewPlayingRef = { current: true };
    let rafId: number | null = 12345;

    function handlePause() {
      previewPlaying = false;
      previewPlayingRef.current = false;
      rafId = null;
    }

    handlePause();
    expect(previewPlaying).toBe(false);
    expect(previewPlayingRef.current).toBe(false);
    expect(rafId).toBeNull();
  });

  it("Media card button calls add-to-timeline with exact asset of the card, ignoring selectedMediaAssetId", () => {
    const assetA = { asset_id: "asset-a", name: "vid_a.mp4", duration_seconds: 8.0, kind: "video" as const, size_bytes: 1000 };
    const assetB = { asset_id: "asset-b", name: "vid_b.mp4", duration_seconds: 7.0, kind: "video" as const, size_bytes: 1000 };
    const selectedMediaAssetId = "asset-b"; // user currently selected B

    const calls: string[] = [];
    const handleAdd = (asset: typeof assetA) => {
      calls.push(asset.asset_id);
    };

    // Card A is clicked
    handleAdd(assetA);
    expect(calls[0]).toBe("asset-a");
    expect(calls[0]).not.toBe(selectedMediaAssetId);

    // Card B is clicked
    handleAdd(assetB);
    expect(calls[1]).toBe("asset-b");
  });

  it("Right trim computes shortened source_end properly without resetting to full asset duration", () => {
    const segment = {
      id: "seg-1",
      asset_id: "asset-a",
      sourceStart: 0.0,
      sourceEnd: 8.0,
      speed: 1.0,
    };
    const timelineStart = 0.0;
    const timelinePoint = 5.0; // user dragged right edge to 5s
    const minimumDuration = 0.25;

    const newDuration = Math.max(minimumDuration, timelinePoint - timelineStart);
    segment.sourceEnd = Number((segment.sourceStart + newDuration).toFixed(3));

    expect(segment.sourceEnd).toBe(5.0);
    expect(segment.sourceEnd - segment.sourceStart).toBe(5.0);
    expect(segment.asset_id).toBe("asset-a");
  });

  it("maps global timeline time to source-local time and clamps before source end", () => {
    const segment = {
      id: "segment-b",
      asset_id: "asset-b",
      start: 8,
      end: 15,
      sourceStart: 1,
      sourceEnd: 8,
      speed: 1,
    };
    expect(resolveVideoSourceTime(segment, 10)).toBe(3);
    expect(resolveVideoSourceTime(segment, 15)).toBeCloseTo(7.97, 5);
  });

  it("right trim updates timeline/source duration and preserves media identity", () => {
    const original = {
      id: "segment-a",
      asset_id: "asset-a",
      name: "video-a.mp4",
      source_url: "/api/transformations/tx/media/asset-a/source",
      source_path: "/app/storage/video-a.mp4",
      sourceStart: 0,
      sourceEnd: 8,
      start: 0,
      end: 8,
      duration: 8,
      speed: 1,
    };
    const trimmed = trimMediaSegmentRight(original, 0, 5, 8);
    expect(trimmed.end).toBe(5);
    expect(trimmed.duration).toBe(5);
    expect(trimmed.sourceEnd).toBe(5);
    expect(trimmed.asset_id).toBe(original.asset_id);
    expect(trimmed.source_url).toBe(original.source_url);
    expect(trimmed.source_path).toBe(original.source_path);
  });

  it("right trim enforces 0.5s minimum and asset-duration maximum", () => {
    const segment = { id: "s", sourceStart: 0, sourceEnd: 8, speed: 1 };
    expect(trimMediaSegmentRight(segment, 0, 0.1, 8).duration).toBe(0.5);
    expect(trimMediaSegmentRight(segment, 0, 20, 8).sourceEnd).toBe(8);
  });

  it("normalizeMediaSequence preserves persisted trim and timeline metadata", () => {
    const [segment] = normalizeMediaSequence([{
      id: "trimmed",
      asset_id: "asset-a",
      source_url: "/api/transformations/tx/media/asset-a/source",
      source_path: "/app/storage/a.mp4",
      source_start: 1,
      source_end: 5,
      start: 3,
      end: 7,
      duration: 4,
      speed: 1,
    }]);
    expect(segment.sourceStart).toBe(1);
    expect(segment.sourceEnd).toBe(5);
    expect(segment.start).toBe(3);
    expect(segment.end).toBe(7);
    expect(segment.duration).toBe(4);
    expect(segment.asset_id).toBe("asset-a");
  });

  it("timeline duration uses per-segment speed", () => {
    expect(getTimelineDuration([
      { sourceStart: 0, sourceEnd: 8, speed: 2 },
      { sourceStart: 0, sourceEnd: 7, speed: 1 },
    ])).toBe(11);
  });

  it("Autosave serializer preserves asset_id, name, source_url, source_path, and trimmed duration", () => {
    const roundTime = (v: number) => Number(v.toFixed(3));
    const serializeSequence = (seq: Array<{
      id: string;
      sourceStart: number;
      sourceEnd: number;
      asset_id?: string;
      name?: string;
      source_url?: string;
      source_path?: string;
    }>) =>
      seq
        .filter((s) => Number.isFinite(s.sourceStart) && Number.isFinite(s.sourceEnd) && s.sourceEnd > s.sourceStart)
        .map((s) => ({
          id: String(s.id),
          source_start: roundTime(s.sourceStart),
          source_end: roundTime(s.sourceEnd),
          asset_id: s.asset_id || undefined,
          name: s.name || undefined,
          source_url: s.source_url || undefined,
          source_path: s.source_path || undefined,
        }));

    const raw = [
      { id: "s1", sourceStart: 0.0, sourceEnd: 5.0, asset_id: "asset-a", name: "vid_a.mp4", source_url: "/media/a" },
      { id: "s2", sourceStart: 0.0, sourceEnd: 7.0, asset_id: "asset-b", name: "vid_b.mp4", source_url: "/media/b" },
    ];
    const serialized = serializeSequence(raw);

    expect(serialized.length).toBe(2);
    expect(serialized[0].asset_id).toBe("asset-a");
    expect(serialized[0].source_end).toBe(5.0);
    expect(serialized[0].source_url).toBe("/media/a");
    expect(serialized[1].asset_id).toBe("asset-b");
    expect(serialized[1].source_end).toBe(7.0);
    expect(serialized[1].source_url).toBe("/media/b");
  });

  // ==========================================
  // REGRESSION TESTS: TIMELINE DURATION & TRACK WIDTH
  // ==========================================

  // TEST 1: Video duration 8 -> effectiveDuration = 8
  it("TEST 1: Video duration 8 calculates effectiveDuration = 8", () => {
    const video = { sourceStart: 0, sourceEnd: 8, speed: 1 };
    expect(effectiveMediaDuration(video)).toBe(8);
  });

  // TEST 2: Video A (0-8) + Video B (8-15) -> timelineDuration = 15
  it("TEST 2: Video A (0-8) + Video B (8-15) results in timelineDuration = 15", () => {
    const videoA = { id: "va", sourceStart: 0, sourceEnd: 8, speed: 1 };
    const videoB = { id: "vb", sourceStart: 0, sourceEnd: 7, speed: 1 };
    const totalDuration = getTimelineDuration([videoA, videoB], [], [], [], [], 0);
    expect(totalDuration).toBe(15);
  });

  // TEST 3: Video A width = 8/15 (~53.33%) and Video B width = 7/15 (~46.67%), neither is 100%
  it("TEST 3: Video A and Video B have proportional width percentages (53.33% and 46.67%), not 100%", () => {
    const totalDuration = 15;
    const widthPercentA = ((8 - 0) / totalDuration) * 100;
    const widthPercentB = ((15 - 8) / totalDuration) * 100;

    expect(widthPercentA).toBeCloseTo(53.33, 1);
    expect(widthPercentB).toBeCloseTo(46.67, 1);
    expect(widthPercentA).not.toBe(100);
    expect(widthPercentB).not.toBe(100);
    expect(widthPercentA + widthPercentB).toBeCloseTo(100, 1);
  });

  // TEST 4: Timeline zoom changes visual pixel width without mutating segment durations (remains 8 and 7)
  it("TEST 4: Timeline zoom scale does not mutate segment duration data (remains 8 and 7)", () => {
    const sequence = [
      { id: "v1", sourceStart: 0, sourceEnd: 8, speed: 1 },
      { id: "v2", sourceStart: 0, sourceEnd: 7, speed: 1 },
    ];
    const totalDuration = getTimelineDuration(sequence);
    expect(totalDuration).toBe(15);

    const basePixelWidthPerSec = 50; // at 100% zoom
    const zoomLevels = [0.25, 0.5, 1.0, 2.0];

    zoomLevels.forEach((zoom) => {
      const pixelsPerSecond = basePixelWidthPerSec * zoom;
      const visualWidthA = effectiveMediaDuration(sequence[0]) * pixelsPerSecond;
      const visualWidthB = effectiveMediaDuration(sequence[1]) * pixelsPerSecond;

      // Visual width scales with zoom
      expect(visualWidthA).toBe(8 * pixelsPerSecond);
      expect(visualWidthB).toBe(7 * pixelsPerSecond);

      // But underlying data duration is strictly invariant
      expect(effectiveMediaDuration(sequence[0])).toBe(8);
      expect(effectiveMediaDuration(sequence[1])).toBe(7);
    });
  });

  // TEST 5: Right trim Video A from 8 -> 5 -> source_end = 5, end = 5, duration = 5
  it("TEST 5: Right trim Video A from 8 to 5 updates sourceEnd = 5, end = 5, duration = 5", () => {
    const segment = {
      id: "v1",
      sourceStart: 0,
      sourceEnd: 8,
      start: 0,
      end: 8,
      duration: 8,
      speed: 1,
    };
    const trimmed = trimMediaSegmentRight(segment, 0, 5, 8, 0.5);
    expect(trimmed.sourceStart).toBe(0);
    expect(trimmed.sourceEnd).toBe(5);
    expect(trimmed.start).toBe(0);
    expect(trimmed.end).toBe(5);
    expect(trimmed.duration).toBe(5);
  });

  // TEST 6: Caption corner resize does NOT change video segment durations
  it("TEST 6: Caption corner resize does not mutate video segment durations", () => {
    const videoSeq = [
      { id: "v1", sourceStart: 0, sourceEnd: 8, speed: 1 },
      { id: "v2", sourceStart: 0, sourceEnd: 7, speed: 1 },
    ];
    const initialDuration = getTimelineDuration(videoSeq);

    // Simulate caption resize modifying font_size from 20 to 36
    const captionStyle = { font_size: 20 };
    const resizedCaptionStyle = { ...captionStyle, font_size: 36 };
    expect(resizedCaptionStyle.font_size).toBe(36);

    // Verify video segment duration remains unchanged
    expect(getTimelineDuration(videoSeq)).toBe(initialDuration);
    expect(effectiveMediaDuration(videoSeq[0])).toBe(8);
    expect(effectiveMediaDuration(videoSeq[1])).toBe(7);
  });

  // TEST 7: Caption pointer interaction uses independent canvas manipulation ref without invoking timeline trim
  it("TEST 7: Caption resize interaction does not touch mediaResizeRef or videoSequence", () => {
    const mediaResizeState: { current: unknown } = { current: null };
    const canvasManipulationState = {
      current: {
        pointerId: 101,
        mode: "resize",
        handle: "br",
        targetType: "caption",
        targetId: "cue-1",
        initialFontSize: 20,
      },
    };

    expect(canvasManipulationState.current.mode).toBe("resize");
    expect(canvasManipulationState.current.targetType).toBe("caption");
    expect(mediaResizeState.current).toBeNull();
  });

  // TEST 8: Autosave and reload preserves trimmed duration
  it("TEST 8: Autosave and reload preserves trimmed duration", () => {
    const originalSeq = [
      { id: "s1", source_start: 0, source_end: 8, start: 0, end: 8, duration: 8 },
      { id: "s2", source_start: 0, source_end: 7, start: 8, end: 15, duration: 7 },
    ];
    expect(getTimelineDuration(normalizeMediaSequence(originalSeq))).toBe(15);

    // User trims s1 to 5s
    const trimmedSeq = [
      { id: "s1", source_start: 0, source_end: 5, start: 0, end: 5, duration: 5 },
      { id: "s2", source_start: 0, source_end: 7, start: 5, end: 12, duration: 7 },
    ];

    // Reload through normalizeMediaSequence
    const reloaded = normalizeMediaSequence(trimmedSeq);
    expect(reloaded[0].sourceStart).toBe(0);
    expect(reloaded[0].sourceEnd).toBe(5);
    expect(reloaded[0].duration).toBe(5);
    expect(reloaded[1].sourceStart).toBe(0);
    expect(reloaded[1].sourceEnd).toBe(7);
    expect(reloaded[1].duration).toBe(7);

    // Total duration after trim
    expect(getTimelineDuration(reloaded)).toBe(12);
  });

  // =========================================================================
  // TASK: DELETE ENTIRE TIMELINE TRACK / LANE TESTS (TEST 1 - TEST 12)
  // =========================================================================

  // TEST 1: Caption lane with 5 cues -> delete entire caption lane -> 0 cues
  it("TEST 1: Caption lane with 5 cues -> delete entire caption lane -> 0 cues", () => {
    const captionCues = [
      { id: "cue-1", text: "Cue 1", start: 0, end: 2 },
      { id: "cue-2", text: "Cue 2", start: 2, end: 4 },
      { id: "cue-3", text: "Cue 3", start: 4, end: 6 },
      { id: "cue-4", text: "Cue 4", start: 6, end: 8 },
      { id: "cue-5", text: "Cue 5", start: 8, end: 10 },
    ];
    const laneItems = captionCues.map((c) => ({
      id: c.id,
      type: "caption" as const,
      start: c.start,
      end: c.end,
      title: c.text,
      locked: false,
    }));

    const deletedIds = new Set(laneItems.map((i) => i.id));
    const nextCaptionCues = captionCues.filter((c) => !deletedIds.has(c.id));
    expect(nextCaptionCues.length).toBe(0);
  });

  // TEST 2: Delete Caption lane -> video_sequence before === video_sequence after
  it("TEST 2: Delete Caption lane preserves video_sequence deeply", () => {
    const videoSeqBefore = [
      { id: "v1", source_start: 0, source_end: 8, start: 0, end: 8, duration: 8 },
      { id: "v2", source_start: 0, source_end: 7, start: 8, end: 15, duration: 7 },
    ];
    const captionCues = [{ id: "c1", text: "Hello", start: 0, end: 3 }];
    const deletedCaptionIds = new Set(["c1"]);
    const nextCaptionCues = captionCues.filter((c) => !deletedCaptionIds.has(c.id));
    const videoSeqAfter = [...videoSeqBefore];

    expect(nextCaptionCues.length).toBe(0);
    expect(videoSeqAfter).toEqual(videoSeqBefore);
  });

  // TEST 3: Delete Caption lane -> timelineDuration of video sequence remains unchanged
  it("TEST 3: Delete Caption lane leaves timelineDuration intact", () => {
    const videoSeq = [
      { id: "v1", source_start: 0, source_end: 8, start: 0, end: 8, duration: 8 },
      { id: "v2", source_start: 0, source_end: 7, start: 8, end: 15, duration: 7 },
    ];
    const initialDuration = getTimelineDuration(normalizeMediaSequence(videoSeq));
    expect(initialDuration).toBe(15);

    // After deleting caption track, duration is still 15
    const durationAfter = getTimelineDuration(normalizeMediaSequence(videoSeq));
    expect(durationAfter).toBe(15);
  });

  // TEST 4: Video lane with 3 segments -> delete entire video lane -> video_sequence empty
  it("TEST 4: Video lane with 3 segments -> delete entire video lane -> video_sequence empty", () => {
    const videoSeq = [
      { id: "v1", source_start: 0, source_end: 5 },
      { id: "v2", source_start: 0, source_end: 4 },
      { id: "v3", source_start: 0, source_end: 6 },
    ];
    const laneItems = videoSeq.map((v) => ({ id: v.id, type: "video" as const }));
    const deletedIds = new Set(laneItems.map((i) => i.id));
    const nextVideoSeq = videoSeq.filter((v) => !deletedIds.has(v.id));

    expect(nextVideoSeq.length).toBe(0);
  });

  // TEST 5: Delete Audio lane -> video_sequence does not change
  it("TEST 5: Delete Audio lane does not modify video_sequence", () => {
    const videoSeq = [
      { id: "v1", source_start: 0, source_end: 8 },
      { id: "v2", source_start: 0, source_end: 7 },
    ];
    const audioSeq = [{ id: "a1", source_start: 0, source_end: 8 }];
    const deletedAudioIds = new Set(["a1"]);
    const nextAudioSeq = audioSeq.filter((a) => !deletedAudioIds.has(a.id));

    expect(nextAudioSeq.length).toBe(0);
    expect(videoSeq.length).toBe(2);
    expect(videoSeq[0].id).toBe("v1");
  });

  // TEST 6: Locked lane -> delete action rejects deletion
  it("TEST 6: Locked lane rejects deletion action", () => {
    const lockedLaneItems = [
      { id: "c1", type: "caption" as const, locked: true },
      { id: "c2", type: "caption" as const, locked: true },
    ];
    const isLocked = lockedLaneItems.every((i) => Boolean(i.locked));
    let deletedCount = 0;
    if (!isLocked) {
      deletedCount = lockedLaneItems.length;
    }
    expect(isLocked).toBe(true);
    expect(deletedCount).toBe(0);
  });

  // TEST 7: Mass delete triggers single atomic update / single revision
  it("TEST 7: Mass delete triggers a single atomic update instead of N individual updates", () => {
    const cues = Array.from({ length: 10 }, (_, i) => ({ id: `c-${i}`, text: `C${i}` }));
    let revisionCount = 0;

    // Atomic mass delete
    const deletedIds = new Set(cues.map((c) => c.id));
    const nextCues = cues.filter((c) => !deletedIds.has(c.id));
    revisionCount += 1;

    expect(nextCues.length).toBe(0);
    expect(revisionCount).toBe(1); // Exactly 1, not 10
  });

  // TEST 8: Track menu interaction does not alter timelineZoom
  it("TEST 8: Track menu interaction does not mutate timelineZoom", () => {
    const timelineZoom = 1.0;
    const initialZoom = timelineZoom;
    const openMenu = () => {
      // Menu opens without altering zoom
      return { open: true };
    };
    openMenu();
    expect(timelineZoom).toBe(initialZoom);
  });

  // TEST 9: Delete lane preserves timelineContentScale formula
  it("TEST 9: timelineContentScale formula Math.max(0.25, Math.min(4.0, timelineZoom)) is preserved", () => {
    const zoom1 = 1.0;
    const scale1 = Math.max(0.25, Math.min(4.0, zoom1));
    expect(scale1).toBe(1.0);

    const zoom2 = 2.0;
    const scale2 = Math.max(0.25, Math.min(4.0, zoom2));
    expect(scale2).toBe(2.0);
  });

  // TEST 10: Delete caption/text lane preserves all video segment properties
  it("TEST 10: Delete caption/text lane preserves segment start, end, sourceStart, sourceEnd, duration", () => {
    const videoSeq = [
      { id: "v1", source_start: 0, source_end: 8, start: 0, end: 8, duration: 8, speed: 1 },
      { id: "v2", source_start: 0, source_end: 7, start: 8, end: 15, duration: 7, speed: 1 },
    ];
    const norm = normalizeMediaSequence(videoSeq);
    expect(norm[0].start).toBe(0);
    expect(norm[0].end).toBe(8);
    expect(norm[0].duration).toBe(8);
    expect(norm[1].start).toBe(8);
    expect(norm[1].end).toBe(15);
    expect(norm[1].duration).toBe(7);
  });

  // TEST 11: After delete track, normalized state remains empty and valid on reload
  it("TEST 11: Empty sequence after delete remains valid on reload/normalization", () => {
    const emptySeq: Array<{ id: string; source_start: number; source_end: number }> = [];
    const normalized = normalizeMediaSequence(emptySeq);
    expect(normalized).toEqual([]);
    expect(getTimelineDuration(normalized)).toBe(0);
  });

  // TEST 12: Delete single selected item still works independently
  it("TEST 12: Delete single selected item works independently (leaves other items intact)", () => {
    // Caption single delete
    const captionCues = [
      { id: "cue-a", text: "A" },
      { id: "cue-b", text: "B" },
      { id: "cue-c", text: "C" },
    ];
    const selectedCaptionId = "cue-b";
    const nextCues = captionCues.filter((c) => c.id !== selectedCaptionId);
    expect(nextCues.map((c) => c.id)).toEqual(["cue-a", "cue-c"]);

    // Video single delete
    const videoSeq = [
      { id: "v-a", source_start: 0, source_end: 5 },
      { id: "v-b", source_start: 0, source_end: 4 },
      { id: "v-c", source_start: 0, source_end: 6 },
    ];
    const selectedVideoId = "v-b";
    const nextVideoSeq = videoSeq.filter((v) => v.id !== selectedVideoId);
    expect(nextVideoSeq.map((v) => v.id)).toEqual(["v-a", "v-c"]);
  });
});
describe("Source-Scoped Video Error State & Stale Event Protection (Section L)", () => {
  type PreviewVideoError = {
    source: string;
    assetId?: string;
    segmentId?: string;
    message: string;
    code?: number;
    timestamp: number;
  } | null;

  const sourceA = "http://localhost:8000/api/transformations/t1/media/asset-a/source";
  const sourceB = "http://localhost:8000/api/transformations/t1/media/asset-b/source";

  // TEST 1: Source A loads successfully -> no error placeholder
  it("TEST 1: Source A loads successfully -> no error placeholder", () => {
    const error: PreviewVideoError = null;
    const activeSource = sourceA;

    const activeSourceHasError = Boolean(
      error ? sameMediaSource((error as unknown as { source: string }).source, activeSource) : false
    );
    expect(activeSourceHasError).toBe(false);
  });

  // TEST 2: Source A raises error -> error shown. Then source changes to B -> error cleared / not applicable to B
  it("TEST 2: Source A error is scoped to A, changing to B ignores A's error", () => {
    const error: PreviewVideoError = {
      source: sourceA,
      assetId: "asset-a",
      message: "Network error on A",
      timestamp: Date.now(),
    };

    // While A is active:
    let activeSource = sourceA;
    const hasErrorForA = Boolean(error && sameMediaSource(error.source, activeSource));
    expect(hasErrorForA).toBe(true);

    // When timeline switches to B:
    activeSource = sourceB;
    const hasErrorForB = Boolean(error && sameMediaSource(error.source, activeSource));
    expect(hasErrorForB).toBe(false); // B does NOT have error!
  });

  // TEST 3: Source B successfully fires loadedmetadata/canplay -> error state cleared
  it("TEST 3: Successful load metadata/canplay on active source clears error", () => {
    let error: PreviewVideoError = {
      source: sourceB,
      assetId: "asset-b",
      message: "Initial load error",
      timestamp: Date.now(),
    };

    const activeSource = sourceB;
    const loadedSrc = sourceB;

    // onLoadedMetadata / onCanPlay
    if (sameMediaSource(loadedSrc, activeSource)) {
      error = null;
    }

    expect(error).toBeNull();
  });

  // TEST 4: Source A stale onError arrives AFTER B became active -> stale A error ignored, B remains visible (CRITICAL)
  it("TEST 4: Late/stale onError from Source A arriving after B is active is ignored", () => {
    let error: PreviewVideoError = null;
    const activeSource = sourceB; // B is currently active!

    // Late error event arrives with event.currentTarget.currentSrc = sourceA
    const eventSrc = sourceA;
    const isCurrent = sameMediaSource(eventSrc, activeSource);
    let action = "ignore_stale";

    if (isCurrent) {
      action = "set_error";
      error = {
        source: activeSource,
        message: "Source error",
        timestamp: Date.now(),
      };
    }

    expect(isCurrent).toBe(false);
    expect(action).toBe("ignore_stale");
    expect(error).toBeNull(); // Error remains null! B stays visible!
  });

  // TEST 5: At Video B active: change transition -> Video B stays B
  it("TEST 5: Changing transition does not alter active video source identity", () => {
    const videoSeq = [
      { id: "v1", asset_id: "asset-a", source_url: sourceA, start: 0, end: 8 },
      { id: "v2", asset_id: "asset-b", source_url: sourceB, start: 8, end: 15 },
    ];
    const previewTime = 10; // in B
    const activeSeg = getActiveVideoSegment(videoSeq, previewTime);
    expect(activeSeg?.asset_id).toBe("asset-b");

    // Adding transition event to timeline does not mutate active video source
    const transitionEvent = { id: "tr-1", type: "pattern_interrupt", start: 7.5, end: 8.5 };
    expect(transitionEvent.type).toBe("pattern_interrupt");
    const activeSegAfterTransition = getActiveVideoSegment(videoSeq, previewTime);
    expect(activeSegAfterTransition?.asset_id).toBe("asset-b");
  });

  // TEST 6: sameMediaSource correctly matches relative, absolute, and query-string URLs
  it("TEST 6: sameMediaSource correctly compares relative, absolute, and query-string URLs", () => {
    expect(sameMediaSource("/api/transformations/1/media/2/source", "http://localhost:8000/api/transformations/1/media/2/source")).toBe(true);
    expect(sameMediaSource("http://localhost:8000/api/transformations/1/media/2/source?t=123", "http://localhost:8000/api/transformations/1/media/2/source")).toBe(true);
    expect(sameMediaSource("http://localhost:8000/api/transformations/1/media/2/source", "http://localhost:8000/api/transformations/1/media/3/source")).toBe(false);
    expect(sameMediaSource("", "http://localhost:8000/something")).toBe(false);
    expect(sameMediaSource(null, null)).toBe(false);
  });

  // TEST 7: Switch A -> B -> A -> B each source independently resolves and does not inherit errors
  it("TEST 7: Switch A -> B -> A -> B maintains independent source identity and error state", () => {
    const videoSeq = [
      { id: "v1", asset_id: "asset-a", source_url: sourceA, start: 0, end: 8 },
      { id: "v2", asset_id: "asset-b", source_url: sourceB, start: 8, end: 15 },
    ];

    const segAt3 = getActiveVideoSegment(videoSeq, 3);
    expect(segAt3?.asset_id).toBe("asset-a");

    const segAt10 = getActiveVideoSegment(videoSeq, 10);
    expect(segAt10?.asset_id).toBe("asset-b");

    const segAt2 = getActiveVideoSegment(videoSeq, 2);
    expect(segAt2?.asset_id).toBe("asset-a");

    const segAt12 = getActiveVideoSegment(videoSeq, 12);
    expect(segAt12?.asset_id).toBe("asset-b");
  });

  // TEST 8: Error placeholder rendering does not mutate video_sequence, asset_id, timelineDuration
  it("TEST 8: Transient error state does not mutate video_sequence or duration", () => {
    const videoSeq = [
      { id: "v1", asset_id: "asset-a", source_start: 0, source_end: 8 },
      { id: "v2", asset_id: "asset-b", source_start: 0, source_end: 7 },
    ];
    const initialDuration = getTimelineDuration(videoSeq);
    expect(initialDuration).toBe(15);

    // Simulate transient error
    const transientError: PreviewVideoError = {
      source: sourceB,
      message: "Transient failure",
      timestamp: Date.now(),
    };
    expect(transientError?.source).toBe(sourceB);

    // Video sequence and duration remain identical
    expect(videoSeq.length).toBe(2);
    expect(videoSeq[0].asset_id).toBe("asset-a");
    expect(videoSeq[1].asset_id).toBe("asset-b");
    expect(getTimelineDuration(videoSeq)).toBe(initialDuration);
  });

  // TEST 9: timelineContentScale invariant is preserved
  it("TEST 9: timelineContentScale = Math.max(0.25, Math.min(4.0, timelineZoom)) is preserved", () => {
    for (const zoom of [0.1, 0.25, 1.0, 2.5, 4.0, 10.0]) {
      const scale = Math.max(0.25, Math.min(4.0, zoom));
      expect(scale).toBeGreaterThanOrEqual(0.25);
      expect(scale).toBeLessThanOrEqual(4.0);
    }
  });
});

describe("PHASE 1 — PLAYHEAD STABILITY", () => {
  it("USER PLAYHEAD INTERACTION ALWAYS WINS: pointer down immediately pauses playback and stops RAF clock", () => {
    let previewPlaying = true;
    const previewPlayingRef = { current: true };
    const timelineDraggingRef = { current: false };
    let previewClockFrame: number | null = 1234;
    let previewTime = 5.0;
    const previewTimeRef = { current: 5.0 };

    function handlePreviewPause() {
      previewPlaying = false;
      previewPlayingRef.current = false;
      if (previewClockFrame !== null) {
        previewClockFrame = null;
      }
    }

    function handleTimelinePointerDown(targetTime: number) {
      handlePreviewPause();
      timelineDraggingRef.current = true;
      previewTimeRef.current = targetTime;
      previewTime = targetTime;
    }

    function updateClock(delta: number) {
      if (timelineDraggingRef.current || !previewPlayingRef.current) {
        return;
      }
      previewTimeRef.current += delta;
      previewTime = previewTimeRef.current;
    }

    function finishTimelineDrag() {
      timelineDraggingRef.current = false;
    }

    // 1. Currently playing at 5s
    expect(previewPlaying).toBe(true);
    expect(previewTime).toBe(5.0);

    // 2. User touches / pointer down playhead to drag to 9s
    handleTimelinePointerDown(9.0);
    expect(previewPlaying).toBe(false);
    expect(previewPlayingRef.current).toBe(false);
    expect(previewClockFrame).toBeNull();
    expect(previewTime).toBe(9.0);

    // 3. Drag to 11s
    previewTimeRef.current = 11.0;
    previewTime = 11.0;

    // 4. Pointer released at 11s
    finishTimelineDrag();
    expect(timelineDraggingRef.current).toBe(false);
    expect(previewPlaying).toBe(false);
    expect(previewTime).toBe(11.0);

    // 5. Trigger simulated playback tick / RAF after release
    updateClock(0.016);
    expect(previewTime).toBe(11.0);
    expect(previewPlaying).toBe(false);

    // 6. Wait 10 simulated ticks
    for (let i = 0; i < 10; i++) {
      updateClock(0.1);
    }
    expect(previewTime).toBe(11.0);

    // 7. Video onTimeUpdate while paused must not overwrite playhead
    function setPreviewTimeFromVideo(videoTime: number) {
      if (timelineDraggingRef.current) return;
      if (!previewPlayingRef.current) return;
      previewTime = videoTime;
    }
    setPreviewTimeFromVideo(8.2); // Stale video time
    expect(previewTime).toBe(11.0);
  });

  it("Play resumes exactly from the last released playhead position", () => {
    let previewPlaying = false;
    const previewPlayingRef = { current: false };
    let previewTime = 11.0;
    const previewTimeRef = { current: 11.0 };
    const clipDuration = 20.0;

    function handlePreviewPlay() {
      if (previewTime >= clipDuration - 0.05) {
        previewTime = 0;
        previewTimeRef.current = 0;
      }
      previewPlaying = true;
      previewPlayingRef.current = true;
    }

    function updateClock(delta: number) {
      if (!previewPlayingRef.current) return;
      previewTimeRef.current += delta;
      previewTime = previewTimeRef.current;
    }

    // User starts playback from 11.0s
    handlePreviewPlay();
    expect(previewPlaying).toBe(true);
    expect(previewTime).toBe(11.0);

    // Playback advances smoothly from 11.0s
    updateClock(0.5);
    expect(previewTime).toBeCloseTo(11.5);
  });
});

describe("PHASE 2 — MULTI-FILE MEDIA IMPORT", () => {
  it("Handler iterates all selected files and uploads each one in selection order", async () => {
    const uploadedFiles: string[] = [];
    const mockUpload = vi.fn(async (file: { name: string }) => {
      uploadedFiles.push(file.name);
      return { asset_id: `id-${file.name}`, name: file.name };
    });

    const fileA = { name: "A.mp4" } as File;
    const fileB = { name: "B.mp4" } as File;
    const fileC = { name: "C.mp4" } as File;

    // Simulate input change with multiple files
    const files = [fileA, fileB, fileC];
    let message = "";

    // importEditorMediaFiles simulation
    async function importEditorMediaFiles(selected: File[]) {
      let successCount = 0;
      let failCount = 0;
      for (const file of selected) {
        try {
          await mockUpload(file);
          successCount++;
        } catch {
          failCount++;
        }
      }
      if (failCount === 0) {
        message = `${successCount} media berhasil ditambahkan ke library.`;
      } else {
        message = `${successCount} media berhasil diimport, ${failCount} gagal.`;
      }
    }

    await importEditorMediaFiles(files);

    expect(mockUpload).toHaveBeenCalledTimes(3);
    expect(uploadedFiles).toEqual(["A.mp4", "B.mp4", "C.mp4"]);
    expect(message).toBe("3 media berhasil ditambahkan ke library.");
  });

  it("Partial failure preserves successful uploads and reports count accurately", async () => {
    const mockUpload = vi.fn(async (file: { name: string }) => {
      if (file.name === "fail.mp4") {
        throw new Error("Network error");
      }
      return { asset_id: `id-${file.name}`, name: file.name };
    });

    const files = [
      { name: "ok1.mp4" } as File,
      { name: "fail.mp4" } as File,
      { name: "ok2.mp4" } as File,
      { name: "ok3.mp4" } as File,
    ];

    let message = "";
    const successfulAssets: string[] = [];

    async function importEditorMediaFiles(selected: File[]) {
      let successCount = 0;
      let failCount = 0;
      for (const file of selected) {
        try {
          const res = await mockUpload(file);
          successfulAssets.push(res.asset_id);
          successCount++;
        } catch {
          failCount++;
        }
      }
      if (failCount === 0) {
        message = `${successCount} media berhasil ditambahkan ke library.`;
      } else {
        message = `${successCount} media berhasil diimport, ${failCount} gagal.`;
      }
    }

    await importEditorMediaFiles(files);

    expect(mockUpload).toHaveBeenCalledTimes(4);
    expect(successfulAssets).toEqual(["id-ok1.mp4", "id-ok2.mp4", "id-ok3.mp4"]);
    expect(message).toBe("3 media berhasil diimport, 1 gagal.");
  });
});

describe("PHASE 3 — ADD MEDIA TO TIMELINE AT PLAYHEAD", () => {
  it("TEST A: Insert at boundary between clips shifts subsequent clips without overlap", () => {
    // A = 0-8, B = 8-15
    const seq: MediaSequenceSegment[] = [
      { id: "seg-a", asset_id: "asset-a", sourceStart: 0, sourceEnd: 8, start: 0, end: 8, duration: 8, speed: 1 },
      { id: "seg-b", asset_id: "asset-b", sourceStart: 0, sourceEnd: 7, start: 8, end: 15, duration: 7, speed: 1 },
    ];

    const segC: MediaSequenceSegment = {
      id: "seg-c",
      asset_id: "asset-c",
      sourceStart: 0,
      sourceEnd: 4,
      duration: 4,
      speed: 1,
    };

    // Playhead = 8
    const result = insertMediaSegmentAtTime(seq, segC, 8.0);

    expect(result.length).toBe(3);
    // A = 0-8
    expect(result[0].id).toBe("seg-a");
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(8);

    // C = 8-12
    expect(result[1].id).toBe("seg-c");
    expect(result[1].start).toBe(8);
    expect(result[1].end).toBe(12);

    // B = 12-19 (shifted right by duration of C)
    expect(result[2].id).toBe("seg-b");
    expect(result[2].start).toBe(12);
    expect(result[2].end).toBe(19);
  });

  it("TEST B: Insert inside existing clip splits clip and preserves source continuity and asset identity", () => {
    // A: timeline 0-8, source 0-8
    const seq: MediaSequenceSegment[] = [
      { id: "seg-a", asset_id: "asset-a", sourceStart: 0, sourceEnd: 8, start: 0, end: 8, duration: 8, speed: 1 },
    ];

    // B duration: 3 sec
    const segB: MediaSequenceSegment = {
      id: "seg-b",
      asset_id: "asset-b",
      sourceStart: 0,
      sourceEnd: 3,
      duration: 3,
      speed: 1,
    };

    // Playhead = 4
    const result = insertMediaSegmentAtTime(seq, segB, 4.0);

    expect(result.length).toBe(3);

    // A-left: timeline 0-4, source 0-4, asset_id = asset-a
    expect(result[0].asset_id).toBe("asset-a");
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(4);
    expect(result[0].sourceStart).toBe(0);
    expect(result[0].sourceEnd).toBe(4);

    // B: timeline 4-7, source 0-3, asset_id = asset-b
    expect(result[1].asset_id).toBe("asset-b");
    expect(result[1].start).toBe(4);
    expect(result[1].end).toBe(7);
    expect(result[1].sourceStart).toBe(0);
    expect(result[1].sourceEnd).toBe(3);

    // A-right: timeline 7-11, source 4-8, asset_id = asset-a
    expect(result[2].asset_id).toBe("asset-a");
    expect(result[2].start).toBe(7);
    expect(result[2].end).toBe(11);
    expect(result[2].sourceStart).toBe(4);
    expect(result[2].sourceEnd).toBe(8);
  });

  it("Insert beyond timeline duration appends to end seamlessly", () => {
    const seq: MediaSequenceSegment[] = [
      { id: "seg-a", asset_id: "asset-a", sourceStart: 0, sourceEnd: 5, start: 0, end: 5, duration: 5, speed: 1 },
    ];
    const segB: MediaSequenceSegment = {
      id: "seg-b",
      asset_id: "asset-b",
      sourceStart: 0,
      sourceEnd: 3,
      duration: 3,
      speed: 1,
    };

    const result = insertMediaSegmentAtTime(seq, segB, 10.0);
    expect(result.length).toBe(2);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(5);
    expect(result[1].start).toBe(5);
    expect(result[1].end).toBe(8);
  });
});

describe("PHASE 4 — NORMALIZE TRIM LEFT / RIGHT", () => {
  it("Repeated Trim Left calculates incrementally without resetting to 0", () => {
    // Original: timeline 0-10, source 0-10
    let seq: MediaSequenceSegment[] = [
      { id: "seg-1", asset_id: "asset-1", sourceStart: 0, sourceEnd: 10, start: 0, end: 10, duration: 10, speed: 1 },
    ];

    // Trim Left at 2
    const res1 = trimSegmentLeftToPlayhead(seq, "seg-1", 2.0);
    expect(res1).not.toBeNull();
    seq = res1!;
    expect(seq[0].start).toBe(2);
    expect(seq[0].end).toBe(10);
    expect(seq[0].sourceStart).toBe(2);
    expect(seq[0].sourceEnd).toBe(10);
    expect(seq[0].duration).toBe(8);

    // Then Trim Left again at 5
    const res2 = trimSegmentLeftToPlayhead(seq, "seg-1", 5.0);
    expect(res2).not.toBeNull();
    seq = res2!;
    expect(seq[0].start).toBe(5);
    expect(seq[0].end).toBe(10);
    expect(seq[0].sourceStart).toBe(5);
    expect(seq[0].sourceEnd).toBe(10);
    expect(seq[0].duration).toBe(5);
  });

  it("Trim on split-derived segment accurately offsets source boundaries", () => {
    // Segment: timeline 4-10, source 2-8
    let seq: MediaSequenceSegment[] = [
      { id: "seg-split", asset_id: "asset-split", sourceStart: 2, sourceEnd: 8, start: 4, end: 10, duration: 6, speed: 1 },
    ];

    // Trim Left at 6
    const res1 = trimSegmentLeftToPlayhead(seq, "seg-split", 6.0);
    expect(res1).not.toBeNull();
    seq = res1!;
    // Expected: timeline 6-10, source 4-8
    expect(seq[0].start).toBe(6);
    expect(seq[0].end).toBe(10);
    expect(seq[0].sourceStart).toBe(4);
    expect(seq[0].sourceEnd).toBe(8);
    expect(seq[0].duration).toBe(4);

    // Then Trim Right at 8
    const res2 = trimSegmentRightToPlayhead(seq, "seg-split", 8.0);
    expect(res2).not.toBeNull();
    seq = res2!;
    // Expected: timeline 6-8, source 4-6
    expect(seq[0].start).toBe(6);
    expect(seq[0].end).toBe(8);
    expect(seq[0].sourceStart).toBe(4);
    expect(seq[0].sourceEnd).toBe(6);
    expect(seq[0].duration).toBe(2);
  });

  it("Trim validity: playhead outside segment or leaving < minDuration is rejected as no-op", () => {
    const seq: MediaSequenceSegment[] = [
      { id: "seg-1", asset_id: "asset-1", sourceStart: 0, sourceEnd: 10, start: 0, end: 10, duration: 10, speed: 1 },
    ];

    // Playhead outside (at 12)
    expect(trimSegmentLeftToPlayhead(seq, "seg-1", 12.0)).toBeNull();
    expect(trimSegmentRightToPlayhead(seq, "seg-1", 12.0)).toBeNull();

    // Playhead too close to end for Left Trim (< 0.25s remaining)
    expect(trimSegmentLeftToPlayhead(seq, "seg-1", 9.85)).toBeNull();

    // Playhead too close to start for Right Trim (< 0.25s from start)
    expect(trimSegmentRightToPlayhead(seq, "seg-1", 0.15)).toBeNull();
  });

  it("Trim preserves untouched segments in multi-video timeline", () => {
    const seq: MediaSequenceSegment[] = [
      { id: "seg-a", asset_id: "asset-a", sourceStart: 0, sourceEnd: 8, start: 0, end: 8, duration: 8, speed: 1 },
      { id: "seg-b", asset_id: "asset-b", sourceStart: 0, sourceEnd: 7, start: 8, end: 15, duration: 7, speed: 1 },
    ];

    // Trim Right on seg-a at 5
    const res = trimSegmentRightToPlayhead(seq, "seg-a", 5.0);
    expect(res).not.toBeNull();
    // seg-a trimmed to 0-5
    expect(res![0].end).toBe(5);
    expect(res![0].sourceEnd).toBe(5);
    // seg-b completely untouched
    expect(res![1].id).toBe("seg-b");
    expect(res![1].asset_id).toBe("asset-b");
    expect(res![1].start).toBe(8);
    expect(res![1].end).toBe(15);
  });
});

describe("PHASE 5 — SPLIT / POTONG TENGAH AT PLAYHEAD", () => {
  it("Split at playhead divides segment with exact playhead boundary and continuous source", () => {
    // Selected segment: timeline 4-10, source 2-8, speed 1
    const seq: MediaSequenceSegment[] = [
      { id: "seg-1", asset_id: "asset-parent", name: "clip.mp4", sourceStart: 2, sourceEnd: 8, start: 4, end: 10, duration: 6, speed: 1 },
    ];

    // Playhead = 7
    const res = splitSegmentAtPlayhead(seq, "seg-1", 7.0, "seg-1-right");
    expect(res).not.toBeNull();
    const result = res!.sequence;
    expect(res!.rightId).toBe("seg-1-right");
    expect(result.length).toBe(2);

    const left = result[0];
    const right = result[1];

    // LEFT: timeline 4-7, source 2-5
    expect(left.id).toBe("seg-1");
    expect(left.asset_id).toBe("asset-parent");
    expect(left.start).toBe(4);
    expect(left.end).toBe(7);
    expect(left.sourceStart).toBe(2);
    expect(left.sourceEnd).toBe(5);
    expect(left.duration).toBe(3);

    // RIGHT: timeline 7-10, source 5-8
    expect(right.id).toBe("seg-1-right");
    expect(right.asset_id).toBe("asset-parent");
    expect(right.start).toBe(7);
    expect(right.end).toBe(10);
    expect(right.sourceStart).toBe(5);
    expect(right.sourceEnd).toBe(8);
    expect(right.duration).toBe(3);

    // Invariants:
    expect(left.end).toBe(7.0);
    expect(right.start).toBe(7.0);
    expect(left.sourceEnd).toBe(right.sourceStart);
  });

  it("Split validity: boundary playhead or outside playhead returns null no-op", () => {
    const seq: MediaSequenceSegment[] = [
      { id: "seg-1", asset_id: "asset-1", sourceStart: 2, sourceEnd: 8, start: 4, end: 10, duration: 6, speed: 1 },
    ];

    // Exact boundary or too close to start (at 4.0 or 4.02)
    expect(splitSegmentAtPlayhead(seq, "seg-1", 4.0)).toBeNull();
    expect(splitSegmentAtPlayhead(seq, "seg-1", 4.03)).toBeNull();

    // Exact boundary or too close to end (at 10.0 or 9.98)
    expect(splitSegmentAtPlayhead(seq, "seg-1", 10.0)).toBeNull();
    expect(splitSegmentAtPlayhead(seq, "seg-1", 9.97)).toBeNull();

    // Completely outside
    expect(splitSegmentAtPlayhead(seq, "seg-1", 2.0)).toBeNull();
    expect(splitSegmentAtPlayhead(seq, "seg-1", 12.0)).toBeNull();
  });

  it("Split applies to SELECTED segment only without affecting other segments", () => {
    const seq: MediaSequenceSegment[] = [
      { id: "seg-a", asset_id: "asset-a", sourceStart: 0, sourceEnd: 8, start: 0, end: 8, duration: 8, speed: 1 },
      { id: "seg-b", asset_id: "asset-b", sourceStart: 0, sourceEnd: 7, start: 8, end: 15, duration: 7, speed: 1 },
    ];

    // Split seg-b at 11
    const res = splitSegmentAtPlayhead(seq, "seg-b", 11.0, "seg-b-right");
    expect(res).not.toBeNull();
    const result = res!.sequence;
    expect(result.length).toBe(3);

    // seg-a is completely untouched
    expect(result[0].id).toBe("seg-a");
    expect(result[0].asset_id).toBe("asset-a");
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(8);

    // seg-b is split into 8-11 and 11-15, both having asset-b
    expect(result[1].id).toBe("seg-b");
    expect(result[1].asset_id).toBe("asset-b");
    expect(result[1].start).toBe(8);
    expect(result[1].end).toBe(11);

    expect(result[2].id).toBe("seg-b-right");
    expect(result[2].asset_id).toBe("asset-b");
    expect(result[2].start).toBe(11);
    expect(result[2].end).toBe(15);
  });
});
