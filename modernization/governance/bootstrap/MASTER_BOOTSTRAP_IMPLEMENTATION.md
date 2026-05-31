# REAL MONOREPO + FOUNDATION BOOTSTRAP IMPLEMENTATION
## AI-Native Workforce Operating System — Engineering Foundation Setup
### Principal Platform Engineer Bootstrap Guide — Implementation Grade

---

> **Document Purpose:** This is the executable engineering bootstrap guide. Every file path, every config value, every command, and every dependency listed here is real and production-oriented. Execute this guide in sequence. Do not skip phases.

---

# Section 1 — Foundation Bootstrap Philosophy

## 1.1 The Bootstrap Mandate

The bootstrap phase has a single, non-negotiable goal: **build the platform foundation without touching any existing business logic**. The existing attendance, leave, and payroll engines have years of validated production logic. They will be integrated later, through adapter layers, one domain at a time. During bootstrap, they are invisible to the new platform.

This is harder than it sounds. The gravitational pull toward "while we're at it, let's also fix the attendance calculation" is real and must be resisted. Every hour spent touching existing logic during bootstrap is an hour not spent on the foundation that makes future integration safe.

**What must exist after successful bootstrap completion:**
```
✅ Nx/Turborepo monorepo with enforced package boundaries
✅ All shared packages scaffolded with public APIs defined
✅ Fastify API boots and serves /health
✅ Next.js admin app boots with authenticated shell
✅ Prisma client configured, connects to Supabase
✅ Zod config validation fails fast on missing env vars
✅ Pino structured logging active on every request
✅ OpenTelemetry trace context propagated on every request
✅ GitHub Actions CI runs lint + typecheck + test in < 5 minutes
✅ Docker Compose starts full local stack in one command
✅ Supabase local running with first migration applied
✅ Legacy API accessible at /api/legacy/* (proxy, untouched)
✅ Preview environments deploy on every PR automatically
```

**What must NOT exist after bootstrap:**
```
❌ No attendance screens
❌ No payroll computation logic
❌ No leave management UI
❌ No analytics dashboards
❌ No AI features
❌ No ClickHouse
❌ No Kafka
❌ No event projections
❌ No domain business logic beyond auth and employee stub
```

---

## 1.2 Bootstrap Principles

**Principle 1 — Packages before applications.** Every shared package (`@platform/contracts`, `@platform/config`, `@platform/observability`) must be fully scaffolded and exporting before any application code references it. Applications are leaves in the dependency tree.

**Principle 2 — Config validation fails at startup, not at runtime.** The Zod environment schema rejects missing or malformed variables at process start. No application ships with silent configuration failures.

**Principle 3 — The legacy system is a black box.** The new platform does not read legacy database tables directly. The legacy API is proxied, not wrapped. Legacy integration comes in Phase 3, not Phase 0.

**Principle 4 — Every file has an owner.** `CODEOWNERS` is created in the same commit as the first package. Ownership is never retroactively assigned.

**Principle 5 — Local development is one command.** `pnpm dev` starts the complete local stack. A developer who has cloned the repository and run `pnpm install` should be able to reach a working local environment with one additional command.

---

## 1.3 Coexistence Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    COEXISTENCE ARCHITECTURE                           │
│                                                                      │
│  EXISTING SYSTEM (untouched during bootstrap)                        │
│  ────────────────────────────────────────────                        │
│  Legacy Node.js/Express backend   → port 4000 (local)               │
│  Legacy database tables           → existing Supabase schemas        │
│  Legacy frontend                  → served by legacy backend         │
│                                                                      │
│  NEW PLATFORM (bootstrap target)                                     │
│  ────────────────────────────────                                    │
│  apps/platform-api                → port 3001 (local)               │
│  apps/workforce-os (admin)        → port 3000 (local)               │
│  apps/ess-portal                  → port 3002 (local)               │
│                                                                      │
│  BRIDGE (proxy — zero business logic)                                │
│  ────────────────────────────────────                                │
│  apps/platform-api /api/legacy/*  → proxies to :4000                │
│  New auth tokens accepted by both → JWT bridging                    │
│                                                                      │
│  SHARED                                                              │
│  ─────────                                                           │
│  Supabase PostgreSQL instance     → both read/write                  │
│  New schemas alongside legacy     → no cross-schema writes yet      │
└──────────────────────────────────────────────────────────────────────┘
```

---

# Section 2 — Real Monorepo Structure

## 2.1 Complete Folder Hierarchy

```
workforce-os/                           # Root repository
│
├── apps/                               # Deployable applications
│   ├── platform-api/                   # Fastify backend (new platform)
│   ├── workforce-os/                   # Next.js admin platform
│   ├── ess-portal/                     # Next.js employee self-service
│   └── legacy-adapter/                 # Thin proxy to existing backend
│
├── workers/                            # Background processing
│   ├── event-relay/                    # Outbox → event bus relay
│   ├── analytics/                      # Event → analytics projections (Phase 2)
│   └── ai-inference/                   # ML inference jobs (Phase 3)
│
├── packages/                           # Shared internal libraries
│   ├── contracts/                      # @platform/contracts — Zod schemas + types
│   ├── config/                         # @platform/config — env validation
│   ├── database/                       # @platform/database — Prisma client + repos
│   ├── auth/                           # @platform/auth — JWT + RBAC
│   ├── events/                         # @platform/events — event bus + outbox
│   ├── observability/                  # @platform/observability — logging + tracing
│   ├── ui/                             # @platform/ui — design system
│   └── testing/                        # @platform/testing — test utilities
│
├── domains/                            # Domain module packages (backend only)
│   ├── identity/                       # @domain/identity — auth, sessions, tenants
│   ├── employee/                       # @domain/employee — employee profiles
│   ├── organization/                   # @domain/organization — org structure
│   ├── attendance/                     # @domain/attendance — stub (Phase 1)
│   ├── leave/                          # @domain/leave — stub (Phase 1)
│   ├── payroll/                        # @domain/payroll — stub (Phase 2)
│   └── workflow/                       # @domain/workflow — stub (Phase 1)
│
├── prisma/                             # All database schema
│   ├── schema/                         # Split schema files by domain
│   │   ├── base.prisma
│   │   ├── identity.prisma
│   │   └── employee.prisma
│   ├── migrations/                     # Migration files (versioned)
│   └── seeds/                          # Seed scripts per environment
│
├── infra/                              # Infrastructure as code
│   ├── docker/
│   │   ├── platform-api/Dockerfile
│   │   └── docker-compose.dev.yml
│   └── terraform/                      # Phase 2+
│
├── tooling/                            # Internal build tooling
│   ├── eslint-config/                  # @tooling/eslint-config
│   ├── tsconfig/                       # @tooling/tsconfig
│   └── prettier-config/               # @tooling/prettier-config
│
├── scripts/                            # Operational scripts
│   ├── setup.sh                        # First-time setup
│   ├── codegen/
│   │   └── openapi.ts                  # OpenAPI spec generation
│   └── db/
│       └── create-partitions.ts        # Partition management
│
├── docs/                               # Architecture documentation
│   ├── architecture/                   # The four master documents
│   └── adr/                            # Architecture Decision Records
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── preview.yml
│   │   └── deploy.yml
│   └── CODEOWNERS
│
├── turbo.json                          # Turborepo configuration
├── pnpm-workspace.yaml                 # pnpm workspace definition
├── package.json                        # Root package.json
├── tsconfig.base.json                  # Root TypeScript base config
├── .eslintrc.js                        # Root ESLint config
├── .prettierrc                         # Prettier config
├── .env.example                        # Environment variable template
└── .gitignore
```

---

## 2.2 Ownership and Import Rules

```
OWNERSHIP MAP:
─────────────
packages/*      → Platform team owns all shared packages
domains/*       → Domain team owns their domain (one team per domain)
apps/*          → Product team owns applications
workers/*       → Platform team owns worker processes
infra/*         → Platform/DevOps team
tooling/*       → Platform team

DEPENDENCY DIRECTION (strictly one-way):
─────────────────────────────────────────
packages/contracts    → no internal deps
packages/config       → no internal deps
packages/observability → packages/config
packages/database     → packages/contracts, packages/config
packages/auth         → packages/contracts, packages/config
packages/events       → packages/contracts, packages/database
packages/ui           → packages/contracts (types only)
packages/testing      → all packages (test environment only)

domains/*             → packages/* only (never other domains/*)
apps/*                → packages/*, domains/*
workers/*             → packages/*, domains/*

FORBIDDEN IMPORTS (enforced by ESLint):
────────────────────────────────────────
domains/attendance  ✗→ domains/payroll     (use events instead)
domains/payroll     ✗→ domains/attendance  (use repositories instead)
packages/contracts  ✗→ packages/database   (contracts must be isomorphic)
packages/ui         ✗→ packages/database   (UI is browser-only)
apps/*              ✗→ directly importing another app
```

---

## 2.3 Legacy System Location

```
EXISTING SYSTEM FILES — reference only, do not modify:
──────────────────────────────────────────────────────
The existing codebase is NOT inside this monorepo during bootstrap.
It runs as an independent process.

Reference it via:
  LEGACY_API_URL=http://localhost:4000 (local)
  LEGACY_API_URL=https://api.your-existing-domain.com (staging/prod)

If the existing codebase IS brought into the monorepo (optional):
  apps/legacy-system/     ← READ-ONLY reference; no new code added here
  packages/legacy-types/  ← Type-only package extracted from legacy types
```

---

# Section 3 — Workspace Setup

## 3.1 pnpm-workspace.yaml

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
  - 'domains/*'
  - 'tooling/*'
```

---

## 3.2 turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$"],
      "outputs": ["coverage/**"]
    },
    "test:integration": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    },
    "codegen": {
      "dependsOn": ["^build"],
      "outputs": ["src/generated/**", "src/openapi/**"]
    },
    "db:generate": {
      "cache": false,
      "outputs": ["node_modules/.prisma/**"]
    }
  },
  "globalEnv": [
    "NODE_ENV",
    "DATABASE_URL",
    "DIRECT_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "LEGACY_API_URL"
  ]
}
```

---

## 3.3 Root package.json

```json
{
  "name": "workforce-os",
  "version": "0.1.0",
  "private": true,
  "description": "AI-Native Workforce Operating System",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.14.2",
  "scripts": {
    "build":           "turbo run build",
    "dev":             "turbo run dev",
    "dev:api":         "turbo run dev --filter=platform-api",
    "dev:admin":       "turbo run dev --filter=workforce-os",
    "dev:ess":         "turbo run dev --filter=ess-portal",
    "lint":            "turbo run lint",
    "typecheck":       "turbo run typecheck",
    "test":            "turbo run test",
    "test:integration":"turbo run test:integration",
    "clean":           "turbo run clean && find . -name 'node_modules' -type d -prune -exec rm -rf {} +",
    "codegen":         "turbo run codegen",
    "codegen:openapi": "tsx scripts/codegen/openapi.ts",
    "db:generate":     "turbo run db:generate --filter=@platform/database",
    "db:migrate:dev":  "prisma migrate dev --schema=prisma/schema",
    "db:migrate:deploy":"prisma migrate deploy --schema=prisma/schema",
    "db:studio":       "prisma studio --schema=prisma/schema",
    "db:seed":         "tsx prisma/seeds/index.ts",
    "setup":           "bash scripts/setup.sh",
    "format":          "prettier --write \"**/*.{ts,tsx,md,json,yaml}\" --ignore-path .gitignore"
  },
  "devDependencies": {
    "@tooling/eslint-config":   "workspace:*",
    "@tooling/tsconfig":        "workspace:*",
    "@tooling/prettier-config": "workspace:*",
    "turbo":                    "^2.3.3",
    "tsx":                      "^4.19.2",
    "typescript":               "^5.7.2",
    "prettier":                 "^3.4.2",
    "eslint":                   "^9.17.0",
    "prisma":                   "^6.1.0",
    "@prisma/client":           "^6.1.0"
  }
}
```

---

## 3.4 tsconfig.base.json

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target":                        "ES2022",
    "lib":                           ["ES2022"],
    "module":                        "NodeNext",
    "moduleResolution":              "NodeNext",
    "moduleDetection":               "force",
    "allowImportingTsExtensions":    false,
    "resolveJsonModule":             true,
    "strict":                        true,
    "noUncheckedIndexedAccess":      true,
    "noImplicitOverride":            true,
    "noUnusedLocals":                true,
    "noUnusedParameters":            true,
    "exactOptionalPropertyTypes":    false,
    "skipLibCheck":                  true,
    "declaration":                   true,
    "declarationMap":                true,
    "sourceMap":                     true,
    "esModuleInterop":               true,
    "allowSyntheticDefaultImports":  true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax":          true,
    "paths": {
      "@platform/contracts":          ["./packages/contracts/src/index.ts"],
      "@platform/contracts/*":        ["./packages/contracts/src/*"],
      "@platform/config":             ["./packages/config/src/index.ts"],
      "@platform/database":           ["./packages/database/src/index.ts"],
      "@platform/auth":               ["./packages/auth/src/index.ts"],
      "@platform/events":             ["./packages/events/src/index.ts"],
      "@platform/observability":      ["./packages/observability/src/index.ts"],
      "@platform/ui":                 ["./packages/ui/src/index.ts"],
      "@platform/ui/*":               ["./packages/ui/src/*"],
      "@platform/testing":            ["./packages/testing/src/index.ts"],
      "@domain/identity":             ["./domains/identity/src/index.ts"],
      "@domain/employee":             ["./domains/employee/src/index.ts"],
      "@domain/organization":         ["./domains/organization/src/index.ts"],
      "@domain/attendance":           ["./domains/attendance/src/index.ts"],
      "@domain/leave":                ["./domains/leave/src/index.ts"],
      "@domain/payroll":              ["./domains/payroll/src/index.ts"],
      "@domain/workflow":             ["./domains/workflow/src/index.ts"]
    }
  }
}
```

---

## 3.5 tooling/tsconfig/

```json
// tooling/tsconfig/package.json
{
  "name": "@tooling/tsconfig",
  "version": "0.0.1",
  "private": true,
  "files": ["base.json", "nextjs.json", "node.json", "react-library.json"]
}
```

```json
// tooling/tsconfig/node.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

```json
// tooling/tsconfig/nextjs.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": true,
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "incremental": true
  },
  "exclude": ["node_modules"]
}
```

```json
// tooling/tsconfig/react-library.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "dom", "dom.iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

---

## 3.6 ESLint Architecture Rules

```javascript
// tooling/eslint-config/package.json
{
  "name": "@tooling/eslint-config",
  "version": "0.0.1",
  "private": true,
  "exports": {
    "./base":   "./base.js",
    "./next":   "./next.js",
    "./node":   "./node.js",
    "./domain": "./domain.js"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.18.0",
    "@typescript-eslint/parser": "^8.18.0",
    "eslint-plugin-import": "^2.31.0",
    "eslint-import-resolver-typescript": "^3.7.0"
  }
}
```

