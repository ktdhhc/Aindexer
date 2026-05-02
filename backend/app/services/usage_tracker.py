from __future__ import annotations

import hashlib
import uuid
from typing import Any, Literal

from ..db import DEFAULT_WORKSPACE_ID, get_conn, utcnow
from .provider_client import ProviderConfig

UsageFeature = Literal["indexing", "translation", "chat"]
GLOBAL_PRICING_PROVIDER = "__global__"


def api_key_fingerprint(api_key: str | None) -> str:
    value = str(api_key or "").strip()
    if not value:
        return ""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def estimate_tokens(text: str) -> int:
    raw = str(text or "")
    if not raw:
        return 0
    ascii_chars = sum(1 for char in raw if ord(char) < 128)
    non_ascii_chars = len(raw) - ascii_chars
    return max(1, int(ascii_chars / 4 + non_ascii_chars / 1.8))


def record_llm_usage(
    *,
    workspace_id: str | None,
    feature: UsageFeature,
    operation: str,
    provider_cfg: ProviderConfig,
    input_text: str = "",
    output_text: str = "",
    usage: dict[str, Any] | None = None,
    token_source: str | None = None,
    cached: bool = False,
    success: bool = True,
    error_code: str | None = None,
    duration_ms: float | None = None,
    request_id: str | None = None,
) -> None:
    provider_input_tokens = _usage_int(usage, "prompt_tokens")
    provider_output_tokens = _usage_int(usage, "completion_tokens")
    input_tokens = provider_input_tokens
    output_tokens = provider_output_tokens
    total_tokens = _usage_int(usage, "total_tokens")

    estimated = False
    if input_tokens is None:
        input_tokens = estimate_tokens(input_text)
        estimated = True
    if output_tokens is None:
        output_tokens = estimate_tokens(output_text)
        estimated = True
    if total_tokens is None:
        total_tokens = int(input_tokens or 0) + int(output_tokens or 0)
        if provider_input_tokens is None or provider_output_tokens is None:
            estimated = True

    source = token_source or _token_source(usage, provider_input_tokens, provider_output_tokens, estimated)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO llm_usage_events (
                id, workspace_id, feature, operation, provider, model, api_key_fingerprint,
                input_tokens, output_tokens, total_tokens, token_source, estimated, cached,
                success, error_code, duration_ms, request_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"usage_{uuid.uuid4().hex[:12]}",
                str(workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID,
                feature,
                str(operation or feature).strip() or feature,
                provider_cfg.provider,
                provider_cfg.model,
                api_key_fingerprint(provider_cfg.api_key),
                input_tokens,
                output_tokens,
                total_tokens,
                source,
                1 if estimated else 0,
                1 if cached else 0,
                1 if success else 0,
                error_code,
                duration_ms,
                request_id,
                utcnow(),
            ),
        )


def list_usage_filters(workspace_id: str | None = None) -> dict[str, list[str]]:
    where, params = _workspace_where(workspace_id)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT provider, model, feature, api_key_fingerprint FROM llm_usage_events {where}",
            tuple(params),
        ).fetchall()
    providers = sorted({str(row["provider"] or "") for row in rows if row["provider"]})
    models = sorted({str(row["model"] or "") for row in rows if row["model"]})
    features = sorted({str(row["feature"] or "") for row in rows if row["feature"]})
    api_keys = sorted({str(row["api_key_fingerprint"] or "") for row in rows if row["api_key_fingerprint"]})
    return {"providers": providers, "models": models, "features": features, "api_keys": api_keys}


