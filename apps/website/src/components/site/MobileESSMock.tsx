import { Calendar, Clock, IndianRupee, MapPin, ChevronRight } from "lucide-react";

export function MobileESSMock() {
  return (
    <div className="relative mx-auto h-[480px] w-full max-w-[440px] select-none overflow-hidden rounded-3xl p-5"
      style={{ background: "linear-gradient(145deg, #E8EAFF 0%, #EEF0FF 50%, #DDE4F8 100%)" }}
    >
      {/* Background blobs */}
      <div className="pointer-events-none absolute -left-10 -top-10 h-48 w-48 rounded-full bg-[#C7D0FF]/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-[#B8C8FF]/40 blur-3xl" />

      {/* ── Left phone (dark) ── */}
      <div
        className="absolute left-3 top-6 h-[420px] w-[47%] overflow-hidden rounded-[2.5rem]"
        style={{
          background: "linear-gradient(160deg,#1C1740 0%,#0F0E2A 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 24px 60px -12px rgba(15,14,42,0.55), 0 4px 16px -4px rgba(15,14,42,0.35)",
          transform: "rotate(-3deg)",
        }}
      >
        {/* Status bar */}
        <div className="flex items-center justify-between px-4 pt-4 text-[10px] text-white/40">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-3 rounded-sm bg-white/30" />
            <div className="h-1.5 w-2 rounded-sm bg-white/30" />
          </div>
        </div>

        {/* Greeting */}
        <div className="px-4 pt-3">
          <p className="text-[11px] text-white/40">Good morning,</p>
          <p className="text-[15px] font-bold leading-tight text-white">Priya Sharma</p>
        </div>

        {/* Check-in card */}
        <div className="mx-3 mt-3 rounded-2xl p-3.5"
          style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          <div className="flex items-center gap-1 text-[10px] text-white/40">
            <MapPin className="h-2.5 w-2.5" />
            <span>Koramangala, Bengaluru</span>
          </div>
          <p className="mt-1.5 text-2xl font-bold leading-none text-white">09:03 AM</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#2DD4BF]">On Time ✓</p>
          <button
            className="mt-3 w-full rounded-xl py-2 text-[12px] font-bold text-white"
            style={{ background: "linear-gradient(135deg,#2E6FE6,#15B8A6)" }}
          >
            Mark Attendance
          </button>
        </div>

        {/* Stats row */}
        <div className="mx-3 mt-2.5 grid grid-cols-3 gap-1.5">
          {[{ l: "Present", v: "18" }, { l: "Leave", v: "3" }, { l: "WFH", v: "4" }].map((s) => (
            <div key={s.l} className="rounded-xl p-2.5 text-center"
              style={{ background: "rgba(255,255,255,0.07)" }}
            >
              <p className="text-base font-bold text-white">{s.v}</p>
              <p className="text-[9px] text-white/40">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Payslip row */}
        <div className="mx-3 mt-2.5 flex items-center justify-between rounded-xl px-3 py-2.5"
          style={{ background: "rgba(45,212,191,0.10)", border: "1px solid rgba(45,212,191,0.18)" }}
        >
          <div>
            <p className="text-[10px] text-white/40">April Payslip</p>
            <p className="text-[13px] font-bold text-white">₹68,400</p>
          </div>
          <ChevronRight className="h-4 w-4 text-[#2DD4BF]" />
        </div>

        {/* AI nudge */}
        <div className="mx-3 mt-2 rounded-xl px-3 py-2"
          style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.18)" }}
        >
          <p className="text-[10px] font-semibold text-[#A78BFA]">AI: 2 leaves expiring this month</p>
        </div>
      </div>

      {/* ── Right phone (light) ── */}
      <div
        className="absolute right-3 top-10 h-[400px] w-[50%] overflow-hidden rounded-[2.5rem] bg-white/92"
        style={{
          border: "1px solid rgba(46,111,230,0.13)",
          boxShadow: "0 20px 50px -12px rgba(26,77,143,0.22), 0 4px 16px -4px rgba(46,111,230,0.12)",
          transform: "rotate(2.5deg)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Status bar */}
        <div className="flex items-center justify-between px-4 pt-4 text-[10px] text-foreground/35">
          <span>9:41</span>
          <div className="h-2 w-2 rounded-full bg-[#2E6FE6]" />
        </div>

        {/* Header */}
        <div className="px-4 pt-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">Leave Balance</p>
        </div>

        {/* Leave grid */}
        <div className="mx-3 mt-2 grid grid-cols-2 gap-1.5">
          {[
            { l: "Earned", v: "12", color: "#2E6FE6", bg: "rgba(46,111,230,0.08)" },
            { l: "Casual", v: "5", color: "#1A8050", bg: "rgba(26,128,80,0.08)" },
            { l: "Sick", v: "8", color: "#B07B18", bg: "rgba(176,123,24,0.08)" },
            { l: "Comp-off", v: "2", color: "#7C3AED", bg: "rgba(124,58,237,0.08)" },
          ].map((l) => (
            <div key={l.l} className="rounded-xl p-2.5" style={{ background: l.bg }}>
              <p className="text-xl font-extrabold" style={{ color: l.color }}>{l.v}</p>
              <p className="text-[10px] font-medium text-muted-foreground">{l.l}</p>
            </div>
          ))}
        </div>

        {/* Apply leave button */}
        <button
          className="mx-3 mt-2.5 w-[calc(100%-1.5rem)] rounded-xl py-2 text-[12px] font-bold text-white"
          style={{ background: "linear-gradient(135deg,#2E6FE6,#15B8A6)" }}
        >
          + Apply Leave
        </button>

        {/* Recent activity */}
        <div className="mx-3 mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</p>
          <div className="mt-1.5 space-y-1.5">
            {[
              { label: "Apr '26 Payslip", sub: "₹68,400 · Credited", Icon: IndianRupee, color: "#1A8050" },
              { label: "Leave approved", sub: "May 5–6 · Earned", Icon: Calendar, color: "#2E6FE6" },
              { label: "Attendance", sub: "96.4% this month", Icon: Clock, color: "#B07B18" },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2 rounded-lg border border-border/60 bg-white px-2.5 py-1.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
                  style={{ background: `${r.color}15`, color: r.color }}
                >
                  <r.Icon className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold text-foreground">{r.label}</p>
                  <p className="text-[10px] text-muted-foreground">{r.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
