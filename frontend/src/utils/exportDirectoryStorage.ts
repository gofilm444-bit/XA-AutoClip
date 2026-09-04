/**
 * exportDirectoryStorage.ts
 *
 * Isolated IndexedDB storage utility for persisting the user's chosen export directory handle
 * across browser reloads and sessions using the File System Access API.
 */

const DB_NAME = "xa-autoclip";
const DB_VERSION = 1;
const STORE_NAME = "export-preferences";
const KEY_LAST_DIRECTORY = "last-export-directory";
const KEY_SAVE_LOCATION_MODE = "export-save-location-mode";

export type ExportSaveLocationMode = "default" | "custom";

/**
 * Checks if the browser supports the native directory picker (File System Access API).
 */
export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window &&
    typeof (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker === "function"
  );
}

/**
 * Opens or initializes the IndexedDB database.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB is not supported in this environment"));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists the selected FileSystemDirectoryHandle into IndexedDB.
 */
export async function saveLastExportDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(handle, KEY_LAST_DIRECTORY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[exportDirectoryStorage] saveLastExportDirectory error:", err);
  }
}

/**
 * Loads the last persisted FileSystemDirectoryHandle from IndexedDB.
 */
export async function loadLastExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_LAST_DIRECTORY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Persists the active save location mode ("default" | "custom").
 */
export async function saveExportLocationMode(mode: ExportSaveLocationMode): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(mode, KEY_SAVE_LOCATION_MODE);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[exportDirectoryStorage] saveExportLocationMode error:", err);
  }
}

/**
 * Loads the persisted save location mode ("default" | "custom").
 */
export async function loadExportLocationMode(): Promise<ExportSaveLocationMode | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_SAVE_LOCATION_MODE);
      req.onsuccess = () => resolve((req.result as ExportSaveLocationMode) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Verifies and requests readwrite permission on the directory handle if needed.
 */
export async function ensureDirectoryWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const options = { mode: "readwrite" as const };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryFn = (handle as any).queryPermission;
    if (typeof queryFn === "function") {
      const status = await queryFn.call(handle, options);
      if (status === "granted") return true;
      if (status === "denied") return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestFn = (handle as any).requestPermission;
    if (typeof requestFn === "function") {
      const reqStatus = await requestFn.call(handle, options);
      return reqStatus === "granted";
    }
    return true;
  } catch (err) {
    console.warn("[exportDirectoryStorage] Permission check error:", err);
    return false;
  }
}

/**
 * Saves a Blob directly to the specified directory handle.
 * Prompts user confirmation if a file with the same name already exists.
 */
export async function saveBlobToDirectory(
  handle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<{ success: boolean; error?: string; cancelled?: boolean }> {
  try {
    const hasPermission = await ensureDirectoryWritePermission(handle);
    if (!hasPermission) {
      return { success: false, error: "Izin akses menulis ke folder ditolak oleh pengguna." };
    }

    // Check if target file already exists
    let fileExists = false;
    try {
      await handle.getFileHandle(filename, { create: false });
      fileExists = true;
    } catch {
      fileExists = false;
    }

    if (fileExists) {
      const confirmOverwrite = window.confirm(
        `File '${filename}' sudah ada di folder '${handle.name}'. Timpa?`,
      );
      if (!confirmOverwrite) {
        return { success: false, cancelled: true, error: "Penyimpanan dibatalkan oleh pengguna (file sudah ada)." };
      }
    }

    const fileHandle = await handle.getFileHandle(filename, { create: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writable = await (fileHandle as any).createWritable();
    await writable.write(blob);
    await writable.close();
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
