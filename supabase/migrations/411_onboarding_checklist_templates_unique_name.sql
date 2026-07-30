-- ============================================================
-- 411_onboarding_checklist_templates_unique_name.sql
--
-- PEND-63 (AUDIT_CONSTITUTION.md §14.6): POST /onboarding/seed-default-templates
-- guards re-seeding with a plain count-then-insert — no unique constraint
-- backs the "skip if already seeded" check. Two concurrent clicks (double
-- click, two tabs) can both pass the count check and both fully seed all 3
-- default templates + their checklist items, duplicating the tenant's
-- onboarding template library.
--
-- Fix: a unique constraint on (tenant_id, name) makes the second concurrent
-- insert of each template fail atomically at the database. The route
-- switches to .upsert(..., { ignoreDuplicates: true }) per template so the
-- loser of the race silently skips already-created templates instead of
-- erroring or duplicating.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_checklist_templates_tenant_name
  ON onboarding_checklist_templates (tenant_id, name);
