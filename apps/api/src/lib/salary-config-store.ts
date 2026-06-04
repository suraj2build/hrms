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

// ── Schemas (the one true contract) ──────────────────────────────────────────────

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
  description:        z.string().optional(),
  display_order:      z.number().int().optional().default(0),
  is_active:          z.boolean().optional().default(true),
})
export const componentUpdateSchema = componentCreateSchema.partial()

export const structureSchema = z.object({
  name:        z.string().min(1, 'Name is required').max(200),
  code:        z.string().min(1, 'Code is required').max(50),
  description: z.string().optional(),
  is_active:   z.boolean().optional().default(true),
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
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return dbFail(error)
  if (!data) return fail(404, 'NOT_FOUND', 'Salary component not found')
  return ok(data)
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
      .update({ is_active: false, updated_at: new Date().toISOString() })
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

export async function addStructureComponent(
  supabase: SupabaseClient, tenantId: string, structureId: string, body: unknown,
): Promise<StoreResult> {
  const parsed = structureComponentSchema.safeParse(body)
  if (!parsed.success) return fail(400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid component')
  const { data, error } = await supabase
    .from('salary_structure_components')
    .insert({ ...parsed.data, salary_structure_id: structureId, tenant_id: tenantId })
    .select('*, salary_components(*)')
    .single()
  if (error) {
    if (error.code === '23505') return fail(409, 'DUPLICATE_COMPONENT', 'Component already exists in this structure')
    return dbFail(error)
  }
  return ok(data, 201)
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
