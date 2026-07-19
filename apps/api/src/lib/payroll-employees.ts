/**
 * payroll-employees.ts
 *
 * Shared resilient fetch of a tenant's active employees.
 *
 * Prefers the get_active_employees_for_payroll DB function (migration 380):
 * one SQL query, whole result as a single JSON value — immune to PostgREST
 * row caps and to stale routing of ranged GET reads (RPC POSTs always execute
 * on the primary). Falls back to fetchAllRows(.range()) when the function is
 * not installed, so callers never hard-fail on a missing migration.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'

export type PayrollEmployee = {
  id: string
  first_name: string
  last_name: string
  employee_code: string
}

export async function fetchActiveEmployees(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ list: PayrollEmployee[]; method: 'rpc' | 'range_fallback' }> {
  const { data, error } = await supabase
    .rpc('get_active_employees_for_payroll', { p_tenant_id: tenantId })
  if (!error) {
    return { list: (Array.isArray(data) ? data : []) as PayrollEmployee[], method: 'rpc' }
  }
  const list = await fetchAllRows((from, to) =>
    supabase
      .from('employees')
      .select('id, first_name, last_name, employee_code')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')
      .range(from, to),
  ) as PayrollEmployee[]
  return { list, method: 'range_fallback' }
}
