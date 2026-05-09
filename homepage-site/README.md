# Homepage Site

这是产品介绍主页的正式静态站点版本，适合直接部署到 Cloudflare Pages。

## 目录结构

- `index.html`：产品介绍首页
- `guide/index.html`：使用说明页
- `assets/styles.css`：共享样式
- `assets/main.js`：暗色模式与 guide 目录交互
- `assets/brand-mark.svg`：站点图标
- `_headers`：Cloudflare Pages 响应头配置

## Cloudflare Pages

部署时将 `homepage-site/` 作为发布目录即可。

- Build command: 留空
- Output directory: `homepage-site`
