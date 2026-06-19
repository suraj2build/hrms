import { useState, useMemo }                      from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Package, Plus, Pencil, Trash2, Loader2, UserPlus, Undo2 } from 'lucide-react'
import { PageContainer }                          from '@/components/layout/PageContainer'
import { PageHeader }                             from '@/components/layout/PageHeader'
import { SectionCard }                            from '@/components/layout/SectionCard'
import { Button }                                 from '@/components/ui/button'
import { Input }                                  from '@/components/ui/input'
import { Badge, type BadgeProps }                 from '@/components/ui/badge'
import { DateInput }                              from '@/components/ui/date-input'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
}                                                 from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
}                                                 from '@/components/ui/select'
import { EmployeeSelector }                       from '@/components/filters/EmployeeSelector'
import { api }                                    from '@/lib/api/client'
import { useAuthStore }                           from '@/stores/authStore'

// ── Types ────────────────────────────────────────────────────────────────────

interface Asset {
  id:               string
  asset_code:       string
  category_id:      string | null
  category_name:    string | null
  name:             string
  serial_number:    string | null
  purchase_date:    string | null
  purchase_cost:    number | null
  status:           'available' | 'assigned' | 'in_repair' | 'damaged' | 'lost' | 'retired'
  assigned_to:      string | null
  assigned_to_name: string | null
  assigned_to_code: string | null
  notes:            string | null
}

interface Category { id: string; name: string; is_active: boolean }

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  available: 'success',
  assigned:  'secondary',
  in_repair: 'outline',
  damaged:   'destructive',
  lost:      'destructive',
  retired:   'secondary',
}

const EMPTY_FORM = {
  asset_code: '', name: '', category_id: '', serial_number: '',
  purchase_date: '', purchase_cost: '', notes: '',
}

