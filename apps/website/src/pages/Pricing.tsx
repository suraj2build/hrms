import { useState } from "react";
import { Check, Minus, Sparkles } from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { Reveal } from "@/components/site/Reveal";
import { CountUp } from "@/components/site/CountUp";
import { Button } from "@/components/ui/button";
import { useDemoModal } from "@/components/site/DemoModal";

type Plan = {
  name: string;
  price: { monthly: number | null; annual: number | null };
  display: string;
  tag: string;
  seats: string;
  featured?: boolean;
  cta: string;
  support: string;
  includes: string[];
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    price: { monthly: 59, annual: 49 },
    display: "₹49",
    tag: "Small teams",
    seats: "min 10 seats",
    cta: "Start free trial",
    support: "Email support",
    includes: [
      "Core HR (employees, org chart, documents)",
      "Employee Self-Service (ESS)",
      "Leave & Attendance",
      "Basic Onboarding & Separation",
      "Basic analytics",
    ],
  },
  {
    name: "Growth",
    price: { monthly: 119, annual: 99 },
    display: "₹99",
    tag: "Growing companies",
    seats: "min 25 seats",
    featured: true,
    cta: "Book a Demo",
    support: "Priority support",
    includes: [
      "Everything in Starter",
      "Shifts & Rosters",
      "Payroll",
      "Statutory Compliance",
      "Manager Console",
      "Standard analytics",
      "Full Onboarding & Separation",
      "Add-ons available: Recruitment/ATS, AI Suite",
    ],
  },
  {
    name: "Enterprise",
    price: { monthly: null, annual: null },
    display: "Custom",
    tag: "Large / multi-entity",
    seats: "100+ seats · ~₹179/emp/mo",
    cta: "Talk to Sales",
    support: "Dedicated CSM + SLA",
    includes: [
      "Everything in Growth",
      "Recruitment / ATS",
      "AI Suite",
      "Advanced & Executive analytics",
      "White-label & API",
      "Multi-entity support",
    ],
  },
];

const FEATURES: { label: string; values: (boolean | string)[] }[] = [
  { label: "Core HR", values: [true, true, true] },
  { label: "Employee Self-Service", values: [true, true, true] },
  { label: "Leave & Attendance", values: [true, true, true] },
  { label: "Onboarding & Separation", values: ["Basic", "Full", "Full"] },
  { label: "Shifts & Rosters", values: [false, true, true] },
  { label: "Payroll", values: [false, true, true] },
  { label: "Statutory Compliance", values: [false, true, true] },
  { label: "Manager Console", values: [false, true, true] },
  { label: "Analytics", values: ["Basic", "Standard", "Advanced"] },
  { label: "Recruitment / ATS", values: [false, "Add-on", true] },
  { label: "AI Suite", values: [false, "Add-on", true] },
  { label: "White-label & API", values: [false, false, true] },
  { label: "Support", values: ["Email", "Priority", "Dedicated CSM + SLA"] },
];

