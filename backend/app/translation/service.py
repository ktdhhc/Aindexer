from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from importlib import import_module
from urllib.parse import urlparse

from .cancellation import managed_cancel_token
from ..repository import get_provider_config_raw
from ..provider_registry import resolve_model_name_registry_entry
from ..services.prompt_store import get_required_prompt
from ..services.provider_client import ProviderClient
from ..services.provider_client import ProviderConfig
from ..services.usage_tracker import record_llm_usage
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
MIN_TRANSLATION_SELECTION_CHARS = 0

TRANSLATION_PREFIX_PATTERNS = (
    re.compile(
        r"^\s*(?:translate\s+the\s+following\s+(?:selected\s+)?(?:passage|segment)\s+into\s+.+?without\s+additional\s+explanation\.?|please\s+translate\s+the\s+following\s+.+?)\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:if\s+the\s+source\s+language\s+differs,?\s*detect\s+it\s+automatically\.?|keep\s+technical\s+terms\s+accurate\s+and\s+preserve\s+inline\s+citations\.?|output\s+plain\s+translated\s+text\s+only\.?)\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*如果源语[言言]有所不同[^\n。！？]*[。！？]?\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:请确保技术用语的准确性(?:，?并保留(?:所有)?内嵌的引用和公式(?:内容)?)?|技术用语必须保持准确性(?:，?并保留(?:所有)?内嵌的引用和公式(?:内容)?)?)\s*[。！？]?\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*如果源語言有所不同[^\n。！？]*[。！？]?\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:請確保技術用語的準確性(?:，?並保留(?:所有)?內嵌的引用和公式(?:內容)?)?|技術用語必須保持準確性(?:，?並保留(?:所有)?內嵌的引用和公式(?:內容)?)?)\s*[。！？]?\s*",
        re.IGNORECASE,
    ),
    re.compile(
        r"^\s*(?:\*\*\s*)?(?:selected\s+(?:passage|segment)|所选段落|所選段落|所选片段|所選片段|选出段落|選出段落|选定段落|選定段落|选段|選段)\s*[:：]?\s*(?:\*\*)?\s*[:：]?\s*",
        re.IGNORECASE,
    ),
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
    prompt_digest = hashlib.sha256(
        f"{request.system_prompt}\n---\n{request.user_prompt}".encode("utf-8")
    ).hexdigest()
    stable_parts = [
        request.metadata.get("workspace_id") or "ws_default",
        request.provider,
        request.model,
        request.target_lang,
        request.source_lang or "auto",
        request.prompt_version,
        prompt_digest,
        normalized_source,
        request.anchor_checksum or "",
        str(request.anchor_page or ""),
        normalized_quote,
    ]
    raw = "\n".join(stable_parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def normalize_selection_text(text: str) -> str:
    return "\n\n".join(
        paragraph
        for paragraph in (
            re.sub(r"\s*\n\s*", " ", re.sub(r"[^\S\n]+", " ", part)).strip()
            for part in re.split(r"\n\s*\n+", str(text or "").replace("\r\n", "\n").replace("\r", "\n"))
        )
        if paragraph
    )


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
    system_prompt = get_required_prompt("translation_system_prompt.txt")
    user_prompt_template = get_required_prompt("translation_user_prompt_template.txt")
    user_prompt = user_prompt_template.format(
        target_lang=render_target_lang_prompt_value(payload.target_lang),
        source_text=normalize_selection_text(payload.source_text),
    )
    return system_prompt, user_prompt


def render_target_lang_prompt_value(target_lang: str) -> str:
    normalized = str(target_lang or "").strip()
    aliases = {
        "zh-cn": "简体中文",
        "zh-hans": "简体中文",
        "zh-tw": "繁體中文",
        "zh-hant": "繁體中文",
        "en": "English",
        "ja": "日本語",
        "ko": "한국어",
        "fr": "Français",
        "de": "Deutsch",
    }
    return aliases.get(normalized.lower(), normalized or "中文")


def execute_translation_request(
    payload: TranslationRequestIn,
) -> TranslationResponseOut:
    workspace_id = str(payload.workspace_id or "ws_default").strip() or "ws_default"
    document = translation_repository.get_translation_document_in_workspace(
        payload.document_id,
        workspace_id,
    )
    if not document:
        from ..repository import get_document as get_main_document

        document = get_main_document(payload.document_id, workspace_id=workspace_id)
    if not document:
        raise ValueError("Document not found.")

    normalized_source = ensure_selection_long_enough(payload.source_text)
    system_prompt, user_prompt = build_translation_prompts(payload)
    resolved = resolve_translation_provider(payload.provider, payload.model)
    request = build_translation_provider_request(
        payload.model_copy(
            update={
                "source_text": normalized_source,
                "metadata": {**dict(payload.metadata), "workspace_id": workspace_id},
            }
        ),
        resolved_model=resolved.model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    cache_key = build_translation_cache_key(request)

    cached = translation_repository.find_completed_translation_by_cache_key(
        cache_key,
        workspace_id=workspace_id,
    )
    if cached:
        cached_metrics = _extract_cached_metrics(cached.get("result_meta_json"))
        cleaned_cached_text = sanitize_translated_text(str(cached["translated_text"]))
        return TranslationResponseOut(
            request_id=str(cached["id"]),
            document_id=payload.document_id,
            provider=str(cached["provider"]),
            model=str(cached["model"]),
            target_lang=str(cached["target_lang"]),
            source_lang=cached.get("source_lang"),
            source_text=str(cached["source_text"]),
            translated_text=cleaned_cached_text,
            prompt_version=payload.prompt_version,
            cached=True,
            input_tokens=_as_int(cached_metrics.get("input_tokens")),
            output_tokens=_as_int(cached_metrics.get("output_tokens")),
            total_tokens=_as_int(cached_metrics.get("total_tokens")),
            first_token_ms=_as_float(cached_metrics.get("first_token_ms")),
            total_duration_ms=_as_float(cached_metrics.get("total_duration_ms")),
            created_at=cached.get("created_at"),
            updated_at=cached.get("updated_at"),
        )

    request_id = translation_repository.create_translation_request(
        workspace_id=workspace_id,
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

    cleaned_translated_text = sanitize_translated_text(result.translated_text)
    result.translated_text = cleaned_translated_text
    record_llm_usage(
        workspace_id=workspace_id,
        feature="translation",
        operation="translation_request",
        provider_cfg=resolved.to_provider_config(),
        input_text=system_prompt + "\n" + user_prompt,
        output_text=cleaned_translated_text,
        usage=result.usage,
        duration_ms=result.total_duration_ms,
        request_id=request_id,
    )

    translation_repository.save_translation_result(
        request_id=request_id,
        translated_text=cleaned_translated_text,
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
        translated_text=cleaned_translated_text,
        prompt_version=result.prompt_version,
        cached=False,
        input_tokens=_usage_int(result.usage, "prompt_tokens"),
        output_tokens=_usage_int(result.usage, "completion_tokens"),
        total_tokens=_usage_int(result.usage, "total_tokens"),
        first_token_ms=result.first_token_ms,
        total_duration_ms=result.total_duration_ms,
    )


def stream_translation_request(payload: TranslationRequestIn):
    workspace_id = str(payload.workspace_id or "ws_default").strip() or "ws_default"
    document = translation_repository.get_translation_document_in_workspace(
        payload.document_id,
        workspace_id,
    )
    if not document:
        from ..repository import get_document as get_main_document

        document = get_main_document(payload.document_id, workspace_id=workspace_id)
    if not document:
        raise ValueError("Document not found.")

    normalized_source = ensure_selection_long_enough(payload.source_text)
    system_prompt, user_prompt = build_translation_prompts(payload)
    resolved = resolve_translation_provider(payload.provider, payload.model)
    if not translation_streaming_supported(resolved.provider, resolved.model, resolved.base_url):
        raise ValueError("当前模型未标记为支持流式输出，或当前 provider 路径不支持流式翻译")

    request = build_translation_provider_request(
        payload.model_copy(
            update={
                "source_text": normalized_source,
                "metadata": {**dict(payload.metadata), "workspace_id": workspace_id},
            }
        ),
        resolved_model=resolved.model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    cache_key = build_translation_cache_key(request)

    cached = translation_repository.find_completed_translation_by_cache_key(
        cache_key,
        workspace_id=workspace_id,
    )
    request_id = None if cached else translation_repository.create_translation_request(
        workspace_id=workspace_id,
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

    def generate():
        if cached:
            cached_metrics = _extract_cached_metrics(cached.get("result_meta_json"))
            response = TranslationResponseOut(
                request_id=str(cached["id"]),
                document_id=payload.document_id,
                provider=str(cached["provider"]),
                model=str(cached["model"]),
                target_lang=str(cached["target_lang"]),
                source_lang=cached.get("source_lang"),
                source_text=str(cached["source_text"]),
                translated_text=sanitize_translated_text(str(cached["translated_text"])),
                prompt_version=payload.prompt_version,
                cached=True,
                input_tokens=_as_int(cached_metrics.get("input_tokens")),
                output_tokens=_as_int(cached_metrics.get("output_tokens")),
                total_tokens=_as_int(cached_metrics.get("total_tokens")),
                first_token_ms=_as_float(cached_metrics.get("first_token_ms")),
                total_duration_ms=_as_float(cached_metrics.get("total_duration_ms")),
                created_at=cached.get("created_at"),
                updated_at=cached.get("updated_at"),
            )
            yield _stream_event({"type": "meta", "cached": True, "request_id": response.request_id})
            if response.translated_text:
                yield _stream_event({"type": "delta", "text": response.translated_text})
            yield _stream_event({"type": "done", **response.model_dump()})
            return

        assert request_id is not None
        yield _stream_event({"type": "meta", "cached": False, "request_id": request_id})

        started_at = time.perf_counter()
        first_token_ms: float | None = None
        finish_reason_holder: dict[str, str | None] = {"value": None}
        raw_text = ""
        emitted_text = ""

        def capture_finish_reason(reason: str | None) -> None:
            finish_reason_holder["value"] = reason

        with managed_cancel_token(client_request_id) as should_cancel:
            try:
                for chunk in ProviderClient.stream_text(
                    config=resolved.to_provider_config(),
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    should_cancel=should_cancel,
                    on_finish=capture_finish_reason,
                ):
                    if chunk and first_token_ms is None:
                        first_token_ms = (time.perf_counter() - started_at) * 1000.0
                    raw_text += chunk
                    cleaned_text = sanitize_translated_text(raw_text)
                    if not cleaned_text or not cleaned_text.startswith(emitted_text):
                        continue
                    next_delta = cleaned_text[len(emitted_text) :]
                    if next_delta:
                        emitted_text = cleaned_text
                        yield _stream_event({"type": "delta", "text": next_delta})
            except Exception as exc:
                provider_error = _map_streaming_runtime_error(
                    exc, config=resolved, request=request
                )
                error_code = map_provider_error_code(provider_error)
                translation_repository.save_translation_failure(
                    request_id=request_id,
                    error_code=error_code.value,
                    error_message=str(provider_error),
                )
                yield _stream_event(
                    {
                        "type": "error",
                        "message": str(provider_error),
                        "code": error_code.value,
                    }
                )
                return

        cleaned_translated_text = sanitize_translated_text(raw_text)
        total_duration_ms = (time.perf_counter() - started_at) * 1000.0
        record_llm_usage(
            workspace_id=workspace_id,
            feature="translation",
            operation="translation_stream",
            provider_cfg=resolved.to_provider_config(),
            input_text=system_prompt + "\n" + user_prompt,
            output_text=cleaned_translated_text,
            duration_ms=total_duration_ms,
            request_id=request_id,
        )
        translation_repository.save_translation_result(
            request_id=request_id,
            translated_text=cleaned_translated_text,
            result_meta={
                "prompt_version": payload.prompt_version,
                "first_token_ms": first_token_ms,
                "total_duration_ms": total_duration_ms,
            },
            status="completed",
        )
        response = TranslationResponseOut(
            request_id=request_id,
            document_id=payload.document_id,
            provider=resolved.provider,
            model=resolved.model,
            target_lang=payload.target_lang,
            source_lang=payload.source_lang,
            source_text=normalized_source,
            translated_text=cleaned_translated_text,
            prompt_version=payload.prompt_version,
            cached=False,
            first_token_ms=first_token_ms,
            total_duration_ms=total_duration_ms,
        )
        yield _stream_event(
            {
                "type": "done",
                "finish_reason": finish_reason_holder.get("value"),
                **response.model_dump(),
            }
        )

    return generate()


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
    if _uses_native_gemini_translation_api(resolved):
        gemini_provider = import_module("app.translation.providers.gemini")
        return gemini_provider.translate_with_gemini(
            resolved, request, should_cancel=should_cancel
        )
    openai_compatible_provider = import_module(
        "app.translation.providers.openai_compatible"
    )
    return openai_compatible_provider.translate_with_openai_compatible(
        resolved,
        request,
        should_cancel=should_cancel,
    )


def translation_streaming_supported(
    provider: str, model: str, base_url: str | None = None
) -> bool:
    resolved = resolve_model_name_registry_entry(model)
    if resolved and resolved.get("supports_streaming") is False:
        return False
    if str(provider or "").strip().lower() == "gemini" and _uses_native_gemini_translation_api(
        ResolvedTranslationProviderConfig(
            provider=provider,
            base_url=str(base_url or ""),
            model=model,
            api_key="",
            timeout=120,
            enabled=True,
        )
    ):
        return False
    return True


def _map_streaming_runtime_error(
    exc: Exception,
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
    if "empty translation" in lowered or "流式响应为空" in lowered:
        return TranslationProviderError(
            kind=TranslationProviderErrorKind.RESPONSE_INVALID,
            message=message,
            provider=config.provider,
            model=request.model,
            cause=exc,
        )
    if any(code in lowered for code in {"500", "502", "503", "504"}):
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


def _stream_event(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def sanitize_translated_text(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return cleaned

    changed = True
    while changed and cleaned:
        changed = False
        for pattern in TRANSLATION_PREFIX_PATTERNS:
            next_text, count = pattern.subn("", cleaned, count=1)
            if count:
                cleaned = next_text.lstrip()
                changed = True

    return cleaned.strip()


def _uses_native_gemini_translation_api(
    resolved: ResolvedTranslationProviderConfig,
) -> bool:
    if str(resolved.provider or "").strip().lower() != "gemini":
        return False
    base_url = str(resolved.base_url or "").strip().lower()
    if not base_url:
        return False
    host = (urlparse(base_url).hostname or "").strip().lower()
    return host == "generativelanguage.googleapis.com" or ":generatecontent" in base_url


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
) -> dict[str, object]:
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


def _as_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return None


def _as_float(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None
