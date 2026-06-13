# Program 2 — Statutory Completeness · Closure Audit

**Date:** 2026-06-13 · **Status:** ✅ **PROGRAM 2 COMPLETE**
**Branch:** `claude/blissful-ptolemy-8AMQn` (also on `main`).
**Principle honoured throughout:** extend CognixHR — no new alert engine, scheduler, notification framework, compliance workflow, or compliance table.

---

## 1. Architecture Summary

Program 2 closed the statutory-completeness gaps by adding **thin layers over existing engines and data** — no parallel subsystems.

- **One deadline brain.** `ComplianceCalendarService` (`apps/api/src/lib/compliance-calendar.ts`) is the *single* place statutory deadlines are derived. Deadlines are **calculated** (no deadline table) from what each tenant has enabled (`payroll_statutory_settings`, `statutory_registrations`, `lwf_state_settings`) and marked **Completed** from existing filing records (`statutory_filing_closures` for pf/esi/pt/tds, `statutory_filing_artifacts` for lwf/24q).
- **Alerts are projections of that brain.** The calendar feeds three consumers — the calendar UI, Workforce Command observations, the existing 6-hour `intelligence-scanner` (→ inbox), and the executive ComplianceView. None recompute deadlines.
- **Reporting over computed data.** LWF export mirrors the existing `ptax` exporter; Form 24Q reuses the existing TDS data and filing-pack endpoint with a shared dataset helper.
- **Governance via the existing trail.** `logAction → audit_logs` now covers every statutory write.

```
payroll_statutory_settings ─┐
statutory_registrations ────┼─▶ ComplianceCalendarService ─┬─▶ GET /compliance/calendar (UI page)
lwf_state_settings ─────────┘     (compute + completion)   ├─▶ Workforce Command observations
statutory_filing_closures ──▶ (Completed signal)           ├─▶ intelligence-scanner ─▶ notifyHrAdmins ─▶ inbox_items
statutory_filing_artifacts ─▶ (Completed signal)           └─▶ Executive ComplianceView
```

---

## 2. Reuse Inventory (what we extended, not built)

| Capability | Existing asset reused | New code |
|---|---|---|
| Deadline derivation | `payroll_statutory_settings`, `statutory_registrations`, `lwf_state_settings`, `statutory_filing_closures`, `statutory_filing_artifacts` | `compliance-calendar.ts` (calc only) |
| Scheduled scan | **`intelligence-scanner.ts`** (existing 6 h runner + dedup Set + per-tenant loop) | one `scanComplianceDeadlines` function |
| Inbox alerts | **`notify.ts`** (`notifyHrAdmins`), `inbox_items` (`item_type='compliance_alert'` already existed) | none (called as-is) |
| Observations | **`routes/intelligence` Workforce Command** observation array | 3 compliance observations |
| Executive surface | **`ComplianceView.tsx`** (existing panel, was a placeholder) | wired to calendar |
| LWF export | **`routes/payroll/exports.ts`** `ptax` pattern, `lwf_contributions` | `/exports/lwf` (~40 lines) |
| Form 24Q | **`filing-pack.ts` `/24q`**, `payroll_slips.tds_deducted`, `employee_bank_statutory.pan_number` | `build24QDataset` helper + readiness/deductor endpoints |
| TAN/PAN storage | **`payroll_statutory_settings`** (added columns, not a new table) | migration 245 |
| Audit trail | **`logAction` / `audit_logs`** | ~30 call sites |

**Net new infrastructure: zero.** No new scheduler, alert engine, notification framework, workflow engine, dashboard, or compliance table.

---

## 3. API Inventory

| Method · Endpoint | Purpose | Source |
|---|---|---|
| `GET /compliance/calendar` | Full deadline window + status counts | ComplianceCalendarService |
| `GET /compliance/calendar/upcoming` | Overdue + due-within-N-days | ComplianceCalendarService |
| `GET /intelligence/workforce-command` *(extended)* | now emits compliance observations | ComplianceCalendarService |
| `GET /payroll/exports/lwf` | LWF monthly register CSV/JSON | `lwf_contributions` |
| `GET /payroll/filing-pack/deductor` | Deductor TAN/PAN + status | `payroll_statutory_settings` |
| `PUT /payroll/filing-pack/deductor` | Capture TAN/PAN (audited) | `payroll_statutory_settings` |
| `GET /payroll/filing-pack/24q/readiness` | Dataset + validation + Ready/Warning/Blocked | `build24QDataset` |
| `GET /payroll/filing-pack/24q` *(refactored)* | Annexure I+II CSV (now via shared helper) | `build24QDataset` |
| Statutory write endpoints *(extended)* | now call `logAction` | `audit_logs` |

