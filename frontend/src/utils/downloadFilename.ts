const INVALID_FILENAME_CHARS = /[<>:"/\\|?*]+/g;
const MAX_DOWNLOAD_FILENAME_LENGTH = 160;

export function sanitizeDownloadFilename(
  requested: string | undefined,
  ...fallbacks: Array<string | undefined>
): string {
  const value = [requested, ...fallbacks].find((candidate) => candidate?.trim())?.trim() || "XA AutoClip";
  let basename = value
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  if (basename.toLowerCase().endsWith(".mp4")) basename = basename.slice(0, -4).trim();
  basename = basename.slice(0, MAX_DOWNLOAD_FILENAME_LENGTH - 4).trim().replace(/\.+$/, "");
  return `${basename || "XA AutoClip"}.mp4`;
}
