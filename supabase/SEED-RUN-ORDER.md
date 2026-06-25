# Demo Seed — Run Order

Run these in the **Supabase SQL Editor** for the Demo tenant, **in this exact order**.
Each file is a single idempotent transaction (safe to re-run; it clears its own rows first).

| # | File | What it populates |
|---|------|-------------------|
| 1 | `seed-demo.sql`          | Core: tenant, employees, masters, attendance, leave balances, payroll runs & slips, recruitment, assets, helpdesk |
| 2 | `seed-demo-extra.sql`    | Attendance exceptions, reimbursements, advances, documents, benefits, letters, onboarding, separation, nominations, certifications |
| 3 | `seed-demo-extra-2.sql`  | Overtime, comp-off, loans (+schedules/payments), **payroll_run_employees**, notifications, HRA declarations, incentives/variable pay, audit logs |
| 4 | `seed-demo-extra-3.sql`  | Payroll statutory: EPF/ESI/PT contributions, adjustments, arrears, run blockers/events, GL ledger |
| 5 | `seed-demo-extra-4.sql`  | Tax: investment declaration plans + items + components, proofs, previous-employer tax |
| 6 | `seed-demo-extra-5.sql`  | Leave accrual rules, accrual ledger, accrual runs, balance ledger |
| 7 | `seed-demo-extra-6.sql`  | Shift roster + extra shifts, rosters, rotation groups/members, weekly-off & holiday groups |
| 8 | `seed-demo-extra-7.sql`  | Notification templates + log, helpdesk comments, asset categories, OT policies, EPF/ESI/PT config |
| 9 | `seed-demo-extra-8.sql`  | Analytics coverage: leave_applications, sites (+ headcount attribution), statutory registrations, intelligence digest, workforce staffing snapshots/hints, LWF contributions, operational incidents, onboarding/pre-join funnel, attendance exceptions |
| 10 | `seed-demo-extra-9.sql` | ESS 2.0 pillars: **recognition** (peer kudos — Priya gives & receives so "me"/leaderboard populate), **feed_posts** (pinned HR announcements + updates/birthday/anniversary/new-joiner/milestone), **feed_reactions** (incl. the demo login's own), **feed_comments** |

## Notes
- Order matters: files 2–8 reference rows created by `seed-demo.sql` (employees,
  payroll runs, leave types, helpdesk tickets), so always run #1 first.
- Files 2–8 are **independent of each other** — if one fails, the others still apply.
  Each runs in its own `begin … commit`, so a failure rolls back only that file.
- All files are **idempotent**: re-running any file deletes its own demo rows first,
  then re-inserts. No duplicates, no manual cleanup needed.
- Every file was validated before commit: column/value counts balanced, all enum
  literals checked against the current CHECK constraints, all FK references resolve.

## If a file errors
Copy the exact error (table + message) — it will name the constraint or column.
The fix is almost always a single enum literal or column name; report it and it
can be patched in minutes. The other files are unaffected.
