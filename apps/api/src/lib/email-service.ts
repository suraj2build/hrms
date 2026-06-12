/**
 * Email service — Resend REST API (no SDK; plain fetch).
 *
 * Config via env (set in Railway):
 *   RESEND_API_KEY   — Resend API key (required to actually send)
 *   EMAIL_FROM       — sender, e.g. "CognixHR <noreply@yourdomain.com>"
 *                      defaults to Resend's shared test sender
 *   APP_PUBLIC_URL   — public web app base, e.g. https://hrms-web-alpha.vercel.app
 *                      (used to build candidate links)
 *
 * If RESEND_API_KEY is unset, sends are skipped gracefully (logged) so the
 * rest of the flow (e.g. invite creation) never fails because of email.
 */

import { brandConfig } from './brand-config.js'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export const APP_PUBLIC_URL =
  process.env.APP_PUBLIC_URL ?? 'https://hrms-web-alpha.vercel.app'

const DEFAULT_FROM = process.env.EMAIL_FROM ?? `${brandConfig.productName} <onboarding@resend.dev>`

export interface SendEmailInput {
  to:      string | string[]
  subject: string
  html:    string
  from?:   string
}

export interface SendEmailResult {
  sent:    boolean
  id?:     string
  skipped?: boolean
  error?:  string
}

/** Low-level send. Never throws — returns a result object. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping send to', input.to)
    return { sent: false, skipped: true }
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    input.from ?? DEFAULT_FROM,
        to:      Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html:    input.html,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[email] Resend send failed', res.status, body)
      return { sent: false, error: `Resend ${res.status}: ${body}` }
    }

    const data = await res.json().catch(() => ({})) as { id?: string }
    return { sent: true, id: data.id }
  } catch (err) {
    console.error('[email] send threw', err)
    return { sent: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

// ── Branded templates ──────────────────────────────────────────────────────────

function shell(bodyHtml: string): string {
  const { primary, teal } = brandConfig.colors
  const logoImg = brandConfig.assets.logoUrl
    ? `<img src="${brandConfig.assets.logoUrl}" alt="${brandConfig.productName}" style="height:36px;width:auto;display:block;margin:0 auto;" />`
    : `<div style="display:inline-block;width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,${primary} 0%,#2392C8 50%,${teal} 100%);"></div>
       <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:8px;letter-spacing:-0.5px;">${brandConfig.productName}</div>`
  return `
  <div style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="text-align:center;margin-bottom:24px;">
        ${logoImg}
      </div>
      <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:20px;">
        ${brandConfig.productName} — ${brandConfig.tagline}
      </p>
    </div>
  </div>`
}

export function preJoineeInviteEmail(opts: {
  candidateName: string
  companyName:   string
  joiningDate:   string
  inviteUrl:     string
}): { subject: string; html: string } {
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const subject = `Welcome to ${opts.companyName} — complete your onboarding`
  const html = shell(`
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;">Welcome aboard, ${firstName}! 🎉</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      We're excited to have you join <strong>${opts.companyName}</strong>${opts.joiningDate ? ` on <strong>${opts.joiningDate}</strong>` : ''}.
      To get a head start, please complete your pre-onboarding details — it only takes a few minutes.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${opts.inviteUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#047857 0%,#0F766E 50%,#1E40AF 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 32px;border-radius:999px;">
        Complete My Details
      </a>
    </div>
    <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:16px 0 0;">
      Or paste this link into your browser:<br>
      <a href="${opts.inviteUrl}" style="color:#0F766E;word-break:break-all;">${opts.inviteUrl}</a>
    </p>
    <p style="color:#cbd5e1;font-size:12px;margin-top:20px;">This link is private to you and expires in 30 days.</p>
  `)
  return { subject, html }
}
