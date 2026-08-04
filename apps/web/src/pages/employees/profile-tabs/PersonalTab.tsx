/**
 * EmployeeProfile › Personal tab (Personal Information, Addresses,
 * Emergency Contacts, Important Dates).
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Edit2, Check, X, Plus, Trash2, BookOpen, Home, Phone, CalendarClock, Loader2 } from 'lucide-react'
import {
  EmptySection, Grid2,
  type FullProfile, type AddressRow, type EmergencyContactRow, type EmergencyContactForm, type FormBag, type Section,
} from './shared'
import { fmt } from './format-helpers'

interface ImportantDateRow {
  id:           string
  date_type_id: string
  event_date:   string
  year_known:   boolean
  notes:        string | null
  updated_at:   string
  important_date_types?: { id: string; code: string; name: string; is_system: boolean } | null
}
interface ImportantDateType { id: string; code: string; name: string; is_system: boolean; is_active: boolean }

interface PersonalTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
  pi: FullProfile['personal_info'] | undefined
  addresses: AddressRow[]
  emergencyContacts: EmergencyContactRow[]
}

export function PersonalTab({ id, isAdmin, subTab, visited, pi, addresses, emergencyContacts }: PersonalTabProps) {
  const qc = useQueryClient()

  const [editPI, setEditPI] = useState(false)
  const [piForm, setPiForm] = useState<Record<string, string>>({})
  const piMutation = useMutation({
    mutationFn: (d: Record<string, string>) => api.put(`/employees/${id}/personal-info`, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      setEditPI(false)
      toast.success('Saved')
    },
    onError:   () => toast.error('Save failed'),
  })

  const [addrOpen, setAddrOpen] = useState(false)
  const [addrForm, setAddrForm] = useState<FormBag>({})
  const addrMutation = useMutation({
    mutationFn: (d: FormBag) => api.post(`/employees/${id}/addresses`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); setAddrOpen(false); toast.success('Address saved') },
    onError:   (e: Error) => toast.error('Failed to save address', { description: e.message }),
  })
  const delAddrMutation = useMutation({
    mutationFn: (addrId: string) => api.delete(`/employees/${id}/addresses/${addrId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); toast.success('Address removed') },
    onError:   (e: Error) => toast.error('Failed to remove address', { description: e.message }),
  })

  const [emOpen, setEmOpen] = useState(false)
  const [emForm, setEmForm] = useState<EmergencyContactForm>({})
  const emMutation = useMutation({
    mutationFn: (d: EmergencyContactForm) => api.post(`/employees/${id}/emergency-contacts`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); setEmOpen(false); toast.success('Emergency contact saved') },
    onError:   (e: Error) => toast.error('Failed to save contact', { description: e.message }),
  })
  const delEmMutation = useMutation({
    mutationFn: (cid: string) => api.delete(`/employees/${id}/emergency-contacts/${cid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); toast.success('Contact removed') },
    onError:   (e: Error) => toast.error('Failed to remove contact', { description: e.message }),
  })

  const { data: importantDatesData, isLoading: importantDatesLoading } = useQuery<{ data: ImportantDateRow[] }>({
    queryKey: ['important-dates', id],
    queryFn:  () => api.get(`/employees/${id}/important-dates`),
    enabled:  !!id && visited.has('core'),
    staleTime: 60_000,
  })
  const { data: dateTypesData } = useQuery<{ data: ImportantDateType[] }>({
    queryKey: ['important-date-types'],
    queryFn:  () => api.get('/masters/important-date-types'),
    enabled:  !!id && visited.has('core'),
    staleTime: 300_000,
  })
  const importantDates   = importantDatesData?.data ?? []
  const availDateTypes   = (dateTypesData?.data ?? []).filter((dt: ImportantDateType) => dt.is_active)
  const [idateDlgOpen,   setIdateDlgOpen]   = useState(false)
  const [idateEditRow,   setIdateEditRow]   = useState<ImportantDateRow | null>(null)
  const [idateForm,      setIdateForm]      = useState({ date_type_id: '', event_date: '', year_known: true, notes: '' })

  const upsertImportantDateMut = useMutation({
    mutationFn: (f: typeof idateForm) =>
      api.post(`/employees/${id}/important-dates`, {
        date_type_id: f.date_type_id,
        event_date:   f.event_date,
        year_known:   f.year_known,
        notes:        f.notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Important date saved')
      qc.invalidateQueries({ queryKey: ['important-dates', id] })
      setIdateDlgOpen(false)
    },
    onError: (err: unknown) => toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save date'),
  })

  const deleteImportantDateMut = useMutation({
    mutationFn: (dateId: string) => api.delete(`/employees/${id}/important-dates/${dateId}`),
    onSuccess: () => {
      toast.success('Important date removed')
      qc.invalidateQueries({ queryKey: ['important-dates', id] })
    },
    onError: () => toast.error('Failed to remove date'),
  })

  return (
    <>
      {subTab === 'personal' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Personal Information</CardTitle>
              {!editPI
                ? <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                    onClick={() => { setPiForm({ gender: pi?.gender ?? '', dob: pi?.dob?.slice(0,10) ?? '', nationality: pi?.nationality ?? '', marital_status: pi?.marital_status ?? '', blood_group: pi?.blood_group ?? '' }); setEditPI(true) }}>
                    <Edit2 className="h-3.5 w-3.5" />{pi ? 'Edit' : 'Add'}
                  </Button>
                : <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => piMutation.mutate(piForm)} disabled={piMutation.isPending}><Check className="h-3.5 w-3.5 text-success" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditPI(false)}><X className="h-3.5 w-3.5" /></Button>
                  </div>}
            </div>
          </CardHeader>
          <CardContent>
            {!pi && !editPI
              ? <EmptySection icon={BookOpen} title="No personal info on record" subtitle="Click Edit to add information" />
              : (
                <Grid2>
                  {([{ label: 'Gender', key: 'gender', opts: [['',''],['male','Male'],['female','Female'],['other','Other']] }, { label: 'Date of Birth', key: 'dob', type: 'date' }, { label: 'Nationality', key: 'nationality' }, { label: 'Marital Status', key: 'marital_status', opts: [['',''],['single','Single'],['married','Married'],['divorced','Divorced'],['widowed','Widowed']] }, { label: 'Blood Group', key: 'blood_group', opts: [['',''],['A+','A+'],['A-','A-'],['B+','B+'],['B-','B-'],['AB+','AB+'],['AB-','AB-'],['O+','O+'],['O-','O-']] }] as Array<{label:string;key:string;type?:string;opts?:string[][]}>).map(f => (
                    <div key={f.key}>
                      <p className="text-xs text-muted-foreground mb-1">{f.label}</p>
                      {editPI
                        ? f.opts
                          ? <select className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={piForm[f.key] ?? ''} onChange={e => setPiForm((p) => ({ ...p, [f.key]: e.target.value }))}>{f.opts.map(([v,l]) => <option key={v} value={v}>{l || '—'}</option>)}</select>
                          : <Input className="h-7 text-xs" type={f.type ?? 'text'} value={piForm[f.key] ?? ''} onChange={e => setPiForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                        : <p className="text-sm font-medium">{fmt((pi as Record<string, string | null> | null | undefined)?.[f.key])}</p>}
                    </div>
                  ))}
                </Grid2>
              )}
          </CardContent>
        </Card>
      )}

      {/* CORE › Addresses — merged into the Personal tab */}
      {subTab === 'personal' && (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setAddrForm({ address_type: 'current', country: 'India' }); setAddrOpen(true) }}>
                <Plus className="h-3.5 w-3.5" />Add Address
              </Button>
            </div>
          )}
          {!addresses.length
            ? <Card><CardContent className="pt-6"><EmptySection icon={Home} title="No addresses on record" subtitle={isAdmin ? 'Click Add Address to record one.' : undefined} /></CardContent></Card>
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{addresses.map((a) => (
                <Card key={a.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <Badge variant="outline" className="rounded-full text-[9px] capitalize mb-1.5">{a.address_type}</Badge>
                        <p className="text-sm font-medium">{a.line1}{a.line2 ? `, ${a.line2}` : ''}</p>
                        <p className="text-xs text-muted-foreground">{[a.city, a.state, a.pincode].filter(Boolean).join(', ')}</p>
                        <p className="text-xs text-muted-foreground">{a.country}</p>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setAddrForm({ ...a }); setAddrOpen(true) }}><Edit2 className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delAddrMutation.mutate(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}</div>}
        </div>
      )}

      {/* CORE › Emergency Contacts — merged into the Personal tab */}
      {subTab === 'personal' && (
        <div className="space-y-3">
          {isAdmin && (
            <div className="flex justify-end">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setEmForm({ is_primary: false }); setEmOpen(true) }}>
                <Plus className="h-3.5 w-3.5" />Add Contact
              </Button>
            </div>
          )}
          {!emergencyContacts.length
            ? <Card><CardContent className="pt-6"><EmptySection icon={Phone} title="No emergency contacts" subtitle={isAdmin ? 'Click Add Contact to record one.' : undefined} /></CardContent></Card>
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{emergencyContacts.map((c) => (
                <Card key={c.id}>
                  <CardContent className="pt-4 pb-4 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold">{c.name} {c.is_primary && <Badge variant="outline" className="rounded-full text-[9px] ml-1">Primary</Badge>}</p>
                      {c.relationship && <p className="text-xs text-muted-foreground capitalize">{c.relationship}</p>}
                      <p className="text-xs text-muted-foreground">{c.phone}{c.alternate_phone ? ` · ${c.alternate_phone}` : ''}</p>
                      {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                    </div>
                    {isAdmin && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delEmMutation.mutate(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </CardContent>
                </Card>
              ))}</div>}
        </div>
      )}

      {subTab === 'personal' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Important Dates</CardTitle>
              {isAdmin && (
                <Button
                  size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                  onClick={() => {
                    setIdateForm({ date_type_id: '', event_date: '', year_known: true, notes: '' })
                    setIdateEditRow(null)
                    setIdateDlgOpen(true)
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />Add Date
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {importantDatesLoading ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
              </div>
            ) : importantDates.length === 0 ? (
              <EmptySection
                icon={CalendarClock}
                title="No important dates recorded"
                subtitle={isAdmin ? "Add birthday, anniversary, or custom dates to enable event-triggered leave." : "No dates on record."}
              />
            ) : (
              <div className="divide-y divide-border">
                {importantDates.map((row: ImportantDateRow) => {
                  const d        = new Date(`${row.event_date}T00:00:00`)
                  const _M2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                  const display  = isNaN(d.getTime()) ? '—' : row.year_known
                    ? `${String(d.getDate()).padStart(2,'0')}-${_M2[d.getMonth()]}-${d.getFullYear()}`
                    : `${String(d.getDate()).padStart(2,'0')}-${_M2[d.getMonth()]}`
                  return (
                    <div key={row.id} className="flex items-center gap-3 py-2.5">
                      <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{row.important_date_types?.name ?? '—'}</p>
                        <p className="text-xs text-muted-foreground">{display}{!row.year_known && ' (year unknown)'}</p>
                        {row.notes && !row.notes.startsWith('Auto-seeded') && <p className="text-xs text-muted-foreground mt-0.5 italic">{row.notes}</p>}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                            setIdateForm({
                              date_type_id: row.date_type_id,
                              event_date:   row.event_date.slice(0, 10),
                              year_known:   row.year_known,
                              notes:        (row.notes?.startsWith('Auto-seeded') ? '' : row.notes) ?? '',
                            })
                            setIdateEditRow(row)
                            setIdateDlgOpen(true)
                          }}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => {
                            if (confirm(`Remove ${row.important_date_types?.name ?? 'this date'}?`)) {
                              deleteImportantDateMut.mutate(row.id)
                            }
                          }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={idateDlgOpen} onOpenChange={setIdateDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{idateEditRow ? 'Edit Important Date' : 'Add Important Date'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs">Date Type</Label>
              <Select
                value={idateForm.date_type_id}
                onValueChange={v => setIdateForm(p => ({ ...p, date_type_id: v }))}
                disabled={!!idateEditRow}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {availDateTypes.map((dt: ImportantDateType) => (
                    <SelectItem key={dt.id} value={dt.id} className="text-xs">{dt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date</Label>
              <DateInput
                className="h-8 text-xs"
                value={idateForm.event_date}
                onChange={v => setIdateForm(p => ({ ...p, event_date: v }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="year-known"
                checked={idateForm.year_known}
                onCheckedChange={v => setIdateForm(p => ({ ...p, year_known: v }))}
              />
              <Label htmlFor="year-known" className="text-xs cursor-pointer">Year is known</Label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. As per government ID"
                value={idateForm.notes}
                onChange={e => setIdateForm(p => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIdateDlgOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!idateForm.date_type_id || !idateForm.event_date || upsertImportantDateMut.isPending}
              onClick={() => upsertImportantDateMut.mutate(idateForm)}
            >
              {upsertImportantDateMut.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addrOpen} onOpenChange={setAddrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{addrForm.id ? 'Edit Address' : 'Add Address'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Type</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={addrForm.address_type ?? 'current'} onChange={e=>setAddrForm((p)=>({...p,address_type:e.target.value}))}>
                {[['current','Current'],['permanent','Permanent'],['correspondence','Correspondence']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div><Label className="text-xs">Pincode</Label><Input className="mt-1 h-8 text-xs" value={addrForm.pincode??''} onChange={e=>setAddrForm((p)=>({...p,pincode:e.target.value}))}/></div>
            <div className="col-span-2"><Label className="text-xs">Address Line 1</Label><Input className="mt-1 h-8 text-xs" value={addrForm.line1??''} onChange={e=>setAddrForm((p)=>({...p,line1:e.target.value}))}/></div>
            <div className="col-span-2"><Label className="text-xs">Address Line 2</Label><Input className="mt-1 h-8 text-xs" value={addrForm.line2??''} onChange={e=>setAddrForm((p)=>({...p,line2:e.target.value}))}/></div>
            <div><Label className="text-xs">City</Label><Input className="mt-1 h-8 text-xs" value={addrForm.city??''} onChange={e=>setAddrForm((p)=>({...p,city:e.target.value}))}/></div>
            <div><Label className="text-xs">State</Label><Input className="mt-1 h-8 text-xs" value={addrForm.state??''} onChange={e=>setAddrForm((p)=>({...p,state:e.target.value}))}/></div>
            <div><Label className="text-xs">Country</Label><Input className="mt-1 h-8 text-xs" value={addrForm.country??'India'} onChange={e=>setAddrForm((p)=>({...p,country:e.target.value}))}/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddrOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={addrMutation.isPending || !addrForm.line1 || !addrForm.city || !addrForm.state} onClick={()=>addrMutation.mutate(addrForm)}>
              {addrMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Emergency Contact */}
      <Dialog open={emOpen} onOpenChange={setEmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Emergency Contact</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input className="mt-1 h-8 text-xs" value={emForm.name??''} onChange={e=>setEmForm((p)=>({...p,name:e.target.value}))}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Relationship</Label><Input className="mt-1 h-8 text-xs" value={emForm.relationship??''} onChange={e=>setEmForm((p)=>({...p,relationship:e.target.value}))}/></div>
              <div><Label className="text-xs">Phone</Label><Input className="mt-1 h-8 text-xs" value={emForm.phone??''} onChange={e=>setEmForm((p)=>({...p,phone:e.target.value}))}/></div>
              <div><Label className="text-xs">Alternate Phone</Label><Input className="mt-1 h-8 text-xs" value={emForm.alternate_phone??''} onChange={e=>setEmForm((p)=>({...p,alternate_phone:e.target.value}))}/></div>
              <div><Label className="text-xs">Email</Label><Input className="mt-1 h-8 text-xs" value={emForm.email??''} onChange={e=>setEmForm((p)=>({...p,email:e.target.value}))}/></div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="em_primary" checked={!!emForm.is_primary} onChange={e=>setEmForm((p)=>({...p,is_primary:e.target.checked}))} className="rounded" />
              <Label htmlFor="em_primary" className="text-xs">Primary contact</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setEmOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={emMutation.isPending || !emForm.name || !emForm.phone} onClick={()=>emMutation.mutate(emForm)}>
              {emMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
