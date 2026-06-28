from app.core.config import get_settings
from app.providers.ai.mock import MockAIProvider


def get_ai_provider():
    provider = get_settings().ai_provider
    if provider == "mock":
        return MockAIProvider()
    if provider == "openai":
        raise RuntimeError(
            "Provider OpenAI belum dikonfigurasi. Pilih provider mock atau isi kredensial."
        )
    raise RuntimeError(f"Provider AI tidak dikenal: {provider}")

