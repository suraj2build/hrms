import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { optStr, optEnum } from '../../lib/zod-form.js'

const schema = z.object({
  bank_name:      optStr,
  account_number: optStr,
  ifsc_code:      optStr,
  branch_name:    optStr,
  account_type:   optEnum(['savings','current','salary']),
  pan_number:     optStr,
  aadhaar_number: optStr,
  uan_number:     optStr,
  pf_number:      optStr,
  esi_number:     optStr,
  pt_applicable:  z.boolean().optional().default(false),
  lwf_applicable: z.boolean().optional().default(false),
  tax_regime:     z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(['old','new']).optional().default('new')),
})

async function verifyEmployee(fastify: any, employeeId: string, tenantId: string) {
  const { data } = await fastify.supabase
    .from('employees')
    .select('id')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .single()
  return !!data
}

export default async function bankStatutoryRoutes(fastify: FastifyInstance) {
  // Bank account, PAN, Aadhaar, UAN, PF/ESI are highly sensitive PII/financial data.
  // Only HR admins may read or write these records.
  const hrAdminAuth = { preHandler: [fastify.authenticate, requireRole(...HR_ADMIN_ROLES)] }

  // GET /employees/:id/bank-statutory
  fastify.get('/employees/:id/bank-statutory', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const { data, error } = await fastify.supabase
      .from('employee_bank_statutory')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error && error.code !== 'PGRST116')
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data: data ?? null })
  })

  // PUT /employees/:id/bank-statutory  (upsert)
  fastify.put('/employees/:id/bank-statutory', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })
    const { data, error } = await fastify.supabase
      .from('employee_bank_statutory')
      .upsert(
        { ...parsed.data, employee_id: req.params.id, tenant_id: req.tenantId },
        { onConflict: 'tenant_id,employee_id' }
      )
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })
}
