# H1 Phase D — Leave Ledger Shadow Observation Runbook

Goal: prove, under real activity over a 14-day window, that the leave **cache**
(`employee_leave_balance`) and the authoritative **ledger**
(Σ `leave_accrual_ledger` non-expired `days`) stay in lockstep — before any
read-path cutover (`LEAVE_LEDGER_AUTHORITATIVE`, Phase E).

## 0. Preconditions (must all be true before enabling shadow)

- [x] Migrations 252–270 applied.
- [ ] **Migration 271 applied** (`uidx_accrual_ledger_request`). This is the
      blocker fix: the ledger dual-write upserts targeted a *partial* index that
      `ON CONFLICT` cannot infer, so every consumption/reversal/encashment/co-grant
      ledger write silently failed and drifted cache↔ledger. Without 271, shadow
      mode will record drift on **every** leave approval/cancel/encashment.
- [ ] App deployed from a build that includes the matching
      `onConflict: 'tenant_id,accrual_type,source_request_id'` change (leave.ts ×3,
      comp-off.ts, accrual-engine.ts).
- [ ] `supabase/h1_synthetic_smoke.sql` returns **ALL PASS** on the target DB.

## 1. Enable shadow (env-config, NOT a code change)

The flag is read at runtime: `process.env.LEAVE_LEDGER_SHADOW === 'true'`
(`apps/api/src/lib/leave-ledger-shadow.ts`). Set it on the **API service**
environment and restart/redeploy the API:

```
LEAVE_LEDGER_SHADOW=true
LEAVE_LEDGER_AUTHORITATIVE=false   # stays false — no read cutover in Phase D
```

- Docker compose: add to the `api` service `environment:` block, `docker compose up -d api`.
- Hosted (Vercel/Render/Fly/etc.): set the var in the API project's env settings and redeploy.

Shadow is fire-and-forget: it never throws, never blocks, never alters the served
(cache) response. Rollback = set `LEAVE_LEDGER_SHADOW=false` (instant, no redeploy
of code needed).

## 2. What writes to `leave_ledger_drift_log`

- `source='balance_read'` — passive comparison on real ESS/admin balance reads
  (`GET /attendance/leave/balance/...`), fires only when the flag is on.
- `source='reconciliation_sweep'` — the scheduled full-population sweep below.

## 3. Nightly reconciliation sweep (schedule once/day)

Run server-side (service-role / `postgres`; the table is RLS-locked with no
policies by design). Schedule via `pg_cron`, the app scheduler, or an external cron.

```sql
INSERT INTO leave_ledger_drift_log
  (tenant_id, employee_id, leave_type_id, year, cache_balance, ledger_balance, delta, source)
SELECT COALESCE(c.tenant_id,  l.tenant_id),
       COALESCE(c.employee_id,l.employee_id),
       COALESCE(c.leave_type_id, l.leave_type_id),
       COALESCE(c.year, l.year),
       c.cache_balance,
       COALESCE(l.ledger_balance, 0),
       round(COALESCE(l.ledger_balance,0) - COALESCE(c.cache_balance,0), 2),
       'reconciliation_sweep'
FROM (SELECT tenant_id, employee_id, leave_type_id, year, balance AS cache_balance
        FROM employee_leave_balance) c
FULL OUTER JOIN (SELECT tenant_id, employee_id, leave_type_id, year, SUM(days) AS ledger_balance
        FROM leave_accrual_ledger WHERE is_expired = false
        GROUP BY 1,2,3,4) l
  ON c.tenant_id=l.tenant_id AND c.employee_id=l.employee_id
 AND c.leave_type_id=l.leave_type_id AND c.year=l.year
WHERE abs(COALESCE(l.ledger_balance,0) - COALESCE(c.cache_balance,0)) > 0.01;
```

Zero rows inserted = ledger and cache agree for every key.

## 4. Daily monitoring query

```sql
SELECT date_trunc('day', detected_at)::date AS day,
       source,
       count(*)                                   AS drift_rows,
       count(DISTINCT (tenant_id, employee_id, leave_type_id, year)) AS distinct_keys,
       round(sum(abs(delta)), 2)                  AS total_abs_drift,
       round(max(abs(delta)), 2)                  AS worst_abs_delta
FROM leave_ledger_drift_log
WHERE detected_at > now() - interval '14 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

Triage any row: pull the ledger trail for the key and explain the delta
(timing of an in-flight write vs. a genuine bug). "Unexplained" = a delta with no
benign in-flight explanation → blocks Phase E.

## 5. Phase D → E gate

| Criterion | Pass condition |
|---|---|
| No unexplained drift | every drift row over 14 days has a benign explanation; ideally zero rows |
| Synthetic lifecycle consistent | `h1_synthetic_smoke.sql` = ALL PASS |
| No errors from instrumentation | no `shadow drift … failed` warns; no latency/error regression on balance reads |

Only when all three hold do we consider flipping `LEAVE_LEDGER_AUTHORITATIVE`
(staging first, never prod-first).

## 6. Drift report template (fill at end of window)

```
H1 Phase-D Shadow Drift Report
Window:           <start> … <end>  (14 days)
Environment:      <staging|prod>   DB: <project ref>
Flags:            LEAVE_LEDGER_SHADOW=true  LEAVE_LEDGER_AUTHORITATIVE=false

Activity volume:  approvals=<n>  cancellations=<n>  encashments=<n>  comp-off grants=<n>
Sweeps run:       <n>/14

Drift rows total:           <n>   (balance_read=<n>, reconciliation_sweep=<n>)
Distinct keys with drift:   <n>
Unexplained drift rows:     <n>   ← GATE: must be 0
Worst |delta| observed:     <days>

Instrumentation errors:     <none|describe>
Synthetic smoke:            <ALL PASS|...>

Verdict:  <READY for Phase E staging cutover | NOT READY — reasons>
```
