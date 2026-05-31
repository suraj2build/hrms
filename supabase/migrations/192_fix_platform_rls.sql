-- ============================================================
-- 192_fix_platform_rls.sql
--
-- Corrective migration: fix broken RLS policies in migrations
-- 186 (governance_intelligence), 187 (workforce_trust),
-- 188 (operational_intelligence), 189 (enterprise_fabric).
-- Also hardens verification_records (191) which was created
-- with no RLS, no tenant FK, and no policies.
--
-- ROOT CAUSE (186–189)
-- --------------------
-- All read policies used one of two broken patterns:
--
--   Pattern A (186):
--     tenant_id = auth.uid()
--   Pattern B (186–189):
--     org_id IN (SELECT id FROM tenants WHERE id = auth.uid())
--
-- auth.uid() returns the authenticated USER's UUID.
-- Tenant IDs are a completely separate UUID namespace.
-- The comparison always returns zero rows for real users.
-- Every table in these four migrations was effectively
-- read-locked for all non-service-role connections.
--
-- Additionally, all write policies used WITH CHECK (true)
-- which allowed any authenticated user from any tenant to
-- insert rows with any tenant/org_id value.
--
-- CORRECT PATTERN
-- ---------------
--   For tables using tenant_id:  tenant_id = get_user_tenant_id()
--   For tables using org_id:     org_id    = get_user_tenant_id()
--   For nullable tenant columns: ... OR tenant_id IS NULL
--
-- APPROACH
-- --------
-- DROP IF EXISTS old policy → CREATE corrected policy.
-- No table schemas or data are modified.
--
-- SAFETY PATTERN
-- --------------
-- Every per-table block is wrapped in a DO $$ IF EXISTS check.
-- PostgreSQL's DROP POLICY IF EXISTS requires the TABLE to exist
-- even when the policy name doesn't — it raises 42P01 if the
-- table is missing. The DO block guards prevent that failure when
-- a prerequisite migration (185–189) was not applied.
-- ============================================================

-- ── SECTION 1: governance_intelligence (186) ─────────────────
-- Tables use column name: tenant_id

-- governance_rules (tenant_id nullable → platform-wide rows have NULL)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'governance_rules') THEN

    DROP POLICY IF EXISTS "gr_read"   ON governance_rules;
    DROP POLICY IF EXISTS "gr_insert" ON governance_rules;

    CREATE POLICY "gr_read" ON governance_rules
      FOR SELECT USING (
        tenant_id = get_user_tenant_id()
        OR tenant_id IS NULL  -- platform-wide rules readable by all tenants
      );

    CREATE POLICY "gr_insert" ON governance_rules
      FOR INSERT WITH CHECK (
        tenant_id = get_user_tenant_id()
        OR get_user_role() = 'super_admin'
      );

  END IF;
END $$;

-- compliance_evaluations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'compliance_evaluations') THEN

    DROP POLICY IF EXISTS "ce_read"   ON compliance_evaluations;
    DROP POLICY IF EXISTS "ce_insert" ON compliance_evaluations;

    CREATE POLICY "ce_read" ON compliance_evaluations
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY "ce_insert" ON compliance_evaluations
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

  END IF;
END $$;

-- governance_risk_scores
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'governance_risk_scores') THEN

    DROP POLICY IF EXISTS "grs_read"   ON governance_risk_scores;
    DROP POLICY IF EXISTS "grs_upsert" ON governance_risk_scores;
    DROP POLICY IF EXISTS "grs_update" ON governance_risk_scores;

    CREATE POLICY "grs_read" ON governance_risk_scores
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY "grs_upsert" ON governance_risk_scores
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

    CREATE POLICY "grs_update" ON governance_risk_scores
      FOR UPDATE USING (tenant_id = get_user_tenant_id());

  END IF;
END $$;

-- governance_drift_events
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'governance_drift_events') THEN

    DROP POLICY IF EXISTS "gde_read"   ON governance_drift_events;
    DROP POLICY IF EXISTS "gde_insert" ON governance_drift_events;

    CREATE POLICY "gde_read" ON governance_drift_events
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY "gde_insert" ON governance_drift_events
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

  END IF;
END $$;


-- ── SECTION 2: workforce_trust (187) ─────────────────────────
-- Tables use column name: org_id

