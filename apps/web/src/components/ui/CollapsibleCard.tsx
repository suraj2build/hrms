/**
 * CollapsibleCard
 *
 * A card with a clickable header that expands / collapses its content.
 * Uses the CSS-grid row-height trick for a smooth animation that works
 * regardless of content height (no max-height guessing).
 *
 * Features:
 *   • Animated expand / collapse (grid-template-rows)
 *   • ChevronDown rotation on state change
 *   • Optional badge (count or label)
 *   • Optional actions slot in the header
 *   • Optional localStorage persistence via storageKey
 *   • defaultOpen prop (ignored when storageKey is set and a value exists)
 *
 * Usage:
 *   <CollapsibleCard title="Payroll Components" defaultOpen icon={<DollarSign />}>
 *     <p>Content here</p>
 *   </CollapsibleCard>
 *
 *   <CollapsibleCard
 *     title="Upload History"
 *     storageKey="attendance-upload-history"
 *     badge={3}
 *     actions={<Button size="sm">Export</Button>}
 *   >
 *     …
 *   </CollapsibleCard>
 */

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CollapsibleCardProps {
  title: string
  /** Optional icon rendered left of the title */
  icon?: React.ReactNode
  /** Default open state (used when no storageKey or no stored value) */
  defaultOpen?: boolean
  /** Pass a unique string to persist open/closed state to localStorage */
  storageKey?: string
  /** Badge shown next to the title — number or short string */
  badge?: number | string
  /** Rendered right-aligned in the header, before the chevron */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Extra className on the inner content wrapper */
  contentClassName?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LS_PREFIX = 'hrms-cc:'

function readStorage(key: string): boolean | null {
  try {
    const val = localStorage.getItem(LS_PREFIX + key)
    if (val === null) return null
    return val === 'true'
  } catch {
    return null
  }
}

function writeStorage(key: string, open: boolean) {
  try {
    localStorage.setItem(LS_PREFIX + key, String(open))
  } catch {
    // silently ignore (private browsing / quota)
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CollapsibleCard({
  title,
  icon,
  defaultOpen = true,
  storageKey,
  badge,
  actions,
  children,
  className,
  contentClassName,
}: CollapsibleCardProps) {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (storageKey) {
      const stored = readStorage(storageKey)
      if (stored !== null) return stored
    }
    return defaultOpen
  })

  // Sync to localStorage whenever state changes
  useEffect(() => {
    if (storageKey) writeStorage(storageKey, isOpen)
  }, [isOpen, storageKey])

  function toggle() {
    setIsOpen((prev) => !prev)
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card shadow-sm overflow-hidden',
        className,
      )}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-left',
          'hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
        )}
        aria-expanded={isOpen}
      >
        {/* Icon */}
        {icon && (
          <span className="h-4 w-4 flex-shrink-0 text-muted-foreground flex items-center">
            {icon}
          </span>
        )}

        {/* Title */}
        <span className="flex-1 text-sm font-semibold text-foreground truncate">
          {title}
        </span>

        {/* Badge */}
        {badge !== undefined && badge !== 0 && badge !== '' && (
          <span className="text-[10px] bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold tabular-nums leading-none flex-shrink-0">
            {typeof badge === 'number' && badge > 99 ? '99+' : badge}
          </span>
        )}

        {/* Actions slot (stop propagation so clicks don't toggle card) */}
        {actions && (
          <span
            className="flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        )}

        {/* Chevron */}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform duration-200',
            isOpen ? 'rotate-0' : '-rotate-90',
          )}
        />
      </button>

      {/* ── Content — CSS grid expand trick ─────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.2s ease-in-out',
        }}
      >
        <div className="overflow-hidden">
          {/* Separator line between header and content */}
          {isOpen && <div className="border-t border-border" />}
          <div className={cn('px-4 py-4', contentClassName)}>{children}</div>
        </div>
      </div>
    </div>
  )
}
