# Friends Pilot — Local Sandbox Findings

This is the durable record of what local-sandbox work actually proved and
did not prove, ahead of deploying the pilot to a reachable environment (see
`PILOT_DEPLOYMENT_HANDOFF.md`). It exists in the repository, not only in a
session's scratch directory, specifically because evidence that only lives
in `/tmp` disappears with the session — this is the preserved version.

All work below was done against the local sandbox: a hand-rolled test
gateway (`/tmp/supabase-gateway.mjs`, not part of this repo) emulating
Supabase's REST surface against a real local Postgres 16 instance, with the
real Fastify API and Vite web app running on top. Frozen candidate:
`integration/g13-plus-market-priorities` @ `4685ffcb`.

## What was proven (real findings, real fixes, real tests)

### Pilot-guard fails closed, not open

`blockIfPilotTenant()` (`apps/api/src/lib/pilot-guard.ts`) originally failed
*open* on any DB error, timeout, or missing tenant row — on the reasoning
"never block a real tenant on a transient failure." That's backwards for a
security gate: "can't verify pilot status" silently became "treated as
verified non-pilot," which is exactly the condition the gate exists to
prevent. Fixed: any unverifiable lookup now returns `503
PILOT_STATUS_CHECK_UNAVAILABLE` and blocks the write; only a *positive*
non-pilot confirmation allows it through. 4 unit tests
(`apps/api/src/lib/__tests__/pilot-guard.test.ts`) exercise each failure
mode (DB error, synchronous throw, rejected promise, missing row) directly.
Live-verified against the local stack: a confirmed non-pilot tenant reaches
normal route logic unaffected; the pilot tenant still gets 403.

### 31 routes are gated — found via a systematic audit, not just instinct

An initial pass (round 11) gated the obvious routes: payroll finalize,
filing-pack generation, the main statutory exports, payout-obligations. A
full grep of every route in `payroll/*`, `payroll/statutory/*`,
`integrations/*`, and the F&F separation routes (round 12) found 13 more
real gaps:

- A **second, independent** EPF ECR export route
  (`GET /payroll/statutory/epf/export/:month`) that the first pass missed
  entirely — gating `GET /payroll/exports/epf` alone left this one wide open.
- The GL ledger's own generate/post/reverse/export actions — arguably more
  directly "real money" than the exports of it, and previously ungated.
- `POST /payroll/runs/:id/rollback` — unreachable in practice while finalize
  is blocked, gated anyway for defense in depth.
- **The actual real-money "paid" transitions**: salary-advance disbursement
  and recovery, employee-loan disbursement/foreclosure/payment, reimbursement
  mark-as-paid, and — the single highest-value gap found — the full & final
  settlement's `mark-paid` and `correct-payment` routes
  (`PATCH /employees/:id/separation-ff/mark-paid`, `.../correct-payment`).
  These are the routes this entire codebase's F&F engineering effort
  (migrations 445–452, `mark_fnf_paid_atomic`) was built around, and they had
  no pilot gate at all until this round.
- A paid external PAN-verification lookup (`POST /integrations/pan/verify`)
  — real per-call cost, unrelated to payroll.

The current, authoritative list of gated routes is not this document — it's
`grep -rn "blockIfPilotTenant(fastify.supabase" apps/api/src/routes/`. This
document records *how* the gaps were found and *why* specific routes were
deliberately left ungated (payslip CSV export of already-visible preview
numbers, read-only reconciliation/readiness reports, variable-pay draft-stage
data entry, the free public IFSC lookup) — not a list that will go stale.

### Tenant hard-delete was broken for every real tenant — found while testing "reset," fixed, live-verified

Rehearsing the pilot's "reset" path (the owner panel's `DELETE
/owner/tenants/:id`, which relies on `ON DELETE CASCADE`) against a test
tenant with one real employee record reproduced a genuine, previously
undiscovered defect: the delete failed with a foreign-key violation on
`audit_logs`. Root cause: `employees` and 14 master tables each carry an
`AFTER DELETE` audit trigger that inserts a new `audit_logs` row — but by the
time the cascade reaches those triggers, the parent `tenants` row (which
`audit_logs.tenant_id` itself references) is already gone, so the new insert
violates its own FK. This means the hard-delete action had probably never
successfully run against a tenant with real data before this rehearsal.

Fixed in migration 458: both trigger functions now catch
`foreign_key_violation` and no-op instead of raising — safe specifically
because that violation can only occur once the tenant no longer exists, at
which point `audit_logs` rows for it are being cascade-deleted in the same
transaction anyway. **Live-verified end to end, with explicit user
authorization for the one destructive action involved**: created a
throwaway tenant with a real employee record, confirmed the delete failed
before the fix (captured the exact error), applied the fix, confirmed the
delete then succeeded (`DELETE 1`) with a fully clean cascade — zero
remaining `tenants`, `employees`, or `audit_logs` rows for that tenant id.

