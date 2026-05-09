from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ..config import BACKEND_ROOT


REGISTRY_DIR = BACKEND_ROOT / "app" / "provider_registry"
PROVIDER_REGISTRY_PATH = REGISTRY_DIR / "provider_model_registry.json"
MODEL_NAME_REGISTRY_PATH = REGISTRY_DIR / "model_name_registry.json"

# Backward compatibility for earlier imports/tests.
REGISTRY_PATH = PROVIDER_REGISTRY_PATH


def load_provider_registry_snapshot() -> dict[str, Any]:
    with PROVIDER_REGISTRY_PATH.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    _validate_provider_registry_snapshot(payload)
    return payload


@lru_cache(maxsize=1)
def get_provider_registry_snapshot() -> dict[str, Any]:
    return load_provider_registry_snapshot()


def list_provider_registry_entries() -> list[dict[str, Any]]:
    snapshot = get_provider_registry_snapshot()
    providers = snapshot.get("providers")
    return list(providers) if isinstance(providers, list) else []


def get_provider_registry_entry(provider_id: str) -> dict[str, Any] | None:
    target = _normalize_key(provider_id)
    if not target:
        return None
    for entry in list_provider_registry_entries():
        if _normalize_key(entry.get("id")) == target:
            return entry
    return None


def get_provider_model_registry_entry(provider_id: str, model_id: str) -> dict[str, Any] | None:
    provider = get_provider_registry_entry(provider_id)
    if not provider:
        return None
    target_model = _normalize_key(model_id)
    for model in provider.get("models", []):
        if _normalize_key(model.get("id")) == target_model:
            return model
    return None


def load_model_name_registry_snapshot() -> dict[str, Any]:
    provider_snapshot = load_provider_registry_snapshot()
    with MODEL_NAME_REGISTRY_PATH.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    _validate_model_name_registry_snapshot(payload, provider_snapshot)
    return payload


@lru_cache(maxsize=1)
def get_model_name_registry_snapshot() -> dict[str, Any]:
    return load_model_name_registry_snapshot()


def list_model_name_registry_entries() -> list[dict[str, Any]]:
    snapshot = get_model_name_registry_snapshot()
    models = snapshot.get("models")
    return list(models) if isinstance(models, list) else []


def get_model_name_registry_entry(model_name: str) -> dict[str, Any] | None:
    target = _normalize_key(model_name)
    if not target:
        return None
    for entry in list_model_name_registry_entries():
        if _normalize_key(entry.get("name")) == target:
            return entry
        for alias in entry.get("aliases", []):
            if _normalize_key(alias) == target:
                return entry
    return None


def resolve_model_name_registry_entry(model_name: str) -> dict[str, Any] | None:
    entry = get_model_name_registry_entry(model_name)
    if not entry:
        return None

    provider = get_provider_registry_entry(str(entry["provider_id"]))
    provider_model = get_provider_model_registry_entry(
        str(entry["provider_id"]),
        str(entry["provider_model_id"]),
    )
    if not provider or not provider_model:
        return None

    return {
        "name": entry["name"],
        "aliases": list(entry.get("aliases", [])),
        "provider_id": provider["id"],
        "provider_display_name": provider.get("display_name"),
        "provider_model_id": provider_model["id"],
        "display_name": provider_model.get("display_name"),
        "primary_api_style": provider.get("primary_api_style"),
        "base_urls": provider.get("base_urls", []),
        "family": provider_model.get("family"),
        "category": provider_model.get("category"),
        "input_modalities": provider_model.get("input_modalities"),
        "output_modalities": provider_model.get("output_modalities"),
        "supports_streaming": provider_model.get("supports_streaming"),
        "supports_multimodal_input": provider_model.get("supports_multimodal_input"),
        "supports_tool_calls": provider_model.get("supports_tool_calls"),
        "supports_thinking": provider_model.get("supports_thinking"),
        "context_window_tokens": provider_model.get("context_window_tokens"),
        "max_output_tokens": provider_model.get("max_output_tokens"),
        "resolution_notes": entry.get("notes"),
        "model_notes": provider_model.get("notes"),
        "provider_notes": provider.get("notes"),
    }


def _normalize_key(value: Any) -> str:
    return str(value or "").strip().lower()


