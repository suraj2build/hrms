-- Fresh audit finding (systematic RLS coverage sweep across all migrations):
-- four tenant_id-bearing tables were created without ever enabling RLS, the
-- same bug class as ISSUE-149 and pulse_send_log (migration 398). Supabase's
-- default grants let the anon/authenticated PostgREST roles touch public
-- schema tables unless RLS blocks them, regardless of whether the app
-- itself only ever queries them via the service-role key.
--
-- All four are internal/instrumentation tables with no API route or
-- frontend page reading or writing them directly (durable-queue.ts and the
-- observability stack write via the service-role client, which bypasses
-- RLS entirely) — so, mirroring pulse_send_log's fix, they need RLS enabled
-- with no policies at all: denied to anon/authenticated, service-role
-- unaffected.
--
--   trace_spans              — 126_observability.sql (dead/future-use; no app-code references found)
--   business_event_metrics   — 126_observability.sql (dead/future-use; no app-code references found)
--   poison_job_quarantine    — 120_durable_state.sql / 194_harden_create_guards.sql (durable-queue.ts, service-role only)
--   retry_storm_incidents    — 120_durable_state.sql / 194_harden_create_guards.sql (durable-queue.ts, service-role only)

ALTER TABLE trace_spans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_event_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE poison_job_quarantine  ENABLE ROW LEVEL SECURITY;
ALTER TABLE retry_storm_incidents  ENABLE ROW LEVEL SECURITY;
