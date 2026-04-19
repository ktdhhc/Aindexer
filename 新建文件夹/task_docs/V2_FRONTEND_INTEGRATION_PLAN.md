# Aindexer 新版前端接入方案（保留旧版入口）

## 1. 文档目的

本方案用于指导以下目标的落地：

- 在不破坏现有业务的前提下，将新版高保真前端逐步接入现有后端能力。
- 保留旧版前端入口，确保已有用户工作流、打包链路、应急回退能力不受影响。
- 将 `stitch_prd` 中的主工作台界面与 `provider_config` 中的新接口配置页纳入统一的新版前端体系。
- 为后续 Agent / 开发者提供一个可持续扩展、低风险、易回滚的实施路径。

本方案不是“一次性重写前端”，而是 **双入口并行 + 页面级迁移 + 适配层接入**。

---

## 2. 当前事实与约束

### 2.1 当前运行结构

- 现有后端通过 `backend/app/main.py` 将 `backend/frontend` 作为静态目录挂载到根路径 `/`。
- 当前旧版入口已经承载完整工作流：
  - 上传与索引
  - SSE 流式进度
  - 取消 / 重试 / 重置
  - 搜索与导出
  - Markdown 预览与手工修订
  - Provider 配置
  - 字段配置
  - 备份恢复与退出

### 2.2 新版视觉素材来源

- `stitch_prd/code.html`：新版主工作台/整体壳层参考。
- `provider_config/code.html`：新版接口配置页参考。
- 两者共享同一套视觉北极星：**Crystalline Core / 水晶核心**。

### 2.3 关键现实约束

- 当前项目是本地单机应用，打包和分发链路已经可用。
- 现有前端是“静态 HTML + 原生 JS”风格。
- 当前后端 API 已经比较完整，因此新版前端应尽量 **复用现有 `/api/*` 能力**，而不是先重构后端。
- 为降低风险，短期内不建议直接引入额外前端构建工具链作为前提条件。

---

## 3. 总体策略：双入口 + 同后端 + 适配层

### 3.1 推荐目标结构

短期推荐采用以下结构：

```text
backend/
  frontend/
    index.html                 # 旧版入口，继续保留 /
    v2/
      index.html               # 新版主工作台入口 /v2/
      provider-config.html     # 新版接口配置页 /v2/provider-config.html
      assets/
        css/
          tokens.css
          base.css
          components.css
          pages/
            dashboard.css
            provider-config.css
        js/
          api/
            providers.js
            files.js
            index.js
            search.js
            export.js
            chat.js
            fields.js
            system.js
          adapters/
            providers-adapter.js
            dashboard-adapter.js
            preview-adapter.js
          shared/
            app-shell.js
            state.js
            storage.js
            design-tokens.js
          pages/
            dashboard.js
            provider-config.js
```

### 3.2 为什么推荐放到 `backend/frontend/v2/`

这是当前阶段最稳的做法，因为：

- 不需要改变根入口 `/` 的挂载方式。
- 利用现有静态挂载即可访问 `/v2/`。
- 打包链路最小改动，兼容当前 onedir 分发逻辑。
- 旧版入口继续可用，回退成本接近零。

### 3.3 为什么不建议现在直接切换到根入口 `/`

因为新版目前仍然是“视觉更成熟，但功能并未完全等价”的状态。

如果直接替换 `/`，会带来三个风险：

1. 业务关键操作缺失或降级。
2. 用户已有操作习惯被打断。
3. 打包后回退和问题定位成本显著升高。

结论：**先保留旧版 `/`，新增新版 `/v2/`，等新版主流程稳定后再决定是否切换默认入口。**

---

## 4. 页面迁移策略：先接独立页，再接主工作台

### 4.1 最佳迁移顺序

推荐按以下顺序实施：

1. **新版 Provider 配置页**
2. 新版主工作台壳层（上传 / 搜索 / 预览 / Chat V0）
3. 新版字段配置页
4. 新版备份/恢复与系统入口
5. 最终评估是否切换默认入口

### 4.2 为什么优先做 `provider_config`

这是新版中最适合“先落地成真页面”的一页，因为它具备以下特点：

- 业务边界清晰，独立性强。
- 后端 Provider API 已经完整。
- 与主工作台解耦，不会一上来就卷入上传、搜索、SSE、预览等复杂联动。
- 视觉风格和交互密度足以成为新版设计系统的“基准页”。

也就是说：

**`provider_config` 最适合先做成新版前端的第一张正式业务页。**

---

## 5. 页面级功能映射

## 5.1 新版主工作台（来自 `stitch_prd`）

### 可直接接入的后端能力

