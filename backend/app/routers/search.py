from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import DEFAULT_WORKSPACE_ID
from ..repository import search_documents
from ._context import resolve_workspace_id

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
    workspace = resolve_workspace_id(workspace_id)
    return search_documents(
        q,
        year_from,
        year_to,
        author,
        keyword,
        status,
        workspace_id=workspace,
    )
