-- ============================================================
-- 196_fix_missing_tenant_fks.sql
--
-- Adds missing REFERENCES tenants(id) FK constraints to tables
-- that declared tenant_id UUID NOT NULL / UUID but omitted the
-- REFERENCES clause, creating invisible referential integrity gaps.
--
-- Affected tables (by originating migration):
--   124: pii_access_log, erasure_requests, retention_enforcement_runs
--   125: security_events (partitioned), security_alerts
--   126: trace_spans (partitioned), business_event_metrics
--   127: backup_checkpoints
--   142: payroll_run_blockers
--   145: payroll_run_snapshots, payroll_employee_snapshots, payroll_replay_sessions
--   146: payroll_gl_mappings, payroll_financial_ledgers, payroll_ledger_entries,
--         payroll_cost_allocations, payroll_payout_reconciliation
--   184: muster_uploads
--
-- All statements are idempotent (IF NOT EXISTS constraint checks).
-- ON DELETE behavior:
--   NOT NULL tenant_id → CASCADE (tenant deletion removes all child rows)
--   Nullable tenant_id → SET NULL (global/platform rows survive tenant deletion)
-- ============================================================

-- ── Helper macro: add FK only if missing ─────────────────────
-- Pattern repeated per table below.

-- ── 124: pii_access_log ───────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'pii_access_log'
      AND constraint_name = 'pii_access_log_tenant_id_fkey') THEN
    ALTER TABLE pii_access_log
      ADD CONSTRAINT pii_access_log_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 124: erasure_requests ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'erasure_requests'
      AND constraint_name = 'erasure_requests_tenant_id_fkey') THEN
    ALTER TABLE erasure_requests
      ADD CONSTRAINT erasure_requests_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 124: retention_enforcement_runs ──────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'retention_enforcement_runs'
      AND constraint_name = 'retention_enforcement_runs_tenant_id_fkey') THEN
    ALTER TABLE retention_enforcement_runs
      ADD CONSTRAINT retention_enforcement_runs_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 125: security_events (partitioned) ───────────────────────
-- In PostgreSQL 12+, FK constraints on partitioned tables apply to all partitions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'security_events'
      AND constraint_name = 'security_events_tenant_id_fkey') THEN
    ALTER TABLE security_events
      ADD CONSTRAINT security_events_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 125: security_alerts ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'security_alerts'
      AND constraint_name = 'security_alerts_tenant_id_fkey') THEN
    ALTER TABLE security_alerts
      ADD CONSTRAINT security_alerts_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 126: trace_spans (partitioned) ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'trace_spans'
      AND constraint_name = 'trace_spans_tenant_id_fkey') THEN
    ALTER TABLE trace_spans
      ADD CONSTRAINT trace_spans_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 126: business_event_metrics ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'business_event_metrics'
      AND constraint_name = 'business_event_metrics_tenant_id_fkey') THEN
    ALTER TABLE business_event_metrics
      ADD CONSTRAINT business_event_metrics_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 127: backup_checkpoints ───────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'backup_checkpoints'
      AND constraint_name = 'backup_checkpoints_tenant_id_fkey') THEN
    ALTER TABLE backup_checkpoints
      ADD CONSTRAINT backup_checkpoints_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 142: payroll_run_blockers ─────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_run_blockers'
      AND constraint_name = 'payroll_run_blockers_tenant_id_fkey') THEN
    ALTER TABLE payroll_run_blockers
      ADD CONSTRAINT payroll_run_blockers_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 145: payroll_run_snapshots ────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_run_snapshots'
      AND constraint_name = 'payroll_run_snapshots_tenant_id_fkey') THEN
    ALTER TABLE payroll_run_snapshots
      ADD CONSTRAINT payroll_run_snapshots_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 145: payroll_employee_snapshots ──────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_employee_snapshots'
      AND constraint_name = 'payroll_employee_snapshots_tenant_id_fkey') THEN
    ALTER TABLE payroll_employee_snapshots
      ADD CONSTRAINT payroll_employee_snapshots_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 145: payroll_replay_sessions ──────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_replay_sessions'
      AND constraint_name = 'payroll_replay_sessions_tenant_id_fkey') THEN
    ALTER TABLE payroll_replay_sessions
      ADD CONSTRAINT payroll_replay_sessions_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 146: payroll_gl_mappings ──────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_gl_mappings'
      AND constraint_name = 'payroll_gl_mappings_tenant_id_fkey') THEN
    ALTER TABLE payroll_gl_mappings
      ADD CONSTRAINT payroll_gl_mappings_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 146: payroll_financial_ledgers ────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_financial_ledgers'
      AND constraint_name = 'payroll_financial_ledgers_tenant_id_fkey') THEN
    ALTER TABLE payroll_financial_ledgers
      ADD CONSTRAINT payroll_financial_ledgers_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 146: payroll_ledger_entries ───────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_ledger_entries'
      AND constraint_name = 'payroll_ledger_entries_tenant_id_fkey') THEN
    ALTER TABLE payroll_ledger_entries
      ADD CONSTRAINT payroll_ledger_entries_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 146: payroll_cost_allocations ────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_cost_allocations'
      AND constraint_name = 'payroll_cost_allocations_tenant_id_fkey') THEN
    ALTER TABLE payroll_cost_allocations
      ADD CONSTRAINT payroll_cost_allocations_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 146: payroll_payout_reconciliation ───────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'payroll_payout_reconciliation'
      AND constraint_name = 'payroll_payout_reconciliation_tenant_id_fkey') THEN
    ALTER TABLE payroll_payout_reconciliation
      ADD CONSTRAINT payroll_payout_reconciliation_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 184: muster_uploads ───────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'muster_uploads'
      AND constraint_name = 'muster_uploads_tenant_id_fkey') THEN
    ALTER TABLE muster_uploads
      ADD CONSTRAINT muster_uploads_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Fix inline-subquery RLS patterns in 145 and 146 ──────────