const ADDONS = [
  { name: "Recruitment & ATS", price: "+₹40", desc: "Full applicant tracking with interview analytics" },
  { name: "Payroll & Compliance", price: "+₹45", desc: "India statutory + filing packs" },
  { name: "AI Suite", price: "+₹35", desc: "Document AI, payroll forensics, anomaly detection" },
  { name: "Advanced Analytics", price: "+₹30", desc: "Executive intelligence + custom dashboards" },
  { name: "Shifts / Rosters / WFH", price: "+₹25", desc: "Rotation policies and remote work" },
  { name: "Assets & Benefits", price: "+₹15", desc: "Issue, track, reclaim across the lifecycle" },
];

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const { open } = useDemoModal();

  return (
    <SiteShell>
      {/* Hero */}
      <section className="relative -mt-16 overflow-hidden hero-gradient pt-32 pb-16 text-white sm:pt-40 sm:pb-24">
        <div className="pointer-events-none absolute -top-32 -right-32 h-[24rem] w-[24rem] rounded-full bg-[#2DD4BF]/20 blur-3xl" />
        <div className="container-page relative text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-[#2DD4BF]" /> Pricing
            </span>
            <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
              Simple, per-employee pricing.
              <br />
              <span className="text-gradient-teal">Built to scale with India.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-white/80">
              Start with what you need. Add modules as you grow. Annual billing saves ~17%.
            </p>

            {/* toggle */}
            <div className="mt-8 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur">
              {[
                { k: false, label: "Monthly" },
                { k: true, label: "Annual · save ~17%" },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setAnnual(o.k)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    annual === o.k ? "bg-white text-[#1A4D8F]" : "text-white/80 hover:text-white"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Plans */}
      <section className="-mt-12 pb-16 sm:-mt-16">
        <div className="container-page grid gap-5 lg:grid-cols-3">
          {PLANS.map((p, i) => {
            const price = annual ? p.price.annual : p.price.monthly;
            return (
              <Reveal key={p.name} delay={i * 80}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl p-7 transition-all hover:-translate-y-1 ${
                    p.featured
                      ? "border-2 border-[#2E6FE6] bg-card shadow-elevated lg:-translate-y-4 glow-featured"
                      : "border border-border bg-card shadow-card hover:shadow-elevated"
                  }`}
                >
                  {p.featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#15B8A6] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-soft">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-xl font-bold">{p.name}</h3>
                  <p className="text-xs text-muted-foreground">{p.tag} · {p.seats}</p>
                  <div className="mt-5 flex items-baseline gap-1.5">
                    {price !== null ? (
                      <>
                        <span className="text-4xl font-extrabold tracking-tight">
                          <CountUp value={price} prefix="₹" />
                        </span>
                        <span className="text-sm text-muted-foreground">/emp/mo</span>
                      </>
                    ) : (
                      <span className="text-4xl font-extrabold tracking-tight">{p.display}</span>
                    )}
                  </div>
                  {price !== null && (
                    <p className="text-xs text-muted-foreground">
                      {annual ? "Billed annually" : "Billed monthly"}
                    </p>
                  )}
                  <Button
                    onClick={() => open(`pricing-page-${p.name}`)}
                    className={`mt-6 h-11 w-full rounded-full font-semibold ${
                      p.featured
                        ? "bg-[#2E6FE6] text-white hover:bg-[#2E6FE6]/90"
                        : "bg-foreground text-background hover:bg-foreground/90"
                    }`}
                  >
                    {p.cta}
                  </Button>
                  <p className="mt-3 text-center text-xs text-muted-foreground">{p.support}</p>
                  <ul className="mt-6 space-y-2.5 border-t border-border pt-6">
                    {p.includes.map((inc) => (
                      <li key={inc} className="flex gap-2 text-sm text-foreground/85">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15B8A6]" />
                        <span>{inc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="chip">Compare plans</span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Every feature, side by side</h2>
          </Reveal>
          <Reveal>
            <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Feature</th>
                      {PLANS.map((p) => (
                        <th key={p.name} className="px-5 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {p.name}
                            {p.featured && <span className="rounded-full bg-[#15B8A6]/15 px-2 py-0.5 text-[10px] font-bold text-[#15B8A6]">Popular</span>}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FEATURES.map((f, idx) => (
                      <tr key={f.label} className={idx % 2 === 1 ? "bg-muted/20" : ""}>
                        <td className="px-5 py-3.5 font-medium text-foreground/90">{f.label}</td>
                        {f.values.map((v, i) => (
                          <td key={i} className="px-5 py-3.5 text-foreground/80">
                            {v === true ? (
                              <Check className="h-4 w-4 text-[#1A8050]" />
                            ) : v === false ? (
                              <Minus className="h-4 w-4 text-muted-foreground/60" />
                            ) : (
                              <span className="text-sm font-medium">{v}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Add-ons */}
      <section className="py-16 sm:py-20">
        <div className="container-page">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="chip">Add-on modules</span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Need just one capability? Add any module.</h2>
            <p className="mt-3 text-base text-muted-foreground">
              Add any module to Starter or Growth — pay only for what you use.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADDONS.map((a, i) => (
              <Reveal key={a.name} delay={i * 50}>
                <div className="h-full rounded-2xl border border-border bg-card p-5 shadow-card transition-all hover:-translate-y-1 hover:shadow-elevated">
                  <div className="flex items-center justify-between">
                    <p className="text-base font-semibold">{a.name}</p>
                    <span className="rounded-full bg-[#2E6FE6]/10 px-2.5 py-1 text-sm font-bold text-[#2E6FE6]">{a.price}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{a.desc}</p>
                  <p className="mt-3 text-xs font-medium text-muted-foreground">/emp/mo</p>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
            Prices exclude GST. Annual billing. Volume discounts available for 250+ employees.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24">
        <div className="container-page">
          <Reveal>
            <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-card sm:p-14">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Not sure which plan fits?</h2>
              <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                Tell us about your team — we'll recommend the right plan and modules in 30 minutes.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button
                  onClick={() => open("pricing-final")}
                  className="h-12 rounded-full bg-[#2E6FE6] px-6 text-base font-semibold text-white hover:bg-[#2E6FE6]/90"
                >
                  Book a Demo
                </Button>
                <a
                  href="https://hrms-web-alpha.vercel.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-semibold text-foreground hover:bg-muted"
                >
                  Try the Live Demo →
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </SiteShell>
  );
}
