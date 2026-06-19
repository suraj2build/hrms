import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StatusOption {
  value: string
  label: string
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'neutral'
}

export interface StatusSelectorProps {
  options: StatusOption[]
  value?: string | string[]
  onChange: (value: string | string[]) => void
  multiple?: boolean
  placeholder?: string
  className?: string
}

// ── Variant dot color map ─────────────────────────────────────────────────────

const DOT_CLASS: Record<NonNullable<StatusOption['variant']>, string> = {
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  danger:  'bg-red-500',
  info:    'bg-blue-500',
  muted:   'bg-muted-foreground',
  neutral: 'bg-border',
}

function StatusDot({ variant }: { variant?: StatusOption['variant'] }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        variant ? DOT_CLASS[variant] : 'bg-border',
      )}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function StatusSelector({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'All statuses',
  className,
}: StatusSelectorProps) {
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

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

  const selectedValues: string[] = useMemo(() => value === undefined
    ? []
    : Array.isArray(value)
    ? value
    : [value], [value])

  const isSelected = useCallback(
    (v: string) => selectedValues.includes(v),
    [selectedValues],
  )

  const handleSelect = useCallback(
    (v: string) => {
      if (multiple) {
        const next = isSelected(v)
          ? selectedValues.filter((s) => s !== v)
          : [...selectedValues, v]
        onChange(next)
      } else {
        onChange(v)
        setOpen(false)
      }
    },
    [multiple, isSelected, selectedValues, onChange],
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
        setFocusIndex((i) => Math.min(i + 1, options.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault()
        const opt = options[focusIndex]
        if (opt) handleSelect(opt.value)
      }
    },
    [open, options, focusIndex, handleSelect],
  )

  // Trigger label
  let triggerLabel: React.ReactNode = <span className="text-muted-foreground">{placeholder}</span>
  if (selectedValues.length > 0) {
    if (multiple) {
      if (selectedValues.length === 1) {
        const opt = options.find((o) => o.value === selectedValues[0])
        triggerLabel = opt ? (
          <span className="flex items-center gap-1.5">
            <StatusDot variant={opt.variant} />
            {opt.label}
          </span>
        ) : (
          <span>1 selected</span>
        )
      } else {
        triggerLabel = <span>{selectedValues.length} statuses</span>
      }
    } else {
      const opt = options.find((o) => o.value === selectedValues[0])
      triggerLabel = opt ? (
        <span className="flex items-center gap-1.5">
          <StatusDot variant={opt.variant} />
          {opt.label}
        </span>
      ) : (
        <span>{selectedValues[0]}</span>
      )
    }
  }

  const hasValue = selectedValues.length > 0

  return (
    <div
      ref={ref}
      className={cn('relative inline-block', className)}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label="Status selector"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((p) => !p)}
        className={cn(
          'flex items-center gap-2 min-w-[160px] px-3 h-9 rounded-md border border-border bg-background',
          'text-sm transition-colors',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          hasValue ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className="flex-1 text-left truncate">{triggerLabel}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg min-w-[200px] overflow-hidden">
          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable={multiple}
            aria-label="Status options"
            className="max-h-[240px] overflow-y-auto py-1"
          >
            {options.map((opt, i) => {
              const selected = isSelected(opt.value)
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleSelect(opt.value)}
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
                  <StatusDot variant={opt.variant} />
                  <span className="flex-1 text-sm text-foreground">{opt.label}</span>
                  {!multiple && selected && (
                    <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                </li>
              )
            })}
          </ul>
          {multiple && hasValue && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear {selectedValues.length} selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
