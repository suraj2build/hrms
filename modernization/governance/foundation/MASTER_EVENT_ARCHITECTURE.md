# MASTER EVENT TAXONOMY + EVENT-DRIVEN ARCHITECTURE
## AI-Native Workforce Operating System (Enterprise HRMS Platform)

**Document Classification:** Core Platform Event Architecture Specification  
**Version:** 1.0  
**Date:** May 2026  
**Authored By:** Principal Distributed Systems Architect  
**Status:** Canonical Reference — All Engineering Teams  
**Companion Document:** Master Domain Modeling + Bounded Context Architecture v1.0

---

> *"In a distributed system, the event is not a notification of what happened — it is the irrefutable, immutable record of what happened. The architecture that treats events as first-class citizens will outlast every architecture that treats them as implementation details."*

---

# SECTION 1: EVENT ARCHITECTURE PHILOSOPHY

---

## 1.1 Why Events Are the Correct Foundation for Enterprise HRMS

Enterprise HRMS platforms process a category of data that is fundamentally **temporal and causal** — every business fact has a "when" and a "because." An employee is paid a certain amount *because* they worked a certain number of hours *after* a policy was changed *before* the payroll cutoff date. An attendance record shows absence *because* leave was approved *after* a regularization was rejected.

This causality chain is **lost** in systems designed around current-state records. A database row tells you what is true today. It cannot tell you why it became true, what it was before, or what sequence of decisions produced the current state. This is not merely an auditability problem — it is an analytical and operational problem. Without the event history, you cannot:

- Replay a payroll computation to explain a variance
- Detect the sequence that preceded a compliance violation
- Train an ML model on the causal features that precede attrition
- Feed a real-time dashboard with sub-second workforce intelligence
- Reconstruct any aggregate state at any point in time

An **event-first architecture** solves all of these simultaneously. Events are the immutable, ordered record of what occurred — and from events, every current-state view, every analytical projection, every AI feature, and every audit report is derived.

---

## 1.2 Event-First Operational Architecture

The governing principle of this platform's event architecture:

> **State is derived. Events are primary.**

This means: when the Attendance domain processes a punch, the truth of that operation is the `attendance.punched` event — not the database row it writes. The database row is a materialized view of the event, optimized for the read patterns the application requires. It can be rebuilt from events if corrupted. It can be replaced with a different schema as requirements evolve. The event cannot be changed — it is the fact.

```
TRADITIONAL ARCHITECTURE (State-First)
  User Action → Update Database → Trigger notification
  Problem: State is truth. History requires audit logs bolted on.
  Problem: Analytics queries hit operational database.
  Problem: No causality. No replay. No projection flexibility.

EVENT-FIRST ARCHITECTURE (Event-Primary)
  User Action → Validate → Produce Event → Persist to Outbox
                                              ↓
                             ┌───────────────┤
                             ▼               ▼               ▼
                      State Store    Analytics     Notifications
                      (read model)   Projection    Dispatch
                      ▼               ▼               ▼
                  Current state   KPI updates    User alerts
                                  (real-time)

  Truth: The event.
  Everything else: derived projections, each optimized for its consumer.
```

---

## 1.3 Event Sourcing Considerations

This architecture adopts **selective event sourcing** — not full event sourcing across all domains. Full event sourcing (where the aggregate state is computed by replaying every event) is operationally expensive and adds significant complexity. The benefits are strongest where:

1. **Audit requirements are absolute** (payroll computations, compliance decisions)
2. **Historical recomputation is a business requirement** (what would payroll have been under the old policy?)
3. **Complex state transitions must be fully traceable** (workflow approval chains)

**Event sourcing IS applied to:**
- `PayrollRun` aggregate (all state transitions sourced from events — every computation step is an event)
- `AttendanceCycle` aggregate (punch events are the source of truth; daily records are projections)
- `WorkflowInstance` aggregate (all stage transitions are events)
- `PolicyDefinition` aggregate (all version changes are events — complete policy history)
- `LeaveBalance` aggregate (all balance movements are events — full ledger traceability)

**Event sourcing is NOT applied to:**
- `Employee` master record (standard aggregate with change events; full replay would be unnecessarily complex)
- `OrganizationalUnit` (change events emitted; state stored as current record with effective-date history)
- `UserAccount` (IAM domain uses standard entity with security event emission)

The principle: **emit events everywhere; source state from events where auditability and replayability justify the additional complexity.**

---

## 1.4 Async-First Evolution Strategy

The platform evolves through a defined trajectory from synchronous-first to async-first:

```
SYNCHRONOUS-FIRST (Current state)
  ┌───────────────────────────────────────────────────────┐
  │  Request → Domain Logic → DB Write → Response         │
  │  Notifications: inline (blocking)                     │
  │  Analytics: inline queries on OLTP DB                 │
  │  Cross-domain: direct function calls                  │
  └───────────────────────────────────────────────────────┘
  Cost: Tight coupling. Slow responses. No resilience.

ASYNC-FIRST (Target state — phased evolution)
  ┌───────────────────────────────────────────────────────┐
  │  Request → Domain Logic → DB Write + Outbox           │
  │                                   ↓                   │
  │                         Async Event Bus               │
  │                    ┌────────┬───────┬─────────┐       │
  │                    ▼        ▼       ▼         ▼       │
  │               Analytics  Notify  Audit   AI Feed      │
  │               (async)    (async) (async)  (async)     │
  └───────────────────────────────────────────────────────┘
  Gain: Decoupled. Scalable. Resilient. Observable.
```

### Async-First Rules:
1. **Cross-domain side effects are always async.** If Payroll completion needs to trigger a notification, that is an async event — never a synchronous call into Notifications from Payroll.
2. **Analytics is always async.** No domain operation waits for an analytics update to complete before responding to the caller.
3. **AI inference is always async.** No API response is blocked waiting for an ML model inference result.
4. **Synchronous operations are reserved for:** user-facing API responses, permission checks, balance validations where business logic requires real-time consistency.

---

## 1.5 Modular Monolith Event Architecture

In the modular monolith phase, domain events flow through an **in-process event dispatcher backed by a transactional outbox**. This architecture provides all the semantic benefits of event-driven architecture (decoupling, auditability, async processing) without the operational overhead of a distributed message broker.

```
MODULAR MONOLITH EVENT FLOW

┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION PROCESS                           │
│                                                                  │
│  ┌──────────────┐         ┌──────────────────────────────────┐ │
│  │ Domain A     │         │        OUTBOX TABLES             │ │
│  │ (e.g. Leave) │         │  attendance.outbox               │ │
│  │              │         │  leave.outbox                    │ │
│  │  Aggregate   │──TX────►│  payroll.outbox                  │ │
│  │  state change│         │  workflow.outbox                 │ │
│  │  + outbox    │         │  ...                             │ │
│  │  INSERT      │         └──────────────┬───────────────────┘ │
│  └──────────────┘                        │                      │
│                                          │ Outbox Relay (poll)  │
│                                          ▼                      │
│                         ┌───────────────────────────────┐      │
│                         │    IN-PROCESS EVENT BUS        │      │
│                         │  (EventDispatcher / MediatR)   │      │
│                         └──────────────┬────────────────┘      │
│                                        │                        │
│              ┌─────────────────────────┼──────────────────┐    │
│              ▼                         ▼                    ▼   │
│  ┌─────────────────┐   ┌──────────────────┐  ┌──────────────┐ │
│  │ Analytics       │   │ Audit Consumer   │  │ Notification │ │
│  │ Projection      │   │                  │  │ Dispatcher   │ │
│  │ Handler         │   │                  │  │              │ │
│  └─────────────────┘   └──────────────────┘  └──────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits of this approach:**
- Zero network hops for event delivery (same process)
- No broker infrastructure to operate
- Full transactional consistency: aggregate state + outbox record in same DB transaction
- Same consumer interfaces work when migrated to external broker
- Easy debugging: events visible in outbox tables during development

---

## 1.6 The Five Benefits of Event-First HRMS Architecture

### Operational Benefit
Every workflow, approval, and process state transition is driven by events. This means process visibility is complete at all times — no "black box" processing where an administrator cannot determine the current state of a payroll run or leave approval chain.

### Scalability Benefit
Event consumers scale independently of event producers. When attendance punch volume spikes during shift changes, the punch ingestion service scales independently of the downstream processors (analytics, AI, audit) that consume those events. No component need be co-deployed or co-scaled with any other.

### Analytics Benefit
Every operational event is simultaneously a data point for the analytics layer. The analytics domain builds its projections by consuming the same events the operational system produces — no ETL pipelines, no reporting replicas, no scheduled batch jobs that create stale data. Analytics are as fresh as the most recent event.

### AI Benefit
AI models require high-quality, timestamped, causally-ordered historical data. The event log is the natural source for this. Attendance patterns, approval timings, payroll variances, leave utilization trends — all are captured as events with full temporal fidelity. Feature engineering becomes a function of the event log, not a join-heavy query against OLTP tables.

### Auditability Benefit
The event log is the audit trail. Every state change in the system is the result of an event. Every event is immutable and sequenced. Any compliance inspector can ask "what was the state of employee X's payroll in March 2025?" and receive a complete, traceable answer derived from the event log — not reconstructed from a change log table that someone might have accidentally cleared.

---

# SECTION 2: EVENT TAXONOMY DESIGN

---

## 2.0 Taxonomy Overview

The platform's events are organized into **nine canonical categories**, each with distinct ownership, durability, retention, and consumer profiles.

```
EVENT CATEGORY TAXONOMY

┌─────────────────────────────────────────────────────────────────┐
│                   WORKFORCE OS EVENT PLATFORM                    │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │  DOMAIN EVENTS  │  │ WORKFLOW EVENTS  │  │ AUDIT EVENTS   │  │
│  │  (operational   │  │ (process state   │  │ (immutable     │  │
│  │   business      │  │  machine        │  │  governance    │  │
│  │   facts)        │  │  transitions)   │  │  ledger)       │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ ANALYTICS       │  │ AI TELEMETRY    │  │ NOTIFICATION   │  │
│  │ EVENTS          │  │ EVENTS          │  │ EVENTS         │  │
│  │ (OLTP→OLAP      │  │ (ML signals,    │  │ (dispatch      │  │
│  │  pipeline)      │  │  features,      │  │  outcomes,     │  │
│  │                 │  │  inference)     │  │  preferences)  │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ SECURITY EVENTS │  │ INTEGRATION     │  │ SYSTEM EVENTS  │  │
│  │ (access, auth,  │  │ EVENTS          │  │ (platform      │  │
│  │  breach signals)│  │ (external sync) │  │  health)       │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2.1 Category 1: Domain Events

**Purpose:** Record the canonical business facts produced by each bounded context. These are the authoritative, immutable records of what happened in the business domain. Domain events are the primary currency of the entire event architecture — all other event categories are derived from or triggered by domain events.

**Ownership:** The bounded context that owns the aggregate that produced the fact. `attendance.daily.processed` is owned exclusively by the Attendance domain. No other domain may emit this event type.

**Key consumers:** Analytics (projection population), Audit (ledger recording), AI Intelligence (feature feeds), Notifications (trigger dispatch), other Operational domains (for coordination).

**Retention strategy:** 7 years (statutory employment record retention). Partitioned storage after 2 years.

**Durability requirement:** Exactly-once delivery semantics via idempotent consumers. At-least-once from outbox relay. Consumer deduplication via `event_id`.

**Ordering requirement:** Per-aggregate ordering guaranteed (same `aggregate_id` events processed in `occurred_at` order). Cross-aggregate: eventual ordering only.

**Examples:** `employee.created`, `attendance.daily.processed`, `payroll.run.disbursed`, `leave.application.approved`

---

## 2.2 Category 2: Workflow Events

**Purpose:** Record process state machine transitions for all approval-requiring operations. These are specialized domain events from the Workflow bounded context that describe movement through multi-step approval chains.

**Ownership:** Workflow & Approvals domain exclusively.

**Key consumers:** Originating business domains (to act on approval outcomes), Notifications (to dispatch actor alerts), Analytics (workflow SLA metrics), Audit (approval chain traceability).

**Retention strategy:** 7 years (same as domain events — approval decisions are legally significant).

**Durability requirement:** Critical — a missed `workflow.instance.completed` event means an approved leave request is never processed. Must be at-least-once with idempotent consumer handling.

**Ordering requirement:** Strict per `instance_id` — stage transitions must be processed in order.

**Examples:** `workflow.instance.created`, `workflow.task.assigned`, `workflow.task.completed`, `workflow.instance.completed`, `workflow.sla.breached`

---

## 2.3 Category 3: Audit Events

**Purpose:** Build the immutable governance ledger. Every state-changing operation in the platform produces an audit event consumed by the Audit & Governance domain. Audit events are terminal — they are consumed by the Audit domain and no other domain subscribes to them.

**Ownership:** Produced by ALL write domains. Consumed exclusively by Audit & Governance domain.

**Key consumers:** Audit & Governance domain (sole consumer).

**Retention strategy:** 10 years minimum (regulatory compliance). Immutable cold storage after 3 years. Cryptographically signed for tamper evidence.

**Durability requirement:** Maximum — no audit events may be lost. Dedicated high-durability queue with infinite retry.

**Ordering requirement:** Per-entity ordering required (all changes to employee X must appear in sequence). Cross-entity: eventual.

**Examples:** `audit.employee.pii_accessed`, `audit.payroll.computed`, `audit.policy.activated`, `audit.user.privileged_action`

---

## 2.4 Category 4: Analytics Events

**Purpose:** Power the analytics projection pipeline. These events carry pre-aggregated or pre-transformed data optimized for the analytics domain's consumption — reducing the computation burden on the analytics consumers vs. consuming raw domain events directly.

**Ownership:** Produced by Analytics domain's internal computation pipeline. Raw domain events → Analytics Event Producer → Analytics Events → Analytics Read Models.

**Key consumers:** Analytics read models, ClickHouse ingestion pipeline, Dashboard query layer, AI feature store.

**Retention strategy:** 5 years (analytics horizon). Columnar compression after 90 days.

**Durability requirement:** Medium — analytics consumers are designed for eventual consistency. A brief gap is acceptable; the system will self-heal from backlog processing.

**Ordering requirement:** Timestamp-based ordering for time-series continuity. Not strict sequential ordering.

**Examples:** `analytics.headcount.snapshot_computed`, `analytics.attendance.daily_summary`, `analytics.payroll.period_cost_aggregated`

---

## 2.5 Category 5: AI Telemetry Events

**Purpose:** Capture behavioral signals, prediction inputs, inference outputs, and model performance telemetry for the AI Intelligence domain. These events are the nervous system of the AI layer — they carry both the inputs that AI models consume and the outputs that AI models produce.

**Ownership:** Produced by operational domains (behavioral signals) and AI Intelligence domain (prediction/inference outputs).

**Key consumers:** AI Intelligence domain (feature engineering), Analytics domain (AI performance metrics), Audit domain (AI decision traceability).

**Retention strategy:** 3 years for training data (model retraining cycles). 1 year for inference telemetry.

**Durability requirement:** Medium for behavioral signals (loss acceptable within bounds). High for AI decision events (regulatory explainability).

**Ordering requirement:** Temporal ordering by employee/entity for behavioral sequences. Prediction events need causal ordering with their input signals.

**Examples:** `ai.feature.attendance_pattern_computed`, `ai.prediction.attrition_risk_generated`, `ai.inference.copilot_response_generated`, `ai.model.drift_detected`

---

## 2.6 Category 6: Notification Events

**Purpose:** Track the lifecycle of user-facing communications. Notification events record what was sent, through what channel, with what content, to whom, and whether delivery succeeded. These enable notification delivery analytics, retry management, and preference compliance auditing.

**Ownership:** Notifications domain.

**Key consumers:** Audit domain (communication record), Analytics (notification effectiveness), Support tooling (delivery troubleshooting).

**Retention strategy:** 2 years (short-lived operational data; longer for compliance-related communications like payslip delivery confirmations).

**Durability requirement:** Medium — notification delivery is important but not business-critical. Retry semantics with cap at 3 attempts.

**Examples:** `notification.email.dispatched`, `notification.sms.delivered`, `notification.push.failed`, `notification.inapp.read`

---

## 2.7 Category 7: Security Events

**Purpose:** Capture all access, authentication, authorization, and anomaly signals for the IAM and Audit domains. Security events are the raw material for threat detection, compliance reporting, and access pattern analysis.

**Ownership:** IAM domain.

**Key consumers:** Audit & Governance domain (security audit trail), AI Intelligence domain (anomaly detection), External SIEM systems (via Integration Platform).

**Retention strategy:** 7 years (regulatory compliance for access logs). Immediate availability for last 90 days; archived thereafter.

**Durability requirement:** Critical — security events must never be lost. Dedicated high-priority queue.

**Ordering requirement:** Strict per-user ordering (authentication sequence must be reconstructable).

**Examples:** `security.user.login_succeeded`, `security.user.login_failed`, `security.session.anomaly_detected`, `security.permission.escalation_requested`, `security.data.pii_exported`

---

## 2.8 Category 8: Integration Events

**Purpose:** Track the lifecycle of data exchange with external systems — ERP integrations, biometric device synchronization, payroll bank interfaces, third-party HRMS migrations. Integration events record what data crossed the platform boundary, in which direction, and with what outcome.

**Ownership:** Integration Platform domain.

**Key consumers:** Audit domain (data lineage), Operational domains (inbound data triggers), Analytics (integration health metrics).

**Retention strategy:** 3 years (integration audit trail for data reconciliation).

**Durability requirement:** High — integration failures must be detectable and retryable.

**Examples:** `integration.biometric.sync_completed`, `integration.erp.payroll_exported`, `integration.webhook.delivered`, `integration.external.employee_imported`

---

## 2.9 Category 9: System Events

**Purpose:** Platform health, deployment, and operational telemetry. System events record outbox lag, queue depths, processing errors, deployment completions, and infrastructure state changes. These are the operational instrumentation layer.

**Ownership:** Platform Infrastructure team.

**Key consumers:** Monitoring/alerting systems, Operations team dashboards, SLA tracking.

**Retention strategy:** 90 days (operational monitoring window).

**Durability requirement:** Low — system events are telemetry. Loss of individual system events is acceptable; aggregate metrics are what matter.

**Examples:** `system.outbox.lag_alert`, `system.queue.depth_threshold_exceeded`, `system.deployment.completed`, `system.healthcheck.failed`

---

## 2.10 Taxonomy Summary Matrix

```
CATEGORY          │ OWNER              │ CONSUMERS           │ RETENTION │ DURABILITY
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Domain Events     │ Each bounded ctx   │ Analytics, Audit,   │ 7 years   │ HIGH
                  │                    │ AI, Notifications,  │           │
                  │                    │ Other domains       │           │
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Workflow Events   │ Workflow domain    │ Business domains,   │ 7 years   │ CRITICAL
                  │                    │ Notifications, Audit│           │
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Audit Events      │ All write domains  │ Audit domain only   │ 10 years  │ CRITICAL
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Analytics Events  │ Analytics domain   │ Read models, BI,    │ 5 years   │ MEDIUM
                  │                    │ AI feature store    │           │
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
AI Telemetry      │ Ops domains + AI   │ AI domain, Audit    │ 3 years   │ MEDIUM-HIGH
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Notification Evts │ Notifications      │ Audit, Analytics    │ 2 years   │ MEDIUM
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Security Events   │ IAM domain         │ Audit, AI, SIEM     │ 7 years   │ CRITICAL
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
Integration Evts  │ Integration domain │ Audit, Ops domains  │ 3 years   │ HIGH
──────────────────┼────────────────────┼─────────────────────┼───────────┼───────────
System Events     │ Platform infra     │ Monitoring, SRE     │ 90 days   │ LOW
```

---

# SECTION 3: DOMAIN EVENT REGISTRY

---

> For each event, all 13 dimensions (A–M) are defined. Critical-path events receive full schema specification. Supporting events receive abbreviated treatment.

---

## EVENT GROUP 1: EMPLOYEE LIFECYCLE EVENTS

---

### EVT-EMP-001: `employee.created`

#### A. Event Purpose
Records the instantiation of a new employment relationship. This is the most downstream-impactful event in the platform — its publication triggers initialization actions in at least six other bounded contexts simultaneously. Every subsequent employee-related event in the platform is causally descended from this one.

#### B. Domain Owner
**Employee Domain** — sole authorized emitter.

#### C. Trigger Source
- Recruitment domain publishes `recruitment.offer.accepted` → Employee domain handler creates the Employee aggregate and emits `employee.created`
- Direct HR data entry (manual onboarding without Recruitment module) → HR admin creates employee via Employee domain API

#### D. Payload Schema
```json
{
  "event_id":       "evt_01JK4X2N8P7QR3STUVWXYZ12AB",
  "event_type":     "employee.created",
  "event_version":  1,
  "schema_version": 1,
  "occurred_at":    "2026-05-09T09:00:00.000Z",
  "tenant_id":      "ten_ACME_GLOBAL_001",
  "aggregate_type": "Employee",
  "aggregate_id":   "emp_7f3a9b2c-1234-5678-abcd-ef0123456789",
  "correlation_id": "corr_onboarding_batch_20260509_001",
  "causation_id":   "evt_recruitment_offer_accepted_XYZ",
  "emitted_by":     "employee-domain",
  "actor": {
    "actor_id":     "usr_hr_admin_001",
    "actor_type":   "human",
    "actor_role":   "hr_admin"
  },
  "payload": {
    "employee_id":          "emp_7f3a9b2c-1234-5678-abcd-ef0123456789",
    "employee_number":      "EMP-2026-00847",
    "employment_type":      "full_time",
    "employment_status":    "probation",
    "joining_date":         "2026-06-01",
    "probation_end_date":   "2026-08-31",
    "unit_id":              "unit_engineering_backend",
    "location_id":          "loc_singapore_hq",
    "entity_id":            "entity_acme_sg",
    "cost_center_id":       "cc_engineering_001",
    "manager_id":           "emp_manager_456",
    "job_title_code":       "SWE_SENIOR",
    "grade_code":           "L4",
    "jurisdiction": {
      "country_code": "SG",
      "state_code":   null
    },
    "work_arrangement":     "hybrid",
    "onboarding_initiated": true
  },
  "metadata": {
    "source_system":        "employee-domain",
    "idempotency_key":      "emp_create_EMP-2026-00847",
    "pii_classification":   "internal",
    "data_residency":       "SG"
  }
}
```

