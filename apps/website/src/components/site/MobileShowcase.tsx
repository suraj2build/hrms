import type { ReactNode } from "react";
import {
  Bell, Fingerprint, CalendarDays, Wallet, ChevronRight, MapPin, Camera,
  Home, Clock3, FileText, User, Plus, ArrowLeft, TrendingUp,
} from "lucide-react";

/**
 * Three-phone fanned glossy showcase of the CognixHR employee app:
 * Home · Attendance · Payslip. Brand-themed soft UI. The centre phone is
 * elevated; the side phones are angled and slightly smaller. On small screens
 * only the centre (Attendance) phone shows.
 */
export function MobileShowcase() {
  return (
    <div className="relative flex items-center justify-center">
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 mx-auto h-[80%] w-[80%] rounded-full bg-gradient-to-br from-[#2E6FE6]/20 via-[#5C9AFF]/10 to-[#15B8A6]/15 blur-3xl" />

      {/* Left phone — Home */}
      <div className="hidden -mr-10 translate-y-6 scale-90 lg:block" style={{ transform: "rotate(-7deg) translateY(1.5rem) scale(0.9)" }}>
        <PhoneFrame><HomeScreen /></PhoneFrame>
      </div>

      {/* Centre phone — Attendance (elevated) */}
      <div className="relative z-10 animate-float-slow">
        <PhoneFrame><AttendanceScreen /></PhoneFrame>
      </div>

      {/* Right phone — Payslip */}
      <div className="hidden -ml-10 translate-y-6 scale-90 lg:block" style={{ transform: "rotate(7deg) translateY(1.5rem) scale(0.9)" }}>
        <PhoneFrame><PayslipScreen /></PhoneFrame>
      </div>
    </div>
  );
}

/* ---------------- Phone frame ---------------- */
function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative w-[270px] overflow-hidden rounded-[2.5rem] border-[6px] border-white bg-[#EEF3FF] shadow-elevated"
      style={{ aspectRatio: "9 / 19" }}
    >
      {children}
    </div>
  );
}

