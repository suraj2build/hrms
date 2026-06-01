'use client'
import { useState } from 'react'
import { ArrowRight, CheckCircle, Loader2 } from 'lucide-react'

export default function DemoForm() {
  const [form,    setForm]    = useState({ name: '', email: '', company: '', phone: '', size: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Request failed')
      setDone(true)
    } catch {
      setError('Something went wrong. Please try again or email us directly.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="demo" className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-violet-950/30 to-[#0a0614] pointer-events-none" />
      <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[700px] h-[400px] rounded-full bg-violet-900/20 blur-[100px] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* Left */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-600/10 border border-violet-600/20 text-xs font-semibold text-violet-400 mb-6">
              See Emvora Live
            </div>
            <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
              Request your<br />
              <span className="gradient-text">personalised demo.</span>
            </h2>
            <p className="text-violet-200/50 text-lg leading-relaxed mb-8">
              Our experts will walk you through a live demo tailored to your industry and team size — no generic presentations.
            </p>

            <div className="space-y-4">
              {[
                { title: 'Personalised walkthrough',   desc: 'See features relevant to your exact use case' },
                { title: '30-minute focused session',   desc: 'No fluff — straight to what matters for your team' },
                { title: 'Live Q&A with experts',       desc: 'Ask anything, get real answers from product specialists' },
                { title: 'Trial access after demo',     desc: 'Get hands-on access to explore at your own pace' },
              ].map(p => (
                <div key={p.title} className="flex gap-3">
                  <CheckCircle className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-white">{p.title}</p>
                    <p className="text-xs text-violet-400/40">{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Form */}
          <div className="relative">
            <div className="absolute inset-0 bg-violet-600/10 blur-[60px] rounded-3xl" />
            <div className="relative glass rounded-3xl p-8 border border-violet-500/20">

              {done ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-green-900/30 border border-green-600/30 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-8 h-8 text-green-400" />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-2">Request Received!</h3>
                  <p className="text-violet-200/50 text-sm leading-relaxed">
                    Our team will reach out within 24 hours to schedule your personalised demo. Check your email for confirmation.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <h3 className="font-display text-lg font-bold text-white mb-5">Book a Demo</h3>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-violet-300/50 uppercase tracking-wider mb-1.5 block">Full Name *</label>
                      <input
                        required
                        type="text"
                        placeholder="Rahul Sharma"
                        value={form.name}
                        onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                        className="w-full bg-violet-950/50 border border-violet-700/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-violet-400/30 focus:outline-none focus:border-violet-500/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-violet-300/50 uppercase tracking-wider mb-1.5 block">Work Email *</label>
                      <input
                        required
                        type="email"
                        placeholder="rahul@company.com"
                        value={form.email}
                        onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                        className="w-full bg-violet-950/50 border border-violet-700/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-violet-400/30 focus:outline-none focus:border-violet-500/50 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-violet-300/50 uppercase tracking-wider mb-1.5 block">Company Name *</label>
                    <input
                      required
                      type="text"
                      placeholder="Acme Pvt Ltd"
                      value={form.company}
                      onChange={e => setForm(p => ({ ...p, company: e.target.value }))}
                      className="w-full bg-violet-950/50 border border-violet-700/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-violet-400/30 focus:outline-none focus:border-violet-500/50 transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-violet-300/50 uppercase tracking-wider mb-1.5 block">Phone</label>
                      <input
                        type="tel"
                        placeholder="+91 98765 43210"
                        value={form.phone}
                        onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                        className="w-full bg-violet-950/50 border border-violet-700/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-violet-400/30 focus:outline-none focus:border-violet-500/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-violet-300/50 uppercase tracking-wider mb-1.5 block">Team Size</label>
                      <select
                        value={form.size}
                        onChange={e => setForm(p => ({ ...p, size: e.target.value }))}
                        className="w-full bg-violet-950/50 border border-violet-700/30 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/50 transition-colors">
                        <option value="" className="bg-violet-950">Select size</option>
                        {['1-50','51-200','201-500','501-1000','1000+'].map(s => (
                          <option key={s} value={s} className="bg-violet-950">{s} employees</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-violet-300/50 uppercase tracking-wider mb-1.5 block">What are you looking to solve?</label>
                    <textarea
                      rows={3}
                      placeholder="Tell us about your current challenges..."
                      value={form.message}
                      onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                      className="w-full bg-violet-950/50 border border-violet-700/30 rounded-xl px-3 py-2.5 text-sm text-white placeholder-violet-400/30 focus:outline-none focus:border-violet-500/50 transition-colors resize-none"
                    />
                  </div>

                  {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/20 rounded-lg px-3 py-2">{error}</p>}

                  <button
                    type="submit"
                    disabled={loading}
                    className="group w-full flex items-center justify-center gap-2 py-3.5 rounded-full bg-gradient-to-r from-violet-600 to-violet-700 text-white font-semibold text-sm hover:from-violet-500 hover:to-violet-600 transition-all duration-200 shadow-xl shadow-violet-900/50 disabled:opacity-60 disabled:cursor-not-allowed">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                      <>
                        Book My Demo
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-violet-400/25 text-center">
                    No spam. No sales pressure. Your information is secure.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
