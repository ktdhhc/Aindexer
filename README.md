# Aindexer — 你的本地文献智慧工作台 📚✨

**Aindexer** 是一款运行在你电脑上的文献阅读与写作助手。上传 PDF、DOCX 或 TXT 文件，让它帮你自动提取关键信息、建立全文索引；随后你可以快速搜索、随手修订，甚至向你的文献库直接提问——一切都在本地完成，数据完全由你掌控。

> 🖥️ 当前正式版本为 **V4 桌面端**，提供沉浸式的 Editorial Lab 体验。也支持通过浏览器访问 Web 版。

---

## ✨ 它能做什么

| 能力 | 说明 |
|---|---|
| 📤 **文献上传** | 支持 PDF / DOCX / TXT 格式，拖拽或选择文件即可导入 |
| 🤖 **智能索引** | 自动提取标题、作者、关键词、APA 引用、核心观点等结构化信息 |
| 🔍 **全文检索** | 基于 SQLite FTS5，秒级搜索索引内容，快速定位你需要的文献 |
| ✏️ **人工修订** | 索引结果以 Markdown 呈现，支持在线预览、编辑和导出 |
| 💬 **多模式问答** | 提供全景浏览、深度精读、Agent 探索三种问答模式，向文献库提问 |
| 🌐 **PDF 翻译** | 在线预览 PDF 原文，选段翻译，支持流式输出和历史记录 |
| 🗂️ **工作区隔离** | 按项目/课题创建多个 Workspace，文献、索引、对话彼此独立 |
| 📊 **用量统计** | 按 Provider、模型、功能维度统计 token 消耗和成本 |
| 💾 **数据备份** | 一键导出全量备份包，随时恢复你的工作数据 |

---

## 🏗️ 四个核心模块

### 📖 Workbench — 文库工作台
你的文献中心。上传、浏览、搜索、索引、修订、导出，围绕文献的一切操作都在这里汇聚。支持自定义字段模板，索引任务可单篇运行也可批量执行，失败会自动回退到可编辑状态，不会丢失数据。

### 🌍 Translator — 翻译工作台
打开 PDF，选中段落，即时翻译。支持原文/译文双栏对照、流式翻译输出、翻译历史回溯。布局可自由缩放和调整，适合细读与校对。

### 💬 Chat — 智能问答
选一个 Workspace，挑几篇文献，然后直接提问。
- **Wide 模式**：全景概览，快速了解文献库全貌
- **Deep 模式**：深度精读，聚焦特定文献的细节
- **Agent 模式**：自主探索，让 AI 在文献间自由穿梭寻找答案

每次回答都会标注引用来源，思维链过程可见，回答可追溯。

### ⚙️ Config — 系统配置
管理你的 LLM Provider、API Key、默认模型、字段模板和工作区。用量统计和计费规则也在这里统一查看。

---

## 🚀 快速开始

### 方式一：桌面端（推荐）

V4 桌面端提供最完整的体验，一次启动即可使用所有功能。

**前置要求：** Node.js ≥ 18、Python ≥ 3.10、Rust 工具链

```bash
# 1. 安装后端依赖
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt   # Windows
# source .venv/bin/python -m pip install -r requirements.txt  # macOS / Linux

# 2. 安装前端依赖
cd frontend-v3
npm install

# 3. 安装桌面壳依赖
cd desktop-v4
npm install

# 4. 一键启动开发模式 🎉
npm run dev
```

桌面窗口会自动打开，前端改动能实时热更新。

### 方式二：浏览器访问

如果你只需要 Web 版，启动后端后直接访问即可。

```bash
cd backend
uvicorn app.main:app --reload
```

浏览器打开 `http://127.0.0.1:8000/v3/workbench`

> 💡 仓库中已包含预构建的前端产物，不需要额外构建。如果你修改了前端源码，在 `frontend-v3/` 下运行 `npm run build` 即可刷新。

---

## 🛠️ 开发者指南

### 项目结构一览

```
literature-indexer/
├── backend/           # FastAPI 后端：路由、服务、数据库、测试
│   ├── app/           # 应用核心代码
│   ├── frontend/v3/   # 前端构建产物（由后端静态服务）
│   ├── prompts/       # LLM 提示词
│   └── tests/         # 后端测试
├── frontend-v3/       # 前端源码（React + TypeScript + Vite）
├── desktop-v4/        # V4 Tauri 桌面壳层
└── data/              # 运行时数据（SQLite 数据库、上传文件、索引、日志）
```

### 常用命令

| 场景 | 命令 | 说明 |
|---|---|---|
| 🔧 启动后端 | `cd backend && uvicorn app.main:app --reload` | 开发模式，文件改动自动重载 |
| 🎨 前端开发 | `cd frontend-v3 && npm run dev` | Vite 热更新，需后端已启动 |
| 🖥️ 桌面开发 | `cd desktop-v4 && npm run dev` | 一键启动后端 + 前端 + 桌面壳 |
| 📦 前端构建 | `cd frontend-v3 && npm run build` | 生产构建，输出到 `backend/frontend/v3/` |
| 📦 桌面打包 | `cd desktop-v4 && npm run build` | 构建完整安装包 |
| ✅ 后端测试 | `cd backend && pytest tests/<test_file>.py` | 推荐按模块针对性测试 |

### 后端测试分组

```bash
# 基础接口
cd backend && pytest tests/test_api_smoke.py tests/test_security.py

# 工作区与字段模板
cd backend && pytest tests/test_workspace_api.py tests/test_field_templates.py

# 问答模块
cd backend && pytest tests/test_chat_modes.py tests/test_chat_agent.py

# 翻译模块
cd backend && pytest tests/translation
```

### 环境变量

| 变量 | 用途 |
|---|---|
| `AINDEXER_DATA_DIR` | 自定义数据目录 |
| `AINDEXER_PYTHON` | 指定 Python 解释器路径 |

---

## 📐 技术栈

- **后端：** FastAPI + SQLite + SQLite FTS5
- **前端：** React 18 + TypeScript + Vite + TanStack Router + TanStack Query + Zustand
- **桌面壳：** Tauri 2 + Rust
- **文档解析：** PyMuPDF + pdfplumber + python-docx

---

## ⚠️ 注意事项

- 本项目为**本地单机工具**，不是云端多用户系统
- API Key 以明文存储在本地数据库，请确保运行环境可信
- 首次使用前请先在 **Config 页面** 配置 Provider 和 API Key
- 翻译功能当前仅支持 PDF 格式

---

## 📄 许可证

本项目仅供个人学习与研究使用。
