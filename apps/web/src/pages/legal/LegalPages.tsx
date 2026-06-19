/**
 * Public legal pages — Terms of Service & Privacy Policy.
 *
 * Routed at /terms and /privacy (linked from the auth footers). Content is a
 * solid SaaS baseline tailored to CognixHR (a Saar HRMS application) and should
 * be reviewed by legal counsel before launch. Styled with design tokens so it
 * follows the active theme.
 */
import { Link } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'

const UPDATED = 'June 2026'
const CONTACT = 'support@cognixhr.com'

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link to="/" aria-label="CognixHR home"><Logo /></Link>
          <Link to="/login" className="text-sm font-medium text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {UPDATED}</p>
        <div className="prose-legal mt-8 space-y-6 text-[14.5px] leading-relaxed text-foreground/90">
          {children}
        </div>
        <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
          © {new Date().getFullYear()} CognixHR · Saar HRMS · Questions? <a className="text-primary hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
          <span className="mx-2">·</span>
          <Link to="/terms" className="text-primary hover:underline">Terms</Link>
          <span className="mx-1">·</span>
          <Link to="/privacy" className="text-primary hover:underline">Privacy</Link>
        </footer>
      </main>
    </div>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold text-foreground !mt-10">{children}</h2>
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These Terms of Service ("Terms") govern your access to and use of CognixHR, a
        human-resource management platform provided by Saar ("we", "us"). By creating an
        account or using the service you agree to these Terms on behalf of yourself and the
        organisation you represent ("Customer").
      </p>

      <H>1. The Service &amp; Accounts</H>
      <p>
        CognixHR is provided as a multi-tenant subscription service. The Customer is
        responsible for the accuracy of the data it submits, for maintaining the
        confidentiality of account credentials, and for all activity under its accounts.
        You must be authorised to bind your organisation to these Terms.
      </p>

      <H>2. Subscriptions &amp; Billing</H>
      <p>
        Paid plans are billed in advance on a recurring basis at the rates shown at
        sign-up. Unless stated otherwise, fees are non-refundable and exclusive of taxes.
        We may change pricing with reasonable prior notice effective on your next renewal.
        Failure to pay may result in suspension of access.
      </p>

      <H>3. Acceptable Use</H>
      <p>
        You agree not to misuse the service, including by attempting to gain unauthorised
        access, interfering with other tenants, uploading unlawful content, or using the
        platform to violate applicable employment, data-protection, or payroll laws.
      </p>

      <H>4. Customer Data</H>
      <p>
        As between the parties, the Customer owns the data it submits. We process that data
        only to provide and improve the service, in accordance with our Privacy Policy.
        Tenant data is logically isolated and access-controlled.
      </p>

      <H>5. Availability &amp; Support</H>
      <p>
        We aim to keep the service available and to provide support via {CONTACT}, but the
        service is provided on an "as is" and "as available" basis without uptime warranty
        unless agreed in a separate enterprise agreement.
      </p>

      <H>6. Termination</H>
      <p>
        Either party may terminate for material breach not cured within 30 days. On
        termination, access ceases and Customer data may be deleted after a reasonable
        retention window; you may request an export beforehand.
      </p>

      <H>7. Liability</H>
      <p>
        To the maximum extent permitted by law, our aggregate liability is limited to the
        fees paid in the 12 months preceding the claim, and we are not liable for indirect
        or consequential damages.
      </p>

      <H>8. Changes &amp; Contact</H>
      <p>
        We may update these Terms; material changes will be notified. Continued use after
        changes constitutes acceptance. Questions: <a className="text-primary hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalShell>
  )
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This Privacy Policy explains how CognixHR (Saar) collects, uses, and protects
        personal information when you use our HR management platform. We act as a data
        processor for employee data submitted by Customer organisations, and as a
        controller for account and billing information.
      </p>

      <H>1. Information We Collect</H>
      <p>
        Account details (name, work email, organisation), authentication data, and the HR
        data your organisation chooses to manage in the platform (e.g. employee records,
        attendance, payroll, leave). We also collect limited technical/usage data to
        operate and secure the service.
      </p>

      <H>2. How We Use It</H>
      <p>
        To provide, secure, and improve the service; to process subscriptions; to provide
        support; and to comply with legal obligations. We do not sell personal data.
      </p>

      <H>3. Data Isolation &amp; Security</H>
      <p>
        Tenant data is isolated per organisation and protected by row-level security and
        role-based access controls. We apply industry-standard safeguards; however, no
        method of transmission or storage is completely secure.
      </p>

      <H>4. Sub-processors</H>
      <p>
        We use reputable infrastructure and service providers (e.g. cloud hosting,
        database, transactional email, payment processing) to deliver the service. These
        providers process data only as needed to perform their functions.
      </p>

      <H>5. Data Retention</H>
      <p>
        We retain Customer data for the duration of the subscription and a reasonable
        period thereafter, unless deletion is requested. Backups are purged on a rolling
        schedule.
      </p>

      <H>6. Your Rights</H>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct, export, or
        delete personal data. Employees should direct such requests to their employer (the
        controller); Customers can contact us to assist.
      </p>

      <H>7. Contact</H>
      <p>
        For privacy questions or requests, contact <a className="text-primary hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </LegalShell>
  )
}
