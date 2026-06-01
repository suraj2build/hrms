import { CheckCircle, XCircle, Minus } from 'lucide-react'

const Y = 'yes'
const N = 'no'
const P = 'partial'

const rows = [
  { feature: 'India-first statutory compliance (EPF/ESI/PTAX/TDS)', emvora: Y, greythr: Y, keka: Y, darwinbox: Y },
  { feature: 'AI-powered attrition & anomaly detection',             emvora: Y, greythr: N, keka: P, darwinbox: P },
  { feature: 'Natural language HR query (NLQ)',                       emvora: Y, greythr: N, keka: N, darwinbox: N },
  { feature: 'Multi-entity payroll from single console',              emvora: Y, greythr: P, keka: P, darwinbox: Y },
  { feature: 'Geo-fence + biometric attendance',                     emvora: Y, greythr: Y, keka: Y, darwinbox: Y },
  { feature: 'WhatsApp-native employee self-service',                 emvora: Y, greythr: N, keka: N, darwinbox: N },
  { feature: 'Built-in recruitment (ATS)',                            emvora: Y, greythr: N, keka: Y, darwinbox: Y },
  { feature: 'Compliance guarantee / indemnity',                      emvora: Y, greythr: N, keka: N, darwinbox: N },
  { feature: 'Transparent per-employee pricing',                      emvora: Y, greythr: Y, keka: Y, darwinbox: N },
  { feature: 'Implementation in < 7 days',                            emvora: Y, greythr: P, keka: P, darwinbox: N },
]

function Icon({ v }: { v: string }) {
  if (v === Y) return <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto" />
  if (v === N) return <XCircle    className="w-5 h-5 text-red-300 mx-auto"     />
  return            <Minus       className="w-5 h-5 text-slate-300 mx-auto"    />
}

const cols = [
  { key: 'emvora',    label: 'Emvora',    highlight: true  },
  { key: 'greythr',   label: 'greytHR',   highlight: false },
  { key: 'keka',      label: 'Keka',      highlight: false },
  { key: 'darwinbox', label: 'Darwinbox', highlight: false },
]

export default function Comparison() {
  return (
    <section id="compare" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">Comparison</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            Why teams choose Emvora
          </h2>
          <p className="mt-4 text-slate-500 max-w-xl mx-auto text-lg">
            See how Emvora stacks up against the most popular HRMS platforms in India.
          </p>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F8F9FB]">
                <th className="text-left px-6 py-4 font-semibold text-slate-500 w-1/2">Feature</th>
                {cols.map(c => (
                  <th
                    key={c.key}
                    className={`px-4 py-4 text-center font-bold ${
                      c.highlight ? 'text-violet-700' : 'text-slate-500'
                    }`}
                  >
                    {c.highlight && (
                      <span className="block text-[10px] font-bold text-violet-500 uppercase tracking-wider mb-0.5">Our Pick</span>
                    )}
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.feature}
                  className={`border-t border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                >
                  <td className="px-6 py-4 text-[#334155] font-medium">{r.feature}</td>
                  {cols.map(c => (
                    <td
                      key={c.key}
                      className={`px-4 py-4 text-center ${c.highlight ? 'bg-violet-50/50' : ''}`}
                    >
                      <Icon v={(r as Record<string, string>)[c.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-center text-xs text-slate-300 mt-4">
          Based on publicly available information and user reviews. Last updated June 2025.
        </p>
      </div>
    </section>
  )
}
