# Program 3A — Lifecycle Risk Management · Closure Audit

**Date:** 2026-06-13 · **Status:** ✅ **PROGRAM 3A COMPLETE**
**Branch:** `claude/blissful-ptolemy-8AMQn` (also on `main`). HEAD `b38fc8c`.
**Principle honoured throughout:** extend CognixHR — no new scheduler, no new
alert framework, no new notification engine, no duplicate expiry engine, **no new
table or migration** (all data already existed).

> Scope guard: Program 3B (Certification Governance) was **NOT** started.
> No `employee_certifications` table, no certification/license workflows, no
> certification expiry tracking were built. Those remain deferred.

---

## 1. Architecture Summary

Program 3A closed lifecycle/expiry risk by adding **one calculated source** and
projecting it into the existing surfaces — exactly the Program 2 pattern.

- **One lifecycle brain.** `lifecycle-expiry.ts` is the *single* place expiry is
  derived. It is **calculated** (no risk table) from data that already exists:
  `documents.expires_at`, `employee_identity.expiry_date`,
  `employee_passport_visa.expiry_date`, `employee_contracts.end_date`, and
  accurate probation (`joining_date` + `employment_categories.probation_days`,
  gated by the current `job_history` row).
- **Every consumer is a projection of that brain.** The Expiry Management
  workspace, Workforce Command observations, the inbox scanner, and the Executive
  metrics all read this service. None recompute expiry.
- **Reuse of the existing scanner.** One function (`scanLifecycleExpiry`) added to
  the existing 6-hour `intelligence-scanner` — same dedup Set, same per-tenant loop.
- **Reuse of the existing inbox.** Alerts use `notifyHrAdmins` → `inbox_items`
  (`item_type='compliance_alert'`). No new notifier.

```
documents.expires_at ───────────────┐
employee_identity.expiry_date ───────┤
employee_passport_visa.expiry_date ──┼─▶ lifecycle-expiry.ts ─┬─▶ GET /workforce/expiry (Expiry Management workspace)
employee_contracts.end_date ─────────┤   (compute + bucket)   ├─▶ Workforce Command observations
job_history + employment_categories ─┘                        ├─▶ intelligence-scanner ─▶ notifyHrAdmins ─▶ inbox_items
                                                              └─▶ Executive ComplianceView (Expiry Risk Index …)
```

---

## 2. Reuse Inventory (extended, not built)

| Capability | Existing asset reused | New code |
|---|---|---|
| Expiry derivation | `documents`, `employee_identity`, `employee_passport_visa`, `employee_contracts`, `job_history`, `employment_categories` | `lifecycle-expiry.ts` (calc only) |
| Scheduled scan | **`intelligence-scanner.ts`** (existing 6h runner + dedup Set + per-tenant loop) | one `scanLifecycleExpiry` function |
| Inbox alerts | **`notify.ts`** (`notifyHrAdmins`), `inbox_items` (`item_type='compliance_alert'`) | none (called as-is) |
| Observations | **`routes/intelligence` Workforce Command** observation array | 4 lifecycle observations (replacing 1 inaccurate one) |
| Executive surface | **`routes/executive` `/executive/compliance` + `ComplianceView.tsx`** | lifecycle roll-up + 1 panel pair |
| Contract transition | **existing scanner pass** | `active→expired` self-heal (no workflow engine) |
| Storage | **existing tables** | **none — zero migrations** |

**Net new infrastructure: zero.** No new scheduler, alert engine, notification
framework, workflow engine, dashboard, table, or migration.

---

## 3. API Inventory

| Method · Endpoint | Purpose | Source |
|---|---|---|
| `GET /workforce/expiry` | Lifecycle risk register + bucket/category summary + department filter list | lifecycle-expiry |
| `GET /intelligence/workforce-command` *(extended)* | now emits lifecycle observations; `probation_due` KPI accurate | lifecycle-expiry |
| `GET /executive/compliance` *(extended)* | now returns `lifecycle` block (Expiry Risk Index, Documentation Health, Contract/Probation Exposure) | lifecycle-expiry |

Query params on `/workforce/expiry`: `within_days`, `category`, `bucket`,
`department_id`, `employee_id`.

---

## 4. UI Inventory

