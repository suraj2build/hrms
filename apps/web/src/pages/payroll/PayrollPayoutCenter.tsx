/**
 * PayrollPayoutCenter — /admin/payroll/payout
 *
 * Bank disbursement orchestration: payout batches, per-employee status,
 * bank advice export, hold salary, failed payout tracking, retry.
 *
 * Statuses: pending · ready · processing · paid · failed · reversed · held
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useMemo }      from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Banknote, Download, Search, CheckCircle2,
  AlertTriangle, XCircle, Clock, RefreshCw,
  Users, DollarSign, Lock, Loader2, Filter,
  ChevronDown, ChevronRight, AlertCircle,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'
import { toast }         from 'sonner'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayoutBatch {
  id:             string
  month:          string
  run_id:         string
  employee_count: number
  total_amount:   number
  gross_amount:   number
  status:         string
  finalized_at:   string | null
  created_at:     string
}

interface PayoutEmployee {
  slip_id:          string
  employee_id:      string
  employee_code:    string
  employee_name:    string
  net_pay:          number
  gross_pay:        number
  total_deductions: number
  status:           string
  held_reason:      string | null
  bank_name:        string | null
  account_masked:   string | null
  ifsc:             string | null
  bank_verified:    boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}
function fmtMonth(m: string) {
  const d = new Date(m.slice(0,7) + '-01T12:00:00Z')
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending:    { label: 'Pending',    cls: 'text-muted-foreground border-border', icon: <Clock className="h-2.5 w-2.5" /> },
  ready:      { label: 'Ready',      cls: 'text-info border-info/40 bg-info/10',    icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
  processing: { label: 'Processing', cls: 'text-warning border-warning/40',         icon: <RefreshCw className="h-2.5 w-2.5 animate-spin" /> },
  paid:       { label: 'Paid',       cls: 'text-success border-success/40 bg-success/10', icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
  failed:     { label: 'Failed',     cls: 'text-destructive border-destructive/30', icon: <XCircle className="h-2.5 w-2.5" /> },
  reversed:   { label: 'Reversed',   cls: 'text-warning border-warning/40',         icon: <AlertTriangle className="h-2.5 w-2.5" /> },
  held:       { label: 'Held',       cls: 'text-warning border-warning/40',         icon: <Lock className="h-2.5 w-2.5" /> },
  finalized:  { label: 'Finalized',  cls: 'text-success border-success/40 bg-success/5', icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
  draft:      { label: 'Draft',      cls: 'text-muted-foreground',                  icon: <Clock className="h-2.5 w-2.5" /> },
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? { label: status, cls: 'text-muted-foreground', icon: null }
  return (
    <Badge variant="outline" className={cn('rounded-full text-[9px] gap-1', c.cls)}>
      {c.icon}{c.label}
    </Badge>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PayrollPayoutCenter() {
  const queryClient = useQueryClient()
  const [selectedBatch, setSelectedBatch]     = useState<PayoutBatch | null>(null)
  const [statusFilter, setStatusFilter]       = useState<string>('all')
  const [search, setSearch]                   = useState('')
  const [expandedRows, setExpandedRows]       = useState<Set<string>>(new Set())
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false)

  // Payout batches
  const { data: batchesRaw, isLoading: batchesLoading } = useQuery<{ data: PayoutBatch[] }>({
    queryKey: ['payout-batches'],
    queryFn:  () => api.get('/payroll/payout-batches'),
    staleTime: 30_000,
  })
  const batches      = batchesRaw?.data ?? []
  const activeBatch  = selectedBatch ?? batches[0] ?? null

  // Employee payouts for selected batch
  const { data: employeesRaw, isLoading: empLoading } = useQuery<{ data: PayoutEmployee[] }>({
    queryKey: ['payout-employees', activeBatch?.id],
    queryFn:  () => api.get(`/payroll/payout-batches/${activeBatch!.run_id}/employees`),
    enabled:  !!activeBatch?.run_id,
    staleTime: 30_000,
  })
  const employees = employeesRaw?.data ?? []

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const noBank    = employees.filter(e => !e.bank_verified)
    const held      = employees.filter(e => e.status === 'held')
    const failed    = employees.filter(e => e.status === 'failed')
    const totalNet  = employees.reduce((s, e) => s + e.net_pay, 0)
    return { noBank, held, failed, totalNet }
  }, [employees])

  // ── Filtered employees ─────────────────────────────────────────────────────
  const filteredEmployees = useMemo(() => {
    let rows = employees
    if (statusFilter === 'no_bank') rows = rows.filter(e => !e.bank_verified)
    if (statusFilter === 'held')    rows = rows.filter(e => e.status === 'held')
    if (statusFilter === 'failed')  rows = rows.filter(e => e.status === 'failed')
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.employee_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q),
      )
    }
    return rows
  }, [employees, statusFilter, search])

  const toggleRow = (id: string) =>
    setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ── Export bank advice CSV ─────────────────────────────────────────────────
  const handleExport = () => {
    if (!activeBatch) return
    const headers = ['Employee Code', 'Employee Name', 'Bank', 'Account (Masked)', 'IFSC', 'Net Pay (INR)', 'Status']
    const rows = employees.map(e => [
      e.employee_code,
      e.employee_name,
      e.bank_name ?? 'N/A',
      e.account_masked ?? 'N/A',
      e.ifsc ?? 'N/A',
      String(e.net_pay),
      e.status,
    ])
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `bank-advice-${activeBatch.month}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExportConfirmOpen(false)
    toast.success('Bank advice exported')
  }

  return (
    <PageContainer>
      <PageHeader
        title="Payout Orchestration"
        subtitle="Bank disbursement management, advice export, and payout tracking"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['payout-batches'] })}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
            </Button>
            {activeBatch?.status === 'ready' || activeBatch?.status === 'finalized' ? (
              <Button size="sm" onClick={() => setExportConfirmOpen(true)}>
                <Download className="h-3.5 w-3.5 mr-1" />Export Bank Advice
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Batch selector */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        {batchesLoading ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading batches…</div>
        ) : batches.length === 0 ? (
          <div className="text-xs text-muted-foreground">No payroll runs found</div>
        ) : batches.map(b => (
          <button
            key={b.id}
            onClick={() => setSelectedBatch(b)}
            className={cn(
              'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
              b.id === activeBatch?.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
            )}
          >
            {fmtMonth(b.month)}
            <StatusBadge status={b.status} />
          </button>
        ))}
      </div>

      {activeBatch && (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Total Employees',    value: employees.length,       icon: <Users className="h-3.5 w-3.5" />,   color: '' },
              { label: 'Total Net Payout',   value: fmtCurrency(stats.totalNet), icon: <DollarSign className="h-3.5 w-3.5" />, color: 'text-success' },
              { label: 'No Bank Details',    value: stats.noBank.length,    icon: <AlertTriangle className="h-3.5 w-3.5" />, color: stats.noBank.length > 0 ? 'text-destructive' : 'text-success' },
              { label: 'Held / Failed',      value: stats.held.length + stats.failed.length, icon: <XCircle className="h-3.5 w-3.5" />, color: (stats.held.length + stats.failed.length) > 0 ? 'text-warning' : 'text-success' },
            ].map(k => (
              <div key={k.label} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">{k.icon}<span>{k.label}</span></div>
                <p className={cn('text-xl font-bold tabular-nums', k.color, empLoading && 'animate-pulse text-muted-foreground/30')}>
                  {empLoading ? '—' : k.value}
                </p>
              </div>
            ))}
          </div>

          {/* Alerts */}
          {stats.noBank.length > 0 && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-destructive/20 bg-destructive/5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {stats.noBank.length} employee(s) have no verified bank details — payouts will fail without bank info.
            </div>
          )}

          {/* Filter tabs */}
          <div className="mb-3 flex items-center gap-1 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mr-1" />
            {[
              { key: 'all',     label: `All (${employees.length})` },
              { key: 'no_bank', label: `No Bank (${stats.noBank.length})` },
              { key: 'held',    label: `Held (${stats.held.length})` },
              { key: 'failed',  label: `Failed (${stats.failed.length})` },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors',
                  statusFilter === f.key
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/40',
                )}
              >
                {f.label}
              </button>
            ))}
            <div className="flex-1 min-w-[180px]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input className="pl-7 h-7 text-[11px]" placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Employee Payout Table */}
          <SectionCard
            title={`Employee Payouts — ${fmtMonth(activeBatch.month)}`}
            icon={<Banknote className="h-4 w-4" />}
            description={`${fmtCurrency(activeBatch.total_amount)} total · ${activeBatch.employee_count} employees`}
          >
            {empLoading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />Loading employees…
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-muted-foreground">
                <Banknote className="h-8 w-8 opacity-30" />
                <p className="text-sm">No employees match this filter</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {['Employee', 'Net Pay', 'Gross', 'Bank', 'IFSC', 'Status', ''].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map(emp => {
                      const isExpanded = expandedRows.has(emp.employee_id)
                      return (
                        <>
                          <tr
                            key={emp.employee_id}
                            className={cn(
                              'border-b border-border/50 hover:bg-muted/20 cursor-pointer',
                              !emp.bank_verified && 'bg-destructive/5',
                              emp.status === 'held' && 'bg-warning/5',
                            )}
                            onClick={() => toggleRow(emp.employee_id)}
                          >
                            <td className="px-3 py-2 font-medium">
                              <div>{emp.employee_name}</div>
                              <div className="text-[10px] text-muted-foreground">{emp.employee_code}</div>
                            </td>
                            <td className="px-3 py-2 tabular-nums font-semibold text-success">{fmtCurrency(emp.net_pay)}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtCurrency(emp.gross_pay)}</td>
                            <td className="px-3 py-2">
                              {emp.bank_verified
                                ? <span className="text-muted-foreground">{emp.bank_name ?? '—'}</span>
                                : <span className="text-destructive font-medium">No bank</span>
                              }
                            </td>
                            <td className="px-3 py-2 text-muted-foreground font-mono text-[10px]">{emp.ifsc ?? '—'}</td>
                            <td className="px-3 py-2"><StatusBadge status={emp.status} /></td>
                            <td className="px-3 py-2">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${emp.employee_id}-detail`} className="bg-muted/10 border-b border-border/50">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                  <div>
                                    <p className="text-muted-foreground mb-0.5">Account (Masked)</p>
                                    <p className="font-mono font-medium">{emp.account_masked ?? 'Not on file'}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground mb-0.5">Total Deductions</p>
                                    <p className="font-medium">{fmtCurrency(emp.total_deductions)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground mb-0.5">Slip Status</p>
                                    <StatusBadge status={emp.status} />
                                  </div>
                                  {emp.held_reason && (
                                    <div className="col-span-2">
                                      <p className="text-muted-foreground mb-0.5">Hold Reason</p>
                                      <p className="text-warning font-medium">{emp.held_reason}</p>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Export Confirm Dialog */}
      <Dialog open={exportConfirmOpen} onOpenChange={setExportConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Bank Advice</DialogTitle>
            <DialogDescription>
              Export a CSV with employee bank details and net pay amounts for {activeBatch ? fmtMonth(activeBatch.month) : ''}.
              This file is used to initiate bank disbursements.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {stats.noBank.length > 0 && (
              <div className="px-3 py-2 rounded-md bg-warning/10 border border-warning/20 text-xs text-warning">
                {stats.noBank.length} employee(s) have no bank details and will show as N/A in the export.
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {employees.length} employees · Total: {fmtCurrency(stats.totalNet)}
            </p>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" size="sm" onClick={() => setExportConfirmOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1" />Download CSV
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
