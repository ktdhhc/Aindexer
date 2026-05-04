# ROUTERS DOMAIN

## OVERVIEW
`backend/app/routers/` 定义所有 HTTP 接口边界。先在这里定位接口，再追到 `services/`。

## WHERE TO LOOK
| 需求 | 文件 | 说明 |
|---|---|---|
| 索引执行与流式进度 | `backend/app/routers/index.py` | run/run_all/run_stream/cancel/reset 等 |
| 文件上传与列表 | `backend/app/routers/files.py` | 上传、列举、删除 |
| Provider 配置与测试 | `backend/app/routers/providers.py` | 配置读取、更新、连通性测试 |
| 搜索查询 | `backend/app/routers/search.py` | 字段+关键词检索 |
| 聊天能力与流式取消 | `backend/app/routers/chat.py` | `ask` / `ask_stream` / `runs/{run_id}/cancel` / `ask_v0` |
| 导出与恢复 | `backend/app/routers/export.py` | 备份导出/恢复 |
| 系统接口 | `backend/app/routers/system.py` | 退出、教程读取 |
| 字段配置 | `backend/app/routers/fields.py` | 字段列表与管理 |

## CONVENTIONS
- 路由文件负责入参/出参和 HTTP 语义，不承载核心业务算法。
- 同一业务域集中在单个 router 文件，避免碎片 endpoint。
- 复杂逻辑下沉到 `backend/app/services/`。
- V3.5 已消费的接口路径、字段名和流式事件类型默认优先保持稳定。

## ANTI-PATTERNS (ROUTERS)
- 不要在 router 里复制 service 逻辑。
- 不要跨多个 router 维护同一业务状态。
- 不要在接口层依赖 `backend/data/` 的运行态细节。
- 不要为了桌面端适配随手改动公共 API 载荷结构。

## NOTES
- `chat.py` 同时服务独立 Chat 页和文库右侧问答；改动前先确认两类前端消费方是否都兼容。
- Chat 来源编号已改为服务端生成；不要重新引入客户端 `source_map` 依赖。
- 总挂载入口见 `backend/app/main.py`。
- 业务实现说明见 `backend/app/services/AGENTS.md`。
