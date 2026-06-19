/**
 * SubscriptionBanner — proactive notice when the workspace isn't on an active
 * paid subscription. Renders nothing for active tenants. Driven by
 * GET /billing/status; links to /admin/billing.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api/client'

interface BillingStatus {
  status: string
  trial_ends_at: string | null
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export function SubscriptionBanner() {
  const { data } = useQuery<{ data: BillingStatus }>({
    queryKey: ['billing-status'],
    queryFn: () => api.get('/billing/status'),
    staleTime: 5 * 60_000,
  })
  const s = data?.data
  if (!s || s.status === 'active') return null

  let message: string | null = null
  if (s.status === 'suspended' || s.status === 'expired' || s.status === 'cancelled') {
    message = `Your workspace is ${s.status}. Subscribe to restore full access.`
  } else if (s.status === 'trial') {
    const d = daysUntil(s.trial_ends_at)
    if (d !== null && d <= 7) {
      message = d <= 0 ? 'Your free trial has ended. Subscribe to keep editing.'
        : `Your free trial ends in ${d} day${d === 1 ? '' : 's'}.`
    }
  }
  if (!message) return null

  return (
    <div className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
      <span>{message}</span>
      <Link to="/admin/billing" className="font-semibold text-warning underline underline-offset-2 hover:opacity-80">
        Manage billing
      </Link>
    </div>
  )
}
