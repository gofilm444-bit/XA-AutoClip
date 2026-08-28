import json
from types import SimpleNamespace

from app.services.translation import normalize_language, translate_texts


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        translated = [
            {"index": 0, "text": "The attack comes from the right."},
            {"index": 1, "text": "It becomes a goal."},
        ]
        return {
            "output": [
                {
                    "content": [
                        {"type": "output_text", "text": json.dumps(translated)}
                    ]
                }
            ]
        }


def test_normalize_language_names():
    assert normalize_language("Indonesian") == "id"
    assert normalize_language("English") == "en"


def test_translate_texts_preserves_order(monkeypatch):
    events = []
    monkeypatch.setattr(
        "app.services.translation.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            translation_model="gpt-5.5",
        ),
    )
    monkeypatch.setattr(
        "app.services.translation.httpx.post",
        lambda *args, **kwargs: FakeResponse(),
    )
    monkeypatch.setattr(
        "app.services.translation.logger.info",
        lambda event, **fields: events.append((event, fields)),
    )

    result = translate_texts(
        ["Serangan datang dari kanan.", "Bola menjadi gol."],
        "en",
    )

    assert result == [
        "The attack comes from the right.",
        "It becomes a goal.",
    ]
    assert events[0][0] == "subtitle_translation_ai_call"
    assert events[1][1]["ai_call_type"] == "subtitle_translation"
    assert events[-1][0] == "ai_call_completed"
