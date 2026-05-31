# Aurora Navy — Design System Usage Guide

This document is the canonical reference for all design tokens, component variants, and layout primitives in the HRMS app. The companion typed file [`usage.ts`](./usage.ts) exports these rules as constants for IDE autocomplete.

---

## 1. Color Tokens

**Rule:** Never use raw Tailwind palette classes (`bg-blue-500`, `text-gray-700`, etc.).  
Always use semantic tokens from the table below. Run `npm run lint:colors` to verify.

### Text

| Token | Use case |
|---|---|
| `text-foreground` | Primary body text |
| `text-muted-foreground` | Secondary / helper text, placeholders, timestamps |
| `text-primary` | Brand-primary (violet) interactive / link text |
| `text-destructive` | Error messages, delete confirmations |
| `text-success` | Positive change indicators, active state labels |
| `text-warning` | Expiry alerts, on-notice labels |
| `text-info` | Informational text, department labels, counts |

### Backgrounds

| Token | Use case |
|---|---|
| `bg-background` | Page canvas |
| `bg-card` | Card / panel surface |
| `bg-muted` | Subtle secondary surface (skeleton loaders, dividers) |
| `bg-primary` | Primary brand fill (buttons, active indicators) |
| `bg-primary/20` | Tinted icon badge background |
| `bg-success/20` | Active state icon background |
| `bg-warning/10` | Alert banner background |
| `bg-destructive/10` | Error banner background |
| `bg-info/20` | Document / informational icon background |
| `bg-accent-violet/20` | New-joiner / primary-adjacent tint |
| `bg-accent-magenta/20` | HR / people category tint |
| `bg-accent-coral/20` | Separation / exit tint |
| `bg-accent-teal/20` | IT / access / tech tint |

### Borders

| Token | Use case |
|---|---|
| `border-border` | Default divider colour |
| `border-input` | Form field borders |
| `border-primary/50` | Highlighted or focused field border |
| `border-success/30` | Positive state indicator border |
| `border-warning/40` | Alert card border |
| `border-destructive/40` | Error card border |

### Shadows

| Token | Elevation |
|---|---|
| `shadow-elev-1` | Default cards (subtle lift) |
| `shadow-elev-2` | Dropdowns, popovers |
| `shadow-elev-3` | Stat cards, modals, drawers |
| `shadow-glow-violet` | Default button glow |
| `shadow-glow-magenta` | Magenta orb glow |
| `shadow-glow-teal` | Teal orb glow |
| `shadow-glow-coral` | Coral orb glow |
| `shadow-glow-soft` | Soft ambient hover glow |

---

## 2. Button Variants

Import: `import { Button } from '@/components/ui/button'`

| Variant | When to use | Example |
|---|---|---|
| `default` | Primary CTA — one per form/section | Save, Create Employee, Continue |
| `secondary` | Supportive action beside a primary button | Duplicate, Export PDF |
| `outline` | Tertiary / neutral — equal weight undesirable | Cancel, Back, Close, Export CSV |
| `ghost` | Icon-only controls, in-row table actions | Edit ✎, Delete 🗑, ⋯ |
| `destructive` | Irreversible actions — **always inside a confirm dialog** | Delete Department, Terminate Employee |
| `link` | Inline hyperlink-style text | Forgot password?, View all |
| `glass` | Buttons over gradient / hero backgrounds | ThemeToggle, notification bell |
| `accent` | Maximum-attention CTA — **one per page max** | Upgrade to Pro |
| `magenta` / `coral` / `teal` | Marketing / promo surfaces only | — |

**Sizes:**

| Size | Height | Use |
|---|---|---|
| `default` | h-10 | Standard form buttons |
| `sm` | h-9 | Toolbar / table header buttons |
| `lg` | h-11 | Hero / prominent CTAs |
| `pill` | h-10, rounded-full | Icon + label CTA |
| `icon` | h-10 w-10 | Square icon-only button |

---

## 3. Badge Variants

Import: `import { Badge } from '@/components/ui/badge'`  
Always add `rounded-full` for status and employment-type badges.

| Variant | Use case |
|---|---|
| `default` | Branded primary chip (feature tags) |
| `secondary` | Neutral supporting chip |
| `outline` | Subtle chip — no fill |
| `destructive` | Error or blocked state |
| `success` | Active, completed, healthy |
| `warning` | Expiring, on notice, pending |
| `info` | Informational, counts, neutral metadata |
| `violet` | New joiners, primary-adjacent categorisation |
| `magenta` | HR / People category |
| `coral` | Separations / exits |
| `amber` | Finance / payroll |
| `teal` | IT / tech / access |
| `sky` | Remote / location |

### Status → variant map

```ts
// Employee status
active    → 'success'
inactive  → 'secondary'
on_notice → 'warning'
separated → 'destructive'

// Employment type
permanent → 'info'
contract  → 'violet'
intern    → 'coral'
probation → 'warning'
```

---

## 4. Card Variants

Import: `import { Card } from '@/components/ui/card'`

| Variant | When to use | Example |
|---|---|---|
| `default` | Standard content surface — most cards | Filter bars, data tables, forms |
| `elevated` | Visually prominent panels — call out key info | KPI stat cards, featured content |
| `glass` | Over gradient / hero backgrounds **only** | Login card, modal overlays on hero |
| `orb` | Maximum-attention card — **one per page max** | Upgrade prompt, featured announcement |

For most cards use `SectionCard` (see Layout System) instead of composing Card + CardHeader manually.

---

## 5. Form Components

Import: `import { FormField, FormRow, FormSection, FormActions } from '@/components/forms'`

### FormField
Wraps a single control with label + optional description + error message.

