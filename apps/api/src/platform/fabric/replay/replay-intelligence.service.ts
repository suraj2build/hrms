/**
 * ReplayIntelligenceService — enterprise operational reconstruction.
 * Replays governance/trust/automation events for a time window.
 * DETERMINISTIC AND READ-ONLY — never modifies production state.
 */
import { randomUUID }                    from 'crypto'
import type { SupabaseClient }           from '@supabase/supabase-js'
import type { ReplaySession }            from '../types/fabric-types.js'
import type { ResolvedPlatformEvent }    from '../../events/types/platform-event.js'

export class ReplayIntelligenceService {
  /**
   * Execute a replay session over a time window for an entity.
   * Fetches platform_events and reconstructs the operational sequence.
   * NEVER writes to operational tables.
   */
  async replay(supabase: SupabaseClient, params: {
    org_id:      string
    entity_id:   string
    entity_type: string
    from:        string    // ISO timestamp
    to:          string    // ISO timestamp
    created_by?: string
  }): Promise<ReplaySession> {
    const session: ReplaySession = {
      id:           randomUUID(),
      org_id:       params.org_id,
      entity_id:    params.entity_id,
      entity_type:  params.entity_type,
      replay_from:  params.from,
      replay_to:    params.to,
      events_replayed: 0,
      status:       'running',
      created_at:   new Date().toISOString(),
      created_by:   params.created_by,
    }

    try {
      // Fetch events from platform_events (read-only)
      const { data, error } = await supabase
        .from('platform_events')
        .select('*')
        .eq('org_id', params.org_id)
        .eq('entity_id', params.entity_id)
        .gte('timestamp', params.from)
        .lte('timestamp', params.to)
        .order('timestamp', { ascending: true })

      if (error) throw new Error(error.message)

      const events = (data ?? []) as ResolvedPlatformEvent[]
      const severityRank = { info: 0, warning: 1, high: 2, critical: 3 } as const
      session.events_replayed = events.length
      session.status = 'completed'
      session.result_summary = {
        event_count:    events.length,
        event_types:    [...new Set(events.map(e => e.event_type))],
        modules:        [...new Set(events.map(e => e.module))],
        severity_peak:  events.reduce((worst, e) => {
          return (severityRank[e.severity as keyof typeof severityRank] ?? 0) > (severityRank[worst as keyof typeof severityRank] ?? 0)
            ? (e.severity ?? 'info') : worst
        }, 'info' as string),
      }
    } catch (err: unknown) {
      session.status = 'failed'
      session.result_summary = { error: err instanceof Error ? err.message : 'Unknown error' }
    }

    // Persist session record (fire-and-forget)
    void supabase
      .from('replay_sessions')
      .insert({
        id:              session.id,
        org_id:          session.org_id,
        entity_id:       session.entity_id,
        entity_type:     session.entity_type,
        replay_from:     session.replay_from,
        replay_to:       session.replay_to,
        events_replayed: session.events_replayed,
        status:          session.status,
        result_summary:  session.result_summary,
        created_at:      session.created_at,
        created_by:      session.created_by ?? null,
      })

    return session
  }

  /** List recent replay sessions for an org. */
  async listSessions(supabase: SupabaseClient, orgId: string, limit = 20): Promise<ReplaySession[]> {
    const { data } = await supabase
      .from('replay_sessions')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit)
    return (data ?? []) as ReplaySession[]
  }
}

export const replayIntelligenceService = new ReplayIntelligenceService()
