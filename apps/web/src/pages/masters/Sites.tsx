/**
 * Sites — /masters/sites
 *
 * Hierarchy-aware workforce governance page.
 *
 * Each site carries two governance defaults that all employees inherit:
 *   · Default Roster Policy   → determines WHETHER employees work (weekly-off pattern)
 *   · Default Rotation Policy → determines WHICH shift applies per working condition
 *
 * Each site is a collapsible card that expands to reveal nested work locations:
 *
 *   ▶  Head Office · Mumbai                   [3 locations]
 *      ├─ LOC-MUM   Mumbai Tower — Active
 *      ├─ LOC-MUM2  BKC Annex    — Active
 *      └─ LOC-WHZ   Warehouse    — Inactive
 */
import { useState, useMemo }                           from 'react'
import { toast }                                      from 'sonner'
import { useQuery, useMutation, useQueryClient }      from '@tanstack/react-query'
import { useNavigate }                                from 'react-router-dom'
import {
  Plus, Pencil, Trash2, Globe, MapPin,
  ChevronRight, ChevronDown, ExternalLink, Loader2,
  CalendarDays, CalendarClock, ShieldCheck,
  Layers, AlertTriangle, Users,
} from 'lucide-react'
import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { Button }           from '@/components/ui/button'
import { Input }            from '@/components/ui/input'
import { Badge }            from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
}                           from '@/components/ui/dialog'
import { MergeDeleteDialog } from '@/components/ui/merge-delete-dialog'
import { OrgGovernancePanel } from '@/components/org/OrgGovernancePanel'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'
import { useOpenOnParam }   from '@/lib/runbooks/useOpenOnParam'

// ── Types ─────────────────────────────────────────────────────────────────────


interface Site {
  id:                           string
  name:                         string
  code:                         string | null
  location:                     string | null
  timezone:                     string
  state_code:                   string | null
  state_id:                     string | null
  cluster_id:                   string | null
  site_type:                    string | null
  city:                         string | null
  region:                       string | null
  zone:                         string | null
  short_name:                   string | null
  address_line1:                string | null
  address_line2:                string | null
  district:                     string | null
  pincode:                      string | null
  gstin:                        string | null
  pf_registration_no:           string | null
  esi_registration_no:          string | null
  pt_registration_no:           string | null
  lwf_registration_no:          string | null
  contact_person:               string | null
  contact_phone:                string | null
  contact_email:                string | null
  sanctioned_headcount:         number | null
  default_roster_id:            string | null
  default_rotation_policy_id:   string | null
  default_leave_policy_id:      string | null
  holiday_group_id:             string | null
  created_at:                   string
}

interface StateMaster   { id: string; code: string; name: string }
interface ClusterMaster { id: string; name: string }

interface WorkLocation {
  id:        string
  name:      string
  code:      string | null
  site_id:   string | null
  city:      string | null
  state:     string | null
  is_active: boolean
}

interface Roster          { id: string; name: string }
interface RotationPolicy  { id: string; name: string }
interface LeavePolicy     { id: string; name: string }
interface HolidayGroup    { id: string; name: string; state_code: string | null; is_active: boolean }

const EMPTY_FORM = {
  name:                       '',
  location:                   '',
  timezone:                   'Asia/Kolkata',
  state_id:                   '',
  state_code:                 '',
  cluster_id:                 '',
  site_type:                  '',
  city:                       '',
  region:                     '',
  zone:                       '',
  short_name:                 '',
  address_line1:              '',
  address_line2:              '',
  district:                   '',
  pincode:                    '',
  gstin:                      '',
  pf_registration_no:         '',
  esi_registration_no:        '',
  pt_registration_no:         '',
  lwf_registration_no:        '',
  contact_person:             '',
  contact_phone:              '',
  contact_email:              '',
  sanctioned_headcount:       '',
  default_roster_id:          '',
  default_rotation_policy_id: '',
  default_leave_policy_id:    '',
  holiday_group_id:           '',
}

// ── Nested work location row ───────────────────────────────────────────────────