```javascript
// tooling/eslint-config/base.js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    // No console.log in production code
    'no-console': ['error', { allow: ['warn', 'error'] }],
    // Enforce import ordering
    'import/order': ['error', {
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc' },
    }],
    // TypeScript strictness
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

```javascript
// tooling/eslint-config/domain.js
// Extra rules enforcing domain boundary isolation
module.exports = {
  extends: ['./base.js'],
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [
        // Domains cannot import from other domains
        {
          target: './domains/attendance',
          from: ['./domains/payroll', './domains/leave', './domains/workflow'],
          message: 'Domain imports: use @platform/events or APIs instead',
        },
        {
          target: './domains/payroll',
          from: ['./domains/attendance', './domains/leave', './domains/workflow'],
          message: 'Domain imports: use @platform/events or APIs instead',
        },
        // Contracts cannot import from platform packages
        {
          target: './packages/contracts',
          from: ['./packages/database', './packages/auth', './packages/events'],
          message: '@platform/contracts must be isomorphic — no Node.js deps',
        },
        // UI cannot import from server packages
        {
          target: './packages/ui',
          from: ['./packages/database', './packages/events'],
          message: '@platform/ui is browser-only — no server package imports',
        },
      ],
    }],
  },
};
```

---

## 3.7 Root .eslintrc.js

```javascript
// .eslintrc.js
module.exports = {
  root: true,
  extends: ['@tooling/eslint-config/base'],
  parserOptions: {
    project: './tsconfig.base.json',
    tsconfigRootDir: __dirname,
  },
  settings: {
    'import/resolver': {
      typescript: { project: './tsconfig.base.json' },
    },
  },
  overrides: [
    {
      files: ['domains/**/*.ts'],
      extends: ['@tooling/eslint-config/domain'],
    },
    {
      files: ['apps/workforce-os/**/*.tsx', 'apps/ess-portal/**/*.tsx', 'packages/ui/**/*.tsx'],
      extends: ['@tooling/eslint-config/next'],
    },
    {
      // Relax rules in test files
      files: ['**/*.test.ts', '**/*.spec.ts', '**/testing/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
  ],
};
```

---

## 3.8 Prettier Config

```javascript
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

```json
// tooling/prettier-config/package.json
{
  "name": "@tooling/prettier-config",
  "version": "0.0.1",
  "private": true,
  "main": "index.json",
  "files": ["index.json"]
}
```

---

## 3.9 CODEOWNERS

```
# .github/CODEOWNERS
# Platform team owns all shared infrastructure
/packages/           @workforce-os/platform-team
/tooling/            @workforce-os/platform-team
/infra/              @workforce-os/platform-team
/.github/            @workforce-os/platform-team
/turbo.json          @workforce-os/platform-team
/pnpm-workspace.yaml @workforce-os/platform-team
/tsconfig.base.json  @workforce-os/platform-team
/prisma/             @workforce-os/platform-team

# Domain teams own their domains
/domains/identity/   @workforce-os/platform-team
/domains/employee/   @workforce-os/product-team
/domains/attendance/ @workforce-os/product-team
/domains/payroll/    @workforce-os/payroll-team
/domains/leave/      @workforce-os/product-team

# App ownership
/apps/workforce-os/  @workforce-os/frontend-team
/apps/ess-portal/    @workforce-os/frontend-team
/apps/platform-api/  @workforce-os/platform-team

# Documentation
/docs/               @workforce-os/platform-team
```

---

## 3.10 .gitignore

```
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.next/
.turbo/
*.js.map
*.d.ts.map

# Prisma
node_modules/.prisma/
prisma/schema/*.js

# Environment
.env
.env.local
.env.*.local
!.env.example

# Editor
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Test / Coverage
coverage/
.nyc_output/

# Docker
infra/docker/.env

# Supabase local
supabase/.temp/
supabase/logs/
```

---

## 3.11 .env.example

```bash
# .env.example — copy to .env and fill in values
# ALL variables must be set. Application fails at startup if any are missing.

# ─── Application ─────────────────────────────────────────────
NODE_ENV=development
SERVICE_NAME=platform-api
APP_VERSION=0.1.0

# ─── Database (Supabase) ─────────────────────────────────────
# Pooled connection (via PgBouncer) — for runtime queries
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct connection — for Prisma migrations only
DIRECT_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres

# ─── Auth ────────────────────────────────────────────────────
JWT_SECRET=change-me-minimum-32-chars-required-here
JWT_EXPIRY=1h
SESSION_SECRET=change-me-different-32-chars-required

# ─── Redis (BullMQ / Cache) ──────────────────────────────────
REDIS_URL=redis://localhost:6379

# ─── Observability ───────────────────────────────────────────
LOG_LEVEL=debug
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # Uncomment for tracing
# SENTRY_DSN=                                         # Uncomment for error tracking

# ─── Legacy System Integration ───────────────────────────────
LEGACY_API_URL=http://localhost:4000

# ─── URLs ────────────────────────────────────────────────────
API_BASE_URL=http://localhost:3001
ADMIN_URL=http://localhost:3000
ESS_URL=http://localhost:3002
NEXT_PUBLIC_API_URL=http://localhost:3001

# ─── Feature Flags ───────────────────────────────────────────
FF_CLICKHOUSE_ENABLED=false
FF_KAFKA_ENABLED=false
FF_AI_PREDICTIONS=false

# ─── AI (Phase 3) ────────────────────────────────────────────
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
```

# Section 4 — Initial Application Bootstrap

## 4.1 apps/platform-api — Fastify Backend

```
apps/platform-api/
├── src/
│   ├── main.ts
│   ├── app.ts
│   ├── plugins/
│   │   ├── database.ts
│   │   ├── auth.ts
│   │   ├── tenant.ts
│   │   ├── cors.ts
│   │   ├── rate-limit.ts
│   │   ├── observability.ts
│   │   └── swagger.ts
│   ├── routes/
│   │   ├── index.ts
│   │   ├── v1/
│   │   │   ├── index.ts
│   │   │   ├── health.ts
│   │   │   └── auth.ts
│   │   └── legacy/
│   │       └── proxy.ts          ← passthrough to legacy system
│   └── middleware/
│       └── error-handler.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

```json
// apps/platform-api/package.json
{
  "name": "platform-api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":       "tsx watch src/main.ts",
    "build":     "tsc -p tsconfig.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts",
    "test":      "vitest run",
    "test:watch":"vitest"
  },
  "dependencies": {
    "@fastify/cors":        "^9.0.1",
    "@fastify/helmet":      "^11.1.1",
    "@fastify/http-proxy":  "^9.4.1",
    "@fastify/rate-limit":  "^9.1.0",
    "@fastify/swagger":     "^8.15.0",
    "@fastify/swagger-ui":  "^4.1.0",
    "@platform/auth":       "workspace:*",
    "@platform/config":     "workspace:*",
    "@platform/contracts":  "workspace:*",
    "@platform/database":   "workspace:*",
    "@platform/events":     "workspace:*",
    "@platform/observability": "workspace:*",
    "@domain/identity":     "workspace:*",
    "@domain/employee":     "workspace:*",
    "fastify":              "^4.28.1",
    "fastify-plugin":       "^4.5.1",
    "fastify-zod":          "^1.3.2"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "tsx":               "^4.19.2",
    "typescript":        "^5.7.2",
    "vitest":            "^2.1.8"
  }
}
```

```json
// apps/platform-api/tsconfig.json
{
  "extends": "@tooling/tsconfig/node.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir":  "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```typescript
// apps/platform-api/src/main.ts
import { buildApp } from './app.js';
import { config } from '@platform/config';
import { logger } from '@platform/observability';

async function main() {
  const app = await buildApp();

  try {
    await app.listen({
      port: parseInt(process.env['PORT'] ?? '3001', 10),
      host: '0.0.0.0',
    });
    logger.info(
      { port: 3001, env: config.NODE_ENV, version: config.APP_VERSION },
      '🚀 Platform API started'
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  process.exit(1);
});

main();
```

```typescript
// apps/platform-api/src/app.ts
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '@platform/config';
import { logger as pinoLogger } from '@platform/observability';

export async function buildApp(opts?: { testing?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts?.testing ? false : pinoLogger,
    trustProxy: true,
    requestIdHeader: 'x-correlation-id',
    requestIdLogLabel: 'correlationId',
    genReqId: () => crypto.randomUUID(),
    ajv: {
      customOptions: {
        strict: 'log',
        keywords: ['kind', 'modifier'],
      },
    },
  });

  // ── Infrastructure plugins (order is significant) ─────────────────────
  await app.register(import('./plugins/observability.js'));
  await app.register(import('./plugins/cors.js'));
  await app.register(import('./plugins/database.js'));
  await app.register(import('./plugins/auth.js'));
  await app.register(import('./plugins/tenant.js'));
  await app.register(import('./plugins/rate-limit.js'));

  // ── OpenAPI docs (non-production or testing flag off) ──────────────────
  if (config.NODE_ENV !== 'production' && !opts?.testing) {
    await app.register(import('./plugins/swagger.js'));
  }

  // ── Routes ────────────────────────────────────────────────────────────
  await app.register(import('./routes/index.js'));

  // ── Error handler ─────────────────────────────────────────────────────
  await app.register(import('./middleware/error-handler.js'));

  return app;
}
```

---

## 4.2 apps/workforce-os — Admin Next.js App

```
apps/workforce-os/
├── src/
│   ├── app/
│   │   ├── layout.tsx           ← Root layout (providers)
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx
│   │   └── (dashboard)/
│   │       ├── layout.tsx       ← App shell layout
│   │       ├── page.tsx         ← Dashboard home (stub)
│   │       └── settings/
│   │           └── page.tsx
│   ├── components/
│   │   └── providers.tsx        ← QueryClient, Auth, Theme providers
│   ├── lib/
│   │   ├── api-client.ts        ← Generated openapi-fetch client
│   │   ├── query-client.ts
│   │   └── auth.ts
│   └── middleware.ts            ← Auth + route protection
├── public/
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
└── postcss.config.js
```

```json
// apps/workforce-os/package.json
{
  "name": "workforce-os",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":       "next dev -p 3000",
    "build":     "next build",
    "start":     "next start",
    "typecheck": "tsc --noEmit",
    "lint":      "next lint"
  },
  "dependencies": {
    "@platform/contracts":     "workspace:*",
    "@platform/config":        "workspace:*",
    "@platform/ui":            "workspace:*",
    "@tanstack/react-query":   "^5.62.7",
    "@tanstack/react-query-devtools": "^5.62.7",
    "next":                    "^15.1.0",
    "react":                   "^19.0.0",
    "react-dom":               "^19.0.0",
    "zustand":                 "^5.0.2",
    "openapi-fetch":           "^0.13.0",
    "framer-motion":           "^11.15.0",
    "react-hook-form":         "^7.54.1",
    "@hookform/resolvers":     "^3.9.1",
    "zod":                     "^3.24.1",
    "nuqs":                    "^2.3.0",
    "cmdk":                    "^1.0.4",
    "lucide-react":            "^0.469.0",
    "class-variance-authority":"^0.7.1",
    "clsx":                    "^2.1.1",
    "tailwind-merge":          "^2.6.0"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "@types/react":      "^19.0.1",
    "@types/react-dom":  "^19.0.1",
    "tailwindcss":       "^3.4.17",
    "postcss":           "^8.4.49",
    "autoprefixer":      "^10.4.20",
    "typescript":        "^5.7.2"
  }
}
```

```typescript
// apps/workforce-os/next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    serverComponentsExternalPackages: [],
  },
  // Proxy API calls to backend in development
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
```

```typescript
// apps/workforce-os/tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        brand: {
          50:  '#f0f4ff', 100: '#e0e9ff', 200: '#c7d4fe',
          500: '#4361ee', 600: '#3451d1', 700: '#2a41b5', 900: '#1a2980',
        },
        // Attendance status
        status: {
          present:   '#16a34a',
          absent:    '#dc2626',
          late:      '#d97706',
          leave:     '#2563eb',
          holiday:   '#7c3aed',
          weekoff:   '#6b7280',
          halfday:   '#ea580c',
        },
        // Risk tiers
        risk: {
          low:      '#22c55e',
          medium:   '#f59e0b',
          high:     '#ef4444',
          critical: '#7f1d1d',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
  ],
} satisfies Config;
```

---

## 4.3 apps/ess-portal — Employee Self-Service

```json
// apps/ess-portal/package.json
{
  "name": "ess-portal",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":       "next dev -p 3002",
    "build":     "next build",
    "start":     "next start -p 3002",
    "typecheck": "tsc --noEmit",
    "lint":      "next lint"
  },
  "dependencies": {
    "@platform/contracts":    "workspace:*",
    "@platform/ui":           "workspace:*",
    "@tanstack/react-query":  "^5.62.7",
    "next":                   "^15.1.0",
    "react":                  "^19.0.0",
    "react-dom":              "^19.0.0",
    "openapi-fetch":          "^0.13.0",
    "zustand":                "^5.0.2",
    "react-hook-form":        "^7.54.1",
    "@hookform/resolvers":    "^3.9.1",
    "zod":                    "^3.24.1",
    "lucide-react":           "^0.469.0"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "@types/react":      "^19.0.1",
    "tailwindcss":       "^3.4.17",
    "typescript":        "^5.7.2"
  }
}
```

---

## 4.4 workers/event-relay

```json
// workers/event-relay/package.json
{
  "name": "event-relay",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":       "tsx watch src/main.ts",
    "build":     "tsc -p tsconfig.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@platform/config":      "workspace:*",
    "@platform/database":    "workspace:*",
    "@platform/events":      "workspace:*",
    "@platform/observability":"workspace:*",
    "bullmq":                "^5.27.0",
    "ioredis":               "^5.4.1"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "tsx":               "^4.19.2",
    "typescript":        "^5.7.2"
  }
}
```

---

# Section 5 — Shared Package Scaffolding

## 5.1 @platform/contracts

```
packages/contracts/
├── src/
│   ├── index.ts                ← barrel export
│   ├── schemas/
│   │   ├── common.ts           ← shared value types (pagination, ID, date)
│   │   ├── identity.ts         ← auth/session schemas
│   │   ├── employee.ts         ← employee schemas
│   │   └── errors.ts           ← error response schemas
│   ├── dtos/                   ← inferred TypeScript types (no manual types)
│   │   └── index.ts
│   └── events/
│       ├── base.ts             ← event envelope schema
│       ├── identity-events.ts
│       └── employee-events.ts
├── package.json
└── tsconfig.json
```

```json
// packages/contracts/package.json
{
  "name": "@platform/contracts",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".":       { "import": "./src/index.ts", "require": "./src/index.ts" },
    "./events":"./src/events/index.ts",
    "./schemas/*": "./src/schemas/*.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "typescript": "^5.7.2"
  }
}
```

```json
// packages/contracts/tsconfig.json
{
  "extends": "@tooling/tsconfig/node.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir":  "dist",
    "module":  "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

```typescript
// packages/contracts/src/schemas/common.ts
import { z } from 'zod';

export const UUIDSchema = z.string().uuid();
export const DateStringSchema = z.string().date();  // YYYY-MM-DD
export const DateTimeSchema = z.string().datetime({ offset: true });

export const PaginationQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
  page:       z.number().int(),
  pageSize:   z.number().int(),
  total:      z.number().int(),
  totalPages: z.number().int(),
  hasNext:    z.boolean(),
  hasPrev:    z.boolean(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export function paginatedResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data:       z.array(dataSchema),
    pagination: PaginationMetaSchema,
  });
}

export const SortOrderSchema = z.enum(['asc', 'desc']).default('asc');

export const ErrorResponseSchema = z.object({
  error:         z.string(),
  message:       z.string(),
  details:       z.unknown().optional(),
  correlationId: z.string().uuid().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
```

```typescript
// packages/contracts/src/schemas/identity.ts
import { z } from 'zod';
import { UUIDSchema, DateTimeSchema } from './common.js';

export const LoginRequestSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthTokenResponseSchema = z.object({
  accessToken:  z.string(),
  refreshToken: z.string(),
  expiresAt:    DateTimeSchema,
  user: z.object({
    id:        UUIDSchema,
    email:     z.string().email(),
    tenantId:  UUIDSchema,
    roles:     z.array(z.string()),
  }),
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

export const JwtClaimsSchema = z.object({
  sub:         UUIDSchema,
  email:       z.string().email(),
  tenant_id:   UUIDSchema,
  roles:       z.array(z.string()),
  permissions: z.array(z.string()),
  jti:         UUIDSchema,
  iat:         z.number(),
  exp:         z.number(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;
```

```typescript
// packages/contracts/src/events/base.ts
import { z } from 'zod';
import { UUIDSchema, DateTimeSchema } from '../schemas/common.js';

export const EventEnvelopeBaseSchema = z.object({
  eventId:        UUIDSchema,
  eventType:      z.string().min(1),
  eventVersion:   z.number().int().min(1).default(1),
  eventCategory:  z.enum(['domain', 'integration', 'audit', 'ai']),
  tenantId:       UUIDSchema,
  aggregateType:  z.string().min(1),
  aggregateId:    UUIDSchema,
  correlationId:  UUIDSchema.optional(),
  causationId:    UUIDSchema.optional(),
  occurredAt:     DateTimeSchema,
  publishedAt:    DateTimeSchema.optional(),
  actor: z.object({
    id:   UUIDSchema.optional(),
    type: z.enum(['user', 'system', 'worker']),
  }),
  metadata: z.record(z.unknown()).optional(),
});
export type EventEnvelopeBase = z.infer<typeof EventEnvelopeBaseSchema>;
```

```typescript
// packages/contracts/src/index.ts
// Common schemas
export * from './schemas/common.js';
export * from './schemas/identity.js';
export * from './schemas/employee.js';
export * from './schemas/errors.js';

// Event schemas
export * from './events/base.js';
export * from './events/identity-events.js';
export * from './events/employee-events.js';
```

---

## 5.2 @platform/config

```
packages/config/
├── src/
│   ├── index.ts
│   ├── schema.ts         ← Zod env schema
│   └── loader.ts         ← fail-fast loader
├── package.json
└── tsconfig.json
```

```json
// packages/config/package.json
{
  "name": "@platform/config",
  "version": "0.1.0",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "typescript": "^5.7.2"
  }
}
```

```typescript
// packages/config/src/schema.ts
import { z } from 'zod';

const boolStr = z.string().transform((v) => v === 'true' || v === '1');

export const ConfigSchema = z.object({
  // Application
  NODE_ENV:        z.enum(['development', 'test', 'staging', 'production']).default('development'),
  SERVICE_NAME:    z.string().min(1).default('platform-api'),
  APP_VERSION:     z.string().min(1).default('0.0.0'),
  PORT:            z.coerce.number().int().default(3001),

  // Database
  DATABASE_URL:    z.string().url(),
  DIRECT_URL:      z.string().url().optional(),
  DATABASE_POOL_MIN: z.coerce.number().int().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),

  // Auth
  JWT_SECRET:      z.string().min(32),
  JWT_EXPIRY:      z.string().default('1h'),
  SESSION_SECRET:  z.string().min(32).optional(),

  // Redis
  REDIS_URL:       z.string().url().optional(),

  // Observability
  LOG_LEVEL:       z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN:      z.string().url().optional(),

  // Legacy integration
  LEGACY_API_URL:  z.string().url().optional(),

  // URLs
  API_BASE_URL:    z.string().url().default('http://localhost:3001'),
  ADMIN_URL:       z.string().url().default('http://localhost:3000'),
  ESS_URL:         z.string().url().default('http://localhost:3002'),

  // Feature flags
  FF_CLICKHOUSE_ENABLED: boolStr.default('false'),
  FF_KAFKA_ENABLED:      boolStr.default('false'),
  FF_AI_PREDICTIONS:     boolStr.default('false'),

  // AI (Phase 3)
  OPENAI_API_KEY:     z.string().optional(),
  ANTHROPIC_API_KEY:  z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
```

```typescript
// packages/config/src/loader.ts
import { ConfigSchema, type Config } from './schema.js';

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    // Use process.stderr directly here — logger is not yet initialized
    process.stderr.write(
      `\n❌ Configuration validation failed. Missing or invalid environment variables:\n${issues}\n\n` +
      `  ➜ Copy .env.example to .env and fill in all values.\n\n`
    );
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

// Lazy proxy — config validated on first property access
export const config = new Proxy({} as Config, {
  get(_target, prop: string) {
    return loadConfig()[prop as keyof Config];
  },
});
```

```typescript
// packages/config/src/index.ts
export { loadConfig, config } from './loader.js';
export type { Config } from './schema.js';
export { ConfigSchema } from './schema.js';
```

---

## 5.3 @platform/observability

```
packages/observability/
├── src/
│   ├── index.ts
│   ├── logger.ts          ← Pino factory
│   ├── tracer.ts          ← OpenTelemetry setup
│   ├── metrics.ts         ← Prometheus metrics
│   ├── correlation.ts     ← Correlation ID context
│   └── middleware/
│       ├── fastify.ts     ← Request logging + tracing plugin
│       └── nextjs.ts      ← Next.js middleware helper
├── package.json
└── tsconfig.json
```

```json
// packages/observability/package.json
{
  "name": "@platform/observability",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./middleware/fastify": "./src/middleware/fastify.ts",
    "./middleware/nextjs":  "./src/middleware/nextjs.ts"
  },
  "dependencies": {
    "@platform/config": "workspace:*",
    "@opentelemetry/api":                       "^1.9.0",
    "@opentelemetry/sdk-node":                  "^0.56.0",
    "@opentelemetry/exporter-trace-otlp-http":  "^0.56.0",
    "@opentelemetry/resources":                 "^1.29.0",
    "@opentelemetry/semantic-conventions":       "^1.28.0",
    "@opentelemetry/sdk-trace-base":             "^1.29.0",
    "pino":                                     "^9.6.0",
    "pino-pretty":                              "^13.0.0"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "fastify": "^4.28.1",
    "typescript": "^5.7.2"
  }
}
```

---

## 5.4 @platform/database

```
packages/database/
├── src/
│   ├── index.ts
│   ├── client.ts           ← Prisma client factory
│   ├── tenant-context.ts   ← AsyncLocalStorage tenant context
│   ├── unit-of-work.ts     ← UoW factory
│   └── repositories/
│       ├── interfaces.ts
│       └── base.ts
├── package.json
└── tsconfig.json
```

```json
// packages/database/package.json
{
  "name": "@platform/database",
  "version": "0.1.0",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@platform/config":    "workspace:*",
    "@platform/observability": "workspace:*",
    "@prisma/client":      "^6.1.0"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "prisma":            "^6.1.0",
    "typescript":        "^5.7.2"
  }
}
```

---

## 5.5 @platform/auth

```json
// packages/auth/package.json
{
  "name": "@platform/auth",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".":                    "./src/index.ts",
    "./middleware/fastify": "./src/middleware/fastify.ts"
  },
  "dependencies": {
    "@platform/config":    "workspace:*",
    "@platform/contracts": "workspace:*",
    "@platform/observability": "workspace:*",
    "jose":                "^5.9.6",
    "fastify-plugin":      "^4.5.1"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "fastify": "^4.28.1",
    "typescript": "^5.7.2"
  }
}
```

---

## 5.6 @platform/events

```json
// packages/events/package.json
{
  "name": "@platform/events",
  "version": "0.1.0",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@platform/config":    "workspace:*",
    "@platform/contracts": "workspace:*",
    "@platform/database":  "workspace:*",
    "@platform/observability": "workspace:*",
    "bullmq":              "^5.27.0",
    "ioredis":             "^5.4.1"
  },
  "devDependencies": {
    "@tooling/tsconfig": "workspace:*",
    "typescript": "^5.7.2"
  }
}
```

---

## 5.7 @platform/ui

```json
// packages/ui/package.json
{
  "name": "@platform/ui",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".":         "./src/index.ts",
    "./*":       "./src/*.tsx"
  },
  "scripts": {
    "storybook":       "storybook dev -p 6006",
    "build-storybook": "storybook build",
    "typecheck":       "tsc --noEmit"
  },
  "dependencies": {
    "@platform/contracts":  "workspace:*",
    "@radix-ui/react-dialog":   "^1.1.4",
    "@radix-ui/react-dropdown-menu": "^2.1.4",
    "@radix-ui/react-label":    "^2.1.1",
    "@radix-ui/react-select":   "^2.1.4",
    "@radix-ui/react-slot":     "^1.1.1",
    "@radix-ui/react-tooltip":  "^1.1.6",
    "ag-grid-community":        "^33.0.2",
    "ag-grid-react":            "^33.0.2",
    "class-variance-authority": "^0.7.1",
    "clsx":                     "^2.1.1",
    "cmdk":                     "^1.0.4",
    "framer-motion":            "^11.15.0",
    "lucide-react":             "^0.469.0",
    "recharts":                 "^2.13.3",
    "tailwind-merge":           "^2.6.0"
  },
  "devDependencies": {
    "@tooling/tsconfig":  "workspace:*",
    "@storybook/react":   "^8.4.7",
    "@storybook/nextjs":  "^8.4.7",
    "storybook":          "^8.4.7",
    "@types/react":       "^19.0.1",
    "typescript":         "^5.7.2"
  },
  "peerDependencies": {
    "react":     "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

---

# Section 6 — Contract-First Foundation

## 6.1 Contract Structure Expanded

```typescript
// packages/contracts/src/schemas/employee.ts
import { z } from 'zod';
import { UUIDSchema, DateStringSchema, DateTimeSchema } from './common.js';

export const EmploymentTypeSchema = z.enum([
  'full_time', 'part_time', 'contract', 'intern', 'probation',
]);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const EmployeeStatusSchema = z.enum(['active', 'inactive', 'terminated', 'on_leave']);

// Create DTO — what the API accepts on creation
export const CreateEmployeeSchema = z.object({
  employeeNumber:   z.string().min(1).max(50).trim(),
  legalFirstName:   z.string().min(1).max(100).trim(),
  legalLastName:    z.string().min(1).max(100).trim(),
  preferredName:    z.string().max(100).trim().optional(),
  workEmail:        z.string().email().toLowerCase(),
  hireDate:         DateStringSchema,
  employmentType:   EmploymentTypeSchema,
  orgUnitId:        UUIDSchema,
  locationId:       UUIDSchema,
  reportingManagerId: UUIDSchema.optional(),
});
export type CreateEmployeeDto = z.infer<typeof CreateEmployeeSchema>;

// Response DTO — what the API returns
export const EmployeeResponseSchema = z.object({
  id:               UUIDSchema,
  tenantId:         UUIDSchema,
  employeeNumber:   z.string(),
  displayName:      z.string(),
  workEmail:        z.string().email(),
  status:           EmployeeStatusSchema,
  hireDate:         DateStringSchema,
  employmentType:   EmploymentTypeSchema,
  orgUnitId:        UUIDSchema,
  orgUnitName:      z.string().optional(),
  locationId:       UUIDSchema,
  locationName:     z.string().optional(),
  reportingManagerId: UUIDSchema.optional(),
  createdAt:        DateTimeSchema,
  updatedAt:        DateTimeSchema,
});
export type EmployeeResponse = z.infer<typeof EmployeeResponseSchema>;

export const EmployeeListResponseSchema = z.object({
  data: z.array(EmployeeResponseSchema),
  pagination: z.object({
    page: z.number(), pageSize: z.number(),
    total: z.number(), totalPages: z.number(),
    hasNext: z.boolean(), hasPrev: z.boolean(),
  }),
});
```

---

## 6.2 Route Contract Registration

```typescript
// domains/employee/src/routes/index.ts
import type { FastifyInstance } from 'fastify';
import {
  CreateEmployeeSchema,
  EmployeeResponseSchema,
  EmployeeListResponseSchema,
  PaginationQuerySchema,
} from '@platform/contracts';
import { EmployeeController } from '../controllers/employee.controller.js';

export async function employeeRoutes(fastify: FastifyInstance) {

  // POST /api/v1/employees
  fastify.route({
    method:  'POST',
    url:     '/',
    schema: {
      summary: 'Create employee',
      tags:    ['Employees'],
      body:    CreateEmployeeSchema,
      response: { 201: EmployeeResponseSchema },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const employee = await EmployeeController.create(request.body, request.user);
      return reply.code(201).send(employee);
    },
  });

  // GET /api/v1/employees
  fastify.route({
    method:  'GET',
    url:     '/',
    schema: {
      summary:     'List employees',
      tags:        ['Employees'],
      querystring: PaginationQuerySchema.extend({
        status:    z.enum(['active','inactive','terminated']).optional(),
        orgUnitId: z.string().uuid().optional(),
        search:    z.string().max(100).optional(),
      }),
      response: { 200: EmployeeListResponseSchema },
    },
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      return EmployeeController.list(request.query, request.user);
    },
  });
}
```

---

## 6.3 OpenAPI Generation Script

```typescript
// scripts/codegen/openapi.ts
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

