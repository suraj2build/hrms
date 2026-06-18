/**
 * AttendancePolicy — /admin/attendance/policy
 *
 * Policy hub for attendance computation rules.
 *
 * Layout:
 *   Header — title + description
 *   Policies list (left panel) — tabs for each named policy; default badge
 *   Policy form (right panel) — edit all thresholds inline
 *   Employee Assignments section — assign non-default employees to a policy
 *
 * What a policy controls:
 *   • grace_minutes            — minutes after shift start before "late"
 *   • late_cap_minutes         — maximum late_minutes stored (payroll safety)
 *   • present_threshold_pct    — % of shift to be PRESENT
 *   • half_day_threshold_pct   — % of shift to be HALF_DAY
 *   • excessive_hours_threshold — anomaly detection threshold
 */

import { useState }                              from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Settings2, ShieldAlert, Plus, Trash2, Star, Loader2,
  Check, ChevronRight, Users, AlertCircle, Info,
} from 'lucide-react'

import { PageContainer }  from '@/components/layout/PageContainer'
import { PageHeader }     from '@/components/layout/PageHeader'
import { SectionCard }    from '@/components/layout/SectionCard'
import { Button }         from '@/components/ui/button'
import { Input }          from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { Badge }          from '@/components/ui/badge'
import { FormField }      from '@/components/forms/FormField'
import { api }            from '@/lib/api/client'
import { useAuthStore }   from '@/stores/authStore'
import { toast }          from 'sonner'
import { cn }             from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AttendancePolicyRow {
  id:                        string
  name:                      string
  grace_minutes:             number
  late_cap_minutes:          number
  present_threshold_pct:     number
  half_day_threshold_pct:    number
  excessive_hours_threshold: number
  is_default:                boolean
  created_at:                string
  updated_at:                string
}

interface AssignmentRow {
  id:          string
  employee_id: string
  policy_id:   string
  employees: { id: string; first_name: string; last_name: string; employee_code: string }
  attendance_policies: { id: string; name: string }
}

const EMPTY_FORM = {
  name:                      '',
  grace_minutes:             15,
  late_cap_minutes:          240,
  present_threshold_pct:     75,
  half_day_threshold_pct:    50,
  excessive_hours_threshold: 12,
}

// ── Field descriptions ─────────────────────────────────────────────────────────

