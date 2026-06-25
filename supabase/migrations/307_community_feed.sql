-- Migration 307: Community feed foundation (posts + reactions + comments)
--
-- ESS 2.0 "Community" pillar. A ranked company feed of typed posts (employee
-- updates, HR announcements, auto-generated celebration posts later), with
-- reactions and comments. API enforces tenant scoping in code (service-role
-- bypasses RLS); the policies below are defense-in-depth per the house pattern.

CREATE TABLE IF NOT EXISTS feed_posts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_employee UUID        REFERENCES employees(id) ON DELETE SET NULL,
  type            TEXT        NOT NULL DEFAULT 'update'
                  CHECK (type IN ('update','announcement','recognition','anniversary','birthday','new_joiner','milestone')),
  title           TEXT,
  body            TEXT        NOT NULL,
  audience_scope  TEXT        NOT NULL DEFAULT 'company'
                  CHECK (audience_scope IN ('company','department','site')),
  audience_ref    UUID,
  pinned          BOOLEAN     NOT NULL DEFAULT false,
  status          TEXT        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','hidden','removed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_posts_feed ON feed_posts (tenant_id, status, pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_reactions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  post_id     UUID        NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  employee_id UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reaction    TEXT        NOT NULL DEFAULT 'like'
              CHECK (reaction IN ('like','celebrate','appreciate','support')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, employee_id)         -- one reaction per person per post
);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_post ON feed_reactions (post_id);

CREATE TABLE IF NOT EXISTS feed_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  post_id     UUID        NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  employee_id UUID        REFERENCES employees(id) ON DELETE SET NULL,
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments (post_id, created_at);

ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_posts_hr_all" ON feed_posts FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "feed_posts_read"   ON feed_posts FOR SELECT USING (tenant_id = get_user_tenant_id());

ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_reactions_hr_all" ON feed_reactions FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "feed_reactions_read"   ON feed_reactions FOR SELECT USING (tenant_id = get_user_tenant_id());

ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_comments_hr_all" ON feed_comments FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "feed_comments_read"   ON feed_comments FOR SELECT USING (tenant_id = get_user_tenant_id());