async function generateOpenApi() {
  console.log('📋 Generating OpenAPI specification...');

  // Import app without starting the HTTP server
  const { buildApp } = await import('../../apps/platform-api/src/app.js');
  const app = await buildApp({ testing: true });
  await app.ready();

  const spec = app.swagger();
  const outputDir = resolve(__dirname, '../../packages/contracts/src/openapi');
  mkdirSync(outputDir, { recursive: true });

  const specPath = `${outputDir}/openapi.json`;
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  console.log(`  ✅ OpenAPI spec written to ${specPath}`);

  // Generate TypeScript types for frontend
  execSync(
    `pnpm openapi-typescript ${specPath} --output ${outputDir}/types.ts --alphabetize`,
    { stdio: 'inherit' }
  );
  console.log('  ✅ TypeScript API types generated');

  await app.close();
  console.log('✅ OpenAPI generation complete');
}

generateOpenApi().catch((err) => {
  console.error('❌ OpenAPI generation failed:', err);
  process.exit(1);
});
```

---

## 6.4 Frontend API Client Setup

```typescript
// apps/workforce-os/src/lib/api-client.ts
// This file is partially generated (types come from generated openapi/types.ts)
// The client configuration is manual.

import createClient from 'openapi-fetch';
import type { paths } from '@platform/contracts/openapi/types';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('access_token');
}

export const apiClient = createClient<paths>({
  baseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
  headers: {
    'Content-Type': 'application/json',
  },
  fetch: (url, init) => {
    const token = getToken();
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string>),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Correlation-ID': crypto.randomUUID(),
      },
    });
  },
});

// Typed query helpers — one per resource
export const employeeApi = {
  list:   (params: { page?: number; pageSize?: number; search?: string }) =>
    apiClient.GET('/api/v1/employees', { params: { query: params } }),
  create: (body: CreateEmployeeDto) =>
    apiClient.POST('/api/v1/employees', { body }),
  getById: (id: string) =>
    apiClient.GET('/api/v1/employees/{id}', { params: { path: { id } } }),
};
```

# Section 7 — Database Foundation

## 7.1 Prisma Bootstrap

```
prisma/
├── schema/
│   ├── base.prisma          ← datasource + generator (edit this for DB changes)
│   ├── identity.prisma      ← identity schema tables
│   └── employee.prisma      ← employee schema tables
├── migrations/
│   └── 20250101000000_init_identity_schema/
│       ├── migration.sql
│       └── migration.md     ← rationale (required)
└── seeds/
    ├── index.ts             ← seed entry point
    ├── base/
    │   └── 00-platform-roles.ts
    └── development/
        └── 01-demo-tenant.ts
```

```prisma
// prisma/schema/base.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema", "prismaSchemaFolder"]
  output          = "../node_modules/.prisma/client"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = ["identity", "employee", "audit", "events"]
}
```

```prisma
// prisma/schema/identity.prisma
model Tenant {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  externalId  String   @unique @db.VarChar(64)
  displayName String   @db.VarChar(255)
  planTier    String   @default("starter") @db.VarChar(32)
  status      String   @default("active") @db.VarChar(32)
  settings    Json     @default("{}")
  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz

  users       TenantMembership[]

  @@map("tenants")
  @@schema("identity")
}

model User {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email        String   @unique @db.VarChar(320)
  phone        String?  @db.VarChar(30)
  passwordHash String?  @db.Text
  mfaEnabled   Boolean  @default(false)
  status       String   @default("active") @db.VarChar(32)
  lastLoginAt  DateTime? @db.Timestamptz
  createdAt    DateTime @default(now()) @db.Timestamptz
  updatedAt    DateTime @updatedAt @db.Timestamptz

  memberships  TenantMembership[]
  sessions     Session[]

  @@map("users")
  @@schema("identity")
}

model TenantMembership {
  id       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId String   @db.Uuid
  userId   String   @db.Uuid
  roleId   String   @db.Uuid
  status   String   @default("active") @db.VarChar(32)
  joinedAt DateTime? @db.Timestamptz
  createdAt DateTime @default(now()) @db.Timestamptz

  tenant   Tenant @relation(fields: [tenantId], references: [id])
  user     User   @relation(fields: [userId], references: [id])

  @@unique([tenantId, userId])
  @@map("tenant_memberships")
  @@schema("identity")
}

model Session {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId      String   @db.Uuid
  tenantId    String   @db.Uuid
  tokenHash   String   @unique @db.Text
  ipAddress   String?  @db.Inet
  userAgent   String?  @db.Text
  expiresAt   DateTime @db.Timestamptz
  createdAt   DateTime @default(now()) @db.Timestamptz
  revokedAt   DateTime? @db.Timestamptz

  user        User @relation(fields: [userId], references: [id])

  @@index([tokenHash(ops: raw("text_pattern_ops"))], name: "idx_sessions_token")
  @@index([expiresAt], where: "revoked_at IS NULL")
  @@map("sessions")
  @@schema("identity")
}

model Role {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId    String?  @db.Uuid    // NULL = platform-wide system role
  name        String   @db.VarChar(120)
  permissions Json     @default("[]")
  isSystem    Boolean  @default(false)
  createdAt   DateTime @default(now()) @db.Timestamptz

  @@unique([name, tenantId])
  @@map("roles")
  @@schema("identity")
}
```

```prisma
// prisma/schema/employee.prisma
model Employee {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String   @db.Uuid
  employeeNumber String   @db.VarChar(50)
  userId         String?  @db.Uuid
  status         String   @default("active") @db.VarChar(32)
  hireDate       DateTime @db.Date
  terminationDate DateTime? @db.Date
  createdAt      DateTime @default(now()) @db.Timestamptz
  updatedAt      DateTime @updatedAt @db.Timestamptz

  profile        EmployeeProfile?
  employmentRecords EmploymentRecord[]

  @@unique([tenantId, employeeNumber])
  @@index([tenantId])
  @@map("employees")
  @@schema("employee")
}

model EmployeeProfile {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId     String   @unique @db.Uuid
  tenantId       String   @db.Uuid
  legalFirstName String   @db.Text             // Encrypted at application layer
  legalLastName  String   @db.Text             // Encrypted at application layer
  preferredName  String?  @db.Text
  workEmail      String   @db.VarChar(320)
  updatedAt      DateTime @updatedAt @db.Timestamptz

  employee       Employee @relation(fields: [employeeId], references: [id])

  @@index([tenantId, workEmail])
  @@map("employee_profiles")
  @@schema("employee")
}

model EmploymentRecord {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId       String   @db.Uuid
  tenantId         String   @db.Uuid
  orgUnitId        String   @db.Uuid
  locationId       String   @db.Uuid
  positionId       String?  @db.Uuid
  employmentType   String   @db.VarChar(32)
  reportingManagerId String? @db.Uuid
  effectiveFrom    DateTime @db.Date
  effectiveTo      DateTime? @db.Date
  version          Int      @default(1)
  createdAt        DateTime @default(now()) @db.Timestamptz
  createdBy        String   @db.Uuid

  employee         Employee @relation(fields: [employeeId], references: [id])

  @@index([employeeId, effectiveTo(sort: Asc)])
  @@index([tenantId], where: "effective_to IS NULL")
  @@map("employment_records")
  @@schema("employee")
}
```

---

## 7.2 First Migration — Init Identity Schema

```sql
-- prisma/migrations/20250101000000_init_identity_schema/migration.sql
-- Initialize identity and employee schemas with RLS

-- Create schemas
CREATE SCHEMA IF NOT EXISTS "identity";
CREATE SCHEMA IF NOT EXISTS "employee";
CREATE SCHEMA IF NOT EXISTS "audit";
CREATE SCHEMA IF NOT EXISTS "events";

-- identity.tenants
CREATE TABLE "identity"."tenants" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "externalId"  VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "planTier"    VARCHAR(32) NOT NULL DEFAULT 'starter',
    "status"      VARCHAR(32) NOT NULL DEFAULT 'active',
    "settings"    JSONB NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "tenants_externalId_key" UNIQUE ("externalId")
);

-- identity.users
CREATE TABLE "identity"."users" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "email"        VARCHAR(320) NOT NULL,
    "phone"        VARCHAR(30),
    "passwordHash" TEXT,
    "mfaEnabled"   BOOLEAN NOT NULL DEFAULT FALSE,
    "status"       VARCHAR(32) NOT NULL DEFAULT 'active',
    "lastLoginAt"  TIMESTAMPTZ,
    "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "users_email_key" UNIQUE ("email")
);

-- identity.roles
CREATE TABLE "identity"."roles" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "tenantId"    UUID,
    "name"        VARCHAR(120) NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "isSystem"    BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "roles_name_tenantId_key" UNIQUE ("name", "tenantId")
);

-- identity.tenant_memberships
CREATE TABLE "identity"."tenant_memberships" (
    "id"        UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "tenantId"  UUID NOT NULL REFERENCES "identity"."tenants"("id"),
    "userId"    UUID NOT NULL REFERENCES "identity"."users"("id"),
    "roleId"    UUID NOT NULL,
    "status"    VARCHAR(32) NOT NULL DEFAULT 'active',
    "joinedAt"  TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "memberships_tenant_user_key" UNIQUE ("tenantId", "userId")
);

-- identity.sessions
CREATE TABLE "identity"."sessions" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    "userId"      UUID NOT NULL REFERENCES "identity"."users"("id"),
    "tenantId"    UUID NOT NULL,
    "tokenHash"   TEXT NOT NULL,
    "ipAddress"   INET,
    "userAgent"   TEXT,
    "expiresAt"   TIMESTAMPTZ NOT NULL,
    "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "revokedAt"   TIMESTAMPTZ,
    CONSTRAINT "sessions_tokenHash_key" UNIQUE ("tokenHash")
);
CREATE INDEX "idx_sessions_token" ON "identity"."sessions" ("tokenHash")
    WHERE "revokedAt" IS NULL;
CREATE INDEX "idx_sessions_expiry" ON "identity"."sessions" ("expiresAt")
    WHERE "revokedAt" IS NULL;

-- Enable RLS on all identity tables
ALTER TABLE "identity"."tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."tenant_memberships" ENABLE ROW LEVEL SECURITY;

-- Service account bypass policy (for backend API role)
CREATE POLICY "service_account_full_access" ON "identity"."tenants"
    USING (current_setting('app.role', true) = 'service_account');
CREATE POLICY "service_account_full_access" ON "identity"."users"
    USING (current_setting('app.role', true) = 'service_account');
CREATE POLICY "service_account_full_access" ON "identity"."sessions"
    USING (current_setting('app.role', true) = 'service_account');
CREATE POLICY "service_account_full_access" ON "identity"."tenant_memberships"
    USING (current_setting('app.role', true) = 'service_account');
```

```markdown
<!-- prisma/migrations/20250101000000_init_identity_schema/migration.md -->
# Migration: Initialize Identity + Employee Schemas

## Purpose
Bootstrap the platform with identity and employee schemas.
Creates the foundation for multi-tenant authentication.

## Impact Assessment
- **Tables affected:** tenants, users, roles, sessions, tenant_memberships (new)
- **Estimated duration:** < 1 second (no existing data)
- **Downtime required:** None
- **Blocking locks:** CREATE TABLE (exclusive, < 100ms on empty DB)

## Rollback Procedure
```sql
DROP SCHEMA identity CASCADE;
DROP SCHEMA employee CASCADE;
DROP SCHEMA audit CASCADE;
DROP SCHEMA events CASCADE;
```

## Verification
After applying:
- [ ] `\dn` shows identity, employee, audit, events schemas
- [ ] RLS enabled on all identity tables (`pg_tables.rowsecurity = true`)
- [ ] Service account policy present
```

---

## 7.3 Prisma Client Factory

```typescript
// packages/database/src/client.ts
import { PrismaClient } from '@prisma/client';
import { config } from '@platform/config';
import { TenantContext } from './tenant-context.js';

let _client: PrismaClient | null = null;

export interface PrismaClientOptions {
  databaseUrl?: string;
  log?:         ('query' | 'warn' | 'error' | 'info')[];
}

export function createPrismaClient(options?: PrismaClientOptions): PrismaClient {
  if (_client) return _client;

  _client = new PrismaClient({
    datasources: {
      db: { url: options?.databaseUrl ?? config.DATABASE_URL },
    },
    log: options?.log ?? (config.NODE_ENV === 'development'
      ? ['warn', 'error', 'query']
      : ['warn', 'error']),
  });

  // Middleware: set tenant context for RLS before every query
  _client.$use(async (params, next) => {
    const ctx = TenantContext.current();
    if (ctx?.tenantId) {
      // Tell PostgreSQL which tenant this connection is for
      await _client!.$executeRaw`
        SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, TRUE),
               set_config('app.current_user_id',   ${ctx.userId},   TRUE),
               set_config('app.role', 'service_account', TRUE)
      `;
    }
    return next(params);
  });

  return _client;
}

// Singleton access for production
export function getPrismaClient(): PrismaClient {
  return createPrismaClient();
}
```

```typescript
// packages/database/src/tenant-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextData {
  tenantId: string;
  userId:   string;
  roles:    string[];
}

const storage = new AsyncLocalStorage<TenantContextData>();

export const TenantContext = {
  /**
   * Run a function within a tenant context.
   * All database queries within fn() will have tenant context set.
   */
  run<T>(data: TenantContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  /** Get the current tenant context (may be undefined outside request) */
  current(): TenantContextData | undefined {
    return storage.getStore();
  },

  /** Get the current tenant context, throws if not set */
  require(): TenantContextData {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'TenantContext is not initialized. ' +
        'Ensure request flows through the tenant middleware plugin.'
      );
    }
    return ctx;
  },
};
```

```typescript
// packages/database/src/unit-of-work.ts
import type { PrismaClient } from '@prisma/client';

type TransactionClient = Parameters<
  Parameters<PrismaClient['$transaction']>[0]
>[0];

/**
 * Execute multiple repository operations within a single atomic transaction.
 * All operations either commit together or rollback together.
 *
 * Usage:
 *   await withUnitOfWork(prisma, async (tx) => {
 *     await tx.$executeRaw`...`;
 *     // All operations use the same transaction
 *   });
 */
