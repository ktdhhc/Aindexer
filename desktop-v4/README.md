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

直接从桌面壳入口构建完整安装包：

```bash
cd desktop-v4
npm run build
```

`npm run build` 会依次执行：

- 从 `desktop-v4/package.json` 读取版本号，并同步到 `Cargo.toml`
- 构建 `frontend-v3` 正式产物到 `backend/frontend/v3/`
- 使用 `PyInstaller onedir` 打包 `backend/desktop_v4_sidecar.py`
- 运行本地 sidecar 烟测，确认 `/api/providers` 与 `/v3/workbench` 可访问
- 调用 `tauri build --config src-tauri/tauri.bundle.conf.json` 产出 `NSIS` 安装器
- 将最终安装器整理到 `dist/desktop-v4-installer/`

## 版本号入口

桌面端版本号现在只有一个入口：

- `desktop-v4/package.json`

只需要修改这里的：

```json
"version": "0.1.0"
```

然后重新执行：

```bash
cd desktop-v4
npm run build
```

构建前会自动：

- 让 `src-tauri/tauri.conf.json` 直接读取 `package.json` 的版本
- 把相同版本同步到 `src-tauri/Cargo.toml`

构建后的桌面安装包会：

- 选择一个本地动态端口。
- 启动 bundle 中的 sidecar 可执行程序，而不是依赖系统 Python。
- 设置 `AINDEXER_DATA_DIR`，默认写入用户 AppData 下的 `Aindexer/v4/data`。
- 等待 sidecar 端口就绪后，加载 `http://127.0.0.1:<port>/v3/workbench`。

默认安装包输出位置：

- `dist/desktop-v4-installer/Aindexer V4_<version>_x64-setup.exe`

Tauri 原始 bundle 输出仍位于：

- `desktop-v4/src-tauri/target/release/bundle/nsis/`

默认 sidecar 中间产物位置：

- `dist/desktop-v4-sidecar/aindexer-sidecar/`
- `build/desktop-v4-sidecar/`

## 可选环境变量

- `AINDEXER_PYTHON`：指定 Python 可执行文件。
- `AINDEXER_BACKEND_ROOT`：指定 sidecar 运行时 backend 资源目录。
- `AINDEXER_BACKEND_DIR`：`AINDEXER_BACKEND_ROOT` 的兼容别名。
- `AINDEXER_DATA_DIR`：指定桌面端数据目录。
- `AINDEXER_RUNTIME_ROOT`：指定 sidecar 运行时资源根目录。
- `AINDEXER_SIDECAR_PATH`：调试时手动指定 sidecar 可执行文件路径。

## 当前边界

- 开发模式复用 `frontend-v3` 的 Vite dev server；构建路径复用 `frontend-v3` 构建产物和 FastAPI 现有 `/api/*`、`/v3/*` 挂载。
- 首阶段不重写 V3.5 页面，也不默认改动后端核心路由、service 或 repository。
- 当前正式安装包会显式排除仓库 `data/`、运行日志、测试脚本和项目文档，不把本地开发数据打进安装器。
- 自动更新仍属于后续阶段。
