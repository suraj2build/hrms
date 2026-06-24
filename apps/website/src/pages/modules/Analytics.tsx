import { Link } from "react-router-dom";
import {
  Check,
  ArrowLeft,
  FileSpreadsheet,
  Layers,
  TrendingDown,
  BarChart3,
  TrendingUp,
  Brain,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function AnalyticsPage() {
  return (
    <SiteShell>
      <AnalyticsHero />
      <PainPoints />
      <FeatureDeepDive />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function AnalyticsHero() {
  return (
    <section className="relative -mt-16 overflow-hidden bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6] pt-36 pb-20 text-white">
      <div className="pointer-events-none absolute -top-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-[#2DD4BF]/20 blur-3xl animate-blob" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full bg-[#2E6FE6]/30 blur-3xl animate-blob" style={{ animationDelay: "2s" }} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="container-page relative">
        <Reveal>
          <div className="mb-6 flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/20 transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Home
            </Link>
            <span className="text-white/40">/</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
              Analytics
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Live workforce intelligence.
            <br />
            <span className="text-[#2DD4BF]">Not month-old reports.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            Board-grade dashboards, drill-downs and AI-driven recommendations — across HR, finance and leadership.
          </p>
          <div className="mt-7">
            <DemoButtons source="module-hero" inverse />
          </div>
          <p className="mt-4 text-xs font-medium text-white/60">
            No credit card · Full sandbox · India statutory-ready
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- PAIN POINTS ---------------- */
function PainPoints() {
  const pains = [
    {
      icon: FileSpreadsheet,
      title: "Reports are always stale",
      desc: "Month-end Excel reports don't help you spot a problem in week two.",
      color: "#C93535",
    },
    {
      icon: Layers,
      title: "Data lives in silos",
      desc: "Payroll, attendance, and recruitment data never talk to each other.",
      color: "#B07B18",
    },
    {
      icon: TrendingDown,
      title: "No early-warning signals",
      desc: "Attrition risk, cost overruns and compliance gaps surface as surprises, not alerts.",
      color: "#C93535",
    },
  ];

  return (
    <section className="py-20">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">The problem</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">The old way is broken</h2>
          <p className="mt-3 text-base text-muted-foreground">
            HR decisions made on week-old Excel exports aren't decisions — they're guesses. Live intelligence changes everything.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {pains.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <div className="rounded-2xl border border-border bg-card p-6 shadow-card h-full">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl"
                  style={{ background: `${p.color}15`, color: p.color }}
                >
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{p.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FEATURE DEEP-DIVE ---------------- */
function FeatureDeepDive() {
  const features = [
    {
      number: "01",
      title: "Workforce & Attrition Analytics",
      desc: "Track every headcount movement in real time — joins, exits, transfers — with an attrition model that flags regrettable-loss risk before employees resign.",
      bullets: [
        "Live headcount by department, location, grade",
        "Attrition trends with regrettable-loss flag",
        "Headcount movement (joins, exits, transfers)",
        "Demographic breakdown",
      ],
      visual: <WorkforceMock />,
    },
    {
      number: "02",
      title: "Executive Intelligence Dashboard",
      desc: "Give the C-suite a single pane of glass — board-grade KPIs with one-click drill-downs into any metric, exportable as board packs in a single click.",
      bullets: [
        "CXO dashboard with one-click drill-down",
        "Payroll cost vs budget variance",
        "Org health composite score",
        "Exportable board packs",
      ],
      visual: <ExecutiveMock />,
    },
    {
      number: "03",
      title: "Payroll & Compliance Intelligence",
      desc: "Cross-module intelligence links payroll costs to cost centres, tracks statutory reconciliation, and fires compliance calendar alerts before due dates become penalties.",
      bullets: [
        "Run-over-run payroll variance",
        "Statutory reconciliation view",
        "Cost centre and department P&L split",
        "Compliance calendar alerts",
      ],
      visual: <PayrollComplianceMock />,
    },
    {
      number: "04",
      title: "Predictive Insights & AI",
      desc: "Forward-looking analytics that surface risks before they become problems — attrition probability by employee, headcount forecasting, and recruitment funnel conversion modelling.",
      bullets: [
        "Attrition risk model by employee",
        "Headcount and cost forecasting",
        "AI surfaces anomalies before they become problems",
        "Recruitment funnel conversion analytics",
      ],
      visual: <PredictiveMock />,
    },
  ];

  return (
    <section className="py-12">
      <div className="container-page space-y-20">
        {features.map((f, i) => {
          const isEven = i % 2 === 0;
          return (
            <Reveal key={f.number}>
              <div className={`grid items-center gap-12 py-4 lg:grid-cols-2 ${isEven ? "" : "lg:[direction:rtl]"}`}>
                <div className={isEven ? "" : "lg:[direction:ltr]"}>
                  <span className="font-mono text-sm font-semibold text-[#15B8A6]">{f.number}</span>
                  <h3 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{f.title}</h3>
                  <p className="mt-3 text-base text-muted-foreground">{f.desc}</p>
                  <ul className="mt-5 space-y-2.5">
                    {f.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#15B8A6]/15 text-[#15B8A6]">
                          <Check className="h-3 w-3" />
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={isEven ? "" : "lg:[direction:ltr]"}>{f.visual}</div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- VISUAL MOCKS ---------------- */
function WorkforceMock() {
  const depts = [
    { name: "Engineering", headcount: 312, attrition: 8.2, change: "+12" },
    { name: "Sales", headcount: 184, attrition: 14.5, change: "-3" },
    { name: "Operations", headcount: 247, attrition: 6.1, change: "+8" },
    { name: "HR & Finance", headcount: 76, attrition: 4.2, change: "0" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workforce Analytics</p>
          <p className="mt-1 text-lg font-bold">Live headcount · 1,284</p>
        </div>
        <span className="chip">Real-time</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {depts.map((d) => (
          <div key={d.name} className="rounded-xl border border-border bg-background/60 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">{d.name}</p>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">HC: <span className="font-bold text-foreground">{d.headcount}</span></span>
                <span
                  className="font-semibold"
                  style={{ color: d.change.startsWith("+") ? "#1A8050" : d.change.startsWith("-") ? "#C93535" : "#637080" }}
                >
                  {d.change}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Attrition</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(d.attrition * 5, 100)}%`,
                    background: d.attrition > 12 ? "#C93535" : d.attrition > 8 ? "#B07B18" : "#1A8050",
                  }}
                />
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground">{d.attrition}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#C93535]/5 to-[#B07B18]/5 border border-[#C93535]/10 p-3">
        <p className="text-xs font-semibold text-[#C93535]">Sales attrition 14.5% — above 12% threshold</p>
        <p className="text-xs text-muted-foreground">AI recommends reviewing compensation benchmarks</p>
      </div>
    </div>
  );
}

function ExecutiveMock() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Executive Dashboard</p>
          <p className="mt-1 text-lg font-bold">Org Health Pulse · Q2 FY26</p>
        </div>
        <span className="rounded-full bg-[#1A8050]/10 px-3 py-1 text-xs font-bold text-[#1A8050]">Score: 84</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { label: "Payroll cost", value: "₹6.4 Cr", vs: "Budget ₹6.6 Cr", flag: false },
          { label: "Attrition", value: "11.2%", vs: "Target <12%", flag: false },
          { label: "Hire vs plan", value: "68/72", vs: "94% of target", flag: false },
          { label: "Compliance score", value: "96%", vs: "All statutes filed", flag: false },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-xl font-bold">{k.value}</p>
            <p className="text-[11px] text-[#1A8050] font-medium">{k.vs}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-border p-3">
        <p className="text-xs font-semibold mb-2">Org Health components</p>
        {[
          { name: "Retention", score: 88, color: "#1A8050" },
          { name: "Hiring velocity", score: 82, color: "#2E6FE6" },
          { name: "Compliance", score: 96, color: "#15B8A6" },
          { name: "Engagement proxy", score: 74, color: "#B07B18" },
        ].map((c) => (
          <div key={c.name} className="mt-2">
            <div className="flex justify-between text-[11px] font-medium mb-1">
              <span className="text-muted-foreground">{c.name}</span>
              <span style={{ color: c.color }}>{c.score}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${c.score}%`, background: c.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayrollComplianceMock() {
  const costCentres = [
    { name: "Engineering", cost: "₹2.14 Cr", pct: 33, color: "#1A4D8F" },
    { name: "Sales", cost: "₹1.47 Cr", pct: 23, color: "#2E6FE6" },
    { name: "Operations", cost: "₹1.82 Cr", pct: 28, color: "#2260A8" },
    { name: "G&A", cost: "₹1.03 Cr", pct: 16, color: "#15B8A6" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payroll Intelligence</p>
          <p className="mt-1 text-lg font-bold">Cost Centre Split · Jun 2025</p>
        </div>
        <span className="text-[11px] text-muted-foreground">Total: ₹6.46 Cr</span>
      </div>
      <div className="mt-4 space-y-2">
        {costCentres.map((c) => (
          <div key={c.name} className="flex items-center gap-3">
            <span className="w-20 text-xs font-medium text-muted-foreground">{c.name}</span>
            <div className="h-7 flex-1 overflow-hidden rounded-lg bg-muted">
              <div
                className="flex h-full items-center px-2.5 text-[11px] font-bold text-white"
                style={{ width: `${c.pct}%`, background: c.color }}
              >
                {c.cost}
              </div>
            </div>
            <span className="w-8 text-right text-[11px] font-semibold text-muted-foreground">{c.pct}%</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-border p-3">
        <p className="text-xs font-semibold mb-2">Compliance calendar</p>
        <div className="space-y-1.5">
          {[
            { item: "PF ECR filing", due: "Jul 15", status: "On track", ok: true },
            { item: "ESI challan", due: "Jul 21", status: "On track", ok: true },
            { item: "TDS Q1 return", due: "Jul 31", status: "Prep started", ok: true },
          ].map((cal) => (
            <div key={cal.item} className="flex items-center justify-between text-xs">
              <span className="text-foreground/80">{cal.item}</span>
              <span className="text-muted-foreground">Due {cal.due}</span>
              <span className="font-semibold text-[#1A8050]">{cal.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PredictiveMock() {
  const riskEmployees = [
    { name: "Arjun K.", dept: "Sales", riskScore: 87, factors: "3 missed targets, team change" },
    { name: "Meera T.", dept: "Engineering", riskScore: 72, factors: "No promotion in 24 mo" },
    { name: "Suresh P.", dept: "Ops", riskScore: 64, factors: "Pay below market P50" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Predictive Insights</p>
          <p className="mt-1 text-lg font-bold">Attrition Risk Model</p>
        </div>
        <span className="rounded-full bg-[#C93535]/10 px-3 py-1 text-xs font-bold text-[#C93535]">3 high-risk</span>
      </div>
      <div className="mt-4 space-y-3">
        {riskEmployees.map((e) => (
          <div key={e.name} className="rounded-xl border border-[#C93535]/20 bg-[#C93535]/[0.03] p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">{e.name} <span className="text-xs font-normal text-muted-foreground">· {e.dept}</span></p>
              <span className="text-sm font-bold text-[#C93535]">{e.riskScore}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted mb-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${e.riskScore}%`, background: e.riskScore > 80 ? "#C93535" : "#B07B18" }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">Signals: {e.factors}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#7C3AED]/5 to-[#2E6FE6]/5 border border-[#7C3AED]/10 p-3">
        <p className="text-xs font-semibold text-[#7C3AED]">AI forecast: 18–22 exits in next 90 days</p>
        <p className="text-xs text-muted-foreground">Headcount replacement pipeline: 14 active requisitions</p>
      </div>
    </div>
  );
}

/* ---------------- BOTTOM CTA ---------------- */
function BottomCTA() {
  return (
    <section className="py-20">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl hero-gradient p-10 text-center text-white shadow-elevated sm:p-16">
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-[#2DD4BF]/30 blur-3xl" />
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#2E6FE6]/40 blur-3xl" />
            <div className="relative">
              <BarChart3 className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to transform analytics at your company?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">
                Book a 30-minute walkthrough or jump straight into the live demo sandbox.
              </p>
              <div className="mt-7 flex justify-center">
                <DemoButtons source="module-cta" inverse align="center" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