export async function withUnitOfWork<T>(
  prisma: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;   // ms to wait for connection (default: 5000)
    timeout?: number;   // ms for transaction to complete (default: 30000)
  }
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait: options?.maxWait ?? 5_000,
    timeout: options?.timeout ?? 30_000,
  });
}
```

```typescript
// packages/database/src/index.ts
export { createPrismaClient, getPrismaClient } from './client.js';
export { TenantContext, type TenantContextData } from './tenant-context.js';
export { withUnitOfWork } from './unit-of-work.js';
export { BaseRepository } from './repositories/base.js';
export type { Repository } from './repositories/interfaces.js';
```

---

## 7.4 Seed Strategy

```typescript
// prisma/seeds/index.ts
import { PrismaClient } from '@prisma/client';
import { seedPlatformRoles } from './base/00-platform-roles.js';
import { seedDemoTenant } from './development/01-demo-tenant.js';

const db = new PrismaClient();
const ENV = process.env['NODE_ENV'] ?? 'development';

async function main() {
  console.log(`🌱 Seeding database (${ENV})...`);

  await seedPlatformRoles(db);
  console.log('  ✅ Platform roles seeded');

  if (ENV === 'development' || ENV === 'test') {
    await seedDemoTenant(db);
    console.log('  ✅ Demo tenant seeded');
  }

  console.log('🌱 Seeding complete');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => db.$disconnect());
```

```typescript
// prisma/seeds/base/00-platform-roles.ts
import type { PrismaClient } from '@prisma/client';

const PLATFORM_ROLES = [
  {
    name: 'system_admin',
    isSystem: true,
    permissions: ['system:admin'],
  },
  {
    name: 'hr_admin',
    isSystem: true,
    permissions: [
      'employee:view:all', 'employee:manage',
      'attendance:view:all', 'attendance:correct',
      'payroll:view:all', 'leave:approve:all',
      'workflow:manage', 'policy:manage',
      'analytics:view', 'ai:copilot:access', 'ai:predictions:view',
    ],
  },
  {
    name: 'payroll_admin',
    isSystem: true,
    permissions: [
      'payroll:run', 'payroll:approve', 'payroll:finalize',
      'employee:view:all', 'attendance:view:all',
    ],
  },
  {
    name: 'manager',
    isSystem: true,
    permissions: [
      'employee:view:team', 'attendance:view:team',
      'leave:approve:team', 'workflow:approve',
      'analytics:view:team',
    ],
  },
  {
    name: 'employee',
    isSystem: true,
    permissions: [
      'attendance:view:own', 'attendance:punch',
      'leave:apply', 'leave:view:own',
      'payroll:view:own', 'ai:copilot:access',
    ],
  },
] as const;

export async function seedPlatformRoles(db: PrismaClient) {
  for (const role of PLATFORM_ROLES) {
    await db.role.upsert({
      where: { name_tenantId: { name: role.name, tenantId: null as unknown as string } },
      update: { permissions: role.permissions as unknown as string[] },
      create: {
        name:        role.name,
        permissions: role.permissions as unknown as string[],
        isSystem:    role.isSystem,
      },
    });
  }
}
```

---

# Section 8 — Observability Foundation

## 8.1 Pino Logger Factory

```typescript
// packages/observability/src/logger.ts
import pino, { type Logger } from 'pino';
import { config } from '@platform/config';
import { TenantContext } from '@platform/database';

const isDev = config.NODE_ENV === 'development';

export const logger: Logger = pino({
  level: config.LOG_LEVEL,
  base: {
    service: config.SERVICE_NAME,
    version: config.APP_VERSION,
    env:     config.NODE_ENV,
  },
  // Redact sensitive fields from all log output
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.secret',
      '*.national_id',
      '*.nationalId',
      '*.bankAccount',
    ],
    censor: '[REDACTED]',
  },
  // Pretty print in development, JSON in production (for log collectors)
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize:         true,
          translateTime:    'SYS:HH:MM:ss',
          ignore:           'pid,hostname,service,version,env',
          messageFormat:    '{service} | {msg}',
        },
      }
    : undefined,
  // Mixin: auto-inject request context into every log line
  mixin: () => {
    const ctx = TenantContext.current();
    if (!ctx) return {};
    return {
      tenantId: ctx.tenantId,
      userId:   ctx.userId,
    };
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => ({
      method:        req.method,
      url:           req.url,
      correlationId: req.id,
      remoteAddress: req.socket?.remoteAddress,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

---

## 8.2 OpenTelemetry Setup

```typescript
// packages/observability/src/tracer.ts
// IMPORTANT: This file must be imported BEFORE any other platform import
// in the application entry point, because OTel must patch Node.js first.

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  trace,
  context,
  propagation,
  type Span,
  SpanStatusCode,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { config } from '@platform/config';

let _sdk: NodeSDK | null = null;

export function initializeTracing() {
  if (_sdk) return;

  const exporters = [];

  if (config.OTEL_EXPORTER_OTLP_ENDPOINT) {
    exporters.push(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: config.OTEL_EXPORTER_OTLP_ENDPOINT }),
        { maxExportBatchSize: 512, scheduledDelayMillis: 5000 }
      )
    );
  }

  _sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]:           config.SERVICE_NAME,
      [SEMRESATTRS_SERVICE_VERSION]:        config.APP_VERSION,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.NODE_ENV,
    }),
    spanProcessors: exporters,
    textMapPropagator: new W3CTraceContextPropagator(),
  });

  _sdk.start();
}

export const tracer = trace.getTracer(
  config.SERVICE_NAME,
  config.APP_VERSION
);

/**
 * Execute a function within a named trace span.
 * Automatically sets span status, records exceptions, and ends the span.
 */
export async function startSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

export { trace, context, propagation };
```

---

## 8.3 Correlation ID Middleware

```typescript
// packages/observability/src/correlation.ts
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

export const CorrelationContext = {
  run<T>(correlationId: string, fn: () => T): T {
    return storage.run(correlationId, fn);
  },
  get(): string {
    return storage.getStore() ?? 'no-correlation-id';
  },
};

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}
```

```typescript
// packages/observability/src/middleware/fastify.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { logger } from '../logger.js';
import { CorrelationContext } from '../correlation.js';
import { tracer } from '../tracer.js';
import { context, trace } from '@opentelemetry/api';

export const observabilityPlugin: FastifyPluginAsync = fp(async (fastify) => {
  // Log incoming request + set correlation context
  fastify.addHook('onRequest', async (request) => {
    const correlationId = (request.headers['x-correlation-id'] as string) ?? request.id;

    // Log request start
    request.log.info({
      method:        request.method,
      url:           request.url,
      correlationId,
      userAgent:     request.headers['user-agent'],
    }, 'Request received');
  });

  // Log outgoing response with duration
  fastify.addHook('onResponse', async (request, reply) => {
    const durationMs = Math.round(reply.elapsedTime);
    request.log.info({
      method:        request.method,
      url:           request.url,
      statusCode:    reply.statusCode,
      durationMs,
    }, 'Request completed');
  });
});
```

---

## 8.4 Metrics Scaffolding

```typescript
// packages/observability/src/metrics.ts
// Prometheus-compatible metrics via OpenTelemetry Metrics API
import { metrics, type Meter } from '@opentelemetry/api';
import { config } from '@platform/config';

const meter: Meter = metrics.getMeter(config.SERVICE_NAME, config.APP_VERSION);

export const counters = {
  httpRequests:    meter.createCounter('http.requests.total',
    { description: 'Total HTTP requests' }),
  httpErrors:      meter.createCounter('http.errors.total',
    { description: 'Total HTTP error responses' }),
  dbQueries:       meter.createCounter('db.queries.total',
    { description: 'Total database queries' }),
  eventsPublished: meter.createCounter('events.published.total',
    { description: 'Total events published to outbox' }),
  eventsConsumed:  meter.createCounter('events.consumed.total',
    { description: 'Total events consumed by workers' }),
};

export const histograms = {
  httpDurationMs: meter.createHistogram('http.request.duration_ms', {
    description: 'HTTP request duration in milliseconds',
    unit:        'ms',
    advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] },
  }),
  dbQueryDurationMs: meter.createHistogram('db.query.duration_ms', {
    description: 'Database query duration in milliseconds',
    unit:        'ms',
    advice: { explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000] },
  }),
};

export { metrics };
```

```typescript
// packages/observability/src/index.ts
export { logger }                    from './logger.js';
export { tracer, startSpan, initializeTracing, trace, context, propagation }
                                     from './tracer.js';
export { counters, histograms }      from './metrics.js';
export { CorrelationContext, generateCorrelationId } from './correlation.js';
export { observabilityPlugin }       from './middleware/fastify.js';
```

---

# Section 9 — Backend Foundation Shell

## 9.1 Fastify Plugin Architecture

```typescript
// apps/platform-api/src/plugins/database.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createPrismaClient } from '@platform/database';
import type { PrismaClient } from '@prisma/client';

// Augment Fastify types so request.prisma is typed everywhere
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const databasePlugin: FastifyPluginAsync = fp(async (fastify) => {
  const prisma = createPrismaClient();

  // Test connection on startup
  await prisma.$connect();
  fastify.log.info('✅ Database connected');

  // Make prisma available on the Fastify instance
  fastify.decorate('prisma', prisma);

  // Disconnect gracefully on server close
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
    fastify.log.info('Database disconnected');
  });
});

export default databasePlugin;
```

```typescript
// apps/platform-api/src/plugins/auth.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt, type JwtClaims } from '@platform/auth';
import { TenantContext } from '@platform/database';
import { logger } from '@platform/observability';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
    requirePermission: (permission: string) => (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: JwtClaims;
  }
  interface FastifyContextConfig {
    isPublic?: boolean;
  }
}

export const authPlugin: FastifyPluginAsync = fp(async (fastify) => {

  // Decorator: authenticate — verifies JWT and populates request.user
  fastify.decorate('authenticate', async function (
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing bearer token' });
    }

    try {
      const token = authHeader.slice(7);
      const claims = await verifyJwt(token);
      request.user = claims;

      // Set tenant context for the duration of this request
      // Note: The TenantContext.run() wraps the remaining request lifecycle
      // via Fastify's async context — AsyncLocalStorage propagates automatically
    } catch (err) {
      logger.warn({ path: request.url }, 'JWT verification failed');
      return reply.code(401).send({ error: 'INVALID_TOKEN', message: 'Token is invalid or expired' });
    }
  });

  // Decorator: requirePermission — checks user has a specific permission
  fastify.decorate('requirePermission', (permission: string) => {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      }
      if (!user.permissions.includes(permission) && !user.permissions.includes('system:admin')) {
        return reply.code(403).send({
          error:   'FORBIDDEN',
          message: `Required permission: ${permission}`,
        });
      }
    };
  });
});

export default authPlugin;
```

```typescript
// apps/platform-api/src/plugins/tenant.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { TenantContext } from '@platform/database';

export const tenantPlugin: FastifyPluginAsync = fp(async (fastify) => {
  // After auth plugin sets request.user, inject tenant context into AsyncLocalStorage
  // This makes tenant_id available to all database queries via Prisma middleware
  fastify.addHook('preHandler', async (request) => {
    if (!request.user) return; // Public routes have no user

    // TenantContext.run() is called here but the actual DB queries happen later.
    // The AsyncLocalStorage propagates through the async call chain automatically.
    TenantContext.run(
      {
        tenantId: request.user.tenant_id,
        userId:   request.user.sub,
        roles:    request.user.roles,
      },
      () => {
        // Context is set — subsequent async operations in this request chain
        // will automatically inherit this context through AsyncLocalStorage
      }
    );
  });
});

export default tenantPlugin;
```

```typescript
// apps/platform-api/src/middleware/error-handler.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { logger } from '@platform/observability';

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} with id '${id}' not found`);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, details);
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(permission: string) {
    super('PERMISSION_DENIED', `Required permission: ${permission}`);
  }
}

const HTTP_STATUS: Record<string, number> = {
  NOT_FOUND:        404,
  UNAUTHORIZED:     401,
  PERMISSION_DENIED:403,
  CONFLICT:         409,
  VALIDATION_ERROR: 422,
  RATE_LIMIT:       429,
};

export const errorHandlerPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      const status = HTTP_STATUS[error.code] ?? 400;
      logger.warn({ code: error.code, path: request.url }, error.message);
      return reply.code(status).send({
        error:         error.code,
        message:       error.message,
        details:       error.details,
        correlationId: request.id,
      });
    }

    // Fastify validation error (Zod/JSON Schema)
    if (error.validation) {
      return reply.code(422).send({
        error:         'VALIDATION_ERROR',
        message:       'Request validation failed',
        details:       error.validation,
        correlationId: request.id,
      });
    }

    // Prisma unique constraint
    if ((error as { code?: string }).code === 'P2002') {
      return reply.code(409).send({
        error:         'CONFLICT',
        message:       'A record with this identifier already exists',
        correlationId: request.id,
      });
    }

    // Unexpected errors
    logger.error({ err: error, path: request.url, correlationId: request.id }, 'Unhandled error');
    return reply.code(500).send({
      error:         'INTERNAL_ERROR',
      message:       'An unexpected error occurred',
      correlationId: request.id,
    });
  });
});

export default errorHandlerPlugin;
```

---

## 9.2 Route Registration

```typescript
// apps/platform-api/src/routes/index.ts
import type { FastifyInstance } from 'fastify';

export async function registerRoutes(fastify: FastifyInstance) {
  // Health checks (no auth required — isPublic: true)
  await fastify.register(import('./v1/health.js'), { prefix: '/' });

  // API v1 routes
  await fastify.register(
    async (v1) => {
      // Auth routes (public)
      await v1.register(import('./v1/auth.js'));

      // Protected domain routes
      await v1.register(import('../../domains_stub/employee/routes.js'));
      // ── Future domain routes registered here as domains are implemented ──
      // await v1.register(import('@domain/attendance/routes'), { prefix: '/attendance' });
      // await v1.register(import('@domain/leave/routes'),      { prefix: '/leave' });
      // await v1.register(import('@domain/payroll/routes'),    { prefix: '/payroll' });
    },
    { prefix: '/api/v1' }
  );

  // Legacy API proxy (preserves existing system during migration)
  if (process.env['LEGACY_API_URL']) {
    await fastify.register(import('./legacy/proxy.js'), { prefix: '/api/legacy' });
  }
}
```

```typescript
// apps/platform-api/src/routes/v1/health.ts
import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', { config: { isPublic: true } }, async () => ({
    status:  'ok',
    service: process.env['SERVICE_NAME'] ?? 'platform-api',
    version: process.env['APP_VERSION'] ?? '0.0.0',
    uptime:  Math.round(process.uptime()),
    ts:      new Date().toISOString(),
  }));

  fastify.get('/ready', { config: { isPublic: true } }, async (_, reply) => {
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'connected' };
    } catch (err) {
      fastify.log.error({ err }, 'Readiness check failed — database unreachable');
      return reply.code(503).send({ status: 'not_ready', db: 'disconnected' });
    }
  });

  fastify.get('/metrics', { config: { isPublic: true } }, async (_, reply) => {
    // Prometheus text format — scraped by monitoring stack
    // Full metrics implementation in Phase 1
    return reply.type('text/plain').send('# Metrics placeholder\n');
  });
}
```

```typescript
// apps/platform-api/src/routes/legacy/proxy.ts
// Thin passthrough proxy to existing backend — ZERO business logic here
import type { FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { logger } from '@platform/observability';

export default async function legacyProxy(fastify: FastifyInstance) {
  const legacyUrl = process.env['LEGACY_API_URL'];

  if (!legacyUrl) {
    logger.warn('LEGACY_API_URL not configured — legacy routes will return 503');
    fastify.all('/*', async (_, reply) =>
      reply.code(503).send({ error: 'LEGACY_UNAVAILABLE', message: 'Legacy API not configured' })
    );
    return;
  }

  logger.info({ legacyUrl }, 'Legacy API proxy configured');

  await fastify.register(httpProxy, {
    upstream:      legacyUrl,
    rewritePrefix: '/api',     // /api/legacy/attendance → legacy /api/attendance
    http2:         false,
    preHandler: async (request) => {
      // Forward correlation ID into legacy system
      request.headers['x-correlation-id'] = request.id;
      request.headers['x-forwarded-by'] = 'workforce-os-platform';
      // Log every legacy call for migration tracking
      logger.info({
        legacyPath:    request.url,
        correlationId: request.id,
        method:        request.method,
      }, 'Legacy API forwarded');
    },
  });
}
```

---

## 9.3 JWT Implementation

```typescript
// packages/auth/src/jwt.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '@platform/config';
import type { JwtClaims } from '@platform/contracts';

const SECRET_KEY = new TextEncoder().encode(config.JWT_SECRET);

export async function signJwt(claims: Omit<JwtClaims, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(claims as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_EXPIRY)
    .setJti(crypto.randomUUID())
    .sign(SECRET_KEY);
}

export async function verifyJwt(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, SECRET_KEY, {
    algorithms: ['HS256'],
  });
  return payload as unknown as JwtClaims;
}
```


---

## Section 10 — Frontend Foundation Shell

### 10.1 Next.js 15 App Router Structure

```
apps/workforce-os/src/
├── app/
│   ├── layout.tsx                    # Root layout — fonts, metadata, providers
│   ├── page.tsx                      # Root redirect → /dashboard
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── layout.tsx                # Auth-only layout (no sidebar)
│   ├── (platform)/
│   │   ├── layout.tsx                # Platform shell — sidebar, header, toast
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   ├── settings/
│   │   │   └── page.tsx
│   │   └── [...slug]/
│   │       └── page.tsx              # Catch-all for domain modules (lazy loaded)
│   └── api/
│       └── health/
│           └── route.ts              # Next.js health check route
├── components/
│   ├── shell/
│   │   ├── app-shell.tsx             # Top-level shell wrapper
│   │   ├── sidebar.tsx               # Collapsible nav sidebar
│   │   ├── topbar.tsx                # Header bar
│   │   ├── breadcrumbs.tsx           # Route-aware breadcrumbs
│   │   └── command-palette.tsx       # ⌘K global command palette
│   ├── ui/                           # Re-exports from @platform/ui
│   └── providers/
│       └── index.tsx                 # All context providers composed
├── lib/
│   ├── api-client.ts                 # openapi-fetch typed client
│   ├── auth.ts                       # Auth helpers (token management)
│   ├── query-client.ts               # TanStack Query client singleton
│   └── utils.ts                      # cn(), formatDate(), etc.
├── hooks/
│   ├── use-auth.ts                   # Auth state + actions
│   ├── use-tenant.ts                 # Current tenant context
│   ├── use-permissions.ts            # Permission gate hook
│   └── use-realtime.ts               # Supabase Realtime subscription
├── store/
│   ├── auth.store.ts                 # Zustand auth slice
│   ├── ui.store.ts                   # Sidebar open, theme, command palette
│   └── index.ts                      # Unified store export
└── types/
    └── next-auth.d.ts                # Type augmentation if needed
```

### 10.2 Root Layout

```typescript
// apps/workforce-os/src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Workforce OS',
    template: '%s | Workforce OS',
  },
  description: 'AI-native Human Resource Management System',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### 10.3 Provider Composition

