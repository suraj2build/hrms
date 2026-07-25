/**
 * payroll-snapshot-engine.ts
 *
 * Immutable Payroll Snapshot & Replay Engine.
 *
 * Responsibilities:
 *   1. Build deterministic snapshots of ALL payroll inputs at time of finalization.
 *   2. Generate SHA-256 integrity hashes per snapshot blob and for the combined manifest.
 *   3. Validate that stored hashes still match persisted blobs (corruption detection).
 *   4. Replay payroll computations using ONLY snapshot data — never live mutable tables.
 *   5. Compare replay output against original finalized slips and surface variance.
 *
 * Design contract:
 *   - All snapshot blobs are write-once.  This module never updates existing snapshots.
 *   - `replayPayrollRun` reads ONLY from payroll_run_snapshots / payroll_employee_snapshots.
 *     It does NOT query attendance_daily, employee_compensations, salary_components, or any
 *     other live table.  Historical payroll is permanently decoupled from mutable source data.
 *   - All functions are non-throwing at the call site: errors are returned as typed
 *     `{ error }` objects so callers can decide whether to abort or continue.
 */

import { createHash }       from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computePayrollSlip,
  round2,
  type PayrollSlipResult,
} from './payroll-engine.js'
import { fetchAllRows } from './supabase-paginate.js'

// ── Version constants ─────────────────────────────────────────────────────────

export const SNAPSHOT_VERSION           = 1
export const FORMULA_ENGINE_VERSION     = 1
export const VALIDATION_ENGINE_VERSION  = 1

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttendanceSnapshotRow {
  date:             string
  status:           string
  is_payable:       boolean
  day_fraction:     number
  overtime_minutes: number
}

export interface AttendanceSnapshot {
  rows:           AttendanceSnapshotRow[]
  payable_days:   number
  lop_days:       number
  present_days:   number
  late_days:      number
  overtime_hours: number
  has_data:       boolean
  hash:           string
}

export interface CompensationSnapshot {
  compensation_id: string
  effective_from:  string
  ctc_annual:      number
  ctc_monthly:     number
  salary_structure: string | null
  components:      Array<{
    salary_component_id: string
    code:                string
    name:                string
    component_type:      string
    calc_type:           string
    value:               number
    monthly_amount:      number
    annual_amount:       number
    sequence:            number
  }>
  hash: string
}

export interface StatutorySnapshot {
  pf: {
    enabled:           boolean
    employee_rate_pct: number
    employer_rate_pct: number
    wage_ceiling:      number | null
    contribution_basis: string
  }
  esi: {
    enabled:           boolean
    employee_rate_pct: number
    employer_rate_pct: number
    wage_ceiling:      number | null
  }
  pt: {
    enabled: boolean
    state:   string | null
    slabs:   Array<{ from: number; to: number | null; amount: number }>
  }
  tds: {
    enabled:                    boolean
    default_rate:               number
    regime:                     string
    // Approved declaration amounts — populated from tds_declaration_snapshots.
    // Payroll MUST read deductions from here, never from live tax_declarations.
    total_approved_declarations: number
    approved_declarations: Array<{
      declaration_id:       string
      declaration_category: string
      section:              string
      description:          string
      approved_amount:      number
    }>
  }
  hash: string
}

export interface FormulaSnapshot {
  engine_version: number
  component_formulas: Array<{
    code:       string
    calc_type:  string
    value:      number
    expression: string | null
    resolved:   number
  }>
  hash: string
}

export interface ValidationSnapshot {
  engine_version: number
  rules: Array<{
    rule_code: string
    severity:  string
    enabled:   boolean
    threshold: number | null
    description: string | null
  }>
  hash: string
}

export interface EmployeeSnapshotBlob {
  employee_id:           string
  employee_code:         string
  employee_name:         string
  attendance_snapshot:   AttendanceSnapshot
  compensation_snapshot: CompensationSnapshot
  component_snapshot:    { components: CompensationSnapshot['components']; hash: string }
  statutory_snapshot:    StatutorySnapshot
  formula_snapshot:      FormulaSnapshot
  validation_snapshot:   ValidationSnapshot
  gross_pay:             number
  deductions:            number
  net_pay:               number
  payable_days:          number
  lop_days:              number
  overtime_hours:        number
  /** Total calendar working days in the payroll month as used in the original run.
   *  Required for replay: without this, mid-month joiners are mis-calculated because
   *  payable_days + lop_days < total_working_days for that month. */
  total_working_days:    number
  computed_at:           string
}

export interface ReplayVarianceEntry {
  employee_id:         string
  employee_code:       string
  employee_name:       string
  original_net_pay:    number
  replayed_net_pay:    number
  variance_amount:     number
  variance_pct:        number
  original_gross:      number
  replayed_gross:      number
  variance_reason:     string
  changed_dependencies: string[]
}

