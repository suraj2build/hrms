/**
 * absconding-engine.ts
 *
 * State machine and daily scan logic for Absconding Case Management.
 *
 * State transitions:
 *   flagged (Day 3 UA) → wl1_sent (Day 7) → wl2_sent (Day 14)
 *   → termination_pending (Day 21) → terminated | resolved | closed
 *
 * Daily scan (called by job-queue scheduler):
 *   1. Scan attendance for employees with ≥3 consecutive UA days — open cases if none exist.
 *   2. For open cases: evaluate day count, trigger the appropriate next action.
 *   3. Notify HR admins at each escalation step.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from './notify.js'
import { logAction } from './audit-service.js'
import { generateLetterPDF, uploadPDF } from './pdf-generator.js'
import { revokeEmployeeAuth } from './user-account-service.js'
import { fetchTenantTz } from './attendance-engine.js'
import { getLocalDate } from './org-context.js'
import { fetchAllRows } from './supabase-paginate.js'

// Days from first_ua_date that trigger each escalation.
const THRESHOLDS = { flag: 3, second_escalation: 5, wl1: 7, wl2: 14, termination: 21 } as const

export interface ScanResult {
  tenant_id:      string
  cases_opened:   number
  cases_wl1:      number
  cases_wl2:      number
  cases_term:     number
  cases_scanned:  number
  errors:         string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────
//
// ISSUE-154: every date computation here used to run on the server's own
// clock/timezone (`new Date()` + local getters/setters like `.getDate()` /
// `.setHours()`), not the tenant's. Escalation is a day-count state machine
// (flag at 3, WL1 at 7, WL2 at 14, termination at 21) driving an eventual
// TERMINATION — a severe, hard-to-reverse HR action — so a day-boundary
// misalignment between the server's clock and the tenant's actual calendar
// (e.g. a UTC server vs. an Asia/Kolkata tenant, a 5.5h offset) could flag,
// escalate, or terminate up to a day earlier/later than the tenant's own
// calendar says, and out of step with attendance_daily's `date` column, which
// IS already tenant-local (via attendance-engine.ts's shift-aware resolution).
//
// Fixed by: (1) resolving "today" via the tenant's IANA timezone
// (fetchTenantTz + getLocalDate, the same helpers attendance-engine.ts uses),
// computed ONCE per scanAndEscalate() call and threaded through; (2) doing all
// day-count arithmetic on the resulting YYYY-MM-DD strings with explicit
// UTC-anchored Date methods (getUTCDate/setUTCDate), never local
// getDate/setDate/setHours, so the arithmetic itself can't drift with
// whatever timezone the Node process happens to be running in.

/** Add `days` (may be negative) to a YYYY-MM-DD date string. UTC-anchored —
 *  correct regardless of the server process's own timezone. Exported for
 *  unit testing; not otherwise used outside this module. */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days between two YYYY-MM-DD date strings (never negative). Exported
 *  for unit testing; not otherwise used outside this module. */
