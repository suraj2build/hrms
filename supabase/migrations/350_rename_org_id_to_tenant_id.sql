-- =============================================================================
-- 350_rename_org_id_to_tenant_id.sql
-- ISSUE-065: Rename org_id → tenant_id across 18 platform tables.
--
-- Background: migrations 185, 187, 188, 189 named the column "org_id" as a
-- short alias for the tenant foreign key. All other tables in the schema use
-- "tenant_id". This migration aligns them.
--
-- PostgreSQL behavior on RENAME COLUMN:
--   • All indexes that reference the column are updated automatically (PG tracks
--     attribute numbers, not names), so existing index definitions remain valid.
--   • Inline (unnamed) FK constraints remain valid for the same reason.
--   • Named FK constraints must be renamed explicitly if desired; they stay
--     structurally valid but the name becomes stale.
--   • RLS policy USING/WITH CHECK expressions reference column names as TEXT in
--     pg_policies.qual. They are NOT rewritten on rename — every policy on these
--     tables must be dropped and recreated.
--
-- Tables covered (18):
--   185: platform_events
--   187: verification_events, duplicate_detection_events, workforce_trust_scores,
--        workforce_graph_edges, compliance_revision_events (nullable — platform-wide rows)
--   188: automation_activity_logs, sla_breach_events, operational_heatmap_snapshots,
--        simulation_runs, operational_health_signals, security_intelligence_events
--   189: decision_graph_nodes, decision_graph_edges, orchestration_activity_logs,
--        replay_sessions, intelligence_compositions, enterprise_health_snapshots
--
-- Each block is guarded with an IF EXISTS / column-existence check so the
-- migration is safe to apply on instances that may be missing prerequisite tables.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: platform_events (migration 185)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_events' AND column_name = 'org_id'
  ) THEN

    -- Rename column (indexes auto-update)
    ALTER TABLE platform_events RENAME COLUMN org_id TO tenant_id;

    -- Rename named FK (structural; platform_events_org_fk references tenants.id)
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'platform_events'
        AND constraint_name = 'platform_events_org_fk'
    ) THEN
      ALTER TABLE platform_events
        RENAME CONSTRAINT platform_events_org_fk TO platform_events_tenant_fk;
    END IF;

    -- Drop old RLS policies (reference org_id as text; will break after rename)
    DROP POLICY IF EXISTS pe_hr_read        ON platform_events;
    DROP POLICY IF EXISTS pe_service_insert ON platform_events;

    -- Recreate with tenant_id
    CREATE POLICY pe_hr_read ON platform_events
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY pe_service_insert ON platform_events
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: workforce_trust tables (migration 187)
-- ─────────────────────────────────────────────────────────────────────────────

-- verification_events
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'verification_events' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE verification_events RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS ve_read   ON verification_events;
    DROP POLICY IF EXISTS ve_insert ON verification_events;

    CREATE POLICY ve_read ON verification_events
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY ve_insert ON verification_events
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- duplicate_detection_events
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'duplicate_detection_events' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE duplicate_detection_events RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS dde_read   ON duplicate_detection_events;
    DROP POLICY IF EXISTS dde_insert ON duplicate_detection_events;

    CREATE POLICY dde_read ON duplicate_detection_events
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY dde_insert ON duplicate_detection_events
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- workforce_trust_scores
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workforce_trust_scores' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE workforce_trust_scores RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS wts_read   ON workforce_trust_scores;
    DROP POLICY IF EXISTS wts_upsert ON workforce_trust_scores;
    DROP POLICY IF EXISTS wts_update ON workforce_trust_scores;

    CREATE POLICY wts_read ON workforce_trust_scores
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY wts_upsert ON workforce_trust_scores
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

    CREATE POLICY wts_update ON workforce_trust_scores
      FOR UPDATE USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- workforce_graph_edges
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workforce_graph_edges' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE workforce_graph_edges RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS wge_read   ON workforce_graph_edges;
    DROP POLICY IF EXISTS wge_upsert ON workforce_graph_edges;
    DROP POLICY IF EXISTS wge_update ON workforce_graph_edges;

    CREATE POLICY wge_read ON workforce_graph_edges
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY wge_upsert ON workforce_graph_edges
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

    CREATE POLICY wge_update ON workforce_graph_edges
      FOR UPDATE USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- compliance_revision_events (org_id is nullable — NULL = platform-wide revision)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compliance_revision_events' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE compliance_revision_events RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS cre_read   ON compliance_revision_events;
    DROP POLICY IF EXISTS cre_insert ON compliance_revision_events;
    DROP POLICY IF EXISTS cre_update ON compliance_revision_events;

    -- Preserve nullable semantic: NULL tenant_id = platform-wide, readable by all
    CREATE POLICY cre_read ON compliance_revision_events
      FOR SELECT USING (
        tenant_id = get_user_tenant_id()
        OR tenant_id IS NULL
      );

    CREATE POLICY cre_insert ON compliance_revision_events
      FOR INSERT WITH CHECK (
        tenant_id = get_user_tenant_id()
        OR get_user_role() = 'super_admin'
      );

    CREATE POLICY cre_update ON compliance_revision_events
      FOR UPDATE USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: operational_intelligence tables (migration 188)
