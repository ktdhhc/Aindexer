# Chat Three Modes Plan

## 1. 文档目标

- 为 `frontend-v3` 的 Chat 页三模式改造建立统一方案。
- 明确三种模式的产品定位、交互约束、后端能力边界与实施顺序。
- 在正式开发前先识别 token、稳定性、交互流畅性和执行失控等主要风险。

## 2. 当前现状

### 2.1 前端现状

- `frontend-v3/src/pages/ChatPage.tsx` 已迁移到 V3.5 纸张感界面。
- 当前前端已具备：
  - 本地 session 列表
  - Provider / Model 选择
  - 会话消息展示
  - 发送、停止、复制、重试
- 当前 session 仅是前端组织层，不影响后端上下文构造逻辑。

### 2.2 后端现状

- 当前 Chat 接口为 `POST /api/chat/ask_v0`。
- Provider / Model registry 已具备按模型名解析能力，并可返回 `context_window_tokens` 等模型能力字段。
- 入参仅包含：
  - `question`
  - `provider`
  - `model`
  - `workspace_id`
- `backend/app/services/chat_v0.py` 当前只会：
  - 选择当前 workspace 下第一篇 `indexed` 文献
  - 读取对应 markdown / index
  - 将这一个上下文注入 prompt
- 当前不支持：
  - 多文献注入
  - 用户显式选择文献
  - workspace 全量索引聚合
  - agent 式多步检索 / 读取 / 推理循环
- 当前尚未把模型上下文窗口信息接入 Chat 的上下文预算判断。

## 3. 决策摘要

- Chat 页改造为三种模式是合理的，三者职责边界清晰，符合不同问答任务。
- 三模式必须在“上下文来源策略”上真实不同，不能只做 UI 切换。
- 模式只允许在会话开始前选择；首轮发送后锁定，避免同一 session 内上下文语义漂移。
- 推荐实施顺序：
  1. 深度分析模式
  2. 全面检索模式
  3. 自主模式
- 推荐先抽离统一的 Chat 上下文服务层，再逐个接模式，避免在 router 或单个 service 中堆分支。

## 4. 模式定义

### 4.1 全面检索模式

目标：

- 对当前 workspace 内的多篇已索引文献做横向筛选、聚合与比较。
- 适合问题：
  - “有哪些文献讨论了 X？”
  - “帮我筛出使用某方法的研究”
  - “按主题/年份/方法给出候选文献”

设计原则：

- 不建议第一版直接把“所有索引全文无上限拼接注入”。
- 第一版应显式依赖当前模型的 `context_window_tokens` 做预估，而不是用固定字符数拍脑袋截断。
- 建议把当前 workspace 下“总索引”视为所有候选文献索引文本的聚合体，先做 token 估算，再决定注入方式。
- 第一版的判定规则建议为：
  - 若 `总索引估算 tokens <= 模型上下文窗口 * 0.45`，则允许完整注入总索引。
  - 若超过该阈值，则不做“部分全文拼接”，直接回退为“全 workspace 结构化信息包”。
  - 若结构化信息包仍偏大，则先做 query 粗排，再进入统一压缩机制。
- 这样做的目的不是追求“尽量塞满”，而是让“全面检索”在用户语义上保持可解释：要么确实看了总索引，要么明确退化为结构化全景摘要。

建议注入内容优先级：

1. `display_name / filename`
2. `title / authors / year`
3. `keywords / one_liner`
4. `core_points`
5. 关键 `custom_fields`
6. 索引全文 / markdown（仅当命中“完整注入总索引”阈值时）

### 4.2 深度分析模式

目标：

- 让用户显式指定一篇或多篇文献，围绕这些材料进行高可信度深读与比较。
- 适合问题：
  - “比较这两篇文献的实验设计差异”
  - “基于这三篇文献写研究综述段落”
  - “分析这篇文献的局限与潜在偏差”

交互要求：

