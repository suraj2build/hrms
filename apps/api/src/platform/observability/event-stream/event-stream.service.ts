/**
 * EventStreamService — read-only observability layer over platform_events.
 *
 * CRITICAL: This service NEVER mutates data.
 * It provides views over the event store for operational visibility.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedPlatformEvent } from '../../events/types/platform-event.js'
import { fetchAllRows } from '../../../lib/supabase-paginate.js'

export interface EventStreamQuery {
  tenant_id:         string
  event_type?:    string
  module?:        string
  entity_type?:   string
  entity_id?:     string
  actor_id?:      string
  correlation_id?: string
  from?:          string   // ISO timestamp
  to?:            string   // ISO timestamp
  severity?:      string
  limit?:         number
  offset?:        number
}

export interface EventStreamPage {
  events: ResolvedPlatformEvent[]
  total:  number
  limit:  number
  offset: number
}

export interface CorrelationChain {
  correlation_id: string
  events:         ResolvedPlatformEvent[]
  root_event?:    ResolvedPlatformEvent
}

export class EventStreamService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Query the platform event stream with filters.
   */
  async query(q: EventStreamQuery): Promise<EventStreamPage> {
    const limit  = Math.min(q.limit  ?? 50, 200)
    const offset = q.offset ?? 0

    let query = this.supabase
      .from('platform_events')
      .select('*', { count: 'exact' })
      .eq('tenant_id', q.tenant_id)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1)

    if (q.event_type)    query = query.eq('event_type', q.event_type)
    if (q.module)        query = query.eq('module', q.module)
    if (q.entity_type)   query = query.eq('entity_type', q.entity_type)
    if (q.entity_id)     query = query.eq('entity_id', q.entity_id)
    if (q.actor_id)      query = query.eq('actor_id', q.actor_id)
    if (q.correlation_id) query = query.eq('correlation_id', q.correlation_id)
    if (q.severity)      query = query.eq('severity', q.severity)
    if (q.from)          query = query.gte('timestamp', q.from)
    if (q.to)            query = query.lte('timestamp', q.to)

    const { data, error, count } = await query

    if (error) throw new Error(`EventStreamService.query failed: ${error.message}`)

    return {
      events: (data ?? []) as ResolvedPlatformEvent[],
      total:  count  ?? 0,
      limit,
      offset,
    }
  }

  /**
   * Fetch all events for a given correlation chain.
   */
  async getCorrelationChain(orgId: string, correlationId: string): Promise<CorrelationChain> {
    // Unpaginated .select() would silently cap at PostgREST's 1000-row
    // ceiling for a wide fan-out chain (e.g. a bulk payroll run tagging
    // every child event with the same correlation_id), producing an
    // incomplete trace with no error surfaced to the caller.
    const data = await fetchAllRows<ResolvedPlatformEvent>((from, to) =>
      this.supabase
        .from('platform_events')
        .select('*')
        .eq('tenant_id', orgId)
        .eq('correlation_id', correlationId)
        .order('timestamp', { ascending: true })
        .range(from, to),
    )

    const events = data
    const root   = events.find(e => !e.parent_event_id)

    return { correlation_id: correlationId, events, root_event: root }
  }

  /**
   * Get recent events for an entity (e.g. all events for employee X).
   */
  async getEntityTimeline(orgId: string, entityType: string, entityId: string, limit = 50): Promise<ResolvedPlatformEvent[]> {
    const { data, error } = await this.supabase
      .from('platform_events')
      .select('*')
      .eq('tenant_id', orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('timestamp', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`EventStreamService.getEntityTimeline failed: ${error.message}`)

    return (data ?? []) as ResolvedPlatformEvent[]
  }
}
