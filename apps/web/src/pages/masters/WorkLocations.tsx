/**
 * Work Locations — Enterprise Governance Console
 * /masters/work-locations
 *
 * Features:
 *   A. Header — icon + title + operational subtitle + action buttons
 *   B. Governance summary strip — Total / Sites / Assigned / Unassigned / Active / Employees
 *   C. Filter bar — search + site + status dropdowns
 *   D. Hierarchy table — grouped by site, expandable, employee counts per row
 *   E. Unassigned governance UX — warning styling + CTA
 *   F. Enhanced location rows — code badge, city/state, employee count, status, actions
 *   G. Empty states — guidance text + CTA
 *   H. Compact org overview panel (right sidebar)
 */
import { useState, useMemo }                           from 'react'
import { toast }                                      from 'sonner'
import { useQuery, useMutation, useQueryClient }      from '@tanstack/react-query'
import { useNavigate, useSearchParams }               from 'react-router-dom'
import {
  MapPin, Plus, Pencil, Trash2, Building2,
  ChevronRight, ChevronDown, Search,
  Users, AlertTriangle, X, Globe,
  ExternalLink, CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import { PageContainer }        from '@/components/layout/PageContainer'
import { Button }               from '@/components/ui/button'
import { Input }                from '@/components/ui/input'
import { Badge }                from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
}                               from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
}                               from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
}                               from '@/components/ui/dropdown-menu'
import { OrgGovernancePanel }   from '@/components/org/OrgGovernancePanel'
import { MergeDeleteDialog }    from '@/components/ui/merge-delete-dialog'
import { api }                  from '@/lib/api/client'
import { useAuthStore }         from '@/stores/authStore'
import { cn }                   from '@/lib/utils'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkLocation {
  id:        string
  name:      string
  code:      string | null
  site_id:   string | null
  address:   string | null
  city:      string | null
  state:     string | null
  country:   string
  pincode:   string | null
  is_active: boolean
  version:   number
  created_at: string
}

interface Site {
  id:       string
  name:     string
  code:     string | null
  location: string | null
}

interface EmpItem {
  id: string
  work_location?: { id: string } | null
}

const EMPTY_FORM = {
  name: '', code: '', site_id: '', address: '',
  city: '', state: '', country: 'India', pincode: '', is_active: true,
}

// ── A — Stat Card ─────────────────────────────────────────────────────────────

interface StatCardProps {
  label:   string
  value:   number | string
  icon:    React.ReactNode
  tone:    'neutral' | 'success' | 'warning' | 'info' | 'primary'
  onClick?: () => void
}

function StatCard({ label, value, icon, tone, onClick }: StatCardProps) {
  const toneCls = {
    neutral: 'text-muted-foreground',
    success: 'text-success',
    warning: 'text-warning',
    info:    'text-info',
    primary: 'text-primary',
  }[tone]

  const bgCls = {
    neutral: 'bg-muted/30',
    success: 'bg-success/10',
    warning: 'bg-warning/10',
    info:    'bg-info/10',
    primary: 'bg-primary/10',
  }[tone]

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border/60 px-4 py-3 text-left transition-colors',
        bgCls,
        onClick ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default',
      )}
    >
      <div className={cn('flex items-center gap-1.5', toneCls)}>
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <span className={cn('text-xl font-bold tabular-nums', toneCls)}>{value}</span>
    </button>
  )
}

// ── F — Location Row ──────────────────────────────────────────────────────────

