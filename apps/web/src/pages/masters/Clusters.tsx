/**
 * Clusters — /admin/masters/clusters
 *
 * Operational grouping of sites (Region → Cluster → Site), independent of the
 * State statutory axis. A cluster carries a cluster/area manager who gains
 * visibility over the employees working at the cluster's sites.
 */
import { useState }                                from 'react'
import { toast }                                  from 'sonner'
import { useQuery, useMutation, useQueryClient }  from '@tanstack/react-query'
import { Network, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
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
import { MergeDeleteDialog }                      from '@/components/ui/merge-delete-dialog'

interface Cluster {
  id:                 string
  code:               string
  name:               string
  region:             string | null
  cluster_manager_id: string | null
  parent_cluster_id:  string | null
  description:        string | null
  is_active:          boolean
  created_at:         string
}

interface EmployeeLite {
  id:            string
  employee_code: string | null
  first_name:    string | null
  last_name:     string | null
}

const EMPTY_FORM = {
  name:               '',
  code:               '',
  region:             '',
  cluster_manager_id: '',
  parent_cluster_id:  '',
  description:        '',
  is_active:          true,
}

export function Clusters() {
  const qc              = useQueryClient()
  const { profile }     = useAuthStore()
  const isAdmin         = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const [dlgOpen,      setDlgOpen]      = useState(false)
  const [editItem,     setEditItem]     = useState<Cluster | null>(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [err,          setErr]          = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: clData, isLoading } = useQuery<{ data: Cluster[] }>({
    queryKey: ['clusters'],
    queryFn:  () => api.get('/masters/clusters'),
    staleTime: 60_000,
  })
  const clusters = clData?.data ?? []

  // Employees for the cluster-manager dropdown (admins only manage clusters).
  const { data: empData } = useQuery<{ data: EmployeeLite[] }>({
    queryKey: ['employees', 'lite'],
    queryFn:  () => api.get('/employees?limit=500&status=active'),
    staleTime: 60_000,
    enabled:   isAdmin,
  })
  const employees = empData?.data ?? []

  function empLabel(e: EmployeeLite): string {
    const name = [e.first_name, e.last_name].filter(Boolean).join(' ').trim()
    return e.employee_code ? `${name || 'Unnamed'} (${e.employee_code})` : (name || e.id)
  }
  function managerName(id: string | null): string {
    if (!id) return '—'
    const e = employees.find(x => x.id === id)
    return e ? empLabel(e) : '—'
  }
  function clusterName(id: string | null): string {
    if (!id) return '—'
    return clusters.find(c => c.id === id)?.name ?? '—'
  }

  function openCreate() {
    setEditItem(null)
    setForm(EMPTY_FORM)
    setErr('')
    setDlgOpen(true)
  }

  function openEdit(c: Cluster) {
    setEditItem(c)
    setForm({
      name:               c.name,
      code:               c.code,
      region:             c.region             ?? '',
      cluster_manager_id: c.cluster_manager_id ?? '',
      parent_cluster_id:  c.parent_cluster_id  ?? '',
      description:        c.description         ?? '',
      is_active:          c.is_active,
    })
    setErr('')
    setDlgOpen(true)
  }

  const saveMut = useMutation({
    mutationFn: (body: typeof EMPTY_FORM) => {
      const payload = {
        name:               body.name,
        code:               body.code || undefined,
        region:             body.region || null,
        cluster_manager_id: body.cluster_manager_id || null,
        parent_cluster_id:  body.parent_cluster_id || null,
        description:        body.description || null,
        is_active:          body.is_active,
      }
      return editItem
        ? api.put(`/masters/clusters/${editItem.id}`, payload)
        : api.post('/masters/clusters', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters'] })
      setDlgOpen(false)
      toast.success(editItem ? 'Cluster updated' : 'Cluster created')
    },
    onError: (e: any) => {
      setErr(e?.message ?? 'Failed to save')
      toast.error('Failed to save cluster')
    },
  })

  const delMut = useMutation({
    mutationFn: ({ id, mergeTo }: { id: string; mergeTo?: string }) =>
      api.delete(`/masters/clusters/${id}`, mergeTo ? { merge_to: mergeTo } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clusters'] })
      qc.invalidateQueries({ queryKey: ['usage'] })
      toast.success('Cluster deleted')
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error('Delete failed', { description: e.message }),
  })

  return (
    <PageContainer>
      <PageHeader
        title="Clusters"
        subtitle="Operational grouping of sites — Region → Cluster → Site"
        actions={
          isAdmin
            ? <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Cluster</Button>
            : undefined
        }
      />

      <SectionCard
        title="All Clusters"
        icon={<Network className="h-4 w-4 text-muted-foreground" />}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : clusters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Network className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No clusters configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {['Code', 'Name', 'Region', 'Manager', 'Parent', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clusters.map(c => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{c.code}</td>
                    <td className="px-3 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{c.region ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{managerName(c.cluster_manager_id)}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{clusterName(c.parent_cluster_id)}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={c.is_active ? 'success' : 'outline'} className="rounded-full text-xs">
                        {c.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget({ id: c.id, name: c.name })}
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

      {/* Create / Edit dialog */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Cluster' : 'New Cluster'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Code</label>
                <Input
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                  placeholder="CL-BLR-S"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Region</label>
                <Input
                  value={form.region}
                  onChange={e => setForm(p => ({ ...p, region: e.target.value }))}
                  placeholder="South"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Bengaluru South"
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Cluster Manager</label>
              <select
                value={form.cluster_manager_id}
                onChange={e => setForm(p => ({ ...p, cluster_manager_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">— Not set —</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{empLabel(e)}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                The manager gains visibility over employees at this cluster's sites.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Parent Cluster</label>
              <select
                value={form.parent_cluster_id}
                onChange={e => setForm(p => ({ ...p, parent_cluster_id: e.target.value }))}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
              >
                <option value="">— None —</option>
                {clusters.filter(c => c.id !== editItem?.id).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="South Bengaluru retail cluster"
                className="h-8 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cl-active"
                checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <label htmlFor="cl-active" className="text-xs text-muted-foreground select-none">Active</label>
            </div>

            {err && <p className="text-xs text-destructive">{err}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDlgOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saveMut.isPending || !form.name.trim()}
              onClick={() => saveMut.mutate(form)}
            >
              {saveMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {deleteTarget && (
        <MergeDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          entityType="Cluster"
          entityName={deleteTarget.name}
          id={deleteTarget.id}
          usageUrl={`/masters/clusters/${deleteTarget.id}/usage`}
          usageLabel="sites"
          mergeOptions={clusters.filter(c => c.id !== deleteTarget.id).map(c => ({ id: c.id, name: c.name }))}
          onConfirm={(mergeTo) => delMut.mutate({ id: deleteTarget.id, mergeTo })}
          isPending={delMut.isPending}
        />
      )}
    </PageContainer>
  )
}