function WorkLocationRow({
  loc,
  isLast,
  onNavigate,
}: {
  loc: WorkLocation
  isLast: boolean
  onNavigate: () => void
}) {
  return (
    <div className={cn('flex items-center gap-2 py-1.5 pl-4 text-xs group', !isLast && 'border-b border-border/30')}>
      {/* Tree connector */}
      <div className="flex flex-col items-center self-stretch mr-1" aria-hidden>
        <div className="w-px flex-1 bg-border/50" />
        {isLast && <div className="w-px flex-1" />}
      </div>
      <div className="text-border/60 mr-0.5 text-[10px] select-none">{isLast ? '└─' : '├─'}</div>

      <span className="font-mono text-muted-foreground/70 w-24 shrink-0">{loc.code ?? '—'}</span>
      <span className="flex-1 font-medium text-foreground/80 truncate">{loc.name}</span>
      <span className="text-muted-foreground/60 w-32 truncate shrink-0">
        {[loc.city, loc.state].filter(Boolean).join(', ') || '—'}
      </span>
      <Badge
        variant={loc.is_active ? 'success' : 'outline'}
        className="rounded-full text-[10px] h-4 px-1.5 shrink-0"
      >
        {loc.is_active ? 'Active' : 'Inactive'}
      </Badge>
      <button
        onClick={onNavigate}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:underline shrink-0 flex items-center gap-0.5"
        title="Go to work locations"
      >
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  )
}

// ── Site card (expandable) ─────────────────────────────────────────────────────

