# V4 Desktop Development Plan

## 1. 文档目标

- 将桌面端正式命名为 `v4`。
- 明确 `v4` 的唯一正式前端目标是 `V3.5 Editorial Lab`，而不是历史入口。
- 基于当前 `frontend-v3` 的真实页面实现，制定一版可落地的桌面开发方案。
- 回答四类核心问题：
  - 哪些部分先做
  - 哪些部分应分步骤做
  - 哪些能力可以直接复用
  - 哪些边界必须重构
- 建立开发过程约束，保证对当前 `V3.5` 页面和交互细节进行高一致性复刻，避免中途漂移。
- 将更新推送、日志采集、诊断导出、数据导入导出纳入桌面产品方案。

## 2. 前提修正

## 2.1 本方案采用的新前提

按当前用户确认后的事实，`V3.5` 已是唯一正式入口。

因此本方案采用如下前提：

- `frontend-v3` 是唯一需要桌面化一致性复刻的正式前端。
- `/v3/workbench`、`/v3/config`、`/v3/chat`、`/v3/translator` 是 `v4` 的正式页面目标。
- `backend/frontend/v2/`、`backend/frontend/translator/`、`ConsolePage.tsx` 等历史入口不再作为桌面端复刻目标，不再作为验收对象。
- 旧入口可以在仓库里短期保留为历史资产或回退参考，但不应决定 `v4` 的 UI 和交互验收标准。

## 2.2 真相源优先级

本次桌面复刻必须按如下顺序确定真相源：

1. `frontend-v3/src/pages/*.tsx` 与 `frontend-v3/src/features/**`
2. `frontend-v3/src/shared/styles/v35.css`
3. `frontend-v3/src/app/AppShell.tsx`
4. `demo/editorial-lab/index.html`
5. `docs/FRONTEND_DESIGN.md`

解释：

- `docs/FRONTEND_DESIGN.md` 描述的是稳定设计方向。
- `demo/editorial-lab/index.html` 描述的是视觉基线。
- 但用户要求复刻的是“当前这个版本”，因此当前实际运行中的 `frontend-v3` 页面和 `v35.css` 才是最高优先级真相源。

## 2.3 当前结论

- `frontend-v3/src/main.tsx` 已同时加载 `styles.css` 和 `shared/styles/v35.css`。
- `AppShell`、`WorkbenchPage`、`ConfigPage`、`TranslatorPage`、`ChatPage` 都已使用 `v35-*` 类名和 Editorial Lab 结构。
- 这说明 `V3.5` 不是纯概念方案，而是已经有真实页面骨架和大量细节落地的正式前端版本。

## 2.4 复刻标准降档与决策优先级

本方案将复刻标准从“高精度优先”下调为“高一致性优先”。

这里的“高一致性复刻”指的是：

- 信息架构一致
- 视觉气质一致
- 关键尺寸关系一致
- 交互语言一致
- 状态反馈一致

但不再把像素级完全一致作为首要目标。

当以下目标发生冲突时，采用如下决策顺序：

1. `V3.5` 的交互设计一致性
2. 当前正式页面的结构与行为语义
3. 视觉与布局的高相似度
4. 像素级或浏览器遗留行为的精确复制

这意味着：

- 如果“完全照搬当前实现”会破坏 `V3.5` 的交互设计一致性，则优先保持交互设计一致性。
- 如果桌面原生语义与浏览器语义冲突，则优先做符合当前产品交互语言的桌面化收敛，而不是机械复刻浏览器细节。
- 所有这类偏离都必须被记录，而不是默默改变。

## 3. V3.5 当前界面深度分析

## 3.1 全局 Shell

关键文件：

- `frontend-v3/src/app/AppShell.tsx`
- `frontend-v3/src/shared/styles/v35.css`

当前结构：

- 固定 `TopBar`：品牌、`Editorial Lab` 标识、Workspace 选择器。
- 固定左侧 `Library Rail`：文库、翻译、问答、配置四个主入口。
- 主内容区承载四个正式页面。

