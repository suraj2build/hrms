# Program 1 — Payroll Stabilization · Pre-Build Implementation Audit

**Date:** 2026-06-13 · **Status:** Audit for approval. **No code written.**
**Principle:** Extend existing architecture, reuse services/tables/permissions, no duplicate engines/dashboards, no new schema unless absolutely required.
**Items:** P1.1 Ledger 500 fix · P1.2 Full & Final settlement engine · P1.3 Form 16 generation.

---

## P1.1 — Payroll Ledger 500: Root Cause & Fix

### Root cause (confirmed by code path)
`POST /payroll/runs/:id/ledger` (`apps/api/src/routes/payroll/index.ts:3755`) calls `buildPayrollFinancialLedger` (`apps/api/src/lib/payroll-accounting-engine.ts:534`) and returns `result.error` as **HTTP 500 `LEDGER_BUILD_FAILED`**. The earliest hard-return is the trigger:

- `payroll-accounting-engine.ts:551` → **"No snapshot found — run must be finalized with a snapshot before accounting"** when `payroll_run_snapshots` has no row for the run.

Why a finalized run can lack a snapshot: finalize auto-builds the snapshot at `index.ts:1768-1797`, but it is **non-fatal** — `buildPayrollRunSnapshot` failures are caught and logged as a warning, and finalize still succeeds. Result: `payroll_runs.snapshot_id = NULL`, and the later ledger build 500s. The downstream entry/allocation inserts only `console.warn`, so the 500 is always one of the early returns — overwhelmingly #551.

### Reusable pieces (no new code needed for these)
| Piece | Location | Use |
|---|---|---|
| `buildPayrollRunSnapshot(supabase, runId, tenantId, userId)` | `apps/api/src/lib/payroll-snapshot-engine.ts:589` | (Re)create the snapshot; idempotent via `snapshot_id` |
| **Existing manual endpoint** `POST /payroll/runs/:id/snapshot` | `index.ts:3553` | Operator-callable snapshot (re)build — already implemented |
| `logRunEvent` | `index.ts:252` | Event audit for snapshot/ledger |
| `resolveGLMappings`, `GL` constants | `payroll-accounting-engine.ts:31,157` | Already used by ledger build |

### Migration status
`145_payroll_snapshot_tables.sql` and `146_payroll_accounting_ledger.sql` are **both present in the repo** (146 made idempotent earlier this session and applied). **Step 0 of the fix is to confirm 145 is applied in prod** — if the snapshot *table* is missing, the auto-build silently fails too.

### Proposed fix (no schema change)
1. **Self-heal in the ledger build:** before the "No snapshot found" return, if no snapshot exists, call `buildPayrollRunSnapshot` **synchronously (blocking)**; if it succeeds, continue; only error if it genuinely can't be built (e.g., run not finalized).
2. **Actionable guard instead of 500:** when a snapshot truly can't be created (run not finalized, no employee data), return **HTTP 409** with a clear message (`"Generate the payroll snapshot first / run not finalized"`) rather than a raw 500.
3. **UI surfacing** (`PayrollAccountingCenter.tsx`): on 409, show a **"Generate Snapshot"** action (calls the existing `/snapshot` endpoint) next to "Generate Ledger".
4. **Harden finalize (small):** when the auto-snapshot fails during finalize, record a run **blocker/warning** that's visible in the run UI, so a run never silently ends up snapshot-less.

**Risk:** Low. Reuses existing engine + endpoint; no schema; additive. **Effort:** S (≈1d).

---

## P1.2 — Full & Final (FNF) Settlement Engine

### What already exists and is reusable
- **Separation lifecycle FSM** (`apps/api/src/routes/employees/separation-workflow.ts`): stages `initiated→notice_period→clearance→fnf→relieving→relieved→archived`, approval gates, and `relieve` already checks `clearance_done` + `fnf.status='paid'`.
- **`separation_ff_summary`** (`206_onboarding_separation_modules.sql`): has `last_payroll_amount, leave_encashment_amount, gratuity_amount, notice_period_deduction, other_deductions, other_additions`, a **DB-GENERATED `net_payable`**, and `status (draft|approved|paid)`. One row per separation.
- **Endpoints:** `POST /employees/:id/separation-ff` (upsert), `/approve`, `/mark-paid` — today amounts are **100% manual entry**.
- **Building blocks:** `employee_leave_balance` (remaining days per type), `employment_categories.notice_period_days` + `gratuity_eligible`, `payroll-engine.ts` (partial-month/LOP slip compute), `payroll_payout_reconciliation` (disbursement tracking), `requireRole(HR_ADMIN_ROLES)`, `logAction`, `eventBus`.

### What's genuinely missing (the engine to build)
1. **Gratuity calc** — no formula anywhere (only a 4.81% CTC component). Need: statutory `15/26 × completed_years × last_drawn_basic`, ≥5-year eligibility, ₹20L cap, gated by `employment_categories.gratuity_eligible`.
2. **Leave-encashment amount** — balance exists but **no ₹/day rate**; need rate basis (e.g., `basic/26`) × encashable remaining days.
3. **Notice shortfall** — `notice_period_days` stored, but no `shortfall = notice_period_days − days_served` → `× daily_rate` deduction.
4. **Final partial-month salary** — payroll engine supports proration but there's no "final run" trigger to populate `last_payroll_amount`.
5. **Disbursement** — `separation_ff_summary` has `paid_at` but no link to `payroll_payout_reconciliation`.

