from app.core.config import get_settings
from app.providers.transcription.groq import GroqTranscriptionProvider
from app.providers.transcription.mock import MockTranscriptionProvider
from app.providers.transcription.openai import OpenAITranscriptionProvider


def get_transcription_provider():
    provider = get_settings().transcription_provider
    if provider == "mock":
        return MockTranscriptionProvider()
    if provider == "faster-whisper":
        raise RuntimeError(
            "Provider faster-whisper belum terpasang. Instal extra 'whisper' dan model lokal."
        )
    if provider == "openai":
        return OpenAITranscriptionProvider()
    if provider == "groq":
        return GroqTranscriptionProvider()
    raise RuntimeError(f"Provider transkripsi tidak dikenal: {provider}")