export function daysBetweenDateStrs(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00.000Z`).getTime()
  const to   = new Date(`${toStr}T00:00:00.000Z`).getTime()
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/** Tenant-local "today" as YYYY-MM-DD — never the server's own clock/TZ. */
async function todayISO(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const tz = await fetchTenantTz(supabase, tenantId)
  return getLocalDate(new Date().toISOString(), tz)
}

function daysSince(dateStr: string, todayStr: string): number {
  return daysBetweenDateStrs(dateStr, todayStr)
}

function responseDeadlineISO(todayStr: string, days = 7): string {
  return addDaysToDateStr(todayStr, days)
}

function buildRefNumber(tenantId: string, caseId: string): string {
  const prefix = tenantId.slice(0, 4).toUpperCase()
  const suffix = caseId.slice(-6).toUpperCase()
  return `${prefix}-ABSC-${suffix}`
}

// Counts consecutive UA (unauthorised absence) days ending today.
// attendance_daily is the single table every other attendance read/write path
// in this codebase uses (status column, lowercase values) — a prior version
// of this function queried a table named attendance_records, which does not
// exist anywhere in the schema, silently returning 0 with the query error
// discarded. Confirmed this ran daily in production (registered as the
// 'detect-absconding' durable-queue job) and did nothing since the divergence.
async function getConsecutiveUaDays(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  fromDate: string,
  todayStr: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('attendance_daily')
    .select('date, status')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', fromDate)
    .lte('date', todayStr)
    .order('date', { ascending: false })

  if (error) throw new Error(`getConsecutiveUaDays query failed: ${error.message}`)
  if (!data?.length) return 0

  let count = 0

  for (const rec of data as { date: string; status: string }[]) {
    const expected = addDaysToDateStr(todayStr, -count)
    // Allow weekends to not break the streak (optional — check if same diff)
    if (String(rec.date).slice(0, 10) !== expected) break
    if (rec.status === 'absent') {
      count++
    } else {
      break
    }
  }
  return count
}

// Fetch all HR admin profile IDs for a tenant (for notifications).
async function getHrAdminProfileIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['hr_admin', 'hr_manager', 'owner'])
  return ((data ?? []) as { id: string }[]).map(p => p.id)
}

// Fetch merge field data for letter generation
async function getLetterMergeFields(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
): Promise<Record<string, string>> {
  const { data: emp } = await supabase
    .from('employees')
    .select(`
      first_name, last_name, employee_code, designation:designations(name),
      work_locations(name),
      manager:employees!manager_id(first_name, last_name)
    `)
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .single()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .single()

  const e = emp as any
  const managerName = e?.manager
    ? `${e.manager.first_name ?? ''} ${e.manager.last_name ?? ''}`.trim()
    : 'HR Manager'

  return {
    employee_name:  `${e?.first_name ?? ''} ${e?.last_name ?? ''}`.trim(),
    employee_code:  e?.employee_code ?? '',
    designation:    (e?.designation as any)?.name ?? '',
    store_name:     e?.work_locations?.name ?? 'Head Office',
    manager_name:   managerName,
    company_name:   (tenant as any)?.name ?? 'CognixHR',
  }
}

// ── Core operations ──────────────────────────────────────────────────────────

/** Early alert: employee has 1-2 UA days — notify HR without opening a case. */
export async function notifyEarlyUA(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  uaDays:     number,
): Promise<void> {
  const hrIds = await getHrAdminProfileIds(supabase, tenantId)
  const { data: emp } = await supabase
    .from('employees')
    .select('first_name, last_name, employee_code')
    .eq('id', employeeId)
    .single()
  const empName = emp ? `${(emp as any).first_name} ${(emp as any).last_name}` : employeeId

  await Promise.all(hrIds.map(id =>
    notify(supabase, {
      tenantId,
      recipientId:  id,
      item_type:    'incident_alert',
      title:        'Early UA alert',
      summary:      `${empName} has been absent without authorisation for ${uaDays} day(s). No case opened yet — watch for continuation.`,
      severity:     'info',
      entity_type:  'employees',
      entity_id:    employeeId,
      action_route: `/admin/attendance`,
    })
  ))
}

/** Day-5 escalation: case is flagged (Day 3) and now 5 days have passed — escalate to second_escalation. */
export async function escalateSecond(
  supabase:  SupabaseClient,
  caseId:    string,
  tenantId:  string,
): Promise<void> {
  await supabase
    .from('absconding_cases')
    .update({ status: 'second_escalation' })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)

  const { data: c } = await supabase
    .from('absconding_cases')
    .select('employee_id, ua_days_count')
    .eq('id', caseId)
    .single()

  const hrIds = await getHrAdminProfileIds(supabase, tenantId)
  await Promise.all(hrIds.map(id =>
    notify(supabase, {
      tenantId,
      recipientId:  id,
      item_type:    'escalation',
      title:        'Absconding — Day 5 escalation',
      summary:      `Employee has now been absent for ${(c as any)?.ua_days_count ?? 5} consecutive days. Warning Letter 1 will be issued at Day 7 if no response.`,
      severity:     'warning',
      entity_type:  'absconding_cases',
      entity_id:    caseId,
      action_route: `/admin/absconding?case=${caseId}`,
    })
  ))
}

export async function openCase(
  supabase:   SupabaseClient,
  tenantId:   string,
  employeeId: string,
  firstUaDate: string,
  createdBy:  string = 'system',
): Promise<string | null> {
  // Prevent duplicate open cases per employee
  const { data: existing } = await supabase
    .from('absconding_cases')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .not('status', 'in', '("terminated","resolved","closed")')
    .maybeSingle()

  if (existing) return (existing as { id: string }).id

  const todayStr = await todayISO(supabase, tenantId)
  const uaDays = await getConsecutiveUaDays(supabase, tenantId, employeeId, firstUaDate, todayStr)

  const { data, error } = await supabase
    .from('absconding_cases')
    .insert({
      tenant_id:     tenantId,
      employee_id:   employeeId,
      status:        'flagged',
      first_ua_date: firstUaDate,
      last_ua_date:  todayStr,
      ua_days_count: uaDays,
      created_by:    createdBy,
    })
    .select('id')
    .single()

  if (error || !data) return null

  const caseId = (data as { id: string }).id

  // Log comm event
  await supabase.from('absconding_communications').insert({
    case_id:   caseId,
    tenant_id: tenantId,
    comm_type: 'system_event',
    direction: 'internal',
    subject:   'Case opened by system',
    body:      `Consecutive UA days detected: ${uaDays}. First UA date: ${firstUaDate}.`,
    metadata:  { ua_days: uaDays, first_ua_date: firstUaDate },
  })

  // Notify HR admins
  const hrIds = await getHrAdminProfileIds(supabase, tenantId)
  await Promise.all(hrIds.map(id =>
    notify(supabase, {
      tenantId,
      recipientId:  id,
      item_type:    'escalation',
      title:        'Absconding case flagged',
      summary:      `Employee has been absent without authorisation for ${uaDays} consecutive days. Case opened for review.`,
      severity:     'warning',
      entity_type:  'absconding_cases',
      entity_id:    caseId,
      action_route: `/admin/absconding?case=${caseId}`,
    })
  ))

  return caseId
}

export async function updateUaCount(
  supabase:  SupabaseClient,
  caseId:    string,
  tenantId:  string,
): Promise<void> {
  const { data: c } = await supabase
    .from('absconding_cases')
    .select('employee_id, first_ua_date')
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .single()

  if (!c) return
  const { employee_id, first_ua_date } = c as { employee_id: string; first_ua_date: string }

  const todayStr = await todayISO(supabase, tenantId)
  const uaDays = await getConsecutiveUaDays(supabase, tenantId, employee_id, first_ua_date, todayStr)
  await supabase
    .from('absconding_cases')
    .update({ ua_days_count: uaDays, last_ua_date: todayStr })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
}

export async function sendWarningLetter1(
  supabase:  SupabaseClient,
  caseId:    string,
  tenantId:  string,
  hrUserId:  string,
): Promise<void> {
  const { data: c } = await supabase
    .from('absconding_cases')
    .select('id, employee_id, first_ua_date, ua_days_count, status')
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .single()

  if (!c) throw new Error('Case not found')
  const cas = c as { id: string; employee_id: string; first_ua_date: string; ua_days_count: number; status: string }
  if (!['flagged', 'second_escalation'].includes(cas.status)) throw new Error(`Cannot send WL1 in status: ${cas.status}`)

  const todayStr    = await todayISO(supabase, tenantId)
  const refNumber   = buildRefNumber(tenantId, caseId)
  const deadline    = responseDeadlineISO(todayStr, 7)
  const mergeFields = await getLetterMergeFields(supabase, tenantId, cas.employee_id)

  // Generate PDF
  let pdfUrl: string | null = null
  try {
    const pdfBuffer = await generateLetterPDF({
      type:      'wl1',
      tenantId,
      refNumber,
      dateStr:   todayStr,
      variables: {
        ...mergeFields,
        absent_from_date:  cas.first_ua_date,
        absent_days:       String(cas.ua_days_count),
        response_deadline: deadline,
        ref_number:        refNumber,
      },
    })
    pdfUrl = await uploadPDF(pdfBuffer, `absconding/${caseId}/wl1-${todayStr}.pdf`, supabase)
  } catch (_) { /* non-blocking */ }

  // Insert a letter record via the letters table (existing pattern)
  const { data: letter } = await supabase
    .from('letters')
    .insert({
      tenant_id:       tenantId,
      employee_id:     cas.employee_id,
      template_code:   'absconding_wl1',
      status:          'generated',
      variables:       {
        ...mergeFields,
        absent_from_date:  cas.first_ua_date,
        absent_days:       String(cas.ua_days_count),
        response_deadline: deadline,
        ref_number:        refNumber,
      },
      pdf_url:         pdfUrl,
      generated_by:    hrUserId,
      generated_at:    new Date().toISOString(),
    })
    .select('id')
    .single()

  const letterId = (letter as { id: string } | null)?.id ?? null

  await supabase
    .from('absconding_cases')
    .update({
      status:       'wl1_sent',
      wl1_sent_at:  new Date().toISOString(),
      wl1_letter_id: letterId,
    })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)

  await supabase.from('absconding_communications').insert({
    case_id:   caseId,
    tenant_id: tenantId,
    comm_type: 'letter_generated',
    direction: 'outbound',
    subject:   `Warning Letter 1 issued (Ref: ${refNumber})`,
    body:      `WL1 generated. Response deadline: ${deadline}.`,
    sent_by:   hrUserId,
    letter_id: letterId,
    metadata:  { ref_number: refNumber, response_deadline: deadline },
  })

  await logAction(supabase, {
    tenantId,
    tableName:   'absconding_cases',
    recordId:    caseId,
    action:      'UPDATE',
    performedBy: hrUserId,
    onBehalfOf:  cas.employee_id,
    newData:     { status: 'wl1_sent', ref_number: refNumber },
  })
}

export async function sendWarningLetter2(
  supabase:  SupabaseClient,
  caseId:    string,
  tenantId:  string,
  hrUserId:  string,
): Promise<void> {
  const { data: c } = await supabase
    .from('absconding_cases')
    .select('id, employee_id, first_ua_date, ua_days_count, status')
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .single()

  if (!c) throw new Error('Case not found')
  const cas = c as { id: string; employee_id: string; first_ua_date: string; ua_days_count: number; status: string }
  if (!['wl1_sent'].includes(cas.status)) throw new Error(`Cannot send WL2 in status: ${cas.status}`)

  const todayStr    = await todayISO(supabase, tenantId)
  const refNumber   = buildRefNumber(tenantId, caseId) + '-WL2'
  const deadline    = responseDeadlineISO(todayStr, 7)
  const mergeFields = await getLetterMergeFields(supabase, tenantId, cas.employee_id)

  let pdfUrl: string | null = null
  try {
    const pdfBuffer = await generateLetterPDF({
      type:      'wl2',
      tenantId,
      refNumber,
      dateStr:   todayStr,
      variables: {
        ...mergeFields,
        absent_from_date:  cas.first_ua_date,
        absent_days:       String(cas.ua_days_count),
        response_deadline: deadline,
        ref_number:        refNumber,
      },
    })
    pdfUrl = await uploadPDF(pdfBuffer, `absconding/${caseId}/wl2-${todayStr}.pdf`, supabase)
  } catch (_) { /* non-blocking */ }

  const { data: letter } = await supabase
    .from('letters')
    .insert({
      tenant_id:     tenantId,
      employee_id:   cas.employee_id,
      template_code: 'absconding_wl2',
      status:        'generated',
      variables:     {
        ...mergeFields,
        absent_from_date:  cas.first_ua_date,
        absent_days:       String(cas.ua_days_count),
        response_deadline: deadline,
        ref_number:        refNumber,
      },
      pdf_url:       pdfUrl,
      generated_by:  hrUserId,
      generated_at:  new Date().toISOString(),
    })
    .select('id')
    .single()

  const letterId = (letter as { id: string } | null)?.id ?? null

  await supabase
    .from('absconding_cases')
    .update({
      status:        'wl2_sent',
      wl2_sent_at:   new Date().toISOString(),
      wl2_letter_id: letterId,
    })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)

  await supabase.from('absconding_communications').insert({
    case_id:   caseId,
    tenant_id: tenantId,
    comm_type: 'letter_generated',
    direction: 'outbound',
    subject:   `Final Warning Letter 2 issued (Ref: ${refNumber})`,
    body:      `WL2 generated. Response deadline: ${deadline}. Next: termination pending.`,
    sent_by:   hrUserId,
    letter_id: letterId,
    metadata:  { ref_number: refNumber, response_deadline: deadline },
  })

  await logAction(supabase, {
    tenantId,
    tableName:   'absconding_cases',
    recordId:    caseId,
    action:      'UPDATE',
    performedBy: hrUserId,
    onBehalfOf:  cas.employee_id,
    newData:     { status: 'wl2_sent', ref_number: refNumber },
  })
}

export async function flagForTermination(
  supabase:  SupabaseClient,
  caseId:    string,
  tenantId:  string,
  actorId:   string = 'system',
): Promise<void> {
  const { data: c } = await supabase
    .from('absconding_cases')
    .select('id, employee_id, ua_days_count, status')
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .single()

  if (!c) throw new Error('Case not found')
  const cas = c as { id: string; employee_id: string; ua_days_count: number; status: string }
  if (!['wl2_sent'].includes(cas.status)) throw new Error(`Cannot flag termination in status: ${cas.status}`)

  await supabase
    .from('absconding_cases')
    .update({ status: 'termination_pending', chro_approval_required: true })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)

  await supabase.from('absconding_communications').insert({
    case_id:   caseId,
    tenant_id: tenantId,
    comm_type: 'system_event',
    direction: 'internal',
    subject:   'Escalated to termination — CHRO approval required',
    body:      `${cas.ua_days_count} days elapsed since first UA. WL1 + WL2 issued with no response. CHRO approval required to proceed.`,
    sent_by:   actorId !== 'system' ? actorId : undefined,
    metadata:  { ua_days: cas.ua_days_count },
  })

  // Notify CHRO/owner
  const { data: chroProfiles } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'chro'])

  await Promise.all(((chroProfiles ?? []) as { id: string }[]).map(p =>
    notify(supabase, {
      tenantId,
      recipientId:  p.id,
      item_type:    'approval_request',
      title:        'Absconding termination — approval required',
      summary:      `Employee has been absent for ${cas.ua_days_count} days. Both warning letters issued with no response. Your approval is required to proceed with termination.`,
      severity:     'critical',
      entity_type:  'absconding_cases',
      entity_id:    caseId,
      action_route: `/admin/absconding?case=${caseId}`,
      action_label: 'Review & Approve',
    })
  ))
}

export async function processTermination(
  supabase:    SupabaseClient,
  caseId:      string,
  tenantId:    string,
  chroUserId:  string,
  approved:    boolean,
  remarks:     string,
): Promise<void> {
  const { data: c } = await supabase
    .from('absconding_cases')
    .select('id, employee_id, first_ua_date, ua_days_count, status')
    .eq('id', caseId)
    .eq('tenant_id', tenantId)
    .single()

  if (!c) throw new Error('Case not found')
  const cas = c as { id: string; employee_id: string; first_ua_date: string; ua_days_count: number; status: string }
  if (cas.status !== 'termination_pending') throw new Error('Case is not pending termination approval')

  if (!approved) {
    // Rejection — put back to wl2_sent for HR to decide next action
    await supabase
      .from('absconding_cases')
      .update({
        status:           'wl2_sent',
        chro_approved_by: chroUserId,
        chro_approved_at: new Date().toISOString(),
        chro_remarks:     remarks,
      })
      .eq('id', caseId)
      .eq('tenant_id', tenantId)

    await supabase.from('absconding_communications').insert({
      case_id:   caseId,
      tenant_id: tenantId,
      comm_type: 'system_event',
      direction: 'internal',
      subject:   'Termination rejected by CHRO',
      body:      `Remarks: ${remarks}. Case returned to WL2 Sent status for HR review.`,
      sent_by:   chroUserId,
      metadata:  { approved: false, remarks },
    })
    return
  }

  // Approval — generate termination letter + create separation record
  const todayStr    = await todayISO(supabase, tenantId)
  const refNumber   = buildRefNumber(tenantId, caseId) + '-TERM'
  const mergeFields = await getLetterMergeFields(supabase, tenantId, cas.employee_id)

  let pdfUrl: string | null = null
  try {
    const pdfBuffer = await generateLetterPDF({
      type:      'termination',
      tenantId,
      refNumber,
      dateStr:   todayStr,
      variables: {
        ...mergeFields,
        absent_from_date: cas.first_ua_date,
        absent_days:      String(cas.ua_days_count),
        ref_number:       refNumber,
      },
    })
    pdfUrl = await uploadPDF(pdfBuffer, `absconding/${caseId}/termination-${todayStr}.pdf`, supabase)
  } catch (_) { /* non-blocking */ }

  const { data: letter } = await supabase
    .from('letters')
    .insert({
      tenant_id:     tenantId,
      employee_id:   cas.employee_id,
      template_code: 'absconding_termination',
      status:        'generated',
      variables:     {
        ...mergeFields,
        absent_from_date: cas.first_ua_date,
        absent_days:      String(cas.ua_days_count),
        ref_number:       refNumber,
      },
      pdf_url:       pdfUrl,
      generated_by:  chroUserId,
      generated_at:  new Date().toISOString(),
    })
    .select('id')
    .single()

  const letterId = (letter as { id: string } | null)?.id ?? null

  // Create separation record
  const { data: sep } = await supabase
    .from('employee_separation')
    .insert({
      tenant_id:        tenantId,
      employee_id:      cas.employee_id,
      separation_type:  'absconding',
      initiated_by:     'employer',
      exit_reason:      `Absconding — ${cas.ua_days_count} consecutive days UA. Two warning letters issued with no response.`,
      last_working_date: cas.first_ua_date, // treat first UA day as effective LWD
      created_by:        chroUserId,
    })
    .select('id')
    .single()

  const sepId = (sep as { id: string } | null)?.id ?? null

  // Update employee status to separated
  await supabase
    .from('employees')
    .update({ status: 'separated' })
    .eq('id', cas.employee_id)
    .eq('tenant_id', tenantId)

  // AF-001: revoke auth access — auto-termination reaches the same terminal
  // status as every other separation path and must revoke the same way.
  const authRevoked = await revokeEmployeeAuth(supabase, cas.employee_id, tenantId)

  // Check asset recovery requirement
  const { data: caseData } = await supabase
    .from('absconding_cases')
    .select('asset_recovery_required')
    .eq('id', caseId)
    .single()

  // Close the case
  await supabase
    .from('absconding_cases')
    .update({
      status:                 'terminated',
      termination_letter_id:  letterId,
      separation_id:          sepId,
      chro_approved_by:       chroUserId,
      chro_approved_at:       new Date().toISOString(),
      chro_remarks:           remarks,
    })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)

  // Auto-flag FnF in the separation record
  if (sepId) {
    await supabase
      .from('employee_separation')
      .update({ fnf_status: 'pending' })
      .eq('id', sepId)
      .eq('tenant_id', tenantId)
  }

  // Notify HR if asset recovery is required
  if ((caseData as any)?.asset_recovery_required) {
    const hrIds = await getHrAdminProfileIds(supabase, tenantId)
    await Promise.all(hrIds.map(id =>
      notify(supabase, {
        tenantId,
        recipientId:  id,
        item_type:    'general',
        title:        'Asset recovery required',
        summary:      `Employee ${cas.employee_id} has been terminated. Asset recovery is marked as required. Please follow up to retrieve company assets.`,
        severity:     'warning',
        entity_type:  'absconding_cases',
        entity_id:    caseId,
        action_route: `/admin/absconding?case=${caseId}`,
      })
    ))
  }

  await supabase.from('absconding_communications').insert({
    case_id:   caseId,
    tenant_id: tenantId,
    comm_type: 'letter_generated',
    direction: 'outbound',
    subject:   `Termination letter issued (Ref: ${refNumber})`,
    body:      `CHRO approved termination. Separation record created. FnF processing will follow.`,
    sent_by:   chroUserId,
    letter_id: letterId,
    metadata:  { approved: true, separation_id: sepId, ref_number: refNumber, remarks },
  })

  await logAction(supabase, {
    tenantId,
    tableName:   'absconding_cases',
    recordId:    caseId,
    action:      'UPDATE',
    performedBy: chroUserId,
    onBehalfOf:  cas.employee_id,
    newData:     { status: 'terminated', separation_id: sepId, auth_revoked: authRevoked },
  })
}

export async function resolveCase(
  supabase:  SupabaseClient,
  caseId:    string,
  tenantId:  string,
  hrUserId:  string,
  reason:    string,
  newStatus: 'resolved' | 'closed' = 'resolved',
): Promise<void> {
  await supabase
    .from('absconding_cases')
    .update({ status: newStatus, resolved_reason: reason })
    .eq('id', caseId)
    .eq('tenant_id', tenantId)

  await supabase.from('absconding_communications').insert({
    case_id:   caseId,
    tenant_id: tenantId,
    comm_type: 'system_event',
    direction: 'internal',
    subject:   newStatus === 'resolved' ? 'Case resolved — employee returned / situation clarified' : 'Case closed',
    body:      reason,
    sent_by:   hrUserId,
    metadata:  { status: newStatus, reason },
  })

  await logAction(supabase, {
    tenantId,
    tableName:   'absconding_cases',
    recordId:    caseId,
    action:      'UPDATE',
    performedBy: hrUserId,
    newData:     { status: newStatus, resolved_reason: reason },
  })
}

// ── Daily scan ───────────────────────────────────────────────────────────────

export async function scanAndEscalate(
  supabase:  SupabaseClient,
  tenantId:  string,
): Promise<ScanResult> {
  const result: ScanResult = { tenant_id: tenantId, cases_opened: 0, cases_wl1: 0, cases_wl2: 0, cases_term: 0, cases_scanned: 0, errors: [] }
  const todayStr = await todayISO(supabase, tenantId)

  // 1. Find employees with ≥1 consecutive UA day — early alert at 1-2, flag at 3+
  try {
    const windowStart = addDaysToDateStr(todayStr, -(THRESHOLDS.termination + 1))

    // fetchAllRows() (not a plain query) — fresh audit finding: this is
    // attendance_daily ROWS (one per employee per absent day in a ~22-day
    // window), not employees, so a tenant with enough absences can exceed
    // PostgREST's 1,000-row ceiling. Employees whose absent-day rows fall
    // past the cutoff never get evaluated for getConsecutiveUaDays that
    // scan, so a genuinely-qualifying employee could simply not get an
    // absconding case opened/escalated that day (self-heals on a later run
    // once other absences roll off the window, but still a real miss in a
    // compliance-sensitive path).
    const uaEmployees = await fetchAllRows((from, to) =>
      supabase
        .from('attendance_daily')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('status', 'absent')
        .lte('date', todayStr)
        .gte('date', windowStart)
        .range(from, to),
    )

    const candidateIds = [...new Set(uaEmployees.map((r: any) => r.employee_id as string))]

    // Track employees with already-open cases (skip them)
    const { data: existingCases } = await supabase
      .from('absconding_cases')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .not('status', 'in', '("terminated","resolved","closed")')
    const openCaseEmployees = new Set(((existingCases ?? []) as { employee_id: string }[]).map(c => c.employee_id))

    for (const empId of candidateIds) {
      if (openCaseEmployees.has(empId)) continue
      try {
        const uaDays = await getConsecutiveUaDays(supabase, tenantId, empId, windowStart, todayStr)
        if (uaDays >= THRESHOLDS.flag) {
          const firstUaDate = addDaysToDateStr(todayStr, -(uaDays - 1))
          const opened = await openCase(supabase, tenantId, empId, firstUaDate)
          if (opened) result.cases_opened++
        } else if (uaDays >= 1) {
          // Early UA alert (1-2 days) — notify HR but don't open case
          await notifyEarlyUA(supabase, tenantId, empId, uaDays)
        }
      } catch (e) {
        result.errors.push(`openCase ${empId}: ${e}`)
      }
    }
  } catch (e) {
    result.errors.push(`scan phase 1: ${e}`)
  }

  // 2. Process open cases — advance state machine
  try {
    const { data: openCases } = await supabase
      .from('absconding_cases')
      .select('id, status, first_ua_date, ua_days_count, employee_id')
      .eq('tenant_id', tenantId)
      .in('status', ['flagged', 'second_escalation', 'wl1_sent', 'wl2_sent'])

    result.cases_scanned = (openCases ?? []).length

    for (const c of (openCases ?? []) as { id: string; status: string; first_ua_date: string; ua_days_count: number; employee_id: string }[]) {
      try {
        await updateUaCount(supabase, c.id, tenantId)
        const days = daysSince(c.first_ua_date, todayStr)

        if (c.status === 'flagged' && days >= THRESHOLDS.second_escalation) {
          await escalateSecond(supabase, c.id, tenantId)
        } else if ((c.status === 'flagged' || c.status === 'second_escalation') && days >= THRESHOLDS.wl1) {
          await sendWarningLetter1(supabase, c.id, tenantId, 'system')
          result.cases_wl1++
        } else if (c.status === 'wl1_sent' && days >= THRESHOLDS.wl2) {
          await sendWarningLetter2(supabase, c.id, tenantId, 'system')
          result.cases_wl2++
        } else if (c.status === 'wl2_sent' && days >= THRESHOLDS.termination) {
          await flagForTermination(supabase, c.id, tenantId, 'system')
          result.cases_term++
        }
      } catch (e) {
        result.errors.push(`case ${c.id}: ${e}`)
      }
    }
  } catch (e) {
    result.errors.push(`scan phase 2: ${e}`)
  }

  return result
}
