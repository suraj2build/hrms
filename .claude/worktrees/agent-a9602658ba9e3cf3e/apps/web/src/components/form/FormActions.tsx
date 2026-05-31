import React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface FormAction {
  label: string
  onClick?: () => void
  type?: 'button' | 'submit'
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  loading?: boolean
  disabled?: boolean
  icon?: React.ComponentType<{ className?: string }>
}

export interface FormActionsProps {
  primary: FormAction
  secondary?: FormAction
  cancel?: FormAction
  sticky?: boolean
  align?: 'left' | 'right'
  className?: string
}

function ActionButton({
  action,
  variant,
}: {
  action: FormAction
  variant: 'default' | 'outline' | 'ghost' | 'destructive'
}) {
  const Icon = action.icon
  const resolvedVariant = action.variant ?? variant

  return (
    <Button
      type={action.type ?? 'button'}
      variant={resolvedVariant}
      onClick={action.onClick}
      disabled={action.disabled || action.loading}
      className="h-8 text-xs"
    >
      {action.loading && (
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
      )}
      {!action.loading && Icon && <Icon className="h-3.5 w-3.5 mr-1.5" />}
      {action.label}
    </Button>
  )
}

export function FormActions({
  primary,
  secondary,
  cancel,
  sticky = false,
  align = 'right',
  className,
}: FormActionsProps) {
  const inner = (
    <div
      className={cn(
        'flex items-center gap-2',
        align === 'right' ? 'justify-end' : 'justify-start',
        !sticky && 'pt-2',
        !sticky && className,
      )}
    >
      {cancel && <ActionButton action={cancel} variant="ghost" />}
      {secondary && <ActionButton action={secondary} variant="outline" />}
      <ActionButton action={primary} variant="default" />
    </div>
  )

  if (sticky) {
    return (
      <div
        className={cn(
          'sticky bottom-0 bg-card border-t border-border px-4 py-3 -mx-4 -mb-4',
          className,
        )}
      >
        {inner}
      </div>
    )
  }

  return inner
}
