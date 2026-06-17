/**
 * Scope Evaluator — determines whether a user can access a specific resource
 * based on their organizational scope.
 *
 * Scope hierarchy (most permissive → most restrictive):
 *   org-wide        — HR admin / super admin can see everything
 *   department      — manager can see employees in their department
 *   location        — manager can see employees at their work location
 *   cluster         — cluster manager can see employees at sites in their cluster(s)
 *   team            — manager can see their direct reports only
 *   self            — employee can see only their own records
 *
 * Usage:
 *   import { ScopeEvaluator } from './scope-evaluator.js'
 *   const evaluator = new ScopeEvaluator(supabase)
 *   const { allowed, scope } = await evaluator.evaluate({
 *     actorId:    req.userId,
 *     actorRole:  req.userRole,
 *     tenantId:   req.tenantId,
 *     subjectId:  targetEmployeeId,
 *   })
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrgScope =
  | 'org-wide'
  | 'department'
  | 'location'
  | 'cluster'
  | 'team'
  | 'self'
  | 'none'

export interface ScopeContext {
  /** UUID of the user making the request (from JWT → profiles.id) */
  actorId:    string
  /** Role of the actor (super_admin | hr_admin | manager | employee) */
  actorRole:  string
  /** Tenant ID from JWT */
  tenantId:   string
  /** UUID of the employee being accessed (may equal actorId for self-access) */
  subjectId?: string
}

export interface ScopeResult {
  allowed:    boolean
  scope:      OrgScope
  /** Human-readable explanation for audit / debugging */
  reason:     string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG_WIDE_ROLES = ['super_admin', 'hr_admin']

// ── ScopeEvaluator ────────────────────────────────────────────────────────────

export class ScopeEvaluator {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Evaluate whether the actor can access the subject's data.
   *
   * If subjectId is omitted the check is scoped to "can actor access
   * any data of this type" (useful for list endpoints).
   */
  async evaluate(ctx: ScopeContext): Promise<ScopeResult> {
    const { actorId, actorRole, tenantId, subjectId } = ctx

    // 1. Org-wide roles — always allowed
    if (ORG_WIDE_ROLES.includes(actorRole)) {
      return { allowed: true, scope: 'org-wide', reason: `Role '${actorRole}' has org-wide access` }
    }

    // 2. Self-access — employee reading their own record
    if (subjectId && actorId === subjectId) {
      return { allowed: true, scope: 'self', reason: 'Actor is the subject (self-access)' }
    }

    // 3. Manager scopes — fetch actor's employee_id and management context
    if (actorRole === 'manager') {
      return this._evaluateManagerScope(actorId, tenantId, subjectId)
    }

    // 4. Employee trying to access another employee's data — allowed only if the
    //    actor is a cluster manager and the subject works at a site in their cluster.
    if (subjectId && actorId !== subjectId) {
      const actorEmpId = await this._resolveEmployeeId(actorId, tenantId)
      if (actorEmpId) {
        const cluster = await this._evaluateClusterScope(actorEmpId, tenantId, subjectId)
        if (cluster) return cluster
      }
      return { allowed: false, scope: 'none', reason: 'Employees can only access their own records' }
    }

    // 5. List endpoints for employee role (self-scoped)
    return { allowed: true, scope: 'self', reason: 'Employee accessing own data list' }
  }

  private async _evaluateManagerScope(
    actorId:   string,
    tenantId:  string,
    subjectId: string | undefined,
  ): Promise<ScopeResult> {
    // If no specific subject, manager can access (subject filtering happens in query)
    if (!subjectId) {
      return { allowed: true, scope: 'team', reason: 'Manager accessing team list' }
    }

    // Fetch actor's employee_id from their profile
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', actorId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const actorEmpId = profile?.employee_id ?? null

    if (!actorEmpId) {
      return { allowed: false, scope: 'none', reason: 'Manager profile has no linked employee record' }
    }

    // a. Direct-report check — subject is a direct report of actor
    const { data: directReport } = await this.supabase
      .from('job_history')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', subjectId)
      .eq('manager_id', actorEmpId)
      .eq('is_current', true)
      .maybeSingle()

    if (directReport) {
      return { allowed: true, scope: 'team', reason: 'Subject is a direct report of the manager' }
    }

    // b. Department check — subject is in actor's department
    const [actorJob, subjectJob] = await Promise.all([
      this.supabase
        .from('job_history')
        .select('department_id, work_location_id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', actorEmpId)
        .eq('is_current', true)
        .maybeSingle(),
      this.supabase
        .from('job_history')
        .select('department_id, work_location_id')
        .eq('tenant_id', tenantId)
        .eq('employee_id', subjectId)
        .eq('is_current', true)
        .maybeSingle(),
    ])

    const actorDept = actorJob.data?.department_id
    const subjDept  = subjectJob.data?.department_id
    if (actorDept && subjDept && actorDept === subjDept) {
      return { allowed: true, scope: 'department', reason: 'Subject is in the same department as the manager' }
    }

    // c. Location check — subject is at actor's work location
    const actorLoc = actorJob.data?.work_location_id
    const subjLoc  = subjectJob.data?.work_location_id
    if (actorLoc && subjLoc && actorLoc === subjLoc) {
      return { allowed: true, scope: 'location', reason: 'Subject is at the same work location as the manager' }
    }

    // d. Cluster check — subject works at a site in a cluster the manager runs
    const cluster = await this._evaluateClusterScope(actorEmpId, tenantId, subjectId)
    if (cluster) return cluster

    return {
      allowed: false,
      scope:   'none',
      reason:  'Manager does not have scope over this employee (not a direct report; different department, location and cluster)',
    }
  }

