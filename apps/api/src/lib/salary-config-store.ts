/**
 * salary-config-store.ts
 *
 * SINGLE authoritative implementation of salary-component / salary-structure
 * configuration CRUD. Both route families delegate here so they can never drift:
 *   - routes/masters/salary-components.ts   (/masters/salary-components)
 *   - routes/masters/salary-structures.ts   (/masters/salary-structures)
 *   - routes/payroll/compensation-master.ts (/payroll/compensation/*)
 *
 * Pure data-access helpers — no Fastify coupling. Each returns a discriminated
 * { status, data?, error? } result; route layers map it to their own reply
 * shape so existing client contracts are preserved while validation, tenant
 * scoping and delete semantics are unified.
 *
 * Unified semantics:
 *   - Writes are tenant-scoped on every query.
 *   - Component schema is a SUPERSET (all taxability + statutory + engine flags)
 *     with sensible defaults — accepts both legacy and builder payloads.
 *   - deleteComponent: soft-delete (is_active=false) when the component is still
 *     referenced by a structure; hard-delete otherwise. (Never hard-blocks.)
 *   - deleteStructure: 409 when still assigned to employees; hard-delete otherwise.
 */

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STANDARD_SALARY_COMPONENTS } from './standard-salary-components.js'
import { fetchAllRows } from './supabase-paginate.js'

// ── Schemas (the one true contract) ──────────────────────────────────────────────

const CALC_TYPES = ['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross', 'balance'] as const

export const componentCreateSchema = z.object({
  name:               z.string().min(1, 'Name is required').max(200),
  code:               z.string().min(1, 'Code is required').max(50),
  component_type:     z.enum(['earning', 'deduction', 'employer_contribution']),
  is_taxable:         z.boolean().optional().default(true),
  is_pf_applicable:   z.boolean().optional().default(false),
  is_esi_applicable:  z.boolean().optional().default(false),
  is_pt_applicable:   z.boolean().optional().default(false),
  is_lwf_applicable:  z.boolean().optional().default(false),
  is_variable:        z.boolean().optional().default(false),
  // Engine flags (used by compensation-engine; previously unsettable via CRUD)
  is_basic:           z.boolean().optional(),
  affects_pf:         z.boolean().optional(),
  affects_nlc:        z.boolean().optional(),
  // Suggested rule — pre-fills the structure builder when this component is added
  default_calculation_type: z.enum(CALC_TYPES).nullable().optional(),
  default_value:            z.number().min(0).nullable().optional(),
  // FBP: paid monthly, reconciled quarterly against bills; shortfall is taxable
  is_reimbursement:         z.boolean().optional(),
  exemption_limit_annual:   z.number().min(0).nullable().optional(),
  description:        z.string().optional(),
  display_order:      z.number().int().optional().default(0),
  is_active:          z.boolean().optional().default(true),
})
export const componentUpdateSchema = componentCreateSchema.partial()

export const structureSchema = z.object({
  name:            z.string().min(1, 'Name is required').max(200),
  code:            z.string().min(1, 'Code is required').max(50),
  description:     z.string().optional(),
  is_active:       z.boolean().optional().default(true),
  is_default:      z.boolean().optional(),
  pf_applicable:   z.boolean().optional().default(true),
  esi_applicable:  z.boolean().optional().default(true),
  tds_applicable:  z.boolean().optional().default(true),
  pf_ceiling_mode: z.enum(['capped', 'actual', 'follow_policy']).optional().default('follow_policy'),
})
export const structureUpdateSchema = structureSchema.partial()

export const structureComponentSchema = z.object({
  salary_component_id: z.string().uuid('Invalid component ID'),
  calculation_type:    z.enum(['fixed', 'pct_of_basic', 'pct_of_ctc', 'pct_of_gross']),
  default_value:       z.number().min(0, 'Value must be >= 0'),
  sequence:            z.number().int().optional().default(0),
  is_active:           z.boolean().optional().default(true),
})
export const structureComponentUpdateSchema = structureComponentSchema.partial()

// ── Result type ───────────────────────────────────────────────────────────────

