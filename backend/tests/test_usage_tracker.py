from app.db import get_conn, init_db
from app.services.provider_client import ProviderConfig
from app.services.usage_tracker import (
    GLOBAL_PRICING_PROVIDER,
    get_usage_summary,
    record_llm_usage,
    save_pricing_rule,
)


def test_usage_summary_aggregates_tokens_and_pricing() -> None:
    init_db()
    provider = "usage_test_provider"
    workspace_id = "usage_test_workspace"
    request_id = "usage_test_request"
    rule_id = ""
    try:
        rule = save_pricing_rule(
            provider=GLOBAL_PRICING_PROVIDER,
            model=None,
            api_key_fingerprint_value=None,
            input_price_per_1m=10,
            output_price_per_1m=20,
            currency="USD",
        )
        rule_id = str(rule["id"])
        record_llm_usage(
            workspace_id=workspace_id,
            feature="chat",
            operation="usage_test",
            provider_cfg=ProviderConfig(
                provider=provider,
                base_url="https://example.invalid/v1",
                model="usage-test-model",
                api_key="usage-test-key",
            ),
            usage={"prompt_tokens": 100, "completion_tokens": 50},
            request_id=request_id,
        )

        summary = get_usage_summary(workspace_id=workspace_id, period="day")

        assert summary["breakdown_by"] == "feature"
        assert summary["totals"]["input_tokens"] == 100
        assert summary["totals"]["output_tokens"] == 50
        assert summary["totals"]["total_tokens"] == 150
        assert summary["totals"]["request_count"] == 1
        assert summary["totals"]["estimated_cost"] == 0.002
        assert summary["totals"]["dimension_breakdown"] == {"chat": 150}
        assert summary["totals"]["dimension_metrics"]["chat"]["estimated_cost"] == 0.002
        assert summary["buckets"][0]["estimated_count"] == 0
        assert summary["buckets"][0]["dimension_breakdown"] == {"chat": 150}
    finally:
        with get_conn() as conn:
            conn.execute("DELETE FROM llm_usage_events WHERE request_id = ?", (request_id,))
            if rule_id:
                conn.execute("DELETE FROM llm_pricing_rules WHERE id = ?", (rule_id,))


def test_usage_summary_without_workspace_filter_aggregates_all_workspaces() -> None:
    init_db()
    provider = "usage_test_provider_all"
    request_ids = ["usage_all_request_1", "usage_all_request_2"]
    try:
        record_llm_usage(
            workspace_id="usage_workspace_a",
            feature="chat",
            operation="usage_test_all",
            provider_cfg=ProviderConfig(
                provider=provider,
                base_url="https://example.invalid/v1",
                model="usage-test-model",
                api_key="usage-test-key-a",
            ),
            usage={"prompt_tokens": 100, "completion_tokens": 50},
            request_id=request_ids[0],
        )
        record_llm_usage(
            workspace_id="usage_workspace_b",
            feature="translation",
            operation="usage_test_all",
            provider_cfg=ProviderConfig(
                provider=provider,
                base_url="https://example.invalid/v1",
                model="usage-test-model",
                api_key="usage-test-key-b",
            ),
            usage={"prompt_tokens": 40, "completion_tokens": 10},
            request_id=request_ids[1],
        )

        summary = get_usage_summary(workspace_id=None, period="day", provider=provider)

        assert summary["totals"]["input_tokens"] == 140
        assert summary["totals"]["output_tokens"] == 60
        assert summary["totals"]["total_tokens"] == 200
        assert summary["totals"]["request_count"] == 2
        assert summary["totals"]["dimension_breakdown"].get("chat", 0) == 150
        assert summary["totals"]["dimension_breakdown"].get("translation", 0) == 50
    finally:
        with get_conn() as conn:
            conn.execute("DELETE FROM llm_usage_events WHERE request_id IN (?, ?)", tuple(request_ids))
