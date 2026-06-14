# R7 — Position Management Audit

**Status:** Audit (AUDIT-FIRST — findings only, no code shipped)
**Phase:** R7 (Phase 5) of the Workforce Intelligence modernization roadmap
**Class:** AUDIT FIRST
**Scope question:** *What does it take to deliver enterprise-grade position management
(sanctioned headcount, vacancy tracking, manpower planning, org hierarchy) — and what
already exists?*

> Grounded in the live codebase. Every claim cites a file or migration.
> This audit precedes any build; it defines what is present, what is absent,
> what is duplicated, and what new data structures are required.

---

## 0. Executive verdict

**The org primitives exist and are well-designed. The position layer does not exist at all.**

The system has a complete org taxonomy (departments, designations, grades, locations,
cost centres), versioned role assignments (`job_history`), a reporting hierarchy
(`employees.manager_id`), and a full recruitment ATS. What is entirely absent is the
*sanctioned-strength layer*: no position master, no vacancy tracking, no manpower
planning model. The R0 KPI registry explicitly deferred `PLN.sanction_vs_actual` and
`PLN.vacancy` to R7 with the note *"Phantom — no data until R7"*.

- **~65% of the foundation is built** (org taxonomy, role versioning, reporting
  hierarchy, recruitment ATS, headcount metrics).
- **~35% is missing** (position master, sanctioned-strength model, vacancy ageing,
  manpower planning, position-to-requisition link).
- **Three dual-source risks** (manager, site/roster, grades) are present and
  documented below; none is a blocker but each is a data-quality concern.

---

## 1. Org Taxonomy — **EXISTS, well-structured**

Four normalised master tables form the org taxonomy. All are tenant-scoped, RLS-enabled,
and expose full CRUD routes with merge-on-delete support.

| Table | File | Key columns | Notes |
|---|---|---|---|
| `departments` | `migrations/003_org_structure.sql` | id, tenant_id, name, code, **parent_id** (self-ref FK), **head_id** (UUID, *not* FK — see §6) | Hierarchical; `parent_id` index in place |
| `designations` | `migrations/003_org_structure.sql` | id, tenant_id, name, **level** (INT), department_id | Level exists but not enforced (see §6) |
| `grades` | `migrations/003_org_structure.sql` | id, tenant_id, name, code, min_salary, max_salary | Pay-band ranges not validated against comp (see §6) |
| `work_locations` | `migrations/010_masters_extended.sql` | id, tenant_id, name, code, city, state, is_active | Physical building/branch/campus |
| `cost_centers` | `migrations/010_masters_extended.sql` | id, tenant_id, name, code, is_active | Cost allocation; referenced by job_history |

API surface: `routes/departments/index.ts` (~300 lines) covers departments, designations,
and grades with full CRUD + merge. A **duplicate grades route** also exists at
`routes/masters/grades.ts` — same operations, separate mount (see §5).

---

## 2. Role-Assignment Model — **EXISTS, canonical**

`job_history` is the sole authoritative record of what role each employee holds at any
point in time.