- 上传文献：`/api/files/upload`
- 文献列表：`/api/files`
- 启动单条索引：`/api/index/{doc_id}/run`
- 批量索引：`/api/index/run_all`
- 流式进度：`/api/index/{doc_id}/run_stream`
- 取消：`/api/index/{doc_id}/cancel`
- 重置：`/api/index/{doc_id}/reset`
- 搜索：`/api/search`
- 单条导出 / 批量导出 / 全量导出：`/api/export/*`
- Markdown 预览/保存：`/api/index/{doc_id}` 与 `/api/index/{doc_id}/markdown`
- 原文查看：`/api/files/{doc_id}/original`
- Chat V0：`/api/chat/ask_v0`

### 需要先做“真实能力对齐”的部分

- 上传支持格式文案必须改成当前真实支持：`pdf / txt / docx`
- 搜索区不能先摆“时间范围 / 向量存储 / SQL 缓存”这种未落地的筛选
- Chat 区需明确标识为 `V0`，不能假装已有多会话、附件、语音能力
- Preview 面板必须围绕“Markdown 索引 + 文献元信息”设计，而不是 PRD 里那种业务文档 mock 内容

### 结论

主工作台可以接，但必须以“**后端真实能力优先**”为原则做 PRD 适配，而不是逐字照搬视觉稿语义。

---

## 5.2 新版 Provider 配置页（来自 `provider_config`）

### 当前后端已支持的能力

- 读取全部 Provider 配置：`GET /api/providers`
- 获取完整 API Key：`GET /api/providers/{provider}/api_key`
- 更新单个 Provider：`PUT /api/providers/{provider}`
- 测试连接：`POST /api/providers/{provider}/test`
- 删除自定义 Provider：`DELETE /api/providers/{provider}`
- 恢复默认 Provider：`POST /api/providers/reset_defaults`

### 当前后端不完全等价的部分

`provider_config/code.html` 中有一些能力需要区分：

#### 已有后端支撑，可直接做真功能

- Base URL
- API Key（显示/隐藏/更新）
- Timeout
- Temperature
- 连接测试
- 删除自定义 Provider
- 恢复默认配置

#### 当前只能做“前端适配”或“阶段性本地存储”的能力

- `Max Retries`
  - 当前并非 Provider 持久化字段，旧版通过本地存储保存并在索引请求时拼到 `retries` 参数中。
  - 短期建议继续保留为 **前端本地配置**，不要强行改后端表结构。

- `Model Registry / + Add Model`
  - 当前旧版也是通过本地存储维护自定义模型列表，再与 Provider 默认模型合并展示。
  - 短期建议继续保持 **本地模型注册表** 方案。

- 顶部搜索、语言切换、头像、Usage/Logs 导航
  - 先视为壳层 UI，不要求在第一阶段全部落地。

### 新版 Provider 页的建议定位

它不是“旧版 Provider 弹窗的皮肤替换”，而是：

**新版前端中的第一张正式业务配置页。**

建议入口：

- `/v2/provider-config.html`
- 同时在旧版中保留入口按钮“试用新版接口配置”
- 在新版中保留“返回经典版”入口

---

## 6. 适配层设计：不要先改后端，先改前端映射

### 6.1 原则

新版前端不应在第一阶段直接逼迫后端重构接口。

应先建立一层 `adapters/`：

- 将后端数据转成新版页面需要的 ViewModel
- 将新版页面表单数据转回当前后端接口格式

### 6.2 示例：Provider 适配器

建议新增：`assets/js/adapters/providers-adapter.js`

职责：

- 后端 `GET /api/providers` 返回的数组 -> Provider 卡片数据
- 合并本地 `retries` 与自定义模型列表
- 管理 API Key 掩码展示与解密拉取逻辑
- 统一生成提交 payload

建议输出结构：

```js
{
  provider: 'openai',
  title: 'OpenAI',
  status: 'connected' | 'disconnected',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  timeout: 120,
  temperature: 0.1,
  enabled: true,
  retries: 3,               // localStorage
  customModels: ['gpt-4.1'],// localStorage
  apiKeyMasked: 'sk-****',
  apiKeyInput: '',
  isDefault: true
}
```

这样可以保证后端暂时不变，前端也能完整呈现新版页面。

---

## 7. 新版前端的技术路线建议

## 7.1 当前阶段不建议直接上重型 SPA 重构

不建议一开始就切到 React/Vite/大型状态管理，原因：

- 当前项目已经有稳定的静态 HTML 分发方式。
- Windows 本地打包链路现成。
- 现阶段主要任务是“新版 UI 与现有业务能力对齐”，而不是“重建前端工程体系”。

### 推荐路线

短期采用：

- 多页静态 HTML
- 原生 ES Modules
- 共享 CSS Tokens / Shared JS Modules
- 页面级 JS 初始化

