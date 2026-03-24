# BACKEND DOMAIN

## OVERVIEW
`backend/` 是主应用工作区：包含 FastAPI 应用、静态前端、提示词、测试与运行态数据边界。

## STRUCTURE
```text
backend/
|- app/           # FastAPI 核心应用（入口、路由、服务、仓储、DB）
|- frontend/      # 被后端挂载的静态前端（含 v2）
|- prompts/       # LLM 提示词模板
|- tests/         # pytest 回归
|- data/          # 运行态数据边界（不要当源码域）
|- desktop_main.py / launcher_hidden.py  # 桌面和隐藏启动入口
`- requirements.txt
```

## WHERE TO LOOK
| 任务 | 位置 | 说明 |
|---|---|---|
| 后端应用入口 | `backend/app/main.py` | 创建 FastAPI、挂载路由与静态前端 |
| 桌面打包入口 | `backend/desktop_main.py` | onedir 构建后执行入口 |
| API 行为 | `backend/app/routers/` | 按功能分文件 |
| 业务逻辑 | `backend/app/services/` | provider/抽取/导出等 |
| 提示词调整 | `backend/prompts/` | 系统/用户模板 |
| 测试基线 | `backend/tests/` | `test_api_smoke.py`, `test_security.py` |

## CONVENTIONS
- 开发命令默认在 `backend/` 下执行。
- API 与业务逻辑分层：`routers/` 处理接口边界，`services/` 处理业务实现。
- 静态前端由后端统一挂载，不走独立前端 dev server。

## ANTI-PATTERNS (BACKEND)
- 不要把 `backend/data/` 作为架构依据；它是运行态输入输出。
- 不要在 `backend/AGENTS.md` 展开到具体 router/service 文件细节（交给子文档）。
- 不要将缓存目录（`.venv/`, `.pytest_cache/`, `__pycache__/`）当作可维护代码域。

## COMMANDS
```bash
cd backend
uvicorn app.main:app --reload

cd backend
pytest
```

## NOTES
- `backend/app/main.py` 会挂载 `backend/frontend/`。
- 打包链路与 `scripts/build_windows_onedir.py` 联动，不在 backend 内单独完成。
