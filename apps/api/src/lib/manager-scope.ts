/**
 * manager-scope.ts — the single source of manager → direct-report scoping.
 *
 * Program 6A. Several endpoints (overtime, comp-off, separation clearance, the
 * Team Lifecycle workspace) must answer the same two questions:
 *
 *   1. "Which employee_id is this caller?"           → resolveCallerEmployeeId
 *   2. "Is employee X a direct report of caller?"    → isDirectReport
 *   3. "Who are caller's direct reports?"            → getDirectReportIds
 *
 * The org hierarchy is keyed on employees.manager_id (the column defined in
 * 004_employees.sql and used everywhere — the dashboard, compensation, leave and
 * who-is-in all scope on it). `reporting_manager_id` / `employment_status` do
 * NOT exist on the employees table; any query against them silently returns no
 * rows. This helper exists so there is ONE hierarchy model and no ambiguity.
 *
 * HR admins (super_admin / hr_admin) are never restricted by these helpers — the
 * caller decides whether to bypass the scope for an admin.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const HR_ADMIN_ROLES = ['super_admin', 'hr_admin'] as const

export function isHrAdmin(role: string | null | undefined): boolean {
  return role === 'super_admin' || role === 'hr_admin'
}

/**
 * Resolve the caller's own employee_id from their profile (null if unlinked).
 * Throws on a DB error rather than returning null — several callers (notably
 * isSelfApproval in approval-guards.ts) treat a null result as "no self to
 * collide with" and fail OPEN; silently returning null on a transient query
 * error would be indistinguishable from that and let a self-approval through.
 */
export async function resolveCallerEmployeeId(
  supabase: SupabaseClient,
  userId:   string,
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  return (data as { employee_id: string | null } | null)?.employee_id ?? null
}

/**
 * Resolve the manager employee_id for a request. HR admins may pass an explicit
 * override to inspect another manager's team; everyone else resolves to self.
 */
export async function resolveManagerEmployeeId(
  supabase: SupabaseClient,
  req:      { userId: string; tenantId: string; userRole: string },
  override?: string | null,
): Promise<string | null> {
  if (override && isHrAdmin(req.userRole)) {
    const { data } = await supabase
      .from('employees')
      .select('id')
      .eq('id', override)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  }
  return resolveCallerEmployeeId(supabase, req.userId, req.tenantId)
}

/**
 * All active subordinate employee ids for a manager, at any depth up to
 * maxDepth levels (default 10). Uses the get_all_subordinates() Postgres
 * recursive CTE (migration 357) so the full org subtree is returned, not
 * just immediate direct reports.
 */
export async function getDirectReportIds(
  supabase:          SupabaseClient,
  tenantId:          string,
  managerEmployeeId: string,
  maxDepth:          number = 10,
): Promise<string[]> {
  const { data, error } = await supabase
    .rpc('get_all_subordinates', {
      p_manager_id: managerEmployeeId,
      p_tenant_id:  tenantId,
      p_max_depth:  maxDepth,
    })
  if (error) throw error
  return (data ?? []).map((e: { id: string }) => e.id)
}

/**
 * Is `employeeId` a direct report of `managerEmployeeId`? Includes non-active
 * reports (e.g. on-notice) so separation/clearance flows still resolve.
 */
export async function isDirectReport(
  supabase:  SupabaseClient,
  tenantId:  string,
  managerEmployeeId: string,
  employeeId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('manager_id', managerEmployeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return !!data
}
