from app.security import decrypt_text, encrypt_text


def test_encrypt_decrypt_roundtrip() -> None:
    plain = "sk-test-123"
    cipher = encrypt_text(plain)
    assert cipher != plain
    assert decrypt_text(cipher) == plain
