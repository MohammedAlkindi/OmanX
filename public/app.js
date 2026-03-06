// app.js - OmanX frontend application

document.addEventListener('DOMContentLoaded', function() {
  document.body.classList.add('loaded');
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Tab') document.body.classList.add('keyboard-nav');
});

document.addEventListener('mousedown', function() {
  document.body.classList.remove('keyboard-nav');
});

window.addEventListener('scroll', function() {
  const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
  const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const scrolled = (winScroll / height) * 100;
  const progressBar = document.querySelector('.scroll-progress');
  if (progressBar) progressBar.style.width = scrolled + '%';
});

const form       = document.getElementById('form');
const input      = document.getElementById('input');
const messages   = document.getElementById('messages');
const chat       = document.getElementById('chat');
const sendBtn    = document.getElementById('send');
const clearBtn   = document.getElementById('clearBtn');
const statusPill = document.getElementById('statusPill');
const statusBanner = document.getElementById('statusBanner');
const authForm   = document.getElementById('authForm');
const emailInput = document.getElementById('emailInput');
const loginBtn   = document.getElementById('loginBtn');
const logoutBtn  = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');

let currentUser = null;
const STORAGE_KEY = 'omanx.chat.messages.v1';

function setServiceState(state, text) {
  statusPill.dataset.state = state;
  const textEl = statusPill.querySelector('.pill-text');
  if (textEl) textEl.textContent = text;
  statusBanner.hidden = state !== 'offline';
}

function autoResize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

function scrollToBottom() {
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
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
    messages.innerHTML = '';
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
    const res = await fetch('/api/ready', { method: 'GET' }).catch(() => null);
    if (!res || !res.ok) {
      const fallbackRes = await fetch('/ready', { method: 'GET' });
      setServiceState(fallbackRes.ok ? 'online' : 'offline', fallbackRes.ok ? 'Online' : 'Offline');
    } else {
      setServiceState('online', 'Online');
    }
  } catch {
    setServiceState('offline', 'Offline');
  }
}

function setAuthState({ authenticated, user, message }) {
  currentUser = authenticated ? user : null;
  if (logoutBtn) logoutBtn.hidden = !authenticated;
  if (loginBtn) loginBtn.disabled = !!authenticated;
  if (emailInput) emailInput.disabled = !!authenticated;
  sendBtn.disabled = !authenticated;
  input.disabled = !authenticated;

  if (authenticated) {
    input.placeholder = 'Ask a question…';
    if (authStatus) authStatus.textContent = message || `Signed in as ${user?.email || user?.id}.`;
  } else {
    input.placeholder = 'Sign in to start chatting…';
    if (authStatus) authStatus.textContent = message || 'Sign in to access personalized compliance guidance.';
  }
}

async function refreshSession() {
  try {
    const res = await fetch('/api/auth/session');
    if (!res.ok) { setAuthState({ authenticated: false }); return; }
    const payload = await res.json();
    setAuthState({ authenticated: true, user: payload.user });
  } catch {
    setAuthState({ authenticated: false, message: 'Unable to reach auth service.' });
  }
}

async function completeMagicLinkIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (!tokenHash || !type) return;
  if (authStatus) authStatus.textContent = 'Completing sign-in…';
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_hash: tokenHash, type }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || 'Sign-in failed.');
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
    setAuthState({ authenticated: true, user: payload.user, message: 'Sign-in complete.' });
  } catch (err) {
    setAuthState({ authenticated: false, message: err.message || 'Sign-in failed.' });
  }
}

async function sendMessage(message) {
  setServiceState('busy', 'Thinking…');

  const { wrapper, bubble } = createMessage('assistant', '');
  bubble.textContent = '…';
  messages.appendChild(wrapper);
  scrollToBottom();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.error || 'Request failed');
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
  sendBtn.disabled = false; // always re-enable since auth is bypassed
  input.focus();
});

input.addEventListener('input', autoResize);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

if (authForm) {
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;
    loginBtn.disabled = true;
    authStatus.textContent = 'Sending magic link…';
    try {
      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Unable to send magic link.');
      authStatus.textContent = 'Check your email for the sign-in link.';
    } catch (err) {
      authStatus.textContent = err.message || 'Unable to send magic link.';
    } finally {
      loginBtn.disabled = false;
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setAuthState({ authenticated: false, message: 'Signed out.' });
  });
}

clearBtn.addEventListener('click', () => {
  messages.innerHTML = '';
  localStorage.removeItem(STORAGE_KEY);
  addMessage('assistant', 'Chat cleared. Ask a new question when ready.');
  input.focus();
});

// ── Init ──────────────────────────────────────────────────────────────────────
checkHealth();
setInterval(checkHealth, 30000);
loadMessages();
autoResize();

// Auth temporarily bypassed — remove this block and uncomment the lines below when re-enabling
setAuthState({ authenticated: true, user: { id: 'dev', email: 'dev@omanx.com' } });

// Uncomment when auth is re-enabled:
// (async () => {
//   await completeMagicLinkIfPresent();
//   await refreshSession();
// })();