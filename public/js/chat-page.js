import { initCore, qs, qsa, formatDateTime, formatRelative, showToast, uid, downloadFile, copyText } from './core.js';
import { loadChats, saveChats, getActiveChatId, setActiveChatId, createChat, updateChat, deleteChat, loadSettings } from './chat-store.js';

const prompts = [
  'Build me a pre-departure checklist for the 14 days before flying to the U.S.',
  'How should I prioritize first-week setup after arriving on campus?',
  'Help me compare on-campus housing vs. off-campus housing with key tradeoffs.',
  'What should I escalate immediately if I have a visa or insurance concern?'
];

const state = {
  chats: loadChats(),
  activeChatId: getActiveChatId(),
  filter: '',
  typing: false,
  settings: loadSettings(),
};

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

function closeMenu() {
  const menu = qs('[data-chat-menu]');
  if (menu) menu.hidden = true;
  qs('[data-chat-menu-toggle]')?.setAttribute('aria-expanded', 'false');
}

function commitRename() {
  const input = qs('[data-chat-title-input]');
  if (!input || input.hidden) return;
  const titleEl = qs('[data-chat-title]');
  const newTitle = input.value.trim();
  if (newTitle) {
    mutateChat(getActiveChat().id, (current) => ({ ...current, title: newTitle, updatedAt: new Date().toISOString() }));
    renderSidebar();
  }
  input.hidden = true;
  titleEl.hidden = false;
  renderHeader();
}

function cancelRename() {
  const input = qs('[data-chat-title-input]');
  if (!input || input.hidden) return;
  input.hidden = true;
  qs('[data-chat-title]').hidden = false;
}

function bindEvents() {
  // — sidebar toggle (mobile) —
  qs('[data-sidebar-toggle]')?.addEventListener('click', () => {
    qs('[data-chat-sidebar]').classList.toggle('open');
  });

  // — overflow menu toggle —
  qs('[data-chat-menu-toggle]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = qs('[data-chat-menu]');
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    qs('[data-chat-menu-toggle]').setAttribute('aria-expanded', String(!isOpen));
  });

  // — close menu and sidebar on outside click —
  document.addEventListener('click', (event) => {
    const menu = qs('[data-chat-menu]');
    if (menu && !menu.hidden) menu.hidden = true;

    const sidebar = qs('[data-chat-sidebar]');
    if (
      sidebar?.classList.contains('open') &&
      !sidebar.contains(event.target) &&
      !event.target.closest('[data-sidebar-toggle]')
    ) {
      sidebar.classList.remove('open');
    }
  });

  // — rename (inline) —
  qs('[data-rename-chat]')?.addEventListener('click', () => {
    closeMenu();
    const chat = getActiveChat();
    const input = qs('[data-chat-title-input]');
    const titleEl = qs('[data-chat-title]');
    input.value = chat.title;
    titleEl.hidden = true;
    input.hidden = false;
    input.select();
    input.focus();
  });

  qs('[data-chat-title-input]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
    else if (event.key === 'Escape') { cancelRename(); }
  });

  qs('[data-chat-title-input]')?.addEventListener('blur', commitRename);

  // — delete (inline confirm) —
  qs('[data-delete-chat]')?.addEventListener('click', () => {
    closeMenu();
    qs('[data-confirm-delete]').hidden = false;
  });

  qs('[data-confirm-yes]')?.addEventListener('click', () => {
    qs('[data-confirm-delete]').hidden = true;
    const chat = getActiveChat();
    state.chats = deleteChat(state.chats, chat.id);
    if (!state.chats.length) state.chats = [createChat()];
    state.activeChatId = state.chats[0].id;
    persist();
    render();
    showToast('Chat deleted.');
  });

  qs('[data-confirm-no]')?.addEventListener('click', () => {
    qs('[data-confirm-delete]').hidden = true;
  });

  // — new chat —
  qs('[data-new-chat]')?.addEventListener('click', () => {
    const chat = createChat({ title: 'Untitled session' });
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

    const reply = await createAssistantReply(content);
    appendMessage('assistant', reply);
    setTyping(false);
    render();
  });

  qs('[data-chat-input]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      qs('[data-chat-form]').requestSubmit();
    }
  });

  qs('[data-chat-input]')?.addEventListener('input', (event) => autoGrow(event.target));

  // — export —
  qs('[data-export-chat]')?.addEventListener('click', () => {
    closeMenu();
    const chat = getActiveChat();
    const content = chat.messages.map((message) => `[${message.role}] ${message.content}`).join('\n\n');
    downloadFile(`${slugify(chat.title)}.txt`, content);
    showToast('Conversation exported.');
  });

  // — copy last —
  qs('[data-copy-last]')?.addEventListener('click', async () => {
    closeMenu();
    const chat = getActiveChat();
    const message = [...chat.messages].reverse().find((item) => item.role === 'assistant');
    if (!message) return showToast('No assistant message to copy yet.');
    await copyText(message.content, 'Last assistant message copied.');
  });
}

