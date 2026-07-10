import { uid } from './core.js';

const CHATS_KEY = 'omanx.mindspace.chats.v1';
const SESSION_KEY = 'omanx.session.id.v1';
let fallbackSessionId = '';

function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.error('Failed to save browser data:', err);
    return false;
  }
}

export function getSessionId() {
  let id = safeGetItem(SESSION_KEY) || fallbackSessionId;
  if (!id) {
    id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    fallbackSessionId = id;
    safeSetItem(SESSION_KEY, id);
  }
  return id;
}
const ACTIVE_KEY = 'omanx.mindspace.active.v1';
const SETTINGS_KEY = 'omanx.settings.v1';

const STARTER_CONTENT = 'Welcome to OmanX. Ask about visas, work rules, housing, insurance, scholarship rules, or first-week setup. For risky questions, OmanX will show sources and the next people to contact before you act.';

function makeStarterReply() {
  return { id: uid('msg'), role: 'assistant', content: STARTER_CONTENT, createdAt: new Date().toISOString() };
}

export function loadChats() {
  try {
    const raw = safeGetItem(CHATS_KEY);
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
  return safeSetItem(CHATS_KEY, JSON.stringify(chats));
}

export function getActiveChatId() {
  return safeGetItem(ACTIVE_KEY);
}

export function setActiveChatId(id) {
  return safeSetItem(ACTIVE_KEY, id);
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
  situation: '',
  scholarshipStatus: '',
  language: 'auto',
  destination: 'auto',
  dataConsent: false,
  webSearch: true,
};

export function loadSettings() {
  try {
    const stored = JSON.parse(safeGetItem(SETTINGS_KEY));
    return stored ? { ...SETTINGS_DEFAULTS, ...stored } : { ...SETTINGS_DEFAULTS };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSettings(settings) {
  return safeSetItem(SETTINGS_KEY, JSON.stringify(settings));
}
