/**
 * Shift Overrides — /employee-shifts
 *
 * Exception-only shift assignments for temporary, emergency, or special-case
 * workforce coverage.  This is NOT the primary scheduling mechanism.
 *
 * Primary shift scheduling flows through:
 *   Roster Policy → Rotation Policy → Shift Master
 *
 * Use this page ONLY for:
 *   · Temporary reassignments (e.g. employee covering a different shift for a week)
 *   · Emergency coverage adjustments
 *   · Special operational exceptions
 *   · Employees who need a standing override different from the Rotation Policy resolution
 *
 * Layout:
 *   Left panel  (lg:col-span-2) — searchable, location-filtered table showing all
 *                                  employees and their current active Shift Override (if any).
 *   Right panel (lg:col-span-1) — "Apply Override" form + Override History.
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
  Users, Clock, Search, AlertCircle, Info,
  ShieldAlert, CheckCircle2, X, History,
}                                                        from 'lucide-react'

import { PageContainer }                                 from '@/components/layout/PageContainer'
import { PageHeader }                                    from '@/components/layout/PageHeader'
import { SectionCard }                                   from '@/components/layout/SectionCard'
import { FormField, FormActions }                        from '@/components/forms/FormField'
import { Button }                                        from '@/components/ui/button'
import { Input }                                         from '@/components/ui/input'
import { DateInput }                                     from '@/components/ui/date-input'
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
  is_active?: boolean
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
  const shifts = (shiftData?.data ?? []).filter(s => s.is_active)

  const { data: histData, isLoading: histLoading } = useQuery<{ data: HistoryRow[] }>({
    queryKey: ['employee-shift-history', historyEmpId],
    queryFn:  () => api.get(`/masters/employee-shifts/${historyEmpId}/history`),
    enabled:  !!historyEmpId,
    staleTime: 30_000,
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

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
      toast.success('Shift override applied')
      setTimeout(() => {
        setSuccess(false)
        setForm(EMPTY_FORM)
        setErrors({})
      }, 2000)
    },
    onError: (e: Error) => toast.error('Failed to apply override', { description: e.message }),
  })

  const clearMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      api.delete(`/masters/employee-shifts/${assignmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-shifts'] })
      if (historyEmpId) qc.invalidateQueries({ queryKey: ['employee-shift-history', historyEmpId] })
      toast.success('Shift override removed')
    },
    onError: (e: Error) => toast.error('Failed to remove override', { description: e.message }),
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
    document.getElementById('override-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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

  // ── Column definitions ─────────────────────────────────────────────────────────

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
      id:       'active_override',
      header:   'Active Override',
      minWidth: '160px',
      cell: (row) => (
        row.shift ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px] border border-warning/30 bg-warning/10 text-warning dark:bg-warning/20 dark:text-warning">
                Override
              </Badge>
              <span className="text-xs text-muted-foreground">{row.shift.name}</span>
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {fmtTime(row.shift.start_time)} – {fmtTime(row.shift.end_time)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/60 italic">No override — policy applies</span>
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
            title="Remove override"
            disabled={clearMutation.isPending}
            onClick={e => {
              e.stopPropagation()
              if (window.confirm(`Remove shift override from ${row.name}?`)) {
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
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          className="h-8 pl-8 w-44 text-xs"
          placeholder="Search employees…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
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
        breadcrumb={[{ label: 'Workforce Governance', href: '/admin/masters/rosters' }, { label: 'Shift Overrides' }]}
        title="Shift Overrides"
        subtitle="Exception-only overrides — for temporary, emergency, or special-case assignments"
      />

      {/* Governance context banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-xs dark:border-primary/40 dark:bg-primary/20">
        <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span className="text-primary dark:text-primary">
          <strong>Primary scheduling</strong> is governed by Roster Policy + Rotation Policy.
          Use this page only for temporary overrides or special cases.
          Most employees should have <em>no override</em> here — they inherit from their site's governance policies.
        </span>
      </div>

      {!isAdmin && (
        <SectionCard>
          <div className="flex items-center gap-3 text-sm text-muted-foreground py-2">
            <ShieldAlert className="h-5 w-5 text-warning flex-shrink-0" />
            <span>You have read-only access. HR admin access is required to apply overrides.</span>
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

        {/* ── Right: Override form + history ───────────────────────────────── */}
        <div id="override-panel" className="space-y-4">
          <SectionCard
            title="Apply Override"
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
            description={isAdmin ? 'Select an employee from the table, then choose a shift to override with.' : undefined}
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
                  label="Override Shift"
                  htmlFor="es-shift"
                  required
                  error={errors.shift_id}
                  description="This shift will take priority over the Rotation Policy for this employee"
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
                    <option value="">— Select shift to override with —</option>
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
                  description="Override applies from this date onward until removed"
                >
                  <DateInput
                    id="es-date"
                    value={form.effective_from}
                    onChange={v => setForm(f => ({ ...f, effective_from: v }))}
                  />
                </FormField>

                {/* Success banner */}
                {success && (
                  <div className="flex items-center gap-2 text-xs text-success p-2 rounded-md bg-success/10 border border-success/20">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    Override applied successfully!
                  </div>
                )}

                {/* API error */}
                {assignMutation.isError && !success && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                    {(assignMutation.error as Error)?.message ?? 'Failed to apply override'}
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
                    {assignMutation.isPending ? 'Applying…' : 'Apply Override'}
                  </Button>
                </FormActions>

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

          {/* ── Override history panel ──────────────────────────────────── */}
          {historyEmpId && (
            <SectionCard
              title="Override History"
              icon={<History className="h-4 w-4 text-muted-foreground" />}
            >
              {histLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse py-3">
                  Loading history…
                </div>
              ) : (histData?.data ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">
                  No override history for this employee.
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
                            Active
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
