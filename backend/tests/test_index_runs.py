from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app import db, repository
from app.routers import index as index_router
from app.schemas import IndexRecordIn


def _setup_db(tmp_path: Path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    db_path = data_dir / "app.db"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(db, "DB_PATH", db_path)
    monkeypatch.setattr(db, "ensure_dirs", lambda: data_dir.mkdir(parents=True, exist_ok=True))
    monkeypatch.setattr(index_router, "RUN_GATE", None)
    monkeypatch.setattr(index_router, "RUN_GATE_LIMIT", 0)
    index_router.FUTURES.clear()
    index_router.FUTURE_WORKSPACES.clear()
    index_router.RUNNING_DOC_IDS.clear()
    db.init_db()


def _create_doc(tmp_path: Path) -> str:
    source = tmp_path / "paper.txt"
    source.write_text("paper body", encoding="utf-8")
    return repository.create_document(
        "paper.txt",
        "txt",
        "ws_default:test-hash",
        str(source),
    )


def _record() -> IndexRecordIn:
    return IndexRecordIn(
        title="Indexed title",
        authors=["Author"],
        year=2026,
        keywords=["keyword"],
        apa_citation="Author. (2026). Indexed title.",
        one_liner="One line",
        core_points=["Point"],
        claims=[],
        custom_fields={},
    )


def _fallback_like_record() -> IndexRecordIn:
    record = _record()
    record.one_liner = "自动抽取失败，请人工补充。"
    record.core_points = ["自动抽取失败，请人工补充。"]
    return record


def _low_quality_record() -> IndexRecordIn:
    return IndexRecordIn(
        title="Untitled",
        authors=["Unknown"],
        year=2024,
        keywords=["待补充"],
        apa_citation="Unknown. (2024). Untitled.",
        one_liner="待补充",
        core_points=["待补充"],
        claims=[],
        custom_fields={},
    )


def _patch_index_dependencies(monkeypatch, run_extraction) -> None:
    monkeypatch.setattr(
        index_router,
        "get_provider_config_raw",
        lambda _provider: {
            "base_url": "http://example.test",
            "model": "test-model",
            "api_key_enc": "test-key",
            "temperature": 0.1,
            "timeout": 30,
        },
    )
    monkeypatch.setattr(index_router, "get_fields", lambda template_id: [])
    monkeypatch.setattr(index_router, "parse_file", lambda file_path, file_type: "parsed text")
    monkeypatch.setattr(index_router, "run_extraction", run_extraction)
    monkeypatch.setattr(index_router, "write_markdown", lambda path, markdown: None)


def test_reset_invalidates_old_index_run_before_write(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    def fake_run_extraction(**_kwargs):
        assert repository.reset_index_content(doc_id)
        return _record()

    _patch_index_dependencies(monkeypatch, fake_run_extraction)

    index_router._process_indexing(doc_id, run_id, "openai")

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["status"] == "uploaded"
    assert doc["stage"] == "uploaded"
    assert repository.get_index(doc_id) is None


def test_cancelled_index_run_stops_before_write(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    def fake_run_extraction(**_kwargs):
        repository.set_cancel_requested(doc_id, True)
        return _record()

    _patch_index_dependencies(monkeypatch, fake_run_extraction)

    index_router._process_indexing(doc_id, run_id, "openai")

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["status"] == "cancelled"
    assert doc["stage"] == "cancelled"
    assert repository.get_index(doc_id) is None


def test_fallback_like_success_result_is_marked_needs_review(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    _patch_index_dependencies(monkeypatch, lambda **_kwargs: _fallback_like_record())

    index_router._process_indexing(doc_id, run_id, "openai")

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["status"] == "needs_review"
    assert doc["failure_label"] == "索引需审核"
    assert repository.get_index(doc_id) is not None


def test_low_quality_json_result_is_marked_needs_review(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    _patch_index_dependencies(monkeypatch, lambda **_kwargs: _low_quality_record())

    index_router._process_indexing(doc_id, run_id, "openai")

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["status"] == "needs_review"
    assert doc["failure_code"] == "low_quality_index"
    assert doc["failure_label"] == "索引需审核"


def test_parse_empty_text_is_marked_needs_review(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    monkeypatch.setattr(
        index_router,
        "get_provider_config_raw",
        lambda _provider: {
            "base_url": "http://example.test",
            "model": "test-model",
            "api_key_enc": "test-key",
            "temperature": 0.1,
            "timeout": 30,
        },
    )
    monkeypatch.setattr(index_router, "get_fields", lambda template_id: [])
    monkeypatch.setattr(index_router, "parse_file", lambda file_path, file_type: "[Page 1]\n\n[Page 2]\n")
    monkeypatch.setattr(index_router, "write_markdown", lambda path, markdown: None)

    index_router._process_indexing(doc_id, run_id, "openai")

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["status"] == "needs_review"
    assert doc["failure_code"] == "parse_empty"
    assert doc["failure_label"] == "解析内容不足"
    assert "解析内容不足" in doc["error_message"]
    assert repository.get_index(doc_id) is not None


def test_markdown_write_failure_keeps_structured_index(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    _patch_index_dependencies(monkeypatch, lambda **_kwargs: _record())

    def fail_write(_path: Path, _markdown: str) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(index_router, "write_markdown", fail_write)

    index_router._process_indexing(doc_id, run_id, "openai")

    doc = repository.get_document(doc_id)
    saved = repository.get_index(doc_id)
    assert doc is not None
    assert saved is not None
    assert saved.title == "Indexed title"
    assert doc["status"] == "needs_review"
    assert doc["stage"] == "failed"
    assert doc["failure_code"] == "markdown_write_failed"
    assert doc["failure_label"] == "Markdown 写入失败"
    assert "Markdown 落盘失败" in doc["error_message"]


def test_missing_markdown_is_rebuilt_from_db(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    index_dir = tmp_path / "indexes"
    monkeypatch.setattr(repository, "INDEX_DIR", index_dir)
    doc_id = _create_doc(tmp_path)
    repository.save_index(doc_id, _record(), provider="openai", model="test-model")
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE documents SET status='needs_review', stage='failed', stage_message='结构化索引已保存，但 Markdown 落盘失败', error_message='结构化索引已保存，但 Markdown 落盘失败: disk full', failure_code='markdown_write_failed', failure_label='Markdown 写入失败' WHERE id = ?",
            (doc_id,),
        )

    payload = index_router.index_markdown(doc_id, workspace_id="ws_default")

    md_path = repository.markdown_path(doc_id)
    doc = repository.get_document(doc_id)
    assert payload["rebuilt"] is True
    assert "Indexed title" in payload["markdown"]
    assert md_path.exists()
    assert "Indexed title" in md_path.read_text(encoding="utf-8")
    assert doc is not None
    assert doc["status"] == "indexed"
    assert doc["stage"] == "completed"
    assert doc["failure_code"] is None
    assert doc["failure_label"] is None


def test_update_index_markdown_write_failure_does_not_mutate_doc_state(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE documents SET status='needs_review', stage='failed', stage_message='旧错误', error_message='old error', failure_code='low_quality_index', failure_label='索引需审核' WHERE id = ?",
            (doc_id,),
        )

    monkeypatch.setattr(index_router, "write_markdown", lambda _path, _markdown: (_ for _ in ()).throw(OSError("disk full")))

    with pytest.raises(HTTPException, match="Markdown 写入失败"):
        index_router.update_index_markdown(
            doc_id,
            {"markdown": "new markdown"},
            workspace_id="ws_default",
        )

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["status"] == "needs_review"
    assert doc["stage"] == "failed"
    assert doc["failure_code"] == "low_quality_index"
    assert doc["error_message"] == "old error"


def test_update_index_markdown_success_clears_stale_failure_state(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    index_dir = tmp_path / "indexes"
    monkeypatch.setattr(repository, "INDEX_DIR", index_dir)
    doc_id = _create_doc(tmp_path)
    with db.get_conn() as conn:
        conn.execute(
            "UPDATE documents SET status='needs_review', stage='failed', stage_message='旧错误', error_message='old error', failure_code='low_quality_index', failure_label='索引需审核' WHERE id = ?",
            (doc_id,),
        )

    payload = index_router.update_index_markdown(
        doc_id,
        {"markdown": "new markdown"},
        workspace_id="ws_default",
    )

    doc = repository.get_document(doc_id)
    md_path = repository.markdown_path(doc_id)
    assert payload == {"ok": True}
    assert doc is not None
    assert doc["status"] == "indexed"
    assert doc["stage"] == "completed"
    assert doc["failure_code"] is None
    assert doc["failure_label"] is None
    assert doc["error_message"] is None
    assert md_path.read_text(encoding="utf-8") == "new markdown"


def test_update_index_editor_write_failure_keeps_old_index_fields(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    repository.save_index(doc_id, _record(), provider="openai", model="test-model")

    monkeypatch.setattr(index_router, "write_markdown", lambda _path, _markdown: (_ for _ in ()).throw(OSError("disk full")))

    with pytest.raises(HTTPException, match="Markdown 写入失败"):
        index_router.update_index_editor(
            doc_id,
            {
                "markdown": "new markdown",
                "title": "Edited title",
                "display_name": "Edited name",
                "year": 2030,
            },
            workspace_id="ws_default",
        )

    saved = repository.get_index(doc_id)
    doc = repository.get_document(doc_id)
    assert saved is not None
    assert doc is not None
    assert saved.title == "Indexed title"
    assert saved.year == 2026
    assert doc["display_name"] != "Edited name"


def test_update_index_editor_updates_authors(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    repository.save_index(doc_id, _record(), provider="openai", model="test-model")

    payload = index_router.update_index_editor(
        doc_id,
        {
            "markdown": "updated markdown",
            "title": "Indexed title",
            "display_name": "paper",
            "authors": ["Alice", "Bob"],
            "year": 2026,
        },
        workspace_id="ws_default",
    )

    saved = repository.get_index(doc_id)
    assert payload == {"ok": True}
    assert saved is not None
    assert saved.authors == ["Alice", "Bob"]


def test_update_index_write_failure_does_not_save_structured_record(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)

    monkeypatch.setattr(index_router, "write_markdown", lambda _path, _markdown: (_ for _ in ()).throw(OSError("disk full")))

    with pytest.raises(HTTPException, match="Markdown 写入失败"):
        index_router.update_index(
            doc_id,
            _record(),
            workspace_id="ws_default",
        )

    assert repository.get_index(doc_id) is None


def test_list_documents_displays_legacy_fallback_index_as_needs_review(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    repository.save_index(doc_id, _fallback_like_record(), provider="openai", model="test-model")
    repository.set_document_status(doc_id, "indexed")

    rows = repository.list_documents()
    doc = next(row for row in rows if row["id"] == doc_id)
    assert doc["status"] == "needs_review"
    assert doc["stage"] == "failed"
    assert doc["failure_label"] == "索引需审核"


def test_search_documents_displays_legacy_fallback_index_as_needs_review(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    repository.save_index(doc_id, _fallback_like_record(), provider="openai", model="test-model")
    repository.set_document_status(doc_id, "indexed")

    rows = repository.search_documents(
        query=None,
        year_from=None,
        year_to=None,
        author=None,
        keyword=None,
        status=None,
        workspace_id="ws_default",
    )
    doc = next(row for row in rows if row["doc_id"] == doc_id)
    assert doc["status"] == "needs_review"
    assert doc["stage"] == "failed"
    assert doc["failure_label"] == "索引需审核"


def test_llm_progress_callback_updates_document_progress(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    run_id = repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    callback = index_router._llm_progress_callback(doc_id, run_id)
    callback("hello", "hello " * 200, 1500)

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["progress"] > 35
    assert doc["output_seen_tokens"] > 0
    assert doc["output_budget_tokens"] == 1500


def test_list_documents_does_not_mark_long_running_job_as_stale(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)
    repository.begin_index_run(doc_id, "tpl_default", provider="openai", model="test-model")

    with db.get_conn() as conn:
        conn.execute(
            "UPDATE documents SET status = 'parsing', updated_at = '2000-01-01T00:00:00Z' WHERE id = ?",
            (doc_id,),
        )

    rows = repository.list_documents()
    doc = next(row for row in rows if row["id"] == doc_id)
    assert doc["status"] == "parsing"
    assert doc["stage"] == "queued"


def test_begin_index_run_stores_task_snapshot_and_progress(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)

    run_id = repository.begin_index_run(
        doc_id,
        "tpl_default",
        provider="openai",
        model="gpt-test",
        output_budget_tokens=1500,
    )
    assert repository.update_index_progress_for_run(
        doc_id,
        run_id,
        progress=55,
        output_seen_tokens=300,
        output_budget_tokens=1500,
    )

    doc = repository.get_document(doc_id)
    assert doc is not None
    assert doc["index_provider"] == "openai"
    assert doc["index_model"] == "gpt-test"
    assert doc["index_field_template_id"] == "tpl_default"
    assert doc["progress"] == 55
    assert doc["output_seen_tokens"] == 300
    assert doc["output_budget_tokens"] == 1500


def test_index_settings_are_clamped_and_report_next_batch(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)

    response = index_router.update_index_settings({"max_concurrency": 99})
    assert response["max_concurrency"] == 20

    response = index_router.update_index_settings({"max_concurrency": 0})
    assert response["max_concurrency"] == 1


def test_active_runs_are_counted_by_workspace(tmp_path: Path, monkeypatch) -> None:
    _setup_db(tmp_path, monkeypatch)
    doc_id = _create_doc(tmp_path)

    class FakeFuture:
        def done(self) -> bool:
            return False

    index_router.FUTURES[doc_id] = FakeFuture()  # type: ignore[assignment]
    index_router.FUTURE_WORKSPACES[doc_id] = "ws_default"
    index_router.RUNNING_DOC_IDS.add(doc_id)

    payload = index_router.active_index_runs()
    assert payload["active_total"] == 1
    assert payload["active_by_workspace"] == {"ws_default": 1}
    assert payload["running_count"] == 1
