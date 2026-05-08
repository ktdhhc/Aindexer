import { useEffect, useRef, useCallback, useState } from "react";
import * as pdfjsLib from "../../shared/vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../../shared/vendor/pdfjs/pdf.worker.mjs",
  import.meta.url,
).toString();

const DEFAULT_SCALE = 1.35;

export type PdfSelectionMode = "layout" | "text";

interface PdfViewerProps {
  url: string;
  onSelection: (text: string) => void;
  className?: string;
  selectionMode?: PdfSelectionMode;
  scale?: number;
  initialScrollTop?: number;
  onScrollPositionChange?: (scrollTop: number) => void;
}

export function PdfViewer({
  url,
  onSelection,
  className,
  selectionMode = "layout",
  scale = DEFAULT_SCALE,
  initialScrollTop = 0,
  onScrollPositionChange,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const initialScrollTopRef = useRef(initialScrollTop);
  const [, setError] = useState("");

  useEffect(() => {
    initialScrollTopRef.current = initialScrollTop;
  }, [initialScrollTop]);

  const renderPages = useCallback(
    async (token: number) => {
      const container = containerRef.current;
      if (!container) return;

      const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
      try {
        const pdfDocument = await loadingTask.promise;
        if (token !== renderTokenRef.current) {
          await pdfDocument.destroy();
          return;
        }

        if (pdfDocRef.current) {
          await pdfDocRef.current.destroy();
        }
        pdfDocRef.current = pdfDocument;

        container.textContent = "";

        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
          if (token !== renderTokenRef.current) return;

          const page = await pdfDocument.getPage(pageNum);
          const viewport = page.getViewport({ scale });
          const pageEl = document.createElement("section");
          pageEl.className = "v35-pdf-page";
          pageEl.dataset.page = String(pageNum);

          const meta = document.createElement("div");
          meta.className = "v35-pdf-page-meta";
          meta.textContent = `Page ${pageNum}`;

          const surface = document.createElement("div");
          surface.className = "v35-pdf-surface";
          surface.style.width = `${viewport.width}px`;
          surface.style.height = `${viewport.height}px`;
          pageEl.appendChild(meta);
          pageEl.appendChild(surface);
          container.appendChild(pageEl);

          if (selectionMode === "layout") {
            const outputScale = window.devicePixelRatio || 1;
            const canvas = document.createElement("canvas");
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            canvas.style.display = "block";

            const ctx = canvas.getContext("2d", { alpha: false });
            if (!ctx) continue;
            ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

            const textLayer = document.createElement("div");
            textLayer.className = "v35-pdf-text-layer textLayer";
            textLayer.style.setProperty("--scale-factor", String(viewport.scale));

            surface.appendChild(canvas);
            surface.appendChild(textLayer);

            await page.render({ canvasContext: ctx, viewport }).promise;

            const textContent = await page.getTextContent();
            const layer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textLayer,
              viewport,
            });
            await layer.render();
          } else {
            surface.classList.add("v35-pdf-text-surface");
            const textFlow = document.createElement("div");
            textFlow.className = "v35-pdf-text-flow";
            textFlow.style.fontSize = `${Math.round((15 * scale / DEFAULT_SCALE) * 100) / 100}px`;
            textFlow.style.padding = `${Math.round((20 * scale / DEFAULT_SCALE) * 100) / 100}px ${Math.round((24 * scale / DEFAULT_SCALE) * 100) / 100}px`;

            const textContent = await page.getTextContent();
            const lines = buildPageTextLines(textContent);
            if (lines.length === 0) {
              const empty = document.createElement("p");
              empty.className = "v35-muted";
              empty.textContent = "该页暂无可提取文本";
              textFlow.appendChild(empty);
            } else {
              for (const line of lines) {
                const p = document.createElement("p");
                p.textContent = line;
                textFlow.appendChild(p);
              }
            }

            surface.appendChild(textFlow);
          }
        }

        if (token === renderTokenRef.current && initialScrollTopRef.current > 0 && containerRef.current) {
          requestAnimationFrame(() => {
            if (token !== renderTokenRef.current || !containerRef.current) return;
            containerRef.current.scrollTop = initialScrollTopRef.current;
          });
        }
      } catch (err) {
        if (token !== renderTokenRef.current) return;
        const message = err instanceof Error ? err.message : "PDF 渲染失败";
        setError(message);
      } finally {
        try { loadingTask.destroy(); } catch { /* ok */ }
      }
    },
    [selectionMode, scale, url],
  );

  useEffect(() => {
    renderTokenRef.current += 1;
    const token = renderTokenRef.current;
    setError("");
    renderPages(token);
    return () => {
      renderTokenRef.current += 1;
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy().catch(() => {});
        pdfDocRef.current = null;
      }
    };
  }, [renderPages]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        const anchor = selection.anchorNode;
        if (!anchor || !container.contains(anchor)) return;
        const text = extractSelectedText(selection, selectionMode);
        if (text) {
          onSelection(text);
        }
      }, 0);
    };

    container.addEventListener("mouseup", handler);
    return () => container.removeEventListener("mouseup", handler);
  }, [onSelection]);

  useEffect(() => {
    return () => {
      const container = containerRef.current;
      if (!container || !onScrollPositionChange) {
        return;
      }
      onScrollPositionChange(container.scrollTop);
    };
  }, [onScrollPositionChange, scale, selectionMode, url]);

  return <div ref={containerRef} className={className} />;
}

