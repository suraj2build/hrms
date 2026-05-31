/**
 * WorkspaceTabs — horizontal tab navigation bar.
 *
 * Enforces a maximum of 7 tabs (console.warn if exceeded).
 * Supports icons, badge counts, disabled state, and full
 * keyboard navigation (ArrowLeft / ArrowRight).
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceTab {
  key:       string
  label:     string
  icon?:     React.ReactNode
  badge?:    number | string
  disabled?: boolean
}

export interface WorkspaceTabsProps {
  tabs:       WorkspaceTab[]
  active:     string
  onChange:   (key: string) => void
  className?: string
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WorkspaceTabs({ tabs, active, onChange, className }: WorkspaceTabsProps) {
  const MAX_TABS = 7

  if (tabs.length > MAX_TABS) {
    console.warn(
      `[WorkspaceTabs] Received ${tabs.length} tabs — maximum is ${MAX_TABS}. ` +
      'Consider grouping tabs or using a nested navigation pattern.',
    )
  }

  // Track refs for keyboard focus management
  const tabRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const enabledIndexes = tabs
      .map((t, i) => (t.disabled ? -1 : i))
      .filter(i => i !== -1)

    const pos = enabledIndexes.indexOf(index)

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = enabledIndexes[(pos + 1) % enabledIndexes.length]
      tabRefs.current[next]?.focus()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = enabledIndexes[(pos - 1 + enabledIndexes.length) % enabledIndexes.length]
      tabRefs.current[prev]?.focus()
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Workspace tabs"
      className={cn('flex items-end border-b border-border gap-0', className)}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.key === active

        return (
          <button
            key={tab.key}
            ref={el => { tabRefs.current[index] = el }}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-disabled={tab.disabled}
            disabled={tab.disabled}
            tabIndex={isActive ? 0 : -1}
            onClick={() => !tab.disabled && onChange(tab.key)}
            onKeyDown={e => handleKeyDown(e, index)}
            className={cn(
              // Base
              'inline-flex items-center gap-1.5 px-3 pb-2.5 pt-2 text-sm font-medium',
              'border-b-2 -mb-px transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 rounded-t-sm',
              // Active
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              // Disabled
              tab.disabled && 'pointer-events-none opacity-40',
            )}
          >
            {/* Icon */}
            {tab.icon && (
              <span className="flex-shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">
                {tab.icon}
              </span>
            )}

            {/* Label */}
            <span>{tab.label}</span>

            {/* Badge */}
            {tab.badge !== undefined && tab.badge !== null && (
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full px-1.5 text-[9px] font-semibold leading-none min-w-[1rem] h-4',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
