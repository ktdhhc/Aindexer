from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from .prompt_store import get_required_prompt


PROVIDER_TEST_SYSTEM_PROMPT = get_required_prompt("provider_test_system_prompt.txt")
PROVIDER_TEST_USER_PROMPT = get_required_prompt("provider_test_user_prompt.txt")
JSON_SCHEMA_HINT = get_required_prompt("json_schema_hint.txt")


@dataclass
class ProviderConfig:
    provider: str
    base_url: str
    model: str
    api_key: str
    temperature: float = 0.1
    timeout: int = 120


class ProviderClient:
    @staticmethod
    def test_connection(config: ProviderConfig) -> tuple[bool, str, float]:
        temp = _effective_temperature(config.model, config.temperature)
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": PROVIDER_TEST_SYSTEM_PROMPT},
                {"role": "user", "content": PROVIDER_TEST_USER_PROMPT},
            ],
            "temperature": temp,
            "max_tokens": 20,
        }
        url = config.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=config.timeout) as client:
                response = client.post(url, headers=headers, json=payload)
            elapsed = response.elapsed.total_seconds() if response.elapsed else 0.0
            if response.status_code >= 400:
                return (
                    False,
                    f"HTTP {response.status_code}: {response.text[:300]}",
                    elapsed,
                )
            body = response.json()
            text = _extract_assistant_text(body)
            return True, text[:200], elapsed
        except UnicodeError as exc:
            return False, _format_url_error(config.base_url, exc), 0.0
        except Exception as exc:
            return False, str(exc), 0.0

    @staticmethod
    def generate_json(
        config: ProviderConfig,
        system_prompt: str,
        user_prompt: str,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict:
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": system_prompt + "\n" + JSON_SCHEMA_HINT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": _effective_temperature(config.model, config.temperature),
            "max_tokens": 2500,
            "stream": True,
        }
        url = config.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }
        logger = logging.getLogger(__name__)
        attempts = 3
        for idx in range(1, attempts + 1):
            if should_cancel and should_cancel():
                raise RuntimeError("cancelled by user before request")
            try:
                text = _stream_chat_completion(
                    url=url,
                    headers=headers,
                    payload=payload,
                    timeout=config.timeout,
                    should_cancel=should_cancel,
                )
                try:
                    return _parse_json_strict(text)
                except Exception as exc:
                    raw = _truncate_text(text, 1200)
                    raise RuntimeError(f"LLM响应JSON解析失败: {exc}; 响应片段: {raw}")
            except (
                httpx.RemoteProtocolError,
                httpx.ReadError,
                httpx.ReadTimeout,
                httpx.ConnectError,
            ) as exc:
                logger.warning(
                    "LLM transport error provider=%s model=%s attempt=%s/%s error=%s",
                    config.provider,
                    config.model,
                    idx,
                    attempts,
                    str(exc),
                )
                if idx >= attempts:
                    raise RuntimeError(
                        f"LLM transport error after {attempts} attempts: {exc}"
                    )
                if should_cancel and should_cancel():
                    raise RuntimeError("cancelled by user during retries")
                time.sleep(0.6 * idx)
            except UnicodeError as exc:
                raise RuntimeError(_format_url_error(config.base_url, exc))
        raise RuntimeError("LLM request failed before response")


def _stream_chat_completion(
    url: str,
    headers: dict[str, str],
    payload: dict,
    timeout: int,
    should_cancel: Callable[[], bool] | None = None,
) -> str:
    timeout_cfg = httpx.Timeout(
        connect=min(timeout, 30), read=None, write=timeout, pool=timeout
    )
    with httpx.Client(timeout=timeout_cfg) as client:
        with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                req_id = (
                    resp.headers.get("x-request-id")
                    or resp.headers.get("request-id")
                    or ""
                )
                detail = _truncate_text(_read_stream_response_text(resp), 1200)
                rid = f" request_id={req_id}" if req_id else ""
                raise RuntimeError(f"LLM HTTP {resp.status_code}{rid}: {detail}")

            parts: list[str] = []
            raw_lines: list[str] = []
            for line in resp.iter_lines():
                if should_cancel and should_cancel():
                    raise RuntimeError("cancelled by user during stream")
                text_line = (line or "").strip()
                if not text_line:
                    continue
                raw_lines.append(text_line)
                if text_line.startswith("data:"):
                    data = text_line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(data)
                    except Exception:
                        continue
                    delta_text = _extract_stream_delta_text(chunk)
                    if delta_text:
                        parts.append(delta_text)

            if parts:
                return "".join(parts).strip()

            # 部分 provider 可能忽略 stream 参数，直接返回完整 JSON
            if raw_lines:
                joined = "\n".join(raw_lines)
                if joined.startswith("{"):
                    try:
                        body = json.loads(joined)
                        return _extract_assistant_text(body)
                    except Exception:
                        pass
                for line in raw_lines:
                    if line.startswith("data:"):
                        data = line[5:].strip()
                        if data and data != "[DONE]":
                            return data

            raise RuntimeError("LLM流式响应为空")


def _extract_stream_delta_text(chunk: dict) -> str:
    choices = chunk.get("choices") or []
    if not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    direct_text = first.get("text")
    if isinstance(direct_text, str):
        return direct_text
    delta = first.get("delta") or {}
    if isinstance(delta, dict):
        content = delta.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("text")
            ]
            return "".join(texts)
    # 兼容极少数 provider 直接在 message/content 回传
    msg = first.get("message") or {}
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, str):
            return content
    return ""


def _extract_assistant_text(data: dict) -> str:
    choices = data.get("choices") or []
    if choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = [c.get("text", "") for c in content if isinstance(c, dict)]
            return "\n".join(parts).strip()
    return json.dumps(data, ensure_ascii=False)


def _parse_json_strict(text: str) -> dict:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        if "Invalid control character" not in str(exc):
            raise
        repaired = _escape_newlines_in_json_strings(text)
        return json.loads(repaired)


def _escape_newlines_in_json_strings(text: str) -> str:
    out: list[str] = []
    in_string = False
    escaped = False
    for ch in text:
        if escaped:
            out.append(ch)
            escaped = False
            continue
        if ch == "\\":
            out.append(ch)
            escaped = True
            continue
        if ch == '"':
            out.append(ch)
            in_string = not in_string
            continue
        if in_string and ch in ("\n", "\r", "\t"):
            if ch == "\n":
                out.append("\\n")
            elif ch == "\r":
                out.append("\\r")
            else:
                out.append("\\t")
            continue
        out.append(ch)
    return "".join(out)


def _truncate_text(text: str, limit: int) -> str:
    s = (text or "").strip()
    if len(s) <= limit:
        return s
    return s[:limit] + " ...[truncated]"


def _read_stream_response_text(resp: httpx.Response) -> str:
    try:
        data = resp.read()
    except Exception:
        return ""
    if not data:
        return ""
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        return str(data)


def _format_url_error(base_url: str, exc: Exception) -> str:
    safe_url = (base_url or "").strip()
    return (
        "Provider URL 格式错误，请检查 Base URL（常见为主机名前后多了点号、包含连续点号）"
        f": {safe_url!r}; {exc}"
    )


def _effective_temperature(model: str, temperature: float) -> float:
    m = str(model or "").strip().lower()
    if m.startswith("moonshotai/kimi") or m.startswith("kimi"):
        return 1.0
    return float(temperature)
