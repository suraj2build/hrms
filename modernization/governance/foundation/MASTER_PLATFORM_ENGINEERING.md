# MASTER MONOREPO + PLATFORM ENGINEERING ARCHITECTURE
## AI-Native Workforce Operating System — Engineering Foundation Specification
### Principal Platform Architect Reference Document — Confidential

---

> **Document Authority:** This document is the canonical engineering foundation specification for the Workforce Operating System platform. All repository structure decisions, package boundaries, build system choices, deployment topology, and shared contract designs are governed by the principles established herein. No application boundary, package API, or CI/CD pipeline may be established without alignment with this specification.

---

# Section 1 — Platform Engineering Philosophy

## 1.1 Why Enterprise Monorepos Become Difficult

The gravitational pull toward monorepo complexity is not a tool problem — it is a discipline problem. Organizations that build monorepos without explicit architecture principles consistently rediscover the same failure modes, regardless of whether they chose Nx, Turborepo, or Lerna:

**Failure Mode 1 — The Boundary Collapse**
Six months after launch, a developer needs data from the payroll domain in the attendance module. The path of least resistance is a direct import: `import { PayslipService } from '../../payroll/services'`. Within 18 months, every domain module imports from every other domain module. The monorepo becomes a distributed ball of mud — harder to reason about than a poorly-structured polyrepo, because the coupling is invisible to dependency analysis tools that only examine package-level imports.

**Failure Mode 2 — The Shared Package Trap**
A shared `utils` package is created. Every package imports from `utils`. `utils` grows to contain authentication helpers, date formatting, Prisma utilities, React components, and ML model output parsers. It has no coherent ownership. Breaking changes in `utils` affect every package. Changes must be made by committee. The package becomes untouchable.

**Failure Mode 3 — Build System Abandonment**
Monorepo build tools (Nx, Turborepo) are adopted but never configured with proper project graph analysis. `nx affected` is never used in CI because the team doesn't trust it. Every PR rebuilds the entire monorepo. Build times reach 45 minutes. Engineers start cherry-picking changes to avoid triggering full rebuilds. The incremental build advantage — the primary reason to adopt the tool — is never realized.

**Failure Mode 4 — Contract Drift**
Frontend teams write their own TypeScript types to represent API responses because the backend types aren't exported from a shared package. The backend evolves a response field from `string` to `string | null`. The frontend breaks. The bug is discovered in production. Contract drift is the most expensive maintenance cost in a long-lived full-stack monorepo.

**Failure Mode 5 — Environment Proliferation Without Governance**
Each application team defines its own `.env` structure, secret naming convention, and configuration validation. The platform has 340 environment variables across 12 applications with overlapping but incompatible naming. A secret rotation requires touching every application independently. There is no single source of truth for what configuration the system requires.

The Workforce OS platform engineering architecture is explicitly designed to prevent all five failure modes through structural enforcement, not developer discipline.

---

## 1.2 Core Engineering Philosophy

The platform engineering architecture is built on seven governing principles:

### Principle 1 — Explicit Over Implicit, Enforced Over Documented

Import boundaries, domain ownership, and dependency rules are **enforced by tooling** — not documented in a wiki. ESLint rules prevent cross-domain imports. Module boundary definitions in Nx prevent package-level coupling. Lint-staged hooks prevent unowned files from being committed. The architecture is self-enforcing.

### Principle 2 — Contracts Are the Product

The public API contracts of every package — TypeScript types, Zod schemas, OpenAPI specs, event schemas — are the primary artifacts the platform produces. Implementations change. Contracts must be stable. Breaking a contract without a deprecation path is treated with the same severity as a production incident.

### Principle 3 — Platform First, Features Second

Shared infrastructure (auth, observability, config, database access, event bus) is built and stabilized before feature development begins. Features built without a stable platform are features that must be rebuilt when the platform matures. The platform investment pays dividends on every subsequent feature.

### Principle 4 — Domain Isolation at the Import Level

Modules within the backend are isolated by domain. The attendance module cannot import from the payroll module. Both may import from `@platform/contracts`, `@platform/database`, and `@platform/events`. Domain-to-domain communication happens exclusively through the event bus or published API calls — never through direct code imports.

### Principle 5 — Type Safety Across the Full Stack

TypeScript types flow from the single source of truth (Zod schemas in `@platform/contracts`) through the backend API (request/response types), to the frontend API client (auto-generated from OpenAPI), to the UI components (prop types). A schema change in one place propagates type errors to every affected consumer at compile time — before runtime.

### Principle 6 — Observability Is a Platform Concern

Logging, tracing, and metrics are not per-application concerns. `@platform/observability` provides a single, configured OpenTelemetry SDK that every application imports. Correlation IDs, tenant context, and trace propagation are injected by the platform layer, not implemented per-team.

### Principle 7 — Incremental Evolution, Never Big-Bang Rewrites

The existing attendance, leave, payroll, and workflow engines contain years of validated business logic. The engineering strategy wraps, modernizes, and migrates this logic — not replaces it wholesale. New platform infrastructure is built alongside existing systems. Traffic is migrated incrementally. Old systems are decommissioned only after new systems are proven in production.

---

## 1.3 Modular Monolith Evolution Model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│            PLATFORM EVOLUTION — THREE STAGES                                 │
│                                                                              │
│  STAGE 1: Modular Monolith (Current → 18 months)                            │
│  ─────────────────────────────────────────────                               │
│  • Single deployable backend process                                         │
│  • Domain modules inside one Fastify application                             │
│  • PostgreSQL/Supabase shared instance                                       │
│  • In-process event bus (EventEmitter + outbox)                              │
│  • Monorepo with enforced domain import boundaries                           │
│  • Full type safety, contract-first APIs                                     │
│                                                                              │
│  STAGE 2: Modular Monolith + Specialized Workers (18–36 months)             │
│  ─────────────────────────────────────────────                               │
│  • Core backend remains monolith                                             │
│  • Analytics projection workers extracted (ClickHouse ingestion)            │
│  • AI inference workers extracted (GPU-optimized)                            │
│  • Email/SMS notification workers extracted                                  │
│  • Shared event bus upgrades to Redis Streams / BullMQ                      │
│  • Read replicas for analytics                                               │
│                                                                              │
│  STAGE 3: Domain Service Extraction (36+ months, trigger-based)             │
│  ─────────────────────────────────────────────                               │
│  • Domains extracted to independent services ONLY when:                      │
│    - Scaling requirements differ from core monolith                          │
│    - Team ownership warrants independent deployment                          │
│    - Operational complexity is justified by benefit                          │
│  • Shared contracts make extraction safe (no API changes needed)             │
│  • Event bus migrates to Kafka/Redpanda                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1.4 Platform Contract Drift — The Silent Killer

```
Contract Drift Lifecycle:

Week 1:   Backend adds `manager_id` field to Employee response.
          Frontend team is not notified.
          
Week 3:   Frontend builds feature using `manager_id`.
          Types come from their own local interface definition.
          
Week 6:   Backend renames `manager_id` to `reporting_manager_id`.
          Backend TypeScript compiles. Backend tests pass.
          Frontend TypeScript compiles (using local types, not shared).
          Frontend tests pass (mocked responses match local types).
          
Week 7:   Feature ships to production.
          `manager_id` is undefined. Feature silently breaks.
          Users submit support tickets.
          
Week 8:   Root cause identified as contract drift.
          Total cost: 3 weeks of user-facing bug, 1 week of investigation.
          
Prevention:
          @platform/contracts owns all types.
          OpenAPI generated from Zod schemas in @platform/contracts.
          Frontend API client auto-generated from OpenAPI.
          Backend routes validated against same Zod schemas.
          Schema change = immediate TypeScript error on both sides.
          CI fails before merge. Bug never reaches production.
```

---

# Section 2 — Monorepo Strategy

## 2.1 Build Tool Selection — Turborepo vs Nx

### Turborepo

**Strengths:**
- Minimal configuration overhead — `turbo.json` is simple to understand
- Excellent remote caching out of the box (Vercel Remote Cache, or self-hosted)
- Fast parallel execution with task dependency graph
- No imposed project structure conventions
- Best-in-class for Next.js / Vercel-hosted frontends

**Weaknesses:**
- No code generation tooling (no equivalent of Nx generators)
- No first-class workspace plugin ecosystem
- Limited module boundary enforcement (no built-in import linting)
- Project graph analysis is less sophisticated than Nx
- `affected` computation requires additional setup

### Nx

**Strengths:**
- Sophisticated project dependency graph (`nx graph`)
- `nx affected` for CI optimization (rebuild only what changed)
- First-class generators for code scaffolding (domain modules, packages)
- Module boundary enforcement via `@nx/eslint-plugin-nx`
- Extensive plugin ecosystem (Prisma, Docker, Terraform)
- Workspace executor plugins for custom build steps
- First-class support for distributed task execution (Nx Cloud)

**Weaknesses:**
- Steeper learning curve
- More configuration overhead for custom setups
- Nx Cloud required for full remote caching benefit
- Opinion-heavy on folder structure conventions

### Decision: Nx with pnpm Workspaces

**Rationale:**
The Workforce OS platform requires:
1. **Module boundary enforcement** (domain isolation rule) — Nx `@nx/eslint-plugin-nx` provides this; Turborepo does not
2. **Code generation** (domain module scaffolding, event type generation) — Nx generators are purpose-built for this
3. **Sophisticated affected analysis** — CI must rebuild only the affected subset of a large monorepo; Nx's project graph is more accurate
4. **Long-term enterprise scalability** — Nx's architecture scales to 1,000+ packages; Turborepo begins to show limitations at that scale

pnpm workspaces provides the package manager foundation — it is significantly more efficient than npm/yarn for large monorepos (strict hoisting, content-addressable store, hard links).

---

## 2.2 Complete Repository Structure

```
workforce-os/
│
├── apps/                              # Deployable applications
│   ├── api/                           # Backend API (Fastify modular monolith)
│   ├── admin/                         # Admin platform (Next.js)
│   ├── ess/                           # Employee Self-Service portal (Next.js)
│   ├── analytics-workspace/           # Analytics dashboard (Next.js)
│   ├── mobile/                        # React Native mobile app (Expo)
│   └── ai-copilot/                    # AI copilot interface (Next.js embedded)
│
├── workers/                           # Background worker processes
│   ├── outbox-relay/                  # Outbox → event bus relay
│   ├── analytics-projector/           # Events → analytics read models
│   ├── ai-inference/                  # ML model inference + prediction jobs
│   ├── notification-dispatcher/       # Multi-channel notification delivery
│   ├── attendance-processor/          # Daily attendance computation jobs
│   ├── payroll-compute/               # Payroll run computation workers
│   └── partition-manager/             # DB partition maintenance jobs
│
├── packages/                          # Shared libraries (internal)
│   │
│   ├── contracts/                     # @platform/contracts
│   │   ├── src/
│   │   │   ├── schemas/               # Zod schemas (source of truth)
│   │   │   ├── dtos/                  # Inferred TypeScript types from schemas
│   │   │   ├── events/                # Domain event schemas + types
│   │   │   └── openapi/               # Generated OpenAPI spec (do not edit)
│   │   └── package.json
│   │
│   ├── database/                      # @platform/database
│   │   ├── src/
│   │   │   ├── client.ts              # Prisma client factory
│   │   │   ├── repositories/          # Base repository abstractions
│   │   │   ├── unit-of-work.ts        # UoW implementation
│   │   │   └── tenant-context.ts      # Tenant-aware query context
│   │   └── package.json
│   │
│   ├── auth/                          # @platform/auth
│   │   ├── src/
│   │   │   ├── jwt.ts                 # JWT verification + claims
│   │   │   ├── session.ts             # Session management
│   │   │   ├── tenant-resolver.ts     # Tenant context from JWT
│   │   │   ├── rbac.ts                # Permission checking
│   │   │   └── middleware/            # Fastify + Next.js middleware
│   │   └── package.json
│   │
│   ├── events/                        # @platform/events
│   │   ├── src/
│   │   │   ├── bus/                   # EventBus interface + implementations
│   │   │   ├── outbox/                # Outbox writer utilities
│   │   │   ├── schemas/               # Event envelope schema
│   │   │   └── registry.ts            # Consumer registry
│   │   └── package.json
│   │
│   ├── observability/                 # @platform/observability
│   │   ├── src/
│   │   │   ├── logger.ts              # Pino structured logger factory
│   │   │   ├── tracer.ts              # OpenTelemetry tracer
│   │   │   ├── metrics.ts             # Prometheus metric definitions
│   │   │   ├── middleware/            # Request tracing middleware
│   │   │   └── correlation.ts         # Correlation ID propagation
│   │   └── package.json
│   │
│   ├── config/                        # @platform/config
│   │   ├── src/
│   │   │   ├── schema.ts              # Zod-validated env schema
│   │   │   ├── loader.ts              # Config loading + validation
│   │   │   └── types.ts               # Typed config interfaces
│   │   └── package.json
│   │
│   ├── policy-engine/                 # @platform/policy-engine
│   │   ├── src/
│   │   │   ├── resolver.ts            # Policy resolution algorithm
│   │   │   ├── cache.ts               # Resolution result cache
│   │   │   └── types.ts               # Policy types
│   │   └── package.json
│   │
│   ├── workflow-sdk/                  # @platform/workflow-sdk
│   │   ├── src/
│   │   │   ├── engine.ts              # Workflow execution engine
│   │   │   ├── templates.ts           # Template loading + validation
│   │   │   └── tasks.ts               # Task assignment + completion
│   │   └── package.json
│   │
│   ├── analytics-sdk/                 # @platform/analytics-sdk
│   │   ├── src/
│   │   │   ├── projector.ts           # Projection writer interface
│   │   │   ├── kpi.ts                 # KPI computation utilities
│   │   │   └── clickhouse.ts          # ClickHouse client wrapper
│   │   └── package.json
│   │
│   ├── ai-sdk/                        # @platform/ai-sdk
│   │   ├── src/
│   │   │   ├── orchestrator.ts        # AI orchestration layer
│   │   │   ├── gateway.ts             # Model gateway (OpenAI / Anthropic)
│   │   │   ├── vector.ts              # pgvector / Qdrant client
│   │   │   ├── features.ts            # Feature engineering utilities
│   │   │   └── prompt-manager.ts      # Prompt versioning + retrieval
│   │   └── package.json
│   │
│   ├── ui/                            # @platform/ui
│   │   ├── src/
│   │   │   ├── components/            # Shared UI primitives
│   │   │   ├── tokens/                # Design tokens
│   │   │   ├── charts/                # Chart components (Recharts/Visx)
│   │   │   ├── data-grid/             # AG Grid wrappers
│   │   │   ├── ai/                    # AI-specific UI components
│   │   │   └── workspace/             # Workspace shell components
│   │   └── package.json
│   │
│   └── testing/                       # @platform/testing
│       ├── src/
│       │   ├── factories/             # Test data factories (faker + domain models)
│       │   ├── mocks/                 # Shared mocks (event bus, database, auth)
│       │   ├── fixtures/              # Tenant + employee test fixtures
│       │   └── helpers/               # Test utilities
│       └── package.json
│
├── domains/                           # Domain module packages (internal backend)
│   ├── identity/                      # @domain/identity
│   ├── organization/                  # @domain/organization
│   ├── employee/                      # @domain/employee
│   ├── attendance/                    # @domain/attendance
│   ├── shift/                         # @domain/shift
│   ├── leave/                         # @domain/leave
│   ├── payroll/                       # @domain/payroll
│   ├── workflow/                      # @domain/workflow
│   ├── policy/                        # @domain/policy
│   ├── compliance/                    # @domain/compliance
│   ├── notification/                  # @domain/notification
│   ├── analytics/                     # @domain/analytics
│   ├── ai/                            # @domain/ai
│   └── integration/                   # @domain/integration
│
├── infra/                             # Infrastructure as code
│   ├── terraform/
│   │   ├── modules/
│   │   │   ├── supabase/
│   │   │   ├── vercel/
│   │   │   ├── redis/
│   │   │   └── clickhouse/
│   │   ├── environments/
│   │   │   ├── production/
│   │   │   ├── staging/
│   │   │   └── development/
│   │   └── main.tf
│   ├── docker/
│   │   ├── api/Dockerfile
│   │   ├── worker/Dockerfile.base
│   │   └── docker-compose.dev.yml
│   └── k8s/                           # Future: Kubernetes manifests
│
├── tooling/                           # Internal build tooling
│   ├── eslint-config/                 # @tooling/eslint-config
│   ├── tsconfig/                      # @tooling/tsconfig
│   ├── prettier-config/               # @tooling/prettier-config
│   ├── jest-config/                   # @tooling/jest-config
│   └── nx-plugins/                    # Custom Nx generators + executors
│       ├── generators/
│       │   ├── domain-module/         # Scaffold new domain module
│       │   ├── shared-package/        # Scaffold shared package
│       │   └── event-schema/          # Generate event schema + types
│       └── executors/
│           ├── prisma-migrate/        # Custom Prisma migration executor
│           └── openapi-gen/           # OpenAPI generation executor
│
├── prisma/                            # Database schema (all domains)
│   ├── schema/
│   │   ├── base.prisma                # Datasource + generator config
│   │   ├── identity.prisma
│   │   ├── employee.prisma
│   │   ├── attendance.prisma
│   │   ├── payroll.prisma
│   │   ├── leave.prisma
│   │   ├── workflow.prisma
│   │   ├── policy.prisma
│   │   ├── audit.prisma
│   │   ├── events.prisma
│   │   ├── analytics.prisma
│   │   └── ai.prisma
│   ├── migrations/                    # All migration files
│   └── seeds/                         # Seed data per environment
│
├── scripts/                           # Operational scripts
│   ├── db/
│   │   ├── create-partitions.ts       # Partition maintenance
│   │   ├── archive-events.ts          # Event archival
│   │   └── tenant-migrate.ts          # Per-tenant migration runner
│   ├── codegen/
│   │   ├── generate-openapi.ts        # OpenAPI spec generation
│   │   ├── generate-event-types.ts    # Event schema type generation
│   │   └── generate-prisma-types.ts   # Prisma type extraction
│   └── ops/
│       ├── seed-tenant.ts             # Onboard new tenant with seed data
│       └── replay-events.ts           # Controlled event replay
│
├── docs/                              # Architecture documentation
│   ├── architecture/                  # This document and predecessors
│   ├── adr/                           # Architecture Decision Records
│   ├── runbooks/                      # Operational runbooks
│   └── api/                           # Generated API documentation
│
├── nx.json                            # Nx workspace configuration
├── pnpm-workspace.yaml                # pnpm workspace package declarations
├── turbo.json                         # Turborepo config (if hybrid approach)
├── package.json                       # Root package.json (scripts + devDeps)
├── tsconfig.base.json                 # Root TypeScript path aliases
├── .eslintrc.base.js                  # Root ESLint configuration
└── .github/
    ├── workflows/
    │   ├── ci.yml
    │   ├── deploy-staging.yml
    │   ├── deploy-production.yml
    │   └── preview.yml
    └── CODEOWNERS
```

---

## 2.3 Nx Project Graph and Dependency Rules