关键视觉事实：

- TopBar 高度 `60px`。
- 左侧 Rail 宽度 `72px`。
- 主区左边距与 Rail 对齐。
- 整体使用暖纸背景、铜橙强调、细线边界，而不是深灰 IDE 风格。

桌面复刻要求：

- `v4` 首屏必须首先稳定复现这一层壳结构。
- 不允许在首阶段改成新的侧边栏模式、顶部标题布局或系统风格窗口头部。
- 即使后续引入原生菜单和更新能力，首版主视觉仍应保持当前 `v35` 壳层信息架构。
- 若窗口控件、原生菜单接入与局部像素复刻冲突，则优先保持壳层交互和信息架构一致性。

## 3.2 Workbench 界面

关键文件：

- `frontend-v3/src/pages/WorkbenchPage.tsx`
- `frontend-v3/src/features/workbench/LibraryBanner.tsx`
- `frontend-v3/src/features/workbench/WorkbenchToolbar.tsx`
- `frontend-v3/src/features/workbench/LibraryPanel.tsx`
- `frontend-v3/src/features/workbench/CanvasPanel.tsx`
- `frontend-v3/src/features/workbench/NotesPanel.tsx`
- `frontend-v3/src/shared/styles/v35.css`

当前结构：

1. `LibraryBanner`
2. `WorkbenchToolbar`
3. `v35-editorial-grid`
   - 左列 `LibraryPanel`
   - 中列 `CanvasPanel`
   - 右列 `NotesPanel`

关键视觉与布局事实：

- `LibraryBanner` 是非卡片式顶部锚点，包含：
  - Workspace kicker
  - 关键词词云
  - 文献统计
  - 当前状态文案
- `WorkbenchToolbar` 是三段式：
  - 导入文献
  - Provider / Model / Template 选择
  - 生成索引 / 刷新
- 主工作区采用固定三栏：`330px / fluid / 330px`。
- `CanvasPanel` 使用 `PaperPanel` 形态，带稿纸网格背景。
- `NotesPanel` 不是聊天软件侧栏，而是字段摘要、任务、轻量 Assistant 的组合面板。

关键交互事实：

- 文献搜索通过显式提交驱动。
- 运行中状态每 `2s` 轮询刷新文件和搜索结果。
- 预览支持 `rendered/raw` 切换。
- `复制 / 原文 / 导出` 动作靠近 `Document Canvas` 顶部工具栏。
- 当前 `原文` 与 `导出` 仍用 `window.open(...)` 打开。
- 轻量 Assistant 在 `NotesPanel` 内，维持“工作台附属助手”而非独立聊天页。

桌面复刻要求：

- Workbench 是 `v4` 的第一优先页面。
- 首阶段必须保住三栏宽度关系、Banner 排版、工具栏分区和 Canvas 稿纸感。
- 不允许把 Notes 改造成大卡片堆叠区，也不允许把 Banner 压缩成普通统计栏。
- 若个别按钮触发方式需要从浏览器跳转语义改成桌面打开语义，应保持动作位置、反馈时机和语言一致，而不是强求浏览器行为原样照搬。

## 3.3 Config 界面

关键文件：

- `frontend-v3/src/pages/ConfigPage.tsx`
- `frontend-v3/src/shared/styles/v35.css`

当前结构：

1. `Settings Atelier` Hero
2. 左侧 `Config Nav`
3. 右侧 `Config Stage`
4. Stage 内根据 section 切换：
   - `providers`
   - `defaults`
   - `fields`
   - `workspaces`

关键视觉与布局事实：

- Hero 使用大标题和元数据，不是普通表单页标题条。
- 外层壳结构是 `260px + fluid`。
- 具体 section 内部通常是 `280px 列表 + fluid 编辑纸面`。
- 左侧导航与列表项都使用暖色选中态和左侧铜橙内嵌线。
- Provider / Field / Workspace 编辑器均采用大纸面、头部信息区、底部动作区。

