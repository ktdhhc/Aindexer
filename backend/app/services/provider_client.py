from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import httpx

from ..provider_registry import resolve_model_name_registry_entry
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


@dataclass
class StreamChatCompletionResult:
    text: str
    usage: dict | None = None
    first_token_ms: float | None = None
    total_duration_ms: float | None = None
    finish_reason: str | None = None
    raw_response: dict | None = None


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
        on_thinking: Callable[[str], None] | None = None,
        on_progress: Callable[[str, str, int], None] | None = None,
        max_tokens: int = 2500,
        stream: bool = True,
        use_json_mode: bool = True,
    ) -> dict:
        resolved_max_tokens = _effective_json_max_tokens(config.model, max_tokens)
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": system_prompt + "\n" + JSON_SCHEMA_HINT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": _effective_temperature(config.model, config.temperature),
            "max_tokens": resolved_max_tokens,
            "stream": stream,
        }
        if use_json_mode:
            payload["response_format"] = {"type": "json_object"}
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
                if stream:
                    text = stream_chat_completion_with_metrics(
                        url=url,
                        headers=headers,
                        payload=payload,
                        timeout=config.timeout,
                        should_cancel=should_cancel,
                        on_thinking=on_thinking,
                        on_text_delta=on_progress,
                    ).text
                else:
                    body = post_chat_completion_json(
                        url=url,
                        headers=headers,
                        payload=payload,
                        timeout=config.timeout,
                    )
                    text = _extract_assistant_text(body)
                    if not text.strip():
                        raise RuntimeError("LLM JSON mode empty content")
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

    @staticmethod
    def generate_text(
        config: ProviderConfig,
        system_prompt: str,
        user_prompt: str,
        should_cancel: Callable[[], bool] | None = None,
        max_tokens: int | None = None,
        stream: bool = True,
    ) -> str:
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": _effective_temperature(config.model, config.temperature),
            "max_tokens": _effective_json_max_tokens(config.model, max_tokens or _chat_max_tokens(config.model)),
            "stream": stream,
        }
        url = config.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            if stream:
                text = stream_chat_completion_with_metrics(
                    url=url,
                    headers=headers,
                    payload=payload,
                    timeout=config.timeout,
                    should_cancel=should_cancel,
                ).text
            else:
                body = post_chat_completion_json(
                    url=url,
                    headers=headers,
                    payload=payload,
                    timeout=config.timeout,
                )
                text = _extract_assistant_text(body)
        except UnicodeError as exc:
            raise RuntimeError(_format_url_error(config.base_url, exc)) from exc
        return text.strip()

    @staticmethod
    def stream_text(
        config: ProviderConfig,
        system_prompt: str,
        user_prompt: str,
        should_cancel: Callable[[], bool] | None = None,
        on_finish: Callable[[str | None], None] | None = None,
        on_thinking: Callable[[str], None] | None = None,
    ) -> Iterator[str]:
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": _effective_temperature(config.model, config.temperature),
            "max_tokens": _chat_max_tokens(config.model),
            "stream": True,
        }
        url = config.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            yield from stream_chat_completion_chunks(
                url=url,
                headers=headers,
                payload=payload,
                timeout=config.timeout,
                should_cancel=should_cancel,
                on_finish=on_finish,
                on_thinking=on_thinking,
            )
        except UnicodeError as exc:
            raise RuntimeError(_format_url_error(config.base_url, exc)) from exc

    @staticmethod
    def stream_events(
        config: ProviderConfig,
        system_prompt: str,
        user_prompt: str,
        should_cancel: Callable[[], bool] | None = None,
    ) -> Iterator[dict[str, str | None]]:
        payload = {
            "model": config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": _effective_temperature(config.model, config.temperature),
            "max_tokens": _chat_max_tokens(config.model),
            "stream": True,
        }
        url = config.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }
        try:
            yield from stream_chat_completion_events(
                url=url,
                headers=headers,
                payload=payload,
                timeout=config.timeout,
                should_cancel=should_cancel,
            )
        except UnicodeError as exc:
            raise RuntimeError(_format_url_error(config.base_url, exc)) from exc


