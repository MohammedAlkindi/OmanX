# OmanX Enterprise Platform Blueprint (Civitas AI)

## 1) System Overview

OmanX should be rebuilt as a **policy intelligence platform** with three strict layers:

1. **Deterministic policy computation** (eligibility and compliance outcomes)
2. **LLM interpretation** (user-language translation and explanation)
3. **Presentation + workflow UX** (structured outcomes, no chatbot-first interface)

Core operating principle: **LLMs never decide policy outcomes**. They explain, summarize, and guide.

---

## 2) Architecture Design

### Service Boundaries

- **Experience Layer (Web + API Gateway)**
  - Next.js/React web app
  - BFF/API gateway for auth, request shaping, rate limits, response contracts
- **Decision Service (Deterministic)**
  - Rule engine for visa/admission/sponsorship logic
  - Scenario evaluator with reproducible outputs
- **Reasoning Service (LLM)**
  - Generates explanations, next-step guidance, document checklists
  - Constrained prompts + schema-validated outputs
- **Knowledge Service**
  - Canonical policy source registry
  - Community intelligence stream separated from official policy corpus
- **Audit & Trace Service**
  - Immutable decision logs, evidence references, model/version provenance
- **Identity & Access Service**
  - Supabase/Auth provider with RBAC + institutional tenancy

### Data Flow

1. User submits profile + objective (e.g., "UK scholarship route").
2. API gateway normalizes payload into `DecisionRequest`.
3. Decision Service computes rule outcomes from policy snapshots.
4. Knowledge Service returns source citations and policy versions used.
5. Reasoning Service translates outcomes into concise guidance.
6. Audit Service records request, inputs hash, rule execution graph, outputs.
7. UI renders structured cards with expandable explanation.

### Storage Layer

- **Postgres**: users, institutions, policies, rules, outcomes, pathways
- **Object storage**: policy PDFs, source snapshots, exported reports
- **Append-only log store** (or audit table with WORM controls): decision traces
- **Redis**: session cache, idempotency keys, queue locks

### API Contracts (examples)

- `POST /v1/eligibility/check`
  - input: profile, target country, intake date, constraints
  - output: `eligible | conditional | ineligible`, reasons, blocking conditions, required docs
- `POST /v1/pathways/build`
  - input: profile + preferences (budget, timeline, countries)
  - output: ranked pathways with compliance score + dependency graph
- `GET /v1/decisions/{decision_id}`
  - output: full trace, source set, rule versions, explanation packets

All responses must be strongly typed and schema-validated.

---

## 3) Reasoning Engine

### A) Deterministic Eligibility Engine

- DSL-driven rules (or decision tables) with:
  - predicates (age, GPA, language score, sponsorship status)
  - thresholds (hard constraints)
  - overrides/exceptions (ministry decrees, embassy guidance)
- Deterministic execution strategy:
  - same inputs + same policy version => same output
  - explicit “insufficient data” state instead of guessing

### B) LLM Interpretation Layer

Use LLM only for:
- translating decision results into user-facing language
- comparing pathways
- generating explanation and action checklist

Never use LLM for:
- eligibility final status
- policy conflict arbitration
- compliance-critical calculations

### C) Confidence Scoring

Composite confidence score:
- `rule_coverage_score` (how complete inputs are)
- `source_authority_score` (official vs community weight)
- `policy_freshness_score` (recency of source snapshot)
- `conflict_penalty` (if contradictory guidance exists)

### D) Conflict Resolution

Policy precedence chain:
1. Official ministry / embassy source (latest versioned)
2. University official publications
3. Partner institutions
4. Community data (advisory only)

When conflicts exist:
- mark outcome as `needs_review` or `conditional`
- surface conflict object with exact sources and dates
- force human review path for institutional users

---

## 4) Data Models

### `user_profile`
- `user_id (uuid)`
- `citizenship`, `residency_country`
- `academic_level`, `gpa`, `language_tests[]`
- `financial_profile` (budget, funding status)
- `sponsorship_status`
- `intake_target`
- `data_completeness_score`

### `eligibility_rule`
- `rule_id`, `policy_id`, `version`
- `jurisdiction` (country/program)
- `condition_expression` (machine-evaluable)
- `outcome_type` (`allow|deny|conditional`)
- `effective_from`, `effective_to`
- `authority_level`, `source_uri`

