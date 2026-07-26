# Pending Items — Backlog from the 2026-07-26 Bug-Hunt Session

This document tracks findings surfaced during the extended bug-fixing session on
`claude/cool-planck-k749sn` that were **not** fixed — either because they need a
product/engineering decision, live-runtime verification this session couldn't
perform, or are low-severity cleanup too large to safely batch blind. Everything
else found during the session (a large number of critical/high cross-tenant
IDORs, auth bypasses, payroll miscalculations, and data-integrity races) was
fixed and merged to `main`; this file is only the leftover backlog.

Update this file as items are resolved — move fixed items out (they'll be in
git history / commit messages) rather than marking them done in place.

---

## 1. Needs live-runtime verification before any fix (HIGH suspected severity)

### 1.1 — Attendance backfill: does an absent day with zero punches ever get an `attendance_daily` row?

**Where:** `apps/api/src/lib/attendance-processor.ts` (~line 511) and
`apps/api/src/lib/attendance-engine.ts` (`computeDay`/`recomputeRange`).

**What was found:** `attendance-processor.ts` has an explicit code comment:
*"Employees with NO raw logs are unaffected (we never create absence rows for
them regardless)."* Payroll's LOP calculation (`fetchAttendanceSummary` in
`payroll-engine.ts`) only counts LOP from **existing** `attendance_daily` rows
— a missing row contributes zero to both `payable_days` and `lop_days`, not a
default "absent."

Traced every `recomputeRange(...)` call site in the codebase (punch processing,
corrections, regularisation, leave approval, WO-credit, roster edits, anomaly
resolution) — all are **reactive** to a specific user/system action for a
specific date range. No cron job, pg_cron migration, or worker process was
found that proactively creates `attendance_daily` rows (e.g. `status='absent'`)
for employees who simply never punched in and have no leave/correction/
regularisation on file.

**Why this matters:** if accurate, this means:
- A mid-month joiner would receive a full month's gross pay instead of a
  prorated amount — `total_working_days` (the LOP denominator) is the full
  month's roster working days with no `joining_date` awareness anywhere in
  `countWorkingDaysForEmployee`, and no pre-joining LOP days would ever be
  recorded either (no rows exist for those dates at all).
- More broadly, any employee who is fully absent on a working day with no
  punch and no approved leave/regularisation would not be marked LOP for that
  day, since nothing would ever have written the row.

**Why not fixed:** this is a foundational data-flow question that requires
either (a) live database inspection to confirm whether `attendance_daily` rows
actually exist for pre-joining dates / true no-show absences in production
data, or (b) a decision from whoever owns the attendance engine about whether
there's a generation path this session didn't find (e.g. a second engine, an
edge function, an external biometric-sync job). Guessing wrong here risks
either leaving a real payroll-accuracy bug in place or introducing a backfill
job that double-counts LOP against some other mechanism.

**Suggested next step:** query a production/staging tenant's
`attendance_daily` table for a recently-joined employee's pre-joining-date
range, and for a known no-show day with no leave request, to see whether rows
exist. If they don't, the fix is either (a) bound
`countWorkingDaysForEmployee`'s date range to
`[max(month_start, joining_date), min(month_end, separation_date ?? month_end)]`
so the denominator itself reflects the actual employment period within the
month (cleanest fix — no absence-backfill job needed), or (b) add a scheduled
job that writes `status='absent', day_fraction=0` rows for active employees
with no punch/leave/regularisation on a working day.

---

## 2. Medium severity, deferred

### 2.1 — WhatsApp inbound message routing: phone-number lookup has no tenant disambiguation

**Where:** `apps/api/src/routes/whatsapp/index.ts:71-79`

```js
const { data: employees } = await supabase.from('employees')
  .select('id, tenant_id, first_name').eq('phone', from).eq('status', 'active').limit(1)
```

`employees.phone` has no unique constraint (`supabase/migrations/004_employees.sql`),
and the query has no `.order()`, so if two different tenants each have an
active employee with the same phone number (demo data, reused SIM after
offboarding, data-entry error), the row returned is whichever Postgres happens
to return first — nondeterministic. An inbound WhatsApp message (mood
check-in, policy ack, note) could get attributed to the wrong tenant and wrong
employee.

**Not a spoofing risk** — the webhook's HMAC-SHA256 signature verification
(`timingSafeEqual`) is correctly implemented, so this can't be triggered by an
external attacker, only by a genuine phone-number collision across tenants.

**Why not fixed:** the "correct" fix depends on a product decision — should
`employees.phone` be tenant-scoped unique (a migration + backfill, with a
decision about what happens to existing collisions), or should the WhatsApp
integration require a per-tenant business-number mapping that disambiguates
by which WABA number received the message rather than by employee phone
alone? Either is a real design change, not a one-line fix.

**Suggested next step:** decide the disambiguation strategy, then either add
a partial unique index on `(tenant_id, phone) WHERE status = 'active'` (to at
least fail loudly on collision rather than silently picking one) or thread the
receiving WABA/business-number through to scope the lookup.

---

## 3. Investigated and ruled out (kept here for reference — not pending)

- **`pre-joinee.ts` "two divergent re-upload code paths"** (originally flagged
  in an earlier pass) — re-investigated; the actual code uses a single,
  well-factored `reopenInvitationForReupload()` helper called from one route.
  No bug found; the original concern doesn't hold up on inspection.
