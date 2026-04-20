export function TranslatorPage() {
  return (
    <section className="v3-page">
      <header className="v3-page-header">
        <h1 className="v3-page-title">翻译工作区</h1>
        <p className="v3-page-subtitle">该页面将承接 PDF 预览、文本选区翻译、历史追溯和翻译 Provider 配置。</p>
      </header>

      <div className="v3-workspace-preview">
        <article className="v3-card">
          <h2 className="v3-card-title">文档预览区（占位）</h2>
          <p className="v3-muted">后续接入 pdf.js 预览、文本层选择和搜索高亮。</p>
        </article>
        <article className="v3-card">
          <h2 className="v3-card-title">翻译侧栏（占位）</h2>
          <p className="v3-muted">后续接入选区翻译、缓存标记、耗时指标和历史记录。</p>
        </article>
      </div>
    </section>
  );
}
