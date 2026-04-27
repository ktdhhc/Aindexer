from __future__ import annotations

from fastapi import HTTPException

from ..db import DEFAULT_FIELD_TEMPLATE_ID, DEFAULT_WORKSPACE_ID
from ..repository import field_template_exists, workspace_exists


def resolve_workspace_id(workspace_id: str | None) -> str:
    value = str(workspace_id or DEFAULT_WORKSPACE_ID).strip() or DEFAULT_WORKSPACE_ID
    if not workspace_exists(value):
        raise HTTPException(status_code=404, detail="Workspace not found")
    return value


def resolve_field_template_id(field_template_id: str | None) -> str:
    value = (
        str(field_template_id or DEFAULT_FIELD_TEMPLATE_ID).strip()
        or DEFAULT_FIELD_TEMPLATE_ID
    )
    if not field_template_exists(value):
        raise HTTPException(status_code=400, detail="Field template not found")
    return value
