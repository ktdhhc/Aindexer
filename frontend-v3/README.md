# frontend-v3

V3 unified frontend scaffold for Aindexer.

## Commands

```bash
cd frontend-v3
npm install
npm run dev
```

Build static output for backend hosting:

```bash
cd frontend-v3
npm run build
```

Build output target:

- `backend/frontend/v3/`

Backend route integration:

- `GET /v3`
- `GET /v3/{path}`

Both routes return the V3 SPA entry and static assets under `backend/frontend/v3/`.

Current V3 route map:

- `/v3/workbench` (旧 `/v3/console` 会重定向)
- `/v3/config` (含 Provider / 字段 / Workspace 管理)
- `/v3/chat`
- `/v3/translator`
