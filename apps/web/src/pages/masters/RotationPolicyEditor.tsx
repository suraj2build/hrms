import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Save,
  Users,
  Building2,
  CheckCircle,
  Clock,
} from 'lucide-react'
import { Button }  from '@/components/ui/button'
import { Badge }   from '@/components/ui/badge'
import { cn }      from '@/lib/utils'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'

// ── Types ─────────────────────────────────────────────────────────────────────

type ConditionType =
  | 'weekday_working'
  | 'saturday_working'
  | 'sunday_working'
  | 'half_day'
  | 'holiday_working'

interface ShiftOption {
  id:             string
  name:           string
  code:           string | null
  start_time:     string
  end_time:       string
  is_night_shift: boolean
  is_active:      boolean
}

interface Rule {
  id?:            string
  condition_type: ConditionType
  shift_id:       string | null
  sort_order:     number
}

interface PolicyData {
  id:          string
  name:        string
  description: string | null
  is_active:   boolean
  version:     number
  rules:       Array<{
    id:             string
    condition_type: ConditionType
    shift_id:       string
    sort_order:     number
    shifts:         ShiftOption | null
  }>
}

interface ImpactData {
  data: {
    employee_count: number
    site_count:     number
    employees:      Array<{ id: string; display_name: string; employee_no: string }>
    sites:          Array<{ id: string; name: string; code: string }>
  }
}

// ── Condition config ──────────────────────────────────────────────────────────

