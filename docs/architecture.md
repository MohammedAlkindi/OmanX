# OmanX Architecture

This document describes the system as it actually runs today.

## Summary

OmanX is a no-build vanilla JavaScript chat app backed by Anthropic Claude. Compliance-sensitive questions can use the local knowledge bases plus optional Tavily web search. Users can chat anonymously, or sign in with Google through Supabase for durable per-user daily quotas and signed-in image upload.

Chat history and settings remain localStorage-only. There is no server-side conversation database yet.

## Directory Layout

```text
api/
  auth/
    config.js        # Public Supabase browser config
    session.js       # Bearer-token session check
  auth-utils.js      # Supabase token verification helpers
  chat.js            # Chat, RAG, Tavily, SSE, quota, image input
  usage.js           # Daily quota status
  feedback.js
  health.js
  ready.js
  metrics.js
public/
  chat.html
  js/
    auth-client.js   # Browser Supabase Google OAuth flow
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

- If `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are configured, the browser enables "Continue with Google".
- The browser stores the Supabase session using Supabase's client-side auth storage.
- API requests send `Authorization: Bearer <supabase-access-token>`.
- The API validates tokens with Supabase before trusting the user id.
- If auth is absent, OmanX falls back to anonymous browser-session quotas.

## Quotas

Daily quota defaults to 20 messages:

```bash
RATE_LIMIT_DAILY_MAX=20
```

Quota keys:

- Signed in: `user:<supabase-user-id>`
- Anonymous: `session:<browser-session-id>`
- Fallback: `ip:<client-ip>`

Upstash Redis is used when configured. Without Upstash, quotas fall back to in-memory process state and are not durable across serverless instances.

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

1. Browser signs in with Google via Supabase.
2. Browser sends token plus image data to `/api/chat`.
3. API validates the token, applies `user:<id>` quota, validates the image, and sends it to Claude.

## API Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Main chat endpoint. Optional Supabase bearer token. |
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
- Server-side chat sync.
- Role-based admin dashboard.
- Deterministic rule engine or audit log.
