from __future__ import annotations

import importlib

from app import config as app_config


def test_data_dir_can_be_overridden_for_desktop_runtime(monkeypatch, tmp_path) -> None:
    data_dir = tmp_path / "desktop-data"
    monkeypatch.setenv("AINDEXER_DATA_DIR", str(data_dir))
    try:
        config = importlib.reload(app_config)
        assert config.DATA_DIR == data_dir.resolve()
        assert config.DB_PATH == data_dir.resolve() / "app.db"
        assert config.LOG_DIR == data_dir.resolve() / "logs"
    finally:
        monkeypatch.delenv("AINDEXER_DATA_DIR", raising=False)
        importlib.reload(app_config)
