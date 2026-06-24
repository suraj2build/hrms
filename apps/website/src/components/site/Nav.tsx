import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Menu, X, ExternalLink } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useDemoModal } from "./DemoModal";

const navLinks = [
  { href: "#modules", label: "Modules" },
  { href: "#analytics", label: "Analytics" },
  { href: "#ai", label: "AI" },
  { href: "/pricing", label: "Pricing", route: true },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { open: openDemo } = useDemoModal();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 glass-nav transition-shadow ${
        scrolled ? "shadow-soft" : ""
      }`}
    >

      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Logo />
        <nav className="hidden items-center gap-7 lg:flex">
          {navLinks.map((l) =>
            l.route ? (
              <Link key={l.href} to={l.href} className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
                {l.label}
              </a>
            ),
          )}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <a
            href="https://hrms-web-alpha.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
          >
            Try the Live Demo <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Button
            onClick={() => openDemo("nav")}
            className="btn-brand h-10 rounded-full px-5"
          >
            Book a Demo
          </Button>

        </div>
        <button
          aria-label="Menu"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-border bg-card lg:hidden">
          <div className="container-page flex flex-col gap-1 py-3">
            {navLinks.map((l) =>
              l.route ? (
                <Link key={l.href} to={l.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted">
                  {l.label}
                </Link>
              ) : (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted">
                  {l.label}
                </a>
              ),
            )}
            <a
              href="https://hrms-web-alpha.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Try the Live Demo →
            </a>
            <Button
              onClick={() => {
                setOpen(false);
                openDemo("mobile-nav");
              }}
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
