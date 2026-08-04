/**
 * EmployeeProfile › Family & Nominees tab.
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
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, Users, Loader2 } from 'lucide-react'
import {
  EmptySection,
  type FamilyRow, type NominationRow, type MasterOption, type FamilyForm, type Section,
} from './shared'
import { fmtDate } from './format-helpers'

interface FamilyTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
}

export function FamilyTab({ id, isAdmin, subTab, visited }: FamilyTabProps) {
  const qc = useQueryClient()

  const { data: familyData } = useQuery<{ data: FamilyRow[] }>({
    queryKey: ['family', id], queryFn: () => api.get(`/employees/${id}/family`),
    enabled: !!id && visited.has('relationships'), staleTime: 30_000,
  })
  const { data: nominationsData } = useQuery<{ data: NominationRow[] }>({
    queryKey: ['nominations', id], queryFn: () => api.get(`/employees/${id}/nominations`),
    enabled: !!id && visited.has('relationships'), staleTime: 30_000,
  })
  const { data: relTypesData } = useQuery<{ data: MasterOption[] }>({
    queryKey: ['relationship-types'], queryFn: () => api.get('/masters/relationship-types'),
    enabled: !!id && visited.has('relationships'), staleTime: 5 * 60_000,
  })

  const [addFamOpen, setAddFamOpen] = useState(false)
  const [famForm, setFamForm]       = useState<FamilyForm>({})
  const addFamMutation = useMutation({
    mutationFn: (d: FamilyForm) => api.post(`/employees/${id}/family`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['family', id] }); setAddFamOpen(false); toast.success('Added') },
    onError:   () => toast.error('Failed'),
  })
  const delFamMutation = useMutation({
    mutationFn: (famId: string) => api.delete(`/employees/${id}/family/${famId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['family', id] }); toast.success('Family member removed') },
    onError:   (e: Error) => toast.error('Failed to remove family member', { description: e.message }),
  })

  const [nomDlgOpen, setNomDlgOpen] = useState(false)
  const [nomScheme, setNomScheme]   = useState<'pf' | 'gratuity' | 'esi' | 'superannuation'>('pf')
  const [nomForm, setNomForm] = useState({
    nominee_name: '', share_percentage: '', dob: '', is_minor: false, guardian_name: '',
  })
  const addNomMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/nominations`, {
      scheme:           nomScheme,
      nominee_name:     nomForm.nominee_name,
      share_percentage: Number(nomForm.share_percentage),
      dob:              nomForm.dob || undefined,
      is_minor:         nomForm.is_minor,
      guardian_name:    nomForm.is_minor ? (nomForm.guardian_name || undefined) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nominations', id] }); setNomDlgOpen(false); toast.success('Nominee added') },
    onError:   (e: Error) => toast.error(e.message),
  })
  const delNomMutation = useMutation({
    mutationFn: (nomId: string) => api.delete(`/employees/${id}/nominations/${nomId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['nominations', id] }); toast.success('Nominee removed') },
    onError:   (e: Error) => toast.error('Failed to remove nominee', { description: e.message }),
  })

  return (
    <>
      {subTab === 'family' && (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setFamForm({}); setAddFamOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Member</Button>
            </div>
          )}
          {!(familyData?.data?.length)
            ? <Card><CardContent className="pt-6"><EmptySection icon={Users} title="No family members" /></CardContent></Card>
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{familyData!.data.map((fm) => (
                <Card key={fm.id}>
                  <CardContent className="pt-4 pb-4 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold">{fm.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{fm.relationship_types?.name ?? '—'}</p>
                      {fm.dob && <p className="text-xs text-muted-foreground">{fmtDate(fm.dob)}</p>}
                      {fm.is_dependent && <Badge variant="outline" className="rounded-full text-[9px] mt-1">Dependent</Badge>}
                    </div>
                    {isAdmin && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delFamMutation.mutate(fm.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                  </CardContent>
                </Card>
              ))}</div>}
        </div>
      )}

      {/* RELATIONSHIPS › Nomination — merged into the Family tab */}
      {subTab === 'family' && (
        <div className="space-y-4">
          {(['pf', 'gratuity', 'esi', 'superannuation'] as const).map(scheme => {
            const schemeNoms = (nominationsData?.data ?? []).filter((n) => n.scheme === scheme)
            const schemeTotal = schemeNoms.reduce((s: number, n) => s + Number(n.share_percentage), 0)
            return (
              <Card key={scheme}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold uppercase flex items-center gap-2">
                      {scheme}
                      {schemeNoms.length > 0 && (
                        <Badge variant={schemeTotal === 100 ? 'success' : 'warning'} className="rounded-full text-[9px] normal-case">
                          {schemeTotal}% allocated
                        </Badge>
                      )}
                    </CardTitle>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                        onClick={() => {
                          setNomScheme(scheme)
                          setNomForm({ nominee_name: '', share_percentage: '', dob: '', is_minor: false, guardian_name: '' })
                          setNomDlgOpen(true)
                        }}>
                        <Plus className="h-3.5 w-3.5" />Add Nominee
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!schemeNoms.length
                    ? <p className="text-xs text-muted-foreground">{isAdmin ? 'No nominees yet — click Add Nominee.' : 'No nominations for this scheme.'}</p>
                    : <div className="space-y-2">{schemeNoms.map((n) => (
                      <div key={n.id} className="flex items-center justify-between text-xs p-2.5 rounded-md bg-muted/30">
                        <div>
                          <span className="font-medium">{n.nominee_name}</span>
                          {n.relationship_types?.name && <span className="text-muted-foreground ml-1.5">({n.relationship_types.name})</span>}
                          {n.dob && <p className="text-muted-foreground text-[10px] mt-0.5">DOB: {fmtDate(n.dob)}</p>}
                          {n.is_minor && n.guardian_name && <p className="text-[10px] text-warning mt-0.5">Guardian: {n.guardian_name}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-semibold tabular-nums">{n.share_percentage}%</span>
                          {n.is_minor && <Badge variant="warning" className="rounded-full text-[9px]">Minor</Badge>}
                          {isAdmin && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => { if (confirm(`Remove ${n.nominee_name}?`)) delNomMutation.mutate(n.id) }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}</div>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={addFamOpen} onOpenChange={setAddFamOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Family Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input className="mt-1 h-8 text-xs" value={famForm.name??''} onChange={e=>setFamForm((p)=>({...p,name:e.target.value}))}/></div>
            <div>
              <Label className="text-xs">Relationship</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={famForm.relationship_type_id??''} onChange={e=>setFamForm((p)=>({...p,relationship_type_id:e.target.value}))}>
                <option value="">Select relationship…</option>
                {(relTypesData?.data ?? []).map((rt)=><option key={rt.id} value={rt.id}>{rt.name}</option>)}
              </select>
              {!(relTypesData?.data?.length) && <p className="text-[10px] text-warning mt-1">No relationship types configured. Add them under Masters first.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Date of Birth</Label><DateInput className="mt-1 h-8 text-xs" value={famForm.dob??''} onChange={v=>setFamForm((p)=>({...p,dob:v}))}/></div>
              <div>
                <Label className="text-xs">Gender</Label>
                <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={famForm.gender??''} onChange={e=>setFamForm((p)=>({...p,gender:e.target.value}))}>
                  {[['',''],['male','Male'],['female','Female'],['other','Other']].map(([v,l])=><option key={v} value={v}>{l||'—'}</option>)}
                </select>
              </div>
            </div>
            <div><Label className="text-xs">Occupation</Label><Input className="mt-1 h-8 text-xs" value={famForm.occupation??''} onChange={e=>setFamForm((p)=>({...p,occupation:e.target.value}))}/></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fam_dep" checked={!!famForm.is_dependent} onChange={e=>setFamForm((p)=>({...p,is_dependent:e.target.checked}))} className="rounded" />
              <Label htmlFor="fam_dep" className="text-xs">Dependent</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddFamOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={addFamMutation.isPending || !famForm.name || !famForm.relationship_type_id} onClick={()=>addFamMutation.mutate(famForm)}>
              {addFamMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={nomDlgOpen} onOpenChange={setNomDlgOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Nominee — {nomScheme.toUpperCase()}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Nominee Name</Label><Input className="mt-1 h-8 text-xs" value={nomForm.nominee_name} onChange={e=>setNomForm(f=>({...f,nominee_name:e.target.value}))}/></div>
            <div><Label className="text-xs">Share % <span className="text-muted-foreground">(of total 100%)</span></Label><Input type="number" min="1" max="100" className="mt-1 h-8 text-xs" value={nomForm.share_percentage} onChange={e=>setNomForm(f=>({...f,share_percentage:e.target.value}))}/></div>
            <div><Label className="text-xs">Date of Birth</Label><DateInput className="mt-1 h-8 text-xs" value={nomForm.dob} onChange={v=>setNomForm(f=>({...f,dob:v}))}/></div>
            <div className="flex items-center gap-2">
              <Switch checked={nomForm.is_minor} onCheckedChange={v=>setNomForm(f=>({...f,is_minor:v}))} />
              <Label className="text-xs">Nominee is a minor</Label>
            </div>
            {nomForm.is_minor && (
              <div><Label className="text-xs">Guardian Name <span className="text-destructive">*</span></Label><Input className="mt-1 h-8 text-xs" value={nomForm.guardian_name} onChange={e=>setNomForm(f=>({...f,guardian_name:e.target.value}))}/></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={()=>setNomDlgOpen(false)}>Cancel</Button>
            <Button size="sm"
              disabled={!nomForm.nominee_name || !nomForm.share_percentage || (nomForm.is_minor && !nomForm.guardian_name) || addNomMutation.isPending}
              onClick={()=>addNomMutation.mutate()}>
              {addNomMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Add Nominee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
