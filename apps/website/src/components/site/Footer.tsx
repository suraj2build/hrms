import { Link } from "react-router-dom";
import { Logo } from "./Logo";

export function Footer() {
  const groups: { title: string; links: { label: string; href: string; route?: boolean; external?: boolean }[] }[] = [
    {
      title: "Product",
      links: [
        { label: "Modules", href: "/#modules", route: true },
        { label: "Industries", href: "/industries", route: true },
        { label: "Analytics", href: "/#analytics", route: true },
        { label: "Live Demo", href: "https://hrms-web-alpha.vercel.app", external: true },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "Pricing", href: "/pricing", route: true },
        { label: "Resources", href: "/resources", route: true },
        { label: "About", href: "/about", route: true },
        { label: "Contact", href: "/contact", route: true },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
        { label: "Security", href: "#" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-card">
      <div className="container-page grid gap-10 py-14 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">
            Smarter Workforce. Stronger Future. The all-in-one, India-ready HR platform powered by AI.
          </p>
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">About Saar</p>
            <p className="mt-1 text-sm text-foreground/80">
              Saar builds enterprise software for the modern, India-first organisation. CognixHR is our flagship HR platform.
            </p>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g.title}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</p>
            <ul className="mt-4 space-y-2.5">
              {g.links.map((l) => (
                <li key={l.label}>
                  {l.route ? (
                    <Link to={l.href} className="text-sm text-foreground/80 hover:text-[#2E6FE6] transition-colors">
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={l.href}
                      target={l.external ? "_blank" : undefined}
                      rel={l.external ? "noopener noreferrer" : undefined}
                      className="text-sm text-foreground/80 hover:text-[#2E6FE6] transition-colors"
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Saar · CognixHR · Smarter Workforce. Stronger Future.</p>
          <p>Made in India · DPDP-aware · Audit-logged</p>
        </div>
      </div>
    </footer>
  );
}
