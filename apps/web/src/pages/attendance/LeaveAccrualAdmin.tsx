/**
 * LeaveAccrualAdmin — /admin/leave/accrual
 *
 * Comprehensive admin page for:
 * 1. Accrual Rules — define per-leave-type accrual schedules
 * 2. Manual Accrual — trigger month accrual on demand
 * 3. Carry-Forward — process year-end carry-forward
 * 4. Run History — view past accrual runs
 * 5. Encashment Requests — approve/reject leave encashment
 *
 * Access: hr_admin and super_admin only.
 * Design: design-system tokens only.
 */

import { useState }                                      from 'react'
import { useQuery, useMutation, useQueryClient }         from '@tanstack/react-query'
import { useNavigate }                                   from 'react-router-dom'
import { toast }                                         from 'sonner'
import {
  BookOpen, ShieldAlert, Plus, Pencil, Trash2,
  CheckCircle2, XCircle, BadgeCheck,
  Loader2, ChevronDown, ChevronUp, RefreshCw,
  Coins, Activity, ExternalLink,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Badge }          from '@/components/ui/badge'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { DateInput }      from '@/components/ui/date-input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveType { id: string; name: string; is_paid: boolean; is_active: boolean }

interface AccrualRule {
  id:                          string
  leave_type_id:               string
  accrual_frequency:           'monthly' | 'quarterly' | 'annually' | 'on_joining'
  days_per_period:             number
  prorate_on_joining:          boolean
  carry_forward_max:           number
  carry_forward_expiry_months: number
  encashable:                  boolean
  max_encashable_per_year:     number
  effective_from:              string
  effective_to:                string | null
  is_active:                   boolean
  leave_types:                 { id: string; name: string } | null
}

interface AccrualRun {
  id:                  string
  run_period:          string
  leave_type_id:       string | null
  employees_credited:  number
  total_days_credited: number
  status:              'success' | 'partial' | 'failed'
  error_message:       string | null
  ran_at:              string
  leave_types:         { id: string; name: string } | null
}

interface EncashmentRequest {
  id:            string
  employee_id:   string
  leave_type_id: string
  year:          number
  days:          number
  status:        'pending' | 'approved' | 'rejected' | 'paid'
  notes:         string | null
  created_at:    string
  employee_name: string | null
  employee_code: string | null
  leave_types:   { id: string; name: string } | null
}

interface RuleFormState {
  leave_type_id:               string
  accrual_frequency:           'monthly' | 'quarterly' | 'annually' | 'on_joining'
  days_per_period:             string
  prorate_on_joining:          boolean
  carry_forward_max:           string
  carry_forward_expiry_months: string
  encashable:                  boolean
  max_encashable_per_year:     string
  effective_from:              string
  effective_to:                string
  is_active:                   boolean
}

