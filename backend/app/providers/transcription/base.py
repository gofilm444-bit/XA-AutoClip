from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class TranscriptionSegment:
    start: float
    end: float
    text: str
    confidence: float | None = None
    words: list[dict] | None = None


@dataclass(frozen=True)
class TranscriptionResult:
    detected_language: str
    duration: float
    segments: list[TranscriptionSegment]
    provider_name: str
    model_name: str
    text: str = ""


class TranscriptionProvider(Protocol):
    def transcribe(self, audio_path: Path, duration: float) -> TranscriptionResult: ...

