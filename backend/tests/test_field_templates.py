from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.main import create_app


def test_field_template_crud_and_scoped_fields() -> None:
    client = TestClient(create_app())

    list_res = client.get("/api/fields/templates")
    assert list_res.status_code == 200
    templates = list_res.json()
    assert any(item["id"] == "tpl_default" for item in templates)

    template_name = f"pytest-template-{uuid.uuid4().hex[:8]}"
    create_res = client.post(
        "/api/fields/templates",
        json={"name": template_name, "source_template_id": "tpl_default"},
    )
    assert create_res.status_code == 200
    template_id = create_res.json()["id"]

    fields_res = client.get("/api/fields", params={"template_id": template_id})
    assert fields_res.status_code == 200
    items = fields_res.json()
    assert len(items) >= 1

    custom_payload = [
        {
            "field_key": "custom_flag",
            "label": "自定义标记",
            "description": "用于模板测试",
            "field_type": "text",
            "required": False,
            "enabled": True,
            "sort_order": 1,
            "is_default": False,
        }
    ]
    save_res = client.put(
        "/api/fields",
        params={"template_id": template_id},
        json=custom_payload,
    )
    assert save_res.status_code == 200

    check_res = client.get("/api/fields", params={"template_id": template_id})
    assert check_res.status_code == 200
    check_items = check_res.json()
    assert len(check_items) == 1
    assert check_items[0]["field_key"] == "custom_flag"

    default_res = client.get("/api/fields", params={"template_id": "tpl_default"})
    assert default_res.status_code == 200
    default_items = default_res.json()
    assert len(default_items) >= 1
    assert not (
        len(default_items) == 1 and default_items[0]["field_key"] == "custom_flag"
    )

    delete_res = client.delete(f"/api/fields/templates/{template_id}")
    assert delete_res.status_code == 200


def test_index_rejects_missing_field_template() -> None:
    client = TestClient(create_app())

    token = uuid.uuid4().hex
    upload_res = client.post(
        "/api/files/upload",
        files={"file": (f"{token}.txt", b"template validation", "text/plain")},
    )
    assert upload_res.status_code == 200
    doc_id = upload_res.json()["doc_id"]

    run_res = client.post(
        f"/api/index/{doc_id}/run",
        params={"field_template_id": "tpl_missing_case"},
    )
    assert run_res.status_code == 400

    cleanup_res = client.delete(f"/api/files/{doc_id}")
    assert cleanup_res.status_code == 200
