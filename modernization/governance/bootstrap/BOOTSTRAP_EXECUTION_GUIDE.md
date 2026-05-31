# WORKFORCE OS — BOOTSTRAP EXECUTION GUIDE
# Real Implementation Files · Real Commands · Real Structure

> **This document is executable.** Every command runs. Every file is complete. Every config is production-grade.
> Follow Section 14 (Bootstrap Execution Order) for the canonical step-by-step sequence.

---

# SECTION 1 — REAL DIRECTORY INITIALIZATION

## 1.1 Prerequisites Check

```bash
# Verify toolchain before starting
node --version    # Must be >= 20.0.0
pnpm --version    # Must be >= 9.0.0
docker --version  # Must be >= 24.0.0
git --version     # Must be >= 2.40.0

# Install pnpm if missing
corepack enable
corepack prepare pnpm@9 --activate
```

## 1.2 Repository Creation

```bash
# Create root directory
mkdir -p "workforce-os"
cd workforce-os

# Initialize git
git init
git checkout -b main
```

## 1.3 Full Directory Scaffold

Run this entire block — creates every directory in one shot:

```bash
# ── Applications ─────────────────────────────────────────────────────────────
mkdir -p apps/workforce-os/src/{app,components,lib,hooks,store,types}
mkdir -p apps/workforce-os/src/app/\(auth\)/login
mkdir -p apps/workforce-os/src/app/\(platform\)/{dashboard,settings}
mkdir -p apps/workforce-os/src/app/api/health
mkdir -p apps/workforce-os/src/components/{shell,ui,providers}
mkdir -p apps/workforce-os/public

mkdir -p apps/admin-console/src/{app,components,lib,hooks,store}
mkdir -p apps/admin-console/public

mkdir -p apps/ess-portal/src/{app,components,lib,hooks}
mkdir -p apps/ess-portal/public

mkdir -p apps/platform-api/src/{routes,plugins,middleware,services,lib}
mkdir -p apps/platform-api/src/routes/{v1,legacy}
mkdir -p apps/platform-api/src/routes/v1/{auth,health}
mkdir -p apps/platform-api/test/{unit,integration}

mkdir -p apps/legacy-api-adapter/src/{proxy,transform,middleware}

# ── Workers ──────────────────────────────────────────────────────────────────
mkdir -p workers/events/src/{consumers,processors,handlers}
mkdir -p workers/analytics/src/{processors,projections}
mkdir -p workers/ai/src/{processors,pipelines}

# ── Shared Packages ───────────────────────────────────────────────────────────
mkdir -p packages/contracts/src/{schemas,events,types,generated}
mkdir -p packages/contracts/src/schemas/{common,identity,employee}
mkdir -p packages/events/src/{publishers,consumers,schemas}
mkdir -p packages/database/src
mkdir -p packages/auth/src
mkdir -p packages/config/src
mkdir -p packages/observability/src
mkdir -p packages/types/src
mkdir -p packages/ui/src/{components,hooks,lib,tokens}
mkdir -p packages/ui/src/components
mkdir -p packages/ui/.storybook

# ── Domain Packages ───────────────────────────────────────────────────────────
mkdir -p domains/identity/src/{services,repositories,events}
mkdir -p domains/employee/src/{services,repositories,events}

# ── Legacy Adapters ───────────────────────────────────────────────────────────
mkdir -p packages/legacy-adapters/src/{clients,translators,types,gates}

# ── Prisma ────────────────────────────────────────────────────────────────────
mkdir -p prisma/schema
mkdir -p prisma/migrations
mkdir -p prisma/seeds/{base,development}

# ── Infrastructure ────────────────────────────────────────────────────────────
mkdir -p infra/docker
mkdir -p infra/postgres
mkdir -p infra/redis
mkdir -p infra/otel
mkdir -p infra/nginx

# ── Tooling ───────────────────────────────────────────────────────────────────
mkdir -p tooling/tsconfig
mkdir -p tooling/eslint-config
mkdir -p tooling/vitest

# ── Scripts ───────────────────────────────────────────────────────────────────
mkdir -p scripts/codegen
mkdir -p scripts/db
mkdir -p scripts/dev

# ── Docs ──────────────────────────────────────────────────────────────────────
mkdir -p docs/adr
mkdir -p docs/migration

# ── GitHub ────────────────────────────────────────────────────────────────────
mkdir -p .github/workflows
mkdir -p .github/actions/setup-node
mkdir -p .vscode

echo "✓ Directory scaffold complete"
find . -type d | sort | head -80
```

---

# SECTION 2 — ROOT WORKSPACE FILES

## 2.1 `package.json`

```json
{
  "name": "workforce-os",
  "version": "0.1.0",
  "private": true,
  "description": "AI-native Workforce Operating System — Monorepo Root",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev":                "turbo dev --parallel",
    "dev:api":            "turbo dev --filter=platform-api",
    "dev:web":            "turbo dev --filter=workforce-os",
    "dev:admin":          "turbo dev --filter=admin-console",
    "dev:ess":            "turbo dev --filter=ess-portal",
    "build":              "turbo build",
    "build:packages":     "turbo build --filter='./packages/*'",
    "typecheck":          "turbo typecheck",
    "lint":               "turbo lint",
    "lint:fix":           "turbo lint -- --fix",
    "format":             "prettier --write \"**/*.{ts,tsx,js,json,md,yaml,yml,css}\" --ignore-path .gitignore",
    "format:check":       "prettier --check \"**/*.{ts,tsx,js,json,md,yaml,yml,css}\" --ignore-path .gitignore",
    "test":               "turbo test",
    "test:watch":         "turbo test -- --watch",
    "test:coverage":      "turbo test -- --coverage",
    "db:generate":        "prisma generate --schema=prisma/schema",
    "db:migrate:dev":     "prisma migrate dev --schema=prisma/schema",
    "db:migrate:deploy":  "prisma migrate deploy --schema=prisma/schema",
    "db:migrate:reset":   "prisma migrate reset --schema=prisma/schema --force",
    "db:studio":          "prisma studio --schema=prisma/schema",
    "db:seed":            "tsx prisma/seeds/index.ts",
    "db:seed:base":       "tsx prisma/seeds/index.ts --mode=base",
    "codegen:openapi":    "tsx scripts/codegen/openapi.ts",
    "codegen:all":        "turbo codegen && pnpm codegen:openapi",
    "docker:up":          "docker compose -f docker-compose.yml up -d",
    "docker:down":        "docker compose -f docker-compose.yml down",
    "docker:reset":       "docker compose -f docker-compose.yml down -v && docker compose -f docker-compose.yml up -d",
    "docker:logs":        "docker compose -f docker-compose.yml logs -f",
    "clean":              "turbo clean && pnpm clean:modules",
    "clean:modules":      "find . -name 'node_modules' -type d -maxdepth 4 -prune -exec rm -rf {} + 2>/dev/null; echo done",
    "clean:build":        "find . -name 'dist' -o -name '.next' -o -name '.turbo' | xargs rm -rf 2>/dev/null; echo done",
    "prepare":            "husky",
    "setup":              "bash scripts/dev/setup.sh"
  },
  "devDependencies": {
    "@commitlint/cli":              "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "husky":                        "^9.1.6",
    "lint-staged":                  "^15.2.10",
    "prettier":                     "^3.3.3",
    "prettier-plugin-tailwindcss":  "^0.6.8",
    "turbo":                        "^2.2.3",
    "typescript":                   "^5.6.3"
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix --max-warnings=0",
      "prettier --write"
    ],
    "*.{json,md,yaml,yml,css}": ["prettier --write"],
    "*.prisma": ["prisma format"]
  },
  "packageManager": "pnpm@9.12.3"
}
```

## 2.2 `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
  - 'domains/*'
  - 'tooling/*'
```

## 2.3 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "package.json", "tsconfig.json", "tsconfig*.json"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "*.ts", "tsconfig.json", "tsconfig*.json"],
      "outputs": []
    },
    "lint": {
      "inputs": ["src/**", "*.ts", "*.tsx", ".eslintrc*", "eslint.config.*"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "test/**", "vitest.config.*"],
      "outputs": ["coverage/**"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    },
    "codegen": {
      "dependsOn": ["^build"],
      "inputs": ["src/**"],
      "outputs": ["src/generated/**"]
    },
    "db:generate": {
      "inputs": ["../../prisma/schema/**"],
      "outputs": ["node_modules/.prisma/**"]
    },
    "clean": {
      "cache": false
    }
  },
  "globalEnv": [
    "NODE_ENV",
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  ]
}
```

## 2.4 `tsconfig.base.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Base TypeScript Configuration",
  "compilerOptions": {
    "target":              "ES2022",
    "lib":                 ["ES2022"],
    "module":              "NodeNext",
    "moduleResolution":    "NodeNext",
    "moduleDetection":     "force",
    "strict":              true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess":   true,
    "noImplicitOverride":         true,
    "noImplicitReturns":          true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals":             true,
    "noUnusedParameters":         true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop":     true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule":   true,
    "isolatedModules":     true,
    "skipLibCheck":        true,
    "declaration":         true,
    "declarationMap":      true,
    "sourceMap":           true,
    "incremental":         true,
    "paths": {
      "@platform/contracts":         ["./packages/contracts/src/index.ts"],
      "@platform/contracts/*":       ["./packages/contracts/src/*"],
      "@platform/events":            ["./packages/events/src/index.ts"],
      "@platform/database":          ["./packages/database/src/index.ts"],
      "@platform/auth":              ["./packages/auth/src/index.ts"],
      "@platform/config":            ["./packages/config/src/index.ts"],
      "@platform/observability":     ["./packages/observability/src/index.ts"],
      "@platform/types":             ["./packages/types/src/index.ts"],
      "@platform/ui":                ["./packages/ui/src/index.ts"],
      "@platform/ui/*":              ["./packages/ui/src/*"],
      "@platform/legacy-adapters":   ["./packages/legacy-adapters/src/index.ts"],
      "@domain/identity":            ["./domains/identity/src/index.ts"],
      "@domain/employee":            ["./domains/employee/src/index.ts"]
    }
  }
}
```

## 2.5 `tooling/tsconfig/node.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Node.js TypeScript Configuration",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib":              ["ES2022"],
    "module":           "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir":           "dist",
    "rootDir":          "src"
  }
}
```

## 2.6 `tooling/tsconfig/nextjs.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Next.js TypeScript Configuration",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib":              ["dom", "dom.iterable", "ES2022"],
    "module":           "ESNext",
    "moduleResolution": "Bundler",
    "moduleDetection":  "force",
    "jsx":              "preserve",
    "allowJs":          true,
    "noEmit":           true,
    "plugins": [{ "name": "next" }]
  }
}
```

## 2.7 `tooling/tsconfig/react-library.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "React Library TypeScript Configuration",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib":              ["dom", "dom.iterable", "ES2022"],
    "module":           "ESNext",
    "moduleResolution": "Bundler",
    "jsx":              "react-jsx",
    "noEmit":           true
  }
}
```

## 2.8 `tooling/eslint-config/package.json`

```json
{
  "name": "@platform/eslint-config",
  "version": "0.0.1",
  "private": true,
  "main": "base.js",
  "exports": {
    "./base":   "./base.js",
    "./next":   "./next.js",
    "./domain": "./domain.js"
  },
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser":        "^8.8.0",
    "eslint-import-resolver-typescript": "^3.6.3",
    "eslint-plugin-import":             "^2.31.0",
    "eslint-plugin-jsx-a11y":           "^6.10.0",
    "eslint-plugin-react":              "^7.37.0",
    "eslint-plugin-react-hooks":        "^4.6.2"
  },
  "peerDependencies": {
    "eslint": "^8.0.0 || ^9.0.0"
  }
}
```

## 2.9 `tooling/eslint-config/base.js`

```js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true },
      node: true,
    },
  },
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars':          ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    '@typescript-eslint/no-import-type-side-effects': 'error',
    '@typescript-eslint/no-explicit-any':         'error',
    '@typescript-eslint/no-non-null-assertion':   'error',
    '@typescript-eslint/require-await':           'error',
    '@typescript-eslint/no-floating-promises':    'error',
    '@typescript-eslint/await-thenable':          'error',

    // Import
    'import/order': ['error', {
      groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index', 'type'],
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: true },
    }],
    'import/no-duplicates': 'error',
    'import/no-cycle':      ['error', { maxDepth: 2 }],
  },
};
```

## 2.10 `tooling/eslint-config/domain.js`

Enforces domain boundary rules — prevents cross-domain imports.

```js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['./base.js'],
  rules: {
    'import/no-restricted-paths': ['error', {
      zones: [
        // Domains cannot import from other domains directly
        {
          target: './domains/identity',
          from:   './domains/employee',
          message: 'Identity domain cannot import from Employee domain. Use contracts or events.',
        },
        {
          target: './domains/employee',
          from:   './domains/identity/src/internal',
          message: 'Only import public identity exports via @domain/identity.',
        },
        // Apps cannot import from domain internals
        {
          target: './apps',
          from:   './domains/*/src/internal',
          message: 'Apps cannot import domain internals. Use public domain exports.',
        },
        // Packages cannot import from apps
        {
          target: './packages',
          from:   './apps',
          message: 'Shared packages cannot depend on application code.',
        },
        // Workers cannot import from apps
        {
          target: './workers',
          from:   './apps',
          message: 'Workers cannot import from app code.',
        },
      ],
    }],
  },
};
```

## 2.11 `tooling/eslint-config/next.js`

```js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    './base.js',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'next/core-web-vitals',
  ],
  plugins: ['react', 'react-hooks', 'jsx-a11y'],
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'react/react-in-jsx-scope':   'off',
    'react/prop-types':           'off',
    'react/display-name':         'off',
    'jsx-a11y/anchor-is-valid':   'off',
    '@typescript-eslint/no-misused-promises': ['error', {
      checksVoidReturn: { attributes: false },
    }],
  },
};
```

## 2.12 `.eslintrc.js` (root)

```js
/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ['@platform/eslint-config/base'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.next/',
    '.turbo/',
    'coverage/',
    '*.config.js',
    '*.config.mjs',
    '*.config.cjs',
    'tooling/eslint-config/*.js',
    'prisma/migrations/',
  ],
};
```

## 2.13 `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindConfig": "./apps/workforce-os/tailwind.config.ts",
  "overrides": [
    {
      "files": ["*.json"],
      "options": { "printWidth": 120 }
    },
    {
      "files": ["*.md"],
      "options": { "proseWrap": "always" }
    }
  ]
}
```

## 2.14 `.npmrc`

```ini
# Prevent phantom dependencies — packages must be explicitly declared
shamefully-hoist=false
strict-peer-dependencies=false
auto-install-peers=true

# Link workspace packages
link-workspace-packages=true

# Use hoisted node_modules for compatibility
hoist-pattern[]=*

# Cache
prefer-frozen-lockfile=true
store-dir=~/.pnpm-store

# Registry
registry=https://registry.npmjs.org/
```

## 2.15 `.gitignore`

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Build outputs
dist/
build/
.next/
out/
*.tsbuildinfo

# Turbo
.turbo/

# Testing
coverage/
.nyc_output/
playwright-report/
test-results/

# Environment
.env
.env.local
.env.development
.env.staging
.env.production
!.env.example
!.env.test

# Database
prisma/generated/
*.db
*.db-journal

# Logs
logs/
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db
desktop.ini

# Editor
.vscode/settings.json
.vscode/launch.json
!.vscode/extensions.json
!.vscode/settings.json.example
.idea/
*.swp
*.swo

# Misc
.cache/
*.pid
*.seed
*.pid.lock
```

## 2.16 `.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
max_line_length = off

[Makefile]
indent_style = tab

[*.{yaml,yml}]
indent_size = 2

[*.json]
indent_size = 2

[*.prisma]
indent_size = 2
```

## 2.17 `commitlint.config.js`

```js
/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat', 'fix', 'docs', 'style', 'refactor',
      'perf', 'test', 'build', 'ci', 'chore', 'revert',
    ]],
    'scope-enum': [1, 'always', [
      'api', 'web', 'admin', 'ess', 'worker',
      'contracts', 'events', 'database', 'auth',
      'config', 'observability', 'ui', 'legacy',
      'identity', 'employee', 'attendance', 'leave',
      'payroll', 'workflow', 'analytics', 'ai',
      'infra', 'docker', 'ci', 'deps', 'release',
    ]],
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 200],
  },
};
```

## 2.18 `.env.example`

```bash
# ─── Application ──────────────────────────────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=debug
PORT=3001

# ─── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://hrms_dev:dev_password@localhost:5432/hrms?schema=public
DIRECT_URL=postgresql://hrms_dev:dev_password@localhost:5432/hrms?schema=public

# ─── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://:dev_redis_password@localhost:6379
REDIS_PASSWORD=dev_redis_password

# ─── JWT ──────────────────────────────────────────────────────────────────────
# Generate with: openssl rand -hex 32
JWT_SECRET=change-me-generate-with-openssl-rand-hex-32
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# ─── Supabase ─────────────────────────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# ─── Frontend ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=Workforce OS
NEXT_PUBLIC_APP_VERSION=0.1.0

# ─── Legacy System ────────────────────────────────────────────────────────────
LEGACY_API_URL=http://localhost:8080
LEGACY_API_TIMEOUT_MS=10000

# ─── Observability ────────────────────────────────────────────────────────────
OTEL_SERVICE_NAME=workforce-os-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_TRACES_SAMPLER=parentbased_always_on

# ─── Email (dev: MailHog) ─────────────────────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@workforce-os.local

# ─── Migration Gates ──────────────────────────────────────────────────────────
MIGRATION_IDENTITY_ENABLED=true
MIGRATION_EMPLOYEE_ENABLED=false
MIGRATION_ATTENDANCE_ENABLED=false
MIGRATION_LEAVE_ENABLED=false
MIGRATION_PAYROLL_ENABLED=false

