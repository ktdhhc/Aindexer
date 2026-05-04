# FRONTEND V3.5 DOMAIN

## OVERVIEW
`frontend-v3/` 是当前正式前端源码工作区。这里承载 V3.5 Editorial Lab 的壳层、Workbench、Config、Chat 和 Translator 页面，以及对应的 store、API client 与样式系统。

## STRUCTURE
```text
frontend-v3/
|- src/
|  |- app/              # AppShell、router、workspace/chat/translator/workbench store
|  |- pages/            # Workbench / Config / Chat / Translator 页面入口
|  |- features/         # 页面级功能块（workbench、translator 等）
|  |- shared/
|  |  |- api/           # 统一 API client
|  |  |- lib/           # 本地偏好与 provider model 辅助
|  |  `- styles/        # `v35.css` 等共享样式
|  `- styles.css        # 历史全局样式，当前仍与 `v35.css` 同时加载
`- package.json
```

## WHERE TO LOOK
| 场景 | 位置 | 说明 |
|---|---|---|
| 壳层与路由 | `frontend-v3/src/app/AppShell.tsx`, `frontend-v3/src/app/router.tsx` | 正式 `/v3/*` 壳层与路由结构 |
| 文库工作台 | `frontend-v3/src/pages/WorkbenchPage.tsx`, `frontend-v3/src/features/workbench/*` | Banner、Library、Canvas、右侧问答 |
| 配置页 | `frontend-v3/src/pages/ConfigPage.tsx` | `providers/defaults/fields/workspaces` 四分区 |
| 独立 Chat 页 | `frontend-v3/src/pages/ChatPage.tsx`, `frontend-v3/src/app/chatStore.ts` | 会话、thinking blocks、trace、sources |
| 文库右侧问答 | `frontend-v3/src/app/workbenchChatStore.ts`, `frontend-v3/src/features/workbench/NotesPanel.tsx` | 按 `workspace + doc_id` 的单会话问答 |
| 翻译工作台 | `frontend-v3/src/pages/TranslatorPage.tsx`, `frontend-v3/src/app/translatorStore.ts`, `frontend-v3/src/features/translator/PdfViewer.tsx` | PDF 预览、选区翻译、history、resizer |
| 正式样式真相源 | `frontend-v3/src/shared/styles/v35.css` | V3.5 的布局、视觉与交互样式 |
| 历史全局样式 | `frontend-v3/src/styles.css` | 当前仍加载，改动前需确认是否会污染 `v35.css` |

## CONVENTIONS
- 正式前端默认遵循 `v35-*` 类名、`v35.css` 视觉语言和 Editorial Lab 信息架构。
- 网络请求统一走 `frontend-v3/src/shared/api/*`，不要在页面文件里重新拼 fetch 细节。
- 服务端状态优先交给 TanStack Query；长会话、运行中状态与局部交互状态优先放到对应 Zustand store。
- 独立 Chat 页默认使用 `chatStore`；文库右侧问答默认使用 `workbenchChatStore`，不要混用。

## ANTI-PATTERNS (FRONTEND-V3)
- 不要把新需求默认落到 legacy V2 路径。
- 不要绕过 store 或 API client 在页面层复制聊天、翻译或 provider 数据流。
- 不要在没有截图或交互验证的情况下大改 `v35.css` 关键布局关系。
- 不要重新把页面做回页级巨石或重新引入“全局变量 + DOM 协议”模式。

## COMMANDS
```bash
cd frontend-v3
npm install

cd frontend-v3
npm run dev

cd frontend-v3
npm run build
```

## NOTES
- 当前正式路由是 `/v3/workbench`、`/v3/config`、`/v3/chat`、`/v3/translator`。
- `styles.css` 与 `shared/styles/v35.css` 当前同时加载；做样式改动前先确认是否是 `v35` 正式样式还是历史全局规则在生效。
- V4 桌面端任务默认优先在本域和桌面壳层解决问题；如无必要，尽量不要为了桌面端改动后端核心逻辑。
