# Phase C Operator Command Sheet

**Candidate tag:** `phase-c/gate1-rc1`  
**Runbook:** `docs/CognixHR_PhaseC_Launch_Runbook.md` v1.1  
**Evidence folder:** `docs/phase-c-evidence/`

Set these before starting:
```bash
export DB="<supabase-psql-connection-string>"
export API="https://<phase-c-api-host>"
export TOKEN="<tenant-scoped-bearer-token>"
export TENANT="<tenant-uuid>"
export MONTH="2026-07"   # adjust to seeded month
export MGR_TOKEN="<manager-bearer-token-with-depth-2-reports>"
```

---

## Stage 0 — Candidate Lock

```bash
# Confirm you are on the frozen candidate
git fetch origin phase-c/gate1-rc1
git log phase-c/gate1-rc1 --oneline -1
# Must show: f025fef docs: add Phase C launch runbook with validation corrections applied
```

Fill in `docs/phase-c-evidence/README.md` (date + operator) then commit that file before proceeding.

---

## Stage 1 — Environment Build

Run your seed scripts, then confirm counts:
```sql
-- Paste into psql $DB
SELECT
  (SELECT COUNT(*) FROM tenants WHERE status IN ('active','trial'))         AS tenants,
  (SELECT COUNT(*) FROM employees WHERE status='active' AND phone IS NOT NULL) AS employees_with_phone,
  (SELECT COUNT(*) FROM attendance_daily)                                   AS attendance_rows,
  (SELECT COUNT(*) FROM helpdesk_tickets)                                   AS tickets;
-- Expect: tenants≥1, employees_with_phone≥5000, attendance_rows≥1800000, tickets≥500
```

---

## Stage 2 — Smoke Checks

Run every block. Copy output to the corresponding file in `docs/phase-c-evidence/stage2/`.

### Section A — Database

```bash
# A-1 Migration completeness → A-all.txt
psql $DB -c "SELECT id FROM schema_migrations WHERE id IN (353,354,355,356,357,358,359) ORDER BY id;" \
  >> docs/phase-c-evidence/stage2/A-all.txt

# A-2 pulse_send_log constraint
psql $DB -c "SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name='pulse_send_log';" \
  >> docs/phase-c-evidence/stage2/A-all.txt

# A-3 get_all_subordinates function
psql $DB -c "SELECT proname FROM pg_proc WHERE proname='get_all_subordinates';" \
  >> docs/phase-c-evidence/stage2/A-all.txt

# A-4 payroll_runs_status_check includes 'queued'
psql $DB -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='payroll_runs_status_check';" \
  >> docs/phase-c-evidence/stage2/A-all.txt

# A-5 background_jobs idempotency_key unique
psql $DB -c "SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name='background_jobs' AND constraint_type='UNIQUE';" \
  >> docs/phase-c-evidence/stage2/A-all.txt
```

**Stop here if any A check fails. Do not proceed to Section B.**

---

### Section B — API