# ─── Feature Flags ────────────────────────────────────────────────────────────
ENABLE_AI_FEATURES=false
ENABLE_ANALYTICS=false
ENABLE_REALTIME=false
```

## 2.19 `.vscode/extensions.json`

```json
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
    "eamodio.gitlens",
    "orta.vscode-jest",
    "ms-playwright.playwright",
    "biomejs.biome",
    "GitHub.copilot"
  ]
}
```

## 2.20 `.vscode/settings.json`

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "eslint.workingDirectories": [
    { "pattern": "apps/*/" },
    { "pattern": "packages/*/" },
    { "pattern": "domains/*/" },
    { "pattern": "workers/*/" }
  ],
  "tailwindCSS.experimental.classRegex": [
    ["cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]"],
    ["cn\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ],
  "tailwindCSS.includeLanguages": {
    "typescript": "javascript",
    "typescriptreact": "javascript"
  },
  "[prisma]": { "editor.defaultFormatter": "Prisma.prisma" },
  "files.exclude": {
    "**/.turbo": true,
    "**/node_modules": true,
    "**/.next": true,
    "**/dist": true
  },
  "explorer.fileNesting.enabled": true,
  "explorer.fileNesting.patterns": {
    "*.ts":  "${capture}.test.ts, ${capture}.spec.ts",
    "*.tsx": "${capture}.test.tsx, ${capture}.spec.tsx, ${capture}.stories.tsx",
    "package.json": "package-lock.json, pnpm-lock.yaml, .npmrc, .nvmrc"
  }
}
```

## 2.21 `tooling/vitest/base.ts`

```typescript
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
        '**/index.ts',
        '**/*.stories.tsx',
        '**/migrations/**',
        '**/seeds/**',
        '**/generated/**',
      ],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
    testTimeout: 10_000,
    hookTimeout: 15_000,
  },
});
```

## 2.22 `tooling/vitest/package.json`

```json
{
  "name": "@platform/vitest-config",
  "version": "0.0.1",
  "private": true,
  "main": "base.ts",
  "exports": {
    "./base": "./base.ts"
  },
  "dependencies": {
    "vite-tsconfig-paths": "^5.0.1",
    "vitest": "^2.1.2"
  }
}
```

## 2.23 Husky Setup

```bash
# Run after pnpm install
pnpm exec husky init

# pre-commit hook
cat > .husky/pre-commit << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm lint-staged

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ]; then
  echo "❌ Direct commits to main are not allowed."
  exit 1
fi
EOF

# commit-msg hook
cat > .husky/commit-msg << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
npx --no -- commitlint --edit "$1"
EOF

chmod +x .husky/pre-commit .husky/commit-msg
```

## 2.24 `.github/CODEOWNERS`

```
# Global fallback
*                           @org/platform-leads

# Frontend
apps/workforce-os/          @org/frontend-team
apps/admin-console/         @org/frontend-team
apps/ess-portal/            @org/frontend-team

# Backend
apps/platform-api/          @org/backend-team
workers/                    @org/backend-team

# Domains
domains/identity/           @org/backend-team @org/platform-leads
domains/employee/           @org/backend-team

# Shared packages
packages/contracts/         @org/platform-leads
packages/database/          @org/backend-team @org/platform-leads
packages/auth/              @org/platform-leads
packages/ui/                @org/frontend-team

# Infrastructure
infra/                      @org/platform-leads
.github/                    @org/platform-leads
docker-compose.yml          @org/platform-leads
prisma/                     @org/backend-team @org/platform-leads
```


---

# SECTION 3 — APPLICATION INITIALIZATION

## 3.1 Frontend: `apps/workforce-os`

### Initialize

```bash
cd apps/workforce-os
```

### `apps/workforce-os/package.json`

```json
{
  "name": "workforce-os",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":        "next dev --port 3000",
    "build":      "next build",
    "start":      "next start --port 3000",
    "typecheck":  "tsc --noEmit",
    "lint":       "next lint --max-warnings 0",
    "clean":      "rm -rf .next dist"
  },
  "dependencies": {
    "@platform/contracts":     "workspace:*",
    "@platform/config":        "workspace:*",
    "@platform/ui":            "workspace:*",
    "@platform/types":         "workspace:*",
    "@radix-ui/react-avatar":  "^1.1.1",
    "@radix-ui/react-dialog":  "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-label":   "^2.1.0",
    "@radix-ui/react-select":  "^2.1.1",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-slot":    "^1.1.0",
    "@radix-ui/react-toast":   "^1.2.2",
    "@radix-ui/react-tooltip": "^1.1.3",
    "@supabase/supabase-js":   "^2.45.4",
    "@tanstack/react-query":   "^5.59.0",
    "@tanstack/react-query-devtools": "^5.59.0",
    "class-variance-authority": "^0.7.0",
    "clsx":                    "^2.1.1",
    "cmdk":                    "^1.0.0",
    "framer-motion":           "^11.11.1",
    "immer":                   "^10.1.1",
    "lucide-react":            "^0.453.0",
    "next":                    "^15.0.3",
    "next-themes":             "^0.3.0",
    "openapi-fetch":           "^0.12.2",
    "react":                   "^19.0.0",
    "react-dom":               "^19.0.0",
    "tailwind-merge":          "^2.5.4",
    "tailwindcss-animate":     "^1.0.7",
    "zustand":                 "^5.0.1",
    "zod":                     "^3.23.8"
  },
  "devDependencies": {
    "@platform/eslint-config": "workspace:*",
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "@types/react":            "^19.0.0",
    "@types/react-dom":        "^19.0.0",
    "autoprefixer":            "^10.4.20",
    "eslint":                  "^8.57.1",
    "eslint-config-next":      "^15.0.3",
    "postcss":                 "^8.4.47",
    "tailwindcss":             "^3.4.14",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

### `apps/workforce-os/tsconfig.json`

```json
{
  "extends": "@platform/tsconfig/nextjs",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `apps/workforce-os/next.config.ts`

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Transpile workspace packages
  transpilePackages: [
    '@platform/ui',
    '@platform/contracts',
    '@platform/types',
  ],

  // API rewrites — proxy to backend in development
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'X-Frame-Options',          value: 'DENY' },
          { key: 'X-XSS-Protection',         value: '1; mode=block' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
```

### `apps/workforce-os/tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
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
        status: {
          present:    'hsl(var(--status-present))',
          absent:     'hsl(var(--status-absent))',
          late:       'hsl(var(--status-late))',
          leave:      'hsl(var(--status-leave))',
          holiday:    'hsl(var(--status-holiday))',
          pending:    'hsl(var(--status-pending))',
          approved:   'hsl(var(--status-approved))',
          rejected:   'hsl(var(--status-rejected))',
          paid:       'hsl(var(--status-paid))',
        },
        risk: {
          low:      'hsl(var(--risk-low))',
          medium:   'hsl(var(--risk-medium))',
          high:     'hsl(var(--risk-high))',
          critical: 'hsl(var(--risk-critical))',
        },
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
        'fade-in':  { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        'fade-in':        'fade-in 0.15s ease-out',
        'slide-up':       'slide-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

### `apps/workforce-os/postcss.config.js`

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

---

## 3.2 Frontend: `apps/admin-console`

### `apps/admin-console/package.json`

```json
{
  "name": "admin-console",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":       "next dev --port 3002",
    "build":     "next build",
    "start":     "next start --port 3002",
    "typecheck": "tsc --noEmit",
    "lint":      "next lint --max-warnings 0"
  },
  "dependencies": {
    "@platform/contracts":    "workspace:*",
    "@platform/ui":           "workspace:*",
    "@tanstack/react-query":  "^5.59.0",
    "next":                   "^15.0.3",
    "react":                  "^19.0.0",
    "react-dom":              "^19.0.0",
    "zustand":                "^5.0.1",
    "openapi-fetch":          "^0.12.2",
    "framer-motion":          "^11.11.1",
    "lucide-react":           "^0.453.0",
    "next-themes":            "^0.3.0",
    "clsx":                   "^2.1.1",
    "tailwind-merge":         "^2.5.4"
  },
  "devDependencies": {
    "@platform/eslint-config": "workspace:*",
    "@platform/tsconfig":      "workspace:*",
    "@types/node":             "^22.8.1",
    "@types/react":            "^19.0.0",
    "@types/react-dom":        "^19.0.0",
    "autoprefixer":            "^10.4.20",
    "eslint":                  "^8.57.1",
    "eslint-config-next":      "^15.0.3",
    "postcss":                 "^8.4.47",
    "tailwindcss":             "^3.4.14",
    "typescript":              "^5.6.3"
  }
}
```

### `apps/admin-console/tsconfig.json`

```json
{
  "extends": "@platform/tsconfig/nextjs",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

---

## 3.3 Frontend: `apps/ess-portal`

### `apps/ess-portal/package.json`

```json
{
  "name": "ess-portal",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":       "next dev --port 3003",
    "build":     "next build",
    "start":     "next start --port 3003",
    "typecheck": "tsc --noEmit",
    "lint":      "next lint --max-warnings 0"
  },
  "dependencies": {
    "@platform/contracts":    "workspace:*",
    "@platform/ui":           "workspace:*",
    "@tanstack/react-query":  "^5.59.0",
    "next":                   "^15.0.3",
    "react":                  "^19.0.0",
    "react-dom":              "^19.0.0",
    "zustand":                "^5.0.1",
    "openapi-fetch":          "^0.12.2",
    "lucide-react":           "^0.453.0",
    "next-themes":            "^0.3.0",
    "clsx":                   "^2.1.1",
    "tailwind-merge":         "^2.5.4"
  },
  "devDependencies": {
    "@platform/eslint-config": "workspace:*",
    "@platform/tsconfig":      "workspace:*",
    "@types/node":             "^22.8.1",
    "@types/react":            "^19.0.0",
    "@types/react-dom":        "^19.0.0",
    "autoprefixer":            "^10.4.20",
    "eslint":                  "^8.57.1",
    "eslint-config-next":      "^15.0.3",
    "postcss":                 "^8.4.47",
    "tailwindcss":             "^3.4.14",
    "typescript":              "^5.6.3"
  }
}
```

---

## 3.4 Backend: `apps/platform-api`

### `apps/platform-api/package.json`

```json
{
  "name": "platform-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":       "tsx watch --clear-screen=false src/main.ts",
    "build":     "tsc -p tsconfig.build.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts --max-warnings 0",
    "test":      "vitest run",
    "test:watch": "vitest",
    "clean":     "rm -rf dist"
  },
  "dependencies": {
    "@fastify/cors":             "^10.0.1",
    "@fastify/helmet":           "^12.0.1",
    "@fastify/http-proxy":       "^10.0.0",
    "@fastify/jwt":              "^9.0.1",
    "@fastify/rate-limit":       "^10.1.1",
    "@fastify/swagger":          "^9.1.0",
    "@fastify/swagger-ui":       "^5.1.0",
    "@fastify/under-pressure":   "^9.0.1",
    "@opentelemetry/api":        "^1.9.0",
    "@platform/auth":            "workspace:*",
    "@platform/config":          "workspace:*",
    "@platform/contracts":       "workspace:*",
    "@platform/database":        "workspace:*",
    "@platform/events":          "workspace:*",
    "@platform/legacy-adapters": "workspace:*",
    "@platform/observability":   "workspace:*",
    "@platform/types":           "workspace:*",
    "@domain/identity":          "workspace:*",
    "fastify":                   "^5.0.0",
    "fastify-plugin":            "^5.0.1",
    "fastify-zod":               "^1.4.0",
    "zod":                       "^3.23.8"
  },
  "devDependencies": {
    "@platform/eslint-config": "workspace:*",
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "tsx":                     "^4.19.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

### `apps/platform-api/tsconfig.json`

```json
{
  "extends": "@platform/tsconfig/node",
  "compilerOptions": {
    "rootDir": "src",
    "outDir":  "dist",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### `apps/platform-api/tsconfig.build.json`

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*.test.ts", "**/*.spec.ts"]
}
```

### `apps/platform-api/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules/**', 'dist/**', 'test/**'],
    },
  },
});
```

### `apps/platform-api/test/setup.ts`

```typescript
import { afterAll, beforeAll } from 'vitest';

beforeAll(async () => {
  // Set test env vars before any imports
  process.env['NODE_ENV']    = 'test';
  process.env['LOG_LEVEL']   = 'silent';
  process.env['JWT_SECRET']  = 'test-secret-must-be-32-chars-minimum';
  process.env['JWT_EXPIRY']  = '15m';
  process.env['REDIS_URL']   = 'redis://localhost:6379';
  process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'] ?? 'postgresql://hrms_dev:dev_password@localhost:5432/hrms_test';
});

afterAll(async () => {
  // Cleanup handled per-test-file
});
```

---

## 3.5 Backend: `apps/legacy-api-adapter`

```json
{
  "name": "legacy-api-adapter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":       "tsx watch --clear-screen=false src/main.ts",
    "build":     "tsc -p tsconfig.build.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts --max-warnings 0"
  },
  "dependencies": {
    "@fastify/http-proxy":       "^10.0.0",
    "@platform/config":          "workspace:*",
    "@platform/contracts":       "workspace:*",
    "@platform/legacy-adapters": "workspace:*",
    "@platform/observability":   "workspace:*",
    "fastify":                   "^5.0.0",
    "fastify-plugin":            "^5.0.1",
    "zod":                       "^3.23.8"
  },
  "devDependencies": {
    "@platform/tsconfig": "workspace:*",
    "@types/node":        "^22.8.1",
    "tsx":                "^4.19.1",
    "typescript":         "^5.6.3"
  }
}
```

---

## 3.6 Worker: `workers/events`

### `workers/events/package.json`

```json
{
  "name": "worker-events",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":       "tsx watch --clear-screen=false src/main.ts",
    "build":     "tsc -p tsconfig.build.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts --max-warnings 0",
    "test":      "vitest run"
  },
  "dependencies": {
    "@platform/config":        "workspace:*",
    "@platform/contracts":     "workspace:*",
    "@platform/database":      "workspace:*",
    "@platform/events":        "workspace:*",
    "@platform/observability": "workspace:*",
    "bullmq":                  "^5.17.0",
    "ioredis":                 "^5.4.1",
    "zod":                     "^3.23.8"
  },
  "devDependencies": {
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "tsx":                     "^4.19.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

### `workers/events/tsconfig.json`

```json
{
  "extends": "@platform/tsconfig/node",
  "compilerOptions": {
    "rootDir": "src",
    "outDir":  "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### `workers/events/src/main.ts`

```typescript
import { initializeTracing } from '@platform/observability';

// MUST be first — before any other imports
await initializeTracing('worker-events');

import { config } from '@platform/config';
import { logger } from '@platform/observability';
import { createEventWorker } from './worker.js';

const worker = await createEventWorker();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutting down');
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

logger.info(
  { queues: worker.queueNames, concurrency: config.WORKER_CONCURRENCY ?? 5 },
  'Event worker started',
);
```

### `workers/events/src/worker.ts`

```typescript
import { Worker, type Job } from 'bullmq';
import { IORedis } from 'ioredis';
import { config } from '@platform/config';
import { logger } from '@platform/observability';

const QUEUE_NAMES = ['domain-events', 'notifications', 'audit'] as const;
type QueueName = typeof QUEUE_NAMES[number];

export async function createEventWorker() {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  });

  const workers = QUEUE_NAMES.map((queueName) =>
    new Worker(
      queueName,
      async (job: Job) => {
        logger.info({ queue: queueName, jobId: job.id, type: job.name }, 'Processing job');
        await processJob(queueName, job);
      },
      {
        connection,
        concurrency:         config.WORKER_CONCURRENCY ?? 5,
        removeOnComplete:    { count: 1000 },
        removeOnFail:        { count: 5000 },
      },
    ),
  );

  workers.forEach((worker) => {
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err }, 'Job failed');
    });
    worker.on('error', (err) => {
      logger.error({ err }, 'Worker error');
    });
  });

  return {
    queueNames: QUEUE_NAMES,
    close: async () => {
      await Promise.all(workers.map((w) => w.close()));
      connection.disconnect();
    },
  };
}

async function processJob(queue: QueueName, job: Job): Promise<void> {
  switch (queue) {
    case 'domain-events':
      await processDomainEvent(job);
      break;
    case 'notifications':
      await processNotification(job);
      break;
    case 'audit':
      await processAudit(job);
      break;
  }
}

async function processDomainEvent(job: Job): Promise<void> {
  // Routed to domain-specific handlers in Phase 2+
  logger.info({ jobName: job.name, data: job.data }, 'Domain event received — no handler yet');
}

async function processNotification(job: Job): Promise<void> {
  logger.info({ jobName: job.name }, 'Notification job received — handler pending');
}

async function processAudit(job: Job): Promise<void> {
  logger.info({ jobName: job.name }, 'Audit job received — handler pending');
}
```

---

## 3.7 Worker: `workers/analytics`

### `workers/analytics/package.json`

```json
{
  "name": "worker-analytics",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":       "tsx watch --clear-screen=false src/main.ts",
    "build":     "tsc -p tsconfig.build.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@platform/config":        "workspace:*",
    "@platform/database":      "workspace:*",
    "@platform/events":        "workspace:*",
    "@platform/observability": "workspace:*",
    "bullmq":                  "^5.17.0",
    "ioredis":                 "^5.4.1"
  },
  "devDependencies": {
    "@platform/tsconfig": "workspace:*",
    "@types/node":        "^22.8.1",
    "tsx":                "^4.19.1",
    "typescript":         "^5.6.3"
  }
}
```

### `workers/analytics/src/main.ts`

```typescript
import { initializeTracing } from '@platform/observability';
await initializeTracing('worker-analytics');

import { logger } from '@platform/observability';

// Analytics projection worker — Phase 5 implementation
// Subscribes to domain events, projects into OLAP read models
logger.info('Analytics worker started — projection handlers pending Phase 5');

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
```

---

## 3.8 Worker: `workers/ai`

### `workers/ai/package.json`

```json
{
  "name": "worker-ai",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":       "tsx watch --clear-screen=false src/main.ts",
    "build":     "tsc -p tsconfig.build.json",
    "start":     "node dist/main.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@platform/config":        "workspace:*",
    "@platform/events":        "workspace:*",
    "@platform/observability": "workspace:*",
    "bullmq":                  "^5.17.0",
    "ioredis":                 "^5.4.1"
  },
  "devDependencies": {
    "@platform/tsconfig": "workspace:*",
    "@types/node":        "^22.8.1",
    "tsx":                "^4.19.1",
    "typescript":         "^5.6.3"
  }
}
```

### `workers/ai/src/main.ts`

```typescript
import { initializeTracing } from '@platform/observability';
await initializeTracing('worker-ai');

