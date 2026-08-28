from app.services.download_filename import sanitize_download_filename


def test_download_filename_preserves_mp4_extension_once():
    assert sanitize_download_filename("PBB Pernah Terjunkan Puluhan Kucing ke Kalimantan.mp4") == (
        "PBB Pernah Terjunkan Puluhan Kucing ke Kalimantan.mp4"
    )


def test_download_filename_replaces_platform_unsafe_characters():
    assert sanitize_download_filename("Tes Export: Caption/Voice?") == "Tes Export Caption Voice.mp4"


def test_download_filename_falls_back_to_first_non_empty_value():
    assert sanitize_download_filename("  ", "Judul Transformasi", "XA AutoClip") == "Judul Transformasi.mp4"


def test_download_filename_limits_basename_length():
    filename = sanitize_download_filename("x" * 300)

    assert len(filename) == 160
    assert filename.endswith(".mp4")