```bash
# B-H1 Muster render timing (expect <2s)
time curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$API/attendance/muster?month=$MONTH" \
  > docs/phase-c-evidence/stage2/B-H1.txt

# B-H11 Helpdesk stats — field must be 'breached' not 'sla_breached'
curl -s -H "Authorization: Bearer $TOKEN" "$API/helpdesk/stats" | jq . \
  > docs/phase-c-evidence/stage2/B-H11.json
# Assert: .data.breached exists (not .data.sla_breached)
jq '.data | has("breached")' docs/phase-c-evidence/stage2/B-H11.json
# Must print: true

# B-H15 Muster export — route is /reports/muster-roll/export
curl -s -D - -H "Authorization: Bearer $TOKEN" \
  "$API/reports/muster-roll/export?month=$MONTH" \
  > docs/phase-c-evidence/stage2/B-H15-normal.txt
# Assert first line: HTTP/... 200

# B-H15 Over-limit path (seed >200k rows first or use a large tenant)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/reports/muster-roll/export?month=$MONTH" \
  > docs/phase-c-evidence/stage2/B-H15-overlimit.txt
# Assert: {"code":"EXPORT_TOO_LARGE"} if over limit

# B-G2 Recursive manager scope — use /manager/team-helpdesk, NOT /employees?scope=reports
curl -s -H "Authorization: Bearer $MGR_TOKEN" \
  "$API/manager/team-helpdesk" | jq . \
  > docs/phase-c-evidence/stage2/B-G2.json
# Assert: result includes at least one employee_id from depth-2 (grandreport)
# Manually confirm one ID belongs to a grandreport of the manager token's user

# B-C4 Leave scheduler sub-job fan-out
# Option A: restart API during Monday 09:00-09:59 window, wait 10s, then:
psql $DB -c "SELECT type, status, idempotency_key FROM background_jobs WHERE type LIKE 'leave-%' ORDER BY created_at DESC LIMIT 10;" \
  > docs/phase-c-evidence/stage2/B-C4-jobs.txt

# Option B (any time): direct insert, then query
psql $DB -c "
INSERT INTO background_jobs (id, type, payload, status, idempotency_key)
VALUES (gen_random_uuid(), 'leave-scheduler-tick', '{}', 'queued',
        'leave-scheduler-tick:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24'))
ON CONFLICT (idempotency_key) DO NOTHING;" 
sleep 10
psql $DB -c "SELECT type, status FROM background_jobs WHERE type LIKE 'leave-%' AND created_at > now() - interval '30 seconds' ORDER BY created_at;" \
  >> docs/phase-c-evidence/stage2/B-C4-jobs.txt
# Assert: 6 rows with types leave-yearly-accrual, leave-monthly-accrual, leave-carry-forward,
#          leave-co-expiry, leave-event-grants, leave-reconciliation

# B-C4 Idempotency check (re-run insert, no new rows should appear)
psql $DB -c "
INSERT INTO background_jobs (id, type, payload, status, idempotency_key)
VALUES (gen_random_uuid(), 'leave-scheduler-tick', '{}', 'queued',
        'leave-scheduler-tick:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24'))
ON CONFLICT (idempotency_key) DO NOTHING;"
psql $DB -c "SELECT COUNT(*) FROM background_jobs WHERE type LIKE 'leave-%' AND created_at > now() - interval '60 seconds';" \
  >> docs/phase-c-evidence/stage2/B-C4-jobs.txt
# Assert: count unchanged (still 6)

# B-C5 Pulse send dedup
psql $DB -c "SELECT COUNT(*) AS sent_count FROM pulse_send_log WHERE tenant_id='$TENANT';" \
  > docs/phase-c-evidence/stage2/B-C5-sendlog.txt
# (trigger dispatch, wait for scheduler, then re-count)
psql $DB -c "SELECT COUNT(*) AS sent_count FROM pulse_send_log WHERE tenant_id='$TENANT';" \
  >> docs/phase-c-evidence/stage2/B-C5-sendlog.txt
# Assert: both counts are equal (retry did not add duplicates)

# B-C6 Payroll async — 202 happy path
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"month\":\"$MONTH\",\"tenant_id\":\"$TENANT\"}" \
  "$API/payroll/runs" | jq . \
  > docs/phase-c-evidence/stage2/B-C6-202.json
# Assert: .status == "queued", HTTP 202

# B-C6 Payroll async — 409 while queued/processing
# Re-submit immediately (before job completes)
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"month\":\"$MONTH\",\"tenant_id\":\"$TENANT\"}" \
  "$API/payroll/runs" | jq . \
  > docs/phase-c-evidence/stage2/B-C6-409.json
# Assert: HTTP 409, .code == "RUN_IN_PROGRESS" (not "ALREADY_PROCESSING")

# B-C7 Muster row cap + truncation header (large tenant)
curl -s -D - -H "Authorization: Bearer $TOKEN" \
  "$API/attendance/muster?month=$MONTH" \
  > docs/phase-c-evidence/stage2/B-C7-truncated.txt
grep "X-Truncated" docs/phase-c-evidence/stage2/B-C7-truncated.txt
# Assert: X-Truncated: true

# Section C — Scheduler heartbeat
curl -s -H "Authorization: Bearer $TOKEN" "$API/system/scheduler-health" | jq . \
  > docs/phase-c-evidence/stage2/C-scheduler-health.json
# Assert: array with at least one row where updated_at is within last 2 hours
jq '[.[] | select(.updated_at > (now - 7200 | todate))] | length' \
  docs/phase-c-evidence/stage2/C-scheduler-health.json
# Must print: ≥1
```

