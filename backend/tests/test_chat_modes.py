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
    assert result.sources[0].source_id == "I-01"
    assert "可用文献顺序：" in result.context
    assert "[I-01] Doc A | Title doc_a" in result.context
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


def test_wide_context_keeps_session_source_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_modes, "resolve_model_context_window", lambda _model: 128_000)
    monkeypatch.setattr(
        chat_modes,
        "list_documents",
        lambda workspace_id: [
            {"id": "doc_a", "status": "indexed"},
            {"id": "doc_b", "status": "indexed"},
            {"id": "doc_c", "status": "indexed"},
        ],
    )
    monkeypatch.setattr(chat_modes, "get_document", lambda doc_id, workspace_id: {"id": doc_id, "display_name": f"Doc {doc_id[-1].upper()}", "filename": f"{doc_id}.pdf", "status": "indexed"})
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id))
    monkeypatch.setattr(chat_modes, "markdown_path", lambda doc_id: SimpleNamespace(exists=lambda: False))
    monkeypatch.setattr(chat_modes, "render_markdown", lambda doc_id, record: f"markdown {doc_id}")

    result = chat_modes.build_chat_context(
        question="问题",
        workspace_id="ws_default",
        model_name="known-model",
        mode="wide",
        doc_ids=[],
        source_map={"doc_a": "I-03", "doc_b": "I-04"},
    )

    assert [source.source_id for source in result.sources] == ["I-03", "I-04", "I-05"]
    assert "[I-03] Doc A | Title doc_a" in result.context
    assert "[I-05] Doc C | Title doc_c" in result.context
    assert result.stats["total_indexed_count"] == 3
    assert result.stats["included_source_count"] == 3
    assert result.stats["wide_ranked_fallback"] is False


def test_wide_context_reports_ranked_fallback_stats(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "文" * 60_000
    monkeypatch.setattr(chat_modes, "resolve_model_context_window", lambda _model: 32_000)
    monkeypatch.setattr(
        chat_modes,
        "list_documents",
        lambda workspace_id: [
            {"id": "doc_a", "status": "indexed"},
            {"id": "doc_b", "status": "indexed"},
            {"id": "doc_c", "status": "indexed"},
        ],
    )
    monkeypatch.setattr(chat_modes, "get_document", lambda doc_id, workspace_id: {"id": doc_id, "display_name": f"Doc {doc_id[-1].upper()}", "filename": f"{doc_id}.pdf", "status": "indexed"})
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id, long_text))
    monkeypatch.setattr(chat_modes, "markdown_path", lambda doc_id: SimpleNamespace(exists=lambda: False))
    monkeypatch.setattr(chat_modes, "render_markdown", lambda doc_id, record: long_text)
    monkeypatch.setattr(chat_modes, "search_documents", lambda *args, **kwargs: [{"doc_id": "doc_b"}])

    result = chat_modes.build_chat_context(
        question="问题",
        workspace_id="ws_default",
        model_name="unknown-model",
        mode="wide",
        doc_ids=[],
    )

    assert result.stats["wide_strategy"] == "structured_summary"
    assert result.stats["total_indexed_count"] == 3
    assert result.stats["included_source_count"] == 1
    assert result.stats["omitted_source_count"] == 2
    assert result.stats["ranked_candidate_count"] == 1
    assert result.stats["wide_ranked_fallback"] is True
    assert [source.doc_id for source in result.sources] == ["doc_b"]
    assert "Doc B" in result.context
    assert "Doc A" not in result.context


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
    assert result.sources[0].source_id == "P-01"
    assert "可用文献顺序：" in result.context
    assert "## [P-01] Doc A | Title doc_a" in result.context


def test_deep_context_keeps_session_source_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        chat_modes,
        "get_document",
        lambda doc_id, workspace_id: {
            "id": doc_id,
            "display_name": f"Doc {doc_id[-1].upper()}",
            "filename": f"{doc_id}.pdf",
            "file_path": f"D:/fake/{doc_id}.pdf",
            "file_type": "pdf",
            "status": "indexed",
        },
    )
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id, f"summary {doc_id}"))
    monkeypatch.setattr(chat_modes, "parse_file", lambda path, file_type: f"original {path.stem}")
    monkeypatch.setattr(chat_modes.Path, "exists", lambda self: True)

    result = chat_modes.build_chat_context(
        question="问题",
        workspace_id="ws_default",
        model_name="unknown-model",
        mode="deep",
        doc_ids=["doc_a", "doc_b", "doc_c"],
        source_map={"doc_a": "P-03", "doc_b": "P-04"},
    )

    assert [source.source_id for source in result.sources] == ["P-03", "P-04", "P-05"]
    assert "[P-03] Doc A | Title doc_a" in result.context
    assert "[P-05] Doc C | Title doc_c" in result.context


