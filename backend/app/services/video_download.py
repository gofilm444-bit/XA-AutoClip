import hashlib
import uuid
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.providers.storage.local import ALLOWED_EXTENSIONS, LocalStorageProvider
from app.services.source_metadata import is_youtube_url, validate_public_url


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download_page_video(
    project_id: uuid.UUID,
    url: str,
) -> tuple[Path, int, str, str, str]:
    validate_public_url(url)
    if not is_youtube_url(url):
        raise AppError(
            ErrorCode.UNSUPPORTED_FORMAT,
            "Saat ini link halaman yang didukung adalah YouTube. "
            "Untuk situs lain, gunakan link file MP4, MOV, atau WebM langsung.",
            422,
        )

    storage = LocalStorageProvider()
    download_id = str(uuid.uuid4())
    folder = storage.resolve(f"{project_id}/uploads")
    folder.mkdir(parents=True, exist_ok=True)
    output_template = str(folder / f"{download_id}.%(ext)s")
    settings = get_settings()
    options = {
        "format": (
            "bv*[height<=720][ext=mp4]+ba[ext=m4a]/"
            "b[height<=720][ext=mp4]/"
            "bv*[height<=720]+ba/b[height<=720]"
        ),
        "merge_output_format": "mp4",
        "outtmpl": output_template,
        "noplaylist": True,
        "max_filesize": settings.max_upload_size_bytes,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "quiet": True,
        "no_warnings": True,
    }
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
    except DownloadError as exc:
        for partial in folder.glob(f"{download_id}.*"):
            partial.unlink(missing_ok=True)
        raise AppError(
            ErrorCode.INVALID_VIDEO,
            "Video YouTube tidak dapat diunduh. Video mungkin privat, dibatasi wilayah, "
            "memerlukan login, atau tidak mengizinkan akses.",
            422,
        ) from exc

    files = [
        path
        for path in folder.glob(f"{download_id}.*")
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS
    ]
    if not files:
        raise AppError(
            ErrorCode.INVALID_VIDEO,
            "YouTube tidak menghasilkan file video yang dapat diproses.",
            422,
        )
    path = max(files, key=lambda item: item.stat().st_size)
    size = path.stat().st_size
    if size > settings.max_upload_size_bytes:
        path.unlink(missing_ok=True)
        raise AppError(ErrorCode.FILE_TOO_LARGE, "Ukuran video melebihi batas aplikasi.")

    title = str(info.get("title") or "video-youtube").strip()
    original_filename = f"{title[:280]}{path.suffix.lower()}"
    return path, size, _checksum(path), path.name, original_filename
