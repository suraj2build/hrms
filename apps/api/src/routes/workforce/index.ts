/**
 * routes/workforce — workforce lifecycle risk (Program 3A · P3.4).
 *
 * Thin read-only API over the single lifecycle-expiry source. No expiry logic
 * lives here; the endpoint delegates to computeLifecycleRisks so the Expiry
 * Management workspace, Workforce Command, the inbox scanner and the Executive
 * metrics all share one source of truth.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  computeLifecycleRisks, summariseLifecycle,
  type LifecycleCategory, type ExpiryBucket,
} from '../../lib/lifecycle-expiry.js'

const CATEGORIES: LifecycleCategory[] = ['document', 'identity', 'passport', 'visa', 'contract', 'probation']
const BUCKETS: ExpiryBucket[] = ['overdue', 'due_7', 'due_30', 'due_90']

export default async function workforceRoutes(fastify: FastifyInstance) {
  // GET /workforce/expiry — lifecycle risk register (overdue + due within N days)
  fastify.get('/expiry', { preHandler: [fastify.authenticate] }, async (req: any, reply) => {
    if (req.userRole !== 'hr_admin' && req.userRole !== 'super_admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
    const qs = z.object({
      within_days:   z.coerce.number().int().min(1).max(365).optional(),
      category:      z.enum(CATEGORIES as [LifecycleCategory, ...LifecycleCategory[]]).optional(),
      bucket:        z.enum(BUCKETS as [ExpiryBucket, ...ExpiryBucket[]]).optional(),
      department_id: z.string().uuid().optional(),
      employee_id:   z.string().uuid().optional(),
    }).safeParse(req.query)
    const f = qs.success ? qs.data : {}

    // Compute the full register once (single source), then apply UI filters.
    let items = await computeLifecycleRisks(fastify.supabase, req.tenantId, {
      withinDays: f.within_days ?? 90,
      categories: f.category ? [f.category] : undefined,
    })

    if (f.bucket)        items = items.filter(i => i.bucket === f.bucket)
    if (f.department_id) items = items.filter(i => i.department_id === f.department_id)
    if (f.employee_id)   items = items.filter(i => i.employee_id === f.employee_id)

    // Distinct departments present (for the filter dropdown) — derived from the
    // unfiltered-by-department set so the option list is stable.
    const deptOptions = new Map<string, string>()
    for (const i of items) if (i.department_id) deptOptions.set(i.department_id, i.department_name ?? 'Unknown')

    return reply.send({
      data:    items,
      summary: summariseLifecycle(items),
      departments: [...deptOptions.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    })
  })
}
