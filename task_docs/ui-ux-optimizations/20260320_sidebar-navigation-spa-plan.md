# 侧栏导航优化方案（完整版）：SPA 无刷新动态加载

## 方案概述
将两页改造为真正的单页应用（SPA），侧栏和顶栏作为固定壳层，只有主内容区动态切换。使用原生 JS 实现轻量级路由和模块加载，不引入外部框架。

**改动范围**：中到大，需要统一两页架构
**开发周期**：4-6 小时
**风险等级**：中（需要充分测试）

---

## 核心策略

### 1. 架构改造

**目标结构**：
```
index.html（作为 SPA 壳层）
├── 侧栏（固定，不刷新）
├── 顶栏（固定，不刷新）
├── 主内容区（动态加载）
│   ├── 工作台内容（默认）
│   └── 接口配置内容（点击后加载）
└── 全局遮罩/通知层

provider-config.html（变为内容模板）
├── 移除侧栏/顶栏
├── 只保留主内容 HTML
└── JS 改为可重复初始化的模块
```

---

### 2. 路由系统

**实现文件**：`backend/frontend/v2/assets/js/shared/spa-router.js`

```javascript
/**
 * SPA Router - 无刷新路由系统
 */
class SPARouter {
  constructor() {
    this.routes = {
      '/v2/': 'dashboard',
      '/v2/index.html': 'dashboard',
      '/v2/provider-config.html': 'providers'
    };
    this.currentPage = null;
    this.cache = new Map();
    this.maxCache = 3;
    
    this.init();
  }
  
  init() {
    // 处理浏览器前进后退
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.path) {
        this.navigate(e.state.path, false);
      }
    });
    
    // 拦截所有链接点击
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && this.shouldHandleLink(link)) {
        e.preventDefault();
        this.navigate(link.getAttribute('href'));
      }
    });
    
    // 初始化当前页
    this.updateActiveNav(window.location.pathname);
  }
  
  shouldHandleLink(link) {
    const href = link.getAttribute('href');
    return href && (
      href.startsWith('/v2/') || 
      href.includes('provider-config.html')
    ) && !href.startsWith('http');
  }
  
  async navigate(path, pushState = true) {
    if (this.currentPage === path) return;
    
    // 检查是否有未保存的更改
    if (this.hasUnsavedChanges()) {
      const confirmed = confirm('当前页面有未保存的更改，确定要离开吗？');
      if (!confirmed) return;
    }
    
    this.showLoading();
    
    try {
      // 1. 保存当前页状态
      this.saveCurrentState();
      
      // 2. 清理当前页
      this.cleanupCurrentPage();
      
      // 3. 加载新内容
      const content = await this.loadContent(path);
      
      // 4. 渲染新内容
      this.renderContent(content);
      
      // 5. 初始化新页 JS
      await this.initializePage(path);
      
      // 6. 更新 URL 和历史
      if (pushState) {
        window.history.pushState({ path }, '', path);
      }
      
      // 7. 更新 UI
      this.updateActiveNav(path);
      this.currentPage = path;
      
      // 8. 恢复滚动位置或回到顶部
      this.restoreScroll(path);
      
    } catch (error) {
      console.error('Navigation failed:', error);
      // 失败时回退到传统跳转
      window.location.href = path;
    } finally {
      this.hideLoading();
    }
  }
  
  async loadContent(path) {
    // 检查缓存
    if (this.cache.has(path)) {
      return this.cache.get(path);
    }
    
    // 发送请求
    const response = await fetch(path, {
      headers: { 'X-Requested-With': 'SPARouter' }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // 提取主内容
    const content = this.extractMainContent(html, path);
    
    // 缓存
    if (this.cache.size >= this.maxCache) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(path, content);
    
    return content;
  }
  
  extractMainContent(html, path) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 根据页面类型提取不同内容
    if (path.includes('provider-config')) {
      // 提取 provider-config 的主内容区
      const main = doc.querySelector('.v2-shell-main');
      const hero = main?.querySelector('.provider-page-hero');
      const grid = main?.querySelector('#providerGrid');
      const dock = doc.querySelector('#providerActionDock');
      
      return {
        html: `
          <div class="v2-shell-main">
            <header class="v2-shell-topbar">
              <!-- 顶栏内容 -->
            </header>
            <div class="v2-content-wrap">
              ${hero?.outerHTML || ''}
              ${grid?.outerHTML || ''}
            </div>
          </div>
          ${dock?.outerHTML || ''}
        `,
        scripts: ['assets/js/pages/provider-config.js'],
        title: doc.title
      };
    } else {
      // 提取工作台内容
      const main = doc.querySelector('.app-main');
      return {
        html: main?.outerHTML || '',
        scripts: ['assets/js/pages/dashboard.js'],
        title: doc.title
      };
    }
  }
  
  renderContent(content) {
    // 更新标题
    document.title = content.title;
    
    // 替换主内容
    const container = document.getElementById('spaContainer');
    if (container) {
      // 淡出
      container.style.opacity = '0';
      
      setTimeout(() => {
        container.innerHTML = content.html;
        // 淡入
        requestAnimationFrame(() => {
          container.style.opacity = '1';
        });
      }, 150);
    }
  }
  
  async initializePage(path) {
    // 动态加载页面脚本
    const modulePath = path.includes('provider-config') 
      ? '../pages/provider-config.js' 
      : '../pages/dashboard.js';
    
    try {
      const module = await import(modulePath + '?v=' + Date.now());
      
      // 调用初始化函数
      if (typeof module.initSPA === 'function') {
        await module.initSPA();
      } else if (typeof module.init === 'function') {
        await module.init();
      }
    } catch (err) {
      console.warn('Failed to init page module:', err);
    }
  }
  
  cleanupCurrentPage() {
    // 清理事件监听器
    // 清理定时器
    // 中止进行中的请求
    
    // 派发页面离开事件
    window.dispatchEvent(new CustomEvent('spa:page-leave'));
  }
  
  saveCurrentState() {
    if (!this.currentPage) return;
    
    const state = {
      scrollY: window.scrollY,
      timestamp: Date.now(),
      // 页面特定的状态
      data: this.getPageSpecificState()
    };
    
    sessionStorage.setItem(`spa_state_${this.currentPage}`, JSON.stringify(state));
  }
  
  getPageSpecificState() {
    const page = document.body.dataset.page;
    
    if (page === 'dashboard') {
      return {
        searchKeyword: document.getElementById('searchInput')?.value,
        searchResults: document.getElementById('searchRows')?.innerHTML,
        previewContent: document.getElementById('previewMarkdown')?.textContent
      };
    }
    
    if (page === 'providers') {
      return {
        // provider-config 的状态
        hasUnsavedChanges: window.providerConfigUnsaved || false
      };
    }
    
    return {};
  }
  
  restoreScroll(path) {
    const saved = sessionStorage.getItem(`spa_state_${path}`);
    if (saved) {
      const state = JSON.parse(saved);
      // 5分钟内的状态才恢复
      if (Date.now() - state.timestamp < 5 * 60 * 1000) {
        window.scrollTo(0, state.scrollY);
        return;
      }
    }
    // 否则回到顶部
    window.scrollTo(0, 0);
  }
  
  updateActiveNav(path) {
    const page = path.includes('provider-config') ? 'providers' : 'dashboard';
    document.body.setAttribute('data-page', page);
    
    document.querySelectorAll('[data-nav-link]').forEach(link => {
      const isActive = link.getAttribute('data-nav-link') === page;
      link.classList.toggle('is-active', isActive);
      // 更新样式...
    });
  }
  
  hasUnsavedChanges() {
    // 检查当前页面是否有未保存的更改
    if (document.body.dataset.page === 'providers') {
      return window.providerConfigUnsaved || false;
    }
    return false;
  }
  
  showLoading() {
    document.getElementById('spaLoader')?.classList.add('is-active');
  }
  
  hideLoading() {
    document.getElementBySPA('spaLoader')?.classList.remove('is-active');
  }
}

// 导出单例
export const router = new SPARouter();
```

