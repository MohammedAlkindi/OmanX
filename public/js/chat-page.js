import { initCore, qs, qsa, formatDateTime, formatRelative, showToast, uid, downloadFile, copyText, setTheme, getTheme } from './core.js';
import { loadChats, saveChats, getActiveChatId, setActiveChatId, createChat, updateChat, deleteChat, loadSettings, saveSettings, getSessionId } from './chat-store.js';

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
};

const ONBOARDED_KEY = 'omanx.onboarded.v1';
const DEST_LABEL = { auto: 'Auto', us: 'US', uk: 'UK', au: 'AU' };
const DEST_FULL_LABEL = { auto: 'Auto-detect', us: 'United States', uk: 'United Kingdom', au: 'Australia' };
const THINKING_STAGES = ['Checking your question...', 'Reading saved rules...', 'Writing guidance...'];

// Tracks which chatId is actively streaming; null when idle.
let streamingChatId = null;
let thinkingTimer = null;

const feedbackState = new Map(); // messageId -> 'up' | 'down'

initCore({ page: 'chat' });
ensureActiveChat();
render();
bindEvents();
refreshUsage();
if (!localStorage.getItem(ONBOARDED_KEY)) showOnboarding();

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
  setActiveChatId(state.activeChatId);
  persist();
}

function persist() {
  saveChats(state.chats);
  setActiveChatId(state.activeChatId);
}

function setTyping(value) {
  state.typing = value;
  const btn = qs('[data-send-btn]');
  if (btn) btn.disabled = value;
  if (value) {
    let stage = 0;
    thinkingTimer = setInterval(() => {
      stage = (stage + 1) % THINKING_STAGES.length;
      const el = qs('[data-thinking-status]');
      if (el) el.textContent = THINKING_STAGES[stage];
    }, 1800);
  } else {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
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
      const chat = createChat({ title: 'New chat' });
      state.chats.unshift(chat);
      state.activeChatId = chat.id;
      qs('[data-chat-sidebar]')?.classList.remove('open');
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
    if (!content || state.typing) return;

    appendMessage('user', content);
    textarea.value = '';
    autoGrow(textarea);
    setTyping(true);
    renderMessages();
    qs('[data-message-list]').scrollTop = qs('[data-message-list]').scrollHeight;

    await streamAssistantReply(content);
    render();
  });

  qs('[data-chat-input]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      qs('[data-chat-form]').requestSubmit();
    }
  });

  qs('[data-chat-input]')?.addEventListener('input', (event) => autoGrow(event.target));

  // — settings panel —
  populateSettingsPanel();

  qsa('[data-settings-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      qs('[data-settings-panel]').classList.add('open');
    });
  });

  qs('[data-settings-close]')?.addEventListener('click', () => {
    qs('[data-settings-panel]').classList.remove('open');
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
    saveSettings(state.settings);
    updateUserChip();
  });

  // context
  qs('[data-setting-context]')?.addEventListener('change', (e) => {
    state.settings.userContext = e.target.value.trim();
    saveSettings(state.settings);
  });

  qs('[data-setting-situation]')?.addEventListener('change', (e) => {
    state.settings.situation = e.target.value;
    saveSettings(state.settings);
  });

  qs('[data-setting-scholarship]')?.addEventListener('change', (e) => {
    state.settings.scholarshipStatus = e.target.value;
    saveSettings(state.settings);
  });

  // concise mode
  qs('[data-setting-concise]')?.addEventListener('change', (e) => {
    state.settings.conciseMode = e.target.checked;
    saveSettings(state.settings);
  });

  // model
  qs('[data-setting-model]')?.addEventListener('change', (e) => {
    state.settings.model = e.target.value;
    saveSettings(state.settings);
    showToast('Model updated.');
  });

  // web search
  qs('[data-setting-web-search]')?.addEventListener('change', (e) => {
    state.settings.webSearch = e.target.checked;
    saveSettings(state.settings);
    populateSettingsPanel();
  });

  // destination
  qs('[data-setting-destination]')?.addEventListener('change', (e) => {
    state.settings.destination = e.target.value;
    saveSettings(state.settings);
    populateSettingsPanel();
    updateMobileChatContext();
  });

  // language
  qs('[data-setting-language]')?.addEventListener('change', (e) => {
    state.settings.language = e.target.value;
    saveSettings(state.settings);
  });

  // data consent
  qs('[data-setting-data-consent]')?.addEventListener('change', (e) => {
    state.settings.dataConsent = e.target.checked;
    saveSettings(state.settings);
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
  const { studentName, userContext, conciseMode, model, language, destination, situation, scholarshipStatus, dataConsent, webSearch } = state.settings;

  const nameEl = qs('[data-setting-name]');
  if (nameEl) nameEl.value = studentName === 'Student' ? '' : studentName;

  const ctxEl = qs('[data-setting-context]');
  if (ctxEl) ctxEl.value = userContext || '';

  const conciseEl = qs('[data-setting-concise]');
  if (conciseEl) conciseEl.checked = !!conciseMode;

  const modelEl = qs('[data-setting-model]');
  if (modelEl) modelEl.value = model;

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

async function refreshUsage() {
  try {
    const res = await fetch(`/api/usage?sessionId=${encodeURIComponent(getSessionId())}`, { cache: 'no-store' });
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.usage) {
      state.usage = payload.usage;
      renderUsagePanel();
    }
  } catch {
    renderUsagePanel();
  }
}

function setUsage(usage) {
  if (!usage) return;
  state.usage = usage;
  renderUsagePanel();
}

function formatReset(usage) {
  if (!usage?.resetInMs) return 'soon';
  const totalSeconds = Math.max(Math.ceil(usage.resetInMs / 1000), 0);
  if (totalSeconds < 60) return `${totalSeconds}s`;
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
    if (percentEl) percentEl.textContent = 'Not available';
    if (meterEl) meterEl.style.width = '0%';
    if (detailEl) detailEl.textContent = 'Usage is tracked by the server once you send a message.';
    return;
  }

  const usage = state.usage;
  if (percentEl) percentEl.textContent = `${usage.percentUsed}% used`;
  if (meterEl) meterEl.style.width = `${Math.min(Math.max(usage.percentUsed, 0), 100)}%`;
  if (detailEl) {
    detailEl.textContent = `${usage.remaining} of ${usage.limit} messages left. Resets in ${formatReset(usage)}.`;
  }
  panel.classList.toggle('usage-panel-warning', usage.percentUsed >= 80);
}

