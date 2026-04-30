# Chat Agent Loop Refactor Plan

## 1. 文档目标

- 为 Chat 探索模式从当前 V1 受限流程升级为真正的多轮 agent loop 建立实施方案。
- 明确三层数据模型、循环协议、取消机制、前后端事件流和测试边界。
- 在正式开发前判断是否需要重构，以及重构范围应控制到哪里。

## 2. 结论摘要

- 需要重构探索模式，但不需要先做数据库大迁移。
- 当前底层数据已经基本具备三层来源：元数据、索引、正文。
- 应新增独立 `chat_agent` 服务，不继续把复杂 loop 塞进 `chat_modes.py`。
- Agent loop 第一轮默认注入工作区全量元数据，不限制探索范围；后续轮次不重复注入全量元数据，除非模型明确请求重新查看或刷新元数据层。
- 模型必须在 system prompt 中知道系统存在元数据层、索引层、正文层，以及每层数据的用途和调用方式。
- 索引层读取数量不做硬性 top-k 限制，但仍要有最大循环次数和取消机制。
- 正文层读取必须有单次 top-k 限制，避免一次性塞入过多完整原文。
- 最大循环次数建议为 6，且必须对模型可见；达到上限后模型必须基于已读内容作答或明确说明信息不足。
- 中断能力必须从“前端 abort”升级为“前端 abort + 后端 run cancel registry + provider should_cancel”。

## 3. 当前实现状态

### 3.1 已具备能力

- `wide` 模式已稳定，使用索引编号 `[I-xx]`。
- `deep` 模式已稳定，使用原文编号 `[P-xx]`。
- 当前 `agent` 模式已具备 V1 受限流程：检索候选、读取索引、按需读取原文摘录、流式输出步骤轨迹。
- 前端已能在 assistant 回复开头显示当前轮 trace，并在正式回答后折叠。
- assistant 回复底部只显示实际引用的来源。

### 3.2 当前不足

- 当前 agent 仍是系统固定策略，不是模型驱动的循环决策。
- 当前索引读取仍有固定数量限制。
- 当前正文层读取是系统按关键词触发，不是模型明确要求。
- 后端没有独立 run 级取消注册表，用户停止后无法保证 provider 请求和中间读取都及时停止。
- `chat_modes.py` 已开始承担过多职责，不适合继续承载复杂 agent loop。

## 4. 三层数据定义

### 4.1 第一层：元数据层 Metadata Layer

用途：快速筛选、候选定位、粗判断。

内容：

- `doc_id`
- `display_name`
- `filename`
- `file_type`
- `title`
- `authors`
- `year`
- `keywords`
- `one_liner`
- `core_points` 简短版本
- 可选的关键 `custom_fields`
- 文档状态与工作区信息

编号规则：

- 元数据层不分配 `I-xx` 或 `P-xx`。
- 元数据层中的 `doc_id` 是后续读取索引/正文的内部定位键。

实现来源：

- `documents`
- `index_records`
- `claims`
- 必要时可复用 `search_documents()` 的字段聚合逻辑，但不应读取 markdown 全文。

### 4.2 第二层：索引层 Index Layer

用途：确认结构化索引内容、提升回答准确性。

内容：

- 完整索引 Markdown。
- 优先读取 `data/indexes/{doc_id}.md`。
- 若 markdown 不存在，使用 `render_markdown(doc_id, record)` 生成。

编号规则：

- 索引层使用 `[I-xx]`。
- 同一篇文献被读取索引后，在同一 session 内编号应稳定。

读取数量规则：

- 不对索引层施加固定 top-k 限制。
- 模型可以一次请求多个索引。
- 系统仍应受最大循环次数、取消、超时和总体上下文预算保护。

### 4.3 第三层：正文层 Paper Layer

用途：核对原文事实、方法细节、实验设计、证据原句、局限描述。

内容：

- 原始文件解析后的完整文本。
- 由 `parse_file(file_path, file_type)` 获取。

编号规则：

- 正文层使用 `[P-xx]`。
- 同一篇文献可同时拥有 `[I-xx]` 和 `[P-xx]`，两者语义不可混用。

读取数量规则：

- 正文层单次读取必须限制 `top_k`。
- 建议默认 `paper_top_k = 2`，可配置但不在首版暴露 UI。
- 如果模型请求超过 top_k，系统截取前 top_k，并把被忽略数量写入 trace。

## 5. Source Map 设计

当前应保留并强化双键机制：

```text
index:{doc_id} -> I-01
paper:{doc_id} -> P-01
```

兼容规则：

