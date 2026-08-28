const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

type FastApiValidationError = {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
};

export function normalizeApiErrorMessage(detail: unknown): string {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const error = item as FastApiValidationError;
          const fieldPath = (error.loc ?? [])
            .filter((part) => typeof part === "string" && part !== "body")
            .join(".");
          const reason = error.msg ?? "Nilai tidak valid";
          return fieldPath ? `${fieldPath}: ${reason}` : reason;
        }
        if (typeof item === "string") return item;
        return JSON.stringify(item);
      })
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    const error = detail as FastApiValidationError;
    return error.msg ?? "Nilai tidak valid";
  }
  return "Terjadi kesalahan saat menghubungi server.";
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const rawDetail = (body && (body.message ?? body.detail)) ?? null;
    const message =
      typeof rawDetail === "string" && rawDetail
        ? rawDetail
        : normalizeApiErrorMessage(rawDetail || "Terjadi kesalahan saat menghubungi server.");
    throw new ApiError(response.status, message, body?.error_code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function upload<T>(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body: Record<string, string> = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const rawDetail = (body && (body.message ?? body.detail)) ?? null;
        const message =
          typeof rawDetail === "string" && rawDetail
            ? rawDetail
            : normalizeApiErrorMessage(rawDetail || `Upload gagal (HTTP ${xhr.status}).`);
        reject(new ApiError(xhr.status, message, body?.error_code));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Koneksi terputus saat upload."));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export const downloadUrl = (renderId: string) =>
  `${API_URL}/api/renders/${renderId}/download`;

export const sourceVideoUrl = (projectId: string) =>
  `${API_URL}/api/projects/${projectId}/source-file`;

export const candidateVideoUrl = (candidateId: string) =>
  `${API_URL}/api/candidates/${candidateId}/source-file`;

export const candidateThumbnailUrl = (candidateId: string) =>
  `${API_URL}/api/candidates/${candidateId}/thumbnail`;

export const uploadedAudioUrl = (transformationId: string, assetId: string) =>
  `${API_URL}/api/transformations/${transformationId}/audio-assets/${assetId}`;

export const mediaUrl = (transformationId: string, assetId: string) =>
  `${API_URL}/api/transformations/${transformationId}/media/${assetId}`;

export function uploadMedia<T>(
  path: string,
  file: File,
  kind: "video" | "audio" | "image",
  onProgress?: (progress: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const rawDetail = (body && (body.message ?? body.detail)) ?? null;
        const message =
          typeof rawDetail === "string" && rawDetail
            ? rawDetail
            : normalizeApiErrorMessage(rawDetail || `Upload gagal (HTTP ${xhr.status}).`);
        reject(new ApiError(xhr.status, message, body?.error_code as string | undefined));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Koneksi terputus saat upload."));
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    xhr.send(form);
  });
}
