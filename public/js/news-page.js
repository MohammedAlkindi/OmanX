import { initCore, qs, qsa, formatDateTime, formatRelative } from './core.js';

initCore();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const state = { items: [], filter: 'all' };

const grid = qs('[data-news-grid]');
const stateEl = qs('[data-news-state]');
const updatedEl = qs('[data-news-updated]');

function showLoading() {
  stateEl.textContent = 'Loading updates…';
  stateEl.hidden = false;
  grid.hidden = true;
}

function showEmpty(message) {
  stateEl.textContent = message;
  stateEl.hidden = false;
  grid.hidden = true;
}

function showError() {
  stateEl.innerHTML = `
    <p>Couldn't load the latest updates right now.</p>
    <button type="button" class="btn-secondary" data-news-retry>Try again</button>
  `;
  stateEl.hidden = false;
  grid.hidden = true;
  qs('[data-news-retry]', stateEl)?.addEventListener('click', loadNews);
}

function hideState() {
  stateEl.hidden = true;
  grid.hidden = false;
}

const MAX_AGE_DAYS = 180;

function renderCard(item) {
  const ageMs = item.publishedDate ? Date.now() - new Date(item.publishedDate).getTime() : NaN;
  const isRecent = !Number.isNaN(ageMs) && ageMs >= 0 && ageMs <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const dateLabel = isRecent ? formatRelative(item.publishedDate) : '';
  return `
    <article class="card news-card">
      <div class="news-card-meta">
        <span class="pill">${escapeHtml(item.destination)}</span>
        <span class="news-card-category">${escapeHtml(item.category)}</span>
        ${dateLabel ? `<span class="news-card-date">${escapeHtml(dateLabel)}</span>` : ''}
      </div>
      <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      <p>${escapeHtml(item.snippet)}</p>
    </article>
  `;
}

function render() {
  const items = state.filter === 'all'
    ? state.items
    : state.items.filter((item) => item.destination === state.filter);

  if (items.length === 0) {
    grid.innerHTML = '';
    showEmpty(state.filter === 'all' ? 'No recent updates found.' : `No recent updates for ${state.filter}.`);
    return;
  }

  hideState();
  grid.innerHTML = items.map(renderCard).join('');
}

function bindFilters() {
  qsa('[data-news-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      qsa('[data-news-filter]').forEach((btn) => {
        btn.classList.remove('pill-active');
        btn.setAttribute('aria-selected', 'false');
      });
      button.classList.add('pill-active');
      button.setAttribute('aria-selected', 'true');
      state.filter = button.dataset.newsFilter;
      render();
    });
  });
}

async function loadNews() {
  showLoading();
  try {
    const res = await fetch('/api/news');
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const data = await res.json();

    if (!data.configured) {
      updatedEl.textContent = '';
      showEmpty("Live updates aren't set up for this deployment yet.");
      return;
    }

    state.items = Array.isArray(data.items) ? data.items : [];
    updatedEl.textContent = data.fetchedAt ? `Last updated ${formatDateTime(data.fetchedAt)}` : '';
    render();
  } catch {
    updatedEl.textContent = '';
    showError();
  }
}

bindFilters();
loadNews();
