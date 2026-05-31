/**
 * PageContainer — root wrapper for every page rendered inside AppShell.
 *
 * Provides:
 *  - Consistent vertical rhythm (space-y-6) between major sections
 *  - Optional max-width constraint for form/settings pages
 *
 * Usage:
 *   // Standard page
 *   <PageContainer>
 *     <PageHeader title="People Directory" ... />
 *     <SectionCard ...>...</SectionCard>
 *   </PageContainer>
 *
 *   // Narrow form page (max-w-2xl)
 *   <PageContainer size="narrow">
 *     <PageHeader title="Add Employee" />
 *     ...
 *   </PageContainer>
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

const sizeMap = {
  /** Full available width */
  full:   '',
  /** ~42 rem — add/edit forms */
  narrow: 'max-w-2xl',
  /** ~56 rem — settings, detail pages */
  medium: 'max-w-4xl',
} as const

export interface PageContainerProps {
  /** Width constraint (default: 'full') */
  size?: keyof typeof sizeMap
  /** Vertical gap between sections (default: space-y-6) */
  spacing?: 'tight' | 'normal' | 'loose'
  /** Extra classes */
  className?: string
  children: React.ReactNode
}

const spacingMap = {
  tight:  'space-y-4',
  normal: 'space-y-6',
  loose:  'space-y-8',
}

export function PageContainer({
  size = 'full',
  spacing = 'normal',
  className,
  children,
}: PageContainerProps) {
  return (
    <div className={cn(spacingMap[spacing], sizeMap[size], className)}>
      {children}
    </div>
  )
}
