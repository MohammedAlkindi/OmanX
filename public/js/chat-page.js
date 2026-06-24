import { initCore, qs, qsa, formatDateTime, formatRelative, showToast, uid, downloadFile, copyText, setTheme, getTheme } from './core.js';
import { loadChats, saveChats, getActiveChatId, setActiveChatId, createChat, updateChat, deleteChat, loadSettings, saveSettings, getSessionId } from './chat-store.js';

const prompts = [
  'Build me a pre-departure checklist for the 14 days before flying to the U.S.',
  'How should I prioritize first-week setup after arriving on campus?',
  'Help me compare on-campus housing vs. off-campus housing with key tradeoffs.',
  'What should I escalate immediately if I have a visa or insurance concern?'
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
};

// Tracks which chatId is actively streaming; null when idle.
let streamingChatId = null;

const feedbackState = new Map(); // messageId -> 'up' | 'down'

initCore({ page: 'chat' });
ensureActiveChat();
render();
bindEvents();

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
  const statusText = qs('[data-status-text]');
  if (btn) btn.disabled = value;
  if (statusText) statusText.textContent = value ? 'Thinking…' : 'Ready';
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
    qs('[data-chat-sidebar]').classList.toggle('open');
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
  qs('[data-new-chat]')?.addEventListener('click', () => {
    const chat = createChat({ title: 'New chat' });
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    persist();
    render();
    showToast('New chat created.');
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

  qs('[data-settings-toggle]')?.addEventListener('click', () => {
    qs('[data-settings-panel]').classList.add('open');
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
}

function populateSettingsPanel() {
  const { studentName, userContext, conciseMode, model, language, dataConsent, webSearch } = state.settings;

  const nameEl = qs('[data-setting-name]');
  if (nameEl) nameEl.value = studentName === 'Student' ? '' : studentName;

  const ctxEl = qs('[data-setting-context]');
  if (ctxEl) ctxEl.value = userContext || '';

  const conciseEl = qs('[data-setting-concise]');
  if (conciseEl) conciseEl.checked = !!conciseMode;

  const modelEl = qs('[data-setting-model]');
  if (modelEl) modelEl.value = model;

  const langEl = qs('[data-setting-language]');
  if (langEl) langEl.value = language || 'auto';

  const consentEl = qs('[data-setting-data-consent]');
  if (consentEl) consentEl.checked = !!dataConsent;

  const webSearchEl = qs('[data-setting-web-search]');
  if (webSearchEl) webSearchEl.checked = webSearch !== false;

  updateThemePicker(getTheme());
  updateUserChip();
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

function render() {
  renderSidebar();
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
                <button type="button" data-export-item>Export</button>
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

    // export
    item.querySelector('[data-export-item]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = true;
      const chat = state.chats.find((c) => c.id === chatId);
      const content = chat.messages.map((m) => `[${m.role}] ${m.content}`).join('\n\n');
      downloadFile(`${slugify(chat.title)}.txt`, content);
      showToast('Conversation exported.');
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
      <div class="message-bubble">${message.role === 'assistant' ? renderRichText(message.content) : renderUserText(message.content)}</div>
      ${message.role === 'assistant' ? renderSources(message.sources) : ''}
      ${message.role === 'assistant' ? renderEscalationCard(message.escalation) : ''}
      <div class="message-meta">
        <span>${message.role === 'assistant' ? 'OmanX' : state.settings.studentName}</span>
        <span>${formatDateTime(message.createdAt)}</span>
        ${message.role === 'assistant' ? `
          <span class="message-tools">
            ${message.webSearched ? '<span class="web-search-badge" title="Live web search was used for this response">Web search</span>' : ''}
            <button type="button" data-copy-message="${message.id}">Copy</button>
            <span class="feedback-buttons" data-feedback-id="${message.id}">
              <button type="button" class="feedback-btn ${feedbackState.get(message.id) === 'up' ? 'feedback-submitted' : ''}" data-feedback-up="${message.id}" title="Helpful" aria-label="Mark as helpful">
                ${feedbackState.get(message.id) === 'up' ? '✓' : '↑'}
              </button>
              <button type="button" class="feedback-btn ${feedbackState.get(message.id) === 'down' ? 'feedback-submitted' : ''}" data-feedback-down="${message.id}" title="Not helpful" aria-label="Mark as not helpful">
                ${feedbackState.get(message.id) === 'down' ? '✓' : '↓'}
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
      <div class="message-bubble"><div class="typing"><span></span><span></span><span></span></div></div>
      <div class="message-meta"><span>OmanX</span><span>Thinking</span></div>
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
        b.textContent = b.dataset[`feedback${rating === 'up' ? 'Up' : 'Down'}`] === messageId ? '✓' : '–';
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

  const { model, conciseMode, userContext, language, webSearch } = state.settings;

  let fullText = '';
  let didWebSearch = false;
  let didSources = [];
  let didEscalation = null;
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
      body: JSON.stringify({ message, history, model, conciseMode, userContext, language, webSearch: webSearch !== false, stream: true, sessionId: getSessionId() }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
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
            if (data.done) { if (data.webSearched) didWebSearch = true; if (data.sources) didSources = data.sources; if (data.escalation) didEscalation = data.escalation; }
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
  appendMessage('assistant', fullText.trim() || 'No response generated.', chat.id, { webSearched: didWebSearch, sources: didSources, escalation: didEscalation });
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

function emptyStateMarkup() {
  return `
    <section class="message-empty">
      <h3>Start a high-trust guidance session</h3>
      <p>Create a focused conversation for travel readiness, arrival setup, housing, compliance, or academic planning.</p>
      <div class="quick-prompts">
        ${prompts.map((prompt) => `<button type="button" data-quick-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}
      </div>
    </section>
  `;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'omanx-chat';
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

function renderSources(sources) {
  if (!sources?.length) return '';
  const chips = sources.map(s => {
    if (s.type === 'kb') {
      return `<span class="source-chip source-chip-kb" title="${escapeHtml(s.id)}">${escapeHtml(s.title || s.id)}</span>`;
    }
    return `<a class="source-chip source-chip-web" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(s.title)}">${escapeHtml(s.domain)}</a>`;
  }).join('');
  return `<div class="message-sources"><span class="sources-label">Sources</span>${chips}</div>`;
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
        <span class="escalation-icon" aria-hidden="true">${isUrgentLevel ? '▲' : '!'}</span>
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
