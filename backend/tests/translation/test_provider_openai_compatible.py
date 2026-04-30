from __future__ import annotations

import importlib

import pytest

from app.translation.providers.base import TranslationProviderErrorKind
from app.translation.service import ResolvedTranslationProviderConfig
from app.services.provider_client import StreamChatCompletionResult

provider_module = importlib.import_module("app.translation.providers.openai_compatible")


def test_openai_compatible_adapter_returns_normalized_translation(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_stream_chat_completion(*, url, headers, payload, timeout, should_cancel):
        captured["url"] = url
        captured["headers"] = headers
        captured["payload"] = payload
        captured["timeout"] = timeout
        return StreamChatCompletionResult(
            text="翻译后的文本",
            usage={"prompt_tokens": 12, "completion_tokens": 34, "total_tokens": 46},
            first_token_ms=123.0,
            total_duration_ms=456.0,
            finish_reason="stop",
        )

    monkeypatch.setattr(
        provider_module,
        "stream_chat_completion_with_metrics",
        fake_stream_chat_completion,
    )

    request = provider_module.TranslationProviderRequest(
        provider="ollama",
        model="hy-mt1.5-1.8b:latest",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )
    config = ResolvedTranslationProviderConfig(
        provider="ollama",
        base_url="http://localhost:11434/v1",
        model="hy-mt1.5-1.8b:latest",
        api_key="ollama",
        timeout=90,
        enabled=True,
    )

    result = provider_module.translate_with_openai_compatible(config, request)

    assert captured["url"] == "http://localhost:11434/v1/chat/completions"
    assert captured["timeout"] == 90
    assert captured["payload"] == {
        "model": "hy-mt1.5-1.8b:latest",
        "messages": [
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "user prompt"},
        ],
        "temperature": 0.1,
        "max_tokens": provider_module.OPENAI_COMPAT_DEFAULT_MAX_TOKENS,
        "stream": True,
    }
    assert result.provider == "ollama"
    assert result.translated_text == "翻译后的文本"
    assert result.usage == {
        "prompt_tokens": 12,
        "completion_tokens": 34,
        "total_tokens": 46,
    }
    assert result.first_token_ms == 123.0
    assert result.total_duration_ms == 456.0


def test_openai_compatible_adapter_supports_provider_specific_thinking() -> None:
    deepseek_config = ResolvedTranslationProviderConfig(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key="secret-key",
        timeout=90,
        enabled=True,
    )
    openrouter_config = ResolvedTranslationProviderConfig(
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        model="deepseek/deepseek-chat",
        api_key="secret-key",
        timeout=90,
        enabled=True,
    )
    request = provider_module.TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
        enable_thinking=True,
    )

    deepseek_payload = provider_module.build_openai_compatible_payload(
        deepseek_config,
        request,
    )
    openrouter_payload = provider_module.build_openai_compatible_payload(
        openrouter_config,
        request,
    )

    assert deepseek_payload["thinking"] == {"type": "enabled"}
    assert openrouter_payload["reasoning"] == {"effort": "high"}


def test_openai_compatible_adapter_maps_runtime_failures() -> None:
    config = ResolvedTranslationProviderConfig(
        provider="ollama",
        base_url="http://localhost:11434/v1",
        model="hy-mt1.5-1.8b:latest",
        api_key="ollama",
        timeout=90,
        enabled=True,
    )
    request = provider_module.TranslationProviderRequest(
        provider="ollama",
        model="hy-mt1.5-1.8b:latest",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )

    auth_error = provider_module._map_openai_compatible_runtime_error(
        RuntimeError("LLM HTTP 401: unauthorized"),
        config=config,
        request=request,
    )
    rate_limit_error = provider_module._map_openai_compatible_runtime_error(
        RuntimeError("LLM HTTP 429: limited"),
        config=config,
        request=request,
    )
    cancelled_error = provider_module._map_openai_compatible_runtime_error(
        RuntimeError("cancelled by user during stream"),
        config=config,
        request=request,
    )

    assert auth_error.kind == TranslationProviderErrorKind.AUTH
    assert rate_limit_error.kind == TranslationProviderErrorKind.RATE_LIMIT
    assert rate_limit_error.retryable is True
    assert cancelled_error.kind == TranslationProviderErrorKind.CANCELLED


def test_openai_compatible_adapter_maps_empty_translation(monkeypatch) -> None:
    def fake_stream_chat_completion(*, url, headers, payload, timeout, should_cancel):
        return StreamChatCompletionResult(text="   ")

    monkeypatch.setattr(
        provider_module,
        "stream_chat_completion_with_metrics",
        fake_stream_chat_completion,
    )

    config = ResolvedTranslationProviderConfig(
        provider="ollama",
        base_url="http://localhost:11434/v1",
        model="hy-mt1.5-1.8b:latest",
        api_key="ollama",
        timeout=90,
        enabled=True,
    )
    request = provider_module.TranslationProviderRequest(
        provider="ollama",
        model="hy-mt1.5-1.8b:latest",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )

    with pytest.raises(provider_module.TranslationProviderError) as exc_info:
        provider_module.translate_with_openai_compatible(config, request)

    assert exc_info.value.kind == TranslationProviderErrorKind.RESPONSE_INVALID
    assert exc_info.value.message == "ollama returned an empty translation."
