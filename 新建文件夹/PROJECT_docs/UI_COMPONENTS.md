# V2 前端开发规范 - Logo 组件使用指南

## 概述

为确保 Aindexer V2 版本三个主要页面（工作台、接口配置页、字段配置页）的视觉一致性，统一使用以下 Logo 组件规范。

## Logo 组件标准

### 视觉规格

Logo 组件位于页面左上角，包含以下元素：

1. **图标区域**：
   - 尺寸：40px × 40px
   - 圆角：12px（rounded-xl）
   - 背景：渐变 `linear-gradient(135deg, #89ceff 0%, #0ea5e9 100%)`
   - 阴影：`0 0 22px rgba(137, 206, 255, 0.18)`（var(--shadow-glow)）
   - 图标：`layers`（Material Symbols）
   - 图标颜色：`#00344d`（深色，与渐变背景形成对比）

2. **状态指示器（brand-signal）**：
   - 位置：图标右下角（absolute定位）
   - 尺寸：12px × 12px
   - 圆角：9999px（圆形）
   - 边框：2px solid，颜色与背景匹配
   - 正常状态：`#22c55e`（绿色）+ 光晕
   - 异常状态：`#ef4444`（红色）+ 光晕

3. **文字区域**：
   - 主标题："Aindexer"
     - 字号：1.05rem（约16.8px）
     - 字重：800（extra bold）
     - 颜色：跟随主题（深色模式#fff，浅色模式#0f172a）
   - 副标题："Crystalline Core"
     - 字号：0.64rem（约10.2px）
     - 字重：700
     - 字间距：0.18em
     - 转换：大写（uppercase）
     - 颜色：`#89ceff`（var(--primary)）

### HTML 结构

```html
<!-- 顶栏品牌区域 -->
<div class="v2-shell-topbar-brand">
  <!-- Logo 图标 -->
  <div class="v2-shell-topbar-logo">
    <span class="material-symbols-outlined">layers</span>
    <span class="brand-signal" data-backend-indicator data-state="err"></span>
  </div>
  <!-- 品牌文字 -->
  <div>
    <span class="v2-shell-topbar-brand-title">Aindexer</span>
    <span class="v2-shell-topbar-brand-subtitle">Crystalline Core</span>
  </div>
</div>
```

### CSS 样式定义

样式定义在 `provider-shell.css` 中：

```css
/* Logo 容器 */
.v2-shell-topbar-logo {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dim) 100%);
  color: #00344d;
  font-weight: 800;
  box-shadow: var(--shadow-glow);
}

/* 品牌文字 - 主标题 */
.v2-shell-topbar-brand-title {
  display: block;
  font-size: 1.05rem;
  font-weight: 800;
  color: #fff; /* 深色模式默认 */
  white-space: nowrap;
}

/* 品牌文字 - 副标题 */
.v2-shell-topbar-brand-subtitle {
  display: block;
  margin-top: 2px;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--primary);
  white-space: nowrap;
}

/* 状态指示器 */
.brand-signal {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  border: 2px solid rgba(11, 19, 38, 0.95);
  background: #ef4444;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
}

.brand-signal[data-state='ok'] {
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.12);
}

.brand-signal[data-state='err'] {
  background: #ef4444;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12);
}

/* 浅色模式适配 */
html.light .v2-shell-topbar-brand-title {
  color: #0f172a;
}

html.light .brand-signal {
  border-color: rgba(255, 255, 255, 0.9);
}
```

## 在各页面中的使用

### 1. 工作台 (index.html)

工作台页面使用 Tailwind CSS，Logo 结构如下：

```html
<header id="appTopbar">
  <div class="flex items-center gap-4 min-w-0">
    <!-- Logo -->
    <div class="relative w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-lg shadow-sky-500/20 shrink-0">
      <span class="material-symbols-outlined text-slate-950 text-xl">layers</span>
      <span class="brand-signal" data-backend-indicator data-state="err"></span>
    </div>
    <!-- 品牌文字 -->
    <div class="min-w-0">
      <div class="text-base lg:text-lg font-bold text-white whitespace-nowrap">Aindexer</div>
      <div class="text-[10px] font-bold uppercase tracking-[0.24em] text-primary whitespace-nowrap">Crystalline Core</div>
    </div>
  </div>
</header>
```

**注意**：工作台页面需要在 `tailwind.config` 中定义颜色：

```javascript
colors: {
  primary: '#89ceff',
  'primary-container': '#0ea5e9',
}
```

### 2. 接口配置页 (provider-config.html)

```html
<header class="v2-shell-topbar">
  <div class="v2-shell-topbar-brand">
    <div class="v2-shell-topbar-logo">
      <span class="material-symbols-outlined text-slate-950 text-xl">layers</span>
      <span class="brand-signal" data-backend-indicator data-state="err"></span>
    </div>
    <div>
      <span class="v2-shell-topbar-brand-title">Aindexer</span>
      <span class="v2-shell-topbar-brand-subtitle">Crystalline Core</span>
    </div>
  </div>
</header>
```

### 3. 字段配置页 (words-config.html)

与接口配置页完全一致：

```html
<header class="v2-shell-topbar">
  <div class="v2-shell-topbar-brand">
    <div class="v2-shell-topbar-logo">
      <span class="material-symbols-outlined text-slate-950 text-xl">layers</span>
      <span class="brand-signal" data-backend-indicator data-state="err"></span>
    </div>
    <div>
      <span class="v2-shell-topbar-brand-title">Aindexer</span>
      <span class="v2-shell-topbar-brand-subtitle">Crystalline Core</span>
    </div>
  </div>
</header>
```

## 状态指示器后端对接

状态指示器通过 `data-backend-indicator` 属性自动获取后端健康状态：

- 在 `app-shell.js` 中实现健康检查
- 状态 `ok`：绿色指示器
- 状态 `err`：红色指示器
- 默认状态：`err`（页面加载时显示红色，连接成功后变绿）

## 主题切换适配

Logo 组件需要适配浅色/深色模式：

- **深色模式**：
  - 主标题：`#fff`
  - 指示器边框：`rgba(11, 19, 38, 0.95)`
  
- **浅色模式**：
  - 主标题：`#0f172a`
  - 指示器边框：`rgba(255, 255, 255, 0.9)`
  - 其他元素自动跟随 CSS 变量

## 文件位置

- CSS 样式：`backend/frontend/v2/assets/css/pages/provider-shell.css`
- 工作台实现：`backend/frontend/v2/index.html`
- 接口配置页：`backend/frontend/v2/provider-config.html`
- 字段配置页：`backend/frontend/v2/words-config.html`
- 本规范文档：`PROJECT_docs/UI_COMPONENTS.md`

## 修改历史

- 2025-01-XX：统一三个页面的 Logo 样式，创建本文档
