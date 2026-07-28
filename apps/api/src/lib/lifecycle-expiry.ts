/**
 * lifecycle-expiry.ts — the single source of workforce lifecycle / expiry risk.
 *
 * Program 3A. Every expiry risk in CognixHR is DERIVED here (no risk table) from
 * data that already exists:
 *
 *   document   → documents.expires_at
 *   identity   → employee_identity.expiry_date           (+ identity_types name)
 *   passport   → employee_passport_visa.expiry_date       (record_type='passport')
 *   visa       → employee_passport_visa.expiry_date       (record_type='visa')
 *   contract   → employee_contracts.end_date
 *   probation  → joining_date + employment_categories.probation_days,
 *                gated by the CURRENT job_history row (employment_type='probation',
 *                confirmation_date IS NULL) so confirmed staff never appear.
 *
 * This is the ONLY place lifecycle expiry is computed. Every consumer — the
 * Expiry Management workspace API, Workforce Command observations, the inbox
 * scanner, and the Executive metrics — reads this service. No duplicate expiry
 * logic anywhere else, no new scheduler, no new notification engine.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './supabase-paginate.js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate }  from './org-context.js'

const ID_CHUNK = 200

/** Runs queryFn once per chunk of `ids` (PostgREST .in() lists have a practical size limit) and concatenates the rows. */
async function fetchByIds<T>(
  ids: string[],
  queryFn: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await queryFn(ids.slice(i, i + ID_CHUNK))
    if (error) throw error
    out.push(...(data ?? []))
  }
  return out
}

export type LifecycleCategory =
  | 'document'
  | 'identity'
  | 'passport'
  | 'visa'
  | 'contract'
  | 'probation'
  | 'certification'

export type ExpiryBucket = 'overdue' | 'due_7' | 'due_30' | 'due_90'
export type ExpirySeverity = 'critical' | 'high' | 'medium' | 'info'

export interface LifecycleRiskItem {
  id:              string            // stable key: `${category}:${source_id}`
  category:        LifecycleCategory
  source_table:    string
  source_id:       string
  employee_id:     string
  employee_name:   string
  employee_code:   string | null
  department_id:   string | null
  department_name: string | null
  label:           string           // e.g. 'Passport — A1234567'
  detail:          string | null    // doc number / country / type
  due_date:        string           // YYYY-MM-DD (expiry / end / probation-end)
  days_to_due:     number           // negative = overdue
  bucket:          ExpiryBucket
  severity:        ExpirySeverity
}

// ── date helpers (UTC, no external deps) ─────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z')
  const b = Date.parse(toIso + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(iso + 'T00:00:00Z') + days * 86_400_000
  return isoOf(new Date(t))
}

export function bucketFor(daysToDue: number): ExpiryBucket {
  if (daysToDue < 0)  return 'overdue'
  if (daysToDue <= 7) return 'due_7'
  if (daysToDue <= 30) return 'due_30'
  return 'due_90'
}

export function severityForBucket(b: ExpiryBucket): ExpirySeverity {
  return b === 'overdue' ? 'critical' : b === 'due_7' ? 'high' : b === 'due_30' ? 'medium' : 'info'
}

const ALL_CATEGORIES: LifecycleCategory[] = ['document', 'identity', 'passport', 'visa', 'contract', 'probation', 'certification']

export interface LifecycleOptions {
  withinDays?: number              // forward window (default 90); all overdue always included
  categories?: LifecycleCategory[] // subset filter
  today?: Date
}

/**
 * Compute every lifecycle expiry risk for a tenant: all overdue items plus
 * anything falling due within `withinDays` (default 90). Single source of truth.
 */
