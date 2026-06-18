import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Check, ChevronDown, Loader2, User, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface EmployeeOption {
  id: string
  full_name: string
  employee_code?: string
  department?: string
}

export interface EmployeeSelectorProps {
  value?: string | string[]
  onChange: (value: string | string[]) => void
  multiple?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  tenantId?: string
  /** Employee ids to hide from the list (e.g. the current employee for a manager picker). */
  excludeIds?: string[]
}

// ── Debounce ──────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Component ────────────────────────────────────────────────────────────────

export function EmployeeSelector({
  value,
  onChange,
  multiple = false,
  placeholder = 'Select employee…',
  disabled = false,
  className,
  tenantId,
  excludeIds,
}: EmployeeSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [optionsRaw, setOptions] = useState<EmployeeOption[]>([])
  const options = useMemo(
    () => (excludeIds && excludeIds.length ? optionsRaw.filter((o) => !excludeIds.includes(o.id)) : optionsRaw),
    [optionsRaw, excludeIds],
  )
  const [loading, setLoading] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  // Accumulated id → label cache so the trigger/selected chips can always show
  // a name + code (never a raw UUID), even for a preselected value not present
  // in the current search results.
  const [labelCache, setLabelCache] = useState<Record<string, EmployeeOption>>({})
  const labelCacheRef = useRef(labelCache)
  labelCacheRef.current = labelCache
  const mergeLabels = useCallback((rows: EmployeeOption[]) => {
    if (rows.length === 0) return
    setLabelCache((prev) => {
      const next = { ...prev }
      for (const r of rows) next[r.id] = r
      return next
    })
  }, [])

  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const debouncedQuery = useDebounce(query, 300)

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ── Focus input on open ───────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setFocusIndex(-1)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // ── Fetch employees ───────────────────────────────────────────────────────
  // Uses /employees/options — open to ANY authenticated role (managers, ESS,
  // not just hr_admin) and searches name + employee_code + email. This lets the
  // same searchable picker be reused everywhere rather than each page rolling a
  // plain, unsearchable <Select>.
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      try {
        const params = new URLSearchParams({ search: debouncedQuery, limit: '50' })
        if (tenantId) params.set('tenantId', tenantId)
        const res = await api.get<{
          data: Array<{ id: string; first_name: string; last_name: string; employee_code?: string }>
        }>(`/employees/options?${params.toString()}`)
        if (!cancelled) {
          const mapped = (res.data ?? []).map((e) => ({
            id:            e.id,
            full_name:     `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
            employee_code: e.employee_code,
          }))
          setOptions(mapped)
          mergeLabels(mapped)
        }
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (open) fetch()
    return () => { cancelled = true }
  }, [debouncedQuery, open, tenantId, mergeLabels])

  // ── Resolve labels for preselected ids (so the trigger never shows a UUID) ──
  const selectedKey = (Array.isArray(value) ? value : value ? [value] : []).join(',')
  useEffect(() => {
    const ids = selectedKey ? selectedKey.split(',') : []
    const missing = ids.filter((id) => id && !labelCacheRef.current[id])
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{
          data: Array<{ id: string; first_name: string; last_name: string; employee_code?: string }>
        }>(`/employees/options?ids=${encodeURIComponent(missing.join(','))}`)
        if (cancelled) return
        mergeLabels(
          (res.data ?? []).map((e) => ({
            id:            e.id,
            full_name:     `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim(),
            employee_code: e.employee_code,
          })),
        )
      } catch { /* leave unresolved — falls back to id */ }
    })()
    return () => { cancelled = true }
  }, [selectedKey, mergeLabels])

  // ── Selection helpers ─────────────────────────────────────────────────────
  const selectedIds: string[] = useMemo(
    () =>
      value === undefined
        ? []
        : Array.isArray(value)
        ? value
        : [value],
    [value],
  )

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds],
  )

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
        setQuery('')
      }
    },
    [multiple, isSelected, selectedIds, onChange],
  )

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIndex((i) => Math.min(i + 1, options.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && focusIndex >= 0) {
        e.preventDefault()
        const opt = options[focusIndex]
        if (opt) handleSelect(opt.id)
      }
    },
    [open, options, focusIndex, handleSelect],
  )

  // ── Scroll focused item into view ─────────────────────────────────────────
  useEffect(() => {
    const list = listRef.current
    if (!list || focusIndex < 0) return
    const item = list.children[focusIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  // ── Trigger label ─────────────────────────────────────────────────────────
  // Resolve via the label cache first (covers preselected values not in the
  // current search list), then the loaded options. Show "Name · CODE" so the
  // human employee code is always visible — never a raw UUID.
  const resolveLabel = useCallback((id: string): string => {
    const opt = labelCache[id] ?? options.find((o) => o.id === id)
    if (!opt) return id
    return opt.employee_code ? `${opt.full_name} · ${opt.employee_code}` : opt.full_name
  }, [labelCache, options])

  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) return placeholder
    if (multiple) {
      if (selectedIds.length === 1) return resolveLabel(selectedIds[0])
      return `${selectedIds.length} selected`
    }
    return resolveLabel(selectedIds[0])
  }, [selectedIds, multiple, placeholder, resolveLabel])

  const hasValue = selectedIds.length > 0

  return (
    <div
      ref={ref}
      className={cn('relative inline-block', className)}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-label={`Employee selector: ${triggerLabel}`}
        aria-expanded={open}
        aria-haspopup="listbox"
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
        <User className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left truncate">{triggerLabel}</span>
        {hasValue && !disabled && (
          // Clear the selection (e.g. an optional filter back to "all").
          <span
            role="button"
            aria-label="Clear selection"
            onClick={(e) => { e.stopPropagation(); onChange(multiple ? [] : '') }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg min-w-[280px] overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees…"
              aria-label="Search employees"
              className="w-full h-7 px-2 text-sm rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {/* List */}
          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable={multiple}
            aria-label="Employee options"
            className="max-h-[220px] overflow-y-auto py-1"
          >
            {loading ? (
              <li className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </li>
            ) : options.length === 0 ? (
              <li className="py-6 text-center text-sm text-muted-foreground">No employees found</li>
            ) : (
              options.map((opt, i) => {
                const selected = isSelected(opt.id)
                return (
                  <li
                    key={opt.id}
                    role="option"
                    aria-selected={selected}
                    onClick={() => handleSelect(opt.id)}
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
                          selected
                            ? 'bg-primary border-primary'
                            : 'border-border bg-background',
                        )}
                      >
                        {selected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{opt.full_name}</p>
                      {(opt.employee_code || opt.department) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {[opt.employee_code, opt.department].filter(Boolean).join(' · ')}
                        </p>
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

          {multiple && selectedIds.length > 0 && (
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
