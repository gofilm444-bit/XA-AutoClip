import json
from types import SimpleNamespace

import httpx

from app.services.titles import (
    LOCAL_HOOK_FALLBACK,
    LOCAL_TITLE_FALLBACK,
    extract_main_idea,
    generate_candidate_copy,
    generate_candidate_title,
    is_bad_main_topic,
    rewrite_local_description,
    rewrite_local_hook,
    rewrite_local_title,
)


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


def test_podcast_title_rewrites_first_statement_naturally():
    transcript = "[00:16] Kreator perlu memahami konteks sebelum memotong video."
    title = generate_candidate_title(
        "podcast",
        transcript,
        1,
        use_ai=False,
    )

    assert title.lower() not in transcript.lower()
    assert "kreator" in title.lower()
    assert "konteks" in title.lower()
    assert len(title.split()) <= 12


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
    events = []
    monkeypatch.setattr(
        "app.services.titles.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            title_model="gpt-5.5",
            title_hook_ai_enabled=True,
        ),
    )
    monkeypatch.setattr(
        "app.services.titles.httpx.post",
        lambda *args, **kwargs: FakeTitleResponse(),
    )
    monkeypatch.setattr(
        "app.services.titles.logger.info",
        lambda event, **fields: events.append((event, fields)),
    )

    title = generate_candidate_title(
        "sports",
        "[09:03] Goal!\n[09:12] History for the USA!",
        1,
        "Amerika Serikat vs Paraguay",
    )

    assert title == "Gio Reyna Cetak Gol Keempat, AS Ukir Sejarah!"
    assert [event for event, _ in events] == ["ai_call_started", "ai_call_completed"]
    assert events[0][1]["ai_call_type"] == "title_hook_generation"


def test_title_hook_ai_disabled_uses_local_fallback_without_openai(monkeypatch):
    events = []
    post_calls = []
    monkeypatch.setattr(
        "app.services.titles.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            title_model="gpt-5.5",
            title_hook_ai_enabled=False,
        ),
    )
    monkeypatch.setattr(
        "app.services.titles.httpx.post",
        lambda *args, **kwargs: post_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        "app.services.titles.logger.info",
        lambda event, **fields: events.append((event, fields)),
    )

    result = generate_candidate_copy(
        "podcast",
        "Efisiensi anggaran harus tetap menjaga pendidikan dan kesehatan.",
        1,
    )

    assert post_calls == []
    assert result["title"] != "Efisiensi anggaran harus tetap menjaga pendidikan dan kesehatan."
    assert [event for event, _ in events] == [
        "title_hook_ai_skipped",
        "local_title_hook_rewrite_applied",
    ]
    assert events[-1][1]["title_was_rewritten"] is True
    assert events[-1][1]["hook_was_rewritten"] is True


def test_openai_429_falls_back_to_local_copy_without_retry(monkeypatch):
    warnings = []
    post_calls = []
    monkeypatch.setattr(
        "app.services.titles.get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            title_model="gpt-5.5",
            title_hook_ai_enabled=True,
        ),
    )

    def rate_limited(*args, **kwargs):
        post_calls.append((args, kwargs))
        raise httpx.HTTPStatusError(
            "429 Too Many Requests",
            request=httpx.Request("POST", "https://api.openai.com/v1/responses"),
            response=httpx.Response(429),
        )

    monkeypatch.setattr("app.services.titles.httpx.post", rate_limited)
    monkeypatch.setattr(
        "app.services.titles.logger.warning",
        lambda event, **fields: warnings.append((event, fields)),
    )

    result = generate_candidate_copy(
        "podcast",
        "Efisiensi anggaran harus tetap menjaga pendidikan dan kesehatan.",
        1,
    )

    assert len(post_calls) == 1
    assert "efisiensi" in result["title"].lower()
    assert [event for event, _ in warnings] == [
        "ai_call_failed",
        "title_hook_ai_failed_fallback_local",
    ]


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


def test_local_title_and_hook_do_not_copy_transcript_opening():
    transcript = (
        "Nah jadi efisiensi anggaran pendidikan perlu dibahas karena dampaknya "
        "langsung terasa pada layanan kesehatan."
    )

    result = generate_candidate_copy("podcast", transcript, 1, use_ai=False)

    assert result["title"].lower() != transcript.lower()
    assert result["hook"].lower() != transcript.lower()
    assert not result["title"].lower().startswith(("jadi", "nah", "terus", "lalu"))
    assert len(result["title"].split()) <= 12
    assert len(result["hook"].split()) <= 18


def test_local_hook_has_low_word_overlap_with_transcript():
    transcript = "Pendidikan gratis membutuhkan efisiensi anggaran dan prioritas belanja yang jelas."
    hook = rewrite_local_hook(transcript, "Efisiensi Anggaran Pendidikan", "podcast")
    transcript_words = set(transcript.lower().strip(".").split())
    hook_words = hook.lower().strip(".").split()

    overlap = sum(word in transcript_words for word in hook_words) / len(hook_words)

    assert overlap < 0.72


def test_local_sports_template_is_safe_and_concise():
    result = generate_candidate_copy(
        "sports",
        "Kesalahan umpan membuka ruang dan gol kemenangan tercipta pada menit akhir.",
        2,
        use_ai=False,
    )

    assert "pertandingan" in result["title"].lower() or "gol" in result["title"].lower()
    assert len(result["title"].split()) <= 12
    assert len(result["hook"].split()) <= 18


def test_short_filler_transcript_uses_safe_fallbacks():
    title = rewrite_local_title("Nah.", "podcast")
    hook = rewrite_local_hook("Nah.", title, "podcast")

    assert title == LOCAL_TITLE_FALLBACK
    assert hook == LOCAL_HOOK_FALLBACK


