/**
 * EmployeeProfile › Job & Position (workforce) tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useMemo, useState } from 'react'
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
import { Building2, History, LayoutGrid, MapPin, Pencil, Plus, Trash2, Loader2 } from 'lucide-react'
import {
  EmptySection, Grid2, KV,
  type FullProfile, type JobHistoryRow, type PrevEmploymentRow, type JobFormState, type Section,
} from './shared'
import { fmtDate } from './format-helpers'

interface OrgContextData {
  site:               { id: string; name: string; timezone: string } | null
  roster:             { id: string; name: string; cycle_days: number } | null
  roster_source:      'employee' | 'site' | null
  rotation_policy:    { id: string; name: string } | null
  rotation_source:    'employee' | 'site' | null
  rotation_policy_id: string | null
  effective_from:    string | null
  source:            'history' | 'employee'
  upcoming_holidays: { date: string; name: string; is_optional: boolean }[]
}

interface WorkforceTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
  emp: FullProfile['employee'] | undefined
  job: FullProfile['job_info'] | undefined
  jobHistoryData: { data: JobHistoryRow[] } | undefined
  setSubTab: (tab: string) => void
  setCdlg: (v: { msg: string; act: () => void } | null) => void
}

export function WorkforceTab({
  id, isAdmin, subTab, visited, emp, job, jobHistoryData, setSubTab, setCdlg,
}: WorkforceTabProps) {
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

  const { data: prevEmpData } = useQuery<{ data: PrevEmploymentRow[] }>({
    queryKey: ['prev-employment', id], queryFn: () => api.get(`/employees/${id}/previous-employment`),
    enabled: !!id && visited.has('employment'), staleTime: 30_000,
  })
  const [addPrevOpen, setAddPrevOpen] = useState(false)
  const [prevForm, setPrevForm]       = useState<Record<string, string>>({})
  const addPrevMutation = useMutation({
    mutationFn: (d: Record<string, string>) => api.post(`/employees/${id}/previous-employment`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prev-employment', id] }); setAddPrevOpen(false); toast.success('Added') },
    onError:   () => toast.error('Failed'),
  })
  const delPrevMutation = useMutation({
    mutationFn: (prevId: string) => api.delete(`/employees/${id}/previous-employment/${prevId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prev-employment', id] }); toast.success('Employment record removed') },
    onError:   (e: Error) => toast.error('Failed to remove record', { description: e.message }),
  })

  const { data: orgCtxData, refetch: refetchOrgCtx } = useQuery<{ data: OrgContextData }>({
    queryKey: ['emp-org-context', id],
    queryFn:  () => api.get(`/employees/${id}/org-context`),
    enabled:  !!id && visited.has('employment'),
    staleTime: 60_000,
  })
  const orgCtx = orgCtxData?.data

  const [orgDlgOpen, setOrgDlgOpen] = useState(false)
  const [orgForm, setOrgForm]       = useState({ site_id: '', roster_id: '', rotation_policy_id: '', effective_from: new Date().toISOString().slice(0, 10), reason: '' })

  const orgMutation = useMutation({
    mutationFn: (body: typeof orgForm) =>
      api.post(`/employees/${id}/org-context`, {
        site_id:            body.site_id            || null,
        roster_id:          body.roster_id          || null,
        rotation_policy_id: body.rotation_policy_id || null,
        effective_from:     body.effective_from,
        reason:             body.reason             || null,
      }),
    onSuccess: (_d: unknown, body) => {
      setOrgDlgOpen(false); refetchOrgCtx()
      qc.invalidateQueries({ queryKey: ['job-current', id] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      toast.success('Organisation context updated')
      promptRecompute(body.effective_from, 'roster / rotation')
    },
    onError:   (e: Error) => toast.error('Failed to update org context', { description: e.message }),
  })

  const [addJobOpen, setAddJobOpen] = useState(false)

  const { data: sitesListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['sites-list'],
    queryFn:  () => api.get('/masters/sites'),
    enabled:  orgDlgOpen || addJobOpen,
    staleTime: 120_000,
  })
  const { data: rostersListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['rosters-list'],
    queryFn:  () => api.get('/masters/rosters'),
    enabled:  orgDlgOpen || addJobOpen,
    staleTime: 120_000,
  })
  const { data: rotationListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['rotation-policies-list'],
    queryFn:  () => api.get('/masters/rotation-policies'),
    enabled:  orgDlgOpen || addJobOpen,
    staleTime: 120_000,
  })
  const sitesList    = sitesListData?.data    ?? []
  const rostersList  = rostersListData?.data  ?? []
  const rotationList = rotationListData?.data ?? []

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
    enabled: addJobOpen, staleTime: 300_000,
  })
  const { data: ccListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['masters-cost-centers'], queryFn: () => api.get('/masters/cost-centers'),
    enabled: !!id, staleTime: 300_000,
  })
  const { data: wlListData } = useQuery<{ data: { id: string; name: string; city: string }[] }>({
    queryKey: ['masters-work-locations'], queryFn: () => api.get('/masters/work-locations'),
    enabled: !!id, staleTime: 300_000,
  })

  const [jobForm, setJobForm] = useState<JobFormState>({})
  const addJobMutation = useMutation({
    mutationFn: async (d: JobFormState) => {
      // One form writes to TWO backends (single-writer split preserved):
      //   • job fields            → job_history
      //   • site/roster/rotation  → org-context
      // NO-OP GUARD: only write each side when its values actually changed vs the
      // current record, so re-saving without edits never spawns a duplicate
      // effective-dated revision / org assignment.
      const { site_id, roster_id, rotation_policy_id, ...jobFields } = d
      const norm = (v: unknown) => v ?? null
      const jobChanged = !job || (
        norm(jobFields.department_id)    !== norm(job.departments?.id)    ||
        norm(jobFields.designation_id)   !== norm(job.designations?.id)   ||
        norm(jobFields.grade_id)         !== norm(job.grades?.id)         ||
        norm(jobFields.manager_id)       !== norm(job.manager?.id)        ||
        norm(jobFields.work_location_id) !== norm(job.work_locations?.id) ||
        norm(jobFields.cost_center_id)   !== norm(job.cost_center?.id)    ||
        norm(jobFields.employment_type)  !== norm(job.employment_type)
      )
      const curSite   = orgCtx?.site?.id           ?? ''
      const curRoster = orgCtx?.roster?.id          ?? ''
      const curRot    = orgCtx?.rotation_policy_id  ?? ''
      const orgChanged =
        (site_id ?? '') !== curSite ||
        (roster_id ?? '') !== curRoster ||
        (rotation_policy_id ?? '') !== curRot

      if (jobChanged) await api.post(`/employees/${id}/job-history`, jobFields)
      if (orgChanged) {
        await api.post(`/employees/${id}/org-context`, {
          site_id:            site_id            || null,
          roster_id:          roster_id          || null,
          rotation_policy_id: rotation_policy_id || null,
          effective_from:     jobFields.effective_from,
          reason:             jobFields.reason_for_change || null,
        })
      }
      return { jobChanged, orgChanged }
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['job-history-all', id] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['emp-org-context', id] })
      // Department/designation/manager changes here are what Employee List's
      // columns and Org Chart's tree structure are actually built from.
      qc.invalidateQueries({ queryKey: ['employees'] })
      setAddJobOpen(false)
      if (!res?.jobChanged && !res?.orgChanged) toast.message('No changes to save')
      else toast.success(job ? 'Job details revised' : 'Job details saved')
    },
    onError:   (e: Error) => toast.error('Failed to save job details', { description: e.message }),
  })
  const delJobMutation = useMutation({
    mutationFn: (rowId: string) => api.delete(`/employees/${id}/job-history/${rowId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-history-all', id] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Position record deleted')
    },
    onError:   (e: Error) => toast.error('Failed to delete record', { description: e.message }),
  })

  // Open the unified Job Details editor. With an existing record it pre-fills the
  // current values and defaults effective_from to today (a change creates an
  // effective-dated REVISION). With no record it starts blank, effective from the
  // joining date (a plain CREATION — no revision noise). Site/roster/rotation are
  // pre-filled from the current org context so the one form edits everything.
  function openJobEditor() {
    const today = new Date().toISOString().slice(0, 10)
    const org = {
      site_id:            orgCtx?.site?.id           ?? '',
      roster_id:          orgCtx?.roster?.id          ?? '',
      rotation_policy_id: orgCtx?.rotation_policy_id  ?? '',
    }
    setJobForm(job ? {
      employment_type:   job.employment_type        ?? 'permanent',
      department_id:     job.departments?.id         ?? null,
      designation_id:    job.designations?.id        ?? null,
      grade_id:          job.grades?.id              ?? null,
      manager_id:        job.manager?.id             ?? null,
      work_location_id:  job.work_locations?.id      ?? null,
      cost_center_id:    job.cost_center?.id         ?? null,
      ...org,
      effective_from:    today,
      reason_for_change: '',
    } : {
      employment_type:   'permanent',
      ...org,
      effective_from:    emp?.joining_date  ?? today,
      reason_for_change: 'Initial',
    })
    setAddJobOpen(true)
  }

  // Derive future-dated job assignment (first future record per field)
  const futureJobRecord = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return (jobHistoryData?.data ?? []).find(
      (r: JobHistoryRow) => r.effective_from > today && !!r.is_current
    ) ?? null
  }, [jobHistoryData])

  return (
    <>
      {subTab === 'workforce' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  Job Details
                </CardTitle>
                {isAdmin && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={openJobEditor}>
                    <Pencil className="h-3.5 w-3.5" />{job ? 'Edit Job Details' : 'Set Job Details'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!job && (
                <p className="text-xs text-muted-foreground mb-3">
                  No job details set yet. Click <span className="font-medium text-foreground">Set Job Details</span> to fill department, designation, grade, manager, location, cost center and employment type in one form.
                </p>
              )}
              <Grid2>
                <KV label="Department"      value={job?.departments?.name} />
                <KV label="Designation"     value={job?.designations?.name} />
                <KV label="Grade / Band"    value={job?.grades ? `${job.grades.name} (${job.grades.code})` : undefined} />
                <KV label="Employment Type" value={job?.employment_type ? job.employment_type.charAt(0).toUpperCase() + job.employment_type.slice(1) : undefined} />
                <KV label="Reporting Manager" value={job?.manager ? `${job.manager.first_name} ${job.manager.last_name} #${job.manager.employee_code}` : undefined} />
                <KV label="Work Location"   value={job?.work_locations ? `${job.work_locations.name}${job.work_locations.city ? ` · ${job.work_locations.city}` : ''}` : undefined} />
                <KV label="Cost Center"     value={job?.cost_center ? `${job.cost_center.name} (${job.cost_center.code})` : undefined} />
                {job && <KV label="Effective Since" value={fmtDate(job.effective_from)} />}
              </Grid2>
              {futureJobRecord && (
                <p className="mt-3 text-[11px] text-warning">
                  Pending change effective {fmtDate(futureJobRecord.effective_from)}.
                </p>
              )}
              <p className="mt-3 text-[10px] text-muted-foreground">
                Site, roster &amp; rotation can be set in <button className="underline hover:text-foreground" onClick={openJobEditor}>Edit Job Details</button> (shown in the Site &amp; Roster Assignment card below); shift overrides live on the <button className="underline hover:text-foreground" onClick={() => setSubTab('shift-schedule')}>Shift &amp; Roster</button> tab. Editing records an effective-dated revision (see Position History).
              </p>
            </CardContent>
          </Card>

          {/* Org context panel — Site & Roster. Always shown: org context
              (site/roster/rotation) is independent of the job_history row, so
              it must render — and stay editable — even when no job is set. */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  Site &amp; Roster Assignment
                </CardTitle>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setOrgForm({
                        site_id:            orgCtx?.site?.id          ?? '',
                        roster_id:          orgCtx?.roster?.id        ?? '',
                        rotation_policy_id: orgCtx?.rotation_policy_id ?? '',
                        effective_from:     new Date().toISOString().slice(0, 10),
                        reason:             '',
                      })
                      setOrgDlgOpen(true)
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground border border-border hover:border-primary/50 rounded px-1.5 py-0.5 transition-colors"
                  >
                    Reassign
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Grid2>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Site</p>
                  {orgCtx?.site
                    ? <><p className="text-sm font-medium">{orgCtx.site.name}</p><p className="text-xs text-muted-foreground font-mono">{orgCtx.site.timezone}</p></>
                    : <p className="text-sm text-muted-foreground">Not assigned</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Roster</p>
                  {orgCtx?.roster
                    ? <><p className="text-sm font-medium">{orgCtx.roster.name}</p><p className="text-xs text-muted-foreground">{orgCtx.roster.cycle_days}-day cycle{orgCtx.roster_source === 'site' ? ' · inherited from site' : ''}</p></>
                    : <p className="text-sm text-muted-foreground">No roster</p>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Rotation Policy</p>
                  {orgCtx?.rotation_policy
                    ? <><p className="text-sm font-medium">{orgCtx.rotation_policy.name}</p><p className="text-xs text-muted-foreground">{orgCtx.rotation_source === 'site' ? 'inherited from site' : 'employee-specific'}</p></>
                    : <p className="text-sm text-muted-foreground">None</p>}
                </div>
              </Grid2>
            </CardContent>
          </Card>
        </div>
      )}

      {subTab === 'workforce' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Position History</CardTitle>
              {isAdmin && (
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setJobForm({ employment_type: 'permanent', effective_from: new Date().toISOString().slice(0,10), is_current: true }); setAddJobOpen(true) }}>
                  <Plus className="h-3.5 w-3.5" />Add Record
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!(jobHistoryData?.data?.length)
              ? <div className="px-6 pb-6"><EmptySection icon={History} title="No position history" /></div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border">{['Dept','Designation','Work Location','Cost Center','Manager','Eff. From','Eff. To', ...(isAdmin ? [''] : [])].map((h,i)=><th key={h||`act${i}`} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                    <tbody>
                      {jobHistoryData!.data.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2">{row.departments?.name ?? '—'}</td>
                          <td className="px-4 py-2">{row.designations?.name ?? '—'}</td>
                          <td className="px-4 py-2">{row.work_locations?.name ?? '—'}</td>
                          <td className="px-4 py-2">{row.cost_centers?.name ?? '—'}</td>
                          <td className="px-4 py-2">{row.manager ? `${row.manager.first_name} ${row.manager.last_name}` : '—'}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{fmtDate(row.effective_from)}</td>
                          <td className="px-4 py-2 whitespace-nowrap">{row.is_current ? <Badge variant="success" className="rounded-full text-[9px]">Current</Badge> : fmtDate(row.effective_to)}</td>
                          {isAdmin && (
                            <td className="px-4 py-2 text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                onClick={() => { if (confirm('Delete this position record? This cannot be undone.')) delJobMutation.mutate(row.id) }}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </CardContent>
        </Card>
      )}

      {/* EMPLOYMENT › Previous Employment — merged into the Job & Position (workforce) tab */}
      {subTab === 'workforce' && (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setPrevForm({}); setAddPrevOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Employment</Button>
            </div>
          )}
          {!(prevEmpData?.data?.length)
            ? <Card><CardContent className="pt-6"><EmptySection icon={Building2} title="No previous employment records" /></CardContent></Card>
            : prevEmpData!.data.map((pe) => (
              <Card key={pe.id}>
                <CardContent className="pt-4 pb-4 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{pe.company_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{pe.designation}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(pe.from_date)} – {pe.to_date ? fmtDate(pe.to_date) : 'Present'}</p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delPrevMutation.mutate(pe.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* Organisation Assignment dialog */}
      <Dialog open={orgDlgOpen} onOpenChange={setOrgDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Organisation Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Site</label>
              <select value={orgForm.site_id} onChange={(e) => setOrgForm((p) => ({ ...p, site_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50">
                <option value="">— None —</option>
                {sitesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {/* Work Location & Cost Center are managed ONLY in the Job Details
                editor (Workforce tab → job_history). They were removed from
                this dialog to end the two-route duplication that caused saves
                to conflict/clear each other. */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Roster</label>
              <select value={orgForm.roster_id} onChange={(e) => setOrgForm((p) => ({ ...p, roster_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50">
                <option value="">— None —</option>
                {rostersList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Rotation Policy</label>
              <select value={orgForm.rotation_policy_id} onChange={(e) => setOrgForm((p) => ({ ...p, rotation_policy_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50">
                <option value="">— Inherit from site default —</option>
                {rotationList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Effective From *</label>
              <DateInput value={orgForm.effective_from} onChange={(v) => setOrgForm((p) => ({ ...p, effective_from: v }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Reason</label>
              <Input value={orgForm.reason} onChange={(e) => setOrgForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Transfer, restructure…" className="h-8 text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOrgDlgOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={orgMutation.isPending || !orgForm.effective_from}
              onClick={() => orgMutation.mutate(orgForm)}>
              {orgMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addJobOpen} onOpenChange={setAddJobOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{job ? 'Edit Job Details' : 'Set Job Details'}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {job && (
              <p className="text-[11px] text-muted-foreground">
                Saving with a new effective date records an effective-dated revision (the previous values are kept in Position History).
              </p>
            )}
            {/* Employment Type */}
            <div>
              <Label className="text-xs">Employment Type</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.employment_type ?? 'permanent'} onChange={e => setJobForm((p)=>({...p,employment_type:e.target.value}))}>
                {['permanent','contract','intern','probation','consultant'].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            {/* Department */}
            <div>
              <Label className="text-xs">Department</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.department_id ?? ''} onChange={e=>setJobForm((p)=>({...p,department_id:e.target.value||null}))}>
                <option value="">— None —</option>
                {(deptListData?.data ?? []).map((d)=><option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {/* Designation + Grade */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Designation</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.designation_id ?? ''} onChange={e=>setJobForm((p)=>({...p,designation_id:e.target.value||null}))}>
                  <option value="">— None —</option>
                  {(desigListData?.data ?? []).map((d)=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Grade / Band</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.grade_id ?? ''} onChange={e=>setJobForm((p)=>({...p,grade_id:e.target.value||null}))}>
                  <option value="">— None —</option>
                  {(gradeListData?.data ?? []).map((g)=><option key={g.id} value={g.id}>{g.name} ({g.code})</option>)}
                </select>
              </div>
            </div>
            {/* Reporting Manager */}
            <div>
              <Label className="text-xs">Reporting Manager</Label>
              <EmployeeSelector
                value={jobForm.manager_id ?? ''}
                onChange={(v) => { const val = typeof v === 'string' ? v : (v[0] ?? ''); setJobForm((p)=>({ ...p, manager_id: val || null })) }}
                excludeIds={id ? [id] : []}
                placeholder="Search manager by name or code…"
                className="mt-1 w-full"
              />
            </div>
            {/* Work Location + Cost Center */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Work Location</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.work_location_id ?? ''} onChange={e=>setJobForm((p)=>({...p,work_location_id:e.target.value||null}))}>
                  <option value="">— None —</option>
                  {(wlListData?.data ?? []).map((w)=><option key={w.id} value={w.id}>{w.name}{w.city ? ` · ${w.city}` : ''}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Cost Center</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.cost_center_id ?? ''} onChange={e=>setJobForm((p)=>({...p,cost_center_id:e.target.value||null}))}>
                  <option value="">— None —</option>
                  {(ccListData?.data ?? []).map((c)=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
            </div>
            {/* Site / Roster / Rotation — written to org-context on save */}
            <div className="pt-1 border-t border-border/60">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-2 mb-1">Site, Roster &amp; Rotation</p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Site</Label>
                  <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.site_id ?? ''} onChange={e=>setJobForm((p)=>({...p,site_id:e.target.value}))}>
                    <option value="">— None —</option>
                    {sitesList.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Roster</Label>
                    <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.roster_id ?? ''} onChange={e=>setJobForm((p)=>({...p,roster_id:e.target.value}))}>
                      <option value="">— Inherit from site —</option>
                      {rostersList.map((r)=><option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Rotation Policy</Label>
                    <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.rotation_policy_id ?? ''} onChange={e=>setJobForm((p)=>({...p,rotation_policy_id:e.target.value}))}>
                      <option value="">— Inherit from site —</option>
                      {rotationList.map((r)=><option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            {/* Effective From */}
            <div>
              <Label className="text-xs">Effective From *</Label>
              <DateInput className="mt-1 h-8 text-xs" value={jobForm.effective_from ?? ''} onChange={v=>setJobForm((p)=>({...p,effective_from:v}))} />
            </div>
            {/* Reason */}
            <div>
              <Label className="text-xs">Reason for Change</Label>
              <Input className="mt-1 h-8 text-xs" value={jobForm.reason_for_change ?? ''} onChange={e=>setJobForm((p)=>({...p,reason_for_change:e.target.value}))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddJobOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addJobMutation.mutate(jobForm)} disabled={addJobMutation.isPending || !jobForm.effective_from}>
              {addJobMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addPrevOpen} onOpenChange={setAddPrevOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Previous Employment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {([{label:'Company',key:'company_name'},{label:'Designation',key:'designation'},{label:'Reason for Leaving',key:'reason_for_leaving'}] as const).map(f=>(
              <div key={f.key}><Label className="text-xs">{f.label}</Label><Input className="mt-1 h-8 text-xs" value={prevForm[f.key]??''} onChange={e=>setPrevForm((p)=>({...p,[f.key]:e.target.value}))}/></div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">From</Label><DateInput className="mt-1 h-8 text-xs" value={prevForm.from_date??''} onChange={v=>setPrevForm((p)=>({...p,from_date:v}))}/></div>
              <div><Label className="text-xs">To</Label><DateInput className="mt-1 h-8 text-xs" value={prevForm.to_date??''} onChange={v=>setPrevForm((p)=>({...p,to_date:v}))}/></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddPrevOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addPrevMutation.mutate(prevForm)} disabled={addPrevMutation.isPending}>
              {addPrevMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
