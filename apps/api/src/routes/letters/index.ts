/**
 * Letter Generation Module — API Routes
 *
 * Endpoints:
 *
 * Templates (HR admin)
 *   GET    /letters/templates              list all templates
 *   POST   /letters/templates              create template
 *   GET    /letters/templates/:id          get single template
 *   PUT    /letters/templates/:id          update template
 *   DELETE /letters/templates/:id          soft-delete (is_active=false)
 *
 * Variables (HR admin)
 *   GET    /letters/variables/:employeeId  resolve live variable values for preview
 *
 * Generate & issue (HR admin)
 *   POST   /letters/generate               generate letter from template for employee
 *   GET    /letters/issued                 list all issued/pending letters
 *   GET    /letters/issued/:letterId       get single letter with approval log
 *   POST   /letters/issued/:letterId/issue mark letter as issued (skips approval)
 *   POST   /letters/issued/:letterId/submit-for-approval
 *   POST   /letters/issued/:letterId/approve
 *   POST   /letters/issued/:letterId/reject
 *   DELETE /letters/issued/:letterId       delete draft letter
 *   GET    /letters/issued/:letterId/pdf   stream/redirect to PDF
 *
 * ESS — employee self-service
 *   GET    /letters/ess/templates          list requestable templates
 *   GET    /letters/ess/my-letters         employee's received letters
 *   POST   /letters/ess/request            request a letter type
 *   GET    /letters/ess/requests           employee's own requests
 *
 * HR — ESS request management
 *   GET    /letters/requests               all ESS requests (HR view)
 *   POST   /letters/requests/:id/fulfill   fulfill ESS request → generates letter
 *   POST   /letters/requests/:id/reject    reject ESS request
 */

