from app.services import provider_client


def test_extract_stream_reasoning_text_from_delta_field() -> None:
    chunk = {
        "choices": [
            {
                "delta": {
                    "reasoning_content": "step one",
                    "content": "final",
                }
            }
        ]
    }

    assert provider_client._extract_stream_reasoning_text(chunk) == "step one"


def test_extract_stream_reasoning_text_from_content_blocks() -> None:
    chunk = {
        "choices": [
            {
                "delta": {
                    "content": [
                        {"type": "reasoning", "text": "think a"},
                        {"type": "text", "text": "answer"},
                    ]
                }
            }
        ]
    }

    assert provider_client._extract_stream_reasoning_text(chunk) == "think a"