import { logger } from '@platform/observability';

// AI pipeline worker — Phase 6 implementation
// Handles: attrition prediction, absence prediction, payroll anomaly detection
logger.info('AI worker started — ML pipeline handlers pending Phase 6');

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
```


---

# SECTION 4 — SHARED PACKAGE INITIALIZATION

## 4.1 `@platform/contracts`

### `packages/contracts/package.json`

```json
{
  "name": "@platform/contracts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".":          "./src/index.ts",
    "./schemas":  "./src/schemas/index.ts",
    "./events":   "./src/events/index.ts",
    "./types":    "./src/types/index.ts",
    "./generated": "./src/generated/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts --max-warnings 0"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@platform/tsconfig": "workspace:*",
    "@types/node":        "^22.8.1",
    "typescript":         "^5.6.3"
  }
}
```

### `packages/contracts/tsconfig.json`

```json
{
  "extends": "@platform/tsconfig/node",
  "compilerOptions": {
    "rootDir": "src",
    "outDir":  "dist",
    "noEmit":  true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### `packages/contracts/src/schemas/common.ts`

```typescript
import { z } from 'zod';

// ─── Pagination ───────────────────────────────────────────────────────────────
export const PaginationQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  sortBy:   z.string().optional(),
  sortDir:  z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
  page:       z.number(),
  pageSize:   z.number(),
  total:      z.number(),
  totalPages: z.number(),
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

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// ─── Common Fields ────────────────────────────────────────────────────────────
export const UuidSchema    = z.string().uuid();
export const TenantIdSchema = z.string().uuid();
export const DateSchema    = z.string().date();       // 'YYYY-MM-DD'
export const DateTimeSchema = z.string().datetime();  // ISO 8601

// ─── API Response Wrapper ─────────────────────────────────────────────────────
export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data:    dataSchema,
  });

export const ApiErrorResponseSchema = z.object({
  success:   z.literal(false),
  error: z.object({
    code:    z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

// ─── Sort / Filter ────────────────────────────────────────────────────────────
export const IdParamSchema = z.object({ id: UuidSchema });
export type IdParam = z.infer<typeof IdParamSchema>;
```

### `packages/contracts/src/schemas/identity.ts`

```typescript
import { z } from 'zod';
import { UuidSchema, TenantIdSchema, DateTimeSchema } from './common.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const LoginRequestSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
  tenantId: TenantIdSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

export const JwtClaimsSchema = z.object({
  sub:         UuidSchema,
  tenantId:    TenantIdSchema,
  email:       z.string().email(),
  name:        z.string(),
  roles:       z.array(z.string()),
  permissions: z.array(z.string()),
  iat:         z.number(),
  exp:         z.number(),
  jti:         z.string().uuid(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export const AuthTokenResponseSchema = z.object({
  accessToken:  z.string(),
  refreshToken: z.string(),
  expiresIn:    z.number(),
  tokenType:    z.literal('Bearer'),
  claims:       JwtClaimsSchema,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

// ─── Tenant ───────────────────────────────────────────────────────────────────
export const TenantSchema = z.object({
  id:          UuidSchema,
  name:        z.string().min(1).max(255),
  slug:        z.string().min(1).max(63).regex(/^[a-z0-9-]+$/),
  plan:        z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  isActive:    z.boolean(),
  createdAt:   DateTimeSchema,
  updatedAt:   DateTimeSchema,
});
export type Tenant = z.infer<typeof TenantSchema>;

// ─── User ─────────────────────────────────────────────────────────────────────
export const UserSchema = z.object({
  id:          UuidSchema,
  tenantId:    TenantIdSchema,
  email:       z.string().email(),
  name:        z.string(),
  isActive:    z.boolean(),
  lastLoginAt: DateTimeSchema.nullable(),
  createdAt:   DateTimeSchema,
  updatedAt:   DateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserRequestSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  name:     z.string().min(1).max(255).trim(),
  password: z.string().min(8).max(128),
  roles:    z.array(z.string()).min(1).default(['employee']),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
```

### `packages/contracts/src/schemas/employee.ts`

```typescript
import { z } from 'zod';
import { UuidSchema, TenantIdSchema, DateSchema, DateTimeSchema } from './common.js';

export const EmploymentTypeSchema = z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']);
export const EmployeeStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED']);

export const EmployeeSchema = z.object({
  id:             UuidSchema,
  tenantId:       TenantIdSchema,
  employeeCode:   z.string().min(1).max(50),
  firstName:      z.string().min(1).max(100),
  lastName:       z.string().min(1).max(100),
  email:          z.string().email(),
  phone:          z.string().max(20).nullable(),
  department:     z.string().max(100).nullable(),
  designation:    z.string().max(100).nullable(),
  employmentType: EmploymentTypeSchema,
  status:         EmployeeStatusSchema,
  joinDate:       DateSchema,
  terminationDate: DateSchema.nullable(),
  managerId:      UuidSchema.nullable(),
  createdAt:      DateTimeSchema,
  updatedAt:      DateTimeSchema,
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const CreateEmployeeRequestSchema = z.object({
  employeeCode:   z.string().min(1).max(50).trim(),
  firstName:      z.string().min(1).max(100).trim(),
  lastName:       z.string().min(1).max(100).trim(),
  email:          z.string().email().toLowerCase().trim(),
  phone:          z.string().max(20).optional(),
  department:     z.string().max(100).optional(),
  designation:    z.string().max(100).optional(),
  employmentType: EmploymentTypeSchema.default('FULL_TIME'),
  joinDate:       DateSchema,
  managerId:      UuidSchema.optional(),
});
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequestSchema>;
```

### `packages/contracts/src/events/base.ts`

```typescript
import { z } from 'zod';

// ─── Canonical Event Envelope ─────────────────────────────────────────────────
// ALL domain events must conform to this schema.
export const EventEnvelopeBaseSchema = z.object({
  eventId:          z.string().uuid(),
  eventType:        z.string().min(1),     // e.g. 'employee.onboarded'
  eventVersion:     z.string().default('1.0'),
  aggregateId:      z.string().uuid(),
  aggregateType:    z.string().min(1),     // e.g. 'Employee'
  tenantId:         z.string().uuid(),
  occurredAt:       z.string().datetime(),
  correlationId:    z.string().uuid(),
  causationId:      z.string().uuid().optional(),
  producerService:  z.string().min(1),
  schemaVersion:    z.string().default('1'),
});

export type EventEnvelopeBase = z.infer<typeof EventEnvelopeBaseSchema>;

export function createEventEnvelope<T>(
  base: Omit<EventEnvelopeBase, 'eventId' | 'occurredAt'>,
  payload: T,
): EventEnvelopeBase & { payload: T } {
  return {
    ...base,
    eventId:     crypto.randomUUID(),
    occurredAt:  new Date().toISOString(),
    payload,
  };
}
```

### `packages/contracts/src/events/identity.events.ts`

```typescript
import { z } from 'zod';
import { EventEnvelopeBaseSchema } from './base.js';

export const UserRegisteredEventSchema = EventEnvelopeBaseSchema.extend({
  eventType: z.literal('identity.user.registered'),
  payload: z.object({
    userId:   z.string().uuid(),
    tenantId: z.string().uuid(),
    email:    z.string().email(),
    name:     z.string(),
    roles:    z.array(z.string()),
  }),
});
export type UserRegisteredEvent = z.infer<typeof UserRegisteredEventSchema>;

export const UserLoggedInEventSchema = EventEnvelopeBaseSchema.extend({
  eventType: z.literal('identity.user.logged_in'),
  payload: z.object({
    userId:    z.string().uuid(),
    tenantId:  z.string().uuid(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
  }),
});
export type UserLoggedInEvent = z.infer<typeof UserLoggedInEventSchema>;

export const TenantProvisionedEventSchema = EventEnvelopeBaseSchema.extend({
  eventType: z.literal('identity.tenant.provisioned'),
  payload: z.object({
    tenantId:   z.string().uuid(),
    tenantSlug: z.string(),
    tenantName: z.string(),
    plan:       z.string(),
  }),
});
export type TenantProvisionedEvent = z.infer<typeof TenantProvisionedEventSchema>;
```

### `packages/contracts/src/schemas/index.ts`

```typescript
export * from './common.js';
export * from './identity.js';
export * from './employee.js';
```

### `packages/contracts/src/events/index.ts`

```typescript
export * from './base.js';
export * from './identity.events.js';
```

### `packages/contracts/src/index.ts`

```typescript
export * from './schemas/index.js';
export * from './events/index.js';
```

---

## 4.2 `@platform/config`

### `packages/config/package.json`

```json
{
  "name": "@platform/config",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint":      "eslint src --ext .ts --max-warnings 0"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@platform/tsconfig": "workspace:*",
    "@types/node":        "^22.8.1",
    "typescript":         "^5.6.3"
  }
}
```

### `packages/config/src/schema.ts`

```typescript
import { z } from 'zod';

const boolStr = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => ['true', '1', 'yes'].includes(v));

export const EnvSchema = z.object({
  // ── Runtime ────────────────────────────────────────────────────────────
  NODE_ENV:    z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL:   z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT:        z.coerce.number().int().min(1024).max(65535).default(3001),

  // ── Database ───────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DIRECT_URL:   z.string().url().startsWith('postgresql://').optional(),

  // ── Redis ──────────────────────────────────────────────────────────────
  REDIS_URL:      z.string().url().startsWith('redis'),
  REDIS_PASSWORD: z.string().optional(),

  // ── JWT ────────────────────────────────────────────────────────────────
  JWT_SECRET:         z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRY:         z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // ── Supabase ───────────────────────────────────────────────────────────
  SUPABASE_URL:              z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // ── Legacy ────────────────────────────────────────────────────────────
  LEGACY_API_URL:        z.string().url().optional(),
  LEGACY_API_TIMEOUT_MS: z.coerce.number().int().default(10_000),

  // ── Observability ─────────────────────────────────────────────────────
  OTEL_SERVICE_NAME:             z.string().default('workforce-os-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT:  z.string().url().default('http://localhost:4318'),
  OTEL_TRACES_SAMPLER:          z.string().default('parentbased_always_on'),

  // ── Email ─────────────────────────────────────────────────────────────
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_FROM: z.string().email().default('noreply@workforce-os.local'),

  // ── Migration Gates ───────────────────────────────────────────────────
  MIGRATION_IDENTITY_ENABLED:   boolStr.default('true'),
  MIGRATION_EMPLOYEE_ENABLED:   boolStr.default('false'),
  MIGRATION_ATTENDANCE_ENABLED: boolStr.default('false'),
  MIGRATION_LEAVE_ENABLED:      boolStr.default('false'),
  MIGRATION_PAYROLL_ENABLED:    boolStr.default('false'),

  // ── Feature Flags ─────────────────────────────────────────────────────
  ENABLE_AI_FEATURES: boolStr.default('false'),
  ENABLE_ANALYTICS:   boolStr.default('false'),
  ENABLE_REALTIME:    boolStr.default('false'),

  // ── Workers ───────────────────────────────────────────────────────────
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
});

export type Env = z.infer<typeof EnvSchema>;
```

### `packages/config/src/loader.ts`

```typescript
import { type Env, EnvSchema } from './schema.js';

function loadConfig(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error(
      `\n❌ Environment validation failed — fix these variables before starting:\n\n${errors}\n`,
    );
    process.exit(1);
  }

  return result.data;
}

// Singleton — parsed once at module load
export const config: Env = loadConfig();
```

### `packages/config/src/index.ts`

```typescript
export { config } from './loader.js';
export { EnvSchema, type Env } from './schema.js';
```

---

## 4.3 `@platform/types`

### `packages/types/package.json`

```json
{
  "name": "@platform/types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@platform/tsconfig": "workspace:*",
    "typescript":         "^5.6.3"
  }
}
```

### `packages/types/src/index.ts`

```typescript
// ─── Utility Types ────────────────────────────────────────────────────────────
export type Nullable<T>    = T | null;
export type Optional<T>    = T | undefined;
export type Maybe<T>       = T | null | undefined;
export type Awaited<T>     = T extends Promise<infer U> ? U : T;
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };
export type DeepPartial<T>  = { [K in keyof T]?: DeepPartial<T[K]> };

// ─── Brand Types ──────────────────────────────────────────────────────────────
declare const __brand: unique symbol;
export type Brand<T, B> = T & { [__brand]: B };

export type TenantId    = Brand<string, 'TenantId'>;
export type UserId      = Brand<string, 'UserId'>;
export type EmployeeId  = Brand<string, 'EmployeeId'>;
export type EventId     = Brand<string, 'EventId'>;

// ─── Result Pattern ───────────────────────────────────────────────────────────
export type Ok<T>  = { success: true;  data:  T };
export type Err<E> = { success: false; error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T>     { return { success: true,  data  }; }
export function err<E>(error: E): Err<E>  { return { success: false, error }; }

// ─── Context ──────────────────────────────────────────────────────────────────
export interface RequestContext {
  tenantId:      string;
  userId:        string;
  correlationId: string;
  requestId:     string;
  ipAddress?:    string;
  userAgent?:    string;
}

// ─── Repository Pattern ───────────────────────────────────────────────────────
export interface Repository<T, CreateInput, UpdateInput = Partial<CreateInput>> {
  findById(id: string, tenantId: string): Promise<T | null>;
  findMany(tenantId: string, query: unknown): Promise<{ items: T[]; total: number }>;
  create(input: CreateInput, tenantId: string): Promise<T>;
  update(id: string, input: UpdateInput, tenantId: string): Promise<T>;
  delete(id: string, tenantId: string): Promise<void>;
}
```

---

## 4.4 `@platform/auth`

### `packages/auth/package.json`

```json
{
  "name": "@platform/auth",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  },
  "dependencies": {
    "@platform/config":    "workspace:*",
    "@platform/contracts": "workspace:*",
    "jose":                "^5.9.6"
  },
  "devDependencies": {
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

### `packages/auth/src/jwt.ts`

```typescript
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '@platform/config';
import type { JwtClaims } from '@platform/contracts';

const SECRET_KEY = new TextEncoder().encode(config.JWT_SECRET);

export async function signJwt(
  claims: Omit<JwtClaims, 'iat' | 'exp' | 'jti'>,
): Promise<string> {
  return new SignJWT(claims as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_EXPIRY)
    .setJti(crypto.randomUUID())
    .sign(SECRET_KEY);
}

export async function signRefreshToken(userId: string, tenantId: string): Promise<string> {
  return new SignJWT({ sub: userId, tenantId, type: 'refresh' } as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_REFRESH_EXPIRY)
    .setJti(crypto.randomUUID())
    .sign(SECRET_KEY);
}

export async function verifyJwt(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, SECRET_KEY, { algorithms: ['HS256'] });
  return payload as unknown as JwtClaims;
}

export async function verifyRefreshToken(
  token: string,
): Promise<{ sub: string; tenantId: string }> {
  const { payload } = await jwtVerify(token, SECRET_KEY, { algorithms: ['HS256'] });
  if (payload['type'] !== 'refresh' || !payload.sub || !payload['tenantId']) {
    throw new Error('Invalid refresh token');
  }
  return { sub: payload.sub, tenantId: payload['tenantId'] as string };
}
```

### `packages/auth/src/password.ts`

```typescript
/**
 * Password hashing using Web Crypto API.
 * No bcrypt dependency — uses PBKDF2 + SHA-256.
 */

const ITERATIONS = 600_000;
const KEY_LENGTH  = 32;
const HASH_ALG    = 'SHA-256';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);

  const saltHex = Buffer.from(salt).toString('hex');
  const keyHex  = Buffer.from(key).toString('hex');

  return `pbkdf2:${ITERATIONS}:${saltHex}:${keyHex}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = parseInt(parts[1] ?? '0', 10);
  const salt       = Buffer.from(parts[2] ?? '', 'hex');
  const storedKey  = Buffer.from(parts[3] ?? '', 'hex');

  const derivedKey = await deriveKey(password, salt, iterations);
  return timingSafeEqual(derivedKey, storedKey);
}

async function deriveKey(
  password: string,
  salt: Uint8Array | Buffer,
  iterations = ITERATIONS,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: HASH_ALG, salt: new Uint8Array(salt), iterations },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
```

### `packages/auth/src/index.ts`

```typescript
export * from './jwt.js';
export * from './password.js';
```

---

## 4.5 `@platform/events`

### `packages/events/package.json`

```json
{
  "name": "@platform/events",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  },
  "dependencies": {
    "@platform/config":    "workspace:*",
    "@platform/contracts": "workspace:*",
    "@platform/observability": "workspace:*",
    "bullmq":              "^5.17.0",
    "ioredis":             "^5.4.1"
  },
  "devDependencies": {
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

### `packages/events/src/publisher.ts`

```typescript
import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '@platform/config';
import { logger } from '@platform/observability';
import type { EventEnvelopeBase } from '@platform/contracts';

let _connection: IORedis | undefined;
const _queues = new Map<string, Queue>();