- 在输入框中输入 `@` 时呼出候选列表。
- 根据输入实时过滤文献名、显示名、标题或索引关键词。
- 点击候选后插入为引用 chip，而不是只把 doc_id 拼进纯文本。
- 支持多篇注入。
- 会话开始后可继续新增/移除引用，但模式本身不变。

上下文策略：

- 后端仅加载被选择的 `doc_ids`。
- 注入顺序应稳定、可解释。
- 返回值中应显式包含本轮使用的 sources。

### 4.3 自主模式

目标：

- 允许系统根据问题自行决定读取哪些索引或文件。
- 适合问题：
  - “帮我找与这个研究方向最相关的材料并总结”
  - “你自己判断应当先看哪些文献再回答”

本质：

- 这不是单轮 prompt 注入，而是带工具调用能力的受限 agent loop。

至少应支持的动作：

1. 搜索候选文献
2. 读取指定索引
3. 在需要时读取原文件或衍生内容
4. 汇总并输出答案

前端要求：

- 实时显示“当前读取了什么”。
- 用户可中断。
- 输出中保留最终引用来源。

## 5. 交互与会话规则

### 5.1 模式选择规则

- 新建 session 时必须先选择模式。
- 空 session 可切换模式。
- 第一条用户消息发出后，当前 session 的模式锁定。
- 锁定后不能直接切换到另一个模式；如需切换，必须新建 session。

### 5.2 Session 数据建议

每个 session 至少持有以下字段：

```ts
type ChatMode = "wide" | "deep" | "agent"

interface ChatSession {
  id: string
  title: string
  workspaceId: string
  mode: ChatMode
  locked: boolean
  selectedDocIds: string[]
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}
```

其中：

- `wide` 模式下 `selectedDocIds` 可为空。
- `deep` 模式下 `selectedDocIds` 是主要上下文来源。
- `agent` 模式下 `selectedDocIds` 可表示用户显式固定的候选范围，也可以为空。

### 5.3 UI 反馈要求

- 模式标签必须一直可见。
- 当前回合实际使用了哪些来源，必须在答案旁可见。
- 自主模式在读取阶段必须有过程反馈，而不是只显示“正在思考”。

### 5.4 三模式统一的上下文预算与压缩规则

统一前提：

- 三模式都不能直接把“准备注入的上下文”原样丢给模型；必须先经过一次预算预检。
- 预算预检只按模型名解析上下文窗口，不按 provider 决定预算。
- 若模型名无法命中 registry，则用保守默认窗口，例如 `32000`，避免误判为可注入超长上下文。

建议预算分层：

- `context_window_tokens`：来自模型名 registry 的上下文窗口。
- `output_reserve`：预留给模型输出，建议取 `max(4000, context_window_tokens * 0.15)`。
- `system_reserve`：预留给 system prompt、模式说明、工具说明等固定包络，建议取 `max(2000, context_window_tokens * 0.05)`。
- `usable_context_budget = context_window_tokens - output_reserve - system_reserve`。

建议阈值：

- 手动压缩提示阈值：`usable_context_budget * 0.70`
- 自动压缩触发阈值：`usable_context_budget * 0.85`
- 硬上限保护阈值：`usable_context_budget * 0.95`

统一处理流程：

1. 先估算本轮总输入 token：system prompt + 模式说明 + 用户问题 + 候选上下文。
2. 若低于手动压缩提示阈值，则直接使用原始上下文。
3. 若超过手动压缩提示阈值，则在 UI 中提示用户建议缩小范围、减少引用、改写问题或主动压缩上下文。
4. 若超过自动压缩触发阈值，则在发送前自动执行压缩，不再依赖用户手动处理。
5. 若自动压缩后仍接近硬上限，则不继续静默截断，而是触发模式级兜底策略并在返回值中标记。

统一压缩梯度：

