-- =============================================================================
-- Migration 009 — Employee audit trigger (replaces stub in 006)
--
-- Improvements over the 006 stub:
--   1. Strips statutory PII columns before writing to audit_logs
--   2. UPDATE stores only changed columns in new_data (diff), not full row
--   3. AFTER trigger correctly returns NULL
--   4. Drops old trigger/function cleanly before recreating
-- =============================================================================

-- Drop old versions so this migration is idempotent on re-run
DROP TRIGGER  IF EXISTS employees_audit         ON employees;
DROP FUNCTION IF EXISTS log_employee_changes();

-- ---------------------------------------------------------------------------
-- Helper: strip PII columns from a JSONB row snapshot
--
-- Columns removed:
--   pan_number      — Income Tax identifier
--   aadhaar_last4   — partial UID (still sensitive)
--   uan_number      — Provident Fund account
--   esi_number      — ESI registration
--   bank_details    — JSONB with IFSC / masked account
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION strip_employee_pii(data JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT data
    - 'pan_number'
    - 'aadhaar_last4'
    - 'uan_number'
    - 'esi_number'
    - 'bank_details'
$$;

-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_employee_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER          -- write audit_logs regardless of caller's RLS context
SET search_path = public  -- pin search_path; prevents search_path injection
AS $$
DECLARE
  v_old   JSONB;
  v_new   JSONB;
  v_diff  JSONB;
BEGIN

  CASE TG_OP

    -- ── INSERT ──────────────────────────────────────────────────────────────
    WHEN 'INSERT' THEN
      INSERT INTO audit_logs (
        tenant_id, table_name, record_id,
        action,
        old_data, new_data
      ) VALUES (
        NEW.tenant_id, 'employees', NEW.id,
        'INSERT',
        NULL,
        strip_employee_pii(to_jsonb(NEW))
      );

    -- ── UPDATE ──────────────────────────────────────────────────────────────
    -- new_data stores ONLY the columns whose value changed (the diff).
    -- old_data stores the full pre-update snapshot (PII stripped).
    -- This keeps log rows small and makes "what changed" immediately obvious.
    WHEN 'UPDATE' THEN
      v_old  := strip_employee_pii(to_jsonb(OLD));
      v_new  := strip_employee_pii(to_jsonb(NEW));

      -- Build diff: keys in NEW whose value differs from OLD
      SELECT jsonb_object_agg(n.key, n.value)
        INTO v_diff
        FROM jsonb_each(v_new) AS n(key, value)
       WHERE v_new -> n.key IS DISTINCT FROM v_old -> n.key;

      -- Skip audit row if nothing meaningful changed
      -- (e.g. a no-op UPDATE that only touched updated_at)
      IF v_diff IS NOT NULL
         AND (v_diff - 'updated_at') <> '{}'::jsonb
      THEN
        INSERT INTO audit_logs (
          tenant_id, table_name, record_id,
          action,
          old_data, new_data
        ) VALUES (
          NEW.tenant_id, 'employees', NEW.id,
          'UPDATE',
          v_old,
          v_diff
        );
      END IF;

    -- ── DELETE ──────────────────────────────────────────────────────────────
    -- Soft-deletes (status = 'separated') come through as UPDATE, not DELETE.
    -- A real DELETE should never happen in normal operation; log it with full
    -- old snapshot so it can be investigated.
    WHEN 'DELETE' THEN
      INSERT INTO audit_logs (
        tenant_id, table_name, record_id,
        action,
        old_data, new_data
      ) VALUES (
        OLD.tenant_id, 'employees', OLD.id,
        'DELETE',
        strip_employee_pii(to_jsonb(OLD)),
        NULL
      );

  END CASE;

  -- AFTER trigger: return value is ignored by Postgres; NULL is correct.
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attach trigger to employees table
-- ---------------------------------------------------------------------------
CREATE TRIGGER employees_audit
  AFTER INSERT OR UPDATE OR DELETE
  ON employees
  FOR EACH ROW
  EXECUTE FUNCTION log_employee_changes();
