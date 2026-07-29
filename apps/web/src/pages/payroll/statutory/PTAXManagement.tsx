/**
 * PTAXManagement — /admin/payroll/statutory/ptax
 *
 * HR admin page for managing Professional Tax state configurations and slabs.
 * Full redesign: state card grid (left) + slab panel (right).
 * Monthly contribution ledger removed per product decision.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Settings, RefreshCw, Loader2,
  AlertCircle, Globe, UserCheck, BadgeIndianRupee,
  Trash2, Search, SlidersHorizontal,
  Check, X, PlusCircle, ToggleLeft, ToggleRight, FileSpreadsheet,
} from 'lucide-react'

import { toast }          from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatutoryMonthPicker, useStatutoryMonth } from '@/components/compliance/StatutoryMonthPicker'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PTaxSlab {
  id: string
  state_code: string
  financial_year: string
  monthly_income_from: number
  monthly_income_to: number | null
  monthly_ptax: number
  gender: string
}

interface PTaxStateConfig {
  state_code: string
  state_name: string
  enabled: boolean
  registration_number: string | null
  registration_date: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function getLast6Months(): string[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

function fmtMonth(ym: string): string {
  const d = new Date(ym.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

/** Extract a human-readable message from a thrown API error. */
function errMessage(e: unknown): string | undefined {
  if (e && typeof e === 'object') {
    const resp = (e as { response?: { data?: { message?: unknown } } }).response
    if (typeof resp?.data?.message === 'string') return resp.data.message
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string') return msg
  }
  return undefined
}

// Diagnostic payload returned by the P-Tax compute endpoint.
interface PTaxComputeResult {
  data?:              PTaxComputeResult
  computed_nonzero?:  number
  computed_count?:    number
  computed_zero?:     number
  skipped_no_state?:  number
  skipped_no_slabs?:  number
  skipped_exempt?:    number
  no_slab_states?:    string[]
  financial_year?:    string
  sample_trace?:      unknown
  state_diagnostics?: Array<{ code: string; state: string | null; source: string }>
}

