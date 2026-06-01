import { CheckCircle, Zap, Building2, ArrowRight } from 'lucide-react'

const plans = [
  {
    name:       'Starter',
    icon:       Zap,
    badge:      'Most Popular',
    price:      '₹XXX',
    unit:       'per employee / month',
    desc:       'For growing businesses ready to move beyond spreadsheets and fragmented tools.',
    features: [
      'Up to 200 employees',
      'Core HR & Employee Profiles',
      'Attendance & Leave Management',
      'Payroll Engine (auto-compute)',
      'EPF, ESI, PTAX, TDS compliance',
      'Employee Self-Service Portal',
      'Mobile-friendly access',
      'Standard reports & exports',
      'Email support',
      'Onboarding assistance',
    ],
    cta:        'Request Demo',
    highlight:  true,
  },
  {
    name:       'Enterprise',
    icon:       Building2,
    badge:      'Custom',
    price:      '₹XXX',
    unit:       'custom pricing',
    desc:       'For large enterprises that need advanced intelligence, custom workflows, and dedicated support.',
    features: [
      'Unlimited employees',
      'Everything in Starter, plus:',
      'AI Workforce Intelligence',
      'Predictive Analytics & Forecasting',
      'Executive Intelligence Center',
      'Advanced Payroll (arrears, variable pay)',
      'Custom approval workflows',
      'Multi-site & multi-entity support',
      'API access & integrations',
      'Dedicated Customer Success Manager',
      'SLA-backed uptime (99.9%)',
      'Custom data retention & security',
    ],
    cta:        'Contact Sales',
    highlight:  false,
  },
]

export default function Pricing() {
  return (
    <section id="pricing" className="relative py-32 overflow-hidden">
      <div className="absolute left-1/2 -translate-x-1/2 top-0 w-[600px] h-[400px] rounded-full bg-violet-900/15 blur-[100px] pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-600/10 border border-violet-600/20 text-xs font-semibold text-violet-400 mb-4">
            Simple Pricing
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
            Transparent pricing.<br />
            <span className="gradient-text">No hidden surprises.</span>
          </h2>
          <p className="text-violet-200/50 text-lg max-w-xl mx-auto">
            Start with what you need. Scale as you grow. Both plans include full statutory compliance.
          </p>
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {plans.map(plan => (
            <div key={plan.name}
              className={`relative rounded-3xl p-8 flex flex-col transition-all duration-300 ${
                plan.highlight
                  ? 'bg-gradient-to-br from-violet-800/40 to-violet-900/60 border-2 border-violet-500/50 shadow-2xl shadow-violet-900/50 glow-violet'
                  : 'glass border border-violet-700/30'
              }`}>

              {plan.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1 rounded-full bg-gradient-to-r from-violet-500 to-violet-600 text-white text-xs font-bold shadow-lg">
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="flex items-center gap-3 mb-5">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  plan.highlight ? 'bg-violet-500/30 border border-violet-400/30' : 'bg-violet-900/50 border border-violet-700/30'
                }`}>
                  <plan.icon className="w-5 h-5 text-violet-300" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-white">{plan.name}</h3>
                  {!plan.highlight && (
                    <span className="text-[10px] font-semibold text-violet-400/50 uppercase tracking-wider">{plan.badge}</span>
                  )}
                </div>
              </div>

              <p className="text-sm text-violet-200/40 mb-6 leading-relaxed">{plan.desc}</p>

              {/* Price */}
              <div className="mb-6 pb-6 border-b border-violet-700/20">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl font-extrabold text-white">{plan.price}</span>
                </div>
                <p className="text-xs text-violet-400/50 mt-1">{plan.unit}</p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 flex-1 mb-8">
                {plan.features.map(f => (
                  <li key={f} className={`flex items-start gap-2.5 text-sm ${
                    f.includes('plus:') ? 'text-violet-400 font-semibold mt-2' : 'text-violet-200/60'
                  }`}>
                    {!f.includes('plus:') && (
                      <CheckCircle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                        plan.highlight ? 'text-violet-400' : 'text-violet-500'
                      }`} />
                    )}
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a href="#demo"
                className={`group flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold transition-all duration-200 ${
                  plan.highlight
                    ? 'bg-gradient-to-r from-violet-500 to-violet-600 text-white hover:from-violet-400 hover:to-violet-500 shadow-lg shadow-violet-900/50'
                    : 'glass border border-violet-600/30 text-violet-300 hover:border-violet-500/50 hover:text-white'
                }`}>
                {plan.cta}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-violet-400/30 mt-8">
          All prices exclude GST. Implementation and onboarding support included in all plans. Minimum contract: 12 months.
        </p>
      </div>
    </section>
  )
}
