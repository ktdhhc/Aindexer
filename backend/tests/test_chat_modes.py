from types import SimpleNamespace

import pytest

from app.services import chat_modes


def _record(doc_id: str, text: str = "short") -> SimpleNamespace:
    return SimpleNamespace(
        doc_id=doc_id,
        title=f"Title {doc_id}",
        authors=["Author"],
        year=2026,
        keywords=["keyword"],
        one_liner=text,
        core_points=[text],
        custom_fields={"method": text},
    )


def test_deep_context_requires_selected_documents() -> None:
    with pytest.raises(RuntimeError, match="精读模式需要先选择"):
        chat_modes.build_chat_context(
            question="问题",
            workspace_id="ws_default",
            model_name="unknown-model",
            mode="deep",
            doc_ids=[],
        )


def test_wide_context_uses_full_index_when_budget_allows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_modes, "resolve_model_context_window", lambda _model: 128_000)
    monkeypatch.setattr(chat_modes, "list_documents", lambda workspace_id: [{"id": "doc_a", "status": "indexed"}])
    monkeypatch.setattr(chat_modes, "get_document", lambda doc_id, workspace_id: {"id": doc_id, "display_name": "Doc A", "filename": "a.pdf", "status": "indexed"})
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id))
    monkeypatch.setattr(chat_modes, "markdown_path", lambda doc_id: SimpleNamespace(exists=lambda: False))
    monkeypatch.setattr(chat_modes, "render_markdown", lambda doc_id, record: "full markdown content")

    result = chat_modes.build_chat_context(
        question="问题",
        workspace_id="ws_default",
        model_name="known-model",
        mode="wide",
        doc_ids=[],
    )

    assert result.stats["wide_strategy"] == "full_index"
    assert result.sources[0].doc_id == "doc_a"
    assert "full markdown content" in result.context


def test_wide_context_falls_back_to_structured_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "x" * 200_000
    monkeypatch.setattr(chat_modes, "resolve_model_context_window", lambda _model: 32_000)
    monkeypatch.setattr(chat_modes, "list_documents", lambda workspace_id: [{"id": "doc_a", "status": "indexed"}])
    monkeypatch.setattr(chat_modes, "get_document", lambda doc_id, workspace_id: {"id": doc_id, "display_name": "Doc A", "filename": "a.pdf", "status": "indexed"})
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id, "structured point"))
    monkeypatch.setattr(chat_modes, "markdown_path", lambda doc_id: SimpleNamespace(exists=lambda: False))
    monkeypatch.setattr(chat_modes, "render_markdown", lambda doc_id, record: long_text)

    result = chat_modes.build_chat_context(
        question="问题",
        workspace_id="ws_default",
        model_name="unknown-model",
        mode="wide",
        doc_ids=[],
    )

    assert result.stats["wide_strategy"] == "structured_summary"
    assert result.stats["structured_fallback"] is True
    assert "structured point" in result.context
    assert long_text not in result.context


def test_deep_context_uses_original_file_content(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        chat_modes,
        "get_document",
        lambda doc_id, workspace_id: {
            "id": doc_id,
            "display_name": "Doc A",
            "filename": "a.pdf",
            "file_path": "D:/fake/a.pdf",
            "file_type": "pdf",
            "status": "indexed",
        },
    )
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id, "index summary"))
    monkeypatch.setattr(chat_modes, "parse_file", lambda path, file_type: "original file content")
    monkeypatch.setattr(chat_modes.Path, "exists", lambda self: True)

    result = chat_modes.build_chat_context(
        question="问题",
        workspace_id="ws_default",
        model_name="unknown-model",
        mode="deep",
        doc_ids=["doc_a"],
    )

    assert "original file content" in result.context
    assert "index summary" not in result.context


def test_chat_modes_use_distinct_prompts() -> None:
    wide_system, wide_user = chat_modes.build_chat_prompt(
        question="Q",
        context="C",
        mode="wide",
    )
    deep_system, deep_user = chat_modes.build_chat_prompt(
        question="Q",
        context="C",
        mode="deep",
    )
    agent_system, agent_user = chat_modes.build_chat_prompt(
        question="Q",
        context="C",
        mode="agent",
    )

    assert wide_system != deep_system
    assert deep_system != agent_system
    assert wide_user != deep_user
    assert deep_user != agent_user
