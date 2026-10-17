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
environment is actually running the commit being qualified, in two steps:

**`scripts/verify-staging-candidate.sh`** (static/metadata + DB checks):
1. the web app's `/version.json` reports the exact candidate commit SHA
   (the PR's head SHA on a pull_request run — **not** `github.sha`, which
   on pull_request events is GitHub's ephemeral merge-ref commit and will
   never match a real deployment);
2. the API's `/health` reports the same SHA;
3. **(static)** the web build was compiled to call that same API (its
   build-time `VITE_API_URL`, recorded in `version.json`) — this proves
   what the build script *wrote*, not what the running client *does*; see
   the dynamic check below for the behavioral confirmation;
4. the staging database's `supabase_migrations.schema_migrations` has an
   entry for **every** migration file in `supabase/migrations/`, not just
   the latest — a staging DB can have the newest migration applied while
   missing an earlier one this candidate's code still depends on;
5. none of those entries' recorded content (the actual applied SQL,
   confirmed to be what `schema_migrations.statements` holds) has drifted
   from the current file — a migration edited after being applied would
   still show as "present" in check 4 while the staging schema reflects
   the old content. A row with no recorded content at all (NULL/empty
   `statements`) is treated as unverifiable and fails this check — it is
   never silently counted as unchanged;
6. **column coverage, not a full schema comparison**: the staging
   database's actual columns — introspected directly, not reconstructed —
   include every column `apps/api/src` references. This is the same
   column-existence audit `scripts/db/check-schema-drift.mjs` already runs
   in CI against a scratch DB, run here with `--skip-apply` against the
   real staging connection instead. **This checks column references only.**
   It does not verify constraints (CHECK/UNIQUE/FK), indexes, RLS
   policies, triggers, or function/procedure bodies — a staging DB can
   pass this check while missing a constraint, an index, or an RLS policy
   the application depends on for correctness or tenant isolation.

**`apps/e2e/verify-web-api-wiring.mjs`** (dynamic — needs a real browser,
so it runs as its own step after Playwright's Chromium is installed):
loads the actual deployed web page and watches the real network
*responses* it receives (not just requests it sends) during unauthenticated
initial load, and passes only if the checked API origin itself answers at
least one of them directly — a redirect response FROM that origin to
somewhere else fails this check and is reported by name, not treated as a
pass. Checks 1–3 above only prove the build was *compiled* correctly; they
cannot catch a platform-level rewrite/redirect, a runtime config override
fetched after page load, a stale cached bundle serving an old build, or a
CORS misconfiguration that silently breaks the real client — this does,
because it observes actual behavior instead of trusting build-time
metadata. **Precisely scoped:** this is an unauthenticated, load-time
signal. It does not log in, does not exercise an authenticated application
request, and does not inspect response bodies for business correctness —
that is what the full Playwright suite below does, using real HR
credentials, in the very next step. A pass here means "the wiring is
plausible enough to be worth the 30 minutes," not "the application works."

Any mismatch fails the job immediately, before spending 30 minutes running
Playwright against what might be a stale or mismatched deployment.

Add these as GitHub repository secrets:

**Required:**
- `E2E_HR_EMAIL`
- `E2E_HR_PASS`
- `E2E_BASE_URL` — the staging web app's URL for this candidate (no default)
- `E2E_API_URL` — the staging API's URL for this candidate (no default; used
  only by the candidate-verification step, not by Playwright itself)
- `STAGING_PGHOST`, `STAGING_PGPORT`, `STAGING_PGUSER`, `STAGING_PGPASSWORD`,
  `STAGING_PGDATABASE` — connection details for the staging Postgres.
  **Not optional** — DB migration-state verification is a hard requirement
  for release qualification, not a nice-to-have; a missing credential here
  fails the job the same as a missing URL does.

**A missing-secret failure in this job's log proves exactly one thing: the
secret was not visible to THIS job, in this run.** It does not prove the
secret is absent from every scope in the repo or organization, and it
says nothing about whether a staging environment exists at all — only
that whatever is or isn't configured, this specific job couldn't see it.
GitHub Actions secrets can be scoped to a specific
[Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
(Settings → Environments), and a job only sees an environment's secrets
if it declares `environment: <name>`. This workflow's job currently
declares no `environment:` key, so if any of the secrets above were
configured under an Environment rather than as a plain repository secret,
this job would report them as missing regardless of whether they exist.
Checking which is the case requires repo-admin access to Settings →
Environments (or the `GET /repos/{owner}/{repo}/environments` /
`GET /repos/{owner}/{repo}/actions/secrets` API, which lists secret names
only, never values) — neither is reachable from an automated session here.
**If an administrator confirms a relevant Environment exists, add
`environment: <that name>` to the `e2e` job in `.github/workflows/e2e.yml`**
so this workflow can see its secrets; otherwise this job is already
checking the right (repository-level) scope.

After each run, download the `playwright-report` artifact for a full HTML report with screenshots.

## What the report shows

- ✅ Pass / ❌ Fail for every test
- Screenshots captured at every step
- Console logs with extracted numbers (payable days, totals)
- Cross-check: muster roll payable days vs payroll
- Flagged issues: raw status strings in cells, missing branding, JS errors
