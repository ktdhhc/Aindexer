import type { WorkbenchStats } from "./types";

interface LibraryBannerProps {
  workspaceId: string;
  keywords: string[];
  stats: WorkbenchStats;
  statusText: string;
}

function keywordTone(index: number): "xl" | "lg" | "md" | "sm" {
  if (index < 2) {
    return "xl";
  }
  if (index < 5) {
    return "lg";
  }
  if (index < 8) {
    return "md";
  }
  return "sm";
}

export function LibraryBanner({ workspaceId, keywords, stats, statusText }: LibraryBannerProps) {
  const rows = keywords.length > 0 ? keywords : ["暂无关键词", "先上传并索引文献"];

  return (
    <section className="v35-library-banner" aria-label="文库概览">
      <div>
        <p className="v35-banner-kicker">Workspace · {workspaceId}</p>
        <div className="v35-keyword-cloud" aria-label="当前工作空间关键词词云">
          {rows.map((keyword, index) => (
            <span key={`${keyword}_${index}`} className={`v35-keyword ${keywordTone(index)}`}>
              {keyword}
            </span>
          ))}
        </div>
        <div className="v35-banner-meta">
          <span><strong>{stats.total}</strong> 篇文献</span>
          <span><strong>{stats.review}</strong> 待审核</span>
          <span><strong>{stats.running}</strong> 处理中</span>
          <span><strong>{stats.indexed}</strong> 已索引</span>
        </div>
      </div>

      <div className="v35-banner-aside">
        <p className="v35-banner-status">{statusText || "准备就绪"}</p>
      </div>
    </section>
  );
}
