import { Brain, AlertTriangle, TrendingUp, Eye, Zap, ChevronRight } from 'lucide-react'

const capabilities = [
  {
    icon: AlertTriangle,
    title: 'Attrition Risk Scoring',
    description: 'Machine learning models analyse 40+ signals — absenteeism, performance dips, salary gaps — to flag flight-risk employees 90 days in advance.',
  },
  {
    icon: TrendingUp,
    title: 'Payroll Anomaly Detection',
    description: 'Automatically surface unusual salary spikes, duplicate entries, or missed components before the payroll run is authorised.',
  },
  {
    icon: Eye,
    title: 'Attendance Pattern Analysis',
    description: 'Identify habitual late-comers, buddy-punching patterns, and leave abuse through statistical outlier detection.',
  },
  {
    icon: Zap,
    title: 'Natural Language HR Queries',
    description: 'Ask "Who in Engineering took more than 5 leaves last quarter?" and get an instant answer — no dashboards, no SQL.',
  },
]

export default function Intelligence() {
  return (
    <section id="intelligence" className="py-24 bg-[#F8F9FB]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* Left — copy */}
          <div>
            <p className="eyebrow mb-4">AI & Intelligence</p>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] leading-tight tracking-tight mb-6">
              Your HRMS now<br />
              <span className="gradient-text">thinks for you.</span>
            </h2>
            <p className="text-slate-500 text-lg leading-relaxed mb-10">
              Emvora Intelligence is not a bolt-on chatbot. It&apos;s a proactive AI layer embedded across payroll, attendance, and workforce — surfacing insights before you even know to ask.
            </p>

            <div className="space-y-5">
              {capabilities.map((c) => (
                <div key={c.title} className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 shadow-sm flex items-center justify-center flex-shrink-0">
                    <c.icon className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#1A1A2E] mb-1">{c.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{c.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <a
              href="#demo"
              className="inline-flex items-center gap-2 mt-10 text-sm font-semibold text-violet-700 hover:text-violet-600 transition-colors"
            >
              See Intelligence in action <ChevronRight className="w-4 h-4" />
            </a>
          </div>

          {/* Right — visual */}
          <div className="relative">
            <div className="absolute -inset-6 bg-violet-50 rounded-3xl" />
            <div className="relative bg-white rounded-2xl border border-slate-100 shadow-lg p-6 space-y-4">

              {/* Header */}
              <div className="flex items-center gap-3 pb-2 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-violet-700 flex items-center justify-center">
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1A1A2E]">Emvora Intelligence</p>
                  <p className="text-xs text-slate-400">Live insights · Updated 2 min ago</p>
                </div>
                <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>

              {/* Insight cards */}
              {[
                {
                  badge: 'Attrition Risk',
                  badgeColor: 'bg-red-50 text-red-600 border-red-100',
                  text: '7 employees in Engineering scored high attrition risk this month. Salary benchmarking is 18% below market.',
                  action: 'View report',
                },
                {
                  badge: 'Payroll Anomaly',
                  badgeColor: 'bg-amber-50 text-amber-600 border-amber-100',
                  text: 'Overtime payout for Mumbai branch is ₹2.4L higher than 3-month average. Review before approval.',
                  action: 'Investigate',
                },
                {
                  badge: 'Attendance Insight',
                  badgeColor: 'bg-violet-50 text-violet-700 border-violet-100',
                  text: 'Monday absenteeism in Delhi office has increased 34% over last 6 weeks. Likely work-from-home preference.',
                  action: 'See trends',
                },
              ].map((item) => (
                <div key={item.badge} className="bg-[#F8F9FB] rounded-xl p-4 border border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.badgeColor}`}>
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed mb-2">{item.text}</p>
                  <button className="text-xs font-semibold text-violet-700 hover:text-violet-600">
                    {item.action} →
                  </button>
                </div>
              ))}

              {/* NLQ bar */}
              <div className="bg-violet-50 rounded-xl px-4 py-3 flex items-center gap-3 border border-violet-100">
                <Brain className="w-4 h-4 text-violet-500 flex-shrink-0" />
                <p className="text-sm text-slate-400 italic">Ask anything: "Who has pending appraisals in Sales?"</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
