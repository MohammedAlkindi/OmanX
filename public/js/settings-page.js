import { initCore, showToast, qs } from './core.js';
import { loadSettings, saveSettings } from './chat-store.js';

initCore({ page: 'settings' });

const settings = loadSettings();
const form = qs('[data-settings-form]');

Object.entries(settings).forEach(([key, value]) => {
  const field = form.elements.namedItem(key);
  if (!field) return;
  if (field.type === 'checkbox') field.checked = Boolean(value);
  else field.value = value;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const next = {
    studentName: form.studentName.value.trim() || 'Student',
    homeCampus: form.homeCampus.value.trim() || 'University partner',
    priority: form.priority.value.trim() || 'Arrival readiness',
    notifications: form.notifications.checked,
    conciseMode: form.conciseMode.checked,
  };
  saveSettings(next);
  showToast('Workspace preferences saved.');
});