-- verification_events
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'verification_events') THEN

    DROP POLICY IF EXISTS "ve_read"   ON verification_events;
    DROP POLICY IF EXISTS "ve_insert" ON verification_events;

    CREATE POLICY "ve_read" ON verification_events
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "ve_insert" ON verification_events
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- duplicate_detection_events
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'duplicate_detection_events') THEN

    DROP POLICY IF EXISTS "dde_read"   ON duplicate_detection_events;
    DROP POLICY IF EXISTS "dde_insert" ON duplicate_detection_events;

    CREATE POLICY "dde_read" ON duplicate_detection_events
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "dde_insert" ON duplicate_detection_events
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- workforce_trust_scores
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'workforce_trust_scores') THEN

    DROP POLICY IF EXISTS "wts_read"   ON workforce_trust_scores;
    DROP POLICY IF EXISTS "wts_upsert" ON workforce_trust_scores;
    DROP POLICY IF EXISTS "wts_update" ON workforce_trust_scores;

    CREATE POLICY "wts_read" ON workforce_trust_scores
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "wts_upsert" ON workforce_trust_scores
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

    CREATE POLICY "wts_update" ON workforce_trust_scores
      FOR UPDATE USING (org_id = get_user_tenant_id());

  END IF;
END $$;

-- workforce_graph_edges
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'workforce_graph_edges') THEN

    DROP POLICY IF EXISTS "wge_read"   ON workforce_graph_edges;
    DROP POLICY IF EXISTS "wge_upsert" ON workforce_graph_edges;
    DROP POLICY IF EXISTS "wge_update" ON workforce_graph_edges;

    CREATE POLICY "wge_read" ON workforce_graph_edges
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "wge_upsert" ON workforce_graph_edges
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

    CREATE POLICY "wge_update" ON workforce_graph_edges
      FOR UPDATE USING (org_id = get_user_tenant_id());

  END IF;
END $$;

-- compliance_revision_events (org_id nullable → platform-wide revisions have NULL)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'compliance_revision_events') THEN

    DROP POLICY IF EXISTS "cre_read"   ON compliance_revision_events;
    DROP POLICY IF EXISTS "cre_insert" ON compliance_revision_events;
    DROP POLICY IF EXISTS "cre_update" ON compliance_revision_events;

    CREATE POLICY "cre_read" ON compliance_revision_events
      FOR SELECT USING (
        org_id = get_user_tenant_id()
        OR org_id IS NULL  -- platform-wide regulatory changes readable by all tenants
      );

    CREATE POLICY "cre_insert" ON compliance_revision_events
      FOR INSERT WITH CHECK (
        org_id = get_user_tenant_id()
        OR get_user_role() = 'super_admin'
      );

    CREATE POLICY "cre_update" ON compliance_revision_events
      FOR UPDATE USING (org_id = get_user_tenant_id());

  END IF;
END $$;


-- ── SECTION 3: operational_intelligence (188) ────────────────
-- Tables use column name: org_id

-- automation_activity_logs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'automation_activity_logs') THEN

    DROP POLICY IF EXISTS "aal_read"   ON automation_activity_logs;
    DROP POLICY IF EXISTS "aal_insert" ON automation_activity_logs;

    CREATE POLICY "aal_read" ON automation_activity_logs
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "aal_insert" ON automation_activity_logs
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- sla_breach_events
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'sla_breach_events') THEN

    DROP POLICY IF EXISTS "sbe_read"   ON sla_breach_events;
    DROP POLICY IF EXISTS "sbe_insert" ON sla_breach_events;

    CREATE POLICY "sbe_read" ON sla_breach_events
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "sbe_insert" ON sla_breach_events
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- operational_heatmap_snapshots
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'operational_heatmap_snapshots') THEN

    DROP POLICY IF EXISTS "ohs_read"   ON operational_heatmap_snapshots;
    DROP POLICY IF EXISTS "ohs_insert" ON operational_heatmap_snapshots;

    CREATE POLICY "ohs_read" ON operational_heatmap_snapshots
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "ohs_insert" ON operational_heatmap_snapshots
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- simulation_runs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'simulation_runs') THEN

    DROP POLICY IF EXISTS "sr_read"   ON simulation_runs;
    DROP POLICY IF EXISTS "sr_insert" ON simulation_runs;

    CREATE POLICY "sr_read" ON simulation_runs
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "sr_insert" ON simulation_runs
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- operational_health_signals
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'operational_health_signals') THEN

    DROP POLICY IF EXISTS "ohs2_read"   ON operational_health_signals;
    DROP POLICY IF EXISTS "ohs2_insert" ON operational_health_signals;

    CREATE POLICY "ohs2_read" ON operational_health_signals
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "ohs2_insert" ON operational_health_signals
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- security_intelligence_events
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'security_intelligence_events') THEN

    DROP POLICY IF EXISTS "sie_read"   ON security_intelligence_events;
    DROP POLICY IF EXISTS "sie_insert" ON security_intelligence_events;

    CREATE POLICY "sie_read" ON security_intelligence_events
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "sie_insert" ON security_intelligence_events
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;