关键交互事实：

- Provider 区支持创建、测试、保存、删除、恢复默认。
- Defaults 区保存三类默认模型：索引 / 翻译 / 对话。
- Fields 区采用“字段条带 + Inspector”模式，不是普通表格。
- Workspace 区支持新建、重命名、删除、切换。
- 当前状态文案显示在左侧导航下方，不漂浮在页面其他位置。

桌面复刻要求：

- `ConfigPage` 是桌面产品化能力的自然承载页。
- 首阶段必须先一致性复刻现有四个 section，不应先把它扩成复杂系统后台。
- 后续更新、日志、备份能力也应优先并入这里，而不是新造一个“系统中心”页面。

## 3.4 Chat 界面

关键文件：

- `frontend-v3/src/pages/ChatPage.tsx`
- `frontend-v3/src/app/chatStore.ts`
- `frontend-v3/src/shared/styles/v35.css`

当前结构：

1. `Research Chat` Hero
2. 左侧主区 `v35-chat-paper`
   - mode rail
   - thread
   - timeline
   - composer
3. 右侧 `v35-chat-side`
   - Sessions
   - Sources

关键视觉与布局事实：

- 主区像长篇研究对话纸面，而不是 IM 式聊天列表。
- 用户消息、助手消息、系统消息三种视觉样式严格不同。
- 助手回复以左侧铜橙竖线组织，强调“编辑性”和“来源性”。
- Timeline 是一条悬浮于右侧的紧凑跳转辅助带。
- 右侧侧栏宽度固定 `320px`。

关键交互事实：

- 模式切换：`wide / deep / agent`。
- Deep 模式支持文献 source 选择和 `@` mention 补全。
- 线程具备 auto-follow、jump-to-bottom、timeline jump。
- 会话支持新建、切换、重命名、删除。
- Assistant 支持 trace 展开与来源复制。
- 当前会话与部分状态保存在 `localStorage`。

桌面复刻要求：

- Chat 页的核心不是“发消息”，而是“长研究会话 + 来源控制 + 线程导航”。
- `v4` 不能把它退化为普通聊天对话框。
- 该页是第二复杂交互面，仅次于 Translator，需要单独建立回归矩阵。
- 若线程滚动、复制、引用跳转等局部细节与桌面环境存在天然差异，则优先保持研究工作台式交互节奏，而不是逐像素追随浏览器滚动表现。

## 3.5 Translator 界面

关键文件：

- `frontend-v3/src/pages/TranslatorPage.tsx`
- `frontend-v3/src/features/translator/PdfViewer.tsx`
- `frontend-v3/src/app/translatorStore.ts`
- `frontend-v3/src/shared/styles/v35.css`

当前结构：

1. `Translation Desk` Header
2. `v35-translator-workspace`
   - 左：Documents Library
   - 中：Reader / PDF Viewer
   - 右：Inspector

关键视觉与布局事实：

- Translator 是一个真正的双栏校对台，而不是 PDF + 弹窗工具。
- 当前布局默认是：`300px / fluid / inspectorWidth(默认 420px)`。
- 左侧文档栏可折叠。
- 中间 Reader 与右侧 Inspector 之间可拖拽调整宽度。
- Reader 支持 `layout / text` 两种查看模式。
- Reader 顶部支持缩放控制和 PDF 打开动作。
- Inspector 包含 `Result / History` 两个 tab。

关键交互事实：

- 文档切换会清空 source text 与 latest result。
- `compact` 模式下，文本选区可自动 debounce 触发翻译。
- `full` 模式下，用户可编辑 source textarea 再主动翻译。
- `PdfViewer` 使用 pdf.js text layer，依赖真实文本选择语义。
- `History` 支持恢复历史条目到当前结果面板。
- 当前 translator pane 状态保存在 zustand store 中，但默认不跨刷新持久化。

