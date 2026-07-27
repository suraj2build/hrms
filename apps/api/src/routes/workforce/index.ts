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

// Fresh audit finding: 'certification' was missing here even though it's a
// valid LifecycleCategory that computeLifecycleRisks actively generates
// (employee_certifications rows) — filtering by ?category=certification
// failed zod validation, which (before the fix below) silently dropped ALL
// filters rather than 400ing, so the certification risk register was
// unreachable through this filter and the failure was invisible to callers.
const CATEGORIES: LifecycleCategory[] = ['document', 'identity', 'passport', 'visa', 'contract', 'probation', 'certification']
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
    // Fresh audit finding: this used to fall back to `{}` on ANY validation
    // failure, silently ignoring every filter (not just the invalid one) —
    // a typo'd department_id or an out-of-range within_days would return
    // the full unfiltered register with a 200, not a 400.
    if (!qs.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: qs.error.issues[0]?.message ?? 'Invalid query parameters' })
    }
    const f = qs.data

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
