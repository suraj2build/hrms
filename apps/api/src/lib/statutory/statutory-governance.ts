/**
 * Statutory Governance Service
 *
 * Single source of truth for resolving statutory parameters for an employee
 * for a given payroll month.  Used by:
 *   - EPF compute route
 *   - ESI compute route
 *   - PTax compute route
 *   - Payroll snapshot engine
 *
 * Resolution chain:
 *   Employee → site_id → sites.state_code → PTax jurisdiction
 *   Employee → site_id → statutory_registrations → registration numbers
 *   Employee → epf_eligibility_overrides → EPF applicability
 *   Employee → employee_statutory_overrides → ESI / PTax exemptions
 *   Tenant   → epf_config (effective_from <= :month) → EPF rates
 *   Tenant   → esi_config (effective_from <= :month) → ESI rates
 *   State    → ptax_slabs (financial_year, state_code) → PTax slabs
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EPFConfig } from './epf-engine.js'
import type { ESIConfig } from './esi-engine.js'
import type { PTaxSlab } from './ptax-engine.js'
import { DEFAULT_EPF_CONFIG } from './epf-engine.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EPFApplicability {
  isApplicable:          boolean
  isExempt:              boolean
  exemptionReason:       string | null
  voluntaryPfPct:        number
  isInternationalWorker: boolean
  higherPfOpted:         boolean
  higherPfPct:           number
  uan:                   string | null
  /** Employee-level ceiling override (migration 170).
   *  null  = follow tenant policy (isWageCeilingApplicable in EPFConfig).
   *  true  = always restrict PF wages to statutory ceiling.
   *  false = never restrict PF wages to ceiling (international/CXO). */
  restrictPfToCeiling:   boolean | null
}

export interface ESIApplicability {
  isApplicable: boolean
  isExempt:     boolean
  exemptReason: string | null
}

export interface PTaxApplicability {
  isApplicable: boolean
  isExempt:     boolean
  exemptReason: string | null
  stateCode:    string | null
  slabs:        PTaxSlab[]
  registration: string | null
}

export interface StatutoryRegistrations {
  epf: string | null
  esi: string | null
  ptax: string | null
}

