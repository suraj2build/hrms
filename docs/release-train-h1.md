# Release Train H1 — Hardening Release

**Branch:** `claude/blissful-ptolemy-8AMQn` (integrated)
**Integration commit:** `edf2c9b` — merge of `main` hardening line + C6-P1 + C6 Phase 1
**Status:** Production-ready pending operator execution of the checklists below.

This release unifies four hardening streams into one deployable train:

- **Attendance integrity** — shift attribution, period-lock enforcement, rotation
  temporal integrity, payroll finalization lockdown, WO-Credit.
- **Leave ledger authority foundation** — dual-write ledger, idempotency,
  `checked_deduct_leave_balance`, cancellation reversal, encashment debit.
- **Position management** — already baseline (R7); ships automatically.
- **Shadow-read instrumentation** — `LEAVE_LEDGER_SHADOW` drift logging.

Read flags ship **OFF**: `LEAVE_LEDGER_AUTHORITATIVE=false`, `LEAVE_LEDGER_SHADOW=false`.

---

## leave.ts resolution (by intent) — what the merge preserved

| Capability | Origin | Preserved |
|---|---|:--:|
| `GET /attendance/leave/ledger-reconciliation` | main | ✅ |
| `checked_deduct_leave_balance` (strict, no silent clamp) | branch | ✅ |
| `POST /attendance/leave/:id/cancel` (reversal) | branch | ✅ |
| `LEAVE_LEDGER_AUTHORITATIVE` read flag | branch | ✅ |
| `LEAVE_LEDGER_SHADOW` drift instrumentation | branch | ✅ |
| `consumption` dual-write (approve + bulk) | both | ✅ |

`deduct_leave_balance` has **zero** remaining app callers. `tsc` exit 0.

---

## Migration chain (verified present & contiguous)

```
249  positions                            (baseline)
250  notification_preferences             (baseline)
251  regularisation_limit_enhancements    (baseline)
252  rls_tenant_hardening                 ← include (was missing from "260–270")
253  wo_credit                            ← include
254  wo_credit_phase2                     ← include
255  wo_credit_holiday_pay                ← include
260  attendance_daily_shift_attribution
260b employee_shifts_temporal            ← MUST sort after 260, before 261
261  attendance_shift_audit_log
262  attendance_period_lock_enforcement
263  payroll_finalization_lockdown
264  leave_ledger_idempotency             (269/270 depend on this)
265  master_data_audit
266  rotation_rules_temporal
267  job_history_org_snapshot
268  leave_ledger_authority               (269/270 depend on this)
269  c6_p1_cutover_prep
270  leave_ledger_drift_log
```

---

## Deployment checklist

**Pre-flight**
- [ ] CI green on `edf2c9b`; `tsc` exit 0 (api).
- [ ] Tag current production SHA `pre-h1-hardening` for fast revert.
- [ ] Confirm app uses the **service-role** key (required for 270 RLS-locked table).
- [ ] Take a database snapshot / PITR checkpoint.
- [ ] Confirm `LEAVE_LEDGER_AUTHORITATIVE` and `LEAVE_LEDGER_SHADOW` are unset/false in the target env.

**Migrations (apply in listed order, single transaction per file)**
- [ ] Verify migration runner sorts `260b` lexically **after** `260`, **before** `261`.
- [ ] Apply 252, 253, 254, 255 (skip individually only if already live).
- [ ] Apply 260, 260b, 261, 262, 263, 264, 265, 266, 267, 268.
- [ ] Apply 269 (checked_deduct fn, reversal/encashment types, cancelled status).
- [ ] Apply 270 (drift-log table; RLS enabled, no policies).
- [ ] Confirm `268` wrote one `opening_balance` row per (employee, leave_type, year).

**Code deploy**
- [ ] Deploy API at `edf2c9b`. Confirm boot health (`startup-health`).
- [ ] Smoke: approve → cancel a test leave; confirm 200s and balance restored.