export interface ReplayResult {
  run_id:           string
  replay_type:      'dry_replay' | 'variance_replay' | 'audit_replay'
  total_employees:  number
  matched:          number
  diverged:         number
  variance_detected: boolean
  employee_diffs:   ReplayVarianceEntry[]
  replayed_at:      string
}

// ── Hash helpers ──────────────────────────────────────────────────────────────

/**
 * Produce a deterministic SHA-256 hex digest of any serialisable value.
 * Keys are sorted before serialisation so object property order never matters.
 */
export function generateSnapshotIntegrityHash(data: unknown): string {
  const canonical = JSON.stringify(data, sortKeysReplacer)
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    )
  }
  return value
}

// ── Attendance snapshot ───────────────────────────────────────────────────────

async function buildAttendanceSnapshot(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  month:      string,
): Promise<AttendanceSnapshot> {
  const [year, mon] = month.split('-').map(Number)
  const from = `${month}-01`
  const to   = new Date(year, mon, 0).toISOString().slice(0, 10)

  const { data: rows, error } = await supabase
    .from('attendance_daily')
    .select('date, status, is_payable, day_fraction, overtime_minutes')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })

  if (error) {
    throw new Error(`attendance snapshot fetch failed for ${employeeId}/${month}: ${error.message}`)
  }

  const daily = (rows ?? []) as AttendanceSnapshotRow[]

  const payable_days   = round2(daily.reduce((s, r) => s + (r.day_fraction ?? 1.0), 0))
  const lop_days       = round2(daily.reduce((s, r) => s + Math.max(0, 1.0 - (r.day_fraction ?? 1.0)), 0))
  const present_days   = daily.filter(r => r.status === 'present' || r.status === 'late').length
  const late_days      = daily.filter(r => r.status === 'late').length
  const overtime_hours = round2(daily.reduce((s, r) => s + (r.overtime_minutes ?? 0), 0) / 60)

  const blob = { rows: daily, payable_days, lop_days, present_days, late_days, overtime_hours, has_data: daily.length > 0 }
  return { ...blob, hash: generateSnapshotIntegrityHash(blob) }
}

// ── Compensation snapshot ─────────────────────────────────────────────────────

