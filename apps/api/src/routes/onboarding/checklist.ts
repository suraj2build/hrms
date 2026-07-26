/**
 * Onboarding Checklist Routes
 *
 * GET    /onboarding/templates                              — list all templates for tenant
 * POST   /onboarding/templates                              — create template (hr_admin/super_admin)
 * POST   /onboarding/templates/:id/items                    — add item to template
 * DELETE /onboarding/templates/:id/items/:itemId            — remove item from template
 *
 * GET    /onboarding/employees/:employeeId/checklist        — get employee checklist with tasks
 * POST   /onboarding/employees/:employeeId/checklist        — create checklist for employee
 * PATCH  /onboarding/employees/:employeeId/tasks/:taskId    — update task status
 *
 * Frontend-compatible alias routes:
 * GET    /onboarding/checklists                             — list all employee checklists (HR)
 * POST   /onboarding/checklists                             — assign checklist {employee_id, template_id}
 * GET    /onboarding/checklists/:checklistId/tasks          — tasks for a checklist
 * PATCH  /onboarding/tasks/:taskId                          — update task by id
 * DELETE /onboarding/template-items/:itemId                 — delete template item by id
 *
 * Auth: all routes require JWT.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { emitOnboardingChecklistCompleted } from '../../lib/onboarding-orchestrator.js'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'

/**
 * Self-or-HR access check. An employee may access their own checklist/tasks.
 * `req.userId` is the auth user id; `req.employeeId` is the linked employee record.
 * The checklist's `employee_id` is an employee-record id, so we match on
 * `req.employeeId` (with `req.userId` kept as a fallback for legacy linkage).
 */
function canAccessEmployee(req: any, employeeId: string): boolean {
  return HR_ADMIN_ROLES.includes(req.userRole)
    || req.employeeId === employeeId
    || req.userId === employeeId
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  is_active: z.boolean().default(true),
})

// onboarding_checklist_items.category / .assigned_to_role CHECK constraints
// (migration 206) — the ground truth for valid values. Also mirrored on
// employee_onboarding_tasks, but that table is only ever populated by
// copying an already-validated template item's values (see below), never
// from fresh user input.
const CHECKLIST_ITEM_CATEGORIES = ['it_setup', 'document_collection', 'access_provisioning', 'induction', 'compliance', 'other'] as const
const CHECKLIST_ITEM_ROLES = ['hr', 'it', 'manager', 'admin', 'employee'] as const

/** due_date = start_date + due_day_offset days (null if either input is missing). */
function computeTaskDueDate(startDate: string | null, dueDayOffset: number | null): string | null {
  if (!startDate || dueDayOffset == null) return null
  const d = new Date(startDate)
  d.setDate(d.getDate() + dueDayOffset)
  return d.toISOString().substring(0, 10)
}

const addTemplateItemSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  is_mandatory: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
  category: z.enum(CHECKLIST_ITEM_CATEGORIES).optional(),
  assigned_to_role: z.enum(CHECKLIST_ITEM_ROLES).optional(),
})

