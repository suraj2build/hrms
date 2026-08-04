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
import { ShieldCheck, Loader2, Save, Info, Landmark, Scale, ArrowRight } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompensationPolicy {
  nlc_enabled:      boolean
  pf_enabled:       boolean
  pf_employee_rate: number
  pf_employer_rate: number
  pf_cap_amount:    number
  is_configured:    boolean
  version?:         number
}

interface EpfConfig {
  employee_contribution_pct:  number
  employer_pf_pct:            number
  employer_eps_pct:           number
  wage_ceiling:               number
  is_wage_ceiling_applicable: boolean
}

interface PolicyForm {
  nlc_enabled: boolean
  pf_enabled:  boolean
}

const DEFAULT_FORM: PolicyForm = {
  nlc_enabled: true, pf_enabled: false,
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

  const { data: epfData } = useQuery<EpfConfig>({
    queryKey: ['epf-config'],
    queryFn:  () => api.get<{ data?: EpfConfig } | EpfConfig>('/payroll/statutory/epf/config').then(r => (r as { data?: EpfConfig })?.data ?? (r as EpfConfig)),
    staleTime: 60_000,
  })

  const policy = data?.data

  useEffect(() => {
    if (policy) {
      setForm({
        nlc_enabled: policy.nlc_enabled,
        pf_enabled:  policy.pf_enabled,
      })
    }
  }, [policy])

  const versionConflict = useVersionConflict([['compensation-policy']])

  const save = useMutation({
    mutationFn: (body: object) => api.put('/compensation-policy', body),
    onSuccess: () => {
      toast.success('Statutory policy saved')
      qc.invalidateQueries({ queryKey: ['compensation-policy'] })
    },
    onError: (e: unknown) => {
      if (versionConflict(e)) return
      toast.error(e instanceof Error ? e.message : 'Failed to save policy')
    },
  })

  // ── Payroll statutory settings (TDS enable + default regime) ────────────────
  const [tdsForm, setTdsForm] = useState<{ tds_enabled: boolean; tds_default_regime: 'old' | 'new' }>({
    tds_enabled: false, tds_default_regime: 'new',
  })
  const { data: govData } = useQuery<{ data: { tds_enabled?: boolean; tds_default_regime?: 'old' | 'new' } | null }>({
    queryKey: ['payroll-statutory-settings'],
    queryFn:  () => api.get('/payroll/statutory/governance/settings'),
    staleTime: 60_000,
  })
  useEffect(() => {
    const s = govData?.data
    if (s) setTdsForm({ tds_enabled: !!s.tds_enabled, tds_default_regime: (s.tds_default_regime ?? 'new') })
  }, [govData])
  const saveTds = useMutation({
    mutationFn: (body: object) => api.put('/payroll/statutory/governance/settings', body),
    onSuccess: () => {
      toast.success('TDS settings saved')
      qc.invalidateQueries({ queryKey: ['payroll-statutory-settings'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to save TDS settings'),
  })

  function handleSave() {
    save.mutate(withExpectedVersion({
      nlc_enabled: form.nlc_enabled,
      pf_enabled:  form.pf_enabled,
    }, policy))
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
        description="Master switch for PF across all payroll runs. Contribution rates and wage ceiling are configured in EPF Management."
        icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
      >
        <ToggleRow
          label="Enable PF"
          hint="Master switch. PF is also gated per employee (employee.pf_enabled) and per statutory group."
          checked={form.pf_enabled}
          disabled={!isAdmin}
          onChange={v => setForm(f => ({ ...f, pf_enabled: v }))}
        />

        {/* Read-only rate summary — single source of truth is EPF Management */}
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-foreground">Current rates (from EPF Management)</p>
            <Link
              to="/admin/payroll/statutory/epf"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Configure rates <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {epfData ? (
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Employee</p>
                <p className="font-semibold text-foreground">{epfData.employee_contribution_pct}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Employer (EPF+EPS)</p>
                <p className="font-semibold text-foreground">{epfData.employer_pf_pct}%</p>
              </div>
              <div>
                <p className="text-muted-foreground">Wage ceiling</p>
                <p className="font-semibold text-foreground">
                  {epfData.is_wage_ceiling_applicable
                    ? `₹${epfData.wage_ceiling.toLocaleString('en-IN')}`
                    : 'No cap'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Defaults: 12% / 12%, capped at ₹15,000/month (EPF Act).
            </p>
          )}
        </div>
      </SectionCard>

      {/* TDS (Income Tax) — payroll statutory settings */}
      <SectionCard
        title="TDS (Income Tax)"
        description="Master switch for TDS in the payroll run. When ON, TDS is computed on projected annual income — no employee declaration is required (new regime + ₹75,000 standard deduction by default, FY24-25+)."
        icon={<Scale className="h-4 w-4 text-muted-foreground" />}
      >
        <ToggleRow
          label="Enable TDS"
          hint="When off, the payroll run skips TDS entirely. Already-finalized cycles keep their immutable snapshot — re-run them to apply."
          checked={tdsForm.tds_enabled}
          disabled={!isAdmin}
          onChange={v => setTdsForm(f => ({ ...f, tds_enabled: v }))}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="tds-regime">Default tax regime</Label>
            <select
              id="tds-regime"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 ring-primary/50"
              value={tdsForm.tds_default_regime}
              disabled={!isAdmin}
              onChange={e => setTdsForm(f => ({ ...f, tds_default_regime: e.target.value as 'old' | 'new' }))}
            >
              <option value="new">New regime (default — no declarations needed)</option>
              <option value="old">Old regime (uses approved declarations)</option>
            </select>
          </div>
          <div className="flex items-end justify-end">
            <Button onClick={() => saveTds.mutate(tdsForm)} disabled={!isAdmin || saveTds.isPending}>
              {saveTds.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                : <><Save className="h-4 w-4 mr-2" /> Save TDS Settings</>}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <Info className="h-3 w-3" />
          TDS is mandatory once projected annual tax exceeds the rebate threshold (≈₹7L taxable on the new regime). Below that, TDS is correctly ₹0.
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
