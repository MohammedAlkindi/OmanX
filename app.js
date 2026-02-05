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
const starterButtons = document.querySelectorAll(".starter");

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
  if (statusBanner) statusBanner.hidden = state !== "offline";
};

const setStatusBanner = (text) => {
  if (statusBannerText) statusBannerText.textContent = text;
};

const scrollToBottom = () => {
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
};

const createMessage = (role, text, meta = "") => {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "me" ? "You" : "OmanX";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const body = document.createElement("div");
  body.textContent = text;
  bubble.appendChild(body);

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "message-meta";
    metaEl.textContent = meta;
    bubble.appendChild(metaEl);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  return wrapper;
};

const addMessage = (role, text, meta = "") => {
  const target = messagesEl || chatEl;
  if (!target) return;
  target.appendChild(createMessage(role, text, meta));
  scrollToBottom();
};

const setLoading = (isLoading) => {
  if (!sendBtn) return;
  sendBtn.disabled = isLoading;
  sendBtn.textContent = isLoading ? "Sending…" : "Send";
};

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

const sendMessage = async (message) => {
  addMessage("me", message);
  setLoading(true);
  setStatus("busy", "Thinking");

  try {
    const response = await fetch(apiUrl("/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setStatusBanner(response.status === 404 ? API_BASE_ERROR_MESSAGE : DEFAULT_OFFLINE_MESSAGE);
      throw new Error(payload?.error ? `${payload.error} (HTTP ${response.status})` : `Request failed: HTTP ${response.status}`);
    }

    const laneMeta = payload?.lane === "strict" ? "Compliance mode • Verified KB only" : "Community mode";
    const refs = Array.isArray(payload?.kbRefs) && payload.kbRefs.length ? ` • Refs: ${payload.kbRefs.join(", ")}` : "";
    addMessage("bot", payload?.text || "I couldn't generate a response right now.", `${laneMeta}${refs}`);
    setStatus("online", "Online");
  } catch (error) {
    console.error(error);
    const msg = error?.message?.includes("HTTP")
      ? `Sorry — the service returned an error. ${error.message}`
      : DEMO_ERROR;

    addMessage("bot", msg, "Connection issue");
    setStatusBanner(DEFAULT_OFFLINE_MESSAGE);
    setStatus("offline", "Offline");
  } finally {
    setLoading(false);
  }
};

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

starterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const q = btn.dataset.query;
    if (!q) return;
    inputEl.value = q;
    formEl.requestSubmit();
  });
});

if (clearBtn && chatEl) {
  clearBtn.addEventListener("click", () => {
    if (messagesEl) messagesEl.innerHTML = "";
  });
}

addMessage(
  "bot",
  "Marhaban! I can help with student compliance questions (visa, CPT/OPT, legal/safety) and daily student life in the US.",
  "Built for Omani students"
);

checkHealth();
if (API_BASE) console.log("[OmanX] Using API base:", API_BASE);
