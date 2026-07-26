/**
 * Internal Talent Marketplace — /talent
 *
 * HR-side:
 *   GET  /talent/roles              — list all roles (admin)
 *   POST /talent/roles              — post a new open role
 *   PUT  /talent/roles/:id          — update a role
 *   POST /talent/roles/:id/close    — close a role
 *   GET  /talent/roles/:id/interests — view all interest registrations
 *   PUT  /talent/interests/:iid     — update interest status (shortlist/select/etc.)
 *
 * ESS-side:
 *   GET  /talent/browse             — active open roles (employee view)
 *   POST /talent/interest           — register interest in a role
 *   GET  /talent/my-interests       — list my own interest registrations
 *   DELETE /talent/interest/:iid    — withdraw interest
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

async function resolveCallerEmployeeId(fastify: any, userId: string, tenantId: string): Promise<string | null> {
  const { data } = await fastify.supabase
    .from('profiles')
    .select('employee_id')
    .eq('id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as any)?.employee_id ?? null
}

// ── Body schemas ─────────────────────────────────────────────────────────────

const CreateRoleSchema = z.object({
  title: z.string().min(1, 'title is required'),
  department: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  skills_required: z.array(z.string()).optional(),
  experience_min: z.number().min(0).optional().nullable(),
  closes_at: z.string().optional().nullable(),
})

const UpdateRoleSchema = z.object({
  title: z.string().optional(),
  department: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  skills_required: z.array(z.string()).optional(),
  experience_min: z.number().min(0).optional().nullable(),
  is_open: z.boolean().optional(),
  closes_at: z.string().optional().nullable(),
})

const UpdateInterestSchema = z.object({
  status: z.enum(['interested', 'shortlisted', 'selected', 'not_selected']),
  reviewer_notes: z.string().optional().nullable(),
})

const RegisterInterestSchema = z.object({
  role_id: z.string().uuid('role_id must be a valid UUID'),
  cover_note: z.string().optional().nullable(),
  skills: z.array(z.string()).optional(),
  availability: z.string().optional(),
})

export default async function talentRoutes(fastify: FastifyInstance) {
  const { supabase } = fastify
  const auth        = { preHandler: [fastify.authenticate] }
  const hrAuth      = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ── HR: list all roles ──────────────────────────────────────────────────────
  fastify.get('/roles', hrAuth, async (req: any, reply) => {
    const { is_open } = req.query as { is_open?: string }
    let data: any[]
    try {
      data = await fetchAllRows((from, to) => {
        let q = supabase
          .from('talent_roles')
          .select('id, title, department, location, description, skills_required, experience_min, is_open, posted_at, closes_at, created_at')
          .eq('tenant_id', req.tenantId)
          .order('posted_at', { ascending: false })
        if (is_open !== undefined) q = q.eq('is_open', is_open === 'true')
        return q.range(from, to)
      })
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }

    // Attach interest counts
    const ids = data.map((r: any) => r.id)
    const countMap: Record<string, number> = {}
    if (ids.length > 0) {
      try {
        const interests = await fetchAllRows((from, to) =>
          supabase
            .from('talent_interests')
            .select('role_id')
            .eq('tenant_id', req.tenantId)
            .in('role_id', ids)
            .neq('status', 'withdrawn')
            .range(from, to)
        ) as any[]
        interests.forEach((i: any) => { countMap[i.role_id] = (countMap[i.role_id] ?? 0) + 1 })
      } catch (err: any) {
        return reply.code(500).send({ error: err.message })
      }
    }

    return reply.send({ data: data.map((r: any) => ({ ...r, interest_count: countMap[r.id] ?? 0 })) })
  })

  // ── HR: post a role ─────────────────────────────────────────────────────────
  fastify.post('/roles', hrAuth, async (req: any, reply) => {
    const parsed = CreateRoleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const b = parsed.data

    const { data, error } = await supabase
      .from('talent_roles')
      .insert({
        tenant_id:       req.tenantId,
        title:           b.title.trim(),
        department:      b.department    ?? null,
        location:        b.location      ?? null,
        description:     b.description   ?? null,
        skills_required: b.skills_required ?? [],
        experience_min:  b.experience_min  ?? null,
        closes_at:       b.closes_at       ?? null,
        created_by:      req.userId,
      })
      .select('id')
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send({ data })
  })

  // ── HR: update a role ───────────────────────────────────────────────────────
  fastify.put('/roles/:id', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const parsed = UpdateRoleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const b = parsed.data as Record<string, unknown>
    const allowed = ['title', 'department', 'location', 'description', 'skills_required', 'experience_min', 'is_open', 'closes_at']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (b[k] !== undefined) update[k] = b[k] }
    if (Object.keys(update).length === 0) return reply.code(400).send({ error: 'No fields to update' })

    const { error } = await supabase.from('talent_roles').update(update).eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  // ── HR: close a role ────────────────────────────────────────────────────────
  fastify.post('/roles/:id/close', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { error } = await supabase.from('talent_roles').update({ is_open: false }).eq('id', id).eq('tenant_id', req.tenantId)
    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { closed: true } })
  })

  // ── HR: view interests for a role ───────────────────────────────────────────
  fastify.get('/roles/:id/interests', hrAuth, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('talent_interests')
          .select(`id, status, availability, cover_note, skills, created_at, reviewed_at, reviewer_notes, employees!talent_interests_employee_id_fkey(id, first_name, last_name, employee_code, designation:designations(name), department:departments!department_id(name))`)
          .eq('tenant_id', req.tenantId)
          .eq('role_id', id)
          .order('created_at', { ascending: false })
          .range(from, to),
      )
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
    return reply.send({ data })
  })

  // ── HR: update interest status ───────────────────────────────────────────────
  fastify.put('/interests/:iid', hrAuth, async (req: any, reply) => {
    const { iid } = req.params as { iid: string }
    const parsed = UpdateInterestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { status, reviewer_notes } = parsed.data

    const { error } = await supabase
      .from('talent_interests')
      .update({ status, reviewer_notes: reviewer_notes ?? null, reviewed_at: new Date().toISOString(), reviewed_by: req.userId })
      .eq('id', iid)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { updated: true } })
  })

  // ── ESS: browse open roles ───────────────────────────────────────────────────
  fastify.get('/browse', auth, async (req: any, reply) => {
    let data: any[]
    try {
      data = await fetchAllRows((from, to) =>
        supabase
          .from('talent_roles')
          .select('id, title, department, location, description, skills_required, experience_min, posted_at, closes_at')
          .eq('tenant_id', req.tenantId)
          .eq('is_open', true)
          .order('posted_at', { ascending: false })
          .range(from, to),
      )
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }

    // Attach whether the caller has already expressed interest
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    const myInterestMap: Record<string, string> = {}
    if (employeeId && data.length > 0) {
      const roleIds = data.map((r: any) => r.id)
      const { data: myInts } = await supabase
        .from('talent_interests')
        .select('role_id, status')
        .eq('tenant_id', req.tenantId)
        .eq('employee_id', employeeId)
        .in('role_id', roleIds)
      ;(myInts ?? []).forEach((i: any) => { myInterestMap[i.role_id] = i.status })
    }

    return reply.send({
      data: data.map((r: any) => ({
        ...r,
        my_status: myInterestMap[r.id] ?? null,
      })),
    })
  })

  // ── ESS: register interest ───────────────────────────────────────────────────
  fastify.post('/interest', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const parsed = RegisterInterestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    const { role_id, cover_note, skills, availability } = parsed.data

    // Verify role is open
    const { data: role } = await supabase
      .from('talent_roles')
      .select('id, is_open')
      .eq('id', role_id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    if (!role) return reply.code(404).send({ error: 'Role not found' })
    if (!role.is_open) return reply.code(409).send({ error: 'This role is no longer accepting interest' })

    const VALID_AVAIL = ['immediate', '1_month', '3_months', 'open']
    const { data, error } = await supabase
      .from('talent_interests')
      .upsert({
        tenant_id:   req.tenantId,
        role_id,
        employee_id: employeeId,
        cover_note:  cover_note   ?? null,
        skills:      skills        ?? [],
        availability: availability != null && VALID_AVAIL.includes(availability) ? availability : 'open',
        status:      'interested',
      }, { onConflict: 'role_id,employee_id' })
      .select('id')
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send({ data })
  })

  // ── ESS: my interests ────────────────────────────────────────────────────────
  fastify.get('/my-interests', auth, async (req: any, reply) => {
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const { data, error } = await supabase
      .from('talent_interests')
      .select('id, status, availability, cover_note, skills, created_at, talent_roles(id, title, department, location, is_open)')
      .eq('tenant_id', req.tenantId)
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: data ?? [] })
  })

  // ── ESS: withdraw interest ───────────────────────────────────────────────────
  fastify.delete('/interest/:iid', auth, async (req: any, reply) => {
    const { iid } = req.params as { iid: string }
    const employeeId = await resolveCallerEmployeeId(fastify, req.userId, req.tenantId)
    if (!employeeId) return reply.code(403).send({ error: 'PROFILE_NOT_LINKED', message: 'Your profile is not linked to an employee record' })

    const { error } = await supabase
      .from('talent_interests')
      .update({ status: 'withdrawn' })
      .eq('id', iid)
      .eq('employee_id', employeeId)
      .eq('tenant_id', req.tenantId)

    if (error) return reply.code(500).send({ error: error.message })
    return reply.send({ data: { withdrawn: true } })
  })
}
