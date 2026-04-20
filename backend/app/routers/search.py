from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import DEFAULT_WORKSPACE_ID
from ..repository import search_documents, workspace_exists

router = APIRouter()


@router.get("")
def search(
    q: str | None = Query(default=None),
    year_from: int | None = Query(default=None),
    year_to: int | None = Query(default=None),
    author: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    status: str | None = Query(default=None),
    workspace_id: str = Query(default=DEFAULT_WORKSPACE_ID),
) -> list[dict]:
    workspace = (
        str(workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
    )
    if not workspace_exists(workspace):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return search_documents(
        q,
        year_from,
        year_to,
        author,
        keyword,
        status,
        workspace_id=workspace,
    )
