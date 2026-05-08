from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..db import DEFAULT_WORKSPACE_ID
from ..services.usage_tracker import (
    delete_pricing_rule,
    get_usage_summary,
    list_pricing_rules,
    list_usage_filters,
    save_pricing_rule,
)
from ._context import resolve_workspace_id

router = APIRouter()
ALL_WORKSPACES_SCOPE = "__all__"


def _resolve_usage_workspace_id(workspace_id: str | None) -> str | None:
    cleaned = str(workspace_id or "").strip()
    if not cleaned or cleaned == ALL_WORKSPACES_SCOPE:
        return None
    return resolve_workspace_id(cleaned)


class PricingRuleIn(BaseModel):
    provider: str
    model: str | None = None
    api_key_fingerprint: str | None = None
    input_price_per_1m: float = 0
    output_price_per_1m: float = 0
    currency: str = "USD"


@router.get("/filters")
def usage_filters(workspace_id: str = DEFAULT_WORKSPACE_ID) -> dict[str, list[str]]:
    return list_usage_filters(_resolve_usage_workspace_id(workspace_id))


@router.get("/summary")
def usage_summary(
    workspace_id: str = DEFAULT_WORKSPACE_ID,
    period: Literal["day", "month"] = Query(default="day"),
    breakdown_by: Literal["provider", "model", "feature", "api_key_fingerprint"] = Query(default="feature"),
    provider: str | None = None,
    model: str | None = None,
    feature: str | None = None,
    api_key: str | None = None,
) -> dict:
    return get_usage_summary(
        workspace_id=_resolve_usage_workspace_id(workspace_id),
        period=period,
        breakdown_by=breakdown_by,
        provider=provider,
        model=model,
        feature=feature,
        api_key_fingerprint_value=api_key,
    )


@router.get("/pricing")
def usage_pricing() -> list[dict]:
    return list_pricing_rules()


@router.put("/pricing")
def upsert_usage_pricing(payload: PricingRuleIn) -> dict:
    try:
        return save_pricing_rule(
            provider=payload.provider,
            model=payload.model,
            api_key_fingerprint_value=payload.api_key_fingerprint,
            input_price_per_1m=payload.input_price_per_1m,
            output_price_per_1m=payload.output_price_per_1m,
            currency=payload.currency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/pricing/{rule_id}")
def remove_usage_pricing(rule_id: str) -> dict[str, bool]:
    return {"ok": delete_pricing_rule(rule_id)}
