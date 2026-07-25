-- Fix for migration 394 failure: "operator does not exist: text = uuid".
--
-- payroll_finalize_overrides.tenant_id was declared TEXT in migration 118.
-- Migration 195 ("Fixes the tenant_id TEXT anti-pattern in durable queue
-- tables") was supposed to convert it to UUID for exactly this table, but
-- on this database the column is still TEXT — either migration 195 was
-- never applied, or this table's block within it didn't take. Migration
-- 394's tenant-scoped policy for this table does
-- `tenant_id = get_user_tenant_id()`, and get_user_tenant_id() returns
-- UUID, so Postgres has no `text = uuid` operator and the whole statement
-- (and, if run as one pasted script, the whole migration 394 transaction)
-- fails and rolls back.
--
-- This repeats migration 195's payroll_finalize_overrides conversion block
-- only (idempotent — guarded by a check that the column is still TEXT, so
-- safe to run whether or not migration 195 partially applied elsewhere).
-- It does NOT touch RLS policies — migration 394 will (re-)create the
-- correct tenant-scoped policy once this runs.
--
-- After this succeeds, RE-RUN THE ENTIRE migration 394 file from the top.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'payroll_finalize_overrides') THEN

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'payroll_finalize_overrides'
        AND column_name  = 'tenant_id'
        AND data_type    = 'text'
    ) THEN
      ALTER TABLE payroll_finalize_overrides ADD COLUMN tenant_id_new UUID;
      UPDATE payroll_finalize_overrides
        SET tenant_id_new = tenant_id::UUID
        WHERE tenant_id IS NOT NULL
          AND tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      DROP INDEX IF EXISTS idx_payroll_finalize_overrides_run;
      DROP INDEX IF EXISTS idx_payroll_finalize_overrides_month;
      ALTER TABLE payroll_finalize_overrides DROP COLUMN tenant_id;
      ALTER TABLE payroll_finalize_overrides RENAME COLUMN tenant_id_new TO tenant_id;
      ALTER TABLE payroll_finalize_overrides ALTER COLUMN tenant_id SET NOT NULL;
      CREATE INDEX idx_payroll_finalize_overrides_run
        ON payroll_finalize_overrides (tenant_id, run_id);
      CREATE INDEX idx_payroll_finalize_overrides_month
        ON payroll_finalize_overrides (tenant_id, month, overridden_at DESC);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name        = 'payroll_finalize_overrides'
        AND constraint_name   = 'payroll_finalize_overrides_tenant_id_fkey'
    ) THEN
      ALTER TABLE payroll_finalize_overrides
        ADD CONSTRAINT payroll_finalize_overrides_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
    END IF;

  END IF;
END $$;
