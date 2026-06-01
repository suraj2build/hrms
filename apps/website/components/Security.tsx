import { ShieldCheck, Lock, Eye, Server, RefreshCcw, FileCheck } from 'lucide-react'

const badges = [
  { label: 'ISO 27001',      sub: 'Information Security',     icon: ShieldCheck },
  { label: 'SOC 2 Type II',  sub: 'Operational Security',     icon: Lock        },
  { label: 'GDPR Compliant', sub: 'Data Privacy',             icon: Eye         },
  { label: 'MeitY Hosted',   sub: 'India Data Residency',     icon: Server      },
  { label: '99.9% Uptime',   sub: 'SLA Guaranteed',           icon: RefreshCcw  },
  { label: 'CERT-In Ready',  sub: 'Incident Response',        icon: FileCheck   },
]

const details = [
  'AES-256 encryption at rest and in transit',
  'Role-based access control (RBAC) with field-level security',
  'Immutable audit logs for every payroll and HR action',
  'Multi-factor authentication with SSO support',
  'Automated daily backups with 30-day point-in-time recovery',
  'Penetration tested quarterly by accredited third parties',
]

export default function Security() {
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">Trust & Security</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            Enterprise-grade security.<br />
            <span className="gradient-text">Built in, not bolted on.</span>
          </h2>
          <p className="mt-4 text-slate-500 max-w-xl mx-auto text-lg">
            Your workforce data is your most sensitive asset. Emvora treats security as a first-class feature — not an afterthought.
          </p>
        </div>

        {/* Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-14">
          {badges.map((b) => (
            <div
              key={b.label}
              className="bg-[#F8F9FB] rounded-2xl border border-slate-100 p-5 flex flex-col items-center text-center gap-3 hover:shadow-md hover:-translate-y-1 transition-all duration-250"
            >
              <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center">
                <b.icon className="w-6 h-6 text-violet-700" />
              </div>
              <div>
                <p className="font-bold text-sm text-[#1A1A2E]">{b.label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{b.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Detail checklist */}
        <div className="bg-[#F8F9FB] rounded-2xl border border-slate-100 p-8">
          <h3 className="font-display font-bold text-[#1A1A2E] text-xl mb-6">What security means at Emvora</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {details.map((d) => (
              <div key={d} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ShieldCheck className="w-3 h-3 text-violet-700" />
                </div>
                <p className="text-sm text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
