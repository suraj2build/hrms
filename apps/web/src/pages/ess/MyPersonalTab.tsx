/**
 * MyPersonalTab — the "Personal" tab inside EssMyProfile (Program 4 · P4.1).
 *
 * Employee Data Ownership. The employee can VIEW their bank & statutory details
 * (read-only, masked) and fully MANAGE their emergency contacts, addresses,
 * family members, and statutory nominees. Every call is self-scoped on the
 * server (/ess/me/*) — the employee only ever touches their own records.
 *
 * Reuses existing tables/APIs only. No new module, no new workflow engine.
 */

import { useState }                    from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast }                       from 'sonner'
import {
  Landmark, ShieldCheck, Users, MapPin, HeartHandshake,
  Plus, Trash2, Loader2, Star, Info,
} from 'lucide-react'
import { SectionCard } from '@/components/layout/SectionCard'
import { Card, CardContent } from '@/components/ui/card'
import { Button }      from '@/components/ui/button'
import { Input }       from '@/components/ui/input'
import { Badge }       from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { api }         from '@/lib/api/client'
import { cn }          from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface BankStatutory {
  bank_name:      string | null
  account_number: string | null
  ifsc_code:      string | null
  branch_name:    string | null
  account_type:   string | null
  pan_number:     string | null
  aadhaar_number: string | null
  uan_number:     string | null
  pf_number:      string | null
  esi_number:     string | null
  pt_applicable:  boolean | null
  lwf_applicable: boolean | null
  tax_regime:     string | null
}

interface EmergencyContact {
  id: string; name: string; relationship: string | null
  phone: string; alternate_phone: string | null; email: string | null
  address: string | null; is_primary: boolean
}

interface Address {
  id: string; address_type: 'current' | 'permanent' | 'correspondence'
  line1: string; line2: string | null; city: string; state: string
  country: string | null; pincode: string | null
}

interface RelationshipType { id: string; name: string; code?: string }

interface FamilyMember {
  id: string; name: string; relationship_type_id: string
  relationship_types?: { id: string; name: string } | null
  dob: string | null; gender: string | null
  is_dependent: boolean; is_nominee: boolean; occupation: string | null
}

interface Nomination {
  id: string; scheme: 'pf' | 'gratuity' | 'esi' | 'superannuation'
  nominee_name: string; relationship_type_id: string | null
  relationship_types?: { id: string; name: string } | null
  dob: string | null; share_percentage: number
  address: string | null; is_minor: boolean; guardian_name: string | null
}

// ── Shared field components ─────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground tabular-nums">{value ?? '—'}</p>
    </div>
  )
}

const inputCls = 'h-9 text-sm'
const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

// ── Bank & Statutory (read-only) ────────────────────────────────────────────────

function BankStatutorySection({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery<{ data: BankStatutory | null }>({
    queryKey: ['ess-me-bank', employeeId],
    queryFn:  () => api.get('/ess/me/bank-statutory'),
  })
  const b = data?.data

  return (
    <SectionCard
      title="Bank & Statutory"
      description="Your salary-credit and statutory identifiers. View only — contact HR to change."
      icon={<Landmark className="h-4 w-4 text-muted-foreground" />}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !b ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Info className="h-4 w-4" /> No bank or statutory details on file yet. Contact HR.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Bank" value={b.bank_name} />
          <Field label="Account No." value={b.account_number} />
          <Field label="IFSC" value={b.ifsc_code} />
          <Field label="Branch" value={b.branch_name} />
          <Field label="Account Type" value={b.account_type ? b.account_type[0].toUpperCase() + b.account_type.slice(1) : '—'} />
          <Field label="PAN" value={b.pan_number} />
          <Field label="Aadhaar" value={b.aadhaar_number} />
          <Field label="UAN" value={b.uan_number} />
          <Field label="PF No." value={b.pf_number} />
          <Field label="ESI No." value={b.esi_number} />
          <Field label="Tax Regime" value={b.tax_regime ? (b.tax_regime === 'old' ? 'Old' : 'New') : '—'} />
          <Field label="PT / LWF" value={`${b.pt_applicable ? 'PT' : ''}${b.pt_applicable && b.lwf_applicable ? ' · ' : ''}${b.lwf_applicable ? 'LWF' : ''}` || '—'} />
        </div>
      )}
    </SectionCard>
  )
}

