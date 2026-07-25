import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

export default async function analyticsRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = { preHandler: [fastify.authenticate, requireRole('super_admin', 'hr_admin')] }

  fastify.get('/analytics/dashboard', auth, async (req, reply) => {
    const tid = req.tenantId
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    // deptRows/typeRows are paginated — a plain row-returning .select() (no
    // count:exact/head:true) truncates at PostgREST's 1,000-row ceiling for a
    // large tenant, understating the department/employment-type breakdowns.
    const [totalRes, activeRes, joinersRes, separationsRes, deptRows, typeRows] = await Promise.all([
      fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tid),
      fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'active'),
      fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).gte('joining_date', monthStart),
      fastify.supabase.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', tid).eq('status', 'separated').gte('updated_at', monthStart),
      fetchAllRows((from, to) =>
        fastify.supabase.from('employees').select('departments:department_id(name)').eq('tenant_id', tid).eq('status', 'active').range(from, to),
      ),
      fetchAllRows((from, to) =>
        fastify.supabase.from('employees').select('employment_type').eq('tenant_id', tid).eq('status', 'active').range(from, to),
      ),
    ])

    // Aggregate department breakdown
    const deptCounts: Record<string, number> = {}
    for (const emp of deptRows) {
      const name = (emp.departments as unknown as { name: string } | null)?.name ?? 'Unassigned'
      deptCounts[name] = (deptCounts[name] ?? 0) + 1
    }
    const department_breakdown = Object.entries(deptCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    // Aggregate employment type breakdown
    const typeCounts: Record<string, number> = {}
    for (const emp of typeRows) {
      typeCounts[emp.employment_type] = (typeCounts[emp.employment_type] ?? 0) + 1
    }
    const employment_type_breakdown = Object.entries(typeCounts).map(([type, count]) => ({ type, count }))

    return reply.send({
      total_employees: totalRes.count ?? 0,
      active_employees: activeRes.count ?? 0,
      new_joiners_this_month: joinersRes.count ?? 0,
      separations_this_month: separationsRes.count ?? 0,
      department_breakdown,
      employment_type_breakdown,
    })
  })

  // /me — returns current user profile + tenant
  fastify.get('/me', auth, async (req, reply) => {
    const [profileRes, tenantRes] = await Promise.all([
      fastify.supabase.from('profiles').select('*').eq('id', req.userId).eq('tenant_id', req.tenantId).single(),
      fastify.supabase.from('tenants').select('*').eq('id', req.tenantId).single(),
    ])

    if (profileRes.error) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Profile not found' })

    return reply.send({ profile: profileRes.data, tenant: tenantRes.data })
  })

  // ── User management ──────────────────────────────────────────────────────────
  // NOTE: POST /setup is handled by routes/setup.ts (registered before authPlugin)

  /**
   * GET /users — list all profiles for this tenant (hr_admin+)
   * Returns: { data: Profile[] }
   */
  fastify.get('/users', adminAuth, async (req, reply) => {
    const { data, error } = await fastify.supabase
      .from('profiles')
      .select('id, full_name, role, is_active, created_at, employee_id, avatar_url')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: true })

    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: 'Failed to fetch users' })
    return reply.send({ data: data ?? [] })
  })

  /**
   * PUT /users/:id/role — change a user's role (super_admin only)
   * Body: { role: 'hr_admin' | 'manager' | 'employee' }
   * Cannot demote/promote oneself, cannot touch other super_admins.
   */
  fastify.put('/users/:id/role', { preHandler: [fastify.authenticate, requireRole('super_admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const roleSchema = z.object({
      role: z.enum(['super_admin', 'hr_admin', 'manager', 'employee']),
    })
    const parsed = roleSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    // Cannot change own role
    if (id === req.userId) {
      return reply.code(400).send({ error: 'SELF_MODIFY', message: 'Cannot change your own role.' })
    }

    // Verify the target profile belongs to same tenant
    const { data: target, error: fetchErr } = await fastify.supabase
      .from('profiles')
      .select('id, role')
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .single()

    if (fetchErr || !target) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found.' })
    }

    const { data: updated, error: updateErr } = await fastify.supabase
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, full_name, role')
      .single()

    if (updateErr) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update role.' })
    return reply.send({ data: updated })
  })

  /**
   * PUT /users/:id/status — activate or deactivate a user (hr_admin+)
   * Body: { is_active: boolean }
   * Cannot deactivate oneself.
   */
  fastify.put('/users/:id/status', adminAuth, async (req, reply) => {
    const { id } = req.params as { id: string }

    const statusSchema = z.object({ is_active: z.boolean() })
    const parsed = statusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    if (id === req.userId) {
      return reply.code(400).send({ error: 'SELF_MODIFY', message: 'Cannot change your own status.' })
    }

    const { data, error } = await fastify.supabase
      .from('profiles')
      .update({ is_active: parsed.data.is_active })
      .eq('id', id)
      .eq('tenant_id', req.tenantId)
      .select('id, full_name, is_active')
      .single()

    if (error || !data) return reply.code(500).send({ error: 'UPDATE_FAILED', message: 'Failed to update status.' })

    // Mirror the ban/unban behaviour from user-account.ts — set Supabase Auth
    // ban_duration so existing JWTs are rejected immediately, not just at TTL.
    const { error: authErr } = await fastify.supabase.auth.admin.updateUserById(id, {
      ban_duration: parsed.data.is_active ? 'none' : '876000h',
    })
    if (authErr) {
      fastify.log.warn({ err: authErr, userId: id }, 'analytics: auth ban/unban failed — profile updated but auth not synced')
    }

    return reply.send({ data })
  })
}
