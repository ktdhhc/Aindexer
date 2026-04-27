from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..repository import (
    create_workspace,
    delete_workspace,
    list_workspaces,
    markdown_path,
    update_workspace,
)

router = APIRouter()


class WorkspaceCreateIn(BaseModel):
    name: str
    description: str = ""


class WorkspaceUpdateIn(BaseModel):
    name: str
    description: str | None = None


@router.get("")
def list_workspace_items() -> list[dict]:
    return list_workspaces()


@router.post("")
def create_workspace_item(payload: WorkspaceCreateIn) -> dict:
    try:
        return create_workspace(name=payload.name, description=payload.description)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if "UNIQUE constraint failed: workspaces.name" in str(exc):
            raise HTTPException(status_code=400, detail="工作区名称已存在") from exc
        raise


@router.put("/{workspace_id}")
def update_workspace_item(workspace_id: str, payload: WorkspaceUpdateIn) -> dict:
    try:
        updated = update_workspace(
            workspace_id,
            name=payload.name,
            description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if "UNIQUE constraint failed: workspaces.name" in str(exc):
            raise HTTPException(status_code=400, detail="工作区名称已存在") from exc
        raise

    if not updated:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return updated


@router.delete("/{workspace_id}")
def remove_workspace_item(workspace_id: str) -> dict:
    try:
        deleted = delete_workspace(workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found")

    docs = deleted.get("documents") or []
    for doc in docs:
        file_path = str(doc.get("file_path") or "")
        doc_id = str(doc.get("id") or "")

        if file_path:
            path = Path(file_path)
            if path.exists():
                try:
                    path.unlink()
                except Exception:
                    pass

        if doc_id:
            md_path = markdown_path(doc_id)
            if md_path.exists():
                try:
                    md_path.unlink()
                except Exception:
                    pass

    return {"ok": True, "workspace_id": workspace_id, "deleted_docs": len(docs)}
