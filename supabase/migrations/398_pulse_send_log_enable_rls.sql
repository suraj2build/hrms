-- Fresh audit finding (auth/RBAC/security pass): pulse_send_log has
-- tenant_id UUID NOT NULL but migration 359 never enabled RLS on it, and no
-- later migration does either. Supabase's default grants allow the
-- authenticated/anon DB roles to touch public schema tables unless RLS
-- blocks them — so this table was exposed to direct cross-tenant read/write
-- via any authenticated Supabase client (e.g. the frontend's own
-- apps/web/src/lib/supabase/client.ts), the same class of bug as ISSUE-149.
--
-- pulse_send_log is INSTRUMENTATION ONLY — a per-(pulse_question_id,
-- employee_id) dedup marker written exclusively by the weekly mood-poll
-- send job via the service-role key (which bypasses RLS entirely) and never
-- read by any API route or frontend page. It needs no policies at all —
-- mirrors leave_ledger_drift_log's (migration 270) "RLS on, no policies →
-- denied to anon/authenticated, service-role writes unaffected" pattern.

ALTER TABLE pulse_send_log ENABLE ROW LEVEL SECURITY;
