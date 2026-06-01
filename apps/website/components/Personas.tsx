import { Users, UserCheck, BarChart3, Landmark } from 'lucide-react'

const personas = [
  {
    icon: Users,
    title: 'HR Teams',
    headline: 'From chaos to clarity',
    description:
      'Automate onboarding, payroll processing, leave management, and compliance filings. Free your HR team to focus on people, not paperwork.',
    tags: ['Payroll Automation', 'Bulk Onboarding', 'Policy Engine'],
  },
  {
    icon: UserCheck,
    title: 'Employees',
    headline: 'Self-service, always on',
    description:
      'Apply for leave, view payslips, submit claims, and update personal info — anytime, from any device. No tickets, no waiting.',
    tags: ['ESS Portal', 'Mobile App', 'Instant Payslips'],
  },
  {
    icon: BarChart3,
    title: 'Managers',
    headline: 'Lead with data',
    description:
      'Approve leave requests, track team attendance, review performance, and get AI-powered insights to make better people decisions.',
    tags: ['Team Dashboard', 'Approval Flows', 'AI Insights'],
  },
  {
    icon: Landmark,
    title: 'Finance & CFOs',
    headline: 'Full cost visibility',
    description:
      'Real-time payroll analytics, statutory liability forecasting, and seamless ERP integrations keep your books accurate and audit-ready.',
    tags: ['Cost Centre Reports', 'EPF/ESI Filings', 'ERP Sync'],
  },
]

export default function Personas() {
  return (
    <section className="py-24 bg-[#F8F9FB]">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">Who It's For</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            Built for everyone in your organisation
          </h2>
          <p className="mt-4 text-slate-500 max-w-xl mx-auto text-lg">
            Whether you&apos;re running payroll, clocking attendance, or planning headcount — Emvora has a workflow built just for you.
          </p>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {personas.map((p) => (
            <div
              key={p.title}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-250 p-6 flex flex-col gap-4"
            >
              <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center">
                <p.icon className="w-5 h-5 text-violet-700" />
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-violet-600 mb-1">{p.title}</p>
                <h3 className="font-display text-lg font-bold text-[#1A1A2E] leading-snug">{p.headline}</h3>
              </div>

              <p className="text-sm text-slate-500 leading-relaxed flex-1">{p.description}</p>

              <div className="flex flex-wrap gap-1.5 pt-2">
                {p.tags.map(t => (
                  <span
                    key={t}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-100"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
