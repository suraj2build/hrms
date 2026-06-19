import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Check, ChevronDown, Clock } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShiftOption {
  id: string
  name: string
  start_time?: string
  end_time?: string
}

export interface ShiftSelectorProps {
  value?: string | string[]
  onChange: (value: string | string[]) => void
  multiple?: boolean
  placeholder?: string
  className?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ShiftSelector({
  value,
  onChange,
  multiple = false,
  placeholder = 'All shifts',
  className,
}: ShiftSelectorProps) {
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api.get<{ data: ShiftOption[] }>('/shifts').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

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

  useEffect(() => {
    if (open) setFocusIndex(-1)
  }, [open])

  // Scroll focused item into view
  useEffect(() => {
    const list = listRef.current
    if (!list || focusIndex < 0) return
    const item = list.children[focusIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  const selectedIds: string[] = useMemo(() => value === undefined
    ? []
    : Array.isArray(value)
    ? value
    : [value], [value])

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds])

  const handleSelect = useCallback(
    (id: string) => {
      if (multiple) {
        const next = isSelected(id)
          ? selectedIds.filter((s) => s !== id)
          : [...selectedIds, id]
        onChange(next)
      } else {
        onChange(id)
        setOpen(false)
      }
    },
    [multiple, isSelected, selectedIds, onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      if (e.key === 'Escape') { setOpen(false); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIndex((i) => Math.min(i + 1, shifts.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault()
        const opt = shifts[focusIndex]
        if (opt) handleSelect(opt.id)
      }
    },
    [open, shifts, focusIndex, handleSelect],
  )

  const triggerLabel =
    selectedIds.length === 0
      ? placeholder
      : multiple
      ? selectedIds.length === 1
        ? shifts.find((s) => s.id === selectedIds[0])?.name ?? '1 selected'
        : `${selectedIds.length} shifts`
      : shifts.find((s) => s.id === selectedIds[0])?.name ?? selectedIds[0]

  const hasValue = selectedIds.length > 0

  return (
    <div
      ref={ref}
      className={cn('relative inline-block', className)}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label={`Shift selector: ${triggerLabel}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'flex items-center gap-2 min-w-[180px] px-3 h-9 rounded-md border border-border bg-background',
          'text-sm transition-colors',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          hasValue ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate">{triggerLabel}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg min-w-[220px] overflow-hidden">
          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable={multiple}
            aria-label="Shift options"
            className="max-h-[240px] overflow-y-auto py-1"
          >
            {shifts.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">No shifts found</li>
            ) : (
              shifts.map((shift, i) => {
                const selected = isSelected(shift.id)
                const timeLabel =
                  shift.start_time && shift.end_time
                    ? `${shift.start_time} – ${shift.end_time}`
                    : shift.start_time ?? ''
                return (
                  <li
                    key={shift.id}
                    role="option"
                    aria-selected={selected}
                    onClick={() => handleSelect(shift.id)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                      focusIndex === i ? 'bg-muted' : 'hover:bg-muted/60',
                      selected && 'bg-primary/5',
                    )}
                  >
                    {multiple && (
                      <div
                        className={cn(
                          'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                          selected ? 'bg-primary border-primary' : 'border-border bg-background',
                        )}
                      >
                        {selected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{shift.name}</p>
                      {timeLabel && (
                        <p className="text-xs text-muted-foreground truncate">{timeLabel}</p>
                      )}
                    </div>
                    {!multiple && selected && (
                      <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </li>
                )
              })
            )}
          </ul>
          {multiple && hasValue && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear {selectedIds.length} selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
