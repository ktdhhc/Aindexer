import { cancelTranslationRequest, translateSelection } from './api.js';
import { setPreviewPage, viewerState, viewerEls } from './viewer.js';
import { bindCancel, bindThinkingToggle, setThinkingEnabled, toggleThinking, sidepanelEls, showCancelled, showLoading, showResult, showError, isThinkingEnabled } from './sidepanel.js';

export const selectionState = {
  lastSelectionId: 0,
  activeController: null,
  activeClientRequestId: null,
};

export function initSelection() {
  viewerEls.viewerContent.addEventListener('mouseup', handleSelection);
  bindCancel(handleCancel);
  bindThinkingToggle(handleThinkingToggle);
  setThinkingEnabled(true);
}

function handleThinkingToggle() {
  toggleThinking();
}

export async function handleSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !viewerState.currentDocId) return;

  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range) return;

  const container = range.commonAncestorContainer;
  const selectionRoot =
    container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
  const textLayer = selectionRoot?.closest('.pdf-text-layer');
  if (!textLayer) return;

  const text = normalizeSelectedText(selection.toString());
  if (!text) return;

  const pageContainer = selectionRoot.closest('.pdf-preview-page');
  const pageNumber = Number.parseInt(pageContainer?.dataset.page || '1', 10) || 1;
  const selectionId = ++selectionState.lastSelectionId;
  const controller = new AbortController();
  const clientRequestId = globalThis.crypto?.randomUUID?.() || `treq_${Date.now()}_${selectionId}`;

  if (selectionState.activeClientRequestId) {
    cancelTranslationRequest(selectionState.activeClientRequestId).catch((err) => {
      console.warn('Failed to cancel superseded translation request:', err);
    });
  }
  selectionState.activeController?.abort();
  selectionState.activeController = controller;
  selectionState.activeClientRequestId = clientRequestId;

  setPreviewPage(pageNumber);
  showLoading();

  try {
    const payload = {
      document_id: viewerState.currentDocId,
      provider: sidepanelEls.providerSelect.value,
      source_text: text,
      target_lang: 'zh-CN',
      anchor: {
        page: pageNumber,
        quote: text,
        version: 'v1',
      },
      enable_thinking: isThinkingEnabled(),
      metadata: {
        client_request_id: clientRequestId,
      },
    };

    const result = await translateSelection(payload, { signal: controller.signal });
    if (selectionId !== selectionState.lastSelectionId) return;
    clearActiveRequest();
    showResult(result);
  } catch (err) {
    if (selectionId !== selectionState.lastSelectionId) return;
    if (err?.name === 'AbortError') {
      showCancelled();
      return;
    }
    clearActiveRequest();
    showError(err);
  }
}

function normalizeSelectedText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function handleCancel() {
  const clientRequestId = selectionState.activeClientRequestId;
  const controller = selectionState.activeController;
  if (!clientRequestId || !controller) return;

  selectionState.lastSelectionId += 1;

  try {
    await cancelTranslationRequest(clientRequestId);
  } catch (err) {
    console.warn('Failed to signal backend cancellation:', err);
  }
  controller.abort();
  clearActiveRequest();
  showCancelled();
}

function clearActiveRequest() {
  selectionState.activeController = null;
  selectionState.activeClientRequestId = null;
}
