/**
 * RegularisationPolicyCard — tenant regularisation limit configuration.
 *
 * Mounted on the live regularisation page (/admin/attendance/regularisation,
 * "Approvals") for HR admins. Manages regularisation_policy via
 * GET/PUT /attendance/regularisation/policy:
 *   · submission window, max requests per configurable period
 *   · exclude-rejected toggle
 *   · per-request-type sub-limits
 *   · SLA hours, auto-reject on breach, breach-notify list
 *
 * Collapsible — hidden until the admin opens it, so it doesn't crowd the queue.
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Settings2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button }      from '@/components/ui/button'
import { Input }       from '@/components/ui/input'
import { api }         from '@/lib/api/client'
import { toast }       from 'sonner'

interface RegPolicy {
  id:                        string
  submission_window_days:    number
  max_per_month:             number
  sla_hours:                 number
  auto_reject_on_sla_breach: boolean
  sla_breach_notify:         string | null
  limit_period:              'week' | 'month' | 'quarter' | 'year'
  exclude_rejected:          boolean
  per_type_limits:           Record<string, number>
}

const REG_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'missed_punch',    label: 'Missed punch' },
  { value: 'forgot_checkout', label: 'Forgot checkout' },
  { value: 'onsite_duty',     label: 'Onsite duty' },
  { value: 'biometric_issue', label: 'Biometric issue' },
  { value: 'client_visit',    label: 'Client visit' },
  { value: 'wfh',             label: 'Work from home' },
  { value: 'field_work',      label: 'Field work' },
  { value: 'system_issue',    label: 'System issue' },
]

const LIMIT_PERIOD_OPTIONS: { value: RegPolicy['limit_period']; label: string }[] = [
  { value: 'week',    label: 'Per week' },
  { value: 'month',   label: 'Per month' },
  { value: 'quarter', label: 'Per quarter' },
  { value: 'year',    label: 'Per year' },
]

export function RegularisationPolicyCard({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const [open, setOpen]   = useState(defaultOpen)
  const [form, setForm]   = useState<Partial<RegPolicy>>({})
  const [dirty, setDirty] = useState(false)

  const { data: resp, refetch } = useQuery<{ data: RegPolicy }>({
    queryKey: ['regularisation-policy'],
    queryFn:  () => api.get('/attendance/regularisation/policy'),
    staleTime: 300_000,
  })
  const policy = resp?.data

  const save = useMutation({
    mutationFn: (body: Partial<RegPolicy>) => api.put('/attendance/regularisation/policy', body),
    onSuccess: () => { refetch(); setDirty(false); toast.success('Regularisation policy updated') },
    onError: (e) => toast.error('Failed to update policy', { description: (e as Error).message }),
  })

  const v = <K extends keyof RegPolicy>(key: K): RegPolicy[K] | undefined =>
    (form[key] ?? policy?.[key]) as RegPolicy[K] | undefined
  const set = (patch: Partial<RegPolicy>) => { setForm(p => ({ ...p, ...patch })); setDirty(true) }
  const typeLimits = (form.per_type_limits ?? policy?.per_type_limits ?? {}) as Record<string, number>

  return (
    <SectionCard
      title="Regularisation Policy"
      icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
      action={
        <Button size="sm" variant="ghost" className="h-7 text-xs"
          onClick={() => { setOpen(o => !o); if (policy) setForm(policy) }}>
          {open ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
          {open ? 'Hide' : 'Configure limits'}
        </Button>
      }
    >
      {!open ? (
        <p className="text-xs text-muted-foreground">
          {policy
            ? `Max ${policy.max_per_month} request(s) ${LIMIT_PERIOD_OPTIONS.find(o => o.value === policy.limit_period)?.label.toLowerCase() ?? 'per month'}, submission window ${policy.submission_window_days} day(s).`
            : 'Configure submission window, request limits and per-type caps.'}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-4">Configure submission rules, frequency limits, and SLA targets for attendance correction requests.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Submission Window (days)</label>
              <Input type="number" min={1} max={90} className="h-8 text-xs"
                value={v('submission_window_days') ?? 7}
                onChange={e => set({ submission_window_days: +e.target.value })} />
              <p className="text-[10px] text-muted-foreground">Max days after attendance date that an employee can submit a request.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Max Requests / Period</label>
              <Input type="number" min={1} max={100} className="h-8 text-xs"
                value={v('max_per_month') ?? 5}
                onChange={e => set({ max_per_month: +e.target.value })} />
              <p className="text-[10px] text-muted-foreground">Maximum regularisation requests per employee in each limit period.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Limit Period</label>
              <select className="h-8 text-xs w-full border border-border rounded-md px-2 bg-background text-foreground"
                value={v('limit_period') ?? 'month'}
                onChange={e => set({ limit_period: e.target.value as RegPolicy['limit_period'] })}>
                {LIMIT_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground">Window the request cap is counted over.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Exclude rejected from limit</label>
              <div className="flex items-center gap-2 h-8">
                <input type="checkbox" id="reg-exclude-rejected" className="h-4 w-4 rounded accent-primary"
                  checked={v('exclude_rejected') ?? true}
                  onChange={e => set({ exclude_rejected: e.target.checked })} />
                <label htmlFor="reg-exclude-rejected" className="text-xs text-foreground">Don't count rejected requests</label>
              </div>
              <p className="text-[10px] text-muted-foreground">Rejected requests won't consume an employee's quota. (Cancelled never counts.)</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">SLA (hours)</label>
              <Input type="number" min={1} max={720} className="h-8 text-xs"
                value={v('sla_hours') ?? 48}
                onChange={e => set({ sla_hours: +e.target.value })} />
              <p className="text-[10px] text-muted-foreground">Target resolution time from submission to approve/reject.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Auto-reject on SLA breach</label>
              <div className="flex items-center gap-2 h-8">
                <input type="checkbox" id="reg-auto-reject" className="h-4 w-4 rounded accent-primary"
                  checked={v('auto_reject_on_sla_breach') ?? false}
                  onChange={e => set({ auto_reject_on_sla_breach: e.target.checked })} />
                <label htmlFor="reg-auto-reject" className="text-xs text-foreground">Enable</label>
              </div>
              <p className="text-[10px] text-muted-foreground">Automatically reject requests that breach SLA when "Check SLA" is run.</p>
            </div>
            <div className="space-y-1 sm:col-span-2 lg:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">SLA Breach Notify (emails, comma-separated)</label>
              <Input type="text" className="h-8 text-xs" placeholder="hr@company.com, admin@company.com"
                value={v('sla_breach_notify') ?? ''}
                onChange={e => set({ sla_breach_notify: e.target.value || null })} />
            </div>
          </div>

          {/* Per-type sub-limits */}
          <div className="mt-5 pt-4 border-t border-border">
            <label className="text-xs font-medium text-muted-foreground">Per-type limits (optional)</label>
            <p className="text-[10px] text-muted-foreground mb-3">Cap specific request types within the limit period. Leave blank or 0 for no per-type cap (only the overall cap applies).</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {REG_TYPE_OPTIONS.map(t => (
                <div key={t.value} className="space-y-1">
                  <label className="text-[11px] text-foreground">{t.label}</label>
                  <Input type="number" min={0} max={100} placeholder="—" className="h-8 text-xs"
                    value={typeLimits[t.value] ?? ''}
                    onChange={e => {
                      const next = { ...typeLimits }
                      const n = e.target.value === '' ? 0 : Math.max(0, Math.min(100, +e.target.value))
                      if (n > 0) next[t.value] = n; else delete next[t.value]
                      set({ per_type_limits: next })
                    }} />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setOpen(false); setDirty(false); setForm(policy ?? {}) }}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!dirty || save.isPending} onClick={() => save.mutate(form)}>
              {save.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</> : 'Save Policy'}
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  )
}