- 旧 `doc_id -> I-xx/P-xx` 可继续被识别。
- 新写入一律使用 `index:{doc_id}` 或 `paper:{doc_id}`。
- 前端本地 session normalize 时应继续迁移旧格式。

## 6. Agent Loop 协议

### 6.1 Loop 上限

- 最大循环次数：`max_iterations = 6`。
- 此数字必须写入 system/user prompt，让模型知道剩余轮次。
- 每轮 prompt 都应包含：当前轮次、最大轮次、剩余轮次。
- 达到第 6 轮时，模型不得继续请求更多数据，必须输出最终回答或说明信息不足。

### 6.2 Loop 动作类型

模型每轮只能返回以下动作之一：

```json
{
  "action": "answer" | "read_metadata" | "read_index" | "read_paper" | "not_found",
  "reason": "...",
  "doc_ids": ["doc_a", "doc_b"],
  "answer": "...",
  "citations": {
    "index": ["I-01"],
    "paper": ["P-01"]
  }
}
```

动作语义：

- `answer`：基于已读数据作答。
- `read_metadata`：请求系统重新注入或刷新元数据层，用于重新筛选全库。
- `read_index`：请求系统读取指定文献的完整索引。
- `read_paper`：请求系统读取指定文献的正文层内容。
- `not_found`：确认当前元数据/索引/正文都不足以支持回答。

### 6.3 第一轮输入

第一轮默认注入：

- 用户问题。
- 对话历史摘要。
- 工作区全量元数据。
- 当前 loop 配置：`max_iterations=6`、正文单次 `paper_top_k`。
- 已读索引列表为空。
- 已读正文列表为空。

第一轮目标：

- 让模型基于元数据判断是否可直接回答。
- 如果不能回答，模型选择需要读取的索引层文献。

### 6.4 元数据重复注入规则

为避免上下文爆炸，全量元数据不是每轮都注入。

默认规则：

- 第 1 轮必须注入全量元数据。
- 第 2 轮及之后默认不重复注入全量元数据。
- 第 2 轮及之后默认只注入：
  - 已读取的索引层内容。
  - 已读取的正文层内容。
  - 已执行 trace。
  - 必要的轻量映射，例如已读/候选 `doc_id` 与标题。
- 如果模型认为需要重新筛选全库，可返回 `read_metadata` 请求系统重新注入元数据层。

模型可见规则：

- system prompt 必须说明三层数据都可调用。
- system prompt 必须说明：元数据层默认只在首轮提供，后续如需再次查看必须显式请求 `read_metadata`。
- planner prompt 每轮必须告诉模型本轮是否包含全量元数据。

### 6.5 后续轮输入

每轮输入包含：

- 用户问题。
- 对话历史摘要。
- 本轮是否包含全量元数据的标记。
- 已读/候选文献的轻量映射。
- 已读取索引层内容。
- 已读取正文层内容。
- 已执行步骤 trace。
- 当前轮次与剩余轮次。

### 6.6 终止条件

Loop 在以下情况终止：

- 模型返回 `answer`。
- 模型返回 `not_found`。
- 达到第 6 轮，系统强制要求模型回答。
- 用户取消。
- provider 请求失败。
- 发生不可恢复的数据读取错误。

## 7. 子 Agent 取舍

### 7.1 首版不建议拆成真正并发子 agent

原因：

- 当前系统是本地单机工具，复杂并发会放大取消、状态同步、引用映射和错误恢复成本。
- 当前核心问题是 loop 协议和数据读取层，而不是并行推理能力。

### 7.2 建议使用“逻辑子 agent”分层

在代码中拆成独立角色，但同一 run 内顺序执行：

- `Planner`：让模型决定下一步动作。
- `IndexReader`：执行索引层读取。
- `PaperReader`：执行正文层读取。
- `Synthesizer`：在 answer 或 max iteration 时生成最终回答。

这些不是独立进程，也不是并发任务；只是服务层边界。

### 7.3 后续可扩展并行读取

未来如果正文读取/解析变慢，可在 `PaperReader` 内部并行读取多个文件。首版不做。

## 8. 后端改造方案

### 8.1 新增文件

建议新增：

```text
backend/app/services/chat_agent.py
```

职责：

- Agent loop 主流程。
- 三层数据读取。
- LLM 决策 JSON prompt。
- run 取消检查。
- agent step event 生成。

### 8.2 保留现有文件职责

- `chat_modes.py` 保留 `wide` / `deep` 上下文构建。
- `chat_modes.py` 可保留 shared dataclass 或拆出到 `chat_types.py`。
- `provider_client.py` 继续负责 provider 请求和 stream。
- `routers/chat.py` 负责 HTTP 边界和 stream event 输出，不承载 loop 细节。

