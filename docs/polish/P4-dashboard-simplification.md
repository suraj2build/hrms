# P4 — Dashboard Simplification

**Program:** Emvora Product Polish (Feature Complete → Enterprise Premium)
**Phase:** P4 of P7
**Status:** Shipped
**Constraints honored:** No schema · No API redesign · No business logic · No workflow · No payroll behavior · No RBAC · No RLS changes.

---

## Problem (Before)

Five competing "home/overview" surfaces lived under the admin Home domain, all equally prominent in the sidebar. A first-time user couldn't tell which one was the primary landing:

| Surface | Route | Nature |
|---|---|---|
| Workforce Command | `/admin/intelligence/workforce-command` | AI observations + KPIs |
| Control Center | `/admin/control-center` | Operational health hub |
| Insights Hub | `/admin/insights` | Analytics directory |
| Platform Health | `/admin/readiness` | Setup readiness console |
| Executive Intelligence | `/admin/enterprise` | 6-tab enterprise console |

Default route pointed to Workforce Command (intelligence content) rather than the operational hub, and `/admin/dashboard` redirected there too.

---

## Persona → Primary Home Assignment

| Persona | Primary Landing | Rationale |
|---|---|---|
| **Employee** | `/ess/dashboard` (EmployeeDashboard) | Single surface — identity strip, attendance KPIs, quick actions |
| **Manager** | `/manager/dashboard` (ManagerDashboard) | Single surface — approvals queue, team heatmap, attendance |
| **HR Admin** | `/admin/control-center` (ControlCenter) | Exception-first operational hub — system health, anomalies, processing status |
| **Super Admin** | `/admin/control-center` (ControlCenter) | Same as HR Admin |
| **Executive Mode** | `/admin/intelligence/workforce-command` (WorkforceCommand) | Narrative-first — AI summary leads, then attention KPIs, then detail |

---

## What Changed

### 1. Admin Home — default route
**Before:** `defaultRoute: '/admin/intelligence/workforce-command'`
**After:** `defaultRoute: '/admin/control-center'`

Control Center is the true operational hub; Workforce Command is intelligence content and lives in its own intelligence domain.

### 2. Admin Home nav — Overview items reduced 5 → 3
**Before:** Workforce Command · Insights Hub · Control Center · Platform Health · Executive Intelligence (5 items, no clear hierarchy)
**After:** Control Center · Insights Hub · Platform Health (3 items, clear hierarchy: ops hub → analytics entry → setup check)

Workforce Command demoted to Intelligence domain (where it belongs — already exists there). Executive Intelligence accessible via Exec Mode toggle (doesn't need its own Home nav entry).

### 3. Dashboard redirect fixed
**Before:** `/admin/dashboard` → `/admin/intelligence/workforce-command`
**After:** `/admin/dashboard` → `/admin/control-center`

Consistent with the new primary home.

### 4. Executive Mode — narrative-first entry point
**Before:** Entering Exec Mode navigated to `/admin/insights` (analytics directory)
**After:** Entering Exec Mode navigates to `/admin/intelligence/workforce-command` (AI summary + attention KPIs first)

Exec sidebar reordered: Workforce Summary first, Narratives second, then Insights Hub and other views.

### 5. ControlCenter + WorkforceCommand — PageContainer adoption
Both pages now use `PageContainer` from `@/components/layout/PageContainer` instead of inline padding divs. Eliminates the double-padding caused by the shell's `op-canvas` + page-level `p-5`.

---

## Files Changed

| File | Change |
|---|---|
| `components/layout/v2/nav-config.ts` | Home defaultRoute → ControlCenter; Overview items 5→3; EXECUTIVE_DOMAINS defaultRoute → WorkforceCommand; exec sidebar reordered narrative-first |
| `components/layout/v2/TopNavV2.tsx` | Exec mode entry navigation → WorkforceCommand |
| `pages/admin/ControlCenter.tsx` | PageContainer wrap; removed double-padding |
| `pages/intelligence/WorkforceCommand.tsx` | PageContainer wrap; removed double-padding |
| `App.tsx` | `/admin/dashboard` redirect target → `/admin/control-center` |

**Zero** changes to schemas, APIs, business logic, payroll, RBAC, RLS, or any field/action.

---

## Persona Journey (After)

**HR Admin logs in** → lands on Control Center → sees system health + exceptions immediately → "Attention-first, I know where I am."

**Admin enters Exec Mode** → lands on Workforce Summary (AI narrative + KPIs) → sidebar shows Narratives, Insights Hub → "Narrative-first, I understand the story before the data."

**Employee logs in** → lands on ESS Dashboard → identity strip + attendance KPIs → "My info, front and center."

**Manager logs in** → lands on Manager Dashboard → approvals queue + team heatmap → "What needs my action today."

---

## Next

- **P5 — Terminology Standardization** (replace architecture vocabulary with plain English in nav labels).
