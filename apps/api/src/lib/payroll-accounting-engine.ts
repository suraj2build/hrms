/**
 * payroll-accounting-engine.ts
 *
 * Enterprise Payroll Financial Ledger & Accounting Engine.
 *
 * Responsibilities:
 *   1. Build double-entry accounting ledgers from immutable payroll snapshots.
 *   2. Map salary components to GL account codes (tenant-configurable).
 *   3. Validate that every ledger is balanced (∑ debit == ∑ credit).
 *   4. Build cost-center / department burden allocations.
 *   5. Build payout obligation records for bank reconciliation.
 *   6. Generate ERP-ready exports (SAP, Tally, Zoho, QuickBooks, generic CSV).
 *   7. Support accrual accounting (March expense / April payout pattern).
 *   8. Support safe reversals — never delete posted entries.
 *   9. Generate SHA-256 integrity hashes over each ledger.
 *
 * Design contract:
 *   - ALL accounting derives from payroll_employee_snapshots (frozen at finalization).
 *   - This engine NEVER reads attendance_daily, employee_compensations, or any
 *     other mutable source table.  Financial history is fully decoupled from live data.
 *   - Every debit has a matching credit.  Ledger balance check is enforced before posting.
 */

import { createHash }       from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { round2 }           from './payroll-engine.js'
import { buildPayrollRunSnapshot } from './payroll-snapshot-engine.js'
import { fetchAllRows }     from './supabase-paginate.js'
import * as XLSX            from 'xlsx'

// ── GL Account constants (system defaults, overridable per tenant) ────────────

export const GL = {
  // Assets
  BANK:                      { code: '1100', name: 'Bank Account' },
  // Liabilities
  PAYROLL_PAYABLE:           { code: '2100', name: 'Payroll Payable' },
  PAYROLL_ACCRUAL:           { code: '2105', name: 'Payroll Accrual Payable' },
  EPF_EMPLOYEE_PAYABLE:      { code: '2110', name: 'EPF Employee Payable' },
  EPF_EMPLOYER_PAYABLE:      { code: '2111', name: 'EPF Employer Payable' },
  ESI_EMPLOYEE_PAYABLE:      { code: '2120', name: 'ESI Employee Payable' },
  ESI_EMPLOYER_PAYABLE:      { code: '2121', name: 'ESI Employer Payable' },
  TDS_PAYABLE:               { code: '2130', name: 'TDS Payable' },
  PT_PAYABLE:                { code: '2140', name: 'Professional Tax Payable' },
  GRATUITY_PAYABLE:          { code: '2150', name: 'Gratuity Payable' },
  OTHER_STATUTORY_PAYABLE:   { code: '2199', name: 'Other Statutory Payable' },
  // Expenses
  SALARY_EXPENSE:            { code: '5000', name: 'Salary Expense' },
  BASIC_EXPENSE:             { code: '5001', name: 'Basic Salary Expense' },
  HRA_EXPENSE:               { code: '5002', name: 'HRA Expense' },
  EMPLOYER_PF:               { code: '5100', name: 'Employer PF Contribution' },
  EMPLOYER_ESI:              { code: '5110', name: 'Employer ESI Contribution' },
  GRATUITY_EXPENSE:          { code: '5200', name: 'Gratuity Expense' },
} as const

// ── Deduction component codes that map to specific statutory GL accounts ──────
const STATUTORY_DEDUCTION_MAP: Record<string, { code: string; name: string }> = {
  PF_EMPLOYEE:      GL.EPF_EMPLOYEE_PAYABLE,
  EPF_EMPLOYEE:     GL.EPF_EMPLOYEE_PAYABLE,
  ESI_EMPLOYEE:     GL.ESI_EMPLOYEE_PAYABLE,
  ESIC_EMPLOYEE:    GL.ESI_EMPLOYEE_PAYABLE,
  TDS:              GL.TDS_PAYABLE,
  INCOME_TAX:       GL.TDS_PAYABLE,
  PROFESSIONAL_TAX: GL.PT_PAYABLE,
  PT:               GL.PT_PAYABLE,
}

