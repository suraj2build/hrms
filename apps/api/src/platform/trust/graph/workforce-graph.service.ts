/**
 * WorkforceGraphService — relationship graph foundation.
 * Builds edges between employees and shared identifiers.
 * Sprint 3: Foundation only. Advanced fraud detection in future sprint.
 * READ/WRITE: Persists edges to workforce_graph_edges table.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import type { WorkforceGraphEdge, GraphEdgeType } from '../types/trust-types.js'

function hashValue(v: string): string {
  return createHash('sha256').update(v.trim().toLowerCase()).digest('hex')
}

export class WorkforceGraphService {
  /**
   * Upsert a graph edge. Non-fatal — errors swallowed.
   */
  async upsertEdge(supabase: SupabaseClient, edge: WorkforceGraphEdge): Promise<void> {
    try {
      await supabase
        .from('workforce_graph_edges')
        .upsert({
          org_id:      edge.org_id,
          from_entity: edge.from_entity,
          from_type:   edge.from_type,
          to_entity:   edge.to_entity,
          to_type:     edge.to_type,
          edge_type:   edge.edge_type,
          weight:      edge.weight,
          metadata:    edge.metadata ?? null,
          created_at:  new Date().toISOString(),
        }, { onConflict: 'org_id,from_entity,to_entity,edge_type' })
    } catch {
      // Non-fatal — graph edge upsert errors are swallowed
    }
  }

  /**
   * Add PAN edge for an employee.
   */
  async addPanEdge(supabase: SupabaseClient, employeeId: string, pan: string, orgId: string): Promise<void> {
    await this.upsertEdge(supabase, {
      org_id:      orgId,
      from_entity: employeeId,
      from_type:   'employee',
      to_entity:   hashValue(pan),
      to_type:     'pan',
      edge_type:   'employee_pan',
      weight:      1.0,
    })
  }

  /**
   * Add bank account edge.
   */
  async addBankEdge(supabase: SupabaseClient, employeeId: string, accountNumber: string, orgId: string): Promise<void> {
    await this.upsertEdge(supabase, {
      org_id:      orgId,
      from_entity: employeeId,
      from_type:   'employee',
      to_entity:   hashValue(accountNumber.replace(/[\s\-]/g, '')),
      to_type:     'bank_account',
      edge_type:   'employee_bank',
      weight:      1.0,
    })
  }

  /**
   * Add phone edge.
   */
  async addPhoneEdge(supabase: SupabaseClient, employeeId: string, phone: string, orgId: string): Promise<void> {
    await this.upsertEdge(supabase, {
      org_id:      orgId,
      from_entity: employeeId,
      from_type:   'employee',
      to_entity:   hashValue(phone.replace(/[\s\-\+]/g, '')),
      to_type:     'phone',
      edge_type:   'employee_phone',
      weight:      1.0,
    })
  }

  /**
   * Get all edges for an employee (for graph rendering).
   */
  async getEmployeeEdges(supabase: SupabaseClient, employeeId: string, orgId: string): Promise<WorkforceGraphEdge[]> {
    const { data } = await supabase
      .from('workforce_graph_edges')
      .select('*')
      .eq('org_id', orgId)
      .eq('from_entity', employeeId)
    return (data ?? []) as WorkforceGraphEdge[]
  }

  /**
   * Find employees sharing a hashed value (e.g. same PAN hash).
   */
  async findSharedEdges(supabase: SupabaseClient, toEntity: string, edgeType: GraphEdgeType, orgId: string): Promise<string[]> {
    const { data } = await supabase
      .from('workforce_graph_edges')
      .select('from_entity')
      .eq('org_id', orgId)
      .eq('to_entity', toEntity)
      .eq('edge_type', edgeType)
    return (data ?? []).map((r: any) => r.from_entity as string)
  }
}

export const workforceGraphService = new WorkforceGraphService()
