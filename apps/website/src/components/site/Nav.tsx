import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Menu, X, ExternalLink, ChevronDown,
  Users2, CalendarClock, Banknote, Briefcase, BarChart3, Settings2,
} from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useDemoModal } from "./DemoModal";

const moduleLinks = [
  { href: "/modules/people",      label: "People & Lifecycle",    icon: Users2,       desc: "Hire-to-retire in one place" },
  { href: "/modules/attendance",  label: "Attendance & Leave",    icon: CalendarClock, desc: "Real-time, no manual work" },
  { href: "/modules/payroll",     label: "Payroll & Compliance",  icon: Banknote,     desc: "Accurate, on time, every time" },
  { href: "/modules/recruitment", label: "Recruitment & ATS",     icon: Briefcase,    desc: "Hire faster, hire better" },
  { href: "/modules/analytics",   label: "Analytics & AI",        icon: BarChart3,    desc: "Live intelligence, not reports" },
  { href: "/modules/ess",         label: "Employee Self-Service", icon: Settings2,    desc: "Employees do it themselves" },
];

const topLinks = [
  { href: "/#analytics", label: "Analytics" },
  { href: "/#ai",        label: "AI" },
  { href: "/pricing",    label: "Pricing" },
];

export function Nav() {
  const [scrolled, setScrolled]       = useState(false);
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [dropOpen, setDropOpen]       = useState(false);
  const [mobileModules, setMobileModules] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const { open: openDemo } = useDemoModal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className={`fixed inset-x-0 top-0 z-50 glass-nav transition-shadow ${scrolled ? "shadow-soft" : ""}`}>
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Logo />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 lg:flex">
          {/* Modules dropdown */}
          <div ref={dropRef} className="relative">
            <button
              onClick={() => setDropOpen((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
            >
              Modules
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${dropOpen ? "rotate-180" : ""}`} />
            </button>

            {dropOpen && (
              <div className="absolute left-1/2 top-full mt-3 w-[480px] -translate-x-1/2 rounded-2xl border border-border bg-card shadow-elevated">
                <div className="p-3 grid grid-cols-2 gap-1">
                  {moduleLinks.map((m) => (
                    <Link
                      key={m.href}
                      to={m.href}
                      onClick={() => setDropOpen(false)}
                      className="flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#2E6FE6]/10 text-[#2E6FE6] mt-0.5">
                        <m.icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.desc}</p>
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="border-t border-border px-4 py-2.5">
                  <Link
                    to="/#modules"
                    onClick={() => setDropOpen(false)}
                    className="text-xs font-semibold text-[#2E6FE6] hover:underline"
                  >
                    See all modules overview →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {topLinks.map((l) => (
            <Link key={l.href} to={l.href} className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden items-center gap-2 lg:flex">
          <a
            href="https://hrms-web-alpha.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
          >
            Try the Live Demo <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Button onClick={() => openDemo("nav")} className="btn-brand h-10 rounded-full px-5">
            Book a Demo
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          aria-label="Menu"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-card lg:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            {/* Modules accordion */}
            <button
              onClick={() => setMobileModules((v) => !v)}
              className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
            >
              <span>Modules</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${mobileModules ? "rotate-180" : ""}`} />
            </button>
            {mobileModules && (
              <div className="ml-4 flex flex-col gap-0.5">
                {moduleLinks.map((m) => (
                  <Link
                    key={m.href}
                    to={m.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-muted"
                  >
                    <m.icon className="h-4 w-4 shrink-0 text-[#2E6FE6]" />
                    {m.label}
                  </Link>
                ))}
              </div>
            )}

            {topLinks.map((l) => (
              <Link
                key={l.href}
                to={l.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}

            <a
              href="https://hrms-web-alpha.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Try the Live Demo →
            </a>
            <Button
              onClick={() => { setMobileOpen(false); openDemo("mobile-nav"); }}
              className="btn-brand mt-2 h-11 w-full rounded-full"
            >
              Book a Demo
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