### Schema impact (minimal, additive — needs your call)
Recommended **extend `separation_ff_summary`** (additive `ADD COLUMN IF NOT EXISTS`, non-breaking) with calc metadata + payout link:
`gratuity_eligible`, `gratuity_basis`, `leave_encashment_days`, `leave_encashment_rate`, `notice_shortfall_days`, `last_payroll_slip_id`, `payout_reconciliation_id`, `computed_at`, `computed_by`.
**Decision:** gratuity rules — **statutory default constant** (15/26, 5yr, ₹20L cap) vs a small **`gratuity_config` table** for per-tenant custom formulas. Default avoids a new table; recommend statutory default now, config later if needed.

### Proposed build (phased, extend-only)
- New `lib/fnf-settlement-engine.ts` orchestrating gratuity/leave/notice/last-salary sub-calcs (pure functions, reuse payroll-engine + leave balance).
- `POST /employees/:id/separation-ff/compute` → auto-populates the six amounts (HR can still override).
- `PATCH /employees/:id/separation-ff/disburse` → creates a `payroll_payout_reconciliation` row from `net_payable`, links it back.
- `SeparationWorkflow.tsx`: add **"Auto-calculate"** + component breakdown + payout status (extends existing form).

**Risk:** Medium (financial correctness). **Effort:** L (≈1.5–2wk). Closes audit gaps **P2 + L2 + LV1**.

---

## P1.3 — Form 16 Generation

### Data readiness — excellent
`it-statement.ts` (`apps/api/src/routes/payroll/statutory/it-statement.ts`) already computes **all Form 16 Part B**: gross salary, HRA, standard deduction, professional tax, 24(b), Chapter VI-A (80C/80D/80CCD1B/80E/80G/80TTA), HRA exemption, taxable income, **slab-wise tax**, rebate 87A, surcharge, cess, total tax, **TDS deducted YTD**, monthly schedule, regime. Employer **TAN** resolves from `statutory_registrations`; company name from `tenants.name`.

**Missing (non-critical):** employer postal address / CIN aren't in schema (cosmetic on the certificate). **Part A** (challan-level TDS) is **TRACES-sourced** — out of scope; we generate **Part B + a TDS summary**, with a note that official Part A is downloaded from TRACES.

### PDF mechanism — decision required
- **Today:** no server-side PDF library (only `pdf-parse` for *reading*). Letters/offer-letters render **HTML and use the browser's print-to-PDF** (`OfferLetterDialog.tsx` → `window.open` + `window.print`). A binary-stream pattern exists (`reports/export.ts` `sendXlsx`).
- **Option A (recommended): reuse the existing client-side print-to-PDF** — render a Form 16 HTML template from the `it-statement` data and open the print dialog. **Zero new dependency, matches how letters already work, runs fine in the current deploy.**
- **Option B: server-side PDF** — add a library. `puppeteer` (heavy headless-Chrome, container risk on Railway), `html-pdf` (unmaintained), or `pdf-lib` (pure-JS, manual layout). Needed only if Form 16 must be **emailed or stored server-side** without a browser.

**No new schema** either way (optionally store rendered HTML later for audit).

**Risk:** Low (A) / Medium (B). **Effort:** S–M. Closes audit gap **C1**.

---

## Summary: reuse vs build vs schema

| Item | Reuse | Build | New schema? |
|---|---|---|---|
| **P1.1 Ledger 500** | snapshot engine + `/snapshot` endpoint + logRunEvent | self-heal + 409 guard + UI button + finalize blocker | **None** (verify 145 applied) |
| **P1.2 FNF** | separation FSM, ff_summary, leave balance, payroll engine, payout table, RBAC/audit | gratuity/leave/notice/last-salary engine + compute/disburse routes + UI | **Additive only** to `separation_ff_summary` (decision: gratuity default vs config table) |
| **P1.3 Form 16** | it-statement data, TAN/tenant lookup, letters HTML/print pattern, binary stream | Form 16 template + route | **None** |

## Open decisions for your approval
1. **P1.1** — proceed with self-heal + 409 guard + UI "Generate Snapshot" + finalize-blocker hardening? (recommended)
2. **P1.2** — gratuity: **statutory-default formula** (no new table) vs **per-tenant `gratuity_config` table**? Leave-encashment rate basis: **basic/26** (recommended) vs gross/30? Confirm additive extension of `separation_ff_summary`.
3. **P1.3** — PDF via **client-side print (Option A, recommended)** vs **server-side library (Option B)**? Confirm Part A stays TRACES (out of scope).

*Awaiting approval before implementation. Suggested order: P1.1 (fast, unblocks prod) → P1.3 (fast, low-risk) → P1.2 (largest).*
