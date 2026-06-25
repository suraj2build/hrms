-- Migration 306: Recognition & Rewards foundation (kudos + badge catalogue)
--
-- First slice of the ESS 2.0 "Rewards" pillar. Peer-to-peer recognition:
-- an employee gives a colleague a badge + message; recognition is visible in a
-- company feed. Points are recorded per badge for a later points/leaderboard
-- phase. The API enforces tenant scoping in code (service-role bypasses RLS);
-- the policies below are defense-in-depth, mirroring the house pattern.

CREATE TABLE IF NOT EXISTS recognition_badges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  icon        TEXT,                       -- lucide icon name (frontend maps it)
  description TEXT,
  points      INT         NOT NULL DEFAULT 10,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_recognition_badges_tenant ON recognition_badges (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS recognition (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_employee UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_employee   UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  badge_code    TEXT,
  message       TEXT        NOT NULL,
  points        INT         NOT NULL DEFAULT 0,
  visibility    TEXT        NOT NULL DEFAULT 'public'
                CHECK (visibility IN ('public','private')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recognition_tenant_created ON recognition (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recognition_to             ON recognition (tenant_id, to_employee);
CREATE INDEX IF NOT EXISTS idx_recognition_from           ON recognition (tenant_id, from_employee);

ALTER TABLE recognition_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recbadge_hr_all" ON recognition_badges FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "recbadge_read"   ON recognition_badges FOR SELECT USING (tenant_id = get_user_tenant_id());

ALTER TABLE recognition ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recognition_hr_all" ON recognition FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "recognition_read"   ON recognition FOR SELECT USING (tenant_id = get_user_tenant_id());

-- Seed the default badge catalogue for every existing tenant. New tenants get
-- the same set provisioned by the API on first read (ensureDefaultBadges).
INSERT INTO recognition_badges (tenant_id, code, label, icon, description, points)
SELECT t.id, b.code, b.label, b.icon, b.description, b.points
FROM tenants t
CROSS JOIN (VALUES
  ('ownership_champion', 'Ownership Champion', 'Award',     'Takes end-to-end ownership',          15),
  ('customer_hero',      'Customer Hero',      'Heart',     'Goes above and beyond for customers', 15),
  ('team_player',        'Team Player',        'Users',     'Lifts the whole team',                10),
  ('innovator',          'Innovator',          'Lightbulb', 'Brings new ideas to life',            15),
  ('problem_solver',     'Problem Solver',     'Wrench',    'Cracks the hard problems',            10),
  ('culture_ambassador', 'Culture Ambassador', 'Sparkles',  'Lives our values every day',          10)
) AS b(code, label, icon, description, points)
ON CONFLICT (tenant_id, code) DO NOTHING;
