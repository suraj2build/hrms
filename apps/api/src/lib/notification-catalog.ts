/**
 * Notification Catalog — SINGLE SOURCE OF TRUTH
 *
 * One canonical definition of everything a notification template can use:
 *   - categories  (must match the notification_templates.category CHECK in DB)
 *   - severities  (must match the severity CHECK in DB)
 *   - channels    (active delivery channels)
 *   - variables   (the placeholder tokens an author can insert)
 *
 * Consumed by:
 *   - the templates route (zod validation + GET /meta endpoint)
 *   - the substitution engine (renderNotificationTemplate)
 *   - the frontend form (fetches GET /meta — no hardcoded lists)
 *
 * If you add a category/severity here, also add it to the DB CHECK constraint
 * via a migration, and vice-versa. These two must always agree.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate } from './org-context.js'

// ── Categories — aligned to notification_templates_category_check (migration 237)
export const NOTIFICATION_CATEGORIES = [
  'attendance', 'leave', 'payroll', 'compliance',
  'escalation', 'incident', 'approval', 'general', 'onboarding',
] as const
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]

// ── Severities — aligned to the severity CHECK (migration 106)
export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const
export type NotificationSeverity = typeof NOTIFICATION_SEVERITIES[number]

// ── Channels — active delivery channels (R9-minimal)
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const
export type NotificationChannel = typeof NOTIFICATION_CHANNELS[number]

// ── Variable catalog ──────────────────────────────────────────────────────────
// `key` is the token authors type as {{key}}. `scope` documents where the value
// comes from: employee | company | event | system.
export interface NotificationVariable {
  key:         string
  label:       string
  description: string
  sample:      string
  scope:       'employee' | 'company' | 'event' | 'system'
}

export const NOTIFICATION_VARIABLES: NotificationVariable[] = [
  // Employee
  { key: 'employee_name',  label: 'Employee Name',  description: "Recipient's full name",        sample: 'Asha Menon',          scope: 'employee' },
  { key: 'first_name',     label: 'First Name',     description: "Recipient's first name",       sample: 'Asha',                scope: 'employee' },
  { key: 'employee_code',  label: 'Employee Code',  description: 'Recipient employee code',      sample: 'EMP0142',             scope: 'employee' },
  { key: 'email',          label: 'Email',          description: "Recipient's email address",    sample: 'asha@acme.com',       scope: 'employee' },
  { key: 'department',     label: 'Department',     description: "Recipient's department",       sample: 'Engineering',         scope: 'employee' },
  { key: 'designation',    label: 'Designation',    description: "Recipient's designation",      sample: 'Senior Engineer',     scope: 'employee' },
  // Company
  { key: 'company_name',   label: 'Company Name',   description: 'Your organisation name',       sample: 'Acme Corp',           scope: 'company' },
  // System
  { key: 'date',           label: 'Current Date',   description: "Today's date (YYYY-MM-DD)",    sample: '2026-06-14',          scope: 'system' },
  // Event (resolved from the triggering event's metadata)
  { key: 'status',         label: 'Status',         description: 'Outcome status of the event',  sample: 'approved',            scope: 'event' },
  { key: 'leave_type',     label: 'Leave Type',     description: 'Leave type (leave events)',     sample: 'Casual Leave',        scope: 'event' },
  { key: 'from_date',      label: 'From Date',      description: 'Start date of the request',     sample: '2026-06-20',          scope: 'event' },
  { key: 'to_date',        label: 'To Date',        description: 'End date of the request',       sample: '2026-06-22',          scope: 'event' },
  { key: 'days',           label: 'Days',           description: 'Number of days',                sample: '3',                   scope: 'event' },
]

const VALID_KEYS = new Set(NOTIFICATION_VARIABLES.map(v => v.key))

// ── Substitution engine ───────────────────────────────────────────────────────

/** Token matcher: {{ key }} with optional surrounding whitespace. */
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/**
 * Replace {{key}} tokens with values. Tokens with a provided value are
 * substituted; tokens without one are left as-is so the gap is visible
 * rather than silently blanked. Returns the rendered string.
 */
export function renderNotificationTemplate(text: string, values: Record<string, string>): string {
  if (!text) return text
  return text.replace(TOKEN_RE, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  )
}

/** Returns the distinct, catalog-known variable keys used in the text. */
export function extractPlaceholders(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    if (!text) continue
    let m: RegExpExecArray | null
    TOKEN_RE.lastIndex = 0
    while ((m = TOKEN_RE.exec(text)) !== null) {
      if (VALID_KEYS.has(m[1])) found.add(m[1])
    }
  }
  return [...found]
}

/**
 * Resolve the variable value map for a given recipient + tenant + event extras.
 * Employee/company/system values are looked up; event values come from `extra`
 * (e.g. leave_type, status from the triggering event). Only resolvable keys are
 * returned; everything else is left for renderNotificationTemplate to keep raw.
 */
export async function resolveNotificationVariables(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { employeeId?: string | null; extra?: Record<string, unknown> } = {},
): Promise<Record<string, string>> {
  const values: Record<string, string> = {}

  // System — tenant-local date, not UTC, so a notification rendered near
  // midnight IST shows the tenant's own calendar day.
  const tz = await fetchTenantTz(supabase, tenantId)
  values.date = getLocalDate(new Date().toISOString(), tz)

  // Company
  try {
    const { data: t } = await supabase.from('tenants').select('name').eq('id', tenantId).maybeSingle()
    if ((t as any)?.name) values.company_name = (t as any).name
  } catch { /* non-fatal */ }

  // Employee (+ department / designation names)
  if (opts.employeeId) {
    try {
      const { data: e } = await supabase
        .from('employees')
        .select('first_name, last_name, employee_code, email, job_history!job_history_employee_id_fkey(department_id, designation_id, is_current)')
        .eq('id', opts.employeeId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const emp = e as any
      if (emp) {
        const jh = (emp.job_history ?? []).find((j: any) => j.is_current) ?? (emp.job_history ?? [])[0] ?? null
        emp.department_id  = jh?.department_id ?? null
        emp.designation_id = jh?.designation_id ?? null
        values.employee_name = `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim()
        values.first_name    = emp.first_name ?? ''
        values.employee_code = emp.employee_code ?? ''
        values.email         = emp.email ?? ''
        if (emp.department_id) {
          const { data: d } = await supabase.from('departments').select('name').eq('id', emp.department_id).eq('tenant_id', tenantId).maybeSingle()
          if ((d as any)?.name) values.department = (d as any).name
        }
        if (emp.designation_id) {
          const { data: g } = await supabase.from('designations').select('name').eq('id', emp.designation_id).eq('tenant_id', tenantId).maybeSingle()
          if ((g as any)?.name) values.designation = (g as any).name
        }
      }
    } catch { /* non-fatal */ }
  }

  // Event extras — only adopt keys that exist in the catalog, coerced to string
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      if (VALID_KEYS.has(k) && v != null) values[k] = String(v)
    }
  }

  return values
}
