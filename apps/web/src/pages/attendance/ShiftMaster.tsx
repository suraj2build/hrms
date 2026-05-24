/**
 * ShiftMaster — /shift-master
 *
 * Create, edit and manage shift definitions.
 * Each shift stores timing rules only:
 *   name, code, start_time, end_time, grace_minutes, is_night_shift, is_active
 *
 * Weekly-off patterns are managed separately via the Roster Master (/roster-master).
 *
 * HR admin / super_admin: full CRUD.
 * Other roles: read-only view.
 */

import { useState }                                        from 'react'
import { useQuery, useMutation, useQueryClient }           from '@tanstack/react-query'
import {
  Clock, Moon, Plus, Pencil, Trash2,
  AlertCircle, ShieldAlert, Info,
}                                                          from 'lucide-react'

import { toast }                                            from 'sonner'
import { PageContainer }                                   from '@/components/layout/PageContainer'
import { PageHeader }                                      from '@/components/layout/PageHeader'
import { SectionCard }                                     from '@/components/layout/SectionCard'
import { PeriodLockBanner }                                from '@/components/layout/PeriodLockBanner'
import { FormField, FormRow, FormActions }                 from '@/components/forms/FormField'
import { TableToolbar, EmptyTableState }                   from '@/components/table'
import { Button }                                          from '@/components/ui/button'
import { Input }                                           from '@/components/ui/input'
import { Badge }                                           from '@/components/ui/badge'
import { api }                                             from '@/lib/api/client'
import { useAuthStore }                                    from '@/stores/authStore'
import { usePeriodLock }                                   from '@/hooks/usePeriodLock'
import { cn }                                              from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shift {
  id:             string
  name:           string
  code:           string | null
  start_time:     string
  end_time:       string
  grace_minutes:  number
  is_night_shift: boolean
  is_active:      boolean
}

interface FormState {
  name:           string
  code:           string
  start_time:     string
  end_time:       string
  grace_minutes:  number
  is_night_shift: boolean
  is_active:      boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY: FormState = {
  name:           '',
  code:           '',
  start_time:     '09:00',
  end_time:       '18:00',
  grace_minutes:  15,
  is_night_shift: false,
  is_active:      true,
}

// ── Main component ────────────────────────────────────────────────────────────

export function ShiftMaster() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()

  const [form,     setForm]     = useState<FormState>(EMPTY)
  const [editId,   setEditId]   = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [errors,   setErrors]   = useState<Partial<Record<keyof FormState, string>>>({})
  const [search,   setSearch]   = useState('')

  // ── Period lock awareness ─────────────────────────────────────────────────
  const currentMonth = new Date().toISOString().slice(0, 7)
  const { state: periodState } = usePeriodLock(currentMonth)

