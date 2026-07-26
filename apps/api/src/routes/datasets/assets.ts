/**
 * Canonical Assets Dataset — /datasets/assets
 *
 * Single source of truth for asset inventory analytics.
 * Reads from the `assets` SSOT table (asset master). No duplicate logic —
 * the same source as GET /assets, aggregated for the Data Explorer.
 *
 * GET /datasets/assets
 *   ?group_by    status|category
 *   ?filter_category_id   drill-down filter
 *   ?filter_status        drill-down filter
 */

import type { FastifyInstance } from 'fastify'
import { HR_ADMIN_ROLES } from '../../lib/rbac.js'
import { serverError, ErrorCode } from '../../lib/api-errors.js'
import { fetchAllRows } from '../../lib/supabase-paginate.js'

type GroupBy = 'status' | 'category'
const VALID_GROUP_BY = new Set<string>(['status', 'category'])

function r2(n: number): number { return Math.round(n * 100) / 100 }

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default async function assetsDataset(fastify: FastifyInstance) {
  const adminAuth = {
    preHandler: [
      fastify.authenticate,
      (req: any, reply: any, done: () => void) => {
        if (!(HR_ADMIN_ROLES as readonly string[]).includes(req.userRole)) {
          reply.code(403).send({ error: 'FORBIDDEN', message: 'HR admin access required' })
          return
        }
        done()
      },
    ],
  }

  fastify.get('/', adminAuth, async (req: any, reply) => {
    const tid = req.tenantId
    const q   = req.query as Record<string, string>

    const groupBy: GroupBy = VALID_GROUP_BY.has(q.group_by ?? '') ? (q.group_by as GroupBy) : 'status'

    const filterCategoryId = q.filter_category_id ?? null
    const filterStatus     = q.filter_status      ?? null

    let assets: any[]
    try {
      assets = await fetchAllRows((from, to) => {
        let assetsQuery = fastify.supabase
          .from('assets')
          .select(`
            id, status, category_id, purchase_cost, assigned_to,
            asset_categories ( id, name )
          `)
          .eq('tenant_id', tid)

        if (filterCategoryId) assetsQuery = assetsQuery.eq('category_id', filterCategoryId)
        if (filterStatus)     assetsQuery = assetsQuery.eq('status', filterStatus)

        return assetsQuery.range(from, to)
      })
    } catch (error) {
      return serverError(req, reply, error, ErrorCode.QUERY_FAILED, 'Failed to fetch assets dataset')
    }

    function getGroupKey(a: any): { key: string; label: string } {
      switch (groupBy) {
        case 'status':
          return { key: a.status ?? 'unknown', label: a.status ? titleCase(a.status) : 'Unknown' }
        case 'category':
          return { key: a.category_id ?? '__none__', label: (a.asset_categories as any)?.name ?? 'Uncategorised' }
      }
    }

    type GroupEntry = { key: string; label: string; asset_count: number; total_value: number; assigned_count: number }
    const groupMap: Record<string, GroupEntry> = {}

    for (const a of assets) {
      const { key, label } = getGroupKey(a)
      if (!groupMap[key]) groupMap[key] = { key, label, asset_count: 0, total_value: 0, assigned_count: 0 }
      const g = groupMap[key]
      g.asset_count++
      g.total_value += Number(a.purchase_cost ?? 0)
      if (a.assigned_to) g.assigned_count++
    }

    const totalCount  = assets.length
    const totalValue  = assets.reduce((s, a) => s + Number(a.purchase_cost ?? 0), 0)
    const assignedTot = assets.filter(a => a.assigned_to).length

    const by_group = Object.values(groupMap)
      .map(g => ({
        key:              g.key,
        label:            g.label,
        asset_count:      g.asset_count,
        total_value:      r2(g.total_value),
        avg_value:        g.asset_count > 0 ? r2(g.total_value / g.asset_count) : 0,
        assigned_count:   g.assigned_count,
        utilisation_pct:  g.asset_count > 0 ? r2((g.assigned_count / g.asset_count) * 100) : 0,
      }))
      .sort((a, b) => b.asset_count - a.asset_count)

    return reply.send({
      meta: { group_by: groupBy, generated_at: new Date().toISOString() },
      summary: {
        total_assets:    totalCount,
        total_value:     r2(totalValue),
        assigned_assets: assignedTot,
        utilisation_pct: totalCount > 0 ? r2((assignedTot / totalCount) * 100) : 0,
      },
      by_group,
    })
  })
}
