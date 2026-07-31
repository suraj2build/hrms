/**
 * UnifiedEventFilter.tsx — Phase UX-4
 *
 * Multi-dimensional filter panel for operational events.
 * Supports severity, workspace, status, date range, and full-text search.
 */
import { useState, useEffect, useRef } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { cn }    from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import {
  SEVERITY_COLORS,
  STATUS_META,
  WORKSPACE_META,
  type EventFilters,
  type EventSeverity,
  type EventStatus,
  type WorkspaceCtx,
} from '@/lib/activity/types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface UnifiedEventFilterProps {
  filters:  EventFilters
  onChange: (filters: EventFilters) => void
  compact?: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITIES: EventSeverity[]  = ['critical', 'high', 'medium', 'low', 'info']
const WORKSPACES: WorkspaceCtx[]   = ['attendance', 'roster', 'payroll', 'workforce', 'compliance', 'leave', 'system']
const STATUSES:   EventStatus[]    = ['open', 'resolved', 'escalated', 'pending', 'dismissed']

// ── Helpers ───────────────────────────────────────────────────────────────────

function activeFilterCount(f: EventFilters): number {
  let count = 0
  if (f.severity?.length)  count++
  if (f.workspace?.length) count++
  if (f.status?.length)    count++
  if (f.search)            count++
  if (f.dateFrom)          count++
  if (f.dateTo)            count++
  if (f.employeeId)        count++
  if (f.siteId)            count++
  return count
}

function toggleArray<T>(arr: T[] | undefined, value: T): T[] {
  const current = arr ?? []
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value]
}

// ── Chip label helpers ────────────────────────────────────────────────────────

