/**
 * PayrollSimulation — /payroll/simulation
 *
 * What-if scenario builder: compose multiple scenarios and see
 * the projected payroll impact before making any changes.
 *
 * Fully stateless — no data is saved or modified.
 * Access: hr_admin / super_admin only.
 */

import { useState }                          from 'react'
import { useMutation }                       from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Trash2, Play, ShieldAlert, AlertTriangle,
  TrendingUp, TrendingDown, Loader2, Zap,
  DollarSign, Users, BarChart2, Info,
} from 'lucide-react'

import { toast }             from 'sonner'
import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { Button }           from '@/components/ui/button'
import { Badge }            from '@/components/ui/badge'
import { Input }            from '@/components/ui/input'
import {
  getAxisStyle, getGridStyle, getTooltipStyle, getChartColor,
} from '@/components/ui/chart'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type ScenarioType = 'ot_change' | 'headcount_change' | 'revision' | 'lop_rate_change' | 'allowance_change'

interface ScenarioForm {
  id:             string
  type:           ScenarioType
  label:          string
  // ot_change
  change_pct?:    string
  department_id?: string
  // headcount_change
  delta?:         string
  // revision
  employee_ids?:  string  // newline-separated UUIDs
  new_ctc_annual?: string
  // lop_rate_change
  working_days?:  string
  lop_days_delta?: string
  // allowance_change
  monthly_delta?: string
}

interface SimResult {
  base_month:      string
  base_headcount:  number
  base_total:      number
  base_gross:      number
  base_ot:         number
  simulated_total: number
  simulated_gross: number
  simulated_ot:    number
  total_delta:     number
  total_delta_pct: number
  scenarios:       SimScenario[]
  by_department:   DeptImpact[]
  note:            string
}

interface SimScenario {
  type:        string
  label:       string
  delta:       number
  delta_pct:   number
  explanation: string
}

