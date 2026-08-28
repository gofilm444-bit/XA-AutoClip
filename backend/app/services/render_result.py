from collections.abc import Iterable
from pathlib import Path

from app.core.errors import AppError, ErrorCode


def same_file_path(first: Path | str, second: Path | str) -> bool:
    return Path(first).resolve(strict=False) == Path(second).resolve(strict=False)


def verify_render_file_binding(
    output_path: Path | str | None,
    *,
    preview: bool,
    forbidden_source_paths: Iterable[Path | str | None] = (),
    require_file: bool = True,
) -> Path:
    if not output_path:
        raise AppError(ErrorCode.RENDER_FAILED, "Render selesai tanpa path file output.", 409)

    resolved = Path(output_path).resolve(strict=False)
    for source_path in forbidden_source_paths:
        if source_path and same_file_path(resolved, source_path):
            raise AppError(
                ErrorCode.RENDER_FAILED,
                "Path output render sama dengan source/candidate input.",
                409,
            )

    expected_folder = "previews" if preview else "exports"
    if expected_folder not in resolved.parts:
        raise AppError(
            ErrorCode.RENDER_FAILED,
            f"Path render tidak berada di folder {expected_folder}.",
            409,
        )

    if require_file and (not resolved.is_file() or resolved.stat().st_size <= 0):
        raise AppError(ErrorCode.RENDER_FAILED, "File output render tidak tersedia.", 409)
    return resolved
