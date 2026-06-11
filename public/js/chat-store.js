import { uid } from './core.js';

const CHATS_KEY = 'omanx.mindspace.chats.v1';
const ACTIVE_KEY = 'omanx.mindspace.active.v1';
const SETTINGS_KEY = 'omanx.settings.v1';

const STARTER_CONTENT = 'Welcome to OmanX. I can help you structure questions about study planning, housing, first-week setup, and safe escalation for high-stakes issues. Start with a question or use one of the guided prompts below.';

function makeStarterReply() {
  return { id: uid('msg'), role: 'assistant', content: STARTER_CONTENT, createdAt: new Date().toISOString() };
}

export function loadChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return [createChat({ seed: true })];
    const chats = JSON.parse(raw);
    if (!Array.isArray(chats) || !chats.length) return [createChat({ seed: true })];
    return chats.map((chat) => ({
      ...chat,
      messages: (chat.messages || []).map((msg) => ({
        ...msg,
        content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
      })),
    }));
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

export function createChat({ title = 'New chat', category = 'General', seed = false } = {}) {
  const now = new Date().toISOString();
  return {
    id: uid('chat'),
    title,
    category,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    messages: seed ? [makeStarterReply()] : [],
  };
}

export function updateChat(chats, chatId, updater) {
  return chats.map((chat) => chat.id === chatId ? updater(chat) : chat);
}

export function deleteChat(chats, chatId) {
  return chats.filter((chat) => chat.id !== chatId);
}

const SETTINGS_DEFAULTS = {
  studentName: 'Student',
  homeCampus: 'University partner',
  priority: 'Arrival readiness',
  notifications: true,
  conciseMode: false,
  model: 'claude-sonnet-4-6',
  userContext: '',
  language: 'auto',
  dataConsent: false,
  webSearch: true,
};

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return stored ? { ...SETTINGS_DEFAULTS, ...stored } : { ...SETTINGS_DEFAULTS };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
