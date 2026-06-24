import { Bell, AlertTriangle, Home, CalendarClock, CalendarDays, Menu, Plus } from "lucide-react";

/**
 * Realistic single-phone Employee Self-Service mock, modelled on a modern HR
 * mobile app: blue gradient header with greeting, a large "In-Time" punch card,
 * pending approvals, a people directory row and a bottom tab navigation bar
 * (Home · Attendance · + · Leave · Menu).
 */
export function MobileESSMock() {
  const directory = [
    { name: "Phillip", tint: "#2E6FE6" },
    { name: "Brandon", tint: "#1A8050" },
    { name: "Julia", tint: "#B07B18" },
    { name: "Dianne", tint: "#7C3AED" },
    { name: "Cameron", tint: "#15B8A6" },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      {/* soft glow behind the device */}
      <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-[#2E6FE6]/25 to-[#15B8A6]/10 blur-3xl" />

      {/* Phone shell */}
      <div
        className="relative overflow-hidden rounded-[2.75rem] border-[5px] border-[#0F172A] bg-white shadow-elevated"
        style={{ aspectRatio: "9 / 19" }}
      >
        {/* notch */}
        <div className="absolute left-1/2 top-0 z-20 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-[#0F172A]" />

        {/* ── Header ── */}
        <div className="relative bg-gradient-to-br from-[#2E6FE6] to-[#1A4D8F] px-5 pb-16 pt-9 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-bold">FI</span>
              <span className="text-sm font-semibold">Home</span>
            </div>
            <span className="relative">
              <Bell className="h-5 w-5 text-white/90" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#F5A623]" />
            </span>
          </div>
          <p className="mt-4 text-xs text-white/70">Good Morning</p>
          <p className="text-xl font-extrabold leading-tight">Ferdous Islam</p>
        </div>

        {/* ── In-Time card (overlaps header) ── */}
        <div className="relative -mt-12 px-5">
          <div className="rounded-2xl bg-white p-4 text-center shadow-card">
            <p className="text-xs font-medium text-muted-foreground">Today's In Time</p>
            <p className="mt-0.5 text-3xl font-extrabold tracking-tight text-[#0F172A]">08:30:01</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">General shift · 09:00 AM – 06:00 PM</p>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-5 pt-4">
          <p className="text-sm font-bold text-[#0F172A]">Pending Approval</p>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-white p-2.5 shadow-soft">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1A8050] text-sm font-bold text-white">04</span>
              <span className="text-[11px] font-semibold leading-tight text-foreground">Leave<br />Request</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-white p-2.5 shadow-soft">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#B07B18] text-sm font-bold text-white">01</span>
              <span className="text-[11px] font-semibold leading-tight text-foreground">Attendance<br />Request</span>
            </div>
          </div>

          {/* Absent warning */}
          <div className="mt-2.5 flex items-start gap-2 rounded-xl border border-[#B07B18]/25 bg-[#B07B18]/[0.06] p-2.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B07B18]" />
            <p className="text-[11px] leading-snug text-foreground/80">
              You were absent for 2 days.{" "}
              <span className="font-semibold text-[#2E6FE6]">See absent days</span>
            </p>
          </div>

          {/* Directory */}
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm font-bold text-[#0F172A]">Directory</p>
            <span className="text-[11px] font-semibold text-[#2E6FE6]">See All ↗</span>
          </div>
          <div className="mt-2 flex justify-between">
            {directory.map((p) => (
              <div key={p.name} className="flex flex-col items-center gap-1">
                <span
                  className="grid h-9 w-9 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${p.tint}, ${p.tint}cc)` }}
                >
                  {p.name[0]}
                </span>
                <span className="text-[9px] text-muted-foreground">{p.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom tab navigation ── */}
        <div className="absolute inset-x-0 bottom-0 border-t border-border bg-white/95 backdrop-blur">
          <div className="relative flex items-end justify-between px-6 pb-4 pt-2.5">
            <TabItem icon={Home} label="Home" active />
            <TabItem icon={CalendarClock} label="Attendance" />
            <div className="w-12" /> {/* FAB spacer */}
            <TabItem icon={CalendarDays} label="Leave" />
            <TabItem icon={Menu} label="Menu" />

            {/* Floating action button */}
            <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#2E6FE6] to-[#15B8A6] text-white shadow-glow">
                <Plus className="h-6 w-6" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabItem({ icon: Icon, label, active = false }: { icon: typeof Home; label: string; active?: boolean }) {
  return (
    <span className={`flex flex-col items-center gap-0.5 ${active ? "text-[#2E6FE6]" : "text-muted-foreground"}`}>
      <Icon className="h-4 w-4" />
      <span className="text-[8px] font-medium">{label}</span>
    </span>
  );
}
