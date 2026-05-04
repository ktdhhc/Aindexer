# SERVICES DOMAIN

## OVERVIEW
`backend/app/services/` 承担业务实现和外部能力集成。接口层调用这里，不直接实现复杂流程。

## WHERE TO LOOK
| 需求 | 文件 | 说明 |
|---|---|---|
| LLM 调用 | `backend/app/services/provider_client.py` | provider 请求封装、网络交互、流式事件 |
| Chat 三模式上下文 | `backend/app/services/chat_modes.py` | `wide/deep/agent` 上下文构建、来源编号、token budget |
| Chat agent loop | `backend/app/services/chat_agent.py` | planner / read loop / thinking / trace / cancel |
| chat_v0 逻辑 | `backend/app/services/chat_v0.py` | 旧问答流程业务实现 |
| 索引抽取归一化 | `backend/app/services/extractor.py` | 结果结构化与字段清洗 |
| Prompt 读取 | `backend/app/services/prompt_store.py` | system/user 模板加载 |
| 文件解析 | `backend/app/services/file_parser.py` | pdf/txt/docx 内容抽取 |
| Markdown 导出 | `backend/app/services/markdown_export.py` | 导出文本拼装 |

## CONVENTIONS
- service 负责业务步骤和容错策略；router 只做接口边界。
- 对外部 provider 的接入集中在 provider_client，不在多处散落。
- prompt 文本来源统一由 `prompt_store.py` 管理。
- Chat 来源编号现在由服务端根据当前上下文和 `seq_num` 统一生成；不要重新引入客户端维护的 source map。

## ANTI-PATTERNS (SERVICES)
- 不要在多个 service 文件重复 provider 访问细节。
- 不要绕过 `prompt_store.py` 直接硬编码 prompt 文本。
- 不要让 service 反向依赖运行态目录结构（如 `backend/data/` 细节）。
- 不要在没有前端兼容评估的情况下修改流式事件类型、Chat payload 或来源编号规则。

## NOTES
- 接口入口请回看 `backend/app/routers/AGENTS.md`。
- 修改 Chat 服务层后，至少补跑 `backend/tests/test_chat_modes.py` 与 `backend/tests/test_chat_agent.py`。
- V4 桌面端过程中如无必要，不要把桌面适配逻辑下沉到本域；优先在前端或桌面壳解决。
