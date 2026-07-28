/**
 * HelpdeskSla — resolves the response/resolution SLA windows (hours) a new
 * ticket should carry, shared by POST /helpdesk/tickets and the AI
 * assistant's create_helpdesk_ticket tool so both compute sla_due_at /
 * resolution_due_at the same way. The SLA-breach scanner (sla-scanner.ts)
 * relies on these columns being set — a ticket created with them NULL is
 * invisible to breach detection regardless of priority or age.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const SLA_HOURS: Record<string, number> = { urgent: 4, high: 8, medium: 24, low: 48 }
const RESOLUTION_HOURS: Record<string, number> = { urgent: 24, high: 48, medium: 72, low: 120 }

/**
 * Resolve the response + resolution SLA windows (hours) for a priority.
 * Prefers the tenant's configured helpdesk_sla_policies row; falls back to the
 * built-in defaults (and degrades gracefully if the table doesn't exist yet).
 */
async function resolveSla(
  supabase: SupabaseClient, tenantId: string, priority: string,
): Promise<{ response_hours: number; resolution_hours: number }> {
  const fallback = {
    response_hours:   SLA_HOURS[priority] ?? 24,
    resolution_hours: RESOLUTION_HOURS[priority] ?? 72,
  }
  try {
    const { data, error } = await supabase
      .from('helpdesk_sla_policies')
      .select('response_hours, resolution_hours')
      .eq('tenant_id', tenantId)
      .eq('priority', priority)
      .maybeSingle()
    if (error || !data) return fallback
    return {
      response_hours:   Number((data as any).response_hours)   || fallback.response_hours,
      resolution_hours: Number((data as any).resolution_hours) || fallback.resolution_hours,
    }
  } catch {
    return fallback
  }
}

/**
 * Resolve SLA windows for a category from helpdesk_category_sla.
 * Returns null when no category SLA row exists so caller can fall back to priority SLA.
 */
async function resolveCategorySla(
  supabase: SupabaseClient, tenantId: string, category: string,
): Promise<{ response_hours: number; resolution_hours: number } | null> {
  try {
    const { data, error } = await supabase
      .from('helpdesk_category_sla')
      .select('response_hours, resolution_hours')
      .eq('tenant_id', tenantId)
      .eq('category', category)
      .maybeSingle()
    if (error || !data) return null
    return {
      response_hours:   Number((data as any).response_hours),
      resolution_hours: Number((data as any).resolution_hours),
    }
  } catch {
    return null
  }
}

/** Category-based SLA takes precedence over priority-based SLA. */
export async function resolveTicketSla(
  supabase: SupabaseClient, tenantId: string, category: string, priority: string,
): Promise<{ response_hours: number; resolution_hours: number; sla_due_at: string; resolution_due_at: string }> {
  const sla = (await resolveCategorySla(supabase, tenantId, category)) ?? await resolveSla(supabase, tenantId, priority)
  const now = Date.now()
  return {
    ...sla,
    sla_due_at:        new Date(now + sla.response_hours   * 3_600_000).toISOString(),
    resolution_due_at: new Date(now + sla.resolution_hours * 3_600_000).toISOString(),
  }
}
