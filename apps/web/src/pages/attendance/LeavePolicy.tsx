/**
 * LeavePolicy — /admin/leave-policy
 *
 * HR admin configuration page for leave entitlement policies.
 * Tab-based layout: Accrual & Eligibility / Session Governance /
 * Application Windows / Lifecycle & Payroll
 *
 * All form state is unified — single Save button writes the entire policy.
 */

import { useState }                              from 'react'
import { useNavigate }                           from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                                 from 'sonner'
import {
  Settings2, ShieldAlert, CheckCircle2, AlertCircle,
  Loader2, RotateCcw, ChevronRight, BookOpen,
  Activity, ExternalLink, Info, Clock, Calendar,
  Layers, Shield,
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
import { SubTabs }              from '@/components/ui/SubTabs'

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
  accrual_type:           'monthly' | 'quarterly' | 'yearly' | 'upfront'
  accrual_days_per_year:  number
  max_accrual_balance:    number | null
  eligibility_days:       number
  prorate_on_joining:     boolean
  carry_forward_enabled:  boolean
  carry_forward_max_days: number | null
  year_type:              'calendar' | 'financial'
  allow_half_day:               boolean
  allow_hourly_leave:           boolean
  allow_cross_session:          boolean
  minimum_leave_unit:           number
  maximum_sessions_per_day:     number
  session_calculation_mode:     string
  holiday_session_handling:     string
  weekoff_session_handling:     string
  fractional_rounding_mode:     string
  maximum_fractional_precision: number
  hours_per_shift:              number
  max_hours_per_day:            number | null
  allow_past_dated_leave:               boolean
  maximum_past_days:                    number
  allow_current_period_leave:           boolean
  allow_future_leave:                   boolean
  maximum_future_days:                  number | null
  future_application_requires_approval: boolean
  same_day_application_mode:            'allowed' | 'restricted' | 'manager_override_only'
  accrual_earning_basis:        string
  accrual_credit_timing:        string
  accrual_consumption_timing:   string
  future_accrual_consumable:    boolean
  advance_accrual_recovery_mode: string
  joining_cycle_handling:       string
  separation_cycle_handling:    string
  payroll_cutoff_behavior:      string
  accrual_freeze_mode:          string
  minimum_service_days:         number
  minimum_paid_days:            number
  minimum_attendance_pct:       number
  tiered_accrual_enabled:       boolean
  service_anniversary_cycle:    boolean
}

interface PolicyWithType extends LeavePolicy {
  leave_types: LeaveType
}

type PolicyForm = Omit<LeavePolicy, 'id' | 'leave_type_id'>

type PolicyTab = 'accrual' | 'sessions' | 'windows' | 'lifecycle'

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
  allow_half_day:               true,
  allow_hourly_leave:           false,
  allow_cross_session:          true,
  minimum_leave_unit:           0.5,
  maximum_sessions_per_day:     2,
  session_calculation_mode:     'standard',
  holiday_session_handling:     'skip',
  weekoff_session_handling:     'skip',
  fractional_rounding_mode:     'nearest_0_5',
  maximum_fractional_precision: 0.5,
  hours_per_shift:              8,
  max_hours_per_day:            null,
  allow_past_dated_leave:               false,
  maximum_past_days:                    0,
  allow_current_period_leave:           true,
  allow_future_leave:                   true,
  maximum_future_days:                  null,
  future_application_requires_approval: false,
  same_day_application_mode:            'allowed',
  accrual_earning_basis:        'earned',
  accrual_credit_timing:        'cycle_start',
  accrual_consumption_timing:   'immediate',
  future_accrual_consumable:    true,
  advance_accrual_recovery_mode: 'none',
  joining_cycle_handling:       'prorate',
  separation_cycle_handling:    'prorate',
  payroll_cutoff_behavior:      'hold',
  accrual_freeze_mode:          'skip',
  minimum_service_days:         0,
  minimum_paid_days:            0,
  minimum_attendance_pct:       0,
  tiered_accrual_enabled:       false,
  service_anniversary_cycle:    false,
}

const ACCRUAL_OPTIONS = [
  { value: 'monthly',   label: 'Monthly',   description: 'Credit 1/12th each calendar month' },
  { value: 'quarterly', label: 'Quarterly', description: 'Credit 1/4th on Jan, Apr, Jul, Oct' },
  { value: 'yearly',    label: 'Yearly',    description: 'Full credit at year start, prorated for new joiners' },
  { value: 'upfront',   label: 'Upfront',   description: 'Full credit at year start regardless of join date' },
] as const

const YEAR_OPTIONS = [
  { value: 'calendar',  label: 'Calendar Year', description: 'Jan 1 – Dec 31' },
  { value: 'financial', label: 'Financial Year', description: 'Apr 1 – Mar 31 (Indian FY)' },
] as const

const MIN_UNIT_OPTIONS = [
  { value: 0.25, label: 'Quarter-Day', description: '15-minute precision' },
  { value: 0.5,  label: 'Half-Day',    description: '30-minute or half-day precision' },
  { value: 1.0,  label: 'Full-Day',    description: 'Whole days only' },
] as const