def stream_chat_completion_with_metrics(
    url: str,
    headers: dict[str, str],
    payload: dict,
    timeout: int,
    should_cancel: Callable[[], bool] | None = None,
    on_thinking: Callable[[str], None] | None = None,
    on_text_delta: Callable[[str, str, int], None] | None = None,
) -> StreamChatCompletionResult:
    timeout_cfg = httpx.Timeout(
        connect=min(timeout, 30), read=None, write=timeout, pool=timeout
    )
    started_at = time.perf_counter()
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
            usage: dict | None = None
            finish_reason: str | None = None
            raw_response: dict | None = None
            first_token_ms: float | None = None
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
                    raw_response = chunk

                    # 检测流内错误对象（deepseek / 部分 provider 在 SSE 中回传 error）
                    chunk_error = chunk.get("error")
                    if isinstance(chunk_error, dict):
                        err_msg = chunk_error.get("message") or str(chunk_error)
                        err_code = chunk_error.get("code", "")
                        raise RuntimeError(
                            f"LLM stream error code={err_code}: {err_msg}"
                        )

                    chunk_usage = chunk.get("usage")
                    if isinstance(chunk_usage, dict):
                        usage = chunk_usage
                    finish_reason = (
                        _extract_stream_finish_reason(chunk) or finish_reason
                    )
                    thinking_text = _extract_stream_reasoning_text(chunk)
                    if thinking_text and on_thinking:
                        on_thinking(thinking_text)
                    delta_text = _extract_stream_delta_text(chunk)
                    if delta_text:
                        if first_token_ms is None:
                            first_token_ms = (time.perf_counter() - started_at) * 1000.0
                        parts.append(delta_text)
                        if on_text_delta:
                            on_text_delta(delta_text, "".join(parts), int(payload.get("max_tokens") or 0))

            if parts:
                return StreamChatCompletionResult(
                    text="".join(parts).strip(),
                    usage=usage,
                    first_token_ms=first_token_ms,
                    total_duration_ms=(time.perf_counter() - started_at) * 1000.0,
                    finish_reason=finish_reason,
                    raw_response=raw_response,
                )

            # 部分 provider 可能忽略 stream 参数，直接返回完整 JSON
            if raw_lines:
                joined = "\n".join(raw_lines)
                if joined.startswith("{"):
                    try:
                        body = json.loads(joined)
                        thinking_text = _extract_body_reasoning_text(body)
                        if thinking_text and on_thinking:
                            on_thinking(thinking_text)
                        return StreamChatCompletionResult(
                            text=_extract_assistant_text(body),
                            usage=body.get("usage")
                            if isinstance(body.get("usage"), dict)
                            else None,
                            first_token_ms=(time.perf_counter() - started_at) * 1000.0,
                            total_duration_ms=(time.perf_counter() - started_at)
                            * 1000.0,
                            finish_reason=_extract_body_finish_reason(body),
                            raw_response=body,
                        )
                    except Exception:
                        pass
                for line in raw_lines:
                    if line.startswith("data:"):
                        data = line[5:].strip()
                        if data and data != "[DONE]":
                            try:
                                parsed = json.loads(data)
                            except Exception:
                                parsed = None
                            if _is_stream_chunk_envelope(parsed):
                                continue
                            return StreamChatCompletionResult(
                                text=data,
                                first_token_ms=(time.perf_counter() - started_at)
                                * 1000.0,
                                total_duration_ms=(time.perf_counter() - started_at)
                                * 1000.0,
                            )

            raise RuntimeError(
                f"LLM流式响应为空 (model={payload.get('model', '?')}, "
                f"max_tokens={payload.get('max_tokens', '?')}, "
                f"response_lines={len(raw_lines)})"
            )


def _stream_chat_completion(
    url: str,
    headers: dict[str, str],
    payload: dict,
    timeout: int,
    should_cancel: Callable[[], bool] | None = None,
) -> str:
    return stream_chat_completion_with_metrics(
        url=url,
        headers=headers,
        payload=payload,
        timeout=timeout,
        should_cancel=should_cancel,
    ).text