interface DeptImpact {
  department_id:   string
  department_name: string
  headcount:       number
  base_total:      number
  sim_total:       number
  delta:           number
  delta_pct:       number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let _uid = 0
function uid() { return String(++_uid) }

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`
  if (Math.abs(n) >= 1_000) return `₹${Math.round(n / 1_000)}K`
  return `₹${Math.round(n)}`
}

const TYPE_LABELS: Record<ScenarioType, string> = {
  ot_change:        'OT Cost Change',
  headcount_change: 'Headcount Change',
  revision:         'Compensation Revision',
  lop_rate_change:  'LOP Rate Change',
  allowance_change: 'Allowance Change',
}

function defaultForm(type: ScenarioType): ScenarioForm {
  return {
    id:            uid(),
    type,
    label:         TYPE_LABELS[type],
    change_pct:    '10',
    delta:         '5',
    new_ctc_annual: '900000',
    working_days:  '26',
    lop_days_delta: '1',
    monthly_delta:  '2000',
    employee_ids:  '',
    department_id: '',
  }
}

function buildPayload(forms: ScenarioForm[]) {
  return forms.map(f => {
    const base = { type: f.type, label: f.label || undefined }
    switch (f.type) {
      case 'ot_change':
        return { ...base, change_pct: parseFloat(f.change_pct ?? '0'),
          department_id: f.department_id || undefined }
      case 'headcount_change':
        return { ...base, delta: parseInt(f.delta ?? '0'),
          department_id: f.department_id || undefined }
      case 'revision':
        return { ...base,
          employee_ids: (f.employee_ids ?? '').split('\n').map(s => s.trim()).filter(Boolean),
          new_ctc_annual: parseFloat(f.new_ctc_annual ?? '0') }
      case 'lop_rate_change':
        return { ...base, working_days: parseInt(f.working_days ?? '26'),
          lop_days_delta: parseInt(f.lop_days_delta ?? '0') }
      case 'allowance_change':
        return { ...base, monthly_delta: parseFloat(f.monthly_delta ?? '0'),
          department_id: f.department_id || undefined }
    }
  })
}

// ── Scenario form card ─────────────────────────────────────────────────────────

function ScenarioCard({
  form, onChange, onRemove,
}: {
  form:     ScenarioForm
  onChange: (f: ScenarioForm) => void
  onRemove: () => void
}) {
  const inputCls = 'h-7 text-xs'
  const labelCls = 'text-[10px] font-medium text-muted-foreground block mb-0.5'

  function field(key: keyof ScenarioForm, value: string) {
    onChange({ ...form, [key]: value })
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <select
          className="h-7 flex-1 text-xs rounded-md border border-input bg-background px-2 outline-none"
          value={form.type}
          onChange={e => onChange(defaultForm(e.target.value as ScenarioType))}
        >
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <Input className="h-7 text-xs w-36" placeholder="Label (optional)"
          value={form.label} onChange={e => field('label', e.target.value)} />
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive flex-shrink-0"
          onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {form.type === 'ot_change' && (
          <>
            <div>
              <label className={labelCls}>Change % (+ or -)</label>
              <Input className={inputCls} type="number" value={form.change_pct}
                onChange={e => field('change_pct', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Department ID (optional)</label>
              <Input className={inputCls} placeholder="UUID or blank = all"
                value={form.department_id} onChange={e => field('department_id', e.target.value)} />
            </div>
          </>
        )}

        {form.type === 'headcount_change' && (
          <>
            <div>
              <label className={labelCls}>Delta (+ add / - remove)</label>
              <Input className={inputCls} type="number" value={form.delta}
                onChange={e => field('delta', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Department ID (optional)</label>
              <Input className={inputCls} placeholder="UUID or blank = global"
                value={form.department_id} onChange={e => field('department_id', e.target.value)} />
            </div>
          </>
        )}

        {form.type === 'revision' && (
          <>
            <div className="col-span-2">
              <label className={labelCls}>Employee UUIDs (one per line)</label>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 ring-primary/50 resize-y min-h-[52px]"
                placeholder={'UUID-1\nUUID-2'}
                value={form.employee_ids}
                onChange={e => field('employee_ids', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>New CTC Annual (₹)</label>
              <Input className={inputCls} type="number" value={form.new_ctc_annual}
                onChange={e => field('new_ctc_annual', e.target.value)} />
            </div>
          </>
        )}

        {form.type === 'lop_rate_change' && (
          <>
            <div>
              <label className={labelCls}>Working Days / Month</label>
              <Input className={inputCls} type="number" min={20} max={31} value={form.working_days}
                onChange={e => field('working_days', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Additional LOP Days (per emp)</label>
              <Input className={inputCls} type="number" value={form.lop_days_delta}
                onChange={e => field('lop_days_delta', e.target.value)} />
            </div>
          </>
        )}

        {form.type === 'allowance_change' && (
          <>
            <div>
              <label className={labelCls}>Monthly Delta / Employee (₹)</label>
              <Input className={inputCls} type="number" value={form.monthly_delta}
                onChange={e => field('monthly_delta', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Department ID (optional)</label>
              <Input className={inputCls} placeholder="UUID or blank = all"
                value={form.department_id} onChange={e => field('department_id', e.target.value)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PayrollSimulation() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [forms,  setForms]  = useState<ScenarioForm[]>([defaultForm('ot_change')])
  const [result, setResult] = useState<SimResult | null>(null)
  const [simError, setSimError] = useState('')

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  const simulateMut = useMutation<SimResult, Error, unknown[]>({
    mutationFn: (scenarios: unknown[]) =>
      api.post<SimResult>('/analytics/payroll/simulate', { scenarios }),
    onSuccess: (data) => {
      setResult(data)
      setSimError('')
      toast.success('Simulation complete', { description: `${data.scenarios?.length ?? 0} scenario(s) applied` })
    },
    onError: (e: Error) => {
      setSimError(e.message ?? 'Simulation failed')
      toast.error('Simulation failed', { description: e.message })
    },
  })

  function addScenario(type: ScenarioType) {
    setForms(prev => [...prev, defaultForm(type)])
  }

  function removeScenario(id: string) {
    setForms(prev => prev.filter(f => f.id !== id))
  }

  function updateScenario(updated: ScenarioForm) {
    setForms(prev => prev.map(f => f.id === updated.id ? updated : f))
  }

  function runSimulation() {
    setSimError('')
    const scenarios = buildPayload(forms)
    simulateMut.mutate(scenarios)
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Payroll Simulation" subtitle="What-if scenario builder" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <ShieldAlert className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">HR admin access required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const deptChartData = (result?.by_department ?? [])
    .filter(d => d.delta !== 0)
    .slice(0, 8)
    .map(d => ({
      name:   d.department_name.length > 12 ? d.department_name.slice(0, 12) + '…' : d.department_name,
      Base:   Math.round(d.base_total / 1000),
      Sim:    Math.round(d.sim_total / 1000),
    }))

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Simulation"
        subtitle="Model compensation and workforce changes before applying them"
      />

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-md bg-info/10 border border-info/20 px-3 py-2.5 text-xs text-foreground">
        <Info className="h-4 w-4 text-info flex-shrink-0 mt-0.5" />
        <span>
          Simulations are <strong>read-only</strong> — no payroll data is modified. Results are
          based on active compensations and 3-month OT averages.
        </span>
      </div>

      {/* Scenario builder */}
      <SectionCard
        title="Scenarios"
        icon={<Zap className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex gap-1">
            <select
              className="h-7 text-xs rounded-md border border-input bg-background px-2 outline-none"
              defaultValue=""
              onChange={e => { if (e.target.value) { addScenario(e.target.value as ScenarioType); e.target.value = '' } }}
            >
              <option value="" disabled>+ Add scenario…</option>
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        }
      >
        {forms.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No scenarios added. Select a type above.</p>
          </div>
        )}

        <div className="space-y-2">
          {forms.map(f => (
            <ScenarioCard
              key={f.id}
              form={f}
              onChange={updateScenario}
              onRemove={() => removeScenario(f.id)}
            />
          ))}
        </div>

        {forms.length > 0 && (
          <div className="pt-3 flex items-center gap-3">
            <Button size="sm" className="h-8 text-xs gap-1.5"
              onClick={runSimulation}
              disabled={simulateMut.isPending}>
              {simulateMut.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Simulating…</>
                : <><Play className="h-3.5 w-3.5" />Run Simulation</>}
            </Button>
            {simError && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />{simError}
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* Results */}
      {result && (
        <>
          {/* Summary delta */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Base Total',      value: fmt(result.base_total),      icon: DollarSign,  cls: 'text-foreground' },
              { label: 'Simulated Total', value: fmt(result.simulated_total), icon: TrendingUp,  cls: 'text-info' },
              { label: 'Total Delta',
                value: `${result.total_delta >= 0 ? '+' : ''}${fmt(result.total_delta)}`,
                icon: result.total_delta >= 0 ? TrendingUp : TrendingDown,
                cls: result.total_delta > 0 ? 'text-warning' : 'text-success' },
              { label: 'Headcount',       value: result.base_headcount,       icon: Users,       cls: 'text-foreground' },
            ].map(({ label, value, icon: Icon, cls }) => (
              <div key={label}
                className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted/50 flex-shrink-0">
                  <Icon className={cn('h-4 w-4', cls)} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={cn('text-lg font-bold', cls)}>{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Scenario breakdown */}
          <SectionCard title="Scenario Impact Breakdown" icon={<Zap className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {result.scenarios.map((s, i) => (
                <div key={i} className="flex items-start gap-3 border border-border rounded-md px-3 py-2">
                  <div className={cn(
                    'mt-0.5 p-1 rounded-full flex-shrink-0',
                    s.delta > 0 ? 'bg-warning/20' : s.delta < 0 ? 'bg-success/20' : 'bg-muted',
                  )}>
                    {s.delta > 0
                      ? <TrendingUp className="h-3 w-3 text-warning" />
                      : s.delta < 0
                        ? <TrendingDown className="h-3 w-3 text-success" />
                        : <DollarSign className="h-3 w-3 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground">{s.label}</span>
                      <Badge className="rounded-full text-[9px]">{s.type.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{s.explanation}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={cn(
                      'text-sm font-semibold tabular-nums',
                      s.delta > 0 ? 'text-warning' : s.delta < 0 ? 'text-success' : 'text-foreground',
                    )}>
                      {s.delta > 0 ? '+' : ''}{fmt(s.delta)}
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {s.delta_pct > 0 ? '+' : ''}{s.delta_pct.toFixed(2)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Dept impact */}
          {deptChartData.length > 0 && (
            <SectionCard title="Department Impact" icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={deptChartData} barSize={16}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="name" {...axisStyle} tick={{ ...axisStyle.tick, fontSize: 9 }} />
                  <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
                  <Bar dataKey="Base" fill={getChartColor('chart2')} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Sim"  fill={getChartColor('chart1')} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Department', 'HC', 'Base', 'Simulated', 'Delta', 'Δ %'].map(h => (
                        <th key={h}
                          className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.by_department.map(d => (
                      <tr key={d.department_id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 font-medium text-foreground">{d.department_name}</td>
                        <td className="px-3 py-2 text-muted-foreground tabular-nums">{d.headcount}</td>
                        <td className="px-3 py-2 tabular-nums">{fmt(d.base_total)}</td>
                        <td className="px-3 py-2 tabular-nums">{fmt(d.sim_total)}</td>
                        <td className={cn('px-3 py-2 tabular-nums font-medium',
                          d.delta > 0 ? 'text-warning' : d.delta < 0 ? 'text-success' : 'text-muted-foreground')}>
                          {d.delta > 0 ? '+' : ''}{fmt(d.delta)}
                        </td>
                        <td className={cn('px-3 py-2 tabular-nums',
                          Math.abs(d.delta_pct) > 10 ? 'text-warning font-medium' : 'text-muted-foreground')}>
                          {d.delta_pct > 0 ? '+' : ''}{d.delta_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-muted-foreground pt-2 italic">{result.note}</p>
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  )
}
