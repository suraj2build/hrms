'use client'
import { ArrowRight, Play, Users, Building2, TrendingUp, Shield } from 'lucide-react'

const stats = [
  { value: '10x',   label: 'Faster Payroll',      icon: TrendingUp },
  { value: '99.9%', label: 'Uptime SLA',           icon: Shield     },
  { value: '100%',  label: 'Statutory Compliant',  icon: Building2  },
  { value: '50+',   label: 'HR Modules',           icon: Users      },
]

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-16 bg-white">

      {/* Subtle radial violet tint at top */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(13,148,136,0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-6 text-center z-10">

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-50 border border-violet-200 text-xs font-semibold text-violet-700 mb-8 animate-fade-in-up">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
          AI-Native Workforce Intelligence Platform · India&apos;s Next-Gen HRMS
        </div>

        {/* Headline */}
        <h1 className="font-display text-5xl md:text-7xl font-extrabold text-[#1A1A2E] leading-[1.08] tracking-tight mb-6 animate-fade-in-up">
          Beyond HR.<br />
          <span className="gradient-text">Workforce Intelligence.</span>
        </h1>

        {/* Subheadline */}
        <p
          className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in-up"
          style={{ animationDelay: '0.1s' }}
        >
          Emvora unifies your entire workforce — payroll, attendance, compliance, and AI-driven intelligence — into one platform built for the demands of modern Indian enterprises.
        </p>

        {/* CTAs */}
        <div
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-fade-in-up"
          style={{ animationDelay: '0.2s' }}
        >
          <a
            href="#demo"
            className="group flex items-center gap-2 px-8 py-3.5 rounded-full bg-gradient-to-r from-[#10B981] via-[#0D9488] to-[#2563EB] text-white font-semibold text-sm hover:brightness-110 transition-all duration-200 shadow-lg shadow-violet-200"
          >
            Request a Demo
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="#features"
            className="flex items-center gap-2 px-8 py-3.5 rounded-full bg-white border border-violet-200 text-violet-700 font-semibold text-sm hover:border-violet-400 hover:bg-violet-50 transition-all duration-200"
          >
            <Play className="w-4 h-4" />
            See How It Works
          </a>
        </div>

        {/* Stats */}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto animate-fade-in-up"
          style={{ animationDelay: '0.3s' }}
        >
          {stats.map(s => (
            <div key={s.label} className="bg-white rounded-2xl p-4 text-center border border-slate-100 shadow-sm hover:shadow-md transition-shadow duration-200">
              <s.icon className="w-5 h-5 text-violet-600 mx-auto mb-2" />
              <p className="font-display text-2xl font-bold text-[#1A1A2E]">{s.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Product mockup */}
        <div className="mt-20 animate-float">
          <div className="relative mx-auto max-w-5xl">

            {/* Subtle glow behind mockup */}
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#F8F9FB] to-transparent z-10 pointer-events-none rounded-b-2xl" />
            <div className="absolute -inset-4 bg-violet-100/40 blur-3xl rounded-3xl pointer-events-none" />

            {/* Browser chrome */}
            <div className="relative bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-2xl shadow-slate-200/80">

              {/* Browser bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 mx-4 bg-white rounded-md py-1 px-3 text-xs text-slate-400 text-center border border-slate-100">
                  app.emvora.in/admin/dashboard
                </div>
              </div>

              {/* Dashboard content — light mode */}
              <div className="bg-[#F8F9FB] p-6">

                {/* Top nav mock */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-violet-700 flex items-center justify-center text-white text-xs font-bold">E</div>
                    <div className="flex gap-1">
                      {['Workforce', 'Attendance', 'Payroll', 'Leave', 'Compliance'].map(t => (
                        <div
                          key={t}
                          className={`px-3 py-1 rounded-full text-[10px] font-medium ${
                            t === 'Payroll'
                              ? 'bg-violet-700 text-white'
                              : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-slate-200" />
                    <div className="w-7 h-7 rounded-full bg-violet-100 border border-violet-200" />
                  </div>
                </div>

                {/* KPI cards */}
                <div className="grid grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Total Employees',   value: '1,247', delta: '+12',   color: 'violet' },
                    { label: 'Payroll This Month', value: '₹84.2L', delta: '+3.2%', color: 'green'  },
                    { label: 'Attendance Rate',   value: '94.7%', delta: '+1.1%', color: 'blue'   },
                    { label: 'Pending Approvals', value: '23',    delta: '-5',    color: 'amber'  },
                  ].map(k => (
                    <div key={k.label} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <p className="text-[10px] text-slate-400 mb-1">{k.label}</p>
                      <p className="font-display text-lg font-bold text-[#1A1A2E]">{k.value}</p>
                      <p className="text-[10px] text-emerald-500 mt-0.5 font-semibold">{k.delta}</p>
                    </div>
                  ))}
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Bar chart */}
                  <div className="col-span-2 bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
                    <p className="text-[10px] text-slate-400 mb-3 font-semibold uppercase tracking-wider">Payroll Trend — 6 Months</p>
                    <div className="flex items-end gap-2 h-16">
                      {[55, 70, 62, 80, 74, 90].map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 rounded-t-sm"
                          style={{
                            height: `${h}%`,
                            background: i === 5 ? '#0D9488' : '#CCFBF1',
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between mt-2">
                      {['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'].map(m => (
                        <span key={m} className="text-[9px] text-slate-300">{m}</span>
                      ))}
                    </div>
                  </div>

                  {/* Donut */}
                  <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm flex flex-col justify-between">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Attendance</p>
                    <div className="flex items-center justify-center">
                      <div className="relative w-16 h-16">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="14" fill="none" stroke="#F1F5F9" strokeWidth="4" />
                          <circle cx="18" cy="18" r="14" fill="none" stroke="#0D9488" strokeWidth="4"
                            strokeDasharray="83 17" strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[11px] font-bold text-[#1A1A2E]">94%</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {[['Present', '83%', '#0D9488'], ['Leave', '9%', '#F59E0B'], ['Absent', '8%', '#F87171']].map(([l, v, c]) => (
                        <div key={l as string} className="flex justify-between text-[9px]">
                          <span className="text-slate-400">{l as string}</span>
                          <span className="font-semibold text-[#1A1A2E]">{v as string}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Industry tags */}
        <p className="mt-16 text-xs text-slate-300 uppercase tracking-widest font-semibold">
          Trusted across Indian industries
        </p>
        <div className="flex items-center justify-center gap-8 mt-4 flex-wrap pb-8">
          {['Manufacturing', 'IT Services', 'Retail', 'Healthcare', 'BFSI', 'Logistics'].map(i => (
            <span key={i} className="text-sm text-slate-300 font-medium">{i}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
