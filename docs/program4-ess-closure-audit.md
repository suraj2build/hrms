# Program 4 — ESS Completion · Closure Audit

**Date:** 2026-06-13 · **Status:** ✅ **PROGRAM 4 COMPLETE (P4.1–P4.5)**
**Branch:** `claude/blissful-ptolemy-8AMQn`
**Principle honoured throughout:** extend CognixHR — reuse existing tables, APIs,
workflows and permissions. **No new tables, no new migrations, no new scheduler,
no new notification framework, no new workflow engine, no UI/reporting/analytics
modernization.**

> Scope guard: Program 3B (Certification Governance) and Program 5 (Compensation
> Lifecycle) were **NOT** started. Modernization programs remain deferred.

---

## 1. Architecture Summary

Program 4 closed ESS functional gaps by adding **one self-scoped surface**
(`/ess/me/*`) over data that already existed, and by **projecting existing
engines** (Program 3A lifecycle, attendance anomalies, separation workflow) into
employee-facing views.

- **One self-service brain.** `apps/api/src/routes/ess/self-service.ts` resolves
  the caller's own `employee_id` **server-side** from their profile on every
  call. An employee can only ever read/write their own records — no client-supplied
  id is ever trusted. This eliminated the IDOR risk that would have come from
  pointing ESS at the HR `/employees/:id/*` routes.
- **Sensitive data stays read-only.** Bank/PAN/UAN/PF/ESI are **view-only** in ESS
  (account number and Aadhaar masked to last 4). Editing remains an HR-verified
  action — employees can confirm their salary-credit details without being able to
  silently change a bank account.
- **Every expiry view is a projection of the Program 3A engine.** The ESS expiry
  tab, the dashboard alert widget and HR's Expiry Management all read
  `computeLifecycleRisks` — no duplicate expiry logic, no new scanner.
- **Resignation plugs into the existing separation workflow.** An employee-initiated
  resignation lands as a pending row in `employee_separation`
  (`initiated_by='employee'`, `lifecycle_stage='initiated'`, `approval_status='pending'`)
  **without** changing employment status; HR drives it forward through the existing
  separation workspace and is alerted via the existing inbox (`notifyHrAdmins`).

```
employee_bank_statutory ─┐
emergency_contacts ──────┤
employee_addresses ──────┼─▶ /ess/me/* (self-scoped, server-resolved employee_id)
employee_family ─────────┤        │
employee_nominations ────┤        ├─▶ EssMyProfile · Personal tab (P4.1)
documents ───────────────┤        ├─▶ EssDocuments · upload + Expiry tab (P4.2)
employee_separation ─────┤        ├─▶ EssSeparation · resignation + tracking (P4.3)
separation_clearances ───┤        ├─▶ EssOperationalCenter · anomalies (P4.4)
separation_ff_summary ───┤        └─▶ EmployeeDashboard · My Expiry Alerts (P4.5)
assets ──────────────────┤
lifecycle-expiry.ts ─────┘   (computeLifecycleRisks — one brain, many projections)
```

---

## 2. Reuse Inventory (extended, not built)

| Capability | Existing asset reused | New code |
|---|---|---|
| Self employee resolution | `profiles.employee_id` + `req.userId`/`req.tenantId` | `resolveEmployeeId` (mirrors fbp.ts) |
| Personal data CRUD | `emergency_contacts`, `employee_addresses`, `employee_family`, `employee_nominations`, `employee_bank_statutory`, `relationship_types` master | `/ess/me/*` self-scoped routes (reuse the HR zod schemas) |
| Document upload | `documents` table + `employee-files` bucket + `uploadEmployeeFile` helper | `/ess/me/documents` (insert + delete-own) |
| Expiry awareness | **`lifecycle-expiry.ts`** (`computeLifecycleRisks`, `summariseLifecycle`) | `/ess/me/expiry` (filter to caller) |
| Resignation | `employee_separation` (`initiated_by`, `lifecycle_stage`, `approval_status` from migrations 012/210) + HR separation workspace | `/ess/me/separation` (guarded insert) |
| Exit tracking | `separation_clearances`, `separation_ff_summary` | read projection in `/ess/me/separation` |
| Asset obligations | `assets.assigned_to` | `/ess/me/assets` |
| HR alerting | **`notifyHrAdmins`** → `inbox_items` (`approval_request`) | none (called as-is) |
| Attendance anomalies | **`/attendance/anomalies/my`** (already self-scoped) | UI surface only |
| Productivity layer | `EmployeeDashboard` widgets, `QuickActionsBar` | `ExpiryAlerts` widget |

**Net new infrastructure: zero.** No new tables, migrations, schedulers, alert
frameworks, workflow engines or dashboards.

---

## 3. API Inventory (all new endpoints are self-scoped `/ess/me/*`)

| Method · Endpoint | Purpose | Access |
|---|---|---|
| `GET /ess/me/bank-statutory` | Bank/PAN/UAN/PF/ESI visibility (masked, read-only) | self |
| `GET·POST·PUT·DELETE /ess/me/emergency-contacts[/:id]` | Emergency contacts CRUD | self |
| `GET·POST·DELETE /ess/me/addresses[/:id]` | Addresses (upsert by type) | self |
| `GET·POST·PUT·DELETE /ess/me/family[/:id]` | Family members CRUD | self |
| `GET·POST·PUT·DELETE /ess/me/nominations[/:id]` | Nominees CRUD (share ≤ 100%/scheme) | self |
| `GET·POST·DELETE /ess/me/documents[/:id]` | Document list/upload/delete-own | self |
| `GET /ess/me/expiry` | Own lifecycle expiry risks + summary | self |
| `GET·POST /ess/me/separation` | Resignation request + exit tracking | self |
| `GET /ess/me/assets` | Assigned company assets + outstanding count | self |

