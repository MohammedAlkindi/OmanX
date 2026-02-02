// app.js — OmanX MVP (frontend)
// Goals:
// - Minimal assistant UI with structured responses
// - Health check + graceful offline banner

const chatEl = document.getElementById("chat");
const formEl = document.getElementById("form");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clearBtn");
const statusPill = document.getElementById("statusPill");
const statusBanner = document.getElementById("statusBanner");
const statusBannerText = statusBanner?.querySelector(".status-banner-text");
const messagesEl = document.getElementById("messages");
const yearEl = document.getElementById("year");

// Optional mode toggles (if present in your HTML)
const modeOfficialBtn = document.getElementById("modeOfficial");
const modeCommunityBtn = document.getElementById("modeCommunity");

const DEMO_ERROR = "Sorry, I couldn't reach the OmanX service. Please try again.";
const DEFAULT_OFFLINE_MESSAGE =
  "Service unavailable. We will not guess—please contact the relevant office.";
const API_BASE_ERROR_MESSAGE =
  "Service unavailable. API endpoint not found. Set the API base or contact the relevant office.";

if (yearEl) yearEl.textContent = new Date().getFullYear();

const setStatus = (state, text) => {
  if (!statusPill) return;
  const el = statusPill.querySelector(".pill-text");
  if (el) el.textContent = text;
  statusPill.dataset.state = state;

  if (statusBanner) {
    statusBanner.hidden = state !== "offline";
  }
};

const setStatusBanner = (text) => {
  if (!statusBannerText) return;
  statusBannerText.textContent = text;
};

const scrollToBottom = () => {
  if (!chatEl) return;
  chatEl.scrollTop = chatEl.scrollHeight;
};

const createMessage = (role, text) => {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "me" ? "You" : "OmanX";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);

  return wrapper;
};

const addMessage = (role, text) => {
  const target = messagesEl || chatEl;
  if (!target) return;
  target.appendChild(createMessage(role, text));
  scrollToBottom();
};

const setLoading = (isLoading) => {
  if (!sendBtn) return;
  sendBtn.disabled = isLoading;
  const t = sendBtn.querySelector(".send-text");
  if (t) t.textContent = isLoading ? "Sending…" : "Send";
};

// -----------------------------
// API base resolution
// -----------------------------
function getApiBase() {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("api");
    if (q) return q.replace(/\/+$/, "");
  } catch {}

  if (typeof window !== "undefined" && window.OMANX_API_BASE) {
    return String(window.OMANX_API_BASE).replace(/\/+$/, "");
  }

  const meta = document.querySelector('meta[name="omanx-api-base"]');
  if (meta?.content) return meta.content.trim().replace(/\/+$/, "");

  return "";
}

const API_BASE = getApiBase();
const apiUrl = (p) => `${API_BASE}${p.startsWith("/") ? p : `/${p}`}`;

// -----------------------------
// Mode selection (official/community)
// -----------------------------
let mode = "official";

function setMode(next) {
  mode = next;

  if (modeOfficialBtn && modeCommunityBtn) {
    if (mode === "official") {
      modeOfficialBtn.classList.add("on");
      modeCommunityBtn.classList.remove("on");
      modeOfficialBtn.setAttribute("aria-selected", "true");
      modeCommunityBtn.setAttribute("aria-selected", "false");
    } else {
      modeCommunityBtn.classList.add("on");
      modeOfficialBtn.classList.remove("on");
      modeCommunityBtn.setAttribute("aria-selected", "true");
      modeOfficialBtn.setAttribute("aria-selected", "false");
    }
  }
}

modeOfficialBtn?.addEventListener("click", () => setMode("official"));
modeCommunityBtn?.addEventListener("click", () => setMode("community"));

// -----------------------------
// Connectivity check
// -----------------------------
async function checkHealth() {
  try {
    const r = await fetch(apiUrl("/health"), { method: "GET" });
    if (!r.ok) {
      setStatusBanner(r.status === 404 ? API_BASE_ERROR_MESSAGE : DEFAULT_OFFLINE_MESSAGE);
      throw new Error(`health ${r.status}`);
    }
    setStatus("online", "Online");
    return true;
  } catch {
    setStatusBanner(DEFAULT_OFFLINE_MESSAGE);
    setStatus("offline", "Offline");
    return false;
  }
}

// -----------------------------
// Send message
// -----------------------------
const sendMessage = async (message) => {
  addMessage("me", message);
  setLoading(true);
  setStatus("busy", "Thinking");

  try {
    const response = await fetch(apiUrl("/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      if (response.status === 404) {
        setStatusBanner(API_BASE_ERROR_MESSAGE);
      } else {
        setStatusBanner(DEFAULT_OFFLINE_MESSAGE);
      }
      const errMsg = payload?.error
        ? `${payload.error} (HTTP ${response.status})`
        : `Request failed: HTTP ${response.status}`;
      throw new Error(errMsg);
    }

    addMessage("bot", payload?.text || "I couldn't generate a response right now.");
    setStatus("online", "Online");
  } catch (error) {
    console.error(error);
    const msg = error?.message?.includes("HTTP")
      ? `Sorry — the service returned an error. ${error.message}`
      : DEMO_ERROR;

    addMessage("bot", msg);
    setStatusBanner(DEFAULT_OFFLINE_MESSAGE);
    setStatus("offline", "Offline");
  } finally {
    setLoading(false);
  }
};

// -----------------------------
// Event handlers
// -----------------------------
if (formEl && inputEl) {
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = inputEl.value.trim();
    if (!message) return;

    inputEl.value = "";
    sendMessage(message);
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formEl.requestSubmit();
    }
  });
}

if (clearBtn && chatEl) {
  clearBtn.addEventListener("click", () => {
    if (messagesEl) {
      messagesEl.innerHTML = "";
    } else {
      chatEl.innerHTML = "";
    }
  });
}

// -----------------------------
// Boot
// -----------------------------
setMode("official");
checkHealth();

if (API_BASE) {
  console.log("[OmanX] Using API base:", API_BASE);
}
