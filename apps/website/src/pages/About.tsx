import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Flag,
  Brain,
  Database,
  ShieldCheck,
  Settings2,
  Heart,
  Building2,
  Sparkles,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function AboutPage() {
  return (
    <SiteShell>
      <AboutHero />
      <Mission />
      <StatsBand />
      <Values />
      <AboutSaar />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function AboutHero() {
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
              About
            </span>
          </div>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Building the HR platform{" "}
            <span className="text-[#2DD4BF]">India deserves</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-white/80 sm:text-lg">
            CognixHR is Saar's flagship HR platform — engineered for the modern, India-first organisation.
          </p>
          <div className="mt-7">
            <DemoButtons source="about-hero" inverse />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- MISSION ---------------- */
function Mission() {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-3xl text-center">
          <span className="chip">Our mission</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Make great HR effortless
          </h2>
          <p className="mt-5 text-base text-muted-foreground sm:text-lg">
            Most HR teams run on six to eight disconnected tools — one for attendance, another for
            payroll, a spreadsheet for compliance, an inbox for approvals. Data fragments, deadlines
            slip, and people spend their days copying numbers between systems instead of looking after
            people. We think that's backwards.
          </p>
          <p className="mt-4 text-base text-muted-foreground sm:text-lg">
            CognixHR replaces that sprawl with one AI-powered platform built from the ground up for
            Indian compliance — PF, ESI, PT, TDS and LWF handled natively, the full employee lifecycle
            in a single source of truth, and practical AI doing the repetitive work. Less busywork, fewer
            errors, more time for the work that actually matters.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- STATS BAND ---------------- */
function StatsBand() {
  const stats = [
    { value: "6", label: "core modules" },
    { value: "40+", label: "capabilities" },
    { value: "5", label: "statutory compliances (PF · ESI · PT · TDS · LWF)" },
    { value: "2–4 wk", label: "typical go-live" },
  ];
  return (
    <section className="pb-20 sm:pb-28">
      <div className="container-page">
        <div className="grid gap-4 sm:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 70}>
              <div className="h-full rounded-2xl border border-border bg-card p-6 text-center shadow-card">
                <p className="text-3xl font-extrabold tracking-tight text-[#2E6FE6] sm:text-4xl">
                  {s.value}
                </p>
                <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- VALUES ---------------- */
function Values() {
  const values = [
    {
      icon: Flag,
      title: "India-first",
      desc: "Statutory compliance is baked in from day one, not bolted on as an afterthought.",
      color: "#2E6FE6",
      bg: "rgba(46,111,230,0.12)",
    },
    {
      icon: Brain,
      title: "AI that does the work",
      desc: "Practical automation woven through every module — measurable hours saved, every month.",
      color: "#7C3AED",
      bg: "rgba(124,58,237,0.12)",
    },
    {
      icon: Database,
      title: "One source of truth",
      desc: "No fragmented data across tools. Every record lives in one unified, consistent model.",
      color: "#1A8050",
      bg: "rgba(26,128,80,0.12)",
    },
    {
      icon: ShieldCheck,
      title: "Security by default",
      desc: "Multi-tenant isolation, DPDP-aware controls and audit logs on everything.",
      color: "#15B8A6",
      bg: "rgba(21,184,166,0.12)",
    },
    {
      icon: Settings2,
      title: "Configurable, not rigid",
      desc: "Adapt the system to your policies — masters, roles and workflows bend to you.",
      color: "#2260A8",
      bg: "rgba(34,96,168,0.12)",
    },
    {
      icon: Heart,
      title: "Customer obsession",
      desc: "Every feature exists to give your HR team their time back. That's the whole point.",
      color: "#C93535",
      bg: "rgba(201,53,53,0.12)",
    },
  ];
  return (
    <section className="bg-card/40 py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">What we believe</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Principles that guide us
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {values.map((v, i) => (
            <Reveal key={v.title} delay={i * 70}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-elevated gradient-border-hover">
                <div
                  className="grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-110"
                  style={{ background: v.bg, color: v.color, boxShadow: `0 0 16px -4px ${v.color}40` }}
                >
                  <v.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{v.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{v.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- ABOUT SAAR ---------------- */
function AboutSaar() {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-card sm:p-12">
            <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-gradient-to-br from-[#2E6FE6] to-[#15B8A6] opacity-10" />
            <div className="relative max-w-2xl">
              <span className="chip">The company</span>
              <h2 className="mt-4 flex items-center gap-3 text-3xl font-bold tracking-tight sm:text-4xl">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6] text-white shadow-soft">
                  <Building2 className="h-6 w-6" />
                </span>
                Built by Saar
              </h2>
              <p className="mt-5 text-base text-muted-foreground sm:text-lg">
                Saar builds enterprise software for the modern, India-first organisation. CognixHR is
                our flagship HR platform — combining deep statutory expertise with practical AI.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- BOTTOM CTA ---------------- */
function BottomCTA() {
  return (
    <section className="pb-20 sm:pb-28">
      <div className="container-page">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-border hero-gradient p-10 text-center text-white shadow-elevated sm:p-16">
            <div className="pointer-events-none absolute -left-24 -bottom-24 h-64 w-64 rounded-full bg-[#2DD4BF]/30 blur-3xl animate-blob" />
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#2E6FE6]/40 blur-3xl animate-blob" style={{ animationDelay: "2s" }} />
            <div className="relative">
              <Sparkles className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Want to see CognixHR in action?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">
                Book a 30-minute walkthrough or jump straight into the live demo sandbox.
              </p>
              <div className="mt-7 flex justify-center">
                <DemoButtons source="about-cta" inverse align="center" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
