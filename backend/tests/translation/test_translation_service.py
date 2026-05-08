from __future__ import annotations

import app.translation.service as translation_service
from app.translation.providers.base import TranslationProviderRequest
from app.translation.schemas import TranslationRequestIn


def test_build_translation_prompts_reads_prompt_files_and_uses_simplified_chinese(
    monkeypatch,
) -> None:
    def fake_get_required_prompt(name: str) -> str:
        prompts = {
            "translation_system_prompt.txt": "system from file",
            "translation_user_prompt_template.txt": "Translate to {target_lang}:\n\n{source_text}",
        }
        return prompts[name]

    monkeypatch.setattr(translation_service, "get_required_prompt", fake_get_required_prompt)

    payload = TranslationRequestIn(
        document_id="tdoc_prompt",
        provider="deepseek",
        model="deepseek-chat",
        source_text="Example source text.\n\nSecond paragraph.",
        target_lang="zh-CN",
    )

    system_prompt, user_prompt = translation_service.build_translation_prompts(payload)

    assert system_prompt == "system from file"
    assert user_prompt == "Translate to 简体中文:\n\nExample source text.\n\nSecond paragraph."


def test_normalize_selection_text_preserves_paragraph_boundaries() -> None:
    raw_text = "First line\nsecond line\n\nThird  paragraph"

    assert (
        translation_service.normalize_selection_text(raw_text)
        == "First line second line\n\nThird paragraph"
    )


def test_translation_cache_key_changes_with_prompt_content() -> None:
    base_request = TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text="Example source text.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system one",
        user_prompt="user one",
        metadata={"workspace_id": "ws_default"},
    )
    changed_prompt_request = TranslationProviderRequest(
        provider="deepseek",
        model="deepseek-chat",
        source_text="Example source text.",
        target_lang="zh-CN",
        prompt_version="v1",
        system_prompt="system two",
        user_prompt="user one",
        metadata={"workspace_id": "ws_default"},
    )

    first_key = translation_service.build_translation_cache_key(base_request)
    second_key = translation_service.build_translation_cache_key(changed_prompt_request)

    assert first_key != second_key


def test_sanitize_translated_text_strips_prompt_echo_prefixes() -> None:
    raw = (
        "如果源语言有所不同，请自动进行判断。\n"
        "请确保技术用语的准确性，并保留内嵌的引用和公式。\n\n"
        "**所选段落：**\n\n"
        "最终译文"
    )

    assert translation_service.sanitize_translated_text(raw) == "最终译文"
