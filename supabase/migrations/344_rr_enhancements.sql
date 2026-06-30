-- Migration 344: Rewards & Recognition Enhancements
-- Adds multi-level approval to award nominations; seeds Best Billing Associate award

-- ── Multi-level approval columns on award_nominations ─────────────────────────
ALTER TABLE award_nominations
  ADD COLUMN IF NOT EXISTS approval_level  INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_by_l1  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_l2  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS l1_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS l2_approved_at  TIMESTAMPTZ;

-- ── Ensure status includes level_2_pending ────────────────────────────────────
ALTER TABLE award_nominations
  DROP CONSTRAINT IF EXISTS award_nominations_status_check;

ALTER TABLE award_nominations
  ADD CONSTRAINT award_nominations_status_check
  CHECK (status IN ('pending','level_2_pending','approved','rejected','winner'));

-- ── Best Billing Associate formal award seed ──────────────────────────────────
INSERT INTO formal_awards (tenant_id, name, frequency, eligibility_group,
                            approver_role, monetary_value, currency)
SELECT id, 'Best Billing Associate', 'monthly', 'Billing Associates',
       'cluster_manager', 500, 'INR'
FROM tenants
WHERE id = 'd0000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;