function LocationRow({
  loc,
  isLast,
  empCount,
  isAdmin,
  onEdit,
  onDelete,
}: {
  loc:      WorkLocation
  isLast:   boolean
  empCount: number
  isAdmin:  boolean
  onEdit:   (loc: WorkLocation) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 pl-6 pr-3 py-2 text-sm',
        'hover:bg-muted/25 transition-colors',
        !isLast && 'border-b border-border/30',
      )}
    >
      {/* Tree connector */}
      <span className="font-mono text-[10px] text-border/50 select-none w-4 shrink-0">
        {isLast ? '└─' : '├─'}
      </span>

      {/* Code badge */}
      {loc.code ? (
        <span className="font-mono text-[10px] text-muted-foreground bg-muted/70 border border-border/50 rounded px-1.5 py-0.5 shrink-0 min-w-[4.5rem] text-center">
          {loc.code}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/40 shrink-0 w-[4.5rem] text-center">—</span>
      )}

      {/* Name */}
      <span className="flex-1 font-medium text-foreground truncate min-w-0">{loc.name}</span>

      {/* City, State */}
      <span className="hidden sm:block text-xs text-muted-foreground w-36 truncate shrink-0">
        {[loc.city, loc.state].filter(Boolean).join(', ') || (
          <span className="text-muted-foreground/40">—</span>
        )}
      </span>

      {/* Country */}
      <span className="hidden lg:block text-xs text-muted-foreground w-14 shrink-0 truncate">{loc.country}</span>

      {/* Employee count */}
      <span className={cn(
        'hidden md:flex items-center gap-1 text-xs w-12 shrink-0',
        empCount > 0 ? 'text-muted-foreground' : 'text-muted-foreground/30',
      )}>
        <Users className="h-3 w-3" />
        {empCount}
      </span>

      {/* Status */}
      <Badge
        variant={loc.is_active ? 'success' : 'outline'}
        className="rounded-full text-[10px] h-5 px-2 shrink-0"
      >
        {loc.is_active ? 'Active' : 'Inactive'}
      </Badge>

      {/* Actions */}
      {isAdmin ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              onClick={e => e.stopPropagation()}
            >
              <span className="sr-only">Actions</span>
              <span className="text-muted-foreground text-base leading-none">⋮</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onClick={() => onEdit(loc)}>
              <Pencil className="h-3 w-3 mr-2" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(loc.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3 w-3 mr-2" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="w-6 shrink-0" />
      )}
    </div>
  )
}

// ── D/E — Site Group ──────────────────────────────────────────────────────────

