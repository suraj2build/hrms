/**
 * Tenant-facing subscription / billing page.
 *
 * Shows the current plan + subscription state and lets an admin subscribe via
 * Razorpay Checkout. Degrades gracefully when billing isn't configured
 * (configured:false from the API) — see BILLING.md.
 */
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, CreditCard, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api/client'
import { fmtDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type Tier = 'standard' | 'enterprise'

interface RazorpayOptions {
  key: string
  subscription_id: string
  name: string
  description: string
  theme: { color: string }
  handler: () => void
  modal: { ondismiss: () => void }
}
interface RazorpayInstance { open: () => void }
interface RazorpayWindow {
  Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
}

interface BillingStatus {
  plan: string
  status: string
  subscription_status: string | null
  current_period_end: string | null
  trial_ends_at: string | null
  per_employee_rate: number | null
  configured: boolean
  keyId: string | null
}

const PLANS: { id: Tier; name: string; blurb: string; features: string[] }[] = [
  { id: 'standard',   name: 'Standard',   blurb: 'For growing teams', features: ['Core HR & directory', 'Attendance & leave', 'Payroll & payslips', 'Email support'] },
  { id: 'enterprise', name: 'Enterprise', blurb: 'For larger orgs',   features: ['Everything in Standard', 'Advanced analytics & exec views', 'Governance & compliance', 'Priority support'] },
]

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as unknown as RazorpayWindow).Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

export function Billing() {
  const [busy, setBusy] = useState<Tier | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<{ data: BillingStatus }>({
    queryKey: ['billing-status'],
    queryFn: () => api.get('/billing/status'),
  })
  const s = data?.data

  // Stable per-mount UUID sent as Idempotency-Key — a dropped response or
  // double-click retries the identical checkout request rather than
  // creating a second live Razorpay subscription. Rotated only after a
  // successful payment, since a retry before then should safely resume the
  // same pending subscription rather than start a new one.
  const checkoutKey = useRef(crypto.randomUUID())

  async function subscribe(plan: Tier) {
    try {
      setBusy(plan)
      const res = await api.post<{ configured: boolean; subscriptionId?: string; keyId?: string }>(
        '/billing/checkout',
        { plan },
        { headers: { 'Idempotency-Key': checkoutKey.current } },
      )
      if (!res.configured) {
        toast.error('Billing is not configured yet. Please contact sales.')
        return
      }
      const ok = await loadRazorpay()
      if (!ok || !res.subscriptionId || !res.keyId) {
        toast.error('Could not start checkout. Please try again.')
        return
      }
      const RazorpayCtor = (window as unknown as RazorpayWindow).Razorpay!
      const rzp = new RazorpayCtor({
        key: res.keyId,
        subscription_id: res.subscriptionId,
        name: 'CognixHR',
        description: `${plan[0].toUpperCase()}${plan.slice(1)} subscription`,
        theme: { color: '#1A4D8F' },
        handler: () => {
          checkoutKey.current = crypto.randomUUID()
          toast.success('Payment received — activating your subscription…')
          setTimeout(() => refetch(), 2500)
        },
        modal: { ondismiss: () => toast.message('Checkout cancelled') },
      })
      rzp.open()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Checkout failed')
    } finally {
      setBusy(null)
    }
  }

  const active = s?.status === 'active'

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Subscription &amp; Billing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your CognixHR plan.</p>
      </div>

      {/* Current status */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-destructive">Couldn’t load billing status.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Plan</p>
              <p className="text-lg font-semibold capitalize text-foreground">{s?.plan ?? '—'}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Status</p>
              <p className={`text-lg font-semibold capitalize ${active ? 'text-success' : 'text-warning'}`}>
                {s?.status ?? '—'}
              </p>
            </div>
            {s?.current_period_end && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Renews</p>
                <p className="text-lg font-semibold text-foreground">{fmtDate(s.current_period_end)}</p>
              </div>
            )}
            {s && !s.configured && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" /> Billing not yet configured
              </span>
            )}
          </div>
        )}
      </div>

      {/* Plans */}
      <div className="grid gap-4 sm:grid-cols-2">
        {PLANS.map((p) => {
          const current = s?.plan === p.id && active
          return (
            <div key={p.id} className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">{p.name}</h2>
                {current && <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">Current</span>}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{p.blurb}</p>
              <ul className="mt-4 space-y-2 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-foreground/90">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {f}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-5 gap-1.5"
                disabled={busy !== null || current}
                onClick={() => subscribe(p.id)}
              >
                <CreditCard className="h-4 w-4" />
                {current ? 'Active' : busy === p.id ? 'Starting…' : `Subscribe to ${p.name}`}
              </Button>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Payments are processed securely by Razorpay. {s?.per_employee_rate ? `Your rate: ₹${s.per_employee_rate}/employee.` : ''}
      </p>
    </div>
  )
}
