/**
 * Owner Panel API Routes  (/owner/*)
 *
 * All routes require platform admin JWT (authenticateOwner or authenticateOwnerOnly).
 * These routes are COMPLETELY separate from tenant auth — no tenantId is used.
 *
 * ── Tenants ──────────────────────────────────────────────────────
 *   GET    /owner/tenants                    — list all tenants
 *   POST   /owner/tenants                    — create new tenant + super_admin profile
 *   GET    /owner/tenants/:id                — single tenant detail
 *   PATCH  /owner/tenants/:id                — update tenant (plan, rate, notes, billing_email)
 *   POST   /owner/tenants/:id/license        — issue / renew license
 *   POST   /owner/tenants/:id/activate       — set status → active
 *   POST   /owner/tenants/:id/suspend        — set status → suspended
 *   POST   /owner/tenants/:id/cancel         — set status → cancelled
 *
 * ── Tenant Admins ─────────────────────────────────────────────────
 *   GET    /owner/tenants/:id/admins                        — list non-employee users
 *   POST   /owner/tenants/:id/admins                        — provision new admin (auth + profile)
 *   PATCH  /owner/tenants/:id/admins/:userId                — activate/deactivate/change role
 *   POST   /owner/tenants/:id/admins/:userId/reset-password — reset or auto-gen password
 *
 * ── Signup Requests ──────────────────────────────────────────────
 *   GET    /owner/requests                   — list all signup requests
 *   GET    /owner/requests/:id               — single request
 *   POST   /owner/requests/:id/approve       — approve (creates tenant automatically)
 *   POST   /owner/requests/:id/reject        — reject with reason
 *
 * ── API Keys ─────────────────────────────────────────────────────
 *   GET    /owner/api-keys                   — list all keys (optionally ?tenant_id=)
 *   POST   /owner/api-keys                   — generate new key for a tenant
 *   DELETE /owner/api-keys/:id               — revoke key
 *
 * ── API Usage ────────────────────────────────────────────────────
 *   GET    /owner/api-usage                  — aggregated stats (last 30 days)
 *   GET    /owner/api-usage/:tenantId        — per-tenant stats
 *
 * ── Billing ──────────────────────────────────────────────────────
 *   GET    /owner/billing                    — all billing snapshots
 *   GET    /owner/billing/:tenantId          — snapshots for one tenant
 *
 * ── Platform Admins ──────────────────────────────────────────────
 *   GET    /owner/admins                     — list platform admins
 *   POST   /owner/admins                     — invite co-admin (owner-only)
 *   PATCH  /owner/admins/:id                 — activate / deactivate / change role (owner-only)
 *   DELETE /owner/admins/:id                 — remove admin (owner-only, cannot remove self)
 *
 * ── Dashboard ────────────────────────────────────────────────────
 *   GET    /owner/dashboard                  — headline metrics for owner home
 */

import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a random API key and return { key (plain), prefix, hash } */
function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw    = crypto.randomBytes(32).toString('hex')        // 64 hex chars
  const key    = `sk_live_${raw}`
  const prefix = `sk_live_${raw.slice(0, 8)}`
  const hash   = crypto.createHash('sha256').update(key).digest('hex')
  return { key, prefix, hash }
}

/** Slugify a company name */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

// ── Route Registration ────────────────────────────────────────────────────────

