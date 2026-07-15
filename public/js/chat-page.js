import { initCore, qs, qsa, formatDateTime, formatRelative, showToast, uid, downloadFile, copyText, setTheme, getTheme } from './core.js';
import { loadChats, saveChats, getActiveChatId, setActiveChatId, createChat, updateChat, deleteChat, loadSettings, saveSettings, getSessionId, getSyncUserId, setSyncUserId } from './chat-store.js';
import { getAccessToken, initAuth, onAuthChange, signInWithGoogle, signInWithMagicLink, signOut } from './auth-client.js';

const prompts = [
  { label: 'Arrival', text: 'What do I need to complete in my first 72 hours on campus?' },
  { label: 'Work rules', text: 'Can I work off campus this semester, and what facts do you need to check first?' },
  { label: 'Visa deadline', text: 'My OPT application window opens soon. What are the steps, dates, and people I need to contact?' },
  { label: 'Housing', text: 'Help me compare on-campus and off-campus housing, including costs, contracts, and risks.' },
];

function pinIcon(pinned) {
  const fill = pinned ? 'var(--gold)' : 'none';
  const stroke = pinned ? 'var(--gold)' : 'currentColor';
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
}

const state = {
  chats: loadChats(),
  activeChatId: getActiveChatId(),
  filter: '',
  typing: false,
  settings: loadSettings(),
  confirmDeleteId: null,
  usage: null,
  auth: { ready: false, enabled: false, signedIn: false, user: null },
  authGate: { visible: false, message: '', status: '', statusTone: '', sending: false },
  sync: { status: 'local', readyForUserId: '', remoteUpdatedAt: null, saving: false, queued: false, warned: false },
  pendingImages: [],
  searchStatus: '',
};

const ONBOARDED_KEY = 'omanx.onboarded.v1';
const DEST_LABEL = { auto: 'Auto', us: 'US', uk: 'UK', au: 'AU' };
const DEST_FULL_LABEL = { auto: 'Auto-detect', us: 'United States', uk: 'United Kingdom', au: 'Australia' };
const THINKING_STAGES = ['Checking your question...', 'Reading OmanX dataset...', 'Searching official sources...', 'Writing guidance...'];
const SYNC_SAVE_DELAY_MS = 900;
const AUTH_GATE_MESSAGE = "You've used your 3 guest questions. Sign in with Google or send yourself a secure sign-in link to keep asking.";

// Tracks which chatId is actively streaming; null when idle.
let streamingChatId = null;
let thinkingTimer = null;
let syncSaveTimer = null;

const feedbackState = new Map(); // messageId -> 'up' | 'down'
let storageWarningShown = false;

initCore({ page: 'chat' });
ensureActiveChat();
render();
bindEvents();
refreshUsage();
initAuth().then((auth) => {
  state.auth = auth;
  updateAuthUi();
  refreshUsage();
  handleAuthSync(auth);
  maybeShowOnboarding();
});
onAuthChange((auth) => {
  state.auth = auth;
  if (auth.signedIn) hideAuthGate();
  updateAuthUi();
  refreshUsage();
  handleAuthSync(auth);
});

// init composer height
const _initTextarea = qs('[data-chat-input]');
if (_initTextarea) autoGrow(_initTextarea);

function ensureActiveChat() {
  const existing = state.chats.find((chat) => chat.id === state.activeChatId);
  if (existing) return;
  state.activeChatId = state.chats[0]?.id || null;
  if (!state.activeChatId) {
    const chat = createChat();
    state.chats = [chat];
    state.activeChatId = chat.id;
  }
  persist();
}

function persist({ sync = true } = {}) {
  const chatsSaved = saveChats(state.chats);
  const activeSaved = setActiveChatId(state.activeChatId);
  if (!chatsSaved || !activeSaved) showStorageWarning();
  if (sync) queueChatSyncSave();
}

function persistSettings() {
  if (!saveSettings(state.settings)) showStorageWarning();
}

function showStorageWarning() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  showToast('Could not save locally. Your device storage may be full or private browsing may be blocking it.');
}

function getSyncUser() {
  return state.auth.signedIn ? state.auth.user?.id || '' : '';
}

function resetSyncState(status = 'local') {
  clearTimeout(syncSaveTimer);
  syncSaveTimer = null;
  state.sync = { status, readyForUserId: '', remoteUpdatedAt: null, saving: false, queued: false, warned: state.sync.warned };
  updateSyncUi();
}

function hasMeaningfulChats(chats) {
  return chats.some((chat) => (
    chat.pinned ||
    (chat.title && chat.title !== 'New chat') ||
    (chat.messages || []).some((message) => message.role === 'user') ||
    (chat.messages || []).length > 1
  ));
}

function normalizeIncomingChats(chats) {
  if (!Array.isArray(chats) || !chats.length) return [];
  return chats.map((chat) => ({
    ...chat,
    title: typeof chat.title === 'string' && chat.title.trim() ? chat.title : 'New chat',
    category: typeof chat.category === 'string' && chat.category.trim() ? chat.category : 'General',
    pinned: chat.pinned === true,
    messages: (chat.messages || []).map((msg) => ({
      ...msg,
      content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
    })),
  })).filter((chat) => chat.id);
}

