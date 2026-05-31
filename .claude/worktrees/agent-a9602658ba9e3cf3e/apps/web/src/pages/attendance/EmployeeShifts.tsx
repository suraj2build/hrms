/**
 * EmployeeShifts — /employee-shifts
 *
 * Assign standing (default) shifts to employees.
 *
 * Layout:
 *   Left panel  (lg:col-span-2) — searchable, location-filtered table of all active employees
 *                                  showing each person's current shift as a badge.
 *                                  Clicking a row pre-fills the right form.
 *   Right panel (lg:col-span-1) — "Assign Shift" form + Shift History panel.
 *
 * API:
 *   GET  /masters/employee-shifts               → { data: EmployeeRow[] }
 *   GET  /masters/employee-shifts/:id/history   → { data: HistoryRow[] }
 *   GET  /masters/shifts                        → { data: Shift[] }
 *   POST /masters/employee-shifts/assign        → { data: assignment }
 *   DELETE /masters/employee-shifts/:id         → 204
 */

import { useState, useMemo }                             from 'react'
import { useQuery, useMutation, useQueryClient }         from '@tanstack/react-query'
import { toast }                                         from 'sonner'
import {
  Users, Clock, Search, AlertCircle,
  ShieldAlert, CheckCircle2, X, History,
}                                                        from 'lucide-react'

import { PageContainer }                                 from '@/components/layout/PageContainer'
import { PageHeader }                                    from '@/components/layout/PageHeader'
import { SectionCard }                                   from '@/components/layout/SectionCard'
import { FormField, FormActions }                        from '@/components/forms/FormField'
import { Button }                                        from '@/components/ui/button'
import { Input }                                         from '@/components/ui/input'
import { Badge }                                         from '@/components/ui/badge'
import { api }                                           from '@/lib/api/client'
import { useAuthStore }                                  from '@/stores/authStore'
import { cn }                                            from '@/lib/utils'
import { PeriodLockBanner }                              from '@/components/layout/PeriodLockBanner'
import { usePeriodLock }                                 from '@/hooks/usePeriodLock'
import {
  DataTable,
  TableToolbar,
  EmptyTableState,
}                                                        from '@/components/table'
import type { DataTableColumn }                          from '@/components/table'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Shift {
  id:         string
  name:       string
  code:       string | null
  start_time: string
  end_time:   string
}

interface WorkLocation {
  id:   string
  name: string
}

interface EmployeeRow {
  employee_id:    string
  employee_code:  string
  name:           string
  assignment_id:  string | null
  effective_from: string | null
  shift:          Shift | null
  work_location:  WorkLocation | null
}

interface HistoryRow {
  id:             string
  effective_from: string
  is_current:     boolean
  shifts:         { id: string; name: string; code: string | null; start_time: string; end_time: string }
}

interface AssignForm {
  employee_id:    string
  employee_name:  string
  shift_id:       string
  effective_from: string
}

const EMPTY_FORM: AssignForm = {
  employee_id:    '',
  employee_name:  '',
  shift_id:       '',
  effective_from: new Date().toISOString().slice(0, 10),
}

// ── Helper ────────────────────────────────────────────────────────────────────

function fmtTime(t: string | null) {
  return t ? t.slice(0, 5) : ''
}

// ── Main component ────────────────────────────────────────────────────────────