const CONDITIONS: {
  type:      ConditionType
  label:     string
  sublabel:  string
  days:      number[]   // JS day-of-week values this condition applies to
}[] = [
  {
    type:     'weekday_working',
    label:    'Weekday',
    sublabel: 'Mon – Fri',
    days:     [1, 2, 3, 4, 5],
  },
  {
    type:     'saturday_working',
    label:    'Saturday',
    sublabel: 'Working Saturday',
    days:     [6],
  },
  {
    type:     'sunday_working',
    label:    'Sunday',
    sublabel: 'Working Sunday',
    days:     [0],
  },
  {
    type:     'half_day',
    label:    'Half Day',
    sublabel: 'Any half-day',
    days:     [],
  },
  {
    type:     'holiday_working',
    label:    'Holiday',
    sublabel: 'Working on holiday',
    days:     [],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── Weekly Preview ────────────────────────────────────────────────────────────

interface WeeklyPreviewProps {
  rules:   Rule[]
  shifts:  ShiftOption[]
}

function WeeklyPreview({ rules, shifts }: WeeklyPreviewProps) {
  const shiftMap = useMemo(() => {
    const m = new Map<string, ShiftOption>()
    for (const s of shifts) m.set(s.id, s)
    return m
  }, [shifts])

  const ruleMap = useMemo(() => {
    const m = new Map<ConditionType, string | null>()
    for (const r of rules) m.set(r.condition_type, r.shift_id)
    return m
  }, [rules])

  const getShiftForDow = (dow: number): ShiftOption | null => {
    let condType: ConditionType
    if (dow === 0) condType = 'sunday_working'
    else if (dow === 6) condType = 'saturday_working'
    else condType = 'weekday_working'
    const sid = ruleMap.get(condType)
    if (!sid) return null
    return shiftMap.get(sid) ?? null
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        Weekly Preview
      </h3>
      <div className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
          const shift = getShiftForDow(dow)
          return (
            <div key={dow} className="flex items-center justify-between text-xs">
              <span
                className={cn(
                  'w-8 font-medium',
                  dow === 0 || dow === 6
                    ? 'text-accent-coral'
                    : 'text-foreground',
                )}
              >
                {DAY_NAMES[dow]}
              </span>
              {shift ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span className="font-medium text-foreground">{shift.name}</span>
                  <span className="text-[10px]">
                    {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground/60 italic text-[11px]">
                  No shift mapped
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Shift Select ──────────────────────────────────────────────────────────────

interface ShiftSelectProps {
  value:    string | null
  onChange: (id: string | null) => void
  shifts:   ShiftOption[]
}

function ShiftSelect({ value, onChange, shifts }: ShiftSelectProps) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm',
        'focus:outline-none focus:ring-2 focus:ring-primary/40',
        !value && 'text-muted-foreground',
      )}
    >
      <option value="">— Not mapped —</option>
      {shifts.filter((s) => s.is_active).map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {s.code ? ` (${s.code})` : ''}
          {' · '}{fmtTime(s.start_time)} – {fmtTime(s.end_time)}
          {s.is_night_shift ? ' 🌙' : ''}
        </option>
      ))}
    </select>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RotationPolicyEditor() {
  const { id }      = useParams<{ id: string }>()
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const isNew       = id === 'new'

  // ── Form state ──────────────────────────────────────────────────────────────

  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [isActive,    setIsActive]    = useState(true)
  const [rules,       setRules]       = useState<Rule[]>(() =>
    CONDITIONS.map((c, i) => ({
      condition_type: c.type,
      shift_id:       null,
      sort_order:     i,
    })),
  )

  // ── Fetch existing policy ────────────────────────────────────────────────────

  const policyQuery = useQuery<{ data: PolicyData }, Error>({
    queryKey: ['rotation-policy', id],
    queryFn:  () => api.get(`/masters/rotation-policies/${id}`),
    enabled:  !isNew && !!id,
  })

  useEffect(() => {
    if (policyQuery.data?.data) {
      const p = policyQuery.data.data
      setName(p.name)
      setDescription(p.description ?? '')
      setIsActive(p.is_active)

      // Merge existing rules into the fixed conditions list
      const ruleMap = new Map(p.rules.map((r) => [r.condition_type, r.shift_id]))
      setRules(
        CONDITIONS.map((c, i) => ({
          condition_type: c.type,
          shift_id:       ruleMap.get(c.type) ?? null,
          sort_order:     i,
        })),
      )
    }
  }, [policyQuery.data])

  // ── Fetch shifts ─────────────────────────────────────────────────────────────

  const shiftsQuery = useQuery<{ data: ShiftOption[] }, Error>({
    queryKey: ['shifts-list'],
    queryFn:  () => api.get('/masters/shifts'),
  })

  const shifts = shiftsQuery.data?.data ?? []

  // ── Fetch impact (edit mode) ─────────────────────────────────────────────────

  const impactQuery = useQuery<ImpactData, Error>({
    queryKey: ['rotation-policy-impact', id],
    queryFn:  () => api.get(`/masters/rotation-policies/${id}/impact`),
    enabled:  !isNew && !!id,
  })

  const impact = impactQuery.data?.data

  // ── Mutations ────────────────────────────────────────────────────────────────

  const versionConflict = useVersionConflict([['rotation-policy', id]])

  const saveMutation = useMutation({
    mutationFn: (payload: object) =>
      isNew
        ? api.post('/masters/rotation-policies', payload)
        : api.put(`/masters/rotation-policies/${id}`, withExpectedVersion(payload as Record<string, unknown>, policyQuery.data?.data)),
    onSuccess: () => {
      toast.success(isNew ? 'Rotation policy created' : 'Policy saved')
      queryClient.invalidateQueries({ queryKey: ['rotation-policies'] })
      queryClient.invalidateQueries({ queryKey: ['rotation-policies-list'] })
      if (isNew) navigate('/admin/masters/rotation-policies')
      else queryClient.invalidateQueries({ queryKey: ['rotation-policy', id] })
    },
    onError: (err: Error) => {
      if (versionConflict(err)) return
      toast.error(err.message ?? 'Failed to save policy')
    },
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const setRuleShift = (condType: ConditionType, shiftId: string | null) => {
    setRules((prev) =>
      prev.map((r) => (r.condition_type === condType ? { ...r, shift_id: shiftId } : r)),
    )
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Policy name is required')
      return
    }
    const payload = {
      name:        name.trim(),
      description: description.trim() || undefined,
      is_active:   isActive,
      rules:       rules
        .filter((r) => r.shift_id !== null)
        .map((r) => ({
          condition_type: r.condition_type,
          shift_id:       r.shift_id!,
          sort_order:     r.sort_order,
        })),
    }
    saveMutation.mutate(payload)
  }

  // ── Loading state ─────────────────────────────────────────────────────────────

  if (!isNew && policyQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading policy…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0 h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3 bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/masters/rotation-policies')}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm font-medium">
            {isNew ? 'New Rotation Policy' : (name || 'Edit Policy')}
          </span>
          {!isNew && (
            <Badge variant={isActive ? 'default' : 'secondary'} className="text-[11px]">
              {isActive ? 'Active' : 'Inactive'}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {saveMutation.isPending ? 'Saving…' : 'Save Policy'}
        </Button>
      </div>

      {/* Body */}
      <div className="flex gap-5 p-6 flex-1 min-h-0 overflow-auto">

        {/* ── Left panel — metadata + impact ─────────────────────────────── */}
        <div className="w-64 shrink-0 flex flex-col gap-4">

          {/* Metadata */}
          <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Policy Details
            </h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Standard Office Rotation"
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description…"
                rows={3}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <span>Active</span>
            </label>
          </div>

          {/* Impact */}
          {!isNew && impact && (
            <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Impact
              </h3>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{impact.site_count}</span>
                  <span className="text-muted-foreground">
                    {impact.site_count === 1 ? 'site' : 'sites'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{impact.employee_count}</span>
                  <span className="text-muted-foreground">
                    {impact.employee_count === 1 ? 'employee override' : 'employee overrides'}
                  </span>
                </div>
              </div>
              {impact.sites.length > 0 && (
                <div className="flex flex-col gap-1 pt-1 border-t border-border">
                  <span className="text-[11px] text-muted-foreground font-medium">Sites</span>
                  {impact.sites.slice(0, 5).map((s) => (
                    <span key={s.id} className="text-xs text-foreground truncate">{s.name}</span>
                  ))}
                  {impact.sites.length > 5 && (
                    <span className="text-[11px] text-muted-foreground">
                      +{impact.sites.length - 5} more
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Weekly preview */}
          <WeeklyPreview rules={rules} shifts={shifts} />
        </div>

        {/* ── Center — mapping table ──────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="rounded-xl border bg-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[220px_1fr_180px] border-b border-border bg-muted/30 px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>Condition</span>
              <span>Mapped Shift</span>
              <span>Preview</span>
            </div>

            {/* Rows */}
            {CONDITIONS.map((cond) => {
              const rule       = rules.find((r) => r.condition_type === cond.type)!
              const mappedShift = rule.shift_id
                ? shifts.find((s) => s.id === rule.shift_id) ?? null
                : null

              return (
                <div
                  key={cond.type}
                  className="grid grid-cols-[220px_1fr_180px] items-center gap-4 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/10 transition-colors"
                >
                  {/* Condition */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{cond.label}</span>
                    <span className="text-xs text-muted-foreground">{cond.sublabel}</span>
                  </div>

                  {/* Shift select */}
                  <ShiftSelect
                    value={rule.shift_id}
                    onChange={(sid) => setRuleShift(cond.type, sid)}
                    shifts={shifts}
                  />

                  {/* Preview */}
                  <div className="text-xs text-muted-foreground">
                    {mappedShift ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1 text-foreground font-medium">
                          <CheckCircle className="h-3 w-3 text-success" />
                          {fmtTime(mappedShift.start_time)}
                        </span>
                        <span className="pl-4">
                          – {fmtTime(mappedShift.end_time)}
                          {mappedShift.is_night_shift && ' 🌙'}
                        </span>
                      </div>
                    ) : (
                      <span className="italic text-muted-foreground/60">Not set</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Info note */}
          <p className="mt-3 text-xs text-muted-foreground">
            <strong>Note:</strong> Half Day and Holiday conditions are used when the
            attendance engine detects those day types from leave/holiday data — they
            cannot be inferred from the date alone. Configure them here for completeness.
          </p>
        </div>
      </div>
    </div>
  )
}
