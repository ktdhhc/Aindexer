# APP CORE DOMAIN

## OVERVIEW
`backend/app/` 是后端核心域：应用入口、DB 初始化、仓储、路由聚合、服务实现都在这里。

## STRUCTURE
```text
backend/app/
|- main.py         # create_app + 路由挂载 + 静态前端挂载
|- db.py           # SQLite 初始化/迁移
|- repository.py   # 持久化访问层
|- schemas.py      # 数据模型
|- config.py       # 配置常量与目录
|- routers/        # API 边界层
`- services/       # 业务实现层
```

## WHERE TO LOOK
| 场景 | 位置 | 说明 |
|---|---|---|
| 应用启动/挂载 | `backend/app/main.py` | `create_app()` 与 middleware/router 组装 |
| 数据结构与存储 | `backend/app/db.py`, `backend/app/repository.py` | 初始化与读写路径 |
| API 入口映射 | `backend/app/routers/` | 路由按功能拆分 |
| 业务实现 | `backend/app/services/` | 抽取、provider、导出等 |
| 安全相关 | `backend/app/security.py` | 校验和输入防护 |

## CONVENTIONS
- 入口层（`routers/`）和实现层（`services/`）明确分离。
- `main.py` 只做应用组装，不塞业务细节。
- 对外行为优先从 router 找，再下钻到 service。

## ANTI-PATTERNS (APP)
- 不要在 `main.py` 堆业务逻辑。
- 不要跨层直接在 router 里复制 service 逻辑。
- 不要把 `backend/data/` 当成 app 结构的一部分。

## COMMANDS
```bash
cd backend
uvicorn app.main:app --reload

cd backend
pytest tests/test_api_smoke.py tests/test_security.py
```

## NOTES
- 当前静态前端目录是 `backend/frontend/`，由 `main.py` 统一挂载。
- 子目录细节请看 `backend/app/routers/AGENTS.md` 和 `backend/app/services/AGENTS.md`。
