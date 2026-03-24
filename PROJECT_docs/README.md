
# Aindexer（文献索引维护系统）

本项目是一个本地部署的文献索引工具（FastAPI + 单页前端），支持上传 `pdf/txt/docx`，调用大模型抽取结构化索引，落盘 SQLite（含 FTS5 搜索）与 Markdown，并提供可视化状态、可中断、可导入导出与手工修订能力。

---

## 功能概览

- 上传：支持文件选择与拖拽上传（`pdf/txt/docx`）
- Provider 配置：
  - 支持多接口、多模型、以及自定义模型列表
  - 支持连通性测试、恢复默认配置
  - Provider 默认超时为 `120s`
- 索引执行：
  - 支持单条/批量/全量运行
  - 支持流式进度（SSE）
  - 支持任务中断与清理提示（避免中断后“脏状态”直接重跑）
- 搜索与管理：
  - 支持字段+关键词搜索（SQLite FTS5）
  - 支持排序、批量导出/删除
- 预览与编辑：
  - 点击条目可预览生成的 Markdown
  - 支持手工编辑并保存（后端提供 PUT/POST 双通道兼容）
- 备份与恢复：
  - 支持全量导出（DB + uploads + indexes + logs）
  - 支持全量覆盖式恢复，恢复前自动生成“恢复前快照”兜底
- 分发打包：
  - 提供一键打包脚本生成可分享压缩包（默认排除本地数据与虚拟环境）

---

## 快速开始

### 方式 A（推荐）

双击根目录脚本之一：

- `start_literature_indexer_classic.bat`：启动经典版，打开 `http://127.0.0.1:8000/`
- `start_literature_indexer_v2.bat`：启动新版工作台，打开 `http://127.0.0.1:8000/v2/`（若 8000 端口被占用，将自动调用清理工具）

兼容说明：

- `start_literature_indexer.bat` 仍保留，但现在默认转到经典版启动脚本
- 页面内已移除经典版 / 新版互跳按钮，入口改由启动脚本分流

### 方式 B（开发模式）

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
````

---

## 使用流程

1. 通过对应启动脚本进入经典版或新版
2. 在页面内进入 Provider 配置，填写 `base_url / model / api_key / timeout`，点击“测试连接”
3. 上传文件（支持拖拽）
4. 点击“生成索引”（单条或批量/全量）
5. 在列表“动态信息”查看状态与阶段进度
6. 生成后可预览 Markdown，并可手工编辑保存；或导出/批量导出

---

## 状态与阶段（用于排查问题）

### documents.status

* `uploaded`：已上传
* `parsing`：解析中
* `indexed`：索引完成
* `needs_review`：主抽取失败，已写入 fallback 模板，需人工修订
* `failed`：失败
* `cancelled`：已取消

### documents.stage（更细粒度进度）

* `uploaded`, `queued`, `parsing`, `llm_request`, `writing`, `completed`
* `failed`
* `cancel_requested`, `cancelled`

说明：

* 中断后可能出现清理过程（前端可能提示清理中），建议等待清理完成再重跑。

---

## 数据与目录结构

* 数据库：`data/app.db`
* 原文上传：`data/uploads/`
* 生成索引：`data/indexes/`
* 导出文件：`data/exports/`
* 应用日志：`data/logs/app.log`

核心代码入口：

* 后端入口与路由：`backend/app/main.py`
* DB 初始化/迁移：`backend/app/db.py`
* 仓储层：`backend/app/repository.py`
* 文件管理：`backend/app/routers/files.py`
* 索引任务与流式进度：`backend/app/routers/index.py`
* Provider 配置：`backend/app/routers/providers.py`
* 备份导出恢复：`backend/app/routers/export.py`
* 系统退出：`backend/app/routers/system.py`
* LLM 调用：`backend/app/services/provider_client.py`
* 抽取归一化：`backend/app/services/extractor.py`
* Prompt 读取：`backend/app/services/prompt_store.py`

Prompt 目录：

* `backend/prompts/`

  * `index_system_prompt.txt`
  * `index_user_prompt_template.txt`
  * `json_schema_hint.txt`
  * `provider_test_system_prompt.txt`
  * `provider_test_user_prompt.txt`

---

## API 速览（常用）

Files

* `POST /api/files/upload`
* `GET /api/files`
* `DELETE /api/files/{doc_id}`

Index

* `POST /api/index/{doc_id}/run`
* `GET /api/index/{doc_id}/run_stream`（SSE）
* `POST /api/index/run_all`
* `POST /api/index/{doc_id}/cancel`
* `POST /api/index/{doc_id}/reset`
* `GET /api/index/{doc_id}`
* `GET /api/index/{doc_id}/markdown`
* `PUT /api/index/{doc_id}/markdown`
* `POST /api/index/{doc_id}/markdown`（PUT 兼容）

Providers

* `GET /api/providers`
* `GET /api/providers/{provider}/api_key`
* `PUT /api/providers/{provider}`
* `POST /api/providers/{provider}/test`
* `DELETE /api/providers/{provider}`
* `POST /api/providers/reset_defaults`

Backup / System

* `GET /api/export/backup/all`
* `POST /api/export/backup/restore`
* `POST /api/system/exit`

---

## 维护与约束（重要）

* 索引输出语言约束：

  * `title / authors / keywords` 可沿用原文语言
  * 其余描述性字段要求中文
* API Key 当前按普通文本存储（不再走混淆/加解密链路）。
* Provider 默认超时为 `120s`
* LLM 请求采用流式读取：连接/写入有超时，读取阶段不设硬超时截断（避免模型持续输出时被客户端截断）

---

## 备份恢复与分发打包

### 全量备份/恢复

* 全量导出：`GET /api/export/backup/all`
* 全量恢复：`POST /api/export/backup/restore`（覆盖式恢复；恢复前会自动生成“恢复前快照”）

### 一键分发打包（方案1 onedir）

* `package_windows_onedir.bat`（入口）
* `scripts/build_windows_onedir.py`（实现）
* `backend/desktop_main.py`（打包入口）
* 输出目录：`dist/`（包含 `Aindexer/` 与 `Aindexer-windows-onedir-*.zip`）

分发压缩包内包含：`Aindexer.exe`、`start.bat`（默认快速启动，隐藏后端窗口）、`start_debug.bat`（可见调试启动）、`README_首次使用.txt`，以及运行所需的 `frontend`、`backend/prompts`、`TUTORIAL.md`（位于 `_internal/`）。

---

## 常见问题

### 一直 parsing / 运行很慢

常见原因：模型响应慢或网络波动。可把 `timeout` 调到 `120~180s`，或切换更快模型，先用小文档验证链路。

### 偶发失败 / needs_review

常见原因：供应商高峰、网络波动、输入过长。系统会尽量重试与降级；`needs_review` 表示已写入 fallback 模板，可在预览区手工修订并保存。

### 端口占用处理

如果启动时提示端口 `8000` 被占用，可以使用以下工具手动清理。该工具会扫描 Windows 系统中占用 `8000` 端口的进程，并根据指令将其终止，确保后端服务能正常启动。

```bash
# 查看并交互式清理
python scripts/free_port_8000.py

# 强制清理（无需确认）
python scripts/free_port_8000.py --yes
```

---

## 最小验证（开发者）

```bash
cd backend
pytest
```

手动冒烟建议：

* 配置 provider -> 测试连接 -> 上传/拖拽 -> 运行索引 -> 预览 -> 手工编辑保存 -> 搜索/导出 -> 备份/恢复

```
```
