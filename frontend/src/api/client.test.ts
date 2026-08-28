import { describe, expect, it, vi } from "vitest";
import { ApiError, api, mediaUrl, normalizeApiErrorMessage, uploadMedia } from "../api/client";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("media helpers", () => {
  it("mediaUrl builds the editor media file url", () => {
    expect(mediaUrl("t1", "a1")).toBe("http://localhost:8000/api/transformations/t1/media/a1");
  });

  it("uploadMedia posts file and kind and returns parsed body", async () => {
    const body = JSON.stringify({ asset_id: "a1", kind: "video", name: "clip.mp4" });
    const xhrMock = {
      open: vi.fn(),
      send: vi.fn(function (this: { onload: () => void }) {
        Object.defineProperty(this, "status", { value: 201 });
        Object.defineProperty(this, "responseText", { value: body });
        this.onload();
      }),
      upload: { onprogress: null },
      onerror: null,
      onload: null as (() => void) | null,
    } as unknown as XMLHttpRequest;
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        open = xhrMock.open;
        send = xhrMock.send;
        upload = xhrMock.upload;
        onerror = xhrMock.onerror;
        onload = xhrMock.onload;
      },
    );
    const file = new File(["data"], "clip.mp4", { type: "video/mp4" });
    const asset = await uploadMedia<{ asset_id: string }>(
      "/api/transformations/t1/media",
      file,
      "video",
    );
    expect(asset.asset_id).toBe("a1");
    vi.unstubAllGlobals();
  });
});

describe("normalizeApiErrorMessage", () => {
  it("formats FastAPI validation array into a readable string", () => {
    const detail = [
      { loc: ["body", "original_hook"], msg: "String should have at least 5 characters", type: "string_too_short" },
      { loc: ["body", "commentary_script"], msg: "String should have at least 20 characters", type: "string_too_short" },
    ];
    const message = normalizeApiErrorMessage(detail);
    expect(message).not.toContain("[object Object]");
    expect(message).toContain("original_hook");
    expect(message).toContain("String should have at least 5 characters");
  });

  it("returns plain string detail unchanged", () => {
    expect(normalizeApiErrorMessage("Gagal menyimpan")).toBe("Gagal menyimpan");
  });
});

describe("api error handling", () => {
  it("throws ApiError with readable message for 422 array detail (no [object Object])", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(422, { detail: [
        { loc: ["body", "original_hook"], msg: "String should have at least 5 characters", type: "string_too_short" },
      ] })),
    );
    await expect(api<unknown>("/api/transformations/1", { method: "PATCH", body: "{}" })).rejects.toMatchObject({
      status: 422,
      message: "original_hook: String should have at least 5 characters",
    });
    vi.unstubAllGlobals();
  });

  it("does not render [object Object] in the error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(422, { detail: [
        { loc: ["body", "commentary_script"], msg: "String should have at least 20 characters", type: "string_too_short" },
      ] })),
    );
    try {
      await api<unknown>("/api/transformations/1", { method: "PATCH", body: "{}" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(String((error as ApiError).message)).not.toContain("[object Object]");
    }
    vi.unstubAllGlobals();
  });
});
