from __future__ import annotations

import importlib

import pytest

from app.translation.providers.base import TranslationProviderErrorKind
from app.translation.service import ResolvedTranslationProviderConfig

gemini_provider = importlib.import_module("app.translation.providers.gemini")


class _DummyResponse:
    def __init__(
        self, status_code: int, body: dict | None = None, text: str = ""
    ) -> None:
        self.status_code = status_code
        self._body = body if body is not None else {}
        self.text = text
        self.elapsed = None

    def json(self) -> dict:
        return self._body


class _DummyClient:
    def __init__(self, response: _DummyResponse) -> None:
        self._response = response
        self.calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def post(self, url: str, headers: dict[str, str], json: dict[str, object]):
        self.calls.append((url, headers, json))
        return self._response


def _build_request():
    return gemini_provider.TranslationProviderRequest(
        provider="gemini",
        model="gemini-2.5-flash-lite",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )


def test_gemini_adapter_returns_normalized_translation(monkeypatch) -> None:
    response = _DummyResponse(
        200,
        {
            "candidates": [
                {
                    "content": {"parts": [{"text": "翻译后的文本"}]},
                    "finishReason": "STOP",
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 10,
                "candidatesTokenCount": 20,
                "totalTokenCount": 30,
            },
        },
    )
    client = _DummyClient(response)

    monkeypatch.setattr(gemini_provider.httpx, "Client", lambda timeout: client)

    config = ResolvedTranslationProviderConfig(
        provider="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-2.5-flash-lite",
        api_key="secret-key",
        timeout=45,
        enabled=True,
    )
    request = _build_request()

    result = gemini_provider.translate_with_gemini(config, request)

    assert client.calls[0][0].endswith("/models/gemini-2.5-flash-lite:generateContent")
    assert client.calls[0][1]["x-goog-api-key"] == "secret-key"
    assert client.calls[0][2] == {
        "systemInstruction": {"parts": [{"text": "system prompt"}]},
        "contents": [{"role": "user", "parts": [{"text": "user prompt"}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": gemini_provider.GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
        },
    }
    assert result.provider == "gemini"
    assert result.translated_text == "翻译后的文本"
    assert result.finish_reason == "STOP"
    assert result.usage == {
        "prompt_tokens": 10,
        "completion_tokens": 20,
        "total_tokens": 30,
    }
    assert result.first_token_ms is not None
    assert result.total_duration_ms is not None


def test_gemini_adapter_uses_openrouter_compat_when_base_url_matches(
    monkeypatch,
) -> None:
    response = _DummyResponse(
        200,
        {
            "choices": [
                {
                    "message": {"content": "OpenRouter translated text"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 18,
                "total_tokens": 30,
            },
        },
    )
    client = _DummyClient(response)
    monkeypatch.setattr(gemini_provider.httpx, "Client", lambda timeout: client)

    config = ResolvedTranslationProviderConfig(
        provider="gemini",
        base_url="https://openrouter.ai/api/v1",
        model="google/gemini-2.5-flash-lite",
        api_key="secret-key",
        timeout=45,
        enabled=True,
    )
    request = gemini_provider.TranslationProviderRequest(
        provider="gemini",
        model="google/gemini-2.5-flash-lite",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system prompt",
        user_prompt="user prompt",
    )

    result = gemini_provider.translate_with_gemini(config, request)

    assert client.calls[0][0].endswith("/chat/completions")
    assert client.calls[0][1]["Authorization"] == "Bearer secret-key"
    assert "x-goog-api-key" not in client.calls[0][1]
    assert client.calls[0][2] == {
        "model": "google/gemini-2.5-flash-lite",
        "messages": [
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "user prompt"},
        ],
        "temperature": 0.1,
        "max_tokens": gemini_provider.GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
    }
    assert result.translated_text == "OpenRouter translated text"
    assert result.finish_reason == "stop"
    assert result.usage == {
        "prompt_tokens": 12,
        "completion_tokens": 18,
        "total_tokens": 30,
    }


def test_gemini_adapter_maps_http_failures() -> None:
    config = ResolvedTranslationProviderConfig(
        provider="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-2.5-flash-lite",
        api_key="secret-key",
        timeout=45,
        enabled=True,
    )
    request = _build_request()

    auth_error = gemini_provider._map_gemini_http_error(
        status_code=401,
        detail="unauthorized",
        config=config,
        request=request,
    )
    rate_limit_error = gemini_provider._map_gemini_http_error(
        status_code=429,
        detail="limited",
        config=config,
        request=request,
    )
    upstream_error = gemini_provider._map_gemini_http_error(
        status_code=503,
        detail="server error",
        config=config,
        request=request,
    )

    assert auth_error.kind == TranslationProviderErrorKind.AUTH
    assert rate_limit_error.kind == TranslationProviderErrorKind.RATE_LIMIT
    assert rate_limit_error.retryable is True
    assert upstream_error.kind == TranslationProviderErrorKind.UPSTREAM
    assert upstream_error.retryable is True


def test_gemini_adapter_maps_empty_translation(monkeypatch) -> None:
    response = _DummyResponse(200, {"candidates": [{"content": {"parts": []}}]})
    client = _DummyClient(response)
    monkeypatch.setattr(gemini_provider.httpx, "Client", lambda timeout: client)

    config = ResolvedTranslationProviderConfig(
        provider="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-2.5-flash-lite",
        api_key="secret-key",
        timeout=45,
        enabled=True,
    )
    request = _build_request()

    with pytest.raises(gemini_provider.TranslationProviderError) as exc_info:
        gemini_provider.translate_with_gemini(config, request)

    assert exc_info.value.kind == TranslationProviderErrorKind.RESPONSE_INVALID
    assert exc_info.value.message == "Gemini returned an empty translation."
