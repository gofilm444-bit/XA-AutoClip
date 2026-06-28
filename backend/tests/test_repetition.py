from app.services.repetition import cosine_similarity, maximum_similarity


def test_identical_text_has_high_similarity():
    text = "konteks baru memberi penjelasan yang berguna untuk penonton"
    assert cosine_similarity(text, text) == 1


def test_different_text_has_low_similarity():
    assert maximum_similarity("analisis ekonomi lokal", ["resep membuat roti"]) == 0

