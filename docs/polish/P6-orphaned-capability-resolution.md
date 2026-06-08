# P6 — Orphaned Capability Resolution

**Program:** Emvora Product Polish (Feature Complete → Enterprise Premium)
**Phase:** P6 of P7
**Status:** Shipped
**Constraints honored:** No schema · No API redesign · No business logic · No workflow · No payroll behavior · No RBAC · No RLS changes.

---

## Problem

Three feature pages existed in the codebase but were unreachable — no route and no nav entry. Users couldn't discover or use them.

| Page | File | Status Before |
|---|---|---|
| TrustWorkspace | `pages/trust/TrustWorkspace.tsx` | No route, no nav |
| FabricWorkspace | `pages/fabric/FabricWorkspace.tsx` | No route, no nav |
| AdminDashboard | `pages/dashboard/AdminDashboard.tsx` | No route (left unrouted — see below) |

---

## What Changed

### TrustWorkspace → `/admin/trust`
**What it is:** Workforce trust & compliance intelligence — verification check results, trust score signals, duplicate alerts, regulatory pipeline. Read-only with approve/reject for hr_admin.

**Action:** Added route at `/admin/trust`. Added nav item "Trust Intelligence" to the Platform Orchestration group (super_admin only).

### FabricWorkspace → `/admin/fabric`
**What it is:** Enterprise Orchestration Fabric — fabric health, intelligence composition, decision lineage, orchestration, replay sessions, and knowledge layer. Read-only.

**Action:** Added route at `/admin/fabric`. Added nav item "Fabric Intelligence" to the Platform Orchestration group (super_admin only). Added `Cpu` icon to nav-config imports.

### AdminDashboard — intentionally left unrouted
`AdminDashboard.tsx` is a superseded overview dashboard design that would create a competing "home" surface next to the now-canonical ControlCenter. Routing it would undo P4's dashboard simplification work. Left as a dormant file for future reference or removal.

---

## Files Changed

| File | Change |
|---|---|
| `App.tsx` | Lazy imports + routes for `/admin/trust` and `/admin/fabric` |
| `components/layout/v2/nav-config.ts` | Added `/admin/trust` and `/admin/fabric` to `advanced-ops` matchPrefixes; added "Trust Intelligence" and "Fabric Intelligence" items to Platform Orchestration group; added `Cpu` to lucide imports |

**Zero** changes to schemas, APIs, business logic, payroll, RBAC, or RLS.
