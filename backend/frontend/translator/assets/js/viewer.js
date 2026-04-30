import * as pdfjsLib from '../vendor/pdfjs/pdf.mjs';

import { fetchDocumentPages } from './api.js';
import { handleSearch } from './search.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../vendor/pdfjs/pdf.worker.mjs',
  import.meta.url
).toString();

const PREVIEW_SCALE = 1.35;

export const viewerState = {
  currentDocId: null,
  pages: [],
  pdfDocument: null,
  renderToken: 0,
};

export const viewerEls = {
  viewerEmpty: document.getElementById('viewerEmpty'),
  viewerError: document.getElementById('viewerError'),
  viewerErrorText: document.getElementById('viewerErrorText'),
  viewerContent: document.getElementById('viewerContent'),
};

export async function loadDocument(docId) {
  if (!docId) {
    resetViewer();
    return;
  }

  viewerState.currentDocId = docId;
  viewerState.renderToken += 1;

  viewerEls.viewerEmpty.classList.add('hidden');
  viewerEls.viewerError.classList.add('hidden');
  viewerEls.viewerError.classList.remove('flex');
  viewerEls.viewerContent.classList.add('hidden');

  try {
    viewerState.pages = [];
    renderDocumentShell();

    const [pagesResult, previewResult] = await Promise.allSettled([
      fetchDocumentPages(docId),
      renderPdfPreview(viewerState.renderToken),
    ]);

    if (previewResult.status === 'rejected') {
      throw previewResult.reason;
    }

    if (pagesResult.status === 'fulfilled') {
      viewerState.pages = normalizePageRows(pagesResult.value);
      renderPreviewTextLayers();
    } else {
      console.warn('Selectable preview text unavailable:', pagesResult.reason);
      viewerState.pages = [];
      renderTextLayerUnavailableState();
    }

    viewerEls.viewerContent.classList.remove('hidden');
    handleSearch();
  } catch (err) {
    console.error('Failed to load translator document:', err);
    viewerEls.viewerError.classList.remove('hidden');
    viewerEls.viewerError.classList.add('flex');
    viewerEls.viewerErrorText.textContent =
      err.message || 'Failed to load original PDF preview';
  }
}

function renderDocumentShell() {
  const originalUrl = buildOriginalUrl();
  viewerEls.viewerContent.innerHTML = `
    <div class="translator-viewer">
      <section class="translator-reader-card">
        <div class="translator-card-header">
          <div>
            <div class="translator-card-title">
              <span class="material-symbols-outlined text-primary">picture_as_pdf</span>
              Original PDF Preview
            </div>
            <div class="translator-card-note">Select text directly inside the preview to translate while keeping the original PDF layout visible.</div>
          </div>
          <a id="pdfOpenInNewTab" class="translator-card-note" href="${originalUrl}" target="_blank" rel="noopener noreferrer">Open source PDF</a>
        </div>
        <div class="translator-pdf-stage thin-scrollbar" id="pdfPreviewStage">
          <div class="translator-pdf-loading" id="pdfPreviewLoading">
            <span class="material-symbols-outlined text-3xl animate-spin text-primary">progress_activity</span>
            <p>Rendering PDF preview...</p>
          </div>
          <div class="translator-pdf-pages hidden" id="pdfPreviewPages"></div>
        </div>
      </section>
    </div>
  `;
}

async function renderPdfPreview(renderToken) {
  const previewPagesEl = document.getElementById('pdfPreviewPages');
  const loadingEl = document.getElementById('pdfPreviewLoading');
  if (!previewPagesEl || !loadingEl) return;

  const loadingTask = pdfjsLib.getDocument({
    url: buildOriginalUrl(),
    withCredentials: false,
  });

  try {
    const pdfDocument = await loadingTask.promise;
    if (renderToken !== viewerState.renderToken) {
      await pdfDocument.destroy();
      return;
    }

    if (viewerState.pdfDocument) {
      await viewerState.pdfDocument.destroy();
    }
    viewerState.pdfDocument = pdfDocument;

    previewPagesEl.innerHTML = '';

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      if (renderToken !== viewerState.renderToken) return;

      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: PREVIEW_SCALE });
      const pageWidth = page.view[2] - page.view[0];
      const pageHeight = page.view[3] - page.view[1];

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        throw new Error('Canvas rendering context is unavailable');
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      const pageEl = document.createElement('section');
      pageEl.className = 'pdf-preview-page page-container';
      pageEl.dataset.page = String(pageNumber);
      pageEl.dataset.scaleX = String(viewport.width / pageWidth);
      pageEl.dataset.scaleY = String(viewport.height / pageHeight);
      pageEl.innerHTML = `
        <div class="pdf-preview-page-meta">
          <span class="pdf-preview-page-label">Page ${pageNumber}</span>
        </div>
        <div class="pdf-preview-surface" style="width:${viewport.width}px; height:${viewport.height}px;">
          <div class="pdf-text-layer page-text" data-page="${pageNumber}" aria-label="Selectable PDF text"></div>
        </div>
      `;

      const surface = pageEl.querySelector('.pdf-preview-surface');
      surface.prepend(canvas);
      previewPagesEl.append(pageEl);

      await page.render({ canvasContext: context, viewport }).promise;
    }

    loadingEl.classList.add('hidden');
    previewPagesEl.classList.remove('hidden');
  } catch (error) {
    try {
      await loadingTask.destroy();
    } catch (_) {
      // Ignore cleanup failures.
    }
    throw normalizePdfError(error);
  }
}