// ── Emergency Contacts ──────────────────────────────────────────────────────────

function EmergencyContactsSection() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ data: EmergencyContact[] }>({
    queryKey: ['ess-me-emergency'],
    queryFn:  () => api.get('/ess/me/emergency-contacts'),
  })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', alternate_phone: '', email: '', is_primary: false })
  const [deleteTarget, setDeleteTarget] = useState<EmergencyContact | null>(null)

  const reset = () => { setForm({ name: '', relationship: '', phone: '', alternate_phone: '', email: '', is_primary: false }); setAdding(false) }
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ess-me-emergency'] })

  const addMut = useMutation({
    mutationFn: () => api.post('/ess/me/emergency-contacts', form),
    onSuccess: () => { toast.success('Emergency contact added'); reset(); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/ess/me/emergency-contacts/${id}`),
    onSuccess: () => { toast.success('Contact removed'); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const contacts = data?.data ?? []

  return (
    <SectionCard
      title="Emergency Contacts"
      description="Who we reach in an emergency."
      icon={<Users className="h-4 w-4 text-muted-foreground" />}
      action={!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>}
    >
      {adding && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input className={inputCls} placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Input className={inputCls} placeholder="Relationship" value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} />
            <Input className={inputCls} placeholder="Phone *" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            <Input className={inputCls} placeholder="Alternate phone" value={form.alternate_phone} onChange={e => setForm(f => ({ ...f, alternate_phone: e.target.value }))} />
            <Input className={inputCls} placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <input type="checkbox" checked={form.is_primary} onChange={e => setForm(f => ({ ...f, is_primary: e.target.checked }))} />
              Primary contact
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
            <Button size="sm" onClick={() => addMut.mutate()} disabled={!form.name || !form.phone || addMut.isPending}>
              {addMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">No emergency contacts yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {contacts.map(c => (
            <Card key={c.id} className="relative">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      {c.is_primary && <Badge variant="success" className="rounded-full text-[10px]"><Star className="h-2.5 w-2.5 mr-0.5" />Primary</Badge>}
                    </div>
                    {c.relationship && <p className="text-xs text-muted-foreground">{c.relationship}</p>}
                    <p className="text-xs text-foreground mt-1 tabular-nums">{c.phone}{c.alternate_phone ? ` · ${c.alternate_phone}` : ''}</p>
                    {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                  </div>
                  <button onClick={() => setDeleteTarget(c)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove emergency contact?"
        message={`${deleteTarget?.name ?? 'This contact'} will be removed from your emergency contacts.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (deleteTarget) delMut.mutate(deleteTarget.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </SectionCard>
  )
}

// ── Addresses ───────────────────────────────────────────────────────────────────

const ADDRESS_TYPES: Address['address_type'][] = ['current', 'permanent', 'correspondence']

function AddressesSection() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ data: Address[] }>({
    queryKey: ['ess-me-addresses'],
    queryFn:  () => api.get('/ess/me/addresses'),
  })
  const [editType, setEditType] = useState<Address['address_type'] | null>(null)
  const [form, setForm] = useState({ line1: '', line2: '', city: '', state: '', country: 'India', pincode: '' })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ess-me-addresses'] })

  const byType = (t: Address['address_type']) => (data?.data ?? []).find(a => a.address_type === t)

  function startEdit(t: Address['address_type']) {
    const a = byType(t)
    setForm({ line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', state: a?.state ?? '', country: a?.country ?? 'India', pincode: a?.pincode ?? '' })
    setEditType(t)
  }

  const saveMut = useMutation({
    mutationFn: () => api.post('/ess/me/addresses', { address_type: editType, ...form }),
    onSuccess: () => { toast.success('Address saved'); setEditType(null); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  return (
    <SectionCard
      title="Addresses"
      description="Current, permanent and correspondence addresses."
      icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-3">
          {ADDRESS_TYPES.map(t => {
            const a = byType(t)
            const isEditing = editType === t
            return (
              <div key={t} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground capitalize">{t}</p>
                  {!isEditing && <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>{a ? 'Edit' : 'Add'}</Button>}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input className={inputCls} placeholder="Address line 1 *" value={form.line1} onChange={e => setForm(f => ({ ...f, line1: e.target.value }))} />
                      <Input className={inputCls} placeholder="Address line 2" value={form.line2} onChange={e => setForm(f => ({ ...f, line2: e.target.value }))} />
                      <Input className={inputCls} placeholder="City *" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                      <Input className={inputCls} placeholder="State *" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
                      <Input className={inputCls} placeholder="Country" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
                      <Input className={inputCls} placeholder="Pincode" value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value }))} />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditType(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => saveMut.mutate()} disabled={!form.line1 || !form.city || !form.state || saveMut.isPending}>
                        {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
                      </Button>
                    </div>
                  </div>
                ) : a ? (
                  <p className="text-sm text-foreground">
                    {[a.line1, a.line2, a.city, a.state, a.country, a.pincode].filter(Boolean).join(', ')}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not provided.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// ── Family ──────────────────────────────────────────────────────────────────────

function FamilySection({ relTypes }: { relTypes: RelationshipType[] }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ data: FamilyMember[] }>({
    queryKey: ['ess-me-family'],
    queryFn:  () => api.get('/ess/me/family'),
  })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', relationship_type_id: '', dob: '', gender: '', is_dependent: false, occupation: '' })
  const [deleteTarget, setDeleteTarget] = useState<FamilyMember | null>(null)
  const reset = () => { setForm({ name: '', relationship_type_id: '', dob: '', gender: '', is_dependent: false, occupation: '' }); setAdding(false) }
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ess-me-family'] })

  const addMut = useMutation({
    mutationFn: () => api.post('/ess/me/family', form),
    onSuccess: () => { toast.success('Family member added'); reset(); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/ess/me/family/${id}`),
    onSuccess: () => { toast.success('Removed'); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const members = data?.data ?? []

  return (
    <SectionCard
      title="Family"
      description="Dependents and family members."
      icon={<Users className="h-4 w-4 text-muted-foreground" />}
      action={!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>}
    >
      {adding && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input className={inputCls} placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <select className={selectCls} value={form.relationship_type_id} onChange={e => setForm(f => ({ ...f, relationship_type_id: e.target.value }))}>
              <option value="">Relationship *</option>
              {relTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
            </select>
            <Input className={inputCls} type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} />
            <select className={selectCls} value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
              <option value="">Gender</option>
              <option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
            </select>
            <Input className={inputCls} placeholder="Occupation" value={form.occupation} onChange={e => setForm(f => ({ ...f, occupation: e.target.value }))} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <input type="checkbox" checked={form.is_dependent} onChange={e => setForm(f => ({ ...f, is_dependent: e.target.checked }))} />
              Dependent
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
            <Button size="sm" onClick={() => addMut.mutate()} disabled={!form.name || !form.relationship_type_id || addMut.isPending}>
              {addMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">No family members added.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {members.map(m => (
            <Card key={m.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{m.name}</p>
                      {m.is_dependent && <Badge variant="secondary" className="rounded-full text-[10px]">Dependent</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{m.relationship_types?.name ?? '—'}{m.occupation ? ` · ${m.occupation}` : ''}</p>
                  </div>
                  <button onClick={() => setDeleteTarget(m)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove family member?"
        message={`${deleteTarget?.name ?? 'This family member'} will be removed from your family records.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (deleteTarget) delMut.mutate(deleteTarget.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </SectionCard>
  )
}

// ── Nominees ────────────────────────────────────────────────────────────────────

const SCHEMES: Nomination['scheme'][] = ['pf', 'gratuity', 'esi', 'superannuation']
const SCHEME_LABEL: Record<Nomination['scheme'], string> = { pf: 'Provident Fund', gratuity: 'Gratuity', esi: 'ESI', superannuation: 'Superannuation' }

function NomineesSection({ relTypes }: { relTypes: RelationshipType[] }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{ data: Nomination[] }>({
    queryKey: ['ess-me-nominations'],
    queryFn:  () => api.get('/ess/me/nominations'),
  })
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ scheme: 'pf', nominee_name: '', relationship_type_id: '', share_percentage: '', is_minor: false, guardian_name: '' })
  const [deleteTarget, setDeleteTarget] = useState<Nomination | null>(null)
  const reset = () => { setForm({ scheme: 'pf', nominee_name: '', relationship_type_id: '', share_percentage: '', is_minor: false, guardian_name: '' }); setAdding(false) }
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ess-me-nominations'] })

  const addMut = useMutation({
    mutationFn: () => api.post('/ess/me/nominations', {
      scheme: form.scheme,
      nominee_name: form.nominee_name,
      relationship_type_id: form.relationship_type_id || undefined,
      share_percentage: Number(form.share_percentage),
      is_minor: form.is_minor,
      guardian_name: form.guardian_name || undefined,
    }),
    onSuccess: () => { toast.success('Nominee added'); reset(); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/ess/me/nominations/${id}`),
    onSuccess: () => { toast.success('Removed'); invalidate() },
    onError: (e: Error) => toast.error('Failed', { description: e.message }),
  })

  const noms = data?.data ?? []

  return (
    <SectionCard
      title="Nominees"
      description="Statutory beneficiaries for PF, gratuity, ESI and superannuation. Shares must total ≤ 100% per scheme."
      icon={<HeartHandshake className="h-4 w-4 text-muted-foreground" />}
      action={!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button>}
    >
      {adding && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select className={selectCls} value={form.scheme} onChange={e => setForm(f => ({ ...f, scheme: e.target.value }))}>
              {SCHEMES.map(s => <option key={s} value={s}>{SCHEME_LABEL[s]}</option>)}
            </select>
            <Input className={inputCls} placeholder="Nominee name *" value={form.nominee_name} onChange={e => setForm(f => ({ ...f, nominee_name: e.target.value }))} />
            <select className={selectCls} value={form.relationship_type_id} onChange={e => setForm(f => ({ ...f, relationship_type_id: e.target.value }))}>
              <option value="">Relationship</option>
              {relTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
            </select>
            <Input className={inputCls} type="number" min="1" max="100" placeholder="Share % *" value={form.share_percentage} onChange={e => setForm(f => ({ ...f, share_percentage: e.target.value }))} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <input type="checkbox" checked={form.is_minor} onChange={e => setForm(f => ({ ...f, is_minor: e.target.checked }))} />
              Minor
            </label>
            {form.is_minor && <Input className={inputCls} placeholder="Guardian name *" value={form.guardian_name} onChange={e => setForm(f => ({ ...f, guardian_name: e.target.value }))} />}
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
            <Button size="sm" onClick={() => addMut.mutate()} disabled={!form.nominee_name || !form.share_percentage || (form.is_minor && !form.guardian_name) || addMut.isPending}>
              {addMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save
            </Button>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : noms.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">No nominees declared.</p>
      ) : (
        <div className="space-y-2">
          {noms.map(n => (
            <div key={n.id} className={cn('flex items-center justify-between gap-2 rounded-lg border border-border p-3')}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{n.nominee_name}</p>
                  <Badge variant="secondary" className="rounded-full text-[10px]">{SCHEME_LABEL[n.scheme]}</Badge>
                  <Badge variant="outline" className="rounded-full text-[10px] tabular-nums">{n.share_percentage}%</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{n.relationship_types?.name ?? '—'}{n.is_minor ? ` · Minor (guardian: ${n.guardian_name ?? '—'})` : ''}</p>
              </div>
              <button onClick={() => setDeleteTarget(n)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove nominee?"
        message={`${deleteTarget?.nominee_name ?? 'This nominee'} will be removed from your ${deleteTarget ? SCHEME_LABEL[deleteTarget.scheme] : ''} nomination.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => { if (deleteTarget) delMut.mutate(deleteTarget.id); setDeleteTarget(null) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </SectionCard>
  )
}

// ── Tab shell ───────────────────────────────────────────────────────────────────

export function MyPersonalTab({ employeeId }: { employeeId: string }) {
  const { data: relData } = useQuery<{ data: RelationshipType[] }>({
    queryKey: ['masters-relationship-types'],
    queryFn:  () => api.get('/masters/relationship-types'),
  })
  const relTypes = relData?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-info shrink-0" />
        You can keep your contacts, addresses, family and nominees up to date here. Bank &amp; statutory details are view-only — contact HR to change them.
      </div>
      <BankStatutorySection employeeId={employeeId} />
      <EmergencyContactsSection />
      <AddressesSection />
      <FamilySection relTypes={relTypes} />
      <NomineesSection relTypes={relTypes} />
    </div>
  )
}
