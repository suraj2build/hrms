/**
 * Rosters CRUD — /masters/rosters
 *
 * A "roster" is a named repeating work cycle (7 / 14 / 28 days) that
 * carries weekly-off days and an optional per-cycle-day shift pattern.
 *
 * GET    /masters/rosters        — list all rosters for the tenant
 * POST   /masters/rosters        — create a new roster (hr_admin / super_admin)
 * PUT    /masters/rosters/:id    — update a roster   (hr_admin / super_admin)
 * DELETE /masters/rosters/:id    — delete a roster   (hr_admin / super_admin)
 *
 * Note: employees.roster_id → rosters.id is ON DELETE SET NULL,
 * so deleting a roster that has employees will just clear their roster_id.
 */

import type { FastifyInstance } from 'fastify'
import { z }                    from 'zod'

const weeklyOffDaySchema = z.number().int().min(0).max(6)

const shiftPatternEntrySchema = z.object({
  cycle_day:  z.number().int().min(0),
  shift_code: z.string().min(1),
})

const patternJsonSchema = z.object({
  weekly_off_days: z.array(weeklyOffDaySchema).default([]),
  shift_pattern:   z.array(shiftPatternEntrySchema).optional(),
})

const schema = z.object({
  name:         z.string().min(1, 'Name is required').max(120),
  /**
   * Optional short machine-readable code for CSV import / employee template references.
   * Must be unique within the tenant when provided (enforced by DB constraint uq_rosters_tenant_code).
   */
  code:         z.string().min(1).max(20).optional().nullable(),
  cycle_days:   z.union([z.literal(7), z.literal(14), z.literal(28)]).default(7),
  pattern_json: patternJsonSchema.default({ weekly_off_days: [] }),
})

export default async function rostersRoutes(fastify: FastifyInstance) {
  const auth      = { preHandler: [fastify.authenticate] }
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      async (req: any, reply: any) => {
        if (!['super_admin', 'hr_admin'].includes(req.userRole)) {
          return reply.code(403).send({
            error:   'FORBIDDEN',
            message: 'HR admin access required',
          })
        }
      },
    ],
  }

  // ── GET /masters/rosters ──────────────────────────────────────────────────
  fastify.get('/', auth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('rosters')
      .select('id, name, code, cycle_days, pattern_json, created_at')
      .eq('tenant_id', req.tenantId)
      .order('name')

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.send({ data: data ?? [] })
  })

  // ── POST /masters/rosters ─────────────────────────────────────────────────
  fastify.post('/', adminAuth, async (req: any, reply) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data, error } = await fastify.supabase
      .from('rosters')
      .insert({ ...parsed.data, tenant_id: req.tenantId })
      .select('id, name, code, cycle_days, pattern_json, created_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        const field = error.message?.includes('uq_rosters_tenant_code') ? 'code' : 'name'
        return reply.code(409).send({
          error:   'DUPLICATE',
          message: field === 'code'
            ? `A roster with code "${parsed.data.code}" already exists`
            : `A roster named "${parsed.data.name}" already exists`,
        })
      }
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── PUT /masters/rosters/:id ──────────────────────────────────────────────
  fastify.put('/:id', adminAuth, async (req: any, reply) => {
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION',
        message: parsed.error.issues[0]?.message,
      })
    }

    const { data, error } = await fastify.supabase
      .from('rosters')
      .update(parsed.data)
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)
      .select('id, name, code, cycle_days, pattern_json, created_at')
      .single()

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    if (!data) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Roster not found' })
    }

    return reply.send({ data })
  })

  // ── DELETE /masters/rosters/:id ───────────────────────────────────────────
  fastify.delete('/:id', adminAuth, async (req: any, reply) => {
    const { error } = await fastify.supabase
      .from('rosters')
      .delete()
      .eq('id', (req.params as any).id)
      .eq('tenant_id', req.tenantId)

    if (error) {
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.code(204).send()
  })
}
