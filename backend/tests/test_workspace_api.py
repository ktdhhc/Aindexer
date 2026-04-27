from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.main import create_app


def test_workspace_file_isolation() -> None:
    client = TestClient(create_app())

    workspace_name = f"pytest-ws-{uuid.uuid4().hex[:8]}"
    create_res = client.post("/api/workspaces", json={"name": workspace_name})
    assert create_res.status_code == 200
    workspace_id = create_res.json()["id"]

    token = uuid.uuid4().hex
    content = f"workspace isolation test {token}".encode("utf-8")

    upload_default = client.post(
        "/api/files/upload",
        params={"workspace_id": "ws_default"},
        files={"file": (f"{token}.txt", content, "text/plain")},
    )
    assert upload_default.status_code == 200
    default_payload = upload_default.json()
    assert default_payload["duplicate"] is False

    upload_custom = client.post(
        "/api/files/upload",
        params={"workspace_id": workspace_id},
        files={"file": (f"{token}.txt", content, "text/plain")},
    )
    assert upload_custom.status_code == 200
    custom_payload = upload_custom.json()
    assert custom_payload["duplicate"] is False

    default_list = client.get("/api/files", params={"workspace_id": "ws_default"})
    assert default_list.status_code == 200
    assert any(item["id"] == default_payload["doc_id"] for item in default_list.json())
    assert all(item["workspace_id"] == "ws_default" for item in default_list.json())

    custom_list = client.get("/api/files", params={"workspace_id": workspace_id})
    assert custom_list.status_code == 200
    assert any(item["id"] == custom_payload["doc_id"] for item in custom_list.json())
    assert all(item["workspace_id"] == workspace_id for item in custom_list.json())

    cleanup_default = client.delete(
        f"/api/files/{default_payload['doc_id']}",
        params={"workspace_id": "ws_default"},
    )
    assert cleanup_default.status_code == 200

    cleanup_workspace = client.delete(f"/api/workspaces/{workspace_id}")
    assert cleanup_workspace.status_code == 200
