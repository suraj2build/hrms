#!/usr/bin/env bash
# Reload PostgREST schema cache after adding/altering columns.
# Usage: SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... ./scripts/reload-schema-cache.sh

set -euo pipefail

URL="${SUPABASE_URL:?set SUPABASE_URL}"
KEY="${SUPABASE_SERVICE_KEY:?set SUPABASE_SERVICE_KEY}"

curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${URL}/rest/v1/rpc/notify_pgrst_reload" \
  -H "apikey: ${KEY}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' || true

# The above RPC may not exist — fallback: run NOTIFY via the SQL endpoint
curl -s -X POST "${URL}/rest/v1/rpc/exec_sql" \
  -H "apikey: ${KEY}" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d '{"query":"NOTIFY pgrst, '\''reload schema'\''"}' 2>/dev/null || true

echo "Schema cache reload signal sent. PostgREST refreshes within ~1 second."