async function buildCompensationSnapshot(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
): Promise<CompensationSnapshot | null> {
  const { data: comp, error } = await supabase
    .from('employee_compensations')
    .select(`
      id, effective_from, ctc_annual, ctc_monthly,
      salary_structure_id,
      employee_compensation_components (
        salary_component_id, value, monthly_amount:computed_monthly, annual_amount:computed_annual, sequence,
        salary_components ( id, code, name, component_type, calc_type:default_calculation_type )
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`compensation snapshot fetch failed for ${employeeId}: ${error.message}`)
  }
  if (!comp) return null

  const components = ((comp as any).employee_compensation_components ?? []).map((c: any) => ({
    salary_component_id: c.salary_component_id,
    code:                c.salary_components?.code ?? '',
    name:                c.salary_components?.name ?? '',
    component_type:      c.salary_components?.component_type ?? 'earning',
    calc_type:           c.salary_components?.calc_type ?? 'fixed',
    value:               c.value ?? 0,
    monthly_amount:      c.monthly_amount ?? 0,
    annual_amount:       c.annual_amount ?? 0,
    sequence:            c.sequence ?? 0,
  })).sort((a: any, b: any) => a.sequence - b.sequence)

  const blob = {
    compensation_id:  (comp as any).id,
    effective_from:   (comp as any).effective_from,
    ctc_annual:       (comp as any).ctc_annual,
    ctc_monthly:      (comp as any).ctc_monthly,
    salary_structure: (comp as any).salary_structure_id ?? null,
    components,
  }
  return { ...blob, hash: generateSnapshotIntegrityHash(blob) }
}

// ── Statutory snapshot ────────────────────────────────────────────────────────

async function buildStatutorySnapshot(
  supabase:       SupabaseClient,
  tenantId:       string,
  employeeId?:    string,
  financialYear?: string,
  month?:         string,   // YYYY-MM — needed for state resolution + effective-date guards
): Promise<StatutorySnapshot> {
  const monthDate = month ? `${month}-01` : new Date().toISOString().slice(0, 10)

  // ── Fetch all config in parallel ────────────────────────────────────────────
  const [settingsResult, epfConfigResult, esiConfigResult] = await Promise.all([
    // payroll_statutory_settings — enabled flags for PF / ESI / PT / TDS
    supabase
      .from('payroll_statutory_settings')
      .select('pf_enabled, esi_enabled, pt_enabled, tds_enabled, tds_default_rate, tds_default_regime')
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    // EPF config — most recent version effective for this month
    supabase
      .from('epf_config')
      .select('employee_contribution_pct, employer_pf_pct, employer_eps_pct, wage_ceiling, is_wage_ceiling_applicable')
      .eq('tenant_id', tenantId)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // ESI config — most recent version effective for this month
    supabase
      .from('esi_config')
      .select('employee_contribution_pct, employer_contribution_pct, wage_ceiling')
      .eq('tenant_id', tenantId)
      .lte('effective_from', monthDate)
      .or(`effective_to.is.null,effective_to.gte.${monthDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Fresh audit finding: every query in this function used to be destructured
  // as `.data` only, with `.error` silently discarded. Unlike a live-read
  // path, this feeds payroll_run_snapshots / payroll_employee_snapshots —
  // WRITE-ONCE, immutable audit records. A transient DB error here used to
  // collapse to the same defaults as "not configured" (PF/ESI/PT disabled,
  // no PT state, no TDS declarations), silently baking a wrong statutory
  // config into a record that can never be corrected after the fact. The
  // caller (buildEmployeePayrollSnapshot) already wraps this in try/catch
  // and buildPayrollRunSnapshot already excludes any employee whose snapshot
  // build throws from the run snapshot rather than writing bad data — so
  // throwing here routes through error handling that already exists.
  if (settingsResult.error)  throw new Error(`buildStatutorySnapshot: failed to fetch payroll_statutory_settings: ${settingsResult.error.message}`)
  if (epfConfigResult.error) throw new Error(`buildStatutorySnapshot: failed to fetch epf_config: ${epfConfigResult.error.message}`)
  if (esiConfigResult.error) throw new Error(`buildStatutorySnapshot: failed to fetch esi_config: ${esiConfigResult.error.message}`)

  const settings  = settingsResult.data  as any
  const epfConfig = epfConfigResult.data as any
  const esiConfig = esiConfigResult.data as any

  // ── PTax: resolve employee state and fetch slabs ───────────────────────────
  // State chain: ptax_state_config (manual) → sites.state_code (auto from site)
  let ptaxState: string | null = null
  let ptaxSlabs: Array<{ from: number; to: number | null; amount: number }> = []

  if (employeeId && settings?.pt_enabled) {
    // Check manual state override first
    const { data: manualState, error: manualStateErr } = await supabase
      .from('ptax_state_config')
      .select('state_code')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .lte('effective_from', monthDate)
      .or('effective_to.is.null,effective_to.gte.' + monthDate)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (manualStateErr) throw new Error(`buildStatutorySnapshot: failed to fetch PT state override: ${manualStateErr.message}`)

    if ((manualState as any)?.state_code) {
      ptaxState = (manualState as any).state_code
    } else {
      // Auto-derive from employee → site → state_code
      const { data: empSite, error: empSiteErr } = await supabase
        .from('employees')
        .select('sites(state_code)')
        .eq('id', employeeId)
        .maybeSingle()
      if (empSiteErr) throw new Error(`buildStatutorySnapshot: failed to fetch employee site: ${empSiteErr.message}`)
      ptaxState = (empSite as any)?.sites?.state_code ?? null
    }

    if (ptaxState && financialYear) {
      const { data: slabRows, error: slabErr } = await supabase
        .from('ptax_slabs')
        .select('monthly_income_from, monthly_income_to, monthly_ptax')
        .eq('tenant_id', tenantId)
        .eq('state_code', ptaxState)
        .eq('financial_year', financialYear)
        .eq('is_active', true)

      if (slabErr) throw new Error(`buildStatutorySnapshot: failed to fetch PTax slabs: ${slabErr.message}`)

      ptaxSlabs = ((slabRows ?? []) as any[]).map(r => ({
        from:   r.monthly_income_from,
        to:     r.monthly_income_to ?? null,
        amount: r.monthly_ptax,
      }))
    }
  }

  // ── TDS: approved declarations from immutable snapshot (payroll-safe) ───────
  let approvedDecls: Array<{
    declaration_id:       string
    declaration_category: string
    section:              string
    description:          string
    approved_amount:      number
  }> = []
  let totalApproved = 0

  if (employeeId && financialYear && settings?.tds_enabled) {
    // Prefer latest immutable snapshot over live table
    const { data: latestSnap, error: latestSnapErr } = await supabase
      .from('tds_declaration_snapshots')
      .select('declaration_items, total_approved')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('financial_year', financialYear)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestSnapErr) throw new Error(`buildStatutorySnapshot: failed to fetch TDS declaration snapshot: ${latestSnapErr.message}`)

    if (latestSnap && Array.isArray((latestSnap as any).declaration_items)) {
      // Use immutable snapshot
      approvedDecls = ((latestSnap as any).declaration_items as any[]).map((d: any) => ({
        declaration_id:       d.id,
        declaration_category: d.declaration_category,
        section:              d.section,
        description:          d.description,
        approved_amount:      d.approved_amount ?? 0,
      }))
      totalApproved = (latestSnap as any).total_approved ?? 0
    } else {
      // Fallback: live approved declarations (not recommended for finalized payroll)
      const { data: liveDels, error: liveDelsErr } = await supabase
        .from('tax_declarations')
        .select('id, declaration_category, section, description, approved_amount')
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
        .eq('financial_year', financialYear)
        .eq('status', 'approved')

      if (liveDelsErr) throw new Error(`buildStatutorySnapshot: failed to fetch live tax declarations: ${liveDelsErr.message}`)

      approvedDecls = ((liveDels ?? []) as any[]).map((d: any) => ({
        declaration_id:       d.id,
        declaration_category: d.declaration_category,
        section:              d.section,
        description:          d.description,
        approved_amount:      d.approved_amount ?? 0,
      }))
      totalApproved = approvedDecls.reduce((s, d) => s + d.approved_amount, 0)
    }
  }

  const blob = {
    pf: {
      enabled:            settings?.pf_enabled             ?? false,
      employee_rate_pct:  epfConfig?.employee_contribution_pct ?? 12,
      employer_rate_pct:  (epfConfig?.employer_pf_pct ?? 3.67) + (epfConfig?.employer_eps_pct ?? 8.33),
      wage_ceiling:       epfConfig?.wage_ceiling              ?? 15000,
      contribution_basis: epfConfig?.is_wage_ceiling_applicable ? 'capped' : 'actual',
    },
    esi: {
      enabled:            settings?.esi_enabled             ?? false,
      employee_rate_pct:  esiConfig?.employee_contribution_pct  ?? 0.75,
      employer_rate_pct:  esiConfig?.employer_contribution_pct  ?? 3.25,
      wage_ceiling:       esiConfig?.wage_ceiling               ?? 21000,
    },
    pt: {
      enabled: settings?.pt_enabled ?? false,
      state:   ptaxState,
      slabs:   ptaxSlabs,
    },
    tds: {
      enabled:                     settings?.tds_enabled        ?? false,
      default_rate:                settings?.tds_default_rate   ?? 0,
      regime:                      settings?.tds_default_regime ?? 'new',
      total_approved_declarations:  totalApproved,
      approved_declarations:        approvedDecls,
    },
  }
  return { ...blob, hash: generateSnapshotIntegrityHash(blob) }
}

// ── Validation snapshot ───────────────────────────────────────────────────────

async function buildValidationSnapshot(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<ValidationSnapshot> {
  const { data: rules } = await supabase
    .from('payroll_validation_rules')
    .select('rule_code, severity, is_enabled:enabled, threshold_value:threshold_config, description')
    .eq('tenant_id', tenantId)
    .order('rule_code')

  const mapped = ((rules ?? []) as any[]).map(r => ({
    rule_code:   r.rule_code,
    severity:    r.severity,
    enabled:     r.is_enabled,
    threshold:   r.threshold_value ?? null,
    description: r.description ?? null,
  }))

  const blob = { engine_version: VALIDATION_ENGINE_VERSION, rules: mapped }
  return { ...blob, hash: generateSnapshotIntegrityHash(blob) }
}

// ── Formula snapshot ──────────────────────────────────────────────────────────

function buildFormulaSnapshot(
  components: CompensationSnapshot['components'],
): FormulaSnapshot {
  const formulas = components.map(c => ({
    code:       c.code,
    calc_type:  c.calc_type,
    value:      c.value,
    expression: c.calc_type === 'formula' ? `fixed(${c.value})` : null,
    resolved:   c.monthly_amount,
  }))
  const blob = { engine_version: FORMULA_ENGINE_VERSION, component_formulas: formulas }
  return { ...blob, hash: generateSnapshotIntegrityHash(blob) }
}

// ── Component snapshot ────────────────────────────────────────────────────────

function buildComponentSnapshot(
  components: CompensationSnapshot['components'],
): { components: CompensationSnapshot['components']; hash: string } {
  const blob = { components }
  return { ...blob, hash: generateSnapshotIntegrityHash(blob) }
}

// ── Per-employee snapshot builder ─────────────────────────────────────────────

export async function buildEmployeePayrollSnapshot(
  supabase:    SupabaseClient,
  tenantId:    string,
  employeeId:  string,
  month:       string,
  slipResult:  PayrollSlipResult | null,
): Promise<EmployeeSnapshotBlob | { error: string }> {
  try {
    // Derive financial year from the payroll month (YYYY-MM format)
    const [yearStr, monStr] = month.split('-')
    const yr  = parseInt(yearStr, 10)
    const mon = parseInt(monStr,  10)
    const fyYear = mon >= 4 ? yr : yr - 1
    const financialYear = `${fyYear}-${String(fyYear + 1).slice(2)}`

    const [attSnap, compSnap, statSnap, validSnap] = await Promise.all([
      buildAttendanceSnapshot(supabase, tenantId, employeeId, month),
      buildCompensationSnapshot(supabase, tenantId, employeeId),
      buildStatutorySnapshot(supabase, tenantId, employeeId, financialYear, month),
      buildValidationSnapshot(supabase, tenantId),
    ])

    if (!compSnap) {
      return { error: `No active compensation for employee ${employeeId}` }
    }

    const compBlob   = buildComponentSnapshot(compSnap.components)
    const formulaBlob = buildFormulaSnapshot(compSnap.components)

    // Fetch employee meta for the blob
    const { data: emp } = await supabase
      .from('employees')
      .select('employee_code, profiles!profile_id ( full_name )')
      .eq('id', employeeId)
      .maybeSingle()

    const blob: EmployeeSnapshotBlob = {
      employee_id:           employeeId,
      employee_code:         (emp as any)?.employee_code ?? '',
      employee_name:         (emp as any)?.profiles?.full_name ?? '',
      attendance_snapshot:   attSnap,
      compensation_snapshot: compSnap,
      component_snapshot:    compBlob,
      statutory_snapshot:    statSnap,
      formula_snapshot:      formulaBlob,
      validation_snapshot:   validSnap,
      gross_pay:             slipResult?.gross_pay             ?? 0,
      deductions:            slipResult?.total_deductions       ?? 0,
      net_pay:               slipResult?.net_pay                ?? 0,
      payable_days:          slipResult?.payable_days           ?? attSnap.payable_days,
      lop_days:              slipResult?.lop_days               ?? attSnap.lop_days,
      overtime_hours:        slipResult?.overtime_hours         ?? attSnap.overtime_hours,
      // Captured from payroll_slips.total_working_days so the replay engine can
      // reproduce bit-identical results for mid-month joiners without falling
      // back to the incorrect formula (payable_days + lop_days) or hardcoded 26.
      total_working_days:    slipResult?.total_working_days     ?? 0,
      computed_at:           new Date().toISOString(),
    }
    return blob
  } catch (err: any) {
    return { error: err?.message ?? 'Unknown snapshot build error' }
  }
}

// ── Run-level snapshot builder ────────────────────────────────────────────────

export async function buildPayrollRunSnapshot(
  supabase:  SupabaseClient,
  runId:     string,
  tenantId:  string,
  createdBy: string,
): Promise<{ snapshot_id: string; integrity_hash: string } | { error: string }> {
  // Fetch all finalized slips for this run — paginated to avoid 1000-row ceiling.
  // total_working_days is included so the snapshot can replay correctly for
  // mid-month joiners — without it, replay falls back to payable_days + lop_days
  // which is wrong when the employee joined after the 1st of the month.
  let slips: any[]
  try {
    slips = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_slips')
        .select(`
          employee_id, month, gross_pay, total_deductions, net_pay,
          payable_days, lop_days, overtime_hours, total_working_days,
          employees ( employee_code, profiles!profile_id ( full_name ) )
        `)
        .eq('run_id', runId)
        .eq('tenant_id', tenantId)
        .order('employee_id')
        .range(from, to) as any,
    )
  } catch (slipsErr: any) {
    return { error: `Failed to fetch slips: ${slipsErr.message}` }
  }
  if (slips.length === 0) return { error: 'No slips found for this run' }

  const month = (slips[0] as any).month as string

  // Build per-employee snapshots in parallel (batches of 10 to avoid exhausting connections)
  const BATCH = 10
  const empSnapshots: Array<{ employeeId: string; blob: EmployeeSnapshotBlob | { error: string } }> = []

  for (let i = 0; i < slips.length; i += BATCH) {
    const batch = slips.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (s: any) => {
        const slipResult: PayrollSlipResult = {
          employeeId:             s.employee_id,
          month,
          // Capture total_working_days from the finalized slip so the replay engine
          // can reproduce bit-identical results for mid-month joiners and leavers.
          total_working_days:     s.total_working_days ?? 0,
          payable_days:           s.payable_days ?? 0,
          lop_days:               s.lop_days ?? 0,
          overtime_hours:         s.overtime_hours ?? 0,
          ctc_monthly:            0,
          gross_pay:              s.gross_pay ?? 0,
          lop_amount:             0,
          total_deductions:       s.total_deductions ?? 0,
          net_pay:                s.net_pay ?? 0,
          employer_contributions: 0,
          component_breakdown:    [],
          recovered_recovery_ids: [],
          deferred_recovery_ids:  [],
        }
        const blob = await buildEmployeePayrollSnapshot(supabase, tenantId, s.employee_id, month, slipResult)
        return { employeeId: s.employee_id, blob }
      }),
    )
    empSnapshots.push(...results)
  }

  // Separate successes from errors
  const successful = empSnapshots.filter(e => !('error' in e.blob)) as Array<{ employeeId: string; blob: EmployeeSnapshotBlob }>
  if (successful.length === 0) {
    return { error: 'All employee snapshot builds failed — snapshot not created' }
  }

  // Compute combined integrity hash over all employee blobs
  const sortedBlobs = [...successful].sort((a, b) => a.employeeId.localeCompare(b.employeeId))
  const combinedHash = generateSnapshotIntegrityHash(sortedBlobs.map(e => e.blob))

  // Insert snapshot manifest
  const { data: manifest, error: manifestErr } = await supabase
    .from('payroll_run_snapshots')
    .insert({
      tenant_id:                  tenantId,
      run_id:                     runId,
      month,
      snapshot_version:           SNAPSHOT_VERSION,
      formula_engine_version:     FORMULA_ENGINE_VERSION,
      validation_engine_version:  VALIDATION_ENGINE_VERSION,
      integrity_hash:             combinedHash,
      replayable:                 true,
      created_by:                 createdBy,
    })
    .select('id')
    .single()

  if (manifestErr) return { error: `Failed to insert snapshot manifest: ${manifestErr.message}` }
  const snapshotId = (manifest as any).id as string

  // Insert per-employee snapshot rows (bulk insert in chunks of 50)
  const BULK = 50
  const empRows = successful.map(e => ({
    snapshot_id:           snapshotId,
    tenant_id:             tenantId,
    employee_id:           e.employeeId,
    employee_code:         e.blob.employee_code,
    employee_name:         e.blob.employee_name,
    attendance_snapshot:   e.blob.attendance_snapshot,
    compensation_snapshot: e.blob.compensation_snapshot,
    component_snapshot:    e.blob.component_snapshot,
    statutory_snapshot:    e.blob.statutory_snapshot,
    formula_snapshot:      e.blob.formula_snapshot,
    validation_snapshot:   e.blob.validation_snapshot,
    gross_pay:             e.blob.gross_pay,
    deductions:            e.blob.deductions,
    net_pay:               e.blob.net_pay,
    payable_days:          e.blob.payable_days,
    lop_days:              e.blob.lop_days,
    overtime_hours:        e.blob.overtime_hours,
    total_working_days:    e.blob.total_working_days,
    computed_at:           e.blob.computed_at,
  }))

  for (let i = 0; i < empRows.length; i += BULK) {
    const { error: bulkErr } = await supabase
      .from('payroll_employee_snapshots')
      .insert(empRows.slice(i, i + BULK))
    if (bulkErr) {
      // Non-fatal for the manifest — log but continue.  Snapshot is still partial.
      console.warn(`payroll-snapshot-engine: employee snapshot bulk insert failed (chunk ${i / BULK}): ${bulkErr.message}`)
    }
  }

  // Attach snapshot_id to payroll_runs
  await supabase
    .from('payroll_runs')
    .update({ snapshot_id: snapshotId })
    .eq('id', runId)
    .eq('tenant_id', tenantId)

  return { snapshot_id: snapshotId, integrity_hash: combinedHash }
}

