# OmanX Roadmap

This roadmap outlines the phased evolution of OmanX from MVP to institutional-grade infrastructure for Omani scholars studying abroad.

The goal is not feature accumulation. The goal is reliability, governance, and scale.

---

## Phase 0 — MVP Stabilization (Current)

Objective: Make the system stable, predictable, and demo-ready.

Scope:
- Harden Express server
- Eliminate serverless invocation failures
- Validate strict routing triggers
- Ensure deterministic knowledge responses
- Add structured error handling
- Production deployment on Vercel
- Basic rate limiting and logging

Success Criteria:
- 99% uptime in test window
- No unhandled exceptions
- Sub-2s average response latency
- Clean demo flow for Ministry presentation

Status: In progress

---

## Phase 1 — Governance Hardening

Objective: Transform MVP into a compliance-aware system.

Scope:
- Formalize strict vs normal response lanes
- Add explicit citation injection from knowledge.json
- Add refusal logic for unsupported legal questions
- Log all compliance-triggered queries
- Create admin visibility for strict-mode activations

Add:
- compliance-model.md documentation
- structured response schema

Success Criteria:
- Zero uncited compliance responses
- Reproducible outputs for identical strict queries
- Clear audit trail for sensitive responses

---

## Phase 2 — Knowledge Layer Expansion

Objective: Move from static JSON to structured policy engine.

Scope:
- Migrate knowledge.json to versioned schema
- Introduce metadata fields:
  - source
  - last_updated
  - authority_level
- Add knowledge validation pipeline
- Create policy update workflow

Optional:
- Move to lightweight database (e.g., Postgres)
- Admin interface for content updates

Success Criteria:
- Policy entries version-controlled
- Update workflow documented
- No direct production file edits

---

## Phase 3 — Observability & Metrics

Objective: Make the system measurable.

Scope:
- Request classification metrics
- Strict-mode frequency tracking
- Response latency metrics
- Error rate tracking
- Basic analytics dashboard

Add:
- metrics endpoint expansion
- evaluation framework for answer accuracy

Success Criteria:
- Monthly performance report
- Latency and error thresholds defined
- Usage insights available for stakeholders

---

## Phase 4 — Institutional Readiness

Objective: Prepare OmanX for Ministry-level integration.

Scope:
- Role-based access control
- Admin dashboard
- Structured user authentication
- SLA definition
- Data retention policy
- Formal security review

Add:
- threat-model.md
- security hardening checklist
- legal disclaimer framework

Success Criteria:
- Deployment architecture documented
- Risk mitigation documented
- Clear operational ownership model

---

## Phase 5 — Platform Expansion

Objective: Evolve from assistant to infrastructure.

Potential Extensions:
- Integration with Ministry APIs
- Multi-country compliance modules
- Scholar dashboard
- Case tracking system
- Human escalation workflow
- Verified response tagging

Long-Term Direction:
- OmanX as official compliance co-pilot
- Shared knowledge layer across embassies
- Centralized policy distribution system

---

## Guiding Principles

1. Determinism before scale  
2. Governance before growth  
3. Auditability before automation  
4. Stability before expansion  

OmanX should evolve as infrastructure, not as a chatbot.
