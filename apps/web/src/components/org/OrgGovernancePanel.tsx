/**
 * OrgGovernancePanel — Compact org structure summary widget.
 *
 * Shows a live hierarchy count card:
 *
 *   Organization
 *   ├─  4 Sites
 *   ├─ 12 Work Locations  (2 unassigned)
 *   └─  8 Cost Centers
 *
 * Lightweight: single fetch to each /masters endpoint (all cached via
 * TanStack Query — shares cache with Sites, WorkLocations, CostCenters pages).
 * No mutations; read-only.
 *
 * Usage:
 *   <OrgGovernancePanel />                  — standalone, with navigation
 *   <OrgGovernancePanel compact />          — minimal inline chip variant
 */
import { useMemo }                            from 'react'
import { useNavigate }                        from 'react-router-dom'
import { useQuery }                           from '@tanstack/react-query'
import {
  Globe, MapPin, DollarSign,
  ChevronRight, AlertTriangle,
} from 'lucide-react'
import { api }   from '@/lib/api/client'
import { cn }    from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Site         { id: string }
interface WorkLocation { id: string; site_id: string | null }
interface CostCenter   { id: string }

// ── OrgGovernancePanel ────────────────────────────────────────────────────────

interface OrgGovernancePanelProps {
  /** Show a minimal single-line chip variant instead of the full card */
  compact?: boolean
  className?: string
}

export function OrgGovernancePanel({ compact = false, className }: OrgGovernancePanelProps) {
  const navigate = useNavigate()

  const { data: sitesData }  = useQuery<{ data: Site[] }>({
    queryKey: ['sites'],
    queryFn:  () => api.get('/masters/sites'),
    staleTime: 120_000,
  })
  const { data: locsData }   = useQuery<{ data: WorkLocation[] }>({
    queryKey: ['work-locations'],
    queryFn:  () => api.get('/masters/work-locations'),
    staleTime: 120_000,
  })
  const { data: ccData }     = useQuery<{ data: CostCenter[] }>({
    queryKey: ['cost-centers'],
    queryFn:  () => api.get('/masters/cost-centers'),
    staleTime: 120_000,
  })

  const sites     = sitesData?.data ?? []
  const locs      = useMemo(() => locsData?.data ?? [], [locsData?.data])
  const ccs       = ccData?.data    ?? []

  const unassigned = useMemo(() => locs.filter(l => !l.site_id).length, [locs])

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
        <button onClick={() => navigate('/masters/sites')}
          className="flex items-center gap-1 hover:text-foreground transition-colors">
          <Globe className="h-3 w-3" />
          <span>{sites.length} site{sites.length !== 1 ? 's' : ''}</span>
        </button>
        <span className="text-border">·</span>
        <button onClick={() => navigate('/masters/work-locations')}
          className="flex items-center gap-1 hover:text-foreground transition-colors">
          <MapPin className="h-3 w-3" />
          <span>{locs.length} location{locs.length !== 1 ? 's' : ''}</span>
        </button>
        <span className="text-border">·</span>
        <button onClick={() => navigate('/masters/cost-centers')}
          className="flex items-center gap-1 hover:text-foreground transition-colors">
          <DollarSign className="h-3 w-3" />
          <span>{ccs.length} cost center{ccs.length !== 1 ? 's' : ''}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card p-3 space-y-1', className)}>
      {/* Header */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
        Organization
      </p>

      {/* Sites */}
      <OrgRow
        icon={<Globe className="h-3.5 w-3.5" />}
        label="Sites"
        count={sites.length}
        isLast={false}
        onClick={() => navigate('/masters/sites')}
      />

      {/* Work Locations */}
      <OrgRow
        icon={<MapPin className="h-3.5 w-3.5" />}
        label="Work Locations"
        count={locs.length}
        isLast={false}
        onClick={() => navigate('/masters/work-locations')}
        suffix={unassigned > 0 ? (
          <span className="ml-1 flex items-center gap-0.5 text-warning text-[10px]">
            <AlertTriangle className="h-2.5 w-2.5" />
            {unassigned} unassigned
          </span>
        ) : undefined}
      />

      {/* Cost Centers */}
      <OrgRow
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label="Cost Centers"
        count={ccs.length}
        isLast
        onClick={() => navigate('/masters/cost-centers')}
      />
    </div>
  )
}

// ── OrgRow ────────────────────────────────────────────────────────────────────

function OrgRow({
  icon,
  label,
  count,
  isLast,
  onClick,
  suffix,
}: {
  icon:    React.ReactNode
  label:   string
  count:   number
  isLast:  boolean
  onClick: () => void
  suffix?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-xs text-foreground/80 hover:text-foreground transition-colors group rounded px-1 py-0.5 hover:bg-muted/40"
    >
      {/* Tree branch */}
      <span className="text-muted-foreground/30 select-none text-[10px] w-4 shrink-0">
        {isLast ? '└─' : '├─'}
      </span>

      {/* Icon */}
      <span className="text-muted-foreground/60 shrink-0">{icon}</span>

      {/* Count */}
      <span className="font-semibold tabular-nums w-5 text-right shrink-0">{count}</span>

      {/* Label */}
      <span className="flex-1 text-left">{label}</span>

      {/* Optional suffix (e.g. warning) */}
      {suffix}

      {/* Nav chevron */}
      <ChevronRight className="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  )
}