// ── Integrity validation ──────────────────────────────────────────────────────

export async function validateSnapshotIntegrity(
  supabase:    SupabaseClient,
  snapshotId:  string,
  tenantId:    string,
): Promise<{ valid: boolean; stored_hash: string; computed_hash: string; employee_count: number }> {
  const { data: manifest, error: mErr } = await supabase
    .from('payroll_run_snapshots')
    .select('integrity_hash')
    .eq('id', snapshotId)
    .eq('tenant_id', tenantId)
    .single()

  if (mErr || !manifest) {
    return { valid: false, stored_hash: '', computed_hash: '', employee_count: 0 }
  }

  const { data: empSnaps, error: eErr } = await supabase
    .from('payroll_employee_snapshots')
    .select(`
      employee_id, attendance_snapshot, compensation_snapshot,
      component_snapshot, statutory_snapshot, formula_snapshot,
      validation_snapshot, gross_pay, deductions, net_pay
    `)
    .eq('snapshot_id', snapshotId)
    .eq('tenant_id', tenantId)
    .order('employee_id')

  if (eErr || !empSnaps) {
    return { valid: false, stored_hash: (manifest as any).integrity_hash, computed_hash: '', employee_count: 0 }
  }

  const sortedBlobs = (empSnaps as any[]).sort((a, b) => a.employee_id.localeCompare(b.employee_id))
  const computedHash = generateSnapshotIntegrityHash(
    sortedBlobs.map(s => ({
      employee_id:           s.employee_id,
      attendance_snapshot:   s.attendance_snapshot,
      compensation_snapshot: s.compensation_snapshot,
      component_snapshot:    s.component_snapshot,
      statutory_snapshot:    s.statutory_snapshot,
      formula_snapshot:      s.formula_snapshot,
      validation_snapshot:   s.validation_snapshot,
      gross_pay:             s.gross_pay,
      deductions:            s.deductions,
      net_pay:               s.net_pay,
    })),
  )

  const storedHash = (manifest as any).integrity_hash as string
  return {
    valid:          storedHash === computedHash,
    stored_hash:    storedHash,
    computed_hash:  computedHash,
    employee_count: sortedBlobs.length,
  }
}

