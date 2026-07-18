// public/js/deadlines.js — pure deadline engine.
//
// Applies dated obligations that already exist in data/*.json to the dates a
// scholar supplies. No DOM, no storage, no clock: `today` is injected so the
// output is deterministic and unit-testable.
//
// Safety rules for anyone extending this file:
//   1. Never add a rule whose offset is not stated explicitly in a KB document.
//      A confidently wrong immigration date is worse than no date at all.
//   2. Every rule cites the official source already carried by that KB entry.
//   3. Rules that diverge by visa type are withheld when the visa type is
//      unknown, rather than defaulting to the more common case.

const DAY_MS = 86400000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a YYYY-MM-DD string as UTC midnight.
 * Strict: rejects anything that does not round-trip (e.g. "2026-13-45"), so a
 * malformed value can never silently become a real-looking deadline.
 * @returns {number|null} epoch ms, or null if the input is not a valid date
 */
function parseISODate(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const ts = Date.UTC(year, month - 1, day);
  const back = new Date(ts);
  // Reject rolled-over dates: Date.UTC(2026, 12, 45) happily produces a real
  // timestamp in a different month, which would be a fabricated deadline.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  return ts;
}

function toISODate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function urgencyFor(daysUntil) {
  if (daysUntil < 0) return 'passed';
  if (daysUntil <= 30) return 'urgent';
  if (daysUntil <= 90) return 'soon';
  return 'upcoming';
}

// Some rules mark the opening of a window rather than a hard cutoff — the OPT
// filing window, the six-month point for planning post-study options. Those
// stay useful for as long as the window is open, so they must not be dropped by
// the look-back filter the way a passed cutoff is. `relevantUntil` says when
// the window shuts; while it is open the item is reported with urgency 'open'.
function windowCloseTs(rule, anchors) {
  if (!rule.relevantUntil) return null;
  const base = anchors[rule.relevantUntil.anchor];
  if (base === null || base === undefined) return null;
  return base + rule.relevantUntil.offsetDays * DAY_MS;
}

const CONFIRM_DSO = 'Confirm the exact date with your DSO or international student office before acting.';
const CONFIRM_UKVI = 'Confirm the exact date with your university international team before applying.';
const CONFIRM_AU = 'Confirm the exact date with your education provider before applying.';
const CONFIRM_MOHE = 'Confirm with your MoHE scholarship officer as well, since scholarship terms apply on top of visa rules.';

/**
 * Rule table. `destinations: null` means the rule is destination-agnostic and
 * applies even when the scholar has not told us where they are.
 * `visaTypes` gates a rule to specific visa types; a rule that declares it is
 * withheld entirely when the scholar's visa type is unknown.
 */
const RULES = [
  {
    id: 'us-opt-window-opens',
    destinations: ['us'],
    visaTypes: ['f1'],
    anchor: 'programEndDate',
    offsetDays: -90,
    // The filing window stays open until 60 days after program end.
    relevantUntil: { anchor: 'programEndDate', offsetDays: 60 },
    title: 'Earliest date you can file for OPT',
    detail: 'You can apply for post-completion OPT up to 90 days before your program end date. Filing early matters because USCIS processing takes months.',
    action: CONFIRM_DSO,
    sourceTitle: 'SEVP Policy Guidance: Practical Training',
    sourceUrl: 'https://www.ice.gov/sevis/practical-training',
  },
  {
    id: 'us-opt-window-closes',
    destinations: ['us'],
    visaTypes: ['f1'],
    anchor: 'programEndDate',
    offsetDays: 60,
    title: 'Last date you can file for OPT',
    detail: 'The OPT application window closes 60 days after your program end date. USCIS must receive the I-765 by this date.',
    action: CONFIRM_DSO,
    sourceTitle: 'USCIS Form I-765',
    sourceUrl: 'https://www.uscis.gov/i-765',
  },
  {
    id: 'us-grace-period-ends',
    destinations: ['us'],
    visaTypes: ['f1'],
    anchor: 'programEndDate',
    offsetDays: 60,
    title: 'F-1 grace period ends',
    detail: 'F-1 students have 60 days after program completion to depart, transfer, or change status. Leaving the US during the grace period ends it — you cannot re-enter on it.',
    action: CONFIRM_DSO,
    sourceTitle: 'SEVP Policy Guidance: Maintaining Status',
    sourceUrl: 'https://www.ice.gov/sevis/maintaining-status',
  },
  {
    id: 'us-grace-period-ends-j1',
    destinations: ['us'],
    visaTypes: ['j1'],
    anchor: 'programEndDate',
    offsetDays: 30,
    title: 'J-1 grace period ends',
    detail: 'J-1 exchange visitors have 30 days after program completion — half the F-1 window. Unlawful presence begins immediately after it lapses.',
    action: CONFIRM_DSO,
    sourceTitle: 'SEVP Policy Guidance: Maintaining Status',
    sourceUrl: 'https://www.ice.gov/sevis/maintaining-status',
  },
  {
    id: 'us-i20-extension',
    destinations: ['us'],
    visaTypes: null,
    anchor: 'visaExpiryDate',
    offsetDays: -60,
    title: 'Start your I-20 extension request',
    detail: 'Extension requests should be initiated 60 days before your I-20 expires, and must be filed before the program end date on it — not after.',
    action: CONFIRM_DSO,
    sourceTitle: 'SEVP Policy Guidance: Maintaining Status',
    sourceUrl: 'https://www.ice.gov/sevis/maintaining-status',
  },
  {
    id: 'uk-graduate-route',
    destinations: ['uk'],
    visaTypes: null,
    anchor: 'visaExpiryDate',
    offsetDays: -30,
    title: 'Apply for the Graduate Route',
    detail: 'The Graduate Route must be applied for from inside the UK before your Student visa expires, and only after your university confirms course completion to the Home Office.',
    action: CONFIRM_UKVI,
    sourceTitle: 'Graduate visa — GOV.UK',
    sourceUrl: 'https://www.gov.uk/graduate-visa',
  },
  {
    id: 'au-485-plan',
    destinations: ['au'],
    visaTypes: null,
    anchor: 'visaExpiryDate',
    offsetDays: -180,
    // Planning stays relevant right up to the visa expiring.
    relevantUntil: { anchor: 'visaExpiryDate', offsetDays: 0 },
    title: 'Start planning your post-study options',
    detail: 'Six months out is the point to decide between a Temporary Graduate (485) visa, returning home, or another pathway. Some evidence for the 485 takes weeks to gather.',
    action: CONFIRM_MOHE,
    sourceTitle: 'Temporary Graduate visa (485) — Home Affairs',
    sourceUrl: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/temporary-graduate-485',
  },
  {
    id: 'au-485-apply',
    destinations: ['au'],
    visaTypes: null,
    anchor: 'visaExpiryDate',
    offsetDays: -30,
    title: 'Apply for the Temporary Graduate (485) visa',
    detail: 'The 485 must be applied for while you are physically in Australia and before your student visa expires.',
    action: CONFIRM_AU,
    sourceTitle: 'Temporary Graduate visa (485) — Home Affairs',
    sourceUrl: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/temporary-graduate-485',
  },
  {
    id: 'visa-expiry',
    destinations: null,
    visaTypes: null,
    anchor: 'visaExpiryDate',
    offsetDays: 0,
    title: 'Your visa expires',
    detail: 'Staying beyond this date without an approved extension or a pending in-time application puts your status at risk.',
    action: CONFIRM_MOHE,
    sourceTitle: 'Omani Ministry of Higher Education',
    sourceUrl: 'https://www.mohe.gov.om',
  },
];

