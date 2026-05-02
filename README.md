# Aindexer

本项目是一个本地运行的文献索引、翻译与问答工作台。

当前正式入口只保留 **V3.5 Editorial Lab**，后端使用 FastAPI，前端使用 React + TypeScript，数据存储在本地 SQLite 和文件系统中，适合单机、本地、以人工阅读和修订为主的学术资料工作流。

## 当前状态

- 当前唯一正式前端入口：`/v3/workbench`
- 当前唯一正式前端代码入口：`frontend-v3/`
- 当前唯一正式静态构建输出：`backend/frontend/v3/`
- 仓库中仍保留 `backend/frontend/v2/`、`backend/frontend/translator/`、部分旧测试与历史脚本，但它们已经弃用，不再作为当前产品入口或 README 支持范围
- 部分历史文档仍保留迁移期描述；涉及入口和现状时，以代码和本 README 为准

## 项目定位

- 本地桌面式文献工作台，不是云端多用户系统
- 以文献上传、结构化索引、检索预览、人工修订、翻译校对和问答探索为主链
- UI 设计基线为 `docs/FRONTEND_DESIGN.md` 中定义的 **Editorial Lab**：暖色纸张感、阅读优先、编辑优先、低噪声工具界面

## 核心能力

- 文献上传：支持 `pdf`、`txt`、`docx`
- 工作区隔离：所有文献、索引、问答、翻译、用量统计都按 `workspace` 归属
- 字段模板：可维护默认字段与自定义模板，索引任务可按模板运行
- 异步索引：后端通过进程内线程池执行索引任务，支持单篇运行、批量运行、进度轮询与取消
- 失败回退：索引失败时不会只留空状态，而会生成 fallback 模板并将文献标记为 `needs_review`
- 全文检索：基于 SQLite FTS5 检索标题、关键词、APA、核心观点、claims 等索引内容
- Markdown 工作流：索引结果会同时写入 SQLite 与 `data/indexes/` 下的 Markdown 文件，支持预览、编辑、导出
- PDF 翻译：支持 PDF 原文预览、选段翻译、流式输出、取消请求、历史记录查看
- 多模式问答：支持 `wide` 全景、`deep` 精读、`agent` 探索三种问答模式
- Provider 管理：支持 Provider 配置、模型解析、连接测试、默认模型设置
- 用量统计：支持按 Provider、模型、功能、API Key 指纹统计 token 与成本
- 数据备份：支持导出全量备份包并恢复本地工作数据

## 现有页面

- `Workbench`：文献列表、搜索、上传、索引运行、Markdown 预览与导出
- `Translator`：PDF 文库、阅读画布、译文侧栏、历史记录、流式翻译与取消
- `Chat`：多会话问答、文献范围选择、上下文来源展示、Agent 流式轨迹
- `Config`：Provider、默认模型、字段模板、工作区、用量与计费规则配置

## 技术架构

### 后端

- 框架：FastAPI
- 应用入口：`backend/app/main.py`
- 启动封装：`backend/desktop_main.py`
- 路由层：`backend/app/routers/`
- 翻译域：`backend/app/translation/`
- 持久化：`backend/app/db.py` + `backend/app/repository.py`

### 前端

- 正式前端源码：`frontend-v3/`
- 技术栈：React 18、TypeScript、Vite、TanStack Router、TanStack Query、Zustand
- 路由基路径：`/v3`
- Vite 构建输出：`backend/frontend/v3/`

### 数据与运行时

- 主数据库：`data/app.db`
- 上传文件：`data/uploads/`
- 索引 Markdown：`data/indexes/`
- 导出与备份：`data/exports/`
- 运行日志：`data/logs/`

## 仓库结构

```text
literature-indexer/
|- README.md
|- docs/
|  |- CURRENT_STATE.md
|  |- FRONTEND_DESIGN.md
|  `- plans/
|- frontend-v3/                # 当前唯一正式前端源码入口
|- backend/
|  |- app/                     # FastAPI、路由、服务、仓储、DB
|  |- frontend/
|  |  |- v3/                   # V3.5 构建产物，由后端静态服务
|  |  |- v2/                   # 历史遗留，已弃用
|  |  `- translator/           # 历史遗留，已弃用
|  |- prompts/                 # 问答与抽取提示词
|  |- tests/                   # 后端与翻译测试
|  `- desktop_main.py          # 打包后桌面启动入口
|- scripts/                    # 打包、辅助脚本
|- data/                       # 本地运行数据
|- demo/                       # 设计演示与视觉基线
`- octto/                      # 独立子项目
```