1. 删除低优先级字段与冗余元信息。
2. 压缩长列表：`core_points`、长 `custom_fields`、长引用列表先缩成短摘要。
3. 做 query-aware 压缩：优先保留与当前问题更相关的段落、字段与文献。
4. 若仍超预算，则退化为更抽象的结构化摘要包，而不是继续堆原文碎片。

模式级兜底：

- `wide`：从“总索引完整注入”退回到“结构化全景摘要”。
- `deep`：保留用户显式指定文献，但把每篇内容压缩为问题相关摘要，并明确标记已压缩。
- `agent`：减少单轮可读取材料量，把中间读取结果先总结后再进入下一步。

## 6. 推荐实施顺序

### 阶段 1：抽离统一上下文层

目标：

- 把当前 `chat_v0` 的“选文献 + 读索引 + 组 prompt”逻辑从单一流程改造成可复用上下文服务。

建议新增能力：

- `load_index_context(doc_id)`
- `load_multiple_index_context(doc_ids)`
- `load_workspace_index_summaries(workspace_id)`
- `search_index_candidates(workspace_id, query)`
- `resolve_model_context_window(model_name)`
- `estimate_context_tokens(payload, model_name)`
- `compress_context_to_budget(items, budget, strategy)`
- `truncate_context_by_budget(items, budget)`

阶段验证：

- 单文献读取行为与现状兼容。
- 多文献拼接可用。
- 模型窗口命中与保守回退可预测。
- budget 预检与压缩结果可预测。

### 阶段 2：深度分析模式

原因：

- 用户显式指定上下文，最稳定。
- 产品收益明显。
- 能直接验证多文献注入链路。

前端任务：

- 新建 session 时可选模式。
- `@` 触发候选列表。
- 多文献 chip。
- 发送时带 `mode=deep` 与 `doc_ids`。

后端任务：

- 新增正式接口，例如 `POST /api/chat/ask`。
- 读取所选文献索引并构造 prompt。
- 返回 `sources`。

### 阶段 3：全面检索模式

原因：

- 价值高，但预算与性能风险明显。

第一版建议：

- 先估算 workspace 总索引 token。
- 仅当 `总索引估算 <= 上下文窗口 * 0.45` 时，完整注入总索引。
- 超过该阈值时，直接退回“workspace 全部文献的结构化摘要包”。
- 若结构化摘要包仍偏大，则：
  - 先按 query 做粗排
  - 再走统一自动压缩链路

不建议：

- 第一版直接无条件拼接所有 markdown 全文。
- 第一版在超出全量注入阈值后继续做“部分全文 + 部分摘要”的混合黑盒策略。

### 阶段 4：自主模式

原因：

- 复杂度最高，必须建立在前两阶段的稳定读取能力之上。

后端任务：

- 设计 agent loop
- 定义允许的 tool 集合
- 限制最大步数、总超时和总 token
- 记录每步动作与读取结果摘要

前端任务：

- 实时显示工具调用过程
- 可中断
- 可查看最终使用来源

## 7. 后端接口建议

建议不要继续扩张 `/api/chat/ask_v0`，而是新增更正式的接口，例如：

```text
POST /api/chat/ask
```

候选入参：

```json
{
  "question": "...",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "workspace_id": "ws_default",
  "mode": "deep",
  "doc_ids": ["doc_1", "doc_2"],
  "session_id": "chat_xxx"
}
```

候选返回：

```json
{
  "answer": "...",
  "sources": [
    {"doc_id": "doc_1", "display_name": "..."},
    {"doc_id": "doc_2", "display_name": "..."}
  ],
  "mode": "deep",
  "context_stats": {
    "doc_count": 2,
    "model_context_window": 128000,
    "estimated_input_tokens": 18200,
    "compression_level": "none",
    "structured_fallback": false,
    "truncated": false
  }
}
```

其中 `compression_level` 建议至少有：

- `none`
- `advisory`
- `auto`
- `fallback`

