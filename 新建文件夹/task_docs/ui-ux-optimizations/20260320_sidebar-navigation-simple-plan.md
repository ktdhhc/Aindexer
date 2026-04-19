# 侧栏导航优化方案（简单版）：过渡动画 + 状态记忆

## 方案概述
保留页面刷新机制，通过过渡动画改善感知体验，同时用 localStorage 记住页面状态，返回时能恢复。

**改动范围**：小，只涉及交互层，不改动页面结构
**开发周期**：1-2 小时
**风险等级**：低

---

## 核心策略

### 1. 全局过渡动画
在页面切换时显示加载遮罩，新页面淡入，减少"闪白"感。

```
点击侧栏链接
  ↓
显示全屏遮罩 + 旋转 loading 图标（300ms）
  ↓
正常跳转（浏览器刷新）
  ↓
新页面 DOM 加载完成
  ↓
内容区域从 opacity:0 淡入到 opacity:1（200ms）
  ↓
隐藏 loading 遮罩
```

**实现文件**：
- `backend/frontend/v2/assets/js/shared/page-transition.js`（新建）
- 修改 `backend/frontend/v2/index.html` 和 `provider-config.html`

**关键代码**：
```javascript
// page-transition.js
class PageTransition {
  constructor() {
    this.loader = null;
    this.init();
  }
  
  init() {
    // 页面加载完成后执行淡入
    window.addEventListener('DOMContentLoaded', () => {
      this.fadeIn();
      this.restoreState();
    });
    
    // 拦截侧栏链接点击
    document.querySelectorAll('#sideNav a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.saveState();
        this.showLoader(() => {
          window.location.href = link.href;
        });
      });
    });
  }
  
  showLoader(callback) {
    // 创建全屏遮罩
    this.loader = document.createElement('div');
    this.loader.className = 'page-loader';
    this.loader.innerHTML = `
      <div class="loader-spinner"></div>
      <div class="loader-text">加载中...</div>
    `;
    document.body.appendChild(this.loader);
    
    // 300ms 后执行跳转
    setTimeout(callback, 300);
  }
  
  fadeIn() {
    document.body.style.opacity = '0';
    requestAnimationFrame(() => {
      document.body.style.transition = 'opacity 200ms ease';
      document.body.style.opacity = '1';
    });
  }
  
  saveState() {
    // 保存当前页面状态到 localStorage
    const state = {
      scrollY: window.scrollY,
      timestamp: Date.now(),
      path: window.location.pathname
    };
    
    // 页面特定的状态
    if (document.body.dataset.page === 'dashboard') {
      state.searchKeyword = document.getElementById('searchInput')?.value || '';
      state.searchSort = document.getElementById('searchSortTypeBtn')?.textContent || '';
    }
    
    localStorage.setItem('aindexer_page_state', JSON.stringify(state));
  }
  
  restoreState() {
    const saved = localStorage.getItem('aindexer_page_state');
    if (!saved) return;
    
    const state = JSON.parse(saved);
    
    // 检查是否是同一页面的返回（5分钟内）
    const isRecent = Date.now() - state.timestamp < 5 * 60 * 1000;
    const isDifferentPage = state.path !== window.location.pathname;
    
    if (isRecent && isDifferentPage) {
      // 从其他页面返回，恢复滚动位置
      window.scrollTo(0, state.scrollY || 0);
      
      // 恢复搜索状态（仅工作台）
      if (document.body.dataset.page === 'dashboard' && state.searchKeyword) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
          searchInput.value = state.searchKeyword;
          // 可选：自动触发搜索
          // document.getElementById('searchBtn')?.click();
        }
      }
    }
    
    // 清理过期状态
    localStorage.removeItem('aindexer_page_state');
  }
}

new PageTransition();
```

**配套 CSS**（添加到 `provider-shell.css`）：
```css
.page-loader {
  position: fixed;
  inset: 0;
  background: rgba(6, 14, 32, 0.95);
  backdrop-filter: blur(10px);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.loader-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(137, 206, 255, 0.2);
  border-top-color: #89ceff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loader-text {
  color: #89ceff;
  font-size: 0.875rem;
  letter-spacing: 0.1em;
}
```

---

### 2. 侧栏链接视觉反馈
在点击瞬间给侧栏添加"激活中"状态，让用户感知到操作被响应。

```css
/* 点击时的瞬时反馈 */
#sideNav a.is-navigating {
  opacity: 0.6;
  pointer-events: none;
}

#sideNav a.is-navigating::after {
  content: '';
  position: absolute;
  right: 12px;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(137, 206, 255, 0.3);
  border-top-color: #89ceff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
```

---

### 3. 记住并恢复滚动位置
通过 localStorage 记住每个页面的滚动位置，返回时自动恢复。

```javascript
// 页面卸载前保存滚动位置
window.addEventListener('beforeunload', () => {
  const scrollStates = JSON.parse(localStorage.getItem('aindexer_scroll_states') || '{}');
  scrollStates[window.location.pathname] = {
    y: window.scrollY,
    time: Date.now()
  };
  localStorage.setItem('aindexer_scroll_states', JSON.stringify(scrollStates));
});

// 页面加载时恢复滚动位置（简单版：只恢复最近5分钟内的）
window.addEventListener('DOMContentLoaded', () => {
  const scrollStates = JSON.parse(localStorage.getItem('aindexer_scroll_states') || '{}');
  const state = scrollStates[window.location.pathname];
  
  if (state && Date.now() - state.time < 5 * 60 * 1000) {
    window.scrollTo(0, state.y);
  }
});
```

---

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/frontend/v2/assets/js/shared/page-transition.js` | 新增 | 过渡动画和状态记忆逻辑 |
| `backend/frontend/v2/assets/css/pages/provider-shell.css` | 修改 | 添加 loading 遮罩样式 |
| `backend/frontend/v2/index.html` | 修改 | 引入 page-transition.js |
| `backend/frontend/v2/provider-config.html` | 修改 | 引入 page-transition.js |

---

## 实施步骤

1. **创建 `page-transition.js`**
   - 复制上面的代码
   - 调整选择器匹配实际 DOM 结构

2. **添加 CSS 样式**
   - 在 `provider-shell.css` 末尾添加 loading 样式

3. **修改 HTML 引入**
   - 在两页底部 `</body>` 前添加：
   ```html
   <script src="./assets/js/shared/page-transition.js?v=20260320-simple1"></script>
   ```

4. **测试验证**
   - 点击侧栏切换，观察 loading 动画
   - 滚动后切换页面，返回检查位置是否恢复
   - 工作台输入搜索词后切换，返回检查是否保留

---

## 优点

- ✅ 改动小，风险低
- ✅ 不改动页面结构
- ✅ 渐进增强，失败 gracefully（没 JS 也能正常工作）
- ✅ 用户体验明显改善（有反馈、有记忆）

## 局限性

- ⚠️ 仍然是整页刷新，网络慢时体验一般
- ⚠️ 表单填写一半切换页面会丢失（需要额外做表单状态保存）
- ⚠️ 动画时间固定，无法根据实际加载速度调整

---

## 后续可升级方向

如果简单版方案验证有效，可以逐步升级：
1. 增加预加载（hover 侧栏链接时 prefetch 目标页）
2. 使用 Turbo/Turbolinks 替换自研方案
3. 过渡到完整版 SPA 架构（见另一份方案）
