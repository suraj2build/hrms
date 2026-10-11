-- ============================================================
-- 440_public_recruitment_intake.sql
--
-- The recruitment/ATS pipeline (requisition → candidate → application →
-- offer → hire) is genuinely deep, but every candidate/application-creation
-- route is hrAdminAuth-gated — there is no careers page and no public apply
-- form anywhere. A customer cannot run live hiring through CognixHR today;
-- they can only track candidates someone already sourced through another
-- channel.
--
-- This adds the one column the public careers routes need: an explicit,
-- HR-opted-in flag for "safe to advertise externally". `status = 'open'`
-- alone is not a public-visibility flag — a tenant may have an open
-- requisition they don't want to list on a public job board (e.g. a
-- confidential backfill), so listing requires BOTH status = 'open' AND
-- is_public = true.
-- ============================================================

ALTER TABLE job_requisitions
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- Partial index — the only query shape the public careers routes run is
-- "open + public requisitions for this tenant".
CREATE INDEX IF NOT EXISTS idx_job_requisitions_public
  ON job_requisitions (tenant_id)
  WHERE is_public = true AND status = 'open';
