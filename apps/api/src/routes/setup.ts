/**
 * POST /setup — Public (no JWT required)
 *
 * Called by Signup.tsx immediately after supabase.auth.signUp() succeeds.
 * The user has a valid Supabase auth UID but no profile or tenant yet.
 *
 * Creates:
 *   1. A new `tenants` row for the company
 *   2. A `profiles` row linking the user to the tenant as super_admin
 *
 * Security: uses the service-role Supabase client (bypasses RLS).
 * Validates that the provided user_id actually exists in auth.users before writing.
 * Idempotent: if both rows already exist, returns 200 with existing data.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { forbidden, serverError, ErrorCode } from '../lib/api-errors.js'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

const setupSchema = z.object({
  user_id:      z.string().uuid(),
  full_name:    z.string().min(2).max(100),
  company_name: z.string().min(2).max(100),
  industry:     z.string().min(1).max(50).optional(),
  size_range:   z.string().min(1).max(20).optional(),
})

export default async function setupRoute(fastify: FastifyInstance) {
  // POST /setup — no auth preHandler; uses service-role key to write
  fastify.post('/setup', async (req, reply) => {
    const parsed = setupSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { user_id, full_name, company_name, industry, size_range } = parsed.data

    // ── 1. Verify the user exists in Supabase auth ─────────────────────────────
    const { data: { user }, error: userErr } = await fastify.supabase.auth.admin.getUserById(user_id)
    if (userErr || !user) {
      return reply.code(400).send({
        error: 'USER_NOT_FOUND',
        message: 'Supabase user not found. Ensure sign-up completed before calling /setup.',
      })
    }

    // ── 1b. Anti-hijack guards ──────────────────────────────────────────────────
    // This route is intentionally unauthenticated — Signup.tsx calls it
    // immediately after supabase.auth.signUp(), and this app requires email
    // confirmation before a session exists ("check your email to verify, then
    // sign in" — see Signup.tsx step 3), so there is no JWT yet to check a
    // Bearer token against. Without SOME signal tying the caller to the actual
    // signup, anyone who learns another user's auth UID (leaked in a URL, log,
    // screenshot, referral link, etc. — user_id is just a UUID accepted from
    // the request body with no ownership check) could call /setup first with
    // their own company_name, silently pre-provisioning that identity into an
    // attacker-chosen tenant before the real signup's own /setup call runs —
    // the idempotency check below would then hand the real user back the
    // attacker's fabricated tenant instead of creating their own.
    //
    // Two checks that don't require a session:
    //  (a) the auth account must have been created moments ago — narrows the
    //      exploit window from "any UID ever leaked" to "an attacker actively
    //      racing this specific signup in real time";
    //  (b) full_name must match what Supabase captured in user_metadata at
    //      signUp() time (Signup.tsx passes options.data.full_name) — an
    //      attacker who only has a leaked UUID has no way to also know this.
    const createdAtMs = new Date(user.created_at).getTime()
    const ageMinutes   = Number.isFinite(createdAtMs) ? (Date.now() - createdAtMs) / 60_000 : Infinity
    if (ageMinutes > 15) {
      return forbidden(reply, 'SETUP_WINDOW_EXPIRED', 'This account was not created recently enough to complete setup. Please sign up again or contact support.')
    }

    const metadataFullName = (user.user_metadata as { full_name?: string } | null)?.full_name
    if (metadataFullName && metadataFullName.trim().toLowerCase() !== full_name.trim().toLowerCase()) {
      return forbidden(reply, 'SETUP_VERIFICATION_FAILED', 'Setup details do not match the account that was just created.')
    }

    // ── 2. Idempotency: check if profile already exists ────────────────────────
    const { data: existingProfile, error: existingProfileErr } = await fastify.supabase
      .from('profiles')
      .select('id, tenant_id, role')
      .eq('id', user_id)
      .maybeSingle()
    if (existingProfileErr) return serverError(req, reply, existingProfileErr, ErrorCode.QUERY_FAILED, 'Failed to check for existing setup')

    if (existingProfile) {
      const { data: existingTenant, error: existingTenantErr } = await fastify.supabase
        .from('tenants')
        .select('*')
        .eq('id', existingProfile.tenant_id)
        .maybeSingle()
      if (existingTenantErr) return serverError(req, reply, existingTenantErr, ErrorCode.QUERY_FAILED, 'Failed to fetch existing tenant')

      return reply.send({ profile: existingProfile, tenant: existingTenant })
    }

    // ── 3. Create tenant ────────────────────────────────────────────────────────
    const baseSlug = slugify(company_name)
    // Append 4-char suffix to reduce collision probability
    const suffix   = Math.random().toString(36).slice(2, 6)
    const slug     = `${baseSlug}-${suffix}`

    const { data: tenant, error: tenantErr } = await fastify.supabase
      .from('tenants')
      .insert({
        name:       company_name,
        slug,
        plan:       'starter',
        industry:   industry ?? null,
        size_range: size_range ?? null,
        country:    'IN',
        settings:   {},
      })
      .select('*')
      .single()

    if (tenantErr || !tenant) {
      // Fresh audit finding: this route is intentionally unauthenticated
      // (called before email confirmation, no session exists yet) — forwarding
      // a raw DB error message here reaches an anonymous caller, unlike every
      // other 500 path in this codebase which is at least authenticated.
      return serverError(req, reply, tenantErr, ErrorCode.INSERT_FAILED, 'Failed to create tenant')
    }

    // ── 4. Create profile ───────────────────────────────────────────────────────
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .insert({
        id:        user_id,
        tenant_id: tenant.id,
        role:      'super_admin',
        full_name,
        is_active: true,
      })
      .select('*')
      .single()

    if (profileErr || !profile) {
      // A concurrent /setup call for the same user_id (double-click, retried
      // client) can win the race between the idempotency check above and
      // this insert — profiles.id is the PK, so the loser hits 23505 here,
      // not a genuine failure. Treat it the same as the idempotent-hit path
      // above instead of rolling back and erroring on a setup that actually
      // already succeeded via the other request.
      if ((profileErr as any)?.code === '23505') {
        await fastify.supabase.from('tenants').delete().eq('id', tenant.id)
        const { data: winnerProfile, error: winnerErr } = await fastify.supabase
          .from('profiles')
          .select('id, tenant_id, role')
          .eq('id', user_id)
          .maybeSingle()
        if (winnerErr) return serverError(req, reply, winnerErr, ErrorCode.QUERY_FAILED, 'Failed to fetch existing setup after conflict')
        if (winnerProfile) {
          const { data: winnerTenant, error: winnerTenantErr } = await fastify.supabase
            .from('tenants')
            .select('*')
            .eq('id', winnerProfile.tenant_id)
            .maybeSingle()
          if (winnerTenantErr) return serverError(req, reply, winnerTenantErr, ErrorCode.QUERY_FAILED, 'Failed to fetch existing tenant after conflict')
          return reply.send({ profile: winnerProfile, tenant: winnerTenant })
        }
      }

      // Roll back tenant on profile failure (best-effort)
      await fastify.supabase.from('tenants').delete().eq('id', tenant.id)
      // Fresh audit finding: same unauthenticated-route error-leak fix as
      // the tenant insert above.
      return serverError(req, reply, profileErr, ErrorCode.INSERT_FAILED, 'Failed to create user profile')
    }

    fastify.log.info({ user_id, tenant_id: tenant.id }, 'setup: new tenant + super_admin profile created')

    return reply.code(201).send({ profile, tenant })
  })
}
