/**
 * EssPolicies — /ess/policies
 *
 * Company policy documents hub for employees. Shows policy categories
 * with counts and allows browsing policy documents. Since policies
 * are typically stored as documents in the system or as static content,
 * this page shows the available HR document types + a reference list.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState } from 'react'
import {
  Shield, Clock, Users, CreditCard,
  FileText, ChevronRight, Info, ExternalLink,
  Building2, Heart, GraduationCap,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PolicyCategory {
  key:         string
  icon:        React.ComponentType<{ className?: string }>
  title:       string
  description: string
  policies:    { title: string; summary: string; effective?: string }[]
}

// ── Policy data ────────────────────────────────────────────────────────────────
// Static policy reference — HR uploads actual documents separately.

const POLICY_CATEGORIES: PolicyCategory[] = [
  {
    key: 'leave',
    icon: Clock,
    title: 'Leave & Attendance',
    description: 'Leave entitlements, attendance rules, and work schedule policies',
    policies: [
      {
        title: 'Leave Policy',
        summary: 'Annual, sick, casual, and special leave entitlements, application process, and approval workflow.',
      },
      {
        title: 'Attendance Policy',
        summary: 'Working hours, late arrival, absenteeism, and remote work guidelines.',
      },
      {
        title: 'Holiday Calendar Policy',
        summary: 'Mandatory holidays, optional holidays, and restricted holiday procedures.',
      },
    ],
  },
  {
    key: 'compensation',
    icon: CreditCard,
    title: 'Compensation & Benefits',
    description: 'Salary, allowances, reimbursements, and benefits structure',
    policies: [
      {
        title: 'Salary & Compensation Policy',
        summary: 'Pay structure, components, CTC calculation, and increment cycle.',
      },
      {
        title: 'Reimbursement Policy',
        summary: 'Expense categories, claim limits, submission process, and approval timelines.',
      },
      {
        title: 'Travel & Conveyance Policy',
        summary: 'Business travel entitlements, per diem rates, and booking procedures.',
      },
    ],
  },
  {
    key: 'conduct',
    icon: Shield,
    title: 'Code of Conduct',
    description: 'Professional standards, ethics, and disciplinary guidelines',
    policies: [
      {
        title: 'Employee Code of Conduct',
        summary: 'Professional behaviour, workplace ethics, conflict of interest, and disciplinary process.',
      },
      {
        title: 'POSH Policy (Anti-Harassment)',
        summary: 'Prevention of sexual harassment at workplace — definitions, reporting process, and committee details.',
      },
      {
        title: 'IT & Data Security Policy',
        summary: 'Acceptable use of company IT assets, data handling, and security protocols.',
      },
    ],
  },
  {
    key: 'recruitment',
    icon: Users,
    title: 'Recruitment & Onboarding',
    description: 'Hiring, onboarding, probation, and exit procedures',
    policies: [
      {
        title: 'Recruitment Policy',
        summary: 'Hiring process, referral guidelines, and background verification requirements.',
      },
      {
        title: 'Onboarding Policy',
        summary: 'Induction process, probation period, confirmation criteria, and buddy programme.',
      },
      {
        title: 'Exit & Separation Policy',
        summary: 'Resignation process, notice period, clearance, and full & final settlement timeline.',
      },
    ],
  },
  {
    key: 'learning',
    icon: GraduationCap,
    title: 'Learning & Development',
    description: 'Training, skill development, and certification support',
    policies: [
      {
        title: 'Training & Development Policy',
        summary: 'Learning budget, mandatory training, certification reimbursement, and study leave.',
      },
      {
        title: 'Performance Management Policy',
        summary: 'Goal setting, review cycles, rating criteria, and performance improvement process.',
      },
    ],
  },
  {
    key: 'health',
    icon: Heart,
    title: 'Health & Wellness',
    description: 'Medical insurance, wellness programmes, and safety protocols',
    policies: [
      {
        title: 'Health Insurance Policy',
        summary: 'Medical cover, dependant inclusion, claim process, and network hospitals.',
      },
      {
        title: 'Workplace Safety Policy',
        summary: 'Safety guidelines, emergency procedures, and incident reporting.',
      },
    ],
  },
]

// ── Category card ──────────────────────────────────────────────────────────────

function CategoryCard({
  cat, active, onClick,
}: {
  cat:     PolicyCategory
  active:  boolean
  onClick: () => void
}) {
  const Icon = cat.icon
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border p-4 transition-all space-y-1',
        active
          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
          : 'border-border bg-card hover:bg-muted/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 flex-shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
          <p className={cn('text-xs font-semibold', active ? 'text-primary' : 'text-foreground')}>
            {cat.title}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge variant={active ? 'default' : 'secondary'} className="rounded-full text-[10px]">
            {cat.policies.length}
          </Badge>
          <ChevronRight className={cn('h-3 w-3', active ? 'text-primary' : 'text-muted-foreground')} />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground pl-6">{cat.description}</p>
    </button>
  )
}

// ── Policy item ────────────────────────────────────────────────────────────────

function PolicyItem({ policy }: { policy: { title: string; summary: string; effective?: string } }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2 hover:bg-muted/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <p className="text-sm font-semibold text-foreground">{policy.title}</p>
        </div>
        <button className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title="View document">
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground pl-6">{policy.summary}</p>
      {policy.effective && (
        <p className="text-[10px] text-muted-foreground pl-6">Effective: {policy.effective}</p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssPolicies() {
  const [activeCat, setActiveCat] = useState(POLICY_CATEGORIES[0].key)

  const current = POLICY_CATEGORIES.find(c => c.key === activeCat) ?? POLICY_CATEGORIES[0]
  const Icon = current.icon

  return (
    <PageContainer>
      <PageHeader
        title="Company Policies"
        subtitle="HR policies, codes of conduct, and employee guidelines"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* ── Category list ──────────────────────────────────────────────── */}
        <div className="space-y-2">
          {POLICY_CATEGORIES.map(cat => (
            <CategoryCard
              key={cat.key}
              cat={cat}
              active={activeCat === cat.key}
              onClick={() => setActiveCat(cat.key)}
            />
          ))}
        </div>

        {/* ── Policy detail ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <SectionCard
            title={current.title}
            icon={<Icon className="h-4 w-4 text-muted-foreground" />}
          >
            <p className="text-xs text-muted-foreground mb-4">{current.description}</p>
            <div className="space-y-3">
              {current.policies.map(p => (
                <PolicyItem key={p.title} policy={p} />
              ))}
            </div>

            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
              <span>
                Policy documents are maintained by HR. For the latest version or queries, raise an HR support ticket.
              </span>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Bottom note ───────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Building2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
        <span>
          All employees are expected to read and comply with the above policies. Violations may be subject to disciplinary action as per the Code of Conduct.
        </span>
      </div>
    </PageContainer>
  )
}
