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
    : `<div style="display:inline-block;width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,${primary} 0%,#2392C8 50%,${teal} 100%);margin-bottom:10px;"></div>
       <div style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;line-height:1;">Cognix<span style="color:${teal};">HR</span></div>
       <div style="font-size:11px;color:#94a3b8;margin-top:3px;letter-spacing:0.04em;">${brandConfig.tagline}</div>`
  return `
  <div style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:36px 20px;">
      <div style="text-align:center;margin-bottom:28px;">
        ${logoImg}
      </div>
      <div style="background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e2e8f0;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:20px;line-height:1.6;">
        Cognix<span style="color:${teal};font-weight:700;">HR</span> &nbsp;·&nbsp; ${brandConfig.tagline}<br>
        <span style="font-size:11px;">Questions? <a href="mailto:${brandConfig.supportEmail}" style="color:${primary};text-decoration:none;">${brandConfig.supportEmail}</a></span>
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
  const { primary, teal } = brandConfig.colors
  const html = shell(`
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;">Welcome aboard, ${firstName}! 🎉</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      We're excited to have you join <strong>${opts.companyName}</strong>${opts.joiningDate ? ` on <strong>${opts.joiningDate}</strong>` : ''}.
      To get a head start, please complete your pre-onboarding details — it only takes a few minutes.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${opts.inviteUrl}"
         style="display:inline-block;background:linear-gradient(135deg,${primary} 0%,${teal} 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 32px;border-radius:999px;letter-spacing:0.02em;">
        Complete My Details
      </a>
    </div>
    <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:16px 0 0;">
      Or paste this link into your browser:<br>
      <a href="${opts.inviteUrl}" style="color:${teal};word-break:break-all;">${opts.inviteUrl}</a>
    </p>
    <p style="color:#cbd5e1;font-size:12px;margin-top:20px;">This link is private to you and expires in 30 days.</p>
  `)
  return { subject, html }
}

// ── ONB-04: Post-joining welcome email to new employee ─────────────────────────

export function joiningWelcomeEmail(opts: {
  firstName:        string
  employeeCode:     string
  companyName:      string
  joiningDate?:     string
  managerName?:     string
  managerEmail?:    string
  workstation?:     string   // e.g. "MacBook Pro 14" / "Dell Latitude 5540"
  officeLocation?:  string   // e.g. "Mumbai HQ — Floor 3"
  loginUrl:         string
}): { subject: string; html: string } {
  const { primary, teal } = brandConfig.colors
  const firstName = opts.firstName || 'there'
  const subject = `Welcome to ${opts.companyName} — your account is ready`

  const infoRows: string[] = []
  infoRows.push(`<tr>
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;font-size:13px;width:40%;color:#374151;">Employee ID</td>
    <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;font-weight:700;">${opts.employeeCode}</td>
  </tr>`)
  if (opts.joiningDate) infoRows.push(`<tr>
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;font-size:13px;color:#374151;">Joining Date</td>
    <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${opts.joiningDate}</td>
  </tr>`)
  if (opts.managerName) infoRows.push(`<tr>
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;font-size:13px;color:#374151;">Reporting Manager</td>
    <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${opts.managerName}${opts.managerEmail ? ` &mdash; <a href="mailto:${opts.managerEmail}" style="color:${primary};">${opts.managerEmail}</a>` : ''}</td>
  </tr>`)
  if (opts.workstation) infoRows.push(`<tr>
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;font-size:13px;color:#374151;">Workstation</td>
    <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${opts.workstation}</td>
  </tr>`)
  if (opts.officeLocation) infoRows.push(`<tr>
    <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;font-size:13px;color:#374151;">Office Location</td>
    <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${opts.officeLocation}</td>
  </tr>`)

  const html = shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;background:linear-gradient(135deg,${primary} 0%,${teal} 100%);color:#fff;font-weight:700;font-size:12px;padding:4px 14px;border-radius:999px;letter-spacing:0.5px;">WELCOME ABOARD</span>
    </div>
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 10px;text-align:center;">Hi ${firstName}, you're all set! 🎉</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center;">
      Your joining at <strong>${opts.companyName}</strong> has been confirmed. Here are your Day 1 details:
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;border-radius:8px;overflow:hidden;">
      ${infoRows.join('')}
    </table>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
      Use the link below to access your employee workspace — view payslips, apply for leave,
      check your schedule, and complete your onboarding checklist.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${opts.loginUrl}"
         style="display:inline-block;background:linear-gradient(135deg,${primary} 0%,${teal} 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:999px;letter-spacing:0.02em;">
        Open My Workspace
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:20px;text-align:center;line-height:1.6;">
      If you have any questions your HR team is here to help.<br>
      We're thrilled to have you on the team!
    </p>
  `)
  return { subject, html }
}