function chatTime(chat) {
  const value = Date.parse(chat?.updatedAt || chat?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function chooseNewerChat(a, b) {
  if (!a) return b;
  if (!b) return a;
  const diff = chatTime(a) - chatTime(b);
  if (diff > 0) return a;
  if (diff < 0) return b;
  return (a.messages?.length || 0) >= (b.messages?.length || 0) ? a : b;
}

function snapshotFingerprint(chats, activeChatId) {
  return JSON.stringify({ activeChatId, chats });
}

function mergeChatSnapshots(localChats, localActiveId, remoteChats, remoteActiveId) {
  const byId = new Map();
  for (const chat of remoteChats) byId.set(chat.id, chat);
  for (const chat of localChats) {
    const existing = byId.get(chat.id);
    byId.set(chat.id, existing ? chooseNewerChat(existing, chat) : chat);
  }

  let chats = [...byId.values()].sort((a, b) => chatTime(b) - chatTime(a));
  if (!chats.length) chats = [createChat({ seed: true })];

  const localActive = chats.find((chat) => chat.id === localActiveId);
  const remoteActive = chats.find((chat) => chat.id === remoteActiveId);
  const activeChatId = chooseNewerChat(localActive, remoteActive)?.id || localActive?.id || remoteActive?.id || chats[0].id;

  return { chats, activeChatId };
}

async function requestChatSnapshot(method, body) {
  const token = await getAccessToken();
  if (!token) {
    const error = new Error('Sign in to save chat history.');
    error.code = 'auth_required';
    throw error;
  }

  const response = await fetch('/api/chats', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'Could not save chat history.');
    error.status = response.status;
    error.code = payload.code;
    error.snapshot = payload.snapshot;
    throw error;
  }

  return payload;
}

function updateSyncUi() {
  const historyLabel = qs('[data-history-storage-label]');
  const syncStatus = qs('[data-sync-status]');
  const syncNote = qs('[data-sync-note]');

  if (!state.auth.enabled) {
    if (historyLabel) historyLabel.textContent = 'Stored locally';
    if (syncStatus) syncStatus.textContent = 'Not available';
    if (syncNote) syncNote.textContent = 'Google sign-in is not ready yet, so chats stay on this device.';
    return;
  }

  if (!state.auth.signedIn) {
    if (historyLabel) historyLabel.textContent = 'Stored locally';
    if (syncStatus) syncStatus.textContent = 'Sign in to save';
    if (syncNote) syncNote.textContent = 'Your chats stay on this device until you sign in.';
    return;
  }

  const labels = {
    syncing: 'Saving',
    saving: 'Saving',
    synced: 'Saved',
    unavailable: 'Needs setup',
    error: 'Saved on device',
    local: 'Saved on device',
  };

  if (historyLabel) historyLabel.textContent = state.sync.status === 'synced' ? 'Device + account' : 'Stored locally';
  if (syncStatus) syncStatus.textContent = labels[state.sync.status] || 'Saving';
  if (syncNote) {
    syncNote.textContent = state.sync.status === 'unavailable'
      ? 'Account backup is not ready yet. Your chats are still saved on this device.'
      : 'Signed-in chats are saved to your account. Guest chats stay on this device.';
  }
}

async function handleAuthSync(auth) {
  const userId = auth?.signedIn ? auth.user?.id || '' : '';
  if (!userId) {
    resetSyncState('local');
    return;
  }

  if (state.sync.readyForUserId === userId || state.sync.status === 'syncing') {
    updateSyncUi();
    return;
  }

  state.sync.status = 'syncing';
  updateSyncUi();

  try {
    const remote = await requestChatSnapshot('GET');
    const remoteChats = normalizeIncomingChats(remote.chats);
    const localOwnerId = getSyncUserId();
    let next;

    if (localOwnerId && localOwnerId !== userId) {
      const replacementChats = remoteChats.length ? remoteChats : [createChat({ seed: true })];
      next = {
        chats: replacementChats,
        activeChatId: replacementChats.some((chat) => chat.id === remote.activeChatId) ? remote.activeChatId : replacementChats[0].id,
      };
    } else {
      const localChats = !hasMeaningfulChats(state.chats) && hasMeaningfulChats(remoteChats) ? [] : state.chats;
      next = mergeChatSnapshots(localChats, state.activeChatId, remoteChats, remote.activeChatId);
    }

    const remoteFingerprint = snapshotFingerprint(remoteChats, remote.activeChatId || '');
    const nextFingerprint = snapshotFingerprint(next.chats, next.activeChatId);
    state.chats = next.chats;
    state.activeChatId = next.activeChatId;
    state.sync.readyForUserId = userId;
    state.sync.remoteUpdatedAt = remote.updatedAt || null;
    state.sync.status = 'synced';
    setSyncUserId(userId);
    persist({ sync: false });
    render();
    updateAuthUi();

    if (remoteFingerprint !== nextFingerprint && hasMeaningfulChats(next.chats)) {
      queueChatSyncSave({ immediate: true });
    }
  } catch (error) {
    state.sync.status = error.code === 'chat_sync_not_configured' ? 'unavailable' : 'error';
    state.sync.readyForUserId = '';
    updateSyncUi();

    if (!state.sync.warned) {
      state.sync.warned = true;
      showToast(state.sync.status === 'unavailable'
        ? 'Account backup is not ready yet. Saving on this device for now.'
        : 'Could not save to your account. Saving on this device for now.');
    }
  }
}

function queueChatSyncSave({ immediate = false } = {}) {
  const userId = getSyncUser();
  if (!userId || state.sync.readyForUserId !== userId || state.sync.status === 'unavailable') return;

  clearTimeout(syncSaveTimer);
  syncSaveTimer = setTimeout(() => {
    syncSaveTimer = null;
    saveChatSnapshot();
  }, immediate ? 0 : SYNC_SAVE_DELAY_MS);
}

async function saveChatSnapshot() {
  const userId = getSyncUser();
  if (!userId || state.sync.readyForUserId !== userId || state.sync.status === 'unavailable') return;

  if (state.sync.saving) {
    state.sync.queued = true;
    return;
  }

  state.sync.saving = true;
  state.sync.status = 'saving';
  updateSyncUi();

  try {
    const payload = await requestChatSnapshot('PUT', {
      chats: state.chats,
      activeChatId: state.activeChatId,
      baseUpdatedAt: state.sync.remoteUpdatedAt,
    });
    state.sync.remoteUpdatedAt = payload.updatedAt || null;
    state.sync.status = 'synced';
    setSyncUserId(userId);
  } catch (error) {
    if (error.status === 409 && error.snapshot) {
      const remoteChats = normalizeIncomingChats(error.snapshot.chats);
      const merged = mergeChatSnapshots(state.chats, state.activeChatId, remoteChats, error.snapshot.activeChatId);
      state.chats = merged.chats;
      state.activeChatId = merged.activeChatId;
      state.sync.remoteUpdatedAt = error.snapshot.updatedAt || null;
      state.sync.status = 'synced';
      persist({ sync: false });
      render();
      state.sync.queued = true;
    } else {
      state.sync.status = error.code === 'chat_sync_not_configured' ? 'unavailable' : 'error';
      state.sync.queued = false;
      if (!state.sync.warned) {
        state.sync.warned = true;
        showToast(state.sync.status === 'unavailable'
          ? 'Account backup is not ready yet. Saving on this device for now.'
          : 'Could not save to your account. Saving on this device for now.');
      }
    }
  } finally {
    state.sync.saving = false;
    const shouldSaveAgain = state.sync.queued && state.sync.status !== 'unavailable';
    state.sync.queued = false;
    updateSyncUi();
    if (shouldSaveAgain) queueChatSyncSave({ immediate: true });
  }
}

function hasCompletedOnboarding() {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return true;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    showStorageWarning();
  }
}

