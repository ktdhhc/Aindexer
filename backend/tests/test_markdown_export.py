from __future__ import annotations

from pathlib import Path

import pytest

from app.services.markdown_export import write_markdown


def test_write_markdown_replaces_existing_file_atomically(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "doc.md"

    write_markdown(target, "first")
    write_markdown(target, "second")

    assert target.read_text(encoding="utf-8") == "second"


def test_write_markdown_keeps_existing_file_when_replace_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "doc.md"
    target.write_text("old", encoding="utf-8")

    def fail_replace(self: Path, _target: Path) -> Path:
        raise OSError("replace failed")

    monkeypatch.setattr(Path, "replace", fail_replace)

    with pytest.raises(OSError, match="replace failed"):
        write_markdown(target, "new")

    assert target.read_text(encoding="utf-8") == "old"
    assert list(tmp_path.glob(".*.tmp")) == []
