/**
 * EssHRSupport — /ess/hr-support
 *
 * HR support hub for employees:
 * - Quick reference contacts (HR team)
 * - Raise a support topic (informational — directs to right channel)
 * - FAQ accordion with common HR queries
 *
 * Read-oriented: no mutations. Tokens only — no raw hex / bg-gray-*.
 */

import { useState } from 'react'
import {
  HeadphonesIcon, Mail, Phone, ChevronDown, ChevronUp,
  Info, MessageSquare, AlertCircle, BookOpen,
  UserCheck, CalendarDays, CreditCard, FileText, Shield,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FAQItem {
  q: string
  a: string
  tag: string
}

interface SupportTopic {
  icon:     React.ComponentType<{ className?: string }>
  title:    string
  desc:     string
  channel:  string
  urgency:  'normal' | 'urgent'
}

// ── Static data ───────────────────────────────────────────────────────────────

const SUPPORT_TOPICS: SupportTopic[] = [
  {
    icon: CreditCard,
    title: 'Payroll Discrepancy',
    desc: 'Salary amount incorrect, missing reimbursement, or TDS issue',
    channel: 'Email payroll@company.com with your payslip screenshot',
    urgency: 'urgent',
  },
  {
    icon: CalendarDays,
    title: 'Leave / Attendance Issue',
    desc: 'Leave not credited, attendance mismatch, or correction needed',
    channel: 'Raise an attendance correction request from My Attendance page',
    urgency: 'normal',
  },
  {
    icon: FileText,
    title: 'Document Request',
    desc: 'Experience letter, salary certificate, NOC, or employment proof',
    channel: 'Email hr@company.com — allow 3 working days for processing',
    urgency: 'normal',
  },
  {
    icon: UserCheck,
    title: 'Profile Update',
    desc: 'Name change, address update, bank details, or statutory numbers',
    channel: 'Submit the relevant form to your HR BP with supporting documents',
    urgency: 'normal',
  },
  {
    icon: Shield,
    title: 'Grievance / POSH',
    desc: 'Workplace grievance, discrimination, or harassment concern',
    channel: 'Email posh@company.com or speak directly to the POSH Committee',
    urgency: 'urgent',
  },
  {
    icon: BookOpen,
    title: 'Policy Clarification',
    desc: 'Need clarity on a policy, benefit, or entitlement',
    channel: 'Review the Policies page first, then email hr@company.com',
    urgency: 'normal',
  },
]

const FAQS: FAQItem[] = [
  {
    q: 'When is my salary credited?',
    a: 'Salary is typically credited on the last working day of each month. Your payslip will be available in the My Payslips section once payroll processing is complete.',
    tag: 'Payroll',
  },
  {
    q: 'How do I apply for leave?',
    a: 'Go to Leave → Apply Leave from the sidebar. Select the leave type, dates, and reason. Your manager will receive an approval request automatically.',
    tag: 'Leave',
  },
  {
    q: 'My attendance punch is missing — what do I do?',
    a: 'Navigate to Attendance → Corrections from the sidebar and submit a correction request with the correct check-in and check-out times. HR will review and apply the correction.',
    tag: 'Attendance',
  },
  {
    q: 'How do I claim a reimbursement?',
    a: 'Go to Payroll → Reimbursements from the sidebar. Click "New Claim", select the expense category, enter the amount, and submit. Keep original receipts ready for verification.',
    tag: 'Payroll',
  },
  {
    q: 'When will my leaves reset (carry forward)?',
    a: 'Leave balances are reviewed annually. Carry-forward rules vary by leave type as per company policy. Contact HR for your specific entitlement details.',
    tag: 'Leave',
  },
  {
    q: 'How do I change my tax regime declaration?',
    a: 'Go to Payroll → Tax Declarations from the sidebar. You can change your regime election before it is locked for the financial year. Contact HR if the lock date has passed.',
    tag: 'Tax',
  },
  {
    q: 'How long does it take to get an experience letter?',
    a: 'Standard turnaround is 3 working days after a formal request to hr@company.com. Urgent requests may be accommodated with prior approval.',
    tag: 'Documents',
  },
  {
    q: 'How do I update my bank account for salary?',
    a: 'Submit a written request to your HR BP along with a cancelled cheque or passbook copy. Changes take effect from the next payroll cycle after verification.',
    tag: 'Profile',
  },
]

const TAG_VARIANT: Record<string, 'default' | 'secondary' | 'warning' | 'info' | 'success'> = {
  Payroll:    'success',
  Leave:      'info',
  Attendance: 'warning',
  Tax:        'secondary',
  Documents:  'default',
  Profile:    'secondary',
}

// ── FAQ accordion item ────────────────────────────────────────────────────────

function FAQRow({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between gap-3 py-3 text-left"
      >
        <div className="flex items-start gap-2">
          <Badge
            variant={(TAG_VARIANT[item.tag] ?? 'secondary') as any}
            className="rounded-full text-[9px] mt-0.5 flex-shrink-0"
          >
            {item.tag}
          </Badge>
          <span className="text-xs font-medium text-foreground">{item.q}</span>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />}
      </button>
      {open && (
        <p className="text-xs text-muted-foreground pb-3 pl-0 leading-relaxed">{item.a}</p>
      )}
    </div>
  )
}

