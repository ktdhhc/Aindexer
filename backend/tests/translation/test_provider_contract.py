from __future__ import annotations

import importlib

import app.repository as app_repository
import app.translation.service as translation_service
from app.translation.providers.base import (
    TranslationProviderError,
    TranslationProviderErrorKind,
    TranslationProviderResult,
)
from app.translation.schemas import SelectionAnchor, SelectionRect, TranslationRequestIn


def test_translation_provider_request_and_cache_key_are_normalized() -> None:
    payload = TranslationRequestIn(
        document_id="tdoc_123",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This   is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        anchor=SelectionAnchor(
            page=1,
            quote="This   is a sufficiently long sample passage for translation.",
            checksum="chk-1",
        ),
    )

    request = translation_service.build_translation_provider_request(
        payload,
        resolved_model="deepseek-chat",
        system_prompt="system",
        user_prompt="user",
        request_id="treq_1",
    )
    cache_key_a = translation_service.build_translation_cache_key(request)

    payload_b = TranslationRequestIn(
        document_id="tdoc_other",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        anchor=SelectionAnchor(
            page=1,
            quote="This is a sufficiently long sample passage for translation.",
            checksum="chk-1",
            rects=[SelectionRect(page=1, x=1, y=2, width=3, height=4)],
        ),
        metadata={"ui_only": True},
    )
    request_b = translation_service.build_translation_provider_request(
        payload_b,
        resolved_model="deepseek-chat",
        system_prompt="system",
        user_prompt="user",
        request_id="treq_2",
    )
    cache_key_b = translation_service.build_translation_cache_key(request_b)

    assert request.request_id == "treq_1"
    assert request.model == "deepseek-chat"
    assert cache_key_a == cache_key_b


def test_translation_provider_error_mapping_is_stable() -> None:
    timeout_error = TranslationProviderError(
        kind=TranslationProviderErrorKind.TIMEOUT,
        message="timeout",
        retryable=True,
        provider="deepseek",
        model="deepseek-chat",
    )
    stale_error = TranslationProviderError(
        kind=TranslationProviderErrorKind.CANCELLED,
        message="cancelled",
    )
    missing_error = TranslationProviderError(
        kind=TranslationProviderErrorKind.NOT_CONFIGURED,
        message="missing",
    )

    assert (
        translation_service.map_provider_error_code(timeout_error).value
        == "provider_timeout"
    )
    assert (
        translation_service.map_provider_error_code(stale_error).value
        == "stale_request"
    )
    assert (
        translation_service.map_provider_error_code(missing_error).value
        == "provider_not_configured"
    )


def test_resolve_translation_provider_uses_repo_config(monkeypatch) -> None:
    def fake_get_provider_config_raw(provider: str):
        if provider != "deepseek":
            return None
        return {
            "provider": "deepseek",
            "base_url": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
            "api_key_enc": "secret-key",
            "temperature": 0.8,
            "timeout": 90,
            "enabled": 1,
        }

    monkeypatch.setattr(
        app_repository, "get_provider_config_raw", fake_get_provider_config_raw
    )
    monkeypatch.setattr(
        translation_service,
        "get_provider_config_raw",
        fake_get_provider_config_raw,
    )

    resolved = translation_service.resolve_translation_provider("deepseek")
    provider_cfg = resolved.to_provider_config()

    assert resolved.base_url == "https://api.deepseek.com/v1"
    assert resolved.model == "deepseek-chat"
    assert resolved.temperature == translation_service.TRANSLATION_TEMPERATURE
    assert provider_cfg.api_key == "secret-key"


def test_provider_result_shape_is_normalized() -> None:
    result = TranslationProviderResult(
        provider="gemini",
        model="gemini-2.5-flash-lite",
        source_text="Source text",
        translated_text="翻译结果",
        target_lang="zh-CN",
        prompt_version="v1",
        usage={"total_tokens": 42},
    )

    assert result.provider == "gemini"
    assert result.translated_text == "翻译结果"
    assert result.usage == {"total_tokens": 42}
