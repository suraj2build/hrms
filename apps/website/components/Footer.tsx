import { Zap, Mail, Phone, MapPin, ArrowRight } from 'lucide-react'

const links = {
  Product: ['Features','Payroll Engine','Attendance Intelligence','Statutory Compliance','AI & Analytics','Employee Self-Service'],
  Company: ['About Us','Careers','Blog','Press','Security','Privacy Policy'],
  Resources: ['Documentation','API Reference','Help Center','Status Page','Changelog'],
  Legal: ['Terms of Service','Privacy Policy','Data Processing','Cookie Policy','Refund Policy'],
}

export default function Footer() {
  return (
    <footer className="relative border-t border-violet-800/20 pt-16 pb-8 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-violet-950/30 to-transparent pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-10 mb-12">

          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-violet-800 flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-display font-bold text-lg text-white">emvora</span>
            </div>
            <p className="text-sm text-violet-300/40 leading-relaxed mb-5 max-w-xs">
              Beyond HR. Workforce Intelligence.<br />
              Built for modern Indian enterprises.
            </p>

            {/* Contact */}
            <div className="space-y-2">
              {[
                { icon: Mail,   text: 'hello@emvora.in' },
                { icon: Phone,  text: '+91 XXXXX XXXXX' },
                { icon: MapPin, text: 'India' },
              ].map(c => (
                <div key={c.text} className="flex items-center gap-2 text-xs text-violet-400/40">
                  <c.icon className="w-3.5 h-3.5 text-violet-600" />
                  {c.text}
                </div>
              ))}
            </div>
          </div>

          {/* Links */}
          {Object.entries(links).map(([group, items]) => (
            <div key={group}>
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-violet-400/50 mb-4">{group}</h4>
              <ul className="space-y-2.5">
                {items.map(item => (
                  <li key={item}>
                    <a href="#" className="text-sm text-violet-300/40 hover:text-violet-200 transition-colors">{item}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Newsletter */}
        <div className="glass rounded-2xl p-6 border border-violet-700/20 mb-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-display font-semibold text-white text-sm">Stay updated on Emvora</p>
            <p className="text-xs text-violet-400/40 mt-0.5">Product updates, compliance changes, and HR insights — monthly.</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <input
              type="email"
              placeholder="your@company.com"
              className="flex-1 sm:w-56 bg-violet-950/50 border border-violet-700/30 rounded-full px-4 py-2 text-sm text-white placeholder-violet-400/30 focus:outline-none focus:border-violet-500/50"
            />
            <button className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors whitespace-nowrap">
              Subscribe <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-violet-800/20">
          <p className="text-xs text-violet-400/30">
            © 2026 Emvora Technologies Pvt. Ltd. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            {['🇮🇳 Made in India', 'SOC 2 (Coming)', 'ISO 27001 (Coming)'].map(t => (
              <span key={t} className="text-[11px] text-violet-400/25">{t}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