桌面复刻要求：

- Translator 是桌面化最高风险页面。
- 文字选区、text layer、缩放、滚动、resizer、streaming/cancel 都必须逐项回归。
- 任何为了桌面适配而重写 PDF 交互的动作，都只能在基线回归之后进行。
- 若某些浏览器层面的选区细枝末节与当前 `V3.5` 的翻译台交互一致性冲突，应优先保证选区到译文流程的连贯性和可预期性。

## 3.6 响应式与动效事实

关键文件：`frontend-v3/src/shared/styles/v35.css`

当前断点事实：

- `1180px` 以下：Workbench、Chat、Config、Translator 的多栏结构开始降级。
- `1024px` 以下：Translator 三栏降为单列。
- `900px` 以下：左侧 Rail 隐藏，主区全宽显示。

当前动效与状态事实：

- 选中态主要通过暖底 + 铜橙边线表达。
- hover 变化轻，不存在强弹跳或重动画。
- Chat turn 进入动画很轻。
- 大部分反馈通过颜色、边线、细阴影和状态 pill 表达。

桌面复刻要求：

- `v4` 不以“桌面窗口通常更宽”为由忽略现有响应式规则。
- 必须同时验证常见桌面窗口尺寸和用户缩窗场景。

## 4. V4 的技术路线

## 4.1 结论

推荐路线：`Tauri 2 + Python sidecar(FastAPI) + frontend-v3(V3.5)`。

## 4.2 架构形态

```text
V4 Desktop Shell (Tauri)
  -> 启动 Python sidecar
  -> sidecar 启动 FastAPI
  -> FastAPI 提供 /api/* 和 /v3/*
  -> WebView 加载 http://127.0.0.1:<dynamic-port>/v3/workbench
  -> V3.5 页面作为唯一正式 UI
```

## 4.3 为什么仍然推荐本地 HTTP 而不是 Tauri 自定义协议

- 当前 `frontend-v3` 所有 API 请求都默认走相对路径 `/api/...`。
- `PdfViewer`、pdf.js worker、静态资源路径、`/v3` basepath 都已按当前后端挂载方式工作。
- Workbench 当前的原文打开、导出、PDF 链接都默认建立在本地 HTTP 资源之上。
- 使用同源 HTTP 加载可以最大限度减少对现有 `V3.5` 页面结构和行为的干扰。

## 5. 哪些内容可以直接复用

| 领域 | 现有位置 | 复用结论 | 说明 |
|---|---|---|---|
| 前端正式页面 | `frontend-v3/src/pages/*` | 直接复用 | `Workbench / Config / Chat / Translator` 是 v4 的唯一正式页面基础 |
| 壳层与导航 | `frontend-v3/src/app/AppShell.tsx` | 直接复用 | 首版不要改壳层信息架构 |
| V3.5 样式系统 | `frontend-v3/src/shared/styles/v35.css` | 直接复用 | 是当前页面视觉真相源 |
| Workbench feature | `frontend-v3/src/features/workbench/*` | 直接复用 | 已按 feature 拆分，可直接进入桌面适配 |
| Chat Store | `frontend-v3/src/app/chatStore.ts` | 基本复用 | 当前会话持久化逻辑已存在 |
| Translator Store | `frontend-v3/src/app/translatorStore.ts` | 基本复用 | 当前交互状态模型已成形 |
| Workspace Store | `frontend-v3/src/app/workspaceStore.ts` | 基本复用 | 维持当前 workspace 持久化逻辑 |
| API Client | `frontend-v3/src/shared/api/*` | 直接复用 | 首阶段不要改请求模式 |
| FastAPI 主体 | `backend/app/main.py`, `backend/app/routers/*` | 直接复用 | 页面和 API 现有关系保持稳定 |
| 翻译域 | `backend/app/translation/*` | 直接复用 | 供 TranslatorPage 使用 |
| 备份恢复 API | `backend/app/routers/export.py` | 直接复用 | 后续桌面数据管理直接接线 |
| 后端日志 | `backend/app/main.py` | 直接复用 | 已有 `app.log` 与按日滚动日志 |
| 桌面启动经验 | `backend/desktop_main.py` | 复用思路 | 适合作为 sidecar 入口演进基础 |
| 打包经验 | `scripts/build_windows_onedir.py` | 复用思路 | 可帮助整理 Python sidecar 打包链路 |

