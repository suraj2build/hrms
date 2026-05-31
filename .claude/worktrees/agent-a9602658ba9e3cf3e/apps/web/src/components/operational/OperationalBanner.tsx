/**
 * OperationalBanner — persistent contextual awareness bar.
 *
 * Polls lightweight summary endpoints and surfaces high-priority
 * operational signals: stale attendance locks, open anomalies,
 * pending corrections, and payroll-freeze warnings.
 *
 * Mount once inside AppShell (above <main>) so it is visible
 * on every admin page.
 *
 * Usage:
 *   // In AppShell, between <Topbar /> and <main>:
 *   <OperationalBanner />
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, Lock, ClipboardCheck, Zap, ChevronRight, X,
} from 'lucide-react'
import { useAuthStore }  from '@/stores/authStore'
import { useBasePath }   from '@/lib/routing'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Signal types ──────────────────────────────────────────────────────────────

type BannerVariant = 'warning' | 'destructive' | 'info' | 'muted'

interface Signal {
  id:       string
  variant:  BannerVariant
  icon:     React.ComponentType<{ className?: string }>
  message:  string
  href?:    string
  cta?:     string
}

// ── Style map ─────────────────────────────────────────────────────────────────

const VARIANT: Record<BannerVariant, { bar: string; text: string; icon: string; btn: string }> = {
  destructive: {
    bar:  'bg-destructive/10 border-b border-destructive/25',
    text: 'text-destructive',
    icon: 'text-destructive',
    btn:  'hover:bg-destructive/20 text-destructive',
  },
  warning: {
    bar:  'bg-warning/10 border-b border-warning/25',
    text: 'text-warning',
    icon: 'text-warning',
    btn:  'hover:bg-warning/20 text-warning',
  },
  info: {
    bar:  'bg-info/10 border-b border-info/25',
    text: 'text-info',
    icon: 'text-info',
    btn:  'hover:bg-info/20 text-info',
  },
  muted: {
    bar:  'bg-muted/40 border-b border-border',
    text: 'text-muted-foreground',
    icon: 'text-muted-foreground/60',
    btn:  'hover:bg-muted text-muted-foreground',
  },
}

// ── Data hooks ────────────────────────────────────────────────────────────────

interface ProcessStatus {
  is_running:       boolean
  started_at:       string | null
  lock_ttl_seconds: number | null
}

interface AnomalySummary {
  open_count: number
}

interface CorrectionSummary {
  pending_count: number
}

/** Very lightweight — called every 60 s, stale-while-revalidate */
function useOperationalSignals(basePath: string): Signal[] {
  const { data: status } = useQuery<ProcessStatus>({
    queryKey:  ['op-banner-process-status'],
    queryFn:   () => api.get('/attendance/process/status'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const { data: anomaly } = useQuery<AnomalySummary>({
    queryKey:  ['op-banner-anomaly-summary'],
    queryFn:   () => api.get('/attendance/anomalies/summary'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const { data: correction } = useQuery<CorrectionSummary>({
    queryKey:  ['op-banner-correction-summary'],
    queryFn:   () => api.get('/attendance/regularisation/summary'),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const signals: Signal[] = []

  // 1. Stale / stuck attendance lock
  if (status?.is_running && status.started_at) {
    const ageMs = Date.now() - Date.parse(status.started_at)
    const ttlMs = (status.lock_ttl_seconds ?? 900) * 1_000
    if (ageMs > ttlMs) {
      signals.push({
        id:      'stale-lock',
        variant: 'destructive',
        icon:    Lock,
        message: 'Attendance processing appears stuck — the lock TTL has expired.',
        href:    `${basePath}/attendance`,
        cta:     'View',
      })
    } else {
      // Currently running (normal)
      signals.push({
        id:      'processing',
        variant: 'info',
        icon:    Zap,
        message: 'Attendance processing is running…',
      })
    }
  }

  // 2. Open anomalies
  const anomalyCount = anomaly?.open_count ?? 0
  if (anomalyCount > 0) {
    signals.push({
      id:      'anomalies',
      variant: anomalyCount >= 10 ? 'warning' : 'muted',
      icon:    AlertTriangle,
      message: `${anomalyCount} open attendance anomal${anomalyCount === 1 ? 'y' : 'ies'} need review.`,
      href:    `${basePath}/attendance/anomalies`,
      cta:     'Review',
    })
  }

  // 3. Pending corrections
  const correctionCount = correction?.pending_count ?? 0
  if (correctionCount > 0) {
    signals.push({
      id:      'corrections',
      variant: 'muted',
      icon:    ClipboardCheck,
      message: `${correctionCount} attendance correction${correctionCount === 1 ? '' : 's'} awaiting approval.`,
      href:    `${basePath}/attendance/corrections`,
      cta:     'Approve',
    })
  }

  return signals
}

// ── Single banner bar ─────────────────────────────────────────────────────────

function BannerBar({
  signal,
  onDismiss,
}: {
  signal:    Signal
  onDismiss: (id: string) => void
}) {
  const s    = VARIANT[signal.variant]
  const Icon = signal.icon

  return (
    <div className={cn('flex items-center gap-2 px-4 py-2 text-xs', s.bar)}>
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', s.icon)} />
      <span className={cn('flex-1', s.text)}>{signal.message}</span>
      {signal.href && signal.cta && (
        <Link
          to={signal.href}
          className={cn(
            'flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-medium transition-colors flex-shrink-0',
            s.btn,
          )}
        >
          {signal.cta}
          <ChevronRight className="h-3 w-3" />
        </Link>
      )}
      {/* Only dismissible for non-critical signals */}
      {signal.variant !== 'destructive' && (
        <button
          onClick={() => onDismiss(signal.id)}
          className={cn('p-0.5 rounded flex-shrink-0 transition-colors', s.btn)}
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OperationalBanner() {
  const { profile } = useAuthStore()
  const basePath    = useBasePath()
  const isAdmin     = ['super_admin', 'hr_admin', 'manager'].includes(profile?.role ?? '')

  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const signals = useOperationalSignals(basePath)

  // Only render for admins
  if (!isAdmin) return null

  const visible = signals.filter(s => !dismissed.has(s.id))
  if (visible.length === 0) return null

  function dismiss(id: string) {
    setDismissed(prev => new Set([...prev, id]))
  }

  // Show at most 2 banners to avoid banner fatigue; destructive always shows
  const prioritized = [
    ...visible.filter(s => s.variant === 'destructive'),
    ...visible.filter(s => s.variant !== 'destructive'),
  ].slice(0, 2)

  return (
    <div className="flex-shrink-0">
      {prioritized.map(signal => (
        <BannerBar key={signal.id} signal={signal} onDismiss={dismiss} />
      ))}
    </div>
  )
}