-- ─────────────────────────────────────────────────────────────────────────────

-- automation_activity_logs
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'automation_activity_logs' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE automation_activity_logs RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS aal_read   ON automation_activity_logs;
    DROP POLICY IF EXISTS aal_insert ON automation_activity_logs;

    CREATE POLICY aal_read ON automation_activity_logs
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY aal_insert ON automation_activity_logs
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- sla_breach_events
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sla_breach_events' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE sla_breach_events RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS sbe_read   ON sla_breach_events;
    DROP POLICY IF EXISTS sbe_insert ON sla_breach_events;

    CREATE POLICY sbe_read ON sla_breach_events
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY sbe_insert ON sla_breach_events
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- operational_heatmap_snapshots
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operational_heatmap_snapshots' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE operational_heatmap_snapshots RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS ohs_read   ON operational_heatmap_snapshots;
    DROP POLICY IF EXISTS ohs_insert ON operational_heatmap_snapshots;

    CREATE POLICY ohs_read ON operational_heatmap_snapshots
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY ohs_insert ON operational_heatmap_snapshots
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- simulation_runs
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'simulation_runs' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE simulation_runs RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS sr_read   ON simulation_runs;
    DROP POLICY IF EXISTS sr_insert ON simulation_runs;

    CREATE POLICY sr_read ON simulation_runs
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY sr_insert ON simulation_runs
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- operational_health_signals
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operational_health_signals' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE operational_health_signals RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS ohs2_read   ON operational_health_signals;
    DROP POLICY IF EXISTS ohs2_insert ON operational_health_signals;

    CREATE POLICY ohs2_read ON operational_health_signals
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY ohs2_insert ON operational_health_signals
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- security_intelligence_events
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'security_intelligence_events' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE security_intelligence_events RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS sie_read   ON security_intelligence_events;
    DROP POLICY IF EXISTS sie_insert ON security_intelligence_events;

    CREATE POLICY sie_read ON security_intelligence_events
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY sie_insert ON security_intelligence_events
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: enterprise_fabric tables (migration 189)
-- ─────────────────────────────────────────────────────────────────────────────

-- decision_graph_nodes
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'decision_graph_nodes' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE decision_graph_nodes RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS dgn_read   ON decision_graph_nodes;
    DROP POLICY IF EXISTS dgn_insert ON decision_graph_nodes;

    CREATE POLICY dgn_read ON decision_graph_nodes
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY dgn_insert ON decision_graph_nodes
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- decision_graph_edges
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'decision_graph_edges' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE decision_graph_edges RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS dge_read   ON decision_graph_edges;
    DROP POLICY IF EXISTS dge_insert ON decision_graph_edges;

    CREATE POLICY dge_read ON decision_graph_edges
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY dge_insert ON decision_graph_edges
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- orchestration_activity_logs
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orchestration_activity_logs' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE orchestration_activity_logs RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS oal_read   ON orchestration_activity_logs;
    DROP POLICY IF EXISTS oal_insert ON orchestration_activity_logs;
    DROP POLICY IF EXISTS oal_update ON orchestration_activity_logs;

    CREATE POLICY oal_read ON orchestration_activity_logs
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY oal_insert ON orchestration_activity_logs
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

    CREATE POLICY oal_update ON orchestration_activity_logs
      FOR UPDATE USING (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- replay_sessions
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'replay_sessions' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE replay_sessions RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS rs_read   ON replay_sessions;
    DROP POLICY IF EXISTS rs_insert ON replay_sessions;

    CREATE POLICY rs_read ON replay_sessions
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY rs_insert ON replay_sessions
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- intelligence_compositions
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'intelligence_compositions' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE intelligence_compositions RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS ic_read   ON intelligence_compositions;
    DROP POLICY IF EXISTS ic_insert ON intelligence_compositions;

    CREATE POLICY ic_read ON intelligence_compositions
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY ic_insert ON intelligence_compositions
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;

-- enterprise_health_snapshots
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enterprise_health_snapshots' AND column_name = 'org_id'
  ) THEN
    ALTER TABLE enterprise_health_snapshots RENAME COLUMN org_id TO tenant_id;

    DROP POLICY IF EXISTS ehs_read   ON enterprise_health_snapshots;
    DROP POLICY IF EXISTS ehs_insert ON enterprise_health_snapshots;

    CREATE POLICY ehs_read ON enterprise_health_snapshots
      FOR SELECT USING (tenant_id = get_user_tenant_id());

    CREATE POLICY ehs_insert ON enterprise_health_snapshots
      FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
  END IF;
END $$;
