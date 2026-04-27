from __future__ import annotations

import base64
import hashlib

from .config import SECRET_KEY


def _key_bytes() -> bytes:
    return hashlib.sha256(SECRET_KEY.encode("utf-8")).digest()


def encrypt_text(text: str) -> str:
    data = text.encode("utf-8")
    key = _key_bytes()
    encrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(data)])
    return base64.urlsafe_b64encode(encrypted).decode("ascii")


def decrypt_text(cipher_text: str) -> str:
    data = base64.urlsafe_b64decode(cipher_text.encode("ascii"))
    key = _key_bytes()
    plain = bytes([b ^ key[i % len(key)] for i, b in enumerate(data)])
    return plain.decode("utf-8")