export interface StoreResult<T = any> {
  status: number
  data?:  T
  error?: { error: string; message: string }
}

const ok    = <T>(data: T, status = 200): StoreResult<T> => ({ status, data })
const noData = (status = 204): StoreResult => ({ status })
const fail  = (status: number, error: string, message: string): StoreResult =>
  ({ status, error: { error, message } })

function dbFail(error: { message: string; code?: string }): StoreResult {
  return fail(500, 'DB_ERROR', error.message)
}

// ── Components ───────────────────────────────────────────────────────────────────

export async function listComponents(
  supabase: SupabaseClient,
  tenantId: string,
  filters: { component_type?: string; is_active?: boolean } = {},
): Promise<StoreResult> {
  let q = supabase
    .from('salary_components')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (filters.component_type) q = q.eq('component_type', filters.component_type)
  if (filters.is_active !== undefined) q = q.eq('is_active', filters.is_active)
  const { data, error } = await q
  if (error) return dbFail(error)
  return ok(data ?? [])
}

export async function createComponent(
  supabase: SupabaseClient, tenantId: string, body: unknown,
): Promise<StoreResult> {
  const parsed = componentCreateSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid component')
  const { data, error } = await supabase
    .from('salary_components')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return fail(409, 'DUPLICATE_CODE', 'A component with this code already exists')
    return dbFail(error)
  }
  return ok(data, 201)
}

export async function updateComponent(
  supabase: SupabaseClient, tenantId: string, id: string, body: unknown,
): Promise<StoreResult> {
  const parsed = componentUpdateSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid component')
  const { data, error } = await supabase
    .from('salary_components')
    .update({ ...parsed.data })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return dbFail(error)
  if (!data) return fail(404, 'NOT_FOUND', 'Salary component not found')
  return ok(data)
}

/**
 * Seed the tenant's component library with the best-practice standard set.
 * Idempotent: existing codes are left untouched (ON CONFLICT DO NOTHING via
 * ignoreDuplicates), so it is safe to call repeatedly and never overwrites a
 * tenant's edits.
 */
export async function seedStandardComponents(
  supabase: SupabaseClient, tenantId: string,
): Promise<StoreResult> {
  const rows = STANDARD_SALARY_COMPONENTS.map(s => ({ ...s, tenant_id: tenantId, is_active: true }))
  const { data, error } = await supabase
    .from('salary_components')
    .upsert(rows, { onConflict: 'tenant_id,code', ignoreDuplicates: true })
    .select('id')
  if (error) return dbFail(error)
  const created = (data as Array<{ id: string }> | null)?.length ?? 0
  return ok({ created, skipped: rows.length - created, total: rows.length }, 201)
}

/** Soft-delete when referenced by a structure; hard-delete otherwise. */
export async function deleteComponent(
  supabase: SupabaseClient, tenantId: string, id: string,
): Promise<StoreResult> {
  const { count } = await supabase
    .from('salary_structure_components')
    .select('id', { count: 'exact', head: true })
    .eq('salary_component_id', id)
    .eq('tenant_id', tenantId)

  if ((count ?? 0) > 0) {
    const { error } = await supabase
      .from('salary_components')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (error) return dbFail(error)
    return ok({ message: 'Component deactivated (referenced in salary structures)' }, 200)
  }

  const { error } = await supabase
    .from('salary_components')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return dbFail(error)
  return noData(204)
}

// ── Structures ───────────────────────────────────────────────────────────────────

export async function listStructures(
  supabase: SupabaseClient, tenantId: string,
  shape: 'full' | 'count' = 'full',
): Promise<StoreResult> {
  const select = shape === 'count'
    ? '*, salary_structure_components(count)'
    : '*, salary_structure_components(*, salary_components(id, name, code, component_type))'
  const { data, error } = await supabase
    .from('salary_structures')
    .select(select)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  if (error) return dbFail(error)

  if (shape === 'count') {
    // Fetch count of active employee compensations per structure
    const empRows = await fetchAllRows((from, to) =>
      supabase
        .from('employee_compensations')
        .select('salary_structure_id')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .not('salary_structure_id', 'is', null)
        .order('employee_id')
        .range(from, to),
    )

    const empCountMap: Record<string, number> = {}
    for (const row of empRows) {
      if (row.salary_structure_id)
        empCountMap[row.salary_structure_id] = (empCountMap[row.salary_structure_id] ?? 0) + 1
    }

    return ok((data ?? []).map((s: any) => ({ ...s, employee_count: empCountMap[s.id] ?? 0 })))
  }

  return ok(data ?? [])
}

