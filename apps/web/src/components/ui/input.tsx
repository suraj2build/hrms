import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Layout & typography
          'flex h-10 w-full rounded-md text-sm',
          // Spacing
          'px-3 py-2',
          // Surface & border
          'border border-input bg-background text-foreground',
          // Placeholder
          'placeholder:text-muted-foreground',
          // Smooth transitions
          'transition-colors duration-150',
          // Hover — subtle primary tint on border
          'hover:border-primary/40',
          // Focus — primary ring, no double-outline
          'focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2',
          'focus-visible:border-primary',
          // File inputs
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          // Disabled
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Error state — set aria-invalid="true" on the element
          'aria-invalid:border-destructive',
          'aria-invalid:focus-visible:ring-destructive/30',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
