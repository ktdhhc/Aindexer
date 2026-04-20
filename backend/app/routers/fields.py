from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..db import DEFAULT_FIELD_TEMPLATE_ID
from ..repository import (
    create_field_template,
    delete_field,
    delete_field_template,
    field_template_exists,
    get_fields,
    list_field_templates,
    reset_fields_to_defaults,
    save_fields,
    update_field_template,
)

router = APIRouter()


class FieldTemplateCreateIn(BaseModel):
    name: str
    description: str = ""
    source_template_id: str = DEFAULT_FIELD_TEMPLATE_ID


class FieldTemplateUpdateIn(BaseModel):
    name: str
    description: str | None = None


def _resolve_template_id(template_id: str | None) -> str:
    value = (
        str(template_id or DEFAULT_FIELD_TEMPLATE_ID).strip()
        or DEFAULT_FIELD_TEMPLATE_ID
    )
    if not field_template_exists(value):
        raise HTTPException(status_code=404, detail="Field template not found")
    return value


@router.get("")
def list_fields(
    template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> list[dict]:
    template = _resolve_template_id(template_id)
    return get_fields(template)


@router.put("")
def update_fields(
    payload: list[dict],
    template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> dict:
    template = _resolve_template_id(template_id)
    try:
        save_fields(payload, template_id=template)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/reset")
def reset_fields(
    template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> dict:
    template = _resolve_template_id(template_id)
    reset_fields_to_defaults(template_id=template)
    return {"ok": True}


@router.delete("/{field_key}")
def remove_field(
    field_key: str,
    template_id: str = Query(default=DEFAULT_FIELD_TEMPLATE_ID),
) -> dict:
    template = _resolve_template_id(template_id)
    ok = delete_field(field_key, template_id=template)
    if not ok:
        raise HTTPException(status_code=404, detail="Field not found")
    return {"ok": True}


@router.get("/templates")
def list_templates() -> list[dict]:
    return list_field_templates()


@router.post("/templates")
def create_template(payload: FieldTemplateCreateIn) -> dict:
    try:
        return create_field_template(
            name=payload.name,
            description=payload.description,
            source_template_id=payload.source_template_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if "UNIQUE constraint failed: field_templates.name" in str(exc):
            raise HTTPException(status_code=400, detail="模板名称已存在") from exc
        raise


@router.put("/templates/{template_id}")
def update_template(template_id: str, payload: FieldTemplateUpdateIn) -> dict:
    if not field_template_exists(template_id):
        raise HTTPException(status_code=404, detail="Field template not found")

    try:
        updated = update_field_template(
            template_id,
            name=payload.name,
            description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if "UNIQUE constraint failed: field_templates.name" in str(exc):
            raise HTTPException(status_code=400, detail="模板名称已存在") from exc
        raise

    if not updated:
        raise HTTPException(status_code=404, detail="Field template not found")
    return updated


@router.delete("/templates/{template_id}")
def remove_template(template_id: str) -> dict:
    try:
        ok = delete_field_template(template_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Field template not found")
    return {"ok": True}
