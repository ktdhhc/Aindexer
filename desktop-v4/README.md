# Aindexer V4 Desktop

`desktop-v4/` 是 V4 桌面端壳层。当前分成两条运行路径：

- 开发模式：直接连接 `frontend-v3` 的 Vite dev server，获得前端热更新。
- 构建 / 生产路径：启动本地 FastAPI sidecar，并加载后端挂载的 `/v3/workbench`。

## 前置条件

- 已安装 Rust 与 Tauri 2 所需系统依赖。
- 已安装 Python 后端依赖：在 `backend/` 下运行 `pip install -r requirements.txt`。
- 如果要跑桌面开发热更新模式，需要能启动 `frontend-v3` 的 Vite dev server。

## 开发启动（热更新）

一键启动后端、前端和桌面壳：

```bash
cd desktop-v4
npm install
npm run dev
```

- `npm run dev` 会依次启动后端 `uvicorn --reload`、前端 Vite dev server 和 Tauri dev shell。
- `tauri dev` 会直接加载：`http://127.0.0.1:5173/v3/workbench`
- API 仍通过 `frontend-v3/vite.config.ts` 代理到 `http://127.0.0.1:8000`
- 此模式下前端改动会热更新到桌面窗口

## 构建 / 生产路径

先构建正式前端产物：

```bash
cd frontend-v3
npm run build
```

然后构建桌面壳：

```bash
cd desktop-v4
npm run build
```

构建后的 Rust 壳层会：

- 选择一个本地动态端口。
- 启动 `backend/desktop_v4_sidecar.py`。
- 设置 `AINDEXER_DATA_DIR`，默认写入用户 AppData 下的 `Aindexer/v4/data`。
- 等待 sidecar 端口就绪后，加载 `http://127.0.0.1:<port>/v3/workbench`。

## 可选环境变量

- `AINDEXER_PYTHON`：指定 Python 可执行文件。
- `AINDEXER_BACKEND_DIR`：指定 backend 目录，默认从仓库结构推导。
- `AINDEXER_DATA_DIR`：指定桌面端数据目录。

## 当前边界

- 开发模式复用 `frontend-v3` 的 Vite dev server；构建路径复用 `frontend-v3` 构建产物和 FastAPI 现有 `/api/*`、`/v3/*` 挂载。
- 首阶段不重写 V3.5 页面，也不默认改动后端核心路由、service 或 repository。
- 正式打包 sidecar 二进制与 updater 仍属于后续阶段。
