/**
 * assistant-tools.ts — the curated, READ-ONLY, RBAC-checked functions the LLM may
 * call (Tier 3). No open SQL, no writes. Each executor re-checks the caller's role
 * and tenant-scopes every query, so the model can never read across roles/tenants
 * regardless of what it asks for.
 *
 * Scope model (enforced inside every tool, never trusted to the model):
 *   - HR/Admin (super_admin, hr_admin): the whole tenant.
 *   - Manager: themselves + their direct reports.
 *   - Employee: themselves only.
 * Sensitive data (compensation/CTC, org-wide payroll) is HR/Admin-only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDirectReportIds, isHrAdmin } from '../manager-scope.js'
import type { ToolDef } from './llm.js'
import type { AssistantCaller } from './assistant-context.js'

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

function fmtINR(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

// ── Tool schemas advertised to the model ─────────────────────────────────────────
export const ASSISTANT_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'find_employee',
      description: "Look up an employee's profile by name or employee code — department, designation, manager, status, employment type, joining date and work location. Employees can only look up themselves; managers their direct reports; HR/Admin anyone. Does NOT return salary or sensitive IDs.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Employee name or employee code. Use "me" or "myself" for the current user.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_on_leave',
      description: "List people on approved leave on a specific date. Managers see their direct reports; HR sees the whole organisation. Use for questions like 'who is off tomorrow'.",
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'Date in YYYY-MM-DD' } },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_leave_balance',
      description: "Leave balances (by leave type) for an employee. Defaults to the current user; HR/managers may pass another employee's name (within their scope).",
      parameters: {
        type: 'object',
        properties: { employee: { type: 'string', description: 'Employee name/code. Omit for the current user.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_leave_requests',
      description: "Recent leave requests with their status (PENDING/APPROVED/REJECTED/CANCELLED). Defaults to the current user; HR/managers may pass an employee name or a status filter to see their scope.",
      parameters: {
        type: 'object',
        properties: {
          employee: { type: 'string', description: 'Employee name/code. Omit for the current user (or for HR/manager team-wide).' },
          status:   { type: 'string', description: 'Filter by status: PENDING, APPROVED, REJECTED or CANCELLED.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attendance',
      description: "Attendance for an employee on a date (present/absent/late/leave/holiday, work hours). Defaults to the current user and today. HR/Admin can ask 'who is absent today' by omitting the employee.",
      parameters: {
        type: 'object',
        properties: {
          employee: { type: 'string', description: 'Employee name/code. Omit for the current user, or (HR/Admin) for an org-wide absent count.' },
          date:     { type: 'string', description: 'Date in YYYY-MM-DD. Defaults to today.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_approvals',
      description: 'Count and summarise requests awaiting the user’s approval (leave + attendance regularisation). Managers see their direct reports; HR sees the whole organisation.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_employee_assets',
      description: "Company assets currently assigned to an employee (laptops, phones, access cards, etc.). Defaults to the current user; HR/managers may pass an employee name within their scope.",
      parameters: {
        type: 'object',
        properties: { employee: { type: 'string', description: 'Employee name/code. Omit for the current user.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_holidays',
      description: 'Upcoming public holidays for the organisation. Optionally bounded by a date range. Available to everyone.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to today.' },
          to:   { type: 'string', description: 'End date YYYY-MM-DD. Optional.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_headcount',
      description: 'Active employee headcount for the organisation. HR/Admin only. Optionally grouped by department.',
      parameters: {
        type: 'object',
        properties: { by_department: { type: 'boolean', description: 'Group the count by department' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_departments',
      description: 'List departments with their active headcount. HR/Admin and managers only.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payroll_cost',
      description: "Total payroll cost (gross, net, TDS) for the organisation in a given month. HR/Admin only. Use for questions like 'what is the payroll cost for April 2026'.",
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: 'Month in YYYY-MM format, e.g. 2026-04 for April 2026' } },
        required: ['month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payroll_run',
      description: "Status of the payroll run for a month (draft/processing/finalized/failed) with employee count and totals. HR/Admin only.",
      parameters: {
        type: 'object',
        properties: { month: { type: 'string', description: 'Month in YYYY-MM format, e.g. 2026-04' } },
        required: ['month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_compensation',
      description: "An employee's CTC (annual and monthly). SENSITIVE — HR/Admin only. Use for questions like 'what is <name>'s CTC'.",
      parameters: {
        type: 'object',
        properties: { employee: { type: 'string', description: 'Employee name or employee code.' } },
        required: ['employee'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_leave',
      description: "Apply for leave on behalf of the current employee. Always confirm the details with the user before calling this. Required: leave_type (e.g. 'Casual Leave', 'Sick Leave'), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD). Optional: reason.",
      parameters: {
        type: 'object',
        properties: {
          leave_type:  { type: 'string', description: 'Leave type name, e.g. Casual Leave, Sick Leave, Earned Leave' },
          start_date:  { type: 'string', description: 'Start date YYYY-MM-DD' },
          end_date:    { type: 'string', description: 'End date YYYY-MM-DD (same as start for single day)' },
          reason:      { type: 'string', description: 'Optional reason / remarks' },
        },
        required: ['leave_type', 'start_date', 'end_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_leave_request',
      description: "Cancel a pending leave request for the current employee. Use get_leave_requests first to find the request ID if the user hasn't provided it.",
      parameters: {
        type: 'object',
        properties: {
          request_id: { type: 'string', description: 'UUID of the leave request to cancel' },
        },
        required: ['request_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_helpdesk_ticket',
      description: "Raise a helpdesk/support ticket on behalf of the current employee. Use for requests like IT support, HR queries, payroll issues, etc.",
      parameters: {
        type: 'object',
        properties: {
          subject:     { type: 'string', description: 'Short title of the issue (max 120 chars)' },
          description: { type: 'string', description: 'Detailed description of the problem or request' },
          category:    { type: 'string', description: 'Category: it_support, hr_query, payroll, general. Default: general' },
          priority:    { type: 'string', description: 'Priority: low, medium, high. Default: medium' },
        },
        required: ['subject', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'regularize_attendance',
      description: "Submit an attendance regularization request for the current employee for a specific date (e.g. when they forgot to punch in/out, worked from a client site, had a biometric issue, etc.). Always confirm the date and reason before calling.",
      parameters: {
        type: 'object',
        properties: {
          date:               { type: 'string', description: 'Date to regularize in YYYY-MM-DD format' },
          regularization_type: { type: 'string', description: 'Type: missed_punch, forgot_checkout, onsite_duty, biometric_issue, client_visit, wfh, field_work, system_issue. Default: missed_punch' },
          requested_check_in:  { type: 'string', description: 'Requested check-in time as HH:MM (24h). Optional.' },
          requested_check_out: { type: 'string', description: 'Requested check-out time as HH:MM (24h). Optional.' },
          reason:              { type: 'string', description: 'Explanation / remarks for the regularization request' },
        },
        required: ['date', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payslip',
      description: "Get the current employee's payslip summary for a given month, or the most recent finalized payslip if no month is given.",
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'Month in YYYY-MM format (e.g. 2026-05). Omit for the most recent payslip.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_contact_info',
      description: "Update the current employee's personal contact phone number. Use only when the user explicitly asks to update their phone number. Always confirm the number before calling.",
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'New phone number (digits, spaces, +, hyphens allowed; 10–15 chars)' },
        },
        required: ['phone'],
      },
    },
  },
]

interface ToolCtx {
  supabase:   SupabaseClient
  caller:     AssistantCaller
  employeeId: string | null
}

interface EmpRow {
  id: string
  first_name: string | null
  last_name:  string | null
  employee_code: string | null
  status: string | null
  employment_type: string | null
  joining_date: string | null
  work_location: string | null
  manager_id: string | null
  department_id: string | null
  designation_id: string | null
}

const EMP_COLS = 'id, first_name, last_name, employee_code, status, employment_type, joining_date, work_location, manager_id, department_id, designation_id'

function fullName(e: { first_name: string | null; last_name: string | null }): string {
  return `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Unknown'
}

/** Strip anything that could break a PostgREST .or() filter; keep letters/digits/space. */
function sanitizeQuery(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

type ResolveResult =
  | { ok: true; emp: EmpRow }
  | { ok: false; message: string }

/**
 * Resolve a free-text employee reference to a single employee the caller is
 * ALLOWED to see. Enforces the scope model. Returns a friendly message on
 * not-found / ambiguous / forbidden so the model can relay it.
 */
async function resolveEmployee(ctx: ToolCtx, rawQuery: string | undefined): Promise<ResolveResult> {
  const hr = isHrAdmin(ctx.caller.userRole)
  const self = ctx.employeeId

  // "me"/"myself"/empty → the caller themselves.
  const q = (rawQuery ?? '').trim()
  const wantsSelf = q === '' || /^(me|myself|my|i)$/i.test(q)
  if (wantsSelf) {
    if (!self) return { ok: false, message: 'Your login is not linked to an employee record.' }
    const { data } = await ctx.supabase.from('employees').select(EMP_COLS)
      .eq('tenant_id', ctx.caller.tenantId).eq('id', self).maybeSingle()
    return data ? { ok: true, emp: data as EmpRow } : { ok: false, message: 'Could not find your employee record.' }
  }

  // Non-self lookup: employees may not look up others.
  if (!hr && ctx.caller.userRole !== 'manager') {
    return { ok: false, message: 'You can only ask about your own information.' }
  }

  const s = sanitizeQuery(q)
  if (!s) return { ok: false, message: 'Please provide an employee name or code.' }
  const tokens = s.split(' ').filter(Boolean)
  const ors = new Set<string>()
  for (const t of tokens) {
    ors.add(`first_name.ilike.%${t}%`)
    ors.add(`last_name.ilike.%${t}%`)
  }
  ors.add(`employee_code.ilike.%${s}%`)

  let query = ctx.supabase.from('employees').select(EMP_COLS)
    .eq('tenant_id', ctx.caller.tenantId)
    .or([...ors].join(','))
    .limit(25)

  const { data, error } = await query
  if (error) return { ok: false, message: 'Could not search employees right now.' }
  let candidates = (data ?? []) as EmpRow[]

  // Manager scope: restrict to self + direct reports.
  if (!hr) {
    if (!self) return { ok: false, message: 'Your login is not linked to an employee record.' }
    const reports = new Set(await getDirectReportIds(ctx.supabase, ctx.caller.tenantId, self))
    reports.add(self)
    candidates = candidates.filter(e => reports.has(e.id))
  }

  if (candidates.length === 0) return { ok: false, message: `No employee found matching "${q}"${hr ? '' : ' in your team'}.` }

  // Prefer an exact code or exact full-name match when narrowing multiples.
  const lc = s.toLowerCase()
  const exact = candidates.find(e =>
    (e.employee_code ?? '').toLowerCase() === lc ||
    fullName(e).toLowerCase() === lc)
  if (exact) return { ok: true, emp: exact }
  if (candidates.length === 1) return { ok: true, emp: candidates[0]! }

  const names = candidates.slice(0, 6).map(e => `${fullName(e)}${e.employee_code ? ` (${e.employee_code})` : ''}`)
  return { ok: false, message: `Multiple people match "${q}": ${names.join(', ')}. Please be more specific (use the employee code).` }
}

// ── Executors ────────────────────────────────────────────────────────────────────

async function findEmployee(ctx: ToolCtx, args: any): Promise<string> {
  const r = await resolveEmployee(ctx, args?.query)
  if (!r.ok) return r.message
  const e = r.emp

  // Resolve department, designation, manager names (best-effort).
  const [dept, desig, mgr] = await Promise.all([
    e.department_id ? ctx.supabase.from('departments').select('name').eq('id', e.department_id).eq('tenant_id', ctx.caller.tenantId).maybeSingle() : Promise.resolve({ data: null }),
    e.designation_id ? ctx.supabase.from('designations').select('name').eq('id', e.designation_id).eq('tenant_id', ctx.caller.tenantId).maybeSingle() : Promise.resolve({ data: null }),
    e.manager_id ? ctx.supabase.from('employees').select('first_name, last_name').eq('id', e.manager_id).eq('tenant_id', ctx.caller.tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const parts = [`${fullName(e)}${e.employee_code ? ` (${e.employee_code})` : ''}`]
  if ((desig.data as any)?.name) parts.push(`${(desig.data as any).name}`)
  if ((dept.data as any)?.name)  parts.push(`${(dept.data as any).name} dept`)
  if (e.employment_type) parts.push(e.employment_type)
  if (e.status) parts.push(`status: ${e.status}`)
  if (e.work_location) parts.push(`location: ${e.work_location}`)
  if (e.joining_date) parts.push(`joined ${e.joining_date}`)
  if ((mgr.data as any)) parts.push(`reports to ${fullName(mgr.data as any)}`)
  return parts.join(' · ')
}

async function getTeamOnLeave(ctx: ToolCtx, args: any): Promise<string> {
  const date = String(args?.date ?? '')
  if (!DATE_RE.test(date)) return 'Please provide a date as YYYY-MM-DD.'
  const hr = isHrAdmin(ctx.caller.userRole)

  let scopeIds: string[] | null = null
  if (!hr) {
    if (ctx.caller.userRole !== 'manager') return 'You can only see your own schedule. Ask about your own leave instead.'
    if (!ctx.employeeId) return 'Your login is not linked to an employee record.'
    scopeIds = await getDirectReportIds(ctx.supabase, ctx.caller.tenantId, ctx.employeeId)
    if (scopeIds.length === 0) return 'You have no direct reports.'
  }

  let q = ctx.supabase
    .from('leave_requests')
    .select('employee_id, from_date, to_date, employees!inner(first_name, last_name)')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('status', 'APPROVED')
    .lte('from_date', date)
    .gte('to_date', date)
  if (scopeIds) q = q.in('employee_id', scopeIds)

  const { data, error } = await q
  if (error) return 'Could not look that up right now.'
  const names = (data ?? []).map((r: any) => `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim()).filter(Boolean)
  if (names.length === 0) return `No one is on approved leave on ${date}.`
  return `${names.length} on leave on ${date}: ${names.join(', ')}.`
}

async function getLeaveBalance(ctx: ToolCtx, args: any): Promise<string> {
  const r = await resolveEmployee(ctx, args?.employee)
  if (!r.ok) return r.message
  const e = r.emp

  const { data, error } = await ctx.supabase
    .from('employee_leave_balance')
    .select('balance, leave_types(name)')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('employee_id', e.id)
    .order('balance', { ascending: false })
    .limit(12)
  if (error) return 'Could not look up leave balances right now.'
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return `No leave balances on record for ${fullName(e)}.`
  const parts = rows.map(b => {
    const lt = Array.isArray(b.leave_types) ? b.leave_types[0] : b.leave_types
    return `${lt?.name ?? 'Leave'}: ${b.balance}`
  })
  return `Leave balances for ${fullName(e)} — ${parts.join(', ')}.`
}

async function getLeaveRequests(ctx: ToolCtx, args: any): Promise<string> {
  const hr = isHrAdmin(ctx.caller.userRole)
  const statusArg = typeof args?.status === 'string' ? args.status.toUpperCase() : null
  const validStatus = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(statusArg ?? '') ? statusArg : null

  // Determine scope: a named employee, else self, else (HR/manager) the team.
  let scopeIds: string[] | null = null
  let label = ''
  if (args?.employee) {
    const r = await resolveEmployee(ctx, args.employee)
    if (!r.ok) return r.message
    scopeIds = [r.emp.id]; label = ` for ${fullName(r.emp)}`
  } else if (hr) {
    scopeIds = null; label = ' (organisation-wide)'
  } else if (ctx.caller.userRole === 'manager') {
    if (!ctx.employeeId) return 'Your login is not linked to an employee record.'
    scopeIds = [...await getDirectReportIds(ctx.supabase, ctx.caller.tenantId, ctx.employeeId), ctx.employeeId]
    label = ' for your team'
  } else {
    if (!ctx.employeeId) return 'Your login is not linked to an employee record.'
    scopeIds = [ctx.employeeId]; label = ''
  }

  let q = ctx.supabase
    .from('leave_requests')
    .select('from_date, to_date, status, computed_days, employees(first_name, last_name), leave_types(name)')
    .eq('tenant_id', ctx.caller.tenantId)
    .order('from_date', { ascending: false })
    .limit(10)
  if (validStatus) q = q.eq('status', validStatus)
  if (scopeIds) q = q.in('employee_id', scopeIds)

  const { data, error } = await q
  if (error) return 'Could not look up leave requests right now.'
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return `No ${validStatus ? validStatus.toLowerCase() + ' ' : ''}leave requests found${label}.`
  const lines = rows.map(r => {
    const who = `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim()
    const type = r.leave_types?.name ?? 'Leave'
    return `${who ? who + ' — ' : ''}${type} ${r.from_date}→${r.to_date} (${r.computed_days ?? '?'}d, ${r.status})`
  })
  return `Leave requests${label}: ${lines.join('; ')}.`
}

async function getAttendance(ctx: ToolCtx, args: any): Promise<string> {
  const hr = isHrAdmin(ctx.caller.userRole)
  const date = typeof args?.date === 'string' && DATE_RE.test(args.date)
    ? args.date : new Date().toISOString().slice(0, 10)

  // HR/Admin with no employee → org-wide absent count for the date.
  if (!args?.employee && hr) {
    const { count, error } = await ctx.supabase
      .from('attendance_daily').select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.caller.tenantId).eq('date', date).eq('status', 'absent')
    if (error) return 'Could not look up attendance right now.'
    return `${count ?? 0} employee(s) marked absent on ${date}.`
  }

  const r = await resolveEmployee(ctx, args?.employee)
  if (!r.ok) return r.message
  const e = r.emp

  const { data, error } = await ctx.supabase
    .from('attendance_daily')
    .select('status, work_hours, late_minutes, overtime_minutes')
    .eq('tenant_id', ctx.caller.tenantId).eq('employee_id', e.id).eq('date', date)
    .maybeSingle()
  if (error) return 'Could not look up attendance right now.'
  if (!data) return `No attendance record for ${fullName(e)} on ${date}.`
  const d = data as any
  const extra = [
    d.work_hours != null ? `${d.work_hours}h worked` : null,
    d.late_minutes ? `${d.late_minutes}m late` : null,
    d.overtime_minutes ? `${d.overtime_minutes}m OT` : null,
  ].filter(Boolean).join(', ')
  return `${fullName(e)} on ${date}: ${d.status}${extra ? ` (${extra})` : ''}.`
}

async function getPendingApprovals(ctx: ToolCtx): Promise<string> {
  const hr = isHrAdmin(ctx.caller.userRole)
  let scopeIds: string[] | null = null
  if (!hr) {
    if (ctx.caller.userRole !== 'manager') return 'You do not have approval responsibilities.'
    if (!ctx.employeeId) return 'Your login is not linked to an employee record.'
    scopeIds = await getDirectReportIds(ctx.supabase, ctx.caller.tenantId, ctx.employeeId)
    if (scopeIds.length === 0) return 'You have no direct reports, so nothing is pending your approval.'
  }

  const countPending = async (table: string, status: string): Promise<number> => {
    try {
      let q = ctx.supabase.from(table).select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.caller.tenantId).eq('status', status)
      if (scopeIds) q = q.in('employee_id', scopeIds)
      const { count } = await q
      return count ?? 0
    } catch { return 0 }
  }
  const [leave, reg] = await Promise.all([
    countPending('leave_requests', 'PENDING'),
    countPending('attendance_regularisation', 'pending'),
  ])
  const total = leave + reg
  if (total === 0) return 'Nothing is pending your approval right now.'
  return `${total} pending: ${leave} leave request(s), ${reg} attendance regularisation(s).`
}

async function getEmployeeAssets(ctx: ToolCtx, args: any): Promise<string> {
  const r = await resolveEmployee(ctx, args?.employee)
  if (!r.ok) return r.message
  const e = r.emp

  const { data, error } = await ctx.supabase
    .from('assets')
    .select('asset_code, name, serial_number, status')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('assigned_to', e.id)
    .limit(25)
  if (error) return 'Could not look up assets right now.'
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return `No company assets are currently assigned to ${fullName(e)}.`
  const lines = rows.map(a => `${a.name}${a.asset_code ? ` (${a.asset_code})` : ''}${a.serial_number ? ` SN:${a.serial_number}` : ''} — ${a.status}`)
  return `${rows.length} asset(s) assigned to ${fullName(e)}: ${lines.join('; ')}.`
}

async function getHolidays(ctx: ToolCtx, args: any): Promise<string> {
  const from = typeof args?.from === 'string' && DATE_RE.test(args.from) ? args.from : new Date().toISOString().slice(0, 10)
  const to   = typeof args?.to === 'string' && DATE_RE.test(args.to) ? args.to : null

  let q = ctx.supabase
    .from('holiday_calendar')
    .select('name, date, is_optional')
    .eq('tenant_id', ctx.caller.tenantId)
    .gte('date', from)
    .order('date', { ascending: true })
    .limit(15)
  if (to) q = q.lte('date', to)

  const { data, error } = await q
  if (error) return 'Could not look up holidays right now.'
  const rows = (data ?? []) as Array<{ name: string; date: string; is_optional: boolean }>
  if (rows.length === 0) return `No holidays found${to ? ` between ${from} and ${to}` : ` on or after ${from}`}.`
  const lines = rows.map(h => `${h.name} (${h.date})${h.is_optional ? ' [optional]' : ''}`)
  return `Holidays: ${lines.join(', ')}.`
}

async function getHeadcount(ctx: ToolCtx, args: any): Promise<string> {
  if (!isHrAdmin(ctx.caller.userRole)) return 'Headcount is available to HR/Admin only.'

  if (args?.by_department) {
    const { data } = await ctx.supabase
      .from('job_history')
      .select('departments(name), employees!inner(status)')
      .eq('tenant_id', ctx.caller.tenantId)
      .eq('is_current', true)
    const counts = new Map<string, number>()
    for (const r of (data ?? []) as any[]) {
      if (r.employees?.status && r.employees.status !== 'active') continue
      const dept = r.departments?.name ?? 'Unassigned'
      counts.set(dept, (counts.get(dept) ?? 0) + 1)
    }
    if (counts.size === 0) return 'No active employees found.'
    const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}: ${c}`)
    return `Headcount by department — ${parts.join(', ')}.`
  }

  const { count } = await ctx.supabase
    .from('employees').select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.caller.tenantId).eq('status', 'active')
  return `Active headcount: ${count ?? 0}.`
}

async function listDepartments(ctx: ToolCtx): Promise<string> {
  if (!isHrAdmin(ctx.caller.userRole) && ctx.caller.userRole !== 'manager') {
    return 'The department list is available to HR/Admin and managers only.'
  }
  const { data: depts, error } = await ctx.supabase
    .from('departments').select('id, name').eq('tenant_id', ctx.caller.tenantId).limit(60)
  if (error) return 'Could not look up departments right now.'
  const list = (depts ?? []) as Array<{ id: string; name: string }>
  if (list.length === 0) return 'No departments are configured.'

  // Active headcount per department from employees.department_id.
  const { data: emps } = await ctx.supabase
    .from('employees').select('department_id').eq('tenant_id', ctx.caller.tenantId).eq('status', 'active')
  const counts = new Map<string, number>()
  for (const e of (emps ?? []) as any[]) if (e.department_id) counts.set(e.department_id, (counts.get(e.department_id) ?? 0) + 1)

  const parts = list
    .map(d => ({ name: d.name, n: counts.get(d.id) ?? 0 }))
    .sort((a, b) => b.n - a.n)
    .map(d => `${d.name}: ${d.n}`)
  return `${list.length} departments — ${parts.join(', ')}.`
}

async function getPayrollCost(ctx: ToolCtx, args: any): Promise<string> {
  if (!isHrAdmin(ctx.caller.userRole)) return 'Payroll cost is available to HR/Admin only.'
  const month = String(args?.month ?? '')
  if (!MONTH_RE.test(month)) return 'Please provide the month as YYYY-MM (e.g. 2026-04 for April 2026).'

  const { data, error } = await ctx.supabase
    .from('payroll_slips')
    .select('gross_pay, net_pay, tds_deducted, status')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('month', month)
  if (error) return 'Could not look up payroll cost right now.'

  const slips = (data ?? []) as Array<{ gross_pay: number | null; net_pay: number | null; tds_deducted: number | null; status: string }>
  if (slips.length === 0) return `No payroll has been processed for ${month} yet.`

  const gross = slips.reduce((s, r) => s + (Number(r.gross_pay) || 0), 0)
  const net   = slips.reduce((s, r) => s + (Number(r.net_pay)   || 0), 0)
  const tds   = slips.reduce((s, r) => s + (Number(r.tds_deducted) || 0), 0)
  const finalized = slips.filter(r => r.status === 'finalized').length
  const draftNote = finalized < slips.length ? ` (${finalized} of ${slips.length} finalized — figures include drafts)` : ''
  return `Payroll cost for ${month}: gross ${fmtINR(gross)}, net ${fmtINR(net)}, TDS ${fmtINR(tds)}, across ${slips.length} employee(s)${draftNote}.`
}

async function getPayrollRun(ctx: ToolCtx, args: any): Promise<string> {
  if (!isHrAdmin(ctx.caller.userRole)) return 'Payroll run details are available to HR/Admin only.'
  const month = String(args?.month ?? '')
  if (!MONTH_RE.test(month)) return 'Please provide the month as YYYY-MM (e.g. 2026-04).'

  const { data, error } = await ctx.supabase
    .from('payroll_runs')
    .select('status, employee_count, total_gross, total_net, total_deductions, finalized_at')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('month', month)
    .maybeSingle()
  if (error) return 'Could not look up the payroll run right now.'
  if (!data) return `No payroll run exists for ${month} yet.`
  const d = data as any
  const totals = d.total_gross != null
    ? ` — gross ${fmtINR(Number(d.total_gross))}, net ${fmtINR(Number(d.total_net ?? 0))}, deductions ${fmtINR(Number(d.total_deductions ?? 0))}`
    : ''
  return `Payroll run for ${month}: ${d.status}, ${d.employee_count ?? 0} employee(s)${totals}${d.finalized_at ? `, finalized ${String(d.finalized_at).slice(0, 10)}` : ''}.`
}

async function getCompensation(ctx: ToolCtx, args: any): Promise<string> {
  // Sensitive — HR/Admin only, regardless of scope.
  if (!isHrAdmin(ctx.caller.userRole)) return 'Compensation details are available to HR/Admin only.'
  const r = await resolveEmployee(ctx, args?.employee)
  if (!r.ok) return r.message
  const e = r.emp

  const { data, error } = await ctx.supabase
    .from('employee_compensations')
    .select('ctc_annual, ctc_monthly, effective_from')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('employee_id', e.id)
    .eq('is_active', true)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return 'Could not look up compensation right now.'
  if (!data) return `No active compensation record for ${fullName(e)}.`
  const d = data as any
  return `${fullName(e)} — CTC ${fmtINR(Number(d.ctc_annual))}/yr (${fmtINR(Number(d.ctc_monthly))}/mo)${d.effective_from ? `, effective ${d.effective_from}` : ''}.`
}

// ── Write tools ───────────────────────────────────────────────────────────────

async function applyLeave(ctx: ToolCtx, args: { leave_type: string; start_date: string; end_date: string; reason?: string }): Promise<string> {
  if (!ctx.employeeId) return 'No employee profile linked to your account.'
  if (!DATE_RE.test(args.start_date) || !DATE_RE.test(args.end_date)) return 'Invalid date format. Use YYYY-MM-DD.'
  if (args.start_date > args.end_date) return 'Start date must be before or equal to end date.'

  // Resolve leave type by name
  const { data: lt, error: ltErr } = await ctx.supabase
    .from('leave_types')
    .select('id, name')
    .eq('tenant_id', ctx.caller.tenantId)
    .ilike('name', `%${args.leave_type.trim()}%`)
    .limit(1)
    .single()

  if (ltErr || !lt) return `Leave type "${args.leave_type}" not found. Available types can be checked in your leave balance.`

  // Lookup profile_id → user_id for the employee
  const { data: profile } = await ctx.supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('employee_id', ctx.employeeId)
    .single()

  if (!profile) return 'Could not resolve your profile. Please apply via the Leave page.'

  const { data, error } = await ctx.supabase
    .from('leave_requests')
    .insert({
      tenant_id:     ctx.caller.tenantId,
      employee_id:   ctx.employeeId,
      leave_type_id: lt.id,
      start_date:    args.start_date,
      end_date:      args.end_date,
      reason:        args.reason?.trim() || null,
      status:        'PENDING',
      applied_by:    ctx.caller.userId,
      applied_at:    new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return `Failed to apply leave: ${error.message}`
  return `✅ Leave applied successfully! ${lt.name} from ${args.start_date} to ${args.end_date} is now PENDING approval. Request ID: ${data.id}`
}

async function cancelLeaveRequest(ctx: ToolCtx, args: { request_id: string }): Promise<string> {
  if (!ctx.employeeId) return 'No employee profile linked to your account.'

  const { data: req, error: fetchErr } = await ctx.supabase
    .from('leave_requests')
    .select('id, status, start_date, end_date, leave_types(name)')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('id', args.request_id)
    .eq('employee_id', ctx.employeeId)
    .single()

  if (fetchErr || !req) return 'Leave request not found or you do not have permission to cancel it.'
  if (req.status !== 'PENDING') return `Cannot cancel a request with status ${req.status}. Only PENDING requests can be cancelled.`

  const { error } = await ctx.supabase
    .from('leave_requests')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('id', args.request_id)
    .eq('tenant_id', ctx.caller.tenantId)

  if (error) return `Failed to cancel: ${error.message}`
  const typeName = (req.leave_types as any)?.name ?? 'leave'
  return `✅ ${typeName} request (${req.start_date} → ${req.end_date}) has been cancelled.`
}

async function createHelpdeskTicket(ctx: ToolCtx, args: { subject: string; description: string; category?: string; priority?: string }): Promise<string> {
  if (!ctx.employeeId) return 'No employee profile linked to your account.'

  const category = args.category ?? 'general'
  const priority  = args.priority  ?? 'medium'
  const validCategories = ['it_support', 'hr_query', 'payroll', 'general']
  const validPriorities  = ['low', 'medium', 'high']
  if (!validCategories.includes(category)) return `Invalid category. Use one of: ${validCategories.join(', ')}`
  if (!validPriorities.includes(priority))  return `Invalid priority. Use one of: ${validPriorities.join(', ')}`

  const { data, error } = await ctx.supabase
    .from('helpdesk_tickets')
    .insert({
      tenant_id:   ctx.caller.tenantId,
      employee_id: ctx.employeeId,
      subject:     args.subject.slice(0, 120),
      description: args.description,
      category,
      priority,
      status:      'open',
      created_by:  ctx.caller.userId,
    })
    .select('id, ticket_number')
    .single()

  if (error) return `Failed to create ticket: ${error.message}`
  const ticketRef = (data as any).ticket_number ?? data.id.slice(0, 8)
  return `✅ Helpdesk ticket #${ticketRef} created. Subject: "${args.subject}". Category: ${category}, Priority: ${priority}. HR will respond shortly.`
}

// ── New write tools ──────────────────────────────────────────────────────────

async function regularizeAttendance(ctx: ToolCtx, args: {
  date: string
  regularization_type?: string
  requested_check_in?: string
  requested_check_out?: string
  reason: string
}): Promise<string> {
  if (!ctx.employeeId) return 'No employee profile linked to your account.'
  if (!DATE_RE.test(args.date)) return 'Invalid date format. Use YYYY-MM-DD.'

  const validTypes = [
    'missed_punch', 'forgot_checkout', 'onsite_duty',
    'biometric_issue', 'client_visit', 'wfh', 'field_work', 'system_issue',
  ]
  const regType = args.regularization_type ?? 'missed_punch'
  if (!validTypes.includes(regType)) {
    return `Invalid regularization type. Use one of: ${validTypes.join(', ')}`
  }

  const timeRe = /^\d{2}:\d{2}$/
  const checkIn  = args.requested_check_in  && timeRe.test(args.requested_check_in)  ? args.requested_check_in  : null
  const checkOut = args.requested_check_out && timeRe.test(args.requested_check_out) ? args.requested_check_out : null

  const { data, error } = await ctx.supabase
    .from('attendance_regularisation')
    .insert({
      tenant_id:            ctx.caller.tenantId,
      employee_id:          ctx.employeeId,
      date:                 args.date,
      regularization_type:  regType,
      requested_check_in:   checkIn,
      requested_check_out:  checkOut,
      reason:               args.reason.trim(),
      status:               'pending',
      submitted_by:         ctx.caller.userId,
    })
    .select('id, date, status')
    .single()

  if (error) return `Failed to submit regularization request: ${error.message}`
  return `✅ Attendance regularization request submitted for ${args.date} (${regType.replace(/_/g, ' ')}). Status: PENDING. HR will review and approve it shortly.`
}

async function getPayslip(ctx: ToolCtx, args: { month?: string }): Promise<string> {
  if (!ctx.employeeId) return 'No employee profile linked to your account.'

  const MONTH_RE_LOCAL = /^\d{4}-\d{2}$/
  let q = ctx.supabase
    .from('payroll_slips')
    .select('id, month, gross_pay, net_pay, total_deductions, lop_days, payable_days, status, created_at')
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('employee_id', ctx.employeeId)
    .eq('status', 'finalized')
    .order('month', { ascending: false })
    .limit(1)

  if (args?.month && MONTH_RE_LOCAL.test(args.month)) {
    q = ctx.supabase
      .from('payroll_slips')
      .select('id, month, gross_pay, net_pay, total_deductions, lop_days, payable_days, status, created_at')
      .eq('tenant_id', ctx.caller.tenantId)
      .eq('employee_id', ctx.employeeId)
      .eq('month', args.month)
      .eq('status', 'finalized')
      .limit(1)
  }

  const { data, error } = await q.maybeSingle()
  if (error) return 'Could not look up payslip right now.'
  if (!data) {
    const monthLabel = args?.month ?? 'recent months'
    return `No finalized payslip found for ${monthLabel}. Your HR team will notify you once payroll is processed.`
  }
  const d = data as any
  const parts = [
    `Payslip for ${d.month}`,
    `Gross: ${fmtINR(Number(d.gross_pay))}`,
    `Deductions: ${fmtINR(Number(d.total_deductions))}`,
    `Net Pay: ${fmtINR(Number(d.net_pay))}`,
  ]
  if (d.lop_days) parts.push(`LOP: ${d.lop_days} day(s)`)
  if (d.payable_days) parts.push(`Payable days: ${d.payable_days}`)
  parts.push(`You can download the full payslip from the Payroll → My Payslips section of the app.`)
  return parts.join(' · ')
}

async function updateContactInfo(ctx: ToolCtx, args: { phone: string }): Promise<string> {
  if (!ctx.employeeId) return 'No employee profile linked to your account.'

  const phone = args.phone?.trim() ?? ''
  if (!phone || phone.length < 7 || phone.length > 20) {
    return 'Please provide a valid phone number (7–20 characters).'
  }
  // Allow digits, spaces, +, -, (, )
  if (!/^[+\d\s\-().]+$/.test(phone)) {
    return 'Phone number contains invalid characters. Only digits, spaces, +, -, (, ) are allowed.'
  }

  const { error } = await ctx.supabase
    .from('employees')
    .update({ phone })
    .eq('tenant_id', ctx.caller.tenantId)
    .eq('id', ctx.employeeId)

  if (error) return `Failed to update phone number: ${error.message}`
  return `✅ Your phone number has been updated to ${phone}. This will be reflected in your employee profile.`
}

/** Execute a tool call by name. Always returns a string (never throws to the loop). */
export async function executeTool(ctx: ToolCtx, name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'find_employee':         return await findEmployee(ctx, args)
      case 'get_team_on_leave':     return await getTeamOnLeave(ctx, args)
      case 'get_leave_balance':     return await getLeaveBalance(ctx, args)
      case 'get_leave_requests':    return await getLeaveRequests(ctx, args)
      case 'get_attendance':        return await getAttendance(ctx, args)
      case 'get_pending_approvals': return await getPendingApprovals(ctx)
      case 'get_employee_assets':   return await getEmployeeAssets(ctx, args)
      case 'get_holidays':          return await getHolidays(ctx, args)
      case 'get_headcount':         return await getHeadcount(ctx, args)
      case 'list_departments':      return await listDepartments(ctx)
      case 'get_payroll_cost':      return await getPayrollCost(ctx, args)
      case 'get_payroll_run':       return await getPayrollRun(ctx, args)
      case 'get_compensation':      return await getCompensation(ctx, args)
      case 'apply_leave':            return await applyLeave(ctx, args)
      case 'cancel_leave_request':   return await cancelLeaveRequest(ctx, args)
      case 'create_helpdesk_ticket': return await createHelpdeskTicket(ctx, args)
      case 'regularize_attendance':  return await regularizeAttendance(ctx, args)
      case 'get_payslip':            return await getPayslip(ctx, args)
      case 'update_contact_info':    return await updateContactInfo(ctx, args)
      default:                       return `Unknown tool: ${name}`
    }
  } catch {
    return 'That lookup failed — please try rephrasing.'
  }
}