export async function getStructure(
  supabase: SupabaseClient, tenantId: string, id: string,
): Promise<StoreResult> {
  const { data, error } = await supabase
    .from('salary_structures')
    .select('*, salary_structure_components(*, salary_components(*))')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) return dbFail(error)
  if (!data) return fail(404, 'NOT_FOUND', 'Salary structure not found')
  return ok(data)
}

export async function createStructure(
  supabase: SupabaseClient, tenantId: string, body: unknown,
): Promise<StoreResult> {
  const parsed = structureSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid structure')
  const { data, error } = await supabase
    .from('salary_structures')
    .insert({ ...parsed.data, tenant_id: tenantId })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') return fail(409, 'DUPLICATE_CODE', 'A structure with this code already exists')
    return dbFail(error)
  }
  return ok(data, 201)
}

export async function updateStructure(
  supabase: SupabaseClient, tenantId: string, id: string, body: unknown,
): Promise<StoreResult> {
  const parsed = structureUpdateSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid structure')

  // Atomically clear the existing default before setting this one.
  // The partial-unique index (WHERE is_default = true) only allows one per tenant,
  // so we must clear first to avoid a constraint violation.
  if (parsed.data.is_default === true) {
    const { error: clearErr } = await supabase
      .from('salary_structures')
      .update({ is_default: false })
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .neq('id', id)
    if (clearErr) return dbFail(clearErr)
  }

  const { data, error } = await supabase
    .from('salary_structures')
    .update(parsed.data)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return dbFail(error)
  if (!data) return fail(404, 'NOT_FOUND', 'Salary structure not found')
  return ok(data)
}

/** 409 when still assigned to employees; hard-delete otherwise. */
export async function deleteStructure(
  supabase: SupabaseClient, tenantId: string, id: string,
): Promise<StoreResult> {
  const { count } = await supabase
    .from('employee_compensations')
    .select('id', { count: 'exact', head: true })
    .eq('salary_structure_id', id)
    .eq('tenant_id', tenantId)
  if ((count ?? 0) > 0)
    return fail(409, 'IN_USE', 'Structure is assigned to employees')
  const { error } = await supabase
    .from('salary_structures')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return dbFail(error)
  return noData(204)
}

// ── Structure components ──────────────────────────────────────────────────────────

export async function listStructureComponents(
  supabase: SupabaseClient, tenantId: string, structureId: string,
): Promise<StoreResult> {
  const { data, error } = await supabase
    .from('salary_structure_components')
    .select('*, salary_components(*)')
    .eq('salary_structure_id', structureId)
    .eq('tenant_id', tenantId)
    .order('sequence', { ascending: true })
  if (error) return dbFail(error)
  return ok(data ?? [])
}

/** Add schema where the rule is OPTIONAL — falls back to the component's default. */
const addStructureComponentSchema = z.object({
  salary_component_id: z.string().uuid('Invalid component ID'),
  calculation_type:    z.enum(CALC_TYPES).optional(),
  default_value:       z.number().min(0, 'Value must be >= 0').optional(),
  sequence:            z.number().int().optional().default(0),
  is_active:           z.boolean().optional().default(true),
})

