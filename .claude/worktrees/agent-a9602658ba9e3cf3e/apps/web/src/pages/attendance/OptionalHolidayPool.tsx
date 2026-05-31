/**
 * OptionalHolidayPool — /admin/leave/optional-holidays
 *
 * HR admin page to manage the optional holiday pool — the subset of optional
 * holidays in the holiday_calendar that employees are allowed to select.
 *
 * Features:
 *   - View current year pool with employee selection counts
 *   - Add optional holidays to the pool (from existing holiday_calendar)
 *   - Remove holidays from the pool
 *   - Year navigation
 *
 * Design: design-system tokens only.
 */

import { useState }                               from 'react'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import {
  CalendarCheck, Plus, Trash2, Loader2, ShieldAlert,
  ChevronLeft, ChevronRight, Users,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { toast }          from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Holiday {
  id:           string
  date:         string
  name:         string
  holiday_type: string
  is_optional:  boolean
}

interface PoolItem {
  pool_id:         string
  year:            number
  holiday:         Holiday | null
  selection_count: number
}

interface PoolResponse {
  data: PoolItem[]
  year: number
}

interface HolidaysResponse {
  data: Holiday[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString([], {
    weekday: 'short', day: '2-digit', month: 'long',
  })
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function OptionalHolidayPool() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc = useQueryClient()

  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [addMode, setAddMode] = useState(false)
  const [selectedHolidayId, setSelectedHolidayId] = useState('')
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  // ── Pool query ──────────────────────────────────────────────────────────────
  const { data: poolResp, isLoading: poolLoading } = useQuery<PoolResponse>({
    queryKey: ['optional-pool-admin', year],
    queryFn:  () => api.get(`/leave/optional-holidays/pool?year=${year}`),
    enabled:  isAdmin,
    staleTime: 60_000,
  })

  // ── Available optional holidays (to add) ────────────────────────────────────
  const { data: holidaysResp } = useQuery<HolidaysResponse>({
    queryKey: ['holidays-calendar'],
    queryFn:  () => api.get('/masters/holidays'),
    enabled:  isAdmin && addMode,
    staleTime: 5 * 60_000,
  })

  const poolHolidayIds = new Set((poolResp?.data ?? []).map(p => p.holiday?.id ?? ''))
  const addableHolidays = (holidaysResp?.data ?? []).filter(
    h => h.is_optional &&
         !poolHolidayIds.has(h.id) &&
         new Date(`${h.date}T12:00:00Z`).getUTCFullYear() === year,
  )

  // ── Add mutation ─────────────────────────────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: (holidayId: string) =>
      api.post('/leave/optional-holidays/pool', { holiday_id: holidayId, year }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['optional-pool-admin', year] })
      setSelectedHolidayId('')
      setAddMode(false)
      toast.success('Holiday added to pool')
    },
    onError: (e: Error) => toast.error('Failed to add holiday', { description: e.message }),
  })

  // ── Remove mutation ──────────────────────────────────────────────────────────
  const removeMutation = useMutation({
    mutationFn: (poolId: string) =>
      api.delete(`/leave/optional-holidays/pool/${poolId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['optional-pool-admin', year] })
      setConfirmRemoveId(null)
      toast.success('Holiday removed from pool')
    },
    onError: (e: Error) => toast.error('Failed to remove holiday', { description: e.message }),
  })

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Optional Holiday Pool" subtitle="Manage employee-selectable optional holidays" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <ShieldAlert className="h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">Access restricted to HR admins</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const pool = poolResp?.data ?? []

  return (
    <PageContainer>
      <PageHeader
        title="Optional Holiday Pool"
        subtitle="Configure which optional holidays employees can self-select for their leave"
        actions={
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setAddMode(p => !p)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add to Pool
          </Button>
        }
      />

      {/* Year navigation */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setYear(y => y - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm font-semibold text-foreground w-12 text-center">{year}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setYear(y => y + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {year !== currentYear && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setYear(currentYear)}
          >
            Current year
          </Button>
        )}
      </div>

      {/* Add to pool panel */}
      {addMode && (
        <SectionCard className="mb-4 border-primary/30">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Select optional holiday to add to the {year} pool
              </label>
              <select
                value={selectedHolidayId}
                onChange={e => setSelectedHolidayId(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">Choose holiday…</option>
                {addableHolidays.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.date} — {h.name}
                  </option>
                ))}
              </select>
              {addableHolidays.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No optional holidays available to add for {year}.
                  Mark holidays as &quot;optional&quot; in the Holiday Calendar first.
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!selectedHolidayId || addMutation.isPending}
              onClick={() => addMutation.mutate(selectedHolidayId)}
            >
              {addMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : 'Add'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => { setAddMode(false); setSelectedHolidayId('') }}
            >
              Cancel
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Pool table */}
      <SectionCard
        title={`Pool for ${year} (${pool.length} ${pool.length === 1 ? 'holiday' : 'holidays'})`}
        icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}
      >
        {poolLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : pool.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
            <CalendarCheck className="h-8 w-8 opacity-30" />
            <p className="text-sm">No optional holidays in the pool for {year}.</p>
            <p className="text-xs text-muted-foreground/60">
              Use &quot;Add to Pool&quot; to make optional holidays available for employee selection.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {pool.map(item => {
              const h = item.holiday
              if (!h) return null
              const isConfirming = confirmRemoveId === item.pool_id
              return (
                <div
                  key={item.pool_id}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  {/* Date */}
                  <div className="flex-shrink-0 text-center w-12">
                    <div className="text-[10px] font-semibold text-muted-foreground">
                      {new Date(`${h.date}T12:00:00Z`).toLocaleString('default', { month: 'short' }).toUpperCase()}
                    </div>
                    <div className="text-lg font-bold text-foreground leading-none">
                      {new Date(`${h.date}T12:00:00Z`).getUTCDate()}
                    </div>
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(h.date)}</p>
                  </div>

                  {/* Selection count */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
                    <Users className="h-3 w-3" />
                    <span className="tabular-nums">{item.selection_count}</span>
                    <span>selected</span>
                  </div>

                  {/* Remove action */}
                  {isConfirming ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-destructive">Remove?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 text-[10px] px-2"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(item.pool_id)}
                      >
                        {removeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-1"
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        No
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title={item.selection_count > 0
                        ? `Remove from pool (${item.selection_count} employee selections will also be removed)`
                        : 'Remove from pool'}
                      onClick={() => setConfirmRemoveId(item.pool_id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {pool.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-3 text-right">
          Removing a holiday from the pool will also remove all employee selections for that holiday.
        </p>
      )}
    </PageContainer>
  )
}