export function AssetMaster() {
  const qc            = useQueryClient()
  const { profile }   = useAuthStore()
  const isAdmin       = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch]             = useState('')

  const [dlgOpen, setDlgOpen]   = useState(false)
  const [editItem, setEditItem] = useState<Asset | null>(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [err, setErr]           = useState('')

  const [assignFor, setAssignFor]   = useState<Asset | null>(null)
  const [assignEmp, setAssignEmp]   = useState('')
  const [assignNotes, setAssignNotes] = useState('')

  const [returnFor, setReturnFor]       = useState<Asset | null>(null)
  const [returnCond, setReturnCond]     = useState<'returned' | 'damaged' | 'lost'>('returned')
  const [returnNotes, setReturnNotes]   = useState('')

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: assetsData, isLoading } = useQuery<{ data: Asset[] }>({
    queryKey: ['assets', statusFilter, search],
    queryFn:  () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (search.trim())          params.set('search', search.trim())
      const qs = params.toString()
      return api.get(`/assets${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
  const assets = assetsData?.data ?? []

  const { data: catsData } = useQuery<{ data: Category[] }>({
    queryKey: ['asset-categories'],
    queryFn:  () => api.get('/masters/asset-categories'),
    staleTime: 120_000,
  })
  const cats = (catsData?.data ?? []).filter(c => c.is_active)


  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const all = assetsData?.data ?? []
    return {
      total:     all.length,
      available: all.filter(a => a.status === 'available').length,
      assigned:  all.filter(a => a.status === 'assigned').length,
      issues:    all.filter(a => a.status === 'damaged' || a.status === 'lost').length,
    }
  }, [assetsData])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload: Record<string, unknown> = {
        asset_code:    body.asset_code,
        name:          body.name,
        category_id:   body.category_id || null,
        serial_number: body.serial_number || null,
        purchase_date: body.purchase_date || null,
        purchase_cost: body.purchase_cost ? Number(body.purchase_cost) : null,
        notes:         body.notes || null,
      }
      return editItem
        ? api.put(`/assets/${editItem.id}`, payload)
        : api.post('/assets', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Asset updated' : 'Asset created')
    },
    onError: (e: Error) => { setErr(e.message ?? 'Failed to save'); toast.error('Save failed', { description: e.message }) },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/assets/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assets'] }); toast.success('Asset deleted') },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  const assignMut = useMutation({
    mutationFn: () => api.post(`/assets/${assignFor!.id}/assign`, { employee_id: assignEmp, notes: assignNotes || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setAssignFor(null); setAssignEmp(''); setAssignNotes('')
      toast.success('Asset assigned')
    },
    onError: (e: Error) => toast.error('Assign failed', { description: e.message }),
  })

  const returnMut = useMutation({
    mutationFn: () => api.post(`/assets/${returnFor!.id}/return`, { condition: returnCond, notes: returnNotes || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setReturnFor(null); setReturnCond('returned'); setReturnNotes('')
      toast.success('Asset returned')
    },
    onError: (e: Error) => toast.error('Return failed', { description: e.message }),
  })

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function openCreate() { setEditItem(null); setForm(EMPTY_FORM); setErr(''); setDlgOpen(true) }
  function openEdit(a: Asset) {
    setEditItem(a)
    setForm({
      asset_code:    a.asset_code,
      name:          a.name,
      category_id:   a.category_id ?? '',
      serial_number: a.serial_number ?? '',
      purchase_date: a.purchase_date ?? '',
      purchase_cost: a.purchase_cost != null ? String(a.purchase_cost) : '',
      notes:         a.notes ?? '',
    })
    setErr(''); setDlgOpen(true)
  }

  const STAT_CARDS = [
    { label: 'Total',          value: stats.total,     tone: 'text-foreground'   },
    { label: 'Available',      value: stats.available, tone: 'text-emerald-600'  },
    { label: 'Assigned',       value: stats.assigned,  tone: 'text-blue-600'     },
    { label: 'Damaged / Lost', value: stats.issues,    tone: 'text-destructive'  },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Assets"
        subtitle="Track company assets and their assignment to employees"
        actions={isAdmin && <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Asset</Button>}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STAT_CARDS.map(s => (
          <div key={s.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-semibold tabular-nums ${s.tone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <SectionCard title="All Assets" icon={<Package className="h-4 w-4 text-muted-foreground" />}>
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name or serial…"
            className="h-8 text-sm sm:max-w-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-sm sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['all', 'available', 'assigned', 'in_repair', 'damaged', 'lost', 'retired'].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s === 'all' ? 'All Statuses' : s.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Package className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No assets found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Asset Code', 'Name', 'Category', 'Serial', 'Status', 'Assigned To', ''].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map(a => (
                  <tr key={a.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5"><Badge variant="outline" className="rounded-full text-xs font-mono">{a.asset_code}</Badge></td>
                    <td className="px-3 py-2.5 font-medium">{a.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{a.category_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground">{a.serial_number ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'} className="rounded-full text-xs capitalize">
                        {a.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {a.assigned_to_name
                        ? <span>{a.assigned_to_name}{a.assigned_to_code ? <span className="text-muted-foreground"> · {a.assigned_to_code}</span> : null}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          {a.status === 'available' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setAssignFor(a); setAssignEmp(''); setAssignNotes('') }}>
                              <UserPlus className="h-3.5 w-3.5" />Assign
                            </Button>
                          )}
                          {a.status === 'assigned' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setReturnFor(a); setReturnCond('returned'); setReturnNotes('') }}>
                              <Undo2 className="h-3.5 w-3.5" />Return
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            disabled={a.status === 'assigned'}
                            onClick={() => { if (confirm(`Delete asset "${a.asset_code}"?`)) delMut.mutate(a.id) }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Add / Edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editItem ? 'Edit Asset' : 'New Asset'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Asset Code *</label>
                <Input value={form.asset_code} onChange={(e) => setForm(p => ({ ...p, asset_code: e.target.value }))} placeholder="LAP-001" className="h-8 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Dell Latitude" className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={form.category_id || 'none'} onValueChange={(v) => setForm(p => ({ ...p, category_id: v === 'none' ? '' : v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Serial Number</label>
              <Input value={form.serial_number} onChange={(e) => setForm(p => ({ ...p, serial_number: e.target.value }))} placeholder="Optional" className="h-8 text-sm font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Purchase Date</label>
                <DateInput className="h-8 text-sm" value={form.purchase_date} onChange={(v) => setForm(p => ({ ...p, purchase_date: v }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Purchase Cost</label>
                <Input type="number" min={0} value={form.purchase_cost} onChange={(e) => setForm(p => ({ ...p, purchase_cost: e.target.value }))} placeholder="0.00" className="h-8 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" className="h-8 text-sm" />
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={saveMut.isPending || !form.asset_code.trim() || !form.name.trim()} onClick={() => saveMut.mutate(form)}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign dialog */}
      <Dialog open={!!assignFor} onOpenChange={(o) => !o && setAssignFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Assign {assignFor?.asset_code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Employee *</label>
              <EmployeeSelector
                value={assignEmp}
                onChange={(v) => setAssignEmp(typeof v === 'string' ? v : (v[0] ?? ''))}
                placeholder="Search employee by name or code…"
                className="w-full"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAssignFor(null)}>Cancel</Button>
            <Button size="sm" disabled={assignMut.isPending || !assignEmp} onClick={() => assignMut.mutate()}>
              {assignMut.isPending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return dialog */}
      <Dialog open={!!returnFor} onOpenChange={(o) => !o && setReturnFor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Return {returnFor?.asset_code}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Condition *</label>
              <Select value={returnCond} onValueChange={(v) => setReturnCond(v as typeof returnCond)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="returned">Returned (good)</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} placeholder="Condition notes" className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setReturnFor(null)}>Cancel</Button>
            <Button size="sm" disabled={returnMut.isPending} onClick={() => returnMut.mutate()}>
              {returnMut.isPending ? 'Saving…' : 'Confirm Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
