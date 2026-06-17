-- ─────────────────────────────────────────────────────────────────────────────
-- 274_cluster_master.sql
-- Cluster master — operational axis for sites (Region → Cluster → Site).
-- Independent of the State (statutory) axis. Carries a cluster/area manager;
-- Phase 4 will grant that manager RBAC visibility over the cluster's sites.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clusters (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  code                TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  region              TEXT,                              -- free text, for Region roll-ups
  cluster_manager_id  UUID        REFERENCES employees(id) ON DELETE SET NULL,
  parent_cluster_id   UUID        REFERENCES clusters(id)  ON DELETE SET NULL,
  description         TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  custom_fields       JSONB       NOT NULL DEFAULT '{}',  -- reserved for UDF (deferred)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_clusters_tenant  ON clusters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_clusters_manager ON clusters (cluster_manager_id);
CREATE INDEX IF NOT EXISTS idx_clusters_parent  ON clusters (parent_cluster_id);

COMMENT ON TABLE  clusters                    IS 'Operational grouping of sites (Region → Cluster → Site).';
COMMENT ON COLUMN clusters.cluster_manager_id IS 'Employee managing this cluster (RBAC scope added in Phase 4).';
COMMENT ON COLUMN clusters.parent_cluster_id  IS 'Optional parent cluster for multi-level roll-ups.';
COMMENT ON COLUMN clusters.custom_fields      IS 'Reserved for user-defined fields (mechanism TBD).';

-- ── 2. updated_at trigger ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_clusters_updated_at ON clusters;
CREATE TRIGGER trg_clusters_updated_at
  BEFORE UPDATE ON clusters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clusters_tenant_select ON clusters;
CREATE POLICY clusters_tenant_select ON clusters
  FOR SELECT USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS clusters_admin_insert ON clusters;
CREATE POLICY clusters_admin_insert ON clusters
  FOR INSERT WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

DROP POLICY IF EXISTS clusters_admin_update ON clusters;
CREATE POLICY clusters_admin_update ON clusters
  FOR UPDATE USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );

DROP POLICY IF EXISTS clusters_admin_delete ON clusters;
CREATE POLICY clusters_admin_delete ON clusters
  FOR DELETE USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() IN ('super_admin', 'hr_admin')
  );