function render() {
  renderSidebar();
  renderHeader();
  renderMessages();
}

function renderSidebar() {
  const list = qs('[data-chat-list]');
  const filtered = [...state.chats]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt))
    .filter((chat) => {
      if (!state.filter) return true;
      return `${chat.title} ${chat.category} ${chat.messages.map((m) => m.content).join(' ')}`.toLowerCase().includes(state.filter);
    });

  list.innerHTML = filtered.map((chat) => `
    <article class="chat-item ${chat.id === state.activeChatId ? 'active' : ''}" data-chat-id="${chat.id}">
      <div class="chat-item-header">
        <div>
          <div class="chat-item-title">${escapeHtml(chat.title)}</div>
          <div class="muted">${escapeHtml(chat.category)}</div>
        </div>
        <div class="chat-actions">
          <button type="button" data-pin-chat title="Pin chat">${chat.pinned ? '★' : '☆'}</button>
        </div>
      </div>
      <div class="chat-item-snippet">${escapeHtml(getSnippet(chat))}</div>
      <div class="chat-item-footer">
        <span class="pill">${chat.messages.length} messages</span>
        <span class="muted">${formatRelative(chat.updatedAt)}</span>
      </div>
    </article>
  `).join('') || '<div class="message-empty">No chats match your search.</div>';

  qsa('[data-chat-id]', list).forEach((item) => {
    item.addEventListener('click', (event) => {
      const chatId = event.currentTarget.dataset.chatId;
      if (event.target.closest('[data-pin-chat]')) return;
      state.activeChatId = chatId;
      persist();
      render();
      qs('[data-chat-sidebar]').classList.remove('open');
    });
  });

  qsa('[data-pin-chat]', list).forEach((button) => {
    button.addEventListener('click', (event) => {
      const chatId = event.currentTarget.closest('[data-chat-id]').dataset.chatId;
      event.stopPropagation();
      mutateChat(chatId, (chat) => ({ ...chat, pinned: !chat.pinned, updatedAt: new Date().toISOString() }));
      renderSidebar();
    });
  });
}

function renderHeader() {
  const chat = getActiveChat();
  qs('[data-chat-title]').textContent = chat.title;
  qs('[data-chat-subtitle]').textContent = `Updated ${formatDateTime(chat.updatedAt)} · ${chat.category} workflow`;
}

function renderMessages() {
  const chat = getActiveChat();
  const container = qs('[data-message-list]');

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
      <div class="message-meta">
        <span>${message.role === 'assistant' ? 'OmanX' : state.settings.studentName}</span>
        <span>${formatDateTime(message.createdAt)}</span>
        ${message.role === 'assistant' ? `<span class="message-tools"><button type="button" data-copy-message="${message.id}">Copy</button></span>` : ''}
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

  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content) {
  const message = { id: uid('msg'), role, content, createdAt: new Date().toISOString() };
  mutateChat(state.activeChatId, (chat) => ({
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

async function createAssistantReply(message) {
  // pass all prior messages as history (current user message was just appended, exclude it)
  const chat = getActiveChat();
  const history = chat.messages
    .slice(0, -1)
    .map(({ role, content }) => ({ role, content }));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorMsg = payload.error || payload.text || `Server error (HTTP ${response.status})`;
      return `**Error:** ${errorMsg}`;
    }
    return payload.text;
  } catch (err) {
    return `**Network error:** ${err.message || 'Could not reach the server. Check your connection and try again.'}`;
  }
}

function deriveTitle(chat, role, content) {
  if (chat.title !== 'Untitled session' && chat.title !== 'New guidance session') return chat.title;
  if (role !== 'user') return chat.title;
  return content.split(/[.!?]/)[0].slice(0, 42) || chat.title;
}

function getSnippet(chat) {
  const last = [...chat.messages].reverse().find((message) => message.role === 'assistant') || chat.messages.at(-1);
  return last?.content || 'No messages yet.';
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
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="code-inline">$1</span>');
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