def _validate_provider_registry_snapshot(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise ValueError("provider registry must be a JSON object")

    schema_version = payload.get("schema_version")
    if not isinstance(schema_version, int) or schema_version < 1:
        raise ValueError("provider registry schema_version is invalid")

    providers = payload.get("providers")
    if not isinstance(providers, list) or not providers:
        raise ValueError("provider registry providers must be a non-empty list")

    seen_provider_ids: set[str] = set()
    for provider in providers:
        if not isinstance(provider, dict):
            raise ValueError("provider registry entry must be an object")

        provider_id = _normalize_key(provider.get("id"))
        if not provider_id:
            raise ValueError("provider registry entry id is required")
        if provider_id in seen_provider_ids:
            raise ValueError(f"duplicate provider id: {provider_id}")
        seen_provider_ids.add(provider_id)

        _validate_base_urls(provider_id, provider.get("base_urls"))
        _validate_models(provider_id, provider.get("models"))


def _validate_base_urls(provider_id: str, base_urls: Any) -> None:
    if not isinstance(base_urls, list) or not base_urls:
        raise ValueError(f"provider {provider_id} base_urls must be a non-empty list")
    for item in base_urls:
        if not isinstance(item, dict):
            raise ValueError(f"provider {provider_id} base_urls item must be an object")
        url = str(item.get("url") or "").strip()
        if not url:
            raise ValueError(f"provider {provider_id} base_urls item url is required")
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"provider {provider_id} base url is invalid: {url}")


def _validate_models(provider_id: str, models: Any) -> None:
    if not isinstance(models, list) or not models:
        raise ValueError(f"provider {provider_id} models must be a non-empty list")

    seen_model_ids: set[str] = set()
    for model in models:
        if not isinstance(model, dict):
            raise ValueError(f"provider {provider_id} model entry must be an object")

        model_id = str(model.get("id") or "").strip()
        if not model_id:
            raise ValueError(f"provider {provider_id} model id is required")
        normalized_model_id = _normalize_key(model_id)
        if normalized_model_id in seen_model_ids:
            raise ValueError(f"provider {provider_id} has duplicate model id: {model_id}")
        seen_model_ids.add(normalized_model_id)

        context_window = model.get("context_window_tokens")
        if context_window is not None and (not isinstance(context_window, int) or context_window <= 0):
            raise ValueError(f"provider {provider_id} model {model_id} context_window_tokens is invalid")

        max_output = model.get("max_output_tokens")
        if max_output is not None and (not isinstance(max_output, int) or max_output <= 0):
            raise ValueError(f"provider {provider_id} model {model_id} max_output_tokens is invalid")


def _validate_model_name_registry_snapshot(payload: Any, provider_snapshot: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError("model name registry must be a JSON object")

    schema_version = payload.get("schema_version")
    if not isinstance(schema_version, int) or schema_version < 1:
        raise ValueError("model name registry schema_version is invalid")

    entries = payload.get("models")
    if not isinstance(entries, list) or not entries:
        raise ValueError("model name registry models must be a non-empty list")

    provider_index = _build_provider_model_index(provider_snapshot)
    seen_names: set[str] = set()
    seen_aliases: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("model name registry entry must be an object")

        name = _normalize_key(entry.get("name"))
        if not name:
            raise ValueError("model name registry entry name is required")
        if name in seen_names:
            raise ValueError(f"duplicate model registry name: {name}")
        seen_names.add(name)

        provider_id = _normalize_key(entry.get("provider_id"))
        provider_model_id = _normalize_key(entry.get("provider_model_id"))
        if not provider_id or not provider_model_id:
            raise ValueError(f"model registry entry {name} must reference provider_id and provider_model_id")

        if (provider_id, provider_model_id) not in provider_index:
            raise ValueError(
                f"model registry entry {name} references unknown provider model {provider_id}::{provider_model_id}"
            )

        aliases = entry.get("aliases", [])
        if aliases is None:
            aliases = []
        if not isinstance(aliases, list):
            raise ValueError(f"model registry entry {name} aliases must be a list")
        for alias in aliases:
            normalized_alias = _normalize_key(alias)
            if not normalized_alias:
                raise ValueError(f"model registry entry {name} alias cannot be empty")
            if normalized_alias == name:
                continue
            if normalized_alias in seen_names or normalized_alias in seen_aliases:
                raise ValueError(f"duplicate model registry alias: {normalized_alias}")
            seen_aliases.add(normalized_alias)


def _build_provider_model_index(provider_snapshot: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    index: dict[tuple[str, str], dict[str, Any]] = {}
    for provider in provider_snapshot.get("providers", []):
        provider_id = _normalize_key(provider.get("id"))
        for model in provider.get("models", []):
            model_id = _normalize_key(model.get("id"))
            index[(provider_id, model_id)] = model
    return index
