/**
 * IncrementCycle — Payroll Admin (Program 5 · P5.5)
 *
 * Batch annual increment cycle. HR selects a cohort (whole org, a department, or a
 * grade), chooses a flat amount or a percentage uplift and an effective date, then
 * PREVIEWS the impact and generates the revisions.
 *
 * Crucially this creates ONE NORMAL compensation revision per employee through the
 * EXISTING workflow (POST /compensation/revisions/bulk) — each lands as `pending`
 * and is approved through the existing Compensation Revisions queue. No parallel
 * process, no new approval engine.
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Users, IndianRupee, Percent, CalendarClock, Loader2, ArrowRight,
  CheckCircle2, AlertTriangle, ListChecks, Sparkles,
} from 'lucide-react'
import { api }           from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Input }         from '@/components/ui/input'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Department { id: string; name: string }

interface PreviewRow {
  employee_id:       string
  name:              string | null
  before_ctc_annual: number
  new_ctc_annual:    number
  delta_amount:      number
  delta_pct:         number
}
interface SkippedRow { employee_id: string; name: string; reason: string }

interface BulkResult {
  dry_run?:      boolean
  created:       PreviewRow[]
  skipped:       SkippedRow[]
  cohort_size:   number
  created_count: number
  skipped_count: number
}

const inr = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

// ── Page ────────────────────────────────────────────────────────────────────────

export function IncrementCycle() {
  const navigate = useNavigate()

  // Cohort + parameters
  const [scope, setScope]   = useState<'all' | 'department'>('all')
  const [deptId, setDeptId] = useState('')
  const [mode, setMode]     = useState<'percentage' | 'flat_amount'>('percentage')
  const [value, setValue]   = useState('')
  const [effective, setEffective] = useState('')
  const [reason, setReason] = useState('')

  const [preview, setPreview] = useState<BulkResult | null>(null)

  const { data: deptData } = useQuery<{ data: Department[] }>({
    queryKey: ['departments'],
    queryFn:  () => api.get('/departments'),
    staleTime: 5 * 60_000,
  })
  const departments = deptData?.data ?? []

  const basePayload = useMemo(() => ({
    mode,
    value: parseFloat(value),
    effective_date: effective,
    revision_type: 'increment' as const,
    reason: reason.trim(),
    ...(scope === 'department' && deptId ? { department_id: deptId } : {}),
  }), [mode, value, effective, reason, scope, deptId])

  const canRun =
    isFinite(basePayload.value) && basePayload.value > 0 &&
    !!effective && reason.trim().length >= 5 &&
    (scope === 'all' || !!deptId)

  const previewMut = useMutation({
    mutationFn: () => api.post<BulkResult>('/compensation/revisions/bulk', { ...basePayload, dry_run: true }),
    onSuccess: (res: any) => setPreview(res),
    onError: (e: any) => toast.error(e?.message ?? 'Preview failed'),
  })

  const commitMut = useMutation({
    mutationFn: () => api.post<BulkResult>('/compensation/revisions/bulk', { ...basePayload, dry_run: false }),
    onSuccess: (res: any) => {
      toast.success(`${res.created_count} revision${res.created_count === 1 ? '' : 's'} created — pending HR approval`)
      navigate('/admin/payroll/compensation-revisions')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to generate revisions'),
  })

  const totalUplift = (preview?.created ?? []).reduce((s, r) => s + r.delta_amount, 0)

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Payroll' }, { label: 'Increment Cycle' }]}
        title="Increment Cycle"
        subtitle="Generate compensation revisions for a cohort · each row is approved through the normal workflow"
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* ── Configure ──────────────────────────────────────────────────── */}
        <SectionCard title="Configure cycle" icon={<ListChecks className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-4">
            {/* Cohort */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Cohort</label>
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={() => { setScope('all'); setPreview(null) }}
                  className={cn('flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    scope === 'all' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50')}>
                  All active
                </button>
                <button type="button" onClick={() => { setScope('department'); setPreview(null) }}
                  className={cn('flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    scope === 'department' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50')}>
                  By department
                </button>
              </div>
              {scope === 'department' && (
                <select
                  value={deptId} onChange={e => { setDeptId(e.target.value); setPreview(null) }}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select a department…</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </div>

            {/* Mode */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Increment basis</label>
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={() => { setMode('percentage'); setPreview(null) }}
                  className={cn('flex flex-1 items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    mode === 'percentage' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50')}>
                  <Percent className="h-3 w-3" /> Percentage
                </button>
                <button type="button" onClick={() => { setMode('flat_amount'); setPreview(null) }}
                  className={cn('flex flex-1 items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    mode === 'flat_amount' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50')}>
                  <IndianRupee className="h-3 w-3" /> Flat amount
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {mode === 'percentage' ? 'Increase %' : 'Flat annual increase (₹)'}
              </label>
              <Input type="number" min={0} step={mode === 'percentage' ? '0.5' : '1000'}
                value={value} onChange={e => { setValue(e.target.value); setPreview(null) }}
                placeholder={mode === 'percentage' ? 'e.g. 10' : 'e.g. 60000'} />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <CalendarClock className="h-3 w-3" /> Effective date
              </label>
              <Input type="date" value={effective} onChange={e => { setEffective(e.target.value); setPreview(null) }} />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Reason</label>
              <textarea
                value={reason} onChange={e => setReason(e.target.value)}
                rows={2} placeholder="e.g. FY2026-27 annual increment cycle"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <Button className="w-full" disabled={!canRun || previewMut.isPending} onClick={() => previewMut.mutate()}>
              {previewMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="ml-1.5">Preview impact</span>
            </Button>
          </div>
        </SectionCard>

        {/* ── Preview / result ───────────────────────────────────────────── */}
        <SectionCard title="Preview & generate" icon={<Users className="h-4 w-4 text-muted-foreground" />}>
          {!preview ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
              <ListChecks className="h-8 w-8 opacity-30" />
              <p className="text-sm">Configure the cycle and run a preview.</p>
              <p className="max-w-sm text-xs">No revision is created until you confirm. Each generated row goes to the normal approval queue.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary tiles */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] text-muted-foreground">Will create</p>
                  <p className="text-xl font-semibold tabular-nums text-foreground">{preview.created_count}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] text-muted-foreground">Skipped</p>
                  <p className="text-xl font-semibold tabular-nums text-foreground">{preview.skipped_count}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[11px] text-muted-foreground">Annual uplift</p>
                  <p className="text-xl font-semibold tabular-nums text-foreground">{inr(totalUplift)}</p>
                </div>
              </div>

              {/* Will-create table */}
              {preview.created.length > 0 && (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Employee</th>
                        <th className="px-3 py-2 text-right font-medium">Current</th>
                        <th className="px-3 py-2 text-right font-medium">New</th>
                        <th className="px-3 py-2 text-right font-medium">Δ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.created.map(r => (
                        <tr key={r.employee_id} className="hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{r.name ?? r.employee_id.slice(0, 8)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{inr(r.before_ctc_annual)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{inr(r.new_ctc_annual)}</td>
                          <td className="px-3 py-2 text-right">
                            <Badge variant="success" className="text-[9px]">+{r.delta_pct.toFixed(1)}%</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Skipped list */}
              {preview.skipped.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" /> {preview.skipped.length} skipped
                  </p>
                  <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                    {preview.skipped.map(s => (
                      <li key={s.employee_id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{s.name}</span>
                        <span className="shrink-0">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Commit */}
              <div className="flex items-center gap-2 border-t border-border pt-3">
                <div className="flex-1 text-[11px] text-muted-foreground">
                  Generates {preview.created_count} pending revision{preview.created_count === 1 ? '' : 's'} for HR approval.
                </div>
                <Button
                  disabled={preview.created_count === 0 || commitMut.isPending}
                  onClick={() => commitMut.mutate()}
                >
                  {commitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  <span className="ml-1.5">Generate {preview.created_count} revision{preview.created_count === 1 ? '' : 's'}</span>
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  )
}
