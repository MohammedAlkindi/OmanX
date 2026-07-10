# OmanX — Codex Context

## What this project is
OmanX is an AI-powered guidance assistant for Omani scholars studying abroad (US, UK, Australia). It answers both everyday questions (campus life, food, activities) and compliance-critical questions (visas, work authorization, insurance, academic standing) in a single conversational interface. Founded by Mohammed Alkindi.

## Stack
- **Runtime**: Node.js 18+, Express (local dev), Vercel serverless (production)
- **AI**: Anthropic Codex via `@anthropic-ai/sdk` — models `Codex-sonnet-4-6` (default) and `Codex-haiku-4-5-20251001`
- **Frontend**: Vanilla JS ES modules, no framework, no build step
- **Search**: Tavily API for live web search on compliance questions (optional — degrades gracefully if key absent)
- **Deploy**: Vercel — `vercel.json` routes `/api/*` to serverless functions, everything else served from `public/`

## Key files
| Path | Purpose |
|---|---|
| `api/chat.js` | Main chat handler — RAG, Tavily search, streaming SSE, rate limiting, caching |
| `public/chat.html` | Chat UI shell |
| `public/js/chat-page.js` | All chat UI logic — rendering, settings, streaming |
| `public/js/chat-store.js` | localStorage persistence for chats and settings |
| `public/js/core.js` | Shared utilities (uid, toast, theme, etc.) |
| `public/styles.css` | Single global stylesheet |
| `data/us.json` | US compliance knowledge base (current) |
| `data/uk.json` | UK compliance knowledge base |
| `data/au.json` | AU compliance knowledge base |
| `data/mohe.json` | Shared Omani MoHE (Ministry of Higher Education) rules, merged into all destinations |

## Architecture decisions
- **No build step** — all frontend is vanilla ES modules loaded directly by the browser. Don't introduce bundlers or frameworks without discussing first.
- **SSE streaming** — `/api/chat` streams token-by-token via `text/event-stream`. The frontend uses a RAF-throttled render loop to avoid layout thrashing.
- **Multi-destination routing** — `detectDestination()` in `api/chat.js` auto-selects US/UK/AU knowledge base from message content. MoHE docs are always merged in.
- **Compliance detection** — `isCompliance()` triggers KB lookup + Tavily search only for high-stakes queries. Everyday questions skip both for speed.
- **Client-side state** — all chat history and settings live in `localStorage`. No user accounts, no server-side persistence.
- **Settings stored client-side**: `studentName`, `model`, `language`, `conciseMode`, `webSearch`, `dataConsent` — all in `omanx.settings.v1` localStorage key.

## Conventions
- CSS variables live in `:root` in `styles.css` — use them, don't hardcode colors or radii
- `data-*` attributes are used as JS selectors (never class names) to avoid style/behaviour coupling
- Toast notifications via `showToast()` from `core.js`
- New chat items default title is `'New chat'` — `deriveTitle()` updates it from first user message
- All user-facing strings go through `escapeHtml()` before insertion into innerHTML

## Environment variables
| Var | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Codex API |
| `TAVILY_API_KEY` | No | Live web search for compliance questions |
| `ALLOWED_ORIGIN` | No | CORS restriction (set to production domain in prod) |
| `ANTHROPIC_MODEL` | No | Override default model |
| `UPSTASH_REDIS_REST_URL` | No* | Upstash Redis URL for distributed rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | No* | Upstash Redis token for distributed rate limiting |

\* Required in production (Vercel). Without these, `/api/ready` returns 503 and chat requests fail closed; local development can still use the in-memory fallback.

## Running locally
```
npm install
npm run dev   # node --watch server.js on port 3000
```
`.env` file at root for environment variables.

## Long-term goals
- **Google OAuth + Supabase** — add user accounts and server-side persistence after OmanX has real users who are hitting friction (losing history, switching devices). The localStorage-only model is intentional for now — it's a privacy feature. Triggers to act: scholars complaining about lost history, cross-device sync requests, or a feature that genuinely requires a user identity (bookmarks, alerts, admin dashboard).
- **Analytics on real usage** — once auth exists, track what questions get asked, which destinations, and what goes unanswered to guide KB expansion.
- **Pitch first, build auth second** — validate with 5-10 real scholars or MoHE staff before investing in infrastructure. Return rate is the metric that matters.
- **Conversation export as markdown/PDF** — currently exports as `.txt` (strips all formatting). Markdown export would be immediately useful for scholars saving compliance guidance; PDF for sharing with advisors or MoHE.
