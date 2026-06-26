-- Migration 312: community feed post reports (moderation).
--
-- Any employee can report a post they find inappropriate; HR reviews reports and
-- hides/removes via the existing PATCH /community/posts/:id. One report per
-- person per post (UNIQUE) so report counts reflect distinct reporters.
--
-- Idempotent: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS feed_reports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  post_id           UUID        NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  reporter_employee UUID        REFERENCES employees(id) ON DELETE SET NULL,
  reason            TEXT,
  status            TEXT        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, reporter_employee)
);
CREATE INDEX IF NOT EXISTS idx_feed_reports_open ON feed_reports (tenant_id, status, created_at DESC);

ALTER TABLE feed_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feed_reports_hr_all"  ON feed_reports FOR ALL    USING (get_user_role() IN ('super_admin','hr_admin'));
CREATE POLICY "feed_reports_insert"  ON feed_reports FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());
