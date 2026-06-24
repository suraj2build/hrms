# ESS / Manager design-consistency contract

The ESS and Manager surfaces are functionally rich; the goal of this contract is
a **consistent feel** across screens. New ESS/Manager screens — and any screen
being touched — must route through these canonical primitives instead of
hand-rolling equivalents. This is what "consistency, not rebuild" means.

## Canonical primitives (use these — do not re-implement)

| Concern            | Use                                                              | Notes |
|--------------------|-----------------------------------------------------------------|-------|
| Page wrapper       | `PageContainer` (`@/components/layout/PageContainer`)            | max-width + padding |
| Page heading       | `PageHeader` (`@/components/layout/PageHeader`)                  | accent-bar + `font-display text-2xl font-semibold`; pass `breadcrumb`/`subtitle`/`actions` |
| Section / card     | `SectionCard` (`@/components/layout/SectionCard`)                | one radius; `title`/`icon`/`action`/`noPadding` |
| KPI / stat tile    | `MetricCard` + `MetricRow` (`@/components/dashboard/MetricCard`) | the canonical stat tile — see below |
| Status pill        | `StatusBadge` (`@/components/ui/StatusBadge`)                    | — |

**Do not** introduce new stat-tile components (`StatCard`, bespoke
`KpiCard`/`StatusCard`/`StatTile`, ad-hoc `rounded-xl border bg-card` tiles).
The flagship ESS/Manager screens have been migrated onto `MetricCard`.

## KPI tile rules (`MetricCard`)

```tsx
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'

<MetricRow cols={4}>
  <MetricCard label="Present Today" value={present} icon={UserCheck}
              variant="success" subtitle={pct(present)} />
  …
</MetricRow>
```

- `variant` carries **semantic colour**, not ad-hoc classes:
  - present / positive / take-home / approved → `success`
  - absent / error / LOP → `destructive`
  - pending / late / awaiting / not-marked → `warning`
  - leave / informational / money-neutral → `info`
  - plain counts → `neutral`
- Use `compact` for dense secondary strips (e.g. a YTD summary); non-compact for
  a screen's primary KPI row.
- Numbers, currency (₹) and dates render with `tabular-nums` — never re-format
  away the existing helpers.

## Visual tokens

- Colours via tokens only (`--primary`, `--success`, `--warning`,
  `--destructive`, `--info`) — enforced by `scripts/check-raw-colors.mjs`.
  No raw `bg-amber-*` / hex in views.
- Status colour language: present=success(green), leave=info(blue),
  absent=destructive(red), pending=warning(amber), Attendance
  Regularisation=orange.
- Terminology: always **"Attendance Regularisation"**, never "correction".

## Employee vs Manager navigation

- Managers live in `ManagerShell` (`/manager/*`) and flip persona with the
  top-bar **Employee / Manager** toggle (`ManagerPersonaToggle`). Only the
  active persona's nav renders — the two are never stacked.
- Active persona is derived from the route (`/manager/self/*` = Employee, else
  Manager); the sidebar, toggle and URL stay in sync.
- Employee = primary (blue) accent; Manager = warning (amber) accent.