import type { FastifyInstance } from 'fastify'
import Handlebars from 'handlebars'
import { STANDARD_LETTER_TEMPLATES } from '../../lib/standard-letter-templates.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { logAction } from '../../lib/audit-service.js'
import { z } from 'zod'
import { serverError, notFound, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'
import { checkIdempotency, storeIdempotency } from '../../lib/idempotency.js'

// ── Embedded-employee normaliser ──────────────────────────────────────────────
// employees has no `full_name` / `designation` columns (name is first+last,
// designation is a designation_id FK). Endpoints embed first/last + a
// designations(name) lookup and we synthesise `full_name` / `designation` here
// so the API response shape the UI consumes stays stable.
function normEmp(e: any): any {
  if (!e) return e
  const d = Array.isArray(e.designations) ? e.designations[0] : e.designations
  return {
    ...e,
    full_name:   `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
    designation: d?.name ?? null,
  }
}

// ── Variable resolver ─────────────────────────────────────────────────────────

/**
 * Pull all resolvable variable values for a given employee.
 * Returns a flat key→value map ready to be fed into Handlebars.
 */
async function resolveEmployeeVars(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
): Promise<Record<string, string>> {
  // Fetch employee + current compensation in parallel. gender/dob/PAN/UAN/ESI/
  // address/designation/department all moved OFF employees onto dedicated
  // tables in 016_lean_employees.sql / 012_employee_extended.sql — the lean
  // employees table now holds only identity + status. Pull them via their
  // real homes: job_history (current row) for employment_type/dept/designation,
  // employee_personal_info for dob/gender, employee_bank_statutory for
  // PAN/UAN/ESI, employee_addresses for the mailing address.
  const [empRes, compRes] = await Promise.all([
    supabase
      .from('employees')
      .select(`
        id, employee_code, first_name, last_name, joining_date,
        job_history!job_history_employee_id_fkey(employment_type, is_current, designations(name), departments(name)),
        employee_personal_info(dob, gender),
        employee_bank_statutory(pan_number, uan_number, esi_number),
        employee_addresses(address_type, line1, line2, city, state, pincode)
      `)
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .eq('job_history.is_current', true)
      .single(),
    supabase
      .from('employee_compensations')
      .select('ctc_annual, ctc_monthly, effective_from')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const emp  = empRes.data  as any
  const comp = compRes.data as any

  if (!emp) return {}

  const flat = (rel: any) => (Array.isArray(rel) ? rel[0] : rel)

  const doj     = emp.joining_date ? new Date(emp.joining_date) : null
  const tenantTz    = await fetchTenantTz(supabase, tenantId)
  const todayLocalStr = getLocalDate(new Date().toISOString(), tenantTz)
  const today   = new Date(`${todayLocalStr}T12:00:00Z`)
  const yearsOfService = doj
    ? Math.floor((today.getTime() - doj.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
    : null

  const jh    = flat(emp.job_history) as any
  const dept  = flat(jh?.departments) as any
  const desig = flat(jh?.designations) as any
  const personal = flat(emp.employee_personal_info) as any
  const statutory = flat(emp.employee_bank_statutory) as any
  // employee_addresses is 1:N (current/permanent/correspondence) — prefer
  // 'current', fall back to 'permanent', then whatever's there.
  const addresses = (Array.isArray(emp.employee_addresses) ? emp.employee_addresses : emp.employee_addresses ? [emp.employee_addresses] : []) as any[]
  const addr = addresses.find(a => a.address_type === 'current')
    ?? addresses.find(a => a.address_type === 'permanent')
    ?? addresses[0]
    ?? {}

  const monthlyCtc = comp?.ctc_monthly != null ? Number(comp.ctc_monthly) : null
  const annualCtc  = comp?.ctc_annual  != null ? Number(comp.ctc_annual)  : null

  const fmt = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : ''

  return {
    // Employee basics
    employee_name:       `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
    employee_code:       emp.employee_code ?? '',
    first_name:          emp.first_name ?? '',
    last_name:           emp.last_name  ?? '',
    designation:         desig?.name ?? '',
    department:          dept?.name ?? '',
    employment_type:     jh?.employment_type ?? '',
    date_of_joining:     fmt(emp.joining_date),
    date_of_birth:       fmt(personal?.dob),
    years_of_service:    yearsOfService !== null ? String(yearsOfService) : '',
    gender:              personal?.gender ?? '',
    pan_number:          statutory?.pan_number ?? '',
    pf_number:           statutory?.uan_number ?? '',
    esi_number:          statutory?.esi_number ?? '',

    // Address (employee_addresses — 'current' address preferred, see above)
    address_line1:       addr.line1 ?? '',
    city:                addr.city ?? '',
    state:               addr.state ?? '',
    pincode:             addr.pincode ?? '',

    // Compensation (CTC-based; gross ≈ monthly CTC). Annual/monthly exposed too.
    gross_salary:        monthlyCtc != null ? `₹${monthlyCtc.toLocaleString('en-IN')}` : '',
    net_salary:          '',
    basic_salary:        '',
    gross_salary_raw:    monthlyCtc != null ? String(monthlyCtc) : '',
    net_salary_raw:      '',
    basic_salary_raw:    '',
    annual_ctc:          annualCtc  != null ? `₹${annualCtc.toLocaleString('en-IN')}`  : '',
    monthly_ctc:         monthlyCtc != null ? `₹${monthlyCtc.toLocaleString('en-IN')}` : '',
    annual_ctc_raw:      annualCtc  != null ? String(annualCtc)  : '',
    monthly_ctc_raw:     monthlyCtc != null ? String(monthlyCtc) : '',

    // Dates
    today:               fmt(today.toISOString()),
    current_date:        todayLocalStr,
    current_month:       today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    current_year:        String(today.getUTCFullYear()),
  }
}

/**
 * Compile a Handlebars template and return rendered HTML + list of missing variables.
 */
function renderTemplate(
  bodyHtml: string,
  subjectTemplate: string,
  vars: Record<string, string>,
  extraVars: Record<string, string> = {},
): { body: string; subject: string; missing: string[] } {
  const data    = { ...vars, ...extraVars }
  const missing: string[] = []

  // Register a helper that tracks missing variables
  const safeData: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    safeData[k] = v ?? ''
  }

  // Find {{variable}} placeholders in the template that have no value
  const allKeys = [...bodyHtml.matchAll(/\{\{([^}#^/!>]+?)\}\}/g)].map(m => m[1].trim())
  for (const key of allKeys) {
    if (!(key in safeData) || safeData[key] === '') {
      if (!missing.includes(key)) missing.push(key)
    }
  }

  let body    = ''
  let subject = ''
  try {
    body    = Handlebars.compile(bodyHtml)(safeData)
    subject = Handlebars.compile(subjectTemplate)(safeData)
  } catch (_err) {
    body    = bodyHtml
    subject = subjectTemplate
  }

  return { body, subject, missing }
}

// ── Request validation schemas ────────────────────────────────────────────────

const approvalChainItemSchema = z.object({
  level:         z.number().int().min(1).max(3),
  approver_role: z.string().min(1),
  label:         z.string().optional(),
})

const createTemplateSchema = z.object({
  name:              z.string().min(1, 'name is required'),
  code:              z.string().min(1, 'code is required'),
  category:          z.enum(['hr_initiated', 'ess_requestable']).default('hr_initiated'),
  letter_type:       z.string().min(1, 'letter_type is required'),
  subject_template:  z.string().max(500).default(''),
  body_html:         z.string().max(100_000).default(''),
  variables:         z.array(z.unknown()).default([]),
  requires_approval: z.boolean().default(false),
  approval_levels:   z.number().int().min(1).max(10).default(1),
  approval_chain:    z.array(approvalChainItemSchema).default([]),
})

// All fields optional for PATCH semantics; approval_chain stays optional so
// absence means "do not touch existing chain" (existing guard checks !== undefined)
const updateTemplateSchema = z.object({
  name:              z.string().min(1).optional(),
  code:              z.string().min(1).optional(),
  category:          z.enum(['hr_initiated', 'ess_requestable']).optional(),
  letter_type:       z.string().min(1).optional(),
  subject_template:  z.string().max(500).optional(),
  body_html:         z.string().max(100_000).optional(),
  variables:         z.array(z.unknown()).optional(),
  requires_approval: z.boolean().optional(),
  approval_levels:   z.number().int().min(1).max(10).optional(),
  is_active:         z.boolean().optional(),
  approval_chain:    z.array(approvalChainItemSchema).optional(),
})

const generateLetterSchema = z.object({
  template_id: z.string().uuid('template_id must be a valid UUID'),
  employee_id: z.string().uuid('employee_id must be a valid UUID'),
  extra_vars:  z.record(z.string(), z.string()).default({}),
})

const commentBodySchema = z.object({
  comments: z.string().max(1000).optional(),
})

const essRequestSchema = z.object({
  template_id: z.string().uuid('template_id must be a valid UUID'),
  reason:      z.string().max(500).default(''),
})

const fulfillSchema = z.object({
  extra_vars: z.record(z.string(), z.string()).default({}),
})

const rejectSchema = z.object({
  reason: z.string().max(1000).default(''),
})

// ── Plugin ────────────────────────────────────────────────────────────────────

export default async function lettersRoutes(fastify: FastifyInstance) {

  const supabase = fastify.supabase

  // HR admin + super_admin only — guards all letter management operations
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // ══════════════════════════════════════════════════════════════════════════════
  // TEMPLATE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /letters/templates
  fastify.get('/letters/templates', hrAdminAuth, async (req, reply) => {
    const { tenantId } = req as any
    const { category, letter_type, active } = req.query as any

    let q = supabase
      .from('letter_templates')
      .select('id,name,code,category,letter_type,variables,requires_approval,approval_levels,is_active,created_at,updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (category)    q = q.eq('category', category)
    if (letter_type) q = q.eq('letter_type', letter_type)
    if (active !== undefined) q = q.eq('is_active', active === 'true' || active === true)

    const { data, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch letter templates')
    return { data }
  })

  // GET /letters/templates/:id
  fastify.get('/letters/templates/:id', hrAdminAuth, async (req, reply) => {
    const { tenantId } = req as any
    const { id }       = req.params as any

    const { data, error } = await supabase
      .from('letter_templates')
      .select(`
        *,
        approval_chains:letter_approval_chains(id,level,approver_role,label)
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (error || !data) return reply.status(404).send({ error: 'Template not found' })
    return { data }
  })

  // POST /letters/templates
  fastify.post('/letters/templates', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const parsed = createTemplateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const {
      name, code, category, letter_type,
      subject_template, body_html, variables,
      requires_approval, approval_levels,
      approval_chain,
    } = parsed.data

    // Resolve created_by via employee record
    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()
    const createdBy = emp?.id ?? null

    const { data: tmpl, error } = await supabase
      .from('letter_templates')
      .insert({
        tenant_id: tenantId, name, code, category, letter_type,
        subject_template, body_html, variables,
        requires_approval, approval_levels,
        created_by: createdBy, updated_by: createdBy,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return reply.status(409).send({ error: 'Template code already exists' })
      return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to create letter template')
    }

    // Save approval chain rows
    if (requires_approval && approval_chain.length > 0) {
      const rows = approval_chain.map((row: any) => ({
        tenant_id: tenantId,
        template_id: tmpl.id,
        level: row.level,
        approver_role: row.approver_role,
        label: row.label ?? `Level ${row.level}`,
      }))
      const { error: chainErr } = await supabase.from('letter_approval_chains').insert(rows)
      if (chainErr) return serverError(req, reply, chainErr, ErrorCode.INSERT_FAILED, 'Failed to save approval chain')
    }

    return reply.status(201).send({ data: tmpl })
  })

  // POST /letters/templates/seed-standard — load best-practice template library
  // Idempotent: existing codes (UNIQUE tenant_id,code) are preserved.
  fastify.post('/letters/templates/seed-standard', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()
    const createdBy = emp?.id ?? null

    const rows = STANDARD_LETTER_TEMPLATES.map(t => ({
      tenant_id: tenantId,
      name: t.name, code: t.code, category: t.category, letter_type: t.letter_type,
      subject_template: t.subject_template, body_html: t.body_html, variables: t.variables,
      requires_approval: t.requires_approval, approval_levels: t.approval_levels,
      is_active: true, created_by: createdBy, updated_by: createdBy,
    }))

    const { data, error } = await supabase
      .from('letter_templates')
      .upsert(rows, { onConflict: 'tenant_id,code', ignoreDuplicates: true })
      .select('id')
    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to seed standard letter templates')

    const created = (data as Array<{ id: string }> | null)?.length ?? 0
    return reply.status(201).send({ data: { created, skipped: rows.length - created, total: rows.length } })
  })

  // PUT /letters/templates/:id
  fastify.put('/letters/templates/:id', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { id }               = req.params as any
    const parsed = updateTemplateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }

    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()

    const {
      name, code, category, letter_type,
      subject_template, body_html, variables,
      requires_approval, approval_levels, is_active,
      approval_chain,
    } = parsed.data

    const patch: Record<string, unknown> = { updated_by: emp?.id ?? null }
    if (name              !== undefined) patch.name              = name
    if (code              !== undefined) patch.code              = code
    if (category          !== undefined) patch.category          = category
    if (letter_type       !== undefined) patch.letter_type       = letter_type
    if (subject_template  !== undefined) patch.subject_template  = subject_template
    if (body_html         !== undefined) patch.body_html         = body_html
    if (variables         !== undefined) patch.variables         = variables
    if (requires_approval !== undefined) patch.requires_approval = requires_approval
    if (approval_levels   !== undefined) patch.approval_levels   = approval_levels
    if (is_active         !== undefined) patch.is_active         = is_active

    const { data: tmpl, error } = await supabase
      .from('letter_templates')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to update letter template')
    if (!tmpl) return reply.status(404).send({ error: 'Template not found' })

    // Replace approval chain if provided
    if (approval_chain !== undefined) {
      await supabase.from('letter_approval_chains').delete().eq('template_id', id)
      if (approval_chain.length > 0) {
        const rows = approval_chain.map((row: any) => ({
          tenant_id: tenantId, template_id: id,
          level: row.level, approver_role: row.approver_role,
          label: row.label ?? `Level ${row.level}`,
        }))
        const { error: chainErr } = await supabase.from('letter_approval_chains').insert(rows)
        if (chainErr) return serverError(req, reply, chainErr, ErrorCode.INSERT_FAILED, 'Failed to save approval chain')
      }
    }

    return { data: tmpl }
  })

  // DELETE /letters/templates/:id  (soft delete)
  fastify.delete('/letters/templates/:id', hrAdminAuth, async (req, reply) => {
    const { tenantId } = req as any
    const { id }       = req.params as any

    const { data, error } = await supabase
      .from('letter_templates')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to delete letter template')
    if (!data) return notFound(reply, 'TEMPLATE_NOT_FOUND', 'Letter template not found')
    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // VARIABLE RESOLUTION  (for live preview)
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /letters/variables/:employeeId  — CRITICAL: returns PAN, salary, bank data; HR admin only
  fastify.get('/letters/variables/:employeeId', hrAdminAuth, async (req, reply) => {
    const { tenantId }  = req as any
    const { employeeId } = req.params as any

    const vars = await resolveEmployeeVars(supabase, tenantId, employeeId)
    return { data: vars }
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // GENERATE & ISSUE LETTERS  (HR-initiated)
  // ══════════════════════════════════════════════════════════════════════════════

  // POST /letters/generate
  fastify.post('/letters/generate', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const parsed = generateLetterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const { template_id, employee_id, extra_vars } = parsed.data

    // Fetch template
    const { data: tmpl, error: tmplErr } = await supabase
      .from('letter_templates')
      .select('*')
      .eq('id', template_id)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single()

    if (tmplErr || !tmpl) return reply.status(404).send({ error: 'Template not found' })

    // employee_id is a raw UUID from the request body — resolveEmployeeVars()
    // already tenant-scopes its own lookup but silently returns {} rather
    // than throwing when the employee isn't found in this tenant, so a
    // foreign-tenant id would previously fall through and create a letter
    // (with blank fields) attributed to that id. GET /letters/issued then
    // joins `employees` unfiltered by tenant, leaking that employee's real
    // name/code back into this tenant's letters list.
    const { data: emp } = await supabase
      .from('employees').select('id').eq('id', employee_id).eq('tenant_id', tenantId).maybeSingle()
    if (!emp) return reply.status(404).send({ error: 'Employee not found in your organisation' })

    // Fresh audit finding: generated_letters has no unique constraint on
    // (tenant_id, template_id, employee_id) unlike certifications' upsert
    // constraint — a double-click or client retry on "Generate Letter"
    // creates two identical official documents with independent approval
    // workflows, with no idempotency guard closing the gap.
    const iKey = (req.headers['idempotency-key'] as string | undefined)?.trim()
    if (iKey) {
      const cached = await checkIdempotency(supabase, tenantId, iKey, 'letters-generate')
      if (cached) {
        reply.header('Idempotency-Replayed', 'true')
        return reply.code(cached.status_code).send(cached.response)
      }
    }

    // Resolve variables
    const empVars = await resolveEmployeeVars(supabase, tenantId, employee_id)
    const { body, subject, missing } = renderTemplate(
      tmpl.body_html, tmpl.subject_template, empVars, extra_vars,
    )

    const { data: creator } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()

    const approval_status = tmpl.requires_approval ? 'draft' : 'approved'
    const current_level   = tmpl.requires_approval ? 1 : 0

    const { data: letter, error: letErr } = await supabase
      .from('generated_letters')
      .insert({
        tenant_id: tenantId,
        template_id,
        employee_id,
        subject,
        body_html: body,
        variable_values: { ...empVars, ...extra_vars },
        missing_vars: missing,
        approval_status,
        current_level,
        created_by: creator?.id ?? null,
      })
      .select()
      .single()

    if (letErr) return serverError(req, reply, letErr, ErrorCode.INSERT_FAILED, 'Failed to generate letter')

    await logAction(supabase, {
      tenantId,
      tableName:   'generated_letters',
      recordId:    letter.id,
      action:      'INSERT',
      performedBy: userId,
      onBehalfOf:  employee_id,
      newData:     { template_id, employee_id, subject, approval_status, letter_type: tmpl.letter_type },
    })

    const responseBody = { data: letter, missing_vars: missing }
    if (iKey) await storeIdempotency(supabase, tenantId, iKey, 'letters-generate', 201, responseBody)
    return reply.status(201).send(responseBody)
  })

  // GET /letters/issued
  fastify.get('/letters/issued', hrAdminAuth, async (req, reply) => {
    const { tenantId } = req as any
    const { employee_id, status, from, to, limit = '50', offset = '0' } = req.query as any

    let q = supabase
      .from('generated_letters')
      .select(`
        id, employee_id, subject, approval_status, current_level,
        issued_at, created_at, missing_vars,
        template:letter_templates(name, letter_type, category),
        employee:employees!employee_id(first_name, last_name, employee_code, designations(name))
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (employee_id) q = q.eq('employee_id', employee_id)
    if (status)      q = q.eq('approval_status', status)
    if (from)        q = q.gte('created_at', from)
    if (to)          q = q.lte('created_at', to)

    const { data, count, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch issued letters')
    return { data: (data ?? []).map((r: any) => ({ ...r, employee: normEmp(r.employee) })), total: count }
  })

  // GET /letters/issued/:letterId
  fastify.get('/letters/issued/:letterId', hrAdminAuth, async (req, reply) => {
    const { tenantId } = req as any
    const { letterId } = req.params as any

    const [letterRes, logRes] = await Promise.all([
      supabase
        .from('generated_letters')
        .select(`
          *,
          template:letter_templates(name,letter_type,category,requires_approval,approval_levels,variables,
            approval_chains:letter_approval_chains(level,approver_role,label)),
          employee:employees!employee_id(first_name,last_name,employee_code,designations(name),
            departments!department_id(name))
        `)
        .eq('id', letterId)
        .eq('tenant_id', tenantId)
        .single(),
      supabase
        .from('letter_approval_log')
        .select(`*, actor:employees!actor_id(first_name, last_name, designations(name))`)
        .eq('letter_id', letterId)
        .order('acted_at', { ascending: true }),
    ])

    if (letterRes.error || !letterRes.data) return reply.status(404).send({ error: 'Letter not found' })
    return {
      data: {
        ...letterRes.data,
        employee:     normEmp((letterRes.data as any).employee),
        approval_log: (logRes.data ?? []).map((l: any) => ({ ...l, actor: normEmp(l.actor) })),
      },
    }
  })

  // POST /letters/issued/:letterId/submit-for-approval
  fastify.post('/letters/issued/:letterId/submit-for-approval', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { letterId } = req.params as any

    const { data, error } = await supabase
      .from('generated_letters')
      .update({ approval_status: 'pending_approval', current_level: 1 })
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .eq('approval_status', 'draft')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to submit letter for approval')
    if (!data) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Letter not found or not in draft state' })

    await logAction(supabase, {
      tenantId,
      tableName:   'generated_letters',
      recordId:    letterId,
      action:      'UPDATE',
      performedBy: userId,
      newData:     { approval_status: 'pending_approval', current_level: 1 },
    })

    return { success: true }
  })

  // POST /letters/issued/:letterId/approve
  fastify.post('/letters/issued/:letterId/approve', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { letterId }         = req.params as any
    const parsed = commentBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const { comments } = parsed.data

    const { data: letter, error: letterErr } = await supabase
      .from('generated_letters')
      .select('*, template:letter_templates(approval_levels)')
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (letterErr) return serverError(req, reply, letterErr, ErrorCode.QUERY_FAILED, 'Failed to fetch letter')
    if (!letter) return reply.status(404).send({ error: 'Letter not found' })
    if (letter.approval_status !== 'pending_approval') {
      return reply.status(409).send({ error: 'INVALID_STATE', message: `Letter is not pending approval (status: ${letter.approval_status})` })
    }

    const { data: actor } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()

    const maxLevel     = letter.template?.approval_levels ?? 1
    const currentLevel = letter.current_level ?? 1
    const nextLevel    = currentLevel + 1
    const isLastLevel  = currentLevel >= maxLevel

    // Fresh audit finding: hrAdminAuth was the ONLY gate on this route, so
    // any hr_admin could approve every configured level themselves in
    // sequence, defeating the whole point of a multi-level approval chain
    // (separation of duties). If this template's chain has a row for the
    // current level, the acting user's role must match approver_role — no
    // chain row for this level means the chain isn't configured that
    // granularly, so it stays transparent (hrAdminAuth-only), same as the
    // "no chain configured" fallback used elsewhere (e.g. gateApprove).
    const { data: chainStep } = await supabase
      .from('letter_approval_chains')
      .select('approver_role')
      .eq('template_id', letter.template_id)
      .eq('level', currentLevel)
      .maybeSingle()
    if (chainStep && (req as any).userRole !== chainStep.approver_role && (req as any).userRole !== 'super_admin') {
      return reply.status(403).send({
        error:   'FORBIDDEN',
        message: `Level ${currentLevel} of this approval chain requires role '${chainStep.approver_role}'`,
      })
    }

    const newStatus = isLastLevel ? 'approved' : 'pending_approval'
    const newLevel  = isLastLevel ? currentLevel : nextLevel

    // Fold the precondition into the UPDATE itself and check the returned
    // row — two concurrent approve calls (double-click/retry) would
    // otherwise both pass the SELECT check above and both write a
    // duplicate approval-log entry for the same real approval.
    const { data: updated } = await supabase
      .from('generated_letters')
      .update({ approval_status: newStatus, current_level: newLevel })
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .eq('approval_status', 'pending_approval')
      .eq('current_level', currentLevel)
      .select('id')
      .maybeSingle()

    if (!updated) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'This letter was already actioned by another request' })
    }

    await supabase.from('letter_approval_log').insert({
      tenant_id: tenantId, letter_id: letterId,
      level: currentLevel, action: 'approved',
      actor_id: actor?.id, comments,
    })

    await logAction(supabase, {
      tenantId,
      tableName:   'generated_letters',
      recordId:    letterId,
      action:      'UPDATE',
      performedBy: userId,
      oldData:     { approval_status: 'pending_approval', current_level: currentLevel },
      newData:     { approval_status: newStatus, current_level: newLevel, approved_level: currentLevel, comments },
    })

    return { success: true, fully_approved: isLastLevel }
  })

  // POST /letters/issued/:letterId/reject
  fastify.post('/letters/issued/:letterId/reject', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { letterId }         = req.params as any
    const parsed = commentBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const { comments = '' } = parsed.data

    const { data: actor } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()

    const { data: letter, error: letterErr } = await supabase
      .from('generated_letters')
      .select('current_level, approval_status, template_id').eq('id', letterId).eq('tenant_id', tenantId).maybeSingle()

    if (letterErr) return serverError(req, reply, letterErr, ErrorCode.QUERY_FAILED, 'Failed to fetch letter')
    if (!letter) return reply.status(404).send({ error: 'Letter not found' })
    if (letter.approval_status !== 'pending_approval') {
      return reply.status(409).send({ error: 'INVALID_STATE', message: `Letter is not pending approval (status: ${letter.approval_status})` })
    }

    // Same chain-role enforcement as /approve — hrAdminAuth alone doesn't
    // respect a configured multi-level approver_role per level.
    const { data: chainStep } = await supabase
      .from('letter_approval_chains')
      .select('approver_role')
      .eq('template_id', letter.template_id)
      .eq('level', letter.current_level ?? 1)
      .maybeSingle()
    if (chainStep && (req as any).userRole !== chainStep.approver_role && (req as any).userRole !== 'super_admin') {
      return reply.status(403).send({
        error:   'FORBIDDEN',
        message: `Level ${letter.current_level ?? 1} of this approval chain requires role '${chainStep.approver_role}'`,
      })
    }

    // Fold the precondition into the UPDATE itself — without this, an
    // already-issued (delivered to the employee) letter could be flipped
    // to rejected after the fact, since the SELECT above is not atomic
    // with the UPDATE.
    const { data: updated } = await supabase
      .from('generated_letters')
      .update({ approval_status: 'rejected', rejection_reason: comments })
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .eq('approval_status', 'pending_approval')
      .select('id')
      .maybeSingle()

    if (!updated) {
      return reply.status(409).send({ error: 'CONFLICT', message: 'This letter was already actioned by another request' })
    }

    await supabase.from('letter_approval_log').insert({
      tenant_id: tenantId, letter_id: letterId,
      level: letter.current_level ?? 1, action: 'rejected',
      actor_id: actor?.id, comments,
    })

    await logAction(supabase, {
      tenantId,
      tableName:   'generated_letters',
      recordId:    letterId,
      action:      'UPDATE',
      performedBy: userId,
      newData:     { approval_status: 'rejected', rejection_reason: comments, rejected_level: letter?.current_level ?? 1 },
    })

    return { success: true }
  })

  // POST /letters/issued/:letterId/issue  (mark as issued — sends to employee)
  fastify.post('/letters/issued/:letterId/issue', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { letterId }         = req.params as any

    const { data: actor } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()

    const { data, error } = await supabase
      .from('generated_letters')
      .update({
        approval_status: 'issued',
        issued_at: new Date().toISOString(),
        issued_by: actor?.id ?? null,
      })
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .in('approval_status', ['approved', 'draft'])   // can issue approved or approval-exempt drafts
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to issue letter')
    if (!data) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Letter not found or not in an issuable state' })

    await logAction(supabase, {
      tenantId,
      tableName:   'generated_letters',
      recordId:    letterId,
      action:      'UPDATE',
      performedBy: userId,
      newData:     { approval_status: 'issued', issued_by: actor?.id ?? null },
    })

    return { success: true }
  })

  // DELETE /letters/issued/:letterId  (draft only)
  fastify.delete('/letters/issued/:letterId', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { letterId } = req.params as any

    const { data, error } = await supabase
      .from('generated_letters')
      .delete()
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .eq('approval_status', 'draft')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.DELETE_FAILED, 'Failed to delete letter')
    if (!data) return reply.code(409).send({ error: 'INVALID_STATE', message: 'Letter not found or not in draft state' })

    await logAction(supabase, {
      tenantId,
      tableName:   'generated_letters',
      recordId:    letterId,
      action:      'DELETE',
      performedBy: userId,
    })

    return { success: true }
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // ESS — EMPLOYEE SELF-SERVICE
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /letters/ess/templates  — templates the employee can request
  fastify.get('/letters/ess/templates', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { tenantId } = req as any

    const { data, error } = await supabase
      .from('letter_templates')
      .select('id, name, code, letter_type, requires_approval, approval_levels')
      .eq('tenant_id', tenantId)
      .eq('category', 'ess_requestable')
      .eq('is_active', true)
      .order('name')

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch requestable letter templates')
    return { data }
  })

  // GET /letters/ess/my-letters  — letters issued to the calling employee
  fastify.get('/letters/ess/my-letters', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { tenantId, userId } = req as any

    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()
    if (!emp) return reply.status(403).send({ error: 'Employee not found' })

    const { data, error } = await supabase
      .from('generated_letters')
      .select(`
        id, subject, approval_status, issued_at, created_at,
        template:letter_templates(name, letter_type)
      `)
      .eq('tenant_id', tenantId)
      .eq('employee_id', emp.id)
      .eq('approval_status', 'issued')
      .order('issued_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch your letters')
    return { data }
  })

  // GET /letters/ess/my-letters/:letterId  — full body for reading / download
  fastify.get('/letters/ess/my-letters/:letterId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { letterId }         = req.params as any

    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()
    if (!emp) return reply.status(403).send({ error: 'Employee not found' })

    const { data, error } = await supabase
      .from('generated_letters')
      .select('*, template:letter_templates(name, letter_type)')
      .eq('id', letterId)
      .eq('tenant_id', tenantId)
      .eq('employee_id', emp.id)
      .eq('approval_status', 'issued')
      .single()

    if (error || !data) return reply.status(404).send({ error: 'Letter not found' })
    return { data }
  })

  // POST /letters/ess/request
  fastify.post('/letters/ess/request', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { tenantId, userId } = req as any
    const parsed = essRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const { template_id, reason } = parsed.data

    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()
    if (!emp) return reply.status(403).send({ error: 'Employee not found' })

    // Verify template is ess_requestable
    const { data: tmpl } = await supabase
      .from('letter_templates')
      .select('id')
      .eq('id', template_id)
      .eq('tenant_id', tenantId)
      .eq('category', 'ess_requestable')
      .eq('is_active', true)
      .single()

    if (!tmpl) return reply.status(404).send({ error: 'Template not found or not requestable' })

    const { data, error } = await supabase
      .from('letter_requests')
      .insert({ tenant_id: tenantId, employee_id: emp.id, template_id, reason })
      .select()
      .single()

    if (error) return serverError(req, reply, error, ErrorCode.INSERT_FAILED, 'Failed to submit letter request')

    await logAction(supabase, {
      tenantId,
      tableName:   'letter_requests',
      recordId:    data.id,
      action:      'INSERT',
      performedBy: userId,
      onBehalfOf:  emp.id,
      newData:     { template_id, reason, status: 'pending' },
    })

    return reply.status(201).send({ data })
  })

  // GET /letters/ess/requests  — employee's own requests
  fastify.get('/letters/ess/requests', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { tenantId, userId } = req as any

    const { data: emp } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()
    if (!emp) return reply.status(403).send({ error: 'Employee not found' })

    const { data, error } = await supabase
      .from('letter_requests')
      .select(`
        id, reason, status, requested_at, processed_at, rejection_reason,
        template:letter_templates(name, letter_type)
      `)
      .eq('tenant_id', tenantId)
      .eq('employee_id', emp.id)
      .order('requested_at', { ascending: false })

    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch your letter requests')
    return { data }
  })

  // ══════════════════════════════════════════════════════════════════════════════
  // HR — ESS REQUEST MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /letters/requests  (HR view of all ESS requests)
  fastify.get('/letters/requests', hrAdminAuth, async (req, reply) => {
    const { tenantId } = req as any
    const { status, limit = '50', offset = '0' } = req.query as any

    let q = supabase
      .from('letter_requests')
      .select(`
        id, reason, status, requested_at, processed_at, rejection_reason,
        template:letter_templates(name, letter_type),
        employee:employees!employee_id(first_name, last_name, employee_code, designations(name),
          departments!department_id(name))
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('requested_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1)

    if (status) q = q.eq('status', status)

    const { data, count, error } = await q
    if (error) return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch letter requests')
    return { data: (data ?? []).map((r: any) => ({ ...r, employee: normEmp(r.employee) })), total: count }
  })

  // POST /letters/requests/:id/fulfill  — generate + issue letter for ESS request
  fastify.post('/letters/requests/:id/fulfill', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { id }               = req.params as any
    const parsed = fulfillSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const { extra_vars } = parsed.data

    const { data: request, error: requestErr } = await supabase
      .from('letter_requests')
      .select('*, template:letter_templates(*)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (requestErr) return serverError(req, reply, requestErr, ErrorCode.QUERY_FAILED, 'Failed to fetch letter request')
    if (!request) return reply.status(404).send({ error: 'Request not found' })
    if (request.status !== 'pending') return reply.status(400).send({ error: 'Request already processed' })

    // Atomically claim the request (pending → processing) before generating
    // anything — without this, two concurrent fulfill calls both pass the
    // read-check above and both insert a generated_letters row for the same
    // request before either update below lands, producing a duplicate
    // letter. The loser gets 409 before any letter is generated.
    const { data: claimed, error: claimErr } = await supabase
      .from('letter_requests')
      .update({ status: 'processing' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (claimErr) return serverError(req, reply, claimErr, ErrorCode.UPDATE_FAILED, 'Failed to claim letter request')
    if (!claimed) return reply.status(409).send({ error: 'Request was already actioned by another request' })

    const tmpl = request.template as any
    const empVars = await resolveEmployeeVars(supabase, tenantId, request.employee_id)
    const { body, subject, missing } = renderTemplate(
      tmpl.body_html, tmpl.subject_template, empVars, extra_vars,
    )

    const { data: processor } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()

    const { data: letter, error: letErr } = await supabase
      .from('generated_letters')
      .insert({
        tenant_id: tenantId,
        template_id: tmpl.id,
        employee_id: request.employee_id,
        subject, body_html: body,
        variable_values: { ...empVars, ...extra_vars },
        missing_vars: missing,
        approval_status: 'issued',
        current_level: 0,
        issued_at: new Date().toISOString(),
        issued_by: processor?.id ?? null,
        created_by: processor?.id ?? null,
      })
      .select()
      .single()

    if (letErr) {
      // Revert the claim so this request can be retried instead of being
      // permanently stuck 'processing' with no letter ever generated.
      await supabase.from('letter_requests')
        .update({ status: 'pending' })
        .eq('id', id).eq('tenant_id', tenantId).eq('status', 'processing')
      return serverError(req, reply, letErr, ErrorCode.INSERT_FAILED, 'Failed to generate letter for request')
    }

    const { error: fulfillErr } = await supabase
      .from('letter_requests')
      .update({
        status: 'fulfilled',
        processed_by: processor?.id ?? null,
        processed_at: new Date().toISOString(),
        generated_letter_id: letter.id,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (fulfillErr) return serverError(req, reply, fulfillErr, ErrorCode.UPDATE_FAILED, 'Letter generated but failed to mark request as fulfilled')

    await logAction(supabase, {
      tenantId,
      tableName:   'letter_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: userId,
      onBehalfOf:  request.employee_id,
      newData:     { status: 'fulfilled', generated_letter_id: letter.id },
    })

    return { data: letter, missing_vars: missing }
  })

  // POST /letters/requests/:id/reject
  fastify.post('/letters/requests/:id/reject', hrAdminAuth, async (req, reply) => {
    const { tenantId, userId } = req as any
    const { id }               = req.params as any
    const parsed = rejectSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
    }
    const { reason } = parsed.data

    const { data: processor } = await supabase
      .from('profiles').select('id:employee_id').eq('id', userId).eq('tenant_id', tenantId).single()

    // Fold the 'pending' precondition into the UPDATE's own WHERE clause —
    // previously unconditioned, so an already-fulfilled or already-rejected
    // request could be silently flipped to 'rejected' even after a letter
    // had already been issued for it.
    const { data: rejected, error } = await supabase
      .from('letter_requests')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        processed_by: processor?.id ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to reject letter request')
    if (!rejected) return reply.status(409).send({ error: 'Request was already actioned by another request' })

    await logAction(supabase, {
      tenantId,
      tableName:   'letter_requests',
      recordId:    id,
      action:      'UPDATE',
      performedBy: userId,
      newData:     { status: 'rejected', rejection_reason: reason },
    })

    return { success: true }
  })
}
