/**
 * EmployeeProfile › Separation tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Switch } from '@/components/ui/switch'
import { LogOut, Edit2, Loader2 } from 'lucide-react'
import { EmptySection, Grid2, KV, fmtDate, type SeparationData, type Section } from './shared'

interface SeparationTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
}

export function SeparationTab({ id, isAdmin, subTab, visited }: SeparationTabProps) {
  const qc = useQueryClient()

  const { data: separationData } = useQuery({
    queryKey: ['separation', id],
    queryFn: async (): Promise<{ data: SeparationData | null }> => {
      try {
        return await api.get<{ data: SeparationData | null }>(`/employees/${id}/separation`)
      } catch (e: unknown) {
        const err = e as { message?: string; status?: number }
        if (String(err?.message ?? '').includes('404') || err?.status === 404) return { data: null }
        throw e
      }
    },
    enabled: !!id && visited.has('employment'), staleTime: 30_000,
  })

  const [sepDlgOpen, setSepDlgOpen]  = useState(false)
  const [sepIsEdit,  setSepIsEdit]   = useState(false)
  const [sepForm, setSepForm] = useState({
    separation_type:     'resignation',
    initiated_by:        'employee',
    notice_date:         '',
    last_working_date:   '',
    exit_reason:         '',
    exit_interview_done: false,
    clearance_done:      false,
    remarks:             '',
  })
  function openSepDialog(edit: boolean) {
    setSepIsEdit(edit)
    if (edit && separationData?.data) {
      const d = separationData.data
      setSepForm({
        separation_type:     d.separation_type     ?? 'resignation',
        initiated_by:        d.initiated_by        ?? 'employee',
        notice_date:         d.notice_date?.slice(0, 10)       ?? '',
        last_working_date:   d.last_working_date?.slice(0, 10) ?? '',
        exit_reason:         d.exit_reason         ?? '',
        exit_interview_done: d.exit_interview_done ?? false,
        clearance_done:      d.clearance_done      ?? false,
        remarks:             d.remarks             ?? '',
      })
    } else {
      setSepForm({ separation_type: 'resignation', initiated_by: 'employee', notice_date: '', last_working_date: '', exit_reason: '', exit_interview_done: false, clearance_done: false, remarks: '' })
    }
    setSepDlgOpen(true)
  }
  const createSepMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/separation`, {
      ...sepForm,
      notice_date:       sepForm.notice_date       || undefined,
      last_working_date: sepForm.last_working_date || undefined,
      exit_reason:       sepForm.exit_reason       || undefined,
      remarks:           sepForm.remarks           || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['separation', id] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      // Same separation record is also read by the admin Separation Workflow
      // queue (['separations']) and the employee's own ESS view.
      qc.invalidateQueries({ queryKey: ['separations'] })
      qc.invalidateQueries({ queryKey: ['ess-me-separation', id] })
      setSepDlgOpen(false)
      toast.success('Separation initiated')
    },
    onError: (e: Error) => toast.error('Failed to initiate separation', { description: e.message }),
  })
  const updateSepMutation = useMutation({
    mutationFn: () => api.put(`/employees/${id}/separation`, {
      ...sepForm,
      notice_date:       sepForm.notice_date       || undefined,
      last_working_date: sepForm.last_working_date || undefined,
      exit_reason:       sepForm.exit_reason       || undefined,
      remarks:           sepForm.remarks           || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['separation', id] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['separations'] })
      qc.invalidateQueries({ queryKey: ['ess-me-separation', id] })
      setSepDlgOpen(false)
      toast.success('Separation record updated')
    },
    onError: (e: Error) => toast.error('Failed to update separation', { description: e.message }),
  })

  return (
    <>
      {subTab === 'separation' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Separation</CardTitle>
              <div className="flex items-center gap-2">
                {separationData?.data && isAdmin && (
                  <Link
                    to={`/admin/employees/separation?employee=${id}`}
                    className="inline-flex items-center gap-1 h-7 px-2 text-xs text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-primary/50 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />View Clearance Status
                  </Link>
                )}
                {isAdmin && (
                  separationData?.data
                    ? <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => openSepDialog(true)}>
                        <Edit2 className="h-3.5 w-3.5" />Edit
                      </Button>
                    : <Button size="sm" variant="outline" className="h-7 gap-1 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() => openSepDialog(false)}>
                        <LogOut className="h-3.5 w-3.5" />Initiate Separation
                      </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!separationData?.data
              ? <EmptySection icon={LogOut} title="No separation record" subtitle={isAdmin ? 'Click Initiate Separation to begin offboarding.' : 'Employee is currently active.'} />
              : <div className="space-y-4">
                  <Grid2>
                    <KV label="Type"             value={separationData.data.separation_type?.replace(/_/g, ' ')} />
                    <KV label="Initiated By"     value={separationData.data.initiated_by} />
                    <KV label="Notice Date"      value={fmtDate(separationData.data.notice_date)} />
                    <KV label="Last Working Day" value={fmtDate(separationData.data.last_working_date)} />
                    <KV label="Exit Reason"      value={separationData.data.exit_reason} />
                    {separationData.data.remarks && <KV label="Remarks" value={separationData.data.remarks} />}
                    <div className="flex gap-2 flex-wrap sm:col-span-2">
                      <Badge variant={separationData.data.exit_interview_done ? 'success' : 'secondary'} className="rounded-full text-[10px]">{separationData.data.exit_interview_done ? '✓' : '✗'} Exit Interview</Badge>
                      <Badge variant={separationData.data.clearance_done ? 'success' : 'secondary'} className="rounded-full text-[10px]">{separationData.data.clearance_done ? '✓' : '✗'} Clearance</Badge>
                    </div>
                  </Grid2>
                  {/* Inline clearance progress */}
                  {separationData.data.clearances && Array.isArray(separationData.data.clearances) && (
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">Clearance Progress</span>
                        <span className="text-foreground font-semibold">
                          {separationData.data.clearances.filter((c) => c.status === 'cleared').length}/5 departments cleared
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            (() => { const p = (separationData.data.clearances.filter((c) => c.status === 'cleared').length / 5) * 100; return p >= 95 ? 'bg-success' : p >= 50 ? 'bg-warning' : 'bg-destructive' })(),
                          )}
                          style={{ width: `${(separationData.data.clearances.filter((c) => c.status === 'cleared').length / 5) * 100}%` }}
                        />
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {(separationData.data.clearances ?? []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).map((cl) => (
                          <span
                            key={cl.id ?? cl.department}
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                              cl.status === 'cleared'  && 'bg-success/10 text-success',
                              cl.status === 'rejected' && 'bg-destructive/10 text-destructive',
                              cl.status === 'pending'  && 'bg-muted/50 text-muted-foreground',
                            )}
                          >
                            {cl.department}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>}
          </CardContent>
        </Card>
      )}

      <Dialog open={sepDlgOpen} onOpenChange={setSepDlgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{sepIsEdit ? 'Edit Separation Record' : 'Initiate Separation'}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Separation Type</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none capitalize" value={sepForm.separation_type} onChange={e=>setSepForm(f=>({...f,separation_type:e.target.value}))}>
                  {['resignation','termination','retirement','end_of_contract','absconding','deceased','mutual_separation'].map(t=>(
                    <option key={t} value={t}>{t.replace(/_/g,' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Initiated By</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={sepForm.initiated_by} onChange={e=>setSepForm(f=>({...f,initiated_by:e.target.value}))}>
                  <option value="employee">Employee</option>
                  <option value="employer">Employer</option>
                </select>
              </div>
              <div><Label className="text-xs">Notice Date</Label><DateInput className="mt-1 h-8 text-xs" value={sepForm.notice_date} onChange={v=>setSepForm(f=>({...f,notice_date:v}))}/></div>
              <div><Label className="text-xs">Last Working Day</Label><DateInput className="mt-1 h-8 text-xs" value={sepForm.last_working_date} onChange={v=>setSepForm(f=>({...f,last_working_date:v}))}/></div>
            </div>
            <div><Label className="text-xs">Exit Reason</Label><Input className="mt-1 h-8 text-xs" value={sepForm.exit_reason} onChange={e=>setSepForm(f=>({...f,exit_reason:e.target.value}))}/></div>
            <div><Label className="text-xs">Remarks</Label><Input className="mt-1 h-8 text-xs" value={sepForm.remarks} onChange={e=>setSepForm(f=>({...f,remarks:e.target.value}))}/></div>
            <div className="flex gap-6 pt-1">
              <div className="flex items-center gap-2">
                <Switch checked={sepForm.exit_interview_done} onCheckedChange={v=>setSepForm(f=>({...f,exit_interview_done:v}))} />
                <Label className="text-xs">Exit Interview Done</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={sepForm.clearance_done} onCheckedChange={v=>setSepForm(f=>({...f,clearance_done:v}))} />
                <Label className="text-xs">Clearance Done</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={()=>setSepDlgOpen(false)}>Cancel</Button>
            <Button size="sm"
              disabled={createSepMutation.isPending || updateSepMutation.isPending}
              onClick={()=> sepIsEdit ? updateSepMutation.mutate() : createSepMutation.mutate()}>
              {(createSepMutation.isPending || updateSepMutation.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {sepIsEdit ? 'Update' : 'Initiate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
