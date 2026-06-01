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
 * Auth: all routes require JWT.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const HR_ROLES = ['super_admin', 'hr_admin']

// ── Zod schemas ───────────────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  is_active: z.boolean().default(true),
})

const addTemplateItemSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  is_mandatory: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
  category: z.string().max(100).optional(),
  assigned_to_role: z.string().max(100).optional(),
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
        updated_at,
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
      fastify.log.error({ error }, 'Failed to fetch onboarding templates')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }

    return reply.send({ data: data ?? [] })
  })

  // ── POST /templates ─────────────────────────────────────────────────────────
  fastify.post('/templates', auth, async (req: any, reply) => {
    if (!HR_ROLES.includes(req.userRole)) {
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
        created_by: userId,
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
  fastify.post('/templates/:id/items', auth, async (req: any, reply) => {
    if (!HR_ROLES.includes(req.userRole)) {
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
      .from('onboarding_checklist_template_items')
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
    if (!HR_ROLES.includes(req.userRole)) {
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
      .from('onboarding_checklist_template_items')
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
    if (!HR_ROLES.includes(req.userRole) && req.userId !== employeeId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Access denied' })
    }

    const { data, error } = await fastify.supabase
      .from('onboarding_checklists')
      .select(`
        id,
        employee_id,
        template_id,
        status,
        start_date,
        target_completion_date,
        completed_at,
        created_at,
        updated_at,
        onboarding_checklist_tasks (
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
          created_at,
          updated_at
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
    if (!HR_ROLES.includes(req.userRole)) {
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
        .from('onboarding_checklist_template_items')
        .select('title, description, is_mandatory, sort_order, category, assigned_to_role')
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
      }))
    }

    // Create checklist
    const { data: checklist, error: checklistError } = await fastify.supabase
      .from('onboarding_checklists')
      .insert({
        tenant_id: tenantId,
        employee_id: employeeId,
        template_id: template_id ?? null,
        status: 'pending',
        start_date: start_date ?? null,
        target_completion_date: targetCompletionDate,
        created_by: userId,
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
        status: 'pending' as const,
        notes: null,
        completed_at: null,
      }))

      const { data: insertedTasks, error: tasksError } = await fastify.supabase
        .from('onboarding_checklist_tasks')
        .insert(taskInserts)
        .select('id, title, is_mandatory, sort_order, status, created_at')

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
    if (!HR_ROLES.includes(req.userRole) && req.userId !== employeeId) {
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
      .from('onboarding_checklist_tasks')
      .select(`
        id,
        checklist_id,
        is_mandatory,
        onboarding_checklists!inner (
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

    const checklist = (task as any).onboarding_checklists
    if (checklist.employee_id !== employeeId || checklist.tenant_id !== tenantId) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Task does not belong to this employee' })
    }

    // Update the task
    const { data: updatedTask, error: updateError } = await fastify.supabase
      .from('onboarding_checklist_tasks')
      .update({
        status,
        notes: notes ?? null,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .eq('tenant_id', tenantId)
      .select('id, title, is_mandatory, status, notes, completed_at, updated_at')
      .single()

    if (updateError || !updatedTask) {
      fastify.log.error({ error: updateError }, 'Failed to update task status')
      return reply.code(500).send({ error: 'DB_ERROR', message: updateError?.message ?? 'Update failed' })
    }

    // Auto-complete checklist if all mandatory tasks are completed
    const checklistId: string = task.checklist_id
    const { data: allTasks, error: allTasksError } = await fastify.supabase
      .from('onboarding_checklist_tasks')
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
          .from('onboarding_checklists')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', checklistId)
          .eq('tenant_id', tenantId)
      }
    }

    return reply.send({ data: updatedTask })
  })
}
