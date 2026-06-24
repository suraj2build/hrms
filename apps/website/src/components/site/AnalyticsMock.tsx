import { useEffect, useRef, useState } from "react";
import { CountUp } from "./CountUp";

function useInViewOnce<T extends Element>(threshold = 0.3) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setSeen(true);
            obs.disconnect();
          }
        });
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [seen, threshold]);
  return { ref, seen };
}

export function AnalyticsMock() {
  const { ref, seen } = useInViewOnce<HTMLDivElement>(0.25);

  const bars = [
    { x: 10, h: 60, c: "#1A4D8F", l: "Eng" },
    { x: 60, h: 90, c: "#1A8050", l: "Sales" },
    { x: 110, h: 45, c: "#B07B18", l: "Ops" },
    { x: 160, h: 30, c: "#C93535", l: "HR" },
    { x: 210, h: 75, c: "#2260A8", l: "CS" },
    { x: 260, h: 50, c: "#2E6FE6", l: "Fin" },
  ];

  const funnel = [
    { l: "Applied", v: "1,240", w: 100, c: "#1A4D8F" },
    { l: "Screened", v: "640", w: 78, c: "#2260A8" },
    { l: "Interviewed", v: "280", w: 56, c: "#2E6FE6" },
    { l: "Offered", v: "92", w: 32, c: "#15B8A6" },
    { l: "Hired", v: "68", w: 22, c: "#1A8050" },
  ];

  return (
    <div ref={ref} className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Executive intelligence</p>
          <h3 className="mt-1 text-xl font-bold tracking-tight">Org Health · Live</h3>
        </div>
        <div className="flex gap-2">
          {["Today", "Week", "Month", "Quarter"].map((t, i) => (
            <span key={t} className={`rounded-full px-3 py-1 text-xs font-medium ${i === 2 ? "bg-[#1A4D8F] text-white" : "bg-muted text-muted-foreground"}`}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Org Health Score</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: "#1A8050" }}>
            <CountUp value={84} />
          </p>
          <p className="text-xs text-muted-foreground">+4 vs last month</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Hire Accuracy</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: "#1A4D8F" }}>
            <CountUp value={92} suffix="%" />
          </p>
          <p className="text-xs text-muted-foreground">Panel calibrated</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Payroll Variance</p>
          <p className="mt-2 text-3xl font-bold" style={{ color: "#2260A8" }}>
            <CountUp value={0.6} decimals={1} suffix="%" />
          </p>
          <p className="text-xs text-muted-foreground">Within tolerance</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Attrition by department</p>
            <span className="chip">Last 90 days</span>
          </div>
          <svg viewBox="0 0 320 140" className="mt-4 h-36 w-full">
            {bars.map((b, i) => (
              <g key={b.l}>
                <rect
                  x={b.x}
                  y={120 - b.h}
                  width="34"
                  height={b.h}
                  rx="6"
                  fill={b.c}
                  opacity="0.9"
                  style={{
                    transformOrigin: `${b.x + 17}px 120px`,
                    transform: seen ? "scaleY(1)" : "scaleY(0)",
                    transition: `transform 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.08}s`,
                  }}
                />
                <text x={b.x + 17} y="135" textAnchor="middle" fontSize="9" fill="#637080">{b.l}</text>
              </g>
            ))}
          </svg>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-semibold">Recruitment funnel</p>
          <div className="mt-3 space-y-2">
            {funnel.map((s, i) => (
              <div key={s.l} className="flex items-center gap-3">
                <div className="w-24 text-xs font-medium text-foreground/80">{s.l}</div>
                <div className="h-7 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    className="flex h-full items-center justify-end pr-2 text-[11px] font-semibold text-white"
                    style={{
                      width: seen ? `${s.w}%` : "0%",
                      background: s.c,
                      transition: `width 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.1}s`,
                    }}
                  >
                    {s.v}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