// ── RCT-05: Recruitment stage-change emails ────────────────────────────────────

export function applicationReceivedEmail(opts: {
  candidateName: string
  jobTitle:      string
  companyName:   string
  portalUrl?:    string
}): { subject: string; html: string } {
  const { teal } = brandConfig.colors
  const firstName = opts.candidateName.split(' ')[0] || 'there'
  const subject = `Application received — ${opts.jobTitle} at ${opts.companyName}`
  const portalBlock = opts.portalUrl ? `
    <div style="text-align:center;margin:24px 0;">
      <a href="${opts.portalUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#2E6FE6 0%,${teal} 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 28px;border-radius:999px;">
        Track Your Application
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0 0 16px;">
      Or visit: <a href="${opts.portalUrl}" style="color:${teal};word-break:break-all;">${opts.portalUrl}</a>
    </p>` : ''
  const html = shell(`
    <h1 style="font-size:22px;color:#0f172a;margin:0 0 12px;">Application Received</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hi ${firstName}, thank you for applying for <strong>${opts.jobTitle}</strong> at
      <strong>${opts.companyName}</strong>. We've received your application and our team
      will review it shortly.
    </p>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 4px;">
      We'll be in touch with next steps. You can track your application status using the link below.
    </p>
    ${portalBlock}
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

// ── ONB-05b: Buddy assignment notification to the assigned buddy ───────────────

export function buddyAssignmentEmail(opts: {
  buddyName:       string
  newJoinerName:   string
  newJoinerRole?:  string
  companyName:     string
  joiningDate?:    string
  hrSystemUrl:     string
}): { subject: string; html: string } {
  const { primary, teal } = brandConfig.colors
  const buddyFirst  = opts.buddyName.split(' ')[0] || opts.buddyName
  const joinerFirst = opts.newJoinerName.split(' ')[0] || opts.newJoinerName
  const subject = `You've been assigned as buddy — ${opts.newJoinerName} is joining${opts.joiningDate ? ` on ${opts.joiningDate}` : ''}`
  const html = shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <span style="display:inline-block;background:linear-gradient(135deg,${primary} 0%,${teal} 100%);color:#fff;font-weight:700;font-size:12px;padding:4px 14px;border-radius:999px;letter-spacing:0.5px;">BUDDY ASSIGNMENT</span>
    </div>
    <h1 style="font-size:21px;color:#0f172a;margin:0 0 10px;">Hi ${buddyFirst}, meet your new buddy! 👋</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px;">
      You've been selected as the onboarding buddy for <strong>${opts.newJoinerName}</strong>${opts.newJoinerRole ? `, joining as <strong>${opts.newJoinerRole}</strong>` : ''} at
      <strong>${opts.companyName}</strong>${opts.joiningDate ? ` on <strong>${opts.joiningDate}</strong>` : ''}.
    </p>
    <div style="background:#f0fdf8;border-radius:10px;padding:16px 20px;margin:0 0 20px;border-left:4px solid ${teal};">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0f172a;">Your role as buddy:</p>
      <ul style="color:#475569;font-size:13px;line-height:1.9;margin:0;padding-left:18px;">
        <li>Welcome ${joinerFirst} on their first day and introduce them to the team</li>
        <li>Help them navigate the workplace, tools, and processes</li>
        <li>Be the go-to person for informal questions during their first 30 days</li>
        <li>Check in regularly and share feedback with HR if needed</li>
      </ul>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${opts.hrSystemUrl}"
         style="display:inline-block;background:linear-gradient(135deg,${primary} 0%,${teal} 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:999px;">
        View in HR System
      </a>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center;">
      Thank you for helping ${joinerFirst} feel welcome at ${opts.companyName}!
    </p>
  `)
  return { subject, html }
}
