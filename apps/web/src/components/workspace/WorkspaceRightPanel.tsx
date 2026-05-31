/**
 * WorkspaceRightPanel — collapsible right-side insight panel.
 *
 * Renders a bordered panel with a header and collapse toggle.
 * When collapsed it shrinks to a w-10 strip with a vertical rotated label.
 * Hidden entirely on mobile (lg:flex only).
 */

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkspaceRightPanelProps {
  title?:       string
  children:     React.ReactNode
  defaultOpen?: boolean
  width?:       number
  className?:   string
}

// ── Component ──────────────────────────────────────────────────────────────────

export const WorkspaceRightPanel = React.memo(function WorkspaceRightPanel({
  title       = 'Insights',
  children,
  defaultOpen = true,
  width       = 280,
  className,
}: WorkspaceRightPanelProps) {
  const [open, setOpen] = React.useState<boolean>(defaultOpen)

  function toggle(): void {
    setOpen((prev) => !prev)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  return (
    <aside
      aria-label={title}
      style={open ? { width: `${width}px` } : undefined}
      className={cn(
        'hidden lg:flex flex-col flex-shrink-0 border-l border-border bg-card overflow-y-auto',
        'transition-all duration-200',
        open ? 'min-w-0' : 'w-10',
        className,
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center border-b border-border flex-shrink-0',
          open ? 'px-4 py-3 justify-between' : 'px-0 py-3 justify-center',
        )}
      >
        {open && (
          <span className="text-sm font-medium text-foreground truncate">
            {title}
          </span>
        )}

        <button
          type="button"
          onClick={toggle}
          onKeyDown={handleKeyDown}
          aria-label={open ? `Collapse ${title} panel` : `Expand ${title} panel`}
          aria-expanded={open}
          className={cn(
            'flex items-center justify-center rounded-md h-6 w-6',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            'transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          )}
        >
          {open ? (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Body */}
      {open ? (
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      ) : (
        /* Collapsed: vertical label */
        <div className="flex-1 flex items-center justify-center overflow-hidden">
          <span
            aria-hidden="true"
            className={cn(
              'text-[10px] font-medium text-muted-foreground uppercase tracking-widest',
              'whitespace-nowrap',
              '-rotate-90',
            )}
          >
            {title}
          </span>
        </div>
      )}
    </aside>
  )
})

WorkspaceRightPanel.displayName = 'WorkspaceRightPanel'
