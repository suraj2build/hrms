import { Link } from "react-router-dom";
import { useState } from "react";
import {
  ArrowLeft,
  Mail,
  Phone,
  MessageSquare,
  MapPin,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import { SiteShell } from "@/components/site/SiteShell";
import { Reveal } from "@/components/site/Reveal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function ContactPage() {
  return (
    <SiteShell>
      <ContactHero />
      <ContactBody />
    </SiteShell>
  );
}

/* ---------------- HERO ---------------- */
function ContactHero() {
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
              Contact
            </span>
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Let's <span className="text-[#2DD4BF]">talk</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base text-white/80 sm:text-lg">
            Book a demo, ask about pricing, or just say hello. We usually reply within one business day.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- BODY ---------------- */
function ContactBody() {
  return (
    <section className="py-20 sm:py-28">
      <div className="container-page">
        <div className="grid gap-12 lg:grid-cols-2">
          <ContactMethods />
          <ContactForm />
        </div>
      </div>
    </section>
  );
}

/* ---------------- LEFT: METHODS ---------------- */
function ContactMethods() {
  const methods = [
    {
      icon: Mail,
      label: "Email",
      value: "hello@cognixhr.com",
      color: "#2E6FE6",
      bg: "rgba(46,111,230,0.12)",
    },
    {
      icon: Phone,
      label: "Sales",
      value: "Book a 30-min walkthrough",
      color: "#1A8050",
      bg: "rgba(26,128,80,0.12)",
    },
    {
      icon: MessageSquare,
      label: "Support",
      value: "In-app help & live chat",
      color: "#7C3AED",
      bg: "rgba(124,58,237,0.12)",
    },
    {
      icon: MapPin,
      label: "Office",
      value: "Bengaluru, India",
      color: "#15B8A6",
      bg: "rgba(21,184,166,0.12)",
    },
  ];
  return (
    <Reveal>
      <div className="space-y-4">
        {methods.map((m) => (
          <div
            key={m.label}
            className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
          >
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
              style={{ background: m.bg, color: m.color }}
            >
              <m.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {m.label}
              </p>
              <p className="mt-0.5 text-base font-semibold text-foreground">{m.value}</p>
            </div>
          </div>
        ))}
        <div className="rounded-2xl border border-[#15B8A6]/30 bg-[#15B8A6]/[0.05] p-5">
          <p className="text-sm text-muted-foreground">
            Prefer a live demo?{" "}
            <a
              href="https://hrms-web-alpha.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[#15B8A6] hover:underline"
            >
              Jump into the sandbox anytime
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </p>
        </div>
      </div>
    </Reveal>
  );
}

/* ---------------- RIGHT: FORM ---------------- */
function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [companySize, setCompanySize] = useState("1–50");
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <Reveal delay={120}>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
        {!submitted ? (
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                required
                placeholder="Aarav Sharma"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                required
                placeholder="Acme Pvt Ltd"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="companySize">Company size</Label>
              <select
                id="companySize"
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option>1–50</option>
                <option>51–200</option>
                <option>201–500</option>
                <option>500+</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                rows={4}
                placeholder="How can we help?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <Button type="submit" size="lg" className="btn-brand h-12 w-full rounded-full text-base font-semibold">
              Send message
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              By submitting, you agree to our Privacy Policy. We'll reply within 1 business day.
            </p>
          </form>
        ) : (
          <div className="grid place-items-center gap-3 py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-[#15B8A6]/15 text-[#15B8A6]">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="text-2xl font-bold tracking-tight">Message received</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Thanks — we'll be in touch within one business day.
            </p>
          </div>
        )}
      </div>
    </Reveal>
  );
}
