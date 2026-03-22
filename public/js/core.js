const THEME_KEY = 'omanx.theme';
const TOAST_TIMEOUT = 3200;

export function initCore({ page } = {}) {
  applyStoredTheme();
  initYear();
  initNav(page);
  bindThemeToggles();
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function formatDateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(date);
}

export function formatRelative(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function showToast(message) {
  let stack = qs('[data-toast-stack]');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.dataset.toastStack = 'true';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), TOAST_TIMEOUT);
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function downloadFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function copyText(text, successMessage = 'Copied to clipboard.') {
  return navigator.clipboard.writeText(text).then(() => showToast(successMessage));
}

function applyStoredTheme() {
  const root = document.documentElement;
  const saved = localStorage.getItem(THEME_KEY);
  root.dataset.theme = saved || 'light';
}

function bindThemeToggles() {
  qsa('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const root = document.documentElement;
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
      showToast(`Theme switched to ${next} mode.`);
    });
  });
}

function initYear() {
  qsa('[data-year]').forEach((node) => {
    node.textContent = new Date().getFullYear();
  });
}

function initNav(page) {
  qsa('[data-page-link]').forEach((link) => {
    link.classList.toggle('active', link.dataset.pageLink === page);
  });

  const toggle = qs('[data-mobile-toggle]');
  const panel = qs('[data-mobile-panel]');
  if (toggle && panel) {
    toggle.addEventListener('click', () => panel.classList.toggle('open'));
  }
}
