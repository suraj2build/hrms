/**
 * LeavePolicy — /admin/leave-policy
 *
 * HR admin configuration page for leave entitlement policies.
 * One policy per leave type covering:
 *   • Accrual   — monthly / yearly / upfront, days per year, max balance
 *   • Eligibility — waiting days from joining, proration toggle
 *   • Carry-forward — enable/disable, max days to carry
 *   • Year type — calendar (Jan–Dec) or financial (Apr–Mar)
 *
 * Layout:
 *   Left  — list of all active leave types (tab-style selector)
 *   Right — policy form for the selected leave type
 *   Bottom — Entitlement Operations panel (run batch jobs)
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                                 from 'sonner'
import {
  Settings2, ShieldAlert, CheckCircle2, AlertCircle,
  Loader2, PlayCircle, CalendarClock, ArrowRight,
  RotateCcw, ChevronRight, BookOpen,
} from 'lucide-react'

import { PageContainer }        from '@/components/layout/PageContainer'
import { PageHeader }           from '@/components/layout/PageHeader'
import { SectionCard }          from '@/components/layout/SectionCard'
import { FormField }            from '@/components/forms/FormField'
import { Button }               from '@/components/ui/button'
import { Input }                from '@/components/ui/input'
import { Badge }                from '@/components/ui/badge'
import { api }                  from '@/lib/api/client'
import { useAuthStore }         from '@/stores/authStore'
import { cn }                   from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface LeaveType {
  id:        string
  name:      string
  is_paid:   boolean
  is_active: boolean
}

interface LeavePolicy {
  id:                     string
  leave_type_id:          string
  accrual_type:           'monthly' | 'yearly' | 'upfront'
  accrual_days_per_year:  number
  max_accrual_balance:    number | null
  eligibility_days:       number
  prorate_on_joining:     boolean
  carry_forward_enabled:  boolean
  carry_forward_max_days: number | null
  year_type:              'calendar' | 'financial'
}

interface PolicyWithType extends LeavePolicy {
  leave_types: LeaveType
}

type PolicyForm = Omit<LeavePolicy, 'id' | 'leave_type_id'>

interface BatchResult {
  employees_processed: number
  total_days_credited: number
  skipped:             number
  errors:              string[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const EMPTY_FORM: PolicyForm = {
  accrual_type:           'yearly',
  accrual_days_per_year:  0,
  max_accrual_balance:    null,
  eligibility_days:       0,
  prorate_on_joining:     true,
  carry_forward_enabled:  false,
  carry_forward_max_days: null,
  year_type:              'calendar',
}

const ACCRUAL_OPTIONS = [
  { value: 'monthly',  label: 'Monthly', description: 'Credit 1/12th each calendar month' },
  { value: 'yearly',   label: 'Yearly',  description: 'Full credit at year start (prorated for new joiners)' },
  { value: 'upfront',  label: 'Upfront', description: 'Full credit at year start regardless of joining date' },
] as const

const YEAR_OPTIONS = [
  { value: 'calendar',  label: 'Calendar Year',  description: 'Jan 1 – Dec 31' },
  { value: 'financial', label: 'Financial Year',  description: 'Apr 1 – Mar 31 (Indian FY)' },
] as const

// ── Sub-components ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        checked ? 'bg-primary' : 'bg-muted',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
      aria-label={label}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/** Pill row for accrual type / year type selection */
