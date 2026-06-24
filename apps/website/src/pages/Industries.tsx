import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Code2,
  Factory,
  ShoppingBag,
  HeartPulse,
  Landmark,
  Rocket,
  Check,
  Building2,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function IndustriesPage() {
  return (
    <SiteShell>
      <IndustriesHero />
      <IndustryGrid />
      <CompanySize />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function IndustriesHero() {
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
              Industries
            </span>
          </div>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Built for how your industry <span className="text-[#2DD4BF]">actually works</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-white/80 sm:text-lg">
            From IT services to manufacturing shop floors — CognixHR adapts to your workforce model,
            shift patterns and compliance needs.
          </p>
          <div className="mt-7">
            <DemoButtons source="industries-hero" inverse />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- INDUSTRY GRID ---------------- */
function IndustryGrid() {
  const industries = [
    {
      icon: Code2,
      name: "IT & Services",
      positioning: "Knowledge workforce, fast hiring, global teams.",
      bullets: ["Bench & project allocation visibility", "Fast requisition-to-offer ATS", "WFH & hybrid attendance"],
      color: "#2E6FE6",
      bg: "rgba(46,111,230,0.12)",
    },
    {
      icon: Factory,
      name: "Manufacturing",
      positioning: "Shop-floor shifts, statutory-heavy, multi-location.",
      bullets: ["Rotating shifts & rosters", "Biometric & GPS attendance", "Factory-grade statutory compliance"],
      color: "#B07B18",
      bg: "rgba(176,123,24,0.12)",
    },
    {
      icon: ShoppingBag,
      name: "Retail & QSR",
      positioning: "High-volume, distributed, high-attrition.",
      bullets: ["Multi-outlet attendance", "High-volume onboarding", "Attrition & headcount analytics"],
      color: "#7C3AED",
      bg: "rgba(124,58,237,0.12)",
    },
    {
      icon: HeartPulse,
      name: "Healthcare",
      positioning: "24x7 rosters, credential tracking, compliance.",
      bullets: ["24x7 shift rotation", "Certification & license expiry tracking", "Overtime & holiday rules"],
      color: "#C93535",
      bg: "rgba(201,53,53,0.12)",
    },
    {
      icon: Landmark,
      name: "BFSI",
      positioning: "Compliance-critical, audit-heavy, BGV-first.",
      bullets: ["Background verification workflows", "Audit-logged everything", "Role-based access controls"],
      color: "#1A8050",
      bg: "rgba(26,128,80,0.12)",
    },
    {
      icon: Rocket,
      name: "Startups & SMEs",
      positioning: "Lean teams, fast scaling, budget-conscious.",
      bullets: ["Go-live in 2–4 weeks", "Pay only for modules you need", "ESS cuts HR ticket load"],
      color: "#15B8A6",
      bg: "rgba(21,184,166,0.12)",
    },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Industries</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            One platform, tuned to your workforce
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Every industry runs people differently. CognixHR flexes to match — not the other way around.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((ind, i) => (
            <Reveal key={ind.name} delay={i * 70}>
              <div className="group h-full rounded-2xl border border-border bg-card p-6 shadow-card hover-lift">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-110"
                  style={{ background: ind.bg, color: ind.color, boxShadow: `0 0 16px -4px ${ind.color}40` }}
                >
                  <ind.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{ind.name}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{ind.positioning}</p>
                <ul className="mt-4 space-y-2.5 border-t border-border pt-4">
                  {ind.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#15B8A6]/15 text-[#15B8A6]">
                        <Check className="h-3 w-3" />
                      </span>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- COMPANY SIZE ---------------- */
function CompanySize() {
  const sizes = [
    {
      name: "Growing (10–100)",
      desc: "Get out of spreadsheets fast. Core HR, attendance and payroll live in weeks, priced for lean teams.",
    },
    {
      name: "Mid-market (100–500)",
      desc: "Add recruitment, analytics and ESS as you scale. Manager self-service keeps HR headcount flat.",
    },
    {
      name: "Enterprise (500+)",
      desc: "Multi-entity, multi-location, audit-grade. White-label branding, role-based access and custom workflows.",
    },
  ];
  return (
    <section className="bg-card/40 py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">By company size</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Right-sized for every stage
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {sizes.map((s, i) => (
            <Reveal key={s.name} delay={i * 90}>
              <div className="h-full rounded-2xl border border-border bg-card p-7 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#2E6FE6] to-[#15B8A6] text-white shadow-soft">
                  <Building2 className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-bold">{s.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- BOTTOM CTA ---------------- */
function BottomCTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border hero-gradient p-10 text-center text-white shadow-elevated sm:p-16">
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-[#2DD4BF]/30 blur-3xl animate-blob" />
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#2E6FE6]/40 blur-3xl animate-blob" style={{ animationDelay: "2s" }} />
            <div className="relative">
              <Building2 className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Not sure which fits your business?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">
                Book a 30-minute walkthrough and we'll map CognixHR to your workforce model.
              </p>
              <div className="mt-7 flex justify-center">
                <DemoButtons source="industries-cta" inverse align="center" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
