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
}

export function PdfViewer({
  url,
  onSelection,
  className,
  selectionMode = "layout",
  scale = DEFAULT_SCALE,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [, setError] = useState("");

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
      } catch (err) {
        if (token !== renderTokenRef.current) return;
        const message = err instanceof Error ? err.message : "PDF 渲染失败";
        setError(message);
      } finally {
        try { loadingTask.destroy(); } catch { /* ok */ }
      }
    },
    [url, scale, selectionMode],
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
        const text = String(selection.toString() || "")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length >= 40) {
          onSelection(text);
        }
      }, 0);
    };

    container.addEventListener("mouseup", handler);
    return () => container.removeEventListener("mouseup", handler);
  }, [onSelection]);

  return <div ref={containerRef} className={className} />;
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
