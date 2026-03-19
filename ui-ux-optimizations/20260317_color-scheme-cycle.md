# 四色系循环切换方案（可落地）

版本：1.0.0  
时间戳：20260317_220000  
适用文件：`backend/frontend/index.html`  
目标：在顶部操作栏增加一个“色系点”图标按钮，点击一次切换一次，按固定顺序循环，同时保留当前默认配色作为第 0 套，共 5 套（4 新 + 1 默认）。

---

## 一、色系定义

每套均提供浅色 / 深色双模式，变量命名规则：
- `--color-{id}-bg`：卡片/页面背景
- `--color-{id}-ink`：主文字
- `--color-{id}-sub`：次级文字
- `--color-{id}-line`：分隔线
- `--color-{id}-accent`：品牌高光
- `--color-{id}-accent-soft`：高光柔化
- `--color-{id}-shadow`：卡片阴影

### 0️⃣ 当前默认（极昼极夜）
已存在，不再改动，仅通过 `data-color-scheme="default"` 复用。

### 1️⃣ 雾玻璃（Glass）
| 模式 | 背景 | 文字 | 高光 | 阴影 |
|----|------|------|------|------|
| 浅色 | #ffffff @ 96% | #111827 | #60a5fa | 0 8px 24px rgba(15,23,42,.06) |
| 深色 | #0f172a @ 96% | #f9fafb | #38bdf8 | 0 10px 26px rgba(2,8,23,.28) |

### 2️⃣ 薄荷拿铁（MintLatte）
| 模式 | 背景 | 文字 | 高光 | 阴影 |
|----|------|------|------|------|
| 浅色 | #fafbf9 | #1f2937 | #10b981 | 0 8px 24px rgba(15,23,42,.06) |
| 深色 | #1c1917 | #f3f4f6 | #34d399 | 0 10px 26px rgba(2,8,23,.28) |

### 3️⃣ 赛博霓虹（Cyber）
| 模式 | 背景 | 文字 | 高光 | 阴影 |
|----|------|------|------|------|
| 浅色 | #ffffff | #111827 | #8b5cf6 | 0 8px 24px rgba(15,23,42,.06) |
| 深色 | #110e1b | #e5e7eb | #a78bfa | 0 10px 26px rgba(2,8,23,.28) |

### 4️⃣ 暖橙焦糖（Caramel）
| 模式 | 背景 | 文字 | 高光 | 阴影 |
|----|------|------|------|------|
| 浅色 | #fefdfb | #1f2937 | #f59e0b | 0 8px 24px rgba(15,23,42,.06) |
| 深色 | #1f1a14 | #f3f4f6 | #fbbf24 | 0 10px 26px rgba(2,8,23,.28) |

---

## 二、切换逻辑

### 1. 顺序（固定循环）
default → Glass → MintLatte → Cyber → Caramel → default…

### 2. 存储
- `localStorage.setItem('li_colorScheme', schemeId)` // 'default' | 'glass' | 'mintlatte' | 'cyber' | 'caramel'
- 与明暗模式 `li_theme` 正交，互不影响

### 3. 初始化
```js
const schemes = ['default', 'glass', 'mintlatte', 'cyber', 'caramel'];
let currentIdx = schemes.indexOf(localStorage.getItem('li_colorScheme') || 'default');
function applyColorScheme() {
  const scheme = schemes[currentIdx];
  document.body.setAttribute('data-color-scheme', scheme);
}
applyColorScheme(); // 在 DOMContentLoaded 调用
```

### 4. 切换按钮
- 位置：顶部操作栏最右侧（紧邻暗色模式切换按钮）
- 图标：一个 16×16 圆点，使用当前色系 accent 色作为背景
- 点击事件：
```js
colorDotBtn.addEventListener('click', () => {
  currentIdx = (currentIdx + 1) % schemes.length;
  localStorage.setItem('li_colorScheme', schemes[currentIdx]);
  applyColorScheme();
  // 微动效：按钮自身 0.9 缩放 + 150ms 弹回
  colorDotBtn.style.transform = 'scale(0.9)';
  setTimeout(() => colorDotBtn.style.transform = '', 150);
});
```

---