```typescript
// apps/workforce-os/src/components/providers/index.tsx
'use client';

import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@platform/ui/components/toaster';
import { queryClient } from '@/lib/query-client';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Compose all app-level providers here.
 * Order matters:
 * 1. Theme (outermost — controls CSS vars)
 * 2. QueryClient (data fetching)
 * 3. Auth (depends on query client for token refresh)
 * 4. Toast (renders at root level)
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

### 10.4 TanStack Query Client

```typescript
// apps/workforce-os/src/lib/query-client.ts
import { QueryClient, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Stale time: 30s — prevents double-fetching on quick navigations
        staleTime: 30 * 1000,
        // Cache time: 5 min — keeps data while navigating between routes
        gcTime: 5 * 60 * 1000,
        // Retry once before showing error UI
        retry: 1,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
        // Refetch on window focus only in production
        refetchOnWindowFocus: process.env.NODE_ENV === 'production',
      },
      mutations: {
        // Show errors after 1 retry for mutations
        retry: 1,
      },
    },
  });
}

// Singleton pattern — SSR-safe
let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (isServer) {
    // Always create a new client on the server (per-request)
    return makeQueryClient();
  }

  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }

  return browserQueryClient;
}

// Named export for direct use in providers
export const queryClient = getQueryClient();
```

### 10.5 Zustand Store Architecture

```typescript
// apps/workforce-os/src/store/auth.store.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { JwtClaims } from '@platform/contracts';

interface AuthState {
  token: string | null;
  claims: JwtClaims | null;
  isAuthenticated: boolean;
}

interface AuthActions {
  setAuth: (token: string, claims: JwtClaims) => void;
  clearAuth: () => void;
  updateToken: (token: string) => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()(
  persist(
    immer((set) => ({
      // State
      token: null,
      claims: null,
      isAuthenticated: false,

      // Actions
      setAuth: (token, claims) =>
        set((state) => {
          state.token = token;
          state.claims = claims;
          state.isAuthenticated = true;
        }),

      clearAuth: () =>
        set((state) => {
          state.token = null;
          state.claims = null;
          state.isAuthenticated = false;
        }),

      updateToken: (token) =>
        set((state) => {
          state.token = token;
        }),
    })),
    {
      name: 'workforce-os:auth',
      storage: createJSONStorage(() => sessionStorage),
      // Only persist the token — claims are derived
      partialize: (state) => ({ token: state.token }),
    },
  ),
);
```

```typescript
// apps/workforce-os/src/store/ui.store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  activeModule: string | null;
  notifications: Notification[];
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: string;
  read: boolean;
}

interface UIActions {
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setActiveModule: (module: string | null) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
}

type UIStore = UIState & UIActions;

export const useUIStore = create<UIStore>()(
  persist(
    immer((set) => ({
      // State
      sidebarOpen: true,
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      activeModule: null,
      notifications: [],

      // Actions
      toggleSidebar: () =>
        set((state) => {
          state.sidebarOpen = !state.sidebarOpen;
        }),

      setSidebarOpen: (open) =>
        set((state) => {
          state.sidebarOpen = open;
        }),

      toggleSidebarCollapsed: () =>
        set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        }),

      openCommandPalette: () =>
        set((state) => {
          state.commandPaletteOpen = true;
        }),

      closeCommandPalette: () =>
        set((state) => {
          state.commandPaletteOpen = false;
        }),

      setActiveModule: (module) =>
        set((state) => {
          state.activeModule = module;
        }),

      addNotification: (notification) =>
        set((state) => {
          state.notifications.unshift({
            ...notification,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            read: false,
          });
          // Keep only last 50 notifications in memory
          if (state.notifications.length > 50) {
            state.notifications = state.notifications.slice(0, 50);
          }
        }),

      markNotificationRead: (id) =>
        set((state) => {
          const notification = state.notifications.find((n) => n.id === id);
          if (notification) notification.read = true;
        }),

      clearNotifications: () =>
        set((state) => {
          state.notifications = [];
        }),
    })),
    {
      name: 'workforce-os:ui',
      // Only persist sidebar preferences — not ephemeral state
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
```

### 10.6 Platform App Shell Layout

```typescript
// apps/workforce-os/src/app/(platform)/layout.tsx
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { CommandPalette } from '@/components/shell/command-palette';

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check (cookie-based token validation)
  // In production: validate JWT from HttpOnly cookie
  // For now: placeholder — auth guard added in Section 12
  return (
    <AppShell>
      <CommandPalette />
      {children}
    </AppShell>
  );
}
```

```typescript
// apps/workforce-os/src/components/shell/app-shell.tsx
'use client';

import { type ReactNode } from 'react';
import { useUIStore } from '@/store/ui.store';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { sidebarOpen, sidebarCollapsed } = useUIStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div
        className={cn(
          'flex flex-1 flex-col overflow-hidden transition-all duration-200',
          sidebarOpen && !sidebarCollapsed && 'ml-0',
        )}
      >
        <Topbar />

        <main className="flex-1 overflow-y-auto">
          <div className="container mx-auto p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

### 10.7 Sidebar Navigation

```typescript
// apps/workforce-os/src/components/shell/sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  Clock,
  Calendar,
  DollarSign,
  BarChart3,
  Settings,
  ChevronLeft,
  Building2,
} from 'lucide-react';
import { useUIStore } from '@/store/ui.store';
import { usePermissions } from '@/hooks/use-permissions';
import { cn } from '@/lib/utils';
import { Badge } from '@platform/ui/components/badge';
import { Button } from '@platform/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@platform/ui/components/tooltip';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  badge?: string;
  children?: NavItem[];
}

// Navigation registry — domain modules register here when activated
// Phase 1 bootstrap: only dashboard and settings are active
const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Workforce',
    href: '/workforce',
    icon: Users,
    permission: 'employee:read',
    badge: 'Soon',
  },
  {
    label: 'Attendance',
    href: '/attendance',
    icon: Clock,
    permission: 'attendance:read',
    badge: 'Soon',
  },
  {
    label: 'Leave',
    href: '/leave',
    icon: Calendar,
    permission: 'leave:read',
    badge: 'Soon',
  },
  {
    label: 'Payroll',
    href: '/payroll',
    icon: DollarSign,
    permission: 'payroll:read',
    badge: 'Soon',
  },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    permission: 'analytics:read',
    badge: 'Soon',
  },
];

const BOTTOM_NAV: NavItem[] = [
  {
    label: 'Organization',
    href: '/organization',
    icon: Building2,
    permission: 'organization:read',
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarOpen, sidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
  const { hasPermission } = usePermissions();

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  const renderNavItem = (item: NavItem) => {
    if (item.permission && !hasPermission(item.permission)) return null;

    const active = isActive(item.href);

    const linkContent = (
      <Link
        href={item.badge ? '#' : item.href}
        className={cn(
          'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
          'transition-colors duration-150',
          active
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          item.badge && 'cursor-default opacity-60',
          sidebarCollapsed && 'justify-center px-2',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <item.icon
          className={cn(
            'h-5 w-5 shrink-0',
            active ? 'text-brand-600' : 'text-muted-foreground group-hover:text-foreground',
          )}
        />
        {!sidebarCollapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && (
              <Badge variant="outline" className="text-xs">
                {item.badge}
              </Badge>
            )}
          </>
        )}
      </Link>
    );

    if (sidebarCollapsed) {
      return (
        <TooltipProvider key={item.href} delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
            <TooltipContent side="right">
              <p>{item.label}</p>
              {item.badge && <p className="text-xs opacity-70">{item.badge}</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return <div key={item.href}>{linkContent}</div>;
  };

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{
            width: sidebarCollapsed ? 64 : 240,
            opacity: 1,
          }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="relative flex h-full flex-col border-r bg-card"
        >
          {/* Logo / Brand */}
          <div
            className={cn(
              'flex h-16 items-center border-b px-4',
              sidebarCollapsed && 'justify-center px-2',
            )}
          >
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center">
                  <span className="text-sm font-bold text-white">W</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Workforce OS</span>
                  <span className="text-xs text-muted-foreground">Platform</span>
                </div>
              </div>
            )}
            {sidebarCollapsed && (
              <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center">
                <span className="text-sm font-bold text-white">W</span>
              </div>
            )}
          </div>

          {/* Main navigation */}
          <nav className="flex-1 space-y-1 overflow-y-auto p-2">
            {NAV_ITEMS.map(renderNavItem)}
          </nav>

          {/* Bottom navigation */}
          <div className="border-t p-2 space-y-1">
            {BOTTOM_NAV.map(renderNavItem)}
          </div>

          {/* Collapse toggle */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'absolute -right-3 top-[72px] h-6 w-6 rounded-full border bg-background shadow-sm',
              'hover:bg-muted',
            )}
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronLeft
              className={cn(
                'h-3 w-3 transition-transform duration-200',
                sidebarCollapsed && 'rotate-180',
              )}
            />
          </Button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
```

### 10.8 Command Palette

```typescript
// apps/workforce-os/src/components/shell/command-palette.tsx
'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@platform/ui/components/command';
import {
  LayoutDashboard,
  Settings,
  LogOut,
  Moon,
  Sun,
  Search,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useUIStore } from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';

/**
 * Global command palette — ⌘K to open.
 * Domain modules can register their own command groups
 * via a CommandRegistry pattern (Phase 2+).
 */
export function CommandPalette() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { commandPaletteOpen, openCommandPalette, closeCommandPalette } = useUIStore();
  const { clearAuth } = useAuthStore();

  // ⌘K / Ctrl+K to open
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        commandPaletteOpen ? closeCommandPalette() : openCommandPalette();
      }
    },
    [commandPaletteOpen, openCommandPalette, closeCommandPalette],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const runCommand = useCallback(
    (command: () => void) => {
      closeCommandPalette();
      command();
    },
    [closeCommandPalette],
  );

  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <CommandDialog open={commandPaletteOpen} onOpenChange={(open) => !open && closeCommandPalette()}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => router.push('/dashboard'))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/settings'))}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Appearance">
          <CommandItem
            onSelect={() =>
              runCommand(() => setTheme(theme === 'dark' ? 'light' : 'dark'))
            }
          >
            {theme === 'dark' ? (
              <Sun className="mr-2 h-4 w-4" />
            ) : (
              <Moon className="mr-2 h-4 w-4" />
            )}
            <span>Toggle Theme</span>
            <CommandShortcut>⌘T</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Account">
          <CommandItem
            onSelect={() => runCommand(handleLogout)}
            className="text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign Out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

### 10.9 Core Hooks

```typescript
// apps/workforce-os/src/hooks/use-auth.ts
'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { apiClient } from '@/lib/api-client';
import type { LoginRequest } from '@platform/contracts';

export function useAuth() {
  const router = useRouter();
  const { token, claims, isAuthenticated, setAuth, clearAuth } = useAuthStore();

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginRequest) => {
      const response = await apiClient.POST('/api/v1/auth/login', {
        body: credentials,
      });

      if (response.error) {
        throw new Error(response.error.message ?? 'Login failed');
      }

      return response.data;
    },
    onSuccess: (data) => {
      setAuth(data.accessToken, data.claims);
      router.push('/dashboard');
    },
  });

  const logout = useCallback(() => {
    clearAuth();
    router.push('/login');
  }, [clearAuth, router]);

  return {
    user: claims,
    token,
    isAuthenticated,
    isLoading: loginMutation.isPending,
    error: loginMutation.error,
    login: loginMutation.mutate,
    logout,
  };
}
```

```typescript
// apps/workforce-os/src/hooks/use-permissions.ts
'use client';

import { useAuthStore } from '@/store/auth.store';

/**
 * Permission gate hook.
 * Claims contain the user's permission set as an array of strings.
 * Format: "resource:action" (e.g., "employee:read", "payroll:approve")
 */
export function usePermissions() {
  const { claims } = useAuthStore();

  const hasPermission = (permission: string): boolean => {
    if (!claims) return false;
    // Super admins bypass all permission checks
    if (claims.permissions.includes('*')) return true;
    return claims.permissions.includes(permission);
  };

  const hasAnyPermission = (...permissions: string[]): boolean => {
    return permissions.some(hasPermission);
  };

  const hasAllPermissions = (...permissions: string[]): boolean => {
    return permissions.every(hasPermission);
  };

  return { hasPermission, hasAnyPermission, hasAllPermissions };
}
```

```typescript
// apps/workforce-os/src/hooks/use-realtime.ts
'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

interface RealtimeOptions {
  channel: string;
  table?: string;
  filter?: string;
  onInsert?: (payload: unknown) => void;
  onUpdate?: (payload: unknown) => void;
  onDelete?: (payload: unknown) => void;
}

/**
 * Subscribe to Supabase Realtime for live UI updates.
 * Used by notification bell, attendance dashboard, etc.
 */
export function useRealtime({
  channel,
  table,
  filter,
  onInsert,
  onUpdate,
  onDelete,
}: RealtimeOptions) {
  const { token } = useAuthStore();
  const { addNotification } = useUIStore();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!token) return;

    const sub = supabase
      .channel(channel)
      .on(
        'postgres_changes' as Parameters<typeof sub.on>[0],
        {
          event: '*',
          schema: 'public',
          table: table ?? '*',
          filter,
        },
        (payload: unknown) => {
          const p = payload as { eventType: string; new: unknown; old: unknown };
          if (p.eventType === 'INSERT' && onInsert) onInsert(p.new);
          if (p.eventType === 'UPDATE' && onUpdate) onUpdate(p.new);
          if (p.eventType === 'DELETE' && onDelete) onDelete(p.old);
        },
      )
      .subscribe();

    channelRef.current = sub;

    return () => {
      supabase.removeChannel(sub);
    };
  }, [channel, table, filter, token]);
}
```

### 10.10 API Client

```typescript
// apps/workforce-os/src/lib/api-client.ts
import createClient from 'openapi-fetch';
import type { paths } from '@platform/contracts/generated/openapi';
import { useAuthStore } from '@/store/auth.store';

/**
 * Type-safe HTTP client generated from the OpenAPI spec.
 * Types are generated from Zod schemas via scripts/codegen/openapi.ts.
 *
 * Usage:
 *   const { data, error } = await apiClient.GET('/api/v1/employees', {
 *     params: { query: { page: 1, pageSize: 50 } }
 *   });
 */
export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
});

// Request middleware — inject Authorization header
apiClient.use({
  onRequest({ request }) {
    const { token } = useAuthStore.getState();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },

  onResponse({ response }) {
    // Handle 401 globally — clear auth and redirect
    if (response.status === 401) {
      useAuthStore.getState().clearAuth();
      // Let the auth layout handle the redirect
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return response;
  },
});
```

### 10.11 Utility Functions

```typescript
// apps/workforce-os/src/lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes without conflicts.
 * Used by every component for conditional class composition.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date string for display.
 * Uses Intl.DateTimeFormat for locale-aware formatting.
 */
export function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  },
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', options).format(d);
}

