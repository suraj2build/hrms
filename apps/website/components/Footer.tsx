import { Zap, Mail, Phone, MapPin } from 'lucide-react'

const links = {
  Product: [
    'Features',
    'Payroll Engine',
    'Attendance Intelligence',
    'Statutory Compliance',
    'AI & Analytics',
    'Employee Self-Service',
  ],
  Company: [
    'About Us',
    'Careers',
    'Blog',
    'Press',
    'Security',
    'Privacy Policy',
  ],
  Resources: [
    'Documentation',
    'API Reference',
    'Status Page',
    'Changelog',
    'Webinars',
    'HR Templates',
  ],
  Legal: [
    'Terms of Service',
    'Privacy Policy',
    'Cookie Policy',
    'SLA',
    'GDPR',
  ],
}

export default function Footer() {
  return (
    <footer className="bg-[#F8F9FB] border-t border-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-16">

        {/* Top grid */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-10 mb-14">

          {/* Brand col */}
          <div className="col-span-2">
            <a href="#" className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#10B981] via-[#0D9488] to-[#2563EB] flex items-center justify-center shadow-md">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-display font-bold text-lg text-[#1A1A2E] tracking-tight">emvora</span>
            </a>
            <p className="text-sm text-slate-400 leading-relaxed mb-6 max-w-xs">
              India&apos;s most intelligent HRMS. Built for the modern enterprise — where payroll meets AI and compliance becomes effortless.
            </p>

            {/* Contact */}
            <div className="space-y-2">
              <a href="mailto:hello@emvora.in" className="flex items-center gap-2 text-sm text-slate-400 hover:text-violet-600 transition-colors">
                <Mail className="w-4 h-4 text-violet-400" />
                hello@emvora.in
              </a>
              <a href="tel:+918000000000" className="flex items-center gap-2 text-sm text-slate-400 hover:text-violet-600 transition-colors">
                <Phone className="w-4 h-4 text-violet-400" />
                +91 80000 00000
              </a>
              <div className="flex items-start gap-2 text-sm text-slate-400">
                <MapPin className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                Bengaluru · Mumbai · Delhi
              </div>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([section, items]) => (
            <div key={section}>
              <p className="text-xs font-bold uppercase tracking-widest text-[#1A1A2E] mb-4">{section}</p>
              <ul className="space-y-2.5">
                {items.map(item => (
                  <li key={item}>
                    <a
                      href="#"
                      className="text-sm text-slate-400 hover:text-violet-700 transition-colors duration-150"
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-slate-100 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-300">
            © {new Date().getFullYear()} Emvora Technologies Pvt Ltd. All rights reserved. · GST: 29AABCE1234F1Z5
          </p>
          <div className="flex items-center gap-4">
            {['ISO 27001', 'SOC 2', 'GDPR'].map(b => (
              <span
                key={b}
                className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-50 text-violet-600 border border-violet-100"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