-- ── SECTION 4: enterprise_fabric (189) ───────────────────────
-- Tables use column name: org_id

-- decision_graph_nodes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'decision_graph_nodes') THEN

    DROP POLICY IF EXISTS "dgn_read"   ON decision_graph_nodes;
    DROP POLICY IF EXISTS "dgn_insert" ON decision_graph_nodes;

    CREATE POLICY "dgn_read" ON decision_graph_nodes
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "dgn_insert" ON decision_graph_nodes
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- decision_graph_edges
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'decision_graph_edges') THEN

    DROP POLICY IF EXISTS "dge_read"   ON decision_graph_edges;
    DROP POLICY IF EXISTS "dge_insert" ON decision_graph_edges;

    CREATE POLICY "dge_read" ON decision_graph_edges
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "dge_insert" ON decision_graph_edges
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- orchestration_activity_logs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'orchestration_activity_logs') THEN

    DROP POLICY IF EXISTS "oal_read"   ON orchestration_activity_logs;
    DROP POLICY IF EXISTS "oal_insert" ON orchestration_activity_logs;
    DROP POLICY IF EXISTS "oal_update" ON orchestration_activity_logs;

    CREATE POLICY "oal_read" ON orchestration_activity_logs
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "oal_insert" ON orchestration_activity_logs
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

    CREATE POLICY "oal_update" ON orchestration_activity_logs
      FOR UPDATE USING (org_id = get_user_tenant_id());

  END IF;
END $$;

-- replay_sessions
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'replay_sessions') THEN

    DROP POLICY IF EXISTS "rs_read"   ON replay_sessions;
    DROP POLICY IF EXISTS "rs_insert" ON replay_sessions;

    CREATE POLICY "rs_read" ON replay_sessions
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "rs_insert" ON replay_sessions
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- intelligence_compositions
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'intelligence_compositions') THEN

    DROP POLICY IF EXISTS "ic_read"   ON intelligence_compositions;
    DROP POLICY IF EXISTS "ic_insert" ON intelligence_compositions;

    CREATE POLICY "ic_read" ON intelligence_compositions
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "ic_insert" ON intelligence_compositions
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;

-- enterprise_health_snapshots
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'enterprise_health_snapshots') THEN

    DROP POLICY IF EXISTS "ehs_read"   ON enterprise_health_snapshots;
    DROP POLICY IF EXISTS "ehs_insert" ON enterprise_health_snapshots;

    CREATE POLICY "ehs_read" ON enterprise_health_snapshots
      FOR SELECT USING (org_id = get_user_tenant_id());

    CREATE POLICY "ehs_insert" ON enterprise_health_snapshots
      FOR INSERT WITH CHECK (org_id = get_user_tenant_id());

  END IF;
END $$;


-- ── SECTION 5: verification_records (191) ────────────────────
-- Created in 191 with no RLS, no tenant FK, and no policies.
-- Stores employee PAN/bank verification state — must be secured.

-- Add tenant FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name        = 'verification_records'
      AND constraint_name   = 'verification_records_tenant_id_fkey'
  ) THEN
    ALTER TABLE verification_records
      ADD CONSTRAINT verification_records_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Enable RLS (idempotent)
ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY;

-- HR/admin: full read access for their tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_records' AND policyname = 'vr_hr_read'
  ) THEN
    CREATE POLICY "vr_hr_read" ON verification_records
      FOR SELECT
      USING (
        tenant_id = get_user_tenant_id()
        AND get_user_role() IN ('super_admin', 'hr_admin')
      );
  END IF;
END $$;

-- Employee: read own verification records only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_records' AND policyname = 'vr_self_read'
  ) THEN
    CREATE POLICY "vr_self_read" ON verification_records
      FOR SELECT
      USING (
        tenant_id = get_user_tenant_id()
        AND employee_id IN (
          SELECT employee_id FROM profiles
          WHERE id = auth.uid() AND employee_id IS NOT NULL
        )
      );
  END IF;
END $$;

-- HR/admin: write (upsert by verification orchestrator via service role or HR)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_records' AND policyname = 'vr_hr_write'
  ) THEN
    CREATE POLICY "vr_hr_write" ON verification_records
      FOR ALL
      USING (get_user_role() IN ('super_admin', 'hr_admin'));
  END IF;
END $$;

-- Service-role bypass: verification orchestrator writes via service role;
-- the policies above protect anon/user-role access.
-- No separate service-role policy needed — service role bypasses RLS by default.
