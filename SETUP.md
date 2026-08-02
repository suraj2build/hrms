# HRMS — Sprint 1 Setup Guide

> **Scope:** this guide is for bootstrapping a **local development** environment
> against a fresh Supabase project. It is not a production deployment guide —
> for deploying the API (Railway) or web app (Vercel), running the migration
> catalog against production, or post-deploy verification, see
> [`docs/deployment-runbook.md`](docs/deployment-runbook.md).

## Prerequisites
- Node.js 20+
- npm 10+
- A Supabase project (free tier at supabase.com)

---

## Step 1 — Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a region close to India (e.g. ap-south-1 Mumbai)
3. Note down:
   - **Project URL**: `https://xxxx.supabase.co`
   - **Anon Key**: from Settings → API
   - **Service Role Key**: from Settings → API (keep secret!)
   - **JWT Secret**: from Settings → API → JWT Settings

---

## Step 2 — Run Database Migrations

> **Note:** `supabase/migrations/` now has 400+ files (the list below is only
> the original Sprint 1 foundation). For a full local bootstrap, run **every**
> file in `supabase/migrations/` in ascending numeric order, not just the
> seven listed here — the Supabase CLI (`supabase db push` against your
> project, or `supabase migration up` locally) will do this for you instead of
> pasting files one by one into the SQL Editor. A gap in the numbering is
> expected (see `supabase/migrations/README.md`) — skip missing numbers, don't
> try to fill them.

In Supabase Dashboard → SQL Editor, run each migration file in order (or use
the Supabase CLI to apply the full `supabase/migrations/` directory):

```
supabase/migrations/001_tenants.sql
supabase/migrations/002_profiles.sql
supabase/migrations/003_org_structure.sql
supabase/migrations/004_employees.sql
supabase/migrations/005_documents.sql
supabase/migrations/006_audit_logs.sql
supabase/migrations/007_rls_policies.sql
... (and every subsequent numbered file in supabase/migrations/)
```

Then create the Storage bucket:
- Dashboard → Storage → New Bucket
- Name: `documents`
- Public: **NO** (private)

---

## Step 3 — Configure Environment Variables

**Frontend** (`apps/web/.env`):
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3001
```

**API** (`apps/api/.env`):
```env
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret
```

---

## Step 4 — Install Dependencies & Run

```bash
# From hrms/ root
npm install

# Run both web (port 3000) + api (port 3001) together
npm run dev
```

Or run separately:
```bash
# Terminal 1 — Frontend
cd apps/web && npm run dev

# Terminal 2 — API
cd apps/api && npm run dev
```

---

## Step 5 — Enable Google OAuth (optional)

In Supabase Dashboard:
- Authentication → Providers → Google → Enable
- Add your Google OAuth credentials

---

## Verification Checklist

- [ ] `http://localhost:3000/signup` — Create company with 3-step wizard
- [ ] `http://localhost:3000/login` — Sign in
- [ ] `/dashboard` — See stat cards (will show 0 initially)
- [ ] `/employees` → Add Employee → 3-step form → appears in list
- [ ] `/organization` → Add Department → tree renders
- [ ] `/documents` → Upload document → appears in vault
- [ ] `/settings` → Company info + RBAC roles visible
- [ ] `http://localhost:3001/health` → `{"status":"ok"}`

---

## Tech Stack (per blueprint)

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| Server State | TanStack Query v5 |
| Client State | Zustand |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| API Gateway | Node.js + Fastify |
| Auth | Supabase Auth (JWT) |
| Database | Supabase PostgreSQL + RLS |
| Storage | Supabase Storage |
| Multi-tenancy | PostgreSQL Row-Level Security |
