import pytest

from app.core.errors import AppError
from app.services.render_result import verify_render_file_binding


def test_completed_final_render_must_use_exports_folder(tmp_path):
    source = tmp_path / "clips" / "candidate.mp4"
    source.parent.mkdir()
    source.write_bytes(b"source")
    output = tmp_path / "exports" / "render.mp4"
    output.parent.mkdir()
    output.write_bytes(b"render")

    assert verify_render_file_binding(
        output,
        preview=False,
        forbidden_source_paths=(source,),
    ) == output.resolve()


def test_completed_render_cannot_point_to_candidate_source(tmp_path):
    source = tmp_path / "clips" / "candidate.mp4"
    source.parent.mkdir()
    source.write_bytes(b"source")

    with pytest.raises(AppError, match="source/candidate"):
        verify_render_file_binding(
            source,
            preview=False,
            forbidden_source_paths=(source,),
        )


def test_completed_render_requires_existing_output_file(tmp_path):
    missing = tmp_path / "previews" / "missing.mp4"

    with pytest.raises(AppError, match="tidak tersedia"):
        verify_render_file_binding(missing, preview=True)
