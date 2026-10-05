# CognixHR — E2E Test Suite

Playwright-based full-lifecycle tests covering:

| # | Suite | What it checks |
|---|-------|----------------|
| 01 | Login & Health | Login form, redirect, branding, nav modules |
| 02 | Employee Onboarding | Add employee form, employee list, onboarding hub |
| 03 | Attendance & Muster Roll | Grid loads, muster codes correct, summary numbers consistent |
| 04 | Leave Management | Leave types, policy, approvals inbox, balances |
| 05 | Payroll | Runs, compensation, cross-check payable days vs muster |
| 06 | Exit & Separation | Separation workflow, absconding, payroll payout |

## Running locally

```bash
# 1. Install dependencies (one time)
cd apps/e2e
npm install

# 2. Install Playwright Chromium (one time)
npx playwright install chromium

# 3. Set credentials (never commit these)
export E2E_HR_EMAIL=your-hr-admin@email.com
export E2E_HR_PASS=your-password

# 4. Run all tests
npx playwright test

# 5. Run a single suite
npx playwright test tests/03-attendance-muster.spec.ts

# 6. Run headed (watch the browser)
npx playwright test --headed

# 7. Open HTML report after a run
npx playwright show-report
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_BASE_URL` | _(must be set)_ | Staging web app URL to test against |
| `E2E_HR_EMAIL` | `uatsuraj@gmail.com` | HR admin email |
| `E2E_HR_PASS` | _(must be set)_ | HR admin password |

`E2E_BASE_URL` has **no default/fallback** — a release-qualification run
must know exactly what it's testing, so a missing URL fails the job
immediately with a clear error rather than silently testing a hardcoded
staging URL that may not reflect the candidate commit.

## GitHub Actions

The workflow `.github/workflows/e2e.yml` runs on every pull request (gating
G09's financial-figure cross-checks), every Monday at 03:00 UTC, and on
manual dispatch from the Actions tab.

Before Playwright runs, the workflow verifies the target staging
environment is actually running the commit being qualified —
`scripts/verify-staging-candidate.sh` checks the web app's `/version.json`
and the API's `/health` both report the exact commit SHA this CI run is
testing (`$GITHUB_SHA`), and — when the optional `STAGING_PG*` secrets
below are set — that the staging database has applied the latest
migration this commit expects. Any mismatch fails the job immediately,
before spending 30 minutes running Playwright against what might be a
stale deployment.

Add these as GitHub repository secrets:

**Required:**
- `E2E_HR_EMAIL`
- `E2E_HR_PASS`
- `E2E_BASE_URL` — the staging web app's URL for this candidate (no default)
- `E2E_API_URL` — the staging API's URL for this candidate (no default; used
  only by the candidate-verification step, not by Playwright itself)

**Optional** (enables the DB migration-state check; the web/API SHA checks
run regardless):
- `STAGING_PGHOST`, `STAGING_PGPORT`, `STAGING_PGUSER`, `STAGING_PGPASSWORD`,
  `STAGING_PGDATABASE` — connection details for the staging Postgres

After each run, download the `playwright-report` artifact for a full HTML report with screenshots.

## What the report shows

- ✅ Pass / ❌ Fail for every test
- Screenshots captured at every step
- Console logs with extracted numbers (payable days, totals)
- Cross-check: muster roll payable days vs payroll
- Flagged issues: raw status strings in cells, missing branding, JS errors
