/**
 * Operational Report Exports
 *
 * Server-generated Excel (.xlsx) exports for operational reporting:
 *
 *   GET /reports/muster-roll/export            — Monthly Muster Roll
 *   GET /reports/salary-sheet/export           — Salary Sheet (processed payroll_slips)
 *   GET /reports/leave-register/export         — Leave Register
 *   GET /reports/payroll-register/export       — Bank Disbursement Register
 *   GET /reports/attendance-payroll-comparison/export — Att vs Payroll Reconciliation
 *
 * All endpoints:
 *   - Require hr_admin or super_admin role
 *   - Scoped to req.tenantId (full tenant isolation)
 *   - Return application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *   - Include a "Report Info" metadata sheet with generation timestamp + filters
 *   - Freeze header row(s) and employee identity columns for easy scrolling
 *
 * Excel generation uses xlsx (SheetJS community edition — already in package.json).
 * Styling is limited to column widths, freeze panes, and number types
 * (community edition does not support cell background colors).
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import * as XLSX                from 'xlsx'
import { HR_ADMIN_ROLES }       from '../../lib/rbac.js'
import { fetchAllRows }         from '../../lib/supabase-paginate.js'
import { serverError, notFound, forbidden, validationError, ErrorCode } from '../../lib/api-errors.js'
const monthRe = /^\d{4}-\d{2}$/
const dateRe  = /^\d{4}-\d{2}-\d{2}$/

const MUSTER_EXPORT_LIMIT = 200_000

// ── Shared helpers ─────────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Map attendance status → compact cell code */
const STATUS_CODE: Record<string, string> = {
  present:    'P',
  late:       'L',
  absent:     'A',
  half_day:   'H',
  leave:      'LV',
  holiday:    'HO',
  weekly_off: 'WO',
  // 'weekend' is a distinct, actively-written status (attendance-processor.ts,
  // attendance_daily_status_check CHECK constraint) that the app's own
  // muster-codes.ts already treats identically to weekly_off ('WO') —
  // without this, a weekend-status cell fell through to "WE" (inconsistent
  // with the rest of the app) and was never counted in any tally below.
  weekend:    'WO',
}

