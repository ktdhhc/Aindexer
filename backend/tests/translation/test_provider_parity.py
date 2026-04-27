from __future__ import annotations

import importlib

from app.translation.providers.base import TranslationProviderResult

deepseek_provider = importlib.import_module("app.translation.providers.deepseek")
gemini_provider = importlib.import_module("app.translation.providers.gemini")


def test_provider_parity_accepts_same_request_shape() -> None:
    request = deepseek_provider.TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
        source_lang="en",
    )

    deepseek_payload = deepseek_provider.build_deepseek_payload(request)
    gemini_payload = gemini_provider.build_gemini_payload(request)

    assert deepseek_payload["model"] == "deepseek-chat"
    assert gemini_payload["contents"] == [
        {"role": "user", "parts": [{"text": "user prompt"}]}
    ]


def test_provider_parity_results_share_same_contract() -> None:
    deepseek_result = TranslationProviderResult(
        provider="deepseek",
        model="deepseek-chat",
        source_text="Source text",
        translated_text="翻译结果 A",
        target_lang="zh-CN",
        prompt_version="v1",
    )
    gemini_result = TranslationProviderResult(
        provider="gemini",
        model="gemini-2.5-flash-lite",
        source_text="Source text",
        translated_text="翻译结果 B",
        target_lang="zh-CN",
        prompt_version="v1",
    )

    assert deepseek_result.source_text == gemini_result.source_text
    assert deepseek_result.target_lang == gemini_result.target_lang == "zh-CN"
    assert deepseek_result.prompt_version == gemini_result.prompt_version == "v1"
