/**
 * EssCompensation — /ess/compensation · /manager/self/compensation
 *
 * "My Compensation" total-rewards workspace (premium layout).
 *   Overview   — total-rewards / CTC composition hero, employment card, stat tiles
 *   Salary     — salary structure table + Rate vs Actuals month comparison
 *   Pay Slips  — finalized slips list, YTD summary, per-slip isolated print
 *   Bonuses    — incentive history (awaiting backend — honest empty state)
 *   Benefits   — perks & insurance (awaiting backend — honest empty state)
 *   Tax        — IT statement: regime, tax computation, TDS YTD (real)
 *   History    — compensation revision timeline + Gross vs Net trend chart
 *
 * Every figure is wired to live API data — no mock numbers. Tabs without a
 * backing endpoint show a clear "coming soon" state rather than fabricated data.
 * Design: design-system tokens only — no raw hex / bg-gray-*.
 */

import { useState, useEffect } from 'react'
import { Link }                         from 'react-router-dom'
import { useQuery }                     from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTip, ResponsiveContainer,
} from 'recharts'
import {
  DollarSign,
  Loader2, AlertCircle, FileText,
  TrendingUp,
  Printer, BarChart2,
  AlertTriangle,
  Receipt,
  Wallet, Gift, ShieldCheck, History as HistoryIcon,
  Building2, ArrowUpRight, PiggyBank,
} from 'lucide-react'
import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Button }         from '@/components/ui/button'
import { Badge }          from '@/components/ui/badge'
import {
  IntelligenceLoadingSkeleton,
} from '@/components/ui/intelligence/index.js'
import {
  getAxisStyle, getGridStyle, getTooltipStyle, getChartColor,
} from '@/components/ui/chart'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { cn, formatCurrency as fmtCurrency, fmtDate } from '@/lib/utils'
import { SubTabs }        from '@/components/ui/SubTabs'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SlipSummary {
  slip_id:           string
  month:             string
  gross_pay:         number
  lop_amount:        number
  total_deductions:  number
  net_pay:           number
  lop_days:          number
  payable_days:      number
  total_working_days: number
  overtime_hours:    number
  status:            'draft' | 'finalized' | 'held'
  held_reason:       string | null
  warning:           string | null
}

interface ComponentSnapshot {
  salary_component_id: string
  name:                string
  code:                string
  component_type:      'earning' | 'deduction' | 'employer_contribution'
  calc_type:           string
  value:               number
  monthly_amount:      number
  annual_amount:       number
  sequence:            number
}

interface SlipDetail extends SlipSummary {
  ctc_monthly:            number
  employer_contributions: number
  component_breakdown:    ComponentSnapshot[]
}

interface ActiveComp {
  id:             string
  ctc_annual:     number
  ctc_monthly:    number
  effective_from: string
  salary_structures?: { name: string }
  employee_compensation_components?: CompComponent[]
}

interface CompComponent {
  id:               string
  computed_monthly: number
  computed_annual:  number
  sequence:         number
  salary_components?: {
    name:           string
    code:           string
    component_type: 'earning' | 'deduction' | 'employer_contribution'
    is_taxable:     boolean
  }
}

interface CompRevision {
  id:                string
  revision_type:     string
  status:            'pending' | 'approved' | 'rejected' | 'withdrawn'
  effective_date:    string
  before_ctc_annual: number | null
  new_ctc_annual:    number
  delta_pct:         number | null
  notes:             string | null
  created_at:        string
}

interface TrendRow {
  month:     string
  gross_pay: number
  net_pay:   number
}

// Employment identity — from /employees/:id/full-profile
interface FullProfile {
  employee: {
    first_name:    string
    last_name:     string
    employee_code: string
    joining_date:  string | null
  }
  job_info: {
    employment_type: string
    effective_from:  string
    departments:     { name: string } | null
    designations:    { name: string } | null
    work_locations:  { name: string; city: string } | null
    manager:         { first_name: string; last_name: string; employee_code: string } | null
  } | null
  bank_statutory: {
    bank_name:             string | null
    account_number_masked: string | null
    ifsc:                  string | null
    pan:                   string | null
    uan:                   string | null
    pf_number:             string | null
    esi_number:            string | null
  } | null
}

// Tax computation — from /payroll/statutory/tds/it-statement/my
interface ITStatement {
  financial_year:      string
  regime:              'old' | 'new'
  gross_salary:        number
  taxable_income:      number
  total_tax_payable:   number
  tds_by_employer_ytd: number
  balance_tax_payable: number
  monthly_recovery:    number
  remaining_months:    number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const REV_STATUS_BADGE: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'destructive',
  withdrawn: 'secondary',
}

const REV_TYPE_LABEL: Record<string, string> = {
  increment:   'Increment',
  promotion:   'Promotion',
  revision:    'Revision',
  correction:  'Correction',
  restructure: 'Restructure',
  retro:       'Retro',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Full Indian currency (₹12,00,000). Was compact (K/L) — switched to full per
 *  UAT feedback so salary-structure rates and totals read in plain rupees. */
function fmtCompact(n: number | null | undefined): string {
  if (n == null) return '—'
  return fmtCurrency(n)
}

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('default', {
    month: 'long', year: 'numeric',
  })
}

function fmtMonthShort(m: string): string {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-IN', {
    month: 'short', year: '2-digit',
  })
}

// ── Print utility — isolates one slip to print ─────────────────────────────────

function printSlip(slipId: string) {
  const existing = document.getElementById('__slip-print-style')
  existing?.remove()

  const style = document.createElement('style')
  style.id = '__slip-print-style'
  style.textContent = `
    @media print {
      body * { visibility: hidden !important; }
      #slip-print-${slipId},
      #slip-print-${slipId} * { visibility: visible !important; }
      #slip-print-${slipId} {
        position: fixed !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important;
        background: white !important;
        padding: 24px !important;
        box-sizing: border-box !important;
      }
    }
  `
  document.head.appendChild(style)
  window.addEventListener('afterprint', () => style.remove(), { once: true })
  window.print()
}

