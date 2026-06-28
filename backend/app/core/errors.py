from enum import StrEnum


class ErrorCode(StrEnum):
    INVALID_VIDEO = "INVALID_VIDEO"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    VIDEO_TOO_LONG = "VIDEO_TOO_LONG"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    MEDIA_PROBE_FAILED = "MEDIA_PROBE_FAILED"
    AUDIO_EXTRACTION_FAILED = "AUDIO_EXTRACTION_FAILED"
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED"
    AI_PROVIDER_FAILED = "AI_PROVIDER_FAILED"
    INVALID_TIMESTAMPS = "INVALID_TIMESTAMPS"
    ORIGINALITY_REQUIREMENTS_NOT_MET = "ORIGINALITY_REQUIREMENTS_NOT_MET"
    RENDER_FAILED = "RENDER_FAILED"
    STORAGE_FAILED = "STORAGE_FAILED"
    JOB_TIMEOUT = "JOB_TIMEOUT"


class AppError(Exception):
    def __init__(self, code: ErrorCode, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)

