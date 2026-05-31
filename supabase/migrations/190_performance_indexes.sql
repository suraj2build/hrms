-- =============================================================================
-- Migration 190: Performance indexes for enterprise scale
-- Targets verified tables only (confirmed in migrations 014, 078, 185–189).
--
-- SAFETY PATTERN
-- --------------
-- Every index group is wrapped in a DO $$ IF EXISTS block that checks
-- whether the target table exists before attempting to create the index.
-- This makes the migration safe regardless of which prerequisite migrations
-- have been applied — missing tables are skipped gracefully rather than
-- failing the entire migration.
--
-- On a complete fresh deploy (all prior migrations succeed), every block
-- fires and every index is created. On a partial deploy, only the available
-- tables are indexed; the rest are created by the table's own migration.
--
-- NOTE: CONCURRENTLY is intentionally omitted. Supabase migrations run
-- inside transaction blocks; CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction. Regular CREATE INDEX IF NOT EXISTS is used instead.
-- =============================================================================

-- ── platform_events (migration 185) ──────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'platform_events') THEN

    CREATE INDEX IF NOT EXISTS idx_platform_events_org_type_ts
      ON platform_events(org_id, event_type, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_platform_events_entity
      ON platform_events(org_id, entity_type, entity_id, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_platform_events_correlation
      ON platform_events(org_id, correlation_id) WHERE correlation_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_platform_events_severity_ts
      ON platform_events(org_id, severity, timestamp DESC)
      WHERE severity IN ('high', 'critical');

    CREATE INDEX IF NOT EXISTS idx_platform_events_module
      ON platform_events(org_id, module, timestamp DESC);

  END IF;
END $$;

-- ── decision_graph_nodes (migration 189) ─────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'decision_graph_nodes') THEN

    CREATE INDEX IF NOT EXISTS idx_decision_nodes_entity
      ON decision_graph_nodes(org_id, entity_id, entity_type, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_decision_nodes_type_ts
      ON decision_graph_nodes(org_id, node_type, timestamp DESC);

  END IF;
END $$;

-- ── decision_graph_edges (migration 189) ─────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'decision_graph_edges') THEN

    CREATE INDEX IF NOT EXISTS idx_decision_edges_from
      ON decision_graph_edges(from_node_id);

    CREATE INDEX IF NOT EXISTS idx_decision_edges_to
      ON decision_graph_edges(to_node_id);

  END IF;
END $$;

-- ── replay_sessions (migration 189) ──────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'replay_sessions') THEN

    CREATE INDEX IF NOT EXISTS idx_replay_sessions_org_ts
      ON replay_sessions(org_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_replay_sessions_entity
      ON replay_sessions(org_id, entity_id, entity_type);

  END IF;
END $$;

-- ── intelligence_compositions (migration 189) ─────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'intelligence_compositions') THEN

    CREATE INDEX IF NOT EXISTS idx_intel_compositions_org_entity
      ON intelligence_compositions(org_id, entity_id, entity_type, computed_at DESC);

  END IF;
END $$;

-- ── workforce_graph_edges (migration 187) ─────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'workforce_graph_edges') THEN

    CREATE INDEX IF NOT EXISTS idx_wf_graph_from
      ON workforce_graph_edges(org_id, from_entity, edge_type);

    CREATE INDEX IF NOT EXISTS idx_wf_graph_to
      ON workforce_graph_edges(org_id, to_entity, edge_type);

  END IF;
END $$;

-- ── compensation_revisions (migration 078) ────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'compensation_revisions') THEN

    CREATE INDEX IF NOT EXISTS idx_comp_revisions_employee_status
      ON compensation_revisions(employee_id, status, effective_date DESC);

    CREATE INDEX IF NOT EXISTS idx_comp_revisions_tenant_status
      ON compensation_revisions(tenant_id, status, created_at DESC);

  END IF;
END $$;

-- ── employee_compensations (migration 014) ────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'employee_compensations') THEN

    CREATE INDEX IF NOT EXISTS idx_emp_comp_active
      ON employee_compensations(employee_id, is_active, effective_from DESC);

  END IF;
END $$;

-- ── operational_health_signals (migration 188) ────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'operational_health_signals') THEN

    CREATE INDEX IF NOT EXISTS idx_ops_health_org_ts
      ON operational_health_signals(org_id, computed_at DESC);

  END IF;
END $$;
