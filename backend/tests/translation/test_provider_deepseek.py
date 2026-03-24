from __future__ import annotations

import importlib

import pytest

from app.translation.providers.base import TranslationProviderErrorKind
from app.translation.service import ResolvedTranslationProviderConfig
from app.services.provider_client import StreamChatCompletionResult

deepseek_provider = importlib.import_module("app.translation.providers.deepseek")


def _build_request():
    translation_schemas = importlib.import_module("app.translation.schemas")
    return translation_schemas.TranslationRequestIn(
        document_id="tdoc_123",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
    )


def test_deepseek_adapter_returns_normalized_translation(monkeypatch) -> None:
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
        deepseek_provider,
        "stream_chat_completion_with_metrics",
        fake_stream_chat_completion,
    )

    payload = _build_request()
    request = deepseek_provider.TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text=payload.source_text,
        target_lang=payload.target_lang,
        prompt_version=payload.prompt_version,
        system_prompt="system prompt",
        user_prompt="user prompt",
    )
    config = ResolvedTranslationProviderConfig(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key="secret-key",
        timeout=90,
        enabled=True,
    )

    result = deepseek_provider.translate_with_deepseek(config, request)

    assert captured["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert captured["timeout"] == 90
    assert captured["payload"] == {
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "user prompt"},
        ],
        "temperature": 0.1,
        "max_tokens": deepseek_provider.DEESEEK_DEFAULT_MAX_TOKENS,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    assert result.provider == "deepseek"
    assert result.translated_text == "翻译后的文本"
    assert result.usage == {
        "prompt_tokens": 12,
        "completion_tokens": 34,
        "total_tokens": 46,
    }
    assert result.first_token_ms == 123.0
    assert result.total_duration_ms == 456.0


def test_deepseek_adapter_maps_runtime_failures() -> None:
    config = ResolvedTranslationProviderConfig(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key="secret-key",
        timeout=90,
        enabled=True,
    )
    request = deepseek_provider.TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )

    auth_error = deepseek_provider._map_deepseek_runtime_error(
        RuntimeError("LLM HTTP 401: unauthorized"),
        config=config,
        request=request,
    )
    rate_limit_error = deepseek_provider._map_deepseek_runtime_error(
        RuntimeError("LLM HTTP 429: limited"),
        config=config,
        request=request,
    )
    cancelled_error = deepseek_provider._map_deepseek_runtime_error(
        RuntimeError("cancelled by user during stream"),
        config=config,
        request=request,
    )

    assert auth_error.kind == TranslationProviderErrorKind.AUTH
    assert rate_limit_error.kind == TranslationProviderErrorKind.RATE_LIMIT
    assert rate_limit_error.retryable is True
    assert cancelled_error.kind == TranslationProviderErrorKind.CANCELLED


def test_deepseek_adapter_maps_empty_translation(monkeypatch) -> None:
    def fake_stream_chat_completion(*, url, headers, payload, timeout, should_cancel):
        return StreamChatCompletionResult(text="   ")

    monkeypatch.setattr(
        deepseek_provider,
        "stream_chat_completion_with_metrics",
        fake_stream_chat_completion,
    )

    config = ResolvedTranslationProviderConfig(
        provider="deepseek",
        base_url="https://api.deepseek.com/v1",
        model="deepseek-chat",
        api_key="secret-key",
        timeout=90,
        enabled=True,
    )
    request = deepseek_provider.TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )

    with pytest.raises(deepseek_provider.TranslationProviderError) as exc_info:
        deepseek_provider.translate_with_deepseek(config, request)

    assert exc_info.value.kind == TranslationProviderErrorKind.RESPONSE_INVALID
    assert exc_info.value.message == "DeepSeek returned an empty translation."