## 6. 哪些内容必须重构或补层

| 领域 | 现有位置 | 处理方式 | 原因 |
|---|---|---|---|
| 运行时数据目录 | `backend/app/config.py` | 抽运行时路径层 | 当前 `data/` 是 repo 相对路径，不适合正式桌面安装目录 |
| 后端启动方式 | `backend/desktop_main.py` | 改 sidecar 启动入口 | 需要动态端口、健康检查、进程回收 |
| 桌面生命周期 | 新增 `desktop-v4/src-tauri/*` | 新建 | 现有浏览器启动器模型不能直接用作正式桌面壳 |
| 浏览器专有动作 | `WorkbenchPage.tsx`, `TranslatorPage.tsx` | 抽 desktop bridge | 当前 `window.open` / 链接打开行为不是桌面产品语义 |
| 剪贴板能力 | `WorkbenchPage.tsx`, `ChatPage.tsx`, `TranslatorPage.tsx` | 抽 bridge/fallback | 需保证 WebView 环境下稳定可用 |
| 样式隔离 | `frontend-v3/src/main.tsx`, `styles.css` | 先冻结再隔离 | 当前仍同时加载旧 `styles.css`，存在遗留样式干扰风险 |
| 字体策略 | `v35.css` 中的字体族 | 自托管或随包分发 | 若用户机器缺字重/字体，界面会明显漂移 |

## 7. 哪些内容不应在首阶段重写

- 不应在桌面化首阶段重做 `AppShell`。
- 不应在桌面化首阶段重新设计 Workbench 三栏布局。
- 不应在桌面化首阶段把 Chat 改成 IM 式界面。
- 不应在桌面化首阶段重写 Translator 的 PDF 选择逻辑。
- 不应在桌面化首阶段把 ConfigPage 改成后台管理系统样式。
- 不应在桌面化首阶段把 `localStorage` 一次性迁移到全新持久化层。

解释：

- 首阶段的任务是“一致性搬运当前 `V3.5`”，不是“借桌面化再做一次前端重构”。

## 8. 开发顺序建议

## 8.1 必须先做的部分

### 阶段 0：冻结 V3.5 复刻基线

目标：先定义“当前 V3.5 长什么样、怎么动”，再开始开发。

任务：

- 固定正式路由基线：
  - `/v3/workbench`
  - `/v3/config`
  - `/v3/chat`
  - `/v3/translator`
- 为这四个页面建立基线截图。
- 为这四个页面建立关键交互矩阵。
- 为 `v35.css` 建立 token 快照和关键尺寸快照。
- 记录当前关键浏览器行为点：
  - `window.open`
  - `navigator.clipboard`
  - `localStorage`
  - pdf.js worker

退出条件：

- 基线截图完整。
- 每个页面都有关键交互清单。
- 真相源顺序被文档化，后续实现不靠记忆推进。

### 阶段 1：桌面运行时底座

目标：先让 V3.5 页面在桌面壳里稳定启动。

任务：

- 新建 `desktop-v4/` 工程。
- 使用 `Tauri 2` 建立主窗口。
- 使用 Python sidecar 启动 FastAPI。
- 改固定端口 `8000` 为动态端口。
- 引入启动健康检查与失败提示。
- 抽象 app data / logs / exports / runtime 目录。

退出条件：

- 双击桌面应用可直接进入 `V3.5` 主窗口。
- 不打开外部浏览器。
- FastAPI sidecar 能随窗口稳定启动和关闭。

