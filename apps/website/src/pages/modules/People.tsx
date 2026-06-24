import { Link } from "react-router-dom";
import {
  Check,
  ArrowLeft,
  FolderOpen,
  Clock,
  FileX,
  Users,
  FileText,
  UserCheck,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function PeoplePage() {
  return (
    <SiteShell>
      <PeopleHero />
      <PainPoints />
      <FeatureDeepDive />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function PeopleHero() {
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
              People
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Every employee's journey.
            <br />
            <span className="text-[#2DD4BF]">One source of truth.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            From pre-join to farewell — onboarding, documents, letters and the full lifecycle in one place.
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
      icon: FolderOpen,
      title: "Employee data is scattered",
      desc: "Seven systems hold seven versions of the same employee record. Nothing matches.",
      color: "#C93535",
    },
    {
      icon: Clock,
      title: "Onboarding takes weeks",
      desc: "Manual onboarding: email PDFs back and forth, chase document uploads, validate by hand.",
      color: "#B07B18",
    },
    {
      icon: FileX,
      title: "Documents and letters are ad-hoc",
      desc: "Offer letters, experience certs, PIPs — created in Word, stored in email, never auditable.",
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
            Fragmented people data means every team works from a different version of the truth — and employees feel it.
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
      title: "Employee Directory & Org Chart",
      desc: "A single, authoritative record for every employee — with a live org chart that reflects reporting lines the moment they change, not when someone remembers to update the spreadsheet.",
      bullets: [
        "Single source of truth for all employee data",
        "Live org chart with reporting lines",
        "Custom fields and profile completeness score",
        "Bulk upload and Excel import",
      ],
      visual: <DirectoryMock />,
    },
    {
      number: "02",
      title: "AI-assisted Onboarding",
      desc: "Give new hires a pre-join portal before day one. AI reads and validates uploaded IDs so HR only reviews exceptions, not every document.",
      bullets: [
        "Pre-join portal before day one",
        "AI reads and validates uploaded IDs",
        "Automated checklist with task assignments",
        "DocuSign-style e-signature on joining docs",
      ],
      visual: <OnboardingMock />,
    },
    {
      number: "03",
      title: "Document & Letter Engine",
      desc: "Configurable templates for every letter type — from offer to experience certificate — delivered digitally with employee acknowledgement and a full version history.",
      bullets: [
        "Configurable templates for offer, appointment, promotion, PIP, experience",
        "Digital delivery with employee acknowledgement",
        "Version history and audit trail",
        "Bulk letter generation",
      ],
      visual: <DocumentsMock />,
    },
    {
      number: "04",
      title: "Separation, FnF & Lifecycle",
      desc: "From notice period to full & final settlement — manage every exit with a structured clearance workflow and automated FnF calculation, and track document expiries before they cause problems.",
      bullets: [
        "Notice period tracking",
        "Multi-stage exit clearance workflow",
        "Full & final settlement (FnF) calculation",
        "Document expiry alerts (visa, passport, contract)",
      ],
      visual: <SeparationMock />,
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
function DirectoryMock() {
  const employees = [
    { name: "Riya Sharma", role: "VP Engineering", dept: "Engineering", reports: 14, avatar: "RS", completion: 98 },
    { name: "Kiran Nair", role: "Product Manager", dept: "Product", reports: 0, avatar: "KN", completion: 92 },
    { name: "Amit Patel", role: "Sales Lead", dept: "Sales", reports: 6, avatar: "AP", completion: 85 },
    { name: "Sonal Mehta", role: "HR Business Partner", dept: "HR", reports: 2, avatar: "SM", completion: 100 },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Employee Directory</p>
          <p className="mt-1 text-lg font-bold">1,284 employees</p>
        </div>
        <span className="chip">Live org chart</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {employees.map((e) => (
          <div key={e.name} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6] text-[11px] font-bold text-white">
              {e.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{e.name}</p>
              <p className="text-xs text-muted-foreground">{e.role} · {e.dept}</p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-[11px] text-muted-foreground">{e.completion}%</span>
                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${e.completion}%`,
                      background: e.completion >= 95 ? "#1A8050" : e.completion >= 85 ? "#2E6FE6" : "#B07B18",
                    }}
                  />
                </div>
              </div>
              {e.reports > 0 && (
                <p className="text-[11px] text-muted-foreground">{e.reports} reports</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingMock() {
  const tasks = [
    { task: "ID proof upload", assignee: "Employee", status: "AI Verified", ok: true },
    { task: "Offer letter e-sign", assignee: "Employee", status: "Signed", ok: true },
    { task: "Bank details submission", assignee: "Employee", status: "Pending", ok: false },
    { task: "IT asset allocation", assignee: "IT Team", status: "Scheduled", ok: true },
    { task: "PF nomination form", assignee: "Employee", status: "Pending", ok: false },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Onboarding Portal</p>
          <p className="mt-1 text-lg font-bold">Priya Kapoor · Joins Jul 1</p>
        </div>
        <span className="rounded-full bg-[#B07B18]/10 px-3 py-1 text-xs font-bold text-[#B07B18]">3/5 done</span>
      </div>
      <div className="mt-4 space-y-2">
        {tasks.map((t) => (
          <div key={t.task} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                t.ok ? "bg-[#1A8050]/10 text-[#1A8050]" : "bg-[#B07B18]/10 text-[#B07B18]"
              }`}
            >
              {t.ok ? "✓" : "○"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.task}</p>
              <p className="text-[11px] text-muted-foreground">{t.assignee}</p>
            </div>
            <span
              className="text-xs font-semibold"
              style={{ color: t.ok ? "#1A8050" : "#B07B18" }}
            >
              {t.status}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#1A4D8F]/5 to-[#15B8A6]/5 p-3">
        <p className="text-xs font-semibold text-[#1A4D8F]">AI validated Aadhaar + PAN automatically</p>
        <p className="text-xs text-muted-foreground">Name match 98% · No manual review needed</p>
      </div>
    </div>
  );
}

function DocumentsMock() {
  const docs = [
    { type: "Offer Letter", recipient: "Priya Kapoor", date: "Jun 20, 2025", status: "Acknowledged" },
    { type: "Appointment Letter", recipient: "Rahul Singh", date: "Jun 15, 2025", status: "Delivered" },
    { type: "Experience Certificate", recipient: "Anjali Rao", date: "Jun 10, 2025", status: "Downloaded" },
    { type: "Promotion Letter", recipient: "Vikram Joshi", date: "Jun 5, 2025", status: "Acknowledged" },
    { type: "PIP Letter", recipient: "Confidential", date: "Jun 3, 2025", status: "Delivered" },
  ];
  const statusColor: Record<string, string> = {
    Acknowledged: "#1A8050",
    Delivered: "#2260A8",
    Downloaded: "#15B8A6",
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Letter Engine</p>
          <p className="mt-1 text-lg font-bold">Document Tracker</p>
        </div>
        <span className="chip">12 templates</span>
      </div>
      <div className="mt-4 space-y-2">
        {docs.map((d) => (
          <div key={d.recipient + d.type} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#2E6FE6]/10">
              <FileText className="h-4 w-4 text-[#2E6FE6]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{d.type}</p>
              <p className="text-xs text-muted-foreground">{d.recipient} · {d.date}</p>
            </div>
            <span
              className="text-xs font-semibold"
              style={{ color: statusColor[d.status] ?? "#637080" }}
            >
              {d.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeparationMock() {
  const clearances = [
    { dept: "IT", task: "Laptop & access revocation", status: "Cleared", color: "#1A8050" },
    { dept: "Finance", task: "Expense settlements", status: "Cleared", color: "#1A8050" },
    { dept: "Admin", task: "ID card & access card", status: "Pending", color: "#B07B18" },
    { dept: "HR", task: "FnF calculation sign-off", status: "In Review", color: "#2260A8" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exit Management</p>
          <p className="mt-1 text-lg font-bold">Separation · Suresh Kumar</p>
        </div>
        <span className="rounded-full bg-[#B07B18]/10 px-3 py-1 text-xs font-bold text-[#B07B18]">Last day Jul 15</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Notice days left", value: "21" },
          { label: "FnF status", value: "Pending" },
          { label: "Clearance", value: "2/4" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-2.5 text-center">
            <p className="text-lg font-bold">{s.value}</p>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exit clearance checklist</p>
        {clearances.map((c) => (
          <div key={c.dept} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
            <span
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
              style={{ background: c.color }}
            >
              {c.dept.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">{c.dept}</p>
              <p className="text-[11px] text-muted-foreground">{c.task}</p>
            </div>
            <span className="text-xs font-semibold" style={{ color: c.color }}>{c.status}</span>
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
              <Users className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to transform people management at your company?
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
