/**
 * Employee User Account — /employees/:id/user-account
 *
 * Manages the Supabase auth user linked to an employee record.
 *
 * GET  /employees/:id/user-account
 *   Returns current account status: no_account | invited | active | suspended
 *
 * POST /employees/:id/user-account
 *   Creates a Supabase auth user and links it via a `profiles` row.
 *   Supports invite-by-email (sends magic link / invite email) or
 *   password-less invite (OTP only).
 *
 * PATCH /employees/:id/user-account
 *   Suspends or reactivates the linked account.
 *
 * Security: requires hr_admin / super_admin role.
 * Uses the service-role Supabase client (bypasses RLS).
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const ADMIN_ROLES = ['super_admin', 'hr_admin']

const createAccountSchema = z.object({
  email:              z.string().email(),
  role:               z.enum(['employee', 'manager']).default('employee'),
  temporary_password: z.string().min(8).optional(),
  send_invite:        z.boolean().default(false),   // false = direct creation (primary)
  is_active:          z.boolean().default(true),
})

const patchAccountSchema = z.object({
  action: z.enum(['suspend', 'reactivate']),
})

export default async function userAccountRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] }

  // ── GET /employees/:id/user-account ────────────────────────────────────────
  fastify.get('/employees/:id/user-account', auth, async (req, reply) => {
    const { id }       = req.params as { id: string }
    const userRole     = (req as any).userRole as string

    if (!ADMIN_ROLES.includes(userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR Admin access required' })
    }

    // Verify employee belongs to this tenant
    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name, email')
      .eq('id', id)
      .eq('tenant_id', (req as any).tenantId)
      .maybeSingle()

    if (empErr || !emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    // Look up linked profile
    const { data: profile } = await fastify.supabase
      .from('profiles')
      .select('id, role, is_active, full_name, created_at')
      .eq('employee_id', id)
      .eq('tenant_id', (req as any).tenantId)
      .maybeSingle()

    if (!profile) {
      return reply.send({
        status:  'no_account',
        profile: null,
        email:   emp.email,
      })
    }

    // Check auth user state
    const { data: { user: authUser }, error: authErr } = await fastify.supabase.auth.admin.getUserById(profile.id)

    if (authErr || !authUser) {
      // Profile exists but auth user is gone — treat as no_account
      return reply.send({
        status:  'no_account',
        profile: null,
        email:   emp.email,
      })
    }

    let status: 'pending_verification' | 'active' | 'suspended'

    if (!profile.is_active) {
      status = 'suspended'
    } else if (!authUser.email_confirmed_at && !authUser.confirmed_at) {
      status = 'pending_verification'   // was 'invited'
    } else {
      status = 'active'
    }

    return reply.send({
      status,
      profile: {
        id:         profile.id,
        role:       profile.role,
        is_active:  profile.is_active,
        full_name:  profile.full_name,
        created_at: profile.created_at,
      },
      auth_user: {
        email:              authUser.email,
        email_confirmed_at: authUser.email_confirmed_at ?? authUser.confirmed_at ?? null,
        last_sign_in_at:    authUser.last_sign_in_at ?? null,
        created_at:         authUser.created_at,
      },
    })
  })

  // ── POST /employees/:id/user-account ───────────────────────────────────────
  fastify.post('/employees/:id/user-account', auth, async (req, reply) => {
    const { id }   = req.params as { id: string }
    const userRole = (req as any).userRole as string
    const tenantId = (req as any).tenantId as string

    if (!ADMIN_ROLES.includes(userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR Admin access required' })
    }

    const parsed = createAccountSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body',
      })
    }

    const { email, role, send_invite, temporary_password, is_active } = parsed.data

    // 1. Verify employee belongs to this tenant
    const { data: emp, error: empErr } = await fastify.supabase
      .from('employees')
      .select('id, first_name, last_name')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (empErr || !emp) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Employee not found' })
    }

    const fullName = `${emp.first_name} ${emp.last_name}`.trim()

    // 2. Check if a profile already exists for this employee
    const { data: existingProfile } = await fastify.supabase
      .from('profiles')
      .select('id, role, is_active')
      .eq('employee_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (existingProfile) {
      return reply.code(409).send({
        error:   'ACCOUNT_EXISTS',
        message: 'A user account already exists for this employee',
      })
    }

    // 3. Create Supabase auth user
    let authUserId: string

    if (send_invite) {
      // Send an invite email — user sets their own password via magic link
      const { data: invited, error: inviteErr } = await fastify.supabase.auth.admin.inviteUserByEmail(
        email,
        {
          data: {
            full_name:   fullName,
            employee_id: id,
            tenant_id:   tenantId,
            role,
          },
        }
      )

      if (inviteErr || !invited?.user) {
        fastify.log.error({ err: inviteErr, email }, 'user-account: inviteUserByEmail failed')
        return reply.code(500).send({
          error:   'INVITE_FAILED',
          message: inviteErr?.message ?? 'Failed to send invite email',
        })
      }

      authUserId = invited.user.id

      // Create profiles row for invite path
      const { data: inviteProfile, error: inviteProfileErr } = await fastify.supabase
        .from('profiles')
        .insert({
          id:          authUserId,
          tenant_id:   tenantId,
          role,
          full_name:   fullName,
          is_active:   is_active ?? true,
          employee_id: id,
        })
        .select('id, role, is_active, full_name, created_at')
        .single()

      if (inviteProfileErr || !inviteProfile) {
        await fastify.supabase.auth.admin.deleteUser(authUserId)
        fastify.log.error({ err: inviteProfileErr }, 'user-account: profiles insert failed (invite) — auth user rolled back')
        return reply.code(500).send({
          error:   'PROFILE_CREATE_FAILED',
          message: inviteProfileErr?.message ?? 'Failed to create user profile',
        })
      }

      fastify.log.info({ employeeId: id, authUserId, role }, 'user-account: invite sent')

      return reply.code(201).send({
        status:       'pending_verification',
        profile:      inviteProfile,
        auth_user_id: authUserId,
      })
    } else {
      // Create without invite — admin will share credentials manually
      const wasAutoGenerated  = !temporary_password
      const tempPassword      = temporary_password
        ?? (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase() + '!1')

      const { data: created, error: createErr } = await fastify.supabase.auth.admin.createUser({
        email,
        password:      tempPassword,
        email_confirm: true,
        user_metadata: {
          full_name:   fullName,
          employee_id: id,
          tenant_id:   tenantId,
          role,
        },
      })

      if (createErr || !created?.user) {
        fastify.log.error({ err: createErr, email }, 'user-account: createUser failed')
        return reply.code(500).send({
          error:   'CREATE_FAILED',
          message: createErr?.message ?? 'Failed to create user',
        })
      }

      authUserId = created.user.id

      // 4. Create profiles row linking auth user → employee
      const { data: newProfile, error: profileErr } = await fastify.supabase
        .from('profiles')
        .insert({
          id:          authUserId,
          tenant_id:   tenantId,
          role,
          full_name:   fullName,
          is_active:   is_active ?? true,
          employee_id: id,
        })
        .select('id, role, is_active, full_name, created_at')
        .single()

      if (profileErr || !newProfile) {
        await fastify.supabase.auth.admin.deleteUser(authUserId)
        fastify.log.error({ err: profileErr }, 'user-account: profiles insert failed — auth user rolled back')
        return reply.code(500).send({
          error:   'PROFILE_CREATE_FAILED',
          message: profileErr?.message ?? 'Failed to create user profile',
        })
      }

      // If account created as inactive, ban in Supabase Auth as well
      if (!is_active) {
        await fastify.supabase.auth.admin.updateUserById(authUserId, { ban_duration: '876000h' })
      }

      fastify.log.info({ employeeId: id, authUserId, role, is_active }, 'user-account: account created (direct)')

      return reply.code(201).send({
        status:             (is_active ?? true) ? 'active' : 'suspended',
        profile:            newProfile,
        auth_user_id:       authUserId,
        // Only returned when password was auto-generated so admin can share it
        generated_password: wasAutoGenerated ? tempPassword : undefined,
      })
    }

    // (invite path already returned above — this is unreachable but satisfies TS)
    /* istanbul ignore next */
    return reply.code(500).send({ error: 'UNEXPECTED', message: 'Unexpected code path' })
  })

  // ── PATCH /employees/:id/user-account ──────────────────────────────────────
  fastify.patch('/employees/:id/user-account', auth, async (req, reply) => {
    const { id }   = req.params as { id: string }
    const userRole = (req as any).userRole as string
    const tenantId = (req as any).tenantId as string

    if (!ADMIN_ROLES.includes(userRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'HR Admin access required' })
    }

    const parsed = patchAccountSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid action',
      })
    }

    const { action } = parsed.data
    const is_active  = action === 'reactivate'

    // Look up profile for this employee
    const { data: profile, error: profileErr } = await fastify.supabase
      .from('profiles')
      .select('id, is_active')
      .eq('employee_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (profileErr || !profile) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No user account found for this employee' })
    }

    if (profile.is_active === is_active) {
      return reply.code(409).send({
        error:   'NO_CHANGE',
        message: `Account is already ${action === 'suspend' ? 'suspended' : 'active'}`,
      })
    }

    // Update profiles.is_active
    const { error: updateErr } = await fastify.supabase
      .from('profiles')
      .update({ is_active })
      .eq('id', profile.id)

    if (updateErr) {
      fastify.log.error({ err: updateErr }, 'user-account: update is_active failed')
      return reply.code(500).send({ error: 'DB_ERROR', message: updateErr.message })
    }

    // Also ban/unban in Supabase Auth so JWTs are rejected
    const { error: authUpdateErr } = await fastify.supabase.auth.admin.updateUserById(profile.id, {
      ban_duration: action === 'suspend' ? '876000h' : 'none', // 100 years = effectively permanent
    })

    if (authUpdateErr) {
      fastify.log.warn({ err: authUpdateErr }, 'user-account: auth ban/unban failed — profile updated but auth not synced')
    }

    fastify.log.info({ employeeId: id, profileId: profile.id, action }, `user-account: account ${action}d`)

    return reply.send({ status: action === 'suspend' ? 'suspended' : 'active' })
  })
}
