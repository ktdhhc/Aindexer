# Aindexer 前端设计规范：水晶核心 (The Crystalline Core)

本规范定义了 Aindexer V2.0+ 的前端视觉语言与交互准则。后续开发应严格遵守此规范，以确保产品视觉的精密感、通透感与一致性。

> **System Status:** 🟢 Stable / **Version:** 2.0.1 / **Target:** Desktop Web (Desktop-first)

---

## 1. 核心设计北极星 (Creative North Star)

**代号：水晶核心 (The Crystalline Core)**

我们旨在创造一种“封装在深色建筑玻璃中的精密仪器”感。
- **拒绝：** 传统的、盒子式的、平庸的 SaaS 扁平化布局。
- **追求：** 编辑感 (Editorial)、流动感 (Fluid)、层次感 (Depth)。
- **空间策略：** 采用**有意的非对称布局**，通过负空间（留白）让背景的有机色块（Blobs）呼吸。

---

## 2. 色彩与色调体系 (Design Tokens)

### 基础底色 (Surfaces)
| Token Name | Hex Value | Description |
| :--- | :--- | :--- |
| `--surface` | `#0b1326` | 基础背景，深邃的虚空感，禁止使用纯黑 |
| `--surface-low` | `#131b2e` | 二级区域，略微提亮 |
| `--surface-mid` | `#171f33` | 主容器/卡片背景 |
| `--surface-high` | `#222a3d` | 弹窗、悬浮层、活跃态 |
| `--surface-lowest`| `#060e20` | 输入框内部、极深凹槽 |

### 强调色 (Accents)
| Token Name | Hex Value | Usage |
| :--- | :--- | :--- |
| `--primary` | `#89ceff` | 核心交互、高亮文本 |
| `--primary-dim` | `#0ea5e9` | 渐变终点、深色背景上的主色 |
| `--secondary` | `#93ccff` | 次级信息、辅助图形 |
| `--tertiary` | `#ffb86e` | 警告、关注点（琥珀色） |
| `--error` | `#ffb4ab` | 错误、破坏性操作 |
| `--on-surface` | `#dae2fd` | 主要文本颜色 |
| `--on-surface-dim`| `#88929b` | 次要文本、图标 |

---

## 3. 视觉红线与代码实现 (Code Implementation)

### 🚫 禁止 1px 实线边框
禁止使用 `border: 1px solid #ccc` 这种显眼的线条。

**替代方案 (CSS Snippets):**

1.  **色调偏移 (Tonal Shift):**
    ```css
    /* 依靠背景色差区分 */
    .container { background: var(--surface); }
    .card { background: var(--surface-low); }
    ```

2.  **幽灵边框 (Ghost Border):**
    仅在极高密度区使用，作为极弱的暗示。
    ```css
    .ghost-border {
      border: 1px solid color-mix(in srgb, var(--on-surface) 10%, transparent);
      /* 或者用 rgba(255, 255, 255, 0.1) */
    }
    ```

3.  **内阴影凹槽 (Inset Groove):**
    用于输入框或深层容器。
    ```css
    .inset-groove {
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
      background: var(--surface-lowest);
    }
    ```

---

## 4. 玻璃拟态 (Glassmorphism)

所有悬浮元素（弹窗 Modal、侧边栏 Sidebar、浮动卡片）必须遵循此规范。

**标准 CSS 实现:**
```css
.glass-panel {
  /* 背景：带色相的深色半透明 */
  background: color-mix(in srgb, var(--surface-high) 60%, transparent);
  
  /* 核心：高斯模糊 */
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  
  /* 边缘：微弱的高光白边，模拟玻璃厚度 */
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-top-color: rgba(255, 255, 255, 0.12);
  
  /* 阴影：弥散的光晕而非生硬投影 */
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
```

---

## 5. 排版规范 (Typography)

强调“数字期刊”的高级感。中西文混排推荐字体栈：
`font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', sans-serif;`

| Class / Mixin | Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `.text-display` | `3.5rem` | 700/Bold | 1.1 | 仅限 Hero 标语 |
| `.text-h1` | `1.75rem` | 500/Medium | 1.3 | 页面/模块主标题 |
| `.text-h2` | `1.375rem`| 600/SemiBold| 1.4 | 卡片标题 |
| `.text-body` | `1rem` | 400/Regular | 1.6 | 正文 |
| `.text-label` | `0.75rem` | 700/Bold | 1.2 | 标签、大写说明 |