  /** Resolve a user's (profiles.id) linked employee_id, or null. */
  private async _resolveEmployeeId(actorId: string, tenantId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', actorId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return data?.employee_id ?? null
  }

  /**
   * Cluster scope — grant access when the subject's current site belongs to a
   * cluster (or its direct child cluster) managed by the actor employee.
   * Returns a ScopeResult when granted, or null when it does not apply.
   */
  private async _evaluateClusterScope(
    actorEmpId: string,
    tenantId:   string,
    subjectId:  string,
  ): Promise<ScopeResult | null> {
    const siteIds = await this._managedClusterSiteIds(actorEmpId, tenantId)
    if (siteIds.length === 0) return null

    const subjSiteId = await this._employeeSiteId(subjectId, tenantId)
    if (subjSiteId && siteIds.includes(subjSiteId)) {
      return { allowed: true, scope: 'cluster', reason: 'Subject works at a site in a cluster the actor manages' }
    }
    return null
  }

  /** Site IDs belonging to clusters (and their direct children) managed by the actor. */
  private async _managedClusterSiteIds(actorEmpId: string, tenantId: string): Promise<string[]> {
    const { data: managed } = await this.supabase
      .from('clusters')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('cluster_manager_id', actorEmpId)

    const clusterIds = (managed ?? []).map((c: { id: string }) => c.id)
    if (clusterIds.length === 0) return []

    // Include one level of child clusters (parent → child roll-up).
    const { data: children } = await this.supabase
      .from('clusters')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('parent_cluster_id', clusterIds)

    const allClusterIds = [...new Set([...clusterIds, ...(children ?? []).map((c: { id: string }) => c.id)])]

    const { data: sites } = await this.supabase
      .from('sites')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('cluster_id', allClusterIds)

    return (sites ?? []).map((s: { id: string }) => s.id)
  }

  /** Resolve an employee's current site via job_history → work_locations.site_id. */
  private async _employeeSiteId(employeeId: string, tenantId: string): Promise<string | null> {
    const { data: jh } = await this.supabase
      .from('job_history')
      .select('work_location_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('is_current', true)
      .maybeSingle()

    const wlId = jh?.work_location_id
    if (!wlId) return null

    const { data: wl } = await this.supabase
      .from('work_locations')
      .select('site_id')
      .eq('id', wlId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    return wl?.site_id ?? null
  }

  /** Employee IDs working at sites in clusters managed by the actor. */
  private async _clusterScopedEmployeeIds(actorEmpId: string, tenantId: string): Promise<string[]> {
    const siteIds = await this._managedClusterSiteIds(actorEmpId, tenantId)
    if (siteIds.length === 0) return []

    const { data: wls } = await this.supabase
      .from('work_locations')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('site_id', siteIds)

    const wlIds = (wls ?? []).map((w: { id: string }) => w.id)
    if (wlIds.length === 0) return []

    const { data: jh } = await this.supabase
      .from('job_history')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .in('work_location_id', wlIds)
      .eq('is_current', true)

    return [...new Set((jh ?? []).map((r: { employee_id: string }) => r.employee_id))]
  }

  /**
   * Returns the set of employee IDs the actor can access.
   * Used for list endpoints to build a WHERE IN clause.
   *
   * Returns null → no restriction (org-wide access).
   * Returns [] → no access.
   * Returns [id, ...] → scoped set.
   */
  async getAccessibleEmployeeIds(
    actorId:   string,
    actorRole: string,
    tenantId:  string,
  ): Promise<string[] | null> {
    if (ORG_WIDE_ROLES.includes(actorRole)) return null  // no restriction

    // Get actor's employee_id
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('employee_id')
      .eq('id', actorId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    const empId = profile?.employee_id ?? null
    if (!empId) return []

    // Employees at sites in clusters this actor manages (applies to any non-admin
    // role — a cluster manager may hold the 'manager' or 'employee' role).
    const clusterEmpIds = await this._clusterScopedEmployeeIds(empId, tenantId)

    if (actorRole === 'manager') {
      // Direct reports
      const { data: reports } = await this.supabase
        .from('job_history')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('manager_id', empId)
        .eq('is_current', true)

      const reportIds = (reports ?? []).map((r: { employee_id: string }) => r.employee_id)
      return [...new Set([empId, ...reportIds, ...clusterEmpIds])]  // include self
    }

    // employee — own record, plus any cluster they manage
    return [...new Set([empId, ...clusterEmpIds])]
  }
}
