import {
  Bell, Fingerprint, CalendarDays, Wallet, ChevronRight,
  Home, Clock3, FileText, User, Plus,
} from "lucide-react";

/**
 * Glossy, soft-UI Employee Self-Service mock. Single phone, brand-themed:
 * blue gradient header with greeting, three glossy quick-access tiles
 * (Attendance · Leave · Payslip), a "today" status card, a pending-approval
 * row, and a bottom tab bar with a centre FAB.
 */
export function MobileESSMock() {
  const quick = [
    { label: "Attendance", icon: Fingerprint, from: "#2E6FE6", to: "#5C9AFF" },
    { label: "Leave",      icon: CalendarDays, from: "#15B8A6", to: "#2DD4BF" },
    { label: "Payslip",    icon: Wallet,       from: "#7C3AED", to: "#A78BFA" },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      {/* soft ambient glow */}
      <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[3.5rem] bg-gradient-to-br from-[#2E6FE6]/25 via-[#5C9AFF]/15 to-[#15B8A6]/15 blur-3xl" />

      {/* Phone shell */}
      <div
        className="relative overflow-hidden rounded-[2.75rem] border-[6px] border-white bg-[#EEF3FF] shadow-elevated"
        style={{ aspectRatio: "9 / 19" }}
      >
        {/* ── Header (soft blue gradient) ── */}
        <div
          className="relative px-5 pb-20 pt-10 text-white"
          style={{ background: "linear-gradient(160deg, #5C9AFF 0%, #2E6FE6 55%, #1A4D8F 100%)" }}
        >
          {/* glossy header sheen */}
          <div className="pointer-events-none absolute inset-0 opacity-40"
            style={{ background: "radial-gradient(120% 80% at 80% -10%, rgba(255,255,255,0.45), transparent 60%)" }}
          />
          <div className="relative flex items-center justify-between">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 backdrop-blur">
              <span className="grid grid-cols-2 gap-0.5">
                {Array.from({ length: 4 }).map((_, i) => <span key={i} className="h-1 w-1 rounded-full bg-white" />)}
              </span>
            </span>
            <span className="relative">
              <Bell className="h-5 w-5 text-white/90" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#F5A623] ring-2 ring-[#2E6FE6]" />
            </span>
          </div>
          <p className="relative mt-5 text-sm font-medium text-white/80">Good morning,</p>
          <p className="relative text-2xl font-extrabold leading-tight">Hey, Ferdous! 👋</p>
        </div>

        {/* ── Quick-access glossy tiles (overlap header) ── */}
        <div className="relative -mt-14 px-5">
          <div className="grid grid-cols-3 gap-3">
            {quick.map((q) => (
              <div
                key={q.label}
                className="flex flex-col items-center gap-2 rounded-2xl bg-white p-3 shadow-card"
              >
                <span
                  className="grid h-11 w-11 place-items-center rounded-2xl text-white"
                  style={{
                    background: `linear-gradient(145deg, ${q.from}, ${q.to})`,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.55), 0 8px 16px -6px ${q.from}80`,
                  }}
                >
                  <q.icon className="h-5 w-5" />
                </span>
                <span className="text-[10px] font-semibold text-foreground/80">{q.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Today card ── */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between rounded-2xl bg-white p-3.5 shadow-card">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Today · In Time</p>
              <p className="text-xl font-extrabold tracking-tight text-[#0F172A]">08:30:01</p>
              <p className="text-[10px] text-muted-foreground">General shift · 9–6</p>
            </div>
            <button
              className="rounded-xl px-3.5 py-2 text-[11px] font-bold text-white"
              style={{ background: "linear-gradient(145deg,#2E6FE6,#15B8A6)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 8px 16px -6px rgba(46,111,230,0.5)" }}
            >
              Punch out
            </button>
          </div>

          {/* Pending approval row */}
          <p className="mt-4 text-xs font-bold text-[#0F172A]">Pending Approval</p>
          <div className="mt-2 space-y-2">
            <ApprovalRow tint="#1A8050" count="04" label="Leave requests" />
            <ApprovalRow tint="#B07B18" count="01" label="Regularisation" />
          </div>
        </div>

        {/* ── Bottom tab bar with centre FAB ── */}
        <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white bg-white/95 backdrop-blur">
          <div className="relative flex items-end justify-between px-6 pb-4 pt-3">
            <Tab icon={Home} label="Home" active />
            <Tab icon={Clock3} label="Attendance" />
            <div className="w-12" />
            <Tab icon={FileText} label="Payslip" />
            <Tab icon={User} label="Profile" />
            <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
              <span
                className="grid h-12 w-12 place-items-center rounded-2xl text-white"
                style={{ background: "linear-gradient(145deg,#2E6FE6,#15B8A6)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), 0 10px 22px -6px rgba(46,111,230,0.6)" }}
              >
                <Plus className="h-6 w-6" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalRow({ tint, count, label }: { tint: string; count: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-2.5 shadow-soft">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
        style={{ background: `linear-gradient(145deg, ${tint}, ${tint}cc)`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)" }}
      >
        {count}
      </span>
      <span className="flex-1 text-[12px] font-semibold text-foreground/80">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function Tab({ icon: Icon, label, active = false }: { icon: typeof Home; label: string; active?: boolean }) {
  return (
    <span className={`flex flex-col items-center gap-0.5 ${active ? "text-[#2E6FE6]" : "text-muted-foreground"}`}>
      <Icon className="h-4 w-4" />
      <span className="text-[8px] font-medium">{label}</span>
    </span>
  );
}
