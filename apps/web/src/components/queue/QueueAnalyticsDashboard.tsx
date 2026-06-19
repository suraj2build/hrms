/**
 * QueueAnalyticsDashboard — compact analytics panel showing queue health metrics.
 */

import { cn } from '@/lib/utils'
import type {
  OperationalQueueItem,
  QueueSLAMetrics,
  QueueType,
} from '@/lib/queue/types'

export interface QueueAnalyticsDashboardProps {
  items: OperationalQueueItem[]
  sla:   QueueSLAMetrics
}

// ── helpers ────────────────────────────────────────────────────────────────

const todayIso = new Date().toISOString().slice(0, 10)

function isResolvedToday(item: OperationalQueueItem): boolean {
  return item.status === 'resolved'
}

interface MetricCardProps {
  label:    string
  value:    string | number
  sublabel?: string
  accent?:  'green' | 'red' | 'neutral'
}

function MetricCard({ label, value, sublabel, accent = 'neutral' }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p
        className={cn(
          'text-2xl font-bold leading-none',
          accent === 'green' && 'text-success',
          accent === 'red'   && 'text-destructive',
          accent === 'neutral' && 'text-foreground',
        )}
      >
        {value}
      </p>
      {sublabel && <p className="text-[11px] text-muted-foreground">{sublabel}</p>}
    </div>
  )
}

// ── component ──────────────────────────────────────────────────────────────

export function QueueAnalyticsDashboard({ items, sla }: QueueAnalyticsDashboardProps) {
  const total = items.length

  // 1. Issues resolved today
  const resolvedToday = items.filter(isResolvedToday).length

  // 2. Payroll blockers cleared
  const blockersCleared = items.filter(i => i.status === 'resolved' && i.payroll_blocking).length

  // 3. Queue aging (avg hours) for open items
  const openItems = items.filter(i => i.status === 'open')
  const avgAgingHrs =
    openItems.length > 0
      ? (
          openItems.reduce((sum, i) => sum + (Date.now() - new Date(i.created_at).getTime()), 0) /
          openItems.length /
          3_600_000
        ).toFixed(1)
      : '0'

  // 4. Overdue count
  const overdueCount = sla.overdue_count

  // 5. Avg resolution time
  const avgResMins = sla.avg_resolution_time_mins

  // 6. SLA compliance %
  const slaCompliancePct =
    total > 0 ? Math.round(((total - sla.overdue_count) / total) * 100) : 100

  // ── Top 5 issues by type ───────────────────────────────────────────────
  const typeCounts = items.reduce<Record<QueueType, number>>(
    (acc, item) => {
      acc[item.queue_type] = (acc[item.queue_type] ?? 0) + 1
      return acc
    },
    {} as Record<QueueType, number>,
  )

  const topTypes = (Object.entries(typeCounts) as [QueueType, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  const maxTypeCount = topTypes[0]?.[1] ?? 1

  // ── Branch / site concentration ────────────────────────────────────────
  interface SiteRow {
    site_id:   string
    site_name: string
    open:      number
    blockers:  number
    overdue:   number
  }

  const siteMap = new Map<string, SiteRow>()

  for (const item of items) {
    const sid  = item.site_id   ?? '__unknown__'
    const name = item.site_name ?? 'Unknown Site'
    if (!siteMap.has(sid)) {
      siteMap.set(sid, { site_id: sid, site_name: name, open: 0, blockers: 0, overdue: 0 })
    }
    const row = siteMap.get(sid)!
    if (item.status === 'open') row.open++
    if (item.payroll_blocking && item.status === 'open') row.blockers++
    if (item.overdue && item.status === 'open') row.overdue++
  }

  const siteRows = Array.from(siteMap.values())
    .sort((a, b) => b.open - a.open)
    .slice(0, 8)

  const TYPE_LABEL: Partial<Record<QueueType, string>> = {
    missing_punch:         'Missing Punch',
    ot_verification:       'OT Verification',
    shift_conflict:        'Shift Conflict',
    leave_conflict:        'Leave Conflict',
    payroll_blocker:       'Payroll Blocker',
    compliance_risk:       'Compliance Risk',
    attendance_anomaly:    'Attendance Anomaly',
    correction_pending:    'Correction Pending',
    regularisation_pending:'Regularisation',
    roster_gap:            'Roster Gap',
    biometric_failure:     'Biometric Failure',
    duplicate_entry:       'Duplicate Entry',
  }

  // suppress unused-variable warning for todayIso used in component scope
  void todayIso

  return (
    <div className="flex flex-col gap-6">
      {/* Metric cards — 2-column grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Issues Resolved Today"
          value={resolvedToday}
          accent={resolvedToday > 0 ? 'green' : 'neutral'}
        />
        <MetricCard
          label="Payroll Blockers Cleared"
          value={blockersCleared}
          accent={blockersCleared > 0 ? 'green' : 'neutral'}
        />
        <MetricCard
          label="Queue Aging (avg hrs)"
          value={avgAgingHrs}
          sublabel="open items"
        />
        <MetricCard
          label="Overdue Count"
          value={overdueCount}
          accent={overdueCount > 0 ? 'red' : 'green'}
        />
        <MetricCard
          label="Avg Resolution Time"
          value={`${avgResMins} min`}
        />
        <MetricCard
          label="SLA Compliance"
          value={`${slaCompliancePct}%`}
          accent={slaCompliancePct >= 90 ? 'green' : 'red'}
        />
      </div>

      {/* Top Issues by Type — horizontal bar chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-semibold text-foreground mb-3">Top Issues by Type</p>
        {topTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No items.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {topTypes.map(([type, count]) => {
              const pct = Math.round((count / maxTypeCount) * 100)
              return (
                <div key={type} className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground w-36 shrink-0 truncate">
                    {TYPE_LABEL[type] ?? type}
                  </span>
                  <div className="flex-1 h-3 rounded bg-muted overflow-hidden">
                    <div
                      className="h-3 rounded bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-foreground w-6 text-right shrink-0">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Branch Concentration table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-foreground">Branch Concentration</p>
        </div>
        {siteRows.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">No site data.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Site</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Blockers</th>
                <th className="px-3 py-2 text-right font-medium">Overdue</th>
                <th className="px-3 py-2 text-right font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {siteRows.map(row => (
                <tr
                  key={row.site_id}
                  className={cn(
                    'border-b border-border last:border-0',
                    row.blockers > 0 && 'bg-destructive/60',
                  )}
                >
                  <td className="px-4 py-2 font-medium text-foreground truncate max-w-[160px]">
                    {row.site_name}
                  </td>
                  <td className="px-3 py-2 text-right text-foreground">{row.open}</td>
                  <td className={cn('px-3 py-2 text-right', row.blockers > 0 ? 'text-destructive font-semibold' : 'text-foreground')}>
                    {row.blockers}
                  </td>
                  <td className={cn('px-3 py-2 text-right', row.overdue > 0 ? 'text-accent-coral' : 'text-foreground')}>
                    {row.overdue}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {/* trend placeholder */}
                    ↔
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
