const integrations = [
  { name: 'WhatsApp',  category: 'Communication', bg: '#25D366', text: 'white',  abbr: 'WA' },
  { name: 'Slack',     category: 'Communication', bg: '#4A154B', text: 'white',  abbr: 'SL' },
  { name: 'Teams',     category: 'Communication', bg: '#5059C9', text: 'white',  abbr: 'MS' },
  { name: 'Zoho',      category: 'ERP',           bg: '#E42527', text: 'white',  abbr: 'ZH' },
  { name: 'SAP',       category: 'ERP',           bg: '#0070F2', text: 'white',  abbr: 'SA' },
  { name: 'Tally',     category: 'Accounting',    bg: '#1A56DB', text: 'white',  abbr: 'TL' },
  { name: 'Razorpay',  category: 'Payments',      bg: '#2D81F7', text: 'white',  abbr: 'RP' },
  { name: 'DigiLocker', category: 'Government',   bg: '#F97316', text: 'white',  abbr: 'DL' },
  { name: 'EPFO',      category: 'Statutory',     bg: '#2F1F57', text: 'white',  abbr: 'EF' },
  { name: 'TRACES',    category: 'Statutory',     bg: '#059669', text: 'white',  abbr: 'TR' },
  { name: 'Darwinbox', category: 'HRMS',          bg: '#7C3AED', text: 'white',  abbr: 'DB' },
  { name: 'Naukri',    category: 'Recruitment',   bg: '#EF4444', text: 'white',  abbr: 'NK' },
]

export default function Integrations() {
  return (
    <section className="py-24 bg-[#F8F9FB]">
      <div className="max-w-7xl mx-auto px-6">

        {/* Header */}
        <div className="text-center mb-14">
          <p className="eyebrow mb-3">Integrations</p>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-[#1A1A2E] tracking-tight">
            Connects with your existing stack
          </h2>
          <p className="mt-4 text-slate-500 max-w-xl mx-auto text-lg">
            Native integrations with the tools Indian enterprises already use — communication, ERP, payouts, and statutory portals.
          </p>
        </div>

        {/* Integration grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4 mb-10">
          {integrations.map((i) => (
            <div
              key={i.name}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-250 p-4 flex flex-col items-center gap-2 text-center"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-black"
                style={{ background: i.bg, color: i.text }}
              >
                {i.abbr}
              </div>
              <p className="text-sm font-semibold text-[#1A1A2E]">{i.name}</p>
              <p className="text-[10px] text-slate-400">{i.category}</p>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <p className="text-center text-sm text-slate-400">
          + REST API & webhooks for custom integrations · Open SDK coming soon
        </p>
      </div>
    </section>
  )
}
