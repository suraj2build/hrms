/**
 * EPFManagement — /admin/payroll/statutory/epf
 *
 * HR admin page for managing EPF (Employee Provident Fund) configuration.
 * Access: hr_admin and super_admin only.
 */

import React, { useState, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ShieldAlert, Settings, RefreshCw, Loader2,
  AlertCircle, Building, TrendingUp, ShieldCheck,
  Info, FileSpreadsheet, Plus, Star, Trash2,
} from 'lucide-react'
import { PFModeBadge } from '@/components/payroll/StatutoryBadges'

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
import { api, ApiError } from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EPFConfig {
  id: string
  employee_contribution_pct: number
  employer_pf_pct: number
  employer_eps_pct: number
  wage_ceiling: number
  is_wage_ceiling_applicable: boolean
  allow_voluntary_pf: boolean
  pf_account_number: string | null
  establishment_code: string | null
  effective_from: string
}

interface EPFRegistration {
  id: string
  registration_number: string
  code_label: string | null
  is_default: boolean
  pf_sub_code: string | null
  site_id: string | null
  effective_from: string
  notes: string | null
}

interface EPFContribution {
  id: string
  employee_id: string
  contribution_month: string
  pf_wages: number
  employee_contribution: number
  employer_pf: number
  employer_eps: number
  edli_contribution: number
  total_employer_contribution: number
  is_capped: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtPct(n: number): string { return `${n}%` }

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
  icon: Icon, label, value, sub,
  iconBg, iconBorder, iconColor, valueColor,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  iconBg: string; iconBorder: string; iconColor: string; valueColor?: string
}) {
  return (
    <div className="bg-card p-5 rounded-2xl border border-border shadow-sm flex items-center gap-4 hover:border-border/80 transition-all">
      <div className={cn('h-10 w-10 rounded-xl border flex items-center justify-center shrink-0', iconBg, iconBorder, iconColor)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block truncate">{label}</span>
        <div className={cn('text-2xl font-black tracking-tight mt-0.5 flex items-baseline gap-1.5 flex-wrap', valueColor ?? 'text-foreground')}>
          <span>{value}</span>
          {sub && <span className="text-xs font-semibold text-muted-foreground normal-case">{sub}</span>}
        </div>
      </div>
    </div>
  )
}

// ── EPF Rate Bar (right-column card) ──────────────────────────────────────────

function EPFRateBar({ config }: { config: EPFConfig }) {
  const empRate     = config.employee_contribution_pct ?? 0
  const pfRate      = Math.max(0, (config.employer_pf_pct ?? 0) - (config.employer_eps_pct ?? 0))
  const pensionRate = config.employer_eps_pct ?? 0
  const adminRate   = 0.5
  const total       = empRate + pfRate + pensionRate + adminRate

  const segments = [
    { label: 'Employee Share',        rate: empRate,     colorBar: 'bg-emerald-500', colorDot: 'bg-emerald-500' },
    { label: 'Employer EPF Share',    rate: pfRate,      colorBar: 'bg-primary',     colorDot: 'bg-primary'     },
    { label: 'Employer Pension (EPS)', rate: pensionRate, colorBar: 'bg-sky-400',     colorDot: 'bg-sky-400'     },
    { label: 'Admin Charges',          rate: adminRate,   colorBar: 'bg-amber-400',   colorDot: 'bg-amber-400'   },
  ]

  return (
    <SectionCard title="Compliance Rate Composition">
      <div className="space-y-3">
        <p className="text-[10px] text-muted-foreground">
          Corporate compliance levy allocation based on current configuration.
        </p>
        <div className="h-4 w-full bg-muted rounded-full overflow-hidden flex">
          {segments.map(s => (
            <div
              key={s.label}
              className={cn('h-full hover:opacity-80 transition-opacity cursor-help', s.colorBar)}
              style={{ width: `${(s.rate / total) * 100}%` }}
              title={`${s.label}: ${s.rate.toFixed(2)}%`}
            />
          ))}
        </div>
        <div className="space-y-2 pt-1">
          {segments.map(s => (
            <div key={s.label} className="flex items-center gap-2 text-[11px]">
              <span className={cn('h-2 w-2 rounded-sm shrink-0', s.colorDot)} />
              <span className="text-muted-foreground truncate">{s.label}:</span>
              <strong className="text-foreground font-mono ml-auto">{s.rate.toFixed(2)}%</strong>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-border/30 text-xs">
          <span className="text-muted-foreground">Total Statutory Rate Base</span>
          <strong className="text-foreground font-black font-mono text-sm">{total.toFixed(2)}%</strong>
        </div>
      </div>
    </SectionCard>
  )
}

// ── EditConfigDialog ──────────────────────────────────────────────────────────

function EditConfigDialog({ config, onClose }: { config: EPFConfig; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_contribution_pct:  config.employee_contribution_pct,
    employer_pf_pct:            config.employer_pf_pct,
    employer_eps_pct:           config.employer_eps_pct,
    wage_ceiling:               config.wage_ceiling,
    is_wage_ceiling_applicable: config.is_wage_ceiling_applicable,
    allow_voluntary_pf:         config.allow_voluntary_pf,
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: () => api.put('/payroll/statutory/epf/config', {
      ...form,
      effective_from: new Date().toISOString().slice(0, 10),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epf-config'] })
      toast.success('EPF configuration updated')
      onClose()
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message ?? 'Failed to update EPF config'
      setError(msg)
      toast.error('Failed to update EPF configuration', { description: msg })
    },
  })

  const numFields: { key: keyof typeof form; label: string; step: string }[] = [
    { key: 'employee_contribution_pct', label: 'Employee Contribution (%)', step: '0.01' },
    { key: 'employer_pf_pct',          label: 'Employer PF (%)',           step: '0.01' },
    { key: 'employer_eps_pct',         label: 'Employer EPS (%)',          step: '0.01' },
    { key: 'wage_ceiling',             label: 'Wage Ceiling (₹)',          step: '1'    },
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
          <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border">
            <span className="text-sm font-medium">Apply Wage Ceiling</span>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, is_wage_ceiling_applicable: !f.is_wage_ceiling_applicable }))}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                form.is_wage_ceiling_applicable ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                form.is_wage_ceiling_applicable ? 'translate-x-4' : 'translate-x-1',
              )} />
            </button>
          </div>
          {numFields.map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</label>
              <Input
                type="number" step={f.step}
                value={form[f.key] as number}
                onChange={e => setForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))}
                className="h-8 text-xs"
              />
            </div>
          ))}
          <div className="p-2.5 rounded-md bg-muted/30 border border-border/50 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">EPF split: </span>
            Employer EPF = {Math.max(0, (form.employer_pf_pct ?? 0) - (form.employer_eps_pct ?? 0)).toFixed(2)}%
            &nbsp;·&nbsp; EPS = {(form.employer_eps_pct ?? 0).toFixed(2)}%
          </div>
          {error && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-8 text-xs" onClick={onClose}>Cancel</Button>
            <Button className="flex-1 h-8 text-xs" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</> : 'Save Changes'}
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
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const todayYM    = new Date().toISOString().slice(0, 7)
  const last6      = useMemo(() => getLast6Months(), [])
  const [showEditConfig, setShowEditConfig] = useState(false)

  // ── Config ────────────────────────────────────────────────────────────────────
  const {
    data: config,
    isLoading: configLoading,
    isError: configError,
    refetch: refetchConfig,
  } = useQuery<EPFConfig>({
    queryKey: ['epf-config'],
    queryFn:  () => api.get('/payroll/statutory/epf/config').then((r: any) => r?.data ?? r),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Registrations ─────────────────────────────────────────────────────────────
  const {
    data: registrationsData,
    isLoading: registrationsLoading,
  } = useQuery<EPFRegistration[]>({
    queryKey: ['epf-registrations'],
    queryFn:  () => api.get('/payroll/statutory/epf/registrations').then((r: any) => r?.data ?? []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const registrations = Array.isArray(registrationsData) ? registrationsData : []

  const [showAddReg, setShowAddReg] = useState(false)
  const [regForm, setRegForm] = useState({ registration_number: '', code_label: '', pf_sub_code: '', is_default: false })

  const qc = useQueryClient()

  const addRegMutation = useMutation({
    mutationFn: () => api.post('/payroll/statutory/epf/registrations', {
      registration_number: regForm.registration_number,
      code_label:  regForm.code_label  || undefined,
      pf_sub_code: regForm.pf_sub_code || undefined,
      is_default:  regForm.is_default,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epf-registrations'] })
      toast.success('Registration code added')
      setShowAddReg(false)
      setRegForm({ registration_number: '', code_label: '', pf_sub_code: '', is_default: false })
    },
    onError: () => toast.error('Failed to add registration code'),
  })

  const setDefaultRegMutation = useMutation({
    mutationFn: (regId: string) => api.put(`/payroll/statutory/epf/registrations/${regId}`, { is_default: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epf-registrations'] })
      toast.success('Default registration updated')
    },
    onError: () => toast.error('Failed to update default'),
  })

  const deleteRegMutation = useMutation({
    mutationFn: (regId: string) => api.delete(`/payroll/statutory/epf/registrations/${regId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epf-registrations'] })
      toast.success('Registration removed')
    },
    onError: () => toast.error('Failed to remove registration'),
  })

  // ── Current month (stat cards) ────────────────────────────────────────────────
  const {
    data: contributions,
    isLoading: contribLoading,
    refetch: refetchContrib,
  } = useQuery<EPFContribution[]>({
    queryKey: ['epf-contributions', todayYM],
    queryFn:  () => api.get(`/payroll/statutory/epf/contributions?month=${todayYM}`)
      .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Manual contribution compute (also runs automatically on payroll finalize) ──
  const [computeMonth, setComputeMonth] = useState(todayYM)
  const computeMutation = useMutation({
    mutationFn: (month: string) => api.post('/payroll/statutory/epf/contributions/compute', { month }),
    onSuccess: (_d, month) => {
      qc.invalidateQueries({ queryKey: ['epf-contributions'] })
      refetchContrib()
      toast.success('EPF contributions computed', { description: `Month ${month}` })
    },
    onError: (e: any) => toast.error('Compute failed', { description: e?.response?.data?.message ?? e?.message ?? 'Finalize the payroll run for this month first.' }),
  })

  // ── Last 6 months (history table) ─────────────────────────────────────────────
  const historyResults = useQueries({
    queries: last6.map(ym => ({
      queryKey: ['epf-contributions', ym],
      queryFn:  () => api.get(`/payroll/statutory/epf/contributions?month=${ym}`)
        .then((r: any) => Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []) as Promise<EPFContribution[]>,
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
            <p className="text-sm">Only HR admins can access EPF management.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const contribList          = Array.isArray(contributions) ? contributions : []
  const totalEmployees       = contribList.length
  const totalEmployeeContrib = contribList.reduce((s, c) => s + (Number(c.employee_contribution) || 0), 0)
  const totalEmployerContrib = contribList.reduce((s, c) => s + (Number(c.total_employer_contribution) || 0), 0)

  const historyRows = last6.map((ym, i) => {
    const rows = (historyResults[i]?.data ?? []) as EPFContribution[]
    const pfWages   = rows.reduce((s, c) => s + (Number(c.pf_wages)                    || 0), 0)
    const empEPF    = rows.reduce((s, c) => s + (Number(c.employee_contribution)        || 0), 0)
    const emprPF    = rows.reduce((s, c) => s + (Number(c.employer_pf)                  || 0), 0)
    const eps       = rows.reduce((s, c) => s + (Number(c.employer_eps)                 || 0), 0)
    const totalEmpr = rows.reduce((s, c) => s + (Number(c.total_employer_contribution)  || 0), 0)
    return { ym, staff: rows.length, pfWages, empEPF, emprPF, eps, totalEmpr, loading: historyResults[i]?.isLoading }
  })
  const historyLoading = historyResults.some(r => r.isLoading)

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[
          { label: 'Payroll',   href: '/admin/payroll' },
          { label: 'Statutory', href: '/admin/payroll/statutory' },
          { label: 'EPF' },
        ]}
        title="EPF Management"
        subtitle="Configure Provident Fund parameters, enforce wage ceilings, and monitor statutory contributions"
        actions={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={computeMonth}
              onChange={e => setComputeMonth(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50"
              title="Month to compute EPF contributions for (run must be finalized)"
            />
            <Button
              size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => computeMutation.mutate(computeMonth)}
              disabled={computeMutation.isPending || !computeMonth}
            >
              {computeMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Compute Contributions
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => { refetchConfig(); refetchContrib() }}
              disabled={configLoading || contribLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (configLoading || contribLoading) && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* ── Stat cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {contribLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-card p-5 rounded-2xl border border-border animate-pulse flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-muted shrink-0" />
                <div className="space-y-2 flex-1"><div className="h-2.5 w-24 bg-muted rounded" /><div className="h-6 w-32 bg-muted rounded" /></div>
              </div>
            ))
          : <>
              <ColoredStatCard icon={Building}    label="Filing Headcount"         value={totalEmployees}                sub="staff active"
                iconBg="bg-orange-50 dark:bg-orange-950/40"  iconBorder="border-orange-100 dark:border-orange-800"  iconColor="text-orange-600 dark:text-orange-400" />
              <ColoredStatCard icon={TrendingUp}  label="Employee Contribution Pool" value={fmtCurrency(totalEmployeeContrib)} sub={`@${config?.employee_contribution_pct ?? 12}%`}
                iconBg="bg-emerald-50 dark:bg-emerald-950/40" iconBorder="border-emerald-100 dark:border-emerald-800" iconColor="text-emerald-600 dark:text-emerald-400" />
              <ColoredStatCard icon={ShieldCheck} label="Employer Liability"         value={fmtCurrency(totalEmployerContrib)} sub="incl. EPS"
                iconBg="bg-primary/10" iconBorder="border-primary/20" iconColor="text-primary" valueColor="text-primary" />
            </>
        }
      </div>

      {/* ── Config (8-col) + Rate bar (4-col) ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left: Parameters */}
        <div className="lg:col-span-8">
          <SectionCard
            title="Statutory Scheme Parameter Matrix"
            icon={<Settings className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                onClick={() => setShowEditConfig(true)} disabled={!config}
              >
                <Settings className="h-3.5 w-3.5" />
                Configure EPF Scheme
              </Button>
            }
          >
            {configLoading && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-md bg-muted/40 border border-border/50 space-y-1.5">
                    <div className="h-2.5 w-16 bg-muted rounded" /><div className="h-4 w-12 bg-muted rounded" />
                  </div>
                ))}
              </div>
            )}
            {configError && (
              <div className="flex items-center gap-2 text-xs text-destructive py-2">
                <AlertCircle className="h-3.5 w-3.5" />Failed to load EPF configuration.
              </div>
            )}
            {config && (
              <>
                {/* Registration Codes */}
                <div className="pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">PF Registration Codes</span>
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
                              {reg.pf_sub_code && <span className="text-muted-foreground font-mono">/ {reg.pf_sub_code}</span>}
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
                      <span className="text-[9px] font-bold text-primary uppercase tracking-wider">New Registration Code</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">PF Account No. *</label>
                          <Input
                            value={regForm.registration_number}
                            onChange={e => setRegForm(f => ({ ...f, registration_number: e.target.value }))}
                            placeholder="MHBAN0012345000"
                            className="h-7 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-muted-foreground uppercase block mb-0.5">Sub-Code (optional)</label>
                          <Input
                            value={regForm.pf_sub_code}
                            onChange={e => setRegForm(f => ({ ...f, pf_sub_code: e.target.value.slice(0,3) }))}
                            placeholder="001"
                            maxLength={3}
                            className="h-7 text-xs font-mono"
                          />
                        </div>
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
                          id="epf-reg-default"
                          checked={regForm.is_default}
                          onChange={e => setRegForm(f => ({ ...f, is_default: e.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-border"
                        />
                        <label htmlFor="epf-reg-default" className="text-xs text-muted-foreground">Set as default registration</label>
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => { setShowAddReg(false); setRegForm({ registration_number: '', code_label: '', pf_sub_code: '', is_default: false }) }}
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-4 border-t border-border/40 pt-4">
                  {[
                    { label: 'Employee Rate',         value: fmtPct(config.employee_contribution_pct) },
                    { label: 'Employer PF',           value: fmtPct(config.employer_pf_pct) },
                    { label: 'Pension Share (EPS)',   value: fmtPct(config.employer_eps_pct) },
                    { label: 'Provident Share (EPF)', value: `${Math.max(0, (config.employer_pf_pct ?? 0) - (config.employer_eps_pct ?? 0)).toFixed(2)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3.5 bg-muted/30 rounded-xl border border-border/50">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
                      <p className="text-lg font-black text-foreground font-mono mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Wage ceiling row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border/40 pt-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-5 w-5 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0">
                      <Info className="h-3 w-3" />
                    </span>
                    <span>Wage ceiling restricts PF wage base to <strong className="text-foreground">₹{(config.wage_ceiling ?? 0).toLocaleString('en-IN')}</strong>.</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Ceiling:</span>
                    <Badge variant={config.is_wage_ceiling_applicable ? 'success' : 'secondary'} className="rounded-full text-[10px]">
                      {config.is_wage_ceiling_applicable ? 'Applied' : 'Not Applied'}
                    </Badge>
                    <PFModeBadge mode={config.is_wage_ceiling_applicable ? 'capped' : 'actual'} />
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </div>

        {/* Right: Rate composition bar */}
        <div className="lg:col-span-4">
          {config
            ? <EPFRateBar config={config} />
            : <div className="bg-card rounded-2xl border border-border p-6 flex items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading config…
              </div>
          }
        </div>
      </div>

      {/* ── Last 6 Months History ──────────────────────────────────────────────── */}
      <SectionCard
        title="Last 6 Months — EPF Filing Register"
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
                  {['Filing Cycle', 'Staff', 'PF Wage Base', 'Employee EPF', 'Employer PF', 'Employer EPS', 'Total Employer'].map(h => (
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
                      {row.loading ? <span className="inline-block h-3 w-8 bg-muted rounded animate-pulse" /> : row.staff}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.staff === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.pfWages)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.staff === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.empEPF)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.staff === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.emprPF)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.staff === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.eps)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-semibold text-primary">
                      {row.loading ? <span className="inline-block h-3 w-16 bg-muted rounded animate-pulse" /> : row.staff === 0 ? <span className="text-muted-foreground">—</span> : fmtCurrency(row.totalEmpr)}
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
