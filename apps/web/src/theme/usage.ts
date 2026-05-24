/**
 * ═══════════════════════════��═══════════════════════════════════════════════
 *  Aurora Navy — Design System Usage Guide
 *  src/theme/usage.ts
 *
 *  This file is the canonical reference for when and how to use every
 *  design token, component variant, and layout primitive in the HRMS app.
 *
 *  Import the typed constants below to get IDE autocomplete when
 *  picking variants programmatically (e.g. status → badge variant maps).
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────���─────────────────────────────────────────────────────
// BUTTON VARIANTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * variant: 'default'
 *   → Primary CTAs. Use for the single most important action per screen.
 *   → Gradient primary fill + glow-soft shadow.
 *   → Examples: "Save", "Create Employee", "Continue"
 *
 * variant: 'secondary'
 *   → Supportive actions that sit beside a primary button.
 *   → Examples: "Duplicate", "Export to PDF"
 *
 * variant: 'outline'
 *   → Tertiary or neutral actions.
 *   → Use when equal visual weight with a "default" CTA is unwanted.
 *   → Examples: "Cancel", "Back", "Close", "Export CSV"
 *
 * variant: 'ghost'
 *   → Icon-only controls and in-row action buttons.
 *   → No background until hover — blends into table/card surfaces.
 *   → Examples: Edit icon button, Delete icon button, row actions
 *
 * variant: 'destructive'
 *   → Irreversible destructive actions; always shown inside a confirm dialog.
 *   → Never use outside a confirmation context.
 *   → Examples: "Delete Department", "Terminate Employee"
 *
 * variant: 'link'
 *   → Inline text links that look like hyperlinks.
 *   → Examples: "Forgot password?", "View all"
 *
 * variant: 'glass'
 *   → Frosted glassmorphic surface buttons.
 *   → Use on hero/banner backgrounds or over gradient surfaces.
 *   → Examples: ThemeToggle, notification bell
 *
 * variant: 'accent'
 *   → Orb-ring animated CTA — draws maximum visual attention.
 *   → One per page maximum. Use for high-value onboarding or upgrade CTAs.
 *   → Examples: "Upgrade to Pro", "Start Free Trial"
 *
 * variant: 'magenta' | 'coral' | 'teal'
 *   → Accent orb buttons. Use sparingly in marketing/promo surfaces.
 *   → Each colour is used consistently with its semantic domain.
 *
 * size: 'default'  → Standard form buttons (h-10)
 * size: 'sm'       → Toolbar / table header buttons (h-9)
 * size: 'lg'       → Hero / prominent CTAs (h-11)
 * size: 'pill'     → Round-corner CTA with icon + label (h-10, rounded-full)
 * size: 'icon'     → Square icon-only button (h-10 w-10)
 */
