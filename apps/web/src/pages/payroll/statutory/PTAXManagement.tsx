/**
 * PTAXManagement — /admin/payroll/statutory/ptax
 *
 * HR admin page for managing Professional Tax (P-Tax) state configs,
 * slab management, and monthly contributions.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Settings, RefreshCw, Loader2,
  AlertCircle, FileText, Plus, MapPin,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast }          from 'sonner'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PTaxSlab {
  id: string
  state_code: string
  financial_year: string
  monthly_income_from: number
  monthly_income_to: number | null
  monthly_tax: number
  gender: string
}

interface PTaxContribution {
  id: string
  employee_id: string
  contribution_month: string
  state_code: string
  monthly_income: number
  tax_amount: number
  status: string
  employee_code?: string
  employee_name?: string
}

interface PTaxStateConfig {
  state_code: string
  state_name: string
  enabled: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

const STATUS_BADGE: Record<string, string> = {
  filed:   'success',
  pending: 'warning',
  errored: 'destructive',
}

const CURRENT_FY = (() => {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-${String(year + 1).slice(2)}`
})()

// ── AddSlabDialog ─────────────────────────────────────────────────────────────

function AddSlabDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    state_code: '',
    financial_year: CURRENT_FY,
    monthly_income_from: 0,
    monthly_income_to: '' as string | number,
    monthly_tax: 0,
    gender: 'all',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.post('/payroll/statutory/ptax/slabs', {
      ...form,
      monthly_income_to: form.monthly_income_to === '' ? null : Number(form.monthly_income_to),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ptax-slabs'] })
      toast.success('P-Tax slab added', { description: `${form.state_code} · ${form.financial_year}` })
      onClose()
    },
    onError: (e: Error) => {
      setError(e?.message ?? 'Failed to add slab')
      toast.error('Failed to add P-Tax slab', { description: e.message })
    },
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4 text-muted-foreground" />
            Add P-Tax Slab
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {[
            { key: 'state_code',         label: 'State Code',          type: 'text' },
            { key: 'financial_year',     label: 'Financial Year',      type: 'text',   placeholder: 'e.g. 2025-26' },
            { key: 'monthly_income_from',label: 'Income From (₹)',      type: 'number' },
            { key: 'monthly_income_to',  label: 'Income To (₹, blank=no limit)', type: 'number' },
            { key: 'monthly_tax',        label: 'Monthly Tax (₹)',      type: 'number' },
          ].map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</label>
              <Input
                type={f.type}
                placeholder={f.placeholder}
                value={(form as any)[f.key]}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>
          ))}

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Gender</label>
            <select
              value={form.gender}
              onChange={e => setForm(prev => ({ ...prev, gender: e.target.value }))}
              className="w-full h-8 text-xs rounded-md border border-input bg-background px-3 py-1"
            >
              <option value="all">All</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-8 text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 h-8 text-xs"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Adding…</>
                : 'Add Slab'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PTAXManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const todayYM = new Date().toISOString().slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(todayYM)
  const [slabFY, setSlabFY]               = useState(CURRENT_FY)
  const [slabState, setSlabState]         = useState('')
  const [showAddSlab, setShowAddSlab]     = useState(false)

  // ── State configs query ───────────────────────────────────────────────────────
  const {
    data: stateConfigs,
    isLoading: statesLoading,
    isError: statesError,
    refetch: refetchStates,
  } = useQuery<PTaxStateConfig[]>({
    queryKey: ['ptax-states'],
    queryFn:  () => api.get('/payroll/statutory/ptax/states')
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Toggle state mutation ─────────────────────────────────────────────────────
  const toggleStateMutation = useMutation({
    mutationFn: ({ stateCode, enabled }: { stateCode: string; enabled: boolean }) =>
      api.put(`/payroll/statutory/ptax/states/${stateCode}`, { enabled }),
    onSuccess: (_, { stateCode, enabled }) => {
      qc.invalidateQueries({ queryKey: ['ptax-states'] })
      toast.success(`P-Tax ${enabled ? 'enabled' : 'disabled'} for ${stateCode}`)
    },
    onError: (e: any) => {
      toast.error('Failed to update state configuration', { description: (e as any)?.message })
    },
  })

  // ── Slabs query ───────────────────────────────────────────────────────────────
  const slabParams = new URLSearchParams()
  if (slabFY)    slabParams.set('financial_year', slabFY)
  if (slabState) slabParams.set('state_code', slabState)

  const {
    data: slabs,
    isLoading: slabsLoading,
    isError: slabsError,
    refetch: refetchSlabs,
  } = useQuery<PTaxSlab[]>({
    queryKey: ['ptax-slabs', slabFY, slabState],
    queryFn:  () => api.get(`/payroll/statutory/ptax/slabs?${slabParams.toString()}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    enabled:  isAdmin,
    staleTime: 30_000,
  })

  // ── Contributions query ───────────────────────────────────────────────────────
  const {
    data: contributions,
    isLoading: contribLoading,
    isError: contribError,
    refetch: refetchContrib,
  } = useQuery<PTaxContribution[]>({
    queryKey: ['ptax-contributions', selectedMonth],
    queryFn:  () => api.get(`/payroll/statutory/ptax/contributions?month=${selectedMonth}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    enabled:  isAdmin,
    staleTime: 30_000,
  })

  // ── Guard ─────────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard title="Access Restricted">
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm">Only HR admins can access P-Tax management.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const slabList    = Array.isArray(slabs)        ? slabs        : []
  const contribList = Array.isArray(contributions) ? contributions : []
  const stateList   = Array.isArray(stateConfigs)  ? stateConfigs  : []

  return (
    <PageContainer>
      <PageHeader
        title="Professional Tax Management"
        subtitle="Manage state-wise P-Tax slabs, configurations, and monthly contributions"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => { refetchStates(); refetchSlabs(); refetchContrib() }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* State Configs card */}
      <SectionCard
        title="State Configurations"
        icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
      >
        {statesLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
        )}
        {statesError && (
          <div className="flex items-center gap-2 text-xs text-destructive py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            Failed to load state configurations.
          </div>
        )}
        {!statesLoading && !statesError && (
          stateList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No states configured.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {stateList.map(s => (
                <div
                  key={s.state_code}
                  className="flex items-center justify-between p-3 rounded-md border border-border/50 bg-muted/20"
                >
                  <div>
                    <p className="text-xs font-medium text-foreground">{s.state_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{s.state_code}</p>
                  </div>
                  <button
                    type="button"
                    disabled={toggleStateMutation.isPending}
                    onClick={() => toggleStateMutation.mutate({ stateCode: s.state_code, enabled: !s.enabled })}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                      s.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                      toggleStateMutation.isPending && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <span className={cn(
                      'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                      s.enabled ? 'translate-x-4' : 'translate-x-1',
                    )} />
                  </button>
                </div>
              ))}
            </div>
          )
        )}
      </SectionCard>

      {/* Slab Management */}
      <SectionCard
        title="Slab Management"
        icon={<Settings className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            <Input
              placeholder="FY e.g. 2025-26"
              value={slabFY}
              onChange={e => setSlabFY(e.target.value)}
              className="h-7 text-xs w-28"
            />
            <Input
              placeholder="State code"
              value={slabState}
              onChange={e => setSlabState(e.target.value)}
              className="h-7 text-xs w-24"
            />
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setShowAddSlab(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Slab
            </Button>
          </div>
        }
      >
        {slabsLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
        )}
        {slabsError && (
          <div className="flex items-center gap-2 text-xs text-destructive py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            Failed to load slabs.
          </div>
        )}
        {!slabsLoading && !slabsError && (
          slabList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">State</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Financial Year</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Income From</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Income To</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Monthly Tax</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Gender</th>
                  </tr>
                </thead>
                <tbody>
                  {slabList.map(s => (
                    <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs font-mono font-medium">{s.state_code}</td>
                      <td className="px-3 py-2 text-xs">{s.financial_year}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(s.monthly_income_from)}</td>
                      <td className="px-3 py-2 text-xs font-mono">
                        {s.monthly_income_to != null ? fmtCurrency(s.monthly_income_to) : <span className="text-muted-foreground">No limit</span>}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono font-semibold text-warning">{fmtCurrency(s.monthly_tax)}</td>
                      <td className="px-3 py-2 text-xs capitalize">{s.gender}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </SectionCard>

      {/* Monthly Contributions */}
      <SectionCard
        title="Monthly Contributions"
        icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        action={
          <Input
            type="month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="h-7 text-xs w-36"
          />
        }
      >
        {contribLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
        )}
        {contribError && (
          <div className="flex items-center gap-2 text-xs text-destructive py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            Failed to load contributions.
          </div>
        )}
        {!contribLoading && !contribError && (
          contribList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No records found.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee Code</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee Name</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">State</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Monthly Income</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Tax Amount</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contribList.map(c => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{c.employee_code ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-medium">{c.employee_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-mono">{c.state_code}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.monthly_income)}</td>
                      <td className="px-3 py-2 text-xs font-mono font-semibold text-warning">{fmtCurrency(c.tax_amount)}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={(STATUS_BADGE[c.status] ?? 'secondary') as any}
                          className="rounded-full text-[10px] capitalize"
                        >
                          {c.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </SectionCard>

      {/* Add Slab Dialog */}
      {showAddSlab && <AddSlabDialog onClose={() => setShowAddSlab(false)} />}
    </PageContainer>
  )
}