#### E. Event Authority Rules
- Only `employee-domain` service may emit this event type
- `employee_id` must be globally unique within the tenant
- `employee_number` must be unique and follow tenant's numbering sequence
- Payload must NOT contain PII fields (name, DOB, national ID) — those remain in Employee domain's internal store, protected by ABAC. Downstream consumers receive only the structural and organizational references needed to initialize their own domain records.

#### F. Consumers
| Consumer | Action | Criticality |
|---|---|---|
| IAM Domain | Trigger user account provisioning workflow | HIGH |
| Leave Management | Initialize LeaveBalance records for all applicable leave types | HIGH |
| Attendance Domain | Create AttendanceCycle for current period | HIGH |
| Compensation & Benefits | Initialize pay structure enrollment | HIGH |
| Organization Domain | Create ReportingRelationship record | HIGH |
| Payroll Domain | Register employee for next payroll run | HIGH |
| Analytics Domain | Update headcount projection, dim_employee | MEDIUM |
| Documents Domain | Trigger appointment letter generation | MEDIUM |
| Notifications Domain | Send onboarding welcome communication | MEDIUM |
| Audit Domain | Record employee creation audit entry | CRITICAL |

#### G. Sync vs Async Handling
- **Sync:** Employee aggregate creation and initial persistence (within same DB transaction as outbox INSERT)
- **Async:** All 10 consumers above — none block the API response to the HR admin creating the employee

#### H. Retry Expectations
- Outbox relay: up to 10 retries with exponential backoff (2s, 4s, 8s... cap 5 minutes)
- Consumer handlers: up to 5 retries per consumer independently
- DLQ after retry exhaustion: `employee.created.dlq` — manual investigation required
- **Critical:** If Leave Balance initialization fails after all retries, an alert is raised to HR admin immediately. Employee exists but leave module requires manual initialization.

#### I. Ordering Guarantees
- Guaranteed to be the first employee event for this `aggregate_id`
- Subsequent events (`employee.transferred`, `employee.promoted`) will only be processed after `employee.created` is confirmed received by critical consumers
- Ordering enforced by: outbox insertion timestamp + sequential `aggregate_sequence` counter

#### J. Idempotency Rules
- Consumers must deduplicate by `event_id`
- Idempotency key in metadata: `emp_create_{employee_number}` — prevents duplicate creation if outbox relay delivers twice
- Leave domain: on duplicate `employee.created`, verify balance records exist and skip if they do — no error

#### K. Multi-Tenant Isolation
- `tenant_id` is mandatory and validated at outbox relay
- Consumer handlers always scope their write operations with `tenant_id` filter
- Cross-tenant event delivery is architecturally impossible: outbox relay routes only to `tenant_id`-scoped consumers

#### L. Analytics Importance
**HIGH** — This event triggers headcount +1 in all relevant analytics dimensions (unit, location, entity, grade, employment_type). Real-time headcount dashboards depend on receiving this event within 60 seconds of emission.

#### M. AI/ML Importance
**HIGH** — Employee creation initializes the feature vector for attrition risk modeling. The joining date, grade, unit, employment type, and manager assignment are all founding features. Without this event, the AI domain has no record of the employee's existence.

---

### EVT-EMP-002: `employee.transferred`

#### A. Event Purpose
Records an inter-organizational transfer — when an employee moves from one department, entity, or location to another. Downstream consumers must update their records to reflect the new organizational context effective from `effective_date`.

#### B. Domain Owner
**Employee Domain**

#### C. Trigger Source
HR admin submits transfer request → Workflow domain routes for approval → `workflow.instance.completed (entity_type: transfer_request, outcome: approved)` → Employee domain handler processes transfer → emits `employee.transferred`

#### D. Payload Schema
```json
{
  "event_type":  "employee.transferred",
  "occurred_at": "2026-05-09T11:30:00.000Z",
  "payload": {
    "employee_id":          "emp_7f3a9b2c-...",
    "effective_date":       "2026-06-01",
    "transfer_type":        "inter_department",
    "previous": {
      "unit_id":            "unit_engineering_backend",
      "location_id":        "loc_singapore_hq",
      "entity_id":          "entity_acme_sg",
      "cost_center_id":     "cc_engineering_001",
      "manager_id":         "emp_manager_456",
      "grade_code":         "L4"
    },
    "new": {
      "unit_id":            "unit_product_engineering",
      "location_id":        "loc_singapore_hq",
      "entity_id":          "entity_acme_sg",
      "cost_center_id":     "cc_product_001",
      "manager_id":         "emp_manager_789",
      "grade_code":         "L4"
    },
    "reason_code":          "internal_mobility",
    "transfer_request_id":  "req_transfer_20260509_001"
  }
}
```

#### E–M. Summary
- **Consumers:** Organization (update reporting relationship), Payroll (update cost center allocation), Analytics (update dim_employee SCD Type 2 record), AI (update employee feature vector — new unit, new manager are attrition signals), Audit
- **Ordering:** Must be processed after `employee.created`. Payroll must see the transfer before the next payroll run for the effective month.
- **Analytics:** HIGH — Transfer events are a key attrition risk signal (frequent transfers correlate with disengagement)
- **AI:** HIGH — Manager change is one of the top 5 attrition risk features

---

### EVT-EMP-003: `employee.exited`

#### A. Event Purpose
Records the confirmed exit of an employee from the organization. This event triggers the most extensive downstream cascade in the platform — deprovisioning, FNF payroll, asset return, leave encashment, document generation, and account closure.

#### D. Payload Schema (abbreviated)
```json
{
  "event_type": "employee.exited",
  "payload": {
    "employee_id":           "emp_7f3a9b2c-...",
    "exit_date":             "2026-06-30",
    "last_working_date":     "2026-06-30",
    "exit_type":             "resignation",
    "notice_period_served":  true,
    "notice_start_date":     "2026-06-01",
    "fnf_payroll_required":  true,
    "asset_return_required": true,
    "leave_encashment_days": 8.5,
    "exit_interview_done":   true
  }
}
```

#### F. Consumers (Critical cascade)
| Consumer | Action |
|---|---|
| IAM Domain | Deprovision user account (schedule deactivation at exit_date + 1 day) |
| Payroll Domain | Trigger FNF (Full & Final) payroll run |
| Leave Domain | Process leave encashment for eligible balance |
| Asset Management | Trigger asset return clearance workflow |
| Documents Domain | Generate experience certificate, relieving letter |
| Analytics Domain | Update headcount projection (headcount -1 at exit_date) |
| AI Domain | Record exit event — labels attrition prediction records with actual outcome |

#### M. AI Importance
**CRITICAL** — Employee exit events are the **ground truth labels** for attrition prediction model training. Every exit event with `exit_type = resignation` that was preceded by a high attrition risk prediction validates the model. Every exit that was not predicted identifies a false negative. Without this event, the attrition model cannot be evaluated or retrained.

---

## EVENT GROUP 2: ATTENDANCE EVENTS

---

### EVT-ATT-001: `attendance.punched`

#### A. Event Purpose
Records the raw, unprocessed attendance capture event from any source (biometric device, mobile GPS, manual entry, API integration). This is the highest-volume event in the platform — potentially millions per day at enterprise scale. It is the raw input to the attendance processing pipeline.

**Critical distinction:** `attendance.punched` is the RAW event. `attendance.daily.processed` is the PROCESSED outcome. Do not conflate them. The raw punch event is immutable evidence; the processed record is derived computation.

#### B. Domain Owner
**Attendance Domain**

#### C. Trigger Source
- Biometric device sends hardware signal → Device Integration Layer → Attendance Domain punch ingestion API
- Employee uses mobile app → Mobile GPS validates geofence → Attendance Domain mobile API
- HR admin submits manual punch → Attendance Domain admin API
- Third-party time clock → Integration Platform → Attendance Domain integration API

#### D. Payload Schema
```json
{
  "event_type":     "attendance.punched",
  "event_version":  2,
  "occurred_at":    "2026-05-09T09:02:37.441Z",
  "aggregate_type": "RawPunchEvent",
  "aggregate_id":   "punch_01JK5X2N8P7QR3STUVWXAB34",
  "payload": {
    "punch_id":           "punch_01JK5X2N8P7QR3STUVWXAB34",
    "employee_id":        "emp_7f3a9b2c-...",
    "raw_timestamp":      "2026-05-09T09:02:37.441Z",
    "punch_type":         "in",
    "source": {
      "source_type":      "biometric",
      "device_id":        "dev_bio_singapore_main_gate_01",
      "device_type":      "fingerprint_reader",
      "device_location_id": "loc_singapore_hq"
    },
    "geo_location":       null,
    "mobile_metadata":    null,
    "validation_status":  "valid",
    "duplicate_of":       null
  }
}
```

**Mobile punch variant:**
```json
{
  "payload": {
    "punch_id":     "punch_01JK5X2N8MOBILE001",
    "employee_id":  "emp_7f3a9b2c-...",
    "punch_type":   "in",
    "source": {
      "source_type":  "mobile_gps",
      "device_id":    "device_uuid_phone_hash",
      "app_version":  "3.4.1"
    },
    "geo_location": {
      "latitude":    1.3521,
      "longitude":   103.8198,
      "accuracy_meters": 8.3,
      "geofence_id":    "fence_singapore_hq",
      "within_geofence": true
    },
    "mobile_metadata": {
      "os":           "iOS",
      "os_version":   "17.4",
      "is_mock_location": false,
      "battery_level": 82
    },
    "validation_status": "valid"
  }
}
```

#### E. Event Authority Rules
- Only Attendance Domain's ingestion service emits this event
- `punch_id` must be unique across the tenant (UUID v7 — time-ordered for efficient indexing)
- Raw timestamp from device is preserved exactly — do not adjust for server clock drift at this stage (adjustment happens in processing)
- `validation_status` can be `valid`, `duplicate`, `suspicious_location`, `outside_geofence` — all are recorded; only `valid` punches are processed

#### F. Consumers
| Consumer | Action | Criticality |
|---|---|---|
| Attendance Processing Pipeline | Deduplication, shift matching, daily computation trigger | CRITICAL |
| Real-Time Dashboard | Live punch-in count update (sub-5-second latency) | HIGH |
| AI Domain | Real-time behavioral signal feed | MEDIUM |
| Audit Domain | Immutable punch record | HIGH |
| Mobile Sync | Confirm punch receipt to mobile client | HIGH |

#### G. Sync vs Async
- **Sync:** Punch acknowledgment to device/mobile (must return within 2 seconds — device shows "registered")
- **Async:** Processing pipeline trigger, dashboard update, AI feed, audit recording

#### H. Retry Expectations
- Outbox relay: 15 retries with backoff (high volume — fast failures tolerated at individual punch level)
- Processing consumer: 5 retries; DLQ on exhaustion
- DLQ: `attendance.punched.processing.dlq` — requires manual investigation if punch lost (legal implication)

