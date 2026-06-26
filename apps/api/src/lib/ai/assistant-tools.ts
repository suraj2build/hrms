/**
 * assistant-tools.ts — the curated, READ-ONLY, RBAC-checked functions the LLM may
 * call (Tier 3). No open SQL, no writes. Each executor re-checks the caller's role
 * and tenant-scopes every query, so the model can never read across roles/tenants
 * regardless of what it asks for.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDirectReportIds, isHrAdmin } from '../manager-scope.js'
import type { ToolDef } from './llm.js'
import type { AssistantCaller } from './assistant-context.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Tool schemas advertised to the model ─────────────────────────────────────────
export const ASSISTANT_TOOLS: ToolDef[] = [
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
      name: 'get_pending_approvals',
      description: 'Count and summarise requests awaiting the user’s approval (leave + attendance regularisation). Managers see their direct reports; HR sees the whole organisation.',
      parameters: { type: 'object', properties: {} },
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
]

interface ToolCtx {
  supabase:   SupabaseClient
  caller:     AssistantCaller
  employeeId: string | null
}

// ── Executors ────────────────────────────────────────────────────────────────────
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

/** Execute a tool call by name. Always returns a string (never throws to the loop). */
export async function executeTool(ctx: ToolCtx, name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'get_team_on_leave':     return await getTeamOnLeave(ctx, args)
      case 'get_pending_approvals': return await getPendingApprovals(ctx)
      case 'get_headcount':         return await getHeadcount(ctx, args)
      default:                      return `Unknown tool: ${name}`
    }
  } catch {
    return 'That lookup failed — please try rephrasing.'
  }
}
