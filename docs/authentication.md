# OmanX Authentication

OmanX supports optional Google OAuth through Supabase Auth. Anonymous chat still works, but signed-in users get durable per-user daily quotas and can attach screenshots/images to chat requests.

## Architecture

- Browser auth lives in `public/js/auth-client.js`.
- Server auth helpers live in `api/auth-utils.js`.
- Public Supabase config is exposed by `GET /api/auth/config`.
- Token verification is exposed by `GET /api/auth/session`.
- `/api/chat` and `/api/usage` accept `Authorization: Bearer <supabase-access-token>`.
- If the token is valid, quota keys use `user:<supabase-user-id>`.
- If no token is present, quota keys fall back to the anonymous browser session id.

No chat history is stored in Supabase yet. Conversation history remains localStorage-only.

## Supabase Setup

1. Create a Supabase project.
2. Enable Google as an Auth provider in the Supabase dashboard.
3. Add OAuth callback URLs for local and production:
   - `http://localhost:3000/workspace`
   - `https://<your-production-domain>/workspace`
4. Add the environment variables to Vercel and local `.env`.

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-or-anon-key>
```

## Quotas

Anonymous and signed-in users currently share the same daily message count by default:

```bash
RATE_LIMIT_DAILY_MAX=20
```

The difference is durability: signed-in quota follows the Supabase user id across refreshes, browsers, and devices. Anonymous quota follows the local browser session id and can still be bypassed by clearing site data.

## Image Uploads

Signed-in users can attach screenshots/images to `/api/chat`. Images are sent ephemerally to Anthropic and are not saved in localStorage.

Defaults:

```bash
IMAGE_UPLOAD_MAX_COUNT=1
IMAGE_UPLOAD_MAX_BYTES=3145728
```

Supported types:

- PNG
- JPEG
- WebP

PDF upload and saved document history are intentionally not implemented yet.