function setTyping(value) {
  state.typing = value;
  state.searchStatus = '';
  const btn = qs('[data-send-btn]');
  if (btn) btn.disabled = value;
  if (value) {
    let stage = 0;
    thinkingTimer = setInterval(() => {
      stage = (stage + 1) % THINKING_STAGES.length;
      const el = qs('[data-thinking-status]');
      if (el && !state.searchStatus) el.textContent = THINKING_STAGES[stage];
    }, 1800);
  } else {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
}

function setThinkingStatus(label) {
  state.searchStatus = label || '';
  const el = qs('[data-thinking-status]');
  if (el && state.searchStatus) el.textContent = state.searchStatus;
}

function doRename(chatId, value) {
  const newTitle = value.trim();
  if (newTitle) {
    mutateChat(chatId, (current) => ({ ...current, title: newTitle, updatedAt: new Date().toISOString() }));
  }
  renderSidebar();
}

function bindEvents() {
  // — scroll to bottom button —
  const msgList = qs('[data-message-list]');
  const scrollBtn = qs('[data-scroll-bottom]');
  if (msgList && scrollBtn) {
    msgList.addEventListener('scroll', () => {
      const nearBottom = msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight < 80;
      scrollBtn.hidden = nearBottom;
    });
    scrollBtn.addEventListener('click', () => {
      msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' });
    });
  }

  // — sidebar toggle (mobile) —
  qs('[data-sidebar-toggle]')?.addEventListener('click', () => {
    qs('[data-chat-sidebar]')?.classList.toggle('open');
  });
  qs('[data-sidebar-backdrop]')?.addEventListener('click', () => {
    qs('[data-chat-sidebar]')?.classList.remove('open');
  });

  // — close item menus and sidebar on outside click —
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-item-menu-toggle]') && !event.target.closest('[data-item-menu]')) {
      qsa('[data-item-menu]').forEach((menu) => (menu.hidden = true));
    }

    const sidebar = qs('[data-chat-sidebar]');
    if (
      sidebar?.classList.contains('open') &&
      !sidebar.contains(event.target) &&
      !event.target.closest('[data-sidebar-toggle]')
    ) {
      sidebar.classList.remove('open');
    }
  });

  // — new chat —
  qsa('[data-new-chat]').forEach((button) => {
    button.addEventListener('click', () => {
      qs('[data-chat-sidebar]')?.classList.remove('open');

      const activeChat = state.chats.find((chat) => chat.id === state.activeChatId);
      const alreadyEmpty = activeChat && activeChat.title === 'New chat' && activeChat.messages.length === 0;
      if (alreadyEmpty) {
        showToast('Already on a new chat.');
        return;
      }

      const chat = createChat({ title: 'New chat' });
      state.chats.unshift(chat);
      state.activeChatId = chat.id;
      persist();
      render();
      showToast('New chat created.');
    });
  });

  // — search —
  qs('[data-chat-search]')?.addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderSidebar();
  });

  // — submit —
  qs('[data-chat-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const textarea = qs('[data-chat-input]');
    const content = textarea.value.trim();
    const hasImages = state.pendingImages.length > 0;
    if ((!content && !hasImages) || state.typing) return;

    if (shouldOpenAuthGateFromUsage(state.usage)) {
      showAuthGate();
      qs('[data-auth-gate-email]')?.focus();
      return;
    }

    const submittedImages = [...state.pendingImages];
    const submittedContent = content || 'Please review the attached screenshot and tell me what matters.';
    appendMessage('user', submittedContent, state.activeChatId, {
      attachments: submittedImages.map(({ name, type, size }) => ({ name, type, size })),
    });
    state.pendingImages = [];
    renderAttachmentPreview();
    textarea.value = '';
    autoGrow(textarea);
    setTyping(true);
    renderMessages();
    qs('[data-message-list]').scrollTop = qs('[data-message-list]').scrollHeight;

    await streamAssistantReply(submittedContent, submittedImages);
    render();
  });

  qs('[data-chat-input]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      qs('[data-chat-form]').requestSubmit();
    }
  });

  qs('[data-chat-input]')?.addEventListener('input', (event) => autoGrow(event.target));

  qs('[data-auth-sign-in]')?.addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showToast(error.message || 'Google sign-in is not available yet.');
    }
  });

  qs('[data-auth-sign-out]')?.addEventListener('click', async () => {
    await signOut();
    state.pendingImages = [];
    renderAttachmentPreview();
    showToast('Signed out.');
  });

  qs('[data-auth-gate-google]')?.addEventListener('click', async () => {
    if (!state.auth.enabled) {
      setAuthGateStatus('Sign-in is not available right now.', 'error');
      return;
    }
    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthGateStatus(error.message || 'Google sign-in is not available yet.', 'error');
    }
  });

  qs('[data-auth-gate-magic-link]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.auth.enabled) {
      setAuthGateStatus('Sign-in is not available right now.', 'error');
      return;
    }

    const input = qs('[data-auth-gate-email]');
    const email = input?.value.trim() || '';
    if (!email) {
      setAuthGateStatus('Enter your email to get a secure sign-in link.', 'error');
      input?.focus();
      return;
    }

    state.authGate.sending = true;
    setAuthGateStatus('', '');
    renderAuthGate();
    try {
      await signInWithMagicLink(email);
      if (input) input.value = '';
      setAuthGateStatus('Check your email for a secure sign-in link. You can return here after verification.', 'success');
    } catch (error) {
      setAuthGateStatus(error.message || 'Could not send the sign-in link. Try again.', 'error');
    } finally {
      state.authGate.sending = false;
      renderAuthGate();
    }
  });

  qs('[data-image-attach]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleAttachMenu();
  });

  qs('[data-attach-photo]')?.addEventListener('click', () => {
    closeAttachMenu();
    if (!state.auth.signedIn) {
      showToast('Sign in to attach screenshots.');
      qs('[data-settings-panel]')?.classList.add('open');
      return;
    }
    qs('[data-image-input]')?.click();
  });

  document.addEventListener('click', (event) => {
    const wrap = qs('[data-attach-menu-wrap]');
    if (wrap && !wrap.contains(event.target)) closeAttachMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAttachMenu();
  });

  qs('[data-image-input]')?.addEventListener('change', async (event) => {
    await addImageFiles([...event.target.files]);
    event.target.value = '';
  });

  // — settings panel —
  populateSettingsPanel();

  qsa('[data-settings-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      qs('[data-settings-panel]').classList.add('open');
      const settingsBody = qs('.settings-panel-body');
      if (settingsBody) settingsBody.scrollTop = 0;
      setSettingsNav('profile');
    });
  });

  qs('[data-settings-close]')?.addEventListener('click', () => {
    qs('[data-settings-panel]').classList.remove('open');
  });

  qsa('[data-settings-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.settingsJump;
      const section = qs(`[data-settings-section="${target}"]`);
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setSettingsNav(target);
    });
  });

  // theme picker
  qsa('[data-set-theme]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.setTheme;
      setTheme(theme);
      updateThemePicker(theme);
      showToast(`Theme set to ${theme}.`);
    });
  });

  // name
  qs('[data-setting-name]')?.addEventListener('change', (e) => {
    state.settings.studentName = e.target.value.trim() || 'Student';
    persistSettings();
    updateUserChip();
  });

  qs('[data-setting-campus]')?.addEventListener('change', (e) => {
    state.settings.homeCampus = e.target.value.trim();
    persistSettings();
  });

  // context
  qs('[data-setting-context]')?.addEventListener('change', (e) => {
    state.settings.userContext = e.target.value.trim();
    persistSettings();
  });

  qs('[data-setting-situation]')?.addEventListener('change', (e) => {
    state.settings.situation = e.target.value;
    persistSettings();
  });

  qs('[data-setting-scholarship]')?.addEventListener('change', (e) => {
    state.settings.scholarshipStatus = e.target.value;
    persistSettings();
  });

  // concise mode
  qs('[data-setting-concise]')?.addEventListener('change', (e) => {
    state.settings.conciseMode = e.target.checked;
    persistSettings();
  });

  // web search
  qs('[data-setting-web-search]')?.addEventListener('change', (e) => {
    state.settings.webSearch = e.target.checked;
    persistSettings();
    populateSettingsPanel();
  });

  // destination
  qs('[data-setting-destination]')?.addEventListener('change', (e) => {
    state.settings.destination = e.target.value;
    persistSettings();
    populateSettingsPanel();
    updateMobileChatContext();
  });

  // language
  qs('[data-setting-language]')?.addEventListener('change', (e) => {
    state.settings.language = e.target.value;
    persistSettings();
  });

  // data consent
  qs('[data-setting-data-consent]')?.addEventListener('change', (e) => {
    state.settings.dataConsent = e.target.checked;
    persistSettings();
  });

  // delete all chats
  qs('[data-delete-all-chats]')?.addEventListener('click', () => {
    if (!confirm('Delete all conversations? This cannot be undone.')) return;
    const fresh = createChat();
    state.chats = [fresh];
    state.activeChatId = fresh.id;
    persist();
    render();
    showToast('All conversations deleted.');
  });

  qs('[data-export-all-chats]')?.addEventListener('click', () => {
    const exportedAt = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    const body = [
      '# OmanX Conversation Export',
      '',
      `Exported ${exportedAt}`,
      '',
      ...state.chats.map(chatToMarkdown),
    ].join('\n\n');
    downloadFile('omanx-conversations.md', body, 'text/markdown;charset=utf-8');
    showToast('All conversations exported.');
  });

  qs('[data-report-guidance]')?.addEventListener('click', async () => {
    const chat = getActiveChat();
    const lastAssistant = [...(chat?.messages || [])].reverse().find((m) => m.role === 'assistant');
    const template = [
      'OmanX guidance report',
      '',
      `Conversation: ${chat?.title || 'Untitled'}`,
      `Message ID: ${lastAssistant?.id || 'Not available'}`,
      '',
      'What seems incorrect or missing?',
      '- ',
      '',
      'What source or office should OmanX check?',
      '- ',
    ].join('\n');
    await copyText(template, 'Report template copied.');
  });
}

function populateSettingsPanel() {
  const { studentName, homeCampus, userContext, conciseMode, language, destination, situation, scholarshipStatus, dataConsent, webSearch } = state.settings;

  const nameEl = qs('[data-setting-name]');
  if (nameEl) nameEl.value = studentName === 'Student' ? '' : studentName;

  const campusEl = qs('[data-setting-campus]');
  if (campusEl) campusEl.value = homeCampus === 'University partner' ? '' : homeCampus || '';

  const ctxEl = qs('[data-setting-context]');
  if (ctxEl) ctxEl.value = userContext || '';

  const conciseEl = qs('[data-setting-concise]');
  if (conciseEl) conciseEl.checked = !!conciseMode;

  const destEl = qs('[data-setting-destination]');
  if (destEl) destEl.value = destination || 'auto';

  const situationEl = qs('[data-setting-situation]');
  if (situationEl) situationEl.value = situation || '';

  const scholarshipEl = qs('[data-setting-scholarship]');
  if (scholarshipEl) scholarshipEl.value = scholarshipStatus || '';

  const langEl = qs('[data-setting-language]');
  if (langEl) langEl.value = language || 'auto';

  const consentEl = qs('[data-setting-data-consent]');
  if (consentEl) consentEl.checked = !!dataConsent;

  const webSearchEl = qs('[data-setting-web-search]');
  if (webSearchEl) webSearchEl.checked = webSearch !== false;

  updateThemePicker(getTheme());
  updateUserChip();
  renderUsagePanel();
}

