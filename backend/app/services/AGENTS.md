# SERVICES DOMAIN

## OVERVIEW
`backend/app/services/` 承担业务实现和外部能力集成。接口层调用这里，不直接实现复杂流程。

## WHERE TO LOOK
| 需求 | 文件 | 说明 |
|---|---|---|
| LLM 调用 | `backend/app/services/provider_client.py` | provider 请求封装、网络交互 |
| 索引抽取归一化 | `backend/app/services/extractor.py` | 结果结构化与字段清洗 |
| Prompt 读取 | `backend/app/services/prompt_store.py` | system/user 模板加载 |
| 文件解析 | `backend/app/services/file_parser.py` | pdf/txt/docx 内容抽取 |
| Markdown 导出 | `backend/app/services/markdown_export.py` | 导出文本拼装 |
| chat_v0 逻辑 | `backend/app/services/chat_v0.py` | 聊天流程业务实现 |

## CONVENTIONS
- service 负责业务步骤和容错策略；router 只做接口边界。
- 对外部 provider 的接入集中在 provider_client，不在多处散落。
- prompt 文本来源统一由 prompt_store 管理。

## ANTI-PATTERNS (SERVICES)
- 不要在多个 service 文件重复 provider 访问细节。
- 不要绕过 `prompt_store.py` 直接硬编码 prompt 文本。
- 不要让 service 反向依赖运行态目录结构（如 `backend/data/` 细节）。

## NOTES
- 接口入口请回看 `backend/app/routers/AGENTS.md`。
- 服务层更新后，至少跑 `backend/tests/test_api_smoke.py` 与 `backend/tests/test_security.py`。
