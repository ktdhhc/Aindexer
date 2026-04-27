# Frontend V3.5 Migration Plan

## 1. 文档目标

- 将 `demo/editorial-lab/` 确认为 Aindexer V3.5 前端设计基线。
- 明确从当前 V3 骨架迁移到 V3.5 正式产品前端的范围、阶段和验收标准。
- 避免继续沿用 V2 复刻路线，转向“学术编辑台 + 文献画布 + 低噪声工具栏”的产品形态。

## 2. 决策摘要

- V3.5 采用 `Editorial Lab` 方向：暖色纸张感、阅读与修订优先、学术编辑工具气质。
- V3.5 不追求复刻 V2 页面，也不以当前 `frontend-v3` 的视觉实现为约束。
- 当前 `demo/editorial-lab/index.html` 是视觉与信息架构参考，不直接作为生产代码复制。
- 当前 `demo/editorial-lab/FRONTEND_DESIGN.md` 是 V3.5 首版设计约束来源。
- 技术栈继续沿用 `React + TypeScript + Vite + TanStack Router + TanStack Query + Zustand`。
- 后端保持 `FastAPI + SQLite + 本地文件`，仅做支持前端产品化所需的最小重构。

## 3. V3.5 产品定位

V3.5 是正式产品前端，不再是 demo 页面。它的核心形态是本地文献编辑工作台：

- 文库：上传、搜索、排序、状态查看、索引触发。
- 文档画布：索引预览、Markdown 渲染、人工修订、导出。
- Notes：字段摘要、后台任务、Chat、翻译片段和待审核动作。
- 配置：Provider、字段模板、Workspace 和系统偏好。
- 翻译：作为正式工作区存在，但不阻塞 V3.5 首个可用闭环。

## 4. 设计基线

### 4.1 默认视觉方向

- 暖浅色主主题。
- 文档画布使用纸张色和衬线字体。
- 主强调色为铜橙。
- 页面通过细线、纸张投影、留白和排版建立层级。
- 不使用 dashboard 式指标卡堆叠。
- 不使用深色 IDE 方案作为 V3.5 默认主题。

### 4.2 工作台首屏结构

```text
TopBar
Library Banner：Workspace 关键词词云 / 关键状态 / 主行动
Toolbar：上传 / Provider / 字段模板 / 生成索引
Main：Library 列表 / Document Canvas / Notes
```

### 4.3 明确放弃的方向

- 不复刻 V2 的视觉布局。
- 不继续扩张 `ConsolePage.tsx` 单页巨石组件。
- 不把主页面做成 SaaS dashboard。
- 不在主 UI 中加入说明书式长文案。
- 不提前引入大型 UI 组件库。

## 5. 当前实现问题

- `frontend-v3/src/pages/ConsolePage.tsx` 过大，混合上传、索引、搜索、预览、编辑、Chat 和局部 Markdown 渲染。
- `frontend-v3/src/styles.css` 过大，页面级样式、组件样式和全局 token 混在一起。
- 当前 V3 仍是迁移阶段骨架，不应作为正式产品视觉基线。
- `docs/FRONTEND_DESIGN.md` 已更新为 V3.5 Editorial Lab 稳定设计约束。

## 6. 目标目录结构

首版迁移优先按功能拆分，避免一次性构建过重架构。

```text
frontend-v3/src/
  app/
    AppShell.tsx
    router.tsx
    workspaceStore.ts
  pages/
    WorkbenchPage.tsx
    ConfigPage.tsx
    ChatPage.tsx
    TranslatorPage.tsx
  features/
    library/
    document-canvas/
    indexing/
    notes/
    provider-config/
    field-templates/
    workspaces/
  shared/
    api/
    ui/
    styles/
    lib/
```

## 7. 前端迁移阶段

### 阶段 0：冻结 V3.5 设计输入

任务：

- 将 `demo/editorial-lab/FRONTEND_DESIGN.md` 作为 V3.5 设计基线。
- 保留 `demo/editorial-lab/index.html` 作为静态视觉参考。
- 梳理现有 `ConsolePage.tsx` 中的功能模块边界。

退出条件：

- V3.5 设计方向、页面骨架和首屏信息层级确认。

### 阶段 1：建立 V3.5 样式基础层

任务：

- 在 `frontend-v3/src/shared/styles/` 中建立 V3.5 token。
- 拆分全局样式、布局样式和基础组件样式。
- 建立 Button、Input、Select、StatusPill、Panel、PaperPanel 的最小实现。

验证：

- `frontend-v3` 可构建。
- 新组件能复现 `demo/editorial-lab` 的核心视觉语言。

### 阶段 2：重建 App Shell 与工作台骨架

任务：

- 调整 `AppShell` 为 V3.5 顶栏 + 左侧 Library Rail。
- 新建 `WorkbenchPage`，不要继续扩张 `ConsolePage.tsx`。
- 实现 Library Banner、Toolbar、三栏主工作区骨架。

验证：

- `/v3/workbench` 首屏接近 V3.5 demo 的信息架构。
- 桌面宽度下显示 Banner + Toolbar + 三栏结构。
- 移动宽度下结构可单列降级。