function showOnboarding() {
  const overlay = qs('[data-onboarding]');
  if (!overlay) return;
  overlay.hidden = false;

  let selectedDest = 'auto';
  let selectedSituation = state.settings.situation || 'Current student';

  qsa('[data-dest]', overlay).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('[data-dest]', overlay).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedDest = btn.dataset.dest;
      qs('[data-ob-step="1"]', overlay).hidden = true;
      qs('[data-ob-step="2"]', overlay).hidden = false;
    });
  });

  qsa('[data-situation]', overlay).forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('[data-situation]', overlay).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSituation = btn.dataset.situation;
      qs('[data-ob-step="2"]', overlay).hidden = true;
      qs('[data-ob-step="3"]', overlay).hidden = false;
      qs('[data-onboarding-name]', overlay)?.focus();
    });
  });

  function completeOnboarding() {
    const name = (qs('[data-onboarding-name]', overlay)?.value || '').trim();
    if (name) {
      state.settings.studentName = name;
    }
    state.settings.destination = selectedDest;
    state.settings.situation = selectedSituation;
    saveSettings(state.settings);
    localStorage.setItem(ONBOARDED_KEY, '1');
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
        <div class="thinking-status" data-thinking-status>Checking...</div>
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
            model: state.settings.model,
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

async function streamAssistantReply(message) {
  const chat = getActiveChat();
  streamingChatId = chat.id;
  const history = chat.messages
    .slice(0, -1)
    .slice(-20)
    .map(({ role, content }) => ({ role, content }));

  const { model, conciseMode, userContext, language, destination, webSearch } = state.settings;
  const profileContext = buildProfileContext(userContext);

  let fullText = '';
  let didWebSearch = false;
  let didSources = [];
  let didEscalation = null;
  let didDestination = null;
  let didUsage = null;
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
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, model, conciseMode, userContext: profileContext, language, destination: destination || 'auto', webSearch: webSearch !== false, stream: true, sessionId: getSessionId() }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload.usage) didUsage = payload.usage;
      fullText = `**Error:** ${payload.error || payload.text || `Server error (HTTP ${response.status})`}`;
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
  appendMessage('assistant', fullText.trim() || 'No response generated.', chat.id, { webSearched: didWebSearch, sources: didSources, escalation: didEscalation, destination: didDestination });
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

function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
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

  for (const raw of lines) {
    if (/^\s*$/.test(raw)) {
      closeList();
      out.push('<br>');
      continue;
    }
    if (/^#{2,}\s+/.test(raw)) {
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
      return `<span class="source-chip source-chip-kb" title="${escapeHtml(s.id)}">${escapeHtml(s.title || s.id)}</span>`;
    }
    const safeUrl = /^https?:\/\//i.test(s.url) ? s.url : '#';
    return `<a class="source-chip source-chip-web" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.title)}">${escapeHtml(s.domain)}</a>`;
  }).join('');
  return `<div class="message-sources"><span class="sources-label">Sources used</span>${chips}</div>`;
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