```
Dependency Rules (enforced by @nx/eslint-plugin-nx boundary rules):

apps/*         → can import: packages/*, domains/* (read-only for domains)
workers/*      → can import: packages/*, domains/*
packages/*     → can import: other packages/* (no circular dependencies)
               → CANNOT import: apps/*, workers/*, domains/*
domains/*      → can import: packages/*
               → CANNOT import: other domains/*, apps/*, workers/*

Circular Dependency Prevention:
  packages/contracts  → imports nothing from platform (only Zod, TypeScript)
  packages/database   → imports packages/contracts, packages/config
  packages/events     → imports packages/contracts, packages/database
  packages/auth       → imports packages/contracts, packages/config
  packages/observability → imports packages/config
  All others          → import from the above, not from each other

Nx .eslintrc enforcement:
  {
    "rules": {
      "@nx/enforce-module-boundaries": ["error", {
        "enforceBuildableLibDependency": true,
        "allow": [],
        "depConstraints": [
          {
            "sourceTag": "scope:domain",
            "onlyDependOnLibsWithTags": ["scope:platform"]
          },
          {
            "sourceTag": "scope:app",
            "onlyDependOnLibsWithTags": ["scope:platform", "scope:domain"]
          },
          {
            "sourceTag": "scope:platform",
            "onlyDependOnLibsWithTags": ["scope:platform"]
          }
        ]
      }]
    }
  }
```

---

## 2.4 pnpm Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
  - 'domains/*'
  - 'tooling/*'

# .npmrc
shamefully-hoist=false          # Strict hoisting (no phantom dependencies)
strict-peer-dependencies=true   # Fail on unmet peer deps
auto-install-peers=true
```

---

## 2.5 Root TypeScript Path Aliases

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@platform/contracts": ["packages/contracts/src/index.ts"],
      "@platform/contracts/*": ["packages/contracts/src/*"],
      "@platform/database": ["packages/database/src/index.ts"],
      "@platform/auth": ["packages/auth/src/index.ts"],
      "@platform/events": ["packages/events/src/index.ts"],
      "@platform/observability": ["packages/observability/src/index.ts"],
      "@platform/config": ["packages/config/src/index.ts"],
      "@platform/policy-engine": ["packages/policy-engine/src/index.ts"],
      "@platform/workflow-sdk": ["packages/workflow-sdk/src/index.ts"],
      "@platform/analytics-sdk": ["packages/analytics-sdk/src/index.ts"],
      "@platform/ai-sdk": ["packages/ai-sdk/src/index.ts"],
      "@platform/ui": ["packages/ui/src/index.ts"],
      "@platform/ui/*": ["packages/ui/src/*"],
      "@platform/testing": ["packages/testing/src/index.ts"],
      "@domain/identity": ["domains/identity/src/index.ts"],
      "@domain/attendance": ["domains/attendance/src/index.ts"],
      "@domain/payroll": ["domains/payroll/src/index.ts"],
      "@domain/leave": ["domains/leave/src/index.ts"],
      "@domain/workflow": ["domains/workflow/src/index.ts"],
      "@domain/employee": ["domains/employee/src/index.ts"],
      "@domain/policy": ["domains/policy/src/index.ts"],
      "@domain/notification": ["domains/notification/src/index.ts"],
      "@domain/ai": ["domains/ai/src/index.ts"]
    }
  }
}
```

---

# Section 3 — Application Boundaries

## 3.1 Application Inventory

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION TOPOLOGY                                  │
│                                                                         │
│  Browser/Mobile Layer                                                   │
│  ─────────────────────                                                  │
│  apps/admin          → HR Admin, Payroll Admin, System Config           │
│  apps/ess            → Employee Self-Service Portal                     │
│  apps/analytics-workspace → Analytics + Reporting + Dashboards         │
│  apps/ai-copilot     → AI Chat Interface (embedded in admin/ess)        │
│  apps/mobile         → React Native (iOS/Android) Field Workforce       │
│                                                                         │
│  API Layer                                                              │
│  ─────────                                                              │
│  apps/api            → Fastify Modular Monolith (all domain routes)     │
│                                                                         │
│  Worker Layer                                                           │
│  ─────────────                                                          │
│  workers/outbox-relay          → Transactional event publication        │
│  workers/analytics-projector   → Event → analytics read model           │
│  workers/ai-inference          → ML prediction + feature compute        │
│  workers/notification-dispatcher → Email/SMS/Push delivery             │
│  workers/attendance-processor  → Daily attendance batch compute         │
│  workers/payroll-compute       → Payroll run computation               │
│  workers/partition-manager     → DB partition create/archive            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3.2 apps/api — Backend Fastify Modular Monolith

**Responsibilities:** All HTTP API routes for the platform. Hosts all domain modules as Fastify plugins. Single deployable unit that contains the entire backend.

**Internal Structure:**
```
apps/api/
├── src/
│   ├── main.ts                  # Application bootstrap
│   ├── app.ts                   # Fastify application factory
│   ├── plugins/                 # Infrastructure plugins (loaded before routes)
│   │   ├── database.ts          # Prisma client registration
│   │   ├── auth.ts              # JWT verification + session plugin
│   │   ├── tenant.ts            # Tenant context injection
│   │   ├── observability.ts     # OpenTelemetry + Pino logger
│   │   ├── rate-limit.ts        # Per-tenant rate limiting
│   │   ├── cors.ts
│   │   └── health.ts            # Health + readiness endpoints
│   ├── routes/                  # Domain route mountpoints
│   │   ├── v1/
│   │   │   ├── index.ts         # Route aggregator
│   │   │   ├── attendance.ts    # Mounts @domain/attendance routes
│   │   │   ├── payroll.ts       # Mounts @domain/payroll routes
│   │   │   ├── leave.ts
│   │   │   ├── employee.ts
│   │   │   ├── workflow.ts
│   │   │   ├── policy.ts
│   │   │   ├── analytics.ts
│   │   │   └── ai.ts
│   │   └── legacy/              # Legacy API passthrough (see Section 15)
│   └── middleware/
│       ├── error-handler.ts
│       └── request-id.ts
├── Dockerfile
└── package.json
```

**Deployment:** Containerized. Deployed to Fly.io / Railway / AWS ECS. Horizontally scalable (stateless — no in-memory state between requests). Minimum 2 instances for availability.

**Scaling Characteristics:**
- CPU-bound for complex payroll computation (scale vertically before horizontally)
- Memory-bound for large payroll run contexts (512MB–2GB per instance)
- Connection-pool limited (PgBouncer in front of Supabase; max 100 connections total)
- Stateless: any instance can serve any request

**Shared Contracts Used:** `@platform/contracts`, `@platform/auth`, `@platform/database`, `@platform/events`, `@platform/observability`, `@platform/config`

---

## 3.3 apps/admin — HR Administration Platform

**Responsibilities:** HR administrators, payroll admins, system configuration, compliance management, workforce analytics, user management, policy management.

**Technical Stack:**
- Next.js 14 (App Router)
- TanStack Query v5 for server state
- Zustand for client state
- AG Grid Enterprise for large data tables
- Recharts / Visx for analytics charts
- Shadcn/ui + `@platform/ui` design system
- Supabase Realtime for live presence and notifications

**Key Application Sections:**
```
/dashboard          → Workforce overview, KPIs, live attendance
/attendance/*       → Attendance management, corrections, reports
/payroll/*          → Payroll runs, payslip management, statutory
/leave/*            → Leave policies, balance management, approval
/employees/*        → Employee management, org structure
/workflow/*         → Workflow template management, pending approvals
/policy/*           → Policy engine configuration
/analytics/*        → Reports, exports, trend analysis
/ai/*               → AI copilot, predictions, insights
/settings/*         → Tenant configuration, integrations
```

**Deployment:** Vercel (or Cloudflare Pages). CDN-hosted static assets. API routes for server actions only.

---

## 3.4 apps/ess — Employee Self-Service Portal

**Responsibilities:** Employee-facing portal. Leave applications, attendance history, payslip access, profile management, workflow approvals, AI copilot access.

**Design Principle:** ESS is a **read-heavy, interaction-light** application. The primary interactions are: view today's attendance, apply for leave, download payslip, submit expense. The architecture should be optimized for fast initial load and mobile-responsive rendering.

**Technical Stack:**
- Next.js 14 (App Router with aggressive static rendering where possible)
- Progressive Web App (PWA manifest + service worker for offline payslip caching)
- `@platform/ui` design system (ESS-specific responsive layouts)
- Supabase Realtime for live approval status updates
- React Hook Form for form interactions

**Key Application Sections:**
```
/home               → Today's status, pending actions, notifications
/attendance/*       → My attendance history, punch timeline
/leave/*            → My leave balance, apply, track approvals
/payslips/*         → Payslip history, download, YTD summary
/profile/*          → Profile viewing, emergency contact updates
/approvals/*        → Pending tasks assigned to me (manager role)
/ai/*               → Copilot for HR queries
```

**Deployment:** Vercel. Separate deployment from admin (different access patterns, different CSP policies).

---

## 3.5 apps/mobile — React Native Mobile Application

**Responsibilities:** Field workforce — GPS punch, attendance verification, leave application, offline capability, push notifications.

**Technical Stack:**
- Expo (React Native)
- Expo Router (file-based navigation)
- TanStack Query for API data + offline cache
- expo-location for GPS punch
- expo-camera for biometric integration hooks
- expo-notifications for push
- WatermelonDB for offline-first local data

**Critical Capabilities:**
- **Offline punch:** Employee can punch while offline. Punch stored locally with timestamp. Synced when connectivity restored. Conflict resolution: server time wins for duplicate punches within 5-minute window.
- **Geofenced punch validation:** GPS coordinates validated against location geofence on server. Mobile records coordinates; server validates.
- **Background sync:** Background fetch for pending sync items.

**Deployment:** Expo EAS (Expo Application Services) for builds. OTA updates for JS bundle changes. App Store / Play Store for native changes.

---

## 3.6 workers/outbox-relay

**Responsibilities:** Polls domain outbox tables. Publishes pending events to the event bus. Marks events as published. Routes failed events to DLQ.

**Technical Stack:**
- Node.js + TypeScript (no framework overhead needed)
- Postgres `SELECT FOR UPDATE SKIP LOCKED` for concurrent-safe polling
- BullMQ (Redis-backed) as the event bus in Phase 2
- Prometheus metrics for relay lag, failure rate, DLQ growth

**Scaling:** Single process per domain outbox (to maintain ordering guarantees). If throughput exceeds single-process capacity, increase polling batch size before scaling workers.

**Deployment:** Long-running process. Not HTTP-exposed. Kubernetes pod or Fly.io process with auto-restart.

---

## 3.7 workers/attendance-processor

**Responsibilities:** Daily batch job — for each employee, resolves shift, computes hours, marks attendance status, creates daily summary record. Runs nightly (configurable) and on-demand for corrections.

**Technical Stack:**
- Node.js + TypeScript
- BullMQ for job queue (job per tenant, fan-out to per-employee jobs)
- `@domain/attendance` business logic reused directly
- `@platform/policy-engine` for policy resolution at computation time
- pg_advisory_lock per employee to prevent concurrent processing

**Scaling:** One BullMQ worker pool per tenant tier. Enterprise tenants get dedicated queue with higher concurrency.

---

## 3.8 workers/ai-inference

**Responsibilities:** Asynchronous ML model inference. Feature computation. Attrition prediction. Absence risk scoring. Payroll anomaly detection. Periodic batch prediction sweeps.

**Technical Stack:**
- Node.js + TypeScript (orchestration layer)
- Python subprocess (or separate Python service) for heavy ML computation
- `@platform/ai-sdk` for feature retrieval and prediction persistence
- BullMQ for job scheduling
- GPU-capable instance for future model inference (CPU-only for initial phase)

**Scaling:** Scale out by tenant cohort. Enterprise tenants' prediction jobs run in dedicated queue. Inference is stateless — scale horizontally.



---


# Section 4 — Shared Package Architecture

## 4.1 Package Ownership and Dependency Map

```
┌────────────────────────────────────────────────────────────────────────┐
│                 SHARED PACKAGE DEPENDENCY HIERARCHY                     │
│                                                                        │
│  LAYER 0 (no internal dependencies):                                   │
│    @platform/contracts  ─── Zod schemas, TypeScript types, event defs  │
│    @tooling/tsconfig    ─── TypeScript base configs                     │
│    @tooling/eslint-config ─ ESLint rules                               │
│                                                                        │
│  LAYER 1 (depends on Layer 0 only):                                    │
│    @platform/config     ─── Env schema + loader                        │
│    @platform/observability ─ Logger, tracer, metrics                   │
│                                                                        │
│  LAYER 2 (depends on Layer 0–1):                                       │
│    @platform/database   ─── Prisma client, repositories, UoW           │
│    @platform/auth       ─── JWT, sessions, RBAC                        │
│    @platform/events     ─── Event bus, outbox, envelope                │
│                                                                        │
│  LAYER 3 (depends on Layer 0–2):                                       │
│    @platform/policy-engine   ─ Policy resolution                       │
│    @platform/workflow-sdk    ─ Workflow execution                       │
│    @platform/analytics-sdk   ─ Projection + ClickHouse                 │
│    @platform/ai-sdk          ─ Orchestration + features                │
│                                                                        │
│  LAYER 4 (frontend only, no backend imports):                          │
│    @platform/ui         ─── Components, tokens, charts, grids          │
│                                                                        │
│  CROSS-CUTTING (test environments only):                               │
│    @platform/testing    ─── Factories, mocks, fixtures                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4.2 @platform/contracts — The Source of Truth

This is the most critical package in the entire monorepo. Every API request shape, response shape, event schema, and domain type originates here.

**Public API:**
```typescript
// packages/contracts/src/index.ts — selective exports

// Domain schemas (Zod)
export * from './schemas/employee';
export * from './schemas/attendance';
export * from './schemas/payroll';
export * from './schemas/leave';
export * from './schemas/workflow';
export * from './schemas/policy';

// Inferred TypeScript types
export type * from './dtos/employee';
export type * from './dtos/attendance';
export type * from './dtos/payroll';
export type * from './dtos/leave';

// Event definitions
export * from './events/employee-events';
export * from './events/attendance-events';
export * from './events/payroll-events';
export * from './events/leave-events';
export * from './events/workflow-events';

// Shared value types
export * from './types/common';
export * from './types/pagination';
export * from './types/errors';
```

**Schema Design Pattern (Zod-first):**
```typescript
// packages/contracts/src/schemas/attendance.ts
import { z } from 'zod';

// Base schema — shared across create/update/response
const PunchRecordBase = z.object({
  employeeId:       z.string().uuid(),
  punchType:        z.enum(['in', 'out', 'break_start', 'break_end',
                            'overtime_in', 'overtime_out']),
  punchSource:      z.enum(['biometric', 'mobile_gps', 'web', 'manual', 'system']),
  punchedAt:        z.string().datetime({ offset: true }),  // ISO 8601 with timezone
  locationId:       z.string().uuid().optional(),
  latitude:         z.number().min(-90).max(90).optional(),
  longitude:        z.number().min(-180).max(180).optional(),
});

// Request schema (for API validation)
export const CreatePunchRecordSchema = PunchRecordBase.extend({
  deviceId: z.string().uuid().optional(),
  rawBiometricRef: z.string().max(256).optional(),
});

// Response schema (what API returns — superset of base)
export const PunchRecordResponseSchema = PunchRecordBase.extend({
  id:               z.string().uuid(),
  tenantId:         z.string().uuid(),
  effectiveAt:      z.string().datetime({ offset: true }),
  serverReceivedAt: z.string().datetime({ offset: true }),
  status:           z.enum(['raw', 'validated', 'processed', 'voided']),
  geofenceStatus:   z.enum(['inside', 'outside', 'unknown']).optional(),
  shiftId:          z.string().uuid().optional(),
  validationFlags:  z.record(z.unknown()).optional(),
});

// Inferred types (no manual type duplication)
export type CreatePunchRecordDto = z.infer<typeof CreatePunchRecordSchema>;
export type PunchRecordResponse  = z.infer<typeof PunchRecordResponseSchema>;

// Pagination wrapper
export const PunchRecordListResponseSchema = z.object({
  data:       z.array(PunchRecordResponseSchema),
  pagination: PaginationSchema,
});
export type PunchRecordListResponse = z.infer<typeof PunchRecordListResponseSchema>;
```

**Dependency Rules:**
- `@platform/contracts` imports ONLY from: `zod`, `typescript` (type-only)
- No runtime dependencies on platform packages
- No Node.js built-in imports (must be importable in browser and server)
- Package is published as ESM + CommonJS dual format

**Versioning Strategy:**
- Breaking schema changes (field removal, type narrowing) require a major version bump
- Additive changes (new optional field) are minor versions
- All consumers receive TypeScript errors on breaking changes before runtime failure
- Deprecation: add `@deprecated` JSDoc + maintain the field for 2 release cycles

---

## 4.3 @platform/database — Data Access Foundation

**Public API:**
```typescript
// packages/database/src/index.ts
export { createPrismaClient, type PrismaClientOptions } from './client';
export { TenantContext } from './tenant-context';
export { UnitOfWork, createUnitOfWork } from './unit-of-work';
export { BaseRepository } from './repositories/base';
export type { Repository, ReadRepository } from './repositories/interfaces';
```

**Prisma Client Factory:**
```typescript
// packages/database/src/client.ts
import { PrismaClient } from '@prisma/client';
import { logger } from '@platform/observability';

let instance: PrismaClient | null = null;

export function createPrismaClient(options?: PrismaClientOptions): PrismaClient {
  if (instance) return instance;

  instance = new PrismaClient({
    log: [
      { level: 'warn',  emit: 'event' },
      { level: 'error', emit: 'event' },
      // Query logging only in development (performance overhead in prod)
      ...(process.env.NODE_ENV === 'development'
        ? [{ level: 'query' as const, emit: 'event' as const }]
        : []),
    ],
    datasources: {
      db: { url: options?.databaseUrl ?? process.env.DATABASE_URL },
    },
  });

  // Structured query logging
  instance.$on('warn',  (e) => logger.warn({ source: 'prisma', message: e.message }));
  instance.$on('error', (e) => logger.error({ source: 'prisma', message: e.message }));

  // Middleware: inject tenant context for RLS
  instance.$use(async (params, next) => {
    const tenantId = TenantContext.current()?.tenantId;
    if (tenantId) {
      await instance!.$executeRaw`
        SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)
      `;
    }
    return next(params);
  });

  return instance;
}
```

**Tenant Context — AsyncLocalStorage Pattern:**
```typescript
// packages/database/src/tenant-context.ts
import { AsyncLocalStorage } from 'async_hooks';

interface TenantContextData {
  tenantId: string;
  userId:   string;
  roles:    string[];
}

const storage = new AsyncLocalStorage<TenantContextData>();