function updateThemePicker(active) {
  qsa('[data-set-theme]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.setTheme === active);
  });
}

function setSettingsNav(active) {
  qsa('[data-settings-jump]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.settingsJump === active);
  });
}

function updateUserChip() {
  const name = state.settings.studentName || 'Student';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const avatarEl = qs('[data-user-avatar]');
  const nameEl = qs('[data-user-chip-name]');
  if (avatarEl) avatarEl.textContent = initials || 'S';
  if (nameEl) nameEl.textContent = name;
}

function updateMobileChatContext() {
  const el = qs('[data-mobile-chat-context]');
  if (!el) return;
  const activeChat = state.chats.find((chat) => chat.id === state.activeChatId);
  const destination = DEST_FULL_LABEL[state.settings.destination || 'auto'] || 'Auto-detect';
  el.textContent = activeChat?.title && activeChat.title !== 'New chat'
    ? activeChat.title
    : destination;
}

function toggleAttachMenu() {
  const menu = qs('[data-attach-menu]');
  const attachBtn = qs('[data-image-attach]');
  if (!menu || !attachBtn || attachBtn.disabled) return;
  const isOpen = !menu.hidden;
  menu.hidden = isOpen;
  attachBtn.setAttribute('aria-expanded', String(!isOpen));
}

function closeAttachMenu() {
  const menu = qs('[data-attach-menu]');
  const attachBtn = qs('[data-image-attach]');
  if (menu) menu.hidden = true;
  if (attachBtn) attachBtn.setAttribute('aria-expanded', 'false');
}

function updateAuthUi() {
  const statusEl = qs('[data-auth-status]');
  const accessEl = qs('[data-auth-access-label]');
  const signInBtn = qs('[data-auth-sign-in]');
  const signOutBtn = qs('[data-auth-sign-out]');
  const attachBtn = qs('[data-image-attach]');

  if (!state.auth.enabled) {
    if (statusEl) statusEl.textContent = 'Sign-in not configured';
    if (accessEl) accessEl.textContent = 'Guest access';
    if (signInBtn) signInBtn.hidden = true;
    if (signOutBtn) signOutBtn.hidden = true;
    if (attachBtn) attachBtn.disabled = true;
    updateSyncUi();
    renderAuthGate();
    return;
  }

  if (state.auth.signedIn) {
    if (statusEl) statusEl.textContent = state.auth.user?.email || state.auth.user?.name || 'Signed in';
    if (accessEl) accessEl.textContent = 'Signed in';
    if (signInBtn) signInBtn.hidden = true;
    if (signOutBtn) signOutBtn.hidden = false;
    if (attachBtn) attachBtn.disabled = false;
    hideAuthGate();
  } else {
    if (statusEl) statusEl.textContent = 'Not signed in';
    if (accessEl) accessEl.textContent = '3 guest questions';
    if (signInBtn) signInBtn.hidden = false;
    if (signOutBtn) signOutBtn.hidden = true;
    if (attachBtn) attachBtn.disabled = false;
    renderAuthGate();
  }
  updateSyncUi();
}

function shouldOpenAuthGateFromUsage(usage) {
  return Boolean(
    usage &&
    !usage.blockedBy &&
    usage.tier === 'anonymous' &&
    usage.remaining <= 0 &&
    !state.auth.signedIn
  );
}

function syncAuthGateWithUsage() {
  if (state.auth.signedIn) {
    hideAuthGate();
    return;
  }
  if (shouldOpenAuthGateFromUsage(state.usage)) showAuthGate();
  else renderAuthGate();
}

function showAuthGate({ message = AUTH_GATE_MESSAGE, status = '', statusTone = '' } = {}) {
  state.authGate.visible = true;
  state.authGate.message = message || AUTH_GATE_MESSAGE;
  state.authGate.status = status;
  state.authGate.statusTone = statusTone;
  renderAuthGate();
}

function hideAuthGate() {
  if (!state.authGate.visible && !state.authGate.status && !state.authGate.sending) return;
  state.authGate = { visible: false, message: '', status: '', statusTone: '', sending: false };
  renderAuthGate();
}

function setAuthGateStatus(status, statusTone = '') {
  state.authGate.visible = true;
  state.authGate.status = status || '';
  state.authGate.statusTone = statusTone || '';
  renderAuthGate();
}

