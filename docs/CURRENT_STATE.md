# CURRENT_STATE

## 维护规则

- 防止过度膨胀规则：本文档一般保持在100-200行，最多不超过250行，在写入时先思考是否值得记录、是否可以和某行合并、以及某些内容是否应被删除。
- 应写什么：当前仍有效、且会直接影响开发判断的默认事实，如主链流程、关键入口、默认运行方式、默认验证方式、稳定状态名称与目录边界。
- 不应写什么：历史过程、讨论痕迹、废弃方案、一次性 workaround、局部实现细节、短期内高频变化的调试结论。
- 更新触发条件：仅当主流程、默认行为、关键入口文件、canonical 状态、默认验证方式发生稳定变化时更新。
- 更新方式：本文件只做覆盖式更新，不保留 changelog，不写“曾经如此”。
- 防漂移要求：优先保留新会话若不知道就容易做错的事实，其余信息宁可省略。

## 文档目的

- 本文件是当前仓库的精简事实快照。
- 新会话应优先阅读本文件，再读取与任务直接相关的代码和测试。
- 方案文档和历史材料属于补充参考，不是默认首读内容。

## 项目一句话说明

本项目是一个本地运行的文献索引与翻译工作台：后端使用 FastAPI，数据落在 SQLite 和本地文件中，前端当前以静态页面为默认入口，并已引入 React V3 骨架与 V3.5 Editorial Lab 设计基线用于逐步迁移。

## 当前阶段

- 已有一版可运行 demo。
- 当前主应用默认入口仍是 `backend/frontend/v2/` 和 `backend/frontend/translator/`。
- `frontend-v3/` 已建立 React + TypeScript + TanStack Router + TanStack Query + Zustand 基础骨架。
- `/v3` 路由已在后端预留 SPA 入口，后续按功能逐步迁移至统一前端。
- V3.5 前端设计方向已确定为 Editorial Lab：暖色纸张感、学术编辑台、阅读与修订优先，不再追求 V2 视觉复刻。
- 已新增 Workspace 数据边界：支持工作区新建、重命名、删除，并将上传/索引/搜索/聊天操作绑定到当前工作区。

## 范围边界

- 当前主应用是本地单机工具，不是云端多用户系统。
- 运行态目录如 `data/`、`dist/`、`build/`、`__pycache__/` 不作为源码架构依据。
- `octto/` 是独立子项目，不与主应用 backend/frontend 代码混写。

## 当前架构

```text
- 后端：FastAPI
- 前端：默认仍为静态前端（`backend/frontend/v2` + `backend/frontend/translator`），`frontend-v3/` 是 React 迁移代码入口，V3.5 设计基线位于 `docs/FRONTEND_DESIGN.md` 与 `demo/editorial-lab/`
- 持久化：SQLite + 本地文件（uploads / indexes / exports / logs）
- 任务执行方式：主应用索引通过进程内线程池异步执行，翻译通过独立 translation 路由域处理
- 关键外部依赖：LLM Provider、SQLite FTS5、pdf.js（翻译前端预览侧）
```

## 主流程关键事实

- 文献上传入口为 `POST /api/files/upload`。
- Workspace 入口为 `GET/POST/PUT/DELETE /api/workspaces`。
- 字段模板入口为 `GET/POST/PUT/DELETE /api/fields/templates`。
- 文献列表与状态依赖 `documents` 表以及 `status` / `stage` 字段。
- `documents` 已引入 `workspace_id` 字段，主链查询默认在 `ws_default` 工作区执行。
- `documents` 已引入 `field_template_id` 字段，索引任务可按模板执行。
- 索引任务入口为 `POST /api/index/{doc_id}/run` 与 `POST /api/index/run_all`。
- 索引过程的稳定状态包括：
  - `status`: `uploaded`, `parsing`, `indexed`, `needs_review`, `failed`, `cancelled`
  - `stage`: `uploaded`, `queued`, `parsing`, `llm_request`, `writing`, `completed`, `failed`, `cancel_requested`, `cancelled`
