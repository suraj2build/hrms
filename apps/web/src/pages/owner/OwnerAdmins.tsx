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
    mutationFn: () => ownerApi.post('/owner/admins', form),
    onSuccess: (res: any) => {
      toast.success(res.message ?? 'Invitation sent')
      setInviteOpen(false)
      setForm({ name: '', email: '', role: 'admin' })
      qc.invalidateQueries({ queryKey: ['owner-admins'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  function toggleActive(id: string, current: boolean) {
    ownerApi.patch(`/owner/admins/${id}`, { is_active: !current })
      .then(() => { toast.success(current ? 'Admin deactivated' : 'Admin activated'); qc.invalidateQueries({ queryKey: ['owner-admins'] }) })
      .catch((e: any) => toast.error(e.message))
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Platform Admins</h1>
          <p className="text-sm text-slate-500">{admins.length} admin{admins.length !== 1 ? 's' : ''}</p>
        </div>
        {isOwner() && (
          <Button onClick={() => setInviteOpen(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5">
            <Plus className="h-4 w-4" /> Invite Admin
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {isLoading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 animate-pulse rounded-xl" />
        ))}
        {admins.map(a => (
          <div key={a.id} className={`rounded-xl border p-4 flex items-center gap-4 ${
            a.is_active ? 'border-slate-800 bg-slate-900' : 'border-slate-800 bg-slate-900/50 opacity-60'
          }`}>
            {/* Avatar */}
            <div className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${
              a.role === 'owner' ? 'bg-indigo-900' : 'bg-slate-800'
            }`}>
              <span className="text-sm font-bold text-indigo-300">{a.name.charAt(0).toUpperCase()}</span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white text-[14px] truncate">{a.name}</p>
                {a.id === me?.id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-300">you</span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex items-center gap-0.5 ${
                  a.role === 'owner'
                    ? 'border-purple-500/40 text-purple-300 bg-purple-500/10'
                    : 'border-slate-700 text-slate-400'
                }`}>
                  {a.role === 'owner' ? <Crown className="h-2.5 w-2.5" /> : <Shield className="h-2.5 w-2.5" />}
                  {a.role}
                </span>
              </div>
              <p className="text-[12px] text-slate-500 truncate">{a.email}</p>
              <p className="text-[11px] text-slate-600">Last login: {fmtDate(a.last_login_at)}</p>
            </div>

            {/* Actions */}
            {isOwner() && a.id !== me?.id && (
              <button
                onClick={() => toggleActive(a.id, a.is_active)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  a.is_active
                    ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                    : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
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
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-sm">
          <DialogHeader><DialogTitle>Invite Platform Admin</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {[
              { key: 'name',  label: 'Full Name *', type: 'text',  placeholder: 'Jane Smith' },
              { key: 'email', label: 'Email *',     type: 'email', placeholder: 'jane@platform.local' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">{label}</label>
                <Input
                  type={type}
                  placeholder={placeholder}
                  value={(form as any)[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Role</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
              >
                <option value="admin">Admin — can manage tenants & keys</option>
                <option value="owner">Owner — full access including other admins</option>
              </select>
            </div>
            <p className="text-[12px] text-slate-500">
              An invitation email will be sent. The new admin must set their password via the link.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} className="text-slate-400">Cancel</Button>
            <Button
              onClick={() => inviteMut.mutate()}
              disabled={!form.name.trim() || !form.email.trim() || inviteMut.isPending}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {inviteMut.isPending ? 'Sending…' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
