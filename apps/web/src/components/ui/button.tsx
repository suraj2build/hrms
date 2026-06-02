import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold ' +
  'transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // ── Core ─────────────────────────────────────────────────────────
        // Primary action = brand gradient (green → teal → blue)
        default:
          'bg-gradient-to-r from-[#10B981] via-[#0D9488] to-[#2563EB] text-white shadow-sm ' +
          'hover:brightness-[1.08] active:brightness-95 transition-[filter,box-shadow]',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80',
        outline:
          'border border-input bg-background text-foreground hover:bg-muted active:bg-muted/80',
        ghost:
          'text-foreground/70 hover:bg-muted hover:text-foreground',
        link:
          'text-primary underline-offset-4 hover:underline p-0 h-auto',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',

        // ── Semantic ──────────────────────────────────────────────────────
        success:
          'bg-success text-success-foreground shadow-sm hover:bg-success/90',
        warning:
          'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90',

        // ── Legacy Aurora aliases — kept for backward compat ─────────────
        glass:   'bg-card border border-border text-foreground hover:bg-muted',
        accent:  'bg-gradient-to-r from-[#10B981] via-[#0D9488] to-[#2563EB] text-white shadow-sm hover:brightness-[1.08] active:brightness-95',
        magenta: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        coral:   'bg-warning text-warning-foreground hover:bg-warning/90',
        teal:    'bg-info text-info-foreground hover:bg-info/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-7 rounded-md px-3 text-xs',
        lg:      'h-10 rounded-md px-6',
        pill:    'h-9 rounded-full px-5',
        icon:    'h-9 w-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size:    'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
