/**
 * LWFManagement — /admin/payroll/statutory/lwf
 *
 * Configure Labour Welfare Fund (LWF) state-wise: employee & employer amounts,
 * frequency (monthly / half-yearly / annual), deduction months, wage ceiling.
 * Compute contributions and view the filing register.
 */

import { useState, useMemo }    from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Globe, CheckCircle2, AlertCircle, Settings, Plus } from 'lucide-react'
import { toast }                from 'sonner'
import { PageContainer }        from '@/components/layout/PageContainer'
import { PageHeader }           from '@/components/layout/PageHeader'
import { SectionCard }          from '@/components/layout/SectionCard'
import { Button }               from '@/components/ui/button'
import { Input }                from '@/components/ui/input'
import { Badge }                from '@/components/ui/badge'
import { api }                  from '@/lib/api/client'
import { useAuthStore }         from '@/stores/authStore'
import { cn }                   from '@/lib/utils'
import { StatutoryMonthPicker, useStatutoryMonth } from '@/components/compliance/StatutoryMonthPicker'

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
}
function fmtMonth(m: string) {
  const d = new Date(m.slice(0, 7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return isNaN(d.getTime()) ? '—' : `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}
function getLast6Months(): string[] {
  const months: string[] = []
  const d = new Date(); d.setDate(1)
  for (let i = 0; i < 6; i++) {
    months.push(d.toISOString().slice(0, 7))
    d.setMonth(d.getMonth() - 1)
  }
  return months
}

interface LWFState {
  state_code:          string
  state_name:          string
  enabled:             boolean
  employee_amount:     number
  employer_amount:     number
  wage_ceiling:        number | null
  frequency:           string
  deduction_months:    string | null
  registration_number: string | null
  is_custom?:          boolean
}

interface LWFContribution {
  id: string
  employee_id: string
  contribution_month: string
  state_code: string
  gross_salary: number
  employee_contribution: number
  employer_contribution: number
  is_eligible: boolean
}

export function LWFManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [viewMonth]         = useStatutoryMonth()
  const [selectedStateCode, setSelectedStateCode] = useState<string>('')
  const [editingState, setEditingState]           = useState<LWFState | null>(null)
  const [showAddState, setShowAddState]           = useState(false)
  const [newStateCode, setNewStateCode]           = useState('')
  const [newStateName, setNewStateName]           = useState('')
  const last6 = useMemo(() => getLast6Months(), [])

  // ── State list ───────────────────────────────────────────────────────────────
  const { data: statesData, isLoading: statesLoading, refetch: refetchStates } = useQuery<LWFState[]>({
    queryKey: ['lwf-states'],
    queryFn:  () => api.get('/payroll/statutory/lwf/states').then((r: any) => Array.isArray(r) ? r : r?.data ?? []),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const stateList = statesData ?? []

  // ── Save state settings ──────────────────────────────────────────────────────
  const saveStateMutation = useMutation({
    mutationFn: (s: LWFState) => api.put(`/payroll/statutory/lwf/states/${s.state_code}`, {
      enabled:             s.enabled,
      employee_amount:     s.employee_amount,
      employer_amount:     s.employer_amount,
      wage_ceiling:        s.wage_ceiling,
      frequency:           s.frequency,
      deduction_months:    s.deduction_months,
      registration_number: s.registration_number,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lwf-states'] })
      setEditingState(null)
      toast.success('LWF state updated')
    },
    onError: (e: any) => toast.error('Failed to update', { description: e?.message }),
  })

  const addStateMutation = useMutation({
    mutationFn: () => api.put(`/payroll/statutory/lwf/states/${newStateCode.toUpperCase().trim()}`, {
      enabled: true, state_name: newStateName.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lwf-states'] })
      toast.success('State added')
      setNewStateCode(''); setNewStateName(''); setShowAddState(false)
    },
    onError: (e: any) => toast.error('Failed to add state', { description: e?.message }),
  })

  // ── Compute contributions ────────────────────────────────────────────────────
  const computeMutation = useMutation({
    mutationFn: (month: string) => api.post('/payroll/statutory/lwf/contributions/compute', { month }),
    onSuccess: (_d, month) => {
      qc.invalidateQueries({ queryKey: ['lwf-contributions'] })
      toast.success('LWF contributions computed', { description: `Month ${month}` })
    },
    onError: (e: any) => toast.error('Compute failed', { description: e?.response?.data?.message ?? e?.message }),
  })

  // ── Contributions (current month) ────────────────────────────────────────────
  const { data: contribData } = useQuery<LWFContribution[]>({
    queryKey: ['lwf-contributions', viewMonth],
    queryFn:  () => api.get(`/payroll/statutory/lwf/contributions?month=${viewMonth}`)
      .then((r: any) => Array.isArray(r) ? r : r?.data ?? []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const contribList = contribData ?? []

  // ── History (last 6 months) ──────────────────────────────────────────────────
  const historyResults = useQueries({
    queries: last6.map(ym => ({
      queryKey: ['lwf-contributions', ym],
      queryFn:  () => api.get(`/payroll/statutory/lwf/contributions?month=${ym}`)
        .then((r: any) => Array.isArray(r) ? r : r?.data ?? []) as Promise<LWFContribution[]>,
      enabled:  isAdmin,
      staleTime: 120_000,
    })),
  })

  const historyRows = last6.map((ym, i) => {
    const rows  = (historyResults[i]?.data ?? []) as LWFContribution[]
    const empTotal  = rows.reduce((s, c) => s + (Number(c.employee_contribution) || 0), 0)
    const emprTotal = rows.reduce((s, c) => s + (Number(c.employer_contribution) || 0), 0)
    return { ym, count: rows.length, empTotal, emprTotal, loading: historyResults[i]?.isLoading }
  })

  const enabledCount    = stateList.filter(s => s.enabled).length
  const totalEmpContrib = contribList.reduce((s, c) => s + (Number(c.employee_contribution) || 0), 0)
  const totalEmprContrib = contribList.reduce((s, c) => s + (Number(c.employer_contribution) || 0), 0)

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="LWF Management" subtitle="Labour Welfare Fund" />
        <SectionCard><p className="text-sm text-muted-foreground py-8 text-center">HR admin access required.</p></SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[
          { label: 'Payroll', href: '/admin/payroll' },
          { label: 'Statutory', href: '/admin/payroll/statutory' },
          { label: 'LWF' },
        ]}
        title="LWF Management"
        subtitle="Configure Labour Welfare Fund contributions by state and monitor filings"
        actions={
          <div className="flex items-center gap-2">
            <StatutoryMonthPicker />
            {showAddState ? (
              <>
                <Input value={newStateCode} onChange={e => setNewStateCode(e.target.value.toUpperCase().slice(0,4))}
                  placeholder="Code (e.g. KA)" className="h-8 text-xs w-24" />
                <Input value={newStateName} onChange={e => setNewStateName(e.target.value)}
                  placeholder="State name" className="h-8 text-xs w-36" />
                <Button size="sm" className="h-8 text-xs" disabled={!newStateCode.trim() || addStateMutation.isPending}
                  onClick={() => addStateMutation.mutate()}>Add</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  onClick={() => { setShowAddState(false); setNewStateCode(''); setNewStateName('') }}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => setShowAddState(true)}>
                <Plus className="h-3.5 w-3.5" />Add State
              </Button>
            )}
            <Button size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => computeMutation.mutate(viewMonth)} disabled={computeMutation.isPending || !viewMonth}>
              <RefreshCw className={cn('h-3.5 w-3.5', computeMutation.isPending && 'animate-spin')} />
              Compute Contributions
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => refetchStates()} disabled={statesLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5', statesLoading && 'animate-spin')} />Refresh
            </Button>
          </div>
        }
      />

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">States Enabled</span>
            <div className="text-2xl font-black text-foreground tracking-tight mt-0.5">
              {enabledCount} <span className="text-xs font-semibold text-muted-foreground">/ {stateList.length}</span>
            </div>
          </div>
        </div>
        <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Employee LWF</span>
            <div className="text-2xl font-black text-foreground tracking-tight mt-0.5">{fmtCurrency(totalEmpContrib)}</div>
          </div>
        </div>
        <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shrink-0 dark:bg-orange-950/40 dark:border-orange-800 dark:text-orange-400">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Employer LWF</span>
            <div className="text-2xl font-black text-foreground tracking-tight mt-0.5">{fmtCurrency(totalEmprContrib)}</div>
          </div>
        </div>
      </div>

      {/* ── State configuration ─────────────────────────────────────────────── */}
      <SectionCard title="LWF State Configuration" icon={<Settings className="h-4 w-4" />} className="mb-6">
        <p className="text-xs text-muted-foreground mb-4">
          Enable states where your employees work. Set employee & employer amounts, deduction frequency and optional wage ceiling.
          <span className="block mt-1 text-warning">Note: LWF rates are fixed statutory amounts (not percentages). Common states: Karnataka ₹20/month, Maharashtra ₹12/half-yearly, Tamil Nadu ₹10/annual.</span>
        </p>
        {statesLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading states…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {['State','Status','Employee ₹','Employer ₹','Frequency','Wage Ceiling','Deduction Months',''].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-muted-foreground font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stateList.map(s => editingState?.state_code === s.state_code ? (
                  <tr key={s.state_code} className="border-b border-border bg-primary/5">
                    <td className="px-3 py-2.5 font-medium">{s.state_name} <span className="text-muted-foreground">({s.state_code})</span></td>
                    <td className="px-3 py-2.5">
                      <select className="h-7 rounded border border-input bg-background px-1 text-xs"
                        value={editingState.enabled ? 'true' : 'false'}
                        onChange={e => setEditingState(p => p ? ({ ...p, enabled: e.target.value === 'true' }) : p)}>
                        <option value="true">Enabled</option>
                        <option value="false">Disabled</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <Input type="number" min={0} value={editingState.employee_amount}
                        onChange={e => setEditingState(p => p ? ({ ...p, employee_amount: Number(e.target.value) || 0 }) : p)}
                        className="h-7 text-xs w-20" />
                    </td>
                    <td className="px-3 py-2.5">
                      <Input type="number" min={0} value={editingState.employer_amount}
                        onChange={e => setEditingState(p => p ? ({ ...p, employer_amount: Number(e.target.value) || 0 }) : p)}
                        className="h-7 text-xs w-20" />
                    </td>
                    <td className="px-3 py-2.5">
                      <select className="h-7 rounded border border-input bg-background px-1 text-xs"
                        value={editingState.frequency}
                        onChange={e => setEditingState(p => p ? ({ ...p, frequency: e.target.value }) : p)}>
                        <option value="monthly">Monthly</option>
                        <option value="half_yearly">Half-yearly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <Input type="number" min={0} value={editingState.wage_ceiling ?? ''}
                        placeholder="No ceiling"
                        onChange={e => setEditingState(p => p ? ({ ...p, wage_ceiling: e.target.value ? Number(e.target.value) : null }) : p)}
                        className="h-7 text-xs w-24" />
                    </td>
                    <td className="px-3 py-2.5">
                      <Input value={editingState.deduction_months ?? ''}
                        placeholder="e.g. 6,12"
                        onChange={e => setEditingState(p => p ? ({ ...p, deduction_months: e.target.value || null }) : p)}
                        className="h-7 text-xs w-20" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7 text-xs" disabled={saveStateMutation.isPending}
                          onClick={() => saveStateMutation.mutate(editingState!)}>Save</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => setEditingState(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.state_code} className="border-b border-border hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5 font-medium">{s.state_name} <span className="text-muted-foreground text-[10px]">({s.state_code})</span></td>
                    <td className="px-3 py-2.5">
                      <Badge variant={s.enabled ? 'success' : 'secondary'} className="rounded-full text-[10px]">
                        {s.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{s.employee_amount > 0 ? fmtCurrency(s.employee_amount) : '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums">{s.employer_amount > 0 ? fmtCurrency(s.employer_amount) : '—'}</td>
                    <td className="px-3 py-2.5 capitalize">{s.frequency.replace('_', '-')}</td>
                    <td className="px-3 py-2.5 tabular-nums">{s.wage_ceiling ? fmtCurrency(s.wage_ceiling) : '—'}</td>
                    <td className="px-3 py-2.5 font-mono">{s.deduction_months ?? (s.frequency === 'monthly' ? 'All' : '—')}</td>
                    <td className="px-3 py-2.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setEditingState({ ...s })}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── Last 6 months history ───────────────────────────────────────────── */}
      <SectionCard title="LWF Filing Register — Last 6 Months" icon={<RefreshCw className="h-4 w-4" />} noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {['Filing Cycle','Staff','Employee LWF','Employer LWF','Total'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-muted-foreground font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historyRows.map(row => (
                <tr key={row.ym} className={cn('border-b border-border hover:bg-muted/20', row.ym === viewMonth && 'bg-primary/5')}>
                  <td className="px-4 py-2.5 font-medium">
                    {fmtMonth(row.ym)}
                    {row.ym === viewMonth && <Badge variant="outline" className="ml-2 text-[9px] rounded-full">Current</Badge>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{row.loading ? '…' : row.count || '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-primary">{row.loading ? '…' : row.empTotal > 0 ? fmtCurrency(row.empTotal) : '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums">{row.loading ? '…' : row.emprTotal > 0 ? fmtCurrency(row.emprTotal) : '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums font-semibold">{row.loading ? '…' : (row.empTotal + row.emprTotal) > 0 ? fmtCurrency(row.empTotal + row.emprTotal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {contribList.length} employee{contribList.length !== 1 ? 's' : ''} in {fmtMonth(viewMonth)}
            </p>
          </div>
        </div>
      </SectionCard>
    </PageContainer>
  )
}
