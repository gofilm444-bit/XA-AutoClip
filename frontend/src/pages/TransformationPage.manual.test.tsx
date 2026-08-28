import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Transformation } from "../types";
import { EditorMediaImportControls } from "./TransformationPage";
import {
  hasManualEditorTimelineVideo,
  initialEditorContext,
  isManualEditorTransformation,
} from "../utils/manualEditor";

function transformation(manual: boolean, withVideo = false) {
  return {
    clipper_style_config: {
      manual_editor_mode: manual,
      video_sequence: withVideo
        ? [{ id: "video-1", source_start: 0, source_end: 12 }]
        : [],
      video_track_deleted: false,
    },
  } as Pick<Transformation, "clipper_style_config">;
}

describe("manual editor UX", () => {
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

    expect(screen.getByText("+ Import Video")).toBeInTheDocument();
    expect(screen.getByText("+ Import Audio")).toBeInTheDocument();
    expect(screen.getByText("+ Import Gambar")).toBeInTheDocument();

    const file = new File(["video"], "manual.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("+ Import Video"), {
      target: { files: [file] },
    });

    expect(onImport).toHaveBeenCalledWith("video", file);
  });
});
