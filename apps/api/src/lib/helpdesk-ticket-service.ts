/**
 * Helpdesk ticket creation — shared governed service.
 *
 * Single source of truth for "create a helpdesk ticket": AI category
 * detection, SLA resolution, the ticket row itself, the auto-acknowledgement
 * comment, best-effort WhatsApp ack, the audit-log entry, and the HR-admin
 * notification. Both POST /helpdesk/tickets (routes/helpdesk/index.ts) and the
 * AI assistant's create_helpdesk_ticket tool (lib/ai/assistant-tools.ts) call
 * this — the tool previously hand-rolled its own insert that skipped the
 * audit log and HR notification entirely.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyHrAdmins } from './notify.js'
import { logAction } from './audit-service.js'
import { WhatsAppProvider } from './whatsapp-provider.js'
import { resolveTicketSla } from './helpdesk-sla.js'

export const HELPDESK_CATEGORIES = ['payroll', 'leave', 'attendance', 'it', 'facilities', 'hr_policy', 'grievance', 'posh', 'compliance', 'other'] as const
export const HELPDESK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

const TEAM_MAP: Record<string, string> = {
  payroll:    'HR-Payroll',
  leave:      'HR-Operations',
  attendance: 'HR-Operations',
  it:         'IT-Support',
  facilities: 'Admin',
  posh:       'ICC',
  compliance: 'Compliance',
  hr_policy:  'HR-Operations',
  grievance:  'HR-Manager',
  other:      'HR-Operations',
}

export function detectCategory(text: string, currentCategory: string): { category: string; confidence: number; suggested_team: string } {
  const t = text.toLowerCase()
  const rules: [string[], string, number][] = [
    [['salary', 'payslip', 'pay', 'deduction', 'pf', 'esic', 'tds', 'tax', 'bonus', 'incentive', 'arrear'], 'payroll', 90],
    [['leave', 'absence', 'holiday', 'lop', 'comp off'], 'leave', 85],
    [['attendance', 'shift', 'overtime', 'punch', 'biometric'], 'attendance', 85],
    [['laptop', 'computer', 'system', 'software', 'access', 'login', 'password', 'email', 'network', 'printer', 'hardware', 'vpn'], 'it', 85],
    [['harassment', 'sexual', 'posh', 'icc'], 'posh', 95],
    [['statutory', 'compliance', 'labour law', 'epf filing', 'esic filing'], 'compliance', 85],
    [['policy', 'handbook', 'rule', 'notice period', 'probation'], 'hr_policy', 80],
    [['grievance', 'complaint', 'unfair', 'bully', 'discrimination'], 'grievance', 85],
    [['offer letter', 'form 16', 'experience letter', 'noc', 'relieving', 'certificate', 'document'], 'hr_policy', 80],
  ]
  for (const [keywords, category, conf] of rules) {
    if (keywords.some(k => t.includes(k))) {
      return { category, confidence: conf, suggested_team: TEAM_MAP[category] ?? 'HR-Operations' }
    }
  }
  const fallback = TEAM_MAP[currentCategory] ?? 'HR-Operations'
  return { category: currentCategory, confidence: 30, suggested_team: fallback }
}

export interface CreateHelpdeskTicketInput {
  tenantId:    string
  employeeId:  string
  userId:      string
  subject:     string
  description: string
  category:    string
  priority:    string
}

export type CreateHelpdeskTicketResult =
  | { ok: true; data: Record<string, unknown>; ticketId: string; ticketNumber: string; category: string; priority: string; slaResponseHours: number; slaResolutionHours: number }
  | { ok: false; error: unknown }

export async function createHelpdeskTicket(
  supabase: SupabaseClient,
  logger: { warn: (obj: unknown, msg: string) => void },
  input: CreateHelpdeskTicketInput,
): Promise<CreateHelpdeskTicketResult> {
  const aiResult = detectCategory(`${input.subject} ${input.description}`, input.category)
  const isDefaultCategory = input.category === 'other' || input.category === 'general'
  const effectiveCategory = aiResult.confidence >= 70 && isDefaultCategory ? aiResult.category : input.category

  const sla = await resolveTicketSla(supabase, input.tenantId, effectiveCategory, input.priority)

  const { data, error } = await supabase
    .from('helpdesk_tickets')
    .insert({
      tenant_id:             input.tenantId,
      subject:               input.subject,
      description:           input.description,
      category:              effectiveCategory,
      priority:              input.priority,
      status:                'open',
      employee_id:           input.employeeId,
      created_by:            input.userId,
      sla_hours:             sla.response_hours,
      sla_due_at:            sla.sla_due_at,
      resolution_due_at:     sla.resolution_due_at,
      ai_suggested_category: aiResult.category,
      ai_routing_confidence: aiResult.confidence,
      ai_suggested_team:     aiResult.suggested_team,
    })
    .select()
    .single()

  if (error || !data) return { ok: false, error }

  const ticketId     = (data as any).id as string
  const ticketNumber = ((data as any).ticket_number as string | undefined) ?? ticketId.slice(0, 8).toUpperCase()

  // Auto-acknowledgement system comment — author_role 'hr' is the established
  // convention for automated/system-generated comments in this table (see
  // helpdesk/index.ts's ticket-merge note), since 'system' fails the CHECK.
  const ackComment = `Your query has been received. Ticket ${ticketNumber} is assigned to our ${aiResult.suggested_team} team. Expected response within ${sla.response_hours}h, resolution within ${sla.resolution_hours}h.`
  const { error: ackErr } = await supabase.from('helpdesk_ticket_comments').insert({
    tenant_id:   input.tenantId,
    ticket_id:   ticketId,
    author_id:   input.userId,
    author_role: 'hr',
    body:        ackComment,
    is_internal: false,
  })
  if (ackErr) logger.warn({ err: ackErr, ticket_id: ticketId }, 'helpdesk: auto-acknowledgement comment insert failed')

  // WhatsApp auto-acknowledgement (best-effort — never block ticket creation success)
  const { data: empWithPhone } = await supabase
    .from('employees').select('phone').eq('id', input.employeeId).eq('tenant_id', input.tenantId).maybeSingle()
  if ((empWithPhone as any)?.phone) {
    try {
      const wa = new WhatsAppProvider(supabase)
      await wa.sendTemplate(input.tenantId, (empWithPhone as any).phone, 'ticket_acknowledgement', {
        ticket_number: ticketNumber,
        sla_hours:     String(sla.response_hours),
      })
    } catch (waErr) {
      logger.warn({ err: waErr }, 'helpdesk: WhatsApp acknowledgement failed — ticket still created')
    }
  }

  await logAction(supabase, {
    tenantId:    input.tenantId,
    tableName:   'helpdesk_tickets',
    recordId:    ticketId,
    action:      'INSERT',
    performedBy: input.userId,
    onBehalfOf:  input.employeeId,
    newData:     { subject: input.subject, category: input.category, priority: input.priority, status: 'open' },
  })

  // Notify HR admins (best-effort)
  await notifyHrAdmins(supabase, {
    tenantId:     input.tenantId,
    senderId:     input.userId,
    item_type:    'general',
    title:        `New helpdesk ticket: ${input.subject}`,
    summary:      `A ${input.priority} priority ${effectiveCategory} ticket was raised. Response SLA ${sla.response_hours}h, resolution ${sla.resolution_hours}h.${aiResult.confidence >= 70 ? ` AI routing: ${aiResult.category} (${aiResult.confidence}%).` : ''}`,
    severity:     input.priority === 'urgent' ? 'warning' : 'info',
    entity_type:  'helpdesk_ticket',
    entity_id:    ticketId,
    action_route: '/admin/helpdesk',
    action_label: 'Open helpdesk queue',
  })

  return {
    ok:                 true,
    data:               data as Record<string, unknown>,
    ticketId,
    ticketNumber,
    category:           effectiveCategory,
    priority:           input.priority,
    slaResponseHours:   sla.response_hours,
    slaResolutionHours: sla.resolution_hours,
  }
}
