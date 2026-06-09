/**
 * FilingPackCenter — Compliance Filing Pack
 *
 * Month/quarter-based UI for generating regulator-ready compliance files:
 *   • ECR 2.0  (EPFO monthly upload)
 *   • Form 24Q (TDS quarterly — Annexure I + II)
 *   • Challan Data Sheet (EPF / ESI / PTax / TDS remittance summary)
 *
 * Flow: Pre-flight readiness check → Generate → Track status (Generated → Submitted → Acknowledged)
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, AlertTriangle, Download, Clock,
  RefreshCw, FileText, Shield, Building2, MapPin, Landmark,
  ChevronDown, ChevronUp, Info, PackageCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReadinessCheck {
  ready:            boolean
  employee_count?:  number
  missing_uan?:     number
  missing_pan?:     number
  missing_registrations?: string[]
  registration_number?: string | null
  finalized_count?: number
  total_count?:     number
  issues:           string[]
}

interface Readiness {
  month:         string
  overall_ready: boolean
  checks: {
    payroll: ReadinessCheck
    epf:     ReadinessCheck
    esi:     ReadinessCheck
    ptax:    ReadinessCheck
    tds:     ReadinessCheck
  }
}

interface Artifact {
  id:              string
  artifact_type:   string
  period_month:    string | null
  period_quarter:  number | null
  period_fy:       string | null
  file_name:       string
  row_count:       number | null
  status:          'generated' | 'submitted' | 'acknowledged'
  generated_at:    string
  submitted_at:    string | null
  acknowledged_at: string | null
  notes:           string | null
  profiles?:       { full_name: string } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Current month as YYYY-MM
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// YYYY-MM → "Mar 2024"
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[Number(m) - 1]} ${y}`
}

// Current Indian financial year "YYYY-YY"
function currentFY(): string {
  const d = new Date()
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${y}-${String(y + 1).slice(2)}`
}

// Which quarter does a given month fall into?
function monthToQuarter(ym: string): { quarter: string; fy: string } {
  const [y, m] = ym.split('-').map(Number)
  const mo = m
  let q: number, fy: string
  if (mo >= 4 && mo <= 6)  { q = 1; fy = `${y}-${String(y+1).slice(2)}` }
  else if (mo >= 7 && mo <= 9)  { q = 2; fy = `${y}-${String(y+1).slice(2)}` }
  else if (mo >= 10 && mo <= 12) { q = 3; fy = `${y}-${String(y+1).slice(2)}` }
  else                     { q = 4; fy = `${y-1}-${String(y).slice(2)}` }
  return { quarter: `Q${q}`, fy }
}

function artifactLabel(type: string): string {
  const map: Record<string, string> = {
    ecr_2_0:      'ECR 2.0',
    '24q':        'Form 24Q',
    challan_all:  'Challan (All)',
    challan_epf:  'Challan EPF',
    challan_esi:  'Challan ESI',
    challan_ptax: 'Challan PTax',
    challan_tds:  'Challan TDS',
  }
  return map[type] ?? type
}

const STATUS_CLASSES: Record<Artifact['status'], { bg: string; text: string; label: string }> = {
  generated:    { bg: 'bg-blue-50',    text: 'text-blue-700',    label: 'Generated' },
  submitted:    { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Submitted' },
  acknowledged: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Acknowledged' },
}

// ── ReadinessCard ─────────────────────────────────────────────────────────────

interface ReadinessCardProps {
  label:   string
  icon:    React.ElementType
  check:   ReadinessCheck | undefined
  loading: boolean
}

function ReadinessCard({ label, icon: Icon, check, loading }: ReadinessCardProps) {
  const [open, setOpen] = useState(false)
  const severity = !check ? 'neutral'
    : check.ready              ? 'success'
    : check.issues.length > 0  ? 'critical'
    : 'warning'

  const COLORS = {
    success:  { border: 'border-emerald-200', icon: 'text-emerald-600 bg-emerald-50', indicator: 'text-emerald-600', dot: 'bg-emerald-500' },
    critical: { border: 'border-rose-200',    icon: 'text-rose-600 bg-rose-50',       indicator: 'text-rose-600',    dot: 'bg-rose-500' },
    warning:  { border: 'border-amber-200',   icon: 'text-amber-600 bg-amber-50',     indicator: 'text-amber-600',   dot: 'bg-amber-500' },
    neutral:  { border: 'border-border',      icon: 'text-muted-foreground bg-muted', indicator: 'text-muted-foreground', dot: 'bg-muted-foreground/40' },
  }[severity]

  return (
    <div className={cn('rounded-xl border p-4 bg-card', COLORS.border)}>
      <div className="flex items-start gap-3">
        <span className={cn('flex items-center justify-center rounded-lg h-8 w-8 flex-shrink-0', COLORS.icon)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">{label}</span>
            {loading
              ? <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              : check?.ready
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : <XCircle className="h-4 w-4 text-rose-500" />
            }
          </div>
          {!loading && check && (
            <p className={cn('text-[11px] mt-0.5', COLORS.indicator)}>
              {check.ready
                ? `${check.employee_count ?? check.finalized_count ?? 0} employees · Ready`
                : check.issues[0] ?? 'Issues found'}
            </p>
          )}
          {!loading && check && !check.ready && check.issues.length > 1 && (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground hover:text-foreground"
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {check.issues.length - 1} more issue{check.issues.length > 2 ? 's' : ''}
            </button>
          )}
          {open && check && (
            <ul className="mt-1.5 space-y-0.5">
              {check.issues.slice(1).map((iss, i) => (
                <li key={i} className="text-[11px] text-rose-600 flex items-start gap-1">
                  <span className="mt-0.5 flex-shrink-0">·</span>{iss}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ArtifactRow ───────────────────────────────────────────────────────────────

interface ArtifactRowProps {
  artifact:  Artifact
  onMark:    (id: string, status: 'submitted' | 'acknowledged') => void
  marking:   boolean
}

function ArtifactRow({ artifact: a, onMark, marking }: ArtifactRowProps) {
  const sc  = STATUS_CLASSES[a.status] ?? STATUS_CLASSES.generated
  const period = a.period_month
    ? fmtMonth(a.period_month)
    : a.period_quarter && a.period_fy
      ? `Q${a.period_quarter} FY ${a.period_fy}`
      : '—'

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      <td className="py-2.5 pl-4 pr-2">
        <span className="text-[12.5px] font-medium text-foreground">{artifactLabel(a.artifact_type)}</span>
      </td>
      <td className="py-2.5 px-2 text-[12px] text-muted-foreground">{period}</td>
      <td className="py-2.5 px-2 text-[11px] text-muted-foreground truncate max-w-[180px]" title={a.file_name}>
        {a.file_name}
      </td>
      <td className="py-2.5 px-2">
        <span className={cn('inline-flex items-center text-[10.5px] font-semibold px-2 py-0.5 rounded-full', sc.bg, sc.text)}>
          {sc.label}
        </span>
      </td>
      <td className="py-2.5 px-2 text-[11px] text-muted-foreground">
        {new Date(a.generated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
      </td>
      <td className="py-2.5 pl-2 pr-4">
        <div className="flex items-center gap-1">
          {a.status === 'generated' && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10.5px] px-2"
              disabled={marking}
              onClick={() => onMark(a.id, 'submitted')}
            >
              Mark Submitted
            </Button>
          )}
          {a.status === 'submitted' && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10.5px] px-2"
              disabled={marking}
              onClick={() => onMark(a.id, 'acknowledged')}
            >
              Mark Acknowledged
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── FilingPackCenter ──────────────────────────────────────────────────────────

export function FilingPackCenter() {
  const qc          = useQueryClient()
  const [month, setMonth] = useState<string>(currentMonth)
  const { quarter, fy } = useMemo(() => monthToQuarter(month), [month])
  const [generating, setGenerating] = useState<string | null>(null)

  // ── Pre-flight readiness ────────────────────────────────────────────────────
  const { data: readiness, isLoading: loadingReady, refetch: refetchReady } = useQuery<Readiness>({
    queryKey: ['filing-pack-readiness', month],
    queryFn:  () => api.get<Readiness>(`/payroll/filing-pack/readiness?month=${month}`),
    staleTime: 60_000,
  })

  // ── Artifact history ────────────────────────────────────────────────────────
  const { data: artifactsData, isLoading: loadingArtifacts } = useQuery<{ data: Artifact[] }>({
    queryKey: ['filing-pack-artifacts', month],
    queryFn:  () => api.get<{ data: Artifact[] }>(`/payroll/filing-pack/artifacts?month=${month}`),
    staleTime: 30_000,
  })
  const artifacts = artifactsData?.data ?? []

  // ── Record artifact after download ─────────────────────────────────────────
  async function recordArtifact(type: string, fileName: string, rowCount?: number) {
    const body: Record<string, unknown> = {
      artifact_type: type,
      file_name:     fileName,
      row_count:     rowCount,
    }
    if (type === '24q') {
      body.period_quarter = Number(quarter.slice(1))
      body.period_fy      = fy
    } else {
      body.period_month = month
    }
    try {
      await api.post('/payroll/filing-pack/artifacts', body)
      qc.invalidateQueries({ queryKey: ['filing-pack-artifacts', month] })
    } catch { /* non-critical — log is best-effort */ }
  }

  // ── Mark artifact status ────────────────────────────────────────────────────
  const markMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'submitted' | 'acknowledged' }) =>
      api.patch(`/payroll/filing-pack/artifacts/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['filing-pack-artifacts', month] })
      toast.success('Status updated')
    },
    onError: () => toast.error('Failed to update status'),
  })

  // ── Download helpers ────────────────────────────────────────────────────────
  async function downloadFile(url: string, fileName: string) {
    const token = (await import('@/stores/authStore')).useAuthStore.getState().accessToken
    const res   = await fetch(url, { headers: { Authorization: `Bearer ${token ?? ''}` } })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as any)?.message ?? 'Download failed')
    }
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = href
    a.download = fileName
    a.click()
    URL.revokeObjectURL(href)
  }

  async function handleGenerate(type: 'ecr' | '24q' | 'challan') {
    setGenerating(type)
    try {
      const apiBase = (import.meta as any).env?.VITE_API_URL ?? ''
      if (type === 'ecr') {
        const fileName = `ECR2_${month}.txt`
        await downloadFile(`${apiBase}/payroll/filing-pack/ecr?month=${month}`, fileName)
        await recordArtifact('ecr_2_0', fileName)
        toast.success('ECR 2.0 file downloaded')
      } else if (type === '24q') {
        const fileName = `24Q_${fy}_${quarter}.csv`
        await downloadFile(`${apiBase}/payroll/filing-pack/24q?quarter=${quarter}&financial_year=${fy}&sheet=both`, fileName)
        await recordArtifact('24q', fileName)
        toast.success('Form 24Q data downloaded')
      } else {
        const fileName = `Challan_${month}.csv`
        await downloadFile(`${apiBase}/payroll/filing-pack/challan?month=${month}&format=csv`, fileName)
        await recordArtifact('challan_all', fileName)
        toast.success('Challan data sheet downloaded')
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Download failed')
    } finally {
      setGenerating(null)
    }
  }

  const overall = readiness?.overall_ready

  return (
    <div className="flex flex-col h-full overflow-y-auto">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-4 border-b border-border/60 flex-shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold text-foreground">Compliance Filing Pack</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Generate regulator-ready files from finalized payroll data.
            </p>
          </div>

          {/* Month picker */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                Month
              </label>
              <input
                type="month"
                value={month}
                onChange={e => setMonth(e.target.value)}
                className="h-8 px-2.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-5 h-8"
              onClick={() => refetchReady()}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Quarter + FY derived info */}
        <p className="text-[11.5px] text-muted-foreground mt-2">
          {fmtMonth(month)} · Income-tax quarter <span className="font-semibold">{quarter} FY {fy}</span>
        </p>
      </div>

      <div className="flex-1 px-6 py-5 space-y-6">

        {/* ── Pre-flight Readiness ────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-bold text-foreground uppercase tracking-wide">Pre-flight Readiness</h2>
            {!loadingReady && readiness && (
              <span className={cn(
                'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border',
                overall
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200',
              )}>
                {overall
                  ? <><CheckCircle2 className="h-3 w-3" /> All systems ready</>
                  : <><AlertTriangle className="h-3 w-3" /> Issues need attention</>
                }
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            <ReadinessCard label="Payroll"  icon={FileText}  check={readiness?.checks.payroll} loading={loadingReady} />
            <ReadinessCard label="EPF"      icon={Building2} check={readiness?.checks.epf}     loading={loadingReady} />
            <ReadinessCard label="ESI"      icon={Shield}    check={readiness?.checks.esi}      loading={loadingReady} />
            <ReadinessCard label="Prof. Tax" icon={MapPin}  check={readiness?.checks.ptax}    loading={loadingReady} />
            <ReadinessCard label="TDS"      icon={Landmark}  check={readiness?.checks.tds}      loading={loadingReady} />
          </div>
        </section>

        {/* ── Generate Files ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-[13px] font-bold text-foreground uppercase tracking-wide mb-3">Generate Files</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

            {/* ECR 2.0 */}
            <div className="rounded-xl border border-border p-4 bg-card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center h-9 w-9 rounded-lg bg-indigo-50 text-indigo-600 flex-shrink-0">
                  <Building2 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-foreground">ECR 2.0</p>
                  <p className="text-[11px] text-muted-foreground">EPFO monthly upload · {fmtMonth(month)}</p>
                </div>
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                UAN-based text file in EPFO ECR 2.0 format. Upload directly to the Unified EPFO Portal.
              </p>
              <Button
                className="w-full h-8 text-[12.5px]"
                disabled={generating !== null || loadingReady}
                onClick={() => handleGenerate('ecr')}
              >
                {generating === 'ecr'
                  ? <><div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin mr-2" /> Generating…</>
                  : <><Download className="h-3.5 w-3.5 mr-1.5" /> Download ECR 2.0</>
                }
              </Button>
            </div>

            {/* Form 24Q */}
            <div className="rounded-xl border border-border p-4 bg-card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center h-9 w-9 rounded-lg bg-violet-50 text-violet-600 flex-shrink-0">
                  <Landmark className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-foreground">Form 24Q</p>
                  <p className="text-[11px] text-muted-foreground">TDS quarterly return · {quarter} FY {fy}</p>
                </div>
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                Annexure I (challan summary) + Annexure II (deductee details). File via TRACES / NSDL RPU after obtaining BSR codes.
              </p>
              <Button
                className="w-full h-8 text-[12.5px]"
                disabled={generating !== null || loadingReady}
                onClick={() => handleGenerate('24q')}
              >
                {generating === '24q'
                  ? <><div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin mr-2" /> Generating…</>
                  : <><Download className="h-3.5 w-3.5 mr-1.5" /> Download 24Q Data</>
                }
              </Button>
            </div>

            {/* Challan Sheet */}
            <div className="rounded-xl border border-border p-4 bg-card space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center h-9 w-9 rounded-lg bg-amber-50 text-amber-600 flex-shrink-0">
                  <FileText className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-foreground">Challan Sheet</p>
                  <p className="text-[11px] text-muted-foreground">EPF · ESI · PTax · TDS · {fmtMonth(month)}</p>
                </div>
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                Consolidated remittance amounts across all statutory heads. Use to prepare payment challans on respective portals.
              </p>
              <Button
                className="w-full h-8 text-[12.5px]"
                disabled={generating !== null || loadingReady}
                onClick={() => handleGenerate('challan')}
              >
                {generating === 'challan'
                  ? <><div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin mr-2" /> Generating…</>
                  : <><Download className="h-3.5 w-3.5 mr-1.5" /> Download Challan Sheet</>
                }
              </Button>
            </div>
          </div>

          {/* Portal note */}
          <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2.5 border border-border/50">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground/70" />
            <span>
              Files are generated from finalized payroll data. Portal upload (EPFO, ESIC, TRACES) must be done manually.
              BSR code and challan number for TDS (required for 24Q filing) are only available after bank remittance.
            </span>
          </div>
        </section>

        {/* ── Artifact History ────────────────────────────────────────── */}
        <section>
          <h2 className="text-[13px] font-bold text-foreground uppercase tracking-wide mb-3">
            Filing History
            {artifacts.length > 0 && (
              <span className="ml-2 text-[11px] font-normal text-muted-foreground normal-case tracking-normal">
                for {fmtMonth(month)}
              </span>
            )}
          </h2>

          {loadingArtifacts ? (
            <div className="flex items-center justify-center h-24">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : artifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 text-center border border-dashed border-border/60 rounded-xl bg-muted/20">
              <Clock className="h-6 w-6 text-muted-foreground/40 mb-1" />
              <p className="text-[12px] text-muted-foreground">No files generated for {fmtMonth(month)} yet.</p>
            </div>
          ) : (
            <div className="border border-border/60 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    {['Type','Period','File','Status','Generated','Actions'].map(h => (
                      <th key={h} className="py-2 px-3 first:pl-4 last:pr-4 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {artifacts.map(a => (
                    <ArtifactRow
                      key={a.id}
                      artifact={a}
                      onMark={(id, status) => markMutation.mutate({ id, status })}
                      marking={markMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
