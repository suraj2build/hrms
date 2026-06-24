import { Link } from "react-router-dom";
import {
  Check,
  ArrowLeft,
  Calculator,
  FileWarning,
  Clock,
  Banknote,
  ShieldCheck,
  TrendingUp,
  FileText,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function PayrollPage() {
  return (
    <SiteShell>
      <PayrollHero />
      <PainPoints />
      <FeatureDeepDive />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function PayrollHero() {
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
              Payroll
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Accurate payroll.
            <br />
            <span className="text-[#2DD4BF]">On time. Every time.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            Run, simulate and reconcile payroll across your entire workforce — with India compliance built in.
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
      icon: Calculator,
      title: "Manual errors at scale",
      desc: "Spreadsheet payroll breaks with scale. Errors surface in payslips, not before.",
      color: "#C93535",
    },
    {
      icon: FileWarning,
      title: "Compliance is a moving target",
      desc: "PF, ESI, PT, TDS and LWF rules change. Manual tracking misses updates.",
      color: "#B07B18",
    },
    {
      icon: Clock,
      title: "Variance found weeks late",
      desc: "Run-over-run anomalies go unnoticed until month-end — or worse, until audit.",
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
            Payroll errors cost more than money — they erode trust with every employee and expose you to statutory penalties.
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
      title: "Payroll Runs & Readiness",
      desc: "A pre-run checklist validates every input before the run fires. AI reviews attendance, variable pay and outstanding exceptions — so you catch errors before payslips are generated.",
      bullets: [
        "Pre-run readiness checklist",
        "AI validates inputs before run",
        "Simulation (what-if) mode",
        "Batch and individual processing",
      ],
      visual: <PayrollReadinessMock />,
    },
    {
      number: "02",
      title: "India Statutory Compliance",
      desc: "Every statutory obligation — PF, ESI, PT, TDS and LWF — is computed automatically with state-wise rules, and filing packs are generated in the exact format required.",
      bullets: [
        "PF / EPF + ECR 2.0 generation",
        "ESI computation + challan",
        "PT with state-wise rules",
        "TDS (Form 24Q) + TRACES reconciliation",
        "LWF deductions",
      ],
      visual: <StatutoryMock />,
    },
    {
      number: "03",
      title: "Payroll Variance Intelligence",
      desc: "Compare every run against the previous one at the component level. AI explains spikes automatically so finance sign-off takes minutes, not days.",
      bullets: [
        "Run-over-run delta dashboard",
        "Component-level variance drill-down",
        "AI explains spikes automatically",
        "Export for finance sign-off",
      ],
      visual: <VarianceMock />,
    },
    {
      number: "04",
      title: "Payout & Reconciliation",
      desc: "Generate bank-format salary files for all major Indian banks, reconcile against statements and maintain a complete audit trail for every calculation.",
      bullets: [
        "Bank-format salary files (ICICI, HDFC, SBI)",
        "Reimbursement and loan payout",
        "Full reconciliation vs bank statement",
        "Audit log for every calculation",
      ],
      visual: <PayoutMock />,
    },
    {
      number: "05",
      title: "Compensation Master & History",
      desc: "Maintain a complete revision history with effective dates, model CTC-to-take-home scenarios, and handle variable pay, arrears and ad-hoc components.",
      bullets: [
        "Full revision history with effective dates",
        "CTC-to-take-home calculator",
        "Variable pay components",
        "Arrears handling",
      ],
      visual: <CompensationMock />,
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
function PayrollReadinessMock() {
  const checks = [
    { label: "Attendance data locked", status: "done", pct: 100 },
    { label: "Variable pay submitted", status: "done", pct: 100 },
    { label: "Reimbursements verified", status: "done", pct: 88 },
    { label: "Statutory inputs validated", status: "warn", pct: 72 },
    { label: "Loans & advances", status: "pending", pct: 45 },
  ];
  const statusColor: Record<string, string> = { done: "#1A8050", warn: "#B07B18", pending: "#637080" };
  const statusLabel: Record<string, string> = { done: "Ready", warn: "Review", pending: "Pending" };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payroll Engine</p>
          <p className="mt-1 text-lg font-bold">Run Readiness · Jun 2025</p>
        </div>
        <span className="rounded-full bg-[#B07B18]/10 px-3 py-1 text-xs font-bold text-[#B07B18]">2 items need attention</span>
      </div>
      <div className="mt-4 space-y-3">
        {checks.map((c) => (
          <div key={c.label}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{c.label}</span>
              <span className="text-xs font-semibold" style={{ color: statusColor[c.status] }}>
                {statusLabel[c.status]}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${c.pct}%`, background: statusColor[c.status] }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-3">
        <button className="flex-1 rounded-full border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors">
          Run Simulation
        </button>
        <button className="flex-1 rounded-full bg-gradient-to-r from-[#1A4D8F] to-[#2E6FE6] py-2.5 text-sm font-bold text-white shadow-soft hover:brightness-105 transition-all">
          Run Payroll
        </button>
      </div>
    </div>
  );
}

function StatutoryMock() {
  const statutes = [
    { name: "PF / EPF", status: "Computed", amount: "₹8.4L", color: "#1A8050", file: "ECR 2.0 Ready" },
    { name: "ESI", status: "Computed", amount: "₹1.2L", color: "#2260A8", file: "Challan Ready" },
    { name: "Professional Tax", status: "Computed", amount: "₹47K", color: "#15B8A6", file: "State-wise" },
    { name: "TDS (Form 24Q)", status: "Pending", amount: "₹3.8L", color: "#B07B18", file: "TRACES Sync" },
    { name: "LWF", status: "Computed", amount: "₹12K", color: "#1A4D8F", file: "Annual" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statutory Compliance</p>
          <p className="mt-1 text-lg font-bold">India Obligations · Jun 2025</p>
        </div>
        <span className="chip">4/5 ready</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {statutes.map((s) => (
          <div key={s.name} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
              style={{ background: s.color }}
            >
              {s.name.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{s.name}</p>
              <p className="text-[11px] text-muted-foreground">{s.file}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">{s.amount}</p>
              <p
                className="text-[11px] font-medium"
                style={{ color: s.status === "Computed" ? "#1A8050" : "#B07B18" }}
              >
                {s.status}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VarianceMock() {
  const components = [
    { name: "Basic Salary", prev: "₹1.82 Cr", curr: "₹1.89 Cr", delta: "+3.8%", flag: false },
    { name: "HRA", prev: "₹54.6L", curr: "₹56.7L", delta: "+3.8%", flag: false },
    { name: "Special Allowance", prev: "₹28.4L", curr: "₹41.2L", delta: "+45.1%", flag: true },
    { name: "Statutory Deductions", prev: "₹38.2L", curr: "₹39.8L", delta: "+4.2%", flag: false },
    { name: "Variable Pay", prev: "₹12.0L", curr: "₹18.5L", delta: "+54.2%", flag: true },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Variance Intelligence</p>
          <p className="mt-1 text-lg font-bold">May vs Jun Run</p>
        </div>
        <span className="rounded-full bg-[#C93535]/10 px-3 py-1 text-xs font-bold text-[#C93535]">2 spikes flagged</span>
      </div>
      <div className="mt-4 space-y-2">
        {components.map((c) => (
          <div
            key={c.name}
            className={`flex items-center gap-3 rounded-lg border p-3 ${c.flag ? "border-[#C93535]/30 bg-[#C93535]/[0.04]" : "border-border bg-background/60"}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{c.name}</p>
                {c.flag && (
                  <span className="rounded-full bg-[#C93535]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#C93535]">AI flagged</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">{c.prev}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-semibold">{c.curr}</span>
              <span
                className="font-bold"
                style={{ color: c.flag ? "#C93535" : "#1A8050" }}
              >
                {c.delta}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayoutMock() {
  const banks = [
    { name: "ICICI Bank", employees: 412, amount: "₹2.14 Cr", status: "Ready" },
    { name: "HDFC Bank", employees: 284, amount: "₹1.47 Cr", status: "Ready" },
    { name: "SBI", employees: 178, amount: "₹0.92 Cr", status: "Pending" },
    { name: "Axis Bank", employees: 93, amount: "₹0.48 Cr", status: "Ready" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payout Centre</p>
          <p className="mt-1 text-lg font-bold">Bank Files · Jun 2025</p>
        </div>
        <span className="chip">967 employees</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {banks.map((b) => (
          <div key={b.name} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#1A4D8F]/10 text-[11px] font-bold text-[#1A4D8F]">
              {b.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{b.name}</p>
              <p className="text-[11px] text-muted-foreground">{b.employees} employees</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold">{b.amount}</p>
              <span
                className="text-[11px] font-semibold"
                style={{ color: b.status === "Ready" ? "#1A8050" : "#B07B18" }}
              >
                {b.status}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="flex-1 rounded-full border border-border py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors">
          Export All Files
        </button>
        <button className="flex-1 rounded-full bg-[#1A4D8F] py-2 text-xs font-bold text-white hover:bg-[#2260A8] transition-colors">
          Initiate Transfer
        </button>
      </div>
    </div>
  );
}

function CompensationMock() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compensation Master</p>
          <p className="mt-1 text-lg font-bold">Arun Mehta · L5 Engineer</p>
        </div>
        <span className="rounded-full bg-[#15B8A6]/10 px-3 py-1 text-xs font-semibold text-[#15B8A6]">Revised Apr 2025</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 mb-4">
        {[
          { label: "Annual CTC", value: "₹22.00 L", color: "#1A4D8F" },
          { label: "Monthly Take-home", value: "₹1,42,350", color: "#1A8050" },
          { label: "Variable Pay", value: "₹2.00 L", color: "#2260A8" },
          { label: "Revision effective", value: "Apr 1, 2025", color: "#B07B18" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-sm font-bold" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border p-3">
        <p className="text-xs font-semibold mb-2">Revision history</p>
        <div className="space-y-1.5">
          {[
            { date: "Apr 2025", ctc: "₹22.00 L", note: "Annual increment +12%" },
            { date: "Oct 2024", ctc: "₹19.65 L", note: "Promotion to L5" },
            { date: "Apr 2024", ctc: "₹17.50 L", note: "Annual increment +8%" },
          ].map((r) => (
            <div key={r.date} className="flex items-center gap-3 text-xs">
              <span className="w-16 font-semibold text-muted-foreground">{r.date}</span>
              <span className="font-bold text-foreground">{r.ctc}</span>
              <span className="text-muted-foreground">{r.note}</span>
            </div>
          ))}
        </div>
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
              <Banknote className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to transform payroll at your company?
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
