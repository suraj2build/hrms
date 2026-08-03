/**
 * EmployeeProfile › Education tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, Files, GraduationCap, Loader2 } from 'lucide-react'
import { uploadEmployeeFile } from '@/lib/supabase-storage'
import { EmptySection, type EducationRow, type Section } from './shared'

interface EducationTabProps {
  id: string | undefined
  isAdmin: boolean
  tenantId: string
  subTab: string
  visited: Set<Section>
  openSignedUrl: (path: string) => void
}

export function EducationTab({ id, isAdmin, tenantId, subTab, visited, openSignedUrl }: EducationTabProps) {
  const qc = useQueryClient()

  const { data: educationData } = useQuery<{ data: EducationRow[] }>({
    queryKey: ['education', id], queryFn: () => api.get(`/employees/${id}/education`),
    enabled: !!id && visited.has('core'), staleTime: 30_000,
  })

  const [addEduOpen, setAddEduOpen] = useState(false)
  const [eduForm, setEduForm]       = useState<Record<string, string>>({})
  const [eduFile, setEduFile]       = useState<File | null>(null)
  const addEduMutation = useMutation({
    mutationFn: async (d: Record<string, string>) => {
      let document_path: string | undefined
      let document_name: string | undefined
      if (eduFile) {
        document_path = await uploadEmployeeFile(tenantId, id!, 'documents', eduFile)
        document_name = eduFile.name
      }
      await api.post(`/employees/${id}/education`, { ...d, document_path, document_name })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['education', id] }); setAddEduOpen(false); setEduFile(null); toast.success('Education added') },
    onError:   (e: Error) => toast.error('Failed to add education', { description: e.message }),
  })
  const delEduMutation = useMutation({
    mutationFn: (eduId: string) => api.delete(`/employees/${id}/education/${eduId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['education', id] }); toast.success('Education record removed') },
    onError:   (e: Error) => toast.error('Failed to remove education', { description: e.message }),
  })

  return (
    <>
      {subTab === 'education' && (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setEduForm({}); setEduFile(null); setAddEduOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Education</Button>
            </div>
          )}
          {!(educationData?.data?.length)
            ? <Card><CardContent className="pt-6"><EmptySection icon={GraduationCap} title="No education records" subtitle={isAdmin ? 'Click Add Education to record a qualification.' : undefined} /></CardContent></Card>
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{educationData!.data.map((ed) => (
                <Card key={ed.id}>
                  <CardContent className="pt-4 pb-4 flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{ed.qualification}</p>
                      {ed.specialization && <p className="text-xs text-muted-foreground">{ed.specialization}</p>}
                      {ed.institution && <p className="text-xs text-muted-foreground">{ed.institution}</p>}
                      <p className="text-xs text-muted-foreground">
                        {[ed.year_of_completion ? `Year ${ed.year_of_completion}` : null, ed.grade ? `Grade ${ed.grade}` : null].filter(Boolean).join(' · ')}
                      </p>
                      {ed.document_path && (
                        <button className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1" onClick={() => openSignedUrl(ed.document_path!)}>
                          <Files className="h-3 w-3" />View certificate
                        </button>
                      )}
                    </div>
                    {isAdmin && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delEduMutation.mutate(ed.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </CardContent>
                </Card>
              ))}</div>}
        </div>
      )}

      {/* Add Education */}
      <Dialog open={addEduOpen} onOpenChange={open => { if (!open) { setAddEduOpen(false); setEduFile(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Education</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Qualification <span className="text-destructive">*</span></Label>
              <Input className="mt-1 h-8 text-xs" placeholder="e.g. B.Tech, MBA, 12th" value={eduForm.qualification ?? ''} onChange={e => setEduForm(p => ({ ...p, qualification: e.target.value }))} />
            </div>
            {([{ label: 'Institution', key: 'institution' }, { label: 'Specialization / Stream', key: 'specialization' }] as const).map(f => (
              <div key={f.key}><Label className="text-xs">{f.label}</Label><Input className="mt-1 h-8 text-xs" value={eduForm[f.key] ?? ''} onChange={e => setEduForm(p => ({ ...p, [f.key]: e.target.value }))} /></div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Year of Completion</Label><Input type="number" className="mt-1 h-8 text-xs" value={eduForm.year_of_completion ?? ''} onChange={e => setEduForm(p => ({ ...p, year_of_completion: e.target.value }))} /></div>
              <div><Label className="text-xs">Grade / %</Label><Input className="mt-1 h-8 text-xs" value={eduForm.grade ?? ''} onChange={e => setEduForm(p => ({ ...p, grade: e.target.value }))} /></div>
            </div>
            <div>
              <Label className="text-xs">Certificate (optional)</Label>
              <Input type="file" accept=".pdf,image/*" className="mt-1 h-8 text-xs file:text-xs" onChange={e => setEduFile(e.target.files?.[0] ?? null)} />
              {eduFile && <p className="text-[10px] text-muted-foreground mt-1 truncate">{eduFile.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setAddEduOpen(false); setEduFile(null) }}>Cancel</Button>
            <Button size="sm" onClick={() => addEduMutation.mutate(eduForm)} disabled={addEduMutation.isPending || !(eduForm.qualification ?? '').trim()}>
              {addEduMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
