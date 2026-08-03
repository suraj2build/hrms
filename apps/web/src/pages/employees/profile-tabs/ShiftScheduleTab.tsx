/**
 * EmployeeProfile › Shift & Roster tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { AlarmClock, AlertTriangle, CalendarClock, History, Loader2 } from 'lucide-react'
import {
  EmptySection, Grid2, fmtDate,
  type FullProfile, type JobHistoryRow, type ShiftHistoryRow, type Section,
} from './shared'

interface RosterToday {
  id: string; date: string; shift_id: string
  shifts: { id: string; name: string; code: string | null; start_time: string; end_time: string }
}

interface ShiftScheduleTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
  job: FullProfile['job_info'] | undefined
  jobHistoryData: { data: JobHistoryRow[] } | undefined
  setSubTab: (tab: string) => void
  setCdlg: (v: { msg: string; act: () => void } | null) => void
}

export function ShiftScheduleTab({
  id, isAdmin, subTab, visited, job, jobHistoryData, setSubTab, setCdlg,
}: ShiftScheduleTabProps) {
  const qc = useQueryClient()

  function promptRecompute(fromDate: string, label = 'assignment') {
    if (!id || !fromDate) return
    const today = new Date().toISOString().slice(0, 10)
    const from  = fromDate > today ? today : fromDate
    const recomputeMsg = `${label.charAt(0).toUpperCase() + label.slice(1)} updated, effective ${fmtDate(fromDate)}.\n\nRecompute this employee's attendance from ${fmtDate(from)} to today so the new ${label} drives attendance & payroll?`
    setCdlg({ msg: recomputeMsg, act: () => api.post('/attendance/recompute', { employee_id: id, from_date: from, to_date: today })
      .then((r: unknown) => {
        toast.success('Attendance recomputed', { description: `${(r as { rows_upserted?: number })?.rows_upserted ?? 0} day(s) updated for the new ${label}.` })
        qc.invalidateQueries({ queryKey: ['employee-full', id] })
      })
      .catch((e: unknown) => toast.error('Recompute failed', { description: e instanceof Error ? e.message : undefined }))
    })
  }

  const { data: shiftHistoryData } = useQuery<{ data: ShiftHistoryRow[] }>({
    queryKey: ['shift-history', id],
    queryFn:  () => api.get(`/employees/${id}/shift-history`),
    enabled:  !!id && visited.has('employment'),
    staleTime: 60_000,
  })

  const { data: rosterTodayData } = useQuery<{ data: RosterToday | null }>({
    queryKey: ['employee-roster-today', id],
    queryFn:  () => api.get(`/attendance/roster/employee/${id}`),
    enabled:  !!id && isAdmin,
    staleTime: 60_000,
  })
  const rosterToday = rosterTodayData?.data ?? null

  // ── Operational assignment state ──────────────────────────────────────────
  type AssignTarget =
    | 'department' | 'designation' | 'grade' | 'manager'
    | 'cost_center' | 'employment_type' | 'work_location' | 'shift'
    | null
  const [assignTarget, setAssignTarget] = useState<AssignTarget>(null)
  const [assignForm, setAssignForm] = useState({
    value: '', effective_from: new Date().toISOString().slice(0, 10), reason: '',
  })

  function openAssign(target: AssignTarget) {
    setAssignTarget(target)
    setAssignForm({ value: '', effective_from: new Date().toISOString().slice(0, 10), reason: '' })
  }

  // ── Master data for assignment dialog (lazy — loads only when dialog opens) ─
  const { data: deptListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['departments'], queryFn: () => api.get('/departments'),
    enabled: !!id, staleTime: 300_000,
  })
  const { data: desigListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['designations'], queryFn: () => api.get('/designations'),
    enabled: !!id, staleTime: 300_000,
  })
  const { data: gradeListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['grades'], queryFn: () => api.get('/grades'),
    enabled: assignTarget === 'grade', staleTime: 300_000,
  })
  const { data: ccListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['masters-cost-centers'], queryFn: () => api.get('/masters/cost-centers'),
    enabled: !!id, staleTime: 300_000,
  })
  const { data: wlListData } = useQuery<{ data: { id: string; name: string; city: string }[] }>({
    queryKey: ['masters-work-locations'], queryFn: () => api.get('/masters/work-locations'),
    enabled: !!id, staleTime: 300_000,
  })
  const { data: shiftListData } = useQuery<{ data: { id: string; name: string; code: string; start_time: string; end_time: string }[] }>({
    queryKey: ['masters-shifts'], queryFn: () => api.get('/masters/shifts'),
    enabled: assignTarget === 'shift', staleTime: 300_000,
  })
  const EMPLOYMENT_TYPES = ['permanent', 'contract', 'intern', 'probation', 'consultant'] as const

  // Field → master list options
  const assignOptions: Record<string, { id: string; label: string }[]> = {
    department:      (deptListData?.data  ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.code})` })),
    designation:     (desigListData?.data ?? []).map(r => ({ id: r.id, label: r.name })),
    grade:           (gradeListData?.data ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.code})` })),
    cost_center:     (ccListData?.data    ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.code})` })),
    work_location:   (wlListData?.data    ?? []).map(r => ({ id: r.id, label: r.city ? `${r.name} · ${r.city}` : r.name })),
    shift:           (shiftListData?.data ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.start_time}–${r.end_time})` })),
    employment_type: EMPLOYMENT_TYPES.map(t => ({ id: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
  }

  // Field → display config
  // Title verb adapts to whether a value already exists ("Set" when empty, else
  // "Reassign"/"Change") so an unmaintained field never reads as "Reassign".
  const _set = (cur: string, verb: string, noun: string) => (cur === '—' ? `Set ${noun}` : `${verb} ${noun}`)
  const ASSIGN_CONFIG: Record<string, { title: string; fieldKey: string; currentLabel: string }> = {
    department:      (() => { const c = job?.departments?.name ?? '—';                                    return { title: _set(c, 'Reassign', 'Department'),         fieldKey: 'department_id',      currentLabel: c } })(),
    designation:     (() => { const c = job?.designations?.name ?? '—';                                   return { title: _set(c, 'Reassign', 'Designation'),        fieldKey: 'designation_id',     currentLabel: c } })(),
    grade:           (() => { const c = job?.grades ? `${job.grades.name} (${job.grades.code})` : '—';    return { title: _set(c, 'Reassign', 'Grade / Band'),       fieldKey: 'grade_id',           currentLabel: c } })(),
    manager:         (() => { const c = job?.manager ? `${job.manager.first_name} ${job.manager.last_name}` : '—'; return { title: _set(c, 'Reassign', 'Reporting Manager'), fieldKey: 'manager_id',  currentLabel: c } })(),
    cost_center:     (() => { const c = job?.cost_center ? `${job.cost_center.name} (${job.cost_center.code})` : '—'; return { title: _set(c, 'Reassign', 'Cost Center'),    fieldKey: 'cost_center_id',     currentLabel: c } })(),
    work_location:   (() => { const c = job?.work_locations ? `${job.work_locations.name}` : '—';         return { title: _set(c, 'Reassign', 'Work Location'),      fieldKey: 'work_location_id',   currentLabel: c } })(),
    employment_type: (() => { const c = job?.employment_type ?? '—';                                      return { title: _set(c, 'Change', 'Employment Type'),      fieldKey: 'employment_type',    currentLabel: c } })(),
    shift:           (() => { const c = job?.shifts?.name ?? '—';                                         return { title: c === '—' ? 'Apply Shift' : 'Apply Shift Override', fieldKey: 'shift_id',  currentLabel: c } })(),
  }

  // ── Job-field assignment (creates new job_history record carrying forward all other values) ─
  const jobAssignMutation = useMutation({
    mutationFn: async ({ fieldKey, value, effective_from, reason }: {
      fieldKey: string; value: string; effective_from: string; reason: string
    }) => {
      if (!job) throw new Error('No current job record to carry forward')
      const body: Record<string, unknown> = {
        employment_type:  job.employment_type,
        department_id:    job.departments?.id    ?? null,
        designation_id:   job.designations?.id   ?? null,
        grade_id:         job.grades?.id         ?? null,
        manager_id:       job.manager?.id        ?? null,
        cost_center_id:   job.cost_center?.id    ?? null,
        work_location_id: job.work_locations?.id ?? null,
        shift_id:         job.shifts?.id         ?? null,
        effective_from,
        reason_for_change: reason || undefined,
        is_current: true,
      }
      // Override only the target field
      body[fieldKey] = value || null
      return api.post(`/employees/${id}/job-history`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['job-history-all', id] })
      setAssignTarget(null)
      toast.success('Assignment updated')
    },
    onError: (e: Error) => toast.error('Assignment failed', { description: e.message }),
  })

  // ── Shift-specific assignment (separate endpoint) ───────────────────────────
  const shiftAssignMutation = useMutation({
    mutationFn: ({ shift_id, effective_from }: { shift_id: string; effective_from: string }) =>
      api.post('/masters/employee-shifts/assign', { employee_id: id, shift_id, effective_from }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['shift-history', id] })
      setAssignTarget(null)
      toast.success('Shift assigned')
      promptRecompute(vars.effective_from, 'shift')
    },
    onError: (e: Error) => toast.error('Shift assignment failed', { description: e.message }),
  })

  return (
    <>
      {subTab === 'shift-schedule' && (
        <div className="space-y-4">
          {/* Current shift summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Shift &amp; Schedule
                </CardTitle>
                {isAdmin && (
                  <button
                    onClick={() => openAssign('shift')}
                    className="text-[10px] text-muted-foreground hover:text-foreground border border-border hover:border-primary/50 rounded px-1.5 py-0.5 transition-colors"
                  >
                    Apply Override
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Grid2>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Shift Override</p>
                  {job?.shifts
                    ? <>
                        <p className="text-sm font-medium">{job.shifts.name}</p>
                        {(job.shifts.start_time || job.shifts.end_time) && (
                          <p className="text-xs text-muted-foreground">{job.shifts.start_time} – {job.shifts.end_time}</p>
                        )}
                      </>
                    : <p className="text-sm text-muted-foreground italic">No override — rotation policy resolves shift</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Today's Roster</p>
                  {rosterToday
                    ? <><p className="text-sm font-medium">{rosterToday.shifts.name}</p><p className="text-xs text-muted-foreground">{rosterToday.shifts.start_time} – {rosterToday.shifts.end_time}</p></>
                    : <p className="text-sm text-muted-foreground italic">No date override — policy applies</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Weekly Off</p>
                  <p className="text-sm text-muted-foreground italic">Via roster policy</p>
                </div>
                <p className="text-[11px] text-muted-foreground col-span-full">Roster &amp; rotation policy are shown and managed on the <button className="underline hover:text-foreground" onClick={() => { setSubTab('workforce') }}>Job &amp; Position</button> tab (Site &amp; Roster Assignment).</p>
              </Grid2>
            </CardContent>
          </Card>

          {/* Shift assignment history */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                Shift Assignment History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!(shiftHistoryData?.data?.length)
                ? <div className="px-6 pb-6"><EmptySection icon={AlarmClock} title="No shift history" subtitle="No shift assignments recorded for this employee." /></div>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          {['Shift', 'Code', 'Hours', 'Effective From', 'Status'].map(h => (
                            <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shiftHistoryData!.data.map((row) => (
                          <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-4 py-2 font-medium">{row.shifts?.name ?? '—'}</td>
                            <td className="px-4 py-2 font-mono text-muted-foreground">{row.shifts?.code ?? '—'}</td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {row.shifts?.start_time && row.shifts?.end_time
                                ? `${row.shifts.start_time}–${row.shifts.end_time}`
                                : '—'}
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap">{fmtDate(row.effective_from)}</td>
                            <td className="px-4 py-2">
                              {row.is_current
                                ? <Badge variant="success" className="rounded-full text-[9px]">Current</Badge>
                                : <Badge variant="secondary" className="rounded-full text-[9px]">Past</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Monthly Attendance summary intentionally NOT shown in the employee
              master — attendance lives in the Attendance module. */}
        </div>
      )}

      <Dialog open={!!assignTarget} onOpenChange={open => { if (!open) setAssignTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          {assignTarget && (() => {
            const cfg   = ASSIGN_CONFIG[assignTarget]
            const opts  = assignOptions[assignTarget] ?? []
            const isPending = assignTarget === 'shift'
              ? shiftAssignMutation.isPending
              : jobAssignMutation.isPending

            // Recent history for this field (last 4 job_history rows)
            const historyRows: JobHistoryRow[] = (jobHistoryData?.data ?? []).slice(0, 4)

            // Past effective date warning
            const today = new Date().toISOString().slice(0, 10)
            const isPast = assignForm.effective_from && assignForm.effective_from < today

            function handleSubmit() {
              if (!assignForm.value || !assignForm.effective_from) return
              if (assignTarget === 'shift') {
                shiftAssignMutation.mutate({ shift_id: assignForm.value, effective_from: assignForm.effective_from })
              } else {
                jobAssignMutation.mutate({
                  fieldKey:       cfg.fieldKey,
                  value:          assignForm.value,
                  effective_from: assignForm.effective_from,
                  reason:         assignForm.reason,
                })
              }
            }

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-sm">{cfg.title}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Current assignment */}
                  <div className="p-2.5 rounded-md bg-muted/50 border border-border text-xs">
                    <span className="text-muted-foreground">Current: </span>
                    <span className="font-medium text-foreground">{cfg.currentLabel}</span>
                  </div>

                  {/* New value */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">New {cfg.title.replace('Reassign ', '').replace('Change ', '')}</Label>
                    {assignTarget === 'manager' ? (
                      // Employee picker — search-by-name-or-code, never a raw dropdown
                      // over the (potentially enterprise-scale) employees list. (ISSUE-146)
                      <EmployeeSelector
                        value={assignForm.value}
                        onChange={v => setAssignForm(p => ({ ...p, value: typeof v === 'string' ? v : (v[0] ?? '') }))}
                        excludeIds={id ? [id] : []}
                        placeholder="Search manager by name or code…"
                        className="w-full"
                      />
                    ) : (
                      <select
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                        value={assignForm.value}
                        onChange={e => setAssignForm(p => ({ ...p, value: e.target.value }))}
                      >
                        <option value="">— Select —</option>
                        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    )}
                  </div>

                  {/* Effective from */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Effective From *</Label>
                    <DateInput
                      className="h-8 text-xs"
                      value={assignForm.effective_from}
                      onChange={v => setAssignForm(p => ({ ...p, effective_from: v }))}
                    />
                    {isPast && (
                      <p className="text-[10px] text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Backdated assignment — will be recorded with a past effective date
                      </p>
                    )}
                  </div>

                  {/* Reason — not shown for shift (shift endpoint doesn't take reason) */}
                  {assignTarget !== 'shift' && (
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Reason for Change</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="Promotion, restructure, transfer…"
                        value={assignForm.reason}
                        onChange={e => setAssignForm(p => ({ ...p, reason: e.target.value }))}
                      />
                    </div>
                  )}

                  {/* Recent history preview */}
                  {historyRows.length > 0 && assignTarget !== 'shift' && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">Recent Changes</p>
                      <div className="space-y-1">
                        {historyRows.map((row, i: number) => {
                          const val =
                            assignTarget === 'department'      ? row.departments?.name      :
                            assignTarget === 'designation'     ? row.designations?.name     :
                            assignTarget === 'grade'           ? row.grades?.name           :
                            assignTarget === 'manager'         ? (row.manager ? `${row.manager.first_name} ${row.manager.last_name}` : null) :
                            assignTarget === 'cost_center'     ? row.cost_centers?.name     :
                            assignTarget === 'work_location'   ? row.work_locations?.name   :
                            assignTarget === 'employment_type' ? row.employment_type        : null
                          if (!val) return null
                          return (
                            <div key={row.id ?? i} className="flex items-center justify-between text-[10px] py-1 border-b border-border/40 last:border-0">
                              <span className="text-foreground font-medium">{val}</span>
                              <span className="text-muted-foreground">{fmtDate(row.effective_from)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Shift history — shown when reassigning shift */}
                  {assignTarget === 'shift' && (shiftHistoryData?.data?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">Shift History</p>
                      <div className="space-y-1">
                        {(shiftHistoryData!.data ?? []).slice(0, 4).map((row) => (
                          <div key={row.id} className="flex items-center justify-between text-[10px] py-1 border-b border-border/40 last:border-0">
                            <span className="text-foreground font-medium">{row.shifts?.name ?? '—'}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{fmtDate(row.effective_from)}</span>
                              {row.is_current && <Badge variant="success" className="rounded-full text-[8px] py-0">Current</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => setAssignTarget(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={!assignForm.value || !assignForm.effective_from || isPending}
                    onClick={handleSubmit}
                  >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Confirm Assignment
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </>
  )
}
