// ── Universal Master Import Framework — Importer ─────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import { validateImportRows }  from './validator.js'
import type { ValidatedRow }   from './validator.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ImportMode = 'create_only' | 'update_only' | 'upsert' | 'validate_only'

export interface ImportResult {
  importJobId: string
  created: number
  updated: number
  failed: number
  skipped: number
  duration_ms: number
}

// ── Table config ──────────────────────────────────────────────────────────────

interface TableConfig {
  table: string
  uniqueColumn: string
  mapRow: (tenantId: string, norm: Record<string, unknown>) => Record<string, unknown>
}

/** Map weekly-off day tokens (names or 0–6 numbers) to a sorted unique int array. */
const DAY_NAME_TO_NUM: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, tues: 2,
  wed: 3, wednesday: 3, thu: 4, thursday: 4, thur: 4, thurs: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
}
function parseWeeklyOffDays(input: unknown): number[] {
  if (input == null || input === '') return []
  const tokens = String(input).split(/[,;|/]+/).map((t) => t.trim()).filter(Boolean)
  const out = new Set<number>()
  for (const tok of tokens) {
    const lower = tok.toLowerCase()
    if (lower in DAY_NAME_TO_NUM) { out.add(DAY_NAME_TO_NUM[lower]); continue }
    const n = Number(tok)
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Slugify a master name → url-safe slug, matching the departments CRUD route
 * (apps/api/src/routes/departments/index.ts). Used to satisfy the NOT-NULL
 * `slug` column that the importer previously omitted.
 */
function slugifyName(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const TABLE_MAP: Record<string, TableConfig> = {
  employees: {
    table: 'employees',
    uniqueColumn: 'employee_code',
    mapRow: (tenantId, norm) => ({
      tenant_id:       tenantId,
      employee_code:   norm.employee_code,
      first_name:      norm.first_name,
      last_name:       norm.last_name,
      email:           norm.email,
      phone:           norm.phone ?? null,
      joining_date:    norm.joining_date,
      status:          norm.status ?? 'active',
    }),
  },

  shifts: {
    table: 'shifts',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:      tenantId,
      code:           norm.code,
      name:           norm.name,
      start_time:     norm.start_time,
      end_time:       norm.end_time,
      grace_minutes:  norm.grace_minutes ?? 0,
      is_night_shift: norm.is_night_shift ?? false,
      // weekly_off_days intentionally omitted — shifts carry timing rules only.
      // Configure weekly-off days on Roster templates instead.
    }),
  },

  rosters: {
    table: 'rosters',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:    tenantId,
      code:         norm.code,
      name:         norm.name,
      description:  norm.description ?? null,
      cycle_days:   Number(norm.cycle_days ?? 7) || 7,
      is_active:    norm.is_active ?? true,
      // pattern_json carries the weekly-off matrix; we populate the legacy
      // weekly_off_days array which the roster engine reads for coverage.
      pattern_json: { weekly_off_days: parseWeeklyOffDays(norm.weekly_off_days) },
    }),
  },

  departments: {
    table: 'departments',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:  tenantId,
      code:       norm.code,
      name:       norm.name,
      // departments.slug is NOT NULL — generate it like the CRUD route does
      // (slugified name, falling back to code) so imports don't violate it.
      slug:       slugifyName(norm.name) || slugifyName(norm.code) || String(norm.code ?? '').toLowerCase(),
      parent_id:  norm.parent_id ?? null,  // resolved from parent_code by validator
    }),
  },

  designations: {
    table: 'designations',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:     tenantId,
      code:          norm.code,
      name:          norm.name,
      department_id: norm.department_id ?? null,  // resolved from department_code by validator
      level:         norm.level ?? null,
    }),
  },

  sites: {
    table: 'sites',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => {
      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        code:      norm.code,
        name:      norm.name,
        location:  norm.location  ?? null,
        timezone:  (norm.timezone as string) || 'Asia/Kolkata',
        // state_id / cluster_id resolved from state_code / cluster_code by the validator.
        state_id:            norm.state_id            ?? null,
        cluster_id:          norm.cluster_id          ?? null,
        // state_code is also kept as the legacy free-text column for back-compat.
        state_code:          norm.state_code          ?? null,
        site_type:           norm.site_type           ?? null,
        city:                norm.city                ?? null,
        pincode:             norm.pincode             ?? null,
        gstin:               norm.gstin               ?? null,
        pf_registration_no:  norm.pf_registration_no  ?? null,
        esi_registration_no: norm.esi_registration_no ?? null,
      }
      // Site master expansion (migration 275). Written only when the cell carries
      // a value so a blank column on re-import never overwrites an existing value
      // and NOT-NULL/defaulted columns (e.g. status) keep their defaults.
      // cost_center_id / parent_site_id are resolved from *_code by the validator.
      const EXPANSION_KEYS = [
        'short_name', 'status', 'opening_date', 'region', 'zone',
        'cost_center_id', 'parent_site_id',
        'address_line1', 'address_line2', 'district', 'country',
        'latitude', 'longitude', 'geofence_radius_m',
        'pt_registration_no', 'lwf_registration_no', 'shops_estab_reg_no', 'factory_license_no',
        'contact_person', 'contact_phone', 'contact_email', 'sanctioned_headcount',
      ]
      for (const k of EXPANSION_KEYS) {
        if (norm[k] !== undefined && norm[k] !== '') row[k] = norm[k]
      }
      return row
    },
  },

  states: {
    table: 'states',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:      tenantId,
      code:           norm.code,
      name:           norm.name,
      region:         norm.region         ?? null,
      pt_applicable:  norm.pt_applicable   ?? false,
      lwf_applicable: norm.lwf_applicable  ?? false,
      lwf_frequency:  norm.lwf_frequency   ?? null,
    }),
  },

  clusters: {
    table: 'clusters',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:          tenantId,
      code:               norm.code,
      name:               norm.name,
      region:             norm.region             ?? null,
      // parent_cluster_id / cluster_manager_id resolved from parent_code /
      // manager_code by the validator cross-reference step.
      parent_cluster_id:  norm.parent_cluster_id  ?? null,
      cluster_manager_id: norm.cluster_manager_id ?? null,
      description:        norm.description         ?? null,
    }),
  },

  work_locations: {
    table: 'work_locations',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id: tenantId,
      code:      norm.code,
      name:      norm.name,
      // site_id is resolved from site_code by the validator cross-reference step
      site_id:   norm.site_id  ?? null,
      city:      norm.city     ?? null,
      state:     norm.state    ?? null,
      country:   (norm.country as string) || 'India',
      pincode:   norm.pincode  ?? null,
    }),
  },

  cost_centers: {
    table: 'cost_centers',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:   tenantId,
      code:        norm.code,
      name:        norm.name,
      description: norm.description ?? null,
    }),
  },

  salary_components: {
    table: 'salary_components',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:          tenantId,
      code:               norm.code,
      name:               norm.name,
      component_type:     norm.component_type,
      is_taxable:         norm.is_taxable         ?? false,
      is_pf_applicable:   norm.is_pf_applicable   ?? false,
      is_esi_applicable:  norm.is_esi_applicable  ?? false,
    }),
  },

  leave_types: {
    table: 'leave_types',
    uniqueColumn: 'name',
    mapRow: (tenantId, norm) => ({
      tenant_id:       tenantId,
      name:            norm.name,
      is_paid:         norm.is_paid         ?? true,
      allow_sandwich:  norm.allow_sandwich  ?? false,
    }),
  },

  holiday_calendar: {
    table: 'holiday_calendar',
    uniqueColumn: 'date',
    mapRow: (tenantId, norm) => ({
      tenant_id:    tenantId,
      date:         norm.date,
      name:         norm.name,
      holiday_type: norm.holiday_type ?? 'national',
    }),
  },

  // ── Enterprise Operational Masters ─────────────────────────────────────────

  grades: {
    table: 'grades',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:      tenantId,
      code:           norm.code,
      name:           norm.name,
      description:    norm.description    ?? null,
      level_order:    norm.level_order    ?? 0,
      ctc_min_annual: norm.ctc_min_annual ?? null,
      ctc_max_annual: norm.ctc_max_annual ?? null,
    }),
  },

  payroll_groups: {
    table: 'payroll_groups',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:        tenantId,
      code:             norm.code,
      name:             norm.name,
      cycle_type:       norm.cycle_type       ?? 'monthly',
      cycle_start_day:  norm.cycle_start_day  ?? 1,
      cutoff_day:       norm.cutoff_day       ?? 25,
      payout_day:       norm.payout_day       ?? 1,
      currency_code:    norm.currency_code    ?? 'INR',
    }),
  },

  employment_categories: {
    table: 'employment_categories',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:           tenantId,
      code:                norm.code,
      name:                norm.name,
      description:         norm.description         ?? null,
      benefits_eligible:   norm.benefits_eligible   ?? true,
      pf_applicable:       norm.pf_applicable       ?? true,
      esi_applicable:      norm.esi_applicable      ?? true,
      notice_period_days:  norm.notice_period_days  ?? 30,
      probation_days:      norm.probation_days       ?? 90,
    }),
  },

  statutory_groups: {
    table: 'statutory_groups',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:         tenantId,
      code:              norm.code,
      name:              norm.name,
      state:             norm.state             ?? null,
      pf_enabled:        norm.pf_enabled        ?? true,
      esi_enabled:       norm.esi_enabled       ?? true,
      pt_enabled:        norm.pt_enabled        ?? false,
      lwf_enabled:       norm.lwf_enabled       ?? false,
      pf_wage_ceiling:   norm.pf_wage_ceiling   ?? null,
      esi_wage_ceiling:  norm.esi_wage_ceiling  ?? null,
    }),
  },

  asset_categories: {
    table: 'asset_categories',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:            tenantId,
      code:                 norm.code,
      name:                 norm.name,
      description:          norm.description          ?? null,
      depreciation_method:  norm.depreciation_method  ?? 'straight_line',
      useful_life_years:    norm.useful_life_years     ?? null,
      requires_return:      norm.requires_return       ?? true,
    }),
  },

  // ── Workforce planning ──────────────────────────────────────────────────────

  positions: {
    table: 'positions',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => {
      const row: Record<string, unknown> = {
        tenant_id: tenantId,
        code:      norm.code,
        title:     norm.title,
        // FK links resolved from *_code by the validator (left null when unresolved).
        department_id:    norm.department_id    ?? null,
        designation_id:   norm.designation_id   ?? null,
        grade_id:         norm.grade_id         ?? null,
        site_id:          norm.site_id          ?? null,
        work_location_id: norm.work_location_id ?? null,
        cost_center_id:   norm.cost_center_id   ?? null,
        notes:            norm.notes            ?? null,
      }
      // NOT-NULL columns that carry DB defaults (sanctioned_count=1, status=active,
      // effective_date=today) — written only when the cell has a value so a blank
      // never violates NOT NULL / CHECK and the default is allowed to apply.
      if (norm.sanctioned_count !== undefined && norm.sanctioned_count !== '') row.sanctioned_count = norm.sanctioned_count
      if (norm.status           !== undefined && norm.status           !== '') row.status           = norm.status
      if (norm.effective_date   !== undefined && norm.effective_date   !== '') row.effective_date   = norm.effective_date
      return row
    },
  },

  // ── Payroll masters ───────────────────────────────────────────────────────────

  salary_structures: {
    table: 'salary_structures',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:   tenantId,
      code:        norm.code,
      name:        norm.name,
      description: norm.description ?? null,
      is_default:  norm.is_default  ?? false,
    }),
  },

  // ── Reference data ────────────────────────────────────────────────────────────

  document_types: {
    table: 'document_types',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:    tenantId,
      code:         norm.code,
      name:         norm.name,
      description:  norm.description  ?? null,
      is_mandatory: norm.is_mandatory  ?? false,
    }),
  },

  identity_types: {
    table: 'identity_types',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id:   tenantId,
      code:        norm.code,
      name:        norm.name,
      description: norm.description ?? null,
    }),
  },

  relationship_types: {
    table: 'relationship_types',
    uniqueColumn: 'code',
    mapRow: (tenantId, norm) => ({
      tenant_id: tenantId,
      code:      norm.code,
      name:      norm.name,
    }),
  },
}