- 索引失败时会写入 fallback 模板，并把状态置为 `needs_review`，而不是简单失败后无内容。
- 生成结果同时落到 SQLite 与 `data/indexes/` 下的 Markdown 文件。

## 分支流程

- 翻译能力挂在 `/api/translation/*`，前端当前通过 `/translator` 静态页面提供。
- 翻译域保留自己的 repository / service / 测试集，但 Provider 配置与连通性测试复用主应用 `/api/providers`。
- 翻译执行默认复用通用 OpenAI-compatible `chat/completions` 调用链；Gemini 仅在显式使用其原生 `generativelanguage` Base URL 时走专用适配。

## 当前 UI 结构

- `/`：后端挂载的静态前端根入口。
- `/v2/`：当前新版工作台入口，覆盖控制台、Provider 配置页、字段配置页。
- `/translator/`：当前独立翻译工作区入口。
- `/v3/`：React V3 统一前端入口（需先构建 `frontend-v3` 产物），当前已包含 `workbench`、`config`、`chat`、`translator` 路由骨架。
- V3 Chat 已接入 `POST /api/chat/ask` 三模式与 `POST /api/chat/ask_stream` 流式输出：`wide` 全景、`deep` 精读、`agent` 探索；旧 `POST /api/chat/ask_v0` 保留兼容。
- Chat 三模式 prompt 已拆分到 `backend/prompts/chat_modes/`；请求会携带最近会话历史，索引类上下文使用稳定 `[I-xx]` 编号，原文类上下文使用稳定 `[P-xx]` 编号；`wide` 模式会返回实际纳入范围，`deep` 模式会累计已注入文献并注入原始文件文本（pdf/txt/docx 解析结果），而不是索引 Markdown；`agent` 模式已升级为受限探索循环：先检索候选，再读取索引，并在问题需要时补充读取原文摘录，流式返回步骤轨迹。
- V3 Chat 与 V3 翻译页的运行中请求状态已提升到 app 级 store；在 `/v3` 内切换路由时，请求不会因页面卸载而直接丢失，但文库页旧 Chat 仍是页面内状态。
- V3 翻译页当前不再要求最小选区字符数；翻译 provider 默认输出上限为 `8192` tokens。
- 当前 UI 仍未完成统一；后续迁移目标是以 V3.5 Editorial Lab 统一 `workbench`、配置、Chat 与翻译工作区。

## 当前前端整体现状

- `backend/frontend/v2/` 采用多页静态 HTML + 原生 JS 模式。
- `backend/frontend/v2/assets/js/pages/dashboard.js` 体量大，混合了渲染、状态、轮询、API 编排和界面逻辑，是前端主要可维护性热点之一。
- `backend/frontend/translator/` 是另一套独立静态前端实现，已具备上传 PDF、预览、搜索、划词翻译和 Provider 设置能力。
- `frontend-v3/` 已具备统一 shell、核心路由骨架和基础 API 访问能力，当前仍为迁移阶段实现，不是 V3.5 视觉基线。
- `demo/editorial-lab/` 是 V3.5 静态视觉示例；`demo/research-os/` 仅作为备选参考。
- `docs/FRONTEND_DESIGN.md` 已确定 V3.5 的稳定设计方向，但它描述的是未来稳定约束，不等于当前实现状态。

## 关键文件地图

- 后端装配入口：`backend/app/main.py`
- DB 初始化与迁移：`backend/app/db.py`
- 主仓储层：`backend/app/repository.py`
- 文件路由：`backend/app/routers/files.py`
- 索引路由与任务编排：`backend/app/routers/index.py`
- Provider 路由：`backend/app/routers/providers.py`
- 翻译 API 入口：`backend/app/translation/router.py`
- Provider / 模型注册表：`backend/app/provider_registry/provider_model_registry.json`
- 模型名注册表：`backend/app/provider_registry/model_name_registry.json`
- 注册表读取入口：`backend/app/provider_registry/registry.py`
- 主前端 V2 仪表盘：`backend/frontend/v2/assets/js/pages/dashboard.js`
- 翻译前端入口：`backend/frontend/translator/assets/js/app.js`
- V3 前端源码入口：`frontend-v3/src/main.tsx`
- V3 路由配置：`frontend-v3/src/app/router.tsx`
- V3 配置页：`frontend-v3/src/pages/ConfigPage.tsx`
- V3 Chat 页：`frontend-v3/src/pages/ChatPage.tsx`
- V3.5 静态设计示例：`demo/editorial-lab/index.html`
- V3.5 迁移方案：`docs/plans/frontend-v3-5-migration-plan.md`
- Workspace 路由：`backend/app/routers/workspaces.py`
- 字段模板路由：`backend/app/routers/fields.py`
- V3.5 稳定前端设计约束：`docs/FRONTEND_DESIGN.md`