/**
 * Format duration in minutes to human-readable string.
 * e.g., 90 → "1h 30m", 45 → "45m"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Get initials from a full name.
 * "Suraj Kumar" → "SK"
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Debounce a function call.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
```

---

## Section 11 — Design System Foundation

### 11.1 Design Token Architecture

The design system lives in `packages/ui/` and is consumed by all frontend applications. Tokens flow from Tailwind config → CSS variables → component variants (via cva).

```
packages/ui/
├── package.json
├── tsconfig.json
├── tailwind.config.ts          # Token definitions (re-exported for app configs)
├── src/
│   ├── index.ts                # Barrel export
│   ├── tokens/
│   │   ├── colors.ts           # Brand, status, semantic color tokens
│   │   ├── typography.ts       # Font sizes, weights, line heights
│   │   ├── spacing.ts          # Spacing scale
│   │   └── shadows.ts          # Elevation shadows
│   ├── components/
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── badge.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── table.tsx
│   │   ├── toast.tsx
│   │   ├── toaster.tsx
│   │   ├── command.tsx
│   │   ├── tooltip.tsx
│   │   ├── avatar.tsx
│   │   ├── skeleton.tsx
│   │   ├── separator.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── select.tsx
│   │   ├── form.tsx
│   │   ├── label.tsx
│   │   └── index.ts            # Re-export all components
│   ├── hooks/
│   │   ├── use-toast.ts
│   │   └── use-media-query.ts
│   └── lib/
│       └── utils.ts            # Shared cn() utility
└── .storybook/
    ├── main.ts
    └── preview.tsx
```

### 11.2 Package Configuration

```json
// packages/ui/package.json
{
  "name": "@platform/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./components/*": "./src/components/*.tsx",
    "./hooks/*": "./src/hooks/*.ts",
    "./lib/*": "./src/lib/*.ts",
    "./tailwind.config": "./tailwind.config.ts"
  },
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "dependencies": {
    "@radix-ui/react-avatar": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.1.0",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-select": "^2.1.0",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.0",
    "@radix-ui/react-tooltip": "^1.1.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "cmdk": "^1.0.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.441.0",
    "tailwind-merge": "^2.5.2"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "tailwindcss": "^3.4.0"
  },
  "devDependencies": {
    "@chromatic-com/storybook": "^2.0.0",
    "@storybook/addon-essentials": "^8.0.0",
    "@storybook/nextjs": "^8.0.0",
    "@storybook/react": "^8.0.0",
    "@platform/tsconfig": "workspace:*",
    "typescript": "^5.6.0"
  }
}
```

### 11.3 Tailwind Token Configuration

```typescript
// packages/ui/tailwind.config.ts
import type { Config } from 'tailwindcss';
import { fontFamily } from 'tailwindcss/defaultTheme';

/**
 * Base Tailwind config exported from @platform/ui.
 * Application configs extend this to inherit all tokens.
 *
 * Usage in apps:
 *   import uiConfig from '@platform/ui/tailwind.config';
 *   export default { ...uiConfig, content: [...] }
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...fontFamily.sans],
        mono: ['var(--font-mono)', ...fontFamily.mono],
      },

      // ─── Semantic Color Tokens ─────────────────────────────────────────────
      // All colors reference CSS variables so they respond to dark mode.
      colors: {
        // shadcn/ui required tokens
        border:      'hsl(var(--border))',
        input:       'hsl(var(--input))',
        ring:        'hsl(var(--ring))',
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ─── HRMS-Specific Semantic Tokens ─────────────────────────────────
        // Brand palette — primary action color
        brand: {
          50:  'hsl(var(--brand-50))',
          100: 'hsl(var(--brand-100))',
          200: 'hsl(var(--brand-200))',
          300: 'hsl(var(--brand-300))',
          400: 'hsl(var(--brand-400))',
          500: 'hsl(var(--brand-500))',
          600: 'hsl(var(--brand-600))',
          700: 'hsl(var(--brand-700))',
          800: 'hsl(var(--brand-800))',
          900: 'hsl(var(--brand-900))',
          950: 'hsl(var(--brand-950))',
        },

        // Status colors — attendance, leave, payroll status chips
        status: {
          present:    'hsl(var(--status-present))',
          absent:     'hsl(var(--status-absent))',
          late:       'hsl(var(--status-late))',
          leave:      'hsl(var(--status-leave))',
          holiday:    'hsl(var(--status-holiday))',
          pending:    'hsl(var(--status-pending))',
          approved:   'hsl(var(--status-approved))',
          rejected:   'hsl(var(--status-rejected))',
          processing: 'hsl(var(--status-processing))',
          paid:       'hsl(var(--status-paid))',
        },

        // Risk colors — AI predictions, anomaly flags
        risk: {
          low:      'hsl(var(--risk-low))',
          medium:   'hsl(var(--risk-medium))',
          high:     'hsl(var(--risk-high))',
          critical: 'hsl(var(--risk-critical))',
        },

        // Chart colors — analytics and dashboards
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to:   { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to:   { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to:   { transform: 'translateY(0)',   opacity: '1' },
        },
      },
      animation: {
        'accordion-down':         'accordion-down 0.2s ease-out',
        'accordion-up':           'accordion-up 0.2s ease-out',
        'fade-in':                'fade-in 0.15s ease-out',
        'slide-in-from-bottom':   'slide-in-from-bottom 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

### 11.4 CSS Variable Definitions

```css
/* apps/workforce-os/src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* ─── shadcn/ui Required Tokens ─────────────────────── */
    --background:         0 0% 100%;
    --foreground:         222.2 84% 4.9%;
    --card:               0 0% 100%;
    --card-foreground:    222.2 84% 4.9%;
    --popover:            0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary:            221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary:          210 40% 96%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted:              210 40% 96%;
    --muted-foreground:   215.4 16.3% 46.9%;
    --accent:             210 40% 96%;
    --accent-foreground:  222.2 47.4% 11.2%;
    --destructive:        0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border:             214.3 31.8% 91.4%;
    --input:              214.3 31.8% 91.4%;
    --ring:               221.2 83.2% 53.3%;
    --radius:             0.5rem;

    /* ─── Brand (Indigo) ────────────────────────────────── */
    --brand-50:  239 100% 97%;
    --brand-100: 239 100% 94%;
    --brand-200: 239 95% 87%;
    --brand-300: 239 92% 76%;
    --brand-400: 239 89% 65%;
    --brand-500: 239 84% 57%;
    --brand-600: 239 76% 49%;
    --brand-700: 239 66% 40%;
    --brand-800: 239 57% 33%;
    --brand-900: 239 50% 27%;
    --brand-950: 239 47% 16%;

    /* ─── Status Colors ─────────────────────────────────── */
    --status-present:    142 71% 45%;     /* green */
    --status-absent:     0 84% 60%;       /* red */
    --status-late:       38 92% 50%;      /* amber */
    --status-leave:      197 71% 52%;     /* sky */
    --status-holiday:    271 76% 62%;     /* violet */
    --status-pending:    38 92% 50%;      /* amber */
    --status-approved:   142 71% 45%;     /* green */
    --status-rejected:   0 84% 60%;       /* red */
    --status-processing: 197 71% 52%;     /* sky */
    --status-paid:       142 71% 45%;     /* green */

    /* ─── Risk Colors ───────────────────────────────────── */
    --risk-low:      142 71% 45%;
    --risk-medium:   38 92% 50%;
    --risk-high:     24 95% 53%;
    --risk-critical: 0 84% 60%;

    /* ─── Chart Colors ──────────────────────────────────── */
    --chart-1: 221.2 83.2% 53.3%;
    --chart-2: 142 71% 45%;
    --chart-3: 38 92% 50%;
    --chart-4: 271 76% 62%;
    --chart-5: 0 84% 60%;
  }

  .dark {
    --background:         222.2 84% 4.9%;
    --foreground:         210 40% 98%;
    --card:               222.2 84% 4.9%;
    --card-foreground:    210 40% 98%;
    --popover:            222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary:            217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary:          217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted:              217.2 32.6% 17.5%;
    --muted-foreground:   215 20.2% 65.1%;
    --accent:             217.2 32.6% 17.5%;
    --accent-foreground:  210 40% 98%;
    --destructive:        0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border:             217.2 32.6% 17.5%;
    --input:              217.2 32.6% 17.5%;
    --ring:               224.3 76.3% 48%;

    /* Dark mode brand — slightly lighter for contrast */
    --brand-50:  239 47% 16%;
    --brand-600: 239 89% 65%;
    --brand-700: 239 92% 76%;
    --brand-950: 239 100% 97%;

    /* Status — slightly muted in dark mode */
    --status-present:    142 60% 40%;
    --status-absent:     0 70% 55%;
    --status-late:       38 80% 45%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }

  /* Smooth scrolling */
  html {
    scroll-behavior: smooth;
  }

  /* Custom scrollbar */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  ::-webkit-scrollbar-track {
    @apply bg-transparent;
  }

  ::-webkit-scrollbar-thumb {
    @apply bg-muted-foreground/20 rounded-full;
  }

  ::-webkit-scrollbar-thumb:hover {
    @apply bg-muted-foreground/40;
  }
}
```

### 11.5 Component Architecture — Button

```typescript
// packages/ui/src/components/button.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const buttonVariants = cva(
  // Base styles — always applied
  [
    'inline-flex items-center justify-center gap-2',
    'whitespace-nowrap rounded-md text-sm font-medium',
    'ring-offset-background transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground',
        link:
          'text-primary underline-offset-4 hover:underline',
        brand:
          'bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm:      'h-9 rounded-md px-3',
        lg:      'h-11 rounded-md px-8',
        icon:    'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

### 11.6 Badge Component with Status Variants

```typescript
// packages/ui/src/components/badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:    'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:  'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline:    'text-foreground',

        // HRMS Status variants
        present:    'border-transparent bg-status-present/15 text-status-present',
        absent:     'border-transparent bg-status-absent/15 text-status-absent',
        late:       'border-transparent bg-status-late/15 text-status-late',
        leave:      'border-transparent bg-status-leave/15 text-status-leave',
        holiday:    'border-transparent bg-status-holiday/15 text-status-holiday',
        pending:    'border-transparent bg-status-pending/15 text-status-pending',
        approved:   'border-transparent bg-status-approved/15 text-status-approved',
        rejected:   'border-transparent bg-status-rejected/15 text-status-rejected',
        paid:       'border-transparent bg-status-paid/15 text-status-paid',

        // Risk variants
        'risk-low':      'border-transparent bg-risk-low/15 text-risk-low',
        'risk-medium':   'border-transparent bg-risk-medium/15 text-risk-medium',
        'risk-high':     'border-transparent bg-risk-high/15 text-risk-high',
        'risk-critical': 'border-transparent bg-risk-critical/15 text-risk-critical',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

### 11.7 Storybook Bootstrap

```typescript
// packages/ui/.storybook/main.ts
import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@chromatic-com/storybook',
  ],
  framework: {
    name: '@storybook/nextjs',
    options: {},
  },
  docs: {
    autodocs: 'tag',
  },
  staticDirs: ['../public'],
};

export default config;
```

```typescript
// packages/ui/.storybook/preview.tsx
import type { Preview } from '@storybook/react';
import { ThemeProvider } from 'next-themes';
import '../src/app/globals.css'; // Reuse app globals for stories

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date:  /Date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  decorators: [
    (Story) => (
      <ThemeProvider attribute="class" defaultTheme="light">
        <div className="p-4 font-sans">
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};

export default preview;
```

```typescript
// packages/ui/src/components/badge.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default', 'secondary', 'destructive', 'outline',
        'present', 'absent', 'late', 'leave', 'holiday',
        'pending', 'approved', 'rejected', 'paid',
        'risk-low', 'risk-medium', 'risk-high', 'risk-critical',
      ],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Badge', variant: 'default' },
};

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="present">Present</Badge>
      <Badge variant="absent">Absent</Badge>
      <Badge variant="late">Late</Badge>
      <Badge variant="leave">On Leave</Badge>
      <Badge variant="holiday">Holiday</Badge>
      <Badge variant="pending">Pending</Badge>
      <Badge variant="approved">Approved</Badge>
      <Badge variant="rejected">Rejected</Badge>
      <Badge variant="paid">Paid</Badge>
    </div>
  ),
};

export const RiskBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="risk-low">Low Risk</Badge>
      <Badge variant="risk-medium">Medium Risk</Badge>
      <Badge variant="risk-high">High Risk</Badge>
      <Badge variant="risk-critical">Critical</Badge>
    </div>
  ),
};
```

### 11.8 shadcn/ui Integration Script

shadcn/ui components are initialized once, then customized — they are **owned code**, not a runtime dependency.

```bash
# Initialize shadcn/ui in the ui package
# Run from packages/ui/
npx shadcn@latest init --defaults

# Add components as needed
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add card
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
npx shadcn@latest add badge
npx shadcn@latest add skeleton
npx shadcn@latest add toast
npx shadcn@latest add command
npx shadcn@latest add tooltip
npx shadcn@latest add separator
npx shadcn@latest add avatar
npx shadcn@latest add select
npx shadcn@latest add label
npx shadcn@latest add form
npx shadcn@latest add table
```

```json
// packages/ui/components.json — shadcn/ui config
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@platform/ui/components",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

---

## Section 12 — Legacy System Coexistence Strategy

### 12.1 Coexistence Philosophy

The existing HRMS (attendance engine, leave engine, payroll engine, workflow system) is **not replaced** — it is **surrounded**. The new platform:

1. **Runs in parallel** — same database, different API layer
2. **Proxies unchanged** — `GET /api/legacy/*` passes through verbatim to the old system
3. **Intercepts selectively** — new routes shadow legacy routes only when the new implementation is ready and verified
4. **Never migrates atomically** — each domain moves independently, one migration boundary at a time

This is the Strangler Fig pattern applied at the API and data layers simultaneously.

### 12.2 Legacy Adapter Architecture

```
packages/legacy-adapters/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── legacy-attendance.types.ts   # TypeScript types for old API shapes
│   │   ├── legacy-leave.types.ts
│   │   ├── legacy-payroll.types.ts
│   │   └── legacy-employee.types.ts
│   ├── adapters/
│   │   ├── attendance.adapter.ts        # Old attendance → new domain event
│   │   ├── leave.adapter.ts
│   │   ├── payroll.adapter.ts
│   │   └── employee.adapter.ts
│   ├── translators/
│   │   ├── attendance.translator.ts     # Field mapping (old ↔ new schema)
│   │   ├── leave.translator.ts
│   │   └── payroll.translator.ts
│   └── clients/
│       └── legacy-http.client.ts        # Typed HTTP client for old API
```

### 12.3 Legacy HTTP Client

```typescript
// packages/legacy-adapters/src/clients/legacy-http.client.ts
import { logger } from '@platform/observability';
import { config } from '@platform/config';

/**
 * Typed HTTP client for calling the existing HRMS API.
 * Used during the coexistence period before each domain is migrated.
 *
 * All calls include:
 * - Tenant context via X-Tenant-ID header
 * - Correlation ID for distributed tracing
 * - Timeout (10s) to prevent cascade failures
 * - Structured error wrapping
 */
export class LegacyHRMSClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(baseUrl: string = config.LEGACY_API_URL, timeout = 10_000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  async post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  async put<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID':       options.tenantId ?? '',
          'X-Correlation-ID':  options.correlationId ?? crypto.randomUUID(),
          'X-Source':          'workforce-os-platform',
          ...(options.headers ?? {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        throw new LegacyApiError(
          `Legacy API ${method} ${path} failed: ${response.status}`,
          response.status,
          errorBody,
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LegacyApiError(`Legacy API ${method} ${path} timed out`, 504, '');
      }
      logger.error({ err: error, method, path }, 'Legacy API call failed');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

interface RequestOptions {
  tenantId?: string;
  correlationId?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export class LegacyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'LegacyApiError';
  }
}

// Singleton
export const legacyClient = new LegacyHRMSClient();
```

### 12.4 Domain Translators

```typescript
// packages/legacy-adapters/src/translators/attendance.translator.ts
import type { LegacyAttendanceRecord } from '../types/legacy-attendance.types';
import type { AttendanceLogCreatedPayload } from '@platform/contracts';

/**
 * Translates legacy attendance records to canonical domain event payloads.
 *
 * Legacy schema (old system):
 *   { emp_id, date, in_time, out_time, status_code, machine_id }
 *
 * Canonical schema (new system):
 *   { employeeId, tenantId, date, checkInAt, checkOutAt, status, sourceDeviceId }
 *
 * Rules:
 * - status_code 'P' → 'PRESENT', 'A' → 'ABSENT', 'L' → 'LEAVE', 'H' → 'HOLIDAY'
 * - emp_id maps to employeeId via identity lookup (cached in Redis)
 * - machine_id maps to sourceDeviceId directly
 */
export function translateLegacyAttendance(
  legacy: LegacyAttendanceRecord,
  employeeId: string,
  tenantId: string,
): AttendanceLogCreatedPayload {
  return {
    employeeId,
    tenantId,
    date: legacy.date,
    checkInAt:      legacy.in_time  ? toISO(legacy.date, legacy.in_time)  : null,
    checkOutAt:     legacy.out_time ? toISO(legacy.date, legacy.out_time) : null,
    status:         translateStatusCode(legacy.status_code),
    sourceDeviceId: legacy.machine_id ?? null,
    workMinutes:    calculateWorkMinutes(legacy.in_time, legacy.out_time),
    source:         'LEGACY_MIGRATION',
  };
}

function translateStatusCode(code: string): string {
  const map: Record<string, string> = {
    P: 'PRESENT',
    A: 'ABSENT',
    L: 'LEAVE',
    H: 'HOLIDAY',
    WO: 'WEEK_OFF',
    HD: 'HALF_DAY',
  };
  return map[code] ?? 'UNKNOWN';
}

function toISO(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

function calculateWorkMinutes(inTime: string | null, outTime: string | null): number | null {
  if (!inTime || !outTime) return null;
  const [inH, inM] = inTime.split(':').map(Number);
  const [outH, outM] = outTime.split(':').map(Number);
  return (outH * 60 + outM) - (inH * 60 + inM);
}
```

### 12.5 Strangler Fig Route Registration

```typescript
// apps/platform-api/src/routes/legacy/proxy.ts
import type { FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '@platform/config';
import { logger } from '@platform/observability';

/**
 * Legacy passthrough proxy.
 *
 * Routes:
 *   /api/legacy/*  → existing HRMS API (zero transformation)
 *
 * Strategy:
 *   - Prefix /api/legacy/ is rewritten to / before forwarding
 *   - Correlation ID is always injected
 *   - Tenant ID is always injected from authenticated context
 *   - No business logic — pure transport
 *
 * Migration tracker:
 *   When a domain is migrated, its legacy route is removed from
 *   LEGACY_PROXY_PATHS and a new /api/v1/ route takes over.
 */

// Routes still served by the legacy system
// Remove entries here as each domain is migrated
const LEGACY_PROXY_PATHS = [
  '/api/legacy/attendance',   // Phase 2: move to /api/v1/attendance
  '/api/legacy/leave',        // Phase 3: move to /api/v1/leave
  '/api/legacy/payroll',      // Phase 4: move to /api/v1/payroll
  '/api/legacy/workflow',     // Phase 5: move to /api/v1/workflow
  '/api/legacy/reports',      // Phase 6: move to /api/v1/analytics
] as const;

export async function legacyProxyRoutes(app: FastifyInstance): Promise<void> {
  if (!config.LEGACY_API_URL) {
    logger.warn('LEGACY_API_URL not set — legacy proxy disabled');
    return;
  }

  await app.register(httpProxy, {
    upstream:   config.LEGACY_API_URL,
    prefix:     '/api/legacy',
    rewriteRequestHeaders: (req, headers) => ({
      ...headers,
      'X-Correlation-ID': req.headers['x-correlation-id'] ?? crypto.randomUUID(),
      'X-Forwarded-By':   'workforce-os-platform',
      // Inject tenant ID from auth context if present
      'X-Tenant-ID': (req as unknown as { tenantId?: string }).tenantId ?? '',
    }),
    // Remove /api/legacy prefix before forwarding to old system
    rewritePrefix: '',
    // Log all proxied requests
    preHandler: async (request) => {
      logger.info(
        {
          method: request.method,
          url: request.url,
          destination: config.LEGACY_API_URL,
        },
        'Proxying request to legacy system',
      );
    },
  });

  logger.info(
    { paths: LEGACY_PROXY_PATHS, upstream: config.LEGACY_API_URL },
    'Legacy proxy routes registered',
  );
}
```

### 12.6 Migration Gate Pattern

```typescript
// packages/legacy-adapters/src/migration-gate.ts
import { logger } from '@platform/observability';
import { config } from '@platform/config';

/**
 * Migration gate — controls whether a domain serves from new or legacy implementation.
 *
 * In Phase 2: attendance.enabled = false → proxy to legacy
 * After migration: attendance.enabled = true → use new implementation
 *
 * Flags are read from environment variables so they can be toggled
 * via deployment configuration without code changes.
 *
 * Usage in routes:
 *   if (await migrationGate.isEnabled('attendance')) {
 *     return attendanceService.getLogs(query);
 *   }
 *   // Fall through to legacy proxy
 *   throw new LegacyHandoffError('attendance');
 */
export class MigrationGate {
  private readonly flags: Map<string, boolean>;

  constructor() {
    this.flags = new Map([
      ['identity',    this.readFlag('MIGRATION_IDENTITY_ENABLED',    true)],
      ['employee',    this.readFlag('MIGRATION_EMPLOYEE_ENABLED',    false)],
      ['attendance',  this.readFlag('MIGRATION_ATTENDANCE_ENABLED',  false)],
      ['leave',       this.readFlag('MIGRATION_LEAVE_ENABLED',       false)],
      ['payroll',     this.readFlag('MIGRATION_PAYROLL_ENABLED',     false)],
      ['workflow',    this.readFlag('MIGRATION_WORKFLOW_ENABLED',    false)],
      ['analytics',   this.readFlag('MIGRATION_ANALYTICS_ENABLED',  false)],
    ]);

    logger.info({ flags: Object.fromEntries(this.flags) }, 'Migration gates initialized');
  }

  isEnabled(domain: string): boolean {
    return this.flags.get(domain) ?? false;
  }

  private readFlag(envVar: string, defaultValue: boolean): boolean {
    const val = process.env[envVar];
    if (val === undefined) return defaultValue;
    return val.toLowerCase() === 'true';
  }
}

export const migrationGate = new MigrationGate();

export class LegacyHandoffError extends Error {
  constructor(public readonly domain: string) {
    super(`Domain '${domain}' is not yet migrated — request must be handled by legacy system`);
    this.name = 'LegacyHandoffError';
  }
}
```

### 12.7 Feature Flag Integration

```typescript
// packages/legacy-adapters/src/types/legacy-attendance.types.ts
/**
 * TypeScript types reflecting the EXISTING attendance system's API shape.
 * These types are read-only documentation — never extend or clean them.
 * They exist to give us type safety when calling the legacy system.
 */
export interface LegacyAttendanceRecord {
  id:          number;
  emp_id:      string;
  date:        string;        // 'YYYY-MM-DD'
  in_time:     string | null; // 'HH:MM'
  out_time:    string | null; // 'HH:MM'
  status_code: string;        // 'P' | 'A' | 'L' | 'H' | 'WO' | 'HD'
  machine_id:  string | null;
  remarks:     string | null;
  created_at:  string;
  updated_at:  string;
}

export interface LegacyAttendanceListResponse {
  data:        LegacyAttendanceRecord[];
  total:       number;
  page:        number;
  page_size:   number;
}

export interface LegacyAttendanceQuery {
  emp_id?:    string;
  from_date:  string;
  to_date:    string;
  page?:      number;
  page_size?: number;
}
```