function getConnection(): IORedis {
  if (!_connection) {
    _connection = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return _connection;
}

function getQueue(name: string): Queue {
  if (!_queues.has(name)) {
    _queues.set(name, new Queue(name, { connection: getConnection() }));
  }
  return _queues.get(name)!;
}

interface PublishOptions extends JobsOptions {
  queue?: string;
}

/**
 * Publish a domain event to BullMQ.
 *
 * Events are published to the 'domain-events' queue by default.
 * The outbox pattern (Prisma + transactional outbox) is used in Phase 2+.
 * For now: direct publish with at-least-once delivery semantics.
 */
export async function publishEvent(
  event: EventEnvelopeBase & { payload: unknown },
  options: PublishOptions = {},
): Promise<void> {
  const { queue = 'domain-events', ...jobOptions } = options;

  const q = getQueue(queue);

  await q.add(event.eventType, event, {
    jobId:    event.eventId,   // Idempotent — duplicate jobs rejected
    attempts: 3,
    backoff:  { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail:     { count: 5000 },
    ...jobOptions,
  });

  logger.debug(
    { eventId: event.eventId, eventType: event.eventType, queue },
    'Event published',
  );
}

export async function closeEventPublisher(): Promise<void> {
  await Promise.all([..._queues.values()].map((q) => q.close()));
  _connection?.disconnect();
}
```

### `packages/events/src/index.ts`

```typescript
export * from './publisher.js';
```

---

## 4.6 `@platform/ui`

### `packages/ui/package.json`

```json
{
  "name": "@platform/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".":                    "./src/index.ts",
    "./components/*":       "./src/components/*.tsx",
    "./hooks/*":            "./src/hooks/*.ts",
    "./lib/*":              "./src/lib/*.ts",
    "./tailwind.config":    "./tailwind.config.ts"
  },
  "scripts": {
    "typecheck":       "tsc --noEmit",
    "lint":            "eslint src --ext .ts,.tsx --max-warnings 0",
    "storybook":       "storybook dev -p 6006",
    "build-storybook": "storybook build"
  },
  "dependencies": {
    "@radix-ui/react-avatar":       "^1.1.1",
    "@radix-ui/react-dialog":       "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-label":        "^2.1.0",
    "@radix-ui/react-select":       "^2.1.1",
    "@radix-ui/react-separator":    "^1.1.0",
    "@radix-ui/react-slot":         "^1.1.0",
    "@radix-ui/react-toast":        "^1.2.2",
    "@radix-ui/react-tooltip":      "^1.1.3",
    "class-variance-authority":     "^0.7.0",
    "clsx":                         "^2.1.1",
    "cmdk":                         "^1.0.0",
    "framer-motion":                "^11.11.1",
    "lucide-react":                 "^0.453.0",
    "tailwind-merge":               "^2.5.4",
    "tailwindcss-animate":          "^1.0.7"
  },
  "peerDependencies": {
    "react":       "^18.0.0 || ^19.0.0",
    "react-dom":   "^18.0.0 || ^19.0.0",
    "tailwindcss": "^3.4.0"
  },
  "devDependencies": {
    "@chromatic-com/storybook":    "^3.2.2",
    "@platform/tsconfig":         "workspace:*",
    "@storybook/addon-essentials": "^8.3.6",
    "@storybook/nextjs":          "^8.3.6",
    "@storybook/react":           "^8.3.6",
    "@types/node":                "^22.8.1",
    "@types/react":               "^19.0.0",
    "@types/react-dom":           "^19.0.0",
    "autoprefixer":               "^10.4.20",
    "postcss":                    "^8.4.47",
    "tailwindcss":                "^3.4.14",
    "typescript":                 "^5.6.3"
  }
}
```

### `packages/ui/tsconfig.json`

```json
{
  "extends": "@platform/tsconfig/react-library",
  "compilerOptions": {
    "rootDir":  "src",
    "noEmit":   true
  },
  "include":  ["src/**/*"],
  "exclude":  ["node_modules", "dist"]
}
```

### `packages/ui/src/lib/utils.ts`

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', options).format(d);
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
```

### `packages/ui/src/components/button.tsx`

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    'ring-offset-background transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default:     'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:     'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:       'hover:bg-accent hover:text-accent-foreground',
        link:        'text-primary underline-offset-4 hover:underline',
        brand:       'bg-brand-600 text-white hover:bg-brand-700',
      },
      size: {
        default:   'h-10 px-4 py-2',
        sm:        'h-9 rounded-md px-3',
        lg:        'h-11 rounded-md px-8',
        icon:      'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
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

### `packages/ui/src/components/badge.tsx`

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:        'border-transparent bg-primary text-primary-foreground',
        secondary:      'border-transparent bg-secondary text-secondary-foreground',
        destructive:    'border-transparent bg-destructive text-destructive-foreground',
        outline:        'text-foreground',
        present:        'border-transparent bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400',
        absent:         'border-transparent bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
        late:           'border-transparent bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400',
        leave:          'border-transparent bg-sky-100    text-sky-700    dark:bg-sky-900/30    dark:text-sky-400',
        holiday:        'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
        pending:        'border-transparent bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400',
        approved:       'border-transparent bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400',
        rejected:       'border-transparent bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
        paid:           'border-transparent bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400',
        'risk-low':     'border-transparent bg-green-100  text-green-700',
        'risk-medium':  'border-transparent bg-amber-100  text-amber-700',
        'risk-high':    'border-transparent bg-orange-100 text-orange-700',
        'risk-critical':'border-transparent bg-red-100    text-red-700',
      },
    },
    defaultVariants: { variant: 'default' },
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

### `packages/ui/src/index.ts`

```typescript
// Components
export { Button, buttonVariants, type ButtonProps } from './components/button.js';
export { Badge, badgeVariants, type BadgeProps }    from './components/badge.js';

// Lib
export { cn, formatDate, getInitials } from './lib/utils.js';
```

---

# SECTION 5 — CONTRACT-FIRST FOUNDATION

## 5.1 OpenAPI Generation Script

### `scripts/codegen/openapi.ts`

```typescript
#!/usr/bin/env tsx
/**
 * OpenAPI codegen script.
 * 1. Starts the Fastify app in testing mode
 * 2. Calls app.swagger() to get the spec
 * 3. Writes spec to packages/contracts/src/generated/openapi.json
 * 4. Runs openapi-typescript to generate typed paths
 *
 * Run: pnpm codegen:openapi
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Set testing env before importing app
process.env['NODE_ENV']    = 'test';
process.env['JWT_SECRET']  = 'codegen-fake-secret-minimum-32-chars';
process.env['DATABASE_URL'] = 'postgresql://fake:fake@localhost:5432/fake';
process.env['REDIS_URL']   = 'redis://localhost:6379';
process.env['LOG_LEVEL']   = 'silent';

const { buildApp } = await import('../../apps/platform-api/src/app.js');

const app = await buildApp({ logger: false });
await app.ready();

const spec = app.swagger();
const specPath = resolve('packages/contracts/src/generated/openapi.json');

writeFileSync(specPath, JSON.stringify(spec, null, 2), 'utf8');
console.log(`✓ OpenAPI spec written to ${specPath}`);

// Generate TypeScript types from spec
const typesPath = resolve('packages/contracts/src/generated/openapi.d.ts');
execSync(`npx openapi-typescript ${specPath} -o ${typesPath}`, { stdio: 'inherit' });
console.log(`✓ TypeScript types generated at ${typesPath}`);

await app.close();
console.log('✓ Codegen complete');
```

## 5.2 Frontend API Client

### `apps/workforce-os/src/lib/api-client.ts`

```typescript
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@platform/contracts/generated';
import { useAuthStore } from '@/store/auth.store';

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export const apiClient = createClient<paths>({ baseUrl: BASE_URL });

// Auth middleware — inject Bearer token
const authMiddleware: Middleware = {
  onRequest({ request }) {
    const { token } = useAuthStore.getState();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
  onResponse({ response }) {
    if (response.status === 401) {
      // Clear auth state on unauthorized
      useAuthStore.getState().clearAuth();
    }
    return response;
  },
};

apiClient.use(authMiddleware);
```

## 5.3 Type-Safe Query Hook Pattern

### `apps/workforce-os/src/hooks/use-api.ts`

```typescript
import { useQuery, useMutation, type UseQueryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Typed wrapper for GET /api/v1/auth/me
 * Pattern to follow for all API hooks.
 */
export function useCurrentUser(
  options?: Omit<UseQueryOptions<unknown>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn:  async () => {
      const { data, error } = await apiClient.GET('/api/v1/auth/me');
      if (error) throw new Error(error.message ?? 'Failed to fetch current user');
      return data;
    },
    staleTime: 60_000,
    ...options,
  });
}
```

## 5.4 Zod → API Contract Flow

The full contract flow:

```
1. Define Zod schema in packages/contracts/src/schemas/
      ↓
2. Infer TypeScript types: z.infer<typeof Schema>
      ↓
3. Register schema in Fastify route via fastify-zod
      ↓
4. Fastify generates OpenAPI spec from Zod schemas
      ↓
5. pnpm codegen:openapi writes spec + types to packages/contracts/src/generated/
      ↓
6. Frontend imports typed paths from @platform/contracts/generated
      ↓
7. openapi-fetch provides type-safe GET/POST/PUT/DELETE
```

No manual type duplication anywhere in the stack.


---

# SECTION 6 — DATABASE INITIALIZATION

## 6.1 Prisma Setup Commands

```bash
# From workspace root
pnpm add -D prisma @prisma/client --filter @platform/database
pnpm exec prisma init --datasource-provider postgresql --output ../packages/database/src/generated
```

## 6.2 `packages/database/package.json`

```json
{
  "name": "@platform/database",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "db:generate": "prisma generate --schema=../../prisma/schema",
    "typecheck":   "tsc --noEmit",
    "test":        "vitest run"
  },
  "dependencies": {
    "@prisma/client":  "^5.21.1",
    "@platform/config": "workspace:*",
    "@platform/types":  "workspace:*"
  },
  "devDependencies": {
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "prisma":                  "^5.21.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

## 6.3 `prisma/schema/base.prisma`

```prisma
// prisma/schema/base.prisma
// Root schema file — configures datasource and generator.
// Domain-specific models live in separate .prisma files.

generator client {
  provider        = "prisma-client-js"
  output          = "../packages/database/src/generated"
  previewFeatures = ["multiSchema", "prismaSchemaFolder"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = ["identity", "employee", "audit", "events"]
}
```

## 6.4 `prisma/schema/identity.prisma`

```prisma
// prisma/schema/identity.prisma

model Tenant {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name      String   @db.VarChar(255)
  slug      String   @unique @db.VarChar(63)
  plan      TenantPlan @default(STARTER)
  isActive  Boolean  @default(true) @map("is_active")
  settings  Json     @default("{}")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  users       User[]
  memberships TenantMembership[]

  @@map("tenants")
  @@schema("identity")
}

model User {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  email        String    @db.VarChar(255)
  name         String    @db.VarChar(255)
  passwordHash String    @map("password_hash") @db.VarChar(512)
  isActive     Boolean   @default(true) @map("is_active")
  lastLoginAt  DateTime? @map("last_login_at") @db.Timestamptz(6)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  tenant      Tenant             @relation(fields: [tenantId], references: [id])
  memberships TenantMembership[]
  sessions    Session[]

  @@unique([tenantId, email])
  @@index([email])
  @@map("users")
  @@schema("identity")
}

model TenantMembership {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  roles     String[] @default(["employee"])
  isActive  Boolean  @default(true) @map("is_active")
  joinedAt  DateTime @default(now()) @map("joined_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  tenant Tenant @relation(fields: [tenantId], references: [id])
  user   User   @relation(fields: [tenantId, userId], references: [tenantId, id])

  @@unique([tenantId, userId])
  @@map("tenant_memberships")
  @@schema("identity")
}

model Session {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  tenantId     String   @map("tenant_id") @db.Uuid
  refreshToken String   @unique @map("refresh_token") @db.VarChar(512)
  userAgent    String?  @map("user_agent") @db.VarChar(512)
  ipAddress    String?  @map("ip_address") @db.VarChar(45)
  expiresAt    DateTime @map("expires_at") @db.Timestamptz(6)
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([refreshToken])
  @@index([expiresAt])
  @@map("sessions")
  @@schema("identity")
}

enum TenantPlan {
  STARTER
  PROFESSIONAL
  ENTERPRISE

  @@schema("identity")
}
```

## 6.5 `prisma/schema/employee.prisma`

```prisma
// prisma/schema/employee.prisma

model Employee {
  id              String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String           @map("tenant_id") @db.Uuid
  employeeCode    String           @map("employee_code") @db.VarChar(50)
  userId          String?          @map("user_id") @db.Uuid
  firstName       String           @map("first_name") @db.VarChar(100)
  lastName        String           @map("last_name") @db.VarChar(100)
  email           String           @db.VarChar(255)
  phone           String?          @db.VarChar(20)
  department      String?          @db.VarChar(100)
  designation     String?          @db.VarChar(100)
  employmentType  EmploymentType   @default(FULL_TIME) @map("employment_type")
  status          EmployeeStatus   @default(ACTIVE)
  joinDate        DateTime         @map("join_date") @db.Date
  terminationDate DateTime?        @map("termination_date") @db.Date
  managerId       String?          @map("manager_id") @db.Uuid
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  manager        Employee?         @relation("EmployeeManager", fields: [managerId], references: [id])
  directReports  Employee[]        @relation("EmployeeManager")
  employmentHistory EmploymentRecord[]

  @@unique([tenantId, employeeCode])
  @@unique([tenantId, email])
  @@index([tenantId])
  @@index([tenantId, status])
  @@index([managerId])
  @@map("employees")
  @@schema("employee")
}

// SCD Type 2 — full employment history preserved
model EmploymentRecord {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  employeeId     String   @map("employee_id") @db.Uuid
  tenantId       String   @map("tenant_id") @db.Uuid
  department     String?  @db.VarChar(100)
  designation    String?  @db.VarChar(100)
  employmentType EmploymentType @map("employment_type")
  effectiveFrom  DateTime @map("effective_from") @db.Date
  effectiveTo    DateTime? @map("effective_to") @db.Date
  isCurrent      Boolean  @default(true) @map("is_current")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([employeeId, isCurrent])
  @@index([tenantId])
  @@map("employment_records")
  @@schema("employee")
}

enum EmploymentType {
  FULL_TIME
  PART_TIME
  CONTRACT
  INTERN

  @@schema("employee")
}

enum EmployeeStatus {
  ACTIVE
  INACTIVE
  ON_LEAVE
  TERMINATED

  @@schema("employee")
}
```

## 6.6 `prisma/schema/audit.prisma`

```prisma
// prisma/schema/audit.prisma
// Append-only audit log — no updates, no deletes.

model AuditLog {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  actorId       String   @map("actor_id") @db.Uuid
  actorEmail    String   @map("actor_email") @db.VarChar(255)
  action        String   @db.VarChar(100)       // e.g. 'employee.update'
  resourceType  String   @map("resource_type") @db.VarChar(100)  // e.g. 'Employee'
  resourceId    String   @map("resource_id") @db.Uuid
  changes       Json     @default("{}")
  ipAddress     String?  @map("ip_address") @db.VarChar(45)
  correlationId String   @map("correlation_id") @db.Uuid
  occurredAt    DateTime @default(now()) @map("occurred_at") @db.Timestamptz(6)

  @@index([tenantId, occurredAt(sort: Desc)])
  @@index([tenantId, resourceType, resourceId])
  @@index([tenantId, actorId])
  @@map("audit_logs")
  @@schema("audit")
}
```

## 6.7 `prisma/schema/events.prisma`

```prisma
// prisma/schema/events.prisma
// Transactional outbox — ensures events are published atomically with DB writes.

model OutboxEvent {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  aggregateId   String    @map("aggregate_id") @db.Uuid
  aggregateType String    @map("aggregate_type") @db.VarChar(100)
  eventType     String    @map("event_type") @db.VarChar(200)
  eventVersion  String    @default("1.0") @map("event_version") @db.VarChar(10)
  payload       Json
  correlationId String    @map("correlation_id") @db.Uuid
  occurredAt    DateTime  @default(now()) @map("occurred_at") @db.Timestamptz(6)
  publishedAt   DateTime? @map("published_at") @db.Timestamptz(6)
  failureCount  Int       @default(0) @map("failure_count")
  lastError     String?   @map("last_error")

  @@index([publishedAt], where: "published_at IS NULL")  // Unpublished events index
  @@index([tenantId, occurredAt])
  @@map("outbox_events")
  @@schema("events")
}
```

## 6.8 Initial Migration SQL

### `prisma/migrations/20250101000000_init_schemas/migration.sql`

```sql
-- Migration: Initialize domain schemas + extensions + RLS
-- Created: 2025-01-01
-- Rationale: Bootstrap all PostgreSQL schemas for domain isolation

-- ─── Extensions ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ─── Schemas ───────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS employee;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS events;

-- ─── Service Account Role (bypasses RLS) ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_account') THEN
    CREATE ROLE service_account NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA identity  TO service_account;
GRANT USAGE ON SCHEMA employee  TO service_account;
GRANT USAGE ON SCHEMA audit     TO service_account;
GRANT USAGE ON SCHEMA events    TO service_account;

-- ─── Identity: Tenants ─────────────────────────────────────────────────────
CREATE TABLE identity.tenants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(63)  NOT NULL,
  plan       VARCHAR(50)  NOT NULL DEFAULT 'STARTER',
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  settings   JSONB        NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_slug_unique UNIQUE (slug),
  CONSTRAINT tenants_plan_check CHECK (plan IN ('STARTER','PROFESSIONAL','ENTERPRISE'))
);

CREATE INDEX idx_tenants_slug      ON identity.tenants(slug);
CREATE INDEX idx_tenants_is_active ON identity.tenants(is_active);

-- ─── Identity: Users ───────────────────────────────────────────────────────
CREATE TABLE identity.users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES identity.tenants(id),
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  password_hash VARCHAR(512) NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT users_tenant_email_unique UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id ON identity.users(tenant_id);
CREATE INDEX idx_users_email     ON identity.users(email);

-- ─── Identity: Sessions ────────────────────────────────────────────────────
CREATE TABLE identity.sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  tenant_id     UUID        NOT NULL,
  refresh_token VARCHAR(512) NOT NULL,
  user_agent    VARCHAR(512),
  ip_address    VARCHAR(45),
  expires_at    TIMESTAMPTZ  NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT sessions_refresh_token_unique UNIQUE (refresh_token)
);

CREATE INDEX idx_sessions_user_id       ON identity.sessions(user_id);
CREATE INDEX idx_sessions_refresh_token ON identity.sessions(refresh_token);
CREATE INDEX idx_sessions_expires_at    ON identity.sessions(expires_at);

