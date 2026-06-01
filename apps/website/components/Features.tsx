import {
  Users, Clock, DollarSign, CalendarDays,
  Brain, FileText, BarChart3, Shield,
  Zap, ArrowRight
} from 'lucide-react'

const modules = [
  {
    icon: Users,
    title: 'People & Workforce',
    desc: 'Complete employee lifecycle — from onboarding to separation. AI-powered document extraction, org charts, and workforce analytics.',
    tags: ['Smart Onboarding', 'Org Intelligence', 'Role Management'],
    color: 'from-violet-600/20 to-violet-800/10',
    border: 'border-violet-600/30',
    badge: 'Core',
  },
  {
    icon: Clock,
    title: 'Attendance Intelligence',
    desc: 'Real-time punch tracking, anomaly detection, shift rosters, and muster rolls. Know who is in — always.',
    tags: ['Live Tracking', 'Anomaly Detection', 'Roster Engine'],
    color: 'from-blue-600/20 to-blue-800/10',
    border: 'border-blue-600/30',
    badge: 'Smart',
  },
  {
    icon: DollarSign,
    title: 'Payroll Engine',
    desc: 'One-click payroll runs with full explainability. LOP calculations, variable pay, arrears, and automated bank disbursement.',
    tags: ['Auto-Run', 'Full Explainability', 'Bank Integration'],
    color: 'from-emerald-600/20 to-emerald-800/10',
    border: 'border-emerald-600/30',
    badge: 'Powerful',
  },
  {
    icon: CalendarDays,
    title: 'Leave Management',
    desc: 'Policy-driven leave engine with accruals, comp-off, optional holidays, and collision detection. Zero manual effort.',
    tags: ['Accrual Engine', 'Collision Guard', 'Policy Rules'],
    color: 'from-pink-600/20 to-pink-800/10',
    border: 'border-pink-600/30',
    badge: 'Complete',
  },
  {
    icon: Shield,
    title: 'Statutory Compliance',
    desc: 'Built-in EPF, ESI, Professional Tax, and TDS engines. Auto-compute, file-ready reports, and governance dashboards.',
    tags: ['EPF / ESI', 'PTAX', 'TDS / IT'],
    color: 'from-amber-600/20 to-amber-800/10',
    border: 'border-amber-600/30',
    badge: 'India-First',
  },
  {
    icon: Brain,
    title: 'AI & Intelligence',
    desc: 'Workforce risk scoring, anomaly intelligence, executive dashboards, and predictive insights — powered by AI.',
    tags: ['Risk Scoring', 'Predictive AI', 'Executive BI'],
    color: 'from-purple-600/20 to-purple-800/10',
    border: 'border-purple-600/30',
    badge: 'Next-Gen',
  },
  {
    icon: FileText,
    title: 'Documents & Letters',
    desc: 'Template-based letter generation, digital signatures, document vaults, and e-sign workflows — all automated.',
    tags: ['Auto-Generate', 'E-Sign', 'Secure Vault'],
    color: 'from-cyan-600/20 to-cyan-800/10',
    border: 'border-cyan-600/30',
    badge: 'Automated',
  },
  {
    icon: BarChart3,
    title: 'Reports & Analytics',
    desc: 'Real-time workforce dashboards, cost intelligence, statutory reports, and export-ready MIS. Every metric at your fingertips.',
    tags: ['Live Dashboards', 'MIS Reports', 'Cost Analytics'],
    color: 'from-orange-600/20 to-orange-800/10',
    border: 'border-orange-600/30',
    badge: 'Insights',
  },
]

export default function Features() {
  return (
    <section id="features" className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-950/20 to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6">

        {/* Section header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-600/10 border border-violet-600/20 text-xs font-semibold text-violet-400 mb-4">
            <Zap className="w-3 h-3" /> Platform Modules
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
            Everything your workforce needs,<br />
            <span className="gradient-text">intelligently connected.</span>
          </h2>
          <p className="text-violet-200/50 text-lg max-w-2xl mx-auto">
            50+ modules built from the ground up — not bolted together. Every feature speaks to every other feature.
          </p>
        </div>

        {/* Module grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {modules.map((m) => (
            <div key={m.title}
              className={`relative rounded-2xl p-5 bg-gradient-to-br ${m.color} border ${m.border} glow-card cursor-default overflow-hidden group`}>

              {/* Badge */}
              <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-wider text-violet-300/50 px-2 py-0.5 rounded-full bg-violet-900/40 border border-violet-700/20">
                {m.badge}
              </span>

              {/* Icon */}
              <div className="w-10 h-10 rounded-xl bg-violet-900/50 border border-violet-700/30 flex items-center justify-center mb-4">
                <m.icon className="w-5 h-5 text-violet-300" />
              </div>

              <h3 className="font-display font-semibold text-white text-sm mb-2">{m.title}</h3>
              <p className="text-violet-200/50 text-xs leading-relaxed mb-4">{m.desc}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {m.tags.map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-300/70 border border-violet-700/20">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <a href="#demo" className="inline-flex items-center gap-2 text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors group">
            See all features in a live demo
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </section>
  )
}
