# OmanX Deployment Guide

This document defines how OmanX is deployed, configured, and operated in production.

The current deployment target is Vercel using serverless functions.

---

## 1. Deployment Architecture

OmanX uses:

- Express application (server.js)
- Serverless wrappers in /api
- Static frontend (index.html, styles.css, app.js)
- Vercel serverless runtime

Request Flow:

User → Vercel Edge → /api/chat → Express App → OpenAI → Response → Client

Static assets are served directly by Vercel.

---

## 2. Environment Variables

The following environment variables must be configured in Vercel:

Required:

OPENAI_API_KEY  
OPENAI_MODEL (default: gpt-4o-mini)  
NODE_ENV=production  

Optional:

ALLOWED_ORIGINS  
RATE_LIMIT_WINDOW_MS  
RATE_LIMIT_MAX_REQUESTS  

Never commit `.env` to version control.

---

## 3. Local Development

Install dependencies:

npm install

Run locally:

node server.js

If using nodemon:

npx nodemon server.js

Server runs on default port defined in server.js (commonly 3000).

Test endpoints:

GET /health  
GET /ready  
GET /metrics  
POST /api/chat  

---

## 4. Vercel Configuration

Ensure `vercel.json` correctly routes serverless functions.

Example structure:

- /api/*.js → serverless entrypoints
- Static files served from root

Important:

Each file inside /api must export a default handler function.

Example pattern:

export default async function handler(req, res) {
  return app(req, res);
}

If you see:

500: FUNCTION_INVOCATION_FAILED

Check:
- Missing environment variables
- Invalid import paths
- Uninstalled dependencies
- Incorrect ESM/CommonJS configuration

---

## 5. Production Deployment Steps

1. Push to GitHub main branch  
2. Vercel auto-build triggers  
3. Verify environment variables  
4. Monitor build logs  
5. Validate endpoints after deploy  

Post-deploy validation checklist:

- /health returns 200
- /ready returns 200
- /metrics responds
- Chat endpoint responds without crash
- No 500 errors in Vercel logs

---

## 6. Logging & Monitoring

Current logging:

- Console logs
- Express middleware logging

Recommended next step:

- Structured logging (JSON logs)
- Error classification
- Log aggregation

Do not log:

- API keys
- Full user queries in strict compliance mode (if sensitive)

---

## 7. Rollback Strategy

If deployment breaks:

1. Revert to previous Git commit
2. Redeploy via Vercel
3. Validate endpoints

Always keep last stable commit tagged.

Recommended:

git tag v1.0-stable

---

## 8. Security Controls

Current controls:

- Rate limiting
- Helmet middleware
- CORS restrictions
- Environment-based configuration

Future hardening:

- IP throttling
- Abuse detection
- Audit logging for strict mode
- Admin authentication layer

---

## 9. Known Failure Modes

Common Issues:

- Missing OPENAI_API_KEY → 500 error
- Incorrect ESM import syntax
- Serverless timeout
- Excessive token usage
- Unhandled promise rejection

Mitigation:

- Explicit try/catch in async routes
- Graceful fallback responses
- Health probes for liveness

---

## 10. Production Principles

- Deterministic behavior in compliance routes
- No silent failures
- Clear error responses
- Reproducible builds
- Immutable deployments

Deployment is not just “making it live.”  
Deployment is making it predictable under stress.