export async function computeLifecycleRisks(
  supabase: SupabaseClient,
  tenantId: string,
  options:  LifecycleOptions = {},
): Promise<LifecycleRiskItem[]> {
  const within   = options.withinDays ?? 90
  // Tenant-local "today", not the server's (UTC) clock — this is invoked from
  // a background scanner with no per-request tenant context, so a bare
  // `new Date()` misclassifies a document/passport/contract expiring exactly
  // 7 tenant-local-days out as 6 or 8 days out for up to ~5.5 hours a day for
  // IST tenants, silently missing (or early-firing) the due_7/HR-alert bucket
  // (ISSUE-154 class).
  const todayIso = options.today
    ? isoOf(options.today)
    : getLocalDate(new Date().toISOString(), await fetchTenantTz(supabase, tenantId))
  const horizon  = addDaysIso(todayIso, within)        // upper bound for the forward window
  const cats     = new Set(options.categories ?? ALL_CATEGORIES)

  // ── 1. Pull each category's raw rows in parallel ───────────────────────────
  const [docs, idents, pvs, contracts, probationRows, certs] = await Promise.all([
    cats.has('document')
      ? fetchAllRows<any>((from, to) =>
          supabase.from('documents')
            .select('id, employee_id, doc_type, name, expires_at')
            .eq('tenant_id', tenantId).not('expires_at', 'is', null).lte('expires_at', horizon)
            .range(from, to))
      : Promise.resolve([] as any[]),
    cats.has('identity')
      ? fetchAllRows<any>((from, to) =>
          supabase.from('employee_identity')
            .select('id, employee_id, identity_number, expiry_date, identity_types(name)')
            .eq('tenant_id', tenantId).not('expiry_date', 'is', null).lte('expiry_date', horizon)
            .range(from, to))
      : Promise.resolve([] as any[]),
    (cats.has('passport') || cats.has('visa'))
      ? fetchAllRows<any>((from, to) =>
          supabase.from('employee_passport_visa')
            .select('id, employee_id, record_type, doc_number, country, visa_type, expiry_date')
            .eq('tenant_id', tenantId).not('expiry_date', 'is', null).lte('expiry_date', horizon)
            .range(from, to))
      : Promise.resolve([] as any[]),
    cats.has('contract')
      ? fetchAllRows<any>((from, to) =>
          supabase.from('employee_contracts')
            .select('id, employee_id, contract_type, end_date, status')
            .eq('tenant_id', tenantId).not('end_date', 'is', null).lte('end_date', horizon)
            // 'draft' contracts (migration 012's status CHECK) were never
            // signed/active — their end_date isn't a live commitment, so
            // excluding only 'terminated' let an unsigned draft's end_date
            // fire a false "expiring contract" HR alert.
            .not('status', 'in', '("terminated","draft")')
            .range(from, to))
      : Promise.resolve([] as any[]),
    cats.has('probation')
      ? fetchAllRows<any>((from, to) =>
          supabase.from('job_history')
            .select('employee_id, confirmation_date, employment_type')
            .eq('tenant_id', tenantId).eq('is_current', true)
            .eq('employment_type', 'probation').is('confirmation_date', null)
            .range(from, to))
      : Promise.resolve([] as any[]),
    cats.has('certification')
      ? fetchAllRows<any>((from, to) =>
          supabase.from('employee_certifications')
            .select('id, employee_id, cert_name, cert_type, expiry_date')
            .eq('tenant_id', tenantId).eq('status', 'active')
            .not('expiry_date', 'is', null).lte('expiry_date', horizon)
            .range(from, to))
      : Promise.resolve([] as any[]),
  ])

  // ── 2. Resolve employees + departments for every referenced employee ───────
  const empIds = new Set<string>()
  for (const r of docs)         empIds.add(r.employee_id)
  for (const r of idents)       empIds.add(r.employee_id)
  for (const r of pvs)          empIds.add(r.employee_id)
  for (const r of contracts)    empIds.add(r.employee_id)
  for (const r of probationRows) empIds.add(r.employee_id)
  for (const r of certs)        empIds.add(r.employee_id)
  const empIdList = [...empIds]

  const empMap = new Map<string, { name: string; code: string | null; joining_date: string | null; status: string; category_id: string | null }>()
  const deptMap = new Map<string, { id: string | null; name: string | null }>()
  const catProbationDays = new Map<string, number>()

  if (empIdList.length) {
    const [emps, jh, categories] = await Promise.all([
      fetchByIds(empIdList, (chunk) =>
        supabase.from('employees')
          .select('id, first_name, last_name, employee_code, joining_date, status, employment_category_id')
          .eq('tenant_id', tenantId).in('id', chunk)),
      fetchByIds(empIdList, (chunk) =>
        supabase.from('job_history')
          .select('employee_id, department_id, departments(name)')
          .eq('tenant_id', tenantId).eq('is_current', true).in('employee_id', chunk)),
      fetchAllRows<any>((from, to) =>
        supabase.from('employment_categories')
          .select('id, probation_days').eq('tenant_id', tenantId)
          .range(from, to)),
    ])
    for (const e of (emps ?? []) as any[]) {
      empMap.set(e.id, {
        name: `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || e.employee_code || e.id.slice(0, 8),
        code: e.employee_code ?? null,
        joining_date: e.joining_date ?? null,
        status: e.status,
        category_id: e.employment_category_id ?? null,
      })
    }
    for (const j of (jh ?? []) as any[]) {
      deptMap.set(j.employee_id, { id: j.department_id ?? null, name: (j.departments as any)?.name ?? null })
    }
    for (const c of (categories ?? []) as any[]) catProbationDays.set(c.id, Number(c.probation_days ?? 90))
  }

  const out: LifecycleRiskItem[] = []
  const push = (
    category: LifecycleCategory, source_table: string, source_id: string,
    employee_id: string, label: string, detail: string | null, dueDate: string,
  ) => {
    const emp = empMap.get(employee_id)
    if (!emp) return
    const dep = deptMap.get(employee_id) ?? { id: null, name: null }
    const days = daysBetween(todayIso, dueDate)
    const bucket = bucketFor(days)
    out.push({
      id: `${category}:${source_id}`, category, source_table, source_id,
      employee_id, employee_name: emp.name, employee_code: emp.code,
      department_id: dep.id, department_name: dep.name,
      label, detail, due_date: dueDate, days_to_due: days,
      bucket, severity: severityForBucket(bucket),
    })
  }

  // ── 3. Documents ───────────────────────────────────────────────────────────
  for (const d of docs) {
    const typ = String(d.doc_type ?? 'document').replace(/_/g, ' ')
    push('document', 'documents', d.id, d.employee_id, d.name || `Document — ${typ}`, typ, d.expires_at)
  }

  // ── 4. Identity documents ──────────────────────────────────────────────────
  for (const r of idents) {
    const tname = (r.identity_types as any)?.name ?? 'Identity document'
    push('identity', 'employee_identity', r.id, r.employee_id, `${tname} — ${r.identity_number ?? ''}`.trim(), tname, r.expiry_date)
  }

  // ── 5. Passport / Visa ─────────────────────────────────────────────────────
  for (const r of pvs) {
    const isVisa = r.record_type === 'visa'
    const category: LifecycleCategory = isVisa ? 'visa' : 'passport'
    if (!cats.has(category)) continue
    const label = isVisa
      ? `Visa${r.visa_type ? ` (${r.visa_type})` : ''} — ${r.doc_number ?? ''}`.trim()
      : `Passport — ${r.doc_number ?? ''}`.trim()
    push(category, 'employee_passport_visa', r.id, r.employee_id, label, r.country ?? null, r.expiry_date)
  }

  // ── 6. Contracts ───────────────────────────────────────────────────────────
  for (const r of contracts) {
    const typ = String(r.contract_type ?? 'contract').replace(/_/g, ' ')
    push('contract', 'employee_contracts', r.id, r.employee_id, `Contract — ${typ}`, typ, r.end_date)
  }

  // ── 7. Probation (accurate: category window + confirmation gate) ───────────
  for (const r of probationRows) {
    const emp = empMap.get(r.employee_id)
    if (!emp || emp.status !== 'active' || !emp.joining_date) continue
    const probationDays = (emp.category_id && catProbationDays.get(emp.category_id)) || 90
    const probationEnd  = addDaysIso(emp.joining_date.slice(0, 10), probationDays)
    if (daysBetween(todayIso, probationEnd) > within) continue   // confirmation not yet near
    push('probation', 'job_history', r.employee_id, r.employee_id, 'Probation confirmation', `${probationDays}-day probation`, probationEnd)
  }

  // ── 8. Certifications ──────────────────────────────────────────────────────
  for (const r of certs) {
    const typ = String(r.cert_type ?? 'certification').replace(/_/g, ' ')
    push('certification', 'employee_certifications', r.id, r.employee_id,
      `${typ.charAt(0).toUpperCase() + typ.slice(1)} — ${r.cert_name}`, typ, r.expiry_date)
  }

  // Sort by urgency (soonest / most overdue first).
  out.sort((a, b) => a.days_to_due - b.days_to_due)
  return out
}

/** Items that warrant a proactive inbox alert: all overdue + due within 7 days. */
export async function computeLifecycleActionable(
  supabase: SupabaseClient,
  tenantId: string,
  today?:   Date,
): Promise<LifecycleRiskItem[]> {
  const all = await computeLifecycleRisks(supabase, tenantId, { withinDays: 90, today })
  return all.filter(i => i.bucket === 'overdue' || i.bucket === 'due_7')
}

const CATEGORY_LABEL: Record<LifecycleCategory, string> = {
  document: 'Documents', identity: 'Identity documents', passport: 'Passports',
  visa: 'Visas', contract: 'Contracts', probation: 'Probation confirmations',
  certification: 'Certifications & Licenses',
}
export function categoryLabel(c: LifecycleCategory): string {
  return CATEGORY_LABEL[c]
}

export interface LifecycleSummary {
  total:      number
  by_bucket:  Record<ExpiryBucket, number>
  by_category: Record<LifecycleCategory, Record<ExpiryBucket, number>>
}

/** Roll up a risk list into bucket / category counts (for workspace + executive). */
export function summariseLifecycle(items: LifecycleRiskItem[]): LifecycleSummary {
  const emptyBuckets = (): Record<ExpiryBucket, number> => ({ overdue: 0, due_7: 0, due_30: 0, due_90: 0 })
  const summary: LifecycleSummary = {
    total: items.length,
    by_bucket: emptyBuckets(),
    by_category: {
      document: emptyBuckets(), identity: emptyBuckets(), passport: emptyBuckets(),
      visa: emptyBuckets(), contract: emptyBuckets(), probation: emptyBuckets(),
      certification: emptyBuckets(),
    },
  }
  for (const it of items) {
    summary.by_bucket[it.bucket]++
    summary.by_category[it.category][it.bucket]++
  }
  return summary
}
