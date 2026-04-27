import { setPreviewPage, viewerState, viewerEls } from './viewer.js';

export const searchState = {
  query: '',
  results: [],
  currentIndex: -1,
};

export const searchEls = {
  searchInput: document.getElementById('searchInput'),
  searchCount: document.getElementById('searchCount'),
  searchPrevBtn: document.getElementById('searchPrevBtn'),
  searchNextBtn: document.getElementById('searchNextBtn'),
};

export function initSearch() {
  searchEls.searchInput.addEventListener('input', handleSearch);
  searchEls.searchPrevBtn.addEventListener('click', () => navigateSearch(-1));
  searchEls.searchNextBtn.addEventListener('click', () => navigateSearch(1));
}

export function handleSearch() {
  const query = searchEls.searchInput.value.trim();
  searchState.query = query;

  clearSearchDecorations();

  if (!query || !viewerState.pages.length) {
    clearSearchState();
    return;
  }

  const regex = new RegExp(escapeRegExp(query), 'gi');
  searchState.results = [];

  for (const page of viewerState.pages) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(page.textContent)) !== null) {
      searchState.results.push({
        pageNumber: page.pageNumber,
        start: match.index,
        end: match.index + match[0].length,
      });
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }

  applySearchHighlights();

  if (searchState.results.length === 0) {
    clearSearchState();
    searchEls.searchCount.textContent = '0/0';
    return;
  }

  searchState.currentIndex = 0;
  searchEls.searchCount.textContent = `1/${searchState.results.length}`;
  highlightCurrentSearch();
}

export function clearSearch() {
  clearSearchDecorations();
  clearSearchState();
}

export function navigateSearch(direction) {
  if (searchState.results.length === 0) return;

  searchState.currentIndex += direction;
  if (searchState.currentIndex >= searchState.results.length) {
    searchState.currentIndex = 0;
  } else if (searchState.currentIndex < 0) {
    searchState.currentIndex = searchState.results.length - 1;
  }

  searchEls.searchCount.textContent = `${searchState.currentIndex + 1}/${searchState.results.length}`;
  highlightCurrentSearch();
}

export function highlightCurrentSearch() {
  viewerEls.viewerContent
    .querySelectorAll('.pdf-text-span.search-active')
    .forEach((node) => node.classList.remove('search-active'));

  if (searchState.currentIndex < 0 || searchState.currentIndex >= searchState.results.length) {
    return;
  }

  const result = searchState.results[searchState.currentIndex];
  const spans = getIntersectingSpans(result.pageNumber, result.start, result.end);
  spans.forEach((span) => span.classList.add('search-active'));

  setPreviewPage(result.pageNumber);
  spans[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applySearchHighlights() {
  searchState.results.forEach((result) => {
    const spans = getIntersectingSpans(result.pageNumber, result.start, result.end);
    spans.forEach((span) => span.classList.add('search-hit'));
  });
}

function getIntersectingSpans(pageNumber, start, end) {
  return Array.from(
    viewerEls.viewerContent.querySelectorAll(
      `.pdf-preview-page[data-page="${pageNumber}"] .pdf-text-span`
    )
  ).filter((span) => {
    const spanStart = Number.parseInt(span.dataset.start || '0', 10);
    const spanEnd = Number.parseInt(span.dataset.end || '0', 10);
    return spanStart < end && spanEnd > start;
  });
}

function clearSearchDecorations() {
  viewerEls.viewerContent
    .querySelectorAll('.pdf-text-span.search-hit, .pdf-text-span.search-active')
    .forEach((node) => node.classList.remove('search-hit', 'search-active'));
}

function clearSearchState() {
  searchEls.searchCount.textContent = '';
  searchState.results = [];
  searchState.currentIndex = -1;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