export const TenantContext = {
  run<T>(data: TenantContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  current(): TenantContextData | undefined {
    return storage.getStore();
  },
  require(): TenantContextData {
    const ctx = storage.getStore();
    if (!ctx) throw new Error(
      'TenantContext not initialized. Ensure request flows through tenant middleware.'
    );
    return ctx;
  },
};
```

---

## 4.4 @platform/events — Event Bus and Outbox

**Public API:**
```typescript
// packages/events/src/index.ts
export type { EventBus, EventHandler, PublishOptions } from './bus/interfaces';
export { InProcessEventBus } from './bus/in-process';
export { BullMQEventBus } from './bus/bullmq';            // Phase 2
export { OutboxWriter } from './outbox/writer';
export { EventEnvelope, createEventEnvelope } from './schemas/envelope';
export type { DomainEvent } from './types';
```

**Event Bus Interface:**
```typescript
// packages/events/src/bus/interfaces.ts
export interface EventBus {
  publish<T extends DomainEvent>(
    event: T,
    options?: PublishOptions
  ): Promise<void>;

  publishBatch<T extends DomainEvent>(
    events: T[],
    options?: PublishOptions
  ): Promise<void>;

  subscribe<T extends DomainEvent>(
    eventType: string | string[],
    handler: EventHandler<T>,
    options?: SubscribeOptions
  ): Disposable;
}

export interface EventHandler<T extends DomainEvent> {
  handle(event: T): Promise<void>;
  onError?(error: Error, event: T): Promise<void>;
}

export interface PublishOptions {
  delay?:    number;     // Milliseconds delay before delivery
  priority?: number;     // Lower = higher priority
  idempotencyKey?: string;
}
```

**Outbox Writer — Transactional Event Persistence:**
```typescript
// packages/events/src/outbox/writer.ts
import { PrismaClient } from '@prisma/client';
import type { DomainEvent } from '../types';
import { createEventEnvelope } from '../schemas/envelope';

export class OutboxWriter {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Write event to outbox within the SAME transaction as the domain mutation.
   * Called from within a Prisma.$transaction() block.
   */
  async write<T extends DomainEvent>(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    event: T,
    options?: { domain: string; priority?: number }
  ): Promise<void> {
    const envelope = createEventEnvelope(event);
    const tableName = `${options?.domain ?? 'events'}.outbox`;

    await tx.$executeRaw`
      INSERT INTO ${tableName} (
        event_id, tenant_id, event_type, event_version,
        aggregate_type, aggregate_id, correlation_id,
        payload, metadata, priority
      ) VALUES (
        ${envelope.eventId}::UUID,
        ${envelope.tenantId}::UUID,
        ${envelope.eventType},
        ${envelope.eventVersion},
        ${envelope.aggregateType},
        ${envelope.aggregateId}::UUID,
        ${envelope.correlationId}::UUID,
        ${JSON.stringify(envelope.payload)}::JSONB,
        ${JSON.stringify(envelope.metadata)}::JSONB,
        ${options?.priority ?? 100}
      )
    `;
  }
}
```

---

## 4.5 @platform/auth — Authentication and Authorization

**Public API:**
```typescript
// packages/auth/src/index.ts
export { verifyJwt, signJwt, type JwtPayload } from './jwt';
export { fastifyAuthPlugin }  from './middleware/fastify';
export { nextjsAuthMiddleware } from './middleware/nextjs';
export { RBAC, Permission, type PermissionCheck } from './rbac';
export { TenantResolver } from './tenant-resolver';
```

**JWT Payload Standard:**
```typescript
// packages/auth/src/jwt.ts
import { z } from 'zod';

export const JwtPayloadSchema = z.object({
  sub:        z.string().uuid(),          // user_id
  email:      z.string().email(),
  tenant_id:  z.string().uuid(),
  roles:      z.array(z.string()),
  permissions: z.array(z.string()),
  iat:        z.number(),
  exp:        z.number(),
  jti:        z.string().uuid(),          // JWT ID for revocation
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;

export async function verifyJwt(token: string): Promise<JwtPayload> {
  // Verify signature, expiry, and parse claims
  // Implementation uses jose (platform-agnostic JWT library)
}
```

**Fastify Auth Plugin:**
```typescript
// packages/auth/src/middleware/fastify.ts
import fp from 'fastify-plugin';
import { verifyJwt } from '../jwt';
import { TenantContext } from '@platform/database';
import { logger } from '@platform/observability';

export const fastifyAuthPlugin = fp(async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      // Skip for public routes (check route config)
      if (!request.routeConfig?.isPublic) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      }
      return;
    }

    try {
      const token   = authHeader.slice(7);
      const payload = await verifyJwt(token);

      // Inject into request for downstream handlers
      request.user = payload;

      // Initialize AsyncLocalStorage tenant context for database middleware
      TenantContext.run(
        { tenantId: payload.tenant_id, userId: payload.sub, roles: payload.roles },
        () => { /* context lives for request duration */ }
      );

    } catch (err) {
      logger.warn({ err, path: request.url }, 'JWT verification failed');
      return reply.code(401).send({ error: 'INVALID_TOKEN' });
    }
  });
});
```

**RBAC Implementation:**
```typescript
// packages/auth/src/rbac.ts
export const Permission = {
  // Attendance
  ATTENDANCE_VIEW_OWN:    'attendance:view:own',
  ATTENDANCE_VIEW_TEAM:   'attendance:view:team',
  ATTENDANCE_VIEW_ALL:    'attendance:view:all',
  ATTENDANCE_CORRECT:     'attendance:correct',
  // Payroll
  PAYROLL_VIEW_OWN:       'payroll:view:own',
  PAYROLL_RUN:            'payroll:run',
  PAYROLL_APPROVE:        'payroll:approve',
  PAYROLL_FINALIZE:       'payroll:finalize',
  // Leave
  LEAVE_APPLY:            'leave:apply',
  LEAVE_APPROVE_TEAM:     'leave:approve:team',
  LEAVE_APPROVE_ALL:      'leave:approve:all',
  // AI
  AI_COPILOT_ACCESS:      'ai:copilot:access',
  AI_PREDICTIONS_VIEW:    'ai:predictions:view',
  // Admin
  SYSTEM_ADMIN:           'system:admin',
} as const;

export type PermissionKey = keyof typeof Permission;
export type PermissionValue = (typeof Permission)[PermissionKey];

export const RBAC = {
  hasPermission(userPermissions: string[], required: PermissionValue): boolean {
    return userPermissions.includes(required) ||
           userPermissions.includes(Permission.SYSTEM_ADMIN);
  },
  requirePermission(userPermissions: string[], required: PermissionValue): void {
    if (!this.hasPermission(userPermissions, required)) {
      throw new PermissionDeniedError(required);
    }
  },
};
```

---

## 4.6 @platform/observability — Structured Telemetry

**Public API:**
```typescript
// packages/observability/src/index.ts
export { createLogger, logger }  from './logger';
export { tracer, startSpan }     from './tracer';
export { metrics, counters, histograms } from './metrics';
export { correlationMiddleware } from './middleware/correlation';
export { withCorrelationId, getCorrelationId } from './correlation';
```

**Pino Structured Logger:**
```typescript
// packages/observability/src/logger.ts
import pino from 'pino';
import { config } from '@platform/config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    service: config.SERVICE_NAME,
    version: config.APP_VERSION,
    env:     config.NODE_ENV,
  },
  redact: {
    // Never log PII in structured logs
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.national_id',
      '*.bank_account',
      '*.personal_email',
    ],
    censor: '[REDACTED]',
  },
  transport: config.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined, // Production: JSON to stdout → aggregated by log collector
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  hooks: {
    logMethod(inputArgs, method) {
      // Auto-inject correlation ID and tenant context into every log line
      const ctx = TenantContext.current();
      if (ctx) {
        inputArgs[0] = {
          ...inputArgs[0],
          tenantId:      ctx.tenantId,
          userId:        ctx.userId,
          correlationId: getCorrelationId(),
        };
      }
      return method.apply(this, inputArgs);
    },
  },
});
```

**OpenTelemetry Tracer Setup:**
```typescript
// packages/observability/src/tracer.ts
import { NodeTracerProvider } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { config } from '@platform/config';

const provider = new NodeTracerProvider({
  resource: Resource.default().merge(new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]:    config.SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_VERSION]: config.APP_VERSION,
    'deployment.environment': config.NODE_ENV,
  })),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: config.OTEL_EXPORTER_OTLP_ENDPOINT }),
      { maxExportBatchSize: 512, scheduledDelayMillis: 5000 }
    ),
  ],
});
provider.register();

export const tracer = provider.getTracer(config.SERVICE_NAME, config.APP_VERSION);

export function startSpan<T>(
  name: string,
  attributes: Record<string, string | number>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

---

## 4.7 @platform/config — Centralized Configuration

```typescript
// packages/config/src/schema.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  // Application identity
  NODE_ENV:        z.enum(['development', 'test', 'staging', 'production']),
  SERVICE_NAME:    z.string().min(1),
  APP_VERSION:     z.string().min(1).default('0.0.0'),

  // Database
  DATABASE_URL:    z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  DIRECT_URL:      z.string().url().optional(), // Supabase direct connection

  // Redis (Phase 2+)
  REDIS_URL:       z.string().url().optional(),

  // Auth
  JWT_SECRET:      z.string().min(32),
  JWT_EXPIRY:      z.string().default('1h'),
  SESSION_SECRET:  z.string().min(32),

  // Observability
  LOG_LEVEL:       z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN:      z.string().url().optional(),

  // AI
  OPENAI_API_KEY:  z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_GATEWAY_URL:  z.string().url().optional(),

  // Feature flags
  FF_CLICKHOUSE_ENABLED: z.coerce.boolean().default(false),
  FF_KAFKA_ENABLED:      z.coerce.boolean().default(false),
  FF_AI_PREDICTIONS:     z.coerce.boolean().default(false),

  // URLs
  API_BASE_URL:    z.string().url(),
  ADMIN_URL:       z.string().url(),
  ESS_URL:         z.string().url(),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid configuration:');
    result.error.issues.forEach(issue => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);  // Fail fast on misconfiguration
  }
  _config = result.data;
  return _config;
}

export const config = new Proxy({} as Config, {
  get(_, prop: string) {
    return loadConfig()[prop as keyof Config];
  },
});
```

---

## 4.8 @platform/ui — Design System Package

**Ownership:** Frontend Platform team. Not owned by any feature domain.

**Key Exports:**
```typescript
// packages/ui/src/index.ts

// Primitives
export * from './components/Button';
export * from './components/Input';
export * from './components/Select';
export * from './components/DatePicker';
export * from './components/Modal';
export * from './components/Drawer';
export * from './components/Toast';
export * from './components/Badge';

// Tokens
export * from './tokens/colors';
export * from './tokens/typography';
export * from './tokens/spacing';
export * from './tokens/shadows';

// Data display
export * from './data-grid/WorkforceGrid';
export * from './data-grid/GridToolbar';
export * from './charts/AttendanceHeatmap';
export * from './charts/TrendLine';
export * from './charts/PayrollWaterfall';
export * from './charts/WorkforceDonut';

// Workspace shells
export * from './workspace/AppShell';
export * from './workspace/Sidebar';
export * from './workspace/CommandPalette';
export * from './workspace/NotificationCenter';

// AI components
export * from './ai/CopilotPanel';
export * from './ai/InsightCard';
export * from './ai/PredictionBadge';

// Operational widgets
export * from './widgets/AttendanceWidget';
export * from './widgets/LeaveBalanceWidget';
export * from './widgets/PayslipWidget';
export * from './widgets/WorkforceKpiCard';
```

---

# Section 5 — Contract-First Development Architecture

## 5.1 The Contract Pipeline

```
┌───────────────────────────────────────────────────────────────────────┐
│                    CONTRACT GENERATION PIPELINE                        │
│                                                                       │
│  ┌────────────────────┐                                               │
│  │  @platform/        │  Source of Truth                              │
│  │  contracts         │  Zod schemas + event definitions              │
│  └────────┬───────────┘                                               │
│           │                                                           │
│    ┌──────▼──────────────────────────────────────┐                   │
│    │           CODEGEN PIPELINE (scripts/codegen/)│                   │
│    │                                             │                    │
│    │  generate-openapi.ts                        │                    │
│    │    → apps/api routes export Zod schemas     │                    │
│    │    → fastify-zod generates JSON Schema      │                    │
│    │    → openapi-typescript generates spec      │                    │
│    │                                             │                    │
│    │  generate-event-types.ts                    │                    │
│    │    → Event schemas → TypeScript types       │                    │
│    │    → AsyncAPI spec (for documentation)      │                    │
│    └──────┬──────────────────────────────────────┘                   │
│           │                                                           │
│    ┌──────▼──────────────────────────────────────┐                   │
│    │           GENERATED ARTIFACTS (do not edit) │                   │
│    │                                             │                    │
│    │  packages/contracts/src/openapi/            │                    │
│    │    openapi.json                             │                    │
│    │                                             │                    │
│    │  packages/contracts/src/events/             │                    │
│    │    generated-event-types.ts                 │                    │
│    └──────┬──────────────────────────────────────┘                   │
│           │                                                           │
│    ┌──────▼──────────────────────────────────────┐                   │
│    │           CONSUMER GENERATION               │                    │
│    │                                             │                    │
│    │  apps/admin/src/api/client.ts    (openapi-fetch)                 │
│    │  apps/ess/src/api/client.ts      (openapi-fetch)                 │
│    │  apps/mobile/src/api/client.ts   (openapi-fetch)                 │
│    └─────────────────────────────────────────────┘                   │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 5.2 Backend Route Registration with Type Safety

```typescript
// apps/api/src/routes/v1/attendance.ts
import { FastifyInstance } from 'fastify';
import {
  CreatePunchRecordSchema,
  PunchRecordResponseSchema,
  PunchRecordListResponseSchema,
  type CreatePunchRecordDto,
} from '@platform/contracts';
import { AttendanceController } from '@domain/attendance';

export async function attendanceRoutes(fastify: FastifyInstance) {

  // POST /api/v1/attendance/punches
  fastify.route({
    method: 'POST',
    url: '/punches',
    schema: {
      // Zod schema auto-converts to JSON Schema for Fastify validation
      body: CreatePunchRecordSchema,
      response: {
        201: PunchRecordResponseSchema,
      },
      tags: ['Attendance'],
      summary: 'Record an attendance punch',
    },
    preHandler: [fastify.authenticate, fastify.requirePermission('attendance:punch')],
    handler: async (request, reply) => {
      const dto = request.body as CreatePunchRecordDto;
      const result = await AttendanceController.createPunch(dto, request.user);
      return reply.code(201).send(result);
    },
  });

  // GET /api/v1/attendance/daily?employeeId=&from=&to=
  fastify.route({
    method: 'GET',
    url: '/daily',
    schema: {
      querystring: z.object({
        employeeId: z.string().uuid().optional(),
        from:       z.string().date(),
        to:         z.string().date(),
        page:       z.coerce.number().default(1),
        pageSize:   z.coerce.number().min(1).max(100).default(50),
      }),
      response: { 200: PunchRecordListResponseSchema },
    },
    handler: async (request, reply) => {
      return AttendanceController.getDailyAttendance(request.query, request.user);
    },
  });
}
```

---

## 5.3 OpenAPI Generation Script

```typescript
// scripts/codegen/generate-openapi.ts
import { generateOpenApi } from 'fastify-zod';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

async function main() {
  // Import the full Fastify app (without listening)
  const { buildApp } = await import('../../apps/api/src/app');
  const app = await buildApp({ forCodegen: true });

  await app.ready();

  const openApiSpec = app.swagger();

  const outputPath = resolve(
    __dirname,
    '../../packages/contracts/src/openapi/openapi.json'
  );
  writeFileSync(outputPath, JSON.stringify(openApiSpec, null, 2));
  console.log(`✅ OpenAPI spec written to ${outputPath}`);

  // Also generate TypeScript types for frontend consumption
  const { execSync } = await import('child_process');
  execSync(`openapi-typescript ${outputPath} --output packages/contracts/src/openapi/types.ts`);
  console.log('✅ TypeScript API types generated');

  await app.close();
}

main().catch(console.error);
```

---

## 5.4 Frontend API Client — Type-Safe HTTP

```typescript
// Generated: apps/admin/src/api/client.ts (do not edit manually)
// Regenerated by: pnpm codegen:openapi

import createClient from 'openapi-fetch';
import type { paths } from '@platform/contracts/openapi/types';

export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
  // Auth header injection
  fetch: (url, init) => {
    const token = getAuthToken();
    return fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        'Authorization': token ? `Bearer ${token}` : '',
        'X-Correlation-ID': generateCorrelationId(),
      },
    });
  },
});

// Usage in component (fully type-safe — TypeScript errors if schema changes):
async function fetchAttendance(employeeId: string, from: string, to: string) {
  const { data, error } = await apiClient.GET('/api/v1/attendance/daily', {
    params: {
      query: { employeeId, from, to, page: 1, pageSize: 50 },
    },
  });
  // `data` type is inferred from PunchRecordListResponseSchema
  // `error` is typed as the error response schema
  return { data, error };
}
```

---

## 5.5 Event Contract Generation

```typescript
// packages/contracts/src/events/attendance-events.ts
import { z } from 'zod';
import { EventEnvelopeBase } from './base';

export const AttendancePunchedEventSchema = EventEnvelopeBase.extend({
  eventType:  z.literal('attendance.punched'),
  payload: z.object({
    punchRecordId:   z.string().uuid(),
    employeeId:      z.string().uuid(),
    punchType:       z.enum(['in', 'out', 'break_start', 'break_end']),
    punchSource:     z.enum(['biometric', 'mobile_gps', 'web', 'manual']),
    effectiveAt:     z.string().datetime({ offset: true }),
    locationId:      z.string().uuid().optional(),
    latitude:        z.number().optional(),
    longitude:       z.number().optional(),
    geofenceStatus:  z.enum(['inside', 'outside', 'unknown']).optional(),
  }),
});

export type AttendancePunchedEvent = z.infer<typeof AttendancePunchedEventSchema>;

// AsyncAPI spec generation from these schemas:
// scripts/codegen/generate-event-types.ts reads all event schemas
// and generates AsyncAPI 3.0 spec for documentation + contract testing
```

---

## 5.6 Contract Drift Prevention — CI Enforcement

```yaml
# .github/workflows/contract-validation.yml
name: Contract Validation

on: [push, pull_request]

jobs:
  validate-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm + Node
        uses: pnpm/action-setup@v4

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Regenerate OpenAPI spec
        run: pnpm codegen:openapi

      - name: Assert no drift
        run: |
          if ! git diff --quiet packages/contracts/src/openapi/; then
            echo "❌ OpenAPI spec has drifted from route definitions."
            echo "   Run 'pnpm codegen:openapi' locally and commit the result."
            git diff packages/contracts/src/openapi/
            exit 1
          fi
          echo "✅ OpenAPI spec is up to date"

      - name: Type-check all packages
        run: pnpm nx run-many --target=typecheck --all --parallel=6

      - name: Validate event schemas
        run: pnpm run validate:event-schemas
```

---

# Section 6 — Database Tooling + Migration Foundation

## 6.1 Prisma Schema Strategy — Split Schema Files

A single `schema.prisma` file for a platform with 22 domains becomes unmaintainable quickly. The Workforce OS uses Prisma's `prismaSchemaFolder` preview feature to split schemas by domain:

```
prisma/
└── schema/
    ├── base.prisma           # datasource + generator (shared)
    ├── identity.prisma       # identity schema tables
    ├── employee.prisma       # employee schema tables
    ├── attendance.prisma     # attendance schema tables
    └── ...
