# Aindexer

本项目是一个本地运行的文献索引、翻译与问答工作台。

当前正式入口只保留 **V4 Editorial Lab**，后端使用 FastAPI，前端使用 React + TypeScript，数据存储在本地 SQLite 和文件系统中，适合单机、本地、以人工阅读和修订为主的学术资料工作流。

## 当前状态

- 当前唯一正式前端入口：`/v3/workbench`
- 当前唯一正式前端代码入口：`frontend-v3/`
- 当前唯一正式静态构建输出：`backend/frontend/v3/`
- V4 桌面端壳层入口：`desktop-v4/`
- 当前公开仓库只保留运行主应用所需的 `backend/`、`frontend-v3/` 与本 README
- `backend/frontend/v2/`、`backend/frontend/translator/` 仍位于 `backend/` 内作为历史遗留实现保留，但不是当前正式入口

## 项目定位

- 本地桌面式文献工作台，不是云端多用户系统
- 以文献上传、结构化索引、检索预览、人工修订、翻译校对和问答探索为主链
- UI 方向为 **Editorial Lab**：暖色纸张感、阅读优先、编辑优先、低噪声工具界面

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
- V4 sidecar：`backend/desktop_v4_sidecar.py`
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
- V4 桌面端可通过 `AINDEXER_DATA_DIR` 将数据目录切到用户 AppData 下

## 公开仓库结构

```text
literature-indexer/
|- README.md
|- frontend-v3/                # 当前唯一正式前端源码入口
|- desktop-v4/                 # V4 Tauri 桌面壳层
|- backend/
|  |- app/                     # FastAPI、路由、服务、仓储、DB
|  |- frontend/
|  |  |- v3/                   # V3.5 构建产物，由后端静态服务
|  |  |- v2/                   # 历史遗留，已弃用
|  |  `- translator/           # 历史遗留，已弃用
|  |- prompts/                 # 问答与抽取提示词
|  |- tests/                   # 后端与翻译测试
|  |- desktop_main.py          # 历史桌面启动入口
|  `- desktop_v4_sidecar.py    # V4 桌面 sidecar 入口
```

运行时目录如 `data/` 由程序在本地自动创建，不作为公开源码目录。

## 运行说明

- 仓库中已包含当前 `backend/frontend/v3/` 构建产物，因此直接启动后端即可访问正式入口
- 如果你修改了 `frontend-v3/` 源码，需要重新执行 `npm run build`，以刷新 `backend/frontend/v3/` 下的静态产物

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

直接启动后访问正式入口：

```bash
cd backend
uvicorn app.main:app --reload
```

访问：`http://127.0.0.1:8000/v3/workbench`

如果你修改了前端源码，再重新构建：

```bash
cd frontend-v3
npm run build
```

前端开发模式：

```bash
cd frontend-v3
npm run dev
```

访问：`http://127.0.0.1:5173/v3/workbench`

说明：前端开发服务器会将 `/api` 代理到 `http://127.0.0.1:8000`，因此开发模式下后端仍需先启动。

### 5. V4 桌面壳开发模式

```bash
cd desktop-v4
npm install
npm run dev
```

桌面壳会启动 `backend/desktop_v4_sidecar.py`，选择动态端口，并加载 `/v3/workbench`。修改 `frontend-v3/` 后，仍需先重新运行 `npm run build` 以刷新 `backend/frontend/v3/`。

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

## 设计与实现判断

从代码结构看，这个项目当前已经形成比较清晰的 V3.5 主体能力：

- 前端已经统一到单一 React Shell，导航、Workspace 选择和主要能力页都在 `frontend-v3` 中汇合
- 后端 API 已按文献、索引、问答、翻译、配置、工作区、用量拆分为独立路由域
- 文献索引、PDF 翻译和多模式问答共享同一套 Provider 配置与本地数据边界
- Workspace 已经成为主数据边界，而不是附加功能

同时也能看到迁移痕迹仍然存在：

- `backend/app/main.py` 仍会挂载历史静态目录
- `backend/` 中仍保留 `v2`、旧 translator 前端和相关测试，作为历史遗留参考

因此，当前最合适的仓库认知是：

- **产品入口已经收敛到 V4**
- **代码仓库仍保留历史遗留实现作为迁移参考**

## 注意事项

- 本项目默认用于本地可信环境，不应按云端多租户系统理解
- Provider API Key 当前保存在本地数据中，现状不是加密托管方案
- 翻译上传接口当前只接受 `PDF`
- 问答与翻译都依赖可用的 Provider 配置；首次使用前应先完成配置页设置

## 公开边界

- 本公开仓库不包含本地运行数据、历史打包产物、辅助脚本、设计推演文档和个人配置痕迹
- 若你需要打包脚本、设计基线文档或其它内部材料，应在本地私有工作区自行维护
