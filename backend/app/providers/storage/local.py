import hashlib
import uuid
from collections.abc import Iterable
from pathlib import Path

from fastapi import UploadFile

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}
ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".webm"}
AUDIO_MIME_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/ogg",
    "audio/webm",
}
CHUNK_SIZE = 1024 * 1024


def stored_upload_name(extension: str) -> str:
    return f"{uuid.uuid4()}{extension}"


class LocalStorageProvider:
    def __init__(self) -> None:
        self.root = get_settings().storage_root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, relative_path: str) -> Path:
        candidate = (self.root / relative_path).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise AppError(ErrorCode.STORAGE_FAILED, "Path penyimpanan tidak valid.")
        return candidate

    async def save_upload(
        self, project_id: uuid.UUID, upload: UploadFile, kind: str = "uploads"
    ) -> tuple[Path, int, str, str]:
        original = Path(upload.filename or "video").name
        extension = Path(original).suffix.lower()
        mime_type = (upload.content_type or "").lower()
        is_audio = kind in {"voiceovers", "audio-library"}
        extensions = AUDIO_EXTENSIONS if is_audio else ALLOWED_EXTENSIONS
        mime_types = AUDIO_MIME_TYPES if is_audio else ALLOWED_MIME_TYPES
        if extension not in extensions or mime_type not in mime_types:
            raise AppError(ErrorCode.UNSUPPORTED_FORMAT, "Format media tidak didukung.")
        stored_name = stored_upload_name(extension)
        relative = f"{project_id}/{kind}/{stored_name}"
        destination = self.resolve(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        try:
            with destination.open("wb") as target:
                while chunk := await upload.read(CHUNK_SIZE):
                    size += len(chunk)
                    if size > get_settings().max_upload_size_bytes:
                        raise AppError(ErrorCode.FILE_TOO_LARGE, "Ukuran file melebihi batas.")
                    digest.update(chunk)
                    target.write(chunk)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()
        return destination, size, digest.hexdigest(), stored_name

    def save_video_chunks(
        self,
        project_id: uuid.UUID,
        chunks: Iterable[bytes],
        extension: str,
    ) -> tuple[Path, int, str, str]:
        extension = extension.lower()
        if extension not in ALLOWED_EXTENSIONS:
            raise AppError(ErrorCode.UNSUPPORTED_FORMAT, "Format media tidak didukung.")
        stored_name = stored_upload_name(extension)
        relative = f"{project_id}/uploads/{stored_name}"
        destination = self.resolve(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        try:
            with destination.open("wb") as target:
                for chunk in chunks:
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > get_settings().max_upload_size_bytes:
                        raise AppError(ErrorCode.FILE_TOO_LARGE, "Ukuran file melebihi batas.")
                    digest.update(chunk)
                    target.write(chunk)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        return destination, size, digest.hexdigest(), stored_name

    def delete_project(self, project_id: uuid.UUID) -> None:
        project_dir = self.resolve(str(project_id))
        if not project_dir.exists():
            return
        for child in sorted(project_dir.rglob("*"), reverse=True):
            if child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
        project_dir.rmdir()
