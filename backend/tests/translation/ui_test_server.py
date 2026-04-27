from __future__ import annotations

import socket
import threading
import time
from collections.abc import Generator

import requests
import uvicorn


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_test_server(
    app, health_path: str = "/api/translation/health"
) -> Generator[str, None, None]:
    port = _get_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)

    def run_server() -> None:
        server.run()

    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            response = requests.get(f"{base_url}{health_path}", timeout=0.5)
            if response.status_code == 200:
                break
        except requests.RequestException:
            time.sleep(0.1)
    else:
        raise RuntimeError("Server failed to start")

    try:
        yield base_url
    finally:
        server.should_exit = True
        thread.join(timeout=3)
