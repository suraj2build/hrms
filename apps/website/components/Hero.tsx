'use client'
import { ArrowRight, Play, Users, Building2, TrendingUp, Shield } from 'lucide-react'

const stats = [
  { value: '10x',    label: 'Faster Payroll',      icon: TrendingUp },
  { value: '99.9%',  label: 'Uptime SLA',          icon: Shield     },
  { value: '100%',   label: 'Statutory Compliant', icon: Building2  },
  { value: '50+',    label: 'HR Modules',          icon: Users      },
]

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-16">

      {/* Background glow */}
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-violet-900/20 blur-[120px] pointer-events-none" />

      {/* Grid lines */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(rgba(156,130,212,1) 1px, transparent 1px), linear-gradient(90deg, rgba(156,130,212,1) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />

      <div className="relative max-w-7xl mx-auto px-6 text-center z-10">

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-violet-500/30 text-xs font-semibold text-violet-300 mb-8 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          AI-Native Workforce Intelligence Platform · India&apos;s Next-Gen HRMS
        </div>

        {/* Headline */}
        <h1 className="font-display text-5xl md:text-7xl font-extrabold text-white leading-[1.08] tracking-tight mb-6 animate-fade-in-up">
          Beyond HR.<br />
          <span className="gradient-text">Workforce Intelligence.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg md:text-xl text-violet-200/60 max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          Emvora unifies your entire workforce — payroll, attendance, compliance, and AI-driven intelligence — into one platform built for the demands of modern Indian enterprises.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <a href="#demo"
            className="group flex items-center gap-2 px-8 py-3.5 rounded-full bg-gradient-to-r from-violet-600 to-violet-700 text-white font-semibold text-sm hover:from-violet-500 hover:to-violet-600 transition-all duration-200 shadow-xl shadow-violet-900/60 glow-violet">
            Request a Demo
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
          <a href="#features"
            className="flex items-center gap-2 px-8 py-3.5 rounded-full glass border border-violet-500/30 text-violet-200 font-semibold text-sm hover:border-violet-400/50 hover:text-white transition-all duration-200">
            <Play className="w-4 h-4" />
            See How It Works
          </a>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          {stats.map(s => (
            <div key={s.label} className="glass rounded-2xl p-4 text-center glow-card">
              <s.icon className="w-5 h-5 text-violet-400 mx-auto mb-2" />
              <p className="font-display text-2xl font-bold text-white">{s.value}</p>
              <p className="text-xs text-violet-300/60 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Product mockup */}
        <div className="mt-20 relative animate-float">
          <div className="relative mx-auto max-w-5xl">
            {/* Glow behind mockup */}
            <div className="absolute inset-0 bg-violet-600/20 blur-[60px] rounded-3xl" />

            {/* Browser chrome mockup */}
            <div className="relative glass rounded-2xl overflow-hidden border border-violet-500/30 shadow-2xl shadow-violet-900/50">
              {/* Browser bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-violet-950/60 border-b border-violet-800/30">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <div className="flex-1 mx-4 bg-violet-900/50 rounded-md py-1 px-3 text-xs text-violet-300/50 text-center">
                  app.emvora.in/admin/control-center
                </div>
              </div>

              {/* Dashboard mockup content */}
              <div className="bg-gradient-to-br from-violet-950/80 to-[#0a0614] p-6">
                {/* Top nav mock */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-xs font-bold">H</div>
                    <div className="flex gap-1">
                      {['Workforce','Attendance','Payroll','Leave','Compliance'].map(t => (
                        <div key={t} className={`px-3 py-1 rounded-full text-[10px] font-medium ${t === 'Payroll' ? 'bg-violet-600 text-white' : 'text-violet-300/50'}`}>{t}</div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="w-7 h-7 rounded-full bg-violet-800/50" />
                    <div className="w-7 h-7 rounded-full bg-violet-800/50" />
                  </div>
                </div>

                {/* KPI cards row */}
                <div className="grid grid-cols-4 gap-3 mb-5">
                  {[
                    { label: 'Total Employees', value: '1,247', delta: '+12', color: 'violet' },
                    { label: 'Payroll This Month', value: '₹84.2L', delta: '+3.2%', color: 'green' },
                    { label: 'Attendance Rate', value: '94.7%', delta: '+1.1%', color: 'blue' },
                    { label: 'Pending Approvals', value: '23', delta: '-5', color: 'amber' },
                  ].map(k => (
                    <div key={k.label} className="bg-violet-900/30 rounded-xl p-3 border border-violet-800/30">
                      <p className="text-[10px] text-violet-300/50 mb-1">{k.label}</p>
                      <p className="font-display text-lg font-bold text-white">{k.value}</p>
                      <p className="text-[10px] text-green-400 mt-0.5">{k.delta}</p>
                    </div>
                  ))}
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-3 gap-3">
                  {/* Bar chart mock */}
                  <div className="col-span-2 bg-violet-900/20 rounded-xl p-4 border border-violet-800/20">
                    <p className="text-[10px] text-violet-300/50 mb-3 font-semibold uppercase tracking-wider">Payroll Trend — 6 Months</p>
                    <div className="flex items-end gap-2 h-16">
                      {[55,70,62,80,74,90].map((h,i) => (
                        <div key={i} className="flex-1 rounded-t-sm"
                          style={{ height: `${h}%`, background: i === 5 ? 'rgba(124,94,196,0.9)' : 'rgba(124,94,196,0.3)' }} />
                      ))}
                    </div>
                    <div className="flex justify-between mt-1">
                      {['Oct','Nov','Dec','Jan','Feb','Mar'].map(m => (
                        <span key={m} className="text-[9px] text-violet-400/40">{m}</span>
                      ))}
                    </div>
                  </div>

                  {/* Donut mock */}
                  <div className="bg-violet-900/20 rounded-xl p-4 border border-violet-800/20 flex flex-col justify-between">
                    <p className="text-[10px] text-violet-300/50 font-semibold uppercase tracking-wider">Attendance</p>
                    <div className="flex items-center justify-center">
                      <div className="relative w-16 h-16">
                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                          <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(124,94,196,0.15)" strokeWidth="4"/>
                          <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(124,94,196,0.9)" strokeWidth="4"
                            strokeDasharray="83 17" strokeLinecap="round"/>
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-[11px] font-bold text-white">94%</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {[['Present','83%','violet'],['Leave','9%','amber'],['Absent','8%','red']].map(([l,v,c])=>(
                        <div key={l} className="flex justify-between text-[9px]">
                          <span className="text-violet-300/50">{l}</span>
                          <span className="text-white font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Trusted by */}
        <p className="mt-16 text-xs text-violet-400/40 uppercase tracking-widest font-semibold">Designed for Indian enterprises</p>
        <div className="flex items-center justify-center gap-8 mt-4 flex-wrap">
          {['Manufacturing','IT Services','Retail','Healthcare','BFSI'].map(i => (
            <span key={i} className="text-sm text-violet-300/30 font-medium">{i}</span>
          ))}
        </div>
      </div>
    </section>
  )
}
