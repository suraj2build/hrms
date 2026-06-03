-- ============================================================
-- Migration 214: Workforce Guidance Framework — content store
-- Feature/role/module FLAGS live in tenants.settings.guidance (JSONB) — no table.
-- This table stores only tenant-overridable guidance CONTENT (data, not config).
-- Static in-code defaults work without any rows here.
-- ============================================================

CREATE TABLE IF NOT EXISTS guidance_content (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module       TEXT        NOT NULL,
  page_key     TEXT        NOT NULL,
  content_type TEXT        NOT NULL CHECK (content_type IN ('help','process','why','field')),
  role         TEXT        NOT NULL DEFAULT 'all'
                 CHECK (role IN ('all','employee','manager','hr_admin','super_admin')),
  field_key    TEXT        NOT NULL DEFAULT '',
  title        TEXT,
  body         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  updated_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module, page_key, content_type, role, field_key)
);

CREATE INDEX IF NOT EXISTS idx_guidance_content_lookup
  ON guidance_content (tenant_id, module, page_key, content_type, role)
  WHERE is_active = true;

ALTER TABLE guidance_content ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='guidance_content' AND policyname='guidance_content_read') THEN
    CREATE POLICY guidance_content_read ON guidance_content FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='guidance_content' AND policyname='guidance_content_service_write') THEN
    CREATE POLICY guidance_content_service_write ON guidance_content FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
