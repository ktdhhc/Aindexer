import path from 'node:path';
import { pathToFileURL } from 'node:url';

class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) { names.forEach((name) => this.set.add(name)); }
  remove(...names) { names.forEach((name) => this.set.delete(name)); }
  toggle(name, force) {
    if (force === undefined) {
      if (this.set.has(name)) {
        this.set.delete(name);
        return false;
      }
      this.set.add(name);
      return true;
    }
    if (force) this.set.add(name); else this.set.delete(name);
    return force;
  }
  contains(name) { return this.set.has(name); }
}

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.classList = new FakeClassList();
    this.disabled = false;
    this.hidden = false;
    this.children = [];
    this.listeners = new Map();
    this.files = [];
    this.attributes = new Map();
    this.scrollHeight = 120;
    this.scrollTop = 0;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const arr = this.listeners.get(type) || [];
    this.listeners.set(type, arr.filter((item) => item !== listener));
  }
  dispatch(type, event = {}) {
    const arr = this.listeners.get(type) || [];
    return Promise.all(arr.map((listener) => listener({ target: this, currentTarget: this, preventDefault() {}, ...event })));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
  click() { return this.dispatch('click'); }
  focus() {}
  select() {}
  closest(selector) {
    if (selector === '[data-action]' && this.dataset.action) return this;
    if (selector === '[data-keyword]' && this.dataset.keyword) return this;
    if (selector === '[data-sort-field]' && this.dataset.sortField) return this;
    if (selector === '.sort-split' && this.dataset.sortSplitRoot) return this;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-sort-field]') {
      return this.children.filter((child) => child.dataset.sortField);
    }
    return [];
  }
  querySelector() { return null; }
  insertAdjacentHTML(_position, html) {
    this.innerHTML += html;
    this.children.push(new FakeElement());
  }
  getBoundingClientRect() {
    return { height: 100, top: 0, bottom: 100, left: 0, right: 100, width: 100 };
  }
}

global.Element = FakeElement;

const elementIds = [
  'bgFxLayer', 'dashProvider', 'dashModel', 'dashTopStatus', 'runAllBtn', 'refreshBtn',
  'exportAllBtnSide', 'importAllBtnSide', 'backupImportInput', 'footerStatus', 'dashIndexedCount',
  'dashModelCount', 'dashboardKeywordCloud', 'uploadInput', 'uploadDropBox', 'uploadEmptyState',
  'queuePanel', 'uploadDragNotice', 'uploadState', 'queueSummary', 'queueRows', 'searchInput',
  'searchBtn', 'searchSortTypeBtn', 'searchSortDirectionBtn', 'searchSortDirectionIcon',
  'searchSortMenu', 'searchState', 'searchRows', 'previewDocId', 'previewLoadBtn', 'previewState',
  'previewMarkdown', 'previewCopyBtn', 'previewExportBtn', 'previewOriginalBtn', 'previewEditBtn',
  'themeToggleBtn', 'themeToggleIcon', 'chatMessages', 'chatState', 'chatQuestion', 'chatAskBtn', 'exitAppBtn', 'editIndexModal',
  'editModalStatus', 'editModalCloseBtn', 'editModalCancelBtn', 'editModalSaveBtn', 'editDisplayName',
  'editYear', 'editGeneratedAt', 'editMarkdown'
];

const nodes = new Map(elementIds.map((id) => [id, new FakeElement(id)]));
const rootClassList = new FakeClassList();
rootClassList.add('dark');
nodes.get('chatQuestion').scrollHeight = 80;
nodes.get('searchSortMenu').children = ['created', 'year', 'display'].map((field) => {
  const el = new FakeElement('', 'button');
  el.dataset.sortField = field;
  return el;
});
nodes.get('dashboardKeywordCloud').children = [];

const backendIndicator = new FakeElement('backendIndicator');
backendIndicator.dataset.backendIndicator = '';
const sortSplitRoot = new FakeElement();
sortSplitRoot.dataset.sortSplitRoot = '1';

const documentListeners = new Map();
global.document = {
  documentElement: { classList: rootClassList },
  body: { dataset: { page: 'dashboard' }, appendChild() {}, removeChild() {} },
  createElement(tag) { return new FakeElement('', tag); },
  getElementById(id) { return nodes.get(id) || null; },
  querySelectorAll(selector) {
    if (selector === '[data-backend-indicator]') return [backendIndicator];
    return [];
  },
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    const arr = documentListeners.get(type) || [];
    documentListeners.set(type, arr.filter((item) => item !== listener));
  },
};

const windowListeners = new Map();
global.window = {
  location: { origin: 'http://127.0.0.1:8000' },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame(callback) { return setTimeout(callback, 0); },
  cancelAnimationFrame(handle) { clearTimeout(handle); },
  addEventListener(type, listener) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    const arr = windowListeners.get(type) || [];
    windowListeners.set(type, arr.filter((item) => item !== listener));
  },
  open() {},
  close() {},
  innerWidth: 1440,
  confirm() { return true; },
  localStorage: {
    store: new Map(),
    getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
    setItem(key, value) { this.store.set(key, String(value)); },
  },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
  clipboard: { writeText: async () => {} },
  },
});

global.FormData = class {
  constructor() { this.map = new Map(); }
  append(key, value) { this.map.set(key, value); }
};

global.URL.createObjectURL = () => 'blob:test';
global.URL.revokeObjectURL = () => {};
global.AbortController = AbortController;
global.getComputedStyle = () => ({ paddingBottom: '24' });
window.getComputedStyle = global.getComputedStyle;

global.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/api/providers')) {
    return new Response(JSON.stringify([
      { provider: 'openai', enabled: true, has_api_key: true, model: 'gpt-4.1-mini' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/files') && !url.includes('/display_name') && !url.includes('/upload')) {
    return new Response(JSON.stringify([
      { id: 'doc_1', filename: 'demo.pdf', display_name: 'demo.pdf', status: 'indexed', created_at: '2026-03-19T08:00:00Z', updated_at: '2026-03-19T08:10:00Z' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/search')) {
    return new Response(JSON.stringify([
      { doc_id: 'doc_1', filename: 'demo.pdf', display_name: 'demo.pdf', status: 'indexed', created_at: '2026-03-19T08:10:00Z', year: 2024, authors: ['A'], keywords: ['Memory', 'Attention'] },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/index/doc_1/markdown')) {
    return new Response(JSON.stringify({ doc_id: 'doc_1', markdown: 'Memory and attention are highlighted.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/index/doc_1') && !url.includes('/markdown')) {
    return new Response(JSON.stringify({ doc_id: 'doc_1', year: 2024, updated_at: '2026-03-19T08:10:00Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/api/system/exit')) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const moduleUrl = pathToFileURL(path.resolve('backend/frontend/v2/assets/js/pages/dashboard.js')).href;
await import(moduleUrl);
await new Promise((resolve) => setTimeout(resolve, 50));

console.log('searchRowsHTML', nodes.get('searchRows').innerHTML.length);
console.log('keywordCloudHTML', nodes.get('dashboardKeywordCloud').innerHTML.length);
console.log('previewHTML', nodes.get('previewMarkdown').innerHTML.length);
console.log('runAllListeners', (nodes.get('runAllBtn').listeners.get('click') || []).length);
console.log('uploadListeners', (nodes.get('uploadInput').listeners.get('change') || []).length);
process.exit(0);
