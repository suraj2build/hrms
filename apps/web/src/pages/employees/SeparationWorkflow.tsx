/**
 * SeparationWorkflow — /admin/employees/separation
 * Admin page listing active separations and managing clearance + F&F settlement.
 */
import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LogOut, CheckCircle2, XCircle, Clock, ChevronRight,
  Edit2, X, DollarSign, Users, Loader2, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'pending_clearance' | 'fnf_pending' | 'completed'

interface ClearanceDept {
  id: string
  department: 'IT' | 'Manager' | 'Finance' | 'Admin' | 'HR'
  status: 'pending' | 'cleared' | 'rejected'
  cleared_by: string | null
  cleared_at: string | null
  remarks: string | null
  sequence: number
}

interface FnF {
  id: string
  last_month_payroll: number | null
  leave_encashment: number | null
  gratuity: number | null
  other_additions: number | null
  notice_period_deduction: number | null
  other_deductions: number | null
  net_payable: number | null
  status: 'draft' | 'approved' | 'paid'
}

interface SeparationRow {
  id: string
  employee_id: string
  employee_code: string
  employee_name: string
  department: string | null
  separation_type: string
  last_working_date: string | null
  clearances: ClearanceDept[]
  fnf: FnF | null
  status: 'active' | 'completed'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtMoney(n?: number | null) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

const CLEARANCE_DEPTS: ClearanceDept['department'][] = ['IT', 'Manager', 'Finance', 'Admin', 'HR']

function clearanceCount(clearances: ClearanceDept[]) {
  return clearances.filter(c => c.status === 'cleared').length
}

function ClearanceStatusBadge({ status }: { status: ClearanceDept['status'] }) {
  if (status === 'cleared')  return <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2 py-0.5 text-[10px] font-medium"><CheckCircle2 className="h-3 w-3"/>Cleared</span>
  if (status === 'rejected') return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-[10px] font-medium"><XCircle className="h-3 w-3"/>Rejected</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 text-muted-foreground px-2 py-0.5 text-[10px] font-medium"><Clock className="h-3 w-3"/>Pending</span>
}

function FnFStatusBadge({ status }: { status: FnF['status'] }) {
  if (status === 'paid')     return <Badge variant="success"    className="text-[10px] rounded-full">Paid</Badge>
  if (status === 'approved') return <Badge variant="secondary"  className="text-[10px] rounded-full">Approved</Badge>
  return <Badge variant="secondary" className="text-[10px] rounded-full bg-muted/50">Draft</Badge>
}

// ── Mock data fallback (replace with real API when backend is ready) ──────────
// In production, these come from useQuery hitting the real endpoints.

function buildMockRows(): SeparationRow[] {
  const makeClears = (empId: string): ClearanceDept[] =>
    CLEARANCE_DEPTS.map((dept, i) => ({
      id: `${empId}-${dept}`,
      department: dept,
      status: i < 2 ? 'cleared' : 'pending',
      cleared_by: i < 2 ? 'Admin User' : null,
      cleared_at: i < 2 ? '2025-05-10' : null,
      remarks: null,
      sequence: i + 1,
    }))
  return [
    {
      id: 'sep-1', employee_id: 'emp-1', employee_code: 'EMP001',
      employee_name: 'Arjun Sharma', department: 'Engineering',
      separation_type: 'resignation', last_working_date: '2025-06-15',
      clearances: makeClears('sep-1'),
      fnf: { id: 'fnf-1', last_month_payroll: 85000, leave_encashment: 12000, gratuity: 34000, other_additions: 0, notice_period_deduction: 0, other_deductions: 2000, net_payable: 129000, status: 'draft' },
      status: 'active',
    },
    {
      id: 'sep-2', employee_id: 'emp-2', employee_code: 'EMP045',
      employee_name: 'Priya Menon', department: 'HR',
      separation_type: 'end_of_contract', last_working_date: '2025-05-31',
      clearances: CLEARANCE_DEPTS.map((dept, i) => ({ id: `sep-2-${dept}`, department: dept, status: 'cleared' as const, cleared_by: 'Admin', cleared_at: '2025-05-20', remarks: null, sequence: i + 1 })),
      fnf: { id: 'fnf-2', last_month_payroll: 60000, leave_encashment: 8000, gratuity: 18000, other_additions: 5000, notice_period_deduction: 0, other_deductions: 0, net_payable: 91000, status: 'approved' },
      status: 'active',
    },
    {
      id: 'sep-3', employee_id: 'emp-3', employee_code: 'EMP078',
      employee_name: 'Rahul Iyer', department: 'Finance',
      separation_type: 'termination', last_working_date: '2025-04-30',
      clearances: CLEARANCE_DEPTS.map((dept, i) => ({ id: `sep-3-${dept}`, department: dept, status: 'cleared' as const, cleared_by: 'Admin', cleared_at: '2025-04-28', remarks: null, sequence: i + 1 })),
      fnf: { id: 'fnf-3', last_month_payroll: 72000, leave_encashment: 0, gratuity: 0, other_additions: 0, notice_period_deduction: 72000, other_deductions: 5000, net_payable: -5000, status: 'paid' },
      status: 'completed',
    },
  ]
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{value}/{max} departments cleared</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', value === max ? 'bg-success' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Clearance Panel ───────────────────────────────────────────────────────────

function ClearancePanel({ row, onClose }: { row: SeparationRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [remarkMap, setRemarkMap] = useState<Record<string, string>>({})
  const cleared = clearanceCount(row.clearances)
  const allCleared = cleared === CLEARANCE_DEPTS.length

  const markMutation = useMutation({
    mutationFn: ({ deptId, action, remarks }: { deptId: string; action: 'cleared' | 'rejected'; remarks?: string }) =>
      api.patch(`/separations/${row.id}/clearances/${deptId}`, { status: action, remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['separations'] })
      toast.success('Clearance status updated')
    },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <div className="space-y-6">
      {/* Progress */}
      <ProgressBar value={cleared} max={CLEARANCE_DEPTS.length} />

      {allCleared && (
        <div className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/20 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
          <span className="text-sm font-medium text-success">Clearance Complete — all 5 departments cleared</span>
        </div>
      )}

      {/* Department rows */}
      <div className="space-y-3">
        {row.clearances.sort((a, b) => a.sequence - b.sequence).map(cl => (
          <div key={cl.id} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                  {cl.sequence}
                </div>
                <span className="text-sm font-medium">{cl.department}</span>
              </div>
              <ClearanceStatusBadge status={cl.status} />
            </div>

            {cl.status !== 'pending' && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                {cl.cleared_by && <p>By: <span className="text-foreground">{cl.cleared_by}</span></p>}
                {cl.cleared_at  && <p>On: <span className="text-foreground">{fmtDate(cl.cleared_at)}</span></p>}
                {cl.remarks     && <p>Remarks: <span className="text-foreground">{cl.remarks}</span></p>}
              </div>
            )}

            {cl.status === 'pending' && (
              <div className="space-y-2">
                <Input
                  placeholder="Remarks (optional)"
                  className="h-7 text-xs"
                  value={remarkMap[cl.id] ?? ''}
                  onChange={e => setRemarkMap(m => ({ ...m, [cl.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-success/40 text-success hover:bg-success/10"
                    disabled={markMutation.isPending}
                    onClick={() => markMutation.mutate({ deptId: cl.id, action: 'cleared', remarks: remarkMap[cl.id] })}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />Mark Cleared
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={markMutation.isPending}
                    onClick={() => markMutation.mutate({ deptId: cl.id, action: 'rejected', remarks: remarkMap[cl.id] })}
                  >
                    <XCircle className="h-3.5 w-3.5" />Mark Rejected
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* F&F Section */}
      <FnFSection row={row} />
    </div>
  )
}

// ── F&F Section ───────────────────────────────────────────────────────────────

function FnFSection({ row }: { row: SeparationRow }) {
  const qc = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)

  const emptyFnF = {
    last_month_payroll: 0, leave_encashment: 0, gratuity: 0,
    other_additions: 0, notice_period_deduction: 0, other_deductions: 0,
  }
  const [form, setForm] = useState(emptyFnF)

  function openEdit() {
    const f = row.fnf
    setForm({
      last_month_payroll:     f?.last_month_payroll     ?? 0,
      leave_encashment:       f?.leave_encashment       ?? 0,
      gratuity:               f?.gratuity               ?? 0,
      other_additions:        f?.other_additions        ?? 0,
      notice_period_deduction: f?.notice_period_deduction ?? 0,
      other_deductions:       f?.other_deductions       ?? 0,
    })
    setEditOpen(true)
  }

  const computedNet =
    (form.last_month_payroll + form.leave_encashment + form.gratuity + form.other_additions)
    - (form.notice_period_deduction + form.other_deductions)

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/separations/${row.id}/fnf`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['separations'] })
      toast.success('F&F settlement saved')
      setEditOpen(false)
    },
    onError: (e: Error) => toast.error('Save failed', { description: e.message }),
  })

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/separations/${row.id}/fnf/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['separations'] }); toast.success('F&F approved') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const paidMutation = useMutation({
    mutationFn: () => api.patch(`/separations/${row.id}/fnf/mark-paid`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['separations'] }); toast.success('F&F marked as paid') },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const f = row.fnf

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          F&amp;F Settlement
        </h4>
        <div className="flex items-center gap-2">
          {f && <FnFStatusBadge status={f.status} />}
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openEdit}>
            <Edit2 className="h-3.5 w-3.5" />{f ? 'Edit' : 'Set Values'}
          </Button>
        </div>
      </div>

      {f ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="divide-y divide-border">
            <FnFLine label="Last Month Payroll"      value={fmtMoney(f.last_month_payroll)} />
            <FnFLine label="Leave Encashment"        value={fmtMoney(f.leave_encashment)} />
            <FnFLine label="Gratuity"                value={fmtMoney(f.gratuity)} />
            <FnFLine label="(+) Other Additions"     value={fmtMoney(f.other_additions)} positive />
            <FnFLine label="(-) Notice Period Deduction" value={fmtMoney(f.notice_period_deduction)} negative />
            <FnFLine label="(-) Other Deductions"    value={fmtMoney(f.other_deductions)} negative />
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
              <span className="text-sm font-bold">Net Payable</span>
              <span className={cn('text-lg font-bold', (f.net_payable ?? 0) < 0 ? 'text-destructive' : 'text-foreground')}>
                {fmtMoney(f.net_payable)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground rounded-lg border border-dashed border-border">
          <DollarSign className="h-6 w-6 opacity-30" />
          <p className="text-xs">No F&amp;F values set yet</p>
        </div>
      )}

      {f && (
        <div className="flex gap-2 flex-wrap">
          {f.status === 'draft' && (
            <Button size="sm" variant="outline" className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
              disabled={approveMutation.isPending}
              onClick={() => approveMutation.mutate()}>
              {approveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Approve F&amp;F
            </Button>
          )}
          {f.status === 'approved' && (
            <Button size="sm" variant="outline" className="h-7 text-xs border-success/40 text-success hover:bg-success/10"
              disabled={paidMutation.isPending}
              onClick={() => paidMutation.mutate()}>
              {paidMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Mark as Paid
            </Button>
          )}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit F&amp;F Settlement</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {([
              ['last_month_payroll',      'Last Month Payroll'],
              ['leave_encashment',        'Leave Encashment'],
              ['gratuity',                'Gratuity'],
              ['other_additions',         'Other Additions'],
              ['notice_period_deduction', 'Notice Period Deduction'],
              ['other_deductions',        'Other Deductions'],
            ] as [keyof typeof form, string][]).map(([key, label]) => (
              <div key={key}>
                <Label className="text-xs">{label}</Label>
                <Input
                  type="number"
                  className="mt-1 h-8 text-xs"
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            ))}
            <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold">Computed Net Payable</span>
              <span className={cn('text-sm font-bold', computedNet < 0 ? 'text-destructive' : 'text-foreground')}>
                {fmtMoney(computedNet)}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FnFLine({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className={cn('text-muted-foreground', positive && 'text-success', negative && 'text-destructive')}>{label}</span>
      <span className={cn('font-medium tabular-nums', positive && 'text-success', negative && 'text-destructive')}>{value}</span>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SeparationWorkflow() {
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('employee'))

  const { data, isLoading } = useQuery<{ data: SeparationRow[] }>({
    queryKey: ['separations'],
    queryFn: () => api.get('/separations'),
    staleTime: 30_000,
  })

  const rows = data?.data ?? []

  const filtered = rows.filter(r => {
    if (activeTab === 'all') return true
    if (activeTab === 'pending_clearance') return clearanceCount(r.clearances) < CLEARANCE_DEPTS.length
    if (activeTab === 'fnf_pending') return !r.fnf || r.fnf.status !== 'paid'
    if (activeTab === 'completed') return r.status === 'completed'
    return true
  })

  const selected = selectedId ? rows.find(r => r.id === selectedId || r.employee_id === selectedId) ?? null : null

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all',              label: 'All' },
    { key: 'pending_clearance', label: 'Pending Clearance' },
    { key: 'fnf_pending',      label: 'F&F Pending' },
    { key: 'completed',        label: 'Completed' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-background px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <LogOut className="h-5 w-5 text-muted-foreground" />
              Separation Workflow
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage employee offboarding, clearances, and full &amp; final settlement.
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 mt-4">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                activeTab === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table */}
        <div className={cn('flex flex-col overflow-auto', selected ? 'w-1/2 border-r border-border' : 'w-full')}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Users className="h-7 w-7 opacity-30" />
              <p className="text-sm">No separations found</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Employee', 'Dept', 'Type', 'Last Working Day', 'Clearance', 'F&F Status', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(row => {
                  const cleared = clearanceCount(row.clearances)
                  const isSelected = selected?.id === row.id
                  return (
                    <tr
                      key={row.id}
                      className={cn('transition-colors hover:bg-muted/20', isSelected && 'bg-primary/5')}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-foreground">{row.employee_name}</div>
                        <div className="text-[10px] text-muted-foreground">{row.employee_code}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{row.department ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap capitalize">{row.separation_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDate(row.last_working_date)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{cleared}/{CLEARANCE_DEPTS.length}</span>
                          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', cleared === CLEARANCE_DEPTS.length ? 'bg-success' : 'bg-primary')}
                              style={{ width: `${(cleared / CLEARANCE_DEPTS.length) * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.fnf ? <FnFStatusBadge status={row.fnf.status} /> : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={isSelected ? 'secondary' : 'outline'}
                            className="h-7 text-xs gap-1"
                            onClick={() => setSelectedId(isSelected ? null : row.id)}
                          >
                            {isSelected ? <X className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {isSelected ? 'Close' : 'Manage'}
                          </Button>
                          <Link
                            to={`/employees/${row.employee_id}?tab=separation`}
                            className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-primary/50 transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />Profile
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-1/2 flex flex-col overflow-auto">
            <div className="sticky top-0 bg-background border-b border-border px-6 py-3 flex items-center justify-between z-10">
              <div>
                <h2 className="text-sm font-semibold">{selected.employee_name}</h2>
                <p className="text-[10px] text-muted-foreground">{selected.employee_code} · {selected.department}</p>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setSelectedId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-6 space-y-6">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Separation Type</p>
                  <p className="text-xs font-medium capitalize">{selected.separation_type.replace(/_/g, ' ')}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Last Working Day</p>
                  <p className="text-xs font-medium">{fmtDate(selected.last_working_date)}</p>
                </Card>
                <Card className="p-3">
                  <p className="text-[10px] text-muted-foreground mb-0.5">F&amp;F Status</p>
                  <p className="text-xs font-medium capitalize">{selected.fnf?.status ?? 'Not set'}</p>
                </Card>
              </div>

              {/* Clearance section */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    Clearance Workflow
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ClearancePanel row={selected} onClose={() => setSelectedId(null)} />
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SeparationWorkflow
