/**
 * design-tokens.ts — Frozen design token constants for the HRIS design system.
 *
 * Use these tokens to ensure consistent spacing, typography, shadows, z-indices,
 * and status colour mappings across all workspace components.
 */

export const TOKENS = {
  spacing: {
    pageX:      'px-6',
    pageY:      'py-6',
    cardX:      'px-4',
    cardY:      'py-4',
    sectionGap: 'gap-4',
    kpiGap:     'gap-3',
  },
  radius: {
    card:  'rounded-lg',
    badge: 'rounded-full',
    btn:   'rounded-md',
  },
  shadow: {
    card:    'shadow-sm',
    panel:   'shadow-md',
    popover: 'shadow-lg',
  },
  zIndex: {
    base:    'z-0',
    raised:  'z-10',
    overlay: 'z-40',
    modal:   'z-50',
    toast:   'z-[9999]',
  },
  status: {
    success: {
      bg:     'bg-success  dark:bg-success/30',
      text:   'text-success  dark:text-success',
      border: 'border-success  dark:border-success',
      dot:    'bg-success',
    },
    warning: {
      bg:     'bg-warning  dark:bg-warning/30',
      text:   'text-warning  dark:text-warning',
      border: 'border-warning  dark:border-warning',
      dot:    'bg-warning',
    },
    danger: {
      bg:     'bg-destructive    dark:bg-destructive/30',
      text:   'text-destructive    dark:text-destructive',
      border: 'border-destructive    dark:border-destructive',
      dot:    'bg-destructive',
    },
    info: {
      bg:     'bg-info   dark:bg-info/30',
      text:   'text-info   dark:text-info',
      border: 'border-info   dark:border-info',
      dot:    'bg-info',
    },
    muted: {
      bg:     'bg-muted',
      text:   'text-muted-foreground',
      border: 'border-border',
      dot:    'bg-muted-foreground',
    },
    neutral: {
      bg:     'bg-background',
      text:   'text-foreground',
      border: 'border-border',
      dot:    'bg-foreground',
    },
  },
  typography: {
    pageTitle:    'text-xl font-semibold text-foreground',
    sectionTitle: 'text-sm font-medium text-foreground',
    kpiValue:     'text-2xl font-bold tabular-nums',
    kpiLabel:     'text-xs font-medium text-muted-foreground uppercase tracking-wide',
    tableHeader:  'text-xs font-medium text-muted-foreground uppercase tracking-wide',
    tableCell:    'text-sm text-foreground',
    caption:      'text-xs text-muted-foreground',
  },
} as const

export type StatusVariant = keyof typeof TOKENS.status
