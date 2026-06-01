import { Shield, CheckCircle, FileCheck, Landmark, Receipt, CreditCard } from 'lucide-react'

const compliances = [
  { code: 'EPF',  name: 'Employee Provident Fund',   desc: 'Auto-compute PF contributions, admin charges, EDLI. ECR file generation. Wage ceiling management.',          icon: Landmark,  status: 'Auto-filed' },
  { code: 'ESI',  name: 'Employee State Insurance',   desc: 'ESI eligibility tracking, contribution cycles, half-yearly returns, and challan generation.',                  icon: Shield,    status: 'Auto-filed' },
  { code: 'PTAX', name: 'Professional Tax',           desc: 'State-wise slab management for all 18 PT states. Monthly auto-deduction and remittance schedules.',            icon: Receipt,   status: 'State-aware' },
  { code: 'TDS',  name: 'Tax Deducted at Source',     desc: 'Section 192 TDS computation, Form 16 generation, tax regime elections (Old vs New), and HRA declarations.',   icon: FileCheck, status: 'Form 16 Ready' },
  { code: 'IT',   name: 'Income Tax Planning',        desc: 'Employee-facing IT planner, investment declarations (80C/80D), HRA exemption, and YTD tax statements.',        icon: CreditCard,status: 'Self-Service' },
  { code: 'LWF',  name: 'Labour Welfare Fund',        desc: 'State-specific LWF deductions with contribution schedules and annual reconciliation.',                          icon: CheckCircle,status: 'Coming Soon' },
]

export default function Compliance() {
  return (
    <section id="compliance" className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-amber-950/5 to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-600/10 border border-amber-600/20 text-xs font-semibold text-amber-400 mb-4">
            <Shield className="w-3 h-3" /> India-First Compliance
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
            100% statutory compliant.<br />
            <span className="gradient-text-gold">Zero manual effort.</span>
          </h2>
          <p className="text-violet-200/50 text-lg max-w-2xl mx-auto">
            Built specifically for Indian labour laws. Every regulation — EPF, ESI, PTAX, TDS — handled automatically, with audit trails and filing-ready reports.
          </p>
        </div>

        {/* Compliance grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-16">
          {compliances.map(c => (
            <div key={c.code}
              className="relative glass rounded-2xl p-5 border border-violet-700/20 hover:border-amber-600/20 transition-all duration-300 glow-card group">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-900/30 border border-amber-700/20 flex items-center justify-center">
                    <c.icon className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <span className="font-display font-bold text-base text-white">{c.code}</span>
                    <p className="text-[10px] text-violet-300/40">{c.name}</p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  c.status === 'Coming Soon'
                    ? 'bg-violet-900/40 text-violet-400/50 border border-violet-700/20'
                    : 'bg-green-900/30 text-green-400 border border-green-700/20'
                }`}>
                  {c.status}
                </span>
              </div>
              <p className="text-xs text-violet-200/40 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>

        {/* Trust banner */}
        <div className="relative overflow-hidden rounded-3xl glass border border-amber-600/20 p-8 md:p-12 text-center">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-950/30 via-violet-950/20 to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-center gap-3 mb-4">
              <CheckCircle className="w-6 h-6 text-amber-400" />
              <h3 className="font-display text-2xl font-bold text-white">Built by payroll experts, for payroll experts</h3>
            </div>
            <p className="text-violet-200/50 max-w-2xl mx-auto mb-6 text-sm leading-relaxed">
              Emvora&apos;s compliance engine is built in partnership with statutory filing experts and updated with every government notification — so you&apos;re never caught off-guard.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              {['Ministry of Labour compliant','EPFO registered','ESIC portal integration','Income Tax portal ready','State PT rules — 18 states'].map(t => (
                <span key={t} className="flex items-center gap-1.5 text-xs text-amber-300/70">
                  <CheckCircle className="w-3 h-3 text-amber-400" /> {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
