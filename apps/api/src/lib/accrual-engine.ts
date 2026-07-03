/**
 * Leave Accrual Engine
 *
 * Computes and credits monthly/quarterly/annual leave for all employees
 * based on their tenant's `leave_accrual_rules`. Writes immutable ledger
 * entries to `leave_balance_ledger` and updates `employee_leave_balance`.
 *
 * Also handles:
 * - Carry-forward processing at year-start (run in January)
 * - Expiry of carry-forward balances (run monthly against expiry date)
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccrualRule {
  id:                       string
  leave_type_id:            string
  accrual_frequency:        'monthly' | 'quarterly' | 'annually' | 'on_joining'
  days_per_period:          number
  prorate_on_joining:       boolean
  carry_forward_max:        number
  carry_forward_expiry_months: number
  encashable:               boolean
  max_encashable_per_year:  number
  effective_from:           string
  effective_to:             string | null
}

export interface AccrualResult {
  employees_credited: number
  total_days_credited: number
  skipped:            number
  errors:             string[]
}

// ── Helper: pro-rate days for partial months ──────────────────────────────────

function proratedDays(
  daysPerPeriod: number,
  joiningDate:   string,
  periodYear:    number,
  periodMonth:   number,   // 1-based
): number {
  const joining = new Date(`${joiningDate}T00:00:00.000Z`)
  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1))
  const periodEnd   = new Date(Date.UTC(periodYear, periodMonth, 0))   // last day of month

  if (joining > periodEnd) return 0           // Joined after period
  if (joining <= periodStart) return daysPerPeriod  // Full month

  // Joined mid-month — pro-rate by days remaining in period
  const daysInMonth  = periodEnd.getUTCDate()
  const daysWorked   = daysInMonth - joining.getUTCDate() + 1
  return parseFloat(((daysPerPeriod * daysWorked) / daysInMonth).toFixed(2))
}

// ── Core: run monthly accrual for one tenant ─────────────────────────────────

export async function runMonthlyAccrual(
  supabase:   SupabaseClient,
  tenantId:   string,
  periodYear: number,
  periodMonth: number,  // 1-based (1 = January)
): Promise<AccrualResult> {
  const runPeriod = `${periodYear}-${String(periodMonth).padStart(2, '0')}`
  const result: AccrualResult = { employees_credited: 0, total_days_credited: 0, skipped: 0, errors: [] }

  // ── Fetch active accrual rules for the period ──────────────────────────────
  const periodDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`
  const { data: rules, error: rulesErr } = await supabase
    .from('leave_accrual_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('effective_from', periodDate)
    .or(`effective_to.is.null,effective_to.gte.${periodDate}`)

  if (rulesErr || !rules?.length) {
    result.errors.push(rulesErr?.message ?? 'No active accrual rules found')
    return result
  }

  const monthlyRules = rules.filter((r: AccrualRule) => r.accrual_frequency === 'monthly')
  if (!monthlyRules.length) return result   // Nothing to do this month

  // ── Fetch all active employees for tenant ──────────────────────────────────
  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, joining_date')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')

  if (empErr || !employees?.length) {
    result.errors.push(empErr?.message ?? 'No active employees found')
    return result
  }

  // ── Idempotency: check if already run for this period+rule combo ───────────
  const { data: existingRuns } = await supabase
    .from('leave_accrual_runs')
    .select('leave_type_id')
    .eq('tenant_id', tenantId)
    .eq('run_period', runPeriod)
    .eq('status', 'success')

  const alreadyRunTypes = new Set((existingRuns ?? []).map((r: { leave_type_id: string }) => r.leave_type_id))

  // Computed once — same for every employee in this accrual run
  const periodLastDay = new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10)
  const nowIso = new Date().toISOString()

  // ── Process each rule ──────────────────────────────────────────────────────
  for (const rule of monthlyRules as AccrualRule[]) {
    if (alreadyRunTypes.has(rule.leave_type_id)) {
      result.skipped++
      continue
    }

    let employeesCredited = 0
    let totalDays = 0
    const runErrors: string[] = []

    // Batch-fetch existing balances so we can compute new balances in memory
    // without a per-employee SELECT (eliminates ISSUE-030).
    const { data: existingBalances, error: balFetchErr } = await supabase
      .from('employee_leave_balance')
      .select('employee_id, balance')
      .eq('tenant_id', tenantId)
      .eq('leave_type_id', rule.leave_type_id)
      .eq('year', periodYear)

    if (balFetchErr) {
      runErrors.push(`Balance pre-fetch failed: ${balFetchErr.message}`)
    }

    const balanceMap = new Map<string, number>(
      (existingBalances ?? []).map((b: { employee_id: string; balance: number }) => [b.employee_id, Number(b.balance)])
    )

    const balUpserts: Record<string, unknown>[] = []
    const ledInserts: Record<string, unknown>[] = []
    const alUpserts:  Record<string, unknown>[] = []

    for (const emp of employees as Array<{ id: string; joining_date: string }>) {
      const days = rule.prorate_on_joining
        ? proratedDays(rule.days_per_period, emp.joining_date, periodYear, periodMonth)
        : rule.days_per_period

      if (days <= 0) continue

      const currentBalance = balanceMap.get(emp.id) ?? 0
      const newBalance = parseFloat((currentBalance + days).toFixed(2))

      balUpserts.push({
        tenant_id:     tenantId,
        employee_id:   emp.id,
        leave_type_id: rule.leave_type_id,
        year:          periodYear,
        balance:       newBalance,
        updated_at:    nowIso,
      })

      ledInserts.push({
        tenant_id:     tenantId,
        employee_id:   emp.id,
        leave_type_id: rule.leave_type_id,
        year:          periodYear,
        txn_type:      'accrual',
        delta:         days,
        balance_after: newBalance,
        notes:         `Monthly accrual — ${runPeriod}`,
      })

      alUpserts.push({
        tenant_id:     tenantId,
        employee_id:   emp.id,
        leave_type_id: rule.leave_type_id,
        year:          periodYear,
        accrual_type:  'monthly',
        days,
        accrued_on:    periodLastDay,
        is_expired:    false,
        notes:         `Monthly accrual — ${runPeriod}`,
      })

      employeesCredited++
      totalDays = parseFloat((totalDays + days).toFixed(2))
    }

    // Batch write: 3 calls per rule regardless of employee count
    // (was 4 × N_employees sequential calls — ISSUE-030 through ISSUE-033).
    if (balUpserts.length) {
      const { error: balErr } = await supabase
        .from('employee_leave_balance')
        .upsert(balUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })
      if (balErr) runErrors.push(`Balance batch failed: ${balErr.message}`)

      const { error: ledErr } = await supabase
        .from('leave_balance_ledger')
        .insert(ledInserts)
      if (ledErr) runErrors.push(`Ledger batch failed: ${ledErr.message}`)

      const { error: alErr } = await supabase
        .from('leave_accrual_ledger')
        .upsert(alUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on', ignoreDuplicates: true })
      if (alErr) runErrors.push(`Accrual ledger batch failed: ${alErr.message}`)
    }

    // Record the run
    await supabase.from('leave_accrual_runs').upsert(
      {
        tenant_id:           tenantId,
        run_period:          runPeriod,
        leave_type_id:       rule.leave_type_id,
        employees_credited:  employeesCredited,
        total_days_credited: totalDays,
        status:              runErrors.length ? 'partial' : 'success',
        error_message:       runErrors.length ? runErrors.join('; ') : null,
        ran_at:              nowIso,
      },
      { onConflict: 'tenant_id,run_period,leave_type_id' },
    )

    result.employees_credited += employeesCredited
    result.total_days_credited = parseFloat((result.total_days_credited + totalDays).toFixed(2))
    if (runErrors.length) result.errors.push(...runErrors)
  }

  return result
}

// ── Carry-forward processing (run in January) ─────────────────────────────────

export async function processCarryForward(
  supabase:   SupabaseClient,
  tenantId:   string,
  fromYear:   number,
): Promise<{ employees_processed: number; total_days_carried: number }> {
  const toYear = fromYear + 1
  let employeesProcessed = 0
  let totalCarried = 0

  // Fetch rules with carry-forward
  const { data: rules } = await supabase
    .from('leave_accrual_rules')
    .select('leave_type_id, carry_forward_max, carry_forward_expiry_months')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .gt('carry_forward_max', 0)

  if (!rules?.length) return { employees_processed: 0, total_days_carried: 0 }

  const nowIso = new Date().toISOString()
  const carryAccruedOn = `${toYear}-01-01`

  for (const rule of rules as Array<{ leave_type_id: string; carry_forward_max: number; carry_forward_expiry_months: number }>) {
    // Fetch all employees with a fromYear balance for this rule
    const { data: balances } = await supabase
      .from('employee_leave_balance')
      .select('employee_id, balance')
      .eq('tenant_id', tenantId)
      .eq('leave_type_id', rule.leave_type_id)
      .eq('year', fromYear)
      .gt('balance', 0)

    if (!balances?.length) continue

    // Expiry date is the same for every employee within a rule
    let expiryDate: string | null = null
    if (rule.carry_forward_expiry_months > 0) {
      const expiry = new Date(Date.UTC(toYear, rule.carry_forward_expiry_months - 1, 28))
      expiryDate = expiry.toISOString().slice(0, 10)
    }
    const notesSuffix = expiryDate ? ` · expires ${expiryDate}` : ''

    // Batch-fetch existing toYear balances to avoid a per-employee SELECT
    const { data: toYearBals } = await supabase
      .from('employee_leave_balance')
      .select('employee_id, balance')
      .eq('tenant_id', tenantId)
      .eq('leave_type_id', rule.leave_type_id)
      .eq('year', toYear)

    const toYearMap = new Map<string, number>(
      (toYearBals ?? []).map((b: { employee_id: string; balance: number }) => [b.employee_id, Number(b.balance)])
    )

    const cfBalUpserts: Record<string, unknown>[] = []
    const cfLedInserts: Record<string, unknown>[] = []
    const cfAlUpserts:  Record<string, unknown>[] = []

    for (const bal of balances as Array<{ employee_id: string; balance: number }>) {
      const carryDays = Math.min(Number(bal.balance), rule.carry_forward_max)
      if (carryDays <= 0) continue

      const existingBalance = toYearMap.get(bal.employee_id) ?? 0
      const newBalance = parseFloat((existingBalance + carryDays).toFixed(2))

      cfBalUpserts.push({
        tenant_id:     tenantId,
        employee_id:   bal.employee_id,
        leave_type_id: rule.leave_type_id,
        year:          toYear,
        balance:       newBalance,
        updated_at:    nowIso,
      })

      cfLedInserts.push({
        tenant_id:     tenantId,
        employee_id:   bal.employee_id,
        leave_type_id: rule.leave_type_id,
        year:          toYear,
        txn_type:      'carry_forward',
        delta:         carryDays,
        balance_after: newBalance,
        notes:         `Carry-forward from ${fromYear}${notesSuffix}`,
      })

      cfAlUpserts.push({
        tenant_id:     tenantId,
        employee_id:   bal.employee_id,
        leave_type_id: rule.leave_type_id,
        year:          toYear,
        accrual_type:  'carry_forward',
        days:          carryDays,
        accrued_on:    carryAccruedOn,
        is_expired:    false,
        notes:         `Carry-forward from ${fromYear}${notesSuffix}`,
      })

      employeesProcessed++
      totalCarried = parseFloat((totalCarried + carryDays).toFixed(2))
    }

    // Batch write: 3 calls per rule regardless of employee count
    // (was 3 × N_employees sequential calls)
    if (cfBalUpserts.length) {
      await supabase
        .from('employee_leave_balance')
        .upsert(cfBalUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })

      await supabase.from('leave_balance_ledger').insert(cfLedInserts)

      await supabase
        .from('leave_accrual_ledger')
        .upsert(cfAlUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on', ignoreDuplicates: true })
    }
  }

  return { employees_processed: employeesProcessed, total_days_carried: totalCarried }
}

// ── Process encashment approval ───────────────────────────────────────────────

export async function processEncashment(
  supabase:       SupabaseClient,
  tenantId:       string,
  encashmentId:   string,
  approverId:     string,
): Promise<{ ok: boolean; message: string }> {
  // Fetch the request
  const { data: req, error: fetchErr } = await supabase
    .from('leave_encashment_requests')
    .select('*')
    .eq('id', encashmentId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (fetchErr || !req) return { ok: false, message: 'Encashment request not found' }
  if (req.status !== 'pending') return { ok: false, message: `Request is already ${req.status}` }

  // Check encashment is allowed in accrual rule
  const { data: rule } = await supabase
    .from('leave_accrual_rules')
    .select('encashable, max_encashable_per_year')
    .eq('tenant_id', tenantId)
    .eq('leave_type_id', req.leave_type_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!rule?.encashable) {
    return { ok: false, message: 'This leave type does not allow encashment' }
  }

  // Validate current balance
  const { data: balRow } = await supabase
    .from('employee_leave_balance')
    .select('balance')
    .eq('tenant_id', tenantId)
    .eq('employee_id', req.employee_id)
    .eq('leave_type_id', req.leave_type_id)
    .eq('year', req.year)
    .maybeSingle()

  const currentBalance = Number(balRow?.balance ?? 0)
  if (currentBalance < req.days) {
    return { ok: false, message: `Insufficient balance. Available: ${currentBalance}, Requested: ${req.days}` }
  }

  // Deduct balance
  const newBalance = parseFloat((currentBalance - req.days).toFixed(2))
  await supabase.from('employee_leave_balance').upsert(
    { tenant_id: tenantId, employee_id: req.employee_id, leave_type_id: req.leave_type_id, year: req.year, balance: newBalance, updated_at: new Date().toISOString() },
    { onConflict: 'tenant_id,employee_id,leave_type_id,year' },
  )

  // Write explainability ledger entry (leave_balance_ledger — audit trail).
  await supabase.from('leave_balance_ledger').insert({
    tenant_id:       tenantId,
    employee_id:     req.employee_id,
    leave_type_id:   req.leave_type_id,
    year:            req.year,
    txn_type:        'encashment',
    delta:           -req.days,
    balance_after:   newBalance,
    encashment_id:   encashmentId,
    notes:           `Leave encashment approved — ${req.days} days`,
    created_by:      approverId,
  })

  // C6 dual-write: signed encashment debit in leave_accrual_ledger (authoritative
  // balance ledger). source_request_id = encashmentId for idempotency.
  await supabase
    .from('leave_accrual_ledger')
    .upsert({
      tenant_id:         tenantId,
      employee_id:       req.employee_id,
      leave_type_id:     req.leave_type_id,
      year:              req.year,
      accrual_type:      'encashment',
      days:              -Math.abs(req.days),
      accrued_on:        new Date().toISOString().slice(0, 10),
      is_expired:        false,
      notes:             `Leave encashment approved — ${req.days} days`,
      source_request_id: encashmentId,
    }, { onConflict: 'tenant_id,accrual_type,source_request_id', ignoreDuplicates: true })

  // Update request status
  await supabase.from('leave_encashment_requests').update({
    status:      'approved',
    approved_by: approverId,
    approved_at: new Date().toISOString(),
  }).eq('id', encashmentId)

  return { ok: true, message: `Encashment approved — ${req.days} days deducted` }
}
