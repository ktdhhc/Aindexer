# Aindexer - Agent Quickstart

本文用于让新 Agent 在 3-5 分钟内快速理解当前项目状态并安全改动。

## 1) 项目目标（当前）

- 本地部署文献索引系统（FastAPI + 单页前端）。
- 支持上传 `pdf/txt/docx`，调用 LLM 抽取结构化索引，落盘 SQLite + Markdown。
- 面向新手用户，强调可视化状态、可中断、可导入导出、可手工修订。

## 2) 技术栈与目录

- 后端: FastAPI (`backend/app`)
- 前端: 单文件页面 (`backend/frontend/index.html`)
- 数据: SQLite + FTS5 (`data/app.db`)
- Prompt: 集中在 `backend/prompts/`
  - `index_system_prompt.txt`
  - `index_user_prompt_template.txt`
  - `json_schema_hint.txt`
  - `provider_test_system_prompt.txt`
  - `provider_test_user_prompt.txt`

## 3) 快速运行

### 方式 A（推荐给普通用户）

- 双击根目录 `start_literature_indexer.bat`

### 方式 B（开发模式）

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

访问: `http://127.0.0.1:8000`

## 4) 当前核心功能

- 上传区支持文件选择和拖拽上传。
- Provider 配置支持多接口、多模型、自定义模型、连通测试、恢复默认。
- 索引执行支持单条/批量、流式进度、任务中断与清理提示。
- 搜索区支持排序、批量导出/删除，点击条目可直接预览。
- 预览区支持手工编辑 Markdown 并保存（`PUT/POST /api/index/{doc_id}/markdown`）。
- 备份恢复支持全量导出与全量恢复（恢复前自动快照）。

## 5) 关键行为与约束（非常重要）

- 索引输出语言约束:
  - `title/authors/keywords` 可沿用原文语言。
  - 其余描述性字段要求中文。
- API Key 当前按普通文本存储（不再走混淆/加解密链路）。
- Provider 默认超时为 `120s`。
- LLM 请求采用流式读取，读取阶段不设硬超时截断（避免模型持续输出时被客户端截断）。

## 6) 关键代码入口

- 应用入口与路由: `backend/app/main.py`
- DB 初始化/迁移: `backend/app/db.py`
- 仓储层: `backend/app/repository.py`
- 文件管理: `backend/app/routers/files.py`
- 索引任务与流式进度: `backend/app/routers/index.py`
- Provider 配置: `backend/app/routers/providers.py`
- 备份导出恢复: `backend/app/routers/export.py`
- 系统退出: `backend/app/routers/system.py`
- LLM 调用: `backend/app/services/provider_client.py`
- 抽取归一化: `backend/app/services/extractor.py`
- Prompt 读取: `backend/app/services/prompt_store.py`

## 7) API 速览（当前常用）

- Files
  - `POST /api/files/upload`
  - `GET /api/files`
  - `DELETE /api/files/{doc_id}`
- Index
  - `POST /api/index/{doc_id}/run`
  - `GET /api/index/{doc_id}/run_stream` (SSE)
  - `POST /api/index/run_all`
  - `POST /api/index/{doc_id}/cancel`
  - `POST /api/index/{doc_id}/reset`
  - `GET /api/index/{doc_id}`
  - `GET /api/index/{doc_id}/markdown`
  - `PUT /api/index/{doc_id}/markdown`
  - `POST /api/index/{doc_id}/markdown` (PUT 兼容)
  - `PUT /api/index/{doc_id}`
- Providers
  - `GET /api/providers`
  - `GET /api/providers/{provider}/api_key`
  - `PUT /api/providers/{provider}`
  - `POST /api/providers/{provider}/test`
  - `DELETE /api/providers/{provider}`
  - `POST /api/providers/reset_defaults`
- Backup / System
  - `GET /api/export/backup/all`
  - `POST /api/export/backup/restore`
  - `POST /api/system/exit`

## 8) 状态机（documents.status / stage）

- status: `uploaded`, `parsing`, `indexed`, `needs_review`, `failed`, `cancelled`
- stage: `uploaded`, `queued`, `parsing`, `llm_request`, `writing`, `completed`, `failed`, `cancel_requested`, `cancelled`

说明:
- `needs_review` 表示主抽取失败后写入了 fallback 模板，需人工修订。
- 中断后可能出现 `cleanup_pending`，需要等待清理完成再重跑。

## 9) 改动注意事项（给新 Agent）

- 若改动抽取字段，务必同步:
  - `schemas.py`
  - `repository.py`
  - `markdown_export.py`
  - 前端预览/搜索渲染
- 若改动 Prompt，优先编辑 `backend/prompts/*`，避免硬编码回 Python。
- 若改动流式逻辑，先确保取消感知与异常重试逻辑仍成立。

## 10) 最小验证

```bash
cd backend
pytest
```

手动冒烟:
- 配置 provider -> 测试连接 -> 上传/拖拽文件 -> 运行索引 -> 点击搜索条目预览 -> 手工编辑并保存 -> 搜索/导出。

## 11) 对外分发脚本（方案1 onedir）

- 一键打包脚本: `package_windows_onedir.bat`
- 实际逻辑: `scripts/build_windows_onedir.py`
- 打包入口: `backend/desktop_main.py`
- 产物目录: `dist/Aindexer/`
- 分发压缩包命名: `dist/Aindexer-windows-onedir-YYYYMMDD_HHMMSS.zip`
