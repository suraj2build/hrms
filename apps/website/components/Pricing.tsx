import { CheckCircle, Zap, Building2, ArrowRight } from 'lucide-react'

const plans = [
  {
    name: 'Starter',
    icon: Zap,
    badge: null,
    tagline: 'For growing businesses',
    price: '₹149',
    per: 'per employee / month',
    minSize: 'From 25 employees',
    description: 'Everything you need to automate HR and stay compliant — payroll, attendance, leave, and all core statutory filings.',
    cta: 'Start Free Trial',
    ctaHref: '#demo',
    highlight: false,
    features: [
      'Payroll for up to 500 employees',
      'Attendance with biometric & geo-fence',
      'Leave management & policies',
      'EPF, ESI, PTAX, TDS auto-filing',
      'Employee self-service mobile app',
      'Form 16 & payslip generation',
      'Email support (24h SLA)',
      'Standard reports & exports',
    ],
  },
  {
    name: 'Enterprise',
    icon: Building2,
    badge: 'Most Popular',
    tagline: 'For large organisations',
    price: 'Custom',
    per: 'volume pricing available',
    minSize: '500+ employees',
    description: 'The full Emvora platform — AI intelligence, multi-entity payroll, custom integrations, dedicated CSM, and SLA guarantees.',
    cta: 'Talk to Sales',
    ctaHref: '#demo',
    highlight: true,
    features: [
      'Everything in Starter, plus:',
      'Unlimited employees, unlimited entities',
      'AI Workforce Intelligence module',
      'Performance management & OKRs',
      'Recruitment & ATS',
      'Custom approval workflows',
      'ERP / SAP / Zoho integrations',
      'Dedicated Customer Success Manager',
      'Priority support (2h SLA)',
      'Compliance guarantee with indemnity',
      'Custom SLA & uptime commitments',
    ],
  },
]

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 bg-[#F8F9FB]">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">Pricing</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            Transparent pricing.<br />No surprises.
          </h2>
          <p className="mt-4 text-slate-500 max-w-lg mx-auto text-lg">
            Start with a 30-day free trial. No credit card required. Cancel any time.
          </p>
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {plans.map((p) => (
            <div
              key={p.name}
              className={`rounded-2xl p-8 flex flex-col gap-6 transition-all duration-250 ${
                p.highlight
                  ? 'bg-violet-700 text-white shadow-2xl shadow-violet-200 border border-violet-600'
                  : 'bg-white border border-slate-100 shadow-sm hover:shadow-md'
              }`}
            >
              {/* Top */}
              <div>
                {p.badge && (
                  <span className="inline-block text-[11px] font-bold px-3 py-1 rounded-full bg-white/20 text-white border border-white/30 mb-3">
                    {p.badge}
                  </span>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${p.highlight ? 'bg-white/20' : 'bg-violet-50'}`}>
                    <p.icon className={`w-5 h-5 ${p.highlight ? 'text-white' : 'text-violet-600'}`} />
                  </div>
                  <div>
                    <p className={`font-display font-bold text-lg ${p.highlight ? 'text-white' : 'text-[#1A1A2E]'}`}>{p.name}</p>
                    <p className={`text-xs ${p.highlight ? 'text-violet-200' : 'text-slate-400'}`}>{p.tagline}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <span className={`font-display text-4xl font-extrabold ${p.highlight ? 'text-white' : 'text-[#1A1A2E]'}`}>
                    {p.price}
                  </span>
                  <span className={`text-sm ml-2 ${p.highlight ? 'text-violet-200' : 'text-slate-400'}`}>{p.per}</span>
                  <p className={`text-xs mt-1 font-semibold ${p.highlight ? 'text-violet-300' : 'text-violet-600'}`}>{p.minSize}</p>
                </div>

                <p className={`text-sm mt-4 leading-relaxed ${p.highlight ? 'text-violet-100' : 'text-slate-500'}`}>
                  {p.description}
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${p.highlight ? 'text-violet-200' : 'text-violet-500'}`} />
                    <span className={`text-sm ${p.highlight ? 'text-violet-100' : 'text-slate-600'}`}>{f}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href={p.ctaHref}
                className={`flex items-center justify-center gap-2 px-6 py-3.5 rounded-full text-sm font-bold transition-all duration-200 ${
                  p.highlight
                    ? 'bg-white text-violet-700 hover:bg-violet-50 shadow-md'
                    : 'bg-violet-700 text-white hover:bg-violet-600 shadow-md shadow-violet-200'
                }`}
              >
                {p.cta}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-slate-400 mt-8">
          All prices are exclusive of GST. Annual billing available at 15% discount.
        </p>
      </div>
    </section>
  )
}
