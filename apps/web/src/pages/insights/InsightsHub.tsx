/**
 * InsightsHub — the single front door for every read-only intelligence,
 * analytics and health surface in CognixHR.
 * /admin/insights
 *
 * This is a NAVIGATION / DIRECTORY page only. It introduces no new data,
 * no new engine, no schema and no business logic — every card links to a
 * route that already exists. Its purpose is product polish: turn ~20
 * scattered "intelligence / governance / forensics" entries into one
 * curated, plain-language map that a first-time user can understand.
 *
 * Visibility mirrors the nav role-gating (super_admin-only items are hidden
 * from hr_admin) — this is menu visibility only, not an RBAC/RLS change.
 */
import { Link } from 'react-router-dom'
import {
  TrendingUp, Activity, DollarSign, Command,
  BarChart3, Users, Search, FileText, CalendarClock,
  AlertTriangle, Target, Gauge, ShieldCheck, Sparkles,
  LineChart, ArrowRight, Table2, SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import type { UserRole } from '@/types'

// ── Catalog model ───────────────────────────────────────────────────────────────

interface InsightCard {
  title:       string
  description: string
  route:       string
  icon:        React.ComponentType<{ className?: string }>
  /** Optional internal engine name shown as a faint kicker (de-jargons the UI). */
  engine?:     string
  /** If set, only these roles see the card (visibility only). */
  roles?:      UserRole[]
}

interface InsightCategory {
  id:          string
  label:       string
  blurb:       string
  icon:        React.ComponentType<{ className?: string }>
  /** Tailwind token accents for the category icon tile + hover rail. */
  accent:      { tile: string; text: string; rail: string }
  cards:       InsightCard[]
}

// ── The map ─────────────────────────────────────────────────────────────────────

const CATEGORIES: InsightCategory[] = [
  {
    id:    'strategic',
    label: 'Strategic',
    blurb: 'Board-level read-outs for leadership.',
    icon:  Sparkles,
    accent: { tile: 'bg-primary/10', text: 'text-primary', rail: 'group-hover:border-primary/40' },
    cards: [
      { title: 'Executive Intelligence', description: 'CEO & CHRO strategic read-out — workforce, financial and compliance posture at a glance.', route: '/admin/executive', icon: BarChart3, engine: 'Executive Intelligence Center' },
      { title: 'Monthly Narrative',      description: 'A plain-language story of how the workforce changed this period — joiners, exits, net movement.', route: '/admin/intelligence/narratives', icon: FileText, engine: 'Executive Narrative' },
      { title: 'Enterprise Control',     description: 'Governance, trust, security and audit posture across the platform.', route: '/admin/enterprise', icon: Command, engine: 'Enterprise Control Center', roles: ['super_admin'] },
    ],
  },
  {
    id:    'workforce',
    label: 'Workforce',
    blurb: 'People signals, org shape and what needs attention.',
    icon:  Users,
    accent: { tile: 'bg-primary/10', text: 'text-primary dark:text-indigo-400', rail: 'group-hover:border-indigo-500/40' },
    cards: [
      { title: 'Workforce Signals',   description: 'Live, prioritised observations about your people — stalled onboarding, pending separations, assets at risk, probation due.', route: '/admin/intelligence/workforce-command', icon: Activity },
      { title: 'Headcount Analytics', description: 'Workforce distribution, reliability and movement patterns — now in the Executive dashboard.', route: '/admin/executive/headcount', icon: LineChart },
      { title: 'Org Health',          description: 'Headcount by department, joiners vs exits, and the six-month growth trend.', route: '/admin/intelligence/org-health', icon: TrendingUp },
      { title: 'Action Center',       description: 'Suggestions triggered by recent events — new hires, separations, asset issues.', route: '/admin/intelligence/action-center', icon: Target },
      { title: 'Daily Digest',        description: 'A daily / weekly / monthly summary of workforce operations and metrics.', route: '/admin/intelligence/digest', icon: FileText },
      { title: 'People Search',       description: 'Find any employee with a plain-language search across the directory.', route: '/admin/intelligence/search', icon: Search },
    ],
  },
  {
    id:    'attendance',
    label: 'Attendance & Time',
    blurb: 'Coverage, risk and the quality of your time data.',
    icon:  CalendarClock,
    accent: { tile: 'bg-warning/10', text: 'text-warning dark:text-amber-400', rail: 'group-hover:border-amber-500/40' },
    cards: [
      { title: 'Session Intelligence', description: 'Live sessions, missing punches, cross-midnight cases and anomaly review.', route: '/admin/attendance/intelligence-center', icon: Activity, engine: 'Attendance Intelligence Center' },
      { title: 'Health Index',         description: 'A single attendance health score by employee, department, site or org.', route: '/admin/attendance/health-index', icon: Gauge },
      { title: 'Attendance Risk',      description: 'Who is trending toward chronic lateness, absence streaks or correction abuse.', route: '/admin/attendance/risk', icon: AlertTriangle },
      { title: 'Data Confidence',      description: 'How trustworthy your attendance data is, with quality indicators per source.', route: '/admin/attendance/confidence', icon: ShieldCheck, engine: 'Attendance Confidence' },
      { title: 'Roster Intelligence',  description: 'Shift coverage, burnout risk and coverage-gap alerts across the roster.', route: '/admin/roster/intelligence', icon: CalendarClock },
      { title: 'Operational Health',   description: 'System view of processing runs, anomaly funnel and correction SLAs.', route: '/admin/operational-health', icon: Activity },
    ],
  },
  {
    id:    'payroll',
    label: 'Payroll & Cost',
    blurb: 'Where the money is going and where it might surprise you.',
    icon:  DollarSign,
    accent: { tile: 'bg-accent-violet/10', text: 'text-accent-violet dark:text-violet-400', rail: 'group-hover:border-violet-500/40' },
    cards: [
      { title: 'Cost Intelligence', description: 'Department-level cost trends, overtime-heavy teams and high-variance alerts.', route: '/admin/payroll/cost-intelligence', icon: BarChart3 },
      { title: 'Payroll Forecast',  description: 'Projected gross and net for next month with risk factors and confidence.', route: '/admin/payroll/forecast', icon: TrendingUp },
      { title: 'Variance Review',   description: 'Month-over-month swings — net-pay changes, LOP spikes and deduction anomalies.', route: '/admin/payroll/variance', icon: AlertTriangle, engine: 'Payroll Variance Center' },
    ],
  },
  {
    id:    'control',
    label: 'Control Centers',
    blurb: 'Operational cockpits that combine signals with quick actions.',
    icon:  Command,
    accent: { tile: 'bg-info/10', text: 'text-info dark:text-sky-400', rail: 'group-hover:border-sky-500/40' },
    cards: [
      { title: 'Command Center',         description: 'Exception-first home — system health, reconciliation and the operations feed.', route: '/admin/control-center', icon: Command },
      { title: 'Workforce Operations',   description: 'People-operations cockpit — attention queue, onboarding pipeline and distribution.', route: '/admin/workforce/center', icon: Users },
      { title: 'Attendance Operations',  description: 'Attendance cockpit — KPI strip, insight cards and recent operational events.', route: '/admin/attendance/center', icon: CalendarClock },
      { title: 'Payroll Operations',     description: 'The seven-step payroll execution cockpit, from pre-run checks to payout.', route: '/admin/payroll/center', icon: DollarSign },
    ],
  },
  {
    id:    'explore',
    label: 'Explore & Build',
    blurb: 'Self-serve analytics — slice the canonical datasets your own way.',
    icon:  SlidersHorizontal,
    accent: { tile: 'bg-success/10', text: 'text-success dark:text-emerald-400', rail: 'group-hover:border-emerald-500/40' },
    cards: [
      { title: 'Analytics Studio',  description: 'Guided chart builder — pick a dataset, dimension and measure to chart headcount, cost, attendance and more. Now disaggregates by site, region and zone.', route: '/admin/reports/analytics', icon: SlidersHorizontal, engine: 'Analytics Studio (L4)' },
      { title: 'Data Explorer',     description: 'Table-first investigation — read metrics as columns and drill row-by-row down to the employee list. Export to CSV / Excel.', route: '/admin/explorer', icon: Table2, engine: 'Data Explorer (L5)' },
    ],
  },
]

// ── Card ────────────────────────────────────────────────────────────────────────

function InsightTile({ card, accent }: { card: InsightCard; accent: InsightCategory['accent'] }) {
  const Icon = card.icon
  return (
    <Link
      to={card.route}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-4',
        'transition-all hover:shadow-md hover:-translate-y-0.5',
        accent.rail,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0', accent.tile, accent.text)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors -translate-x-1 group-hover:translate-x-0 duration-200" />
      </div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-foreground leading-tight">{card.title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{card.description}</p>
      </div>
      {card.engine && (
        <p className="mt-auto pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {card.engine}
        </p>
      )}
    </Link>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────────

export function InsightsHub() {
  const { profile } = useAuthStore()
  const role = profile?.role

  const visibleCategories = CATEGORIES
    .map(cat => ({
      ...cat,
      cards: cat.cards.filter(c => !c.roles || (role && c.roles.includes(role))),
    }))
    .filter(cat => cat.cards.length > 0)

  const total = visibleCategories.reduce((n, c) => n + c.cards.length, 0)

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Home', href: '/admin/intelligence/workforce-command' }, { label: 'Insights' }]}
        title="Insights Hub"
        subtitle={`Every analytic and intelligence view in one place — ${total} surfaces, plain language.`}
      />

      {/* Hero strip */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.07] via-card to-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary flex-shrink-0">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">One front door for everything you want to know.</p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-2xl leading-relaxed">
              These are read-only views. They surface what's happening across people, attendance
              and payroll — every figure traces back to its source. Nothing here changes your data.
            </p>
          </div>
        </div>
      </div>

      {/* Categories */}
      {visibleCategories.map(cat => {
        const CatIcon = cat.icon
        return (
          <section key={cat.id} className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', cat.accent.tile, cat.accent.text)}>
                <CatIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground leading-none">{cat.label}</h2>
                <p className="mt-1 text-[11.5px] text-muted-foreground leading-none">{cat.blurb}</p>
              </div>
              <span className="ml-auto text-[11px] font-medium text-muted-foreground/60 tabular-nums">
                {cat.cards.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cat.cards.map(card => (
                <InsightTile key={card.route} card={card} accent={cat.accent} />
              ))}
            </div>
          </section>
        )
      })}
    </PageContainer>
  )
}

export default InsightsHub
