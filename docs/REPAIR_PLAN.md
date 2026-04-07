# REPAIR_PLAN.md — OmanX Codebase Audit

## Product Summary

OmanX is an AI-powered guidance assistant built for Omani scholars studying in the United States. It provides a secure, session-based chat workspace backed by OpenAI (GPT-4o-mini), with authentication via Supabase (Google OAuth, GitHub OAuth, and magic-link email). The frontend is vanilla JavaScript served as static files; the backend is a set of Express-style serverless functions deployed on Vercel.

---

## Architecture Summary

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vanilla JS, HTML/CSS | Served from `public/` |
| Backend | Node.js serverless functions | Deployed on Vercel via `api/` directory |
| Auth | Supabase Auth | Google OAuth, GitHub OAuth, magic-link |
| AI | OpenAI `gpt-4o-mini` | Via `/api/chat` |
| Deployment | Vercel (v2) | `outputDirectory: "public"` |
| Local Dev | Express.js (`server.js`) | Imports same handlers as Vercel functions |

**Request flow (Google sign-in):**
1. User clicks "Sign in with Google" on `/workspace`
2. Frontend sets `window.location.href = '/api/auth/google'`
3. `/api/auth/google` handler redirects to `https://<supabase-project>.supabase.co/auth/v1/authorize?provider=google&redirect_to=<APP_BASE_URL>/workspace`
4. Google handles OAuth and redirects back to Supabase callback
5. Supabase redirects to `<AUTH_REDIRECT_URL>#access_token=...`
6. Frontend at `/workspace` detects the hash token and POSTs to `/api/auth/exchange`
7. Exchange handler validates token with Supabase and sets a session cookie
8. User is authenticated; chat is enabled

---

## Critical Bugs Found

### BUG-1 (CRITICAL): Auth handlers in wrong directory for Vercel — ROOT CAUSE of 404
**File:** `vercel.json`, `auth/` directory  
**Symptom:** `https://www.omanx.org/api/auth/google` → `404: NOT_FOUND`  
**Root cause:** Auth handler files lived in `auth/` at the project root. Vercel only auto-detects serverless functions in the `api/` directory tree. The `vercel.json` attempted to fix this with a rewrite rule `{ "src": "/api/auth/(.*)", "dest": "/auth/$1" }`, but Vercel's `dest` in `routes` does not reliably invoke functions outside `api/` when `outputDirectory` is set — it falls through to static file serving, which finds nothing, hence 404.

### BUG-2 (HIGH): Broken import in `api/chat.js`  
**File:** `api/chat.js:8`  
**Symptom:** `import { requireAuth } from "../auth/_auth.js"` — path `../auth/_auth.js` is correct when auth files are in `auth/`, but becomes a dangling import after the directory reorganization.  
**Fix required:** Update to `./auth/_auth.js` after moving auth to `api/auth/`.

### BUG-3 (HIGH): `vercel.json` functions glob misses subdirectory  
**File:** `vercel.json`  
**Symptom:** `"api/*.js"` only matches top-level files in `api/`, not `api/auth/*.js`.  
**Fix:** Change to `"api/**/*.js"`.

### BUG-4 (MEDIUM): `config/env.js` loads `.env` from wrong directory  
**File:** `config/env.js`  
**Symptom:** `dotenv.config({ path: path.join(__dirname, '.env') })` resolves to `config/.env`. The `.env.example` template is at the project root, so developers creating `.env` at the root get no env var loading locally.  
**Fix:** Change path to `path.join(__dirname, '..', '.env')` to load from project root.

### BUG-5 (LOW): `server.js` import paths become stale  
**File:** `server.js`  
**Symptom:** After moving auth files, all `import ... from './auth/...'` imports break.  
**Fix:** Update to `'./api/auth/...'`.

---

## Likely Root Cause of Google Sign-In Failure

Vercel's serverless function auto-detection only covers files in the `api/` directory. Files in a top-level `auth/` directory are **not automatically deployed as functions**, even when listed in the `functions` key of `vercel.json` — that key only sets *properties* (memory, maxDuration) for already-detected functions, it does not register new function directories.

The `routes` rewrite `{ "src": "/api/auth/(.*)", "dest": "/auth/$1" }` rewrites the URL to `/auth/google`, but since there is no deployed function at that path (only in the static `public/` output context), Vercel falls through to static file serving and returns 404.

---

## Repair Strategy (Priority Order)

1. **[P0] Move `auth/*.js` → `api/auth/`** — makes functions auto-detected, eliminates all routing indirection
2. **[P0] Update `api/chat.js` import** — prevents broken import after reorganization
3. **[P0] Update `server.js` imports** — keeps local Express dev working
4. **[P1] Simplify `vercel.json`** — remove the broken auth rewrite, update functions glob to `api/**/*.js`
5. **[P2] Fix `config/env.js`** — load `.env` from project root for consistent local dev experience