// ── Replay engine ─────────────────────────────────────────────────────────────

/**
 * Replay a finalized payroll run using ONLY snapshot data.
 *
 * This is the core determinism guarantee: given the same snapshot inputs,
 * `computePayrollSlip` must produce bit-identical outputs to the originals.
 * Any divergence signals that either:
 *   (a) the payroll engine logic changed (formula_engine_version bump needed), or
 *   (b) the snapshot was mutated (integrity failure), or
 *   (c) the original run had environment-specific non-determinism.
 */
export async function replayPayrollRun(
  supabase:    SupabaseClient,
  runId:       string,
  tenantId:    string,
  replayType:  'dry_replay' | 'variance_replay' | 'audit_replay',
  triggeredBy: string,
): Promise<ReplayResult | { error: string }> {
  // 1. Load snapshot manifest
  const { data: manifest, error: mErr } = await supabase
    .from('payroll_run_snapshots')
    .select('id, integrity_hash, replayable, month')
    .eq('run_id', runId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (mErr)     return { error: `Snapshot manifest query failed: ${mErr.message}` }
  if (!manifest) return { error: 'No snapshot found for this run — run must be finalized with snapshot creation enabled' }
  if (!(manifest as any).replayable) return { error: 'Snapshot is marked non-replayable (archived or corrupted)' }

  const snapshotId = (manifest as any).id as string

  // 2. Load employee snapshots (paginated — one row per employee, can exceed max-rows)
  let empSnaps: any[]
  try {
    empSnaps = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_employee_snapshots')
        .select('*')
        .eq('snapshot_id', snapshotId)
        .eq('tenant_id', tenantId)
        .order('employee_id')
        .range(from, to),
    )
  } catch (eErr: any) {
    return { error: `Employee snapshot query failed: ${eErr.message}` }
  }
  if (empSnaps.length === 0) return { error: 'No employee snapshots found' }

  // 3. Load original slips for comparison (paginated — one row per employee)
  let originalSlips: any[]
  try {
    originalSlips = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_slips')
        .select('employee_id, gross_pay, total_deductions, net_pay, payable_days, lop_days')
        .eq('run_id', runId)
        .eq('tenant_id', tenantId)
        .order('employee_id')
        .range(from, to),
    )
  } catch {
    originalSlips = []
  }

  const slipMap = new Map<string, any>(originalSlips.map((s: any) => [s.employee_id, s]))

  // 4. Replay computation for every employee using ONLY snapshot data
  const diffs: ReplayVarianceEntry[] = []
  let matched = 0

  for (const empSnap of empSnaps as any[]) {
    const compSnap = empSnap.compensation_snapshot as CompensationSnapshot | null
    if (!compSnap) continue

    // Reconstruct PayrollSlipInput entirely from snapshot — zero live queries
    const slipInput = {
      tenantId,
      employeeId: empSnap.employee_id,
      month:      (manifest as any).month,
      compensation: {
        id:          compSnap.compensation_id,
        ctc_monthly: compSnap.ctc_monthly,
        ctc_annual:  compSnap.ctc_annual,
        components:  compSnap.components.map((c: any) => ({
          salary_component_id: c.salary_component_id,
          name:                c.name,
          code:                c.code,
          component_type:      c.component_type as 'earning' | 'deduction' | 'employer_contribution',
          calc_type:           c.calc_type,
          value:               c.value,
          monthly_amount:      c.monthly_amount,
          annual_amount:       c.annual_amount,
          sequence:            c.sequence,
        })),
      },
      attendance: {
        payable_days:       empSnap.attendance_snapshot?.payable_days       ?? 0,
        lop_days:           empSnap.attendance_snapshot?.lop_days           ?? 0,
        present_days:       empSnap.attendance_snapshot?.present_days       ?? 0,
        late_days:          empSnap.attendance_snapshot?.late_days          ?? 0,
        overtime_hours:     empSnap.attendance_snapshot?.overtime_hours     ?? 0,
        has_attendance_data: empSnap.attendance_snapshot?.has_data           ?? false,
      },
      // Use snapshotted total_working_days for bit-identical replay.
      // Fallback: payable_days + lop_days (incorrect for mid-month joiners but
      // safe for full-month employees); final fallback 26 for legacy snapshots
      // created before migration 170 added the total_working_days column.
      total_working_days: empSnap.total_working_days > 0
        ? empSnap.total_working_days
        : (empSnap.payable_days + empSnap.lop_days) || 26,
    }

    const replayed   = computePayrollSlip(slipInput)
    const original   = slipMap.get(empSnap.employee_id)

    const origNet    = original?.net_pay        ?? empSnap.net_pay   ?? 0
    const origGross  = original?.gross_pay      ?? empSnap.gross_pay ?? 0
    const replayNet  = replayed.net_pay
    const replayGross = replayed.gross_pay

    const netDiff    = round2(replayNet - origNet)
    const grossDiff  = round2(replayGross - origGross)
    const isMatch    = Math.abs(netDiff) < 0.01 && Math.abs(grossDiff) < 0.01

    if (isMatch) {
      matched++
    } else {
      const changedDeps: string[] = []
      if (Math.abs(replayGross - origGross) >= 0.01) changedDeps.push('compensation/components')
      if (Math.abs((replayed.lop_amount) - (original?.lop_amount ?? 0)) >= 0.01) changedDeps.push('attendance')
      if (Math.abs(replayed.total_deductions - (original?.total_deductions ?? 0)) >= 0.01) changedDeps.push('deductions')

      diffs.push({
        employee_id:          empSnap.employee_id,
        employee_code:        empSnap.employee_code ?? '',
        employee_name:        empSnap.employee_name ?? '',
        original_net_pay:     origNet,
        replayed_net_pay:     replayNet,
        variance_amount:      netDiff,
        variance_pct:         origNet > 0 ? round2((netDiff / origNet) * 100) : 0,
        original_gross:       origGross,
        replayed_gross:       replayGross,
        variance_reason:      changedDeps.length > 0
          ? `Divergence in: ${changedDeps.join(', ')}`
          : 'Unexplained variance — check engine version',
        changed_dependencies: changedDeps,
      })
    }
  }

  const result: ReplayResult = {
    run_id:            runId,
    replay_type:       replayType,
    total_employees:   empSnaps.length,
    matched,
    diverged:          diffs.length,
    variance_detected: diffs.length > 0,
    employee_diffs:    diffs,
    replayed_at:       new Date().toISOString(),
  }

  // 5. Persist replay session
  const sessionRow = {
    tenant_id:        tenantId,
    run_id:           runId,
    snapshot_id:      snapshotId,
    replay_type:      replayType,
    triggered_by:     triggeredBy,
    result_status:    diffs.length > 0 ? 'variance_found' : 'success',
    variance_detected: diffs.length > 0,
    variance_summary: {
      total: empSnaps.length,
      matched,
      diverged: diffs.length,
    },
    employee_diffs: diffs.length > 0 ? diffs : null,
    completed_at:   result.replayed_at,
  }

  await supabase.from('payroll_replay_sessions').insert(sessionRow)

  return result
}