## 8.2 应分步骤做的部分

### 阶段 2：Shell + Workbench 高一致性复刻

原因：

- Workbench 是正式主入口。
- 它也定义了整个 V3.5 的壳层、视觉语言和核心任务流。

任务：

- 先在桌面窗口中稳定复现 `AppShell`。
- 再复刻 `WorkbenchPage` 的 Banner、Toolbar、三栏结构。
- 替换 `window.open` 为桌面 bridge，但不改变按钮位置、文案和触发时机。
- 保持 `2s` 轮询、auto-select、preview mode 切换和 Assistant 行为不变。

### 阶段 3：Config 高一致性复刻

原因：

- Config 是系统能力、Provider 管理和后续产品化组件的自然承载页。
- 与 Translator 和 Chat 相比，它的桌面敏感度更低，但结构复杂度高，适合作为第二波页面精调对象。

任务：

- 一致性复现 Hero、Nav、Stage、List + Paper 的结构。
- 保持四个现有 section 的信息架构不变。
- 先不要提前塞入更新/日志/备份新 section。

### 阶段 4：Chat 高一致性复刻

原因：

- Chat 的页面结构已较稳定，但交互细节很多。
- 相比 Translator，它不依赖 PDF text layer，因此适合作为第三波精细化页面。

任务：

- 保持 mode rail、thread、timeline、composer、side sections 的结构不变。
- 保持 auto-follow、jump-to-bottom、timeline jump、session rename/delete、source selection、mention popover 行为不变。
- 保持 deep/wide/agent 三模式的来源侧栏逻辑不变。

### 阶段 5：Translator 高一致性复刻

原因：

- Translator 是桌面环境下技术风险最高的页面。
- 它同时包含 pdf.js、text layer、缩放、选区、历史恢复、resizer、streaming/cancel。

任务：

- 复刻 Documents Library / Reader / Inspector 三栏结构。
- 保持 `300px / fluid / inspectorWidth` 的默认布局逻辑。
- 保持 library collapse、inspector resize、zoom、layout/text 模式、compact auto-translate 行为不变。
- 保持 `PdfViewer` 的 worker 路径和选区语义可用。

## 8.3 哪些部分可以并行推进

- 动态端口与 runtime path 改造。
- sidecar 生命周期管理。
- 桌面 bridge 基础层。
- 自动化截图基线工具。
- 字体随包分发与资源清单。

## 8.4 哪些部分应在 Parity 之后再做

以下能力是 `v4` 必需能力，但不应抢在核心页面一致性复刻之前：

1. 更新推送通道
2. 日志采集与诊断导出
3. 数据备份与恢复面板

原因：

- 它们会增加 Config 页的信息架构和桌面壳集成复杂度。
- 应先完成 `V3.5` 核心页面复刻，再做受控扩展。

## 9. 如何约束开发过程，避免中途漂移

## 9.1 单一真相源约束

所有 UI 改动必须先回答两个问题：

1. 它是否与当前 `frontend-v3` 的已实现表现一致？
2. 如果不一致，是桌面兼容必须，还是主观优化？

若是主观优化，首阶段不做。

若桌面兼容必须与精准复刻发生冲突，则遵循：

1. 先保 `V3.5` 的交互设计一致性
2. 再保结构与视觉关系
3. 最后才保局部浏览器实现细节

## 9.2 CSS 冻结约束

- 首阶段冻结 `v35.css` 的关键 token、尺寸和布局关系。
- 任何对 `v35-*` 类名的删除、改名、合并都应延后到 parity 通过之后。
- `styles.css` 的历史规则即使计划后续清理，也必须先做截图 diff，再决定是否隔离或删除。
- 若历史样式与当前 `V3.5` 设计一致性冲突，应优先维护 `v35.css` 所表达的正式前端设计语言。

## 9.3 行为冻结约束

首阶段不得改变以下行为：