def test_antartika_time_title_is_natural_and_has_no_bad_topics():
    title = rewrite_local_title(
        "Nah gak satu udah jelas, zona waktu di Antartika ternyata ribet untuk peneliti.",
        "podcast",
    )

    assert title == "Di Antartika, Zona Waktu Ternyata Tidak Sesederhana Itu"
    assert not any(filler in title.lower().split() for filler in ("gak", "satu", "udah"))
    assert len(title.split()) <= 12


def test_local_hooks_vary_for_distinct_candidate_topics():
    time_text = "Peneliti memakai zona waktu berbeda ketika berpindah lokasi di Antartika."
    scholarship_text = "Beasiswa Rusia diberikan setelah pemerintah Rusia memilih para peneliti."

    time_hook = rewrite_local_hook(time_text, "Zona Waktu Antartika", "podcast")
    scholarship_hook = rewrite_local_hook(
        scholarship_text,
        "Beasiswa Rusia",
        "podcast",
    )

    assert time_hook != scholarship_hook
    assert "Antartika" in time_hook
    assert "beasiswa" in scholarship_hook.lower()
    assert len(time_hook.split()) <= 18
    assert len(scholarship_hook.split()) <= 18


def test_local_description_uses_candidate_topic():
    description = rewrite_local_description(
        "Zona waktu di Antartika bisa berbeda untuk setiap lokasi penelitian.",
        "podcast",
    )

    assert description == (
        "Cuplikan ini membahas kenapa zona waktu di Antartika tidak sesederhana biasanya."
    )
    assert description != "Cuplikan membahas pentingnya konteks dan kontribusi kreator."


MENTAL_ANTARTIKA_TRANSCRIPT = (
    "Tapi katanya kalau tes psikologi sampai dikurung berbulan-bulan itu benar-benar? "
    "Nggak, kalau di Rusia nggak. Pernah ada kejadian kriminal di stasiun Billingsgauz. "
    "Tiba-tiba gangguan mental, marah, dan mudah sensi karena hidup dengan orang yang "
    "sama berbulan-bulan. Pasti ada berantem dan konflik dengan kepala stasiun."
)


def test_extract_main_idea_understands_mental_antartika_context():
    idea = extract_main_idea(MENTAL_ANTARTIKA_TRANSCRIPT, "podcast")

    assert idea["kind"] == "mental_antartika"
    assert idea["main_topic"] == "tes psikologi Antartika"
    assert "tekanan mental" in str(idea["tension_or_problem"])
    assert "Antartika" in idea["entities"]
    assert "nggak" in idea["bad_tokens_removed"]


def test_mental_antartika_copy_uses_main_idea_not_raw_tokens():
    result = generate_candidate_copy(
        "podcast",
        MENTAL_ANTARTIKA_TRANSCRIPT,
        1,
        use_ai=False,
    )

    assert result["title"] == "Tes Psikologi Antartika Ini Ternyata Bukan Formalitas"
    assert "Nggak Berbulan-Bulan" not in result["title"]
    assert "kemampuan kerja" in result["hook"]
    assert result["hook"] != (
        "Masalahnya bukan di awal cerita, tetapi alasan yang membentuk seluruh konteksnya."
    )
    assert "tes psikologi" in result["description"]
    assert "nggak" not in result["description"].lower()
    assert len(result["title"].split()) <= 12
    assert len(result["hook"].split()) <= 18


def test_antartika_desert_copy_uses_main_idea():
    result = generate_candidate_copy(
        "podcast",
        "Antartika penuh es tetapi sangat kering dan disebut gurun terbesar karena curah hujannya rendah.",
        1,
        use_ai=False,
    )

    assert result["title"] == "Kenapa Antartika Disebut Gurun Terbesar?"
    assert "penuh es" in result["hook"]
    assert "sering disalahpahami" in result["description"]


def test_beasiswa_rusia_copy_uses_main_idea():
    result = generate_candidate_copy(
        "podcast",
        "Pemerintah Rusia menjelaskan alasan memilih penerima beasiswa Rusia untuk program penelitian.",
        1,
        use_ai=False,
    )

    assert result["title"] == "Beasiswa Rusia Ini Ternyata Tidak Sesederhana Itu"
    assert "alasan Rusia" in result["hook"]
    assert "beasiswa Rusia" in result["description"]


def test_bad_main_topic_guard_rejects_transition_phrases():
    for topic in ("iya geser", "oh iya", "gak satu", "udah ternyata", "gitu mas"):
        assert is_bad_main_topic(topic) is True

    assert is_bad_main_topic("zona waktu") is False
    assert is_bad_main_topic("tes psikologi") is False


def test_zone_time_with_geser_uses_domain_fallback_not_transition_topic():
    transcript = (
        "Iya geser kanan, oh iya, kalau di Antartika bisa ganti zona waktu "
        "karena melewati garis bujur yang berbeda."
    )

    result = generate_candidate_copy("podcast", transcript, 2, use_ai=False)
    idea = extract_main_idea(transcript, "podcast")

    assert idea["kind"] == "zona_waktu_antartika"
    assert idea["main_topic"] == "zona waktu Antartika"
    assert result["title"] == "Kenapa Waktu di Antartika Bisa Bikin Bingung?"
    assert "Iya Geser" not in result["title"]
    assert "bergeser lokasi" in result["hook"]
    assert "Masalahnya bukan di awal cerita" not in result["hook"]
    assert "iya" not in result["description"].lower()
    assert "zona waktu" in result["description"].lower()
