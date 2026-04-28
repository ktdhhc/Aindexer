from urllib.parse import urlparse

from app.provider_registry import (
    MODEL_NAME_REGISTRY_PATH,
    PROVIDER_REGISTRY_PATH,
    get_model_name_registry_entry,
    get_provider_registry_entry,
    load_model_name_registry_snapshot,
    load_provider_registry_snapshot,
    resolve_model_name_registry_entry,
)


def test_provider_registry_file_exists() -> None:
    assert PROVIDER_REGISTRY_PATH.exists()


def test_model_name_registry_file_exists() -> None:
    assert MODEL_NAME_REGISTRY_PATH.exists()


def test_provider_registry_snapshot_loads() -> None:
    snapshot = load_provider_registry_snapshot()

    assert snapshot["schema_version"] >= 1
    assert snapshot["providers"]


def test_model_name_registry_snapshot_loads() -> None:
    snapshot = load_model_name_registry_snapshot()

    assert snapshot["schema_version"] >= 1
    assert snapshot["models"]


def test_provider_registry_contains_expected_core_entries() -> None:
    for provider_id in [
        "anthropic",
        "gemini",
        "deepseek",
        "mistral",
        "cohere",
        "qwen",
        "glm",
        "moonshot",
    ]:
        entry = get_provider_registry_entry(provider_id)
        assert entry is not None
        assert entry["models"]


def test_provider_registry_base_urls_are_valid() -> None:
    snapshot = load_provider_registry_snapshot()

    for provider in snapshot["providers"]:
        for base_url in provider["base_urls"]:
            parsed = urlparse(base_url["url"])
            assert parsed.scheme in {"http", "https"}
            assert parsed.netloc


def test_provider_models_have_unique_ids_per_provider() -> None:
    snapshot = load_provider_registry_snapshot()

    for provider in snapshot["providers"]:
        model_ids = [model["id"] for model in provider["models"]]
        assert len(model_ids) == len(set(model_ids))


def test_model_name_registry_lookup_is_case_insensitive() -> None:
    entry = get_model_name_registry_entry("QWEN-PLUS")

    assert entry is not None
    assert entry["provider_id"] == "qwen"
    assert entry["provider_model_id"] == "qwen-plus"


def test_model_name_registry_can_resolve_alias_to_capabilities() -> None:
    resolved = resolve_model_name_registry_entry("mistral-large-latest")

    assert resolved is not None
    assert resolved["provider_id"] == "mistral"
    assert resolved["provider_model_id"] == "mistral-large-2512"
    assert resolved["supports_streaming"] is True
    assert resolved["context_window_tokens"] == 256000


def test_model_name_registry_can_resolve_exact_model_name() -> None:
    resolved = resolve_model_name_registry_entry("deepseek-reasoner")

    assert resolved is not None
    assert resolved["provider_id"] == "deepseek"
    assert resolved["provider_model_id"] == "deepseek-v4-flash"
    assert resolved["supports_thinking"] is True
    assert resolved["supports_streaming"] is True
