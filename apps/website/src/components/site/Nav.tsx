import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Menu, X, ExternalLink, ChevronDown,
  Users2, CalendarClock, Banknote, Briefcase, BarChart3, Settings2,
  Building2, Brain, LineChart, BookOpen, ShieldCheck, Info, Mail,
} from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useDemoModal } from "./DemoModal";

type MenuItem = { href: string; label: string; desc: string; icon: typeof Users2 };
type Menu = { key: string; label: string; cols: 1 | 2; footer?: { href: string; label: string }; items: MenuItem[] };

const menus: Menu[] = [
  {
    key: "modules",
    label: "Modules",
    cols: 2,
    footer: { href: "/#modules", label: "See all modules overview →" },
    items: [
      { href: "/modules/people",      label: "People & Lifecycle",    icon: Users2,        desc: "Hire-to-retire in one place" },
      { href: "/modules/attendance",  label: "Attendance & Leave",    icon: CalendarClock, desc: "Real-time, no manual work" },
      { href: "/modules/payroll",     label: "Payroll & Compliance",  icon: Banknote,      desc: "Accurate, on time, every time" },
      { href: "/modules/recruitment", label: "Recruitment & ATS",     icon: Briefcase,     desc: "Hire faster, hire better" },
      { href: "/modules/analytics",   label: "Analytics & AI",        icon: BarChart3,     desc: "Live intelligence, not reports" },
      { href: "/modules/ess",         label: "Employee Self-Service", icon: Settings2,     desc: "Employees do it themselves" },
    ],
  },
  {
    key: "solutions",
    label: "Solutions",
    cols: 1,
    items: [
      { href: "/industries", label: "By Industry",     icon: Building2, desc: "IT, Manufacturing, Retail & more" },
      { href: "/#ai",        label: "AI & Automation", icon: Brain,     desc: "Practical AI across every module" },
      { href: "/#analytics", label: "Analytics",       icon: LineChart, desc: "Live workforce intelligence" },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    cols: 1,
    items: [
      { href: "/resources", label: "Resource Hub",      icon: BookOpen,    desc: "Guides, templates, walkthroughs" },
      { href: "/resources", label: "Compliance Guides", icon: ShieldCheck, desc: "PF, ESI, PT, TDS, LWF explained" },
      { href: "/about",     label: "About CognixHR",    icon: Info,        desc: "Our mission & the Saar story" },
      { href: "/contact",   label: "Contact Us",        icon: Mail,        desc: "Book a demo or ask a question" },
    ],
  },
];

const topLinks = [{ href: "/pricing", label: "Pricing" }];

export function Nav() {
  const [scrolled, setScrolled]       = useState(false);
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [openMenu, setOpenMenu]       = useState<string | null>(null);
  const [mobileMenu, setMobileMenu]   = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const { open: openDemo } = useDemoModal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close any open dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header ref={navRef} className={`fixed inset-x-0 top-0 z-50 glass-nav transition-shadow ${scrolled ? "shadow-soft" : ""}`}>
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Logo />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 lg:flex">
          {menus.map((menu) => {
            const isOpen = openMenu === menu.key;
            return (
              <div key={menu.key} className="relative">
                <button
                  onClick={() => setOpenMenu(isOpen ? null : menu.key)}
                  className="flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
                >
                  {menu.label}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {isOpen && (
                  <div
                    className={`absolute left-1/2 top-full mt-3 -translate-x-1/2 rounded-2xl border border-border bg-card shadow-elevated ${
                      menu.cols === 2 ? "w-[480px]" : "w-[340px]"
                    }`}
                  >
                    <div className={`p-3 grid gap-1 ${menu.cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                      {menu.items.map((m) => (
                        <Link
                          key={m.label}
                          to={m.href}
                          onClick={() => setOpenMenu(null)}
                          className="flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted"
                        >
                          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#2E6FE6]/10 text-[#2E6FE6]">
                            <m.icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{m.label}</p>
                            <p className="text-xs text-muted-foreground">{m.desc}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                    {menu.footer && (
                      <div className="border-t border-border px-4 py-2.5">
                        <Link to={menu.footer.href} onClick={() => setOpenMenu(null)} className="text-xs font-semibold text-[#2E6FE6] hover:underline">
                          {menu.footer.label}
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

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
          <div className="container-page flex max-h-[80vh] flex-col gap-1 overflow-y-auto py-3">
            {menus.map((menu) => {
              const isOpen = mobileMenu === menu.key;
              return (
                <div key={menu.key}>
                  <button
                    onClick={() => setMobileMenu(isOpen ? null : menu.key)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
                  >
                    <span>{menu.label}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="ml-4 flex flex-col gap-0.5">
                      {menu.items.map((m) => (
                        <Link
                          key={m.label}
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
                </div>
              );
            })}

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
