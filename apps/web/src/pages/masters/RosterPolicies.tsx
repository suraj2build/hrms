/**
 * RosterPolicies — /admin/masters/rosters
 *
 * Enterprise Roster Policy list page.
 * Lists all roster (weekly-off) policies with impact counts, status, and
 * quick actions. Navigates to RosterPolicyEditor for create / edit.
 */

import { useState }                               from 'react'
import { useNavigate }                             from 'react-router-dom'
import { toast }                                   from 'sonner'
import { useQuery, useMutation, useQueryClient }   from '@tanstack/react-query'
import {
  Plus, CalendarDays, Loader2, Building2, Users,
  Copy, Archive, ArchiveRestore, MoreHorizontal, Pencil,
  CalendarClock,
} from 'lucide-react'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn }             from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type DayState = 'working' | 'off' | 'half_day'

interface WeekRow {
  mon: DayState; tue: DayState; wed: DayState; thu: DayState
  fri: DayState; sat: DayState; sun: DayState
}

interface PolicyMatrix {
  week1: WeekRow; week2: WeekRow; week3: WeekRow; week4: WeekRow; week5: WeekRow
}

interface RosterPolicy {
  id:           string
  name:         string
  code:         string | null
  description:  string | null
  cycle_days:   number
  pattern_json: {
    weekly_off_days: number[]
    matrix?:         PolicyMatrix
  }
  is_active:       boolean
  created_at:      string
  updated_at:      string | null
  site_count?:     number
  employee_count?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEK_KEYS = ['week1', 'week2', 'week3', 'week4', 'week5'] as const
const DAY_KEYS  = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function defaultWeekRow(): WeekRow {
  return { mon: 'working', tue: 'working', wed: 'working', thu: 'working', fri: 'working', sat: 'off', sun: 'off' }
}

function defaultMatrix(): PolicyMatrix {
  return {
    week1: defaultWeekRow(),
    week2: defaultWeekRow(),
    week3: defaultWeekRow(),
    week4: defaultWeekRow(),
    week5: defaultWeekRow(),
  }
}

/**
 * Generates a concise human-readable summary of the weekly-off pattern.
 * Analyses the 5-week matrix to detect common patterns.
 */
function generatePolicySummary(policy: RosterPolicy): string {
  const matrix = policy.pattern_json.matrix

  if (!matrix) {
    // Fall back to legacy weekly_off_days
    const offs = policy.pattern_json.weekly_off_days ?? []
    if (offs.length === 0) return 'All days working'
    return offs.map(d => DOW_SHORT[d]).join(' & ') + ' off'
  }

  const weekKeys = WEEK_KEYS
  const dayKeys  = DAY_KEYS
  const dayLabels: Record<string, string> = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
    fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  }

  // For each day-of-week, collect which weeks have it as "off"
  const offWeeks: Record<string, number[]> = {}
  for (const day of dayKeys) {
    offWeeks[day] = []
    for (let wi = 0; wi < 5; wi++) {
      if (matrix[weekKeys[wi]][day] === 'off') {
        offWeeks[day].push(wi + 1)
      }
    }
  }

  const parts: string[] = []

  for (const day of dayKeys) {
    const weeks = offWeeks[day]
    if (weeks.length === 0) continue
    if (weeks.length === 5) {
      parts.push(`All ${dayLabels[day]}s off`)
    } else if (weeks.length === 2 && weeks[0] === 2 && weeks[1] === 4) {
      parts.push(`2nd & 4th ${dayLabels[day]}s off`)
    } else if (weeks.length === 2 && weeks[0] === 1 && weeks[1] === 3) {
      parts.push(`1st & 3rd ${dayLabels[day]}s off`)
    } else if (weeks.length === 1) {
      const ord = ['1st', '2nd', '3rd', '4th', '5th'][weeks[0] - 1]
      parts.push(`${ord} ${dayLabels[day]} off`)
    } else {
      const ordinals = weeks.map(w => ['1st', '2nd', '3rd', '4th', '5th'][w - 1])
      parts.push(`${ordinals.join(', ')} ${dayLabels[day]}s off`)
    }
  }

