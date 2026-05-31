-- ============================================================
-- 195_fix_durable_queue_tenanting.sql
--
-- Fixes the tenant_id TEXT anti-pattern in durable queue tables.
--
-- ROOT CAUSE (migration 118)
-- --------------------------
-- background_jobs, background_job_results, scheduler_heartbeats,
-- and payroll_finalize_overrides all declared:
--   tenant_id TEXT [NOT NULL]
-- instead of:
--   tenant_id UUID REFERENCES tenants(id)
--
-- Consequences:
--   • No referential integrity — corrupt tenant IDs insert silently.
--   • No RLS enforcement possible (RLS helpers expect UUID comparisons).
--   • Tenant isolation not enforced for any background job.
--
-- STRATEGY
-- --------
-- For each table:
--   1. Detect whether tenant_id is still TEXT (idempotency check).
--   2. Add new UUID column.
--   3. Backfill valid UUIDs; invalid/non-UUID values → NULL.
--   4. Drop TEXT column, rename UUID column.
--   5. Recreate any constraints referencing tenant_id.
--   6. Add FK REFERENCES tenants(id).
--   7. Enable RLS + add tenant-isolation policies.
--
-- SAFE
-- ----
-- Every DO block checks table existence before acting.
-- Re-running after partial failure is safe (no-op on already-
-- converted tables, skips gracefully if table is missing).
-- ============================================================

-- ── 1. background_jobs ────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'background_jobs') THEN

    -- Convert tenant_id from TEXT to UUID if not already done
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'background_jobs'
        AND column_name  = 'tenant_id'
        AND data_type    = 'text'
    ) THEN
      ALTER TABLE background_jobs ADD COLUMN tenant_id_new UUID;
      UPDATE background_jobs
        SET tenant_id_new = tenant_id::UUID
        WHERE tenant_id IS NOT NULL
          AND tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      DROP INDEX IF EXISTS idx_bg_jobs_tenant;
      ALTER TABLE background_jobs DROP COLUMN tenant_id;
      ALTER TABLE background_jobs RENAME COLUMN tenant_id_new TO tenant_id;
      CREATE INDEX idx_bg_jobs_tenant
        ON background_jobs (tenant_id, job_type, status)
        WHERE tenant_id IS NOT NULL;
    END IF;

    -- Add FK (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name        = 'background_jobs'
        AND constraint_name   = 'background_jobs_tenant_id_fkey'
    ) THEN
      ALTER TABLE background_jobs
        ADD CONSTRAINT background_jobs_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
    END IF;

    -- RLS
    ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'background_jobs' AND policyname = 'bg_jobs_tenant_read'
    ) THEN
      CREATE POLICY "bg_jobs_tenant_read" ON background_jobs
        FOR SELECT
        USING (
          tenant_id = get_user_tenant_id()
          OR get_user_role() = 'super_admin'
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'background_jobs' AND policyname = 'bg_jobs_tenant_write'
    ) THEN
      CREATE POLICY "bg_jobs_tenant_write" ON background_jobs
        FOR ALL
        USING (
          tenant_id = get_user_tenant_id()
          OR get_user_role() = 'super_admin'
        );
    END IF;

  END IF;
END $$;


-- ── 2. background_job_results ─────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'background_job_results') THEN

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'background_job_results'
        AND column_name  = 'tenant_id'
        AND data_type    = 'text'
    ) THEN
      ALTER TABLE background_job_results ADD COLUMN tenant_id_new UUID;
      UPDATE background_job_results
        SET tenant_id_new = tenant_id::UUID
        WHERE tenant_id IS NOT NULL
          AND tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      ALTER TABLE background_job_results DROP COLUMN tenant_id;
      ALTER TABLE background_job_results RENAME COLUMN tenant_id_new TO tenant_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name        = 'background_job_results'
        AND constraint_name   = 'background_job_results_tenant_id_fkey'
    ) THEN
      ALTER TABLE background_job_results
        ADD CONSTRAINT background_job_results_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
    END IF;

    ALTER TABLE background_job_results ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'background_job_results' AND policyname = 'bg_results_tenant_read'
    ) THEN
      CREATE POLICY "bg_results_tenant_read" ON background_job_results
        FOR SELECT
        USING (
          tenant_id = get_user_tenant_id()
          OR get_user_role() = 'super_admin'
        );
    END IF;

  END IF;
END $$;


-- ── 3. scheduler_heartbeats ───────────────────────────────────
-- The original table has UNIQUE (scheduler_name, tenant_id).
-- We must drop that constraint before changing the column type,
-- then recreate it using the new UUID column.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'scheduler_heartbeats') THEN

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'scheduler_heartbeats'
        AND column_name  = 'tenant_id'
        AND data_type    = 'text'
    ) THEN
      ALTER TABLE scheduler_heartbeats
        DROP CONSTRAINT IF EXISTS scheduler_heartbeats_scheduler_name_tenant_id_key;
      ALTER TABLE scheduler_heartbeats ADD COLUMN tenant_id_new UUID;
      UPDATE scheduler_heartbeats
        SET tenant_id_new = tenant_id::UUID
        WHERE tenant_id IS NOT NULL
          AND tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      ALTER TABLE scheduler_heartbeats DROP COLUMN tenant_id;
      ALTER TABLE scheduler_heartbeats RENAME COLUMN tenant_id_new TO tenant_id;
      ALTER TABLE scheduler_heartbeats
        ADD CONSTRAINT scheduler_heartbeats_scheduler_name_tenant_id_key
        UNIQUE (scheduler_name, tenant_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_schema = 'public'
        AND table_name        = 'scheduler_heartbeats'
        AND constraint_name   = 'scheduler_heartbeats_tenant_id_fkey'
    ) THEN
      ALTER TABLE scheduler_heartbeats
        ADD CONSTRAINT scheduler_heartbeats_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
    END IF;

    ALTER TABLE scheduler_heartbeats ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'scheduler_heartbeats' AND policyname = 'scheduler_heartbeats_admin'
    ) THEN
      CREATE POLICY "scheduler_heartbeats_admin" ON scheduler_heartbeats
        FOR ALL
        USING (get_user_role() IN ('super_admin', 'hr_admin'));
    END IF;

  END IF;
END $$;


-- ── 4. payroll_finalize_overrides ────────────────────────────
-- tenant_id was NOT NULL TEXT — preserve NOT NULL constraint after conversion.

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

    ALTER TABLE payroll_finalize_overrides ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'payroll_finalize_overrides' AND policyname = 'pfo_hr_read'
    ) THEN
      CREATE POLICY "pfo_hr_read" ON payroll_finalize_overrides
        FOR SELECT
        USING (
          tenant_id = get_user_tenant_id()
          AND get_user_role() IN ('super_admin', 'hr_admin')
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'payroll_finalize_overrides' AND policyname = 'pfo_hr_write'
    ) THEN
      CREATE POLICY "pfo_hr_write" ON payroll_finalize_overrides
        FOR ALL
        USING (get_user_role() IN ('super_admin', 'hr_admin'));
    END IF;

  END IF;
END $$;
