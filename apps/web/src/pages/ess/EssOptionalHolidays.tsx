/**
 * EssOptionalHolidays — /ess/optional-holidays
 *
 * Employee self-service: choose optional holidays from the tenant's pool.
 * Shows all available optional holidays for the current year.
 * Employee can select or deselect up to the limit configured in leave policy.
 *
 * Design: design-system tokens only.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CheckCircle2, Circle, Info, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { ConfirmDialog }  from '@/components/ui/ConfirmDialog'
import { api }            from '@/lib/api/client'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Holiday {
  id:           string
  date:         string
  name:         string
  holiday_type: string
}

interface OptionalHolidayItem {
  pool_id:     string
  year:        number
  holiday:     Holiday | null
  is_selected: boolean
}

interface OptionalHolidaysResponse {
  data: OptionalHolidayItem[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const W = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  if (isNaN(d.getTime())) return '—'
  return `${W[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}`
}

function getDayOfWeek(dateStr: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[new Date(`${dateStr}T12:00:00Z`).getUTCDay()]
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function EssOptionalHolidays() {
  const qc = useQueryClient()
  const currentYear = new Date().getFullYear()

  const { data: resp, isLoading } = useQuery<OptionalHolidaysResponse>({
    queryKey: ['optional-holidays-ess'],
    queryFn:  () => api.get('/leave/optional-holidays'),
    staleTime: 60_000,
  })

  const items      = resp?.data ?? []
  const selected   = items.filter(i => i.is_selected)
  const available  = items.filter(i => !i.is_selected)

  // ── Select mutation ─────────────────────────────────────────────────────────
  const selectMutation = useMutation({
    mutationFn: (poolId: string) =>
      api.post('/leave/optional-holidays/select', { pool_id: poolId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['optional-holidays-ess'] })
      toast.success('Optional holiday selected')
    },
    onError: (e: Error) => toast.error('Failed to select holiday', { description: e.message }),
  })

  // ── Deselect mutation ───────────────────────────────────────────────────────
  const deselectMutation = useMutation({
    mutationFn: (poolId: string) =>
      api.delete(`/leave/optional-holidays/${poolId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['optional-holidays-ess'] })
      setRemoveTarget(null)
      toast.success('Optional holiday removed')
    },
    onError: (e: Error) => { setRemoveTarget(null); toast.error('Failed to remove holiday', { description: e.message }) },
  })

  const isPending = selectMutation.isPending || deselectMutation.isPending
  const [removeTarget, setRemoveTarget] = useState<OptionalHolidayItem | null>(null)

  return (
    <PageContainer>
      <PageHeader
        title="Optional Holidays"
        subtitle={`Choose your optional holidays for ${currentYear}`}
      />

      {isLoading ? (
        <SectionCard>
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        </SectionCard>
      ) : items.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <CalendarCheck className="h-10 w-10 opacity-30" />
            <p className="text-sm">No optional holidays have been configured for {currentYear}.</p>
            <p className="text-xs text-muted-foreground/60">Contact HR if you believe this is an error.</p>
          </div>
        </SectionCard>
      ) : (
        <>
          {/* Info banner */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2.5 mb-4">
            <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
            <span>
              Optional holidays are additional days off that you can choose to take.
              Select the days that work best for you — your selection will be reflected
              in your leave balance.
            </span>
          </div>

          {/* Summary chips */}
          <div className="flex items-center gap-3 mb-4">
            <Badge variant="success" className="rounded-full text-xs gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {selected.length} selected
            </Badge>
            <Badge variant="secondary" className="rounded-full text-xs gap-1">
              <Circle className="h-3 w-3" />
              {available.length} available
            </Badge>
          </div>

          {/* Holiday list */}
          <SectionCard
            title={`Optional Holiday Pool — ${currentYear}`}
            icon={<CalendarCheck className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="space-y-2">
              {items.map(item => {
                if (!item.holiday) return null
                const h = item.holiday
                const dow = getDayOfWeek(h.date)
                const isWeekend = ['Sat', 'Sun'].includes(dow)
                return (
                  <div
                    key={item.pool_id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                      item.is_selected
                        ? 'border-success/40 bg-success/5'
                        : 'border-border bg-card hover:bg-muted/30',
                    )}
                  >
                    {/* Date pill */}
                    <div className="flex-shrink-0 text-center w-12">
                      <div className={cn('text-xs font-semibold', isWeekend ? 'text-warning' : 'text-muted-foreground')}>{dow}</div>
                      <div className="text-sm font-bold text-foreground leading-none">
                        {new Date(`${h.date}T12:00:00Z`).getUTCDate()}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(`${h.date}T12:00:00Z`).toLocaleString('default', { month: 'short' })}
                      </div>
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{h.name}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(h.date)}</p>
                    </div>

                    {/* Status indicator */}
                    {item.is_selected && (
                      <Badge variant="success" className="rounded-full text-[10px] flex-shrink-0">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Selected
                      </Badge>
                    )}

                    {/* Action button */}
                    <Button
                      size="sm"
                      variant={item.is_selected ? 'outline' : 'default'}
                      className="h-7 text-xs flex-shrink-0"
                      disabled={isPending}
                      onClick={() =>
                        item.is_selected
                          ? setRemoveTarget(item)
                          : selectMutation.mutate(item.pool_id)
                      }
                    >
                      {isPending && (selectMutation.variables === item.pool_id || deselectMutation.variables === item.pool_id) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : item.is_selected ? (
                        'Remove'
                      ) : (
                        'Select'
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove optional holiday?"
        message={removeTarget?.holiday ? `This will remove ${removeTarget.holiday.name} (${fmtDate(removeTarget.holiday.date)}) from your selection and adjust your leave balance.` : ''}
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (removeTarget) deselectMutation.mutate(removeTarget.pool_id) }}
        onCancel={() => setRemoveTarget(null)}
      />
    </PageContainer>
  )
}
