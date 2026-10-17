# Friends Pilot — Deployment Handoff

**Status: pilot feature work is frozen at the candidate below. Nothing here has
been deployed or verified on a reachable environment yet. Do not tell anyone
the pilot is ready to use until every check in "Post-deployment verification"
below has actually passed on that environment — not inferred, not assumed
from local testing.**

This document is the single source of truth for standing up the invite-only
friends pilot. It exists because local-sandbox testing (see
`docs/pilot/PILOT_LOCAL_FINDINGS.md`) proved real things (the server-side
gate's logic, the route coverage, the backup/restore mechanics) but
structurally cannot prove others (RLS enforcement, true network-level
privacy, anything that depends on a real Supabase project's auth and storage
stack) — see that doc's "What local testing could not prove" section before
assuming anything below is already verified.

---

## 1. Release candidate

- **Branch**: `integration/g13-plus-market-priorities`
- **Frozen candidate SHA**: `4685ffcb` (full: `4685ffcbc5749ee1b5ad92a7d251c385f99e3ed4`)
- **Do not deploy a later commit on this branch without re-running this
  document's verification checklist against it.** If more commits land
  before hosting is available, either re-freeze at the new HEAD and update
  this line, or deploy exactly `4685ffcb` by checking out that commit.
- `main` is untouched by this work; PR #30 (the underlying feature branch)
  remains unmerged.

## 2. Database migrations

- Full history: `supabase/migrations/001` through `458` (454 files; some
  numbers are intentionally absent from earlier renumbering — see
  `supabase/migrations/README.md` if present, or `git log` on the
  `supabase/migrations/` directory for the renumbering history).
- Apply the complete history in order against the **dedicated pilot Supabase
  project** (see §3 — never against the existing production project).
- After applying, confirm `tenants.is_pilot` exists:
  ```sql
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'tenants' AND column_name = 'is_pilot';
  ```
  (added in migration 456) and `error_reports.screenshot_path` exists
  (migration 457), and that migration 458's two `CREATE OR REPLACE FUNCTION`
  statements applied without error (no reliable single-query check for
  function *bodies* — confirm via the deploy log instead).
- This repo already has tooling for verifying a staging candidate's migration
  state matches a given SHA — `scripts/verify-staging-candidate.sh` (see its
  own header comment). Point it at the pilot deployment once URLs exist
  rather than re-inventing that check here.

## 3. Required configuration (names only — see `apps/api/.env.example` /
`apps/web/.env.example` in this repo for full descriptions of each)

**Use a dedicated Supabase project for the pilot — never the existing
production project.** This is the single most important configuration
decision: it's what makes "reset the pilot" a safe, total operation (drop and
recreate the project) instead of a risky one, and what makes a pilot-side
mistake structurally unable to touch real tenant data.

