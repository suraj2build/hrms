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
import { fetchAllRows } from './supabase-paginate.js'
import { round2, computeCleanGrossPay } from './payroll-engine.js'

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

// ── Atomic run claim (DEFECT-02, PR #30 UAT 2026-10-12) ───────────────────────
//
// Attempts to atomically claim the (tenant_id, run_period, leave_type_id) run
// slot for this call alone, using leave_accrual_runs' own unique constraint as
// the race-safe mechanism (the same claim-before-side-effects pattern
// comp-off.ts's approval route already uses — SYSCERT_AUDIT_2026-08-02.md H6).
//
// Returns the claimed row's id, or null if this call should skip (a prior
// 'success' run already exists, or another call currently holds the 'running'
// claim). A prior 'partial' or 'failed' run is reclaimable — HR retrying a
// failed run is a real, intended use case, not something this claim should
// block forever.
async function claimAccrualRun(
  supabase:     SupabaseClient,
  tenantId:     string,
  runPeriod:    string,
  leaveTypeId:  string,
  nowIso:       string,
): Promise<string | null> {
  const { data: inserted, error: insertErr } = await supabase
    .from('leave_accrual_runs')
    .insert({
      tenant_id:           tenantId,
      run_period:          runPeriod,
      leave_type_id:       leaveTypeId,
      employees_credited:  0,
      total_days_credited: 0,
      status:              'running',
      ran_at:              nowIso,
    })
    .select('id')

  if (!insertErr && (inserted?.length ?? 0) > 0) {
    return (inserted as Array<{ id: string }>)[0].id
  }

  // Insert lost the race (or a prior run already exists for this slot) — a
  // real constraint violation is the only reason this should fail; anything
  // else is a genuine error, not a race, and should not silently claim.
  if (insertErr && insertErr.code !== '23505') {
    return null
  }

  // Try to reclaim a previous 'partial' or 'failed' run. Matches 0 rows if
  // the existing row is 'success' (already done — correctly skip) or
  // 'running' (someone else's claim is live right now — correctly skip,
  // don't race them).
  const { data: reclaimed } = await supabase
    .from('leave_accrual_runs')
    .update({ status: 'running', ran_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('run_period', runPeriod)
    .eq('leave_type_id', leaveTypeId)
    .in('status', ['partial', 'failed'])
    .select('id')

  if ((reclaimed?.length ?? 0) > 0) {
    return (reclaimed as Array<{ id: string }>)[0].id
  }
  return null
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
  // Standard interval-overlap check: a rule applies to this period if it was
  // effective at ANY point during it — effective_from on or before the period's
  // LAST day, and effective_to (if set) on or after the period's FIRST day.
  // Comparing effective_from against the period's first day instead would wrongly
  // exclude any rule created mid-period (e.g. an HR admin adding a rule today and
  // running this same month's accrual — the ordinary case right after setup).
  const periodDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`
  const periodEndDate = new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10)
  const { data: rules, error: rulesErr } = await supabase
    .from('leave_accrual_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .lte('effective_from', periodEndDate)
    .or(`effective_to.is.null,effective_to.gte.${periodDate}`)

  if (rulesErr || !rules?.length) {
    result.errors.push(rulesErr?.message ?? 'No active accrual rules found')
    return result
  }

  const monthlyRules = rules.filter((r: AccrualRule) => r.accrual_frequency === 'monthly')
  if (!monthlyRules.length) return result   // Nothing to do this month

  // ── Fetch all active employees for tenant ──────────────────────────────────
  let employees: Array<{ id: string; joining_date: string }>
  let empErr: unknown = null
  try {
    employees = await fetchAllRows((from, to) =>
      supabase
        .from('employees')
        .select('id, joining_date')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('id')
        .range(from, to),
    )
  } catch (err) {
    employees = []
    empErr = err
  }

  if (empErr || !employees?.length) {
    result.errors.push(empErr ? (empErr as Error).message : 'No active employees found')
    return result
  }

  // Computed once — same for every employee in this accrual run
  const periodLastDay = new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10)
  const nowIso = new Date().toISOString()

  // ── Process each rule ──────────────────────────────────────────────────────
  for (const rule of monthlyRules as AccrualRule[]) {
    // DEFECT-02 (PR #30 Attendance/Leave UAT, 2026-10-12): the old idempotency
    // check was a pre-check SELECT against leave_accrual_runs, with the whole
    // employee-crediting loop below it and a terminal upsert only at the very
    // end. Two genuinely overlapping calls for the same tenant+period+rule
    // (an HR admin double-clicking "Run Accrual", or a manual trigger
    // overlapping a scheduled run) could both pass that pre-check — neither
    // had written the terminal row yet — and proceed to credit employees in
    // parallel: a lost-update race on employee_leave_balance (an absolute SET
    // of a pre-fetched balance + days, not an atomic increment), not reliably
    // prevented by the leave_accrual_ledger pre-check-then-insert alone (that
    // protects only the ledger's own rows, not the balance cache). Fixed the
    // same way comp-off.ts's approval route already does (SYSCERT_AUDIT_2026
    // -08-02.md H6 pattern): claim the run FIRST via a real INSERT against
    // leave_accrual_runs' own unique constraint (tenant_id, run_period,
    // leave_type_id, migration 454 added a 'running' status to its check
    // constraint for this) — the loser of a genuine race gets a real Postgres
    // 23505 back immediately, before either side has touched a single
    // employee's balance.
    const claimedRunId = await claimAccrualRun(supabase, tenantId, runPeriod, rule.leave_type_id, nowIso)
    if (!claimedRunId) {
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

    // days_per_period is DECIMAL(5,2) — PostgREST serializes it as a string. Number()
    // it here: proratedDays()'s full-month branch (`joining <= periodStart`) returns
    // its `daysPerPeriod` argument UNCHANGED, so for any employee who joined before
    // this period (i.e. most employees, every month) `days` stayed a raw string.
    // `currentBalance + days` then string-concatenated, and `.toFixed()` on the
    // resulting string threw a TypeError — crashing this loop for the whole rule,
    // before any employee's credit was written (confirmed by direct reproduction
    // with this table's real seed values; G13 sweep).
    for (const emp of employees as Array<{ id: string; joining_date: string }>) {
      const daysPerPeriod = Number(rule.days_per_period)
      const days = rule.prorate_on_joining
        ? proratedDays(daysPerPeriod, emp.joining_date, periodYear, periodMonth)
        : daysPerPeriod

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

      // leave_accrual_ledger's matching unique index (uidx_accrual_ledger_idempotency)
      // is PARTIAL (scoped to a fixed list of accrual_types, which 'monthly' is
      // one of) — Postgres can only use a partial index as an ON CONFLICT
      // inference target when the statement itself repeats the index's WHERE
      // predicate, which PostgREST's upsert(onConflict: '...') has no way to
      // express. A plain onConflict column list against it fails outright
      // ("no unique or exclusion constraint matching the ON CONFLICT
      // specification"). Sidestep it: pre-check which of this batch's keys
      // already exist and insert only the new ones — same idempotent effect
      // as the upsert's ignoreDuplicates was going for, without relying on
      // ON CONFLICT resolving against a partial index.
      const { data: existingLedgerRows, error: alFetchErr } = await supabase
        .from('leave_accrual_ledger')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('leave_type_id', rule.leave_type_id)
        .eq('year', periodYear)
        .eq('accrual_type', 'monthly')
        .eq('accrued_on', periodLastDay)
        .in('employee_id', alUpserts.map((r) => r.employee_id as string))

      if (alFetchErr) {
        runErrors.push(`Accrual ledger pre-check failed: ${alFetchErr.message}`)
      } else {
        const alreadyLogged = new Set((existingLedgerRows ?? []).map((r: { employee_id: string }) => r.employee_id))
        const newAlRows = alUpserts.filter((r) => !alreadyLogged.has(r.employee_id as string))
        if (newAlRows.length) {
          const { error: alErr } = await supabase.from('leave_accrual_ledger').insert(newAlRows)
          if (alErr) runErrors.push(`Accrual ledger batch failed: ${alErr.message}`)
        }
      }
    }

    // Finalize the claimed run — a plain UPDATE on the row this call alone
    // claimed above, not an upsert (no one else can race this row now).
    await supabase.from('leave_accrual_runs').update({
      employees_credited:  employeesCredited,
      total_days_credited: totalDays,
      status:              runErrors.length ? 'partial' : 'success',
      error_message:       runErrors.length ? runErrors.join('; ') : null,
      ran_at:              nowIso,
    }).eq('id', claimedRunId)

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

      // SYSCERT_AUDIT_2026-08-02.md C4 (ISSUE-156 parity): the carry_forward_max
      // cap can forfeit balance with no record of it anywhere — write a
      // forfeiture ledger entry against fromYear so the gap between the
      // employee's actual balance and what carried over is auditable instead
      // of silently vanishing. Mirrors leave-jobs.ts's carryForwardJob().
      const forfeitedDays = parseFloat((Number(bal.balance) - carryDays).toFixed(2))
      if (forfeitedDays > 0) {
        cfAlUpserts.push({
          tenant_id:     tenantId,
          employee_id:   bal.employee_id,
          leave_type_id: rule.leave_type_id,
          year:          fromYear,
          accrual_type:  'forfeiture',
          days:          -forfeitedDays,
          accrued_on:    carryAccruedOn,
          is_expired:    false,
          notes:         `Forfeited at year-end carry-forward cap (max ${rule.carry_forward_max} day(s)): ` +
            `${forfeitedDays} of ${bal.balance} day(s) from ${fromYear} balance did not carry over`,
        })
      }

      employeesProcessed++
      totalCarried = parseFloat((totalCarried + carryDays).toFixed(2))
    }

    // Batch write: 3 calls per rule regardless of employee count
    // (was 3 × N_employees sequential calls)
    if (cfBalUpserts.length) {
      const { error: cfBalErr } = await supabase
        .from('employee_leave_balance')
        .upsert(cfBalUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year' })
      if (cfBalErr) {
        // A missing/failed carry-forward balance write manifests to the employee
        // as "0 entitlement" with no trace of why — log loudly so it's discoverable.
        console.warn(
          `[accrual-engine] carry-forward employee_leave_balance upsert failed leaveType=${rule.leave_type_id} year=${toYear}:`,
          cfBalErr.message,
        )
      }

      // lint-tenant-ok: cfLedInserts rows already carry tenant_id (pushed with tenant_id: tenantId above) — insert payload is tenant-scoped even though the literal isn't inline in this query chain
      const { error: cfLedErr } = await supabase.from('leave_balance_ledger').insert(cfLedInserts)
      if (cfLedErr) {
        console.warn(
          `[accrual-engine] carry-forward leave_balance_ledger insert failed leaveType=${rule.leave_type_id} year=${toYear}:`,
          cfLedErr.message,
        )
      }

      const { error: cfAlErr } = await supabase
        // lint-tenant-ok: cfAlUpserts rows already carry tenant_id (pushed with tenant_id: tenantId above) — upsert payload is tenant-scoped even though the literal isn't inline in this query chain
        .from('leave_accrual_ledger')
        .upsert(cfAlUpserts, { onConflict: 'tenant_id,employee_id,leave_type_id,year,accrual_type,accrued_on', ignoreDuplicates: true })
      if (cfAlErr) {
        console.warn(
          `[accrual-engine] carry-forward leave_accrual_ledger upsert failed leaveType=${rule.leave_type_id} year=${toYear}:`,
          cfAlErr.message,
        )
      }
    }
  }

  return { employees_processed: employeesProcessed, total_days_carried: totalCarried }
}

// ── Process encashment approval ───────────────────────────────────────────────

function currentFinancialYear(d: Date): string {
  const y = d.getFullYear()
  const fyStart = d.getMonth() >= 3 ? y : y - 1 // getMonth() is 0-based — April (3) starts the Indian FY
  return `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`
}

/**
 * G12: the payout and withholding figures the audit found entirely missing
 * ("mark-paid only changes status, no proven disbursement path"). Computed
 * once at approval time and stored on the request row.
 *
 * rate_per_day mirrors lib/fnf-settlement-engine.ts's own leave-encashment
 * formula (last payroll gross / 26) so an employee sees the same per-day
 * rate whether they encash standalone or at separation — using the CLEAN
 * gross (payroll-engine.ts's computeCleanGrossPay), not the raw column: an
 * earlier one-time encashment payout folded into that same slip's gross_pay
 * must not inflate the rate a LATER encashment request computes for itself.
 *
 * tds_amount is a FLAT withholding at the employee's current marginal tax
 * slab (looked up from their latest tds_monthly_projections row this FY +
 * it_tax_slabs) — a real, working computation, but deliberately NOT a
 * Section 10(10AA) exemption computation (government vs non-government
 * treatment, the ₹25L lifetime cap). That needs tax/compliance sign-off
 * before go-live; this conservatively withholds 0 rather than guessing
 * when no projection exists yet this FY (e.g. payroll hasn't run for this
 * employee this year), instead of assuming a rate.
 */
async function computeEncashmentPayout(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  days:       number,
): Promise<{ ratePerDay: number; grossAmount: number; tdsAmount: number; netAmount: number }> {
  const { data: lastSlip } = await supabase
    .from('payroll_slips')
    .select('gross_pay, month, component_breakdown')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle()
  // Clean gross: excludes any one-time payout (e.g. an EARLIER standalone
  // encashment, payroll-engine.ts's applyEncashmentPayout) folded into this
  // slip's gross_pay — otherwise a second encashment request computed off
  // the same slip would overstate its own rate_per_day using a basis that
  // already includes someone else's one-time payment.
  const cleanGross = computeCleanGrossPay(
    Number((lastSlip as any)?.gross_pay ?? 0),
    ((lastSlip as any)?.component_breakdown ?? []) as Array<{ code?: string; monthly_amount?: number }>,
  )
  const ratePerDay  = round2(cleanGross / 26)
  const grossAmount = round2(days * ratePerDay)

  const fy = currentFinancialYear(new Date())
  const { data: projection } = await supabase
    .from('tds_monthly_projections')
    .select('taxable_income_projected, regime')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .eq('financial_year', fy)
    .order('projection_month', { ascending: false })
    .limit(1)
    .maybeSingle()

  let tdsAmount = 0
  if (projection) {
    const taxableIncome = Number((projection as any).taxable_income_projected ?? 0)
    const { data: slab } = await supabase
      .from('it_tax_slabs')
      .select('tax_rate')
      .eq('financial_year', fy)
      .eq('regime', (projection as any).regime)
      .lte('income_from', taxableIncome)
      .or(`income_to.is.null,income_to.gt.${taxableIncome}`)
      .order('slab_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (slab) tdsAmount = round2(grossAmount * Number((slab as any).tax_rate))
  }

  return { ratePerDay, grossAmount, tdsAmount, netAmount: round2(grossAmount - tdsAmount) }
}

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

  // Atomic check-and-deduct (previously: a plain read of `balance`, then a
  // separate upsert writing `balance - req.days` — a classic read-then-write
  // race. Two concurrent approve calls for the SAME request both read the
  // same balance and both deducted, double-debiting the employee for one
  // encashment. checked_deduct_leave_balance() does the check and the
  // deduction in one UPDATE ... WHERE balance >= p_days, so only one of two
  // concurrent calls can ever succeed — the other gets `deducted: false`.
  const { data: deducted, error: deductErr } = await supabase.rpc('checked_deduct_leave_balance', {
    p_tenant_id:     tenantId,
    p_employee_id:   req.employee_id,
    p_leave_type_id: req.leave_type_id,
    p_days:          req.days,
    p_year:          req.year,
  })
  if (deductErr) return { ok: false, message: `Failed to deduct balance: ${deductErr.message}` }
  if (!deducted) return { ok: false, message: `Insufficient balance for ${req.days} day(s) encashment` }

  // G12: compute what this approval is actually worth, and what will be
  // withheld, so approval carries a real payout figure HR can review —
  // the audit's "no proven disbursement path" gap starts here.
  const payout = await computeEncashmentPayout(supabase, tenantId, req.employee_id, req.days)

  // Status update — conditioned on still 'pending' and checked for affected
  // rows. Previously this had no status guard, no tenant_id filter, and its
  // error was never checked, so it could silently no-op while the balance
  // above had already been (and stayed) deducted.
  const { data: updatedRows, error: statusErr } = await supabase
    .from('leave_encashment_requests')
    .update({
      status:       'approved',
      approved_by:  approverId,
      approved_at:  new Date().toISOString(),
      rate_per_day: payout.ratePerDay,
      gross_amount: payout.grossAmount,
      tds_amount:   payout.tdsAmount,
      net_amount:   payout.netAmount,
    })
    .eq('id', encashmentId)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .select('id')

  if (statusErr) {
    return { ok: false, message: `Balance deducted but failed to update request status: ${statusErr.message}` }
  }
  if (!updatedRows?.length) {
    // Lost the race on the status update — roll back the deduction we just made.
    await supabase.rpc('credit_leave_balance', {
      p_tenant_id:     tenantId,
      p_employee_id:   req.employee_id,
      p_leave_type_id: req.leave_type_id,
      p_days:          req.days,
      p_year:          req.year,
    })
    return { ok: false, message: 'Request was already actioned by another request' }
  }

  // Fresh read for the explainability log field only — employee_leave_balance
  // (mutated atomically above) and leave_accrual_ledger below remain the
  // sources of truth; balance_after here is informational.
  const { data: balRow } = await supabase
    .from('employee_leave_balance')
    .select('balance')
    .eq('tenant_id', tenantId)
    .eq('employee_id', req.employee_id)
    .eq('leave_type_id', req.leave_type_id)
    .eq('year', req.year)
    .maybeSingle()

  // Write explainability ledger entry (leave_balance_ledger — audit trail).
  await supabase.from('leave_balance_ledger').insert({
    tenant_id:       tenantId,
    employee_id:     req.employee_id,
    leave_type_id:   req.leave_type_id,
    year:            req.year,
    txn_type:        'encashment',
    delta:           -req.days,
    balance_after:   Number(balRow?.balance ?? 0),
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
    }, { onConflict: 'tenant_id,accrual_type,source_request_id,year', ignoreDuplicates: true })

  return { ok: true, message: `Encashment approved — ${req.days} days deducted, net payout ₹${payout.netAmount}` }
}
