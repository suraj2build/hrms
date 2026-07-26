/**
 * compliance-calendar.ts — the single source of statutory filing deadlines.
 *
 * Deadlines are CALCULATED (no deadline table) from what the tenant already has
 * enabled (payroll_statutory_settings, statutory_registrations, lwf_state_settings)
 * and marked COMPLETED from existing filing records (statutory_filing_closures for
 * pf/esi/pt/tds, statutory_filing_artifacts for lwf/24q).
 *
 * This is the ONLY place compliance deadlines are derived. Both the calendar APIs
 * and the alert generators (Workforce Command observations + inbox scan) consume
 * this service — no duplicate deadline logic anywhere else.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate } from './org-context.js'

export type ComplianceStatus = 'upcoming' | 'due_soon' | 'overdue' | 'completed'

export interface ComplianceDeadline {
  id:              string            // stable key: `${type}:${jurisdiction}:${period}`
  compliance_type: string           // EPF | ESI | PT | TDS | TDS-24Q | LWF
  label:           string
  jurisdiction:    string           // 'Central' or a state code
  period:          string           // 'YYYY-MM' (monthly) or 'FY2025-26 Q1' (quarterly)
  period_label:    string
  due_date:        string           // 'YYYY-MM-DD'
  status:          ComplianceStatus
  days_to_due:     number           // negative = overdue
  filed_at:        string | null
  reference:       string | null    // challan/ack reference when completed
}

// ── date helpers (UTC, no external deps) ─────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const ym  = (y: number, m: number) => `${y}-${pad(m)}`

function addMonths(year: number, month1: number, delta: number): [number, number] {
  // month1 is 1-based
  const idx = (year * 12 + (month1 - 1)) + delta
  return [Math.floor(idx / 12), (idx % 12) + 1]
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + 'T00:00:00Z')
  const b = Date.parse(toIso + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

// Indian FY label for a calendar month: Apr (4) starts the FY.
function fyLabel(year: number, month1: number): string {
  const start = month1 >= 4 ? year : year - 1
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`
}
function quarterOf(month1: number): 1 | 2 | 3 | 4 {
  if (month1 >= 4 && month1 <= 6) return 1
  if (month1 >= 7 && month1 <= 9) return 2
  if (month1 >= 10 && month1 <= 12) return 3
  return 4 // Jan-Mar
}

function statusFor(dueDate: string, today: string, completed: boolean): ComplianceStatus {
  if (completed) return 'completed'
  const d = daysBetween(today, dueDate)
  if (d < 0) return 'overdue'
  if (d <= 7) return 'due_soon'
  return 'upcoming'
}

interface CalendarOptions { backMonths?: number; fwdMonths?: number; today?: Date }

export async function computeComplianceCalendar(
  supabase: SupabaseClient,
  tenantId: string,
  options:  CalendarOptions = {},
): Promise<ComplianceDeadline[]> {
  const backMonths = options.backMonths ?? 3
  const fwdMonths  = options.fwdMonths ?? 3
  // Resolve "today" in the tenant's local timezone, not the server's UTC
  // clock — same bug class as ISSUE-154 (absconding-engine.ts) and the
  // compensation-coverage fix: a raw server-UTC date misreports overdue/
  // due_soon status for up to ~5.5 hours a day for IST tenants, since a
  // filing that's already overdue at IST midnight still reads as "today"
  // in UTC. An explicit options.today override (used by callers/tests that
  // already have a concrete date) bypasses the tenant lookup.
  const todayIso = options.today
    ? ymd(options.today.getUTCFullYear(), options.today.getUTCMonth() + 1, options.today.getUTCDate())
    : getLocalDate(new Date().toISOString(), await fetchTenantTz(supabase, tenantId))

  // ── what's enabled + jurisdictions ─────────────────────────────────────────
  const [{ data: settings }, { data: regs }, { data: lwfStates }] = await Promise.all([
    supabase.from('payroll_statutory_settings')
      .select('pf_enabled, esi_enabled, pt_enabled, tds_enabled').eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('statutory_registrations')
      .select('statutory_type, state_code').eq('tenant_id', tenantId).eq('is_active', true),
    supabase.from('lwf_state_settings')
      .select('state_code, state_name, frequency, deduction_months, registration_number')
      .eq('tenant_id', tenantId).eq('enabled', true),
  ])

  const s = (settings as any) ?? { pf_enabled: true, esi_enabled: true, pt_enabled: false, tds_enabled: false }
  const ptStates = [...new Set(((regs ?? []) as any[]).filter(r => r.statutory_type === 'ptax').map(r => r.state_code).filter(Boolean))]

  // ── completion signals ─────────────────────────────────────────────────────
  const [{ data: closures }, { data: artifacts }] = await Promise.all([
    supabase.from('statutory_filing_closures')
      .select('month, statutory_type, filed_at, challan_number').eq('tenant_id', tenantId),
    supabase.from('statutory_filing_artifacts')
      .select('artifact_type, period_month, period_quarter, period_fy, status, acknowledged_at').eq('tenant_id', tenantId),
  ])
  // closure key: `${type}:${month}` → { filed_at, ref }
  const closureMap = new Map<string, { filed_at: string | null; ref: string | null }>()
  for (const c of (closures ?? []) as any[]) closureMap.set(`${c.statutory_type}:${c.month}`, { filed_at: c.filed_at ?? null, ref: c.challan_number ?? null })
  // artifact completion (lwf monthly / 24q quarterly): acknowledged/submitted
  const artifactDone = new Set<string>()
  for (const a of (artifacts ?? []) as any[]) {
    if (!['submitted', 'acknowledged'].includes(a.status)) continue
    if (a.period_month)   artifactDone.add(`${a.artifact_type}:m:${a.period_month}`)
    if (a.period_quarter && a.period_fy) artifactDone.add(`${a.artifact_type}:q:${a.period_fy}:${a.period_quarter}`)
  }

  const out: ComplianceDeadline[] = []
  const [baseY, baseM] = todayIso.split('-').map(Number)

  // Monthly statutes over the window (contribution month → due next month).
  for (let off = -backMonths; off <= fwdMonths; off++) {
    const [cy, cm] = addMonths(baseY, baseM, off)        // contribution month
    const period   = ym(cy, cm)
    const [ny, nm] = addMonths(cy, cm, 1)                // filing month (next)
    const monLabel = new Date(Date.UTC(cy, cm - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })

    const push = (type: string, label: string, jurisdiction: string, dueY: number, dueM: number, dueD: number, completed: boolean, ref: string | null, filed_at: string | null) => {
      const due = ymd(dueY, dueM, dueD)
      out.push({
        id: `${type}:${jurisdiction}:${period}`, compliance_type: type, label,
        jurisdiction, period, period_label: monLabel, due_date: due,
        status: statusFor(due, todayIso, completed), days_to_due: daysBetween(todayIso, due),
        filed_at, reference: ref,
      })
    }

    if (s.pf_enabled) {
      const c = closureMap.get(`pf:${period}`)
      push('EPF', `EPF ECR — ${monLabel}`, 'Central', ny, nm, 15, !!c, c?.ref ?? null, c?.filed_at ?? null)
    }
    if (s.esi_enabled) {
      const c = closureMap.get(`esi:${period}`)
      // ESI contribution is due by the 21st of the following month under
      // the ESI Act — was copy-pasted from EPF's 15th, marking filings
      // "overdue" up to 6 days early.
      push('ESI', `ESI contribution — ${monLabel}`, 'Central', ny, nm, 21, !!c, c?.ref ?? null, c?.filed_at ?? null)
    }
    if (s.tds_enabled) {
      const c = closureMap.get(`tds:${period}`)
      // Monthly TDS deposit: 7th of next month (March → Apr 30).
      const isMarch = cm === 3
      push('TDS', `TDS deposit — ${monLabel}`, 'Central', isMarch ? ny : ny, isMarch ? 4 : nm, isMarch ? 30 : 7, !!c, c?.ref ?? null, c?.filed_at ?? null)
    }
    if (s.pt_enabled) {
      for (const st of (ptStates.length ? ptStates : ['—'])) {
        const c = closureMap.get(`pt:${period}`)
        push('PT', `Professional Tax — ${monLabel}`, st, ny, nm, 21, !!c, c?.ref ?? null, c?.filed_at ?? null)
      }
    }
    for (const lw of (lwfStates ?? []) as any[]) {
      // Emit only for configured deduction months; default monthly.
      const months = String(lw.deduction_months ?? '').split(',').map((x: string) => parseInt(x.trim(), 10)).filter((n: number) => n >= 1 && n <= 12)
      const isDeductionMonth = lw.frequency === 'monthly' || months.length === 0 ? true : months.includes(cm)
      if (!isDeductionMonth) continue
      const done = artifactDone.has(`lwf:m:${period}`)
      push('LWF', `Labour Welfare Fund — ${monLabel}`, lw.state_code, ny, nm, 15, done, lw.registration_number ?? null, null)
    }
  }

  // Quarterly TDS 24Q returns whose due date lands in the window.
  if (s.tds_enabled) {
    // Statutory 24Q due dates: Q1→Jul31, Q2→Oct31, Q3→Jan31(next yr), Q4→May31.
    for (let off = -backMonths - 3; off <= fwdMonths + 3; off++) {
      const [cy, cm] = addMonths(baseY, baseM, off)
      const q = quarterOf(cm)
      // anchor each quarter once (use its last month)
      const lastMonthOfQ = q === 1 ? 6 : q === 2 ? 9 : q === 3 ? 12 : 3
      if (cm !== lastMonthOfQ) continue
      const fy = fyLabel(cy, cm)
      let dueY = cy, dueM = 7, dueD = 31
      if (q === 1) { dueM = 7;  dueY = cy }
      if (q === 2) { dueM = 10; dueY = cy }
      if (q === 3) { dueM = 1;  dueY = cy + 1 }      // Oct-Dec → Jan 31 next year
      if (q === 4) { dueM = 5;  dueY = cy }          // Jan-Mar (cm=3) → May 31 same year
      const due = ymd(dueY, dueM, dueD)
      // only keep if due date within a reasonable window
      const dd = daysBetween(todayIso, due)
      if (dd < -(backMonths + 2) * 31 || dd > (fwdMonths + 4) * 31) continue
      const done = artifactDone.has(`24q:q:${fy}:${q}`)
      out.push({
        id: `TDS-24Q:Central:${fy}-Q${q}`, compliance_type: 'TDS-24Q',
        label: `Form 24Q (TDS return) — ${fy} Q${q}`, jurisdiction: 'Central',
        period: `${fy} Q${q}`, period_label: `${fy} Q${q}`, due_date: due,
        status: statusFor(due, todayIso, done), days_to_due: dd, filed_at: null,
        reference: null,
      })
    }
  }

  // Sort by due date ascending.
  out.sort((a, b) => a.due_date.localeCompare(b.due_date))
  return out
}

/** Deadlines that are not yet completed and fall due within `withinDays`, plus all overdue. */
export async function computeUpcoming(
  supabase: SupabaseClient,
  tenantId: string,
  withinDays = 30,
  today?: Date,
): Promise<ComplianceDeadline[]> {
  const all = await computeComplianceCalendar(supabase, tenantId, { today })
  return all.filter(d => d.status !== 'completed' && (d.status === 'overdue' || d.days_to_due <= withinDays))
}
