from __future__ import annotations

import copy
import threading
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class RuntimeTask:
    task_id: str
    kind: str
    status: str = "idle"
    phase: str = ""
    percent: int | None = None
    message: str = ""
    cancellable: bool = True
    created_at: str = field(default_factory=_utcnow)
    started_at: str = ""
    finished_at: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    cancel_requested: bool = False

    def snapshot(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "kind": self.kind,
            "status": self.status,
            "phase": self.phase,
            "percent": self.percent,
            "message": self.message,
            "cancellable": self.cancellable and self.status not in TERMINAL_STATUSES,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": copy.deepcopy(self.result),
            "error": self.error,
        }


class RuntimeTaskRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tasks: dict[str, RuntimeTask] = {}

    def create(self, kind: str, message: str, phase: str = "", status: str = "preparing") -> dict[str, Any]:
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        task = RuntimeTask(
            task_id=task_id,
            kind=kind,
            status=status,
            phase=phase,
            message=message,
            started_at=_utcnow() if status in {"preparing", "running", "saving"} else "",
        )
        with self._lock:
            self._tasks[task_id] = task
        return task.snapshot()

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            return task.snapshot() if task else None

    def list(self, *, include_terminal: bool = False) -> list[dict[str, Any]]:
        with self._lock:
            tasks = list(self._tasks.values())
        if not include_terminal:
            tasks = [task for task in tasks if task.status not in TERMINAL_STATUSES]
        return [task.snapshot() for task in tasks]

    def update(
        self,
        task_id: str,
        *,
        status: str | None = None,
        phase: str | None = None,
        percent: int | None = None,
        message: str | None = None,
        cancellable: bool | None = None,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            if status is not None:
                task.status = status
                if status in {"preparing", "running", "saving"} and not task.started_at:
                    task.started_at = _utcnow()
                if status in TERMINAL_STATUSES:
                    task.finished_at = _utcnow()
            if phase is not None:
                task.phase = phase
            if percent is not None:
                task.percent = max(0, min(100, int(percent)))
            if message is not None:
                task.message = message
            if cancellable is not None:
                task.cancellable = bool(cancellable)
            if result is not None:
                task.result = copy.deepcopy(result)
            if error is not None:
                task.error = error
            return task.snapshot()

    def complete(self, task_id: str, result: dict[str, Any] | None = None, message: str = "已完成") -> dict[str, Any] | None:
        return self.update(
            task_id,
            status="completed",
            percent=100,
            message=message,
            cancellable=False,
            result=result or {},
            error=None,
        )

    def fail(self, task_id: str, message: str) -> dict[str, Any] | None:
        return self.update(
            task_id,
            status="failed",
            message=message,
            cancellable=False,
            error=message,
        )

    def request_cancel(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            task.cancel_requested = True
            if task.status in TERMINAL_STATUSES:
                return task.snapshot()
            if not task.cancellable:
                return task.snapshot()
            task.message = "正在取消"
            return task.snapshot()

    def should_cancel(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            return bool(task and task.cancel_requested)

    def mark_cancelled(self, task_id: str, message: str = "已取消") -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            task.cancel_requested = True
        return self.update(
            task_id,
            status="cancelled",
            message=message,
            cancellable=False,
            error=None,
        )


TASKS = RuntimeTaskRegistry()
