from app.services.clipper_style import (
    extract_keywords,
    safe_hook_text,
    sanitize_keyword_text,
    validate_effect_timeline,
)
from app.services.media import (
    _ffmpeg_text,
    _keyword_overlay_text,
)

PROBLEM_TEXT = (
    "Nah, APBD kita tuh, terus kita harus rapi-rapiin, cari efisiensi. "
    "Pendidikan-kesehatan gratis 100 hari. “Saya” bilang: 1,3 juta warga."
)
MOJIBAKE_TEXT = "é Â Ã � – — ’ “"


def test_keyword_and_hook_sanitizers_accept_indonesian_unicode_text():
    keywords = extract_keywords(PROBLEM_TEXT, MOJIBAKE_TEXT)

    assert keywords
    assert sanitize_keyword_text(PROBLEM_TEXT)
    assert safe_hook_text(PROBLEM_TEXT)


def test_invalid_keyword_events_are_skipped_without_throwing():
    events = [
        {
            "type": "keyword_popup",
            "start": 0,
            "end": 1.2,
            "text": MOJIBAKE_TEXT,
            "reason": "bad text",
        },
        {
            "type": "keyword_popup",
            "start": 2,
            "end": 3.2,
            "text": "APBD kita tuh",
            "reason": "valid text",
        },
    ]

    valid = validate_effect_timeline(events, 10)

    assert valid == [
        {
            "type": "keyword_popup",
            "start": 2,
            "end": 3.2,
            "reason": "valid text",
            "text": "APBD",
        }
    ]


def test_ffmpeg_text_escaping_handles_punctuation_and_mojibake():
    text = f"colon: comma, percent% quote' bracket[ok] slash\\ {MOJIBAKE_TEXT} {PROBLEM_TEXT}"
    escaped = _ffmpeg_text(text)

    assert "\\:" in escaped
    assert "\\," in escaped
    assert "\\%" in escaped
    assert "\\'" in escaped
    assert "\\[" in escaped
    assert "\\\\" in escaped
    assert "�" not in escaped


def test_keyword_overlay_text_skips_non_meaningful_mojibake():
    assert _keyword_overlay_text(MOJIBAKE_TEXT) == ""
