from types import SimpleNamespace
import json
import itertools

import pytest

from app.services import chat_agent
from app.services.provider_client import ProviderConfig


def _record(doc_id: str) -> SimpleNamespace:
    return SimpleNamespace(
        doc_id=doc_id,
        title=f"Title {doc_id}",
        authors=["Author"],
        year=2026,
        keywords=["keyword"],
        one_liner=f"summary {doc_id}",
        core_points=[f"point {doc_id}"],
        custom_fields={},
    )


def _provider_config() -> ProviderConfig:
    return ProviderConfig(
        provider="test",
        base_url="http://example.test",
        model="test-model",
        api_key="test-key",
    )


def _patch_docs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        chat_agent,
        "list_documents",
        lambda workspace_id: [
            {"id": "doc_a", "display_name": "Doc A", "filename": "a.pdf", "file_type": "pdf", "status": "indexed"},
            {"id": "doc_b", "display_name": "Doc B", "filename": "b.pdf", "file_type": "pdf", "status": "indexed"},
            {"id": "doc_c", "display_name": "Doc C", "filename": "c.pdf", "file_type": "pdf", "status": "indexed"},
        ],
    )
    monkeypatch.setattr(chat_agent, "get_index", lambda doc_id: _record(doc_id))


def _patch_context_loader(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    calls: list[tuple[str, str]] = []

    def fake_load(doc_id: str, workspace_id: str, *, variant: str, question: str = "") -> dict:
        calls.append((doc_id, variant))
        source_kind = "paper" if variant == "original_full" else "index"
        return {
            "source": chat_agent.ChatSource(
                source_id="",
                doc_id=doc_id,
                display_name=f"Doc {doc_id[-1].upper()}",
                title=f"Title {doc_id}",
                authors=["Author"],
                year=2026,
                source_kind=source_kind,
            ),
            "body": f"{variant} body {doc_id}",
        }

    monkeypatch.setattr(chat_agent, "_load_document_context", fake_load)
    return calls


def _collect(events):
    return list(events)


def _patch_stream_events(monkeypatch: pytest.MonkeyPatch, decisions, prompts: list[str] | None = None) -> None:
    def fake_stream_events(*, config, system_prompt, user_prompt, should_cancel=None):
        if system_prompt.startswith(chat_agent.PLANNER_SYSTEM_PROMPT):
            if prompts is not None:
                prompts.append(user_prompt)
            yield {"type": "text", "text": json.dumps(next(decisions), ensure_ascii=False)}
            yield {"type": "finish", "finish_reason": "stop"}
            return
        yield {"type": "text", "text": "final answer"}
        yield {"type": "finish", "finish_reason": "stop"}

    monkeypatch.setattr(chat_agent.ProviderClient, "stream_events", fake_stream_events)


def test_agent_loop_does_not_repeat_full_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    _patch_context_loader(monkeypatch)
    prompts: list[str] = []
    decisions = iter([
        {"action": "read_index", "reason": "need index", "doc_ids": ["doc_a"]},
        {"action": "answer", "reason": "enough", "answer": "draft"},
    ])

    def fake_generate_json(config, system_prompt, user_prompt, should_cancel=None):
        prompts.append(user_prompt)
        return next(decisions)

    _patch_stream_events(monkeypatch, decisions, prompts)

    events = _collect(chat_agent.stream_agent_chat(
        question="问题",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        run_id="run_metadata_once",
    ))

    assert any(event["type"] == "done" for event in events)
    assert "本轮是否包含全量元数据：是" in prompts[0]
    assert "doc_id=doc_a" in prompts[0]
    assert "本轮是否包含全量元数据：否" in prompts[1]
    assert "doc_id=doc_a" not in prompts[1].split("元数据层：", 1)[1]


def test_agent_session_followup_does_not_auto_inject_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    prompts: list[str] = []
    decisions = iter([
        {"action": "answer", "reason": "history enough", "answer": "draft"},
    ])

    def fake_generate_json(config, system_prompt, user_prompt, should_cancel=None):
        prompts.append(user_prompt)
        return next(decisions)

    _patch_stream_events(monkeypatch, decisions, prompts)

    events = _collect(chat_agent.stream_agent_chat(
        question="继续比较上一轮提到的两篇文献",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        history_messages=[
            {"role": "user", "content": "先找和强化学习相关的文献"},
            {"role": "assistant", "content": "上一轮找到了两篇候选。"},
        ],
        run_id="run_followup_no_metadata",
    ))

    assert prompts[0].startswith("元数据层：")
    assert "本轮是否包含全量元数据：否" in prompts[0]
    assert "doc_id=doc_a" not in prompts[0].split("元数据层：", 1)[1]
    assert not any(event["type"] == "agent_step" and event["step"]["step"] == "metadata" for event in events)


def test_agent_session_followup_reuses_history_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    calls = _patch_context_loader(monkeypatch)
    prompts: list[str] = []
    decisions = iter([
        {"action": "answer", "reason": "history source enough", "answer": "draft"},
    ])

    def fake_generate_json(config, system_prompt, user_prompt, should_cancel=None):
        prompts.append(user_prompt)
        return next(decisions)

    _patch_stream_events(monkeypatch, decisions, prompts)

    _collect(chat_agent.stream_agent_chat(
        question="继续分析上一轮引用的文献",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        history_messages=[
            {
                "role": "assistant",
                "content": "上一轮已引用 [I-03]。",
                "sources": [
                    {"source_id": "I-03", "doc_id": "doc_a", "display_name": "Doc A", "source_kind": "index"},
                ],
            },
        ],
        run_id="run_followup_history_sources",
    ))

    assert calls == [("doc_a", "index_full")]
    assert "本轮是否包含全量元数据：否" in prompts[0]
    assert "index_full body doc_a" in prompts[0]


def test_agent_loop_reinjects_metadata_when_requested(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    prompts: list[str] = []
    decisions = iter([
        {"action": "read_metadata", "reason": "rescan", "doc_ids": []},
        {"action": "answer", "reason": "enough", "answer": "draft"},
    ])

    def fake_generate_json(config, system_prompt, user_prompt, should_cancel=None):
        prompts.append(user_prompt)
        return next(decisions)

    _patch_stream_events(monkeypatch, decisions, prompts)

    _collect(chat_agent.stream_agent_chat(
        question="问题",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        run_id="run_metadata_again",
    ))

    assert "本轮是否包含全量元数据：是" in prompts[0]
    assert "本轮是否包含全量元数据：是" in prompts[1]


def test_agent_paper_read_respects_top_k(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    calls = _patch_context_loader(monkeypatch)
    decisions = iter([
        {"action": "read_paper", "reason": "need paper", "doc_ids": ["doc_a", "doc_b", "doc_c"]},
        {"action": "answer", "reason": "enough", "answer": "draft"},
    ])
    _patch_stream_events(monkeypatch, decisions)

    _collect(chat_agent.stream_agent_chat(
        question="问题",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        run_id="run_top_k",
    ))

    assert calls == [("doc_a", "original_full"), ("doc_b", "original_full")]


def test_agent_retries_when_planner_returns_empty_action(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    prompts: list[str] = []
    decisions = iter([
        {"action": "", "reason": "bad"},
        {"action": "answer", "reason": "fixed", "answer": "draft"},
    ])

    def fake_generate_json(config, system_prompt, user_prompt, should_cancel=None):
        prompts.append(user_prompt)
        return next(decisions)

    _patch_stream_events(monkeypatch, decisions, prompts)

    events = _collect(chat_agent.stream_agent_chat(
        question="问题",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        run_id="run_retry_empty_action",
    ))

    assert any(event["type"] == "done" for event in events)
    assert len(prompts) == 2
    assert "上一次输出无效" in prompts[1]
    retry_steps = [
        event for event in events
        if event["type"] == "agent_step" and event["step"]["label"] == "规划"
    ]
    assert retry_steps[0]["step"]["detail"] == "重试 1/2"


def test_agent_falls_back_when_planner_keeps_returning_empty_action(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_docs(monkeypatch)
    index_calls = _patch_context_loader(monkeypatch)
    _patch_stream_events(monkeypatch, itertools.repeat({"action": "", "reason": "bad"}))

    events = _collect(chat_agent.stream_agent_chat(
        question="问题",
        workspace_id="ws_default",
        provider_cfg=_provider_config(),
        run_id="run_fallback_empty_action",
    ))

    read_index_steps = [
        event for event in events
        if event["type"] == "agent_step" and event["step"]["step"] == "read_index"
    ]
    assert read_index_steps
    assert index_calls[:3] == [
        ("doc_a", "index_full"),
        ("doc_b", "index_full"),
        ("doc_c", "index_full"),
    ]
