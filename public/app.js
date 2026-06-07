const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const clearBtn = document.getElementById("clearBtn");
const statusPill = document.getElementById("statusPill");
const statusBanner = document.getElementById("statusBanner");

const STORAGE_KEY = "omanx.chat.messages.v1";

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

async function sendMessage(message) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  if (!message) return;

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

(async function init() {
  await pingHealth();
  if (!loadMessages()) {
    addMessage("assistant", "Welcome to OmanX. Ask your question.");
  }
})();
