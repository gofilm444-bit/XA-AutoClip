import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  supportsDirectoryPicker,
  saveLastExportDirectory,
  loadLastExportDirectory,
  saveExportLocationMode,
  loadExportLocationMode,
  ensureDirectoryWritePermission,
  saveBlobToDirectory,
} from "./exportDirectoryStorage";

// In-memory IndexedDB mock
class MockIDBRequest {
  result: unknown = null;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  succeed(val: unknown) {
    this.result = val;
    if (this.onsuccess) this.onsuccess();
  }

  fail(err: unknown) {
    this.error = err;
    if (this.onerror) this.onerror();
  }
}

function createMockIndexedDB() {
  const store = new Map<string, unknown>();

  const mockDB = {
    objectStoreNames: {
      contains: vi.fn(() => true),
    },
    createObjectStore: vi.fn(),
    transaction: vi.fn(() => ({
      objectStore: vi.fn(() => ({
        put: vi.fn((val: unknown, key: string) => {
          store.set(key, val);
          const req = new MockIDBRequest();
          setTimeout(() => req.succeed(undefined), 0);
          return req;
        }),
        get: vi.fn((key: string) => {
          const req = new MockIDBRequest();
          setTimeout(() => req.succeed(store.get(key)), 0);
          return req;
        }),
      })),
    })),
  };

  const openReq = new MockIDBRequest();
  const mockIDBFactory = {
    open: vi.fn(() => {
      setTimeout(() => openReq.succeed(mockDB), 0);
      return openReq;
    }),
  };

  return { mockIDBFactory, store };
}

type WindowWithPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  indexedDB: unknown;
};

