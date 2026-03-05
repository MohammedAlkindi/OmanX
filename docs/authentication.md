# OmanX Authentication (Passwordless, Serverless)

This project now uses **Supabase Auth magic links** with a **server-set HttpOnly session cookie**.

## Why this architecture

- Works with static frontend + Vercel serverless API routes (no framework migration).
- Passwordless flow avoids password storage and reset complexity.
- Minimal moving parts: Supabase Auth and lightweight verification using Supabase `/auth/v1/user`.
- API routes can verify the user identity before processing sensitive prompts.

## Flow

1. User submits email in the OmanX frontend.
2. `POST /api/auth/start` calls Supabase `/auth/v1/otp` to send magic link.
3. User clicks email link, returns to app with `token_hash` and `type` query params.
4. Frontend calls `POST /api/auth/verify`.
5. `verify` endpoint exchanges token with Supabase and sets `omanx_session` HttpOnly cookie.
6. Protected APIs (e.g., `/api/chat`) call `requireAuth(req)`, which validates the token against Supabase `/auth/v1/user`.

## Protected routes

- `/api/chat` now requires an authenticated user.
- `/api/auth/session` returns current authenticated user from session cookie.
- `/api/auth/logout` clears session cookie.

## Environment variables

Add to Vercel and local `.env`:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-key>
APP_BASE_URL=https://omanx.org
AUTH_REDIRECT_URL=https://omanx.org/
```

`AUTH_REDIRECT_URL` should point to the frontend page that handles `token_hash` and `type`.

## Security notes

- Session cookie is `HttpOnly` and `SameSite=Lax`.
- Cookie is marked `Secure` in production.
- Session tokens are verified with Supabase before each protected request.
- User identity is logged in `/api/chat` request metadata for accountability.

## Future extensions

- Add role-based rules (student/admin/auditor) by reading JWT claims.
- Store compliance cases in a DB table keyed by `user.id`.
- Add refresh-token handling for longer sessions when needed.
