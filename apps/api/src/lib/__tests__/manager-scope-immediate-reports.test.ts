/**
 * getImmediateReportIds — added SYSTEM_AUDIT_2026-10-14 alongside the fix for
 * several manager-of-managers scope-mismatch defects (overtime/comp-off
 * approval queues, leave's pending-count badge and Approved tab): those
 * endpoints need the ONE-LEVEL set (matches isDirectReport / validateApprover
 * / authorizeOtTarget's actual action authority), not getDirectReportIds'
 * full subordinate tree.
 */
import { describe, it, expect, vi } from 'vitest'
import { getImmediateReportIds } from '../manager-scope.js'

const TENANT_ID  = 'tenant-001'
const MANAGER_ID = 'emp-manager'

function buildSupabase(employeesByManager: Record<string, string[]>) {
  return {
    from(table: string) {
      if (table !== 'employees') throw new Error(`unexpected table ${table}`)
      const chain: any = {
        _managerId: null as string | null,
        select: () => chain,
        eq(field: string, value: unknown) {
          if (field === 'manager_id') chain._managerId = value
          return chain
        },
        then(resolve: (v: unknown) => void) {
          const ids = employeesByManager[chain._managerId as string] ?? []
          resolve({ data: ids.map(id => ({ id })), error: null })
          return Promise.resolve()
        },
      }
      return chain
    },
  }
}

describe('getImmediateReportIds', () => {
  it('returns only employees whose manager_id directly matches — not a deeper subordinate', async () => {
    const supabase = buildSupabase({
      [MANAGER_ID]: ['emp-direct-1', 'emp-direct-2'],
      'emp-direct-1': ['emp-grandchild'],   // one level further down — must NOT appear
    })

    const result = await getImmediateReportIds(supabase as any, TENANT_ID, MANAGER_ID)

    expect(result.sort()).toEqual(['emp-direct-1', 'emp-direct-2'])
    expect(result).not.toContain('emp-grandchild')
  })

  it('returns an empty array for a manager with no direct reports', async () => {
    const supabase = buildSupabase({})
    const result = await getImmediateReportIds(supabase as any, TENANT_ID, MANAGER_ID)
    expect(result).toEqual([])
  })

  it('propagates a DB error instead of silently returning an empty/partial list', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: new Error('connection reset') }),
          }),
        }),
      }),
    }
    await expect(getImmediateReportIds(supabase as any, TENANT_ID, MANAGER_ID)).rejects.toThrow('connection reset')
  })
})
