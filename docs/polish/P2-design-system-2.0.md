# P2 — Design System 2.0 (Foundation)

**Program:** Emvora Product Polish (Feature Complete → Enterprise Premium)
**Phase:** P2 of P7
**Status:** Shipped (foundation pass)
**Constraints honored:** No schema · No API redesign · No business logic · No workflow · No payroll behavior · No RBAC · No RLS changes.

---

## The core finding: brand drift

Emvora's design system migrated from a **teal `#0D9488`** brand (v3, "Manrope / 16px radius") to the current **navy `#1A4D8F`** brand ("Inter / 12px radius") — but the migration was never finished. The result was a product that rendered **two brand colors at once**:

| Surface | Rendered as | Should be |
|---|---|---|
| Sidebar, top nav, buttons, badges, Insights Hub | **Navy** `#1A4D8F` | Navy ✓ |
| Operational queues, tables, pills, selected rows, focus rings, "processing" shimmer, lane accents | **Teal** `#0D9488` | Navy ✗ |

A user moving from the directory (navy) into an operations queue (teal) saw the accent color change for no reason — the classic "powerful but feels stitched together" tell. The stale header comment still described the *teal / Manrope / 16px* system that no longer existed.

### Quantified
- **24 hardcoded teal values** across the `.op-*` operational utility classes in `index.css`:
  - 6 × `#0D9488`, 12 × `rgba(13,148,136,…)`, 4 × `rgba(236,253,245,…)` (teal tint), 1 × `#ECFDF5`, 1 × `#5EEAD4`.
- Misleading comments: "teal glow", "violet tint", "green → teal → blue" describing surfaces that no longer matched.
- Dark mode `--accent-teal` still resolved to real teal while **light mode already remapped it to navy** — so the `teal` badge/accent variant changed color between themes.
- `tailwind.config.ts` referenced a non-existent `--sidebar-background` variable (actual var: `--sidebar`).

---

## What changed (After)

### 1. Token & color unification — one navy accent everywhere
Every operational teal value was remapped to the navy primary:
- `#0D9488` → `#1A4D8F`
- `rgba(13,148,136,x)` → `rgba(26,77,143,x)` (navy at the same opacity)
- `rgba(236,253,245,x)` / `#ECFDF5` → `rgba(235,243,252,x)` / `#EBF3FC` (navy-soft tint = existing `--secondary`)
- `#5EEAD4` hover border → `#A9C5E8` (navy-soft)
- Dark-mode `--accent-teal` → light-navy, matching light mode's existing navy remap (consistent across themes).

Pure **color** swaps at identical opacity/role — **zero layout, spacing, or structural change**. Operational surfaces now read as the same product as the rest of Emvora.

### 2. Component primitives
- **New `interactive` Card variant** — clickable cards get a consistent hover-lift (`-translate-y-0.5` + elevation step) and a keyboard `focus-visible` ring. Additive: existing `default` / `elevated` / `glass` / `orb` variants are untouched.
- **Badge focus** moved from `focus:` to `focus-visible:` — focus rings now appear only on keyboard navigation, not on mouse click (premium a11y detail).
- Buttons already standardized (navy gradient default, semantic `success` / `warning` / `destructive`, consistent `focus-visible` ring, sizes `sm`/`default`/`lg`/`pill`/`icon`) — verified, comment corrected from "green → teal → blue" to "navy → azure".

### 3. Documentation accuracy
- Header comment rewritten to describe the **real** system (navy / Inter / 12px / single navy accent).
- Inline comments corrected (teal/violet → navy) so the next engineer isn't misled.

### Density & spacing — verified, no change needed
The existing `data-density` system (`comfortable` / `compact` / `dense`) already drives page padding, table cell padding, and op-row padding consistently via `index.css` utilities. It is coherent and was left intact.

---

## Files changed

| File | Change |
|---|---|
| `src/index.css` | 24 teal values → navy; header + inline comments corrected; dark `--accent-teal` aligned to navy. |
| `tailwind.config.ts` | Fixed dead `--sidebar-background` → `--sidebar`. |
| `components/ui/card.tsx` | Added `interactive` variant. |
| `components/ui/badge.tsx` | `focus:` → `focus-visible:`. |
| `components/ui/button.tsx` | Stale comment corrected. |

**Zero** changes to schemas, APIs, business logic, payroll, RBAC, RLS. Token swaps are color-only.

---

## Before / After

**Before:** Two brand colors in one product — navy chrome, teal operations. Stale docs describing a dead teal system. A `teal` accent that flipped color between light and dark.

**After:** A single navy brand across every surface, operational included. One coherent accent, consistent focus/hover behavior on primitives, and documentation that matches reality. The product now *looks* like one system, which is the foundation every later phase (profiles, dashboards) builds on.

> Verified: typecheck clean, production build clean. Because the changes are color-token and comment-level (plus two additive primitive options), there is no behavioral or layout risk.

---

## Next

- **P3 — Employee Profile Modernization** (apply the unified system to the highest-traffic record surface).
- Page-level proof of the unified accent is already visible in P1's Insights Hub and now across all operational queues/tables.
