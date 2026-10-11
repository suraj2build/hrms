/**
 * Public Careers routes — /careers/*
 *
 * The only unauthenticated routes in the recruitment module. Every other
 * candidate/application-creation route in recruitment/index.ts is
 * hrAdminAuth-gated, which meant a customer could not run live hiring
 * through CognixHR — only track candidates sourced through another channel.
 *
 * No preHandler — tenant is resolved fresh from the tenants.slug URL segment
 * on every request (never cached, never trusted from elsewhere), mirroring
 * the no-JWT token-resolution pattern used by the pre-joinee onboarding
 * portal (apps/api/src/routes/onboarding/pre-joinee.ts). A suspended/
 * expired/cancelled tenant's page is blocked here the same way auth.ts's
 * write-gate blocks every authenticated write — this route has no JWT to
 * run through that gate, so it re-checks tenant status itself.
 *
 *   GET  /careers/:tenantSlug/openings           — list public, open requisitions
 *   GET  /careers/:tenantSlug/openings/:id        — single opening detail
 *   POST /careers/:tenantSlug/openings/:id/apply  — submit an application
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isTenantBlocked } from '../../plugins/auth.js'
import { logAction } from '../../lib/audit-service.js'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { sendEmail, applicationReceivedEmail } from '../../lib/email-service.js'

async function resolveTenant(fastify: FastifyInstance, slug: string) {
  const { data: tenant } = await fastify.supabase
    .from('tenants')
    .select('id, name, status, trial_ends_at')
    .eq('slug', slug)
    .maybeSingle()
  return tenant as { id: string; name: string; status: string; trial_ends_at: string | null } | null
}

export default async function publicCareersRoutes(fastify: FastifyInstance) {
  // ── GET /careers/:tenantSlug/openings ───────────────────────────────────────
  fastify.get('/careers/:tenantSlug/openings', async (req: any, reply) => {
    const { tenantSlug } = req.params as { tenantSlug: string }
    const tenant = await resolveTenant(fastify, tenantSlug)
    if (!tenant || isTenantBlocked(tenant).blocked) return notFound(reply, 'NOT_FOUND', 'Careers page not found')

    const { data, error } = await fastify.supabase
      .from('job_requisitions')
      .select('id, title, location, employment_type, openings, min_experience, max_experience, departments(name)')
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch open positions')

    return reply.send({
      data: {
        company_name: tenant.name,
        openings: ((data ?? []) as any[]).map(r => ({
          id: r.id, title: r.title, location: r.location, employment_type: r.employment_type,
          openings: r.openings, min_experience: r.min_experience, max_experience: r.max_experience,
          department: r.departments?.name ?? null,
        })),
      },
    })
  })

  // ── GET /careers/:tenantSlug/openings/:id ───────────────────────────────────
  fastify.get('/careers/:tenantSlug/openings/:id', async (req: any, reply) => {
    const { tenantSlug, id } = req.params as { tenantSlug: string; id: string }
    if (!z.string().uuid().safeParse(id).success) return notFound(reply, 'NOT_FOUND', 'Opening not found')

    const tenant = await resolveTenant(fastify, tenantSlug)
    if (!tenant || isTenantBlocked(tenant).blocked) return notFound(reply, 'NOT_FOUND', 'Careers page not found')

    const { data, error } = await fastify.supabase
      .from('job_requisitions')
      .select('id, title, location, employment_type, openings, jd_text, required_skills, min_experience, max_experience, departments(name)')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .eq('is_public', true)
      .maybeSingle()
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch opening')
    if (!data) return notFound(reply, 'NOT_FOUND', 'Opening not found')

    const r = data as any
    return reply.send({
      data: {
        company_name: tenant.name, id: r.id, title: r.title, location: r.location,
        employment_type: r.employment_type, openings: r.openings, jd_text: r.jd_text,
        required_skills: r.required_skills, min_experience: r.min_experience, max_experience: r.max_experience,
        department: r.departments?.name ?? null,
      },
    })
  })

  // ── POST /careers/:tenantSlug/openings/:id/apply ────────────────────────────
  fastify.post('/careers/:tenantSlug/openings/:id/apply', async (req: any, reply) => {
    const { tenantSlug, id } = req.params as { tenantSlug: string; id: string }
    if (!z.string().uuid().safeParse(id).success) return notFound(reply, 'NOT_FOUND', 'Opening not found')

    const tenant = await resolveTenant(fastify, tenantSlug)
    if (!tenant || isTenantBlocked(tenant).blocked) return notFound(reply, 'NOT_FOUND', 'Careers page not found')

    const schema = z.object({
      first_name:       z.string().trim().min(1).max(100),
      last_name:        z.string().trim().min(1).max(100),
      email:            z.string().trim().email(),
      phone:            z.string().trim().max(20).optional(),
      resume_url:       z.string().trim().url().optional(),
      linkedin_url:     z.string().trim().url().optional(),
      current_company:  z.string().trim().max(200).optional(),
      current_title:    z.string().trim().max(200).optional(),
      total_experience: z.number().min(0).max(60).optional(),
      notes:            z.string().trim().max(2000).optional(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message })
    }

    const { data: opening, error: openingErr } = await fastify.supabase
      .from('job_requisitions')
      .select('id, title')
      .eq('id', id).eq('tenant_id', tenant.id).eq('status', 'open').eq('is_public', true)
      .maybeSingle()
    if (openingErr) return serverError(req, reply, openingErr, ErrorCode.QUERY_FAILED, 'Failed to fetch opening')
    if (!opening) return notFound(reply, 'NOT_FOUND', 'This position is no longer accepting applications')

    // Find-or-create candidate by (tenant_id, email) — candidates.email is
    // UNIQUE per tenant, but nothing elsewhere in the codebase looks this up
    // before inserting (the existing hrAdminAuth-gated POST /recruitment/
    // candidates just inserts and maps 23505 to a 409). A public applicant
    // re-applying later to a different opening must reuse their existing
    // candidate row, not get a confusing duplicate-email error.
    const { data: existingCandidate, error: lookupErr } = await fastify.supabase
      .from('candidates')
      .select('id')
      .eq('tenant_id', tenant.id).eq('email', parsed.data.email)
      .maybeSingle()
    if (lookupErr) return serverError(req, reply, lookupErr, ErrorCode.QUERY_FAILED, 'Failed to look up candidate')

    let candidateId: string
    if (existingCandidate) {
      candidateId = (existingCandidate as any).id
      // Refresh whatever new info this application carries — a stale resume
      // or old phone number from a prior application shouldn't stick around.
      const { error: updateErr } = await fastify.supabase
        .from('candidates')
        .update({
          phone: parsed.data.phone ?? null, resume_url: parsed.data.resume_url ?? null,
          linkedin_url: parsed.data.linkedin_url ?? null, current_company: parsed.data.current_company ?? null,
          current_title: parsed.data.current_title ?? null, total_experience: parsed.data.total_experience ?? null,
        })
        .eq('id', candidateId).eq('tenant_id', tenant.id)
      if (updateErr) return serverError(req, reply, updateErr, ErrorCode.UPDATE_FAILED, 'Failed to update candidate profile')
    } else {
      const { data: newCandidate, error: insertErr } = await fastify.supabase
        .from('candidates')
        .insert({
          tenant_id: tenant.id,
          first_name: parsed.data.first_name, last_name: parsed.data.last_name, email: parsed.data.email,
          phone: parsed.data.phone ?? null, resume_url: parsed.data.resume_url ?? null,
          linkedin_url: parsed.data.linkedin_url ?? null, current_company: parsed.data.current_company ?? null,
          current_title: parsed.data.current_title ?? null, total_experience: parsed.data.total_experience ?? null,
          source: 'portal',
        })
        .select('id').single()
      if (insertErr) {
        if ((insertErr as any).code === '23505') {
          // Lost a race against a concurrent application from the same
          // candidate — re-select rather than fail the whole request.
          const { data: raced } = await fastify.supabase
            .from('candidates').select('id').eq('tenant_id', tenant.id).eq('email', parsed.data.email).maybeSingle()
          if (!raced) return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to create candidate')
          candidateId = (raced as any).id
        } else {
          return serverError(req, reply, insertErr, ErrorCode.INSERT_FAILED, 'Failed to create candidate')
        }
      } else {
        candidateId = (newCandidate as any).id
      }
    }

    const { data: application, error: appErr } = await fastify.supabase
      .from('applications')
      .insert({ tenant_id: tenant.id, requisition_id: id, candidate_id: candidateId, status: 'applied' })
      .select('id').single()
    if (appErr) {
      if ((appErr as any).code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE_APPLICATION', message: 'You have already applied to this position' })
      }
      return serverError(req, reply, appErr, ErrorCode.INSERT_FAILED, 'Failed to submit application')
    }

    const appId = (application as any).id
    await logAction(fastify.supabase, {
      tenantId: tenant.id, tableName: 'applications', recordId: appId, action: 'INSERT',
      performedBy: null, newData: { requisition_id: id, candidate_id: candidateId, source: 'public_careers_page' },
    })

    void (async () => {
      const { APP_PUBLIC_URL } = await import('../../lib/email-service.js')
      await sendEmail({
        to: parsed.data.email,
        idempotencyKey: `application-received:${appId}`,
        ...applicationReceivedEmail({
          candidateName: `${parsed.data.first_name} ${parsed.data.last_name}`,
          jobTitle: (opening as any).title,
          companyName: tenant.name,
          portalUrl: `${APP_PUBLIC_URL}/portal/candidate/${appId}`,
        }),
      })
    })()

    return reply.code(201).send({ data: { application_id: appId } })
  })
}
