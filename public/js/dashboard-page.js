import { initCore } from './core.js';

initCore({ page: 'dashboard' });

// ── Mock data ────────────────────────────────────────────────────────────────

const ALERTS = {
  critical: [
    {
      id: 'SCH-0841',
      university: 'University of Illinois',
      issue: 'SEVIS record terminated — missed spring semester registration',
      category: 'Visa / SEVIS',
      date: '2025-01-09',
      detail: {
        description: 'Scholar failed to register for the Spring 2025 semester by the university deadline. SEVIS status has been set to Terminated by the DSO. Re-instatement requires I-515A filing within 60 days.',
        constraints: ['F-1 SEVIS active status required', 'Full-time enrollment minimum (12 credit hours)', 'Scholarship continuity requires active F-1'],
        recommendedAction: 'Scholar must file for reinstatement with Form I-539 or depart and re-enter on a new initial I-20. MOHE liaison should be notified within 48 hours.',
        escalation: 'MOHE Overseas Mission (Washington D.C.) + University DSO + Scholar',
        deadline: '2025-03-10',
      },
    },
    {
      id: 'SCH-1204',
      university: 'Arizona State University',
      issue: 'Unauthorized employment detected — tutoring off-campus without EAD',
      category: 'Employment',
      date: '2025-01-07',
      detail: {
        description: 'Scholar accepted compensated off-campus tutoring position without obtaining work authorization. This constitutes unauthorized employment under F-1 regulations and violates MOHE scholarship terms.',
        constraints: ['Off-campus employment requires EAD or DSO authorization', 'Unauthorized work is grounds for SEVIS termination', 'MOHE scholarship prohibits unapproved outside employment'],
        recommendedAction: 'Scholar must immediately cease employment. DSO consultation required within 24 hours. Voluntary disclosure to DSO may mitigate enforcement action.',
        escalation: 'University DSO + MOHE Scholarship Office',
        deadline: '2025-01-10',
      },
    },
    {
      id: 'SCH-0397',
      university: 'Michigan State University',
      issue: 'GPA fell below 2.5 threshold — scholarship probation triggered',
      category: 'Academic Standing',
      date: '2025-01-06',
      detail: {
        description: 'Scholar\'s cumulative GPA dropped to 2.31 at end of Fall 2024 semester, falling below the MOHE minimum requirement of 2.5. Scholarship will be placed on academic probation for Spring 2025.',
        constraints: ['MOHE scholarship requires minimum 2.5 GPA', 'Two consecutive probation semesters triggers scholarship suspension', 'Academic recovery plan required within 14 days'],
        recommendedAction: 'Scholar must submit academic recovery plan to MOHE scholarship office. Meeting with academic advisor required. Tutoring resources should be arranged immediately.',
        escalation: 'MOHE Scholarship Office + University Academic Advisor',
        deadline: '2025-01-20',
      },
    },
    {
      id: 'SCH-1587',
      university: 'Texas A&M University',
      issue: 'I-20 expired — program end date passed without extension',
      category: 'Visa / SEVIS',
      date: '2025-01-05',
      detail: {
        description: 'Scholar\'s I-20 program end date was December 31, 2024. No program extension was filed before expiry. Scholar is currently in the 60-day grace period and at risk of overstay.',
        constraints: ['I-20 must reflect active enrollment end date', '60-day grace period after program completion', 'Overstay violates F-1 status and voids future visa eligibility'],
        recommendedAction: 'Scholar must immediately request I-20 extension from DSO with evidence of continued enrollment. Extension must be processed before grace period expires.',
        escalation: 'University DSO — urgent',
        deadline: '2025-03-01',
      },
    },
    {
      id: 'SCH-2001',
      university: 'University of Missouri',
      issue: 'Health insurance lapsed — mandatory coverage gap (62 days)',
      category: 'Health Insurance',
      date: '2025-01-04',
      detail: {
        description: 'Scholar\'s university-sponsored health insurance was not renewed for Spring 2025 semester. Coverage lapsed on December 31, 2024. MOHE scholarship requires continuous health coverage.',
        constraints: ['MOHE scholarship mandates continuous health insurance', 'Uninsured medical emergencies may not be reimbursed', 'Some universities require insurance for enrollment'],
        recommendedAction: 'Scholar must purchase short-term coverage retroactively or enroll in university plan for Spring semester. MOHE must be notified of coverage gap.',
        escalation: 'Scholar + University Health Services',
        deadline: '2025-01-15',
      },
    },
  ],
  advisory: [
    {
      id: 'SCH-0552',
      university: 'University of Illinois',
      issue: 'OPT application not submitted — 90-day post-graduation window closing',
      category: 'Employment',
      date: '2025-01-08',
    },
    {
      id: 'SCH-0781',
      university: 'Arizona State University',
      issue: 'Scholarship annual progress report 22 days overdue',
      category: 'Scholarship',
      date: '2025-01-07',
    },
    {
      id: 'SCH-1122',
      university: 'Michigan State University',
      issue: 'Reduced course load — no DSO reduced course load authorization on file',
      category: 'Academic Standing',
      date: '2025-01-06',
    },
    {
      id: 'SCH-0334',
      university: 'Texas A&M University',
      issue: 'Address change not reported to SEVIS within 10-day window',
      category: 'Visa / SEVIS',
      date: '2025-01-05',
    },
    {
      id: 'SCH-1899',
      university: 'University of Missouri',
      issue: 'CPT request submitted after work start date — retroactive authorization risk',
      category: 'Employment',
      date: '2025-01-03',
    },
  ],
  resolved: [
    {
      id: 'SCH-0219',
      university: 'Arizona State University',
      issue: 'SEVIS record restored after reinstatement filing',
      category: 'Visa / SEVIS',
      date: '2024-12-20',
    },
    {
      id: 'SCH-0445',
      university: 'University of Illinois',
      issue: 'Scholarship probation lifted — GPA recovered to 2.74',
      category: 'Academic Standing',
      date: '2024-12-18',
    },
    {
      id: 'SCH-0887',
      university: 'Texas A&M University',
      issue: 'Health insurance retroactive coverage confirmed',
      category: 'Health Insurance',
      date: '2024-12-15',
    },
  ],
};