---

### 3. 改造 provider-config.html

**步骤 1**：创建内容版本（不带壳层）
新建 `backend/frontend/v2/provider-config-content.html`：

```html
<!-- 只包含主内容，用于 SPA 动态加载 -->
<div class="v2-shell-main" data-spa-content="providers">
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

  <div class="v2-content-wrap">
    <section class="provider-page-hero">
      <div>
        <p class="eyebrow">Provider Control</p>
        <h1>接口配置</h1>
        <p>读写、测试、删除、恢复默认。</p>
      </div>
    </section>

    <section id="providerGrid" class="provider-grid" aria-live="polite"></section>
  </div>
</div>

<footer id="providerActionDock" class="action-dock glass-panel">
  <!-- ... -->
</footer>

<script>
  // 标记未保存状态
  window.addEventListener('provider:unsaved-change', () => {
    window.providerConfigUnsaved = true;
  });
  window.addEventListener('provider:saved', () => {
    window.providerConfigUnsaved = false;
  });
</script>
```

**步骤 2**：修改原 `provider-config.html` 作为备用
保留完整版本作为无 JS 时的 fallback 和直接访问入口。

---

### 4. 改造 provider-config.js

导出可重复初始化的函数：

```javascript
// provider-config.js
let isInitialized = false;
let cleanupFunctions = [];

export async function initSPA() {
  // 如果已初始化，先清理
  if (isInitialized) {
    cleanup();
  }
  
  // 重置状态
  state.rows = [];
  state.testResults = {};
  
  // 重新获取 DOM 引用
  refs.grid = document.getElementById('providerGrid');
  refs.status = document.getElementById('providerPageStatus');
  // ...
  
  // 绑定事件
  bindEvents();
  
  // 注册清理函数
  cleanupFunctions.push(() => {
    // 解绑事件、清理定时器等
  });
  
  // 加载数据
  await loadRows();
  
  isInitialized = true;
}

function cleanup() {
  cleanupFunctions.forEach(fn => fn());
  cleanupFunctions = [];
  isInitialized = false;
}

// 监听页面离开事件
window.addEventListener('spa:page-leave', cleanup);

// 原有的初始化逻辑改为可选
if (!window.spaMode) {
  init();
}
```