```
job_history (migration 013_job_history.sql)
  id                  UUID PK
  tenant_id           UUID FK → tenants        NOT NULL
  employee_id         UUID FK → employees       NOT NULL
  department_id       UUID FK → departments     nullable
  designation_id      UUID FK → designations    nullable
  grade_id            UUID FK → grades          nullable
  work_location_id    UUID FK → work_locations  nullable
  cost_center_id      UUID FK → cost_centers    nullable
  shift_id            UUID FK → shifts          nullable
  manager_id          UUID FK → employees (self) nullable
  employment_type     TEXT  CHECK IN (permanent|contract|intern|probation|consultant)
  confirmation_date   DATE  nullable
  effective_from      DATE  NOT NULL
  effective_to        DATE  nullable  — NULL = currently active
  is_current          BOOLEAN NOT NULL DEFAULT false
  reason_for_change   TEXT  nullable
  created_by          UUID FK → profiles        nullable
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Key constraint:** `UNIQUE PARTIAL (tenant_id, employee_id) WHERE is_current = true`
— exactly one active role row per employee per tenant.

**Trigger:** `fn_close_prev_job_history()` AFTER INSERT auto-closes the prior
`is_current = true` row (`effective_to = NEW.effective_from - 1 day`).

**API:** `routes/employees/job-history.ts` — GET current job, GET full history,
POST new role change (syncs `employees.manager_id` on successful insert).

**Conclusion:** Role assignment versioning is solid. No new table required for
role history; R7's position layer sits *above* this, not in place of it.

---

## 3. Reporting Hierarchy — **EXISTS, dual-source (risk)**

Reporting structure is stored in two places, kept in sync by application code only.

| Source | Column | Purpose | Updated by |
|---|---|---|---|
| `employees` | `manager_id` UUID FK (self-ref, migration 040) | **Live** — approval routing, real-time org tree | Application layer on job_history INSERT |
| `job_history` | `manager_id` UUID FK (self-ref, migration 013) | **Historical** — manager at each role change | DB trigger on job_history INSERT |

Constraint: `employees_no_self_manager CHECK (manager_id IS NULL OR manager_id != id)`.

Index: `idx_employees_manager (tenant_id, manager_id) WHERE manager_id IS NOT NULL`.

**Risk:** If the `employees.manager_id` sync write fails silently (e.g. a mid-transaction
exception after the job_history INSERT), the live approval chain breaks but
job_history.manager_id remains correct. No compensating mechanism exists today.

**Org chart frontend:** `pages/employees/OrgChart.tsx` — renders interactive reporting
tree by walking `employees.manager_id`. No standalone `org_chart` or `org_nodes`
table; hierarchy is implicit.

**Department hierarchy:** `departments.parent_id` self-reference allows a department
tree. Walking is done in application code (no stored closure table or LTREE).

---

## 4. Recruitment ATS — **EXISTS, production-grade**

A complete 10-table ATS is in place (`migrations/240_recruitment_ats.sql`, 354 lines).

| Table | Key columns | Status |
|---|---|---|
| `recruitment_pipeline_stages` | id, name, stage_order (UNIQUE), stage_type, is_system | ✅ configurable per tenant |
| `job_requisitions` | id, title, department_id, employment_type, **openings** (INT CHECK > 0), jd_text, required_skills (TEXT[]), salary_min/max, status (draft\|open\|on_hold\|filled\|cancelled), approved_by/at, target_date | ✅ full lifecycle |
| `candidates` | id, email (UNIQUE per tenant), current_company/title, total_experience, source | ✅ reusable candidate pool |
| `applications` | id, requisition_id, candidate_id, stage_id, status (applied→screening→interviewing→offer→hired→rejected\|withdrawn), overall_score, offer_amount/date/accepted, expected_joining | ✅ full lifecycle |
| `application_activity_log` | id, application_id, from/to stage, from/to status, actor_id, note | ✅ audit trail |
| `interview_rounds` | id, application_id, stage_id, round_number, type (video\|phone\|in_person\|assignment), scheduled_at, status | ✅ scheduling |
| `interview_panel` | round_id + interviewer_id UNIQUE | ✅ panel assignment |
| `interview_scores` | round_id + interviewer_id UNIQUE, technical/communication/culture/overall (1–5), recommendation | ✅ scorecard |
| `qb_categories` + `qb_items` | category, question, model_answer, difficulty, tags, is_active | ✅ question bank |
| `recruitment_offer_letters` | application_id, offered_amount, joining_date, valid_until, status (draft\|sent\|accepted\|declined\|expired\|revoked), html_content | ✅ offer lifecycle |

**Bridge** (`migrations/246_recruiting_lifecycle_bridge.sql`): Links
`applications` → `pre_joinee_invitations` once status = `hired`, enabling
preboarding initiation from the ATS.

**API:** `routes/recruitment/index.ts` (1,809 lines) — 50+ endpoints covering
pipeline CRUD, requisition lifecycle, candidate management, application moves,
interview scheduling, scorecards, offer generation, analytics/funnel, and the
unauthenticated candidate portal.

**Analytics already shipped:** `/recruitment/analytics` returns hiring funnel
(applied → screening → … → hired), TAT, pass rates, source breakdown, and
per-interviewer calibration. This feeds the CHRO executive view (R10).

---

## 5. Org-Assignment Model (Site/Roster) — **EXISTS, dual-source (risk)**

A second versioned-assignment table handles site and roster changes separately from
job role changes.

```
employee_org_assignments (migration 062)
  id, tenant_id, employee_id, site_id, roster_id
  effective_from DATE NOT NULL
  effective_to   DATE nullable
  is_current     BOOLEAN
  UNIQUE PARTIAL (tenant_id, employee_id) WHERE is_current = true