function SiteGroup({
  siteId,
  siteName,
  siteCode,
  siteLocation,
  locations,
  empCountByLocation,
  isAdmin,
  onEdit,
  onDelete,
  onGoToSite,
  onAddLocation,
  initiallyExpanded,
}: {
  siteId:             string | null
  siteName:           string
  siteCode:           string | null
  siteLocation:       string | null
  locations:          WorkLocation[]
  empCountByLocation: Map<string, number>
  isAdmin:            boolean
  onEdit:             (loc: WorkLocation) => void
  onDelete:           (id: string) => void
  onGoToSite:         (id: string) => void
  onAddLocation:      (siteId: string | null) => void
  initiallyExpanded:  boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const isUnassigned = siteId === null

  const activeCount   = locations.filter(l => l.is_active).length
  const inactiveCount = locations.length - activeCount
  const totalEmp      = locations.reduce((s, l) => s + (empCountByLocation.get(l.id) ?? 0), 0)

  return (
    <div className={cn(
      'rounded-lg border overflow-hidden',
      isUnassigned
        ? 'border-warning/30 bg-warning/5'
        : 'border-border/60 bg-card',
    )}>
      {/* ── Group header ── */}
      <div
        role="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        className={cn(
          'flex items-center gap-2.5 px-4 py-3 cursor-pointer select-none',
          'transition-colors',
          isUnassigned
            ? 'bg-warning/8 hover:bg-warning/12 border-b border-warning/20'
            : 'bg-muted/20 hover:bg-muted/35 border-b border-border/40',
          !expanded && 'border-b-0',
        )}
      >
        {/* Expand toggle */}
        <span className="text-muted-foreground/60 shrink-0">
          {expanded
            ? <ChevronDown  className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />
          }
        </span>

        {/* Site icon */}
        {isUnassigned
          ? <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
          : <Building2     className="h-3.5 w-3.5 text-primary/60 shrink-0" />
        }

        {/* Site name */}
        <span className={cn(
          'text-sm font-semibold',
          isUnassigned ? 'text-warning' : 'text-foreground',
        )}>
          {siteName}
        </span>

        {/* Site code */}
        {siteCode && (
          <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 border border-border/50 rounded px-1.5 py-0.5 shrink-0">
            {siteCode}
          </span>
        )}

        {/* Location city */}
        {siteLocation && (
          <span className="hidden sm:block text-xs text-muted-foreground/60 shrink-0">
            {siteLocation}
          </span>
        )}

        {/* Separator */}
        <div className="flex-1" />

        {/* Stats chips */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <MapPin className="h-2.5 w-2.5" />
            {locations.length} loc{locations.length !== 1 ? 's' : ''}
          </span>
          {activeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-success">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {activeCount} active
            </span>
          )}
          {inactiveCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">
              {inactiveCount} inactive
            </span>
          )}
          {totalEmp > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Users className="h-2.5 w-2.5" />
              {totalEmp}
            </span>
          )}
        </div>

        {/* Mobile: just the count */}
        <span className="md:hidden text-[10px] text-muted-foreground shrink-0">
          {locations.length}
        </span>

        {/* Actions */}
        <div
          className="flex items-center gap-1 ml-2 shrink-0"
          onClick={e => e.stopPropagation()}
        >
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => onAddLocation(siteId)}
            >
              <Plus className="h-2.5 w-2.5 mr-0.5" />Add
            </Button>
          )}
          {siteId && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-primary/70 hover:text-primary"
              onClick={() => onGoToSite(siteId)}
            >
              <ExternalLink className="h-2.5 w-2.5 mr-0.5" />Site
            </Button>
          )}
        </div>
      </div>

      {/* ── Unassigned governance guidance ── */}
      {isUnassigned && expanded && locations.length > 0 && (
        <div className="px-4 py-2.5 border-b border-warning/20 bg-warning/5 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-warning">
              {locations.length} location{locations.length !== 1 ? 's' : ''} without a parent site
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Assign locations to sites for hierarchy visibility, cascading filters, and governance reporting.
            </p>
          </div>
        </div>
      )}

      {/* ── Location rows ── */}
      {expanded && (
        <div>
          {locations.length === 0 ? (
            <div className="px-6 py-4 text-xs text-muted-foreground/60 italic">
              No locations in this site yet.
            </div>
          ) : (
            locations.map((loc, idx) => (
              <LocationRow
                key={loc.id}
                loc={loc}
                isLast={idx === locations.length - 1}
                empCount={empCountByLocation.get(loc.id) ?? 0}
                isAdmin={isAdmin}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ── G — Empty States ──────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
}: {
  icon:        React.ReactNode
  title:       string
  description: string
  action?:     React.ReactNode
  tone?:       'neutral' | 'warning'
}) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-14 px-6 text-center rounded-lg border',
      tone === 'warning'
        ? 'border-warning/30 bg-warning/5'
        : 'border-border/50 bg-muted/20',
    )}>
      <div className={cn(
        'rounded-full p-3 mb-3',
        tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground/60',
      )}>
        {icon}
      </div>
      <p className="text-sm font-semibold text-foreground mb-1">{title}</p>
      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function WorkLocations() {
  const qc                              = useQueryClient()
  const navigate                        = useNavigate()
  const [searchParams]                  = useSearchParams()
  const { profile }                     = useAuthStore()
  const isAdmin                         = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [dlgOpen,  setDlgOpen]  = useState(false)
  const [editItem, setEditItem] = useState<WorkLocation | null>(null)
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [err,      setErr]      = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  // ── Filter state ──────────────────────────────────────────────────────────
  // siteIdParam: pre-selected from URL (navigated from Sites page)
  const siteIdParam = searchParams.get('site_id')
  const [search,       setSearch]       = useState('')
  const [siteFilter,   setSiteFilter]   = useState(siteIdParam ?? 'all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: locData, isLoading: locsLoading } = useQuery<{ data: WorkLocation[] }>({
    queryKey: ['work-locations'],
    queryFn:  () => api.get('/masters/work-locations'),
    staleTime: 60_000,
  })
  const { data: sitesData, isLoading: sitesLoading } = useQuery<{ data: Site[] }>({
    queryKey: ['sites'],
    queryFn:  () => api.get('/masters/sites'),
    staleTime: 60_000,
  })
  // Employee counts — shares cache with EmployeeList; zero cost if already fetched
  const { data: empData } = useQuery<{ data: EmpItem[]; total: number }>({
    queryKey: ['employees'],
    queryFn:  () => api.get('/employees'),
    staleTime: 120_000,
  })

  const locations = useMemo(() => locData?.data   ?? [], [locData])
  const sites     = useMemo(() => sitesData?.data ?? [], [sitesData])
  const employees = useMemo(() => empData?.data   ?? [], [empData])

  const isLoading = locsLoading || sitesLoading

  // ── Derived lookups ──────────────────────────────────────────────────────
  const siteMap = useMemo(() => new Map(sites.map(s => [s.id, s])), [sites])

  const empCountByLocation = useMemo(() => {
    const counts = new Map<string, number>()
    for (const emp of employees) {
      const locId = emp.work_location?.id
      if (locId) counts.set(locId, (counts.get(locId) ?? 0) + 1)
    }
    return counts
  }, [employees])

  // ── B — Governance stats ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total      = locations.length
    const assigned   = locations.filter(l => l.site_id).length
    const unassigned = total - assigned
    const active     = locations.filter(l => l.is_active).length
    const empMapped  = employees.filter(e => e.work_location?.id).length
    return { total, sites: sites.length, assigned, unassigned, active, empMapped }
  }, [locations, sites, employees])

  // ── C — Filtered locations ───────────────────────────────────────────────
  const filteredLocs = useMemo(() => {
    let locs = locations
    if (siteFilter === '__unassigned__') {
      locs = locs.filter(l => !l.site_id)
    } else if (siteFilter !== 'all') {
      locs = locs.filter(l => l.site_id === siteFilter)
    }
    if (statusFilter === 'active')   locs = locs.filter(l => l.is_active)
    if (statusFilter === 'inactive') locs = locs.filter(l => !l.is_active)
    if (search.trim()) {
      const q = search.toLowerCase()
      locs = locs.filter(l =>
        l.name.toLowerCase().includes(q)      ||
        l.code?.toLowerCase().includes(q)     ||
        l.city?.toLowerCase().includes(q)     ||
        l.state?.toLowerCase().includes(q)    ||
        l.country.toLowerCase().includes(q),
      )
    }
    return locs
  }, [locations, siteFilter, statusFilter, search])

  const hasActiveFilter = !!search || siteFilter !== 'all' || statusFilter !== 'all'

  // ── D — Grouped by site ──────────────────────────────────────────────────
  const groups = useMemo(() => {
    const byId = new Map<string | null, WorkLocation[]>()
    for (const loc of filteredLocs) {
      const key = loc.site_id
      const arr = byId.get(key) ?? []
      arr.push(loc)
      byId.set(key, arr)
    }
    const result: Array<{ siteId: string | null; locs: WorkLocation[] }> = []
    // Assigned sites first (in site-list order)
    for (const site of sites) {
      if (byId.has(site.id)) {
        result.push({ siteId: site.id, locs: byId.get(site.id)! })
      }
    }
    // Unassigned last
    if (byId.has(null)) result.push({ siteId: null, locs: byId.get(null)! })
    return result
  }, [filteredLocs, sites])

  // ── Dialog helpers ────────────────────────────────────────────────────────
  const activeSite = siteIdParam ? siteMap.get(siteIdParam) : null

  function openCreate(presetSiteId: string | null = null) {
    setEditItem(null)
    setForm({ ...EMPTY_FORM, site_id: presetSiteId ?? siteIdParam ?? '' })
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(loc: WorkLocation) {
    setEditItem(loc)
    setForm({
      name:      loc.name,
      code:      loc.code      ?? '',
      site_id:   loc.site_id   ?? '',
      address:   loc.address   ?? '',
      city:      loc.city      ?? '',
      state:     loc.state     ?? '',
      country:   loc.country,
      pincode:   loc.pincode   ?? '',
      is_active: loc.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const versionConflict = useVersionConflict([['work-locations']])

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload = {
        name:      body.name,
        code:      body.code     || undefined,
        site_id:   body.site_id  || null,
        address:   body.address  || null,
        city:      body.city     || null,
        state:     body.state    || null,
        country:   body.country  || 'India',
        pincode:   body.pincode  || null,
        is_active: body.is_active,
      }
      return editItem
        ? api.put(`/masters/work-locations/${editItem.id}`, withExpectedVersion(payload, editItem))
        : api.post('/masters/work-locations', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-locations'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Work location updated' : 'Work location created')
    },
    onError: (e: Error) => {
      if (versionConflict(e)) return
      setErr(e?.message ?? 'Failed to save')
      toast.error('Failed to save work location')
    },
  })

  const delMut = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/masters/work-locations/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-locations'] })
      qc.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Work location deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageContainer>

      {/* ── A — Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          {/* Page icon */}
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 shrink-0">
            <MapPin className="h-5 w-5 text-primary" />
          </div>
          <div>
            {/* Breadcrumb */}
            {activeSite && (
              <nav className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                <button
                  onClick={() => navigate('/masters/sites')}
                  className="hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <Globe className="h-2.5 w-2.5" />Sites
                </button>
                <ChevronRight className="h-2.5 w-2.5" />
                <span>{activeSite.name}</span>
                <ChevronRight className="h-2.5 w-2.5" />
                <span className="text-foreground font-medium">Work Locations</span>
              </nav>
            )}
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Work Locations
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading
                ? 'Loading…'
                : `${stats.total} location${stats.total !== 1 ? 's' : ''} across ${stats.sites} site${stats.sites !== 1 ? 's' : ''}`
              }
              {stats.unassigned > 0 && !isLoading && (
                <span className="ml-2 text-warning font-medium">
                  · {stats.unassigned} unassigned
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => navigate('/masters/sites')}
            >
              <Globe className="h-3.5 w-3.5 mr-1.5" />Manage Sites
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => openCreate()}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add Location
            </Button>
          </div>
        )}
      </div>

      {/* ── B — Governance summary strip ────────────────────────────────────── */}
      {!isLoading && locations.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
          <StatCard
            label="Total"
            value={stats.total}
            icon={<MapPin />}
            tone="neutral"
          />
          <StatCard
            label="Sites"
            value={stats.sites}
            icon={<Globe />}
            tone="info"
            onClick={() => navigate('/masters/sites')}
          />
          <StatCard
            label="Assigned"
            value={stats.assigned}
            icon={<Building2 />}
            tone="success"
          />
          <StatCard
            label="Unassigned"
            value={stats.unassigned}
            icon={<AlertTriangle />}
            tone={stats.unassigned > 0 ? 'warning' : 'neutral'}
            onClick={stats.unassigned > 0 ? () => {
              setSiteFilter('all')
              setStatusFilter('all')
              setSearch('')
            } : undefined}
          />
          <StatCard
            label="Active"
            value={stats.active}
            icon={<CheckCircle2 />}
            tone="success"
          />
          <StatCard
            label="Employees"
            value={stats.empMapped}
            icon={<Users />}
            tone="primary"
          />
        </div>
      )}

      {/* ── Two-column layout: table + sidebar ─────────────────────────────── */}
      <div className="flex gap-5 items-start">

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-3">

          {/* ── C — Filter bar ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search locations…"
                className="h-8 pl-8 text-xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Site filter */}
            <Select value={siteFilter} onValueChange={v => setSiteFilter(v)}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="All Sites" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sites</SelectItem>
                {sites.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.code && <span className="text-muted-foreground ml-1 font-mono text-[10px]">[{s.code}]</span>}
                  </SelectItem>
                ))}
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
              </SelectContent>
            </Select>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear filters */}
            {hasActiveFilter && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => { setSearch(''); setSiteFilter('all'); setStatusFilter('all') }}
              >
                <X className="h-3 w-3 mr-1" />Clear
              </Button>
            )}

            {/* Result count when filtered */}
            {hasActiveFilter && (
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredLocs.length} result{filteredLocs.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Active site filter chip */}
          {siteFilter !== 'all' && siteFilter !== '__unassigned__' && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">Showing:</span>
              <Badge
                variant="secondary"
                className="rounded-full text-xs flex items-center gap-1.5 pl-2 pr-1.5"
              >
                <Building2 className="h-2.5 w-2.5" />
                {siteMap.get(siteFilter)?.name ?? siteFilter}
                <button
                  onClick={() => setSiteFilter('all')}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear site filter"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
              <button
                onClick={() => navigate('/masters/work-locations')}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
              >
                <ArrowRight className="h-2.5 w-2.5" />View all
              </button>
            </div>
          )}

          {/* ── D — Hierarchy table ─────────────────────────────────────────── */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : locations.length === 0 && sites.length === 0 ? (
            /* G — No data at all: first-time setup */
            <EmptyState
              icon={<MapPin className="h-6 w-6" />}
              title="No work locations yet"
              description="Start by creating Sites (campuses or branches), then add work locations within each site to build your org structure."
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate('/masters/sites')}
                  >
                    <Globe className="h-3.5 w-3.5 mr-1.5" />Configure Sites First
                  </Button>
                  {isAdmin && (
                    <Button size="sm" onClick={() => openCreate()}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" />Add Location
                    </Button>
                  )}
                </div>
              }
            />
          ) : locations.length === 0 && sites.length > 0 ? (
            /* G — Sites exist but no locations */
            <EmptyState
              icon={<MapPin className="h-6 w-6" />}
              title="No work locations configured"
              description="Sites are configured. Add work locations and assign them to sites for full hierarchy visibility."
              action={isAdmin ? (
                <Button size="sm" onClick={() => openCreate()}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />Add First Location
                </Button>
              ) : undefined}
            />
          ) : filteredLocs.length === 0 ? (
            /* G — No search/filter results */
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No locations match"
              description="Try adjusting the search term, site, or status filter."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setSearch(''); setSiteFilter('all'); setStatusFilter('all') }}
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />Clear filters
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {/* ── E — Unassigned warning banner (when unassigned exist and no filter hides them) ── */}
              {stats.unassigned > 0 && siteFilter === 'all' && !search && statusFilter === 'all' && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-warning">
                      Governance gap — {stats.unassigned} unassigned location{stats.unassigned !== 1 ? 's' : ''}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Unassigned locations reduce hierarchy visibility, break cascading filters on the employee list, and make reporting less accurate.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] text-warning hover:text-warning/80 shrink-0"
                    onClick={() => navigate('/masters/sites')}
                  >
                    Configure Sites <ArrowRight className="h-2.5 w-2.5 ml-1" />
                  </Button>
                </div>
              )}

              {/* Site groups */}
              {groups.map(({ siteId, locs }) => {
                const site = siteId ? siteMap.get(siteId) : null
                return (
                  <SiteGroup
                    key={siteId ?? '__unassigned__'}
                    siteId={siteId}
                    siteName={site?.name ?? 'Unassigned'}
                    siteCode={site?.code ?? null}
                    siteLocation={site?.location ?? null}
                    locations={locs}
                    empCountByLocation={empCountByLocation}
                    isAdmin={isAdmin}
                    onEdit={openEdit}
                    onDelete={id => setDeleteTarget({ id, name: locations.find(l => l.id === id)?.name ?? id })}
                    onGoToSite={targetSiteId => navigate(`/masters/sites?highlight=${targetSiteId}`)}
                    onAddLocation={sid => openCreate(sid)}
                    initiallyExpanded={
                      /* expand all when filtered; else collapse if >5 sites */
                      hasActiveFilter ||
                      groups.length <= 5 ||
                      siteId === siteIdParam
                    }
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* ── H — Org overview sidebar ────────────────────────────────────── */}
        <div className="hidden xl:block w-56 shrink-0 space-y-3 sticky top-4">
          <OrgGovernancePanel />

          {/* Quick nav */}
          <div className="rounded-lg border border-border/60 bg-card p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
              Quick Navigation
            </p>
            {[
              { label: 'Sites',       icon: Globe,      path: '/masters/sites' },
              { label: 'Cost Centers',icon: Building2,  path: '/masters/cost-centers' },
              { label: 'Employees',   icon: Users,      path: '/employees' },
              { label: 'Import',      icon: ArrowRight, path: '/import' },
            ].map(({ label, icon: Icon, path }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="flex items-center gap-2 w-full text-xs text-foreground/70 hover:text-foreground transition-colors rounded px-1.5 py-1 hover:bg-muted/40 group"
              >
                <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                <span className="flex-1 text-left">{label}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {deleteTarget && (
        <MergeDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          entityType="Work Location"
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={`/masters/work-locations/${deleteTarget.id}/usage`}
          usageLabel="employee records"
          mergeOptions={locations.filter(l => l.id !== deleteTarget.id).map(l => ({ id: l.id, name: l.name }))}
          onConfirm={(mergeTo) => delMut.mutate({ id: deleteTarget.id, mergeTo })}
          isPending={delMut.isPending}
        />
      )}

      {/* ── Create / Edit dialog ─────────────────────────────────────────────── */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              {editItem ? 'Edit Work Location' : 'New Work Location'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Bengaluru Office"
                className="h-8 text-sm"
              />
            </div>

            {/* Parent site */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Parent Site
                <span className="text-muted-foreground/50 font-normal ml-1">— sets hierarchy context</span>
              </label>
              <select
                value={form.site_id}
                onChange={e => setForm(p => ({ ...p, site_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">— No site (standalone) —</option>
                {sites.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.code ? ` [${s.code}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Address</label>
              <Input
                value={form.address}
                onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                placeholder="123 Main Street"
                className="h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">City</label>
                <Input
                  value={form.city}
                  onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                  placeholder="Bengaluru"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">State</label>
                <Input
                  value={form.state}
                  onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
                  placeholder="Karnataka"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Country</label>
                <Input
                  value={form.country}
                  onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                  placeholder="India"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Pincode</label>
                <Input
                  value={form.pincode}
                  onChange={e => setForm(p => ({ ...p, pincode: e.target.value }))}
                  placeholder="560001"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="wl-active"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="wl-active" className="text-xs text-muted-foreground select-none">
                Active
              </label>
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !form.name.trim()}
              onClick={() => saveMut.mutate(form)}
            >
              {saveMut.isPending ? 'Saving…' : editItem ? 'Save Changes' : 'Create Location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </PageContainer>
  )
}