**Flags (leave OFF this release)**
- [ ] `LEAVE_LEDGER_AUTHORITATIVE=false` (do NOT flip — that is Phase E).
- [ ] `LEAVE_LEDGER_SHADOW=false` (enable only after baseline reconciliation is clean).

---

## Rollback checklist

**Tier 0 — flag rollback (instant, no redeploy)**
- [ ] Set `LEAVE_LEDGER_SHADOW=false` → instrumentation off, zero behavior change.
- [ ] `LEAVE_LEDGER_AUTHORITATIVE` stays false → ledger read path inert by default.

**Tier 1 — code rollback**
- [ ] `git revert -m 1 edf2c9b` (single merge commit) OR redeploy `pre-h1-hardening`.
- [ ] Additive migrations (264, 265, 267, 269, 270) are safe to leave in place —
      orphaned columns/functions/tables, no behavior with code reverted.

**Tier 2 — behavioral migration rollback (only if required)**
- [ ] 262 period-lock: `DROP TRIGGER` (prepared down-script).
- [ ] 263 payroll immutability: `DROP TRIGGER` (prepared down-script).
- [ ] 266 rotation temporal: revert per down-script.
- [ ] 268 opening_balance rows: **do not blind-delete** — recompute drift first;
      these are reconciliation anchors.

**Never**
- [ ] Do not delete `opening_balance` ledger rows as a rollback step.
- [ ] Do not auto-rollback by truncating `leave_accrual_ledger`.

**Point of no easy return:** Phase E (flag flip). Everything up to it is reversible
via Tier 0/1.

---

## Post-deployment validation checklist

**Schema & objects**
- [ ] `checked_deduct_leave_balance` function exists and returns BOOLEAN.
- [ ] `leave_applications.status` CHECK allows `cancelled`.
- [ ] `leave_accrual_ledger` accrual_type CHECK allows `reversal`, `encashment`.
- [ ] `leave_ledger_drift_log` exists with RLS enabled.
- [ ] Unique indexes present: `uidx_accrual_ledger_reversal_request`,
      `uidx_accrual_ledger_encashment_request`,
      `uidx_accrual_ledger_consumption_request`.

**Baseline reconciliation (gate for Phase C/D)**
- [ ] Run `supabase/reconcile_leave_ledger.sql` (Report A) — every tenant `IN_SYNC`.
- [ ] Report C: zero negative `opening_balance` rows (negatives = pre-existing
      ledger over-count → investigate before enabling shadow).

**Functional smoke (per tenant sample)**
- [ ] Approve paid leave → cache + ledger both deduct by identical days.
- [ ] Over-balance approval → 422 `INSUFFICIENT_BALANCE` (no silent clamp).
- [ ] Cancel approved leave → status `cancelled`, `reversal` row written,
      cache restored, attendance_daily leave rows removed.
- [ ] Encashment approval → `encashment` debit row in `leave_accrual_ledger`.
- [ ] Monthly accrual run → credit in both `leave_balance_ledger` and
      `leave_accrual_ledger`.

**Attendance integrity smoke**
- [ ] Write to a PAYROLL_FINALIZED period → blocked (262/263).
- [ ] Shift attribution snapshot persists on attendance rows (260/261).

**Shadow-read enablement (start of Phase D)**
- [ ] Set `LEAVE_LEDGER_SHADOW=true`.
- [ ] Schedule reconciliation SQL nightly.
- [ ] Monitor `leave_ledger_drift_log` for 14 days; gate to Phase E = zero
      unexplained drift rows.

---

## Phase map (post-integration)

| Phase | Action | Gate |
|---|---|---|
| A | Merge hardening branches | ✅ done (`edf2c9b`) |
| B | Apply migrations 249 + 252–255 + 260–270 | runner sorts `260b`; deps satisfied |
| C | Run reconciliation (all tenants) | all `IN_SYNC`; no negative opening rows |
| D | 14-day shadow validation | zero unexplained drift |
| E | Flip `LEAVE_LEDGER_AUTHORITATIVE` | staging first, never prod-first |
| F | R9 Delivery Activation | deferred — out of this release |