const ROUNDING_OPTIONS = [
  { value: 'nearest_0_5',  label: 'Nearest ½ Day', description: 'Round to nearest 0.5 (default)' },
  { value: 'nearest_0_25', label: 'Nearest ¼ Day', description: 'Round to nearest 0.25' },
  { value: 'half_up',      label: 'Round Up ½',    description: 'Standard arithmetic rounding' },
  { value: 'floor',        label: 'Round Down',     description: 'Always round down (favors employer)' },
] as const

const CALC_MODE_OPTIONS = [
  { value: 'standard',         label: 'Standard',          description: 'Session-aware + holiday/weekoff handling' },
  { value: 'shift_aware',      label: 'Shift-Aware',       description: 'Uses shift hours for fractional calculation' },
  { value: 'attendance_aware', label: 'Attendance-Aware',  description: 'Detects existing attendance to avoid overlap' },
] as const

const POLICY_TABS: { id: PolicyTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'accrual',   label: 'Accrual & Eligibility', icon: Calendar },
  { id: 'sessions',  label: 'Session Governance',    icon: Clock },
  { id: 'windows',   label: 'Application Windows',    icon: Layers },
  { id: 'lifecycle', label: 'Lifecycle & Payroll',   icon: Shield },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked:  boolean
  onChange: (v: boolean) => void
  label:    string
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
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
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

