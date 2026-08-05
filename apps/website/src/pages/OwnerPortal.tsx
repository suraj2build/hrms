import { Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, ArrowUpRight } from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { Reveal } from "@/components/site/Reveal";

/**
 * Owner Portal landing page.
 *
 * This page is intentionally NOT the platform-admin console — it never
 * touches tenant data or Supabase credentials. The real console (tenant
 * management, billing, licensing) lives inside the CognixHR app itself at
 * /owner/login, which is the sole writer of tenant licensing state (see
 * CLAUDE.md "Tenant licensing" — ISSUE-195). This page exists purely so a
 * platform admin arriving at this domain has somewhere to be pointed, without
 * a second deployment holding its own database access.
 */

const APP_URL = "https://hrms-web-alpha.vercel.app";

export default function OwnerPortalPage() {
  return (
    <SiteShell>
      <section className="relative -mt-16 overflow-hidden bg-gradient-to-br from-[#1A4D8F] to-[#2E6FE6] pt-36 pb-24 text-white">
        <div className="pointer-events-none absolute -top-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-[#2DD4BF]/20 blur-3xl animate-blob" />
        <div
          className="pointer-events-none absolute -bottom-40 -left-20 h-[28rem] w-[28rem] rounded-full bg-[#2E6FE6]/30 blur-3xl animate-blob"
          style={{ animationDelay: "2s" }}
        />
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
                Owner Portal
              </span>
            </div>

            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
              <ShieldCheck className="h-3.5 w-3.5 text-[#2DD4BF]" />
              Platform administration
            </div>

            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              This is a <span className="text-[#2DD4BF]">signpost</span>,
              not the console
            </h1>
            <p className="mt-5 max-w-2xl text-base text-white/80 sm:text-lg">
              CognixHR's platform-admin console — tenant management,
              licensing, and billing — lives inside the CognixHR app itself,
              not on a separate deployment. If you're a platform admin, sign
              in there directly.
            </p>

            <div className="mt-8">
              <a
                href={`${APP_URL}/owner/login`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#1A4D8F] transition-colors hover:bg-white/90"
              >
                Sign in to the owner console
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="container-page py-16">
        <Reveal>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Looking for the CognixHR product? Head back to the{" "}
            <Link to="/" className="font-medium text-primary underline underline-offset-2">
              homepage
            </Link>
            . For general support, use the{" "}
            <Link to="/contact" className="font-medium text-primary underline underline-offset-2">
              contact page
            </Link>
            .
          </p>
        </Reveal>
      </section>
    </SiteShell>
  );
}
