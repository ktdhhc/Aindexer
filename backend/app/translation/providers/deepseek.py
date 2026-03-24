from __future__ import annotations

from collections.abc import Callable

import httpx

from ...services.provider_client import stream_chat_completion_with_metrics
from ..service import ResolvedTranslationProviderConfig
from .base import (
    TranslationProviderError,
    TranslationProviderErrorKind,
    TranslationProviderRequest,
    TranslationProviderResult,
)

DEESEEK_DEFAULT_MAX_TOKENS = 1200


def build_deepseek_payload(
    request: TranslationProviderRequest,
) -> dict[str, object]:
    payload = {
        "model": request.model,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": request.user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": DEESEEK_DEFAULT_MAX_TOKENS,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if request.enable_thinking:
        payload["thinking"] = {"type": "enabled"}
    return payload


def translate_with_deepseek(
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
    should_cancel: Callable[[], bool] | None = None,
) -> TranslationProviderResult:
    url = config.base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = build_deepseek_payload(request)

    try:
        stream_result = stream_chat_completion_with_metrics(
            url=url,
            headers=headers,
            payload=payload,
            timeout=config.timeout,
            should_cancel=should_cancel,
        )
        translated_text = stream_result.text.strip()
    except httpx.ReadTimeout as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.TIMEOUT,
            message="DeepSeek request timed out.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except httpx.ConnectError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="DeepSeek connection failed.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except UnicodeError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="DeepSeek base URL is invalid.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except RuntimeError as exc:
        raise _map_deepseek_runtime_error(exc, config=config, request=request) from exc

    if not translated_text:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message="DeepSeek returned an empty translation.",
            provider=config.provider,
            model=request.model,
        )

    return TranslationProviderResult(
        provider=config.provider,
        model=request.model,
        source_text=request.source_text,
        translated_text=translated_text,
        target_lang=request.target_lang,
        source_lang=request.source_lang,
        prompt_version=request.prompt_version,
        finish_reason=stream_result.finish_reason,
        usage=stream_result.usage,
        raw_response=stream_result.raw_response,
        first_token_ms=stream_result.first_token_ms,
        total_duration_ms=stream_result.total_duration_ms,
    )


def _map_deepseek_runtime_error(
    exc: RuntimeError,
    *,
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
) -> TranslationProviderError:
    message = str(exc)
    lowered = message.lower()

    if "cancelled by user" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.CANCELLED,
            message="DeepSeek request was cancelled.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "http 401" in lowered or "http 403" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.AUTH,
            message="DeepSeek authentication failed.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "http 429" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.RATE_LIMIT,
            message="DeepSeek rate limit reached.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "transport error" in lowered or "timed out" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.TIMEOUT,
            message="DeepSeek transport timed out.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "http 5" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message="DeepSeek upstream error.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "empty" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message="DeepSeek returned an empty response.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    return TranslationProviderError(
        kind=TranslationProviderErrorKind.UPSTREAM,
        message=message,
        provider=config.provider,
        model=request.model,
        cause=exc,
    )
