/**
 * FormField — standard field wrapper for the Aurora Navy design system.
 *
 * Composes: Label + form control (passed as children) + optional hint + error.
 * Automatically sets aria-invalid on the first child input/select when `error` is present.
 *
 * Usage:
 *   <FormField label="Work Email" htmlFor="email" error={errors.email?.message} required>
 *     <Input id="email" type="email" {...register('email')} />
 *   </FormField>
 *
 *   // Two-column row
 *   <FormRow cols={2}>
 *     <FormField label="First Name" htmlFor="first_name" required>
 *       <Input id="first_name" {...register('first_name')} />
 *     </FormField>
 *     <FormField label="Last Name" htmlFor="last_name" required>
 *       <Input id="last_name" {...register('last_name')} />
 *     </FormField>
 *   </FormRow>
 */

import * as React from 'react'
import { AlertCircle, Info } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// FormField
// ─────────────────────────────────────────────────────────────────────────────

export interface FormFieldProps {
  /** Label text rendered above the control */
  label?: string
  /** The `id` the label `for` attribute points at */
  htmlFor?: string
  /** Small hint displayed below the control (hidden when error is shown) */
  description?: string
  /** Validation error message — renders below the control in red */
  error?: string
  /** Appends a required asterisk (*) to the label */
  required?: boolean
  /** Extra classes on the outermost wrapper div */
  className?: string
  children: React.ReactNode
}

export function FormField({
  label,
  htmlFor,
  description,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Label row */}
      {label && (
        <Label
          htmlFor={htmlFor}
          state={error ? 'error' : 'default'}
          required={required}
        >
          {label}
        </Label>
      )}

      {/* Control — passes aria-invalid when there is an error */}
      <FieldControl hasError={!!error}>{children}</FieldControl>

      {/* Hint (hidden when showing error) */}
      {description && !error && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
          {description}
        </p>
      )}

      {/* Error */}
      {error && (
        <p role="alert" className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FieldControl — injects aria-invalid onto native input / select / textarea
// ─────────────────────────────────────────────────────────────────────────────

interface FieldControlProps {
  hasError: boolean
  children: React.ReactNode
}

function FieldControl({ hasError, children }: FieldControlProps) {
  if (!hasError) return <>{children}</>

  // Recursively clone the first-level child to inject aria-invalid
  const child = React.Children.only(children) as React.ReactElement<
    React.HTMLAttributes<HTMLElement> & { 'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' }
  >
  return React.cloneElement(child, { 'aria-invalid': true })
}

// ─────────────────────────────────────────────────────────────────────────────
// FormRow — responsive grid wrapper for multi-column field layouts
// ─────────────────────────────────────────────────────────────────────────────

export interface FormRowProps {
  /** Number of columns at ≥ sm breakpoint (default 2) */
  cols?: 2 | 3 | 4
  /** Extra classes */
  className?: string
  children: React.ReactNode
}

const colsClass: Record<NonNullable<FormRowProps['cols']>, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
}

export function FormRow({ cols = 2, className, children }: FormRowProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-4', colsClass[cols], className)}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FormSection — groups fields with an optional section heading
// ─────────────────────────────────────────────────────────────────────────────

export interface FormSectionProps {
  title?: string
  description?: string
  className?: string
  children: React.ReactNode
}

export function FormSection({ title, description, className, children }: FormSectionProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {(title || description) && (
        <div>
          {title && (
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          )}
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FormActions — right-aligned button row at the bottom of a form
// ─────────────────────────────────────────────────────────────────────────────

export interface FormActionsProps {
  className?: string
  /** Stretch buttons to fill available width (flex-1 on each) */
  stretch?: boolean
  children: React.ReactNode
}

export function FormActions({ stretch, className, children }: FormActionsProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        stretch ? 'w-full [&>*]:flex-1' : 'justify-end',
        className
      )}
    >
      {children}
    </div>
  )
}
