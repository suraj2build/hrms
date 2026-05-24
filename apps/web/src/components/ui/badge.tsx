import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ' +
  'transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2',
  {
    variants: {
      variant: {
        // ── Standard ─────────────────────────────────────────────────────
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline:
          'text-foreground border-border',

        // ── Status — use CSS var tokens so they adapt to dark mode ────────
        success:
          'border-transparent bg-success/15 text-success',
        warning:
          'border-transparent bg-warning/15 text-warning',
        info:
          'border-transparent bg-info/15 text-info',

        // ── Aurora Navy accent orbs ───────────────────────────────────────
        magenta:
          'border-transparent bg-accent-magenta/15 text-accent-magenta',
        coral:
          'border-transparent bg-accent-coral/15 text-accent-coral',
        amber:
          'border-transparent bg-accent-amber/15 text-accent-amber',
        teal:
          'border-transparent bg-accent-teal/15 text-accent-teal',
        violet:
          'border-transparent bg-accent-violet/15 text-accent-violet',
        sky:
          'border-transparent bg-accent-sky/15 text-accent-sky',

        // ── Legacy alias — kept for backward compatibility ─────────────────
        /** @deprecated Use `violet` instead */
        purple:
          'border-transparent bg-accent-violet/15 text-accent-violet',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