```

```prisma
// prisma/schema/base.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder", "multiSchema"]
  output          = "../node_modules/.prisma/client"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")     // Supabase: bypass PgBouncer for migrations
  schemas   = [
    "identity", "org", "employee", "attendance",
    "leave", "payroll", "workflow", "policy",
    "audit", "events", "analytics", "ai"
  ]
}
```

```prisma
// prisma/schema/attendance.prisma
model PunchRecord {
  id               String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId         String    @db.Uuid
  employeeId       String    @db.Uuid
  punchType        String    @db.VarChar(32)
  punchSource      String    @db.VarChar(32)
  punchedAt        DateTime  @db.Timestamptz
  serverReceivedAt DateTime  @default(now()) @db.Timestamptz
  effectiveAt      DateTime  @db.Timestamptz
  status           String    @default("raw") @db.VarChar(32)
  locationId       String?   @db.Uuid
  latitude         Decimal?  @db.Decimal(10, 7)
  longitude        Decimal?  @db.Decimal(10, 7)
  geofenceStatus   String?   @db.VarChar(32)
  shiftId          String?   @db.Uuid
  validationFlags  Json?

  @@index([tenantId, employeeId, effectiveAt])
  @@index([tenantId, effectiveAt])
  @@schema("attendance")
  @@map("punch_records")
}
```

---

## 6.2 Migration Governance Process

```
Migration Lifecycle:

┌──────────────────────────────────────────────────────────────┐
│  STEP 1: CREATE MIGRATION                                     │
│  Developer runs: pnpm nx run api:prisma-migrate-dev          │
│  Prisma generates: prisma/migrations/{timestamp}_{name}/     │
│    ├── migration.sql      (auto-generated, review before PR) │
│    ├── rollback.sql       (manually authored, required)      │
│    └── migration.md       (impact + rationale, required)     │
├──────────────────────────────────────────────────────────────┤
│  STEP 2: REVIEW                                               │
│  PR created. Migration review checklist:                      │
│   □ No long-hold locks (check for LOCK TABLE statements)     │
│   □ Additive only (no destructive changes in same deploy)    │
│   □ Partition-aware (if high-volume table)                   │
│   □ RLS policy included if new table                         │
│   □ Rollback procedure verified                              │
│   □ pgTAP tests added for new schema                         │
├──────────────────────────────────────────────────────────────┤
│  STEP 3: CI VALIDATION                                        │
│   - Migrate fresh test database                              │
│   - Run pgTAP assertions                                     │
│   - Run full test suite against migrated schema              │
│   - Check for drift between Prisma schema and migration SQL  │
├──────────────────────────────────────────────────────────────┤
│  STEP 4: STAGING DEPLOY                                       │
│   - Auto-applied on merge to staging branch                  │
│   - Staging is a production-equivalent DB                    │
│   - Migration smoke tests run post-apply                     │
├──────────────────────────────────────────────────────────────┤
│  STEP 5: PRODUCTION DEPLOY                                    │
│   - Manual promotion via GitHub Actions workflow             │
│   - Requires LGTM from database reviewer                    │
│   - Applied before new application version (backward compat) │
│   - Zero-downtime patterns required for any table >1M rows   │
└──────────────────────────────────────────────────────────────┘
```

---

## 6.3 Custom Nx Executor for Prisma Migrations

```typescript
// tooling/nx-plugins/executors/prisma-migrate/executor.ts
import { ExecutorContext, runExecutor } from '@nx/devkit';

interface PrismaMigrateOptions {
  schema:        string;
  environment:   'development' | 'staging' | 'production';
  createOnly?:   boolean;
  name?:         string;
}

export default async function prismaMigrateExecutor(
  options: PrismaMigrateOptions,
  context: ExecutorContext
): Promise<{ success: boolean }> {

  const { execSync } = require('child_process');
  const env = {
    ...process.env,
    DATABASE_URL: process.env[`${options.environment.toUpperCase()}_DATABASE_URL`],
  };

  try {
    if (options.createOnly) {
      execSync(
        `prisma migrate dev --schema=${options.schema} --create-only --name=${options.name}`,
        { stdio: 'inherit', env }
      );
    } else if (options.environment === 'development') {
      execSync(
        `prisma migrate dev --schema=${options.schema}`,
        { stdio: 'inherit', env }
      );
    } else {
      // Production/staging: deploy only (no interactive prompts)
      execSync(
        `prisma migrate deploy --schema=${options.schema}`,
        { stdio: 'inherit', env }
      );
    }
    return { success: true };
  } catch (err) {
    console.error('Migration failed:', err);
    return { success: false };
  }
}
```

---

## 6.4 Seed Architecture

```
prisma/seeds/
├── base/
│   ├── 00-platform-defaults.ts    # Platform-level policies, roles
│   ├── 01-test-tenants.ts         # Test tenant bootstrapping
│   └── 02-dim-date.ts             # Analytics calendar dimension
├── development/
│   ├── 10-demo-tenant.ts          # Full demo tenant (5000 employees)
│   ├── 11-attendance-history.ts   # 90 days of synthetic attendance
│   └── 12-payroll-history.ts      # 3 payroll periods of data
└── test/
    ├── 10-minimal-tenant.ts       # Single tenant, 10 employees (fast)
    └── 11-multi-tenant.ts         # 3 tenants (isolation testing)
```

```typescript
// prisma/seeds/base/00-platform-defaults.ts
import { PrismaClient } from '@prisma/client';

export async function seedPlatformDefaults(prisma: PrismaClient) {
  // System roles (tenant_id = NULL = platform-wide)
  const systemRoles = [
    { name: 'system_admin',   permissions: ['system:admin'] },
    { name: 'hr_admin',       permissions: ['attendance:view:all', 'payroll:run', ...] },
    { name: 'payroll_admin',  permissions: ['payroll:run', 'payroll:approve', ...] },
    { name: 'manager',        permissions: ['attendance:view:team', 'leave:approve:team', ...] },
    { name: 'employee',       permissions: ['attendance:view:own', 'leave:apply', ...] },
  ];

  for (const role of systemRoles) {
    await prisma.role.upsert({
      where: { name_tenantId: { name: role.name, tenantId: 'system' } },
      update: { permissions: role.permissions },
      create: { name: role.name, permissions: role.permissions, isSystem: true },
    });
  }

  // Platform-default attendance policies
  await seedDefaultAttendancePolicies(prisma);
  await seedDefaultLeavePolicies(prisma);
}
```

---

## 6.5 Tenant-Safe Migration Runner

For enterprise (schema-per-tenant) configurations, migrations run per tenant:

```typescript
// scripts/db/tenant-migrate.ts
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

async function migrateAllTenants() {
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const tenants = await db.tenant.findMany({ where: { status: 'active', tier: 'enterprise' } });

  console.log(`Migrating ${tenants.length} enterprise tenant schemas...`);

  const results = { success: 0, failed: 0, errors: [] as string[] };

  for (const tenant of tenants) {
    const schemaUrl = `${process.env.DATABASE_URL}?schema=${tenant.externalId}`;
    try {
      execSync(`prisma migrate deploy --schema=prisma/schema`, {
        env: { ...process.env, DATABASE_URL: schemaUrl },
        stdio: 'pipe',
      });
      results.success++;
      console.log(`  ✅ ${tenant.externalId}`);
    } catch (err) {
      results.failed++;
      results.errors.push(`${tenant.externalId}: ${err}`);
      console.error(`  ❌ ${tenant.externalId}: ${err}`);
      // STOP on first failure — do not cascade broken migration across all tenants
      if (process.env.FAIL_FAST === 'true') break;
    }
  }

  console.log(`\nMigration complete: ${results.success} succeeded, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
}

migrateAllTenants();
```



---


# Section 7 — Repository + Unit of Work Architecture

## 7.1 Repository Interface Hierarchy

```
┌──────────────────────────────────────────────────────────────────┐
│                 REPOSITORY LAYER HIERARCHY                        │
│                                                                  │
│  packages/database/src/repositories/interfaces.ts                │
│  ─────────────────────────────────────────────────               │
│                                                                  │
│  Repository<T>                 ← Read + Write operations         │
│    ├── findById(id)                                              │
│    ├── findMany(filter)                                          │
│    ├── save(entity)                                              │
│    ├── saveMany(entities[])                                      │
│    └── delete(id)                                                │
│                                                                  │
│  ReadRepository<T>             ← Read-only (analytics/cache)    │
│    ├── findById(id)                                              │
│    └── findMany(filter)                                          │
│                                                                  │
│  Domain repositories extend base:                                │
│    AttendanceRepository extends Repository<DailyAttendance>     │
│    PayrollRepository    extends Repository<PayrollRun>          │
│    LeaveRepository      extends Repository<LeaveApplication>    │
│    EmployeeRepository   extends Repository<Employee>            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7.2 Base Repository Implementation

```typescript
// packages/database/src/repositories/base.ts
import type { PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant-context';
import { logger } from '@platform/observability';

export abstract class BaseRepository<TEntity, TModel> {
  constructor(
    protected readonly db: PrismaClient,
    protected readonly modelName: string
  ) {}

  protected get tenantId(): string {
    return TenantContext.require().tenantId;
  }

  /**
   * All queries MUST include tenant_id as a filter.
   * This base method enforces it — subclasses cannot bypass it.
   */
  protected tenantFilter(): { tenantId: string } {
    return { tenantId: this.tenantId };
  }

  protected abstract mapToEntity(model: TModel): TEntity;
  protected abstract mapToModel(entity: Partial<TEntity>): Partial<TModel>;

  async findById(id: string): Promise<TEntity | null> {
    const model = await (this.db as any)[this.modelName].findFirst({
      where: {
        id,
        ...this.tenantFilter(),   // ALWAYS injected
      },
    });
    return model ? this.mapToEntity(model) : null;
  }

  async save(entity: TEntity): Promise<TEntity> {
    const model = this.mapToModel(entity);
    const saved = await (this.db as any)[this.modelName].upsert({
      where: { id: (entity as any).id },
      update: model,
      create: { ...model, ...this.tenantFilter() },
    });
    return this.mapToEntity(saved);
  }
}
```

---

## 7.3 Domain Repository — Attendance Example

```typescript
// domains/attendance/src/repositories/daily-attendance.repository.ts
import { BaseRepository } from '@platform/database';
import type { PrismaClient } from '@prisma/client';
import type { DailyAttendance, DailyAttendanceFilter } from '../types';
import { mapDailyAttendanceFromModel, mapDailyAttendanceToModel } from '../mappers';

export interface AttendanceRepository {
  findByEmployeeAndDate(employeeId: string, date: Date): Promise<DailyAttendance | null>;
  findByDateRange(filter: DailyAttendanceFilter): Promise<DailyAttendance[]>;
  findUnlockedForPeriod(periodId: string): Promise<DailyAttendance[]>;
  save(record: DailyAttendance): Promise<DailyAttendance>;
  lockForPayroll(employeeIds: string[], periodId: string, dateFrom: Date, dateTo: Date): Promise<number>;
  findPendingRecalculations(limit?: number): Promise<RecalculationRequest[]>;
}

export class PostgresAttendanceRepository
  extends BaseRepository<DailyAttendance, any>
  implements AttendanceRepository
{
  constructor(db: PrismaClient) {
    super(db, 'dailyAttendance');
  }

  async findByEmployeeAndDate(
    employeeId: string,
    date: Date
  ): Promise<DailyAttendance | null> {
    const record = await this.db.dailyAttendance.findFirst({
      where: {
        ...this.tenantFilter(),
        employeeId,
        attendanceDate: date,
      },
    });
    return record ? mapDailyAttendanceFromModel(record) : null;
  }

  async findByDateRange(filter: DailyAttendanceFilter): Promise<DailyAttendance[]> {
    const records = await this.db.dailyAttendance.findMany({
      where: {
        ...this.tenantFilter(),
        attendanceDate: {
          gte: filter.from,
          lte: filter.to,
        },
        ...(filter.employeeId && { employeeId: filter.employeeId }),
        ...(filter.orgUnitId && { orgUnitId: filter.orgUnitId }),
        ...(filter.status && { attendanceStatus: { in: filter.status } }),
      },
      orderBy: { attendanceDate: 'asc' },
      take: filter.limit ?? 5000,
      skip: filter.offset ?? 0,
    });
    return records.map(mapDailyAttendanceFromModel);
  }

  async lockForPayroll(
    employeeIds: string[],
    periodId: string,
    dateFrom: Date,
    dateTo: Date
  ): Promise<number> {
    // Batch update — 1000 records at a time to avoid lock contention
    const BATCH_SIZE = 1000;
    let totalLocked = 0;

    for (let i = 0; i < employeeIds.length; i += BATCH_SIZE) {
      const batch = employeeIds.slice(i, i + BATCH_SIZE);
      const result = await this.db.dailyAttendance.updateMany({
        where: {
          ...this.tenantFilter(),
          employeeId: { in: batch },
          attendanceDate: { gte: dateFrom, lte: dateTo },
          isPayrollLocked: false,
        },
        data: {
          isPayrollLocked: true,
          payrollPeriodId: periodId,
        },
      });
      totalLocked += result.count;
    }
    return totalLocked;
  }

  protected mapToEntity = mapDailyAttendanceFromModel;
  protected mapToModel  = mapDailyAttendanceToModel;
}
```

---

## 7.4 Unit of Work Pattern

```typescript
// packages/database/src/unit-of-work.ts
import type { PrismaClient } from '@prisma/client';
import type { AttendanceRepository } from '@domain/attendance';
import type { AuditRepository } from '@domain/audit';
import type { OutboxWriter } from './outbox-writer';

export interface UnitOfWork {
  attendance:  AttendanceRepository;
  payroll:     PayrollRepository;
  leave:       LeaveRepository;
  employee:    EmployeeRepository;
  workflow:    WorkflowRepository;
  audit:       AuditRepository;
  outbox:      OutboxWriter;
  commit():    Promise<void>;
  rollback():  Promise<void>;
}

export class PrismaUnitOfWork implements UnitOfWork {
  private tx: PrismaClient | null = null;

  // Repositories are initialized lazily within the transaction
  get attendance() { return new PostgresAttendanceRepository(this.getTx()); }
  get payroll()    { return new PostgresPayrollRepository(this.getTx()); }
  get leave()      { return new PostgresLeaveRepository(this.getTx()); }
  get employee()   { return new PostgresEmployeeRepository(this.getTx()); }
  get workflow()   { return new PostgresWorkflowRepository(this.getTx()); }
  get audit()      { return new PostgresAuditRepository(this.getTx()); }
  get outbox()     { return new OutboxWriter(this.getTx()); }

  constructor(private readonly prisma: PrismaClient) {}

  private getTx(): PrismaClient {
    if (!this.tx) throw new Error('Unit of Work not started. Call begin() first.');
    return this.tx;
  }

  async begin(): Promise<void> {
    // Prisma interactive transactions for complex multi-step operations
    // For simple operations, use $transaction([...]) callback form
  }

  async commit(): Promise<void> {
    if (this.tx) {
      // Prisma handles commit at the end of $transaction callback
      this.tx = null;
    }
  }

  async rollback(): Promise<void> {
    // Prisma handles rollback automatically on exception within $transaction
    this.tx = null;
  }
}

// Factory function — preferred usage pattern
export async function withUnitOfWork<T>(
  prisma: PrismaClient,
  fn: (uow: UnitOfWork) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const uow = new PrismaUnitOfWork(tx as unknown as PrismaClient);
    return fn(uow);
  }, {
    maxWait: 5000,    // Wait up to 5s for a connection
    timeout: 30000,   // Transaction must complete within 30s
  });
}
```

**Usage in Domain Service:**
```typescript
// domains/attendance/src/services/attendance.service.ts
import { withUnitOfWork } from '@platform/database';
import { AttendancePunchedEventSchema } from '@platform/contracts';
import type { CreatePunchRecordDto } from '@platform/contracts';

export class AttendanceService {
  constructor(private readonly prisma: PrismaClient) {}

  async recordPunch(dto: CreatePunchRecordDto, actor: JwtPayload): Promise<PunchRecord> {
    return withUnitOfWork(this.prisma, async (uow) => {
      // 1. Validate punch (no duplicate within 2-minute window)
      const recentPunch = await uow.attendance.findRecentPunch(dto.employeeId, 120);
      if (recentPunch) {
        throw new DuplicatePunchError(recentPunch.id, dto.punchedAt);
      }

      // 2. Save punch record
      const punch = await uow.attendance.savePunch({
        ...dto,
        tenantId:        actor.tenant_id,
        serverReceivedAt: new Date(),
        effectiveAt:     new Date(dto.punchedAt), // Normalized timestamp
        status:          'raw',
      });

      // 3. Write audit record
      await uow.audit.log({
        domain:     'attendance',
        entityType: 'PunchRecord',
        entityId:   punch.id,
        action:     'created',
        actorId:    actor.sub,
        afterState: punch,
      });

      // 4. Write event to outbox (SAME TRANSACTION — atomic)
      await uow.outbox.write('attendance', {
        eventType:  'attendance.punched',
        tenantId:   actor.tenant_id,
        aggregateType: 'PunchRecord',
        aggregateId:   punch.id,
        payload:    AttendancePunchedEventSchema.shape.payload.parse(punch),
        correlationId: getCorrelationId(),
      });

      // All three operations committed atomically or all rolled back
      return punch;
    });
  }
}
```

---

## 7.5 Analytics Read Model Repositories

Analytics repositories are distinct from operational repositories — they query the `analytics.*` schema read models, not the normalized OLTP domain tables.

```typescript
// domains/analytics/src/repositories/attendance-analytics.repository.ts
export interface AttendanceAnalyticsRepository {
  getOrgAttendanceSummary(orgUnitId: string, date: Date): Promise<OrgAttendanceSummary>;
  getWorkforceSnapshot(tenantId: string): Promise<WorkforceSnapshot>;
  getTrendData(filter: TrendFilter): Promise<AttendanceTrend[]>;
  getAbsenceHeatmap(orgUnitId: string, from: Date, to: Date): Promise<HeatmapData[][]>;
}

export class PostgresAttendanceAnalyticsRepository
  implements AttendanceAnalyticsRepository
{
  constructor(private readonly db: PrismaClient) {}

  async getOrgAttendanceSummary(
    orgUnitId: string,
    date: Date
  ): Promise<OrgAttendanceSummary> {
    // Query pre-aggregated KPI table — never the raw fact table for this use case
    const result = await this.db.$queryRaw<OrgAttendanceSummaryRow[]>`
      SELECT
        org_unit_id,
        attendance_date,
        total_employees,
        present_count,
        absent_count,
        late_count,
        on_leave_count,
        attendance_rate,
        avg_net_hours,
        total_overtime_hours
      FROM analytics.kpi_attendance_daily_org
      WHERE tenant_id  = ${TenantContext.require().tenantId}::UUID
        AND org_unit_id = ${orgUnitId}::UUID
        AND attendance_date = ${date}
    `;
    return mapOrgAttendanceSummary(result[0]);
  }
}
```

---

# Section 8 — Observability + Telemetry Foundation

## 8.1 Structured Logging Standard

Every log entry in the platform follows a consistent structure. Unstructured log messages are prohibited in production code (ESLint rule: no `console.log` except in scripts).

**Standard Log Fields:**
```typescript
interface LogEntry {
  // Required on every entry
  level:         'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message:       string;
  timestamp:     string;    // ISO 8601 UTC
  service:       string;    // e.g., 'api', 'attendance-processor'
  version:       string;    // App version
  env:           string;    // production | staging | development

  // Auto-injected from request context
  correlationId?: string;   // Request-scoped correlation UUID
  tenantId?:      string;   // Tenant UUID (never tenant name)
  userId?:        string;   // User UUID

  // Auto-injected from OpenTelemetry
  traceId?:       string;   // W3C trace ID
  spanId?:        string;

  // Operation context (injected by domain service)
  domain?:        string;   // 'attendance' | 'payroll' | etc.
  operation?:     string;   // 'recordPunch' | 'runPayroll' | etc.
  durationMs?:    number;

  // Error context
  err?: {
    type:       string;
    message:    string;
    stack?:     string;
    code?:      string;
  };
}
```

**Log Level Policy:**
| Level | When | Examples |
|---|---|---|
| `debug` | Detailed flow tracing (dev/staging only) | SQL queries, cache hits/misses, intermediate computation steps |
| `info` | Business operations completed successfully | Punch recorded, Payslip generated, Leave approved |
| `warn` | Unexpected but recoverable conditions | Duplicate punch detected and deduplicated, Policy cache miss, Slow query |
| `error` | Operation failed, requires investigation | Database error, External API failure, Validation failure |
| `fatal` | Process must shut down | Database unreachable, Missing required configuration |

---

## 8.2 Distributed Tracing Architecture

```typescript
// Request tracing flow: HTTP → Domain Service → Database → Event Bus

// 1. Incoming HTTP request
fastify.addHook('onRequest', async (request) => {
  const span = tracer.startSpan(`HTTP ${request.method} ${request.routerPath}`, {
    attributes: {
      'http.method':    request.method,
      'http.url':       request.url,
      'tenant.id':      request.user?.tenant_id,
      'correlation.id': request.headers['x-correlation-id'] as string,
    },
  });
  request.span = span;
  context.with(trace.setSpan(context.active(), span), () => {});
});

// 2. Domain service operation
export class AttendanceService {
  async recordPunch(dto: CreatePunchRecordDto): Promise<PunchRecord> {
    return startSpan('attendance.recordPunch', {
      'employee.id':   dto.employeeId,
      'punch.type':    dto.punchType,
      'punch.source':  dto.punchSource,
    }, async () => {
      // Database operations automatically traced by Prisma OpenTelemetry plugin
      return withUnitOfWork(this.prisma, async (uow) => { ... });
    });
  }
}

// 3. Outbox event carries trace context forward
const envelope = {
  ...eventData,
  metadata: {
    trace: {
      traceId:    trace.getActiveSpan()?.spanContext().traceId,
      spanId:     trace.getActiveSpan()?.spanContext().spanId,
      traceFlags: trace.getActiveSpan()?.spanContext().traceFlags,
    },
  },
};

// 4. Event consumer restores trace context for async continuation
function processEvent(event: DomainEvent) {
  const parentCtx = propagation.extract(context.active(), event.metadata.trace);
  context.with(parentCtx, async () => {
    const span = tracer.startSpan('event.process', {
      attributes: { 'event.type': event.eventType },
      kind: SpanKind.CONSUMER,
    });
    // Process event within restored trace context
  });
}
```

---

## 8.3 Metrics Strategy

```typescript
// packages/observability/src/metrics.ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('workforce-os', '1.0.0');

export const counters = {
  // Attendance
  punchesRecorded:     meter.createCounter('attendance.punches_recorded'),
  punchesVoided:       meter.createCounter('attendance.punches_voided'),
  dailyRecordsComputed: meter.createCounter('attendance.daily_records_computed'),
  recalculationsQueued: meter.createCounter('attendance.recalculations_queued'),

  // Payroll
  payrollRunsInitiated: meter.createCounter('payroll.runs_initiated'),
  payslipsGenerated:    meter.createCounter('payroll.payslips_generated'),
  payrollErrors:        meter.createCounter('payroll.errors'),

  // Events
  eventsPublished:     meter.createCounter('events.published_total'),
  eventsConsumed:      meter.createCounter('events.consumed_total'),
  eventsDLQ:           meter.createCounter('events.dead_letter_total'),

  // AI
  predictionsGenerated: meter.createCounter('ai.predictions_generated'),
  copilotRequests:      meter.createCounter('ai.copilot_requests'),
  modelInferences:      meter.createCounter('ai.model_inferences'),
};

export const histograms = {
  // API latency
  httpDurationMs: meter.createHistogram('http.request.duration_ms', {
    boundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  }),

  // Database
  dbQueryDurationMs: meter.createHistogram('db.query.duration_ms', {
    boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  }),

  // Payroll
  payrollComputationMs: meter.createHistogram('payroll.computation_duration_ms', {
    boundaries: [100, 500, 1000, 5000, 10000, 30000, 60000],
  }),

  // Event relay
  outboxRelayLagMs: meter.createHistogram('events.outbox_relay_lag_ms', {
    boundaries: [100, 500, 1000, 5000, 10000, 30000],
  }),
};

export const gauges = {
  outboxPendingEvents: meter.createObservableGauge('events.outbox_pending_count'),
  activePayrollRuns:   meter.createObservableGauge('payroll.active_runs'),
  workerQueueDepth:    meter.createObservableGauge('workers.queue_depth'),
};
```

---

## 8.4 Queue Observability

```typescript
// workers/outbox-relay/src/observability.ts
// Outbox relay exposes health metrics consumed by Prometheus scrape

export class OutboxRelayObserver {
  private readonly pendingGauge;

  async reportMetrics() {
    // Count pending events per domain
    const pendingByDomain = await this.db.$queryRaw<{ domain: string; count: number }[]>`
      SELECT 'attendance' AS domain, COUNT(*)::INT AS count
        FROM attendance.outbox WHERE status = 'pending'
      UNION ALL
      SELECT 'payroll', COUNT(*) FROM payroll.outbox WHERE status = 'pending'
      UNION ALL
      SELECT 'leave', COUNT(*) FROM leave.outbox WHERE status = 'pending'
    `;

    pendingByDomain.forEach(({ domain, count }) => {
      gauges.outboxPendingEvents.addCallback((result) => {
        result.observe(count, { domain });
      });

      // Alert if any domain outbox exceeds threshold
      if (count > 10_000) {
        logger.warn({ domain, count }, 'Outbox backlog exceeding alert threshold');
      }
    });
  }
}
```

---

# Section 9 — Backend Foundation Architecture

## 9.1 Framework Decision: Fastify

**Fastify vs NestJS Analysis:**

| Dimension | Fastify | NestJS |
|---|---|---|
| Performance | ~75K req/s (benchmarks) | ~45K req/s (overhead from decorators + DI) |
| TypeScript | First-class, schema-driven | First-class, decorator-based |
| Schema validation | Native JSON Schema + Zod plugin | Manual or via pipes |
| Plugin ecosystem | Modular, composable | Module system (can be heavyweight) |
| Learning curve | Low-medium | High (decorators, DI container, module system) |
| Testing | Simple — mock Fastify instance | Requires TestingModule bootstrapping |
| Bundle size | Minimal | Large (Reflect Metadata, DI overhead) |
| Code generation integration | Excellent with fastify-zod | Possible but complex |

**Decision: Fastify**

Rationale:
1. Fastify's schema-first validation aligns directly with the Zod-first contract strategy — `fastify-zod` converts Zod schemas to JSON Schema automatically, meaning validation is derived from the same schemas that generate TypeScript types and OpenAPI specs.
2. Fastify plugins map naturally to domain modules — each domain registers its routes as a Fastify plugin with its own prefix, encapsulation, and lifecycle hooks.
3. Fastify's performance ceiling is meaningfully higher for high-frequency endpoints (punch recording at 500+ TPS).
4. NestJS's DI container, while powerful, introduces runtime overhead and a steep onboarding curve that does not pay dividends in a monolith-first architecture where the dependency injection is handled by the UoW pattern.

---

## 9.2 Application Bootstrap Architecture

```typescript
// apps/api/src/app.ts
import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { withRefResolver } from 'fastify-zod';
import { config } from '@platform/config';
import { createPrismaClient } from '@platform/database';
import { logger } from '@platform/observability';

export async function buildApp(options?: { forCodegen?: boolean }) {
  const app = Fastify({
    logger: options?.forCodegen ? false : logger,
    trustProxy: true,
    requestIdHeader: 'x-correlation-id',
    requestIdLogLabel: 'correlationId',
    genReqId: () => crypto.randomUUID(),
  });

  // ─── Infrastructure Plugins (order matters) ───
  await app.register(import('./plugins/database'), { prisma: createPrismaClient() });
  await app.register(import('./plugins/observability'));
  await app.register(import('./plugins/cors'));
  await app.register(import('./plugins/rate-limit'));
  await app.register(import('./plugins/auth'));
  await app.register(import('./plugins/tenant'));

  // ─── OpenAPI documentation ───
  if (!options?.forCodegen) {
    await app.register(fastifySwagger, withRefResolver({
      openapi: {
        info: { title: 'Workforce OS API', version: config.APP_VERSION },
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      },
    }));
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  }

  // ─── Domain Routes ───
  await app.register(import('./routes/v1'), { prefix: '/api/v1' });
  await app.register(import('./routes/legacy'), { prefix: '/api/legacy' }); // Section 15

  // ─── Health endpoints (no auth required) ───
  app.get('/health', { config: { isPublic: true } }, async () => ({
    status: 'ok',
    version: config.APP_VERSION,
    uptime: process.uptime(),
  }));
  app.get('/ready', { config: { isPublic: true } }, async (_, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'not ready', reason: 'database unavailable' });
    }
  });

  return app;
}
```

---

## 9.3 Domain Module Plugin Pattern

```typescript
// domains/attendance/src/plugin.ts
import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { AttendanceService } from './services/attendance.service';
import { attendanceRoutes } from './routes';