// ── Compare replay results ────────────────────────────────────────────────────

export function compareReplayResults(
  original: Array<{ employee_id: string; net_pay: number; gross_pay: number }>,
  replayed: Array<{ employeeId: string; net_pay: number; gross_pay: number }>,
): ReplayVarianceEntry[] {
  const replayedMap = new Map(replayed.map(r => [r.employeeId, r]))

  return original.flatMap(o => {
    const r = replayedMap.get(o.employee_id)
    if (!r) return []
    const netDiff = round2(r.net_pay - o.net_pay)
    if (Math.abs(netDiff) < 0.01) return []
    return [{
      employee_id:          o.employee_id,
      employee_code:        '',
      employee_name:        '',
      original_net_pay:     o.net_pay,
      replayed_net_pay:     r.net_pay,
      variance_amount:      netDiff,
      variance_pct:         o.net_pay > 0 ? round2((netDiff / o.net_pay) * 100) : 0,
      original_gross:       o.gross_pay,
      replayed_gross:       r.gross_pay,
      variance_reason:      'Net pay divergence detected',
      changed_dependencies: [],
    }]
  })
}

export function buildPayrollReplayVariance(
  original: PayrollSlipResult,
  replayed: PayrollSlipResult,
): ReplayVarianceEntry {
  const netDiff   = round2(replayed.net_pay - original.net_pay)
  const grossDiff = round2(replayed.gross_pay - original.gross_pay)
  const deps: string[] = []
  if (Math.abs(grossDiff) >= 0.01)                                     deps.push('compensation/components')
  if (Math.abs(replayed.lop_amount - original.lop_amount) >= 0.01)    deps.push('attendance')
  if (Math.abs(replayed.total_deductions - original.total_deductions) >= 0.01) deps.push('deductions')

  return {
    employee_id:          original.employeeId,
    employee_code:        '',
    employee_name:        '',
    original_net_pay:     original.net_pay,
    replayed_net_pay:     replayed.net_pay,
    variance_amount:      netDiff,
    variance_pct:         original.net_pay > 0 ? round2((netDiff / original.net_pay) * 100) : 0,
    original_gross:       original.gross_pay,
    replayed_gross:       replayed.gross_pay,
    variance_reason:      deps.length > 0 ? `Divergence in: ${deps.join(', ')}` : 'No variance',
    changed_dependencies: deps,
  }
}
