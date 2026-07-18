# Deadline awareness — implementation plan

Spec: `docs/superpowers/specs/2026-07-18-deadline-awareness-design.md`

## 1. Pure engine — `public/js/deadlines.js` (new)

- `parseISODate()` — strict `YYYY-MM-DD` → UTC epoch ms, rejecting values that do not
  round-trip so `2026-13-45` cannot silently become a real-looking deadline
- `urgencyFor()` / `windowCloseTs()` helpers
- `RULES` — data table of nine KB-grounded rules, each with anchor, offset, copy, and the
  official source URL taken from the corresponding `data/*.json` entry
- `computeDeadlines()` — destination and visa-type gating, horizon and look-back filtering,
  open-window exemption, sorted output, never throws
- `describeDaysUntil()` — relative phrasing, kept pure so both render surfaces share it

## 2. Tests — `test/deadlines.test.js` (new)

28 cases with `today` injected: OPT window offsets, F-1 vs J-1 grace divergence, withheld
rules on unknown visa type, destination gating, `auto` yielding only destination-agnostic
rules, urgency boundaries, horizon and look-back filtering, open-window survival, ordering,
citation presence, malformed input, timezone stability.

## 3. Storage — `public/js/chat-store.js`

Add `programEndDate`, `visaExpiryDate`, `visaType` to `SETTINGS_DEFAULTS`, all `''`.
Local-only; these dates never go to the server.

## 4. Settings UI — `public/chat.html`

A visa-type select and two `type="date"` inputs in the Profile section, each with a hint
noting the data stays on the device.

## 5. Chat wiring — `public/js/chat-page.js`

- import `computeDeadlines` / `describeDaysUntil`
- `URGENCY_LABEL` declared at module top (temporal-dead-zone hazard — see spec)
- change handlers for the three new fields, each re-rendering so the panel updates live
- `populateSettingsPanel()` populates the new fields
- `currentDeadlines()` — reads settings, injects today
- `deadlinePanelMarkup()` — compact two-item panel, all values through `escapeHtml()`
- `emptyStateMarkup()` renders the panel above the prompt grid
- `buildProfileContext()` appends the deadlines so answers agree with the panel

## 6. Styles — `public/styles.css`

`.deadline-*` rules using existing `:root` variables only, urgency colours following the
established `escalation-urgent` convention, plus dark-mode overrides and `.settings-hint`.

## 7. Verification

- `npm test`, `npm run check:syntax`, `npm run check:functions`
- drive the real page in a browser: panel renders, console clean, and measure that the
  empty state does not lose the prompt grid to the panel's height