const FIELD_HINTS: Record<string, string> = {
  grace_minutes:             'Minutes after shift start before a punch-in counts as Late (0 = no grace)',
  late_cap_minutes:          'Maximum late_minutes stored — prevents outlier data affecting payroll',
  present_threshold_pct:     '% of shift duration required to be marked Present (e.g. 75 = ¾ of shift)',
  half_day_threshold_pct:    '% of shift duration required to be marked Half Day (must be < Present %)',
  excessive_hours_threshold: 'Hours per day above which an Excessive Hours anomaly is flagged (0 = disabled)',
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PolicyCard({
  policy,
  selected,
  onClick,
}: {
  policy:   AttendancePolicyRow
  selected: boolean
  onClick:  () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
        selected
          ? 'bg-primary/10 border-primary/30 text-foreground'
          : 'bg-card border-border text-muted-foreground hover:bg-muted/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground truncate">{policy.name}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {policy.is_default && (
            <Badge variant="success" className="text-[10px] rounded-full px-1.5">Default</Badge>
          )}
          {selected && <ChevronRight className="h-3.5 w-3.5 text-primary" />}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">
        Grace: {policy.grace_minutes}m · Present: {policy.present_threshold_pct}% · Late cap: {policy.late_cap_minutes}m
      </div>
    </button>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label:    string
  value:    number
  onChange: (v: number) => void
  min:      number
  max:      number
  step?:    number
  hint?:    string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <Input
        type="number"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="h-8 text-sm"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function AttendancePolicy() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()

  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [showCreate,   setShowCreate]   = useState(false)
  const [form,         setForm]         = useState<typeof EMPTY_FORM>(EMPTY_FORM)
  const [assignEmpId,  setAssignEmpId]  = useState('')
  const [assignPolId,  setAssignPolId]  = useState('')

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: policiesData, isLoading } = useQuery<{ data: AttendancePolicyRow[] }>({
    queryKey: ['attendance-policies'],
    queryFn:  () => api.get('/masters/attendance-policies'),
    staleTime: 30_000,
  })
  const policies = policiesData?.data ?? []

  const { data: assignmentsData } = useQuery<{ data: AssignmentRow[] }>({
    queryKey: ['attendance-policy-assignments'],
    queryFn:  () => api.get('/masters/attendance-policies/assignments'),
    enabled:  isAdmin,
    staleTime: 30_000,
  })
  const assignments = assignmentsData?.data ?? []

  const selected = policies.find(p => p.id === selectedId) ?? null

  // Sync form when selection changes
  function selectPolicy(p: AttendancePolicyRow) {
    setSelectedId(p.id)
    setShowCreate(false)
    setForm({
      name:                      p.name,
      grace_minutes:             p.grace_minutes,
      late_cap_minutes:          p.late_cap_minutes,
      present_threshold_pct:     p.present_threshold_pct,
      half_day_threshold_pct:    p.half_day_threshold_pct,
      excessive_hours_threshold: p.excessive_hours_threshold,
    })
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['attendance-policies'] })
    qc.invalidateQueries({ queryKey: ['attendance-policy-assignments'] })
  }

  const createMutation = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => api.post('/masters/attendance-policies', body),
    onSuccess: (res: any) => {
      invalidate()
      setShowCreate(false)
      setSelectedId(res.data.id)
      setForm(EMPTY_FORM)
      toast.success('Policy created')
    },
    onError: (e: Error) => toast.error('Create failed', { description: e.message }),
  })

  const updateMutation = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) =>
      api.put(`/masters/attendance-policies/${selectedId}`, body),
    onSuccess: () => { invalidate(); toast.success('Policy updated') },
    onError:   (e: Error) => toast.error('Update failed', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/attendance-policies/${id}`),
    onSuccess: () => {
      invalidate()
      setSelectedId(null)
      toast.success('Policy deleted')
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api.post(`/masters/attendance-policies/${id}/set-default`, {}),
    onSuccess: () => { invalidate(); toast.success('Default policy updated') },
    onError:   (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const assignMutation = useMutation({
    mutationFn: () => api.post('/masters/attendance-policies/assignments', {
      employee_id: assignEmpId,
      policy_id:   assignPolId,
    }),
    onSuccess: () => {
      invalidate()
      setAssignEmpId('')
      setAssignPolId('')
      toast.success('Employee assigned to policy')
    },
    onError: (e: Error) => toast.error('Assignment failed', { description: e.message }),
  })

  const removeAssignMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/attendance-policies/assignments/${id}`),
    onSuccess: () => { invalidate(); toast.success('Assignment removed') },
    onError:   (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const isSaving   = createMutation.isPending || updateMutation.isPending
  const formValid  = form.name.trim().length > 0 && form.half_day_threshold_pct < form.present_threshold_pct

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <ShieldAlert className="h-10 w-10 opacity-40" />
          <p className="text-sm">HR Admin access required to manage attendance policies.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Policy"
        subtitle="Configure computation rules: grace periods, late marks, presence thresholds"
        actions={
          <Button
            size="sm"
            onClick={() => { setShowCreate(true); setSelectedId(null); setForm(EMPTY_FORM) }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            New Policy
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left: policy list ─────────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-2">
          <SectionCard
            title="Policies"
            icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
          >
            {isLoading && (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded-lg" />)}
              </div>
            )}
            {!isLoading && policies.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No policies yet. Create your first policy.
              </div>
            )}
            <div className="space-y-1.5">
              {policies.map(p => (
                <PolicyCard
                  key={p.id}
                  policy={p}
                  selected={selectedId === p.id}
                  onClick={() => selectPolicy(p)}
                />
              ))}
            </div>

            <div className="mt-3 p-2.5 rounded-md bg-info/10 border border-info/20 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 text-info flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-info leading-relaxed">
                The <strong>Default</strong> policy applies to all employees without a specific assignment.
                Individual employees can be assigned to a different policy below.
              </p>
            </div>
          </SectionCard>
        </div>

        {/* ── Right: edit / create form ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {(selected || showCreate) ? (
            <SectionCard
              title={showCreate ? 'Create New Policy' : `Edit: ${selected?.name}`}
              icon={<Settings2 className="h-4 w-4 text-muted-foreground" />}
              action={
                selected && !showCreate ? (
                  <div className="flex items-center gap-2">
                    {!selected.is_default && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={setDefaultMutation.isPending}
                        onClick={() => setDefaultMutation.mutate(selected.id)}
                      >
                        <Star className="h-3 w-3" />
                        Set Default
                      </Button>
                    )}
                    {!selected.is_default && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={deleteMutation.isPending}
                        title="Delete policy"
                        onClick={() => {
                          if (confirm(`Delete policy "${selected.name}"? This cannot be undone.`)) {
                            deleteMutation.mutate(selected.id)
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
            >
              <div className="space-y-5">
                {/* Name */}
                <FormField label="Policy Name" required>
                  <Input
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Standard Policy, Field Staff Policy"
                    className="h-8 text-sm"
                  />
                </FormField>

                {/* Threshold grid */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                    Late Calculation
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <NumberField
                      label="Grace Period (minutes)"
                      value={form.grace_minutes}
                      onChange={v => setForm(p => ({ ...p, grace_minutes: v }))}
                      min={0} max={120}
                      hint={FIELD_HINTS.grace_minutes}
                    />
                    <NumberField
                      label="Late Cap (minutes)"
                      value={form.late_cap_minutes}
                      onChange={v => setForm(p => ({ ...p, late_cap_minutes: v }))}
                      min={1} max={480}
                      hint={FIELD_HINTS.late_cap_minutes}
                    />
                  </div>
                </div>

                {/* Presence thresholds */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                    Presence Thresholds
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <NumberField
                      label="Present Threshold (%)"
                      value={form.present_threshold_pct}
                      onChange={v => setForm(p => ({ ...p, present_threshold_pct: v }))}
                      min={1} max={100}
                      hint={FIELD_HINTS.present_threshold_pct}
                    />
                    <NumberField
                      label="Half-Day Threshold (%)"
                      value={form.half_day_threshold_pct}
                      onChange={v => setForm(p => ({ ...p, half_day_threshold_pct: v }))}
                      min={1} max={99}
                      hint={FIELD_HINTS.half_day_threshold_pct}
                    />
                  </div>
                  {form.half_day_threshold_pct >= form.present_threshold_pct && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Half-day threshold must be less than present threshold
                    </div>
                  )}
                </div>

                {/* Anomaly detection */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                    Anomaly Detection
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <NumberField
                      label="Excessive Hours (hours/day)"
                      value={form.excessive_hours_threshold}
                      onChange={v => setForm(p => ({ ...p, excessive_hours_threshold: v }))}
                      min={0} max={24} step={0.5}
                      hint={FIELD_HINTS.excessive_hours_threshold}
                    />
                  </div>
                </div>

                {/* Effective summary */}
                <div className="p-3 rounded-md bg-muted/40 border border-border text-xs space-y-1.5">
                  <p className="font-semibold text-foreground mb-2">Preview</p>
                  {[
                    ['Grace period', `${form.grace_minutes} minutes after shift start`],
                    ['Marked LATE if arrived', `more than ${form.grace_minutes}m late (capped at ${form.late_cap_minutes}m)`],
                    ['Marked PRESENT if worked', `≥ ${form.present_threshold_pct}% of shift duration`],
                    ['Marked HALF DAY if worked', `${form.half_day_threshold_pct}%–${form.present_threshold_pct - 1}% of shift`],
                    ['Marked ABSENT if worked', `< ${form.half_day_threshold_pct}% of shift`],
                    ['Excessive hours anomaly', form.excessive_hours_threshold === 0 ? 'Disabled' : `> ${form.excessive_hours_threshold}h/day`],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex gap-2">
                      <span className="text-muted-foreground w-40 flex-shrink-0">{k}</span>
                      <span className="text-foreground">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => showCreate
                      ? createMutation.mutate(form)
                      : updateMutation.mutate(form)
                    }
                    disabled={isSaving || !formValid}
                    className="gap-1.5"
                  >
                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {showCreate ? 'Create Policy' : 'Save Changes'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { setShowCreate(false); setSelectedId(null) }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard>
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Settings2 className="h-10 w-10 opacity-30" />
                <p className="text-sm">Select a policy to edit, or create a new one.</p>
              </div>
            </SectionCard>
          )}

          {/* ── Employee Assignments ─────────────────────────────────────────── */}
          <SectionCard
            title="Employee Policy Assignments"
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
          >
            <p className="text-xs text-muted-foreground mb-4">Override the default policy for specific employees</p>
            {/* Add assignment */}
            <div className="flex gap-2 mb-4">
              <EmployeeSelector
                placeholder="Search employee by name or code…"
                value={assignEmpId}
                onChange={v => setAssignEmpId(typeof v === 'string' ? v : (v[0] ?? ''))}
                className="flex-1"
              />
              <select
                value={assignPolId}
                onChange={e => setAssignPolId(e.target.value)}
                className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50 flex-1"
              >
                <option value="">Select policy…</option>
                {policies.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!assignEmpId || !assignPolId || assignMutation.isPending}
                onClick={() => assignMutation.mutate()}
                className="h-8"
              >
                Assign
              </Button>
            </div>

            {/* List */}
            {assignments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No employee-specific assignments. All employees use the default policy.
              </p>
            ) : (
              <div className="space-y-1">
                {assignments.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md border border-border/50 bg-card"
                  >
                    <div className="text-xs">
                      <span className="font-medium text-foreground">
                        {a.employees.first_name} {a.employees.last_name}
                      </span>
                      <span className="text-muted-foreground ml-1.5">#{a.employees.employee_code}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {a.attendance_policies.name}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeAssignMutation.mutate(a.id)}
                        disabled={removeAssignMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  )
}
