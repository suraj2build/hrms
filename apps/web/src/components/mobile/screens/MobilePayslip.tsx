import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, ChevronRight, FileText } from 'lucide-react'
import { api } from '@/lib/api/client'
import { glossy } from '../glossy'

interface SlipSummary { slip_id: string; month: string; gross_pay: number; net_pay: number }

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const monthLabel = (m: string) => {
  const d = new Date(m.length === 7 ? `${m}-01T12:00:00Z` : m)
  return isNaN(d.getTime()) ? m : d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

export function MobilePayslip({ base }: { base: string }) {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<{ data: SlipSummary[] }>({
    queryKey: ['mobile-payslips'],
    queryFn: () => api.get('/payroll/my-slips'),
  })

  const slips = data?.data ?? []
  const latest = slips[0]
  const ytdNet = slips.reduce((s, x) => s + (x.net_pay ?? 0), 0)
  const ytdGross = slips.reduce((s, x) => s + (x.gross_pay ?? 0), 0)

  return (
    <div className="space-y-3">
      {/* Net pay hero */}
      <div className="rounded-2xl bg-white p-5 text-center shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
        <p className="text-xs text-muted-foreground">Net pay · {latest ? monthLabel(latest.month) : '—'}</p>
        <p className="text-3xl font-extrabold tracking-tight text-[#0F172A]">{latest ? inr(latest.net_pay) : '—'}</p>
        {latest && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1A8050]">
            <TrendingUp className="h-3 w-3" /> Gross {inr(latest.gross_pay)}
          </p>
        )}
        <button
          onClick={() => navigate(`${base}/compensation`)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white"
          style={glossy('#7C3AED', '#A78BFA')}
        >
          <FileText className="h-4 w-4" /> View full breakdown
        </button>
      </div>

      {/* YTD summary */}
      {slips.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <span className="block h-1.5 w-6 rounded-full bg-[#1A8050]" />
            <p className="mt-2 text-base font-extrabold tracking-tight text-[#0F172A]">{inr(ytdNet)}</p>
            <p className="text-[10px] text-muted-foreground">Net paid (FY)</p>
          </div>
          <div className="rounded-2xl bg-white p-3.5 shadow-[0_2px_12px_-4px_rgba(26,77,143,0.12)]">
            <span className="block h-1.5 w-6 rounded-full bg-[#2E6FE6]" />
            <p className="mt-2 text-base font-extrabold tracking-tight text-[#0F172A]">{inr(ytdGross)}</p>
            <p className="text-[10px] text-muted-foreground">Gross (FY)</p>
          </div>
        </div>
      )}

      {/* Payslip history */}
      <p className="px-1 pt-1 text-xs font-bold text-[#0F172A]">Payslip history</p>
      <div className="space-y-2">
        {isLoading && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">Loading…</p>}
        {!isLoading && slips.length === 0 && <p className="rounded-xl bg-white px-3 py-4 text-center text-xs text-muted-foreground shadow-sm">No payslips yet.</p>}
        {slips.map((s) => (
          <button
            key={s.slip_id}
            onClick={() => navigate(`${base}/compensation`)}
            className="flex w-full items-center justify-between rounded-xl bg-white px-3 py-3 shadow-sm"
          >
            <div className="text-left">
              <p className="text-xs font-semibold text-foreground">{monthLabel(s.month)}</p>
              <p className="text-[10px] text-muted-foreground">Gross {inr(s.gross_pay)}</p>
            </div>
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-extrabold text-[#0F172A]">{inr(s.net_pay)}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
