import json
from types import SimpleNamespace

from app.services.titles import generate_candidate_copy, generate_candidate_title


def test_sports_title_uses_transcript_event():
    title = generate_candidate_title(
        "sports",
        "[02:54] The shot is in!\n[03:07] Korea's equalizer!",
        1,
        use_ai=False,
    )

    assert title == "Gol Penyeimbang Ini Mengubah Jalannya Pertandingan!"


def test_sports_title_has_useful_fallback():
    title = generate_candidate_title(
        "sports",
        "[00:12] What a moment.",
        2,
        use_ai=False,
    )

    assert title == "Detail Sebelum Kejadian Ini Mengubah Pertandingan #2"


def test_podcast_title_uses_first_statement():
    title = generate_candidate_title(
        "podcast",
        "[00:16] Kreator perlu memahami konteks sebelum memotong video.",
        1,
        use_ai=False,
    )

    assert title.startswith("Kenapa kreator perlu memahami konteks")


def test_sports_title_uses_player_and_historic_fact():
    title = generate_candidate_title(
        "sports",
        (
            "[08:52] This is Reina.\n"
            "[08:54] Oh yes! Gio Reina!\n"
            "[09:03] Goal!\n"
            "[09:12] History for the USA! For the first time they score four goals "
            "in a World Cup match."
        ),
        1,
        "Amerika Serikat 4 - 1 Paraguay",
        use_ai=False,
    )

    assert title == "Gio Reyna Cetak Gol Keempat, Amerika Serikat Ukir Sejarah!"


class FakeTitleResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "output": [
                {
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(
                                {
                                    "title": (
                                        "Gio Reyna Cetak Gol Keempat, AS Ukir Sejarah!"
                                    ),
                                    "hook": (
                                        "Satu penyelesaian mengubah kemenangan besar "
                                        "menjadi rekor baru Amerika Serikat."
                                    ),
                                }
                            ),
                        }
                    ]
                }
            ]
        }


def test_sports_title_uses_openai_result(monkeypatch):
    monkeypatch.setattr(
        "app.services.titles.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            title_model="gpt-5.5",
        ),
    )
    monkeypatch.setattr(
        "app.services.titles.httpx.post",
        lambda *args, **kwargs: FakeTitleResponse(),
    )

    title = generate_candidate_title(
        "sports",
        "[09:03] Goal!\n[09:12] History for the USA!",
        1,
        "Amerika Serikat vs Paraguay",
    )

    assert title == "Gio Reyna Cetak Gol Keempat, AS Ukir Sejarah!"


def test_fallback_copy_replaces_generic_hook():
    result = generate_candidate_copy(
        "sports",
        (
            "[09:03] Goal!\n"
            "[09:12] History for the USA! For the first time they score four goals."
        ),
        1,
        "Amerika Serikat 4 - 1 Paraguay",
        use_ai=False,
    )

    assert "sejarah" in result["title"].lower()
    assert "catatan bersejarah" in result["hook"].lower()
