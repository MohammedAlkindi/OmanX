# OmanX Architecture

This document describes the system as it actually runs in production today. There is
no authentication, no database, and no rule engine — those appear in older docs and in
[enterprise-platform-blueprint.md (removed)](#) as future ideas, not current behavior.
If a doc in this repo contradicts this file, this file wins.

---

## Summary

OmanX is a single chat endpoint backed by Anthropic's Claude, with an optional Tavily
web-search assist for compliance-sensitive questions, fronted by a static, no-build
vanilla-JS site. There is no login, no per-user accounts, and no server-side storage —
all chat history and settings live in the browser's `localStorage`.

## Directory layout

```
.
├── api/
│   ├── chat.js        # Main chat handler: RAG, Tavily search, SSE streaming, rate limit, cache
│   ├── health.js       # GET /api/health — liveness
│   ├── ready.js        # GET /api/ready — readiness
│   └── metrics.js      # GET /api/metrics — process uptime/memory (no dashboard wired up)
├── config/
│   └── env.js          # Loads .env from project root for local dev (server.js only)
├── data/
│   ├── us.json          # US compliance knowledge base
│   ├── uk.json          # UK compliance knowledge base
│   ├── au.json          # AU compliance knowledge base
│   └── mohe.json         # Omani MoHE rules, merged into every destination
├── public/
│   ├── index.html, chat.html, dashboard.html, system.html, method.html,
│   │   vision.html, contact.html, examples.html, trust.html, settings.html,
│   │   collaboration.html, 404.html, 405.html, 500.html
│   ├── styles.css       # Single global stylesheet (CSS variables in :root)
│   ├── app.js
│   └── js/
│       ├── core.js              # Shared utilities (uid, toast, theme, etc.)
│       ├── chat-store.js        # localStorage persistence for chats + settings
│       ├── chat-page.js         # Chat UI — rendering, settings, SSE streaming
│       └── <page>-page.js       # One controller per static page (landing, settings, trust, ...)
├── server.js            # Express app — local dev entry point, mirrors vercel.json routing
├── vercel.json           # Production routing: /api/* → serverless functions, rest → public/
└── package.json
```

There is no `auth/` directory and no `Supabase` dependency anywhere in this repo —
`config/env.js` only loads `.env` for local dev.

## Request flow

**Everyday question** (e.g. "best halal food near campus"):
`Browser → POST /api/chat → Claude (Sonnet 4.6 or Haiku 4.5) → SSE stream → Browser`

**Compliance question** (e.g. "can I work off-campus on OPT"):
1. `isCompliance()` flags the message from a keyword list (visa, OPT, SEVIS, DSO, tax, ...).
2. `detectDestination()` picks US/UK/AU from message + stored user context; the matching
   `data/<dest>.json` is merged with `data/mohe.json` as grounding context.
3. If `TAVILY_API_KEY` is set, a parallel web search runs restricted to a fixed list of
   government domains (`uscis.gov`, `gov.uk`, `homeaffairs.gov.au`, etc.); results are cited
   inline. Without a key, the system silently falls back to the static KB only.
4. Claude streams the answer back over SSE (`text/event-stream`); responses for compliance
   queries are not cached (everyday queries use a small in-memory cache, since this is a
   single-process model — it does not survive a serverless cold start or scale across instances).

## API endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | The only application endpoint. No auth header, no session. |
| `/api/health` | GET | Liveness probe — static `{ ok: true }`. |
| `/api/ready` | GET | Readiness probe — static `{ ready: true }`. |
| `/api/metrics` | GET | Process uptime/memory snapshot. Not wired to any dashboard or alerting. |

All page routes (`/`, `/chat`, `/system`, `/method`, `/vision`, `/contact`, `/examples`,
`/trust`, `/settings`, `/collaboration`, `/dashboard`) serve static HTML from `public/`.
`/dashboard` is a static informational page — it is not an authenticated admin console.

## Request-level controls in `api/chat.js`

- **Rate limiting**: in-memory, per-IP, 20 requests / 60s window. Resets on process
  restart and is not shared across serverless instances.
- **CORS**: if `ALLOWED_ORIGIN` is set, only that exact origin gets
  `Access-Control-Allow-Origin`; otherwise the header is omitted. There is no Express
  `cors` or `helmet` middleware in use.
- **Input limits**: message capped at 10,000 characters; last 20 turns of history kept;
  control characters stripped via `sanitizeMessage()`.
- **Model allowlist**: only `claude-sonnet-4-6` and `claude-haiku-4-5-20251001` are
  accepted from the client; anything else falls back to `DEFAULT_MODEL`.

## Frontend

Vanilla JS ES modules, no bundler, no framework — loaded directly by the browser.
`public/js/chat-store.js` persists chats and the `omanx.settings.v1` settings object
(`studentName`, `model`, `language`, `conciseMode`, `webSearch`, `dataConsent`) to
`localStorage`. There is no server-side user record anywhere.

## Local development

```bash
npm install
npm run dev   # node --watch server.js, http://localhost:3000
```

`server.js` is an Express app that imports the same handlers as the Vercel functions
(`api/chat.js`, `api/health.js`, `api/ready.js`, `api/metrics.js`) and serves `public/`
directly, so local dev and production exercise the same handler code.

## Deployment

Vercel. `vercel.json` routes `/api/*` to the serverless functions in `api/` and
everything else to static files in `public/`, with explicit rewrites for the clean
(no-`.html`) page URLs. See [deployment.md](deployment.md) for environment variables
and the rollout checklist.

## Explicitly out of scope (do not reintroduce in docs without shipping the code first)

- No authentication of any kind — no Supabase, no OAuth, no magic links, no sessions, no cookies.
- No database — `localStorage` is the only persistence layer.
- No deterministic rule/decision engine, no policy versioning, no audit log, no multi-tenancy.
- No `OpenAI` dependency — the only LLM provider is Anthropic.

If any of the above gets built, update this file in the same change.