**开发原则:**
- 标题 (`h1`, `h2`) 颜色通常使用 `--on-surface` (高亮白)。
- 正文 (`body`) 颜色通常使用 `--on-surface-dim` (灰蓝)，降低视觉疲劳。
- 重要的数字/强调词可直接使用 `--primary` 或 `--tertiary` 颜色。

---

## 6. 组件代码指南 (Component Recipes)

### 按钮: 触感玻璃 (Tactile Glass Button)
```html
<!-- Primary: 渐变光感 -->
<button class="btn-primary">Action</button>

<!-- Secondary: 玻璃质感 -->
<button class="btn-secondary">Cancel</button>
```

```css
.btn {
  height: 2.75rem; /* 44px */
  padding: 0 1.5rem;
  border-radius: 999px; /* Pill shape */
  font-weight: 600;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-primary {
  /* 液态渐变 */
  background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dim) 100%);
  color: #00344d; /* 深色文字 */
  border: none;
}
.btn-primary:hover {
  filter: brightness(1.1) saturate(1.2);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3); /* 辉光 */
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--on-surface);
}
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}
```

### 破坏性按钮: 淡红警示态
- 破坏性操作与退出应用统一使用 `--error` 体系，不使用 `--tertiary` 琥珀色。
- 推荐视觉：`background: rgba(255, 180, 171, 0.08)`、`border: 1px solid rgba(255, 180, 171, 0.2)`、`color: var(--error)`。
- hover 仅轻微增强到 `rgba(255, 180, 171, 0.14)`，避免做成高饱和纯红按钮。
- 视觉参考应与搜索卡片条目的“删除”按钮保持同一语义层级。

### 退出应用
- V2 侧栏允许放置退出应用按钮，但必须归类为破坏性操作样式。
- 退出按钮必须调用后端 `/api/system/exit` 真接口，而不是只做前端提示。
- 在开发模式 `uvicorn --reload` 下，退出逻辑也必须结束父级 reloader，避免“子进程退出后立即被拉起”的假退出。

### 输入框: 沉浸式 (Clean Input)
```css
.input-clean {
  background: var(--surface-lowest);
  border: 1px solid transparent; /* 预留位置 */
  border-radius: 0.75rem; /* 12px */
  color: var(--on-surface);
  transition: all 0.2s ease;
}
.input-clean:focus {
  outline: none;
  background: var(--surface-low);
  border-color: var(--primary); /* 聚焦时高亮边框 */
  box-shadow: 0 0 0 3px rgba(137, 206, 255, 0.15);
}
```

### 卡片: 便当盒 (Bento Card)
```css
.bento-card {
  @extend .glass-panel; /* 复用玻璃拟态 */
  border-radius: 1.5rem; /* 24px 大圆角 */
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
}
.bento-card:hover {
  transform: scale(1.01); /* 微弱放大 */
  border-color: rgba(255, 255, 255, 0.15);
}
```

---

## 7. 布局与动效 (Layout & Motion)

### 有机背景 (Organic Background)
页面底层应始终包含流动的模糊色块（Blobs）。
- **实现:** 使用 `fixed` 定位的 `div`，配合 CSS `filter: blur(80px)` 和 `animation`。
- **颜色:** 使用 `--primary` 和 `--secondary` 的低透明度版本 (opacity 0.15 - 0.3)。

### 栅格与间距 (Spacing)
- **基准:** 4px
- **常用间距:**
  - 组件内: `8px` / `12px`
  - 卡片内: `24px` (padding)
  - 模块间: `32px` / `48px` (section gap)
- **非对称:** 允许侧边栏宽度 (`80px` -> `240px`) 与主内容区形成非均等分割，不要追求绝对居中。

### 动效曲线 (Easings)
- **通用:** `cubic-bezier(0.4, 0, 0.2, 1)` (Standard)
- **弹窗/展开:** `cubic-bezier(0.34, 1.56, 0.64, 1)` (Spring/Bounce 这种回弹感适合玻璃材质的厚重感)

---

## 8. 验收清单 (Pre-flight Checklist)

在提交前端代码前，请自检：

1.  [ ] **去线化:** 我是否移除了不必要的 `border: 1px solid`？是否尝试用背景色差代替了？
2.  [ ] **玻璃感:** 弹窗背景是否半透明？模糊度是否足够（>18px）让背景透出来？
3.  [ ] **对比度:** 文字是否清晰可读？（避免深灰背景上用深灰字）
4.  [ ] **圆角统一:** 大容器是否使用了统一的大圆角 (24px/1.5rem)？小按钮是否使用了胶囊圆角？
5.  [ ] **呼吸感:** 间距是否足够大？是否感觉拥挤？（拥挤时，请增加 margin）
