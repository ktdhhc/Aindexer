from __future__ import annotations

from collections.abc import Callable
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from ..service import ResolvedTranslationProviderConfig
from .base import (
    TranslationProviderError,
    TranslationProviderErrorKind,
    TranslationProviderRequest,
    TranslationProviderResult,
)

GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 1200
OPENROUTER_HOST = "openrouter.ai"


def build_gemini_payload(
    request: TranslationProviderRequest,
) -> dict[str, object]:
    payload = {
        "systemInstruction": {
            "parts": [{"text": request.system_prompt}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": request.user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
        },
    }
    if request.enable_thinking:
        payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 8192}
    return payload


def build_openrouter_payload(
    request: TranslationProviderRequest,
) -> dict[str, object]:
    payload = {
        "model": request.model,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": request.user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
    }
    if request.enable_thinking:
        payload["reasoning"] = {"effort": "high"}
    return payload


def is_openrouter_base_url(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").strip().lower()
    if not host:
        return False
    return host == OPENROUTER_HOST or host.endswith(f".{OPENROUTER_HOST}")


def build_gemini_url(config: ResolvedTranslationProviderConfig) -> str:
    base = config.base_url.rstrip("/")
    if ":generateContent" in base:
        return base
    if base.endswith("/models"):
        return f"{base}/{config.model}:generateContent"
    return f"{base}/models/{config.model}:generateContent"


def translate_with_gemini(
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
    should_cancel: Callable[[], bool] | None = None,
) -> TranslationProviderResult:
    if is_openrouter_base_url(config.base_url):
        return _translate_with_openrouter_compat(
            config,
            request,
            should_cancel=should_cancel,
        )

    if should_cancel and should_cancel():
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.CANCELLED,
            message="Gemini request was cancelled.",
            provider=config.provider,
            model=request.model,
        )

    url = build_gemini_url(config)
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": config.api_key,
    }
    payload = build_gemini_payload(request)
    started_at = time.perf_counter()

    try:
        with httpx.Client(timeout=config.timeout) as client:
            response = client.post(url, headers=headers, json=payload)
    except httpx.ReadTimeout as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.TIMEOUT,
            message="Gemini request timed out.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except httpx.ConnectError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="Gemini connection failed.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except UnicodeError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="Gemini base URL is invalid.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc

    if should_cancel and should_cancel():
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.CANCELLED,
            message="Gemini request was cancelled.",
            provider=config.provider,
            model=request.model,
        )

    if response.status_code >= 400:
        raise _map_gemini_http_error(
            status_code=response.status_code,
            detail=response.text,
            config=config,
            request=request,
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message="Gemini returned invalid JSON.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc

    translated_text = extract_gemini_text(body).strip()
    if not translated_text:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message="Gemini returned an empty translation.",
            provider=config.provider,
            model=request.model,
        )

    finish_reason = None
    candidates = body.get("candidates") or []
    if candidates and isinstance(candidates[0], dict):
        finish_reason = candidates[0].get("finishReason")

    usage_metadata = body.get("usageMetadata") or {}
    usage = (
        {
            "prompt_tokens": usage_metadata.get("promptTokenCount"),
            "completion_tokens": usage_metadata.get("candidatesTokenCount"),
            "total_tokens": usage_metadata.get("totalTokenCount"),
        }
        if isinstance(usage_metadata, dict)
        else None
    )
    total_duration_ms = (time.perf_counter() - started_at) * 1000.0

    return TranslationProviderResult(
        provider=config.provider,
        model=request.model,
        source_text=request.source_text,
        translated_text=translated_text,
        target_lang=request.target_lang,
        source_lang=request.source_lang,
        prompt_version=request.prompt_version,
        finish_reason=str(finish_reason) if finish_reason else None,
        usage=usage,
        raw_response=body,
        first_token_ms=total_duration_ms,
        total_duration_ms=total_duration_ms,
    )


def _translate_with_openrouter_compat(
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
    should_cancel: Callable[[], bool] | None = None,
) -> TranslationProviderResult:
    if should_cancel and should_cancel():
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.CANCELLED,
            message="Gemini request was cancelled.",
            provider=config.provider,
            model=request.model,
        )

    url = config.base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.api_key}",
    }
    payload = build_openrouter_payload(request)
    started_at = time.perf_counter()

    try:
        with httpx.Client(timeout=config.timeout) as client:
            response = client.post(url, headers=headers, json=payload)
    except httpx.ReadTimeout as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.TIMEOUT,
            message="Gemini request timed out.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except httpx.ConnectError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="Gemini connection failed.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except UnicodeError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="Gemini base URL is invalid.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc

    if should_cancel and should_cancel():
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.CANCELLED,
            message="Gemini request was cancelled.",
            provider=config.provider,
            model=request.model,
        )

    if response.status_code >= 400:
        raise _map_gemini_http_error(
            status_code=response.status_code,
            detail=response.text,
            config=config,
            request=request,
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message="Gemini returned invalid JSON.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc

    translated_text = extract_openrouter_text(body).strip()
    if not translated_text:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message="Gemini returned an empty translation.",
            provider=config.provider,
            model=request.model,
        )

    finish_reason = None
    choices = body.get("choices") or []
    if choices and isinstance(choices[0], dict):
        finish_reason = choices[0].get("finish_reason")

    usage = body.get("usage")
    usage_dict = usage if isinstance(usage, dict) else None
    total_duration_ms = (time.perf_counter() - started_at) * 1000.0

    return TranslationProviderResult(
        provider=config.provider,
        model=request.model,
        source_text=request.source_text,
        translated_text=translated_text,
        target_lang=request.target_lang,
        source_lang=request.source_lang,
        prompt_version=request.prompt_version,
        finish_reason=str(finish_reason) if finish_reason else None,
        usage=usage_dict,
        raw_response=body,
        first_token_ms=total_duration_ms,
        total_duration_ms=total_duration_ms,
    )


def extract_gemini_text(body: dict[str, Any]) -> str:
    candidates = body.get("candidates") or []
    if not candidates:
        return ""
    first = candidates[0] if isinstance(candidates[0], dict) else {}
    content = first.get("content") or {}
    parts = content.get("parts") or []
    texts: list[str] = []
    for part in parts:
        if isinstance(part, dict):
            text = part.get("text")
            if isinstance(text, str) and text:
                texts.append(text)
    return "\n".join(texts).strip()


def extract_openrouter_text(body: dict[str, Any]) -> str:
    choices = body.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    first = choices[0]
    message = first.get("message") or {}
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts: list[str] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                text = part.get("text")
                if isinstance(text, str) and text:
                    texts.append(text)
            if texts:
                return "\n".join(texts)
    direct_text = first.get("text")
    if isinstance(direct_text, str):
        return direct_text
    return ""


def _map_gemini_http_error(
    *,
    status_code: int,
    detail: str,
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
) -> TranslationProviderError:
    if status_code in {401, 403}:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.AUTH,
            message="Gemini authentication failed.",
            provider=config.provider,
            model=request.model,
        )
    if status_code == 429:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.RATE_LIMIT,
            message="Gemini rate limit reached.",
            retryable=True,
            provider=config.provider,
            model=request.model,
        )
    if status_code >= 500:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="Gemini upstream error.",
            retryable=True,
            provider=config.provider,
            model=request.model,
        )
    return TranslationProviderError(
        kind=TranslationProviderErrorKind.UPSTREAM,
        message=f"Gemini request failed: HTTP {status_code}: {detail[:200]}",
        provider=config.provider,
        model=request.model,
    )