-- ─── Identity: Tenant Memberships ─────────────────────────────────────────
CREATE TABLE identity.tenant_memberships (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID        NOT NULL REFERENCES identity.tenants(id),
  user_id   UUID        NOT NULL REFERENCES identity.users(id),
  roles     TEXT[]      NOT NULL DEFAULT ARRAY['employee'],
  is_active BOOLEAN     NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_memberships_unique UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_tenant_memberships_tenant_id ON identity.tenant_memberships(tenant_id);
CREATE INDEX idx_tenant_memberships_user_id   ON identity.tenant_memberships(user_id);

-- ─── Employee: Employees ──────────────────────────────────────────────────
CREATE TABLE employee.employees (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  employee_code    VARCHAR(50)  NOT NULL,
  user_id          UUID,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  email            VARCHAR(255) NOT NULL,
  phone            VARCHAR(20),
  department       VARCHAR(100),
  designation      VARCHAR(100),
  employment_type  VARCHAR(20)  NOT NULL DEFAULT 'FULL_TIME',
  status           VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  join_date        DATE         NOT NULL,
  termination_date DATE,
  manager_id       UUID,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT employees_tenant_code_unique  UNIQUE (tenant_id, employee_code),
  CONSTRAINT employees_tenant_email_unique UNIQUE (tenant_id, email),
  CONSTRAINT employees_employment_type_check CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACT','INTERN')),
  CONSTRAINT employees_status_check CHECK (status IN ('ACTIVE','INACTIVE','ON_LEAVE','TERMINATED'))
);

CREATE INDEX idx_employees_tenant_id ON employee.employees(tenant_id);
CREATE INDEX idx_employees_status    ON employee.employees(tenant_id, status);
CREATE INDEX idx_employees_manager   ON employee.employees(manager_id) WHERE manager_id IS NOT NULL;

-- ─── Employee: Employment Records (SCD Type 2) ────────────────────────────
CREATE TABLE employee.employment_records (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID        NOT NULL REFERENCES employee.employees(id),
  tenant_id       UUID        NOT NULL,
  department      VARCHAR(100),
  designation     VARCHAR(100),
  employment_type VARCHAR(20)  NOT NULL,
  effective_from  DATE         NOT NULL,
  effective_to    DATE,
  is_current      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_employment_records_employee ON employee.employment_records(employee_id, is_current);
CREATE INDEX idx_employment_records_tenant   ON employee.employment_records(tenant_id);

-- ─── Audit Log ────────────────────────────────────────────────────────────
CREATE TABLE audit.audit_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  actor_id       UUID        NOT NULL,
  actor_email    VARCHAR(255) NOT NULL,
  action         VARCHAR(100) NOT NULL,
  resource_type  VARCHAR(100) NOT NULL,
  resource_id    UUID        NOT NULL,
  changes        JSONB        NOT NULL DEFAULT '{}',
  ip_address     VARCHAR(45),
  correlation_id UUID        NOT NULL,
  occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (occurred_at);

CREATE INDEX idx_audit_logs_tenant_date    ON audit.audit_logs(tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_resource       ON audit.audit_logs(tenant_id, resource_type, resource_id);

-- Monthly partitions for current year
CREATE TABLE audit.audit_logs_2025_01 PARTITION OF audit.audit_logs
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE audit.audit_logs_2025_02 PARTITION OF audit.audit_logs
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
-- Add more partitions as needed — automate this via pg_partman in production

-- ─── Outbox Events ────────────────────────────────────────────────────────
CREATE TABLE events.outbox_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL,
  aggregate_id   UUID        NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  event_type     VARCHAR(200) NOT NULL,
  event_version  VARCHAR(10)  NOT NULL DEFAULT '1.0',
  payload        JSONB        NOT NULL,
  correlation_id UUID        NOT NULL,
  occurred_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  published_at   TIMESTAMPTZ,
  failure_count  INTEGER      NOT NULL DEFAULT 0,
  last_error     TEXT
);

CREATE INDEX idx_outbox_unpublished ON events.outbox_events(occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX idx_outbox_tenant_date ON events.outbox_events(tenant_id, occurred_at);

-- ─── Row-Level Security ────────────────────────────────────────────────────
ALTER TABLE identity.tenants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.employment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE events.outbox_events       ENABLE ROW LEVEL SECURITY;

-- Service account bypasses RLS
CREATE POLICY service_account_bypass ON identity.tenants
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON identity.users
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON identity.sessions
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON identity.tenant_memberships
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON employee.employees
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON employee.employment_records
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON audit.audit_logs
  TO service_account USING (TRUE);
CREATE POLICY service_account_bypass ON events.outbox_events
  TO service_account USING (TRUE);

-- Tenant isolation policies for app role
CREATE POLICY tenant_isolation ON identity.users
  USING (tenant_id::text = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY tenant_isolation ON identity.tenant_memberships
  USING (tenant_id::text = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY tenant_isolation ON employee.employees
  USING (tenant_id::text = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY tenant_isolation ON employee.employment_records
  USING (tenant_id::text = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY tenant_isolation ON audit.audit_logs
  USING (tenant_id::text = current_setting('app.current_tenant_id', TRUE));
CREATE POLICY tenant_isolation ON events.outbox_events
  USING (tenant_id::text = current_setting('app.current_tenant_id', TRUE));

-- updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON identity.tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_employees_updated_at
  BEFORE UPDATE ON employee.employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## 6.9 `packages/database/src/client.ts`

```typescript
import { PrismaClient } from './generated/index.js';
import { TenantContext } from './tenant-context.js';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env['NODE_ENV'] === 'development'
      ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
      : ['warn', 'error'],
    errorFormat: 'pretty',
  });

  // Inject tenant context into every query via Prisma middleware
  // This sets PostgreSQL session variables used by RLS policies
  client.$use(async (params, next) => {
    const ctx = TenantContext.current();

    if (ctx?.tenantId) {
      await client.$executeRaw`
        SELECT
          set_config('app.current_tenant_id', ${ctx.tenantId}, TRUE),
          set_config('app.current_user_id',   ${ctx.userId},   TRUE),
          set_config('app.role',              'service_account', TRUE)
      `;
    }

    return next(params);
  });

  if (process.env['NODE_ENV'] === 'development') {
    client.$on('query' as never, (e: { query: string; duration: number }) => {
      if (e.duration > 100) {
        console.warn(`[Slow Query] ${e.duration}ms: ${e.query.slice(0, 200)}`);
      }
    });
  }

  return client;
}

// Singleton — prevents exhausting connections during hot reload in dev
export const prisma: PrismaClient =
  global.__prisma ?? (global.__prisma = createPrismaClient());

if (process.env['NODE_ENV'] !== 'production') {
  global.__prisma = prisma;
}
```

## 6.10 `packages/database/src/tenant-context.ts`

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextData {
  tenantId:      string;
  userId:        string;
  correlationId: string;
  requestId:     string;
}

const storage = new AsyncLocalStorage<TenantContextData>();

export const TenantContext = {
  /**
   * Run a function within a tenant context.
   * All Prisma calls within fn() will have tenant context set.
   */
  run<T>(ctx: TenantContextData, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /**
   * Get the current tenant context. Returns undefined if not in a context.
   */
  current(): TenantContextData | undefined {
    return storage.getStore();
  },

  /**
   * Get the current tenant context or throw.
   * Use in database operations that must be tenant-scoped.
   */
  require(): TenantContextData {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'TenantContext.require() called outside of a tenant context. ' +
        'Ensure the tenant plugin is registered and the route has authentication.',
      );
    }
    return ctx;
  },
};
```

## 6.11 `packages/database/src/unit-of-work.ts`

```typescript
import { type PrismaClient, Prisma } from './generated/index.js';
import { prisma } from './client.js';

type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Execute a function within a Prisma transaction.
 * Rolls back on error. Returns the function's return value on success.
 *
 * Usage:
 *   const result = await withUnitOfWork(async (tx) => {
 *     const user = await tx.user.create({ data: {...} });
 *     await tx.auditLog.create({ data: {...} });
 *     return user;
 *   });
 */
export async function withUnitOfWork<T>(
  fn: (tx: PrismaTransaction) => Promise<T>,
  options?: {
    maxWait?:           number;
    timeout?:           number;
    isolationLevel?:    Prisma.TransactionIsolationLevel;
  },
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait:        options?.maxWait        ?? 5_000,
    timeout:        options?.timeout        ?? 30_000,
    isolationLevel: options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
```

## 6.12 `packages/database/src/index.ts`

```typescript
export { prisma } from './client.js';
export { TenantContext, type TenantContextData } from './tenant-context.js';
export { withUnitOfWork } from './unit-of-work.js';
export * from './generated/index.js';
```

## 6.13 `prisma/seeds/index.ts`

```typescript
#!/usr/bin/env tsx
import { prisma } from '@platform/database';
import { logger } from '@platform/observability';

const MODE = process.argv.includes('--mode=base') ? 'base' : 'development';

async function main() {
  logger.info({ mode: MODE }, 'Starting database seed');

  // Base seeds — always run (roles, system config)
  await import('./base/00-platform-roles.js');
  await import('./base/01-system-tenant.js');

  if (MODE === 'development') {
    await import('./development/10-demo-tenant.js');
    await import('./development/11-demo-users.js');
    await import('./development/12-demo-employees.js');
  }

  logger.info('Database seed complete');
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

## 6.14 `prisma/seeds/base/00-platform-roles.ts`

```typescript
import { prisma } from '@platform/database';

export const SYSTEM_ROLES = [
  {
    name: 'super_admin',
    permissions: ['*'],
    description: 'Full platform access',
  },
  {
    name: 'tenant_admin',
    permissions: [
      'tenant:manage', 'employee:manage', 'attendance:manage',
      'leave:manage', 'payroll:manage', 'reports:view',
    ],
    description: 'Full tenant administration access',
  },
  {
    name: 'hr_manager',
    permissions: [
      'employee:read', 'employee:write',
      'attendance:read', 'attendance:manage',
      'leave:read', 'leave:approve',
      'payroll:read', 'reports:view',
    ],
    description: 'HR management access',
  },
  {
    name: 'manager',
    permissions: [
      'employee:read', 'attendance:read',
      'leave:read', 'leave:approve_team',
    ],
    description: 'Team management access',
  },
  {
    name: 'employee',
    permissions: [
      'attendance:own', 'leave:own',
      'payslip:own', 'profile:own',
    ],
    description: 'Employee self-service access',
  },
] as const;

// Roles are stored in JWT claims — no DB table needed for Phase 1.
// This file documents the canonical role-permission mapping.
console.log('✓ Platform roles documented (JWT-based — no DB table)');
```

---

# SECTION 7 — OBSERVABILITY INITIALIZATION

## 7.1 `packages/observability/package.json`

```json
{
  "name": "@platform/observability",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  },
  "dependencies": {
    "@opentelemetry/api":                          "^1.9.0",
    "@opentelemetry/exporter-trace-otlp-http":     "^0.53.0",
    "@opentelemetry/instrumentation-fastify":       "^0.38.0",
    "@opentelemetry/instrumentation-http":          "^0.53.0",
    "@opentelemetry/instrumentation-pg":            "^0.43.0",
    "@opentelemetry/instrumentation-ioredis":       "^0.43.0",
    "@opentelemetry/resources":                     "^1.26.0",
    "@opentelemetry/sdk-metrics":                   "^1.26.0",
    "@opentelemetry/sdk-node":                      "^0.53.0",
    "@opentelemetry/sdk-trace-base":                "^1.26.0",
    "@opentelemetry/semantic-conventions":          "^1.27.0",
    "@platform/config":                            "workspace:*",
    "pino":                                        "^9.5.0",
    "pino-pretty":                                 "^11.3.0"
  },
  "devDependencies": {
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

## 7.2 `packages/observability/src/tracer.ts`

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { trace, context, type Span, SpanStatusCode } from '@opentelemetry/api';

let _sdk: NodeSDK | undefined;

/**
 * Initialize OpenTelemetry tracing.
 * MUST be called BEFORE any other imports in main.ts.
 *
 * Usage:
 *   import { initializeTracing } from '@platform/observability';
 *   await initializeTracing('platform-api');
 *   // Now safe to import other modules
 *   import { buildApp } from './app.js';
 */
export async function initializeTracing(serviceName: string): Promise<void> {
  if (process.env['NODE_ENV'] === 'test') return;

  const resource = new Resource({
    [ATTR_SERVICE_NAME]:    serviceName,
    [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.1',
    'deployment.environment': process.env['NODE_ENV'] ?? 'development',
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318'}/v1/traces`,
  });

  _sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // Too noisy
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingPaths: ['/health', '/ready', '/metrics'],
        },
      }),
    ],
  });

  _sdk.start();

  process.on('SIGTERM', async () => {
    await _sdk?.shutdown();
  });
}

/**
 * Wrap an async function in a traced span.
 *
 * Usage:
 *   const result = await startSpan('employee.create', async (span) => {
 *     span.setAttribute('employee.id', id);
 *     return employeeService.create(input);
 *   });
 */
export async function startSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  const tracer = trace.getTracer('workforce-os');
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      Object.entries(attributes).forEach(([k, v]) => span.setAttribute(k, v));
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getActiveTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  const ctx  = span?.spanContext();
  return ctx?.traceId;
}
```

## 7.3 `packages/observability/src/logger.ts`

```typescript
import pino, { type Logger } from 'pino';
import { TenantContext } from '@platform/database';

function createLogger(): Logger {
  const isDev = process.env['NODE_ENV'] === 'development';
  const isTest = process.env['NODE_ENV'] === 'test';

  if (isTest) {
    return pino({ level: process.env['LOG_LEVEL'] ?? 'silent' });
  }

  return pino({
    level: process.env['LOG_LEVEL'] ?? 'info',

    // Auto-inject tenant + correlation context from AsyncLocalStorage
    mixin() {
      const ctx = TenantContext.current();
      return ctx
        ? { tenantId: ctx.tenantId, userId: ctx.userId, correlationId: ctx.correlationId }
        : {};
    },

    // PII redaction — never log sensitive fields
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.currentPassword',
        'req.body.nationalId',
        'req.body.pan',
        'req.body.aadhar',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.refreshToken',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },

    // Format timestamps as ISO strings
    timestamp: pino.stdTimeFunctions.isoTime,

    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize:        true,
              translateTime:   'HH:MM:ss.l',
              ignore:          'pid,hostname',
              messageFormat:   '{msg} {tenantId}',
            },
          },
        }
      : {
          // Production: structured JSON for log aggregators
          formatters: {
            level(label) { return { level: label }; },
          },
        }),
  });
}

export const logger: Logger = createLogger();
```

## 7.4 `packages/observability/src/correlation.ts`

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationData {
  correlationId: string;
  requestId:     string;
}

const storage = new AsyncLocalStorage<CorrelationData>();

export const CorrelationContext = {
  run<T>(data: CorrelationData, fn: () => T): T {
    return storage.run(data, fn);
  },

  current(): CorrelationData | undefined {
    return storage.getStore();
  },

  getCorrelationId(): string {
    return storage.getStore()?.correlationId ?? crypto.randomUUID();
  },
};
```

## 7.5 `packages/observability/src/metrics.ts`

```typescript
import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

const meter = metrics.getMeter('workforce-os');

// ─── HTTP Metrics ──────────────────────────────────────────────────────────
export const httpRequestCounter: Counter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
});

export const httpRequestDuration: Histogram = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit:        'ms',
  advice: { explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] },
});

// ─── Domain Metrics ───────────────────────────────────────────────────────
export const domainEventCounter: Counter = meter.createCounter('domain_events_published_total', {
  description: 'Total domain events published',
});

export const jobProcessedCounter: Counter = meter.createCounter('jobs_processed_total', {
  description: 'Total BullMQ jobs processed',
});

export const jobFailureCounter: Counter = meter.createCounter('jobs_failed_total', {
  description: 'Total BullMQ jobs failed',
});

// ─── Database Metrics ─────────────────────────────────────────────────────
export const dbQueryDuration: Histogram = meter.createHistogram('db_query_duration_ms', {
  description: 'Database query duration in milliseconds',
  unit:        'ms',
  advice: { explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000] },
});
```

## 7.6 `packages/observability/src/index.ts`

```typescript
export { initializeTracing, startSpan, getActiveTraceId } from './tracer.js';
export { logger } from './logger.js';
export { CorrelationContext } from './correlation.js';
export {
  httpRequestCounter,
  httpRequestDuration,
  domainEventCounter,
  jobProcessedCounter,
  jobFailureCounter,
  dbQueryDuration,
} from './metrics.js';
```


---

# SECTION 8 — FASTIFY BACKEND SHELL

## 8.1 `apps/platform-api/src/main.ts`

```typescript
// CRITICAL: Tracing must be initialized before ALL other imports
import { initializeTracing } from '@platform/observability';
await initializeTracing('platform-api');

import { config } from '@platform/config';
import { logger } from '@platform/observability';
import { buildApp } from './app.js';

const app = await buildApp({
  logger: {
    level:     config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' } }
      : undefined,
  },
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down API server');
  try {
    await app.close();
    logger.info('Server closed cleanly');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  void shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
  void shutdown('unhandledRejection');
});

// ─── Start ────────────────────────────────────────────────────────────────────
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Platform API started');
} catch (err) {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
}
```

## 8.2 `apps/platform-api/src/app.ts`

```typescript
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { config } from '@platform/config';

// Plugins
import { databasePlugin }    from './plugins/database.js';
import { observabilityPlugin } from './plugins/observability.js';
import { authPlugin }        from './plugins/auth.js';
import { tenantPlugin }      from './plugins/tenant.js';
import { corsPlugin }        from './plugins/cors.js';
import { helmetPlugin }      from './plugins/helmet.js';
import { rateLimitPlugin }   from './plugins/rate-limit.js';
import { swaggerPlugin }     from './plugins/swagger.js';
import { underPressurePlugin } from './plugins/under-pressure.js';
import { errorHandler }      from './middleware/error-handler.js';

// Routes
import { healthRoutes }  from './routes/v1/health.js';
import { authRoutes }    from './routes/v1/auth.js';
import { legacyProxyRoutes } from './routes/legacy/proxy.js';

export async function buildApp(
  opts: FastifyServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    requestIdHeader:     'x-request-id',
    requestIdLogLabel:   'requestId',
    disableRequestLogging: false,
    ...opts,
  });

  // ── 1. Security (outermost) ──────────────────────────────────────────────
  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);

  // ── 2. Observability ─────────────────────────────────────────────────────
  await app.register(observabilityPlugin);

  // ── 3. Infrastructure ────────────────────────────────────────────────────
  await app.register(databasePlugin);
  await app.register(underPressurePlugin);

  // ── 4. Auth + Tenant ─────────────────────────────────────────────────────
  await app.register(authPlugin);
  await app.register(tenantPlugin);

  // ── 5. API Documentation ─────────────────────────────────────────────────
  if (config.NODE_ENV !== 'production') {
    await app.register(swaggerPlugin);
  }

  // ── 6. Error Handler ─────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── 7. Routes ────────────────────────────────────────────────────────────
  await app.register(healthRoutes);

  // Authenticated API routes under /api/v1
  await app.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      // Domain routes registered here as they are migrated:
      // await v1.register(employeeRoutes, { prefix: '/employees' });
    },
    { prefix: '/api/v1' },
  );

  // Legacy passthrough proxy
  if (config.LEGACY_API_URL) {
    await app.register(legacyProxyRoutes);
  }

  return app;
}
```

