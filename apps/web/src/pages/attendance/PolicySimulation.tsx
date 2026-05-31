/**
 * PolicySimulation — /attendance/simulate-policy
 *
 * What-if analysis for attendance policy changes.
 * Fully read-only — no attendance data is written.
 * Build scenarios, set a date range, run the simulation,
 * and inspect the projected impact on statuses, late minutes,
 * payable days, and overtime.
 *
 * Access: hr_admin / super_admin only.
 */

import { useState }      from 'react'
import { useMutation }   from '@tanstack/react-query'
import {
  ShieldAlert, Play, Trash2, Plus,
  Loader2, AlertTriangle, Info,
  TrendingUp, TrendingDown, Users,
  Calendar, Clock, Zap,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { DateInput }      from '@/components/ui/date-input'
import { toast }          from 'sonner'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type ScenarioType =
  | 'grace_change'
  | 'halfday_threshold_change'
  | 'late_cap_change'
  | 'ot_threshold_change'

interface ScenarioEntry {
  uid:     string
  type:    ScenarioType
  // numeric fields — stored as strings for controlled inputs
  from_minutes?: string
  to_minutes?:   string
  from_pct?:     string
  to_pct?:       string
}

interface SimulationRequest {
  scenarios: Array<{
    type: ScenarioType
    [key: string]: unknown
  }>
  date_from:     string
  date_to:       string
  employee_ids?: string[]
}

interface SimulationResult {
  scenarios_applied:  number
  employees_analyzed: number
  date_range:         { from: string; to: string }
  impact_summary: {
    status_changes:       Array<{ from: string; to: string; count: number }>
    late_minutes_delta:   { avg: number; total: number }
    payable_days_delta:   number
    overtime_delta:       number
  }
  sample_records: Array<{
    employee_id: string
    date:        string
    before:      { status: string; late_minutes: number; day_fraction: number }
    after:       { status: string; late_minutes: number; day_fraction: number }
  }>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let _uid = 0
function uid(): string { return String(++_uid) }

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10)
}

const SCENARIO_LABELS: Record<ScenarioType, string> = {
  grace_change:              'Grace Period Change',
  halfday_threshold_change:  'Half-Day Threshold Change',
  late_cap_change:           'Late Cap Change',
  ot_threshold_change:       'OT Threshold Change',
}

function defaultScenario(type: ScenarioType): ScenarioEntry {
  return {
    uid: uid(),
    type,
    from_minutes: '10',
    to_minutes:   '15',
    from_pct:     '50',
    to_pct:       '40',
  }
}

function buildScenarioPayload(entry: ScenarioEntry) {
  switch (entry.type) {
    case 'grace_change':
    case 'late_cap_change':
    case 'ot_threshold_change':
      return {
        type:         entry.type,
        from_minutes: parseFloat(entry.from_minutes ?? '0'),
        to_minutes:   parseFloat(entry.to_minutes   ?? '0'),
      }
    case 'halfday_threshold_change':
      return {
        type:     entry.type,
        from_pct: parseFloat(entry.from_pct ?? '0'),
        to_pct:   parseFloat(entry.to_pct   ?? '0'),
      }
  }
}

