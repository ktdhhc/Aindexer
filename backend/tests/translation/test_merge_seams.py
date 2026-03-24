from __future__ import annotations

import importlib

from fastapi.testclient import TestClient

from app.main import create_app


def test_translation_router_and_contract_seams_exist() -> None:
    translation_schemas = importlib.import_module("app.translation.schemas")
    translation_providers = importlib.import_module("app.translation.providers")

    app = create_app()
    client = TestClient(app)

    health = client.get("/api/translation/health")

    assert health.status_code == 200
    assert hasattr(translation_schemas, "TranslationRequestIn")
    assert hasattr(translation_schemas, "TranslationResponseOut")
    assert hasattr(translation_providers, "TranslationProviderRequest")
    assert hasattr(translation_providers, "TranslationProviderResult")


def test_backend_contracts_do_not_depend_on_frontend_markup() -> None:
    translation_service = importlib.import_module("app.translation.service")
    translation_schemas = importlib.import_module("app.translation.schemas")

    payload = translation_schemas.TranslationRequestIn(
        document_id="tdoc_contract",
        provider="deepseek",
        model="deepseek-chat",
        source_text="This is a sufficiently long sample passage for backend seam verification.",
        target_lang="zh-CN",
        prompt_version="v1",
    )
    request = translation_service.build_translation_provider_request(
        payload,
        resolved_model="deepseek-chat",
        system_prompt="system",
        user_prompt="user",
    )
    cache_key = translation_service.build_translation_cache_key(request)

    assert request.document_id == "tdoc_contract"
    assert request.target_lang == "zh-CN"
    assert isinstance(cache_key, str)
    assert len(cache_key) == 64
