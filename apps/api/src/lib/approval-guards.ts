/**
 * approval-guards.ts — shared segregation-of-duties checks (PI-2).
 *
 * Enterprise Integrity finding F3: no module blocked self-approval. A user with
 * HR/manager privileges could approve their OWN leave / comp-off / overtime /
 * reimbursement request — maker == checker, defeating four-eyes control.
 *
 * isSelfApproval resolves the approver's employee record and compares it to the
 * request's target employee. Use it in every approve path that mutates state or
 * credits balance/pay.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveCallerEmployeeId } from './manager-scope.js'

/**
 * True when the approver IS the employee the request belongs to.
 * Returns false when the approver has no employee record (e.g. a pure HR admin
 * profile not mapped to an employee) — there is no self to collide with.
 */
export async function isSelfApproval(
  supabase:         SupabaseClient,
  tenantId:         string,
  approverUserId:   string,
  targetEmployeeId: string | null | undefined,
): Promise<boolean> {
  if (!targetEmployeeId) return false
  const approverEmployeeId = await resolveCallerEmployeeId(supabase, approverUserId, tenantId)
  return !!approverEmployeeId && approverEmployeeId === targetEmployeeId
}
