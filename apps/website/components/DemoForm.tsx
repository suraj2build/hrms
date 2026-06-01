'use client'
import { useState } from 'react'
import { ArrowRight, CheckCircle, Loader2 } from 'lucide-react'

const benefits = [
  'Full platform walkthrough — no PowerPoint, real product',
  'Your data, your workflows — customised to your org',
  'Get a compliance health-check for your current setup',
  'See payroll run live in under 10 minutes',
]

export default function DemoForm() {
  const [status, setStatus]   = useState<'idle' | 'loading' | 'done'>('idle')
  const [form,   setForm]     = useState({ name: '', email: '', company: '', size: '', phone: '' })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    await new Promise(r => setTimeout(r, 1400))
    setStatus('done')
  }

  return (
    <section id="demo" className="py-24 bg-[#F8F9FB]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="bg-white rounded-3xl border border-slate-100 shadow-lg overflow-hidden">
          <div className="grid md:grid-cols-2">

            {/* Left — copy */}
            <div className="bg-gradient-to-br from-violet-700 to-[#2F1F57] p-10 md:p-12 flex flex-col justify-between">
              <div>
                <p className="text-violet-300 text-xs font-bold uppercase tracking-widest mb-4">Request a Demo</p>
                <h2 className="font-display text-3xl md:text-4xl font-extrabold text-white leading-tight mb-5">
                  See Emvora in action.<br />In 30 minutes.
                </h2>
                <p className="text-violet-200 text-base leading-relaxed mb-8">
                  Our product experts will walk you through a live demo tailored to your industry and team size. No sales pitch — just the product.
                </p>

                <ul className="space-y-3">
                  {benefits.map(b => (
                    <li key={b} className="flex items-start gap-3">
                      <CheckCircle className="w-4 h-4 text-violet-300 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-violet-100">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-10 pt-8 border-t border-white/10">
                <p className="text-xs text-violet-300/60 uppercase tracking-widest font-semibold mb-3">Response time</p>
                <p className="text-sm text-violet-200">We typically respond within <span className="font-bold text-white">2 business hours</span>. Same-day demos available.</p>
              </div>
            </div>

            {/* Right — form */}
            <div className="p-10 md:p-12">
              {status === 'done' ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h3 className="font-display text-2xl font-bold text-[#1A1A2E]">Request received!</h3>
                  <p className="text-slate-500 max-w-xs">
                    Our team will reach out within 2 hours to schedule your personalised demo.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <p className="font-display font-bold text-[#1A1A2E] text-xl mb-1">Book your demo</p>
                    <p className="text-sm text-slate-400 mb-6">No commitment. No credit card.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">Full Name *</label>
                      <input
                        name="name"
                        required
                        value={form.name}
                        onChange={handleChange}
                        placeholder="Rahul Sharma"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-[#1A1A2E] placeholder-slate-300 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">Work Email *</label>
                      <input
                        name="email"
                        type="email"
                        required
                        value={form.email}
                        onChange={handleChange}
                        placeholder="rahul@company.com"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-[#1A1A2E] placeholder-slate-300 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Company Name *</label>
                    <input
                      name="company"
                      required
                      value={form.company}
                      onChange={handleChange}
                      placeholder="Acme Pvt Ltd"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-[#1A1A2E] placeholder-slate-300 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">Team Size *</label>
                      <select
                        name="size"
                        required
                        value={form.size}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-[#1A1A2E] focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition bg-white"
                      >
                        <option value="">Select</option>
                        <option>25 – 100</option>
                        <option>101 – 500</option>
                        <option>501 – 2,000</option>
                        <option>2,000+</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">Phone</label>
                      <input
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        placeholder="+91 98765 43210"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-[#1A1A2E] placeholder-slate-300 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 transition"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-violet-700 text-white font-bold text-sm hover:bg-violet-600 disabled:opacity-60 transition-colors duration-200 shadow-md shadow-violet-200 mt-2"
                  >
                    {status === 'loading' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    ) : (
                      <>Book My Demo <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>

                  <p className="text-xs text-slate-300 text-center">
                    By submitting you agree to our Privacy Policy. No spam, ever.
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