/**
 * Attendance domain plugin — self-contained Fastify plugin.
 * Registers all attendance routes under the provided prefix.
 * Uses fp() to share the parent context (no encapsulation).
 */
export const attendanceDomainPlugin: FastifyPluginAsync = fp(async (fastify) => {
  // Register domain service as singleton (shared across all routes)
  const attendanceService = new AttendanceService(fastify.prisma);
  fastify.decorate('attendanceService', attendanceService);

  // Mount domain routes
  await fastify.register(attendanceRoutes, { prefix: '/attendance' });
});

// apps/api/src/routes/v1/index.ts
export async function v1Routes(fastify: FastifyInstance) {
  await fastify.register(attendanceDomainPlugin);
  await fastify.register(payrollDomainPlugin);
  await fastify.register(leaveDomainPlugin);
  await fastify.register(employeeDomainPlugin);
  await fastify.register(workflowDomainPlugin);
  await fastify.register(policyDomainPlugin);
  await fastify.register(analyticsDomainPlugin);
  await fastify.register(aiDomainPlugin);
}
```

---

## 9.4 Error Handling Architecture

```typescript
// apps/api/src/middleware/error-handler.ts
import { FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '@platform/observability';

const HTTP_STATUS_MAP: Record<string, number> = {
  UNAUTHORIZED:           401,
  PERMISSION_DENIED:      403,
  NOT_FOUND:              404,
  CONFLICT:               409,
  VALIDATION_ERROR:       422,
  PAYROLL_LOCKED:         409,
  DUPLICATE_PUNCH:        409,
  LEGAL_HOLD_ACTIVE:      409,
  RATE_LIMIT_EXCEEDED:    429,
  INTERNAL_ERROR:         500,
};

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Domain errors (typed)
  if (error instanceof DomainError) {
    const statusCode = HTTP_STATUS_MAP[error.code] ?? 400;
    logger.warn({
      err:           error,
      correlationId: request.id,
      path:          request.url,
      code:          error.code,
    }, `Domain error: ${error.message}`);

    return reply.code(statusCode).send({
      error:    error.code,
      message:  error.message,
      details:  error.details,
      correlationId: request.id,
    });
  }

  // Zod validation errors (from Fastify schema validation)
  if (error instanceof ZodError) {
    return reply.code(422).send({
      error:    'VALIDATION_ERROR',
      message:  'Request validation failed',
      issues:   error.issues.map(i => ({
        field:   i.path.join('.'),
        message: i.message,
        code:    i.code,
      })),
      correlationId: request.id,
    });
  }

  // Prisma errors
  if (error.code === 'P2002') {
    return reply.code(409).send({
      error:   'CONFLICT',
      message: 'A record with this identifier already exists',
      correlationId: request.id,
    });
  }

  // Unexpected errors
  logger.error({ err: error, correlationId: request.id, path: request.url },
    'Unhandled error in request handler');

  return reply.code(500).send({
    error:   'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    correlationId: request.id,
  });
}
```

---

## 9.5 How Existing Domain Logic Integrates

This is the critical integration point. The existing attendance, leave, and payroll engines contain validated business logic that must not be discarded.

```
Integration Strategy for Existing Logic:

1. EXTRACT business logic from existing framework-coupled code
   - Identify pure functions (compute overtime, resolve shift, calculate leave balance)
   - Separate from Express/framework handlers
   - Move to domain service classes in domains/attendance/src/services/

2. WRAP existing logic behind the Repository interface
   - Database access in existing code: replace with repository methods
   - Configuration access: replace with @platform/config
   - Logger calls: replace with @platform/observability

3. KEEP existing SQL where it works correctly
   - Complex queries that work well can be moved to repository implementations as raw SQL
   - Do NOT rewrite working SQL into Prisma query builder if the SQL is already optimized
   - Example: The existing overtime calculation query → moves to AttendanceRepository.computeOvertimeSummary()

4. ADD audit, outbox, and tenant context around existing logic
   - Every write operation wrapped in withUnitOfWork()
   - Audit records added alongside existing mutations
   - Outbox writes added alongside existing DB writes
   - Tenant context injected at request entry point

Example: Existing attendance daily processor
  BEFORE: app/jobs/process-daily-attendance.js
    - Direct Knex/raw SQL
    - No tenant isolation
    - No audit
    - No events
    - No structured logging

  AFTER: domains/attendance/src/services/daily-processor.service.ts
    - Same business logic (shift resolution, overtime, absent marking)
    - Wrapped in withUnitOfWork()
    - Tenant context from TenantContext.require()
    - Audit records via uow.audit.log()
    - Events via uow.outbox.write()
    - Structured logger from @platform/observability
    - Deployed via workers/attendance-processor BullMQ job
```

---

# Section 10 — Frontend Foundation Architecture

## 10.1 Application Shell Architecture

All frontend applications share a common shell pattern built from `@platform/ui`:

```
AppShell
├── GlobalProviders           → Auth, QueryClient, Toast, Theme
├── Sidebar                   → Navigation, tenant branding
├── TopBar                    → Search, notifications, user menu
├── CommandPalette            → ⌘K global command interface
├── NotificationCenter        → Real-time notification tray
├── AIPanel                   → Slide-out copilot panel
└── MainContent               → App-specific page content
```

---

## 10.2 State Management Strategy

```
State Layers:

1. SERVER STATE → TanStack Query v5
   - All data fetched from API
   - Automatic background refetching
   - Optimistic updates for attendance corrections
   - Offline support (queryClient.persistQueryClient)
   - Prefetching for predictable navigation

2. CLIENT/UI STATE → Zustand
   - UI state only (sidebar open, modal open, selected rows)
   - No business data stored here
   - Store per feature area (not one global store)
   - Example: useAttendanceViewStore, usePayrollRunStore

3. FORM STATE → React Hook Form
   - All forms use RHF
   - Zod resolvers for validation (schemas from @platform/contracts)
   - No controlled inputs — performance matters in large forms

4. URL STATE → nuqs (Next.js URL state)
   - Filters, pagination, sort orders stored in URL
   - Makes dashboard state shareable/bookmarkable
   - Example: ?date=2025-03&orgUnit=uuid&status=absent

5. REALTIME STATE → Supabase Realtime
   - Workforce presence (who is currently clocked in)
   - Approval notifications
   - Payroll run status changes
   - Live KPI updates
```

---

## 10.3 TanStack Query Architecture

```typescript
// apps/admin/src/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';
import { toast } from '@platform/ui';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:       60_000,      // Data fresh for 60s before background refetch
      gcTime:          300_000,     // Keep unused data in cache for 5 minutes
      retry:           (failureCount, error) => {
        // Don't retry auth errors
        if (error instanceof AuthError) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect:   true,
    },
    mutations: {
      onError: (error) => {
        toast.error(formatApiError(error));
      },
    },
  },
});

// Query key factory — prevents key collision and enables targeted invalidation
export const queryKeys = {
  attendance: {
    all:     ['attendance'] as const,
    daily:   (filters: DailyAttendanceFilter) => ['attendance', 'daily', filters] as const,
    punches: (employeeId: string, from: string, to: string) =>
               ['attendance', 'punches', employeeId, from, to] as const,
    summary: (orgUnitId: string, date: string) =>
               ['attendance', 'summary', orgUnitId, date] as const,
  },
  payroll: {
    runs:    (year: number) => ['payroll', 'runs', year] as const,
    payslip: (payslipId: string) => ['payroll', 'payslip', payslipId] as const,
  },
  leave: {
    balances: (employeeId: string) => ['leave', 'balances', employeeId] as const,
    applications: (filters: LeaveFilter) => ['leave', 'applications', filters] as const,
  },
};

// Hook example
export function useOrgAttendanceSummary(orgUnitId: string, date: string) {
  return useQuery({
    queryKey: queryKeys.attendance.summary(orgUnitId, date),
    queryFn:  () => apiClient.GET('/api/v1/analytics/attendance/summary', {
      params: { query: { orgUnitId, date } },
    }),
    select: (res) => res.data,
  });
}
```

---

## 10.4 AG Grid Integration Architecture

AG Grid Enterprise is used for all large data tables (attendance records, payroll run employee list, leave applications). It is NOT used for simple tables (use standard HTML table or Shadcn Table component).

```typescript
// packages/ui/src/data-grid/WorkforceGrid.tsx
import { AgGridReact, type AgGridReactProps } from 'ag-grid-react';
import { useMemo, useCallback, useRef } from 'react';

interface WorkforceGridProps<T> extends AgGridReactProps<T> {
  onExport?: (format: 'csv' | 'excel') => void;
  tenantId:  string;   // Required for row-level context
}

export function WorkforceGrid<T>({ onExport, tenantId, ...props }: WorkforceGridProps<T>) {
  const gridRef = useRef<AgGridReact>(null);

  const defaultColDef = useMemo(() => ({
    sortable:    true,
    filter:      true,
    resizable:   true,
    minWidth:    80,
    // Infinite scrolling mode for large datasets (don't load 50K rows at once)
    suppressCellFocus: false,
  }), []);

  const handleExport = useCallback(() => {
    if (onExport === 'csv') {
      gridRef.current?.api.exportDataAsCsv({
        fileName: `export-${new Date().toISOString().split('T')[0]}.csv`,
      });
    }
  }, [onExport]);

  return (
    <div className="ag-theme-workforce h-full w-full">
      <AgGridReact
        ref={gridRef}
        defaultColDef={defaultColDef}
        rowModelType="serverSide"    // Server-side row model for large datasets
        cacheBlockSize={100}
        maxBlocksInCache={10}
        pagination={true}
        paginationPageSize={100}
        {...props}
      />
    </div>
  );
}
```

---

## 10.5 Realtime Strategy

```typescript
// apps/admin/src/lib/realtime.ts
import { createClient } from '@supabase/supabase-js';
import { useEffect } from 'react';

