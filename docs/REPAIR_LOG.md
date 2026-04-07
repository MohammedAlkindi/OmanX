# REPAIR_LOG.md — OmanX Codebase Changes

## Change 1: Move auth handlers to `api/auth/`

**Files moved (git mv):**
- `auth/_auth.js` → `api/auth/_auth.js`
- `auth/google.js` → `api/auth/google.js`
- `auth/github.js` → `api/auth/github.js`
- `auth/exchange.js` → `api/auth/exchange.js`
- `auth/start.js` → `api/auth/start.js`
- `auth/verify.js` → `api/auth/verify.js`
- `auth/session.js` → `api/auth/session.js`
- `auth/logout.js` → `api/auth/logout.js`

**Why:** Vercel auto-detects serverless functions only in the `api/` directory and its subdirectories. Placing auth handlers in `api/auth/` makes them available at `/api/auth/*` without any URL rewriting. This is the direct fix for the 404 on `/api/auth/google`.

**Internal imports unchanged:** All auth files import `from "./_auth.js"` (relative). Since they all move together into the same directory, these relative imports remain correct.

**Assumption:** No external system depends on a `GET /auth/google` path (without the `/api` prefix). The frontend calls `/api/auth/google`, which is what Vercel now serves directly.

---

## Change 2: Fix `api/chat.js` import

**File:** `api/chat.js:8`  
**Before:** `import { requireAuth } from "../auth/_auth.js";`  
**After:** `import { requireAuth } from "./auth/_auth.js";`  

**Why:** `_auth.js` was at `auth/_auth.js` (one level up, sibling to `api/`). After moving to `api/auth/_auth.js`, it is now one level down from `api/`, so the import path changes from `../auth/` to `./auth/`.

---

## Change 3: Update `server.js` import paths

**File:** `server.js:12-18`  
**Before:**
```js
import authStartHandler from './auth/start.js';
import authVerifyHandler from './auth/verify.js';
import authSessionHandler from './auth/session.js';
import authLogoutHandler from './auth/logout.js';
import authGoogleHandler from './auth/google.js';
import authGithubHandler from './auth/github.js';
import authExchangeHandler from './auth/exchange.js';
```
**After:**
```js
import authStartHandler from './api/auth/start.js';
import authVerifyHandler from './api/auth/verify.js';
import authSessionHandler from './api/auth/session.js';
import authLogoutHandler from './api/auth/logout.js';
import authGoogleHandler from './api/auth/google.js';
import authGithubHandler from './api/auth/github.js';
import authExchangeHandler from './api/auth/exchange.js';
```

**Why:** `server.js` is the local Express entry point. After auth files moved, the import paths must reflect the new location. The Express route registrations (`app.get('/api/auth/google', authGoogleHandler)`) remain unchanged since the URL paths were already correct.

---

## Change 4: Rewrite `vercel.json`

**File:** `vercel.json`

**Removed:**
- `{ "src": "/api/auth/(.*)", "dest": "/auth/$1" }` — this rewrite was the proximate cause of the 404; it rewrote to a path that had no deployed function
- `"auth/*.js": { "maxDuration": 10 }` — no longer needed; the `auth/` directory no longer contains functions

**Changed:**
- `"api/*.js"` → `"api/**/*.js"` in the `functions` key — the glob `api/*.js` only matched top-level files; `api/**/*.js` matches all depths including `api/auth/*.js`

**Retained:**
- `{ "src": "/api/(.*)", "dest": "/api/$1" }` — explicit pass-through for all API routes; ensures the `routes` array does not let the catch-all rule intercept API requests before function invocation
- All static page route rules unchanged
- `.html` redirect rules unchanged
- Catch-all fallback unchanged

**Why:** Vercel's auto-detection handles `api/**` functions. The explicit `/api/(.*)` route rule ensures API requests are routed to functions before the static catch-all can intercept them.

---

## Change 5: Fix `config/env.js` dotenv path

**File:** `config/env.js:8`  
**Before:** `dotenv.config({ path: path.join(__dirname, '.env') });`  
**After:** `dotenv.config({ path: path.join(__dirname, '..', '.env') });`  

**Why:** `__dirname` is `<project_root>/config`. The previous path resolved to `config/.env`, but the `.env.example` template and conventional developer workflow places `.env` at the project root. This fix makes `cp .env.example .env && nano .env` work out of the box for local development.

**Scope:** `config/env.js` is only imported by `server.js` (local dev). Vercel serverless functions read `process.env` directly from Vercel's environment variable dashboard. This change has no effect on production deployments.