### 8.3 新增类型建议

```python
@dataclass
class AgentRunConfig:
    max_iterations: int = 6
    paper_top_k: int = 2

@dataclass
class AgentDecision:
    action: Literal["answer", "read_metadata", "read_index", "read_paper", "not_found"]
    reason: str
    doc_ids: list[str]
    answer: str = ""
    citations: dict[str, list[str]] = field(default_factory=dict)

@dataclass
class AgentRunState:
    run_id: str
    workspace_id: str
    question: str
    iteration: int
    metadata_items: list[dict]
    metadata_visible_this_iteration: bool
    loaded_index_doc_ids: set[str]
    loaded_paper_doc_ids: set[str]
    index_context_items: list[dict]
    paper_context_items: list[dict]
    trace: list[dict]
    source_map: dict[str, str]
```

### 8.4 三层读取函数

```python
load_metadata_layer(workspace_id) -> list[dict]
load_index_layer(doc_ids, workspace_id, source_map) -> list[ContextItem]
load_paper_layer(doc_ids, workspace_id, source_map, top_k) -> list[ContextItem]
```

### 8.5 Prompt 文件建议

新增：

```text
backend/prompts/chat_agent/planner_system_prompt.txt
backend/prompts/chat_agent/planner_user_prompt_template.txt
backend/prompts/chat_agent/final_system_prompt.txt
backend/prompts/chat_agent/final_user_prompt_template.txt
```

Planner prompt 要求：

- 只输出 JSON。
- 不输出 Markdown。
- system prompt 必须说明系统有元数据层、索引层、正文层，以及对应动作 `read_metadata`、`read_index`、`read_paper`。
- system prompt 必须说明全量元数据默认只在第 1 轮提供，后续如需重新筛选全库必须显式返回 `read_metadata`。
- user prompt 每轮必须标明本轮是否包含全量元数据。
- 必须遵守 `max_iterations`。
- 达到最后一轮必须 `answer` 或 `not_found`。
- 读取正文时必须按重要性排序 `doc_ids`，系统只会取 top_k。

Final prompt 要求：

- 输出中文回答。
- 正文中标注 `[I-xx]` / `[P-xx]`。
- 结尾输出引用行：
  - `引用索引：I-01, I-03`
  - `引用原文：P-01`

## 9. 取消机制方案

### 9.1 Run ID

前端发送 agent 请求时应携带 `run_id`。

如果前端不传，后端生成一个并在第一个 stream event 返回。

### 9.2 后端取消注册表

建议新增：

```python
CHAT_CANCEL_REGISTRY: dict[str, threading.Event]
```

接口：

```text
POST /api/chat/runs/{run_id}/cancel
```

### 9.3 检查点

以下位置必须检查取消：

- loop 每轮开始。
- planner provider 请求前。
- 每篇索引读取前。
- 每篇正文读取前。
- final provider 请求前。
- provider streaming 每个 chunk。

### 9.4 前端停止

`stopGeneration(workspaceId)` 应同时执行：

- `AbortController.abort()`。
- 调用后端 cancel endpoint。
- 将当前 trace 标记为 stopped。

## 10. Stream Event 设计

保留现有事件并扩展：

```ts
type ChatStreamEvent =
  | { type: "agent_run"; run_id: string; max_iterations: number; paper_top_k: number }
  | { type: "agent_step"; step: AgentTraceStep }
  | { type: "meta"; mode: ChatMode; sources: ChatSource[]; context_stats: ChatContextStats }
  | { type: "delta"; text: string }
  | { type: "done"; finish_reason?: string | null }
  | { type: "error"; message: string }
```

Trace step 示例：

```json
{
  "step": "read_index",
  "label": "读取索引",
  "detail": "3 篇索引",
  "iteration": 2,
  "status": "done",
  "sources": [
    {"source_id": "I-01", "doc_id": "doc_a", "display_name": "...", "title": "...", "authors": ["..."], "year": 2024}
  ]
}
```

## 11. 前端 UI 方案

### 11.1 Trace 位置

- Trace 放在当前 assistant 回复开头。
- 生成中展开。
- 正式回答开始后自动折叠。
- 历史回答可点击展开。

### 11.2 Trace 内容

只显示当前轮动作：

- 元数据筛选：文献数量。
- 重新读取元数据：文献数量。
- 读取索引：索引编号、标题、年份、作者。
- 读取正文：正文编号、标题、年份、作者。
- 达到最大轮数：显示 `已达 6/6，基于已读内容回答`。
- 用户中断：显示 `已停止`。

