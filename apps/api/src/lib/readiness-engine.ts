/**
 * readiness-engine.ts — Phase O3: Onboarding Readiness Engine.
 *
 * Computes a single, explainable readiness score for every onboarding employee.
 * Sourced entirely from existing platform data — no new tables.
 *
 * 5 dimensions × equal weight (20% each):
 *   documents    — were required docs uploaded + extracted?
 *   verification — were docs accepted vs rejected?
 *   tasks        — are mandatory checklist tasks done?
 *   approvals    — did HR approve the session?
 *   joining      — were joining formalities completed?
 *
 * Status thresholds (configurable via opts.thresholds):
 *   ready    ≥ 90
 *   at_risk  60–89
 *   blocked  < 60
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Public types ──────────────────────────────────────────────────────────────

export type ReadinessStatus = 'ready' | 'at_risk' | 'blocked'
export type ReadinessDimensionKey = 'documents' | 'verification' | 'tasks' | 'approvals' | 'joining'

export interface ReadinessLineItem {
  text:   string
  status: 'complete' | 'pending' | 'blocked'
}

export interface DimensionScore {
  score:  number
  label:  'complete' | 'partial' | 'pending' | 'blocked' | 'na'
  items:  ReadinessLineItem[]
}

export interface ReadinessDimensions {
  documents:    DimensionScore
  verification: DimensionScore
  tasks:        DimensionScore
  approvals:    DimensionScore
  joining:      DimensionScore
}

export interface TrustSignal {
  score:    number
  severity: string
}

export interface ReadinessResult {
  session_id:      string | null
  employee_id:     string | null
  overall_score:   number
  status:          ReadinessStatus
  dimensions:      ReadinessDimensions
  blocking_items:  string[]
  completed_items: string[]
  last_updated:    string
  trust_signal:    TrustSignal | null  // independent — never merged into overall_score
}

export interface ReadinessOpts {
  tenantId:    string
  sessionId?:  string
  employeeId?: string
  thresholds?: { ready: number; at_risk: number }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function computeReadiness(
  supabase: SupabaseClient,
  opts:     ReadinessOpts,
): Promise<ReadinessResult> {
  const { tenantId, thresholds = { ready: 90, at_risk: 60 } } = opts
  let { sessionId, employeeId } = opts

  // Resolve session ↔ employee cross-reference
  if (!sessionId && !employeeId) {
    throw new Error('readiness_engine: sessionId or employeeId required')
  }

  if (!sessionId && employeeId) {
    // Find the most recent approved session for this employee via lifecycle events
    const { data: linked } = await supabase
      .from('onboarding_lifecycle_events')
      .select('session_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('event_type', 'onboarding.session.approved')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    sessionId = (linked as any)?.session_id ?? undefined
  }

  // Fetch all data in parallel
  const [sessionRow, documents, checklistData, lifecycleEvents, trustRow] = await Promise.all([
    sessionId
      ? supabase.from('onboarding_sessions').select('id, status').eq('id', sessionId).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null }),

    sessionId
      ? supabase.from('onboarding_documents').select('id, document_type, extraction_status, review_status').eq('session_id', sessionId).eq('tenant_id', tenantId)
      : Promise.resolve({ data: [] }),

    employeeId
      ? supabase.from('employee_onboarding_checklists')
          .select('id, status, employee_onboarding_tasks(id, title, is_mandatory, status)')
          .eq('employee_id', employeeId)
          .eq('tenant_id', tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    (sessionId || employeeId)
      ? supabase.from('onboarding_lifecycle_events')
          .select('event_type, occurred_at')
          .eq('tenant_id', tenantId)
          .in('event_type', [
            'onboarding.document.verified', 'onboarding.document.rejected',
            'onboarding.session.approved',   'onboarding.session.rejected',
            'onboarding.joining.completed',  'onboarding.checklist.completed',
          ])
          .eq(sessionId ? 'session_id' : 'employee_id', (sessionId ?? employeeId) as string)
      : Promise.resolve({ data: [] }),

    // Trust signal — separate, never merged into readiness score
    sessionId
      ? supabase.from('workforce_trust_scores')
          .select('score, severity')
          .eq('tenant_id', tenantId)
          .eq('entity_id', sessionId)
          .eq('score_type', 'onboarding')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // A failed source must not silently read as "employee has none of this" —
  // that fabricates a low/blocked readiness score from a transient DB error
  // rather than real onboarding state.
  for (const [label, result] of [
    ['session', sessionRow], ['documents', documents], ['checklist', checklistData],
    ['lifecycle events', lifecycleEvents], ['trust score', trustRow],
  ] as const) {
    const err = (result as any).error
    if (err) throw new Error(`readiness_engine: failed to fetch ${label}: ${err.message}`)
  }

  const session      = (sessionRow as any).data
  const docs         = ((documents as any).data ?? []) as DocRow[]
  const checklist    = (checklistData as any).data as ChecklistRow | null
  const events       = ((lifecycleEvents as any).data ?? []) as EventRow[]
  const eventTypes   = new Set(events.map((e: EventRow) => e.event_type))
  const trustData    = (trustRow as any).data as { score: number; severity: string } | null

  const now = new Date().toISOString()

  // ── Dimension 1: Documents ────────────────────────────────────────────────
  const docsDim = computeDocumentsDimension(docs)

  // ── Dimension 2: Verification ─────────────────────────────────────────────
  const verificationDim = computeVerificationDimension(docs, eventTypes)

  // ── Dimension 3: Tasks ────────────────────────────────────────────────────
  const tasksDim = computeTasksDimension(checklist)

  // ── Dimension 4: Approvals ────────────────────────────────────────────────
  const approvalsDim = computeApprovalsDimension(session, eventTypes)

  // ── Dimension 5: Joining ──────────────────────────────────────────────────
  const joiningDim = computeJoiningDimension(session, eventTypes)

  // ── Overall ───────────────────────────────────────────────────────────────
  const dimensions: ReadinessDimensions = {
    documents:    docsDim,
    verification: verificationDim,
    tasks:        tasksDim,
    approvals:    approvalsDim,
    joining:      joiningDim,
  }

  const overallScore = computeOverall(dimensions)
  const status       = readinessStatus(overallScore, thresholds)

  // ── Explanation lists ─────────────────────────────────────────────────────
  const blocking_items:  string[] = []
  const completed_items: string[] = []

  for (const [, dim] of Object.entries(dimensions)) {
    for (const item of (dim as DimensionScore).items) {
      if (item.status === 'complete')            completed_items.push(item.text)
      else if (item.status === 'blocked' || item.status === 'pending') blocking_items.push(item.text)
    }
  }

  return {
    session_id:      sessionId  ?? null,
    employee_id:     employeeId ?? null,
    overall_score:   overallScore,
    status,
    dimensions,
    blocking_items,
    completed_items,
    last_updated:    now,
    trust_signal:    trustData
      ? { score: Math.round(Number(trustData.score) * 100), severity: trustData.severity }
      : null,
  }
}

// ── Dimension helpers ─────────────────────────────────────────────────────────

interface DocRow {
  id:                string
  document_type:     string
  extraction_status: string
  review_status:     string
}

interface ChecklistRow {
  id:     string
  status: string
  employee_onboarding_tasks: TaskRow[]
}

interface TaskRow {
  id:           string
  title:        string
  is_mandatory: boolean
  status:       string
}

interface EventRow {
  event_type:   string
  occurred_at:  string
}

function computeDocumentsDimension(docs: DocRow[]): DimensionScore {
  if (docs.length === 0) {
    return {
      score: 0,
      label: 'pending',
      items: [{ text: 'No documents uploaded yet', status: 'pending' }],
    }
  }

  const items: ReadinessLineItem[] = []
  let doneCount = 0

  for (const doc of docs) {
    const done = doc.extraction_status === 'extracted' || doc.extraction_status === 'skipped'
    if (done) {
      items.push({ text: `${formatDocType(doc.document_type)} uploaded`, status: 'complete' })
      doneCount++
    } else if (doc.extraction_status === 'failed') {
      items.push({ text: `${formatDocType(doc.document_type)} extraction failed`, status: 'blocked' })
    } else {
      items.push({ text: `${formatDocType(doc.document_type)} pending extraction`, status: 'pending' })
    }
  }

  const score = Math.round((doneCount / docs.length) * 100)
  return { score, label: scoreLabel(score), items }
}

function computeVerificationDimension(docs: DocRow[], eventTypes: Set<string>): DimensionScore {
  if (docs.length === 0) {
    return { score: 0, label: 'pending', items: [{ text: 'No documents to verify', status: 'pending' }] }
  }

  const items: ReadinessLineItem[] = []
  let approved = 0
  let rejected = 0

  for (const doc of docs) {
    if (doc.review_status === 'approved') {
      items.push({ text: `${formatDocType(doc.document_type)} verified`, status: 'complete' })
      approved++
    } else if (doc.review_status === 'rejected') {
      items.push({ text: `${formatDocType(doc.document_type)} rejected — resubmission required`, status: 'blocked' })
      rejected++
    } else if (doc.extraction_status === 'extracted' || doc.extraction_status === 'skipped') {
      // Document extracted but not yet reviewed
      items.push({ text: `${formatDocType(doc.document_type)} review pending`, status: 'pending' })
    }
  }

  // If any event shows extraction complete without document-level review data, treat as verified
  if (items.length === 0 && eventTypes.has('onboarding.document.verified')) {
    items.push({ text: 'Documents verified by extraction engine', status: 'complete' })
    approved = 1
  }

  const reviewedCount = approved + rejected
  if (reviewedCount === 0) {
    return { score: 0, label: 'pending', items: items.length > 0 ? items : [{ text: 'Document verification pending', status: 'pending' }] }
  }

  const score = Math.round((approved / reviewedCount) * 100)
  return { score, label: scoreLabel(score), items }
}

function computeTasksDimension(checklist: ChecklistRow | null): DimensionScore {
  if (!checklist) {
    return { score: 0, label: 'na', items: [{ text: 'No onboarding checklist assigned', status: 'pending' }] }
  }

  const tasks = (checklist.employee_onboarding_tasks ?? []) as TaskRow[]
  const mandatory = tasks.filter(t => t.is_mandatory)

  if (mandatory.length === 0) {
    return { score: 100, label: 'complete', items: [{ text: 'No mandatory tasks defined', status: 'complete' }] }
  }

  const items: ReadinessLineItem[] = []
  let done = 0

  for (const task of mandatory) {
    if (task.status === 'completed') {
      items.push({ text: task.title, status: 'complete' })
      done++
    } else if (task.status === 'skipped') {
      items.push({ text: `${task.title} (skipped)`, status: 'pending' })
    } else {
      items.push({ text: `${task.title} pending`, status: 'pending' })
    }
  }

  const score = Math.round((done / mandatory.length) * 100)
  return { score, label: scoreLabel(score), items }
}

function computeApprovalsDimension(
  session:    { status: string } | null,
  eventTypes: Set<string>,
): DimensionScore {
  const sessionStatus = session?.status ?? null
  const isApproved    = sessionStatus === 'approved' || sessionStatus === 'employee_created'
                        || eventTypes.has('onboarding.session.approved')
  const isRejected    = sessionStatus === 'rejected' || eventTypes.has('onboarding.session.rejected')

  if (isApproved) {
    return {
      score: 100, label: 'complete',
      items: [{ text: 'HR approval complete', status: 'complete' }],
    }
  }
  if (isRejected) {
    return {
      score: 0, label: 'blocked',
      items: [{ text: 'Onboarding session rejected — requires restart', status: 'blocked' }],
    }
  }

  const statusLabel = sessionStatus
    ? `HR review in progress (${sessionStatus.replace(/_/g, ' ')})`
    : 'HR approval pending'

  return {
    score: 0, label: 'pending',
    items: [{ text: statusLabel, status: 'pending' }],
  }
}

function computeJoiningDimension(
  session:    { status: string } | null,
  eventTypes: Set<string>,
): DimensionScore {
  const isEmployeeCreated = session?.status === 'employee_created'
                            || eventTypes.has('onboarding.joining.completed')

  if (isEmployeeCreated) {
    return {
      score: 100, label: 'complete',
      items: [{ text: 'Joining formalities complete', status: 'complete' }],
    }
  }

  return {
    score: 0, label: 'pending',
    items: [{ text: 'Joining formalities pending', status: 'pending' }],
  }
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function computeOverall(dim: ReadinessDimensions): number {
  const scores = [
    dim.documents.score,
    dim.verification.score,
    // Tasks: if 'na' (label), treat as not blocking — use 50 as neutral
    dim.tasks.label === 'na' ? 50 : dim.tasks.score,
    dim.approvals.score,
    dim.joining.score,
  ]
  const sum = scores.reduce((a, b) => a + b, 0)
  return Math.round(sum / scores.length)
}

function readinessStatus(score: number, thresholds: { ready: number; at_risk: number }): ReadinessStatus {
  if (score >= thresholds.ready)   return 'ready'
  if (score >= thresholds.at_risk) return 'at_risk'
  return 'blocked'
}

function scoreLabel(score: number): DimensionScore['label'] {
  if (score === 100) return 'complete'
  if (score > 0)     return 'partial'
  return 'pending'
}

function formatDocType(type: string): string {
  const MAP: Record<string, string> = {
    aadhaar:             'Aadhaar',
    pan:                 'PAN card',
    passport:            'Passport',
    driving_license:     'Driving licence',
    resume:              'Resume',
    offer_letter:        'Offer letter',
    experience_letter:   'Experience letter',
    relieving_letter:    'Relieving letter',
    joining_letter:      'Joining letter',
    salary_slip:         'Salary slip',
    compensation_letter: 'Compensation letter',
    bank_proof:          'Bank proof',
    pf_uan_document:     'PF / UAN document',
    esi_document:        'ESI document',
    tax_document:        'Tax document',
    other:               'Document',
  }
  return MAP[type] ?? type.replace(/_/g, ' ')
}
