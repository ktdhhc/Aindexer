# APP CORE DOMAIN

## OVERVIEW
`backend/app/` 是后端核心域：应用入口、DB 初始化、仓储、路由聚合、服务实现都在这里。V3.5 的稳定 API、聊天数据流和文档顺序号等核心事实也在本域落地。

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
| 数据结构与存储 | `backend/app/db.py`, `backend/app/repository.py` | 初始化、迁移、读写路径、`seq_num` 等稳定字段 |
| API 入口映射 | `backend/app/routers/` | 路由按功能拆分 |
| 业务实现 | `backend/app/services/` | Chat/翻译/provider/导出等实现 |
| 安全相关 | `backend/app/security.py` | 校验和输入防护 |

## CONVENTIONS
- 入口层（`routers/`）和实现层（`services/`）明确分离。
- `main.py` 只做应用组装，不塞业务细节。
- 对外行为优先从 router 找，再下钻到 service。
- 对 V3.5 正式前端已消费的 API / payload / 状态名，默认优先兼容，而不是随手改形状。

## ANTI-PATTERNS (APP)
- 不要在 `main.py` 堆业务逻辑。
- 不要跨层直接在 router 里复制 service 逻辑。
- 不要把 `backend/data/` 当成 app 结构的一部分。
- 不要在桌面端适配过程中顺手改动核心后端行为，除非运行时或兼容性确有硬需求。

## COMMANDS
```bash
cd backend
uvicorn app.main:app --reload

cd backend
pytest tests/test_api_smoke.py tests/test_security.py
```

## NOTES
- 当前静态前端目录是 `backend/frontend/`，由 `main.py` 统一挂载；正式前端源码位于 `frontend-v3/`。
- V4 桌面端使用 `backend/desktop_v4_sidecar.py` 启动本地 FastAPI，并可通过 `AINDEXER_DATA_DIR` 切换桌面运行数据目录。
- `documents` 现有稳定字段包括 `workspace_id`、`field_template_id`、`seq_num`；`seq_num` 会影响聊天来源编号的稳定性。
- V4 桌面端过程中优先在桌面壳、bridge、打包层解决问题；如果确需改动本域，应补充针对性测试并验证 V3.5 核心功能不受影响。
- 子目录细节请看 `backend/app/routers/AGENTS.md` 和 `backend/app/services/AGENTS.md`。