export function EmployeeShifts() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc          = useQueryClient()

  // ── Period lock awareness ─────────────────────────────────────────────────
  const currentMonth = new Date().toISOString().slice(0, 7)
  const { state: periodState, isLocked: periodLocked } = usePeriodLock(currentMonth)

  const [search,         setSearch]         = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [form,           setForm]           = useState<AssignForm>(EMPTY_FORM)
  const [errors,         setErrors]         = useState<Partial<Record<keyof AssignForm, string>>>({})
  const [success,        setSuccess]        = useState(false)
  const [historyEmpId,   setHistoryEmpId]   = useState<string | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: empData, isLoading: empLoading } = useQuery<{ data: EmployeeRow[] }>({
    queryKey: ['employee-shifts'],
    queryFn:  () => api.get('/masters/employee-shifts'),
  })
  const employees = empData?.data ?? []

  const { data: shiftData } = useQuery<{ data: Shift[] }>({
    queryKey: ['shifts'],
    queryFn:  () => api.get('/masters/shifts'),
  })
  const shifts = (shiftData?.data ?? []).filter(s => (s as any).is_active)

  const { data: histData, isLoading: histLoading } = useQuery<{ data: HistoryRow[] }>({
    queryKey: ['employee-shift-history', historyEmpId],
    queryFn:  () => api.get(`/masters/employee-shifts/${historyEmpId}/history`),
    enabled:  !!historyEmpId,
    staleTime: 30_000,
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

  // Unique work locations from current employee data
  const locations: WorkLocation[] = Array.from(
    new Map(
      employees
        .filter(e => e.work_location)
        .map(e => [e.work_location!.id, e.work_location!])
    ).values()
  )

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const assignMutation = useMutation({
    mutationFn: (body: { employee_id: string; shift_id: string; effective_from: string }) =>
      api.post('/masters/employee-shifts/assign', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-shifts'] })
      qc.invalidateQueries({ queryKey: ['employee-shift-history', form.employee_id] })
      setSuccess(true)
      toast.success('Shift assigned')
      setTimeout(() => {
        setSuccess(false)
        setForm(EMPTY_FORM)
        setErrors({})
      }, 2000)
    },
    onError: (e: Error) => toast.error('Failed to assign shift', { description: e.message }),
  })

  const clearMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      api.delete(`/masters/employee-shifts/${assignmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-shifts'] })
      if (historyEmpId) qc.invalidateQueries({ queryKey: ['employee-shift-history', historyEmpId] })
      toast.success('Shift assignment cleared')
    },
    onError: (e: Error) => toast.error('Failed to clear shift', { description: e.message }),
  })

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function selectEmployee(row: EmployeeRow) {
    setForm(f => ({
      ...f,
      employee_id:   row.employee_id,
      employee_name: row.name,
      shift_id:      row.shift?.id ?? '',
    }))
    setHistoryEmpId(row.employee_id)
    setErrors({})
    setSuccess(false)
    assignMutation.reset()
    document.getElementById('assign-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  function clearSelection() {
    setForm(EMPTY_FORM)
    setHistoryEmpId(null)
    setErrors({})
    setSuccess(false)
    assignMutation.reset()
  }

  function validate(): boolean {
    const e: Partial<Record<keyof AssignForm, string>> = {}
    if (!form.employee_id)    e.employee_id    = 'Select an employee'
    if (!form.shift_id)       e.shift_id       = 'Select a shift'
    if (!form.effective_from) e.effective_from = 'Effective date is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleAssign() {
    if (!validate()) return
    assignMutation.mutate({
      employee_id:    form.employee_id,
      shift_id:       form.shift_id,
      effective_from: form.effective_from,
    })
  }

  // ── Filtered list ─────────────────────────────────────────────────────────────

  const filtered = employees.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = (
      e.name.toLowerCase().includes(q) ||
      e.employee_code.toLowerCase().includes(q) ||
      (e.shift?.name ?? '').toLowerCase().includes(q)
    )
    const matchLocation = !locationFilter || e.work_location?.id === locationFilter
    return matchSearch && matchLocation
  })

  // ── Column definitions (inside component to close over state) ─────────────────

  const columns = useMemo<DataTableColumn<EmployeeRow>[]>(() => [
    {
      id:       'employee',
      header:   'Employee',
      minWidth: '160px',
      cell: (row) => {
        const isSelected = form.employee_id === row.employee_id
        return (
          <div className={cn(isSelected && 'text-primary')}>
            <div className="font-medium text-foreground">{row.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{row.employee_code}</div>
            {row.work_location && (
              <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                {row.work_location.name}
              </div>
            )}
          </div>
        )
      },
    },
    {
      id:       'location',
      header:   'Location',
      minWidth: '100px',
      cell: (row) => (
        <span className="text-xs text-foreground">
          {row.work_location?.name ?? <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      id:       'current_shift',
      header:   'Current Shift',
      minWidth: '140px',
      cell: (row) => (
        row.shift ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="default" className="text-[10px]">
                {row.shift.code || row.shift.name}
              </Badge>
              <span className="text-xs text-muted-foreground">{row.shift.name}</span>
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {fmtTime(row.shift.start_time)} – {fmtTime(row.shift.end_time)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/60 italic">Unassigned</span>
        )
      ),
    },
    {
      id:       'effective_from',
      header:   'Effective From',
      minWidth: '100px',
      cell: (row) => (
        <span className="text-xs text-muted-foreground tabular-nums">
          {row.effective_from ?? '—'}
        </span>
      ),
    },
    {
      id:       'actions',
      header:   '',
      cell: (row) => (
        isAdmin && row.assignment_id ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            title="Remove standing shift"
            disabled={clearMutation.isPending}
            onClick={e => {
              e.stopPropagation()
              if (window.confirm(`Remove standing shift from ${row.name}?`)) {
                clearMutation.mutate(row.assignment_id!)
                if (form.employee_id === row.employee_id) clearSelection()
              }
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [form.employee_id, isAdmin, clearMutation.isPending])

  // ── Toolbar slots ─────────────────────────────────────────────────────────────

  const toolbarLeft = (
    <>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          className="h-8 pl-8 w-44 text-xs"
          placeholder="Search employees…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Location filter */}
      {locations.length > 0 && (
        <select
          value={locationFilter}
          onChange={e => setLocationFilter(e.target.value)}
          className="h-8 text-xs rounded-md border border-input bg-background px-2 text-foreground outline-none focus:ring-1 ring-primary/50"
        >
          <option value="">All Locations</option>
          {locations.map(loc => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      )}
    </>
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={[{ label: 'Shift & Roster', href: '/admin/shift-master' }, { label: 'Employee Shifts' }]}
        title="Employee Shifts"
        subtitle="Assign default standing shifts to employees"
      />

      {!isAdmin && (
        <SectionCard>
          <div className="flex items-center gap-3 text-sm text-muted-foreground py-2">
            <ShieldAlert className="h-5 w-5 text-warning flex-shrink-0" />
            <span>You have read-only access. HR admin access is required to assign shifts.</span>
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: Employee list ──────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <SectionCard
            title={`Employees${employees.length ? ` (${employees.length})` : ''}`}
            icon={<Users className="h-4 w-4 text-muted-foreground" />}
            noPadding
          >
            <TableToolbar left={toolbarLeft} />

            <DataTable<EmployeeRow>
              columns={columns}
              data={filtered}
              getRowKey={row => row.employee_id}
              loading={empLoading}
              skeletonRows={8}
              onRowClick={isAdmin ? selectEmployee : undefined}
              emptyState={
                <EmptyTableState
                  preset={search || locationFilter ? 'no-results' : 'no-shifts'}
                  description={
                    search || locationFilter
                      ? 'No employees match your filters.'
                      : 'No active employees found.'
                  }
                />
              }
            />
          </SectionCard>
        </div>

        {/* ── Right: Assignment form + shift history ───────────────────────── */}
        <div id="assign-panel" className="space-y-4">
          <SectionCard
            title="Assign Shift"
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
            description={isAdmin ? 'Select an employee from the table, then choose a shift.' : undefined}
          >
            {periodLocked && (
              <PeriodLockBanner state={periodState} month={currentMonth} className="mb-4" />
            )}
            {!isAdmin ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                HR admin access required.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Employee (read-only when selected from table) */}
                <FormField
                  label="Employee"
                  htmlFor="es-employee"
                  error={errors.employee_id}
                  description={!form.employee_id ? 'Click a row in the employee table' : undefined}
                >
                  {form.employee_id ? (
                    <div className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-muted/30 text-sm">
                      <div>
                        <span className="font-medium text-foreground">{form.employee_name}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 -mr-1 text-muted-foreground hover:text-foreground"
                        onClick={clearSelection}
                        title="Clear selection"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <Input
                      id="es-employee"
                      placeholder="Click a row in the table →"
                      readOnly
                      className="bg-muted/30 cursor-default text-muted-foreground"
                    />
                  )}
                </FormField>

                {/* Shift select */}
                <FormField
                  label="Shift"
                  htmlFor="es-shift"
                  required
                  error={errors.shift_id}
                >
                  <select
                    id="es-shift"
                    value={form.shift_id}
                    onChange={e => setForm(f => ({ ...f, shift_id: e.target.value }))}
                    className={cn(
                      'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm',
                      'shadow-sm transition-colors focus-visible:outline-none',
                      'focus-visible:ring-1 focus-visible:ring-primary/50',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      !form.shift_id && 'text-muted-foreground',
                    )}
                  >
                    <option value="">— Select shift —</option>
                    {shifts.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.code ? ` (${s.code})` : ''}
                        {' · '}
                        {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                      </option>
                    ))}
                  </select>
                </FormField>

                {/* Effective from */}
                <FormField
                  label="Effective From"
                  htmlFor="es-date"
                  required
                  error={errors.effective_from}
                  description="Shift applies from this date onward"
                >
                  <Input
                    id="es-date"
                    type="date"
                    value={form.effective_from}
                    onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))}
                  />
                </FormField>

                {/* Success banner */}
                {success && (
                  <div className="flex items-center gap-2 text-xs text-success p-2 rounded-md bg-success/10 border border-success/20">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Shift assigned successfully!
                  </div>
                )}

                {/* API error */}
                {assignMutation.isError && !success && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {(assignMutation.error as Error)?.message ?? 'Failed to assign shift'}
                  </p>
                )}

                <FormActions>
                  <Button
                    variant="outline"
                    onClick={clearSelection}
                    disabled={assignMutation.isPending}
                  >
                    Clear
                  </Button>
                  <Button
                    onClick={handleAssign}
                    disabled={assignMutation.isPending || success || periodLocked}
                  >
                    {assignMutation.isPending ? 'Assigning…' : 'Assign Shift'}
                  </Button>
                </FormActions>

                {/* Tip */}
                {shifts.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No active shifts found. Create shifts in{' '}
                    <a href="/shift-master" className="text-primary underline underline-offset-2">
                      Shift Master
                    </a>{' '}
                    first.
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          {/* ── Shift history panel ──────────────────────────────────────── */}
          {historyEmpId && (
            <SectionCard
              title="Shift History"
              icon={<History className="h-4 w-4 text-muted-foreground" />}
            >
              {histLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse py-3">
                  Loading history…
                </div>
              ) : (histData?.data ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">
                  No assignment history for this employee.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {(histData?.data ?? []).map(row => (
                    <div
                      key={row.id}
                      className="flex items-start justify-between text-xs py-2 border-b border-border/40 last:border-0"
                    >
                      <div>
                        <span className="font-medium text-foreground">{row.shifts.name}</span>
                        {row.shifts.code && (
                          <span className="text-muted-foreground ml-1 font-mono">({row.shifts.code})</span>
                        )}
                        <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                          {fmtTime(row.shifts.start_time)}–{fmtTime(row.shifts.end_time)}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <div className="text-muted-foreground tabular-nums">{row.effective_from}</div>
                        {row.is_current && (
                          <Badge variant="success" className="text-[9px] mt-0.5 rounded-full">
                            Current
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}
        </div>

      </div>
    </PageContainer>
  )
}
