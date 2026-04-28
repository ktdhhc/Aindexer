from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException

from ..provider_registry import (
    get_provider_registry_entry,
    resolve_model_name_registry_entry,
)
from ..repository import (
    delete_provider_config,
    get_provider_config_raw,
    get_provider_configs,
    reset_provider_configs_to_defaults,
    save_provider_config,
)
from ..schemas import ModelRegistryResolveIn, ProviderConfigIn
from ..services.provider_client import ProviderClient, ProviderConfig

router = APIRouter()

DEFAULT_PROVIDERS = {"openai", "deepseek", "glm", "openrouter"}
DIRECT_PROVIDER_API_STYLES = {"openai_compatible"}


@router.get("")
def list_provider_configs() -> list[dict]:
    return [_build_provider_response(x.model_dump()) for x in get_provider_configs()]


@router.post("/model_registry/resolve")
def resolve_model_registry_entries(payload: ModelRegistryResolveIn) -> list[dict]:
    items: list[dict] = []
    for raw_name in payload.names:
        model_name = str(raw_name or "").strip()
        resolved = resolve_model_name_registry_entry(model_name) if model_name else None
        items.append(
            {
                "input_name": raw_name,
                "found": bool(resolved),
                "resolved": resolved,
            }
        )
    return items


@router.get("/{provider}")
def get_provider_config(provider: str) -> dict:
    cfg = get_provider_config_raw(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail="Provider not found")
    return _build_provider_response(
        {
            "provider": cfg["provider"],
            "base_url": cfg.get("base_url"),
            "model": cfg.get("model"),
            "has_api_key": bool(cfg.get("api_key_enc")),
            "temperature": cfg["temperature"] if cfg.get("temperature") is not None else 0.1,
            "timeout": cfg["timeout"] if cfg.get("timeout") is not None else 120,
            "enabled": bool(cfg.get("enabled")),
        },
        raw=cfg,
    )


@router.get("/{provider}/api_key")
def get_provider_api_key(provider: str) -> dict:
    cfg = get_provider_config_raw(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail="Provider not found")
    api_key = cfg.get("api_key_enc") or ""
    if not api_key:
        return {"api_key": ""}
    return {"api_key": api_key}


def _mask_api_key(api_key: str | None) -> str:
    if not api_key:
        return ""
    plain = api_key
    if len(plain) <= 8:
        return "*" * len(plain)
    return f"{plain[:4]}{'*' * (len(plain) - 8)}{plain[-4:]}"


def _validate_base_url(base_url: str | None) -> str:
    val = (base_url or "").strip()
    if not val:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")
    parsed = urlparse(val)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=400, detail="Base URL 必须以 http:// 或 https:// 开头"
        )
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Base URL 缺少主机名")
    host = (parsed.hostname or "").strip()
    if not host:
        raise HTTPException(status_code=400, detail="Base URL 主机名无效")

    # 检查主机名各标签是否为空（防止 IDNA 编码错误）
    labels = host.split(".")
    for i, label in enumerate(labels):
        if not label:
            if i == 0:
                raise HTTPException(
                    status_code=400, detail="Base URL 主机名不能以点号开头"
                )
            elif i == len(labels) - 1:
                raise HTTPException(
                    status_code=400, detail="Base URL 主机名不能以点号结尾"
                )
            else:
                raise HTTPException(
                    status_code=400, detail="Base URL 主机名包含连续的点号"
                )

    # 尝试 IDNA 编码验证
    try:
        host.encode("idna")
    except UnicodeError as e:
        raise HTTPException(status_code=400, detail=f"Base URL 主机名包含无效字符: {e}")

    return val


def _is_directly_supported_api_style(api_style: str | None) -> bool:
    return str(api_style or "").strip() in DIRECT_PROVIDER_API_STYLES


def _pick_recommended_base_url(provider_name: str) -> dict | None:
    registry_entry = get_provider_registry_entry(provider_name)
    if not registry_entry:
        return None

    base_urls = registry_entry.get("base_urls", [])
    for item in base_urls:
        if _is_directly_supported_api_style(item.get("api_style")):
            return item
    return base_urls[0] if base_urls else None


def _resolve_base_url_for_save(provider_name: str, base_url: str | None) -> str:
    raw = str(base_url or "").strip()
    if raw:
        return _validate_base_url(raw)

    recommended = _pick_recommended_base_url(provider_name)
    if not recommended:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")

    recommended_url = str(recommended.get("url") or "").strip()
    if not recommended_url:
        raise HTTPException(status_code=400, detail="Base URL 不能为空")

    if not _is_directly_supported_api_style(recommended.get("api_style")):
        raise HTTPException(
            status_code=400,
            detail="该 Provider 的推荐接口当前不是后端可直接使用的兼容格式，请手动填写 Base URL",
        )

    return _validate_base_url(recommended_url)