// Realtime subscription for live workforce snapshot
export function useWorkforcePresence(tenantId: string, orgUnitId?: string) {
  const { updateSnapshot } = useWorkforceStore();

  useEffect(() => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Subscribe to analytics.kpi_workforce_snapshot changes
    const channel = supabase
      .channel('workforce-presence')
      .on('postgres_changes', {
        event:  '*',
        schema: 'analytics',
        table:  'kpi_workforce_snapshot',
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload) => {
        updateSnapshot(payload.new as WorkforceSnapshot);
      })
      .subscribe();

    // Subscribe to approval task assignments for current user
    const approvalChannel = supabase
      .channel('approval-tasks')
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'workflow',
        table:  'workflow_tasks',
        filter: `assignee_id=eq.${currentUserId}`,
      }, (payload) => {
        notifyNewApprovalTask(payload.new);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(approvalChannel);
    };
  }, [tenantId, orgUnitId]);
}
```

---

## 10.6 Command Palette Architecture

```typescript
// packages/ui/src/workspace/CommandPalette.tsx
// Global ⌘K command interface — enables power users to navigate without mouse

interface Command {
  id:       string;
  label:    string;
  keywords: string[];
  group:    string;
  icon?:    React.ReactNode;
  action:   () => void | Promise<void>;
  shortcut?: string;
}

