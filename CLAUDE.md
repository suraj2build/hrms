# Project memory — HRMS

## Brand: CognixHR (rebranded from "Emvora")

The product is **CognixHR**. The old name **Emvora** is retired — never use it in
any user-facing copy, title, email, marketing, or new code. If you find a stray
"Emvora"/"emvora", treat it as a bug and rename it.

- **Product name:** CognixHR (wordmark: `Cognix` + `HR`, where **HR** is rendered
  in brand teal). In JSX: `Cognix<span className="text-[#15B8A6]">HR</span>`
  (use `#2DD4BF` for HR on dark/navy backgrounds).
- **Tagline:** "Smarter Workforce. Stronger Future."
- **Descriptor:** "Saar HRMS application" (Saar = the vendor/company).
- **Logo:** `apps/web/src/components/brand/Logo.tsx` — `<Logo />` (mark + wordmark)
  and `<LogoMark />` (mark only). The mark is an open "C" ring cradling an
  H/person figure in a blue→teal gradient.
- **Brand colours:**
  - Royal blue `#2E6FE6` (exported as `BRAND_BLUE`)
  - Teal `#15B8A6` (exported as `BRAND_TEAL`; brighter `#2DD4BF` on dark)
  - Deep navy background for hero/showcase surfaces.

### Intentionally NOT renamed (functional identifiers, invisible to users)
- localStorage keys `emvora-owner-auth` (`apps/web/src/lib/supabase/ownerClient.ts`)
  and `emvora-uat-certification` (`UATCertification.tsx`) — renaming would log
  users out / drop saved state. Leave them unless doing a deliberate migration.
- The Resend test sender address `onboarding@resend.dev` (display name is
  "CognixHR"); real sender is overridden via the `EMAIL_FROM` env var.

## Tenant licensing — the contract HRMS depends on

Tenant licensing is owned by the **owner portal** (a separate deployment,
`cognix-owner.vercel.app`, which now also hosts the **CogniDesk** license flow).
The HRMS is a **pure consumer** — it never writes license state. The contract is
the shared `tenants` row:

- **`tenants.status`** drives access: `active` / `trial` allow use;
  `suspended` / `expired` / `cancelled` block writes.
- **`tenants.trial_ends_at`** ends a `trial` once past.

Enforcement lives in `apps/api/src/plugins/auth.ts` (the write-gate): on every
authenticated **write** (POST/PUT/PATCH/DELETE) except `/billing` and
`/support`, it reads `tenants.status` + `trial_ends_at` **fresh** (not from the
profile cache) and returns **402 SUBSCRIPTION_REQUIRED** when blocked. Reads stay
open so a lapsed tenant can still reach the billing page to recover.

Rules to avoid breaking this:
- HRMS must keep gating on **`tenants.status`** — don't couple it to
  `license_expires_at` or `subscription_status`. The owner portal is responsible
  for flipping `status → expired` when a license lapses (HRMS already blocks
  `expired`, so it takes effect on the next write automatically).
- The owner-side `/owner/*` API in this repo (`apps/api/src/routes/owner`) writes
  `tenants.status`/`license_*`; the deployed owner portal may differ. Treat
  `tenants.status` semantics as **HRMS-facing** — be careful that CogniDesk's
  merged flow doesn't repurpose the same shared field for a different product.

