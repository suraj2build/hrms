/**
 * DateInput — Segmented date entry  [ DD ] - [ MMM ] - [ YYYY ]  📅
 *
 * UX:
 *  - Three focused mini-inputs separated by hyphens
 *  - Day  : type 1-2 digits; auto-advances to Month when 2 digits entered
 *           or when first digit is 4-9 (single-digit day confirmed)
 *  - Month: type 1-12 (numeric) or Jan/Feb/… letters; auto-advances to Year
 *  - Year : type 4 digits; emits full ISO date when complete
 *  - Calendar icon opens browser's native picker as an alternative
 *  - Arrow keys / Backspace navigate between segments
 *
 * Value contract: always emits / receives ISO strings (YYYY-MM-DD)
 */

import { useRef, useState, useEffect } from 'react'
import type { KeyboardEvent, ChangeEvent } from 'react'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoToParts(iso: string) {
  if (!iso || iso.length < 10) return { day: '', month: '', year: '' }
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d || m < 1 || m > 12) return { day: '', month: '', year: '' }
  return {
    day:   String(d).padStart(2, '0'),
    month: MONTHS[m - 1],
    year:  String(y),
  }
}

function partsToIso(day: string, month: string, year: string): string {
  const d = Number(day)
  const mIdx = MONTHS.findIndex(m => m.toLowerCase() === month.toLowerCase())
  const y = Number(year)
  if (!d || d < 1 || d > 31 || mIdx === -1 || !y || y < 1900 || y > 2100) return ''
  return `${y}-${String(mIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Resolve a numeric string (1-12) or 3-letter string to a MONTHS entry, or '' */
function resolveMonth(raw: string): string {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    if (n >= 1 && n <= 12) return MONTHS[n - 1]
    return ''
  }
  return MONTHS.find(m => m.toLowerCase().startsWith(raw.toLowerCase())) ?? ''
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface DateInputProps {
  /** ISO YYYY-MM-DD */
  value?:       string
  onChange?:    (iso: string) => void
  onBlur?:      () => void
  id?:          string
  disabled?:    boolean
  className?:   string
  'aria-invalid'?: boolean
  min?: string
  max?: string
}

export function DateInput({
  value,
  onChange,
  onBlur,
  id,
  disabled,
  className,
  min,
  max,
  ...rest
}: DateInputProps) {
  const dayRef    = useRef<HTMLInputElement>(null)
  const monthRef  = useRef<HTMLInputElement>(null)
  const yearRef   = useRef<HTMLInputElement>(null)
  const nativeRef = useRef<HTMLInputElement>(null)

  const [parts, setParts] = useState(() => isoToParts(value ?? ''))

  // Sync when value changes externally (e.g. form reset)
  useEffect(() => {
    setParts(isoToParts(value ?? ''))
  }, [value])

  // ── Emit ISO whenever parts are complete ─────────────────────────────────────
  function tryEmit(day: string, month: string, year: string) {
    const iso = partsToIso(day, month, year)
    if (iso) onChange?.(iso)
  }

  // ── Day ───────────────────────────────────────────────────────────────────────
  function handleDayChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 2)
    setParts(prev => {
      tryEmit(raw, prev.month, prev.year)
      return { ...prev, day: raw }
    })
    // Auto-advance: 2 digits entered, or first digit > 3 (days can't start with 4-9)
    if (raw.length === 2 || (raw.length === 1 && Number(raw) > 3)) {
      setTimeout(() => { monthRef.current?.focus(); monthRef.current?.select() }, 0)
    }
  }

  function handleDayKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const pos = e.currentTarget.selectionStart ?? 0
    if (e.key === 'ArrowRight' && pos >= parts.day.length) {
      e.preventDefault(); monthRef.current?.focus(); monthRef.current?.select()
    }
    if (e.key === 'Delete' || (e.key === 'Backspace' && !parts.day)) {
      e.preventDefault()
      setParts(prev => { tryEmit('', prev.month, prev.year); return { ...prev, day: '' } })
    }
  }

  // ── Month ─────────────────────────────────────────────────────────────────────
  function handleMonthChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.slice(0, 3)

    // Numeric entry: 1-12
    if (/^\d+$/.test(raw)) {
      const n = Number(raw)
      // Single digit > 1 is unambiguous (2=Feb … 9=Sep), or two digits entered
      if (raw.length === 2 || (raw.length === 1 && n >= 2 && n <= 9)) {
        const resolved = resolveMonth(raw)
        if (resolved) {
          setParts(prev => { tryEmit(prev.day, resolved, prev.year); return { ...prev, month: resolved } })
          setTimeout(() => { yearRef.current?.focus(); yearRef.current?.select() }, 0)
          return
        }
      }
      setParts(prev => ({ ...prev, month: raw }))
      return
    }

    // Letter entry: match prefix against month names
    const display = raw ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : ''
    setParts(prev => ({ ...prev, month: display }))

    if (raw.length >= 3) {
      const resolved = resolveMonth(raw)
      if (resolved) {
        setParts(prev => { tryEmit(prev.day, resolved, prev.year); return { ...prev, month: resolved } })
        setTimeout(() => { yearRef.current?.focus(); yearRef.current?.select() }, 0)
      }
    }
  }

  function handleMonthKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const pos = e.currentTarget.selectionStart ?? 0
    if (e.key === 'Backspace' && !parts.month) {
      e.preventDefault(); dayRef.current?.focus()
    }
    if (e.key === 'ArrowLeft' && pos === 0) {
      e.preventDefault(); dayRef.current?.focus()
    }
    if (e.key === 'ArrowRight' && pos >= parts.month.length) {
      e.preventDefault(); yearRef.current?.focus(); yearRef.current?.select()
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      setParts(prev => { tryEmit(prev.day, '', prev.year); return { ...prev, month: '' } })
    }
  }

  // ── Year ──────────────────────────────────────────────────────────────────────
  function handleYearChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 4)
    setParts(prev => {
      if (raw.length === 4) tryEmit(prev.day, prev.month, raw)
      return { ...prev, year: raw }
    })
    if (raw.length === 4) {
      setTimeout(() => onBlur?.(), 0)
    }
  }

  function handleYearKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const pos = e.currentTarget.selectionStart ?? 0
    if (e.key === 'Backspace' && !parts.year) {
      e.preventDefault(); monthRef.current?.focus()
    }
    if (e.key === 'ArrowLeft' && pos === 0) {
      e.preventDefault(); monthRef.current?.focus()
    }
    if (e.key === 'Delete') {
      e.preventDefault()
      setParts(prev => { tryEmit(prev.day, prev.month, ''); return { ...prev, year: '' } })
    }
  }

  // ── Native calendar picker ────────────────────────────────────────────────────
  function openPicker() {
    if (disabled) return
    try { nativeRef.current?.showPicker() }
    catch { nativeRef.current?.click() }
  }

  function handleNativeChange(e: ChangeEvent<HTMLInputElement>) {
    const iso = e.target.value   // YYYY-MM-DD
    setParts(isoToParts(iso))
    onChange?.(iso)
  }

  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Only fire onBlur when focus leaves the whole component
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onBlur?.()
    }
  }

  // ── Styles ────────────────────────────────────────────────────────────────────
  const isInvalid = rest['aria-invalid']

  const segCls = cn(
    'bg-transparent outline-none text-center text-sm font-medium',
    'placeholder:text-muted-foreground/50',
    disabled && 'cursor-not-allowed',
  )

  return (
    <div
      onBlur={handleContainerBlur}
      className={cn(
        'flex h-10 w-full items-center gap-0.5 rounded-md border border-input bg-background px-3',
        'transition-colors duration-150',
        'hover:border-primary/40',
        'focus-within:ring-2 focus-within:ring-primary/50 focus-within:ring-offset-2 focus-within:border-primary',
        isInvalid && 'border-destructive focus-within:ring-destructive/30',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {/* DD */}
      <input
        ref={dayRef}
        id={id}
        type="text"
        inputMode="numeric"
        value={parts.day}
        onChange={handleDayChange}
        onKeyDown={handleDayKeyDown}
        placeholder="DD"
        maxLength={2}
        disabled={disabled}
        aria-label="Day"
        className={cn(segCls, 'w-6')}
      />

      <span className="select-none text-sm text-muted-foreground/50 pb-px">-</span>

      {/* MMM */}
      <input
        ref={monthRef}
        type="text"
        value={parts.month}
        onChange={handleMonthChange}
        onKeyDown={handleMonthKeyDown}
        placeholder="MMM"
        maxLength={3}
        disabled={disabled}
        aria-label="Month"
        className={cn(segCls, 'w-9')}
      />

      <span className="select-none text-sm text-muted-foreground/50 pb-px">-</span>

      {/* YYYY */}
      <input
        ref={yearRef}
        type="text"
        inputMode="numeric"
        value={parts.year}
        onChange={handleYearChange}
        onKeyDown={handleYearKeyDown}
        placeholder="YYYY"
        maxLength={4}
        disabled={disabled}
        aria-label="Year"
        className={cn(segCls, 'w-11')}
      />

      {/* Spacer + calendar icon */}
      <div className="ml-auto flex items-center pl-1">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={openPicker}
          aria-label="Open date picker"
          className="text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none"
        >
          <Calendar className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Hidden native input — used only for the calendar popup */}
      <input
        ref={nativeRef}
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={handleNativeChange}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
    </div>
  )
}
