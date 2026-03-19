from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..repository import delete_field, get_fields, reset_fields_to_defaults, save_fields

router = APIRouter()


@router.get("")
def list_fields() -> list[dict]:
    return get_fields()


@router.put("")
def update_fields(payload: list[dict]) -> dict:
    save_fields(payload)
    return {"ok": True}


@router.post("/reset")
def reset_fields() -> dict:
    reset_fields_to_defaults()
    return {"ok": True}


@router.delete("/{field_key}")
def remove_field(field_key: str) -> dict:
    ok = delete_field(field_key)
    if not ok:
        raise HTTPException(status_code=404, detail="Field not found")
    return {"ok": True}