function SiteCard({
  site,
  locations,
  rosters,
  rotationPolicies,
  isAdmin,
  onEdit,
  onDelete,
  onNavigate,
}: {
  site:             Site
  locations:        WorkLocation[]
  rosters:          Roster[]
  rotationPolicies: RotationPolicy[]
  isAdmin:          boolean
  onEdit:           (s: Site) => void
  onDelete:         (id: string) => void
  onNavigate:       (siteId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rosterName = (id: string | null) =>
    id ? (rosters.find(r => r.id === id)?.name ?? '—') : '—'

  const rotationName = (id: string | null) =>
    id ? (rotationPolicies.find(p => p.id === id)?.name ?? '—') : '—'

  const hasGovernance = site.default_roster_id || site.default_rotation_policy_id

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-card hover:border-border transition-colors">
      {/* Site header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
        role="button"
        aria-expanded={expanded}
      >
        {/* Expand toggle */}
        <button
          className="text-muted-foreground/60 hover:text-muted-foreground transition-colors shrink-0"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />
          }
        </button>

        <Globe className="h-4 w-4 text-primary/70 shrink-0" />

        {/* Name + code */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{site.name}</span>
            {site.code && (
              <Badge variant="outline" className="rounded-full text-[10px] font-mono shrink-0">{site.code}</Badge>
            )}
          </div>
          {site.location && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{site.location}</p>
          )}
        </div>

        {/* Timezone */}
        <Badge variant="outline" className="rounded-full text-xs font-mono shrink-0 hidden sm:flex">
          {site.timezone}
        </Badge>

        {/* Governance summary — compact */}
        <div className="hidden lg:flex flex-col gap-0.5 text-[10px] text-muted-foreground shrink-0 w-44">
          <span className="flex items-center gap-1 truncate">
            <CalendarDays className="h-2.5 w-2.5 shrink-0" />
            {rosterName(site.default_roster_id)}
          </span>
          <span className="flex items-center gap-1 truncate">
            <CalendarClock className="h-2.5 w-2.5 shrink-0" />
            {rotationName(site.default_rotation_policy_id)}
          </span>
        </div>

        {/* Governance badge */}
        <div className="shrink-0">
          {hasGovernance ? (
            <span title="Governance policies configured"><ShieldCheck className="h-4 w-4 text-success" /></span>
          ) : (
            <span title="No governance policies set"><ShieldCheck className="h-4 w-4 text-muted-foreground/30" /></span>
          )}
        </div>

        {/* Work-location count chip */}
        <button
          onClick={e => {
            e.stopPropagation()
            onNavigate(site.id)
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors shrink-0',
            locations.length > 0
              ? 'bg-primary/10 text-primary hover:bg-primary/20'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
          title="View work locations for this site"
        >
          <MapPin className="h-3 w-3" />
          {locations.length === 0
            ? 'No locations'
            : `${locations.length} location${locations.length !== 1 ? 's' : ''}`
          }
        </button>

        {/* Admin actions */}
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(site)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon" variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(site.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Expanded: nested work locations */}
      {expanded && (
        <div className="border-t border-border/40 bg-muted/10">
          {locations.length === 0 ? (
            <div className="px-6 py-3 text-xs text-muted-foreground italic flex items-center gap-2">
              <MapPin className="h-3 w-3" />
              No work locations assigned to this site.
              <button className="text-primary hover:underline" onClick={() => onNavigate(site.id)}>
                Add one →
              </button>
            </div>
          ) : (
            <div className="px-2 py-1">
              <div className="flex items-center gap-2 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 border-b border-border/20">
                <div className="w-5 mr-1" />
                <div className="w-6 mr-0.5" />
                <span className="w-24 shrink-0">Code</span>
                <span className="flex-1">Name</span>
                <span className="w-32 shrink-0">City / State</span>
                <span className="w-14 shrink-0">Status</span>
                <span className="w-4 shrink-0" />
              </div>
              {locations.map((loc, idx) => (
                <WorkLocationRow
                  key={loc.id}
                  loc={loc}
                  isLast={idx === locations.length - 1}
                  onNavigate={() => onNavigate(site.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Governance stat card (mirrors the Work Locations console) ──────────────────

interface EmpItem { id: string; work_location?: { id: string } | null }

interface StatCardProps {
  label:    string
  value:    number | string
  icon:     React.ReactNode
  tone:     'neutral' | 'success' | 'warning' | 'info' | 'primary'
  onClick?: () => void
}

function StatCard({ label, value, icon, tone, onClick }: StatCardProps) {
  const toneCls = {
    neutral: 'text-muted-foreground', success: 'text-success', warning: 'text-warning',
    info: 'text-info', primary: 'text-primary',
  }[tone]
  const bgCls = {
    neutral: 'bg-muted/30', success: 'bg-success/10', warning: 'bg-warning/10',
    info: 'bg-info/10', primary: 'bg-primary/10',
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

// ── Main page ─────────────────────────────────────────────────────────────────

export function Sites() {
  const qc                            = useQueryClient()
  const navigate                      = useNavigate()
  const { profile }                   = useAuthStore()
  const isAdmin                       = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,  setDlgOpen]        = useState(false)
  const [editSite, setEditSite]       = useState<Site | null>(null)
  const [form,     setForm]           = useState(EMPTY_FORM)
  const [err,      setErr]            = useState('')
  const [search,   setSearch]         = useState('')
  const [clusterFilter, setClusterFilter] = useState<string>('all')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: sitesData, isLoading, isError, error } = useQuery<{ data: Site[] }>({
    queryKey: ['sites'],
    queryFn:  () => api.get('/masters/sites'),
    staleTime: 60_000,
  })
  const { data: rostersData } = useQuery<{ data: Roster[] }>({
    queryKey: ['rosters-list'],
    queryFn:  () => api.get('/masters/rosters'),
    staleTime: 60_000,
  })
  const { data: rotationData } = useQuery<{ data: RotationPolicy[] }>({
    queryKey: ['rotation-policies'],
    queryFn:  () => api.get('/masters/rotation-policies'),
    staleTime: 60_000,
  })
  const { data: leavePolicyData } = useQuery<{ data: LeavePolicy[] }>({
    queryKey: ['leave-policy-masters'],
    queryFn:  () => api.get('/masters/leave-policy-masters'),
    staleTime: 60_000,
  })
  const { data: workLocData } = useQuery<{ data: WorkLocation[] }>({
    queryKey: ['work-locations'],
    queryFn:  () => api.get('/masters/work-locations'),
    staleTime: 60_000,
  })
  const { data: holidayGroupData } = useQuery<{ data: HolidayGroup[] }>({
    queryKey: ['holiday-groups'],
    queryFn:  () => api.get('/masters/holiday-groups'),
    staleTime: 120_000,
  })
  // State & Cluster masters drive the site's statutory and operational grouping.
  const { data: statesData } = useQuery<{ data: StateMaster[] }>({
    queryKey: ['states'],
    queryFn:  () => api.get('/masters/states'),
    staleTime: 5 * 60_000,
  })
  const { data: clustersData } = useQuery<{ data: ClusterMaster[] }>({
    queryKey: ['clusters'],
    queryFn:  () => api.get('/masters/clusters'),
    staleTime: 5 * 60_000,
  })
  // Employee counts — shares cache with the employee list; zero cost if already fetched.
  const { data: empData } = useQuery<{ data: EmpItem[]; total: number }>({
    queryKey: ['employees'],
    queryFn:  () => api.get('/employees'),
    staleTime: 120_000,
  })
  const statesList   = statesData?.data   ?? []
  // useMemo so the reference is stable across renders — it feeds a useMemo dep
  // below (clustered sites), which would otherwise recompute every render.
  const clustersList = useMemo(() => clustersData?.data ?? [], [clustersData])

  const sites            = useMemo(() => sitesData?.data   ?? [], [sitesData])
  const rosters          = rostersData?.data       ?? []
  const rotationPolicies = rotationData?.data      ?? []
  const leavePolicies    = leavePolicyData?.data   ?? []
  const workLocs         = useMemo(() => workLocData?.data ?? [], [workLocData])
  const holidayGroups    = (holidayGroupData?.data ?? []).filter(g => g.is_active)

  /** site_id → [locations] */
  const locsBySite = useMemo(() => {
    const map = new Map<string, WorkLocation[]>()
    for (const loc of workLocs) {
      if (!loc.site_id) continue
      const arr = map.get(loc.site_id) ?? []
      arr.push(loc)
      map.set(loc.site_id, arr)
    }
    return map
  }, [workLocs])

  const employees = useMemo<EmpItem[]>(() => empData?.data ?? [], [empData])

  /** work_location.id → site_id (mapped locations only) */
  const locToSite = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of workLocs) if (l.site_id) m.set(l.id, l.site_id)
    return m
  }, [workLocs])

  /** site_id → employee count (rolled up through work locations) */
  const empCountBySite = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of employees) {
      const sid = e.work_location?.id ? locToSite.get(e.work_location.id) : undefined
      if (sid) m.set(sid, (m.get(sid) ?? 0) + 1)
    }
    return m
  }, [employees, locToSite])

  const clusterName = (id: string | null) =>
    id ? (clustersList.find(c => c.id === id)?.name ?? 'Unknown cluster') : 'Unmapped'

  // ── Governance stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:      sites.length,
    clusters:   new Set(sites.filter(s => s.cluster_id).map(s => s.cluster_id)).size,
    workLocs:   workLocs.filter(l => l.site_id).length,
    employees:  [...empCountBySite.values()].reduce((a, b) => a + b, 0),
    governance: sites.filter(s => s.default_roster_id && s.default_rotation_policy_id).length,
    unmapped:   sites.filter(s => !s.cluster_id).length,
  }), [sites, workLocs, empCountBySite])

  const filteredSites = useMemo(() => {
    let list = sites
    if (clusterFilter === '__unmapped__') list = list.filter(s => !s.cluster_id)
    else if (clusterFilter !== 'all')     list = list.filter(s => s.cluster_id === clusterFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.code?.toLowerCase().includes(q) ||
        s.location?.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q),
      )
    }
    return list
  }, [sites, search, clusterFilter])

  // ── Group sites by cluster (unmapped last) ────────────────────────────────
  const groups = useMemo(() => {
    const byCluster = new Map<string | null, Site[]>()
    for (const s of filteredSites) {
      const key = s.cluster_id ?? null
      const arr = byCluster.get(key) ?? []
      arr.push(s)
      byCluster.set(key, arr)
    }
    const result: Array<{ clusterId: string | null; sites: Site[] }> = []
    for (const c of clustersList) if (byCluster.has(c.id)) result.push({ clusterId: c.id, sites: byCluster.get(c.id)! })
    for (const [key, arr] of byCluster) if (key && !clustersList.some(c => c.id === key)) result.push({ clusterId: key, sites: arr })
    if (byCluster.has(null)) result.push({ clusterId: null, sites: byCluster.get(null)! })
    return result
  }, [filteredSites, clustersList])

  const hasActiveFilter = !!search || clusterFilter !== 'all'

  function openCreate() {
    setEditSite(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }

  // Auto-open the create dialog when arriving from a runbook deep-link (?new=1)
  useOpenOnParam('new', openCreate)

  function openEdit(s: Site) {
    setEditSite(s)
    setForm({
      name:                       s.name,
      location:                   s.location ?? '',
      timezone:                   s.timezone,
      state_id:                   s.state_id ?? '',
      state_code:                 s.state_code ?? '',
      cluster_id:                 s.cluster_id ?? '',
      site_type:                  s.site_type ?? '',
      city:                       s.city ?? '',
      region:                     s.region ?? '',
      zone:                       s.zone ?? '',
      short_name:                 s.short_name ?? '',
      address_line1:              s.address_line1 ?? '',
      address_line2:              s.address_line2 ?? '',
      district:                   s.district ?? '',
      pincode:                    s.pincode ?? '',
      gstin:                      s.gstin ?? '',
      pf_registration_no:         s.pf_registration_no ?? '',
      esi_registration_no:        s.esi_registration_no ?? '',
      pt_registration_no:         s.pt_registration_no ?? '',
      lwf_registration_no:        s.lwf_registration_no ?? '',
      contact_person:             s.contact_person ?? '',
      contact_phone:              s.contact_phone ?? '',
      contact_email:              s.contact_email ?? '',
      sanctioned_headcount:       s.sanctioned_headcount != null ? String(s.sanctioned_headcount) : '',
      default_roster_id:          s.default_roster_id ?? '',
      default_rotation_policy_id: s.default_rotation_policy_id ?? '',
      default_leave_policy_id:    s.default_leave_policy_id ?? '',
      holiday_group_id:           s.holiday_group_id ?? '',
    })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload = {
        name:                       body.name,
        location:                   body.location                   || null,
        timezone:                   body.timezone                   || 'Asia/Kolkata',
        state_id:                   body.state_id                   || null,
        state_code:                 body.state_code                 || null,
        cluster_id:                 body.cluster_id                 || null,
        site_type:                  body.site_type                  || null,
        city:                       body.city                       || null,
        region:                     body.region                     || null,
        zone:                       body.zone                       || null,
        short_name:                 body.short_name                 || null,
        address_line1:              body.address_line1              || null,
        address_line2:              body.address_line2              || null,
        district:                   body.district                   || null,
        pincode:                    body.pincode                    || null,
        gstin:                      body.gstin                      || null,
        pf_registration_no:         body.pf_registration_no         || null,
        esi_registration_no:        body.esi_registration_no        || null,
        pt_registration_no:         body.pt_registration_no         || null,
        lwf_registration_no:        body.lwf_registration_no        || null,
        contact_person:             body.contact_person             || null,
        contact_phone:              body.contact_phone              || null,
        contact_email:              body.contact_email              || null,
        sanctioned_headcount:       body.sanctioned_headcount.trim() ? Number(body.sanctioned_headcount) : null,
        default_roster_id:          body.default_roster_id          || null,
        default_rotation_policy_id: body.default_rotation_policy_id || null,
        default_leave_policy_id:    body.default_leave_policy_id    || null,
        holiday_group_id:           body.holiday_group_id           || null,
      }
      return editSite
        ? api.put(`/masters/sites/${editSite.id}`, payload)
        : api.post('/masters/sites', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      setDlgOpen(false)
      toast.success('Site saved')
    },
    onError: (e: Error) => {
      setErr(e.message ?? 'Failed to save')
      toast.error('Failed to save site', { description: e.message })
    },
  })

  const delMut = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/masters/sites/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      qc.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Site deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  function navigateToLocations(siteId?: string) {
    const path = siteId
      ? `/masters/work-locations?site_id=${siteId}`
      : '/masters/work-locations'
    navigate(path)
  }

  return (
    <PageContainer>
      {/* ── A — Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        className="mb-4"
        title="Sites"
        subtitle={
          isLoading
            ? 'Loading…'
            : `${stats.total} site${stats.total !== 1 ? 's' : ''} across ${stats.clusters} cluster${stats.clusters !== 1 ? 's' : ''}${stats.unmapped > 0 ? ` · ${stats.unmapped} unmapped` : ''}`
        }
        actions={isAdmin ? (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate('/masters/work-locations')}>
              <MapPin className="h-3.5 w-3.5 mr-1.5" />Manage Locations
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add Site
            </Button>
          </>
        ) : undefined}
      />

      {/* ── B — Governance summary strip ───────────────────────────────────── */}
      {!isLoading && sites.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
          <StatCard label="Total" value={stats.total} icon={<Globe />} tone="neutral" />
          <StatCard label="Clusters" value={stats.clusters} icon={<Layers />} tone="info" onClick={() => navigate('/masters/clusters')} />
          <StatCard label="Work Locations" value={stats.workLocs} icon={<MapPin />} tone="success" onClick={() => navigate('/masters/work-locations')} />
          <StatCard label="Governance" value={stats.governance} icon={<ShieldCheck />} tone={stats.total > 0 && stats.governance === stats.total ? 'success' : 'neutral'} />
          <StatCard label="Employees" value={stats.employees} icon={<Users />} tone="primary" />
          <StatCard label="Unmapped" value={stats.unmapped} icon={<AlertTriangle />} tone={stats.unmapped > 0 ? 'warning' : 'neutral'} onClick={stats.unmapped > 0 ? () => setClusterFilter('__unmapped__') : undefined} />
        </div>
      )}

      {/* ── Two-column layout: list + governance sidebar ───────────────────── */}
      <div className="flex gap-5 items-start">
        <div className="flex-1 min-w-0 space-y-3">

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search sites…"
                className="h-8 text-sm"
              />
            </div>
            <select
              value={clusterFilter}
              onChange={e => setClusterFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
            >
              <option value="all">All clusters</option>
              {clustersList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              {stats.unmapped > 0 && <option value="__unmapped__">Unmapped</option>}
            </select>
            {hasActiveFilter && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => { setSearch(''); setClusterFilter('all') }}>
                Clear
              </Button>
            )}
          </div>

          {/* Governance gap banner */}
          {!isLoading && stats.unmapped > 0 && clusterFilter === 'all' && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-warning">
                    Governance gap — {stats.unmapped} unmapped site{stats.unmapped !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sites without a cluster weaken regional roll-ups, break cascading filters on reports, and reduce reporting accuracy.
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate('/masters/clusters')}
                className="text-xs font-medium text-primary hover:underline flex items-center gap-1 shrink-0"
              >
                Configure Clusters <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Site cards */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Globe className="h-10 w-10 text-destructive/40" />
          <p className="text-sm font-medium text-destructive">Couldn’t load sites</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            {error instanceof Error ? error.message : 'The sites list failed to load. Please retry.'}
          </p>
        </div>
      ) : filteredSites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Globe className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {search ? 'No sites match the search.' : 'No sites configured yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => {
            const locCount = group.sites.reduce((n, s) => n + (locsBySite.get(s.id)?.length ?? 0), 0)
            const empCount = group.sites.reduce((n, s) => n + (empCountBySite.get(s.id) ?? 0), 0)
            return (
              <div key={group.clusterId ?? '__unmapped__'} className="space-y-2">
                {/* Cluster group header */}
                <div className="flex items-center gap-2 px-1">
                  {group.clusterId
                    ? <Layers className="h-3.5 w-3.5 text-info" />
                    : <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
                  <span className={cn('text-xs font-semibold uppercase tracking-wide', group.clusterId ? 'text-foreground' : 'text-warning')}>
                    {clusterName(group.clusterId)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {group.sites.length} site{group.sites.length !== 1 ? 's' : ''} · {locCount} location{locCount !== 1 ? 's' : ''} · {empCount} employee{empCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.sites.map(site => (
                    <SiteCard
                      key={site.id}
                      site={site}
                      locations={locsBySite.get(site.id) ?? []}
                      rosters={rosters}
                      rotationPolicies={rotationPolicies}
                      isAdmin={isAdmin}
                      onEdit={openEdit}
                      onDelete={id => setDeleteTarget({ id, name: sites.find(s => s.id === id)?.name ?? id })}
                      onNavigate={navigateToLocations}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
        </div>

        {/* Governance sidebar (mirrors the Work Locations console) */}
        <aside className="hidden xl:block w-72 shrink-0 sticky top-4">
          <OrgGovernancePanel />
        </aside>
      </div>

      {deleteTarget && (
        <MergeDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          entityType="Site"
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={`/masters/sites/${deleteTarget.id}/usage`}
          usageLabel="work locations"
          mergeOptions={sites.filter(s => s.id !== deleteTarget.id).map(s => ({ id: s.id, name: s.name }))}
          onConfirm={(mergeTo) => delMut.mutate({ id: deleteTarget.id, mergeTo })}
          isPending={delMut.isPending}
        />
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editSite ? 'Edit Site' : 'New Site'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Basics */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Basics</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Name *</label>
                  <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Head Office" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Short Name</label>
                  <Input value={form.short_name} onChange={e => setForm(p => ({ ...p, short_name: e.target.value }))} placeholder="HO" className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Timezone (IANA)</label>
                  <Input value={form.timezone} onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))} placeholder="Asia/Kolkata" className="h-8 text-sm font-mono" />
                </div>
                <div className="space-y-1 sm:col-span-4">
                  <label className="text-xs font-medium text-muted-foreground">Location</label>
                  <Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Mumbai, Maharashtra" className="h-8 text-sm" />
                </div>
              </div>
            </div>

            {/* Two-column grid of detail sections */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Classification */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Classification</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">State</label>
                    <select
                      value={form.state_id}
                      onChange={e => {
                        const id = e.target.value
                        const st = statesList.find(s => s.id === id)
                        setForm(p => ({ ...p, state_id: id, state_code: st?.code ?? '' }))
                      }}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— Not set —</option>
                      {statesList.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                    {statesList.length === 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Add states in <a href="/admin/masters/states" className="text-primary underline">States</a>.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Cluster</label>
                    <select
                      value={form.cluster_id}
                      onChange={e => setForm(p => ({ ...p, cluster_id: e.target.value }))}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— Not set —</option>
                      {clustersList.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Site Type</label>
                    <select
                      value={form.site_type}
                      onChange={e => setForm(p => ({ ...p, site_type: e.target.value }))}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— Not set —</option>
                      {['store', 'warehouse', 'office', 'plant', 'distribution_center', 'kiosk'].map(t => (
                        <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">City</label>
                    <Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="Mumbai" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Region</label>
                    <Input value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} placeholder="West" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Zone</label>
                    <Input value={form.zone} onChange={e => setForm(p => ({ ...p, zone: e.target.value }))} placeholder="Mumbai Metro" className="h-8 text-sm" />
                  </div>
                </div>
              </div>

              {/* Address */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Address</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Address Line 1</label>
                    <Input value={form.address_line1} onChange={e => setForm(p => ({ ...p, address_line1: e.target.value }))} placeholder="Plot 12, Tech Park" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Address Line 2</label>
                    <Input value={form.address_line2} onChange={e => setForm(p => ({ ...p, address_line2: e.target.value }))} placeholder="Whitefield" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">District</label>
                    <Input value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))} placeholder="Bengaluru Urban" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Pincode</label>
                    <Input value={form.pincode} onChange={e => setForm(p => ({ ...p, pincode: e.target.value }))} placeholder="560066" className="h-8 text-sm" />
                  </div>
                </div>
              </div>

              {/* Statutory registrations */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Statutory Registrations</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">GSTIN</label>
                    <Input value={form.gstin} onChange={e => setForm(p => ({ ...p, gstin: e.target.value }))} placeholder="29ABCDE1234F1Z5" className="h-8 text-sm font-mono" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">PF Reg. No.</label>
                    <Input value={form.pf_registration_no} onChange={e => setForm(p => ({ ...p, pf_registration_no: e.target.value }))} placeholder="KN/BNG/0012345" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">ESI Reg. No.</label>
                    <Input value={form.esi_registration_no} onChange={e => setForm(p => ({ ...p, esi_registration_no: e.target.value }))} placeholder="53000123450000999" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">PT Reg. No.</label>
                    <Input value={form.pt_registration_no} onChange={e => setForm(p => ({ ...p, pt_registration_no: e.target.value }))} placeholder="PT-..." className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">LWF Reg. No.</label>
                    <Input value={form.lwf_registration_no} onChange={e => setForm(p => ({ ...p, lwf_registration_no: e.target.value }))} placeholder="LWF-..." className="h-8 text-sm" />
                  </div>
                </div>
              </div>

              {/* Operations */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Operations</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Contact Person</label>
                    <Input value={form.contact_person} onChange={e => setForm(p => ({ ...p, contact_person: e.target.value }))} placeholder="Site Admin" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Contact Phone</label>
                    <Input value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))} placeholder="+91 98765 43210" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Contact Email</label>
                    <Input value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))} placeholder="site@company.com" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Sanctioned Headcount</label>
                    <Input type="number" min={0} value={form.sanctioned_headcount} onChange={e => setForm(p => ({ ...p, sanctioned_headcount: e.target.value }))} placeholder="150" className="h-8 text-sm" />
                  </div>
                </div>
              </div>

              {/* Workforce Governance — spans both columns */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5 sm:col-span-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  Workforce Governance Defaults
                </div>
                <p className="text-[11px] text-muted-foreground">
                  All employees at this site inherit these policies unless they have individual overrides.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      Roster Policy
                      <span className="text-muted-foreground/50">(weekly-off pattern)</span>
                    </label>
                    <select
                      value={form.default_roster_id}
                      onChange={e => setForm(p => ({ ...p, default_roster_id: e.target.value }))}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— None (employees inherit nothing) —</option>
                      {rosters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      Rotation Policy
                      <span className="text-muted-foreground/50">(shift per working condition)</span>
                    </label>
                    <select
                      value={form.default_rotation_policy_id}
                      onChange={e => setForm(p => ({ ...p, default_rotation_policy_id: e.target.value }))}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— None (fall back to Shift Override if set) —</option>
                      {rotationPolicies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      Leave Policy
                      <span className="text-muted-foreground/50">(default leave entitlements)</span>
                    </label>
                    <select
                      value={form.default_leave_policy_id}
                      onChange={e => setForm(p => ({ ...p, default_leave_policy_id: e.target.value }))}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— None (use tenant default) —</option>
                      {leavePolicies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      Holiday Group
                      <span className="text-muted-foreground/50">(regional holiday calendar)</span>
                    </label>
                    <select
                      value={form.holiday_group_id}
                      onChange={e => setForm(p => ({ ...p, holiday_group_id: e.target.value }))}
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                    >
                      <option value="">— All-India holidays only —</option>
                      {holidayGroups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}{g.state_code ? ` (${g.state_code})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={saveMut.isPending || !form.name.trim()} onClick={() => saveMut.mutate(form)}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
