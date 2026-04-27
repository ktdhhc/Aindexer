from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from ..db import DEFAULT_WORKSPACE_ID


class SelectionRect(BaseModel):
    page: int = Field(..., ge=1)
    x: float
    y: float
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)


class SelectionAnchor(BaseModel):
    page: int = Field(..., ge=1)
    quote: str
    rects: list[SelectionRect] = Field(default_factory=list)
    start_offset: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)
    checksum: str | None = None
    version: str = "v1"

    @field_validator("quote")
    @classmethod
    def validate_quote(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("quote cannot be empty")
        return cleaned

    @model_validator(mode="after")
    def validate_offsets(self) -> "SelectionAnchor":
        if self.start_offset is None and self.end_offset is None:
            return self
        if self.start_offset is None or self.end_offset is None:
            raise ValueError("start_offset and end_offset must both be set")
        if self.end_offset <= self.start_offset:
            raise ValueError("end_offset must be greater than start_offset")
        return self


class TranslationDocumentOut(BaseModel):
    id: str
    workspace_id: str = DEFAULT_WORKSPACE_ID
    filename: str
    display_name: str
    file_type: str
    file_path: str
    page_count: int | None = None
    text_layer_status: str
    created_at: str | None = None
    updated_at: str | None = None


class TranslationRequestIn(BaseModel):
    document_id: str
    workspace_id: str = DEFAULT_WORKSPACE_ID
    provider: str
    model: str | None = None
    source_text: str
    target_lang: str = "zh-CN"
    source_lang: str | None = None
    prompt_version: str = "v1"
    anchor: SelectionAnchor | None = None
    enable_thinking: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("document_id", "provider", "target_lang", "prompt_version")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("value cannot be empty")
        return cleaned

    @field_validator("model")
    @classmethod
    def validate_optional_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("source_text")
    @classmethod
    def validate_source_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("source_text cannot be empty")
        return cleaned


class TranslationResponseOut(BaseModel):
    request_id: str
    document_id: str
    provider: str
    model: str
    target_lang: str = "zh-CN"
    source_lang: str | None = None
    source_text: str
    translated_text: str
    prompt_version: str = "v1"
    cached: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    first_token_ms: float | None = None
    total_duration_ms: float | None = None
    created_at: str | None = None
    updated_at: str | None = None


class TranslationHistoryItem(BaseModel):
    request_id: str
    provider: str
    model: str
    source_text: str
    translated_text: str
    target_lang: str = "zh-CN"
    created_at: str