function getSeverityLabel(sev: EventSeverity): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1)
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UnifiedEventFilter({
  filters,
  onChange,
  compact = false,
}: UnifiedEventFilterProps) {
  const [expanded, setExpanded] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [localSearch, setLocalSearch] = useState(filters.search ?? '')

  // Always read the latest filters when the debounce timer fires — the
  // effect below only re-runs on [localSearch], so without this ref its
  // setTimeout callback would close over whatever `filters` was at the
  // last keystroke, silently reverting any filter chip clicked within the
  // 300ms window once the timer fires.
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  // Sync local search when external filters change
  useEffect(() => {
    setLocalSearch(filters.search ?? '')
  }, [filters.search])

  // Debounced search propagation
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      onChange({ ...filtersRef.current, search: localSearch || undefined })
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch])

  const count = activeFilterCount(filters)
  const hasFilters = count > 0

  function handleSeverityToggle(sev: EventSeverity) {
    onChange({ ...filters, severity: toggleArray(filters.severity, sev) })
  }

  function handleWorkspaceToggle(ws: WorkspaceCtx) {
    onChange({ ...filters, workspace: toggleArray(filters.workspace, ws) })
  }

  function handleStatusToggle(st: EventStatus) {
    onChange({ ...filters, status: toggleArray(filters.status, st) })
  }

  function handleDateFrom(val: string) {
    onChange({ ...filters, dateFrom: val || undefined })
  }

  function handleDateTo(val: string) {
    onChange({ ...filters, dateTo: val || undefined })
  }

  function handleClearAll() {
    setLocalSearch('')
    onChange({
      employeeId: filters.employeeId,
      siteId:     filters.siteId,
    })
  }

  function removeChip(update: Partial<EventFilters>) {
    onChange({ ...filters, ...update })
  }

  // ── Active chips data ─────────────────────────────────────────────────────

  const activeChips: Array<{ key: string; label: string; onRemove: () => void }> = []

  if (filters.search) {
    activeChips.push({
      key:      'search',
      label:    `"${filters.search}"`,
      onRemove: () => { setLocalSearch(''); onChange({ ...filters, search: undefined }) },
    })
  }
  (filters.severity ?? []).forEach((sev) => {
    activeChips.push({
      key:      `sev-${sev}`,
      label:    getSeverityLabel(sev),
      onRemove: () => onChange({ ...filters, severity: (filters.severity ?? []).filter((s) => s !== sev) }),
    })
  })
  ;(filters.workspace ?? []).forEach((ws) => {
    activeChips.push({
      key:      `ws-${ws}`,
      label:    WORKSPACE_META[ws].label,
      onRemove: () => onChange({ ...filters, workspace: (filters.workspace ?? []).filter((w) => w !== ws) }),
    })
  })
  ;(filters.status ?? []).forEach((st) => {
    activeChips.push({
      key:      `st-${st}`,
      label:    STATUS_META[st].label,
      onRemove: () => onChange({ ...filters, status: (filters.status ?? []).filter((s) => s !== st) }),
    })
  })
  if (filters.dateFrom) {
    activeChips.push({
      key:      'dateFrom',
      label:    `From: ${filters.dateFrom}`,
      onRemove: () => removeChip({ dateFrom: undefined }),
    })
  }
  if (filters.dateTo) {
    activeChips.push({
      key:      'dateTo',
      label:    `To: ${filters.dateTo}`,
      onRemove: () => removeChip({ dateTo: undefined }),
    })
  }
  if (filters.employeeId) {
    activeChips.push({
      key:      'employee',
      label:    `Employee: ${filters.employeeId}`,
      onRemove: () => removeChip({ employeeId: undefined }),
    })
  }
  if (filters.siteId) {
    activeChips.push({
      key:      'site',
      label:    `Site: ${filters.siteId}`,
      onRemove: () => removeChip({ siteId: undefined }),
    })
  }

  // ── Compact mode ──────────────────────────────────────────────────────────

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search events…"
            className="pl-8 h-7 text-xs"
            aria-label="Search events"
          />
        </div>
        {activeChips.map((chip) => (
          <span
            key={chip.key}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-border bg-muted text-muted-foreground"
          >
            {chip.label}
            <button
              type="button"
              aria-label={`Remove filter ${chip.label}`}
              onClick={chip.onRemove}
              className="hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    )
  }

  // ── Normal mode ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search events…"
            className="pl-9"
            aria-label="Search events"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExpanded((p) => !p)}
          aria-expanded={expanded}
          aria-label={`Filters${count > 0 ? `, ${count} active` : ''}`}
          className="flex items-center gap-1.5 shrink-0"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {count > 0 && (
            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
              {count}
            </span>
          )}
        </Button>

        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            aria-label="Clear all filters"
            className="shrink-0 text-muted-foreground"
          >
            Clear all
          </Button>
        )}
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          {/* Severity row */}
          <div className="flex items-start gap-3">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground pt-1">
              Severity
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITIES.map((sev) => {
                const active = (filters.severity ?? []).includes(sev)
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => handleSeverityToggle(sev)}
                    aria-pressed={active}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      active
                        ? cn(SEVERITY_COLORS[sev].bg, SEVERITY_COLORS[sev].text, SEVERITY_COLORS[sev].border)
                        : 'border-border text-muted-foreground bg-background hover:bg-muted',
                    )}
                  >
                    {getSeverityLabel(sev)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Workspace row */}
          <div className="flex items-start gap-3">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground pt-1">
              Workspace
            </span>
            <div className="flex flex-wrap gap-1.5">
              {WORKSPACES.map((ws) => {
                const active = (filters.workspace ?? []).includes(ws)
                return (
                  <button
                    key={ws}
                    type="button"
                    onClick={() => handleWorkspaceToggle(ws)}
                    aria-pressed={active}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      active
                        ? cn(WORKSPACE_META[ws].bg, WORKSPACE_META[ws].color, 'border-current/30')
                        : 'border-border text-muted-foreground bg-background hover:bg-muted',
                    )}
                  >
                    {WORKSPACE_META[ws].label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Status row */}
          <div className="flex items-start gap-3">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground pt-1">
              Status
            </span>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((st) => {
                const active = (filters.status ?? []).includes(st)
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => handleStatusToggle(st)}
                    aria-pressed={active}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      active
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'border-border text-muted-foreground bg-background hover:bg-muted',
                    )}
                  >
                    {STATUS_META[st].label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Date range row */}
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">
              Date range
            </span>
            <div className="flex items-center gap-2">
              <DateInput
                aria-label="From date"
                value={filters.dateFrom ?? ''}
                max={filters.dateTo}
                onChange={handleDateFrom}
                className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <DateInput
                aria-label="To date"
                value={filters.dateTo ?? ''}
                min={filters.dateFrom}
                onChange={handleDateTo}
                className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-muted text-muted-foreground"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                onClick={chip.onRemove}
                className="hover:text-foreground transition-colors ml-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
