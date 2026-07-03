import subprocess
import tempfile
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode
from app.providers.transcription.base import (
    TranscriptionResult,
    TranscriptionSegment,
)

MAX_AUDIO_BYTES = 25 * 1024 * 1024
CHUNK_SECONDS = 20 * 60
TRANSCODE_BITRATE = "32k"


class OpenAITranscriptionProvider:
    def transcribe(self, audio_path: Path, duration: float) -> TranscriptionResult:
        settings = get_settings()
        if not settings.openai_api_key:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "OPENAI_API_KEY belum diisi untuk speech-to-text asli.",
            )

        model = settings.transcription_model or "whisper-1"
        with tempfile.TemporaryDirectory() as temp_dir:
            prepared_files = _prepare_audio_files(audio_path, duration, Path(temp_dir))
            payloads = [
                _transcribe_file(path, model, settings.openai_api_key, offset)
                for path, offset in prepared_files
            ]

        segments: list[TranscriptionSegment] = []
        detected_language = "unknown"
        reported_duration = duration
        for payload in payloads:
            if detected_language == "unknown" and payload.get("language"):
                detected_language = str(payload["language"])
            if payload.get("duration"):
                reported_duration = max(reported_duration, float(payload["duration"]))
            segments.extend(
                TranscriptionSegment(
                    start=float(segment["start"]),
                    end=float(segment["end"]),
                    text=str(segment.get("text", "")).strip(),
                )
                for segment in payload.get("segments", [])
                if segment.get("text") and float(segment["end"]) > float(segment["start"])
            )

        segments.sort(key=lambda segment: (segment.start, segment.end))
        if not segments:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Tidak ada ucapan yang berhasil ditranskripsikan dari audio.",
            )
        return TranscriptionResult(
            detected_language=detected_language,
            duration=reported_duration,
            segments=segments,
            provider_name="openai",
            model_name=model,
        )


def _prepare_audio_files(audio_path: Path, duration: float, temp_dir: Path) -> list[tuple[Path, float]]:
    if audio_path.stat().st_size <= MAX_AUDIO_BYTES:
        return [(audio_path, 0.0)]

    compressed = temp_dir / "audio.mp3"
    _transcode_for_openai(audio_path, compressed)
    if compressed.stat().st_size <= MAX_AUDIO_BYTES:
        return [(compressed, 0.0)]

    prepared: list[tuple[Path, float]] = []
    start = 0.0
    index = 0
    while start < duration:
        chunk_duration = min(CHUNK_SECONDS, duration - start)
        chunk_path = temp_dir / f"audio_{index:04d}.mp3"
        _transcode_for_openai(audio_path, chunk_path, start=start, duration=chunk_duration)
        if chunk_path.stat().st_size > MAX_AUDIO_BYTES:
            raise AppError(
                ErrorCode.TRANSCRIPTION_FAILED,
                "Audio terlalu besar untuk diproses per bagian. Gunakan video lebih pendek.",
            )
        prepared.append((chunk_path, start))
        start += chunk_duration
        index += 1
    return prepared


def _transcode_for_openai(
    source: Path,
    destination: Path,
    start: float | None = None,
    duration: float | None = None,
) -> None:
    command = ["ffmpeg", "-y"]
    if start is not None:
        command.extend(["-ss", str(start)])
    command.extend(["-i", str(source)])
    if duration is not None:
        command.extend(["-t", str(duration)])
    command.extend(
        [
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            TRANSCODE_BITRATE,
            str(destination),
        ]
    )
    try:
        subprocess.run(command, check=True, capture_output=True, text=True, timeout=300)
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise AppError(
            ErrorCode.TRANSCRIPTION_FAILED,
            "Gagal menyiapkan audio agar sesuai batas provider speech-to-text.",
        ) from exc


def _transcribe_file(
    audio_path: Path,
    model: str,
    api_key: str,
    offset: float,
) -> dict:
    mime_type = "audio/mpeg" if audio_path.suffix.lower() == ".mp3" else "audio/wav"
    try:
        with audio_path.open("rb") as audio:
            response = httpx.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                files={"file": (audio_path.name, audio, mime_type)},
                data={
                    "model": model,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "segment",
                },
                timeout=300,
            )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError, OSError) as exc:
        raise AppError(
            ErrorCode.TRANSCRIPTION_FAILED,
            "Speech-to-text OpenAI gagal. Periksa API key, koneksi, dan format audio.",
        ) from exc

    if offset:
        for segment in payload.get("segments", []):
            segment["start"] = float(segment["start"]) + offset
            segment["end"] = float(segment["end"]) + offset
    return payload
