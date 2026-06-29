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

// Days from first_ua_date that trigger each escalation.
const THRESHOLDS = { flag: 3, wl1: 7, wl2: 14, termination: 21 } as const

export interface ScanResult {
  tenant_id:    string
  cases_opened: number
  cases_wl1:    number
  cases_wl2:    number
  cases_term:   number
  errors:       string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  const from = new Date(dateStr)
  const now  = new Date()
  from.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((now.getTime() - from.getTime()) / 86_400_000))
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function responseDeadlineISO(days = 7): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function buildRefNumber(tenantId: string, caseId: string): string {
  const prefix = tenantId.slice(0, 4).toUpperCase()
  const suffix = caseId.slice(-6).toUpperCase()
  return `${prefix}-ABSC-${suffix}`
}

// Counts consecutive UA (unauthorised absence) days ending today.
// Uses attendance_records where final_status = 'A' (absent/UA) or similar.
async function getConsecutiveUaDays(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  fromDate: string,
): Promise<number> {
  const { data } = await supabase
    .from('attendance_records')
    .select('date, final_status')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .gte('date', fromDate)
    .lte('date', todayISO())
    .order('date', { ascending: false })

  if (!data?.length) return 0

  let count = 0
  const today = new Date(todayISO())

  for (const rec of data as { date: string; final_status: string }[]) {
    const expected = new Date(today)
    expected.setDate(today.getDate() - count)
    const recDate = new Date(rec.date)
    // Allow weekends to not break the streak (optional — check if same diff)
    if (recDate.toISOString().slice(0, 10) !== expected.toISOString().slice(0, 10)) break
    if (['A', 'UA', 'absent'].includes(rec.final_status ?? '')) {
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

// ── Core operations ──────────────────────────────────────────────────────────

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

  const uaDays = await getConsecutiveUaDays(supabase, tenantId, employeeId, firstUaDate)

  const { data, error } = await supabase
    .from('absconding_cases')
    .insert({
      tenant_id:     tenantId,
      employee_id:   employeeId,
      status:        'flagged',
      first_ua_date: firstUaDate,
      last_ua_date:  todayISO(),
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

  const uaDays = await getConsecutiveUaDays(supabase, tenantId, employee_id, first_ua_date)
  await supabase
    .from('absconding_cases')
    .update({ ua_days_count: uaDays, last_ua_date: todayISO() })
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
  if (!['flagged'].includes(cas.status)) throw new Error(`Cannot send WL1 in status: ${cas.status}`)

  const refNumber = buildRefNumber(tenantId, caseId)
  const deadline  = responseDeadlineISO(7)

  // Insert a letter record via the letters table (existing pattern)
  const { data: letter } = await supabase
    .from('letters')
    .insert({
      tenant_id:       tenantId,
      employee_id:     cas.employee_id,
      template_code:   'absconding_wl1',
      status:          'generated',
      variables:       {
        absent_from_date:  cas.first_ua_date,
        absent_days:       String(cas.ua_days_count),
        response_deadline: deadline,
        ref_number:        refNumber,
      },
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

  const refNumber = buildRefNumber(tenantId, caseId) + '-WL2'
  const deadline  = responseDeadlineISO(7)

  const { data: letter } = await supabase
    .from('letters')
    .insert({
      tenant_id:     tenantId,
      employee_id:   cas.employee_id,
      template_code: 'absconding_wl2',
      status:        'generated',
      variables:     {
        absent_from_date:  cas.first_ua_date,
        absent_days:       String(cas.ua_days_count),
        response_deadline: deadline,
        ref_number:        refNumber,
      },
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
  const refNumber = buildRefNumber(tenantId, caseId) + '-TERM'

  const { data: letter } = await supabase
    .from('letters')
    .insert({
      tenant_id:     tenantId,
      employee_id:   cas.employee_id,
      template_code: 'absconding_termination',
      status:        'generated',
      variables:     {
        absent_from_date: cas.first_ua_date,
        absent_days:      String(cas.ua_days_count),
        ref_number:       refNumber,
      },
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
    newData:     { status: 'terminated', separation_id: sepId },
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
  const result: ScanResult = { tenant_id: tenantId, cases_opened: 0, cases_wl1: 0, cases_wl2: 0, cases_term: 0, errors: [] }

  // 1. Find employees with ≥3 consecutive UA days and no open case
  try {
    const threeAgo = new Date()
    threeAgo.setDate(threeAgo.getDate() - THRESHOLDS.flag)

    const { data: uaEmployees } = await supabase
      .from('attendance_records')
      .select('employee_id, date')
      .eq('tenant_id', tenantId)
      .in('final_status', ['A', 'UA', 'absent'])
      .lte('date', todayISO())
      .gte('date', threeAgo.toISOString().slice(0, 10))

    const candidateIds = [...new Set(((uaEmployees ?? []) as { employee_id: string }[]).map(r => r.employee_id))]

    for (const empId of candidateIds) {
      try {
        const uaDays = await getConsecutiveUaDays(supabase, tenantId, empId, threeAgo.toISOString().slice(0, 10))
        if (uaDays >= THRESHOLDS.flag) {
          const firstUa = new Date()
          firstUa.setDate(firstUa.getDate() - uaDays + 1)
          const opened = await openCase(supabase, tenantId, empId, firstUa.toISOString().slice(0, 10))
          if (opened) result.cases_opened++
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
      .in('status', ['flagged', 'wl1_sent', 'wl2_sent'])

    for (const c of (openCases ?? []) as { id: string; status: string; first_ua_date: string; ua_days_count: number; employee_id: string }[]) {
      try {
        await updateUaCount(supabase, c.id, tenantId)
        const days = daysSince(c.first_ua_date)

        if (c.status === 'flagged' && days >= THRESHOLDS.wl1) {
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
