import type { SupabaseClient } from '@supabase/supabase-js'

export interface FetchProfileOptions {
  /**
   * light mode — skips four expensive queries:
   *   - employee_addresses
   *   - emergency_contacts
   *   - employee_bank_statutory
   *   - employee_compensation_components
   *
   * Use for summary/card views where full detail is not needed.
   * All skipped sections are returned as their empty equivalent
   * (null or []) so the response shape is always identical.
   */
  light?: boolean
}

/**
 * timed — wraps a Supabase query promise and records its wall-clock duration.
 * The extra `ms` field is stripped from the result before the caller uses data/error.
 * @internal
 */
async function timed<D>(
  p: PromiseLike<{ data: D; error: unknown }>,
): Promise<{ data: D; error: unknown; ms: number }> {
  const t = Date.now()
  const result = await p
  return { ...result, ms: Date.now() - t }
}

/**
 * fetchFullProfile
 *
 * Shared helper used by:
 *   GET  /employees/:id/full-profile          (full or light)
 *   POST /employees/full-create               (always full)
 *
 * Runs two parallel query waves to minimise round-trips.
 * In light mode the second wave is reduced further.
 * Returns null when the employee does not exist or does not belong to the tenant.
 */
export async function fetchFullProfile(
  sb: SupabaseClient,
  employeeId: string,
  tenantId: string,
  opts: FetchProfileOptions = {},
) {
  const light    = opts.light === true
  const totalStart = Date.now()

  // ── 1. Base employee — existence + tenant guard ────────────────────────────
  const empResult = await timed(
    sb.from('employees')
      .select(
        'id, tenant_id, employee_code, first_name, last_name, email, phone,' +
        ' joining_date, status, created_by, created_at, updated_at,' +
        ' site_id, roster_id,' +
        ' sites(id, name, timezone),' +
        ' rosters(id, name, cycle_days)',
      )
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .single(),
  )
  const employee_query_ms = empResult.ms
  if (empResult.error || !empResult.data) return null
  const employee = empResult.data

  // ── 2. Wave 1 — parallel queries; 4 are skipped in light mode ─────────────
  const wave1Start = Date.now()
  const wave1Raw = (await Promise.all([

    // [0] personal_info — always fetched (1:1, small)
    sb.from('employee_personal_info')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),

    // [1] current job_history row with FK joins — always fetched; individually timed
    timed(
      sb.from('job_history')
        .select(
          'id, employment_type, effective_from, effective_to, reason_for_change, manager_id,' +
          ' departments(id, name, code),' +
          ' designations(id, name),' +
          ' grades(id, name, code),' +
          ' work_locations(id, name, city),' +
          ' cost_centers(id, name, code),' +
          ' shifts(id, name, code)',
        )
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .eq('is_current', true)
        .maybeSingle(),
    ),

    // [2] compensation header — always fetched (components skipped in light mode, wave 2); individually timed
    timed(
      sb.from('employee_compensations')
        .select('id, ctc_annual, ctc_monthly, effective_from, effective_to, notes, salary_structures(id, name, code)')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle(),
    ),

    // [3] addresses — SKIPPED in light mode
    light
      ? Promise.resolve({ data: [] as any[] })
      : sb.from('employee_addresses')
          .select('id, address_type, line1, line2, city, state, country, pincode')
          .eq('employee_id', employeeId)
          .eq('tenant_id', tenantId)
          .order('address_type'),

    // [4] emergency contacts — SKIPPED in light mode
    light
      ? Promise.resolve({ data: [] as any[] })
      : sb.from('emergency_contacts')
          .select('id, name, relationship, phone, alternate_phone, email, is_primary')
          .eq('employee_id', employeeId)
          .eq('tenant_id', tenantId)
          .order('is_primary', { ascending: false }),

    // [5] bank & statutory — SKIPPED in light mode (sensitive; not needed for summaries)
    light
      ? Promise.resolve({ data: null })
      : sb.from('employee_bank_statutory')
          .select(
            'id, bank_name, account_number, ifsc_code, branch_name, account_type,' +
            ' pan_number, aadhaar_number, uan_number, pf_number, esi_number,' +
            ' pt_applicable, lwf_applicable, tax_regime',
          )
          .eq('employee_id', employeeId)
          .eq('tenant_id', tenantId)
          .maybeSingle(),

  ])) as any[]
  const wave1_ms = Date.now() - wave1Start

  const personalInfo:      any   = wave1Raw[0].data
  // wave1Raw[1] and [2] are timed wrappers — unwrap them
  const job_query_ms:          number = wave1Raw[1].ms
  const comp_query_ms:         number = wave1Raw[2].ms
  let   jobRow:            any   = wave1Raw[1].data
  const compensation:      any   = wave1Raw[2].data
  const addresses:         any[] = wave1Raw[3].data ?? []
  const emergencyContacts: any[] = wave1Raw[4].data ?? []
  const bankStatutory:     any   = wave1Raw[5].data

  // ── 2b. Job-row embed fallback ─────────────────────────────────────────────
  // On a drifted DB a missing FK relationship (or a missing column like
  // shifts.code) makes the embedded job_history select error → jobRow = null,
  // and a freshly-saved position silently fails to appear. Recover by fetching
  // the raw current row and resolving the lookup names with simple by-id queries
  // so the Job Details card always reflects what was saved.
  if (wave1Raw[1].error || !jobRow) {
    const { data: rawJob } = await sb
      .from('job_history')
      .select('id, employment_type, effective_from, effective_to, reason_for_change, manager_id, department_id, designation_id, grade_id, work_location_id, cost_center_id, shift_id')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .eq('is_current', true)
      .maybeSingle()
    if (rawJob) {
      const lk = async (table: string, idVal: string | null, cols: string) =>
        idVal ? (await sb.from(table).select(cols).eq('id', idVal).maybeSingle()).data : null
      const [dep, des, grd, wl, cc, sh] = await Promise.all([
        lk('departments',    rawJob.department_id,    'id, name, code'),
        lk('designations',   rawJob.designation_id,   'id, name'),
        lk('grades',         rawJob.grade_id,         'id, name, code'),
        lk('work_locations', rawJob.work_location_id, 'id, name, city'),
        lk('cost_centers',   rawJob.cost_center_id,   'id, name, code'),
        lk('shifts',         rawJob.shift_id,         'id, name'),
      ])
      jobRow = { ...rawJob, departments: dep, designations: des, grades: grd, work_locations: wl, cost_centers: cc, shifts: sh }
    }
  }

  // ── 3. Wave 2 — depends on wave-1; components skipped in light mode ────────
  const wave2Start = Date.now()
  const wave2Raw = (await Promise.all([

    // [0] compensation components — SKIPPED in light mode (can be 10–20+ rows)
    compensation && !light
      ? sb.from('employee_compensation_components')
          .select(
            'id, calculation_type, value, computed_monthly, computed_annual, sequence,' +
            ' salary_components(id, name, code, component_type, is_basic, affects_pf, affects_nlc)',
          )
          .eq('compensation_id', compensation.id)
          .eq('tenant_id', tenantId)
          .order('sequence')
      : Promise.resolve({ data: [] as any[] }),

    // [1] manager name — always fetched (single row, negligible cost)
    jobRow?.manager_id
      ? sb.from('employees')
          .select('id, first_name, last_name, employee_code')
          .eq('id', jobRow.manager_id)
          .eq('tenant_id', tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),

  ])) as any[]
  const wave2_ms = Date.now() - wave2Start

  const compComponents: any[] = wave2Raw[0].data ?? []
  const managerRow:     any   = wave2Raw[1].data

  // ── Query accounting ───────────────────────────────────────────────────────
  // Total possible DB queries = 9 (employee + 6 wave1 + 2 wave2).
  // Three groups can be skipped:
  //   light mode       → addresses, emergency_contacts, bank_statutory (3)
  //   light OR no comp → comp_components                               (1)
  //   no manager_id    → manager lookup                                (1)
  const skipped_count =
      (light ? 3 : 0)
    + (light || !compensation ? 1 : 0)
    + (jobRow?.manager_id ? 0 : 1)
  const query_count = 9 - skipped_count

  // ── 4. Shape bank_statutory — mask sensitive fields ────────────────────────
  const bank_statutory = bankStatutory
    ? {
        id:                    bankStatutory.id,
        bank_name:             bankStatutory.bank_name     ?? null,
        account_number_masked: bankStatutory.account_number
          ? `****${String(bankStatutory.account_number).slice(-4)}`
          : null,
        ifsc:                  bankStatutory.ifsc_code     ?? null,
        branch:                bankStatutory.branch_name   ?? null,
        account_type:          bankStatutory.account_type  ?? null,
        pan:                   bankStatutory.pan_number    ?? null,
        aadhaar_masked:        bankStatutory.aadhaar_number
          ? `XXXX-XXXX-${String(bankStatutory.aadhaar_number).slice(-4)}`
          : null,
        uan:                   bankStatutory.uan_number    ?? null,
        pf_number:             bankStatutory.pf_number     ?? null,
        esi_number:            bankStatutory.esi_number    ?? null,
        pt_applicable:         bankStatutory.pt_applicable,
        lwf_applicable:        bankStatutory.lwf_applicable,
        tax_regime:            bankStatutory.tax_regime    ?? null,
        // per-employee statutory state overrides — fetched below and merged in
        pt_state_code:         null as string | null,
        lwf_state_code:        null as string | null,
        holiday_group_id:      null as string | null,
        // site's state_code — fallback for PT/LWF when no per-employee override
        site_state_code:       null as string | null,
      }
    : null

  // ── 4b. Merge per-employee PT/LWF state + holiday group into bank_statutory ──
  // These are stored in separate tables (ptax_state_config, lwf_state_config,
  // employees.holiday_group_id), not in employee_bank_statutory.
  // site_state_code: the site's state_code (fallback used when no per-employee
  // override is set — allows admins to configure PT/LWF once per site).
  if (bank_statutory && !light) {
    const [ptRow, lwfRow, empRow] = await Promise.all([
      sb.from('ptax_state_config')
        .select('state_code')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from('lwf_state_config')
        .select('state_code')
        .eq('employee_id', employeeId)
        .eq('tenant_id', tenantId)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from('employees')
        .select('holiday_group_id')
        .eq('id', employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ])
    bank_statutory.pt_state_code    = (ptRow.data  as any)?.state_code       ?? null
    bank_statutory.lwf_state_code   = (lwfRow.data as any)?.state_code       ?? null
    bank_statutory.holiday_group_id = (empRow.data as any)?.holiday_group_id ?? null

    // Fetch site's state_code so the UI can show "Auto from site (KA)"
    const siteId = (employee as any).site_id
    if (siteId) {
      const { data: siteRow } = await sb.from('sites')
        .select('state_code')
        .eq('id', siteId)
        .maybeSingle()
      bank_statutory.site_state_code = (siteRow as any)?.state_code ?? null
    }
  }

  // ── 5. Shape job_info ──────────────────────────────────────────────────────
  const job_info = jobRow
    ? {
        id:                jobRow.id,
        employment_type:   jobRow.employment_type,
        effective_from:    jobRow.effective_from,
        effective_to:      jobRow.effective_to      ?? null,
        reason_for_change: jobRow.reason_for_change ?? null,
        // Expose BOTH singular and plural aliases for each FK relation — different
        // consumers read different forms (EmployeeProfile + ManagerProfileView use
        // plural job.departments/…; EssTeam uses singular job.department). Keeping
        // both avoids the empty-card bug without breaking any caller.
        department:        jobRow.departments       ?? null,
        departments:       jobRow.departments       ?? null,
        designation:       jobRow.designations      ?? null,
        designations:      jobRow.designations      ?? null,
        grade:             jobRow.grades            ?? null,
        grades:            jobRow.grades            ?? null,
        work_location:     jobRow.work_locations    ?? null,
        work_locations:    jobRow.work_locations    ?? null,
        cost_center:       jobRow.cost_centers      ?? null,
        cost_centers:      jobRow.cost_centers      ?? null,
        shift:             jobRow.shifts            ?? null,
        shifts:            jobRow.shifts            ?? null,
        manager: managerRow
          ? {
              id:            managerRow.id,
              // first_name/last_name for callers that compose the name themselves
              // (EmployeeProfile Job Details card); full_name for those that don't.
              first_name:    managerRow.first_name,
              last_name:     managerRow.last_name,
              full_name:     `${managerRow.first_name} ${managerRow.last_name}`.trim(),
              employee_code: managerRow.employee_code,
            }
          : null,
      }
    : null

  // ── 6. Shape compensation ──────────────────────────────────────────────────
  //       In light mode components is always [] (query was skipped)
  const shapedComponents = compComponents.map((c: any) => ({
    id:               c.id,
    name:             c.salary_components?.name           ?? null,
    code:             c.salary_components?.code           ?? null,
    component_type:   c.salary_components?.component_type ?? null,
    is_basic:         c.salary_components?.is_basic        ?? false,
    affects_pf:       c.salary_components?.affects_pf      ?? false,
    affects_nlc:      c.salary_components?.affects_nlc     ?? false,
    calculation_type: c.calculation_type,
    value:            c.value,
    monthly_amount:   c.computed_monthly,
    annual_amount:    c.computed_annual,
    sequence:         c.sequence,
  }))

  // Compute in-memory totals so the UI can display summaries without a separate query
  function r2fp(n: number) { return Math.round(n * 100) / 100 }
  const fpEarnings   = shapedComponents.filter((c: any) => c.component_type === 'earning')
  const fpDeductions = shapedComponents.filter((c: any) => c.component_type === 'deduction')
  const fpErContrib  = shapedComponents.filter((c: any) => c.component_type === 'employer_contribution')
  const fpBasic      = shapedComponents.find((c: any) => c.is_basic)
  const fpGross      = r2fp(fpEarnings.reduce((s: number, c: any) => s + (c.annual_amount ?? 0), 0))
  const fpDeduct     = r2fp(fpDeductions.reduce((s: number, c: any) => s + (c.annual_amount ?? 0), 0))
  const fpErCon      = r2fp(fpErContrib.reduce((s: number, c: any) => s + (c.annual_amount ?? 0), 0))

  // Net take-home: the salary master has no employee statutory lines (PF/ESI/PT/
  // LWF/TDS), so fpDeduct is ~0 and gross−deduct would wrongly equal gross. Source
  // the real employee deductions from the latest finalized payslip (full rate =
  // total_deductions − LOP, since LOP is a paid-day reduction, not a standing
  // deduction). Falls back to the structure deductions when there is no slip — OR
  // when the slip's figure is IMPLAUSIBLE (exceeds gross, e.g. a one-off recovery,
  // arrears clawback or a heavy-LOP month), which would otherwise show a NEGATIVE
  // take-home. Net is also clamped to ≥ 0 as a final guard.
  const grossMonthlyVal = r2fp(fpGross / 12)
  let empDeductMonthly = r2fp(fpDeduct / 12)
  let netSource: 'payslip' | 'structure' = 'structure'
  {
    const { data: latestSlip } = await sb
      .from('payroll_slips')
      .select('total_deductions, lop_amount, month')
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .eq('status', 'finalized')
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestSlip) {
      const slipDeduct = r2fp(Math.max(0, (Number((latestSlip as any).total_deductions) || 0) - (Number((latestSlip as any).lop_amount) || 0)))
      // Only trust the payslip when it reads like a standing monthly deduction
      // (≤ gross). Otherwise keep the structure-based figure.
      if (slipDeduct <= grossMonthlyVal) {
        empDeductMonthly = slipDeduct
        netSource = 'payslip'
      }
    }
  }
  const netMonthlyVal   = r2fp(Math.max(0, grossMonthlyVal - empDeductMonthly))

  const compensationTotals = {
    gross_annual:                   fpGross,
    gross_monthly:                  grossMonthlyVal,
    basic_annual:                   r2fp(fpBasic?.annual_amount ?? 0),
    basic_monthly:                  r2fp((fpBasic?.annual_amount ?? 0) / 12),
    deductions_annual:              r2fp(empDeductMonthly * 12),
    deductions_monthly:             empDeductMonthly,
    employer_contributions_annual:  fpErCon,
    employer_contributions_monthly: r2fp(fpErCon / 12),
    net_annual:                     r2fp(netMonthlyVal * 12),
    net_monthly:                    netMonthlyVal,
    net_source:                     netSource,
  }

  const compensationOut = compensation
    ? {
        id:             compensation.id,
        ctc_annual:     compensation.ctc_annual,
        ctc_monthly:    compensation.ctc_monthly,
        effective_from: compensation.effective_from,
        effective_to:   compensation.effective_to ?? null,
        notes:          compensation.notes        ?? null,
        structure:      compensation.salary_structures ?? null,
        components:     shapedComponents,
        totals:         compensationTotals,
      }
    : null

  // ── 7. Return shaped profile ───────────────────────────────────────────────
  return {
    employee,
    personal_info:      personalInfo ?? null,
    job_info,
    compensation:       compensationOut,
    addresses,
    emergency_contacts: emergencyContacts,
    bank_statutory,
    /** Per-query timing — for debug logs only; callers MUST strip before HTTP response. */
    _timing: {
      total_ms:              Date.now() - totalStart,
      wave1_ms,
      wave2_ms,
      employee_query_ms,
      job_query_ms:          job_query_ms,
      compensation_query_ms: comp_query_ms,
      query_count,
      skipped_count,
    },
  }
}
