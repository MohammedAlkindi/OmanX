import { uid } from './core.js';

const CHATS_KEY = 'omanx.mindspace.chats.v1';
const ACTIVE_KEY = 'omanx.mindspace.active.v1';
const SETTINGS_KEY = 'omanx.settings.v1';

const starterReply = {
  id: uid('msg'),
  role: 'assistant',
  content: 'Welcome to OmanX. I can help you structure questions about study planning, housing, first-week setup, and safe escalation for high-stakes issues. Start with a question or use one of the guided prompts below.',
  createdAt: new Date().toISOString(),
};

export function loadChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return [createChat({ seed: true })];
    const chats = JSON.parse(raw);
    return Array.isArray(chats) && chats.length ? chats : [createChat({ seed: true })];
  } catch {
    return [createChat({ seed: true })];
  }
}

export function saveChats(chats) {
  localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
}

export function getActiveChatId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveChatId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function createChat({ title = 'New guidance session', category = 'General', seed = false } = {}) {
  const now = new Date().toISOString();
  return {
    id: uid('chat'),
    title,
    category,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    messages: seed ? [starterReply] : [],
  };
}

export function updateChat(chats, chatId, updater) {
  return chats.map((chat) => chat.id === chatId ? updater(chat) : chat);
}

export function deleteChat(chats, chatId) {
  return chats.filter((chat) => chat.id !== chatId);
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
      studentName: 'Student',
      homeCampus: 'University partner',
      priority: 'Arrival readiness',
      notifications: true,
      conciseMode: false,
    };
  } catch {
    return {
      studentName: 'Student',
      homeCampus: 'University partner',
      priority: 'Arrival readiness',
      notifications: true,
      conciseMode: false,
    };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
