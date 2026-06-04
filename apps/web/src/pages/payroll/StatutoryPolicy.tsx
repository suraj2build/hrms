/**
 * StatutoryPolicy — embedded tab of Compensation Setup (/admin/payroll/setup?tab=policy)
 *
 * Read/write UI for the tenant-level `compensation_policies` row that the
 * CompensationEngine already consumes (PF rates, PF wage cap, NLC enforcement).
 *
 * Before this page, the row had NO UI — tenants silently inherited
 * DEFAULT_COMPENSATION_POLICY (12% / 12% / ₹15,000 / NLC on). This surfaces it.
 *
 * NO calc change: the engine reads this exact row today; we only let admins set it.
 *
 * API:
 *   GET /compensation-policy          → { data: { ...policy, is_configured } }
 *   PUT /compensation-policy           → upsert (hr_admin / super_admin)
 *
 * Access: hr_admin / super_admin (write); others read-only.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Loader2, Save, Info, Landmark, Scale } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Label }         from '@/components/ui/label'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompensationPolicy {
  nlc_enabled:      boolean
  pf_enabled:       boolean
  pf_employee_rate: number
  pf_employer_rate: number
  pf_cap_amount:    number
  is_configured:    boolean
}

interface PolicyForm {
  nlc_enabled:      boolean
  pf_enabled:       boolean
  pf_employee_rate: string
  pf_employer_rate: string
  pf_cap_amount:    string
}

const DEFAULT_FORM: PolicyForm = {
  nlc_enabled: true, pf_enabled: false,
  pf_employee_rate: '12', pf_employer_rate: '12', pf_cap_amount: '15000',
}

// ── Toggle row ──────────────────────────────────────────────────────────────────

function ToggleRow({
  label, hint, checked, disabled, onChange,
}: {
  label: string; hint: string; checked: boolean; disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <span className={[
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        ].join(' ')} />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function StatutoryPolicy() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const [form, setForm] = useState<PolicyForm>(DEFAULT_FORM)

  const { data, isLoading } = useQuery<{ data: CompensationPolicy }>({
    queryKey: ['compensation-policy'],
    queryFn:  () => api.get('/compensation-policy'),
    staleTime: 60_000,
  })

  const policy = data?.data

  useEffect(() => {
    if (policy) {
      setForm({
        nlc_enabled:      policy.nlc_enabled,
        pf_enabled:       policy.pf_enabled,
        pf_employee_rate: String(policy.pf_employee_rate),
        pf_employer_rate: String(policy.pf_employer_rate),
        pf_cap_amount:    String(policy.pf_cap_amount),
      })
    }
  }, [policy])

  const save = useMutation({
    mutationFn: (body: object) => api.put('/compensation-policy', body),
    onSuccess: () => {
      toast.success('Statutory policy saved')
      qc.invalidateQueries({ queryKey: ['compensation-policy'] })
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save policy'),
  })

  function handleSave() {
    const empRate = Number(form.pf_employee_rate)
    const erRate  = Number(form.pf_employer_rate)
    const cap     = Number(form.pf_cap_amount)

    if ([empRate, erRate, cap].some(n => Number.isNaN(n))) {
      toast.error('Rates and cap must be numbers')
      return
    }
    if (empRate < 0 || empRate > 30 || erRate < 0 || erRate > 30) {
      toast.error('PF rates must be between 0 and 30%')
      return
    }
    if (cap < 0) { toast.error('PF cap cannot be negative'); return }

    save.mutate({
      nlc_enabled:      form.nlc_enabled,
      pf_enabled:       form.pf_enabled,
      pf_employee_rate: empRate,
      pf_employer_rate: erRate,
      pf_cap_amount:    cap,
    })
  }

  if (isLoading) {
    return (
      <PageContainer size="medium">
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading policy…
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="medium">
      {/* Defaults banner */}
      {policy && !policy.is_configured && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <Info className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
          <p className="text-sm text-foreground">
            This tenant has no saved statutory policy — the compensation engine is
            currently using <span className="font-medium">system defaults</span>{' '}
            (12% / 12% PF, ₹15,000 cap, NLC on). Save below to make them explicit.
          </p>
        </div>
      )}

      {/* New Labour Code */}
      <SectionCard
        title="New Labour Code (NLC)"
        description="Enforce Basic (+ NLC-tagged components) ≥ 50% of gross at compensation authoring time."
        icon={<Scale className="h-4 w-4 text-muted-foreground" />}
      >
        <ToggleRow
          label="Enforce NLC 50% rule"
          hint="When on, the engine rebalances Basic upward if it falls below 50% of gross."
          checked={form.nlc_enabled}
          disabled={!isAdmin}
          onChange={v => setForm(f => ({ ...f, nlc_enabled: v }))}
        />
      </SectionCard>

      {/* Provident Fund */}
      <SectionCard
        title="Provident Fund (PF / EPF)"
        description="Tenant-level PF switch and contribution rates. Per-employee PF enrolment is still required."
        icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
      >
        <ToggleRow
          label="Enable PF"
          hint="Master switch. PF is also gated per employee (employee.pf_enabled)."
          checked={form.pf_enabled}
          disabled={!isAdmin}
          onChange={v => setForm(f => ({ ...f, pf_enabled: v }))}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="pf-emp">Employee rate (%)</Label>
            <Input
              id="pf-emp" type="number" step="0.01" min="0" max="30"
              value={form.pf_employee_rate}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, pf_employee_rate: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-er">Employer rate (%)</Label>
            <Input
              id="pf-er" type="number" step="0.01" min="0" max="30"
              value={form.pf_employer_rate}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, pf_employer_rate: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-cap">Monthly wage cap (₹)</Label>
            <Input
              id="pf-cap" type="number" step="1" min="0"
              value={form.pf_cap_amount}
              disabled={!isAdmin}
              onChange={e => setForm(f => ({ ...f, pf_cap_amount: e.target.value }))}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          Statutory default: 12% / 12% on Basic, capped at ₹15,000/month (EPF Act ceiling).
        </p>
      </SectionCard>

      {/* Save */}
      <div className="flex items-center justify-end gap-3">
        {!isAdmin && (
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Read-only
          </Badge>
        )}
        <Button onClick={handleSave} disabled={!isAdmin || save.isPending}>
          {save.isPending
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
            : <><Save className="h-4 w-4 mr-2" /> Save Policy</>}
        </Button>
      </div>
    </PageContainer>
  )
}
