-- ============================================================
-- 000_bootstrap_functions.sql
--
-- Bootstrap utility functions that MUST exist before migration
-- 012 runs. Without this, fresh deployments fail because
-- migration 012 creates triggers that call
-- update_updated_at_column() — a function not defined until
-- migration 074_payroll_engine.sql.
--
-- Symptom on fresh deploy:
--   ERROR:  function update_updated_at_column() does not exist
--   CONTEXT: migration 012_employee_extended.sql
--
-- Fix: pre-define the function at position 000 so every
-- subsequent migration can reference it safely.
-- CREATE OR REPLACE is idempotent — migration 074 will
-- simply overwrite with the same definition.
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