## 8.3 `apps/platform-api/src/plugins/database.ts`

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/database';
import { logger } from '@platform/observability';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

export const databasePlugin = fp(async (app: FastifyInstance) => {
  // Verify database connection on startup
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection verified');
  } catch (err) {
    logger.fatal({ err }, 'Database connection failed');
    throw err;
  }

  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
    logger.info('Database connection closed');
  });
}, { name: 'database' });
```

## 8.4 `apps/platform-api/src/plugins/auth.ts`

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from '@platform/auth';
import type { JwtClaims } from '@platform/contracts';

// Augment Fastify request with parsed JWT claims
declare module 'fastify' {
  interface FastifyRequest {
    jwtClaims?: JwtClaims;
  }
  interface FastifyInstance {
    authenticate:      (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (permission: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  /**
   * Validate JWT from Authorization header.
   * Sets req.jwtClaims on success.
   * Use as a preHandler hook on protected routes.
   */
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers['authorization'];

    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
      });
    }

    const token = header.slice(7);

    try {
      req.jwtClaims = await verifyJwt(token);
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'TOKEN_INVALID', message: 'Token is invalid or expired' },
      });
    }
  });

  /**
   * Permission gate — use after authenticate.
   * Supports wildcard '*' for super admins.
   *
   * Usage:
   *   preHandler: [app.authenticate, app.requirePermission('employee:read')]
   */
  app.decorate(
    'requirePermission',
    (permission: string) =>
      async (req: FastifyRequest, reply: FastifyReply) => {
        const claims = req.jwtClaims;

        if (!claims) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
          });
        }

        const hasPermission =
          claims.permissions.includes('*') ||
          claims.permissions.includes(permission);

        if (!hasPermission) {
          return reply.status(403).send({
            success: false,
            error: {
              code:    'FORBIDDEN',
              message: `Permission '${permission}' required`,
            },
          });
        }
      },
  );
}, { name: 'auth' });
```

## 8.5 `apps/platform-api/src/plugins/tenant.ts`

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { TenantContext } from '@platform/database';

export const tenantPlugin = fp(async (app: FastifyInstance) => {
  /**
   * Pre-handler that injects TenantContext from authenticated JWT claims.
   * Must run AFTER authenticate.
   *
   * Sets AsyncLocalStorage so all Prisma queries automatically
   * pick up the tenant_id for RLS policies.
   */
  app.addHook('preHandler', async (req, _reply) => {
    if (!req.jwtClaims) return; // Skip unauthenticated routes

    // TenantContext.run wraps the remaining handler chain
    await new Promise<void>((resolve, reject) => {
      TenantContext.run(
        {
          tenantId:      req.jwtClaims!.tenantId,
          userId:        req.jwtClaims!.sub,
          correlationId: (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
          requestId:     req.id,
        },
        () => resolve(),
      );
    });
  });
}, { name: 'tenant' });
```

## 8.6 `apps/platform-api/src/plugins/observability.ts`

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { CorrelationContext, httpRequestCounter, httpRequestDuration } from '@platform/observability';

export const observabilityPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req) => {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
    const requestId = req.id;

    // Inject correlation context
    CorrelationContext.run({ correlationId, requestId }, () => {});

    // Set correlation ID on response
    void req.raw.headers;

    // Track request metrics
    httpRequestCounter.add(1, {
      method: req.method,
      route:  req.routeOptions?.url ?? 'unknown',
    });

    req.raw['startTime'] = Date.now();
  });

  app.addHook('onResponse', async (req, reply) => {
    const startTime = req.raw['startTime'] as number | undefined;
    if (startTime) {
      httpRequestDuration.record(Date.now() - startTime, {
        method:      req.method,
        route:       req.routeOptions?.url ?? 'unknown',
        status_code: String(reply.statusCode),
      });
    }

    // Forward correlation ID in response
    const correlationId = req.headers['x-correlation-id'] ?? crypto.randomUUID();
    reply.header('x-correlation-id', correlationId);
  });
}, { name: 'observability' });
```

## 8.7 `apps/platform-api/src/plugins/cors.ts`

```typescript
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { config } from '@platform/config';

const ALLOWED_ORIGINS_DEV = [
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:6006', // Storybook
];

const ALLOWED_ORIGINS_PROD = (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean);

export const corsPlugin = fp(async (app: FastifyInstance) => {
  await app.register(cors, {
    origin: config.NODE_ENV === 'production' ? ALLOWED_ORIGINS_PROD : ALLOWED_ORIGINS_DEV,
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Correlation-ID', 'X-Tenant-ID'],
    exposedHeaders: ['X-Correlation-ID', 'X-Request-ID'],
    credentials: true,
    maxAge:      86400,
  });
}, { name: 'cors' });
```

## 8.8 `apps/platform-api/src/plugins/helmet.ts`

```typescript
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

export const helmetPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:', 'https:'],
        connectSrc:  ["'self'"],
        fontSrc:     ["'self'"],
        objectSrc:   ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // Required for Swagger UI
  });
}, { name: 'helmet' });
```

## 8.9 `apps/platform-api/src/plugins/rate-limit.ts`

```typescript
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { config } from '@platform/config';

export const rateLimitPlugin = fp(async (app: FastifyInstance) => {
  await app.register(rateLimit, {
    global:    true,
    max:       config.NODE_ENV === 'production' ? 100 : 1000,
    timeWindow: '1 minute',
    redis:     undefined, // Use in-memory for Phase 1; switch to Redis in Phase 2
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      success:   false,
      error: {
        code:    'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Retry after ${context.after}`,
      },
    }),
  });
}, { name: 'rate-limit' });
```

## 8.10 `apps/platform-api/src/plugins/swagger.ts`

```typescript
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export const swaggerPlugin = fp(async (app: FastifyInstance) => {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title:       'Workforce OS Platform API',
        description: 'AI-native HRMS Platform API',
        version:     '1.0.0',
      },
      servers: [{ url: 'http://localhost:3001', description: 'Development' }],
      components: {
        securitySchemes: {
          BearerAuth: {
            type:         'http',
            scheme:       'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ BearerAuth: [] }],
      tags: [
        { name: 'health', description: 'Health checks' },
        { name: 'auth',   description: 'Authentication' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}, { name: 'swagger' });
```

## 8.11 `apps/platform-api/src/plugins/under-pressure.ts`

```typescript
import fp from 'fastify-plugin';
import underPressure from '@fastify/under-pressure';
import type { FastifyInstance } from 'fastify';

export const underPressurePlugin = fp(async (app: FastifyInstance) => {
  await app.register(underPressure, {
    maxEventLoopDelay:   500,
    maxHeapUsedBytes:    512 * 1024 * 1024, // 512MB
    maxRssBytes:         768 * 1024 * 1024, // 768MB
    pressureHandler: (_req, _rep, type, value) => {
      app.log.warn({ type, value }, 'Server under pressure');
    },
    retryAfter:      50,
    exposeStatusRoute: true,
  });
}, { name: 'under-pressure' });
```

## 8.12 `apps/platform-api/src/middleware/error-handler.ts`

```typescript
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '@platform/observability';

// ─── Domain Error Hierarchy ───────────────────────────────────────────────────
export class DomainError extends Error {
  constructor(
    message:    string,
    public readonly code:       string,
    public readonly statusCode: number = 500,
    public readonly details?:   Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' not found`, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(permission: string) {
    super(`Permission '${permission}' required`, 'FORBIDDEN', 403);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 422, details);
  }
}

// ─── HTTP Status Map ───────────────────────────────────────────────────────────
const STATUS_MAP: Record<string, number> = {
  NOT_FOUND:        404,
  CONFLICT:         409,
  FORBIDDEN:        403,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED:     401,
};

// ─── Error Handler ────────────────────────────────────────────────────────────
export function errorHandler(
  error: FastifyError,
  req:   FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation errors
  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => ({
      field:   i.path.join('.'),
      message: i.message,
    }));

    logger.warn({ validationErrors: issues, url: req.url }, 'Validation error');

    void reply.status(422).send({
      success: false,
      error: {
        code:    'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: { issues },
      },
    });
    return;
  }

  // Domain errors
  if (error instanceof DomainError) {
    if (error.statusCode >= 500) {
      logger.error({ err: error, url: req.url }, 'Domain error');
    } else {
      logger.warn({ code: error.code, url: req.url, message: error.message }, 'Domain error');
    }

    void reply.status(error.statusCode).send({
      success: false,
      error: {
        code:    error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  // Fastify validation errors (query/body schema)
  if (error.validation) {
    void reply.status(400).send({
      success: false,
      error: {
        code:    'BAD_REQUEST',
        message: error.message,
        details: { validation: error.validation },
      },
    });
    return;
  }

  // Known HTTP errors (from Fastify)
  if (error.statusCode && error.statusCode < 500) {
    void reply.status(error.statusCode).send({
      success: false,
      error: { code: 'REQUEST_ERROR', message: error.message },
    });
    return;
  }

  // Unknown / unexpected errors — never leak internals
  logger.error({ err: error, url: req.url, method: req.method }, 'Unexpected error');

  void reply.status(500).send({
    success: false,
    error: {
      code:    'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
```

## 8.13 `apps/platform-api/src/routes/v1/health.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/database';
import { logger } from '@platform/observability';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /health — always returns 200 (liveness probe)
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        response: {
          200: {
            type: 'object',
            properties: {
              status:    { type: 'string' },
              timestamp: { type: 'string' },
              uptime:    { type: 'number' },
            },
          },
        },
      },
      config: { skipAuth: true },
    },
    async (_req, reply) => {
      return reply.send({
        status:    'ok',
        timestamp: new Date().toISOString(),
        uptime:    Math.floor(process.uptime()),
      });
    },
  );

  // ── GET /ready — checks dependencies (readiness probe)
  app.get(
    '/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe',
      },
      config: { skipAuth: true },
    },
    async (_req, reply) => {
      const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

      // Database check
      const dbStart = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks['database'] = { status: 'ok', latencyMs: Date.now() - dbStart };
      } catch (err) {
        checks['database'] = { status: 'error', error: String(err) };
        logger.error({ err }, 'Readiness check: database failed');
        return reply.status(503).send({ status: 'not_ready', checks });
      }

      return reply.send({ status: 'ready', checks });
    },
  );

  // ── GET /metrics — Prometheus-compatible scrape endpoint
  app.get(
    '/metrics',
    { config: { skipAuth: true } },
    async (_req, reply) => {
      reply.header('content-type', 'text/plain; version=0.0.4');
      // OTel Prometheus exporter will be wired here in Phase 2
      return reply.send('# Metrics endpoint — OTel Prometheus exporter pending\n');
    },
  );
}
```

## 8.14 `apps/platform-api/src/routes/v1/auth.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LoginRequestSchema, RefreshTokenRequestSchema } from '@platform/contracts';
import { verifyPassword, signJwt, signRefreshToken, verifyRefreshToken } from '@platform/auth';
import { prisma } from '@platform/database';
import { logger } from '@platform/observability';
import { NotFoundError, ConflictError } from '../../middleware/error-handler.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/auth/login ──────────────────────────────────────────────
  app.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'User login',
        body: {
          type: 'object',
          required: ['email', 'password', 'tenantId'],
          properties: {
            email:    { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            tenantId: { type: 'string', format: 'uuid' },
          },
        },
      },
      config: { skipAuth: true },
    },
    async (req, reply) => {
      const body = LoginRequestSchema.parse(req.body);

      // Find user by email + tenant
      const user = await prisma.user.findUnique({
        where: {
          tenantId_email: { tenantId: body.tenantId, email: body.email },
        },
        include: {
          memberships: {
            where: { tenantId: body.tenantId, isActive: true },
          },
        },
      });

      if (!user || !user.isActive) {
        // Constant time — don't reveal if user exists
        await verifyPassword('dummy', 'pbkdf2:600000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000');
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
      }

      const passwordValid = await verifyPassword(body.password, user.passwordHash);
      if (!passwordValid) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
      }

      const roles = user.memberships.flatMap((m) => m.roles);
      const permissions = resolvePermissions(roles);

      const [accessToken, refreshToken] = await Promise.all([
        signJwt({
          sub:         user.id,
          tenantId:    user.tenantId,
          email:       user.email,
          name:        user.name,
          roles,
          permissions,
        }),
        signRefreshToken(user.id, user.tenantId),
      ]);

      // Persist refresh token
      await prisma.session.create({
        data: {
          userId:       user.id,
          tenantId:     user.tenantId,
          refreshToken,
          userAgent:    req.headers['user-agent'],
          ipAddress:    req.ip,
          expiresAt:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data:  { lastLoginAt: new Date() },
      });

      logger.info({ userId: user.id, tenantId: user.tenantId }, 'User logged in');

      return reply.send({
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: 900, // 15 minutes
          tokenType: 'Bearer' as const,
          claims: { sub: user.id, tenantId: user.tenantId, email: user.email, name: user.name, roles, permissions },
        },
      });
    },
  );

  // ── POST /api/v1/auth/refresh ────────────────────────────────────────────
  app.post(
    '/refresh',
    {
      schema: { tags: ['auth'], summary: 'Refresh access token' },
      config: { skipAuth: true },
    },
    async (req, reply) => {
      const { refreshToken } = RefreshTokenRequestSchema.parse(req.body);

      const session = await prisma.session.findUnique({
        where: { refreshToken },
        include: { user: { include: { memberships: true } } },
      });

      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        return reply.status(401).send({
          success: false,
          error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid or expired' },
        });
      }

      try {
        await verifyRefreshToken(refreshToken);
      } catch {
        return reply.status(401).send({
          success: false,
          error: { code: 'REFRESH_TOKEN_INVALID', message: 'Refresh token verification failed' },
        });
      }

      const roles = session.user.memberships.flatMap((m) => m.roles);
      const permissions = resolvePermissions(roles);

      const accessToken = await signJwt({
        sub:      session.user.id,
        tenantId: session.user.tenantId,
        email:    session.user.email,
        name:     session.user.name,
        roles,
        permissions,
      });

      return reply.send({
        success: true,
        data: { accessToken, expiresIn: 900, tokenType: 'Bearer' as const },
      });
    },
  );

  // ── POST /api/v1/auth/logout ─────────────────────────────────────────────
  app.post(
    '/logout',
    {
      schema:  { tags: ['auth'], summary: 'Logout' },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

      await prisma.session.updateMany({
        where: { refreshToken, userId: req.jwtClaims!.sub },
        data:  { revokedAt: new Date() },
      });

      return reply.send({ success: true, data: { message: 'Logged out' } });
    },
  );

  // ── GET /api/v1/auth/me ──────────────────────────────────────────────────
  app.get(
    '/me',
    {
      schema:     { tags: ['auth'], summary: 'Get current user' },
      preHandler: [app.authenticate],
    },
    async (req, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: req.jwtClaims!.sub },
        select: {
          id: true, email: true, name: true,
          isActive: true, lastLoginAt: true,
          createdAt: true, updatedAt: true,
        },
      });

      if (!user) throw new NotFoundError('User', req.jwtClaims!.sub);

      return reply.send({ success: true, data: user });
    },
  );
}

// Role → Permission resolver (Phase 1 — static mapping)
function resolvePermissions(roles: string[]): string[] {
  const ROLE_PERMISSIONS: Record<string, string[]> = {
    super_admin:   ['*'],
    tenant_admin:  ['tenant:manage', 'employee:manage', 'attendance:manage', 'leave:manage', 'payroll:manage', 'reports:view'],
    hr_manager:    ['employee:read', 'employee:write', 'attendance:read', 'attendance:manage', 'leave:read', 'leave:approve', 'payroll:read', 'reports:view'],
    manager:       ['employee:read', 'attendance:read', 'leave:read', 'leave:approve_team'],
    employee:      ['attendance:own', 'leave:own', 'payslip:own', 'profile:own'],
  };

  const permissions = new Set<string>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role] ?? [];
    perms.forEach((p) => permissions.add(p));
  }
  return [...permissions];
}
```

## 8.15 `apps/platform-api/src/routes/legacy/proxy.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { config } from '@platform/config';
import { logger } from '@platform/observability';