const ACTIVITY_ROWS = [
  { id: 'SCH-0841', uni: 'Univ. of Illinois', type: 'SEVIS reinstatement', risk: 'critical', outcome: 'Escalated to MOHE Liaison', date: 'Jan 9' },
  { id: 'SCH-1204', uni: 'Arizona State Univ.', type: 'Employment authorization', risk: 'critical', outcome: 'Employment ceased, DSO notified', date: 'Jan 7' },
  { id: 'SCH-0552', uni: 'Univ. of Illinois', type: 'OPT application guidance', risk: 'advisory', outcome: 'Application checklist generated', date: 'Jan 8' },
  { id: 'SCH-0334', uni: 'Texas A&M Univ.', type: 'SEVIS address update', risk: 'advisory', outcome: 'Steps provided to scholar', date: 'Jan 5' },
  { id: 'SCH-1122', uni: 'Michigan State Univ.', type: 'Reduced course load', risk: 'advisory', outcome: 'DSO authorization form link sent', date: 'Jan 6' },
  { id: 'SCH-0397', uni: 'Michigan State Univ.', type: 'Academic probation', risk: 'critical', outcome: 'Recovery plan initiated', date: 'Jan 6' },
  { id: 'SCH-1899', uni: 'Univ. of Missouri', type: 'CPT authorization', risk: 'advisory', outcome: 'Retroactive risk explained, DSO consulted', date: 'Jan 3' },
  { id: 'SCH-2001', uni: 'Univ. of Missouri', type: 'Health insurance gap', risk: 'critical', outcome: 'Short-term plan options provided', date: 'Jan 4' },
];

// ── Render helpers ───────────────────────────────────────────────────────────

function categoryTag(cat) {
  const map = {
    'Visa / SEVIS': 'tag-visa',
    'Employment': 'tag-employment',
    'Academic Standing': 'tag-academic',
    'Scholarship': 'tag-scholarship',
    'Health Insurance': 'tag-health',
  };
  return `<span class="alert-tag ${map[cat] || ''}">${cat}</span>`;
}

