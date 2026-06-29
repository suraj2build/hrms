-- Migration 328: Policy KB — RAG Phase 2
--
-- Adds:
--   1. search_vector (tsvector GENERATED STORED) on hr_policies for FTS
--   2. GIN index on search_vector
--   3. search_policies() RPC function
--   4. policy_qa_logs table — records every employee AI Q&A session

-- ── 1. Full-text search vector on hr_policies ─────────────────────────────────

ALTER TABLE hr_policies
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(title,       '') || ' ' ||
        coalesce(description, '') || ' ' ||
        coalesce(content,     '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_hr_policies_search_vector
  ON hr_policies USING gin(search_vector);

-- ── 2. search_policies() — FTS + snippet + rank ───────────────────────────────

CREATE OR REPLACE FUNCTION search_policies(
  p_tenant_id UUID,
  p_query     TEXT,
  p_limit     INT DEFAULT 5
)
RETURNS TABLE (
  id          UUID,
  title       TEXT,
  category    TEXT,
  description TEXT,
  content     TEXT,
  snippet     TEXT,
  rank        REAL
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    id,
    title,
    category,
    description,
    content,
    ts_headline(
      'english',
      coalesce(content, description, ''),
      websearch_to_tsquery('english', p_query),
      'MaxWords=60, MinWords=20, StartSel=«, StopSel=»'
    ) AS snippet,
    ts_rank(search_vector, websearch_to_tsquery('english', p_query)) AS rank
  FROM hr_policies
  WHERE tenant_id = p_tenant_id
    AND status    = 'published'
    AND search_vector @@ websearch_to_tsquery('english', p_query)
  ORDER BY rank DESC
  LIMIT p_limit;
$$;

-- ── 3. policy_qa_logs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS policy_qa_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id       UUID        REFERENCES employees(id) ON DELETE SET NULL,
  question          TEXT        NOT NULL,
  answer            TEXT        NOT NULL,
  cited_policy_ids  UUID[]      NOT NULL DEFAULT '{}',
  model_used        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_qa_logs_tenant
  ON policy_qa_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_policy_qa_logs_employee
  ON policy_qa_logs(tenant_id, employee_id);

ALTER TABLE policy_qa_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_qa_logs_employee_insert" ON policy_qa_logs;
CREATE POLICY "policy_qa_logs_employee_insert" ON policy_qa_logs FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "policy_qa_logs_admin_read" ON policy_qa_logs;
CREATE POLICY "policy_qa_logs_admin_read" ON policy_qa_logs FOR SELECT
  USING (tenant_id = get_user_tenant_id());
