# Chat With LLM - V1 Detailed Plan

## V1 目标

- 在不引入原文深度检索的前提下，先完成“会话化问答 + 索引级检索 + 流式回复 + 中断 + 进度反馈”闭环。
- 让用户可以快速验证：问题是否能在现有索引语料中被命中并得到可引用回答。

## 隔离约束（必须满足）

- Chat 为独立模块开发，不改变现有索引生成主链路。
- 仅新增 `/api/chat/*` 路由，不改原有接口语义与返回结构。
- Chat 任务使用独立运行状态管理，不与索引任务共享线程状态容器。
- Chat 仅读取现有索引数据，V1 不回写 `index_records/claims/documents`。
- 前端 Chat 使用独立状态域（`chatState`），不复用上传/搜索全局状态对象。

## 功能边界（V1）

### 包含
- 会话：新建/切换/删除。
- 问答：基于索引内容检索 + LLM 回答。
- 流式：前端逐步显示答案。
- 中断：可取消当前生成。
- 进度：显示当前阶段与百分比。
- 引用：回答附带命中文献 `doc_id` 列表。

### 不包含（后续版本）
- 原文分块深度检索。
- 全量分批检索。
- 复杂 rerank 与缓存策略。

## 信息架构与交互

### 页面布局建议
- 在现有页面新增“Chat with LLM”区域（可放右侧预览下方或单独 Tab）。
- 左栏：会话列表（新建、重命名可后置、删除）。
- 右栏：消息流 + 输入框 + 发送/中断按钮 + 进度条。

### 核心交互流程
1. 用户新建会话并提问。
2. 前端调用 `ask` 接口启动任务。
3. 后端返回 `run_id`，前端建立 SSE 监听。
4. 前端实时显示阶段：
   - `retrieving`（检索索引）
   - `grounding`（拼接上下文）
   - `generating`（模型流式输出）
5. 用户可点击“中断”，任务停止并保留已输出内容。

## 后端设计

### 新增表（建议）
- `chat_sessions`
  - `id TEXT PK`
  - `title TEXT`
  - `created_at TEXT`
  - `updated_at TEXT`
- `chat_messages`
  - `id INTEGER PK`
  - `session_id TEXT`
  - `role TEXT` (`user` / `assistant` / `system`)
  - `content TEXT`
  - `meta_json TEXT`（引用 doc_id、阶段信息、统计）
  - `created_at TEXT`
- `chat_runs`
  - `id TEXT PK`
  - `session_id TEXT`
  - `status TEXT` (`running`/`done`/`failed`/`cancelled`)
  - `stage TEXT`
  - `progress INTEGER`
  - `cancel_requested INTEGER`
  - `error_message TEXT`
  - `created_at TEXT`
  - `updated_at TEXT`

### 新增 API（V1）
- 会话
  - `POST /api/chat/sessions`
  - `GET /api/chat/sessions`
  - `DELETE /api/chat/sessions/{session_id}`
- 消息
  - `GET /api/chat/sessions/{session_id}/messages`
- 运行
  - `POST /api/chat/sessions/{session_id}/ask`
  - `GET /api/chat/runs/{run_id}/stream` (SSE)
  - `POST /api/chat/runs/{run_id}/cancel`

### 代码落位建议（最小侵入）
- 路由：`backend/app/routers/chat.py`
- 服务：
  - `backend/app/services/chat_orchestrator.py`
  - `backend/app/services/chat_retriever.py`
  - `backend/app/services/chat_answerer.py`
- 仓储：在 `backend/app/repository.py` 新增 chat 相关函数，统一前缀 `chat_*`
- Prompt：`backend/prompts/chat/` 下新增 V1 prompt 文件
- 主入口：`backend/app/main.py` 仅新增 chat router 挂载，不改现有 router 逻辑

### 服务层拆分建议
- `chat_retriever.py`
  - 基于 `search` 和 `index_records` 召回 top-k。
- `chat_orchestrator.py`
  - 管理状态机、进度、取消、SSE 事件。
- `chat_answerer.py`
  - 组织 prompt，调用 ProviderClient，返回结构化回答。

## Prompt 与输出约束（V1）

### 新增 prompt 文件（建议）
- `backend/prompts/chat/v1_answer_system.txt`
- `backend/prompts/chat/v1_answer_user_template.txt`
- `backend/prompts/chat/v1_response_schema_hint.txt`

### 回答 JSON 建议结构
```json
{
  "decision": "direct_answer|request_deep_search",
  "answer": "...",
  "evidence": [
    {
      "doc_id": "doc_xxx",
      "quote": "...",
      "why_relevant": "..."
    }
  ],
  "confidence": 0.0,
  "next_action_hint": "..."
}
```

### 约束
- 输出尽量中文（与项目当前中文输出策略一致）。
- 不允许无证据强结论；证据不足时给出不确定说明。

## 进度与中断机制

### 阶段映射（建议）
- `queued` -> 5%
- `retrieving` -> 25%
- `grounding` -> 45%
- `generating` -> 45%~95%（按流式增量推进）
- `done` -> 100%

### 中断行为
- 前端发 `cancel` 后，后端设置 `cancel_requested=1`。
- 服务层在检索和流式读取循环内都检查取消标记。
- 中断后状态置 `cancelled`，保留已生成片段。

## 实施步骤（按开发顺序）

1. **数据库迁移**：新增 3 张 chat 表。
2. **仓储层**：补会话、消息、run 的 CRUD。
3. **后端路由**：先做会话和消息，再做 ask/stream/cancel。
4. **服务编排**：实现 V1 检索 + 生成 + SSE 事件流。
5. **前端 UI**：会话列表、消息区、输入区、进度条和取消按钮（全部挂在独立 chat 容器内）。
6. **联调**：验证流式稳定性与取消即时性。
7. **错误处理**：统一显示错误信息与降级提示。
8. **灰度开关**：加入 `CHAT_ENABLED`，默认关闭，联调完成后开启。

## 验收清单（V1）

- 可创建多个会话并切换历史消息。
- 提问可收到流式回答，且回答含引用文献编号。
- 点击中断后 2 秒内停止流输出。
- 进度条与阶段文案准确变化。
- 异常时不会卡死，能提示“可尝试深度检索（V2）”。
- 关闭 `CHAT_ENABLED` 后，现有上传/索引/搜索功能完全不受影响。

## 风险与防护

- 风险：索引召回质量不足导致“答非所问”。
  - 防护：top-k 稍大 + 证据约束 + 不确定时明确拒答。
- 风险：流式连接中断。
  - 防护：前端重连提示 + 后端 run 状态可查询。
- 风险：回答波动。
  - 防护：低温度 + 固定 schema + 引用必须项。

## 与后续版本的衔接

- V1 的 `decision` 字段直接对接 V2 的“深度检索申请”。
- V1 的 run 状态机可平滑扩展到 V3 批处理阶段。
- V1 的 prompt 目录结构可复用于 V2/V3/V4。