  // ── Data ──────────────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery<{ data: Shift[] }>({
    queryKey: ['shifts'],
    queryFn:  () => api.get('/masters/shifts'),
  })
  const shifts = data?.data ?? []

  const filteredShifts = shifts.filter(s =>
    !search ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.code ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (body: FormState) =>
      editId
        ? api.put(`/masters/shifts/${editId}`, body)
        : api.post('/masters/shifts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] })
      toast.success(editId ? 'Shift updated' : 'Shift created')
      closeForm()
    },
    onError: (e: Error) => toast.error(editId ? 'Failed to update shift' : 'Failed to create shift', { description: e.message }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/shifts/${id}`),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['shifts'] })
      toast.success('Shift deleted')
    },
    onError: (e: Error) => toast.error('Failed to delete shift', { description: e.message }),
  })

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function closeForm() {
    setForm(EMPTY)
    setEditId(null)
    setShowForm(false)
    setErrors({})
    saveMutation.reset()
  }

  function openCreate() {
    setForm(EMPTY)
    setEditId(null)
    setErrors({})
    saveMutation.reset()
    setShowForm(true)
  }

  function openEdit(s: Shift) {
    setForm({
      name:           s.name,
      code:           s.code ?? '',
      start_time:     s.start_time?.slice(0, 5) ?? '09:00',
      end_time:       s.end_time?.slice(0, 5)   ?? '18:00',
      grace_minutes:  s.grace_minutes ?? 15,
      is_night_shift: s.is_night_shift ?? false,
      is_active:      s.is_active      ?? true,
    })
    setEditId(s.id)
    setErrors({})
    saveMutation.reset()
    setShowForm(true)
    setTimeout(() => {
      document.getElementById('shift-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  function validate(): boolean {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim())   e.name       = 'Shift name is required'
    if (!form.start_time)    e.start_time = 'Start time is required'
    if (!form.end_time)      e.end_time   = 'End time is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    saveMutation.mutate(form)
  }

  function confirmDelete(s: Shift) {
    if (window.confirm(`Delete shift "${s.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(s.id)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Shift Definitions"
        subtitle="Define work shifts and timing rules — weekly-off patterns are configured in Roster Master"
      />

      {/* ── Architecture note ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          <strong>Shifts</strong> define timing rules only (start/end time, grace, overnight).
          <strong className="ml-1">Weekly-off days</strong> (Sat, Sun, etc.) are managed via{' '}
          <strong>Roster Master</strong> — assign a roster to employees or sites to define their
          work-pattern calendar.
        </span>
      </div>

      {/* ── Create / Edit form ───────────────────────────────────────────────── */}
      {showForm && isAdmin && (
        <div id="shift-form">
        <SectionCard
          title={editId ? 'Edit Shift' : 'New Shift'}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        >
          <div className="space-y-5">
            {/* Row 1: Name + Code */}
            <FormRow cols={2}>
              <FormField
                label="Shift Name"
                htmlFor="s-name"
                required
                error={errors.name}
              >
                <Input
                  id="s-name"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Morning Shift"
                />
              </FormField>

              <FormField
                label="Shift Code"
                htmlFor="s-code"
                description="Short identifier used in the roster grid"
              >
                <Input
                  id="s-code"
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. MRN"
                  maxLength={6}
                />
              </FormField>
            </FormRow>

            {/* Row 2: Start, End, Grace */}
            <FormRow cols={3}>
              <FormField
                label="Start Time"
                htmlFor="s-start"
                required
                error={errors.start_time}
              >
                <Input
                  id="s-start"
                  type="time"
                  value={form.start_time}
                  onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                />
              </FormField>

              <FormField
                label="End Time"
                htmlFor="s-end"
                required
                error={errors.end_time}
              >
                <Input
                  id="s-end"
                  type="time"
                  value={form.end_time}
                  onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                />
              </FormField>

              <FormField
                label="Grace Minutes"
                htmlFor="s-grace"
                description="Late arrival buffer (0–120 min)"
              >
                <Input
                  id="s-grace"
                  type="number"
                  min={0}
                  max={120}
                  value={form.grace_minutes}
                  onChange={e =>
                    setForm(f => ({ ...f, grace_minutes: Math.max(0, Math.min(120, parseInt(e.target.value) || 0)) }))
                  }
                />
              </FormField>
            </FormRow>

            {/* Flags row */}
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_night_shift}
                  onChange={e => setForm(f => ({ ...f, is_night_shift: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-foreground">Night shift</span>
                <span className="text-muted-foreground text-xs">(spans midnight)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span className="text-foreground">Active</span>
              </label>
            </div>

            {/* API error */}
            {saveMutation.isError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {(saveMutation.error as Error)?.message ?? 'Failed to save shift'}
              </p>
            )}

            <FormActions>
              <Button variant="outline" onClick={closeForm} disabled={saveMutation.isPending}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                {saveMutation.isPending
                  ? (editId ? 'Updating…' : 'Creating…')
                  : (editId ? 'Update Shift' : 'Create Shift')}
              </Button>
            </FormActions>
          </div>
        </SectionCard>
        </div>
      )}

      {/* ── Shifts list ──────────────────────────────────────────────────────── */}
      <SectionCard
        title={`Shifts${shifts.length ? ` (${shifts.length})` : ''}`}
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        noPadding
      >
        {/* Period lock warning */}
        {(periodState === 'PAYROLL_PROCESSING' || periodState === 'PAYROLL_FINALIZED') && (
          <div className="px-4 pt-3 pb-0">
            <PeriodLockBanner state={periodState} month={currentMonth} />
          </div>
        )}

        <TableToolbar
          left={
            <Input
              placeholder="Search shifts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-7 text-xs w-48"
            />
          }
          right={
            isAdmin && !showForm ? (
              <Button size="sm" className="h-7 text-xs gap-1.5" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                Add Shift
              </Button>
            ) : undefined
          }
        />

        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
            Loading shifts…
          </div>
        ) : filteredShifts.length === 0 ? (
          <EmptyTableState
            preset="no-shifts"
            title="No shift definitions yet"
            description="Create your first shift to start assigning employees."
            action={isAdmin ? <Button size="sm" onClick={openCreate}>Create Shift</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Name', 'Code', 'Timing', 'Grace', 'Flags', 'Status', ''].map(h => (
                    <th
                      key={h}
                      className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-4 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map(s => (
                  <tr
                    key={s.id}
                    className={cn(
                      'border-b border-border/50 transition-colors',
                      editId === s.id
                        ? 'bg-primary/5'
                        : 'hover:bg-muted/20',
                    )}
                  >
                    {/* Name */}
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {s.name}
                    </td>

                    {/* Code */}
                    <td className="px-4 py-3">
                      {s.code
                        ? <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{s.code}</span>
                        : <span className="text-muted-foreground/50 text-xs">—</span>}
                    </td>

                    {/* Timing */}
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums">
                      {s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)}
                    </td>

                    {/* Grace */}
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {s.grace_minutes ?? 15} min
                    </td>

                    {/* Flags */}
                    <td className="px-4 py-3">
                      {s.is_night_shift ? (
                        <Badge variant="outline" className="text-[10px] gap-1 text-info border-info/40">
                          <Moon className="h-2.5 w-2.5" />
                          Night
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <Badge
                        variant={s.is_active ? 'default' : 'secondary'}
                        className="text-[10px]"
                      >
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {isAdmin && (
                        <div className="flex items-center gap-0.5 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Edit shift"
                            onClick={() => openEdit(s)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete shift"
                            disabled={deleteMutation.isPending}
                            onClick={() => confirmDelete(s)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Non-admin notice */}
        {!isAdmin && shifts.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
            HR admin access required to create or edit shifts.
          </div>
        )}
      </SectionCard>
    </PageContainer>
  )
}
