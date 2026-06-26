/**
 * assistant-context.ts — build the role-scoped context the LLM sees.
 *
 * The assistant only ever knows what the LOGGED-IN user is allowed to know: the
 * snapshot is fetched server-side with that user's identity + role. An employee
 * gets their own data; a manager/HR additionally gets a note that team/tenant
 * read-tools are available (the tools themselves enforce scope at call time).
 *
 * Every section is defensive (try/catch → omitted) so a schema quirk never breaks
 * the assistant — it just answers with less context.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCallerEmployeeId, isHrAdmin } from '../manager-scope.js'

export interface AssistantCaller {
  userId:    string
  tenantId:  string
  userRole:  string
}

async function safe<T>(p: any): Promise<T | null> {
  try { const { data } = await p; return (data ?? null) as T | null } catch { return null }
}

function fmtINR(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

/** Build a compact plain-text context block + the resolved employeeId (for tools). */
export async function buildAssistantContext(
  supabase: SupabaseClient,
  caller:   AssistantCaller,
): Promise<{ context: string; employeeId: string | null; isManagerOrHr: boolean }> {
  const today = new Date().toISOString().slice(0, 10)
  const hr    = isHrAdmin(caller.userRole)
  const employeeId = await resolveCallerEmployeeId(supabase, caller.userId, caller.tenantId)

  const lines: string[] = []
  lines.push(`Today's date: ${today}.`)

  // Display name + role
  const profile = await safe<{ full_name: string | null }>(
    supabase.from('profiles').select('full_name').eq('id', caller.userId).eq('tenant_id', caller.tenantId).maybeSingle(),
  )
  const roleLabel = hr ? 'HR / Admin' : caller.userRole === 'manager' ? 'Manager' : 'Employee'
  lines.push(`You are assisting ${profile?.full_name ?? 'a user'} (role: ${roleLabel}).`)

  if (employeeId) {
    const emp = await safe<{ first_name: string; last_name: string; employee_code: string; joining_date: string | null }>(
      supabase.from('employees').select('first_name, last_name, employee_code, joining_date')
        .eq('id', employeeId).eq('tenant_id', caller.tenantId).maybeSingle(),
    )
    if (emp) lines.push(`Employee: ${emp.first_name} ${emp.last_name} (${emp.employee_code})${emp.joining_date ? `, joined ${emp.joining_date}` : ''}.`)

    // Leave balances
    const balances = await safe<Array<{ balance: number; leave_types: { name: string } | null }>>(
      supabase.from('employee_leave_balance').select('balance, leave_types(name)')
        .eq('employee_id', employeeId).eq('tenant_id', caller.tenantId).order('balance', { ascending: false }).limit(8),
    )
    if (balances && balances.length) {
      const parts = balances.map(b => `${(b.leave_types as any)?.name ?? 'Leave'}: ${b.balance}`).join(', ')
      lines.push(`Leave balances — ${parts}.`)
    }

    // Latest payslip
    const slip = await safe<Array<{ net_pay: number | null; month: string; status: string }>>(
      supabase.from('payroll_slips').select('net_pay, month, status')
        .eq('employee_id', employeeId).eq('tenant_id', caller.tenantId).order('month', { ascending: false }).limit(1),
    )
    const latest = Array.isArray(slip) ? slip[0] : null
    if (latest?.net_pay != null) lines.push(`Last payslip — ${latest.month}: net ${fmtINR(Number(latest.net_pay))} (${latest.status}).`)

    // Own pending leave requests
    const pending = await safe<Array<{ id: string }>>(
      supabase.from('leave_requests').select('id')
        .eq('employee_id', employeeId).eq('tenant_id', caller.tenantId).eq('status', 'PENDING'),
    )
    if (pending) lines.push(`You have ${pending.length} pending leave request(s).`)
  } else {
    lines.push('Note: your login is not linked to an employee record, so personal HR data is unavailable.')
  }

  // Upcoming holidays (tenant-wide, safe for everyone)
  const holidays = await safe<Array<{ name: string; date: string }>>(
    supabase.from('holiday_calendar').select('name, date').eq('tenant_id', caller.tenantId)
      .gte('date', today).order('date', { ascending: true }).limit(3),
  )
  if (holidays && holidays.length) {
    lines.push(`Upcoming holidays — ${holidays.map(h => `${h.name} (${h.date})`).join(', ')}.`)
  }

  if (hr || caller.userRole === 'manager') {
    lines.push(`You can use the available read-tools to answer questions about ${hr ? 'the whole organisation' : 'your direct reports'} (e.g. who is on leave on a date, pending approvals${hr ? ', headcount' : ''}).`)
  }

  return { context: lines.join('\n'), employeeId, isManagerOrHr: hr || caller.userRole === 'manager' }
}
