/**
 * EPFManagement — /admin/payroll/statutory/epf
 *
 * HR admin page for managing EPF (Employee Provident Fund) configuration
 * and viewing monthly EPF contributions.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Settings, RefreshCw, Loader2,
  AlertCircle, Users, DollarSign, Building2,
  FileText, Play,
} from 'lucide-react'

import { toast }          from 'sonner'
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
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EPFConfig {
  id: string
  enabled: boolean
  employee_contribution_pct: number
  employer_contribution_pct: number
  eps_contribution_pct: number
  edli_contribution_pct: number
  wage_ceiling: number
  admin_charges_pct: number
  created_at: string
}

interface EPFContribution {
  id: string
  employee_id: string
  contribution_month: string
  epf_wages: number
  employee_epf: number
  employer_epf: number
  employer_eps: number
  edli: number
  total_employer_contribution: number
  status: string
  employee_code?: string
  employee_name?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtPct(n: number): string {
  return `${n}%`
}

const STATUS_BADGE: Record<string, string> = {
  filed:   'success',
  pending: 'warning',
  errored: 'destructive',
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  colorClass = 'text-foreground',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  colorClass?: string
}) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card flex items-start gap-3">
      <div className="p-2 rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('text-lg font-bold mt-0.5', colorClass)}>{value}</p>
      </div>
    </div>
  )
}

// ── EditConfigDialog ──────────────────────────────────────────────────────────

function EditConfigDialog({
  config,
  onClose,
}: {
  config: EPFConfig
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_contribution_pct: config.employee_contribution_pct,
    employer_contribution_pct: config.employer_contribution_pct,
    eps_contribution_pct: config.eps_contribution_pct,
    edli_contribution_pct: config.edli_contribution_pct,
    wage_ceiling: config.wage_ceiling,
    admin_charges_pct: config.admin_charges_pct,
    enabled: config.enabled,
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.put('/payroll/statutory/epf/config', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epf-config'] })
      toast.success('EPF configuration updated')
      onClose()
    },
    onError: (e: Error) => {
      setError(e?.message ?? 'Failed to update EPF config')
      toast.error('Failed to update EPF configuration', { description: e.message })
    },
  })

  const fields: { key: keyof typeof form; label: string; type: string; step?: string }[] = [
    { key: 'employee_contribution_pct', label: 'Employee Contribution (%)', type: 'number', step: '0.01' },
    { key: 'employer_contribution_pct', label: 'Employer Contribution (%)', type: 'number', step: '0.01' },
    { key: 'eps_contribution_pct',      label: 'EPS Contribution (%)',      type: 'number', step: '0.01' },
    { key: 'edli_contribution_pct',     label: 'EDLI Contribution (%)',     type: 'number', step: '0.01' },
    { key: 'wage_ceiling',              label: 'Wage Ceiling (₹)',          type: 'number', step: '1' },
    { key: 'admin_charges_pct',         label: 'Admin Charges (%)',         type: 'number', step: '0.01' },
  ]

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Edit EPF Configuration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border">
            <span className="text-sm font-medium">EPF Enabled</span>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                form.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                form.enabled ? 'translate-x-4' : 'translate-x-1',
              )} />
            </button>
          </div>

          {fields.map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</label>
              <Input
                type={f.type}
                step={f.step}
                value={form[f.key] as number}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))}
                className="h-8 text-xs"
              />
            </div>
          ))}

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
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</>
                : 'Save Changes'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function EPFManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const todayYM = new Date().toISOString().slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(todayYM)
  const [showEditConfig, setShowEditConfig] = useState(false)
  const [generateError, setGenerateError]   = useState('')

  // ── Config query ─────────────────────────────────────────────────────────────
  const {
    data: config,
    isLoading: configLoading,
    isError: configError,
    refetch: refetchConfig,
  } = useQuery<EPFConfig>({
    queryKey: ['epf-config'],
    queryFn:  () => api.get('/payroll/statutory/epf/config'),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Contributions query ───────────────────────────────────────────────────────
  const {
    data: contributions,
    isLoading: contribLoading,
    isError: contribError,
    refetch: refetchContrib,
  } = useQuery<EPFContribution[]>({
    queryKey: ['epf-contributions', selectedMonth],
    queryFn:  () => api.get(`/payroll/statutory/epf/contributions?month=${selectedMonth}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    enabled:  isAdmin,
    staleTime: 30_000,
  })

  // ── Generate mutation ─────────────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: () => api.post('/payroll/statutory/epf/generate', { month: selectedMonth }),
    onSuccess: () => {
      setGenerateError('')
      qc.invalidateQueries({ queryKey: ['epf-contributions', selectedMonth] })
      toast.success('EPF contributions generated', { description: `Month: ${selectedMonth}` })
    },
    onError: (e: any) => {
      const msg = (e as any)?.message ?? 'Failed to generate EPF contributions'
      setGenerateError(msg)
      toast.error('EPF generation failed', { description: msg })
    },
  })

  // ── Guard ─────────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard title="Access Restricted">
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm">Only HR admins can access EPF management.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Derived summary stats ─────────────────────────────────────────────────────
  const contribList = Array.isArray(contributions) ? contributions : []
  const totalEmployees        = contribList.length
  const totalEmployeeContrib  = contribList.reduce((s, c) => s + (Number(c.employee_epf) || 0), 0)
  const totalEmployerContrib  = contribList.reduce((s, c) => s + (Number(c.total_employer_contribution) || 0), 0)

  return (
    <PageContainer>
      <PageHeader
        title="EPF Management"
        subtitle="Manage Employee Provident Fund configuration and monthly contributions"
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => { refetchConfig(); refetchContrib() }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Users}      label="Total Employees"            value={totalEmployees} />
        <StatCard icon={DollarSign} label="Total Employee Contribution" value={fmtCurrency(totalEmployeeContrib)} colorClass="text-warning" />
        <StatCard icon={Building2}  label="Total Employer Contribution" value={fmtCurrency(totalEmployerContrib)} colorClass="text-success" />
      </div>

      {/* EPF Config card */}
      <SectionCard
        title="EPF Configuration"
        icon={<Settings className="h-4 w-4 text-muted-foreground" />}
        action={
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => setShowEditConfig(true)}
            disabled={!config}
          >
            <Settings className="h-3.5 w-3.5" />
            Edit Config
          </Button>
        }
      >
        {configLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-4">Loading…</div>
        )}
        {configError && (
          <div className="flex items-center gap-2 text-xs text-destructive py-2">
            <AlertCircle className="h-3.5 w-3.5" />
            Failed to load EPF configuration.
          </div>
        )}
        {config && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Employee EPF', value: fmtPct(config.employee_contribution_pct) },
              { label: 'Employer EPF', value: fmtPct(config.employer_contribution_pct) },
              { label: 'EPS',          value: fmtPct(config.eps_contribution_pct) },
              { label: 'EDLI',         value: fmtPct(config.edli_contribution_pct) },
              { label: 'Wage Ceiling', value: fmtCurrency(config.wage_ceiling) },
              { label: 'Admin Charges',value: fmtPct(config.admin_charges_pct) },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-md bg-muted/30 border border-border/50">
                <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        )}
        {config && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-muted-foreground">Status:</span>
            <Badge variant={config.enabled ? 'success' : 'secondary'} className="rounded-full text-xs">
              {config.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        )}
      </SectionCard>

      {/* Monthly Contributions */}
      <SectionCard
        title="Monthly Contributions"
        icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        action={
          <div className="flex items-center gap-2">
            <Input
              type="month"
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="h-7 text-xs w-36"
            />
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Play className="h-3.5 w-3.5" />
              }
              Generate
            </Button>
          </div>
        }
      >
        {generateError && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive mb-3">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {generateError}
          </div>
        )}

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
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">EPF Wages</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee EPF</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employer EPF</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">EPS</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">EDLI</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Total Employer</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contribList.map(c => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{c.employee_code ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-medium">{c.employee_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.epf_wages)}</td>
                      <td className="px-3 py-2 text-xs font-mono text-warning">{fmtCurrency(c.employee_epf)}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.employer_epf)}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.employer_eps)}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.edli)}</td>
                      <td className="px-3 py-2 text-xs font-mono font-semibold text-success">{fmtCurrency(c.total_employer_contribution)}</td>
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

      {/* Edit Config Dialog */}
      {showEditConfig && config && (
        <EditConfigDialog config={config} onClose={() => setShowEditConfig(false)} />
      )}
    </PageContainer>
  )
}
