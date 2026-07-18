# Deadline awareness — design

## Context

OmanX answers compliance questions well but has no reason for a scholar to return. Every
feature shipped so far (news feed, ambassador cards, footer links) adds surface without
creating a second visit. The knowledge base already encodes dated obligations — the OPT
filing window, F-1 grace periods, I-20 extension timing, the UK Graduate Route, the AU 485 —
but it applies them to nobody in particular. A scholar has to already know a deadline exists
in order to ask about it.

This feature applies rules the KB already contains to dates the scholar supplies, so OmanX
can surface a time-sensitive obligation before it is missed. It is the one thing a general
assistant structurally cannot do: it can explain what OPT is, but it does not know this
person's program end date.

## Safety position

A confidently wrong compliance date is worse than no date. Every generated item therefore:

- states the rule it came from and links the official source already in the KB
- is labelled a reminder, never an authorization or a legal determination
- carries an explicit instruction to confirm with the DSO / international office / MoHE
- is derived from a KB-grounded offset, never from model output or from my own recall

No rule ships unless a KB entry states the offset explicitly. Rules that "feel" standard but
are not written in `data/*.json` are out of scope. MoHE reporting is deliberately excluded:
`MOHE-REPORTING-LEAVE-2026` has no concrete day offsets, and inventing one would be exactly
the failure mode this section exists to prevent.

## Architecture

One pure module, one storage change, two render surfaces.

### `public/js/deadlines.js` (new, pure)

No DOM, no storage, no clock access — `today` is injected. This keeps it unit-testable per
the global standard that deterministic logic is separated from I/O.

```js
computeDeadlines({ destination, visaType, programEndDate, visaExpiryDate, today, horizonDays })
  -> [{ id, title, date, daysUntil, urgency, detail, action, sourceTitle, sourceUrl }]
```

Dates arrive as `YYYY-MM-DD` from `<input type="date">` and are parsed as UTC midnight, so
results never shift by a day based on the viewer's timezone. Output is sorted by date
ascending and filtered to a horizon (default 180 days ahead, 30 days back so a
just-missed deadline still shows).

`urgency` is derived from `daysUntil`: `passed` (< 0), `urgent` (0–30), `soon` (31–90),
`upcoming` (> 90).

### Rule table

Each rule is a data entry, not a branch, so adding a destination means adding a row.
Offsets and citations below are taken verbatim from the KB:

| id | Destination | Anchor | Offset | KB source |
|---|---|---|---|---|
| `us-opt-window-opens` | US (F-1) | programEndDate | −90d | `F1-EMP-2024` — "Apply for OPT up to 90 days before program end date" |
| `us-opt-window-closes` | US (F-1) | programEndDate | +60d | `F1-EMP-2024` — "no later than 60 days after" |
| `us-grace-period-ends` | US (F-1) | programEndDate | +60d | `GRACE-STATUS-2024` — "T+60 days (F-1): Post-completion grace period ends" |
| `us-grace-period-ends-j1` | US (J-1) | programEndDate | +30d | `GRACE-STATUS-2024` — "T+30 days (J-1)" |
| `us-i20-extension` | US | visaExpiryDate (I-20 end) | −60d | `I20-MAINT-2024` — "Initiate extension request 60 days before expiration" |
| `uk-graduate-route` | UK | visaExpiryDate | −30d | `UK-GRADUATE-ROUTE-2026` — "Apply before current Student visa expires" |
| `au-485-plan` | AU | visaExpiryDate | −180d | `AU-TEMP-GRADUATE-485-2026` — "T-6 months: Begin planning" |
| `au-485-apply` | AU | visaExpiryDate | −30d | `AU-TEMP-GRADUATE-485-2026` — "Apply before student visa expires" |
| `visa-expiry` | all | visaExpiryDate | 0d | destination visa document |

The two US rules that land on the same date (`us-opt-window-closes`, `us-grace-period-ends`)
are intentionally distinct: they are different obligations that happen to coincide, and
collapsing them would hide one.

### Storage

Three keys added to `SETTINGS_DEFAULTS` in `chat-store.js`, all defaulting to `''`:
`programEndDate`, `visaExpiryDate`, `visaType`. Dates stay in `localStorage` with the rest
of settings — consistent with the local-first architecture, and it keeps immigration dates
off the server.

### Render surfaces

1. **Chat empty state** (`emptyStateMarkup()`): a deadline panel above the prompt grid,
   showing at most three items, only when dates are set and something falls in the horizon.
   Absent entirely otherwise — no empty widget, no nag.
2. **`buildProfileContext()`**: upcoming deadlines are appended to the profile context sent
   with each message, so the assistant can reference them when answering rather than
   contradicting the panel on screen.

Settings gains a "Key dates" group with the two date inputs and the visa-type select.

## Error handling

Malformed or absent dates yield no deadlines rather than throwing — a scholar who never
fills these in sees exactly today's product. Invalid `Date` values are filtered out before
sorting. `computeDeadlines` never throws on any input; that is asserted in tests.

## Testing

`test/deadlines.test.js`, `node --test`, with `today` injected so results are deterministic
forever rather than passing until a date rolls over:

- known program end date produces the OPT window at exactly −90/+60
- J-1 gets a 30-day grace period, F-1 gets 60
- destination gating: UK rules never appear for a US scholar
- urgency tiers at boundaries (0, 30, 31, 90, 91 days)
- horizon filtering, including the 30-day look-back for a passed deadline
- timezone stability: same result regardless of `TZ`
- garbage input (`null`, `'not-a-date'`, `undefined`) returns `[]` and does not throw
- every returned item carries a non-empty `sourceUrl`

## Out of scope

- Notifications, email, or push of any kind — this surfaces in-app only
- Server-side storage or syncing of dates
- MoHE reporting deadlines (no concrete offsets in the KB)
- Editing the KB itself
- Backfilling the missing `major` field from the onboarding spec
