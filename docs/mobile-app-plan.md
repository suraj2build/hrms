# CognixHR Employee Mobile App — Research & Plan

_Last updated: 2026-06-24_

## 1. Goal

Ship a **native employee mobile app** for CognixHR ESS (Employee Self-Service) — the
"HR in your pocket" experience: punch attendance, view payslips, apply for leave,
clear approvals, and get push notifications. This is the single biggest gap between
CognixHR and competitors (Keka, greytHR, HONO, factoHR all lead with mobile).

## 2. Key finding: the API is already mobile-ready

The existing architecture removes most of the usual mobile blockers:

| Factor | State | Implication for mobile |
|---|---|---|
| **Auth** | Bearer JWT (Supabase Auth), no cookies/sessions | ✅ Ideal — send `Authorization: Bearer <token>`, refresh via Supabase |
| **Multi-tenancy** | One tenant per JWT, resolved server-side from `profiles.tenant_id` | ✅ No tenant-selector UX needed |
| **ESS endpoints** | 30+ self-scoped routes already live (`/ess/me/*`, `/attendance/punch`, `/leave/*`, `/notifications`) | ✅ v1 needs almost no new API |
| **Mobile punch** | `/attendance/punch` already accepts `source: "mobile"` | ✅ Attendance works day one |
| **File upload** | Direct-to-Supabase-Storage + server audit trail | ✅ Document upload ready |
| **Push** | Infra exists but `push channel is_enabled: false` | ⚠️ ~500 LOC to wire FCM/APNs |
| **Geolocation** | `attendance_punch_logs.device_id` exists, no geo capture | ⚠️ Needs schema migration + client geo |
| **Monorepo** | npm workspaces; no `packages/` yet | ➕ Add `apps/mobile` + extract `packages/types`, `packages/api-client` |

## 3. Tech decision: React Native (Expo)

### Options weighed

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **PWA** (reuse web app) | Cheapest, instant, one codebase | iOS push **unreliable in 2026** (subscriptions silently drop, manual home-screen install required, disabled for PWAs in EU); no real app-store presence; weaker GPS/camera | ❌ Fails on the two features HR mobile needs most: reliable push + geo punch |
| **Flutter** | Great perf, single codebase | Dart — no reuse of our React/TS skills or types; harder hiring; no code share with web | ❌ Throws away our existing investment |
| **React Native (Expo)** | Reuses React/TS skills; shares `types` + `api-client` with web; reliable native push (FCM/APNs); real GPS + camera (selfie+geo punch); app-store presence; RN 0.76 Fabric removed old perf bottleneck | Some native build/release overhead (Expo EAS handles most) | ✅ **Recommended** |

### Why RN wins here specifically
- The web app is **React 18 + TypeScript** — the team already thinks in this stack.
- Auth is **token-based** — RN stores the JWT in secure storage and sends it; no cookie gymnastics.
- We can extract **`packages/types`** and **`packages/api-client`** so web and mobile share one contract — no drift.
- HR apps live and die on **approval push notifications** and **geo/selfie attendance** — both are native strengths and PWA weaknesses.

## 4. v1 scope (MVP) — grounded in existing endpoints

| Screen | Endpoint(s) already available | New work |
|---|---|---|
| **Login** | Supabase Auth `signInWithPassword` | Secure token storage (expo-secure-store) |
| **Home / Dashboard** | `/attendance/status`, `/notifications/count`, `/leave/balance` | Layout (use the new MobileESSMock as the design north star) |
| **Attendance punch** | `POST /attendance/punch` (`source: "mobile"`) | Camera selfie + GPS capture → **needs geo schema migration** |
| **My attendance** | `GET /attendance/:employeeId` | Calendar view |
| **Payslip / compensation** | `/ess/me/bank-statutory`, `/ess/salary/tax-planner` | Read-only viewer, PDF download |
| **Leave apply + balance** | `/leave/apply`, `/leave/balance`, `/leave/my-requests`, `/leave/duration/preview` | Apply flow |
| **Approvals inbox** | `/ess/approvals`, `/leave-requests/*` | Approve/reject + **deep-link from push** |
| **Notifications** | `/notifications`, `/notifications/:id/read` | List + badge; **needs push enablement** |
| **Directory** | `/ess/team` | Avatar list |
| **Profile** | `/ess/me/{addresses,emergency-contacts,family,documents}` | View + edit |

### Backend work required for v1 (small, well-scoped)
1. **Enable push channel** — flip `is_enabled`, add FCM/APNs senders, store device tokens (new `device_tokens` table). ~500 LOC, infra already exists.
2. **Geo attendance migration** — add `lat`/`lng`/`accuracy`/`selfie_url` to `attendance_punch_logs`; optional geofence validation per location.
3. **Extract shared packages** — `packages/types` (DTOs) + `packages/api-client` (fetch wrapper with token injection), consumed by both web and mobile.

## 5. Phased roadmap

- **Phase 0 — Foundations (1 wk):** scaffold `apps/mobile` (Expo), extract `packages/types` + `packages/api-client`, wire Supabase auth + secure token storage, app shell + bottom-tab navigation.
- **Phase 1 — Core ESS (2–3 wks):** Home, Attendance punch (GPS+selfie + geo migration), My Attendance, Leave apply/balance, Payslip viewer.
- **Phase 2 — Engagement (1–2 wks):** Push notifications (FCM/APNs + device-token registration + deep links), Approvals inbox, Notifications, Directory, Profile.
- **Phase 3 — Polish & ship (1–2 wks):** offline punch queue + sync, biometric app-unlock, multi-language, EAS build + Play Store / App Store submission.

**Rough total:** ~6–8 weeks to a store-ready v1 for one developer familiar with RN, faster with two.

## 6. Open decisions for product owner
1. **Selfie + geofence attendance** — required for v1, or punch-only first? (Drives the schema migration scope.)
2. **Manager features** — employee-only v1, or include manager approvals from day one? (Approvals API already exists.)
3. **Distribution** — public app stores, or enterprise/MDM internal distribution first?
4. **Offline** — is offline punch a v1 requirement (deskless/field staff) or a Phase 3 add?

## 7. Sources
- iOS PWA push limitations 2026 — magicbell.com, mobiloud.com
- RN vs Flutter vs PWA 2026 — thedroidsonroids.com, pagepro.co
- HR ESS must-have mobile features — payrun.app, pockethrms.com, factohr.com
