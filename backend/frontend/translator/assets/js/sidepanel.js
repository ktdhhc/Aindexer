export const sidepanelEls = {
  targetLanguageSelect: document.getElementById('targetLanguageSelect'),
  providerSelect: document.getElementById('providerSelect'),
  thinkingToggleBtn: document.getElementById('thinkingToggleBtn'),
  cancelTranslationBtn: document.getElementById('cancelTranslationBtn'),
  sidepanelEmpty: document.getElementById('sidepanelEmpty'),
  sidepanelLoading: document.getElementById('sidepanelLoading'),
  sidepanelError: document.getElementById('sidepanelError'),
  sidepanelErrorText: document.getElementById('sidepanelErrorText'),
  sidepanelContent: document.getElementById('sidepanelContent'),
  sourceText: document.getElementById('sourceText'),
  translatedText: document.getElementById('translatedText'),
  translationCached: document.getElementById('translationCached'),
  translationMetrics: document.getElementById('translationMetrics'),
};

export const thinkingState = {
  enabled: false,
};

export function isThinkingEnabled() {
  return thinkingState.enabled;
}

export function toggleThinking() {
  thinkingState.enabled = !thinkingState.enabled;
  updateThinkingButton();
}

function updateThinkingButton() {
  const btn = sidepanelEls.thinkingToggleBtn;
  if (thinkingState.enabled) {
    btn.classList.remove('text-slate-400', 'bg-surface-container-high/40', 'cursor-not-allowed');
    btn.classList.add('text-primary', 'bg-primary/20', 'border-primary/40');
    btn.title = 'Extended reasoning mode enabled';
  } else {
    btn.classList.add('text-slate-400', 'bg-surface-container-high/40', 'cursor-not-allowed');
    btn.classList.remove('text-primary', 'bg-primary/20', 'border-primary/40');
    btn.title = 'Enable extended reasoning mode';
  }
}

export function showLoading() {
  sidepanelEls.sidepanelEmpty.classList.add('hidden');
  sidepanelEls.sidepanelError.classList.add('hidden');
  sidepanelEls.sidepanelContent.classList.add('hidden');
  sidepanelEls.sidepanelLoading.classList.remove('hidden');
  sidepanelEls.sidepanelLoading.classList.add('flex');
  sidepanelEls.translationMetrics.textContent = '';
  setCancelEnabled(true);
  setThinkingEnabled(false);
}

export function showResult(result) {
  sidepanelEls.sidepanelLoading.classList.add('hidden');
  sidepanelEls.sidepanelLoading.classList.remove('flex');
  sidepanelEls.sidepanelContent.classList.remove('hidden');
  sidepanelEls.sidepanelContent.classList.add('flex');
  setCancelEnabled(false);
  setThinkingEnabled(true);
  
  sidepanelEls.sourceText.textContent = result.source_text;
  sidepanelEls.translatedText.textContent = result.translated_text;
  sidepanelEls.translationMetrics.textContent = formatMetrics(result);
  
  if (result.cached) {
    sidepanelEls.translationCached.classList.remove('hidden');
  } else {
    sidepanelEls.translationCached.classList.add('hidden');
  }
}

export function showError(err) {
  sidepanelEls.sidepanelLoading.classList.add('hidden');
  sidepanelEls.sidepanelLoading.classList.remove('flex');
  sidepanelEls.sidepanelError.classList.remove('hidden');
  sidepanelEls.sidepanelError.classList.add('flex');
  sidepanelEls.sidepanelErrorText.textContent = err.message || 'Translation failed';
  sidepanelEls.translationMetrics.textContent = '';
  setCancelEnabled(false);
  setThinkingEnabled(true);
}

export function showCancelled(message = 'Translation cancelled.') {
  showError(new Error(message));
}

export function bindCancel(handler) {
  sidepanelEls.cancelTranslationBtn.addEventListener('click', handler);
}

export function bindThinkingToggle(handler) {
  sidepanelEls.thinkingToggleBtn.addEventListener('click', handler);
}

export function setCancelEnabled(enabled) {
  sidepanelEls.cancelTranslationBtn.disabled = !enabled;
  sidepanelEls.cancelTranslationBtn.classList.toggle('cursor-not-allowed', !enabled);
  sidepanelEls.cancelTranslationBtn.classList.toggle('text-slate-400', !enabled);
  sidepanelEls.cancelTranslationBtn.classList.toggle('text-error', enabled);
  sidepanelEls.cancelTranslationBtn.classList.toggle('border-error/40', enabled);
}

export function setThinkingEnabled(enabled) {
  sidepanelEls.thinkingToggleBtn.disabled = !enabled;
  sidepanelEls.thinkingToggleBtn.classList.toggle('cursor-pointer', enabled);
  sidepanelEls.thinkingToggleBtn.classList.toggle('cursor-not-allowed', !enabled);
  if (!thinkingState.enabled) {
    sidepanelEls.thinkingToggleBtn.classList.toggle('text-slate-400', !enabled);
  }
}

function formatMetrics(result) {
  const metrics = [
    `in ${formatNumber(result.input_tokens)}`,
    `out ${formatNumber(result.output_tokens)}`,
    `first ${formatMs(result.first_token_ms)}`,
    `total ${formatMs(result.total_duration_ms)}`,
  ];
  return metrics.join(' | ');
}

function formatNumber(value) {
  return Number.isFinite(value) ? `${Math.round(value)}` : '--';
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : '--';
}