const DEFAULT_FORM: RuleFormState = {
  leave_type_id:               '',
  accrual_frequency:           'monthly',
  days_per_period:             '1.5',
  prorate_on_joining:          true,
  carry_forward_max:           '0',
  carry_forward_expiry_months: '3',
  encashable:                  false,
  max_encashable_per_year:     '0',
  effective_from:              new Date().toISOString().slice(0, 10),
  effective_to:                '',
  is_active:                   true,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function fmtDate(str: string | null) {
  if (!str) return '—'
  const s = str
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

type BadgeVariant = 'default' | 'secondary' | 'warning' | 'destructive' | 'outline' | 'success'

const RUN_VARIANT: Record<string, BadgeVariant> = { success: 'success', partial: 'warning', failed: 'destructive' }
const ENC_VARIANT: Record<string, BadgeVariant> = { pending: 'warning', approved: 'success', rejected: 'destructive', paid: 'outline' }
const FREQ_LABELS: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annual', on_joining: 'On Joining' }

// ── Main Component ─────────────────────────────────────────────────────────────

export function LeaveAccrualAdmin() {
  const { profile } = useAuthStore()
  const isAdmin     = profile?.role === 'super_admin' || profile?.role === 'hr_admin'
  const qc          = useQueryClient()
  const navigate    = useNavigate()

  // ── Rule dialog state ──────────────────────────────────────────────────────
  const [ruleDialog, setRuleDialog]     = useState(false)
  const [editingRule, setEditingRule]   = useState<AccrualRule | null>(null)
  const [ruleForm, setRuleForm]         = useState<RuleFormState>(DEFAULT_FORM)
  const [expandedRule, setExpandedRule] = useState<string | null>(null)

  // Manual run state removed — use Leave Engine Status page for recovery operations

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: leaveTypesResp } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const leaveTypes = (leaveTypesResp?.data ?? []).filter(lt => lt.is_active)

  const { data: rulesResp, isLoading: rulesLoading, refetch: refetchRules } = useQuery<{ data: AccrualRule[] }>({
    queryKey: ['accrual-rules'],
    queryFn:  () => api.get('/leave/accrual/rules'),
    enabled:  isAdmin,
    staleTime: 60_000,
  })
  const rules = rulesResp?.data ?? []

  const { data: runsResp, isLoading: runsLoading, refetch: refetchRuns } = useQuery<{ data: AccrualRun[]; total: number }>({
    queryKey: ['accrual-runs'],
    queryFn:  () => api.get('/leave/accrual/runs?limit=30'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const runs = runsResp?.data ?? []

  const { data: encResp, isLoading: encLoading, refetch: refetchEnc } = useQuery<{ data: EncashmentRequest[] }>({
    queryKey: ['encashment-pending'],
    queryFn:  () => api.get('/leave/encashment/pending'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const encashments = encResp?.data ?? []

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createRuleMutation = useMutation({
    mutationFn: (body: object) => api.post('/leave/accrual/rules', body),
    onSuccess: () => { refetchRules(); setRuleDialog(false); toast.success('Accrual rule created') },
    onError: (e) => toast.error('Failed to create rule', { description: (e as Error).message }),
  })

  const updateRuleMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.put(`/leave/accrual/rules/${id}`, body),
    onSuccess: () => { refetchRules(); setRuleDialog(false); setEditingRule(null); toast.success('Accrual rule updated') },
    onError: (e) => toast.error('Failed to update rule', { description: (e as Error).message }),
  })

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leave/accrual/rules/${id}`),
    onSuccess: () => { refetchRules(); toast.success('Rule deactivated') },
    onError: (e) => toast.error('Failed to deactivate rule', { description: (e as Error).message }),
  })

  const approveEncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave/encashment/${id}/approve`, {}),
    onSuccess: () => { refetchEnc(); qc.invalidateQueries({ queryKey: ['leave-balance'] }); toast.success('Encashment approved') },
    onError: (e) => toast.error('Approval failed', { description: (e as Error).message }),
  })

  const rejectEncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave/encashment/${id}/reject`, {}),
    onSuccess: () => { refetchEnc(); toast.success('Encashment rejected') },
    onError: (e) => toast.error('Rejection failed', { description: (e as Error).message }),
  })

  const markPaidMutation = useMutation({
    mutationFn: (id: string) => api.post(`/leave/encashment/${id}/mark-paid`, {}),
    onSuccess: () => { refetchEnc(); toast.success('Marked as paid') },
    onError: (e) => toast.error('Failed', { description: (e as Error).message }),
  })

  // Manual accrual run (other than the scheduler) — credits the given month now.
  const [accrualPeriod, setAccrualPeriod] = useState(() => new Date().toISOString().slice(0, 7))
  const runAccrualMutation = useMutation({
    mutationFn: (period: string) => api.post('/leave/accrual/run', { period }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accrual-runs'] })
      qc.invalidateQueries({ queryKey: ['leave-balance'] })
      toast.success('Accrual run complete', { description: `Credited leave for ${accrualPeriod}` })
    },
    onError: (e) => toast.error('Accrual run failed', { description: (e as Error).message }),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  function openCreateRule() {
    setEditingRule(null)
    setRuleForm(DEFAULT_FORM)
    setRuleDialog(true)
  }

  function openEditRule(rule: AccrualRule) {
    setEditingRule(rule)
    setRuleForm({
      leave_type_id:               rule.leave_type_id,
      accrual_frequency:           rule.accrual_frequency,
      days_per_period:             String(rule.days_per_period),
      prorate_on_joining:          rule.prorate_on_joining,
      carry_forward_max:           String(rule.carry_forward_max),
      carry_forward_expiry_months: String(rule.carry_forward_expiry_months),
      encashable:                  rule.encashable,
      max_encashable_per_year:     String(rule.max_encashable_per_year),
      effective_from:              rule.effective_from,
      effective_to:                rule.effective_to ?? '',
      is_active:                   rule.is_active,
    })
    setRuleDialog(true)
  }

  function handleSaveRule() {
    const body = {
      leave_type_id:               ruleForm.leave_type_id,
      accrual_frequency:           ruleForm.accrual_frequency,
      days_per_period:             parseFloat(ruleForm.days_per_period),
      prorate_on_joining:          ruleForm.prorate_on_joining,
      carry_forward_max:           parseFloat(ruleForm.carry_forward_max),
      carry_forward_expiry_months: parseInt(ruleForm.carry_forward_expiry_months, 10),
      encashable:                  ruleForm.encashable,
      max_encashable_per_year:     parseFloat(ruleForm.max_encashable_per_year),
      effective_from:              ruleForm.effective_from,
      effective_to:                ruleForm.effective_to || null,
      is_active:                   ruleForm.is_active,
    }
    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, body })
    } else {
      createRuleMutation.mutate(body)
    }
  }

  function pf(f: keyof RuleFormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setRuleForm(p => ({ ...p, [f]: e.target.value }))
  }

  function pfBool(f: keyof RuleFormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setRuleForm(p => ({ ...p, [f]: e.target.checked }))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Leave Accrual" subtitle="Manage accrual rules, carry-forward, and encashment" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive/70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can manage accrual rules.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Leave Accrual"
        subtitle="Configure accrual rules, run accruals, manage carry-forward and encashment"
        actions={
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreateRule}>
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </Button>
        }
      />

      {/* Automation notice */}
      <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Activity className="h-4 w-4 text-primary" />
          <div className="text-xs">
            <p className="font-medium text-foreground">Accrual runs automatically</p>
            <p className="text-muted-foreground">Monthly credits, carry-forward and expiry are fully scheduler-driven.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Manual accrual run — alternative to the scheduler */}
          <input
            type="month"
            value={accrualPeriod}
            onChange={e => setAccrualPeriod(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50"
          />
          <Button
            size="sm" className="h-8 text-xs gap-1.5"
            disabled={runAccrualMutation.isPending || !accrualPeriod}
            onClick={() => runAccrualMutation.mutate(accrualPeriod)}
          >
            {runAccrualMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            Run Accrual Now
          </Button>
          <Button
            size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            onClick={() => navigate('/admin/leave-jobs')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Engine Status
          </Button>
        </div>
      </div>

      <Tabs defaultValue="rules">
        <TabsList className="mb-4">
          <TabsTrigger value="rules" className="text-xs gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Rules
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Run History
          </TabsTrigger>
          <TabsTrigger value="encashment" className="text-xs gap-1.5">
            <Coins className="h-3.5 w-3.5" /> Encashment {encashments.length > 0 && (
              <Badge variant="warning" className="rounded-full text-[9px] px-1.5 py-0 ml-1">{encashments.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Rules Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="rules">
          <SectionCard
            title={`Accrual Rules (${rules.length})`}
            icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetchRules()}>
                <RefreshCw className={cn('h-3.5 w-3.5', rulesLoading && 'animate-spin')} />
              </Button>
            }
          >
            {rules.length === 0 && !rulesLoading && (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No accrual rules configured. Click "Add Rule" to create one.
              </div>
            )}
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="border border-border rounded-lg overflow-hidden">
                  {/* Rule header row */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {rule.leave_types?.name ?? '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {FREQ_LABELS[rule.accrual_frequency]} · {rule.days_per_period} day/period
                          {rule.carry_forward_max > 0 && ` · CF max ${rule.carry_forward_max}`}
                          {rule.encashable && ' · Encashable'}
                        </p>
                      </div>
                      <Badge
                        variant={rule.is_active ? 'success' : 'secondary'}
                        className="rounded-full text-[10px]"
                      >
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={e => { e.stopPropagation(); openEditRule(rule) }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={e => { e.stopPropagation(); deleteRuleMutation.mutate(rule.id) }}
                        disabled={deleteRuleMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      {expandedRule === rule.id
                        ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </div>
                  </div>

                  {/* Expanded details */}
                  {expandedRule === rule.id && (
                    <div className="border-t border-border bg-muted/20 px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      {[
                        { label: 'Frequency',         value: FREQ_LABELS[rule.accrual_frequency] },
                        { label: 'Days / Period',      value: rule.days_per_period },
                        { label: 'Pro-rate Joining',   value: rule.prorate_on_joining ? 'Yes' : 'No' },
                        { label: 'CF Max (days)',       value: rule.carry_forward_max },
                        { label: 'CF Expiry (months)', value: rule.carry_forward_expiry_months || '—' },
                        { label: 'Encashable',         value: rule.encashable ? 'Yes' : 'No' },
                        { label: 'Max Encashable/Yr',  value: rule.max_encashable_per_year || '—' },
                        { label: 'Effective From',     value: fmtDate(rule.effective_from) },
                        { label: 'Effective To',       value: rule.effective_to ? fmtDate(rule.effective_to) : 'Open-ended' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-muted-foreground mb-0.5">{label}</p>
                          <p className="font-medium text-foreground">{value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Run History Tab ────────────────────────────────────────────── */}
        <TabsContent value="history">
          <SectionCard
            title="Accrual Run History"
            icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetchRuns()}>
                <RefreshCw className={cn('h-3.5 w-3.5', runsLoading && 'animate-spin')} />
              </Button>
            }
          >
            {runs.length === 0 && !runsLoading && (
              <div className="py-8 text-center text-xs text-muted-foreground">No accrual runs yet.</div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Period', 'Leave Type', 'Employees', 'Days Credited', 'Status', 'Ran At'].map(h => (
                      <th key={h} className="text-left font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => (
                    <tr key={run.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-medium">{run.run_period}</td>
                      <td className="px-3 py-2">{run.leave_types?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{run.employees_credited}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-success">{run.total_days_credited}</td>
                      <td className="px-3 py-2">
                        <Badge variant={RUN_VARIANT[run.status]} className="rounded-full text-[10px] capitalize">
                          {run.status}
                        </Badge>
                        {run.error_message && (
                          <p className="text-[10px] text-destructive mt-0.5 max-w-[200px] truncate" title={run.error_message}>
                            {run.error_message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDatetime(run.ran_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Encashment Tab ─────────────────────────────────────────────── */}
        <TabsContent value="encashment">
          <SectionCard
            title={`Pending Encashment Requests (${encashments.length})`}
            icon={<Coins className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetchEnc()}>
                <RefreshCw className={cn('h-3.5 w-3.5', encLoading && 'animate-spin')} />
              </Button>
            }
          >
            {encashments.length === 0 && !encLoading && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No pending encashment requests.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Employee', 'Leave Type', 'Year', 'Days', 'Status', 'Submitted', 'Actions'].map(h => (
                      <th key={h} className="text-left font-semibold text-muted-foreground px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {encashments.map(enc => (
                    <tr key={enc.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{enc.employee_name ?? '—'}</p>
                        {enc.employee_code && <p className="text-muted-foreground font-mono">{enc.employee_code}</p>}
                      </td>
                      <td className="px-3 py-2">{enc.leave_types?.name ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{enc.year}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold text-foreground">{enc.days}</td>
                      <td className="px-3 py-2">
                        <Badge variant={ENC_VARIANT[enc.status]} className="rounded-full text-[10px] capitalize">
                          {enc.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDatetime(enc.created_at)}</td>
                      <td className="px-3 py-2">
                        {enc.status === 'pending' && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm" variant="outline"
                              className="h-6 text-[10px] px-2 gap-0.5 border-success/40 text-success hover:bg-success/10"
                              disabled={approveEncMutation.isPending}
                              onClick={() => approveEncMutation.mutate(enc.id)}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Approve
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="h-6 text-[10px] px-2 gap-0.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                              disabled={rejectEncMutation.isPending}
                              onClick={() => rejectEncMutation.mutate(enc.id)}
                            >
                              <XCircle className="h-3 w-3" /> Reject
                            </Button>
                          </div>
                        )}
                        {enc.status === 'approved' && (
                          <Button
                            size="sm" variant="outline"
                            className="h-6 text-[10px] px-2 gap-0.5"
                            disabled={markPaidMutation.isPending}
                            onClick={() => markPaidMutation.mutate(enc.id)}
                          >
                            <BadgeCheck className="h-3 w-3" /> Mark Paid
                          </Button>
                        )}
                        {(enc.status === 'rejected' || enc.status === 'paid') && (
                          <span className="text-muted-foreground capitalize">{enc.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ── Rule Create/Edit Dialog ─────────────────────────────────────── */}
      <Dialog open={ruleDialog} onOpenChange={(open: boolean) => { if (!open) { setRuleDialog(false); setEditingRule(null) } }}>
        <DialogContent className="max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Accrual Rule' : 'Create Accrual Rule'}</DialogTitle>
            <DialogDescription className="text-xs">
              Define how leave accrues for a specific leave type.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Leave Type */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Leave Type *</label>
              <select
                value={ruleForm.leave_type_id}
                onChange={pf('leave_type_id')}
                disabled={!!editingRule}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50 disabled:opacity-50"
              >
                <option value="">Select leave type…</option>
                {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
              </select>
            </div>

            {/* Frequency + Days */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Frequency</label>
                <select
                  value={ruleForm.accrual_frequency}
                  onChange={pf('accrual_frequency')}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                  <option value="on_joining">On Joining</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Days / Period</label>
                <Input type="number" min={0.1} max={100} step={0.5} value={ruleForm.days_per_period} onChange={pf('days_per_period')} className="h-8 text-xs" />
              </div>
            </div>

            {/* Pro-rate */}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="prorate" checked={ruleForm.prorate_on_joining} onChange={pfBool('prorate_on_joining')} className="h-4 w-4 rounded accent-primary" />
              <label htmlFor="prorate" className="text-xs text-foreground">Pro-rate accrual for mid-period joiners</label>
            </div>

            {/* Carry-forward */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Carry-Forward Max (days)</label>
                <Input type="number" min={0} max={365} step={0.5} value={ruleForm.carry_forward_max} onChange={pf('carry_forward_max')} className="h-8 text-xs" />
                <p className="text-[10px] text-muted-foreground">0 = no carry-forward</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">CF Expiry (months into new year)</label>
                <Input type="number" min={0} max={12} value={ruleForm.carry_forward_expiry_months} onChange={pf('carry_forward_expiry_months')} className="h-8 text-xs" />
                <p className="text-[10px] text-muted-foreground">0 = never expires</p>
              </div>
            </div>

            {/* Encashment */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="encashable" checked={ruleForm.encashable} onChange={pfBool('encashable')} className="h-4 w-4 rounded accent-primary" />
                <label htmlFor="encashable" className="text-xs text-foreground">Allow leave encashment</label>
              </div>
              {ruleForm.encashable && (
                <div className="space-y-1 ml-6">
                  <label className="text-xs font-medium text-muted-foreground">Max Encashable Days / Year</label>
                  <Input type="number" min={0} max={365} step={0.5} value={ruleForm.max_encashable_per_year} onChange={pf('max_encashable_per_year')} className="h-8 text-xs w-32" />
                </div>
              )}
            </div>

            {/* Effective dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Effective From *</label>
                <DateInput value={ruleForm.effective_from} onChange={v => setRuleForm(p => ({ ...p, effective_from: v }))} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Effective To (optional)</label>
                <DateInput value={ruleForm.effective_to} onChange={v => setRuleForm(p => ({ ...p, effective_to: v }))} min={ruleForm.effective_from} className="h-8 text-xs" />
              </div>
            </div>

            {/* Active */}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={ruleForm.is_active} onChange={pfBool('is_active')} className="h-4 w-4 rounded accent-primary" />
              <label htmlFor="is_active" className="text-xs text-foreground">Rule is active</label>
            </div>
          </div>

          <div className="flex gap-2 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" className="flex-1 h-8 text-xs" onClick={() => setRuleDialog(false)}>Cancel</Button>
            <Button
              size="sm" className="flex-1 h-8 text-xs"
              disabled={!ruleForm.leave_type_id || !ruleForm.days_per_period || createRuleMutation.isPending || updateRuleMutation.isPending}
              onClick={handleSaveRule}
            >
              {(createRuleMutation.isPending || updateRuleMutation.isPending)
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Saving…</>
                : editingRule ? 'Update Rule' : 'Create Rule'
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
