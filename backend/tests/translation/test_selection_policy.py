from __future__ import annotations

from app.translation.schemas import SelectionAnchor, TranslationRequestIn
from app.translation.service import (
    MIN_TRANSLATION_SELECTION_CHARS,
    build_translation_cache_key,
    build_translation_provider_request,
    ensure_selection_long_enough,
    is_selection_long_enough,
    normalize_selection_text,
)


def test_selection_policy_normalizes_and_accepts_long_text() -> None:
    raw_text = (
        "This   is a sufficiently long sample passage\nfor translation policy checks."
    )

    normalized = normalize_selection_text(raw_text)
    assert (
        normalized
        == "This is a sufficiently long sample passage for translation policy checks."
    )
    assert is_selection_long_enough(raw_text) is True
    assert ensure_selection_long_enough(raw_text) == normalized


def test_selection_policy_accepts_short_text() -> None:
    short_text = "too short"

    assert MIN_TRANSLATION_SELECTION_CHARS == 0
    assert is_selection_long_enough(short_text) is True
    assert ensure_selection_long_enough(short_text) == short_text


def test_selection_policy_accepts_empty_text() -> None:
    assert is_selection_long_enough("") is True
    assert ensure_selection_long_enough("   ") == ""


def test_selection_policy_cache_key_changes_with_provider_model_and_prompt() -> None:
    payload = TranslationRequestIn(
        document_id="tdoc_1",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation policy checks.",
        target_lang="zh-CN",
        prompt_version="v1",
        anchor=SelectionAnchor(
            page=1,
            quote="This is a sufficiently long sample passage for translation policy checks.",
            checksum="chk-1",
        ),
    )

    request_a = build_translation_provider_request(
        payload,
        resolved_model="deepseek-chat",
        system_prompt="system",
        user_prompt="user",
    )
    key_a = build_translation_cache_key(request_a)

    request_b = build_translation_provider_request(
        payload.model_copy(update={"provider": "gemini"}),
        resolved_model="gemini-2.5-flash-lite",
        system_prompt="system",
        user_prompt="user",
    )
    key_b = build_translation_cache_key(request_b)

    request_c = build_translation_provider_request(
        payload.model_copy(update={"prompt_version": "v2"}),
        resolved_model="deepseek-chat",
        system_prompt="system",
        user_prompt="user",
    )
    key_c = build_translation_cache_key(request_c)

    assert key_a != key_b
    assert key_a != key_c


def test_selection_policy_cache_key_ignores_ui_noise() -> None:
    payload_a = TranslationRequestIn(
        document_id="tdoc_1",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This   is a sufficiently long sample passage for translation policy checks.",
        target_lang="zh-CN",
        prompt_version="v1",
        anchor=SelectionAnchor(
            page=1,
            quote="This is a sufficiently long sample passage for translation policy checks.",
            checksum="chk-1",
        ),
        metadata={"selectionColor": "yellow"},
    )
    payload_b = TranslationRequestIn(
        document_id="tdoc_2",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation policy checks.",
        target_lang="zh-CN",
        prompt_version="v1",
        anchor=SelectionAnchor(
            page=1,
            quote="This is a sufficiently long sample passage for translation policy checks.",
            checksum="chk-1",
        ),
        metadata={"selectionColor": "blue"},
    )

    key_a = build_translation_cache_key(
        build_translation_provider_request(
            payload_a,
            resolved_model="deepseek-chat",
            system_prompt="system",
            user_prompt="user",
        )
    )
    key_b = build_translation_cache_key(
        build_translation_provider_request(
            payload_b,
            resolved_model="deepseek-chat",
            system_prompt="system",
            user_prompt="user",
        )
    )

    assert key_a == key_b