function renderPreviewTextLayers() {
  clearTextLayerUnavailableState();

  for (const page of viewerState.pages) {
    const pageEl = viewerEls.viewerContent.querySelector(
      `.pdf-preview-page[data-page="${page.pageNumber}"]`
    );
    if (!pageEl) continue;

    const textLayer = pageEl.querySelector('.pdf-text-layer');
    if (!textLayer) continue;

    const scaleX = Number.parseFloat(pageEl.dataset.scaleX || '1') || 1;
    const scaleY = Number.parseFloat(pageEl.dataset.scaleY || '1') || 1;
    textLayer.innerHTML = '';

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < page.spans.length; index += 1) {
      const span = page.spans[index];
      const nextStart = page.spans[index + 1]?.startOffset ?? span.endOffset;
      const visibleText =
        page.textContent.slice(span.startOffset, nextStart) || span.text || '';

      const spanEl = document.createElement('span');
      spanEl.className = 'pdf-text-span';
      spanEl.dataset.page = String(page.pageNumber);
      spanEl.dataset.start = String(span.startOffset);
      spanEl.dataset.end = String(span.endOffset);
      spanEl.textContent = visibleText;

      const width = Math.max((span.x1 - span.x0) * scaleX + 8, 1);
      const height = Math.max((span.y1 - span.y0) * scaleY, 1);

      spanEl.style.left = `${span.x0 * scaleX}px`;
      spanEl.style.top = `${span.y0 * scaleY}px`;
      spanEl.style.width = `${width}px`;
      spanEl.style.height = `${height}px`;
      spanEl.style.fontSize = `${Math.max(height * 0.82, 1)}px`;
      spanEl.style.lineHeight = `${height}px`;

      fragment.append(spanEl);
    }

    textLayer.append(fragment);
  }
}

function normalizePageRows(rows) {
  return rows.map((row) => {
    const textMap = parseTextMap(row.text_map_json);
    return {
      pageNumber: Number.parseInt(row.page_number, 10) || 1,
      textContent: String(row.text_content || ''),
      spans: Array.isArray(textMap?.spans)
        ? textMap.spans.map((span) => ({
            text: String(span.text || ''),
            x0: Number(span.x0 || 0),
            y0: Number(span.y0 || 0),
            x1: Number(span.x1 || 0),
            y1: Number(span.y1 || 0),
            startOffset: Number(span.start_offset || 0),
            endOffset: Number(span.end_offset || 0),
          }))
        : [],
    };
  });
}

function parseTextMap(rawTextMap) {
  if (!rawTextMap) return null;
  if (typeof rawTextMap === 'object') return rawTextMap;
  try {
    return JSON.parse(rawTextMap);
  } catch (_) {
    return null;
  }
}

function renderTextLayerUnavailableState() {
  const pagesContainer = document.getElementById('pdfPreviewPages');
  if (!pagesContainer) return;
  let emptyState = pagesContainer.querySelector('.translator-text-layer-unavailable');
  if (!emptyState) {
    emptyState = document.createElement('div');
    emptyState.className = 'translator-text-layer-unavailable';
    emptyState.innerHTML = `
      <span class="material-symbols-outlined text-xl">search_off</span>
      <span>Selectable text is unavailable for this PDF. Preview still works, but translation selection needs a text layer.</span>
    `;
    pagesContainer.prepend(emptyState);
  }
}

function clearTextLayerUnavailableState() {
  viewerEls.viewerContent
    .querySelectorAll('.translator-text-layer-unavailable')
    .forEach((node) => node.remove());
}

export function setPreviewPage(pageNumber) {
  const previewPage = viewerEls.viewerContent.querySelector(
    `.pdf-preview-page[data-page="${pageNumber}"]`
  );
  if (!previewPage) return;

  viewerEls.viewerContent
    .querySelectorAll('.pdf-preview-page.is-active')
    .forEach((node) => node.classList.remove('is-active'));
  previewPage.classList.add('is-active');
  previewPage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function buildOriginalUrl() {
  return `/api/translation/documents/${viewerState.currentDocId}/original`;
}

async function destroyPdfDocument() {
  if (!viewerState.pdfDocument) return;
  const pdfDocument = viewerState.pdfDocument;
  viewerState.pdfDocument = null;
  await pdfDocument.destroy();
}

function resetViewer() {
  viewerState.currentDocId = null;
  viewerState.pages = [];
  viewerState.renderToken += 1;
  destroyPdfDocument().catch(() => {});
  viewerEls.viewerContent.innerHTML = '';
  viewerEls.viewerContent.classList.add('hidden');
  viewerEls.viewerError.classList.add('hidden');
  viewerEls.viewerError.classList.remove('flex');
  viewerEls.viewerEmpty.classList.remove('hidden');
}

function normalizePdfError(error) {
  if (error?.message) {
    return new Error(error.message);
  }
  return new Error('Failed to render PDF preview');
}