### 11.3 右侧 Sources

- 右侧继续显示最终引用来源，不展示过程 trace。
- 发送中不提前显示全量注入列表。

## 12. 上下文预算策略

用户要求优先保证稳定性和回答质量，因此预算策略不做过度收紧。

默认策略：

- 第 1 轮全量注入元数据层。
- 第 2 轮及之后不重复注入全量元数据，只保留必要的轻量映射。
- 模型显式返回 `read_metadata` 时，系统在下一轮重新注入一次全量元数据。
- 索引层不设 top-k 硬限制。
- 正文层单次设 `paper_top_k`，默认 2。
- 达到模型上下文硬阈值时，才进行压缩或要求模型回答。

保护策略：

- 最大循环次数 6。
- 正文单次 top_k。
- provider timeout。
- 用户取消。
- 若上下文接近硬上限，优先压缩已读正文，再压缩索引。

## 13. 测试计划

### 13.1 后端测试

- 第 1 轮元数据层默认包含工作区全部 indexed 文献。
- 第 2 轮及之后默认不重复注入全量元数据。
- planner 返回 `read_metadata` 后，下一轮会重新注入全量元数据。
- 第一轮 planner 可请求 `read_index`。
- 第二轮 planner 可请求 `read_paper`。
- 正文读取超过 `paper_top_k` 时只读取 top_k。
- 索引读取不受固定 top-k 限制。
- 达到第 6 轮后强制 answer/not_found。
- cancel 后停止后续读取和 provider 调用。
- 同一 doc 同时出现 `I-xx` 与 `P-xx`，编号稳定且不冲突。
- planner JSON 解析失败时有明确错误。

### 13.2 前端测试或构建验证

- `agent_run` 事件能保存 run_id。
- `agent_step` 实时更新当前 assistant message 的 trace。
- 点击停止会 abort 并调用后端 cancel。
- 回答开始后 trace 自动折叠。
- 引用行仍能映射到最终来源。

## 14. 分阶段实施建议

### 阶段 1：后端结构重构

- 新增 `chat_agent.py`。
- 抽出三层读取函数。
- 抽出 planner/final prompt。
- 保持现有前端事件基本兼容。

验证：后端单元测试通过。

### 阶段 2：Loop 协议落地

- 实现 6 轮循环。
- 实现 planner JSON 决策。
- 实现首轮元数据注入与按需 `read_metadata`。
- 实现索引不限制 top-k。
- 实现正文 `paper_top_k`。
- 实现最大轮强制回答。

验证：覆盖 read_index/read_paper/max_iterations。

### 阶段 3：取消机制

- 引入 run_id。
- 新增 cancel endpoint。
- provider 请求接入 `should_cancel`。
- 前端 stop 同时 abort + cancel。

验证：取消后不会继续读取或输出。

### 阶段 4：前端 Trace 打磨

- trace 挂到 assistant message。
- 回答开始自动折叠。
- 展示每轮读取的标题、年份、作者。

验证：构建通过，手动冒烟。

## 15. 风险与取舍

### 15.1 LLM 决策不稳定

缓解：使用严格 JSON schema prompt，解析失败时重试一次或直接错误退出。

### 15.2 元数据全量注入过大

缓解：全量元数据只在首轮或 `read_metadata` 后注入一次，不在每轮重复注入；若首轮仍实际超限，再做元数据压缩或分批 metadata。

### 15.3 正文层过大

缓解：单次 `paper_top_k`，且必要时正文层先走摘录压缩。

### 15.4 取消不彻底

缓解：provider 调用必须接入 `should_cancel`，不能只依赖前端 abort。

### 15.5 实现复杂度过高

缓解：首版只做顺序逻辑子 agent，不做并发子 agent。

## 16. 待确认问题

1. `paper_top_k` 默认是否采用 2？
2. 最大循环次数是否固定为 6，还是后续允许配置？
3. planner JSON 解析失败时，是重试一次，还是直接返回错误？
4. 达到第 6 轮时，是否允许模型返回 `not_found`，还是必须输出部分答案？
5. 正文层读取首版是否读取完整原文，还是先读取 query-aware 摘录？

## 17. 推荐确认后的第一步

确认方案后，先实施阶段 1 和阶段 2：

- 新增 `chat_agent.py`。
- 落地三层读取函数。
- 落地 planner JSON loop。
- 保持现有 trace UI 尽量少改。

原因：

- 这是行为核心。
- 不依赖大规模前端改动。
- 能最早暴露 prompt、JSON 协议和数据读取问题。
