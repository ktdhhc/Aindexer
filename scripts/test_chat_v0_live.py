from __future__ import annotations

import json
import sys
import urllib.request


def main() -> None:
    provider = sys.argv[1] if len(sys.argv) > 1 else "alibaba"
    model = sys.argv[2] if len(sys.argv) > 2 else "qwen3.5-flash-2026-02-23"
    question = sys.argv[3] if len(sys.argv) > 3 else "用一句话概括这篇文献"

    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/chat/ask_v0",
        data=json.dumps(
            {
                "question": question,
                "provider": provider,
                "model": model,
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8", "ignore")
            print("status:", resp.status)
            print("body:", body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        print("status:", exc.code)
        print("body:", body)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
