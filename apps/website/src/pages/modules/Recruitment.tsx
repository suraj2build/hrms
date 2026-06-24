import { Link } from "react-router-dom";
import {
  Check,
  ArrowLeft,
  Shuffle,
  Users,
  Clock,
  Briefcase,
  BarChart3,
  UserCheck,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function RecruitmentPage() {
  return (
    <SiteShell>
      <RecruitmentHero />
      <PainPoints />
      <FeatureDeepDive />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function RecruitmentHero() {
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
              Recruitment
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Hire faster.
            <br />
            <span className="text-[#2DD4BF]">Hire better.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            Requisitions to offers — a structured ATS that connects hiring to onboarding automatically.
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
      icon: Shuffle,
      title: "Pipeline lives in inboxes",
      desc: "Candidate status in email threads, scorecards in notebooks, decisions undocumented.",
      color: "#C93535",
    },
    {
      icon: Users,
      title: "Interview calibration is broken",
      desc: "Panellists use different criteria. Decisions are gut-feel. Bias is invisible.",
      color: "#B07B18",
    },
    {
      icon: Clock,
      title: "Manual BGV causes offer delays",
      desc: "Background verification is manual, vendor communication is ad-hoc, offers slip.",
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
            Unstructured hiring is the leading cause of poor quality hires — and it costs 3× the salary to fix.
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
      title: "Requisitions & Approval Flow",
      desc: "Structured intake forms route hiring requests through multi-stage approvals, validate against headcount budgets, and auto-publish to job boards once approved.",
      bullets: [
        "Multi-stage approval routing",
        "JD template library",
        "Budget and headcount validation",
        "Auto-publish to job boards",
      ],
      visual: <RequisitionsMock />,
    },
    {
      number: "02",
      title: "Kanban Pipeline & Scorecards",
      desc: "A drag-and-drop pipeline with role-tagged question banks and structured scorecards ensures every panellist evaluates candidates against the same criteria — making calibration effortless.",
      bullets: [
        "Drag-and-drop candidate pipeline",
        "Role-tagged question bank",
        "Structured scorecard for every panel member",
        "Calibration session view with all scores",
      ],
      visual: <KanbanMock />,
    },
    {
      number: "03",
      title: "Interview Analytics",
      desc: "Track panel performance, source attribution and hire accuracy over time so you can make data-driven improvements to every stage of the funnel.",
      bullets: [
        "Offer-acceptance rate by panel",
        "Source-of-hire attribution",
        "Time-to-hire by role and department",
        "Hire accuracy trends",
      ],
      visual: <InterviewAnalyticsMock />,
    },
    {
      number: "04",
      title: "BGV, Offers & Pre-boarding",
      desc: "Close the loop from offer to day-one without losing candidates to slow manual processes — BGV vendor handoff, digital offer, and onboarding checklist are all triggered automatically.",
      bullets: [
        "Built-in BGV vendor handoff",
        "Digital offer letter with e-sign",
        "Auto-trigger onboarding checklist on accept",
        "Candidate portal for pre-join docs",
      ],
      visual: <OffersMock />,
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
function RequisitionsMock() {
  const reqs = [
    { role: "Senior Backend Engineer", dept: "Engineering", stage: "Approved", openings: 2, color: "#1A8050" },
    { role: "Product Designer", dept: "Product", stage: "Pending Finance", openings: 1, color: "#B07B18" },
    { role: "Account Executive", dept: "Sales", stage: "Approved", openings: 3, color: "#1A8050" },
    { role: "Data Analyst", dept: "Analytics", stage: "Active", openings: 1, color: "#2E6FE6" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ATS · Requisitions</p>
          <p className="mt-1 text-lg font-bold">Open positions</p>
        </div>
        <span className="chip">7 openings</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {reqs.map((r) => (
          <div key={r.role} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
              style={{ background: r.color }}
            >
              {r.dept.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{r.role}</p>
              <p className="text-xs text-muted-foreground">{r.dept} · {r.openings} opening{r.openings > 1 ? "s" : ""}</p>
            </div>
            <span className="text-xs font-semibold" style={{ color: r.color }}>{r.stage}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#2E6FE6]/5 to-[#15B8A6]/5 p-3">
        <p className="text-xs font-semibold text-[#1A4D8F]">Auto-published to LinkedIn, Naukri, Indeed</p>
        <p className="text-xs text-muted-foreground">3 approved requisitions · 142 applications received</p>
      </div>
    </div>
  );
}

function KanbanMock() {
  const stages = [
    { name: "Applied", count: 42, color: "#637080" },
    { name: "Screened", count: 18, color: "#2260A8" },
    { name: "Interview", count: 7, color: "#2E6FE6" },
    { name: "Offer", count: 2, color: "#15B8A6" },
  ];
  const candidates = [
    { name: "Deepa Rao", score: 8.4, panel: "Riya + Kiran", stage: "Interview" },
    { name: "Ravi Kumar", score: 7.1, panel: "Riya", stage: "Interview" },
    { name: "Pooja Nair", score: 9.2, panel: "Amit + Sonal", stage: "Offer" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kanban Pipeline</p>
          <p className="mt-1 text-lg font-bold">Senior Backend Engineer</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 mb-4">
        {stages.map((s) => (
          <div key={s.name} className="rounded-xl border border-border p-2.5 text-center">
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.count}</p>
            <p className="text-[11px] text-muted-foreground">{s.name}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active candidates</p>
        {candidates.map((c) => (
          <div key={c.name} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1A4D8F] to-[#15B8A6] text-[10px] font-bold text-white">
              {c.name.split(" ").map((n) => n[0]).join("")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">Panel: {c.panel}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-[#15B8A6]">{c.score}</p>
              <p className="text-[11px] text-muted-foreground">{c.stage}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InterviewAnalyticsMock() {
  const metrics = [
    { label: "Avg time-to-hire", value: "18 days", trend: "↓4 days", good: true },
    { label: "Offer acceptance", value: "84%", trend: "↑6%", good: true },
    { label: "Hire accuracy", value: "91%", trend: "↑3%", good: true },
    { label: "Avg interviews/hire", value: "2.4", trend: "↓0.6", good: true },
  ];
  const sources = [
    { name: "LinkedIn", pct: 38, color: "#2E6FE6" },
    { name: "Naukri", pct: 27, color: "#1A4D8F" },
    { name: "Referrals", pct: 21, color: "#15B8A6" },
    { name: "Direct", pct: 14, color: "#B07B18" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recruitment Analytics</p>
          <p className="mt-1 text-lg font-bold">Funnel Intelligence · Q2</p>
        </div>
        <span className="chip">68 hires</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 mb-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-medium text-muted-foreground">{m.label}</p>
            <p className="mt-1 text-lg font-bold">{m.value}</p>
            <p className="text-xs font-semibold text-[#1A8050]">{m.trend}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border p-3">
        <p className="text-xs font-semibold mb-3">Source of hire</p>
        <div className="space-y-2">
          {sources.map((s) => (
            <div key={s.name} className="flex items-center gap-3">
              <span className="w-14 text-xs font-medium text-muted-foreground">{s.name}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full items-center px-2 text-[10px] font-bold text-white"
                  style={{ width: `${s.pct}%`, background: s.color }}
                >
                  {s.pct}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OffersMock() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Offer & BGV</p>
          <p className="mt-1 text-lg font-bold">Pooja Nair · Senior Backend</p>
        </div>
        <span className="rounded-full bg-[#1A8050]/10 px-3 py-1 text-xs font-bold text-[#1A8050]">Offer Accepted</span>
      </div>
      <div className="mt-4 space-y-3">
        {[
          { step: "Offer letter generated", status: "Done", date: "Jun 20", color: "#1A8050" },
          { step: "E-sign by candidate", status: "Signed", date: "Jun 21", color: "#1A8050" },
          { step: "BGV initiated (AuthBridge)", status: "In Progress", date: "Jun 22", color: "#2260A8" },
          { step: "Onboarding checklist triggered", status: "Auto-sent", date: "Jun 21", color: "#15B8A6" },
          { step: "Pre-join portal access", status: "Active", date: "Jun 21", color: "#15B8A6" },
        ].map((s) => (
          <div key={s.step} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
              style={{ background: s.color }}
            >
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{s.step}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold" style={{ color: s.color }}>{s.status}</p>
              <p className="text-[11px] text-muted-foreground">{s.date}</p>
            </div>
          </div>
        ))}
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
              <Briefcase className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to transform recruitment at your company?
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