function riskBadge(level) {
  const cls = { critical: 'badge-critical', advisory: 'badge-advisory', resolved: 'badge-resolved' };
  return `<span class="risk-badge ${cls[level] || ''}">${level}</span>`;
}

function renderAlerts(tab) {
  const list = document.getElementById('alert-list');
  if (!list) return;
  const items = ALERTS[tab] || [];
  list.innerHTML = items.map((a) => `
    <div class="alert-item ${tab === 'critical' ? 'alert-critical' : tab === 'resolved' ? 'alert-resolved' : ''}"
         data-alert-id="${a.id}" role="button" tabindex="0" aria-label="View details for ${a.id}">
      <div class="alert-row-top">
        <span class="alert-id">${a.id}</span>
        ${categoryTag(a.category)}
        <span class="alert-date">${a.date}</span>
      </div>
      <div class="alert-issue">${a.issue}</div>
      <div class="alert-uni">${a.university}${a.detail ? ' · <span class="alert-view-link">View details →</span>' : ''}</div>
    </div>
  `).join('');

  list.querySelectorAll('[data-alert-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.alertId;
      const alert = [...ALERTS.critical, ...ALERTS.advisory, ...ALERTS.resolved].find((a) => a.id === id);
      if (alert?.detail) openModal(alert);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
  });
}

function openModal(alert) {
  const modal = document.getElementById('scholar-modal');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  if (!modal || !title || !body) return;

  title.textContent = `${alert.id} — ${alert.university}`;
  body.innerHTML = `
    <div class="modal-section">
      <div class="modal-label">Issue</div>
      <div class="modal-text">${alert.issue}</div>
    </div>
    <div class="modal-section">
      <div class="modal-label">Description</div>
      <div class="modal-text">${alert.detail.description}</div>
    </div>
    <div class="modal-section">
      <div class="modal-label">Active constraints</div>
      <ul class="modal-list">
        ${alert.detail.constraints.map((c) => `<li>${c}</li>`).join('')}
      </ul>
    </div>
    <div class="modal-section">
      <div class="modal-label">Recommended action</div>
      <div class="modal-text modal-action">${alert.detail.recommendedAction}</div>
    </div>
    <div class="modal-section">
      <div class="modal-label">Escalation path</div>
      <div class="modal-text">${alert.detail.escalation}</div>
    </div>
    <div class="modal-section">
      <div class="modal-label">Deadline</div>
      <div class="modal-text modal-deadline">${alert.detail.deadline}</div>
    </div>
    <div class="modal-footer">
      <a class="btn" href="/" target="_blank">Open in scholar workspace</a>
      <button class="btn-secondary modal-close-btn" id="modal-close-btn">Close</button>
    </div>
  `;

  modal.hidden = false;
  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
}

function closeModal() {
  const modal = document.getElementById('scholar-modal');
  if (modal) modal.hidden = true;
}

function renderActivity() {
  const tbody = document.getElementById('activity-tbody');
  if (!tbody) return;
  tbody.innerHTML = ACTIVITY_ROWS.map((r) => `
    <tr>
      <td class="activity-id">${r.id}</td>
      <td>${r.uni}</td>
      <td>${r.type}</td>
      <td>${riskBadge(r.risk)}</td>
      <td class="activity-outcome">${r.outcome}</td>
      <td class="activity-date">${r.date}</td>
    </tr>
  `).join('');
}

function bindTabs() {
  document.querySelectorAll('.alert-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.alert-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderAlerts(tab.dataset.tab);
    });
  });
}

function bindExport() {
  document.getElementById('btn-export-report')?.addEventListener('click', () => {
    alert('Export is not implemented in this prototype. In production, this would generate a PDF report with real scholar compliance data.');
  });
}

function bindModalClose() {
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('scholar-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'scholar-modal') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function setUpdatedTime() {
  const el = document.getElementById('dash-updated');
  if (el) el.textContent = 'simulated data · not live';
}

// ── Init ─────────────────────────────────────────────────────────────────────

renderAlerts('critical');
renderActivity();
bindTabs();
bindExport();
bindModalClose();
setUpdatedTime();