- Workbench 的轮询节奏
- Chat 的 session/source/mode 行为
- Translator 的 compact 自动翻译节奏
- Config 的 section 结构与导航顺序
- Workspace 选择器的位置与使用方式

允许调整但必须受控记录的部分：

- 浏览器新窗口打开语义到桌面打开语义的映射
- 剪贴板、文件对话框、原生菜单、系统关闭行为的桌面化适配

这些调整必须以“不破坏 V3.5 交互语言”为前提，而不是以“原实现代码路径相同”为前提。

## 9.4 桌面适配实现约束

- 所有桌面专有能力统一从 bridge 层进入。
- 页面层不得散落调用 Tauri API。
- 页面层不得直接硬编码运行端口。
- 首版保留现有 `localStorage` 键和语义，避免跨升级行为漂移。
- Translator 当前不持久化 pane 状态到本地磁盘，首版应保持这一事实。

## 9.5 视觉校验约束

每个页面至少固定以下截图场景：

1. 初始空状态
2. 有数据状态
3. 选中状态
4. loading / running 状态
5. error 状态
6. hover / active 关键控件状态
7. 滚动后状态

## 9.6 放行门槛

每个阶段通过前至少满足：

1. 页面截图 diff 通过
2. 关键交互矩阵通过
3. sidecar 启停回归通过
4. 相关错误日志可定位

## 10. 产品级组件如何纳入 V4

## 10.1 版本更新通道

### 目标

- 用户能收到新版本并完成桌面升级。

### 推荐实现

- 使用 `Tauri Updater`。
- 版本通道至少分为：`stable`、`beta`。
- 更新元数据优先使用 `GitHub Releases` 或静态 manifest。

### 页面落位建议

- 不新建独立页面。
- 在 `ConfigPage` parity 通过后，新增 `更新` section。

### 最小能力

- 显示当前版本与通道。
- 手动检查更新。
- 显示更新说明。
- 用户确认后下载和安装。

## 10.2 日志采集与诊断导出

### 目标

- 收集桌面端、本地后端和前端错误证据，便于排障。

### 推荐实现

- 复用后端 `app.log` 与按日滚动日志。
- 新增桌面壳启动/更新/sidecar 生命周期日志。
- 前端新增 `window.onerror`、`unhandledrejection` 和 React error boundary 采集。

### 页面落位建议

- 在 `ConfigPage` parity 通过后，新增 `诊断与日志` section。

### 最小能力

- 查看最近错误摘要。
- 一键导出诊断包 zip。
- 诊断包自动脱敏 API Key。

## 10.3 数据导入导出与备份

### 目标

- 保持本地桌面工具最关键的数据安全能力。

### 推荐实现

- 直接复用 `backend/app/routers/export.py`。
- 恢复前继续生成 `pre_restore` 快照。
- 桌面层只负责文件对话框、进度反馈与结果展示。

### 页面落位建议

- 在 `ConfigPage` parity 通过后，新增 `数据管理` section。

### 最小能力

- 导出完整备份
- 导入完整备份
- 显示最近备份/恢复结果
- 恢复失败时支持导出诊断包

## 11. 测试与验收策略

## 11.1 路由级验收对象

`v4` 首阶段只验收以下页面：

1. `/v3/workbench`
2. `/v3/config`
3. `/v3/chat`
4. `/v3/translator`

历史入口不作为桌面验收对象。

## 11.2 自动化分层

### 层 1：运行时

- sidecar 启动
- 动态端口
- app data 目录
- 窗口关闭时进程回收

### 层 2：页面截图

- 固定窗口尺寸截图
- 与基线截图 diff
- 对动态区域使用 mask 或阈值

### 层 3：交互回归

- Workbench 上传 / 索引 / 取消 / 预览 / 导出
- Config 保存 / 切换 / 创建 / 删除
- Chat 会话 / 模式 / 来源 / 提交 / 停止 / 跳转
- Translator 选区 / 缩放 / 模式切换 / 历史恢复 / 取消

