import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Play,
  ShieldCheck,
  Lock,
  ScrollText,
  KeyRound,
  Building2,
  Users,
  Briefcase,
  Clock,
  CalendarDays,
  Wallet,
  Landmark,
  BarChart3,
  Sparkles,
  Settings2,
  UserCheck,
  Network,
  Check,
  ChevronRight,
  Activity,
  FileText,
  Star,
} from 'lucide-react';
import AnalyticsCharts from './AnalyticsCharts';
import PayslipModal from './PayslipModal';
import CandidateATS from './CandidateATS';
import ClockWidget from './ClockWidget';
import {
  INITIAL_EMPLOYEES,
  INITIAL_CANDIDATES,
  INITIAL_ATTENDANCE_LOGS,
  getInitialPayrollRecords,
} from '../mockData';
import { Candidate } from '../types';

interface LandingPageProps {
  onLaunchDemo: (role: 'admin' | 'employee') => void;
}

const DEMO_URL = import.meta.env.VITE_DEMO_URL || '/demo';
const openLiveDemo = () => window.open(DEMO_URL, '_blank', 'noopener,noreferrer');

/** CognixHR brand mark — canonical raster artwork (public/brand/cognixhr-icon.png). */
function CognixMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/brand/cognixhr-icon.png"
      width={size}
      height={size}
      className={className}
      alt="CognixHR logo"
      draggable={false}
      style={{ display: 'block' }}
    />
  );
}

