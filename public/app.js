const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const clearBtn = document.getElementById("clearBtn");
const statusPill = document.getElementById("statusPill");
const statusBanner = document.getElementById("statusBanner");

const authPanel = document.getElementById("authPanel");
const authForm = document.getElementById("authForm");
const emailInput = document.getElementById("emailInput");
const authStatus = document.getElementById("authStatus");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const STORAGE_KEY = "omanx.chat.messages.v1";

let session = { authenticated: false, user: null };

function setOnlineState(online) {
  if (!statusPill || !statusBanner) return;
  const text = statusPill.querySelector(".pill-text");
  if (text) text.textContent = online ? "Online" : "Unavailable";
  statusPill.classList.toggle("offline", !online);
  statusBanner.hidden = online;
}

async function pingHealth() {
  try {
    const res = await fetch("/api/health");
    setOnlineState(res.ok);
  } catch {
    setOnlineState(false);
  }
}

function setComposerEnabled(enabled) {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  input.placeholder = enabled
    ? "Ask a question…"
    : "Sign in to send messages…";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  const chatContainer = document.getElementById("chat");
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function renderMessage(message) {
  const row = document.createElement("div");
  row.className = `msg ${message.role === "assistant" ? "bot" : "user"}`;
  row.innerHTML = `<div class="bubble">${escapeHtml(message.text)}</div>`;
  messagesEl.appendChild(row);
}

function saveMessages() {
  const nodes = [...messagesEl.querySelectorAll(".msg")];
  const serialized = nodes.map((node) => ({
    role: node.classList.contains("bot") ? "assistant" : "user",
    text: node.querySelector(".bubble")?.textContent || "",
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
}

function loadMessages() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    parsed.forEach(renderMessage);
    scrollToBottom();
    return true;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

function addMessage(role, text) {
  renderMessage({ role, text });
  saveMessages();
  scrollToBottom();
}

window.addMessage = addMessage;

function setAuthUi(authenticated, email = "") {
  session.authenticated = authenticated;
  authPanel.hidden = false;
  loginBtn.hidden = authenticated;
  logoutBtn.hidden = !authenticated;
  emailInput.disabled = authenticated;
  if (authenticated) {
    authStatus.textContent = `Signed in as ${email}`;
    authStatus.className = "auth-status success";
  } else {
    authStatus.textContent = "Sign in to access personalized compliance guidance.";
    authStatus.className = "auth-status";
  }
  setComposerEnabled(authenticated);
}

async function checkSession() {
  const res = await fetch("/api/auth/session", { credentials: "include" });
  if (!res.ok) {
    setAuthUi(false);
    return;
  }
  const payload = await res.json();
  if (payload.authenticated) {
    setAuthUi(true, payload.user?.email || "your account");
  } else {
    setAuthUi(false);
  }
}

async function verifyMagicLinkIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const token_hash = params.get("token_hash");
  const type = params.get("type");
  if (!token_hash || !type) return;

  authStatus.textContent = "Verifying your sign-in link…";
  authStatus.className = "auth-status";

  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token_hash, type }),
  });

  const payload = await res.json();
  if (!res.ok) {
    authStatus.textContent = payload.error || "Verification failed.";
    authStatus.className = "auth-status error";
    return;
  }

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, "", cleanUrl);
}

async function sendMessage(message) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ message }),
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.error || payload.text || "Chat request failed.");
  }
  return payload.text;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message || !session.authenticated) return;

  addMessage("user", message);
  input.value = "";

  const pending = document.createElement("div");
  pending.className = "msg bot pending";
  pending.innerHTML = `<div class="bubble">Thinking…</div>`;
  messagesEl.appendChild(pending);
  scrollToBottom();

  sendBtn.disabled = true;

  try {
    const reply = await sendMessage(message);
    pending.remove();
    addMessage("assistant", reply);
  } catch (error) {
    pending.remove();
    addMessage("assistant", `Sorry — ${error.message}`);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

clearBtn.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  localStorage.removeItem(STORAGE_KEY);
  addMessage("assistant", "Chat cleared. Ask a new question anytime.");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  if (!email) return;

  authStatus.textContent = "Sending magic link…";
  authStatus.className = "auth-status";
  loginBtn.disabled = true;

  try {
    const res = await fetch("/api/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Unable to send magic link.");
    authStatus.textContent = "Magic link sent. Check your email to continue.";
    authStatus.className = "auth-status success";
  } catch (error) {
    authStatus.textContent = error.message;
    authStatus.className = "auth-status error";
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  setAuthUi(false);
});

(async function init() {
  setComposerEnabled(false);
  await pingHealth();
  await verifyMagicLinkIfPresent();
  await checkSession();

  if (!loadMessages()) {
    addMessage("assistant", "Welcome to OmanX. Sign in, then ask your question.");
  }
})();