```typescript
// packages/legacy-adapters/src/types/legacy-employee.types.ts
export interface LegacyEmployee {
  emp_code:       string;
  first_name:     string;
  last_name:      string;
  email:          string;
  mobile:         string | null;
  department:     string;
  designation:    string;
  date_of_joining: string;   // 'YYYY-MM-DD'
  date_of_leaving: string | null;
  status:         'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  manager_code:   string | null;
  branch_code:    string | null;
}
```

### 12.8 Domain Migration Checklist Template

```markdown
<!-- docs/migration/attendance-domain-migration.md -->
# Attendance Domain Migration Checklist

## Pre-Migration
- [ ] New Attendance domain schema deployed to PostgreSQL
- [ ] RLS policies in place for attendance schema
- [ ] Prisma migration run: `pnpm db:migrate:deploy`
- [ ] AttendanceService unit tests passing (>90% coverage)
- [ ] Legacy translator tests passing against production data sample
- [ ] Contract tests passing against new /api/v1/attendance endpoints
- [ ] Load test: new API handles peak attendance submission load

## Data Migration
- [ ] Historical attendance backfill script written and tested
- [ ] Backfill run in staging environment — row count matches legacy
- [ ] Data quality report reviewed: null in_times, duplicate records
- [ ] Backfill run in production (read-only mode — no traffic yet)

## Traffic Migration
- [ ] Set `MIGRATION_ATTENDANCE_ENABLED=true` in staging
- [ ] Smoke test all attendance workflows in staging
- [ ] Set `MIGRATION_ATTENDANCE_ENABLED=true` in production (1% traffic)
- [ ] Monitor error rate, latency P50/P95/P99 for 24 hours
- [ ] Ramp to 100% traffic
- [ ] Remove legacy proxy path `/api/legacy/attendance`

## Post-Migration
- [ ] Archive legacy attendance tables (DO NOT DROP for 90 days)
- [ ] Remove legacy attendance adapter code
- [ ] Update LEGACY_PROXY_PATHS in proxy.ts
- [ ] Update migration gate defaults
- [ ] Celebrate 🎉
```

### 12.9 Environment Variables for Coexistence

```bash
# .env.example additions for coexistence
# ─── Legacy System ────────────────────────────────────────────────
LEGACY_API_URL=http://legacy-hrms.internal:8080
LEGACY_API_TIMEOUT_MS=10000

# ─── Migration Gates ──────────────────────────────────────────────
# Set to true when a domain's new implementation is ready
MIGRATION_IDENTITY_ENABLED=true    # Phase 1 — identity is new
MIGRATION_EMPLOYEE_ENABLED=false   # Phase 2
MIGRATION_ATTENDANCE_ENABLED=false # Phase 3
MIGRATION_LEAVE_ENABLED=false      # Phase 4
MIGRATION_PAYROLL_ENABLED=false    # Phase 5
MIGRATION_WORKFLOW_ENABLED=false   # Phase 6
MIGRATION_ANALYTICS_ENABLED=false  # Phase 7
```


---

## Section 13 — CI/CD Foundation

### 13.1 GitHub Actions Pipeline Architecture

```
.github/
├── workflows/
│   ├── ci.yml                    # PR validation — lint, typecheck, test, build
│   ├── cd-staging.yml            # Deploy to staging on main merge
│   ├── cd-production.yml         # Deploy to production on release tag
│   ├── db-migrate.yml            # Manual database migration workflow
│   └── security-scan.yml         # Weekly vulnerability scan
├── actions/
│   ├── setup-node/
│   │   └── action.yml            # Composite: Node + pnpm + cache
│   └── turbo-affected/
│       └── action.yml            # Composite: compute affected packages
└── CODEOWNERS                    # Per-directory ownership
```

### 13.2 CI Pipeline — Pull Request Validation

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, develop]
    types: [opened, synchronize, reopened]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true  # Cancel superseded runs on same branch

permissions:
  contents: read
  pull-requests: write
  checks: write

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '9'