对于自主模式，建议单独设计流式或事件式接口，而不是强行塞进同步返回：

- `POST /api/chat/agent/start`
- `GET /api/chat/agent/{run_id}`
- 或 SSE / WebSocket

## 8. 风险点

### 8.1 Token / 上下文爆炸

风险最高，主要来自全面检索模式与自主模式。

表现：

- 请求超上下文
- 响应慢
- 费用高
- 有效内容被截断
- 输出不稳定

缓解：

- 统一 context budget 层
- 统一按模型名解析 `context_window_tokens`
- 全面检索模式先判断能否完整注入总索引，不能则直接回退结构化全景摘要
- 三模式共用手动提示阈值与自动压缩阈值
- 对外显式返回 `doc_count / estimated_input_tokens / compression_level / truncated`

### 8.2 前端交互卡顿

主要来自 `@` 检索与大 session 列表。

缓解：

- 前端本地先做即时过滤
- 后端检索做 debounce
- 候选只显示 `indexed` 文献

### 8.3 自主模式执行失控

表现：

- 循环读取
- 读取错误文献
- 单次耗时过长
- 用户无法理解系统在做什么

缓解：

- 限制最大步数
- 限制可读资源类型
- 记录每步动作
- 支持取消

### 8.4 会话语义漂移

如果 session 内可随意切换模式，会导致上下文含义不稳定。

缓解：

- 首问后锁定模式
- 切模式必须新建 session

### 8.5 UI 命名误导

如果 UI 写“全面检索”，但后端实际只纳入 top K 文献，用户会误解系统真的看了全部。

缓解：

- 显示真实纳入范围
- 显示是否截断
- 避免夸大措辞

## 9. 稳定性优先建议

如果目标是“先得到流畅、可控、稳定的产品体验”，推荐优先级如下：

1. 先做统一上下文服务层
2. 先做深度分析模式
3. 再做全面检索模式
4. 自主模式最后做

原因：

- 深度分析模式上下文最可控，用户预期最明确。
- 全面检索模式的主要难点是 budget，不是 UI。
- 自主模式的主要难点是执行控制，不是 prompt。

## 10. 建议的最小可实施版本

### V1

- 前端支持模式选择与 session 锁定
- 后端新增正式 `ask` 接口
- 实现深度分析模式：
  - `@` 选择文献
  - 多文献注入
  - 返回 sources

### V2

- 实现全面检索模式
- 先用“总索引完整注入 or 结构化全景摘要”二选一策略
- 接入统一预算预检与自动压缩
- 返回 context stats

### V3

- 实现自主模式
- 增加读取过程可视化
- 增加最大步数 / 取消 / 超时

## 11. 验证建议

### 前端验证

```text
cd frontend-v3
npm run build
```

### 后端针对性验证

建议新增覆盖：

- 深度分析模式多文献读取测试
- 全面检索模式的总索引全量注入阈值测试
- 三模式统一压缩阈值测试
- 模型窗口缺失时的保守回退测试
- 自主模式最大步数与取消测试

### 手动冒烟

```text
1. 新建 session -> 选择深度分析模式 -> @ 选择 2 篇文献 -> 发送问题
2. 新建 session -> 选择全面检索模式 -> 发送筛选类问题 -> 检查来源数量与截断提示
3. 新建 session -> 选择自主模式 -> 观察读取日志 -> 中途取消
```

## 12. 结论

- 三模式方向合理，产品价值明确。
- 不建议一次性同时做深；应从“统一上下文层 + 深度分析模式”开始。
- 全面检索模式的核心不是“把所有索引都塞进去”，而是“先判断能否完整注入总索引，否则明确退回结构化全景视图”。
- 三模式都应共享一套上下文预算与压缩机制，避免每个模式各自实现一套不可解释的截断逻辑。
- 自主模式本质是 agent 系统，应最后做，并把过程可视化与执行控制作为首要要求。