Reused as-is (no change): `GET /attendance/anomalies/my`, `GET /masters/relationship-types`,
`GET /employees/:id/contracts`, `/payroll/my-slips`, etc.

---

## 4. UI Inventory

| Screen | Change |
|---|---|
| **EssMyProfile** (`/ess/profile`) | New **Personal** tab: Bank & Statutory (read-only), Emergency Contacts, Addresses, Family, Nominees — full self-service. |
| **EssDocuments** (`/ess/documents`) | **Upload** (own documents, ≤5 MB, optional expiry) + delete-own; expiry badges on rows; new **Expiry Alerts** tab (document/identity/passport/visa/contract). |
| **EssSeparation** (`/ess/separation`, new) | Resignation request form; exit tracking (lifecycle stage, approval, clearances, full & final); asset obligations. Sidebar entry under Documents & Support. |
| **EssOperationalCenter** (`/ess/operational-center`) | New **Attendance Anomalies** section (last 90 days, severity + resolved). |
| **EmployeeDashboard** (`/ess/dashboard`) | New **My Expiry Alerts** widget — expiring records visible at login. |

---

## 5. Validation Report

| Requirement | Result | Evidence |
|---|---|---|
| **P4.1** Bank/PAN/UAN/statutory visibility | ✅ | `GET /ess/me/bank-statutory` (masked, read-only) → Personal tab |
| **P4.1** Emergency contacts / address / family / nominee management | ✅ | Full CRUD via `/ess/me/*`, share-total guard on nominees |
| **P4.2** Document upload + history | ✅ | `uploadEmployeeFile` → `POST /ess/me/documents`; list shows own + HR docs |
| **P4.2** Expiry alerts (passport/visa/identity/contract/document) | ✅ | `GET /ess/me/expiry` (Program 3A engine, 365-day horizon + overdue); Expiry Alerts tab |
| **P4.3** Resignation request | ✅ | `POST /ess/me/separation` (pending, no status change, HR notified) |
| **P4.3** Separation / clearance / full & final tracking | ✅ | `GET /ess/me/separation` returns record + clearances + F&F |
| **P4.3** Asset obligation tracking | ✅ | `GET /ess/me/assets` (assigned + outstanding) |
| **P4.4** Attendance anomalies | ✅ | Operational Center section via `/attendance/anomalies/my` |
| **P4.4** Regularization / leave liability / comp-off / payroll / tax / benefits | ✅ | Already surfaced (MyAttendance, EssLeaveBalance, EssCompensation, Operational Center, IT/YTD statements) — verified present, not rebuilt |
| **P4.5** My expiry alerts / pending tasks / documents / payroll / mobile quick actions | ✅ | Dashboard expiry widget added; pending tasks, payroll, quick-actions rail already present |
| **Self-scoped security** (no IDOR) | ✅ | `employee_id` resolved server-side from profile on every `/ess/me/*` call |
| **Sensitive data protection** | ✅ | Bank/Aadhaar masked + read-only; HR-issued documents not deletable by employee |
| **No new tables / migrations / engines** | ✅ | Zero migrations; all data and engines pre-existed |
| **Program 5 not started** | ✅ | No compensation-lifecycle code |

**Typecheck:** `apps/api` clean (exit 0); `apps/web` clean except the
pre-existing `AdminRecruitmentDashboard.tsx` errors (unrelated to Program 4,
present before this work).

**Honest scope notes (not defects):**
- Resignation creates a pending separation row and notifies HR; the *acceptance*
  and forward transitions remain HR actions in the existing separation workspace
  (by design — no new approval engine).
- Attendance-anomaly **resolution** stays an HR action (`/resolve` is HR-only);
  ESS surfaces anomalies for **visibility**.
- Bank/statutory is **view-only** in ESS by deliberate choice (fraud-surface
  reduction); changes route through HR.
- Tax projection, leave liability, comp-off, benefits utilization and
  regularization status were already surfaced across existing ESS pages and were
  verified rather than duplicated.

---

## 6. Program 4 Closure Audit

| Phase | Status | Notes |
|---|---|---|
| **P4.1 Employee Data Ownership** | ✅ | Bank/PAN/UAN/statutory visibility + contacts/address/family/nominee management |
| **P4.2 Documents & Expiry Awareness** | ✅ | Self-upload + delete-own + expiry badges + Expiry Alerts tab |
| **P4.3 Workflow Completion** | ✅ | Resignation request + separation/clearance/F&F tracking + asset obligations |
| **P4.4 Operational Visibility** | ✅ | Attendance anomalies surfaced; rest verified already-present |
| **P4.5 Productivity Layer** | ✅ | Dashboard expiry widget; pending tasks/payroll/quick-actions already present |

### Migrations to apply before deploy
- **None.** Program 4 added no tables and no migrations — all data already existed.

**Program 4 is complete and ready for review. Program 5 (Compensation Lifecycle)
remains deferred and must not begin until Program 4 is reviewed and approved.**
