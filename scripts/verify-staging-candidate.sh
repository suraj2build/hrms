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
#   2. API: GET {API_URL}/health — commitSha must equal EXPECTED_SHA.
#   3. DB migrations: the staging database's supabase_migrations.schema_migrations
#      must include an entry for the LATEST migration file in
#      supabase/migrations/ at this candidate commit — i.e. staging has been
#      migrated at least up to what this candidate's code expects.
#
# Usage:
#   WEB_URL=https://<preview>.vercel.app \
#   API_URL=https://<api-host> \
#   EXPECTED_SHA="$GITHUB_SHA" \
#   PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... PGDATABASE=... \
#   ./scripts/verify-staging-candidate.sh
#
# Required: WEB_URL, API_URL, EXPECTED_SHA. DB check runs only if PGHOST is
# set (so this script is still useful for a web+API-only check during setup).
#
# Exit codes: 0 = candidate verified, 1 = verification failed (details on stderr).

set -uo pipefail

FAIL_COUNT=0

fail() { echo "✗ $1" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }
pass() { echo "✓ $1"; }

: "${WEB_URL:?WEB_URL must be set — the staging web deployment URL for this candidate. Refusing to silently fall back to any default.}"
: "${API_URL:?API_URL must be set — the staging API deployment URL for this candidate. Refusing to silently fall back to any default.}"
: "${EXPECTED_SHA:?EXPECTED_SHA must be set — normally \$GITHUB_SHA (the exact commit this CI run is qualifying). Refusing to verify against an unstated candidate.}"

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
if [ -n "$WEB_VERSION_JSON" ]; then
  WEB_SHA=$(echo "$WEB_VERSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('commitSha',''))" 2>/dev/null)
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
echo "--- 3. Database migration state ---"
if [ -z "${PGHOST:-}" ]; then
  echo "  (skipped — PGHOST not set; this run is not checking DB migration state)"
else
  LATEST_MIGRATION_FILE=$(ls supabase/migrations/*.sql 2>/dev/null | sort | tail -1)
  if [ -z "$LATEST_MIGRATION_FILE" ]; then
    fail "no migration files found under supabase/migrations/ — run this from the repo root"
  else
    LATEST_MIGRATION_NAME=$(basename "$LATEST_MIGRATION_FILE")
    TABLE_EXISTS=$(psql -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;" 2>&1)
    if [ "$TABLE_EXISTS" != "t" ]; then
      fail "supabase_migrations.schema_migrations does not exist on this database (got: $TABLE_EXISTS) — cannot verify migration state; is PGHOST pointed at the right staging DB?"
    else
      # Supabase CLI records each applied migration by its filename's leading
      # version token; match on that prefix rather than assuming the full
      # filename is stored verbatim.
      VERSION_PREFIX="${LATEST_MIGRATION_NAME%%_*}"
      APPLIED=$(psql -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '${VERSION_PREFIX}%' OR name LIKE '${VERSION_PREFIX}%';" 2>&1)
      if [ "$APPLIED" = "0" ]; then
        fail "staging DB has NOT applied the latest migration this candidate expects ($LATEST_MIGRATION_NAME) — run the pending migration(s) before qualifying this candidate"
      else
        pass "staging DB has applied the latest migration this candidate expects ($LATEST_MIGRATION_NAME)"
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