#### I. Ordering Guarantees
- Per-employee ordering guaranteed for processing (same employee's punches processed in chronological order)
- Partitioning key: `employee_id` ensures all punches for an employee go to the same consumer instance
- Cross-employee: no ordering guarantee needed (each employee's punches are independent)

#### J. Idempotency Rules
- `punch_id` is the idempotency key — same `punch_id` delivered twice is a no-op at consumer
- Device retransmit (device did not receive ACK) produces same `punch_id` — consumer deduplication prevents duplicate processing
- Processing pipeline maintains processed_punch_ids table with TTL 48 hours

#### K. Multi-Tenant Isolation
- `tenant_id` scoped at ingestion — device must be registered to a tenant before punches are accepted
- Processing workers tenant-isolated: large tenants get dedicated worker pools to prevent noisy-neighbor

#### L. Analytics Importance
**VERY HIGH** — Raw punch events feed the real-time workforce presence dashboard. The count of employees who have punched in today is a live operational metric needed by floor managers, operations managers, and facility teams.

#### M. AI/ML Importance
**HIGH** — Punch timing patterns (consistent early arrivals, erratic timing, frequent late punches) are behavioral signals for:
- Attrition risk modeling (disengagement proxy)
- Absence prediction (historical Monday absences predict future Monday absences)
- Anomaly detection (punch from unusual location, unusual time)

---

### EVT-ATT-002: `attendance.daily.processed`

#### A. Event Purpose
Records the completion of the daily attendance computation for one employee on one date. This is the **highest-value downstream event** from the Attendance domain — all payroll inputs, analytics projections, and AI features are built from this event, not from raw punch events.

#### D. Payload Schema
```json
{
  "event_type":     "attendance.daily.processed",
  "event_version":  1,
  "occurred_at":    "2026-05-09T23:45:00.000Z",
  "aggregate_type": "DailyAttendance",
  "aggregate_id":   "daily_att_20260509_emp_7f3a9b2c",
  "payload": {
    "daily_attendance_id":      "daily_att_20260509_emp_7f3a9b2c",
    "employee_id":              "emp_7f3a9b2c-...",
    "attendance_date":          "2026-05-09",
    "shift_id":                 "shift_day_standard_8h",
    "shift_expected_start":     "09:00",
    "shift_expected_end":       "18:00",
    "first_in":                 "2026-05-09T09:02:37Z",
    "last_out":                 "2026-05-09T18:15:22Z",
    "punch_count":              2,
    "effective_hours":          8.50,
    "break_deducted_minutes":   60,
    "overtime_hours":           0.25,
    "attendance_status":        "present",
    "shift_compliance_status":  "on_time",
    "is_late":                  false,
    "late_minutes":             0,
    "is_early_departure":       false,
    "early_departure_minutes":  0,
    "source_types_used":        ["biometric"],
    "leave_linked_id":          null,
    "is_regularized":           false,
    "computation_basis": {
      "policy_code":            "ATT_OVERTIME_RULES",
      "policy_version":         "2.1",
      "ot_threshold_hours":     8.0,
      "grace_late_minutes":     10,
      "break_deduction_rule":   "fixed_60_min"
    }
  }
}
```

#### F. Consumers
| Consumer | Action |
|---|---|
| Analytics Domain | Populate `fact_daily_attendance` projection |
| Payroll Domain | Feed into payroll-period projection (accumulated for cycle) |
| AI Domain | Feed absence prediction and OT anomaly models |
| Leave Domain | Check: if status = absent AND no leave_linked → trigger absence alert |
| Notifications | If absent: notify manager (async, configurable threshold) |
| Audit Domain | Record daily attendance fact |

#### I. Ordering Guarantees
**CRITICAL:** Events for the same employee must be processed in date order. An out-of-order `attendance.daily.processed` event (May 8 arriving after May 9) would corrupt period summary computations.
- Enforced by: `occurred_at` ordering within employee partition + consumer sequence validation

#### L. Analytics Importance
**CRITICAL** — This is the primary fact event for workforce analytics. Every attendance KPI (absenteeism rate, OT rate, late arrival rate, effective hours) is computed from this event. Real-time dashboard freshness depends on processing latency of this event: target < 2 minutes from computation trigger to Analytics projection update.

#### M. AI/ML Importance
**CRITICAL** — This event is the highest-signal input for:
- Absence prediction model (pattern: employee X absent on Mondays, 3 of last 5)
- Attrition risk model (attendance degradation is a top-5 predictor)
- OT anomaly detection (unexpected OT spike needs investigation)

---

### EVT-ATT-003: `attendance.cycle.finalized`

#### A. Event Purpose
Records the locking of an attendance period (month) for a specific employee — meaning no further corrections or changes are permitted and the finalized data is ready for payroll consumption. This is a gate event: Payroll cannot include this employee in the monthly run until their cycle is finalized.

#### D. Payload Schema
```json
{
  "event_type": "attendance.cycle.finalized",
  "payload": {
    "cycle_id":           "cycle_202605_emp_7f3a9b2c",
    "employee_id":        "emp_7f3a9b2c-...",
    "period": {
      "year":   2026,
      "month":  5,
      "start":  "2026-05-01",
      "end":    "2026-05-31"
    },
    "summary": {
      "working_days_in_period": 22,
      "present_days":           20,
      "absent_days":            1,
      "leave_days":             1,
      "lop_days":               1,
      "total_effective_hours":  170.5,
      "total_overtime_hours":   6.25,
      "late_instances":         2,
      "holidays":               0
    },
    "finalized_at":       "2026-06-02T00:00:00Z",
    "finalized_by":       "system_payroll_cutoff_job",
    "payroll_ready":      true
  }
}
```

#### F–M. Summary
- **Consumers:** Payroll Domain (gates payroll run — employee not included until this event received), Analytics Domain (period-level attendance aggregation)
- **Ordering:** CRITICAL — Payroll consumer must receive this before including employee in run
- **Analytics:** HIGH — Period-level summary fact population
- **AI:** MEDIUM — Period summaries feed ML training dataset refresh

---

### EVT-ATT-004: `attendance.regularization.submitted` / `.approved` / `.rejected`

Brief schema:
```json
{
  "event_type": "attendance.regularization.submitted",
  "payload": {
    "request_id":        "reg_req_20260509_001",
    "employee_id":       "emp_7f3a9b2c-...",
    "attendance_date":   "2026-05-07",
    "claimed_in":        "2026-05-07T09:00:00Z",
    "claimed_out":       "2026-05-07T18:00:00Z",
    "reason_code":       "forgot_punch_out",
    "reason_text":       "Was in external client meeting, forgot to punch out",
    "workflow_instance_id": "wf_inst_20260509_reg_001"
  }
}
```

---

## EVENT GROUP 3: LEAVE MANAGEMENT EVENTS

---

### EVT-LEAVE-001: `leave.application.submitted`

#### D. Payload Schema
```json
{
  "event_type":    "leave.application.submitted",
  "event_version": 1,
  "payload": {
    "application_id":    "leave_app_20260509_0042",
    "employee_id":       "emp_7f3a9b2c-...",
    "leave_type_id":     "lt_annual_leave",
    "leave_type_code":   "AL",
    "start_date":        "2026-05-20",
    "end_date":          "2026-05-22",
    "duration": {
      "value": 3.0,
      "unit":  "days"
    },
    "day_details": [
      {"date": "2026-05-20", "type": "full"},
      {"date": "2026-05-21", "type": "full"},
      {"date": "2026-05-22", "type": "full"}
    ],
    "reason_code":             "personal",
    "current_balance_before":  15.0,
    "pending_reserved":        3.0,
    "current_balance_after_reservation": 12.0,
    "requires_document":       false,
    "workflow_instance_id":    "wf_inst_leave_20260509_042"
  }
}
```

### EVT-LEAVE-002: `leave.application.approved`

#### D. Payload Schema
```json
{
  "event_type":    "leave.application.approved",
  "event_version": 1,
  "payload": {
    "application_id":     "leave_app_20260509_0042",
    "employee_id":        "emp_7f3a9b2c-...",
    "leave_type_id":      "lt_annual_leave",
    "leave_type_code":    "AL",
    "start_date":         "2026-05-20",
    "end_date":           "2026-05-22",
    "approved_days":      3.0,
    "approved_by":        "emp_manager_789",
    "approved_at":        "2026-05-09T14:22:00Z",
    "balance_after":      12.0,
    "payroll_impact": {
      "lop_days":         0,
      "encashment_days":  0
    }
  }
}
```

#### F. Consumers
| Consumer | Action |
|---|---|
| Attendance Domain | Link approved leave to absent days for leave period — update DailyAttendance.leave_linked |
| Payroll Domain | Add to leave ledger (no LOP deduction for approved leave) |
| Analytics Domain | Update leave utilization projection |
| AI Domain | Feed leave pattern model (who takes leave when — behavioral signal) |
| Notifications Domain | Send approval confirmation to employee |
| Audit Domain | Record approval decision |

### EVT-LEAVE-003: `leave.balance.updated`

```json
{
  "event_type": "leave.balance.updated",
  "payload": {
    "balance_id":         "bal_emp_7f3a9b2c_AL_2026",
    "employee_id":        "emp_7f3a9b2c-...",
    "leave_type_id":      "lt_annual_leave",
    "leave_type_code":    "AL",
    "policy_year":        2026,
    "transaction_type":   "availed",
    "transaction_quantity": -3.0,
    "balance_before":     15.0,
    "balance_after":      12.0,
    "reference_id":       "leave_app_20260509_0042",
    "reference_type":     "leave_application"
  }
}
```

### EVT-LEAVE-004: `leave.period.closed`

```json
{
  "event_type": "leave.period.closed",
  "payload": {
    "tenant_id":              "ten_ACME_GLOBAL_001",
    "policy_year":            2025,
    "processing_date":        "2026-01-01",
    "employees_processed":    1247,
    "total_carry_forward_days": 3841.5,
    "total_lapsed_days":      892.0,
    "carry_forward_policy_applied": "max_15_days_per_employee"
  }
}
```

---

## EVENT GROUP 4: PAYROLL EVENTS

---

### EVT-PAY-001: `payroll.run.initiated`

```json
{
  "event_type": "payroll.run.initiated",
  "payload": {
    "run_id":           "pr_run_202605_regular_001",
    "period": {
      "year":   2026,
      "month":  5,
      "type":   "regular"
    },
    "run_type":         "regular",
    "initiated_by":     "usr_payroll_admin_001",
    "employee_count":   1247,
    "scope":            "all_active_employees",
    "cutoff_date":      "2026-05-31",
    "expected_compute_start": "2026-06-01T02:00:00Z"
  }
}
```

### EVT-PAY-002: `payroll.run.computed`

```json
{
  "event_type": "payroll.run.computed",
  "payload": {
    "run_id":              "pr_run_202605_regular_001",
    "period":              {"year": 2026, "month": 5},
    "computed_at":         "2026-06-01T04:23:00Z",
    "duration_minutes":    143,
    "employee_count":      1247,
    "totals": {
      "gross_pay":         {"amount": "12483750.00", "currency": "SGD"},
      "total_deductions":  {"amount": "2184281.25", "currency": "SGD"},
      "net_pay":           {"amount": "10299468.75", "currency": "SGD"},
      "employer_contributions": {"amount": "1997400.00", "currency": "SGD"}
    },
    "quality": {
      "anomaly_flags_count":     3,
      "critical_anomalies":      0,
      "warning_anomalies":       3,
      "requires_manual_review":  false
    },
    "status": "computed_pending_review"
  }
}
```

### EVT-PAY-003: `payroll.run.disbursed`

#### A. Event Purpose
Records the confirmed disbursement of payroll — the most consequential financial event in the platform. Payment files have been sent to the bank, or payment instructions confirmed. This event triggers downstream statutory reporting, analytics cost updates, and employee payslip notifications.

#### D. Payload Schema
```json
{
  "event_type":     "payroll.run.disbursed",
  "event_version":  1,
  "occurred_at":    "2026-06-02T15:00:00.000Z",
  "aggregate_type": "PayrollRun",
  "aggregate_id":   "pr_run_202605_regular_001",
  "payload": {
    "run_id":               "pr_run_202605_regular_001",
    "period":               {"year": 2026, "month": 5, "type": "regular"},
    "disbursement_date":    "2026-06-02",
    "disbursed_by":         "usr_payroll_admin_001",
    "approved_by":          "usr_payroll_manager_001",
    "employee_count":       1247,
    "bank_file_reference":  "NEFT_20260602_PR_001",
    "totals": {
      "gross_pay":          {"amount": "12483750.00", "currency": "SGD"},
      "total_deductions":   {"amount": "2184281.25", "currency": "SGD"},
      "net_pay_disbursed":  {"amount": "10299468.75", "currency": "SGD"}
    },
    "statutory_liabilities": [
      {"type": "CPF_EMPLOYEE", "amount": "1248375.00", "currency": "SGD"},
      {"type": "CPF_EMPLOYER", "amount": "1997400.00", "currency": "SGD"},
      {"type": "INCOME_TAX_WITHHOLDING", "amount": "935906.25", "currency": "SGD"}
    ],
    "payslips_count":       1247,
    "payslips_generated":   true
  }
}
```

#### F. Consumers
| Consumer | Action | Criticality |
|---|---|---|
| Analytics Domain | Update fact_payroll_period; compute payroll cost KPIs | HIGH |
| Compliance Domain | Record statutory liabilities for return filing | HIGH |
| Documents Domain | Generate and store all payslip PDFs | HIGH |
| Notifications Domain | Notify all 1,247 employees "payslip available" | MEDIUM |
| Finance Integration | Export general ledger entries to ERP | HIGH |
| Audit Domain | Record disbursement event with full financial summary | CRITICAL |
| AI Domain | Feed payroll cost forecasting model; anomaly baseline update | MEDIUM |

#### M. AI Importance
**HIGH** — Payroll disbursement event updates the rolling average baseline used by the anomaly detection model. Each disbursed run establishes the "expected" for the next run's comparison. Additionally, actual vs. predicted payroll cost feeds the workforce planning forecast accuracy measurement.

---

### EVT-PAY-004: `payroll.anomaly.detected`

```json
{
  "event_type": "payroll.anomaly.detected",
  "payload": {
    "run_id":           "pr_run_202605_regular_001",
    "payslip_id":       "payslip_emp_7f3a9b2c_202605",
    "employee_id":      "emp_7f3a9b2c-...",
    "anomaly_type":     "gross_pay_spike",
    "severity":         "warning",
    "detection_method": "statistical",
    "details": {
      "current_gross":        {"amount": "8500.00", "currency": "SGD"},
      "previous_3mo_average": {"amount": "5200.00", "currency": "SGD"},
      "deviation_percent":    63.5,
      "z_score":              3.2,
      "threshold_z_score":    2.5
    },
    "requires_manual_review": true,
    "auto_resolution_possible": false
  }
}
```

---

## EVENT GROUP 5: WORKFLOW EVENTS

---

### EVT-WF-001: `workflow.instance.completed`

#### A. Event Purpose
The most critical workflow event. All business domains that submit entities for approval depend on this event to learn the outcome and take the appropriate business action. This event is the "close the loop" signal for every approval-requiring operation on the platform.

#### D. Payload Schema
```json
{
  "event_type":    "workflow.instance.completed",
  "event_version": 1,
  "payload": {
    "instance_id":     "wf_inst_leave_20260509_042",
    "template_code":   "LEAVE_APPROVAL_STANDARD",
    "entity_type":     "leave_application",
    "entity_id":       "leave_app_20260509_0042",
    "outcome":         "approved",
    "final_actor_id":  "emp_manager_789",
    "final_actor_role": "line_manager",
    "completed_at":    "2026-05-09T14:22:00Z",
    "stages_detail": [
      {
        "stage_index": 1,
        "stage_name":  "line_manager_approval",
        "actor_id":    "emp_manager_789",
        "action":      "approved",
        "actioned_at": "2026-05-09T14:22:00Z",
        "duration_hours": 3.2
      }
    ],
    "total_duration_hours": 3.2,
    "sla_met":         true,
    "comments":        "Approved. Team coverage confirmed."
  }
}
```

#### E. Event Authority Rules
The `entity_type` field determines which domain is the **authoritative consumer** for this event. The Workflow domain emits the event; the originating domain (Leave Management, in this case) consumes it and executes the business outcome. Workflow does not know what "approved" means for a leave application — that is the Leave domain's responsibility.

#### H. Retry Expectations
**CRITICAL** — A missed `workflow.instance.completed` event means an approved leave application is never processed. Maximum durability required. 20 retries with backoff; DLQ trigger requires immediate alert to engineering. Manual replay capability mandatory.

---

### EVT-WF-002: `workflow.sla.breached`

```json
{
  "event_type": "workflow.sla.breached",
  "payload": {
    "instance_id":    "wf_inst_leave_20260509_043",
    "task_id":        "task_stage1_001",
    "entity_type":    "leave_application",
    "entity_id":      "leave_app_20260509_0043",
    "assigned_to":    "emp_manager_456",
    "sla_hours":      24,
    "elapsed_hours":  25.5,
    "escalated_to":   "emp_manager_456_manager",
    "auto_approved":  false
  }
}
```

---

## EVENT GROUP 6: POLICY ENGINE EVENTS

---

### EVT-POL-001: `policy.activated`

#### A. Event Purpose
Records the activation of a new policy version. This event is special — it is the **cache invalidation broadcast** for all operational domains. Every domain that caches policy resolution results must flush its cache for the affected scope when this event is received.

#### D. Payload Schema
```json
{
  "event_type":    "policy.activated",
  "event_version": 1,
  "payload": {
    "policy_id":         "pol_att_ot_rules_v2_1",
    "policy_code":       "ATT_OVERTIME_RULES",
    "policy_domain":     "attendance",
    "version": {
      "major": 2,
      "minor": 1
    },
    "effective_from":    "2026-06-01",
    "scope": {
      "scope_type":      "tenant",
      "scope_id":        "ten_ACME_GLOBAL_001"
    },
    "supersedes_policy_id": "pol_att_ot_rules_v2_0",
    "key_changes": [
      "daily_ot_threshold_hours: 8.0 → 8.5",
      "grace_period_late_minutes: 10 → 15"
    ],
    "simulation_id":     "sim_20260501_ot_impact",
    "activated_by":      "usr_hr_director_001",
    "approved_by":       "usr_compliance_officer_001"
  }
}
```

#### F. Consumers (all operational domains that cache policy results)
- Attendance Domain → flush cache keys matching `ATT_OVERTIME_RULES:{tenant_id}:*`
- Leave Domain → flush if leave policy scope
- Payroll Domain → flush if payroll policy scope
- Analytics Domain → record policy change event for historical context on KPI charts

#### I. Ordering Guarantee
**CRITICAL** — This event must be processed by all domains BEFORE the `effective_from` date arrives. Publish this event minimum 24 hours before effective date (even if activated the day before). Consumers that receive this event after the effective date must immediately recompute any cached policy results.

---

## EVENT GROUP 7: IAM + SECURITY EVENTS

---

### EVT-SEC-001: `security.user.login_succeeded`

```json
{
  "event_type":    "security.user.login_succeeded",
  "event_version": 1,
  "payload": {
    "user_id":         "usr_7f3a9b2c-...",
    "session_id":      "sess_01JK5X2N8P7QR3",
    "auth_method":     "password_mfa",
    "ip_address":      "HASHED_IP_v2_abc123",
    "user_agent_hash": "ua_hash_xyz789",
    "device_id":       "dev_fingerprint_hash",
    "geo_region":      "SG",
    "is_new_device":   false,
    "is_new_location": false,
    "mfa_method":      "totp"
  }
}
```

### EVT-SEC-002: `security.session.anomaly_detected`

```json
{
  "event_type": "security.session.anomaly_detected",
  "payload": {
    "user_id":          "usr_7f3a9b2c-...",
    "session_id":       "sess_01JK5X2N8P7QR3",
    "anomaly_type":     "impossible_travel",
    "details": {
      "previous_location": "SG",
      "current_location":  "US",
      "time_between_auths_minutes": 42,
      "minimum_travel_time_minutes": 960
    },
    "action_taken":     "session_revoked",
    "risk_score":       0.97
  }
}
```

---

## EVENT GROUP 8: ROSTER + SHIFT EVENTS

---

### EVT-ROST-001: `roster.published`

```json
{
  "event_type": "roster.published",
  "payload": {
    "roster_id":       "rost_unit_ops_202606_001",
    "unit_id":         "unit_operations_floor_1",
    "period": {
      "start_date":    "2026-06-01",
      "end_date":      "2026-06-30"
    },
    "published_by":    "usr_shift_manager_001",
    "published_at":    "2026-05-20T10:00:00Z",
    "employee_count":  45,
    "shift_assignments_count": 1350,
    "constraint_violations": 0,
    "acknowledgment_required": true,
    "acknowledgment_deadline": "2026-05-25T23:59:59Z"
  }
}
```

**Consumers:** Attendance Domain (shift assignment reference for processing), Notifications (notify assigned employees), Analytics (roster coverage metrics), AI Domain (roster features for absence prediction)

### EVT-SHIFT-001: `shift.defined` / `shift.updated`

```json
{
  "event_type": "shift.updated",
  "payload": {
    "shift_id":           "shift_night_b_9h",
    "shift_code":         "NIGHT_B",
    "shift_name":         "Night Shift B",
    "timing": {
      "start_time":       "22:00",
      "end_time":         "07:00",
      "crosses_midnight": true,
      "scheduled_hours":  9.0
    },
    "breaks": [
      {"start": "02:00", "duration_minutes": 30, "is_paid": false}
    ],
    "ot_threshold_hours": 9.0,
    "differential_eligible": true,
    "policy_linkages": {
      "attendance_policy": "ATT_NIGHT_SHIFT_RULES",
      "payroll_policy":    "PAY_NIGHT_DIFFERENTIAL"
    },
    "effective_from":     "2026-06-01"
  }
}
```

---

## EVENT GROUP 9: ORGANIZATION EVENTS

---

### EVT-ORG-001: `org.reporting.changed`

```json
{
  "event_type": "org.reporting.changed",
  "payload": {
    "employee_id":     "emp_7f3a9b2c-...",
    "relationship_type": "direct",
    "previous": {
      "manager_id":    "emp_manager_456",
      "effective_from": "2024-01-01"
    },
    "new": {
      "manager_id":    "emp_manager_789",
      "effective_from": "2026-06-01"
    },
    "reason":          "org_restructure",
    "restructure_ref": "reorg_20260509_001"
  }
}
```

**AI Importance:** CRITICAL — Manager change is one of the highest-weight features in attrition risk models. Third manager change within 18 months is a strong predictor of exit.

---

## EVENT GROUP 10: AI TELEMETRY EVENTS

---

### EVT-AI-001: `ai.prediction.attrition_risk.generated`

```json
{
  "event_type":    "ai.prediction.attrition_risk.generated",
  "event_version": 1,
  "payload": {
    "prediction_id":      "pred_att_risk_20260509_emp_7f3a9b2c",
    "employee_id":        "emp_7f3a9b2c-...",
    "model_id":           "model_attrition_v3_2",
    "model_version":      "3.2.1",
    "prediction_horizon": 90,
    "risk_score":         0.823,
    "risk_tier":          "high",
    "confidence":         0.89,
    "top_risk_factors": [
      {"feature": "months_since_last_increment",  "weight": 0.31, "value": 18},
      {"feature": "manager_changes_12mo",          "weight": 0.24, "value": 2},
      {"feature": "compensation_percentile_band",  "weight": 0.19, "value": 0.28},
      {"feature": "sick_leave_frequency_90d",      "weight": 0.14, "value": 4.2},
      {"feature": "attendance_rate_30d",           "weight": 0.12, "value": 0.83}
    ],
    "feature_snapshot_date": "2026-05-08",
    "job_id":               "pred_job_weekly_20260509",
    "predicted_at":         "2026-05-09T03:45:00Z"
  }
}
```

### EVT-AI-002: `ai.copilot.response.generated`

```json
{
  "event_type": "ai.copilot.response.generated",
  "payload": {
    "session_id":         "copilot_sess_usr_mgr_001_20260509",
    "turn_id":            "turn_014",
    "user_id":            "usr_manager_001",
    "query_intent":       "data_query",
    "query_domain":       "attendance",
    "tools_invoked":      ["analytics_query", "employee_lookup"],
    "data_sources_used":  ["fact_daily_attendance", "dim_employee"],
    "response_latency_ms": 1847,
    "llm_model":          "claude-opus-4",
    "input_tokens":       2341,
    "output_tokens":      287,
    "grounding_records_used": 23,
    "permission_scope_applied": "team_manager",
    "pii_fields_redacted": 0
  }
}
```

**Note:** Copilot response telemetry enables cost tracking, latency monitoring, quality evaluation, and abuse detection — without storing the actual conversation content (which is session-scoped and user-controlled).

---

## EVENT GROUP 11: COMPLIANCE EVENTS

---

### EVT-COMP-001: `compliance.violation.detected`

```json
{
  "event_type": "compliance.violation.detected",
  "payload": {
    "violation_id":      "viol_20260509_001",
    "violation_type":    "working_time_regulation",
    "severity":          "warning",
    "regulation_code":   "MOM_WORK_TIME_MAX",
    "jurisdiction":      {"country": "SG"},
    "employee_id":       "emp_7f3a9b2c-...",
    "detected_value":    72.5,
    "threshold_value":   72.0,
    "threshold_unit":    "hours_per_week",
    "detection_period":  {"start": "2026-04-28", "end": "2026-05-04"},
    "recommended_action": "reduce_overtime_schedule",
    "auto_resolved":     false
  }
}
```




---


# SECTION 4: EVENT ENVELOPE STANDARD

---

## 4.1 The Canonical Event Envelope

Every event emitted on the platform — regardless of domain, category, or consumer — conforms to a single canonical envelope schema. This envelope separates **infrastructure metadata** (routing, tracing, versioning) from **business payload** (domain-specific facts). Consumers may depend on envelope fields being present and valid without parsing the payload.

### Envelope Design Principles
1. **Envelope fields are immutable after emission.** The payload is the fact; the envelope is the delivery vehicle.
2. **All envelope fields are mandatory** except those explicitly marked optional.
3. **Payload is domain-specific and versioned independently** of the envelope.
4. **No business logic** depends on envelope fields — they are infrastructure concerns.
5. **PII never appears in envelope fields** — only in payload, and only where necessary and classified.

---

## 4.2 Full Envelope Specification

```json
{
  // ─── ENVELOPE IDENTITY ───────────────────────────────────────────
  
  "event_id": "evt_01JK4X2N8P7QR3STUVWXYZ12AB",
  // Type: String (ULID — Universally Unique Lexicographically Sortable ID)
  // Format: ULID v1 — time-sortable, globally unique, URL-safe
  // Why ULID not UUID: ULIDs sort lexicographically by creation time →
  //   enables efficient range queries on event logs without secondary index
  // Required: YES
  // Immutable: YES — set at emission, never changed
  
  "event_type": "attendance.daily.processed",
  // Type: String — dot-notation namespaced identifier
  // Format: {domain}.{aggregate}.{action} OR {domain}.{action}
  // Required: YES
  // Consumer routing key — this is what consumers subscribe to
  // Maximum 120 characters
  
  "event_version": 1,
  // Type: Integer — payload schema version
  // Increments on BREAKING payload changes only
  // Additive changes do not increment this field
  // Required: YES
  // Default: 1
  
  "event_category": "domain",
  // Type: Enum
  // Values: domain | workflow | audit | analytics | ai_telemetry |
  //         notification | security | integration | system
  // Required: YES
  // Used for: topic routing, retention policy selection, durability tier assignment
  
  // ─── TEMPORAL METADATA ───────────────────────────────────────────
  
  "occurred_at": "2026-05-09T14:30:00.000Z",
  // Type: String — ISO 8601 UTC timestamp with millisecond precision
  // Meaning: When the BUSINESS FACT occurred — not when the event was created or published
  // Critical distinction: If a clock is corrected, occurred_at reflects the corrected time
  //   of the actual event (e.g., a punch that happened at 09:02 but was recorded at 09:05)
  // Required: YES
  
  "published_at": "2026-05-09T14:30:01.234Z",
  // Type: String — ISO 8601 UTC timestamp
  // Meaning: When the outbox relay published this event to the bus
  // Latency: published_at - occurred_at = publication lag (monitored as SLA metric)
  // Required: YES (set by outbox relay, not by domain code)
  
  // ─── TENANCY ─────────────────────────────────────────────────────
  
  "tenant_id": "ten_ACME_GLOBAL_001",
  // Type: String — opaque tenant identifier
  // Required: YES — mandatory on ALL events without exception
  // Router uses this for tenant-scoped consumer delivery
  // Never cross-tenant delivery possible when this field is present and validated
  
  // ─── AGGREGATE CONTEXT ───────────────────────────────────────────
  
  "aggregate_type": "DailyAttendance",
  // Type: String — PascalCase domain aggregate class name
  // Required: YES
  // Used by: Event sourcing consumers to identify which aggregate state changed
  
  "aggregate_id": "daily_att_20260509_emp_7f3a9b2c",
  // Type: String — unique identifier of the specific aggregate instance
  // Required: YES
  // Partitioning key in streaming infrastructure: all events for same aggregate_id
  //   are delivered to the same partition → in-order processing guaranteed
  
  "aggregate_sequence": 42,
  // Type: Integer — monotonically increasing sequence number per aggregate_id
  // Required: YES
  // Purpose: Detect out-of-order delivery; consumers can reject events with
  //   aggregate_sequence <= last_processed_sequence for this aggregate_id
  // Set by: Domain aggregate during event emission
  
  // ─── CAUSALITY TRACING ───────────────────────────────────────────
  
  "correlation_id": "corr_payroll_run_202605_001",
  // Type: String — groups related events across a business operation
  // Example: All events produced during a single payroll run share correlation_id
  // Required: YES — if no correlation exists, generate a new ULID at emission
  // Propagated: All events caused by this event inherit this correlation_id
  
  "causation_id": "evt_01JK4X2N8P7QR3STUVWXYZ12AA",
  // Type: String — event_id of the event that DIRECTLY caused this event
  // Example: leave.application.approved was caused by workflow.instance.completed
  //   → causation_id = workflow.instance.completed.event_id
  // Required: NO (null if no causal event — e.g., user-initiated action)
  // Enables: Complete causal chain reconstruction for debugging and audit
  
  // ─── ACTOR METADATA ──────────────────────────────────────────────
  
  "actor": {
    "actor_id": "usr_hr_admin_001",
    // Type: String — IAM user_id of the actor who triggered the business action
    // Required: YES for human-initiated actions; system actor for automated
    
    "actor_type": "human",
    // Type: Enum: human | service_account | system | scheduled_job | external_system
    
    "actor_role": "hr_admin",
    // Type: String — role at time of action (roles can change; this records historical role)
    // Required: NO — populated for audit significance
    
    "impersonation": null
    // Type: Object | null — if a support admin is impersonating a user:
    //   {"impersonated_by": "usr_support_admin_001", "impersonation_reason": "customer_support_ticket_123"}
    // Required: NO (null when no impersonation)
  },
  
  // ─── DISTRIBUTED TRACING ─────────────────────────────────────────
  
  "trace": {
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    // OpenTelemetry W3C Trace Context trace-id (16-byte hex)
    
    "span_id": "00f067aa0ba902b7",
    // OpenTelemetry W3C Trace Context parent-span-id (8-byte hex)
    
    "trace_flags": "01"
    // W3C trace flags — "01" = sampled
  },
  
  // ─── ROUTING & INFRASTRUCTURE ────────────────────────────────────
  
  "emitted_by": "attendance-domain",
  // Type: String — logical service/module name
  // Required: YES
  
  "routing": {
    "topic":      "workforce.attendance.daily-processed",
    // Kafka/MQ topic this event targets (set by outbox relay)
    
    "partition_key": "emp_7f3a9b2c-1234-5678-abcd-ef0123456789",
    // Key used for partition assignment (usually aggregate_id or tenant_id)
    
    "priority": "normal"
    // Values: critical | high | normal | low
    // Critical: audit events, compliance alerts
    // High: workflow completion, payroll gates
    // Normal: analytics, notifications
    // Low: AI telemetry, system events
  },
  
  // ─── DATA GOVERNANCE ─────────────────────────────────────────────
  
  "data_classification": {
    "pii_present":        false,
    // Whether payload contains any PII fields
    // If true: consumers must enforce access control before processing
    
    "pii_fields":         [],
    // List of payload field paths containing PII: e.g., ["payload.email", "payload.dob"]
    
    "sensitivity_level":  "internal",
    // Values: public | internal | confidential | restricted
    // internal: company employees only
    // confidential: specific roles only (e.g., payroll data)
    // restricted: highest sensitivity (e.g., salary, disciplinary)
    
    "data_residency":     "SG",
    // ISO country code — event must not be processed by infrastructure outside this region
    
    "retention_class":    "employment_record"
    // Maps to retention policy: employment_record (7yr), audit (10yr), operational (2yr), telemetry (90d)
  },
  
  // ─── IDEMPOTENCY ─────────────────────────────────────────────────
  
  "idempotency_key": "daily_att_20260509_emp_7f3a9b2c",
  // Type: String — business-meaningful deduplication key
  // Format: {aggregate_type}_{natural_key}
  // Different from event_id: idempotency_key is business-level (same business fact
  //   always has same idempotency_key, even if event_id differs due to system error)
  // Required: YES for domain events; optional for telemetry events
  
  // ─── BUSINESS PAYLOAD ────────────────────────────────────────────
  
  "payload": {
    // Domain-specific business fact — schema defined per event_type and event_version
    // See Section 3 for per-event payload schemas
  },
  
  // ─── EXTENSION METADATA ──────────────────────────────────────────
  
  "metadata": {
    "source_system":       "attendance-domain-v2.4.1",
    "environment":         "production",
    "schema_registry_id":  "sr_att_daily_processed_v1",
    // Reference to schema registry entry for payload validation
    
    "replay_origin":       null,
    // If this event is a replay: {"original_event_id": "...", "replayed_at": "...", "replay_reason": "..."}
    
    "test_event":          false
    // true = this is a test/canary event; consumers should process but not apply business effects
  }
}
```

---

## 4.3 Event ID Format: ULID

The platform uses **ULID (Universally Unique Lexicographically Sortable Identifier)** for `event_id` rather than UUID v4. This is a deliberate architectural choice:

```
ULID Structure:
  01JK4X2N8P7QR3STUVWXYZ12AB
  ├──────────────┤├────────────┤
     Timestamp        Random
     (48 bits)       (80 bits)
     millisecond      (cryptographically secure)
     precision

Why ULID over UUID:
  ✓ Lexicographically sortable by creation time
    → B-tree index efficiency for time-range queries on event_log tables
    → No secondary "created_at" index needed for time-range scans
  ✓ URL-safe (no hyphens in default encoding)
  ✓ Case-insensitive (Crockford Base32)
  ✓ 128-bit unique (same collision resistance as UUID v4)
  ✗ Not as universally recognized as UUID
    → Mitigation: expose as string; internal format is implementation detail

Event log query performance comparison:
  UUID v4 range scan (30-day window):  ~8,400ms on 1B row table
  ULID range scan (30-day window):       ~340ms on 1B row table
  Improvement: ~25x faster time-range queries
```

---

## 4.4 Actor Type Reference

```
actor_type Values and Their Meaning:

"human"           — A logged-in user performed the action via UI or API
"service_account" — A programmatic service acting on behalf of a system process
                    (e.g., payroll-domain-service calling Policy Engine)
"system"          — The platform itself generated this event
                    (e.g., automatic year-end leave carry-forward processing)
"scheduled_job"   — A cron/scheduled job triggered the action
                    (e.g., monthly attendance cycle finalization at midnight)
"external_system" — An external system via Integration Platform
                    (e.g., biometric device, ERP sync)
```

---

## 4.5 Envelope Validation Rules

All events MUST pass envelope validation before being accepted to the outbox:

```python
EnvelopeValidationRules:
  1. event_id:         non-null, valid ULID format
  2. event_type:       non-null, matches registered event type in schema registry
  3. event_version:    non-null, integer >= 1
  4. occurred_at:      non-null, valid ISO8601 UTC, NOT in the future (>60s clock skew tolerance)
  5. tenant_id:        non-null, exists in tenant registry
  6. aggregate_type:   non-null, valid aggregate type for this event_type
  7. aggregate_id:     non-null, non-empty string
  8. aggregate_sequence: non-null, integer >= 1
  9. correlation_id:   non-null (auto-generate ULID if not provided by domain)
  10. actor.actor_id:  non-null
  11. actor.actor_type: non-null, valid enum value
  12. emitted_by:      non-null, registered service name
  13. data_classification.sensitivity_level: non-null, valid enum
  14. payload:         non-null, validates against schema_registry_id if provided
  
  Rejection: Events failing validation go to validation_error_queue, not outbox
  Alert: >3 validation failures per minute from same emitter → alert to domain team
```

---

# SECTION 5: EVENT VERSIONING STRATEGY

---

## 5.1 Versioning Principles

Event schema versioning is the **most consequential long-term architectural discipline** in an event-driven system. Poorly managed schema evolution causes one of two outcomes:
- **Backward-incompatible changes break consumers** silently (fields renamed, types changed)
- **Fear of breaking changes** causes schema ossification — the event schema never evolves even as requirements change

The correct answer is: **versioning as a first-class concern with clear governance rules**.

---

## 5.2 Schema Change Classification

Every proposed event schema change must be classified before implementation:

### Class A: Non-Breaking (Additive) Changes
*No version bump required. Safe to deploy immediately.*

```
✓ Adding a new OPTIONAL field to payload
✓ Adding a new enum value to an existing enum field
✓ Expanding a string field's maximum length
✓ Adding a new nested object with all-optional fields
✓ Adding new metadata fields to the envelope (non-breaking by definition)

Consumer rule: Consumers MUST implement tolerant reader pattern —
  ignore unknown fields, use defaults for missing optional fields
  Never fail on unknown fields.

Example — Non-breaking addition to attendance.daily.processed v1:
  ADD: "payload.shift_differential_eligible": boolean (optional, default: false)
  ADD: "payload.remote_work_day": boolean (optional, default: false)
  No version change: event_version remains 1
```

### Class B: Breaking Changes
*Version bump required. Dual-publish period mandatory.*

```
✗ Removing an existing field from payload
✗ Renaming an existing field
✗ Changing a field's data type
✗ Changing a field from optional to required
✗ Changing the semantic meaning of an existing field
✗ Changing the aggregate_type for an event_type

Breaking change process:
  1. Create new event_version (e.g., v1 → v2) with new payload schema
  2. Begin dual-publishing: emit BOTH v1 and v2 for minimum 4 weeks
  3. Notify all registered consumers via #event-contracts Slack channel
  4. Consumers migrate to v2 subscription at their own pace within 4-week window
  5. After all consumers confirmed migrated: deprecate v1 emission
  6. After 4-week deprecation notice: stop emitting v1
  
Example — Breaking change to attendance.daily.processed:
  v1: "effective_hours": 8.5           (float, hours)
  v2: "effective_duration": {           (structured object)
        "hours": 8,
        "minutes": 30,
        "total_minutes": 510
      }
  → Rename + type change = Class B. Version bump v1 → v2.
```

### Class C: Event Type Deprecation
*Highest governance level. Executive approval required.*

```
Event type deprecation (entire event_type retired):
  1. Engineering proposal with impact assessment
  2. All consumer owners notified with 3-month minimum notice
  3. Replacement event type documented and available
  4. Migration period: both old and new event types emitted
  5. After confirmed consumer migration: mark event_type as deprecated in registry
  6. After additional 30-day observation: stop emission
  7. Retain historical events in storage per retention policy
```

---

## 5.3 Schema Registry

Every event schema is registered in the platform's **Schema Registry** — a versioned catalog of all event types, their payload schemas, and their lifecycle status.

```
SchemaRegistryEntry {
  schema_id:          String    -- "sr_att_daily_processed_v1"
  event_type:         String    -- "attendance.daily.processed"
  event_version:      Integer   -- 1
  status:             Enum      -- active | deprecated | retired
  json_schema:        Object    -- Full JSON Schema (Draft 7) for payload validation
  registered_at:      Timestamp
  deprecated_at:      Timestamp?
  retirement_date:    Date?     -- when emission stops
  consumers:          [String]  -- registered consumer domain names
  producer:           String    -- owning domain
  change_log:         [ChangeEntry]
  compatibility_mode: Enum      -- backward | forward | full | none
}
```

### Schema Compatibility Enforcement

```
Compatibility modes enforced at outbox relay:

BACKWARD:  New schema can read messages written with old schema
           → Old consumers can still process new events (recommended for most domain events)

FORWARD:   Old schema can read messages written with new schema  
           → New consumers can still process old events (important during migration)

FULL:      Both backward AND forward compatible (additive changes only)
           → Maximum flexibility; suitable for high-stability event types (employee.created)

NONE:      No compatibility guarantee (breaking change)
           → Requires explicit consumer migration and version negotiation
```

---

## 5.4 Consumer Version Negotiation

When a consumer subscribes to an event type, it registers its **minimum and maximum supported schema versions**:

```
ConsumerRegistration {
  consumer_domain:    "analytics-domain"
  event_type:         "attendance.daily.processed"
  min_version:        1
  max_version:        2
  preferred_version:  2
  fallback_behavior:  "process_v1_with_defaults"
}
```

The event bus routes the appropriate version to each consumer. During a migration window, v1 consumers receive v1 events; v2 consumers receive v2 events. The outbox relay performs version translation for minor (additive) version differences using a registered **schema transformer**.

---

## 5.5 Replay Compatibility

Historical events must remain replayable for their full retention period. This creates a specific constraint: a consumer replaying 5-year-old events must be able to process them even if the current event_version is significantly higher.

```
Replay Compatibility Rules:

1. Historical events are NEVER rewritten in the event store.
   The original event_version is preserved forever.

2. Consumers that support replay MUST maintain version-specific deserializers:
   deserialize_v1(payload) → AttendanceDailyProcessedV1
   deserialize_v2(payload) → AttendanceDailyProcessedV2
   
3. Replay manifest: when replaying a range of historical events, the replay
   controller declares the expected version range. Consumers pre-load the
   appropriate deserializer chain.

4. Schema transformers: for consumers that only support the latest version,
   a transformation pipeline converts old events to the current schema:
   v1_event → transformer_v1_to_v2 → v2_event → consumer
   Transformers are registered in the Schema Registry alongside schemas.
```

---

# SECTION 6: OUTBOX + RELIABILITY STRATEGY

---

## 6.1 The Transactional Outbox Pattern — Architecture

The Outbox Pattern is the foundation of all event reliability in the platform. It solves the **dual write problem**: writing to the database and publishing to the event bus are two separate I/O operations. Without the outbox, a crash between the two leaves the system in an inconsistent state (data changed but event not published, or vice versa).

```
THE DUAL WRITE PROBLEM (without outbox):
  ┌─────────────────────────────────────────────────────────┐
  │  BEGIN TRANSACTION                                       │
  │    UPDATE leave_balance SET availed = availed + 3 ...   │
  │  COMMIT                                                  │
  │  ← CRASH HERE → event never published                   │
  │  publish_event("leave.application.approved", payload)   │
  │  ← OR CRASH HERE → event published but DB not committed │
  └─────────────────────────────────────────────────────────┘
  Result: State inconsistency. Downstream consumers diverge.

THE OUTBOX SOLUTION:
  ┌─────────────────────────────────────────────────────────┐
  │  BEGIN TRANSACTION                                       │
  │    UPDATE leave_balance SET availed = availed + 3 ...   │
  │    INSERT INTO leave.outbox (event_type, payload, ...)  │
  │  COMMIT  ← single atomic operation                      │
  └─────────────────────────────────────────────────────────┘
  Outbox relay (separate process):
    Poll → read unpublished outbox records
         → publish to event bus
         → mark published = true (on success)
         → retry on failure (record stays unpublished)
  
  Guarantee: If the domain transaction commits, the event WILL be published.
  Eventually, but guaranteed. No event loss. No phantom events.
```

---

## 6.2 Outbox Schema — Per Domain

```sql
-- Template: replicated per domain schema
-- e.g., attendance.outbox, leave.outbox, payroll.outbox, etc.

CREATE TABLE {domain}.outbox (
  -- Identity
  outbox_id         UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id          TEXT         NOT NULL UNIQUE,   -- ULID — for deduplication
  
  -- Routing
  event_type        VARCHAR(120) NOT NULL,
  event_category    VARCHAR(30)  NOT NULL,
  topic             VARCHAR(200) NOT NULL,           -- target topic/queue
  partition_key     VARCHAR(200) NOT NULL,           -- routing key
  priority          VARCHAR(20)  NOT NULL DEFAULT 'normal',
  
  -- Tenant
  tenant_id         UUID         NOT NULL,
  
  -- Aggregate
  aggregate_type    VARCHAR(80)  NOT NULL,
  aggregate_id      TEXT         NOT NULL,
  aggregate_sequence INTEGER     NOT NULL,
  
  -- Envelope (full JSON)
  event_envelope    JSONB        NOT NULL,           -- complete canonical envelope
  
  -- Delivery tracking
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- Values: pending | publishing | published | failed | dead_letter
  
  publish_attempts  INTEGER      NOT NULL DEFAULT 0,
  first_attempt_at  TIMESTAMPTZ,
  last_attempt_at   TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  last_error        TEXT,
  last_error_code   VARCHAR(50),
  
  -- Ordering
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  
  -- Data governance
  sensitivity_level VARCHAR(20)  NOT NULL DEFAULT 'internal',
  retention_class   VARCHAR(50)  NOT NULL
);

-- Critical indexes for outbox relay performance
CREATE INDEX idx_outbox_pending_priority 
  ON {domain}.outbox (priority DESC, created_at ASC) 
  WHERE status = 'pending';

CREATE INDEX idx_outbox_tenant 
  ON {domain}.outbox (tenant_id, created_at) 
  WHERE status IN ('pending', 'publishing');

CREATE INDEX idx_outbox_event_id 
  ON {domain}.outbox (event_id);  -- deduplication lookup

-- Partition by month for large-volume domains
-- attendance.outbox partitioned monthly (high volume)
CREATE TABLE attendance.outbox_2026_05 
  PARTITION OF attendance.outbox 
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

---

## 6.3 Outbox Relay Design

```
OUTBOX RELAY ARCHITECTURE

┌────────────────────────────────────────────────────────────────┐
│                    OUTBOX RELAY PROCESS                         │
│                  (one per domain schema)                        │
│                                                                 │
│  ┌─────────────────┐                                           │
│  │  POLL LOOP      │  Poll interval: 100ms (tunable)          │
│  │                 │  Batch size: 100 records per poll         │
│  │  SELECT ...     │  Priority-ordered: critical first         │
│  │  WHERE status=  │                                           │
│  │  'pending'      │                                           │
│  │  LIMIT 100      │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│  ┌────────▼────────┐                                           │
│  │  CLAIM RECORDS  │  UPDATE status='publishing'               │
│  │                 │  (prevents concurrent relay instances      │
│  │  (optimistic    │   from processing same record)            │
│  │   locking via   │  SELECT ... FOR UPDATE SKIP LOCKED        │
│  │   status field) │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│  ┌────────▼────────┐                                           │
│  │  PUBLISH TO BUS │  In-process: dispatch to EventDispatcher  │
│  │                 │  External: publish to Kafka/RabbitMQ      │
│  │  Per-record:    │                                           │
│  │  timeout 5s     │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│  ┌────────▼────────┐  SUCCESS: status='published', published_at=NOW()
│  │  UPDATE STATUS  │  FAILURE: status='pending', attempts++, last_error=..
│  │                 │           (returns to pending for retry)  │
│  │  Batch commit   │  EXHAUSTED: status='dead_letter'          │
│  └─────────────────┘                                           │
└────────────────────────────────────────────────────────────────┘
```

### Relay Concurrency Safety

The relay uses `SELECT ... FOR UPDATE SKIP LOCKED` — Postgres's advisory lock for queue processing. This enables:
- Multiple relay instances for high-volume domains (attendance.outbox)
- Each relay instance processes a non-overlapping batch
- No inter-relay coordination required
- Graceful relay restart: in-flight "publishing" records time out and revert to "pending"

```sql
-- Outbox relay poll query
SELECT outbox_id, event_id, event_envelope, topic, partition_key, priority
FROM {domain}.outbox
WHERE status = 'pending'
  AND tenant_id = ANY($allowed_tenant_ids)  -- relay is tenant-aware
ORDER BY 
  CASE priority 
    WHEN 'critical' THEN 1 
    WHEN 'high' THEN 2 
    WHEN 'normal' THEN 3 
    ELSE 4 
  END,
  created_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

---

## 6.4 Delivery Semantics: At-Least-Once + Idempotent Consumers

The platform uses **at-least-once delivery** from the outbox relay with **idempotent consumer processing** to achieve effective exactly-once business semantics.

```
WHY NOT EXACTLY-ONCE FROM THE BROKER:
  Kafka exactly-once (transactions) adds ~30-40% overhead on producers and consumers.
  For the majority of events (analytics, AI telemetry, notifications), this overhead
  is not justified — a duplicate notification or a double-counted attendance metric
  is a minor annoyance, not a business disaster.
  
  For the events where correctness matters critically (payroll balance deductions,
  leave balance updates), idempotent consumer logic achieves the same result
  without the broker-level overhead.

IDEMPOTENT CONSUMER PATTERN (mandatory for all domain event consumers):

Consumer receives event with event_id = "evt_01JK4X2N8P7QR3STUVWXYZ12AB"

Step 1: Check processed_events table
  SELECT 1 FROM {domain}.processed_events 
  WHERE event_id = 'evt_01JK4X2N8P7QR3STUVWXYZ12AB';
  → If found: return immediately (duplicate — skip)
  → If not found: proceed

Step 2: Process business logic within transaction:
  BEGIN;
    INSERT INTO {domain}.processed_events (event_id, event_type, processed_at)
    VALUES ('evt_01JK...', 'leave.application.approved', NOW());
    -- business logic here (update leave balance, etc.)
  COMMIT;

Step 3: Acknowledge event to bus

ADDITIONAL IDEMPOTENCY MECHANISMS:
  • idempotency_key in envelope: business-level dedup for scenarios where
    two distinct event_ids represent the same business fact
  • aggregate_sequence validation: reject if sequence <= last processed sequence
    (detects replayed old events during disaster recovery)
```

---

## 6.5 Retry Semantics

```
RETRY STRATEGY BY EVENT CATEGORY:

CRITICAL (Audit, Workflow Completion, Payroll Gate Events):
  Max attempts:    Unlimited (manual intervention required to stop)
  Backoff:         Exponential: 1s → 2s → 4s → 8s → 16s → cap 60s
  DLQ threshold:   After 10 consecutive failures → alert + DLQ
  DLQ behavior:    Human review required before replay
  Alert:           PagerDuty P1 after 5 consecutive failures

HIGH (Domain Events — primary business operations):
  Max attempts:    20
  Backoff:         Exponential: 2s → 4s → 8s → ... → cap 300s
  DLQ threshold:   After max_attempts → DLQ
  DLQ behavior:    Alert to domain team; auto-replay after investigation
  Alert:           Slack alert after 5 consecutive failures

NORMAL (Analytics, Notifications, AI Telemetry):
  Max attempts:    10
  Backoff:         Exponential: 5s → 10s → 20s → ... → cap 600s
  DLQ threshold:   After max_attempts → DLQ
  DLQ behavior:    Log + alert; manual investigation within 24h
  Alert:           Email alert to domain team

LOW (System Events, Monitoring Telemetry):
  Max attempts:    3
  Backoff:         Fixed 30s
  DLQ threshold:   After max_attempts → discard (log only)
  DLQ behavior:    N/A — system events are non-critical telemetry
```

---

## 6.6 Dead Letter Queue (DLQ) Strategy

```
DLQ ARCHITECTURE:

{domain}.outbox_dlq table (same schema as outbox, plus investigation fields):
  
  Additional fields:
    dlq_reason:           VARCHAR(200)  -- why it was DLQ'd
    dlq_at:               TIMESTAMPTZ
    investigation_status: ENUM('pending_review', 'under_investigation', 'resolved', 'discarded')
    investigated_by:      UUID?
    investigation_notes:  TEXT?
    replay_requested:     BOOLEAN DEFAULT FALSE
    replay_at:            TIMESTAMPTZ?
    replay_event_id:      TEXT?         -- event_id of the replay event

DLQ MONITORING:
  Real-time dashboard: DLQ depth by domain and category
  Alert thresholds:
    Critical DLQ: any entry → immediate PagerDuty P1
    High DLQ: >5 entries → Slack alert within 5 minutes
    Normal DLQ: >50 entries → email alert
    
DLQ INVESTIGATION WORKFLOW:
  1. Engineer receives alert
  2. Reviews DLQ entry: event envelope, error history, consumer logs
  3. Identifies root cause (consumer bug, schema mismatch, downstream unavailable)
  4. Fixes root cause
  5. Marks replay_requested = true for affected entries
  6. Replay job processes marked entries: moves back to outbox.status = 'pending'
  7. Marks investigation_status = 'resolved'

REPLAY SAFETY:
  All replayed events get metadata.replay_origin set:
  {
    "original_event_id": "evt_01JK...",
    "replayed_at": "2026-05-10T09:00:00Z",
    "replay_reason": "dlq_resolution",
    "replayed_by": "usr_engineer_001"
  }
  Consumers that process replay events must handle idempotently —
  the business effect must be the same as processing the original.
```

---

## 6.7 Event Store (Append-Only Log)

Beyond the outbox (which is a delivery mechanism), the platform maintains an **immutable event store** — an append-only log of all published events, retained for the full retention period:

```sql
CREATE TABLE platform.event_store (
  event_id          TEXT         NOT NULL PRIMARY KEY,  -- ULID
  event_type        VARCHAR(120) NOT NULL,
  event_version     INTEGER      NOT NULL,
  event_category    VARCHAR(30)  NOT NULL,
  tenant_id         UUID         NOT NULL,
  aggregate_type    VARCHAR(80)  NOT NULL,
  aggregate_id      TEXT         NOT NULL,
  aggregate_sequence INTEGER     NOT NULL,
  occurred_at       TIMESTAMPTZ  NOT NULL,
  published_at      TIMESTAMPTZ  NOT NULL,
  correlation_id    TEXT,
  causation_id      TEXT,
  actor_id          TEXT,
  emitted_by        TEXT,
  event_envelope    JSONB        NOT NULL,    -- full canonical envelope
  checksum          TEXT         NOT NULL     -- SHA-256 of event_envelope (tamper evidence)
) PARTITION BY RANGE (occurred_at);          -- monthly partitions

-- Immutability enforcement
REVOKE UPDATE, DELETE ON platform.event_store FROM app_user;
-- Only INSERT privilege granted to application users

-- Tamper-evidence check (scheduled integrity job):
-- Recompute SHA-256 of event_envelope and compare to stored checksum
-- Alert if any mismatch detected
```

The event store enables:
- **Replay:** Re-process any range of events for any consumer (projection rebuild after bug fix)
- **Audit:** Regulators can query the raw event log for any entity
- **Debugging:** Reconstruct exact sequence of events that led to any system state
- **AI Training:** Historical event sequences used as training data




---


# SECTION 7: EVENT STREAMING EVOLUTION STRATEGY

---

## 7.1 Evolution Philosophy

The streaming infrastructure evolves in lockstep with business scale and team maturity — not ahead of it. The architectural decision to begin with in-process event dispatch rather than immediately deploying Kafka is not a shortcut: it is the correct sequencing. Kafka solves problems that a 5,000-employee deployment does not have. Kafka also introduces problems (consumer group management, partition rebalancing, broker availability, exactly-once configuration complexity) that an early-stage platform team cannot afford to debug at 2am.

The evolution is designed so that **no domain code changes** are required at any phase transition. Only the infrastructure layer beneath the outbox relay changes. This is the architectural value of the outbox: it decouples domain logic from transport infrastructure entirely.

---

## 7.2 Phase 1: In-Process Event Bus

**Timeline:** Launch → approximately 5,000 employees, ~18 months  
**Infrastructure:** None beyond existing Postgres

```
PHASE 1 ARCHITECTURE:

┌─────────────────────────────────────────────────────────────────┐
│                   SINGLE APPLICATION PROCESS                     │
│                                                                  │
│  Domain Layer         Outbox Layer         Consumer Layer        │
│  ──────────────       ─────────────       ──────────────────    │
│  LeaveService    →→→  leave.outbox   →→→  AnalyticsHandler      │
│  AttendanceSvc   →→→  attend.outbox  →→→  AuditHandler          │
│  PayrollService  →→→  payroll.outbox →→→  NotificationHandler   │
│                                      →→→  WorkflowHandler       │
│                                                                  │
│  OutboxRelay (background thread):                               │
│    Polls all outbox tables every 100ms                          │
│    Dispatches to InProcessEventBus                              │
│    InProcessEventBus routes to registered handlers              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Transport: In-process method call (zero network latency)
Durability: Postgres outbox table (survives process restart)
Ordering: Per-aggregate sequence guaranteed
Consumers: Registered handler classes in same process

Monitoring:
  - Outbox queue depth per domain (alert if > 1,000 pending records)
  - Processing latency: event_published_at - event_occurred_at
  - Handler error rate per event_type

Limitations:
  - All consumers scale with the monolith (no independent scaling)
  - Consumer failure can block other consumers (mitigated by async thread pool)
  - No consumer group semantics (each consumer processes every event once)
```

### In-Process EventBus Interface
```typescript
interface EventBus {
  publish(event: DomainEvent): Promise<void>
  subscribe<T extends DomainEvent>(
    eventType: string,
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): Subscription
}

interface EventHandler<T extends DomainEvent> {
  handle(event: T): Promise<void>
  onError(event: T, error: Error): Promise<ErrorAction>
  // ErrorAction: retry | skip | dead_letter
}

interface SubscriptionOptions {
  priority?: 'critical' | 'high' | 'normal' | 'low'
  maxRetries?: number
  timeoutMs?: number
  idempotencyEnabled?: boolean
}
```

---

## 7.3 Phase 2: Durable Queue System

**Timeline:** 5,000–20,000 employees, months 18–36  
**Infrastructure:** Redis Streams or PostgreSQL-backed job queue (Graphile Worker / BullMQ)  
**Trigger conditions:**
- Outbox relay consuming >5% of Postgres CPU
- Consumer processing latency >30 seconds for normal-priority events
- Need for consumer-level horizontal scaling
- Analytics or AI domain needing independent deployment

```
PHASE 2 ARCHITECTURE:

                    ┌──────────────────┐
   Domain Writes → │  Postgres Outbox  │
                    └────────┬─────────┘
                             │ Outbox Relay
                             ▼
                    ┌──────────────────┐
                    │   Redis Streams  │  OR  Graphile Worker
                    │   (per domain)   │  (Postgres-backed queue)
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Analytics    │ │ Audit        │ │ Notification │
    │ Consumer     │ │ Consumer     │ │ Consumer     │
    │ (1-3 workers)│ │ (1 worker)   │ │ (1-2 workers)│
    └──────────────┘ └──────────────┘ └──────────────┘
    (can scale independently from domain services)

Migration from Phase 1:
  1. Add Redis Streams or Graphile Worker alongside existing in-process bus
  2. Configure outbox relay to publish to Redis Streams (not in-process bus)
  3. Migrate consumers one domain at a time (attendance analytics first)
  4. Validate consumer processing parity before next migration
  5. Decommission in-process bus handler after all consumers migrated
  
Zero domain code changes: outbox relay is the only changed component.
Consumers are moved to separate worker processes using same handler interface.
```

### Redis Streams Configuration
```
Stream naming: workforce:{domain}:{event-type-slug}
  Examples:
    workforce:attendance:daily-processed
    workforce:payroll:run-disbursed
    workforce:leave:application-approved

Consumer groups per stream:
  workforce:attendance:daily-processed
    GROUP analytics-consumer          (lag monitoring target: <30s)
    GROUP audit-consumer              (lag monitoring target: <60s)
    GROUP ai-consumer                 (lag monitoring target: <5min)
    GROUP notification-consumer       (lag monitoring target: <10s)

Redis Stream configuration:
  MAXLEN: 1,000,000 entries per stream (trim older entries to cold storage)
  Persistence: Redis AOF enabled (appendfsync always for critical streams)
  Replication: Redis Sentinel (3 nodes) for HA

Monitoring:
  XPENDING per group: lag depth per consumer group
  Alert: lag > 10,000 messages for critical groups
  Alert: lag > 1,000,000 messages for any group
```

---

## 7.4 Phase 3: Kafka/Redpanda Streaming

**Timeline:** 20,000–100,000+ employees, months 30–48+  
**Infrastructure:** Apache Kafka (self-hosted) or Confluent Cloud or Redpanda  
**Trigger conditions:**
- Aggregate event throughput >50,000 events/minute
- Multiple independently deployed services (Attendance, Analytics extracted)
- Need for long-term event replay (full event log replay)
- Multi-region deployment requirement
- Analytics pipeline requiring Apache Flink or Spark streaming integration

```
PHASE 3 ARCHITECTURE:

┌─────────────────────────────────────────────────────────────────┐
│                    KAFKA CLUSTER                                  │
│  (3 brokers minimum; 5 brokers for production enterprise scale) │
│                                                                  │
│  Topics (partitioned by tenant_id or aggregate_id):             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  workforce.attendance.punched         (48 partitions)    │   │
│  │  workforce.attendance.daily-processed  (24 partitions)   │   │
│  │  workforce.payroll.run-disbursed        (6 partitions)   │   │
│  │  workforce.employee.created            (12 partitions)   │   │
│  │  workforce.leave.application-approved  (12 partitions)   │   │
│  │  workforce.workflow.instance-completed (12 partitions)   │   │
│  │  workforce.audit.*                     (24 partitions)   │   │
│  │  workforce.ai-telemetry.*              (12 partitions)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Consumer Groups:                                                │
│  workforce.analytics.attendance-processor (3 workers/partitions)│
│  workforce.audit.event-recorder           (1 worker)            │
│  workforce.ai.feature-pipeline            (4 workers)           │
│  workforce.notifications.dispatcher       (2 workers)           │
│  workforce.clickhouse.ingestion           (6 workers)           │
└─────────────────────────────────────────────────────────────────┘
```

### Kafka Topic Design Specification

```
TOPIC NAMING CONVENTION:
  {platform}.{domain}.{event-type-slug}
  
  Event type slug: lowercase, hyphen-separated
  attendance.daily.processed → daily-processed
  payroll.run.disbursed      → run-disbursed
  employee.created           → created

PARTITION COUNT GUIDELINES:
  Formula: target_partitions = peak_events_per_second / events_per_consumer_per_second
  
  attendance.punched: 
    Peak: 500 punches/sec (50,000 employees, shift change)
    Consumer throughput: ~50 events/sec per consumer instance
    → 500/50 = 10 minimum, round to 12 partitions (+ growth headroom → 48)
  
  payroll.run-disbursed:
    Peak: 1 event per monthly run (low volume)
    → 6 partitions (minimum for fault tolerance)

PARTITIONING KEYS:
  High-volume per-employee events:  partition_key = employee_id
    → All events for same employee in same partition
    → Ordering guarantee per employee
  
  Tenant-level events:              partition_key = tenant_id
    → All events for same tenant in same partition
    → Tenant-level ordering guarantee
  
  Run/batch events (payroll):       partition_key = run_id
    → All events for same run in same partition

RETENTION POLICIES:
  Operational topics:              7 days (consumer must process quickly)
  Audit/compliance topics:         30 days (longer availability before archival)
  AI telemetry:                    14 days
  System events:                   3 days
  
  → After Kafka retention: events archived to S3 Parquet (cold storage)
  → Historical replay from S3 Parquet via batch ingestion job

REPLICATION FACTOR: 3 (all topics in production)
MIN.INSYNC.REPLICAS: 2 (write acknowledged only after 2 replicas confirmed)
```

### Redpanda Consideration

For deployments preferring operational simplicity, **Redpanda** is a viable alternative to Apache Kafka:
- Kafka API-compatible (zero consumer code changes)
- No ZooKeeper dependency (simpler operations)
- Better tail latency characteristics (C++ runtime vs. JVM)
- Lower per-broker resource requirements
- Built-in schema registry
- Trade-off: smaller ecosystem, newer platform, fewer managed hosting options

---

## 7.5 Phase 4: Distributed Event Platform

**Timeline:** 48+ months, enterprise global scale  
**Infrastructure:** Multi-region Kafka, Apache Flink for stream processing, ClickHouse for analytics ingestion, vector database for AI

```
PHASE 4 ARCHITECTURE — GLOBAL SCALE:

Region: Asia-Pacific (Primary)          Region: EU (for GDPR tenants)
┌───────────────────────────┐          ┌───────────────────────────┐
│  Kafka Cluster (AP)       │◄────────►│  Kafka Cluster (EU)       │
│  ClickHouse (AP)          │          │  ClickHouse (EU)          │
│  Flink Jobs (AP)          │          │  Flink Jobs (EU)          │
└───────────────────────────┘          └───────────────────────────┘
          │                                        │
          └──────────────┬─────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │  Global Control     │
              │  Plane              │
              │  (Schema Registry,  │
              │   Consumer Registry,│
              │   Policy Engine)    │
              └─────────────────────┘

Data residency enforcement:
  EU tenant events → only routed to EU Kafka cluster
  APAC tenant events → only routed to AP Kafka cluster
  Control plane events → replicated across regions
```

---

## 7.6 Migration Compatibility Matrix

| Component | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| Domain aggregate code | ✓ unchanged | ✓ unchanged | ✓ unchanged | ✓ unchanged |
| Outbox table schema | ✓ stable | ✓ stable | ✓ stable | ✓ stable |
| Outbox relay | In-process dispatch | Redis/PG queue publish | Kafka producer | Multi-region producer |
| Consumer handler interface | Sync method call | Worker queue handler | Kafka consumer handler | Flink processor |
| Event envelope | ✓ stable | ✓ stable | ✓ stable | ✓ stable |
| Event schemas | ✓ Schema Registry | ✓ Schema Registry | ✓ Schema Registry | ✓ Global Registry |
| Idempotency mechanism | processed_events table | processed_events table | processed_events table | processed_events table |

**Key design guarantee:** The outbox pattern's existence means that **the domain code never imports or references the transport infrastructure**. Migrations are operational deployments, not code refactors.

---

# SECTION 8: ANALYTICS EVENT ARCHITECTURE

---

## 8.1 The Analytics Event Pipeline

```
ANALYTICS EVENT PIPELINE — END TO END:

OPERATIONAL LAYER (writes domain events)
┌────────────────────────────────────────────────────────────────┐
│ attendance.daily.processed                                      │
│ payroll.run.disbursed                                           │
│ leave.application.approved                                      │
│ employee.transferred                                            │
│ ... (all domain events)                                         │
└──────────────────────────────────────┬─────────────────────────┘
                                       │ Event Bus / Kafka
                                       ▼
INGESTION LAYER (analytics domain consumes)
┌────────────────────────────────────────────────────────────────┐
│ Analytics Event Consumers (per domain namespace)               │
│                                                                 │
│ AttendanceAnalyticsConsumer                                     │
│   → Receives: attendance.daily.processed                        │
│   → Validates: envelope + schema                                │
│   → Idempotency check: event_id                                 │
│   → Transforms: domain event → analytics fact record           │
│   → Writes: fact_daily_attendance (append + upsert)            │
│                                                                 │
│ PayrollAnalyticsConsumer                                        │
│   → Receives: payroll.run.disbursed                             │
│   → Writes: fact_payroll_period                                 │
│                                                                 │
│ EmployeeAnalyticsConsumer                                       │
│   → Receives: employee.created / transferred / promoted / exited│
│   → Writes: dim_employee (SCD Type 2 management)               │
│   → Updates: fact_headcount_snapshot                            │
└──────────────────────────────────────┬─────────────────────────┘
                                       │
                                       ▼
AGGREGATION LAYER (near-real-time KPI computation)
┌────────────────────────────────────────────────────────────────┐
│ KPI Computation Engine                                          │
│                                                                 │
│ Triggered by: each projection write                             │
│ Computes: rolling KPI metrics                                   │
│                                                                 │
│ Real-time (< 60 seconds):                                       │
│   current_attendance_count, today_absent_count,                 │
│   live_ot_count, active_leave_count                             │
│                                                                 │
│ Hourly:                                                         │
│   absenteeism_rate_7d, absenteeism_rate_30d,                   │
│   overtime_rate_wtd, leave_utilization_ytd                      │
│                                                                 │
│ Daily:                                                          │
│   attrition_rate_12m, headcount_trend, payroll_cost_per_fte    │
└──────────────────────────────────────┬─────────────────────────┘
                                       │
                                       ▼
SERVING LAYER (dashboard query APIs)
┌────────────────────────────────────────────────────────────────┐
│ Analytics Query API                                             │
│ Dashboard Widget APIs (<500ms P95 response)                     │
│ KPI Card APIs (<100ms from pre-aggregated cache)               │
│ Report Generator (async, up to 30s for 12-month reports)       │
│ AI Feature Export API                                           │
└────────────────────────────────────────────────────────────────┘
```

---

## 8.2 Analytics-Specific Events

Beyond consuming operational domain events, the Analytics domain also emits its own events to record analytics-layer operations:

### `analytics.projection.updated`
```json
{
  "event_type": "analytics.projection.updated",
  "payload": {
    "projection_type":    "fact_daily_attendance",
    "trigger_event_id":   "evt_01JK4X2N8P7QR3STUVWXYZ12AB",
    "trigger_event_type": "attendance.daily.processed",
    "records_affected":   1,
    "processing_latency_ms": 234,
    "projection_current_lag_seconds": 18
  }
}
```

### `analytics.kpi.computed`
```json
{
  "event_type": "analytics.kpi.computed",
  "payload": {
    "kpi_code":          "absenteeism_rate_30d",
    "dimension_scope": {
      "tenant_id":       "ten_ACME_GLOBAL_001",
      "unit_id":         "unit_engineering_backend",
      "computation_date": "2026-05-09"
    },
    "value":             3.2,
    "unit":              "percent",
    "computed_at":       "2026-05-09T14:35:00Z",
    "source_records":    612,
    "previous_value":    2.8,
    "delta_percent":     14.3
  }
}
```
*Consumers:* AI Intelligence domain (KPI signals for prediction models), Dashboard cache invalidation

### `analytics.report.generated`
```json
{
  "event_type": "analytics.report.generated",
  "payload": {
    "report_id":         "rep_monthly_attendance_202605",
    "report_type":       "monthly_attendance_summary",
    "tenant_id":         "ten_ACME_GLOBAL_001",
    "period":            {"year": 2026, "month": 5},
    "generated_by":      "scheduled_job",
    "rows_included":     1247,
    "document_id":       "doc_rep_monthly_att_202605",
    "generation_ms":     4823,
    "delivered_to":      ["usr_hr_director_001", "usr_operations_head_001"]
  }
}
```

---

## 8.3 OLTP → OLAP Event Flow (Detailed)

```
ATTENDANCE DOMAIN OLTP → ANALYTICS OLAP:

Step 1: Attendance domain writes DailyAttendance aggregate
  attendance.outbox: INSERT {event_type: "attendance.daily.processed", ...}

Step 2: Outbox relay publishes to event bus
  Event delivered to: analytics.attendance.consumer

Step 3: Analytics consumer processes event
  a. Idempotency check: event_id not in analytics.processed_events
  b. Extract transformation:
     domain_event.payload → analytics_fact_row
  c. Upsert to fact_daily_attendance:
     INSERT INTO analytics.fact_daily_attendance (...)
     ON CONFLICT (date_key, employee_key, tenant_id)
     DO UPDATE SET -- (for regularization corrections)
       attendance_status = EXCLUDED.attendance_status,
       effective_hours = EXCLUDED.effective_hours,
       ...
       source_event_id = EXCLUDED.source_event_id

Step 4: Real-time summary table update
  UPDATE analytics.rt_attendance_summary
  SET present_count = present_count + 1  -- (if status = present)
  WHERE tenant_id = $1 AND unit_id = $2 AND summary_date = $3;
  -- Supabase Realtime detects this UPDATE → pushes to subscribed dashboards

Step 5: Emit analytics.projection.updated event (for monitoring)

Step 6: Mark event as processed in analytics.processed_events

Total end-to-end latency target: < 2 minutes from attendance computation to dashboard update
```

---

## 8.4 ClickHouse Ingestion Strategy (Phase 3+)

When analytical query volume exceeds Postgres read capacity, the Analytics domain migrates fact tables to ClickHouse (or Redshift, BigQuery) — a columnar OLAP engine optimized for aggregate queries.

```
CLICKHOUSE INGESTION PIPELINE (Phase 3):

Kafka Topic: workforce.attendance.daily-processed
  ↓
ClickHouse Kafka Table Engine (reads directly from Kafka topic):
  CREATE TABLE clickhouse_db.attendance_daily_kafka
  ENGINE = Kafka
  SETTINGS kafka_broker_list = 'kafka:9092',
           kafka_topic_list = 'workforce.attendance.daily-processed',
           kafka_group_name = 'clickhouse-attendance-consumer',
           kafka_format = 'JSONEachRow',
           kafka_skip_broken_messages = 0;

Materialized View (transforms Kafka rows → target table):
  CREATE MATERIALIZED VIEW clickhouse_db.attendance_daily_mv
  TO clickhouse_db.fact_daily_attendance
  AS SELECT
    toDate(JSONExtractString(payload, 'attendance_date'))        AS date,
    JSONExtractString(payload, 'employee_id')                   AS employee_id,
    JSONExtractString(tenant_id)                                AS tenant_id,
    JSONExtractString(payload, 'attendance_status')             AS attendance_status,
    JSONExtractBool(payload, 'is_present')                      AS is_present,
    JSONExtractFloat(payload, 'effective_hours')                 AS effective_hours,
    JSONExtractFloat(payload, 'overtime_hours')                 AS overtime_hours,
    ...
  FROM clickhouse_db.attendance_daily_kafka;

Target Table (MergeTree for time-series performance):
  CREATE TABLE clickhouse_db.fact_daily_attendance (
    date            Date,
    employee_id     String,
    tenant_id       String,
    unit_id         String,
    attendance_status String,
    is_present      UInt8,
    effective_hours Float32,
    overtime_hours  Float32,
    ...
  ) ENGINE = ReplacingMergeTree()
  PARTITION BY toYYYYMM(date)
  ORDER BY (tenant_id, unit_id, employee_id, date);

Query performance (vs. Postgres):
  Absenteeism rate, 12 months, 50K employees:
    Postgres:   8,400ms
    ClickHouse:   180ms  (47x faster)
```

---

## 8.5 Event-Driven Materialized Views

The Analytics domain uses **event-driven materialized view refresh** instead of scheduled REFRESH MATERIALIZED VIEW jobs (which create stale data and periodic load spikes):

```
PATTERN: Event-Driven Materialized View

Traditional (bad):
  Schedule: REFRESH MATERIALIZED VIEW mv_absenteeism_rate EVERY 1 HOUR;
  Problem: Stale for up to 1 hour; spike at refresh time; refreshes even when no data changed

Event-Driven (good):
  1. attendance.daily.processed event received by Analytics consumer
  2. Consumer updates base fact table (incremental, not full refresh)
  3. Consumer updates pre-aggregated KPI summary table (targeted update for affected rows)
  4. KPI cache entry invalidated for affected dimensions
  5. Dashboard receives updated value within 60 seconds of original event

Implementation:
  Instead of materialized views: maintain pre-aggregated summary tables
  maintained by event-driven consumers rather than SQL refresh jobs
  
  CREATE TABLE analytics.kpi_daily_attendance_summary (
    summary_date       DATE         NOT NULL,
    tenant_id          UUID         NOT NULL,
    unit_id            UUID         NOT NULL,
    -- Additive measures (update with each new event)
    total_employees    INTEGER      NOT NULL DEFAULT 0,
    present_count      INTEGER      NOT NULL DEFAULT 0,
    absent_count       INTEGER      NOT NULL DEFAULT 0,
    late_count         INTEGER      NOT NULL DEFAULT 0,
    total_ot_hours     DECIMAL(10,2) NOT NULL DEFAULT 0,
    -- Computed rates (recalculated from additive measures on read)
    last_updated       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (summary_date, tenant_id, unit_id)
  );
  
  Consumer incremental update (per received event):
  INSERT INTO analytics.kpi_daily_attendance_summary (summary_date, tenant_id, unit_id, ...)
  VALUES ($date, $tenant, $unit, ...)
  ON CONFLICT (summary_date, tenant_id, unit_id)
  DO UPDATE SET
    total_employees = kpi_daily_attendance_summary.total_employees + 1,
    present_count   = kpi_daily_attendance_summary.present_count + $is_present::int,
    ...
    last_updated    = NOW();
```

---

# SECTION 9: AI TELEMETRY ARCHITECTURE

---

## 9.1 AI Telemetry Design Principles

AI telemetry is distinct from operational telemetry in a critical way: **it must capture not just what happened, but why AI made the decision it made**. This requires preserving:

1. The **feature values** used as input to an inference (the "why")
2. The **model identity and version** that produced the output (the "who")
3. The **prediction output and confidence** (the "what")
4. The **eventual ground truth** (the "was it right?") — critical for model evaluation

Without all four, AI telemetry is incomplete and models cannot be properly evaluated, improved, or audited.

---

## 9.2 The AI Telemetry Event Pipeline

```
AI TELEMETRY PIPELINE:

SOURCE EVENTS (from operational domains):
  attendance.daily.processed
  employee.transferred
  leave.balance.updated
  payroll.run.disbursed
  employee.exited               ← ground truth for attrition model
  ...
      ↓
AI FEATURE PIPELINE (AI Intelligence Domain):
  FeaturePipelineConsumer
    → Receives all relevant operational events
    → Computes feature vectors per employee
    → Persists to Feature Store
    → Emits: ai.feature.vector.updated
      ↓
AI INFERENCE ENGINE:
  PredictionOrchestrationService
    → Reads feature vectors from Feature Store
    → Calls model inference endpoint
    → Persists predictions to PredictionStore
    → Emits: ai.prediction.{use_case}.generated
      ↓
AI RECOMMENDATION PUBLISHER:
  → Reads high-confidence predictions
  → Emits: ai.recommendation.published
    → Consumed by: operational domains + notification consumers
      ↓
MODEL EVALUATION LOOP:
  → Receives: employee.exited (ground truth for attrition model)
  → Matches against ai.prediction.attrition_risk.generated (30/60/90d prior)
  → Computes: was prediction correct?
  → Emits: ai.model.evaluation.recorded
    → Feeds: ModelMonitoringService
      → Emits: ai.model.drift_detected (if accuracy degrades)
        → Triggers: retraining pipeline
```

---

## 9.3 Feature Vector Events

### `ai.feature.vector.updated`

```json
{
  "event_type":    "ai.feature.vector.updated",
  "event_version": 1,
  "event_category": "ai_telemetry",
  "payload": {
    "feature_record_id":  "feat_emp_7f3a9b2c_20260509",
    "employee_id":        "emp_7f3a9b2c-...",
    "model_use_case":     "attrition_risk",
    "feature_date":       "2026-05-09",
    "trigger_event_id":   "evt_01JK4X2N8P7QR3STUVWXYZ12AB",
    "trigger_event_type": "attendance.daily.processed",
    "features": {
      "tenure_days":                     482,
      "months_since_last_increment":     18,
      "grade_code":                      "L4",
      "manager_changes_12mo":            2,
      "transfers_24mo":                  1,
      "compensation_percentile_band":    0.28,
      "attendance_rate_30d":             0.83,
      "attendance_rate_90d":             0.87,
      "late_instances_30d":              4,
      "sick_leave_days_90d":             6,
      "annual_leave_utilization_ytd":    0.35,
      "ot_hours_avg_30d":                2.1,
      "peer_group_attrition_rate_90d":   0.08,
      "manager_attrition_flag":          false,
      "department_headcount_delta_90d":  -0.12,
      "days_since_last_performance_review": 210,
      "last_performance_rating_normalized": 0.68
    },
    "feature_version":    "v3.2",
    "computed_at":        "2026-05-09T15:00:00Z"
  }
}
```

**Note on PII:** Feature vectors MUST NOT contain PII (name, contact details, national ID). Only opaque identifiers (`employee_id` UUID) and numerical/categorical features. The Analytics and AI domains never store identifying PII — only the Employee domain does.

---

## 9.4 Prediction Lifecycle Events

### `ai.prediction.attrition_risk.generated`
*(Full schema in Section 3 — EVT-AI-001)*

### `ai.prediction.absence.generated`

```json
{
  "event_type": "ai.prediction.absence.generated",
  "payload": {
    "prediction_id":      "pred_abs_20260510_emp_7f3a9b2c",
    "employee_id":        "emp_7f3a9b2c-...",
    "prediction_date":    "2026-05-09",
    "predicted_for_date": "2026-05-10",
    "absence_probability": 0.73,
    "absence_predicted":  true,
    "model_id":           "model_absence_pred_v2_1",
    "confidence":         0.81,
    "top_signals": [
      {"signal": "absent_same_weekday_historical_rate", "value": 0.67},
      {"signal": "sick_leave_last_7_days",              "value": 3},
      {"signal": "monday_absence_rate_12mo",            "value": 0.52}
    ]
  }
}
```

### `ai.recommendation.published`

```json
{
  "event_type":    "ai.recommendation.published",
  "event_version": 1,
  "payload": {
    "recommendation_id":     "rec_20260509_emp_7f3a9b2c_001",
    "recommendation_type":   "attrition_intervention",
    "target_domain":         "employee",
    "target_entity_type":    "employee",
    "target_entity_id":      "emp_7f3a9b2c-...",
    "addressee_type":        "hr_business_partner",
    "addressee_scope":       "unit_engineering_backend",
    "source_prediction_id":  "pred_att_risk_20260509_emp_7f3a9b2c",
    "priority":              "high",
    "recommendation": {
      "action_type":         "schedule_retention_conversation",
      "reason_summary":      "High attrition risk (82%) — 18 months no increment, 2 manager changes",
      "suggested_actions": [
        "Schedule 1:1 career conversation within 2 weeks",
        "Review compensation vs. market benchmark",
        "Explore internal mobility opportunity"
      ],
      "time_sensitivity":    "within_30_days"
    },
    "expires_at":            "2026-06-09T00:00:00Z",
    "requires_human_action": true
  }
}
```

---

## 9.5 Model Evaluation Events

### `ai.model.evaluation.recorded`

```json
{
  "event_type": "ai.model.evaluation.recorded",
  "payload": {
    "evaluation_id":       "eval_20260509_attrition_v3_2_batch",
    "model_id":            "model_attrition_v3_2",
    "model_version":       "3.2.1",
    "evaluation_window": {
      "prediction_start":  "2026-02-08",
      "prediction_end":    "2026-05-08",
      "outcome_observed_through": "2026-05-09"
    },
    "cohort_size":         1247,
    "metrics": {
      "precision":         0.71,
      "recall":            0.63,
      "f1_score":          0.67,
      "auc_roc":           0.81,
      "true_positives":    28,
      "false_positives":   11,
      "false_negatives":   16,
      "true_negatives":    1192
    },
    "benchmark_metrics": {
      "precision_target":  0.65,
      "recall_target":     0.60
    },
    "meets_benchmark":     true,
    "evaluated_by":        "model_monitoring_service"
  }
}
```

### `ai.model.drift_detected`

```json
{
  "event_type": "ai.model.drift_detected",
  "payload": {
    "model_id":            "model_attrition_v3_2",
    "drift_type":          "performance_degradation",
    "detection_method":    "rolling_30d_precision",
    "current_metric": {
      "metric":            "precision",
      "value":             0.51
    },
    "threshold": {
      "metric":            "precision",
      "alert_threshold":   0.55
    },
    "recommendation":      "trigger_retraining_pipeline",
    "severity":            "high",
    "detected_at":         "2026-05-09T06:00:00Z"
  }
}
```

---

## 9.6 How Operational Events Feed AI

```
OPERATIONAL EVENT → AI FEATURE MAPPING TABLE:

Domain Event                  │ AI Use Case            │ Feature(s) Updated
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
attendance.daily.processed    │ Attrition Risk         │ attendance_rate_30d/90d, late_count
                              │ Absence Prediction     │ weekday_absence_pattern, ot_hours
                              │ OT Anomaly Detection   │ ot_hours_rolling_avg
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
employee.transferred          │ Attrition Risk         │ transfers_24mo, manager_changes_12mo
org.reporting.changed         │ Attrition Risk         │ manager_changes_12mo (highest weight)
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
leave.balance.updated         │ Attrition Risk         │ annual_leave_utilization_ytd
leave.application.approved    │ Absence Prediction     │ upcoming_leave_days (deterministic)
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
payroll.run.disbursed         │ Payroll Anomaly        │ gross_pay_rolling_avg (baseline)
payroll.anomaly.detected      │ Payroll Anomaly        │ anomaly_history_flag
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
employee.exited               │ Attrition Risk         │ GROUND TRUTH LABEL
  (exit_type = resignation)   │                        │ (validates/invalidates predictions)
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
workflow.sla.breached         │ Workflow Intelligence  │ approval_delay_pattern
workflow.instance.completed   │ Workflow Intelligence  │ approval_velocity_baseline
──────────────────────────────┼────────────────────────┼─────────────────────────────────────
roster.published              │ Absence Prediction     │ scheduled_shifts (roster coverage)
compliance.violation.detected │ Compliance Risk        │ violation_history_flag
```

---

## 9.7 Copilot Telemetry

Every AI copilot interaction generates telemetry events for cost management, quality monitoring, and safety auditing:

```json
{
  "event_type": "ai.copilot.turn.completed",
  "event_category": "ai_telemetry",
  "payload": {
    "session_id":            "copilot_sess_usr_mgr_001_20260509",
    "turn_id":               "turn_014",
    "user_id":               "usr_manager_001",
    "tenant_id":             "ten_ACME_GLOBAL_001",
    "workspace_context":     "attendance",
    "query_intent_classified": "data_query",
    "tools_invoked": [
      {"tool": "analytics_query", "latency_ms": 312, "records_returned": 23},
      {"tool": "employee_lookup", "latency_ms": 45, "records_returned": 7}
    ],
    "llm_call": {
      "model":               "claude-opus-4",
      "input_tokens":        2341,
      "output_tokens":       287,
      "latency_ms":          1490,
      "cache_hit":           true
    },
    "total_latency_ms":      1847,
    "permission_checks_passed": true,
    "pii_detected_in_output": false,
    "safety_flags":          [],
    "user_feedback":         null
  }
}
```

**Aggregated telemetry monitored:**
- Cost per session, cost per user, cost per tenant
- P50/P95/P99 response latency by intent type
- Tool invocation failure rates
- PII detection rate in outputs (safety audit)
- Safety flag rate (hallucination / inappropriate content detection)




---


# SECTION 10: REAL-TIME OPERATIONAL EVENT STRATEGY

---

## 10.1 Real-Time Event Delivery Architecture

Real-time operational events serve a distinct purpose from analytical events: they drive **live UI updates, operational alerts, and mobile synchronization** — requiring delivery latencies measured in seconds, not minutes.

```
REAL-TIME EVENT DELIVERY LAYERS:

Layer 1: Event Bus → Supabase Realtime (WebSocket push)
  Use case: Live dashboard updates, manager workspace attendance view
  Latency target: < 3 seconds end-to-end (event emission → UI update)
  Technology: Supabase Realtime (Postgres LISTEN/NOTIFY → WebSocket push)
  
Layer 2: Event Bus → Server-Sent Events (SSE)
  Use case: Notification inbox live updates, operational alert banners
  Latency target: < 5 seconds
  Technology: SSE endpoint subscribed to Notification domain events
  
Layer 3: Event Bus → Push Notification Gateway
  Use case: Mobile app push notifications (leave approvals, payslip available)
  Latency target: < 30 seconds
  Technology: FCM (Android) + APNS (iOS) via Notifications domain
  
Layer 4: Event Bus → WebSocket Direct
  Use case: Mobile offline sync, real-time roster changes, roster acknowledgment
  Latency target: < 2 seconds (when online)
  Technology: WebSocket connection per mobile session
```

---

## 10.2 Live Attendance Dashboard Events

The live attendance dashboard is the highest-value real-time use case — operations managers need second-by-second visibility into who is present on the floor.

```
LIVE ATTENDANCE DASHBOARD EVENT FLOW:

Employee punches in at biometric device
  ↓
attendance.punched event → event bus
  ↓
RealTimeDashboardConsumer (subscribes to attendance.punched):
  1. Reads employee's unit from Employee projection
  2. Increments rt_attendance_summary.present_count WHERE unit_id = X, date = today
  3. Postgres NOTIFY sent automatically by Supabase on table change
  ↓
Supabase Realtime detects row change in rt_attendance_summary
  ↓
WebSocket push to all subscribed dashboard clients for this tenant/unit
  ↓
Dashboard widget updates: "Present: 47/52 (90%)"

Subscription filter (Supabase Realtime):
  Channel: attendance:{tenant_id}:{unit_id}
  Table: rt_attendance_summary
  Filter: tenant_id=eq.{tenant_id} AND unit_id=eq.{unit_id}

Dashboard latency budget:
  attendance.punched emission: 0ms
  Event bus processing: ~50ms
  rt_attendance_summary update: ~80ms
  Postgres NOTIFY: ~10ms
  Supabase Realtime push: ~200ms
  Network to browser: ~50ms
  Total: ~390ms → rounds to < 1 second ✓
```

---

## 10.3 Operational Alert Events

Operational alerts are generated by domain logic detecting conditions requiring immediate human attention. These flow through a dedicated alert channel separate from regular event processing:

```
OPERATIONAL ALERT EVENT SCHEMA:

{
  "event_type": "operational.alert.raised",
  "payload": {
    "alert_id":        "alert_20260509_001",
    "alert_type":      "attendance_anomaly",
    "severity":        "warning",
    "source_domain":   "attendance",
    "source_event_id": "evt_01JK...",
    "affected_entity": {
      "entity_type":   "employee",
      "entity_id":     "emp_7f3a9b2c-...",
      "display_name":  "[RESOLVED AT DISPLAY TIME - not stored]"
    },
    "alert_message":   "Employee absent without leave or justification (3rd occurrence this month)",
    "action_required": true,
    "suggested_action":"Review attendance and contact employee",
    "addressee": {
      "role":          "line_manager",
      "manager_id":    "emp_manager_789"
    },
    "expires_at":      "2026-05-09T23:59:59Z",
    "auto_resolved":   false
  }
}

Alert Severity Levels:
  CRITICAL: Payroll anomaly blocking disbursement, compliance violation
    → Immediate push notification + email + in-app alert banner
    → Escalation after 30 minutes if unacknowledged
    
  WARNING: Attendance anomaly, roster coverage gap, SLA breach
    → In-app alert + email
    → Escalation after 4 hours if unacknowledged
    
  INFO: Policy activation reminder, upcoming leave, shift change
    → In-app notification only
    → No escalation
```

---

## 10.4 Mobile Synchronization Events

The Mobile Workforce domain requires a specialized event handling pattern for **offline-first mobile clients**:

```
MOBILE SYNC EVENT ARCHITECTURE:

ONLINE SCENARIO:
  Employee action on mobile → API call → Domain processes → Event emitted
  Event → Mobile Sync Consumer → Push to employee's WebSocket connection
  Mobile client receives real-time confirmation

OFFLINE SCENARIO:
  Employee action on mobile → Queued locally in mobile client (SQLite)
  Mobile client reconnects → Sync API called
  Sync API: replays queued actions with original timestamps
  Domain processes each action → Events emitted with mobile_metadata.offline_flag = true
  
Mobile-specific events:

"mobile.session.sync_completed":
  {
    "device_id":           "device_fingerprint_hash",
    "employee_id":         "emp_7f3a9b2c-...",
    "sync_start":          "2026-05-09T08:30:00Z",
    "sync_end":            "2026-05-09T09:15:00Z",
    "events_replayed":     3,
    "events_accepted":     3,
    "events_rejected":     0,
    "offline_duration_minutes": 45,
    "sync_conflicts":      0
  }

"mobile.punch.offline_replayed":
  {
    "original_timestamp":  "2026-05-09T08:32:41Z",
    "replayed_at":         "2026-05-09T09:15:03Z",
    "punch_type":          "in",
    "offline_duration_minutes": 43,
    "geo_captured_offline": true,
    "conflict_resolution": null
  }

Conflict Resolution Strategy:
  Conflict: Employee's offline punch timestamp overlaps with existing record
  Rule: Offline punch accepted if within 4-hour window of offline start
  Rule: Punch rejected if timestamp is implausible (future-dated, >8h gap)
  Result: Generates attendance.regularization.submitted automatically for HR review
```

---

## 10.5 Notification Event Dispatch Strategy

```
NOTIFICATION DISPATCH PIPELINE:

Trigger: domain event received (e.g., leave.application.approved)
  ↓
NotificationTriggerConsumer:
  1. Lookup: notification template for event_type "leave.application.approved"
  2. Lookup: recipient employee's notification preferences
  3. Lookup: employee's preferred channels (email, SMS, push, in-app)
  4. Assemble: notification content from template + event payload data
  5. Dispatch: to each active channel
  ↓
For each channel:
  IN_APP: INSERT into notifications.inbox_items → Supabase Realtime push
  EMAIL:  Enqueue to email dispatch worker → SendGrid/SES
  PUSH:   Enqueue to push gateway → FCM/APNS
  SMS:    Enqueue to SMS gateway → Twilio/Vonage

Per-dispatch events emitted:
  notification.email.dispatched {message_id, recipient, template_id, dispatched_at}
  notification.push.delivered   {message_id, device_id, delivered_at}
  notification.sms.failed       {message_id, recipient_hash, failure_reason, attempt}

Notification Preference Schema (per employee):
  {
    "employee_id": "emp_7f3a9b2c-...",
    "channels": {
      "leave_approval":   ["in_app", "push"],
      "payslip_ready":    ["in_app", "email", "push"],
      "roster_published": ["push"],
      "compliance_alert": ["in_app", "email"],
      "system_message":   ["in_app"]
    },
    "quiet_hours": {"start": "22:00", "end": "08:00", "timezone": "Asia/Singapore"},
    "language":    "en"
  }
```

---

# SECTION 11: EVENT SECURITY & GOVERNANCE

---

## 11.1 Tenant Isolation at the Event Layer

Tenant isolation is the most critical security property of the event platform. A breach of tenant isolation — where Tenant A's events are delivered to or readable by Tenant B's consumers — is a catastrophic security failure.

```
TENANT ISOLATION ENFORCEMENT LAYERS:

Layer 1: Outbox relay validation
  BEFORE publishing any event:
  → Validate tenant_id in event envelope against originating domain's DB connection tenant scope
  → If mismatch: block publication, raise security.event.tenant_mismatch_detected alert

Layer 2: Event bus routing
  Phase 1 (in-process): consumer handlers receive all events;
    consumers MUST validate tenant_id before processing (enforced by framework base class)
  Phase 2 (Redis): stream per tenant for isolated consumers OR
    shared stream with mandatory tenant filter in consumer GROUP filter
  Phase 3 (Kafka): partition by tenant_id where possible;
    consumer applications validate tenant_id before ANY business processing

Layer 3: Consumer framework enforcement
  All consumer base classes validate:
    if event.tenant_id not in consumer.allowed_tenant_ids:
      log security alert
      skip event
      increment security.tenant_isolation_violation counter

Layer 4: Event store query isolation
  All event store queries require tenant_id predicate:
  SELECT * FROM platform.event_store
  WHERE tenant_id = $1  -- MANDATORY — no unbounded queries permitted
    AND event_type = $2

Layer 5: Audit of cross-tenant access attempts
  Any attempt to query events across tenant boundaries:
  → Logged as security.event.cross_tenant_access_attempt
  → Alert to security team
  → Automatic throttle on requesting actor
```

---

## 11.2 PII Handling in Events

```
PII IN EVENTS — GOVERNING RULES:

Rule 1: PII MINIMIZATION
  Event payloads contain the MINIMUM PII necessary for consumers to function.
  If a consumer only needs employee_id (an opaque UUID), the event MUST NOT
  include name, email, or any other identifying fields.
  
  WRONG: {employee_id: "...", employee_name: "John Smith", email: "j.smith@co.com"}
  RIGHT: {employee_id: "...", unit_id: "...", grade_code: "L4"}
  Consumers resolve display names at query time from Employee domain API (access-controlled).

Rule 2: PII CLASSIFICATION IN ENVELOPE
  When PII is legitimately present in payload (e.g., payslip generation events):
  data_classification: {
    pii_present: true,
    pii_fields: ["payload.bank_account_hash", "payload.national_id_masked"],
    sensitivity_level: "restricted"
  }

Rule 3: PII MASKING IN LOGS
  Event envelopes logged for debugging MUST have PII fields masked:
  Before logging: mask_pii_fields(event, pii_field_paths) → masked_event
  Log: masked_event (PII fields replaced with "[MASKED]")
  Never log raw PII to any log aggregation system (Datadog, Splunk, etc.)

Rule 4: PSEUDONYMIZATION IN ANALYTICS EVENTS
  Analytics events use employee_id (UUID — pseudonymous) not employee name
  AI telemetry events use employee_id (UUID) — never name or contact
  In the event of GDPR erasure request:
    → Pseudonymize employee_id in analytics events: replace with anon_id
    → Event content preserved (for aggregate analytics); individual identity severed

Rule 5: RESTRICTED EVENTS REQUIRE ENCRYPTED PAYLOADS
  Events with sensitivity_level = "restricted" (payroll data, disciplinary records):
  → Payload encrypted using tenant's event encryption key (AES-256-GCM)
  → Encrypted at: outbox insertion
  → Decrypted by: only authorized domain consumers with key access
  → Key management: HashiCorp Vault or AWS KMS per tenant

PII Fields Reference — Events by Classification:
  INTERNAL events: employee_id (UUID), unit_id, grade_code, dates
  CONFIDENTIAL events: job_title, grade_band, manager_id, employment_type
  RESTRICTED events: gross_pay, net_pay, bank_account_hash, disciplinary notes
```

---

## 11.3 Event Encryption

```
ENCRYPTION STRATEGY:

TRANSPORT ENCRYPTION (all events):
  TLS 1.3 minimum for all event bus connections
  mTLS for service-to-service event consumers in Phase 3+
  TLS termination at API gateway; internal traffic TLS-optional (Phase 1-2)

PAYLOAD ENCRYPTION (restricted events only):
  Algorithm: AES-256-GCM (authenticated encryption)
  Key: Per-tenant symmetric key stored in Vault/KMS
  Implementation:
    1. Domain emits event with plaintext restricted payload
    2. Outbox relay detects sensitivity_level = "restricted"
    3. Relay encrypts payload using tenant's event key from cache
    4. Encrypted envelope stored in event store and forwarded to bus
    5. Authorized consumer fetches key from Vault → decrypts payload
    6. Non-authorized consumers receive encrypted blob they cannot decrypt
  
  Key rotation: 90 days (automatic; old key retained for historical event decryption)
  Key compromise: immediate rotation; all consumers re-fetch key on next use

EVENT SIGNING (audit events, compliance events):
  Algorithm: HMAC-SHA256 with platform-level signing key
  Purpose: Tamper evidence for compliance audit
  Fields signed: event_id + occurred_at + aggregate_id + payload_hash
  Verification: Audit domain verifies signature on receipt and at query time
  
  Tamper detection: scheduled integrity job re-verifies stored event signatures
  Alert: any signature mismatch → security.event.integrity_violation alert (P1)
```

---

## 11.4 Event Access Controls

```
EVENT ACCESS CONTROL MATRIX:

QUERY ACCESS (event store queries):
  Role                  │ Can Query Which Events
  ──────────────────────┼────────────────────────────────────────────────
  employee              │ Own events only (own employee_id in aggregate_id)
  line_manager          │ Own + direct reports' operational events (not payroll)
  hr_admin              │ All employee operational events in own tenant
  payroll_admin         │ Payroll events for assigned employee groups
  compliance_officer    │ All events (read-only, for statutory reporting)
  super_admin           │ All events in tenant (audit trail queries)
  platform_engineer     │ System events + specific troubleshooting scope (time-limited)
  external_auditor      │ Exported audit subset only (no live query access)

REPLAY PERMISSIONS:
  Domain engineer:      Can replay events from their own domain's DLQ
  Platform engineer:    Can replay any event with documented justification
  Requires:             Dual authorization for payroll or compliance events
  Audit:                All replay operations logged as security.event.replayed

STREAM SUBSCRIPTION PERMISSIONS:
  Consumer registration requires:
  1. Domain team approval (owning domain approves new consumers)
  2. Security review for PII-containing event types
  3. Rate limiting configuration per consumer
  4. Tenant scope declaration
```

---

## 11.5 Event Retention Governance

```
RETENTION ENFORCEMENT:

Retention classes and their policies:
  ┌──────────────────────┬──────────┬────────────────────────────────────┐
  │ Class                │ Retain   │ Action After Retention              │
  ├──────────────────────┼──────────┼────────────────────────────────────┤
  │ employment_record    │ 7 years  │ Pseudonymize PII → archive to S3   │
  │ statutory_financial  │ 7 years  │ Archive to cold storage (WORM)     │
  │ audit_compliance     │ 10 years │ Archive to cold storage (WORM)     │
  │ security_access      │ 7 years  │ Archive to cold storage            │
  │ ai_training_data     │ 3 years  │ Delete (or pseudonymize for archive)│
  │ operational          │ 2 years  │ Delete                             │
  │ analytics_telemetry  │ 90 days  │ Delete                             │
  └──────────────────────┴──────────┴────────────────────────────────────┘

WORM (Write Once Read Many) Archive:
  Events with legal hold must not be deletable even by platform admins
  Implementation: S3 Object Lock (compliance mode) for statutory financial events
  
GDPR ERASURE:
  On erasure request for employee_id = X:
  1. Pseudonymize: Replace employee_id X with anon_id_HASH in event store
     (cannot delete events — they are historical facts that may be required for audit)
  2. Purge: Delete event payloads that contain PII fields for this employee
  3. Retain: Non-PII event metadata (event_id, event_type, occurred_at, aggregate_id_pseudonymized)
  4. Document: Record erasure event in privacy.erasure.completed log
  
  Note: Regulatory legal hold takes precedence over GDPR erasure requests
  (statutory employment records may be retained even when individual requests deletion)
```

---

# SECTION 12: OBSERVABILITY & TRACEABILITY

---

## 12.1 Distributed Tracing Architecture

Every operation in the platform — from API request through domain processing through event publication and consumer handling — participates in a unified distributed trace using **OpenTelemetry W3C Trace Context**.

```
DISTRIBUTED TRACE FLOW:

API Request arrives (POST /leave/applications):
  ↓
API Gateway: generates TraceContext {trace_id, span_id}
  ↓ (propagated via HTTP headers: traceparent: 00-{trace_id}-{span_id}-01)
  ↓
Leave Domain: creates child span, processes LeaveApplication
  ↓ Span: "leave.application.create" (duration: 45ms)
  ↓
Outbox INSERT: span attribute {outbox_id, event_id}
  ↓
API Response returned to client: 201 Created
  ↓ (spans completed up to here — next spans are async)
  ↓
[ASYNC] Outbox Relay: new trace span "outbox.relay.publish"
  → Inherits correlation via event envelope trace context (not HTTP)
  ↓
[ASYNC] Analytics Consumer: new span "analytics.attendance.project"
  → Parent: outbox.relay.publish span_id
  ↓
[ASYNC] Audit Consumer: new span "audit.record.write"
  ↓
[ASYNC] Notification Consumer: new span "notification.dispatch"

Full trace in Jaeger/Tempo shows:
  leave.application.create [45ms]
  └── outbox.relay.publish [12ms]
      ├── analytics.attendance.project [234ms]  ← async fan-out
      ├── audit.record.write [18ms]
      └── notification.dispatch [156ms]

Cross-event trace propagation:
  Event envelope trace field carries {trace_id, span_id} from producer
  Consumers create child spans using this as parent
  → Full causal chain traceable across all async hops
```

---

## 12.2 Correlation and Causation Tracking

```
THREE LEVELS OF EVENT LINKAGE:

1. CORRELATION_ID — Business operation grouping
   All events produced during a single business operation share correlation_id
   Examples:
     • All events from a single payroll run: correlation_id = "payroll_run_{run_id}"
     • All events from employee onboarding: correlation_id = "onboarding_{employee_id}"
     • All events from a leave approval chain: correlation_id = "leave_req_{application_id}"
   
   Query: "Show all events related to payroll run PR-2026-05"
   → SELECT * FROM event_store WHERE correlation_id = 'payroll_run_pr_run_202605_regular_001'
   → Returns: payroll.run.initiated, payroll.run.computed, payroll.run.approved,
              payroll.run.disbursed, 1247x payroll.payslip.generated,
              notification.email.dispatched × 1247

2. CAUSATION_ID — Direct causal relationship
   Points to the event_id that directly caused this event
   Examples:
     workflow.instance.completed → causes → leave.application.approved
     leave.application.approved → causes → notification.email.dispatched
     leave.application.approved → causes → attendance.daily.updated (linked)
   
   Causal chain reconstruction:
   START: leave.application.submitted (causation_id: null — user action)
   → workflow.instance.created (causation_id: leave.application.submitted.event_id)
   → workflow.task.assigned (causation_id: workflow.instance.created.event_id)
   → workflow.task.completed (causation_id: workflow.task.assigned.event_id)
   → workflow.instance.completed (causation_id: workflow.task.completed.event_id)
   → leave.application.approved (causation_id: workflow.instance.completed.event_id)
   → notification.email.dispatched (causation_id: leave.application.approved.event_id)

3. TRACE CONTEXT — Distributed system span hierarchy
   W3C Trace Context for cross-service span parenting
   Lower level than business correlation — infrastructure concern
```

---

## 12.3 Event Lineage Dashboard

The platform maintains a queryable **Event Lineage Graph** for debugging, audit, and incident investigation:

```
LINEAGE QUERY EXAMPLES:

Query 1: "Why did this payslip show a lower amount than last month?"
  Input: payslip_id = "payslip_emp_7f3a9b2c_202605"
  
  Lineage graph:
  payroll.payslip.generated ← payroll.run.disbursed ← payroll.run.approved
  ← payroll.run.computed
  ← attendance.cycle.finalized (emp_7f3a9b2c, 2026-05) ← attendance.daily.processed × 22
  └─ attendance.regularization.rejected (2026-05-07) ← workflow.instance.completed (rejected)
  
  Answer: Attendance regularization for May 7 was rejected → LOP day applied → ₹1,100 deduction

Query 2: "Who changed the overtime policy and when did it take effect?"
  Input: policy_code = "ATT_OVERTIME_RULES", tenant = ACME
  
  Lineage:
  policy.activated (v2.1, effective: 2026-06-01, activated_by: usr_hr_director_001)
  ← policy.approved_for_activation (approved_by: usr_compliance_001)
  ← policy.simulation.completed (sim_20260501_ot_impact)
  
  Answer: HR Director activated on 2026-05-15, effective 2026-06-01. Compliance Officer approved.

Query 3: "Trace all side effects of this employee.created event"
  Input: event_id = "evt_01JK4X2N8P7QR3STUVWXYZ12AB" (employee.created)
  
  Lineage (downstream causation tree):
  employee.created
  ├── iam.user.provisioned (causation: employee.created)
  ├── leave.balance.initialized × 6 (causation: employee.created)
  │   └── notification.email.dispatched "Welcome + Leave Policy" (causation: leave.balance.initialized)
  ├── attendance.cycle.created (causation: employee.created)
  ├── payroll.employee.enrolled (causation: employee.created)
  └── notification.email.dispatched "Welcome to ACME" (causation: employee.created)
```

---

## 12.4 Event Platform Monitoring

```
KEY METRICS TO MONITOR (with alert thresholds):

OUTBOX HEALTH:
  outbox_queue_depth{domain, tenant}
    Warning: >1,000   Critical: >10,000   — indicates processing backlog
  
  outbox_relay_lag_seconds{domain}
    Warning: >30s     Critical: >300s     — time since oldest unpublished event
  
  outbox_failed_events_total{domain, event_type}
    Warning: >10/hour Critical: >50/hour  — retry failures accumulating
  
  outbox_dlq_depth{domain}
    Warning: >0 (Critical category)       — any DLQ entry requires attention
    Warning: >10 (High category)

CONSUMER HEALTH:
  consumer_processing_latency_p95{consumer_group, event_type}
    Warning: >5s   Critical: >30s         — consumer falling behind
  
  consumer_error_rate{consumer_group, event_type}
    Warning: >1%   Critical: >5%           — systematic processing failures
  
  consumer_lag{consumer_group, topic}      (Phase 3 — Kafka metrics)
    Warning: >10,000 messages
    Critical: >100,000 messages

EVENT PLATFORM HEALTH:
  events_published_per_minute{domain, event_type}
    Alert on: >50% deviation from 7-day rolling average (unexpected spike or drop)
  
  event_end_to_end_latency_p95{event_type}
    Warning: >60s   Critical: >300s        — event published but not consumed
  
  event_store_write_latency_p99
    Warning: >100ms Critical: >500ms       — event store under pressure

REAL-TIME DASHBOARD HEALTH:
  rt_summary_update_latency_p95
    Target: <3s    Warning: >5s   Critical: >30s

TENANT-LEVEL MONITORING:
  events_per_tenant_per_minute                 — detect runaway event loops
  tenant_isolation_violation_total             — MUST be 0 always; any value → P1 alert
```

---

## 12.5 Event Replay Observability

```
REPLAY OPERATION TRACKING:

Every replay operation is logged as a first-class operational event:

"platform.event.replay.initiated":
  {
    "replay_id":          "replay_20260510_attendance_dlq_001",
    "initiated_by":       "usr_engineer_001",
    "reason":             "dlq_resolution_after_consumer_bug_fix",
    "scope": {
      "domain":           "attendance",
      "event_types":      ["attendance.daily.processed"],
      "tenant_id":        "ten_ACME_GLOBAL_001",
      "time_range": {"start": "2026-05-09T00:00:00Z", "end": "2026-05-09T23:59:59Z"}
    },
    "event_count":        1247,
    "consumer_target":    "analytics-consumer",
    "approved_by":        "usr_lead_engineer_001"
  }

"platform.event.replay.completed":
  {
    "replay_id":          "replay_20260510_attendance_dlq_001",
    "events_replayed":    1247,
    "events_succeeded":   1247,
    "events_failed":      0,
    "duration_seconds":   342,
    "idempotency_skips":  0  -- how many were already processed (no effect)
  }

Dashboard: Live replay progress (events replayed / total, estimated time remaining)
Alert: If replay failure rate > 5% → pause replay + alert engineer
```




---


# SECTION 13: EXISTING SYSTEM MIGRATION STRATEGY

---

## 13.0 Governing Principle

> The existing system contains real operational knowledge — battle-tested business rules, proven processing pipelines, and carefully calibrated edge case handling. The migration strategy must **extract and preserve this knowledge** while introducing the event-driven envelope around it. No destructive rewrites. No "start from scratch." Wrap, evolve, and verify at every step.

---

## 13.1 Current System Event Landscape Analysis

Before designing the migration, we must understand what the current system already does (even if informally) that maps to event-driven concepts:

```
CURRENT SYSTEM EVENT EQUIVALENTS:

What the current system HAS (informally):

  "Events" as database triggers:
    - After attendance record insert → trigger sends email notification
    - After leave approval update → trigger inserts notification record
    - After payroll run completion → trigger updates status table
    Problem: Database triggers are hidden, unversioned, untestable, and non-observable

  "Events" as synchronous function calls:
    - LeaveService.approve() calls NotificationService.sendApprovalEmail()
    - AttendanceService.process() calls AnalyticsService.updateDashboard()
    Problem: Tight coupling, blocking, no retry, no audit trail

  "Events" as polling-based jobs:
    - Cron job polls attendance table for unprocessed records → processes them
    - Cron job polls leave applications for pending workflows → routes approvals
    Problem: High latency (cron interval), poor observability, noisy resource usage

  "Events" as webhook calls (if external integrations exist):
    - Biometric device posts raw punch to attendance API
    - ERP receives payroll summary via HTTP POST after run completes
    Problem: Point-to-point coupling, no persistence, no retry guarantee

The migration converts all of these into: domain events, outbox-backed, versioned, auditable.
```

---

## 13.2 Module-by-Module Migration Plan

### MODULE A: Attendance Engine

**Current state:** Cron-based processing pipeline. Attendance records inserted by device integration layer. Cron job runs every 5 minutes to process new punches.

**Migration approach: REFACTOR (not rebuild)**

```
PHASE A1 — Introduce outbox without changing processing logic:
  Timeline: Week 1–2
  Change: After punch record INSERT, also INSERT to attendance.outbox
  Change: After daily processing UPDATE, also INSERT attendance.daily.processed event
  Zero behavior change: cron still runs; downstream still works
  Validate: Verify outbox records match actual processing state
  Risk: LOW

PHASE A2 — Introduce in-process event bus consumers:
  Timeline: Week 3–4
  Change: Register analytics consumer for attendance.daily.processed
  Change: Analytics consumer replaces direct SQL query in analytics jobs
  Validate: Parallel run — compare analytics values between old query and new consumer
  Switch: After 1 week parallel validation, switch analytics to event-based
  Risk: LOW-MEDIUM (analytics accuracy validation required)

PHASE A3 — Replace notification triggers with event consumers:
  Timeline: Week 5–6
  Change: Register notification consumer for attendance.daily.processed
  Change: Notification consumer replaces database trigger that sent absence alerts
  Validate: Verify notification delivery matches previous behavior
  Decommission: Remove database trigger
  Risk: LOW

PHASE A4 — Replace polling with event-driven processing trigger:
  Timeline: Week 7–8
  Change: Cron job replaced by event consumer on attendance.punched
  Change: Each attendance.punched event triggers processing job
  Validate: Processing latency improvement verified (near-real-time vs. 5-min poll)
  Risk: MEDIUM (processing logic unchanged, but trigger mechanism changes)

Preserved throughout:
  ✓ All punch deduplication logic
  ✓ All shift-matching computation
  ✓ All OT computation rules
  ✓ All grace period application
  ✓ All regularization handling
  ✗ ONLY: trigger mechanism and downstream delivery changed
```

### MODULE B: Leave Engine

**Current state:** Synchronous approval flow. LeaveService directly calls WorkflowService. WorkflowService directly calls NotificationService. Leave status updates happen inline.

**Migration approach: REFACTOR**

```
PHASE B1 — Introduce leave events without changing workflow:
  Timeline: Week 2–3 (parallel to A1)
  Change: After each leave state change (submit/approve/reject),
          INSERT to leave.outbox in same transaction
  Zero behavior change: synchronous flow still works
  Validate: All leave state transitions produce correct outbox events
  Risk: LOW

PHASE B2 — Decouple notification from synchronous flow:
  Timeline: Week 5–6
  Change: Remove direct call to NotificationService from LeaveService
  Change: Register notification consumer for leave.application.approved/rejected
  Validate: Notification timing acceptable (slight increase — async delivery)
  Risk: LOW (notifications are best-effort; slight delay acceptable)

PHASE B3 — Decouple workflow from synchronous approval:
  Timeline: Week 7–10 (requires Workflow domain refactoring first)
  Change: LeaveService submits to WorkflowDomain API → receives workflow_instance_id
  Change: LeaveService registers consumer for workflow.instance.completed
  Change: On receiving workflow.instance.completed with entity_type=leave_application,
          LeaveService executes approval/rejection business logic
  Validate: Approval end-to-end flow produces same outcomes; SLA timing maintained
  Risk: MEDIUM (this changes the synchronous approval into async — requires 
        careful validation of edge cases: concurrent approvals, recall scenarios)

Preserved:
  ✓ Balance reservation-on-submit logic
  ✓ Balance deduction-on-approval logic
  ✓ Carry-forward computation
  ✓ Accrual rules
  ✓ All entitlement calculations
```

### MODULE C: Payroll Engine

**Current state:** Monthly batch job. Reads attendance from attendance tables, leave from leave tables, pay structures from payroll config tables. Produces payslips. Calls bank file generator. Sends notification.

**Migration approach: REFACTOR + SPLIT (most complex)**

```
PHASE C1 — Introduce payroll events:
  Timeline: Month 2–3 (after attendance and leave outboxes stable)
  Change: Payroll run lifecycle events added to payroll.outbox:
    payroll.run.initiated → payroll.run.computed → payroll.run.approved → payroll.run.disbursed
  Zero computation change: payroll math unchanged
  Validate: Events match actual run state transitions
  Risk: LOW

PHASE C2 — Replace direct table reads with API consumption:
  Timeline: Month 3–4 (requires attendance payroll projection API ready)
  Change: Payroll computation reads from:
    OLD: SELECT * FROM attendance.daily_attendance WHERE period = ...
    NEW: GET /attendance/payroll-projection?employee_id=X&period=Y
  Change: Payroll reads leave inputs from:
    OLD: SELECT * FROM leave_applications WHERE status='approved' ...
    NEW: GET /leave/payroll-inputs?employee_id=X&period=Y
  Validate: PARALLEL RUN MANDATORY — run old and new input sources for 2 periods;
            compare payslip outputs penny-for-penny
  Risk: HIGH — payroll accuracy is non-negotiable
        Mitigation: parallel run for 2 full payroll cycles before cutover

PHASE C3 — Introduce frozen input snapshots:
  Timeline: Month 4–5
  Change: At payroll run initiation, fetch and FREEZE all inputs
    (attendance projection, leave inputs, pay structures, policy rules)
  Change: Run computation from frozen snapshot — immune to mid-run source changes
  Validate: Rerun a historical payroll period using frozen snapshots → same output
  Risk: LOW (preserves computation; adds data capture step)

PHASE C4 — Replace notification trigger with event consumer:
  Timeline: Month 4–5
  Change: Remove direct notification call from payroll service
  Change: Notification consumer fires on payroll.run.disbursed event
  Risk: LOW
```

### MODULE D: Workflow System

**Current state:** Entity-specific approval services (LeaveApprovalService, RegularizationApprovalService, etc.) with duplicated routing logic and ad-hoc notification calls.

**Migration approach: REFACTOR → Generic engine**

```
PHASE D1 — Map existing workflows to template definitions:
  Timeline: Month 2
  Action: Document every existing approval flow as WorkflowTemplate configuration
  Action: Map all existing actor resolution logic (find manager, find HR admin) to routing rules
  No code change yet — documentation only
  Output: WorkflowTemplate definitions for all existing flows

PHASE D2 — Build WorkflowInstance engine alongside existing services:
  Timeline: Month 2–4
  Build: Generic WorkflowInstance state machine
  Build: TaskRoutingService (uses Organization domain for hierarchy)
  Build: workflow.* event emission from new engine
  Test: Run new engine in shadow mode alongside existing approval services
  Validate: New engine produces same routing decisions as old services

PHASE D3 — Migrate entity types one at a time:
  Timeline: Month 4–8 (one entity type per 2-week sprint)
  Order: Regularization (lowest risk) → Leave → Onboarding → Payroll Correction
  For each: Switch to new WorkflowInstance engine; decommission entity-specific service
  Validate: Each migration with 2-week parallel validation period

Preserved:
  ✓ All routing logic (manager hierarchy resolution)
  ✓ All delegation rules
  ✓ All SLA configurations
  ✓ All escalation paths
  ✗ Decommissioned: entity-specific approval service classes
```

### MODULE E: Notifications

**Current state:** Scattered notification calls from LeaveService, PayrollService, AttendanceService — each with their own email templates and SMTP calls.

**Migration approach: MERGE → Centralized Notifications Domain**

```
PHASE E1 — Inventory all existing notifications:
  Timeline: Week 1
  Action: Document every notification in the system:
    - Who sends it (which service)
    - When (what trigger)
    - To whom (recipient logic)
    - What channel (email/SMS/push)
    - Template content
  Output: Complete notification catalog (20-50 notification types typical)

PHASE E2 — Build centralized notification engine:
  Timeline: Week 4–6
  Build: Notification template store
  Build: Channel dispatchers (email, SMS, push, in-app)
  Build: User preference management
  Build: Notification domain consumers for all event types in catalog

PHASE E3 — Migrate one notification at a time:
  Timeline: Week 6–12
  For each notification in catalog:
    1. Register event consumer for trigger event type
    2. Implement template and dispatch in Notifications domain
    3. Deploy notification consumer
    4. Disable old scattered notification call
    5. Validate: notification arrives correctly
  Risk: LOW per notification; cumulative risk managed by migration log

Preserved:
  ✓ All notification content and logic
  ✓ All recipient determination rules
  ✗ Replaced: Scattered SMTP calls → Centralized dispatch service
```

### MODULE F: Analytics / Reporting

**Current state:** Complex SQL queries running against operational tables. Materialized views refreshed on schedule.

**Migration approach: REBUILD projection layer (preserve query logic)**

```
PHASE F1 — Identify all existing analytics queries:
  Timeline: Week 1–2
  Action: Document every analytics query, materialized view, and report
  Classify: Which domain's events will populate each query's data need
  Output: Analytics query → event source mapping

PHASE F2 — Build analytics projection tables:
  Timeline: Month 2–4 (alongside operational domain event introductions)
  Build: fact_daily_attendance, dim_employee, fact_payroll_period, etc.
  Build: Event consumers to populate each projection table
  Strategy: Seed projection tables from existing data first (historical backfill)
  Then: Switch to event-driven population

PHASE F3 — Historical backfill:
  Timeline: Month 3–4
  Action: For each projection table, run a one-time migration job:
    SELECT ... FROM existing attendance/leave/payroll tables
    → Transform → INSERT INTO analytics.fact_daily_attendance
  Validate: Projection data matches existing analytics query results

PHASE F4 — Switch dashboards to projection APIs:
  Timeline: Month 4–6
  Strategy: Parallel — run old queries AND new projection APIs for 2 weeks
  Validate: Numbers match within acceptable rounding tolerance
  Switch: Dashboard queries moved to Analytics domain projection API
  Decommission: Old analytics materialized views and scheduled queries

Preserved:
  ✓ All KPI formulas and definitions
  ✓ All report structures
  ✓ All dashboard layouts
  ✗ Changed: Data source (OLTP tables → projection tables)
```

---

## 13.3 Migration Sequencing

```
MIGRATION TIMELINE (phased, non-destructive):

Month 1:  ┌─────────────────────────────────┐
          │ FOUNDATION WORK                  │
          │ • Outbox schema per domain       │
          │ • Outbox relay (in-process)      │
          │ • Event envelope standard        │
          │ • Consumer base class + dedup    │
          │ • Event store table              │
          └─────────────────────────────────┘

Month 2:  ┌─────────────────────────────────┐
          │ ATTENDANCE OUTBOX               │
          │ LEAVE OUTBOX                    │
          │ EMPLOYEE OUTBOX                 │
          │ WORKFLOW DOCUMENTATION          │
          │ ANALYTICS CATALOG               │
          └─────────────────────────────────┘

Month 3:  ┌─────────────────────────────────┐
          │ PAYROLL EVENTS (non-breaking)   │
          │ ANALYTICS PROJECTIONS (seed)    │
          │ WORKFLOW ENGINE (shadow)        │
          │ NOTIFICATIONS CATALOG           │
          └─────────────────────────────────┘

Month 4:  ┌─────────────────────────────────┐
          │ PAYROLL PARALLEL RUN            │
          │ ANALYTICS SWITCH (validated)    │
          │ WORKFLOW ENGINE (leave first)   │
          │ NOTIFICATIONS MIGRATION         │
          └─────────────────────────────────┘

Month 5-6:┌─────────────────────────────────┐
          │ PAYROLL CUTOVER                 │
          │ ALL WORKFLOW MIGRATION          │
          │ ALL NOTIFICATIONS CENTRALIZED  │
          │ AI TELEMETRY PIPELINE          │
          └─────────────────────────────────┘

Month 7+: ┌─────────────────────────────────┐
          │ PHASE 2: REDIS QUEUE (if needed)│
          │ AI INTELLIGENCE DOMAIN         │
          │ REAL-TIME DASHBOARD EVENTS     │
          │ MOBILE SYNC EVENTS             │
          └─────────────────────────────────┘
```

---

## 13.4 Compatibility Adapters

During migration, existing integrations (external systems, legacy UI) must continue working while new event infrastructure is being introduced:

```
COMPATIBILITY ADAPTER PATTERNS:

1. LEGACY API ADAPTER:
   If existing API consumers (external ERP, biometric device management)
   call the old synchronous API format:
   → Wrap in adapter that translates old API format to new domain service call
   → New domain service produces events in outbox
   → Legacy response returned from synchronous path (unchanged for caller)
   
   Old: POST /attendance/punch {employee_id, timestamp, device_id}
   New internally: PunchIngestionService → RawPunchEvent aggregate → outbox
   External sees: Same API response format (no change)

2. DATABASE TRIGGER COMPATIBILITY BRIDGE:
   Existing database triggers that send notifications:
   → Temporarily: keep trigger running in parallel while notification consumer built
   → Notification consumer suppressed (skip delivery if trigger already sent)
   → After validation: decommission trigger; consumer takes over
   → Never: simultaneous delivery from both (double notifications)

3. REPORT COMPATIBILITY BRIDGE:
   Existing OLTP-based reports during analytics migration:
   → Reports served from old queries during parallel run phase
   → After validation: reports switched to projection API
   → Old queries kept read-only for 30 days post-switch (rollback capability)
   → After 30 days: old analytics queries archived and removed
```

---

# SECTION 14: FUTURE SCALABILITY STRATEGY

---

## 14.1 High-Volume Event Domain Analysis

```
EVENT VOLUME ESTIMATES (at 50,000 employees):

Domain               │ Events/Day    │ Peak/Minute │ Primary Driver
─────────────────────┼───────────────┼─────────────┼───────────────────────────
attendance.punched   │   300,000     │   2,500     │ 3 shifts × 2 punches × 50K
att.daily.processed  │    50,000     │     500     │ One per employee per day
leave.transactions   │     5,000     │      50     │ ~10% leave rate daily
payroll.*            │   50,000/mo   │     500     │ Monthly batch (burst)
workflow.*           │    15,000     │     150     │ ~30% employees daily
notification.*       │    75,000     │     750     │ ~1.5 per employee per day
audit.*              │   500,000     │   5,000     │ All write operations × factor
ai.telemetry.*       │   100,000     │   1,000     │ Feature updates + inference
analytics.*          │   150,000     │   1,500     │ Projection updates
security.*           │    25,000     │     250     │ Login + action events
─────────────────────┼───────────────┼─────────────┼───────────────────────────
TOTAL (50K employees)│ ~1,270,000    │  ~13,000    │

At 200,000 employees: multiply by ~4 = ~5M events/day, ~50,000 events/minute

At 50K/min peak sustained: Kafka with 48 partitions handles ~240K/min/topic
→ Single topic well within capacity at any scale
→ Bottleneck likely at consumer processing, not Kafka throughput
```

---

## 14.2 Event Partitioning Strategy at Scale

```
PARTITION KEY SELECTION BY DOMAIN:

attendance.punched:           employee_id
  → All punches for same employee in same partition → ordering guarantee
  → 50,000 employees × 6 punches/day → 300K events/day
  → With 48 partitions: ~6,250 employees per partition
  → Each partition: ~6,250 × 6 = 37,500 events/day → easily manageable

attendance.daily.processed:   employee_id
  → Same logic; ensures ordered processing per employee

payroll.run.*:                run_id
  → All events for same run in same partition
  → Low volume; any partition count works

employee.*:                   employee_id
  → Employee lifecycle events ordered per employee

leave.*:                      employee_id
  → Leave events ordered per employee

workflow.*:                   instance_id
  → Workflow stage events ordered per instance

audit.*:                      tenant_id
  → All audit events for a tenant in order
  → High volume; 24 partitions for audit topic

TENANT-PER-PARTITION strategy (for ultra-large deployments):
  For enterprise tenants (>10K employees):
    workforce.{tenant_id}.attendance.punched → dedicated topic per tenant
    Advantages: tenant isolation, independent retention, dedicated consumer groups
    Disadvantages: topic count explosion (managed with topic-per-tenant framework)
```

---

## 14.3 Scalability Boundaries and Extraction Triggers

```
SCALING BOUNDARY MAP:

Boundary 1: In-Process → Redis Queue
  Trigger: Outbox relay processing > 50ms avg; consumer lag > 10K events
  Domains extracted first: Analytics consumer, AI telemetry consumer
  Timeline: ~15K employees or Month 18, whichever comes first

Boundary 2: Redis Queue → Kafka
  Trigger: Combined event throughput > 50K/minute peak; need for replay capability
  Domains: All operational domain events
  Timeline: ~30K employees or Month 30, whichever comes first

Boundary 3: Kafka → Flink Stream Processing
  Trigger: Analytics aggregation latency >5 minutes; complex event processing needs
  (e.g., sliding window KPIs, sessionization of attendance events)
  Domains: Analytics domain consumers
  Timeline: ~75K employees or Month 42

Boundary 4: Single-Region → Multi-Region Kafka
  Trigger: GDPR data residency requirement for EU tenants; or 3+ geographic regions
  Timeline: Enterprise expansion decision point

LIKELY EXTRACTION CANDIDATES (ranked by scale pressure):
  1. Attendance punch ingestion → dedicated service + dedicated Kafka topic cluster
     (highest volume, most latency-sensitive, most hardware-specific)
  2. Analytics projections → ClickHouse-backed service
     (query volume, different storage optimization required)
  3. AI feature pipeline → GPU-capable worker pool
     (compute-intensive, different infrastructure requirements)
  4. Notification dispatch → dedicated service
     (I/O-bound, different scaling profile, external service dependencies)
  5. Audit event store → dedicated append-only service
     (retention requirements, WORM storage, compliance audit access)
```

---

## 14.4 Queue-Heavy Workload Analysis

```
QUEUE-HEAVY DOMAINS AND THEIR STRATEGIES:

1. ATTENDANCE PROCESSING QUEUE:
   Workload: Process raw punches → compute daily records
   Pattern: High-burst at shift changes (7am, 3pm, 11pm)
   Volume: 2,500 events/minute at peak (50K employees)
   Strategy: 
     - Consumer pool size: elastic scaling based on queue depth
     - Priority queue: real-time punch ACK (fast path) vs. batch processing (slow path)
     - Backpressure: if queue depth > 100K, throttle new punch acceptance → buffer at device

2. PAYROLL COMPUTATION QUEUE:
   Workload: Compute payslips for all employees (monthly batch)
   Pattern: Single burst per month (high CPU, low I/O)
   Volume: 1,247 computation jobs per run
   Strategy:
     - Parallelism: split employees into batches of 100, parallel processing
     - Priority: none (all equally important within a run)
     - Isolation: dedicated compute workers (not shared with real-time consumers)

3. AI INFERENCE QUEUE:
   Workload: Feature computation + model inference
   Pattern: Daily batch for attrition/absence prediction; real-time for copilot
   Strategy:
     - Batch inference: scheduled off-peak (2am), 100-employee batches
     - Real-time copilot: separate priority queue, < 3s SLA
     - Separate queues: batch vs. real-time inference (priority isolation)

4. NOTIFICATION DISPATCH QUEUE:
   Workload: Dispatch emails, SMS, push notifications
   Pattern: Bursts after payroll run (1,247 payslip notifications simultaneously)
   Volume: Up to 10,000 notifications in < 1 minute at payroll run
   Strategy:
     - Rate limiting: respect external provider limits (SendGrid: 100/s; Twilio: 10/s SMS)
     - Batching: email batching (SendGrid batch API for up to 1,000 per API call)
     - Priority: critical alerts (compliance violations) fast-path; bulk (payslip) slow-path

5. ANALYTICS PROJECTION QUEUE:
   Workload: Update projection tables from domain events
   Pattern: Continuous; spikes at end-of-day (attendance processing wave)
   Strategy:
     - Separate projection workers per domain namespace (attendance, payroll, leave)
     - Upsert semantics: idempotent writes allow concurrent workers safely
     - Backpressure: acceptable lag up to 5 minutes for non-real-time projections
```

---

# SECTION 15: FINAL RECOMMENDATIONS

---

## 15.1 Most Critical Event Architecture Principles

These are the five principles that must never be violated, regardless of delivery pressure or engineering convenience:

### Principle 1: Events Are Immutable Facts
Once an event is stored in the outbox and published, it cannot be modified. If a business fact changes, emit a new corrective event. Never update or delete historical events. Every violation of this principle corrupts the audit trail and invalidates AI training data integrity.

### Principle 2: Transactional Outbox Is Mandatory
Any domain that writes state and needs downstream consumers to react must use the outbox pattern. Direct event publishing (without outbox) is prohibited — it introduces the dual-write inconsistency. The question "could we just publish directly without an outbox?" has one answer: no.

### Principle 3: Idempotent Consumers Are Not Optional
Every consumer must deduplicate by `event_id` before processing business logic. The event bus guarantees at-least-once delivery — which means duplicates will occur. Any consumer that is not idempotent will produce incorrect business outcomes during retry scenarios.

### Principle 4: Tenant Isolation Is Enforced at Every Layer
Tenant isolation is not a single guard — it is a defense-in-depth: database schema scoping, outbox relay validation, consumer framework enforcement, event store query predicates, and monitoring alerts. A breach at any single layer must be caught by another. This is the event architecture's primary security property.

### Principle 5: Versioning Is Governed, Not Ad-Hoc
Breaking changes to event schemas require the dual-publish migration pattern. No team may change an event schema and immediately deploy without consumer validation. The Schema Registry is the authoritative contract; the outbox relay enforces schema validity before publishing.

---

## 15.2 Most Dangerous Anti-Patterns

Ranked by frequency of occurrence and severity of consequence:

### Anti-Pattern 1: Publishing Events Without Outbox (Direct Publish)
**How it happens:** "The outbox adds complexity; let's just publish to the bus directly in the service method."  
**Consequence:** State changes without events (process crash between write and publish); phantom events without state changes.  
**Prevention:** Framework-level enforcement — EventBus.publish() throws if called outside an outbox transaction context.

### Anti-Pattern 2: Business Logic in Consumer Event Routing
**How it happens:** "The notification consumer checks if the leave approval is for > 5 days before sending a different template."  
**Consequence:** Business logic scattered into consumers; domain knowledge fragmented; consumers become business logic owners that shouldn't be.  
**Prevention:** Consumers receive fully formed domain events that already encode business decisions. Routing logic belongs in the originating domain.

### Anti-Pattern 3: Synchronous Event Processing in Consumer Chain
**How it happens:** "The analytics consumer calls the AI domain's inference API synchronously before completing."  
**Consequence:** Consumer chain latency multiplies; single slow downstream blocks all consumers; cascading timeouts.  
**Prevention:** Consumers NEVER make synchronous calls to other domains. If a consumer needs data from another domain, it reads from an already-computed projection.

### Anti-Pattern 4: Unbounded Event Replay Without Authorization
**How it happens:** Engineer replays 3 months of payroll events to fix an analytics gap — without realizing it will re-trigger payslip generation for all 3 months.  
**Consequence:** 1,247 employees receive 3 months of payslip notifications. Finance receives 3 months of duplicate disbursement requests.  
**Prevention:** Replay operations require dual authorization; replay scope must explicitly declare impacted consumers; consumers that should not process replays (notification dispatch, bank file generation) must implement replay detection via `metadata.replay_origin` field.

### Anti-Pattern 5: Using Event Categories Interchangeably
**How it happens:** Team routes an AI telemetry event through the audit event channel because "it's also auditable."  
**Consequence:** Audit event store fills with non-audit data; retention policies misapplied; compliance audit queries polluted.  
**Prevention:** Event category is set by the Schema Registry based on `event_type` — not set by individual teams. Category determines retention class, durability tier, and consumer routing. It is not a team-level choice.

### Anti-Pattern 6: Ignoring Consumer Lag
**How it happens:** Consumer falls 200,000 events behind; team assumes "it'll catch up."  
**Consequence:** Real-time dashboard becomes 2-hour stale; AI telemetry pipeline produces features based on 2-hour-old data; notifications delayed by hours.  
**Prevention:** Consumer lag is a primary SLA metric. Alert at 10,000 events lag for critical consumers. Auto-scale consumer workers on lag depth. Never assume lag self-resolves without investigation.

### Anti-Pattern 7: PII in Event Envelopes or Logs
**How it happens:** "Let's put the employee name in the `actor.actor_name` field for easier debugging."  
**Consequence:** Employee names logged in every monitoring system, log aggregator, and event store permanently. GDPR erasure requests cannot purge log-layer copies.  
**Prevention:** Envelope fields are PII-free by definition. Display names resolved at query time from access-controlled APIs. Monitoring systems log `employee_id` (UUID) only.

---

## 15.3 Highest-Priority Event Domains

Implementation priority ranking:

| Priority | Domain | Justification |
|---|---|---|
| P1 | **Attendance Events** | Highest volume; gates payroll; real-time dashboard requirement |
| P1 | **Payroll Events** | Financial consequence; compliance audit requirement |
| P2 | **Leave Events** | Direct HR operational impact; payroll input dependency |
| P2 | **Workflow Events** | Cross-domain coordinator; approval lifecycle source of truth |
| P3 | **Employee Lifecycle Events** | Most downstream consumers; onboarding/exit cascade |
| P3 | **Policy Events** | Cache invalidation dependency; all domains blocked on this |
| P4 | **Analytics Events** | High business value for dashboard freshness |
| P4 | **AI Telemetry Events** | Long-term AI capability depends on this |
| P5 | **Security Events** | Compliance requirement; can be introduced incrementally |
| P5 | **Notification Events** | Operational improvement; existing notifications continue working |

---

## 15.4 Biggest Scalability Risks

### Risk 1: Audit Event Store Size
At 50,000 employees, the audit domain receives ~500,000 events/day. Over 10 years (statutory retention), this is 1.8 billion audit records. Postgres will handle this with proper partitioning, but query performance for compliance inspection queries will degrade without a dedicated audit search layer (Elasticsearch or S3 Parquet + Athena).

**Mitigation:** Partition audit event store by month from day one. Plan Elasticsearch index for compliance search queries by Year 2.

### Risk 2: Attendance Punch Volume at Shift Change
The biometric punch wave at shift change (50,000 employees, simultaneous 7am punch-in) produces ~5,000-10,000 events/minute for ~5 minutes. Without backpressure management, this spike can overwhelm the ingestion API and outbox relay.

**Mitigation:** Punch ingestion API with horizontal scaling. Rate limiting per device (not per employee). Outbox relay with priority queue (punch ingestion is priority=critical). Queue-depth-based auto-scaling.

### Risk 3: AI Feature Pipeline Becoming a Consumer Bottleneck
As the number of events consumed by the AI feature pipeline grows (attendance + leave + payroll + org + employee = 5+ streams), the pipeline processing time per employee grows. At 100,000 employees, feature computation for the attrition model alone could take hours.

**Mitigation:** Incremental feature updates (update only changed features per incoming event; don't recompute full vector). Parallel feature computation workers by employee partition. Pre-computed feature cache with TTL.

### Risk 4: Kafka Consumer Group Rebalancing at Scale
When consumer instances scale up or down in Kafka, a consumer group rebalance occurs — all consumers pause processing for the rebalance duration (seconds to minutes for large partition counts). During a rebalance, no events are processed.

**Mitigation:** Static partition assignment for critical consumers (no rebalancing). Use Kafka Cooperative Sticky Assignor (minimizes partition movement). Consumer group rebalance monitoring with alert on duration > 30 seconds.

---

## 15.5 Event Architecture Maturity Roadmap

```
MATURITY LEVELS:

LEVEL 0 — Current State (Informal Events)
  ✓ Some asynchronous processing exists
  ✗ No formal event contracts
  ✗ No versioning
  ✗ No guaranteed delivery
  ✗ No event store
  ✗ Analytics on OLTP

LEVEL 1 — Outbox-Backed Events (Target: Month 3)
  ✓ Transactional outbox per domain
  ✓ Canonical event envelope standard
  ✓ In-process event bus
  ✓ Consumer idempotency
  ✓ Event store (append-only log)
  ✓ Basic monitoring (outbox depth, relay lag)
  ✗ No external broker
  ✗ No consumer independence

LEVEL 2 — Governed Event Architecture (Target: Month 9)
  ✓ Schema Registry
  ✓ Versioning with dual-publish
  ✓ DLQ management
  ✓ All operational domains emitting events
  ✓ Analytics projections from events
  ✓ AI telemetry pipeline
  ✓ Distributed tracing (correlation + causation)
  ✓ PII governance enforced
  ✗ Still in-process bus (may begin Redis queue migration)

LEVEL 3 — Streaming-Ready Architecture (Target: Month 18)
  ✓ External message broker (Redis Streams or Kafka)
  ✓ Independent consumer scaling
  ✓ Real-time dashboard events
  ✓ Mobile sync events
  ✓ Consumer lag monitoring and alerting
  ✓ Tenant isolation at broker level
  ✓ Event replay capability

LEVEL 4 — Enterprise Event Platform (Target: Month 30+)
  ✓ Full Kafka deployment with topic design
  ✓ ClickHouse analytics ingestion
  ✓ Multi-region event routing
  ✓ Flink stream processing for complex analytics
  ✓ AI training pipeline on event log
  ✓ Global Schema Registry
  ✓ WORM audit archive
  ✓ Compliance-grade event certification
```

---

## 15.6 AI Telemetry Readiness Assessment

```
AI TELEMETRY READINESS GATES:

Gate 1: Feature Pipeline Ready
  ✓ Required: attendance.daily.processed events flowing
  ✓ Required: employee.* lifecycle events flowing
  ✓ Required: leave.balance.updated events flowing
  ✓ Required: Feature store schema defined
  ✓ Required: Feature computation consumer deployed
  → Enables: Attrition risk model training

Gate 2: Ground Truth Pipeline Ready
  ✓ Required: employee.exited events with exit_type classification
  ✓ Required: Historical exit data backfilled as events
  ✓ Required: Prediction-to-outcome matching logic
  → Enables: Model evaluation and retraining

Gate 3: Real-Time Inference Pipeline Ready
  ✓ Required: Feature store fresh within 24 hours
  ✓ Required: Model inference endpoint <2s P95
  ✓ Required: Recommendation publisher operational
  → Enables: Daily attrition risk dashboard, absence prediction

Gate 4: Copilot Data Pipeline Ready
  ✓ Required: Analytics projections <5 minute latency
  ✓ Required: Employee projection API <100ms P95
  ✓ Required: Permission-scoped query layer
  ✓ Required: Vector memory store operational
  → Enables: AI copilot in manager workspace

Gate 5: Model Governance Loop Ready
  ✓ Required: Model Registry operational
  ✓ Required: Performance monitoring (daily drift check)
  ✓ Required: ai.model.drift_detected event handlers
  → Enables: Production-grade AI with continuous improvement
```

---

## 15.7 Analytics Streaming Readiness Assessment

```
ANALYTICS STREAMING READINESS GATES:

Gate 1: Projection Layer Stable
  ✓ Required: All operational domain events emitting
  ✓ Required: Analytics consumers processing all domain events
  ✓ Required: fact_daily_attendance, fact_payroll_period, dim_employee populated
  ✓ Required: Data parity validated vs. existing OLTP queries
  → Enables: Dashboards migrated from OLTP to projection layer

Gate 2: Real-Time Projections Operational
  ✓ Required: rt_attendance_summary updated within 60 seconds of event
  ✓ Required: Supabase Realtime subscriptions functional
  ✓ Required: Dashboard consumer latency < 3 seconds E2E
  → Enables: Live attendance dashboard

Gate 3: ClickHouse Ingestion Active (Phase 3)
  ✓ Required: Kafka topics active for all fact domains
  ✓ Required: ClickHouse Kafka engine consuming topics
  ✓ Required: Query parity validated between Postgres and ClickHouse projections
  → Enables: Sub-second historical analytics queries, 5-year trend analysis

Gate 4: AI Feature Store Synchronization
  ✓ Required: Analytics exports API serving structured feature datasets
  ✓ Required: Export freshness < 24 hours
  ✓ Required: Schema alignment between analytics exports and AI feature store
  → Enables: Daily model training pipeline execution
```

---

*Document complete. 15 sections. Canonical event architecture specification for the AI-native Workforce Operating System.*

*This document is Version 1.0 and must be treated as a living specification — reviewed quarterly and updated as event contracts evolve, new domains are added, and streaming infrastructure matures.*




---