def _build_provider_registry_payload(provider_name: str, model_name: str | None) -> dict:
    provider_entry = get_provider_registry_entry(provider_name)
    recommended = _pick_recommended_base_url(provider_name)
    resolved_model = resolve_model_name_registry_entry(str(model_name or "")) if model_name else None

    provider_payload = {
        "found": bool(provider_entry),
        "primary_api_style": provider_entry.get("primary_api_style") if provider_entry else None,
        "directly_supported": _is_directly_supported_api_style(
            provider_entry.get("primary_api_style") if provider_entry else None
        ),
        "recommended_base_url": recommended.get("url") if recommended else None,
        "recommended_api_style": recommended.get("api_style") if recommended else None,
        "base_urls": provider_entry.get("base_urls", []) if provider_entry else [],
        "models": [
            {
                "id": model.get("id"),
                "display_name": model.get("display_name"),
                "family": model.get("family"),
                "category": model.get("category"),
                "supports_streaming": model.get("supports_streaming"),
                "supports_multimodal_input": model.get("supports_multimodal_input"),
                "supports_tool_calls": model.get("supports_tool_calls"),
                "supports_thinking": model.get("supports_thinking"),
                "context_window_tokens": model.get("context_window_tokens"),
                "max_output_tokens": model.get("max_output_tokens"),
            }
            for model in (provider_entry.get("models", []) if provider_entry else [])
        ],
        "supported_model_count": len(provider_entry.get("models", [])) if provider_entry else 0,
    }

    model_payload = {
        "input_name": model_name,
        "found": bool(resolved_model),
        "provider_matches_current": bool(
            resolved_model and str(resolved_model.get("provider_id") or "") == provider_name
        ),
        "resolved": resolved_model,
    }

    return {
        "provider": provider_payload,
        "model": model_payload,
    }


def _build_provider_response(item: dict, raw: dict | None = None) -> dict:
    provider_name = str(item.get("provider") or "").strip().lower()
    current_raw = raw if raw is not None else get_provider_config_raw(provider_name)
    response = dict(item)
    response["api_key_masked"] = _mask_api_key(current_raw.get("api_key_enc") if current_raw else None)
    response["registry"] = _build_provider_registry_payload(provider_name, response.get("model"))
    return response


@router.put("/{provider}")
def update_provider_config(provider: str, payload: ProviderConfigIn) -> dict:
    provider_name = str(provider or "").strip().lower()
    if not provider_name:
        raise HTTPException(status_code=400, detail="Provider 名称不能为空")

    base_url = _resolve_base_url_for_save(provider_name, payload.base_url)
    api_key_enc = None
    if payload.clear_api_key:
        api_key_enc = ""
    elif payload.api_key:
        api_key_enc = payload.api_key
    save_provider_config(
        provider=provider_name,
        base_url=base_url,
        model=payload.model,
        api_key_enc=api_key_enc,
        temperature=payload.temperature,
        timeout=payload.timeout,
        enabled=payload.enabled,
    )
    return {"ok": True}


@router.post("/{provider}/test")
def test_provider(provider: str) -> dict:
    cfg = get_provider_config_raw(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail="Provider not configured")
    if not cfg.get("api_key_enc"):
        raise HTTPException(status_code=400, detail="API key is not configured")

    client_cfg = ProviderConfig(
        provider=provider,
        base_url=_validate_base_url(cfg["base_url"]),
        model=cfg["model"],
        api_key=cfg["api_key_enc"],
        temperature=cfg["temperature"] or 0.1,
        timeout=cfg["timeout"] or 120,
    )
    ok, message, elapsed = ProviderClient.test_connection(client_cfg)
    return {
        "success": ok,
        "message": message,
        "elapsed_seconds": elapsed,
    }


@router.delete("/{provider}")
def remove_provider(provider: str) -> dict:
    if provider in DEFAULT_PROVIDERS:
        raise HTTPException(
            status_code=400, detail="Default provider cannot be deleted"
        )
    ok = delete_provider_config(provider)
    if not ok:
        raise HTTPException(status_code=404, detail="Provider not found")
    return {"ok": True}


@router.post("/reset_defaults")
def reset_defaults() -> dict:
    reset_provider_configs_to_defaults()
    return {"ok": True}
