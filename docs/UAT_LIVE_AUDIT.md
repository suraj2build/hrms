# CognixHR — Live UAT Audit Ledger

Started: 2026-09-03 (session continuation)
Environment: Local sandbox replica (this session's container) — Postgres 16 + PostgREST + auth shim + Fastify API + Vite web, migrated to commit `09deb07`, seeded "Demo" tenant.
Operator: Claude (autonomous), driving real Chromium via Playwright + direct API verification.

## Test Personas (created this UAT, in addition to the 12 seeded demo employees)

| Persona | Purpose | Status |
|---|---|---|
| A — Standard salaried | baseline PF/ESI/TDS/leave | pending |
| B — Manager | approvals, team ESS | pending |
| C — High salary | PF cap, no ESI, high TDS | pending |
| D — Low salary / ESI | ESI eligibility | pending |
| E — Mid-month joiner | proration | pending |
| F — LOP employee | unpaid leave/absence | pending |
| G — Arrear/revision | retro salary change | pending |
| H — Separation | resignation → F&F | pending |

## Findings Ledger

| ID | Module | Scenario | Role | Result | Severity | Evidence | Fix | Retest |
|----|--------|----------|------|--------|----------|----------|-----|--------|

## Coverage

| Domain | Passed | Failed | Partial | Not Tested |
|---|---|---|---|---|
