/**
 * anomaly-reconciler.ts — shared auto-resolution core.
 *
 * Extracted from the HR-admin "Reconcile" button so a daily scheduled job
 * can run the same logic unattended. These tests exercise the
 * classification rules directly (no HTTP layer) and the dry_run /
 * resolvedBy=null (scheduled-run) paths.
 */
import { describe, it, expect, vi } from 'vitest'
import { reconcileAnomaliesForTenant } from '../anomaly-reconciler.js'

vi.mock('../attendance-engine.js', () => ({ fetchTenantTz: vi.fn().mockResolvedValue('Asia/Kolkata') }))
vi.mock('../org-context.js', () => ({ getLocalDate: vi.fn().mockReturnValue('2026-03-31') }))

const TENANT_ID = 'tenant-001'

function anomalyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'anom-1', employee_id: 'emp-1', date: '2026-03-01', type: 'no_punch', ...overrides }
}

function buildSupabase(opts: { anomalies: ReturnType<typeof anomalyRow>[]; daily: Record<string, unknown>[]; updateSpy?: ReturnType<typeof vi.fn> }) {
  const updateSpy = opts.updateSpy ?? vi.fn()
  // fetchAllRows() calls queryFn (and so .from(table)...) fresh on every page,
  // pagination state must live OUTSIDE .from() — one `let` per call would
  // reset to false on each new .from() invocation and loop forever.
  let anomaliesPaged = false
  let dailyPaged = false
  return {
    from(table: string) {
      if (table === 'attendance_anomalies') {
        const chain: any = {
          select: () => chain,
          eq:     () => chain,
          in:     () => chain,
          gte:    () => chain,
          lte:    () => chain,
          // fetchAllRows pages until an empty page — return the fixture once,
          // then empty, or a mock with a non-empty fixture would loop forever.
          range:  () => { const first = !anomaliesPaged; anomaliesPaged = true; return Promise.resolve({ data: first ? opts.anomalies : [], error: null }) },
          update: (payload: any) => {
            updateSpy(payload)
            const uchain: any = {
              in: () => uchain, eq: () => uchain,
              then: (resolve: (v: unknown) => void) => resolve({ error: null }),
            }
            return uchain
          },
        }
        return chain
      }
      if (table === 'attendance_daily') {
        const chain: any = {
          select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, lte: () => chain,
          range: () => { const first = !dailyPaged; dailyPaged = true; return Promise.resolve({ data: first ? opts.daily : [], error: null }) },
        }
        return chain
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('reconcileAnomaliesForTenant', () => {
  it('auto-resolves a no_punch anomaly contradicted by a trusted "present" daily row', async () => {
    const updateSpy = vi.fn()
    const supabase = buildSupabase({
      anomalies: [anomalyRow()],
      daily: [{ employee_id: 'emp-1', date: '2026-03-01', status: 'present', work_hours: 8, confidence_level: 'high' }],
      updateSpy,
    })

    const result = await reconcileAnomaliesForTenant(supabase as any, TENANT_ID, { resolvedBy: 'hr-001' })

    expect(result.scanned).toBe(1)
    expect(result.auto_resolved).toBe(1)
    expect(result.skipped).toBe(0)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ resolved: true, resolved_by: 'hr-001' }))
  })

  it('keeps a no_punch anomaly when the contradicting daily row has LOW confidence', async () => {
    const updateSpy = vi.fn()
    const supabase = buildSupabase({
      anomalies: [anomalyRow()],
      daily: [{ employee_id: 'emp-1', date: '2026-03-01', status: 'present', work_hours: 8, confidence_level: 'low' }],
      updateSpy,
    })

    const result = await reconcileAnomaliesForTenant(supabase as any, TENANT_ID, { resolvedBy: 'hr-001' })

    expect(result.auto_resolved).toBe(0)
    expect(result.skipped).toBe(1)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('missing_out requires work_hours > 0, not just an attended status', async () => {
    const updateSpy = vi.fn()
    const supabase = buildSupabase({
      anomalies: [anomalyRow({ type: 'missing_out' })],
      daily: [{ employee_id: 'emp-1', date: '2026-03-01', status: 'present', work_hours: 0, confidence_level: 'high' }],
      updateSpy,
    })

    const result = await reconcileAnomaliesForTenant(supabase as any, TENANT_ID, { resolvedBy: 'hr-001' })

    expect(result.auto_resolved).toBe(0)
    expect(result.details[0].action).toBe('keep')
  })

  it('dry_run classifies but never writes — would_resolve reflects what WOULD happen', async () => {
    const updateSpy = vi.fn()
    const supabase = buildSupabase({
      anomalies: [anomalyRow()],
      daily: [{ employee_id: 'emp-1', date: '2026-03-01', status: 'present', work_hours: 8, confidence_level: 'high' }],
      updateSpy,
    })

    const result = await reconcileAnomaliesForTenant(supabase as any, TENANT_ID, { resolvedBy: 'hr-001', dryRun: true })

    expect(result.auto_resolved).toBe(0)
    expect(result.would_resolve).toBe(1)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('scheduled run passes resolvedBy: null — no human performed it', async () => {
    const updateSpy = vi.fn()
    const supabase = buildSupabase({
      anomalies: [anomalyRow()],
      daily: [{ employee_id: 'emp-1', date: '2026-03-01', status: 'present', work_hours: 8, confidence_level: 'medium' }],
      updateSpy,
    })

    await reconcileAnomaliesForTenant(supabase as any, TENANT_ID, { resolvedBy: null })

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ resolved_by: null }))
  })

  it('no unresolved anomalies in range → short-circuits with all zeros, no attendance_daily query', async () => {
    const dailyQuerySpy = vi.fn()
    const supabase = {
      from(table: string) {
        if (table === 'attendance_anomalies') {
          const chain: any = { select: () => chain, eq: () => chain, in: () => chain, gte: () => chain, lte: () => chain, range: () => Promise.resolve({ data: [], error: null }) }
          return chain
        }
        if (table === 'attendance_daily') { dailyQuerySpy(); throw new Error('should not be queried') }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const result = await reconcileAnomaliesForTenant(supabase as any, TENANT_ID, { resolvedBy: 'hr-001' })

    expect(result).toEqual({ from_date: expect.any(String), to_date: expect.any(String), scanned: 0, auto_resolved: 0, would_resolve: 0, skipped: 0, details: [] })
    expect(dailyQuerySpy).not.toHaveBeenCalled()
  })
})