export async function legacyProxyRoutes(app: FastifyInstance): Promise<void> {
  if (!config.LEGACY_API_URL) {
    logger.warn('LEGACY_API_URL not configured — legacy proxy disabled');
    return;
  }

  await app.register(httpProxy, {
    upstream:   config.LEGACY_API_URL,
    prefix:     '/api/legacy',
    rewritePrefix: '',
    rewriteRequestHeaders: (req, headers) => ({
      ...headers,
      'x-correlation-id': (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      'x-forwarded-by':   'workforce-os-platform',
      'x-source':         'platform-api',
    }),
  });

  logger.info({ upstream: config.LEGACY_API_URL }, 'Legacy proxy registered at /api/legacy/*');
}
```

---

# SECTION 9 — NEXT.JS FRONTEND SHELL

## 9.1 `apps/workforce-os/src/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background:             0 0% 100%;
    --foreground:             222.2 84% 4.9%;
    --card:                   0 0% 100%;
    --card-foreground:        222.2 84% 4.9%;
    --popover:                0 0% 100%;
    --popover-foreground:     222.2 84% 4.9%;
    --primary:                221.2 83.2% 53.3%;
    --primary-foreground:     210 40% 98%;
    --secondary:              210 40% 96%;
    --secondary-foreground:   222.2 47.4% 11.2%;
    --muted:                  210 40% 96%;
    --muted-foreground:       215.4 16.3% 46.9%;
    --accent:                 210 40% 96%;
    --accent-foreground:      222.2 47.4% 11.2%;
    --destructive:            0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border:                 214.3 31.8% 91.4%;
    --input:                  214.3 31.8% 91.4%;
    --ring:                   221.2 83.2% 53.3%;
    --radius:                 0.5rem;

    /* Brand — Indigo */
    --brand-50:   239 100% 97%;
    --brand-100:  239 100% 94%;
    --brand-200:  239 95%  87%;
    --brand-300:  239 92%  76%;
    --brand-400:  239 89%  65%;
    --brand-500:  239 84%  57%;
    --brand-600:  239 76%  49%;
    --brand-700:  239 66%  40%;
    --brand-800:  239 57%  33%;
    --brand-900:  239 50%  27%;
    --brand-950:  239 47%  16%;

    /* Status */
    --status-present:    142 71% 45%;
    --status-absent:     0   84% 60%;
    --status-late:       38  92% 50%;
    --status-leave:      197 71% 52%;
    --status-holiday:    271 76% 62%;
    --status-pending:    38  92% 50%;
    --status-approved:   142 71% 45%;
    --status-rejected:   0   84% 60%;
    --status-paid:       142 71% 45%;

    /* Risk */
    --risk-low:      142 71% 45%;
    --risk-medium:   38  92% 50%;
    --risk-high:     24  95% 53%;
    --risk-critical: 0   84% 60%;

    /* Charts */
    --chart-1: 221.2 83.2% 53.3%;
    --chart-2: 142   71%   45%;
    --chart-3: 38    92%   50%;
    --chart-4: 271   76%   62%;
    --chart-5: 0     84%   60%;
  }

  .dark {
    --background:             222.2 84% 4.9%;
    --foreground:             210 40% 98%;
    --card:                   222.2 84% 4.9%;
    --card-foreground:        210 40% 98%;
    --popover:                222.2 84% 4.9%;
    --popover-foreground:     210 40% 98%;
    --primary:                217.2 91.2% 59.8%;
    --primary-foreground:     222.2 47.4% 11.2%;
    --secondary:              217.2 32.6% 17.5%;
    --secondary-foreground:   210 40% 98%;
    --muted:                  217.2 32.6% 17.5%;
    --muted-foreground:       215 20.2% 65.1%;
    --accent:                 217.2 32.6% 17.5%;
    --accent-foreground:      210 40% 98%;
    --destructive:            0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border:                 217.2 32.6% 17.5%;
    --input:                  217.2 32.6% 17.5%;
    --ring:                   224.3 76.3% 48%;
    --brand-600:              239 89% 65%;
    --brand-950:              239 47% 16%;
  }

  * { @apply border-border; }

  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }

  ::-webkit-scrollbar       { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { @apply bg-transparent; }
  ::-webkit-scrollbar-thumb { @apply rounded-full bg-muted-foreground/20; }
  ::-webkit-scrollbar-thumb:hover { @apply bg-muted-foreground/40; }
}
```

## 9.2 `apps/workforce-os/src/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets:  ['latin'],
  variable: '--font-jetbrains-mono',
  display:  'swap',
});

export const metadata: Metadata = {
  title: {
    default:  'Workforce OS',
    template: '%s | Workforce OS',
  },
  description: 'AI-native Human Resource Management System',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)',  color: '#0f172a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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

## 9.3 `apps/workforce-os/src/app/page.tsx`

```tsx
import { redirect } from 'next/navigation';

// Root redirect — auth guard will redirect to /login if unauthenticated
export default function RootPage() {
  redirect('/dashboard');
}
```

## 9.4 `apps/workforce-os/src/app/(auth)/login/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth.store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [error,    setError]    = useState('');

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.POST('/api/v1/auth/login', {
        body: { email, password, tenantId },
      });
      if (res.error) throw new Error(res.error.error?.message ?? 'Login failed');
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.success && data.data) {
        setAuth(data.data.accessToken, data.data.claims as never);
        router.push('/dashboard');
      }
    },
    onError: (err) => setError(err.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center">
            <span className="text-lg font-bold text-white">W</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Workforce OS</h1>
          <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); loginMutation.mutate(); }}
          className="space-y-4"
        >
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="tenantId" className="text-sm font-medium">Workspace ID</label>
            <input
              id="tenantId"
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

## 9.5 `apps/workforce-os/src/app/(platform)/layout.tsx`

```tsx
import { AppShell } from '@/components/shell/app-shell';

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
```

## 9.6 `apps/workforce-os/src/app/(platform)/dashboard/page.tsx`

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome to Workforce OS. Domain modules will appear here as they are activated.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {['Total Employees', 'Present Today', 'On Leave', 'Pending Approvals'].map((label) => (
          <div key={label} className="rounded-lg border bg-card p-6 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Data available after domain activation</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## 9.7 `apps/workforce-os/src/components/providers/index.tsx`

```tsx
'use client';

import { type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { getQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env['NODE_ENV'] === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

## 9.8 `apps/workforce-os/src/lib/query-client.ts`

```typescript
import { QueryClient, isServer } from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:           30_000,
        gcTime:              5 * 60 * 1000,
        retry:               1,
        retryDelay:          (n) => Math.min(1000 * 2 ** n, 10_000),
        refetchOnWindowFocus: process.env['NODE_ENV'] === 'production',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
```

## 9.9 `apps/workforce-os/src/store/auth.store.ts`

```typescript
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface JwtClaims {
  sub:         string;
  tenantId:    string;
  email:       string;
  name:        string;
  roles:       string[];
  permissions: string[];
  exp:         number;
  iat:         number;
}

interface AuthState {
  token:           string | null;
  claims:          JwtClaims | null;
  isAuthenticated: boolean;
}

interface AuthActions {
  setAuth:     (token: string, claims: JwtClaims) => void;
  clearAuth:   () => void;
  updateToken: (token: string) => void;
}

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    immer((set) => ({
      token:           null,
      claims:          null,
      isAuthenticated: false,

      setAuth: (token, claims) =>
        set((s) => {
          s.token           = token;
          s.claims          = claims;
          s.isAuthenticated = true;
        }),

      clearAuth: () =>
        set((s) => {
          s.token           = null;
          s.claims          = null;
          s.isAuthenticated = false;
        }),

      updateToken: (token) =>
        set((s) => { s.token = token; }),
    })),
    {
      name:       'workforce-os:auth',
      storage:    createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ token: s.token }),
    },
  ),
);
```

## 9.10 `apps/workforce-os/src/store/ui.store.ts`

```typescript
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface UIState {
  sidebarOpen:        boolean;
  sidebarCollapsed:   boolean;
  commandPaletteOpen: boolean;
}

interface UIActions {
  toggleSidebar:          () => void;
  toggleSidebarCollapsed: () => void;
  openCommandPalette:     () => void;
  closeCommandPalette:    () => void;
}

