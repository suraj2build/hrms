/**
 * policy-service.ts
 *
 * AttendancePolicyService — resolves the effective attendance computation
 * policy for a given tenant/employee pair.
 *
 * Resolution chain (first match wins):
 *   1. employee_attendance_policies WHERE employee_id = ? AND tenant_id = ?
 *      → policy_id → attendance_policies row
 *   2. attendance_policies WHERE tenant_id = ? AND is_default = true
 *   3. Built-in DEFAULT_POLICY (hardcoded; never requires a DB row)
 *
 * All resolved policies are cached for the lifetime of the service instance
 * (which is the process lifetime since policyService is a module-level
 * singleton).  Call clearCache() to invalidate after a policy update.
 *
 * Cache key: `"${tenantId}:${employeeId}"` for employee-specific lookups,
 * `"${tenantId}:__default"` for the tenant default.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Policy shape ───────────────────────────────────────────────────────────────

export interface AttendancePolicy {
  id:                       string | null  // null = built-in default (no DB row)
  name:                     string
  grace_minutes:            number
  late_cap_minutes:         number
  present_threshold_pct:    number   // e.g. 75  → 75 % of shift duration
  half_day_threshold_pct:   number   // e.g. 50  → 50 % of shift duration
  excessive_hours_threshold: number  // 0 = disabled
}

// ── Built-in default ───────────────────────────────────────────────────────────

/**
 * The built-in policy used when no DB policy is found for the tenant.
 * Matches the original hard-coded constants in the AttendanceEngine.
 */
export const DEFAULT_POLICY: Readonly<AttendancePolicy> = Object.freeze({
  id:                       null,
  name:                     '__built_in_default',
  grace_minutes:            15,
  late_cap_minutes:         240,
  present_threshold_pct:    75,
  half_day_threshold_pct:   50,
  excessive_hours_threshold: 12.0,
})

// ── Internal DB row shape ──────────────────────────────────────────────────────

interface PolicyRow {
  id:                        string
  name:                      string
  grace_minutes:             number
  late_cap_minutes:          number
  present_threshold_pct:     number
  half_day_threshold_pct:    number
  excessive_hours_threshold: number
}

function rowToPolicy(row: PolicyRow): AttendancePolicy {
  return {
    id:                       row.id,
    name:                     row.name,
    grace_minutes:            row.grace_minutes,
    late_cap_minutes:         row.late_cap_minutes,
    present_threshold_pct:    row.present_threshold_pct,
    half_day_threshold_pct:   row.half_day_threshold_pct,
    excessive_hours_threshold: Number(row.excessive_hours_threshold),
  }
}

// ── Service class ──────────────────────────────────────────────────────────────

class AttendancePolicyService {
  /** In-process policy cache keyed by tenant:employee or tenant:__default. */
  private readonly cache = new Map<string, AttendancePolicy>()

  /**
   * Resolve the effective attendance policy for an employee.
   *
   * The result is cached — subsequent calls with the same key are O(1) Map
   * lookups.  Call clearCache() after any policy update.
   *
   * @param supabase   Service-role Supabase client
   * @param tenantId   Tenant UUID
   * @param employeeId Employee UUID
   */
  async getPolicy(
    supabase:   SupabaseClient,
    tenantId:   string,
    employeeId: string,
  ): Promise<AttendancePolicy> {
    const empKey     = `${tenantId}:${employeeId}`
    const defaultKey = `${tenantId}:__default`

    // ── Cache hit: employee-specific ───────────────────────────────────────
    const cached = this.cache.get(empKey)
    if (cached) return cached

    // ── 1. Try employee-specific assignment ────────────────────────────────
    const { data: empAssignment } = await supabase
      .from('employee_attendance_policies')
      .select(`
        attendance_policies (
          id, name,
          grace_minutes, late_cap_minutes,
          present_threshold_pct, half_day_threshold_pct,
          excessive_hours_threshold
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .maybeSingle()

    if (empAssignment) {
      const policyData = (empAssignment as unknown as {
        attendance_policies: PolicyRow | PolicyRow[] | null
      }).attendance_policies

      const pRow = Array.isArray(policyData) ? policyData[0] : policyData

      if (pRow) {
        const policy = rowToPolicy(pRow)
        this.cache.set(empKey, policy)
        return policy
      }
    }

    // ── 2. Try tenant default (may already be cached) ──────────────────────
    const cachedDefault = this.cache.get(defaultKey)
    if (cachedDefault) {
      // Also store under the employee key so future emp lookups skip step 1
      this.cache.set(empKey, cachedDefault)
      return cachedDefault
    }

    const { data: defaultRow } = await supabase
      .from('attendance_policies')
      .select(
        'id, name, grace_minutes, late_cap_minutes, present_threshold_pct, half_day_threshold_pct, excessive_hours_threshold',
      )
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .maybeSingle()

    if (defaultRow) {
      const policy = rowToPolicy(defaultRow as PolicyRow)
      this.cache.set(defaultKey, policy)
      this.cache.set(empKey, policy)
      return policy
    }

    // ── 3. Fallback to built-in ────────────────────────────────────────────
    // Store under both keys so neither needs another DB round-trip.
    this.cache.set(defaultKey, DEFAULT_POLICY)
    this.cache.set(empKey,     DEFAULT_POLICY)
    return DEFAULT_POLICY
  }

  /**
   * Resolve the effective policy for multiple employees in one pass.
   *
   * Useful when recomputeRange is called with a bulk job that touches many
   * employees — all share the same tenant but may have individual assignments.
   *
   * Each employee's policy is resolved and cached independently.
   */
  async getPolicyBulk(
    supabase:    SupabaseClient,
    tenantId:    string,
    employeeIds: string[],
  ): Promise<Map<string, AttendancePolicy>> {
    const result = new Map<string, AttendancePolicy>()

    await Promise.all(
      employeeIds.map(async (empId) => {
        const policy = await this.getPolicy(supabase, tenantId, empId)
        result.set(empId, policy)
      }),
    )

    return result
  }

  /**
   * Invalidate the entire cache.
   *
   * Call this from HR admin routes after a policy row is created/updated/deleted
   * so that subsequent engine calls pick up the latest values.
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Invalidate cache entries for a single tenant.
   * More targeted than clearCache() when only one tenant's policy changed.
   */
  clearTenantCache(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key)
      }
    }
  }

  /** Return the current cache size (test / diagnostics utility). */
  get cacheSize(): number {
    return this.cache.size
  }
}

// ── Singleton export ───────────────────────────────────────────────────────────

/** The shared AttendancePolicyService instance — import this everywhere. */
export const policyService = new AttendancePolicyService()
