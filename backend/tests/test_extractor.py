from __future__ import annotations

import json

import pytest

from app.services import extractor, provider_client
from app.services.provider_client import ProviderConfig


def _provider() -> ProviderConfig:
    return ProviderConfig(
        provider="deepseek",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-flash",
        api_key="test-key",
        temperature=0.1,
        timeout=30,
    )


def test_default_index_input_budget_is_50k() -> None:
    assert extractor.DEFAULT_INDEX_INPUT_BUDGET_TOKENS == 50_000


def test_resolve_index_input_budget_clamps_to_model_context(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        extractor,
        "resolve_model_name_registry_entry",
        lambda _model: {"context_window_tokens": 8000},
    )

    budget = extractor.resolve_index_input_budget(
        "small-model",
        requested_tokens=50_000,
        output_budget_tokens=1500,
    )

    assert budget == 3000


def test_run_extraction_retries_json_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    def fake_generate_json(*args, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise RuntimeError("LLM JSON mode empty content")
        return {
            "title": "A paper",
            "authors": ["Alice", "Bob"],
            "year": 2024,
            "keywords": ["decision making"],
            "apa_citation": "Alice, A. (2024). A paper.",
            "one_liner": "这篇论文解释了一个明确问题。",
            "core_points": ["核心观点一", "核心观点二"],
            "claims": [{"claim_text": "结论", "evidence_quote": "evidence", "page": 1}],
            "custom_fields": {},
        }

    monkeypatch.setattr(provider_client.ProviderClient, "generate_json", fake_generate_json)

    record = extractor.run_extraction(
        text="[Page 1]\nA paper\nAbstract\nSomething useful",
        provider_cfg=_provider(),
        custom_fields=[],
        retries=2,
    )

    assert record.title == "A paper"
    assert len(calls) == 2
    assert calls[0]["stream"] is True
    assert calls[1]["stream"] is False
    assert all(call["use_json_mode"] is True for call in calls)


def test_run_extraction_uses_text_fallback_after_two_json_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    json_calls = 0
    text_calls = 0

    def fake_generate_json(*args, **kwargs):
        nonlocal json_calls
        json_calls += 1
        return {
            "title": "Untitled",
            "authors": ["Unknown"],
            "year": 0,
            "keywords": ["待补充"],
            "apa_citation": "",
            "one_liner": "待补充",
            "core_points": ["待补充"],
            "claims": [],
            "custom_fields": {},
        }

    def fake_generate_text(*args, **kwargs):
        nonlocal text_calls
        text_calls += 1
        return """TITLE: Understanding dual process cognition via the minimum description length principle
AUTHORS: Ted Moskovitz; Kevin J. Miller; Maneesh Sahani; Matthew M. Botvinick
YEAR: 2024
KEYWORDS: dual process; cognition; minimum description length
APA_CITATION: Moskovitz, T., Miller, K. J., Sahani, M., & Botvinick, M. M. (2024). Understanding dual process cognition via the minimum description length principle.
ONE_LINER: 本文用最小描述长度原则解释双过程认知。
CORE_POINTS:
- 提出统一的双过程计算解释。
- 通过压缩视角解释自动与审慎行为分工。
CLAIMS:
- dual-process structure can enhance adaptive behavior || dual-process structure can enhance adaptive behavior by allowing an agent to minimize the description length of its own behavior || 1 || Abstract
CUSTOM_FIELDS:
"""

    monkeypatch.setattr(provider_client.ProviderClient, "generate_json", fake_generate_json)
    monkeypatch.setattr(provider_client.ProviderClient, "generate_text", fake_generate_text)

    record = extractor.run_extraction(
        text="[Page 1]\nUnderstanding dual process cognition via the minimum description length principle\nAbstract\n...",
        provider_cfg=_provider(),
        custom_fields=[],
        retries=2,
    )

    assert json_calls == 2
    assert text_calls == 1
    assert record.title.startswith("Understanding dual process cognition")
    assert record.authors[0] == "Ted Moskovitz"
    assert record.claims[0].page == 1


def test_prepare_index_input_text_rejects_page_markers_without_content() -> None:
    with pytest.raises(RuntimeError, match="解析内容不足"):
        extractor.prepare_index_input_text("[Page 1]\n\n[Page 2]\n   ")


def test_run_extraction_trims_long_document_before_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def fake_generate_json(_config, _system_prompt, user_prompt, **kwargs):
        captured["user_prompt"] = user_prompt
        return {
            "title": "Important Paper",
            "authors": ["Alice"],
            "year": 2026,
            "keywords": ["budgeting", "indexing"],
            "apa_citation": "Alice. (2026). Important Paper.",
            "one_liner": "这篇论文说明长文档预算裁剪仍能保留关键部分。",
            "core_points": ["保留摘要", "保留结论", "限制输入预算"],
            "claims": [
                {
                    "claim_text": "Budget trimming preserves key sections",
                    "evidence_quote": "Conclusion: the important final claim is retained.",
                    "page": 60,
                }
            ],
            "custom_fields": {},
        }

    monkeypatch.setattr(provider_client.ProviderClient, "generate_json", fake_generate_json)
    pages = [
        "[Page 1]\nImportant Paper\nAbstract\nAbstract evidence is essential.",
        "[Page 2]\nIntroduction\nThe introduction frames the problem.",
    ]
    pages.extend(
        f"[Page {idx}]\nIRRELEVANT_PAGE_{idx} " + ("filler details " * 80)
        for idx in range(3, 60)
    )
    pages.append("[Page 60]\nConclusion\nConclusion: the important final claim is retained.")

    record = extractor.run_extraction(
        text="\n".join(pages),
        provider_cfg=_provider(),
        custom_fields=[],
        retries=1,
        input_budget_tokens=1500,
    )

    prompt = captured["user_prompt"]
    doc_text = prompt.split("文献内容如下：", 1)[1]
    assert record.title == "Important Paper"
    assert "长文档预算裁剪策略" in prompt
    assert "Important Paper" in prompt
    assert "Abstract" in prompt
    assert "Conclusion" in prompt
    assert "IRRELEVANT_PAGE_20" not in prompt
    assert extractor.estimate_tokens(doc_text) <= 1500


def test_stream_metrics_rejects_empty_chunk_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    chunk = json.dumps(
        {
            "id": "abc",
            "object": "chat.completion.chunk",
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant", "content": None, "reasoning_content": ""},
                    "finish_reason": None,
                }
            ],
        },
        ensure_ascii=False,
    )

    class FakeResponse:
        status_code = 200
        headers: dict[str, str] = {}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def iter_lines(self):
            yield f"data: {chunk}"
            yield "data: [DONE]"

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(provider_client.httpx, "Client", FakeClient)

    with pytest.raises(RuntimeError, match="LLM流式响应为空"):
        provider_client.stream_chat_completion_with_metrics(
            url="https://api.deepseek.com/chat/completions",
            headers={"Authorization": "Bearer test"},
            payload={"model": "deepseek-v4-flash", "max_tokens": 1500, "stream": True},
            timeout=30,
        )
