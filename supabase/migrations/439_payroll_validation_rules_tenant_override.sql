-- ============================================================
-- 439_payroll_validation_rules_tenant_override.sql
--
-- Resolves the tenant-vs-global ownership fork on payroll_validation_rules
-- flagged in docs/production-readiness/STATUS.md ("Tenant vs. global
-- ownership — the one decision this pass deliberately did NOT make").
-- Decision (made by product, not engineering, this migration implements it):
--
--   Global defaults, with tenant-specific overrides, resolved explicitly by
--   rule code. Tenant admins may override a platform default's severity/
--   blocking/enabled for their own tenant; they can never modify the global
--   default row itself (that stays platform-admin-only, unchanged from
--   migration 143's `pvr_super_admin_write` RLS policy).
--
-- This column set (code/name/description/severity/blocking/enabled/stage/
-- remediation_route — added by migration 143) is a SEPARATE concern from
-- payroll_validation_rules' OTHER column set (rule_code/category/is_active/
-- threshold_config/auto_resolve — migration 105), which apps/api/src/routes/
-- payroll/validation.ts's /rules CRUD already uses correctly: every row it
-- creates and reads is tenant-owned and consistently filtered by tenant_id,
-- with no ownership ambiguity. That feature is NOT touched by this
-- migration. This migration only resolves the 143-column-set rules
-- consumed by payroll-blocker-engine.ts and apps/api/src/routes/payroll/
-- validation-rules.ts (the Resolution Center's rule-toggle UI).
--
-- Mechanics:
--   1. Replace the global UNIQUE(code) constraint — which made it
--      structurally impossible for any tenant to ever own a row sharing a
--      global rule's code — with UNIQUE NULLS NOT DISTINCT (tenant_id, code):
--      exactly one global row (tenant_id IS NULL) per code, and exactly one
--      override row per (tenant_id, code) for any number of tenants.
--   2. Seed the missing UNKNOWN_FAILURE global default row. It was the one
--      fallback rule_code classifyFailureRuleCode() can return
--      (payroll-blocker-engine.ts) with no corresponding seeded row —
--      previously the one gap through which a hypothetical tenant-owned row
--      (if one were ever created) could have leaked into another tenant's
--      blocker enrichment, because there was no global row of that code to
--      correctly take precedence over. Closed outright, independent of
--      which tenant does or doesn't define its own override.
-- ============================================================

-- ── 1. Replace the uniqueness model ─────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'payroll_validation_rules'::regclass
      AND conname = 'payroll_validation_rules_code_key'
  ) THEN
    ALTER TABLE payroll_validation_rules DROP CONSTRAINT payroll_validation_rules_code_key;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'payroll_validation_rules'::regclass
      AND conname = 'payroll_validation_rules_tenant_code_key'
  ) THEN
    ALTER TABLE payroll_validation_rules
      ADD CONSTRAINT payroll_validation_rules_tenant_code_key
      UNIQUE NULLS NOT DISTINCT (tenant_id, code);
  END IF;
END$$;

-- ── 2. Seed the missing UNKNOWN_FAILURE global default ─────────────────────
INSERT INTO payroll_validation_rules
  (code, name, description, severity, blocking, enabled, stage, remediation_route)
VALUES
  (
    'UNKNOWN_FAILURE',
    'Unknown Failure',
    'An unexpected error occurred during payroll computation that did not match any '
    'known validation rule pattern. Use the Payroll Investigation tool to diagnose.',
    'critical', true, true,
    'unexpected',
    '/admin/payroll/investigate'
  )
ON CONFLICT (tenant_id, code) DO NOTHING;

COMMENT ON TABLE payroll_validation_rules IS
  'Two independent concerns share this table. (1) rule_code/category/is_active/'
  'threshold_config/auto_resolve (migration 105) — tenant-owned custom validation '
  'rules, always tenant_id-filtered, see routes/payroll/validation.ts. '
  '(2) code/name/description/severity/blocking/enabled/stage/remediation_route '
  '(migration 143) — platform default payroll-blocker-classification rules '
  '(tenant_id IS NULL) with optional per-tenant overrides (tenant_id = owning '
  'tenant, same code) as of migration 439. Resolve (2) by code with tenant rows '
  'shadowing global ones — never read tenant_id IS NULL rows and tenant-owned '
  'rows as if they were the same list without merging by code first.';
