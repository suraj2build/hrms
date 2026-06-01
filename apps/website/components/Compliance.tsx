import { Shield, CheckCircle, FileCheck, Landmark, Receipt, CreditCard } from 'lucide-react'

const compliances = [
  {
    code: 'EPF',
    name: 'Employee Provident Fund',
    desc: 'Auto-compute PF contributions, admin charges, EDLI. ECR file generation and direct EPFO portal sync. Wage ceiling management across pay grades.',
    icon: Landmark,
    status: 'Auto-filed',
  },
  {
    code: 'ESI',
    name: 'Employee State Insurance',
    desc: 'ESI eligibility tracking by wage threshold, contribution cycles, half-yearly returns, IP registration, and challan generation.',
    icon: Shield,
    status: 'Auto-filed',
  },
  {
    code: 'PTAX',
    name: 'Professional Tax',
    desc: 'State-wise professional tax slabs pre-loaded. Auto-deduction, monthly/annual challan, and state-specific returns across 28 states.',
    icon: Receipt,
    status: 'Auto-filed',
  },
  {
    code: 'TDS',
    name: 'Tax Deducted at Source',
    desc: 'Income tax projection under old and new regime, Form 16 generation, 24Q quarterly returns, and integration with TRACES portal.',
    icon: CreditCard,
    status: 'Auto-filed',
  },
  {
    code: 'LWF',
    name: 'Labour Welfare Fund',
    desc: 'State-specific LWF deductions, contribution registers, and annual filing — fully automated with zero manual intervention.',
    icon: FileCheck,
    status: 'Auto-filed',
  },
  {
    code: 'Gratuity',
    name: 'Gratuity Provisioning',
    desc: 'Actuarial gratuity liability calculation, AS 15 provisions, funding reports, and payment processing on separation.',
    icon: CheckCircle,
    status: 'Auto-calculated',
  },
]

export default function Compliance() {
  return (
    <section id="compliance" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">India-First Compliance</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            100% statutory compliance.<br />
            <span className="gradient-text">Zero penalties. Ever.</span>
          </h2>
          <p className="mt-4 text-slate-500 max-w-xl mx-auto text-lg">
            Emvora is built ground-up for Indian labour law. Every statutory obligation is automated, every deadline is tracked, every challan is filed on time.
          </p>
        </div>

        {/* Compliance cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {compliances.map((c) => (
            <div
              key={c.code}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-250 p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center">
                  <c.icon className="w-5 h-5 text-violet-600" />
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                  {c.status}
                </span>
              </div>
              <div className="mb-1">
                <span className="text-xs font-black text-violet-700 tracking-widest uppercase">{c.code}</span>
              </div>
              <h3 className="font-display font-bold text-[#1A1A2E] mb-2">{c.name}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>

        {/* Trust bar */}
        <div className="bg-[#F8F9FB] rounded-2xl border border-slate-100 p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-700 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-[#1A1A2E]">Compliance guarantee</p>
              <p className="text-sm text-slate-500">If you get penalised due to a bug in Emvora, we cover it. No questions asked.</p>
            </div>
          </div>
          <a
            href="#demo"
            className="flex-shrink-0 px-6 py-2.5 rounded-full bg-violet-700 text-white text-sm font-semibold hover:bg-violet-600 transition-colors duration-200 shadow-md shadow-violet-200"
          >
            Request Compliance Demo
          </a>
        </div>
      </div>
    </section>
  )
}
