import { useState }                               from 'react'
import { toast } from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Globe }            from 'lucide-react'
import { PageContainer }                          from '@/components/layout/PageContainer'
import { PageHeader }                             from '@/components/layout/PageHeader'
import { SectionCard }                            from '@/components/layout/SectionCard'
import { Button }                                 from '@/components/ui/button'
import { Input }                                  from '@/components/ui/input'
import { Badge }                                  from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
}                                                 from '@/components/ui/dialog'
import { api }                                    from '@/lib/api/client'
import { useAuthStore }                           from '@/stores/authStore'

interface Site {
  id:                string
  name:              string
  location:          string | null
  timezone:          string
  default_roster_id: string | null
  created_at:        string
}
interface Roster { id: string; name: string }

const EMPTY_FORM = { name: '', location: '', timezone: 'Asia/Kolkata', default_roster_id: '' }

export function Sites() {
  const qc                            = useQueryClient()
  const { profile }                   = useAuthStore()
  const isAdmin                       = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,  setDlgOpen]        = useState(false)
  const [editSite, setEditSite]       = useState<Site | null>(null)
  const [form,     setForm]           = useState(EMPTY_FORM)
  const [err,      setErr]            = useState('')

  const { data: sitesData, isLoading } = useQuery<{ data: Site[] }>({
    queryKey: ['sites'],
    queryFn:  () => api.get('/masters/sites'),
    staleTime: 60_000,
  })
  const { data: rostersData } = useQuery<{ data: Roster[] }>({
    queryKey: ['rosters-list'],
    queryFn:  () => api.get('/masters/rosters'),
    staleTime: 60_000,
  })
  const sites   = sitesData?.data  ?? []
  const rosters = rostersData?.data ?? []

  function openCreate() {
    setEditSite(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }
  function openEdit(s: Site) {
    setEditSite(s)
    setForm({ name: s.name, location: s.location ?? '', timezone: s.timezone, default_roster_id: s.default_roster_id ?? '' })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload = {
        name:              body.name,
        location:          body.location || null,
        timezone:          body.timezone || 'Asia/Kolkata',
        default_roster_id: body.default_roster_id || null,
      }
      return editSite
        ? api.put(`/masters/sites/${editSite.id}`, payload)
        : api.post('/masters/sites', payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); setDlgOpen(false); toast.success('Site saved') },
    onError:   (e: any) => { setErr(e?.message ?? 'Failed to save'); toast.error('Site saved', { description: e.message }) },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/sites/${id}`),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['sites'] }); toast.success('Site deleted') },
    onError: (e: Error) => toast.error('Site deleted', { description: e.message }),
  })

  const rosterName = (id: string | null) =>
    id ? (rosters.find((r) => r.id === id)?.name ?? id.slice(0, 8)) : '—'

  return (
    <PageContainer>
      <PageHeader
        title="Sites"
        subtitle="Physical locations with timezone and roster defaults"
        actions={isAdmin ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Site</Button> : undefined}
      />

      <SectionCard title="All Sites" icon={<Globe className="h-4 w-4 text-muted-foreground" />}>
        {isLoading ? (
          <div className="text-xs text-muted-foreground animate-pulse py-6 text-center">Loading…</div>
        ) : sites.length === 0 ? (
          <div className="text-xs text-muted-foreground py-6 text-center">No sites configured yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Name', 'Location', 'Timezone', 'Default Roster', ''].map((h) => (
                    <th key={h} className="text-left text-xs text-muted-foreground font-semibold px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 font-medium">{s.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">{s.location ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="rounded-full text-xs font-mono">{s.timezone}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{rosterName(s.default_roster_id)}</td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => delMut.mutate(s.id)}>
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

      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editSite ? 'Edit Site' : 'New Site'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Head Office" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Location</label>
              <Input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="Mumbai, Maharashtra" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Timezone (IANA)</label>
              <Input value={form.timezone} onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))} placeholder="Asia/Kolkata" className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Default Roster</label>
              <select
                value={form.default_roster_id}
                onChange={(e) => setForm((p) => ({ ...p, default_roster_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">— None —</option>
                {rosters.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={saveMut.isPending || !form.name.trim()} onClick={() => saveMut.mutate(form)}>
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
