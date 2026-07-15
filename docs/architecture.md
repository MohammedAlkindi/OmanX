# OmanX Architecture

This document describes the system as it actually runs today.

## Summary

OmanX is a no-build vanilla JavaScript chat app backed by Anthropic Claude. Compliance-sensitive questions can use the local knowledge bases plus optional Tavily web search. Users can chat anonymously, or sign in with Google through Supabase for durable per-user daily quotas, signed-in image upload, and chat history sync.

Chat history is local-first. Anonymous history stays in `localStorage`; signed-in history syncs through one Supabase RLS-protected snapshot row per user.

## Directory Layout

```text
api/
  auth/
    config.js        # Public Supabase browser config
    session.js       # Bearer-token session check
  auth-utils.js      # Supabase token verification helpers
  chats.js           # Signed-in chat history sync snapshot API
  chat.js            # Chat, RAG, Tavily, SSE, quota, image input
  usage.js           # Daily quota status
  feedback.js
  health.js
  ready.js
  metrics.js
public/
  chat.html
  js/
    auth-client.js   # Browser Supabase OAuth and email-link auth flow
    chat-page.js
    chat-store.js
    core.js
data/
  us.json
  uk.json
  au.json
  mohe.json
```

## Auth Model

Supabase is optional.

- If `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are configured, the browser enables Google OAuth and passwordless email-link sign-in.
- The browser stores the Supabase session using Supabase's client-side auth storage.
- API requests send `Authorization: Bearer <supabase-access-token>`.
- The API validates tokens with Supabase before trusting the user id.
- If auth is absent, OmanX falls back to anonymous browser-session-hash quotas, with client IP hash as a last fallback.
- `/api/chats` uses the user bearer token with Supabase RLS, so users can read and write only their own `public.omanx_chat_sync` row.

## Quotas

Daily quota defaults:

```bash
RATE_LIMIT_ANONYMOUS_DAILY_MAX=3
RATE_LIMIT_AUTHENTICATED_DAILY_MAX=50
```

Quota keys:

- Signed in: `user:<supabase-user-id>`
- Anonymous: `session:<browser-session-id>`
- Fallback: `ip:<client-ip-hash>`

Upstash Redis is used for production quota state. Without Upstash, local development can use in-memory process state, but production readiness fails and chat requests are rejected instead of relying on non-durable serverless memory. If Redis is configured but unavailable, all tiers fail closed instead of falling back to memory.

## Image Upload

Signed-in users can attach screenshots/images to `/api/chat`.

Defaults:

```bash
IMAGE_UPLOAD_MAX_COUNT=1
IMAGE_UPLOAD_MAX_BYTES=3145728
```

Supported types:

- PNG
- JPEG
- WebP

Images are sent ephemerally to Anthropic with the current message. The local chat history stores only attachment metadata, not the image bytes.

## Chat History Sync

Signed-in sync flow:

1. Browser signs in with Google or passwordless email link via Supabase.
2. Browser calls `GET /api/chats` with the Supabase access token.
3. Local chats and the remote snapshot are merged by chat id and `updatedAt`.
4. Future local changes are debounced and saved with `PUT /api/chats`.
5. If another device updated the snapshot first, `/api/chats` returns `409`; the browser merges that remote snapshot and retries.

The Supabase migration lives at `supabase/migrations/20260710000000_create_omanx_chat_sync.sql`.

## Chat Flow

Everyday question:

```text
Browser -> POST /api/chat -> Claude -> SSE stream -> Browser
```

Compliance question:

1. `isCompliance()` detects high-stakes keywords.
2. `detectDestination()` selects US, UK, or AU from the message and profile context.
3. Destination KB is merged with `data/mohe.json`.
4. Tavily search runs when enabled and configured.
5. Claude streams the response over SSE.

Signed-in screenshot question:

1. Browser signs in with Google or passwordless email link via Supabase.
2. Browser sends token plus image data to `/api/chat`.
3. API validates the token, applies `user:<id>` quota, validates the image, and sends it to Claude.

## API Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Main chat endpoint. Optional Supabase bearer token. |
| `/api/chats` | GET, PUT | Signed-in chat history snapshot sync. Requires Supabase bearer token. |
| `/api/usage` | GET | Daily quota state. Optional Supabase bearer token. |
| `/api/auth/config` | GET | Public Supabase config for the browser. |
| `/api/auth/session` | GET | Validates current Supabase token. |
| `/api/feedback` | POST | Lightweight feedback logging. |
| `/api/health` | GET | Liveness. |
| `/api/ready` | GET | Readiness. |
| `/api/metrics` | GET | Process uptime/memory snapshot. |

## Out Of Scope

- PDF upload.
- Saved document history.
- Role-based admin dashboard.
- Deterministic rule engine or audit log.
