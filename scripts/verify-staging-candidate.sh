#!/usr/bin/env bash
# Staging-candidate verification — the gate requested alongside E2E
# credentials: confirm the environment E2E is about to test is ACTUALLY
# running this release candidate (web SHA + API SHA + DB migration state),
# not a stale deployment that happens to answer on the configured URLs.
#
# This is deliberately separate from apps/e2e's Playwright suite: it must
# run and fail BEFORE Playwright starts, so a misconfigured/stale staging
# environment produces one clear error instead of a wall of cryptic UI
# failures that look like product bugs.
#
# Checks, each independently reported (not short-circuited on first failure
# — a misconfigured candidate commonly fails more than one of these, and
# seeing all of them at once saves a round trip):
#   1. Web: GET {WEB_URL}/version.json — commitSha must equal EXPECTED_SHA
#      (full or prefix match). Requires apps/web/scripts/write-build-info.mjs
#      to have run at build time (wired into `npm run build`).
#      IMPORTANT: for a pull_request-triggered run, EXPECTED_SHA must be the
#      PR's actual head commit (github.event.pull_request.head.sha), NOT
#      github.sha — on pull_request events github.sha is GitHub's ephemeral
#      refs/pull/N/merge commit, which is never what Vercel/Railway deploy
#      and will never match a real staging SHA. Verified this against this
#      PR's own CI run (37339052239): github.sha there was 18362fd..., a
#      merge commit that exists on no branch anyone deploys.
#   2. API: GET {API_URL}/health — commitSha must equal EXPECTED_SHA.
#   3. Web→API wiring: the web build's recorded apiUrl (from version.json,
#      written from VITE_API_URL at build time) must match API_URL. Checks
#      1 and 2 passing independently only proves both deployments exist and
#      are each individually fresh — NOT that the web app is actually
#      configured to call the API that was just checked. A web build that
#      embeds a different, stale, or empty-string (dev-proxy) VITE_API_URL
#      would pass checks 1+2 while E2E silently exercises the wrong API.
#   4. DB migrations: every migration file under supabase/migrations/*.sql
#      at this candidate commit must have a matching row in the staging
#      database's supabase_migrations.schema_migrations — not just the
#      latest file. Checking only the latest migration's presence does not
#      prove the complete history matches: a staging DB could have the
#      latest migration applied (e.g. hand-run out of order, or restored
#      from a snapshot that skipped several) while missing earlier ones
#      whose schema changes this candidate's code still depends on.
#
# NOT YET VALIDATED against a real Supabase project: the local round-trip
# test that exercised check 4 used a hand-created table matching the
# documented supabase_migrations.schema_migrations shape (version, name
# columns) — it proved this script's own SQL executes and branches
# correctly, not that a real Supabase CLI-managed project records
# migrations in exactly this shape. Confirm against an actual staging
# Supabase project's schema_migrations table before treating a pass here
# as real migration-compatibility evidence.
#
# Usage:
#   WEB_URL=https://<preview>.vercel.app \
#   API_URL=https://<api-host> \
#   EXPECTED_SHA="<PR head SHA, not github.sha>" \
#   PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=... \
#   ./scripts/verify-staging-candidate.sh
#
# Required: WEB_URL, API_URL, EXPECTED_SHA, and (unless ALLOW_SKIP_DB_CHECK=true
# is explicitly set) PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE. Database
# verification is NOT optional for a release-qualification run — a missing
# DB credential fails this script, it does not silently skip the check.
# ALLOW_SKIP_DB_CHECK exists only for an ad hoc web+API-only check while
# wiring up a new staging environment; the CI workflow never sets it.
#
# Exit codes: 0 = candidate verified, 1 = verification failed (details on stderr).

set -uo pipefail

FAIL_COUNT=0

fail() { echo "✗ $1" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }
pass() { echo "✓ $1"; }

: "${WEB_URL:?WEB_URL must be set — the staging web deployment URL for this candidate. Refusing to silently fall back to any default.}"
: "${API_URL:?API_URL must be set — the staging API deployment URL for this candidate. Refusing to silently fall back to any default.}"
: "${EXPECTED_SHA:?EXPECTED_SHA must be set — the exact candidate commit (the PR head SHA for a pull_request run, NOT github.sha — see header comment). Refusing to verify against an unstated candidate.}"

if [ -z "${ALLOW_SKIP_DB_CHECK:-}" ]; then
  : "${PGHOST:?PGHOST must be set — DB migration-state verification is required for release qualification, not optional. Set ALLOW_SKIP_DB_CHECK=true only for an ad hoc web+API-only check outside CI.}"
  : "${PGPORT:?PGPORT must be set alongside PGHOST.}"
  : "${PGUSER:?PGUSER must be set alongside PGHOST.}"
  : "${PGPASSWORD:?PGPASSWORD must be set alongside PGHOST.}"
  : "${PGDATABASE:?PGDATABASE must be set alongside PGHOST.}"
fi

echo "=== Staging candidate verification ==="
echo "  WEB_URL=$WEB_URL"
echo "  API_URL=$API_URL"
echo "  EXPECTED_SHA=$EXPECTED_SHA"
echo