// ── Custom import handlers (complex multi-table or ordered writes) ────────────

type CustomImportHandler = (
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
) => Promise<{ created: number; updated: number; failed: number; skipped: number }>

/**
 * Employee Compensation Import
 *
 * Safe activation order to prevent zero-active-compensation windows during payroll:
 *   1. Insert NEW compensation row  (is_active = true)
 *   2. Insert compensation component rows (inherits new comp ID)
 *   3. Deactivate OLD compensation rows  (is_active = false, effective_to = today)
 */
async function importEmployeeCompensation(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0

  for (const vr of validRows) {
    const norm = vr.normalizedData

    try {
      // Resolve salary_structure_id if not already resolved — fall back to tenant default
      let salaryStructureId = norm.salary_structure_id as string | undefined
      if (!salaryStructureId) {
        const { data: defaultSS } = await supabase
          .from('salary_structures')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('is_default', true)
          .maybeSingle()
        salaryStructureId = defaultSS?.id ?? undefined
      }

      const employeeId   = norm.employee_id as string
      const effectiveFrom = norm.effective_from as string
      const ctcAnnual    = norm.ctc_annual as number

      // Step 1: Insert new compensation (is_active=true)
      const { data: newComp, error: compErr } = await supabase
        .from('employee_compensations')
        .insert({
          tenant_id:           tenantId,
          employee_id:         employeeId,
          salary_structure_id: salaryStructureId ?? null,
          effective_from:      effectiveFrom,
          ctc_annual:          ctcAnnual,
          is_active:           true,
          notes:               (norm.notes as string | undefined) ?? null,
          created_by:          createdBy,
        })
        .select('id')
        .single()

      if (compErr || !newComp) {
        throw new Error(compErr?.message ?? 'Failed to insert compensation')
      }
      const newCompId = newComp.id as string

      // Step 2: Deactivate old active compensation rows (safe — new row is already active)
      const today = new Date().toISOString().split('T')[0]
      await supabase
        .from('employee_compensations')
        .update({ is_active: false, effective_to: today })
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
        .eq('is_active', true)
        .neq('id', newCompId)

      if (vr.isDuplicate) {
        updated++
      } else {
        created++
      }
    } catch (err) {
      vr.errors.push({
        field: '_db',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated, failed, skipped }
}

/**
 * Leave Opening Balance Import
 *
 * Upserts employee_leave_balance (tenant_id, employee_id, leave_type_id, year)
 * and inserts an audit row into leave_balance_ledger with txn_type='opening_balance'.
 */
async function importLeaveOpeningBalances(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0

  for (const vr of validRows) {
    const norm = vr.normalizedData

    try {
      const employeeId  = norm.employee_id  as string
      const leaveTypeId = norm.leave_type_id as string
      const year        = norm.year          as number
      const balance     = norm.balance       as number
      const carryFwd    = (norm.carry_forward_balance as number | undefined) ?? 0
      const totalBalance = balance + carryFwd

      // Upsert balance row
      const { error: balErr } = await supabase
        .from('employee_leave_balance')
        .upsert(
          {
            tenant_id:    tenantId,
            employee_id:  employeeId,
            leave_type_id: leaveTypeId,
            year,
            balance:      totalBalance,
            updated_at:   new Date().toISOString(),
          },
          { onConflict: 'tenant_id,employee_id,leave_type_id,year' },
        )

      if (balErr) throw new Error(balErr.message)

      // Insert audit ledger entry
      const notes = carryFwd > 0
        ? `Opening balance import: ${balance} days + ${carryFwd} carry-forward`
        : `Opening balance import: ${balance} days`

      const { error: ledgerErr } = await supabase
        .from('leave_balance_ledger')
        .insert({
          tenant_id:     tenantId,
          employee_id:   employeeId,
          leave_type_id: leaveTypeId,
          year,
          txn_type:      'opening_balance',
          delta:         totalBalance,
          balance_after: totalBalance,
          notes,
        })

      if (ledgerErr) throw new Error(ledgerErr.message)

      if (vr.isDuplicate) {
        updated++
      } else {
        created++
      }
    } catch (err) {
      vr.errors.push({
        field: '_db',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated, failed, skipped }
}

/**
 * Shift Assignment Import
 *
 * Inserts employee_shifts with is_current=true.
 * The DB trigger fn_close_previous_employee_shift auto-closes the previous row.
 */
async function importShiftAssignments(
  supabase: SupabaseClient,
  tenantId: string,
  _createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0

  for (const vr of validRows) {
    const norm = vr.normalizedData

    try {
      const employeeId   = norm.employee_id   as string
      const shiftId      = norm.shift_id       as string
      const effectiveFrom = norm.effective_from as string

      if (vr.isDuplicate && mode === 'create_only') {
        skipped++
        continue
      }

      if (vr.isDuplicate && mode === 'update_only') {
        // Update the existing row with the new shift_id
        const { error } = await supabase
          .from('employee_shifts')
          .update({ shift_id: shiftId })
          .eq('tenant_id', tenantId)
          .eq('employee_id', employeeId)
          .eq('effective_from', effectiveFrom)
        if (error) throw new Error(error.message)
        updated++
        continue
      }

      // Insert new assignment (DB trigger closes the previous is_current=true row)
      const { error } = await supabase
        .from('employee_shifts')
        .insert({
          tenant_id:    tenantId,
          employee_id:  employeeId,
          shift_id:     shiftId,
          effective_from: effectiveFrom,
          is_current:   true,
        })

      if (error) throw new Error(error.message)

      if (vr.isDuplicate) {
        updated++
      } else {
        created++
      }
    } catch (err) {
      vr.errors.push({
        field: '_db',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated, failed, skipped }
}

/**
 * Employee Import
 *
 * Creates: delegates to create_employee_with_job() RPC which atomically writes
 *   employees + job_history in one transaction, generates the employee code if
 *   not provided, and returns the full record.
 *
 * Updates: updates lean employee fields on `employees` + updates the current
 *   job_history row (employment_type + org references) in two separate calls.
 *
 * Validator pre-resolves all org reference codes (department, designation, grade,
 * work_location, manager) to UUIDs and stores them in normalizedData before this
 * handler is called, so no code lookups are needed here.
 */
async function importEmployees(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0

  for (const vr of validRows) {
    const norm = vr.normalizedData

    try {
      if (vr.isDuplicate) {
        if (mode === 'create_only') { skipped++; continue }

        const employeeId = norm.employee_id as string

        // Update lean employee table (identity + status only)
        const { error: empErr } = await supabase
          .from('employees')
          .update({
            first_name:       norm.first_name,
            last_name:        norm.last_name,
            phone:            (norm.phone as string | undefined) ?? null,
            joining_date:     norm.joining_date,
            status:           (norm.status as string | undefined) ?? 'active',
            work_location_id: (norm.work_location_id as string | undefined) ?? null,
          })
          .eq('tenant_id', tenantId)
          .eq('id', employeeId)

        if (empErr) throw new Error(empErr.message)

        // Update the current job_history row (employment_type + org refs)
        const { error: jhErr } = await supabase
          .from('job_history')
          .update({
            employment_type:  (norm.employment_type  as string | undefined) ?? 'permanent',
            department_id:    (norm.department_id    as string | undefined) ?? null,
            designation_id:   (norm.designation_id   as string | undefined) ?? null,
            grade_id:         (norm.grade_id         as string | undefined) ?? null,
            work_location_id: (norm.work_location_id as string | undefined) ?? null,
            manager_id:       (norm.manager_id       as string | undefined) ?? null,
          })
          .eq('tenant_id', tenantId)
          .eq('employee_id', employeeId)
          .eq('is_current', true)

        if (jhErr) throw new Error(jhErr.message)
        updated++
        continue
      }

      if (mode === 'update_only') { skipped++; continue }

      // New employee — use create_employee_with_job RPC (employees + job_history atomically)
      const providedCode = (norm.employee_code as string | undefined | null)
      const employeeCode = (providedCode && providedCode.trim()) ? providedCode.trim() : null

      const { data, error } = await supabase.rpc('create_employee_with_job', {
        p_tenant_id:        tenantId,
        p_created_by:       createdBy,
        p_first_name:       norm.first_name       as string,
        p_last_name:        norm.last_name         as string,
        p_email:            norm.email             as string,
        p_joining_date:     norm.joining_date      as string,
        p_employment_type:  (norm.employment_type  as string | undefined) ?? 'permanent',
        p_phone:            (norm.phone            as string | undefined) ?? null,
        p_department_id:    (norm.department_id    as string | undefined) ?? null,
        p_designation_id:   (norm.designation_id   as string | undefined) ?? null,
        p_grade_id:         (norm.grade_id         as string | undefined) ?? null,
        p_work_location_id: (norm.work_location_id as string | undefined) ?? null,
        p_manager_id:       (norm.manager_id       as string | undefined) ?? null,
        p_employee_code:    employeeCode,
      })

      if (error || !data) throw new Error(error?.message ?? 'create_employee_with_job failed')
      created++
    } catch (err) {
      vr.errors.push({
        field: '_db',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated, failed, skipped }
}

/**
 * Compensation Revision Bulk Import
 *
 * Creates pending compensation revisions in bulk.
 * Each row inserts a `compensation_revisions` record with status = 'pending'.
 * Revisions must be individually approved via POST /payroll/revisions/:id/approve.
 *
 * Duplicate detection: (employee_id, effective_date, new_ctc_annual) — same
 * employee + same date + same CTC is considered a replay; skipped if duplicate.
 */
async function importCompensationRevisions(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  let created = 0
  let failed  = 0
  let skipped = 0

  for (const vr of validRows) {
    const norm = vr.normalizedData

    try {
      const employeeId   = norm.employee_id   as string
      const revisionType = norm.revision_type as string
      const effectiveDate = norm.effective_date as string
      const newCtcAnnual  = norm.new_ctc_annual as number
      const reason        = norm.reason        as string
      const notes         = (norm.notes as string | undefined) ?? null

      // Fetch current compensation to populate previous_ctc_annual
      const { data: currentComp } = await supabase
        .from('employee_compensations')
        .select('ctc_annual')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()

      const previousCtc = (currentComp as { ctc_annual?: number } | null)?.ctc_annual ?? null
      const ctcChangePct = previousCtc && previousCtc > 0
        ? Number((((newCtcAnnual - previousCtc) / previousCtc) * 100).toFixed(4))
        : null

      if (vr.isDuplicate && mode === 'create_only') {
        skipped++
        continue
      }

      const { error } = await supabase
        .from('compensation_revisions')
        .insert({
          tenant_id:           tenantId,
          employee_id:         employeeId,
          revision_type:       revisionType,
          effective_date:      effectiveDate,
          revised_ctc_annual:  newCtcAnnual,
          previous_ctc_annual: previousCtc,
          ctc_change_pct:      ctcChangePct,
          revision_reason:     reason,            // DB column is revision_reason
          status:              'pending_approval', // DB status enum value
          created_by:          createdBy,
          metadata:            notes ? { notes } : {},
        })

      if (error) throw new Error(error.message)
      created++
    } catch (err) {
      vr.errors.push({
        field: '_db',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated: 0, failed, skipped }
}

/**
 * Bulk-upsert employee bank + statutory details. employee_code is resolved to
 * employee_id by the validator. Only columns the file actually provides are
 * written, so blank cells never erase existing values.
 */
async function importEmployeeBankDetails(
  supabase: SupabaseClient,
  tenantId: string,
  _createdBy: string,
  validRows: ValidatedRow[],
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number }> {
  const FIELDS = [
    'bank_name', 'account_number', 'ifsc_code', 'branch_name', 'account_type',
    'pan_number', 'uan_number', 'pf_number', 'esi_number', 'tax_regime',
  ]
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0

  for (const vr of validRows) {
    const norm = vr.normalizedData
    try {
      if (vr.isDuplicate && mode === 'create_only') { skipped++; continue }

      const payload: Record<string, unknown> = {
        tenant_id:   tenantId,
        employee_id: norm.employee_id as string,
      }
      for (const f of FIELDS) {
        if (norm[f] !== undefined && norm[f] !== '') payload[f] = norm[f]
      }

      const { error } = await supabase
        .from('employee_bank_statutory')
        .upsert(payload, { onConflict: 'tenant_id,employee_id' })
      if (error) throw new Error(error.message)

      if (vr.isDuplicate) updated++
      else created++
    } catch (err) {
      vr.errors.push({
        field: '_db',
        message: err instanceof Error ? err.message : String(err),
        severity: 'error',
      })
      vr.isValid = false
      failed++
    }
  }

  return { created, updated, failed, skipped }
}

const CUSTOM_HANDLERS: Record<string, CustomImportHandler> = {
  employees:               importEmployees,
  employee_compensation:   importEmployeeCompensation,
  employee_bank_details:   importEmployeeBankDetails,
  leave_opening_balances:  importLeaveOpeningBalances,
  shift_assignments:       importShiftAssignments,
  compensation_revisions:  importCompensationRevisions,
}

// ── Batch insert helper ───────────────────────────────────────────────────────

const BATCH_SIZE = 100

async function batchInsert(
  supabase: SupabaseClient,
  table: string,
  records: Record<string, unknown>[],
  uniqueColumn: string,
  mode: ImportMode,
): Promise<{ created: number; updated: number; failed: number; skipped: number; errors: Array<{ index: number; message: string }> }> {
  let created = 0
  let updated = 0
  let failed  = 0
  let skipped = 0
  const errors: Array<{ index: number; message: string }> = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    if (mode === 'upsert') {
      const { data, error } = await supabase
        .from(table)
        .upsert(batch, { onConflict: `tenant_id,${uniqueColumn}` })
        .select()

      if (error) {
        // Batch-level error — mark all rows in the batch as failed
        for (let j = 0; j < batch.length; j++) {
          errors.push({ index: i + j, message: error.message })
          failed++
        }
      } else {
        // PostgREST returns all upserted rows; count from caller's duplicate flag
        // (records array carries isDuplicate info indirectly — caller maps statuses after)
        created += data?.length ?? batch.length
      }
    } else if (mode === 'create_only') {
      const { data, error } = await supabase
        .from(table)
        .insert(batch)
        .select()

      if (error) {
        for (let j = 0; j < batch.length; j++) {
          errors.push({ index: i + j, message: error.message })
          failed++
        }
      } else {
        created += data?.length ?? batch.length
      }
    } else if (mode === 'update_only') {
      // Update one-by-one on unique key (no bulk update-by-code in PostgREST)
      for (let j = 0; j < batch.length; j++) {
        const record = batch[j]
        const tenantId = record.tenant_id as string
        const keyVal   = record[uniqueColumn]
        const { error } = await supabase
          .from(table)
          .update(record)
          .eq('tenant_id', tenantId)
          .eq(uniqueColumn, keyVal)
        if (error) {
          errors.push({ index: i + j, message: error.message })
          failed++
        } else {
          updated++
        }
      }
    }
  }

  return { created, updated, failed, skipped, errors }
}

// ── Row-level result writer ───────────────────────────────────────────────────

async function writeRowResults(
  supabase: SupabaseClient,
  jobId: string,
  tenantId: string,
  rows: ValidatedRow[],
  rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'>,
): Promise<void> {
  const payload = rows.map((vr) => ({
    import_job_id: jobId,
    tenant_id:     tenantId,
    row_number:    vr.rowNumber,
    status:        rowStatuses[vr.rowNumber] ?? (vr.isValid ? 'skipped' : 'failed'),
    errors:        vr.errors.length   > 0 ? vr.errors   : null,
    warnings:      vr.warnings.length > 0 ? vr.warnings : null,
    row_data:      vr.originalData,
  }))

  // Batch write row results silently (non-critical)
  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    await supabase
      .from('import_job_rows')
      .insert(payload.slice(i, i + BATCH_SIZE))
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runImport(
  supabase: SupabaseClient,
  tenantId: string,
  createdBy: string,
  masterType: string,
  mode: ImportMode,
  rows: Record<string, string>[],
  fileName: string,
): Promise<ImportResult> {
  const startedAt = Date.now()

  // ── 1. Create the job record ─────────────────────────────────────────────
  const { data: jobData, error: jobCreateError } = await supabase
    .from('import_jobs')
    .insert({
      tenant_id:   tenantId,
      created_by:  createdBy,
      master_type: masterType,
      mode,
      file_name:   fileName,
      status:      'validating',
      total_rows:  rows.length,
    })
    .select('id')
    .single()

  if (jobCreateError || !jobData) {
    throw new Error(`Failed to create import job: ${jobCreateError?.message ?? 'unknown'}`)
  }

  const jobId = jobData.id as string

  try {
    // ── 2. Validate rows ─────────────────────────────────────────────────
    const validation = await validateImportRows(supabase, tenantId, masterType, rows)

    // ── 3. Update job with validation counts ────────────────────────────
    await supabase
      .from('import_jobs')
      .update({
        valid_rows:   validation.validRows,
        invalid_rows: validation.invalidRows,
      })
      .eq('id', jobId)

    // ── 4. validate_only mode — stop here ───────────────────────────────
    if (mode === 'validate_only') {
      await supabase
        .from('import_jobs')
        .update({ status: 'validated', duration_ms: Date.now() - startedAt })
        .eq('id', jobId)

      // Write row results even in validate_only so the user can inspect errors
      const rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'> = {}
      for (const vr of validation.rows) {
        rowStatuses[vr.rowNumber] = vr.isValid ? 'skipped' : 'failed'
      }
      await writeRowResults(supabase, jobId, tenantId, validation.rows, rowStatuses)

      return {
        importJobId: jobId,
        created:     0,
        updated:     0,
        failed:      validation.invalidRows,
        skipped:     validation.validRows,
        duration_ms: Date.now() - startedAt,
      }
    }

    // ── 5. Update status to importing ───────────────────────────────────
    await supabase
      .from('import_jobs')
      .update({ status: 'importing' })
      .eq('id', jobId)

    // ── 6. Run import (custom handler or generic batch insert) ──────────
    const rowStatuses: Record<number, 'created' | 'updated' | 'failed' | 'skipped'> = {}
    let totalCreated = 0
    let totalUpdated = 0
    let totalFailed  = validation.invalidRows // rows that failed validation
    let totalSkipped = 0

    // Mark already-invalid rows
    for (const vr of validation.rows) {
      if (!vr.isValid) rowStatuses[vr.rowNumber] = 'failed'
    }

    const customHandler = CUSTOM_HANDLERS[masterType]
    if (customHandler) {
      // Filter to rows eligible under the requested mode
      const eligibleRows = validation.rows.filter((vr) => {
        if (!vr.isValid) return false
        if (mode === 'create_only' && vr.isDuplicate) return false
        if (mode === 'update_only' && !vr.isDuplicate) return false
        return true
      })

      // Rows skipped due to mode mismatch
      for (const vr of validation.rows) {
        if (!vr.isValid) continue
        if (mode === 'create_only' && vr.isDuplicate) {
          rowStatuses[vr.rowNumber] = 'skipped'
          totalSkipped++
        } else if (mode === 'update_only' && !vr.isDuplicate) {
          rowStatuses[vr.rowNumber] = 'skipped'
          totalSkipped++
        }
      }

      const result = await customHandler(supabase, tenantId, createdBy, eligibleRows, mode)
      totalCreated += result.created
      totalUpdated += result.updated
      totalFailed  += result.failed
      totalSkipped += result.skipped

      // Write per-row statuses from handler results
      for (const vr of eligibleRows) {
        if (!vr.isValid) {
          rowStatuses[vr.rowNumber] = 'failed'
        } else if (vr.isDuplicate) {
          rowStatuses[vr.rowNumber] = 'updated'
        } else {
          rowStatuses[vr.rowNumber] = 'created'
        }
      }
    } else {
      // Generic TABLE_MAP path
      const config = TABLE_MAP[masterType]
      if (!config) {
        throw new Error(`No table config for master type: ${masterType}`)
      }

      const toProcess: Array<{ vr: ValidatedRow; record: Record<string, unknown> }> = []

      for (const vr of validation.rows) {
        if (!vr.isValid) continue

        if (mode === 'create_only' && vr.isDuplicate) {
          rowStatuses[vr.rowNumber] = 'skipped'
          totalSkipped++
          continue
        }

        if (mode === 'update_only' && !vr.isDuplicate) {
          rowStatuses[vr.rowNumber] = 'skipped'
          totalSkipped++
          continue
        }

        const record = config.mapRow(tenantId, vr.normalizedData)
        toProcess.push({ vr, record })
      }

      const records = toProcess.map((p) => p.record)
      const result  = await batchInsert(
        supabase,
        config.table,
        records,
        config.uniqueColumn,
        mode,
      )

      for (let i = 0; i < toProcess.length; i++) {
        const { vr } = toProcess[i]
        const batchError = result.errors.find((e) => e.index === i)
        if (batchError) {
          rowStatuses[vr.rowNumber] = 'failed'
          vr.errors.push({ field: '_db', message: batchError.message, severity: 'error' })
        } else if (mode === 'update_only') {
          rowStatuses[vr.rowNumber] = 'updated'
        } else if (mode === 'upsert' && vr.isDuplicate) {
          rowStatuses[vr.rowNumber] = 'updated'
        } else {
          rowStatuses[vr.rowNumber] = 'created'
        }
      }

      // Count created/updated by checking row statuses (errors.index maps back to toProcess)
      const failedIndices = new Set(result.errors.map((e) => e.index))
      let batchCreated = 0
      let batchUpdated = 0
      for (let idx = 0; idx < toProcess.length; idx++) {
        if (failedIndices.has(idx)) continue
        if (toProcess[idx].vr.isDuplicate || mode === 'update_only') {
          batchUpdated++
        } else {
          batchCreated++
        }
      }

      totalCreated += batchCreated
      totalUpdated += batchUpdated
      totalFailed  += result.failed
      totalSkipped += result.skipped
    }

    // ── 8. Write row-level results ───────────────────────────────────────
    await writeRowResults(supabase, jobId, tenantId, validation.rows, rowStatuses)

    const duration_ms = Date.now() - startedAt

    // ── 9. Finalise job ──────────────────────────────────────────────────
    await supabase
      .from('import_jobs')
      .update({
        status:       'completed',
        created_rows: totalCreated,
        updated_rows: totalUpdated,
        failed_rows:  totalFailed,
        skipped_rows: totalSkipped,
        duration_ms,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    return {
      importJobId:  jobId,
      created:      totalCreated,
      updated:      totalUpdated,
      failed:       totalFailed,
      skipped:      totalSkipped,
      duration_ms,
    }
  } catch (err) {
    // Mark job as failed on unexpected error
    await supabase
      .from('import_jobs')
      .update({
        status:      'failed',
        duration_ms: Date.now() - startedAt,
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq('id', jobId)
    throw err
  }
}
