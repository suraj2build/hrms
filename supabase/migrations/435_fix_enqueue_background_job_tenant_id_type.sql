-- ============================================================
-- 435_fix_enqueue_background_job_tenant_id_type.sql
--
-- Bug: enqueue_background_job() (383_enqueue_background_job_fn.sql)
-- declares p_tenant_id as TEXT, but background_jobs.tenant_id has been
-- UUID since 195_fix_durable_queue_tenanting.sql — 383 was written after
-- 195 but apparently copy-pasted the all-text parameter list from before
-- that migration. Confirmed live: every fire-and-forget scheduler job that
-- omits a tenant scope (leave accrual/co-expiry/event-grants/
-- reconciliation, the poll/attendance-api/webhook-retry schedulers — the
-- global, cross-tenant ticks by design) passes p_tenant_id = NULL, and
-- Postgres refuses the untyped-NULL-as-text value going into a uuid
-- column with:
--   column "tenant_id" is of type uuid but expression is of type text
-- This has been firing on every scheduler tick since 383 was applied —
-- silently swallowed by .catch() log lines everywhere except payroll runs,
-- so it never surfaced as a user-facing failure, just log spam (and any
-- scheduled job that actually needed to run never got queued).
--
-- Fix: drop and recreate with p_tenant_id UUID. CREATE OR REPLACE cannot
-- change a parameter's type — since the OLD text-typed overload isn't
-- dropped first, it would end up creating a SECOND, separate overloaded
-- function instead of truly replacing it, leaving both in place.
-- ============================================================

DROP FUNCTION IF EXISTS enqueue_background_job(
  uuid, text, jsonb, int, int, int, int, timestamptz, text, text, text
);

CREATE FUNCTION enqueue_background_job(
  p_id              uuid,
  p_job_type        text,
  p_payload         jsonb,
  p_max_retries     int,
  p_retry_delay_ms  int,
  p_max_delay_ms    int,
  p_timeout_ms      int,
  p_scheduled_at    timestamptz,
  p_idempotency_key text,
  p_tenant_id       uuid,
  p_created_by      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO background_jobs (
    id, job_type, payload, status, attempt, max_retries, retry_delay_ms,
    max_delay_ms, timeout_ms, scheduled_at, idempotency_key, tenant_id, created_by
  ) VALUES (
    p_id, p_job_type, p_payload, 'pending', 0, p_max_retries, p_retry_delay_ms,
    p_max_delay_ms, p_timeout_ms, p_scheduled_at, p_idempotency_key, p_tenant_id, p_created_by
  )
  ON CONFLICT (idempotency_key) WHERE status IN ('pending', 'running') AND idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id
    FROM background_jobs
    WHERE idempotency_key = p_idempotency_key
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION enqueue_background_job(
  uuid, text, jsonb, int, int, int, int, timestamptz, text, uuid, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_background_job(
  uuid, text, jsonb, int, int, int, int, timestamptz, text, uuid, text
) TO service_role;