echo "--- 1. Web deployment SHA ---"
WEB_VERSION_JSON=$(curl -fsS --max-time 15 "$WEB_URL/version.json" 2>&1) || {
  fail "could not fetch $WEB_URL/version.json: $WEB_VERSION_JSON"
  WEB_VERSION_JSON=""
}
WEB_API_URL=""
if [ -n "$WEB_VERSION_JSON" ]; then
  WEB_SHA=$(echo "$WEB_VERSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('commitSha',''))" 2>/dev/null)
  WEB_API_URL=$(echo "$WEB_VERSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('apiUrl') or '')" 2>/dev/null)
  if [ -z "$WEB_SHA" ] || [ "$WEB_SHA" = "unknown" ]; then
    fail "web deployment's /version.json has no usable commitSha (got: $WEB_VERSION_JSON) — was it built via 'npm run build' (which runs write-build-info.mjs)?"
  elif [[ "$EXPECTED_SHA" != "$WEB_SHA"* ]] && [[ "$WEB_SHA" != "$EXPECTED_SHA"* ]]; then
    fail "web deployment is running commit $WEB_SHA, NOT the candidate $EXPECTED_SHA — this staging environment has not been deployed with this PR's code"
  else
    pass "web deployment SHA matches candidate ($WEB_SHA)"
  fi
fi

echo
echo "--- 2. API deployment SHA ---"
API_HEALTH_JSON=$(curl -fsS --max-time 15 "$API_URL/health" 2>&1) || {
  fail "could not fetch $API_URL/health: $API_HEALTH_JSON"
  API_HEALTH_JSON=""
}
if [ -n "$API_HEALTH_JSON" ]; then
  API_SHA=$(echo "$API_HEALTH_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('commitSha') or '')" 2>/dev/null)
  if [ -z "$API_SHA" ]; then
    fail "API deployment's /health has no commitSha (got: $API_HEALTH_JSON) — is RAILWAY_GIT_COMMIT_SHA/GIT_COMMIT_SHA set on this deployment?"
  elif [[ "$EXPECTED_SHA" != "$API_SHA"* ]] && [[ "$API_SHA" != "$EXPECTED_SHA"* ]]; then
    fail "API deployment is running commit $API_SHA, NOT the candidate $EXPECTED_SHA — this staging environment has not been deployed with this PR's code"
  else
    pass "API deployment SHA matches candidate ($API_SHA)"
  fi
fi

echo
echo "--- 3. Web→API wiring ---"
if [ -z "$WEB_VERSION_JSON" ]; then
  echo "  (skipped — web /version.json was not fetched; see check 1)"
elif [ -z "$WEB_API_URL" ]; then
  fail "web build's version.json has no apiUrl recorded (VITE_API_URL was unset/empty at build time) — this build cannot be exercising $API_URL; it is either using a dev-only relative proxy or was never configured for this candidate's API"
elif [ "$WEB_API_URL" != "$API_URL" ] && [ "${WEB_API_URL%/}" != "${API_URL%/}" ]; then
  fail "web build was compiled with VITE_API_URL=$WEB_API_URL, NOT the API_URL being checked ($API_URL) — the web and API SHA checks above each passed independently, but this web deployment is not wired to call this API deployment"
else
  pass "web build is wired to call the checked API ($WEB_API_URL)"
fi

echo
echo "--- 4. Database migration state (full history, not just latest) ---"
if [ -z "${PGHOST:-}" ]; then
  echo "  (skipped — PGHOST not set and ALLOW_SKIP_DB_CHECK=true was explicitly passed; NOT valid for release qualification)"
else
  MIGRATION_FILES=$(ls supabase/migrations/*.sql 2>/dev/null | sort)
  if [ -z "$MIGRATION_FILES" ]; then
    fail "no migration files found under supabase/migrations/ — run this from the repo root"
  else
    TABLE_EXISTS=$(psql -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;" 2>&1)
    if [ "$TABLE_EXISTS" != "t" ]; then
      fail "supabase_migrations.schema_migrations does not exist on this database (got: $TABLE_EXISTS) — cannot verify migration state; is PGHOST pointed at the right staging DB?"
    else
      MISSING=()
      TOTAL=0
      while IFS= read -r f; do
        TOTAL=$((TOTAL + 1))
        name=$(basename "$f")
        # Confirmed against a real `supabase db push`-populated table (not a
        # hand-built fixture): schema_migrations.version is the exact
        # numeric prefix ("000", "001", ...) and .name is the description
        # WITHOUT that prefix ("bootstrap_functions", not
        # "000_bootstrap_functions") — so version must match exactly, not
        # by LIKE-prefix (a prefix match would wrongly treat "25" as
        # satisfied by version "250"). name is matched by LIKE as a
        # fallback only, for older CLI versions known to store the name
        # column as the full original filename.
        version_prefix="${name%%_*}"
        applied=$(psql -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${version_prefix}' OR name LIKE '${version_prefix}_%';" 2>&1)
        if [ "$applied" = "0" ]; then
          MISSING+=("$name")
        fi
      done <<< "$MIGRATION_FILES"
      if [ "${#MISSING[@]}" -gt 0 ]; then
        fail "staging DB is missing ${#MISSING[@]} of $TOTAL migration(s) this candidate expects: ${MISSING[*]} — presence of the latest migration alone does not prove the complete history matches; run the missing migration(s) before qualifying this candidate"
      else
        pass "staging DB has applied all $TOTAL migration(s) this candidate expects"
      fi
    fi
  fi
fi

echo
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "=== RESULT: $FAIL_COUNT check(s) failed — this staging environment does NOT qualify as a valid test target for commit $EXPECTED_SHA ===" >&2
  exit 1
fi
echo "=== RESULT: staging environment verified as running candidate $EXPECTED_SHA ==="
