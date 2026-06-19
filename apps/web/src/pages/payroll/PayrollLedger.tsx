/**
 * PayrollLedger — /admin/payroll/ledger
 *
 * Explainability ledger — see every change to an employee's pay with
 * before/after values and the reason for change.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  ShieldAlert, Download, Loader2,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api }          from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn }           from '@/lib/utils'
import { toast }        from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LedgerEntry {
  id: string
  employee_id: string
  payroll_month: string
  component_code: string
  component_name: string
  before_value: number | null
  after_value: number
  delta: number
  change_reason: string
  source_type: string
  source_reference_id: string | null
  notes: string | null
  created_at: string
  employee_name?: string
  employee_code?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(s: string) {
  const dt = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

function SourceBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; variant: 'outline' | 'default' | 'secondary' }> = {
    payroll_run:     { label: 'Payroll Run',      variant: 'outline'   },
    manual_override: { label: 'Manual Override',  variant: 'default'   },
    revision:        { label: 'Revision',         variant: 'secondary' },
    statutory:       { label: 'Statutory',        variant: 'secondary' },
  }
  const cfg = map[type] ?? { label: type, variant: 'outline' as const }

  const cls = cn(
    type === 'manual_override' && 'text-warning border-border bg-transparent',
    type === 'revision'        && 'text-info border-border',
  )

  return (
    <Badge variant={cfg.variant} className={cls}>
      {cfg.label}
    </Badge>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryPanel({ entries }: { entries: LedgerEntry[] }) {
  const totalEntries = entries.length

  // net delta per component group (by component_code)
  const byComponent: Record<string, { name: string; net: number }> = {}
  for (const e of entries) {
    if (!byComponent[e.component_code]) {
      byComponent[e.component_code] = { name: e.component_name, net: 0 }
    }
    byComponent[e.component_code].net += e.delta
  }

  const groups = Object.entries(byComponent)

  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-xs text-muted-foreground mb-1">Total Entries</p>
        <p className="text-2xl font-bold text-foreground">{totalEntries}</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 sm:col-span-2 lg:col-span-3">
        <p className="text-xs text-muted-foreground mb-2">Net Delta per Component</p>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {groups.map(([code, { name, net }]) => (
              <div key={code} className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{name}</span>
                <span className={cn('font-semibold', net > 0 ? 'text-success' : net < 0 ? 'text-destructive' : 'text-foreground')}>
                  {net > 0 ? '+' : ''}{fmt(net)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Delta Cell ────────────────────────────────────────────────────────────────

function DeltaCell({ delta }: { delta: number }) {
  if (delta > 0) return (
    <span className="flex items-center gap-1 text-success font-medium">
      <TrendingUp className="h-3.5 w-3.5" /> +{fmt(delta)}
    </span>
  )
  if (delta < 0) return (
    <span className="flex items-center gap-1 text-destructive font-medium">
      <TrendingDown className="h-3.5 w-3.5" /> {fmt(delta)}
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3.5 w-3.5" /> {fmt(0)}
    </span>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PayrollLedger() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [employeeId, setEmployeeId] = useState('')
  const [month, setMonth]           = useState('')
  const [applied, setApplied]       = useState(false)

  const { data: entries, isLoading, isFetching } = useQuery<LedgerEntry[]>({
    queryKey: ['payroll-ledger', employeeId, month],
    queryFn: () => {
      const params = new URLSearchParams()
      if (employeeId) params.set('employee_id', employeeId)
      if (month)      params.set('month', month)
      return api.get<{ data: LedgerEntry[] }>(`/payroll/ledger?${params.toString()}`).then((r) => r.data)
    },
    enabled: isAdmin && applied,
  })

  const exportMutation = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams()
      if (employeeId) params.set('employee_id', employeeId)
      if (month)      params.set('month', month)
      return api.post('/payroll/ledger/export', { employee_id: employeeId || undefined, month: month || undefined })
    },
    onSuccess: () => {
      toast.success('Ledger export started', { description: 'The file will be ready shortly.' })
    },
    onError: (e: Error) => {
      toast.error('Export failed', { description: e.message })
    },
  })

  function handleApply() {
    setApplied(true)
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <ShieldAlert className="h-10 w-10 text-destructive" />
            <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              You do not have permission to view the Payroll Ledger. Contact your HR administrator.
            </p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const rows = entries ?? []

  return (
    <PageContainer>
      <PageHeader
        title="Payroll Ledger"
        subtitle="Full audit trail of every pay component change with before/after values"
      />

      {/* Filter bar */}
      <SectionCard className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Employee ID (UUID)</label>
            <Input
              placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
            />
          </div>
          <div className="w-40 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Payroll Month</label>
            <Input
              type="month"
              placeholder="YYYY-MM"
              value={month}
              onChange={e => setMonth(e.target.value)}
            />
          </div>
          <Button onClick={handleApply} disabled={isFetching} className="self-end">
            {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply
          </Button>
          <Button
            variant="outline"
            className="self-end gap-2"
            disabled={!rows.length || exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />}
            Export
          </Button>
        </div>
      </SectionCard>

      {/* Summary */}
      {applied && rows.length > 0 && <SummaryPanel entries={rows} />}

      {/* Table */}
      <SectionCard>
        {!applied ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Enter filters above and click <strong>Apply</strong> to load ledger entries.
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading ledger…
          </div>
        ) : !rows.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No ledger entries found for the selected filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 pb-3 font-medium">Date</th>
                  <th className="px-4 pb-3 font-medium">Employee</th>
                  <th className="px-4 pb-3 font-medium">Component</th>
                  <th className="px-4 pb-3 font-medium text-right">Before</th>
                  <th className="px-4 pb-3 font-medium text-right">After</th>
                  <th className="px-4 pb-3 font-medium text-right">Delta</th>
                  <th className="px-4 pb-3 font-medium">Reason</th>
                  <th className="px-4 pb-3 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} className="border-b border-border hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(e.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{e.employee_name ?? e.employee_id}</div>
                      {e.employee_code && <div className="text-xs text-muted-foreground">{e.employee_code}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{e.component_name}</div>
                      <div className="text-xs font-mono text-muted-foreground">{e.component_code}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fmt(e.before_value)}</td>
                    <td className="px-4 py-3 text-right text-foreground">{fmt(e.after_value)}</td>
                    <td className="px-4 py-3 text-right"><DeltaCell delta={e.delta} /></td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="truncate text-foreground" title={e.change_reason}>{e.change_reason}</p>
                      {e.notes && <p className="truncate text-xs text-muted-foreground" title={e.notes}>{e.notes}</p>}
                    </td>
                    <td className="px-4 py-3"><SourceBadge type={e.source_type} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
