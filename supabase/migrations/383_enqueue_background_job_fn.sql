-- ============================================================
-- 383_enqueue_background_job_fn.sql
--
-- Bug fix: migration 377 replaced background_jobs' full-table UNIQUE
-- constraint on idempotency_key with a PARTIAL unique index
-- (idx_bg_jobs_idempotency_key_active — active jobs only, so completed/
-- failed/dead jobs don't block re-enqueueing the same key).
--
-- But durable-queue.ts's enqueue() still issues a plain
--   .upsert(row, { onConflict: 'idempotency_key', ignoreDuplicates: true })
-- which builds `ON CONFLICT (idempotency_key) DO NOTHING`. Postgres requires
-- an ON CONFLICT target to exactly match the arbiter index it's using,
-- INCLUDING any partial-index WHERE predicate — a bare column-list target
-- cannot resolve against a partial unique index. Every enqueue() call that
-- passes an idempotencyKey has therefore been throwing
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" since migration 377 was applied — silently, for every
-- fire-and-forget scheduler job (leave accrual, attendance processing,
-- SLA scans, intelligence scans, mood polls, absconding detection, digests,
-- WO-credit reconciliation), and loudly for payroll runs (the only caller
-- that surfaces the enqueue error to an HTTP response instead of swallowing
-- it into a .catch() log line).
--
-- Fix: perform the insert inside a SECURITY DEFINER function using an
-- ON CONFLICT clause whose WHERE predicate matches the partial index
-- exactly, so Postgres can resolve the arbiter. Call this via supabase.rpc()
-- instead of the PostgREST .upsert() shorthand, which cannot express a
-- partial-index conflict target.
-- ============================================================

CREATE OR REPLACE FUNCTION enqueue_background_job(
  p_id              uuid,
  p_job_type        text,
  p_payload         jsonb,
  p_max_retries     int,
  p_retry_delay_ms  int,
  p_max_delay_ms    int,
  p_timeout_ms      int,
  p_scheduled_at    timestamptz,
  p_idempotency_key text,
  p_tenant_id       text,
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

  -- Conflict fired (v_id is null) and a key was supplied: return the existing
  -- active job's id so the caller gets a real persisted row, not the
  -- discarded pre-insert UUID.
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
  uuid, text, jsonb, int, int, int, int, timestamptz, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_background_job(
  uuid, text, jsonb, int, int, int, int, timestamptz, text, text, text
) TO service_role;
