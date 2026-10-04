/**
 * payroll-validation-rules.ts
 *
 * Resolves payroll_validation_rules' "platform default + tenant override"
 * ownership model (migration 439; see docs/production-readiness/STATUS.md
 * "Tenant vs. global ownership"). Global default rows have tenant_id IS
 * NULL; a tenant may define its own override row with the same `code` —
 * migration 439's UNIQUE NULLS NOT DISTINCT (tenant_id, code) allows exactly
 * one of each. A tenant override always shadows the global default for the
 * same code; it never merges field-by-field.
 *
 * This only concerns the code/name/description/severity/blocking/enabled/
 * stage/remediation_route column set (migration 143), consumed by
 * payroll-blocker-engine.ts and the Resolution Center's rule-toggle UI. It
 * has nothing to do with payroll_validation_rules' OTHER column set
 * (rule_code/category/is_active/threshold_config — migration 105), which
 * routes/payroll/validation.ts's tenant-owned custom-rule CRUD already uses
 * correctly and is untouched by this file.
 */

export interface ResolvedValidationRule {
  id:                string
  code:              string
  name:              string
  description:       string
  severity:          'critical' | 'warning' | 'info'
  blocking:          boolean
  enabled:           boolean
  stage:             string
  remediation_route: string | null
  /** true when this row is the tenant's own override; false for an unmodified global default */
  is_override:       boolean
}

const SELECT_COLS = 'id, tenant_id, code, name, description, severity, blocking, enabled, stage, remediation_route'

/**
 * Fetch the resolved rule set for a tenant: every global default, with any
 * matching tenant override (same code) substituted in place of the global
 * row it shadows. Pass `enabledOnly: true` to drop disabled rules — matches
 * payroll-blocker-engine.ts's own "skip disabled rules" convention.
 */
export async function fetchResolvedValidationRules(
  supabase: any,
  tenantId: string,
  opts: { enabledOnly?: boolean } = {},
): Promise<ResolvedValidationRule[]> {
  let globalQuery = supabase.from('payroll_validation_rules').select(SELECT_COLS).is('tenant_id', null)
  let tenantQuery  = supabase.from('payroll_validation_rules').select(SELECT_COLS).eq('tenant_id', tenantId)
  if (opts.enabledOnly) {
    globalQuery = globalQuery.eq('enabled', true)
    tenantQuery = tenantQuery.eq('enabled', true)
  }

  const [{ data: globalRows, error: globalErr }, { data: tenantRows, error: tenantErr }] = await Promise.all([
    globalQuery,
    tenantQuery,
  ])
  if (globalErr) throw globalErr
  if (tenantErr) throw tenantErr

  const resolved = new Map<string, ResolvedValidationRule>()
  for (const r of globalRows ?? []) {
    resolved.set(r.code, { ...r, is_override: false })
  }
  // Tenant overrides are applied second so they shadow the global row of
  // the same code — never merged field-by-field with it.
  for (const r of tenantRows ?? []) {
    resolved.set(r.code, { ...r, is_override: true })
  }

  return [...resolved.values()]
}

/**
 * Create or update the calling tenant's override for a rule `code`.
 * Never writes the global (tenant_id IS NULL) row — that stays
 * platform-admin-only (migration 143's pvr_super_admin_write RLS policy).
 *
 * If the tenant has no existing override for this code, the global
 * default's name/description/stage/remediation_route are carried over so
 * the new override row is complete; `patch` is then applied on top.
 */
export async function upsertTenantValidationRuleOverride(
  supabase: any,
  tenantId: string,
  code: string,
  patch: { enabled?: boolean; blocking?: boolean; severity?: 'critical' | 'warning' | 'info' },
): Promise<{ data: ResolvedValidationRule | null; error: unknown }> {
  const { data: globalRule, error: globalErr } = await supabase
    .from('payroll_validation_rules')
    .select(SELECT_COLS)
    .is('tenant_id', null)
    .eq('code', code)
    .maybeSingle()
  if (globalErr) return { data: null, error: globalErr }
  if (!globalRule) return { data: null, error: { message: `No global validation rule with code ${code}` } }

  const { data: existingOverride } = await supabase
    .from('payroll_validation_rules')
    .select(SELECT_COLS)
    .eq('tenant_id', tenantId)
    .eq('code', code)
    .maybeSingle()

  const base = existingOverride ?? globalRule
  const { data, error } = await supabase
    .from('payroll_validation_rules')
    .upsert(
      {
        tenant_id:         tenantId,
        code,
        name:              base.name,
        description:       base.description,
        stage:             base.stage,
        remediation_route: base.remediation_route,
        severity:          patch.severity ?? base.severity,
        blocking:          patch.blocking ?? base.blocking,
        enabled:           patch.enabled ?? base.enabled,
      },
      { onConflict: 'tenant_id,code' },
    )
    .select(SELECT_COLS)
    .single()

  if (error) return { data: null, error }
  return { data: { ...data, is_override: true }, error: null }
}
