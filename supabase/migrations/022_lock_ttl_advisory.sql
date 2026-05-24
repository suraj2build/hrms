-- ─────────────────────────────────────────────────────────────────────────────
-- 022_lock_ttl_advisory.sql
--
-- Step 1: lock_ttl_seconds on attendance_processing_lock
--         Allows TTL-based takeover of stale locks (crashed jobs).
--
-- Step 2: Advisory-lock RPC helpers
--         pg_try_advisory_lock / pg_advisory_unlock via SECURITY DEFINER RPCs.
--
-- Step 3: duration_ms on attendance_processing_runs
--         Fast-dashboard index on (tenant_id, started_at DESC).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: TTL column ────────────────────────────────────────────────────────
ALTER TABLE attendance_processing_lock
  ADD COLUMN IF NOT EXISTS lock_ttl_seconds INT NOT NULL DEFAULT 900;

COMMENT ON COLUMN attendance_processing_lock.lock_ttl_seconds IS
  'Seconds before a running lock is considered stale and may be taken over';

-- ── Step 2: Advisory lock RPC helpers ─────────────────────────────────────────
--
-- Uses hashtext() to derive a stable bigint key from the UUID tenant_id.
-- Session-level locks persist for the life of the DB connection; they
-- complement the table lock (which is the primary guard) and provide
-- cross-process safety when running without transaction-mode pooling.

CREATE OR REPLACE FUNCTION acquire_attendance_advisory_lock(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pg_try_advisory_lock(hashtext(p_tenant_id::text)::bigint);
END;
$$;

CREATE OR REPLACE FUNCTION release_attendance_advisory_lock(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(p_tenant_id::text)::bigint);
END;
$$;

-- Only hr_admin / super_admin may call these
REVOKE ALL ON FUNCTION acquire_attendance_advisory_lock(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_attendance_advisory_lock(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION acquire_attendance_advisory_lock(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION release_attendance_advisory_lock(UUID) TO authenticated;

-- ── Step 3: duration_ms + better index ───────────────────────────────────────
ALTER TABLE attendance_processing_runs
  ADD COLUMN IF NOT EXISTS duration_ms INT;

COMMENT ON COLUMN attendance_processing_runs.duration_ms IS
  'Wall-clock milliseconds from function entry to audit row insert';

-- Drop the date-based index from 021 and replace with started_at DESC
-- so ORDER BY started_at DESC queries use the index directly.
DROP INDEX IF EXISTS idx_processing_runs_tenant_date;

CREATE INDEX IF NOT EXISTS idx_runs_tenant_date
  ON attendance_processing_runs (tenant_id, started_at DESC);
