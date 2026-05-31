-- ============================================================
-- 018_idempotency_and_indexes.sql
--
-- Three independent improvements bundled in one migration:
--
--   A. idempotency_keys table
--      Stores the response of POST /employees/full-create keyed by the
--      caller-supplied Idempotency-Key header.  Prevents duplicate
--      employee records on retry / double-click.
--
--   B. employees(tenant_id, email) index
--      Speeds up existence checks and the uniqueness guard on email.
--
--   C. job_history(tenant_id, employee_id, is_current) index
--      Speeds up the single-row "current job" lookup that every
--      employee profile page triggers.
-- ============================================================

-- ── A. Idempotency keys ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS idempotency_keys (
  -- Caller-supplied opaque key (UUID recommended, but any string ≤ 255 chars)
  key         TEXT        NOT NULL,
  -- Scoped to tenant so keys cannot cross organisational boundaries
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- HTTP status code of the original response (201 on success)
  status_code SMALLINT    NOT NULL,
  -- Full JSON response body — replayed verbatim on duplicate requests
  response    JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, key)
);

-- Index to support efficient TTL-based cleanup (e.g. DELETE WHERE created_at < now() - interval '24h')
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at
  ON idempotency_keys (created_at);

-- ── B. employees email index ───────────────────────────────────────────────────
-- Tenant-scoped because all queries filter by tenant_id first.
-- Also accelerates the unique-email check inside create_employee_with_job().
CREATE INDEX IF NOT EXISTS idx_employees_email
  ON employees (tenant_id, email);

-- ── C. job_history current-job index ──────────────────────────────────────────
-- The most frequent job_history query pattern is:
--   WHERE tenant_id = $1 AND employee_id = $2 AND is_current = true
-- A partial index (WHERE is_current = true) keeps it lean — inactive rows
-- are never scanned for this query.
CREATE INDEX IF NOT EXISTS idx_jh_emp_current
  ON job_history (tenant_id, employee_id)
  WHERE is_current = true;