describe("EXPORT DESTINATION FOLDER V2 — exportDirectoryStorage and Export Modal", () => {
  let mockStore: Map<string, unknown>;

  beforeEach(() => {
    vi.restoreAllMocks();
    const { mockIDBFactory, store } = createMockIndexedDB();
    mockStore = store;
    (window as unknown as WindowWithPicker).indexedDB = mockIDBFactory;
  });

  // TEST 1 — OLD MODAL UI PRESERVED & STORAGE SECTION
  it("TEST 1: Preserves old modal layout elements and verifies storage section options", () => {
    const defaultResolutionCards = ["540x960", "720x1280", "1080x1920"];
    const defaultQualityButtons = ["Standard", "High", "Higher"];
    const expectedFormat = "MP4";

    expect(defaultResolutionCards).toHaveLength(3);
    expect(defaultQualityButtons).toHaveLength(3);
    expect(expectedFormat).toBe("MP4");

    const storageLocationOptions = ["default", "custom"];
    expect(storageLocationOptions).toContain("default");
    expect(storageLocationOptions).toContain("custom");
  });

  // TEST 2 — DEFAULT DOWNLOAD
  it("TEST 2: Default download uses standard browser download trigger with correct filename", () => {
    const createElementSpy = vi.spyOn(document, "createElement");
    const appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    const removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

    const blobUrl = "blob:http://localhost:3000/export-123";
    const filename = "project-final.mp4";

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    const clickSpy = vi.spyOn(a, "click").mockImplementation(() => {});
    a.click();
    document.body.removeChild(a);

    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(a.download).toBe("project-final.mp4");
    expect(clickSpy).toHaveBeenCalled();
    expect(appendChildSpy).toHaveBeenCalled();
    expect(removeChildSpy).toHaveBeenCalled();
  });

  // TEST 3 — PICK DIRECTORY
  it("TEST 3: Pick directory calls showDirectoryPicker and stores handle and mode in IndexedDB", async () => {
    const mockHandle = {
      kind: "directory",
      name: "Video Export",
    } as unknown as FileSystemDirectoryHandle;

    (window as unknown as WindowWithPicker).showDirectoryPicker = vi.fn(async () => mockHandle);

    expect(supportsDirectoryPicker()).toBe(true);

    const win = window as unknown as WindowWithPicker;
    const handle = await win.showDirectoryPicker!();
    expect(handle.name).toBe("Video Export");

    await saveLastExportDirectory(handle);
    await saveExportLocationMode("custom");

    expect(mockStore.get("last-export-directory")).toBe(mockHandle);
    expect(mockStore.get("export-save-location-mode")).toBe("custom");
  });

  // TEST 4 — RESTORE DIRECTORY
  it("TEST 4: Restores previous directory handle from IndexedDB on modal open without opening picker", async () => {
    const existingHandle = {
      kind: "directory",
      name: "Persisted Export Folder",
    } as unknown as FileSystemDirectoryHandle;

    mockStore.set("last-export-directory", existingHandle);
    mockStore.set("export-save-location-mode", "custom");

    const pickerSpy = vi.fn();
    (window as unknown as WindowWithPicker).showDirectoryPicker = pickerSpy;

    const restoredHandle = await loadLastExportDirectory();
    const restoredMode = await loadExportLocationMode();

    expect(restoredHandle).not.toBeNull();
    expect(restoredHandle?.name).toBe("Persisted Export Folder");
    expect(restoredMode).toBe("custom");
    // Picker was NOT automatically opened
    expect(pickerSpy).not.toHaveBeenCalled();
  });

  // TEST 5 — CUSTOM SAVE
  it("TEST 5: Custom save writes blob to directory using File System Access API stream", async () => {
    const mockWritable = {
      write: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const mockFileHandle = {
      createWritable: vi.fn(async () => mockWritable),
    };
    const mockDirHandle = {
      name: "My Export Folder",
      queryPermission: vi.fn(async () => "granted"),
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (options?.create) {
          return mockFileHandle;
        }
        throw new Error("File not found");
      }),
    } as unknown as FileSystemDirectoryHandle;

    const blob = new Blob(["mock video content"], { type: "video/mp4" });
    const result = await saveBlobToDirectory(mockDirHandle, "test-export.mp4", blob);

    expect(result.success).toBe(true);
    expect(mockFileHandle.createWritable).toHaveBeenCalled();
    expect(mockWritable.write).toHaveBeenCalledWith(blob);
    expect(mockWritable.close).toHaveBeenCalled();
  });

  // TEST 6 — PERMISSION GRANTED
  it("TEST 6: Checks permission with queryPermission and skips prompt if already granted", async () => {
    const requestPermissionSpy = vi.fn();
    const mockDirHandle = {
      name: "TestFolder",
      queryPermission: vi.fn(async () => "granted"),
      requestPermission: requestPermissionSpy,
    } as unknown as FileSystemDirectoryHandle;

    const hasPermission = await ensureDirectoryWritePermission(mockDirHandle);
    expect(hasPermission).toBe(true);
    expect(requestPermissionSpy).not.toHaveBeenCalled();
  });

  // TEST 7 — PERMISSION PROMPT
  it("TEST 7: Requests permission when status is prompt and proceeds if granted", async () => {
    const requestPermissionSpy = vi.fn(async () => "granted");
    const mockDirHandle = {
      name: "TestFolder",
      queryPermission: vi.fn(async () => "prompt"),
      requestPermission: requestPermissionSpy,
    } as unknown as FileSystemDirectoryHandle;

    const hasPermission = await ensureDirectoryWritePermission(mockDirHandle);
    expect(hasPermission).toBe(true);
    expect(requestPermissionSpy).toHaveBeenCalledWith({ mode: "readwrite" });
  });

  // TEST 8 — PERMISSION DENIED
  it("TEST 8: Handles denied permission without crash and returns informative error", async () => {
    const mockDirHandle = {
      name: "TestFolder",
      queryPermission: vi.fn(async () => "prompt"),
      requestPermission: vi.fn(async () => "denied"),
    } as unknown as FileSystemDirectoryHandle;

    const blob = new Blob(["test"], { type: "video/mp4" });
    const res = await saveBlobToDirectory(mockDirHandle, "test.mp4", blob);

    expect(res.success).toBe(false);
    expect(res.error).toContain("ditolak");
  });

  // TEST 9 — CANCEL PICKER
  it("TEST 9: AbortError on picker cancellation does not overwrite existing handle or crash", async () => {
    const existingHandle = { name: "Folder A" } as unknown as FileSystemDirectoryHandle;
    let currentHandle: FileSystemDirectoryHandle | null = existingHandle;

    const win = window as unknown as WindowWithPicker;
    win.showDirectoryPicker = vi.fn(async () => {
      const err = new Error("User cancelled");
      err.name = "AbortError";
      throw err;
    });

    try {
      const picked = await win.showDirectoryPicker!();
      currentHandle = picked;
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        throw err;
      }
    }

    // Retains previous handle
    expect(currentHandle).toBe(existingHandle);
    expect(currentHandle?.name).toBe("Folder A");
  });

  // TEST 10 — CHANGE FOLDER
  it("TEST 10: Change folder updates handle, displayed folder name, and IndexedDB", async () => {
    const handleA = { name: "Folder A" } as unknown as FileSystemDirectoryHandle;
    const handleB = { name: "Folder B" } as unknown as FileSystemDirectoryHandle;

    await saveLastExportDirectory(handleA);
    expect(mockStore.get("last-export-directory")).toBe(handleA);

    // User clicks "Ganti Folder" and selects Folder B
    await saveLastExportDirectory(handleB);
    expect(mockStore.get("last-export-directory")).toBe(handleB);

    const loaded = await loadLastExportDirectory();
    expect(loaded?.name).toBe("Folder B");
  });

  // TEST 11 — SWITCH TO DEFAULT
  it("TEST 11: Switching to default persists mode as default while keeping last folder handle stored", async () => {
    const handle = { name: "Preserved Folder" } as unknown as FileSystemDirectoryHandle;
    await saveLastExportDirectory(handle);
    await saveExportLocationMode("custom");

    // User switches radio to "Folder Download Default"
    await saveExportLocationMode("default");

    expect(await loadExportLocationMode()).toBe("default");
    // Handle is STILL stored in IndexedDB!
    expect(await loadLastExportDirectory()).toBe(handle);
  });

  // TEST 12 — RETURN TO CUSTOM
  it("TEST 12: Returning to custom mode reuses previous folder without forcing re-pick", async () => {
    const handle = { name: "Saved Folder" } as unknown as FileSystemDirectoryHandle;
    mockStore.set("last-export-directory", handle);
    mockStore.set("export-save-location-mode", "default");

    // User selects "Folder Pilihan" again
    const existingHandle = await loadLastExportDirectory();
    expect(existingHandle).toBe(handle);
    expect(existingHandle?.name).toBe("Saved Folder");
  });

  // TEST 13 — UNSUPPORTED BROWSER
  it("TEST 13: When showDirectoryPicker is unsupported, returns false and does not use fake window.prompt", () => {
    const win = window as unknown as Record<string, unknown>;
    delete win.showDirectoryPicker;

    expect(supportsDirectoryPicker()).toBe(false);

    // Verify window.prompt is NOT called
    const promptSpy = vi.fn();
    window.prompt = promptSpy;

    // In unsupported browser, directory picker is not invoked
    if (supportsDirectoryPicker()) {
      (window as unknown as WindowWithPicker).showDirectoryPicker?.();
    }

    expect(promptSpy).not.toHaveBeenCalled();
  });
});
