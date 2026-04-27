from __future__ import annotations

import importlib

import pytest
from pydantic import ValidationError

translation_errors = importlib.import_module("app.translation.errors")
translation_schemas = importlib.import_module("app.translation.schemas")


def test_translation_contracts_accept_valid_payloads() -> None:
    anchor = translation_schemas.SelectionAnchor(
        page=2,
        quote="This is a sufficiently long sample passage for translation.",
        rects=[
            {"page": 2, "x": 10, "y": 12, "width": 100, "height": 18},
        ],
        start_offset=0,
        end_offset=55,
    )
    payload = translation_schemas.TranslationRequestIn(
        document_id="tdoc_123",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for translation.",
        target_lang="zh-CN",
        prompt_version="v1",
        anchor=anchor,
    )
    response = translation_schemas.TranslationResponseOut(
        request_id="treq_123",
        document_id="tdoc_123",
        provider="deepseek",
        model="deepseek-chat",
        source_text=payload.source_text,
        translated_text="这是一个足够长的示例段落，用于翻译。",
        target_lang="zh-CN",
        prompt_version="v1",
    )

    assert payload.anchor is not None
    assert payload.anchor.page == 2
    assert response.provider == "deepseek"
    assert response.translated_text == "这是一个足够长的示例段落，用于翻译。"


def test_translation_contracts_reject_invalid_anchor() -> None:
    with pytest.raises(ValidationError):
        translation_schemas.SelectionAnchor(page=1, quote="   ")

    with pytest.raises(ValidationError):
        translation_schemas.SelectionAnchor(
            page=1,
            quote="valid",
            start_offset=10,
            end_offset=5,
        )


def test_translation_contracts_reject_empty_request_fields() -> None:
    with pytest.raises(ValidationError):
        translation_schemas.TranslationRequestIn(
            document_id=" ",
            provider="deepseek",
            source_text="valid text",
        )

    with pytest.raises(ValidationError):
        translation_schemas.TranslationRequestIn(
            document_id="tdoc_123",
            provider="deepseek",
            source_text="   ",
        )


def test_translation_error_payloads_are_machine_readable() -> None:
    error = translation_errors.TranslationErrorOut(
        code=translation_errors.TranslatorErrorCode.SELECTION_TOO_SHORT,
        message="Selection must contain at least 40 visible characters.",
    )

    assert error.code == translation_errors.TranslatorErrorCode.SELECTION_TOO_SHORT
    assert error.model_dump() == {
        "code": "selection_too_short",
        "message": "Selection must contain at least 40 visible characters.",
    }
