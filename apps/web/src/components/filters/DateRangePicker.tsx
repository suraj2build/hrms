import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { CalendarDays, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DateInput } from '@/components/ui/date-input'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: string
  to: string
}

export interface DateRangePickerProps {
  value?: DateRange
  onChange: (range: DateRange) => void
  presets?: boolean
  minDate?: string
  maxDate?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

// ── Preset helpers ────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getPresets(): Array<{ label: string; range: DateRange }> {
  const now = new Date()
  const today = toISO(now)

  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  const last30Start = new Date(now)
  last30Start.setDate(now.getDate() - 29)

  return [
    { label: 'Today', range: { from: today, to: today } },
    { label: 'This Week', range: { from: toISO(weekStart), to: today } },
    { label: 'This Month', range: { from: toISO(monthStart), to: toISO(monthEnd) } },
    { label: 'Last Month', range: { from: toISO(lastMonthStart), to: toISO(lastMonthEnd) } },
    { label: 'Last 30 Days', range: { from: toISO(last30Start), to: today } },
  ]
}

// ── Format display label ──────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return iso
  return `${String(dt.getDate()).padStart(2,'0')}-${M[dt.getMonth()]}`
}

function formatRange(range: DateRange): string {
  if (range.from === range.to) return formatDate(range.from)
  return `${formatDate(range.from)} – ${formatDate(range.to)}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DateRangePicker({
  value,
  onChange,
  presets = false,
  minDate,
  maxDate,
  placeholder = 'Select date range',
  disabled = false,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>(value ?? { from: '', to: '' })

  const ref = useRef<HTMLDivElement>(null)

  // Sync draft when value changes externally
  useEffect(() => {
    if (value) setDraft(value)
  }, [value])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Keyboard close
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }, [])

  const handleApply = useCallback(() => {
    if (draft.from && draft.to) {
      onChange(draft)
      setOpen(false)
    }
  }, [draft, onChange])

  const handleClear = useCallback(() => {
    setDraft({ from: '', to: '' })
  }, [])

  const handlePreset = useCallback(
    (range: DateRange) => {
      setDraft(range)
      onChange(range)
      setOpen(false)
    },
    [onChange],
  )

  const canApply = draft.from && draft.to && draft.from <= draft.to
  const hasValue = !!value?.from && !!value?.to
  const presetList = useMemo(() => (presets ? getPresets() : []), [presets])

  return (
    <div
      ref={ref}
      className={cn('relative inline-block', className)}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label={`Date range: ${hasValue ? formatRange(value!) : placeholder}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        className={cn(
          'flex items-center gap-2 min-w-[200px] px-3 h-9 rounded-md border border-border bg-background',
          'text-sm transition-colors',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          hasValue ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate">
          {hasValue ? formatRange(value!) : placeholder}
        </span>
        {hasValue ? (
          <span
            role="button"
            aria-label="Clear date range"
            onClick={(e) => {
              e.stopPropagation()
              onChange({ from: '', to: '' })
            }}
            className="flex items-center justify-center w-4 h-4 rounded-full hover:bg-muted-foreground/20 transition-colors"
          >
            <X className="w-3 h-3 text-muted-foreground" />
          </span>
        ) : (
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Date range picker"
          className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
          style={{ minWidth: 280 }}
        >
          {/* Presets */}
          {presets && (
            <div className="flex flex-wrap gap-1.5 p-3 border-b border-border">
              {presetList.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handlePreset(p.range)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-md border border-border bg-background',
                    'hover:bg-muted transition-colors text-foreground',
                    value?.from === p.range.from && value?.to === p.range.to
                      ? 'border-primary text-primary bg-primary/5'
                      : '',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Inputs */}
          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  From
                </label>
                <DateInput
                  aria-label="From date"
                  value={draft.from}
                  min={minDate}
                  max={draft.to || maxDate}
                  onChange={(v) => setDraft((d) => ({ ...d, from: v }))}
                  className="w-full h-8 px-2 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  To
                </label>
                <DateInput
                  aria-label="To date"
                  value={draft.to}
                  min={draft.from || minDate}
                  max={maxDate}
                  onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
                  className="w-full h-8 px-2 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear dates"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!canApply}
                aria-label="Apply date range"
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