def test_agent_context_reads_index_and_original_with_split_prefixes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_modes, "resolve_model_context_window", lambda _model: 128_000)
    monkeypatch.setattr(
        chat_modes,
        "search_documents",
        lambda *args, **kwargs: [{"doc_id": "doc_a"}, {"doc_id": "doc_b"}],
    )
    monkeypatch.setattr(
        chat_modes,
        "get_document",
        lambda doc_id, workspace_id: {
            "id": doc_id,
            "display_name": f"Doc {doc_id[-1].upper()}",
            "filename": f"{doc_id}.pdf",
            "file_path": f"D:/fake/{doc_id}.pdf",
            "file_type": "pdf",
            "status": "indexed",
        },
    )
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id, f"summary {doc_id}"))
    monkeypatch.setattr(chat_modes, "parse_file", lambda path, file_type: f"original {path.stem}\n\nmethod details")
    monkeypatch.setattr(chat_modes.Path, "exists", lambda self: True)

    result = chat_modes.build_chat_context(
        question="比较实验方法与局限",
        workspace_id="ws_default",
        model_name="known-model",
        mode="agent",
        doc_ids=[],
        source_map={"index:doc_a": "I-03", "paper:doc_a": "P-02"},
    )

    assert [source.source_id for source in result.sources] == ["I-03", "I-04", "P-02", "P-03"]
    assert [source.source_kind for source in result.sources] == ["index", "index", "paper", "paper"]
    assert "[I-03] Doc A | Title doc_a" in result.context
    assert "[P-02] Doc A | Title doc_a" in result.context
    assert result.stats["agent_strategy"] == "guided_multi_read"
    assert result.stats["candidate_count"] == 2
    assert result.stats["read_index_count"] == 2
    assert result.stats["read_original_count"] == 2


def test_agent_context_events_emit_trace_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat_modes, "resolve_model_context_window", lambda _model: 128_000)
    monkeypatch.setattr(chat_modes, "search_documents", lambda *args, **kwargs: [{"doc_id": "doc_a"}])
    monkeypatch.setattr(
        chat_modes,
        "get_document",
        lambda doc_id, workspace_id: {
            "id": doc_id,
            "display_name": "Doc A",
            "filename": "doc_a.pdf",
            "status": "indexed",
        },
    )
    monkeypatch.setattr(chat_modes, "get_index", lambda doc_id: _record(doc_id, "summary a"))

    stream = chat_modes.iter_agent_context_events(
        question="帮我找相关候选并总结",
        workspace_id="ws_default",
        model_name="known-model",
        source_map={},
    )
    events = []
    while True:
        try:
            events.append(next(stream))
        except StopIteration as stop:
            result = stop.value
            break

    assert [event["type"] for event in events] == ["agent_step", "agent_step", "agent_step"]
    assert [event["step"]["step"] for event in events] == ["search", "read_index", "answer"]
    assert result.stats["agent_trace"][0]["label"] == "检索候选"
    assert result.sources[0].source_id == "I-01"


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


def test_chat_prompt_includes_history() -> None:
    _system, user_prompt = chat_modes.build_chat_prompt(
        question="继续展开第三点",
        context="## [P-01] Doc A\n\ncontent",
        mode="deep",
        history_messages=[
            {"role": "user", "content": "先总结 P-01", "sources": [{"source_id": "P-01", "doc_id": "doc_a", "display_name": "Doc A"}]},
            {"role": "assistant", "content": "第三点是方法限制。"},
            {"role": "system", "content": "ignore me"},
        ],
        history_token_budget=2_000,
    )

    assert "对话历史" in user_prompt
    assert "先总结 P-01" in user_prompt
    assert "第三点是方法限制" in user_prompt
    assert "[P-01] Doc A" in user_prompt
    assert "ignore me" not in user_prompt
