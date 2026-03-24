from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TranslationProviderErrorKind(str, Enum):
    AUTH = "auth"
    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    UPSTREAM = "upstream"
    RESPONSE_INVALID = "response_invalid"
    CANCELLED = "cancelled"
    NOT_CONFIGURED = "not_configured"


@dataclass(slots=True)
class TranslationProviderRequest:
    provider: str
    model: str
    source_text: str
    target_lang: str
    prompt_version: str
    system_prompt: str
    user_prompt: str
    source_lang: str | None = None
    document_id: str | None = None
    request_id: str | None = None
    anchor_checksum: str | None = None
    anchor_page: int | None = None
    anchor_quote: str | None = None
    enable_thinking: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TranslationProviderResult:
    provider: str
    model: str
    source_text: str
    translated_text: str
    target_lang: str
    prompt_version: str
    source_lang: str | None = None
    finish_reason: str | None = None
    usage: dict[str, Any] | None = None
    raw_response: dict[str, Any] | None = None
    first_token_ms: float | None = None
    total_duration_ms: float | None = None


@dataclass(slots=True)
class TranslationProviderError(Exception):
    kind: TranslationProviderErrorKind
    message: str
    retryable: bool = False
    provider: str | None = None
    model: str | None = None
    cause: Exception | None = None

    def __str__(self) -> str:
        return self.message
