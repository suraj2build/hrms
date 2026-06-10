/**
 * ReportingHub — Central directory for all reporting surfaces.
 * /admin/reports
 *
 * 4 sections:
 *   1. Operational Reports  — tab-based HR reports (headcount, attendance, payroll, statutory…)
 *   2. Analytics            — deep-dive analytics surfaces
 *   3. Executive            — strategic read-outs
 *   4. Explorer             — placeholder for future ad-hoc querying
 *
 * Quick-glance stats powered by canonical dataset hooks (single cache source).
 */

import { Link } from 'react-router-dom'
import {
  Users, Clock, Briefcase, ShieldCheck, CalendarDays,
  Banknote, BookOpen, ArrowLeftRight, CreditCard,
  BarChart3, TrendingUp, LineChart, DollarSign,
  Sparkles, FileText, Brain, ArrowRight, Database,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHeadcountDataset }   from '@/lib/datasets/headcount'
import { useAttendanceDataset }  from '@/lib/datasets/attendance'
import { usePayrollCostDataset } from '@/lib/datasets/payroll-cost'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'

// ── Helpers ───────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmt(n: number | undefined, decimals = 0): string {
  if (n === undefined || n === null) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: decimals })
}

// ── Section model ─────────────────────────────────────────────────────────────

interface ReportLink {
  label:       string
  description: string
  route:       string
  icon:        React.ComponentType<{ className?: string }>
  badge?:      string
}

interface ReportSection {
  id:      string
  label:   string
  blurb:   string
  accent:  { tile: string; text: string; border: string }
  links:   ReportLink[]
}

const SECTIONS: ReportSection[] = [
  {
    id:    'operational',
    label: 'Operational Reports',
    blurb: 'Standard HR registers — headcount, attendance, payroll, statutory compliance and more.',
    accent: { tile: 'bg-blue-500/10', text: 'text-blue-600', border: 'hover:border-blue-300' },
    links: [
      { label: 'Headcount & Attrition',    description: 'Workforce visibility · joiner / separation trend',          route: '/admin/reports/operational?tab=headcount',        icon: Users         },
      { label: 'Attendance & LOP',          description: 'Per-employee attendance · loss-of-pay analysis',            route: '/admin/reports/operational?tab=attendance',       icon: Clock         },
      { label: 'Salary Register',           description: 'Monthly CTC · component breakdown · payroll base',         route: '/admin/reports/operational?tab=salary',           icon: Briefcase     },
      { label: 'Statutory Compliance',      description: 'PF · ESI · PT · LWF register (India)',                     route: '/admin/reports/operational?tab=statutory',        icon: ShieldCheck   },
      { label: 'Muster Roll',               description: 'Daily attendance grid · .xlsx export · server-generated',  route: '/admin/reports/operational?tab=muster',           icon: CalendarDays  },
      { label: 'Salary Sheet',              description: 'Processed payslip register · earnings & deductions',       route: '/admin/reports/operational?tab=salary-sheet',     icon: Banknote      },
      { label: 'Leave Register',            description: 'Leave request log · employee summary pivot · .xlsx',       route: '/admin/reports/operational?tab=leave-register',   icon: BookOpen      },
      { label: 'Att. vs Payroll',           description: 'Cross-module reconciliation · mismatch detection · .xlsx', route: '/admin/reports/operational?tab=comparison',       icon: ArrowLeftRight },
      { label: 'Payroll Register',          description: 'Bank disbursement register · masked preview · full .xlsx', route: '/admin/reports/operational?tab=payroll-register', icon: CreditCard    },
    ],
  },
  {
    id:    'analytics',
    label: 'Analytics',
    blurb: 'Deep-dive analytics surfaces — cost intelligence, workforce patterns, compliance posture.',
    accent: { tile: 'bg-violet-500/10', text: 'text-violet-600', border: 'hover:border-violet-300' },
    links: [
      { label: 'Analytics Studio',     description: 'Explore payroll, headcount & attendance data by dimension, metric and time range.', route: '/admin/reports/analytics',            icon: Sparkles, badge: 'New' },
      { label: 'Workforce Analytics',  description: 'Headcount distribution, reliability and movement patterns.',                        route: '/admin/analytics/workforce',          icon: LineChart  },
      { label: 'Cost Intelligence',    description: 'Manpower cost breakdown by department and employment type.',                        route: '/admin/payroll/cost-intelligence',    icon: DollarSign },
      { label: 'Attendance Analytics', description: 'Session-level intelligence, biometric trends and gaps.',                            route: '/admin/attendance/intelligence-center', icon: BarChart3  },
    ],
  },
  {
    id:    'executive',
    label: 'Executive',
    blurb: 'Board-level and strategic read-outs for leadership.',
    accent: { tile: 'bg-primary/10', text: 'text-primary', border: 'hover:border-primary/30' },
    links: [
      { label: 'Executive Intelligence', description: 'CEO & CHRO strategic read-out — workforce, financial and compliance posture.',   route: '/admin/executive',                    icon: Sparkles  },
      { label: 'Org Health',             description: 'Headcount by department, joiners vs exits, six-month growth trend.',            route: '/admin/intelligence/org-health',      icon: TrendingUp },
      { label: 'Monthly Narrative',      description: 'Plain-language story of how the workforce changed this period.',                route: '/admin/intelligence/narratives',       icon: FileText  },
      { label: 'Workforce Command',      description: 'Live, prioritised observations — what changed and what to act on.',            route: '/admin/intelligence/workforce-command', icon: Brain     },
    ],
  },
  {
    id:    'explorer',
    label: 'Explorer',
    blurb: 'Ad-hoc dataset querying — group, drill and export across every canonical dataset.',
    accent: { tile: 'bg-emerald-500/10', text: 'text-emerald-600', border: 'border-emerald-500/20' },
    links: [
      { label: 'Data Explorer', description: 'Group by any dimension, drill row-by-row to the employee list, export CSV / Excel — across People, Payroll, Attendance, Leave, Separation & Assets.', route: '/admin/explorer', icon: Database, badge: 'New' },
    ],
  },
]

