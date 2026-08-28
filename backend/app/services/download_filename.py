import re
from pathlib import Path

MAX_DOWNLOAD_FILENAME_LENGTH = 160
_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*]+')


def sanitize_download_filename(
    requested: str | None,
    *fallbacks: str | None,
) -> str:
    value = next((str(candidate).strip() for candidate in (requested, *fallbacks) if candidate and str(candidate).strip()), "XA AutoClip")
    value = _INVALID_FILENAME_CHARS.sub(" ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if value.lower().endswith(".mp4"):
        value = value[:-4].rstrip(" .")
    value = value[: MAX_DOWNLOAD_FILENAME_LENGTH - 4].rstrip(" .")
    return f"{value or 'XA AutoClip'}.mp4"


def filename_from_path(path: str | None) -> str | None:
    return Path(path).stem if path else None
