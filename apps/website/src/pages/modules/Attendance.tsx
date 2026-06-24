import { Link } from "react-router-dom";
import {
  Check,
  ArrowLeft,
  ClipboardX,
  AlertTriangle,
  Calendar,
  Clock,
  Users,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function AttendancePage() {
  return (
    <SiteShell>
      <AttendanceHero />
      <PainPoints />
      <FeatureDeepDive />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function AttendanceHero() {
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
              Attendance
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Real-time attendance.
            <br />
            <span className="text-[#2DD4BF]">Zero manual work.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
            Punches, shifts, leave, overtime and anomalies — all automated, all auditable.
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
      icon: ClipboardX,
      title: "Manual muster sheets",
      desc: "Spreadsheets and paper registers miss punches, can't handle shifts, and create compliance risk.",
      color: "#C93535",
    },
    {
      icon: AlertTriangle,
      title: "Anomalies found too late",
      desc: "Missed punches, pattern abuse and roster mismatches surface weeks after the fact.",
      color: "#B07B18",
    },
    {
      icon: Calendar,
      title: "Shift complexity is unmanageable",
      desc: "Multi-location, rotating shifts and weekly-off credits are too complex for manual tools.",
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
            Manual attendance management is a liability — for compliance, for payroll accuracy, and for HR's sanity.
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
      title: "Attendance Operations",
      desc: "From the moment an employee punches in to the final muster roll, every action is captured in real time across all input sources — biometric, GPS, and web.",
      bullets: [
        "Live who's-in wall",
        "Multi-source punch capture (biometric, GPS, web)",
        "Auto-generated muster roll",
        "Regularisation workflows",
      ],
      visual: <AttendanceOpsMock />,
    },
    {
      number: "02",
      title: "Anomaly Detection & Forensics",
      desc: "AI continuously monitors punch patterns and flags exceptions before they become payroll errors or compliance issues.",
      bullets: [
        "AI flags missed punches automatically",
        "Pattern abuse detection",
        "Exception queue with one-click resolution",
        "Audit trail for every punch",
      ],
      visual: <AnomalyMock />,
    },
    {
      number: "03",
      title: "Shifts, Rosters & Leave",
      desc: "Manage rotating shifts, weekly-off rules and comp-off accrual in one unified roster engine with full collision detection.",
      bullets: [
        "Rotating shift templates",
        "Weekly-off credit rules",
        "Leave types with accrual, comp-off, collision detection",
        "WFH request + approval flow",
      ],
      visual: <ShiftsMock />,
    },
    {
      number: "04",
      title: "Overtime & Compliance",
      desc: "State-wise holiday calendars, OT wage rules and attendance-locked payroll signals keep you compliant across every location.",
      bullets: [
        "State-wise holiday calendars",
        "OT calculation with wage rules",
        "Attendance-locked payroll readiness signal",
        "EPFO-ready hours summary",
      ],
      visual: <OvertimeMock />,
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
function AttendanceOpsMock() {
  const employees = [
    { name: "Priya M.", dept: "Engineering", time: "09:02 AM", status: "In", avatar: "PM" },
    { name: "Rahul S.", dept: "Sales", time: "09:17 AM", status: "In", avatar: "RS" },
    { name: "Anita V.", dept: "HR", time: "09:45 AM", status: "Late", avatar: "AV" },
    { name: "Vikram J.", dept: "Finance", time: "—", status: "Absent", avatar: "VJ" },
    { name: "Deepa R.", dept: "Ops", time: "08:58 AM", status: "In", avatar: "DR" },
  ];
  const statusColors: Record<string, string> = { In: "#1A8050", Late: "#B07B18", Absent: "#C93535" };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-[#C93535]/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#B07B18]/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#1A8050]/70" />
          <span className="ml-3 text-[11px] font-medium text-muted-foreground">cognixhr.app / attendance</span>
        </div>
        <span className="text-[11px] text-muted-foreground">Today · 10:30 AM</span>
      </div>
      <div className="mt-4 flex gap-3">
        {[
          { label: "Present", value: "847", color: "#1A8050" },
          { label: "Late", value: "32", color: "#B07B18" },
          { label: "Absent", value: "28", color: "#C93535" },
        ].map((s) => (
          <div key={s.label} className="flex-1 rounded-xl border border-border p-3 text-center">
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live who's-in wall</p>
        {employees.map((e) => (
          <div key={e.name} className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6] text-[11px] font-bold text-white">
              {e.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{e.name}</p>
              <p className="text-xs text-muted-foreground">{e.dept}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium" style={{ color: statusColors[e.status] }}>{e.status}</p>
              <p className="text-[11px] text-muted-foreground">{e.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnomalyMock() {
  const anomalies = [
    { emp: "Mohit K.", type: "Missed punch-out", day: "Mon, Jun 16", severity: "High", icon: "!" },
    { emp: "Sara P.", type: "Pattern: 3 late in a row", day: "Tue–Thu", severity: "Medium", icon: "~" },
    { emp: "Arun T.", type: "Punch from outside geofence", day: "Wed, Jun 18", severity: "High", icon: "!" },
    { emp: "Neha G.", type: "Back-to-back OT claims", day: "Mon–Wed", severity: "Medium", icon: "~" },
  ];
  const sevColor: Record<string, string> = { High: "#C93535", Medium: "#B07B18" };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Exception Queue</p>
          <p className="mt-1 text-lg font-bold">Anomaly Forensics</p>
        </div>
        <span className="rounded-full bg-[#C93535]/10 px-3 py-1 text-xs font-bold text-[#C93535]">4 unresolved</span>
      </div>
      <div className="space-y-3">
        {anomalies.map((a) => (
          <div key={a.emp} className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold text-white"
              style={{ background: sevColor[a.severity] }}
            >
              {a.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{a.emp}</p>
              <p className="text-xs text-muted-foreground">{a.type}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{a.day}</p>
            </div>
            <button className="shrink-0 rounded-full border border-[#15B8A6]/40 px-2.5 py-1 text-[11px] font-semibold text-[#15B8A6] hover:bg-[#15B8A6]/10 transition-colors">
              Resolve
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-gradient-to-r from-[#1A4D8F]/5 to-[#15B8A6]/5 p-3">
        <p className="text-xs font-semibold text-[#1A4D8F]">AI auto-resolved 18 exceptions this week</p>
        <p className="text-xs text-muted-foreground">Missed punch-out filled from calendar shift end time</p>
      </div>
    </div>
  );
}

function ShiftsMock() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const roster = [
    { name: "Team A", shifts: ["M1", "M1", "M1", "M1", "M1", "OFF", "OFF"], color: "#2E6FE6" },
    { name: "Team B", shifts: ["G2", "G2", "G2", "OFF", "G2", "G2", "OFF"], color: "#15B8A6" },
    { name: "Team C", shifts: ["OFF", "N3", "N3", "N3", "N3", "N3", "OFF"], color: "#B07B18" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Shift Roster</p>
          <p className="mt-1 text-lg font-bold">Week of Jun 16–22</p>
        </div>
        <span className="chip">3 active shifts</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="pb-2 text-left text-[11px] font-semibold text-muted-foreground w-16">Team</th>
              {days.map((d) => (
                <th key={d} className="pb-2 text-center text-[11px] font-semibold text-muted-foreground">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody className="space-y-1">
            {roster.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="py-2 text-xs font-semibold">{r.name}</td>
                {r.shifts.map((s, i) => (
                  <td key={i} className="py-2 text-center">
                    <span
                      className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                      style={{
                        background: s === "OFF" ? "#E3E9F0" : r.color,
                        color: s === "OFF" ? "#637080" : "#ffffff",
                      }}
                    >
                      {s}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { label: "M1 Morning", time: "06:00–14:00" },
          { label: "G2 General", time: "09:00–18:00" },
          { label: "N3 Night", time: "22:00–06:00" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border p-2 text-center">
            <p className="text-[11px] font-semibold">{s.label}</p>
            <p className="text-[10px] text-muted-foreground">{s.time}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OvertimeMock() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compliance Dashboard</p>
          <p className="mt-1 text-lg font-bold">OT & Statutory Summary</p>
        </div>
        <span className="text-[11px] text-muted-foreground">Jun 2025</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { label: "OT Hours", value: "1,248", note: "Approved this month", color: "#2260A8" },
          { label: "OT Cost", value: "₹3.2L", note: "Within budget", color: "#1A8050" },
          { label: "Holiday Compliance", value: "100%", note: "All states covered", color: "#15B8A6" },
          { label: "EPFO Hours", value: "Ready", note: "ECR 2.0 format", color: "#1A4D8F" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-lg font-bold" style={{ color: k.color }}>{k.value}</p>
            <p className="text-[11px] text-muted-foreground">{k.note}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border p-3">
        <p className="text-xs font-semibold mb-2">State holiday calendars active</p>
        <div className="flex flex-wrap gap-1.5">
          {["Maharashtra", "Karnataka", "Tamil Nadu", "Delhi NCR", "Telangana", "Gujarat"].map((s) => (
            <span key={s} className="rounded-full bg-[#2E6FE6]/10 border border-[#2E6FE6]/20 px-2.5 py-1 text-[11px] font-medium text-[#2E6FE6]">
              {s}
            </span>
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
              <Clock className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Ready to transform attendance at your company?
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