---

## Stage 3 — Baseline Capture

```bash
psql $DB -c "
SELECT
  (SELECT COUNT(*) FROM attendance_daily)         AS attendance_rows,
  (SELECT COUNT(*) FROM audit_logs)               AS audit_rows,
  (SELECT COUNT(*) FROM background_jobs WHERE status IN ('queued','processing')) AS jobs_pending
;" > docs/phase-c-evidence/stage0/baseline.json
# Add p95 response time and DB pool utilisation from your APM/monitoring tool manually.
```

Commit all evidence captured so far before launching workloads:
```bash
git add docs/phase-c-evidence/
git commit -m "chore: Phase C Stage 0-3 smoke evidence"
```

---

## Stage 4 — Workload Execution

Run in sequence. Record results in `docs/phase-c-evidence/stage4/`.

| # | Command pattern | SLA | Output file |
|---|----------------|-----|-------------|
| 1 | `curl -s -w "%{time_total}" "$API/attendance/muster?month=$MONTH"` | < 2 s p95 | WP2-2.4-muster-render.txt |
| 2 | `curl -s "$API/reports/muster-roll/export?month=$MONTH" -o /dev/null -w "%{time_total}"` | < 30 s | WP2-2.5-muster-export.txt |
| 3 | `curl -s -w "%{time_total}" "$API/audit-logs?from=2026-06-01"` | < 5 s p95 | WP4-4.8-audit-query.txt |
| 4 | `curl -s -w "%{time_total}" -H "Authorization: Bearer $MGR_TOKEN" "$API/manager/team-helpdesk"` | < 3 s p95 | WP3-3.x-manager-team.txt |
| 5 | `curl -s "$API/helpdesk/stats" && curl -s "$API/helpdesk/tickets"` | < 2 s p95 | WP5-5.x-helpdesk.txt |
| 6 | See B-C6 commands above | 202 + 409 correct | WP6-6.x-payroll.txt |
| 7 | See B-C4 commands above | 6 sub-jobs ≤ 10 s | WP1-1.x-leave-scheduler.txt |
| 8 | See B-C5 commands above | no duplicates | WP7-7.x-pulse-dedup.txt |

After all workloads:
```bash
git add docs/phase-c-evidence/
git commit -m "chore: Phase C Stage 4 workload evidence"
```

---

## Go/No-Go — Final Check

```bash
# Any hard blocker?
# 1. Review all stage2/ files — any non-200/non-expected response?
# 2. Review all stage4/ files — any SLA breach?
# 3. Confirm pulse_send_log retry count unchanged (B-C5)
# 4. Confirm RUN_IN_PROGRESS in B-C6-409.json
# 5. Confirm 6 leave sub-jobs in B-C4-jobs.txt
# 6. Confirm X-Truncated: true in B-C7-truncated.txt (if >200k rows)

# Record verdict
cat > docs/phase-c-evidence/verdict/go-nogo.md << 'EOF'
# Phase C Go/No-Go

Date: 
Operator: 
Candidate: phase-c/gate1-rc1 @ f025fef

| Check | Result |
|-------|--------|
| All Section A DB checks | PASS / FAIL |
| All Section B API checks | PASS / FAIL |
| All Stage 4 SLAs | PASS / FAIL |
| pulse_send_log dedup | PASS / FAIL |
| payroll RUN_IN_PROGRESS | PASS / FAIL |
| leave sub-jobs = 6 | PASS / FAIL |

Known gaps accepted: YES (muster depth-1, attendance unpartitioned)

**Verdict: GO / NO-GO**
EOF

git add docs/phase-c-evidence/
git commit -m "chore: Phase C go/no-go verdict"
git push origin claude/cool-planck-k749sn
```
