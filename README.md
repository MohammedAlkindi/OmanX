# OmanX

AI-powered guidance platform for Omani students navigating life in the United States — visa compliance, arrival setup, housing, academic planning, and high-stakes escalation.

Built on Claude Sonnet, grounded in live government sources, and designed to handle questions that actually matter.

---

## What it does

Omani students on US campuses face a category of questions that generic AI gets wrong: immigration status, OPT/CPT deadlines, SEVIS compliance, insurance requirements, DSO escalation. The cost of a wrong answer is a visa violation.

OmanX is a structured guidance workspace that:

- Routes compliance questions through **live web search**, restricted to authoritative government domains (`uscis.gov`, `ice.gov`, `state.gov`, `dhs.gov`, and 5 others)
- Falls back to a **curated knowledge base** for context-specific Omani program details
- Runs on **Claude Sonnet 4.6** with optional **Haiku 4.5** for faster, lower-cost interactions
- Keeps all conversations **local-first** — no account required, no data leaves the browser until a message is sent

---

## Stack

| Layer | Technology |
|---|---|
| AI | Anthropic Claude (Sonnet 4.6 / Haiku 4.5) |
| Live search | Tavily API — domain-restricted to 9 government sources |
| Knowledge base | Structured `data/knowledge.json`, hot-reloaded on file change |
| Frontend | Vanilla JS (ES modules), single shared CSS design system |
| Persistence | `localStorage` — full chat history, settings, pinned state |
| Hosting | Vercel (serverless API routes + static frontend) |
| Rate limiting | Token bucket — 10 req/min per IP, enforced at the API layer |
| CORS | Locked to production origin; `localhost` allowed in development |

---

## Workspace features

**Conversations**
- Persistent chat history with inline rename, delete, pin, search, copy, and export
- Per-item `···` context menu — no separate settings page needed
- Auto-derived titles from the first user message

**Settings panel** (bottom-left sidebar)
- Theme: Light / Dark / System (follows `prefers-color-scheme`)
- Display name, custom assistant context, concise mode toggle
- Model selector: Sonnet (recommended) or Haiku (faster)

**Assistant**
- Compliance-triggered live search — detects 50+ keywords (visa, OPT, SEVIS, DSO, tax, etc.)
- KB + web search run in parallel; live results take precedence with source citations
- Response caching disabled for compliance queries — stale policy data is worse than no data

---

## Project structure

```
.
├── api/
│   ├── chat.js          # Claude + Tavily handler, rate limiting, KB search
│   ├── health.js
│   ├── metrics.js
│   └── ready.js
├── data/
│   └── knowledge.json   # Curated guidance content, hot-reloaded
├── public/
│   ├── js/
│   │   ├── core.js          # Theme engine, toast, shared utilities
│   │   ├── chat-store.js    # localStorage abstraction for chats + settings
│   │   └── chat-page.js     # Workspace UI — sidebar, composer, message rendering
│   ├── styles.css           # Full design system: tokens, dark mode, components
│   ├── chat.html            # Workspace
│   ├── index.html           # Landing page
│   ├── collaboration.html
│   ├── vision.html
│   └── settings.html
├── server.js            # Express server for local dev
├── vercel.json
└── package.json
```

---

## Running locally

```bash
npm install
cp .env.example .env   # add your API keys
npm start              # http://localhost:3000
```

**Required**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Optional — enables live policy search**
```
TAVILY_API_KEY=tvly-...
```

Get a Tavily key at [app.tavily.com](https://app.tavily.com) — 1,000 free searches/month. Without it, the assistant falls back to the local knowledge base silently.

---

## Deploying to Vercel

```bash
vercel --prod
```

Set `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` in your Vercel project environment variables. The `vercel.json` routes all API traffic through serverless functions and serves the frontend as static files.

---

## Design system

OmanX uses a single `styles.css` with CSS custom properties for every token — palette, typography, spacing, surface elevation, shadows. Dark mode is implemented as a full token override under `[data-theme="dark"]` and respects `prefers-color-scheme` when set to System.

Typefaces: DM Serif Display (headings), DM Sans (body), DM Mono (metadata/labels).

---

## What's next

- Authenticated profiles with cross-device sync
- Advisor dashboard — view flagged student conversations, assign case status
- Structured escalation flows for visa violations, medical emergencies, legal issues
- Push notifications for deadline proximity (OPT application windows, I-20 expiry)
- Arabic language support

---

Built by [Mohammed Alkindi](https://github.com/alkindi-m) · [omanx.org](https://omanx.org)
