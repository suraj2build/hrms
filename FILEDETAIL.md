# HRMS — File Detail Document

**Project:** Multi-tenant Human Resource Management System
**Sprint:** 2 (Enterprise Sub-modules, Masters, Payroll-ready Compensation)
**Last updated:** 2026-05-03
**Supabase project ID:** kxvdlvarjvtqijzvmegk

---

## 1. Project Overview

HRMS is a SaaS, multi-tenant HR platform built for Indian businesses. Each company
(tenant) gets full data isolation via PostgreSQL Row-Level Security. The system
handles the full employee lifecycle — onboarding, org management, document vault,
and workforce analytics — with role-based access control (RBAC) across four roles:
Super Admin, HR Admin, Manager, and Employee.

**Target market:** SMBs and mid-market Indian companies (50–2000 employees)
**India-specific features:** PAN, Aadhaar (last 4 digits), UAN, ESI fields;
INR-formatted salary bands; Indian employment types (permanent, contract,
probation, intern); statutory document types (Aadhaar, PAN, offer letter, etc.)

---

## 2. Tech Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Frontend framework | React | 18.2 | `apps/web/` |
| Build tool | Vite | 5.0 | Port 3000 in dev |
| UI components | shadcn/ui + Radix UI | Various | Dark-mode-first design system |
| Styling | Tailwind CSS | 3.4 | Custom sidebar + card tokens |
| Server state | TanStack Query | v5 | 30s stale time, retry: 1 |
| Client state | Zustand | 4.4 | Persisted auth + UI stores |
| Forms | React Hook Form + Zod | 7.49 + 3.22 | Per-step form validation |
| Charts | Recharts | 2.10 | Bar + Pie charts on dashboard |
| Routing | React Router DOM | 6.21 | BrowserRouter |
| CSV parsing | PapaParser | 5.4 | Available for future bulk import |
| API framework | Fastify | 4.25 | `apps/api/`, ESM, port 3001 |
| API runtime | tsx watch | 4.7 | Dev hot-reload via Node.js |
| Input validation | Zod | 3.22 | Both api and web |
| Auth | Supabase Auth | — | JWT, email/password + Google OAuth |
| Database | Supabase PostgreSQL | — | Managed Postgres, RLS enabled |
| Storage | Supabase Storage | — | Private bucket: `documents` |
| Multi-tenancy | PostgreSQL RLS | — | All tables tenant-scoped |
| Containerization | Docker + Compose | — | API only; web served by Vite/CDN |
| Monorepo tooling | npm workspaces | — | Root + apps/* + packages/* |

---

## 3. Directory Tree

```
hrms/                                    ← Monorepo root
├── apps/
│   ├── api/                             ← Fastify 4 REST API
│   │   ├── src/
│   │   │   ├── index.ts                 ← Server bootstrap, plugin + route registration
│   │   │   ├── plugins/
│   │   │   │   ├── supabase.ts          ← Creates Supabase service-role client, decorates fastify.supabase
│   │   │   │   └── auth.ts              ← JWT middleware: validates Bearer token, sets req.userId/tenantId/userRole
│   │   │   ├── routes/
│   │   │   │   ├── employees/
│   │   │   │   │   ├── index.ts         ← CRUD endpoints for /employees (list, get, create, update, soft-delete)
│   │   │   │   │   └── options.ts       ← GET /employees/options — lightweight picker (must register before /:id)
│   │   │   │   ├── departments/
│   │   │   │   │   └── index.ts         ← CRUD for /departments, /designations, /grades
│   │   │   │   ├── documents/
│   │   │   │   │   └── index.ts         ← GET/POST/DELETE /documents with MIME + size validation
│   │   │   │   └── analytics/
│   │   │   │       └── index.ts         ← GET /analytics/dashboard, GET /me, POST /setup (unauthenticated)
│   │   │   └── services/                ← (directory present, no files yet — reserved for Sprint 2)
│   │   ├── .env                         ← API secrets (PORT, SUPABASE_URL, SERVICE_ROLE_KEY, JWT_SECRET, WEB_URL)
│   │   ├── .env.example                 ← Template for .env
│   │   ├── Dockerfile                   ← Multi-stage build: base (build) → prod (runtime)
│   │   ├── package.json                 ← @hrms/api — dev: tsx watch; build: tsc; start: node dist/index.js
│   │   └── tsconfig.json                ← Target ES2022, moduleResolution: bundler, strict: true
│   │
│   └── web/                             ← React 18 + Vite frontend
│       ├── src/
│       │   ├── main.tsx                 ← React entry point — mounts <App /> into #root
│       │   ├── index.css                ← Tailwind directives + CSS custom properties (color tokens)
│       │   ├── App.tsx                  ← BrowserRouter, QueryClientProvider, AuthProvider, all routes
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── AppShell.tsx     ← Protected layout: Sidebar + Topbar + <Outlet />; redirects to /login if no profile
│       │   │   │   ├── Sidebar.tsx      ← Collapsible sidebar with RBAC-filtered nav, "Coming Soon" section
│       │   │   │   └── Topbar.tsx       ← Top bar with tenant name, user avatar, sign-out
│       │   │   ├── dashboard/
│       │   │   │   └── StatCard.tsx     ← Reusable stat card with icon, value, optional change indicator
│       │   │   └── ui/                  ← shadcn/ui components (avatar, badge, button, card, dialog,
│       │   │       └── ...              │   dropdown-menu, input, label, select, separator, tabs, toast)
│       │   ├── pages/
│       │   │   ├── auth/
│       │   │   │   ├── Login.tsx        ← Email/password login + Google OAuth button
│       │   │   │   ├── Signup.tsx       ← 3-step wizard: (1) Account → (2) Company Info → (3) Success
│       │   │   │   └── AuthCallback.tsx ← OAuth redirect handler — reads session, forwards to /dashboard
│       │   │   ├── dashboard/
│       │   │   │   └── Dashboard.tsx    ← 4 stat cards + bar chart (headcount by dept) + pie chart (employment type)
│       │   │   ├── employees/
│       │   │   │   ├── EmployeeList.tsx ← TanStack Table: sortable, paginated, filterable employee list with status filter
│       │   │   │   ├── AddEmployee.tsx  ← 3-step form: (1) Basic Info → (2) Official Info → (3) Statutory (PAN, UAN)
│       │   │   │   └── EmployeeProfile.tsx ← Full employee view with tabbed sections + inline edit dialog
│       │   │   ├── organization/
│       │   │   │   └── Organization.tsx ← Tabbed: Departments (tree) / Designations / Grades / Employment Types / Doc Types
│       │   │   ├── documents/
│       │   │   │   └── Documents.tsx    ← Document vault: upload to Supabase Storage, list with expiry alerts, signed-URL download
│       │   │   └── settings/
│       │   │       └── Settings.tsx     ← Tabbed: Company profile info / RBAC role matrix / Users (stub)
│       │   ├── stores/
│       │   │   ├── authStore.ts         ← Zustand persisted store: profile, tenant, accessToken, RBAC helpers
│       │   │   └── uiStore.ts           ← Zustand persisted store: sidebarCollapsed toggle
│       │   ├── lib/
│       │   │   ├── api/
│       │   │   │   └── client.ts        ← Thin fetch wrapper: reads token from authStore, prepends VITE_API_URL
│       │   │   ├── supabase/
│       │   │   │   └── client.ts        ← Supabase browser client (anon key, persistSession: true)
│       │   │   └── utils.ts             ← cn(), formatDate(), formatCurrency(), getInitials(), getStatusColor(), etc.
│       │   └── types/
│       │       └── index.ts             ← All shared TypeScript interfaces: Tenant, Profile, Employee, Department,
│       │                                   Designation, Grade, Document, DashboardStats, ApiError, etc.
│       ├── public/                      ← Static assets served by Vite
│       ├── index.html                   ← HTML shell — mounts /src/main.tsx
│       ├── vite.config.ts               ← Port 3000, path alias @ → src/, proxy /api → localhost:3001
│       ├── tailwind.config.ts           ← Theme extension (sidebar-*, muted-*, primary-* tokens)
│       ├── postcss.config.js            ← autoprefixer + tailwindcss
│       ├── components.json              ← shadcn/ui CLI config
│       ├── .env                         ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
│       ├── .env.example                 ← Template
│       ├── tsconfig.json                ← React + Vite TS config
│       └── package.json                 ← @hrms/web — all frontend deps
│
├── packages/
│   └── types/                           ← Shared types package (@hrms/types) — stub, not yet populated
│
├── supabase/
│   └── migrations/
│       ├── 001_tenants.sql              ← CREATE TABLE tenants
│       ├── 002_profiles.sql             ← CREATE TABLE profiles (FK → auth.users)
│       ├── 003_org_structure.sql        ← CREATE TABLE departments (self-ref), designations, grades
│       ├── 004_employees.sql            ← CREATE TABLE employees + auto-update trigger
│       ├── 005_documents.sql            ← CREATE TABLE documents
│       ├── 006_audit_logs.sql           ← CREATE TABLE audit_logs + initial audit trigger
│       ├── 007_rls_policies.sql         ← ENABLE ROW LEVEL SECURITY + all policies
│       ├── 008_seed.sql                 ← Demo seed data (mostly commented out — safe no-op)
│       └── 009_employee_audit_trigger.sql ← Improved audit trigger: PII stripping, UPDATE diff-only
│
├── .env                                 ← Root env — VITE_* + SUPABASE_* combined
├── .env.example                         ← Template
├── docker-compose.yml                   ← Runs API container on port 3001
├── package.json                         ← Workspace root: scripts + devDep: concurrently
├── package-lock.json                    ← npm lock file
├── SETUP.md                             ← Sprint 1 setup guide
└── FILEDETAIL.md                        ← This file — complete project reference
```

---

## 4. Database Schema (9 Tables)

All tables include `tenant_id`. Row-Level Security is enabled on all tables.
The Fastify API uses the service-role key (bypasses RLS) and enforces tenant isolation
via explicit `.eq('tenant_id', req.tenantId)` in every query.

### 4.1 `tenants`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | Tenant identifier |
| name | TEXT | NOT NULL | Company display name |
| slug | TEXT | UNIQUE, NOT NULL | URL-safe company identifier |
| plan | TEXT | NOT NULL, default 'starter' | starter / growth / enterprise |
| logo_url | TEXT | nullable | Company logo URL |
| industry | TEXT | nullable | e.g. Retail, IT/Software |
| size_range | TEXT | nullable | e.g. 1-50, 2000+ |
| country | TEXT | NOT NULL, default 'IN' | ISO country code |
| settings | JSONB | NOT NULL, default '{}' | Extensible config blob |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.2 `profiles`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK, FK → auth.users(id) ON DELETE CASCADE | Matches Supabase auth user |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| employee_id | UUID | nullable | Links to employees row when assigned |
| role | TEXT | CHECK IN (super_admin, hr_admin, manager, employee) | RBAC role |
| full_name | TEXT | nullable | Display name |
| avatar_url | TEXT | nullable | |
| is_active | BOOLEAN | NOT NULL, default true | |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.3 `departments`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| name | TEXT | NOT NULL | Department name |
| code | TEXT | nullable | Short code e.g. HR, TECH |
| parent_id | UUID | nullable, self-ref FK | Enables tree hierarchy |
| head_id | UUID | nullable | Future: FK → employees |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.4 `designations`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| name | TEXT | NOT NULL | Job title |
| level | INT | nullable | Seniority level (1 = entry, higher = senior) |
| department_id | UUID | nullable, FK → departments | |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.5 `grades`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| name | TEXT | NOT NULL | Grade name e.g. L5, Band C |
| code | TEXT | nullable | Short code |
| min_salary | NUMERIC(12,2) | nullable | Minimum CTC in INR |
| max_salary | NUMERIC(12,2) | nullable | Maximum CTC in INR |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.6 `employees`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| employee_code | TEXT | UNIQUE (tenant_id, employee_code) | Auto-generated EMP-0001 |
| first_name | TEXT | NOT NULL | |
| last_name | TEXT | NOT NULL | |
| email | TEXT | NOT NULL, UNIQUE (tenant_id, email) | |
| phone | TEXT | nullable | |
| gender | TEXT | CHECK IN (male, female, other) | |
| dob | DATE | nullable | Date of birth |
| blood_group | TEXT | nullable | |
| nationality | TEXT | NOT NULL, default 'Indian' | |
| joining_date | DATE | NOT NULL | |
| confirmation_date | DATE | nullable | Probation end date |
| employment_type | TEXT | CHECK IN (permanent, contract, intern, probation) | |
| status | TEXT | CHECK IN (active, inactive, on_notice, separated) | Soft-delete via 'separated' |
| department_id | UUID | nullable, FK → departments ON DELETE SET NULL | |
| designation_id | UUID | nullable, FK → designations ON DELETE SET NULL | |
| grade_id | UUID | nullable, FK → grades ON DELETE SET NULL | |
| manager_id | UUID | nullable, self-ref FK | Reporting manager |
| work_location | TEXT | nullable | |
| address | JSONB | nullable | {line1, line2, city, state, pincode} |
| emergency_contact | JSONB | nullable | {name, relation, phone} |
| pan_number | TEXT | nullable | India: Income Tax ID |
| aadhaar_last4 | TEXT | nullable | Last 4 digits of Aadhaar UID |
| uan_number | TEXT | nullable | Universal Account Number (PF) |
| esi_number | TEXT | nullable | ESI registration number |
| bank_details | JSONB | nullable | {bank, ifsc, account_masked} |
| profile_photo | TEXT | nullable | URL |
| created_by | UUID | nullable, FK → profiles ON DELETE SET NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL, auto-updated via trigger | |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.7 `documents`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| employee_id | UUID | NOT NULL, FK → employees ON DELETE CASCADE | |
| doc_type | TEXT | CHECK IN (aadhaar, pan, offer_letter, contract, certificate, relieving_letter, experience_letter, other) | |
| name | TEXT | NOT NULL | Original filename |
| storage_path | TEXT | NOT NULL | Path in Supabase Storage `documents` bucket |
| file_size | BIGINT | nullable | Size in bytes |
| mime_type | TEXT | nullable | application/pdf, image/jpeg, image/png |
| expires_at | DATE | nullable | Expiry date for time-limited docs |
| uploaded_by | UUID | nullable, FK → profiles ON DELETE SET NULL | |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

### 4.8 `audit_logs`
| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | NOT NULL, FK → tenants | |
| table_name | TEXT | NOT NULL | e.g. 'employees' |
| record_id | UUID | NOT NULL | PK of the changed row |
| action | TEXT | CHECK IN (INSERT, UPDATE, DELETE) | |
| old_data | JSONB | nullable | Pre-change snapshot (PII stripped) |
| new_data | JSONB | nullable | Post-change snapshot or diff (PII stripped) |
| performed_by | UUID | nullable, FK → profiles ON DELETE SET NULL | |
| ip_address | INET | nullable | Caller IP (from API) |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

**Audit behaviour (migration 009):**
- PII columns stripped from all snapshots: `pan_number`, `aadhaar_last4`, `uan_number`, `esi_number`, `bank_details`
- For UPDATE: `new_data` contains only the diff (changed columns), not the full row
- For INSERT: `new_data` = full sanitised row; `old_data` = NULL
- For DELETE: `old_data` = full sanitised row; `new_data` = NULL
- Pure `updated_at`-only changes are skipped (no audit row written)

### 4.9 RLS Policies Summary (migration 007)

| Table | Policy | Allowed roles |
|---|---|---|
| tenants | SELECT own tenant | Any authenticated user in tenant |
| tenants | UPDATE | super_admin, hr_admin |
| profiles | SELECT | Any user in same tenant |
| profiles | INSERT | Own row only (id = auth.uid()) |
| profiles | UPDATE | Own row OR super_admin/hr_admin |
| departments | SELECT | Any user in tenant |
| departments | INSERT/UPDATE/DELETE | super_admin, hr_admin |
| designations | SELECT | Any user in tenant |
| designations | ALL | super_admin, hr_admin |
| grades | SELECT | Any user in tenant |
| grades | ALL | super_admin, hr_admin |
| employees | ALL | super_admin, hr_admin |
| employees | SELECT | manager (own team + self) |
| employees | SELECT | employee (own record only) |
| documents | ALL | super_admin, hr_admin |
| documents | SELECT | employee (own documents only) |
| audit_logs | SELECT | super_admin, hr_admin |

---

## 5. API Endpoints

**Base URL:** `http://localhost:3001`
All endpoints except `/health` and `/setup` require `Authorization: Bearer <supabase_jwt>`.

### System
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /health | None | Returns `{"status":"ok","timestamp":"..."}` |

### Auth / Setup
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /setup | None | Creates tenant + profile after Supabase signup. Body: `{user_id, full_name, company_name, industry, size_range}` |
| GET | /me | Required | Returns current user's profile + tenant |

### Employees
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /employees | Required | List employees. Query: `status`, `page` (default 1), `limit` (default 20). Returns `{data, total}` |
| GET | /employees/options | Required | Lightweight picker. Query: `search`, `limit` (max 200). Active only. |
| GET | /employees/:id | Required | Full employee detail with joined dept, designation, grade, manager |
| POST | /employees | Required | Create employee. Auto-generates `employee_code` (EMP-NNNN). Zod validated. |
| PUT | /employees/:id | Required | Update employee. Strips protected fields (id, tenant_id, employee_code, created_at, created_by) |
| DELETE | /employees/:id | Required | Soft-delete: sets `status = 'separated'`. Returns 409 if already separated |

### Departments / Designations / Grades
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /departments | Required | List all departments, ordered by name |
| POST | /departments | Required | Create. Body: `{name, code?, parent_id?}` |
| PUT | /departments/:id | Required | Update |
| DELETE | /departments/:id | Required | Hard delete |
| GET | /designations | Required | List all designations |
| POST | /designations | Required | Create. Body: `{name, level?, department_id?}` |
| PUT | /designations/:id | Required | Update |
| DELETE | /designations/:id | Required | Delete |
| GET | /grades | Required | List all pay grades |
| POST | /grades | Required | Create. Body: `{name, code?, min_salary?, max_salary?}` |
| PUT | /grades/:id | Required | Update |
| DELETE | /grades/:id | Required | Delete |

### Documents
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /documents | Required | List documents. Query: `doc_type` (optional). Ordered by `created_at DESC` |
| POST | /documents | Required | Register document metadata. Validates MIME (PDF/JPG/PNG) + size (≤ 5 MB). |
| DELETE | /documents/:id | Required | Deletes metadata + removes file from Supabase Storage |

### Analytics
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /analytics/dashboard | Required | Returns: `total_employees`, `active_employees`, `new_joiners_this_month`, `separations_this_month`, `department_breakdown` (top 8), `employment_type_breakdown` |

---

## 6. Frontend Routes

All routes inside `<AppShell />` require authentication (redirects to `/login` if no session).

| Path | Component | Auth | Description |
|---|---|---|---|
| /login | Login | No | Email/password + Google OAuth |
| /signup | Signup | No | 3-step company onboarding wizard |
| /auth/callback | AuthCallback | No | OAuth redirect handler |
| /dashboard | Dashboard | Yes | KPI stat cards + bar + pie charts |
| /employees | EmployeeList | Yes | Paginated, sortable, filterable employee table |
| /employees/new | AddEmployee | Yes | 3-step add employee form |
| /employees/:id | EmployeeProfile | Yes | Employee detail + inline edit dialog |
| /organization | Organization | Yes | Departments tree, designations, grades, employment types, doc types |
| /documents | Documents | Yes | Document vault: upload, download (signed URL), expiry alerts |
| /settings | Settings | Yes | Company profile, RBAC matrix, users (stub) |
| /my-profile | EmployeeProfile | Yes | Current user's own employee profile |
| / | — | — | Redirects to /dashboard |
| * | — | — | Redirects to /dashboard |

**Sidebar "Coming Soon" (disabled, not yet routed):**
| Phase | Feature |
|---|---|
| Phase 2 | Attendance |
| Phase 3 | Payroll |
| Phase 4 | Performance |
| Phase 5 | Analytics |

---

## 7. RBAC — Roles and Permissions

Enforced in `apps/web/src/stores/authStore.ts` (frontend) and `supabase/migrations/007_rls_policies.sql` (database).

| Role | Key Permissions |
|---|---|
| super_admin | All permissions (`*`) |
| hr_admin | employees:read/write/delete, departments:read/write, designations:read/write, grades:read/write, documents:read/write/delete, analytics:read, settings:read/write, roles:read |
| manager | employees:read, departments:read, documents:read, analytics:read |
| employee | profile:read/write, documents:read (own only) |

---

## 8. Environment Variables Reference

### `apps/api/.env`
| Variable | Description | Example |
|---|---|---|
| PORT | Fastify listen port | 3001 |
| NODE_ENV | Runtime environment | development |
| SUPABASE_URL | Supabase project URL | https://xxxx.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | Service role JWT — bypasses RLS | eyJ... |
| SUPABASE_JWT_SECRET | JWT verification secret (UUID format) | 5fe09f41-... |
| WEB_URL | Allowed CORS origin | http://localhost:3000 |

### `apps/web/.env`
| Variable | Description | Example |
|---|---|---|
| VITE_SUPABASE_URL | Supabase project URL (browser) | https://xxxx.supabase.co |
| VITE_SUPABASE_ANON_KEY | Anon/public JWT — respects RLS | eyJ... |
| VITE_API_URL | Fastify API base URL | http://localhost:3001 |

---

## 9. How to Run

### Development (recommended)
```cmd
:: From hrms\ root (open a NEW terminal/CMD after Node.js install)
npm install
npm run dev
```

This starts:
- **Web (Vite HMR):** http://localhost:3000
- **API (tsx watch):** http://localhost:3001

**Verify:**
```cmd
curl http://localhost:3001/health
:: Expected: {"status":"ok","timestamp":"..."}
```

### Run workspaces separately
```cmd
:: Terminal 1 — Frontend
cd apps\web
npm run dev

:: Terminal 2 — API
cd apps\api
npm run dev
```

### Type checking
```cmd
npm run typecheck
```

### Production build
```cmd
npm run build
```

### Docker (API only)
```cmd
docker compose up --build
```

---

## 10. Supabase Setup Checklist

Complete these steps once per environment before first run:

- [ ] **Migrations applied** — Supabase Dashboard → SQL Editor → run files `001` through `009` in order
- [ ] **Storage bucket created** — Dashboard → Storage → New Bucket → name: `documents`, Public: **OFF**
- [ ] **Google OAuth** (optional) — Dashboard → Authentication → Providers → Google → add Client ID + Secret
- [ ] **Email templates** (optional) — Dashboard → Authentication → Email Templates

---

## 11. Sprint 1 — Feature Status

| Feature | Status | Notes |
|---|---|---|
| Multi-tenant data isolation (RLS) | ✅ Done | All tables with RLS + tenant isolation policies |
| Supabase Auth (email + Google OAuth) | ✅ Done | JWT flow, session persistence, auto-refresh |
| 3-step company onboarding | ✅ Done | Signup → Supabase user → POST /setup → tenant + super_admin profile |
| Employee lifecycle (CRUD) | ✅ Done | Create (3-step form), List, View, Edit, Soft-delete |
| Employee code generation | ✅ Done | Auto EMP-0001 pattern, sequential per tenant |
| Department hierarchy | ✅ Done | Self-referential tree, visual expand/collapse in UI |
| Designations management | ✅ Done | Full CRUD with department linkage |
| Pay grades management | ✅ Done | Full CRUD with INR salary bands |
| Document vault | ✅ Done | Upload to Supabase Storage, signed-URL download, expiry alerts, MIME/size validation |
| Dashboard analytics | ✅ Done | 4 KPI cards + bar chart + pie chart via /analytics/dashboard |
| RBAC (4 roles) | ✅ Done | Frontend permission checks + DB-level RLS policies |
| Audit logging | ✅ Done | Automatic trigger on employees table, PII stripping + UPDATE diff |
| Employee picker endpoint | ✅ Done | Lightweight /employees/options for dropdowns |
| Collapsible sidebar | ✅ Done | State persisted in localStorage via Zustand |
| India statutory fields | ✅ Done | PAN, Aadhaar last 4, UAN, ESI on employee record |
| Tests | ❌ Not started | Reserved for Sprint 2 |
| Service layer extraction | ❌ Not started | `services/` dir exists, empty |
| Shared types package | ❌ Not started | `packages/types/` is a stub |

---

## 12. Roadmap

| Phase | Feature | Key Tables / APIs Needed |
|---|---|---|
| Sprint 2 | Attendance & Leave | `attendance_logs`, `leave_requests`, `leave_balances` |
| Sprint 3 | Payroll & Salary | `salary_structures`, `payroll_runs`, `payslips` |
| Sprint 4 | Performance Reviews | `review_cycles`, `reviews`, `goals` |
| Sprint 5 | Advanced Analytics | Hire/attrition trends, headcount forecast, cost analytics |
| Sprint 6 | User Invites & Onboarding | Email invites, self-service onboarding checklists |
| Sprint 7 | Mobile App | React Native or PWA |

---

## 13. Known Limitations / Technical Notes

- **`services/` directory**: Present in `apps/api/src/` but empty — reserved for Sprint 2+.
- **`packages/types/`**: Workspace `@hrms/types` is a stub. Shared types live in `apps/web/src/types/index.ts` only.
- **`/setup` endpoint is unauthenticated**: Intentional — user just signed up and has no profile yet. In production, protect with a Supabase function secret.
- **Document upload flow**: Browser uploads directly to Supabase Storage (anon key), then POSTs metadata to `/documents`. The 5 MB cap in the API is metadata-only; Supabase Storage enforces its own limit.
- **Audit logs are employee-only**: Only `employees` table changes generate audit rows. Other tables are not audited yet.
- **Settings → Users tab**: Stubbed — user invite and role assignment not implemented.
- **`/forgot-password` route**: Linked from Login.tsx but no page component exists yet.
- **Rate limiting**: 100 requests/minute global limit in `apps/api/src/index.ts`.
- **CORS**: Dev allows `http://localhost:3000` only. Set `WEB_URL` env var for production domain.

---

## 14. Sprint 2 — New Database Tables (23 tables across migrations 010–016)

### 14.1 Extended Masters (migration 010)

| Table | Key Columns |
|---|---|
| `work_locations` | name, code, city, state, country, pincode, is_active |
| `cost_centers` | name, code, description, is_active |
| `shifts` | name, code, start_time, end_time, work_hours, is_night_shift, is_active |
| `identity_types` | name, code, description, is_active |
| `relationship_types` | name, code, is_active |
| `document_types` | name, code, is_mandatory, applicable_for TEXT[], is_active |

`documents` table also receives `document_type_id UUID FK → document_types`.

### 14.2 Salary Masters (migration 011)

| Table | Key Columns |
|---|---|
| `salary_components` | name, code, component_type (earning/deduction/employer_contribution), is_taxable, is_pf_applicable, is_esi_applicable, is_pt_applicable, is_lwf_applicable, is_variable, display_order |
| `salary_structures` | name, code, description, is_active |
| `salary_structure_components` | salary_structure_id FK, salary_component_id FK, calculation_type (fixed/pct_of_basic/pct_of_ctc/pct_of_gross), default_value, sequence |

### 14.3 Employee Sub-tables (migration 012)

| Table | Type | Key Columns |
|---|---|---|
| `employee_personal_info` | 1:1 | gender, dob, marital_status, blood_group, nationality, religion, caste_category, physically_handicapped, profile_photo |
| `previous_employment` | 1:N | company_name, designation, from_date, to_date, reason_for_leaving, last_ctc |
| `employee_bank_statutory` | 1:1 | bank_name, account_number, ifsc, branch, account_type; pan, aadhaar, uan, pf_number, esi_number, pt_applicable, lwf_applicable, tax_regime |
| `employee_identity` | 1:N | identity_type_id FK, identity_number, issued_by, issued_date, expiry_date, storage_path |
| `employee_contracts` | 1:N | contract_type (appointment/renewal/amendment/nda/other), start_date, end_date, status (draft/active/expired/terminated) |
| `employee_family` | 1:N | relationship_type_id FK, name, dob, gender, is_dependent, is_nominee, occupation |
| `employee_nominations` | 1:N | scheme (pf/gratuity/esi/superannuation), nominee_name, relationship_type_id FK, share_percentage, is_minor, guardian_name |
| `emergency_contacts` | 1:N | name, relationship, phone, alternate_phone, email, address, is_primary |
| `employee_addresses` | 1:N | address_type (current/permanent/correspondence), line1–pincode; UNIQUE(tenant_id, employee_id, address_type) |
| `employee_separation` | 1:1 | separation_type, initiated_by, notice_date, last_working_date, exit_reason, exit_interview_done, clearance_done |
| `employee_access_cards` | 1:N | card_number (UNIQUE per tenant), issued_date, returned_date, status (active/returned/lost/deactivated) |

### 14.4 Job History (migration 013)

| Table | Key Design Points |
|---|---|
| `job_history` | All FKs: department_id, designation_id, grade_id, work_location_id, cost_center_id, shift_id, manager_id (self-ref), employment_type, effective_from/to, is_current, reason_for_change |

**Trigger `fn_close_prev_job_history()`** — AFTER INSERT: when `is_current = true`, auto-sets previous record to `is_current = false` and `effective_to = NEW.effective_from - 1 day`.

**Partial unique index** — `WHERE is_current = true` enforces exactly one current record per employee per tenant.

### 14.5 Compensation (migration 014)

| Table | Key Design Points |
|---|---|
| `employee_compensations` | salary_structure_id FK, effective_from/to, is_active, ctc_annual, `ctc_monthly GENERATED ALWAYS AS (ROUND(ctc_annual/12, 2)) STORED`, approved_by |
| `employee_compensation_components` | compensation_id FK, salary_component_id FK, calculation_type, value (input), `computed_monthly` (stored at write time), `computed_annual` (stored), sequence |

**Trigger `fn_close_prev_compensation()`** — AFTER INSERT OR UPDATE OF is_active: auto-deactivates previous compensation when new one is activated.

**Computation at write time**: Monthly/annual amounts are calculated in the API route handler and stored — no re-computation needed at read time.

### 14.6 RLS (migration 015)

All 23 new tables use the same two-policy pattern:
- `tenant_read` — SELECT for any user in same tenant
- `hr_write` — ALL (INSERT/UPDATE/DELETE) for super_admin and hr_admin only

Additional policies: managers can read direct-reports' data; employees can read own nominations and family.

### 14.7 Lean Employees (migration 016 — run LAST)

Drops 20 legacy columns from `employees` that moved to dedicated sub-tables:
`department_id, designation_id, grade_id, manager_id, employment_type, work_location (TEXT), confirmation_date, address (JSONB), emergency_contact (JSONB), bank_details (JSONB), pan_number, aadhaar_last4, uan_number, esi_number, gender, dob, blood_group, nationality, profile_photo`

Adds: `work_location_id UUID FK → work_locations`

**Lean `employees` table retains:** id, tenant_id, employee_code, first_name, last_name, email, phone, joining_date, status, work_location_id, created_by, created_at, updated_at

---

## 15. Sprint 2 — New API Endpoints

**All endpoints require** `Authorization: Bearer <jwt>`.

### Masters (`/masters/` prefix)

| Method | Path | Description |
|---|---|---|
| GET | /masters/work-locations | List all work locations |
| POST | /masters/work-locations | Create |
| PUT | /masters/work-locations/:id | Update |
| DELETE | /masters/work-locations/:id | Delete (guard: in use check) |
| GET | /masters/cost-centers | List |
| POST/PUT/DELETE | /masters/cost-centers/:id | CRUD |
| GET | /masters/shifts | List |
| POST/PUT/DELETE | /masters/shifts/:id | CRUD |
| GET | /masters/salary-components | List (optional `?component_type=earning|deduction|employer_contribution`) |
| POST/PUT/DELETE | /masters/salary-components/:id | CRUD (DELETE guarded: no active structure usage) |
| GET | /masters/salary-structures | List with components joined |
| POST | /masters/salary-structures | Create |
| PUT/DELETE | /masters/salary-structures/:id | Update / Delete (DELETE guarded: no active employee compensations) |
| GET | /masters/salary-structures/:id/components | List structure components |
| POST | /masters/salary-structures/:id/components | Add component |
| PUT/DELETE | /masters/salary-structures/:id/components/:cid | Update / Remove component |
| GET/POST/PUT/DELETE | /masters/document-types/:id | CRUD |
| GET/POST/PUT/DELETE | /masters/identity-types/:id | CRUD |
| GET/POST/PUT/DELETE | /masters/relationship-types/:id | CRUD |

### Employee Sub-modules (`/employees/:id/...`)

All routes first verify employee belongs to `req.tenantId` (returns 404 if not found — prevents enumeration).

| Method | Path | Description |
|---|---|---|
| GET/PUT | /employees/:id/personal-info | Get / Upsert personal info (1:1) |
| GET/PUT | /employees/:id/bank-statutory | Get / Upsert bank + statutory (1:1) |
| GET | /employees/:id/previous-employment | List |
| POST/PUT/DELETE | /employees/:id/previous-employment/:prevId | Create / Update / Delete |
| GET | /employees/:id/identity | List with identity_types joined |
| POST/DELETE | /employees/:id/identity/:identityId | Add / Remove |
| GET | /employees/:id/contracts | List |
| POST/PUT/DELETE | /employees/:id/contracts/:contractId | CRUD |
| GET | /employees/:id/family | List with relationship_types joined |
| POST/PUT/DELETE | /employees/:id/family/:memberId | CRUD |
| GET | /employees/:id/nominations | List |
| POST | /employees/:id/nominations | Add (validates per-scheme share total ≤ 100%) |
| PUT/DELETE | /employees/:id/nominations/:nomId | Update / Delete |
| GET | /employees/:id/emergency-contacts | List (primary first) |
| POST/PUT/DELETE | /employees/:id/emergency-contacts/:contactId | CRUD (auto-demotes old primary on new primary set) |
| GET | /employees/:id/addresses | List |
| POST/PUT | /employees/:id/addresses | Upsert by address_type |
| DELETE | /employees/:id/addresses/:addressId | Delete |
| GET | /employees/:id/separation | Get separation record |
| POST | /employees/:id/separation | Initiate separation (also sets employee.status = 'on_notice' or 'separated') |
| PUT | /employees/:id/separation | Update (auto-updates employee.status if last_working_date changed) |
| GET | /employees/:id/access-cards | List |
| POST | /employees/:id/access-cards | Issue card |
| PUT | /employees/:id/access-cards/:cardId | Update card (return/lost/deactivate) |
| GET | /employees/:id/job-info | Current job (is_current = true) with all masters joined |
| GET | /employees/:id/job-history | Full job history ordered by effective_from DESC |
| POST | /employees/:id/job-history | New entry — DB trigger auto-closes previous |
| GET | /employees/:id/compensation | Active compensation with components |
| GET | /employees/:id/compensation/history | All compensation revisions |
| GET | /employees/:id/compensation/:compId | Single compensation revision |
| POST | /employees/:id/compensation | New revision with components (auto-computes monthly/annual, stores at write time) |

---

## 16. Sprint 2 — Feature Status

| Feature | Status | Notes |
|---|---|---|
| 7 SQL migrations (010–016) | ✅ Done | Files written — **apply to Supabase before running API** |
| 6 Extended master tables | ✅ Done | work_locations, cost_centers, shifts, identity_types, relationship_types, document_types |
| 3 Salary master tables | ✅ Done | salary_components, salary_structures, salary_structure_components |
| 11 Employee sub-tables | ✅ Done | All normalized; personal_info, bank_statutory, identity, contracts, family, nominations, emergency_contacts, addresses, separation, access_cards, previous_employment |
| Job history table + trigger | ✅ Done | Auto-close previous on INSERT; partial unique index enforces one current record |
| Compensation tables + trigger | ✅ Done | ctc_monthly GENERATED ALWAYS AS; component amounts stored at write time |
| RLS on all 23 new tables | ✅ Done | tenant_read + hr_write; extended policies in 015 |
| Lean employees migration | ✅ Done | Migration 016 drops 20 legacy columns |
| 9 Master API routes (8 files + index) | ✅ Done | Full CRUD with delete guards |
| 13 Employee sub-module API routes | ✅ Done | All with verifyEmployee check |
| Compensation computation logic | ✅ Done | Two-pass: fixed/pct_of_ctc first → derive basic/gross → pct_of_basic/pct_of_gross second |
| Nomination share validation | ✅ Done | Per-scheme total ≤ 100% enforced via aggregate query |
| Separation status side-effect | ✅ Done | POST sets employee.status = 'on_notice' or 'separated' |
| Frontend types updated | ✅ Done | All 23 new entity interfaces in apps/web/src/types/index.ts |
| EmployeeProfile updated (lean) | ✅ Done | Fetches sub-modules via separate API calls; 5-tab layout |
| EmployeeList updated (lean) | ✅ Done | Uses personal_info?.profile_photo and current_job?.employment_type |
| TypeScript: zero errors (api + web) | ✅ Done | Verified with npm run typecheck |
| Frontend sub-module UI pages | ⏳ Sprint 3 | Personal info form, job history UI, compensation UI |
| Migrations applied to Supabase | ❌ Manual step | See §17 |

---

## 17. How to Apply Sprint 2 Migrations

Run in Supabase Dashboard → SQL Editor, **in order**:

```
1. 010_masters_extended.sql
2. 011_salary_masters.sql
3. 012_employee_extended.sql
4. 013_job_history.sql
5. 014_compensation.sql
6. 015_rls_extended.sql
7. 016_lean_employees.sql   ← Run LAST (drops columns from employees)
```

**Verify after applying:**
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Should include all 23 new tables
```

**Verify lean employees:**
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'employees'
ORDER BY ordinal_position;
-- Should NOT contain: gender, dob, bank_details, address, pan_number, etc.
```

---

## 18. Updated Roadmap

| Sprint | Feature | Status |
|---|---|---|
| Sprint 1 | Core workforce, org management, documents, analytics | ✅ Done |
| Sprint 2 | Enterprise sub-modules, masters, payroll-ready compensation, history tables | ✅ Done (backend) |
| Sprint 3 | Frontend sub-module UI (16 employee forms), leave management | 🔜 Next |
| Sprint 4 | Payroll run engine (compute payslips using stored compensation components) | 🔜 Planned |
| Sprint 5 | Performance reviews, goals | 🔜 Planned |
| Sprint 6 | Advanced analytics, hire/attrition trends | 🔜 Planned |
| Sprint 7 | User invites, self-service onboarding | 🔜 Planned |
