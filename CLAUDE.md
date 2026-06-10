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
