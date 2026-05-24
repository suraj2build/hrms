/**
 * SectionCard — opinionated Card wrapper for page sections.
 *
 * Wraps Card + CardHeader (optional) + CardContent so callers never need to
 * repeat boilerplate header/content nesting. Supports all card variants.
 *
 * Usage:
 *   // With header
 *   <SectionCard
 *     title="Department Hierarchy"
 *     description="Drag to reorder"
 *     icon={<GitBranch className="h-4 w-4 text-muted-foreground" />}
 *     action={<Button size="sm">Add</Button>}
 *   >
 *     {children}
 *   </SectionCard>
 *
 *   // No header, no padding (for tables)
 *   <SectionCard noPadding>
 *     <table ...>...</table>
 *   </SectionCard>
 *
 *   // Glassmorphic card
 *   <SectionCard variant="glass" title="Quick Stats">...</SectionCard>
 */

import * as React from 'react'
import { Card, cardVariants, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export interface SectionCardProps extends VariantProps<typeof cardVariants> {
  /** Section title rendered in CardHeader */
  title?: string
  /** Section subtitle / help text */
  description?: string
  /** Small icon placed before the title */
  icon?: React.ReactNode
  /** Right-aligned slot inside the header row */
  action?: React.ReactNode
  /** Removes padding from CardContent (use for full-bleed tables) */
  noPadding?: boolean
  /** Extra classes on the Card root */
  className?: string
  /** Extra classes on CardContent */
  contentClassName?: string
  children: React.ReactNode
}

export function SectionCard({
  variant,
  title,
  description,
  icon,
  action,
  noPadding = false,
  className,
  contentClassName,
  children,
}: SectionCardProps) {
  const hasHeader = !!(title || description || action || icon)

  return (
    <Card variant={variant} className={className}>
      {hasHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: icon + text */}
            <div className="flex items-center gap-2 min-w-0">
              {icon}
              <div className="min-w-0">
                {title && (
                  <CardTitle className="text-sm font-semibold truncate">
                    {title}
                  </CardTitle>
                )}
                {description && (
                  <CardDescription className="mt-0.5 text-xs">
                    {description}
                  </CardDescription>
                )}
              </div>
            </div>
            {/* Right: action slot */}
            {action && <div className="flex-shrink-0">{action}</div>}
          </div>
        </CardHeader>
      )}

      <CardContent className={cn(noPadding && 'p-0', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