function extractSelectedText(selection: Selection, selectionMode: PdfSelectionMode): string {
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) return "";

  if (selectionMode === "layout") {
    const structured = extractStructuredLayoutSelection(range);
    if (structured) {
      return structured;
    }
  }

  if (selectionMode === "text") {
    const fragment = range.cloneContents();
    const wrapper = document.createElement("div");
    wrapper.append(fragment);
    const text = wrapper.innerText || wrapper.textContent || selection.toString() || "";
    return normalizeParagraphText(text);
  }

  return normalizeParagraphText(selection.toString() || "");
}

function extractStructuredLayoutSelection(range: Range): string {
  const commonRoot = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? (range.commonAncestorContainer as Element)
    : range.commonAncestorContainer.parentElement;
  const page = commonRoot?.closest<HTMLElement>(".v35-pdf-page");
  if (!page) {
    return "";
  }

  const spans = Array.from(page.querySelectorAll<HTMLElement>(".v35-pdf-text-layer span"))
    .filter((span) => {
      const node = span.firstChild;
      return Boolean(node) && range.intersectsNode(node as Node);
    })
    .map((span) => ({
      text: String(span.textContent || ""),
      top: readPx(span.style.top),
      left: readPx(span.style.left),
      width: readPx(span.style.width),
      height: readPx(span.style.height),
    }))
    .filter((item) => item.text.trim());

  if (spans.length === 0) {
    return "";
  }

  spans.sort((a, b) => {
    if (Math.abs(a.top - b.top) > 2) return a.top - b.top;
    return a.left - b.left;
  });

  const lines: Array<{ top: number; height: number; items: typeof spans }> = [];
  for (const span of spans) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.top - span.top) > Math.max(4, last.height * 0.55)) {
      lines.push({ top: span.top, height: span.height || 16, items: [span] });
      continue;
    }
    last.items.push(span);
    last.height = Math.max(last.height, span.height || last.height);
  }

  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    const lineText = line.items
      .sort((a, b) => a.left - b.left)
      .map((item) => item.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!lineText) continue;

    currentParagraph.push(lineText);
    if (!nextLine) {
      paragraphs.push(currentParagraph.join(" "));
      currentParagraph = [];
      continue;
    }

    const verticalGap = nextLine.top - line.top;
    const paragraphBreak = verticalGap > Math.max(line.height * 1.45, 18);
    if (paragraphBreak) {
      paragraphs.push(currentParagraph.join(" "));
      currentParagraph = [];
    }
  }

  return normalizeParagraphText(paragraphs.join("\n\n"));
}

function readPx(value: string): number {
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeParagraphText(text: string): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function buildPageTextLines(textContent: pdfjsLib.TextContent): string[] {
  const items = textContent.items as Array<{ str?: string; transform?: number[] }>;
  const lines: Array<{ y: number; text: string }> = [];

  for (const item of items) {
    const value = String(item?.str ?? "");
    if (!value.trim()) continue;
    const y = item.transform?.[5] ?? 0;

    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.y - y) > 3) {
      lines.push({ y, text: value });
      continue;
    }
    last.text += value;
  }

  return lines
    .map((line) => line.text.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}
