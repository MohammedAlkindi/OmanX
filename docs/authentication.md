# OmanX Authentication

OmanX supports optional Google OAuth and Supabase passwordless email links. Anonymous visitors can preview the chat with 3 free messages, then OmanX invites them to sign in. Signed-in users from either method get durable per-user daily quotas, screenshot/image attachments, and synced chat history.

## Architecture

- Browser auth lives in `public/js/auth-client.js`.
- Server auth helpers live in `api/auth-utils.js`.
- Public Supabase config is exposed by `GET /api/auth/config`.
- Token verification is exposed by `GET /api/auth/session`.
- `/api/chat` and `/api/usage` accept `Authorization: Bearer <supabase-access-token>`.
- `/api/chats` accepts the same bearer token and stores one sanitized chat-history snapshot per signed-in user.
- If the token is valid, quota keys use `user:<supabase-user-id>`.
- If no token is present, quota keys use the browser session id hash, with a client IP hash as a last fallback.

Chat history is local-first. The browser always saves to `localStorage`; after sign-in it pulls the user's Supabase snapshot, merges it with local history, and pushes future changes. Anonymous history remains on the device unless the user signs in and the local history is not already owned by a different signed-in account.

## Supabase Setup

1. Create a Supabase project.
2. Enable Google as an Auth provider in the Supabase dashboard.
3. Keep Supabase email OTP enabled for passwordless email-link sign-in. OmanX uses Supabase's built-in `signInWithOtp` flow; it does not mint or verify custom tokens.
4. Add OAuth callback URLs for local and production:
   - `http://localhost:3000/`
   - `https://<your-production-domain>/`
   - Optional legacy/testing routes: `http://localhost:3000/workspace`, `https://<your-production-domain>/workspace`
5. Set Supabase Auth Site URL to `https://<your-production-domain>` and keep the production redirect allow-list focused on the canonical domain.
6. In Supabase project/Auth branding, set the application name and logo to OmanX.
7. In Google Cloud OAuth consent screen, set the app name to OmanX and verify the production domain if Google still displays the Supabase project ref.
8. For a fully branded Google screen, configure a Supabase custom domain such as `auth.omanx.org`. Without a custom Supabase auth domain, Google may show `<project-ref>.supabase.co` because the OAuth callback is hosted by Supabase.
9. Add the environment variables to Vercel and local `.env`.
10. Run the chat sync migration in `supabase/migrations/20260710000000_create_omanx_chat_sync.sql`.

```bash
PUBLIC_SITE_URL=https://omanx.org
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-or-anon-key>
```

## Chat History Sync

The sync table is `public.omanx_chat_sync`. It stores:

- `user_id` — the Supabase Auth user id, primary key.
- `chats` — sanitized JSON chat snapshot.
- `active_chat_id` — the active conversation id.
- `updated_at` — conflict marker used by the client to merge before retrying.

RLS policies in the migration allow authenticated users to read and write only their own row. The app does not need a service-role key for chat sync.

## Quotas

Anonymous preview and signed-in usage have separate daily limits:

```bash
RATE_LIMIT_ANONYMOUS_DAILY_MAX=3
RATE_LIMIT_AUTHENTICATED_DAILY_MAX=50
```

Signed-in quota follows the Supabase user id across refreshes, browsers, and devices. Anonymous quota follows the browser session id hash, with client IP hash fallback when the browser session id is absent. In production, configure Upstash Redis; without it, `/api/ready` returns 503 and chat requests fail closed. If Redis is configured but unavailable, both anonymous and signed-in tiers also fail closed instead of using non-durable serverless memory.

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