const CURRENT_FY = (() => {
  const now  = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${String(year + 1).slice(2)}`
})()

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PTAXManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const todayYMDate = new Date()
  const todayYM = `${todayYMDate.getFullYear()}-${String(todayYMDate.getMonth() + 1).padStart(2, '0')}`
  const [viewMonth] = useStatutoryMonth()   // shared across all Compliance tabs
  const last6   = useMemo(() => getLast6Months(), [])

  // ── Manual contribution compute (FY auto-derived from month server-side) ──────
  const computeMutation = useMutation({
    mutationFn: (month: string) => api.post<PTaxComputeResult>('/payroll/statutory/ptax/contributions/compute', { month }),
    onSuccess: (res, month) => {
      qc.invalidateQueries({ queryKey: ['ptax-contributions'] })
      const d = res?.data ?? res ?? {}
      const nonZero = d.computed_nonzero ?? d.computed_count ?? 0
      // Log the engine trace + per-employee resolved state — definitive diagnostic.
      if (d.sample_trace)      console.info('[P-Tax compute trace]', d.sample_trace)
      if (d.state_diagnostics) console.info('[P-Tax resolved states]', d.state_diagnostics)
      const diag: Array<{ code: string; state: string | null; source: string }> = d.state_diagnostics ?? []
      const noneState = diag.filter(x => !x.state)
      // If the first employees have no resolved state, that's the master-tagging gap.
      if (noneState.length > 0 && (d.computed_nonzero ?? 0) === 0) {
        toast.warning('P-Tax: no work state on employee(s)', {
          description: `${noneState.map(x => x.code).join(', ')} have no PT/LWF state set and their site has no state. Set the work state on the employee master (Bank & Statutory → PT/LWF State) or on the site.`,
        })
        return
      }
      const parts: string[] = []
      if (d.skipped_no_state)  parts.push(`${d.skipped_no_state} no work state`)
      if (d.skipped_no_slabs)  parts.push(`${d.skipped_no_slabs} no slabs${d.no_slab_states?.length ? ` for ${d.no_slab_states.join('/')}` : ''} (FY ${d.financial_year})`)
      if (d.computed_zero)     parts.push(`${d.computed_zero} matched but ₹0 (income below slab / frequency month)`)
      if (d.skipped_exempt)    parts.push(`${d.skipped_exempt} exempt`)

      if (nonZero > 0) {
        toast.success(`P-Tax computed for ${nonZero} employee${nonZero === 1 ? '' : 's'}`, {
          description: parts.length ? `Note: ${parts.join(', ')}` : `Month ${month}`,
        })
      } else {
        toast.warning('P-Tax: nothing deducted', {
          description: parts.length
            ? `${parts.join(', ')}.${d.skipped_no_slabs ? ' → Add slabs for that state.' : d.computed_zero ? ' → Check slab income bands / this month vs the slab frequency.' : d.skipped_no_state ? ' → Set the work state on the employee or site.' : ''}`
            : `No active employees / no finalized run for ${month}`,
        })
      }
    },
    onError: (e: unknown) => toast.error('Compute failed', { description: errMessage(e) ?? 'Finalize the payroll run for this month first.' }),
  })

  // UI state
  const [selectedStateCode, setSelectedStateCode] = useState<string>('')
  const [searchQuery, setSearchQuery]             = useState('')
  const [filterEnabled, setFilterEnabled]         = useState(false)
  const [showAddState, setShowAddState]           = useState(false)
  const [newStateCode, setNewStateCode]           = useState('')
  const [cdlg, setCdlg] = useState<{ msg: string; act: () => void } | null>(null)
  const [newStateName, setNewStateName]           = useState('')

  const addStateMutation = useMutation({
    mutationFn: () => api.put(`/payroll/statutory/ptax/states/${newStateCode.toUpperCase().trim()}`, {
      enabled:    true,
      state_name: newStateName.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptax-states'] })
      toast.success('State added', { description: `${newStateCode.toUpperCase()} enabled for PT` })
      setNewStateCode(''); setNewStateName(''); setShowAddState(false)
    },
    onError: (e: unknown) => toast.error('Failed to add state', { description: errMessage(e) }),
  })
  const [showAddSlabForm, setShowAddSlabForm]      = useState(false)

  // Registration state
  const [regNumber, setRegNumber] = useState('')
  const [regDate, setRegDate]     = useState('')
  const [regEditing, setRegEditing] = useState(false)

  // Slab form
  const [slabForm, setSlabForm] = useState({
    monthly_income_from: 0,
    monthly_income_to:   '' as string | number,
    monthly_tax:         0,
    gender:              'all',
  })
  const [slabError, setSlabError] = useState('')

  // ── State configs query ───────────────────────────────────────────────────────
  const {
    data: stateConfigs,
    isLoading: statesLoading,
    isError: statesError,
    refetch: refetchStates,
  } = useQuery<PTaxStateConfig[]>({
    queryKey: ['ptax-states'],
    queryFn:  () => api.get('/payroll/statutory/ptax/states')
      .then((r: unknown) => Array.isArray(r) ? r : Array.isArray((r as { data?: unknown }).data) ? (r as { data: unknown[] }).data : []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Set default selected state once loaded ────────────────────────────────────
  const stateList = useMemo(() => {
    const list = Array.isArray(stateConfigs) ? stateConfigs : []
    if (!selectedStateCode && list.length > 0) {
      // auto-select first enabled state, or first overall
      const first = list.find(s => s.enabled) ?? list[0]
      if (first) setSelectedStateCode(first.state_code)
    }
    return list
  }, [stateConfigs, selectedStateCode])

  // ── Toggle state mutation ─────────────────────────────────────────────────────
  const toggleStateMutation = useMutation({
    mutationFn: ({ stateCode, enabled }: { stateCode: string; enabled: boolean }) =>
      api.put(`/payroll/statutory/ptax/states/${stateCode}`, { enabled }),
    onSuccess: (_, { stateCode, enabled }) => {
      qc.invalidateQueries({ queryKey: ['ptax-states'] })
      toast.success(`P-Tax ${enabled ? 'enabled' : 'disabled'} for ${stateCode}`)
    },
    onError: (e: unknown) => {
      toast.error('Failed to update state configuration', { description: errMessage(e) })
    },
  })

  // ── Sync registration fields when selected state changes ─────────────────────
  useEffect(() => {
    const s = stateList.find(x => x.state_code === selectedStateCode)
    setRegNumber(s?.registration_number ?? '')
    setRegDate(s?.registration_date ?? '')
    setRegEditing(false)
  }, [selectedStateCode, stateList])

  // ── Save registration mutation ────────────────────────────────────────────────
  const saveRegMutation = useMutation({
    mutationFn: () => api.put(`/payroll/statutory/ptax/states/${selectedStateCode}`, {
      registration_number: regNumber || null,
      registration_date:   regDate   || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptax-states'] })
      toast.success('Registration details saved')
      setRegEditing(false)
    },
    onError: () => toast.error('Failed to save registration details'),
  })

  // ── Slabs query (filtered by selected state + FY) ─────────────────────────────
  const {
    data: slabs,
    isLoading: slabsLoading,
    isError: slabsError,
    refetch: refetchSlabs,
  } = useQuery<PTaxSlab[]>({
    queryKey: ['ptax-slabs', CURRENT_FY, selectedStateCode],
    queryFn:  () => {
      const params = new URLSearchParams({ financial_year: CURRENT_FY })
      if (selectedStateCode) params.set('state_code', selectedStateCode)
      return api.get(`/payroll/statutory/ptax/slabs?${params.toString()}`)
        .then((r: unknown) => Array.isArray(r) ? r : Array.isArray((r as { data?: unknown }).data) ? (r as { data: unknown[] }).data : [])
    },
    enabled:  isAdmin && !!selectedStateCode,
    staleTime: 30_000,
  })

  // ── Last 6 months history ─────────────────────────────────────────────────────
  const historyResults = useQueries({
    queries: last6.map(ym => ({
      queryKey: ['ptax-contributions', ym],
      queryFn:  () => api.get(`/payroll/statutory/ptax/contributions?month=${ym}`)
        .then((r: unknown) => Array.isArray(r) ? r : Array.isArray((r as { data?: unknown }).data) ? (r as { data: unknown[] }).data : []) as Promise<Array<{ state_code: string; ptax_amount: number }>>,
      enabled:  isAdmin,
      staleTime: 120_000,
    })),
  })

  // ── Add slab mutation ─────────────────────────────────────────────────────────
  const addSlabMutation = useMutation({
    mutationFn: () => api.post('/payroll/statutory/ptax/slabs', {
      state_code:          selectedStateCode,
      financial_year:      CURRENT_FY,
      monthly_income_from: slabForm.monthly_income_from,
      monthly_income_to:   slabForm.monthly_income_to === '' ? null : Number(slabForm.monthly_income_to),
      monthly_ptax:        slabForm.monthly_tax,
      gender:              slabForm.gender === 'all' ? undefined : slabForm.gender,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptax-slabs', CURRENT_FY, selectedStateCode] })
      toast.success('P-Tax slab added', { description: `${selectedStateCode} · ${CURRENT_FY}` })
      setShowAddSlabForm(false)
      setSlabForm({ monthly_income_from: 0, monthly_income_to: '', monthly_tax: 0, gender: 'all' })
      setSlabError('')
    },
    onError: (e: unknown) => {
      const msg = errMessage(e) ?? 'Failed to add slab'
      setSlabError(msg)
      toast.error('Failed to add P-Tax slab', { description: msg })
    },
  })

  // ── Delete slab mutation ──────────────────────────────────────────────────────
  const deleteSlabMutation = useMutation({
    mutationFn: (slabId: string) => api.delete(`/payroll/statutory/ptax/slabs/${slabId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptax-slabs', CURRENT_FY, selectedStateCode] })
      toast.success('P-Tax slab deleted')
    },
    onError: (e: unknown) => toast.error('Failed to delete slab', { description: errMessage(e) ?? undefined }),
  })

  // ── Derived data ──────────────────────────────────────────────────────────────
  const filteredStates = useMemo(() => stateList.filter(s => {
    const matchSearch = (s.state_name + s.state_code).toLowerCase().includes(searchQuery.toLowerCase())
    const matchFilter = filterEnabled ? s.enabled : true
    return matchSearch && matchFilter
  }), [stateList, searchQuery, filterEnabled])

  const selectedState  = stateList.find(s => s.state_code === selectedStateCode)
  const slabList       = Array.isArray(slabs) ? slabs : []
  const enabledCount   = stateList.filter(s => s.enabled).length

  const historyRows = last6.map((ym, i) => {
    const rows       = (historyResults[i]?.data ?? []) as Array<{ state_code: string; ptax_amount: number }>
    const total      = rows.reduce((s, c) => s + (Number(c.ptax_amount) || 0), 0)
    const states     = new Set(rows.map(c => c.state_code)).size
    const headcount  = rows.length
    return { ym, headcount, states, total, loading: historyResults[i]?.isLoading }
  })
  const historyLoading = historyResults.some(r => r.isLoading)

  // ── Guard ─────────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="p-6 rounded-lg border border-border bg-card flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 opacity-40" />
          <p className="text-sm">Only HR admins can access P-Tax management.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[
          { label: 'Payroll',   href: '/admin/payroll' },
          { label: 'Statutory', href: '/admin/payroll/statutory' },
          { label: 'P-Tax' },
        ]}
        title="Professional Tax Management"
        subtitle="Enact state-wise configurations, customise salary-band tax slabs, and monitor P-Tax compliance"
        actions={
          <div className="flex items-center gap-2">
            <StatutoryMonthPicker />
            {showAddState ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={newStateCode}
                  onChange={e => setNewStateCode(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="Code (e.g. HR)"
                  className="h-8 text-xs w-24"
                  onKeyDown={e => { if (e.key === 'Enter' && newStateCode.trim()) addStateMutation.mutate() }}
                />
                <Input
                  value={newStateName}
                  onChange={e => setNewStateName(e.target.value)}
                  placeholder="State name (optional)"
                  className="h-8 text-xs w-40"
                  onKeyDown={e => { if (e.key === 'Enter' && newStateCode.trim()) addStateMutation.mutate() }}
                />
                <Button size="sm" className="h-8 text-xs"
                  disabled={!newStateCode.trim() || addStateMutation.isPending}
                  onClick={() => addStateMutation.mutate()}>Add</Button>
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  onClick={() => { setShowAddState(false); setNewStateCode(''); setNewStateName('') }}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => setShowAddState(true)}>
                + Add State
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => computeMutation.mutate(viewMonth)}
              disabled={computeMutation.isPending || !viewMonth}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', computeMutation.isPending && 'animate-spin')} />
              Compute Contributions
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => { refetchStates(); refetchSlabs() }}
              disabled={statesLoading || slabsLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (statesLoading || slabsLoading) && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* ── Summary stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">

        {/* Jurisdictions enabled */}
        <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4 hover:border-border/80 transition-all">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Jurisdictions Enabled</span>
            <div className="text-2xl font-black text-foreground tracking-tight mt-0.5">
              {enabledCount}{' '}
              <span className="text-xs font-semibold text-muted-foreground">/ {stateList.length} States</span>
            </div>
          </div>
        </div>

        {/* Filing contributors */}
        <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4 hover:border-border/80 transition-all">
          <div className="h-10 w-10 rounded-xl bg-warning/10 border border-warning/30 flex items-center justify-center text-warning shrink-0">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">States Configured</span>
            <div className="text-2xl font-black text-foreground tracking-tight mt-0.5">
              {slabList.length}{' '}
              <span className="text-xs font-semibold text-muted-foreground">slabs for {selectedStateCode || '—'}</span>
            </div>
          </div>
        </div>

        {/* Selected state status */}
        <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4 hover:border-border/80 transition-all">
          <div className="h-10 w-10 rounded-xl bg-success/10 border border-success/30 flex items-center justify-center text-success shrink-0">
            <BadgeIndianRupee className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Selected State</span>
            <div className="text-2xl font-black text-foreground tracking-tight mt-0.5">
              {selectedState ? selectedState.state_name : '—'}
            </div>
            {selectedState && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full border mt-0.5 inline-block',
                selectedState.enabled
                  ? 'bg-success/10 text-success border-success/20 dark:bg-success/40 dark:text-success dark:border-success'
                  : 'bg-muted text-muted-foreground border-border',
              )}>
                {selectedState.enabled ? 'Active' : 'Inactive'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── State Grid + Slab Panel ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT: State grid */}
        <section className="bg-card rounded-2xl border border-border shadow-sm lg:col-span-7 flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-5 py-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/10">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h2 className="font-bold text-sm text-foreground">State Configurations Grid</h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search state…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-7 h-7 text-xs w-32"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {/* Enabled filter */}
              <button
                onClick={() => setFilterEnabled(!filterEnabled)}
                className={cn(
                  'px-2 py-1 border rounded-md text-[10px] font-bold flex items-center gap-1 transition-all',
                  filterEnabled
                    ? 'bg-primary/10 border-primary/20 text-primary'
                    : 'bg-background border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>Enabled ({enabledCount})</span>
              </button>
            </div>
          </div>

          {/* State cards grid */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto flex-1">
            {statesLoading
              ? Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-muted/40 border border-border animate-pulse" />
                ))
              : statesError
                ? <div className="col-span-full py-10 text-center text-xs text-destructive flex items-center justify-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Failed to load state configurations.
                  </div>
                : filteredStates.length === 0
                  ? <div className="col-span-full py-10 text-center text-xs text-muted-foreground">
                      No states match your search or filters.
                    </div>
                  : filteredStates.map(state => {
                      return (
                        <div
                          key={state.state_code}
                          onClick={() => setSelectedStateCode(state.state_code)}
                          className={cn(
                            'p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between h-20 group relative hover:shadow-sm',
                            selectedStateCode === state.state_code
                              ? 'bg-primary/5 border-primary/40 shadow-sm'
                              : 'bg-card border-border/50 hover:border-border hover:bg-muted/20',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-muted-foreground tracking-wider">
                              {state.state_code}
                            </span>
                            {/* Toggle */}
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                toggleStateMutation.mutate({ stateCode: state.state_code, enabled: !state.enabled })
                              }}
                              disabled={toggleStateMutation.isPending}
                              className="text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer transition-colors"
                              title={state.enabled ? 'Click to disable' : 'Click to enable'}
                            >
                              {state.enabled
                                ? <ToggleRight className="h-6 w-6 text-primary shrink-0" />
                                : <ToggleLeft className="h-6 w-6 text-muted-foreground/50 shrink-0" />
                              }
                            </button>
                          </div>
                          <div className="truncate">
                            <span className={cn(
                              'text-xs font-semibold block truncate',
                              selectedStateCode === state.state_code ? 'text-primary font-bold' : 'text-foreground',
                            )}>
                              {state.state_name}
                            </span>
                          </div>
                          {selectedStateCode === state.state_code && (
                            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                          )}
                        </div>
                      )
                    })
            }
          </div>

          <div className="bg-muted/30 px-5 py-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-primary" />
              Select a state to manage slabs &amp; settings.
            </span>
            <span className="font-mono text-[10px]">FY {CURRENT_FY}</span>
          </div>
        </section>

        {/* RIGHT: Slab management */}
        <section className="bg-card rounded-2xl border border-border shadow-sm lg:col-span-5 flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-5 py-4 border-b border-border/50 bg-muted/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-primary" />
              <div>
                <h3 className="font-black text-sm text-foreground tracking-tight">Slabs &amp; Parameters</h3>
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                  {selectedState ? `${selectedState.state_name} (${selectedState.state_code})` : 'No state selected'}
                </span>
              </div>
            </div>
            {selectedStateCode && (
              <button
                onClick={() => setShowAddSlabForm(v => !v)}
                className="px-2.5 py-1 text-[10px] font-bold text-primary bg-primary/10 hover:bg-primary/20 rounded-md cursor-pointer transition-all flex items-center gap-1"
              >
                <PlusCircle className="h-3 w-3" />
                <span>Add Slab</span>
              </button>
            )}
          </div>

          {/* Slab list */}
          <div className="p-5 flex-1 overflow-y-auto space-y-3">

            {/* Registration Details */}
            {selectedStateCode && (
              <div className="p-3.5 bg-muted/20 border border-border/50 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">PT Registration</span>
                  {!regEditing ? (
                    <button
                      onClick={() => setRegEditing(true)}
                      className="text-[9px] font-bold text-primary hover:text-primary/80 transition-colors"
                    >
                      Edit
                    </button>
                  ) : (
                    <button
                      onClick={() => setRegEditing(false)}
                      className="text-[9px] font-bold text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {!regEditing ? (
                  <div className="space-y-1">
                    <div>
                      <p className="text-[9px] text-muted-foreground">Registration No.</p>
                      <p className={cn('text-xs font-mono font-semibold', regNumber ? 'text-foreground' : 'text-muted-foreground/60')}>
                        {regNumber || '— not set'}
                      </p>
                    </div>
                    {regDate && (
                      <div>
                        <p className="text-[9px] text-muted-foreground">Registered On</p>
                        <p className="text-xs font-mono text-foreground">{regDate}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">PT Reg. Number</label>
                      <Input
                        value={regNumber}
                        onChange={e => setRegNumber(e.target.value)}
                        placeholder="e.g. PTRC-MH-12345"
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Registration Date</label>
                      <DateInput
                        value={regDate}
                        onChange={setRegDate}
                        className="h-7 text-xs"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="w-full h-7 text-xs"
                      disabled={saveRegMutation.isPending}
                      onClick={() => saveRegMutation.mutate()}
                    >
                      {saveRegMutation.isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</> : 'Save Registration'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Disabled warning */}
            {selectedState && !selectedState.enabled && (
              <div className="p-3 bg-warning/10 rounded-xl border border-warning/30 flex items-start gap-2.5 text-[11px] text-warning">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">P-Tax is disabled for {selectedState.state_name}.</span>
                  <p className="mt-0.5 opacity-80">Enable the state toggle to activate P-Tax collection.</p>
                </div>
              </div>
            )}

            {!selectedStateCode && (
              <div className="py-14 text-center flex flex-col items-center gap-2 text-muted-foreground">
                <Globe className="h-8 w-8 opacity-20" />
                <p className="text-xs font-medium">Select a state to view its slabs</p>
              </div>
            )}

            {selectedStateCode && slabsLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted/40 border border-border animate-pulse" />
                ))}
              </div>
            )}

            {selectedStateCode && slabsError && (
              <div className="flex items-center gap-2 text-xs text-destructive py-4">
                <AlertCircle className="h-3.5 w-3.5" />
                Failed to load slabs for {selectedStateCode}.
              </div>
            )}

            {selectedStateCode && !slabsLoading && !slabsError && slabList.length === 0 && (
              <div className="py-14 text-center border-2 border-dashed border-border rounded-2xl flex flex-col items-center gap-2 p-6 bg-muted/20">
                <span className="text-muted-foreground text-xs font-semibold">No slabs configured</span>
                <p className="text-[10px] text-muted-foreground max-w-[200px]">
                  Add slabs to define professional tax schedules based on salary bands.
                </p>
              </div>
            )}

            {slabList.map((slab, i) => (
              <div
                key={slab.id}
                className="p-3.5 bg-muted/30 hover:bg-muted/50 border border-border/50 rounded-xl flex items-center justify-between group transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
                    Slab {i + 1}
                  </span>
                  <span className="text-xs font-semibold text-foreground mt-0.5 block">
                    {slab.monthly_income_to == null
                      ? `Above ${fmtCurrency(slab.monthly_income_from)}`
                      : `${fmtCurrency(slab.monthly_income_from)} — ${fmtCurrency(slab.monthly_income_to)}`
                    }
                  </span>
                  {slab.gender && slab.gender !== 'all' && (
                    <span className="text-[10px] text-primary font-medium capitalize">{slab.gender} only</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">Monthly Levy</span>
                    <span className="text-sm font-black text-primary font-mono">₹{slab.monthly_ptax}</span>
                  </div>
                  {/* Delete slab — tenant-scoped hard delete (config data; past
                      filings are self-contained snapshots, so unaffected). */}
                  <button
                    className="p-1 rounded-md text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                    title="Delete slab"
                    disabled={deleteSlabMutation.isPending}
                    onClick={() => {
                      setCdlg({ msg: `Delete slab ${i + 1} for ${selectedStateCode}? This cannot be undone.`, act: () => deleteSlabMutation.mutate(slab.id) })
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Inline add-slab form — slides in at bottom */}
          {showAddSlabForm && selectedStateCode && (
            <div className="border-t border-border/50 bg-muted/30 p-5 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">New Slab — {selectedStateCode}</span>
                <button
                  type="button"
                  onClick={() => { setShowAddSlabForm(false); setSlabError('') }}
                  className="p-1 rounded-full hover:bg-muted text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-1">Income From (₹)</label>
                  <Input
                    type="number"
                    value={slabForm.monthly_income_from}
                    onChange={e => setSlabForm(f => ({ ...f, monthly_income_from: parseInt(e.target.value) || 0 }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-1">Income To (₹, blank = no limit)</label>
                  <Input
                    type="number"
                    value={slabForm.monthly_income_to}
                    onChange={e => setSlabForm(f => ({ ...f, monthly_income_to: e.target.value }))}
                    className="h-7 text-xs"
                    placeholder="No limit"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-1">Monthly Tax (₹)</label>
                  <Input
                    type="number"
                    value={slabForm.monthly_tax}
                    onChange={e => setSlabForm(f => ({ ...f, monthly_tax: parseInt(e.target.value) || 0 }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-1">Gender</label>
                  <select
                    value={slabForm.gender}
                    onChange={e => setSlabForm(f => ({ ...f, gender: e.target.value }))}
                    className="w-full h-7 text-xs rounded-md border border-input bg-background px-2"
                  >
                    <option value="all">All workers</option>
                    <option value="male">Male only</option>
                    <option value="female">Female only</option>
                  </select>
                </div>
              </div>

              {slabError && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  {slabError}
                </div>
              )}

              <div className="flex items-center justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowAddSlabForm(false); setSlabError('') }}
                  className="px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Discard
                </button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  disabled={addSlabMutation.isPending}
                  onClick={() => addSlabMutation.mutate()}
                >
                  {addSlabMutation.isPending
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Adding…</>
                    : <><Check className="h-3 w-3" />Add Slab</>
                  }
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Last 6 Months History ────────────────────────────────────────────── */}
      <SectionCard
        title="Last 6 Months — P-Tax Filing Register"
        icon={<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}
      >
        {historyLoading ? (
          <div className="divide-y divide-border animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-3 py-3">
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} className="h-3 bg-muted rounded flex-1" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Filing Cycle', 'Contributors', 'Active States', 'Total P-Tax Levy'].map(h => (
                    <th key={h} className="text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {historyRows.map(row => (
                  <tr key={row.ym} className={cn('hover:bg-muted/20 transition-colors', row.ym === todayYM && 'bg-primary/5')}>
                    <td className="px-3 py-2.5 text-xs font-semibold text-foreground whitespace-nowrap">
                      {fmtMonth(row.ym)}
                      {row.ym === todayYM && (
                        <span className="ml-1.5 text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Current</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">
                      {row.loading ? <span className="inline-block h-3 w-8 bg-muted rounded animate-pulse" /> : row.headcount === 0 ? <span className="text-muted-foreground">—</span> : `${row.headcount} employees`}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-foreground">
                      {row.loading ? <span className="inline-block h-3 w-8 bg-muted rounded animate-pulse" /> : row.headcount === 0 ? <span className="text-muted-foreground">—</span> : `${row.states} states`}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-semibold text-primary">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.headcount === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      <ConfirmDialog open={!!cdlg} message={cdlg?.msg ?? ''} title="Confirm" confirmLabel="Delete" destructive onConfirm={() => { cdlg?.act(); setCdlg(null) }} onCancel={() => setCdlg(null)} />
    </PageContainer>
  )
}