  return parts.length === 0 ? 'All days working' : parts.join(' · ')
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── PolicyCard ────────────────────────────────────────────────────────────────

function PolicyCard({
  policy,
  isAdmin,
  onEdit,
  onDuplicate,
  onToggleActive,
}: {
  policy:          RosterPolicy
  isAdmin:         boolean
  onEdit:          () => void
  onDuplicate:     () => void
  onToggleActive:  () => void
}) {
  const summary = generatePolicySummary(policy)
  const matrix  = policy.pattern_json.matrix ?? defaultMatrix()

  // Mini matrix preview — compact 5×7 dot grid
  const MiniMatrix = () => (
    <div className="flex flex-col gap-0.5 mt-2">
      {WEEK_KEYS.map(wk => (
        <div key={wk} className="flex gap-0.5">
          {DAY_KEYS.map(day => {
            const state = matrix[wk][day]
            return (
              <div
                key={day}
                title={`${wk.replace('week', 'W')} ${day.charAt(0).toUpperCase() + day.slice(1)}: ${state}`}
                className={cn(
                  'w-3 h-3 rounded-[2px] flex-shrink-0',
                  state === 'working'  && 'bg-success/70',
                  state === 'off'      && 'bg-destructive/70',
                  state === 'half_day' && 'bg-warning/70',
                )}
              />
            )
          })}
        </div>
      ))}
    </div>
  )

  return (
    <div
      className={cn(
        'bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer group',
        !policy.is_active && 'opacity-60',
      )}
      onClick={onEdit}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">{policy.name}</h3>
            {policy.code && (
              <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground flex-shrink-0">
                {policy.code}
              </span>
            )}
          </div>
          {policy.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{policy.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge
            variant={policy.is_active ? 'default' : 'outline'}
            className={cn(
              'rounded-full text-[10px] px-2 py-0',
              policy.is_active
                ? 'bg-success/15 text-success border-success hover:bg-emerald-500/15'
                : 'text-muted-foreground',
            )}
          >
            {policy.is_active ? 'Active' : 'Archived'}
          </Badge>

          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={e => { e.stopPropagation(); onEdit() }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit Policy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={e => { e.stopPropagation(); onDuplicate() }}>
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={e => { e.stopPropagation(); onToggleActive() }}
                  className={policy.is_active ? 'text-destructive' : 'text-success'}
                >
                  {policy.is_active
                    ? <><Archive className="h-3.5 w-3.5 mr-2" />Archive Policy</>
                    : <><ArchiveRestore className="h-3.5 w-3.5 mr-2" />Restore Policy</>
                  }
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex gap-4 items-end">
        {/* Mini matrix */}
        <div className="flex flex-col">
          <div className="flex gap-0.5 mb-0.5">
            {DAY_KEYS.map(d => (
              <div key={d} className="w-3 text-[7px] text-center text-muted-foreground/60 font-semibold uppercase leading-none">
                {d[0].toUpperCase()}
              </div>
            ))}
          </div>
          <MiniMatrix />
        </div>

        {/* Summary text */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{summary}</p>
        </div>
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-3 pt-1 border-t border-border/50">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Building2 className="h-3 w-3" />
          <span>{policy.site_count ?? 0} sites</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          <span>{policy.employee_count ?? 0} employees</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
          <Badge variant="outline" className="rounded-full text-[9px] px-1.5 py-0">
            {policy.cycle_days}-day cycle
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground/50">
          Updated {formatDate(policy.updated_at ?? policy.created_at)}
        </span>
      </div>
    </div>
  )
}

// ── RosterPolicies ────────────────────────────────────────────────────────────

export function RosterPolicies() {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [showArchived, setShowArchived] = useState(false)

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: policiesData, isLoading } = useQuery<{ data: RosterPolicy[] }>({
    queryKey: ['roster-policies'],
    queryFn:  () => api.get('/masters/rosters'),
    staleTime: 60_000,
  })

  const allPolicies = policiesData?.data ?? []
  const policies    = showArchived
    ? allPolicies
    : allPolicies.filter(p => p.is_active)

  // ── Mutations ─────────────────────────────────────────────────────────────
  const duplicateMut = useMutation({
    mutationFn: (id: string) => api.post<{ data?: { id?: string } }>(`/masters/rosters/${id}/duplicate`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['roster-policies'] })
      toast.success('Policy duplicated')
      // Navigate to the new copy
      if (res?.data?.id) navigate(`/admin/masters/rosters/${res.data.id}`)
    },
    onError: (e: Error) => toast.error('Failed to duplicate policy', { description: e.message }),
  })

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/masters/rosters/${id}`, { is_active }),
    onSuccess: (_, { is_active }) => {
      qc.invalidateQueries({ queryKey: ['roster-policies'] })
      toast.success(is_active ? 'Policy restored' : 'Policy archived')
    },
    onError: (e: Error) => toast.error('Failed to update policy', { description: e.message }),
  })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Roster Policies"
        subtitle="Weekly-off governance policies — define which days employees are off each week"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchived(v => !v)}
              className="text-xs gap-1.5"
            >
              {showArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              {showArchived ? 'Hide Archived' : 'Show Archived'}
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => navigate('/admin/masters/rosters/new')}>
                <Plus className="h-4 w-4 mr-1.5" />
                New Roster Policy
              </Button>
            )}
          </div>
        }
      />

      {/* Summary bar */}
      <div className="flex items-center gap-6 px-1 mb-4">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4" />
          <span><strong className="text-foreground">{allPolicies.filter(p => p.is_active).length}</strong> active policies</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground ml-6">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-success/70 inline-block" />Working
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-destructive/70 inline-block" />Off
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-warning/70 inline-block" />Half Day
          </span>
        </div>
      </div>

      {/* Policy grid */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading roster policies…</span>
        </div>
      ) : policies.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
            <CalendarDays className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No roster policies yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {showArchived
                ? 'No policies found (including archived)'
                : 'Create your first roster policy to define weekly-off patterns'}
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => navigate('/admin/masters/rosters/new')}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create First Policy
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {policies.map(policy => (
            <PolicyCard
              key={policy.id}
              policy={policy}
              isAdmin={isAdmin}
              onEdit={() => navigate(`/admin/masters/rosters/${policy.id}`)}
              onDuplicate={() => duplicateMut.mutate(policy.id)}
              onToggleActive={() => toggleActiveMut.mutate({ id: policy.id, is_active: !policy.is_active })}
            />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
