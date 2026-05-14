from __future__ import annotations

import importlib

from app import config as app_config


def test_data_dir_can_be_overridden_for_desktop_runtime(monkeypatch, tmp_path) -> None:
    data_dir = tmp_path / "desktop-data"
    with monkeypatch.context() as m:
        m.setenv("AINDEXER_DATA_DIR", str(data_dir))
        config = importlib.reload(app_config)
        assert config.DATA_DIR == data_dir.resolve()
        assert config.DB_PATH == data_dir.resolve() / "app.db"
        assert config.LOG_DIR == data_dir.resolve() / "logs"
    importlib.reload(app_config)


def test_frozen_runtime_defaults_to_localappdata(monkeypatch, tmp_path) -> None:
    localappdata = tmp_path / "localappdata"
    localappdata.mkdir()

    with monkeypatch.context() as m:
        m.delenv("AINDEXER_DATA_DIR", raising=False)
        m.setenv("LOCALAPPDATA", str(localappdata))
        m.delenv("APPDATA", raising=False)
        m.setattr(app_config.sys, "frozen", True, raising=False)
        config = importlib.reload(app_config)
        expected_dir = (localappdata / "Aindexer" / "v4" / "data").resolve()
        assert config.DATA_DIR == expected_dir
        assert config.DB_PATH == expected_dir / "app.db"

    importlib.reload(app_config)
