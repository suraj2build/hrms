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

// ── ONB-04: Post-joining welcome email to new employee ─────────────────────────

export function joiningWelcomeEmail(opts: {
  firstName:     string
  employeeCode:  string
  companyName:   string
  joiningDate?:  string
  managerName?:  string
  managerEmail?: string
  loginUrl:      string
}): { subject: string; html: string } {
  const { primary, teal } = brandConfig.colors
  const firstName = opts.firstName || 'there'
  const subject = `Welcome to ${opts.companyName} — your account is ready`
  const html = shell(`
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;">Welcome aboard, ${firstName}! 🎉</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Your joining at <strong>${opts.companyName}</strong> has been confirmed${opts.joiningDate ? ` — joining date <strong>${opts.joiningDate}</strong>` : ''}.
      Your employee ID is <strong>${opts.employeeCode}</strong>.
    </p>
    ${opts.managerName ? `
    <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;margin:0 0 20px;border-left:3px solid ${teal};">
      <p style="margin:0;color:#475569;font-size:13px;"><strong>Reporting Manager:</strong>&nbsp;${opts.managerName}${opts.managerEmail ? ` &mdash; <a href="mailto:${opts.managerEmail}" style="color:${primary};">${opts.managerEmail}</a>` : ''}</p>
    </div>` : ''}
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Access your employee workspace to view payslips, apply for leave, and complete your onboarding checklist.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${opts.loginUrl}"
         style="display:inline-block;background:linear-gradient(135deg,${primary} 0%,${teal} 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 32px;border-radius:999px;">
        Go to My Workspace
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px;">
      If you have any questions reach out to your HR team. We're excited to have you on board.
    </p>
  `)
  return { subject, html }
}

// ── RCT-05: Recruitment stage-change emails ────────────────────────────────────

export function applicationReceivedEmail(opts: {
  candidateName: string
  jobTitle:      string
  companyName:   string
}): { subject: string; html: string } {
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const subject = `Application received — ${opts.jobTitle} at ${opts.companyName}`
  const html = shell(`
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;">Application Received</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hi ${firstName}, thank you for applying for <strong>${opts.jobTitle}</strong> at
      <strong>${opts.companyName}</strong>. We've received your application and our team
      will review it shortly.
    </p>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      We'll be in touch with next steps. In the meantime, feel free to explore other
      opportunities with us.
    </p>
    <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
      Please do not reply to this email — this is an automated notification.
    </p>
  `)
  return { subject, html }
}

export function applicationShortlistedEmail(opts: {
  candidateName: string
  jobTitle:      string
  companyName:   string
}): { subject: string; html: string } {
  const { teal } = brandConfig.colors
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const subject = `You've been shortlisted — ${opts.jobTitle} at ${opts.companyName}`
  const html = shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;background:${teal};color:#fff;font-weight:700;font-size:13px;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;">SHORTLISTED</span>
    </div>
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;text-align:center;">Great news, ${firstName}!</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;text-align:center;">
      You've been shortlisted for <strong>${opts.jobTitle}</strong> at
      <strong>${opts.companyName}</strong>.
    </p>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Our team has reviewed your profile and would like to move forward. Someone from our
      recruitment team will reach out shortly with details about the next steps.
    </p>
    <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
      Please do not reply to this email — this is an automated notification.
    </p>
  `)
  return { subject, html }
}

export function interviewScheduledEmail(opts: {
  candidateName: string
  jobTitle:      string
  companyName:   string
  roundNumber:   number
  interviewType: string
  scheduledAt?:  string | null
  durationMins:  number
  meetLink?:     string | null
  roundTitle?:   string | null
}): { subject: string; html: string } {
  const { primary, teal } = brandConfig.colors
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const typeLabel: Record<string, string> = {
    video: 'Video Call', phone: 'Phone Call',
    in_person: 'In-Person', assignment: 'Assignment',
  }
  const displayType = typeLabel[opts.interviewType] ?? opts.interviewType
  const roundLabel  = opts.roundTitle || `Round ${opts.roundNumber}`

  let dateBlock = ''
  if (opts.scheduledAt) {
    const d = new Date(opts.scheduledAt)
    const formatted = d.toLocaleString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    })
    dateBlock = `<tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:40%;">Date &amp; Time</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;">${formatted} IST</td>
    </tr>`
  }

  const subject = `Interview scheduled — ${opts.jobTitle} at ${opts.companyName}`
  const html = shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;background:${primary};color:#fff;font-weight:700;font-size:13px;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;">INTERVIEW SCHEDULED</span>
    </div>
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;text-align:center;">Hi ${firstName}, you have an interview!</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px;text-align:center;">
      Your interview for <strong>${opts.jobTitle}</strong> at <strong>${opts.companyName}</strong> has been scheduled.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;">
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:40%;">Round</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${roundLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Format</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${displayType}</td>
      </tr>
      ${dateBlock}
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Duration</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${opts.durationMins} minutes</td>
      </tr>
      ${opts.meetLink ? `<tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Meeting Link</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;"><a href="${opts.meetLink}" style="color:${teal};word-break:break-all;">${opts.meetLink}</a></td>
      </tr>` : ''}
    </table>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 8px;">
      Please ensure you are available at the scheduled time. If you need to reschedule,
      contact the recruitment team at your earliest convenience.
    </p>
    <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
      Please do not reply to this email — this is an automated notification.
    </p>
  `)
  return { subject, html }
}

