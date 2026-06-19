/**
 * ESIManagement — /admin/payroll/statutory/esi
 *
 * HR admin page for managing ESI configuration and viewing current-month
 * contribution overview. Monthly ledger removed per product decision.
 *
 * Access: hr_admin and super_admin only.
 */

import React, { useState, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Settings, RefreshCw, Loader2,
  AlertCircle, Building, TrendingUp, BadgeIndianRupee,
  Info, Search, CheckCircle2, XCircle, FileSpreadsheet,
  Plus, Star, Trash2,
} from 'lucide-react'
import { ESIStatusBadge } from '@/components/payroll/StatutoryBadges'

import { toast }          from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api, ApiError } from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { StatutoryMonthPicker, useStatutoryMonth } from '@/components/compliance/StatutoryMonthPicker'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ESIRegistration {
  id: string
  registration_number: string
  code_label: string | null
  is_default: boolean
  site_id: string | null
  effective_from: string
  notes: string | null
}

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
  esi_wages: number
  employee_contribution: number
  employer_contribution: number
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

function getLast6Months(): string[] {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return d.toISOString().slice(0, 7)
  })
}

function fmtMonth(ym: string): string {
  const d = new Date(ym.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── ColoredStatCard ───────────────────────────────────────────────────────────

function ColoredStatCard({
  icon: Icon,
  label,
  value,
  sub,
  footer,
  footerValue,
  iconBg,
  iconBorder,
  iconColor,
  valueColor,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  footer?: string
  footerValue?: string
  iconBg: string
  iconBorder: string
  iconColor: string
  valueColor?: string
}) {
  return (
    <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex flex-col justify-between hover:border-border/80 transition-all">
      <div className="flex items-start justify-between">
        <div className="space-y-1 min-w-0">
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block truncate">{label}</span>
          <div className={cn('text-3xl font-black tracking-tight mt-1 flex items-baseline gap-1.5 flex-wrap', valueColor ?? 'text-foreground')}>
            <span>{value}</span>
            {sub && <span className="text-xs font-medium text-muted-foreground font-mono">{sub}</span>}
          </div>
        </div>
        <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 ml-2', iconBg, iconBorder, iconColor)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
      {(footer || footerValue) && (
        <div className="pt-3.5 mt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
          <span>{footer}</span>
          <span className="font-mono font-semibold text-foreground">{footerValue}</span>
        </div>
      )}
    </div>
  )
}

// ── ESI Rate Distribution Bar ─────────────────────────────────────────────────

function ESIRateBar({ config }: { config: ESIConfig }) {
  const emp  = config.employee_contribution_pct ?? 0
  const empr = config.employer_contribution_pct ?? 0
  const total = emp + empr

  return (
    <div className="space-y-3 pt-4 border-t border-border/50 mt-4">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
        Levy Rate Distribution
      </p>
      <div className="h-3.5 w-full bg-muted rounded-full overflow-hidden flex">
        <div
          className="bg-success h-full hover:opacity-80 transition-opacity cursor-help"
          style={{ width: `${(emp / total) * 100}%` }}
          title={`Employee Share: ${emp}%`}
        />
        <div
          className="bg-primary h-full hover:opacity-80 transition-opacity cursor-help"
          style={{ width: `${(empr / total) * 100}%` }}
          title={`Employer Share: ${empr}%`}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 text-xs pt-1">
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success shrink-0" />
            <span>Employee Share</span>
          </div>
          <strong className="text-base text-foreground font-black font-mono">{emp}%</strong>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
            <span>Employer Share</span>
          </div>
          <strong className="text-base text-foreground font-black font-mono">{empr}%</strong>
        </div>
      </div>
      <div className="flex justify-between items-center pt-1 border-t border-border/30 text-xs">
        <span className="text-muted-foreground">Aggregate Welfare Factor</span>
        <strong className="text-foreground font-bold font-mono">{total.toFixed(2)}% <span className="font-normal text-muted-foreground">total joint premium</span></strong>
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
    enabled:                   config.enabled,
    employee_contribution_pct: config.employee_contribution_pct,
    employer_contribution_pct: config.employer_contribution_pct,
    wage_ceiling:              config.wage_ceiling,
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.put('/payroll/statutory/esi/config', {
      ...form,
      effective_from: new Date().toISOString().slice(0, 10),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['esi-config'] })
      toast.success('ESI configuration updated')
      onClose()
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Failed to update ESI config'
      setError(msg)
      toast.error('Failed to update ESI configuration', { description: msg })
    },
  })

  const numFields: { key: keyof typeof form; label: string; step: string }[] = [
    { key: 'employee_contribution_pct', label: 'Employee Contribution (%)', step: '0.01' },
    { key: 'employer_contribution_pct', label: 'Employer Contribution (%)', step: '0.01' },
    { key: 'wage_ceiling',              label: 'Wage Ceiling (₹)',          step: '1'    },
  ]

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Configure ESI Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Enabled toggle */}
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Enable ESI withholding</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Toggle off if ESI withholding has been suspended temporarily.</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-3',
                form.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                form.enabled ? 'translate-x-4' : 'translate-x-1',
              )} />
            </button>
          </div>

          {numFields.map(f => (
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
            <Button variant="outline" className="flex-1 h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button
              className="flex-1 h-8 text-xs"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</>
                : 'Update Parameters'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── EligibilityChecker ────────────────────────────────────────────────────────

function EligibilityChecker() {
  const [employeeId, setEmployeeId] = useState('')
  const [checked, setChecked]       = useState(false)

  const { data: eligibility, isLoading, isError, refetch } = useQuery<ESIEligibility>({
    queryKey: ['esi-eligibility-check', employeeId],
    queryFn:  () => api.get<{ data?: { is_esi_applicable?: boolean; gross_wages?: number; reason?: string }[] }>(`/payroll/statutory/esi/eligibility?employee_id=${employeeId}`).then((r) => {
      const rows   = Array.isArray(r?.data) ? r.data : []
      const latest = rows[0]
      if (!latest) return { is_eligible: false, gross_wages: 0, reason: 'No eligibility record found' }
      return {
        is_eligible: latest.is_esi_applicable ?? false,
        gross_wages: latest.gross_wages ?? 0,
        reason:      latest.reason ?? undefined,
      }
    }),
    enabled:   false,
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
          <EmployeeSelector
            placeholder="Search employee by name or code…"
            value={employeeId}
            onChange={v => { setEmployeeId(typeof v === 'string' ? v : (v[0] ?? '')); setChecked(false) }}
            className="flex-1"
          />
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            disabled={isLoading || !employeeId.trim()}
            onClick={handleCheck}
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
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
            eligibility.is_eligible ? 'bg-success/10 border-success/20' : 'bg-destructive/10 border-destructive/20',
          )}>
            <div className="flex items-center gap-2">
              {eligibility.is_eligible
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <XCircle className="h-4 w-4 text-destructive" />
              }
              <span className={cn('font-semibold', eligibility.is_eligible ? 'text-success' : 'text-destructive')}>
                {eligibility.is_eligible ? 'Eligible for ESI' : 'Not Eligible for ESI'}
              </span>
              <ESIStatusBadge status={eligibility.is_eligible ? 'eligible' : 'not_applicable'} className="ml-auto" />
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Gross Wages:</span>
              <span className="font-medium text-foreground">{fmtCurrency(eligibility.gross_wages)}</span>
            </div>
            {eligibility.reason && <p className="text-muted-foreground">{eligibility.reason}</p>}
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
  const [viewMonth] = useStatutoryMonth()   // shared across all Compliance tabs
  const last6   = useMemo(() => getLast6Months(), [])
  const [showEditConfig, setShowEditConfig] = useState(false)

  // ── Config query ─────────────────────────────────────────────────────────────
  const {
    data: config,
    isLoading: configLoading,
    isError: configError,
    refetch: refetchConfig,
  } = useQuery<ESIConfig>({
    queryKey: ['esi-config'],
    queryFn:  () => api.get<{ data?: ESIConfig } & ESIConfig>('/payroll/statutory/esi/config').then((r) => r?.data ?? r),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Registrations ─────────────────────────────────────────────────────────────
  const {
    data: registrationsData,
    isLoading: registrationsLoading,
  } = useQuery<ESIRegistration[]>({
    queryKey: ['esi-registrations'],
    queryFn:  () => api.get<{ data?: ESIRegistration[] }>('/payroll/statutory/esi/registrations').then((r) => r?.data ?? []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const registrations = Array.isArray(registrationsData) ? registrationsData : []

  const [showAddReg, setShowAddReg] = useState(false)
  const [regForm, setRegForm] = useState({ registration_number: '', code_label: '', is_default: false })

  const qc = useQueryClient()

  const addRegMutation = useMutation({
    mutationFn: () => api.post('/payroll/statutory/esi/registrations', {
      registration_number: regForm.registration_number,
      code_label: regForm.code_label || undefined,
      is_default: regForm.is_default,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['esi-registrations'] })
      toast.success('Registration code added')
      setShowAddReg(false)
      setRegForm({ registration_number: '', code_label: '', is_default: false })
    },
    onError: () => toast.error('Failed to add registration code'),
  })

  const setDefaultRegMutation = useMutation({
    mutationFn: (regId: string) => api.put(`/payroll/statutory/esi/registrations/${regId}`, { is_default: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['esi-registrations'] })
      toast.success('Default registration updated')
    },
    onError: () => toast.error('Failed to update default'),
  })

  const deleteRegMutation = useMutation({
    mutationFn: (regId: string) => api.delete(`/payroll/statutory/esi/registrations/${regId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['esi-registrations'] })
      toast.success('Registration removed')
    },
    onError: () => toast.error('Failed to remove registration'),
  })

  // ── Contributions query (current-month summary for stat cards only) ──────────
  const {
    data: contributions,
    isLoading: contribLoading,
    refetch: refetchContrib,
  } = useQuery<ESIContribution[]>({
    queryKey: ['esi-contributions', viewMonth],
    queryFn:  () => api.get(`/payroll/statutory/esi/contributions?month=${viewMonth}`)
      .then((r: unknown) => Array.isArray(r) ? r : Array.isArray((r as { data?: unknown })?.data) ? (r as { data: ESIContribution[] }).data : []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Manual contribution compute (also runs automatically on payroll finalize) ──
  const computeMutation = useMutation({
    mutationFn: (month: string) => api.post('/payroll/statutory/esi/contributions/compute', { month }),
    onSuccess: (_d, month) => {
      qc.invalidateQueries({ queryKey: ['esi-contributions'] })
      refetchContrib()
      toast.success('ESI contributions computed', { description: `Month ${month}` })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { message?: string } }; message?: string }
      toast.error('Compute failed', { description: err?.response?.data?.message ?? err?.message ?? 'Finalize the payroll run for this month first.' })
    },
  })

  // ── Last 6 months (history table) ─────────────────────────────────────────────
  const historyResults = useQueries({
    queries: last6.map(ym => ({
      queryKey: ['esi-contributions', ym],
      queryFn:  () => api.get(`/payroll/statutory/esi/contributions?month=${ym}`)
        .then((r: unknown) => Array.isArray(r) ? r : Array.isArray((r as { data?: unknown })?.data) ? (r as { data: ESIContribution[] }).data : []) as Promise<ESIContribution[]>,
      enabled:  isAdmin,
      staleTime: 120_000,
    })),
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
  const contribList       = Array.isArray(contributions) ? contributions : []
  const totalEmployees    = contribList.length
  const eligibleEmployees = contribList.filter(c => c.is_eligible).length
  const totalEmployeeESI  = contribList.reduce((s, c) => s + (Number(c.employee_contribution) || 0), 0)
  const totalEmployerESI  = contribList.reduce((s, c) => s + (Number(c.employer_contribution) || 0), 0)

  const historyRows = last6.map((ym, i) => {
    const rows     = (historyResults[i]?.data ?? []) as ESIContribution[]
    const total    = rows.length
    const eligible = rows.filter(c => c.is_eligible).length
    const wages    = rows.reduce((s, c) => s + (Number(c.esi_wages)              || 0), 0)
    const empESI   = rows.reduce((s, c) => s + (Number(c.employee_contribution)  || 0), 0)
    const emprESI  = rows.reduce((s, c) => s + (Number(c.employer_contribution)  || 0), 0)
    return { ym, total, eligible, wages, empESI, emprESI, loading: historyResults[i]?.isLoading }
  })
  const historyLoading = historyResults.some(r => r.isLoading)

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[
          { label: 'Payroll',   href: '/admin/payroll' },
          { label: 'Statutory', href: '/admin/payroll/statutory' },
          { label: 'ESI' },
        ]}
        title="ESI Management"
        subtitle="Administer employee health insurance contributions, ceiling criteria, and state filing compliance"
        actions={
          <div className="flex items-center gap-2">
            <StatutoryMonthPicker />
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
              onClick={() => { refetchConfig(); refetchContrib() }}
              disabled={configLoading || contribLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (configLoading || contribLoading) && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* ── Summary stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {contribLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-card p-5 rounded-2xl border border-border animate-pulse flex flex-col gap-3">
                <div className="h-8 w-8 rounded-lg bg-muted ml-auto" />
                <div className="h-6 w-32 bg-muted rounded" />
                <div className="h-3 w-24 bg-muted rounded" />
              </div>
            ))
          : <>
              <ColoredStatCard
                icon={Building}
                label="Filing Eligible Headcount"
                value={eligibleEmployees}
                sub={`/ ${totalEmployees} active workforce`}
                footer="Corporate Scope:"
                footerValue={todayYM}
                iconBg="bg-orange-50 dark:bg-orange-950/40"
                iconBorder="border-orange-100 dark:border-orange-800"
                iconColor="text-orange-600 dark:text-orange-400"
              />
              <ColoredStatCard
                icon={TrendingUp}
                label="Filing Employee ESI"
                value={fmtCurrency(totalEmployeeESI)}
                sub={`${config?.employee_contribution_pct ?? 0.75}% share`}
                footer="ESI Wage Base:"
                footerValue={fmtCurrency(contribList.reduce((s, c) => s + (Number(c.esi_wages) || 0), 0))}
                iconBg="bg-emerald-50 dark:bg-emerald-950/40"
                iconBorder="border-emerald-100 dark:border-emerald-800"
                iconColor="text-emerald-600 dark:text-emerald-400"
              />
              <ColoredStatCard
                icon={BadgeIndianRupee}
                label="Filing Employer ESI"
                value={fmtCurrency(totalEmployerESI)}
                sub={`${config?.employer_contribution_pct ?? 3.25}% rate`}
                footer="Aggregated Filing Levy:"
                footerValue={fmtCurrency(totalEmployeeESI + totalEmployerESI)}
                iconBg="bg-primary/10"
                iconBorder="border-primary/20"
                iconColor="text-primary"
                valueColor="text-primary"
              />
            </>
        }
      </div>

      {/* ── ESI Configuration card ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left: parameters */}
        <div className="lg:col-span-8">
          <SectionCard
            title="State Health Insurance Scheme Parameters"
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
                Configure ESI Details
              </Button>
            }
          >
            {configLoading && (
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
              </div>
            )}
            {configError && (
              <div className="flex items-center gap-2 text-xs text-destructive py-2">
                <AlertCircle className="h-3.5 w-3.5" />
                Failed to load ESI configuration.
              </div>
            )}
            {config && (
              <>
                {/* ESIC Registration Codes */}
                <div className="pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">ESIC Registration Codes</span>
                    <button
                      onClick={() => setShowAddReg(v => !v)}
                      className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add Code
                    </button>
                  </div>

                  {registrationsLoading ? (
                    <div className="space-y-1.5">
                      {[0,1].map(i => <div key={i} className="h-10 bg-muted/40 rounded-lg animate-pulse" />)}
                    </div>
                  ) : registrations.length === 0 ? (
                    <div className="py-4 text-center border-2 border-dashed border-border/40 rounded-xl text-xs text-muted-foreground">
                      No registration codes added yet.{' '}
                      <button className="text-primary font-semibold hover:underline" onClick={() => setShowAddReg(true)}>Add one</button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {registrations.map(reg => (
                        <div key={reg.id} className={cn(
                          'flex items-center justify-between p-2.5 rounded-lg border text-xs',
                          reg.is_default ? 'bg-primary/5 border-primary/30' : 'bg-muted/30 border-border/50',
                        )}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="font-mono font-semibold text-foreground truncate">{reg.registration_number}</span>
                              {reg.is_default && (
                                <span className="text-[9px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
                                  <Star className="h-2.5 w-2.5" />Default
                                </span>
                              )}
                            </div>
                            {reg.code_label && <span className="text-muted-foreground">{reg.code_label}</span>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 ml-2">
                            {!reg.is_default && (
                              <button
                                onClick={() => setDefaultRegMutation.mutate(reg.id)}
                                disabled={setDefaultRegMutation.isPending}
                                className="text-[9px] font-bold text-muted-foreground hover:text-primary border border-border/50 hover:border-primary/30 px-1.5 py-0.5 rounded transition-colors"
                                title="Set as default"
                              >
                                Set Default
                              </button>
                            )}
                            <button
                              onClick={() => deleteRegMutation.mutate(reg.id)}
                              disabled={deleteRegMutation.isPending}
                              className="p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Remove"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline add form */}
                  {showAddReg && (
                    <div className="mt-3 p-3 bg-muted/20 border border-border/50 rounded-xl space-y-2">
                      <span className="text-[9px] font-bold text-primary uppercase tracking-wider">New ESIC Registration Code</span>
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">ESIC Employer Code *</label>
                        <Input
                          value={regForm.registration_number}
                          onChange={e => setRegForm(f => ({ ...f, registration_number: e.target.value.slice(0, 17) }))}
                          placeholder="12345678901234567"
                          maxLength={17}
                          className="h-7 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Label (optional)</label>
                        <Input
                          value={regForm.code_label}
                          onChange={e => setRegForm(f => ({ ...f, code_label: e.target.value }))}
                          placeholder="e.g. Mumbai HO, Pune Factory"
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="esi-reg-default"
                          checked={regForm.is_default}
                          onChange={e => setRegForm(f => ({ ...f, is_default: e.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                        <label htmlFor="esi-reg-default" className="text-xs text-muted-foreground">Set as default registration</label>
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => { setShowAddReg(false); setRegForm({ registration_number: '', code_label: '', is_default: false }) }}
                          className="flex-1 h-7 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/50 rounded-md transition-colors"
                        >
                          Cancel
                        </button>
                        <Button
                          size="sm"
                          className="flex-1 h-7 text-xs"
                          disabled={!regForm.registration_number || addRegMutation.isPending}
                          onClick={() => addRegMutation.mutate()}
                        >
                          {addRegMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Rate grid */}
                <div className="grid grid-cols-3 gap-4 pb-4 font-mono">
                  {[
                    { label: 'Employee Rate',   value: `${config.employee_contribution_pct}%` },
                    { label: 'Employer Rate',   value: `${config.employer_contribution_pct}%` },
                    { label: 'Wage Ceiling',    value: fmtCurrency(config.wage_ceiling) },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3.5 bg-muted/30 rounded-xl border border-border/50">
                      <p className="text-[9px] font-sans font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
                      <p className="text-lg font-black text-foreground mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Scope info row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 border-t border-border/40 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0">
                      <Info className="h-3 w-3" />
                    </span>
                    <span>
                      Staff with gross wages ≤ <strong className="text-foreground">₹{(config.wage_ceiling ?? 0).toLocaleString('en-IN')}</strong> fall in scope.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Scope Status:</span>
                    {config.enabled ? (
                      <Badge variant="success" className="rounded-full text-[10px]">Active In Force</Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-full text-[10px]">Deactivated</Badge>
                    )}
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </div>

        {/* Right: rate distribution */}
        <div className="lg:col-span-4">
          <SectionCard title="ESI Contributions Breakdown">
            {config
              ? <ESIRateBar config={config} />
              : <div className="py-8 text-center text-xs text-muted-foreground">Loading config…</div>
            }
          </SectionCard>
        </div>
      </div>

      {/* ── Eligibility Checker ────────────────────────────────────────────── */}
      <EligibilityChecker />

      {/* ── Last 6 Months History ────────────────────────────────────────────── */}
      <SectionCard
        title="Last 6 Months — ESI Filing Register"
        icon={<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}
      >
        {historyLoading ? (
          <div className="divide-y divide-border animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-3 py-3">
                {Array.from({ length: 7 }).map((__, j) => (
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
                  {['Filing Cycle', 'Total Staff', 'Eligible', 'ESI Wage Base', 'Employee ESI', 'Employer ESI', 'Total Levy'].map(h => (
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
                      {row.loading ? <span className="inline-block h-3 w-8 bg-muted rounded animate-pulse" /> : row.total}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-foreground">
                      {row.loading ? <span className="inline-block h-3 w-8 bg-muted rounded animate-pulse" /> : row.total === 0 ? <span className="text-muted-foreground">—</span> : row.eligible}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.total === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.wages)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-success font-semibold">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.total === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.empESI)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-primary font-semibold">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.total === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.emprESI)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-bold text-foreground">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.total === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.empESI + row.emprESI)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Edit Config Dialog */}
      {showEditConfig && config && (
        <EditConfigDialog config={config} onClose={() => setShowEditConfig(false)} />
      )}
    </PageContainer>
  )
}
