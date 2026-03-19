# Dashboard Instrument Panel Optimization Plan

## Goal

将当前顶部“文献上传与处理”主卡片重构为更符合 `Crystalline Core` 设计语言的“仪表台”，保留真实工作能力，但显著提升视觉层次、信息组织和操作气质。

本轮只先定义一版可落地方案，待确认后再进入实现。

## Confirmed Direction

- 主卡片标题改为 `仪表台`
- 主卡片继续采用左右不对称布局
- 左右区按接近黄金比例布局，建议 `62 / 38`
- 左侧承载信息表达，右侧承载核心操作
- 右侧保留虚线大框上传区
- 文件拖拽触碰上传区时触发高亮提示
- 主按钮文案使用 `全部索引`
- 从该卡片移除 `retries`

## Design Intent

当前问题不是功能缺失，而是顶部卡片仍然像“表单 + 拖拽框”，缺少新版工作台应有的中枢感。

新的“仪表台”应该像一个索引控制核心：

- 左侧像信息仪表面板，负责表达全局状态与索引语义
- 右侧像操作舱，负责投递文件、选择模型并触发批量索引
- 整张卡片是一个整体，不再像多个松散子模块拼接

## Layout Plan

### Overall Structure

- 卡片名称：`仪表台`
- 布局：左右双区
- 比例：左 `62%`，右 `38%`
- 左右区之间保留明显呼吸间距，但不用硬分割线

### Left Zone

左侧分为上下两层：

#### Upper Layer

- 卡片标题：`仪表台`
- 一行极简状态摘要
- 状态摘要用于承接当前顶部 `dashTopStatus`
- 文案保持短，不再用说明性段落

#### Lower Layer

展示三个核心信息块：

1. 关键词云图
2. 已索引数量
3. 可用模型数量

建议结构：

- 关键词云图占主要视觉面积
- 两个统计数值卡片并列或垂直堆叠在云图旁侧/下侧
- 词云为“半结构化分布”，避免真随机散点导致廉价感

### Right Zone

右侧为操作舱，纵向排列三个部分：

1. 上传 / 待生成区
2. Provider / Model 选择区（并排）
3. 主按钮区 `全部索引`

建议布局节奏：

- 上传区占视觉重点
- Provider 与 Model 为紧凑双列
- 主按钮独立成行，成为唯一强 CTA

## Component-Level Changes

### 1. Card Title

- 将当前 `文献上传与处理` 改为 `仪表台`
- 标题区不再承担上传说明功能
- 卡片状态文本压缩为一行短状态

### 2. Upload Dropzone

- 保留虚线大框
- 但弱化“普通文件上传框”的既视感
- 采用更柔和的虚线与玻璃底叠加
- 中心图标和按钮区域继续保留

交互要求：

- 默认状态：低对比虚线框
- `dragover` 状态：
  - 边框提亮
  - 背景轻微发光
  - 图标和文案同步提亮
- 上传中状态：按钮禁用，区域透明度轻降

### 3. Provider / Model Controls

- `Provider` 与 `Model` 并排显示
- 不再在此区域显示 `Retries`
- 控件容器做成一组统一 HUD 面板
- 风格偏“仪表旋钮区”，不是普通表单区

### 4. Main CTA

- 主按钮固定为 `全部索引`
- 保持品牌渐变和主行动级别
- 与上传区、模型区拉开明确层级

### 5. Keyword Cloud

数据来源优先级建议：

1. 使用当前搜索/索引结果中的 `keywords`
2. 若关键词不足，可回退到作者、标题关键词或占位态

空状态要求：

- 若当前没有足够索引结果，不要留空白区
- 显示低干扰占位内容：`暂无索引语义分布`

### 6. Metrics

左侧统计块至少包含：

- `已索引`：当前 indexed 文献数量
- `可用模型`：当前已启用 Provider 下可选择模型总数，或所有启用 Provider 的模型汇总数

## Visual Rules

结合 `stitch_prd/DESIGN.md`，本方案遵循以下规则：

- 不使用硬性分隔线作为主结构手段
- 通过 tonal layering 区分左右区域和局部模块
- 保持大面积呼吸感，不把控件塞满
- 主色只用于关键状态、词云局部点缀和 CTA
- 上传区虽然保留虚线，但需避免传统表单感

## Suggested DOM Refactor

建议将当前顶部卡片重组为以下逻辑块：

- `dashboard-panel`
- `dashboard-panel__left`
- `dashboard-panel__summary`
- `dashboard-panel__cloud`
- `dashboard-panel__metrics`
- `dashboard-panel__right`
- `dashboard-panel__dropzone`
- `dashboard-panel__controls`
- `dashboard-panel__cta`

这样可以在不影响下方队列区域逻辑的情况下，独立重构视觉结构。

## Data Mapping Plan

### Left-Side Data

- 状态摘要：复用 `dashTopStatus`
- 已索引数量：从文件列表中统计 `status === indexed`
- 可用模型数量：从已启用 Provider 的模型列表统计
- 关键词云：从搜索结果或 indexed 文献元数据中抽取高频关键词

### Right-Side Data

- 上传区：继续复用 `uploadDropBox` / `uploadInput` / 上传按钮逻辑
- Provider：复用 `dashProvider`
- Model：复用 `dashModel`
- 主按钮：复用 `runAllBtn`

## Implementation Scope

预计主要修改文件：

- `backend/frontend/v2/index.html`
- `backend/frontend/v2/assets/js/pages/dashboard.js`

可能需要新增的样式/辅助结构：

- 顶部仪表台专属样式
- 词云渲染函数
- 已索引/可用模型统计函数
- 上传区 dragover 高亮强化

## Non-Goals

本轮不做：

- 搜索区重构
- 预览区重构
- Chat 区重构
- Provider 页面结构调整
- 后端 API 变更

## Execution Sequence

确认后建议按以下顺序实施：

1. 重构顶部卡片 DOM 结构
2. 移除 `Retries` 视觉入口
3. 重做右侧上传操作舱样式
4. 增加左侧指标块与关键词云占位态
5. 接入真实统计数据
6. 强化 dragover 高亮状态
7. 做桌面/移动端收敛调整

## Acceptance Criteria

确认实现完成后，应满足：

- 顶部主卡片明确呈现“仪表台”气质
- 左右区视觉重心清晰，比例稳定
- 右侧保留虚线上传区，但不再显得廉价
- `Provider / Model` 并排，`Retries` 完全移除
- 主按钮为 `全部索引`
- 左侧能显示关键词云、已索引数量、可用模型数量
- 拖拽文件进入上传区时有明显但克制的高亮反馈
- 不影响现有上传、索引、搜索、预览功能

## Recommendation

建议直接按本方案进入实现，不必再回到现有“上传卡片小修”路线。

这版方案已经形成了明确的视觉语义：

- 左侧是“认知与状态”
- 右侧是“输入与执行”

这会比当前布局更统一，也更接近新版主工作台应有的中枢体验。
