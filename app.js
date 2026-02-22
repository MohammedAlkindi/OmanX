// app.js - OmanX frontend application

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const chat = document.getElementById('chat');
const sendBtn = document.getElementById('send');
const clearBtn = document.getElementById('clearBtn');
const statusPill = document.getElementById('statusPill');
const statusBanner = document.getElementById('statusBanner');

const STORAGE_KEY = 'omanx.chat.messages.v1';

function setServiceState(state, text) {
  statusPill.dataset.state = state;
  const textEl = statusPill.querySelector('.pill-text');
  if (textEl) textEl.textContent = text;

  const offline = state === 'offline';
  statusBanner.hidden = !offline;
}

function autoResize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

function createMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `msg ${role === 'user' ? 'me' : 'bot'}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'You' : 'OX';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  return { wrapper, bubble };
}

function persistMessages() {
  const data = [];
  messages.querySelectorAll('.msg').forEach((el) => {
    const role = el.classList.contains('me') ? 'user' : 'assistant';
    const bubble = el.querySelector('.bubble');
    data.push({ role, text: bubble ? bubble.textContent : '' });
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data.slice(-40)));
}

function addMessage(role, text) {
  const { wrapper } = createMessage(role, text);
  messages.appendChild(wrapper);
  scrollToBottom();
  persistMessages();
}

function loadMessages() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    addMessage('assistant', 'Welcome to OmanX. Ask a question to begin.');
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      addMessage('assistant', 'Welcome to OmanX. Ask a question to begin.');
      return;
    }

    messages.innerHTML = ''; // Clear default welcome message
    parsed.forEach((m) => {
      if (!m || typeof m.text !== 'string') return;
      addMessage(m.role === 'user' ? 'user' : 'assistant', m.text);
    });
  } catch {
    addMessage('assistant', 'Welcome to OmanX. Ask a question to begin.');
  }
}

async function checkHealth() {
  try {
    // Try both endpoints for maximum compatibility
    const res = await fetch('/api/ready', { method: 'GET' }).catch(() => null);
    if (!res || !res.ok) {
      // Fallback to non-api route
      const fallbackRes = await fetch('/ready', { method: 'GET' });
      if (fallbackRes.ok) {
        setServiceState('online', 'Online');
      } else {
        setServiceState('offline', 'Offline');
      }
    } else {
      setServiceState('online', 'Online');
    }
  } catch {
    setServiceState('offline', 'Offline');
  }
}

async function sendMessage(message) {
  setServiceState('busy', 'Thinking…');

  const { wrapper, bubble } = createMessage('assistant', '');
  bubble.textContent = '…';
  messages.appendChild(wrapper);
  scrollToBottom();

  try {
    // Try /api/chat first, fallback to /chat
    let res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }).catch(() => null);

    // If /api/chat fails, try /chat
    if (!res || !res.ok) {
      res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
    }

    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error || 'Request failed');
    }

    bubble.textContent = payload.text || 'No response generated.';
    setServiceState('online', 'Online');
  } catch (err) {
    console.error('Chat error:', err);
    bubble.textContent = `I couldn't complete this request. ${err.message || 'Please try again.'}`;
    setServiceState('offline', 'Offline');
  }

  persistMessages();
  scrollToBottom();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message) return;

  addMessage('user', message);
  input.value = '';
  autoResize();

  sendBtn.disabled = true;
  await sendMessage(message);
  sendBtn.disabled = false;
  input.focus();
});

input.addEventListener('input', autoResize);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

clearBtn.addEventListener('click', () => {
  messages.innerHTML = '';
  localStorage.removeItem(STORAGE_KEY);
  addMessage('assistant', 'Chat cleared. Ask a new question when ready.');
  input.focus();
});

// Initial setup
checkHealth();
setInterval(checkHealth, 30000);
loadMessages();
autoResize();