---

## 4. UI Inventory

| Screen | Change |
|---|---|
| **Compliance Calendar** (`/admin/payroll/compliance-calendar`, new) | Status-bucketed deadlines (Overdue / Due Soon / Upcoming / Completed) + counts. Nav entry added under Compliance. |
| **Executive ComplianceView** | Placeholder replaced with live "Statutory Filing Deadlines" — Overdue / Due This Week / Due This Month + list. |
| **Filing Pack Center** | Deductor TAN/PAN capture + status, Form 24Q readiness (Ready/Warning/Blocked) + validation report; 24Q download blocked when Blocked. |
| **LWF Management** | "Export CSV" button (authed blob download). |
| **Workforce Command** (consumer) | Compliance observations surface automatically (no UI change needed — uses existing observation list). |

---

## 5. Validation Report

| Requirement | Result | Evidence |
|---|---|---|
| Every alert originates from the calendar source | ✅ | Workforce Command, the inbox scanner, and ComplianceView all call `computeUpcoming` / `/compliance/calendar`. No other code computes deadlines. |
| No duplicate deadline logic | ✅ | Deadlines derived only in `compliance-calendar.ts`. |
| No duplicate notification logic | ✅ | Alerts use existing `notify.ts` + `inbox_items`; no new notifier. |
| No duplicate compliance tracking | ✅ | Completion read from existing `statutory_filing_closures` / `statutory_filing_artifacts`. |
| Workforce Command / Inbox / Executive consistent | ✅ | Same service. *By design* the inbox scanner notifies a **subset** (overdue + due ≤7d) to avoid spam; the calendar/exec show the full set — counts reconcile (inbox ⊆ calendar). |
| No new scheduler | ✅ | Reused `intelligence-scanner` (one added scan function). |
| No new alert framework | ✅ | Reused inbox + observations. |
| No new compliance table | ✅ | Calendar has none; 24Q added **columns** to an existing table (migration 245). |
| No placeholders / mock data | ✅ | All figures from finalized slips, settings, registrations, contributions. The 24Q "income" field is real `gross_total` (labelled as such; per-deductee chapter-VI-A aggregation is out of MVP scope). |

**Honest scope notes (not defects):**
- Deadline **due-date rules** use standard statutory defaults (EPF/ESI 15th, TDS monthly 7th / Mar→Apr 30, 24Q Jul/Oct/Jan/May 31, PT 21st, LWF 15th). State-specific PT/LWF date variance is a future refinement.
- 24Q is **MVP**: Annexure CSV + validation + readiness only. NSDL FVU, challan/BSR/deposit-date capture, and deductee-challan mapping are explicitly **deferred** to a future program.

---

## 6. Program 2 Closure Audit

| Item | Status | Notes |
|---|---|---|
| **Compliance Calendar** — single deadline source | ✅ | `ComplianceCalendarService`; `/compliance/calendar` + `/upcoming` |
| **Compliance Alerts** — Workforce Command integrated | ✅ | overdue / ≤3d / ≤7d observations w/ recommended action |
| **Compliance Alerts** — Inbox integrated | ✅ | scanner → `notifyHrAdmins`, `compliance_filing` / `compliance_alert`, deduped |
| **Compliance Alerts** — Executive integrated | ✅ | Overdue / Due This Week / Due This Month |
| **LWF** — export functioning | ✅ | `/payroll/exports/lwf` + button |
| **Form 24Q** — dataset generated | ✅ | `build24QDataset` (deductor, quarter, deductees, summary) |
| **Form 24Q** — annexure export functioning | ✅ | `/24q` Annexure I + II CSV (shared helper) |
| **Form 24Q** — validation report functioning | ✅ | missing/invalid PAN, missing TAN, zero-TDS; Ready/Warning/Blocked |
| **Audit Logging** — all statutory writes audited | ✅ | `logAction` across EPF/ESI/PT/LWF/TDS/governance/groups/filing-pack/deductor |

### Migrations to apply before deploy
- **245** `deductor_tan.sql` (TAN/PAN columns) — required for P2.4.
- **244** `fnf_settlement.sql` (Program 1) — still pending.
- Confirm **145** `payroll_snapshot_tables.sql` applied (Program 1 ledger self-heal).

**Program 2 is complete and ready for review.** Program 3 can begin once the above migrations are applied.
