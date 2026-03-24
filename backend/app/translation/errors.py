from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class TranslatorErrorCode(str, Enum):
    INVALID_ANCHOR = "invalid_anchor"
    INVALID_REQUEST = "invalid_request"
    SELECTION_TOO_SHORT = "selection_too_short"
    UNSUPPORTED_DOCUMENT = "unsupported_document"
    PROVIDER_NOT_CONFIGURED = "provider_not_configured"
    PROVIDER_TIMEOUT = "provider_timeout"
    STALE_REQUEST = "stale_request"


class TranslationErrorOut(BaseModel):
    code: TranslatorErrorCode
    message: str