```tsx
<FormField
  label="Work Email"
  htmlFor="email"
  required                                   // renders red * indicator + aria
  description="We'll use this to sign you in" // optional helper text
  error={errors.email?.message}              // from react-hook-form
>
  <Input id="email" type="email" {...register('email')} />
</FormField>
```

### FormRow
Responsive grid of 2–4 side-by-side fields. Collapses to 1 column on mobile.

```tsx
<FormRow cols={2}>
  <FormField label="First Name" htmlFor="first_name" required error={...}>
    <Input id="first_name" {...register('first_name')} />
  </FormField>
  <FormField label="Last Name" htmlFor="last_name" required error={...}>
    <Input id="last_name" {...register('last_name')} />
  </FormField>
</FormRow>
```

### FormSection
Groups related fields with an optional heading and description.

```tsx
<FormSection title="Personal Details" description="Basic biographical information">
  {/* FormField / FormRow children */}
</FormSection>
```

### FormActions
Right-aligned (or full-width) button row at the bottom of a form.

```tsx
<FormActions stretch>          {/* stretch → each button is flex-1 */}
  <Button variant="outline">Cancel</Button>
  <Button type="submit">Save Changes</Button>
</FormActions>
```

### Spacing contract

| Context | Class |
|---|---|
| Between label → control → hint/error | `space-y-1.5` |
| Between sibling FormFields | `space-y-4` |
| Between FormSection groups | `space-y-6` |
| Field height (Input, SelectTrigger) | `h-10` — do not override |

---

## 6. Layout System

Import: `import { PageContainer, PageHeader, SectionCard } from '@/components/layout'`

### AppShell
Provides `<main className="flex-1 overflow-y-auto p-6">`.  
**Do not** add additional top-level padding inside page components — the shell handles it.

### PageContainer

```tsx
<PageContainer size="narrow" spacing="normal">
  {/* page content */}
</PageContainer>
```

| Prop | Value | Max-width |
|---|---|---|
| `size` | `full` *(default)* | Unconstrained (dashboards, tables) |
| `size` | `medium` | max-w-4xl (settings, profile tabs) |
| `size` | `narrow` | max-w-2xl (add/edit forms, wizards) |

| Prop | Value | Gap |
|---|---|---|
| `spacing` | `normal` *(default)* | space-y-6 |
| `spacing` | `tight` | space-y-4 |
| `spacing` | `loose` | space-y-8 |

### PageHeader
Always the first child of `PageContainer`.

```tsx
<PageHeader
  title="People Directory"
  subtitle="456 employees · 12 filtered"
  actions={<Button>+ Add Employee</Button>}
/>
```

### SectionCard
Replaces the manual `Card + CardHeader + CardContent` pattern.

```tsx
<SectionCard
  title="Job Information"
  description="Current position and reporting structure"
  icon={<Briefcase className="h-4 w-4" />}
  action={<Button size="sm" variant="outline">Edit</Button>}
  noPadding   // for full-bleed tables inside the card
>
  {/* content */}
</SectionCard>
```

### Responsive grids

```tsx
// 4 KPI stat cards
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

// 3-column charts row
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

// 2-column form fields → use FormRow
<FormRow cols={2}>
```

---

## 7. Typography Scale

| Role | Classes | Used in |
|---|---|---|
| Page title | `text-xl font-semibold text-foreground` | `PageHeader` |
| Section title | `text-sm font-semibold text-foreground` | `SectionCard`, `CardTitle` |
| Body | `text-sm text-foreground` | Table cells, paragraphs |
| Secondary | `text-sm text-muted-foreground` | Page subtitles, helper text |
| Caption | `text-xs text-muted-foreground` | Dates, codes, secondary labels |
| Label | `text-sm font-medium text-foreground` | Form labels |
| Error | `text-xs text-destructive` | Validation messages |
| Hint | `text-xs text-muted-foreground` | Field description text |

Font: **Manrope** (loaded via Google Fonts). Features: `ss01` (alternate a), `cv11` (single-storey g).

---

## 8. Chart Utilities

Import: `import { CHART_PALETTE, getChartColor, getAxisStyle, getGridStyle, getTooltipStyle } from '@/components/ui/chart'`

Never inline `var(--color-*)` strings in chart JSX. Use these utilities instead.

```tsx
// Pie chart — color cells by employment type
<Cell fill={getChartColor(entry.type)} />

// Bar chart — axes, grid, tooltip
<CartesianGrid {...getGridStyle()} />
<XAxis dataKey="name" {...getAxisStyle()} />
<YAxis {...getAxisStyle()} />
<Tooltip contentStyle={getTooltipStyle()} />
```

### CHART_PALETTE keys

| Key | Token |
|---|---|
| `permanent` | `--color-info` |
| `contract` | `--color-accent-violet` |
| `intern` | `--color-accent-coral` |
| `probation` | `--color-warning` |
| `active` | `--color-success` |
| `inactive` | `--color-muted-foreground` |
| `on_notice` | `--color-warning` |
| `separated` | `--color-destructive` |
| `chart1`–`chart5` | Generic series colours |

Unknown keys fall back to `--color-muted-foreground`.

---

## 9. Lint Enforcement

Two complementary layers prevent raw palette classes from landing in the codebase.

### ESLint (`.eslintrc.cjs`)
Catches plain JSX string literals with raw colors at save time in your editor.

```bash
npm run lint       # ESLint + color scan
```

### Color scan script
Catches raw colors inside `cn()` calls, template literals, and any `.ts/.tsx` file.

```bash
npm run lint:colors   # standalone scan, exit 1 if violations found
```

The script skips `src/theme/` (this file) and `*.test.*` files.

### Adding to CI
```yaml
- run: npm run lint:colors
```

### Adding to pre-commit (husky)
```bash
npx husky add .husky/pre-commit "npm run lint:colors"
```
