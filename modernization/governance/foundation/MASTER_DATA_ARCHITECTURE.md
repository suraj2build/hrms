# MASTER DATA ARCHITECTURE + DATABASE MODELING + MIGRATION STRATEGY
## AI-Native Workforce Operating System — Enterprise Data Platform Specification
### Principal Data Architect Reference Document — Confidential

---

> **Document Authority:** This document is the canonical data architecture specification for the Workforce Operating System platform. All schema design decisions, migration plans, storage choices, and data access patterns are governed by the principles established herein. No cross-domain data mutation, shared mutable state, or schema change may proceed without alignment with this specification.

---

# Section 1 — Data Architecture Philosophy

## 1.1 Why Enterprise HRMS Data Architecture Is Fundamentally Hard

Most software systems operate with predictable, bounded data growth and relatively uniform query patterns. Enterprise HRMS platforms violate both assumptions simultaneously.

An enterprise workforce system is one of the most architecturally hostile data environments in the enterprise software landscape — not because of any single hard problem, but because it accumulates an unusually dense intersection of irreconcilable data constraints:

**Constraint Cluster 1 — Temporal Complexity at Scale**
Every meaningful record in an HRMS carries multiple temporal dimensions: the time an event *occurred*, the time it was *recorded*, the time it became *effective*, the time it was *superseded*, and often the time it was *legally mandated to be retained*. A single payslip simultaneously belongs to a payroll period, an accounting period, a fiscal year, a statutory reporting window, and potentially a legal hold window. Attendance data is the same: a punch record carries device timestamp, server-received timestamp, effective shift window, payroll calculation period, and overtime boundary — and any of these may diverge due to timezone offsets, biometric lag, or retroactive shift reassignment.

**Constraint Cluster 2 — Retroactive Recomputation Chains**
When a policy changes, or a pay component is corrected, or a shift assignment is backdated, it triggers a recomputation cascade. Attendance recalculates → overtime recomputes → payroll regenerates → ledger entries revise → statutory reports re-derive. This is not a batch pipeline problem; it is a transactional lineage problem. Every version of every computed artifact must be preserved, linkable, and diffable. Systems that do not architect for this from day one invariably accumulate irreversible debt — the moment a payroll run cannot be explained to an auditor, the data architecture has failed.

**Constraint Cluster 3 — Write-Heavy OLTP + Read-Heavy Analytics on the Same Domain**
Attendance punches arrive at high frequency (biometric, mobile, web) and must be persisted with sub-100ms latency. Within milliseconds of persistence, operational dashboards must reflect current workforce state. End-of-day, weekly, and monthly aggregations feed payroll, leave accrual, and compliance reports. Historical analytics must scan billions of punch records across multi-year windows. Using a single PostgreSQL table for all of this is the most common and most catastrophic mistake in HRMS platform design.

**Constraint Cluster 4 — Immutability Requirements Alongside Mutation Requirements**
Payroll slips once finalized are legally immutable. Audit logs are append-only by compliance mandate. Yet attendance records need correction workflows. Leave balances accrue and deplete. Workflow states transition. Policies activate and supersede. The architecture must maintain hard immutability guarantees on some records while allowing carefully governed mutations on others — within the same domain, often within the same transaction.

**Constraint Cluster 5 — Multi-Tenant Data Isolation**
Enterprise SaaS HRMS platforms serve multiple client organizations whose data must be completely isolated. A query that accidentally crosses tenant boundaries is not a performance bug — it is a catastrophic security incident. Every table, every query, every cache key, every event, every analytics pipeline must be tenant-aware at the structural level, not enforced only by application code.

---

## 1.2 Core Data Philosophy

The Workforce Operating System data architecture is founded on eight governing philosophies:

### Philosophy 1 — Domain Data Sovereignty

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA SOVEREIGNTY PRINCIPLE               │
│                                                             │
│   Each bounded context OWNS its data completely.            │
│   No other domain may write to it.                         │
│   No other domain may read from it directly via SQL.        │
│   All cross-domain data flows through published events      │
│   or Open Host Service APIs.                                │
│                                                             │
│   Violation = architectural debt that compounds daily.      │
└─────────────────────────────────────────────────────────────┘
```

Each domain owns a dedicated PostgreSQL schema. Tables within a schema belong exclusively to the domain service that created them. No foreign key constraints span across schemas. No stored procedures write across schema boundaries. No view joins tables from multiple domain schemas. Cross-domain data needs are satisfied by:
- Denormalized reference copies (updated via events)
- Published read APIs consumed at query time
- Materialized read models in the Analytics domain

### Philosophy 2 — Temporal Completeness

Every record that can change over time must carry its full temporal envelope:

| Field | Purpose |
|---|---|
| `created_at` | When the row was first inserted (immutable) |
| `updated_at` | When the row was last mutated (if mutable) |
| `effective_from` | When the business fact became valid |
| `effective_to` | When the business fact was superseded (NULL = current) |
| `recorded_at` | When a human/system recorded the fact (may differ from effective_from) |
| `version` | Monotonically increasing mutation counter |

Records that represent point-in-time facts (punches, events) are append-only. Records that represent current state (leave balance, policy assignment) carry SCD Type 2 temporal envelope.

### Philosophy 3 — Computation Lineage Preservation

Every computed artifact (payslip, attendance summary, leave accrual) must record not just its result but its full computation basis:

```
PayslipComputation {
  payslip_id
  payroll_run_id         -- which run produced this
  attendance_snapshot_id -- which attendance version was used
  policy_version_ids[]   -- which policies were active
  component_versions[]   -- which rate versions were applied
  computed_at            -- when this computation ran
  computation_inputs{}   -- full input parameter snapshot
}
```

This makes audit trail questions answerable: "Why did this employee receive this amount in March?" traces directly from the payslip to the inputs used.

### Philosophy 4 — OLTP/OLAP Hard Separation

```
┌──────────────────────────────────────────────────────────────────────┐
│                        STORAGE LAYER SEPARATION                      │
│                                                                      │
│  OLTP (Supabase/PostgreSQL)          OLAP (ClickHouse)               │
│  ─────────────────────────           ────────────────                │
│  Transactional writes                Analytical reads                │
│  Row-level security                  Column-oriented scans           │
│  Normalized domain schemas           Denormalized star schema        │
│  Point lookups + range scans         Aggregation over billions       │
│  Sub-10ms P99 reads                  Sub-3s aggregation queries      │
│  Strict ACID                         Eventual consistency okay       │
│  Audit-grade retention               Analytical retention            │
│                                                                      │
│  Bridge: Kafka/event streams → ClickHouse projection tables          │
└──────────────────────────────────────────────────────────────────────┘
```

Mixing OLTP and OLAP in the same PostgreSQL instance is acceptable only at early startup scale. Once the platform crosses 50,000 daily active records, analytics queries will begin to degrade OLTP latency through shared buffer pool contention, autovacuum pressure, and index bloat. The architecture defines the OLAP separation boundary from day one — even if ClickHouse is not yet deployed, the schema and event contracts are designed to project without transformation.

### Philosophy 5 — Append-Only Audit Architecture

The audit architecture operates on a simple invariant: **audit records are never updated or deleted**. The `audit.event_log` table is an append-only ledger. Every mutation to a business entity generates an audit record that captures the before-state, after-state, actor, and causation chain. Audit data is stored in a dedicated schema with no application-level write path that could accidentally corrupt it. Retention is governed by statutory requirements, not operational convenience.

### Philosophy 6 — Event-First Persistence

Business facts that represent domain events are persisted first in the domain's outbox table within the same ACID transaction that mutates the aggregate. The outbox relay then publishes to the event bus. This is non-negotiable: there is no "fire-and-forget" event emission in this platform. Events not written transactionally are events that will be lost under failure, producing phantom state divergence.

### Philosophy 7 — Partition-Aware Schema Design

Every high-volume table is designed for partitioning from schema version 1. Partition key, partition strategy, and partition interval are defined before the table is created — not retrofitted after millions of rows accumulate. Retrofitting range partitioning onto an unpartitioned table with production data is one of the most dangerous database operations in PostgreSQL. It requires table rewrites, extended lock holds, and carefully orchestrated cutover windows that compound in difficulty with data volume.

### Philosophy 8 — Immutability Gradient

The platform enforces a tiered immutability model:

| Tier | Examples | Mutability |
|---|---|---|
| **Immutable Ledger** | Payslip (finalized), Statutory filing | Never updated, delete prohibited |
| **Append-Only Log** | Audit events, Outbox events, Punch records | New rows only |
| **Versioned Current State** | Policy, Employee profile, Shift assignment | SCD Type 2 (new row = new version) |
| **Governed Mutation** | Leave balance, Workflow state | Updates allowed under domain rules |
| **Ephemeral Operational** | Cache, Session, Temp computation | Freely mutable, not source of truth |

---

## 1.3 High-Level Data Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                     WORKFORCE OS — DATA PLATFORM OVERVIEW                        │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         OLTP LAYER (PostgreSQL/Supabase)                │    │
│  │                                                                         │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │    │
│  │  │  identity│ │   org    │ │ employee │ │attendance│ │  leave   │    │    │
│  │  │  schema  │ │  schema  │ │  schema  │ │  schema  │ │  schema  │    │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │    │
│  │  │ payroll  │ │ workflow │ │  policy  │ │  audit   │ │  events  │    │    │
│  │  │  schema  │ │  schema  │ │  schema  │ │  schema  │ │  schema  │    │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │    │
│  │                                                                         │    │
│  │  Row-Level Security | Domain-Scoped Schemas | Tenant Isolation         │    │
│  └──────────────────────────┬────────────────────────────────────────────┘    │
│                             │                                                    │
│                    Outbox Relay / Event Stream                                   │
│                             │                                                    │
│         ┌───────────────────┴──────────────────────┐                           │
│         │                                          │                            │
│  ┌──────▼──────────────┐              ┌────────────▼────────────────┐          │
│  │   REAL-TIME LAYER   │              │      ANALYTICS LAYER        │          │
│  │                     │              │                             │           │
│  │  Redis / Supabase   │              │  ClickHouse / Postgres      │          │
│  │  Realtime           │              │  Analytics Schemas          │          │
│  │                     │              │                             │           │
│  │  Live dashboards    │              │  Star schema                │          │
│  │  Presence tracking  │              │  KPI aggregations           │          │
│  │  Notification queues│              │  Historical analytics        │          │
│  └─────────────────────┘              │  Dimensional models         │          │
│                                       └──────────────┬──────────────┘          │
│                                                      │                          │
│                                       ┌──────────────▼──────────────┐          │
│                                       │       AI / ML LAYER         │           │
│                                       │                             │           │
│                                       │  Feature store (PostgreSQL) │          │
│                                       │  Vector store (pgvector)    │          │
│                                       │  Model registry             │          │
│                                       │  Prediction persistence     │          │
│                                       └─────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1.4 CQRS Evolution Strategy

The platform begins as a standard OLTP system where the same PostgreSQL schemas serve both write and read operations. CQRS is introduced incrementally as specific read patterns exceed what normalized OLTP schemas can efficiently serve.

**Phase 1 — Shared OLTP (Current):**
All reads and writes go to the same PostgreSQL schemas. Read performance is managed through indexing, materialized views, and query optimization. Acceptable for up to ~10,000 employees.

**Phase 2 — Read Model Projections:**
Domain event consumers project denormalized read models into dedicated tables within `analytics.*` schemas. Operational dashboards query read models rather than normalized domain tables. Write path remains unchanged. Applicable from ~10,000–100,000 employees.

**Phase 3 — Analytics CQRS (ClickHouse):**
Event streams feed ClickHouse for historical analytics. PostgreSQL continues as the write-side source of truth. ClickHouse serves all aggregate, time-series, and dimensional queries. Applicable from ~100,000+ employees or ~10M+ daily records.

**Phase 4 — Domain Read Replicas:**
High-read domains (Attendance, Employee, Payroll) gain dedicated read replicas with logical replication. Write path remains on primary. Read replicas serve API reads and background jobs. Applied selectively based on domain-specific load metrics.

---

# Section 2 — Domain-Owned Data Modeling

## 2.1 Schema Ownership Registry

The following table is the authoritative registry of schema ownership. Any table not listed here must be registered before creation.

| Schema | Owner Domain | Write Authority | Read Authority | External Read Protocol |
|---|---|---|---|---|
| `identity` | Identity & Access | Identity service only | Identity service | Published API |
| `org` | Organization | Org service only | Org service | Published API / Event |
| `employee` | Employee | Employee service only | Employee service | Published API / Event |
| `attendance` | Attendance | Attendance service only | Attendance service | Published API / Read model |
| `shift` | Shift Management | Shift service only | Shift service | Published API / Event |
| `roster` | Roster Planning | Roster service only | Roster service | Published API |
| `leave` | Leave Management | Leave service only | Leave service | Published API / Event |
| `payroll` | Payroll | Payroll service only | Payroll service | Published API / Event |
| `workflow` | Workflow | Workflow service only | Workflow service | Published API / Event |
| `policy` | Policy Engine | Policy service only | All domains (read-through cache) | Shared Read API |
| `compliance` | Compliance | Compliance service only | Compliance service | Published API |
| `notification` | Notifications | Notification service only | Notification service | Internal |
| `integration` | Integrations | Integration service only | Integration service | Internal |
| `audit` | Audit & Governance | System only (append-only) | Audit service | Restricted API |
| `events` | Event Infrastructure | Outbox relay only | Event consumers | Topic subscription |
| `analytics` | Analytics | Projection consumers only | All domains (read) | Direct SQL / API |
| `ai` | AI Intelligence | AI service only | AI service | Published API |
| `mobile` | Mobile Workforce | Mobile service only | Mobile service | Internal |

---

## 2.2 Identity & Access Schema

**Owns:** Authentication, authorization, session, tenant, role, and permission data.

```sql
-- identity.tenants — Root tenant registry (one row per client organization)
CREATE TABLE identity.tenants (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    external_id         VARCHAR(64) NOT NULL UNIQUE,     -- Slug used in all URLs
    display_name        VARCHAR(255) NOT NULL,
    plan_tier           VARCHAR(32) NOT NULL,            -- starter | professional | enterprise
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    settings            JSONB       NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- identity.users — Platform user accounts (cross-tenant for multi-org users)
CREATE TABLE identity.users (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    email               VARCHAR(320) NOT NULL UNIQUE,
    phone               VARCHAR(30),
    password_hash       TEXT,                            -- NULL if SSO-only
    mfa_enabled         BOOLEAN     NOT NULL DEFAULT FALSE,
    mfa_secret_enc      TEXT,                            -- AES-256-GCM encrypted
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_email ON identity.users (email);

-- identity.tenant_memberships — User ↔ Tenant association
CREATE TABLE identity.tenant_memberships (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL REFERENCES identity.tenants(id),
    user_id             UUID        NOT NULL REFERENCES identity.users(id),
    role_id             UUID        NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    invited_at          TIMESTAMPTZ,
    joined_at           TIMESTAMPTZ,
    UNIQUE(tenant_id, user_id)
);

-- identity.roles — Tenant-scoped role definitions
CREATE TABLE identity.roles (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    name                VARCHAR(120) NOT NULL,
    permissions         JSONB       NOT NULL DEFAULT '[]',
    is_system           BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

-- identity.sessions — Active user sessions (short retention)
CREATE TABLE identity.sessions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id             UUID        NOT NULL,
    tenant_id           UUID        NOT NULL,
    token_hash          TEXT        NOT NULL UNIQUE,     -- SHA-256 of bearer token
    device_fingerprint  TEXT,
    ip_address          INET,
    user_agent          TEXT,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at          TIMESTAMPTZ
);
CREATE INDEX idx_sessions_token ON identity.sessions (token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_expiry ON identity.sessions (expires_at) WHERE revoked_at IS NULL;
```

**Aggregate Root:** `Tenant`, `User`, `Session`
**Transactional Boundary:** Each tenant registration, user invitation, and session operation is a single transaction. Sessions are never mutated — they are created or revoked.
**Cross-Domain References:** All other domains store `tenant_id` (UUID copy) and `user_id` (UUID copy) — never JOIN back into `identity` schema.

---

## 2.3 Employee Schema

**Owns:** Employee lifecycle, employment records, compensation history, organizational placement.

```sql
-- employee.employees — Core employee registry
CREATE TABLE employee.employees (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_number     VARCHAR(50) NOT NULL,
    user_id             UUID,                            -- Links to identity.users (denormalized)
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    hire_date           DATE        NOT NULL,
    termination_date    DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, employee_number)
);
CREATE INDEX idx_employees_tenant ON employee.employees (tenant_id);
CREATE INDEX idx_employees_user ON employee.employees (user_id) WHERE user_id IS NOT NULL;

-- employee.employee_profiles — PII-heavy profile data (column-level encryption candidates)
CREATE TABLE employee.employee_profiles (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id         UUID        NOT NULL UNIQUE REFERENCES employee.employees(id),
    tenant_id           UUID        NOT NULL,
    -- Name fields
    legal_first_name    TEXT        NOT NULL,            -- Encrypted at rest
    legal_last_name     TEXT        NOT NULL,            -- Encrypted at rest
    preferred_name      TEXT,
    -- Contact
    personal_email      TEXT,                            -- Encrypted at rest
    personal_phone      TEXT,                            -- Encrypted at rest
    -- Identity
    national_id_enc     TEXT,                            -- AES-256-GCM encrypted
    passport_enc        TEXT,                            -- AES-256-GCM encrypted
    date_of_birth       DATE,                            -- Encrypted at rest
    gender              VARCHAR(32),
    -- Address (JSONB for flexibility)
    address             JSONB,                           -- Encrypted JSONB
    emergency_contacts  JSONB,                           -- Encrypted JSONB
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- employee.employment_records — SCD Type 2: employment terms over time
CREATE TABLE employee.employment_records (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id         UUID        NOT NULL REFERENCES employee.employees(id),
    tenant_id           UUID        NOT NULL,
    -- Organizational placement (denormalized copies from org events)
    org_unit_id         UUID        NOT NULL,
    location_id         UUID        NOT NULL,
    position_id         UUID,
    -- Employment terms
    employment_type     VARCHAR(32) NOT NULL,            -- full_time | part_time | contract
    work_schedule_id    UUID,
    reporting_manager_id UUID,
    -- Temporal envelope
    effective_from      DATE        NOT NULL,
    effective_to        DATE,                            -- NULL = current record
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID        NOT NULL
);
CREATE INDEX idx_emp_records_employee ON employee.employment_records (employee_id, effective_to NULLS LAST);
CREATE INDEX idx_emp_records_tenant_active ON employee.employment_records (tenant_id) WHERE effective_to IS NULL;

-- employee.compensation_records — Salary/wage history (SCD Type 2)
CREATE TABLE employee.compensation_records (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id         UUID        NOT NULL REFERENCES employee.employees(id),
    tenant_id           UUID        NOT NULL,
    compensation_type   VARCHAR(32) NOT NULL,            -- monthly | hourly | daily
    base_amount         NUMERIC(15,4) NOT NULL,
    currency            CHAR(3)     NOT NULL DEFAULT 'INR',
    pay_grade           VARCHAR(50),
    effective_from      DATE        NOT NULL,
    effective_to        DATE,
    version             INTEGER     NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID        NOT NULL
);
CREATE INDEX idx_comp_records_employee ON employee.compensation_records (employee_id, effective_to NULLS LAST);
```

**Aggregate Root:** `Employee`
**Sub-Aggregates:** `EmploymentRecord`, `CompensationRecord`
**Transactional Boundary:** Employee creation, employment record change, and compensation change are each atomic transactions. Profile updates are separate transactions.
**Cross-Domain References:**
- Attendance stores `employee_id` (UUID copy from event)
- Payroll stores `employee_id` + denormalized compensation snapshot
- Leave stores `employee_id` + `employment_type` (denormalized)
- All cross-references are event-populated, never FK-constrained

---

## 2.4 Organization Schema

**Owns:** Tenant organizational structure — units, locations, positions, hierarchies.

```sql
-- org.org_units — Hierarchical organizational units
CREATE TABLE org.org_units (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    parent_id           UUID        REFERENCES org.org_units(id),
    name                VARCHAR(255) NOT NULL,
    code                VARCHAR(50),
    unit_type           VARCHAR(50) NOT NULL,            -- company | division | department | team
    depth               INTEGER     NOT NULL DEFAULT 0,  -- Materialized path depth
    path                TEXT        NOT NULL,            -- Materialized path: /root/div/dept
    head_employee_id    UUID,                            -- Denormalized from employee events
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    effective_from      DATE        NOT NULL,
    effective_to        DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, code) DEFERRABLE
);
CREATE INDEX idx_org_units_tenant ON org.org_units (tenant_id) WHERE status = 'active';
CREATE INDEX idx_org_units_path ON org.org_units USING GIST (path gist_trgm_ops);
CREATE INDEX idx_org_units_parent ON org.org_units (parent_id) WHERE parent_id IS NOT NULL;

-- org.locations — Physical work locations
CREATE TABLE org.locations (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    name                VARCHAR(255) NOT NULL,
    code                VARCHAR(50),
    address             JSONB,
    timezone            VARCHAR(64) NOT NULL DEFAULT 'UTC',
    country_code        CHAR(2)     NOT NULL,
    geofence_config     JSONB,                           -- GPS boundary for mobile punch
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- org.positions — Job positions (structural, not employee-specific)
CREATE TABLE org.positions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    org_unit_id         UUID        NOT NULL REFERENCES org.org_units(id),
    title               VARCHAR(255) NOT NULL,
    code                VARCHAR(50),
    grade               VARCHAR(50),
    is_filled           BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Aggregate Root:** `OrgUnit`, `Location`
**Cross-Domain References:** Attendance, Shift, and Payroll domains denormalize `location_id`, `org_unit_id`, and `timezone` from org events. These are never joined live.

---

## 2.5 Attendance Schema

*(Deep modeling is covered in Section 4 — this provides the ownership summary)*

**Owns:** All punch records, daily attendance summaries, shift-resolved attendance, absence records, anomaly flags.

**Aggregate Root:** `AttendanceCycle`, `DailyAttendance`
**Core Tables:** `punch_records` (partitioned), `daily_attendance` (partitioned), `attendance_anomalies`, `attendance_snapshots`
**Transactional Boundary:** Each punch is an independent transaction. Daily processing (shift resolution, overtime, absent marking) is a single transaction per employee per day.

---

## 2.6 Payroll Schema

*(Deep modeling covered in Section 5 — this provides the ownership summary)*

**Owns:** Payroll runs, payslips, component breakdowns, statutory deductions, arrears, ledger entries.

**Aggregate Root:** `PayrollRun`, `Payslip`
**Core Tables:** `payroll_runs`, `payslips`, `payroll_components`, `payroll_ledger`, `statutory_filings`
**Transactional Boundary:** Payroll run initiation, component computation, finalization, and disbursement are each distinct transaction boundaries. Finalized payslips are immutable.

---

## 2.7 Leave Schema

```sql
-- leave.leave_types — Tenant-configured leave type catalog
CREATE TABLE leave.leave_types (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    name                VARCHAR(120) NOT NULL,
    code                VARCHAR(50) NOT NULL,
    accrual_method      VARCHAR(50),                     -- none | monthly | yearly | manual
    accrual_rate        NUMERIC(8,4),
    max_balance         NUMERIC(8,2),
    carry_forward_limit NUMERIC(8,2),
    is_paid             BOOLEAN     NOT NULL DEFAULT TRUE,
    requires_document   BOOLEAN     NOT NULL DEFAULT FALSE,
    policy_config       JSONB       NOT NULL DEFAULT '{}',
    effective_from      DATE        NOT NULL,
    effective_to        DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, code)
);

-- leave.leave_balances — Current leave balance per employee per type
CREATE TABLE leave.leave_balances (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    leave_type_id       UUID        NOT NULL REFERENCES leave.leave_types(id),
    balance_year        INTEGER     NOT NULL,
    opening_balance     NUMERIC(8,2) NOT NULL DEFAULT 0,
    accrued             NUMERIC(8,2) NOT NULL DEFAULT 0,
    taken               NUMERIC(8,2) NOT NULL DEFAULT 0,
    adjusted            NUMERIC(8,2) NOT NULL DEFAULT 0,
    closing_balance     NUMERIC(8,2) GENERATED ALWAYS AS
                           (opening_balance + accrued - taken + adjusted) STORED,
    last_accrual_date   DATE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version             INTEGER     NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, employee_id, leave_type_id, balance_year)
);
CREATE INDEX idx_leave_balances_employee ON leave.leave_balances (tenant_id, employee_id, balance_year);

-- leave.leave_applications — Leave request lifecycle
CREATE TABLE leave.leave_applications (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    leave_type_id       UUID        NOT NULL REFERENCES leave.leave_types(id),
    start_date          DATE        NOT NULL,
    end_date            DATE        NOT NULL,
    duration_days       NUMERIC(5,2) NOT NULL,
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    workflow_instance_id UUID,                           -- Denormalized from workflow events
    reason              TEXT,
    document_urls       JSONB,
    approved_by         UUID,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    applied_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leave_apps_employee ON leave.leave_applications (tenant_id, employee_id, start_date);
CREATE INDEX idx_leave_apps_status ON leave.leave_applications (tenant_id, status) WHERE status IN ('pending', 'approved');

-- leave.leave_balance_ledger — Append-only balance change history
CREATE TABLE leave.leave_balance_ledger (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    leave_type_id       UUID        NOT NULL,
    transaction_type    VARCHAR(50) NOT NULL,            -- accrual | deduction | adjustment | carry_forward | lapse
    amount              NUMERIC(8,2) NOT NULL,           -- Positive = credit, Negative = debit
    balance_before      NUMERIC(8,2) NOT NULL,
    balance_after       NUMERIC(8,2) NOT NULL,
    reference_id        UUID,                            -- leave_application_id or accrual_run_id
    notes               TEXT,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leave_ledger_employee ON leave.leave_balance_ledger (tenant_id, employee_id, occurred_at);
```

**Aggregate Root:** `LeaveBalance`, `LeaveApplication`
**Transactional Boundary:** Leave application submission, approval, and balance deduction are a single transaction. Accrual runs are independent transactions per employee.

---

## 2.8 Workflow Schema

```sql
-- workflow.workflow_templates — Reusable approval workflow definitions
CREATE TABLE workflow.workflow_templates (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    name                VARCHAR(255) NOT NULL,
    entity_type         VARCHAR(80) NOT NULL,            -- leave | expense | onboarding | etc.
    version             INTEGER     NOT NULL DEFAULT 1,
    definition          JSONB       NOT NULL,            -- Stage definitions, conditions, escalations
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, entity_type, version)
);

-- workflow.workflow_instances — Running workflow executions
CREATE TABLE workflow.workflow_instances (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    template_id         UUID        NOT NULL REFERENCES workflow.workflow_templates(id),
    entity_type         VARCHAR(80) NOT NULL,
    entity_id           UUID        NOT NULL,
    initiator_id        UUID        NOT NULL,
    current_stage       VARCHAR(80),
    status              VARCHAR(32) NOT NULL DEFAULT 'in_progress',
    context             JSONB       NOT NULL DEFAULT '{}',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    sla_deadline        TIMESTAMPTZ
);
CREATE INDEX idx_wf_instances_entity ON workflow.workflow_instances (entity_type, entity_id);
CREATE INDEX idx_wf_instances_status ON workflow.workflow_instances (tenant_id, status) WHERE status = 'in_progress';

-- workflow.workflow_tasks — Individual approval tasks
CREATE TABLE workflow.workflow_tasks (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    instance_id         UUID        NOT NULL REFERENCES workflow.workflow_instances(id),
    stage_key           VARCHAR(80) NOT NULL,
    assignee_id         UUID,
    assignee_role       VARCHAR(80),
    task_type           VARCHAR(50) NOT NULL,            -- approve | review | acknowledge
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    decision            VARCHAR(32),
    decision_reason     TEXT,
    due_at              TIMESTAMPTZ,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX idx_wf_tasks_assignee ON workflow.workflow_tasks (tenant_id, assignee_id, status) WHERE status = 'pending';
```

---

## 2.9 Policy Schema

```sql
-- policy.policy_definitions — Versioned policy catalog
CREATE TABLE policy.policy_definitions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID,                            -- NULL = platform default
    domain              VARCHAR(80) NOT NULL,            -- attendance | leave | payroll | etc.
    policy_type         VARCHAR(120) NOT NULL,
    name                VARCHAR(255) NOT NULL,
    version_major       INTEGER     NOT NULL DEFAULT 1,
    version_minor       INTEGER     NOT NULL DEFAULT 0,
    rule_set            JSONB       NOT NULL,
    effective_from      DATE        NOT NULL,
    effective_to        DATE,
    status              VARCHAR(32) NOT NULL DEFAULT 'draft',
    created_by          UUID        NOT NULL,
    activated_by        UUID,
    activated_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, domain, policy_type, version_major, version_minor)
);
CREATE INDEX idx_policy_defs_domain ON policy.policy_definitions (tenant_id, domain, status, effective_to NULLS LAST);

-- policy.policy_assignments — Scope-specific policy overrides
CREATE TABLE policy.policy_assignments (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    policy_definition_id UUID       NOT NULL REFERENCES policy.policy_definitions(id),
    scope_type          VARCHAR(50) NOT NULL,            -- employee | org_unit | location | employment_type
    scope_id            UUID        NOT NULL,
    priority            INTEGER     NOT NULL DEFAULT 100,
    effective_from      DATE        NOT NULL,
    effective_to        DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- policy.policy_resolution_cache — Cached resolution results (short TTL)
CREATE TABLE policy.policy_resolution_cache (
    cache_key           TEXT        NOT NULL PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    resolved_policy_id  UUID        NOT NULL,
    resolution_context  JSONB       NOT NULL,
    resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);
```

---

## 2.10 Audit Schema

```sql
-- audit.event_log — Append-only immutable audit record (never updated, never deleted in lifecycle)
CREATE TABLE audit.event_log (
    id                  BIGSERIAL   NOT NULL,
    event_id            UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    domain              VARCHAR(80) NOT NULL,
    entity_type         VARCHAR(80) NOT NULL,
    entity_id           UUID        NOT NULL,
    action              VARCHAR(80) NOT NULL,            -- created | updated | deleted | approved | etc.
    actor_id            UUID,
    actor_type          VARCHAR(32) NOT NULL DEFAULT 'user',
    actor_ip            INET,
    before_state        JSONB,
    after_state         JSONB,
    diff                JSONB,
    correlation_id      UUID,
    causation_id        UUID,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signature           TEXT        NOT NULL             -- HMAC-SHA256 of (event_id + payload)
) PARTITION BY RANGE (occurred_at);

-- Monthly partitions created automatically by partition management job
CREATE TABLE audit.event_log_2025_01 PARTITION OF audit.event_log
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
-- ... subsequent months provisioned 90 days ahead

CREATE INDEX idx_audit_log_tenant_entity ON audit.event_log (tenant_id, entity_type, entity_id, occurred_at);
CREATE INDEX idx_audit_log_actor ON audit.event_log (tenant_id, actor_id, occurred_at);
CREATE INDEX idx_audit_log_domain ON audit.event_log (tenant_id, domain, occurred_at);
```

---

# Section 3 — Multi-Tenant Database Strategy

## 3.1 Architecture Options Comparison

Three standard multi-tenant database isolation strategies exist. Each carries a distinct tradeoff profile for an enterprise HRMS platform.

### Option A — Shared Schema (Single Database, Single Schema)

All tenants share the same tables. Every table has a `tenant_id` column. Row-Level Security policies enforce isolation.

**Advantages:**
- Simplest operational model (one schema to migrate, one backup)
- Zero per-tenant provisioning cost
- Schema migrations apply once, take effect for all tenants

**Disadvantages:**
- Noisy-neighbor risk: one large tenant's query blocks others
- RLS policy bugs cause cross-tenant data exposure (catastrophic risk for HRMS)
- Index bloat: multi-tenant indexes grow proportionally to total tenant count
- Restore granularity: cannot restore one tenant without restoring all
- Regulatory risk: GDPR "right to erasure" requires full tenant data sweep

### Option B — Schema-Per-Tenant (Single Database, Multiple Schemas)

Each tenant gets a dedicated PostgreSQL schema. Same table structures replicated per schema. Connection pooling routes queries to the correct schema using `SET search_path`.

**Advantages:**
- Hard schema isolation (no RLS needed for data separation)
- Per-tenant backup and restore possible
- Migrations can be tenant-staged
- Easier tenant data deletion (DROP SCHEMA CASCADE)

**Disadvantages:**
- Schema explosion at scale (1,000 tenants = 1,000 schemas × N tables per schema)
- Migrations must execute per-schema (orchestration complexity scales with tenants)
- Cross-tenant reporting impossible without application-level aggregation
- Connection pool fragmentation (each schema may need its own pool)

### Option C — Database-Per-Tenant (Separate Database Instances)

Each tenant gets a completely isolated database server or Supabase project.

**Advantages:**
- Maximum isolation (hardware-level separation available)
- Independent scaling per tenant
- Tenant-specific compliance jurisdiction possible
- Complete noise isolation

**Disadvantages:**
- Extreme operational overhead for mid-market tenants
- Cost prohibitive for tenants with small employee counts
- Cross-tenant analytics requires external federation
- Supabase project limits apply

---

## 3.2 Chosen Architecture: Tiered Isolation Model

The Workforce OS adopts a **tiered isolation model** that combines shared schema for standard tenants with optional schema-per-tenant for enterprise tenants with contractual isolation requirements.

```
┌──────────────────────────────────────────────────────────────────┐
│                    TIERED TENANT ISOLATION                        │
│                                                                  │
│  Tier 1 — Standard (< 2,000 employees)                          │
│    Shared schema + Row-Level Security                            │
│    All standard tenants in same PostgreSQL schemas               │
│    tenant_id on every table, enforced by RLS                    │
│                                                                  │
│  Tier 2 — Professional (2,000–10,000 employees)                 │
│    Shared schema + RLS + Priority query routing                  │
│    Dedicated read replica routing for large tenants              │
│    Connection pool reservation                                   │
│                                                                  │
│  Tier 3 — Enterprise (10,000+ employees or contractual)         │
│    Schema-per-tenant OR dedicated Supabase project               │
│    SLA-backed read replica                                       │
│    Dedicated pg_cron partition management                        │
│    Independent migration scheduling                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3.3 Row-Level Security Implementation

RLS is the foundational tenant isolation mechanism for Tier 1 and Tier 2 tenants. Every domain schema table has RLS enabled.

```sql
-- Enable RLS on all domain tables
ALTER TABLE attendance.punch_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance.punch_records FORCE ROW LEVEL SECURITY;

-- RLS policy — tenant isolation using JWT claim
CREATE POLICY tenant_isolation ON attendance.punch_records
    USING (tenant_id = (current_setting('app.current_tenant_id')::UUID));

-- Application sets tenant context at connection start
-- (Executed by connection pool before every query)
SET app.current_tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- RLS policy for service accounts (bypass with explicit permission)
CREATE POLICY service_account_bypass ON attendance.punch_records
    USING (current_setting('app.role', true) = 'service_account');
```

**RLS Audit Rule:** Every RLS policy definition is version-controlled in the migration system. Policy changes trigger an automated security test suite that verifies cross-tenant isolation with adversarial queries. No RLS policy change ships without passing the isolation test suite.

---

## 3.4 Tenant-Aware Indexing Strategy

Standard multi-column indexes on tenant-isolated tables must include `tenant_id` as the **leading column**. This is not optional — it is the most important indexing rule in a shared-schema multi-tenant system.

```sql
-- WRONG — index on employee_id alone is useless in multi-tenant queries
-- PostgreSQL cannot use this for tenant-scoped queries
CREATE INDEX idx_wrong ON attendance.punch_records (employee_id, punched_at);

-- CORRECT — tenant_id is always the leading column
CREATE INDEX idx_correct ON attendance.punch_records (tenant_id, employee_id, punched_at);

-- For date-range scans add punched_at as leading suffix
CREATE INDEX idx_attendance_scan ON attendance.punch_records
    (tenant_id, punched_at, employee_id)
    WHERE status != 'voided';

-- Partial indexes for high-selectivity states
CREATE INDEX idx_pending_tasks ON workflow.workflow_tasks
    (tenant_id, assignee_id, due_at)
    WHERE status = 'pending';
```

---

## 3.5 Noisy-Neighbor Mitigation

```
Strategy 1 — Statement Timeout Enforcement
  SET statement_timeout = '30s' for all API-path queries
  SET statement_timeout = '300s' for background jobs
  No query without a timeout.

Strategy 2 — Connection Pool Reservation
  Large tenants (Tier 2+) get reserved connection pool slots
  PgBouncer pool_mode = transaction for Tier 1
  PgBouncer pool_mode = session for Tier 3 (schema-per-tenant)

Strategy 3 — Background Job Throttling
  All background jobs (payroll recalculation, accrual runs)
  acquire a per-tenant advisory lock before starting
  SELECT pg_try_advisory_xact_lock(hashtext(tenant_id::text))
  Failed lock acquisition = exponential backoff, not retry flood

Strategy 4 — Autovacuum Per-Tenant Tuning
  For large tenant tables (>10M rows):
  ALTER TABLE attendance.punch_records SET (
    autovacuum_vacuum_scale_factor = 0.01,   -- Vacuum at 1% dead tuples (not 20%)
    autovacuum_analyze_scale_factor = 0.005
  );

Strategy 5 — Partition-Level Isolation for Reporting
  Large tenants who run heavy analytical reports are routed to
  a dedicated read replica with NO connection from OLTP path.
```

---

## 3.6 Tenant-Aware Caching Strategy

```
Cache Key Convention:
  {domain}:{entity_type}:{tenant_id}:{entity_id}:{version}

Examples:
  policy:definition:t-uuid:p-uuid:v3
  employee:profile:t-uuid:e-uuid:current
  attendance:daily:t-uuid:e-uuid:2025-03-15

Tenant Cache Namespace Isolation:
  Redis keyspace: tenant:{tenant_id}:*
  Flush tenant cache on tenant config change: UNLINK tenant:{tenant_id}:*
  TTL enforcement: all keys expire (no indefinite cache entries)

Cache-Aside Policy Resolution:
  1. Check Redis (TTL 300s)
  2. Miss → query policy.policy_resolution_cache (TTL per policy)
  3. Miss → run full policy resolution algorithm
  4. Populate both layers
```

---

## 3.7 Multi-Tenant Event Isolation

Every event in the outbox must carry `tenant_id`. The outbox relay validates tenant_id before publishing. Event consumers enforce tenant_id in their projection logic. Kafka topics are partitioned by `tenant_id` hash to ensure per-tenant message ordering within a topic.

```sql
-- Tenant isolation validation in outbox relay (pseudo-code)
FOR EACH event IN outbox WHERE published = FALSE:
    IF event.tenant_id IS NULL:
        MOVE TO dead_letter_queue WITH reason = 'missing_tenant_id'
    IF event.tenant_id NOT IN known_tenants:
        MOVE TO dead_letter_queue WITH reason = 'unknown_tenant'
    PUBLISH event TO topic WITH partition_key = event.tenant_id
```



---


# Section 4 — Attendance Data Architecture

## 4.1 Why Attendance Is the Most Dangerous HRMS Domain

Attendance is the highest-volume, highest-frequency write domain in any HRMS platform. For a tenant with 10,000 employees across multiple shifts, a single day generates:

| Source | Events/Day | Notes |
|---|---|---|
| Biometric punches (in + out) | ~20,000 | 10,000 × 2 minimum |
| Intermediate check punches | ~10,000 | Break punches, door access |
| Mobile/GPS punches | ~15,000 | Field workforce |
| System-generated absent marks | ~500 | For non-punched employees |
| Override/correction records | ~200 | Supervisor corrections |
| **Total** | **~45,700/day** | Per 10,000-employee tenant |

At 50,000 employees across all tenants: **~228,500 punch records per day**, **~83M per year**, **~830M in 10 years**.

A naive single-table design without partitioning will experience:
- Autovacuum dead-tuple storms during shift transitions (all 10,000 employees punching within a 30-minute window)
- Index bloat causing sequential scan fallback on month-old data
- OLTP query latency degradation from analytical dashboard queries scanning the same table
- Table-level lock contention during daily processing jobs

The attendance architecture must address all of these failure modes proactively.

---

## 4.2 Punch Record Storage — Core Table Design

```sql
-- attendance.punch_records — Partitioned append-only punch log
-- Partition key: punched_at (time of punch at device)
CREATE TABLE attendance.punch_records (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    device_id           UUID,
    -- Punch classification
    punch_type          VARCHAR(32) NOT NULL,            -- in | out | break_start | break_end | overtime_in | overtime_out
    punch_source        VARCHAR(32) NOT NULL,            -- biometric | mobile_gps | web | manual | system
    -- Temporal data (three timestamps for full temporal modeling)
    punched_at          TIMESTAMPTZ NOT NULL,            -- Device-recorded time (may have clock skew)
    server_received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When server received
    effective_at        TIMESTAMPTZ NOT NULL,            -- Authoritative time after normalization
    -- Location context
    location_id         UUID,
    latitude            NUMERIC(10,7),
    longitude           NUMERIC(10,7),
    geofence_status     VARCHAR(32),                     -- inside | outside | unknown
    -- Device metadata
    device_fingerprint  TEXT,
    raw_biometric_ref   TEXT,                            -- Reference to biometric template (not raw data)
    -- Processing state
    status              VARCHAR(32) NOT NULL DEFAULT 'raw', -- raw | validated | processed | voided
    validation_flags    JSONB,                           -- Anomaly flags from validation pass
    shift_id            UUID,                            -- Populated after shift resolution
    PRIMARY KEY (id, punched_at)                        -- Composite PK required for partitioned table
) PARTITION BY RANGE (punched_at);

-- Monthly partition creation (created 60 days ahead by partition management job)
CREATE TABLE attendance.punch_records_2025_01
    PARTITION OF attendance.punch_records
    FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2025-02-01 00:00:00+00');

CREATE TABLE attendance.punch_records_2025_02
    PARTITION OF attendance.punch_records
    FOR VALUES FROM ('2025-02-01 00:00:00+00') TO ('2025-03-01 00:00:00+00');
-- ... provisioned 60 days ahead, archived at 18 months, cold storage at 36 months

-- Indexes: defined on parent table, inherited by all partitions
CREATE INDEX idx_punch_tenant_employee ON attendance.punch_records
    (tenant_id, employee_id, effective_at);

CREATE INDEX idx_punch_tenant_date ON attendance.punch_records
    (tenant_id, effective_at)
    WHERE status != 'voided';

CREATE INDEX idx_punch_device ON attendance.punch_records
    (device_id, punched_at)
    WHERE device_id IS NOT NULL;

-- Partial index for unprocessed punches (high selectivity)
CREATE INDEX idx_punch_unprocessed ON attendance.punch_records
    (tenant_id, effective_at, employee_id)
    WHERE status = 'raw';
```

**Partition Management Job (pg_cron):**
```sql
-- Runs daily at 02:00 UTC — creates future partitions, detaches old partitions
SELECT cron.schedule('manage-attendance-partitions', '0 2 * * *',
$$
DO $$
DECLARE
    target_month DATE := date_trunc('month', NOW() + INTERVAL '60 days');
    partition_name TEXT;
    next_month DATE;
BEGIN
    partition_name := 'punch_records_' || to_char(target_month, 'YYYY_MM');
    next_month := target_month + INTERVAL '1 month';

    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE attendance.%I PARTITION OF attendance.punch_records
             FOR VALUES FROM (%L) TO (%L)',
            partition_name, target_month, next_month
        );
    END IF;
END;
$$;
$$);
```

---

## 4.3 Daily Attendance Summary — Computed Aggregate

The `daily_attendance` table is the processed aggregate for each employee per day. It is the primary source of truth for payroll, leave deduction, and operational dashboards. It is **not** a simple summary — it carries the full computation basis.

```sql
-- attendance.daily_attendance — Partitioned daily summary per employee
CREATE TABLE attendance.daily_attendance (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    attendance_date     DATE        NOT NULL,
    -- Shift context
    shift_id            UUID,
    shift_name          VARCHAR(120),
    shift_start         TIMESTAMPTZ,
    shift_end           TIMESTAMPTZ,
    -- Attendance status
    attendance_status   VARCHAR(32) NOT NULL,            -- present | absent | half_day | holiday | on_leave | week_off
    -- Actual punch times
    first_in_time       TIMESTAMPTZ,
    last_out_time       TIMESTAMPTZ,
    -- Computed durations (stored in minutes for precision)
    gross_hours_minutes INTEGER     NOT NULL DEFAULT 0,
    break_minutes       INTEGER     NOT NULL DEFAULT 0,
    net_hours_minutes   INTEGER     NOT NULL DEFAULT 0,
    overtime_minutes    INTEGER     NOT NULL DEFAULT 0,
    late_in_minutes     INTEGER     NOT NULL DEFAULT 0,
    early_out_minutes   INTEGER     NOT NULL DEFAULT 0,
    -- Policy-resolved values
    effective_hours_minutes INTEGER NOT NULL DEFAULT 0,  -- After policy rounding/capping
    overtime_eligible_minutes INTEGER NOT NULL DEFAULT 0,
    -- Payroll linkage
    payroll_day_factor  NUMERIC(5,4) NOT NULL DEFAULT 1.0, -- 0.0 absent, 0.5 half_day, 1.0 present
    payroll_period_id   UUID,                            -- Set when payroll locks this record
    is_payroll_locked   BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Computation metadata
    policy_version_id   UUID        NOT NULL,            -- Which policy computed this
    punch_count         INTEGER     NOT NULL DEFAULT 0,
    anomaly_flags       JSONB,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    computation_version INTEGER     NOT NULL DEFAULT 1,  -- Increments on recalculation
    PRIMARY KEY (id, attendance_date)
) PARTITION BY RANGE (attendance_date);

-- Daily partitions (monthly boundary — not daily, to avoid partition explosion)
CREATE TABLE attendance.daily_attendance_2025_01
    PARTITION OF attendance.daily_attendance
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE INDEX idx_daily_att_tenant_employee ON attendance.daily_attendance
    (tenant_id, employee_id, attendance_date);

CREATE INDEX idx_daily_att_payroll ON attendance.daily_attendance
    (tenant_id, payroll_period_id)
    WHERE payroll_period_id IS NOT NULL;

CREATE INDEX idx_daily_att_status ON attendance.daily_attendance
    (tenant_id, attendance_date, attendance_status);

-- Constraint: prevent backdating after payroll lock
-- Enforced by trigger
CREATE OR REPLACE FUNCTION attendance.prevent_locked_attendance_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_payroll_locked = TRUE THEN
        RAISE EXCEPTION 'Cannot modify attendance record locked by payroll run %',
            OLD.payroll_period_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_locked_update
    BEFORE UPDATE ON attendance.daily_attendance
    FOR EACH ROW EXECUTE FUNCTION attendance.prevent_locked_attendance_update();
```

---

## 4.4 Attendance Snapshots — Versioned Computation Basis

When payroll computation begins, it needs a stable, immutable view of attendance data. Attendance records may still be corrected after payroll starts (by supervisors for late-submitting employees). The snapshot mechanism freezes a specific computation version.

```sql
-- attendance.attendance_snapshots — Immutable payroll-period snapshots
CREATE TABLE attendance.attendance_snapshots (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    payroll_period_id   UUID        NOT NULL,
    snapshot_date       DATE        NOT NULL,
    employee_id         UUID        NOT NULL,
    -- Snapshot of daily_attendance values at snapshot time
    snapshot_data       JSONB       NOT NULL,            -- Full daily_attendance row as JSON
    -- Diff tracking (for payroll revision support)
    previous_snapshot_id UUID,
    delta               JSONB,                           -- What changed vs previous snapshot
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, payroll_period_id, snapshot_date, employee_id)
);
CREATE INDEX idx_att_snapshots_payroll ON attendance.attendance_snapshots
    (tenant_id, payroll_period_id, employee_id);
```

**Snapshot Workflow:**
```
1. Payroll initiates snapshot for period T
2. SELECT daily_attendance WHERE payroll_period_id = T AND is_payroll_locked = FALSE
3. INSERT INTO attendance_snapshots (copy of each row as JSONB)
4. UPDATE daily_attendance SET is_payroll_locked = TRUE, payroll_period_id = T
5. Payroll computation uses attendance_snapshots exclusively (not live daily_attendance)
6. Any post-snapshot corrections generate arrears records in next payroll period
```

---

## 4.5 Recalculation Architecture

Recalculations happen in three scenarios:
1. **Punch correction** — A supervisor voids or adds a punch after daily processing
2. **Shift reassignment** — An employee's shift is changed retroactively
3. **Policy change** — An overtime or attendance policy is updated with retroactive effect

```sql
-- attendance.recalculation_requests — Queue for recalculation jobs
CREATE TABLE attendance.recalculation_requests (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    date_from           DATE        NOT NULL,
    date_to             DATE        NOT NULL,
    trigger_type        VARCHAR(50) NOT NULL,            -- punch_correction | shift_change | policy_change
    trigger_reference_id UUID       NOT NULL,            -- ID of the triggering entity
    priority            INTEGER     NOT NULL DEFAULT 100, -- Lower = higher priority
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    error_message       TEXT
);
CREATE INDEX idx_recalc_pending ON attendance.recalculation_requests
    (tenant_id, priority, requested_at)
    WHERE status = 'pending';

-- attendance.recalculation_log — Audit of what changed in each recalculation
CREATE TABLE attendance.recalculation_log (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    request_id          UUID        NOT NULL REFERENCES attendance.recalculation_requests(id),
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    attendance_date     DATE        NOT NULL,
    before_state        JSONB       NOT NULL,
    after_state         JSONB       NOT NULL,
    delta_hours_minutes INTEGER,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Recalculation Safety Rules:**
- Recalculation is BLOCKED for dates within a locked payroll period
- Recalculation for locked periods creates an `arrears_request` in Payroll domain instead
- Recalculation requests are processed in employee order to avoid conflicting concurrent updates
- Advisory locks (`pg_advisory_xact_lock`) prevent concurrent recalculation for the same employee-date

---

## 4.6 Anomaly Storage

```sql
-- attendance.attendance_anomalies — Flagged attendance issues
CREATE TABLE attendance.attendance_anomalies (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    attendance_date     DATE        NOT NULL,
    punch_record_id     UUID,
    anomaly_type        VARCHAR(80) NOT NULL,            -- duplicate_punch | out_before_in | excessive_hours | geofence_violation | clock_skew | orphan_punch
    severity            VARCHAR(20) NOT NULL DEFAULT 'warning', -- info | warning | critical
    details             JSONB       NOT NULL,
    resolution_status   VARCHAR(32) NOT NULL DEFAULT 'open',
    resolved_by         UUID,
    resolved_at         TIMESTAMPTZ,
    resolution_notes    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_anomalies_open ON attendance.attendance_anomalies
    (tenant_id, attendance_date, severity)
    WHERE resolution_status = 'open';
```

---

## 4.7 Growth Projections and Storage Estimates

| Metric | Calculation | Result |
|---|---|---|
| Avg punches per employee per day | 4 (in, break-out, break-in, out) | 4 |
| Punch record row size (bytes) | JSONB + indexes | ~600 bytes |
| Daily attendance row size | With JSONB + indexes | ~1,200 bytes |
| Employees @ 10,000 tenant | — | 10,000 |
| Punch records per day | 10,000 × 4 | 40,000 |
| Punch records per year | 40,000 × 300 workdays | 12,000,000 |
| Storage for punch records/year | 12M × 600 bytes | ~7.2 GB/year |
| Daily attendance records/year | 10,000 × 300 | 3,000,000 |
| Storage for daily attendance/year | 3M × 1,200 bytes | ~3.6 GB/year |
| **Total attendance storage/year @ 10K employees** | | **~11 GB** |
| At 50,000 employees across all tenants | | **~55 GB/year** |
| At 10-year retention | | **~550 GB** (before compression) |
| PostgreSQL TOAST compression ratio | ~3:1 for JSONB | **~185 GB compressed** |

**Performance Risk Thresholds:**
- Single partition exceeding **100M rows**: consider sub-partitioning by `tenant_id` hash
- `daily_attendance` query > **50ms P99**: evaluate partial index or read replica routing
- `punch_records` write throughput > **500 TPS**: consider connection pool tuning and batch insert

---

## 4.8 Indexing Strategy Summary

```
Punch Records (per partition):
  ├── (tenant_id, employee_id, effective_at)        -- Employee attendance history
  ├── (tenant_id, effective_at) WHERE not voided    -- Daily processing job
  ├── (device_id, punched_at)                       -- Device audit queries
  └── (tenant_id, effective_at, employee_id)
       WHERE status = 'raw'                          -- Unprocessed punch sweep

Daily Attendance (per partition):
  ├── (tenant_id, employee_id, attendance_date)     -- Payroll input queries
  ├── (tenant_id, payroll_period_id)                -- Payroll lock sweep
  └── (tenant_id, attendance_date, status)          -- Dashboard aggregations

Anomalies:
  └── (tenant_id, attendance_date, severity)
       WHERE open                                    -- Supervisor resolution queue

Recalculation Requests:
  └── (tenant_id, priority, requested_at)
       WHERE pending                                 -- Job runner queue scan
```

---

# Section 5 — Payroll Data Architecture

## 5.1 Payroll Immutability Contract

Payroll is the most legally sensitive domain in the platform. Once a payslip is finalized and distributed to an employee, it becomes a legal document. The data architecture enforces immutability at the database level, not just at the application level.

**Immutability Rules:**
1. `payroll_runs` with `status = 'finalized'` may never be updated or deleted
2. `payslips` with `status = 'distributed'` may never be updated or deleted
3. `payroll_ledger` entries are append-only — corrections are new entries, not updates
4. Statutory filing records are WORM-protected (enforced via trigger + separate WORM table)

---

## 5.2 Payroll Run Lifecycle Table

```sql
-- payroll.payroll_runs — Top-level payroll execution record
CREATE TABLE payroll.payroll_runs (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    -- Period definition
    period_type         VARCHAR(32) NOT NULL,            -- monthly | bi_weekly | weekly
    period_year         INTEGER     NOT NULL,
    period_number       INTEGER     NOT NULL,            -- Month (1-12) or week number
    period_from         DATE        NOT NULL,
    period_to           DATE        NOT NULL,
    -- Lifecycle
    status              VARCHAR(32) NOT NULL DEFAULT 'draft',
    -- draft → computing → computed → under_review → approved → disbursing → finalized
    initiated_by        UUID        NOT NULL,
    approved_by         UUID,
    disbursed_by        UUID,
    -- Computation metadata
    attendance_snapshot_id UUID,                        -- Which attendance snapshot was used
    employee_count      INTEGER,
    total_gross         NUMERIC(18,4),
    total_net           NUMERIC(18,4),
    total_deductions    NUMERIC(18,4),
    total_employer_contributions NUMERIC(18,4),
    -- Timestamps
    initiated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    computation_started_at TIMESTAMPTZ,
    computation_completed_at TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    disbursed_at        TIMESTAMPTZ,
    finalized_at        TIMESTAMPTZ,
    -- Immutability enforcement
    is_locked           BOOLEAN     NOT NULL DEFAULT FALSE,
    locked_at           TIMESTAMPTZ,
    UNIQUE(tenant_id, period_year, period_number, period_type)
);
CREATE INDEX idx_payroll_runs_tenant ON payroll.payroll_runs (tenant_id, period_year, period_number);

-- Immutability trigger
CREATE OR REPLACE FUNCTION payroll.prevent_finalized_run_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('finalized') AND NEW.status != OLD.status THEN
        RAISE EXCEPTION 'Cannot modify finalized payroll run %', OLD.id
            USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_locked = TRUE AND (
        NEW.total_gross != OLD.total_gross OR
        NEW.total_net != OLD.total_net
    ) THEN
        RAISE EXCEPTION 'Cannot modify locked payroll figures for run %', OLD.id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_run_immutability
    BEFORE UPDATE ON payroll.payroll_runs
    FOR EACH ROW EXECUTE FUNCTION payroll.prevent_finalized_run_mutation();
```

---

## 5.3 Payslip Table — Employee-Level Payroll Record

```sql
-- payroll.payslips — Individual employee payslip per run
CREATE TABLE payroll.payslips (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    payroll_run_id      UUID        NOT NULL REFERENCES payroll.payroll_runs(id),
    employee_id         UUID        NOT NULL,
    -- Computation basis (immutable computation lineage)
    attendance_snapshot_ids JSONB   NOT NULL,            -- Array of snapshot IDs used
    compensation_record_id UUID     NOT NULL,            -- Which compensation version
    policy_version_ids  JSONB       NOT NULL,            -- Array of policy versions applied
    -- Earnings summary
    gross_earnings      NUMERIC(15,4) NOT NULL,
    total_deductions    NUMERIC(15,4) NOT NULL,
    net_earnings        NUMERIC(15,4) NOT NULL,
    employer_contributions NUMERIC(15,4) NOT NULL DEFAULT 0,
    -- Days/hours basis
    payable_days        NUMERIC(5,2) NOT NULL,
    loss_of_pay_days    NUMERIC(5,2) NOT NULL DEFAULT 0,
    overtime_hours      NUMERIC(7,2) NOT NULL DEFAULT 0,
    -- Arrears (from previous period corrections)
    arrears_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
    arrears_run_ids     JSONB,
    -- Currency
    currency            CHAR(3)     NOT NULL DEFAULT 'INR',
    -- Status lifecycle
    status              VARCHAR(32) NOT NULL DEFAULT 'computed',
    -- computed → reviewed → approved → disbursed | rejected
    -- Disbursement
    disbursement_method VARCHAR(32),                     -- bank_transfer | cheque | cash
    bank_account_ref    TEXT,                            -- Encrypted bank account reference
    disbursement_ref    TEXT,                            -- Transaction reference
    disbursed_at        TIMESTAMPTZ,
    -- Immutability
    finalized_at        TIMESTAMPTZ,
    digital_signature   TEXT,                            -- HMAC-SHA256 of payslip content
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, payroll_run_id, employee_id)
);
CREATE INDEX idx_payslips_run ON payroll.payslips (tenant_id, payroll_run_id);
CREATE INDEX idx_payslips_employee ON payroll.payslips (tenant_id, employee_id, created_at);
```

---

## 5.4 Payroll Component Breakdown

```sql
-- payroll.payroll_components — Line-item component breakdown per payslip
CREATE TABLE payroll.payroll_components (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    payslip_id          UUID        NOT NULL REFERENCES payroll.payslips(id),
    -- Component definition
    component_type      VARCHAR(50) NOT NULL,            -- earning | deduction | employer_contribution
    component_code      VARCHAR(80) NOT NULL,            -- basic | hra | pf | esic | tds | lop | ot_pay
    component_name      VARCHAR(255) NOT NULL,
    -- Calculation basis
    calculation_method  VARCHAR(50) NOT NULL,            -- fixed | percentage | formula | statutory
    calculation_basis   JSONB,                           -- What inputs were used
    rate                NUMERIC(10,6),                   -- Percentage rate if applicable
    -- Result
    computed_amount     NUMERIC(15,4) NOT NULL,
    exemption_amount    NUMERIC(15,4) NOT NULL DEFAULT 0,
    taxable_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
    -- Statutory metadata
    statutory_code      VARCHAR(80),                     -- PF section, ESIC act, Income Tax section
    statutory_limit_applied BOOLEAN NOT NULL DEFAULT FALSE,
    -- Ordering for payslip display
    display_order       INTEGER     NOT NULL DEFAULT 100,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payroll_components_payslip ON payroll.payroll_components (payslip_id, component_type);
```

---

## 5.5 Payroll Ledger — Financial Audit Trail

```sql
-- payroll.payroll_ledger — Append-only financial ledger (never updated)
CREATE TABLE payroll.payroll_ledger (
    id                  BIGSERIAL   NOT NULL PRIMARY KEY,
    entry_id            UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL,
    payroll_run_id      UUID        NOT NULL,
    payslip_id          UUID,
    employee_id         UUID        NOT NULL,
    -- Double-entry style
    account_code        VARCHAR(80) NOT NULL,            -- e.g., SALARY_EXPENSE, PF_LIABILITY
    entry_type          VARCHAR(20) NOT NULL,            -- debit | credit
    amount              NUMERIC(15,4) NOT NULL,
    currency            CHAR(3)     NOT NULL,
    -- Ledger metadata
    period_from         DATE        NOT NULL,
    period_to           DATE        NOT NULL,
    narration           TEXT        NOT NULL,
    component_code      VARCHAR(80),
    -- Immutability proof
    batch_hash          TEXT,                            -- SHA-256 of all entries in same run
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

CREATE TABLE payroll.payroll_ledger_2025_01
    PARTITION OF payroll.payroll_ledger
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE INDEX idx_ledger_tenant_run ON payroll.payroll_ledger
    (tenant_id, payroll_run_id);
CREATE INDEX idx_ledger_employee ON payroll.payroll_ledger
    (tenant_id, employee_id, period_from);
```

---

## 5.6 Arrears Architecture

Arrears occur when attendance or compensation corrections affect a prior finalized payroll period. Rather than reopening the finalized run (which violates immutability), arrears are computed into the next available run.

```sql
-- payroll.arrears_requests — Correction-triggered arrears queue
CREATE TABLE payroll.arrears_requests (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    -- Original period that needs correction
    original_run_id     UUID        NOT NULL REFERENCES payroll.payroll_runs(id),
    original_period_from DATE       NOT NULL,
    original_period_to  DATE        NOT NULL,
    -- Trigger
    trigger_type        VARCHAR(50) NOT NULL,            -- attendance_correction | compensation_change | leave_adjustment
    trigger_reference_id UUID       NOT NULL,
    -- Arrears calculation
    original_net_pay    NUMERIC(15,4),
    revised_net_pay     NUMERIC(15,4),
    arrears_amount      NUMERIC(15,4),                  -- revised - original
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    processed_in_run_id UUID,                           -- Which future run included this
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5.7 Statutory Persistence

```sql
-- payroll.statutory_filings — Immutable statutory compliance records
CREATE TABLE payroll.statutory_filings (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    payroll_run_id      UUID        NOT NULL REFERENCES payroll.payroll_runs(id),
    filing_type         VARCHAR(80) NOT NULL,            -- pf_ecr | esic_return | tds_24q | pt_return
    period_from         DATE        NOT NULL,
    period_to           DATE        NOT NULL,
    -- Filing data
    filing_data         JSONB       NOT NULL,            -- Full statutory data snapshot
    total_employees     INTEGER     NOT NULL,
    total_liability     NUMERIC(15,4) NOT NULL,
    -- Status
    status              VARCHAR(32) NOT NULL DEFAULT 'generated',
    submitted_at        TIMESTAMPTZ,
    acknowledgement_ref TEXT,
    -- Immutability
    content_hash        TEXT        NOT NULL,            -- SHA-256 of filing_data
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WORM protection trigger (no updates or deletes once submitted)
CREATE OR REPLACE FUNCTION payroll.protect_statutory_filing()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Statutory filings cannot be deleted. Retain for 8 years per statute.'
            USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'submitted' THEN
        RAISE EXCEPTION 'Cannot modify submitted statutory filing %', OLD.id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_statutory
    BEFORE UPDATE OR DELETE ON payroll.statutory_filings
    FOR EACH ROW EXECUTE FUNCTION payroll.protect_statutory_filing();
```

---

## 5.8 Payroll Versioning and Rollback Strategy

```
Versioning Model:
  PayrollRun has lifecycle status machine.
  No destructive rollback — only forward correction.

Rollback Strategy:
  If payroll is in 'approved' but not yet 'disbursed':
    → Status may be moved back to 'under_review' by authorized user
    → Payroll re-enters review workflow
    → Component recomputation may be triggered selectively

  If payroll is 'disbursed' but not yet 'finalized':
    → Reversal requires separate 'reversal_run' with negative ledger entries
    → Original run remains intact (audit requirement)

  If payroll is 'finalized':
    → Cannot be reversed in-period
    → Corrections generate arrears in next period
    → Finalized run is IMMUTABLE — no exceptions

Revision Lineage Table:
  payroll.run_revisions tracks every status transition
  with actor, timestamp, and reason code
```

```sql
-- payroll.run_revisions — Status transition log
CREATE TABLE payroll.run_revisions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    payroll_run_id      UUID        NOT NULL REFERENCES payroll.payroll_runs(id),
    tenant_id           UUID        NOT NULL,
    from_status         VARCHAR(32) NOT NULL,
    to_status           VARCHAR(32) NOT NULL,
    actor_id            UUID        NOT NULL,
    reason_code         VARCHAR(80),
    notes               TEXT,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5.9 Storage and Growth Projections

| Metric | Per 10K Employees | Per 50K Employees |
|---|---|---|
| Payslips per year | 120,000 (monthly × 12) | 600,000 |
| Payslip row size | ~800 bytes | — |
| Component rows per payslip | ~15 avg | — |
| Component storage/year | 120K × 15 × ~300 bytes | ~540 MB |
| Ledger entries/year | ~2-3 per payslip | ~360K–540K |
| Ledger storage/year | ~540K × 400 bytes | ~216 MB |
| Statutory filing storage/year | ~12 runs × 4 types × JSONB | ~50–200 MB |
| **Total payroll storage/year** | **~1.2 GB** | **~6 GB** |
| 10-year retention | — | **~60 GB** |

Payroll data is comparatively small by row count but must be retained for statutory periods (7–8 years in most jurisdictions). The partitioning strategy supports archival to cold storage after the statutory retention window while keeping recent data hot.



---


# Section 6 — Analytics + OLAP Architecture

## 6.1 The OLTP/OLAP Separation Imperative

The most common architectural mistake in HRMS platform evolution is allowing analytical queries to execute against the OLTP database. The failure mode is gradual and invisible until it becomes catastrophic.

```
Timeline of OLTP/OLAP Collision Failure:

Month 1:   Dashboard runs SELECT COUNT(*) + GROUP BY on 500K attendance rows. 
           200ms query. Acceptable.

Month 6:   Same query on 8M rows. 1.2 seconds. Users notice.

Month 12:  HR Director requests 12-month trend report. Query scans 24M rows.
           8 seconds. Autovacuum delayed. OLTP latency spikes.
           
Month 18:  Payroll background jobs time out competing with dashboard queries.
           Punch record inserts queue. Employees see "punch failed" on biometric.
           
Month 24:  Platform is unusable during month-end payroll + attendance reporting.
           Emergency read replica added. Data inconsistency discovered.
           Firefighting begins.
```

The Workforce OS **hard-separates OLTP and OLAP from the beginning** — not as a future optimization, but as a foundational design constraint.

---

## 6.2 Analytics Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     ANALYTICS DATA FLOW                                 │
│                                                                         │
│  OLTP Write Path                Event Bus               OLAP Read Path  │
│  ─────────────────              ─────────               ──────────────  │
│                                                                         │
│  ┌─────────────┐   outbox   ┌──────────┐  projection  ┌─────────────┐  │
│  │ Domain OLTP │──────────▶│ Event    │─────────────▶│ ClickHouse  │  │
│  │ (PostgreSQL)│            │ Stream   │              │ analytics   │  │
│  └─────────────┘            └──────────┘              └──────┬──────┘  │
│                                   │                          │          │
│                                   │              ┌───────────▼───────┐  │
│                                   │              │  analytics.*      │  │
│                                   └─────────────▶│  (PostgreSQL)     │  │
│                                    read models   │  Operational dash │  │
│                                                  └───────────────────┘  │
│                                                                         │
│  Freshness SLA:                                                         │
│  • Operational dashboards: < 60 seconds lag                            │
│  • KPI reports: < 5 minute lag                                          │
│  • Historical analytics: < 30 minute lag (batch window)                │
│  • Payroll analytics: batch (post-finalization)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6.3 Analytics PostgreSQL Schema — Operational Read Models

The `analytics` PostgreSQL schema holds denormalized read models that serve operational dashboards. These are event-driven projections — not views over OLTP tables — updated by domain event consumers.

```sql
-- analytics.dim_tenant — Tenant dimension
CREATE TABLE analytics.dim_tenant (
    tenant_key          BIGSERIAL   NOT NULL PRIMARY KEY,
    tenant_id           UUID        NOT NULL UNIQUE,
    external_id         VARCHAR(64) NOT NULL,
    display_name        VARCHAR(255) NOT NULL,
    plan_tier           VARCHAR(32) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL
);

-- analytics.dim_employee — SCD Type 2 employee dimension
-- Each row represents one version of employee state
CREATE TABLE analytics.dim_employee (
    employee_key        BIGSERIAL   NOT NULL PRIMARY KEY,
    employee_id         UUID        NOT NULL,
    tenant_id           UUID        NOT NULL,
    tenant_key          BIGINT      NOT NULL REFERENCES analytics.dim_tenant(tenant_key),
    -- Current attributes (denormalized for query efficiency)
    employee_number     VARCHAR(50) NOT NULL,
    full_name           VARCHAR(255) NOT NULL,           -- Display name (non-PII version for analytics)
    org_unit_id         UUID        NOT NULL,
    org_unit_name       VARCHAR(255),
    location_id         UUID        NOT NULL,
    location_name       VARCHAR(255),
    location_timezone   VARCHAR(64),
    employment_type     VARCHAR(32) NOT NULL,
    job_grade           VARCHAR(50),
    -- SCD Type 2 temporal fields
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,                     -- NULL = current version
    is_current          BOOLEAN     NOT NULL GENERATED ALWAYS AS (effective_to IS NULL) STORED,
    -- Source tracking
    source_version      INTEGER     NOT NULL
);
CREATE INDEX idx_dim_employee_id ON analytics.dim_employee (tenant_id, employee_id) WHERE is_current;
CREATE INDEX idx_dim_employee_org ON analytics.dim_employee (tenant_id, org_unit_id) WHERE is_current;

-- analytics.dim_date — Standard calendar dimension
CREATE TABLE analytics.dim_date (
    date_key            INTEGER     NOT NULL PRIMARY KEY, -- YYYYMMDD integer
    full_date           DATE        NOT NULL UNIQUE,
    year                SMALLINT    NOT NULL,
    quarter             SMALLINT    NOT NULL,
    month               SMALLINT    NOT NULL,
    month_name          VARCHAR(10) NOT NULL,
    week_of_year        SMALLINT    NOT NULL,
    day_of_week         SMALLINT    NOT NULL,
    day_name            VARCHAR(10) NOT NULL,
    is_weekend          BOOLEAN     NOT NULL,
    is_month_end        BOOLEAN     NOT NULL,
    is_quarter_end      BOOLEAN     NOT NULL,
    fiscal_year         SMALLINT,
    fiscal_quarter      SMALLINT
);
-- Pre-populated with 20 years of dates (static table, ~7,300 rows)

-- analytics.fact_attendance_daily — Core attendance fact table
CREATE TABLE analytics.fact_attendance_daily (
    id                  BIGSERIAL   NOT NULL,
    tenant_id           UUID        NOT NULL,
    -- Dimension keys
    employee_key        BIGINT      NOT NULL REFERENCES analytics.dim_employee(employee_key),
    date_key            INTEGER     NOT NULL REFERENCES analytics.dim_date(date_key),
    -- Foreign keys to dimension tables
    org_unit_id         UUID        NOT NULL,
    location_id         UUID        NOT NULL,
    shift_id            UUID,
    -- Attendance metrics
    attendance_status   VARCHAR(32) NOT NULL,
    is_present          BOOLEAN     NOT NULL,
    gross_hours_minutes INTEGER     NOT NULL DEFAULT 0,
    net_hours_minutes   INTEGER     NOT NULL DEFAULT 0,
    overtime_minutes    INTEGER     NOT NULL DEFAULT 0,
    late_in_minutes     INTEGER     NOT NULL DEFAULT 0,
    early_out_minutes   INTEGER     NOT NULL DEFAULT 0,
    payroll_day_factor  NUMERIC(5,4) NOT NULL DEFAULT 1.0,
    -- Payroll linkage
    payroll_period_key  INTEGER,
    -- Source tracking
    source_daily_attendance_id UUID NOT NULL,
    projection_version  INTEGER     NOT NULL DEFAULT 1,
    projected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, date_key)
) PARTITION BY RANGE (date_key);

-- Quarterly partitions (coarser than OLTP — analytical queries prefer quarterly scans)
CREATE TABLE analytics.fact_attendance_daily_2025_q1
    PARTITION OF analytics.fact_attendance_daily
    FOR VALUES FROM (20250101) TO (20250401);

CREATE INDEX idx_fact_att_tenant_date ON analytics.fact_attendance_daily
    (tenant_id, date_key, employee_key);
CREATE INDEX idx_fact_att_org_unit ON analytics.fact_attendance_daily
    (tenant_id, org_unit_id, date_key);

-- analytics.fact_payroll_summary — Payroll period fact table
CREATE TABLE analytics.fact_payroll_summary (
    id                  BIGSERIAL   NOT NULL PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    payroll_run_id      UUID        NOT NULL UNIQUE,
    employee_key        BIGINT      NOT NULL REFERENCES analytics.dim_employee(employee_key),
    period_year         SMALLINT    NOT NULL,
    period_number       SMALLINT    NOT NULL,
    period_from_key     INTEGER     NOT NULL REFERENCES analytics.dim_date(date_key),
    period_to_key       INTEGER     NOT NULL REFERENCES analytics.dim_date(date_key),
    -- Payroll metrics
    gross_earnings      NUMERIC(15,4) NOT NULL,
    net_earnings        NUMERIC(15,4) NOT NULL,
    total_deductions    NUMERIC(15,4) NOT NULL,
    employer_contributions NUMERIC(15,4) NOT NULL,
    loss_of_pay_days    NUMERIC(5,2) NOT NULL,
    overtime_hours      NUMERIC(7,2) NOT NULL,
    arrears_amount      NUMERIC(15,4) NOT NULL DEFAULT 0,
    projected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_fact_payroll_tenant_period ON analytics.fact_payroll_summary
    (tenant_id, period_year, period_number);
CREATE INDEX idx_fact_payroll_employee ON analytics.fact_payroll_summary
    (tenant_id, employee_key, period_year);

-- analytics.fact_leave_transactions — Leave fact table
CREATE TABLE analytics.fact_leave_transactions (
    id                  BIGSERIAL   NOT NULL PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_key        BIGINT      NOT NULL,
    leave_type_id       UUID        NOT NULL,
    leave_type_name     VARCHAR(120),
    transaction_type    VARCHAR(50) NOT NULL,
    date_key            INTEGER     NOT NULL,
    amount_days         NUMERIC(8,2) NOT NULL,
    balance_after       NUMERIC(8,2) NOT NULL,
    reference_id        UUID,
    projected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6.4 KPI Materialized Summary Tables

These tables are pre-aggregated at projection time to serve dashboard queries with sub-100ms response.

```sql
-- analytics.kpi_attendance_daily_org — Pre-aggregated daily attendance by org unit
CREATE TABLE analytics.kpi_attendance_daily_org (
    id                  BIGSERIAL   NOT NULL PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    org_unit_id         UUID        NOT NULL,
    attendance_date     DATE        NOT NULL,
    -- Aggregated metrics
    total_employees     INTEGER     NOT NULL DEFAULT 0,
    present_count       INTEGER     NOT NULL DEFAULT 0,
    absent_count        INTEGER     NOT NULL DEFAULT 0,
    late_count          INTEGER     NOT NULL DEFAULT 0,
    on_leave_count      INTEGER     NOT NULL DEFAULT 0,
    attendance_rate     NUMERIC(5,4) GENERATED ALWAYS AS
        (CASE WHEN total_employees > 0
              THEN present_count::NUMERIC / total_employees
              ELSE 0 END) STORED,
    avg_net_hours       NUMERIC(6,2),
    total_overtime_hours NUMERIC(10,2),
    -- Freshness
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, org_unit_id, attendance_date)
);
CREATE INDEX idx_kpi_att_tenant_date ON analytics.kpi_attendance_daily_org
    (tenant_id, attendance_date, org_unit_id);

-- analytics.kpi_workforce_snapshot — Real-time workforce state (upserted continuously)
CREATE TABLE analytics.kpi_workforce_snapshot (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL UNIQUE,
    total_employees     INTEGER     NOT NULL DEFAULT 0,
    active_employees    INTEGER     NOT NULL DEFAULT 0,
    on_leave_today      INTEGER     NOT NULL DEFAULT 0,
    absent_today        INTEGER     NOT NULL DEFAULT 0,
    present_today       INTEGER     NOT NULL DEFAULT 0,
    overtime_active     INTEGER     NOT NULL DEFAULT 0,
    -- Payroll snapshot
    current_period_payroll_status VARCHAR(32),
    -- Timestamps
    attendance_as_of    TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Event-Driven Projection Pattern (Idempotent Upsert):**
```sql
-- Attendance event consumer → updates fact + KPI tables atomically
-- Called by attendance.daily_attendance_processed event handler

BEGIN;

-- 1. Upsert fact table
INSERT INTO analytics.fact_attendance_daily (
    tenant_id, employee_key, date_key, org_unit_id, location_id,
    attendance_status, is_present, net_hours_minutes, overtime_minutes,
    late_in_minutes, payroll_day_factor, source_daily_attendance_id
)
VALUES (
    $tenant_id, $employee_key, $date_key, $org_unit_id, $location_id,
    $status, $is_present, $net_minutes, $ot_minutes,
    $late_minutes, $day_factor, $source_id
)
ON CONFLICT (source_daily_attendance_id)   -- Idempotency key
DO UPDATE SET
    attendance_status   = EXCLUDED.attendance_status,
    net_hours_minutes   = EXCLUDED.net_hours_minutes,
    overtime_minutes    = EXCLUDED.overtime_minutes,
    projection_version  = analytics.fact_attendance_daily.projection_version + 1,
    projected_at        = NOW();

-- 2. Update KPI summary (atomic with fact upsert)
INSERT INTO analytics.kpi_attendance_daily_org (
    tenant_id, org_unit_id, attendance_date,
    total_employees, present_count, absent_count, late_count
)
VALUES ($tenant_id, $org_unit_id, $date, 1,
    CASE WHEN $is_present THEN 1 ELSE 0 END,
    CASE WHEN $status = 'absent' THEN 1 ELSE 0 END,
    CASE WHEN $late_minutes > 0 THEN 1 ELSE 0 END
)
ON CONFLICT (tenant_id, org_unit_id, attendance_date)
DO UPDATE SET
    present_count = kpi_attendance_daily_org.present_count
        + CASE WHEN EXCLUDED.present_count = 1 AND kpi_attendance_daily_org.present_count = 0 THEN 1
               WHEN EXCLUDED.present_count = 0 AND kpi_attendance_daily_org.present_count = 1 THEN -1
               ELSE 0 END,
    computed_at = NOW();

COMMIT;
```

---

## 6.5 ClickHouse Strategy

ClickHouse is the designated analytical store for historical, time-series, and aggregation-heavy queries that would be unacceptable on PostgreSQL at scale.

**Deployment Trigger:**
Introduce ClickHouse when ANY of these thresholds are crossed:
- PostgreSQL analytics queries exceed 3 seconds P95
- Attendance fact table exceeds 100M rows
- Daily event volume exceeds 500K events
- Historical report window requested exceeds 18 months

**ClickHouse Table Design:**
```sql
-- ClickHouse DDL for attendance fact (columnar, compressed, sorted)
CREATE TABLE analytics_ch.fact_attendance_daily
(
    tenant_id           UUID,
    employee_id         UUID,
    org_unit_id         UUID,
    location_id         UUID,
    attendance_date     Date,
    attendance_status   LowCardinality(String),
    is_present          UInt8,
    net_hours_minutes   UInt32,
    overtime_minutes    UInt32,
    late_in_minutes     UInt32,
    payroll_day_factor  Decimal(5,4),
    projection_version  UInt16,
    projected_at        DateTime64(3, 'UTC')
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(attendance_date)
ORDER BY (tenant_id, org_unit_id, attendance_date, employee_id)
SETTINGS index_granularity = 8192;

-- Kafka ingestion engine (reads from event stream)
CREATE TABLE analytics_ch.attendance_kafka_queue
(
    event_data          String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'broker:9092',
    kafka_topic_list = 'workforce.attendance.daily-processed',
    kafka_group_name = 'clickhouse_attendance_consumer',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 4;

-- Materialized view bridges Kafka → MergeTree
CREATE MATERIALIZED VIEW analytics_ch.attendance_kafka_mv
TO analytics_ch.fact_attendance_daily
AS SELECT
    JSONExtractString(event_data, 'tenant_id')::UUID AS tenant_id,
    JSONExtractString(event_data, 'employee_id')::UUID AS employee_id,
    ...
FROM analytics_ch.attendance_kafka_queue;
```

**Query Performance Comparison (PostgreSQL vs ClickHouse):**

| Query | PostgreSQL (100M rows) | ClickHouse (100M rows) |
|---|---|---|
| Monthly attendance rate by org unit | 8,400ms | 180ms |
| 12-month overtime trend by grade | 24,000ms | 340ms |
| Year-over-year absenteeism rate | 45,000ms (timeout risk) | 520ms |
| Payroll cost heatmap by department | 12,000ms | 210ms |

---

## 6.6 Dashboard Freshness Architecture

```
Dashboard Tier 1 — Real-Time Operational (< 15 second lag)
  Data source: Supabase Realtime subscriptions to analytics.kpi_workforce_snapshot
  Trigger: attendance.punch_records INSERT → real-time channel push
  Use case: Today's workforce presence, live punch tracking

Dashboard Tier 2 — Near Real-Time (< 5 minute lag)
  Data source: analytics.kpi_attendance_daily_org + fact tables
  Trigger: attendance.daily_attendance_processed event → consumer upserts
  Use case: Manager dashboards, team attendance, shift coverage

Dashboard Tier 3 — Historical Analytics (< 30 minute lag)
  Data source: ClickHouse (when deployed) or PostgreSQL analytics schema
  Trigger: Periodic batch projection from event log
  Use case: Trend analysis, compliance reports, workforce intelligence

Dashboard Tier 4 — Strategic Reports (batch)
  Data source: ClickHouse + AI predictions
  Trigger: Scheduled overnight batch
  Use case: Executive dashboards, board reports, annual HR analytics
```

---

# Section 7 — AI + Feature Store Architecture

## 7.1 AI Data Architecture Philosophy

The AI domain is the consumer of all operational data — not a producer. Every prediction, recommendation, and insight the AI system generates is grounded in facts owned by operational domains. The AI data architecture must:

1. **Never store raw PII** in feature tables — only anonymized employee UUIDs
2. **Preserve feature lineage** — every prediction must trace to its input features
3. **Version features** — model retraining requires historical feature snapshots at the time of each prediction
4. **Support auditability** — AI decisions affecting compensation or employment must be explainable

---

## 7.2 Feature Store Design

The Feature Store is a specialized data layer that bridges operational OLTP data and ML model training/inference pipelines.

```sql
-- ai.feature_definitions — Feature catalog (schema registry for ML features)
CREATE TABLE ai.feature_definitions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    feature_name        VARCHAR(120) NOT NULL UNIQUE,
    feature_group       VARCHAR(80) NOT NULL,            -- attendance | payroll | leave | engagement
    data_type           VARCHAR(32) NOT NULL,            -- float | int | categorical | boolean
    description         TEXT        NOT NULL,
    source_domain       VARCHAR(80) NOT NULL,
    source_event_type   VARCHAR(120),
    computation_logic   TEXT        NOT NULL,            -- Human-readable formula or description
    is_pii_free         BOOLEAN     NOT NULL DEFAULT TRUE,
    version             INTEGER     NOT NULL DEFAULT 1,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ai.employee_features — Current feature vector per employee (Point-in-time snapshot)
CREATE TABLE ai.employee_features (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,            -- UUID only, no name or PII
    feature_group       VARCHAR(80) NOT NULL,
    feature_snapshot    JSONB       NOT NULL,            -- {feature_name: value, ...}
    computation_period  VARCHAR(32) NOT NULL,            -- rolling_30d | rolling_90d | ytd
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_event_ids    JSONB,                           -- Which events contributed
    model_version       VARCHAR(32),
    UNIQUE(tenant_id, employee_id, feature_group, computation_period, computed_at)
);
CREATE INDEX idx_emp_features_tenant ON ai.employee_features
    (tenant_id, employee_id, feature_group, computed_at DESC);

-- ai.feature_history — Append-only historical feature snapshots (for training datasets)
CREATE TABLE ai.feature_history (
    id                  BIGSERIAL   NOT NULL,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    feature_group       VARCHAR(80) NOT NULL,
    feature_name        VARCHAR(120) NOT NULL,
    feature_value       NUMERIC(18,6),
    feature_value_text  TEXT,
    observation_date    DATE        NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, observation_date)
) PARTITION BY RANGE (observation_date);
CREATE INDEX idx_feature_hist_emp ON ai.feature_history
    (tenant_id, employee_id, feature_group, observation_date);
```

---

## 7.3 Feature Groups and Derivation Logic

### Attendance Features → Attrition + Absence Prediction

```
Feature Group: attendance_behavior

Features derived from attendance.daily_attendance:
  att_present_rate_30d        FLOAT   — days_present / working_days in last 30 days
  att_present_rate_90d        FLOAT   — same, 90-day window
  att_late_in_rate_30d        FLOAT   — late_days / present_days in last 30 days
  att_avg_net_hours_30d       FLOAT   — avg(net_hours_minutes) / 60 last 30 days
  att_overtime_hours_30d      FLOAT   — sum(overtime_minutes) / 60 last 30 days
  att_absent_streak_max_90d   INT     — max consecutive absent days in 90 days
  att_monday_absence_rate     FLOAT   — Monday absences / Mondays worked (proxy for disengagement)
  att_friday_absence_rate     FLOAT   — Friday absences / Fridays worked
  att_anomaly_count_30d       INT     — count of anomaly flags in 30 days
  att_punch_variance_hours    FLOAT   — stddev of first_in_time hour over 30 days
```

### Payroll Features → Anomaly Detection

```
Feature Group: payroll_signals

Features derived from payroll.payslips + payroll.payroll_components:
  pay_gross_mom_change_pct    FLOAT   — (current_gross - prev_gross) / prev_gross
  pay_net_mom_change_pct      FLOAT   — same for net pay
  pay_lop_days_trend_90d      FLOAT   — slope of loss_of_pay_days over 90 days
  pay_overtime_ratio_30d      FLOAT   — overtime_pay / gross_pay in last payroll
  pay_deduction_ratio         FLOAT   — total_deductions / gross_earnings
  pay_arrears_frequency_6m    INT     — count of arrears-included payslips in 6 months
  pay_component_deviation     FLOAT   — |actual_basic - expected_basic| / expected_basic
```

### Leave Features → Workload and Burnout Signals

```
Feature Group: leave_patterns

Features derived from leave.leave_applications + leave.leave_balance_ledger:
  leave_utilization_ytd       FLOAT   — days_taken / days_entitled
  leave_balance_remaining     FLOAT   — current balance in days
  leave_sick_rate_90d         FLOAT   — sick_leave_days / working_days in 90 days
  leave_application_trend     FLOAT   — slope of monthly leave applications
  leave_pending_days          FLOAT   — days of pending leave applications
  leave_rejection_rate        FLOAT   — rejected / (approved + rejected) in 6m
```

### Workflow Features → Engagement Proxy

```
Feature Group: workflow_engagement

Features derived from workflow.workflow_tasks + workflow.workflow_instances:
  wf_avg_decision_hours       FLOAT   — avg hours to complete approval tasks
  wf_overdue_task_count_30d   INT     — tasks past due_at in 30 days
  wf_delegate_frequency       FLOAT   — delegated_tasks / assigned_tasks
```

---

## 7.4 Prediction Persistence

```sql
-- ai.predictions — Output of model inference (immutable record of each prediction)
CREATE TABLE ai.predictions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    prediction_type     VARCHAR(80) NOT NULL,            -- attrition_risk | absence_risk | payroll_anomaly | engagement_score
    -- Model provenance
    model_id            UUID        NOT NULL,
    model_version       VARCHAR(32) NOT NULL,
    feature_snapshot_id UUID        NOT NULL REFERENCES ai.employee_features(id),
    -- Prediction result
    predicted_value     NUMERIC(10,6) NOT NULL,          -- Probability (0-1) or score
    confidence          NUMERIC(5,4),
    risk_tier           VARCHAR(32),                     -- low | medium | high | critical
    prediction_horizon  VARCHAR(32),                     -- 30d | 60d | 90d
    -- Explainability
    feature_importances JSONB,                           -- Top features contributing to prediction
    explanation         TEXT,                            -- Human-readable explanation
    -- Outcome tracking (for model evaluation)
    outcome_observed_at TIMESTAMPTZ,
    outcome_value       NUMERIC(10,6),
    was_correct         BOOLEAN,
    predicted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_predictions_employee ON ai.predictions
    (tenant_id, employee_id, prediction_type, predicted_at DESC);
CREATE INDEX idx_predictions_risk ON ai.predictions
    (tenant_id, prediction_type, risk_tier, predicted_at DESC)
    WHERE risk_tier IN ('high', 'critical');

-- ai.model_registry — ML model lifecycle tracking
CREATE TABLE ai.model_registry (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    model_name          VARCHAR(120) NOT NULL,
    version             VARCHAR(32) NOT NULL,
    model_type          VARCHAR(80) NOT NULL,
    framework           VARCHAR(50) NOT NULL,            -- scikit-learn | pytorch | xgboost
    artifact_path       TEXT        NOT NULL,            -- S3/GCS path to model artifact
    feature_group       VARCHAR(80) NOT NULL,
    training_data_from  DATE        NOT NULL,
    training_data_to    DATE        NOT NULL,
    -- Performance metrics
    training_metrics    JSONB       NOT NULL,
    validation_metrics  JSONB       NOT NULL,
    -- Deployment state
    deployment_stage    VARCHAR(32) NOT NULL DEFAULT 'shadow', -- shadow | canary | production | retired
    deployed_at         TIMESTAMPTZ,
    retired_at          TIMESTAMPTZ,
    -- Governance
    approved_by         UUID,
    approved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(model_name, version)
);
```

---

## 7.5 Vector Storage Strategy

Vector embeddings are used for the AI Copilot — to find semantically similar HR policies, precedent leave decisions, and workforce patterns.

```sql
-- ai.vector_store — pgvector embeddings store
-- Extension: CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE ai.vector_store (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    content_type        VARCHAR(80) NOT NULL,            -- policy | precedent | document | faq
    content_id          UUID        NOT NULL,            -- Source entity ID
    content_hash        TEXT        NOT NULL,            -- SHA-256 of source content (staleness detection)
    embedding           vector(1536) NOT NULL,           -- OpenAI text-embedding-3-small dimensions
    metadata            JSONB       NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, content_type, content_id)
);

-- IVFFLAT index for approximate nearest neighbor search
-- Lists = sqrt(total_rows) as rule of thumb
CREATE INDEX idx_vector_store_embedding ON ai.vector_store
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Tenant-scoped ANN search function
CREATE OR REPLACE FUNCTION ai.search_similar(
    p_tenant_id UUID,
    p_content_type VARCHAR,
    p_query_embedding vector(1536),
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    content_id UUID,
    content_type VARCHAR,
    similarity FLOAT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        vs.content_id,
        vs.content_type,
        1 - (vs.embedding <=> p_query_embedding) AS similarity,
        vs.metadata
    FROM ai.vector_store vs
    WHERE vs.tenant_id = p_tenant_id
      AND (p_content_type IS NULL OR vs.content_type = p_content_type)
    ORDER BY vs.embedding <=> p_query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

**Vector Store Migration Path:**
- **Phase 1 (< 1M vectors):** pgvector within PostgreSQL. IVFFlat index sufficient.
- **Phase 2 (1M–10M vectors):** pgvector with HNSW index (`CREATE INDEX USING hnsw`) for better recall at higher scale.
- **Phase 3 (> 10M vectors):** Migrate to Qdrant or Weaviate as dedicated vector database. pgvector remains as cache for frequently accessed embeddings.

---

## 7.6 AI Telemetry Storage

```sql
-- ai.copilot_sessions — Copilot conversation sessions
CREATE TABLE ai.copilot_sessions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    user_id             UUID        NOT NULL,
    session_type        VARCHAR(50) NOT NULL DEFAULT 'chat',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at            TIMESTAMPTZ,
    message_count       INTEGER     NOT NULL DEFAULT 0,
    tools_used          JSONB,
    satisfaction_rating SMALLINT    CHECK (satisfaction_rating BETWEEN 1 AND 5),
    context             JSONB       NOT NULL DEFAULT '{}'
);

-- ai.copilot_messages — Individual turn record (for fine-tuning and evaluation)
CREATE TABLE ai.copilot_messages (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id          UUID        NOT NULL REFERENCES ai.copilot_sessions(id),
    tenant_id           UUID        NOT NULL,
    turn_number         INTEGER     NOT NULL,
    role                VARCHAR(20) NOT NULL,            -- user | assistant | tool
    -- Content (abstracted for compliance — actual content may be stored encrypted)
    intent_class        VARCHAR(80),                     -- Classified intent
    tool_calls          JSONB,
    grounding_sources   JSONB,                           -- Which policies/data grounded the response
    latency_ms          INTEGER,
    token_count         INTEGER,
    model_used          VARCHAR(80),
    thumbs_up           BOOLEAN,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_copilot_messages_session ON ai.copilot_messages (session_id, turn_number);

-- ai.model_drift_metrics — Ongoing model performance tracking
CREATE TABLE ai.model_drift_metrics (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    model_id            UUID        NOT NULL REFERENCES ai.model_registry(id),
    tenant_id           UUID,                            -- NULL = platform-wide
    evaluation_date     DATE        NOT NULL,
    sample_size         INTEGER     NOT NULL,
    accuracy            NUMERIC(6,4),
    precision_score     NUMERIC(6,4),
    recall_score        NUMERIC(6,4),
    f1_score            NUMERIC(6,4),
    auc_roc             NUMERIC(6,4),
    prediction_drift    NUMERIC(6,4),                   -- KL divergence vs baseline
    feature_drift       JSONB,                           -- Per-feature drift scores
    retrain_triggered   BOOLEAN     NOT NULL DEFAULT FALSE,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# Section 8 — Event Persistence Architecture

## 8.1 Outbox Tables — Per-Domain Design

Each domain schema has its own outbox table. The outbox is the transactional bridge between domain mutation and event publication.

```sql
-- Template for all domain outbox tables
-- Each domain implements this exact schema (enforced by migration framework)
-- Example: attendance.outbox

CREATE TABLE attendance.outbox (
    id                  BIGSERIAL   NOT NULL,
    event_id            UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    tenant_id           UUID        NOT NULL,
    event_type          VARCHAR(120) NOT NULL,
    event_version       INTEGER     NOT NULL DEFAULT 1,
    aggregate_type      VARCHAR(80) NOT NULL,
    aggregate_id        UUID        NOT NULL,
    correlation_id      UUID,
    causation_id        UUID,
    payload             JSONB       NOT NULL,
    metadata            JSONB       NOT NULL DEFAULT '{}',
    -- Relay state
    status              VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending | published | failed | dead
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_after     TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- For delayed events
    published_at        TIMESTAMPTZ,
    publish_attempts    SMALLINT    NOT NULL DEFAULT 0,
    last_error          TEXT,
    -- Prioritization
    priority            SMALLINT    NOT NULL DEFAULT 100,
    PRIMARY KEY (id)
);

CREATE INDEX idx_outbox_relay ON attendance.outbox
    (priority, scheduled_after, id)
    WHERE status = 'pending';

CREATE INDEX idx_outbox_event_id ON attendance.outbox (event_id);
CREATE INDEX idx_outbox_tenant ON attendance.outbox (tenant_id, created_at)
    WHERE status = 'pending';
```

**Outbox Relay — Concurrent-Safe Polling:**
```sql
-- Relay worker acquires a batch of pending events without contention
-- Using SKIP LOCKED to prevent multiple workers from grabbing the same row
WITH pending_batch AS (
    SELECT id
    FROM attendance.outbox
    WHERE status = 'pending'
      AND scheduled_after <= NOW()
    ORDER BY priority ASC, scheduled_after ASC, id ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE attendance.outbox
SET
    status = 'processing',
    publish_attempts = publish_attempts + 1
FROM pending_batch
WHERE attendance.outbox.id = pending_batch.id
RETURNING attendance.outbox.*;
```

---

## 8.2 Event Store — Append-Only Canonical Event Log

The Event Store is the permanent, queryable history of all published events. Unlike the outbox (which is a transient queue), the event store is the long-term record of every domain event in the system.

```sql
-- events.event_store — Platform-wide immutable event log
CREATE TABLE events.event_store (
    id                  BIGSERIAL   NOT NULL,
    event_id            UUID        NOT NULL UNIQUE,
    tenant_id           UUID        NOT NULL,
    event_type          VARCHAR(120) NOT NULL,
    event_version       INTEGER     NOT NULL,
    event_category      VARCHAR(50) NOT NULL,
    aggregate_type      VARCHAR(80) NOT NULL,
    aggregate_id        UUID        NOT NULL,
    aggregate_sequence  BIGINT      NOT NULL,
    -- Causation chain
    correlation_id      UUID,
    causation_id        UUID,
    actor_id            UUID,
    -- Content
    payload             JSONB       NOT NULL,
    metadata            JSONB,
    -- Temporal
    occurred_at         TIMESTAMPTZ NOT NULL,
    published_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Integrity
    payload_hash        TEXT        NOT NULL,            -- SHA-256 of payload
    chain_hash          TEXT        NOT NULL,            -- SHA-256 of (prev_hash + payload_hash)
    PRIMARY KEY (id, published_at)
) PARTITION BY RANGE (published_at);

-- Monthly partitions
CREATE TABLE events.event_store_2025_01
    PARTITION OF events.event_store
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE INDEX idx_event_store_tenant ON events.event_store
    (tenant_id, published_at, event_type);
CREATE INDEX idx_event_store_aggregate ON events.event_store
    (aggregate_type, aggregate_id, aggregate_sequence);
CREATE INDEX idx_event_store_correlation ON events.event_store
    (correlation_id) WHERE correlation_id IS NOT NULL;
```

---

## 8.3 Event Consumer Registry and Idempotency

```sql
-- events.consumer_registry — Registered event consumers
CREATE TABLE events.consumer_registry (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    consumer_name       VARCHAR(120) NOT NULL UNIQUE,
    consumer_domain     VARCHAR(80) NOT NULL,
    subscribed_events   JSONB       NOT NULL,            -- Array of event_type patterns
    min_version         INTEGER     NOT NULL DEFAULT 1,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- events.processed_events — Idempotency table per consumer
CREATE TABLE events.processed_events (
    consumer_name       VARCHAR(120) NOT NULL,
    event_id            UUID        NOT NULL,
    tenant_id           UUID        NOT NULL,
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result_summary      TEXT,
    PRIMARY KEY (consumer_name, event_id)
);
CREATE INDEX idx_processed_events_recent ON events.processed_events
    (consumer_name, processed_at);

-- Idempotent consumption pattern (used by every consumer):
-- INSERT INTO events.processed_events (consumer_name, event_id, tenant_id)
-- VALUES ($consumer, $event_id, $tenant_id)
-- ON CONFLICT (consumer_name, event_id) DO NOTHING
-- RETURNING consumer_name;
-- -- If no row returned → already processed, skip
```

---

## 8.4 Event Replay Architecture

```sql
-- events.replay_requests — Controlled event replay queue
CREATE TABLE events.replay_requests (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    requested_by        UUID        NOT NULL,
    consumer_name       VARCHAR(120) NOT NULL,
    event_type_filter   VARCHAR(120),                    -- NULL = all types
    aggregate_type_filter VARCHAR(80),
    aggregate_id_filter UUID,
    tenant_id_filter    UUID,
    -- Time window
    from_timestamp      TIMESTAMPTZ NOT NULL,
    to_timestamp        TIMESTAMPTZ NOT NULL,
    -- State
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    events_replayed     INTEGER     NOT NULL DEFAULT 0,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    reason              TEXT        NOT NULL,
    approved_by         UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Replay execution clears processed_events records for the consumer+event_ids
-- then re-delivers through the same consumption pipeline
-- This ensures idempotency layer prevents double-processing of idempotent operations
-- but allows re-execution of state-rebuilding projections
```

---

## 8.5 Event Retention Policy

| Event Category | Hot Retention (PostgreSQL) | Warm Retention (S3/Archive) | Compliance Requirement |
|---|---|---|---|
| Domain operational events | 6 months | 24 months | 2 years |
| Payroll events | 12 months | 7 years | Statutory (PF/ESIC) |
| Audit events | 12 months | Indefinite | Compliance mandate |
| AI telemetry events | 3 months | 12 months | Internal policy |
| System/infra events | 30 days | 6 months | Operational |
| Security events | 12 months | 5 years | Compliance mandate |

**Archival Mechanism:**
```sql
-- pg_cron job: archive events older than hot retention window
-- Runs monthly, moves data to S3-backed foreign table or exports to Parquet

SELECT cron.schedule('archive-old-events', '0 3 1 * *', $$
DO $$
DECLARE
    archive_before TIMESTAMPTZ := NOW() - INTERVAL '6 months';
    partition_name TEXT;
BEGIN
    -- Detach old partition from event_store
    partition_name := 'event_store_' || to_char(archive_before - INTERVAL '1 month', 'YYYY_MM');
    EXECUTE format('ALTER TABLE events.event_store DETACH PARTITION events.%I', partition_name);
    -- Export to S3 via pg_dump or COPY TO (handled by external archival job)
    -- Record archival in retention_log
    INSERT INTO events.retention_log (partition_name, archived_at, archive_location)
    VALUES (partition_name, NOW(), 's3://workforce-archive/events/' || partition_name);
END;
$$;
$$);
```



---


# Section 9 — Audit + Governance Architecture

## 9.1 Audit Architecture Philosophy

The audit architecture operates on two inviolable constraints:

**Constraint 1 — Append-Only:** No audit record is ever updated or deleted within its retention window. The `audit.event_log` is an insertion-only table. Application code has no UPDATE or DELETE path to this table. The database role used by the application has INSERT privilege only on audit tables.

**Constraint 2 — Tamper-Evidence:** Every audit record carries a cryptographic signature (HMAC-SHA256) computed at insertion time. A hash chain links each record to the previous record, making record deletion or reordering detectable.

```
Hash Chain Design:
  record[n].chain_hash = HMAC-SHA256(
    key = audit_signing_key,
    message = record[n-1].chain_hash || record[n].event_id || record[n].payload_hash
  )

  Verification: replay chain from anchor record, detect any break.
  Break = either deletion, reordering, or tampering of intermediate record.
```

---

## 9.2 Audit Role Architecture

```sql
-- Database role with INSERT-only on audit tables
CREATE ROLE audit_writer NOLOGIN;
GRANT USAGE ON SCHEMA audit TO audit_writer;
GRANT INSERT ON TABLE audit.event_log TO audit_writer;
-- Explicitly NO UPDATE, NO DELETE grants

-- Application service authenticates as audit_writer for all audit writes
-- This prevents accidental or malicious mutation even with compromised application code

-- Separate read role for audit queries (restricted to authorized personnel)
CREATE ROLE audit_reader NOLOGIN;
GRANT USAGE ON SCHEMA audit TO audit_reader;
GRANT SELECT ON TABLE audit.event_log TO audit_reader;
```

---

## 9.3 Domain-Specific Audit Requirements

### Payroll Auditability

Every payroll event generates a detailed audit record. The audit captures not just *what changed* but *why it changed* and *what data was used*.

```sql
-- Payroll-specific audit requirements:
-- Every PayrollRun status transition
-- Every Payslip finalization
-- Every component value override
-- Every statutory filing submission
-- Every arrears request creation

-- Example audit record for payroll run finalization:
INSERT INTO audit.event_log (
    tenant_id, domain, entity_type, entity_id, action,
    actor_id, actor_type,
    before_state, after_state,
    correlation_id, occurred_at, signature
) VALUES (
    'tenant-uuid', 'payroll', 'PayrollRun', 'run-uuid', 'finalized',
    'user-uuid', 'user',
    '{"status": "approved", "is_locked": false}'::jsonb,
    '{"status": "finalized", "is_locked": true, "finalized_at": "2025-03-31T23:59:59Z"}'::jsonb,
    'correlation-uuid',
    NOW(),
    hmac(
        concat('event-uuid', 'run-uuid', 'finalized', now()::text),
        current_setting('audit.signing_key'),
        'sha256'
    )
);
```

### Attendance Auditability

```
Attendance audit events:
  punch_created          — Every new punch record
  punch_voided           — When a punch is marked as invalid
  punch_corrected        — When supervisor creates corrective punch
  daily_attendance_computed  — When daily summary is computed (with policy version)
  daily_attendance_recalculated — When recalculation occurs (with before/after delta)
  payroll_lock_applied   — When daily record is locked by payroll
  attendance_snapshot_created — When snapshot taken for payroll
```

### AI Decision Auditability

AI-generated decisions that affect employment outcomes require the highest audit fidelity:

```sql
-- audit.ai_decision_log — Specialized audit for AI-influenced decisions
CREATE TABLE audit.ai_decision_log (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    decision_type       VARCHAR(80) NOT NULL,            -- attrition_flag | absence_risk_alert | anomaly_alert
    -- AI provenance
    model_id            UUID        NOT NULL,
    model_version       VARCHAR(32) NOT NULL,
    prediction_id       UUID        NOT NULL,
    predicted_value     NUMERIC(10,6) NOT NULL,
    confidence          NUMERIC(5,4),
    feature_snapshot    JSONB       NOT NULL,            -- Full feature vector used
    feature_importances JSONB       NOT NULL,
    -- Human review
    reviewed_by         UUID,
    review_action       VARCHAR(50),                     -- accepted | overridden | dismissed
    review_notes        TEXT,
    reviewed_at         TIMESTAMPTZ,
    -- Record integrity
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signature           TEXT        NOT NULL
);
```

---

## 9.4 WORM Retention and Legal Hold

```sql
-- audit.retention_policies — Per-domain retention configuration
CREATE TABLE audit.retention_policies (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    domain              VARCHAR(80) NOT NULL UNIQUE,
    retention_years     INTEGER     NOT NULL,
    worm_required       BOOLEAN     NOT NULL DEFAULT FALSE,
    legal_basis         TEXT,
    jurisdiction        VARCHAR(80) NOT NULL DEFAULT 'IN',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO audit.retention_policies VALUES
    (gen_random_uuid(), 'payroll',          7, TRUE,  'Income Tax Act / PF Act', 'IN'),
    (gen_random_uuid(), 'attendance',       5, FALSE, 'Shops & Establishments Act', 'IN'),
    (gen_random_uuid(), 'statutory_filing', 8, TRUE,  'PF/ESIC statutory requirement', 'IN'),
    (gen_random_uuid(), 'leave',            5, FALSE, 'Internal policy', 'IN'),
    (gen_random_uuid(), 'identity',         7, FALSE, 'IT Act / DPDP Act', 'IN'),
    (gen_random_uuid(), 'ai_decisions',     3, FALSE, 'DPDP Act', 'IN');

-- audit.legal_holds — Prevent data deletion for entities under legal hold
CREATE TABLE audit.legal_holds (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    entity_type         VARCHAR(80) NOT NULL,
    entity_id           UUID        NOT NULL,
    hold_reason         TEXT        NOT NULL,
    placed_by           UUID        NOT NULL,
    placed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_by         UUID,
    released_at         TIMESTAMPTZ,
    is_active           BOOLEAN     NOT NULL GENERATED ALWAYS AS (released_at IS NULL) STORED
);
CREATE INDEX idx_legal_holds_active ON audit.legal_holds
    (tenant_id, entity_type, entity_id)
    WHERE released_at IS NULL;

-- Deletion guard function (called by any data deletion path)
CREATE OR REPLACE FUNCTION audit.check_legal_hold(
    p_tenant_id UUID,
    p_entity_type VARCHAR,
    p_entity_id UUID
) RETURNS VOID AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM audit.legal_holds
        WHERE tenant_id = p_tenant_id
          AND entity_type = p_entity_type
          AND entity_id = p_entity_id
          AND released_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Entity % of type % is under legal hold. Cannot delete.',
            p_entity_id, p_entity_type
            USING ERRCODE = 'P0001';
    END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## 9.5 GDPR/DPDP Data Subject Rights

```sql
-- audit.erasure_requests — GDPR/DPDP right to erasure
CREATE TABLE audit.erasure_requests (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    employee_id         UUID        NOT NULL,
    user_id             UUID        NOT NULL,
    request_type        VARCHAR(50) NOT NULL DEFAULT 'erasure', -- erasure | export | rectification
    status              VARCHAR(32) NOT NULL DEFAULT 'pending',
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    legal_hold_check    BOOLEAN     NOT NULL DEFAULT FALSE,
    retention_check     BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Processing log
    processed_domains   JSONB       NOT NULL DEFAULT '[]',
    pseudonymized_fields JSONB,
    completed_at        TIMESTAMPTZ,
    completion_notes    TEXT
);

-- Erasure strategy for HRMS:
-- PII fields → pseudonymize (replace with "ERASED_<hash>"), NOT delete
-- Why: Payroll records reference employee_id for 7 years (statutory)
-- Deleting the record breaks statutory compliance
-- Pseudonymization satisfies DPDP while preserving audit integrity
-- Event store: payload PII fields set to null in event, original event_id preserved
```

---

# Section 10 — Migration Strategy

## 10.1 Schema Migration Philosophy

The Workforce OS adopts **evolutionary database design** — schemas evolve incrementally through a sequence of safe, reversible, independently-deployable changes. The database is never in a "migration pending" state during production traffic.

**Five Laws of Safe Migration:**
1. Every migration is backward compatible with the previous application version
2. Column additions precede application deployments that use them
3. Column removals follow application deployments that stop using them
4. No migration holds an exclusive table lock for more than 2 seconds
5. Every migration is tested in production-equivalent scale before deployment

---

## 10.2 Migration Tooling Stack

| Layer | Tool | Purpose |
|---|---|---|
| Schema migrations | **Prisma Migrate** + raw SQL escape hatch | Versioned schema changes |
| Large table migrations | **pg_repack** | Online table rebuilds without lock |
| Partition management | **pg_cron** + custom jobs | Automated partition creation/archival |
| Migration orchestration | **Atlas** or custom CI pipeline | Multi-environment promotion |
| Seed data management | Domain-specific seed scripts | Environment bootstrapping |
| Migration testing | **pgTAP** + synthetic load testing | Pre-production validation |

---

## 10.3 Prisma Migration Governance

```
Migration Naming Convention:
  {timestamp}_{domain}_{change_description}

Example:
  20250315120000_attendance_add_punch_source_column
  20250316090000_payroll_partition_ledger_table
  20250320140000_employee_add_work_location_id_index

Migration File Structure:
  prisma/
    migrations/
      20250315120000_attendance_add_punch_source_column/
        migration.sql       ← Forward migration (applied automatically)
        rollback.sql        ← Manual rollback procedure (not auto-applied)
        migration.md        ← Change rationale and impact assessment
        test.sql            ← pgTAP test assertions

Migration Review Requirements:
  □ Impact assessment completed (which tables, estimated row count)
  □ Lock duration estimated (SHARE vs ACCESS EXCLUSIVE)
  □ Rollback procedure documented
  □ Backward compatibility verified
  □ Performance tested on production-scale data copy
  □ Partition awareness confirmed (if partitioned table)
```

---

## 10.4 Zero-Downtime Migration Patterns

### Pattern 1 — Expand-Contract for Column Addition

```sql
-- PHASE 1: Expand (deploy migration, no application change needed)
-- Safe: ADD COLUMN with DEFAULT takes ACCESS EXCLUSIVE lock briefly in PG 11+
-- In PG 11+, ADD COLUMN with constant DEFAULT does NOT rewrite the table
ALTER TABLE attendance.punch_records
ADD COLUMN punch_source VARCHAR(32) DEFAULT 'unknown';

-- PHASE 2: Application deployed that reads/writes the new column
-- Old instances ignore the column, new instances use it

-- PHASE 3: Backfill (if needed, using batch UPDATE to avoid lock)
DO $$
DECLARE
    batch_size INT := 5000;
    updated INT := 1;
BEGIN
    WHILE updated > 0 LOOP
        UPDATE attendance.punch_records
        SET punch_source = 'biometric'
        WHERE punch_source = 'unknown'
          AND id IN (
              SELECT id FROM attendance.punch_records
              WHERE punch_source = 'unknown'
              LIMIT batch_size
          );
        GET DIAGNOSTICS updated = ROW_COUNT;
        PERFORM pg_sleep(0.1); -- Yield between batches
    END LOOP;
END;
$$;

-- PHASE 4: Contract — add NOT NULL constraint after backfill
-- Using a CHECK CONSTRAINT first (no table scan on PG 15+)
ALTER TABLE attendance.punch_records
ADD CONSTRAINT chk_punch_source_not_null CHECK (punch_source IS NOT NULL) NOT VALID;

-- Validate without holding lock for entire table
ALTER TABLE attendance.punch_records
VALIDATE CONSTRAINT chk_punch_source_not_null;

-- Then convert to NOT NULL (uses validated constraint, fast)
ALTER TABLE attendance.punch_records ALTER COLUMN punch_source SET NOT NULL;
```

### Pattern 2 — Online Index Creation

```sql
-- CREATE INDEX CONCURRENTLY does not hold exclusive lock
-- Takes longer but does not block writes
CREATE INDEX CONCURRENTLY idx_punch_records_new_field
ON attendance.punch_records (tenant_id, punch_source, effective_at)
WHERE status != 'voided';

-- If concurrent index creation fails, cleanup required before retry:
-- DROP INDEX CONCURRENTLY IF EXISTS idx_punch_records_new_field;
```

### Pattern 3 — Table Partitioning Migration (Existing Table)

This is the most dangerous migration type. Converting an existing non-partitioned table to a partitioned table requires:

```
Step 1: Create the new partitioned table with a different name
  CREATE TABLE attendance.punch_records_partitioned (LIKE attendance.punch_records)
  PARTITION BY RANGE (punched_at);

Step 2: Create initial partitions covering all existing data
  CREATE TABLE attendance.punch_records_partitioned_archive ...
  CREATE TABLE attendance.punch_records_partitioned_2024_01 ...
  ... (all historical months)
  ... (current + future months)

Step 3: Create all indexes on the new partitioned table

Step 4: Migrate data in batches (off-peak, throttled)
  INSERT INTO punch_records_partitioned
  SELECT * FROM punch_records
  WHERE effective_at >= '2024-01-01' AND effective_at < '2024-02-01';
  -- Repeat per month

Step 5: Enable write-forwarding trigger on original table
  -- New writes go to BOTH tables during switchover window

Step 6: Blue/green DNS switch at router level
  -- New application version points to punch_records_partitioned
  -- Old application version continues to write original table

Step 7: Drain, verify row counts, drop dual-write trigger

Step 8: Rename tables atomically
  BEGIN;
  ALTER TABLE attendance.punch_records RENAME TO punch_records_legacy;
  ALTER TABLE attendance.punch_records_partitioned RENAME TO punch_records;
  COMMIT;

Step 9: Validate, then drop legacy table after 48-hour observation window
```

---

## 10.5 Tenant-Safe Migration Strategy

For Tier 3 (schema-per-tenant) deployments, migrations must be orchestrated per tenant:

```
Migration Orchestration for Schema-Per-Tenant:

1. Staging: Apply migration to staging schema
2. Validation: Run automated pgTAP tests
3. Canary: Apply to 1 tenant schema (smallest, non-critical)
4. Observation: 4-hour production observation window
5. Progressive rollout: Migrate 10% of tenants per hour
6. Full rollout: Complete remaining tenants
7. Cleanup: Remove backward-compat shims

If migration fails at any tenant:
  - Stop rollout immediately
  - Apply rollback.sql to affected tenant
  - Root cause investigation before resuming
```

---

## 10.6 Blue/Green Database Migration

For major schema overhauls (new domain schema, partition strategy change):

```
Blue/Green Process:

BLUE (current production)     GREEN (new production)
───────────────────────       ──────────────────────
PostgreSQL primary             New PostgreSQL instance
Current schema                 New schema applied

Phase 1: Provision GREEN, apply migrations
Phase 2: Set up logical replication: BLUE → GREEN
Phase 3: Validate GREEN data completeness
Phase 4: Application deployed to GREEN (read-only initially)
Phase 5: Traffic split: 10% to GREEN, 90% to BLUE
Phase 6: Monitor error rates, latency, data consistency
Phase 7: Progressive shift: 10% → 50% → 100%
Phase 8: BLUE demoted to read-only replica
Phase 9: BLUE decommissioned after 48 hours
```

---

## 10.7 Migration Testing Framework

```sql
-- pgTAP test example for attendance partition migration
BEGIN;
SELECT plan(6);

-- Test 1: Table exists
SELECT has_table('attendance', 'punch_records', 'punch_records table exists');

-- Test 2: Required columns present
SELECT has_column('attendance', 'punch_records', 'tenant_id', 'tenant_id column exists');
SELECT has_column('attendance', 'punch_records', 'punch_source', 'punch_source column exists');

-- Test 3: Indexes present
SELECT has_index('attendance', 'punch_records', 'idx_punch_tenant_employee',
    'Primary lookup index exists');

-- Test 4: RLS enabled
SELECT ok(
    (SELECT rowsecurity FROM pg_tables
     WHERE schemaname = 'attendance' AND tablename = 'punch_records'),
    'RLS is enabled on punch_records'
);

-- Test 5: Tenant isolation works
SET app.current_tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT is(
    (SELECT COUNT(*)::INT FROM attendance.punch_records
     WHERE tenant_id != 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::UUID),
    0,
    'RLS prevents cross-tenant reads'
);

-- Test 6: Immutability trigger fires
SELECT throws_ok(
    $$UPDATE attendance.daily_attendance
      SET net_hours_minutes = 999
      WHERE is_payroll_locked = TRUE LIMIT 1$$,
    'P0001',
    'Cannot modify attendance record locked by payroll run',
    'Payroll lock trigger prevents mutation'
);

SELECT finish();
ROLLBACK;
```

---

# Section 11 — Existing System Evolution Strategy

## 11.1 Evolution Principles

The existing system contains **valuable operational logic** accumulated through production usage. The strategy is to preserve this logic while migrating it into the new architectural framework. No destructive rewrites. No big-bang migrations.

```
Evolution Decision Framework:
  RETAIN   — Table structure and logic are already aligned. Add tenant_id + RLS + index tuning.
  REFACTOR — Structure is correct but needs temporal modeling, partitioning, or schema move.
  PARTITION — Table exists and has correct structure but is growing too large; add partitioning.
  ARCHIVE  — Table contains historical data that should move to cold storage tier.
  REBUILD  — Table has fundamental structural misalignment with domain model. Rewrite required.
```

---

## 11.2 Attendance Engine Evolution

| Component | Current State | Decision | Rationale | Migration Plan |
|---|---|---|---|---|
| Punch records table | Single unpartitioned table | **PARTITION** | Growing at 40K rows/day. Query degradation expected at >10M rows | Monthly range partition by `punched_at`. Use pg_repack for online conversion |
| Daily attendance summary | Computed and stored per-day | **REFACTOR** | Add `policy_version_id`, `computation_version`, `is_payroll_locked`, `payroll_period_id`. Add payroll lock trigger | Expand-contract column additions. Backfill new columns from existing data |
| Shift resolution logic | Application code, no persistence | **RETAIN + PERSIST** | Logic is correct; add `shift_id` to daily_attendance to make resolution auditable | Add shift_id column. Backfill from shift schedules where resolvable |
| Biometric device logs | Flat log table | **ARCHIVE** | Raw device logs are not queried operationally. Keep 90 days hot, move to cold | pg_cron monthly archival job. S3 export of old partitions |
| Overtime calculation | Application-only computation | **REFACTOR** | Add OT minutes to daily_attendance for auditability | Column additions to daily_attendance. OT calculation results persisted at computation time |
| Anomaly detection results | In-memory flags, not persisted | **REBUILD** | Anomalies must be persisted for supervisor resolution workflow | New `attendance.attendance_anomalies` table. Event-driven population |

---

## 11.3 Leave Engine Evolution

| Component | Current State | Decision | Rationale | Migration Plan |
|---|---|---|---|---|
| Leave balances | Single-row mutable balance per employee | **REFACTOR** | Missing `balance_year` column. No ledger history. Balance changes not auditable | Add `balance_year`. Create `leave_balance_ledger` append-only table. Backfill ledger from balance deltas where computable |
| Leave applications | Monolithic status field | **RETAIN** | Status lifecycle is correct. Needs `workflow_instance_id` linkage | Add `workflow_instance_id` column (nullable for backward compat) |
| Leave type configuration | Static config table | **RETAIN** | Add `effective_from` / `effective_to` for temporal versioning | Column additions. Default effective_from = created_at |
| Leave accrual runs | No persistence | **REBUILD** | Accrual logic runs without persisting input/output. Not auditable | New `leave.leave_accrual_runs` table. Each accrual run generates ledger entries |
| Holiday calendar | Single flat table | **RETAIN** | Add `tenant_id` and `location_id` for multi-tenant multi-location support | Column additions + RLS policy |

---

## 11.4 Payroll Engine Evolution

| Component | Current State | Decision | Rationale | Migration Plan |
|---|---|---|---|---|
| Payroll runs | Basic status table | **REFACTOR** | Add `attendance_snapshot_id`, `is_locked`, `finalized_at`. Add immutability trigger | Expand-contract additions. Add trigger on existing table |
| Payslips | Aggregate totals only | **REFACTOR** | Missing computation lineage fields (`attendance_snapshot_ids`, `policy_version_ids`, `compensation_record_id`) | Add JSONB lineage columns with null defaults. Application populates on new runs |
| Component breakdown | Stored as JSONB in payslip | **REFACTOR → SPLIT** | Move component detail to separate `payroll_components` table for queryability | Create `payroll_components` table. Migrate existing JSONB components to rows. Dual-write during transition |
| Payroll ledger | None or simple log | **REBUILD** | No double-entry ledger. Cannot produce P&L or liability reports | New `payroll.payroll_ledger` table. Backfill from finalized payslips where possible |
| Statutory filings | Computed but not persisted | **REBUILD** | No immutable record of what was filed. Cannot answer audit queries | New `payroll.statutory_filings` table with WORM trigger |
| Arrears management | Ad-hoc component overrides | **REBUILD** | No structured arrears tracking. Cannot trace correction → arrears → payslip | New `payroll.arrears_requests` table. Link to originating correction |

---

## 11.5 Workflow Engine Evolution

| Component | Current State | Decision | Rationale | Migration Plan |
|---|---|---|---|---|
| Workflow templates | JSONB blobs in config table | **RETAIN** | Structure is acceptable. Add `version` and `is_active` fields | Column additions. Create unique constraint on (tenant_id, entity_type, version) |
| Workflow instances | Status + metadata JSONB | **RETAIN** | Add `sla_deadline`, `context` JSONB, `started_at`. SLA tracking capability | Expand-contract additions |
| Approval tasks | Flat approval log | **REFACTOR** | Move from flat log to structured `workflow_tasks` with `stage_key`, `task_type`, `decision` | New `workflow.workflow_tasks` table. Migrate existing approval records |
| Escalation rules | Hardcoded in application | **REFACTOR** | Move to workflow template `definition` JSONB. Allows tenant-specific escalation | Template JSONB schema extension. Application reads escalation from template |

---

## 11.6 Notification System Evolution

| Component | Current State | Decision | Rationale | Migration Plan |
|---|---|---|---|---|
| Notification log | Events fired and forgotten | **REBUILD** | No delivery tracking, no retry, no preference enforcement | New `notification.delivery_log` and `notification.preferences` tables |
| Email templates | Hardcoded strings | **REFACTOR** | Move to tenant-configurable template table | New `notification.templates` table. Migration script creates default templates from hardcoded strings |
| Push notification tokens | Device tokens in user table | **REFACTOR** | Move to dedicated `notification.device_tokens` table | New table. Migrate existing tokens. Add expiry tracking |

---

## 11.7 Analytics Evolution

| Component | Current State | Decision | Rationale | Migration Plan |
|---|---|---|---|---|
| Dashboard queries | Direct OLTP queries | **REFACTOR** | Replace with reads from `analytics.*` read models | Create read models. Switch dashboard queries. Monitor query routing |
| Reporting queries | Custom SQL per report | **REFACTOR** | Replace with KPI tables + event-driven projections | Create KPI tables. Build event consumers to project. Dashboard switch |
| Export/download | Full OLTP table exports | **RETAIN + LIMIT** | Limit export row counts. Route large exports to analytics schema | Application-level max_rows enforcement. Background export jobs |
| ClickHouse | Not yet deployed | **FUTURE** | Deploy when PostgreSQL analytics exceeds thresholds | Phase 3 deployment. Event stream projection setup |

---

# Section 12 — Repository + Data Access Strategy

## 12.1 Why Inline Queries Are Dangerous

Inline SQL in application code (service functions, route handlers, GraphQL resolvers) is the most common cause of data layer architectural debt in rapidly-built platforms:

```
Danger 1 — Query Duplication
  The same business query is written in 5 different places with 5 slightly
  different filter conditions. When the schema changes, 4 of 5 are updated.
  The 5th causes a data inconsistency that manifests 3 months later.

Danger 2 — Missing Tenant Isolation
  A developer forgets to add WHERE tenant_id = $1.
  In a shared-schema multi-tenant system, this returns all tenants' data.
  No compiler error. No test catches it. Deployed to production.

Danger 3 — N+1 Query Patterns
  ORM-style lazy loading generates N queries instead of 1 JOIN.
  Works fine in development. Destroys performance at scale.

Danger 4 — Schema Coupling
  Application code knows the exact column names and table structure.
  Schema refactoring breaks application code in unpredictable locations.
  
Danger 5 — Transaction Boundary Confusion
  Multiple service functions called within an assumed single transaction
  that is actually multiple transactions. Partial failure = inconsistent state.
```

---

## 12.2 Repository Architecture

```
┌────────────────────────────────────────────────────────────┐
│                   DATA ACCESS LAYERS                        │
│                                                            │
│  Domain Service (business logic)                           │
│       │                                                    │
│       ▼                                                    │
│  Repository Interface (domain-defined contract)            │
│  - AttendanceRepository                                    │
│  - PayrollRepository                                       │
│  - EmployeeRepository                                      │
│       │                                                    │
│       ▼                                                    │
│  Repository Implementation (infrastructure layer)          │
│  - PostgresAttendanceRepository                           │
│  - Encapsulates all SQL                                   │
│  - Enforces tenant context on every query                  │
│  - Manages transaction boundaries                          │
│       │                                                    │
│       ▼                                                    │
│  Database Client (Prisma / pg / Supabase client)           │
│  - Connection pooling                                      │
│  - Statement timeout enforcement                           │
│  - Tenant context injection (SET app.current_tenant_id)    │
└────────────────────────────────────────────────────────────┘
```

---

## 12.3 Repository Contract Design

```typescript
// Repository interface — domain-owned contract (no SQL leakage)
interface AttendanceRepository {
    // Write operations
    savePunchRecord(punch: PunchRecord): Promise<PunchRecord>;
    voidPunchRecord(punchId: UUID, reason: string, actorId: UUID): Promise<void>;
    saveDailyAttendance(record: DailyAttendance): Promise<DailyAttendance>;
    lockDailyAttendanceForPayroll(
        employeeId: UUID,
        periodId: UUID,
        dateFrom: Date,
        dateTo: Date
    ): Promise<number>; // Returns count of locked records

    // Read operations
    findPunchRecordsByEmployee(
        employeeId: UUID,
        from: Date,
        to: Date
    ): Promise<PunchRecord[]>;

    findDailyAttendance(
        employeeId: UUID,
        date: Date
    ): Promise<DailyAttendance | null>;

    findUnprocessedPunches(
        date: Date,
        limit: number
    ): Promise<PunchRecord[]>;

    findRecalculationRequests(limit: number): Promise<RecalculationRequest[]>;

    // Aggregate queries (returns read model, not domain entity)
    getAttendanceSummary(
        orgUnitId: UUID,
        date: Date
    ): Promise<AttendanceSummary>;
}

// Implementation enforces tenant context automatically
class PostgresAttendanceRepository implements AttendanceRepository {
    constructor(
        private readonly db: DatabaseClient,
        private readonly tenantContext: TenantContext  // Injected, cannot be bypassed
    ) {}

    async findPunchRecordsByEmployee(
        employeeId: UUID,
        from: Date,
        to: Date
    ): Promise<PunchRecord[]> {
        // tenant_id ALWAYS included — enforced in implementation, not caller
        const result = await this.db.query(
            `SELECT * FROM attendance.punch_records
             WHERE tenant_id = $1      -- Cannot be omitted
               AND employee_id = $2
               AND effective_at BETWEEN $3 AND $4
               AND status != 'voided'
             ORDER BY effective_at ASC`,
            [this.tenantContext.tenantId, employeeId, from, to]
        );
        return result.rows.map(mapToPunchRecord);
    }
}
```

---

## 12.4 Transaction Boundary Management

```typescript
// Unit of Work pattern — all domain operations in a single transaction
interface UnitOfWork {
    attendanceRepo: AttendanceRepository;
    auditRepo: AuditRepository;
    outboxRepo: OutboxRepository;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

// Usage in domain service — all operations atomic
async function processDailyAttendance(
    employeeId: UUID,
    date: Date
): Promise<void> {
    const uow = await unitOfWorkFactory.create();

    try {
        const punches = await uow.attendanceRepo.findUnprocessedPunches(date, employeeId);
        const dailyRecord = computeDailyAttendance(punches, policy);

        // All of these happen atomically or none do:
        await uow.attendanceRepo.saveDailyAttendance(dailyRecord);
        await uow.auditRepo.logEvent(createAuditRecord(dailyRecord));
        await uow.outboxRepo.enqueue(createDailyProcessedEvent(dailyRecord));

        await uow.commit(); // Single commit, all or nothing
    } catch (error) {
        await uow.rollback();
        throw error;
    }
}
```

---

## 12.5 Caching Integration

```typescript
// Cache-aside pattern with repository
class CachedEmployeeRepository implements EmployeeRepository {
    constructor(
        private readonly delegate: PostgresEmployeeRepository,
        private readonly cache: Redis,
        private readonly tenantContext: TenantContext
    ) {}

    async findById(employeeId: UUID): Promise<Employee | null> {
        const cacheKey = `employee:${this.tenantContext.tenantId}:${employeeId}:current`;

        // 1. Check cache
        const cached = await this.cache.get(cacheKey);
        if (cached) return JSON.parse(cached) as Employee;

        // 2. Miss → query database
        const employee = await this.delegate.findById(employeeId);
        if (!employee) return null;

        // 3. Populate cache (TTL = 300s)
        await this.cache.setex(cacheKey, 300, JSON.stringify(employee));
        return employee;
    }

    // Cache invalidation on mutation
    async updateProfile(
        employeeId: UUID,
        updates: Partial<Employee>
    ): Promise<Employee> {
        const updated = await this.delegate.updateProfile(employeeId, updates);
        // Invalidate immediately after write
        await this.cache.del(`employee:${this.tenantContext.tenantId}:${employeeId}:current`);
        return updated;
    }
}
```

---

## 12.6 Supabase-Specific Considerations

```typescript
// Supabase client wrapping — enforce tenant context on every call
class SupabaseClientFactory {
    createClient(tenantId: UUID, userId: UUID): SupabaseClient {
        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Set tenant context for RLS enforcement
        client.auth.setSession(/* ... JWT with tenant_id claim ... */);

        // For service-role operations, set tenant context explicitly
        client.rpc('set_tenant_context', { tenant_id: tenantId });

        return client;
    }
}

-- PostgreSQL function for tenant context setting (called by service role)
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', tenant_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 12.7 Read Model Strategy

For high-frequency read paths that cannot be served by normalized OLTP tables:

```
Read Model Population Strategy:

1. Event-Driven Read Models (preferred):
   - Domain event consumer updates analytics.* tables
   - Eventual consistency (seconds to minutes lag)
   - Used for: dashboard data, KPI summaries, workforce snapshots

2. Materialized View Read Models (PostgreSQL native):
   - PostgreSQL MATERIALIZED VIEW refreshed on schedule or on event
   - Used for: medium-frequency operational reads, org hierarchy queries
   - Refresh: CREATE MATERIALIZED VIEW CONCURRENTLY (non-blocking)

3. Cache-Backed Read Models (Redis):
   - Computed result cached with TTL
   - Used for: policy resolution results, shift templates, tenant config
   - Cache key strategy: domain:type:tenant_id:id:version

4. Dedicated Read Replica (future):
   - Logical replication from primary to read-only replica
   - Application routes read queries to replica
   - Used for: reporting queries, export jobs, background analytics
```



---


# Section 13 — Performance + Scalability Strategy

## 13.1 Scale Projections by Domain

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    PLATFORM SCALE PROJECTIONS                                │
│                                                                              │
│  Dimension              Small (1K)   Medium (10K)   Large (50K)  XL (200K+) │
│  ─────────────────────  ─────────    ───────────    ─────────    ─────────  │
│  Daily punch records    4,000        40,000         200,000      800,000    │
│  Daily att. summaries   1,000        10,000         50,000       200,000    │
│  Monthly payslips       1,000        10,000         50,000       200,000    │
│  Events/day             15,000       150,000        750,000      3,000,000  │
│  Leave apps/month       200          2,000          10,000       40,000     │
│  Workflow instances/day 100          1,000          5,000        20,000     │
│  AI predictions/day     500          5,000          25,000       100,000    │
│  Audit records/day      5,000        50,000         250,000      1,000,000  │
│                                                                              │
│  Annual punch records   1.4M         14.4M          72M          288M       │
│  Annual events          5.5M         55M            274M         1.1B       │
│  5-year att. storage    ~3.5 GB      ~35 GB         ~175 GB      ~700 GB    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 13.2 Domain-Specific Scaling Analysis

### Attendance Domain — Highest Risk

**Write Pattern:** Bursty — 80% of daily punches occur within 4 time windows (shift start/end × 2 shifts). A 10,000-employee tenant generates ~5,000 punch inserts within 15 minutes during morning shift start.

**Scaling Thresholds:**
| Threshold | Symptom | Action |
|---|---|---|
| >500 punch inserts/second | Connection saturation | Batch insert pipeline (collect 100ms, bulk insert) |
| Single partition >50M rows | Query degradation | Sub-partition by `tenant_id` hash (8 buckets) |
| Daily processing job >30 min | Payroll deadline risk | Parallelize processing across employee cohorts using advisory locks |
| Autovacuum lag >1 hour | Dead tuple bloat | Reduce `autovacuum_vacuum_scale_factor` to 0.01 |

**Batch Insert Pattern for Punch Storms:**
```sql
-- Application collects punches in 100ms window then bulk inserts
-- Reduces per-row round-trips from 5,000 to ~50 (100 rows per batch)
INSERT INTO attendance.punch_records
    (id, tenant_id, employee_id, punch_type, punch_source, punched_at, effective_at, server_received_at)
SELECT
    unnest($1::UUID[]),
    unnest($2::UUID[]),
    unnest($3::UUID[]),
    unnest($4::VARCHAR[]),
    unnest($5::VARCHAR[]),
    unnest($6::TIMESTAMPTZ[]),
    unnest($7::TIMESTAMPTZ[]),
    NOW()
ON CONFLICT (id, punched_at) DO NOTHING;
```

### Payroll Domain — Financial Risk

**Write Pattern:** Periodic burst — all employee computations within payroll run window (typically overnight). For 10,000 employees, a payroll run generates 10,000 payslip inserts and 150,000 component rows within a few hours.

**Scaling Thresholds:**
| Threshold | Action |
|---|---|
| Payroll computation >4 hours | Parallelize computation into cohorts by org_unit. Each cohort processes independently. |
| Component table >100M rows | Partition payroll_components by `period_from` |
| Ledger table >500M entries | Partition + cold archive after 24-month hot window |

### Analytics Domain — Query Risk

**Read Pattern:** Analytical dashboards issue complex GROUP BY queries. The most dangerous pattern is an HR director requesting a "year-to-date by department" attendance report that scans 10M+ rows without proper indexing.

**Query Governance Rules:**
1. All analytical queries require a `tenant_id` filter as first predicate
2. Date range mandatory (no unbounded time range queries)
3. Maximum result set size: 100,000 rows (larger requests go to async export job)
4. Statement timeout: 30 seconds for synchronous API queries, 300 seconds for background jobs
5. `EXPLAIN ANALYZE` required for any query scanning >1M rows before production deployment

---

## 13.3 Partitioning Strategy Summary

| Table | Partition Strategy | Interval | Sub-partition |
|---|---|---|---|
| `attendance.punch_records` | RANGE (punched_at) | Monthly | Hash (tenant_id) when >100M rows/month |
| `attendance.daily_attendance` | RANGE (attendance_date) | Monthly | None unless >50M rows/month |
| `payroll.payroll_ledger` | RANGE (recorded_at) | Monthly | None |
| `events.event_store` | RANGE (published_at) | Monthly | None |
| `audit.event_log` | RANGE (occurred_at) | Monthly | None |
| `ai.feature_history` | RANGE (observation_date) | Quarterly | None |
| `analytics.fact_attendance_daily` | RANGE (date_key) | Quarterly | None |
| `analytics.fact_payroll_summary` | None (manageable size) | — | — |

---

## 13.4 Hot/Warm/Cold Storage Tiers

```
HOT TIER (PostgreSQL Primary — NVMe SSD):
  Data: Last 6 months of all operational tables
  Access pattern: Sub-10ms reads, full write throughput
  Estimated size: 20-50 GB per 10K employees
  Index strategy: Full B-tree + partial indexes

WARM TIER (PostgreSQL Read Replica or Separate PG Instance):
  Data: 6–24 months of punch records, events, audit logs
  Access pattern: Read-only, <500ms acceptable
  Migration: Partition detach from primary → attach to warm instance
  Index strategy: Reduced index set (drop write-optimized indexes)

COLD TIER (S3 / Object Storage as Parquet):
  Data: >24 months for operational, >7 years for statutory
  Access pattern: Batch analytics only (run via DuckDB or ClickHouse S3 tables)
  Format: Parquet files, partitioned by tenant/year/month
  Query: Federated via ClickHouse S3 function or AWS Athena
  Retention: As per statutory requirements (8 years for payroll)

ARCHIVE TIER (S3 Glacier or equivalent):
  Data: Post-statutory-retention data held for legal purposes
  Access: Legal team only, <24 hour retrieval SLA acceptable
  Retention: Until legal hold release or maximum 15 years
```

---

## 13.5 Index Evolution Strategy

As tables grow, index strategy must evolve. The index lifecycle is:

```
Phase 1 (0–5M rows): Standard B-tree indexes
  Standard multi-column indexes with tenant_id leading.
  BRIN indexes NOT useful yet (too few distinct values per range).

Phase 2 (5M–50M rows): Partial indexes + BRIN supplementation
  Add partial indexes for high-selectivity status filters.
  Consider BRIN indexes on punch_records (punched_at) for range scans —
    extremely small (1 block per 128 pages) but effective for time range queries.
  CREATE INDEX idx_punch_brin ON attendance.punch_records
    USING BRIN (punched_at) WITH (pages_per_range = 128);

Phase 3 (50M–500M rows): Partition-local indexes + aggressive pruning
  All indexes exist on individual partitions.
  Query planner prunes irrelevant partitions before index scan.
  Drop indexes on archived partitions to save storage.
  Consider pg_partman for automated partition management.

Phase 4 (>500M rows): ClickHouse migration for analytics
  PostgreSQL retains hot operational data only.
  Historical queries route to ClickHouse.
  PostgreSQL indexes shrink to operational hot-tier only.
```

---

## 13.6 Read Replica Strategy

```
Phase 1 (< 10K employees): No replica needed
  Primary handles all reads.

Phase 2 (10K–50K employees): Single streaming replica
  Supabase Read Replica (physical streaming replication)
  Route: Heavy reporting queries → replica
  Route: AI feature computation → replica
  Route: Payroll computation reads → replica (attendance snapshots)
  Lag tolerance: <5 seconds acceptable for reads

Phase 3 (50K+ employees): Domain-specific replica routing
  analytics.* schema reads → dedicated analytics replica
  AI training jobs → separate replica (avoid impact on API read replica)
  Background export jobs → dedicated bulk query replica
  OLTP API reads → primary or low-lag replica

Connection Routing (PgBouncer / Supavisor):
  Queries containing /* REPLICA_OK */ hint → routed to replica
  All write queries → primary only
  Transactions → primary only (no mid-transaction replica switch)
```

---

# Section 14 — Security + Compliance Data Strategy

## 14.1 PII Classification and Encryption Strategy

```
PII Classification Tiers:

TIER 1 — RESTRICTED (Field-level AES-256-GCM encryption):
  national_id_enc         — Aadhaar / PAN / Passport number
  bank_account_enc        — Bank account numbers
  date_of_birth           — Full DOB (partial masking at display layer)
  personal_email          — If distinct from work email
  personal_phone          — Personal mobile number
  address                 — Full residential address
  emergency_contacts      — Contact person details
  salary (for non-payroll) — When stored outside payroll domain

TIER 2 — CONFIDENTIAL (Row-level access control via RLS + role):
  Employment compensation — payroll.payslips (payroll_admin role only)
  Medical leave reasons   — leave.leave_applications (manager+ only)
  AI predictions          — ai.predictions (HR admin only)
  Performance assessments — Future domain

TIER 3 — INTERNAL (Tenant-scoped, RLS-protected):
  Employee profiles       — All tenanted employee data
  Attendance records      — All punch and daily records
  Workflow decisions      — Approval decisions and reasons

TIER 4 — OPERATIONAL (Tenant-scoped, standard access):
  Org structure           — Public within tenant
  Leave types             — Visible to all employees
  Policies                — Accessible to affected employees
```

---

## 14.2 Column-Level Encryption Implementation

```sql
-- Encryption key management table
-- Keys are stored with tenant-specific master key (never plaintext)
CREATE TABLE identity.encryption_keys (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    key_purpose         VARCHAR(50) NOT NULL,            -- pii | document | audit
    key_version         INTEGER     NOT NULL DEFAULT 1,
    encrypted_key       TEXT        NOT NULL,            -- Key wrapped with tenant master key (KMS)
    algorithm           VARCHAR(32) NOT NULL DEFAULT 'AES-256-GCM',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at          TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    UNIQUE(tenant_id, key_purpose, key_version)
);

-- Application-level encryption (NOT database-level encryption):
-- 1. Retrieve DEK (Data Encryption Key) from KMS
-- 2. Encrypt field with AES-256-GCM using DEK
-- 3. Store encrypted bytes as base64 in _enc column
-- 4. Never store plaintext in database

-- Example: Encrypting national_id before storage
-- Application code (pseudocode):
--   const dek = await kms.getDataEncryptionKey(tenantId, 'pii');
--   const encrypted = aes256gcm.encrypt(nationalId, dek);
--   await db.query(
--     'UPDATE employee.employee_profiles SET national_id_enc = $1 WHERE id = $2',
--     [encrypted.base64, employeeId]
--   );
```

---

## 14.3 PostgreSQL Row-Level Security Full Implementation

```sql
-- Comprehensive RLS setup for sensitive payroll data
ALTER TABLE payroll.payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payslips FORCE ROW LEVEL SECURITY;

-- Policy 1: Tenant isolation (applies to all roles)
CREATE POLICY payslips_tenant_isolation ON payroll.payslips
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Policy 2: Employee can only see their own payslip
CREATE POLICY payslips_employee_self_read ON payroll.payslips
    FOR SELECT
    USING (
        current_setting('app.user_role', true) = 'employee'
        AND employee_id = current_setting('app.current_user_id')::UUID
    );

-- Policy 3: Payroll admin can see all payslips for their tenant
CREATE POLICY payslips_payroll_admin_read ON payroll.payslips
    FOR SELECT
    USING (current_setting('app.user_role', true) IN ('payroll_admin', 'hr_admin'));

-- Policy 4: Payroll service can write (for run computation)
CREATE POLICY payslips_payroll_service_write ON payroll.payslips
    FOR INSERT
    WITH CHECK (current_setting('app.role', true) = 'payroll_service');

-- No role has UPDATE or DELETE permission on payslips (immutability)
-- Enforced by both RLS (no update/delete policies) and trigger
```

---

## 14.4 Token and Secrets Management

```sql
-- identity.api_tokens — API token registry (hash stored, not plaintext)
CREATE TABLE identity.api_tokens (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    name                VARCHAR(120) NOT NULL,
    token_hash          TEXT        NOT NULL UNIQUE,     -- SHA-256 of raw token
    token_prefix        VARCHAR(10) NOT NULL,            -- First 8 chars for identification
    scopes              JSONB       NOT NULL DEFAULT '[]',
    created_by          UUID        NOT NULL,
    expires_at          TIMESTAMPTZ,
    last_used_at        TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Plaintext token NEVER stored — only provided once at creation, then discarded
-- Application computes SHA-256 hash for all subsequent lookups

-- integration.webhook_secrets — Outbound webhook signing secrets
CREATE TABLE integration.webhook_secrets (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    webhook_id          UUID        NOT NULL UNIQUE,
    secret_hash         TEXT        NOT NULL,            -- HMAC signing secret (hashed)
    algorithm           VARCHAR(32) NOT NULL DEFAULT 'HMAC-SHA256',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at          TIMESTAMPTZ
);
```

---

## 14.5 GDPR/DPDP Compliance Architecture

```
Data Subject Rights Implementation:

RIGHT TO ACCESS (Article 20 GDPR / DPDP Chapter III):
  Endpoint: POST /api/v1/data-requests/export
  Process:
    1. Create erasure_requests record (type = 'export')
    2. Background job collects all tenant-scoped data for employee_id
    3. Encrypts export package with employee's email public key
    4. Sends download link via secure channel
    5. Export link expires in 48 hours
    6. Audit record created for the access request

RIGHT TO ERASURE (Article 17 GDPR / DPDP):
  Endpoint: POST /api/v1/data-requests/erasure
  Process:
    1. Legal hold check — block if active legal hold
    2. Statutory retention check — payroll/statutory data cannot be erased
    3. For erasable records: replace PII fields with pseudonym
      employee_profiles.legal_first_name = 'ERASED'
      employee_profiles.legal_last_name = substr(sha256(employee_id), 0, 8)
      employee_profiles.national_id_enc = NULL
      employee_profiles.personal_email = NULL
      identity.users.email = 'erased-{uuid}@erased.internal'
    4. Event payload PII fields nulled in event_store
    5. Vector store entries for employee deleted
    6. AI feature history for employee deleted
    7. Audit record of erasure action (permanent)
    
RIGHT TO RECTIFICATION (Article 16 GDPR / DPDP):
  Standard profile update workflow with full audit trail
  Immutable records (payslips, statutory) cannot be rectified
  For immutable records: issue corrected replacement + link to original

CONSENT MANAGEMENT:
CREATE TABLE identity.consent_records (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id           UUID        NOT NULL,
    user_id             UUID        NOT NULL,
    consent_type        VARCHAR(80) NOT NULL,            -- ai_analytics | location_tracking | biometric
    granted             BOOLEAN     NOT NULL,
    granted_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    legal_basis         VARCHAR(80) NOT NULL,            -- consent | legitimate_interest | contract
    ip_address          INET,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Consent records are append-only (new row per change)
-- Current consent = latest record per (user_id, consent_type)
```

---

## 14.6 Tenant Isolation Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Missing tenant_id WHERE clause | Medium | Critical (cross-tenant data exposure) | Repository layer enforces tenant_id. RLS as second defense. Automated query scanner in CI |
| RLS policy logic error | Low | Critical | Unit tests with adversarial cross-tenant queries. Security review for every RLS change |
| Cache key without tenant_id | High | High (stale/wrong-tenant data served) | Cache key convention enforced at factory level. Key format includes tenant_id as non-optional segment |
| Event published without tenant_id | Low | High (event lost or misrouted) | Outbox relay validates tenant_id before publish. Missing = dead letter |
| Analytics query cross-tenant JOIN | Medium | High | Analytics schema queries require tenant_id filter. Query governance policy |
| Schema migration drops wrong tenant | Very Low | Critical | Schema-per-tenant migrations require explicit tenant_id parameter in migration runner |

---

# Section 15 — Final Recommendations

## 15.1 Critical Data Architecture Principles

### Principle 1 — Domain Data Sovereignty Is Non-Negotiable
The moment one domain writes directly to another domain's tables, the architectural integrity of the platform begins its irreversible collapse. Enforce this with database-level permissions (GRANT write only to owning service account) rather than trusting developer discipline.

### Principle 2 — Partition Before You Need To
Retrofitting partitioning onto a production table with >10M rows is one of the most operationally dangerous database operations in PostgreSQL. Design partition-awareness into every high-volume table at schema version 1. The cost is negligible at creation; the cost is catastrophic at 50M rows.

### Principle 3 — Every Tenant_ID in Every Query
Multi-tenant data isolation via RLS is a safety net, not a primary mechanism. Application code must explicitly include tenant_id in every query. RLS catches the mistakes that slip through. A platform that relies solely on RLS for tenant isolation is one RLS policy bug away from a catastrophic data breach.

### Principle 4 — Immutability Is a Database Constraint, Not an Application Promise
Finalized payslips, statutory filings, and audit records must be protected by database triggers, not application-level "please don't update this" conventions. Applications get bugs. Developers make mistakes. Database triggers are the last line of defense.

### Principle 5 — Computation Lineage Is Mandatory for Payroll
Every payslip must permanently record the exact attendance snapshot, policy versions, and compensation record used to compute it. Without this, a payroll audit question ("why did John receive X in March?") cannot be answered without reconstructing the computation from logs — which is fragile and incomplete. Computation lineage is not a nice-to-have; it is an architectural requirement.

### Principle 6 — OLTP and Analytics Separation Has a Hard Trigger
Define the metrics that trigger ClickHouse deployment before they are breached. Don't wait until OLTP performance degrades. The trigger thresholds are: attendance fact table >100M rows, or analytics query P95 >3 seconds, or historical report window >18 months. Monitor these metrics weekly.

### Principle 7 — Event-Driven Projections Are Eventually Consistent by Design
Dashboard read models are eventually consistent (seconds to minutes lag). Document this SLA explicitly. Product and engineering must agree on freshness guarantees per dashboard tier. Attempting to make event-driven projections synchronously consistent defeats the purpose and introduces distributed transaction problems.

---

## 15.2 Most Dangerous Anti-Patterns

| Anti-Pattern | Why Dangerous | Prevention |
|---|---|---|
| Cross-schema SQL JOINs | Creates tight domain coupling; schema changes break queries across domains | Lint rule blocking cross-schema JOINs in CI. Only `analytics.*` reads from other schemas |
| Analytics queries on OLTP tables | Destroys OLTP performance at scale; autovacuum delays; write latency spikes | Hard routing rule: dashboard queries go to `analytics.*` or read replica only |
| Mutable payslips | Legal compliance failure; payroll audit cannot be answered | Database trigger blocks UPDATE on finalized payslips |
| Shared mutable balance tables | Race conditions in concurrent accrual/deduction; incorrect balances | Advisory lock per employee for balance mutations; ledger append-only pattern |
| Missing tenant_id on cache keys | Wrong-tenant data served to another tenant's users | Cache key factory enforces tenant_id. Integration tests with multi-tenant scenarios |
| Non-partitioned attendance table at launch | Impossible to add partitioning safely at >10M rows | Partitioned from schema v1 — no exceptions |
| Direct database writes from multiple services | Coupling; transaction boundary confusion; data consistency failures | Repository layer per domain. No direct DB writes outside owning service |
| Long-running migrations holding table locks | Blocks all reads and writes for lock duration | All migrations use CONCURRENTLY, batch UPDATEs, and expand-contract pattern |

---

## 15.3 Implementation Priority Order

```
PHASE 0 — FOUNDATION (Before first tenant onboarded):
  □ Domain schema separation (attendance, payroll, leave, etc.)
  □ RLS on all tables with tenant_id column
  □ Partitioning on punch_records and daily_attendance
  □ Outbox tables in all domain schemas
  □ Repository layer architecture (no inline SQL in services)
  □ audit.event_log with append-only role permissions
  □ Migration governance process established

PHASE 1 — OPERATIONAL MATURITY (0–10K employees):
  □ Immutability triggers on payslips and statutory_filings
  □ Computation lineage fields on payslips
  □ Leave balance ledger (append-only)
  □ Payroll ledger (double-entry)
  □ analytics.* read models (event-driven projections)
  □ KPI summary tables for operational dashboards
  □ Attendance recalculation architecture
  □ AI feature store (basic feature groups)

PHASE 2 — ANALYTICS MATURITY (10K–50K employees):
  □ ClickHouse deployment (triggered by threshold)
  □ Event stream → ClickHouse projection
  □ Read replica routing for heavy reads
  □ ClickHouse star schema for historical analytics
  □ Predictive model persistence (attrition, absence)
  □ pgvector embeddings for policy copilot
  □ Hot/warm/cold storage tier operationalization

PHASE 3 — ENTERPRISE SCALE (50K+ employees):
  □ Schema-per-tenant for enterprise clients
  □ Domain-specific read replicas
  □ Sub-partitioning for largest tenants
  □ Kafka/Redpanda event stream (replace in-process bus)
  □ Distributed feature computation pipeline
  □ Multi-region data residency for global tenants
  □ Dedicated ClickHouse cluster per tenant tier
```

---

## 15.4 Highest-Risk Scaling Areas

```
Risk Rank 1 — Attendance Punch Storage During Shift Storms
  Risk: Connection saturation when 5,000+ employees punch within 15 minutes
  Trigger: >200 concurrent punch insert requests
  Mitigation: Batch insert pipeline (100ms collection window + bulk insert)
  Investment: Medium (queue + batch writer service)

Risk Rank 2 — Daily Attendance Processing Job Duration
  Risk: Processing 10K employees takes >4 hours, overlapping with next day
  Trigger: Processing time >3 hours
  Mitigation: Parallel cohort processing with advisory locks per employee
  Investment: Low (parallelization in existing job runner)

Risk Rank 3 — Analytics Query Fan-out on OLTP
  Risk: Dashboard queries degrade punch insert performance
  Trigger: First tenant reaches 5M punch records
  Mitigation: Route dashboard queries to analytics.* read models
  Investment: Low (query routing rule + index on analytics tables)

Risk Rank 4 — Payroll Computation Lock Duration
  Risk: Payroll lock scan on daily_attendance holds locks for minutes
  Trigger: >5,000 employees in single payroll run
  Mitigation: Batch lock update (1,000 rows at a time), not single UPDATE
  Investment: Low (batch logic change)

Risk Rank 5 — Event Store Growth and Relay Lag
  Risk: Outbox grows faster than relay processes; events delay
  Trigger: Outbox pending count >10,000 events
  Mitigation: Multiple relay workers per domain; priority-ordered relay
  Investment: Medium (relay worker parallelism)
```

---

## 15.5 Data Architecture Maturity Roadmap

| Level | Name | Key Capabilities | Target Timeline |
|---|---|---|---|
| **Level 0** | Operational | Domain schemas, RLS, partitioned attendance, basic indexes, outbox pattern | Before first production tenant |
| **Level 1** | Auditable | Computation lineage, immutability triggers, append-only audit log, leave ledger, payroll ledger | Month 2–3 |
| **Level 2** | Analytically Capable | Event-driven analytics read models, KPI summary tables, dashboard tier separation, AI feature store v1 | Month 4–6 |
| **Level 3** | Predictively Intelligent | ClickHouse integration, ML model persistence, drift tracking, attrition/absence predictions, copilot vector store | Month 7–12 |
| **Level 4** | Enterprise Scale | Multi-tier tenant isolation, domain read replicas, sub-partitioning, cold storage archival, multi-region data residency | Year 2+ |

---

## 15.6 Analytics Maturity Roadmap

| Level | State | Storage | Query Latency | Historical Window |
|---|---|---|---|---|
| L0 | Direct OLTP queries | PostgreSQL primary | Acceptable to 5M rows | 3 months |
| L1 | Event-driven read models | analytics.* PostgreSQL schema | <500ms for dashboards | 12 months |
| L2 | Materialized KPI tables | analytics.* + KPI tables | <100ms for dashboard KPIs | 24 months |
| L3 | ClickHouse OLAP | PostgreSQL (hot) + ClickHouse (warm/cold) | <3s for 100M-row aggregations | 5 years |
| L4 | Federated analytics | ClickHouse + S3 Parquet (cold) | <10s for decade-scale trends | Indefinite |

---

## 15.7 AI Data Readiness Roadmap

```
Gate 1 — Data Existence (Required before any ML model training)
  ✓ Attendance daily summaries stored with policy_version_id
  ✓ Payslip computation lineage fields populated
  ✓ Leave balance ledger capturing all transactions
  ✓ At least 6 months of historical data

Gate 2 — Feature Derivability (Required before feature engineering pipeline)
  ✓ ai.feature_definitions catalog created
  ✓ Attendance behavior features derivable from daily_attendance
  ✓ Payroll signal features derivable from payslips + components
  ✓ Leave pattern features derivable from leave_balance_ledger
  ✓ ai.employee_features table populated (at least 3 months)

Gate 3 — Model Training Infrastructure (Required before first model)
  ✓ ai.model_registry table operational
  ✓ Feature history table populated (rolling snapshots)
  ✓ Training data export pipeline (feature_history → ML framework)
  ✓ Model artifact storage (S3/GCS) configured
  ✓ Shadow deployment capability in ai.predictions

Gate 4 — Production Inference (Required before predictions surface to users)
  ✓ ai.predictions table live
  ✓ Feature importance storage populated
  ✓ Human review workflow for high-impact AI suggestions
  ✓ audit.ai_decision_log capturing all AI-influenced decisions
  ✓ Model drift monitoring (ai.model_drift_metrics) operational

Gate 5 — Copilot Readiness (Required before conversational AI)
  ✓ ai.vector_store populated with policies and precedents
  ✓ ai.copilot_sessions and messages tables operational
  ✓ ai.consent_records: employees have granted AI processing consent
  ✓ PII-free feature pipeline verified (no names/IDs in feature vectors)
  ✓ DPDP compliance review completed
```

---

## 15.8 Summary — The Non-Negotiable Foundational Decisions

These are the decisions that, if deferred, become exponentially more expensive to correct. They must be made at platform inception, not after the first production incident:

```
Decision 1: Domain-owned PostgreSQL schemas with no cross-schema writes
  Deferral cost: Every cross-domain table reference becomes a migration blocker

Decision 2: Attendance punch_records partitioned by month from day one
  Deferral cost: Emergency partition migration on live table with 10M+ rows

Decision 3: Payslip immutability enforced by database trigger
  Deferral cost: Regulatory audit failure; potential legal liability

Decision 4: Every table has tenant_id as first column in every composite index
  Deferral cost: Rebuilding all indexes with downtime at scale

Decision 5: Repository pattern with tenant context injection
  Deferral cost: Hunting every inline SQL query for missing tenant_id filter

Decision 6: Outbox pattern for all domain events
  Deferral cost: Phantom events, missing events, inconsistent read models

Decision 7: Analytics schema separated from OLTP schemas
  Deferral cost: Emergency read replica + query routing at scale under pressure

Decision 8: Append-only audit log with INSERT-only role
  Deferral cost: Audit log that cannot be trusted during compliance investigation

These eight decisions cost approximately 3 weeks of additional upfront architecture
and schema work. Deferring them costs months of firefighting, emergency migrations,
and potentially compliance failures that cannot be retroactively fixed.
```

---

*End of MASTER DATA ARCHITECTURE + DATABASE MODELING + MIGRATION STRATEGY*

*Document Version: 1.0 | Platform: Workforce Operating System | Classification: Internal Architecture — Confidential*



---