### 层 4：桌面桥接回归

- 打开原文
- 导出 Markdown
- 打开 PDF
- 剪贴板复制
- 备份导出
- 备份恢复

## 11.3 一致性优先复刻的验收标准

满足以下条件，才可认为 `V3.5` 已被一致性优先地复刻到桌面端：

1. 壳层、四个正式页面的结构与当前实现一致。
2. 关键宽度、间距、留白、边界和层级关系保持高相似度，不要求逐像素完全一致。
3. 字体、字重、行距和滚动视觉不出现破坏产品气质的明显漂移。
4. Workbench、Chat、Translator 的复杂交互节奏与设计语言一致。
5. 所有浏览器替换行为都维持原位置、原入口、原反馈语义，或给出更符合当前桌面交互设计的一致替代。
6. 当交互设计一致性与精准复刻冲突时，选择前者，并记录偏离原因。
7. 所有可见差异都有明确记录和接受结论。

## 12. 风险清单

| 风险 | 影响 | 缓解策略 |
|---|---|---|
| WebView2 与当前浏览器渲染差异 | 细节偏移、截图不一致 | 使用桌面窗口截图作为最终基线，不只依赖浏览器截图 |
| 字体未随包分发 | 标题、正文、字重明显漂移 | 为 `Source Serif 4 / IBM Plex Sans / JetBrains Mono / Noto Sans SC / Noto Serif SC` 制定打包策略 |
| `styles.css` 历史规则干扰 `v35.css` | 局部样式污染 | 先冻结当前计算结果，再逐步隔离旧样式 |
| `window.open` 语义与桌面不一致 | 原文、导出、PDF 打开行为异常 | 统一走 desktop bridge |
| `navigator.clipboard` 在 WebView 表现不稳定 | 复制失败 | 提供桥接 fallback |
| Translator text layer 与选区语义变化 | 自动翻译和选区翻译失效 | 把 Translator 放在最后一波高风险校验 |
| 固定端口冲突 | 应用启动失败 | 动态端口 + 健康检查 |
| 安装目录不可写 | 日志/数据/导出失败 | 引入 runtime path abstraction |
| 更新只更新前端或壳层一侧 | 版本不匹配 | 使用单一版本源，更新包包含壳层与 sidecar |

## 13. 建议的版本节奏

### v4.0

- `V3.5` 四个正式页面在桌面壳中稳定运行。
- 重点是设计一致性优先的高一致性复刻，不扩张信息架构。
- Workbench / Config / Chat / Translator 全部过页面级验收。

### v4.1

- 加入 `更新`、`诊断与日志`、`数据管理` 三个 Config 扩展 section。
- 完成 updater、日志导出、备份恢复产品化接线。

### v4.2+

- 在 parity 稳定基础上，再考虑样式清理、bridge 收敛、legacy 资源剥离和更深层后端重构。

## 14. 第一批代码工作建议

如果按本方案实施，第一批工作不应先改 UI，而应按下面顺序开始：

1. 建立 `desktop-v4/` 工程。
2. 抽 sidecar 启动与 runtime path 层。
3. 固定 `V3.5` 四个页面的截图与交互基线。
4. 实现桌面 bridge 最小版本。
5. 先让 `/v3/workbench` 在桌面壳里无漂移跑通。

## 15. 最终建议

`v4` 现在不应再围绕“旧入口能否复刻”展开，而应明确为：

- 以 `frontend-v3` 的 `V3.5 Editorial Lab` 为唯一正式前端。
- 以当前真实实现为第一真相源，而不是只看设计文档。
- 先完成 `V3.5` 四个正式页面的设计一致性优先复刻。
- 再把更新、日志、备份作为受控扩展并入 `ConfigPage`。
- 用 bridge 和运行时适配解决桌面问题，而不是借机重做前端。

这条路线既符合当前版本事实，也能最大限度降低桌面化过程中的视觉和交互漂移风险。
