from __future__ import annotations

import argparse
import os
import socket
import sys
from datetime import datetime
from pathlib import Path


def _is_port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _find_available_port(host: str, preferred: int, max_offset: int) -> int:
    if _is_port_available(host, preferred):
        return preferred

    for offset in range(1, max_offset + 1):
        candidate = preferred + offset
        if candidate > 65535:
            break
        if _is_port_available(host, candidate):
            return candidate

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        fallback_port = sock.getsockname()[1]
    return int(fallback_port)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Allocate an available TCP port near a preferred port."
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind")
    parser.add_argument(
        "--preferred", type=int, default=8000, help="Preferred start port"
    )
    parser.add_argument(
        "--max-offset",
        type=int,
        default=200,
        help="How far to scan upward from preferred port",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print allocation details to stderr",
    )
    parser.add_argument(
        "--log",
        default="",
        help="Path to port log file (writes timestamp + port)",
    )
    args = parser.parse_args()

    if not (1 <= args.preferred <= 65535):
        print("Preferred port must be between 1 and 65535", file=sys.stderr)
        return 2

    if args.max_offset < 0:
        print("max-offset must be >= 0", file=sys.stderr)
        return 2

    selected = _find_available_port(args.host, args.preferred, args.max_offset)

    if args.log:
        try:
            log_path = Path(args.log)
            log_path.parent.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with log_path.open("a", encoding="utf-8") as f:
                f.write(
                    f"{ts}  host={args.host}  preferred={args.preferred}  allocated={selected}\n"
                )
        except OSError:
            pass

    if args.verbose:
        if selected == args.preferred:
            print(
                f"Preferred port {args.preferred} is available on {args.host}.",
                file=sys.stderr,
            )
        else:
            print(
                f"Preferred port {args.preferred} is occupied; selected {selected}.",
                file=sys.stderr,
            )
    print(selected)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