const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function fmtMonthLabel(m: string): string {
  const [y, mon] = m.split('-').map(Number)
  return new Date(y, mon - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
}

function nowIst(): string {
  return new Date().toLocaleString('en-IN', {
    timeZone:  'Asia/Kolkata',
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

/**
 * Append a standardised "Report Info" sheet to every workbook.
 * Provides generation timestamp, filter context, and data provenance.
 */
function appendMetaSheet(
  wb:    XLSX.WorkBook,
  title: string,
  meta:  Record<string, string>,
): void {
  const rows: [string, string][] = [
    ['Report',        title],
    ['Generated At',  nowIst()],
    ['', ''],
    ...Object.entries(meta) as [string, string][],
    ['', ''],
    ['Note', 'All figures are as of the generation timestamp. Verify against finalized payroll before use.'],
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 24 }, { wch: 64 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Report Info')
}

/** Send an xlsx Buffer as a file download response. */
function sendXlsx(reply: any, wb: XLSX.WorkBook, filename: string): void {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  reply.header('Content-Disposition', `attachment; filename="${filename}"`)
  reply.send(buf)
}

// ── Payroll Register — shared data model ─────────────────────────────────────

/**
 * Per-employee row for the payroll disbursement register.
 *
 * account_number is stored as-is from employee_bank_statutory.  The DB schema
 * recommends masked storage ("xxxxxx1234") but does not enforce it — actual
 * data may be full account numbers or partially masked.  The JSON preview
 * endpoint applies an additional masking layer (last-4 only) before sending;
 * the Excel export returns the value as-stored and is restricted to hr_admin.
 */
interface PayRegRow {
  employee_id:      string
  employee_code:    string
  name:             string
  department:       string
  // Bank fields — from employee_bank_statutory (1:1 per employee)
  bank_name:        string | null
  account_number:   string | null  // as stored; preview endpoint masks to XXXX9999
  ifsc_code:        string | null
  branch_name:      string | null
  account_type:     string | null  // 'savings' | 'current' | 'salary'
  bank_complete:    boolean        // bank_name + account_number + ifsc_code all non-null
  // Payroll figures from payroll_slips
  gross_pay:        number
  lop_amount:       number
  total_deductions: number
  net_pay:          number
  // Slip status and derived payment readiness
  slip_status:      string         // 'draft' | 'finalized' | 'held'
  held_reason:      string | null
  /** Derived:
   *  finalized + bank_complete     → 'READY'
   *  finalized + !bank_complete    → 'MISSING_BANK'
   *  held                          → 'ON_HOLD'
   *  draft                         → 'PENDING'
   */
  payment_status:   'READY' | 'MISSING_BANK' | 'ON_HOLD' | 'PENDING'
}

function derivePaymentStatus(
  slipStatus:    string,
  bankComplete:  boolean,
): 'READY' | 'MISSING_BANK' | 'ON_HOLD' | 'PENDING' {
  if (slipStatus === 'held')  return 'ON_HOLD'
  if (slipStatus === 'draft') return 'PENDING'
  return bankComplete ? 'READY' : 'MISSING_BANK'
}

/**
 * Mask an account number for preview responses.
 * Returns the last 4 characters (digits or letters) preceded by 'XXXX'.
 * If the stored value is already short / masked, returns it unchanged.
 * Safe to call when account_number is already partially masked at DB level.
 */
function maskAccountForPreview(acct: string | null): string | null {
  if (!acct) return null
  const stripped = acct.replace(/\s/g, '')   // remove spaces
  if (stripped.length <= 4) return acct      // already short — don't re-mask
  return `XXXX${stripped.slice(-4)}`
}

/**
 * Fetch payroll register rows: merges payroll_slips with employee_bank_statutory
 * for all employees in a given payroll run.
 *
 * Called by both the JSON preview and the Excel export endpoints so the
 * numbers are always identical.  The preview endpoint additionally masks
 * account numbers before sending; the export returns them as-stored.
 */
async function fetchPayrollRegisterRows(
  supabase:      any,
  tenantId:      string,
  month:         string,
  run_id:        string | undefined,
  department_id: string | undefined,
  logger?:       any,
): Promise<{ rows: PayRegRow[]; runRow: any | null; error?: string }> {
  // ── 1. Resolve payroll run ───────────────────────────────────────────────
  let runRow: any = null
  if (run_id) {
    const { data, error: runErr } = await supabase
      .from('payroll_runs')
      .select('id, month, status, total_gross, total_net, total_deductions, total_lop_amount, employee_count, finalized_at, created_at')
      .eq('id', run_id)
      .eq('tenant_id', tenantId)
      .single()
    if (runErr && runErr.code !== 'PGRST116') {
      logger?.error({ err: runErr, run_id }, 'payroll-register: run lookup failed')
      return { rows: [], runRow: null, error: 'Failed to fetch payroll run' }
    }
    runRow = data
  } else {
    const { data, error: runErr } = await supabase
      .from('payroll_runs')
      .select('id, month, status, total_gross, total_net, total_deductions, total_lop_amount, employee_count, finalized_at, created_at')
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (runErr) {
      logger?.error({ err: runErr, month }, 'payroll-register: run lookup failed')
      return { rows: [], runRow: null, error: 'Failed to fetch payroll run' }
    }
    runRow = data
  }
  if (!runRow) return { rows: [], runRow: null }

  // ── 2. Fetch payroll slips with employee + department context ────────────
  let slips: any[]
  try {
    slips = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_slips')
        .select(`
          id, employee_id, status, held_reason,
          gross_pay, lop_amount, total_deductions, net_pay,
          employees!inner(
            id, first_name, last_name, employee_code,
            job_history!job_history_employee_id_fkey(department_id, is_current, departments(name))
          )
        `)
        .eq('run_id', runRow.id)
        .eq('tenant_id', tenantId)
        .range(from, to),
    )
  } catch (slipErr) {
    logger?.error({ err: slipErr, run_id: runRow.id }, 'payroll-register: slips query failed')
    return { rows: [], runRow, error: 'Failed to fetch payroll slips' }
  }
  if (slips.length === 0) return { rows: [], runRow }

  // ── 3. Department filter (post-fetch — same pattern as salary-sheet) ────
  let slipRows = slips
  if (department_id) {
    slipRows = slipRows.filter((s: any) => {
      const jh = Array.isArray(s.employees?.job_history)
        ? s.employees.job_history[0]
        : s.employees?.job_history
      return jh?.department_id === department_id
    })
  }

  // ── 4. Fetch bank details for all relevant employees ────────────────────
  // Left-join semantics: employees with no bank record get null bank fields.
  const employeeIds = slipRows.map((s: any) => s.employee_id)
  const bankMap = new Map<string, {
    bank_name: string | null; account_number: string | null
    ifsc_code: string | null; branch_name:    string | null
    account_type: string | null
  }>()

  if (employeeIds.length > 0) {
    // Chunked — a payroll run's employee count can exceed both the request-line
    // limit for a single .in() call and PostgREST's 1,000-row response ceiling.
    const ID_CHUNK = 200
    const bankRows: unknown[] = []
    for (let i = 0; i < employeeIds.length; i += ID_CHUNK) {
      const { data, error: bankErr } = await supabase
        .from('employee_bank_statutory')
        .select('employee_id, bank_name, account_number, ifsc_code, branch_name, account_type')
        .eq('tenant_id', tenantId)
        .in('employee_id', employeeIds.slice(i, i + ID_CHUNK))
      // A failed chunk must not be silently treated as "no bank record" — that
      // fabricates a MISSING_BANK flag on this finance-facing disbursement
      // register for employees whose bank details actually exist.
      if (bankErr) {
        logger?.error({ err: bankErr, run_id: runRow.id }, 'payroll-register: bank details query failed')
        return { rows: [], runRow, error: 'Failed to fetch employee bank details' }
      }
      if (data) bankRows.push(...data)
    }

    for (const b of bankRows as Array<{
      employee_id:    string
      bank_name:      string | null; account_number: string | null
      ifsc_code:      string | null; branch_name:    string | null
      account_type:   string | null
    }>) {
      bankMap.set(b.employee_id, {
        bank_name:      b.bank_name,
        account_number: b.account_number,
        ifsc_code:      b.ifsc_code,
        branch_name:    b.branch_name,
        account_type:   b.account_type,
      })
    }
  }

  // ── 5. Build register rows ───────────────────────────────────────────────
  const rows: PayRegRow[] = slipRows
    .sort((a: any, b: any) =>
      (a.employees?.employee_code ?? '').localeCompare(b.employees?.employee_code ?? ''),
    )
    .map((s: any) => {
      const emp      = s.employees
      const jh       = Array.isArray(emp?.job_history) ? emp.job_history[0] : emp?.job_history
      const deptName = (jh?.departments as { name?: string } | null)?.name ?? '—'
      const bank     = bankMap.get(s.employee_id)

      const bankComplete    = !!(bank?.bank_name && bank?.account_number && bank?.ifsc_code)
      const paymentStatus   = derivePaymentStatus(s.status, bankComplete)

      return {
        employee_id:      s.employee_id,
        employee_code:    emp?.employee_code ?? '—',
        name:             emp ? `${emp.first_name} ${emp.last_name}` : '—',
        department:       deptName,
        bank_name:        bank?.bank_name      ?? null,
        account_number:   bank?.account_number ?? null,
        ifsc_code:        bank?.ifsc_code      ?? null,
        branch_name:      bank?.branch_name    ?? null,
        account_type:     bank?.account_type   ?? null,
        bank_complete:    bankComplete,
        gross_pay:        r2(Number(s.gross_pay         ?? 0)),
        lop_amount:       r2(Number(s.lop_amount        ?? 0)),
        total_deductions: r2(Number(s.total_deductions  ?? 0)),
        net_pay:          r2(Number(s.net_pay           ?? 0)),
        slip_status:      s.status,
        held_reason:      s.held_reason ?? null,
        payment_status:   paymentStatus,
      }
    })

  return { rows, runRow }
}

// ── Attendance vs Payroll Comparison — shared data model ─────────────────────

/**
 * Per-employee row produced by fetchComparisonRows.
 * Shared between the JSON preview and the Excel export so both surfaces
 * present identical numbers.
 */
interface CompRow {
  employee_id:           string
  employee_code:         string
  name:                  string
  department:            string
  /** Payable days computed from attendance_daily.day_fraction for the month */
  att_payable_days:      number
  /** LOP days computed from attendance_daily.day_fraction for the month */
  att_lop_days:          number
  /** payable_days stored in payroll_slips (null when no run exists) */
  payroll_payable_days:  number | null
  /** lop_days stored in payroll_slips (null when no run exists) */
  payroll_lop_days:      number | null
  /** att_payable_days − payroll_payable_days  (0 when no slip) */
  diff_payable:          number
  /** att_lop_days − payroll_lop_days  (0 when no slip) */
  diff_lop:              number
  /** true when |diff_payable| > 0.01 OR |diff_lop| > 0.01 */
  is_mismatch:           boolean
  has_payroll_slip:      boolean
  /** ISO timestamp of MAX(updated_at) across attendance_daily rows in the month */
  last_recompute:        string | null
  /** Count of open/pending attendance_anomalies rows for this employee in the month */
  pending_anomalies:     number
  /** Count of PENDING leave_requests overlapping the month for this employee */
  pending_leaves:        number
}

/**
 * Fetch and merge attendance, payroll-slip, anomaly and pending-leave data
 * for all active employees of a tenant in a given month.
 *
 * Both the JSON preview endpoint and the Excel export endpoint call this
 * function so the numbers are always identical between the two surfaces.
 *
 * Defensive: the attendance_anomalies query failure is logged and silently
 * defaulted to zero so the report still renders even on schema differences.
 */
async function fetchComparisonRows(
  supabase:      any,
  tenantId:      string,
  month:         string,         // 'YYYY-MM'
  department_id: string | undefined,
  logger?:       any,
): Promise<{ rows: CompRow[]; runRow: any | null; error?: string }> {
  const [year, mon] = month.split('-').map(Number)
  const fromDate    = `${month}-01`
  // UTC-anchored month-end instead of new Date(year, mon, 0).toISOString() —
  // that constructs a LOCAL-TZ Date then serializes via UTC, so on a server
  // with a positive UTC offset local midnight of the last day rolls back to
  // the previous day in UTC, silently dropping the month's last calendar day
  // from every .lte('date', toDate) bound below.
  const toDate = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10)

  // ── 1. Active employees (optionally filtered by department) ───────────────
  // Paginated — an unbounded .select() truncates at PostgREST's 1,000-row
  // ceiling for a large tenant, silently dropping employees from the report.
  let employees: any[]
  try {
    employees = await fetchAllRows((from, to) =>
      supabase
        .from('employees')
        .select(`
          id, first_name, last_name, employee_code,
          job_history!job_history_employee_id_fkey(department_id, is_current, departments(name))
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .eq('job_history.is_current', true)
        .order('employee_code')
        .range(from, to),
    )
  } catch (empErr) {
    logger?.error({ err: empErr }, 'comparison: employee query failed')
    return { rows: [], runRow: null, error: 'Failed to fetch employees' }
  }

  // Department filter — post-fetch. job_history is embedded without !inner,
  // so .eq('job_history.department_id', ...) only nulls the nested JSON for
  // non-matching rows rather than removing the parent employees row —
  // GET /reports/attendance-payroll-comparison(/export)?department_id=X was
  // silently returning every employee in the tenant, not just department X.
  if (department_id) {
    employees = employees.filter((e: any) => {
      const jh = Array.isArray(e.job_history) ? e.job_history[0] : e.job_history
      return jh?.department_id === department_id
    })
  }

  // ── 2. Attendance aggregates for the month ────────────────────────────────
  // null day_fraction → legacy/unprocessed row → treat as 1.0 (present)
  // so we do not create phantom LOP.  This mirrors payroll-engine.ts.
  // Paginated — a month of attendance_daily across the tenant can exceed
  // the 1,000-row ceiling.
  const attRows = await fetchAllRows((from, to) =>
    supabase
      .from('attendance_daily')
      .select('employee_id, day_fraction, updated_at:date')
      .eq('tenant_id', tenantId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .range(from, to),
  )

  type AttAgg = { payable: number; lop: number; lastUpdate: string }
  const attMap = new Map<string, AttAgg>()

  for (const row of (attRows ?? []) as Array<{
    employee_id: string; day_fraction: number | null; updated_at: string
  }>) {
    const frac = row.day_fraction ?? 1.0
    if (!attMap.has(row.employee_id)) {
      attMap.set(row.employee_id, { payable: 0, lop: 0, lastUpdate: row.updated_at ?? '' })
    }
    const agg  = attMap.get(row.employee_id)!
    agg.payable = r2(agg.payable + frac)
    agg.lop     = r2(agg.lop + Math.max(0, 1.0 - frac))
    if ((row.updated_at ?? '') > agg.lastUpdate) agg.lastUpdate = row.updated_at ?? ''
  }

  // ── 3. Most recent payroll run for the month ──────────────────────────────
  // A transient query failure here must not fall through silently — the
  // sibling employees/anomalies/leaves queries above all check their error
  // and bail/log; this one previously discarded `error` entirely, so a
  // failed lookup meant runRow stayed undefined, slipMap stayed empty, and
  // EVERY employee in the report was flagged "NO SLIP" — indistinguishable
  // from "no payroll run exists yet for this month" on a finance
  // reconciliation report.
  const { data: runRow, error: runErr } = await supabase
    .from('payroll_runs')
    .select('id, status, finalized_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('month', month)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runErr) {
    logger?.error({ err: runErr }, 'comparison: payroll run query failed')
    return { rows: [], runRow: null, error: 'Failed to fetch payroll run' }
  }

  type SlipAgg = { payable_days: number; lop_days: number }
  const slipMap = new Map<string, SlipAgg>()

  if (runRow?.id) {
    // Paginated — a run's payroll_slips can exceed 1,000 rows for a large tenant.
    const slips = await fetchAllRows((from, to) =>
      supabase
        .from('payroll_slips')
        .select('employee_id, payable_days, lop_days')
        .eq('run_id', runRow.id)
        .eq('tenant_id', tenantId)
        .range(from, to),
    )

    for (const s of slips as Array<{
      employee_id: string; payable_days: number; lop_days: number
    }>) {
      slipMap.set(s.employee_id, {
        payable_days: Number(s.payable_days ?? 0),
        lop_days:     Number(s.lop_days     ?? 0),
      })
    }
  }

  // ── 4. Pending anomalies per employee in the month ────────────────────────
  // Defensive: if the table has a different schema/status enum, default to 0.
  // Paginated for the same reason as the queries above.
  const anomalyMap = new Map<string, number>()
  let anomalies: Array<{ employee_id: string }> = []
  try {
    anomalies = await fetchAllRows((from, to) =>
      supabase
        .from('attendance_anomalies')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('resolved', false)
        .gte('date', fromDate)
        .lte('date', toDate)
        .range(from, to),
    )
  } catch (anomalyErr) {
    logger?.warn({ err: anomalyErr }, 'comparison: anomaly query failed — defaulting to 0')
  }
  for (const a of anomalies) {
    anomalyMap.set(a.employee_id, (anomalyMap.get(a.employee_id) ?? 0) + 1)
  }

  // ── 5. Pending leave requests overlapping the month ───────────────────────
  const leaveMap = new Map<string, number>()
  let leaves: Array<{ employee_id: string }> = []
  try {
    leaves = await fetchAllRows((from, to) =>
      supabase
        .from('leave_requests')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'PENDING')
        .lte('from_date', toDate)   // leave starts on or before month end
        .gte('to_date', fromDate)   // leave ends on or after month start
        .range(from, to),
    )
  } catch (leaveErr) {
    logger?.warn({ err: leaveErr }, 'comparison: leave query failed — defaulting to 0')
  }
  for (const l of leaves) {
    leaveMap.set(l.employee_id, (leaveMap.get(l.employee_id) ?? 0) + 1)
  }

  // ── 6. Build merged comparison rows ──────────────────────────────────────
  const rows: CompRow[] = (employees as any[]).map(emp => {
    const jh       = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
    const deptName = (jh?.departments as { name?: string } | null)?.name ?? '—'
    const att      = attMap.get(emp.id)
    const slip     = slipMap.get(emp.id) ?? null

    const attPayable = att  ? att.payable  : 0
    const attLop     = att  ? att.lop      : 0
    const prPayable  = slip ? slip.payable_days : null
    const prLop      = slip ? slip.lop_days     : null

    const diffPayable = prPayable != null ? r2(attPayable - prPayable) : 0
    const diffLop     = prLop     != null ? r2(attLop     - prLop)     : 0
    const isMismatch  = prPayable != null && (
      Math.abs(diffPayable) > 0.01 || Math.abs(diffLop) > 0.01
    )

    return {
      employee_id:          emp.id,
      employee_code:        emp.employee_code,
      name:                 `${emp.first_name} ${emp.last_name}`,
      department:           deptName,
      att_payable_days:     attPayable,
      att_lop_days:         attLop,
      payroll_payable_days: prPayable,
      payroll_lop_days:     prLop,
      diff_payable:         diffPayable,
      diff_lop:             diffLop,
      is_mismatch:          isMismatch,
      has_payroll_slip:     slip != null,
      last_recompute:       att ? (att.lastUpdate || null) : null,
      pending_anomalies:    anomalyMap.get(emp.id) ?? 0,
      pending_leaves:       leaveMap.get(emp.id)   ?? 0,
    }
  })

  return { rows, runRow: runRow ?? null }
}

// ── Route plugin ───────────────────────────────────────────────────────────────

export default async function reportExportRoutes(fastify: FastifyInstance) {

  function hrAdminGuard(req: any, reply: any, done: () => void) {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      forbidden(reply, 'FORBIDDEN', 'HR admin access required')
      return
    }
    done()
  }

  const hrAuth = { preHandler: [fastify.authenticate, hrAdminGuard] }

  // ════════════════════════════════════════════════════════════════════════════
  // 1. MUSTER ROLL EXPORT
  //
  // Sheet 1 — Muster Roll: employee × date grid, status codes in cells.
  //   Frozen: first 2 header rows + first 4 employee-identity columns.
  //   Compact day columns (4 chars wide).
  //   Totals row at bottom.
  //
  // Sheet 2 — Summary: per-employee attendance count and payable/LOP days.
  //
  // Sheet 3 — Report Info: generation metadata.
  //
  // Filters: month (required), department_id (optional)
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/muster-roll/export', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      month:         z.string().regex(monthRe, 'month must be YYYY-MM'),
      department_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { month, department_id } = parsed.data
    const tenantId = req.tenantId as string

    const [year, mon] = month.split('-').map(Number)
    const fromDate    = `${month}-01`
    // UTC-anchored month-end — see fetchComparisonRows() above for why
    // new Date(year, mon, 0).toISOString() is unsafe on a non-UTC server.
    const toDate = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10)

    // Build ordered date list for the month
    const allDates: string[] = []
    const cur = new Date(`${fromDate}T12:00:00.000Z`)
    const end = new Date(`${toDate}T12:00:00.000Z`)
    while (cur <= end) {
      allDates.push(cur.toISOString().slice(0, 10))
      cur.setUTCDate(cur.getUTCDate() + 1)
    }

    // ── Fetch employees ────────────────────────────────────────────────────────
    let employees: any[]
    try {
      employees = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('employees')
          .select(`
        id, first_name, last_name, employee_code,
        job_history!job_history_employee_id_fkey(department_id, is_current, departments(name))
      `)
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .eq('job_history.is_current', true)
          .order('employee_code')
          .range(from, to),
      )
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch employees')
    }

    // Department filter — post-fetch, not .eq('job_history.department_id', …).
    // job_history is embedded without !inner, so a filter on the embed only
    // nulls out the nested JSON for non-matching rows; it never removes the
    // parent employees row. Filtering server-side there silently returned
    // every employee in the tenant regardless of department_id. Same
    // post-fetch pattern already used by the payroll-register/salary-sheet
    // helpers above.
    if (department_id) {
      employees = employees.filter((e: any) => {
        const jh = Array.isArray(e.job_history) ? e.job_history[0] : e.job_history
        return jh?.department_id === department_id
      })
    }

    if (employees.length === 0) {
      return notFound(reply, 'NO_DATA', 'No active employees found for the selected filters.')
    }

    // ── Fetch attendance_daily for the month ──────────────────────────────────
    let daily: any[]
    try {
      daily = await fetchAllRows((rangeFrom, rangeTo) =>
        fastify.supabase
          .from('attendance_daily')
          .select('employee_id, date, status, work_hours, late_minutes, overtime_minutes, day_fraction, is_payable')
          .eq('tenant_id', tenantId)
          .gte('date', fromDate)
          .lte('date', toDate)
          .range(rangeFrom, rangeTo),
      )
    } catch (err: any) {
      return serverError(req, reply, err, ErrorCode.QUERY_FAILED, 'Failed to fetch attendance records')
    }

    if (daily.length > MUSTER_EXPORT_LIMIT) {
      return reply.code(422).send({
        error:   'EXPORT_TOO_LARGE',
        message: `Export exceeds ${MUSTER_EXPORT_LIMIT.toLocaleString()} attendance rows. Narrow the filter (e.g. by department) and re-export.`,
      })
    }

    // attendance map: employeeId → date → record
    type DRow = { status: string; work_hours: number; late_minutes: number; overtime_minutes: number; day_fraction: number | null; is_payable: boolean }
    const attMap = new Map<string, Map<string, DRow>>()
    for (const row of daily as (DRow & { employee_id: string; date: string })[]) {
      if (!attMap.has(row.employee_id)) attMap.set(row.employee_id, new Map())
      attMap.get(row.employee_id)!.set(row.date, row)
    }

    // ── Sheet 1: Muster Roll Grid ──────────────────────────────────────────────
    // Fixed identity columns: # | Code | Name | Department
    const IDENTITY_COLS = 4
    // Summary columns appended after the day grid
    const SUMMARY_LABELS = ['P', 'L', 'A', 'H', 'LV', 'HO', 'WO', 'Payable', 'LOP', 'OT Hrs']

    // Header row 1: labels for identity + day numbers + summary labels
    const hdr1: (string | number)[] = ['#', 'Code', 'Name', 'Department']
    for (const d of allDates) hdr1.push(Number(d.slice(8, 10)))  // day number as Excel number
    SUMMARY_LABELS.forEach(l => hdr1.push(l))

    // Header row 2: blank for identity + day-of-week abbreviation
    const hdr2: string[] = ['', '', '', '']
    for (const d of allDates) hdr2.push(DOW_SHORT[new Date(`${d}T12:00:00Z`).getUTCDay()] ?? '')
    SUMMARY_LABELS.forEach(() => hdr2.push(''))

    // Per-employee data rows — also accumulates summary column values
    type SummaryTuple = [number, number, number, number, number, number, number, number, number, number]
    const gridRows: (string | number)[][] = []
    const summaryTuples: SummaryTuple[] = []

    for (let i = 0; i < (employees as any[]).length; i++) {
      const emp      = (employees as any[])[i]
      const jh       = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      const deptName = (jh?.departments as { name?: string } | null)?.name ?? '—'
      const empDays  = attMap.get(emp.id) ?? new Map<string, DRow>()

      // Tally counters
      let P = 0, L = 0, A = 0, H = 0, LV = 0, HO = 0, WO = 0
      let payable = 0, lop = 0, otHours = 0

      const row: (string | number)[] = [i + 1, emp.employee_code, `${emp.first_name} ${emp.last_name}`, deptName]

      for (const d of allDates) {
        const rec = empDays.get(d)
        if (!rec) {
          row.push('')
        } else {
          row.push(STATUS_CODE[rec.status] ?? rec.status.slice(0, 2).toUpperCase())
          const frac = rec.day_fraction ?? (rec.is_payable ? 1.0 : 0.0)
          switch (rec.status) {
            case 'present':    P++;  break
            case 'late':       L++;  break
            case 'absent':     A++;  break
            case 'half_day':   H++;  break
            case 'leave':      LV++; break
            case 'holiday':    HO++; break
            case 'weekly_off': WO++; break
            case 'weekend':    WO++; break
          }
          payable  = r2(payable + frac)
          lop      = r2(lop + Math.max(0, 1.0 - frac))
          otHours  = r2(otHours + (rec.overtime_minutes ?? 0) / 60)
        }
      }

      const summary: SummaryTuple = [P, L, A, H, LV, HO, WO, payable, lop, otHours]
      summary.forEach(v => row.push(v))
      gridRows.push(row)
      summaryTuples.push(summary)
    }

    // Totals row — blank day cells, numeric summary totals
    const totalsRow: (string | number)[] = ['', '', 'TOTALS', '']
    for (let _d = 0; _d < allDates.length; _d++) totalsRow.push('')
    for (let s = 0; s < SUMMARY_LABELS.length; s++) {
      totalsRow.push(r2(summaryTuples.reduce((acc, t) => acc + t[s], 0)))
    }

    const wsGrid = XLSX.utils.aoa_to_sheet([hdr1, hdr2, ...gridRows, totalsRow])
    wsGrid['!freeze'] = { xSplit: IDENTITY_COLS, ySplit: 2 }
    wsGrid['!cols'] = [
      { wch: 4 },  // #
      { wch: 12 }, // Code
      { wch: 24 }, // Name
      { wch: 18 }, // Department
      ...allDates.map(() => ({ wch: 4 })),   // compact day cells
      { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 },
      { wch: 9 }, { wch: 8 }, { wch: 8 },  // Payable, LOP, OT Hrs
    ]

    // ── Sheet 2: Employee Summary ──────────────────────────────────────────────
    const sumHdrs = [
      '#', 'Code', 'Name', 'Department',
      'Present', 'Late', 'Absent', 'Half Day', 'Leave', 'Holiday', 'Weekly Off',
      'Payable Days', 'LOP Days', 'OT Hours',
    ]
    const sumRows: (string | number)[][] = [sumHdrs]

    for (let i = 0; i < (employees as any[]).length; i++) {
      const emp      = (employees as any[])[i]
      const jh       = Array.isArray(emp.job_history) ? emp.job_history[0] : emp.job_history
      const deptName = (jh?.departments as { name?: string } | null)?.name ?? '—'
      const t        = summaryTuples[i]!
      sumRows.push([i + 1, emp.employee_code, `${emp.first_name} ${emp.last_name}`, deptName, ...t])
    }

    // Summary totals row
    const sumTotals: (string | number)[] = ['', '', 'TOTALS', '']
    for (let c = 4; c < sumHdrs.length; c++) {
      sumTotals.push(r2(sumRows.slice(1).reduce((acc, r) => acc + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0)))
    }
    sumRows.push(sumTotals)

    const wsSummary = XLSX.utils.aoa_to_sheet(sumRows)
    wsSummary['!freeze'] = { xSplit: 0, ySplit: 1 }
    wsSummary['!cols'] = [
      { wch: 4 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
      { wch: 8 }, { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 7 }, { wch: 8 }, { wch: 10 },
      { wch: 12 }, { wch: 9 }, { wch: 9 },
    ]

    // ── Assemble + send ────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsGrid,    'Muster Roll')
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')
    appendMetaSheet(wb, 'Muster Roll', {
      Month:              fmtMonthLabel(month),
      'Date Range':       `${fromDate} to ${toDate}`,
      Department:         department_id ? 'Filtered by department' : 'All Departments',
      'Total Employees':  String((employees as any[]).length),
      'Total Days':       String(allDates.length),
    })

    req.log.info({ month, employee_count: (employees as any[]).length, department_id }, 'muster-roll export generated')
    sendXlsx(reply, wb, `Muster_Roll_${month}${department_id ? '_dept' : ''}.xlsx`)
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 2. SALARY SHEET EXPORT
  //
  // Requires a processed payroll run for the given month (or run_id directly).
  // Uses actual payroll_slips data — NOT the comp master.
  //
  // Sheet 1 — Salary Sheet: one row per employee with all payment columns,
  //   earnings breakdown, deductions breakdown, net pay.
  //   Frozen: first row (headers) + first 5 identity columns.
  //
  // Sheet 2 — Department Summary: grouped totals by department.
  //
  // Sheet 3 — Report Info: generation metadata + run status.
  //
  // Filters: month (required), run_id (optional, defaults to most recent run
  //   for month), department_id (optional)
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/salary-sheet/export', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      month:         z.string().regex(monthRe, 'month must be YYYY-MM'),
      run_id:        z.string().uuid().optional(),
      department_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { month, run_id, department_id } = parsed.data
    const tenantId = req.tenantId as string

    // ── Resolve payroll run ────────────────────────────────────────────────────
    // Fresh audit finding: neither branch checked `error` — a transient DB
    // failure was silently treated the same as "no payroll run exists" and
    // returned to the caller as a 404 NO_RUN, masking a real server failure
    // as a data-not-found condition on a payroll/salary export endpoint.
    let runRow: any
    if (run_id) {
      const { data, error } = await fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, total_gross, total_net, total_deductions, total_lop_amount, employee_count, finalized_at, created_at')
        .eq('id', run_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll run')
      runRow = data
    } else {
      const { data, error } = await fastify.supabase
        .from('payroll_runs')
        .select('id, month, status, total_gross, total_net, total_deductions, total_lop_amount, employee_count, finalized_at, created_at')
        .eq('tenant_id', tenantId)
        .eq('month', month)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll run')
      runRow = data
    }

    if (!runRow) {
      return notFound(reply, 'NO_RUN', `No payroll run found for ${month}. Create a payroll run first via POST /payroll/runs.`)
    }

    // ── Fetch payroll slips with employee context ──────────────────────────────
    let slips: any[]
    try {
      slips = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('payroll_slips')
          .select(`
            employee_id, month, status,
            total_working_days, payable_days, lop_days, overtime_hours,
            ctc_monthly, gross_pay, lop_amount, total_deductions, net_pay, employer_contributions,
            component_breakdown,
            employees!inner(
              id, first_name, last_name, employee_code,
              job_history!job_history_employee_id_fkey(department_id, is_current, departments(name))
            )
          `)
          .eq('run_id', runRow.id)
          .eq('tenant_id', tenantId)
          .order('employees(employee_code)', { ascending: true })
          .range(from, to),
      )
    } catch (slipErr) {
      return serverError(req, reply, slipErr, ErrorCode.QUERY_FAILED, 'Failed to fetch payroll slips')
    }
    if (slips.length === 0) {
      return notFound(reply, 'NO_SLIPS', 'No payroll slips found for this run.')
    }

    // Apply department filter
    let rows = slips
    if (department_id) {
      rows = rows.filter((s: any) => {
        const jh = Array.isArray(s.employees?.job_history) ? s.employees.job_history[0] : s.employees?.job_history
        return jh?.department_id === department_id
      })
    }
    if (rows.length === 0) {
      return notFound(reply, 'NO_DATA', 'No slips match the selected department filter.')
    }

    // ── Discover component columns from component_breakdown ───────────────────
    // Maintain ordered lists per type to keep consistent column order
    const earningCols:    string[] = []
    const deductionCols:  string[] = []
    const employerCols:   string[] = []
    const seenComponents  = new Set<string>()

    for (const slip of rows) {
      for (const c of (slip.component_breakdown ?? []) as Array<{ name: string; type: string }>) {
        if (!seenComponents.has(c.name)) {
          seenComponents.add(c.name)
          if (c.type === 'earning')               earningCols.push(c.name)
          else if (c.type === 'deduction')        deductionCols.push(c.name)
          else if (c.type === 'employer_contribution') employerCols.push(c.name)
        }
      }
    }

    // ── Sheet 1: Salary Sheet ──────────────────────────────────────────────────
    const IDENTITY_COLS = 5  // freeze these: #, Code, Name, Dept, Status
    const headers: string[] = [
      '#', 'Emp Code', 'Employee Name', 'Department', 'Slip Status',
      'Working Days', 'Payable Days', 'LOP Days', 'OT Hours',
      'CTC Monthly',
      'Gross Pay',
      ...earningCols,
      'LOP Deduction',
      ...deductionCols.map(c => `${c}`),
      'Total Deductions',
      'Net Pay',
      ...employerCols.map(c => `${c} (Er.)`),
    ]

    const dataRows: (string | number)[][] = []

    for (let i = 0; i < rows.length; i++) {
      const s   = rows[i]
      const emp = s.employees
      const jh  = Array.isArray(emp?.job_history) ? emp.job_history[0] : emp?.job_history
      const dept = (jh?.departments as { name?: string } | null)?.name ?? '—'

      // Build component lookup from JSONB array
      const cbMap: Record<string, number> = {}
      for (const c of (s.component_breakdown ?? []) as Array<{ name: string; monthly_amount: number }>) {
        cbMap[c.name] = Number(c.monthly_amount ?? 0)
      }

      const row: (string | number)[] = [
        i + 1,
        emp?.employee_code ?? '—',
        emp ? `${emp.first_name} ${emp.last_name}` : '—',
        dept,
        s.status,
        Number(s.total_working_days ?? 0),
        r2(Number(s.payable_days  ?? 0)),
        r2(Number(s.lop_days      ?? 0)),
        r2(Number(s.overtime_hours ?? 0)),
        r2(Number(s.ctc_monthly   ?? 0)),
        r2(Number(s.gross_pay     ?? 0)),
        ...earningCols.map(c   => r2(cbMap[c]   ?? 0)),
        r2(Number(s.lop_amount    ?? 0)),
        ...deductionCols.map(c => r2(cbMap[c]   ?? 0)),
        r2(Number(s.total_deductions ?? 0)),
        r2(Number(s.net_pay       ?? 0)),
        ...employerCols.map(c  => r2(cbMap[c]   ?? 0)),
      ]
      dataRows.push(row)
    }

    // Totals row — sum all numeric columns from index 5 onwards
    const NUMERIC_START = 5
    const totalsRow: (string | number)[] = ['', '', 'TOTALS', '', '']
    for (let c = NUMERIC_START; c < headers.length; c++) {
      totalsRow.push(r2(dataRows.reduce((acc, r) => acc + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0)))
    }

    const wsSlips = XLSX.utils.aoa_to_sheet([headers, ...dataRows, totalsRow])
    wsSlips['!freeze'] = { xSplit: IDENTITY_COLS, ySplit: 1 }
    wsSlips['!cols'] = [
      { wch: 4 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 8 },
      { wch: 14 },  // CTC Monthly
      { wch: 12 },  // Gross Pay
      ...earningCols.map(() => ({ wch: 14 })),
      { wch: 14 },  // LOP Deduction
      ...deductionCols.map(() => ({ wch: 14 })),
      { wch: 16 },  // Total Deductions
      { wch: 12 },  // Net Pay
      ...employerCols.map(() => ({ wch: 14 })),
    ]

    // ── Sheet 2: Department Summary ────────────────────────────────────────────
    type DeptStat = { dept: string; count: number; gross: number; deductions: number; lop: number; net: number; ctc: number }
    const deptMap = new Map<string, DeptStat>()

    for (const s of rows) {
      const emp  = s.employees
      const jh   = Array.isArray(emp?.job_history) ? emp.job_history[0] : emp?.job_history
      const dept = (jh?.departments as { name?: string } | null)?.name ?? '—'
      if (!deptMap.has(dept)) deptMap.set(dept, { dept, count: 0, gross: 0, deductions: 0, lop: 0, net: 0, ctc: 0 })
      const ds      = deptMap.get(dept)!
      ds.count++
      ds.ctc        = r2(ds.ctc  + Number(s.ctc_monthly  ?? 0))
      ds.gross      = r2(ds.gross + Number(s.gross_pay   ?? 0))
      ds.lop        = r2(ds.lop  + Number(s.lop_amount   ?? 0))
      ds.deductions = r2(ds.deductions + Number(s.total_deductions ?? 0))
      ds.net        = r2(ds.net  + Number(s.net_pay      ?? 0))
    }

    const deptList = Array.from(deptMap.values()).sort((a, b) => a.dept.localeCompare(b.dept))
    const deptHdrs = ['Department', 'Employees', 'Total CTC', 'Total Gross', 'Total LOP', 'Total Deductions', 'Total Net Pay']
    const deptSheetRows: (string | number)[][] = [
      deptHdrs,
      ...deptList.map(d => [d.dept, d.count, d.ctc, d.gross, d.lop, d.deductions, d.net]),
    ]
    // Grand total
    deptSheetRows.push([
      'TOTAL',
      deptList.reduce((s, d) => s + d.count,      0),
      r2(deptList.reduce((s, d) => s + d.ctc,     0)),
      r2(deptList.reduce((s, d) => s + d.gross,   0)),
      r2(deptList.reduce((s, d) => s + d.lop,     0)),
      r2(deptList.reduce((s, d) => s + d.deductions, 0)),
      r2(deptList.reduce((s, d) => s + d.net,     0)),
    ])

    const wsDept = XLSX.utils.aoa_to_sheet(deptSheetRows)
    wsDept['!freeze'] = { xSplit: 0, ySplit: 1 }
    wsDept['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 14 }]

    // ── Assemble + send ────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsSlips, 'Salary Sheet')
    XLSX.utils.book_append_sheet(wb, wsDept,  'Dept Summary')
    appendMetaSheet(wb, 'Salary Sheet', {
      Month:              fmtMonthLabel(month),
      'Run ID':           String(runRow.id),
      'Run Status':       String(runRow.status),
      'Finalized At':     runRow.finalized_at ? String(runRow.finalized_at).slice(0, 19).replace('T', ' ') : 'Not finalized',
      Department:         department_id ? 'Filtered by department' : 'All Departments',
      'Total Employees':  String(rows.length),
      'Total Net Pay':    String(r2(rows.reduce((s: number, r: any) => s + Number(r.net_pay ?? 0), 0))),
    })

    req.log.info({ month, run_id: runRow.id, employee_count: rows.length }, 'salary-sheet export generated')
    const statusSlug = String(runRow.status).toLowerCase()
    sendXlsx(reply, wb, `Salary_Sheet_${month}_${statusSlug}.xlsx`)
  })

  // ════════════════════════════════════════════════════════════════════════════
  // LEAVE REGISTER PREVIEW (PEND-83)
  //
  // Backs the Reports page's Leave Register tab. GET /leave-requests (the
  // paginated general-purpose endpoint) has no department_id filter — adding
  // one there would mean pushing a nested employees→job_history filter
  // through a function shared by 2 other callers' offset/limit pagination,
  // or restructuring its count-then-paginate flow. Instead this mirrors
  // /reports/leave-register/export's own already-working approach: fetch
  // the full date-range result set via fetchAllRows (no 1000-row PostgREST
  // ceiling) and filter department post-fetch, since job_history can't be
  // pushed into an `!inner` filter without risking rows silently dropping.
  // Returning the complete filtered set (not a 200-row cap) also fixes the
  // KPI chips, which the frontend computes from the full response.
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/leave-register/preview', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      from:          z.string().regex(dateRe, 'from must be YYYY-MM-DD'),
      to:            z.string().regex(dateRe, 'to must be YYYY-MM-DD'),
      department_id: z.string().uuid().optional(),
      status:        z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL']).default('ALL'),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { from, to, department_id, status } = parsed.data
    const tenantId = req.tenantId as string

    let requests: any[]
    try {
      requests = await fetchAllRows((rangeFrom, rangeTo) => {
        let q = fastify.supabase
          .from('leave_requests')
          .select(`
            id, from_date, to_date, computed_days, half_day, session, hours_requested,
            status, created_at,
            leave_types(id, name),
            employees!inner(
              id, first_name, last_name, employee_code,
              job_history!job_history_employee_id_fkey(department_id, is_current)
            )
          `)
          .eq('tenant_id', tenantId)
          .gte('from_date', from)
          .lte('to_date', to)
          .order('created_at', { ascending: false })

        if (status !== 'ALL') q = q.eq('status', status)

        return q.range(rangeFrom, rangeTo)
      })
    } catch (lrErr) {
      return serverError(req, reply, lrErr, ErrorCode.QUERY_FAILED, 'Failed to fetch leave requests')
    }

    // Department filter — post-fetch, same reasoning as the export route
    // above: job_history is embedded without !inner, so filtering the nested
    // relation directly would silently null it out rather than filter rows.
    let filtered = requests as any[]
    if (department_id) {
      filtered = filtered.filter((r: any) => {
        const jh = Array.isArray(r.employees?.job_history) ? r.employees.job_history[0] : r.employees?.job_history
        return jh?.department_id === department_id
      })
    }

    const data = filtered.map((r: any) => ({
      id:              r.id,
      employee:        r.employees ? {
        employee_code: r.employees.employee_code,
        first_name:    r.employees.first_name,
        last_name:     r.employees.last_name,
      } : null,
      leave_type_name: (Array.isArray(r.leave_types) ? r.leave_types[0] : r.leave_types)?.name ?? null,
      from_date:       r.from_date,
      to_date:         r.to_date,
      computed_days:   r.computed_days,
      session:         r.session,
      status:          r.status,
      created_at:      r.created_at,
    }))

    return reply.send({ data })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 3. LEAVE REGISTER EXPORT
  //
  // Sheet 1 — Leave Register: one row per leave request, chronological.
  //   Includes employee, department, leave type, dates, days, session, status.
  //   Frozen: header row.
  //
  // Sheet 2 — Employee Summary: per-employee day totals by leave type.
  //
  // Sheet 3 — Report Info: generation metadata.
  //
  // Filters: from (required), to (required), department_id, leave_type_id, status
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/leave-register/export', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      from:          z.string().regex(dateRe, 'from must be YYYY-MM-DD'),
      to:            z.string().regex(dateRe, 'to must be YYYY-MM-DD'),
      department_id: z.string().uuid().optional(),
      leave_type_id: z.string().uuid().optional(),
      status:        z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL']).default('ALL'),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { from, to, department_id, leave_type_id, status } = parsed.data
    const tenantId = req.tenantId as string

    // ── Fetch leave requests ───────────────────────────────────────────────────
    // Paginated — an export whose whole purpose is completeness would silently
    // drop rows past PostgREST's 1,000-row ceiling for a wide date range/tenant.
    let requests: any[]
    try {
      requests = await fetchAllRows((rangeFrom, rangeTo) => {
        let q = fastify.supabase
          .from('leave_requests')
          .select(`
            id, from_date, to_date, computed_days, half_day, session, hours_requested,
            reason, status, created_at,
            leave_types(id, name, is_paid),
            employees!inner(
              id, first_name, last_name, employee_code,
              job_history!job_history_employee_id_fkey(department_id, is_current, departments(name))
            )
          `)
          .eq('tenant_id', tenantId)
          .gte('from_date', from)
          .lte('to_date', to)
          .order('from_date', { ascending: true })
          .order('employees(employee_code)', { ascending: true })

        if (status !== 'ALL')  q = q.eq('status', status)
        if (leave_type_id)     q = q.eq('leave_type_id', leave_type_id)

        return q.range(rangeFrom, rangeTo)
      })
    } catch (lrErr) {
      return serverError(req, reply, lrErr, ErrorCode.QUERY_FAILED, 'Failed to fetch leave requests')
    }

    // Apply department filter (post-fetch — can't easily push to Supabase with nested join)
    let filtered = requests as any[]
    if (department_id) {
      filtered = filtered.filter((r: any) => {
        const jh = Array.isArray(r.employees?.job_history) ? r.employees.job_history[0] : r.employees?.job_history
        return jh?.department_id === department_id
      })
    }

    if (filtered.length === 0) {
      return notFound(reply, 'NO_DATA', 'No leave requests found for the selected filters.')
    }

    // ── Sheet 1: Leave Register ────────────────────────────────────────────────
    const lrHdrs = [
      '#', 'Emp Code', 'Employee Name', 'Department',
      'Leave Type', 'Paid / Unpaid',
      'From Date', 'To Date', 'Days', 'Session', 'Hours',
      'Status', 'Applied On', 'Reason',
    ]

    const lrRows: (string | number)[][] = [lrHdrs]
    let totalDays = 0

    for (let i = 0; i < filtered.length; i++) {
      const lr  = filtered[i]
      const emp = lr.employees
      const jh  = Array.isArray(emp?.job_history) ? emp.job_history[0] : emp?.job_history
      const lt  = Array.isArray(lr.leave_types) ? lr.leave_types[0] : lr.leave_types
      const days = Number(lr.computed_days ?? 0)
      totalDays  = r2(totalDays + days)

      lrRows.push([
        i + 1,
        emp?.employee_code ?? '—',
        emp ? `${emp.first_name} ${emp.last_name}` : '—',
        (jh?.departments as { name?: string } | null)?.name ?? '—',
        lt?.name ?? '—',
        lt?.is_paid ? 'Paid' : 'Unpaid',
        lr.from_date,
        lr.to_date,
        days,
        lr.session ?? 'full_day',
        lr.hours_requested ? Number(lr.hours_requested) : '',
        lr.status,
        lr.created_at ? String(lr.created_at).slice(0, 10) : '',
        lr.reason ?? '',
      ])
    }

    // Totals row
    lrRows.push([
      '', '', `TOTAL — ${filtered.length} request${filtered.length !== 1 ? 's' : ''}`, '',
      '', '', '', '', totalDays,
      '', '', '', '', '',
    ])

    const wsLr = XLSX.utils.aoa_to_sheet(lrRows)
    wsLr['!freeze'] = { xSplit: 0, ySplit: 1 }
    wsLr['!cols'] = [
      { wch: 4 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
      { wch: 18 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 12 }, { wch: 7 },
      { wch: 12 }, { wch: 12 }, { wch: 40 },
    ]

    // ── Sheet 2: Employee Leave Summary ───────────────────────────────────────
    // Pivot: rows = employees, columns = leave types, values = days taken
    type EmpSum = { code: string; name: string; dept: string; byType: Record<string, number>; total: number }
    const empSumMap = new Map<string, EmpSum>()
    const allLeaveTypes = new Set<string>()

    for (const lr of filtered) {
      const emp    = lr.employees
      const jh     = Array.isArray(emp?.job_history) ? emp.job_history[0] : emp?.job_history
      const lt     = Array.isArray(lr.leave_types) ? lr.leave_types[0] : lr.leave_types
      const ltName = lt?.name ?? 'Unknown'
      allLeaveTypes.add(ltName)

      if (!empSumMap.has(emp?.id)) {
        empSumMap.set(emp?.id, {
          code:   emp?.employee_code ?? '—',
          name:   emp ? `${emp.first_name} ${emp.last_name}` : '—',
          dept:   (jh?.departments as { name?: string } | null)?.name ?? '—',
          byType: {},
          total:  0,
        })
      }
      const es   = empSumMap.get(emp?.id)!
      const days = Number(lr.computed_days ?? 0)
      es.byType[ltName] = r2((es.byType[ltName] ?? 0) + days)
      es.total           = r2(es.total + days)
    }

    const ltCols  = Array.from(allLeaveTypes).sort()
    const sumHdrs = ['#', 'Code', 'Name', 'Department', ...ltCols, 'Total Days']
    const empSumRows: (string | number)[][] = [sumHdrs]

    let idx = 0
    for (const [, es] of Array.from(empSumMap.entries())
        .sort((a, b) => a[1].name.localeCompare(b[1].name))) {
      idx++
      empSumRows.push([
        idx, es.code, es.name, es.dept,
        ...ltCols.map(lt => es.byType[lt] ?? 0),
        es.total,
      ])
    }

    // Pivot totals row
    const pivotTotals: (string | number)[] = ['', '', 'TOTALS', '']
    for (let c = 4; c < sumHdrs.length; c++) {
      pivotTotals.push(r2(empSumRows.slice(1).reduce((acc, r) => acc + (typeof r[c] === 'number' ? (r[c] as number) : 0), 0)))
    }
    empSumRows.push(pivotTotals)

    const wsEmpSum = XLSX.utils.aoa_to_sheet(empSumRows)
    wsEmpSum['!freeze'] = { xSplit: 0, ySplit: 1 }
    wsEmpSum['!cols'] = [
      { wch: 4 }, { wch: 12 }, { wch: 24 }, { wch: 18 },
      ...ltCols.map(() => ({ wch: 12 })),
      { wch: 12 },
    ]

    // ── Assemble + send ────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsLr,     'Leave Register')
    XLSX.utils.book_append_sheet(wb, wsEmpSum, 'Employee Summary')
    appendMetaSheet(wb, 'Leave Register', {
      'Date Range':       `${from} to ${to}`,
      'Status Filter':    status,
      Department:         department_id ? 'Filtered by department' : 'All Departments',
      'Leave Type':       leave_type_id ? 'Filtered by type' : 'All Types',
      'Total Requests':   String(filtered.length),
      'Total Leave Days': String(totalDays),
    })

    req.log.info({ from, to, status, employee_count: empSumMap.size, request_count: filtered.length }, 'leave-register export generated')
    const slug = status === 'ALL' ? 'all' : status.toLowerCase()
    sendXlsx(reply, wb, `Leave_Register_${from}_to_${to}_${slug}.xlsx`)
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 4. PAYROLL REGISTER WITH BANK DETAILS
  //
  // Finance-facing disbursement register.  Joins payroll_slips with
  // employee_bank_statutory so the finance team can verify net-pay amounts
  // against bank routing details and identify missing/incomplete bank records.
  //
  // Payment status is DERIVED (no dedicated DB column):
  //   finalized + bank complete  → READY
  //   finalized + bank missing   → MISSING BANK
  //   held                       → ON HOLD
  //   draft                      → PENDING
  //
  // SECURITY:
  //   • Both endpoints require hr_admin or super_admin role (hrAuth).
  //   • JSON preview: account_number masked to XXXX{last4} before sending.
  //   • Excel export: account_number returned as-stored (full or previously
  //     masked at entry time — see migration 012 comment).
  //     This file must be treated as a financial document and secured
  //     accordingly by the operator.
  //
  // JSON preview: GET /reports/payroll-register
  // Excel export: GET /reports/payroll-register/export
  //
  // Excel sheets:
  //   Sheet 1 — Bank Disbursement: one row per employee, full bank + pay data
  //   Sheet 2 — Dept Summary:      grouped totals, ready/held/missing counts
  //   Sheet 3 — Reconciliation:    disbursement totals by payment status
  //   Sheet 4 — Report Info:       run metadata, generation timestamp
  //
  // Filters: month (required), run_id (optional), department_id (optional)
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/payroll-register', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      month:         z.string().regex(monthRe, 'month must be YYYY-MM'),
      run_id:        z.string().uuid().optional(),
      department_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { month, run_id, department_id } = parsed.data
    const tenantId = req.tenantId as string

    const { rows, runRow, error } = await fetchPayrollRegisterRows(
      fastify.supabase, tenantId, month, run_id, department_id, req.log,
    )
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, error)

    // Mask account numbers before sending to the browser
    const maskedRows = rows.map(r => ({
      ...r,
      account_number: maskAccountForPreview(r.account_number),
    }))

    const readyRows   = rows.filter(r => r.payment_status === 'READY')
    const onHoldRows  = rows.filter(r => r.payment_status === 'ON_HOLD')
    const missingRows = rows.filter(r => r.payment_status === 'MISSING_BANK')

    req.log.info(
      { month, run_id: runRow?.id, department_id, row_count: rows.length,
        ready: readyRows.length, on_hold: onHoldRows.length, missing: missingRows.length },
      'payroll-register preview',
    )

    return reply.send({
      month,
      run: runRow ? {
        id:             runRow.id,
        status:         runRow.status,
        finalized_at:   runRow.finalized_at,
        employee_count: runRow.employee_count,
        total_gross:    r2(Number(runRow.total_gross ?? 0)),
        total_net:      r2(Number(runRow.total_net   ?? 0)),
      } : null,
      run_found: runRow != null,
      rows: maskedRows,
      summary: {
        total_employees:    rows.length,
        ready_count:        readyRows.length,
        on_hold_count:      onHoldRows.length,
        missing_bank_count: missingRows.length,
        pending_count:      rows.filter(r => r.payment_status === 'PENDING').length,
        total_gross:        r2(rows.reduce((s, r) => s + r.gross_pay,        0)),
        total_deductions:   r2(rows.reduce((s, r) => s + r.total_deductions, 0)),
        total_net:          r2(rows.reduce((s, r) => s + r.net_pay,          0)),
        ready_net:          r2(readyRows.reduce((s, r) => s + r.net_pay,     0)),
        on_hold_net:        r2(onHoldRows.reduce((s, r) => s + r.net_pay,    0)),
      },
    })
  })

  fastify.get('/reports/payroll-register/export', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      month:         z.string().regex(monthRe, 'month must be YYYY-MM'),
      run_id:        z.string().uuid().optional(),
      department_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { month, run_id, department_id } = parsed.data
    const tenantId = req.tenantId as string

    const { rows, runRow, error } = await fetchPayrollRegisterRows(
      fastify.supabase, tenantId, month, run_id, department_id, req.log,
    )
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, error)
    if (rows.length === 0) {
      return notFound(reply, 'NO_DATA', 'No payroll slips found for the selected filters.')
    }

    const readyRows       = rows.filter(r => r.payment_status === 'READY')
    const missingBankRows = rows.filter(r => r.payment_status === 'MISSING_BANK')
    const onHoldRows      = rows.filter(r => r.payment_status === 'ON_HOLD')
    const pendingRows     = rows.filter(r => r.payment_status === 'PENDING')

    // ── Sheet 1: Bank Disbursement ─────────────────────────────────────────
    const DISBURSE_HDRS = [
      '#', 'Emp Code', 'Employee Name', 'Department',
      'Bank Name', 'Account Number', 'IFSC Code', 'Branch', 'Account Type',
      'Gross Pay (₹)', 'LOP Deduction (₹)', 'Total Deductions (₹)', 'Net Pay (₹)',
      'Slip Status', 'Held Reason', 'Payment Status',
    ]
    const DISBURSE_COLS = [
      { wch: 4 }, { wch: 12 }, { wch: 26 }, { wch: 20 },
      { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 14 },
      { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 },
      { wch: 12 }, { wch: 30 }, { wch: 14 },
    ]

    const disburseDataRows: (string | number)[][] = rows.map((r, i) => [
      i + 1,
      r.employee_code,
      r.name,
      r.department,
      r.bank_name      ?? '— MISSING —',
      r.account_number ?? '— MISSING —',
      r.ifsc_code      ?? '— MISSING —',
      r.branch_name    ?? '',
      r.account_type   ?? '',
      r.gross_pay,
      r.lop_amount,
      r.total_deductions,
      r.net_pay,
      r.slip_status,
      r.held_reason    ?? '',
      r.payment_status,
    ])

    // Totals row
    const disburseTotals: (string | number)[] = [
      '', '', `TOTALS — ${rows.length} employees`, '', '', '', '', '', '',
      r2(rows.reduce((s, r) => s + r.gross_pay,        0)),
      r2(rows.reduce((s, r) => s + r.lop_amount,       0)),
      r2(rows.reduce((s, r) => s + r.total_deductions, 0)),
      r2(rows.reduce((s, r) => s + r.net_pay,          0)),
      '', '',
      `${readyRows.length} READY · ${onHoldRows.length} ON HOLD · ${missingBankRows.length} MISSING BANK`,
    ]

    const wsDisburse = XLSX.utils.aoa_to_sheet([DISBURSE_HDRS, ...disburseDataRows, disburseTotals])
    wsDisburse['!freeze'] = { xSplit: 4, ySplit: 1 }
    wsDisburse['!cols']   = DISBURSE_COLS

    // ── Sheet 2: Department Summary ────────────────────────────────────────
    type DeptDisb = {
      dept: string; employees: number
      ready: number; on_hold: number; missing: number; pending: number
      total_gross: number; total_deductions: number; total_net: number; ready_net: number
    }
    const deptMap = new Map<string, DeptDisb>()

    for (const r of rows) {
      if (!deptMap.has(r.department)) {
        deptMap.set(r.department, {
          dept: r.department, employees: 0,
          ready: 0, on_hold: 0, missing: 0, pending: 0,
          total_gross: 0, total_deductions: 0, total_net: 0, ready_net: 0,
        })
      }
      const d = deptMap.get(r.department)!
      d.employees++
      if (r.payment_status === 'READY')        d.ready++
      if (r.payment_status === 'ON_HOLD')      d.on_hold++
      if (r.payment_status === 'MISSING_BANK') d.missing++
      if (r.payment_status === 'PENDING')      d.pending++
      d.total_gross       = r2(d.total_gross       + r.gross_pay)
      d.total_deductions  = r2(d.total_deductions  + r.total_deductions)
      d.total_net         = r2(d.total_net         + r.net_pay)
      if (r.payment_status === 'READY') d.ready_net = r2(d.ready_net + r.net_pay)
    }

    const deptList  = Array.from(deptMap.values()).sort((a, b) => a.dept.localeCompare(b.dept))
    const deptHdrs  = [
      'Department', 'Employees', 'Ready to Pay', 'On Hold', 'Missing Bank', 'Pending',
      'Total Gross (₹)', 'Total Deductions (₹)', 'Total Net (₹)', 'Ready Net (₹)',
    ]
    const deptRows: (string | number)[][] = deptList.map(d => [
      d.dept, d.employees, d.ready, d.on_hold || '', d.missing || '', d.pending || '',
      d.total_gross, d.total_deductions, d.total_net, d.ready_net || '',
    ])
    deptRows.push([
      'TOTAL',
      deptList.reduce((s, d) => s + d.employees,        0),
      deptList.reduce((s, d) => s + d.ready,            0),
      deptList.reduce((s, d) => s + d.on_hold,          0) || '',
      deptList.reduce((s, d) => s + d.missing,          0) || '',
      deptList.reduce((s, d) => s + d.pending,          0) || '',
      r2(deptList.reduce((s, d) => s + d.total_gross,       0)),
      r2(deptList.reduce((s, d) => s + d.total_deductions,  0)),
      r2(deptList.reduce((s, d) => s + d.total_net,         0)),
      r2(deptList.reduce((s, d) => s + d.ready_net,         0)) || '',
    ])

    const wsDept = XLSX.utils.aoa_to_sheet([deptHdrs, ...deptRows])
    wsDept['!freeze'] = { xSplit: 0, ySplit: 1 }
    wsDept['!cols'] = [
      { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 9 },
      { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 18 },
    ]

    // ── Sheet 3: Reconciliation Totals ─────────────────────────────────────
    // Row-pair layout: label / value for quick finance sign-off
    const totalNet      = r2(rows.reduce((s, r) => s + r.net_pay,    0))
    const readyNet      = r2(readyRows.reduce((s, r) => s + r.net_pay,    0))
    const onHoldNet     = r2(onHoldRows.reduce((s, r) => s + r.net_pay,   0))
    const missingNet    = r2(missingBankRows.reduce((s, r) => s + r.net_pay, 0))

    const reconRows: (string | string | number)[][] = [
      ['PAYROLL DISBURSEMENT RECONCILIATION', ''],
      ['', ''],
      ['Payroll Month',          fmtMonthLabel(month)],
      ['Payroll Run ID',         runRow?.id          ?? 'N/A'],
      ['Run Status',             runRow?.status      ?? 'N/A'],
      ['Finalized At',           runRow?.finalized_at
        ? String(runRow.finalized_at).slice(0, 19).replace('T', ' ')
        : 'Not finalized'],
      ['', ''],
      ['EMPLOYEE COUNT',         ''],
      ['Total Employees in Run', rows.length],
      ['Ready to Pay',           readyRows.length],
      ['On Hold',                onHoldRows.length   || 0],
      ['Missing Bank Details',   missingBankRows.length || 0],
      ['Pending (Draft)',        pendingRows.length  || 0],
      ['', ''],
      ['DISBURSEMENT AMOUNTS (₹)', ''],
      ['Total Gross Pay',        r2(rows.reduce((s, r) => s + r.gross_pay,        0))],
      ['Total Deductions',       r2(rows.reduce((s, r) => s + r.total_deductions, 0))],
      ['Total Net Pay',          totalNet],
      ['', ''],
      ['Net Pay — READY (to disburse)',     readyNet],
      ['Net Pay — ON HOLD (withheld)',      onHoldNet   || 0],
      ['Net Pay — MISSING BANK (blocked)', missingNet  || 0],
      ['', ''],
      ['SECURITY NOTE', ''],
      ['Account Numbers', 'Shown as stored in the system. If full account numbers were entered during onboarding, they appear here in full.'],
      ['Distribution',   'Restrict to authorised finance personnel only. Delete after disbursement is confirmed.'],
    ]

    const wsRecon = XLSX.utils.aoa_to_sheet(reconRows)
    wsRecon['!cols'] = [{ wch: 32 }, { wch: 48 }]

    // ── Assemble + send ────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsDisburse, 'Bank Disbursement')
    XLSX.utils.book_append_sheet(wb, wsDept,     'Dept Summary')
    XLSX.utils.book_append_sheet(wb, wsRecon,    'Reconciliation')
    appendMetaSheet(wb, 'Payroll Register with Bank Details', {
      Month:                fmtMonthLabel(month),
      'Payroll Run ID':     runRow?.id     ?? 'N/A',
      'Run Status':         runRow?.status ?? 'N/A',
      'Finalized At':       runRow?.finalized_at
        ? String(runRow.finalized_at).slice(0, 19).replace('T', ' ')
        : 'Not finalized — amounts are preliminary',
      Department:           department_id ? 'Filtered by department' : 'All Departments',
      'Total Employees':    String(rows.length),
      'Ready to Pay':       String(readyRows.length),
      'Total Net Pay (₹)':  String(totalNet),
      'Ready Net Pay (₹)':  String(readyNet),
      'SECURITY NOTE':      'Contains bank account details. Restrict distribution to authorised finance personnel.',
    })

    req.log.info({
      month, run_id: runRow?.id,
      total: rows.length, ready: readyRows.length,
      on_hold: onHoldRows.length, missing_bank: missingBankRows.length,
    }, 'payroll-register export generated')

    const runSlug = String(runRow?.status ?? 'unknown').toLowerCase()
    sendXlsx(reply, wb, `Payroll_Register_${month}_${runSlug}.xlsx`)
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 5a. ATTENDANCE vs PAYROLL COMPARISON — JSON preview
  //
  // Returns the merged comparison data as JSON for the frontend preview table.
  // Same numbers as the Excel export (shared fetchComparisonRows helper).
  //
  // GET /reports/attendance-payroll-comparison?month=YYYY-MM&department_id=UUID
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/attendance-payroll-comparison', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      month:         z.string().regex(monthRe, 'month must be YYYY-MM'),
      department_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { month, department_id } = parsed.data
    const tenantId = req.tenantId as string

    const { rows, runRow, error } = await fetchComparisonRows(
      fastify.supabase, tenantId, month, department_id, req.log,
    )
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, error)

    const mismatchCount     = rows.filter(r => r.is_mismatch).length
    const noSlipCount       = rows.filter(r => !r.has_payroll_slip).length
    const noAttendanceCount = rows.filter(r => r.att_payable_days === 0 && r.att_lop_days === 0).length

    req.log.info(
      { month, department_id, row_count: rows.length, mismatch_count: mismatchCount },
      'att-payroll comparison preview',
    )

    return reply.send({
      month,
      run_id:      runRow?.id     ?? null,
      run_status:  runRow?.status ?? null,
      run_found:   runRow != null,
      rows,
      summary: {
        total_employees:     rows.length,
        mismatch_count:      mismatchCount,
        no_slip_count:       noSlipCount,
        no_attendance_count: noAttendanceCount,
      },
    })
  })

  // ════════════════════════════════════════════════════════════════════════════
  // 4b. ATTENDANCE vs PAYROLL COMPARISON — Excel export
  //
  // Sheet 1 — Comparison:   every active employee, FLAG column marks MISMATCH
  //   or NO SLIP rows.  Frozen: first 4 identity columns + header row.
  //
  // Sheet 2 — Mismatches:   same columns, filtered to problem rows only
  //   (mismatch OR no payroll slip).  Ready to hand to payroll team.
  //
  // Sheet 3 — Dept Summary: per-dept aggregates — mismatch count, no-slip
  //   count, net delta payable/LOP.
  //
  // Sheet 4 — Report Info:  generation timestamp, run context, mismatch rule.
  //
  // Mismatch rule: |att_payable − payroll_payable| > 0.01 days
  //
  // GET /reports/attendance-payroll-comparison/export?month=YYYY-MM&department_id=UUID
  // ════════════════════════════════════════════════════════════════════════════

  fastify.get('/reports/attendance-payroll-comparison/export', hrAuth, async (req: any, reply) => {
    const schema = z.object({
      month:         z.string().regex(monthRe, 'month must be YYYY-MM'),
      department_id: z.string().uuid().optional(),
    })
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message)
    }
    const { month, department_id } = parsed.data
    const tenantId = req.tenantId as string

    const { rows, runRow, error } = await fetchComparisonRows(
      fastify.supabase, tenantId, month, department_id, req.log,
    )
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, error)
    if (rows.length === 0) {
      return notFound(reply, 'NO_DATA', 'No active employees found for the selected filters.')
    }

    // ── Column layout (identical between Sheet 1 and Sheet 2) ─────────────────
    const HEADERS: string[] = [
      '#', 'Emp Code', 'Employee Name', 'Department',
      'Att. Payable Days', 'Payroll Payable Days', 'Δ Payable Days',
      'Att. LOP Days', 'Payroll LOP Days', 'Δ LOP Days',
      'Last Recompute (Att.)', 'Pending Anomalies', 'Pending Leaves',
      'Has Payroll Slip', 'Flag',
    ]
    const COL_WIDTHS = [
      { wch: 4 }, { wch: 12 }, { wch: 26 }, { wch: 20 },
      { wch: 18 }, { wch: 19 }, { wch: 14 },
      { wch: 14 }, { wch: 15 }, { wch: 12 },
      { wch: 22 }, { wch: 17 }, { wch: 14 },
      { wch: 16 }, { wch: 12 },
    ]

    /**
     * Convert a CompRow array to spreadsheet data rows.
     * The FLAG column ('MISMATCH' | 'NO SLIP' | '') allows Excel auto-filter
     * to find problems without relying on cell colours (not available in
     * SheetJS Community Edition).
     */
    function buildDataRows(data: CompRow[]): (string | number)[][] {
      return data.map((r, i) => {
        const flag = r.is_mismatch
          ? 'MISMATCH'
          : !r.has_payroll_slip ? 'NO SLIP' : ''
        return [
          i + 1,
          r.employee_code,
          r.name,
          r.department,
          r.att_payable_days,
          r.payroll_payable_days ?? '',
          r.has_payroll_slip ? r.diff_payable : '',
          r.att_lop_days || '',
          r.payroll_lop_days != null ? (r.payroll_lop_days || '') : '',
          r.has_payroll_slip ? (r.diff_lop || '') : '',
          r.last_recompute
            ? r.last_recompute.slice(0, 19).replace('T', ' ')
            : '—',
          r.pending_anomalies || '',
          r.pending_leaves    || '',
          r.has_payroll_slip ? 'Yes' : 'No',
          flag,
        ]
      })
    }

    // ── Sheet 1: All employees ─────────────────────────────────────────────────
    const withSlips    = rows.filter(r => r.has_payroll_slip)
    const mismatchRows = rows.filter(r => r.is_mismatch)
    const totalsRow: (string | number)[] = [
      '', '', `TOTALS — ${rows.length} employees`, '',
      r2(rows.reduce((s, r) => s + r.att_payable_days, 0)),
      r2(withSlips.reduce((s, r) => s + (r.payroll_payable_days ?? 0), 0)),
      r2(withSlips.reduce((s, r) => s + r.diff_payable, 0)),
      r2(rows.reduce((s, r) => s + r.att_lop_days, 0)),
      r2(withSlips.reduce((s, r) => s + (r.payroll_lop_days ?? 0), 0)),
      r2(withSlips.reduce((s, r) => s + r.diff_lop, 0)),
      '', '', '',
      `${withSlips.length} / ${rows.length} slips`,
      `${mismatchRows.length} mismatch${mismatchRows.length !== 1 ? 'es' : ''}`,
    ]

    const wsAll = XLSX.utils.aoa_to_sheet([HEADERS, ...buildDataRows(rows), totalsRow])
    wsAll['!freeze'] = { xSplit: 4, ySplit: 1 }
    wsAll['!cols']   = COL_WIDTHS

    // ── Sheet 2: Problem rows only (mismatch + no-slip) ───────────────────────
    const problemRows = rows.filter(r => r.is_mismatch || !r.has_payroll_slip)
    const wsMismatch  = XLSX.utils.aoa_to_sheet(
      problemRows.length > 0
        ? [HEADERS, ...buildDataRows(problemRows)]
        : [
            HEADERS,
            ['', '', '(No mismatches or missing slips found — all employees reconcile correctly)', '',
             ...Array(HEADERS.length - 4).fill('')],
          ],
    )
    wsMismatch['!freeze'] = { xSplit: 4, ySplit: 1 }
    wsMismatch['!cols']   = COL_WIDTHS

    // ── Sheet 3: Department Summary ────────────────────────────────────────────
    type DeptStat = {
      dept: string; employees: number; mismatches: number; noSlip: number
      totalAttPayable: number; totalPrPayable: number
      totalDiffPayable: number; totalDiffLop: number
    }
    const deptMap = new Map<string, DeptStat>()

    for (const r of rows) {
      if (!deptMap.has(r.department)) {
        deptMap.set(r.department, {
          dept: r.department, employees: 0, mismatches: 0, noSlip: 0,
          totalAttPayable: 0, totalPrPayable: 0, totalDiffPayable: 0, totalDiffLop: 0,
        })
      }
      const ds = deptMap.get(r.department)!
      ds.employees++
      if (r.is_mismatch)       ds.mismatches++
      if (!r.has_payroll_slip) ds.noSlip++
      ds.totalAttPayable = r2(ds.totalAttPayable + r.att_payable_days)
      if (r.has_payroll_slip) {
        ds.totalPrPayable   = r2(ds.totalPrPayable   + (r.payroll_payable_days ?? 0))
        ds.totalDiffPayable = r2(ds.totalDiffPayable + r.diff_payable)
        ds.totalDiffLop     = r2(ds.totalDiffLop     + r.diff_lop)
      }
    }

    const deptList = Array.from(deptMap.values()).sort((a, b) => a.dept.localeCompare(b.dept))
    const deptHdrs = [
      'Department', 'Employees', 'Mismatches', 'No Payroll Slip',
      'Total Att. Payable', 'Total Payroll Payable', 'Net Δ Payable', 'Net Δ LOP',
    ]
    const deptDataRows: (string | number)[][] = deptList.map(d => [
      d.dept, d.employees,
      d.mismatches || '',
      d.noSlip     || '',
      d.totalAttPayable,
      d.totalPrPayable  || '',
      d.totalDiffPayable || '',
      d.totalDiffLop    || '',
    ])
    // Grand-total row
    deptDataRows.push([
      'TOTAL',
      deptList.reduce((s, d) => s + d.employees,           0),
      deptList.reduce((s, d) => s + d.mismatches,          0) || '',
      deptList.reduce((s, d) => s + d.noSlip,              0) || '',
      r2(deptList.reduce((s, d) => s + d.totalAttPayable,  0)),
      r2(deptList.reduce((s, d) => s + d.totalPrPayable,   0)) || '',
      r2(deptList.reduce((s, d) => s + d.totalDiffPayable, 0)) || '',
      r2(deptList.reduce((s, d) => s + d.totalDiffLop,     0)) || '',
    ])

    const wsDept = XLSX.utils.aoa_to_sheet([deptHdrs, ...deptDataRows])
    wsDept['!freeze'] = { xSplit: 0, ySplit: 1 }
    wsDept['!cols'] = [
      { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 16 },
      { wch: 18 }, { wch: 19 }, { wch: 13 }, { wch: 11 },
    ]

    // ── Assemble + send ────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsAll,      'Comparison')
    XLSX.utils.book_append_sheet(wb, wsMismatch, 'Mismatches')
    XLSX.utils.book_append_sheet(wb, wsDept,     'Dept Summary')
    appendMetaSheet(wb, 'Attendance vs Payroll Comparison', {
      Month:              fmtMonthLabel(month),
      'Payroll Run':      runRow
        ? `${runRow.id} (${runRow.status})`
        : 'No run found for this month — payroll columns will be blank',
      'Run Finalized At': runRow?.finalized_at
        ? String(runRow.finalized_at).slice(0, 19).replace('T', ' ')
        : 'Not finalized',
      Department:         department_id ? 'Filtered by department' : 'All Departments',
      'Total Employees':  String(rows.length),
      'Mismatches':       String(mismatchRows.length),
      'No Payroll Slip':  String(rows.filter(r => !r.has_payroll_slip).length),
      'Mismatch Rule':    '|Att. payable days − Payroll payable days| > 0.01  OR  |Att. LOP − Payroll LOP| > 0.01',
    })

    req.log.info({
      month, department_id,
      total_employees:  rows.length,
      mismatches:       mismatchRows.length,
      no_slip:          rows.filter(r => !r.has_payroll_slip).length,
    }, 'att-payroll comparison export generated')

    sendXlsx(reply, wb, `Att_Payroll_Comparison_${month}${department_id ? '_dept' : ''}.xlsx`)
  })
}