export const BUTTON_USAGE = {
  default:     'Primary CTA — one per section/form',
  secondary:   'Supportive action beside default',
  outline:     'Tertiary / neutral — cancel, back, export',
  ghost:       'Icon buttons, row actions, toolbar',
  destructive: 'Irreversible actions inside confirm dialogs only',
  link:        'Inline hyperlink-style navigation',
  glass:       'Buttons over gradient / hero backgrounds',
  accent:      'Max-attention CTA — one per page',
  magenta:     'Marketing / promo surface only',
  coral:       'Marketing / promo surface only',
  teal:        'Marketing / promo surface only',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// BADGE VARIANTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Use Badge components for small metadata labels and status chips.
 *
 * variant: 'default'   → Branded primary chip (e.g. feature tags)
 * variant: 'secondary' → Neutral supporting chip
 * variant: 'outline'   → Subtle chip — no fill, just border
 * variant: 'destructive'→ Error or blocked state
 *
 * Status variants — always use these for domain-specific statuses:
 * variant: 'success'   → Active, completed, healthy states
 * variant: 'warning'   → Expiring, on notice, pending states
 * variant: 'info'      → Informational, counts, neutral metadata
 *
 * Accent orb variants — for decorative categorisation only:
 * variant: 'violet'    → New joiners, primary-adjacent categorisation
 * variant: 'magenta'   → HR / People category
 * variant: 'coral'     → Separations / exits
 * variant: 'amber'     → Finance / payroll
 * variant: 'teal'      → IT / tech / access
 * variant: 'sky'       → Remote / location
 *
 * @deprecated 'purple' → use 'violet' instead
 *
 * Always add `rounded-full` on status + employment-type badges for pill shape.
 */
export const BADGE_USAGE = {
  // Status domain → badge variant mapping used throughout the app
  employeeStatus: {
    active:    'success',
    inactive:  'secondary',
    on_notice: 'warning',
    separated: 'destructive',
  },
  employmentType: {
    permanent: 'info',
    contract:  'violet',
    intern:    'coral',
    probation: 'warning',
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// CARD VARIANTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * variant: 'default'
 *   → Standard content surfaces. Use for the majority of cards.
 *   → bg-card + border + shadow-elev-1 (subtle lift)
 *   → Examples: filter bars, data tables, form containers
 *
 * variant: 'elevated'
 *   → Visually prominent panels. Use to call out key information.
 *   → Same surface as default but shadow-elev-3 (deeper)
 *   → Examples: stat cards on dashboard, featured content
 *
 * variant: 'glass'
 *   → Glassmorphic frosted surface. Use over gradient backgrounds only.
 *   → backdrop-blur + color-mix surface — requires a colourful background
 *   → Examples: modal overlays on hero, floating sidebars, login card
 *
 * variant: 'orb'
 *   → Animated conic-gradient border ring. Use for high-priority CTAs
 *   → or highlighted content that needs visual differentiation.
 *   → One per page maximum. Avoid in data-dense tables.
 *   → Examples: upgrade prompt card, featured announcement
 */
export const CARD_USAGE = {
  default:  'Standard content surfaces — most cards',
  elevated: 'KPI stat cards, featured content blocks',
  glass:    'Over gradient/hero backgrounds only',
  orb:      'Max-attention card — one per page',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR TOKEN RULES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * NEVER use raw Tailwind palette classes (bg-blue-500, text-red-400, etc.).
 * ALWAYS use semantic tokens from the Aurora Navy system below.
 *
 * ── Text ──────────────────────��─────────────────────────────────���───────────
 * text-foreground          Primary text
 * text-muted-foreground    Secondary / helper text, placeholders, labels
 * text-primary             Brand-primary (violet) interactive text
 * text-destructive         Error messages, delete confirmations
 * text-success             Positive change indicators, active states
 * text-warning             Expiry alerts, on-notice states
 * text-info                Informational text, department labels
 *
 * ── Backgrounds ─────────────────────────────────────────────────────────────
 * bg-background            Page canvas
 * bg-card                  Card / panel surfaces
 * bg-muted                 Subtle secondary surface (skeleton loaders, dividers)
 * bg-primary               Primary brand fill
 * bg-primary/[opacity]     Tinted fill (e.g. bg-primary/20 for icon badges)
 * bg-success/[opacity]     e.g. bg-success/20 for active state icon bg
 * bg-warning/[opacity]     e.g. bg-warning/10 for alert banners
 * bg-destructive/[opacity] e.g. bg-destructive/10 for error banners
 * bg-info/[opacity]        e.g. bg-info/20 for document icon bg
 *
 * Accent orbs — decorative only, not semantic:
 * bg-accent-violet/[opacity] | text-accent-violet
 * bg-accent-magenta/[opacity] | text-accent-magenta
 * bg-accent-coral/[opacity]  | text-accent-coral
 * bg-accent-amber/[opacity]  | text-accent-amber
 * bg-accent-teal/[opacity]   | text-accent-teal
 * bg-accent-sky/[opacity]    | text-accent-sky
 *
 * ── Borders ─────────────────────────────────────────────────────────────────
 * border-border            Default divider colour
 * border-input             Form field borders
 * border-primary/[opacity] Highlighted field borders (on focus, info boxes)
 * border-success/[opacity] Positive state indicators
 * border-warning/[opacity] Alert card borders
 * border-destructive/[opacity] Error card borders
 *
 * ── Shadows ─────────────────────────────────────────────────────────────────
 * shadow-elev-1   Subtle card lift (default cards)
 * shadow-elev-2   Mid elevation (dropdowns, popovers)
 * shadow-elev-3   High elevation (stat cards, modals, drawers)
 * shadow-glow-violet  Violet orb glow (default button)
 * shadow-glow-magenta Magenta orb glow
 * shadow-glow-teal    Teal orb glow
 * shadow-glow-coral   Coral orb glow
 * shadow-glow-soft    Soft ambient glow (default button hover)
 */
export const COLOR_RULES = {
  /** Map from domain concept → token (use in new components) */
  semantic: {
    primaryText:       'text-foreground',
    secondaryText:     'text-muted-foreground',
    errorText:         'text-destructive',
    successText:       'text-success',
    warningText:       'text-warning',
    infoText:          'text-info',
    pageBg:            'bg-background',
    cardBg:            'bg-card',
    mutedBg:           'bg-muted',
    inputBorder:       'border-input',
    dividerBorder:     'border-border',
  },
  /** Tinted icon/badge backgrounds — use /20 opacity */
  tintedBg: {
    success:     'bg-success/20',
    warning:     'bg-warning/20',
    destructive: 'bg-destructive/20',
    info:        'bg-info/20',
    primary:     'bg-primary/20',
    violet:      'bg-accent-violet/20',
    magenta:     'bg-accent-magenta/20',
    coral:       'bg-accent-coral/20',
    teal:        'bg-accent-teal/20',
  },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// FORM COMPONENT RULES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Always use the form primitives from src/components/forms/ — never hand-roll
 * label + input + error combos inline.
 *
 * FormField         → wraps a single control with label + error + description
 * FormRow           → responsive grid for 2–4 side-by-side fields
 * FormSection       → groups related fields with an optional heading
 * FormActions       → right-aligned (or stretched) button row
 *
 * Rules:
 * - Always pass `htmlFor` matching the control's `id`
 * - Always pass `required` on mandatory fields (renders * indicator + sets aria)
 * - Always pass `error` from react-hook-form `formState.errors.fieldName?.message`
 * - Use `description` for helper text that should show when there is no error
 *
 * Spacing contract:
 * - Space between fields:     gap-4 (FormRow) / space-y-4 (vertical stacks)
 * - Space inside a FormField: space-y-1.5 (label → control → hint/error)
 * - Form within a CardContent: the form root uses className="space-y-4"
 *
 * Field height: h-10 (Input, SelectTrigger) — do not override
 */
export const FORM_RULES = {
  fieldSpacing:   'space-y-1.5',   // within a single FormField
  formSpacing:    'space-y-4',     // between sibling fields
  sectionSpacing: 'space-y-6',     // between FormSection groups
  fieldHeight:    'h-10',          // Input + SelectTrigger — do not override
} as const

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT RULES
// ─────────────────────────────────────────────────────────────────────────────
/**
 * AppShell provides:  `<main className="flex-1 overflow-y-auto p-6">`
 * → All page content receives 24px (p-6) padding from the shell.
 * → Do NOT add additional padding on PageContainer — the shell provides it.
 *
 * PageContainer
 *   size="full"    → Default. Full available width (dashboards, tables).
 *   size="medium"  → max-w-4xl. Settings, employee profile tabs.
 *   size="narrow"  → max-w-2xl. Add/Edit forms, single-column wizards.
 *   spacing="normal" → space-y-6 (default between sections)
 *   spacing="tight"  → space-y-4 (compact pages, modals)
 *   spacing="loose"  → space-y-8 (marketing-style landing sections)
 *
 * PageHeader
 *   → Always the first child of PageContainer.
 *   → Use `actions` prop for right-side buttons.
 *   → title: text-xl font-semibold (enforced by component)
 *
 * SectionCard
 *   → Replaces manual Card + CardHeader + CardContent boilerplate.
 *   → Use `noPadding` for full-bleed tables.
 *   → Use `icon` slot for the 4px title icon (text-muted-foreground h-4 w-4).
 *   → Use `action` slot for Add / Create buttons in the header.
 *
 * Responsive grid:
 *   - 4-stat KPI row:   grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4
 *   - 3-col charts:     grid-cols-1 lg:grid-cols-3 gap-4
 *   - 2-col form fields: use <FormRow cols={2}> — collapses on mobile
 */
export const LAYOUT_RULES = {
  pageGutter: 'p-6',          // provided by AppShell — do not duplicate
  sectionGap: 'space-y-6',    // PageContainer default
  gridGap:    'gap-4',        // standard grid gutter
} as const

// ─────────────────────────────────────────────────────────────────────────────
// TYPOGRAPHY SCALE
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Page title:     text-xl font-semibold   (PageHeader)
 * Section title:  text-sm font-semibold   (SectionCard, CardTitle)
 * Body:           text-sm                 (table cells, form labels, paragraphs)
 * Caption:        text-xs                 (secondary labels, dates, codes)
 * Micro:          text-[10px]             (badge text, mini labels)
 *
 * Font: Manrope (loaded via Google Fonts in index.html)
 * Features: ss01 (alternate a), cv11 (single-storey g)
 */
export const TYPOGRAPHY = {
  pageTitle:    'text-xl font-semibold text-foreground',
  sectionTitle: 'text-sm font-semibold text-foreground',
  body:         'text-sm text-foreground',
  secondary:    'text-sm text-muted-foreground',
  caption:      'text-xs text-muted-foreground',
  label:        'text-sm font-medium text-foreground',
  error:        'text-xs text-destructive',
  hint:         'text-xs text-muted-foreground',
} as const
