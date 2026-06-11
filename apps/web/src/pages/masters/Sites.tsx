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
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

const INDIA_STATES: [string, string][] = [
  ['AP','Andhra Pradesh'],['AS','Assam'],['BR','Bihar'],['CG','Chhattisgarh'],
  ['GA','Goa'],['GJ','Gujarat'],['HR','Haryana'],['HP','Himachal Pradesh'],
  ['JH','Jharkhand'],['KA','Karnataka'],['KL','Kerala'],['MP','Madhya Pradesh'],
  ['MH','Maharashtra'],['MN','Manipur'],['ML','Meghalaya'],['MZ','Mizoram'],
  ['NL','Nagaland'],['OR','Odisha'],['PB','Punjab'],['SK','Sikkim'],
  ['TN','Tamil Nadu'],['TS','Telangana'],['TR','Tripura'],['WB','West Bengal'],
]

interface Site {
  id:                           string
  name:                         string
  code:                         string | null
  location:                     string | null
  timezone:                     string
  state_code:                   string | null
  default_roster_id:            string | null
  default_rotation_policy_id:   string | null
  default_leave_policy_id:      string | null
  holiday_group_id:             string | null
  created_at:                   string
}

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
  state_code:                 '',
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
            <span title="Governance policies configured"><ShieldCheck className="h-4 w-4 text-green-500" /></span>
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: sitesData, isLoading } = useQuery<{ data: Site[] }>({
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

  const sites            = sitesData?.data         ?? []
  const rosters          = rostersData?.data       ?? []
  const rotationPolicies = rotationData?.data      ?? []
  const leavePolicies    = leavePolicyData?.data   ?? []
  const workLocs         = workLocData?.data       ?? []
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

  const filteredSites = useMemo(() => {
    if (!search.trim()) return sites
    const q = search.toLowerCase()
    return sites.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.location?.toLowerCase().includes(q),
    )
  }, [sites, search])

  const unassignedCount = workLocs.filter(l => !l.site_id).length

  function openCreate() {
    setEditSite(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(s: Site) {
    setEditSite(s)
    setForm({
      name:                       s.name,
      location:                   s.location ?? '',
      timezone:                   s.timezone,
      state_code:                 s.state_code ?? '',
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
        state_code:                 body.state_code                 || null,
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
    onError: (e: any) => {
      setErr(e?.message ?? 'Failed to save')
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
      <PageHeader
        title="Sites"
        subtitle="Physical campuses and branches — configure workforce governance defaults per site"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Site</Button>
            : undefined
        }
      />

      {/* Summary strip */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pb-1">
        <span className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          <strong className="text-foreground">{sites.length}</strong> site{sites.length !== 1 ? 's' : ''}
        </span>
        <span className="text-border">·</span>
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          <strong className="text-foreground">{workLocs.length}</strong> work location{workLocs.length !== 1 ? 's' : ''}
        </span>
        {unassignedCount > 0 && (
          <>
            <span className="text-border">·</span>
            <button
              onClick={() => navigateToLocations()}
              className="flex items-center gap-1 text-warning hover:underline"
            >
              <span className="font-medium">{unassignedCount}</span> unassigned
            </button>
          </>
        )}
      </div>

      {/* Search */}
      {sites.length > 4 && (
        <div className="relative max-w-xs">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter sites…"
            className="h-8 text-sm pl-3"
          />
        </div>
      )}

      {/* Site cards */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      ) : filteredSites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Globe className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {search ? 'No sites match the search.' : 'No sites configured yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSites.map(site => (
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
      )}

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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSite ? 'Edit Site' : 'New Site'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Basic fields */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Head Office"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Location</label>
              <Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Mumbai, Maharashtra" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                State
                <span className="text-muted-foreground/50">(PT/LWF jurisdiction for all employees at this site)</span>
              </label>
              <select
                value={form.state_code}
                onChange={e => setForm(p => ({ ...p, state_code: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">— Not set (employees need individual state override) —</option>
                {INDIA_STATES.map(([code, name]) => (
                  <option key={code} value={code}>{name} ({code})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Timezone (IANA)</label>
              <Input value={form.timezone} onChange={e => setForm(p => ({ ...p, timezone: e.target.value }))} placeholder="Asia/Kolkata" className="h-8 text-sm font-mono" />
            </div>

            {/* Workforce Governance section */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Workforce Governance Defaults
              </div>
              <p className="text-[11px] text-muted-foreground">
                All employees at this site inherit these policies unless they have individual overrides.
              </p>
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