const glossyTile = (from: string, to: string) => ({
  background: `linear-gradient(145deg, ${from}, ${to})`,
  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), 0 8px 16px -6px ${from}80`,
});

/* ---------------- HOME ---------------- */
function HomeScreen() {
  const quick = [
    { label: "Attendance", icon: Fingerprint, from: "#2E6FE6", to: "#5C9AFF" },
    { label: "Leave",      icon: CalendarDays, from: "#15B8A6", to: "#2DD4BF" },
    { label: "Payslip",    icon: Wallet,       from: "#7C3AED", to: "#A78BFA" },
  ];
  return (
    <>
      <div className="relative px-4 pb-16 pt-8 text-white" style={{ background: "linear-gradient(160deg,#5C9AFF,#2E6FE6 55%,#1A4D8F)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(120% 80% at 80% -10%, rgba(255,255,255,0.45), transparent 60%)" }} />
        <div className="relative flex items-center justify-between">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/20 backdrop-blur text-[10px] font-bold">FI</span>
          <Bell className="h-4 w-4 text-white/90" />
        </div>
        <p className="relative mt-4 text-xs text-white/80">Good morning,</p>
        <p className="relative text-xl font-extrabold">Hey, Ferdous! 👋</p>
      </div>
      <div className="relative -mt-12 px-4">
        <div className="grid grid-cols-3 gap-2.5">
          {quick.map((q) => (
            <div key={q.label} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-2.5 shadow-card">
              <span className="grid h-10 w-10 place-items-center rounded-2xl text-white" style={glossyTile(q.from, q.to)}>
                <q.icon className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-semibold text-foreground/80">{q.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between rounded-2xl bg-white p-3 shadow-card">
          <div>
            <p className="text-[10px] text-muted-foreground">Today · In Time</p>
            <p className="text-lg font-extrabold text-[#0F172A]">08:30:01</p>
          </div>
          <span className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white" style={glossyTile("#2E6FE6", "#15B8A6")}>Punch out</span>
        </div>
        <p className="mt-3 text-[11px] font-bold text-[#0F172A]">Pending Approval</p>
        <div className="mt-1.5 space-y-1.5">
          <MiniRow tint="#1A8050" count="04" label="Leave requests" />
          <MiniRow tint="#B07B18" count="01" label="Regularisation" />
        </div>
      </div>
      <BottomNav active="Home" />
    </>
  );
}

/* ---------------- ATTENDANCE ---------------- */
function AttendanceScreen() {
  return (
    <>
      <div className="relative px-4 pb-6 pt-8 text-white" style={{ background: "linear-gradient(160deg,#5C9AFF,#2E6FE6 55%,#1A4D8F)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(120% 80% at 80% -10%, rgba(255,255,255,0.45), transparent 60%)" }} />
        <div className="relative flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/20 backdrop-blur"><ArrowLeft className="h-3.5 w-3.5" /></span>
          <span className="text-sm font-semibold">Attendance</span>
        </div>
      </div>

      {/* Map + geo punch */}
      <div className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-2xl shadow-card" style={{ height: 96, background: "linear-gradient(135deg,#DCE8FF,#EAF2FF)" }}>
          {/* fake map grid */}
          <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "linear-gradient(#9DBDF5 1px,transparent 1px),linear-gradient(90deg,#9DBDF5 1px,transparent 1px)", backgroundSize: "22px 22px" }} />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="grid h-9 w-9 place-items-center rounded-full text-white" style={glossyTile("#2E6FE6", "#15B8A6")}><MapPin className="h-4 w-4" /></span>
          </span>
          <span className="absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-semibold text-[#1A4D8F]">Office · Koramangala</span>
        </div>

        {/* Big clock */}
        <div className="mt-3 rounded-2xl bg-white p-4 text-center shadow-card">
          <p className="text-[11px] text-muted-foreground">Today · In Time</p>
          <p className="text-3xl font-extrabold tracking-tight text-[#0F172A]">08:30:01</p>
          <p className="mt-0.5 text-[10px] font-semibold text-[#1A8050]">On time ✓ · General shift 9–6</p>
          <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white" style={glossyTile("#2E6FE6", "#15B8A6")}>
            <Camera className="h-4 w-4" /> Selfie punch
          </button>
        </div>

        {/* Recent punches */}
        <p className="mt-3 text-[11px] font-bold text-[#0F172A]">Recent</p>
        <div className="mt-1.5 space-y-1.5">
          {[
            { d: "Mon 23", in: "08:28", out: "18:12" },
            { d: "Fri 20", in: "08:41", out: "18:30" },
          ].map((r) => (
            <div key={r.d} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-soft">
              <span className="text-[11px] font-semibold text-foreground/80">{r.d}</span>
              <span className="text-[10px] text-muted-foreground">{r.in} → {r.out}</span>
            </div>
          ))}
        </div>
      </div>
      <BottomNav active="Attendance" />
    </>
  );
}

/* ---------------- PAYSLIP ---------------- */
function PayslipScreen() {
  const rows = [
    { l: "Basic", v: "₹42,000" },
    { l: "HRA", v: "₹16,800" },
    { l: "Allowances", v: "₹12,400" },
    { l: "Deductions (PF/PT/TDS)", v: "−₹9,200" },
  ];
  return (
    <>
      <div className="relative px-4 pb-6 pt-8 text-white" style={{ background: "linear-gradient(160deg,#A78BFA,#7C3AED 55%,#5B21B6)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: "radial-gradient(120% 80% at 80% -10%, rgba(255,255,255,0.45), transparent 60%)" }} />
        <div className="relative flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/20 backdrop-blur"><ArrowLeft className="h-3.5 w-3.5" /></span>
          <span className="text-sm font-semibold">April Payslip</span>
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Net pay hero */}
        <div className="rounded-2xl bg-white p-4 text-center shadow-card">
          <p className="text-[11px] text-muted-foreground">Net pay · Apr 2026</p>
          <p className="text-3xl font-extrabold tracking-tight text-[#0F172A]">₹62,000</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-[#1A8050]">
            <TrendingUp className="h-3 w-3" /> Credited · 30 Apr
          </p>
        </div>

        {/* Breakdown */}
        <div className="mt-3 rounded-2xl bg-white p-3 shadow-card">
          {rows.map((r, i) => (
            <div key={r.l} className={`flex items-center justify-between py-2 text-[11px] ${i < rows.length - 1 ? "border-b border-border" : ""}`}>
              <span className="text-foreground/70">{r.l}</span>
              <span className="font-semibold text-foreground">{r.v}</span>
            </div>
          ))}
        </div>

        <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white" style={glossyTile("#7C3AED", "#A78BFA")}>
          <FileText className="h-4 w-4" /> Download PDF
        </button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Form 16 & YTD available in Tax Planner</p>
      </div>
      <BottomNav active="Payslip" />
    </>
  );
}

/* ---------------- shared bits ---------------- */
function MiniRow({ tint, count, label }: { tint: string; count: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white p-2 shadow-soft">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white" style={glossyTile(tint, `${tint}cc`)}>{count}</span>
      <span className="flex-1 text-[11px] font-semibold text-foreground/80">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

function BottomNav({ active }: { active: string }) {
  const tabs = [
    { icon: Home, label: "Home" },
    { icon: Clock3, label: "Attendance" },
    { icon: FileText, label: "Payslip" },
    { icon: User, label: "Profile" },
  ];
  return (
    <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white bg-white/95 backdrop-blur">
      <div className="relative flex items-end justify-between px-5 pb-3.5 pt-2.5">
        <NavTab {...tabs[0]} active={active === tabs[0].label} />
        <NavTab {...tabs[1]} active={active === tabs[1].label} />
        <div className="w-10" />
        <NavTab {...tabs[2]} active={active === tabs[2].label} />
        <NavTab {...tabs[3]} active={active === tabs[3].label} />
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
          <span className="grid h-11 w-11 place-items-center rounded-2xl text-white" style={glossyTile("#2E6FE6", "#15B8A6")}><Plus className="h-5 w-5" /></span>
        </span>
      </div>
    </div>
  );
}

function NavTab({ icon: Icon, label, active }: { icon: typeof Home; label: string; active: boolean }) {
  return (
    <span className={`flex flex-col items-center gap-0.5 ${active ? "text-[#2E6FE6]" : "text-muted-foreground"}`}>
      <Icon className="h-4 w-4" />
      <span className="text-[8px] font-medium">{label}</span>
    </span>
  );
}