/**
 * Compute the scholar's upcoming compliance deadlines.
 *
 * @param {object} input
 * @param {string} [input.destination] 'us' | 'uk' | 'au' | 'auto'
 * @param {string} [input.visaType]    'f1' | 'j1' | ''
 * @param {string} [input.programEndDate] YYYY-MM-DD
 * @param {string} [input.visaExpiryDate] YYYY-MM-DD
 * @param {string} [input.today]       YYYY-MM-DD, injected for determinism
 * @param {number} [input.horizonDays] how far ahead to look (default 180)
 * @param {number} [input.lookBackDays] how far back to keep showing a missed
 *   deadline (default 30) — a just-missed date is the most urgent thing there is
 * @returns {Array<object>} deadlines sorted by date ascending; never throws
 */
export function computeDeadlines({
  destination = '',
  visaType = '',
  programEndDate = '',
  visaExpiryDate = '',
  today = '',
  horizonDays = 180,
  lookBackDays = 30,
} = {}) {
  const todayTs = parseISODate(today);
  if (todayTs === null) return [];

  const anchors = {
    programEndDate: parseISODate(programEndDate),
    visaExpiryDate: parseISODate(visaExpiryDate),
  };

  const dest = String(destination || '').toLowerCase();
  const visa = String(visaType || '').toLowerCase();

  const out = [];

  for (const rule of RULES) {
    // Destination gating. A null destinations list means "applies anywhere".
    // We deliberately do NOT guess a destination when it is 'auto' or unset:
    // showing US OPT dates to a UK student would be worse than showing nothing.
    if (rule.destinations && !rule.destinations.includes(dest)) continue;

    // Visa-type gating. Withheld rather than defaulted when unknown.
    if (rule.visaTypes && (!visa || !rule.visaTypes.includes(visa))) continue;

    const anchorTs = anchors[rule.anchor];
    if (anchorTs === null || anchorTs === undefined) continue;

    const ts = anchorTs + rule.offsetDays * DAY_MS;
    const daysUntil = Math.round((ts - todayTs) / DAY_MS);

    if (daysUntil > horizonDays) continue;

    // A date in the past is normally dropped once it leaves the look-back
    // window. The exception is a window that has opened and not yet shut: that
    // is live guidance, not a missed cutoff.
    const closesTs = windowCloseTs(rule, anchors);
    const windowOpen = daysUntil <= 0 && closesTs !== null && todayTs <= closesTs;
    if (daysUntil < -lookBackDays && !windowOpen) continue;

    out.push({
      id: rule.id,
      title: rule.title,
      date: toISODate(ts),
      daysUntil,
      urgency: windowOpen ? 'open' : urgencyFor(daysUntil),
      detail: rule.detail,
      action: rule.action,
      sourceTitle: rule.sourceTitle,
      sourceUrl: rule.sourceUrl,
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Human-readable relative phrasing for a deadline, e.g. "in 12 days".
 * Kept pure and separate from rendering so it can be unit-tested and reused by
 * both the empty-state panel and the AI profile context.
 */
export function describeDaysUntil(daysUntil) {
  if (!Number.isFinite(daysUntil)) return '';
  if (daysUntil === 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  if (daysUntil === -1) return 'yesterday';
  if (daysUntil < 0) return `${Math.abs(daysUntil)} days ago`;
  return `in ${daysUntil} days`;
}