| Screen | Change |
|---|---|
| **Expiry Management** (`/admin/workforce/expiry-management`, new) | Status-bucketed lifecycle risk (Overdue / Due 7d / Due 30d / Due 90d) across Documents, Identity, Passport, Visa, Contracts, Probation. Category chips + department dropdown + employee/document search. Nav entry added under Workforce → Employees. |
| **Executive ComplianceView** | New "Expiry Risk Index" radial + "Lifecycle Exposure Breakdown" panel (Documentation Health, Documents at Risk, Contract Exposure, Probation Exposure). Existing surface extended — no new module. |
| **Workforce Command** (consumer) | Lifecycle observations surface automatically via the existing observation list. |

---

## 5. Validation Report

| Requirement | Result | Evidence |
|---|---|---|
| **Probation accuracy** — false positives eliminated | ✅ | Only employees whose **current** `job_history` row has `employment_type='probation'` **and** `confirmation_date IS NULL` are considered. Confirmed staff and permanent staff never appear. |
| **Probation accuracy** — false negatives eliminated | ✅ | Probation window is the employee's `employment_categories.probation_days` (per category), not a flat 90 days. |
| **Probation accuracy** — uses category + confirmation + type | ✅ | All three signals used in `lifecycle-expiry.ts` (probation block) and surfaced in Workforce Command. The old `joining_date<=90d` proxy was removed from Workforce Command. |
| **Unified expiry engine** — single source | ✅ | `lifecycle-expiry.ts` is the only place expiry is derived. Workspace, scanner, Workforce Command and Executive all call it. |
| **Expiry coverage** — documents/identity/passport/visa | ✅ | All four covered by the engine; plus contracts and probation. |
| **Buckets** — Overdue / 7 / 30 / 90 | ✅ | `bucketFor()` + `summariseLifecycle()`; rendered identically in workspace, observations and executive. |
| **Contract lifecycle** — expiry detection + renewal-due + active→expired | ✅ | Engine flags contracts approaching `end_date`; scanner alerts overdue + due-7d; scanner self-heals `active→expired` once `end_date` passes. |
| **Inbox notifications** | ✅ | `scanLifecycleExpiry` → `notifyHrAdmins` (`compliance_alert`), overdue + due-7d only, deduped per `(item, bucket)` — no spam. |
| **Workforce Command observations** | ✅ | Probation, visa, contract, document/identity/passport observations with recommended actions. |
| **Executive metrics** | ✅ | Expiry Risk Index, Documentation Health, Contract Exposure, Probation Exposure on the existing compliance surface. |
| **No new scheduler / framework / engine / table** | ✅ | Reused `intelligence-scanner` + `notify` + `inbox_items`; zero migrations. |
| **Program 3B not started** | ✅ | No certification table/workflow/expiry/license code. |

**Honest scope notes (not defects):**
- The contract `active→expired` transition runs on the 6-hour scan tick (eventual,
  not instantaneous). The Expiry Management workspace and engine already treat any
  past `end_date` as **Overdue** regardless of stored status, so the view is
  correct between ticks.
- Probation depends on a current `job_history` row carrying `employment_type` and
  `confirmation_date`. Employees created via `create_employee_with_job` always have
  one. Employees with no job_history row are intentionally **not** flagged (avoids
  false positives) — surfacing those is a data-hygiene matter, not an expiry one.
- Overdue items have no lower time bound (a passport expired long ago still shows as
  a risk until renewed) — intentional.

---

## 6. Program 3A Closure Audit

| Item | Status | Notes |
|---|---|---|
| **P3.1 Probation accuracy & confirmation governance** | ✅ | category window + confirmation_date + employment_type; Workforce Command observation; inbox alert for overdue confirmations |
| **P3.2 Unified expiry engine** | ✅ | `lifecycle-expiry.ts`; documents/identity/passport/visa (+contract +probation); 4 buckets; single source |
| **P3.3 Contract lifecycle** | ✅ | expiry detection, renewal-due alerts, `active→expired` self-heal via existing scanner |
| **P3.4 Expiry Management workspace** | ✅ | `/admin/workforce/expiry-management`; buckets + employee/department/category filters; read-only aggregation |
| **P3.5 Workforce Command & Executive integration** | ✅ | lifecycle observations; Expiry Risk Index / Documentation Health / Contract Exposure / Probation Exposure |

### Migrations to apply before deploy
- **None.** Program 3A added no tables and no migrations — all data already existed.

**Program 3A is complete and ready for review. Program 3B (Certification
Governance) remains deferred and must not begin until 3A is reviewed and approved.**
