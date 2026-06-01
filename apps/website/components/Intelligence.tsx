import { Brain, AlertTriangle, TrendingUp, Eye, Zap, ChevronRight } from 'lucide-react'

const capabilities = [
  {
    icon: AlertTriangle,
    title: 'Anomaly Detection',
    desc: 'AI scans every punch record, payroll computation, and leave request — flagging outliers before they become problems.',
    metric: '94%', metricLabel: 'Detection accuracy',
  },
  {
    icon: TrendingUp,
    title: 'Predictive Payroll',
    desc: 'Forecast payroll costs 3 months ahead. Simulate salary revisions, headcount changes, and statutory impact instantly.',
    metric: '3x',  metricLabel: 'Faster payroll closure',
  },
  {
    icon: Eye,
    title: 'Workforce Risk Intelligence',
    desc: 'Real-time risk scores per employee — absenteeism risk, attrition signals, compliance exposure, and attendance confidence.',
    metric: '360°', metricLabel: 'Employee visibility',
  },
  {
    icon: Brain,
    title: 'Executive Intelligence Center',
    desc: 'CEO and CHRO-level dashboards that surface what matters — cost trends, headcount movement, and org health scores.',
    metric: '∞',   metricLabel: 'Insights, always fresh',
  },
]

export default function Intelligence() {
  return (
    <section id="intelligence" className="relative py-32 overflow-hidden">

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-800/10 blur-[100px]" />
      </div>

      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* Left — copy */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-600/10 border border-violet-600/20 text-xs font-semibold text-violet-400 mb-6">
              <Brain className="w-3 h-3" /> AI-Powered Intelligence
            </div>

            <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
              Your HR platform<br />
              that <span className="gradient-text">thinks ahead.</span>
            </h2>

            <p className="text-violet-200/50 text-lg leading-relaxed mb-8">
              Emvora&apos;s intelligence layer doesn&apos;t just store data — it understands patterns, detects risks, and surfaces insights that traditional HRMS systems can&apos;t see.
            </p>

            <div className="space-y-4">
              {capabilities.map(c => (
                <div key={c.title} className="flex gap-4 group">
                  <div className="w-10 h-10 rounded-xl bg-violet-900/50 border border-violet-700/30 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:bg-violet-800/50 transition-colors">
                    <c.icon className="w-5 h-5 text-violet-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-display font-semibold text-white text-sm">{c.title}</h3>
                      <span className="text-xs font-bold text-violet-400 font-display">{c.metric}</span>
                      <span className="text-[10px] text-violet-400/40">{c.metricLabel}</span>
                    </div>
                    <p className="text-xs text-violet-200/40 leading-relaxed">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <a href="#demo" className="inline-flex items-center gap-2 mt-8 text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors group">
              See Intelligence in action
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>

          {/* Right — visual */}
          <div className="relative">
            <div className="absolute inset-0 bg-violet-600/10 blur-[60px] rounded-3xl" />
            <div className="relative glass rounded-3xl p-6 border border-violet-500/20">

              {/* Intelligence feed */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-violet-400" />
                  <span className="text-xs font-semibold text-violet-300">Intelligence Feed</span>
                </div>
                <span className="text-[10px] text-violet-400/40 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </span>
              </div>

              <div className="space-y-3">
                {[
                  { type: 'risk',    color: 'amber',  icon: '⚠️', title: 'High Absenteeism Risk', desc: '14 employees in Operations show >3 unplanned absences this month', time: '2 min ago' },
                  { type: 'insight', color: 'violet', icon: '🧠', title: 'Payroll Variance Detected', desc: 'Q1 payroll ₹2.3L above forecast — 8 new joiners not in plan', time: '18 min ago' },
                  { type: 'action',  color: 'green',  icon: '✅', title: 'Compliance Check Passed', desc: 'March EPF/ESI computation complete — 0 discrepancies found', time: '1 hr ago' },
                  { type: 'alert',   color: 'red',    icon: '🔴', title: 'Attendance Anomaly', desc: '3 punch records with geo-spoofing detected in Branch B', time: '3 hr ago' },
                  { type: 'insight', color: 'blue',   icon: '📊', title: 'Roster Optimisation', desc: 'Shift coverage gap on Sat-Sun — AI suggests rotating 4 employees', time: '5 hr ago' },
                ].map((item, i) => (
                  <div key={i} className={`flex gap-3 p-3 rounded-xl bg-violet-900/20 border border-violet-800/20 hover:border-violet-700/30 transition-colors`}>
                    <span className="text-base mt-0.5">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                        <span className="text-[10px] text-violet-400/30 flex-shrink-0">{item.time}</span>
                      </div>
                      <p className="text-[11px] text-violet-300/40 mt-0.5 leading-snug">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom score */}
              <div className="mt-5 p-4 rounded-2xl bg-gradient-to-r from-violet-900/40 to-violet-800/20 border border-violet-700/20 flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-violet-400/50 uppercase tracking-wider font-semibold">Org Health Index</p>
                  <p className="font-display text-2xl font-bold text-white mt-0.5">87 <span className="text-sm font-normal text-green-400">↑ +3</span></p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-violet-400/50">Powered by Emvora AI</p>
                  <div className="flex gap-1 mt-1 justify-end">
                    {[85,88,82,90,87].map((v,i) => (
                      <div key={i} className="w-1.5 rounded-full bg-violet-500/60"
                        style={{ height: `${(v/100)*24}px`, opacity: i === 4 ? 1 : 0.4 + i * 0.1 }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
