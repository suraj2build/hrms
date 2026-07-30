/**
 * timeline-aggregator.ts — Phase O2: Timeline Aggregation Layer.
 *
 * Canonical merge point for employee journey events. Today it reads
 * onboarding_lifecycle_events; future phases add trust snapshots,
 * probation events, and confirmation decisions by extending mergeTimeline().
 *
 * All callers (timeline route, Employee 360, Workforce Command) go through
 * fetchTimeline() — so future enrichments reach every consumer automatically.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Public shape ──────────────────────────────────────────────────────────────

export type TimelineCategory =
  | 'milestone'
  | 'action'
  | 'verification'
  | 'approval'
  | 'exception'
  | 'system'

export type ReadinessDimension =
  | 'documents'
  | 'verification'
  | 'tasks'
  | 'approvals'
  | 'joining'
  | 'none'

export type TimelineSeverity = 'info' | 'success' | 'warning' | 'critical'

export interface TimelineItem {
  id:                  string
  occurred_at:         string
  event_type:          string
  title:               string
  description:         string | null
  actor_id:            string | null
  actor_name:          string | null
  source:              string
  category:            TimelineCategory
  severity:            TimelineSeverity
  readiness_dimension: ReadinessDimension
  is_milestone:        boolean
}

export interface TimelineResult {
  items:        TimelineItem[]
  total:        number
  session_id:   string | null
  employee_id:  string | null
}

// ── Query options ─────────────────────────────────────────────────────────────

export interface TimelineQueryOpts {
  tenantId:    string
  sessionId?:  string
  employeeId?: string
  limit?:      number
  offset?:     number
}

// ── Metadata tables ───────────────────────────────────────────────────────────

// G1 fix: semantic source attribution per event type
const SOURCE_MAP: Record<string, string> = {
  'onboarding.session.created':             'Onboarding',
  'onboarding.document.uploaded':           'Document Management',
  'onboarding.document.verified':           'Document Management',
  'onboarding.document.rejected':           'Document Management',
  'onboarding.session.extraction_complete': 'Document Management',
  'onboarding.session.approved':            'Workflow Engine',
  'onboarding.session.rejected':            'Workflow Engine',
  'onboarding.joining.completed':           'Onboarding',
  'onboarding.checklist.completed':         'Checklist Engine',
}

const CATEGORY_MAP: Record<string, TimelineCategory> = {
  'onboarding.session.created':             'action',
  'onboarding.document.uploaded':           'action',
  'onboarding.document.verified':           'verification',
  'onboarding.document.rejected':           'exception',
  'onboarding.session.extraction_complete': 'system',
  'onboarding.session.approved':            'approval',
  'onboarding.session.rejected':            'exception',
  'onboarding.joining.completed':           'milestone',
  'onboarding.checklist.completed':         'milestone',
}

const READINESS_MAP: Record<string, ReadinessDimension> = {
  'onboarding.session.created':             'none',
  'onboarding.document.uploaded':           'documents',
  'onboarding.document.verified':           'verification',
  'onboarding.document.rejected':           'verification',
  'onboarding.session.extraction_complete': 'documents',
  'onboarding.session.approved':            'approvals',
  'onboarding.session.rejected':            'approvals',
  'onboarding.joining.completed':           'joining',
  'onboarding.checklist.completed':         'tasks',
}

const MILESTONE_EVENTS = new Set([
  'onboarding.session.approved',
  'onboarding.joining.completed',
  'onboarding.checklist.completed',
])

// ── Core fetch ────────────────────────────────────────────────────────────────

/**
 * Fetch the canonical employee journey timeline.
 * Currently sourced from onboarding_lifecycle_events.
 * Extend mergeTimeline() to add future event sources.
 */
