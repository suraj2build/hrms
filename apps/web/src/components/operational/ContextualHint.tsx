/**
 * ContextualHint — inline operational guidance component (Phase 12)
 *
 * Renders a collapsible hint panel that provides in-context explanations
 * for thresholds, process flows, and operational concepts without
 * requiring a docs detour. Defaults to collapsed to avoid cluttering
 * the primary UI.
 *
 * Usage:
 *   <ContextualHint id="attendance-lop" title="What is LOP?" icon={HelpCircle}>
 *     Loss of Pay (LOP) deducts from gross salary for each absent day...
 *   </ContextualHint>
 */

import { useState }           from 'react'
import { HelpCircle, ChevronDown, ChevronUp, X, Info, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn }                 from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type HintVariant = 'info' | 'tip' | 'warning' | 'success'

interface ContextualHintProps {
  /** Stable unique ID used for localStorage persistence of open/closed state */
  id?:       string
  title:     string
  children:  React.ReactNode
  variant?:  HintVariant
  /** When true, renders inline (not collapsible) */
  inline?:   boolean
  /** Allows the user to permanently dismiss (stores in localStorage) */
  dismissible?: boolean
  className?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<HintVariant, {
  wrapper: string
  icon:    string
  title:   string
  border:  string
}> = {
  info: {
    wrapper: 'bg-info/5 border-info/20',
    icon:    'text-info',
    title:   'text-info',
    border:  'border-info/20',
  },
  tip: {
    wrapper: 'bg-primary/5 border-primary/20',
    icon:    'text-primary',
    title:   'text-primary',
    border:  'border-primary/20',
  },
  warning: {
    wrapper: 'bg-warning/5 border-warning/20',
    icon:    'text-warning',
    title:   'text-warning',
    border:  'border-warning/20',
  },
  success: {
    wrapper: 'bg-success/5 border-success/20',
    icon:    'text-success',
    title:   'text-success',
    border:  'border-success/20',
  },
}

const VARIANT_ICON: Record<HintVariant, React.ComponentType<{ className?: string }>> = {
  info:    Info,
  tip:     HelpCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
}

const DISMISS_KEY = (id: string) => `__hint_dismissed_${id}`

// ── Component ─────────────────────────────────────────────────────────────────

export function ContextualHint({
  id,
  title,
  children,
  variant  = 'info',
  inline   = false,
  dismissible = false,
  className,
}: ContextualHintProps) {
  const [open,    setOpen]    = useState(false)
  const [visible, setVisible] = useState(() => {
    if (!id || !dismissible) return true
    try { return localStorage.getItem(DISMISS_KEY(id)) !== 'true' } catch { return true }
  })

  const styles = VARIANT_STYLES[variant]
  const Icon   = VARIANT_ICON[variant]

  function dismiss() {
    setVisible(false)
    if (id) {
      try { localStorage.setItem(DISMISS_KEY(id), 'true') } catch { /* ignore */ }
    }
  }

  if (!visible) return null

  if (inline) {
    return (
      <div className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs',
        styles.wrapper, styles.border,
        className,
      )}>
        <Icon className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', styles.icon)} />
        <div className="flex-1 min-w-0">
          <span className={cn('font-semibold mr-1', styles.title)}>{title}</span>
          <span className="text-muted-foreground leading-relaxed">{children}</span>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={dismiss}
            className="ml-1 text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      'rounded-md border overflow-hidden transition-all',
      styles.wrapper, styles.border,
      className,
    )}>
      {/* Header — always visible, acts as toggle */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:opacity-80 transition-opacity"
      >
        <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', styles.icon)} />
        <span className={cn('font-semibold flex-1', styles.title)}>{title}</span>
        {dismissible && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); dismiss() }}
            className="text-muted-foreground/40 hover:text-muted-foreground mr-1"
            title="Dismiss permanently"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        {open
          ? <ChevronUp   className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />}
      </button>

      {/* Body — only visible when open */}
      {open && (
        <div className={cn(
          'px-3 pb-3 pt-1 text-xs text-muted-foreground leading-relaxed border-t',
          styles.border,
          'bg-black/[0.02]',
        )}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export function InfoHint(props: Omit<ContextualHintProps, 'variant'>) {
  return <ContextualHint {...props} variant="info" />
}

export function TipHint(props: Omit<ContextualHintProps, 'variant'>) {
  return <ContextualHint {...props} variant="tip" />
}

export function WarnHint(props: Omit<ContextualHintProps, 'variant'>) {
  return <ContextualHint {...props} variant="warning" />
}

// ── ProcessStepGuide: numbered step-by-step guide for complex workflows ────────

interface ProcessStep {
  step:    number
  label:   string
  detail?: string
  done?:   boolean
}

export function ProcessStepGuide({
  title,
  steps,
  className,
}: {
  title?:    string
  steps:     ProcessStep[]
  className?: string
}) {
  return (
    <div className={cn('rounded-md border border-border/40 bg-muted/20 p-3', className)}>
      {title && (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">{title}</p>
      )}
      <ol className="space-y-2">
        {steps.map(s => (
          <li key={s.step} className="flex items-start gap-2.5 text-xs">
            <span className={cn(
              'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5',
              s.done
                ? 'bg-success/20 text-success'
                : 'bg-primary/15 text-primary',
            )}>
              {s.done ? '✓' : s.step}
            </span>
            <div className="min-w-0">
              <span className={cn(
                'font-medium',
                s.done ? 'text-muted-foreground line-through' : 'text-foreground',
              )}>
                {s.label}
              </span>
              {s.detail && (
                <p className="text-muted-foreground/70 mt-0.5 leading-snug">{s.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
