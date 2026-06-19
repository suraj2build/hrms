/**
 * PageHeader — standard page-level heading row.
 *
 * Renders an optional workspace breadcrumb, the page title, an optional
 * subtitle, and an optional right-aligned actions slot.
 *
 * Usage:
 *   <PageHeader
 *     breadcrumb={[{ label: 'Attendance' }, { label: 'Corrections' }]}
 *     title="Corrections"
 *     subtitle="Review and approve punch correction requests"
 *     actions={<Button size="sm">Export</Button>}
 *   />
 */

import * as React from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BreadcrumbItem {
  label: string
  /** If provided, renders as a link */
  href?: string
}

export interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Workspace breadcrumb rendered above the title */
  breadcrumb?: BreadcrumbItem[]
  /** Right-aligned slot — buttons, badges, anything */
  actions?: React.ReactNode
  /** Extra classes on the wrapper div */
  className?: string
}

export function PageHeader({ title, subtitle, breadcrumb, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {/* Left: breadcrumb + title + subtitle */}
      <div className="min-w-0">
        {/* Breadcrumb */}
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1 mb-1" aria-label="Breadcrumb">
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                )}
                {crumb.href ? (
                  <Link
                    to={crumb.href}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors leading-none"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-[11px] text-muted-foreground leading-none">
                    {crumb.label}
                  </span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}

        {/* Title with brand-gradient accent bar */}
        <div className="flex items-center gap-2.5">
          <span
            className="h-6 w-1 flex-shrink-0 rounded-full"
            style={{ background: 'var(--grad-primary)' }}
            aria-hidden
          />
          <h1 className="font-display text-2xl font-semibold leading-tight truncate text-foreground">
            {title}
          </h1>
        </div>

        {/* Subtitle */}
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5 pl-[14px]">{subtitle}</p>
        )}
      </div>

      {/* Right: actions */}
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          {actions}
        </div>
      )}
    </div>
  )
}
