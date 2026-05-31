/**
 * ESIManagement — /admin/payroll/statutory/esi
 *
 * HR admin page for managing ESI (Employee State Insurance) configuration,
 * viewing monthly contributions, and checking employee eligibility.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Settings, RefreshCw, Loader2,
  AlertCircle, Users, DollarSign, Building2,
  FileText, Search, CheckCircle2, XCircle,
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

interface ESIConfig {
  id: string
  enabled: boolean
  employee_contribution_pct: number
  employer_contribution_pct: number
  wage_ceiling: number
}

interface ESIContribution {
  id: string
  employee_id: string
  contribution_month: string
  gross_wages: number
  employee_esi: number
  employer_esi: number
  total_contribution: number
  is_eligible: boolean
  status: string
  employee_code?: string
  employee_name?: string
}

interface ESIEligibility {
  is_eligible: boolean
  gross_wages: number
  reason?: string
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
  config: ESIConfig
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_contribution_pct: config.employee_contribution_pct,
    employer_contribution_pct: config.employer_contribution_pct,
    wage_ceiling: config.wage_ceiling,
    enabled: config.enabled,
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.put('/payroll/statutory/esi/config', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['esi-config'] })
      toast.success('ESI configuration updated')
      onClose()
    },
    onError: (e: Error) => {
      setError(e?.message ?? 'Failed to update ESI config')
      toast.error('Failed to update ESI configuration', { description: e.message })
    },
  })

  const fields: { key: keyof typeof form; label: string; step?: string }[] = [
    { key: 'employee_contribution_pct', label: 'Employee Contribution (%)', step: '0.01' },
    { key: 'employer_contribution_pct', label: 'Employer Contribution (%)', step: '0.01' },
    { key: 'wage_ceiling',              label: 'Wage Ceiling (₹)',          step: '1' },
  ]

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Edit ESI Configuration
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border">
            <span className="text-sm font-medium">ESI Enabled</span>
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
                type="number"
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

// ── EligibilityChecker ────────────────────────────────────────────────────────

function EligibilityChecker({ selectedMonth }: { selectedMonth: string }) {
  const [employeeId, setEmployeeId] = useState('')
  const [checked, setChecked]       = useState(false)

  const {
    data: eligibility,
    isLoading,
    isError,
    refetch,
  } = useQuery<ESIEligibility>({
    queryKey: ['esi-eligibility', employeeId, selectedMonth],
    queryFn:  () => api.get(`/payroll/statutory/esi/eligibility/${employeeId}?month=${selectedMonth}`),
    enabled:  false,
    staleTime: 30_000,
  })

  const handleCheck = () => {
    if (!employeeId.trim()) return
    setChecked(true)
    refetch()
  }

  return (
    <SectionCard
      title="Eligibility Checker"
      icon={<Search className="h-4 w-4 text-muted-foreground" />}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Enter Employee ID…"
            value={employeeId}
            onChange={e => { setEmployeeId(e.target.value); setChecked(false) }}
            className="h-8 text-xs flex-1"
          />
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={isLoading || !employeeId.trim()}
            onClick={handleCheck}
          >
            {isLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Search className="h-3.5 w-3.5" />
            }
            Check
          </Button>
        </div>

        {checked && isError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            Failed to check eligibility. Verify the employee ID.
          </div>
        )}

        {checked && eligibility && (
          <div className={cn(
            'p-3 rounded-md border text-xs space-y-1.5',
            eligibility.is_eligible
              ? 'bg-success/10 border-success/20'
              : 'bg-destructive/10 border-destructive/20',
          )}>
            <div className="flex items-center gap-2">
              {eligibility.is_eligible
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <XCircle className="h-4 w-4 text-destructive" />
              }
              <span className={cn(
                'font-semibold',
                eligibility.is_eligible ? 'text-success' : 'text-destructive',
              )}>
                {eligibility.is_eligible ? 'Eligible for ESI' : 'Not Eligible for ESI'}
              </span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Gross Wages:</span>
              <span className="font-medium text-foreground">{fmtCurrency(eligibility.gross_wages)}</span>
            </div>
            {eligibility.reason && (
              <p className="text-muted-foreground">{eligibility.reason}</p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ESIManagement() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const todayYM = new Date().toISOString().slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(todayYM)
  const [showEditConfig, setShowEditConfig] = useState(false)

  // ── Config query ─────────────────────────────────────────────────────────────
  const {
    data: config,
    isLoading: configLoading,
    isError: configError,
    refetch: refetchConfig,
  } = useQuery<ESIConfig>({
    queryKey: ['esi-config'],
    queryFn:  () => api.get('/payroll/statutory/esi/config'),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Contributions query ───────────────────────────────────────────────────────
  const {
    data: contributions,
    isLoading: contribLoading,
    isError: contribError,
    refetch: refetchContrib,
  } = useQuery<ESIContribution[]>({
    queryKey: ['esi-contributions', selectedMonth],
    queryFn:  () => api.get(`/payroll/statutory/esi/contributions?month=${selectedMonth}`)
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
            <p className="text-sm">Only HR admins can access ESI management.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Derived summary stats ─────────────────────────────────────────────────────
  const contribList        = Array.isArray(contributions) ? contributions : []
  const eligibleEmployees  = contribList.filter(c => c.is_eligible).length
  const totalEmployeeESI   = contribList.reduce((s, c) => s + (Number(c.employee_esi) || 0), 0)
  const totalEmployerESI   = contribList.reduce((s, c) => s + (Number(c.employer_esi) || 0), 0)

  return (
    <PageContainer>
      <PageHeader
        title="ESI Management"
        subtitle="Manage Employee State Insurance configuration and monthly contributions"
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
        <StatCard icon={Users}      label="Total Eligible Employees" value={eligibleEmployees} />
        <StatCard icon={DollarSign} label="Total Employee ESI"       value={fmtCurrency(totalEmployeeESI)} colorClass="text-warning" />
        <StatCard icon={Building2}  label="Total Employer ESI"       value={fmtCurrency(totalEmployerESI)} colorClass="text-success" />
      </div>

      {/* ESI Config card */}
      <SectionCard
        title="ESI Configuration"
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
            Failed to load ESI configuration.
          </div>
        )}
        {config && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Employee ESI', value: `${config.employee_contribution_pct}%` },
                { label: 'Employer ESI', value: `${config.employer_contribution_pct}%` },
                { label: 'Wage Ceiling', value: fmtCurrency(config.wage_ceiling) },
              ].map(({ label, value }) => (
                <div key={label} className="p-3 rounded-md bg-muted/30 border border-border/50">
                  <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-foreground">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-muted-foreground">Status:</span>
              <Badge variant={config.enabled ? 'success' : 'secondary'} className="rounded-full text-xs">
                {config.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
          </>
        )}
      </SectionCard>

      {/* Eligibility Checker */}
      <EligibilityChecker selectedMonth={selectedMonth} />

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
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Gross Wages</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employee ESI</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Employer ESI</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Total</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Eligible</th>
                    <th className="text-left text-xs text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contribList.map(c => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{c.employee_code ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-medium">{c.employee_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.gross_wages)}</td>
                      <td className="px-3 py-2 text-xs font-mono text-warning">{fmtCurrency(c.employee_esi)}</td>
                      <td className="px-3 py-2 text-xs font-mono">{fmtCurrency(c.employer_esi)}</td>
                      <td className="px-3 py-2 text-xs font-mono font-semibold text-success">{fmtCurrency(c.total_contribution)}</td>
                      <td className="px-3 py-2">
                        {c.is_eligible
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                      </td>
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