export async function fetchTimeline(
  supabase: SupabaseClient,
  opts:     TimelineQueryOpts,
): Promise<TimelineResult> {
  const { tenantId, sessionId, employeeId, limit = 100, offset = 0 } = opts

  if (!sessionId && !employeeId) {
    return { items: [], total: 0, session_id: null, employee_id: null }
  }

  // ── 1. Query lifecycle events ─────────────────────────────────────────────
  //
  // G2 fix: when querying by employeeId, pre-joining events (document.uploaded,
  // document.verified, etc.) have employee_id=null because the employee record
  // didn't exist yet. We resolve the session_id(s) from existing events that DO
  // carry employee_id, then re-query by session_id to get the full timeline.

  let resolvedSessionIds: string[] = []
  if (employeeId && !sessionId) {
    const { data: linked, error: linkedError } = await supabase
      .from('onboarding_lifecycle_events')
      .select('session_id')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .not('session_id', 'is', null)
    if (linkedError) throw new Error(`timeline_session_resolve_failed: ${linkedError.message}`)
    resolvedSessionIds = [...new Set((linked ?? []).map((r: any) => r.session_id as string).filter(Boolean))]
  }

  let query = supabase
    .from('onboarding_lifecycle_events')
    .select('*', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('occurred_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (sessionId) {
    query = query.eq('session_id', sessionId)
  } else if (resolvedSessionIds.length > 0) {
    query = query.in('session_id', resolvedSessionIds)
  } else if (employeeId) {
    query = query.eq('employee_id', employeeId)
  }

  const { data: rows, count, error } = await query

  if (error) throw new Error(`timeline_query_failed: ${error.message}`)

  const rawRows = (rows ?? []) as RawRow[]

  // ── 2. Collect actor IDs for name enrichment ──────────────────────────────
  const actorIds = [...new Set(rawRows.map(r => r.actor_id).filter(Boolean) as string[])]
  const actorMap = await resolveActorNames(supabase, tenantId, actorIds)

  // ── 3. Map rows → canonical TimelineItem ─────────────────────────────────
  const onboardingItems: TimelineItem[] = rawRows.map(r => mapRow(r, actorMap))

  // ── 4. Future merge point — add trust snapshots, probation events, etc. ──
  const items = mergeTimeline(onboardingItems)

  // ── 5. Re-sort after merge ────────────────────────────────────────────────
  items.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))

  return {
    items,
    total:       count ?? items.length,
    session_id:  sessionId  ?? null,
    employee_id: employeeId ?? null,
  }
}

// ── Row type (matches onboarding_lifecycle_events columns) ────────────────────

interface RawRow {
  id:          string
  tenant_id:   string
  event_type:  string
  session_id:  string | null
  employee_id: string | null
  draft_id:    string | null
  document_id: string | null
  actor_id:    string | null
  title:       string
  detail:      Record<string, unknown> | null
  severity:    TimelineSeverity
  occurred_at: string
  created_at:  string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapRow(r: RawRow, actorMap: Map<string, string>): TimelineItem {
  const detail    = r.detail ?? {}
  const actorName = r.actor_id ? (actorMap.get(r.actor_id) ?? null) : null

  // Build description from detail fields where useful
  const description = buildDescription(r.event_type, detail)

  return {
    id:                  r.id,
    occurred_at:         r.occurred_at,
    event_type:          r.event_type,
    title:               r.title,
    description,
    actor_id:            r.actor_id,
    actor_name:          actorName,
    source:              SOURCE_MAP[r.event_type] ?? 'Onboarding',
    category:            CATEGORY_MAP[r.event_type]  ?? 'system',
    severity:            r.severity,
    readiness_dimension: READINESS_MAP[r.event_type] ?? 'none',
    is_milestone:        MILESTONE_EVENTS.has(r.event_type),
  }
}

function buildDescription(
  eventType: string,
  detail:    Record<string, unknown>,
): string | null {
  switch (eventType) {
    case 'onboarding.document.rejected':
      return detail.reason ? `Reason: ${detail.reason}` : null
    case 'onboarding.session.approved':
      return detail.exceptionPass ? 'Approved with manual exception override' : null
    case 'onboarding.session.rejected':
      return detail.reason ? `Reason: ${detail.reason}` : null
    case 'onboarding.session.extraction_complete':
      return detail.docCount != null ? `${detail.docCount} document(s) processed` : null
    case 'onboarding.joining.completed':
      return detail.joiningDate ? `Joining date: ${detail.joiningDate}` : null
    default:
      return null
  }
}

async function resolveActorNames(
  supabase:  SupabaseClient,
  tenantId:  string,
  actorIds:  string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (actorIds.length === 0) return map

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', actorIds)
  if (error) {
    console.warn('[timeline-aggregator] failed to resolve actor names:', error.message)
    return map
  }

  for (const p of data ?? []) {
    map.set(p.id, (p.full_name as string | null) ?? (p.email as string | null) ?? p.id)
  }
  return map
}

/**
 * Future merge point. Receives onboarding items; other phases insert their
 * own slices here (trust snapshots, probation, confirmation).
 * Must not sort — caller does final sort after merge.
 */
function mergeTimeline(onboarding: TimelineItem[]): TimelineItem[] {
  return [...onboarding]
}