### `institution_requirement`
- `institution_id`, `country`, `program_type`
- `requirements_json`
- `deadline_windows`
- `source_snapshot_id`

### `sponsorship_constraint`
- `constraint_id`
- `sponsor_type` (government/private/family)
- `eligibility_conditions`
- `renewal_rules`
- `termination_triggers`

### `decision_log` (critical)
- `decision_id`, `request_id`, `user_id`
- `policy_bundle_version`
- `rules_executed[]`
- `input_hash`, `output_hash`
- `decision_status`, `confidence_score`
- `source_refs[]` (with authority and captured date)
- `llm_model_version`, `prompt_template_version`
- `created_at`, `actor_type` (`user|advisor|system`)

---

## 5) UX Redesign

## Mode 1: Eligibility Check

UI output (structured, first screen):
- status badge: Eligible / Conditional / Not Eligible
- blocking conditions
- missing inputs
- required documents
- confidence + source freshness

Secondary panel (“Explain”):
- rule-by-rule trace
- why each condition passed/failed

## Mode 2: Pathway Builder

UI output:
- 3–5 ranked pathways (table/cards)
- timeline per pathway (now → admission → visa)
- risk flags (policy volatility, deadline risk)
- estimated cost/sponsorship fit

Secondary panel:
- tradeoff matrix + “why ranked this way”

## Mode 3: Decision Breakdown

UI output:
- full decision graph
- source attribution split (Official vs Community)
- version IDs and evaluation timestamp
- export action (PDF/JSON)

Interaction model:
- command-bar style navigation
- progressive disclosure (details hidden by default)
- no infinite chat threads for critical decisions

---

## 6) Enterprise Features

- **Admin Policy Console**
  - policy ingestion, rule editing, staged publish, rollback
- **Institutional Multi-Tenancy**
  - ministry/partner workspaces, RBAC, approval queues
- **Audit Export**
  - signed PDF summary + machine-readable JSON trace
- **Policy Versioning**
  - semantic policy bundles (`OM-UK-STUDENT-2026.04.1`)
  - compare versions and impact simulation
- **Human-in-the-Loop Review**
  - force-review for conflicts, low confidence, policy drift

---

## 7) Differentiation

OmanX is defensible because it is:

1. **A decision infrastructure product**, not a chat UX wrapper
2. **Policy-version aware**, with deterministic outcomes and replayability
3. **Auditable by design**, including rule execution + source lineage
4. **Operationally aligned to institutions**, with governance workflows

Why it is not replaceable by generic ChatGPT:
- ChatGPT can explain policy; it cannot natively guarantee deterministic, versioned, institution-auditable decisions without custom infrastructure.

---

## 8) Roadmap

### Phase 1 — MVP Stabilization (0–8 weeks)
- Freeze typed contracts for eligibility/pathways/decision trace
- Implement deterministic rule engine v1 for top 3 destination countries
- Replace free-form chat answer path with structured response templates
- Add baseline logging, idempotency, and error budgets

### Phase 2 — Systemization + Trust Layer (2–5 months)
- Launch policy registry with versioning and source authority metadata
- Add confidence scoring + conflict detection
- Ship explainability panels and full decision trace retrieval
- Introduce advisor review workflow for low-confidence decisions

### Phase 3 — Enterprise + Scale (5–12 months)
- Multi-tenant institutional workspaces + RBAC
- Admin rule editor with staging and rollback
- Full audit export suite and compliance-ready reporting
- SLO-driven operations, eval harness, policy drift monitoring

---

## 9) Critical Gaps (Brutal Assessment)

Current likely weaknesses:
- chat-centric UX encourages ambiguous responses
- policy logic and language generation are insufficiently separated
- limited decision traceability for external audits
- weak policy lifecycle management (versioning + approvals)
- insufficient institutional controls (RBAC, tenancy, human review)

What must be removed:
- generic conversational “assistant persona” in compliance flows
- unstructured paragraph-first outputs for decisions
- any eligibility answer path that is not reproducible

What is missing for credibility:
- deterministic rule engine with replay capability
- immutable decision logs with source lineage
- formal governance process for policy updates
- institutional admin tooling and access control model
- measurable reliability targets (SLOs, eval benchmarks, incident process)
