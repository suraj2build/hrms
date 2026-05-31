/**
 * WorkspaceSectionCard — standard card container for workspace content sections.
 *
 * Supports an optional header with title, subtitle, and top-right action slot.
 * Can be made collapsible via the collapsible prop (animated max-height toggle).
 */

import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceSectionCardProps {
  title?:         string
  subtitle?:      string
  action?:        React.ReactNode
  children:       React.ReactNode
  loading?:       boolean
  collapsible?:   boolean
  defaultOpen?:   boolean
  className?:     string
  bodyClassName?: string
  noPadding?:     boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export const WorkspaceSectionCard = React.memo(function WorkspaceSectionCard({
  title,
  subtitle,
  action,
  children,
  loading      = false,
  collapsible  = false,
  defaultOpen  = true,
  className,
  bodyClassName,
  noPadding    = false,
}: WorkspaceSectionCardProps) {
  const [open, setOpen] = React.useState<boolean>(defaultOpen)
  const headerId         = React.useId()
  const bodyId           = React.useId()

  function toggle(): void {
    if (collapsible) setOpen((prev) => !prev)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  const hasHeader = Boolean(title || action)

  return (
    <section
      aria-labelledby={hasHeader && title ? headerId : undefined}
      className={cn(
        'rounded-lg border border-border bg-card shadow-sm',
        className,
      )}
    >
      {/* Card header */}
      {hasHeader && (
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {collapsible ? (
              <button
                type="button"
                id={headerId}
                onClick={toggle}
                onKeyDown={handleKeyDown}
                aria-expanded={open}
                aria-controls={bodyId}
                className={cn(
                  'flex items-center gap-1.5 text-left min-w-0 w-full',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm',
                )}
              >
                <span className="text-sm font-medium text-foreground truncate">
                  {title}
                </span>
                {open ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                )}
              </button>
            ) : (
              <div id={headerId} className="min-w-0">
                {title && (
                  <p className="text-sm font-medium text-foreground truncate">
                    {title}
                  </p>
                )}
                {subtitle && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            )}
            {/* Subtitle for collapsible (rendered outside button for accessibility) */}
            {collapsible && subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>

          {action && (
            <div className="flex-shrink-0 flex items-center gap-2">
              {action}
            </div>
          )}
        </div>
      )}

      {/* Card body */}
      <div
        id={hasHeader ? bodyId : undefined}
        role={collapsible ? 'region' : undefined}
        aria-labelledby={collapsible && title ? headerId : undefined}
        className={cn(
          'overflow-hidden transition-all duration-200',
          collapsible
            ? open
              ? 'max-h-[9999px] opacity-100'
              : 'max-h-0 opacity-0'
            : '',
        )}
      >
        <div
          className={cn(
            loading && 'animate-pulse',
            !noPadding && 'px-4 py-4',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </section>
  )
})

WorkspaceSectionCard.displayName = 'WorkspaceSectionCard'
