import { describe, expect, it } from "vitest";
import { sanitizeDownloadFilename } from "./downloadFilename";

describe("sanitizeDownloadFilename", () => {
  it("keeps a valid mp4 filename without duplicating the extension", () => {
    expect(sanitizeDownloadFilename("PBB Pernah Terjunkan Puluhan Kucing ke Kalimantan.mp4"))
      .toBe("PBB Pernah Terjunkan Puluhan Kucing ke Kalimantan.mp4");
  });

  it("replaces unsafe characters and uses mp4", () => {
    expect(sanitizeDownloadFilename("Tes Export: Caption/Voice?"))
      .toBe("Tes Export Caption Voice.mp4");
  });

  it("falls back when the requested name is empty", () => {
    expect(sanitizeDownloadFilename("  ", "Judul Transformasi"))
      .toBe("Judul Transformasi.mp4");
  });
});
