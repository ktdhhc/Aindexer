from pathlib import Path

from app import db, repository


def _setup_provider_db(tmp_path: Path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    db_path = data_dir / "app.db"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(db, "DB_PATH", db_path)
    monkeypatch.setattr(db, "ensure_dirs", lambda: data_dir.mkdir(parents=True, exist_ok=True))


def test_init_db_seeds_new_default_providers(tmp_path: Path, monkeypatch) -> None:
    _setup_provider_db(tmp_path, monkeypatch)

    db.init_db()

    rows = {item.provider: item for item in repository.get_provider_configs()}
    assert set(rows.keys()) == {"openai", "deepseek", "ali"}
    assert rows["openai"].model == "gpt-5.4"
    assert rows["deepseek"].model == "deepseek-v4-flash"
    assert rows["ali"].model == "deepseek-v4-flash"


def test_init_db_does_not_override_existing_provider_config(tmp_path: Path, monkeypatch) -> None:
    _setup_provider_db(tmp_path, monkeypatch)

    db.init_db()
    repository.save_provider_config(
        provider="openai",
        base_url="https://example.test/v1",
        model="custom-model",
        api_key_enc="secret-key",
        temperature=0.3,
        timeout=66,
        enabled=False,
    )

    db.init_db()

    row = repository.get_provider_config_raw("openai")
    assert row is not None
    assert row["base_url"] == "https://example.test/v1"
    assert row["model"] == "custom-model"
    assert row["api_key_enc"] == "secret-key"
    assert row["temperature"] == 0.3
    assert row["timeout"] == 66
    assert row["enabled"] == 0