export function CommandPalette() {
  const { commands, register } = useCommandRegistry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Commands are registered by each page/feature
  // Example registrations:
  // register({ id: 'attendance-today', label: 'View Today\'s Attendance',
  //   keywords: ['attendance', 'today', 'present'], group: 'Attendance',
  //   action: () => router.push('/attendance') })
  // register({ id: 'run-payroll', label: 'Initiate Payroll Run',
  //   keywords: ['payroll', 'run', 'salary'], group: 'Payroll',
  //   action: () => openPayrollRunModal() })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filtered = useMemo(() =>
    fuzzySearch(commands, query, { keys: ['label', 'keywords'] }),
  [commands, query]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Type a command..." />
      <CommandList>
        {filtered.map(cmd => (
          <CommandItem key={cmd.id} onSelect={() => { cmd.action(); setOpen(false); }}>
            {cmd.icon}
            <span>{cmd.label}</span>
            {cmd.shortcut && <CommandShortcut>{cmd.shortcut}</CommandShortcut>}
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
```



---


# Section 11 — Design System Implementation Foundation

## 11.1 Design Token Architecture

Design tokens are the single source of truth for all visual values. They are defined in `packages/ui/src/tokens/` and consumed by Tailwind CSS configuration and component styles.

```typescript
// packages/ui/src/tokens/colors.ts
export const colors = {
  // Brand
  brand: {
    50:  '#f0f4ff',
    100: '#e0e9ff',
    500: '#4361ee',
    600: '#3451d1',
    700: '#2a41b5',
    900: '#1a2980',
  },
  // Semantic — Status colors for HRMS data
  status: {
    present:    { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
    absent:     { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
    late:       { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
    onLeave:    { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
    holiday:    { bg: '#f5f3ff', text: '#5b21b6', border: '#ddd6fe' },
    weekOff:    { bg: '#f9fafb', text: '#374151', border: '#e5e7eb' },
    halfDay:    { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  },
  // Payroll
  payroll: {
    earning:    '#16a34a',
    deduction:  '#dc2626',
    neutral:    '#6b7280',
  },
  // Risk tiers (AI predictions)
  risk: {
    low:      '#22c55e',
    medium:   '#f59e0b',
    high:     '#ef4444',
    critical: '#7f1d1d',
  },
} as const;

// packages/ui/src/tokens/spacing.ts
export const spacing = {
  // HRMS-specific spacing for data-dense layouts
  compact:    '4px',    // Compact mode row height
  normal:     '8px',    // Standard row spacing
  comfortable:'12px',   // Comfortable mode
  relaxed:    '16px',   // Card padding
  section:    '24px',   // Section separation
  page:       '32px',   // Page padding
} as const;
```

**Tailwind Integration:**
```javascript
// tailwind.config.js (apps/admin)
import { colors, spacing } from '@platform/ui/tokens';

export default {
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: colors.brand,
        status: colors.status,
        risk:   colors.risk,
      },
      spacing: {
        compact: spacing.compact,
        section: spacing.section,
        page:    spacing.page,
      },
    },
  },
};
```

---

## 11.2 Chart Component Architecture

HRMS requires charts that are not standard business charts — they must convey workforce patterns at a glance.

```typescript
// packages/ui/src/charts/AttendanceHeatmap.tsx
// Calendar heatmap for attendance patterns — similar to GitHub contribution graph
// but with HRMS status colors

import { useMemo } from 'react';
import { Tooltip } from '../components/Tooltip';
import { colors } from '../tokens/colors';

interface AttendanceHeatmapProps {
  data:      HeatmapDatum[];   // { date: string, status: AttendanceStatus, value: number }[]
  from:      Date;
  to:        Date;
  employeeId?: string;
  onDayClick?: (date: string) => void;
}

const STATUS_COLOR_MAP: Record<AttendanceStatus, string> = {
  present:  colors.status.present.bg,
  absent:   colors.status.absent.bg,
  late:     colors.status.late.bg,
  on_leave: colors.status.onLeave.bg,
  holiday:  colors.status.holiday.bg,
  week_off: colors.status.weekOff.bg,
  half_day: colors.status.halfDay.bg,
};

export function AttendanceHeatmap({ data, from, to, onDayClick }: AttendanceHeatmapProps) {
  const weeks = useMemo(() => buildWeekMatrix(from, to, data), [from, to, data]);

  return (
    <div className="flex gap-1 overflow-x-auto">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {week.map((day, di) => (
            <Tooltip key={di} content={day ? `${day.date}: ${day.status}` : ''}>
              <div
                className="w-3 h-3 rounded-sm cursor-pointer hover:ring-2 hover:ring-brand-500"
                style={{ backgroundColor: day ? STATUS_COLOR_MAP[day.status] : 'transparent' }}
                onClick={() => day && onDayClick?.(day.date)}
              />
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}

// packages/ui/src/charts/PayrollWaterfall.tsx
// Payslip earnings → deductions → net pay waterfall chart
// Built with Recharts ComposedChart

export function PayrollWaterfall({ components }: { components: PayrollComponent[] }) {
  const waterfallData = useMemo(() => buildWaterfallData(components), [components]);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={waterfallData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={(v) => `₹${(v/1000).toFixed(0)}K`} />
        <Bar dataKey="earning"   fill={colors.payroll.earning}   stackId="a" />
        <Bar dataKey="deduction" fill={colors.payroll.deduction} stackId="a" />
        <Line dataKey="net"      stroke={colors.brand[600]}      dot={{ r: 4 }} />
        <RechartsTooltip formatter={(value) => formatCurrency(value as number)} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
```

---

## 11.3 Storybook Strategy

```
Storybook is the living design system documentation and visual testing platform.

packages/ui/.storybook/
├── main.ts          → Config: vite builder, addons, story discovery
├── preview.ts       → Global decorators (ThemeProvider, QueryClient mock)
└── stories/
    ├── tokens/
    │   ├── Colors.stories.tsx
    │   ├── Typography.stories.tsx
    │   └── Spacing.stories.tsx
    ├── primitives/
    │   ├── Button.stories.tsx
    │   └── ...
    ├── charts/
    │   ├── AttendanceHeatmap.stories.tsx    ← with realistic HRMS data fixtures
    │   ├── PayrollWaterfall.stories.tsx
    │   └── TrendLine.stories.tsx
    ├── data-grid/
    │   └── WorkforceGrid.stories.tsx        ← 10K row performance story
    └── ai/
        ├── CopilotPanel.stories.tsx
        └── InsightCard.stories.tsx

Story Requirements:
  Every component must have:
    □ Default story (happy path, realistic data)
    □ Loading state story
    □ Empty state story
    □ Error state story
    □ Accessibility story (keyboard navigation demo)

Visual Regression Testing:
  Chromatic (Storybook's visual regression CI integration)
  Every PR runs Chromatic — visual diffs flagged for review
  No visual regression ships without explicit approval
```

---

# Section 12 — AI Platform Engineering Foundation

## 12.1 AI Orchestration Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI PLATFORM LAYERS                                │
│                                                                     │
│  Domain Layer (apps/api /api/v1/ai)                                 │
│    ↓ Copilot request / Prediction request                           │
│                                                                     │
│  @domain/ai                                                         │
│    ├── CopilotService          → Session management, context        │
│    ├── PredictionService       → Model routing, feature fetch       │
│    └── InsightService          → AI-generated HR insights           │
│    ↓                                                                │
│  @platform/ai-sdk                                                   │
│    ├── AIOrchestrator          → Request routing + fallback         │
│    ├── ModelGateway            → Provider abstraction               │
│    ├── PromptManager           → Versioned prompt retrieval         │
│    ├── FeatureEngine           → Feature vector computation         │
│    └── VectorClient            → pgvector / Qdrant interface        │
│    ↓                                                                │
│  External Providers                                                 │
│    ├── OpenAI (GPT-4o)                                             │
│    ├── Anthropic (Claude Sonnet)                                    │
│    └── Internal models (workers/ai-inference)                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 12.2 Model Gateway — Provider Abstraction

```typescript
// packages/ai-sdk/src/gateway.ts
export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncGenerator<CompletionChunk>;
}

interface CompletionRequest {
  model:       string;
  messages:    Message[];
  temperature?: number;
  maxTokens?:   number;
  tools?:       ToolDefinition[];
  systemPrompt?: string;
}

export class ModelGateway {
  private providers: Map<string, ModelProvider> = new Map();
  private fallbackOrder: string[] = ['anthropic', 'openai'];

  constructor(private readonly config: Config) {
    this.providers.set('openai', new OpenAIProvider(config.OPENAI_API_KEY));
    this.providers.set('anthropic', new AnthropicProvider(config.ANTHROPIC_API_KEY));
  }

  async complete(
    request: CompletionRequest,
    preferredProvider?: string
  ): Promise<CompletionResponse> {
    const order = preferredProvider
      ? [preferredProvider, ...this.fallbackOrder.filter(p => p !== preferredProvider)]
      : this.fallbackOrder;

    let lastError: Error | undefined;

    for (const providerName of order) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      try {
        const response = await provider.complete(request);
        metrics.counters.modelInferences.add(1, {
          provider: providerName,
          model:    request.model,
          status:   'success',
        });
        return response;
      } catch (err) {
        lastError = err as Error;
        logger.warn({ err, provider: providerName }, 'AI provider failed, trying fallback');
        metrics.counters.modelInferences.add(1, {
          provider: providerName,
          model:    request.model,
          status:   'error',
        });
      }
    }

    throw new AIProviderUnavailableError('All AI providers failed', lastError);
  }

  async *stream(
    request: CompletionRequest
  ): AsyncGenerator<CompletionChunk> {
    const provider = this.providers.get(this.fallbackOrder[0])!;
    yield* provider.stream(request);
  }
}
```

---

## 12.3 Prompt Manager — Versioned Prompt Governance

```typescript
// packages/ai-sdk/src/prompt-manager.ts
// Prompts are stored in the database (ai.prompts) and versioned.
// Never hardcode prompts in application code.

interface PromptVersion {
  id:        string;
  name:      string;
  version:   number;
  content:   string;
  variables: string[];       // Required template variables
  model:     string;         // Intended model
  createdAt: Date;
  isActive:  boolean;
}

export class PromptManager {
  private cache: Map<string, PromptVersion> = new Map();

  async getPrompt(name: string): Promise<PromptVersion> {
    const cacheKey = `prompt:${name}:active`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const prompt = await this.db.aiPrompt.findFirst({
      where: { name, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!prompt) throw new Error(`Prompt '${name}' not found`);

    this.cache.set(cacheKey, prompt);
    setTimeout(() => this.cache.delete(cacheKey), 300_000); // 5-minute TTL
    return prompt;
  }

  render(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in variables)) throw new Error(`Missing prompt variable: ${key}`);
      return variables[key];
    });
  }
}
```

---

## 12.4 Copilot Service — 5-Step Processing Pipeline

```typescript
// domains/ai/src/services/copilot.service.ts
export class CopilotService {
  constructor(
    private readonly gateway:  ModelGateway,
    private readonly prompts:  PromptManager,
    private readonly vector:   VectorClient,
    private readonly db:       PrismaClient
  ) {}

  async processMessage(
    sessionId: string,
    userMessage: string,
    actor: JwtPayload
  ): Promise<CopilotResponse> {

    return startSpan('copilot.processMessage', { 'session.id': sessionId }, async () => {

      // ─ STEP 1: Context Assembly ─────────────────────────────────────────
      const session  = await this.getOrCreateSession(sessionId, actor);
      const history  = await this.getSessionHistory(sessionId, limit = 10);
      const empCtx   = await this.getEmployeeContext(actor.sub, actor.tenant_id);

      // ─ STEP 2: Intent Classification ────────────────────────────────────
      const intentPrompt = await this.prompts.getPrompt('copilot.classify-intent');
      const intentResult = await this.gateway.complete({
        model:    'gpt-4o-mini',         // Fast, cheap model for classification
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt: this.prompts.render(intentPrompt.content, {
          employee_name: empCtx.displayName,
          tenant_name:   empCtx.tenantName,
        }),
        maxTokens: 100,
      });
      const intent = parseIntentClassification(intentResult.content);

      // ─ STEP 3: Tool Routing + Grounding ─────────────────────────────────
      const groundingDocs = await this.vector.searchSimilar({
        tenantId:    actor.tenant_id,
        contentType: mapIntentToContentType(intent),
        query:       userMessage,
        limit:       5,
      });

      const tools = this.buildToolSet(intent, actor.permissions);

      // ─ STEP 4: Grounded Response Generation ─────────────────────────────
      const responsePrompt = await this.prompts.getPrompt('copilot.respond');
      const response = await this.gateway.complete({
        model:    'claude-sonnet-4-5',
        messages: [
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: userMessage },
        ],
        systemPrompt: this.prompts.render(responsePrompt.content, {
          employee_context: JSON.stringify(empCtx),
          grounding_docs:   groundingDocs.map(d => d.content).join('\n\n'),
          current_date:     new Date().toISOString().split('T')[0],
        }),
        tools,
        temperature: 0.3,
        maxTokens:   1024,
      });

      // ─ STEP 5: Memory Persistence ────────────────────────────────────────
      await this.persistTurn(sessionId, userMessage, response.content, {
        intent,
        groundingSourceIds: groundingDocs.map(d => d.contentId),
        latencyMs:          response.latencyMs,
        tokensUsed:         response.tokenCount,
        model:              response.model,
      });

      return {
        message:     response.content,
        intent,
        suggestions: this.generateFollowUpSuggestions(intent, empCtx),
      };
    });
  }
}
```

---

## 12.5 AI Worker — Prediction Pipeline

```typescript
// workers/ai-inference/src/jobs/attrition-prediction.job.ts
import Queue from 'bullmq';

export const attritionPredictionQueue = new Queue('ai:attrition-prediction', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts:   3,
    backoff:    { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail:     { count: 500 },
  },
});

const worker = new Worker(
  'ai:attrition-prediction',
  async (job: Job<AttritionPredictionJobData>) => {
    const { tenantId, employeeId, triggerReason } = job.data;

    return startSpan('ai.attritionPrediction', { tenantId, employeeId }, async () => {

      // 1. Retrieve feature vector
      const features = await featureEngine.computeAttendanceBehaviorFeatures(
        tenantId, employeeId, { rollingDays: 90 }
      );
      const payrollFeatures = await featureEngine.computePayrollSignalFeatures(
        tenantId, employeeId, { periods: 3 }
      );
      const leaveFeatures = await featureEngine.computeLeavePatternFeatures(
        tenantId, employeeId, { rollingDays: 180 }
      );

      const featureVector = { ...features, ...payrollFeatures, ...leaveFeatures };

      // 2. Select model (from model registry)
      const model = await modelRegistry.getActiveModel('attrition_risk');

      // 3. Run inference
      const prediction = await inferenceEngine.predict(model, featureVector);

      // 4. Persist prediction
      await predictionRepository.save({
        tenantId,
        employeeId,
        predictionType:   'attrition_risk',
        modelId:          model.id,
        modelVersion:     model.version,
        featureSnapshotId: await featureStore.saveSnapshot(tenantId, employeeId, featureVector),
        predictedValue:    prediction.probability,
        confidence:        prediction.confidence,
        riskTier:          scoreToRiskTier(prediction.probability),
        predictionHorizon: '90d',
        featureImportances: prediction.featureImportances,
      });

      counters.predictionsGenerated.add(1, { type: 'attrition_risk', tenantId });
    });
  },
  { connection: redisConnection, concurrency: 10 }
);
```

---

# Section 13 — Analytics Engineering Foundation

## 13.1 Analytics Worker Architecture

```typescript
// workers/analytics-projector/src/main.ts
// Consumes domain events and projects them into analytics read models

import { createEventConsumer } from '@platform/events';
import { AttendanceAnalyticsProjector } from './projectors/attendance.projector';
import { PayrollAnalyticsProjector } from './projectors/payroll.projector';
import { LeaveAnalyticsProjector } from './projectors/leave.projector';

async function main() {
  const consumer = createEventConsumer({
    consumerName: 'analytics-projector',
    db: createPrismaClient(),
  });

  // Register event handlers
  consumer.on('attendance.daily_attendance.processed', AttendanceAnalyticsProjector.handle);
  consumer.on('payroll.payslip.finalized',             PayrollAnalyticsProjector.handle);
  consumer.on('leave.application.approved',            LeaveAnalyticsProjector.handle);
  consumer.on('leave.balance.updated',                 LeaveAnalyticsProjector.handleBalance);
  consumer.on('employee.created',                      EmployeeDimensionProjector.handleCreate);
  consumer.on('employee.employment_record.changed',    EmployeeDimensionProjector.handleChange);

  await consumer.start();
  logger.info('Analytics projector started');
}
```

---

## 13.2 Attendance Analytics Projector

```typescript
// workers/analytics-projector/src/projectors/attendance.projector.ts
export class AttendanceAnalyticsProjector {
  static async handle(event: DailyAttendanceProcessedEvent): Promise<void> {
    const { tenantId, employeeId, attendanceDate, payload } = event;

    await withUnitOfWork(db, async (uow) => {

      // 1. Resolve employee dimension key
      const employeeKey = await uow.analytics.resolveEmployeeKey(tenantId, employeeId);

      // 2. Upsert fact table (idempotent)
      await uow.analytics.upsertAttendanceFact({
        tenantId,
        employeeKey,
        dateKey:           dateToKey(attendanceDate),
        orgUnitId:         payload.orgUnitId,
        locationId:        payload.locationId,
        shiftId:           payload.shiftId,
        attendanceStatus:  payload.attendanceStatus,
        isPresent:         payload.attendanceStatus === 'present',
        netHoursMinutes:   payload.netHoursMinutes,
        overtimeMinutes:   payload.overtimeMinutes,
        lateInMinutes:     payload.lateInMinutes,
        payrollDayFactor:  payload.payrollDayFactor,
        sourceDailyAttendanceId: payload.dailyAttendanceId,
      });

      // 3. Update KPI summary table (pre-aggregated)
      await uow.analytics.incrementOrgKpi(tenantId, payload.orgUnitId, attendanceDate, {
        presentDelta:  payload.attendanceStatus === 'present' ? 1 : 0,
        absentDelta:   payload.attendanceStatus === 'absent'  ? 1 : 0,
        lateDelta:     payload.lateInMinutes > 0              ? 1 : 0,
        onLeaveDelta:  payload.attendanceStatus === 'on_leave'? 1 : 0,
        overtimeDelta: payload.overtimeMinutes,
      });

      // 4. Update live workforce snapshot
      await uow.analytics.refreshWorkforceSnapshot(tenantId);

      // 5. Write idempotency record
      await uow.events.markProcessed('analytics-projector', event.eventId);
    });
  }
}
```

---

## 13.3 ClickHouse Ingestion Worker

```typescript
// workers/analytics-projector/src/clickhouse-ingester.ts
// Phase 2+: When ClickHouse is deployed, events are dual-projected:
// PostgreSQL analytics schema (operational) + ClickHouse (historical/analytical)

import { createClient } from '@clickhouse/client';
import { config } from '@platform/config';

export class ClickHouseIngester {
  private readonly client = createClient({ url: config.CLICKHOUSE_URL });

  async ingestAttendanceFact(rows: AttendanceFactRow[]): Promise<void> {
    if (!config.FF_CLICKHOUSE_ENABLED) return; // Feature flag guard

    await this.client.insert({
      table:  'analytics_ch.fact_attendance_daily',
      values: rows,
      format: 'JSONEachRow',
    });

    logger.info({ count: rows.length }, 'Ingested attendance facts to ClickHouse');
  }

  async ingestBatch<T>(table: string, rows: T[]): Promise<void> {
    if (!config.FF_CLICKHOUSE_ENABLED || rows.length === 0) return;

    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await this.client.insert({ table, values: batch, format: 'JSONEachRow' });
    }
  }
}
```

---

## 13.4 KPI Computation Service

```typescript
// domains/analytics/src/services/kpi.service.ts
export class KpiService {
  /**
   * Dashboard-facing KPI queries — always hit pre-aggregated tables, never raw fact tables.
   * This is a strict architectural rule enforced by code review.
   */
  async getAttendanceOverview(orgUnitId: string, date: Date): Promise<AttendanceKpi> {
    // Query: analytics.kpi_attendance_daily_org (pre-aggregated)
    const summary = await this.analyticsRepo.getOrgAttendanceSummary(orgUnitId, date);

    return {
      date:            date.toISOString().split('T')[0],
      totalEmployees:  summary.totalEmployees,
      presentCount:    summary.presentCount,
      absentCount:     summary.absentCount,
      lateCount:       summary.lateCount,
      onLeaveCount:    summary.onLeaveCount,
      attendanceRate:  summary.attendanceRate,
      avgNetHours:     summary.avgNetHours,
      totalOvertimeHrs: summary.totalOvertimeHours / 60,
    };
  }

  async getAbsenceHeatmap(
    tenantId: string,
    orgUnitId: string,
    from: Date,
    to: Date
  ): Promise<HeatmapCell[][]> {
    // For heatmaps, query fact_attendance_daily with date range
    // Returns pre-grouped by week × day matrix
    const facts = await this.analyticsRepo.getAttendanceFacts({
      tenantId, orgUnitId, from, to,
    });
    return buildHeatmapMatrix(facts, from, to);
  }

  async getPayrollCostTrend(
    tenantId: string,
    orgUnitId: string,
    periods: number
  ): Promise<PayrollTrendPoint[]> {
    // Always query analytics.fact_payroll_summary, never payroll.payslips
    return this.analyticsRepo.getPayrollTrend({ tenantId, orgUnitId, periods });
  }
}
```

---

# Section 14 — CI/CD + Infrastructure Foundation

## 14.1 GitHub Actions CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '9'

jobs:
  # ─── Phase 1: Fast checks (< 2 minutes) ───────────────────────────────────
  lint-and-typecheck:
    name: Lint + Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # Full history for Nx affected analysis

      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }

      - uses: actions/setup-node@v4
        with:
          node-version: '${{ env.NODE_VERSION }}'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Restore Nx cache
        uses: actions/cache@v4
        with:
          path: .nx/cache
          key: nx-${{ runner.os }}-${{ hashFiles('nx.json', 'pnpm-lock.yaml') }}

      - name: Lint affected projects
        run: pnpm nx affected --target=lint --parallel=4

      - name: Typecheck affected projects
        run: pnpm nx affected --target=typecheck --parallel=4

  # ─── Phase 2: Contract validation (< 3 minutes) ────────────────────────────
  contract-validation:
    name: Contract Validation
    needs: lint-and-typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - name: Regenerate OpenAPI
        run: pnpm codegen:openapi
      - name: Assert no contract drift
        run: |
          if ! git diff --quiet packages/contracts/src/openapi/; then
            echo "❌ OpenAPI spec has drifted from route definitions"
            exit 1
          fi

  # ─── Phase 3: Tests (< 8 minutes) ─────────────────────────────────────────
  test:
    name: Test
    needs: lint-and-typecheck
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: workforce_test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - name: Apply test migrations
        run: pnpm prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/workforce_test
      - name: Run affected tests
        run: pnpm nx affected --target=test --parallel=2 --coverage
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/workforce_test
      - name: Upload coverage
        uses: codecov/codecov-action@v4

  # ─── Phase 4: Build (< 5 minutes, only on main) ───────────────────────────
  build:
    name: Build
    needs: [contract-validation, test]
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - name: Build affected apps
        run: pnpm nx affected --target=build --parallel=2
      - name: Build Docker images
        run: pnpm nx affected --target=docker-build --parallel=2
```

---

## 14.2 Environment Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│                    ENVIRONMENT TOPOLOGY                               │
│                                                                      │
│  development (local)                                                 │
│    PostgreSQL: Docker Compose                                        │
│    Redis:      Docker Compose                                        │
│    Auth:       Dev JWT (no expiry)                                   │
│    AI:         Mocked responses (cost control)                       │
│    Purpose:    Developer workflow                                     │
│                                                                      │
│  preview (per-PR)                                                    │
│    PostgreSQL: Supabase ephemeral project (per-PR branch)           │
│    API:        Deployed via Railway preview environment              │
│    Frontend:   Vercel preview deployment (auto)                      │
│    Purpose:    PR review, stakeholder demos, QA                      │
│    Lifetime:   Deleted 48h after PR merge/close                     │
│                                                                      │
│  staging                                                             │
│    PostgreSQL: Supabase staging project (production mirror)         │
│    Data:       Anonymized production data snapshot (weekly refresh) │
│    AI:         Live AI keys (cost budgeted)                          │
│    Purpose:    Integration testing, migration validation             │
│    Auto-deploy: On merge to develop branch                          │
│                                                                      │
│  production                                                          │
│    PostgreSQL: Supabase production                                  │
│    Redis:      Upstash Redis (serverless)                            │
│    API:        Fly.io (multi-region)                                 │
│    Frontend:   Vercel (global CDN)                                   │
│    Workers:    Fly.io (dedicated VMs)                                │
│    Deploy:     Manual promotion from staging via GitHub Actions      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 14.3 Docker Strategy

```dockerfile
# infra/docker/api/Dockerfile
# Multi-stage build — production image ~180MB (vs 1.2GB naive Node image)

# ─── Stage 1: Dependencies ────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@9

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/ ./packages/
COPY domains/ ./domains/
COPY apps/api/package.json ./apps/api/package.json

RUN pnpm install --frozen-lockfile --filter=api...

# ─── Stage 2: Builder ─────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json ./
COPY prisma/ ./prisma/
COPY apps/api/ ./apps/api/

RUN pnpm nx run api:build
RUN pnpm prisma generate

# ─── Stage 3: Production ──────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup --system app && adduser --system --ingroup app app
WORKDIR /app

COPY --from=builder --chown=app:app /app/apps/api/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=app:app /app/prisma ./prisma

USER app

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

---

## 14.4 Blue/Green Deployment

```yaml
# .github/workflows/deploy-production.yml
name: Deploy Production

on:
  workflow_dispatch:
    inputs:
      migration_required:
        description: 'Does this release include DB migrations?'
        type: boolean

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Apply DB migrations (if required)
        if: inputs.migration_required
        run: |
          pnpm prisma migrate deploy
          # Migrations applied BEFORE new app version
          # New app version must be backward-compatible with old schema
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}

      - name: Deploy API (blue/green via Fly.io)
        run: |
          # Deploy to blue slot
          fly deploy --app workforce-api-blue --image ${{ env.IMAGE_TAG }}
          
          # Wait for blue to be healthy
          fly checks list --app workforce-api-blue --wait 120
          
          # Shift 10% traffic to blue
          fly scale --app workforce-api-blue --count 1
          fly autoscale --app workforce-api 90 --app workforce-api-blue 10
          
          # Monitor for 5 minutes
          sleep 300
          
          # Check error rates
          if [ $(get_error_rate workforce-api-blue) -gt 1 ]; then
            echo "❌ Blue deployment shows elevated errors. Aborting."
            fly autoscale --app workforce-api 100 --app workforce-api-blue 0
            exit 1
          fi
          
          # Full cutover
          fly autoscale --app workforce-api 0 --app workforce-api-blue 100
          
      - name: Deploy Frontend (Vercel auto-promotes on merge)
        run: echo "Vercel deployment triggered automatically on push to main"
```



---


# Section 15 — Existing System Integration Strategy

## 15.1 Integration Philosophy — Strangler Fig Pattern

The Strangler Fig pattern is the authoritative model for integrating the new platform architecture with the existing HRMS system. Like a strangler fig vine that gradually envelops and replaces a host tree, the new platform wraps the existing system and incrementally replaces its surfaces — until the old system can be safely removed.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    STRANGLER FIG INTEGRATION MODEL                        │
│                                                                          │
│  Phase 0 (Current):                                                      │
│    [Existing Backend] ─── [Existing DB] ─── [Existing UI]               │
│                                                                          │
│  Phase 1 (Proxy Layer):                                                  │
│    [New API] ──▶ [Anti-Corruption Layer / Adapter] ──▶ [Existing]       │
│    New frontend routes through new API                                   │
│    Existing API remains available at /api/legacy/*                       │
│                                                                          │
│  Phase 2 (Domain-by-Domain):                                            │
│    [New API] ──▶ [New Domain Logic] ──▶ [Shared DB]                    │
│    [New API] ──▶ [Legacy Adapter]   ──▶ [Existing DB]    (for unported) │
│                                                                          │
│  Phase 3 (Completion):                                                   │
│    [New API] ──▶ [All New Domain Logic] ──▶ [New Schema]                │
│    Legacy adapter removed. Existing system decommissioned.               │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 15.2 API Coexistence — Routing Strategy

Both the old API and the new API must serve traffic simultaneously during the migration window. The routing strategy avoids the need to deploy a separate proxy server.

```
URL Routing Strategy:

/api/v1/*       → New Fastify application (new domain implementations)
/api/legacy/*   → Passthrough proxy to existing backend
/api/*          → Redirect to /api/v1/* (for old clients, where safe)

Implementation in apps/api:
```

```typescript
// apps/api/src/routes/legacy/index.ts
import { FastifyPluginAsync } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '@platform/config';
import { logger } from '@platform/observability';

/**
 * Legacy API passthrough proxy.
 * Forwards requests to the existing backend without modification.
 * Preserves Authorization headers and request bodies.
 *
 * This route is TEMPORARY and will be removed when all domains are ported.
 * Removal tracked in: docs/adr/007-legacy-api-removal-plan.md
 */
export const legacyRoutes: FastifyPluginAsync = async (fastify) => {
  if (!config.LEGACY_API_URL) {
    logger.warn('LEGACY_API_URL not set — legacy routes will return 503');
    return;
  }

  await fastify.register(httpProxy, {
    upstream:    config.LEGACY_API_URL,
    prefix:      '/api/legacy',
    rewritePrefix: '/api',          // Strip /legacy before forwarding
    http2:       false,
    preHandler:  async (request) => {
      // Inject new correlation ID into legacy request
      request.headers['x-correlation-id'] = request.id;
      // Log all legacy API calls for migration progress tracking
      logger.info({
        path:          request.url,
        method:        request.method,
        correlationId: request.id,
      }, 'Legacy API call');
    },
  });
};
```

---

## 15.3 Adapter Patterns — Anti-Corruption Layer

The Anti-Corruption Layer (ACL) translates between the new domain model and the existing system's data model. This prevents the existing system's model from contaminating the new domain design.

```typescript
// domains/attendance/src/adapters/legacy-attendance.adapter.ts
/**
 * Anti-Corruption Layer for legacy attendance data.
 * Translates legacy database records into new domain types.
 *
 * This adapter queries the EXISTING database tables directly during transition.
 * Once attendance domain is fully ported, this adapter is removed.
 */

interface LegacyAttendanceRecord {
  emp_id:     number;      // Old integer ID
  punch_dt:   string;      // Old format: 'YYYY-MM-DD HH:mm:ss' no timezone
  type:       'I' | 'O';  // In/Out — different enum than new system
  device:     string;      // Device code, not UUID
  loc_code:   string;      // Location code, not UUID
}

export class LegacyAttendanceAdapter {
  constructor(
    private readonly legacyDb: LegacyKnexClient,
    private readonly employeeIdMap: EmployeeIdMapper,
    private readonly locationCodeMap: LocationCodeMapper
  ) {}

  async getPunchRecordsForEmployee(
    employeeId: string,   // New UUID
    from: Date,
    to: Date
  ): Promise<PunchRecord[]> {

    // Resolve new UUID → old integer ID
    const legacyEmpId = await this.employeeIdMap.toLegacyId(employeeId);

    const legacyRecords = await this.legacyDb<LegacyAttendanceRecord>('attendance_logs')
      .where('emp_id', legacyEmpId)
      .whereBetween('punch_dt', [
        format(from, 'yyyy-MM-dd HH:mm:ss'),
        format(to, 'yyyy-MM-dd HH:mm:ss'),
      ])
      .orderBy('punch_dt', 'asc');

    // Translate to new domain model
    return legacyRecords.map(rec => this.translateRecord(rec, employeeId));
  }

  private translateRecord(
    rec: LegacyAttendanceRecord,
    employeeId: string
  ): PunchRecord {
    return {
      id:               generateDeterministicUuid(rec.emp_id, rec.punch_dt),
      tenantId:         this.resolveTenantId(rec.emp_id),
      employeeId,
      punchType:        rec.type === 'I' ? 'in' : 'out',
      punchSource:      'biometric',
      punchedAt:        parseIncompleteDatetime(rec.punch_dt),  // Add timezone
      serverReceivedAt: parseIncompleteDatetime(rec.punch_dt),
      effectiveAt:      parseIncompleteDatetime(rec.punch_dt),
      status:           'processed',
      locationId:       this.locationCodeMap.toUuid(rec.loc_code),
    };
  }
}
```

---

## 15.4 ID Mapping Strategy

The existing system uses integer primary keys. The new system uses UUIDs. During the migration window, a mapping table maintains the correspondence.

```sql
-- Cross-domain ID mapping table (temporary — removed after full migration)
CREATE TABLE migration.id_map (
    domain          VARCHAR(50) NOT NULL,
    legacy_id       VARCHAR(50) NOT NULL,  -- Old integer or string ID
    new_id          UUID        NOT NULL,  -- New UUID
    migrated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (domain, legacy_id)
);
CREATE INDEX idx_id_map_new ON migration.id_map (domain, new_id);

-- Employee mapping populated during employee domain migration
INSERT INTO migration.id_map (domain, legacy_id, new_id)
SELECT 'employee', CAST(emp_id AS VARCHAR), gen_random_uuid()
FROM legacy.employees;
```

```typescript
// scripts/migration/employee-id-mapper.ts
export class EmployeeIdMapper {
  private cache = new Map<string, string>();

  async toLegacyId(newUuid: string): Promise<number> {
    const key = `employee:new:${newUuid}`;
    if (this.cache.has(key)) return parseInt(this.cache.get(key)!);

    const mapping = await db.migrationIdMap.findFirst({
      where: { domain: 'employee', newId: newUuid },
    });
    if (!mapping) throw new Error(`No legacy ID mapping found for employee ${newUuid}`);
    this.cache.set(key, mapping.legacyId);
    return parseInt(mapping.legacyId);
  }

  async toNewUuid(legacyId: number): Promise<string> {
    const key = `employee:legacy:${legacyId}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const mapping = await db.migrationIdMap.findFirst({
      where: { domain: 'employee', legacyId: legacyId.toString() },
    });
    if (!mapping) throw new Error(`No new UUID mapping found for legacy employee ${legacyId}`);
    this.cache.set(key, mapping.newId);
    return mapping.newId;
  }
}
```

---

## 15.5 Database Coexistence Strategy

During the migration window, new and legacy schemas coexist in the same PostgreSQL instance.

```
Database Layout During Migration:

PostgreSQL Instance (Supabase)
├── legacy schema (existing tables — untouched during migration)
│   ├── employees          (old integer PK)
│   ├── attendance_logs    (old punch format)
│   ├── leave_requests     (old status codes)
│   └── payroll_runs       (old structure)
│
├── NEW DOMAIN SCHEMAS (added progressively)
│   ├── identity.*         (new — fully owned by new platform)
│   ├── employee.*         (new — migrated)
│   ├── attendance.*       (new — migrated)
│   └── ...
│
└── migration schema (temporary — removed post-migration)
    ├── id_map              (old ↔ new ID mappings)
    └── migration_log       (audit of migrated records)
```

**Migration Safety Rule:** Legacy schema tables are NEVER modified by the new platform. The new platform creates new schemas alongside legacy. The legacy application continues writing to legacy schema during the transition. The new platform reads legacy data through adapters.

---

## 15.6 UI Replacement Strategy — Shell Replacement Pattern

The existing UI is replaced section by section, not all at once.

```
Shell Replacement Phases:

Phase 1 — Outer Shell Replacement:
  New Next.js admin app mounts with new navigation shell
  Route /attendance → proxies to legacy UI in <iframe>
  Route /payroll    → proxies to legacy UI in <iframe>
  Users see new navigation, same legacy content
  Allows new auth system to be rolled out before UI rebuild

Phase 2 — Section-by-Section Replacement:
  Route /attendance replaced with new React attendance module
  Route /payroll    remains in legacy iframe
  Each section replaced independently, validated by user testing

Phase 3 — Complete Replacement:
  All routes served by new application
  iframe proxy removed
  Legacy UI decommissioned

Frontend Route Flag Implementation:
  // apps/admin/src/middleware.ts
  export function middleware(request: NextRequest) {
    const legacyRoutes = config.LEGACY_UI_ROUTES?.split(',') ?? [];
    const isLegacyRoute = legacyRoutes.some(r => request.nextUrl.pathname.startsWith(r));

    if (isLegacyRoute) {
      return NextResponse.rewrite(new URL('/legacy-frame', request.url));
    }
  }
```

---

## 15.7 Migration Sequencing — Domain Priority Order

```
Migration Order (determined by dependency graph and risk):

PHASE 1: Infrastructure (Week 1–4)
  □ Monorepo setup (Nx + pnpm)
  □ @platform/contracts (no dependencies)
  □ @platform/config
  □ @platform/observability
  □ @platform/database (Prisma client + base repositories)
  □ @platform/auth (JWT + RBAC)
  □ apps/api (Fastify skeleton + plugins)
  
PHASE 2: Identity + Employee (Week 5–8)
  □ @domain/identity (new auth system)
  □ @domain/employee (employee profiles)
  □ Migrate employee data to new schema
  □ ID mapping table populated
  □ apps/admin (auth + employee modules)
  
PHASE 3: Attendance (Week 9–14) ← HIGHEST PRIORITY DOMAIN
  □ @domain/attendance (new punch recording)
  □ Legacy attendance ACL adapter
  □ Historical attendance data migration (parallel run)
  □ workers/attendance-processor
  □ apps/admin/attendance module
  □ apps/mobile (punch functionality)
  
PHASE 4: Leave + Workflow (Week 15–20)
  □ @domain/leave (leave balances + applications)
  □ @domain/workflow (approval engine)
  □ Leave history migration
  □ apps/ess (leave self-service)
  
PHASE 5: Payroll (Week 21–30) ← HIGHEST RISK DOMAIN
  □ @domain/payroll (payroll run + payslip)
  □ Extensive parallel validation (3 payroll cycles side-by-side)
  □ Payroll data migration
  □ apps/admin/payroll module
  
PHASE 6: Analytics + AI (Week 31+)
  □ workers/analytics-projector
  □ @domain/analytics (read models)
  □ apps/analytics-workspace
  □ @domain/ai (copilot + predictions)
  □ workers/ai-inference
```

---

## 15.8 Parallel Validation — Payroll Safety

Payroll migration requires the most rigorous parallel validation. The existing and new systems must produce identical results for 3 consecutive payroll cycles before cutover.

```typescript
// scripts/validation/payroll-parallel-validate.ts
// Runs after each payroll cycle during parallel run period

interface ValidationResult {
  employeeId: string;
  legacyNet:  number;
  newNet:     number;
  delta:      number;
  deltaPercent: number;
  passed:     boolean;
}

async function validatePayrollCycle(periodYear: number, periodNumber: number) {
  const legacyPayslips = await legacyDb('payslips')
    .where({ year: periodYear, period: periodNumber });

  const newPayslips = await db.payslip.findMany({
    where: { payrollRun: { periodYear, periodNumber } },
  });

  const results: ValidationResult[] = [];

  for (const legacy of legacyPayslips) {
    const newUuid = await employeeIdMapper.toNewUuid(legacy.emp_id);
    const newPayslip = newPayslips.find(p => p.employeeId === newUuid);

    if (!newPayslip) {
      results.push({ employeeId: newUuid, legacyNet: legacy.net_pay, newNet: 0,
                     delta: -legacy.net_pay, deltaPercent: -100, passed: false });
      continue;
    }

    const delta = Math.abs(Number(newPayslip.netEarnings) - legacy.net_pay);
    const deltaPercent = (delta / legacy.net_pay) * 100;

    results.push({
      employeeId: newUuid,
      legacyNet:  legacy.net_pay,
      newNet:     Number(newPayslip.netEarnings),
      delta,
      deltaPercent,
      passed: deltaPercent < 0.01,  // Tolerance: less than 0.01% difference
    });
  }

  const failedCount = results.filter(r => !r.passed).length;
  const failRate = (failedCount / results.length) * 100;

  console.log(`Payroll Parallel Validation: ${periodYear}-${periodNumber}`);
  console.log(`  Total employees: ${results.length}`);
  console.log(`  Passed: ${results.filter(r => r.passed).length}`);
  console.log(`  Failed: ${failedCount} (${failRate.toFixed(2)}%)`);

  if (failedCount > 0) {
    console.log('\nFailed employees:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${r.employeeId}: Legacy=₹${r.legacyNet} New=₹${r.newNet} Delta=₹${r.delta}`);
    });
  }

  // BLOCK CUTOVER if any failures exist
  if (failedCount > 0) {
    process.exit(1);  // Signals CI pipeline to halt payroll migration
  }
}
```

---

# Section 16 — Implementation Roadmap

## 16.1 Phase 0 — Foundation (Weeks 1–4)

**Goal:** Platform infrastructure ready. No feature code yet.

```
Week 1: Repository Setup
  □ Initialize Nx monorepo with pnpm workspaces
  □ Configure @tooling/tsconfig, @tooling/eslint-config
  □ Configure Nx boundary rules (enforce domain isolation)
  □ Set up GitHub Actions CI pipeline (lint + typecheck + test)
  □ Configure remote Nx cache
  □ CODEOWNERS file for all packages

Week 2: Platform Packages — Layer 0 + 1
  □ @platform/contracts — empty but versioned
  □ @platform/config — Zod env schema
  □ @platform/observability — Pino logger + OTel tracer + metrics
  □ CI: all packages lint + typecheck on every PR

Week 3: Platform Packages — Layer 2
  □ @platform/database — Prisma client factory + TenantContext + BaseRepository
  □ @platform/auth — JWT + RBAC + Fastify middleware
  □ @platform/events — EventBus interface + OutboxWriter
  □ Prisma schema (base.prisma + identity.prisma)
  □ First migration: identity schema tables

Week 4: App Skeletons
  □ apps/api — Fastify skeleton with all plugins registered
  □ apps/admin — Next.js skeleton with AppShell
  □ apps/ess — Next.js skeleton
  □ Preview environment (Railway + Vercel) operational
  □ Staging environment operational

⛔ DO NOT BUILD YET:
  - No feature routes
  - No domain business logic
  - No analytics schemas
  - No AI features
```

---

## 16.2 Phase 1 — Core Domains (Weeks 5–20)

**Goal:** Identity, Employee, Attendance, Leave, and Workflow domains operational on new platform. Existing legacy continues running in parallel.

```
Week 5–8: Identity + Employee Foundation
  □ @domain/identity — user auth, sessions, tenant membership
  □ @domain/employee — employee profiles, employment records, compensation
  □ @domain/organization — org units, locations, positions
  □ New auth system live (replaces legacy login)
  □ Employee management UI in apps/admin
  □ Employee data migration (parallel — legacy DB untouched)

Week 9–14: Attendance Domain ← MOST CRITICAL PATH
  □ @platform/contracts — attendance schemas (punch, daily, anomaly)
  □ @domain/attendance — punch recording, daily processor, recalculation
  □ attendance.* PostgreSQL schema + partitioned tables
  □ workers/outbox-relay — operational
  □ workers/attendance-processor — daily computation jobs
  □ Legacy attendance ACL adapter
  □ New punch recording API live (parallel with legacy)
  □ Attendance module in apps/admin
  □ Attendance module in apps/mobile (punch via GPS)
  □ 30-day parallel run validation (new vs legacy)

Week 15–20: Leave + Workflow
  □ @domain/leave — leave types, balances, applications, accrual
  □ @domain/workflow — templates, instances, tasks
  □ Leave management in apps/admin
  □ Leave self-service in apps/ess
  □ Workflow approval UI
  □ @platform/policy-engine operational
  □ @platform/workflow-sdk operational
```

---

## 16.3 Phase 2 — Payroll + Analytics (Weeks 21–36)

**Goal:** Payroll domain migrated. Analytics read models operational. ESS fully functional.

```
Week 21–30: Payroll Domain (HIGH RISK — EXTENDED VALIDATION)
  □ @domain/payroll — payroll runs, payslips, components, ledger, statutory
  □ payroll.* PostgreSQL schema + immutability triggers
  □ workers/payroll-compute — payroll run computation
  □ Payroll management in apps/admin
  □ Payslip access in apps/ess
  □ 3 CONSECUTIVE PAYROLL CYCLES of parallel validation (blocking)
  □ Only cutover after validation passes all 3 cycles

Week 31–36: Analytics Foundation
  □ analytics.* PostgreSQL schema (fact tables + KPI tables)
  □ workers/analytics-projector — event-driven projections
  □ @platform/analytics-sdk operational
  □ KPI service (pre-aggregated dashboard queries)
  □ apps/analytics-workspace — attendance and payroll dashboards
  □ Supabase Realtime for live workforce snapshot
```

---

## 16.4 Phase 3 — AI + Scale (Weeks 37+)

**Goal:** AI copilot and predictions operational. Infrastructure ready for enterprise scale.

```
Week 37–46: AI Platform
  □ @platform/ai-sdk — gateway, prompts, features, vectors
  □ @domain/ai — copilot service, prediction service
  □ ai.* PostgreSQL schema (features, predictions, model registry)
  □ workers/ai-inference — prediction jobs
  □ pgvector setup + policy embeddings
  □ AI copilot in apps/admin and apps/ess
  □ Attrition risk predictions (HR admin view)
  □ Absence risk (manager view)

Week 47+: Scale + Enterprise
  □ ClickHouse deployment (if thresholds crossed)
  □ Kafka/Redis Streams upgrade (if event volume warrants)
  □ Schema-per-tenant for enterprise clients
  □ Read replica routing
  □ Sub-partitioning for large tenants
  □ Mobile offline sync refinement
  □ Legacy system decommission (after all domains migrated)
```

---

## 16.5 What Must NOT Be Built Early

```
❌ DO NOT BUILD before Phase 2:
  - ClickHouse integration (no data to analyze yet)
  - Kafka/event streaming (in-process bus sufficient at early scale)
  - AI predictions (no training data accumulated)
  - Complex analytics dashboards (no analytics schema yet)
  - Mobile app full feature set (prioritize punch + leave)
  - Multi-region infrastructure (single region sufficient initially)

❌ DO NOT BUILD before Phase 3:
  - Custom ML model training pipeline
  - Vector search for large document sets
  - Complex compliance reporting
  - Advanced RBAC with attribute-based access control
  - Third-party HR integrations (focus on core platform first)

Why this matters:
  Building analytics infrastructure before the operational platform
  is ready means you have nothing to analyze.
  Building AI features before you have 6+ months of clean data
  means models train on inconsistent legacy data.
  Building integrations before the API contract is stable
  means integrations break with every schema change.
```

---

# Section 17 — Final Recommendations

## 17.1 Most Critical Platform Engineering Principles

### Principle 1 — The Import Boundary Is Sacred
The Nx module boundary rule that prevents `@domain/attendance` from importing `@domain/payroll` must never have exceptions granted. The first exception creates the expectation of further exceptions. Within six months, every domain imports from every other domain, and extraction becomes impossible. If a domain needs data from another domain, the answer is: publish an event, call a published API, or copy a denormalized value via event subscription.

### Principle 2 — @platform/contracts Is Never Out of Date
The contract generation pipeline must run in CI on every PR. A PR that changes a route handler but fails to update the OpenAPI spec must not merge. Contract drift is a slow-building technical debt that manifests as production bugs with non-obvious root causes. The cost to prevent it (run codegen in CI) is near-zero. The cost of not preventing it is measured in days of debugging.

### Principle 3 — No Database Access Outside Repository Methods
Every database query in the platform goes through a repository method. No `prisma.attendancePunchRecord.findMany()` directly in route handlers. No `db.query()` in service methods. The repository is the only legal path to the database. This rule enables: query optimization in one place, tenant isolation enforcement in one place, and the ability to swap data sources without touching business logic.

### Principle 4 — Payroll Is Paused for Nothing Except Correctness
The payroll domain cutover proceeds only when three consecutive parallel validation cycles pass with zero delta tolerance. A project deadline does not override payroll correctness. Incorrect payroll computation is a legal liability, an employee trust crisis, and a compliance failure. No timeline justifies skipping validation cycles.

### Principle 5 — Every Environment Is Production-Like Except for Data
The staging environment uses production infrastructure (same Supabase tier, same Fly.io configuration, same Vercel tier). The only difference is data. This is non-negotiable: a bug that manifests only in production because the infrastructure behaved differently in staging is a structural failure of the deployment pipeline.

### Principle 6 — Feature Flags Before Migration Cutover
Every new domain implementation ships behind a feature flag before replacing the legacy version. The flag allows instant rollback without a deployment. A new attendance implementation that has a critical bug discovered in production can be disabled in 30 seconds (flip flag) rather than requiring a deployment rollback (15+ minutes).

### Principle 7 — Observability Before Features
Every new service, worker, and domain must have structured logging, distributed tracing, and metrics configured before the first business logic line is written. Debugging a production issue in a service with no tracing is fundamentally harder than in a service with full OpenTelemetry. The observability investment pays dividends on the first production incident.

---

## 17.2 Most Dangerous Engineering Anti-Patterns

| Anti-Pattern | Why Catastrophic | Prevention |
|---|---|---|
| Cross-domain direct imports | Domain coupling; extraction impossible; circular dependencies emerge | Nx boundary rules in ESLint; enforced in CI |
| Inline SQL in route handlers | No tenant isolation enforcement; query duplication; impossible to optimize centrally | Repository layer only; no ORM queries in handlers |
| Shared mutable `utils` package | No owner; breaks everything when changed; accumulates unrelated code | Strict package scoping; utils must have a domain or be promoted to contracts |
| Manual TypeScript types for API responses | Contract drift; type errors not caught at compile time | Auto-generated from OpenAPI; frontend types come from contracts only |
| Migration without rollback procedure | Impossible to recover from failed migration in production | Rollback SQL required in PR; migration review checklist enforced |
| Feature code committed before platform packages | Platform packages built around feature requirements; accumulates design debt | Phase 0 (platform only) must be complete before feature work begins |
| localStorage for sensitive auth data | XSS vulnerability; token exposure | httpOnly cookies for JWT; no sensitive data in localStorage |
| Synchronous payroll cutover | Single point of failure; no rollback path | Parallel run for 3 cycles; feature flag for instant rollback |
| Skipping parallel validation on payroll | Legal liability; employee trust failure | Hard CI gate: parallel validation must pass before cutover PR merges |

---

## 17.3 Highest-Risk Scaling Areas

```
Risk 1 — Attendance Punch Storm (Highest Probability)
  Risk: 5,000+ concurrent punch inserts during shift start
  Threshold: >200 concurrent connections
  Signal: Connection pool saturation metric
  Mitigation: Batch insert pipeline (100ms collection → bulk insert)
  Investment: 1 week (BullMQ queue → batch writer)

Risk 2 — Analytics Query OLTP Contamination (High Probability)
  Risk: Dashboard queries compete with punch recording for DB connections
  Threshold: analytics query P95 > 2 seconds
  Signal: Dashboard query latency dashboard
  Mitigation: analytics.* schema queries → dedicated read connection pool
  Investment: 2 days (connection pool configuration + query routing)

Risk 3 — Event Outbox Backlog (Medium Probability)
  Risk: Outbox relay falls behind; events delayed; analytics stale
  Threshold: outbox pending count > 5,000
  Signal: outbox_pending_count metric alert
  Mitigation: Multiple relay workers; priority-based batch sizing
  Investment: 3 days (worker parallelism + monitoring alert)

Risk 4 — Payroll Computation Timeout (Low Probability, High Impact)
  Risk: Large tenant payroll run exceeds statement timeout
  Threshold: >5,000 employees in single run
  Signal: payroll.computation_duration_ms histogram P95
  Mitigation: Parallel cohort processing; async BullMQ job per cohort
  Investment: 1 week (cohort parallelization)

Risk 5 — monorepo Build Time Growth (Medium Probability)
  Risk: Full rebuild takes >30 minutes; engineers stop using CI
  Threshold: Full rebuild > 20 minutes
  Signal: CI duration metrics
  Mitigation: Nx affected properly configured; Nx Cloud remote cache enabled
  Investment: 2 days (Nx Cloud setup + affected configuration tuning)
```

---

## 17.4 Platform Engineering Maturity Roadmap

| Level | State | Capabilities | Timeline |
|---|---|---|---|
| **L0** | Ad-hoc | Shared codebase, no boundaries, inline SQL, manual deployments | Pre-platform |
| **L1** | Structured | Nx monorepo, domain schemas, repository layer, contract-first APIs, basic CI | Phase 0 complete |
| **L2** | Observable | Full OTel tracing, structured logging, Prometheus metrics, error tracking, preview environments | Phase 1 complete |
| **L3** | Validated | Parallel run validation, contract drift CI gates, visual regression testing, automated migration testing | Phase 2 complete |
| **L4** | Elastic | ClickHouse analytics, domain read replicas, feature flags system, blue/green deployments, AI telemetry | Phase 3 complete |
| **L5** | Enterprise | Multi-region, schema-per-tenant, Kafka event streaming, dedicated ML training pipeline, SOC2 controls | Year 2+ |

---

## 17.5 Frontend Maturity Roadmap

| Level | Capabilities |
|---|---|
| **L0** | Legacy UI (existing system) |
| **L1** | New shell with legacy iframe content, new auth, design token system |
| **L2** | Key modules rebuilt (attendance, leave), TanStack Query, Supabase Realtime |
| **L3** | Full admin replacement, ESS complete, Storybook + visual regression |
| **L4** | Mobile app (punch + leave), PWA, offline support |
| **L5** | Analytics workspace, AI copilot embedded, command palette, accessibility audit |

---

## 17.6 Backend Maturity Roadmap

| Level | Capabilities |
|---|---|
| **L0** | Existing Express/framework monolith |
| **L1** | Fastify skeleton, platform plugins, domain plugin pattern |
| **L2** | All domains implemented, outbox pattern, audit logging, unit-of-work |
| **L3** | Workers extracted (attendance processor, outbox relay), BullMQ jobs |
| **L4** | Analytics projector, AI inference worker, ClickHouse ingestion |
| **L5** | Domain extraction ready (contracts enable zero-API-change extraction), Kafka migration |

---

## 17.7 AI Platform Readiness Roadmap

| Gate | Requirement | Achievable When |
|---|---|---|
| **Gate 1** | Operational data in new schemas with clean structure | Phase 1 complete |
| **Gate 2** | 6+ months of attendance + payroll data | 6 months post-Phase 1 |
| **Gate 3** | Feature store (`ai.employee_features`) populated | Phase 2 complete |
| **Gate 4** | Model registry + prediction persistence tables live | Phase 3 kickoff |
| **Gate 5** | First production predictions (shadow mode, no user impact) | Phase 3, Week 40 |
| **Gate 6** | Copilot with policy grounding (pgvector populated) | Phase 3, Week 43 |
| **Gate 7** | HR-facing AI insights (attrition risk, absence alerts) | Phase 3, Week 46 |
| **Gate 8** | Model governance (drift detection, retrain triggers) | Phase 3, Week 50+ |

---

## 17.8 The Eight Non-Negotiable Engineering Decisions

```
1. Nx monorepo with pnpm — not Turborepo alone
   Reason: Module boundary enforcement requires Nx.
   Cost of changing: Complete repo restructuring.

2. @platform/contracts is the single source of truth for all types
   Reason: Contract drift is the #1 maintainability killer.
   Cost of changing: Type inconsistencies proliferate forever.

3. Fastify for the API (not NestJS, not Express)
   Reason: Schema-first validation aligns with Zod strategy; performance ceiling.
   Cost of changing: Rewrite all route handlers.

4. Repository pattern — no inline database access
   Reason: Tenant isolation enforcement; query centralization; testability.
   Cost of changing: Hunt 300+ inline queries in distributed codebase.

5. Strangler Fig pattern — no big-bang rewrite
   Reason: Existing business logic is validated by production. Big-bang risks losing it.
   Cost of changing: Failed rewrite sets platform back 12 months.

6. Payroll requires 3-cycle parallel validation
   Reason: Legal liability, employee trust, statutory compliance.
   Cost of changing: First incorrect payroll = existential business risk.

7. Outbox pattern for all domain events (no fire-and-forget)
   Reason: Events must not be lost under failure. Outbox is the only safe pattern.
   Cost of changing: Event loss → stale analytics, missing AI features, audit gaps.

8. Phase 0 (platform infrastructure) before any feature code
   Reason: Features built without a stable platform must be rebuilt when platform matures.
   Cost of changing: Technical debt on every feature shipped in Phase 0 window.
```

---

*End of MASTER MONOREPO + PLATFORM ENGINEERING ARCHITECTURE*

*Document Version: 1.0 | Platform: Workforce Operating System | Classification: Internal Architecture — Confidential*



---


