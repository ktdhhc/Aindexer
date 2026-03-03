from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException

from ..repository import (
    delete_provider_config,
    get_provider_config_raw,
    get_provider_configs,
    reset_provider_configs_to_defaults,
    save_provider_config,
)
from ..schemas import ProviderConfigIn
from ..services.provider_client import ProviderClient, ProviderConfig

router = APIRouter()

DEFAULT_PROVIDERS = {"openai", "deepseek", "glm", "openrouter"}


@router.get("")
def list_provider_configs() -> list[dict]:
    items = [x.model_dump() for x in get_provider_configs()]
    for item in items:
        raw = get_provider_config_raw(item["provider"])
        item["api_key_masked"] = _mask_api_key(raw.get("api_key_enc") if raw else None)
    return items


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


@router.put("/{provider}")
def update_provider_config(provider: str, payload: ProviderConfigIn) -> dict:
    base_url = _validate_base_url(payload.base_url)
    api_key_enc = None
    if payload.clear_api_key:
        api_key_enc = ""
    elif payload.api_key:
        api_key_enc = payload.api_key
    save_provider_config(
        provider=provider,
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
