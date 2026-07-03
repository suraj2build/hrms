/**
 * CompOff — /admin/comp-off
 *
 * Compensatory Off management for HR admins and managers.
 *
 * Tabs:
 *   Requests     — list pending / approved / rejected comp-off requests with approve/reject actions
 *   Generate     — scan a date range for qualifying work (worked on holiday / weekly-off) and auto-create requests
 *   Summary      — quick stats: pending, approved this month, total balance by employee
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarPlus, ShieldAlert, RefreshCw, CheckCircle2,
  Loader2, Clock, CalendarRange, BarChart2, Check, X,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { toast }         from 'sonner'
import { cn }            from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type CompOffStatus = 'pending' | 'approved' | 'rejected'
type WorkedReason  = 'holiday' | 'weekly_off'

interface CompOffRequest {
  id:              string
  employee_id:     string
  worked_date:     string
  worked_reason:   WorkedReason
  days_to_credit:  number
  status:          CompOffStatus
  leave_type_id:   string | null
  notes:           string | null
  approved_by:     string | null
  approved_at:     string | null
  created_at:      string
  employees?:      { id: string; first_name: string; last_name: string; employee_code: string }
  leave_types?:    { id: string; name: string }
}

interface GenerateResult {
  data: { created: number; skipped: number; message?: string }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<CompOffStatus, 'warning' | 'success' | 'destructive'> = {
  pending:  'warning',
  approved: 'success',
  rejected: 'destructive',
}

const STATUS_LABEL: Record<CompOffStatus, string> = {
  pending:  'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

const REASON_LABEL: Record<WorkedReason, string> = {
  holiday:   'Worked on Holiday',
  weekly_off: 'Worked on Weekly Off',
}

function fmt(dateStr: string) {
  const s = dateStr
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CompOff() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin', 'manager'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  const [statusFilter, setStatusFilter] = useState<CompOffStatus | ''>('')
  const [actionRowId,  setActionRowId]  = useState<string | null>(null)
  const [notes,        setNotes]        = useState('')

  // Generate form
  const [genFrom,    setGenFrom]    = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10)
  })
  const [genTo,      setGenTo]      = useState(() => new Date().toISOString().slice(0, 10))
  const [genEmpId,   setGenEmpId]   = useState('')
  const [genLeaveId, setGenLeaveId] = useState('')
  const [genResult,  setGenResult]  = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useQuery<{ data: CompOffRequest[] }>({
    queryKey: ['comp-off', statusFilter],
    queryFn:  () => {
      const qs = statusFilter ? `?status=${statusFilter}` : ''
      return api.get(`/attendance/comp-off${qs}`)
    },
    staleTime: 30_000,
  })
  const requests = data?.data ?? []

  const { data: leaveTypesData } = useQuery<{ data: Array<{ id: string; name: string; is_active?: boolean }> }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    staleTime: 60_000,
  })
  const leaveTypes = (leaveTypesData?.data ?? []).filter((lt) => lt.is_active)

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ['comp-off'] })

  const approveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      api.post(`/attendance/comp-off/${id}/approve`, { notes }),
    onSuccess: () => {
      invalidate()
      setActionRowId(null)
      setNotes('')
      toast.success('Comp-off approved and balance credited')
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.error === 'PERIOD_LOCKED') {
        toast.error('Period locked', { description: 'This request belongs to a locked attendance period and can no longer be modified.' })
      } else {
        toast.error('Approval failed', { description: e.message })
      }
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      api.post(`/attendance/comp-off/${id}/reject`, { notes }),
    onSuccess: () => {
      invalidate()
      setActionRowId(null)
      setNotes('')
      toast.success('Comp-off request rejected')
    },
    onError: (e: Error) => toast.error('Rejection failed', { description: e.message }),
  })

  const generateMutation = useMutation({
    mutationFn: () => api.post<GenerateResult>('/attendance/comp-off/generate', {
      from_date:     genFrom,
      to_date:       genTo,
      ...(genEmpId   ? { employee_id:   genEmpId }   : {}),
      ...(genLeaveId ? { leave_type_id: genLeaveId } : {}),
    }),
    onSuccess: (res: GenerateResult) => {
      invalidate()
      const r = res.data
      setGenResult(`Generated ${r.created} new request(s). ${r.skipped > 0 ? `${r.skipped} already existed.` : ''}`)
      toast.success(`Generated ${r.created} comp-off request(s)`)
    },
    onError: (e: Error) => toast.error('Generation failed', { description: e.message }),
  })

  // ── Stats ──────────────────────────────────────────────────────────────────
  const allRequests  = (data?.data ?? [])
  const pendingCount  = allRequests.filter(r => r.status === 'pending').length
  const approvedCount = allRequests.filter(r => r.status === 'approved').length
  const totalDays     = allRequests.filter(r => r.status === 'approved').reduce((s, r) => s + r.days_to_credit, 0)

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 opacity-40" />
          <p className="text-sm">Manager or HR Admin access required.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Comp-Off Management"
        subtitle="Compensatory off for work done on holidays and weekly-off days"
      />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-2">
        {[
          { label: 'Pending Approval', value: pendingCount,  icon: Clock,         cls: 'text-warning' },
          { label: 'Approved',         value: approvedCount, icon: CheckCircle2,  cls: 'text-success' },
          { label: 'Total Days Credited', value: `${totalDays}d`, icon: CalendarRange, cls: 'text-info' },
        ].map(({ label, value, icon: Icon, cls }) => (
          <SectionCard key={label}>
            <div className="flex items-center gap-3">
              <div className={cn('p-2 rounded-lg bg-muted/50', cls)}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className={cn('text-xl font-bold', cls)}>{value}</p>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      <Tabs defaultValue="requests">
        <TabsList className="bg-card border border-border mb-4">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="generate">Generate</TabsTrigger>
        </TabsList>

        {/* ── Requests Tab ────────────────────────────────────────────────── */}
        <TabsContent value="requests">
          <SectionCard
            title="Comp-Off Requests"
            icon={<CalendarPlus className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as CompOffStatus | '')}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => refetch()} disabled={isLoading}>
                  <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                </Button>
              </div>
            }
          >
            {isLoading ? (
              <div className="space-y-2 animate-pulse py-4">
                {[1,2,3].map(i => <div key={i} className="h-12 bg-muted rounded-lg" />)}
              </div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <CalendarPlus className="h-8 w-8 opacity-30" />
                <p className="text-sm">No comp-off requests found.</p>
                <p className="text-xs">Use the Generate tab to scan for qualifying attendance records.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {['Employee', 'Worked Date', 'Reason', 'Days', 'Leave Type', 'Status', 'Actions'].map(h => (
                        <th key={h} className="text-left text-xs text-muted-foreground font-semibold px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(req => (
                      <>
                        <tr key={req.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2.5">
                            {req.employees ? (
                              <div>
                                <span className="font-medium text-foreground">
                                  {req.employees.first_name} {req.employees.last_name}
                                </span>
                                <div className="text-[10px] text-muted-foreground">#{req.employees.employee_code}</div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">{(req.employee_id ?? '').slice(0, 8)}…</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-xs">{fmt(req.worked_date)}</td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline" className="text-[10px] rounded-full">
                              {REASON_LABEL[req.worked_reason]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 text-xs font-medium">{req.days_to_credit}d</td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {req.leave_types?.name ?? '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant={STATUS_VARIANT[req.status]} className="text-[10px] rounded-full">
                              {STATUS_LABEL[req.status]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            {req.status === 'pending' && (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-success hover:text-success"
                                  title="Approve"
                                  onClick={() => setActionRowId(actionRowId === req.id ? null : req.id)}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  title="Reject"
                                  onClick={() => rejectMutation.mutate({ id: req.id, notes })}
                                  disabled={rejectMutation.isPending}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                            {req.status === 'approved' && req.approved_at && (
                              <span className="text-[10px] text-muted-foreground">{fmt(req.approved_at)}</span>
                            )}
                          </td>
                        </tr>
                        {/* Inline approval panel */}
                        {actionRowId === req.id && (
                          <tr key={`${req.id}-action`} className="bg-success/5 border-b border-border/50">
                            <td colSpan={7} className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-foreground font-medium">Add notes (optional):</span>
                                <Input
                                  value={notes}
                                  onChange={e => setNotes(e.target.value)}
                                  placeholder="Approval notes…"
                                  className="h-7 text-xs flex-1 max-w-xs"
                                />
                                <Button
                                  size="sm"
                                  className="h-7 gap-1 text-xs"
                                  disabled={approveMutation.isPending}
                                  onClick={() => approveMutation.mutate({ id: req.id, notes })}
                                >
                                  {approveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                  Confirm Approve
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setActionRowId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Generate Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="generate">
          <SectionCard
            title="Generate Comp-Off Requests"
            icon={<BarChart2 className="h-4 w-4 text-muted-foreground" />}
          >
            <p className="text-xs text-muted-foreground mb-4">Scan attendance records for qualifying worked-on-holiday or worked-on-weekly-off days</p>
            <div className="space-y-4 max-w-lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">From Date</label>
                  <DateInput value={genFrom} onChange={setGenFrom} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">To Date</label>
                  <DateInput value={genTo} min={genFrom} onChange={setGenTo} className="h-8 text-xs" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Employee <span className="text-muted-foreground">(optional — omit to process all employees)</span></label>
                <EmployeeSelector
                  value={genEmpId}
                  onChange={v => setGenEmpId(typeof v === 'string' ? v : (v[0] ?? ''))}
                  placeholder="All active employees"
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Comp-Off Leave Type <span className="text-muted-foreground">(optional)</span></label>
                <select
                  value={genLeaveId}
                  onChange={e => setGenLeaveId(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="">Select leave type…</option>
                  {leaveTypes.map(lt => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 items-center">
                <Button
                  onClick={() => { setGenResult(null); generateMutation.mutate() }}
                  disabled={!genFrom || !genTo || generateMutation.isPending}
                  className="gap-1.5"
                >
                  {generateMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <CalendarPlus className="h-3.5 w-3.5" />
                  }
                  Generate Requests
                </Button>
              </div>

              {genResult && (
                <div className="flex items-center gap-2 text-sm p-3 rounded-md bg-success/10 border border-success/20 text-success">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  {genResult}
                </div>
              )}

              <div className="p-3 rounded-md bg-muted/40 border border-border text-xs space-y-1.5">
                <p className="font-semibold text-foreground">How it works</p>
                <ul className="space-y-1 text-muted-foreground list-disc pl-4">
                  <li>Scans <code>attendance_daily</code> for rows where <code>worked_on_holiday = true</code> or <code>worked_on_weekly_off = true</code></li>
                  <li>Creates one comp-off request per qualifying day (idempotent — duplicates skipped)</li>
                  <li>Generated requests appear in the Requests tab with status <Badge variant="warning" className="text-[10px] rounded-full">Pending</Badge></li>
                  <li>Approving a request credits the employee's leave balance with the configured expiry</li>
                </ul>
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
