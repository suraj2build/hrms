# CognixHR Deployment Runbook

> **Engineering Freeze is in effect.** Only production blockers and certified
> UAT defects are permitted to merge. Reference the UAT artifact before
> approving any change.

---

## Overview

This runbook covers every deployment of the CognixHR API and web application
to Railway (production) or the staging environment. Follow every step in order.
Mark each step complete in the War Room thread before proceeding to the next.

---

## Pre-flight (before pushing)

| # | Check | Command / Action |
|---|-------|-----------------|
| 1 | All CI checks are green on the branch | Verify GitHub Actions before merge |
| 2 | Schema drift passes | `npm run db:check-drift` |
| 3 | Tenant isolation ratchet | `node scripts/check-tenant-isolation.mjs --ratchet` |
| 4 | Error hygiene ratchet | `node scripts/check-manual-500s.mjs && node scripts/check-console-error.mjs` |
| 5 | Data correctness ratchet | `node scripts/check-unbounded-queries.mjs --ratchet` |
| 6 | Typecheck + lint | `npm run typecheck && npm run lint` |

**Gate:** All six checks must be green. Do not merge a branch with a failing ratchet — update the baseline only after the underlying violation is genuinely fixed.

---

## Deploy

Railway auto-deploys from `main` on push. For manual promotion:

1. Push the branch to `main` (via PR merge).
2. In the Railway dashboard → **Deployments** → confirm the new build starts within 60 s.
3. Note the deployment ID and timestamp in the War Room thread.

Expected build time: **2–4 minutes** for API cold compile; web is faster.

---

## Post-deploy verification

### Step A — Wait for Railway health

Railway's health check probes the `/health` endpoint (configured in `railway.toml`).
Wait until the deployment status shows **Active** (green dot) before proceeding.
If the deployment rolls back automatically, treat it as a P0 — do not proceed
to step B; jump straight to the Rollback procedure.

### Step B — Run the smoke suite

Run the smoke test against the newly deployed environment:

```sh
SMOKE_BASE_URL=https://hrmsapi-production.up.railway.app \
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_ANON_KEY=<anon-key> \
SMOKE_EMAIL=<smoke-user@yourdomain.com> \
SMOKE_PASSWORD=<smoke-password> \
node scripts/smoke-test.mjs
```

Or trigger via GitHub Actions: **Actions → Smoke test → Run workflow → production**.

**Expected output:**

```
CognixHR Smoke Test
Target: https://hrmsapi-production.up.railway.app
As of:  2026-07-12T...
────────────────────────────────────────────────────────────
Authenticating... OK
  Compensation coverage audit              PASS
  Payroll readiness score                  PASS
  Muster roll (2026-07)                    PASS
  Leave team balances                      PASS
  ESS home                                 PASS
────────────────────────────────────────────────────────────
✓  5/5 probes passed
```

If **any probe fails**, do not mark the deployment healthy. Follow the
Triage table below before proceeding.

### Step C — Railway log scan

In Railway → **Logs**, filter to the last 10 minutes. Check for:

- Any `ERROR` or unhandled rejection lines
- `Cannot GET` 404s (route not registered)
- `SUPABASE_` env var warnings (missing secrets)
- Memory OOM warnings

A clean deploy produces only startup lines (`Fastify listening on port …`).

### Step D — Verify critical dashboards

Log in to the production CognixHR console as an HR admin and verify:

| Dashboard | What to check |
|-----------|---------------|
| Payroll → Operations Center | Compensation coverage card loads, shows `total_active_employees > 0` |
| Payroll → Readiness Score | Score widget renders (any number 0–100 is valid) |
| Attendance → Muster Roll | Current month loads, employee rows visible |
| ESS → Home | Home screen renders without blank sections |

### Step E — Mark deployment healthy

Post to the War Room thread:

```
✅ Deploy <commit-sha> healthy
   Smoke: 5/5 probes passed
   Railway: no errors in post-deploy log
   Dashboards: Ops Center, Muster, ESS Home all render
   Time: <HH:MM UTC>
```

---

## Smoke probe triage

| Probe | Likely cause | Investigation |
|-------|-------------|---------------|
| `Compensation coverage audit` FAIL | Missing migration, `employee_compensations` query error | Check Railway logs for the exact error message; verify `employee_compensations` table exists in production DB |
| `Payroll readiness score` FAIL | Same root cause as coverage audit (it calls the same function) | See above |
| `Muster roll` FAIL | `attendance_daily` query error or invalid month format | Verify `attendance_daily` table; check query log |
| `Leave team balances` FAIL | `leave_balances` table or view missing | Verify migration ran; check leave schema |
| `ESS home` FAIL | Any sub-query crash causes 500 (all sections are try/catch) | Check Railway logs for which ESS sub-section threw; likely a missing table or column |
| `HTTP 401` on all probes | Smoke user credentials stale or smoke user deactivated | Reset smoke user password in Supabase Auth console |
| `HTTP 403` on HR admin probes | Smoke user role changed from `hr_admin` | Verify smoke user's `profiles.role` in the DB |

---

## Rollback procedure

1. In Railway → **Deployments**, click the previous healthy deployment.
2. Click **Redeploy** (Railway re-activates that build without a new push).
3. Wait for **Active** status, then re-run step B (smoke suite) to confirm rollback is healthy.
4. Post to War Room: `⏪ Rolled back to <previous-commit-sha>`.
5. Open a P0 incident ticket; do not re-deploy until root cause is confirmed.

---

## Smoke test user setup

The smoke test authenticates as a dedicated `hr_admin` service account that
is **not a real employee**. To create one:

1. In Supabase Auth → **Users** → **Invite user** → enter `smoke@<yourdomain.com>`.
2. Set the user's password (reset link → choose a strong random password).
3. In the `profiles` table, set `role = 'hr_admin'` and `is_active = true` for
   this user's row.
4. Store credentials in GitHub Secrets:
   - `SMOKE_EMAIL` = `smoke@<yourdomain.com>`
   - `SMOKE_PASSWORD` = (the password)
   - `SUPABASE_ANON_KEY` = project anon key
5. Store non-secret config in GitHub Variables (per environment):
   - `SMOKE_BASE_URL` = `https://hrmsapi-production.up.railway.app`
   - `SUPABASE_URL` = `https://<project>.supabase.co`

The smoke user must never be assigned an `employee_id` — it is purely an auth
identity for health checks.

---

## Frequency

| Trigger | Action |
|---------|--------|
| Every production deploy | Steps A–E above (mandatory) |
| Every staging deploy | Steps A–C (D optional) |
| Daily scheduled (optional) | Trigger smoke workflow on a cron if uptime monitoring is not in place |
| Before a UAT gate review | Full steps A–E; include smoke output in the gate evidence |
