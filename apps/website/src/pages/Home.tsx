import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Sparkles,
  ShieldCheck,
  Brain,
  BarChart3,
  Users2,
  Layers,
  Settings2,
  CalendarClock,
  Banknote,
  Briefcase,
  ChevronRight,
  Check,
  Building2,
  FileText,
  TrendingUp,
  ScanSearch,
  Wand2,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { useDemoModal } from "@/components/site/DemoModal";
import { Reveal } from "@/components/site/Reveal";
import { CountUp } from "@/components/site/CountUp";
import { DashboardMock } from "@/components/site/DashboardMock";
import { AnalyticsMock } from "@/components/site/AnalyticsMock";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <SiteShell>
      <Hero />
      <TrustStrip />
      <StatsRow />
      <WhyUs />
      <KeyOfferings />
      <Modules />
      <Analytics />
      <AI />
      <Integrations />
      <HowItWorks />
      <PricingPreview />
      <LiveDemoBand />
      <Testimonials />
      <FAQ />
      <FinalCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function Hero() {
  return (
    <section className="relative -mt-16 overflow-hidden hero-gradient pt-32 pb-20 text-white sm:pt-40 sm:pb-28">
      {/* decorative orbs */}
      <div className="pointer-events-none absolute -top-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-[#2DD4BF]/20 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full bg-[#2E6FE6]/30 blur-3xl animate-blob" style={{ animationDelay: "2s" }} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }} />

      <div className="container-page relative grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-[#2DD4BF]" />
            AI-Powered HRMS · Built for India
          </span>
          <h1 className="mt-5 text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.5rem]">
            Smarter Workforce.
            <br />
            <span className="text-gradient-teal">Stronger Future.</span>
          </h1>

          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            The all-in-one, India-ready HR platform that runs hiring, attendance, payroll, compliance and the full employee
            lifecycle — with AI doing the heavy lifting.
          </p>
          <div className="mt-7">
            <DemoButtons source="hero" inverse />
          </div>
          <p className="mt-4 text-xs font-medium text-white/60">
            No credit card · Full sandbox · India statutory-ready
          </p>
        </Reveal>

        <Reveal delay={150} className="animate-float-slow">
          <DashboardMock />
        </Reveal>

      </div>
    </section>
  );
}

