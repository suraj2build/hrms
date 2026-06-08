# P1 — Insights Hub

**Program:** Emvora Product Polish (Feature Complete → Enterprise Premium)
**Phase:** P1 of P7
**Status:** Shipped
**Constraints honored:** No schema · No API redesign · No business logic · No workflow · No payroll behavior · No RBAC · No RLS changes.

---

## Problem (Before)

Emvora had **~20 read-only intelligence / analytics / health surfaces**, but no single place to find them. They were scattered across five domains and described in internal engine vocabulary:

| Where it lived | Examples | Why it hurt |
|---|---|---|
| Home > Overview | Workforce Command, Executive Intelligence | Competing with operational tools |
| Advanced Operations | Org Health, Action Center, Daily Digest, People Search, Narratives, Intelligence Hub, Operational Health, Roster Intelligence, Session Intelligence, Health Index, Attendance Risk, Attendance Confidence | A grab-bag mixing analytics with SRE consoles |
| Attendance / Payroll | Cost Intelligence, Forecast, Variance, Attendance Ops Center | Buried inside execution domains |
| Standalone | Enterprise Control Center, Control Center | No discoverable relationship to each other |

**First-time user reaction:** *"Powerful, but where do I even look? Everything is called 'Intelligence' or 'Governance'."*

Concretely:
- **8+ entries containing the word "Intelligence"**, with no parent and no way to tell them apart.
- A user wanting "how is the company doing?" had to already know the exact menu item in the exact domain.
- Engine names (`Attendance Confidence`, `Variance Center`, `Health Index`) were surfaced as user-facing labels with no explanation.

---

## Solution (After)

A single **Insights Hub** at `/admin/insights` — one curated, plain-language **front door** to every analytic view. It is a **directory page only**: every card links to a route that already exists. No new data, no new engine, no schema.

### Five plain-language categories

| Category | What it answers | Surfaces gathered |
|---|---|---|
| **Strategic** | "How are we doing, at board level?" | Executive Intelligence, Monthly Narrative, Enterprise Control* |
| **Workforce** | "What's happening with our people?" | Workforce Command, Org Health, Headcount Analytics, Action Center, Daily Digest, People Search |
| **Attendance & Time** | "Is our time data healthy and is coverage OK?" | Session Intelligence, Health Index, Attendance Risk, Data Confidence, Roster Intelligence, Operational Health |
| **Payroll & Cost** | "Where is the money going and what might surprise us?" | Cost Intelligence, Payroll Forecast, Variance Review |
| **Control Centers** | "Where do I act, not just look?" | Admin / Workforce Ops / Attendance Ops / Payroll Control Center |

\* *Enterprise Control is `super_admin`-only — the hub respects the same menu visibility as the nav (visibility only, no RBAC change).*

### Premium polish applied
- **Plain-language titles + one-line descriptions** for every surface. The internal engine name is kept only as a faint kicker (e.g. card "Data Confidence" → kicker *Attendance Confidence*), so power users keep their landmark while newcomers read English.
- **Hero strip** sets expectation: *"These are read-only views… nothing here changes your data."* — directly answers the "is this safe to click?" hesitation.
- **Card interactions**: lift-on-hover, accent rail per category, reveal-on-hover arrow — modern, premium feel using the existing design tokens (no new CSS system).
- **Role-aware**: hr_admin doesn't see super-admin-only surfaces, consistent with Phase 2 nav gating.

### Discoverability wiring
- New **"Insights Hub"** entry in **Home > Overview** (2nd item, `Sparkles` icon).
- **Executive Mode** now lands on the Insights Hub and lists it first — it is the natural exec home.
- Reachable at `/admin/insights`; `/admin/insights` registered as a Home domain match prefix so the contextual sidebar stays correct.

---

## What changed (files)

| File | Change |
|---|---|
| `pages/insights/InsightsHub.tsx` | **New** — the directory page (catalog + premium card grid). |
| `App.tsx` | Lazy import + `/admin/insights` route. |
| `nav-config.ts` | "Insights Hub" item in Home > Overview; added to Executive Mode Intelligence domain (now its default route); match prefixes. |
| `TopNavV2.tsx` | Executive Mode entry now lands on `/admin/insights`. |
| `ContextualSidebar.tsx` | Icon-color tokens for the executive domains. |

**Zero** changes to: schemas, migrations, API endpoints, business logic, payroll, RBAC, RLS. Every linked route and its permissions are untouched.

---

## Before / After

**Before:** 20 surfaces, 0 front doors, 8+ ambiguous "Intelligence" labels across 5 domains.
**After:** 1 front door, 5 plain-language categories, every surface described in a sentence, engine jargon demoted to a kicker.

> A first-time admin can now open **Insights Hub** and, in one screen, understand *everything Emvora can tell them* — and which view answers their question — without knowing the internal architecture.

---

## Next

- **P2 — Design System 2.0** (tokens, density, elevation, motion consistency)
- Later: P6 will *optionally* retire the now-redundant scattered duplicates once the hub is validated (kept additive for now — no menus removed).
