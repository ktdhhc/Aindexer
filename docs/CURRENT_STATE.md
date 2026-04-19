# CURRENT_STATE

## 维护规则

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

本项目是一个本地运行的文献索引与翻译工作台：后端使用 FastAPI，数据落在 SQLite 和本地文件中，前端当前由静态页面提供，V3 正在进入 React 重构前的文档沉淀阶段。

## 当前阶段

- 已有一版可运行 demo。
- 当前主应用仍由 `backend/frontend/v2/` 和 `backend/frontend/translator/` 提供前端。
- 当前正在收敛文档体系，并为统一 React V3 前端做方案与边界梳理。

## 范围边界

- 当前主应用是本地单机工具，不是云端多用户系统。
- 运行态目录如 `data/`、`dist/`、`build/`、`__pycache__/` 不作为源码架构依据。
- `octto/` 是独立子项目，不与主应用 backend/frontend 代码混写。

## 当前架构

```text
- 后端：FastAPI
- 前端：当前为静态前端（`backend/frontend/v2` + `backend/frontend/translator`），V3 方案已确定但尚未成为默认实现
- 持久化：SQLite + 本地文件（uploads / indexes / exports / logs）
- 任务执行方式：主应用索引通过进程内线程池异步执行，翻译通过独立 translation 路由域处理
- 关键外部依赖：LLM Provider、SQLite FTS5、pdf.js（翻译前端预览侧）
```

## 主流程关键事实

- 文献上传入口为 `POST /api/files/upload`。
- 文献列表与状态依赖 `documents` 表以及 `status` / `stage` 字段。
- 索引任务入口为 `POST /api/index/{doc_id}/run` 与 `POST /api/index/run_all`。
- 索引过程的稳定状态包括：
  - `status`: `uploaded`, `parsing`, `indexed`, `needs_review`, `failed`, `cancelled`
  - `stage`: `uploaded`, `queued`, `parsing`, `llm_request`, `writing`, `completed`, `failed`, `cancel_requested`, `cancelled`
- 索引失败时会写入 fallback 模板，并把状态置为 `needs_review`，而不是简单失败后无内容。
- 生成结果同时落到 SQLite 与 `data/indexes/` 下的 Markdown 文件。

## 分支流程

- 翻译能力挂在 `/api/translation/*`，前端当前通过 `/translator` 静态页面提供。
- 翻译域拥有自己的 repository / service / provider 适配层和测试集。
- 当前 Provider 配置在主应用与翻译域之间存在共享存储事实，前后端都不能假设它们完全隔离。

## 当前 UI 结构

- `/`：后端挂载的静态前端根入口。
- `/v2/`：当前新版工作台入口，覆盖控制台、Provider 配置页、字段配置页。
- `/translator/`：当前独立翻译工作区入口。
- 当前 UI 尚未统一成一个应用壳；V3 的目标是统一控制台、配置页与翻译页。

## 当前前端整体现状

- `backend/frontend/v2/` 采用多页静态 HTML + 原生 JS 模式。
- `backend/frontend/v2/assets/js/pages/dashboard.js` 体量大，混合了渲染、状态、轮询、API 编排和界面逻辑，是前端主要可维护性热点之一。
- `backend/frontend/translator/` 是另一套独立静态前端实现，已具备上传 PDF、预览、搜索、划词翻译和 Provider 设置能力。
- `docs/FRONTEND_DESIGN.md` 已确定 V3 的稳定设计方向，但它描述的是未来稳定约束，不等于当前实现状态。

## 关键文件地图

- 后端装配入口：`backend/app/main.py`
- DB 初始化与迁移：`backend/app/db.py`
- 主仓储层：`backend/app/repository.py`
- 文件路由：`backend/app/routers/files.py`
- 索引路由与任务编排：`backend/app/routers/index.py`
- Provider 路由：`backend/app/routers/providers.py`
- 翻译 API 入口：`backend/app/translation/router.py`
- 主前端 V2 仪表盘：`backend/frontend/v2/assets/js/pages/dashboard.js`
- 翻译前端入口：`backend/frontend/translator/assets/js/app.js`
- 稳定前端设计约束：`docs/FRONTEND_DESIGN.md`

## 重要运行事实

- `backend/app/main.py` 会挂载 `/api/*` 路由、`/api/translation/*` 路由、`/translator` 静态前端以及静态根前端。
- 当前开发启动基线是：在 `backend/` 下运行 `uvicorn app.main:app --reload`。
- Provider 默认超时为 `120s`。
- API Key 当前按普通文本存储；不要基于“已加密存储”做实现判断。
- 主应用的索引执行是进程内线程池模型，不是独立 worker/queue 系统。

## 工作目录规则

```text
后端命令通常应在 backend/ 下执行
根目录命令通常用于启动脚本、打包脚本和文档维护
当前前端源码事实仍位于 backend/frontend/；V3 前端目录尚未成为正式代码入口
```

## 默认验证方式

```text
- 后端优先跑有针对性的 pytest，而不是默认全量重跑
- 常用命令：
  - cd backend && pytest tests/test_api_smoke.py tests/test_security.py
  - cd backend && pytest tests/translation
- 高成本检查：
  - 全量 pytest
  - 手动冒烟：Provider 配置 -> 上传 -> 运行索引 -> 预览/编辑 -> 搜索/导出 -> 翻译流程
```

## 当前可维护性热点

- `backend/app/routers/index.py` 同时承担路由、任务编排、进度逻辑和失败回退，是后端主要重构热点。
- `backend/app/repository.py` 较大，混合多个领域的持久化逻辑。
- `backend/frontend/v2/assets/js/pages/dashboard.js` 是当前前端单体脚本热点。
- 当前前端分为 `v2` 与 `translator` 两套实现，导航、交互语言和状态管理尚未统一。

## 后续会话约束

- 不要假设历史文档一定同步，应优先相信代码和本文件。
- 常规开发任务不要把旧任务记录或运行日志当成必读材料。
- 除非任务明确要求，不要擅自引入新的核心状态名称、payload 结构或术语。
- 如果任务只涉及一个功能区，只读取该功能区代码、附近测试和对应文档。
- 在用户确认文档体系前，不实施新的代码改动。