## 重要运行事实

- `backend/app/main.py` 会挂载 `/api/*` 路由、`/api/translation/*` 路由、`/translator` 静态前端、`/v3` SPA 路由以及静态根前端。
- 当前开发启动基线是：在 `backend/` 下运行 `uvicorn app.main:app --reload`。
- V3 前端构建产物输出到 `backend/frontend/v3/`，由后端统一静态服务。
- 新增工作区默认值为 `ws_default`，未显式传递 `workspace_id` 时回落到该工作区。
- Provider 默认超时为 `120s`。
- API Key 当前按普通文本存储；不要基于“已加密存储”做实现判断。
- 主应用的索引执行是进程内线程池模型，不是独立 worker/queue 系统。

## 工作目录规则

```text
后端命令通常应在 backend/ 下执行
V3 前端命令通常应在 frontend-v3/ 下执行
根目录命令通常用于启动脚本、打包脚本和文档维护
当前默认前端仍位于 backend/frontend/；V3 源码位于 frontend-v3/，构建产物输出到 backend/frontend/v3/
```

## 启动方式

```text
首次后端依赖：在 backend/ 下运行 pip install -r requirements.txt
启动后端与当前静态前端：在 backend/ 下运行 uvicorn app.main:app --reload
默认访问：http://127.0.0.1:8000/
V2 入口：http://127.0.0.1:8000/v2/
翻译入口：http://127.0.0.1:8000/translator/

首次 V3 依赖：在 frontend-v3/ 下运行 npm install
V3 开发模式：先启动后端，再在 frontend-v3/ 下运行 npm run dev
V3 开发访问：http://127.0.0.1:5173/v3/workbench
V3 后端静态访问：在 frontend-v3/ 下运行 npm run build 后，通过 http://127.0.0.1:8000/v3/workbench 访问

V3.5 静态设计示例：直接用浏览器打开 demo/editorial-lab/index.html
```

## 默认验证方式

```text
- 后端优先跑有针对性的 pytest，而不是默认全量重跑
- 常用命令：
  - cd backend && pytest tests/test_api_smoke.py tests/test_security.py
  - cd backend && pytest tests/translation
  - cd frontend-v3 && npm run build
- 高成本检查：
  - 全量 pytest
  - 手动冒烟：Provider 配置 -> 上传 -> 运行索引 -> 预览/编辑 -> 搜索/导出 -> 翻译流程 -> /v3 路由骨架
```

## 当前可维护性热点

- `backend/app/routers/index.py` 同时承担路由、任务编排、进度逻辑和失败回退，是后端主要重构热点。
- `backend/app/repository.py` 较大，混合多个领域的持久化逻辑。
- `backend/frontend/v2/assets/js/pages/dashboard.js` 是当前前端单体脚本热点。
- `frontend-v3/src/pages/ConsolePage.tsx` 已形成新的页级巨石风险，V3.5 迁移应拆成 Library、Document Canvas、Indexing、Notes 等 feature。
- 当前前端分为 `v2`、`translator` 和迁移中的 `frontend-v3`，导航、交互语言和状态管理尚未统一。

## 后续会话约束

- 不要假设历史文档一定同步，应优先相信代码和本文件。
- 常规开发任务不要把旧任务记录或运行日志当成必读材料。
- 除非任务明确要求，不要擅自引入新的核心状态名称、payload 结构或术语。
- 如果任务只涉及一个功能区，只读取该功能区代码、附近测试和对应文档。