function RadioPill<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  cols,
}: {
  options:  readonly { value: T; label: string; description?: string }[]
  value:    T
  onChange: (v: T) => void
  disabled?: boolean
  cols?:    number
}) {
  return (
    <div className={cn(
      'grid gap-2',
      cols === 2 ? 'grid-cols-2'
        : cols === 3 ? 'grid-cols-3'
        : cols === 4 ? 'grid-cols-2 sm:grid-cols-4'
        : 'grid-cols-1',
    )}>
      {options.map(opt => (
        <button
          key={String(opt.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
            value === opt.value
              ? 'border-primary/50 bg-primary/5 text-primary'
              : 'border-border bg-card hover:bg-muted/20 text-foreground',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          <span className={cn(
            'mt-0.5 flex-shrink-0 h-4 w-4 rounded-full border-2 flex items-center justify-center',
            value === opt.value ? 'border-primary' : 'border-muted-foreground/40',
          )}>
            {value === opt.value && <span className="h-2 w-2 rounded-full bg-primary" />}
          </span>
          <div>
            <p className="text-sm font-medium leading-none">{opt.label}</p>
            {opt.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

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

// ── Tab panels ─────────────────────────────────────────────────────────────────

function AccrualTab({
  form, setForm,
}: {
  form: PolicyForm
  setForm: React.Dispatch<React.SetStateAction<PolicyForm>>
}) {
  function num(v: string) { return parseFloat(v) || 0 }

  return (
    <div className="space-y-5">

      {/* Accrual Type */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Accrual Type</p>
        <p className="text-[11px] text-muted-foreground mb-2">How and when leave days are credited to the employee.</p>
        <RadioPill
          options={ACCRUAL_OPTIONS}
          value={form.accrual_type}
          onChange={v => setForm(f => ({ ...f, accrual_type: v }))}
          cols={2}
        />
      </div>

      {/* Days + Max Balance */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Days Per Year"
          htmlFor="accrual-days"
          required
          description={
            form.accrual_type === 'monthly'   ? `≈ ${(form.accrual_days_per_year / 12).toFixed(1)} days/month`
            : form.accrual_type === 'quarterly' ? `≈ ${(form.accrual_days_per_year / 4).toFixed(1)} days/quarter`
            : undefined
          }
        >
          <Input
            id="accrual-days"
            type="number"
            min={0} max={365} step={0.5}
            value={form.accrual_days_per_year}
            onChange={e => setForm(f => ({ ...f, accrual_days_per_year: num(e.target.value) }))}
            placeholder="e.g. 12"
          />
        </FormField>

        <FormField
          label="Max Balance (days)"
          htmlFor="max-balance"
          description={form.max_accrual_balance == null ? 'Currently unlimited' : 'Capped at this value'}
        >
          <div className="flex gap-2 items-center">
            <Input
              id="max-balance"
              type="number"
              min={0} max={365} step={0.5}
              value={form.max_accrual_balance ?? ''}
              disabled={form.max_accrual_balance == null}
              onChange={e => setForm(f => ({
                ...f,
                max_accrual_balance: e.target.value === '' ? null : num(e.target.value),
              }))}
              placeholder="—"
              className={cn(form.max_accrual_balance == null && 'opacity-40')}
            />
            <button
              type="button"
              onClick={() => setForm(f => ({
                ...f,
                max_accrual_balance: f.max_accrual_balance == null ? 30 : null,
              }))}
              className="text-[11px] shrink-0 text-primary hover:underline whitespace-nowrap"
            >
              {form.max_accrual_balance == null ? 'Set limit' : 'Unlimited'}
            </button>
          </div>
        </FormField>
      </div>

      <SectionDivider label="Eligibility" />

      <div className="grid grid-cols-2 gap-4 items-start">
        <FormField
          label="Waiting Period (days)"
          htmlFor="elig-days"
          description="Days from joining before first credit. 0 = immediate."
        >
          <Input
            id="elig-days"
            type="number"
            min={0} max={3650} step={1}
            value={form.eligibility_days}
            onChange={e => setForm(f => ({ ...f, eligibility_days: parseInt(e.target.value, 10) || 0 }))}
            placeholder="0"
          />
        </FormField>

        <div className="pt-1">
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium text-foreground">Prorate on Joining</p>
              <p className="text-xs text-muted-foreground">Grant proportional days based on months remaining</p>
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

      <SectionDivider label="Carry-forward" />

      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
        <div>
          <p className="text-sm font-medium text-foreground">Enable Carry-forward</p>
          <p className="text-xs text-muted-foreground">Allow unused balance to roll over to the next year</p>
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
          description="Leave blank for unlimited carry-forward."
        >
          <Input
            id="cf-max"
            type="number"
            min={0} max={365} step={0.5}
            value={form.carry_forward_max_days ?? ''}
            onChange={e => setForm(f => ({
              ...f,
              carry_forward_max_days: e.target.value === '' ? null : num(e.target.value),
            }))}
            placeholder="Unlimited"
          />
        </FormField>
      )}

      <SectionDivider label="Year Boundary" />

      <RadioPill
        options={YEAR_OPTIONS}
        value={form.year_type}
        onChange={v => setForm(f => ({ ...f, year_type: v }))}
        cols={2}
      />

      {/* Policy summary */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1 mt-1">
        <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-1.5">Summary</p>
        <p>
          <span className="font-medium text-foreground">{form.accrual_days_per_year}</span> days/year
          {' '}via <span className="font-medium text-foreground">{form.accrual_type}</span> accrual
          {form.accrual_type === 'monthly' && <> ({(form.accrual_days_per_year / 12).toFixed(1)} days/month)</>}
          {form.accrual_type === 'quarterly' && <> ({(form.accrual_days_per_year / 4).toFixed(1)} days/quarter · Jan, Apr, Jul, Oct)</>}
        </p>
        <p>
          Eligible after <span className="font-medium text-foreground">{form.eligibility_days}</span> day(s) from joining
          {form.prorate_on_joining && form.accrual_type !== 'upfront' && ' · prorated'}
        </p>
        <p>
          Carry-forward:{' '}
          {form.carry_forward_enabled
            ? <span className="text-success font-medium">Enabled{form.carry_forward_max_days != null ? ` (max ${form.carry_forward_max_days} days)` : ' (unlimited)'}</span>
            : <span className="text-muted-foreground">Disabled — balance expires at year end</span>
          }
        </p>
        <p>
          Year boundary: <span className="font-medium text-foreground">
            {form.year_type === 'calendar' ? 'Jan 1 – Dec 31' : 'Apr 1 – Mar 31 (Indian FY)'}
          </span>
        </p>
      </div>
    </div>
  )
}

function SessionsTab({
  form, setForm,
}: {
  form: PolicyForm
  setForm: React.Dispatch<React.SetStateAction<PolicyForm>>
}) {
  return (
    <div className="space-y-6">

      <SectionDivider label="Session Permissions" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Allow Half-Day Leave</p>
            <p className="text-xs text-muted-foreground mt-0.5">Employees can request AM / PM sessions</p>
          </div>
          <Toggle
            checked={form.allow_half_day}
            onChange={v => setForm(f => ({ ...f, allow_half_day: v }))}
            label="Allow Half-Day Leave"
          />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Allow Hourly Leave</p>
            <p className="text-xs text-muted-foreground mt-0.5">Employees can request leave in hour increments</p>
          </div>
          <Toggle
            checked={form.allow_hourly_leave}
            onChange={v => setForm(f => ({ ...f, allow_hourly_leave: v }))}
            label="Allow Hourly Leave"
          />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 sm:col-span-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Allow Cross-Session Multi-Day Leave</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Multi-day leave can have different start/end sessions (e.g. Second Half Mon → First Half Wed)
            </p>
          </div>
          <Toggle
            checked={form.allow_cross_session}
            onChange={v => setForm(f => ({ ...f, allow_cross_session: v }))}
            label="Allow Cross-Session"
            disabled={!form.allow_half_day}
          />
        </div>

        {form.allow_hourly_leave && (
          <div className="sm:col-span-2 grid grid-cols-2 gap-4">
            <FormField label="Hours Per Shift" htmlFor="hours-per-shift" description="Standard shift duration (1–24 h)">
              <Input
                id="hours-per-shift"
                type="number" min={1} max={24} step={0.5}
                value={form.hours_per_shift}
                onChange={e => setForm(f => ({ ...f, hours_per_shift: parseFloat(e.target.value) || 8 }))}
                placeholder="8"
              />
            </FormField>
            <FormField label="Max Hours Per Day" htmlFor="max-hours" description="Blank = shift hours limit">
              <Input
                id="max-hours"
                type="number" min={0.5} max={24} step={0.5}
                value={form.max_hours_per_day ?? ''}
                onChange={e => {
                  // 0 must map to null ("unlimited") — the DB requires
                  // max_hours_per_day to be strictly > 0 when set.
                  const raw = e.target.value === '' ? null : parseFloat(e.target.value)
                  setForm(f => ({ ...f, max_hours_per_day: raw && raw > 0 ? raw : null }))
                }}
                placeholder="Unlimited"
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Live mode status grid */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
          Allowed Consumption Modes
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Full Day',     allowed: true },
            { label: 'Half Day',     allowed: form.allow_half_day },
            { label: 'Cross-Session', allowed: form.allow_half_day && form.allow_cross_session },
            { label: 'Hourly',       allowed: form.allow_hourly_leave },
          ].map(({ label, allowed }) => (
            <div
              key={label}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium',
                allowed
                  ? 'border-success/30 bg-success/5 text-success'
                  : 'border-border bg-muted/30 text-muted-foreground',
              )}
            >
              {allowed
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <AlertCircle  className="h-3.5 w-3.5 shrink-0 opacity-50" />
              }
              {label}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
          <Info className="h-3 w-3 shrink-0" />
          Min unit: <span className="font-medium text-foreground ml-0.5">
            {form.minimum_leave_unit === 1.0 ? '1 day' : form.minimum_leave_unit === 0.5 ? '½ day' : '¼ day'}
          </span>
          {' · '}Max <span className="font-medium text-foreground mx-0.5">{form.maximum_sessions_per_day}</span> session request{form.maximum_sessions_per_day > 1 ? 's' : ''}/day
        </p>
      </div>

      <SectionDivider label="Session Limits & Units" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Max Session Requests / Day</p>
          <p className="text-[11px] text-muted-foreground">Maximum separate leave segments per day.</p>
          <select
            value={form.maximum_sessions_per_day}
            onChange={e => setForm(f => ({ ...f, maximum_sessions_per_day: Number(e.target.value) }))}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground">Minimum Leave Unit</p>
          <p className="text-[11px] text-muted-foreground">Smallest increment an employee can request.</p>
          <RadioPill
            options={MIN_UNIT_OPTIONS}
            value={form.minimum_leave_unit}
            onChange={v => setForm(f => ({ ...f, minimum_leave_unit: v }))}
            cols={3}
          />
        </div>
      </div>

      <SectionDivider label="Holiday & Weekoff Handling" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Holiday in Span</p>
          <p className="text-[11px] text-muted-foreground">How public holidays within a leave span are treated.</p>
          <select
            value={form.holiday_session_handling}
            onChange={e => setForm(f => ({ ...f, holiday_session_handling: e.target.value }))}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="skip">Skip — holidays not charged (default)</option>
            <option value="include">Include — holidays charged as leave</option>
            <option value="block">Block — reject spans containing holidays</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Weekoff in Span</p>
          <p className="text-[11px] text-muted-foreground">How weekly-off days within a leave span are treated.</p>
          <select
            value={form.weekoff_session_handling}
            onChange={e => setForm(f => ({ ...f, weekoff_session_handling: e.target.value }))}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="skip">Skip — weekoffs not charged (default)</option>
            <option value="include">Include — weekoffs always charged</option>
            <option value="sandwich_only">Sandwich Only — charged when sandwiched</option>
          </select>
        </div>
      </div>

      <SectionDivider label="Rounding & Calculation Mode" />

      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Fractional Rounding Mode</p>
          <p className="text-[11px] text-muted-foreground mb-2">How fractional leave days are rounded before deducting from balance.</p>
          <RadioPill
            options={ROUNDING_OPTIONS}
            value={form.fractional_rounding_mode}
            onChange={v => setForm(f => ({ ...f, fractional_rounding_mode: v }))}
            cols={4}
          />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Session Calculation Mode</p>
          <p className="text-[11px] text-muted-foreground mb-2">Controls how session duration and deduction amounts are computed.</p>
          <RadioPill
            options={CALC_MODE_OPTIONS}
            value={form.session_calculation_mode}
            onChange={v => setForm(f => ({ ...f, session_calculation_mode: v }))}
          />
        </div>
      </div>
    </div>
  )
}

function WindowsTab({
  form, setForm,
}: {
  form: PolicyForm
  setForm: React.Dispatch<React.SetStateAction<PolicyForm>>
}) {
  return (
    <div className="space-y-6">

      <SectionDivider label="Past-Dated Leave" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Allow Past-Dated Leave</p>
            <p className="text-xs text-muted-foreground mt-0.5">Employee can apply leave for dates before today</p>
          </div>
          <Toggle
            checked={form.allow_past_dated_leave}
            onChange={v => setForm(f => ({
              ...f,
              allow_past_dated_leave: v,
              maximum_past_days: v ? f.maximum_past_days || 7 : 0,
            }))}
            label="Allow Past-Dated Leave"
          />
        </div>

        {form.allow_past_dated_leave && (
          <FormField
            label="Maximum Past Days"
            htmlFor="max-past-days"
            description="How many calendar days back is allowed"
          >
            <Input
              id="max-past-days"
              type="number" min={1} max={365} step={1}
              value={form.maximum_past_days}
              onChange={e => setForm(f => ({ ...f, maximum_past_days: Math.max(1, parseInt(e.target.value) || 1) }))}
              placeholder="e.g. 7"
            />
          </FormField>
        )}
      </div>

      <SectionDivider label="Same-Day Leave" />

      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Same-Day Application Mode</p>
        <p className="text-[11px] text-muted-foreground mb-2">Controls whether employees can apply leave on the same calendar day.</p>
        <RadioPill
          options={[
            { value: 'allowed',               label: 'Allowed',               description: 'Same-day leave is unrestricted' },
            { value: 'restricted',            label: 'Restricted',            description: 'Same-day leave is blocked entirely' },
            { value: 'manager_override_only', label: 'Manager Override Only', description: 'Blocked for self-service; manager can approve' },
          ]}
          value={form.same_day_application_mode}
          onChange={v => setForm(f => ({ ...f, same_day_application_mode: v as typeof f.same_day_application_mode }))}
        />
      </div>

      <SectionDivider label="Current Period" />

      <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Allow Current-Month Leave</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            When disabled, employees cannot apply leave for any date in the current calendar month
          </p>
        </div>
        <Toggle
          checked={form.allow_current_period_leave}
          onChange={v => setForm(f => ({ ...f, allow_current_period_leave: v }))}
          label="Allow Current-Month Leave"
        />
      </div>

      <SectionDivider label="Future Leave" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Allow Future Leave</p>
            <p className="text-xs text-muted-foreground mt-0.5">Employee can apply leave for dates after today</p>
          </div>
          <Toggle
            checked={form.allow_future_leave}
            onChange={v => setForm(f => ({ ...f, allow_future_leave: v }))}
            label="Allow Future Leave"
          />
        </div>

        {form.allow_future_leave && (
          <FormField
            label="Maximum Future Days"
            htmlFor="max-future-days"
            description="Days ahead allowed (blank = unlimited)"
          >
            <Input
              id="max-future-days"
              type="number" min={1} max={730} step={1}
              value={form.maximum_future_days ?? ''}
              onChange={e => setForm(f => ({
                ...f,
                maximum_future_days: e.target.value === '' ? null : Math.max(1, parseInt(e.target.value) || 1),
              }))}
              placeholder="Unlimited"
            />
          </FormField>
        )}

        {form.allow_future_leave && (
          <div className="sm:col-span-2 flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Future Leave Requires Approval</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Future leave requests are always flagged for mandatory manager review
              </p>
            </div>
            <Toggle
              checked={form.future_application_requires_approval}
              onChange={v => setForm(f => ({ ...f, future_application_requires_approval: v }))}
              label="Require Approval for Future Leave"
            />
          </div>
        )}
      </div>

      {/* Application window summary */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-1.5">Window Summary</p>
        <div className="flex items-center gap-2">
          {form.allow_past_dated_leave
            ? <><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" /><span>Past leave: up to <strong className="text-foreground">{form.maximum_past_days}</strong> day(s) back</span></>
            : <><AlertCircle  className="h-3.5 w-3.5 text-destructive/70 shrink-0" /><span>Past leave: <span className="text-destructive font-medium">not allowed</span></span></>
          }
        </div>
        <div className="flex items-center gap-2">
          {form.same_day_application_mode === 'allowed'
            ? <><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" /><span>Same-day: <strong className="text-foreground">allowed</strong></span></>
            : form.same_day_application_mode === 'manager_override_only'
            ? <><Info className="h-3.5 w-3.5 text-warning shrink-0" /><span>Same-day: <strong className="text-foreground">manager override only</strong></span></>
            : <><AlertCircle className="h-3.5 w-3.5 text-destructive/70 shrink-0" /><span>Same-day: <span className="text-destructive font-medium">restricted</span></span></>
          }
        </div>
        <div className="flex items-center gap-2">
          {form.allow_future_leave
            ? <><CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" /><span>Future leave: up to <strong className="text-foreground">{form.maximum_future_days ?? '∞'}</strong> day(s){form.future_application_requires_approval && ' · approval required'}</span></>
            : <><AlertCircle className="h-3.5 w-3.5 text-destructive/70 shrink-0" /><span>Future leave: <span className="text-destructive font-medium">not allowed</span></span></>
          }
        </div>
      </div>
    </div>
  )
}

function LifecycleTab({
  form, setForm,
}: {
  form: PolicyForm
  setForm: React.Dispatch<React.SetStateAction<PolicyForm>>
}) {
  return (
    <div className="space-y-6">

      <SectionDivider label="Accrual Cycle & Credit Timings" />

      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Earning Basis</p>
          <p className="text-[11px] text-muted-foreground mb-2">
            Advance: credit at cycle start (e.g. CL). Earned: credit at cycle end (e.g. EL).
          </p>
          <RadioPill
            options={[
              { value: 'earned',  label: 'Earned',  description: 'Credit issued at end of cycle' },
              { value: 'advance', label: 'Advance', description: 'Credit issued at start of cycle' },
            ]}
            value={form.accrual_earning_basis}
            onChange={v => setForm(f => ({ ...f, accrual_earning_basis: v }))}
            cols={2}
          />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Credit Timing</p>
          <p className="text-[11px] text-muted-foreground mb-2">When in the cycle the credit is posted to the ledger.</p>
          <RadioPill
            options={[
              { value: 'cycle_start', label: 'Cycle Start', description: 'Posted on the first day of each cycle' },
              { value: 'cycle_end',   label: 'Cycle End',   description: 'Posted on the last day of each cycle' },
            ]}
            value={form.accrual_credit_timing}
            onChange={v => setForm(f => ({ ...f, accrual_credit_timing: v }))}
            cols={2}
          />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Consumability Timing</p>
          <p className="text-[11px] text-muted-foreground mb-2">When a posted credit becomes available for the employee to use.</p>
          <RadioPill
            options={[
              { value: 'immediate',                     label: 'Immediate',            description: 'Available as soon as posted' },
              { value: 'after_cycle_completion',        label: 'After Cycle',          description: 'Available after cycle completes' },
              { value: 'after_payroll_lock',            label: 'After Payroll Lock',   description: 'Available after payroll is locked' },
              { value: 'after_attendance_confirmation', label: 'After Attendance',     description: 'Available after attendance is confirmed' },
            ]}
            value={form.accrual_consumption_timing}
            onChange={v => setForm(f => ({ ...f, accrual_consumption_timing: v }))}
            cols={4}
          />
          {form.accrual_earning_basis === 'advance' && (
            <div className="flex items-center gap-2 mt-3">
              <Toggle
                checked={form.future_accrual_consumable}
                onChange={v => setForm(f => ({ ...f, future_accrual_consumable: v }))}
                label="Allow advance credits before cycle completes"
              />
              <span className="text-xs text-foreground">Allow advance credits to be used before cycle completes</span>
            </div>
          )}
        </div>
      </div>

      <SectionDivider label="Mid-Cycle Handling" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Joining Cycle Handling</p>
          <RadioPill
            options={[
              { value: 'full',       label: 'Full Credit', description: 'Full cycle credit on joining' },
              { value: 'prorate',    label: 'Prorate',     description: 'Credit proportional to days remaining' },
              { value: 'next_cycle', label: 'Next Cycle',  description: 'First credit on next full cycle' },
            ]}
            value={form.joining_cycle_handling}
            onChange={v => setForm(f => ({ ...f, joining_cycle_handling: v }))}
          />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Separation Cycle Handling</p>
          <RadioPill
            options={[
              { value: 'full',    label: 'Full Credit', description: 'Full cycle credit on exit' },
              { value: 'prorate', label: 'Prorate',     description: 'Credit proportional to days worked' },
              { value: 'none',    label: 'No Credit',   description: 'No credit in final partial cycle' },
            ]}
            value={form.separation_cycle_handling}
            onChange={v => setForm(f => ({ ...f, separation_cycle_handling: v }))}
          />
        </div>
      </div>

      {form.accrual_earning_basis === 'advance' && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Advance Recovery on Separation</p>
          <p className="text-[11px] text-muted-foreground mb-2">
            How to handle unearned advance credits if the employee resigns mid-cycle.
          </p>
          <RadioPill
            options={[
              { value: 'none',         label: 'No Recovery',   description: 'Employee keeps unearned credits' },
              { value: 'prorate',      label: 'Prorate',       description: 'Recover proportional unearned days' },
              { value: 'full_recovery', label: 'Full Recovery', description: 'Recover all unearned advance credits' },
              { value: 'lop_deduction', label: 'LOP Deduction', description: 'Deduct as Loss of Pay from final settlement' },
            ]}
            value={form.advance_accrual_recovery_mode}
            onChange={v => setForm(f => ({ ...f, advance_accrual_recovery_mode: v }))}
            cols={4}
          />
        </div>
      )}

      <SectionDivider label="Accrual Thresholds" />

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Min Service Days" htmlFor="min-svc" description="Days after joining before first accrual">
          <Input
            id="min-svc"
            type="number" min={0}
            value={form.minimum_service_days}
            onChange={e => setForm(f => ({ ...f, minimum_service_days: parseInt(e.target.value) || 0 }))}
            placeholder="0"
          />
        </FormField>
        <FormField label="Min Paid Days / Cycle" htmlFor="min-paid" description="0 = no minimum">
          <Input
            id="min-paid"
            type="number" min={0}
            value={form.minimum_paid_days}
            onChange={e => setForm(f => ({ ...f, minimum_paid_days: parseInt(e.target.value) || 0 }))}
            placeholder="0"
          />
        </FormField>
        <FormField label="Min Attendance %" htmlFor="min-att" description="0 = no minimum">
          <Input
            id="min-att"
            type="number" min={0} max={100} step={5}
            value={form.minimum_attendance_pct}
            onChange={e => setForm(f => ({ ...f, minimum_attendance_pct: parseFloat(e.target.value) || 0 }))}
            placeholder="0"
          />
        </FormField>
      </div>

      <SectionDivider label="Advanced Options" />

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Tiered Accrual Rates</p>
            <p className="text-xs text-muted-foreground">Configure tiers in Governance → Lifecycle</p>
          </div>
          <Toggle
            checked={form.tiered_accrual_enabled}
            onChange={v => setForm(f => ({ ...f, tiered_accrual_enabled: v }))}
            label="Enable tiered accrual"
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Service Anniversary Cycle</p>
            <p className="text-xs text-muted-foreground">Accrue only in the employee's anniversary month</p>
          </div>
          <Toggle
            checked={form.service_anniversary_cycle}
            onChange={v => setForm(f => ({ ...f, service_anniversary_cycle: v }))}
            label="Service anniversary cycle"
          />
        </div>
      </div>

      <SectionDivider label="Freeze & Payroll Cutoff" />

      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Freeze Behaviour</p>
          <p className="text-[11px] text-muted-foreground mb-2">What happens to credits when an employee's accrual is frozen.</p>
          <RadioPill
            options={[
              { value: 'skip',   label: 'Skip',   description: 'Frozen cycles are skipped with no replay' },
              { value: 'replay', label: 'Replay', description: 'Frozen cycles are replayed on unfreeze' },
            ]}
            value={form.accrual_freeze_mode}
            onChange={v => setForm(f => ({ ...f, accrual_freeze_mode: v }))}
            cols={2}
          />
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Payroll Cutoff Behaviour</p>
          <p className="text-[11px] text-muted-foreground mb-2">What happens when an accrual falls near the payroll lock date.</p>
          <RadioPill
            options={[
              { value: 'hold',         label: 'Hold',         description: 'Hold credits until after payroll lock' },
              { value: 'release',      label: 'Release',      description: 'Release credits immediately' },
              { value: 'defer_to_next', label: 'Defer',       description: 'Defer to next period' },
            ]}
            value={form.payroll_cutoff_behavior}
            onChange={v => setForm(f => ({ ...f, payroll_cutoff_behavior: v }))}
          />
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LeavePolicy() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()
  const navigate     = useNavigate()

  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [form, setForm]                     = useState<PolicyForm>(EMPTY_FORM)
  const [activeTab, setActiveTab]           = useState<PolicyTab>('accrual')

  // ── Queries ──────────────────────────────────────────────────────────────────
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
  const policies   = policiesData?.data ?? []
  const policyById = new Map(policies.map(p => [p.leave_type_id, p]))

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: PolicyForm & { leave_type_id: string }) => {
      const existing = policyById.get(body.leave_type_id)
      return existing
        ? api.put(`/masters/leave-policies/${existing.id}`, body)
        : api.post('/masters/leave-policies', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave-policies'] })
      toast.success('Policy saved')
    },
    onError: (e) => {
      toast.error('Policy save failed', { description: (e as Error).message })
    },
  })

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function selectType(lt: LeaveType) {
    setSelectedTypeId(lt.id)
    setActiveTab('accrual')
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
        allow_past_dated_leave:               existing.allow_past_dated_leave               ?? false,
        maximum_past_days:                    existing.maximum_past_days                    ?? 0,
        allow_current_period_leave:           existing.allow_current_period_leave           ?? true,
        allow_future_leave:                   existing.allow_future_leave                   ?? true,
        maximum_future_days:                  existing.maximum_future_days                  ?? null,
        future_application_requires_approval: existing.future_application_requires_approval ?? false,
        same_day_application_mode:            existing.same_day_application_mode            ?? 'allowed',
        allow_half_day:               existing.allow_half_day               ?? true,
        allow_hourly_leave:           existing.allow_hourly_leave           ?? false,
        allow_cross_session:          existing.allow_cross_session          ?? true,
        minimum_leave_unit:           existing.minimum_leave_unit           ?? 0.5,
        maximum_sessions_per_day:     existing.maximum_sessions_per_day     ?? 2,
        session_calculation_mode:     existing.session_calculation_mode     ?? 'standard',
        holiday_session_handling:     existing.holiday_session_handling     ?? 'skip',
        weekoff_session_handling:     existing.weekoff_session_handling     ?? 'skip',
        fractional_rounding_mode:     existing.fractional_rounding_mode     ?? 'nearest_0_5',
        maximum_fractional_precision: existing.maximum_fractional_precision ?? 0.5,
        hours_per_shift:              existing.hours_per_shift              ?? 8,
        max_hours_per_day:            existing.max_hours_per_day            ?? null,
        accrual_earning_basis:        existing.accrual_earning_basis        ?? 'earned',
        accrual_credit_timing:        existing.accrual_credit_timing        ?? 'cycle_start',
        accrual_consumption_timing:   existing.accrual_consumption_timing   ?? 'immediate',
        future_accrual_consumable:    existing.future_accrual_consumable    ?? true,
        advance_accrual_recovery_mode: existing.advance_accrual_recovery_mode ?? 'none',
        joining_cycle_handling:       existing.joining_cycle_handling       ?? 'prorate',
        separation_cycle_handling:    existing.separation_cycle_handling    ?? 'prorate',
        payroll_cutoff_behavior:      existing.payroll_cutoff_behavior      ?? 'hold',
        accrual_freeze_mode:          existing.accrual_freeze_mode          ?? 'skip',
        minimum_service_days:         existing.minimum_service_days         ?? 0,
        minimum_paid_days:            existing.minimum_paid_days            ?? 0,
        minimum_attendance_pct:       existing.minimum_attendance_pct       ?? 0,
        tiered_accrual_enabled:       existing.tiered_accrual_enabled       ?? false,
        service_anniversary_cycle:    existing.service_anniversary_cycle    ?? false,
      })
    } else {
      setForm(EMPTY_FORM)
    }
    saveMutation.reset()
  }

  function handleSave() {
    if (!selectedTypeId) return
    saveMutation.mutate({ ...form, leave_type_id: selectedTypeId })
  }

  const selectedType = leaveTypes.find(lt => lt.id === selectedTypeId)
  const hasPolicy    = selectedTypeId ? policyById.has(selectedTypeId) : false

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Leave Policy"
        subtitle="Configure accrual, eligibility, carry-forward and governance rules per leave type"
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
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">

            {/* ── Left: Leave type selector ──────────────────────────────────── */}
            <div className="lg:col-span-1">
              <SectionCard
                title="Leave Types"
                icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
                description="Select a type to configure"
              >
                {ltLoading ? (
                  <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : leaveTypes.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">
                    No active leave types. Create them in Leave Types first.
                  </p>
                ) : (
                  <div className="space-y-1 -mx-1">
                    {leaveTypes.map(lt => {
                      const hasP      = policyById.has(lt.id)
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
                              {hasP
                                ? <span className="text-[9px] text-success font-medium">● Policy set</span>
                                : <span className="text-[9px] text-muted-foreground">○ No policy</span>
                              }
                            </div>
                          </div>
                          <ChevronRight className={cn(
                            'h-3.5 w-3.5 flex-shrink-0 transition-colors',
                            isSelected ? 'text-primary' : 'text-muted-foreground/40',
                          )} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* ── Right: Tab-based policy form ───────────────────────────────── */}
            <div className="lg:col-span-3">
              {!selectedTypeId ? (
                <SectionCard>
                  <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
                    <Settings2 className="h-10 w-10 opacity-20" />
                    <p className="text-sm font-medium text-foreground">Select a leave type</p>
                    <p className="text-xs">Click a leave type on the left to configure its policy.</p>
                  </div>
                </SectionCard>
              ) : (
                <SectionCard
                  title={`${selectedType?.name ?? ''} Policy`}
                  icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
                  description={hasPolicy ? 'Editing existing policy' : 'No policy yet — configure and save to create one'}
                >
                  {policyLoading ? (
                    <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading policy…
                    </div>
                  ) : (
                    <div className="space-y-0">

                      {/* ── Tab bar ──────────────────────────────────────────── */}
                      <SubTabs<PolicyTab>
                        tabs={POLICY_TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
                        value={activeTab}
                        onChange={setActiveTab}
                        className="-mx-1 mb-5"
                      />

                      {/* ── Tab content ──────────────────────────────────────── */}
                      {activeTab === 'accrual' && (
                        <AccrualTab form={form} setForm={setForm} />
                      )}
                      {activeTab === 'sessions' && (
                        <SessionsTab form={form} setForm={setForm} />
                      )}
                      {activeTab === 'windows' && (
                        <WindowsTab form={form} setForm={setForm} />
                      )}
                      {activeTab === 'lifecycle' && (
                        <LifecycleTab form={form} setForm={setForm} />
                      )}

                      {/* ── Single save bar ──────────────────────────────────── */}
                      <div className="flex items-center justify-between gap-3 border-t border-border mt-6 pt-4">
                        <div className="flex gap-1">
                          {POLICY_TABS.map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveTab(tab.id)}
                              className={cn(
                                'h-1.5 rounded-full transition-all',
                                activeTab === tab.id ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50',
                              )}
                              aria-label={tab.label}
                            />
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectedType && selectType(selectedType)}
                            disabled={saveMutation.isPending}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                            Reset
                          </Button>
                          <Button
                            size="sm"
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
                    </div>
                  )}
                </SectionCard>
              )}
            </div>
          </div>

          {/* ── Automation notice ────────────────────────────────────────────── */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0 rounded-md bg-primary/10 p-2">
                <Activity className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Entitlement operations are managed by the Leave Automation Engine
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Monthly accrual, yearly credit, carry-forward, expiry and event grants run automatically
                  on schedule. The scheduler is the single authoritative execution engine — use the Engine
                  Status dashboard for observability and recovery.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => navigate('/admin/leave-jobs')}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Engine Status
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </Button>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Use Advanced Recovery in Engine Status for manual replay with audit trail
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  )
}
