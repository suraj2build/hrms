# Phase C Evidence Folder

**Candidate:** `phase-c/gate1-rc1` @ `f025fef`  
**Runbook:** `docs/CognixHR_PhaseC_Launch_Runbook.md` v1.1  
**Started:** <!-- fill in -->  
**Operator:** <!-- fill in -->

All Phase C artifacts belong here. One subfolder per stage. Never edit files after capture — append a new file with a `_v2` suffix if a re-run is needed.

---

## Folder Structure

```
docs/phase-c-evidence/
├── README.md                        ← this file; fill in date + operator before starting
│
├── stage0/
│   ├── migration-check.txt          ← psql output of A-1 migration completeness query
│   ├── constraint-checks.txt        ← psql output of A-2 through A-5 queries
│   └── baseline.json                ← Stage 3 baseline capture (row counts, p95, pool util)
│
├── stage2/
│   ├── A-all.txt                    ← Section A: all DB/schema check outputs (one file)
│   ├── B-H1.txt                     ← muster render response + timing
│   ├── B-H11.json                   ← raw /helpdesk/stats response body
│   ├── B-H15-normal.txt             ← muster export 200 response headers
│   ├── B-H15-overlimit.txt          ← muster export 422 response body
│   ├── B-G2.json                    ← /manager/team-helpdesk response (confirm depth-2 rows)
│   ├── B-C4-jobs.txt                ← background_jobs query output after scheduler trigger
│   ├── B-C5-sendlog.txt             ← pulse_send_log count before and after retry
│   ├── B-C6-202.json                ← payroll POST 202 response body
│   ├── B-C6-409.json                ← payroll POST 409 response body (RUN_IN_PROGRESS)
│   ├── B-C7-truncated.txt           ← muster response headers showing X-Truncated: true
│   └── C-scheduler-health.json      ← /system/scheduler-health response
│
├── stage4/
│   ├── WP2-2.4-muster-render.txt    ← p95 timing, row count, pass/fail
│   ├── WP2-2.5-muster-export.txt    ← export timing, file size, pass/fail
│   ├── WP4-4.8-audit-query.txt      ← audit log query p95, pass/fail
│   ├── WP3-3.x-manager-team.txt     ← team view timing, depth-2 row present, pass/fail
│   ├── WP5-5.x-helpdesk.txt         ← stats + ticket list timing, pass/fail
│   ├── WP6-6.x-payroll.txt          ← 202 + 409 sequence, pass/fail
│   ├── WP1-1.x-leave-scheduler.txt  ← 6 sub-job rows confirmed, pass/fail
│   └── WP7-7.x-pulse-dedup.txt      ← send count + retry count (must match), pass/fail
│
└── verdict/
    ├── go-nogo.md                   ← filled Go/No-Go Control Sheet from runbook §Control Sheet
    └── stage4-summary.csv           ← one row per workload: id, sla_target, p95, result
```

---

## File Capture Instructions

- **psql output:** `psql $DATABASE_URL -c "..." > docs/phase-c-evidence/stage2/A-all.txt`
- **HTTP responses:** `curl -s -D - <url> > docs/phase-c-evidence/stage2/B-H15-normal.txt`
- **JSON bodies:** `curl -s <url> | jq . > docs/phase-c-evidence/stage2/B-H11.json`
- **Timing:** prefix curl with `time` or use `curl -w "\n%{time_total}s\n"`

Commit the entire `docs/phase-c-evidence/` folder to the branch at the end of each stage. Do not zip or attach — keep artifacts in git for traceability.
