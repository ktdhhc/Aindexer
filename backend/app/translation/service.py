from __future__ import annotations

import hashlib
from dataclasses import dataclass
from importlib import import_module

from .cancellation import managed_cancel_token
from ..repository import get_provider_config_raw
from ..services.prompt_store import get_prompt
from ..services.provider_client import ProviderConfig
from .errors import TranslationErrorOut, TranslatorErrorCode
from .providers.base import (
    TranslationProviderError,
    TranslationProviderErrorKind,
    TranslationProviderResult,
    TranslationProviderRequest,
)
from .schemas import TranslationRequestIn, TranslationResponseOut

translation_repository = import_module("app.translation.repository")

TRANSLATION_TEMPERATURE = 0.1
MIN_TRANSLATION_SELECTION_CHARS = 40
TRANSLATION_SYSTEM_PROMPT = get_prompt(
    "translation_system_prompt.txt",
    "You are a precise academic translation assistant. Translate the selected passage into Simplified Chinese. Preserve meaning, terminology, citations, formulas, and tone. Output plain translated text only.",
)
TRANSLATION_USER_PROMPT_TEMPLATE = get_prompt(
    "translation_user_prompt_template.txt",
    "Translate the following selected passage into {target_lang}. If the source language differs, detect it automatically. Keep technical terms accurate and preserve inline citations.\n\nSelected passage:\n{source_text}",
)


@dataclass(slots=True)
class ResolvedTranslationProviderConfig:
    provider: str
    base_url: str
    model: str
    api_key: str
    timeout: int
    enabled: bool
    temperature: float = TRANSLATION_TEMPERATURE

    def to_provider_config(self) -> ProviderConfig:
        return ProviderConfig(
            provider=self.provider,
            base_url=self.base_url,
            model=self.model,
            api_key=self.api_key,
            temperature=self.temperature,
            timeout=self.timeout,
        )


def resolve_translation_provider(
    provider_name: str,
    model_override: str | None = None,
) -> ResolvedTranslationProviderConfig:
    raw = get_provider_config_raw(provider_name)
    if not raw:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.NOT_CONFIGURED,
            message="Provider configuration does not exist.",
            provider=provider_name,
        )
    if not bool(raw.get("enabled")):
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.NOT_CONFIGURED,
            message="Provider is disabled.",
            provider=provider_name,
        )
    api_key = str(raw.get("api_key_enc") or "").strip()
    if not api_key:
        raise TranslationProviderError(
            kind=TranslationProviderErrorKind.NOT_CONFIGURED,
            message="Provider API key is not configured.",
            provider=provider_name,
        )

    base_url = str(raw.get("base_url") or "").strip()
    model = (model_override or str(raw.get("model") or "")).strip()
    timeout = int(raw.get("timeout") or 120)
    return ResolvedTranslationProviderConfig(
        provider=provider_name,
        base_url=base_url,
        model=model,
        api_key=api_key,
        timeout=timeout,
        enabled=bool(raw.get("enabled")),
    )


def build_translation_provider_request(
    payload: TranslationRequestIn,
    *,
    resolved_model: str,
    system_prompt: str,
    user_prompt: str,
    request_id: str | None = None,
) -> TranslationProviderRequest:
    anchor = payload.anchor
    return TranslationProviderRequest(
        provider=payload.provider,
        model=resolved_model,
        source_text=payload.source_text,
        target_lang=payload.target_lang,
        prompt_version=payload.prompt_version,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        source_lang=payload.source_lang,
        document_id=payload.document_id,
        request_id=request_id,
        anchor_checksum=anchor.checksum if anchor else None,
        anchor_page=anchor.page if anchor else None,
        anchor_quote=anchor.quote if anchor else None,
        enable_thinking=payload.enable_thinking,
        metadata=dict(payload.metadata),
    )


