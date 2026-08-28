import math
from pathlib import Path

from app.providers.transcription.base import (
    TranscriptionResult,
    TranscriptionSegment,
)

SCRIPT = [
    "Banyak orang mengira video pendek cukup dibuat dengan memotong bagian yang ramai.",
    "Padahal konteks menentukan apakah penonton memahami alasan di balik sebuah pernyataan.",
    "Klip yang kuat biasanya punya gagasan lengkap, bukan hanya kalimat yang terdengar mengejutkan.",
    "Kreator juga perlu menambahkan analisis, pengalaman, atau perbandingan yang benar-benar baru.",
    "Dengan begitu sumber menjadi bukti, sementara nilai utama tetap datang dari kontribusi kreator.",
    "Sebelum menerbitkan, periksa kembali fakta, hak penggunaan sumber, dan kemiripan dengan karya lama.",
    "Penilaian otomatis hanya indikator awal sehingga keputusan akhir tetap membutuhkan tinjauan manusia.",
    "Pertanyaannya, bagian mana yang paling membantu audiens memahami topik ini dengan lebih baik?",
]
TARGET_SEGMENT_SECONDS = 8


class MockTranscriptionProvider:
    def transcribe(self, audio_path: Path, duration: float) -> TranscriptionResult:
        safe_duration = max(duration, 1.0)
        segment_count = max(1, math.ceil(safe_duration / TARGET_SEGMENT_SECONDS))
        segment_duration = safe_duration / segment_count
        segments = [
            TranscriptionSegment(
                start=round(index * segment_duration, 3),
                end=round(min((index + 1) * segment_duration, safe_duration), 3),
                text=SCRIPT[index % len(SCRIPT)],
                confidence=0.98,
            )
            for index in range(segment_count)
        ]
        return TranscriptionResult(
            detected_language="id",
            duration=safe_duration,
            segments=segments,
            provider_name="mock",
            model_name="deterministic-id-v1",
            text=" ".join(segment.text for segment in segments),
        )