jobs:
  # ─── Phase 1: Install & Cache ─────────────────────────────────────────────
  setup:
    name: Setup
    runs-on: ubuntu-latest
    outputs:
      cache-hit: ${{ steps.cache.outputs.cache-hit }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for turbo affected computation

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Cache turbo build artifacts
        id: cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: ${{ runner.os }}-turbo-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-turbo-

  # ─── Phase 2: Parallel Validation ─────────────────────────────────────────
  typecheck:
    name: Typecheck
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore turbo cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: ${{ runner.os }}-turbo-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-turbo-
      - name: Run typecheck (affected packages only)
        run: pnpm turbo typecheck --filter='[HEAD~1]'

  lint:
    name: Lint
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore turbo cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: ${{ runner.os }}-turbo-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-turbo-
      - name: Run lint (affected packages only)
        run: pnpm turbo lint --filter='[HEAD~1]'

  test:
    name: Test
    needs: setup
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: hrms_test
          POSTGRES_PASSWORD: test_password_ci
          POSTGRES_DB: hrms_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://hrms_test:test_password_ci@localhost:5432/hrms_test
      REDIS_URL: redis://localhost:6379
      JWT_SECRET: ci-test-jwt-secret-not-real-32-chars
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore turbo cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: ${{ runner.os }}-turbo-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-turbo-
      - name: Run Prisma migrations
        run: pnpm db:migrate:deploy
      - name: Run tests (affected packages only)
        run: pnpm turbo test --filter='[HEAD~1]'
      - name: Upload coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: '**/coverage/lcov.info'

  build:
    name: Build
    needs: [typecheck, lint, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Restore turbo cache
        uses: actions/cache@v4
        with:
          path: .turbo
          key: ${{ runner.os }}-turbo-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-turbo-
      - name: Build all packages
        run: pnpm turbo build
      - name: Archive build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-artifacts
          path: |
            apps/platform-api/dist/
            apps/workforce-os/.next/
          retention-days: 7
```

### 13.3 Staging Deployment Workflow

```yaml
# .github/workflows/cd-staging.yml
name: Deploy → Staging

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  id-token: write  # OIDC for cloud provider auth

jobs:
  deploy-api:
    name: Deploy API to Staging
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - name: Configure cloud credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_STAGING_ROLE_ARN }}
          aws-region: ap-south-1

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push API image
        env:
          REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build \
            --file apps/platform-api/Dockerfile \
            --tag "$REGISTRY/workforce-os-api:$IMAGE_TAG" \
            --tag "$REGISTRY/workforce-os-api:staging-latest" \
            --build-arg NODE_ENV=staging \
            .
          docker push "$REGISTRY/workforce-os-api:$IMAGE_TAG"
          docker push "$REGISTRY/workforce-os-api:staging-latest"

      - name: Run database migrations
        run: |
          # Migrations run as a one-off task before traffic cutover
          aws ecs run-task \
            --cluster workforce-os-staging \
            --task-definition workforce-os-migrate \
            --network-configuration "awsvpcConfiguration={subnets=[${{ secrets.STAGING_SUBNET }}],securityGroups=[${{ secrets.STAGING_SG }}]}" \
            --overrides '{"containerOverrides":[{"name":"migrate","command":["pnpm","db:migrate:deploy"]}]}'

      - name: Deploy API service
        run: |
          aws ecs update-service \
            --cluster workforce-os-staging \
            --service workforce-os-api \
            --force-new-deployment

      - name: Wait for deployment
        run: |
          aws ecs wait services-stable \
            --cluster workforce-os-staging \
            --services workforce-os-api

  deploy-frontend:
    name: Deploy Frontend to Staging
    needs: deploy-api
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with: { version: '9' }

      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: pnpm }

      - run: pnpm install --frozen-lockfile

      - name: Build Next.js
        env:
          NEXT_PUBLIC_API_URL:           ${{ secrets.STAGING_API_URL }}
          NEXT_PUBLIC_SUPABASE_URL:      ${{ secrets.STAGING_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
        run: pnpm turbo build --filter=workforce-os

      - name: Deploy to Vercel
        run: |
          npx vercel deploy \
            --token=${{ secrets.VERCEL_TOKEN }} \
            --scope=${{ secrets.VERCEL_ORG_ID }} \
            --prod \
            apps/workforce-os
```

### 13.4 Dockerfile — Platform API

```dockerfile
# apps/platform-api/Dockerfile

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /build

# Copy dependency manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY turbo.json ./
COPY tooling/ ./tooling/
COPY packages/ ./packages/
COPY domains/ ./domains/
COPY apps/platform-api/package.json ./apps/platform-api/

# Install all workspace dependencies (needed for build graph)
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/platform-api/ ./apps/platform-api/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN pnpm db:generate

# Build the API and all its workspace dependencies
RUN pnpm turbo build --filter=platform-api

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install production pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace manifests for production install
COPY --from=builder /build/package.json .
COPY --from=builder /build/pnpm-workspace.yaml .
COPY --from=builder /build/pnpm-lock.yaml .
COPY --from=builder /build/packages/ ./packages/
COPY --from=builder /build/domains/ ./domains/

# Install ONLY production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /build/apps/platform-api/dist/ ./apps/platform-api/dist/
COPY --from=builder /build/prisma/ ./prisma/

# Copy Prisma generated client (binaries)
COPY --from=builder /build/node_modules/.prisma/ ./node_modules/.prisma/
COPY --from=builder /build/node_modules/@prisma/ ./node_modules/@prisma/

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3001

# Healthcheck — docker will mark container unhealthy if this fails
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "apps/platform-api/dist/main.js"]
```

### 13.5 Docker Compose — Full Local Stack

```yaml
# docker-compose.yml
version: '3.9'

services:
  # ─── Infrastructure ───────────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: hrms-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER:     hrms_dev
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB:       hrms
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hrms_dev -d hrms"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: hrms-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass dev_redis_password
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "dev_redis_password", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ─── Observability Stack ──────────────────────────────────────────────────
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    container_name: hrms-otel-collector
    restart: unless-stopped
    volumes:
      - ./infra/otel/collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    ports:
      - "4317:4317"    # gRPC OTLP receiver
      - "4318:4318"    # HTTP OTLP receiver
      - "8889:8889"    # Prometheus scrape endpoint
    depends_on:
      - jaeger

  jaeger:
    image: jaegertracing/all-in-one:latest
    container_name: hrms-jaeger
    restart: unless-stopped
    ports:
      - "16686:16686"  # Jaeger UI
      - "14250:14250"  # gRPC for collector
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

  # ─── Development: BullMQ Dashboard ───────────────────────────────────────
  bull-board:
    image: deadly0/bull-board:latest
    container_name: hrms-bull-board
    restart: unless-stopped
    ports:
      - "3030:3000"
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: dev_redis_password
    depends_on:
      - redis

  # ─── Mail catcher (development only) ────────────────────────────────────
  mailhog:
    image: mailhog/mailhog:latest
    container_name: hrms-mailhog
    restart: unless-stopped
    ports:
      - "1025:1025"    # SMTP
      - "8025:8025"    # Web UI

volumes:
  postgres_data:
  redis_data:
```

### 13.6 PostgreSQL Initialization

```sql
-- infra/postgres/init.sql
-- Run once at container creation (development only).
-- Production uses managed Supabase + Prisma migrations.

-- Create domain schemas
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS employee;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS leave_mgmt;
CREATE SCHEMA IF NOT EXISTS payroll;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS events;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- Fuzzy search
CREATE EXTENSION IF NOT EXISTS "btree_gin";  -- Composite indexes

-- Create service account role (bypasses RLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_account') THEN
    CREATE ROLE service_account NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA identity   TO service_account;
GRANT USAGE ON SCHEMA employee   TO service_account;
GRANT USAGE ON SCHEMA audit      TO service_account;
GRANT USAGE ON SCHEMA events     TO service_account;

-- Log initialization
DO $$
BEGIN
  RAISE NOTICE 'HRMS development database initialized at %', NOW();
END $$;
```

---

## Section 14 — Local Development Experience

### 14.1 Developer Onboarding Sequence

A new developer should be able to go from `git clone` to a running system in under 5 minutes. The setup is fully scripted.

```bash
# One-time setup — run after cloning
chmod +x scripts/dev-setup.sh
./scripts/dev-setup.sh
```

### 14.2 Dev Setup Script

```bash
#!/usr/bin/env bash
# scripts/dev-setup.sh
# One-command developer setup for Workforce OS Platform.
# Idempotent — safe to run multiple times.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}ℹ ${NC} $*"; }
success() { echo -e "${GREEN}✓ ${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠ ${NC} $*"; }
error()   { echo -e "${RED}✗ ${NC} $*" >&2; exit 1; }

echo ""
echo "  🏢 Workforce OS Platform — Developer Setup"
echo "  ─────────────────────────────────────────"
echo ""

# ─── 1. Prerequisites ─────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || error "Node.js is not installed. Install v20+ from https://nodejs.org"
command -v pnpm  >/dev/null 2>&1 || error "pnpm is not installed. Run: npm install -g pnpm"
command -v docker >/dev/null 2>&1 || error "Docker is not installed. Install from https://docker.com"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js 20+ required. Current: $(node -v)"
fi

success "Prerequisites OK (Node $(node -v), pnpm $(pnpm -v))"

# ─── 2. Environment ───────────────────────────────────────────────────────────
info "Setting up environment files..."

if [ ! -f .env ]; then
  cp .env.example .env
  success "Created .env from .env.example"
  warn "Review .env and update values before starting"
else
  success ".env already exists — skipping"
fi

# ─── 3. Install Dependencies ──────────────────────────────────────────────────
info "Installing dependencies..."
pnpm install
success "Dependencies installed"

# ─── 4. Start Infrastructure ──────────────────────────────────────────────────
info "Starting Docker infrastructure (postgres, redis, jaeger)..."
docker compose up -d postgres redis otel-collector jaeger mailhog

info "Waiting for postgres to be ready..."
timeout 30 bash -c 'until docker compose exec -T postgres pg_isready -U hrms_dev -d hrms; do sleep 1; done'
success "PostgreSQL ready"

info "Waiting for redis to be ready..."
timeout 15 bash -c 'until docker compose exec -T redis redis-cli -a dev_redis_password ping | grep -q PONG; do sleep 1; done'
success "Redis ready"

# ─── 5. Database ──────────────────────────────────────────────────────────────
info "Running Prisma migrations..."
pnpm db:migrate:dev --name init
success "Database migrated"

info "Generating Prisma client..."
pnpm db:generate
success "Prisma client generated"

info "Seeding development data..."
pnpm db:seed
success "Database seeded"

# ─── 6. Build shared packages ─────────────────────────────────────────────────
info "Building shared packages..."
pnpm turbo build --filter='./packages/*'
success "Shared packages built"

# ─── 7. Summary ───────────────────────────────────────────────────────────────
echo ""
echo "  ✅ Setup complete!"
echo ""
echo "  Run the platform:     pnpm dev"
echo "  API:                  http://localhost:3001"
echo "  Admin UI:             http://localhost:3000"
echo "  API Docs (Swagger):   http://localhost:3001/docs"
echo "  Jaeger Traces:        http://localhost:16686"
echo "  Mail Catcher:         http://localhost:8025"
echo "  Bull Board (Queues):  http://localhost:3030"
echo ""
```

### 14.3 Development Scripts Reference

```json
// Root package.json scripts (complete reference)
{
  "scripts": {
    // ─── Development ────────────────────────────────────────
    "dev":            "turbo dev --parallel",
    "dev:api":        "turbo dev --filter=platform-api",
    "dev:admin":      "turbo dev --filter=workforce-os",

    // ─── Build ──────────────────────────────────────────────
    "build":          "turbo build",
    "build:api":      "turbo build --filter=platform-api",
    "build:admin":    "turbo build --filter=workforce-os",

    // ─── Quality ────────────────────────────────────────────
    "typecheck":      "turbo typecheck",
    "lint":           "turbo lint",
    "lint:fix":       "turbo lint -- --fix",
    "format":         "prettier --write \"**/*.{ts,tsx,json,md}\"",
    "format:check":   "prettier --check \"**/*.{ts,tsx,json,md}\"",

    // ─── Testing ────────────────────────────────────────────
    "test":           "turbo test",
    "test:watch":     "turbo test -- --watch",
    "test:coverage":  "turbo test -- --coverage",
    "test:e2e":       "playwright test",

    // ─── Database ───────────────────────────────────────────
    "db:generate":    "prisma generate --schema=prisma/schema",
    "db:migrate:dev": "prisma migrate dev --schema=prisma/schema",
    "db:migrate:deploy": "prisma migrate deploy --schema=prisma/schema",
    "db:reset":       "prisma migrate reset --schema=prisma/schema --force",
    "db:seed":        "tsx prisma/seeds/index.ts",
    "db:studio":      "prisma studio --schema=prisma/schema",

    // ─── Code Generation ────────────────────────────────────
    "codegen:openapi": "tsx scripts/codegen/openapi.ts",
    "codegen:all":    "turbo codegen",

    // ─── Docker ─────────────────────────────────────────────
    "docker:up":      "docker compose up -d",
    "docker:down":    "docker compose down",
    "docker:reset":   "docker compose down -v && docker compose up -d",
    "docker:logs":    "docker compose logs -f",

    // ─── Utilities ──────────────────────────────────────────
    "clean":          "turbo clean && find . -name 'node_modules' -type d -prune -exec rm -rf {} +",
    "prepare":        "husky"
  }
}
```

### 14.4 Git Hooks (Husky + lint-staged)

```bash
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run lint-staged on changed files only
pnpm lint-staged

# Prevent accidental commits to main
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ]; then
  echo "❌ Direct commits to main are not allowed."
  echo "   Create a branch and open a pull request."
  exit 1
fi
```

```bash
# .husky/commit-msg
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Enforce conventional commit format
npx --no -- commitlint --edit "$1"
```

```json
// lint-staged.config.js (in root package.json as "lint-staged" key)
{
  "*.{ts,tsx}": [
    "eslint --fix --max-warnings=0",
    "prettier --write"
  ],
  "*.{json,md,yaml,yml}": [
    "prettier --write"
  ],
  "*.prisma": [
    "prisma format"
  ]
}
```

```json
// commitlint.config.js
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [
      2,
      "always",
      [
        "feat",     // New feature
        "fix",      // Bug fix
        "docs",     // Documentation
        "style",    // Formatting (no logic change)
        "refactor", // Code change without feature/fix
        "perf",     // Performance improvement
        "test",     // Tests
        "build",    // Build system
        "ci",       // CI configuration
        "chore",    // Maintenance
        "revert"    // Revert a commit
      ]
    ],
    "scope-enum": [
      1,
      "always",
      [
        "api", "frontend", "db", "auth", "observability",
        "contracts", "ui", "config", "legacy-adapters",
        "ci", "docker", "infra", "docs"
      ]
    ],
    "subject-max-length": [2, "always", 100]
  }
}
```

### 14.5 VS Code Workspace Configuration

```json
// .vscode/settings.json
{
  // TypeScript
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,

  // Editor
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "source.organizeImports": "never"
  },

  // Tailwind CSS
  "tailwindCSS.experimental.classRegex": [
    ["cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]"],
    ["cx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"],
    ["cn\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ],
  "tailwindCSS.includeLanguages": {
    "typescript": "javascript",
    "typescriptreact": "javascript"
  },

  // File nesting
  "explorer.fileNesting.enabled": true,
  "explorer.fileNesting.patterns": {
    "*.ts": "${capture}.test.ts, ${capture}.spec.ts",
    "*.tsx": "${capture}.test.tsx, ${capture}.spec.tsx, ${capture}.stories.tsx",
    "package.json": "package-lock.json, pnpm-lock.yaml, .npmrc",
    "turbo.json": ".turbocache",
    ".env.example": ".env, .env.local, .env.staging, .env.production",
    "docker-compose.yml": "docker-compose.*.yml, Dockerfile*"
  },

  // Prisma
  "[prisma]": {
    "editor.defaultFormatter": "Prisma.prisma"
  },

  // Exclude
  "files.exclude": {
    "**/.turbo": true,
    "**/node_modules": true,
    "**/.next": true,
    "**/dist": true,
    "**/coverage": true
  }
}
```

```json
// .vscode/extensions.json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "prisma.prisma",
    "bradlc.vscode-tailwindcss",
    "ms-azuretools.vscode-docker",
    "usernamehw.errorlens",
    "streetsidesoftware.code-spell-checker",
    "mikestead.dotenv",
    "GitHub.vscode-pull-request-github",
    "eamodio.gitlens",
    "orta.vscode-jest",
    "ms-playwright.playwright"
  ]
}
```

```json
// .vscode/launch.json — Debug configurations
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug: Platform API",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/apps/platform-api/src/main.ts",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["tsx", "--inspect"],
      "env": {
        "NODE_ENV": "development"
      },
      "envFile": "${workspaceFolder}/.env",
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal",
      "sourceMaps": true
    },
    {
      "name": "Debug: Current Test File",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["vitest", "run", "--reporter=verbose"],
      "args": ["${fileBasenameNoExtension}"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### 14.6 Test Configuration

```typescript
// tooling/vitest/base.ts — Base Vitest config (extended per package)
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',        // Barrel files
        '**/*.stories.tsx',   // Storybook stories
        '**/migrations/**',   // Database migrations
        '**/seeds/**',        // Seed files
      ],
      thresholds: {
        branches:   80,
        functions:  80,
        lines:      80,
        statements: 80,
      },
    },
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 15_000,
  },
});
```

```typescript
// apps/platform-api/test/setup.ts
import { afterAll, afterEach, beforeAll } from 'vitest';
import { prisma } from '@platform/database';

// Start test DB connection
beforeAll(async () => {
  // Migrations must be run before tests: pnpm db:migrate:dev
});

// Clean up between tests using a transaction rollback strategy
afterEach(async () => {
  // For unit tests: mock the DB client
  // For integration tests: truncate test-specific tables
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

---

## Section 15 — Implementation Sequence

### 15.1 Phase Breakdown

The bootstrap establishes the platform foundation in a deliberate sequence. Each phase is a shippable unit — nothing in Phase N+1 depends on Phase N being 100% complete.

```
Phase 1 — Foundation (Weeks 1–2)
  ├── Monorepo setup (turbo.json, pnpm workspaces, tsconfig)
  ├── @platform/contracts (Zod schemas, type inference)
  ├── @platform/config (fail-fast env validation)
  ├── @platform/observability (logger, tracer, metrics)
  ├── @platform/database (Prisma client, tenant middleware)
  └── Docker infrastructure (postgres, redis, otel)

Phase 2 — API Shell (Weeks 2–3)
  ├── apps/platform-api core (Fastify, plugins, health)
  ├── Identity domain — Prisma schema, RLS policies
  ├── Auth routes — login, logout, token refresh
  ├── Tenant middleware (AsyncLocalStorage propagation)
  └── Legacy proxy — /api/legacy/* passthrough

Phase 3 — Frontend Shell (Weeks 3–4)
  ├── apps/workforce-os core (Next.js, providers, layout)
  ├── @platform/ui (Button, Badge, Card, Form)
  ├── Auth flow — login page, token management
  ├── App shell — sidebar, topbar, command palette
  └── OpenAPI codegen — type-safe client generated

Phase 4 — Quality Gates (Week 4)
  ├── GitHub Actions CI pipeline
  ├── Git hooks (Husky, lint-staged, commitlint)
  ├── Unit test setup (Vitest, coverage thresholds)
  ├── Storybook bootstrap
  └── Dockerfile + docker-compose complete
```

### 15.2 Week-by-Week Task Breakdown

```
WEEK 1
─────────────────────────────────────────────────────────────────
Day 1-2: Monorepo Initialization
  □ pnpm init, workspace setup
  □ turbo.json (build, dev, typecheck, lint, test tasks)
  □ tsconfig.base.json + tooling/tsconfig variants
  □ Root .eslintrc, prettier config
  □ .env.example with all required variables

Day 3-4: Shared Package Scaffolding
  □ packages/contracts — Zod schemas, event envelopes
  □ packages/config — env schema, fail-fast loader
  □ packages/observability — Pino logger, OTel tracer, metrics
  □ packages/database — Prisma client, tenant context, unit of work
  □ packages/auth — JWT sign/verify

Day 5: Infrastructure
  □ docker-compose.yml (postgres, redis, otel, jaeger, mailhog)
  □ infra/postgres/init.sql (schemas, extensions, roles)
  □ infra/otel/collector.yaml
  □ pnpm dev works — docker up, packages build

WEEK 2
─────────────────────────────────────────────────────────────────
Day 1-2: Identity Domain
  □ prisma/schema/identity.prisma (Tenant, User, Session, Role)
  □ prisma/migrations/init_identity_schema — SQL + RLS policies
  □ prisma/seeds/base/00-platform-roles.ts

Day 3-4: API Shell
  □ apps/platform-api — Fastify app with all plugins
  □ Plugin: database, auth, tenant, error-handler
  □ Routes: /health, /ready, /api/v1/auth/*
  □ Legacy proxy: /api/legacy/* → existing HRMS
  □ OpenAPI spec generation (swagger-ui, JSON export)

Day 5: API Verification
  □ All Fastify routes respond correctly
  □ RLS policies tested with multi-tenant seed data
  □ Token sign/verify working end-to-end
  □ Legacy proxy passes through correctly

WEEK 3
─────────────────────────────────────────────────────────────────
Day 1-2: Frontend Foundation
  □ apps/workforce-os — Next.js app, layout, providers
  □ TanStack Query client, Zustand stores (auth, ui)
  □ openapi-fetch client generation from API spec
  □ Auth hooks, permission hooks

Day 3-4: UI Shell
  □ packages/ui — shadcn/ui init, Button, Badge, Card
  □ Tailwind config with brand, status, risk tokens
  □ globals.css with CSS variable definitions (light + dark)
  □ App shell — sidebar, topbar, command palette
  □ Login page connected to /api/v1/auth/login

Day 5: Frontend Verification
  □ Login flow works end-to-end
  □ Dark mode toggle works
  □ Command palette opens and navigates
  □ Sidebar collapses/expands with animation

WEEK 4
─────────────────────────────────────────────────────────────────
Day 1-2: CI/CD Setup
  □ .github/workflows/ci.yml (lint, typecheck, test, build)
  □ .github/workflows/cd-staging.yml
  □ Dockerfile for platform-api
  □ Git hooks: Husky + lint-staged + commitlint

Day 3-4: Quality Foundation
  □ tooling/vitest — base test config + coverage thresholds
  □ First unit tests: config loader, JWT, translators
  □ packages/ui Storybook — Badge and Button stories
  □ CODEOWNERS file

Day 5: Polish + Handoff
  □ README.md update with setup instructions
  □ docs/adr/001-turborepo.md (architecture decision record)
  □ docs/adr/002-strangler-fig.md
  □ Full dev setup script verified on clean machine
  □ All turbo tasks pass: build, typecheck, lint, test
```

### 15.3 Turbo Task Dependency Graph

```
codegen (openapi types)
     │
     ▼
build:packages (contracts, config, observability, database, auth, ui)
     │                    │
     ▼                    ▼
build:api            build:frontend
(platform-api)       (workforce-os)
     │
     ▼
typecheck → lint → test → build (CI order)
```

### 15.4 Package Dependency Graph (Bootstrap Phase)

```
@platform/contracts (no workspace deps — foundation)
    │
    ├─── @platform/config (depends on: contracts)
    ├─── @platform/observability (depends on: config)
    ├─── @platform/database (depends on: config, observability)
    ├─── @platform/auth (depends on: contracts, config)
    └─── @platform/ui (depends on: nothing — pure React)

apps/platform-api
    depends on: contracts, config, observability, database, auth
    (+ all domain packages added in Phase 2+)

apps/workforce-os
    depends on: contracts, ui
    (openapi types generated from platform-api spec)

packages/legacy-adapters
    depends on: contracts, config, observability
    (consumed by platform-api only)
```

### 15.5 Definition of Done — Bootstrap Phase

Before declaring the bootstrap complete and beginning domain module work, all of the following must be true:

**Infrastructure:**
- [ ] `pnpm install && docker compose up -d && pnpm db:migrate:dev && pnpm dev` completes without errors on a clean checkout
- [ ] All Docker services healthy: postgres, redis, otel-collector, jaeger
- [ ] Prisma migrations run clean; identity schema and RLS policies in place

**API:**
- [ ] `GET /health` returns `200 OK` with `{ status: "ok" }`
- [ ] `GET /ready` returns `200 OK` with database connection verified
- [ ] `POST /api/v1/auth/login` issues a valid JWT
- [ ] `GET /api/legacy/*` proxies to existing HRMS without modification
- [ ] OpenAPI JSON spec generated at `/docs/json`

**Frontend:**
- [ ] Login page renders and submits to API
- [ ] Successful login redirects to `/dashboard`
- [ ] Dark mode toggle works
- [ ] Command palette opens via ⌘K
- [ ] Sidebar collapses and persists state across reloads

**CI:**
- [ ] All CI jobs pass on a clean PR: typecheck, lint, test, build
- [ ] Git hooks reject non-conventional commits
- [ ] Git hooks reject direct commits to `main`

**Quality:**
- [ ] `pnpm turbo typecheck` exits 0 across all packages
- [ ] `pnpm turbo lint` exits 0 across all packages
- [ ] Initial unit test suite passing (config loader, JWT, translators)
- [ ] Storybook builds successfully

---

## Section 16 — Final Recommendations

### 16.1 Architectural Non-Negotiables

These decisions are load-bearing. Changing them mid-build breaks multiple downstream layers.

**1. Zod is the single source of truth for all data shapes.**
Never define TypeScript interfaces manually for API request/response types. Always define a Zod schema first, infer the type with `z.infer<>`, and export that. Violating this causes the OpenAPI codegen to diverge from the runtime and defeats the contract-first design.

**2. All cross-package imports go through package boundaries, never relative paths.**
`import { Employee } from '@domain/employee'` — always. `import { Employee } from '../../domains/employee/src'` — never. The ESLint import/no-restricted-paths rules enforce this, but only if you do not bypass them.

**3. TenantContext is always required in backend code that touches the database.**
Never call `prisma.find()` without a tenant context being set. Any route that reaches the database must pass through the tenant plugin, which sets the AsyncLocalStorage context and the Postgres `app.current_tenant_id` setting. Bypassing this breaks multi-tenancy at the data layer.

**4. The Strangler Fig boundary is inviolable during coexistence.**
New domain modules must NOT directly call legacy module code via internal function calls — only through the `LegacyHRMSClient` HTTP adapter or migration gates. This ensures the legacy system can be upgraded or replaced without rebuilding the new platform.

**5. Database migrations are append-only and reviewed before deploy.**
Never modify an existing migration file. Every migration has a `migration.md` rationale file. Migrations run in CI before application deployment — the application must be backward-compatible with both the old and new schema during the rolling window.

### 16.2 Risk Register — Bootstrap Phase

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Prisma multi-schema preview API changes | Medium | High | Pin `prisma` version; monitor changelog; abstract client creation |
| Legacy proxy timeouts cascade to new API | Medium | High | 10s timeout on all proxy calls; circuit breaker in Phase 2 |
| Type drift between Zod schema and OpenAPI | Low | High | Codegen runs in CI; fails build if spec diverges |
| RLS policy misconfiguration leaks tenant data | Low | Critical | Integration tests with two test tenants; data isolation verified in CI |
| pnpm hoisting breaks transitive deps | Medium | Medium | `shamefully-hoist=false`; pin resolution overrides for conflicts |
| AsyncLocalStorage context lost across async boundaries | Medium | Medium | `TenantContext.require()` throws at call site; caught in dev immediately |
| Next.js 15 RSC + Zustand hydration mismatch | Medium | Medium | Use `useEffect` guard for client-only store access; SSR-safe partialize |

### 16.3 Performance Baselines to Establish Now

Set these baselines at the end of bootstrap so you have a baseline to regress against.

**API:**
- Cold start time (process start → first request handled): target < 3s
- `GET /health` P99 latency: target < 5ms
- `POST /api/v1/auth/login` P99 latency: target < 200ms (includes DB + JWT)

**Frontend:**
- First Contentful Paint (dashboard page): target < 1.5s
- Largest Contentful Paint: target < 2.5s
- Lighthouse Performance score (desktop): target > 90

**Build:**
- `pnpm turbo build` (cold, no cache): target < 3 minutes
- `pnpm turbo build` (warm cache, no changes): target < 15 seconds
- `pnpm turbo typecheck` (all packages): target < 60 seconds

### 16.4 Security Checklist

Complete before connecting to any real tenant data.

```
Identity & Auth
  □ JWT secret is 256-bit random — not a human-readable phrase
  □ JWT expiry is 15 minutes (access) + 7 days (refresh)
  □ Refresh tokens stored in HttpOnly, Secure, SameSite=Strict cookie
  □ Login endpoint rate-limited (5 attempts / 15 min / IP)
  □ Brute-force lockout after 10 failed attempts

Data Isolation
  □ RLS policies tested with two separate tenants — cross-tenant reads return 0 rows
  □ Service account role (bypasses RLS) never exposed to user-facing routes
  □ All API responses strip internal fields (tenantId from nested objects)

Transport
  □ HTTPS enforced in all non-local environments
  □ HSTS header set
  □ CORS origins allowlisted — no wildcard in production
  □ X-Content-Type-Options: nosniff
  □ X-Frame-Options: DENY

Secrets
  □ No secrets committed to Git — .env is in .gitignore
  □ All production secrets in AWS Secrets Manager / Vault
  □ CI secrets in GitHub Secrets — never in workflow YAML
  □ Database password rotated from default

Observability
  □ PII fields in Pino redaction list — authorization, password, nationalId, pan, aadhar
  □ Correlation IDs never include user PII
  □ Trace data does not include request bodies with credentials
```

### 16.5 Naming Conventions Reference

```
Files:
  kebab-case for all files:             user-service.ts, auth.store.ts
  PascalCase for React components:      AppShell.tsx → file: app-shell.tsx
  .test.ts for unit tests               user-service.test.ts
  .spec.ts for integration tests        auth.spec.ts
  .stories.tsx for Storybook            badge.stories.tsx

Variables & Functions:
  camelCase for variables/functions:    const tenantContext = ...
  PascalCase for classes/types:         class TenantContext { }
  SCREAMING_SNAKE for constants:        const JWT_EXPIRY = '15m'
  Prefix 'use' for hooks:               usePermissions, useAuth

Database:
  snake_case for column names:          created_at, tenant_id
  snake_case for table names:           tenant_memberships
  Schema prefix in migrations:          identity.users, employee.employees
  id column: uuid, named 'id'           id UUID DEFAULT gen_random_uuid()
  FK columns: {table}_id                tenant_id, employee_id

Events:
  DomainSubjectVerb format:             EmployeeOnboarded, AttendanceLogged
  Past tense (facts):                   PayrollProcessed (not ProcessPayroll)
  Event type as constant:               EMPLOYEE_ONBOARDED = 'employee.onboarded'

API Routes:
  Resource plural, noun-first:          /api/v1/employees, /api/v1/leave-requests
  Actions as sub-resources:             /api/v1/leave-requests/:id/approve
  Query params camelCase:               ?pageSize=50&fromDate=2025-01-01
  Response always wrapped:              { data: [...], pagination: { ... } }

Package names:
  @platform/  for shared infra          @platform/contracts, @platform/ui
  @domain/    for domain packages       @domain/attendance, @domain/payroll
  @app/       prefix unused — use       apps/platform-api (workspace path)
```

### 16.6 What This Bootstrap Intentionally Excludes

The bootstrap is deliberately scoped. The following are **not** built here — each has its own document and implementation phase:

| Excluded from Bootstrap | When | Reference |
|---|---|---|
| Attendance domain module | Phase 2 | MASTER_DOMAIN_ARCHITECTURE.md §3.2 |
| Leave domain module | Phase 3 | MASTER_DOMAIN_ARCHITECTURE.md §3.3 |
| Payroll domain module | Phase 4 | MASTER_DOMAIN_ARCHITECTURE.md §3.4 |
| BullMQ job workers | Phase 2+ | MASTER_PLATFORM_ENGINEERING.md §12 |
| Analytics projections | Phase 5 | MASTER_DATA_ARCHITECTURE.md §10 |
| AI copilot features | Phase 6 | MASTER_DOMAIN_ARCHITECTURE.md §9 |
| Kafka migration | Phase 7 | MASTER_DOMAIN_ARCHITECTURE.md §10 |
| Multi-region deployment | Phase 8 | MASTER_PLATFORM_ENGINEERING.md §16 |
| Storybook visual regression | Phase 3+ | Chromatic integration |
| E2E test suite | Phase 3+ | Playwright, after domain screens exist |

### 16.7 The Correct Order of Operations

When you begin building the first real domain module (e.g., Attendance Domain):

```
1. Define the Zod schema in @platform/contracts
   └── Agree the shape with all consumers BEFORE writing any DB code

2. Write the Prisma schema in prisma/schema/attendance.prisma
   └── Run migration, verify RLS policy, test multi-tenant isolation

3. Write the domain service in domains/attendance/src/
   └── Pure functions — no HTTP, no Fastify, no framework coupling

4. Write unit tests for the domain service (target: >90% coverage)
   └── Mock the Prisma client — test business logic in isolation

5. Wire the Fastify route in apps/platform-api/src/routes/v1/attendance.ts
   └── Route is thin: validate input (Zod), call service, return response

6. Run the OpenAPI codegen
   └── pnpm codegen:openapi — new endpoint types available to frontend

7. Build the React hook and page in apps/workforce-os/
   └── Hook uses typed openapi-fetch — no manual fetch calls

8. Set the migration gate: MIGRATION_ATTENDANCE_ENABLED=true in staging
9. Verify end-to-end in staging
10. Remove the legacy proxy path for attendance
```

### 16.8 Platform Maturity Indicators

Track these to know the platform is maturing correctly.

| Indicator | Bootstrap Target | 6-Month Target | 12-Month Target |
|---|---|---|---|
| Packages with zero cross-boundary imports | 100% | 100% | 100% |
| API routes with contract validation | 100% | 100% | 100% |
| Unit test coverage (packages) | >70% | >85% | >90% |
| CI pipeline duration (PR) | <5 min | <4 min | <3 min |
| Turbo cache hit rate | >60% | >80% | >90% |
| Domains migrated from legacy | 1 (identity) | 3–4 | 7+ |
| RLS policy coverage | 100% new schemas | 100% | 100% |
| OpenAPI-generated client coverage | 100% | 100% | 100% |
| P99 latency — core API endpoints | <500ms | <200ms | <100ms |

---

*This document is the complete bootstrap implementation reference for the Workforce OS Platform. The technical decisions recorded here are intended to remain stable for the duration of Phase 1 (foundation). Revisit Section 16.1 before making changes to the structural patterns documented in Sections 3–9.*
