import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { useOwnerStore } from '@/stores/ownerStore'
import { toast }         from 'sonner'
import { Plus, UserCheck, UserX, Shield, Crown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface Admin {
  id: string; name: string; email: string; role: 'owner' | 'admin'
  is_active: boolean; last_login_at: string | null; created_at: string
}

function fmtDate(d: string | null) {
  if (!d) return 'Never'
  const dt = new Date(d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  const hr = String(dt.getHours()).padStart(2,'0')
  const mn = String(dt.getMinutes()).padStart(2,'0')
  return `${String(dt.getDate()).padStart(2,'0')}-${M[dt.getMonth()]}-${dt.getFullYear()} ${hr}:${mn}`
}

export function OwnerAdmins() {
  const qc            = useQueryClient()
  const { admin: me, isOwner } = useOwnerStore()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'admin' })

  const { data, isLoading } = useQuery<{ data: Admin[] }>({
    queryKey: ['owner-admins'],
    queryFn:  () => ownerApi.get('/owner/admins'),
  })
  const admins = data?.data ?? []

  const inviteMut = useMutation({
    mutationFn: () => ownerApi.post<{ message?: string }>('/owner/admins', form),
    onSuccess: (res) => {
      toast.success(res.message ?? 'Invitation sent')
      setInviteOpen(false)
      setForm({ name: '', email: '', role: 'admin' })
      qc.invalidateQueries({ queryKey: ['owner-admins'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  function toggleActive(id: string, current: boolean) {
    ownerApi.patch(`/owner/admins/${id}`, { is_active: !current })
      .then(() => { toast.success(current ? 'Admin deactivated' : 'Admin activated'); qc.invalidateQueries({ queryKey: ['owner-admins'] }) })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Platform Admins</h1>
          <p className="text-sm text-muted-foreground">{admins.length} admin{admins.length !== 1 ? 's' : ''}</p>
        </div>
        {isOwner() && (
          <Button onClick={() => setInviteOpen(true)} className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20 gap-1.5">
            <Plus className="h-4 w-4" /> Invite Admin
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {isLoading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />
        ))}
        {admins.map(a => (
          <div key={a.id} className={`rounded-2xl border border-border bg-card backdrop-blur-2xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04] p-4 flex items-center gap-4 ${
            a.is_active ? '' : 'opacity-60'
          }`}>
            {/* Avatar */}
            <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
              a.role === 'owner'
                ? 'bg-gradient-to-br from-primary to-accent-teal'
                : 'bg-gradient-to-br from-muted to-muted'
            }`}>
              <span className="text-sm font-bold text-white">{a.name.charAt(0).toUpperCase()}</span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground text-[14px] truncate">{a.name}</p>
                {a.id === me?.id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 border border-primary/30 text-primary">you</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-0.5 ${
                  a.role === 'owner'
                    ? 'border-primary/40 text-primary bg-primary/10'
                    : 'border-border text-muted-foreground'
                }`}>
                  {a.role === 'owner' ? <Crown className="h-2.5 w-2.5" /> : <Shield className="h-2.5 w-2.5" />}
                  {a.role}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground truncate">{a.email}</p>
              <p className="text-[11px] text-muted-foreground">Last login: {fmtDate(a.last_login_at)}</p>
            </div>

            {/* Actions */}
            {isOwner() && a.id !== me?.id && (
              <button
                onClick={() => toggleActive(a.id, a.is_active)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  a.is_active
                    ? 'border-destructive/30 text-destructive hover:bg-red-500/10'
                    : 'border-success/30 text-success hover:bg-emerald-500/10'
                }`}
              >
                {a.is_active ? <><UserX className="h-3.5 w-3.5" /> Deactivate</> : <><UserCheck className="h-3.5 w-3.5" /> Activate</>}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader><DialogTitle>Invite Platform Admin</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {([
              { key: 'name',  label: 'Full Name *', type: 'text',  placeholder: 'Jane Smith' },
              { key: 'email', label: 'Email *',     type: 'email', placeholder: 'jane@platform.local' },
            ] as const).map(({ key, label, type, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label htmlFor={`invite-admin-${key}`} className="text-sm font-medium text-foreground">{label}</label>
                <Input
                  id={`invite-admin-${key}`}
                  type={type}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <label htmlFor="invite-admin-role" className="text-sm font-medium text-foreground">Role</label>
              <select
                id="invite-admin-role"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
              >
                <option value="admin">Admin — can manage tenants & keys</option>
                <option value="owner">Owner — full access including other admins</option>
              </select>
            </div>
            <p className="text-[12px] text-muted-foreground">
              An invitation email will be sent. The new admin must set their password via the link.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} className="text-muted-foreground">Cancel</Button>
            <Button
              onClick={() => inviteMut.mutate()}
              disabled={!form.name.trim() || !form.email.trim() || inviteMut.isPending}
              className="bg-gradient-to-r from-success via-info to-primary hover:from-success/90 hover:to-primary/90 text-primary-foreground border-0 shadow-md shadow-success/20"
            >
              {inviteMut.isPending ? 'Sending…' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