```

On POST `/employees/:id/org-context`, the API both inserts a history row *and*
mirrors the live values to `employees.site_id` + `employees.roster_id`. Same
drift risk as manager (see §3); a transaction rollback after the history insert
but before the mirror update would leave the live columns stale.

---

## 6. Data-Quality Risks — **Three issues, none a blocker**

| Risk | Where | Detail |
|---|---|---|
| **`departments.head_id` not FK** | `migrations/003_org_structure.sql` | Stored as UUID but no FK constraint → no referential integrity; a deleted/transferred employee's ID remains silently orphaned |
| **`designations.level` not enforced** | `migrations/003_org_structure.sql` | Level (INT) is stored but has no uniqueness or ordering constraint; no career-ladder or promotion-path logic validates against it |
| **Grade salary bands not validated** | `migrations/003_org_structure.sql` | `grades.min_salary` / `max_salary` exist but no check that an employee's CTC falls within band; no progression-step model |
| **Duplicate grades route** | `routes/departments/index.ts` + `routes/masters/grades.ts` | Two separate route files implement identical grades CRUD; one should be the canonical mount |
| **Manager sync is manual** | `routes/employees/job-history.ts` | `employees.manager_id` is written by application code after job_history INSERT; not in a single DB transaction → silent drift possible |
| **Site/roster mirror is manual** | `routes/employees/org-context.ts` | Same dual-write pattern as manager; `rotation_policy_id` update noted in code as "best-effort" |

---

## 7. What Does Not Exist — The R7 Gap

The following capabilities have **zero schema, zero API, zero frontend**:

### 7.1 Position Master (sanctioned positions)

There is no table tracking *authorised roles*. A "position" in enterprise HR is a
slot in the org chart with a defined title, grade, department, location, and a
status (filled/vacant/frozen). Currently:

- `designations` defines job titles (a label pool, not a slot count).
- `job_requisitions.openings` holds an integer (how many to hire *right now*), but
  is not linked to any permanent position definition.
- `job_history` records who fills what — but has no "what should be filled" anchor.

**Required new data:** `positions` table (position_code, designation_id, grade_id,
department_id, work_location_id, sanctioned_count, is_active, effective_date, …).

### 7.2 Sanctioned Strength / Manpower Planning

No table tracks *how many people are authorised* per org unit. The R0 KPI registry
(`docs/intelligence/R0-kpi-registry.md`) explicitly defers:

| KPI ID | Name | Registry status |
|---|---|---|
| `PLN.sanction_vs_actual` | target_headcount − active_headcount per site/role | **"Requires R7" / "Phantom"** |
| `PLN.vacancy` | sanctioned − filled; ageing | **"Requires R7" / "Phantom"** |
| `PLN.hiring_forecast` | attrition_velocity × position_count | **Prototype only** |

**Required new data:** Either columns on `positions` (`sanctioned_count`) or a separate
`headcount_budgets` / `manpower_plan` table keyed by (tenant_id, period, department_id,
designation_id, headcount).

### 7.3 Vacancy Tracking

`job_requisitions` encodes *demand* (openings to hire), not *structural vacancy*
(a position that should be filled but isn't). There is no:

- Ageing model (how long has this position been vacant?).
- Link from requisition → position slot (so filling a req marks the position filled).
- Vacancy dashboard or alert.

**Required new data:** `position_id` FK on `job_requisitions`; a `vacancy_opened_at`
timestamp derivable from position inception or last separation; a view/materialized
view computing `sanctioned − headcount_active` per position.

### 7.4 Position-to-Employee Assignment

Currently `job_history` records `(employee, designation, department, grade, …)` but
not `(employee, position_id)`. There is no way to say "Employee A occupies Position P"
which would enable:

- Knowing which position becomes vacant when an employee resigns.
- Succession planning (who is the nominated backup for position P?).
- Position-level budget vs. actuals.

---

## 8. Gap Summary

| Capability | Status | Required for enterprise position management |
|---|---|---|
| Org taxonomy (dept / desig / grade / location) | ✅ exists | reuse |
| Role versioning (job_history) | ✅ exists | reuse; add position_id FK |
| Reporting hierarchy (manager_id) | ✅ exists (dual-source risk) | reuse; harden sync |
| Full recruitment ATS | ✅ exists | reuse; add position_id on requisitions |
| Headcount metrics | ✅ exists (active count only) | extend with sanctioned baseline |
| Site / roster versioning | ✅ exists (dual-source risk) | no change needed |
| **Position master table** | ❌ missing | **build** — defines sanctioned slots |
| **Sanctioned strength / manpower plan** | ❌ missing | **build** — target headcount per org unit / period |
| **Vacancy tracking + ageing** | ❌ missing | **build** — position.status + vacancy_opened_at |
| **Position → requisition link** | ❌ missing | **build** — FK on job_requisitions |
| **Position → job_history link** | ❌ missing | **build** — FK on job_history (who occupies which slot) |
| **departments.head_id FK** | ⚠️ data quality | fix constraint (migration only) |
| **Duplicate grades route** | ⚠️ tech debt | consolidate to one canonical mount |
| **Manager sync hardening** | ⚠️ risk | wrap job-history POST in single transaction |

---

## 9. New Data Structures Required (when R7 is built)

This section records what a build phase would need. **No code is shipped by this audit.**

### 9.1 `positions` table (new)

```sql
positions {
  id                UUID PK
  tenant_id         UUID FK (tenants) NOT NULL
  code              TEXT NOT NULL                  -- e.g. "ENG-SR-001"
  title             TEXT NOT NULL                  -- display name (may differ from designation.name)
  designation_id    UUID FK (designations) nullable
  grade_id          UUID FK (grades) nullable
  department_id     UUID FK (departments) nullable
  work_location_id  UUID FK (work_locations) nullable
  cost_center_id    UUID FK (cost_centers) nullable
  sanctioned_count  INT NOT NULL DEFAULT 1 CHECK > 0
  status            TEXT CHECK IN ('active','frozen','abolished') NOT NULL DEFAULT 'active'
  effective_date    DATE NOT NULL
  abolished_date    DATE nullable
  created_by        UUID FK (profiles)
  created_at        TIMESTAMPTZ DEFAULT now()
  UNIQUE (tenant_id, code)
}
```

### 9.2 FK additions to existing tables

```sql
ALTER TABLE job_requisitions
  ADD COLUMN position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