-- The original policies use: (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
-- Correct pattern: get_user_tenant_id()
-- This is functionally equivalent but consistent and avoids a correlated subquery per row.

-- payroll_run_snapshots
DROP POLICY IF EXISTS payroll_run_snapshots_tenant_isolation      ON payroll_run_snapshots;
CREATE POLICY payroll_run_snapshots_tenant_isolation ON payroll_run_snapshots
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_employee_snapshots
DROP POLICY IF EXISTS payroll_employee_snapshots_tenant_isolation  ON payroll_employee_snapshots;
CREATE POLICY payroll_employee_snapshots_tenant_isolation ON payroll_employee_snapshots
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_replay_sessions
DROP POLICY IF EXISTS payroll_replay_sessions_tenant_isolation     ON payroll_replay_sessions;
CREATE POLICY payroll_replay_sessions_tenant_isolation ON payroll_replay_sessions
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_gl_mappings
DROP POLICY IF EXISTS payroll_gl_mappings_tenant_isolation         ON payroll_gl_mappings;
CREATE POLICY payroll_gl_mappings_tenant_isolation ON payroll_gl_mappings
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_financial_ledgers
DROP POLICY IF EXISTS payroll_financial_ledgers_tenant_isolation   ON payroll_financial_ledgers;
CREATE POLICY payroll_financial_ledgers_tenant_isolation ON payroll_financial_ledgers
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_ledger_entries
DROP POLICY IF EXISTS payroll_ledger_entries_tenant_isolation      ON payroll_ledger_entries;
CREATE POLICY payroll_ledger_entries_tenant_isolation ON payroll_ledger_entries
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_cost_allocations (if policy exists from migration 146)
DROP POLICY IF EXISTS payroll_cost_allocations_tenant_isolation    ON payroll_cost_allocations;
CREATE POLICY payroll_cost_allocations_tenant_isolation ON payroll_cost_allocations
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- payroll_payout_reconciliation
DROP POLICY IF EXISTS payroll_payout_reconciliation_tenant_isolation ON payroll_payout_reconciliation;
CREATE POLICY payroll_payout_reconciliation_tenant_isolation ON payroll_payout_reconciliation
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- muster_uploads (fix inline subquery → get_user_tenant_id())
DROP POLICY IF EXISTS muster_uploads_tenant_isolation ON muster_uploads;
CREATE POLICY muster_uploads_tenant_isolation ON muster_uploads
  FOR ALL USING (tenant_id = get_user_tenant_id());
