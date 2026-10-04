/**
 * Leave Policy Assignments — /masters/leave-policy-assignments
 *
 * Binds a named leave policy master to a specific scope entity.
 *
 * Scope types and their priority (highest → lowest):
 *   'employee'      — applies to one specific employee (scope_id = employee UUID)
 *   'department'    — applies to all employees in a department (scope_id = department UUID)
 *   'work_location' — applies to all employees at a work location (scope_id = work_location UUID)
 *   'site'          — applies to all employees at a site (scope_id = sites.id UUID) [migration 156]
 *   'default'       — catch-all fallback (scope_id must be NULL)
 *
 * Endpoints:
 *   GET    /                    — list all assignments (with policy + scope label)
 *   POST   /                    — create an assignment
 *   DELETE /:id                 — remove an assignment
 *
 * Access:
 *   read  — any authenticated user in the tenant
 *   write — hr_admin / super_admin
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'
import { logAction }            from '../../lib/audit-service.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows }         from '../../lib/supabase-paginate.js'

const assignmentSchema = z.discriminatedUnion('scope_type', [
  z.object({
    scope_type: z.literal('employee'),
    scope_id:   z.string().uuid(),
    policy_id:  z.string().uuid(),
  }),
  z.object({
    scope_type: z.literal('department'),
    scope_id:   z.string().uuid(),
    policy_id:  z.string().uuid(),
  }),
  z.object({
    scope_type: z.literal('work_location'),
    scope_id:   z.string().uuid(),
    policy_id:  z.string().uuid(),
  }),
  z.object({
    // migration 156 — site-level scope
    scope_type: z.literal('site'),
    scope_id:   z.string().uuid(),
    policy_id:  z.string().uuid(),
  }),
  z.object({
    scope_type: z.literal('default'),
    scope_id:   z.null().optional(),
    policy_id:  z.string().uuid(),
  }),
])

// Priority order for display / documentation
const SCOPE_PRIORITY: Record<string, number> = {
  employee:      1,
  department:    2,
  work_location: 3,
  site:          4,   // migration 156
  default:       5,
}

export default async function leavePolicyAssignmentsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  function requireAdmin(req: any, reply: any): boolean {
    if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
      return false
    }
    return true
  }

  // ── GET / ──────────────────────────────────────────────────────────────────
  // Returns all assignments with policy name + scope label.
  fastify.get('/', auth, async (req: any, reply) => {
    // Paginated — an unbounded .select() truncates at PostgREST's 1,000-row
    // ceiling for a tenant with many employee-level policy overrides.
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        fastify.supabase
          .from('leave_policy_assignments')
          .select(`
            id, scope_type, scope_id, created_at, updated_at,
            leave_policy_masters(id, name, year_type, is_active)
          `)
          .eq('tenant_id', req.tenantId)
          .order('scope_type')
          .range(from, to),
      )
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch leave policy assignments')
    }

    // Enrich scope labels with names (employees, departments, work_locations)
    // Collect scope_ids by type
    const empIds: string[]  = []
    const deptIds: string[] = []
    const locIds: string[]  = []
    const siteIds: string[] = []

    for (const row of (data ?? []) as any[]) {
      if (!row.scope_id) continue
      if (row.scope_type === 'employee')      empIds.push(row.scope_id)
      if (row.scope_type === 'department')    deptIds.push(row.scope_id)
      if (row.scope_type === 'work_location') locIds.push(row.scope_id)
      if (row.scope_type === 'site')          siteIds.push(row.scope_id)
    }

    // Batch fetch names
    const [emps, depts, locs, sites] = await Promise.all([
      // Chunked: empIds is every employee with a direct assignment row,
      // tenant-wide — can exceed a single .in() URL's safe size.
      (async () => {
        if (!empIds.length) return []
        const out: any[] = []
        for (let i = 0; i < empIds.length; i += 100) {
          const chunkIds = empIds.slice(i, i + 100)
          const { data } = await fastify.supabase
            .from('employees')
            .select('id, first_name, last_name, employee_code')
            .in('id', chunkIds)
            .eq('tenant_id', req.tenantId)
          if (data) out.push(...data)
        }
        return out
      })(),
      deptIds.length ? fastify.supabase
        .from('departments')
        .select('id, name')
        .in('id', deptIds)
        .eq('tenant_id', req.tenantId)
        .then(r => r.data ?? []) : [],
      locIds.length ? fastify.supabase
        .from('work_locations')
        .select('id, name, city')
        .in('id', locIds)
        .eq('tenant_id', req.tenantId)
        .then(r => r.data ?? []) : [],
      siteIds.length ? fastify.supabase
        .from('sites')
        .select('id, name, location')
        .in('id', siteIds)
        .eq('tenant_id', req.tenantId)
        .then(r => r.data ?? []) : [],
    ])

    const empMap  = new Map((emps  as any[]).map(e => [e.id, e]))
    const deptMap = new Map((depts as any[]).map(d => [d.id, d]))
    const locMap  = new Map((locs  as any[]).map(l => [l.id, l]))
    const siteMap = new Map((sites as any[]).map(s => [s.id, s]))

    const rows = ((data ?? []) as any[]).map(row => {
      let scope_label: string = 'All employees (default)'
      let scope_details: Record<string, unknown> | null = null

      if (row.scope_type === 'employee' && row.scope_id) {
        const e = empMap.get(row.scope_id)
        scope_label   = e ? `${e.first_name} ${e.last_name} (${e.employee_code})` : row.scope_id
        scope_details = e ?? null
      } else if (row.scope_type === 'department' && row.scope_id) {
        const d = deptMap.get(row.scope_id)
        scope_label   = d ? d.name : row.scope_id
        scope_details = d ?? null
      } else if (row.scope_type === 'work_location' && row.scope_id) {
        const l = locMap.get(row.scope_id)
        scope_label   = l ? `${l.name}${l.city ? ` · ${l.city}` : ''}` : row.scope_id
        scope_details = l ?? null
      } else if (row.scope_type === 'site' && row.scope_id) {
        const s = siteMap.get(row.scope_id)
        scope_label   = s ? `${s.name}${s.location ? ` · ${s.location}` : ''}` : row.scope_id
        scope_details = s ?? null
      }

      return {
        id:            row.id,
        policy_id:     row.leave_policy_masters?.id,
        policy_name:   row.leave_policy_masters?.name,
        policy_active: row.leave_policy_masters?.is_active,
        scope_type:    row.scope_type,
        scope_id:      row.scope_id,
        scope_label,
        scope_details,
        priority:      SCOPE_PRIORITY[row.scope_type] ?? 99,
        created_at:    row.created_at,
        updated_at:    row.updated_at,
      }
    })

    // Sort by priority for clarity
    rows.sort((a, b) => a.priority - b.priority)

    return reply.send({ data: rows })
  })

  // ── POST / ─────────────────────────────────────────────────────────────────
  fastify.post('/', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const parsed = assignmentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { policy_id, scope_type } = parsed.data
    const scope_id = 'scope_id' in parsed.data ? (parsed.data.scope_id ?? null) : null

    // Verify policy belongs to this tenant
    const { data: policy } = await fastify.supabase
      .from('leave_policy_masters')
      .select('id, name')
      .eq('id', policy_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!policy) {
      return reply.code(404).send({ error: 'POLICY_NOT_FOUND', message: 'Policy not found' })
    }

    // Verify scope entity (if not default)
    if (scope_id) {
      const table =
        scope_type === 'employee'      ? 'employees'       :
        scope_type === 'department'    ? 'departments'     :
        scope_type === 'work_location' ? 'work_locations'  :
        scope_type === 'site'          ? 'sites'           : null

      if (table) {
        const { data: entity } = await fastify.supabase
          .from(table)
          .select('id')
          .eq('id', scope_id)
          .eq('tenant_id', req.tenantId)
          .maybeSingle()

        if (!entity) {
          return reply.code(404).send({
            error:   'SCOPE_NOT_FOUND',
            message: `${scope_type.replace('_', ' ')} not found in this tenant`,
          })
        }
      }
    }

    const { data, error } = await fastify.supabase
      .from('leave_policy_assignments')
      .insert({
        tenant_id:  req.tenantId,
        policy_id,
        scope_type,
        scope_id:   scope_id ?? null,
      })
      .select('id, policy_id, scope_type, scope_id, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: `An assignment already exists for this ${scope_type}. Remove it first.`,
        })
      }
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create leave policy assignment')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_assignments',
      recordId:    (data as any).id,
      action:      'INSERT',
      performedBy: req.userId,
      newData:     { policy_id, scope_type, scope_id: scope_id ?? null },
    })

    return reply.code(201).send({ data })
  })

  // ── DELETE /:id ────────────────────────────────────────────────────────────
  fastify.delete('/:id', auth, async (req: any, reply) => {
    if (!requireAdmin(req, reply)) return

    const { id } = req.params as { id: string }

    // Fetch before deletion for audit record
    const { data: beforeDelete } = await fastify.supabase
      .from('leave_policy_assignments')
      .select('policy_id, scope_type, scope_id')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()

    if (!beforeDelete) {
      return notFound(reply, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found')
    }

    const { error } = await fastify.supabase
      .from('leave_policy_assignments')
      .delete()
      .eq('id', id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete leave policy assignment')
    }

    await logAction(fastify.supabase, {
      tenantId:    req.tenantId,
      tableName:   'leave_policy_assignments',
      recordId:    id,
      action:      'DELETE',
      performedBy: req.userId,
      oldData:     beforeDelete ?? { id },
    })

    return reply.code(204).send()
  })
}