ALTER TABLE job_history
  ADD COLUMN position_id UUID REFERENCES positions(id) ON DELETE SET NULL;
```

### 9.3 Derived vacancy view (no new table needed)

```sql
CREATE VIEW vacancy_summary AS
SELECT
  p.id            AS position_id,
  p.tenant_id,
  p.sanctioned_count,
  COUNT(jh.id)    AS filled_count,
  p.sanctioned_count - COUNT(jh.id) AS open_vacancies,
  MIN(p.effective_date)             AS position_since
FROM positions p
LEFT JOIN job_history jh
  ON jh.position_id = p.id
 AND jh.is_current = true
 AND jh.tenant_id  = p.tenant_id
WHERE p.status = 'active'
GROUP BY p.id, p.tenant_id, p.sanctioned_count, p.effective_date;
```

### 9.4 `manpower_plans` table (optional, R7-full)

Enables period-based headcount budgets independent of live positions.

```sql
manpower_plans {
  id              UUID PK
  tenant_id       UUID FK NOT NULL
  period          TEXT NOT NULL   -- 'YYYY-MM' or 'YYYY-Q1'
  department_id   UUID FK (departments) nullable
  designation_id  UUID FK (designations) nullable
  grade_id        UUID FK (grades) nullable
  sanctioned      INT NOT NULL DEFAULT 0
  approved_by     UUID FK (profiles)
  approved_at     TIMESTAMPTZ
  notes           TEXT
  created_at      TIMESTAMPTZ DEFAULT now()
  UNIQUE (tenant_id, period, department_id, designation_id, grade_id)
}
```

---

## 10. Two viable R7 shapes

**R7-minimal:** Add `positions` table + FK on `job_requisitions` + FK on `job_history`.
Vacancy count becomes `SELECT sanctioned_count - COUNT(jh) FROM positions LEFT JOIN
job_history`. PLN.vacancy and PLN.sanction_vs_actual become computable.
No new UI beyond a Positions master CRUD page (similar to Departments/Designations).
Risk: low. Reuses existing patterns exactly.

**R7-full:** The above + `manpower_plans` table + period-based headcount targets
+ a Manpower Planning UI (plan vs. actual by department/period) + vacancy ageing
alerts (event emitted when a position stays vacant > N days). Introduces new
operational workflow. Risk: medium (new planner role, approval chain for plans).

---

## 11. Audit conclusion

R7 is **not blocked by missing infrastructure** — org taxonomy, role versioning,
recruitment ATS, and the multi-tenant safety patterns are all solid foundations.
The missing piece is a single new table (`positions`) and two FK additions to
existing tables. That unlocks the two KPIs (`PLN.sanction_vs_actual`,
`PLN.vacancy`) that the R0 registry has held open since programme start.

The three dual-source data-quality risks (manager, site/roster, grades route)
should be addressed within R7 or as a companion cleanup, but none blocks shipping
the position master itself.

*This document is the R7 deliverable: an audit, not an implementation.*
