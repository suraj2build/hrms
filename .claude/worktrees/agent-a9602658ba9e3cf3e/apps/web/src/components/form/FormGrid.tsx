import React from 'react'
import { cn } from '@/lib/utils'

export type FormGridCols = 1 | 2 | 3

export interface FormGridProps {
  cols?: FormGridCols
  children: React.ReactNode
  className?: string
}

const colsClassMap: Record<FormGridCols, string> = {
  1: 'grid grid-cols-1',
  2: 'grid grid-cols-1 sm:grid-cols-2 gap-4',
  3: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4',
}

export function FormGrid({ cols = 2, children, className }: FormGridProps) {
  return (
    <div className={cn(colsClassMap[cols], className)}>{children}</div>
  )
}
