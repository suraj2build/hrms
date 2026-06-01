import {
  IndianRupee, Clock, CalendarDays, UserPlus, BarChart3,
  FileText, Briefcase, Settings, Smartphone, ShieldCheck,
  Globe2, BrainCircuit,
} from 'lucide-react'

const features = [
  {
    icon: IndianRupee,
    title: 'Payroll Engine',
    description: 'Multi-state, multi-component payroll with auto CTC restructuring, FBP, and one-click disbursement.',
  },
  {
    icon: Clock,
    title: 'Attendance & Shifts',
    description: 'Biometric, geo-fencing, and mobile punch-in. Flexible shift patterns with auto-overtime calculation.',
  },
  {
    icon: CalendarDays,
    title: 'Leave Management',
    description: 'Custom leave policies, leave encashment, carry-forward rules, and multi-level approval workflows.',
  },
  {
    icon: UserPlus,
    title: 'Onboarding',
    description: 'Digital joining kits, document collection, background verification integrations, and Day-1 readiness.',
  },
  {
    icon: BarChart3,
    title: 'Performance Management',
    description: 'OKRs, 360° feedback, continuous check-ins, and bell-curve normalisation for annual appraisals.',
  },
  {
    icon: FileText,
    title: 'Statutory Compliance',
    description: 'Auto-generated EPF, ESI, PTAX, and TDS challans with direct filing portal integrations.',
  },
  {
    icon: Briefcase,
    title: 'Recruitment',
    description: 'ATS with job portals sync, structured interviews, offer management, and background checks.',
  },
  {
    icon: Settings,
    title: 'Core HR',
    description: 'Single employee record, org chart, documents, letters, and complete employment lifecycle tracking.',
  },
  {
    icon: Smartphone,
    title: 'ESS & Mobile App',
    description: 'Employees manage payslips, leaves, claims, and profile from iOS/Android — no IT dependencies.',
  },
  {
    icon: ShieldCheck,
    title: 'Document Management',
    description: 'Encrypted vault for offer letters, contracts, Form 16, and statutory documents with e-sign support.',
  },
  {
    icon: Globe2,
    title: 'Multi-Entity Support',
    description: 'Run payroll across multiple companies, states, and cost centres from a single admin console.',
  },
  {
    icon: BrainCircuit,
    title: 'AI Workforce Intelligence',
    description: 'Predictive attrition scoring, anomaly detection in attendance, and natural-language HR queries.',
  },
]

export default function Features() {
  return (
    <section id="features" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">Platform Modules</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            Everything HR. In one place.
          </h2>
          <p className="mt-4 text-slate-500 max-w-xl mx-auto text-lg">
            50+ modules working together seamlessly — no integrations duct-taped together, no data silos.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {features.map((f) => (
            <div
              key={f.title}
              className="group bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-250 p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-violet-50 group-hover:bg-violet-100 flex items-center justify-center mb-4 transition-colors duration-200">
                <f.icon className="w-5 h-5 text-violet-600" />
              </div>
              <h3 className="font-display font-bold text-[#1A1A2E] mb-2 text-base">{f.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 text-center">
          <a
            href="#demo"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-violet-700 text-white font-semibold text-sm hover:bg-violet-600 transition-colors duration-200 shadow-md shadow-violet-200"
          >
            See All Features
          </a>
        </div>
      </div>
    </section>
  )
}
