# OmanX MVP

OmanX is a **compliance-first AI assistant** for Omani students studying in the United States.

This MVP is designed for early launch, pilot usage, and Ministry-facing demos:
- Minimal UI for fast onboarding.
- Safety routing (normal vs strict compliance mode).
- Strict mode grounded in `knowledge.json` only.
- Automatic escalation language when no verified guidance exists.

## Product promise (MVP)
- **Audience:** Omani students in the US.
- **Core pain solved:** avoid visa/compliance mistakes and provide clear escalation paths.
- **Trust model:** verified content only for high-stakes topics.

## Quick start
```bash
npm start
```
Open `http://localhost:3000`.

## Required environment
Create `.env` (or set host environment variables):

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
NODE_ENV=production
RATE_LIMIT_MAX=120
ADMIN_KEY=optional_admin_key
```

You can use the provided example environment file as a starting point:

```bash
cp .env.example .env
# then edit .env to add your OPENAI_API_KEY and other values
```

## Deployment (Vercel)
This repository is configured for Vercel (`vercel.json`).

1. Import repository into Vercel.
2. Set environment variables (`OPENAI_API_KEY`, `OPENAI_MODEL`, `ADMIN_KEY`).
3. Deploy.
4. Smoke-check:
   - `GET /health`
   - `POST /chat` with a compliance question (e.g. visa/CPT/OPT)

## Key API endpoints
- `GET /health` – service + knowledge status
- `GET /ready` – readiness probe
- `POST /chat` – main assistant endpoint
- `POST /admin/cache/clear` – clear cache (admin in prod)
- `POST /admin/knowledge/reload` – reload `knowledge.json` (admin in prod)

## MVP scope decisions
To keep the project lean for launch/pitching:
- Removed non-essential test files from runtime package.
- Kept deterministic router + local fallback behavior.
- Focused UI on fast compliance-oriented usage.

---
OmanX MVP — built for Oman pilot adoption and iterative growth.