def get_usage_summary(
    *,
    workspace_id: str | None = None,
    period: Literal["day", "month"] = "day",
    breakdown_by: Literal["provider", "model", "feature", "api_key_fingerprint"] = "feature",
    provider: str | None = None,
    model: str | None = None,
    feature: str | None = None,
    api_key_fingerprint_value: str | None = None,
) -> dict[str, Any]:
    bucket_expr = "substr(created_at, 1, 7)" if period == "month" else "substr(created_at, 1, 10)"
    breakdown_column = breakdown_by if breakdown_by in {"provider", "model", "feature", "api_key_fingerprint"} else "feature"
    where, params = _usage_filter_where(
        workspace_id=workspace_id,
        provider=provider,
        model=model,
        feature=feature,
        api_key_fingerprint_value=api_key_fingerprint_value,
    )
    pricing_rules = list_pricing_rules()
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT {bucket_expr} AS bucket,
                   SUM(COALESCE(input_tokens, 0)) AS input_tokens,
                   SUM(COALESCE(output_tokens, 0)) AS output_tokens,
                   SUM(COALESCE(total_tokens, 0)) AS total_tokens,
                   SUM(CASE WHEN estimated = 1 THEN 1 ELSE 0 END) AS estimated_count,
                   COUNT(*) AS request_count
            FROM llm_usage_events
            {where}
            GROUP BY bucket
            ORDER BY bucket ASC
            """,
            tuple(params),
        ).fetchall()
        feature_rows = conn.execute(
            f"""
            SELECT {bucket_expr} AS bucket,
                   {breakdown_column} AS dimension_value,
                   SUM(COALESCE(total_tokens, 0)) AS total_tokens
            FROM llm_usage_events
            {where}
            GROUP BY bucket, dimension_value
            ORDER BY bucket ASC, dimension_value ASC
            """,
            tuple(params),
        ).fetchall()
        event_rows = conn.execute(
            f"SELECT * FROM llm_usage_events {where}",
            tuple(params),
        ).fetchall()

    bucket_costs: dict[str, float] = {}
    bucket_breakdowns: dict[str, dict[str, int]] = {}
    total_cost = 0.0
    breakdown_totals: dict[str, int] = {}
    dimension_metrics: dict[str, dict[str, float | int]] = {}
    for row in feature_rows:
        bucket = str(row["bucket"] or "")
        dimension_value = str(row["dimension_value"] or "") or "(empty)"
        total_tokens = int(row["total_tokens"] or 0)
        if not bucket:
            continue
        bucket_breakdowns.setdefault(bucket, {})[dimension_value] = total_tokens
        breakdown_totals[dimension_value] = breakdown_totals.get(dimension_value, 0) + total_tokens
    for row in event_rows:
        event = dict(row)
        bucket = str(event.get("created_at") or "")[:7 if period == "month" else 10]
        dimension_value = str(event.get(breakdown_column) or "") or "(empty)"
        cost = _estimate_cost(event, pricing_rules)
        bucket_costs[bucket] = bucket_costs.get(bucket, 0.0) + cost
        total_cost += cost
        metrics = dimension_metrics.setdefault(
            dimension_value,
            {
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "request_count": 0,
                "estimated_cost": 0.0,
            },
        )
        metrics["input_tokens"] = int(metrics["input_tokens"]) + int(event.get("input_tokens") or 0)
        metrics["output_tokens"] = int(metrics["output_tokens"]) + int(event.get("output_tokens") or 0)
        metrics["total_tokens"] = int(metrics["total_tokens"]) + int(event.get("total_tokens") or 0)
        metrics["request_count"] = int(metrics["request_count"]) + 1
        metrics["estimated_cost"] = float(metrics["estimated_cost"]) + cost

    buckets = []
    for row in rows:
        bucket = str(row["bucket"] or "")
        buckets.append(
            {
                "bucket": bucket,
                "input_tokens": int(row["input_tokens"] or 0),
                "output_tokens": int(row["output_tokens"] or 0),
                "total_tokens": int(row["total_tokens"] or 0),
                "request_count": int(row["request_count"] or 0),
                "estimated_count": int(row["estimated_count"] or 0),
                "estimated_cost": bucket_costs.get(bucket, 0.0),
                "dimension_breakdown": bucket_breakdowns.get(bucket, {}),
            }
        )
    totals = {
        "input_tokens": sum(item["input_tokens"] for item in buckets),
        "output_tokens": sum(item["output_tokens"] for item in buckets),
        "total_tokens": sum(item["total_tokens"] for item in buckets),
        "request_count": sum(item["request_count"] for item in buckets),
        "estimated_cost": total_cost,
        "dimension_breakdown": breakdown_totals,
        "dimension_metrics": dimension_metrics,
    }
    return {"period": period, "breakdown_by": breakdown_column, "buckets": buckets, "totals": totals}


def list_pricing_rules() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM llm_pricing_rules ORDER BY provider ASC, COALESCE(model, '') ASC, COALESCE(api_key_fingerprint, '') ASC"
        ).fetchall()
    return [dict(row) for row in rows]


def save_pricing_rule(
    *,
    provider: str,
    model: str | None,
    api_key_fingerprint_value: str | None,
    input_price_per_1m: float,
    output_price_per_1m: float,
    currency: str = "USD",
) -> dict[str, Any]:
    cleaned_provider = str(provider or "").strip()
    if not cleaned_provider:
        raise ValueError("provider is required")
    cleaned_model = str(model or "").strip() or None
    cleaned_key = str(api_key_fingerprint_value or "").strip() or None
    now = utcnow()
    rule_id = f"price_{uuid.uuid4().hex[:12]}"
    with get_conn() as conn:
        existing = conn.execute(
            """
            SELECT id FROM llm_pricing_rules
            WHERE provider = ? AND COALESCE(model, '') = COALESCE(?, '') AND COALESCE(api_key_fingerprint, '') = COALESCE(?, '')
            """,
            (cleaned_provider, cleaned_model, cleaned_key),
        ).fetchone()
        if existing:
            rule_id = str(existing["id"])
        conn.execute(
            """
            INSERT INTO llm_pricing_rules (
                id, provider, model, api_key_fingerprint, input_price_per_1m,
                output_price_per_1m, currency, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              input_price_per_1m=excluded.input_price_per_1m,
              output_price_per_1m=excluded.output_price_per_1m,
              currency=excluded.currency,
              updated_at=excluded.updated_at
            """,
            (
                rule_id,
                cleaned_provider,
                cleaned_model,
                cleaned_key,
                float(input_price_per_1m or 0),
                float(output_price_per_1m or 0),
                str(currency or "USD").strip() or "USD",
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM llm_pricing_rules WHERE id = ?", (rule_id,)).fetchone()
    return dict(row) if row else {}


def delete_pricing_rule(rule_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM llm_pricing_rules WHERE id = ?", (str(rule_id or ""),))
        return cur.rowcount > 0


def _usage_int(usage: dict[str, Any] | None, key: str) -> int | None:
    if not isinstance(usage, dict):
        return None
    value = usage.get(key)
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _token_source(
    usage: dict[str, Any] | None,
    provider_input_tokens: int | None,
    provider_output_tokens: int | None,
    estimated: bool,
) -> str:
    if not isinstance(usage, dict):
        return "estimated"
    if not estimated:
        return "provider"
    if provider_input_tokens is not None or provider_output_tokens is not None:
        return "mixed"
    return "estimated"


def _workspace_where(workspace_id: str | None) -> tuple[str, list[Any]]:
    if not workspace_id:
        return "", []
    return "WHERE workspace_id = ?", [str(workspace_id).strip() or DEFAULT_WORKSPACE_ID]


def _usage_filter_where(
    *,
    workspace_id: str | None,
    provider: str | None,
    model: str | None,
    feature: str | None,
    api_key_fingerprint_value: str | None,
) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if workspace_id:
        clauses.append("workspace_id = ?")
        params.append(str(workspace_id).strip() or DEFAULT_WORKSPACE_ID)
    for column, value in [
        ("provider", provider),
        ("model", model),
        ("feature", feature),
        ("api_key_fingerprint", api_key_fingerprint_value),
    ]:
        cleaned = str(value or "").strip()
        if cleaned:
            clauses.append(f"{column} = ?")
            params.append(cleaned)
    return ("WHERE " + " AND ".join(clauses), params) if clauses else ("", params)


def _estimate_cost(event: dict[str, Any], rules: list[dict[str, Any]]) -> float:
    rule = _match_pricing_rule(event, rules)
    if not rule:
        return 0.0
    input_price = float(rule.get("input_price_per_1m") or 0)
    output_price = float(rule.get("output_price_per_1m") or 0)
    input_tokens = int(event.get("input_tokens") or 0)
    output_tokens = int(event.get("output_tokens") or 0)
    return input_tokens / 1_000_000 * input_price + output_tokens / 1_000_000 * output_price


def _match_pricing_rule(event: dict[str, Any], rules: list[dict[str, Any]]) -> dict[str, Any] | None:
    provider = str(event.get("provider") or "")
    model = str(event.get("model") or "")
    key = str(event.get("api_key_fingerprint") or "")
    candidates = [
        (provider, model, key),
        (provider, model, ""),
        (provider, "", key),
        (provider, "", ""),
        (GLOBAL_PRICING_PROVIDER, "", ""),
    ]
    for p, m, k in candidates:
        for rule in rules:
            if str(rule.get("provider") or "") != p:
                continue
            if str(rule.get("model") or "") != m:
                continue
            if str(rule.get("api_key_fingerprint") or "") != k:
                continue
            return rule
    return None
