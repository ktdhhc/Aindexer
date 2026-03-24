# V2 JS DOMAIN

## OVERVIEW
`backend/frontend/v2/assets/js/` 是 V2 前端逻辑层，按 `api/pages/shared/adapters` 分层。

## STRUCTURE
```text
backend/frontend/v2/assets/js/
|- pages/      # 页面入口逻辑
|- api/        # 后端接口封装
|- shared/     # 跨页面通用能力
`- adapters/   # 页面与 provider 配置适配层
```

## WHERE TO LOOK
| 场景 | 位置 | 说明 |
|---|---|---|
| 仪表台行为 | `backend/frontend/v2/assets/js/pages/dashboard.js` | V2 主页面交互与状态流 |
| Provider 配置页 | `backend/frontend/v2/assets/js/pages/provider-config.js` | 配置表单与联动逻辑 |
| API 调用入口 | `backend/frontend/v2/assets/js/api/index.js` | 聚合 API 导出 |
| HTTP 基础封装 | `backend/frontend/v2/assets/js/shared/http.js` | 请求与错误处理底座 |
| 页面壳层 | `backend/frontend/v2/assets/js/shared/app-shell.js` | 全局 UI 壳和共享流程 |
| Provider 适配 | `backend/frontend/v2/assets/js/adapters/providers-adapter.js` | 配置数据映射 |

## CONVENTIONS
- 优先从 `pages/` 入口定位，再追到 `api/` 与 `shared/`。
- API 路径封装在 `api/`，不要在页面文件散落 fetch 细节。
- 共享能力沉到 `shared/`，避免页面间复制代码。

## ANTI-PATTERNS (V2 JS)
- 不要把 CSS/HTML 细节写入 JS 域文档主体。
- 不要在页面层重复定义 API 地址和请求逻辑。
- 不要把与 `octto/` 子项目相关实现混入本域说明。

## NOTES
- 页面入口文件见 `backend/frontend/v2/index.html`、`backend/frontend/v2/provider-config.html`。
- 后端 API 边界见 `backend/app/routers/`；前端这里是消费层。