### 阶段 3：迁移文库与搜索能力

任务：

- 抽出 `features/library/`。
- 接入 `listFiles` 与 `searchDocuments`。
- 文献行主标题使用 `display_name`，次信息保留作者、年份、状态。
- Banner 关键词词云从当前 Workspace 文献关键词派生。

验证：

- 当前 Workspace 文献可展示、搜索和选中。
- 选中文献后可驱动 Document Canvas 加载预览。

### 阶段 4：迁移文档画布与编辑

任务：

- 抽出 `features/document-canvas/`。
- 接入 Markdown 获取、渲染、复制、导出、打开原文。
- 将编辑动作从页面内状态堆叠迁移为 Modal 或 SideSheet。

验证：

- 已索引文献可预览。
- 可进入修订并保存标题、年份、日期和 Markdown。
- 保存后 Library 和 Document Canvas 状态同步刷新。

### 阶段 5：迁移索引任务与 Notes

任务：

- 抽出 `features/indexing/` 和 `features/notes/`。
- 保留 Provider、字段模板、单条索引、批量索引、取消、任务进度。
- Notes 承载字段摘要、任务状态和轻量 Chat。

验证：

- 上传后可触发索引。
- 处理中状态自动刷新。
- 取消和失败回退状态可正确展示。

### 阶段 6：配置页视觉收敛

任务：

- 保留现有 Provider、字段模板、Workspace 能力。
- 将配置页样式收敛到 V3.5 token。
- 删除说明型面板，只保留必要表单、状态和动作。

验证：

- Provider 可保存和测试。
- 字段模板可新建、编辑、删除。
- Workspace 可新建、重命名、删除和切换。

### 阶段 7：翻译页整合

任务：

- 将翻译页改造成 Editorial Lab 双栏校对台。
- 左侧原文/PDF 画布，右侧译文、历史和 Provider 设置。
- 保持 `/api/translation/*` 既有能力优先，不做大范围后端改名。

验证：

- 当前 Workspace 下可上传 PDF。
- 可查看文本层状态。
- 选区翻译能力迁移后再作为 V3.5 完整验收项。

## 8. 后端协作策略

### 8.1 保持稳定

- 保持 `/api/*` 和 `/api/translation/*` 公共行为稳定。
- 保持 Workspace 参数约定。
- 保持索引状态名称：`uploaded`、`parsing`、`indexed`、`needs_review`、`failed`、`cancelled`。
- 保持阶段名称：`uploaded`、`queued`、`parsing`、`llm_request`、`writing`、`completed`、`failed`、`cancel_requested`、`cancelled`。

### 8.2 最小必要重构

- 将 `backend/app/routers/index.py` 中的任务编排逐步下沉到 service/job 层。
- 仅当 Banner 关键词词云需要更高效数据时，再增加 Workspace 汇总接口。
- 暂不做大规模 API 重命名。
- 暂不做云端多用户和权限系统。

### 8.3 可选聚合接口

如前端性能或接口编排变复杂，可新增：

```text
GET /api/workspaces/{workspace_id}/summary
```

候选返回：

- 文献总数
- 已索引数
- 待审核数
- 处理中数
- 最近更新时间
- 关键词 Top N

该接口不是阶段 1-2 的必要条件，前端可先从现有列表与搜索数据派生。

## 9. 测试与验证

### 前端快速验证

```text
cd frontend-v3
npm run build
```

### 后端针对性验证

```text
cd backend
pytest tests/test_api_smoke.py tests/test_workspace_api.py tests/test_field_templates.py
```

### 手动冒烟

```text
启动后端 -> 打开 /v3/workbench -> 切换 Workspace -> 上传文献 -> 运行索引 -> 搜索 -> 预览 -> 编辑 -> 导出 -> Chat -> 配置 Provider/字段模板
```

## 10. 验收标准

- `/v3/workbench` 不再复刻 V2，视觉上符合 Editorial Lab 方向。
- 首屏包含 Library Banner、Toolbar、Library、Document Canvas、Notes。
- Banner 能展示当前 Workspace 的关键词或词云。
- 用户无需回退 V2 即可完成主链：上传、索引、搜索、预览、编辑、导出。
- `ConsolePage.tsx` 的职责被拆分，不再作为新增功能承载点。
- 新增 UI 遵守 V3.5 token 和组件边界。
- 后端公共 API 行为保持稳定。

## 11. 非目标

- 不在 V3.5 阶段切换到原生桌面技术栈。
- 不在 V3.5 阶段引入大型 UI 组件库。
- 不在工作台稳定前引入 Tauri/Electron 打包。
- 不重写全部后端接口。
- 不优先实现云端多用户、权限、协作和同步。

## 12. 建议下一步

1. 在 `frontend-v3` 中先建立 V3.5 token 与 App Shell。
2. 新建 `WorkbenchPage`，以静态数据复现 V3.5 首屏。
3. 分阶段接入真实 API，并逐步拆除 `ConsolePage.tsx` 的职责。
