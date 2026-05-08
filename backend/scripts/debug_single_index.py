from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import DEFAULT_FIELD_TEMPLATE_ID, DEFAULT_WORKSPACE_ID, init_db
from app.repository import get_document, get_fields, get_index, get_provider_config_raw
from app.routers.index import (
    INDEX_INPUT_BUDGET_TOKENS,
    INDEX_OUTPUT_BUDGET_TOKENS,
    _index_quality_failure,
    _is_fallback_record,
)
from app.schemas import IndexRecordOut
from app.services.extractor import (
    SYSTEM_PROMPT,
    build_user_prompt,
    fallback_extract,
    resolve_index_input_budget,
    run_extraction,
)
from app.services.file_parser import parse_file
from app.services.provider_client import (
    JSON_SCHEMA_HINT,
    ProviderConfig,
    _effective_json_max_tokens,
    _effective_temperature,
    _parse_json_strict,
    stream_chat_completion_with_metrics,
)


def _print_json(title: str, payload: object) -> None:
    print(f"\n===== {title} =====")
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def _build_provider_config(provider: str, model: str | None) -> ProviderConfig:
    row = get_provider_config_raw(provider)
    if not row:
        raise RuntimeError(f"Provider config not found: {provider}")
    if not row.get("api_key_enc"):
        raise RuntimeError(f"Provider API key missing: {provider}")
    return ProviderConfig(
        provider=provider,
        base_url=row["base_url"],
        model=model or row["model"],
        api_key=row["api_key_enc"],
        temperature=row["temperature"] or 0.1,
        timeout=row["timeout"] or 120,
    )


def _to_payload(record: IndexRecordOut | object) -> object:
    if hasattr(record, "model_dump"):
        return record.model_dump()
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description="Debug a single indexing run")
    parser.add_argument("doc_id", help="Document id to debug")
    parser.add_argument("--workspace-id", default=DEFAULT_WORKSPACE_ID)
    parser.add_argument("--provider", default="openai")
    parser.add_argument("--model", default=None)
    parser.add_argument("--template-id", default=DEFAULT_FIELD_TEMPLATE_ID)
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--print-normalized", action="store_true", help="Also run the full normalized extraction path")
    parser.add_argument("--save", action="store_true", help="Save extraction result to DB is not supported by this debug script; reserved for future use")
    args = parser.parse_args()

    init_db()

    doc = get_document(args.doc_id, workspace_id=args.workspace_id)
    if not doc:
        print(f"Document not found: {args.doc_id} (workspace={args.workspace_id})", file=sys.stderr)
        return 2

    provider_cfg = _build_provider_config(args.provider, args.model)
    custom_fields = [field for field in get_fields(template_id=args.template_id) if not field["is_default"]]
    effective_input_budget = resolve_index_input_budget(
        provider_cfg.model,
        INDEX_INPUT_BUDGET_TOKENS,
        INDEX_OUTPUT_BUDGET_TOKENS,
    )

    _print_json("Document", doc)
    _print_json(
        "Run Config",
        {
            "workspace_id": args.workspace_id,
            "provider": provider_cfg.provider,
            "model": provider_cfg.model,
            "template_id": args.template_id,
            "input_budget_tokens": INDEX_INPUT_BUDGET_TOKENS,
            "effective_input_budget_tokens": effective_input_budget,
            "output_budget_tokens": INDEX_OUTPUT_BUDGET_TOKENS,
            "custom_field_count": len(custom_fields),
        },
    )

    file_path = Path(str(doc["file_path"]))
    text = parse_file(file_path=file_path, file_type=str(doc["file_type"]))
    _print_json(
        "Parsed Text Preview",
        {
            "chars": len(text),
            "first_4000_chars": text[:4000],
        },
    )

    user_prompt = build_user_prompt(
        text,
        custom_fields,
        input_budget_tokens=effective_input_budget,
    )
    payload = {
        "model": provider_cfg.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT + "\n" + JSON_SCHEMA_HINT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": _effective_temperature(provider_cfg.model, provider_cfg.temperature),
        "max_tokens": _effective_json_max_tokens(provider_cfg.model, INDEX_OUTPUT_BUDGET_TOKENS),
        "stream": True,
    }
    raw_result = stream_chat_completion_with_metrics(
        url=provider_cfg.base_url.rstrip("/") + "/chat/completions",
        headers={
            "Authorization": f"Bearer {provider_cfg.api_key}",
            "Content-Type": "application/json",
        },
        payload=payload,
        timeout=provider_cfg.timeout,
    )
    _print_json(
        "Raw Model Output",
        {
            "text": raw_result.text,
            "usage": raw_result.usage,
            "finish_reason": raw_result.finish_reason,
            "first_token_ms": raw_result.first_token_ms,
            "total_duration_ms": raw_result.total_duration_ms,
        },
    )

    try:
        parsed_raw = _parse_json_strict(raw_result.text)
        _print_json("Parsed Raw JSON", parsed_raw)
    except Exception as exc:
        _print_json("Parsed Raw JSON Error", {"error": str(exc)})

    if args.print_normalized:
        try:
            record = run_extraction(
                text=text,
                provider_cfg=provider_cfg,
                custom_fields=custom_fields,
                retries=args.retries,
                output_budget_tokens=INDEX_OUTPUT_BUDGET_TOKENS,
                input_budget_tokens=INDEX_INPUT_BUDGET_TOKENS,
                workspace_id=str(doc.get("workspace_id") or DEFAULT_WORKSPACE_ID),
                request_id=args.doc_id,
            )
            quality_failure = _index_quality_failure(record)
            _print_json("Normalized Extraction Result", _to_payload(record))
            _print_json(
                "Quality Check",
                {
                    "is_fallback_record": _is_fallback_record(record),
                    "quality_failure": quality_failure,
                },
            )
        except Exception as exc:
            fallback = fallback_extract(file_path, text)
            _print_json("Normalized Extraction Error", {"error": str(exc)})
            _print_json("Fallback Result", _to_payload(fallback))

    existing = get_index(args.doc_id)
    _print_json("Existing DB Index", _to_payload(existing) if existing else None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