也就是：

**保留“静态资源即可运行”的优势，但把旧版单文件风格升级为“分模块静态前端”。**

这是当前最适合该项目的折中方案。

---

## 7.2 共享壳层（App Shell）建议

建议在新版前端中抽出一个统一壳层模块，负责：

- Top Nav
- Side Nav
- 背景 blobs / glow
- 语言切换位置
- 主题切换位置
- 通用页脚 / 页面标题区

建议文件：

- `assets/js/shared/app-shell.js`
- `assets/css/tokens.css`
- `assets/css/base.css`
- `assets/css/components.css`

页面只负责渲染内容区，不负责重复造导航壳。

补充约束：

- 侧栏中的退出按钮属于破坏性操作，视觉必须使用 `--error` 体系的淡红按钮，并与搜索卡片“删除”按钮保持一致。
- 退出动作必须绑定 `/api/system/exit` 真接口；若后端运行在 `uvicorn --reload` 下，仍需确保能够结束父级 reloader，而不是只退出子进程。

---

## 8. 页面落地计划（分阶段）

## Phase 0：搭新版目录与壳层

目标：不接业务，只把新版目录和共享资源骨架搭起来。

输出：

- `backend/frontend/v2/index.html`
- `backend/frontend/v2/provider-config.html`
- `backend/frontend/v2/assets/css/*`
- `backend/frontend/v2/assets/js/*`

要求：

- `/` 仍是旧版
- `/v2/` 与 `/v2/provider-config.html` 可访问
- 与 `doc/FRONTEND_DESIGN_SYSTEM.md` 保持一致

## Phase 1：先做新版 Provider 配置页真接入

目标：让 `provider_config` 成为新版第一张真实可用页面。

功能范围：

- 读取 Provider 列表
- 编辑 Base URL / API Key / Timeout / Temperature / Enabled
- 测试连接
- 删除自定义 Provider
- 恢复默认 Provider
- 本地维护 retries / custom models

不做：

- Usage / Logs 真页面
- 账号体系
- 多语言完整切换

验收标准：

- 能替代旧版的大部分 Provider 配置操作
- 但旧版入口仍然保留

## Phase 2：接新版主工作台核心闭环

优先实现：

- 上传
- 索引进度
- 搜索
- 预览
- Chat V0 简版

要求：

- 文案与真实能力保持一致
- 不要把未落地功能做成误导性强交互

## Phase 3：补齐配置类页面

后续可逐步新增：

- `/v2/fields-config.html`
- `/v2/backup-restore.html`
- `/v2/help.html`

## Phase 4：评估是否切默认入口

条件：

- 新版主工作台和新版 Provider 页已稳定
- 核心链路（上传 -> 索引 -> 搜索 -> 预览 -> 导出）无功能缺口
- 回退入口仍可保留

---

## 9. 旧版入口保留策略

建议长期保留以下双入口：

- `/`：经典版（旧前端）
- `/v2/`：新版主工作台

并在两个入口中互放跳转：

- 旧版：`试用新版`
- 新版：`返回经典版`

这会显著降低灰度迁移风险。

如果未来新版完全稳定，再评估：

- `/` -> 新版
- `/classic/` -> 旧版

但这不应在第一阶段进行。

---

## 10. 对 Agent / 开发者的实施准则

后续 Agent 在推进新版前端时，应遵守以下准则：

1. **永远优先保留旧版根入口可用。**
2. **新版优先复用现有 `/api/*`，不要先分叉后端。**
3. **所有视觉稿都必须先做“能力对齐”，不能直接照搬不存在的功能。**
4. **优先完成页面级闭环，不追求一次性全站替换。**
5. **优先实现新版 Provider 配置页，再实现新版主工作台。**
6. **可本地存储的配置（如 retries、自定义模型）短期继续本地化，不急于后端化。**
7. **保持设计系统一致，但允许页面级适配，不要求每个像素都死守视觉稿。**

---

## 11. 推荐的近期执行顺序

如果按最稳路线推进，建议下一步直接按以下顺序实施：

1. 新建 `backend/frontend/v2/` 目录结构
2. 提炼共享样式与壳层
3. 先把 `provider_config` 落成可运行真页面
4. 再将 `stitch_prd` 主工作台改造成接真实数据的新版首页
5. 最后逐步迁移字段配置、备份恢复等次级页面

---

## 12. 结论

当前最优方案不是“大爆炸式替换前端”，而是：

**保留旧版入口 + 在 `/v2/` 下逐页接入新版前端 + 先落地新版 Provider 配置页 + 用适配层接住现有后端能力。**

这是当前项目在稳定性、开发效率、视觉升级、打包兼容性之间最均衡的方案。