def build_translation_cache_key(request: TranslationProviderRequest) -> str:
    normalized_source = normalize_selection_text(request.source_text)
    normalized_quote = normalize_selection_text(request.anchor_quote or "")
    stable_parts = [
        request.provider,
        request.model,
        request.target_lang,
        request.source_lang or "auto",
        request.prompt_version,
        normalized_source,
        request.anchor_checksum or "",
        str(request.anchor_page or ""),
        normalized_quote,
    ]
    raw = "\n".join(stable_parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_selection_text(text: str) -> str:
    return " ".join(str(text or "").replace("\n", " ").split())


def is_selection_long_enough(
    text: str,
    minimum_chars: int = MIN_TRANSLATION_SELECTION_CHARS,
) -> bool:
    return len(normalize_selection_text(text)) >= minimum_chars


def ensure_selection_long_enough(
    text: str,
    minimum_chars: int = MIN_TRANSLATION_SELECTION_CHARS,
) -> str:
    normalized = normalize_selection_text(text)
    if len(normalized) < minimum_chars:
        raise ValueError(
            f"Selection must contain at least {minimum_chars} visible characters."
        )
    return normalized


def map_provider_error_code(
    error: TranslationProviderError,
) -> TranslatorErrorCode:
    if error.kind == TranslationProviderErrorKind.TIMEOUT:
        return TranslatorErrorCode.PROVIDER_TIMEOUT
    if error.kind == TranslationProviderErrorKind.CANCELLED:
        return TranslatorErrorCode.STALE_REQUEST
    if error.kind == TranslationProviderErrorKind.NOT_CONFIGURED:
        return TranslatorErrorCode.PROVIDER_NOT_CONFIGURED
    if error.kind == TranslationProviderErrorKind.RESPONSE_INVALID:
        return TranslatorErrorCode.INVALID_REQUEST
    return TranslatorErrorCode.INVALID_REQUEST


def build_translation_prompts(payload: TranslationRequestIn) -> tuple[str, str]:
    system_prompt = TRANSLATION_SYSTEM_PROMPT
    user_prompt = TRANSLATION_USER_PROMPT_TEMPLATE.format(
        target_lang=payload.target_lang,
        source_text=normalize_selection_text(payload.source_text),
    )
    return system_prompt, user_prompt


def execute_translation_request(
    payload: TranslationRequestIn,
) -> TranslationResponseOut:
    document = translation_repository.get_translation_document(payload.document_id)
    if not document:
        raise ValueError("Translation document not found.")

    normalized_source = ensure_selection_long_enough(payload.source_text)
    system_prompt, user_prompt = build_translation_prompts(payload)
    resolved = resolve_translation_provider(payload.provider, payload.model)
    request = build_translation_provider_request(
        payload.model_copy(update={"source_text": normalized_source}),
        resolved_model=resolved.model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    cache_key = build_translation_cache_key(request)

    cached = translation_repository.find_completed_translation_by_cache_key(cache_key)
    if cached:
        cached_metrics = _extract_cached_metrics(cached.get("result_meta_json"))
        return TranslationResponseOut(
            request_id=str(cached["id"]),
            document_id=payload.document_id,
            provider=str(cached["provider"]),
            model=str(cached["model"]),
            target_lang=str(cached["target_lang"]),
            source_lang=cached.get("source_lang"),
            source_text=str(cached["source_text"]),
            translated_text=str(cached["translated_text"]),
            prompt_version=payload.prompt_version,
            cached=True,
            input_tokens=cached_metrics.get("input_tokens"),
            output_tokens=cached_metrics.get("output_tokens"),
            total_tokens=cached_metrics.get("total_tokens"),
            first_token_ms=cached_metrics.get("first_token_ms"),
            total_duration_ms=cached_metrics.get("total_duration_ms"),
            created_at=cached.get("created_at"),
            updated_at=cached.get("updated_at"),
        )

    request_id = translation_repository.create_translation_request(
        document_id=payload.document_id,
        provider=payload.provider,
        model=resolved.model,
        target_lang=payload.target_lang,
        source_text=normalized_source,
        cache_key=cache_key,
        source_lang=payload.source_lang,
        anchor=payload.anchor.model_dump() if payload.anchor else None,
        status="pending",
    )
    request.request_id = request_id

    client_request_id = (
        str(payload.metadata.get("client_request_id") or "").strip() or None
    )

    with managed_cancel_token(client_request_id) as should_cancel:
        try:
            result = _run_provider_translation(
                resolved, request, should_cancel=should_cancel
            )
        except TranslationProviderError as exc:
            error_code = map_provider_error_code(exc)
            translation_repository.save_translation_failure(
                request_id=request_id,
                error_code=error_code.value,
                error_message=str(exc),
            )
            raise

    translation_repository.save_translation_result(
        request_id=request_id,
        translated_text=result.translated_text,
        result_meta={
            "prompt_version": payload.prompt_version,
            "input_tokens": _usage_int(result.usage, "prompt_tokens"),
            "output_tokens": _usage_int(result.usage, "completion_tokens"),
            "total_tokens": _usage_int(result.usage, "total_tokens"),
            "first_token_ms": result.first_token_ms,
            "total_duration_ms": result.total_duration_ms,
        },
        status="completed",
    )
    return TranslationResponseOut(
        request_id=request_id,
        document_id=payload.document_id,
        provider=result.provider,
        model=result.model,
        target_lang=result.target_lang,
        source_lang=result.source_lang,
        source_text=result.source_text,
        translated_text=result.translated_text,
        prompt_version=result.prompt_version,
        cached=False,
        input_tokens=_usage_int(result.usage, "prompt_tokens"),
        output_tokens=_usage_int(result.usage, "completion_tokens"),
        total_tokens=_usage_int(result.usage, "total_tokens"),
        first_token_ms=result.first_token_ms,
        total_duration_ms=result.total_duration_ms,
    )


def build_translation_error(error: Exception) -> TranslationErrorOut:
    if isinstance(error, TranslationProviderError):
        code = map_provider_error_code(error)
        return TranslationErrorOut(code=code, message=str(error))
    message = str(error)
    if "at least" in message and "visible characters" in message:
        return TranslationErrorOut(
            code=TranslatorErrorCode.SELECTION_TOO_SHORT,
            message=message,
        )
    if "document not found" in message.lower():
        return TranslationErrorOut(
            code=TranslatorErrorCode.INVALID_REQUEST,
            message=message,
        )
    return TranslationErrorOut(
        code=TranslatorErrorCode.INVALID_REQUEST, message=message
    )


def _run_provider_translation(
    resolved: ResolvedTranslationProviderConfig,
    request: TranslationProviderRequest,
    should_cancel=None,
) -> TranslationProviderResult:
    if resolved.provider == "deepseek":
        deepseek_provider = import_module("app.translation.providers.deepseek")
        return deepseek_provider.translate_with_deepseek(
            resolved, request, should_cancel=should_cancel
        )
    if resolved.provider == "gemini":
        gemini_provider = import_module("app.translation.providers.gemini")
        return gemini_provider.translate_with_gemini(
            resolved, request, should_cancel=should_cancel
        )
    raise TranslationProviderError(
        kind=TranslationProviderErrorKind.NOT_CONFIGURED,
        message=f"Unsupported translation provider: {resolved.provider}",
        provider=resolved.provider,
        model=resolved.model,
    )


def _usage_int(usage: dict | None, key: str) -> int | None:
    if not isinstance(usage, dict):
        return None
    value = usage.get(key)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _extract_cached_metrics(
    raw_meta: str | dict | None,
) -> dict[str, int | float | None]:
    if raw_meta is None:
        return {}
    if isinstance(raw_meta, dict):
        meta = raw_meta
    else:
        import json

        try:
            meta = json.loads(raw_meta)
        except Exception:
            return {}
    if not isinstance(meta, dict):
        return {}
    return meta
