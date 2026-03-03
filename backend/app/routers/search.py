from __future__ import annotations

from fastapi import APIRouter, Query

from ..repository import search_documents

router = APIRouter()


@router.get("")
def search(
    q: str | None = Query(default=None),
    year_from: int | None = Query(default=None),
    year_to: int | None = Query(default=None),
    author: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    status: str | None = Query(default=None),
) -> list[dict]:
    return search_documents(q, year_from, year_to, author, keyword, status)