def stream_chat_completion_chunks(
    url: str,
    headers: dict[str, str],
    payload: dict,
    timeout: int,
    should_cancel: Callable[[], bool] | None = None,
    on_finish: Callable[[str | None], None] | None = None,
    on_thinking: Callable[[str], None] | None = None,
) -> Iterator[str]:
    for event in stream_chat_completion_events(
        url=url,
        headers=headers,
        payload=payload,
        timeout=timeout,
        should_cancel=should_cancel,
    ):
        if event["type"] == "thinking":
            if on_thinking and event.get("text"):
                on_thinking(str(event["text"]))
            continue
        if event["type"] == "text":
            yield str(event.get("text") or "")
            continue
        if event["type"] == "finish":
            if on_finish:
                on_finish(str(event.get("finish_reason")) if event.get("finish_reason") else None)
            return


def stream_chat_completion_events(
    url: str,
    headers: dict[str, str],
    payload: dict,
    timeout: int,
    should_cancel: Callable[[], bool] | None = None,
) -> Iterator[dict[str, str | None]]:
    timeout_cfg = httpx.Timeout(
        connect=min(timeout, 30), read=None, write=timeout, pool=timeout
    )
    with httpx.Client(timeout=timeout_cfg) as client:
        with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                req_id = resp.headers.get("x-request-id") or resp.headers.get("request-id") or ""
                detail = _truncate_text(_read_stream_response_text(resp), 1200)
                rid = f" request_id={req_id}" if req_id else ""
                raise RuntimeError(f"LLM HTTP {resp.status_code}{rid}: {detail}")

            raw_lines: list[str] = []
            yielded = False
            finish_reason: str | None = None
            for line in resp.iter_lines():
                if should_cancel and should_cancel():
                    raise RuntimeError("cancelled by user during stream")
                text_line = (line or "").strip()
                if not text_line:
                    continue
                raw_lines.append(text_line)
                if not text_line.startswith("data:"):
                    continue
                data = text_line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    chunk = json.loads(data)
                except Exception:
                    continue

                chunk_error = chunk.get("error")
                if isinstance(chunk_error, dict):
                    err_msg = chunk_error.get("message") or str(chunk_error)
                    err_code = chunk_error.get("code", "")
                    raise RuntimeError(f"LLM stream error code={err_code}: {err_msg}")

                finish_reason = _extract_stream_finish_reason(chunk) or finish_reason
                thinking_text = _extract_stream_reasoning_text(chunk)
                if thinking_text:
                    yielded = True
                    yield {"type": "thinking", "text": thinking_text}
                delta_text = _extract_stream_delta_text(chunk)
                if delta_text:
                    yielded = True
                    yield {"type": "text", "text": delta_text}

            if yielded:
                yield {"type": "finish", "finish_reason": finish_reason}
                return

            if raw_lines:
                joined = "\n".join(raw_lines)
                if joined.startswith("{"):
                    try:
                        body = json.loads(joined)
                    except Exception:
                        body = None
                    if isinstance(body, dict):
                        text = _extract_assistant_text(body)
                        thinking_text = _extract_body_reasoning_text(body)
                        if thinking_text:
                            yield {"type": "thinking", "text": thinking_text}
                        if text:
                            yield {"type": "text", "text": text}
                            yield {
                                "type": "finish",
                                "finish_reason": _extract_body_finish_reason(body),
                            }
                            return

    raise RuntimeError(
        f"LLM流式响应为空 (model={payload.get('model', '?')}, max_tokens={payload.get('max_tokens', '?')})"
    )


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


def _extract_stream_reasoning_text(chunk: dict) -> str:
    choices = chunk.get("choices") or []
    if not choices:
        return ""
    first = choices[0] if isinstance(choices[0], dict) else {}
    delta = first.get("delta") or {}
    if isinstance(delta, dict):
        direct = _string_from_reasoning_fields(delta)
        if direct:
            return direct
        content = delta.get("content")
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                item_type = str(item.get("type") or "").lower()
                if item_type in {"reasoning", "thinking", "reasoning_content"}:
                    text = str(item.get("text") or item.get("content") or "")
                    if text:
                        parts.append(text)
            if parts:
                return "".join(parts)
    msg = first.get("message") or {}
    if isinstance(msg, dict):
        return _string_from_reasoning_fields(msg)
    return ""


