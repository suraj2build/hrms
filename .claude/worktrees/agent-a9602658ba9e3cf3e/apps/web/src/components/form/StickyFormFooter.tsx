import React from 'react'
import { cn } from '@/lib/utils'

export interface StickyFormFooterProps {
  children: React.ReactNode
  className?: string
  elevated?: boolean
}

export function StickyFormFooter({
  children,
  className,
  elevated = false,
}: StickyFormFooterProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 bg-card border-t border-border mt-6 -mx-6 px-6 py-3',
        elevated && 'shadow-lg',
        className,
      )}
    >
      {children}
    </div>
  )
}
