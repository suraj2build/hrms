/**
 * WorkspaceHeader — page-level header with title, subtitle, breadcrumbs,
 * optional right-side actions slot, and operational context chips.
 *
 * Breadcrumbs are hidden on mobile (shown from sm breakpoint).
 * Context chips row renders only when at least one chip prop is populated.
 */

import * as React from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BreadcrumbEntry {
  label: string
  href?: string
}

export interface WorkspaceHeaderProps {
  title:        string
  subtitle?:    string
  breadcrumbs?: BreadcrumbEntry[]
  actions?:     React.ReactNode
  className?:   string
  // Operational context chips (all optional)
  activeMonth?:        string                                      // YYYY-MM
  pendingCount?:       number                                      // amber chip if > 0
  operationalStatus?:  'healthy' | 'warning' | 'critical' | null
  contextLabel?:       string                                      // e.g. selected employee name
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatMonth(month: string): string {
  const d = new Date(month.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Component ──────────────────────────────────────────────────────────────────

export const WorkspaceHeader = React.memo(function WorkspaceHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  className,
  activeMonth,
  pendingCount,
  operationalStatus,
  contextLabel,
}: WorkspaceHeaderProps) {
  const hasChips =
    Boolean(activeMonth) ||
    Boolean(contextLabel) ||
    (pendingCount !== undefined && pendingCount > 0) ||
    (operationalStatus !== undefined && operationalStatus !== null)

  return (
    <header
      className={cn(
        'px-6 pt-5 pb-3 border-b border-border bg-background',
        className,
      )}
    >
      {/* Breadcrumbs — hidden on mobile */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="hidden sm:flex items-center gap-1 mb-2"
        >
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1
            return (
              <React.Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="text-xs text-muted-foreground select-none"
                  >
                    /
                  </span>
                )}
                {isLast || !crumb.href ? (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className="text-xs text-muted-foreground"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <a
                    href={crumb.href}
                    className={cn(
                      'text-xs text-muted-foreground',
                      'hover:text-foreground transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm',
                    )}
                  >
                    {crumb.label}
                  </a>
                )}
              </React.Fragment>
            )
          })}
        </nav>
      )}

      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground leading-snug truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Operational context chips row */}
      {hasChips && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {activeMonth && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {formatMonth(activeMonth)}
            </span>
          )}

          {contextLabel && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5">
              <User className="h-3 w-3" aria-hidden="true" />
              {contextLabel}
            </span>
          )}

          {pendingCount !== undefined && pendingCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-full px-2.5 py-0.5 border border-amber-200 dark:border-amber-800">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {pendingCount} pending
            </span>
          ) : null}

          {operationalStatus === 'warning' && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-full px-2.5 py-0.5 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Needs attention
            </span>
          )}

          {operationalStatus === 'critical' && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-full px-2.5 py-0.5 border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Critical issues
            </span>
          )}

          {operationalStatus === 'healthy' && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 rounded-full px-2.5 py-0.5 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              All clear
            </span>
          )}
        </div>
      )}
    </header>
  )
})

WorkspaceHeader.displayName = 'WorkspaceHeader'
