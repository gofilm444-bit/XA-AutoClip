const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message || body.detail || "Terjadi kesalahan saat menghubungi server.",
      body.error_code,
    );
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
        reject(
          new ApiError(
            xhr.status,
            body.message || body.detail || `Upload gagal (HTTP ${xhr.status}).`,
            body.error_code,
          ),
        );
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