/** Reveal-on-scroll wrapper — tasteful, subtle fade + rise. */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Small pill / chip used in trust bands and section eyebrows. */
function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] font-mono font-bold tracking-[0.18em] uppercase ${
        dark
          ? 'bg-white/5 border border-white/10 text-[var(--color-brand-teal-bright)]'
          : 'bg-[var(--color-brand-teal)]/10 border border-[var(--color-brand-teal)]/20 text-[var(--color-brand-navy)]'
      }`}
    >
      {children}
    </span>
  );
}

// ---- Module grid data (each maps to a REAL product module) -----------------
const MODULES: {
  icon: React.ElementType;
  name: string;
  desc: string;
  features: string[];
}[] = [
  {
    icon: Activity,
    name: 'Operations Command Center',
    desc: 'A single operational cockpit for HR leaders.',
    features: ['Live KPIs & system health', 'Operations queue', 'Approvals inbox', 'HR helpdesk'],
  },
  {
    icon: Users,
    name: 'Workforce & Org',
    desc: 'Every employee record, end to end.',
    features: [
      'Employee directory & 360 profile',
      'Org chart, onboarding & checklists',
      'Separation, documents & letters',
      'Assets, benefits, certifications & expiry tracking',
    ],
  },
  {
    icon: Briefcase,
    name: 'Recruitment (ATS)',
    desc: 'Hire faster with a structured pipeline.',
    features: [
      'Requisitions & candidate pipeline',
      'Interviews + analytics',
      'Question bank & scorecards',
      'Offer letters & hired pipeline',
    ],
  },
  {
    icon: Clock,
    name: 'Attendance & Shifts',
    desc: 'From punch to period close.',
    features: [
      'Muster roll & biometric / punch intake',
      'Shift roster & rotation policies',
      'Regularisation, anomalies & who-is-in',
      'Period lock/close & attendance intelligence',
    ],
  },
  {
    icon: CalendarDays,
    name: 'Leave',
    desc: 'Policies, balances and accruals that just work.',
    features: [
      'Approvals, balances & transactions',
      'Comp-off & overtime',
      'Accrual runs & ledger',
      'Leave policies & simulator',
    ],
  },
  {
    icon: Wallet,
    name: 'Payroll & Payslips',
    desc: 'Accurate Indian payroll, every cycle.',
    features: [
      'Payroll calendar & runs',
      'Compensation setup & payroll groups',
      'Payslips, arrears, reimbursements & FBP',
      'Loans & advances, payout reconciliation & ledger',
    ],
  },
  {
    icon: Landmark,
    name: 'Statutory Compliance (India)',
    desc: 'EPF · ESI · PT · TDS · LWF — handled.',
    features: [
      'Statutory dashboards',
      'Filing packs',
      'Compliance calendar',
      'Reconciliation',
    ],
  },
  {
    icon: BarChart3,
    name: 'Reports & Analytics',
    desc: 'Decisions backed by real numbers.',
    features: [
      'Report library',
      'Cost intelligence & payroll ledger',
      'Workforce analytics',
      'Executive summaries',
    ],
  },
  {
    icon: Sparkles,
    name: 'AI Intelligence',
    desc: 'Signals and narratives, not just dashboards.',
    features: [
      'Workforce signals & org health',
      'Attendance risk & intelligence',
      'Narratives, daily digest & action center',
      'Policy simulation & optimization',
    ],
  },
  {
    icon: ShieldCheck,
    name: 'Governance & Security',
    desc: 'Control, audit and trust by design.',
    features: [
      'Roles & permissions, approval workflows',
      'Audit / event log',
      'Privacy & compliance, security operations',
      'Integrations / webhooks & multi-tenant RLS',
    ],
  },
  {
    icon: UserCheck,
    name: 'Employee Self-Service',
    desc: 'Everything an employee needs in one place.',
    features: [
      'Clock in/out & my attendance',
      'Apply leave, payslips & tax declarations (HRA/80C)',
      'Reimbursements & documents',
      'Helpdesk & team views',
    ],
  },
  {
    icon: Settings2,
    name: 'Setup & Masters',
    desc: 'Configure the org exactly how it runs.',
    features: [
      'Company settings & org structure',
      'Departments, positions, locations, sites',
      'Grades & cost centers',
      'Workforce, leave & payroll config',
    ],
  },
];

const STAT_CHIPS = [
  { value: '12', label: 'Integrated modules' },
  { value: '5', label: 'Statutory heads automated' },
  { value: '100%', label: 'Multi-tenant RLS isolation' },
  { value: '1', label: 'Source of truth' },
];

export default function LandingPage({ onLaunchDemo }: LandingPageProps) {
  // Interactive product previews wired to real mock data
  const [candidates, setCandidates] = useState<Candidate[]>(INITIAL_CANDIDATES);
  const payrollRecords = getInitialPayrollRecords(INITIAL_EMPLOYEES);
  const [showPayslip, setShowPayslip] = useState(false);

  // Pick a representative employee/payslip for the payroll deep-dive
  const featuredEmployee = INITIAL_EMPLOYEES[0];
  const featuredRecord =
    payrollRecords.find((r) => r.employeeId === featuredEmployee.id) ?? payrollRecords[0];

  const handleUpdateCandidate = (updated: Candidate) =>
    setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  const handleAddCandidate = (created: Candidate) =>
    setCandidates((prev) => [created, ...prev]);

  return (
    <div
      id="landing-container"
      className="bg-white text-slate-800 min-h-screen font-sans selection:bg-[var(--color-brand-teal)]/30 selection:text-[var(--color-brand-ink)]"
    >
      {/* ============================ NAVBAR ============================ */}
      <nav
        id="navbar"
        className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200/70 shadow-[0_1px_0_rgba(255,255,255,0.6)]"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-10">
            <a href="#top" className="flex items-center gap-2.5" aria-label="CognixHR home">
              <CognixMark size={34} />
              <span className="font-display text-xl font-bold tracking-tight text-[var(--color-brand-ink)]">
                Cognix<span className="text-[#15B8A6]">HR</span>
              </span>
            </a>
            <div className="hidden lg:flex items-center gap-8">
              <a href="#platform" className="text-sm font-semibold text-slate-600 hover:text-[var(--color-brand-blue)] transition-colors">Platform</a>
              <a href="#modules" className="text-sm font-semibold text-slate-600 hover:text-[var(--color-brand-blue)] transition-colors">Modules</a>
              <a href="#why" className="text-sm font-semibold text-slate-600 hover:text-[var(--color-brand-blue)] transition-colors">Why CognixHR</a>
              <a href="#pricing" className="text-sm font-semibold text-slate-600 hover:text-[var(--color-brand-blue)] transition-colors">Pricing</a>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              id="cta-sign-in"
              onClick={() => onLaunchDemo('employee')}
              className="text-sm font-semibold text-slate-700 hover:text-[var(--color-brand-blue)] px-3 py-2 transition-colors cursor-pointer"
            >
              Sign in
            </button>
            <button
              id="cta-live-demo"
              onClick={openLiveDemo}
              className="text-sm font-bold text-white bg-gradient-to-r from-[var(--color-brand-blue)] to-[var(--color-brand-navy)] hover:to-[var(--color-brand-blue)] shadow-[0_4px_14px_rgba(46,111,230,0.30),inset_0_1px_0_rgba(255,255,255,0.25)] px-5 py-2.5 rounded-full transition-all flex items-center gap-1.5 hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              Live Demo <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* ============================ HERO ============================ */}
      <main
        id="top"
        className="relative pt-20 pb-24 px-6 overflow-hidden bg-[var(--color-brand-ink)]"
      >
        {/* grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:44px_44px] pointer-events-none opacity-70" />
        {/* radial glows — navy + teal */}
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[820px] h-[520px] bg-[radial-gradient(circle_at_center,rgba(46,111,230,0.40)_0%,rgba(10,31,68,0)_70%)] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[5%] w-[480px] h-[480px] bg-[radial-gradient(circle_at_center,rgba(21,184,166,0.28)_0%,rgba(10,31,68,0)_70%)] rounded-full pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10.5px] font-mono font-bold tracking-[0.2em] text-[var(--color-brand-teal-bright)] bg-white/5 border border-white/10 mb-7"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand-teal-bright)] block" style={{ animation: 'brand-pulse 1.8s ease-in-out infinite' }} />
            <span>SAAR HRMS APPLICATION · BUILT FOR INDIA</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="font-display text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.08] mb-6"
          >
            One platform for HR, Payroll,
            <br className="hidden md:block" />{' '}
            Attendance &amp;{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7dd3fc] via-[var(--color-brand-teal-bright)] to-[var(--color-brand-teal)]">
              Indian compliance
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="text-base md:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed mb-3 font-medium"
          >
            Smarter Workforce. Stronger Future.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-sm md:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed mb-9"
          >
            CognixHR is an end-to-end HRMS that unifies the entire employee lifecycle —
            recruitment, onboarding, attendance, leave, payroll and statutory filing — on a
            single, governed, multi-tenant platform with built-in AI intelligence.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.26 }}
            className="flex flex-col sm:flex-row gap-3.5 justify-center items-center"
          >
            <button
              id="hero-live-demo"
              onClick={openLiveDemo}
              className="w-full sm:w-auto text-sm md:text-base font-bold text-white bg-gradient-to-r from-[var(--color-brand-blue)] to-[var(--color-brand-navy)] hover:to-[var(--color-brand-blue)] shadow-[0_10px_30px_rgba(46,111,230,0.40),inset_0_1px_0_rgba(255,255,255,0.25)] px-8 py-4 rounded-full transition-all hover:scale-[1.03] active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              Live Demo <ArrowRight className="w-4 h-4" />
            </button>
            <button
              id="hero-quick-tour"
              onClick={() => onLaunchDemo('admin')}
              className="w-full sm:w-auto text-sm md:text-base font-bold text-white border border-white/20 bg-white/5 hover:bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] px-8 py-4 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer hover:border-white/40 hover:scale-[1.01] active:scale-95"
            >
              <Play className="w-4 h-4 fill-white" /> Quick tour
            </button>
          </motion.div>

          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="text-[11px] text-slate-400 mt-7 block tracking-wide font-medium"
          >
            EPF · ESI · Professional Tax · TDS · LWF — statutory compliance built in
          </motion.span>

          {/* Product visual — AnalyticsCharts in a browser frame */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-14 bg-white rounded-2xl border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] overflow-hidden max-w-5xl mx-auto text-left"
          >
            <div className="flex items-center justify-between bg-slate-50 border-b border-slate-200 px-4 py-2.5">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-green-400" />
                <span className="text-[11px] text-slate-400 font-mono ml-3">app.cognixhr.co / reports / workforce</span>
              </div>
              <span className="px-2.5 py-0.5 bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-navy)] rounded-md text-[10px] font-bold font-mono">
                Reports &amp; Analytics
              </span>
            </div>
            <div className="p-5 md:p-7 bg-slate-50/60">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Workforce Analytics</h3>
                  <p className="text-[11px] text-slate-500">Live cost, attendance and recruitment intelligence</p>
                </div>
                <span className="text-[10px] font-mono text-slate-400 hidden sm:block">FY 2026 · All locations</span>
              </div>
              <AnalyticsCharts
                employees={INITIAL_EMPLOYEES}
                candidates={candidates}
                attendance={INITIAL_ATTENDANCE_LOGS}
              />
            </div>
          </motion.div>
        </div>
      </main>

      {/* ============================ TRUST BAND ============================ */}
      <section className="bg-white border-b border-slate-100 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center mb-9">
            <p className="text-sm md:text-base font-semibold text-slate-700">
              Built for Indian payroll &amp; statutory compliance —{' '}
              <span className="text-[var(--color-brand-navy)] font-bold">
                EPF · ESI · Professional Tax · TDS · LWF
              </span>
            </p>
          </Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {STAT_CHIPS.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.06}>
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-5 py-6 text-center shadow-sm">
                  <div className="font-display text-3xl md:text-4xl font-bold text-[var(--color-brand-ink)]">{s.value}</div>
                  <div className="text-[11px] md:text-xs font-semibold text-slate-500 mt-1.5">{s.label}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ PLATFORM INTRO ============================ */}
      <section id="platform" className="py-20 md:py-24 px-6 max-w-7xl mx-auto">
        <Reveal className="text-center max-w-3xl mx-auto mb-4">
          <Eyebrow>The CognixHR platform</Eyebrow>
        </Reveal>
        <Reveal delay={0.05} className="text-center max-w-3xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-[var(--color-brand-ink)] tracking-tight leading-tight mt-4">
            One source of truth across the entire employee lifecycle
          </h2>
          <p className="text-slate-600 mt-4 leading-relaxed">
            No more disconnected spreadsheets and point tools. HR, payroll, attendance and
            compliance share the same data — so a single change flows everywhere, instantly and
            auditable.
          </p>
        </Reveal>
      </section>

      {/* ============================ MODULES GRID ============================ */}
      <section id="modules" className="pb-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODULES.map((m, i) => {
              const Icon = m.icon;
              return (
                <Reveal key={m.name} delay={(i % 3) * 0.06}>
                  <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-[0_18px_40px_-18px_rgba(26,77,143,0.35)] hover:border-[var(--color-brand-teal)]/40">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--color-brand-blue)]/10 to-[var(--color-brand-teal)]/10 text-[var(--color-brand-navy)] border border-[var(--color-brand-blue)]/10 group-hover:scale-105 transition-transform">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="font-display text-base font-bold text-[var(--color-brand-ink)] leading-tight">
                        {m.name}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 mb-4 leading-relaxed">{m.desc}</p>
                    <ul className="space-y-2">
                      {m.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs text-slate-700">
                          <span className="mt-0.5 p-0.5 rounded-full bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)] shrink-0">
                            <Check className="w-3 h-3" />
                          </span>
                          <span className="leading-snug">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============================ DEEP DIVE: PAYROLL ============================ */}
      <section className="py-20 md:py-24 px-6 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <Reveal>
            <Eyebrow>Payroll &amp; statutory</Eyebrow>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-[var(--color-brand-ink)] tracking-tight leading-tight mt-4">
              Run Indian payroll end to end
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed">
              Drive payroll calendars and runs, compensation setup, payroll groups, arrears,
              reimbursements and FBP. Statutory heads — EPF, ESI, Professional Tax, TDS and LWF —
              are calculated, reconciled and packaged for filing. Every payslip is generated with
              earnings, deductions and net pay in words.
            </p>
            <ul className="mt-6 grid sm:grid-cols-2 gap-3">
              {[
                'Payroll calendar & runs',
                'Arrears, reimbursements & FBP',
                'Loans & advances',
                'Payout reconciliation & ledger',
                'EPF · ESI · PT · TDS · LWF',
                'Compliant Indian payslips',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                  <Check className="w-4 h-4 text-[var(--color-brand-teal)] shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setShowPayslip(true)}
              className="mt-8 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[var(--color-brand-ink)] text-white text-sm font-bold hover:bg-[var(--color-brand-ink2)] transition-colors cursor-pointer shadow-sm"
            >
              <FileText className="w-4 h-4" /> View a sample payslip
            </button>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-30px_rgba(26,77,143,0.45)] overflow-hidden">
              <div className="flex items-center justify-between bg-slate-50 border-b border-slate-200 px-4 py-2.5">
                <span className="text-xs font-bold text-slate-700">Payroll register · May 2026</span>
                <span className="text-[10px] font-mono text-slate-400">{payrollRecords.length} employees</span>
              </div>
              <div className="divide-y divide-slate-100">
                {payrollRecords.slice(0, 5).map((r) => (
                  <div key={r.employeeId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50/60 transition-colors">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{r.employeeName}</div>
                      <div className="text-[11px] text-slate-400 truncate">{r.role}</div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-sm font-mono font-bold text-[var(--color-brand-ink)]">
                        ₹{r.netSalary.toLocaleString('en-IN')}
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          r.paymentStatus === 'Paid'
                            ? 'bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)]'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {r.paymentStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowPayslip(true)}
                className="w-full px-4 py-3 text-xs font-bold text-[var(--color-brand-blue)] hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Open {featuredEmployee.name.split(' ')[0]}&apos;s payslip <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ DEEP DIVE: ATTENDANCE ============================ */}
      <section className="py-20 md:py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <Reveal className="lg:order-2">
            <Eyebrow>Attendance &amp; shifts</Eyebrow>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-[var(--color-brand-ink)] tracking-tight leading-tight mt-4">
              From the daily punch to a clean period close
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed">
              Capture attendance from biometric and punch intake, run the muster roll, manage shift
              rosters and rotation policies, handle regularisation and surface anomalies. Know
              who-is-in at a glance, then lock and close the period with confidence.
            </p>
            <ul className="mt-6 grid sm:grid-cols-2 gap-3">
              {[
                'Muster roll',
                'Biometric / punch intake',
                'Shift roster & rotation',
                'Regularisation & anomalies',
                'Who-is-in',
                'Period lock / close',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                  <Check className="w-4 h-4 text-[var(--color-brand-teal)] shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.1} className="lg:order-1">
            <div className="grid sm:grid-cols-2 gap-5 items-stretch">
              <ClockWidget
                employeeName={featuredEmployee.name}
                lastLog={{ clockIn: '08:52 AM' }}
                onClockInSuccess={() => {}}
                onClockOutSuccess={() => {}}
              />
              {/* Muster visual */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Muster roll</h3>
                    <span className="text-[10px] text-slate-400 font-medium">Who is in · today</span>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)]">
                    Live
                  </span>
                </div>
                <div className="space-y-2.5 flex-1">
                  {INITIAL_EMPLOYEES.slice(0, 5).map((e, idx) => {
                    const present = idx !== 3;
                    const late = idx === 1;
                    return (
                      <div key={e.id} className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700 truncate">{e.name}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            !present
                              ? 'bg-slate-100 text-slate-500'
                              : late
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)]'
                          }`}
                        >
                          {!present ? 'On leave' : late ? 'Late' : 'On-time'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 text-center">
                  <div>
                    <div className="font-display text-lg font-bold text-[var(--color-brand-ink)]">7</div>
                    <div className="text-[9px] text-slate-400 uppercase tracking-wide">Present</div>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold text-amber-600">1</div>
                    <div className="text-[9px] text-slate-400 uppercase tracking-wide">Late</div>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold text-slate-400">1</div>
                    <div className="text-[9px] text-slate-400 uppercase tracking-wide">Leave</div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ DEEP DIVE: RECRUITMENT ATS ============================ */}
      <section className="py-20 md:py-24 px-6 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto">
          <Reveal className="max-w-3xl mb-10">
            <Eyebrow>Recruitment (ATS)</Eyebrow>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-[var(--color-brand-ink)] tracking-tight leading-tight mt-4">
              A structured pipeline from requisition to offer
            </h2>
            <p className="text-slate-600 mt-4 leading-relaxed">
              Manage requisitions and the candidate pipeline on a visual board, run structured
              interviews backed by a question bank and scorecards, and roll out offer letters — with
              recruitment analytics across the funnel. Try the live board below.
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm">
              <CandidateATS
                candidates={candidates}
                onUpdateCandidate={handleUpdateCandidate}
                onAddCandidate={handleAddCandidate}
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ WHY COGNIXHR ============================ */}
      <section id="why" className="py-24 px-6 bg-[var(--color-brand-ink)] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(21,184,166,0.18),transparent_55%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(46,111,230,0.18),transparent_55%)] pointer-events-none" />
        <div className="max-w-7xl mx-auto relative z-10">
          <Reveal className="text-center max-w-3xl mx-auto mb-14">
            <Eyebrow dark>Why CognixHR</Eyebrow>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-white mt-4 leading-tight">
              An HRMS that actually runs your operations
            </h2>
            <p className="text-slate-400 mt-4">
              Real differentiators — not feature checkboxes — that make CognixHR a system of record
              your finance, HR and leadership teams can all trust.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                icon: Network,
                title: 'Single source of truth',
                body: 'HR, payroll and attendance share one data model. A change in onboarding reaches payroll and compliance without re-keying or reconciliation drift.',
              },
              {
                icon: Landmark,
                title: 'India-first compliance',
                body: 'EPF, ESI, Professional Tax, TDS and LWF are built in — with statutory dashboards, filing packs, a compliance calendar and reconciliation.',
              },
              {
                icon: Activity,
                title: 'Operational Command Center',
                body: 'Live KPIs, system health, an operations queue, an approvals inbox and HR helpdesk give leaders one cockpit to run people operations.',
              },
              {
                icon: ShieldCheck,
                title: 'Governance & full audit trail',
                body: 'Role-based access, approval workflows and an immutable audit / event log mean every action is controlled and accountable.',
              },
              {
                icon: Sparkles,
                title: 'Built-in AI intelligence',
                body: 'Workforce signals, org health, attendance risk, narratives and a daily digest turn raw data into decisions and a clear action center.',
              },
              {
                icon: Lock,
                title: 'Multi-tenant by design',
                body: 'Row-level security isolates every tenant at the data layer, so your organisation’s records stay private and segregated end to end.',
              },
            ].map((d, i) => {
              const Icon = d.icon;
              return (
                <Reveal key={d.title} delay={(i % 3) * 0.06}>
                  <div className="h-full bg-white/[0.04] border border-white/10 p-7 rounded-2xl backdrop-blur-sm hover:bg-white/[0.07] transition-colors">
                    <div className="p-3 bg-[var(--color-brand-teal)]/10 border border-[var(--color-brand-teal)]/20 text-[var(--color-brand-teal-bright)] rounded-xl w-fit mb-4">
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="font-display text-lg font-bold mb-2">{d.title}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{d.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============================ PRICING ============================ */}
      <section id="pricing" className="py-24 px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center max-w-3xl mx-auto mb-14">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-[var(--color-brand-ink)] tracking-tight leading-tight mt-4">
              Simple, transparent plans
            </h2>
            <p className="text-slate-600 mt-4">
              Priced per employee, per month, billed in INR. Pick the modules you need today and
              switch on more as you grow. Exact pricing depends on headcount and modules —{' '}
              <span className="font-semibold text-slate-800">talk to us</span>.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                name: 'Core HR',
                tagline: 'Workforce foundation',
                price: 'Talk to us',
                unit: 'per employee / month',
                highlighted: false,
                features: [
                  'Workforce & Org directory + Employee 360',
                  'Onboarding, documents & letters',
                  'Leave: balances, approvals & policies',
                  'Employee Self-Service portal',
                  'Reports & analytics library',
                ],
              },
              {
                name: 'HR + Payroll',
                tagline: 'Most popular',
                price: 'Talk to us',
                unit: 'per employee / month',
                highlighted: true,
                features: [
                  'Everything in Core HR',
                  'Payroll runs, payslips, arrears & FBP',
                  'Attendance & shifts + period close',
                  'Statutory compliance: EPF · ESI · PT · TDS · LWF',
                  'Filing packs & compliance calendar',
                ],
              },
              {
                name: 'Enterprise',
                tagline: 'Full platform',
                price: 'Talk to us',
                unit: 'per employee / month',
                highlighted: false,
                features: [
                  'Everything in HR + Payroll',
                  'Recruitment (ATS) & offer letters',
                  'AI intelligence & action center',
                  'Operations Command Center',
                  'Governance, audit log & integrations',
                ],
              },
            ].map((plan) => (
              <Reveal key={plan.name}>
                <div
                  className={`h-full rounded-3xl border p-7 flex flex-col transition-all ${
                    plan.highlighted
                      ? 'border-[var(--color-brand-teal)]/50 bg-gradient-to-b from-white to-[var(--color-brand-teal)]/[0.04] shadow-[0_24px_60px_-30px_rgba(21,184,166,0.55)] ring-1 ring-[var(--color-brand-teal)]/20'
                      : 'border-slate-200 bg-white shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-xl font-bold text-[var(--color-brand-ink)]">{plan.name}</h3>
                    {plan.highlighted && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[var(--color-brand-teal)] text-white">
                        <Star className="w-3 h-3 fill-white" /> Popular
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{plan.tagline}</p>
                  <div className="mt-5">
                    <div className="font-display text-2xl font-bold text-[var(--color-brand-ink)]">{plan.price}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-0.5">{plan.unit}</div>
                  </div>
                  <ul className="mt-6 space-y-3 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                        <span className="mt-0.5 p-0.5 rounded-full bg-[var(--color-brand-teal)]/10 text-[var(--color-brand-teal)] shrink-0">
                          <Check className="w-3 h-3" />
                        </span>
                        <span className="leading-snug">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={openLiveDemo}
                    className={`mt-7 w-full py-3 rounded-xl text-sm font-bold transition-all hover:scale-[1.01] active:scale-95 cursor-pointer ${
                      plan.highlighted
                        ? 'bg-gradient-to-r from-[var(--color-brand-blue)] to-[var(--color-brand-navy)] text-white shadow-[0_8px_24px_rgba(46,111,230,0.30)]'
                        : 'bg-[var(--color-brand-ink)] text-white hover:bg-[var(--color-brand-ink2)]'
                    }`}
                  >
                    Explore in Live Demo
                  </button>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ SECURITY STRIP ============================ */}
      <section className="py-20 px-6 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <Eyebrow>Security &amp; compliance</Eyebrow>
            <h2 className="font-display text-2xl md:text-3xl font-bold text-[var(--color-brand-ink)] tracking-tight mt-4">
              Enterprise-grade trust, isolation and accountability
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: Building2, title: 'Multi-tenant RLS isolation', body: 'Row-level security segregates every tenant’s data at the database layer.' },
              { icon: ScrollText, title: 'Full audit logging', body: 'An immutable audit / event log records every consequential action.' },
              { icon: KeyRound, title: 'Role-based access', body: 'Granular roles, permissions and approval workflows scope what each user can do.' },
              { icon: Lock, title: 'Data privacy & compliance', body: 'Privacy controls and security operations keep sensitive HR data protected.' },
            ].map((d, i) => {
              const Icon = d.icon;
              return (
                <Reveal key={d.title} delay={i * 0.06}>
                  <div className="h-full bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="p-2.5 rounded-xl bg-[var(--color-brand-blue)]/10 text-[var(--color-brand-navy)] w-fit mb-4">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-[var(--color-brand-ink)] mb-1.5">{d.title}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{d.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============================ FINAL CTA ============================ */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-[var(--color-brand-ink)] px-8 py-14 md:px-16 md:py-16 text-center shadow-[0_30px_80px_-30px_rgba(10,31,68,0.6)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(21,184,166,0.22),transparent_60%)] pointer-events-none" />
              <div className="relative z-10">
                <h2 className="font-display text-3xl md:text-4xl font-bold text-white tracking-tight">
                  See CognixHR run your workforce
                </h2>
                <p className="text-slate-300 mt-4 max-w-xl mx-auto">
                  Explore the full platform with realistic Indian payroll, attendance and recruitment
                  data — no setup required.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3.5 justify-center items-center">
                  <button
                    onClick={openLiveDemo}
                    className="w-full sm:w-auto text-sm md:text-base font-bold text-white bg-gradient-to-r from-[var(--color-brand-blue)] to-[var(--color-brand-navy)] px-8 py-4 rounded-full transition-all hover:scale-[1.03] active:scale-95 flex items-center justify-center gap-2 cursor-pointer shadow-[0_10px_30px_rgba(46,111,230,0.40)]"
                  >
                    Live Demo <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onLaunchDemo('admin')}
                    className="w-full sm:w-auto text-sm md:text-base font-bold text-white border border-white/20 bg-white/5 hover:bg-white/10 px-8 py-4 rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer hover:border-white/40"
                  >
                    <Play className="w-4 h-4 fill-white" /> Quick tour
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ FOOTER ============================ */}
      <footer className="bg-[var(--color-brand-ink)] text-slate-400 pt-16 pb-10 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-10">
          <div className="col-span-2 space-y-4">
            <div className="flex items-center gap-2.5">
              <CognixMark size={30} />
              <span className="font-display text-lg font-bold tracking-tight text-white">
                Cognix<span className="text-[#2DD4BF]">HR</span>
              </span>
            </div>
            <p className="text-xs leading-relaxed max-w-xs">
              Smarter Workforce. Stronger Future. An end-to-end HRMS for Indian businesses —
              HR, payroll, attendance and statutory compliance on one governed platform.
            </p>
            <p className="text-[11px] text-slate-500">A Saar HRMS application</p>
            <p className="text-[10px] text-slate-600 font-mono">© 2026 CognixHR. All rights reserved.</p>
          </div>

          <div className="space-y-3">
            <h4 className="text-[11px] font-bold text-slate-200 tracking-wider uppercase">Product</h4>
            <ul className="text-xs space-y-2">
              <li><a href="#modules" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Workforce &amp; Org</a></li>
              <li><a href="#modules" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Payroll &amp; Payslips</a></li>
              <li><a href="#modules" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Attendance &amp; Shifts</a></li>
              <li><a href="#modules" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Recruitment (ATS)</a></li>
              <li><a href="#modules" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Statutory Compliance</a></li>
              <li><a href="#modules" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">AI Intelligence</a></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-[11px] font-bold text-slate-200 tracking-wider uppercase">Company</h4>
            <ul className="text-xs space-y-2">
              <li><a href="#why" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Why CognixHR</a></li>
              <li><a href="#platform" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Platform</a></li>
              <li><a href="#pricing" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Pricing</a></li>
              <li>
                <button onClick={openLiveDemo} className="hover:text-[var(--color-brand-teal-bright)] transition-colors cursor-pointer">Live Demo</button>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-[11px] font-bold text-slate-200 tracking-wider uppercase">Legal</h4>
            <ul className="text-xs space-y-2">
              <li><a href="/terms" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Terms</a></li>
              <li><a href="/privacy" className="hover:text-[var(--color-brand-teal-bright)] transition-colors">Privacy</a></li>
            </ul>
          </div>
        </div>
      </footer>

      {/* Payslip modal — embedded interactive preview */}
      {showPayslip && (
        <PayslipModal
          record={featuredRecord}
          employee={featuredEmployee}
          onClose={() => setShowPayslip(false)}
        />
      )}
    </div>
  );
}
