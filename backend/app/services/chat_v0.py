from __future__ import annotations

from pathlib import Path

from ..db import DEFAULT_WORKSPACE_ID
from ..repository import get_first_indexed_document, get_index, markdown_path
from .markdown_export import render_markdown
from .prompt_store import get_required_prompt
from .provider_client import ProviderClient, ProviderConfig


CHAT_V0_SYSTEM_PROMPT = get_required_prompt("chat_v0_system_prompt.txt")
CHAT_V0_USER_PROMPT_TEMPLATE = get_required_prompt("chat_v0_user_prompt_template.txt")


def pick_test_chat_document(workspace_id: str = DEFAULT_WORKSPACE_ID) -> dict | None:
    return get_first_indexed_document(workspace_id=workspace_id)


def load_test_chat_context(doc_id: str) -> str:
    md_path = markdown_path(doc_id)
    if md_path.exists():
        return md_path.read_text(encoding="utf-8")
    record = get_index(doc_id)
    if not record:
        raise RuntimeError("测试索引不存在或尚未生成")
    return render_markdown(doc_id, record)


def build_chat_v0_prompt(question: str, context: str) -> tuple[str, str]:
    user_prompt = CHAT_V0_USER_PROMPT_TEMPLATE.format(
        question=question.strip(),
        context=context.strip(),
    )
    return CHAT_V0_SYSTEM_PROMPT, user_prompt


def run_chat_v0(
    question: str,
    provider_cfg: ProviderConfig,
    workspace_id: str = DEFAULT_WORKSPACE_ID,
) -> dict:
    doc = pick_test_chat_document(workspace_id=workspace_id)
    if not doc:
        raise RuntimeError("暂无可用索引，请先完成至少一条文献索引生成")
    doc_id = str(doc.get("id") or "")
    if not doc_id:
        raise RuntimeError("测试文献读取失败")
    context = load_test_chat_context(doc_id)
    system_prompt, user_prompt = build_chat_v0_prompt(question, context)
    answer = ProviderClient.generate_text(
        config=provider_cfg,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    return {
        "doc_id": doc_id,
        "display_name": str(doc.get("display_name") or doc.get("filename") or doc_id),
        "answer": answer.strip(),
    }