function renderAuthGate() {
  const gate = qs('[data-auth-gate]');
  if (!gate) return;

  const visible = state.authGate.visible && !state.auth.signedIn;
  gate.hidden = !visible;
  if (!visible) return;

  const messageEl = qs('[data-auth-gate-message]', gate);
  const statusEl = qs('[data-auth-gate-status]', gate);
  const googleBtn = qs('[data-auth-gate-google]', gate);
  const emailInput = qs('[data-auth-gate-email]', gate);
  const emailSubmit = qs('[data-auth-gate-magic-submit]', gate);
  const controlsDisabled = !state.auth.enabled || state.authGate.sending;

  if (messageEl) messageEl.textContent = state.authGate.message || AUTH_GATE_MESSAGE;
  if (googleBtn) googleBtn.disabled = controlsDisabled;
  if (emailInput) emailInput.disabled = controlsDisabled;
  if (emailSubmit) {
    emailSubmit.disabled = controlsDisabled;
    emailSubmit.textContent = state.authGate.sending ? 'Sending...' : 'Send sign-in link';
  }
  if (statusEl) {
    const fallback = state.auth.enabled ? '' : 'Sign-in is not available right now.';
    statusEl.textContent = state.authGate.status || fallback;
    statusEl.dataset.tone = state.authGate.statusTone || (!state.auth.enabled ? 'error' : '');
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024 * 1024) return `${Math.max(Math.round(bytes / 1024), 1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const maxImages = 1;
  const maxBytes = 3 * 1024 * 1024;

  for (const file of files) {
    if (state.pendingImages.length >= maxImages) {
      showToast(`Attach up to ${maxImages} images at a time.`);
      break;
    }
    if (!allowedTypes.has(file.type)) {
      showToast('Only PNG, JPEG, and WebP images are supported.');
      continue;
    }
    if (file.size > maxBytes) {
      showToast('Each image must be 3MB or smaller.');
      continue;
    }

    const dataUrl = await readFileAsDataUrl(file);
    state.pendingImages.push({
      id: uid('img'),
      name: file.name || 'screenshot',
      type: file.type,
      size: file.size,
      data: dataUrl,
    });
  }

  renderAttachmentPreview();
}

function renderAttachmentPreview() {
  const preview = qs('[data-attachment-preview]');
  if (!preview) return;
  preview.hidden = state.pendingImages.length === 0;
  preview.innerHTML = state.pendingImages.map((image) => `
    <span class="attachment-chip">
      <span>${escapeHtml(image.name)}</span>
      <small>${escapeHtml(formatBytes(image.size))}</small>
      <button type="button" data-remove-image="${image.id}" aria-label="Remove ${escapeHtml(image.name)}">x</button>
    </span>
  `).join('');

  qsa('[data-remove-image]', preview).forEach((button) => {
    button.addEventListener('click', () => {
      state.pendingImages = state.pendingImages.filter((image) => image.id !== button.dataset.removeImage);
      renderAttachmentPreview();
    });
  });
}

async function refreshUsage() {
  try {
    const token = await getAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`/api/usage?sessionId=${encodeURIComponent(getSessionId())}`, { cache: 'no-store', headers });
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.usage) {
      state.usage = payload.usage;
      if (payload.user) state.auth = { ...state.auth, signedIn: true, user: payload.user };
      renderUsagePanel();
      syncAuthGateWithUsage();
      updateAuthUi();
    }
  } catch {
    renderUsagePanel();
  }
}

function setUsage(usage) {
  if (!usage) return;
  state.usage = usage;
  renderUsagePanel();
  syncAuthGateWithUsage();
}

function formatReset(usage) {
  if (!usage?.resetInMs) return 'soon';
  const totalSeconds = Math.max(Math.ceil(usage.resetInMs / 1000), 0);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function renderUsagePanel() {
  const panel = qs('[data-usage-panel]');
  if (!panel) return;
  const percentEl = qs('[data-usage-percent]', panel);
  const meterEl = qs('[data-usage-meter]', panel);
  const detailEl = qs('[data-usage-detail]', panel);

  if (!state.usage) {
    if (percentEl) percentEl.textContent = state.auth.signedIn ? 'Checking' : '3 free';
    if (meterEl) meterEl.style.width = '0%';
    if (detailEl) detailEl.textContent = state.auth.signedIn
      ? 'Checking how many questions are left today.'
      : 'Guests can ask 3 questions before signing in.';
    return;
  }

  const usage = state.usage;
  const remaining = Math.max(Number(usage.remaining || 0), 0);
  const limit = Number(usage.limit || 0);
  if (percentEl) percentEl.textContent = `${remaining} left`;
  if (meterEl) meterEl.style.width = `${Math.min(Math.max(usage.percentUsed, 0), 100)}%`;
  if (detailEl) {
    if (!state.auth.signedIn) {
      detailEl.textContent = remaining > 0
        ? `${remaining} of ${limit} guest questions left today. Sign in to keep asking after that.`
        : 'You have used your guest questions. Sign in with Google to keep asking.';
    } else {
      detailEl.textContent = `${remaining} of ${limit} questions left today. Resets in ${formatReset(usage)}.`;
    }
  }
  panel.classList.toggle('usage-panel-warning', usage.percentUsed >= 80);
}

function maybeShowOnboarding() {
  if (!hasCompletedOnboarding()) showOnboarding();
}

function showOnboardingStep(overlay, step) {
  qsa('[data-ob-step]', overlay).forEach((el) => {
    el.hidden = el.dataset.obStep !== step;
  });
}

function showOnboarding() {
  const overlay = qs('[data-onboarding]');
  if (!overlay) return;
  overlay.hidden = false;
  showOnboardingStep(overlay, '1');

  let selectedDest = 'auto';
  let selectedSituation = state.settings.situation || 'Current student';

  qsa('[data-dest]', overlay).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('[data-dest]', overlay).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDest = btn.dataset.dest;
      showOnboardingStep(overlay, '2');
    });
  });

  qsa('[data-situation]', overlay).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('[data-situation]', overlay).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSituation = btn.dataset.situation;
      showOnboardingStep(overlay, '3');
      qs('[data-onboarding-name]', overlay)?.focus();
    });
  });

  function completeOnboarding() {
    const name = (qs('[data-onboarding-name]', overlay)?.value || '').trim();
    const campus = (qs('[data-onboarding-campus]', overlay)?.value || '').trim();
    if (name) {
      state.settings.studentName = name;
    }
    if (campus) {
      state.settings.homeCampus = campus;
    }
    state.settings.destination = selectedDest;
    state.settings.situation = selectedSituation;
    persistSettings();
    markOnboarded();
    overlay.hidden = true;
    updateUserChip();
    populateSettingsPanel();
    render();
  }

  qs('[data-onboarding-submit]', overlay)?.addEventListener('click', completeOnboarding);
  qs('[data-onboarding-name]', overlay)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') completeOnboarding();
  });
}

function render() {
  renderSidebar();
  updateMobileChatContext();
  renderAuthGate();
  // Skip message-list rebuild while the stream bubble is live on the active chat.
  // If the user switched to a different chat, render their messages normally.
  if (!streamingChatId || streamingChatId !== state.activeChatId) renderMessages();
}

function renderSidebar() {
  const list = qs('[data-chat-list]');
  const filtered = [...state.chats]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((chat) => {
      if (!state.filter) return true;
      return `${chat.title} ${chat.category} ${chat.messages.map((m) => m.content).join(' ')}`.toLowerCase().includes(state.filter);
    });

  list.innerHTML = filtered.map((chat) => {
    const isActive = chat.id === state.activeChatId;
    const isConfirm = chat.id === state.confirmDeleteId;

    if (isConfirm) {
      return `
        <article class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
          <div class="chat-item-confirm">
            <span>Delete this chat?</span>
            <button type="button" class="confirm-item-delete-btn" data-confirm-yes-item>Delete</button>
            <button type="button" class="confirm-item-cancel-btn" data-confirm-no-item>Cancel</button>
          </div>
        </article>
      `;
    }

    const lastMsg = [...chat.messages].reverse().find((m) => m.role === 'user') || [...chat.messages].reverse().find((m) => m.role === 'assistant');
    const snippet = lastMsg ? escapeHtml(stripMarkdown(lastMsg.content).slice(0, 120)) : '';

    return `
      <article class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
        <div class="chat-item-header">
          <div class="chat-item-title" data-item-title>${escapeHtml(chat.title)}</div>
          <div class="chat-item-actions">
            <div class="item-menu-wrap">
              <button type="button" class="icon-btn item-menu-btn" data-item-menu-toggle title="Options" aria-haspopup="true">···</button>
              <div class="chat-item-dropdown" data-item-menu hidden>
                <button type="button" data-pin-chat>${chat.pinned ? 'Unpin' : 'Pin'}</button>
                <button type="button" data-copy-last-item>Copy last reply</button>
                <button type="button" data-export-md>Export Markdown</button>
                <button type="button" data-export-pdf>Export PDF</button>
                <hr class="menu-divider" />
                <button type="button" data-rename-item>Rename</button>
                <button type="button" data-delete-item class="danger">Delete</button>
              </div>
            </div>
          </div>
        </div>
        ${snippet ? `<div class="chat-item-snippet">${snippet}</div>` : ''}
      </article>
    `;
  }).join('') || '<div class="message-empty">No chats match your search.</div>';

  qsa('[data-chat-id]', list).forEach((item) => {
    const chatId = item.dataset.chatId;
    const menu = item.querySelector('[data-item-menu]');

    // open chat on click (ignore buttons and inputs)
    item.addEventListener('click', (event) => {
      if (event.target.closest('button') || event.target.closest('input')) return;
      state.activeChatId = chatId;
      persist();
      render();
      qs('[data-chat-sidebar]').classList.remove('open');
    });

    // confirm delete
    item.querySelector('[data-confirm-yes-item]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      state.confirmDeleteId = null;
      state.chats = deleteChat(state.chats, chatId);
      if (!state.chats.length) state.chats = [createChat()];
      state.activeChatId = state.chats[0].id;
      persist();
      render();
      showToast('Chat deleted.');
    });

    item.querySelector('[data-confirm-no-item]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      state.confirmDeleteId = null;
      renderSidebar();
    });

    // pin (now lives inside the dropdown)
    item.querySelector('[data-pin-chat]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      mutateChat(chatId, (c) => ({ ...c, pinned: !c.pinned, updatedAt: new Date().toISOString() }));
      renderSidebar();
    });

    // menu toggle
    item.querySelector('[data-item-menu-toggle]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = !menu.hidden;
      qsa('[data-item-menu]', list).forEach((m) => (m.hidden = true));
      menu.hidden = isOpen;
    });

    // rename
    item.querySelector('[data-rename-item]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      const chat = state.chats.find((c) => c.id === chatId);
      const newTitle = prompt('Rename conversation:', chat?.title ?? '');
      if (newTitle !== null) doRename(chatId, newTitle);
    });

    // delete
    item.querySelector('[data-delete-item]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      state.confirmDeleteId = chatId;
      renderSidebar();
    });

    // copy last reply
    item.querySelector('[data-copy-last-item]')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      menu.hidden = true;
      const chat = state.chats.find((c) => c.id === chatId);
      const message = [...chat.messages].reverse().find((m) => m.role === 'assistant');
      if (!message) return showToast('No assistant message to copy yet.');
      await copyText(message.content, 'Last assistant message copied.');
    });

    // export markdown
    item.querySelector('[data-export-md]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      const chat = state.chats.find((c) => c.id === chatId);
      downloadFile(`${slugify(chat.title)}.md`, chatToMarkdown(chat), 'text/markdown;charset=utf-8');
      showToast('Conversation exported as Markdown.');
    });

    // export PDF
    item.querySelector('[data-export-pdf]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      const chat = state.chats.find((c) => c.id === chatId);
      exportAsPdf(chat);
    });
  });
}

function renderMessages() {
  const chat = getActiveChat();
  const container = qs('[data-message-list]');
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;

  if (!chat.messages.length) {
    container.innerHTML = emptyStateMarkup();
    qsa('[data-quick-prompt]', container).forEach((button) => {
      button.addEventListener('click', () => {
        qs('[data-chat-input]').value = button.dataset.quickPrompt;
        autoGrow(qs('[data-chat-input]'));
        qs('[data-chat-input]').focus();
      });
    });
    return;
  }

  container.innerHTML = chat.messages.map((message) => `
    <article class="message ${message.role}">
      ${message.role === 'assistant' ? renderAnswerStatus(message) : ''}
      <div class="message-bubble">${message.role === 'assistant' ? renderRichText(message.content) : renderUserText(message.content)}</div>
      ${message.role === 'user' ? renderMessageAttachments(message.attachments) : ''}
      ${message.role === 'assistant' ? renderSources(message.sources) : ''}
      ${message.role === 'assistant' ? renderEscalationCard(message.escalation) : ''}
      <div class="message-meta">
        <span>${message.role === 'assistant' ? 'OmanX' : state.settings.studentName}</span>
        <span>${formatDateTime(message.createdAt)}</span>
        ${message.role === 'assistant' && message.destination && DEST_LABEL[message.destination] ? `<span class="dest-badge">${DEST_LABEL[message.destination]}</span>` : ''}
        ${message.role === 'assistant' ? `
          <span class="message-tools">
            ${message.webSearched ? '<span class="web-search-badge" title="Current web search was used for this response">Current rules</span>' : ''}
            <button type="button" data-copy-message="${message.id}">Copy</button>
            <span class="feedback-buttons" data-feedback-id="${message.id}">
              <button type="button" class="feedback-btn ${feedbackState.get(message.id) === 'up' ? 'feedback-submitted' : ''}" data-feedback-up="${message.id}" title="Helpful" aria-label="Mark as helpful">
                ${feedbackState.get(message.id) === 'up' ? 'OK' : '+'}
              </button>
              <button type="button" class="feedback-btn ${feedbackState.get(message.id) === 'down' ? 'feedback-submitted' : ''}" data-feedback-down="${message.id}" title="Not helpful" aria-label="Mark as not helpful">
                ${feedbackState.get(message.id) === 'down' ? 'OK' : '-'}
              </button>
            </span>
          </span>
        ` : ''}
      </div>
    </article>
  `).join('');

  if (state.typing) {
    const typing = document.createElement('article');
    typing.className = 'message assistant';
    typing.innerHTML = `
      <div class="message-bubble">
        <div class="typing"><span></span><span></span><span></span></div>
        <div class="thinking-status" data-thinking-status>${escapeHtml(state.searchStatus || THINKING_STAGES[0])}</div>
      </div>
      <div class="message-meta"><span>OmanX</span></div>
    `;
    container.appendChild(typing);
  }

  qsa('[data-copy-message]', container).forEach((button) => {
    button.addEventListener('click', async () => {
      const message = getActiveChat().messages.find((item) => item.id === button.dataset.copyMessage);
      if (message) await copyText(message.content, 'Message copied.');
    });
  });

  qsa('[data-feedback-up], [data-feedback-down]', container).forEach((btn) => {
    const messageId = btn.dataset.feedbackUp || btn.dataset.feedbackDown;
    const rating = btn.dataset.feedbackUp ? 'up' : 'down';

    if (feedbackState.has(messageId)) {
      btn.disabled = true;
      return;
    }

    btn.addEventListener('click', async () => {
      if (feedbackState.has(messageId)) return;
      feedbackState.set(messageId, rating);

      qsa(`[data-feedback-up="${messageId}"], [data-feedback-down="${messageId}"]`, container).forEach((b) => {
        b.disabled = true;
        b.textContent = b.dataset[`feedback${rating === 'up' ? 'Up' : 'Down'}`] === messageId ? 'OK' : '-';
      });

      renderMessages();

      const chat = getActiveChat();
      const message = chat.messages.find((m) => m.id === messageId);

      try {
        await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            chatId: chat.id,
            sessionId: getSessionId(),
            rating,
            compliance: message?.content?.includes('DSO') || message?.content?.includes('SEVIS') || false,
          }),
        });
      } catch {
        // Silent — never interrupt the user for a feedback failure
      }
    });
  });

  if (wasNearBottom) container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content, chatId = state.activeChatId, meta = {}) {
  const message = { id: uid('msg'), role, content, createdAt: new Date().toISOString(), ...meta };
  mutateChat(chatId, (chat) => ({
    ...chat,
    title: deriveTitle(chat, role, content),
    updatedAt: message.createdAt,
    messages: [...chat.messages, message],
  }));
}

function mutateChat(chatId, updater) {
  state.chats = updateChat(state.chats, chatId, updater);
  persist();
}

function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || state.chats[0];
}

async function streamAssistantReply(message, imageAttachments = []) {
  const chat = getActiveChat();
  streamingChatId = chat.id;
  const history = chat.messages
    .slice(0, -1)
    .slice(-20)
    .map(({ role, content }) => ({ role, content }));

  const { conciseMode, userContext, language, destination, webSearch } = state.settings;
  const profileContext = buildProfileContext(userContext);

  let fullText = '';
  let didWebSearch = false;
  let didSources = [];
  let didEscalation = null;
  let didDestination = null;
  let didUsage = null;
  let shouldAppendAssistant = true;
  let bubbleEl = null;
  let rafPending = false;

  function activateBubble() {
    if (bubbleEl) return bubbleEl;
    setTyping(false);
    const container = qs('[data-message-list]');
    container.querySelector('.message.assistant:last-child .typing')?.closest('article')?.remove();
    const article = document.createElement('article');
    article.className = 'message assistant';
    article.dataset.streamBubble = '1';
    article.innerHTML = '<div class="message-bubble message-bubble-enter"></div><div class="message-meta"><span>OmanX</span><span>Now</span></div>';
    container.appendChild(article);
    bubbleEl = article.querySelector('.message-bubble');
    return bubbleEl;
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const el = activateBubble();
      el.innerHTML = renderRichText(fullText) + '<span class="stream-cursor" aria-hidden="true"></span>';
      const container = qs('[data-message-list]');
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 200) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  try {
    const token = await getAccessToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        history,
        conciseMode,
        userContext: profileContext,
        language,
        destination: destination || 'auto',
        webSearch: webSearch !== false,
        stream: true,
        sessionId: getSessionId(),
        attachments: imageAttachments.map(({ name, type, data }) => ({ name, type, data })),
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload.usage) didUsage = payload.usage;
      if (response.status === 429 && payload.authRequired) {
        shouldAppendAssistant = false;
        showAuthGate({ message: payload.text || AUTH_GATE_MESSAGE });
        showToast('Sign in with Google to keep asking.');
      } else {
        fullText = `**Error:** ${payload.error || payload.text || `Server error (HTTP ${response.status})`}`;
      }
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let boundary;
        while ((boundary = buf.indexOf('\n\n')) !== -1) {
          const line = buf.slice(0, boundary).trim();
          buf = buf.slice(boundary + 2);
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) { fullText = `**Error:** ${data.error}`; break; }
            if (data.status) setThinkingStatus(data.status);
            if (data.t) { fullText += data.t; scheduleRender(); }
            if (data.done) { if (data.webSearched) didWebSearch = true; if (data.sources) didSources = data.sources; if (data.escalation) didEscalation = data.escalation; if (data.destination) didDestination = data.destination; if (data.usage) didUsage = data.usage; }
          } catch { /* malformed SSE line */ }
        }
      }
    }
  } catch (err) {
    fullText = `**Network error:** ${err.message || 'Could not reach the server. Check your connection and try again.'}`;
  } finally {
    streamingChatId = null;
  }

  // Remove the temporary streaming bubble; render() will re-render from state.
  // Use the captured chat.id so the response always saves to the originating chat
  // even if the user switched conversations mid-stream.
  qs('[data-stream-bubble]')?.remove();
  setUsage(didUsage);
  if (shouldAppendAssistant) {
    appendMessage('assistant', fullText.trim() || 'No response generated.', chat.id, { webSearched: didWebSearch, sources: didSources, escalation: didEscalation, destination: didDestination });
  }
  setTyping(false);
}

function deriveTitle(chat, role, content) {
  if (chat.title !== 'New chat' && chat.title !== 'Untitled session' && chat.title !== 'New guidance session') return chat.title;
  if (role !== 'user') return chat.title;
  return content.split(/[.!?]/)[0].slice(0, 42) || chat.title;
}


function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function buildProfileContext(userContext = '') {
  const parts = [];
  if (state.settings.homeCampus && state.settings.homeCampus !== 'University partner') {
    parts.push(`University or campus: ${state.settings.homeCampus}.`);
  }
  if (state.settings.situation) parts.push(`Student situation: ${state.settings.situation}.`);
  if (state.settings.scholarshipStatus) parts.push(`Scholarship status: ${state.settings.scholarshipStatus}.`);
  if (state.settings.destination && state.settings.destination !== 'auto') {
    parts.push(`Study destination: ${DEST_FULL_LABEL[state.settings.destination] || state.settings.destination}.`);
  }
  if (userContext) parts.push(userContext);
  return parts.join('\n');
}

function emptyStateMarkup() {
  const name = state.settings.studentName && state.settings.studentName !== 'Student' ? `, ${state.settings.studentName}` : '';
  const destination = state.settings.destination && state.settings.destination !== 'auto'
    ? DEST_FULL_LABEL[state.settings.destination]
    : 'the US, UK, or Australia';
  return `
    <section class="message-empty">
      <div class="empty-brand">Oman<span>X</span></div>
      <p class="empty-sub">Good to see you${escapeHtml(name)}. Ask about visas, work, housing, insurance, or scholarship rules in ${escapeHtml(destination)}.</p>
      <p class="empty-trust">OmanX shows sources, flags risky situations, and gives next steps before you act.</p>
      <div class="prompt-grid">
        ${prompts.map((p) => `<button type="button" class="prompt-card" data-quick-prompt="${escapeHtml(p.text)}"><span class="prompt-card-label">${escapeHtml(p.label)}</span><span class="prompt-card-text">${escapeHtml(p.text)}</span></button>`).join('')}
      </div>
    </section>
  `;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'omanx-chat';
}

function chatToMarkdown(chat) {
  const destMsg = chat.messages.find((m) => m.destination);
  const dest = destMsg?.destination;
  const destStr = dest ? ` - ${DEST_LABEL[dest] || dest.toUpperCase()}` : '';
  const exportDate = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());

  const lines = [
    `# ${chat.title}`,
    ``,
    `**OmanX Conversation Export**${destStr}  `,
    `Exported ${exportDate}`,
    ``,
    `---`,
    ``,
  ];

  for (const msg of chat.messages) {
    if (msg.role === 'user') {
      lines.push(`## You`, ``, msg.content, ``);
    } else {
      lines.push(`## OmanX`, ``, msg.content, ``);

      if (msg.sources?.length) {
        lines.push(`**Sources:**`);
        for (const s of msg.sources) {
          if (s.type === 'kb') {
            lines.push(`- ${s.title || s.id} *(Knowledge Base)*`);
          } else {
            lines.push(`- [${s.title || s.domain}](${s.url})`);
          }
        }
        lines.push(``);
      }

      if (msg.escalation) {
        const card = msg.escalation;
        lines.push(`> **${card.title}**`);
        for (const step of card.steps || []) lines.push(`> - ${step}`);
        if (card.forms?.length) {
          lines.push(`>`, `> *Relevant forms:* ${card.forms.join(', ')}`);
        }
        if (card.embassy) {
            lines.push(`>`, `> **${card.embassy.name}** - ${card.embassy.note}`);
        }
        lines.push(`>`, `> ${card.dsoNote}`, ``);
      }
    }
    lines.push(`---`, ``);
  }

  return lines.join('\n');
}

