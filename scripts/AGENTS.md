# SCRIPTS DOMAIN

## OVERVIEW
`scripts/` 是运维与工程辅助域：打包、布局检查、测试脚本、打包运行时 hook。

## WHERE TO LOOK
| 任务 | 文件 | 说明 |
|---|---|---|
| Windows onedir 打包主流程 | `scripts/build_windows_onedir.py` | PyInstaller、产物生成、smoke test |
| 前端布局检查 | `scripts/check_v2_layout.py` | V2 结构/样式约束检查 |
| chat_v0 测试脚本 | `scripts/test_chat_v0.py` | 本地功能验证 |
| 线上链路测试脚本 | `scripts/test_chat_v0_live.py` | 联网 provider 场景 |
| 前端运行时检查 | `scripts/test_v2_dashboard_runtime.mjs` | V2 运行态校验 |
| PyInstaller 运行时 hook | `scripts/pyi_rth_dll_path.py` | DLL 路径修正 |
| 分发打包辅助 | `scripts/package_share.py` | 共享包打包清单处理 |

## CLASSIFICATION
- 打包发布：`build_windows_onedir.py`, `package_share.py`, `pyi_rth_dll_path.py`
- 质量检查：`check_v2_layout.py`, `test_v2_dashboard_runtime.mjs`
- 功能验证：`test_chat_v0.py`, `test_chat_v0_live.py`

## CONVENTIONS
- 先看 `build_windows_onedir.py` 理解发布链路，再看其它脚本。
- 脚本用途明确单一，不混写“打包 + 业务逻辑”。
- 测试类脚本用于补充回归，不替代 `backend/pytest` 基线。

## ANTI-PATTERNS (SCRIPTS)
- 不要把 `scripts/` 当杂项目录；每个脚本都应有明确职责。
- 不要在打包脚本中硬编码与当前仓库不一致的路径。
- 不要把运行态数据目录当成脚本逻辑的稳定输入。

## COMMANDS
```bash
python scripts/build_windows_onedir.py
python scripts/check_v2_layout.py
python scripts/test_chat_v0.py
node scripts/test_v2_dashboard_runtime.mjs
```

## NOTES
- 对外打包入口仍是根目录 `package_windows_onedir.bat`。
- 发布链路以 Windows 为主，命令和路径优先兼容 `.bat` 场景。