| Target | Required env vars (names only) |
|---|---|
| API | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `PORT`, `NODE_ENV=production`, `APP_PUBLIC_URL`, `WEB_URL` |
| API (optional, recommended) | `RESEND_API_KEY`, `EMAIL_FROM` — only if invite emails should actually send |
| API (must stay **unset**) | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — billing must be unreachable on a pilot deployment regardless of the server-side gate |
| Web | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Web (must stay **unset**) | `VITE_DEMO_MODE`, `VITE_DEMO_LOGIN` — these auto-sign-in any visitor; never set on a deployment real people will reach |
| DB migrations | A direct Postgres connection string for the pilot Supabase project (for running `supabase/migrations/*.sql` and for `scripts/pilot/seed-pilot-tenant.mjs`'s `DATABASE_URL`) |

Standard platform assignment per `docs/deployment-runbook.md`: API → Railway
(or equivalent persistent-process host), web → Vercel (or equivalent static
host) — confirmed current for production; re-confirm before assuming it also
applies to wherever the pilot ends up, since the pilot may reasonably use
different/cheaper hosting given its small scale.

## 4. Creating the pilot tenant and synthetic accounts

Use `scripts/pilot/seed-pilot-tenant.mjs` — not a one-off manual process. It
creates four accounts (super_admin, hr_admin, manager, employee) through the
real signup/employee API (not a shortcut), and either flips
`tenants.is_pilot = true` directly (if given `DATABASE_URL`) or prints the
exact SQL to run by hand. Re-runnable: running it again creates a **second**
pilot tenant with fresh timestamped emails, which is fine for re-seeding
after a reset (§7) but means it is not idempotent against the same tenant —
don't run it twice expecting it to no-op.

```bash
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_ANON_KEY=... \
API_BASE_URL=https://<pilot-api-host> \
DATABASE_URL=postgres://... \
node scripts/pilot/seed-pilot-tenant.mjs
```

Output: `./pilot-seed-result.json` (gitignored — contains the shared
password; never commit it, never paste it into chat/issue trackers; hand it
to each friend over a channel that isn't persisted in plaintext — a password
manager share, not email/Slack).

**Known product gap this script works around**: there is no self-service API
to provision an `hr_admin` account (only `employee`/`manager` roles can be
created via `POST /employees/:id/user-account`) — only the tenant's own
`super_admin`, created at signup, or a direct `profiles` insert can produce
one. The script does the latter. This is a pre-existing product gap, not
something introduced for the pilot; fixing it (a proper "invite a co-admin"
flow) is out of scope for this round's freeze.

## 5. Invite-only configuration

There is no dedicated "disable public signup" toggle in this codebase today
— building one would be feature work, which is frozen for this round. The
practical invite-only posture, until/unless that's built:

1. **Don't publicize the pilot's URL anywhere public** (no public links,
   no indexed pages). Share it directly with the specific friends invited.
2. **Share credentials out of band** — the password from
   `pilot-seed-result.json`, never emailed or posted in plaintext.
3. A stranger who finds the URL and uses `/signup` cannot join the pilot
   tenant — public self-signup always creates a **new, separate** tenant
   (see `apps/api/src/routes/setup.ts`), not membership in an existing one.
   The actual risk from an undisclosed-but-reachable URL is clutter (someone
   creates their own unrelated tenant on the same infrastructure) and
   unnecessary exposure of the app to the open internet, not a path into the
   pilot tenant's data.
4. If true access control is wanted (e.g. an allowlist gate in front of
   `/signup` and `/login`), that is new feature work for a later round, not
   something this freeze permits building now. Flag it as a follow-up
   decision, not a silent gap.

## 6. Server-side pilot restrictions (already built, frozen as of `4685ffcb`)

`tenants.is_pilot` (migration 456) + `blockIfPilotTenant()`
(`apps/api/src/lib/pilot-guard.ts`) fail **closed**: on a verified pilot
tenant it returns 403 `PILOT_TENANT_RESTRICTED`; if the tenant's status can't
be verified (DB error, timeout) it returns 503
`PILOT_STATUS_CHECK_UNAVAILABLE` and performs no write; only a verified
non-pilot tenant proceeds normally.

31 route call-sites are currently gated (grep `blockIfPilotTenant(fastify.supabase`
across `apps/api/src/routes/` for the exact, current list — it's the ground
truth, not this paragraph, if the two ever drift):

- Payroll run finalize and rollback
- GL ledger generate / post / reverse / export (both the GL export and the
  separate "explainability ledger" export stub)
- Filing-pack generation (PF ECR, 24Q, challan) and artifact recording
- The standalone statutory exports (EPF — both routes, ESI, PT, LWF, TDS, challan)
- Payout-obligation generation and payout-reconciliation updates
- Salary-advance disbursement and recovery recording
- Employee-loan disbursement, foreclosure, and payment recording
- Reimbursement-claim mark-as-paid
- Full & final settlement mark-paid and its paid-settlement correction
- Accounting-system export and paid PAN-verification lookups

## 7. Deployment smoke tests

Run in this order immediately after deploying and seeding, **before telling
anyone the pilot is ready**:

1. **General health**: `scripts/smoke-test.mjs` against the new deployment
   (`SMOKE_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SMOKE_EMAIL`/
   `SMOKE_PASSWORD` — use the pilot's own super_admin or hr_admin).
2. **Staging-candidate match**: `scripts/verify-staging-candidate.sh` — confirms
   the deployed web/API SHAs and DB migration state actually match `4685ffcb`,
   not a stale or partial deploy.
3. **Pilot gate**: `scripts/pilot/pilot-smoke-check.mjs` — confirms the
   financial-action gate fires for the pilot tenant and does **not** fire for
   a real (control) tenant. Pass `CONTROL_HR_EMAIL`/`CONTROL_HR_PASSWORD` for
   an existing real tenant's hr_admin — skipping this is explicitly flagged
   by the script as blocking go-live, not an optional nicety: it is the only
   check that proves the gate hasn't started blocking real customers.
4. Only after 1–3 all pass: proceed to the full "Post-deployment
   verification" list below.

## 8. Rollback

Because the pilot uses a **dedicated Supabase project** (§3) and its own
hosting deploys, rollback never risks production data:

- **API/web bad deploy**: redeploy the previous working build on the hosting
  platform (Railway/Vercel both keep prior deploys and support instant
  rollback — use the platform's own rollback action, not a new git revert
  deploy, to minimize time-to-recovery).
- **DB migration problem**: restore the pilot Supabase project from its own
  automatic backup (if the platform provides one) or re-run migrations
  001–458 against a freshly created pilot project and re-seed (§4) — total
  data loss is acceptable here by design, since all pilot data is synthetic.
- **Full stop**: simply take the hosting deploys down (or delete the pilot
  Supabase project outright) — there is no shared infrastructure with
  production to coordinate around.

## 9. Post-deployment verification (must ALL pass before declaring the pilot shareable)

Run these against the real deployment, not local. If any fails: fix the
underlying issue, redeploy, and re-run the **entire list** — not just the
failed item, since a fix can regress an earlier-passing check.

1. **Real login and role permissions** — sign in as each of the 4 seeded
   roles through the actual web UI; confirm each lands on the correct
   shell and cannot reach actions above their role (e.g. employee cannot
   reach `/admin/*`).
2. **Cross-tenant database RLS** — positive control (same-tenant access
   succeeds) and negative control (cross-tenant access fails) against the
   pilot project's real Supabase Auth + Storage + Postgres RLS, not the
   local test gateway (which cannot exercise RLS at all — see
   `PILOT_LOCAL_FINDINGS.md`).
3. **Screenshot upload/download privacy** — upload a feedback screenshot as
   the pilot tenant; confirm an anonymous/unauthenticated request cannot
   fetch it; confirm a different (control) tenant's authenticated user
   cannot fetch it; confirm the owner panel's signed-URL endpoint can.
4. **Every restricted financial route** (§6's list) — confirm 403 for the
   pilot tenant with **zero persisted side effects** (query the relevant
   table directly after each attempt — a 403 response alone doesn't prove
   nothing was written if the guard were ever bypassed by a code path this
   list missed).
5. **Attendance/leave/payroll-preview journeys and feedback** — walk the
   actual golden paths a friend would use: punch in/out, apply for leave,
   generate a payroll preview, submit feedback with a screenshot.
6. **Backup and restore on the hosted environment** — confirm the pilot
   Supabase project's own backup mechanism actually produces a restorable
   snapshot (don't assume parity with the local `pg_dump`/`pg_restore`
   rehearsal already proven in this repo's history — a managed platform's
   backup/restore is a different mechanism entirely and has never been
   exercised for this project).

Only once all six have a real, dated PASS recorded (append results to this
file or a dated sibling doc under `docs/pilot/`) should friends be invited.
