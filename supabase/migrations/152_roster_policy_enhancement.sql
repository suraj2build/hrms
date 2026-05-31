-- ============================================================
-- 152_roster_policy_enhancement.sql
--
-- Enhances the rosters table to support enterprise policy
-- governance workflows:
--
--   description  — free-text description of the policy
--   is_active    — active/archived state for lifecycle management
--   updated_at   — auto-maintained audit timestamp
--
-- Also adds a partial index for fast active-policy lookups.
-- ============================================================

ALTER TABLE rosters
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;

-- ── Auto-update updated_at on every modification ──────────────────────────────

CREATE OR REPLACE FUNCTION update_rosters_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rosters_updated_at ON rosters;
CREATE TRIGGER trg_rosters_updated_at
  BEFORE UPDATE ON rosters
  FOR EACH ROW EXECUTE FUNCTION update_rosters_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast active-policy scan per tenant
CREATE INDEX IF NOT EXISTS idx_rosters_tenant_active
  ON rosters (tenant_id)
  WHERE is_active = true;