def _extract_stream_finish_reason(chunk: dict) -> str | None:
    choices = chunk.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return None
    finish_reason = choices[0].get("finish_reason")
    return str(finish_reason) if finish_reason else None


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
    return ""


def _is_stream_chunk_envelope(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    obj = str(payload.get("object") or "").strip().lower()
    return obj.endswith("chat.completion.chunk")


def post_chat_completion_json(
    url: str,
    headers: dict[str, str],
    payload: dict,
    timeout: int,
) -> dict:
    with httpx.Client(timeout=timeout) as client:
        response = client.post(url, headers=headers, json=payload)
    if response.status_code >= 400:
        req_id = response.headers.get("x-request-id") or response.headers.get("request-id") or ""
        rid = f" request_id={req_id}" if req_id else ""
        raise RuntimeError(f"LLM HTTP {response.status_code}{rid}: {_truncate_text(response.text, 1200)}")
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        err = body["error"]
        raise RuntimeError(f"LLM error code={err.get('code', '')}: {err.get('message') or err}")
    return body


def _extract_body_finish_reason(data: dict) -> str | None:
    choices = data.get("choices") or []
    if choices and isinstance(choices[0], dict):
        finish_reason = choices[0].get("finish_reason")
        if finish_reason:
            return str(finish_reason)
    return None


def _extract_body_reasoning_text(data: dict) -> str:
    choices = data.get("choices") or []
    if choices and isinstance(choices[0], dict):
        msg = choices[0].get("message") or {}
        if isinstance(msg, dict):
            direct = _string_from_reasoning_fields(msg)
            if direct:
                return direct
            content = msg.get("content")
            if isinstance(content, list):
                parts = [
                    str(item.get("text") or item.get("content") or "")
                    for item in content
                    if isinstance(item, dict)
                    and str(item.get("type") or "").lower() in {"reasoning", "thinking", "reasoning_content"}
                    and (item.get("text") or item.get("content"))
                ]
                return "".join(parts)
    return ""


def _string_from_reasoning_fields(payload: dict) -> str:
    for key in ("reasoning_content", "reasoning", "thinking"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
        if isinstance(value, list):
            parts = [str(item) for item in value if isinstance(item, str) and item]
            if parts:
                return "".join(parts)
        if isinstance(value, dict):
            text = value.get("text") or value.get("content")
            if isinstance(text, str) and text:
                return text
    return ""


def _parse_json_strict(text: str) -> dict:
    text = (text or "").strip()
    # 去掉任意位置的 markdown 围栏（支持 ```json / ``` / ~~~json / ~~~）
    text = re.sub(r"^```[a-zA-Z]*\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = re.sub(r"^~~~[a-zA-Z]*\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*~~~$", "", text)
    # 去掉可能出现的多余围栏（deepseek 有时在 JSON 前后多出围栏）
    text = re.sub(r"```[a-zA-Z]*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"~~~[a-zA-Z]*", "", text, flags=re.IGNORECASE)
    # 截取最外层 { } 配对
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


def _effective_max_tokens(model: str, default: int) -> int:
    m = str(model or "").strip().lower()
    # deepseek-reasoner 会消耗额外 token 在推理阶段，需要更高上限
    if "reasoner" in m:
        return max(default * 2, 4096)
    return default


def _effective_json_max_tokens(model: str, default: int) -> int:
    base = _effective_max_tokens(model, default)
    resolved = resolve_model_name_registry_entry(model)
    if not resolved:
        return base
    try:
        max_output = int(resolved.get("max_output_tokens") or 0)
    except (TypeError, ValueError):
        max_output = 0
    if max_output > 0:
        return min(base, max_output)
    return base


def _chat_max_tokens(model: str) -> int:
    base = _effective_max_tokens(model, 12_288)
    resolved = resolve_model_name_registry_entry(model)
    if not resolved:
        return base
    try:
        max_output = int(resolved.get("max_output_tokens") or 0)
    except (TypeError, ValueError):
        max_output = 0
    if max_output > 0:
        return min(base, max_output)
    return base