### Local backup/restore rehearsal: 18/18 checks passed

`scripts/backup-restore-rehearsal-check.sh` (pre-existing in this repo) was
re-run against the post-migration-458 database: `pg_dump`/`pg_restore`
round-trip in under 11 seconds total, every sampled table's row count
matched exactly between source and restored copy, and a full content
checksum (not just row count) on `payroll_slips` matched exactly. This
proves the underlying Postgres data is backup/restorable with integrity —
see "What local testing could not prove" below for what it does *not* prove.

## What local testing could not prove — and precisely why

This section exists because earlier rounds of this engagement stated
isolation/privacy conclusions in terms broader than what was actually
tested. The corrected, narrower claims:

### RLS enforcement was never actually exercised, for anything, in this entire engagement

Investigating screenshot-attachment privacy (a feedback screenshot should
not be readable by another tenant) led to three compounding, confirmed
findings:

1. `storage.objects` had RLS **policies defined but RLS disabled on the
   table itself** in this local Postgres replica — real Supabase enables RLS
   on this table at the platform level by default; nothing in this repo's
   own migrations does that, because it's not an application concern in a
   real deployment.
2. The `authenticated` Postgres role had **no grants at all** on the
   `storage` or `auth` schemas in this local replica — again, standard
   Supabase platform setup this repo's migrations never needed to (and
   don't) replicate.
3. After correcting both of the above (locally, to continue investigating):
   **`auth.uid()` in this local sandbox is a hardcoded stub —
   `SELECT NULL::uuid`, unconditionally** — not a real implementation
   reading the caller's JWT session claims. No session-variable
   manipulation can change this, because the function body never reads one.

Since `get_user_tenant_id()`, `get_user_role()`, and `get_user_employee_id()`
all chain through `auth.uid()`, finding 3 alone means **every RLS policy in
this schema is structurally impossible to exercise correctly in this local
sandbox** — not just the storage policy. Separately and independently
confirmed: the local test gateway's own Postgres connection
(`postgres://postgres:postgres@localhost:5432/...`) runs as the `postgres`
**superuser**, which bypasses RLS unconditionally regardless of whether it's
enabled on any given table.

**The conclusion that follows**: every tenant-isolation claim made in every
prior round of this engagement — including "5/5 isolation checks pass" —
was proven at the **application layer only** (the Fastify routes' own
`.eq('tenant_id', ...)` filters, which are real code, correctly written, and
were genuinely exercised). None of it was ever proven at the **database RLS
layer**, because this sandbox cannot exercise that layer for anything, for
structural reasons that have nothing to do with how carefully the testing
was done. The RLS policy text itself (e.g. migration 418's
`employee-files` bucket policy) reads as correctly scoped on inspection —
but "reads correctly" and "verified to enforce correctly" are different
claims, and only the second one requires a real Supabase project to make
honestly. This is why `PILOT_DEPLOYMENT_HANDOFF.md`'s post-deployment
verification list treats RLS and storage privacy as **unverified until
checked on the real deployment**, not as already covered.

### Backup/restore: local success does not establish recovery on the eventual hosted environment

The 18/18 local result above proves the Postgres *data* round-trips with
integrity via `pg_dump`/`pg_restore`. It says nothing about whatever backup
mechanism the actual hosting platform (Supabase's own managed backups, or a
platform like Railway/Render's) provides — that's a different mechanism,
never exercised for this project, and needs its own check once a real
deployment exists (see the handoff doc's verification item 6).

### Account creation alone does not establish invite-only access

The four synthetic pilot accounts were created through the real API
(signup + `/setup` + `/employees` + `/employees/:id/user-account`), proving
that flow works — not that the deployment is closed to uninvited access.
Self-service `POST /signup` remains reachable by anyone who finds the URL;
it creates a new, separate tenant rather than joining the pilot tenant (so
it isn't a path into pilot data), but it is not an access-control gate.
`PILOT_DEPLOYMENT_HANDOFF.md` §5 describes the operational (not technical)
posture this leaves in place, and names the actual technical gate as
future work, not something already built.

## Where the evidence lives

Granular, blow-by-blow session logs (every command run, every intermediate
result) remain in this session's scratchpad
(`uat/DEFECTS.md`) — useful as a working log, not durable. This document is
the distilled, durable version: what was actually found, actually fixed,
and actually still needs a real deployment to check. If the two ever
disagree on a factual point, this document and the actual code/git history
are authoritative — the scratchpad log is reconstructable narrative, not a
source of truth.
