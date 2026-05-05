import type { SearchItem } from "../../shared/api/search";
import type { KeywordStat } from "./types";

export function nextMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isRunningStatus(status: string, stage: string): boolean {
  return (
    status === "parsing" ||
    stage === "queued" ||
    stage === "llm_request" ||
    stage === "writing" ||
    stage === "cancel_requested"
  );
}

export function formatQueueStatus(status: string, stage: string): {
  label: string;
  tone: "ok" | "warn" | "error" | "muted" | "default";
} {
  if (status === "indexed") {
    return { label: "已索引", tone: "ok" };
  }
  if (status === "failed") {
    return { label: "失败", tone: "error" };
  }
  if (status === "needs_review") {
    return { label: "需审核", tone: "warn" };
  }
  if (status === "cancelled") {
    return { label: "已取消", tone: "muted" };
  }
  if (isRunningStatus(status, stage)) {
    return { label: "处理中", tone: "warn" };
  }
  return { label: "待索引", tone: "default" };
}

export function compactAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) {
    return "-";
  }
  return authors.slice(0, 3).join(" / ");
}

export function extractTopKeywords(rows: SearchItem[], limit: number): KeywordStat[] {
  const countMap = new Map<string, number>();
  for (const row of rows) {
    for (const keyword of row.keywords || []) {
      const normalized = String(keyword || "").trim();
      if (!normalized) {
        continue;
      }
      countMap.set(normalized, (countMap.get(normalized) || 0) + 1);
    }
  }
  return [...countMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(raw: string): string {
  const mathPlaceholders: string[] = [];
  const withPlaceholders = raw.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (match) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(match);
    return `%%MATH_${idx}%%`;
  });
  const escaped = escapeHtml(withPlaceholders);
  let result = escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  for (let i = 0; i < mathPlaceholders.length; i++) {
    const math = mathPlaceholders[i];
    if (math.startsWith("$$")) {
      result = result.replace(`%%MATH_${i}%%`, `<span class="v35-math-display">${escapeHtml(math.slice(2, -2))}</span>`);
    } else {
      result = result.replace(`%%MATH_${i}%%`, `<span class="v35-math-inline">${escapeHtml(math.slice(1, -1))}</span>`);
    }
  }
  return result;
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
      } else {
        closeLists();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(escapeHtml(line));
      continue;
    }

    if (!trimmed) {
      closeLists();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ul = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (ul) {
      if (!inUl) {
        if (inOl) {
          html.push("</ol>");
          inOl = false;
        }
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${renderInlineMarkdown(ul[1])}</li>`);
      continue;
    }

    const ol = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ol) {
      if (!inOl) {
        if (inUl) {
          html.push("</ul>");
          inUl = false;
        }
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${renderInlineMarkdown(ol[1])}</li>`);
      continue;
    }

    closeLists();
    if (trimmed.startsWith(">")) {
      html.push(`<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  if (inCodeBlock) {
    html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  }
  closeLists();
  return html.join("");
}