// ── Support topic card ────────────────────────────────────────────────────────

function TopicCard({ topic }: { topic: SupportTopic }) {
  const Icon = topic.icon
  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-2 transition-colors',
      topic.urgency === 'urgent'
        ? 'border-warning/25 bg-warning/5'
        : 'border-border bg-card',
    )}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4 flex-shrink-0', topic.urgency === 'urgent' ? 'text-warning' : 'text-muted-foreground')} />
        <p className="text-xs font-semibold text-foreground">{topic.title}</p>
        {topic.urgency === 'urgent' && (
          <Badge variant="warning" className="ml-auto rounded-full text-[9px]">Urgent</Badge>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">{topic.desc}</p>
      <div className="flex items-start gap-1.5 pt-1">
        <MessageSquare className="h-3 w-3 text-info flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-info">{topic.channel}</p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssHRSupport() {
  return (
    <PageContainer>
      <PageHeader
        title="HR Support"
        subtitle="Get help, raise concerns, and find answers to common questions"
      />

      {/* ── Emergency / important contacts ─────────────────────────────────── */}
      <SectionCard
        title="HR Contacts"
        icon={<HeadphonesIcon className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { role: 'HR Helpdesk',    email: 'hr@company.com',       phone: '+91 1800-XXX-XXXX', badge: 'General' },
            { role: 'Payroll Team',   email: 'payroll@company.com',  phone: '+91 98XX-XXXXXX',   badge: 'Payroll' },
            { role: 'POSH Committee', email: 'posh@company.com',     phone: 'Confidential',       badge: 'Urgent', badgeVariant: 'destructive' },
          ].map(c => (
            <div key={c.role} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">{c.role}</p>
                <Badge variant={(c.badgeVariant ?? 'secondary') as any} className="rounded-full text-[9px]">{c.badge}</Badge>
              </div>
              <div className="space-y-1">
                <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 text-[10px] text-info hover:underline">
                  <Mail className="h-3 w-3" />{c.email}
                </a>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Phone className="h-3 w-3" />{c.phone}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
          <span>HR Helpdesk is available Mon–Fri, 9 AM – 6 PM IST. For urgent matters, use the direct lines above.</span>
        </div>
      </SectionCard>

      {/* ── Support topics ─────────────────────────────────────────────────── */}
      <SectionCard
        title="What do you need help with?"
        icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUPPORT_TOPICS.map(t => <TopicCard key={t.title} topic={t} />)}
        </div>
      </SectionCard>

      {/* ── FAQ ────────────────────────────────────────────────────────────── */}
      <SectionCard
        title="Frequently Asked Questions"
        icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
      >
        <div>
          {FAQS.map(f => <FAQRow key={f.q} item={f} />)}
        </div>
      </SectionCard>

      {/* ── Bottom note ────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          For issues not listed above, email <strong>hr@company.com</strong> with your employee code and a brief description. Response time is within 2 working days.
        </span>
      </div>
    </PageContainer>
  )
}
