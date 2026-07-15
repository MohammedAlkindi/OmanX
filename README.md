# OmanX

AI guidance system for Omani scholars studying abroad — the United States, United Kingdom, and Australia — covering both everyday campus questions and compliance-critical ones: visa status, work authorization, insurance, academic standing, and government paperwork.

Built by [Mohammed Alkindi](https://github.com/alkindi-m).

---

## Why this exists

A generic chatbot will happily hallucinate an OPT deadline or a SEVIS reinstatement procedure. For a scholar on an F-1, Student Route, or Subclass 500 visa, a wrong answer isn't a bad UX — it's a status violation. OmanX is built around that constraint: compliance questions are routed differently than "where's good food near campus," get grounded in curated + live sources, get cited, and get escalation guidance when the situation is time-critical.

---

## How a request is handled

```
POST /api/chat
  │
  ├─ sanitize + validate (length caps, control-char strip, image MIME/size checks)
  ├─ auth check (optional — Supabase bearer token; required only for image uploads)
  ├─ rate limit consume (Upstash Redis sliding window, per-session or per-user)
  ├─ isCompliance(message)?
  │     no  → skip KB + search, answer conversationally, cacheable
  │     yes → detectDestination(message, context) → us | uk | au
  │           ├─ getKB(destination)  — destination doc set + shared MoHE rules, hot-reloaded from disk
  │           ├─ searchKB()          — keyword pass over COMPLIANCE_TRIGGERS, TF-IDF cosine fallback for paraphrases
  │           └─ webSearch()         — Tavily, domain-restricted to government sources for that destination
  │           (KB lookup and web search run concurrently via Promise.all)
  ├─ isUrgent(message)? → buildEscalationCard() — structured steps, DSO note, embassy contact, relevant form numbers
  ├─ build system prompt (KB entries + citable web results + student context + language + concise mode)
  └─ stream response over SSE, with source list and escalation card in the final event
```

This is not a single-shot RAG call — it's a small pipeline of independent, cheap decisions (regex/keyword triggers, not model calls) that determine *how much* grounding a given message needs before the model ever runs, and route the same conversation to different rules depending on destination.

---

## What makes the assistant layer non-trivial

**Multi-destination knowledge bases, composed at request time**
`data/us.json`, `data/uk.json`, `data/au.json` hold destination-specific compliance content (visa categories, work authorization rules, insurance requirements). `data/mohe.json` holds Omani Ministry of Higher Education rules shared across all three — scholarship terms, MoHE notification requirements — and is merged into whichever destination KB is active on every request. Destination is inferred from message + student-provided context (`detectDestination()` in [api/chat.js](api/chat.js)) unless the client passes one explicitly.

**Hybrid KB search, not a vector DB**
`searchKB()` runs a keyword pass first — matching `COMPLIANCE_TRIGGERS` terms that appear in both the query and the document — because for compliance content, exact terminology (SEVIS, OPT, CAS, Subclass 500) should always beat incidental similarity. If nothing matches, it falls back to TF-IDF cosine similarity over tokenized document text, so paraphrased questions ("my school kicked me out, what happens to my visa") still surface relevant entries. TF-IDF vectors are cached per KB fingerprint and rebuilt automatically when the underlying JSON file changes (mtime-checked, hot-reloaded — no restart needed to update compliance content).

**Escalation detection is a second, independent classifier**
`isCompliance()` and `isUrgent()` fire on separate trigger lists — a message can be compliance-relevant without being urgent, or urgent without extra compliance vocabulary. When both fire, `buildEscalationCard()` returns a structured object (severity level, numbered action steps, DSO contact note, embassy info, applicable form numbers) tailored to the situation type — legal emergency, SEVIS termination, medical emergency, eviction, academic dismissal, funding loss — and localized per destination (911 vs 999 vs 000, I-539 vs a UK reinstatement process, etc.). This is deterministic, not model-generated, so it's identical every time and can't drift or omit a step under model variance.

**Live search is domain-restricted, not open web search**
Tavily queries are constrained to an explicit allowlist of ~15 government and university-oversight domains per destination (`uscis.gov`, `gov.uk`, `homeaffairs.gov.au`, etc.). Compliance answers cite the specific KB entry ID or source URL used — never an unattributed claim — and the model is instructed to say "I don't know, ask your DSO" rather than fill gaps.

**Caching is compliance-aware**
Only non-compliance, single-turn, no-attachment requests get a response cache entry (SHA-256 of model + prompt + context, 10-minute TTL, capped at 500 entries). Compliance responses are never cached, because policy pages change and a stale visa answer is worse than a slow one.

**Auth is additive, not required**
The product is usable anonymously — anonymous sessions get rate-limited by browser session and keep chat history on the device. Google OAuth via Supabase ([api/auth-utils.js](api/auth-utils.js)) gates image uploads, keys rate limits by user, and syncs chat history through the RLS-protected `public.omanx_chat_sync` table once signed in. There's no account-gated content.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| AI | Anthropic Claude — `claude-sonnet-4-6` (default), `claude-haiku-4-5-20251001` (opt-in) | Model allowlist enforced server-side; client can't request an arbitrary model string |
| Live search | Tavily API | Domain-restricted, optional — degrades to KB-only silently if `TAVILY_API_KEY` absent |
| Knowledge base | `data/{us,uk,au,mohe}.json` | Hot-reloaded on file mtime change, TF-IDF-indexed |
| Rate limiting | Upstash Redis (sorted-set sliding window) | Local dev can fall back to memory; production/Vercel requires Upstash and fails closed if it is missing |
| Auth | Supabase (Google OAuth) | Optional; enables image attachments, durable user quotas, and signed-in chat sync |
| Frontend | Vanilla JS ES modules, no bundler, no framework | `public/js/chat-page.js`, `chat-store.js`, `core.js` |
| Persistence | `localStorage` + Supabase | Local-first chat history; signed-in users sync snapshots through `/api/chats` |
| Hosting | Vercel — serverless functions + static frontend | `vercel.json` maps `/api/*`, canonical redirects for legacy `.html` routes |
| Streaming | SSE (`text/event-stream`) | Token deltas, then a final event carrying sources, escalation card, destination, and usage |
| Analytics | `@vercel/analytics` | Page-level only — no per-message tracking (see Long-term goals) |

---

## Project structure

```
.
├── api/
│   ├── chat.js           # Core pipeline: routing, KB search, Tavily, streaming, escalation
│   ├── chats.js          # Signed-in chat history sync snapshot API
│   ├── rate-limit.js      # Upstash sliding-window limiter + local memory fallback
│   ├── auth-utils.js      # Supabase bearer-token verification
│   ├── auth/
│   │   ├── config.js      # Public Supabase config for the client
│   │   └── session.js
│   ├── feedback.js
│   ├── usage.js
│   ├── health.js / ready.js / metrics.js
├── data/
│   ├── us.json / uk.json / au.json   # Destination-specific compliance KB
│   └── mohe.json                     # Shared Omani MoHE rules, merged into all destinations
├── public/
│   ├── js/
│   │   ├── chat-page.js   # Workspace UI — sidebar, composer, streaming render loop
│   │   ├── chat-store.js  # localStorage abstraction for chats, settings, sync owner
│   │   └── core.js        # Theme engine, toast, shared utilities
│   ├── styles.css         # Design tokens + dark mode via [data-theme]
│   ├── chat.html          # Workspace (served at `/`)
│   ├── index.html, about.html, method.html, vision.html, contact.html,
│   │   examples.html, collaboration.html, dashboard.html
├── server.js              # Express entry point for local dev — mirrors vercel.json routing
├── vercel.json
└── package.json
```

---

## Running locally

```bash
npm install
cp .env.example .env    # add your keys
npm run dev              # node --watch server.js → http://localhost:3000
```

**Required**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Optional**
| Var | Effect if unset |
|---|---|
| `TAVILY_API_KEY` | Live web search disabled; compliance answers use KB only |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Required in production; local dev falls back to memory if unset |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Google sign-in, image uploads, and chat sync disabled |
| `ALLOWED_ORIGIN` | CORS is unrestricted (fine for local dev) |
| `ANTHROPIC_MODEL` | Overrides the default model |

## Deploying

```bash
vercel --prod
```

Set the environment variables above in the Vercel project. In production, set both Upstash variables; without them `/api/ready` returns 503 and `/api/chat` refuses requests. For signed-in history sync, run `supabase/migrations/20260710000000_create_omanx_chat_sync.sql` in the Supabase project. `vercel.json` maps `/api/*` to serverless functions and serves everything else statically from `public/`.

---

## Architecture decisions worth knowing

- **Local-first chat history.** Anonymous conversations stay in `localStorage`. Signed-in conversations sync through Supabase after the RLS migration is applied, with `localStorage` still acting as the immediate device copy.
- **No build step.** Frontend is plain ES modules loaded directly by the browser — no bundler, no JSX, no framework. Keep it that way unless there's a concrete reason to introduce one.
- **Deterministic safety logic stays out of the model.** Destination detection, compliance/urgency classification, and escalation card content are all plain functions, not LLM calls — they're the parts that must not vary between two identical inputs.

---

## Long-term goals

- **Usage analytics** — track question categories, destinations, and unanswered queries once there's a real signed-in user base, to drive KB expansion instead of guessing.
- **Structured escalation follow-through** — today's escalation card is informational; a next step is letting a scholar mark a case as ongoing and surface it to an advisor.
- **Arabic language support.**

Validate demand before building any of the above — five to ten real scholars returning is worth more than any infrastructure investment made speculatively.

---

Built by [Mohammed Alkindi](https://github.com/alkindi-m) · [omanx.org](https://omanx.org)