## 三、CSS 变量（节选示例，完整见实施代码）
```css
:root {
  /* === 雾玻璃 Glass 浅色 === */
  --color-glass-light-bg: #ffffff;
  --color-glass-light-ink: #111827;
  --color-glass-light-sub: #6b7280;
  --color-glass-light-line: #e5e7eb;
  --color-glass-light-accent: #60a5fa;
  --color-glass-light-accent-soft: rgba(96, 165, 250, 0.12);
  --color-glass-light-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);

  /* === 雾玻璃 Glass 深色 === */
  --color-glass-dark-bg: #0f172a;
  --color-glass-dark-ink: #f9fafb;
  --color-glass-dark-sub: #9ca3af;
  --color-glass-dark-line: #324357;
  --color-glass-dark-accent: #38bdf8;
  --color-glass-dark-accent-soft: rgba(56, 189, 248, 0.12);
  --color-glass-dark-shadow: 0 10px 26px rgba(2, 8, 23, 0.28);

  /* 其余三套同理，命名规则：--color-{id}-{mode}-* */
}

/* 浅色模式应用 */
body[data-theme="light"][data-color-scheme="glass"] {
  --bg: var(--color-glass-light-bg);
  --ink: var(--color-glass-light-ink);
  --sub: var(--color-glass-light-sub);
  --line: var(--color-glass-light-line);
  --accent: var(--color-glass-light-accent);
  --accent-soft: var(--color-glass-light-accent-soft);
  --shadow: var(--color-glass-light-shadow);
}

/* 深色模式应用 */
body[data-theme="dark"][data-color-scheme="glass"] {
  --bg: var(--color-glass-dark-bg);
  --ink: var(--color-glass-dark-ink);
  --sub: var(--color-glass-dark-sub);
  --line: var(--color-glass-dark-line);
  --accent: var(--color-glass-dark-accent);
  --accent-soft: var(--color-glass-dark-accent-soft);
  --shadow: var(--color-glass-dark-shadow);
}

/* 其余三套同理，按 data-color-scheme 值映射 */
```

---

## 四、动效与性能

### 1. 全局过渡
```css
* {
  transition: background 200ms ease, color 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
}
```

### 2. 按钮微动效
```css
.color-scheme-dot {
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.color-scheme-dot:active {
  transform: scale(0.9);
}
```

### 3. 避免卡顿
- 所有颜色变量在 `<body>` 切换，避免大范围重绘
- 使用 `will-change: background, color` 提示浏览器优化
- 切换逻辑放在 `requestAnimationFrame` 内，对齐刷新率

---

## 五、实施步骤（可直接开工）

### 1. 新增色系变量
- 在 `:root` 追加 4 套 × 2 模式 共 40 个变量（已给出命名模板）
- 每组变量对应 `body[data-theme="light/dark"][data-color-scheme="{id}"]`

### 2. 切换按钮 DOM
```html
<!-- 放在顶部操作栏最右侧，紧邻暗色模式按钮 -->
<button id="colorSchemeDot" class="btn-icon color-scheme-dot" title="切换色系"></button>
```

### 3. 按钮样式
```css
.color-scheme-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent); /* 实时跟随当前色系高光 */
  border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  cursor: pointer;
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}
.color-scheme-dot:hover {
  transform: scale(1.08);
}
.color-scheme-dot:active {
  transform: scale(0.9);
}
```

### 4. 切换脚本
```js
const schemes = ['default', 'glass', 'mintlatte', 'cyber', 'caramel'];
let currentIdx = schemes.indexOf(localStorage.getItem('li_colorScheme') || 'default');
const dotBtn = document.getElementById('colorSchemeDot');

function applyColorScheme() {
  document.body.setAttribute('data-color-scheme', schemes[currentIdx]);
  // 更新按钮颜色（实时跟随 --accent）
  dotBtn.style.background = 'var(--accent)';
}
dotBtn.addEventListener('click', () => {
  currentIdx = (currentIdx + 1) % schemes.length;
  localStorage.setItem('li_colorScheme', schemes[currentIdx]);
  applyColorScheme();
});

// 初始化
document.addEventListener('DOMContentLoaded', applyColorScheme);
```

### 5. 暗色模式兼容
- 已在每套变量里提供深色值，无需额外脚本
- 只需确保 `data-theme` 与 `data-color-scheme` 同时存在即可

---

## 六、验收清单（手工）

1. 刷新页面 → 按钮颜色与当前色系一致（默认首次为蓝）
2. 连续点击按钮 → 色系按 default→Glass→MintLatte→Cyber→Caramel→default 循环，无闪烁
3. 切换暗色模式 → 同一色系自动切到对应深色变量，按钮颜色同步变
4. 重启浏览器 → 上次色系被记忆，自动恢复
5. 快速连点 → 无卡顿，按钮有 0.9 缩放反馈

---

## 七、后续可扩展

- 增加更多色系：只需在 `schemes` 数组与 CSS 变量里追加，零脚本改动
- 提供“随机色系”按钮：用 `Math.floor(Math.random() * schemes.length)`
- 图标可改为渐变圆环：用 `conic-gradient` 展示当前色系主色
- 可接入系统主题自动切换：监听 `prefers-color-scheme` 并同步 `data-theme`

---

*文件位置：`*PROJECT*/ui-ux-optimizations/20260317_color-scheme-cycle.md`*