import { useMemo, type CSSProperties } from "react";

import { isDesktopShell } from "../../shared/lib/runtime";
import type { KeywordStat, WorkbenchStats } from "./types";

interface LibraryBannerProps {
  workspaceId: string;
  keywords: KeywordStat[];
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

function keywordOrderScore(workspaceId: string, keyword: string): number {
  const seed = `${workspaceId}:${keyword}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function keywordCloudStyle(item: KeywordStat, maxCount: number): CSSProperties {
  const ratio = maxCount > 0 ? item.count / maxCount : 0;
  const weight = Math.round(480 + ratio * 320);
  return {
    ["--v35-keyword-weight" as string]: weight,
  } as CSSProperties;
}

export function LibraryBanner({ workspaceId, keywords, stats, statusText }: LibraryBannerProps) {
  const desktopShell = isDesktopShell();
  const keywordRows = useMemo(() => {
    const sourceRows = keywords.length > 0 ? keywords : [
      { keyword: "暂无关键词", count: 1 },
      { keyword: "先上传并索引文献", count: 1 },
    ];
    const rankedRows = [...sourceRows].sort((left, right) => right.count - left.count);
    const maxCount = Math.max(...rankedRows.map((item) => item.count), 1);
    const randomizedRows = rankedRows
      .map((item, index) => ({
        ...item,
        tone: keywordTone(index),
        style: desktopShell ? keywordCloudStyle(item, maxCount) : undefined,
        orderScore: keywordOrderScore(workspaceId, item.keyword),
      }))
      .sort((left, right) => left.orderScore - right.orderScore);
    const lines = [[], []] as Array<typeof randomizedRows>;
    randomizedRows.forEach((item, index) => {
      lines[index % 2].push(item);
    });
    return lines;
  }, [desktopShell, keywords, workspaceId]);

  return (
    <section className="v35-library-banner" aria-label="文库概览">
      <div>
        <p className="v35-banner-kicker">Workspace · {workspaceId}</p>
        <div className="v35-keyword-cloud" aria-label="当前工作空间关键词词云">
          {keywordRows.map((line, lineIndex) => (
            <div key={`line_${lineIndex}`} className="v35-keyword-cloud-row">
              {line.map((item) => (
                <span
                  key={item.keyword}
                  className={`v35-keyword ${item.tone}${desktopShell ? " is-desktop-cloud" : ""}`}
                  style={item.style}
                >
                  {item.keyword}
                </span>
              ))}
            </div>
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
