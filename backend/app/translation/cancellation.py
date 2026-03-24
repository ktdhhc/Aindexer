from __future__ import annotations

from contextlib import contextmanager
from threading import Event, Lock
from typing import Iterator

_lock = Lock()
_events: dict[str, Event] = {}


@contextmanager
def managed_cancel_token(client_request_id: str | None) -> Iterator[callable]:
    if not client_request_id:
        yield lambda: False
        return

    event = Event()
    with _lock:
        _events[client_request_id] = event

    try:
        yield event.is_set
    finally:
        with _lock:
            _events.pop(client_request_id, None)


def cancel_request(client_request_id: str) -> bool:
    with _lock:
        event = _events.get(client_request_id)
    if not event:
        return False
    event.set()
    return True
