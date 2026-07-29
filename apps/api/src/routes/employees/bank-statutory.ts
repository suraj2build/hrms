import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole, HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, notFound, validationError, ErrorCode } from '../../lib/api-errors.js'
import { fetchTenantTz } from '../../lib/attendance-engine.js'
import { getLocalDate } from '../../lib/org-context.js'

// Resolve "today" in the tenant's own timezone, not the server's (UTC) clock —
// mirrors the same fix applied to tds.ts / it-statement.ts / org-context.ts.
async function tenantTodayStr(fastify: any, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(fastify.supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

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
  // LWF state code — stored in lwf_state_config (not employee_bank_statutory)
  lwf_state_code: clearableStr,
  // Direct holiday group tag — stored on employees.holiday_group_id
  holiday_group_id: clearableStr,
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
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    const { data, error } = await fastify.supabase
      .from('employee_bank_statutory')
      .select('*')
      .eq('employee_id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single()
    if (error && error.code !== 'PGRST116')
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch bank and statutory information')
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
    const { data: lwfRow } = await fastify.supabase
      .from('lwf_state_config').select('state_code')
      .eq('employee_id', req.params.id).eq('tenant_id', req.tenantId)
      .order('effective_from', { ascending: false }).limit(1).maybeSingle()
    const { data: empRow } = await fastify.supabase
      .from('employees')
      .select('holiday_group_id, site_id')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .maybeSingle()
    // Fetch the site's state_code so the UI can show "Auto from site (KA)"
    let siteStateCode: string | null = null
    if ((empRow as any)?.site_id) {
      const { data: siteRow } = await fastify.supabase
        .from('sites').select('state_code')
        .eq('id', (empRow as any).site_id)
        .eq('tenant_id', req.tenantId)
        .maybeSingle()
      siteStateCode = (siteRow as any)?.state_code ?? null
    }
    return reply.send({ data: {
      ...(data ?? {}),
      pt_state_code:    (ptRow   as any)?.state_code       ?? null,
      lwf_state_code:   (lwfRow  as any)?.state_code       ?? null,
      holiday_group_id: (empRow  as any)?.holiday_group_id ?? null,
      site_state_code:  siteStateCode,
    } })
  })

  // PUT /employees/:id/bank-statutory  (upsert)
  fastify.put('/employees/:id/bank-statutory', hrAdminAuth, async (req: any, reply) => {
    if (!await verifyEmployee(fastify, req.params.id, req.tenantId))
      return notFound(reply, 'EMPLOYEE_NOT_FOUND', 'Employee not found')
    const parsed = schema.partial().safeParse(req.body)
    if (!parsed.success)
      return validationError(reply, ErrorCode.VALIDATION_ERROR, parsed.error.issues[0].message)

    // Extract state codes — go to their own tables, not employee_bank_statutory.
    const ptStateCode  = parsed.data.pt_state_code
    const lwfStateCode = parsed.data.lwf_state_code
    const bankPayload  = { ...parsed.data }
    delete (bankPayload as any).pt_state_code
    delete (bankPayload as any).lwf_state_code
    const today = await tenantTodayStr(fastify, req.tenantId)

    // Write PT state to ptax_state_config (idempotent).
    if (ptStateCode !== undefined) {
      const { error: ptDelErr } = await fastify.supabase.from('ptax_state_config').delete()
        .eq('employee_id', req.params.id).eq('tenant_id', req.tenantId).is('effective_to', null)
      if (ptDelErr) return serverError(req, reply, ptDelErr, ErrorCode.DELETE_FAILED, 'Failed to clear prior PT state config')
      if (ptStateCode) {
        const { error: ptInsErr } = await fastify.supabase.from('ptax_state_config').insert({
          employee_id: req.params.id, tenant_id: req.tenantId,
          state_code: ptStateCode, effective_from: today, override_reason: 'Set from employee master',
        })
        // Delete already succeeded — if the insert fails now, the employee has
        // zero active PT state config and the payroll statutory engine will
        // silently skip PT deduction. Surface this rather than reporting success.
        if (ptInsErr) return serverError(req, reply, ptInsErr, ErrorCode.INSERT_FAILED, 'State transfer incomplete: failed to set new PT state config')
      }
    }

    // Write LWF state to lwf_state_config (idempotent).
    if (lwfStateCode !== undefined) {
      const { error: lwfDelErr } = await fastify.supabase.from('lwf_state_config').delete()
        .eq('employee_id', req.params.id).eq('tenant_id', req.tenantId).is('effective_to', null)
      if (lwfDelErr) return serverError(req, reply, lwfDelErr, ErrorCode.DELETE_FAILED, 'Failed to clear prior LWF state config')
      if (lwfStateCode) {
        const { error: lwfInsErr } = await fastify.supabase.from('lwf_state_config').insert({
          employee_id: req.params.id, tenant_id: req.tenantId,
          state_code: lwfStateCode, effective_from: today, override_reason: 'Set from employee master',
        })
        // Same reasoning as PT above — a missing LWF config means the payroll
        // engine silently skips LWF deduction for this employee.
        if (lwfInsErr) return serverError(req, reply, lwfInsErr, ErrorCode.INSERT_FAILED, 'State transfer incomplete: failed to set new LWF state config')
      }
    }

    // Write holiday group tag directly on the employees row.
    const holidayGroupId = (bankPayload as any).holiday_group_id
    delete (bankPayload as any).holiday_group_id
    if (holidayGroupId !== undefined) {
      if (holidayGroupId) {
        // roster_holiday_groups' FK on employees.holiday_group_id has no
        // tenant compound, and this route runs under the service-role
        // client (bypasses RLS) — verify the group actually belongs to this
        // tenant before tagging the employee with it, matching the same
        // check already applied in masters/holidays.ts.
        const { data: group, error: groupErr } = await fastify.supabase
          .from('roster_holiday_groups').select('id')
          .eq('id', holidayGroupId).eq('tenant_id', req.tenantId).maybeSingle()
        if (groupErr) return serverError(req, reply, groupErr, ErrorCode.QUERY_FAILED, 'Failed to verify holiday group')
        if (!group) return validationError(reply, ErrorCode.VALIDATION_ERROR, 'Invalid holiday_group_id')
      }
      const { error: hgErr } = await fastify.supabase
        .from('employees')
        .update({ holiday_group_id: holidayGroupId || null })
        .eq('id', req.params.id)
        .eq('tenant_id', req.tenantId)
      if (hgErr) return serverError(req, reply, hgErr, ErrorCode.UPDATE_FAILED, 'Failed to update holiday group assignment')
    }

    const { data, error } = await fastify.supabase
      .from('employee_bank_statutory')
      .upsert(
        { ...bankPayload, employee_id: req.params.id, tenant_id: req.tenantId },
        { onConflict: 'tenant_id,employee_id' }
      )
      .select()
      .single()
    if (error) return serverError(req, reply, error, ErrorCode.UPDATE_FAILED, 'Failed to save bank and statutory information')
    return reply.send(data)
  })
}
