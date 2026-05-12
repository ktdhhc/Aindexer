from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from ..repository import get_app_setting, set_app_setting


CLIENT_STATE_SETTING_KEY = "frontend_client_state_v1"
CLIENT_STATE_SCHEMA_VERSION = 1
CLIENT_LOCAL_STORAGE_KEYS = {
    "aindexer_v35_chat_sessions",
    "aindexer_v35_workbench_chat",
    "aindexer_v35_model_defaults",
    "aindexer_v35_provider_models",
    "aindexer_v3_workspace_id",
    "aindexer_v35_ui_layout_size",
}
CLIENT_SESSION_STORAGE_KEYS = {
    "aindexer_v35_page_sessions",
    "aindexer_v35_translator_state",
}


def _empty_client_state() -> dict[str, Any]:
    return {
        "schema_version": CLIENT_STATE_SCHEMA_VERSION,
        "updated_at": "",
        "local_storage": {},
        "session_storage": {},
    }


def _normalize_storage(value: object, allowed_keys: set[str]) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): str(raw)
        for key, raw in value.items()
        if key in allowed_keys and isinstance(raw, str)
    }


def normalize_client_state(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return _empty_client_state()
    return {
        "schema_version": CLIENT_STATE_SCHEMA_VERSION,
        "updated_at": str(payload.get("updated_at") or ""),
        "local_storage": _normalize_storage(payload.get("local_storage"), CLIENT_LOCAL_STORAGE_KEYS),
        "session_storage": _normalize_storage(payload.get("session_storage"), CLIENT_SESSION_STORAGE_KEYS),
    }


def get_client_state() -> dict[str, Any]:
    raw = get_app_setting(CLIENT_STATE_SETTING_KEY, "")
    if not raw:
        return _empty_client_state()
    try:
        return normalize_client_state(json.loads(raw))
    except Exception:
        return _empty_client_state()


def set_client_state(payload: object) -> dict[str, Any]:
    state = normalize_client_state(payload)
    state["updated_at"] = datetime.now(UTC).isoformat()
    set_app_setting(
        CLIENT_STATE_SETTING_KEY,
        json.dumps(state, ensure_ascii=False, separators=(",", ":")),
    )
    return state