---

### 5. 改造 index.html 作为 SPA 壳层

```html
<!DOCTYPE html>
<html class="dark" lang="zh-CN">
<head>
  <!-- ... 原有 head 内容 ... -->
  <script type="module">
    import { router } from './assets/js/shared/spa-router.js?v=20260320-spa1';
    window.spaRouter = router;
  </script>
</head>
<body data-page="dashboard">
  <!-- 背景 -->
  <div class="crystalline-bg" aria-hidden="true">...</div>
  
  <!-- 固定侧栏 -->
  <aside id="sideNav" class="...">...</aside>
  
  <!-- SPA 内容容器 -->
  <div id="spaContainer" class="spa-content-wrapper">
    <!-- 默认加载工作台内容 -->
    <main class="app-main flex flex-col min-h-screen">
      <!-- 工作台完整内容 -->
    </main>
  </div>
  
  <!-- 全局 loading -->
  <div id="spaLoader" class="spa-loader">
    <div class="loader-spinner"></div>
  </div>
  
  <!-- 工作台脚本 -->
  <script type="module" src="./assets/js/pages/dashboard.js?v=20260320-spa1"></script>
</body>
</html>
```

---

### 6. 样式统一

由于两页原来使用不同样式方案，需要统一：

**方案 A**：在 SPA 模式下两页都使用 Tailwind
- 优点：一致性好
- 缺点：需要把 provider-config 的自定义样式转为 Tailwind 类

