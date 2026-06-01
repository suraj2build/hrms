import { CheckCircle, XCircle, Minus } from 'lucide-react'

const Y = 'yes'
const N = 'no'
const P = 'partial'

const rows = [
  { feature: 'Unified HR + Payroll + Attendance',       emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'AI-powered workforce intelligence',        emvora: Y, legacy: N, spreadsheet: N },
  { feature: 'India statutory (EPF/ESI/PTAX/TDS)',       emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Real-time anomaly detection',              emvora: Y, legacy: N, spreadsheet: N },
  { feature: 'Predictive payroll forecasting',           emvora: Y, legacy: N, spreadsheet: N },
  { feature: 'Employee Self-Service (ESS) Portal',       emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Roster & shift intelligence',              emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Full payroll explainability',              emvora: Y, legacy: N, spreadsheet: N },
  { feature: 'Approval workflow engine',                 emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Leave accrual & collision engine',         emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Executive intelligence dashboards',        emvora: Y, legacy: N, spreadsheet: N },
  { feature: 'Document generation & e-sign',            emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Mobile-first experience',                  emvora: Y, legacy: P, spreadsheet: N },
  { feature: 'Setup time',                               emvora: 'Days', legacy: 'Months', spreadsheet: 'Never' },
]

function Cell({ val }: { val: string }) {
  if (val === Y) return <CheckCircle className="w-5 h-5 text-green-400 mx-auto" />
  if (val === N) return <XCircle    className="w-5 h-5 text-red-400/60 mx-auto" />
  if (val === P) return <Minus      className="w-5 h-5 text-amber-400/70 mx-auto" />
  return <span className="text-xs text-violet-300/70 font-semibold">{val}</span>
}

export default function Comparison() {
  return (
    <section id="compare" className="relative py-32 overflow-hidden">
      <div className="max-w-5xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-600/10 border border-violet-600/20 text-xs font-semibold text-violet-400 mb-4">
            Why Emvora
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
            Not just better. <span className="gradient-text">Fundamentally different.</span>
          </h2>
          <p className="text-violet-200/50 text-lg max-w-xl mx-auto">
            See how Emvora compares to legacy HRMS systems and spreadsheet-based management.
          </p>
        </div>

        {/* Table */}
        <div className="glass rounded-3xl overflow-hidden border border-violet-700/30">
          {/* Header row */}
          <div className="grid grid-cols-4 gap-0 border-b border-violet-700/30">
            <div className="p-5 text-xs font-semibold text-violet-400/50 uppercase tracking-wider">Feature</div>
            {[
              { label: 'Emvora',        sub: 'Workforce Intelligence', highlight: true  },
              { label: 'Legacy HRMS',   sub: 'Traditional systems',    highlight: false },
              { label: 'Spreadsheets',  sub: 'Manual management',      highlight: false },
            ].map(col => (
              <div key={col.label}
                className={`p-5 text-center ${col.highlight ? 'bg-violet-800/30 border-x border-violet-600/20' : ''}`}>
                <p className={`font-display font-bold text-sm ${col.highlight ? 'text-violet-300' : 'text-violet-400/50'}`}>{col.label}</p>
                <p className="text-[10px] text-violet-400/30 mt-0.5">{col.sub}</p>
              </div>
            ))}
          </div>

          {/* Data rows */}
          {rows.map((row, i) => (
            <div key={row.feature}
              className={`grid grid-cols-4 border-b border-violet-800/20 last:border-0 hover:bg-violet-900/10 transition-colors ${
                i % 2 === 0 ? '' : 'bg-violet-950/20'
              }`}>
              <div className="p-4 text-xs text-violet-200/60 flex items-center">{row.feature}</div>
              <div className={`p-4 flex items-center justify-center bg-violet-800/10 border-x border-violet-600/10`}>
                <Cell val={row.emvora} />
              </div>
              <div className="p-4 flex items-center justify-center">
                <Cell val={row.legacy} />
              </div>
              <div className="p-4 flex items-center justify-center">
                <Cell val={row.spreadsheet} />
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-5">
          {[
            { icon: <CheckCircle className="w-3.5 h-3.5 text-green-400" />, label: 'Full support' },
            { icon: <Minus       className="w-3.5 h-3.5 text-amber-400/70" />, label: 'Partial / add-on' },
            { icon: <XCircle     className="w-3.5 h-3.5 text-red-400/60" />, label: 'Not available' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs text-violet-400/40">
              {l.icon} {l.label}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