function exportAsPdf(chat) {
  const blob = new Blob([chatToPrintHtml(chat)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    showToast('Pop-up blocked. Allow pop-ups for this site to export PDF.');
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  showToast('Opening print dialog. Choose "Save as PDF".');
}

function chatToPrintHtml(chat) {
  const destMsg = chat.messages.find((m) => m.destination);
  const dest = destMsg?.destination;
  const destStr = dest ? ` - ${DEST_LABEL[dest] || dest.toUpperCase()}` : '';
  const exportDate = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
  const studentName = state.settings.studentName || 'Student';

  const messagesHtml = chat.messages.map((msg) => {
    if (msg.role === 'user') {
      return `
        <div class="turn turn-user">
          <div class="turn-label">${escapeHtml(studentName)}</div>
          <div class="turn-body">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
        </div><hr class="divider">
      `;
    }

    let sourcesHtml = '';
    if (msg.sources?.length) {
      const chips = msg.sources.map((s) => {
        if (s.type === 'kb') return escapeHtml(s.title || s.id) + ' <em>(Knowledge Base)</em>';
        const safeUrl = /^https?:\/\//i.test(s.url) ? s.url : '#';
        return `<a href="${escapeHtml(safeUrl)}" rel="noopener noreferrer">${escapeHtml(s.title || s.domain)}</a>`;
      }).join(' · ');
      sourcesHtml = `<div class="sources"><span class="sources-label">Sources:</span> ${chips}</div>`;
    }

    let escalationHtml = '';
    if (msg.escalation) {
      const card = msg.escalation;
      const stepsHtml = (card.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join('');
      const formsHtml = card.forms?.length ? `<div><strong>Relevant forms:</strong> ${card.forms.map((f) => escapeHtml(f)).join(', ')}</div>` : '';
      const embassyHtml = card.embassy ? `<div><strong>${escapeHtml(card.embassy.name)}</strong> - ${escapeHtml(card.embassy.note)}</div>` : '';
      escalationHtml = `
        <div class="escalation-card ${card.level === 'urgent' ? 'urgent' : 'warning'}">
          <div class="escalation-title">${escapeHtml(card.title)} · ${card.level === 'urgent' ? 'Action Required' : 'Heads Up'}</div>
          <ol>${stepsHtml}</ol>
          ${formsHtml}${embassyHtml}
          <div class="dso-note">${escapeHtml(card.dsoNote)}</div>
        </div>
      `;
    }

    return `
      <div class="turn turn-assistant">
        <div class="turn-label">OmanX</div>
        <div class="turn-body">${renderRichText(msg.content)}</div>
        ${sourcesHtml}${escalationHtml}
      </div><hr class="divider">
    `;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>OmanX - ${escapeHtml(chat.title)}</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.65;color:#1a1a1a;background:#fff;padding:2.5cm 2cm;max-width:21cm;margin:0 auto}
    .doc-header{border-bottom:2px solid #1a1a1a;padding-bottom:1em;margin-bottom:2em}
    .doc-brand{font-size:1.5em;font-weight:700;letter-spacing:-0.02em}
    .doc-brand span{color:#c15a00}
    .doc-title{font-size:1.1em;font-weight:600;margin:.3em 0 .1em}
    .doc-meta{font-size:.8em;color:#666}
    .turn{margin-bottom:1.25em}
    .turn-label{font-size:.7em;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.35em}
    .turn-user .turn-label{color:#1a4b8c}
    .turn-assistant .turn-label{color:#7c3a00}
    .turn-user .turn-body{background:#f0f4ff;border-left:3px solid #1a4b8c;padding:.7em 1em;border-radius:0 4px 4px 0}
    .turn-body h3,.turn-body h4{font-size:1em;font-weight:600;margin:.75em 0 .25em}
    .turn-body p{margin:.4em 0}
    .turn-body br+br{display:none}
    .turn-body ul,.turn-body ol{margin:.4em 0 .4em 1.5em}
    .turn-body li{margin:.2em 0}
    .turn-body blockquote{border-left:3px solid #ccc;padding-left:.85em;color:#555;margin:.5em 0}
    .turn-body strong{font-weight:600}
    .turn-body .code-inline{font-family:'SF Mono',Consolas,monospace;background:#f4f4f4;padding:.1em .3em;border-radius:3px;font-size:.88em}
    .turn-body a{color:#1a4b8c}
    .sources{margin-top:.65em;font-size:.8em;color:#555;border-top:1px solid #e5e5e5;padding-top:.5em}
    .sources-label{font-weight:600}
    .sources a{color:#1a4b8c;text-decoration:none}
    .escalation-card{margin-top:.9em;padding:.75em 1em;border-radius:4px}
    .escalation-card.urgent{background:#fff5f5;border-left:4px solid #c0392b}
    .escalation-card.warning{background:#fffbf0;border-left:4px solid #e67e22}
    .escalation-title{font-weight:700;font-size:.9em;margin-bottom:.5em}
    .escalation-card ol{margin:.4em 0 .4em 1.4em}
    .escalation-card li{margin:.2em 0}
    .escalation-card div{margin-top:.4em;font-size:.88em}
    .dso-note{font-style:italic;color:#555}
    .divider{border:none;border-top:1px solid #e5e5e5;margin:1.25em 0}
    @media print{
      body{padding:0}
      .turn,.escalation-card{break-inside:avoid}
      a{color:inherit;text-decoration:none}
      a[href]::after{content:' (' attr(href) ')';font-size:.78em;color:#666}
    }
  </style>
</head>
<body>
  <div class="doc-header">
    <div class="doc-brand">Oman<span>X</span></div>
    <div class="doc-title">${escapeHtml(chat.title)}${escapeHtml(destStr)}</div>
    <div class="doc-meta">Exported ${escapeHtml(exportDate)}</div>
  </div>
  <main>${messagesHtml}</main>
  <script>window.addEventListener('load',function(){window.print();});<\/script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function applyInline(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="code-inline">$1</span>');
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines, index) {
  return lines[index]?.includes('|') && isTableSeparator(lines[index + 1] || '');
}

function renderMarkdownTable(rows) {
  const header = splitTableRow(rows[0]);
  const bodyRows = rows.slice(2).map(splitTableRow);
  const width = header.length;

  const headHtml = header
    .map((cell) => `<th scope="col">${applyInline(cell)}</th>`)
    .join('');

  const bodyHtml = bodyRows
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      const padded = [...cells, ...Array(Math.max(0, width - cells.length)).fill('')].slice(0, width);
      return `<tr>${padded.map((cell) => `<td>${applyInline(cell)}</td>`).join('')}</tr>`;
    })
    .join('');

  return `<div class="message-table-wrap"><table class="message-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '');
}

function renderRichText(content) {
  const lines = escapeHtml(content).split('\n');
  const out = [];
  let listType = null;

  function closeList() {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (/^\s*$/.test(raw)) {
      closeList();
      out.push('<br>');
      continue;
    }
    if (isTableStart(lines, index)) {
      closeList();
      const tableRows = [raw, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && !/^\s*$/.test(lines[index])) {
        tableRows.push(lines[index]);
        index += 1;
      }
      index -= 1;
      out.push(renderMarkdownTable(tableRows));
    } else if (/^#{2,}\s+/.test(raw)) {
      closeList();
      out.push(`<h4>${applyInline(raw.replace(/^#+\s+/, ''))}</h4>`);
    } else if (/^#\s+/.test(raw)) {
      closeList();
      out.push(`<h3>${applyInline(raw.replace(/^#\s+/, ''))}</h3>`);
    } else if (/^(\s*[-*_]\s*){3,}$/.test(raw)) {
      closeList();
      out.push('<hr>');
    } else if (/^[-*]\s+/.test(raw)) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${applyInline(raw.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (/^\d+\.\s+/.test(raw)) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${applyInline(raw.replace(/^\d+\.\s+/, ''))}</li>`);
    } else if (/^&gt;\s+/.test(raw)) {
      closeList();
      out.push(`<blockquote>${applyInline(raw.replace(/^&gt;\s+/, ''))}</blockquote>`);
    } else {
      closeList();
      out.push(`<p>${applyInline(raw)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

function renderUserText(content) {
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function classifyAnswer(message) {
  const text = `${message.content || ''}`.toLowerCase();
  const complianceTerms = [
    'visa', 'dso', 'sevis', 'uscis', 'i-20', 'opt', 'cpt', 'work authorization',
    'off-campus', 'off campus', 'ukvi', 'cas', 'brp', 'student visa', 'mohe',
    'scholarship', 'insurance', 'academic standing', 'probation',
  ];
  const isCompliance = !!message.escalation || message.webSearched || message.sources?.length || complianceTerms.some((term) => text.includes(term));

  if (message.escalation?.level === 'urgent') {
    return {
      level: 'high',
      label: 'High risk',
      detail: 'Do not act on this alone. Confirm with your university office, sponsor, or embassy contact first.',
      relevant: true,
    };
  }

  if (message.escalation || isCompliance) {
    return {
      level: 'medium',
      label: 'Check before acting',
      detail: 'Rules can depend on your exact status, sponsor approval, and university policy.',
      relevant: true,
    };
  }

  return {
    level: 'low',
    label: 'General guidance',
    detail: 'Useful for planning. Ask a follow-up if your visa, scholarship, or deadline is involved.',
    relevant: false,
  };
}

function renderAnswerStatus(message) {
  const risk = classifyAnswer(message);
  const sourceCount = message.sources?.length || 0;
  const sourceLabel = sourceCount
    ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} used`
    : 'No source shown';
  const webLabel = message.webSearched ? 'Current rules checked' : 'Saved rules used';
  const destinationLabel = message.destination && DEST_LABEL[message.destination]
    ? DEST_LABEL[message.destination]
    : DEST_LABEL[state.settings.destination] || 'Auto';

  return `
    <div class="answer-status answer-status-${risk.level}">
      <div>
        <span class="answer-status-label">${escapeHtml(risk.label)}</span>
        <span class="answer-status-detail">${escapeHtml(risk.detail)}</span>
      </div>
      <div class="answer-status-pills">
        <span>${escapeHtml(destinationLabel)}</span>
        <span>${escapeHtml(webLabel)}</span>
        <span>${escapeHtml(sourceLabel)}</span>
      </div>
    </div>
  `;
}

function renderSources(sources) {
  if (!sources?.length) return '';
  const chips = sources.map(s => {
    if (s.type === 'kb') {
      return `<span class="source-chip source-chip-kb" title="${escapeHtml(s.id)}"><span class="source-kind">${escapeHtml(s.category || 'OmanX dataset')}</span>${escapeHtml(s.title || s.id)}</span>`;
    }
    const safeUrl = /^https?:\/\//i.test(s.url) ? s.url : '#';
    return `<a class="source-chip source-chip-web" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.title || s.url)}"><span class="source-kind">${escapeHtml(s.category || 'Official web')}</span>${escapeHtml(s.domain || s.url)}</a>`;
  }).join('');
  return `<div class="message-sources"><span class="sources-label">Verified sources</span><div class="source-chip-list">${chips}</div></div>`;
}

function renderMessageAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return '';
  return `<div class="message-attachments">
    ${attachments.map((item) => `
      <span class="message-attachment-chip">
        <span>${escapeHtml(item.name || 'Image')}</span>
        <small>${escapeHtml(formatBytes(item.size))}</small>
      </span>
    `).join('')}
  </div>`;
}

function renderEscalationCard(card) {
  if (!card) return '';
  const isUrgentLevel = card.level === 'urgent';
  const stepsHtml = (card.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const formsHtml = card.forms?.length
    ? `<div class="escalation-forms"><span class="escalation-label">Relevant forms</span>${card.forms.map(f => `<span class="escalation-form-tag">${escapeHtml(f)}</span>`).join('')}</div>`
    : '';
  const embassyHtml = card.embassy
    ? `<div class="escalation-contact"><strong>${escapeHtml(card.embassy.name)}</strong><span>${escapeHtml(card.embassy.note)}</span></div>`
    : '';
  return `
    <div class="escalation-card ${isUrgentLevel ? 'escalation-urgent' : 'escalation-warning'}">
      <div class="escalation-header">
        <span class="escalation-title">${escapeHtml(card.title)}</span>
        <span class="escalation-badge">${isUrgentLevel ? 'Action required' : 'Heads up'}</span>
      </div>
      <ol class="escalation-steps">${stepsHtml}</ol>
      ${formsHtml}
      ${embassyHtml}
      <div class="escalation-dso">${escapeHtml(card.dsoNote)}</div>
    </div>
  `;
}