**方案 B**：保留各自样式，通过 scoped 隔离
- 优点：改动小
- 缺点：可能有冲突

**推荐方案 A**，逐步迁移：

```css
/* provider-config-spa.css - 适配 SPA 的样式 */
@scope (#spaContainer [data-spa-content="providers"]) {
  /* 只作用于 provider-config 内容 */
  .provider-card { ... }
  .provider-grid { ... }
}
```

---

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/frontend/v2/assets/js/shared/spa-router.js` | 新增 | SPA 路由系统 |
| `backend/frontend/v2/index.html` | 大幅修改 | 改为 SPA 壳层 |
| `backend/frontend/v2/provider-config.html` | 修改 | 简化或改为备用 |
| `backend/frontend/v2/provider-config-content.html` | 新增 | 纯内容模板 |
| `backend/frontend/v2/assets/js/pages/provider-config.js` | 修改 | 支持 SPA 初始化 |
| `backend/frontend/v2/assets/js/pages/dashboard.js` | 修改 | 支持 SPA 初始化 |
| `backend/frontend/v2/assets/css/pages/provider-config-spa.css` | 新增 | SPA 模式专用样式 |

---

## 实施步骤

### 阶段 1：基础设施（2 小时）
1. 创建 `spa-router.js`
2. 修改 `index.html` 添加 SPA 容器和脚本引入
3. 创建 `provider-config-content.html`

### 阶段 2：页面改造（2-3 小时）
1. 修改 `provider-config.js` 支持 `initSPA()`
2. 修改 `dashboard.js` 支持 `initSPA()`
3. 测试路由切换

### 阶段 3：优化（1-2 小时）
1. 添加过渡动画
2. 实现状态保存/恢复
3. 处理边界情况（404、加载失败等）

### 阶段 4：测试（2 小时）
1. 浏览器前进后退
2. 表单未保存提示
3. 网络慢/失败场景
4. 移动端测试

---

## 边界情况处理

### 1. 表单未保存
```javascript
// provider-config.js
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// SPA 路由内的检查
hasUnsavedChanges() {
  return document.body.dataset.page === 'providers' && 
         state.rows.some(row => row.isDirty);
}
```

### 2. 加载失败降级
```javascript
async loadContent(path) {
  try {
    return await this.fetchContent(path);
  } catch (error) {
    // 失败后使用传统跳转
    window.location.href = path;
  }
}
```

### 3. 浏览器兼容性
- 使用原生 ES6 Modules（Chrome 61+, Firefox 60+, Safari 10.1+）
- 对旧浏览器提供降级：直接跳转

---

## 优点

- ✅ 真正的无刷新体验
- ✅ 状态完全保留（滚动、搜索、表单）
- ✅ 可以预加载内容
- ✅ 动画流畅可控
- ✅ 更好的移动端体验

## 风险与挑战

- ⚠️ 改动较大，需要充分测试
- ⚠️ SEO 受影响（如果需要的话）
- ⚠️ 首次加载稍大（需要加载路由系统）
- ⚠️ 调试复杂度增加

---

## 与简单版对比

| 特性 | 简单版 | 完整版 |
|------|--------|--------|
| 实现复杂度 | 低 | 高 |
| 用户体验 | 良好 | 优秀 |
| 状态保留 | 部分 | 完整 |
| 开发时间 | 1-2 小时 | 6-8 小时 |
| 风险 | 低 | 中 |
| 维护成本 | 低 | 中 |

---

## 建议实施顺序

1. **先实施简单版**：快速验证效果，收集反馈
2. **观察使用情况**：如果用户频繁切换页面，再考虑完整版
3. **渐进升级**：简单版可以逐步增强到完整版，不用重写

---

## 附录：性能优化建议

1. **预加载**：hover 侧栏链接 200ms 后开始预加载
2. **骨架屏**：内容加载前显示骨架占位
3. **代码分割**：dashboard 和 provider-config 拆分为独立 chunk
4. **Service Worker**：离线缓存（可选）
