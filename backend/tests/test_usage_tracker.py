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


def test_usage_summary_supports_bucket_window_and_reports_available_range() -> None:
    init_db()
    provider = "usage_test_provider_window"
    request_ids = ["usage_window_request_1", "usage_window_request_2"]
    try:
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
                    "usage_window_event_1",
                    "usage_window_workspace",
                    "chat",
                    "usage_window",
                    provider,
                    "usage-window-model",
                    "usage-window-key",
                    10,
                    5,
                    15,
                    "provider",
                    0,
                    0,
                    1,
                    None,
                    None,
                    request_ids[0],
                    "2026-02-10T08:00:00Z",
                ),
            )
            conn.execute(
                """
                INSERT INTO llm_usage_events (
                    id, workspace_id, feature, operation, provider, model, api_key_fingerprint,
                    input_tokens, output_tokens, total_tokens, token_source, estimated, cached,
                    success, error_code, duration_ms, request_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "usage_window_event_2",
                    "usage_window_workspace",
                    "chat",
                    "usage_window",
                    provider,
                    "usage-window-model",
                    "usage-window-key",
                    20,
                    10,
                    30,
                    "provider",
                    0,
                    0,
                    1,
                    None,
                    None,
                    request_ids[1],
                    "2026-03-05T08:00:00Z",
                ),
            )

        summary = get_usage_summary(
            workspace_id="usage_window_workspace",
            period="day",
            start_bucket="2026-03-01",
            end_bucket="2026-03-31",
        )

        assert summary["available_range"] == {
            "first_bucket": "2026-02-10",
            "last_bucket": "2026-03-05",
        }
        assert summary["totals"]["total_tokens"] == 30
        assert [bucket["bucket"] for bucket in summary["buckets"]] == ["2026-03-05"]
    finally:
        with get_conn() as conn:
            conn.execute("DELETE FROM llm_usage_events WHERE request_id IN (?, ?)", tuple(request_ids))
