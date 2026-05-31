import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const labelVariants = cva(
  // Base: size, weight, spacing
  'text-sm font-medium leading-none text-foreground ' +
  // Peer-disabled passthrough
  'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
  {
    variants: {
      /** Colourise the label to match field state */
      state: {
        default: '',
        error:   'text-destructive',
        success: 'text-success',
      },
    },
    defaultVariants: { state: 'default' },
  }
)

export interface LabelProps
  extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {
  /** Renders a red asterisk after the label text */
  required?: boolean
}

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, state, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants({ state }), className)}
    {...props}
  >
    {children}
    {required && (
      <span className="text-destructive ml-0.5 font-semibold" aria-hidden="true">
        *
      </span>
    )}
  </LabelPrimitive.Root>
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