function RadioPill<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { value: T; label: string; description: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
            value === opt.value
              ? 'border-primary/50 bg-primary/6 text-primary'
              : 'border-border bg-card hover:bg-muted/40 text-foreground',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          {/* Radio dot */}
          <span
            className={cn(
              'mt-0.5 flex-shrink-0 h-4 w-4 rounded-full border-2 flex items-center justify-center',
              value === opt.value ? 'border-primary' : 'border-muted-foreground/40',
            )}
          >
            {value === opt.value && (
              <span className="h-2 w-2 rounded-full bg-primary" />
            )}
          </span>
          <div>
            <p className="text-sm font-medium leading-none">{opt.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

/** Horizontal divider with label */
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 border-t border-border" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeavePolicy() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [form, setForm]                     = useState<PolicyForm>(EMPTY_FORM)
  const [saveSuccess, setSaveSuccess]       = useState('')
  const [saveError,   setSaveError]         = useState('')

  // Entitlement operation state
  const thisYear  = new Date().getFullYear()
  const thisMonth = new Date().getMonth() + 1
  const [opYear,  setOpYear]  = useState(String(thisYear))
  const [opMonth, setOpMonth] = useState(String(thisMonth))
  const [cfFrom,  setCfFrom]  = useState(String(thisYear))
  const [cfTo,    setCfTo]    = useState(String(thisYear + 1))
  const [opResult, setOpResult] = useState<{ msg: string; result?: BatchResult } | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: ltData, isLoading: ltLoading } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    staleTime: 60_000,
  })
  const leaveTypes = (ltData?.data ?? []).filter(lt => lt.is_active)

  const { data: policiesData, isLoading: policyLoading } = useQuery<{ data: PolicyWithType[] }>({
    queryKey: ['leave-policies'],
    queryFn:  () => api.get('/masters/leave-policies'),
    staleTime: 60_000,
  })
  const policies    = policiesData?.data ?? []
  const policyById  = new Map(policies.map(p => [p.leave_type_id, p]))

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: PolicyForm & { leave_type_id: string }) => {
      const existing = policyById.get(body.leave_type_id)
      if (existing) {
        return api.put(`/masters/leave-policies/${existing.id}`, body)
      }
      return api.post('/masters/leave-policies', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-policies'] })
      setSaveSuccess('Policy saved successfully.')
      setSaveError('')
      setTimeout(() => setSaveSuccess(''), 3000)
      toast.success('Policy saved')
    },
    onError: (e) => {
      setSaveError((e as Error).message ?? 'Save failed')
      setSaveSuccess('')
      toast.error('Policy save failed', { description: (e as Error).message })
    },
  })

  const monthlyMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: BatchResult; message: string }>('/leave/entitlement/monthly', {
        year:  parseInt(opYear, 10),
        month: parseInt(opMonth, 10),
      }),
    onSuccess: (r) => { setOpResult({ msg: r.message, result: r.data }); toast.success('Monthly accrual updated') },
    onError:   (e) => { setOpResult({ msg: (e as Error).message }); toast.error('Monthly accrual failed', { description: (e as Error).message }) },
  })

  const yearlyMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: BatchResult; message: string }>('/leave/entitlement/yearly', {
        leave_year: parseInt(opYear, 10),
      }),
    onSuccess: (r) => { setOpResult({ msg: r.message, result: r.data }); toast.success('Yearly grant updated') },
    onError:   (e) => { setOpResult({ msg: (e as Error).message }); toast.error('Yearly grant failed', { description: (e as Error).message }) },
  })

  const carryForwardMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: BatchResult; message: string }>('/leave/entitlement/carry-forward', {
        from_year: parseInt(cfFrom, 10),
        to_year:   parseInt(cfTo,   10),
      }),
    onSuccess: (r) => { setOpResult({ msg: r.message, result: r.data }); toast.success('Carry-forward rules updated') },
    onError:   (e) => { setOpResult({ msg: (e as Error).message }); toast.error('Carry-forward failed', { description: (e as Error).message }) },
  })

  // ── Helpers ────────────────────────────────────────────────────────────────
  function selectType(lt: LeaveType) {
    setSelectedTypeId(lt.id)
    const existing = policyById.get(lt.id)
    if (existing) {
      setForm({
        accrual_type:           existing.accrual_type,
        accrual_days_per_year:  existing.accrual_days_per_year,
        max_accrual_balance:    existing.max_accrual_balance,
        eligibility_days:       existing.eligibility_days,
        prorate_on_joining:     existing.prorate_on_joining,
        carry_forward_enabled:  existing.carry_forward_enabled,
        carry_forward_max_days: existing.carry_forward_max_days,
        year_type:              existing.year_type,
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setSaveSuccess('')
    setSaveError('')
    saveMutation.reset()
  }

  function handleSave() {
    if (!selectedTypeId) return
    saveMutation.mutate({ ...form, leave_type_id: selectedTypeId })
  }

  function num(val: string): number { return parseFloat(val) || 0 }

  const selectedType = leaveTypes.find(lt => lt.id === selectedTypeId)
  const hasPolicy    = selectedTypeId ? policyById.has(selectedTypeId) : false
  const anyPending   = monthlyMutation.isPending || yearlyMutation.isPending || carryForwardMutation.isPending

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Leave Policy"
        subtitle="Configure accrual, eligibility, carry-forward and expiry rules per leave type"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can configure leave policies.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* ── Left: Leave type selector ──────────────────────────────── */}
            <div className="lg:col-span-1">
              <SectionCard
                title="Leave Types"
                icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
                description="Select a leave type to configure its policy"
              >
                {ltLoading ? (
                  <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : leaveTypes.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">
                    No active leave types found. Create them in Leave Types first.
                  </p>
                ) : (
                  <div className="space-y-1 -mx-1">
                    {leaveTypes.map(lt => {
                      const hasP = policyById.has(lt.id)
                      const isSelected = lt.id === selectedTypeId
                      return (
                        <button
                          key={lt.id}
                          type="button"
                          onClick={() => selectType(lt)}
                          className={cn(
                            'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                            isSelected
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted/50 text-foreground',
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{lt.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <Badge
                                variant={lt.is_paid ? 'success' : 'secondary'}
                                className="rounded-full text-[9px] px-1.5 py-0"
                              >
                                {lt.is_paid ? 'Paid' : 'Unpaid'}
                              </Badge>
                              {hasP ? (
                                <span className="text-[9px] text-success font-medium">● Policy set</span>
                              ) : (
                                <span className="text-[9px] text-muted-foreground">○ No policy</span>
                              )}
                            </div>
                          </div>
                          <ChevronRight
                            className={cn(
                              'h-3.5 w-3.5 flex-shrink-0 transition-colors',
                              isSelected ? 'text-primary' : 'text-muted-foreground/40',
                            )}
                          />
                        </button>
                      )
                    })}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* ── Right: Policy form ─────────────────────────────────────── */}
            <div className="lg:col-span-2">
              {!selectedTypeId ? (
                <SectionCard>
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Settings2 className="h-10 w-10 opacity-20" />
                    <p className="text-sm font-medium text-foreground">Select a leave type</p>
                    <p className="text-xs">Click a leave type on the left to configure its policy.</p>
                  </div>
                </SectionCard>
              ) : (
                <SectionCard
                  title={`${selectedType?.name ?? ''} Policy`}
                  icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
                  description={hasPolicy ? 'Policy configured — editing existing settings' : 'No policy yet — fill in the form to create one'}
                >
                  {policyLoading ? (
                    <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading policy…
                    </div>
                  ) : (
                    <div className="space-y-5">

                      {/* ── Accrual ─────────────────────────────────────── */}
                      <SectionDivider label="Accrual" />

                      <div className="space-y-1">
                        <p className="text-xs font-medium text-foreground">Accrual Type</p>
                        <p className="text-[11px] text-muted-foreground mb-2">How and when leave days are credited to the employee.</p>
                        <RadioPill
                          options={ACCRUAL_OPTIONS}
                          value={form.accrual_type}
                          onChange={v => setForm(f => ({ ...f, accrual_type: v }))}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="Days Per Year"
                          htmlFor="accrual-days"
                          required
                          description={
                            form.accrual_type === 'monthly'
                              ? `≈ ${(form.accrual_days_per_year / 12).toFixed(1)} days/month`
                              : undefined
                          }
                        >
                          <Input
                            id="accrual-days"
                            type="number"
                            min={0}
                            max={365}
                            step={0.5}
                            value={form.accrual_days_per_year}
                            onChange={e => setForm(f => ({ ...f, accrual_days_per_year: num(e.target.value) }))}
                            placeholder="e.g. 12"
                          />
                        </FormField>

                        <FormField
                          label="Max Balance (days)"
                          htmlFor="max-balance"
                          description="Leave blank for unlimited accumulation"
                        >
                          <Input
                            id="max-balance"
                            type="number"
                            min={0}
                            max={365}
                            step={0.5}
                            value={form.max_accrual_balance ?? ''}
                            onChange={e =>
                              setForm(f => ({
                                ...f,
                                max_accrual_balance: e.target.value === '' ? null : num(e.target.value),
                              }))
                            }
                            placeholder="None"
                          />
                        </FormField>
                      </div>

                      {/* ── Eligibility ─────────────────────────────────── */}
                      <SectionDivider label="Eligibility" />

                      <div className="grid grid-cols-2 gap-4 items-start">
                        <FormField
                          label="Waiting Period (days)"
                          htmlFor="elig-days"
                          description="Days from joining before first credit or usage. 0 = immediate."
                        >
                          <Input
                            id="elig-days"
                            type="number"
                            min={0}
                            max={3650}
                            step={1}
                            value={form.eligibility_days}
                            onChange={e => setForm(f => ({ ...f, eligibility_days: parseInt(e.target.value, 10) || 0 }))}
                            placeholder="0"
                          />
                        </FormField>

                        <div className="pt-1">
                          <div className="flex items-center justify-between py-1">
                            <div>
                              <p className="text-sm font-medium text-foreground">Prorate on Joining</p>
                              <p className="text-xs text-muted-foreground">
                                For yearly accrual: grant proportional days based on months remaining
                              </p>
                            </div>
                            <Toggle
                              checked={form.prorate_on_joining}
                              onChange={v => setForm(f => ({ ...f, prorate_on_joining: v }))}
                              label="Prorate on Joining"
                              disabled={form.accrual_type === 'upfront'}
                            />
                          </div>
                        </div>
                      </div>

                      {/* ── Carry-forward ───────────────────────────────── */}
                      <SectionDivider label="Carry-forward" />

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">Enable Carry-forward</p>
                          <p className="text-xs text-muted-foreground">
                            Allow unused balance to roll over to the next year
                          </p>
                        </div>
                        <Toggle
                          checked={form.carry_forward_enabled}
                          onChange={v => setForm(f => ({ ...f, carry_forward_enabled: v }))}
                          label="Enable Carry-forward"
                        />
                      </div>

                      {form.carry_forward_enabled && (
                        <FormField
                          label="Max Carry-forward Days"
                          htmlFor="cf-max"
                          description="Maximum days to carry to the next year. Leave blank for unlimited."
                        >
                          <Input
                            id="cf-max"
                            type="number"
                            min={0}
                            max={365}
                            step={0.5}
                            value={form.carry_forward_max_days ?? ''}
                            onChange={e =>
                              setForm(f => ({
                                ...f,
                                carry_forward_max_days: e.target.value === '' ? null : num(e.target.value),
                              }))
                            }
                            placeholder="Unlimited"
                          />
                        </FormField>
                      )}

                      {/* ── Year boundary ────────────────────────────────── */}
                      <SectionDivider label="Year Boundary" />

                      <div className="space-y-1">
                        <p className="text-xs font-medium text-foreground">Year Type</p>
                        <p className="text-[11px] text-muted-foreground mb-2">
                          Determines the leave year start/end for accrual and carry-forward.
                        </p>
                        <RadioPill
                          options={YEAR_OPTIONS}
                          value={form.year_type}
                          onChange={v => setForm(f => ({ ...f, year_type: v }))}
                        />
                      </div>

                      {/* ── Policy summary ───────────────────────────────── */}
                      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                        <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-1.5">Policy Summary</p>
                        <p>
                          <span className="font-medium text-foreground">{form.accrual_days_per_year}</span> days/year
                          {' '}via <span className="font-medium text-foreground">{form.accrual_type}</span> accrual
                          {form.accrual_type === 'monthly' && (
                            <> ({(form.accrual_days_per_year / 12).toFixed(1)} days/month)</>
                          )}
                        </p>
                        <p>
                          Eligible after{' '}
                          <span className="font-medium text-foreground">{form.eligibility_days}</span> day(s) from joining
                          {form.prorate_on_joining && form.accrual_type !== 'upfront' && ' · prorated'}
                        </p>
                        <p>
                          Carry-forward:{' '}
                          {form.carry_forward_enabled ? (
                            <span className="text-success font-medium">
                              Enabled
                              {form.carry_forward_max_days != null
                                ? ` (max ${form.carry_forward_max_days} days)`
                                : ' (unlimited)'}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Disabled — unused balance expires at year end</span>
                          )}
                        </p>
                        <p>
                          Year boundary:{' '}
                          <span className="font-medium text-foreground">
                            {form.year_type === 'calendar' ? 'Jan 1 – Dec 31' : 'Apr 1 – Mar 31 (Indian FY)'}
                          </span>
                        </p>
                      </div>

                      {/* ── Status messages ──────────────────────────────── */}
                      {saveSuccess && (
                        <div className="flex items-center gap-2 text-sm text-success p-3 rounded-lg bg-success/10 border border-success/20">
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                          {saveSuccess}
                        </div>
                      )}
                      {saveError && (
                        <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                          <AlertCircle className="h-4 w-4 flex-shrink-0" />
                          {saveError}
                        </div>
                      )}

                      {/* ── Actions ──────────────────────────────────────── */}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          variant="outline"
                          onClick={() => selectedType && selectType(selectedType)}
                          disabled={saveMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Reset
                        </Button>
                        <Button
                          onClick={handleSave}
                          disabled={saveMutation.isPending}
                        >
                          {saveMutation.isPending
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
                            : hasPolicy ? 'Update Policy' : 'Create Policy'
                          }
                        </Button>
                      </div>
                    </div>
                  )}
                </SectionCard>
              )}
            </div>
          </div>

          {/* ── Entitlement Operations ─────────────────────────────────────── */}
          <SectionCard
            title="Entitlement Operations"
            icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
            description="Run batch jobs to credit leave or carry forward balances"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

              {/* Monthly Accrual */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Monthly Accrual</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Credit 1/12th of annual entitlement to all eligible employees for the selected month.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Year</label>
                    <Input
                      type="number"
                      min={2000}
                      max={2100}
                      value={opYear}
                      onChange={e => setOpYear(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Month</label>
                    <select
                      value={opMonth}
                      onChange={e => setOpMonth(e.target.value)}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                        <option key={m} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5"
                  disabled={anyPending}
                  onClick={() => { setOpResult(null); monthlyMutation.mutate() }}
                >
                  {monthlyMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
                    : <><PlayCircle className="h-3.5 w-3.5" />Run Monthly Accrual</>
                  }
                </Button>
              </div>

              {/* Yearly Credit */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Yearly Credit</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Credit full (prorated) annual entitlement at year start for yearly / upfront policies.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Leave Year</label>
                  <Input
                    type="number"
                    min={2000}
                    max={2100}
                    value={opYear}
                    onChange={e => setOpYear(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs gap-1.5"
                  disabled={anyPending}
                  onClick={() => { setOpResult(null); yearlyMutation.mutate() }}
                >
                  {yearlyMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
                    : <><PlayCircle className="h-3.5 w-3.5" />Run Yearly Credit</>
                  }
                </Button>
              </div>

              {/* Carry-forward */}
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Carry-forward</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Move eligible unused balances from one year to the next. Run once at year-end.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">From Year</label>
                    <Input
                      type="number"
                      min={2000}
                      max={2100}
                      value={cfFrom}
                      onChange={e => { setCfFrom(e.target.value); setCfTo(String(parseInt(e.target.value, 10) + 1)) }}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" />To Year
                    </label>
                    <Input
                      type="number"
                      min={2000}
                      max={2100}
                      value={cfTo}
                      onChange={e => setCfTo(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-xs gap-1.5"
                  disabled={anyPending}
                  onClick={() => { setOpResult(null); carryForwardMutation.mutate() }}
                >
                  {carryForwardMutation.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
                    : <><ArrowRight className="h-3.5 w-3.5" />Run Carry-forward</>
                  }
                </Button>
              </div>
            </div>

            {/* Operation result */}
            {opResult && (
              <div
                className={cn(
                  'mt-4 p-3 rounded-lg border text-sm',
                  opResult.result?.errors?.length
                    ? 'bg-warning/10 border-warning/30 text-warning'
                    : 'bg-success/10 border-success/30 text-success',
                )}
              >
                <p className="font-medium">{opResult.msg}</p>
                {opResult.result && (
                  <div className="mt-1.5 grid grid-cols-3 gap-3 text-xs">
                    <span>
                      <span className="font-semibold">{opResult.result.employees_processed}</span> processed
                    </span>
                    <span>
                      <span className="font-semibold">{opResult.result.total_days_credited}</span> days
                    </span>
                    <span>
                      <span className="font-semibold">{opResult.result.skipped}</span> skipped
                    </span>
                  </div>
                )}
                {!!opResult.result?.errors?.length && (
                  <div className="mt-2 space-y-0.5">
                    {opResult.result.errors.slice(0, 5).map((e, i) => (
                      <p key={i} className="text-[11px] text-destructive">{e}</p>
                    ))}
                    {opResult.result.errors.length > 5 && (
                      <p className="text-[11px] text-muted-foreground">
                        + {opResult.result.errors.length - 5} more errors
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </PageContainer>
  )
}
