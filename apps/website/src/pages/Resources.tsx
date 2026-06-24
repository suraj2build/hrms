import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  ShieldCheck,
  FileText,
  PlayCircle,
  Video,
  LifeBuoy,
  HelpCircle,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { DemoButtons } from "@/components/site/DemoButtons";
import { Reveal } from "@/components/site/Reveal";

export default function ResourcesPage() {
  return (
    <SiteShell>
      <ResourcesHero />
      <Categories />
      <FeaturedCompliance />
      <BottomCTA />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function ResourcesHero() {
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
              Resources
            </span>
          </div>
          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Resources to run HR <span className="text-[#2DD4BF]">better</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-white/80 sm:text-lg">
            Guides, compliance explainers and product walkthroughs — built for Indian HR and payroll teams.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- CATEGORIES ---------------- */
function Categories() {
  const cats = [
    {
      icon: BookOpen,
      title: "Blog",
      desc: "HR trends, product updates, best practices.",
      color: "#2E6FE6",
      bg: "rgba(46,111,230,0.12)",
    },
    {
      icon: ShieldCheck,
      title: "Compliance Guides",
      desc: "PF, ESI, PT, TDS, LWF — explained simply.",
      color: "#1A8050",
      bg: "rgba(26,128,80,0.12)",
    },
    {
      icon: FileText,
      title: "Templates",
      desc: "Letters, policies, checklists ready to use.",
      color: "#B07B18",
      bg: "rgba(176,123,24,0.12)",
    },
    {
      icon: PlayCircle,
      title: "Product Walkthroughs",
      desc: "See each module in action.",
      color: "#7C3AED",
      bg: "rgba(124,58,237,0.12)",
    },
    {
      icon: Video,
      title: "Webinars",
      desc: "Live sessions with HR experts.",
      color: "#15B8A6",
      bg: "rgba(21,184,166,0.12)",
    },
    {
      icon: LifeBuoy,
      title: "Help Center",
      desc: "Setup, migration and how-to docs.",
      color: "#2260A8",
      bg: "rgba(34,96,168,0.12)",
    },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Explore</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need, in one place
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            We're building out our library. Here's what's on the way.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((c, i) => (
            <Reveal key={c.title} delay={i * 70}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-card hover-lift">
                <div className="flex items-start justify-between">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-110"
                    style={{ background: c.bg, color: c.color, boxShadow: `0 0 16px -4px ${c.color}40` }}
                  >
                    <c.icon className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                    Coming soon
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{c.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FEATURED COMPLIANCE ---------------- */
function FeaturedCompliance() {
  const topics = [
    {
      title: "Provident Fund (PF/EPF) & ECR 2.0",
      desc: "Wage ceilings, contribution splits and the ECR 2.0 filing flow.",
    },
    {
      title: "ESI computation & challans",
      desc: "Eligibility thresholds, employer/employee shares and challan generation.",
    },
    {
      title: "Professional Tax — state-wise rules",
      desc: "Slabs and due dates that differ across every Indian state.",
    },
    {
      title: "TDS & Form 24Q",
      desc: "Salary TDS computation, quarterly returns and annexures.",
    },
    {
      title: "Labour Welfare Fund (LWF)",
      desc: "State-specific contributions, cycles and remittance rules.",
    },
  ];
  return (
    <section className="bg-card/40 py-20 sm:py-28">
      <div className="container-page">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="chip">Most read</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            India statutory compliance, decoded
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            The five statutes every Indian payroll team has to get right — explained without the jargon.
          </p>
        </Reveal>
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 sm:grid-cols-2">
          {topics.map((t, i) => (
            <Reveal key={t.title} delay={i * 60} className={i === topics.length - 1 ? "sm:col-span-2" : ""}>
              <a
                href="#"
                className="group flex h-full items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated hover:border-[#15B8A6]/40"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#15B8A6]/15 text-[#15B8A6]">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold group-hover:text-[#1A4D8F]">{t.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
                </div>
              </a>
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
              <HelpCircle className="mx-auto h-10 w-10 text-[#2DD4BF]" />
              <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Have a question we haven't answered?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">
                Book a walkthrough below, or{" "}
                <Link to="/contact" className="font-semibold text-[#2DD4BF] underline-offset-4 hover:underline">
                  get in touch
                </Link>{" "}
                and we'll get back to you within a business day.
              </p>
              <div className="mt-7 flex justify-center">
                <DemoButtons source="resources-cta" inverse align="center" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
