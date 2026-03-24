# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-23
**Commit:** 1879cd0
**Branch:** chat_with_llm

## OVERVIEW
本仓库是本地文献索引系统（FastAPI + 静态前端 + SQLite/FTS5），并包含打包脚本、项目文档和一个独立 `octto/` 子项目。

## STRUCTURE
```text
literature-indexer/
|- backend/                # 主应用（API、前端静态资源、测试、提示词）
|- scripts/                # 打包/检查/测试辅助脚本
|- PROJECT_docs/           # 主项目文档与约束
|- task_docs/ docs/ tutorial/ # 任务和说明文档
|- octto/                  # 独立 TypeScript 子项目（本波次不展开）
|- data/ build/ dist/ .omocache/ # 运行态/构建产物/缓存（排除域）
`- start_*.bat / package_*.bat   # Windows 启动与打包入口
```

## WHERE TO LOOK
| 任务 | 位置 | 说明 |
|---|---|---|
| 后端入口 | `backend/app/main.py` | FastAPI 创建、路由挂载、静态前端挂载 |
| API 行为 | `backend/app/routers/` | 按功能拆分接口边界 |
| 业务逻辑 | `backend/app/services/` | 抽取、provider 调用、导出、prompt 读取 |
| 前端 V2 逻辑 | `backend/frontend/v2/assets/js/` | `api/pages/shared/adapters` 四层 |
| 运行与打包 | `scripts/`, `package_windows_onedir.bat` | 分发和 smoke test 相关脚本 |
| 项目说明 | `PROJECT_docs/README.md` | 架构、命令、接口速览 |

## CONVENTIONS
- 主流程以 Python/FastAPI 为核心，命令基线围绕 `uvicorn`、`pytest`、PyInstaller。
- 入口脚本以 Windows `.bat` 为主，优先从根目录启动脚本进入系统。
- 文档语言以中文为主，术语紧贴仓库文件路径。

## ANTI-PATTERNS (THIS PROJECT)
- 不要把 `data/`, `build/`, `dist/`, `.omocache/`, `.venv/`, `.pytest_cache/`, `__pycache__/` 当作源码知识域。
- 不要在根文档展开子目录细节（如 routers/services 文件级说明）。
- 不要把 `octto/` 与主应用 backend 域混写；它是独立子项目。

## UNIQUE STYLES
- 路径优先：说明尽量落到具体目录/文件，而不是抽象原则。
- 层级拆分：根文档只管总览，子文档负责域内细节。

## COMMANDS
```bash
# 开发（backend）
cd backend
uvicorn app.main:app --reload

# 测试
cd backend
pytest

# Windows 打包
package_windows_onedir.bat
python scripts/build_windows_onedir.py
```

## NOTES
- `start_literature_indexer_v2.bat` 会转调 debug 启动脚本并打开 `/v2/`。
- `backend/data/` 属于运行态数据边界，不作为代码结构设计依据。
