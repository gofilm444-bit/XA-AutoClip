from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    app_name: str = "AutoClip Transform"
    database_url: str = "sqlite:///./autoclip.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_root: Path = Path("./storage")
    max_upload_size_bytes: int = 2_147_483_648
    max_video_duration_seconds: float = 7_200
    job_timeout_seconds: int = 3_600
    processing_stale_timeout_minutes: int = 10
    ai_provider: str = "mock"
    ai_model: str = ""
    title_model: str = "gpt-5.5"
    title_hook_ai_enabled: bool = False
    openai_api_key: str = ""
    youtube_api_key: str = ""
    transcription_provider: str = "mock"
    transcription_model: str = "whisper-1"
    groq_api_key: str = ""
    groq_transcription_model: str = "whisper-large-v3-turbo"
    groq_transcription_base_url: str = "https://api.groq.com/openai/v1"
    translation_model: str = "gpt-5.5"
    cors_origins: str = "http://localhost:3000"
    media_retention_days: int = 30
    max_saved_top_clips: int = 5
    keep_original_video: bool = False
    temp_retention_hours: int = 24
    auto_delete_temp_files: bool = True
    originality_min_contribution_ratio: float = 0.55
    originality_max_source_ratio: float = 0.45
    originality_max_uninterrupted_source_seconds: float = 10
    originality_min_commentary_word_ratio: float = 0.35
    repetition_similarity_threshold: float = 0.75
    celery_task_always_eager: bool = False
    preview_width: int = 540
    preview_height: int = 960
    final_width: int = 1080
    final_height: int = 1920

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