export default async function ownerRoutes(fastify: FastifyInstance) {
  const ownerAuth     = { preHandler: [fastify.authenticateOwner] }
  const ownerOnlyAuth = { preHandler: [fastify.authenticateOwnerOnly] }

  // ══════════════════════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/owner/dashboard', ownerAuth, async (_req, reply) => {
    const [tenantsRes, requestsRes, keysRes, billingRes] = await Promise.all([
      fastify.supabase.from('tenants').select('id, status, plan, per_employee_rate, trial_ends_at'),
      fastify.supabase.from('tenant_signup_requests').select('id, status'),
      fastify.supabase.from('tenant_api_keys').select('id, is_active').eq('is_active', true),
      fastify.supabase
        .from('tenant_billing_snapshots')
        .select('amount_due')
        .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
    ])

    const tenants  = tenantsRes.data  ?? []
    const requests = requestsRes.data ?? []
    const keys     = keysRes.data     ?? []
    const billing  = billingRes.data  ?? []

    const mrr = billing.reduce((s, b) => s + Number(b.amount_due ?? 0), 0)

    return reply.send({
      data: {
        tenants: {
          total:     tenants.length,
          active:    tenants.filter(t => t.status === 'active').length,
          trial:     tenants.filter(t => t.status === 'trial').length,
          suspended: tenants.filter(t => t.status === 'suspended').length,
          expired:   tenants.filter(t => t.status === 'expired').length,
        },
        requests: {
          pending:  requests.filter(r => r.status === 'pending').length,
          total:    requests.length,
        },
        active_api_keys: keys.length,
        billing_30d_total: mrr,
      },
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  TENANTS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/tenants
  fastify.get('/owner/tenants', ownerAuth, async (req: any, reply) => {
    const q        = req.query as any
    const page     = Math.max(1, Number(q.page ?? 1))
    const limit    = Math.min(100, Number(q.limit ?? 25))
    const offset   = (page - 1) * limit
    const status   = q.status   ?? null
    const plan     = q.plan     ?? null
    const search   = q.search   ?? null

    let query = fastify.supabase
      .from('tenants')
      .select(`
        id, name, slug, plan, status,
        trial_ends_at, license_issued_at, license_expires_at,
        billing_email, per_employee_rate,
        country, created_at, notes,
        onboarded_by (id, name, email)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) query = query.eq('status', status)
    if (plan)   query = query.eq('plan', plan)
    if (search) query = query.ilike('name', `%${search}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data, meta: { total: count ?? 0, page, limit } })
  })

  // POST /owner/tenants — create tenant + optional super_admin account
  fastify.post('/owner/tenants', ownerOnlyAuth, async (req: any, reply) => {
    const body          = req.body as any
    const name          = String(body.name ?? '').trim()
    const plan          = body.plan ?? 'standard'
    const per_employee_rate = Number(body.per_employee_rate ?? 0)
    const billing_email = body.billing_email ?? null
    const notes         = body.notes ?? null
    const country       = body.country ?? 'IN'

    if (!name) return reply.code(400).send({ error: 'VALIDATION', message: 'name is required' })
    if (!['standard', 'enterprise'].includes(plan)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'plan must be standard or enterprise' })
    }

    // Generate unique slug
    let baseSlug = slugify(name)
    const { data: existing } = await fastify.supabase
      .from('tenants')
      .select('slug')
      .like('slug', `${baseSlug}%`)
    const usedSlugs = new Set((existing ?? []).map((r: any) => r.slug))
    let slug = baseSlug
    let n = 1
    while (usedSlugs.has(slug)) { slug = `${baseSlug}-${n++}` }

    const { data: tenant, error: tenantErr } = await fastify.supabase
      .from('tenants')
      .insert({
        name,
        slug,
        plan,
        per_employee_rate,
        billing_email: billing_email || null,
        notes: notes || null,
        country,
        status: 'trial',
        trial_ends_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
        onboarded_by: req.platformAdminId,
      })
      .select()
      .single()

    if (tenantErr) {
      if (tenantErr.code === '23505') {
        return reply.code(409).send({ error: 'DUPLICATE', message: 'A tenant with this name/slug already exists' })
      }
      return reply.code(500).send({ error: 'DB_ERROR', message: tenantErr.message })
    }

    return reply.code(201).send({ data: tenant })
  })

  // GET /owner/tenants/:id
  fastify.get('/owner/tenants/:id', ownerAuth, async (req: any, reply) => {
    const { id } = req.params

    const [tenantRes, billingRes, keysRes] = await Promise.all([
      fastify.supabase
        .from('tenants')
        .select(`
          *,
          onboarded_by (id, name, email),
          signup_request_id
        `)
        .eq('id', id)
        .single(),

      fastify.supabase
        .from('tenant_billing_snapshots')
        .select('id, snapshot_month, employee_count, per_employee_rate, amount_due, plan, created_at')
        .eq('tenant_id', id)
        .order('snapshot_month', { ascending: false })
        .limit(12),

      fastify.supabase
        .from('tenant_api_keys')
        .select('id, name, key_prefix, scopes, last_used_at, expires_at, is_active, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false }),
    ])

    if (tenantRes.error) {
      if (tenantRes.error.code === 'PGRST116') return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tenant not found' })
      return reply.code(500).send({ error: 'DB_ERROR', message: tenantRes.error.message })
    }

    return reply.send({
      data: {
        ...tenantRes.data,
        billing_snapshots: billingRes.data ?? [],
        api_keys: keysRes.data ?? [],
      },
    })
  })

  // PATCH /owner/tenants/:id
  fastify.patch('/owner/tenants/:id', ownerAuth, async (req: any, reply) => {
    const { id } = req.params
    const body   = req.body as any

    const allowed: Record<string, unknown> = {}
    if (body.plan               != null) allowed.plan               = body.plan
    if (body.per_employee_rate  != null) allowed.per_employee_rate  = Number(body.per_employee_rate)
    if (body.billing_email      != null) allowed.billing_email      = body.billing_email || null
    if (body.notes              != null) allowed.notes              = body.notes || null
    if (body.country            != null) allowed.country            = String(body.country).toUpperCase().slice(0, 5)

    if (allowed.plan && !['standard', 'enterprise'].includes(allowed.plan as string)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid plan' })
    }
    if (Object.keys(allowed).length === 0) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'No updatable fields provided' })
    }

    const { data, error } = await fastify.supabase
      .from('tenants')
      .update(allowed)
      .eq('id', id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /owner/tenants/:id/license
  fastify.post('/owner/tenants/:id/license', ownerOnlyAuth, async (req: any, reply) => {
    const { id }      = req.params
    const body        = req.body as any
    const months      = Math.max(1, Number(body.months ?? 12))
    const now         = new Date()
    const expiresAt   = new Date(now)
    expiresAt.setMonth(expiresAt.getMonth() + months)

    const { data, error } = await fastify.supabase
      .from('tenants')
      .update({
        status:             'active',
        license_issued_at:  now.toISOString(),
        license_expires_at: expiresAt.toISOString(),
      })
      .eq('id', id)
      .select('id, name, status, license_issued_at, license_expires_at')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /owner/tenants/:id/activate
  fastify.post('/owner/tenants/:id/activate', ownerOnlyAuth, async (req: any, reply) => {
    const { id } = req.params
    const { data, error } = await fastify.supabase
      .from('tenants').update({ status: 'active' }).eq('id', id).select('id, status').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /owner/tenants/:id/suspend
  fastify.post('/owner/tenants/:id/suspend', ownerOnlyAuth, async (req: any, reply) => {
    const { id } = req.params
    const body   = (req.body as any) ?? {}   // body is null when no payload sent
    const { data, error } = await fastify.supabase
      .from('tenants')
      .update({ status: 'suspended', notes: body.reason ?? null })
      .eq('id', id).select('id, status').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /owner/tenants/:id/cancel
  fastify.post('/owner/tenants/:id/cancel', ownerOnlyAuth, async (req: any, reply) => {
    const { id } = req.params
    const { data, error } = await fastify.supabase
      .from('tenants').update({ status: 'cancelled' }).eq('id', id).select('id, status').single()
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  TENANT ADMIN MANAGEMENT
  //  Owner can create, list, reset-password, activate/deactivate tenant admins.
  //  Uses supabase.auth.admin (service-role) so no Supabase Dashboard required.
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/tenants/:id/admins — list elevated-role users for a tenant
  // Email is fetched from auth.users via Admin API (no email col required in profiles)
  fastify.get('/owner/tenants/:id/admins', ownerAuth, async (req: any, reply) => {
    const { id: tenantId } = req.params as any

    // profiles.id IS the auth user UUID — no separate user_id column
    const { data: profiles, error } = await fastify.supabase
      .from('profiles')
      .select('id, full_name, role, is_active, created_at')
      .eq('tenant_id', tenantId)
      .in('role', ['super_admin', 'hr_admin', 'manager'])
      .order('created_at', { ascending: true })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!profiles?.length) return reply.send({ data: [] })

    // Enrich with emails from Supabase auth (service-role Admin API)
    // listUsers returns up to 1000 by default — fine for tenant admin lists
    const emailMap: Record<string, string> = {}
    try {
      const { data: authList } = await (fastify.supabase.auth as any).admin.listUsers({ perPage: 1000, page: 1 })
      for (const u of (authList?.users ?? [])) {
        emailMap[u.id] = u.email ?? ''
      }
    } catch (_) { /* email enrichment is best-effort */ }

    const enriched = profiles.map(p => ({ ...p, email: emailMap[p.id] ?? null }))
    return reply.send({ data: enriched })
  })

  // POST /owner/tenants/:id/admins — provision a new tenant admin account
  // Creates: Supabase auth user (email_confirmed) + profiles row with role='super_admin'
  // NOTE: profiles.id = auth.users.id — there is no separate user_id column.
  fastify.post('/owner/tenants/:id/admins', ownerOnlyAuth, async (req: any, reply) => {
    const { id: tenantId } = req.params as any
    const body     = req.body as any
    const email    = String(body.email    ?? '').trim().toLowerCase()
    const fullName = String(body.name     ?? '').trim()
    const password = String(body.password ?? '').trim()
    // Map frontend role labels → valid DB values
    const roleMap: Record<string, string> = {
      admin:      'super_admin',
      super_admin: 'super_admin',
      hr:         'hr_admin',
      hr_admin:   'hr_admin',
      hr_manager: 'hr_admin',
      manager:    'manager',
    }
    const role = roleMap[body.role ?? 'admin'] ?? 'super_admin'

    if (!email || !password || !fullName) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'email, name and password are required' })
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Password must be at least 8 characters' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid email address' })
    }

    // Verify tenant exists
    const { data: tenant } = await fastify.supabase
      .from('tenants').select('id, name').eq('id', tenantId).single()
    if (!tenant) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tenant not found' })

    // Duplicate check: find auth user by email → check if they already have a profile here
    // (profiles has no email column — look up via auth Admin API)
    try {
      const { data: authList } = await (fastify.supabase.auth as any).admin.listUsers({ perPage: 1000, page: 1 })
      const existingAuthUser = (authList?.users ?? []).find((u: any) => u.email === email)
      if (existingAuthUser) {
        const { data: dup } = await fastify.supabase
          .from('profiles').select('id').eq('id', existingAuthUser.id).eq('tenant_id', tenantId).maybeSingle()
        if (dup) {
          return reply.code(409).send({ error: 'DUPLICATE', message: 'This email is already registered for this tenant' })
        }
      }
    } catch (_) { /* best-effort pre-check; auth creation will catch hard duplicates */ }

    // Create Supabase auth user via Admin API (email auto-confirmed — no email verification needed)
    const { data: authData, error: authErr } = await (fastify.supabase.auth as any).admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, tenant_id: tenantId, provisioned_by: 'owner_panel' },
    })

    let userId: string | null = authData?.user?.id ?? null

    if (authErr) {
      if (authErr.message?.includes('already been registered') || authErr.status === 422) {
        // Auth user already exists — look up their ID and link to this tenant instead
        try {
          const { data: existingList } = await (fastify.supabase.auth as any).admin.listUsers({ perPage: 1000 })
          const existingUser = existingList?.users?.find((u: any) => u.email === email)
          if (!existingUser) {
            return reply.code(409).send({ error: 'AUTH_DUPLICATE', message: 'This email already exists but could not be found. Try resetting their password.' })
          }
          userId = existingUser.id
          // Check not already linked to THIS tenant
          const { data: existingProfile } = await fastify.supabase
            .from('profiles').select('id').eq('id', userId).eq('tenant_id', tenantId).maybeSingle()
          if (existingProfile) {
            return reply.code(409).send({ error: 'DUPLICATE', message: 'This email is already an admin for this tenant.' })
          }
        } catch {
          return reply.code(409).send({ error: 'AUTH_DUPLICATE', message: 'This email already has an auth account. Use a different email or reset their password.' })
        }
      } else {
        return reply.code(500).send({ error: 'AUTH_ERROR', message: authErr.message })
      }
    }

    if (!userId) return reply.code(500).send({ error: 'AUTH_ERROR', message: 'Auth user creation returned no ID' })

    // Create profiles row — profiles.id IS the auth user id
    // email is NOT stored in profiles (lives in auth.users) — no migration needed
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .insert({
        id:        userId,       // profiles.id = auth.users.id
        tenant_id: tenantId,
        full_name: fullName,
        role,
        is_active: true,
      })
      .select('id, full_name, role, is_active, created_at')
      .single()

    if (profileErr) {
      // Roll back auth user if profile insert fails
      await (fastify.supabase.auth as any).admin.deleteUser(userId).catch(() => {})
      return reply.code(500).send({ error: 'DB_ERROR', message: profileErr.message })
    }

    return reply.code(201).send({
      data: { ...profile, email },   // email comes from auth.users (not profiles col)
      message: `Admin account created. Share credentials: ${email} / ${password}`,
    })
  })

  // PATCH /owner/tenants/:id/admins/:userId — activate / deactivate / change role
  fastify.patch('/owner/tenants/:id/admins/:userId', ownerOnlyAuth, async (req: any, reply) => {
    const { id: tenantId, userId } = req.params as any
    const body = req.body as any

    const allowed: Record<string, unknown> = {}
    if (body.is_active != null) allowed.is_active = Boolean(body.is_active)
    if (body.role      != null) {
      if (!['super_admin', 'hr_admin', 'manager', 'employee'].includes(body.role)) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid role' })
      }
      allowed.role = body.role
    }

    if (Object.keys(allowed).length === 0) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'Nothing to update' })
    }

    // profiles.id = auth user id — match on id + tenant_id
    const { data, error } = await fastify.supabase
      .from('profiles')
      .update(allowed)
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .select('id, full_name, role, is_active')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /owner/tenants/:id/admins/:userId/reset-password
  // Resets (or auto-generates) a tenant admin's password via Admin API.
  fastify.post('/owner/tenants/:id/admins/:userId/reset-password', ownerOnlyAuth, async (req: any, reply) => {
    const { id: tenantId, userId } = req.params as any
    const body = req.body as any

    // Auto-generate a strong temp password if caller didn't supply one
    const newPassword: string = (body.password && String(body.password).trim().length >= 8)
      ? String(body.password).trim()
      : crypto.randomBytes(6).toString('hex') + 'Aa1!'  // 16 chars, meets most policies

    // Verify user belongs to this tenant — profiles.id = auth user id
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!profile) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found in this tenant' })
    }

    // Get email from auth.users (source of truth)
    const { data: authUser } = await (fastify.supabase.auth as any).admin.getUserById(userId)
    const email = authUser?.user?.email ?? null

    const { error: resetErr } = await (fastify.supabase.auth as any).admin.updateUserById(userId, {
      password: newPassword,
    })

    if (resetErr) return reply.code(500).send({ error: 'AUTH_ERROR', message: resetErr.message })

    return reply.send({
      data: {
        email,
        name:          profile.full_name,
        temp_password: newPassword,
      },
      message: 'Password reset successfully. Show this to the admin once — it will not be stored.',
    })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  SIGNUP REQUESTS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/requests
  fastify.get('/owner/requests', ownerAuth, async (req: any, reply) => {
    const q      = req.query as any
    const status = q.status ?? null
    const page   = Math.max(1, Number(q.page ?? 1))
    const limit  = Math.min(100, Number(q.limit ?? 25))
    const offset = (page - 1) * limit

    let query = fastify.supabase
      .from('tenant_signup_requests')
      .select(`
        id, company_name, contact_name, contact_email, industry, size_range,
        country, message, status, reviewed_at, rejection_reason, tenant_id, created_at,
        reviewed_by (id, name, email)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) query = query.eq('status', status)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data, meta: { total: count ?? 0, page, limit } })
  })

  // GET /owner/requests/:id
  fastify.get('/owner/requests/:id', ownerAuth, async (req: any, reply) => {
    const { id } = req.params
    const { data, error } = await fastify.supabase
      .from('tenant_signup_requests')
      .select(`*, reviewed_by (id, name, email)`)
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return reply.code(404).send({ error: 'NOT_FOUND' })
      return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    }
    return reply.send({ data })
  })

  // POST /owner/requests/:id/approve — creates a tenant automatically
  fastify.post('/owner/requests/:id/approve', ownerOnlyAuth, async (req: any, reply) => {
    const { id }   = req.params
    const body     = req.body as any

    // Fetch request
    const { data: reqData, error: reqErr } = await fastify.supabase
      .from('tenant_signup_requests')
      .select('*')
      .eq('id', id)
      .single()

    if (reqErr || !reqData) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Request not found' })
    if (reqData.status !== 'pending') {
      return reply.code(409).send({ error: 'CONFLICT', message: `Request is already ${reqData.status}` })
    }

    // Create tenant
    const slug = slugify(reqData.company_name) + '-' + Date.now().toString(36)
    const plan = body.plan ?? 'standard'
    const per_employee_rate = Number(body.per_employee_rate ?? 0)

    const { data: tenant, error: tenantErr } = await fastify.supabase
      .from('tenants')
      .insert({
        name:               reqData.company_name,
        slug,
        plan,
        per_employee_rate,
        billing_email:      reqData.contact_email,
        country:            reqData.country,
        status:             'trial',
        trial_ends_at:      new Date(Date.now() + 30 * 86400_000).toISOString(),
        onboarded_by:       req.platformAdminId,
        signup_request_id:  id,
      })
      .select()
      .single()

    if (tenantErr) return reply.code(500).send({ error: 'DB_ERROR', message: tenantErr.message })

    // Update request status
    await fastify.supabase
      .from('tenant_signup_requests')
      .update({
        status:      'approved',
        reviewed_by: req.platformAdminId,
        reviewed_at: new Date().toISOString(),
        tenant_id:   tenant.id,
      })
      .eq('id', id)

    return reply.code(201).send({ data: { request_id: id, tenant } })
  })

  // POST /owner/requests/:id/reject
  fastify.post('/owner/requests/:id/reject', ownerOnlyAuth, async (req: any, reply) => {
    const { id }  = req.params
    const body    = req.body as any
    const reason  = String(body.reason ?? '').trim()

    if (!reason) return reply.code(400).send({ error: 'VALIDATION', message: 'reason is required' })

    const { data, error } = await fastify.supabase
      .from('tenant_signup_requests')
      .update({
        status:           'rejected',
        reviewed_by:      req.platformAdminId,
        reviewed_at:      new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status, rejection_reason')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    if (!data)  return reply.code(409).send({ error: 'CONFLICT', message: 'Request is not pending or not found' })

    return reply.send({ data })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  API KEYS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/api-keys?tenant_id=&active=
  fastify.get('/owner/api-keys', ownerAuth, async (req: any, reply) => {
    const q         = req.query as any
    const tenantId  = q.tenant_id ?? null
    const activeOnly = q.active !== 'false'

    let query = fastify.supabase
      .from('tenant_api_keys')
      .select(`
        id, tenant_id, name, key_prefix, scopes, last_used_at,
        expires_at, is_active, created_at,
        created_by (id, name)
      `)
      .order('created_at', { ascending: false })

    if (tenantId)  query = query.eq('tenant_id', tenantId)
    if (activeOnly) query = query.eq('is_active', true)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data })
  })

  // POST /owner/api-keys
  fastify.post('/owner/api-keys', ownerAuth, async (req: any, reply) => {
    const body     = req.body as any
    const tenantId = body.tenant_id
    const name     = String(body.name ?? 'Default').trim()
    const scopes   = Array.isArray(body.scopes) ? body.scopes : ['employees:read']
    const expiresAt = body.expires_at ?? null   // ISO string or null

    if (!tenantId) return reply.code(400).send({ error: 'VALIDATION', message: 'tenant_id is required' })

    // Verify tenant exists
    const { data: tenant } = await fastify.supabase
      .from('tenants').select('id').eq('id', tenantId).single()
    if (!tenant) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Tenant not found' })

    const { key, prefix, hash } = generateApiKey()

    const { data, error } = await fastify.supabase
      .from('tenant_api_keys')
      .insert({
        tenant_id:  tenantId,
        name,
        key_prefix: prefix,
        key_hash:   hash,
        scopes,
        expires_at: expiresAt || null,
        is_active:  true,
        created_by: req.platformAdminId,
      })
      .select('id, tenant_id, name, key_prefix, scopes, expires_at, is_active, created_at')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Return the full key ONCE — it won't be retrievable again
    return reply.code(201).send({
      data: { ...data, key },
      message: 'Save this key now — it will not be shown again.',
    })
  })

  // DELETE /owner/api-keys/:id — revoke (soft delete)
  fastify.delete('/owner/api-keys/:id', ownerAuth, async (req: any, reply) => {
    const { id } = req.params
    const { data, error } = await fastify.supabase
      .from('tenant_api_keys')
      .update({ is_active: false })
      .eq('id', id)
      .select('id, is_active')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  API USAGE
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/api-usage?days=30&tenant_id=
  fastify.get('/owner/api-usage', ownerAuth, async (req: any, reply) => {
    const q        = req.query as any
    const days     = Math.min(90, Math.max(1, Number(q.days ?? 30)))
    const tenantId = q.tenant_id ?? null
    const since    = new Date(Date.now() - days * 86400_000).toISOString()

    let query = fastify.supabase
      .from('api_usage_log')
      .select('tenant_id, endpoint, method, status_code, response_ms, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000)

    if (tenantId) query = query.eq('tenant_id', tenantId)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const rows = data ?? []

    // Aggregate by tenant
    const byTenant: Record<string, { total: number; errors: number; avg_ms: number; tenant_id: string }> = {}
    for (const row of rows) {
      if (!byTenant[row.tenant_id]) {
        byTenant[row.tenant_id] = { tenant_id: row.tenant_id, total: 0, errors: 0, avg_ms: 0 }
      }
      byTenant[row.tenant_id].total++
      if ((row.status_code ?? 200) >= 400) byTenant[row.tenant_id].errors++
      byTenant[row.tenant_id].avg_ms += (row.response_ms ?? 0)
    }
    // Compute averages
    for (const t of Object.values(byTenant)) {
      t.avg_ms = t.total > 0 ? Math.round(t.avg_ms / t.total) : 0
    }

    // Aggregate by endpoint (top 20)
    const byEndpoint: Record<string, number> = {}
    for (const row of rows) {
      const key = `${row.method} ${row.endpoint}`
      byEndpoint[key] = (byEndpoint[key] ?? 0) + 1
    }
    const topEndpoints = Object.entries(byEndpoint)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([endpoint, count]) => ({ endpoint, count }))

    return reply.send({
      data: {
        period_days:   days,
        total_requests: rows.length,
        by_tenant:     Object.values(byTenant).sort((a, b) => b.total - a.total),
        top_endpoints: topEndpoints,
        error_rate:    rows.length > 0
          ? ((rows.filter(r => (r.status_code ?? 200) >= 400).length / rows.length) * 100).toFixed(1) + '%'
          : '0%',
      },
    })
  })

  // GET /owner/api-usage/:tenantId — hourly breakdown for one tenant
  fastify.get('/owner/api-usage/:tenantId', ownerAuth, async (req: any, reply) => {
    const { tenantId } = req.params
    const q            = req.query as any
    const days         = Math.min(30, Math.max(1, Number(q.days ?? 7)))
    const since        = new Date(Date.now() - days * 86400_000).toISOString()

    const { data, error } = await fastify.supabase
      .from('api_usage_log')
      .select('id, endpoint, method, status_code, response_ms, ip_address, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    return reply.send({ data: data ?? [], meta: { tenant_id: tenantId, days } })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  BILLING SNAPSHOTS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/billing?tenant_id=&month=YYYY-MM
  fastify.get('/owner/billing', ownerAuth, async (req: any, reply) => {
    const q        = req.query as any
    const tenantId = q.tenant_id ?? null
    const month    = q.month ?? null
    const page     = Math.max(1, Number(q.page ?? 1))
    const limit    = Math.min(200, Number(q.limit ?? 50))
    const offset   = (page - 1) * limit

    let query = fastify.supabase
      .from('tenant_billing_snapshots')
      .select(`
        id, tenant_id, snapshot_month, employee_count,
        per_employee_rate, amount_due, plan, notes, created_at,
        payroll_run_id
      `, { count: 'exact' })
      .order('snapshot_month', { ascending: false })
      .range(offset, offset + limit - 1)

    if (tenantId) query = query.eq('tenant_id', tenantId)
    if (month)    query = query.eq('snapshot_month', month)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    // Total amount across result set
    const totalAmount = (data ?? []).reduce((s, r) => s + Number(r.amount_due ?? 0), 0)

    return reply.send({
      data,
      meta: { total: count ?? 0, page, limit, total_amount: totalAmount },
    })
  })

  // GET /owner/billing/:tenantId
  fastify.get('/owner/billing/:tenantId', ownerAuth, async (req: any, reply) => {
    const { tenantId } = req.params

    const { data, error } = await fastify.supabase
      .from('tenant_billing_snapshots')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('snapshot_month', { ascending: false })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })

    const total = (data ?? []).reduce((s, r) => s + Number(r.amount_due ?? 0), 0)

    return reply.send({ data, meta: { tenant_id: tenantId, lifetime_total: total } })
  })

  // ══════════════════════════════════════════════════════════════════════════════
  //  PLATFORM ADMINS
  // ══════════════════════════════════════════════════════════════════════════════

  // GET /owner/admins
  fastify.get('/owner/admins', ownerAuth, async (_req, reply) => {
    const { data, error } = await fastify.supabase
      .from('platform_admins')
      .select('id, name, email, role, is_active, last_login_at, created_at, invited_by')
      .order('created_at', { ascending: true })

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // POST /owner/admins — invite co-admin
  // NOTE: This creates an auth.users record + platform_admins row.
  // The invited admin receives a password reset email to set their own password.
  fastify.post('/owner/admins', ownerOnlyAuth, async (req: any, reply) => {
    const body  = req.body as any
    const name  = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const role  = body.role === 'owner' ? 'owner' : 'admin'

    if (!name || !email) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'name and email are required' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Invalid email address' })
    }

    // Check not already an admin
    const { data: existing } = await fastify.supabase
      .from('platform_admins')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return reply.code(409).send({ error: 'DUPLICATE', message: 'This email is already a platform admin' })
    }

    // Use Supabase Admin API to invite — sends email with magic link
    // service_role can call inviteUserByEmail
    const { data: inviteData, error: inviteErr } = await (fastify.supabase.auth as any)
      .admin
      .inviteUserByEmail(email, {
        data: { name, platform_admin: true },
        redirectTo: process.env.OWNER_APP_URL
          ? `${process.env.OWNER_APP_URL}/owner/accept-invite`
          : undefined,
      })

    if (inviteErr) {
      return reply.code(500).send({ error: 'INVITE_ERROR', message: inviteErr.message })
    }

    const userId = inviteData?.user?.id
    if (!userId) {
      return reply.code(500).send({ error: 'INVITE_ERROR', message: 'Failed to create auth user' })
    }

    // Create platform_admins row
    const { data: admin, error: adminErr } = await fastify.supabase
      .from('platform_admins')
      .insert({
        user_id:    userId,
        name,
        email,
        role,
        is_active:  true,
        invited_by: req.platformAdminId,
      })
      .select()
      .single()

    if (adminErr) return reply.code(500).send({ error: 'DB_ERROR', message: adminErr.message })

    return reply.code(201).send({ data: admin, message: `Invitation email sent to ${email}` })
  })

  // PATCH /owner/admins/:id
  fastify.patch('/owner/admins/:id', ownerOnlyAuth, async (req: any, reply) => {
    const { id } = req.params
    const body   = req.body as any

    // Cannot edit yourself to demote/deactivate — safety guard
    if (id === req.platformAdminId && body.is_active === false) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Cannot deactivate your own account' })
    }

    const allowed: Record<string, unknown> = {}
    if (body.is_active != null) allowed.is_active = Boolean(body.is_active)
    if (body.role      != null) {
      if (!['owner', 'admin'].includes(body.role)) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'role must be owner or admin' })
      }
      allowed.role = body.role
    }
    if (body.name      != null) allowed.name = String(body.name).trim()

    if (Object.keys(allowed).length === 0) {
      return reply.code(400).send({ error: 'NO_FIELDS', message: 'Nothing to update' })
    }

    const { data, error } = await fastify.supabase
      .from('platform_admins')
      .update(allowed)
      .eq('id', id)
      .select('id, name, email, role, is_active')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // DELETE /owner/admins/:id — cannot delete yourself
  fastify.delete('/owner/admins/:id', ownerOnlyAuth, async (req: any, reply) => {
    const { id } = req.params

    if (id === req.platformAdminId) {
      return reply.code(400).send({ error: 'VALIDATION', message: 'Cannot remove your own admin account' })
    }

    // Soft-delete: deactivate rather than hard delete (preserves audit trail)
    const { data, error } = await fastify.supabase
      .from('platform_admins')
      .update({ is_active: false })
      .eq('id', id)
      .select('id, is_active')
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data, message: 'Admin deactivated' })
  })

  // ── GET /owner/me ─────────────────────────────────────────────────────────────
  fastify.get('/owner/me', ownerAuth, async (req: any, reply) => {
    const { data, error } = await fastify.supabase
      .from('platform_admins')
      .select('id, name, email, role, is_active, last_login_at, created_at')
      .eq('id', req.platformAdminId)
      .single()

    if (error) return reply.code(500).send({ error: 'DB_ERROR', message: error.message })
    return reply.send({ data })
  })

  // ── GET /owner/tenant-health ──────────────────────────────────────────────────
  // Returns live running stats for every tenant:
  //   employee_count, active_users, last_payroll_run (date + status), last_activity
  fastify.get('/owner/tenant-health', ownerAuth, async (_req, reply) => {
    // Fetch in parallel
    const [employeesRes, profilesRes, payrollRes] = await Promise.all([
      // Active employee counts per tenant
      fastify.supabase
        .from('employees')
        .select('tenant_id')
        .eq('status', 'active'),

      // Active profile (user) counts per tenant
      fastify.supabase
        .from('profiles')
        .select('tenant_id, last_sign_in_at')
        .eq('is_active', true),

      // Latest payroll run per tenant (most recent created_at)
      fastify.supabase
        .from('payroll_runs')
        .select('tenant_id, month, status, finalized_at, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    // Build per-tenant stats maps
    const empCount: Record<string, number>   = {}
    for (const e of (employeesRes.data ?? [])) {
      empCount[e.tenant_id] = (empCount[e.tenant_id] ?? 0) + 1
    }

    const userCount: Record<string, number>     = {}
    const lastLogin: Record<string, string|null> = {}
    for (const p of (profilesRes.data ?? [])) {
      userCount[p.tenant_id] = (userCount[p.tenant_id] ?? 0) + 1
      // Track most recent login per tenant
      const existing = lastLogin[p.tenant_id]
      if (!existing || (p.last_sign_in_at && p.last_sign_in_at > existing)) {
        lastLogin[p.tenant_id] = p.last_sign_in_at ?? null
      }
    }

    // Most recent payroll run per tenant (already ordered DESC)
    const lastPayroll: Record<string, { month: string; status: string; finalized_at: string|null }> = {}
    for (const r of (payrollRes.data ?? [])) {
      if (!lastPayroll[r.tenant_id]) {
        lastPayroll[r.tenant_id] = { month: r.month, status: r.status, finalized_at: r.finalized_at }
      }
    }

    // Collect all unique tenant IDs across all data sources
    const allIds = new Set([
      ...Object.keys(empCount),
      ...Object.keys(userCount),
      ...Object.keys(lastPayroll),
    ])

    const stats = Array.from(allIds).map(tid => ({
      tenant_id:        tid,
      employee_count:   empCount[tid]   ?? 0,
      active_users:     userCount[tid]  ?? 0,
      last_login_at:    lastLogin[tid]  ?? null,
      last_payroll_run: lastPayroll[tid] ?? null,
    }))

    return reply.send({ data: stats })
  })
}
