import { useEffect, useRef, useCallback, useState } from "react";
import * as pdfjsLib from "../../shared/vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../../shared/vendor/pdfjs/pdf.worker.mjs",
  import.meta.url,
).toString();

const SCALE = 1.35;

interface TextItem {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

interface PdfViewerProps {
  url: string;
  onSelection: (text: string) => void;
  className?: string;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function multiplyTransform(t1: number[], t2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = t1;
  const [a2, b2, c2, d2, e2, f2] = t2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function PdfViewer({ url, onSelection, className }: PdfViewerProps) {
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
          const viewport = page.getViewport({ scale: SCALE });
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

          const textLayer = document.createElement("div");
          textLayer.className = "v35-pdf-text-layer";

          surface.appendChild(canvas);
          surface.appendChild(textLayer);
          pageEl.appendChild(meta);
          pageEl.appendChild(surface);
          container.appendChild(pageEl);

          await page.render({ canvasContext: ctx, viewport }).promise;

          const textContent = await page.getTextContent();
          const items = extractTextItems(
            textContent.items as PdfTextItem[],
            viewport.transform,
          );

          const fragment = document.createDocumentFragment();
          for (const item of items) {
            const span = document.createElement("span");
            span.className = "v35-pdf-text-span";
            span.style.left = `${item.left}px`;
            span.style.top = `${item.top}px`;
            span.style.width = `${item.width}px`;
            span.style.height = `${item.height}px`;
            span.style.fontSize = `${item.fontSize}px`;
            span.textContent = item.text;
            fragment.appendChild(span);
          }
          textLayer.appendChild(fragment);
        }
      } catch (err) {
        if (token !== renderTokenRef.current) return;
        const message = err instanceof Error ? err.message : "PDF 渲染失败";
        setError(message);
      } finally {
        try { loadingTask.destroy(); } catch { /* ok */ }
      }
    },
    [url],
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

function extractTextItems(
  items: PdfTextItem[],
  viewportTransform: number[],
): TextItem[] {
  const result: TextItem[] = [];
  const viewportScale = Math.abs(viewportTransform[0]);

  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const tx = multiplyTransform(viewportTransform, item.transform);

    const scaleX = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
    const fontSize = Math.max(scaleX, 1);

    const scaledItemHeight = Math.max(viewportScale * (item.height || 0), fontSize);
    const left = tx[4];
    const top = tx[5] - scaledItemHeight;

    const width = Math.max(
      (item.width || fontSize * item.str.length * 0.55) * viewportScale + 4,
      4,
    );

    result.push({
      text: item.str,
      left: Math.round(left * 100) / 100,
      top: Math.round(top * 100) / 100,
      width: Math.round(width * 100) / 100,
      height: Math.round(scaledItemHeight * 100) / 100,
      fontSize: Math.round(fontSize * 100) / 100,
    });
  }

  return result;
}
