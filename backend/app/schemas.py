from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class FieldDefinition(BaseModel):
    field_key: str
    label: str
    description: str = ""
    field_type: str
    required: bool = False
    enabled: bool = True
    sort_order: int = 0
    is_default: bool = False


class ProviderConfigIn(BaseModel):
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    temperature: float = 0.1
    timeout: int = 120
    enabled: bool = True


class ProviderConfigOut(BaseModel):
    provider: str
    base_url: str | None
    model: str | None
    has_api_key: bool
    temperature: float
    timeout: int
    enabled: bool


class ClaimItem(BaseModel):
    claim_text: str
    evidence_quote: str
    page: int = Field(..., description="pdf real page, txt/docx use -1")
    section: str | None = None
    paragraph_index: int | None = None
    confidence: float | None = None


class IndexRecordIn(BaseModel):
    title: str
    authors: list[str]
    year: int
    keywords: list[str]
    apa_citation: str = ""
    one_liner: str
    core_points: list[str]
    claims: list[ClaimItem]
    custom_fields: dict[str, Any] = Field(default_factory=dict)


class IndexRecordOut(IndexRecordIn):
    doc_id: str
    provider: str | None = None
    model: str | None = None