/* ---------------- STATS ROW ---------------- */
function StatsRow() {
  const stats = [
    { value: 40, suffix: "+", label: "HR capabilities" },
    { value: 6, suffix: "", label: "Core modules" },
    { value: 5, suffix: "", label: "Indian statutes built-in" },
    { value: 14, suffix: "-day", label: "Free sandbox" },
  ];
  return (
    <section className="border-b border-border bg-card">
      <div className="container-page grid grid-cols-2 gap-6 py-10 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-3xl font-extrabold tracking-tight text-[#1A4D8F] sm:text-4xl">
              <CountUp value={s.value} />{s.suffix}
            </p>
            <p className="mt-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- TRUST STRIP ---------------- */
function TrustStrip() {
  const items = ["Multi-tenant", "Role-based access", "DPDP-aware", "Audit-logged", "ISO-ready"];
  return (
    <section className="border-y border-border bg-card/60">
      <div className="container-page flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:text-sm">
        {items.map((i, idx) => (
          <span key={i} className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[#15B8A6]" />
              {i}
            </span>
            {idx < items.length - 1 && <span className="hidden h-1 w-1 rounded-full bg-border sm:inline-block" />}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ---------------- WHY US ---------------- */
function WhyUs() {
  const pillars = [
    { icon: Layers, title: "All-in-one", desc: "Hire-to-retire on one platform — no more 6–8 disconnected HR tools.", color: "#2E6FE6", bg: "rgba(46,111,230,0.12)" },
    { icon: ShieldCheck, title: "India-first compliance", desc: "PF, ESI, PT, TDS & LWF with filing packs (ECR 2.0, Form 24Q).", color: "#1A8050", bg: "rgba(26,128,80,0.12)" },
    { icon: Brain, title: "AI that does the work", desc: "Reads documents, flags anomalies, validates payroll automatically.", color: "#7C3AED", bg: "rgba(124,58,237,0.12)" },
    { icon: BarChart3, title: "Real-time intelligence", desc: "Live workforce, payroll and attendance analytics — not month-old reports.", color: "#B07B18", bg: "rgba(176,123,24,0.12)" },
    { icon: Users2, title: "Self-service everywhere", desc: "ESS + Manager Console dramatically cut HR's ticket load.", color: "#15B8A6", bg: "rgba(21,184,166,0.12)" },
    { icon: Settings2, title: "Configurable & white-label", desc: "Configurable masters, roles, policies and branding. Multi-tenant.", color: "#2260A8", bg: "rgba(34,96,168,0.12)" },
  ];
  return (
    <section id="why" className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Why CognixHR</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            One platform. One source of truth. Built for India.
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            HR teams juggle 6–8 disconnected tools — data is fragmented, compliance is risky, time is lost to data entry.
            CognixHR replaces all of it.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <Reveal key={p.title} delay={i * 70}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-elevated gradient-border-hover">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-110"
                  style={{ background: p.bg, color: p.color, boxShadow: `0 0 16px -4px ${p.color}40` }}
                >
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- KEY OFFERINGS ---------------- */
function KeyOfferings() {
  const tiles = [
    {
      icon: Users2,
      title: "People & Lifecycle",
      bullets: ["Profiles & Org Chart", "AI-assisted Onboarding", "Documents & Letters", "Separation & FnF"],
      tint: "from-[#1A4D8F] to-[#2260A8]",
    },
    {
      icon: CalendarClock,
      title: "Time & Attendance",
      bullets: ["Punches & Muster", "Shifts & Rosters", "Leave & WFH", "Anomaly forensics"],
      tint: "from-[#15B8A6] to-[#2DD4BF]",
    },
    {
      icon: Banknote,
      title: "Payroll & Compliance",
      bullets: ["Payroll runs & sim", "PF / ESI / PT / TDS / LWF", "ECR 2.0 · Form 24Q", "Variance & cost intel"],
      tint: "from-[#2E6FE6] to-[#5C9AFF]",
    },
    {
      icon: Briefcase,
      title: "Talent & Recruitment",
      bullets: ["Requisitions & Kanban", "Interviews & scorecards", "BGV & Offers", "Job-board posting"],
      tint: "from-[#B07B18] to-[#E0A93B]",
    },
  ];
  return (
    <section className="py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Key offerings</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Everything HR runs, in four pillars</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {tiles.map((t, i) => (
            <Reveal key={t.title} delay={i * 100}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-elevated gradient-overlay-hover sm:p-8">
                <div className={`absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br ${t.tint} opacity-10 transition-opacity group-hover:opacity-20`} />
                <div
                  className={`grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br ${t.tint} text-white shadow-soft transition-transform duration-300 group-hover:scale-105`}
                  style={{ filter: "drop-shadow(0 6px 18px rgba(46,111,230,0.25))" }}
                >
                  <t.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-bold">{t.title}</h3>
                <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {t.bullets.map((b) => (
                    <li key={b} className="flex items-center gap-2 text-sm text-foreground/80">
                      <Check className="h-4 w-4 shrink-0 text-[#15B8A6]" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- MODULES ---------------- */
function Modules() {
  const groups = [
    {
      key: "people",
      label: "People & Workforce",
      icon: Users2,
      items: [
        ["Employee Directory & Profiles", "Single source of truth for every employee"],
        ["Org Chart", "Live, hierarchical view of teams and reporting"],
        ["AI-assisted Onboarding", "Pre-join portal, doc upload, AI validation, checklists"],
        ["Separation & Exit", "Notice period, exit interviews, clearance, FnF"],
        ["Expiry & Lifecycle Management", "Visa, passport, contract, probation, identity"],
        ["Certifications", "Track issued, expiring and renewed credentials"],
        ["Documents & Letter Engine", "Offer, appointment, promotion, experience, PIP, appraisal"],
        ["Assets & Benefits", "Issue, track and reclaim across the lifecycle"],
      ],
    },
    {
      key: "attendance",
      label: "Attendance, Shifts & Leave",
      icon: CalendarClock,
      items: [
        ["Attendance Operations", "Punches, who's-in, muster"],
        ["Regularisation & Approvals", "Workflow-driven exceptions"],
        ["Anomalies & Forensics", "AI flags missed punches, patterns"],
        ["Shifts, Rosters & Rotation", "Weekly-off credit, rotation policies"],
        ["Leave Management", "Types, accrual, comp-off, collision detection"],
        ["Overtime & Holiday Calendars", "Multi-location holiday rules"],
        ["Work-From-Home", "Request, approve, track"],
      ],
    },
    {
      key: "payroll",
      label: "Payroll",
      icon: Banknote,
      items: [
        ["Payroll Runs & Readiness", "Pre-run checklists with AI validation"],
        ["Compensation Master & Revisions", "Full history with effective dates"],
        ["Payroll Simulation", "What-if before you run"],
        ["Variance & Cost Intelligence", "Spot the deltas instantly"],
        ["Loans, Advances, Reimbursements", "Variable pay & arrears handled"],
        ["Payout & Reconciliation", "Bank files, recon, audit trail"],
      ],
    },
    {
      key: "compliance",
      label: "Statutory Compliance (India)",
      icon: ShieldCheck,
      items: [
        ["PF / EPF, ESI, PT, TDS, LWF", "All five core statutes built-in"],
        ["Statutory Groups", "State-wise rules, wage ceilings"],
        ["Filing Packs", "ECR 2.0, Form 24Q, challan sheets"],
        ["Compliance Calendar", "Never miss a due date"],
        ["Statutory Reconciliation", "Books vs filings, settled"],
      ],
    },
    {
      key: "talent",
      label: "Recruitment & Talent (ATS)",
      icon: Briefcase,
      items: [
        ["Requisitions", "Multi-stage approvals"],
        ["Kanban Pipeline", "Drag-and-drop candidate flow"],
        ["Candidates & Question Bank", "Reusable, role-tagged"],
        ["Interviews & Scorecards", "Structured, calibrated"],
        ["Interview Analytics", "Panel calibration, hire accuracy"],
        ["Background Verification (BGV)", "Built-in vendor handoffs"],
        ["Offers & Hired Pipeline", "Auto pre-boarding hand-off"],
        ["Job-board posting", "Publish to multiple sources"],
      ],
    },
    {
      key: "ess",
      label: "Self-Service & Setup",
      icon: Settings2,
      items: [
        ["Employee Self-Service", "Payslips, leave, claims, letters, assets, WFH, tax"],
        ["Manager Console", "Team attendance, approvals, assets, cost"],
        ["Configurable Masters", "Adapt the system to your policies"],
        ["Bulk Upload / Import Engine", "Validated Excel templates"],
        ["Roles, Workflows & White-label", "Brand it as yours"],
      ],
    },
  ];

  const [active, setActive] = useState(groups[0].key);
  const current = groups.find((g) => g.key === active)!;

  return (
    <section id="modules" className="bg-card/40 py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Modules</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">A complete HR operating system</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Six tightly-integrated groups, dozens of capabilities, one unified data model.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* Tab rail */}
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {groups.map((g) => {
              const isActive = active === g.key;
              return (
                <button
                  key={g.key}
                  onClick={() => setActive(g.key)}
                  className={`flex shrink-0 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all ${
                    isActive
                      ? "border-[#2E6FE6]/40 bg-[#2E6FE6]/[0.06] text-[#1A4D8F] shadow-soft"
                      : "border-border bg-card text-foreground/70 hover:bg-muted"
                  }`}
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-lg ${isActive ? "bg-[#2E6FE6] text-white" : "bg-muted text-foreground/70"}`}>
                    <g.icon className="h-4 w-4" />
                  </span>
                  <span className="whitespace-nowrap lg:whitespace-normal">{g.label}</span>
                </button>
              );
            })}
          </div>

          {/* Panel */}
          <Reveal key={current.key} className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#2E6FE6] to-[#15B8A6] text-white">
                  <current.icon className="h-5 w-5" />
                </span>
                <h3 className="text-xl font-bold">{current.label}</h3>
              </div>
              <span className="chip">{current.items.length} capabilities</span>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {current.items.map(([label, desc]) => (
                <div key={label} className="flex gap-3 rounded-xl border border-border bg-background/60 p-3.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#15B8A6]/15 text-[#15B8A6]">
                    <Check className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- ANALYTICS ---------------- */
function Analytics() {
  const items = [
    { icon: Users2, t: "Workforce Analytics", d: "Headcount, attrition, movement, demographics" },
    { icon: TrendingUp, t: "Executive Intelligence", d: "Board-grade KPIs with one-click drilldowns" },
    { icon: CalendarClock, t: "Attendance Forensics", d: "Patterns, missed punches, exceptions" },
    { icon: Banknote, t: "Payroll Variance", d: "Run-over-run variance, cost intelligence" },
    { icon: Briefcase, t: "Recruitment Funnel", d: "Source, stage, panel calibration, hire accuracy" },
    { icon: FileText, t: "Exit Analytics", d: "Reasons, regrettable loss, tenure cohorts" },
    { icon: BarChart3, t: "Org Health Pulse", d: "Composite score across people signals" },
  ];
  return (
    <section id="analytics" className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Analytics</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Live workforce intelligence, not month-old reports
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Every transaction in CognixHR rolls into real-time dashboards for HR, finance and the C-suite.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <Reveal>
            <div className="grid gap-3">
              {items.map((it) => (
                <div key={it.t} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#1A4D8F]/10 text-[#1A4D8F]">
                    <it.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{it.t}</p>
                    <p className="text-sm text-muted-foreground">{it.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={120}>
            <AnalyticsMock />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- AI ---------------- */
function AI() {
  const items = [
    { icon: ScanSearch, t: "AI Onboarding & Document Intelligence", d: "Reads & validates uploaded IDs, flags issues, requests re-uploads.", save: "Saves 6–8 hrs / new hire" },
    { icon: CalendarClock, t: "Attendance Anomaly Detection", d: "Spots missed punches, pattern abuse and roster mismatches automatically.", save: "Catches 90% of exceptions" },
    { icon: Banknote, t: "Payroll Forensics & Validation", d: "Run-over-run validation, statutory checks, deltas explained.", save: "Cuts payroll errors to <0.5%" },
    { icon: TrendingUp, t: "Workforce Optimisation", d: "Surfaces over/under-staffing, span-of-control and cost outliers.", save: "Recovers 4–7% of labour spend" },
    { icon: BarChart3, t: "Predictive Insights", d: "Cost & headcount forecasting, attrition risk modelling.", save: "Plan 1–2 quarters ahead" },
    { icon: Wand2, t: "Smart Search / Command Center", d: "Ask in plain English — get answers across people, payroll and time.", save: "Zero-click reports" },
  ];
  return (
    <section id="ai" className="relative overflow-hidden bg-gradient-to-b from-[#0F2A4D] to-[#1A4D8F] py-20 text-white sm:py-28">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
        backgroundSize: "28px 28px",
      }} />
      <div className="container-page relative">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
            <Brain className="h-3.5 w-3.5 text-[#2DD4BF]" />
            AI
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">AI that removes the busywork</h2>
          <p className="mt-3 text-white/75">
            Practical AI woven through every module — measurable hours and rupees saved, every month.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <Reveal key={it.t} delay={i * 60}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition-all hover:-translate-y-1 hover:bg-white/[0.08]">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#2DD4BF]/15 text-[#2DD4BF]">
                  <it.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{it.t}</h3>
                <p className="mt-1.5 text-sm text-white/70">{it.d}</p>
                <p className="mt-4 inline-flex rounded-full bg-[#2DD4BF]/15 px-3 py-1 text-xs font-semibold text-[#2DD4BF]">
                  {it.save}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- INTEGRATIONS ---------------- */
function Integrations() {
  const groups = [
    {
      label: "Accounting",
      color: "#2E6FE6",
      items: ["Tally", "Zoho Books", "QuickBooks"],
    },
    {
      label: "Payroll payouts",
      color: "#1A8050",
      items: ["Razorpay", "Cashfree", "HDFC SmartPay"],
    },
    {
      label: "Statutory portals",
      color: "#B07B18",
      items: ["EPFO / ESIC", "TRACES / NSDL", "GSTN"],
    },
    {
      label: "Identity & docs",
      color: "#7C3AED",
      items: ["DigiLocker", "Aadhaar eKYC", "NSDL PAN"],
    },
    {
      label: "Collaboration",
      color: "#15B8A6",
      items: ["Slack", "MS Teams", "WhatsApp Business"],
    },
    {
      label: "SSO & productivity",
      color: "#2260A8",
      items: ["Google Workspace", "Microsoft 365", "Okta"],
    },
  ];
  return (
    <section className="bg-card/40 py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Integrations</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Works with your existing stack</h2>
          <p className="mt-3 text-base text-muted-foreground">
            CognixHR connects to the tools your finance, IT and ops teams already use — no rip-and-replace required.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g, i) => (
            <Reveal key={g.label} delay={i * 60}>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
                <p
                  className="mb-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: g.color }}
                >
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {g.items.map((name) => (
                    <span
                      key={name}
                      className="rounded-full border px-3 py-1 text-sm font-medium text-foreground/80"
                      style={{ borderColor: `${g.color}30`, background: `${g.color}08` }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          More integrations via REST API / webhooks · Custom connectors available on Enterprise
        </p>
      </div>
    </section>
  );
}

/* ---------------- HOW IT WORKS ---------------- */
function HowItWorks() {
  const steps = [
    { n: "01", t: "Configure", d: "Set up masters, policies, statutory groups and white-label branding in days, not months." },
    { n: "02", t: "Run daily ops", d: "Onboarding, attendance, leave, payroll, recruitment — all in one workspace." },
    { n: "03", t: "Get insights", d: "Live dashboards and AI-driven recommendations across HR, finance and leadership." },
  ];
  return (
    <section className="py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">How it works</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">From kickoff to insights in three steps</h2>
        </Reveal>
        <div className="relative mt-12 grid gap-5 md:grid-cols-3">
          {/* Connecting line, draws across on scroll-in */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute left-[16%] right-[16%] top-1/2 hidden h-px -translate-y-1/2 bg-gradient-to-r from-[#2E6FE6]/40 via-[#15B8A6]/40 to-[#2E6FE6]/40 md:block"
            initial={{ scaleX: 0, transformOrigin: "left center" }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="relative h-full rounded-2xl border border-border bg-card p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated">
                <motion.span
                  className="inline-block font-mono text-sm font-semibold text-[#15B8A6]"
                  initial={{ opacity: 0, scale: 0.6 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.15 + i * 0.15 }}
                >
                  {s.n}
                </motion.span>
                <h3 className="mt-2 text-xl font-bold">{s.t}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
                {i < steps.length - 1 && (
                  <ChevronRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-[#15B8A6]/50 md:block" />
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- PRICING PREVIEW ---------------- */
function PricingPreview() {
  const { open } = useDemoModal();
  const plans = [
    { name: "Starter", priceNum: 49, priceDisplay: "Custom" as string | null, tag: "Small teams · min 10 seats", cta: "Start free trial", featured: false },
    { name: "Growth", priceNum: 99, priceDisplay: null, tag: "Growing companies · min 25 seats", cta: "Book a Demo", featured: true },
    { name: "Enterprise", priceNum: null, priceDisplay: "Custom", tag: "Large / multi-entity · 100+ seats", cta: "Talk to Sales", featured: false },
  ] as { name: string; priceNum: number | null; priceDisplay: string | null; tag: string; cta: string; featured: boolean }[];

  const addons = [
    { name: "Recruitment & ATS", price: "+₹40" },
    { name: "Payroll & Compliance", price: "+₹45" },
    { name: "AI Suite", price: "+₹35" },
    { name: "Advanced Analytics", price: "+₹30" },
    { name: "Shifts / Rosters / WFH", price: "+₹25" },
    { name: "Assets & Benefits", price: "+₹15" },
  ];

  return (
    <section id="pricing" className="bg-card/40 py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Pricing</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Pricing that scales with you</h2>
          <p className="mt-3 text-base text-muted-foreground">
            Per-employee per-month, billed annually. Add only the modules you need.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {plans.map((p, i) => (
            <Reveal key={p.name} delay={i * 80}>
              <div
                className={`relative h-full rounded-2xl p-7 transition-all hover:-translate-y-1 ${
                  p.featured
                    ? "border-2 border-[#2E6FE6] bg-card shadow-elevated lg:-translate-y-3 glow-featured"
                    : "border border-border bg-card shadow-card hover:shadow-elevated"
                }`}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#15B8A6] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-soft">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-bold">{p.name}</h3>
                <p className="text-xs text-muted-foreground">{p.tag}</p>
                <p className="mt-5 flex items-baseline gap-1">
                  {p.priceNum !== null ? (
                    <>
                      <span className="text-4xl font-extrabold tracking-tight">
                        <CountUp value={p.priceNum} prefix="₹" />
                      </span>
                      <span className="text-sm text-muted-foreground">/emp/mo</span>
                    </>
                  ) : (
                    <span className="text-4xl font-extrabold tracking-tight">{p.priceDisplay}</span>
                  )}
                </p>
                <Button
                  onClick={() => open(`pricing-${p.name}`)}
                  className={`mt-5 h-11 w-full rounded-full font-semibold ${
                    p.featured ? "btn-brand" : "bg-foreground text-background hover:bg-foreground/90"
                  }`}
                >
                  {p.cta}
                </Button>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Per-module add-ons */}
        <Reveal className="mx-auto mt-20 max-w-2xl text-center">
          <span className="chip">Add-on modules</span>
          <h3 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Need just one capability? Add any module.
          </h3>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {addons.map((a, i) => (
            <Reveal key={a.name} delay={i * 50}>
              <div className="group h-full rounded-2xl border border-border bg-card/70 p-5 shadow-card backdrop-blur-sm transition-all hover:-translate-y-1 hover:shadow-elevated hover:border-[#2E6FE6]/40">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold">{a.name}</p>
                  <span className="rounded-full bg-gradient-to-r from-[#2E6FE6]/10 to-[#15B8A6]/10 px-2.5 py-1 text-sm font-bold text-[#2E6FE6]">
                    {a.price}
                  </span>
                </div>
                <p className="mt-2 text-xs font-medium text-muted-foreground">/ employee / month</p>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted-foreground">
          Prices exclude GST. Annual billing. Volume discounts 250+.
        </p>

        <div className="mt-10 text-center">
          <Link to="/pricing" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2E6FE6] hover:underline">
            Compare every feature & add-ons <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------- LIVE DEMO BAND ---------------- */
function LiveDemoBand() {
  return (
    <section className="py-16">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#15B8A6] to-[#0E8378] p-8 text-white sm:p-12">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
            <div className="relative grid items-center gap-6 sm:grid-cols-[1.4fr_auto]">
              <div>
                <h3 className="text-2xl font-bold sm:text-3xl">See CognixHR in action — right now.</h3>
                <p className="mt-2 max-w-xl text-white/85">
                  Jump straight into a live sandbox. No signup, no setup. Click around the full product.
                </p>
              </div>
              <a
                href="https://hrms-web-alpha.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-14 items-center gap-2 self-start rounded-full bg-white px-7 text-base font-bold text-[#0E8378] shadow-soft transition-transform hover:scale-[1.02]"
              >
                Try the Live Demo
                <ArrowRight className="h-5 w-5" />
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- TESTIMONIALS ---------------- */
function Testimonials() {
  const t = [
    {
      q: "We replaced four vendors with CognixHR and closed our first month-end three days early.",
      n: "Priya M.", r: "Head of People · 1,200-person IT services firm",
    },
    {
      q: "The AI payroll forensics caught variances we used to find weeks later. Audit prep is now boring — which is great.",
      n: "Rohit A.", r: "Director of Finance · Manufacturing",
    },
    {
      q: "ESS adoption is 94% in week one. Our HR ticket volume dropped by half.",
      n: "Anita V.", r: "VP HR · D2C brand",
    },
  ];
  return (
    <section className="py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Loved by HR teams</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">What customers say</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {t.map((it, i) => (
            <Reveal key={it.n} delay={i * 100}>
              <figure className="relative h-full rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated gradient-border-hover">
                <div className="text-3xl leading-none text-[#15B8A6]">"</div>
                <blockquote className="mt-2 text-sm text-foreground/85">{it.q}</blockquote>
                <figcaption className="mt-5 flex items-center gap-3 border-t border-border pt-4">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6] text-sm font-bold text-white">
                    {it.n[0]}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{it.n}</p>
                    <p className="text-xs text-muted-foreground">{it.r}</p>
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */
function FAQ() {
  const faqs = [
    { q: "Is CognixHR ready for India statutory compliance?", a: "Yes. PF, ESI, PT, TDS and LWF are built in with state-wise rules, ECR 2.0 and Form 24Q filing packs, plus a compliance calendar." },
    { q: "How long does implementation take?", a: "Most mid-market customers go live in 2–4 weeks. Configurable masters and bulk-upload templates accelerate setup." },
    { q: "Can we white-label it?", a: "Yes — Growth and Enterprise customers can apply their own branding, domain and role-scoped workflows." },
    { q: "Is our data secure?", a: "Multi-tenant isolation, role-based access, audit logs and DPDP-aware controls. SOC-2-style controls available on Enterprise." },
    { q: "Do you offer a live sandbox?", a: "Yes — click 'Try the Live Demo' to explore the full product instantly. No signup required." },
    { q: "What about migration from our existing HRMS?", a: "Our bulk import engine ingests validated Excel templates for masters, employees, balances and historicals — with field-level validation." },
  ];
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <section className="bg-card/40 py-20 sm:py-24">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">FAQ</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Questions, answered</h2>
        </Reveal>
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {faqs.map((f, i) => {
            const isOpen = openIdx === i;
            return (
              <Reveal key={f.q} delay={i * 60}>
                <div
                  className={`overflow-hidden rounded-xl border bg-card transition-colors duration-300 ${
                    isOpen ? "border-[#15B8A6]/60 border-l-4 border-l-[#15B8A6]" : "border-border"
                  }`}
                >
                  <button
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className={`text-sm font-semibold sm:text-base ${isOpen ? "text-[#1A4D8F]" : "text-foreground"}`}>{f.q}</span>
                    <motion.span
                      animate={{ rotate: isOpen ? 180 : 0 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20 }}
                      className="grid h-7 w-7 place-items-center rounded-full bg-muted text-muted-foreground"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </motion.span>
                  </button>
                  <FaqContent open={isOpen}>{f.a}</FaqContent>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FaqContent({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          style={{ overflow: "hidden" }}
        >
          <div className="px-5 pb-5 text-sm text-muted-foreground">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- FINAL CTA ---------------- */
function FinalCTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border hero-gradient p-10 text-center text-white shadow-elevated sm:p-16">
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-[#2DD4BF]/30 blur-3xl animate-blob" />
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#2E6FE6]/40 blur-3xl animate-blob" style={{ animationDelay: "2s" }} />
            <div className="relative">
              <Building2 className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to modernise HR at your company?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">
                Book a 30-minute walkthrough or jump straight into the live demo sandbox.
              </p>
              <div className="mt-7 flex justify-center">
                <DemoButtons source="final-cta" inverse align="center" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