const EMPLOYER_CONTRIB_MAP: Record<string, { debitCode: string; debitName: string; creditCode: string; creditName: string }> = {
  PF_EMPLOYER:  { debitCode: GL.EMPLOYER_PF.code,  debitName: GL.EMPLOYER_PF.name,  creditCode: GL.EPF_EMPLOYER_PAYABLE.code, creditName: GL.EPF_EMPLOYER_PAYABLE.name },
  EPF_EMPLOYER: { debitCode: GL.EMPLOYER_PF.code,  debitName: GL.EMPLOYER_PF.name,  creditCode: GL.EPF_EMPLOYER_PAYABLE.code, creditName: GL.EPF_EMPLOYER_PAYABLE.name },
  ESI_EMPLOYER: { debitCode: GL.EMPLOYER_ESI.code, debitName: GL.EMPLOYER_ESI.name, creditCode: GL.ESI_EMPLOYER_PAYABLE.code, creditName: GL.ESI_EMPLOYER_PAYABLE.name },
  ESIC_EMPLOYER:{ debitCode: GL.EMPLOYER_ESI.code, debitName: GL.EMPLOYER_ESI.name, creditCode: GL.ESI_EMPLOYER_PAYABLE.code, creditName: GL.ESI_EMPLOYER_PAYABLE.name },
  GRATUITY:     { debitCode: GL.GRATUITY_EXPENSE.code, debitName: GL.GRATUITY_EXPENSE.name, creditCode: GL.GRATUITY_PAYABLE.code, creditName: GL.GRATUITY_PAYABLE.name },
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GLMapping {
  component_code:  string | null
  component_type:  string
  debit_gl_code:   string
  debit_gl_name:   string
  credit_gl_code:  string
  credit_gl_name:  string
  is_active?:      boolean
}

export interface LedgerEntryInput {
  entry_type:           string
  entry_category:       'expense' | 'liability' | 'asset' | 'equity'
  employee_id?:         string
  department_id?:       string
  cost_center_id?:      string
  gl_account_code:      string
  gl_account_name:      string
  debit_amount:         number
  credit_amount:        number
  description:          string
  source_component_code?: string
  source_component_name?: string
  accounting_date:      string
  journal_reference?:   string
}

export interface LedgerBuildResult {
  ledger_id:     string
  total_debit:   number
  total_credit:  number
  balanced:      boolean
  entry_count:   number
  integrity_hash: string
}

export interface CostAllocationRow {
  employee_id:     string
  department_id:   string | null
  cost_center_id:  string | null
  department_name: string | null
  cost_center_name: string | null
  gross_pay:       number
  net_pay:         number
  lop_recovery:    number
  employer_burden: number
  statutory_burden: number
  overtime_cost:   number
  total_cost:      number
  allocation_pct:  number
}

export interface ERPExportRow {
  date:          string
  reference:     string
  description:   string
  debit_account: string
  credit_account: string
  amount:        number
  currency:      string
  employee:      string
  department:    string
}

// ── Integrity hash ─────────────────────────────────────────────────────────────

export function generateAccountingIntegrityHash(entries: LedgerEntryInput[]): string {
  const canonical = JSON.stringify(
    [...entries].sort((a, b) => {
      const r = a.gl_account_code.localeCompare(b.gl_account_code)
      return r !== 0 ? r : (a.debit_amount - b.debit_amount)
    }),
    (key, val) => (val !== null && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val),
  )
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

// ── GL mapping resolver ───────────────────────────────────────────────────────

async function resolveGLMappings(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<GLMapping[]> {
  const { data } = await supabase
    .from('payroll_gl_mappings')
    .select('component_code, component_type, debit_gl_code, debit_gl_name, credit_gl_code, credit_gl_name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('component_code', { ascending: true, nullsFirst: false })

  return (data ?? []) as GLMapping[]
}

function findGLMapping(
  mappings: GLMapping[],
  componentCode: string,
  componentType: string,
): GLMapping | undefined {
  // Exact match first, then type-level fallback (NULL component_code)
  return (
    mappings.find(m => m.component_code === componentCode && m.is_active !== false) ??
    mappings.find(m => m.component_code === null && m.component_type === componentType)
  )
}

// ── Journal reference generator ───────────────────────────────────────────────

function journalRef(month: string, seq: number): string {
  return `PAY-${month}-${String(seq).padStart(4, '0')}`
}

// ── Core ledger entry builder ─────────────────────────────────────────────────

export function generateLedgerEntries(params: {
  employeeId:       string
  employeeCode:     string
  employeeName:     string
  month:            string
  seq:              number
  components:       Array<{
    code: string; name: string; component_type: string; monthly_amount: number
  }>
  grossPay:         number
  netPay:           number
  lopAmount:        number
  departmentId?:    string
  costCenterId?:    string
  glMappings:       GLMapping[]
  accountingDate:   string
}): LedgerEntryInput[] {
  const {
    employeeId, month, seq, components, grossPay, netPay,
    lopAmount, departmentId, costCenterId, glMappings, accountingDate,
  } = params
  const entries: LedgerEntryInput[] = []
  let seqN = seq * 100

  // ── Earning components: Dr Salary Expense / Cr Payroll Payable ───────────
  for (const c of components.filter(c => c.component_type === 'earning')) {
    if (c.monthly_amount <= 0) continue
    const mapping = findGLMapping(glMappings, c.code, 'earning')
    const debitGL  = mapping ? { code: mapping.debit_gl_code,  name: mapping.debit_gl_name  } : GL.SALARY_EXPENSE
    const creditGL = mapping ? { code: mapping.credit_gl_code, name: mapping.credit_gl_name } : GL.PAYROLL_PAYABLE
    const ref = journalRef(month, ++seqN)

    // Debit: salary expense
    entries.push({
      entry_type:           'salary_expense',
      entry_category:       'expense',
      employee_id:          employeeId,
      department_id:        departmentId,
      cost_center_id:       costCenterId,
      gl_account_code:      debitGL.code,
      gl_account_name:      debitGL.name,
      debit_amount:         round2(c.monthly_amount),
      credit_amount:        0,
      description:          `${c.name} — ${employeeId}`,
      source_component_code: c.code,
      source_component_name: c.name,
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
    // Credit: payroll payable
    entries.push({
      entry_type:           'net_payable',
      entry_category:       'liability',
      employee_id:          employeeId,
      department_id:        departmentId,
      cost_center_id:       costCenterId,
      gl_account_code:      creditGL.code,
      gl_account_name:      creditGL.name,
      debit_amount:         0,
      credit_amount:        round2(c.monthly_amount),
      description:          `${c.name} payable — ${employeeId}`,
      source_component_code: c.code,
      source_component_name: c.name,
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
  }

  // ── LOP deduction: Dr Payroll Payable / Cr Salary Expense (contra) ────────
  if (lopAmount > 0) {
    const ref = journalRef(month, ++seqN)
    entries.push({
      entry_type:           'lop_recovery',
      entry_category:       'liability',
      employee_id:          employeeId,
      gl_account_code:      GL.PAYROLL_PAYABLE.code,
      gl_account_name:      GL.PAYROLL_PAYABLE.name,
      debit_amount:         round2(lopAmount),
      credit_amount:        0,
      description:          `LOP recovery — ${employeeId}`,
      source_component_code: 'LOP',
      source_component_name: 'Loss of Pay',
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
    entries.push({
      entry_type:           'lop_recovery',
      entry_category:       'expense',
      employee_id:          employeeId,
      gl_account_code:      GL.SALARY_EXPENSE.code,
      gl_account_name:      GL.SALARY_EXPENSE.name,
      debit_amount:         0,
      credit_amount:        round2(lopAmount),
      description:          `LOP contra — ${employeeId}`,
      source_component_code: 'LOP',
      source_component_name: 'Loss of Pay',
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
  }

  // ── Employee deductions: Dr Payroll Payable / Cr Statutory Payable ────────
  for (const c of components.filter(c => c.component_type === 'deduction')) {
    if (c.monthly_amount <= 0) continue
    const creditGL = STATUTORY_DEDUCTION_MAP[c.code] ?? GL.OTHER_STATUTORY_PAYABLE
    const ref = journalRef(month, ++seqN)

    entries.push({
      entry_type:           'pf_employee',
      entry_category:       'liability',
      employee_id:          employeeId,
      gl_account_code:      GL.PAYROLL_PAYABLE.code,
      gl_account_name:      GL.PAYROLL_PAYABLE.name,
      debit_amount:         round2(c.monthly_amount),
      credit_amount:        0,
      description:          `${c.name} deduction — ${employeeId}`,
      source_component_code: c.code,
      source_component_name: c.name,
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
    entries.push({
      entry_type:           'pf_employee',
      entry_category:       'liability',
      employee_id:          employeeId,
      gl_account_code:      creditGL.code,
      gl_account_name:      creditGL.name,
      debit_amount:         0,
      credit_amount:        round2(c.monthly_amount),
      description:          `${c.name} payable — ${employeeId}`,
      source_component_code: c.code,
      source_component_name: c.name,
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
  }

  // ── Employer contributions: Dr Employer Expense / Cr Statutory Payable ────
  for (const c of components.filter(c => c.component_type === 'employer_contribution')) {
    if (c.monthly_amount <= 0) continue
    const glPair = EMPLOYER_CONTRIB_MAP[c.code]
    if (!glPair) continue
    const ref = journalRef(month, ++seqN)

    entries.push({
      entry_type:           'pf_employer',
      entry_category:       'expense',
      employee_id:          employeeId,
      gl_account_code:      glPair.debitCode,
      gl_account_name:      glPair.debitName,
      debit_amount:         round2(c.monthly_amount),
      credit_amount:        0,
      description:          `${c.name} — ${employeeId}`,
      source_component_code: c.code,
      source_component_name: c.name,
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
    entries.push({
      entry_type:           'pf_employer',
      entry_category:       'liability',
      employee_id:          employeeId,
      gl_account_code:      glPair.creditCode,
      gl_account_name:      glPair.creditName,
      debit_amount:         0,
      credit_amount:        round2(c.monthly_amount),
      description:          `${c.name} payable — ${employeeId}`,
      source_component_code: c.code,
      source_component_name: c.name,
      accounting_date:      accountingDate,
      journal_reference:    ref,
    })
  }

  return entries
}

// ── Validate balance ──────────────────────────────────────────────────────────

export function validateLedgerBalance(entries: LedgerEntryInput[]): {
  balanced:     boolean
  total_debit:  number
  total_credit: number
  variance:     number
} {
  const total_debit  = round2(entries.reduce((s, e) => s + e.debit_amount,  0))
  const total_credit = round2(entries.reduce((s, e) => s + e.credit_amount, 0))
  const variance     = round2(total_debit - total_credit)
  return { balanced: Math.abs(variance) < 0.01, total_debit, total_credit, variance }
}

// ── Cost center allocations ───────────────────────────────────────────────────

export function buildCostCenterAllocations(
  employeeSnapshots: Array<{
    employee_id:           string
    department_id?:        string
    cost_center_id?:       string
    department_name?:      string
    cost_center_name?:     string
    gross_pay:             number
    net_pay:               number
    deductions:            number
    overtime_hours:        number
    compensation_snapshot: { components: Array<{ code: string; component_type: string; monthly_amount: number }> } | null
  }>,
): CostAllocationRow[] {
  const totalCost = employeeSnapshots.reduce((s, e) => {
    const employerBurden = (e.compensation_snapshot?.components ?? [])
      .filter(c => c.component_type === 'employer_contribution')
      .reduce((b, c) => b + c.monthly_amount, 0)
    return s + e.gross_pay + employerBurden
  }, 0)

  return employeeSnapshots.map(e => {
    const comps         = e.compensation_snapshot?.components ?? []
    const employerBurden = round2(comps.filter(c => c.component_type === 'employer_contribution').reduce((b, c) => b + c.monthly_amount, 0))
    const statutoryBurden = round2(e.deductions)
    const otComp        = comps.find(c => c.code === 'OT' || c.code === 'OVERTIME')
    const overtimeCost  = round2(otComp?.monthly_amount ?? (e.overtime_hours > 0 ? e.overtime_hours * 100 : 0))
    const totalEmpCost  = round2(e.gross_pay + employerBurden)

    // e.deductions is the actual computed total_deductions for the month
    // (LOP + statutory), and net_pay = gross_pay - total_deductions always
    // holds — so gross_pay - net_pay - e.deductions was structurally always
    // 0 (fresh audit finding: this field silently read 0 for every employee,
    // every run, hiding LOP impact from cost-center reporting entirely).
    // compensation_snapshot.components is the employee's standing salary
    // STRUCTURE (not the computed slip), so its configured deduction lines
    // are a different, generally smaller figure than e.deductions — using
    // that as the subtrahend instead recovers an actual LOP estimate,
    // matching the same formula generateLedgerEntries already uses
    // correctly for GL journal entries elsewhere in this file.
    const structureDeductions = round2(comps.filter(c => c.component_type === 'deduction').reduce((s, c) => s + c.monthly_amount, 0))
    const lopRecovery = round2(Math.max(0, e.gross_pay - e.net_pay - structureDeductions))

    return {
      employee_id:       e.employee_id,
      department_id:     e.department_id ?? null,
      cost_center_id:    e.cost_center_id ?? null,
      department_name:   e.department_name ?? null,
      cost_center_name:  e.cost_center_name ?? null,
      gross_pay:         e.gross_pay,
      net_pay:           e.net_pay,
      lop_recovery:      lopRecovery,
      employer_burden:   employerBurden,
      statutory_burden:  statutoryBurden,
      overtime_cost:     overtimeCost,
      total_cost:        totalEmpCost,
      allocation_pct:    totalCost > 0 ? round2((totalEmpCost / totalCost) * 100) : 0,
    }
  })
}

// ── Payout obligations ────────────────────────────────────────────────────────

export function buildPayoutObligations(
  runId:    string,
  tenantId: string,
  ledgerId: string,
  slips: Array<{
    slip_id?:              string
    employee_id:           string
    net_pay:               number
    bank_account_masked?:  string
    ifsc_code?:            string
  }>,
): Array<Record<string, unknown>> {
  return slips.map(s => ({
    tenant_id:          tenantId,
    run_id:             runId,
    slip_id:            s.slip_id ?? null,
    employee_id:        s.employee_id,
    ledger_id:          ledgerId,
    expected_amount:    s.net_pay,
    paid_amount:        0,
    currency:           'INR',
    bank_account_masked: s.bank_account_masked ?? null,
    ifsc_code:          s.ifsc_code ?? null,
    payment_status:     'pending',
  }))
}

// ── Accrual entries (month-end accrual pattern) ───────────────────────────────

export function generateAccrualEntries(params: {
  month:          string
  totalGrossPay:  number
  accountingDate: string
  journalRef:     string
}): LedgerEntryInput[] {
  const { month, totalGrossPay, accountingDate, journalRef: ref } = params
  return [
    {
      entry_type:      'accrual',
      entry_category:  'expense',
      gl_account_code: GL.SALARY_EXPENSE.code,
      gl_account_name: GL.SALARY_EXPENSE.name,
      debit_amount:    round2(totalGrossPay),
      credit_amount:   0,
      description:     `Payroll accrual — ${month}`,
      accounting_date: accountingDate,
      journal_reference: ref,
    },
    {
      entry_type:      'accrual',
      entry_category:  'liability',
      gl_account_code: GL.PAYROLL_ACCRUAL.code,
      gl_account_name: GL.PAYROLL_ACCRUAL.name,
      debit_amount:    0,
      credit_amount:   round2(totalGrossPay),
      description:     `Payroll accrual payable — ${month}`,
      accounting_date: accountingDate,
      journal_reference: ref,
    },
  ]
}

export function generateAccrualClearingEntries(params: {
  month:          string
  totalGrossPay:  number
  totalNetPay:    number
  totalDeductions: number
  accountingDate: string
  journalRef:     string
}): LedgerEntryInput[] {
  const { month, totalGrossPay, totalNetPay, accountingDate, journalRef: ref } = params
  return [
    // Clear accrual
    {
      entry_type:      'accrual_reversal',
      entry_category:  'liability',
      gl_account_code: GL.PAYROLL_ACCRUAL.code,
      gl_account_name: GL.PAYROLL_ACCRUAL.name,
      debit_amount:    round2(totalGrossPay),
      credit_amount:   0,
      description:     `Accrual clearance — ${month}`,
      accounting_date: accountingDate,
      journal_reference: ref,
    },
    // Credit bank (net pay)
    {
      entry_type:      'payout',
      entry_category:  'asset',
      gl_account_code: GL.BANK.code,
      gl_account_name: GL.BANK.name,
      debit_amount:    0,
      credit_amount:   round2(totalNetPay),
      description:     `Bank disbursement — ${month}`,
      accounting_date: accountingDate,
      journal_reference: ref,
    },
  ]
}

// ── Main build function ───────────────────────────────────────────────────────

export async function buildPayrollFinancialLedger(
  supabase:     SupabaseClient,
  runId:        string,
  tenantId:     string,
  createdBy:    string,
  options: { ledger_type?: string; accounting_date?: string } = {},
): Promise<LedgerBuildResult | { error: string; code?: string }> {
  const { ledger_type = 'payroll', accounting_date } = options

  // 1. Verify snapshot exists (accounting MUST derive from snapshot).
  //    Self-heal: a run can be finalized without a snapshot because finalize
  //    builds it best-effort (non-fatal). If it's missing, try to (re)build it
  //    here from the finalized slips before giving up — this is what turns the
  //    historical "ledger 500" into a working flow.
  let { data: manifest } = await supabase
    .from('payroll_run_snapshots')
    .select('id, month, replayable')
    .eq('run_id', runId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!manifest) {
    const snap = await buildPayrollRunSnapshot(supabase, runId, tenantId, createdBy)
    if ('error' in snap) {
      // Can't build a snapshot (run not finalized / no slips) — actionable, not a 500.
      return { error: `Cannot generate the payroll snapshot this ledger derives from: ${snap.error}. Finalize the run first.`, code: 'SNAPSHOT_REQUIRED' }
    }
    const reloaded = await supabase
      .from('payroll_run_snapshots')
      .select('id, month, replayable')
      .eq('run_id', runId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    manifest = reloaded.data
    if (!manifest) return { error: 'Snapshot was created but could not be loaded', code: 'SNAPSHOT_REQUIRED' }
  }

  if (!(manifest as any).replayable) return { error: 'Snapshot is archived — accounting cannot be derived', code: 'SNAPSHOT_ARCHIVED' }

  const snapshotId = (manifest as any).id as string
  const month      = (manifest as any).month as string
  const acctDate   = accounting_date ?? `${month}-01`

  // 2. Check for existing ledger (prevent duplicates)
  const { data: existing } = await supabase
    .from('payroll_financial_ledgers')
    .select('id, ledger_status')
    .eq('run_id', runId)
    .eq('tenant_id', tenantId)
    .eq('ledger_type', ledger_type)
    .maybeSingle()

  if (existing && !['draft'].includes((existing as any).ledger_status)) {
    return { error: `Ledger already exists with status '${(existing as any).ledger_status}' — cannot regenerate`, code: 'LEDGER_EXISTS' }
  }

  // 3. Load employee snapshots (source of truth) — one row per employee in the
  // run, so a large tenant can exceed the server's per-request row cap.
  let empSnaps: any[]
  let eErr: unknown = null
  try {
    empSnaps = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_employee_snapshots')
        .select('employee_id, employee_code, employee_name, gross_pay, deductions, net_pay, overtime_hours, compensation_snapshot')
        .eq('snapshot_id', snapshotId)
        .eq('tenant_id', tenantId)
        .order('employee_id')
        .range(from, to),
    )
  } catch (err) {
    empSnaps = []
    eErr = err
  }

  if (eErr || !empSnaps || empSnaps.length === 0) {
    return { error: 'No employee snapshots found — cannot build ledger', code: 'SNAPSHOT_REQUIRED' }
  }

  // 4. Load employee department/cost-center data (live OK — metadata, not financial).
  // Chunked: a single .in() with thousands of UUIDs builds a request URL that
  // exceeds server/proxy request-line limits (confirmed in production at 400+ UUIDs).
  const empIds = (empSnaps as any[]).map(e => e.employee_id)
  const empMeta: any[] = []
  const EMP_META_CHUNK = 100
  for (let i = 0; i < empIds.length; i += EMP_META_CHUNK) {
    const { data: metaChunk } = await supabase
      .from('employees')
      .select('id, job_history!job_history_employee_id_fkey(department_id, department_name, is_current)')
      .in('id', empIds.slice(i, i + EMP_META_CHUNK))
    if (metaChunk) empMeta.push(...metaChunk)
  }

  const deptMap = new Map<string, { department_id: string | null; department_name: string | null }>(
    ((empMeta ?? []) as any[]).map(e => {
      const jh = (e.job_history ?? []).find((j: any) => j.is_current) ?? (e.job_history ?? [])[0] ?? null
      return [e.id, {
        department_id:   jh?.department_id ?? null,
        department_name: jh?.department_name ?? null,
      }]
    }),
  )

  // 5. Load GL mappings
  const glMappings = await resolveGLMappings(supabase, tenantId)

  // 6. Create ledger header (draft)
  const ledgerInsert: Record<string, unknown> = {
    tenant_id:    tenantId,
    run_id:       runId,
    snapshot_id:  snapshotId,
    ledger_month: month,
    ledger_type,
    ledger_status: 'draft',
    currency:      'INR',
    created_by:    createdBy,
    total_debit:   0,
    total_credit:  0,
  }

  const { data: ledger, error: lErr } = await supabase
    .from('payroll_financial_ledgers')
    .upsert(existing ? [{ id: (existing as any).id, ...ledgerInsert }] : [ledgerInsert], { onConflict: existing ? 'id' : undefined })
    .select('id')
    .single()

  if (lErr || !ledger) {
    // The (tenant_id, run_id, ledger_type) partial unique index backstops a
    // concurrent/duplicate build: the loser gets 23505 — report it as an
    // existing ledger rather than a generic failure.
    if ((lErr as any)?.code === '23505') {
      return { error: 'Ledger already exists for this run', code: 'LEDGER_EXISTS' }
    }
    return { error: `Failed to create ledger: ${lErr?.message}` }
  }
  const ledgerId = (ledger as any).id as string

  // 7. Generate all journal entries
  const allEntries: LedgerEntryInput[] = []
  let globalSeq = 0

  for (const emp of empSnaps as any[]) {
    const meta  = deptMap.get(emp.employee_id)
    const comps = (emp.compensation_snapshot?.components ?? []) as Array<{
      code: string; name: string; component_type: string; monthly_amount: number
    }>

    // Compute LOP amount: gross - net - statutory deductions
    const statutoryDedTotal = comps.filter(c => c.component_type === 'deduction').reduce((s, c) => s + c.monthly_amount, 0)
    const lopAmount = round2(Math.max(0, emp.gross_pay - emp.net_pay - statutoryDedTotal))

    const empEntries = generateLedgerEntries({
      employeeId:     emp.employee_id,
      employeeCode:   emp.employee_code ?? '',
      employeeName:   emp.employee_name ?? '',
      month,
      seq:            ++globalSeq,
      components:     comps,
      grossPay:       emp.gross_pay,
      netPay:         emp.net_pay,
      lopAmount,
      departmentId:   meta?.department_id ?? undefined,
      costCenterId:   undefined,
      glMappings,
      accountingDate: acctDate,
    })
    allEntries.push(...empEntries)
  }

  // 8. Validate balance
  const balance = validateLedgerBalance(allEntries)

  // 9. Compute integrity hash
  const integrityHash = generateAccountingIntegrityHash(allEntries)

  // 10. Bulk insert entries (chunks of 100)
  const entryRows = allEntries.map(e => ({
    ledger_id:            ledgerId,
    tenant_id:            tenantId,
    entry_type:           e.entry_type,
    entry_category:       e.entry_category,
    employee_id:          e.employee_id ?? null,
    department_id:        e.department_id ?? null,
    cost_center_id:       e.cost_center_id ?? null,
    gl_account_code:      e.gl_account_code,
    gl_account_name:      e.gl_account_name,
    debit_amount:         e.debit_amount,
    credit_amount:        e.credit_amount,
    currency:             'INR',
    description:          e.description,
    source_component_code: e.source_component_code ?? null,
    source_component_name: e.source_component_name ?? null,
    accounting_date:      e.accounting_date,
    journal_reference:    e.journal_reference ?? null,
  }))

  // Delete old draft entries if regenerating
  if (existing) {
    await supabase.from('payroll_ledger_entries').delete().eq('ledger_id', ledgerId)
  }

  const CHUNK = 100
  for (let i = 0; i < entryRows.length; i += CHUNK) {
    const { error: chunkErr } = await supabase.from('payroll_ledger_entries').insert(entryRows.slice(i, i + CHUNK))
    if (chunkErr) console.warn(`accounting-engine: entry chunk ${i / CHUNK} insert failed: ${chunkErr.message}`)
  }

  // 11. Update ledger header with totals + hash + status
  await supabase
    .from('payroll_financial_ledgers')
    .update({
      total_debit:    balance.total_debit,
      total_credit:   balance.total_credit,
      ledger_status:  balance.balanced ? 'balanced' : 'draft',
      integrity_hash: integrityHash,
    })
    .eq('id', ledgerId)

  // 12. Build and persist cost allocations
  const allocInputs = (empSnaps as any[]).map(emp => {
    const meta = deptMap.get(emp.employee_id)
    return {
      employee_id:    emp.employee_id,
      department_id:  meta?.department_id ?? undefined,
      department_name: meta?.department_name ?? undefined,
      gross_pay:      emp.gross_pay,
      net_pay:        emp.net_pay,
      deductions:     emp.deductions,
      overtime_hours: emp.overtime_hours ?? 0,
      compensation_snapshot: emp.compensation_snapshot,
    }
  })
  const allocations = buildCostCenterAllocations(allocInputs)

  // Delete old allocations if regenerating
  if (existing) {
    await supabase.from('payroll_cost_allocations').delete().eq('ledger_id', ledgerId)
  }

  const allocRows = allocations.map(a => ({
    ledger_id:       ledgerId,
    tenant_id:       tenantId,
    employee_id:     a.employee_id,
    department_id:   a.department_id,
    cost_center_id:  a.cost_center_id,
    department_name: a.department_name,
    cost_center_name: a.cost_center_name,
    gross_pay:       a.gross_pay,
    net_pay:         a.net_pay,
    lop_recovery:    a.lop_recovery,
    employer_burden: a.employer_burden,
    statutory_burden: a.statutory_burden,
    overtime_cost:   a.overtime_cost,
    total_cost:      a.total_cost,
    allocation_pct:  a.allocation_pct,
  }))

  for (let i = 0; i < allocRows.length; i += CHUNK) {
    await supabase.from('payroll_cost_allocations').insert(allocRows.slice(i, i + CHUNK))
  }

  return {
    ledger_id:      ledgerId,
    total_debit:    balance.total_debit,
    total_credit:   balance.total_credit,
    balanced:       balance.balanced,
    entry_count:    allEntries.length,
    integrity_hash: integrityHash,
  }
}

// ── Reversal engine ───────────────────────────────────────────────────────────

export async function reversePayrollLedger(
  supabase:    SupabaseClient,
  ledgerId:    string,
  tenantId:    string,
  reversedBy:  string,
  reason:      string,
): Promise<{ reversal_ledger_id: string } | { error: string }> {
  // Load original ledger
  const { data: original, error: oErr } = await supabase
    .from('payroll_financial_ledgers')
    .select('id, run_id, snapshot_id, ledger_month, ledger_type, ledger_status, total_debit, total_credit, reverses_ledger_id')
    .eq('id', ledgerId)
    .eq('tenant_id', tenantId)
    .single()

  if (oErr || !original) return { error: 'Ledger not found' }
  if ((original as any).ledger_status !== 'posted') return { error: 'Only posted ledgers can be reversed' }
  if ((original as any).reverses_ledger_id) return { error: 'This is already a reversal ledger — cannot reverse a reversal' }

  // Check no existing reversal
  const { data: existingRev } = await supabase
    .from('payroll_financial_ledgers')
    .select('id')
    .eq('reverses_ledger_id', ledgerId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (existingRev) return { error: 'Reversal already exists for this ledger' }

  // Load original entries
  const { data: entries, error: eErr } = await supabase
    .from('payroll_ledger_entries')
    .select('*')
    .eq('ledger_id', ledgerId)

  if (eErr || !entries) return { error: 'Failed to load ledger entries for reversal' }

  // Create reversal ledger header
  const { data: revLedger, error: rlErr } = await supabase
    .from('payroll_financial_ledgers')
    .insert({
      tenant_id:         tenantId,
      run_id:            (original as any).run_id,
      snapshot_id:       (original as any).snapshot_id,
      ledger_month:      (original as any).ledger_month,
      ledger_type:       'reversal',
      ledger_status:     'posted',   // reversals auto-post
      total_debit:       (original as any).total_credit,   // swapped
      total_credit:      (original as any).total_debit,    // swapped
      reverses_ledger_id: ledgerId,
      posted_at:         new Date().toISOString(),
      posted_by:         reversedBy,
      notes:             `Reversal of ledger ${ledgerId}. Reason: ${reason}`,
      created_by:        reversedBy,
    })
    .select('id')
    .single()

  if (rlErr || !revLedger) return { error: `Failed to create reversal ledger: ${rlErr?.message}` }
  const revLedgerId = (revLedger as any).id as string

  // Create mirror entries (swap debit ↔ credit)
  const revEntries = (entries as any[]).map(e => ({
    ledger_id:            revLedgerId,
    tenant_id:            tenantId,
    entry_type:           e.entry_type,
    entry_category:       e.entry_category,
    employee_id:          e.employee_id,
    department_id:        e.department_id,
    gl_account_code:      e.gl_account_code,
    gl_account_name:      e.gl_account_name,
    debit_amount:         e.credit_amount,    // swapped
    credit_amount:        e.debit_amount,     // swapped
    currency:             e.currency,
    description:          `[REVERSAL] ${e.description}`,
    source_component_code: e.source_component_code,
    source_component_name: e.source_component_name,
    accounting_date:      new Date().toISOString().slice(0, 10),
    journal_reference:    e.journal_reference ? `REV-${e.journal_reference}` : null,
  }))

  const CHUNK = 100
  for (let i = 0; i < revEntries.length; i += CHUNK) {
    await supabase.from('payroll_ledger_entries').insert(revEntries.slice(i, i + CHUNK))
  }

  // Mark original as reversed
  await supabase
    .from('payroll_financial_ledgers')
    .update({ ledger_status: 'reversed' })
    .eq('id', ledgerId)

  return { reversal_ledger_id: revLedgerId }
}

// ── ERP export engine ─────────────────────────────────────────────────────────

export async function exportGeneralLedger(
  supabase:  SupabaseClient,
  ledgerId:  string,
  tenantId:  string,
  format:    'csv' | 'sap' | 'tally' | 'zoho' | 'quickbooks' | 'xlsx',
): Promise<{ content: string | Buffer; filename: string; mime: string } | { error: string }> {
  const { data: entries, error } = await supabase
    .from('payroll_ledger_entries')
    .select(`
      accounting_date, journal_reference, description,
      gl_account_code, gl_account_name,
      debit_amount, credit_amount, currency,
      entry_type, source_component_code, source_component_name,
      cost_center_id, department_id,
      employees ( employee_code, profiles!profile_id ( full_name ) ),
      payroll_financial_ledgers ( ledger_month )
    `)
    .eq('ledger_id', ledgerId)
    .eq('tenant_id', tenantId)
    .order('accounting_date')
    .order('journal_reference')

  if (error) return { error: error.message }
  if (!entries || (entries as any[]).length === 0) return { error: 'No entries found' }

  // Resolve department + cost-center names (best-effort, one query each)
  const deptIds = [...new Set((entries as any[]).map(e => e.department_id).filter(Boolean))]
  const ccIds   = [...new Set((entries as any[]).map(e => e.cost_center_id).filter(Boolean))]

  const deptMap: Record<string, string> = {}
  const ccMap:   Record<string, string> = {}

  if (deptIds.length > 0) {
    const { data: depts } = await supabase.from('departments').select('id, name').in('id', deptIds)
    for (const d of (depts ?? [])) deptMap[(d as any).id] = (d as any).name
  }
  if (ccIds.length > 0) {
    const { data: ccs } = await supabase.from('cost_centers').select('id, name').in('id', ccIds)
    for (const c of (ccs ?? [])) ccMap[(c as any).id] = (c as any).name
  }

  const month = (entries as any[])[0]?.payroll_financial_ledgers?.ledger_month ?? 'unknown'
  const rows  = (entries as any[]).map(e => ({
    date:            e.accounting_date,
    reference:       e.journal_reference ?? '',
    description:     e.description ?? '',
    gl_code:         e.gl_account_code,
    gl_name:         e.gl_account_name,
    debit:           Number(e.debit_amount)  || 0,
    credit:          Number(e.credit_amount) || 0,
    currency:        e.currency,
    employee_code:   e.employees?.employee_code ?? '',
    employee_name:   e.employees?.profiles?.full_name ?? '',
    component:       e.source_component_code ?? '',
    component_name:  e.source_component_name ?? '',
    department_name: e.department_id ? (deptMap[e.department_id] ?? e.department_id.slice(0, 8)) : '',
    cost_center:     e.cost_center_id ? (ccMap[e.cost_center_id]  ?? e.cost_center_id.slice(0, 8)) : '',
  }))

  switch (format) {
    case 'xlsx':
      return buildXLSXVoucherExport(rows, month)
    case 'csv':
      return buildCSVExport(rows, month)
    case 'tally':
      return buildTallyExport(rows, month)
    case 'sap':
      return buildSAPExport(rows, month)
    case 'zoho':
    case 'quickbooks':
      return buildGenericJournalExport(rows, month, format)
    default:
      return buildCSVExport(rows, month)
  }
}

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function buildXLSXVoucherExport(rows: any[], month: string): { content: Buffer; filename: string; mime: string } {
  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Journal Vouchers ──────────────────────────────────────────────
  const journalData = [
    ['Date', 'Voucher Ref', 'Description', 'GL Code', 'GL Account', 'Cost Centre', 'Department', 'Component', 'Employee Code', 'Employee Name', 'Debit (₹)', 'Credit (₹)'],
    ...rows.map(r => [
      r.date, r.reference, r.description,
      r.gl_code, r.gl_name, r.cost_center, r.department_name,
      r.component_name || r.component, r.employee_code, r.employee_name,
      r.debit > 0 ? r.debit : '', r.credit > 0 ? r.credit : '',
    ]),
    [],
    ['', '', '', '', '', '', '', '', '', 'TOTAL',
      rows.reduce((s, r) => s + r.debit, 0),
      rows.reduce((s, r) => s + r.credit, 0),
    ],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(journalData)
  ws1['!cols'] = [10,18,30,10,28,18,18,20,12,20,14,14].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws1, 'Journal Vouchers')

  // ── Sheet 2: Cost Centre Ledger ────────────────────────────────────────────
  const ccMap = new Map<string, Map<string, { debit: number; credit: number }>>()
  for (const r of rows) {
    const cc = r.cost_center || 'Unassigned'
    if (!ccMap.has(cc)) ccMap.set(cc, new Map())
    const glMap = ccMap.get(cc)!
    const key = `${r.gl_code} — ${r.gl_name}`
    const prev = glMap.get(key) ?? { debit: 0, credit: 0 }
    glMap.set(key, { debit: prev.debit + r.debit, credit: prev.credit + r.credit })
  }
  const ccData: any[][] = [['Cost Centre', 'GL Code — Account', 'Total Debit (₹)', 'Total Credit (₹)', 'Net (₹)']]
  let ccGrandDebit = 0, ccGrandCredit = 0
  for (const [cc, glMap] of Array.from(ccMap.entries()).sort()) {
    let ccDebit = 0, ccCredit = 0
    for (const [glKey, totals] of Array.from(glMap.entries()).sort()) {
      ccData.push([cc, glKey, totals.debit || '', totals.credit || '', totals.debit - totals.credit])
      ccDebit  += totals.debit
      ccCredit += totals.credit
    }
    ccData.push(['', `${cc} Subtotal`, ccDebit, ccCredit, ccDebit - ccCredit])
    ccData.push([])
    ccGrandDebit  += ccDebit
    ccGrandCredit += ccCredit
  }
  ccData.push(['', 'GRAND TOTAL', ccGrandDebit, ccGrandCredit, ccGrandDebit - ccGrandCredit])
  const ws2 = XLSX.utils.aoa_to_sheet(ccData)
  ws2['!cols'] = [22, 36, 16, 16, 16].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws2, 'Cost Centre Ledger')

  // ── Sheet 3: GL Account Summary ────────────────────────────────────────────
  const glSummary = new Map<string, { name: string; debit: number; credit: number }>()
  for (const r of rows) {
    const prev = glSummary.get(r.gl_code) ?? { name: r.gl_name, debit: 0, credit: 0 }
    glSummary.set(r.gl_code, { name: r.gl_name, debit: prev.debit + r.debit, credit: prev.credit + r.credit })
  }
  const glData: any[][] = [['GL Code', 'GL Account Name', 'Total Debit (₹)', 'Total Credit (₹)', 'Net Balance (₹)', 'Category']]
  let glGrandDebit = 0, glGrandCredit = 0
  for (const [code, g] of Array.from(glSummary.entries()).sort()) {
    const net = g.debit - g.credit
    glData.push([code, g.name, g.debit || '', g.credit || '', net, net >= 0 ? 'Debit balance' : 'Credit balance'])
    glGrandDebit  += g.debit
    glGrandCredit += g.credit
  }
  glData.push([])
  glData.push(['', 'GRAND TOTAL', glGrandDebit, glGrandCredit, glGrandDebit - glGrandCredit, ''])
  const ws3 = XLSX.utils.aoa_to_sheet(glData)
  ws3['!cols'] = [12, 36, 16, 16, 16, 16].map(w => ({ wch: w }))
  XLSX.utils.book_append_sheet(wb, ws3, 'GL Account Summary')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return {
    content:  buffer,
    filename: `payroll-voucher-${month}.xlsx`,
    mime:     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
}

function buildCSVExport(rows: any[], month: string): { content: string; filename: string; mime: string } {
  const header = 'Date,Reference,Description,GL Code,GL Name,Debit,Credit,Currency,Employee Code,Employee Name,Component'
  const lines  = rows.map(r =>
    [r.date, r.reference, `"${r.description}"`, r.gl_code, `"${r.gl_name}"`,
     r.debit, r.credit, r.currency, r.employee_code, `"${r.employee_name}"`, r.component].join(','),
  )
  return {
    content:  [header, ...lines].join('\n'),
    filename: `payroll-gl-${month}.csv`,
    mime:     'text/csv',
  }
}

function buildTallyExport(rows: any[], month: string): { content: string; filename: string; mime: string } {
  // Tally XML format (simplified VCH voucher format)
  const vouchers = groupByReference(rows).map(({ ref, entries }) => {
    const debitLines  = entries.filter(e => e.debit > 0)
    const creditLines = entries.filter(e => e.credit > 0)
    const allLedgers  = [
      ...debitLines.map(e => `      <ALLLEDGERENTRIES.LIST><LEDGERNAME>${e.gl_name}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${e.debit}</AMOUNT></ALLLEDGERENTRIES.LIST>`),
      ...creditLines.map(e => `      <ALLLEDGERENTRIES.LIST><LEDGERNAME>${e.gl_name}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${e.credit}</AMOUNT></ALLLEDGERENTRIES.LIST>`),
    ].join('\n')
    return `  <VOUCHER VCHTYPE="Journal" ACTION="Create">
    <DATE>${debitLines[0]?.date?.replace(/-/g, '') ?? ''}</DATE>
    <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
    <VOUCHERNUMBER>${ref}</VOUCHERNUMBER>
    <NARRATION>${entries[0]?.description ?? ''}</NARRATION>
${allLedgers}
  </VOUCHER>`
  }).join('\n')

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE>
${vouchers}
  </TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY>
</ENVELOPE>`

  return { content, filename: `payroll-tally-${month}.xml`, mime: 'application/xml' }
}

function buildSAPExport(rows: any[], month: string): { content: string; filename: string; mime: string } {
  // SAP-style flat file (BAPI_ACC_GL_POSTING compatible CSV)
  const header = 'BSCHL,HKONT,WRBTR,SHKZG,ZUONR,SGTXT,BLDAT,BUDAT'
  const lines  = rows.map(r => {
    const amount = r.debit > 0 ? r.debit : r.credit
    const drCr   = r.debit > 0 ? 'S' : 'H'   // S=Debit, H=Credit in SAP
    return [r.gl_code, r.gl_code, amount, drCr, r.reference, `"${r.description}"`, r.date, r.date].join(',')
  })
  return {
    content:  [header, ...lines].join('\n'),
    filename: `payroll-sap-${month}.csv`,
    mime:     'text/csv',
  }
}

function buildGenericJournalExport(rows: any[], month: string, format: string): { content: string; filename: string; mime: string } {
  const header = 'JournalDate,JournalNumber,Account,AccountName,Debit,Credit,Description,Reference'
  const lines  = rows.map(r =>
    [r.date, r.reference, r.gl_code, `"${r.gl_name}"`, r.debit || '', r.credit || '', `"${r.description}"`, r.employee_code].join(','),
  )
  return {
    content:  [header, ...lines].join('\n'),
    filename: `payroll-${format}-${month}.csv`,
    mime:     'text/csv',
  }
}

function groupByReference(rows: any[]): Array<{ ref: string; entries: any[] }> {
  const map = new Map<string, any[]>()
  for (const r of rows) {
    const key = r.reference || 'MISC'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return Array.from(map.entries()).map(([ref, entries]) => ({ ref, entries }))
}
