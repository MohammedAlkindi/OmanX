# PITCH_READY_REPORT.md — OmanX Demo Readiness

## What Now Works

| Feature | Status | Notes |
|---------|--------|-------|
| Landing page (`/`) | ✅ Working | Static, no auth required |
| All static pages (system, method, vision, contact, examples, trust, settings, collaboration) | ✅ Working | No auth required |
| Clean URL routing (no `.html` extensions) | ✅ Working | 301 redirects from `.html` paths |
| Google OAuth sign-in | ✅ Fixed | Was 404; now routes to `api/auth/google.js` via Vercel auto-detection |
| GitHub OAuth sign-in | ✅ Fixed | Same fix as Google |
| Magic-link email sign-in | ✅ Working | `POST /api/auth/start` + `POST /api/auth/verify` |
| OAuth token exchange | ✅ Working | `POST /api/auth/exchange` handles hash tokens from Supabase redirect |
| Session persistence | ✅ Working | HttpOnly cookie via `api/auth/session.js` |
| Logout | ✅ Working | Clears session cookie |
| AI chat (`/workspace`) | ✅ Working | Requires auth + valid `OPENAI_API_KEY` |
| Knowledge base retrieval | ✅ Working | Compliance-triggered KB search in `data/knowledge.json` |
| Chat history (local storage) | ✅ Working | Persists across page refreshes, no server required |
| Local Express dev server | ✅ Fixed | `server.js` imports updated to new `api/auth/` paths |
| `.env` loading locally | ✅ Fixed | `config/env.js` now loads from project root |

---

## What Remains Mocked or Limited

| Feature | Status | Notes |
|---------|--------|-------|
| Chat responses without OpenAI key | ⚠️ Graceful error | Returns a "not configured" message if `OPENAI_API_KEY` is missing; no hard crash |
| Metrics endpoint (`/api/metrics`) | ⚠️ Basic | Returns process uptime/memory; not connected to any dashboard |
| Settings page persistence | ⚠️ localStorage only | Settings (student name, etc.) are stored client-side; no server-side profile |
| Collaboration page | ⚠️ Static | Content is static/informational; no live collaboration feature |
| Rate limiting | ⚠️ None | No per-user rate limiting on `/api/chat`; relies on OpenAI's own limits |
| `data/knowledge.json` content | ⚠️ Demo data | KB content should be reviewed/expanded before real launch |

---

## Deployment Notes

### Vercel Environment Variables Required
Set these in the Vercel project dashboard before deploying:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL (e.g. `https://abc.supabase.co`) |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (for admin operations) |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `APP_BASE_URL` | Yes | Production base URL (e.g. `https://www.omanx.org`) |
| `AUTH_REDIRECT_URL` | Yes | OAuth redirect URL (e.g. `https://www.omanx.org/workspace`) |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` |
| `NODE_ENV` | No | Set to `production` for secure cookie flags |

### Supabase OAuth Configuration
In your Supabase project dashboard:
1. **Authentication → Providers → Google**: Enable, add Google OAuth client ID + secret
2. **Authentication → URL Configuration**: Add `https://www.omanx.org/workspace` to **Redirect URLs**
3. **Authentication → Providers → GitHub** (optional): Enable for GitHub sign-in

### Google Cloud Console
In your Google Cloud project:
1. **Credentials → OAuth 2.0 Client IDs**: Add `https://<your-supabase-project>.supabase.co/auth/v1/callback` as an **Authorized redirect URI**

### Domain Configuration
- Vercel project should have both `omanx.org` and `www.omanx.org` as custom domains
- Vercel automatically handles TLS and can redirect apex → www or vice versa
- `APP_BASE_URL` and `AUTH_REDIRECT_URL` env vars should use the canonical domain (matching what's in Supabase's redirect URL allowlist)

---

## Known Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Supabase redirect URL mismatch | High | Ensure `AUTH_REDIRECT_URL` in Vercel matches exactly what's in Supabase's allowed redirect URLs list |
| `www` vs apex domain inconsistency | Medium | Register both domains in Vercel; set Supabase redirect URL to whichever is canonical |
| OpenAI rate limits during demo | Medium | `gpt-4o-mini` has generous limits; cache is in-memory for identical queries |
| Session cookie `Secure` flag requires HTTPS | Low | Already conditional on `NODE_ENV=production`; always true on Vercel |
| In-memory response cache resets on cold starts | Low | Cache is per-function-instance; acceptable for demo |

---

## Prototype Safety Assessment

**Safe for live demo: YES**, with the following conditions met:

1. All Vercel environment variables are set
2. Supabase has Google (and optionally GitHub) OAuth configured with the correct callback URL
3. The production domain (`www.omanx.org` or `omanx.org`) is registered in both Vercel and Supabase's redirect URL allowlist
4. `NODE_ENV=production` is set in Vercel to enable secure cookie flags

**The critical Google sign-in 404 is fixed.** The auth flow is now:
- `/api/auth/google` → deployed as Vercel function at `api/auth/google.js` → redirects to Supabase → returns to `/workspace#access_token=...` → exchange handler sets session cookie → user is authenticated.

The product is coherent, the core flows are functional, and there are no broken or dead pages. It is investor-safe for a live demonstration.
