import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'

// clearable*: a field the user can blank out to CLEAR it. '' or null → null so
// the upsert writes null (erases the value). A field simply OMITTED from the
// body stays untouched (Zod drops absent optional keys). This is what lets the
// Bank form clear PAN/IFSC/etc. instead of silently keeping the old value.
const clearableStr = z.preprocess((v) => (v === '' || v === null ? null : v), z.string().nullable().optional())
const clearableEnum = <T extends [string, ...string[]]>(vals: T) =>
  z.preprocess((v) => (v === '' || v === null ? null : v), z.enum(vals).nullable().optional())

const schema = z.object({
  bank_name:      clearableStr,
  account_number: clearableStr,
  ifsc_code:      clearableStr,
  branch_name:    clearableStr,
  account_type:   clearableEnum(['savings','current','salary']),
  pan_number:     clearableStr,
  aadhaar_number: clearableStr,
  uan_number:     clearableStr,
  pf_number:      clearableStr,
  esi_number:     clearableStr,
  pt_applicable:  z.boolean().optional(),
  lwf_applicable: z.boolean().optional(),
  tax_regime:     z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(['old','new']).optional()),
  // PT state code — stored in ptax_state_config (not employee_bank_statutory)
  pt_state_code:  clearableStr,
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
    // Merge PT state (ptax_state_config latest row) so the employee profile can
    // show and edit the assigned PT state alongside bank/statutory details.
    const { data: ptRow } = await fastify.supabase
      .from('ptax_state_config')
      .select('state_code')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    return reply.send({ data: { ...(data ?? {}), pt_state_code: (ptRow as any)?.state_code ?? null } })
  })

  // PUT /employees/:id/bank-statutory  (upsert)
  fastify.put('/employees/:id/bank-statutory', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return reply.code(400).send({ error: 'VALIDATION', message: parsed.error.issues[0].message })

    // Extract PT state code — it goes to ptax_state_config, not employee_bank_statutory.
    const ptStateCode = parsed.data.pt_state_code
    const bankPayload = { ...parsed.data }
    delete (bankPayload as any).pt_state_code

    // Write PT state to ptax_state_config (idempotent: delete open rows then insert).
    if (ptStateCode !== undefined) {
      await fastify.supabase
        .from('ptax_state_config')
        .delete()
        .eq('employee_id', req.params.id)
        .eq('tenant_id', req.tenantId)
        .is('effective_to', null)
      if (ptStateCode) {
        await fastify.supabase
          .from('ptax_state_config')
          .insert({
            employee_id:     req.params.id,
            tenant_id:       req.tenantId,
            state_code:      ptStateCode,
            effective_from:  new Date().toISOString().slice(0, 10),
            override_reason: 'Set from employee master',
          })
      }
    }

    const { data, error } = await fastify.supabase
      .from('employee_bank_statutory')
      .upsert(
        { ...bankPayload, employee_id: req.params.id, tenant_id: req.tenantId },
        { onConflict: 'tenant_id,employee_id' }
      )
      .select()
      .single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send(data)
  })
}