// ── Quick-glance stat tile ────────────────────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</p>
      <p className="text-lg font-bold text-foreground leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

// ── ReportingHub ──────────────────────────────────────────────────────────────

export function ReportingHub() {
  const month = currentMonth()

  const { data: hc }   = useHeadcountDataset({ month })
  const { data: att }  = useAttendanceDataset({ month })
  const { data: cost } = usePayrollCostDataset({ month })

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        subtitle="All reporting, analytics and executive views in one place"
        breadcrumb={[{ label: 'Reports' }]}
      />

      {/* ── Quick-glance stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <StatTile
          label="Active Headcount"
          value={fmt(hc?.snapshot.active)}
          sub={hc ? `+${hc.snapshot.joiners} joined · ${hc.snapshot.exits} left` : undefined}
        />
        <StatTile
          label="Avg Attendance"
          value={att ? `${fmt(att.summary.avg_attendance_rate, 1)}%` : '—'}
          sub={att ? `${fmt(att.summary.total_lop_days, 1)} LOP days` : undefined}
        />
        <StatTile
          label="Payroll (Gross)"
          value={cost ? `₹${fmt(cost.summary.total_gross)}` : '—'}
          sub={cost?.mom_variance
            ? `${cost.mom_variance.variance_pct >= 0 ? '+' : ''}${fmt(cost.mom_variance.variance_pct, 1)}% MoM`
            : undefined}
        />
        <StatTile
          label="Attrition Rate"
          value={hc ? `${fmt(hc.snapshot.attrition_rate, 1)}%` : '—'}
          sub={month}
        />
      </div>

      {/* ── Report sections ────────────────────────────────────────────── */}
      <div className="space-y-8">
        {SECTIONS.map(section => (
          <div key={section.id}>
            {/* Section header */}
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="text-sm font-semibold text-foreground">{section.label}</h2>
              <p className="text-xs text-muted-foreground hidden sm:block">{section.blurb}</p>
            </div>

            {/* Link grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {section.links.map(link => (
                <Link
                  key={link.label}
                  to={link.route}
                  className={cn(
                    'group flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors',
                    link.route === '#'
                      ? 'opacity-60 cursor-not-allowed pointer-events-none'
                      : 'hover:bg-muted/50',
                    section.accent.border,
                  )}
                >
                  {/* Icon tile */}
                  <span className={cn(
                    'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md',
                    section.accent.tile,
                    section.accent.text,
                  )}>
                    <link.icon className="h-3.5 w-3.5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-semibold text-foreground leading-tight truncate">{link.label}</p>
                      {link.badge && (
                        <span className="text-[9px] font-medium uppercase tracking-wide px-1 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
                          {link.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 truncate">{link.description}</p>
                  </div>

                  {link.route !== '#' && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground flex-shrink-0 mt-1 transition-colors" />
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageContainer>
  )
}