function fmtDate(iso: string): string {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function signedNum(n: number, unit = ''): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(n % 1 === 0 ? 0 : 1)}${unit}`
}

// ── Scenario card ──────────────────────────────────────────────────────────────

function ScenarioCard({
  entry,
  onChange,
  onRemove,
}: {
  entry:    ScenarioEntry
  onChange: (e: ScenarioEntry) => void
  onRemove: () => void
}) {
  const inputCls = 'h-7 text-xs'
  const labelCls = 'text-[10px] font-medium text-muted-foreground block mb-0.5'

  function set(key: keyof ScenarioEntry, value: string) {
    onChange({ ...entry, [key]: value })
  }

  const usesMinutes = (
    entry.type === 'grace_change' ||
    entry.type === 'late_cap_change' ||
    entry.type === 'ot_threshold_change'
  )
  const usesPct = entry.type === 'halfday_threshold_change'

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <select
          className="h-7 flex-1 text-xs rounded-md border border-input bg-background px-2 outline-none"
          value={entry.type}
          onChange={e => onChange(defaultScenario(e.target.value as ScenarioType))}
        >
          {Object.entries(SCENARIO_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive flex-shrink-0"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Dynamic fields */}
      <div className="grid grid-cols-2 gap-2">
        {usesMinutes && (
          <>
            <div>
              <label className={labelCls}>From (minutes)</label>
              <Input
                className={inputCls}
                type="number"
                min={0}
                value={entry.from_minutes}
                onChange={e => set('from_minutes', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>To (minutes)</label>
              <Input
                className={inputCls}
                type="number"
                min={0}
                value={entry.to_minutes}
                onChange={e => set('to_minutes', e.target.value)}
              />
            </div>
          </>
        )}
        {usesPct && (
          <>
            <div>
              <label className={labelCls}>From % (threshold)</label>
              <Input
                className={inputCls}
                type="number"
                min={0}
                max={100}
                value={entry.from_pct}
                onChange={e => set('from_pct', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>To % (threshold)</label>
              <Input
                className={inputCls}
                type="number"
                min={0}
                max={100}
                value={entry.to_pct}
                onChange={e => set('to_pct', e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function PolicySimulation() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [scenarios,    setScenarios]    = useState<ScenarioEntry[]>([defaultScenario('grace_change')])
  const [dateFrom,     setDateFrom]     = useState(defaultDateFrom)
  const [dateTo,       setDateTo]       = useState(defaultDateTo)
  const [employeeIds,  setEmployeeIds]  = useState('')
  const [simError,     setSimError]     = useState('')
  const [result,       setResult]       = useState<SimulationResult | null>(null)

  // ── Mutation ───────────────────────────────────────────────────────────────

  const simulateMut = useMutation<SimulationResult, Error, SimulationRequest>({
    mutationFn: (body) => api.post('/attendance/simulate-policy', body),
    onSuccess:  (data) => {
      setResult(data)
      setSimError('')
      toast.success('Simulation complete', { description: `${data.employees_analyzed ?? 0} employees analysed across ${data.scenarios_applied ?? 0} scenario${data.scenarios_applied !== 1 ? 's' : ''}.` })
    },
    onError:    (e)    => {
      setSimError(e.message ?? 'Simulation failed')
      toast.error('Simulation failed', { description: e.message })
    },
  })

  // ── Scenario management ────────────────────────────────────────────────────

  function addScenario(type: ScenarioType) {
    setScenarios(prev => [...prev, defaultScenario(type)])
  }

  function updateScenario(updated: ScenarioEntry) {
    setScenarios(prev => prev.map(s => s.uid === updated.uid ? updated : s))
  }

  function removeScenario(uid: string) {
    setScenarios(prev => prev.filter(s => s.uid !== uid))
  }

  function runSimulation() {
    setSimError('')
    const ids = employeeIds
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    simulateMut.mutate({
      scenarios:    scenarios.map(buildScenarioPayload),
      date_from:    dateFrom,
      date_to:      dateTo,
      ...(ids.length > 0 ? { employee_ids: ids } : {}),
    })
  }

  // ── Access guard ───────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader
          title="Policy Simulation Engine"
          subtitle="What-if analysis for attendance policy changes — read-only, no writes"
        />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <ShieldAlert className="h-12 w-12 opacity-30" />
            <p className="font-medium text-foreground">Access Restricted</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const impact = result?.impact_summary

  return (
    <PageContainer>
      <PageHeader
        title="Policy Simulation Engine"
        subtitle="What-if analysis for attendance policy changes — read-only, no writes"
      />

      {/* Read-only banner */}
      <div className="flex items-start gap-2 rounded-md bg-info/10 border border-info/20 px-3 py-2.5 text-xs text-foreground">
        <Info className="h-4 w-4 text-info flex-shrink-0 mt-0.5" />
        <span>
          Simulations are <strong>read-only</strong> — no attendance records or policies are modified.
          Results are projected based on historical records in the selected date range.
        </span>
      </div>

      {/* Scenario builder */}
      <SectionCard
        title="Scenarios"
        icon={<Zap className="h-4 w-4 text-muted-foreground" />}
        action={
          <select
            className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none"
            defaultValue=""
            onChange={e => {
              if (e.target.value) {
                addScenario(e.target.value as ScenarioType)
                e.target.value = ''
              }
            }}
          >
            <option value="" disabled>+ Add scenario…</option>
            {Object.entries(SCENARIO_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        }
      >
        {scenarios.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Plus className="h-6 w-6 opacity-30" />
            <p className="text-sm">No scenarios yet. Add one from the dropdown above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {scenarios.map(s => (
              <ScenarioCard
                key={s.uid}
                entry={s}
                onChange={updateScenario}
                onRemove={() => removeScenario(s.uid)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Date range + employee IDs */}
      <SectionCard
        title="Simulation Parameters"
        icon={<Calendar className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date From</label>
            <DateInput
              value={dateFrom}
              onChange={setDateFrom}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date To</label>
            <DateInput
              value={dateTo}
              min={dateFrom}
              onChange={setDateTo}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-1">
            <label className="text-xs font-medium text-muted-foreground">
              Employee IDs (optional, one UUID per line)
            </label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 ring-primary/50 resize-y min-h-[60px]"
              placeholder={'UUID-1\nUUID-2\n(leave blank = all employees)'}
              value={employeeIds}
              onChange={e => setEmployeeIds(e.target.value)}
            />
          </div>
        </div>

        {/* Run button */}
        <div className="pt-3 flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={runSimulation}
            disabled={simulateMut.isPending || scenarios.length === 0 || !dateFrom || !dateTo}
          >
            {simulateMut.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Simulating…</>
              : <><Play className="h-3.5 w-3.5" />Run Simulation</>}
          </Button>
          {simError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {simError}
            </p>
          )}
        </div>
      </SectionCard>

      {/* Results */}
      {result && impact && (
        <>
          {/* Summary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Scenarios Applied',
                value: result.scenarios_applied,
                icon: Zap,
                cls:  'text-foreground',
              },
              {
                label: 'Employees Analyzed',
                value: result.employees_analyzed,
                icon: Users,
                cls:  'text-foreground',
              },
              {
                label: 'Date From',
                value: fmtDate(result.date_range.from),
                icon: Calendar,
                cls:  'text-muted-foreground',
              },
              {
                label: 'Date To',
                value: fmtDate(result.date_range.to),
                icon: Calendar,
                cls:  'text-muted-foreground',
              },
            ].map(({ label, value, icon: Icon, cls }) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-card p-4 flex items-center gap-3"
              >
                <div className="p-2 rounded-lg bg-muted/50 flex-shrink-0">
                  <Icon className={cn('h-4 w-4', cls)} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-bold text-foreground">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Impact metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Late minutes delta */}
            <SectionCard>
              <div className="flex items-start justify-between mb-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Avg Late Delta</p>
                <Clock className="h-4 w-4 text-muted-foreground/50" />
              </div>
              <p className={cn(
                'text-2xl font-bold tabular-nums',
                impact.late_minutes_delta.avg < 0 ? 'text-success' : 'text-warning',
              )}>
                {signedNum(impact.late_minutes_delta.avg, ' min')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Total: {signedNum(impact.late_minutes_delta.total, ' min')}
              </p>
            </SectionCard>

            {/* Payable days delta */}
            <SectionCard>
              <div className="flex items-start justify-between mb-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Payable Days Delta</p>
                {impact.payable_days_delta >= 0
                  ? <TrendingUp className="h-4 w-4 text-success" />
                  : <TrendingDown className="h-4 w-4 text-destructive" />}
              </div>
              <p className={cn(
                'text-2xl font-bold tabular-nums',
                impact.payable_days_delta > 0 ? 'text-success'
                : impact.payable_days_delta < 0 ? 'text-destructive'
                : 'text-foreground',
              )}>
                {signedNum(impact.payable_days_delta, ' days')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">across all employees</p>
            </SectionCard>

            {/* Overtime delta */}
            <SectionCard>
              <div className="flex items-start justify-between mb-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Overtime Delta</p>
                <Clock className="h-4 w-4 text-muted-foreground/50" />
              </div>
              <p className={cn(
                'text-2xl font-bold tabular-nums',
                impact.overtime_delta > 0 ? 'text-warning' : impact.overtime_delta < 0 ? 'text-success' : 'text-foreground',
              )}>
                {signedNum(impact.overtime_delta, ' min')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">projected OT change</p>
            </SectionCard>
          </div>

          {/* Status changes table */}
          {impact.status_changes.length > 0 && (
            <SectionCard
              title="Status Changes"
              icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
              description="How employee day statuses would shift under the new policy"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['From Status', 'To Status', 'Count'].map(h => (
                        <th
                          key={h}
                          className="text-left text-muted-foreground font-semibold px-3 py-2"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {impact.status_changes.map((sc, i) => (
                      <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <Badge variant="secondary" className="rounded-full text-[10px] capitalize">
                            {sc.from}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 flex items-center gap-1">
                          <span className="text-muted-foreground">→</span>
                          <Badge
                            variant={
                              sc.to === 'present' ? 'success'
                              : sc.to === 'absent'  ? 'destructive'
                              : sc.to === 'late'    ? 'warning'
                              : 'secondary'
                            }
                            className="rounded-full text-[10px] capitalize"
                          >
                            {sc.to}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 tabular-nums font-medium text-foreground">
                          {sc.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* Sample records */}
          {result.sample_records.length > 0 && (
            <SectionCard
              title="Sample Records (first 10)"
              icon={<Users className="h-4 w-4 text-muted-foreground" />}
              description="Individual record-level comparison: before vs after policy change"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        'Employee ID', 'Date',
                        'Status Before', 'Status After',
                        'Late Before', 'Late After',
                      ].map(h => (
                        <th
                          key={h}
                          className="text-left text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sample_records.slice(0, 10).map((rec, i) => {
                      const statusChanged = rec.before.status !== rec.after.status
                      const lateChanged   = rec.before.late_minutes !== rec.after.late_minutes
                      return (
                        <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                            {rec.employee_id.slice(0, 8)}…
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap tabular-nums">
                            {fmtDate(rec.date)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="secondary" className="rounded-full text-[10px] capitalize">
                              {rec.before.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                !statusChanged            ? 'secondary'
                                : rec.after.status === 'present' ? 'success'
                                : rec.after.status === 'late'    ? 'warning'
                                : rec.after.status === 'absent'  ? 'destructive'
                                : 'secondary'
                              }
                              className="rounded-full text-[10px] capitalize"
                            >
                              {rec.after.status}
                            </Badge>
                          </td>
                          <td className={cn('px-3 py-2 tabular-nums', lateChanged ? 'text-warning' : 'text-muted-foreground')}>
                            {rec.before.late_minutes} min
                          </td>
                          <td className={cn(
                            'px-3 py-2 tabular-nums',
                            !lateChanged                            ? 'text-muted-foreground'
                            : rec.after.late_minutes < rec.before.late_minutes ? 'text-success'
                            : 'text-warning',
                          )}>
                            {rec.after.late_minutes} min
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  )
}
