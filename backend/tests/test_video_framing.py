import subprocess

import pytest

from app.services.clipper_style import normalize_clipper_style, normalize_video_framing
from app.services.media import (
    AudioMixSource,
    _blurred_background_filter_graph,
    _center_crop_filter_chain,
    probe_audio_duration,
    probe_media,
    render_clean_vertical,
    render_vertical,
)


def test_video_framing_defaults_and_clamps_invalid_values():
    assert normalize_video_framing(None) == {"x": 0.0, "y": 0.0, "scale": 1.0}
    assert normalize_video_framing({"x": 90, "y": -90, "scale": 8}) == {
        "x": 40.0,
        "y": -40.0,
        "scale": 2.0,
    }
    assert normalize_video_framing({"x": "bad", "y": float("nan"), "scale": None}) == {
        "x": 0.0,
        "y": 0.0,
        "scale": 1.0,
    }


def test_clipper_style_preserves_normalized_video_framing():
    normalized = normalize_clipper_style(
        {"video_framing": {"x": 12.5, "y": -7.5, "scale": 1.25}}
    )

    assert normalized["video_framing"] == {"x": 12.5, "y": -7.5, "scale": 1.25}


def test_center_crop_filter_applies_zoom_and_safe_crop_offsets():
    default_filter = _center_crop_filter_chain(540, 960, None)
    framed_filter = _center_crop_filter_chain(
        540,
        960,
        {"video_framing": {"x": 40, "y": -40, "scale": 1.5}},
    )

    assert "scale=540:960:force_original_aspect_ratio=increase" in default_filter
    assert "(iw-540)*0.500000:(ih-960)*0.500000" in default_filter
    assert "scale=810:1440:force_original_aspect_ratio=increase" in framed_filter
    assert "(iw-540)*0.000000:(ih-960)*1.000000" in framed_filter


def test_blurred_background_keeps_background_and_frames_foreground():
    graph = _blurred_background_filter_graph(
        720,
        1280,
        {"video_framing": {"x": 10, "y": -20, "scale": 1.25}},
    )

    assert "[bg]scale=720:1280:force_original_aspect_ratio=increase" in graph
    assert "boxblur=20[blur]" in graph
    assert "scale=trunc(iw*1.250000/2)*2:trunc(ih*1.250000/2)*2[front]" in graph
    assert "overlay=(W-w)/2+w*0.100000:(H-h)/2+h*-0.200000" in graph


@pytest.mark.parametrize("preset", ["center_crop", "blurred_background"])
def test_framed_layout_renders_valid_video_and_audio(tmp_path, preset):
    source = tmp_path / "source.mp4"
    destination = tmp_path / f"{preset}.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=44100",
            "-t",
            "0.8",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    render_vertical(
        source,
        destination,
        start=0,
        duration=0.6,
        width=540,
        height=960,
        preset=preset,
        style_config={"video_framing": {"x": 15, "y": -10, "scale": 1.3}},
    )

    metadata = probe_media(destination)
    assert (metadata.width, metadata.height) == (540, 960)
    assert metadata.has_audio is True
    assert metadata.duration >= 0.5


def test_clean_blurred_fallback_keeps_framing_and_audio(tmp_path):
    source = tmp_path / "source.mp4"
    destination = tmp_path / "clean-blurred.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=44100",
            "-t",
            "0.8",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    render_clean_vertical(
        source,
        destination,
        start=0,
        duration=0.6,
        width=180,
        height=320,
        preset="blurred_background",
        style_config={"video_framing": {"x": -20, "y": 10, "scale": 1.2}},
    )

    metadata = probe_media(destination)
    assert (metadata.width, metadata.height) == (180, 320)
    assert metadata.has_audio is True
    assert metadata.duration >= 0.5


def test_audio_mix_keeps_voiceover_inside_video_master_duration(tmp_path):
    source = tmp_path / "source.mp4"
    voiceover = tmp_path / "voiceover.wav"
    destination = tmp_path / "mixed.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=44100",
            "-t",
            "0.8",
            "-shortest",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100",
            "-t",
            "0.5",
            "-c:a",
            "pcm_s16le",
            str(voiceover),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    render_vertical(
        source,
        destination,
        start=0,
        duration=0.6,
        width=540,
        height=960,
        preset="center_crop",
        audio_mix_sources=[AudioMixSource(voiceover, start=0.2, end=0.6, volume=0.5)],
    )

    metadata = probe_media(destination)
    audio_duration = probe_audio_duration(destination)
    assert metadata.has_audio is True
    assert abs(metadata.duration - audio_duration) < 0.08
    assert metadata.duration <= 0.68
