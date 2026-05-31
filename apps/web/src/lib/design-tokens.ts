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
      bg:     'bg-green-50  dark:bg-green-950/30',
      text:   'text-green-700  dark:text-green-400',
      border: 'border-green-200  dark:border-green-800',
      dot:    'bg-green-500',
    },
    warning: {
      bg:     'bg-amber-50  dark:bg-amber-950/30',
      text:   'text-amber-700  dark:text-amber-400',
      border: 'border-amber-200  dark:border-amber-800',
      dot:    'bg-amber-500',
    },
    danger: {
      bg:     'bg-red-50    dark:bg-red-950/30',
      text:   'text-red-700    dark:text-red-400',
      border: 'border-red-200    dark:border-red-800',
      dot:    'bg-red-500',
    },
    info: {
      bg:     'bg-blue-50   dark:bg-blue-950/30',
      text:   'text-blue-700   dark:text-blue-400',
      border: 'border-blue-200   dark:border-blue-800',
      dot:    'bg-blue-500',
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
