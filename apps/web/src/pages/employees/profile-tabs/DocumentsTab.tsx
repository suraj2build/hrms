/**
 * EmployeeProfile › Documents tab (Files, Identity, Contracts, Passport & Visa).
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useRef, useState } from 'react'
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
import { Plus, Trash2, Edit2, Files, FileText, Fingerprint, Globe, AlertTriangle, Loader2 } from 'lucide-react'
import { uploadEmployeeFile } from '@/lib/supabase-storage'
import {
  EmptySection, fmtDate,
  type DocumentRow, type IdentityRow, type ContractRow, type PassportVisaRow, type MasterOption,
  type FormBag, type Section,
} from './shared'

// Mandatory document types — used to show missing-doc warnings
const MANDATORY_DOC_TYPES = [
  'Offer Letter', 'ID Proof', 'Address Proof', 'PAN Card',
  'Educational Certificate', 'Experience Letter',
]

// documents.doc_type CHECK constraint (migration 005) — the ground truth for
// valid document types. Matches the list in pages/documents/Documents.tsx.
const DOC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'aadhaar',           label: 'Aadhaar Card' },
  { value: 'pan',                label: 'PAN Card' },
  { value: 'offer_letter',       label: 'Offer Letter' },
  { value: 'contract',           label: 'Employment Contract' },
  { value: 'certificate',        label: 'Certificate / Degree' },
  { value: 'relieving_letter',   label: 'Relieving Letter' },
  { value: 'experience_letter',  label: 'Experience Letter' },
  { value: 'other',              label: 'Other' },
]

interface DocumentsTabProps {
  id: string | undefined
  isAdmin: boolean
  tenantId: string
  subTab: string
  visited: Set<Section>
  openSignedUrl: (path: string | null | undefined) => void
}

export function DocumentsTab({ id, isAdmin, tenantId, subTab, visited, openSignedUrl }: DocumentsTabProps) {
  const qc = useQueryClient()

  const { data: contractsData } = useQuery<{ data: ContractRow[] }>({
    queryKey: ['contracts', id], queryFn: () => api.get(`/employees/${id}/contracts`),
    enabled: !!id && visited.has('documents'), staleTime: 30_000,
  })
  const { data: docsData } = useQuery<{ data: DocumentRow[] }>({
    queryKey: ['emp-docs', id], queryFn: () => api.get(`/employees/${id}/documents`),
    enabled: !!id && visited.has('documents'), staleTime: 30_000,
  })
  const { data: pvData } = useQuery<{ data: PassportVisaRow[] }>({
    queryKey: ['passport-visa', id], queryFn: () => api.get(`/employees/${id}/passport-visa`),
    enabled: !!id && visited.has('documents'), staleTime: 30_000,
  })
  const { data: identityData } = useQuery<{ data: IdentityRow[] }>({
    queryKey: ['identity', id], queryFn: () => api.get(`/employees/${id}/identity`),
    enabled: !!id && visited.has('documents'), staleTime: 30_000,
  })
  const { data: identityTypesData } = useQuery<{ data: MasterOption[] }>({
    queryKey: ['identity-types'], queryFn: () => api.get('/masters/identity-types'),
    enabled: !!id && visited.has('documents'), staleTime: 5 * 60_000,
  })

  const [addPvOpen, setAddPvOpen] = useState(false)
  const [pvForm, setPvForm]       = useState<FormBag>({})
  const addPvMutation = useMutation({
    mutationFn: (d: FormBag) => api.post(`/employees/${id}/passport-visa`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['passport-visa', id] }); setAddPvOpen(false); toast.success('Added') },
    onError:   () => toast.error('Failed'),
  })
  const delPvMutation = useMutation({
    mutationFn: (pvId: string) => api.delete(`/employees/${id}/passport-visa/${pvId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['passport-visa', id] }); toast.success('Record deleted') },
    onError:   (e: Error) => toast.error('Failed to delete record', { description: e.message }),
  })

  const [idOpen, setIdOpen] = useState(false)
  const [idForm, setIdForm] = useState<FormBag>({})
  const idMutation = useMutation({
    mutationFn: (d: FormBag) => api.post(`/employees/${id}/identity`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['identity', id] }); setIdOpen(false); toast.success('Identity record saved') },
    onError:   (e: Error) => toast.error('Failed to save identity', { description: e.message }),
  })
  const delIdMutation = useMutation({
    mutationFn: (iid: string) => api.delete(`/employees/${id}/identity/${iid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['identity', id] }); toast.success('Identity record removed') },
    onError:   (e: Error) => toast.error('Failed to remove identity', { description: e.message }),
  })

  const docInputRef  = useRef<HTMLInputElement>(null)
  const [docMeta, setDocMeta]   = useState<{ name: string; doc_type: string } | null>(null)
  const [docFile, setDocFile]   = useState<File | null>(null)
  const [docMetaOpen, setDocMetaOpen] = useState(false)
  const uploadDocMutation = useMutation({
    mutationFn: async ({ file, name, doc_type }: { file: File; name: string; doc_type: string }) => {
      const path = await uploadEmployeeFile(tenantId, id!, 'documents', file)
      await api.post(`/employees/${id}/documents`, { name, doc_type, storage_path: path, file_size: file.size, mime_type: file.type })
    },
    // Same backend documents table also backs the HR vault (['documents']) and
    // ESS (['ess-documents', employeeId]) — invalidate by prefix so uploading
    // from this profile tab doesn't leave those other two views stale.
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emp-docs', id] }); qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['ess-documents'] }); setDocMetaOpen(false); setDocMeta(null); setDocFile(null); toast.success('Document uploaded') },
    onError:   () => toast.error('Upload failed'),
  })
  const delDocMutation = useMutation({
    mutationFn: (docId: string) => api.delete(`/employees/${id}/documents/${docId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emp-docs', id] }); qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['ess-documents'] }); toast.success('Document deleted') },
    onError:   (e: Error) => toast.error('Failed to delete document', { description: e.message }),
  })

  const [addContractOpen,  setAddContractOpen]  = useState(false)
  const [editContractId,   setEditContractId]   = useState<string | null>(null)
  const [contractForm, setContractForm] = useState({
    contract_type: 'appointment', start_date: '', end_date: '',
    status: 'active', notes: '',
  })
  function openContractDialog(c?: ContractRow) {
    if (c) {
      setEditContractId(c.id)
      setContractForm({
        contract_type: c.contract_type ?? 'appointment',
        start_date:    c.start_date?.slice(0, 10) ?? '',
        end_date:      c.end_date?.slice(0, 10)   ?? '',
        status:        c.status        ?? 'active',
        notes:         c.notes         ?? '',
      })
    } else {
      setEditContractId(null)
      setContractForm({ contract_type: 'appointment', start_date: new Date().toISOString().slice(0, 10), end_date: '', status: 'active', notes: '' })
    }
    setAddContractOpen(true)
  }
  const addContractMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/contracts`, {
      ...contractForm,
      end_date: contractForm.end_date || undefined,
      notes:    contractForm.notes    || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts', id] }); setAddContractOpen(false); toast.success('Contract added') },
    onError:   (e: Error) => toast.error('Failed to add contract', { description: e.message }),
  })
  const editContractMutation = useMutation({
    mutationFn: (contractId: string) => api.put(`/employees/${id}/contracts/${contractId}`, {
      ...contractForm,
      end_date: contractForm.end_date || undefined,
      notes:    contractForm.notes    || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts', id] }); setAddContractOpen(false); setEditContractId(null); toast.success('Contract updated') },
    onError:   (e: Error) => toast.error('Failed to update contract', { description: e.message }),
  })
  const delContractMutation = useMutation({
    mutationFn: (contractId: string) => api.delete(`/employees/${id}/contracts/${contractId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contracts', id] }); toast.success('Contract deleted') },
    onError:   (e: Error) => toast.error('Failed to delete contract', { description: e.message }),
  })

  return (
    <>
      {subTab === 'documents' && (
        <div className="space-y-4">
          {/* Missing mandatory docs warning */}
          {(() => {
            const uploadedTypes = (docsData?.data ?? []).map((d) => (d.doc_type ?? '').trim())
            const missing = MANDATORY_DOC_TYPES.filter(
              t => !uploadedTypes.some((u: string) => u.toLowerCase().includes(t.toLowerCase()))
            )
            if (!missing.length) return null
            return (
              <div className="flex items-start gap-2 p-3 rounded-md border border-warning/40 bg-warning/5">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-warning">Missing mandatory documents</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{missing.join(', ')}</p>
                </div>
              </div>
            )
          })()}

          <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Documents</CardTitle>
              {isAdmin && (
                <>
                  <input ref={docInputRef} type="file" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (!f) return; setDocFile(f); setDocMeta({ name: f.name.replace(/\.[^.]+$/, ''), doc_type: '' }); setDocMetaOpen(true); e.target.value = '' }} />
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => docInputRef.current?.click()}>
                    <Plus className="h-3.5 w-3.5" />Upload
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!(docsData?.data?.length)
              ? <div className="px-6 pb-6"><EmptySection icon={Files} title="No documents" subtitle="Upload documents using the button above." /></div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border">{['Name','Type','Mandatory','Uploaded',''].map(h=><th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2">{h}</th>)}</tr></thead>
                    <tbody>
                      {docsData!.data.map((d) => {
                        const isMandatory = MANDATORY_DOC_TYPES.some(
                          t => (d.doc_type ?? '').toLowerCase().includes(t.toLowerCase())
                        )
                        return (
                        <tr key={d.id} className="border-b border-border/50">
                          <td className="px-4 py-2 font-medium">{d.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{d.doc_type}</td>
                          <td className="px-4 py-2">
                            {isMandatory
                              ? <Badge variant="outline" className="rounded-full text-[9px] border-success text-success">Required</Badge>
                              : <span className="text-muted-foreground text-[10px]">—</span>}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{fmtDate(d.created_at)}</td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              {d.storage_path && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openSignedUrl(d.storage_path)}><Files className="h-3 w-3" /></Button>}
                              {isAdmin && <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => delDocMutation.mutate(d.id)}><Trash2 className="h-3 w-3" /></Button>}
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>}
          </CardContent>
        </Card>
        </div>
      )}

      {/* DOCUMENTS › Identity — merged into the Documents tab */}
      {subTab === 'documents' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Fingerprint className="h-4 w-4 text-muted-foreground" />Identity Documents</h3>
            {isAdmin && (
              <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setIdForm({}); setIdOpen(true) }}>
                <Plus className="h-3.5 w-3.5" />Add Identity Document
              </Button>
            )}
          </div>
          {!(identityData?.data?.length)
            ? <Card><CardContent className="pt-6"><EmptySection icon={Fingerprint} title="No identity documents" subtitle={isAdmin ? 'Click Add Identity Document to record one.' : undefined} /></CardContent></Card>
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{identityData!.data.map((it) => (
                <Card key={it.id}>
                  <CardContent className="pt-4 pb-4 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold">{it.identity_types?.name ?? 'Identity'}</p>
                      <p className="text-xs font-mono text-muted-foreground">{it.identity_number}</p>
                      {(it.issued_by || it.expiry_date) && <p className="text-xs text-muted-foreground">{[it.issued_by, it.expiry_date ? `exp ${fmtDate(it.expiry_date)}` : null].filter(Boolean).join(' · ')}</p>}
                    </div>
                    {isAdmin && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delIdMutation.mutate(it.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </CardContent>
                </Card>
              ))}</div>}
        </div>
      )}

      {subTab === 'documents' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Contracts</CardTitle>
              {isAdmin && (
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => openContractDialog()}>
                  <Plus className="h-3.5 w-3.5" />Add Contract
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!(contractsData?.data?.length)
              ? <div className="px-6 pb-6"><EmptySection icon={FileText} title="No contracts" subtitle={isAdmin ? 'Click Add Contract to create one.' : undefined} /></div>
              : <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-border">{['Type','Start','End','Status','File', ...(isAdmin ? ['Actions'] : [])].map(h=><th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2">{h}</th>)}</tr></thead>
                    <tbody>
                      {contractsData!.data.map((c) => (
                        <tr key={c.id} className="border-b border-border/50">
                          <td className="px-4 py-2 capitalize">{c.contract_type?.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-2">{fmtDate(c.start_date)}</td>
                          <td className="px-4 py-2">{c.end_date ? fmtDate(c.end_date) : '—'}</td>
                          <td className="px-4 py-2"><Badge variant={c.status === 'active' ? 'success' : 'secondary'} className="rounded-full text-[9px] capitalize">{c.status ?? '—'}</Badge></td>
                          <td className="px-4 py-2">
                            {c.storage_path
                              ? <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => openSignedUrl(c.storage_path)}>View</Button>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-2">
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openContractDialog(c)}>
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                  onClick={() => { if (confirm('Delete this contract?')) delContractMutation.mutate(c.id) }}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
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

      {subTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Globe className="h-4 w-4 text-muted-foreground" />Passport &amp; Visa</h3>
            {isAdmin && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setPvForm({ record_type: 'passport' }); setAddPvOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Passport</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setPvForm({ record_type: 'visa' }); setAddPvOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Visa</Button>
              </div>
            )}
          </div>
          {(['passport', 'visa'] as const).map(rt => {
            const items = (pvData?.data ?? []).filter((p) => p.record_type === rt)
            return (
              <Card key={rt}>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold capitalize">{rt}s</CardTitle></CardHeader>
                <CardContent>
                  {!items.length
                    ? <p className="text-xs text-muted-foreground">No {rt} records.</p>
                    : <div className="space-y-3">{items.map((pv) => {
                        const soon = pv.expiry_date && new Date(pv.expiry_date) < new Date(Date.now() + 90*24*60*60*1000)
                        return (
                          <div key={pv.id} className="flex items-start justify-between p-3 rounded-md border border-border bg-muted/20">
                            <div>
                              <p className="text-sm font-semibold">{pv.doc_number}</p>
                              <p className="text-xs text-muted-foreground">{pv.country}{pv.visa_type ? ` · ${pv.visa_type}` : ''}</p>
                              <p className="text-xs text-muted-foreground">Expires: {fmtDate(pv.expiry_date)}</p>
                              {soon && <Badge variant="warning" className="rounded-full text-[9px] mt-1">Expiring soon</Badge>}
                            </div>
                            {isAdmin && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delPvMutation.mutate(pv.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                          </div>
                        )
                      })}</div>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={idOpen} onOpenChange={setIdOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Identity Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Identity Type</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={idForm.identity_type_id??''} onChange={e=>setIdForm((p)=>({...p,identity_type_id:e.target.value}))}>
                <option value="">Select type…</option>
                {(identityTypesData?.data ?? []).map((t)=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {!(identityTypesData?.data?.length) && <p className="text-[10px] text-warning mt-1">No identity types configured. Add them under Masters first.</p>}
            </div>
            <div><Label className="text-xs">Identity Number</Label><Input className="mt-1 h-8 text-xs font-mono" value={idForm.identity_number??''} onChange={e=>setIdForm((p)=>({...p,identity_number:e.target.value}))}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Issued By</Label><Input className="mt-1 h-8 text-xs" value={idForm.issued_by??''} onChange={e=>setIdForm((p)=>({...p,issued_by:e.target.value}))}/></div>
              <div><Label className="text-xs">Expiry Date</Label><DateInput className="mt-1 h-8 text-xs" value={idForm.expiry_date??''} onChange={v=>setIdForm((p)=>({...p,expiry_date:v}))}/></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setIdOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={idMutation.isPending || !idForm.identity_type_id || !idForm.identity_number} onClick={()=>idMutation.mutate(idForm)}>
              {idMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addPvOpen} onOpenChange={setAddPvOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add {pvForm.record_type === 'visa' ? 'Visa' : 'Passport'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {([{label:'Document Number',key:'doc_number'},{label:'Country',key:'country'},{label:'Place of Issue',key:'place_of_issue'},...(pvForm.record_type==='visa'?[{label:'Visa Type',key:'visa_type'}]:[])] as Array<{label:string;key:string}>).map(f=>(
              <div key={f.key}><Label className="text-xs">{f.label}</Label><Input className="mt-1 h-8 text-xs" value={pvForm[f.key]??''} onChange={e=>setPvForm((p)=>({...p,[f.key]:e.target.value}))}/></div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Issue Date</Label><DateInput className="mt-1 h-8 text-xs" value={pvForm.issue_date??''} onChange={v=>setPvForm((p)=>({...p,issue_date:v}))}/></div>
              <div><Label className="text-xs">Expiry Date</Label><DateInput className="mt-1 h-8 text-xs" value={pvForm.expiry_date??''} onChange={v=>setPvForm((p)=>({...p,expiry_date:v}))}/></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddPvOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addPvMutation.mutate(pvForm)} disabled={addPvMutation.isPending}>
              {addPvMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={docMetaOpen} onOpenChange={open => { if (!open) { setDocMetaOpen(false); setDocFile(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Document Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Document Name</Label><Input className="mt-1 h-8 text-xs" value={docMeta?.name??''} onChange={e=>setDocMeta((p)=>({doc_type:p?.doc_type??'',name:e.target.value}))}/></div>
            <div>
              <Label className="text-xs">Document Type</Label>
              <Select value={docMeta?.doc_type||undefined} onValueChange={v=>setDocMeta(p=>({name:p?.name??'',doc_type:v}))}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select a document type" /></SelectTrigger>
                <SelectContent>
                  {DOC_TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>{setDocMetaOpen(false);setDocFile(null)}}>Cancel</Button>
            <Button size="sm"
              disabled={!docMeta?.name || !docMeta?.doc_type || uploadDocMutation.isPending || !docFile}
              onClick={()=>docFile && uploadDocMutation.mutate({ file: docFile, name: docMeta!.name, doc_type: docMeta!.doc_type })}>
              {uploadDocMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addContractOpen} onOpenChange={open=>{ if(!open){ setAddContractOpen(false); setEditContractId(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editContractId ? 'Edit Contract' : 'Add Contract'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Contract Type</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none capitalize" value={contractForm.contract_type} onChange={e=>setContractForm(f=>({...f,contract_type:e.target.value}))}>
                {['appointment','renewal','amendment','nda','other'].map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Start Date</Label><DateInput className="mt-1 h-8 text-xs" value={contractForm.start_date} onChange={v=>setContractForm(f=>({...f,start_date:v}))}/></div>
              <div><Label className="text-xs">End Date</Label><DateInput className="mt-1 h-8 text-xs" value={contractForm.end_date} onChange={v=>setContractForm(f=>({...f,end_date:v}))}/></div>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={contractForm.status} onChange={e=>setContractForm(f=>({...f,status:e.target.value}))}>
                {['draft','active','expired','terminated'].map(s=><option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </div>
            <div><Label className="text-xs">Notes</Label><Input className="mt-1 h-8 text-xs" value={contractForm.notes} onChange={e=>setContractForm(f=>({...f,notes:e.target.value}))}/></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={()=>{ setAddContractOpen(false); setEditContractId(null) }}>Cancel</Button>
            <Button size="sm"
              disabled={!contractForm.start_date || addContractMutation.isPending || editContractMutation.isPending}
              onClick={()=> editContractId ? editContractMutation.mutate(editContractId) : addContractMutation.mutate()}>
              {(addContractMutation.isPending || editContractMutation.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {editContractId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