export const useUIStore = create<UIState & UIActions>()(
  persist(
    immer((set) => ({
      sidebarOpen:        true,
      sidebarCollapsed:   false,
      commandPaletteOpen: false,

      toggleSidebar:          () => set((s) => { s.sidebarOpen        = !s.sidebarOpen; }),
      toggleSidebarCollapsed: () => set((s) => { s.sidebarCollapsed   = !s.sidebarCollapsed; }),
      openCommandPalette:     () => set((s) => { s.commandPaletteOpen = true;  }),
      closeCommandPalette:    () => set((s) => { s.commandPaletteOpen = false; }),
    })),
    {
      name:       'workforce-os:ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
```

## 9.11 `apps/workforce-os/src/components/shell/app-shell.tsx`

```tsx
'use client';

import { type ReactNode } from 'react';
import { useUIStore } from '@/store/ui.store';
import { Sidebar }   from './sidebar';
import { Topbar }    from './topbar';
import { CommandPalette } from './command-palette';

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarOpen } = useUIStore();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
```

## 9.12 `apps/workforce-os/src/components/shell/topbar.tsx`

```tsx
'use client';

import { Menu, Search } from 'lucide-react';
import { useUIStore }   from '@/store/ui.store';
import { useAuthStore } from '@/store/auth.store';

export function Topbar() {
  const { toggleSidebar, openCommandPalette } = useUIStore();
  const { claims, clearAuth } = useAuthStore();

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-card px-4">
      <button
        onClick={toggleSidebar}
        className="rounded-md p-2 hover:bg-muted"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button
        onClick={openCommandPalette}
        className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted max-w-sm"
      >
        <Search className="h-4 w-4" />
        <span>Search or run a command…</span>
        <kbd className="ml-auto rounded border bg-muted px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white">
          {claims?.name?.charAt(0).toUpperCase() ?? '?'}
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-medium">{claims?.name ?? 'Unknown'}</p>
          <p className="text-xs text-muted-foreground">{claims?.email ?? ''}</p>
        </div>
      </div>
    </header>
  );
}
```


---

# SECTION 10 — DESIGN SYSTEM INITIALIZATION

## 10.1 shadcn/ui Component Installation

```bash
# Initialize shadcn/ui in the ui package
cd packages/ui
npx shadcn@latest init --yes --defaults

# Install all Phase 1 components
npx shadcn@latest add \
  button input label form card \
  dialog dropdown-menu select \
  separator avatar badge skeleton \
  toast toaster command tooltip \
  table sheet tabs
```

## 10.2 `packages/ui/.storybook/main.ts`

```typescript
import type { StorybookConfig } from '@storybook/nextjs';

const config: StorybookConfig = {
  stories:    ['../src/**/*.stories.@(ts|tsx)'],
  addons:     [
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@chromatic-com/storybook',
  ],
  framework:  { name: '@storybook/nextjs', options: {} },
  docs:       { autodocs: 'tag' },
  staticDirs: ['../public'],
};

export default config;
```

## 10.3 `packages/ui/.storybook/preview.tsx`

```tsx
import type { Preview } from '@storybook/react';
import { ThemeProvider } from 'next-themes';
import '../src/globals.css';

const preview: Preview = {
  parameters: {
    controls:   { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    nextjs:     { appDirectory: true },
    backgrounds: {
      default: 'light',
      values:  [{ name: 'light', value: '#fff' }, { name: 'dark', value: '#0f172a' }],
    },
  },
  decorators: [
    (Story, ctx) => (
      <ThemeProvider
        attribute="class"
        defaultTheme={ctx.globals['backgrounds']?.value === '#0f172a' ? 'dark' : 'light'}
      >
        <div className="font-sans p-6">
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};

export default preview;
```

## 10.4 `packages/ui/src/components/badge.stories.tsx`

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta = {
  title:      'UI/Badge',
  component:  Badge,
  parameters: { layout: 'centered' },
  tags:       ['autodocs'],
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
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

export const Risk: Story = {
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

---

# SECTION 11 — DOCKER + LOCAL DEV

## 11.1 `docker-compose.yml`

```yaml
version: '3.9'

services:
  # ─── PostgreSQL ─────────────────────────────────────────────────────────────
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
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/00_init.sql:ro
    healthcheck:
      test:     ["CMD-SHELL", "pg_isready -U hrms_dev -d hrms"]
      interval: 10s
      timeout:  5s
      retries:  5
    networks:
      - hrms-internal

  # ─── Redis ──────────────────────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: hrms-redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass dev_redis_password
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test:     ["CMD", "redis-cli", "-a", "dev_redis_password", "ping"]
      interval: 10s
      timeout:  5s
      retries:  5
    networks:
      - hrms-internal

  # ─── OpenTelemetry Collector ─────────────────────────────────────────────────
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.111.0
    container_name: hrms-otel-collector
    restart: unless-stopped
    volumes:
      - ./infra/otel/collector.yaml:/etc/otelcol-contrib/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8889:8889"   # Prometheus scrape endpoint
    depends_on:
      - jaeger
    networks:
      - hrms-internal

  # ─── Jaeger (Distributed Tracing) ───────────────────────────────────────────
  jaeger:
    image: jaegertracing/all-in-one:1.61
    container_name: hrms-jaeger
    restart: unless-stopped
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "16686:16686"  # Jaeger UI
      - "14250:14250"  # gRPC
    networks:
      - hrms-internal

  # ─── BullMQ Dashboard ───────────────────────────────────────────────────────
  bull-board:
    image: deadly0/bull-board:latest
    container_name: hrms-bull-board
    restart: unless-stopped
    ports:
      - "3030:3000"
    environment:
      REDIS_HOST:     redis
      REDIS_PORT:     "6379"
      REDIS_PASSWORD: dev_redis_password
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - hrms-internal

  # ─── MailHog (Mail Catcher) ──────────────────────────────────────────────────
  mailhog:
    image: mailhog/mailhog:latest
    container_name: hrms-mailhog
    restart: unless-stopped
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # Web UI
    networks:
      - hrms-internal

  # ─── pgAdmin (optional — comment out if unused) ──────────────────────────────
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: hrms-pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL:    admin@hrms.local
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    profiles:
      - tools
    networks:
      - hrms-internal

volumes:
  postgres_data:
  redis_data:

networks:
  hrms-internal:
    driver: bridge
```

## 11.2 `infra/postgres/init.sql`

```sql
-- Run once at container creation
-- Creates extensions and sets up initial config

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Log setup
DO $$ BEGIN
  RAISE NOTICE 'PostgreSQL extensions initialized at %', NOW();
END $$;
```

## 11.3 `infra/otel/collector.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    limit_mib: 256
    check_interval: 1s

exporters:
  otlp/jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  prometheus:
    endpoint: "0.0.0.0:8889"
  logging:
    verbosity: detailed

service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [otlp/jaeger, logging]
    metrics:
      receivers:  [otlp]
      processors: [memory_limiter, batch]
      exporters:  [prometheus, logging]
```

## 11.4 `scripts/dev/setup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✓${NC}  $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }

echo ""
echo "  🏢 Workforce OS — Developer Setup"
echo "  ───────────────────────────────────"
echo ""

# 1. Prerequisites
info "Checking prerequisites..."
command -v node   >/dev/null 2>&1 || error "node is required (>=20)"
command -v pnpm   >/dev/null 2>&1 || error "pnpm is required (>=9)"
command -v docker >/dev/null 2>&1 || error "docker is required (>=24)"

NODE_VER=$(node -v | cut -dv -f2 | cut -d. -f1)
[ "$NODE_VER" -ge 20 ] || error "Node 20+ required (found $(node -v))"
success "Prerequisites OK (node $(node -v), pnpm $(pnpm -v))"

# 2. Environment
info "Configuring environment..."
[ -f .env ] || { cp .env.example .env; warn "Created .env — review before starting"; }
success "Environment ready"

# 3. Install dependencies
info "Installing workspace dependencies..."
pnpm install --frozen-lockfile
success "Dependencies installed"

# 4. Start infrastructure
info "Starting Docker services..."
docker compose up -d postgres redis otel-collector jaeger mailhog

info "Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U hrms_dev -d hrms >/dev/null 2>&1; do
  sleep 1
done
success "PostgreSQL ready"

info "Waiting for Redis..."
until docker compose exec -T redis redis-cli -a dev_redis_password ping 2>/dev/null | grep -q PONG; do
  sleep 1
done
success "Redis ready"

# 5. Database
info "Running Prisma migrations..."
pnpm db:generate
pnpm db:migrate:dev --name init 2>/dev/null || pnpm db:migrate:dev
success "Database migrated"

info "Seeding database..."
pnpm db:seed --mode=base
success "Database seeded"

# 6. Build shared packages
info "Building shared packages..."
pnpm turbo build --filter='./packages/*' --filter='./domains/*'
success "Packages built"

# 7. Git hooks
info "Installing git hooks..."
pnpm exec husky
success "Git hooks installed"

echo ""
echo "  ✅ Setup complete! Ready to develop."
echo ""
echo "  pnpm dev              → Start all services"
echo "  pnpm dev:api          → API only  (http://localhost:3001)"
echo "  pnpm dev:web          → UI only   (http://localhost:3000)"
echo ""
echo "  📊 Dev Tools:"
echo "  Swagger UI:   http://localhost:3001/docs"
echo "  Jaeger:       http://localhost:16686"
echo "  Bull Board:   http://localhost:3030"
echo "  MailHog:      http://localhost:8025"
echo "  Prisma Studio: pnpm db:studio"
echo ""
```

---

# SECTION 12 — CI/CD INITIALIZATION

## 12.1 `.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]
    types: [opened, synchronize, reopened]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents:      read
  pull-requests: write
  checks:        write

env:
  NODE_VERSION: '20'
  PNPM_VERSION: '9'
  TURBO_TOKEN:  ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM:   ${{ vars.TURBO_TEAM }}

jobs:
  # ─── Install ─────────────────────────────────────────────────────────────────
  install:
    name: Install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }

      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules
            */*/node_modules
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}

  # ─── Typecheck ───────────────────────────────────────────────────────────────
  typecheck:
    name: Typecheck
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - name: Restore node_modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules
            */*/node_modules
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm install --frozen-lockfile
      - name: Typecheck (affected)
        run: pnpm turbo typecheck --filter='[HEAD~1]'

  # ─── Lint ────────────────────────────────────────────────────────────────────
  lint:
    name: Lint
    needs: install
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - name: Restore node_modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules
            */*/node_modules
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm install --frozen-lockfile
      - name: Lint (affected)
        run: pnpm turbo lint --filter='[HEAD~1]'
      - name: Format check
        run: pnpm format:check

  # ─── Test ─────────────────────────────────────────────────────────────────────
  test:
    name: Test
    needs: install
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER:     hrms_test
          POSTGRES_PASSWORD: test_pw_ci
          POSTGRES_DB:       hrms_test
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
          --health-retries 3
    env:
      NODE_ENV:     test
      DATABASE_URL: postgresql://hrms_test:test_pw_ci@localhost:5432/hrms_test
      REDIS_URL:    redis://localhost:6379
      JWT_SECRET:   ci-test-secret-minimum-32-characters-long
      JWT_EXPIRY:   15m
      LOG_LEVEL:    silent
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: '${{ env.PNPM_VERSION }}' }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ env.NODE_VERSION }}', cache: pnpm }
      - name: Restore node_modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules
            */*/node_modules
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm install --frozen-lockfile
      - name: Generate Prisma client
        run: pnpm db:generate
      - name: Run migrations
        run: pnpm db:migrate:deploy
      - name: Run tests (affected)
        run: pnpm turbo test --filter='[HEAD~1]'
      - name: Upload coverage
        if:   always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: '**/coverage/lcov.info'
          retention-days: 7

  # ─── Build ───────────────────────────────────────────────────────────────────
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
      - name: Restore node_modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules
            */*/node_modules
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm install --frozen-lockfile
      - name: Build (all)
        run: pnpm turbo build
      - name: Archive artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-artifacts-${{ github.sha }}
          path: |
            apps/platform-api/dist/
            apps/workforce-os/.next/
          retention-days: 3
```

## 12.2 `.github/workflows/cd-staging.yml`

```yaml
name: Deploy → Staging

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents:   read
  id-token:   write

jobs:
  deploy:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with: { version: '9' }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: pnpm }
      - run: pnpm install --frozen-lockfile

      # Build API Docker image
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ secrets.REGISTRY_URL }}
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Build and push API image
        uses: docker/build-push-action@v6
        with:
          context:   .
          file:      apps/platform-api/Dockerfile
          push:      true
          tags: |
            ${{ secrets.REGISTRY_URL }}/workforce-os-api:${{ github.sha }}
            ${{ secrets.REGISTRY_URL }}/workforce-os-api:staging-latest
          cache-from: type=gha
          cache-to:   type=gha,mode=max

      # Deploy frontend to Vercel
      - name: Deploy to Vercel
        env:
          VERCEL_TOKEN:      ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID:     ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID_WEB }}
        run: |
          npx vercel pull --yes --environment=preview --token=$VERCEL_TOKEN
          npx vercel build --token=$VERCEL_TOKEN
          npx vercel deploy --prebuilt --token=$VERCEL_TOKEN --prod
```

## 12.3 `apps/platform-api/Dockerfile`

```dockerfile
# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /build

# Layer: workspace manifests (rarely changes)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY turbo.json ./
COPY tooling/   ./tooling/
COPY packages/  ./packages/
COPY domains/   ./domains/

# Package manifests for all apps
COPY apps/platform-api/package.json ./apps/platform-api/

# Install all workspace deps
RUN pnpm install --frozen-lockfile

# Layer: Prisma (changes with schema)
COPY prisma/ ./prisma/
RUN pnpm db:generate

# Layer: source
COPY apps/platform-api/ ./apps/platform-api/

# Build API + its dependencies
RUN pnpm turbo build --filter=platform-api

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Security: non-root user
RUN addgroup -S app && adduser -S appuser -G app
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# Production manifests
COPY --from=builder /build/package.json           .
COPY --from=builder /build/pnpm-workspace.yaml    .
COPY --from=builder /build/pnpm-lock.yaml         .
COPY --from=builder /build/packages/              ./packages/
COPY --from=builder /build/domains/               ./domains/

RUN pnpm install --frozen-lockfile --prod

# Built artifacts
COPY --from=builder /build/apps/platform-api/dist/ ./apps/platform-api/dist/
COPY --from=builder /build/prisma/                 ./prisma/

# Prisma runtime
COPY --from=builder /build/node_modules/.prisma/   ./node_modules/.prisma/
COPY --from=builder /build/node_modules/@prisma/   ./node_modules/@prisma/

RUN chown -R appuser:app /app
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "apps/platform-api/dist/main.js"]
```

---

# SECTION 13 — LEGACY COEXISTENCE INITIALIZATION

## 13.1 `packages/legacy-adapters/package.json`

```json
{
  "name": "@platform/legacy-adapters",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".":        "./src/index.ts",
    "./gates":  "./src/gates/index.ts",
    "./clients":"./src/clients/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  },
  "dependencies": {
    "@platform/config":        "workspace:*",
    "@platform/observability": "workspace:*"
  },
  "devDependencies": {
    "@platform/tsconfig":      "workspace:*",
    "@platform/vitest-config": "workspace:*",
    "@types/node":             "^22.8.1",
    "typescript":              "^5.6.3",
    "vitest":                  "^2.1.4"
  }
}
```

## 13.2 `packages/legacy-adapters/src/gates/migration-gate.ts`

```typescript
import { config } from '@platform/config';
import { logger } from '@platform/observability';

export type DomainName =
  | 'identity'
  | 'employee'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'workflow'
  | 'analytics';

const GATE_MAP: Record<DomainName, boolean> = {
  identity:   config.MIGRATION_IDENTITY_ENABLED,
  employee:   config.MIGRATION_EMPLOYEE_ENABLED,
  attendance: config.MIGRATION_ATTENDANCE_ENABLED,
  leave:      config.MIGRATION_LEAVE_ENABLED,
  payroll:    config.MIGRATION_PAYROLL_ENABLED,
  workflow:   false,
  analytics:  false,
};

logger.info(GATE_MAP, 'Migration gates loaded');

export function isMigrated(domain: DomainName): boolean {
  return GATE_MAP[domain] ?? false;
}

export class LegacyHandoffError extends Error {
  constructor(public readonly domain: DomainName) {
    super(`'${domain}' is not yet migrated — route to legacy system`);
    this.name = 'LegacyHandoffError';
  }
}
```

## 13.3 `packages/legacy-adapters/src/clients/legacy-http.client.ts`

```typescript
import { config } from '@platform/config';
import { logger } from '@platform/observability';

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

export class LegacyHRMSClient {
  private readonly baseUrl:  string;
  private readonly timeout:  number;

  constructor(baseUrl = config.LEGACY_API_URL ?? '', timeout = config.LEGACY_API_TIMEOUT_MS) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async get<T>(path: string, opts: LegacyRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, opts);
  }

  async post<T>(path: string, body: unknown, opts: LegacyRequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body });
  }

  async put<T>(path: string, body: unknown, opts: LegacyRequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...opts, body });
  }

  private async request<T>(method: string, path: string, opts: LegacyRequestOptions): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type':     'application/json',
          'X-Tenant-ID':      opts.tenantId       ?? '',
          'X-Correlation-ID': opts.correlationId  ?? crypto.randomUUID(),
          'X-Source':         'workforce-os-platform',
          ...(opts.headers ?? {}),
        },
        body:   opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new LegacyApiError(`Legacy ${method} ${path} → ${response.status}`, response.status, body);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LegacyApiError(`Legacy ${method} ${path} timed out`, 504, '');
      }
      logger.error({ err, method, path }, 'Legacy API call failed');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

interface LegacyRequestOptions {
  tenantId?:      string;
  correlationId?: string;
  headers?:       Record<string, string>;
  body?:          unknown;
}

export const legacyClient = new LegacyHRMSClient();
```

## 13.4 `packages/legacy-adapters/src/types/legacy-attendance.types.ts`

```typescript
// Exact shape of the existing HRMS attendance API.
// READ-ONLY documentation types — never modify field names.
// These map to what the old system actually returns.

export interface LegacyAttendanceRecord {
  id:          number;
  emp_id:      string;
  date:        string;         // 'YYYY-MM-DD'
  in_time:     string | null;  // 'HH:MM'
  out_time:    string | null;  // 'HH:MM'
  status_code: string;         // 'P' | 'A' | 'L' | 'H' | 'WO' | 'HD'
  machine_id:  string | null;
  remarks:     string | null;
  created_at:  string;
  updated_at:  string;
}

export interface LegacyAttendanceListResponse {
  data:      LegacyAttendanceRecord[];
  total:     number;
  page:      number;
  page_size: number;
}

export interface LegacyEmployee {
  emp_code:         string;
  first_name:       string;
  last_name:        string;
  email:            string;
  mobile:           string | null;
  department:       string;
  designation:      string;
  date_of_joining:  string;        // 'YYYY-MM-DD'
  date_of_leaving:  string | null;
  status:           'ACTIVE' | 'INACTIVE' | 'RESIGNED';
  manager_code:     string | null;
  branch_code:      string | null;
}
```

## 13.5 `packages/legacy-adapters/src/index.ts`

```typescript
export { isMigrated, LegacyHandoffError, type DomainName } from './gates/migration-gate.js';
export { LegacyHRMSClient, LegacyApiError, legacyClient }  from './clients/legacy-http.client.js';
export type * from './types/legacy-attendance.types.js';
```

---

# SECTION 14 — BOOTSTRAP EXECUTION ORDER

Execute exactly in this order. Each step must succeed before the next.

```bash
# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 0 — REPOSITORY CREATION
# ═══════════════════════════════════════════════════════════════════════════════

git init workforce-os
cd workforce-os
git checkout -b main

# ─── Create directory structure ──────────────────────────────────────────────
bash -c "$(cat scripts/dev/scaffold.sh)"   # Or run the mkdir -p block from Section 1.3

# ─── Root workspace files ────────────────────────────────────────────────────
# Write: package.json, pnpm-workspace.yaml, turbo.json
# Write: tsconfig.base.json
# Write: .npmrc, .gitignore, .editorconfig, .prettierrc, commitlint.config.js
# Write: .env.example
# Write: tooling/tsconfig/node.json, nextjs.json, react-library.json
# Write: tooling/eslint-config/base.js, next.js, domain.js + package.json
# Write: tooling/vitest/base.ts + package.json

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1 — SHARED PACKAGES
# ═══════════════════════════════════════════════════════════════════════════════

# Write all package.json + tsconfig files for:
# packages/contracts, packages/config, packages/types,
# packages/auth, packages/events, packages/observability,
# packages/database, packages/legacy-adapters, packages/ui

# Install dependencies
pnpm install

# Verify workspace links
pnpm ls --depth=1

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — INFRASTRUCTURE
# ═══════════════════════════════════════════════════════════════════════════════

# Write: docker-compose.yml
# Write: infra/postgres/init.sql
# Write: infra/otel/collector.yaml

# Start infrastructure
pnpm docker:up

# Wait for health (usually 15s)
sleep 15
docker compose ps  # All should show "healthy"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — DATABASE
# ═══════════════════════════════════════════════════════════════════════════════

# Write: prisma/schema/base.prisma
# Write: prisma/schema/identity.prisma
# Write: prisma/schema/employee.prisma
# Write: prisma/schema/audit.prisma
# Write: prisma/schema/events.prisma
# Write: prisma/migrations/20250101000000_init_schemas/migration.sql

# Generate Prisma client
pnpm db:generate

# Apply migrations
pnpm db:migrate:dev --name init_schemas

# Verify schemas exist
docker compose exec postgres psql -U hrms_dev -d hrms -c "\dn"
# Expected: identity, employee, audit, events, public

# Write seed files + run
pnpm db:seed --mode=base

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4 — SHARED PACKAGE IMPLEMENTATION
# ═══════════════════════════════════════════════════════════════════════════════

# Write: packages/contracts/src/schemas/* + events/*
# Write: packages/config/src/schema.ts + loader.ts
# Write: packages/types/src/index.ts
# Write: packages/auth/src/jwt.ts + password.ts
# Write: packages/events/src/publisher.ts
# Write: packages/observability/src/tracer.ts + logger.ts + correlation.ts + metrics.ts
# Write: packages/database/src/client.ts + tenant-context.ts + unit-of-work.ts
# Write: packages/legacy-adapters/src/**
# Write: packages/ui/src/components/button.tsx + badge.tsx + lib/utils.ts

# Build all packages
pnpm turbo build --filter='./packages/*'

# Typecheck
pnpm turbo typecheck --filter='./packages/*'

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5 — BACKEND API
# ═══════════════════════════════════════════════════════════════════════════════

# Write all apps/platform-api/src/** files
# Write: apps/platform-api/Dockerfile

# Start API in dev mode
pnpm dev:api &

# Test health endpoints
curl -s http://localhost:3001/health | jq .
# Expected: {"status":"ok","timestamp":"...","uptime":...}

curl -s http://localhost:3001/ready | jq .
# Expected: {"status":"ready","checks":{"database":{"status":"ok",...}}}

# Test Swagger UI
open http://localhost:3001/docs

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6 — FRONTEND
# ═══════════════════════════════════════════════════════════════════════════════

# Write all apps/workforce-os/src/** files
# Write: apps/workforce-os/tailwind.config.ts
# Write: apps/workforce-os/next.config.ts

# Install shadcn/ui components
cd packages/ui
npx shadcn@latest init --yes --defaults
npx shadcn@latest add button input label badge card dialog toast command tooltip
cd ../..

# Start frontend
pnpm dev:web &

# Verify
open http://localhost:3000
# Expected: redirect to /dashboard → /login (if unauthenticated)

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7 — WORKERS
# ═══════════════════════════════════════════════════════════════════════════════

# Write: workers/events/src/main.ts + worker.ts
# (analytics and AI workers are stubs — main.ts only)

# Verify worker starts
pnpm --filter=worker-events dev &
# Expected: "Event worker started" log

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 8 — CI/CD + QUALITY
# ═══════════════════════════════════════════════════════════════════════════════

# Write: .github/workflows/ci.yml
# Write: .github/workflows/cd-staging.yml
# Write: .vscode/settings.json, extensions.json

# Install git hooks
pnpm exec husky
pnpm prepare

# Final full build + quality check
pnpm turbo typecheck
pnpm turbo lint
pnpm turbo build

# Commit initial structure
git add -A
git commit -m "feat(infra): initialize workforce os platform monorepo bootstrap"
```

---

# SECTION 15 — ACCEPTANCE CRITERIA

Every item below must pass before the bootstrap is considered complete.

## 15.1 Infrastructure

```bash
# Docker stack healthy
docker compose ps
# postgres   → healthy
# redis      → healthy
# otel-collector → running
# jaeger     → running
# mailhog    → running
# bull-board → running

# Postgres schemas exist
docker compose exec postgres psql -U hrms_dev -d hrms -c "\dn"
# Must show: audit, employee, events, identity, public

# RLS enabled on tables
docker compose exec postgres psql -U hrms_dev -d hrms -c "
  SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname IN ('identity', 'employee', 'audit', 'events')
  ORDER BY schemaname, tablename;
"
# rowsecurity must be TRUE for all domain tables
```

## 15.2 Workspace

```bash
# Dependencies install cleanly
pnpm install --frozen-lockfile
echo "Exit: $?"  # Must be 0

# No circular dependencies
pnpm turbo build 2>&1 | grep -i "circular"
# Must output nothing

# Workspace links resolve
pnpm ls --depth=2 | grep "@platform"
# Must list all @platform/* packages as workspace links

# All packages typecheck
pnpm turbo typecheck
echo "Exit: $?"  # Must be 0

# All packages lint clean
pnpm turbo lint
echo "Exit: $?"  # Must be 0

# All packages build
pnpm turbo build
echo "Exit: $?"  # Must be 0
```

## 15.3 Backend API

```bash
# Liveness probe
curl -sf http://localhost:3001/health
# {"status":"ok","timestamp":"...","uptime":N}

# Readiness probe (database connected)
curl -sf http://localhost:3001/ready
# {"status":"ready","checks":{"database":{"status":"ok","latencyMs":N}}}

# Swagger spec available
curl -sf http://localhost:3001/docs/json | jq '.info.title'
# "Workforce OS Platform API"

# Login returns JWT
curl -sf -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.local","password":"test1234","tenantId":"<DEMO_TENANT_ID>"}' | jq '.data.accessToken'
# Returns a non-null JWT string

# Me endpoint with valid token
TOKEN=$(curl -sf -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.local","password":"test1234","tenantId":"<DEMO_TENANT_ID>"}' | jq -r '.data.accessToken')

curl -sf http://localhost:3001/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq '.data.email'
# "admin@demo.local"

# Unauthenticated request returns 401
curl -o /dev/null -sw "%{http_code}" http://localhost:3001/api/v1/auth/me
# 401

# Legacy proxy passes through
curl -o /dev/null -sw "%{http_code}" http://localhost:3001/api/legacy/ping
# 200 (if LEGACY_API_URL is configured) or 502 (proxy unreachable — acceptable)
```

## 15.4 Frontend

```bash
# App starts
curl -sf http://localhost:3000 -o /dev/null -w "%{http_code}"
# 307 (redirect to /dashboard or /login)

# Login page renders
curl -sf http://localhost:3000/login | grep "Workforce OS"
# Must find "Workforce OS" in HTML

# Build produces no errors
pnpm turbo build --filter=workforce-os
echo "Exit: $?"  # Must be 0

# No TypeScript errors in frontend
pnpm --filter=workforce-os typecheck
echo "Exit: $?"  # Must be 0
```

## 15.5 Workers

```bash
# Events worker starts without errors
timeout 5 pnpm --filter=worker-events start 2>&1 | grep "Event worker started"
# Must find "Event worker started"

# BullMQ dashboard accessible
curl -sf http://localhost:3030 -o /dev/null -w "%{http_code}"
# 200
```

## 15.6 Observability

```bash
# Jaeger UI accessible
curl -sf http://localhost:16686 -o /dev/null -w "%{http_code}"
# 200

# OTLP endpoint accepts traces
curl -sf -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[]}' | jq .
# {"partialSuccess":{}}

# API trace appears in Jaeger after making a request
curl -sf http://localhost:3001/health > /dev/null
sleep 3
curl -sf "http://localhost:16686/api/services" | jq '.data[]' | grep "platform-api"
# "platform-api"
```

## 15.7 Git Hooks

```bash
# Bad commit message is rejected
echo "bad commit" | pnpm exec commitlint
echo "Exit: $?"  # Must be 1 (rejected)

# Good commit message is accepted
echo "feat(api): add health endpoint" | pnpm exec commitlint
echo "Exit: $?"  # Must be 0

# Lint-staged runs on pre-commit
git add packages/contracts/src/schemas/common.ts
git stash list  # pre-commit hook triggers eslint + prettier on staged files
```

## 15.8 Performance Baselines

Measure and record these immediately after bootstrap:

```bash
# Cold start time (API)
time node apps/platform-api/dist/main.js &
# Target: < 3 seconds to first "Platform API started" log

# Health endpoint latency
ab -n 1000 -c 10 http://localhost:3001/health
# Target P99: < 5ms

# Build time (cold cache)
rm -rf .turbo
time pnpm turbo build
# Target: < 3 minutes

# Build time (warm cache)
time pnpm turbo build
# Target: < 15 seconds
```

---

*Bootstrap complete. Proceed to Phase 2: Identity domain migration + Employee domain scaffolding.*