const createChecklistSchema = z.object({
  template_id: z.string().uuid().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const updateTaskStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'skipped']),
  notes: z.string().max(2000).optional(),
})

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function onboardingChecklistRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /templates ──────────────────────────────────────────────────────────
  fastify.get('/templates', auth, async (req: any, reply) => {
    const tenantId: string = req.tenantId

    const { data, error } = await fastify.supabase
      .from('onboarding_checklist_templates')
      .select(`
        id,
        name,
        description,
        is_active,
        created_at,
        onboarding_checklist_items (
          id,
          title,
          description,
          is_mandatory,
          sort_order,
          category,
          assigned_to_role,
          due_day_offset,
          created_at
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      // A missing onboarding_checklist_items relationship / column on a drifted
      // DB must not 500 the whole onboarding tab — fall back to templates only.
      fastify.log.warn({ error }, 'onboarding templates embed failed — serving templates without items')
      const { data: flat, error: flatErr } = await fastify.supabase
        .from('onboarding_checklist_templates')
        .select('id, name, description, is_active, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (flatErr) return reply.code(500).send({ error: 'DB_ERROR', message: flatErr.message })
      return reply.send({ data: (flat ?? []).map((t: any) => ({ ...t, onboarding_checklist_items: [] })) })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /templates ─────────────────────────────────────────────────────────
  fastify.post('/templates', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const parsed = createTemplateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid input',
      })
    }

    const tenantId: string = req.tenantId
    const userId: string = req.userId

    const { data, error } = await fastify.supabase
      .from('onboarding_checklist_templates')
      .insert({
        tenant_id: tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        is_active: parsed.data.is_active,
      })
      .select('id, name, description, is_active, created_at')
      .single()

    if (error) {
      fastify.log.error({ error }, 'Failed to create onboarding template')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── POST /templates/:id/items ───────────────────────────────────────────────
  // ── GET /templates/:id/items — list a template's checklist items ──────────────
  fastify.get('/templates/:id/items', auth, async (req: any, reply) => {
    const templateId: string = (req.params as any).id
    const { data, error } = await fastify.supabase
      .from('onboarding_checklist_items')
      .select('id, title, description, is_mandatory, sort_order, category, assigned_to_role, due_day_offset, created_at')
      .eq('tenant_id', req.tenantId)
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true })
    if (error) return reply.code(500).send({ error: 'QUERY_FAILED', message: error.message })
    return reply.send({ data: data ?? [] })
  })

  fastify.post('/templates/:id/items', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const templateId: string = (req.params as any).id
    const tenantId: string = req.tenantId

    // Verify template belongs to tenant
    const { data: template, error: tmplError } = await fastify.supabase
      .from('onboarding_checklist_templates')
      .select('id')
      .eq('id', templateId)
      .eq('tenant_id', tenantId)
      .single()

    if (tmplError || !template) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Template not found' })
    }

    const parsed = addTemplateItemSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid input',
      })
    }

    const { data, error } = await fastify.supabase
      .from('onboarding_checklist_items')
      .insert({
        template_id: templateId,
        tenant_id: tenantId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        is_mandatory: parsed.data.is_mandatory,
        sort_order: parsed.data.sort_order,
        category: parsed.data.category ?? null,
        assigned_to_role: parsed.data.assigned_to_role ?? null,
      })
      .select('id, title, description, is_mandatory, sort_order, category, assigned_to_role, created_at')
      .single()

    if (error) {
      fastify.log.error({ error }, 'Failed to add template item')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.code(201).send({ data })
  })

  // ── DELETE /templates/:id/items/:itemId ─────────────────────────────────────
  fastify.delete('/templates/:id/items/:itemId', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const templateId: string = (req.params as any).id
    const itemId: string = (req.params as any).itemId
    const tenantId: string = req.tenantId

    // Verify template belongs to tenant
    const { data: template, error: tmplError } = await fastify.supabase
      .from('onboarding_checklist_templates')
      .select('id')
      .eq('id', templateId)
      .eq('tenant_id', tenantId)
      .single()

    if (tmplError || !template) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Template not found' })
    }

    const { error } = await fastify.supabase
      .from('onboarding_checklist_items')
      .delete()
      .eq('id', itemId)
      .eq('template_id', templateId)
      .eq('tenant_id', tenantId)

    if (error) {
      fastify.log.error({ error }, 'Failed to delete template item')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.code(204).send()
  })

  // ── GET /employees/:employeeId/checklist ────────────────────────────────────
  fastify.get('/employees/:employeeId/checklist', auth, async (req: any, reply) => {
    const employeeId: string = (req.params as any).employeeId
    const tenantId: string = req.tenantId

    // HR admins can view any; employees can view their own
    if (!canAccessEmployee(req, employeeId)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_onboarding_checklists')
      .select(`
        id,
        employee_id,
        template_id,
        status,
        start_date,
        target_completion_date,
        completed_at,
        created_at,
        employee_onboarding_tasks (
          id,
          title,
          description,
          is_mandatory,
          sort_order,
          category,
          assigned_to_role,
          status,
          notes,
          completed_at,
          created_at
        )
      `)
      .eq('employee_id', employeeId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      fastify.log.error({ error }, 'Failed to fetch employee checklist')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /employees/:employeeId/checklist ───────────────────────────────────
  fastify.post('/employees/:employeeId/checklist', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const employeeId: string = (req.params as any).employeeId
    const tenantId: string = req.tenantId
    const userId: string = req.userId

    const parsed = createChecklistSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid input',
      })
    }

    const { template_id, start_date } = parsed.data

    // Fresh audit finding (cross-tenant IDOR): employeeId came straight from
    // the URL with no tenant check, then got echoed back unfiltered via
    // GET /onboarding/checklists' employees:employee_id join — leaking a
    // foreign tenant's employee identity. The alias route POST /checklists
    // already carries this exact fix; apply it here too.
    const { data: checklistEmp } = await fastify.supabase
      .from('employees').select('id').eq('id', employeeId).eq('tenant_id', tenantId).maybeSingle()
    if (!checklistEmp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found in your organisation' })
    }

    // Compute target_completion_date = start_date + 30 days
    let targetCompletionDate: string | null = null
    if (start_date) {
      const d = new Date(start_date)
      d.setDate(d.getDate() + 30)
      targetCompletionDate = d.toISOString().substring(0, 10)
    }

    // If template_id provided, verify it belongs to tenant
    let templateItems: Array<{
      title: string
      description: string | null
      is_mandatory: boolean
      sort_order: number
      category: string | null
      assigned_to_role: string | null
      due_day_offset: number | null
    }> = []

    if (template_id) {
      const { data: tmpl, error: tmplError } = await fastify.supabase
        .from('onboarding_checklist_templates')
        .select('id')
        .eq('id', template_id)
        .eq('tenant_id', tenantId)
        .single()

      if (tmplError || !tmpl) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Template not found' })
      }

      const { data: items, error: itemsError } = await fastify.supabase
        .from('onboarding_checklist_items')
        .select('title, description, is_mandatory, sort_order, category, assigned_to_role, due_day_offset')
        .eq('template_id', template_id)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      if (itemsError) {
        fastify.log.error({ error: itemsError }, 'Failed to fetch template items')
        return reply.code(500).send({ error: 'DB_ERROR', message: itemsError.message })
      }

      templateItems = (items ?? []).map((item) => ({
        title: item.title,
        description: item.description ?? null,
        is_mandatory: item.is_mandatory,
        sort_order: item.sort_order,
        category: item.category ?? null,
        assigned_to_role: item.assigned_to_role ?? null,
        due_day_offset: item.due_day_offset ?? null,
      }))
    }

    // Create checklist
    const { data: checklist, error: checklistError } = await fastify.supabase
      .from('employee_onboarding_checklists')
      .insert({
        tenant_id: tenantId,
        employee_id: employeeId,
        template_id: template_id ?? null,
        status: 'not_started',
        start_date: start_date ?? null,
        target_completion_date: targetCompletionDate,
      })
      .select('id, employee_id, template_id, status, start_date, target_completion_date, created_at')
      .single()

    if (checklistError || !checklist) {
      fastify.log.error({ error: checklistError }, 'Failed to create checklist')
      return reply.code(500).send({ error: 'DB_ERROR', message: checklistError?.message ?? 'Insert failed' })
    }

    // Copy template items as tasks if any
    let tasks: unknown[] = []
    if (templateItems.length > 0) {
      const taskInserts = templateItems.map((item) => ({
        tenant_id: tenantId,
        checklist_id: checklist.id,
        title: item.title,
        description: item.description,
        is_mandatory: item.is_mandatory,
        sort_order: item.sort_order,
        category: item.category,
        assigned_to_role: item.assigned_to_role,
        due_date: computeTaskDueDate(start_date ?? null, item.due_day_offset),
        status: 'pending' as const,
        notes: null,
        completed_at: null,
      }))

      const { data: insertedTasks, error: tasksError } = await fastify.supabase
        .from('employee_onboarding_tasks')
        .insert(taskInserts)
        .select('id, title, is_mandatory, sort_order, status, due_date, created_at')

      if (tasksError) {
        fastify.log.error({ error: tasksError }, 'Failed to insert checklist tasks')
        return reply.code(500).send({ error: 'DB_ERROR', message: tasksError.message })
      }

      tasks = insertedTasks ?? []
    }

    return reply.code(201).send({
      data: {
        ...checklist,
        tasks,
      },
    })
  })

  // ── PATCH /employees/:employeeId/tasks/:taskId ──────────────────────────────
  fastify.patch('/employees/:employeeId/tasks/:taskId', auth, async (req: any, reply) => {
    const employeeId: string = (req.params as any).employeeId
    const taskId: string = (req.params as any).taskId
    const tenantId: string = req.tenantId

    // HR admins or the employee themselves can update tasks
    if (!canAccessEmployee(req, employeeId)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const parsed = updateTaskStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid input',
      })
    }

    const { status, notes } = parsed.data
    const completedAt = status === 'completed' ? new Date().toISOString() : null

    // Fetch the task and verify it belongs to an employee checklist in this tenant
    const { data: task, error: taskFetchError } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .select(`
        id,
        checklist_id,
        is_mandatory,
        employee_onboarding_checklists!inner (
          id,
          employee_id,
          status,
          tenant_id
        )
      `)
      .eq('id', taskId)
      .eq('tenant_id', tenantId)
      .single()

    if (taskFetchError || !task) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' })
    }

    const checklist = (task as any).employee_onboarding_checklists
    if (checklist.employee_id !== employeeId || checklist.tenant_id !== tenantId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Task does not belong to this employee' })
    }

    // Update the task
    const { data: updatedTask, error: updateError } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .update({
        status,
        notes: notes ?? null,
        completed_at: completedAt,
      })
      .eq('id', taskId)
      .eq('tenant_id', tenantId)
      .select('id, title, is_mandatory, status, notes, completed_at')
      .single()

    if (updateError || !updatedTask) {
      fastify.log.error({ error: updateError }, 'Failed to update task status')
      return reply.code(500).send({ error: 'DB_ERROR', message: updateError?.message ?? 'Update failed' })
    }

    // Auto-complete checklist if all mandatory tasks are completed
    const checklistId: string = task.checklist_id
    const { data: allTasks, error: allTasksError } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .select('id, is_mandatory, status')
      .eq('checklist_id', checklistId)
      .eq('tenant_id', tenantId)

    if (!allTasksError && allTasks && allTasks.length > 0) {
      const mandatoryTasks = allTasks.filter((t) => t.is_mandatory)
      const allMandatoryDone =
        mandatoryTasks.length > 0 &&
        mandatoryTasks.every((t) => t.status === 'completed' || t.status === 'skipped')

      if (allMandatoryDone && checklist.status !== 'completed') {
        await fastify.supabase
          .from('employee_onboarding_checklists')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', checklistId)
          .eq('tenant_id', tenantId)

        emitOnboardingChecklistCompleted({
          tenantId,
          employeeId,
          checklistId,
          correlationId: (req as any).correlationId,
        })
      }
    }

    return reply.send({ data: updatedTask })
  })

  // ── Frontend-compatible alias routes ─────────────────────────────────────────

  // ── GET /checklists ─── list all employee checklists for tenant (with counts) ─
  fastify.get('/checklists', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const tenantId: string = req.tenantId

    const { data, error } = await fastify.supabase
      .from('employee_onboarding_checklists')
      .select(`
        id,
        employee_id,
        template_id,
        status,
        start_date,
        target_completion_date,
        completed_at,
        created_at,
        employees:employee_id (
          id,
          first_name,
          last_name,
          employee_code,
          joining_date,
          departments ( name )
        ),
        template:template_id (
          id,
          name
        ),
        employee_onboarding_tasks ( id, status )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      fastify.log.error({ error }, 'Failed to list onboarding checklists')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    const rows = (data ?? []).map((cl: any) => {
      const tasks: Array<{ id: string; status: string }> = cl.employee_onboarding_tasks ?? []
      const totalTasks = tasks.length
      const completedTasks = tasks.filter((t) => t.status === 'completed').length
      return {
        id: cl.id,
        employee_id: cl.employee_id,
        template_id: cl.template_id,
        status: cl.status,
        start_date: cl.start_date,
        target_completion_date: cl.target_completion_date,
        completed_at: cl.completed_at,
        created_at: cl.created_at,
        employee: cl.employees
          ? {
              id: cl.employees.id,
              full_name: `${cl.employees.first_name} ${cl.employees.last_name}`.trim(),
              employee_code: cl.employees.employee_code,
              joining_date: cl.employees.joining_date ?? null,
              departments: cl.employees.departments ?? null,
            }
          : null,
        template: cl.template
          ? { id: cl.template.id, name: cl.template.name }
          : null,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
      }
    })

    return reply.send({ data: rows })
  })

  // ── GET /checklists/:checklistId/tasks ─── tasks for a checklist ──────────────
  fastify.get('/checklists/:checklistId/tasks', auth, async (req: any, reply) => {
    const checklistId: string = (req.params as any).checklistId
    const tenantId: string = req.tenantId

    // Verify checklist belongs to tenant (and access)
    const { data: checklist, error: clError } = await fastify.supabase
      .from('employee_onboarding_checklists')
      .select('id, employee_id')
      .eq('id', checklistId)
      .eq('tenant_id', tenantId)
      .single()

    if (clError || !checklist) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Checklist not found' })
    }

    if (!canAccessEmployee(req, checklist.employee_id)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const { data, error } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .select(`
        id,
        title,
        description,
        is_mandatory,
        sort_order,
        category,
        assigned_to_role,
        status,
        notes,
        completed_at,
        created_at
      `)
      .eq('checklist_id', checklistId)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })

    if (error) {
      fastify.log.error({ error }, 'Failed to fetch checklist tasks')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── PATCH /tasks/:taskId ─── update task by id (tenant-scoped) ────────────────
  fastify.patch('/tasks/:taskId', auth, async (req: any, reply) => {
    const taskId: string = (req.params as any).taskId
    const tenantId: string = req.tenantId

    const parsed = updateTaskStatusSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid input',
      })
    }

    const { status, notes } = parsed.data
    const completedAt = status === 'completed' ? new Date().toISOString() : null

    // Fetch the task and its parent checklist (tenant-scoped)
    const { data: task, error: taskFetchError } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .select(`
        id,
        checklist_id,
        is_mandatory,
        employee_onboarding_checklists!inner (
          id,
          employee_id,
          status,
          tenant_id
        )
      `)
      .eq('id', taskId)
      .eq('tenant_id', tenantId)
      .single()

    if (taskFetchError || !task) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Task not found' })
    }

    const checklist = (task as any).employee_onboarding_checklists

    // HR admins or the owning employee can update
    if (!canAccessEmployee(req, checklist.employee_id)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    // Update the task
    const { data: updatedTask, error: updateError } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .update({
        status,
        notes: notes ?? null,
        completed_at: completedAt,
      })
      .eq('id', taskId)
      .eq('tenant_id', tenantId)
      .select('id, title, is_mandatory, status, notes, completed_at')
      .single()

    if (updateError || !updatedTask) {
      fastify.log.error({ error: updateError }, 'Failed to update task status')
      return reply.code(500).send({ error: 'DB_ERROR', message: updateError?.message ?? 'Update failed' })
    }

    // Auto-complete checklist if all mandatory tasks are completed
    const checklistId: string = task.checklist_id
    const { data: allTasks, error: allTasksError } = await fastify.supabase
      .from('employee_onboarding_tasks')
      .select('id, is_mandatory, status')
      .eq('checklist_id', checklistId)
      .eq('tenant_id', tenantId)

    if (!allTasksError && allTasks && allTasks.length > 0) {
      const mandatoryTasks = allTasks.filter((t) => t.is_mandatory)
      const allMandatoryDone =
        mandatoryTasks.length > 0 &&
        mandatoryTasks.every((t) => t.status === 'completed' || t.status === 'skipped')

      if (allMandatoryDone && checklist.status !== 'completed') {
        await fastify.supabase
          .from('employee_onboarding_checklists')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', checklistId)
          .eq('tenant_id', tenantId)

        emitOnboardingChecklistCompleted({
          tenantId,
          employeeId:    checklist.employee_id,
          checklistId,
          correlationId: (req as any).correlationId,
        })
      }
    }

    return reply.send({ data: updatedTask })
  })

  // ── DELETE /template-items/:itemId ─── delete item by id (tenant-scoped) ──────
  fastify.delete('/template-items/:itemId', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const itemId: string = (req.params as any).itemId
    const tenantId: string = req.tenantId

    const { error } = await fastify.supabase
      .from('onboarding_checklist_items')
      .delete()
      .eq('id', itemId)
      .eq('tenant_id', tenantId)

    if (error) {
      fastify.log.error({ error }, 'Failed to delete template item')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.code(204).send()
  })

  // ── POST /checklists ─── assign checklist (body {employee_id, template_id}) ───
  fastify.post('/checklists', auth, async (req: any, reply) => {
    if (!HR_ADMIN_ROLES.includes(req.userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
    }

    const tenantId: string = req.tenantId
    const userId: string = req.userId

    const aliasSchema = z.object({
      employee_id: z.string().uuid(),
      template_id: z.string().uuid().optional(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })

    const parsed = aliasSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid input',
      })
    }

    const { employee_id, template_id, start_date } = parsed.data

    // Fresh audit finding (cross-tenant IDOR): employee_id was inserted with
    // no tenant check, then echoed back unfiltered via GET /checklists'
    // employees:employee_id join — leaking a foreign tenant's employee
    // identity to any HR admin who created or views a checklist.
    const { data: checklistEmp } = await fastify.supabase
      .from('employees').select('id').eq('id', employee_id).eq('tenant_id', tenantId).maybeSingle()
    if (!checklistEmp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found in your organisation' })
    }

    // Compute target_completion_date = start_date + 30 days
    let targetCompletionDate: string | null = null
    if (start_date) {
      const d = new Date(start_date)
      d.setDate(d.getDate() + 30)
      targetCompletionDate = d.toISOString().substring(0, 10)
    }

    // If template_id provided, verify it belongs to tenant and collect items
    let templateItems: Array<{
      title: string
      description: string | null
      is_mandatory: boolean
      sort_order: number
      category: string | null
      assigned_to_role: string | null
      due_day_offset: number | null
    }> = []

    if (template_id) {
      const { data: tmpl, error: tmplError } = await fastify.supabase
        .from('onboarding_checklist_templates')
        .select('id')
        .eq('id', template_id)
        .eq('tenant_id', tenantId)
        .single()

      if (tmplError || !tmpl) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Template not found' })
      }

      const { data: items, error: itemsError } = await fastify.supabase
        .from('onboarding_checklist_items')
        .select('title, description, is_mandatory, sort_order, category, assigned_to_role, due_day_offset')
        .eq('template_id', template_id)
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true })

      if (itemsError) {
        fastify.log.error({ error: itemsError }, 'Failed to fetch template items')
        return reply.code(500).send({ error: 'DB_ERROR', message: itemsError.message })
      }

      templateItems = (items ?? []).map((item) => ({
        title: item.title,
        description: item.description ?? null,
        is_mandatory: item.is_mandatory,
        sort_order: item.sort_order,
        category: item.category ?? null,
        assigned_to_role: item.assigned_to_role ?? null,
        due_day_offset: item.due_day_offset ?? null,
      }))
    }

    // Create checklist
    const { data: checklist, error: checklistError } = await fastify.supabase
      .from('employee_onboarding_checklists')
      .insert({
        tenant_id: tenantId,
        employee_id,
        template_id: template_id ?? null,
        status: 'not_started',
        start_date: start_date ?? null,
        target_completion_date: targetCompletionDate,
      })
      .select('id, employee_id, template_id, status, start_date, target_completion_date, created_at')
      .single()

    if (checklistError || !checklist) {
      fastify.log.error({ error: checklistError }, 'Failed to create checklist')
      return reply.code(500).send({ error: 'DB_ERROR', message: checklistError?.message ?? 'Insert failed' })
    }

    // Copy template items as tasks if any
    let tasks: unknown[] = []
    if (templateItems.length > 0) {
      const taskInserts = templateItems.map((item) => ({
        tenant_id: tenantId,
        checklist_id: checklist.id,
        title: item.title,
        description: item.description,
        is_mandatory: item.is_mandatory,
        sort_order: item.sort_order,
        category: item.category,
        assigned_to_role: item.assigned_to_role,
        due_date: computeTaskDueDate(start_date ?? null, item.due_day_offset),
        status: 'pending' as const,
        notes: null,
        completed_at: null,
      }))

      const { data: insertedTasks, error: tasksError } = await fastify.supabase
        .from('employee_onboarding_tasks')
        .insert(taskInserts)
        .select('id, title, is_mandatory, sort_order, status, due_date, created_at')

      if (tasksError) {
        fastify.log.error({ error: tasksError }, 'Failed to insert checklist tasks')
        return reply.code(500).send({ error: 'DB_ERROR', message: tasksError.message })
      }

      tasks = insertedTasks ?? []
    }

    return reply.code(201).send({ data: { ...checklist, tasks } })
  })
}
