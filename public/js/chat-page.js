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

function bindEvents() {
  qs('[data-new-chat]')?.addEventListener('click', () => {
    const chat = createChat({ title: 'Untitled session' });
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    persist();
    render();
    showToast('New chat created.');
  });

  qs('[data-chat-search]')?.addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderSidebar();
  });

  qs('[data-chat-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const textarea = qs('[data-chat-input]');
    const content = textarea.value.trim();
    if (!content || state.typing) return;

    appendMessage('user', content);
    textarea.value = '';
    autoGrow(textarea);
    state.typing = true;
    renderMessages();

    const reply = await createAssistantReply(content, getActiveChat());
    appendMessage('assistant', reply);
    state.typing = false;
    render();
  });

  qs('[data-chat-input]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      qs('[data-chat-form]').requestSubmit();
    }
  });

  qs('[data-chat-input]')?.addEventListener('input', (event) => autoGrow(event.target));

  qs('[data-export-chat]')?.addEventListener('click', () => {
    const chat = getActiveChat();
    const content = chat.messages.map((message) => `[${message.role}] ${message.content}`).join('\n\n');
    downloadFile(`${slugify(chat.title)}.txt`, content);
    showToast('Conversation exported.');
  });

  qs('[data-copy-last]')?.addEventListener('click', async () => {
    const chat = getActiveChat();
    const message = [...chat.messages].reverse().find((item) => item.role === 'assistant');
    if (!message) return showToast('No assistant message to copy yet.');
    await copyText(message.content, 'Last assistant message copied.');
  });

  qs('[data-rename-chat]')?.addEventListener('click', () => {
    const chat = getActiveChat();
    const title = window.prompt('Rename this chat', chat.title);
    if (!title) return;
    mutateChat(chat.id, (current) => ({ ...current, title: title.trim() || current.title, updatedAt: new Date().toISOString() }));
    render();
  });

  qs('[data-delete-chat]')?.addEventListener('click', () => {
    const chat = getActiveChat();
    if (!chat || !window.confirm(`Delete "${chat.title}"?`)) return;
    state.chats = deleteChat(state.chats, chat.id);
    if (!state.chats.length) state.chats = [createChat()];
    state.activeChatId = state.chats[0].id;
    persist();
    render();
    showToast('Chat deleted.');
  });

  qsa('[data-quick-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      qs('[data-chat-input]').value = button.dataset.quickPrompt;
      autoGrow(qs('[data-chat-input]'));
      qs('[data-chat-input]').focus();
    });
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
      <div class="message-bubble">${renderRichText(message.content)}</div>
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

async function createAssistantReply(message, chat) {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ message }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        return '**Authentication required.** Please sign in to use OmanX.';
      }
      const errorMsg = payload.error || payload.text || `Server error (HTTP ${response.status})`;
      return `**Error:** ${errorMsg}`;
    }
    return payload.text;
  } catch (err) {
    return `**Network error:** ${err.message || 'Could not reach the server. Check your connection and try again.'}`;
  }
}

function buildLocalReply(message, chat, settings) {
  const lower = message.toLowerCase();
  const focus = detectFocus(lower);
  const bullets = {
    departure: [
      'Confirm passport, visa packet, I-20/DS-2019, insurance, and scholarship documents in one travel folder.',
      'Create a 7-day arrival plan covering airport transfer, temporary meals, banking, SIM card, and campus check-in.',
      'Store emergency numbers, embassy contacts, and your university international office details offline.'
    ],
    housing: [
      'Compare rent, commute time, furnished status, deposits, and lease flexibility before deciding.',
      'Inspect whether utilities, internet, and renter obligations are included so there are no budget surprises.',
      'Escalate any contract confusion to your housing office or designated advisor before signing.'
    ],
    compliance: [
      'Separate what is known, what is time-sensitive, and which official office owns the final answer.',
      'Document your situation in writing so you can explain it clearly to the DSO, embassy, insurer, or scholarship team.',
      'Do not act on assumptions when the issue touches visa status, health coverage, legal exposure, or enrollment.'
    ],
    general: [
      'Break the problem into immediate next actions, medium-term follow-up, and who should verify each step.',
      'Use OmanX conversation history to keep one thread per topic so decisions stay auditable.',
      'Summarize outcomes after each milestone to make future escalations easier.'
    ]
  };
  const selected = bullets[focus];
  const recentTopics = chat.messages.slice(-3).map((item) => item.content).join(' | ');
  return `Here is a structured OmanX response for **${settings.studentName}** focused on **${focus}**:\n\n1. ${selected[0]}\n2. ${selected[1]}\n3. ${selected[2]}\n\n**Recommended workflow**\n- Capture your goal in one sentence.\n- Prioritize the next 24-hour actions first.\n- Keep official verification attached to any high-stakes decision.\n\n**Context continuity**\nI also considered your recent conversation context: ${recentTopics || 'This is a fresh session.'}\n\nIf you want, I can turn this into a checklist, decision memo, or first-week action plan.`;
}

function detectFocus(lower) {
  if (/(visa|insurance|legal|compliance|immigration|dso|embassy|health)/.test(lower)) return 'compliance';
  if (/(housing|lease|rent|apartment|dorm)/.test(lower)) return 'housing';
  if (/(departure|airport|travel|packing|arrival|fly)/.test(lower)) return 'departure';
  return 'general';
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
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderRichText(content) {
  return escapeHtml(content)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<span class="code-inline">$1</span>')
    .replace(/\n/g, '<br>');
}
