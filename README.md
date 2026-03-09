# OmanX.org

**OmanX** is a government-ready AI onboarding platform built to guide Omani scholars through studying and living in the United States with clarity, safety, and official alignment.

## What it is
A structured digital assistant that combines approved knowledge, step-by-step checklists, and constrained AI guidance to support students from pre-departure through their first semester in the U.S.

## Focus
- Pre-departure and arrival checklists  
- First-week and first-semester onboarding  
- U.S. systems (banking, housing, connectivity, campus setup)  
- High-stakes escalation (immigration, health, compliance)  
- Clear references to official and institutional sources  

## Philosophy
No guessing. No noise.  
Guidance is constrained to approved sources, designed for auditability, and built to escalate—not improvise—when stakes are high.

## Status
Pilot MVP in active development.

---
OmanX.org • Structured guidance for Omani scholars abroad


## Authentication
OmanX now supports passwordless authentication (magic link) for protected API access.

- Start sign-in: `POST /api/auth/start`
- Verify callback token: `POST /api/auth/verify`
- Check session: `GET /api/auth/session`
- Logout: `POST /api/auth/logout`
- Protected endpoint example: `POST /api/chat`

See `docs/authentication.md` for architecture and setup details.
