/**
 * Re-open a submitted pre-joinee invitation so the candidate can revise and
 * re-upload specific documents (the "request re-upload" flow). Shared by the
 * pre-joinee review drawer and the AI-onboarding review workspace.
 */
import type { FastifyInstance } from 'fastify'
import { sendEmail, preJoineeReuploadEmail, APP_PUBLIC_URL } from '../email-service.js'

export interface ReuploadItem {
  document_type: string
  reason:        string
}

export type ReopenResult =
  | { ok: true; invitation_id: string }
  | { ok: false; code: number; error: string; message: string }

/** How long the re-opened link stays valid. */
const REOPEN_DAYS = 14

export async function reopenInvitationForReupload(
  fastify: FastifyInstance,
  tenantId: string,
  invitationId: string,
  items: ReuploadItem[],
  message: string | null,
): Promise<ReopenResult> {
  const { data: inv, error: invErr } = await (fastify as any).supabase
    .from('pre_joinee_invitations')
    .select('id, tenant_id, token, first_name, last_name, email, status')
    .eq('id', invitationId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (invErr) return { ok: false, code: 500, error: 'DB_ERROR', message: invErr.message }
  if (!inv)   return { ok: false, code: 404, error: 'NOT_FOUND', message: 'Invitation not found' }

  // Only a submitted invitation can be sent back for re-upload.
  if (inv.status !== 'submitted') {
    return { ok: false, code: 409, error: 'INVALID_STATE', message: `Cannot request re-upload while the invitation is ${inv.status}` }
  }

  const expiresAt = new Date(Date.now() + REOPEN_DAYS * 86400_000).toISOString()
  const { data: updated, error: updErr } = await (fastify as any).supabase
    .from('pre_joinee_invitations')
    .update({
      status:            'changes_requested',
      requested_changes: items,
      notes:             message ?? null,
      expires_at:        expiresAt,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', invitationId)
    .eq('tenant_id', tenantId)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle()

  if (updErr) return { ok: false, code: 500, error: 'DB_ERROR', message: updErr.message }
  if (!updated) return { ok: false, code: 409, error: 'INVALID_STATE', message: `Cannot request re-upload while the invitation is ${inv.status}` }

  // Notify the candidate (best-effort — never blocks the state change).
  try {
    let companyName = 'the company'
    const { data: tenant } = await (fastify as any).supabase
      .from('tenants').select('name').eq('id', tenantId).maybeSingle()
    if (tenant?.name) companyName = tenant.name

    const candidateName = `${inv.first_name ?? ''} ${inv.last_name ?? ''}`.trim() || 'there'
    const inviteUrl = `${APP_PUBLIC_URL}/pre-join/${inv.token}`
    await sendEmail({
      to: inv.email,
      idempotencyKey: `preboard-reupload:${invitationId}:${expiresAt}`,
      ...preJoineeReuploadEmail({ candidateName, companyName, inviteUrl, items, message }),
    })
  } catch (e) {
    fastify.log.warn({ event: 'pre_joinee.reupload.email', invitation_id: invitationId, err: e })
  }

  return { ok: true, invitation_id: invitationId }
}
