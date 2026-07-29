/**
 * DecisionGraphService — append-only enterprise decision lineage.
 * Records approvals, escalations, overrides, governance evaluations.
 * NEVER modifies existing nodes or edges. Append-only.
 */
import { randomUUID }                  from 'crypto'
import type { SupabaseClient }         from '@supabase/supabase-js'
import type { DecisionGraphNode, DecisionGraphEdge, DecisionNodeType } from '../types/fabric-types.js'
import { explainabilityService }       from '../../ai/services/explainability.service.js'

export class DecisionGraphService {
  /** Append a new decision node. Non-fatal — errors swallowed. */
  async addNode(supabase: SupabaseClient, node: Omit<DecisionGraphNode, 'node_id'>): Promise<string | null> {
    const nodeId = randomUUID()
    const fullNode: DecisionGraphNode = {
      ...node,
      node_id: nodeId,
      explainability: node.explainability ?? explainabilityService.explain({
        event_type:  `decision.${node.node_type}`,
        entity_type: node.entity_type,
        entity_id:   node.entity_id,
        payload:     node.metadata ?? {},
        severity:    'info',
      }),
    }

    const { error } = await supabase
      .from('decision_graph_nodes')
      .insert({
        node_id:      fullNode.node_id,
        node_type:    fullNode.node_type,
        entity_id:    fullNode.entity_id,
        entity_type:  fullNode.entity_type,
        tenant_id:       fullNode.tenant_id,
        description:  fullNode.description,
        timestamp:    fullNode.timestamp,
        actor_id:     fullNode.actor_id ?? null,
        metadata:     fullNode.metadata ?? null,
        explainability: fullNode.explainability,
      })

    if (error) { console.warn('[DecisionGraphService] addNode failed', error.message); return null }
    return nodeId
  }

  /** Append a directed edge between two nodes. */
  async addEdge(supabase: SupabaseClient, edge: DecisionGraphEdge): Promise<void> {
    const { error } = await supabase
      .from('decision_graph_edges')
      .insert({
        from_node_id: edge.from_node_id,
        to_node_id:   edge.to_node_id,
        edge_type:    edge.edge_type,
        tenant_id:       edge.tenant_id,
        weight:       edge.weight,
        created_at:   edge.created_at ?? new Date().toISOString(),
      })
    // Matches the sibling addNode()'s error handling above: log and swallow
    // rather than throw, since a missing edge shouldn't fail the caller's
    // primary operation — but previously this wasn't even awaited, so the
    // error was invisible even to logs.
    if (error) console.warn('[DecisionGraphService] addEdge failed', error.message)
  }

  /** Get all decision nodes for an entity (for lineage view). */
  async getEntityLineage(supabase: SupabaseClient, entityId: string, orgId: string, limit = 50): Promise<DecisionGraphNode[]> {
    const { data, error } = await supabase
      .from('decision_graph_nodes')
      .select('*')
      .eq('tenant_id', orgId)
      .eq('entity_id', entityId)
      .order('timestamp', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []) as DecisionGraphNode[]
  }

  /** Get recent decision nodes for an org. */
  async getRecentNodes(supabase: SupabaseClient, orgId: string, limit = 50): Promise<DecisionGraphNode[]> {
    const { data, error } = await supabase
      .from('decision_graph_nodes')
      .select('*')
      .eq('tenant_id', orgId)
      .order('timestamp', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data ?? []) as DecisionGraphNode[]
  }

  /** Quick helper to record an event-driven decision node from a platform event. */
  async recordFromEvent(supabase: SupabaseClient, params: {
    tenant_id:      string
    entity_id:   string
    entity_type: string
    node_type:   DecisionNodeType
    description: string
    actor_id?:   string
    metadata?:   Record<string, unknown>
  }): Promise<string | null> {
    return this.addNode(supabase, {
      node_type:    params.node_type,
      entity_id:    params.entity_id,
      entity_type:  params.entity_type,
      tenant_id:       params.tenant_id,
      description:  params.description,
      timestamp:    new Date().toISOString(),
      actor_id:     params.actor_id,
      metadata:     params.metadata,
    })
  }
}

export const decisionGraphService = new DecisionGraphService()
