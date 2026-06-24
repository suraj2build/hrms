import { ArrowUpRight, Users, IndianRupee, Clock, TrendingUp } from "lucide-react";
import { CountUp } from "./CountUp";

export function DashboardMock() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-white/10 to-white/0 blur-2xl" />
      <div className="rounded-2xl border border-white/15 bg-white/95 p-4 shadow-elevated backdrop-blur-sm sm:p-5">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-[#C93535]/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#B07B18]/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-[#1A8050]/70" />
            <span className="ml-3 text-[11px] font-medium text-muted-foreground">cognixhr.app / dashboard</span>
          </div>
          <span className="hidden text-[11px] font-medium text-muted-foreground sm:inline">FY 2025–26 · April</span>
        </div>

        {/* KPI cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Headcount", node: <CountUp value={1284} />, delta: "+3.2%", icon: Users, color: "#1A4D8F" },
            { label: "Payroll (Apr)", node: <CountUp value={6.4} decimals={1} prefix="₹" suffix=" Cr" />, delta: "+1.1%", icon: IndianRupee, color: "#1A8050" },
            { label: "Attendance", node: <CountUp value={96.4} decimals={1} suffix="%" />, delta: "+0.8%", icon: Clock, color: "#2260A8" },
            { label: "Attrition", node: <CountUp value={11.2} decimals={1} suffix="%" />, delta: "-1.4%", icon: TrendingUp, color: "#B07B18" },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</span>
                <k.icon className="h-3.5 w-3.5" style={{ color: k.color }} />
              </div>
              <p className="mt-1 text-lg font-bold text-foreground">{k.node}</p>
              <p className="text-[11px] font-medium text-[#1A8050]">{k.delta}</p>
            </div>
          ))}
        </div>

        {/* Chart row */}
        <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Workforce trend</p>
              <span className="chip">Last 6 months</span>
            </div>
            <svg viewBox="0 0 320 110" className="mt-3 h-28 w-full">
              <defs>
                <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#2E6FE6" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#2E6FE6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,80 C40,70 60,40 100,45 C140,50 160,20 200,25 C240,30 270,60 320,40 L320,110 L0,110 Z" fill="url(#g1)" />
              <path d="M0,80 C40,70 60,40 100,45 C140,50 160,20 200,25 C240,30 270,60 320,40" stroke="#2E6FE6" strokeWidth="2.5" fill="none" />
              <path d="M0,95 C40,90 80,82 120,85 C160,88 200,72 240,70 C270,68 300,75 320,72" stroke="#15B8A6" strokeWidth="2" fill="none" strokeDasharray="3 3" />
            </svg>
            <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#2E6FE6]" />Headcount</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#15B8A6]" />Active</span>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Payroll readiness</p>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-3 space-y-2.5">
              {[
                { l: "Attendance locked", v: 100, c: "#1A8050" },
                { l: "Variable pay", v: 88, c: "#2260A8" },
                { l: "Statutory ECR", v: 72, c: "#B07B18" },
                { l: "Reimbursements", v: 54, c: "#2E6FE6" },
              ].map((r) => (
                <div key={r.l}>
                  <div className="flex justify-between text-[11px] font-medium">
                    <span className="text-foreground/80">{r.l}</span>
                    <span className="text-muted-foreground">{r.v}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${r.v}%`, background: r.c }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating cards */}
      <div className="absolute -left-4 bottom-6 hidden rounded-xl border border-border bg-card p-3 shadow-card lg:block animate-float">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI flagged</p>
        <p className="mt-1 text-sm font-semibold">12 anomalies in payroll</p>
        <p className="text-xs text-muted-foreground">Resolved automatically</p>
      </div>
      <div className="absolute -right-3 top-12 hidden rounded-xl border border-border bg-card p-3 shadow-card lg:block animate-float" style={{ animationDelay: "1.2s" }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#15B8A6]">India compliance</p>
        <p className="mt-1 text-sm font-semibold">ECR 2.0 ready</p>
        <p className="text-xs text-muted-foreground">PF · ESI · PT · TDS</p>
      </div>
    </div>
  );
}
