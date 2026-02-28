# OmanX Repository Architecture

This document describes the current codebase structure of OmanX.

The architecture follows a lightweight Express + serverless deployment model optimized for Vercel.

---

## Root Directory

.
├── api/  
├── data/  
├── docs/  
├── public/  
├── node_modules/  
├── .env  
├── .gitignore  
├── app.js  
├── index.html  
├── package.json  
├── package-lock.json  
├── README.md  
├── server.js  
├── styles.css  
├── vercel.json  

---

## /api

Serverless entrypoints for Vercel deployment.

Each file exports a handler function. These routes forward requests to the main Express app.

api/
├── chat.js        → Main AI chat endpoint  
├── health.js      → Liveness check  
├── metrics.js     → Observability / request metrics  
└── ready.js       → Readiness probe  

Purpose:
- Enables serverless routing on Vercel
- Separates infrastructure endpoints from core logic
- Keeps deployment layer isolated

---

## /data

Static knowledge layer.

data/
└── knowledge.json

Purpose:
- Deterministic knowledge base
- Used for compliance-grounded responses
- Allows auditable policy references

This layer should remain read-only in production.

---

## /docs

Project documentation.

docs/
└── architecture.md

Purpose:
- Technical documentation
- System reasoning
- Design decisions

---

## /public

Static assets served to the browser.

public/
├── favicon-16x16.png  
├── favicon-32x32.png  
├── favicon.ico  
├── icon.svg  
└── site.webmanifest  

Purpose:
- Branding assets
- PWA support
- Browser metadata

---

## Frontend Layer

index.html  
styles.css  
app.js  

Purpose:
- Minimal client-side interface
- Sends requests to /api/chat
- Renders AI responses
- No framework dependency

This is intentionally lightweight for MVP clarity.

---

## Backend Layer

server.js  

Purpose:
- Express server
- Middleware (security, logging, rate limiting)
- OpenAI integration
- Deterministic routing logic
- Knowledge loading
- Compliance controls

This is the core application logic.

---

## Configuration

.env  
- API keys  
- Model selection  
- Environment flags  

vercel.json  
- Serverless routing config  
- Deployment behavior  

package.json  
- Dependencies  
- Scripts  
- Runtime configuration  

---

## Architectural Characteristics

- API-first design
- Serverless-compatible
- Deterministic knowledge layer
- Lightweight frontend
- Single responsibility per directory
- Clean separation between infrastructure and logic

---

## Design Philosophy

The repository prioritizes:

- Auditability
- Deployment simplicity
- Minimal surface area
- Clear boundary between static knowledge and generative logic
- Infrastructure isolation via /api

The system is intentionally simple to reduce operational fragility during MVP phase.

Future scaling would likely introduce:

- /services layer
- /lib utilities
- Database abstraction
- Structured logging pipeline
- Typed schemas

But current structure is appropriate for an MVP.