export async function addStructureComponent(
  supabase: SupabaseClient, tenantId: string, structureId: string, body: unknown,
): Promise<StoreResult> {
  const parsed = addStructureComponentSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid component')

  let { calculation_type, default_value } = parsed.data

  // Fall back to the component's suggested default rule when the caller omits it.
  if (calculation_type == null || default_value == null) {
    const { data: comp } = await supabase
      .from('salary_components')
      .select('default_calculation_type, default_value')
      .eq('id', parsed.data.salary_component_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    calculation_type = calculation_type ?? (comp?.default_calculation_type ?? undefined)
    default_value    = default_value    ?? (comp?.default_value != null ? Number(comp.default_value) : undefined)
  }

  if (calculation_type == null || default_value == null) {
    return fail(400, 'NO_RULE', 'No calculation rule supplied and the component has no default rule configured')
  }

  const { data, error } = await supabase
    .from('salary_structure_components')
    .insert({
      salary_component_id: parsed.data.salary_component_id,
      calculation_type,
      default_value,
      sequence:            parsed.data.sequence,
      is_active:           parsed.data.is_active,
      salary_structure_id: structureId,
      tenant_id:           tenantId,
    })
    .select('*, salary_components(*)')
    .single()
  if (error) {
    if (error.code === '23505') return fail(409, 'DUPLICATE_COMPONENT', 'Component already exists in this structure')
    return dbFail(error)
  }
  return ok(data, 201)
}

/**
 * Clone a salary structure (group) into a new one, copying every component +
 * its per-structure rule. Lets admins build a new group from an existing one
 * instead of configuring from scratch.
 */
export async function cloneStructure(
  supabase: SupabaseClient, tenantId: string, sourceId: string, body: unknown,
): Promise<StoreResult> {
  const parsed = structureSchema.pick({ name: true, code: true }).safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid structure')

  // Verify the source belongs to the tenant.
  const { data: source, error: srcErr } = await supabase
    .from('salary_structures')
    .select('id, description')
    .eq('id', sourceId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (srcErr) return dbFail(srcErr)
  if (!source) return fail(404, 'NOT_FOUND', 'Source structure not found')

  // Create the new structure header.
  const { data: created, error: createErr } = await supabase
    .from('salary_structures')
    .insert({ tenant_id: tenantId, name: parsed.data.name, code: parsed.data.code, description: source.description, is_active: true })
    .select()
    .single()
  if (createErr) {
    if (createErr.code === '23505') return fail(409, 'DUPLICATE_CODE', 'A structure with this code already exists')
    return dbFail(createErr)
  }

  // Copy the component rows.
  const { data: srcComps, error: compErr } = await supabase
    .from('salary_structure_components')
    .select('salary_component_id, calculation_type, default_value, sequence, is_active')
    .eq('salary_structure_id', sourceId)
    .eq('tenant_id', tenantId)
  if (compErr) return dbFail(compErr)

  if (srcComps && srcComps.length > 0) {
    const rows = srcComps.map((c: any) => ({ ...c, salary_structure_id: created.id, tenant_id: tenantId }))
    const { error: insErr } = await supabase.from('salary_structure_components').insert(rows)
    if (insErr) {
      // Roll back the header so a half-cloned structure isn't left behind.
      await supabase.from('salary_structures').delete().eq('id', created.id).eq('tenant_id', tenantId)
      return dbFail(insErr)
    }
  }

  return ok({ ...created, copied_components: srcComps?.length ?? 0 }, 201)
}

export async function updateStructureComponent(
  supabase: SupabaseClient, tenantId: string, structureId: string, componentId: string, body: unknown,
): Promise<StoreResult> {
  const parsed = structureComponentUpdateSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid component')
  const { data, error } = await supabase
    .from('salary_structure_components')
    .update(parsed.data)
    .eq('id', componentId)
    .eq('salary_structure_id', structureId)
    .eq('tenant_id', tenantId)
    .select('*, salary_components(*)')
    .single()
  if (error) return dbFail(error)
  if (!data) return fail(404, 'NOT_FOUND', 'Component not found')
  return ok(data)
}

export async function removeStructureComponent(
  supabase: SupabaseClient, tenantId: string, structureId: string, componentId: string,
): Promise<StoreResult> {
  const { error } = await supabase
    .from('salary_structure_components')
    .delete()
    .eq('id', componentId)
    .eq('salary_structure_id', structureId)
    .eq('tenant_id', tenantId)
  if (error) return dbFail(error)
  return noData(204)
}