// ── PayslipDocument — print-ready Indian payslip layout ─────────────────────────
// Rendered off-screen and isolated for printing. Standard format: employee
// summary + net-pay highlight, statutory IDs, two-column earnings/deductions
// (with annualised column), and a Total Net Payable band.

function payslipDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`
}

function PayslipDocument({ slip, profile, bank }: {
  slip:    SlipDetail
  profile?: FullProfile
  bank?:   FullProfile['bank_statutory']
}) {
  const emp = profile?.employee
  const job = profile?.job_info

  // Earnings = actual (prorated) earning lines. Deductions = statutory only
  // (LOP is already reflected in reduced earnings, never shown as a line).
  const earnings   = slip.component_breakdown.filter(c => c.component_type === 'earning')
  const deductions = slip.component_breakdown.filter(c =>
    c.component_type === 'deduction' &&
    !['LOP', 'LOSS_OF_PAY'].includes(String(c.code ?? '').toUpperCase()))

  const grossEarnings   = slip.gross_pay
  const totalDeductions = Math.max(0, slip.total_deductions - slip.lop_amount)
  const rows            = Math.max(earnings.length, deductions.length)

  const labelCls = { color: '#6b7280' }   // muted

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: '#111827', background: '#fff', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}>
      {/* Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 12, marginBottom: 16, borderBottom: '2px solid #111827' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Pay Slip</h1>
          <p style={{ fontSize: 12, margin: '2px 0 0', ...labelCls }}>For the month of {fmtMonth(slip.month)}</p>
        </div>
        <p style={{ fontSize: 11, ...labelCls }}>
          Generated {(() => { const d=new Date(); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })()}
        </p>
      </div>

      {/* Employee summary + Net pay card */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', margin: '0 0 10px', ...labelCls }}>EMPLOYEE SUMMARY</p>
          <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Employee Name', emp ? `${emp.first_name} ${emp.last_name}` : '—'],
                ['Designation',   job?.designations?.name ?? '—'],
                ['Employee ID',   emp?.employee_code ?? '—'],
                ['Date of Joining', payslipDate(emp?.joining_date)],
                ['Pay Period',    fmtMonth(slip.month)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '3px 0', ...labelCls }}>{k}</td>
                  <td style={{ padding: '3px 12px', ...labelCls }}>:</td>
                  <td style={{ padding: '3px 0', fontWeight: 600 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Net pay highlight */}
        <div style={{ width: 280, border: '1px solid #d1fae5', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: '#ecfdf5', padding: '16px 18px', borderLeft: '4px solid #10b981' }}>
            <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#065f46' }}>{fmtCurrency(slip.net_pay)}</p>
            <p style={{ fontSize: 13, margin: '2px 0 0', color: '#059669' }}>Employee Net Pay</p>
          </div>
          <div style={{ padding: '12px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span style={labelCls}>Paid Days</span><span style={{ fontWeight: 600 }}>: {slip.payable_days}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span style={labelCls}>LOP Days</span><span style={{ fontWeight: 600 }}>: {slip.lop_days}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Statutory IDs */}
      {(bank?.pf_number || bank?.uan) && (
        <div style={{ display: 'flex', gap: 48, fontSize: 13, padding: '14px 0', margin: '16px 0', borderTop: '1px dashed #d1d5db', borderBottom: '1px dashed #d1d5db' }}>
          <div><span style={labelCls}>PF A/C Number :&nbsp;</span><span style={{ fontWeight: 600 }}>{bank?.pf_number ?? '—'}</span></div>
          <div><span style={labelCls}>UAN :&nbsp;</span><span style={{ fontWeight: 600 }}>{bank?.uan ?? '—'}</span></div>
        </div>
      )}

      {/* Earnings / Deductions */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8, border: '1px solid #e5e7eb' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left',  padding: '10px 14px', ...labelCls, fontWeight: 600 }}>EARNINGS</th>
            <th style={{ textAlign: 'right', padding: '10px 14px', ...labelCls, fontWeight: 600 }}>AMOUNT</th>
            <th style={{ textAlign: 'right', padding: '10px 14px', ...labelCls, fontWeight: 600 }}>ANNUAL</th>
            <th style={{ textAlign: 'left',  padding: '10px 14px', ...labelCls, fontWeight: 600, borderLeft: '1px solid #e5e7eb' }}>DEDUCTIONS</th>
            <th style={{ textAlign: 'right', padding: '10px 14px', ...labelCls, fontWeight: 600 }}>AMOUNT</th>
            <th style={{ textAlign: 'right', padding: '10px 14px', ...labelCls, fontWeight: 600 }}>ANNUAL</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => {
            const e = earnings[i]
            const d = deductions[i]
            return (
              <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '9px 14px' }}>{e?.name ?? ''}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600 }}>{e ? fmtCurrency(e.monthly_amount) : ''}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', ...labelCls }}>{e ? fmtCurrency(e.annual_amount) : ''}</td>
                <td style={{ padding: '9px 14px', borderLeft: '1px solid #e5e7eb' }}>{d?.name ?? ''}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600 }}>{d ? fmtCurrency(d.monthly_amount) : ''}</td>
                <td style={{ padding: '9px 14px', textAlign: 'right', ...labelCls }}>{d ? fmtCurrency(d.annual_amount) : ''}</td>
              </tr>
            )
          })}
          {/* Totals */}
          <tr style={{ background: '#f9fafb', fontWeight: 700, borderTop: '1px solid #e5e7eb' }}>
            <td style={{ padding: '11px 14px' }}>Gross Earnings</td>
            <td style={{ padding: '11px 14px', textAlign: 'right' }}>{fmtCurrency(grossEarnings)}</td>
            <td style={{ padding: '11px 14px' }} />
            <td style={{ padding: '11px 14px', borderLeft: '1px solid #e5e7eb' }}>Total Deductions</td>
            <td style={{ padding: '11px 14px', textAlign: 'right' }}>{fmtCurrency(totalDeductions)}</td>
            <td style={{ padding: '11px 14px' }} />
          </tr>
        </tbody>
      </table>

      {/* Net payable band */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, padding: '16px 20px', border: '1px solid #d1fae5', borderRadius: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>TOTAL NET PAYABLE</p>
          <p style={{ fontSize: 12, margin: '2px 0 0', ...labelCls }}>Gross Earnings − Total Deductions</p>
        </div>
        <p style={{ fontSize: 22, fontWeight: 700, margin: 0, padding: '6px 16px', background: '#ecfdf5', borderRadius: 8, color: '#065f46' }}>
          {fmtCurrency(slip.net_pay)}
        </p>
      </div>

      {/* Footnotes */}
      {(slip.lop_days > 0 || slip.overtime_hours > 0) && (
        <p style={{ fontSize: 11, marginTop: 12, ...labelCls }}>
          {slip.lop_days > 0 && `${slip.lop_days} LOP day(s) of ${slip.total_working_days} working days — earnings shown are prorated to paid days. `}
          {slip.overtime_hours > 0 && `Overtime: ${slip.overtime_hours}h. `}
        </p>
      )}
      <p style={{ fontSize: 10, marginTop: 10, color: '#9ca3af' }}>
        This is a computer-generated pay slip and does not require a signature.
      </p>
    </div>
  )
}

// ── PrintableSlip — off-screen payslip render used for print-on-demand ──────────
// The flat Pay Slips table has no inline expansion; clicking a row's PDF action
// mounts this off-screen, waits for the slip detail to load, then prints just it.

function PrintableSlip({
  slip, profile, bank, onDone,
}: {
  slip:    SlipSummary
  profile?: FullProfile
  bank?:   FullProfile['bank_statutory']
  onDone:  () => void
}) {
  const { data, isSuccess, isError } = useQuery<{ data: SlipDetail }>({
    queryKey:  ['my-slip-detail', slip.slip_id],
    queryFn:   () => api.get(`/payroll/slips/${slip.slip_id}`),
    staleTime: 300_000,
  })

  useEffect(() => {
    if (isError) { onDone(); return }
    if (isSuccess) {
      // Allow the payslip to paint from cache before printing.
      const tid = setTimeout(() => { printSlip(slip.slip_id); onDone() }, 250)
      return () => clearTimeout(tid)
    }
  }, [isSuccess, isError, slip.slip_id, onDone])

  return (
    <div className="fixed -left-[9999px] top-0 w-[820px]" aria-hidden>
      <div id={`slip-print-${slip.slip_id}`} style={{ padding: 8 }}>
        {data?.data && <PayslipDocument slip={data.data} profile={profile} bank={bank} />}
      </div>
    </div>
  )
}

// ── YTDSummary ─────────────────────────────────────────────────────────────────

function YTDSummary({ slips }: { slips: SlipSummary[] }) {
  const now     = new Date()
  const fyYear  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const fyStart = `${fyYear}-04`
  const fyEnd   = `${fyYear + 1}-03`
  const fySlips = slips.filter(s => s.month >= fyStart && s.month <= fyEnd)
  if (fySlips.length === 0) return null

  const ytdGross      = fySlips.reduce((s, r) => s + (r.gross_pay ?? 0),        0)
  const ytdNet        = fySlips.reduce((s, r) => s + (r.net_pay ?? 0),          0)
  const ytdDeductions = fySlips.reduce((s, r) => s + (r.total_deductions ?? 0), 0)
  const ytdLop        = fySlips.reduce((s, r) => s + (r.lop_amount ?? 0),       0)
  const ytdOt         = fySlips.reduce((s, r) => s + (r.overtime_hours ?? 0),   0)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Year-to-Date Summary</p>
        <span className="text-xs text-muted-foreground ml-1">FY {fyYear}–{fyYear + 1} · {fySlips.length} months</span>
      </div>
      <MetricRow cols={5}>
        <MetricCard label="YTD Gross"      value={fmtCurrency(ytdGross)}      variant="neutral" compact />
        <MetricCard label="YTD Net"        value={fmtCurrency(ytdNet)}        variant="success" compact />
        <MetricCard label="YTD Deductions" value={fmtCurrency(ytdDeductions)} variant="destructive" compact />
        <MetricCard label="YTD LOP"        value={fmtCurrency(ytdLop)}        variant={ytdLop > 0 ? 'warning' : 'neutral'} compact />
        <MetricCard label="YTD OT Hours"   value={`${ytdOt.toFixed(1)}h`}     variant="neutral" compact />
      </MetricRow>
    </div>
  )
}

// ── RevisionTimeline ───────────────────────────────────────────────────────────

function RevisionTimeline({ revisions }: { revisions: CompRevision[] }) {
  if (revisions.length === 0) return (
    <p className="text-xs text-muted-foreground py-6 text-center">No compensation revisions on record.</p>
  )

  return (
    <div className="relative pl-5">
      {/* Vertical line */}
      <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />

      <div className="space-y-3">
        {revisions.map(rev => (
          <div key={rev.id} className="relative">
            {/* Timeline dot */}
            <div className={cn(
              'absolute -left-[14px] top-2 w-2.5 h-2.5 rounded-full border-2 border-background ring-2',
              rev.status === 'approved'  ? 'bg-success ring-success/30' :
              rev.status === 'rejected'  ? 'bg-destructive ring-destructive/30' :
              rev.status === 'pending'   ? 'bg-warning ring-warning/30' :
              'bg-muted-foreground/40 ring-muted/30',
            )} />

            <div className="rounded-lg border border-border bg-card px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">
                  {REV_TYPE_LABEL[rev.revision_type] ?? rev.revision_type}
                </span>
                <Badge variant={REV_STATUS_BADGE[rev.status]} className="rounded-full text-[9px]">
                  {rev.status}
                </Badge>
                <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                  Eff. {fmtDate(rev.effective_date)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className="text-muted-foreground font-mono">
                  {fmtCompact(rev.before_ctc_annual)} → {fmtCompact(rev.new_ctc_annual)}
                </span>
                {rev.delta_pct != null && (
                  <span className={cn('font-semibold', rev.delta_pct >= 0 ? 'text-success' : 'text-destructive')}>
                    {rev.delta_pct > 0 ? '+' : ''}{rev.delta_pct.toFixed(1)}%
                  </span>
                )}
              </div>
              {rev.notes && (
                <p className="text-[10px] text-muted-foreground mt-0.5 italic">{rev.notes}</p>
              )}
              <p className="text-[9px] text-muted-foreground/50 mt-1">Initiated {fmtDate(rev.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EmploymentCard — identity details (Overview side rail) ──────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  )
}

function EmploymentCard({ profile, comp }: { profile?: FullProfile; comp?: ActiveComp }) {
  const emp = profile?.employee
  const job = profile?.job_info
  const mgr = job?.manager
  return (
    <SectionCard title="Employment" icon={<Building2 className="h-4 w-4 text-muted-foreground" />}>
      <div className="space-y-2.5 text-sm">
        <DetailRow label="Employee ID"  value={emp?.employee_code ?? '—'} />
        <DetailRow label="Designation"  value={job?.designations?.name ?? '—'} />
        <DetailRow label="Department"   value={job?.departments?.name ?? '—'} />
        <DetailRow label="Reporting to" value={mgr ? `${mgr.first_name} ${mgr.last_name}` : '—'} />
        <DetailRow label="Location"     value={job?.work_locations?.name ?? '—'} />
        <DetailRow label="Date of joining" value={emp?.joining_date ? fmtDate(emp.joining_date) : '—'} />
        {comp?.salary_structures?.name && (
          <DetailRow label="Salary structure" value={comp.salary_structures.name} />
        )}
        {comp?.effective_from && (
          <DetailRow label="CTC effective" value={fmtDate(comp.effective_from)} />
        )}
      </div>
    </SectionCard>
  )
}

// ── MyBonusesTab — variable pay awards (P5.1) ────────────────────────────────────
// Read-only projection of the employee's OWN approved variable pay awards. Reuses
// the existing variable pay engine via the self-scoped /payroll/variable-pay/my.

interface BonusAward {
  id:                 string
  amount:             number
  status:             string
  performance_period: string | null
  performance_notes:  string | null
  award_name:         string
  award_type:         string
  is_taxable:         boolean
  batch_name:         string | null
  payout_month:       string | null
  approved_at:        string | null
}

// Keyed on incentive_templates.template_type's real DB values (migration
// 102) — award_type echoes that column directly, so a label dict keyed on
// anything else silently falls through to the 'Variable Pay' default below.
const BONUS_TYPE_LABEL: Record<string, string> = {
  performance: 'Performance Bonus',
  sales:       'Sales Incentive',
  referral:    'Referral Bonus',
  spot_award:  'Spot Award',
  project:     'Project Completion',
  quarterly:   'Quarterly Bonus',
  annual:      'Annual Bonus',
  festival:    'Festival Bonus',
  retention:   'Retention Bonus',
  other:       'Variable Pay',
}

function MyBonusesTab({ awards, total, loading }: { awards: BonusAward[]; total: number; loading: boolean }) {
  if (loading) {
    return <SectionCard><IntelligenceLoadingSkeleton rows={4} /></SectionCard>
  }
  if (awards.length === 0) {
    return (
      <SectionCard>
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <div className="rounded-2xl bg-muted/60 p-4"><Gift className="h-8 w-8 text-muted-foreground/70" /></div>
          <p className="text-sm font-semibold text-foreground">No variable pay awards yet</p>
          <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">
            Performance bonuses, incentives and referral awards will appear here once
            HR publishes an approved payout for you.
          </p>
        </div>
      </SectionCard>
    )
  }
  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center justify-between gap-4 px-1 py-1">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5"><Gift className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total awarded (approved)</p>
              <p className="text-xl font-semibold tabular-nums text-foreground">{fmtCurrency(total)}</p>
            </div>
          </div>
          <Badge variant="secondary" className="rounded-full text-[11px]">{awards.length} award{awards.length === 1 ? '' : 's'}</Badge>
        </div>
      </SectionCard>

      <SectionCard title="Incentives & Bonuses" icon={<Gift className="h-4 w-4 text-muted-foreground" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Award</th>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-left font-medium">Pay month</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {awards.map(a => (
                <tr key={a.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-foreground">{a.award_name}</span>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="rounded-full text-[9px]">{BONUS_TYPE_LABEL[a.award_type] ?? 'Variable Pay'}</Badge>
                      {a.is_taxable && <Badge variant="outline" className="rounded-full text-[9px]">Taxable</Badge>}
                    </div>
                    {a.performance_notes && <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{a.performance_notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{a.performance_period ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{a.payout_month ? fmtMonth(a.payout_month) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">{fmtCurrency(a.amount)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="success" className="rounded-full text-[10px] capitalize">{a.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 px-1 text-[11px] text-muted-foreground">
          Only approved awards are shown. Taxable awards are included in your TDS computation under the Tax tab.
        </p>
      </SectionCard>
    </div>
  )
}

// ── MyBenefitsTab — benefits enrolment summary (P5.2) ────────────────────────────
// Reuses the existing /benefits APIs and links to the full enrolment experience at
// /ess/benefits. No duplicate enrolment screen.

interface BenefitPlanLite {
  id: string; name: string; plan_type: string; provider: string | null
  coverage_amount: number; employee_cost: number; employer_cost: number
  allows_dependents: boolean; is_open: boolean
}
interface BenefitEnrollLite {
  id: string; plan_id: string; status: 'enrolled' | 'waived'; dependent_ids: string[]
}

function MyBenefitsTab({ plans, enrollments, loading }: {
  plans: BenefitPlanLite[]; enrollments: BenefitEnrollLite[]; loading: boolean
}) {
  if (loading) {
    return <SectionCard><IntelligenceLoadingSkeleton rows={4} /></SectionCard>
  }
  const enrollByPlan = new Map(enrollments.map(e => [e.plan_id, e]))
  const enrolledCount = enrollments.filter(e => e.status === 'enrolled').length
  const planById = new Map(plans.map(p => [p.id, p]))
  const myCostYr = enrollments
    .filter(e => e.status === 'enrolled')
    .reduce((s, e) => s + (planById.get(e.plan_id)?.employee_cost ?? 0), 0)

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-center justify-between gap-4 px-1 py-1">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-success/10 p-2.5"><ShieldCheck className="h-5 w-5 text-success" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Active enrolments</p>
              <p className="text-xl font-semibold tabular-nums text-foreground">{enrolledCount}
                <span className="ml-1 text-xs font-normal text-muted-foreground">of {plans.length} plans</span></p>
            </div>
          </div>
          {myCostYr > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Your contribution / yr</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{fmtCurrency(myCostYr)}</p>
            </div>
          )}
          <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1.5">
            <Link to="/ess/benefits"><ShieldCheck className="h-3.5 w-3.5" />Manage benefits</Link>
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="My Benefit Plans" icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}>
        {plans.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No benefit plans have been published for your organisation yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map(plan => {
              const mine = enrollByPlan.get(plan.id)
              return (
                <div key={plan.id} className="flex flex-col rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                    {mine
                      ? <Badge variant={mine.status === 'enrolled' ? 'success' : 'secondary'} className="text-[10px] capitalize">{mine.status}</Badge>
                      : !plan.is_open ? <Badge variant="outline" className="text-[10px]">Closed</Badge>
                      : <Badge variant="outline" className="text-[10px]">Not enrolled</Badge>}
                  </div>
                  {plan.provider && <p className="text-[11px] text-muted-foreground">{plan.provider}</p>}
                  <div className="mt-3 space-y-1 text-xs">
                    {plan.coverage_amount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Cover</span>
                        <span className="font-medium">{fmtCurrency(plan.coverage_amount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Your cost / yr</span>
                      <span className="font-medium">{plan.employee_cost > 0 ? fmtCurrency(plan.employee_cost) : 'Free'}</span>
                    </div>
                    {mine?.status === 'enrolled' && plan.allows_dependents && (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <PiggyBank className="h-3 w-3" /> {mine.dependent_ids.length} dependent{mine.dependent_ids.length === 1 ? '' : 's'} covered
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 px-1 text-[11px] text-muted-foreground">
          Enrol, waive or update dependent coverage from the full benefits page.
        </p>
      </SectionCard>
    </div>
  )
}

// ── SalaryGroup — labelled component rows for the Salary structure table ─────────

function SalaryGroup({ label, items }: { label: string; items: CompComponent[] }) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={3} className="px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </td>
      </tr>
      {[...items].sort((a, b) => a.sequence - b.sequence).map(c => (
        <tr key={c.id} className="border-b border-border/40 last:border-0">
          <td className="px-5 py-2.5">
            <span className="font-medium text-foreground">{c.salary_components?.name}</span>
            {c.salary_components?.is_taxable && (
              <Badge className="ml-2 rounded-full text-[9px]" variant="outline">Taxable</Badge>
            )}
          </td>
          <td className="px-5 py-2.5 text-right tabular-nums">{fmtCurrency(c.computed_monthly)}</td>
          <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{fmtCurrency(c.computed_annual || c.computed_monthly * 12)}</td>
        </tr>
      ))}
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type Tab = 'overview' | 'salary' | 'payslips' | 'bonuses' | 'benefits' | 'tax' | 'history'

export function EssCompensation() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? ''

  const axisStyle    = getAxisStyle()
  const gridStyle    = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('overview')

  // ── Slip queued for print (Pay Slips flat table) ──────────────────────────
  const [printSlipId, setPrintSlipId] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  // All finalized slips (used by Pay Slips tab + month selector)
  const { data: slipsData, isLoading: slipsLoading, isFetching: slipsFetching,
          isError: slipsError, refetch: refetchSlips } =
    useQuery<{ data: SlipSummary[] }>({
      queryKey:  ['my-payslips'],
      queryFn:   () => api.get('/payroll/my-slips'),
      staleTime: 120_000,
    })

  const slips = slipsData?.data ?? []

  // Active compensation (CTC structure) — always loaded
  // Active compensation with its raw component breakdown (incl. employer
  // contributions + nested salary_components). This endpoint returns the active
  // record(s) with employee_compensation_components — the shape this tab renders.
  const { data: compData, isLoading: compLoading, isError: compError } = useQuery<{ data: ActiveComp[] }>({
    queryKey:  ['ess-comp-active', employeeId],
    queryFn:   () => api.get(`/payroll/compensation/employee/${employeeId}`),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Gross vs Net trend chart
  const { data: trendData } = useQuery<{ data: TrendRow[] }>({
    queryKey:  ['ess-payslip-trend', employeeId],
    queryFn:   () => api.get('/payroll/slips/trend?months=6'),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Employment identity — for the Overview employment card + header subtitle
  const { data: profileData } = useQuery<FullProfile>({
    queryKey:  ['ess-comp-full-profile', employeeId],
    queryFn:   () => api.get(`/employees/${employeeId}/full-profile`),
    enabled:   !!employeeId,
    staleTime: 300_000,
  })

  // Revision history — lazy, only when History tab is first visited
  const [revVisited, setRevVisited] = useState(false)
  useEffect(() => { if (tab === 'history') setRevVisited(true) }, [tab])
  const { data: revData, isLoading: revLoading } = useQuery<{ data: CompRevision[] }>({
    queryKey:  ['ess-comp-revisions', employeeId],
    queryFn:   () => api.get(`/compensation/revisions/employee/${employeeId}`),
    enabled:   !!employeeId && revVisited,
    staleTime: 120_000,
  })

  // Variable pay awards (bonuses) — lazy, only when Bonuses tab is first visited (P5.1)
  const [bonusVisited, setBonusVisited] = useState(false)
  useEffect(() => { if (tab === 'bonuses') setBonusVisited(true) }, [tab])
  const { data: bonusData, isLoading: bonusLoading } = useQuery<{ data: BonusAward[]; total_awarded: number }>({
    queryKey:  ['ess-variable-pay-my', employeeId],
    queryFn:   () => api.get('/payroll/variable-pay/my'),
    enabled:   !!employeeId && bonusVisited,
    staleTime: 120_000,
  })

  // Benefits — lazy, only when Benefits tab is first visited (P5.2)
  const [benefitsVisited, setBenefitsVisited] = useState(false)
  useEffect(() => { if (tab === 'benefits') setBenefitsVisited(true) }, [tab])
  const { data: benPlansData, isLoading: benPlansLoading } = useQuery<{ data: BenefitPlanLite[] }>({
    queryKey:  ['ess-benefit-plans'],
    queryFn:   () => api.get('/benefits/plans'),
    enabled:   benefitsVisited,
    staleTime: 120_000,
  })
  const { data: benMyData, isLoading: benMyLoading } = useQuery<{ data: BenefitEnrollLite[] }>({
    queryKey:  ['ess-benefit-my'],
    queryFn:   () => api.get('/benefits/my'),
    enabled:   benefitsVisited,
    staleTime: 120_000,
  })

  // IT statement (tax) — lazy, only when Tax tab is first visited
  const [taxVisited, setTaxVisited] = useState(false)
  useEffect(() => { if (tab === 'tax') setTaxVisited(true) }, [tab])
  const { data: taxData, isLoading: taxLoading, isError: taxError } = useQuery<ITStatement | null>({
    queryKey:  ['ess-comp-it-statement', employeeId],
    queryFn:   async () => {
      const res = await api.get<ITStatement>('/payroll/statutory/tds/it-statement/my')
      return res ?? null
    },
    enabled:   !!employeeId && taxVisited,
    staleTime: 300_000,
  })

  // ── Derived ────────────────────────────────────────────────────────────────

  // Endpoint returns active record(s) — take the most recent active one.
  const comp       = Array.isArray(compData?.data) ? compData!.data[0] : (compData?.data as ActiveComp | undefined)
  const bank       = profileData?.bank_statutory ?? undefined
  const revisions  = revData?.data ?? []
  const components  = comp?.employee_compensation_components ?? []
  const earnings    = components.filter(c => c.salary_components?.component_type === 'earning')
  const empContribs = components.filter(c => c.salary_components?.component_type === 'employer_contribution')
  const sumMonthly  = (arr: typeof components) => arr.reduce((s, c) => s + (c.computed_monthly ?? 0), 0)
  const grossMonthly    = sumMonthly(earnings)
  const employerMonthly = sumMonthly(empContribs)
  const ctcMonthlyCalc  = Math.round((grossMonthly + employerMonthly) * 100) / 100

  const chartData = (trendData?.data ?? []).map(s => ({
    month: fmtMonthShort(s.month),
    Gross: Math.round(s.gross_pay / 1000),
    Net:   Math.round(s.net_pay   / 1000),
  }))

  const latest = slips[0]

  // Net take-home for the salary-structure card. The master structure has no
  // employee statutory lines (PF/ESI/PT/LWF/TDS), so they must come from the latest
  // finalized payslip. Use the full-rate statutory (total_deductions minus LOP,
  // since LOP is a paid-day reduction, not a standing deduction). Null until there's
  // a payslip — we never show net = gross (which would be wrong).
  const estEmpDeductions = latest
    ? Math.max(0, Math.round(((latest.total_deductions ?? 0) - (latest.lop_amount ?? 0)) * 100) / 100)
    : null
  // Only trust the payslip-derived deduction when it is consistent with the
  // current structure's standing gross. A finalized payslip can carry one-off,
  // non-standing items (TDS recovery, arrears, prior-period recoveries) that
  // exceed the standing monthly gross — subtracting those would produce a
  // nonsensical negative "take-home". In that case we fall back to the real
  // payslip net pay (tile) and the gross-vs-employer split (composition bar).
  const deductionsConsistent =
    estEmpDeductions != null && grossMonthly > 0 && estEmpDeductions <= grossMonthly
  const netMonthly = deductionsConsistent
    ? Math.round((grossMonthly - (estEmpDeductions as number)) * 100) / 100
    : null

  const annualCtc = ctcMonthlyCalc > 0 ? ctcMonthlyCalc * 12 : (comp?.ctc_annual ?? 0)

  // CTC composition for the Overview rewards bar. When a payslip exists we can
  // split the gross into take-home vs employee statutory deductions; otherwise we
  // show the gross-vs-employer split. All figures are real — no estimates beyond
  // the statutory deductions already sourced from the latest finalized slip.
  const rewardSegments = (netMonthly != null && estEmpDeductions != null
    ? [
        { label: 'Net take-home',          monthly: netMonthly,        color: 'bg-primary'   },
        { label: 'Employee deductions',    monthly: estEmpDeductions,  color: 'bg-warning'   },
        { label: 'Employer contributions', monthly: employerMonthly,   color: 'bg-success'   },
      ]
    : [
        { label: 'Gross earnings',         monthly: grossMonthly,      color: 'bg-primary'   },
        { label: 'Employer contributions', monthly: employerMonthly,   color: 'bg-success'   },
      ]
  ).filter(s => s.monthly > 0)
  const rewardTotal = rewardSegments.reduce((s, r) => s + r.monthly, 0)

  // YoY uplift — only shown when we have a real approved revision delta on record.
  const latestDelta = (revData?.data ?? []).find(r => r.status === 'approved' && r.delta_pct != null)?.delta_pct ?? null

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="Pay & Compensation" subtitle="Your pay slips, salary structure and revision history" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const headerName = profileData?.employee
    ? `${profileData.employee.first_name} ${profileData.employee.last_name}`
    : (profile?.full_name ?? 'My Compensation')
  const headerMeta = [
    profileData?.job_info?.designations?.name,
    profileData?.job_info?.departments?.name,
  ].filter(Boolean).join(' · ')

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Self' }, { label: 'Compensation' }]}
        title="My Compensation"
        subtitle={headerMeta ? `${headerName} · ${headerMeta}` : headerName}
        actions={
          tab === 'payslips' ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />Print / PDF
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => refetchSlips()} disabled={slipsFetching}>
                {slipsFetching
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <DollarSign className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* ── Tab switcher — underline tabs, horizontally scrollable ───────────── */}
      <SubTabs<typeof tab>
        tabs={[
          { id: 'overview', label: 'Overview',             icon: BarChart2   },
          { id: 'salary',   label: 'Salary',               icon: Wallet      },
          { id: 'payslips', label: 'Pay Slips',            icon: FileText    },
          { id: 'bonuses',  label: 'Bonuses & Incentives', icon: Gift        },
          { id: 'benefits', label: 'Benefits',             icon: ShieldCheck },
          { id: 'tax',      label: 'Tax',                  icon: Building2    },
          { id: 'history',  label: 'History',              icon: HistoryIcon },
        ]}
        value={tab}
        onChange={setTab}
        className="-mx-1"
      />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Total rewards / CTC composition hero */}
          <div className="lg:col-span-2 overflow-hidden rounded-xl border border-border bg-card">
            <div className="bg-primary px-6 py-5 text-primary-foreground">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-primary-foreground/70">Total annual CTC</p>
                  <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
                    {compLoading ? '…' : fmtCurrency(annualCtc)}
                  </p>
                  {comp?.salary_structures?.name && (
                    <p className="mt-1 text-xs text-primary-foreground/70">{comp.salary_structures.name}</p>
                  )}
                </div>
                {latestDelta != null && (
                  <Badge className="gap-1 rounded-full bg-success text-success-foreground hover:bg-success">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {latestDelta > 0 ? '+' : ''}{latestDelta.toFixed(1)}% last revision
                  </Badge>
                )}
              </div>
            </div>
            <div className="p-6">
              {rewardTotal > 0 ? (
                <>
                  <div className="mb-5 flex h-3 w-full overflow-hidden rounded-full bg-muted">
                    {rewardSegments.map(s => (
                      <div key={s.label} className={s.color}
                        style={{ width: `${(s.monthly / rewardTotal) * 100}%` }} />
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {rewardSegments.map(s => (
                      <div key={s.label} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="flex items-center gap-2.5">
                          <span className={cn('h-2.5 w-2.5 rounded-full', s.color)} />
                          <div>
                            <p className="text-sm font-medium text-foreground">{s.label}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {Math.round((s.monthly / rewardTotal) * 100)}% · {fmtCurrency(s.monthly)}/mo
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtCurrency(s.monthly * 12)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {netMonthly != null
                      ? 'Composition reflects take-home, statutory deductions and employer contributions that make up your CTC.'
                      : latest
                        ? 'Showing gross earnings vs employer contributions. A detailed take-home split is shown once a payslip’s standing deductions align with your current structure.'
                        : 'Net take-home split appears once your first payslip is finalized.'}
                  </p>
                </>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No active compensation on record. Contact HR.
                </p>
              )}
            </div>
          </div>

          {/* Employment identity */}
          <EmploymentCard profile={profileData} comp={comp} />

          {/* Stat tiles */}
          <div className="lg:col-span-3">
            <MetricRow cols={3}>
              <MetricCard
                icon={Wallet}
                label="Monthly take-home"
                value={netMonthly != null ? fmtCurrency(netMonthly) : (latest ? fmtCurrency(latest.net_pay) : '—')}
                subtitle={latest ? `${fmtMonthShort(latest.month)} payslip` : 'After first payslip'}
                variant="success"
              />
              <MetricCard
                icon={DollarSign}
                label="Monthly CTC"
                value={ctcMonthlyCalc > 0 ? fmtCurrency(ctcMonthlyCalc) : (comp?.ctc_monthly ? fmtCurrency(comp.ctc_monthly) : '—')}
                subtitle="Gross + employer contributions"
                variant="info"
              />
              <MetricCard
                icon={PiggyBank}
                label="Employer contributions"
                value={employerMonthly > 0 ? fmtCurrency(employerMonthly) : '—'}
                subtitle="Added to CTC · not deducted"
                variant="neutral"
              />
            </MetricRow>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: PAY SLIPS                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'payslips' && (
        <>
          {/* YTD Summary strip */}
          {slips.length > 0 && <YTDSummary slips={slips} />}

          {/* Pay slips — flat table */}
          <SectionCard
            title="Pay slips"
            description={slips.length > 0 ? `${slips.length} finalized` : undefined}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            noPadding
          >
            {slipsLoading ? (
              <div className="p-4"><IntelligenceLoadingSkeleton rows={5} /></div>
            ) : slipsError ? (
              <div className="m-4 flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />Failed to load pay slips. Please try again.
              </div>
            ) : slips.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <DollarSign className="h-10 w-10 opacity-30" />
                <p className="text-sm">No finalized pay slips yet.</p>
                <p className="text-xs opacity-70">Pay slips appear here once HR finalizes the payroll run.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-5 py-2.5 text-left font-medium">Pay period</th>
                      <th className="px-5 py-2.5 text-right font-medium">Gross</th>
                      <th className="px-5 py-2.5 text-right font-medium">Deductions</th>
                      <th className="px-5 py-2.5 text-right font-medium">Net pay</th>
                      <th className="px-5 py-2.5 text-left font-medium">Status</th>
                      <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map(slip => (
                      <tr key={slip.slip_id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <p className="font-medium text-foreground">{fmtMonth(slip.month)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {slip.payable_days} / {slip.total_working_days} days
                            {slip.lop_days > 0 && <span className="text-destructive"> · {slip.lop_days} LOP</span>}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(slip.gross_pay)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">−{fmtCurrency(slip.total_deductions)}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-success">{fmtCurrency(slip.net_pay)}</td>
                        <td className="px-5 py-3">
                          <Badge variant="success" className="rounded-full text-[10px] capitalize">{slip.status}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 gap-1.5 text-xs text-primary"
                            disabled={printSlipId === slip.slip_id}
                            onClick={() => setPrintSlipId(slip.slip_id)}
                          >
                            {printSlipId === slip.slip_id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                            PDF
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* Off-screen render that prints the chosen slip, then clears itself */}
          {printSlipId && (() => {
            const s = slips.find(x => x.slip_id === printSlipId)
            return s
              ? <PrintableSlip slip={s} profile={profileData} bank={bank} onDone={() => setPrintSlipId(null)} />
              : null
          })()}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: SALARY                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'salary' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Salary structure — clean Component / Monthly / Annual table */}
          <SectionCard
            className="lg:col-span-2"
            title="Salary structure"
            description={comp?.effective_from ? `Effective ${fmtDate(comp.effective_from)}` : undefined}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" />Download
              </Button>
            }
            noPadding
          >
            {compError && (
              <div className="m-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                Failed to load data. Please refresh and try again.
              </div>
            )}
            {compLoading ? (
              <div className="p-4"><IntelligenceLoadingSkeleton rows={5} /></div>
            ) : components.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">No salary components configured. Contact HR.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-5 py-2.5 text-left font-medium">Component</th>
                      <th className="px-5 py-2.5 text-right font-medium">Monthly</th>
                      <th className="px-5 py-2.5 text-right font-medium">Annual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Earnings',               items: earnings    },
                      { label: 'Employer contributions', items: empContribs },
                    ].filter(g => g.items.length > 0).map(({ label, items }) => (
                      <SalaryGroup key={label} label={label} items={items} />
                    ))}
                    {/* Total CTC */}
                    <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                      <td className="px-5 py-3">Total CTC</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(ctcMonthlyCalc)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(annualCtc)}</td>
                    </tr>
                    {/* Take-home reference row */}
                    {netMonthly != null && (
                      <tr className="border-t border-border/60 text-success">
                        <td className="px-5 py-3 font-medium">
                          Net take-home
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">after PF · ESI · PT · LWF · TDS</span>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtCurrency(netMonthly)}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtCurrency(netMonthly * 12)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {netMonthly != null && latest && (
                  <p className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border/40">
                    Net take-home estimated using statutory deductions from your {fmtMonthShort(latest.month)} payslip.
                    Employer contributions are part of CTC but not deducted from pay.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* Bank & pay schedule — real masked data from full-profile */}
          <SectionCard title="Bank & pay schedule" icon={<Wallet className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-2.5 text-sm">
              <DetailRow label="Pay frequency" value="Monthly" />
              <DetailRow label="Pay date"      value="Last working day" />
              <DetailRow label="Bank"
                value={bank?.bank_name
                  ? `${bank.bank_name}${bank.account_number_masked ? ` ${bank.account_number_masked}` : ''}`
                  : 'Not on file'} />
              <DetailRow label="IFSC" value={bank?.ifsc ?? '—'} />
              <DetailRow label="UAN"  value={bank?.uan ?? '—'} />
              <DetailRow label="PAN"  value={bank?.pan ?? '—'} />
              {bank?.pf_number && <DetailRow label="PF number" value={bank.pf_number} />}
              <div className="mt-1 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                Bank, PAN and UAN are managed by HR. Contact HR to update these details.
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: BONUSES & INCENTIVES                                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'bonuses' && (
        <MyBonusesTab
          awards={bonusData?.data ?? []}
          total={bonusData?.total_awarded ?? 0}
          loading={bonusLoading}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: BENEFITS                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'benefits' && (
        <MyBenefitsTab
          plans={benPlansData?.data ?? []}
          enrollments={benMyData?.data ?? []}
          loading={benPlansLoading || benMyLoading}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: TAX                                                            */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'tax' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionCard
            className="lg:col-span-2"
            title="Income tax computation"
            icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
          >
            {taxLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : taxError || !taxData ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <FileText className="h-8 w-8 opacity-30" />
                <p className="text-sm">No tax statement available yet.</p>
                <p className="text-xs opacity-70">Your projected IT statement appears once payroll has processed for the current financial year.</p>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-muted-foreground">Gross salary</span>
                  <span className="tabular-nums">{fmtCurrency(taxData.gross_salary)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">Taxable income</span>
                  <span className="tabular-nums">{fmtCurrency(taxData.taxable_income)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="font-semibold">Total tax payable</span>
                  <span className="font-semibold tabular-nums">{fmtCurrency(taxData.total_tax_payable)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">TDS deducted (YTD)</span>
                  <span className="tabular-nums text-success">{fmtCurrency(taxData.tds_by_employer_ytd)}</span>
                </div>
                <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                  <span className="text-muted-foreground">Balance tax payable</span>
                  <span className="tabular-nums">{fmtCurrency(taxData.balance_tax_payable)}</span>
                </div>
                {taxData.remaining_months > 0 && (
                  <div className="flex items-center justify-between py-1.5 border-t border-border/40">
                    <span className="text-muted-foreground">
                      Monthly recovery
                      <span className="text-[10px] ml-1 opacity-70">over {taxData.remaining_months} mo</span>
                    </span>
                    <span className="tabular-nums">{fmtCurrency(taxData.monthly_recovery)}</span>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Tax regime" icon={<Receipt className="h-4 w-4 text-muted-foreground" />}>
            {taxData ? (
              <div className="space-y-2.5 text-sm">
                <DetailRow label="Financial year" value={taxData.financial_year} />
                <DetailRow label="Selected regime" value={taxData.regime === 'new' ? 'New regime' : 'Old regime'} />
                <DetailRow label="Estimated tax" value={fmtCurrency(taxData.total_tax_payable)} />
                <DetailRow label="TDS YTD" value={fmtCurrency(taxData.tds_by_employer_ytd)} />
              </div>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Regime details appear with your IT statement.
              </p>
            )}
          </SectionCard>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: HISTORY                                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <>
          <SectionCard
            title="Compensation revision history"
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          >
            {revLoading ? (
              <IntelligenceLoadingSkeleton rows={4} />
            ) : (
              <RevisionTimeline revisions={revisions} />
            )}
          </SectionCard>

          {/* Gross vs Net trend */}
          {chartData.length > 0 && (
            <SectionCard
              title="Gross vs Net — last 6 months"
              icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
            >
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid {...gridStyle} />
                  <XAxis dataKey="month" {...axisStyle} />
                  <YAxis {...axisStyle} tickFormatter={v => `₹${v}K`} width={55} />
                  <RechartsTip contentStyle={tooltipStyle} formatter={(v: number) => [`₹${v}K`]} />
                  <Line type="monotone" dataKey="Gross"
                    stroke={getChartColor('chart1')} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Net"
                    stroke={getChartColor('active')} strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
          )}
        </>
      )}
    </PageContainer>
  )
}
