from __future__ import annotations

from collections.abc import Callable
from urllib.parse import urlparse

import httpx

from ...services.provider_client import stream_chat_completion_with_metrics
from ..service import ResolvedTranslationProviderConfig
from .base import (
    TranslationProviderError,
    TranslationProviderErrorKind,
    TranslationProviderRequest,
    TranslationProviderResult,
)

OPENAI_COMPAT_DEFAULT_MAX_TOKENS = 8192
OPENROUTER_HOST = "openrouter.ai"


def build_openai_compatible_payload(
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": request.model,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": request.user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": OPENAI_COMPAT_DEFAULT_MAX_TOKENS,
        "stream": True,
    }
    if request.enable_thinking:
        provider_name = str(config.provider or "").strip().lower()
        if provider_name == "deepseek":
            payload["thinking"] = {"type": "enabled"}
        elif is_openrouter_base_url(config.base_url):
            payload["reasoning"] = {"effort": "high"}
    return payload


def is_openrouter_base_url(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").strip().lower()
    if not host:
        return False
    return host == OPENROUTER_HOST or host.endswith(f".{OPENROUTER_HOST}")


def translate_with_openai_compatible(
    config: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
    should_cancel: Callable[[], bool] | None = None,
) -> TranslationProviderResult:
    url = config.base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    payload = build_openai_compatible_payload(config, request)

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
            message=f"{config.provider} request timed out.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except httpx.ConnectError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message=f"{config.provider} connection failed.",
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except UnicodeError as exc:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message=f"{config.provider} base URL is invalid.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        ) from exc
    except RuntimeError as exc:
        raise _map_openai_compatible_runtime_error(
            exc,
            config=config,
            request=request,
        ) from exc

    if not translated_text:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message=f"{config.provider} returned an empty translation.",
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


def _map_openai_compatible_runtime_error(
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
            message=f"{config.provider} request was cancelled.",
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "401" in lowered or "403" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.AUTH,
            message=message,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "429" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.RATE_LIMIT,
            message=message,
            retryable=True,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "llm流式响应为空" in lowered or "empty translation" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message=message,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if "502" in lowered or "503" in lowered or "504" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.UPSTREAM,
            message=message,
            retryable=True,
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
