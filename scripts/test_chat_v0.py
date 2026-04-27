from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.main import app
from app.routers import chat as chat_router


def main() -> None:
    original_get_provider = chat_router.get_provider_config_raw
    original_run = chat_router.run_chat_v0
    try:
        chat_router.get_provider_config_raw = lambda provider: {
            "base_url": "https://example.invalid/v1",
            "model": "mock-model",
            "api_key_enc": "mock-key",
            "temperature": 0.1,
            "timeout": 30,
        }
        chat_router.run_chat_v0 = lambda question, provider_cfg: {
            "doc_id": "doc_test_v0",
            "display_name": "测试索引",
            "answer": f"mock answer for: {question}",
        }

        client = TestClient(app)
        resp = client.post(
            "/api/chat/ask_v0",
            json={
                "question": "这篇文献主要讲了什么？",
                "provider": "mock-provider",
                "model": "mock-model",
            },
        )
        print("status:", resp.status_code)
        print("body:", resp.json())
        if resp.status_code != 200:
            raise SystemExit(1)
    finally:
        chat_router.get_provider_config_raw = original_get_provider
        chat_router.run_chat_v0 = original_run


if __name__ == "__main__":
    main()