export interface EmployeeStatutoryParams {
  employeeId:      string
  payrollMonth:    string    // YYYY-MM
  siteId:          string | null
  stateCode:       string | null
  epfConfig:       EPFConfig
  epfApplicability: EPFApplicability
  esiConfig:       ESIConfig
  esiApplicability: ESIApplicability
  ptaxApplicability: PTaxApplicability
  registrations:   StatutoryRegistrations
  financialYear:   string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthToFY(month: string): string {
  const [yr, mon] = month.split('-').map(Number)
  const fyStart = mon >= 4 ? yr : yr - 1
  return `${fyStart}-${String(fyStart + 1).slice(2)}`
}

// The effective date guard: find the most recent config row where
// effective_from <= payrollMonth AND (effective_to IS NULL OR effective_to >= payrollMonth)
function buildDateGuardedQuery(q: any, month: string) {
  const dateStr = `${month}-01`  // first day of payroll month
  return q
    .lte('effective_from', dateStr)
    .or(`effective_to.is.null,effective_to.gte.${dateStr}`)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveEmployeeStatutoryParams(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  month:       string,  // YYYY-MM
): Promise<EmployeeStatutoryParams> {
  const financialYear = monthToFY(month)
  const monthDate     = `${month}-01`

  // ── Fetch in parallel: employee+site, config rows, overrides ─────────────────
  const [
    empResult,
    epfConfigResult,
    esiConfigResult,
    epfOverrideResult,
    esiOverrideResult,
    ptaxOverrideResult,
  ] = await Promise.all([
    // Employee + site + state_code
    supabase
      .from('employees')
      .select('id, site_id, sites(id, state_code)')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    // EPF config — most recent version effective for this month
    buildDateGuardedQuery(
      supabase.from('epf_config').select('*').eq('tenant_id', tenantId),
      month,
    ),

    // ESI config — most recent version effective for this month
    buildDateGuardedQuery(
      supabase.from('esi_config').select('*').eq('tenant_id', tenantId),
      month,
    ),

    // EPF eligibility override — use the LATEST override for this employee regardless
    // of when it was set. An HR admin setting "Actual (uncapped)" today must apply to
    // any re-run of a prior month — filtering by effective_from <= monthDate blocks
    // overrides saved after the payroll period and silently falls back to default.
    supabase
      .from('epf_eligibility_overrides')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // ESI exemption override
    supabase
      .from('employee_statutory_overrides')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .eq('statutory_type', 'esi')
      .eq('is_exempt', true)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .limit(1)
      .maybeSingle(),

    // PTax exemption override
    supabase
      .from('employee_statutory_overrides')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .eq('statutory_type', 'ptax')
      .eq('is_exempt', true)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .limit(1)
      .maybeSingle(),
  ])

  const emp      = empResult.data as any
  const siteId   = emp?.site_id ?? null
  const stateCode = (emp?.sites as any)?.state_code ?? null

  // ── EPF config ───────────────────────────────────────────────────────────────
  const epfRow = epfConfigResult.data as any
  const epfConfig: EPFConfig = epfRow ? {
    employeeContributionPct: epfRow.employee_contribution_pct ?? 12,
    employerPfPct:           epfRow.employer_pf_pct           ?? 3.67,
    employerEpsPct:          epfRow.employer_eps_pct          ?? 8.33,
    wageCeiling:             epfRow.wage_ceiling              ?? 15000,
    isWageCeilingApplicable: epfRow.is_wage_ceiling_applicable ?? true,
    allowVoluntaryPf:        epfRow.allow_voluntary_pf         ?? false,
    edliRatePct:             epfRow.edli_rate_pct              ?? 0.5,
    edliCap:                 epfRow.edli_cap                   ?? 75,
    edliFloor:               epfRow.edli_floor                 ?? 25,
    adminChargesPct:         epfRow.admin_charges_pct          ?? 0.50,
  } : DEFAULT_EPF_CONFIG

  // ── EPF applicability ─────────────────────────────────────────────────────────
  const epfOverride = epfOverrideResult.data as any
  const epfApplicability: EPFApplicability = {
    isApplicable:          epfOverride?.is_epf_applicable       ?? true,
    isExempt:              epfOverride?.is_exempt                ?? false,
    exemptionReason:       epfOverride?.exemption_reason         ?? null,
    voluntaryPfPct:        epfOverride?.voluntary_pf_pct         ?? 0,
    isInternationalWorker: epfOverride?.is_international_worker  ?? false,
    higherPfOpted:         epfOverride?.higher_pf_opted          ?? false,
    higherPfPct:           epfOverride?.higher_pf_pct            ?? 12,
    uan:                   epfOverride?.uan                      ?? null,
    // Employee-level ceiling restriction (migration 170).
    // epfOverride?.restrict_pf_to_ceiling is BOOLEAN | NULL from DB.
    // Use ?? null (not ?? false) to preserve the three-way semantics.
    restrictPfToCeiling:   epfOverride?.restrict_pf_to_ceiling   ?? null,
  }
  // Exempt employee → not applicable
  if (epfApplicability.isExempt) epfApplicability.isApplicable = false

  // ── ESI config ───────────────────────────────────────────────────────────────
  const esiRow = esiConfigResult.data as any
  const esiConfig: ESIConfig = esiRow ? {
    employeeContributionPct: esiRow.employee_contribution_pct ?? 0.75,
    employerContributionPct: esiRow.employer_contribution_pct ?? 3.25,
    wageCeiling:             esiRow.wage_ceiling              ?? 21000,
  } : {
    employeeContributionPct: 0.75,
    employerContributionPct: 3.25,
    wageCeiling:             21000,
  }

  // ── ESI applicability ─────────────────────────────────────────────────────────
  const esiExempt  = esiOverrideResult.data as any
  const esiApplicability: ESIApplicability = {
    isApplicable: !esiExempt,
    isExempt:     !!esiExempt,
    exemptReason: esiExempt?.exemption_reason ?? null,
  }

  // ── PTax: slabs + registration ─────────────────────────────────────────────
  // State derived from: employee_statutory_overrides.state_code (if set)
  // → ptax_state_config (manual override)
  // → sites.state_code (auto, primary)
  let resolvedState = stateCode

  // Check ptax_state_config (manual assignment overrides site)
  const { data: ptaxStateRow } = await supabase
    .from('ptax_state_config')
    .select('state_code')
    .eq('employee_id', employeeId)
    .eq('tenant_id', tenantId)
    .lte('effective_from', monthDate)
    .or('effective_to.is.null,effective_to.gte.' + monthDate)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if ((ptaxStateRow as any)?.state_code) {
    resolvedState = (ptaxStateRow as any).state_code
  }

  // Fetch PTax slabs for resolved state
  let ptaxSlabs: PTaxSlab[] = []
  if (resolvedState) {
    const { data: slabRows } = await supabase
      .from('ptax_slabs')
      .select('monthly_income_from, monthly_income_to, monthly_ptax, frequency, deduction_month')
      .eq('tenant_id', tenantId)
      .eq('state_code', resolvedState)
      .eq('financial_year', financialYear)
      .eq('is_active', true)

    ptaxSlabs = ((slabRows ?? []) as any[]).map(r => ({
      monthlyIncomeFrom: r.monthly_income_from,
      monthlyIncomeTo:   r.monthly_income_to ?? undefined,
      monthlyPtax:       r.monthly_ptax,
      frequency:         r.frequency ?? 'monthly',
      deductionMonth:    r.deduction_month ?? undefined,
    }))
  }

  const ptaxExempt = ptaxOverrideResult.data as any
  const ptaxApplicability: PTaxApplicability = {
    isApplicable: !ptaxExempt && !!resolvedState && ptaxSlabs.length > 0,
    isExempt:     !!ptaxExempt,
    exemptReason: ptaxExempt?.exemption_reason ?? null,
    stateCode:    resolvedState,
    slabs:        ptaxSlabs,
    registration: null,  // populated below
  }

  // ── Statutory registrations (site-level) ──────────────────────────────────
  // Look up by (tenant, site), fallback to (tenant, null) for tenant-level reg
  const regTypes: Array<'epf' | 'esi' | 'ptax'> = ['epf', 'esi', 'ptax']
  const registrations: StatutoryRegistrations = { epf: null, esi: null, ptax: null }

  const { data: regRows } = await supabase
    .from('statutory_registrations')
    .select('statutory_type, registration_number, site_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('effective_from', monthDate)
    .or('effective_to.is.null,effective_to.gte.' + monthDate)
    .in('statutory_type', regTypes)
    .or(siteId ? `site_id.eq.${siteId},site_id.is.null` : 'site_id.is.null')

  // Prefer site-specific registration over tenant-level (site_id NOT NULL wins)
  for (const type of regTypes) {
    const rows = ((regRows ?? []) as any[]).filter(r => r.statutory_type === type)
    const siteSpecific = rows.find(r => r.site_id === siteId)
    const tenantLevel  = rows.find(r => r.site_id === null)
    const best = siteSpecific ?? tenantLevel
    if (best) (registrations as any)[type] = best.registration_number
  }

  ptaxApplicability.registration = registrations.ptax

  return {
    employeeId,
    payrollMonth:     month,
    siteId,
    stateCode:        resolvedState,
    epfConfig,
    epfApplicability,
    esiConfig,
    esiApplicability,
    ptaxApplicability,
    registrations,
    financialYear,
  }
}