export function panelInterviewNotificationEmail(opts: {
  panelName:     string
  candidateName: string
  jobTitle:      string
  roundNumber:   number
  roundTitle?:   string | null
  interviewType: string
  scheduledAt?:  string | null
  durationMins:  number
  meetLink?:     string | null
}): { subject: string; html: string } {
  const { primary, teal } = brandConfig.colors
  const typeLabel: Record<string, string> = {
    video: 'Video Call', phone: 'Phone Call',
    in_person: 'In-Person', assignment: 'Assignment',
  }
  const displayType = typeLabel[opts.interviewType] ?? opts.interviewType
  const roundLabel  = opts.roundTitle || `Round ${opts.roundNumber}`

  let dateBlock = ''
  if (opts.scheduledAt) {
    const d = new Date(opts.scheduledAt)
    const formatted = d.toLocaleString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
    })
    dateBlock = `<tr>
      <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:40%;">Date &amp; Time</td>
      <td style="padding:8px 12px;border:1px solid #e2e8f0;">${formatted} IST</td>
    </tr>`
  }

  const subject = `Interview panel — ${opts.candidateName} for ${opts.jobTitle}`
  const html = shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;background:${primary};color:#fff;font-weight:700;font-size:13px;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;">PANEL NOTIFICATION</span>
    </div>
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 12px;">Hi ${opts.panelName},</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px;">
      You've been assigned to interview <strong>${opts.candidateName}</strong> for the
      <strong>${opts.jobTitle}</strong> role.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;">
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:40%;">Round</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${roundLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Format</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${displayType}</td>
      </tr>
      ${dateBlock}
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Duration</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${opts.durationMins} minutes</td>
      </tr>
      ${opts.meetLink ? `<tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Meeting Link</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;"><a href="${opts.meetLink}" style="color:${teal};word-break:break-all;">${opts.meetLink}</a></td>
      </tr>` : ''}
    </table>
    <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
      Please do not reply to this email — this is an automated notification.
    </p>
  `)
  return { subject, html }
}

export function offerExtendedEmail(opts: {
  candidateName: string
  jobTitle:      string
  companyName:   string
}): { subject: string; html: string } {
  const { teal } = brandConfig.colors
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const subject = `Offer from ${opts.companyName} — ${opts.jobTitle}`
  const html = shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;background:${teal};color:#fff;font-weight:700;font-size:13px;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;">OFFER EXTENDED</span>
    </div>
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;text-align:center;">Congratulations, ${firstName}! 🎉</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;text-align:center;">
      We are delighted to extend an offer for the <strong>${opts.jobTitle}</strong> position
      at <strong>${opts.companyName}</strong>.
    </p>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Our HR team will reach out to you shortly with the full offer letter and details.
      We look forward to welcoming you to the team!
    </p>
    <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
      Please do not reply to this email — this is an automated notification.
    </p>
  `)
  return { subject, html }
}

export function applicationRejectedEmail(opts: {
  candidateName: string
  jobTitle:      string
  companyName:   string
}): { subject: string; html: string } {
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const subject = `Update on your application — ${opts.jobTitle} at ${opts.companyName}`
  const html = shell(`
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;">Hi ${firstName},</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Thank you for taking the time to apply for <strong>${opts.jobTitle}</strong> at
      <strong>${opts.companyName}</strong> and for the interest you've shown in joining our team.
    </p>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      After careful consideration, we've decided to move forward with other candidates whose
      experience more closely matches the current requirements of the role.
    </p>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0;">
      We appreciate your effort and wish you the very best in your career journey.
    </p>
    <p style="color:#94a3b8;font-size:13px;margin-top:24px;">
      Please do not reply to this email — this is an automated notification.
    </p>
  `)
  return { subject, html }
}

// ── ONB-05: IT provisioning notification to HR/IT team ────────────────────────

export function itProvisioningEmail(opts: {
  employeeName: string
  employeeCode: string
  companyName:  string
  joiningDate?: string
  hrSystemUrl:  string
}): { subject: string; html: string } {
  const { primary } = brandConfig.colors
  const subject = `IT Setup Required — ${opts.employeeName} joining${opts.joiningDate ? ` on ${opts.joiningDate}` : ''}`
  const html = shell(`
    <h1 style="font-size:20px;color:#0f172a;margin:0 0 12px;">New Joiner IT Provisioning</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
      A new employee has been confirmed in ${opts.companyName}. Please complete IT provisioning before their joining date.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:13px;">
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:40%;">Employee</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${opts.employeeName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Employee Code</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${opts.employeeCode}</td>
      </tr>
      ${opts.joiningDate ? `
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Joining Date</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;">${opts.joiningDate}</td>
      </tr>` : ''}
    </table>
    <p style="color:#475569;font-size:13px;font-weight:600;margin:0 0 8px;">Standard Provisioning Checklist:</p>
    <ul style="color:#475569;font-size:13px;line-height:1.8;margin:0 0 20px;padding-left:20px;">
      <li>Create company email account</li>
      <li>Set up laptop / workstation</li>
      <li>Provision system access (HRMS, intranet, relevant tools)</li>
      <li>Add to relevant communication channels (Slack / Teams)</li>
      <li>Configure VPN and security credentials</li>
    </ul>
    <div style="text-align:center;margin:20px 0;">
      <a href="${opts.hrSystemUrl}"
         style="display:inline-block;background:${primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 28px;border-radius:999px;">
        View in HR System
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px;">
      Full onboarding checklist and asset requirements are available in the HR system.
    </p>
  `)
  return { subject, html }
}
