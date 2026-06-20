# Demo tenant — setup

Stands up a real, pre-logged-in **Demo** tenant (no client-side resolver) so the
website demo shows the actual platform with real backend data.

## 1. Database
1. Point a Supabase project at this repo's schema (apply `supabase/migrations/`).
2. Run the seed in the SQL Editor (or `psql`):
   ```
   psql "$DATABASE_URL" -f supabase/seed-demo.sql
   ```
   It is **idempotent** — re-run any time to reset the demo data.
   - Creates tenant **Demo**, a pre-login admin (`demo@cognixhr.app` / `CognixDemo!1`),
     12 employees with org/compensation, attendance (30d), 2 payroll runs + payslips,
     leave balances/requests, recruitment pipeline, helpdesk tickets, assets.
   - If your Supabase/GoTrue version rejects the `auth.users` INSERT, create the user
     once via **Dashboard → Authentication → Add user** (auto-confirm), put its UID in
     place of `d0000000-…-0000000000a1`, drop the two `auth.*` INSERTs, and re-run.

## 2. API
Deploy `apps/api` (Render/Railway/Fly/VM) with the demo Supabase env
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.). Note its public URL.

## 3. Frontend (demo deployment)
Build/deploy `apps/web` with these env vars (do **not** set `VITE_DEMO_MODE`):
```
VITE_API_URL=https://<your-demo-api-url>
VITE_SUPABASE_URL=https://<demo-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<demo anon key>
VITE_DEMO_LOGIN=true
VITE_DEMO_EMAIL=demo@cognixhr.app
VITE_DEMO_PASSWORD=CognixDemo!1
```
`VITE_DEMO_LOGIN=true` makes the app auto-sign-in as the Demo tenant on load
(see `apps/web/src/App.tsx`), hitting the **real API** — every page shows seeded
data, no resolver shape-mismatch crashes.

## Keeping it clean
Re-running `seed-demo.sql` (e.g. a nightly cron / scheduled job) wipes visitor
changes and restores the demo to a known state.
