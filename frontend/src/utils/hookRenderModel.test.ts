import { describe, expect, it } from "vitest";
import { resolveHookPreviewRenderState } from "./hookSafeArea";

describe("Hook single renderer contract", () => {
  it("suppresses live overlay when a baked render is active", () => {
    expect(resolveHookPreviewRenderState(true, true).hookPreviewDuplicateSuppressed).toBe(true);
  });
});