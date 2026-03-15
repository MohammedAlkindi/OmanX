/* ── State ───────────────────────────────────────────────────── */
let currentView = "decisions"; // decisions | overdue | today
let editingId = null;

/* ── API helpers ─────────────────────────────────────────────── */
const api = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(path) {
    const res = await fetch(path, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

/* ── DOM refs ────────────────────────────────────────────────── */
const grid          = document.getElementById("decisions-grid");
const emptyState    = document.getElementById("empty-state");
const decisionModal = document.getElementById("decisionModal");
const detailModal   = document.getElementById("detailModal");

const fTitle       = document.getElementById("f-title");
const fContext     = document.getElementById("f-context");
const fAlternatives = document.getElementById("f-alternatives");
const fConfidence  = document.getElementById("f-confidence");
const fReview      = document.getElementById("f-review");
const fTags        = document.getElementById("f-tags");
const fOutcome     = document.getElementById("f-outcome");
const confDisplay  = document.getElementById("confidenceDisplay");
const outcomeSection = document.getElementById("outcomeSection");
const modalTitle   = document.getElementById("modal-title");

/* ── Utilities ───────────────────────────────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function isOverdue(decision) {
  return decision.reviewDate && decision.reviewDate < today() && !decision.outcome;
}

function isDueToday(decision) {
  return decision.reviewDate === today();
}

function parseCsv(str) {
  return str.split(",").map((s) => s.trim()).filter(Boolean);
}

/* ── Render helpers ──────────────────────────────────────────── */
function renderCard(d, index) {
  const card = document.createElement("div");
  card.className = "card" +
    (d.outcome ? " resolved" : "") +
    (isOverdue(d) ? " overdue" : "");
  card.style.animationDelay = `${index * 40}ms`;

  const dateLabel = d.reviewDate
    ? `<span class="card-date ${isOverdue(d) ? "overdue" : isDueToday(d) ? "due-today" : ""}">
         ${isOverdue(d) ? "⚠ " : ""}Review ${formatDate(d.reviewDate)}
       </span>`
    : "";

  const tags = d.tags.length
    ? d.tags.map((t) => `<span class="tag">${t}</span>`).join("")
    : "";

  const outcome = d.outcome
    ? `<div class="outcome-chip">Outcome logged</div>`
    : "";

  card.innerHTML = `
    <div class="card-top">
      <div class="card-title">${d.title}</div>
      ${d.confidenceScore !== null ? `<span class="confidence-badge">${d.confidenceScore}/10</span>` : ""}
    </div>
    <div class="card-context">${d.context}</div>
    ${outcome}
    <div class="card-meta">
      ${tags}
      ${dateLabel}
    </div>
  `;

  card.addEventListener("click", () => openDetail(d.id));
  return card;
}

/* ── Load & render decisions ─────────────────────────────────── */
async function loadDecisions() {
  const query = currentView === "decisions" ? "" : `?due=${currentView}`;
  const decisions = await api.get(`/api/decisions${query}`);

  grid.innerHTML = "";

  if (decisions.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
    decisions.forEach((d, i) => grid.appendChild(renderCard(d, i)));
  }
}

async function loadStats() {
  const s = await api.get("/api/stats");
  document.querySelector("#stat-total .stat-num").textContent    = s.total;
  document.querySelector("#stat-resolved .stat-num").textContent = s.resolved;
  document.querySelector("#stat-overdue .stat-num").textContent  = s.overdue;
  document.querySelector("#stat-confidence .stat-num").textContent =
    s.avgConfidence ? `${s.avgConfidence}` : "—";
}

async function refresh() {
  await Promise.all([loadDecisions(), loadStats()]);
}

/* ── Add / Edit modal ────────────────────────────────────────── */
function openAddModal() {
  editingId = null;
  modalTitle.textContent = "Log a Decision";
  fTitle.value = "";
  fContext.value = "";
  fAlternatives.value = "";
  fConfidence.value = 7;
  confDisplay.textContent = "7";
  fReview.value = "";
  fTags.value = "";
  fOutcome.value = "";
  outcomeSection.classList.add("hidden");
  document.getElementById("saveDecision").textContent = "Save Decision";
  decisionModal.classList.remove("hidden");
  fTitle.focus();
}

async function openEditModal(id) {
  const d = await api.get(`/api/decisions/${id}`);
  editingId = id;
  modalTitle.textContent = "Edit Decision";
  fTitle.value = d.title;
  fContext.value = d.context;
  fAlternatives.value = d.alternatives.join(", ");
  fConfidence.value = d.confidenceScore ?? 7;
  confDisplay.textContent = d.confidenceScore ?? 7;
  fReview.value = d.reviewDate || "";
  fTags.value = d.tags.join(", ");
  fOutcome.value = d.outcome || "";
  outcomeSection.classList.remove("hidden");
  document.getElementById("saveDecision").textContent = "Update Decision";
  detailModal.classList.add("hidden");
  decisionModal.classList.remove("hidden");
  fTitle.focus();
}

function closeAddModal() {
  decisionModal.classList.add("hidden");
  editingId = null;
}

async function saveDecision() {
  const title = fTitle.value.trim();
  const context = fContext.value.trim();
  if (!title || !context) {
    fTitle.style.borderColor = title ? "" : "var(--danger)";
    fContext.style.borderColor = context ? "" : "var(--danger)";
    return;
  }
  fTitle.style.borderColor = "";
  fContext.style.borderColor = "";

  const payload = {
    title,
    context,
    alternatives: parseCsv(fAlternatives.value),
    confidenceScore: parseInt(fConfidence.value, 10),
    reviewDate: fReview.value || null,
    tags: parseCsv(fTags.value),
  };

  if (editingId) {
    if (fOutcome.value.trim()) payload.outcome = fOutcome.value.trim();
    await api.patch(`/api/decisions/${editingId}`, payload);
  } else {
    await api.post("/api/decisions", payload);
  }

  closeAddModal();
  await refresh();
}

/* ── Detail modal ────────────────────────────────────────────── */
async function openDetail(id) {
  const d = await api.get(`/api/decisions/${id}`);

  document.getElementById("detail-title").textContent = d.title;

  const body = document.getElementById("detail-body");
  const fillPct = d.confidenceScore !== null ? (d.confidenceScore / 10) * 100 : 0;

  const alts = d.alternatives.length
    ? d.alternatives.map((a) => `<div class="detail-alt-item">${a}</div>`).join("")
    : `<span style="color:var(--text-dim);font-style:italic;">None recorded</span>`;

  const tags = d.tags.length
    ? `<div class="detail-tags">${d.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>`
    : `<span style="color:var(--text-dim);font-style:italic;">No tags</span>`;

  const outcomeBlock = d.outcome
    ? `<div class="detail-section">
         <span class="detail-label">Outcome / Result</span>
         <div class="detail-outcome-box">${d.outcome}</div>
       </div>`
    : "";

  body.innerHTML = `
    <div class="detail-section">
      <span class="detail-label">Context</span>
      <div class="detail-value">${d.context}</div>
    </div>

    <div class="detail-section">
      <span class="detail-label">Alternatives Considered</span>
      <div class="detail-alt-list">${alts}</div>
    </div>

    <div class="detail-section">
      <span class="detail-label">Confidence Score</span>
      <div class="detail-confidence">
        <span style="font-family:var(--mono);color:var(--accent);font-size:18px;">
          ${d.confidenceScore !== null ? d.confidenceScore + "/10" : "—"}
        </span>
        <div class="confidence-bar-track">
          <div class="confidence-bar-fill" style="width:${fillPct}%"></div>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <span class="detail-label">Review Date</span>
      <div class="detail-value ${isOverdue(d) ? "card-date overdue" : ""}">
        ${d.reviewDate ? formatDate(d.reviewDate) + (isOverdue(d) ? " — overdue" : "") : "—"}
      </div>
    </div>

    <div class="detail-section">
      <span class="detail-label">Tags</span>
      ${tags}
    </div>

    <div class="detail-divider"></div>

    ${outcomeBlock}

    <div class="detail-section">
      <span class="detail-label">Logged</span>
      <div class="detail-value" style="font-size:12px;color:var(--text-dim);">
        ${new Date(d.createdAt).toLocaleDateString("en-US", { dateStyle: "long" })}
      </div>
    </div>
  `;

  // Wire footer buttons
  document.getElementById("detail-edit").onclick = () => openEditModal(id);
  document.getElementById("detail-delete").onclick = () => deleteDecision(id);
  document.getElementById("detail-outcome").onclick = () => openOutcomePrompt(d);
  document.getElementById("detail-outcome").textContent = d.outcome
    ? "Update Outcome"
    : "Log Outcome";

  detailModal.classList.remove("hidden");
}

function closeDetail() {
  detailModal.classList.add("hidden");
}

async function deleteDecision(id) {
  if (!confirm("Delete this decision? This cannot be undone.")) return;
  await api.del(`/api/decisions/${id}`);
  closeDetail();
  await refresh();
}

function openOutcomePrompt(d) {
  closeDetail();
  setTimeout(() => openEditModal(d.id), 50);
}

/* ── Event Listeners ─────────────────────────────────────────── */
document.getElementById("openAddModal").addEventListener("click", openAddModal);
document.getElementById("closeModal").addEventListener("click", closeAddModal);
document.getElementById("cancelModal").addEventListener("click", closeAddModal);
document.getElementById("saveDecision").addEventListener("click", saveDecision);
document.getElementById("closeDetail").addEventListener("click", closeDetail);

// Close modals on overlay click
decisionModal.addEventListener("click", (e) => {
  if (e.target === decisionModal) closeAddModal();
});
detailModal.addEventListener("click", (e) => {
  if (e.target === detailModal) closeDetail();
});

// Nav buttons
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    loadDecisions();
  });
});

// Confidence slider
fConfidence.addEventListener("input", () => {
  confDisplay.textContent = fConfidence.value;
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!decisionModal.classList.contains("hidden")) closeAddModal();
    if (!detailModal.classList.contains("hidden")) closeDetail();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (!decisionModal.classList.contains("hidden")) saveDecision();
  }
});

/* ── Init ────────────────────────────────────────────────────── */
refresh();