from app.repository import score_document_search_match


def test_search_match_rejects_unrelated_query() -> None:
    score = score_document_search_match(
        "zzqv91",
        display_name_text="Deep Learning for Biology",
        original_filename_text="biology-paper.pdf",
        title_text="Deep Learning for Biology",
        corpus_text="Authors: Alice, Bob\nKeywords: protein folding\nOne liner: biology paper",
    )

    assert score is None


def test_search_match_keeps_filename_fuzzy_match() -> None:
    score = score_document_search_match(
        "biolog",
        display_name_text="Deep Learning for Biology",
        original_filename_text="biology-paper.pdf",
        title_text="Deep Learning for Biology",
        corpus_text="Authors: Alice, Bob\nKeywords: protein folding\nOne liner: biology paper",
    )

    assert score is not None