## 关键后端接口

- `/api/files/*`：文献上传、列表、删除、原文访问
- `/api/index/*`：索引运行、批量运行、取消、Markdown 读写、编辑保存
- `/api/search`：索引检索
- `/api/export/*`：单篇导出、批量导出、全量备份、备份恢复
- `/api/providers/*`：Provider 配置、模型解析、连通性测试
- `/api/fields/*`：字段模板与字段定义
- `/api/workspaces/*`：工作区 CRUD
- `/api/chat/*`：问答、流式问答、Agent run 取消
- `/api/translation/*`：PDF 上传、页面文本、翻译、流式翻译、翻译历史、取消
- `/api/usage/*`：用量统计、价格规则

## 典型工作流

1. 在配置页填写 Provider、模型与 API Key。
2. 创建或切换 Workspace。
3. 上传文献文件到当前 Workspace。
4. 选择字段模板并运行索引。
5. 在文库页搜索、预览、修订、导出 Markdown。
6. 在翻译页选择 PDF，读取原文并执行流式翻译。
7. 在问答页以 `wide`、`deep` 或 `agent` 模式对已索引文献提问。

## 本地启动

### 1. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 2. 安装前端依赖

```bash
cd frontend-v3
npm install
```

### 3. 启动后端

```bash
cd backend
uvicorn app.main:app --reload
```

### 4. 启动方式

构建后通过后端访问正式入口：

```bash
cd frontend-v3
npm run build
```

访问：`http://127.0.0.1:8000/v3/workbench`

前端开发模式：

```bash
cd frontend-v3
npm run dev
```

访问：`http://127.0.0.1:5173/v3/workbench`

说明：前端开发服务器会将 `/api` 代理到 `http://127.0.0.1:8000`，因此开发模式下后端仍需先启动。

## 验证命令

推荐优先运行有针对性的验证，而不是默认全量重跑。

后端基础接口：

```bash
cd backend
pytest tests/test_api_smoke.py tests/test_security.py tests/test_workspace_api.py tests/test_field_templates.py
```

问答相关：

```bash
cd backend
pytest tests/test_chat_modes.py tests/test_chat_agent.py
```

翻译相关：

```bash
cd backend
pytest tests/translation
```

前端构建校验：

```bash
cd frontend-v3
npm run build
```

## Windows 打包

项目提供本地桌面式分发脚本，本质上是将后端和静态前端打包为本地启动程序，再通过浏览器访问本机服务。

```bash
python scripts/build_windows_onedir.py
```

输出目录通常位于：`dist/Aindexer/`

打包脚本会：

- 调用 PyInstaller 生成 `Aindexer.exe`
- 打入 `backend/frontend/` 静态资源与 `backend/prompts/`
- 生成 `start.bat` 与 `start_debug.bat`
- 对 `http://127.0.0.1:8000/api/providers` 做基础 smoke test

## 设计与实现判断

从代码结构看，这个项目当前已经形成比较清晰的 V3.5 主体能力：

- 前端已经统一到单一 React Shell，导航、Workspace 选择和主要能力页都在 `frontend-v3` 中汇合
- 后端 API 已按文献、索引、问答、翻译、配置、工作区、用量拆分为独立路由域
- 文献索引、PDF 翻译和多模式问答共享同一套 Provider 配置与本地数据边界
- Workspace 已经成为主数据边界，而不是附加功能

同时也能看到迁移痕迹仍然存在：

- `backend/app/main.py` 仍会挂载历史静态目录
- 仓库中仍有 `v2`、旧 translator 前端、相关 UI 测试和迁移期脚本
- `docs/CURRENT_STATE.md` 仍保留部分多入口时期描述

因此，当前最合适的仓库认知是：

- **产品入口已经收敛到 V3.5**
- **代码仓库仍保留历史遗留实现作为迁移参考**

## 注意事项

- 本项目默认用于本地可信环境，不应按云端多租户系统理解
- Provider API Key 当前保存在本地数据中，现状不是加密托管方案
- 翻译上传接口当前只接受 `PDF`
- 问答与翻译都依赖可用的 Provider 配置；首次使用前应先完成配置页设置

## 相关文档

- 当前设计约束：`docs/FRONTEND_DESIGN.md`
- 前端迁移方案：`docs/plans/frontend-v3-5-migration-plan.md`
- 当前事实快照：`docs/CURRENT_STATE.md`
