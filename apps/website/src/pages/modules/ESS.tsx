import { Link } from "react-router-dom";
import {
  Check,
  ArrowLeft,
  MessageSquare,
  FileSearch,
  Clock,
  Smartphone,
  Bell,
  Users,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";
import { MobileESSMock } from "@/components/site/MobileESSMock";

export default function ESSPage() {
  return (
    <SiteShell>
      <ESSHero />
      <PainPoints />
      <FeatureDeepDive />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function ESSHero() {
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
      <div className="container-page relative grid items-center gap-12 lg:grid-cols-2">
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
              Employee Self-Service
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Employees help themselves.
            <br />
            <span className="text-[#2DD4BF]">HR gets their time back.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            Payslips, leave, claims, attendance and documents — all in the employee's pocket.
          </p>
          <div className="mt-7">
            <DemoButtons source="module-hero" inverse />
          </div>
          <p className="mt-4 text-xs font-medium text-white/60">
            No credit card · Full sandbox · India statutory-ready
          </p>
        </Reveal>
        <Reveal delay={150}>
          <MobileESSMock />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- PAIN POINTS ---------------- */
function PainPoints() {
  const pains = [
    {
      icon: MessageSquare,
      title: "HR is a ticket queue",
      desc: "60–70% of HR tickets are 'where's my payslip' and 'can I take leave Friday'. ESS eliminates them.",
      color: "#C93535",
    },
    {
      icon: FileSearch,
      title: "Documents are impossible to find",
      desc: "Employees chase HR for offer letters, experience certs and tax forms — all year long.",
      color: "#B07B18",
    },
    {
      icon: Clock,
      title: "Manager approvals take days",
      desc: "Leave and attendance regularisation sit in email chains for days. Employees resent it.",
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
            HR teams spend more than half their time on repetitive requests that employees should be able to resolve themselves.
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
      title: "Employee Self-Service Portal",
      desc: "Everything an employee needs — payslips, leave balance, reimbursement claims, attendance history — available instantly without a single HR ticket.",
      bullets: [
        "Download payslips and tax forms (Form 16)",
        "Apply leave with leave-balance visibility",
        "Submit reimbursement claims with receipts",
        "View attendance and apply for regularisation",
      ],
      visual: <ESSPortalMock />,
    },
    {
      number: "02",
      title: "Manager Console",
      desc: "Managers get a team-level view with one-click approvals, cost visibility and asset tracking — without needing to involve HR for routine decisions.",
      bullets: [
        "Team attendance and leave calendar",
        "One-click approval queue",
        "Cost and headcount for the manager's span",
        "Asset tracking for direct reports",
      ],
      visual: <ManagerConsoleMock />,
    },
    {
      number: "03",
      title: "Mobile App",
      desc: "Full ESS capability on the go — GPS-based attendance marking, offline leave requests, and biometric unlock so the app is as secure as it is fast.",
      bullets: [
        "GPS-based attendance marking",
        "Push notifications for approvals and payslips",
        "Offline-capable leave application",
        "Biometric app unlock",
      ],
      visual: <MobileAppMock />,
    },
    {
      number: "04",
      title: "Notifications & Workflows",
      desc: "Configurable reminders, escalation rules and a full audit trail ensure nothing slips through the cracks — without HR having to chase anyone.",
      bullets: [
        "WhatsApp and email alerts for approvals",
        "Configurable reminder sequences",
        "Escalation rules for overdue tasks",
        "Audit trail for every self-service action",
      ],
      visual: <NotificationsMock />,
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
function ESSPortalMock() {
  const payslips = [
    { month: "Jun 2025", net: "₹1,42,350", status: "Available" },
    { month: "May 2025", net: "₹1,39,820", status: "Available" },
    { month: "Apr 2025", net: "₹1,39,820", status: "Available" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My ESS Dashboard</p>
          <p className="mt-1 text-lg font-bold">Welcome, Anita</p>
        </div>
        <span className="chip">94% adoption</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 mb-4">
        {[
          { label: "Leave balance", value: "12 days", color: "#1A8050" },
          { label: "Pending claims", value: "₹4,200", color: "#B07B18" },
          { label: "Days worked", value: "22/22", color: "#2260A8" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-2.5 text-center">
            <p className="text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent payslips</p>
        {payslips.map((p) => (
          <div key={p.month} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#2E6FE6]/10">
              <span className="text-[10px] font-bold text-[#2E6FE6]">PDF</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{p.month}</p>
              <p className="text-xs text-muted-foreground">Net: {p.net}</p>
            </div>
            <button className="rounded-full border border-[#15B8A6]/40 px-2.5 py-1 text-[11px] font-semibold text-[#15B8A6]">
              Download
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManagerConsoleMock() {
  const approvals = [
    { emp: "Rahul S.", type: "Leave: Jul 4–5", status: "Pending", days: "2 days" },
    { emp: "Meera K.", type: "WFH: Jul 7", status: "Pending", days: "1 day" },
    { emp: "Vivek P.", type: "Attendance regularisation", status: "Pending", days: "Jun 28" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manager Console</p>
          <p className="mt-1 text-lg font-bold">My team · 14 reports</p>
        </div>
        <span className="rounded-full bg-[#B07B18]/10 px-3 py-1 text-xs font-bold text-[#B07B18]">3 pending</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 mb-4">
        {[
          { label: "Present today", value: "12/14", color: "#1A8050" },
          { label: "On leave", value: "1", color: "#2260A8" },
          { label: "WFH", value: "1", color: "#15B8A6" },
          { label: "Team cost (Jun)", value: "₹18.4L", color: "#1A4D8F" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approval queue</p>
        {approvals.map((a) => (
          <div key={a.emp + a.type} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{a.emp}</p>
              <p className="text-xs text-muted-foreground">{a.type} · {a.days}</p>
            </div>
            <div className="flex gap-1.5">
              <button className="rounded-full bg-[#1A8050]/10 px-2.5 py-1 text-[11px] font-bold text-[#1A8050] hover:bg-[#1A8050]/20 transition-colors">
                Approve
              </button>
              <button className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-border transition-colors">
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileAppMock() {
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">CognixHR Mobile</p>
            <p className="mt-1 text-lg font-bold">Good morning, Raj</p>
          </div>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6]">
            <Smartphone className="h-5 w-5 text-white" />
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-[#1A8050]/30 bg-[#1A8050]/[0.05] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Punch In</p>
              <span className="rounded-full bg-[#1A8050]/10 px-2 py-0.5 text-[11px] font-semibold text-[#1A8050]">GPS verified</span>
            </div>
            <p className="text-xs text-muted-foreground">Location: Bangalore Office · 09:04 AM</p>
            <button className="mt-3 w-full rounded-full bg-[#1A8050] py-2.5 text-sm font-bold text-white">
              Mark Attendance
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border p-3 text-center">
              <p className="text-lg font-bold text-[#2E6FE6]">12</p>
              <p className="text-[11px] text-muted-foreground">Leave days left</p>
            </div>
            <div className="rounded-xl border border-border p-3 text-center">
              <p className="text-lg font-bold text-[#15B8A6]">₹1.42L</p>
              <p className="text-[11px] text-muted-foreground">Last payslip</p>
            </div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="h-4 w-4 text-[#B07B18]" />
              <p className="text-xs font-semibold">1 notification</p>
            </div>
            <p className="text-xs text-muted-foreground">Your leave for Jul 14 has been approved by Riya S.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationsMock() {
  const notifications = [
    {
      type: "WhatsApp",
      message: "Your leave request for Jul 4–5 is approved ✓",
      time: "2 min ago",
      channel: "WA",
      channelColor: "#1A8050",
    },
    {
      type: "Email",
      message: "Jun 2025 payslip is now available for download",
      time: "Jun 28",
      channel: "EM",
      channelColor: "#2E6FE6",
    },
    {
      type: "Escalation",
      message: "Mohit's regularisation pending 48h — escalated to Riya",
      time: "Jun 27",
      channel: "ES",
      channelColor: "#C93535",
    },
    {
      type: "Reminder",
      message: "Investment declaration due in 3 days — submit via ESS",
      time: "Jun 26",
      channel: "RM",
      channelColor: "#B07B18",
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notification Centre</p>
          <p className="mt-1 text-lg font-bold">Zero chasing, full audit trail</p>
        </div>
        <span className="chip">4 channels</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {notifications.map((n) => (
          <div key={n.message} className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white"
              style={{ background: n.channelColor }}
            >
              {n.channel}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-muted-foreground">{n.type}</p>
              <p className="text-sm text-foreground">{n.message}</p>
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground">{n.time}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#1A4D8F]/5 to-[#15B8A6]/5 p-3">
        <p className="text-xs font-semibold text-[#1A4D8F]">HR ticket volume down 68% since ESS launch</p>
        <p className="text-xs text-muted-foreground">94% of employees resolve queries without HR intervention</p>
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
              <Smartphone className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to transform self-service at your company?
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
