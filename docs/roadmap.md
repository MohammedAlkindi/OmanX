# OmanX Roadmap (Enterprise Track)

This roadmap aligns OmanX with institutional deployment requirements and audit-grade decisioning.

## Phase 1 — MVP Stabilization (0–8 weeks)

Objective: make decisions deterministic and contracts stable.

Scope:
- Freeze typed API contracts for eligibility/pathway/decision-trace endpoints
- Implement deterministic rule engine for primary destination jurisdictions
- Replace free-form decision responses with structured outputs
- Add baseline observability: latency, error rate, idempotency metrics

Exit criteria:
- Same input + policy version returns identical outcome
- 0 untyped decision responses in production paths
- Operational dashboards for core API health

## Phase 2 — Systemization + Trust Layer (2–5 months)

Objective: establish auditability and explainability at policy level.

Scope:
- Deploy policy registry with versioning, authority level, and effective windows
- Add confidence scoring and cross-source conflict detection
- Ship decision breakdown with source attribution and rule trace views
- Introduce human review queue for low-confidence and conflicted cases

Exit criteria:
- Every decision has traceable source set and executed-rule list
- Policy changes are versioned and reviewable before publish
- Explainability available without reading raw logs

## Phase 3 — Enterprise + Scale (5–12 months)

Objective: operationalize for ministries and institutional partners.

Scope:
- Multi-tenant access model with RBAC and institutional boundaries
- Admin dashboard for rule editing, staging, rollback, and impact simulation
- Signed audit exports (PDF + structured JSON)
- Reliability program: SLOs, policy drift checks, evaluation harness

Exit criteria:
- Institution-ready governance controls in production
- Exportable compliance artifacts accepted by pilot partners
- Quarterly reliability and quality reports generated automatically

## Program Principles

1. Determinism before automation
2. Auditability before scale
3. Governance before growth
4. Simplicity at the interface, rigor in the core
