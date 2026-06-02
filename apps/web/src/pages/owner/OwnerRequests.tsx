import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerApi }      from '@/lib/api/ownerApi'
import { useOwnerStore } from '@/stores/ownerStore'
import { toast }         from 'sonner'
import { Check, X, Clock, Building2, Mail, Globe, Users, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input }  from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface SignupRequest {
  id: string; company_name: string; contact_name: string; contact_email: string
  industry: string | null; size_range: string | null; country: string
  message: string | null; status: 'pending' | 'approved' | 'rejected'
  reviewed_at: string | null; rejection_reason: string | null
  tenant_id: string | null; created_at: string
}

function fmtDate(d: string) {
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

export function OwnerRequests() {
  const qc              = useQueryClient()
  const { isOwner }     = useOwnerStore()
  const [statusFilt, setStatusFilt] = useState('pending')
  const [approveId, setApproveId]   = useState<string | null>(null)
  const [rejectId,  setRejectId]    = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [approveForm, setApproveForm] = useState({ plan: 'standard', per_employee_rate: '' })

  const { data, isLoading } = useQuery<{ data: SignupRequest[]; meta: { total: number } }>({
    queryKey: ['owner-requests', statusFilt],
    queryFn:  () => ownerApi.get(`/owner/requests?status=${statusFilt}&limit=50`),
    placeholderData: (prev) => prev,
  })

  const approveMut = useMutation({
    mutationFn: (id: string) => ownerApi.post(`/owner/requests/${id}/approve`, {
      plan: approveForm.plan,
      per_employee_rate: Number(approveForm.per_employee_rate) || 0,
    }),
    onSuccess: () => {
      toast.success('Request approved — tenant created')
      setApproveId(null)
      qc.invalidateQueries({ queryKey: ['owner-requests'] })
      qc.invalidateQueries({ queryKey: ['owner-tenants'] })
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const rejectMut = useMutation({
    mutationFn: (id: string) => ownerApi.post(`/owner/requests/${id}/reject`, { reason: rejectReason }),
    onSuccess: () => {
      toast.success('Request rejected')
      setRejectId(null)
      setRejectReason('')
      qc.invalidateQueries({ queryKey: ['owner-requests'] })
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const requests = data?.data ?? []

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Signup Requests</h1>
        <p className="text-sm text-slate-500">{data?.meta?.total ?? 0} total requests</p>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected', ''].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilt(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilt === s ? 'bg-[#0D9488] text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {isLoading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 bg-slate-800 animate-pulse rounded-xl" />
        ))}
        {!isLoading && requests.length === 0 && (
          <div className="rounded-xl border border-slate-800 p-8 text-center text-slate-500">
            No {statusFilt || ''} requests
          </div>
        )}
        {requests.map(r => (
          <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-4 w-4 text-slate-400" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-white text-[14px]">{r.company_name}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[12px] text-slate-400">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{r.contact_name}</span>
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{r.contact_email}</span>
                    {r.industry   && <span>{r.industry}</span>}
                    {r.size_range && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{r.size_range} people</span>}
                  </div>
                  {r.message && (
                    <p className="mt-1.5 text-[12px] text-slate-500 flex items-start gap-1">
                      <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      <span className="line-clamp-2">{r.message}</span>
                    </p>
                  )}
                  {r.rejection_reason && (
                    <p className="mt-1 text-[12px] text-red-400">Rejected: {r.rejection_reason}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <p className="text-[10px] text-slate-600">{fmtDate(r.created_at)}</p>
                  <span className={`text-[11px] font-medium ${
                    r.status === 'pending' ? 'text-amber-400' : r.status === 'approved' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {r.status === 'pending' && <Clock className="h-3 w-3 inline mr-0.5" />}
                    {r.status}
                  </span>
                </div>
                {r.status === 'pending' && isOwner() && (
                  <div className="flex gap-1.5 ml-2">
                    <Button
                      onClick={() => { setApproveId(r.id); setApproveForm({ plan: 'standard', per_employee_rate: '' }) }}
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-500 text-white h-7 text-xs gap-1"
                    >
                      <Check className="h-3 w-3" /> Approve
                    </Button>
                    <Button
                      onClick={() => { setRejectId(r.id); setRejectReason('') }}
                      size="sm"
                      variant="outline"
                      className="border-red-500/40 text-red-400 hover:bg-red-500/10 h-7 text-xs gap-1"
                    >
                      <X className="h-3 w-3" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Approve dialog */}
      <Dialog open={!!approveId} onOpenChange={() => setApproveId(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-sm">
          <DialogHeader><DialogTitle>Approve & Create Tenant</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Plan</label>
              <select
                value={approveForm.plan}
                onChange={e => setApproveForm(f => ({ ...f, plan: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white"
              >
                <option value="standard">Standard</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-300">Per-Employee Rate (₹)</label>
              <Input
                type="number"
                placeholder="299"
                value={approveForm.per_employee_rate}
                onChange={e => setApproveForm(f => ({ ...f, per_employee_rate: e.target.value }))}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveId(null)} className="text-slate-400">Cancel</Button>
            <Button
              onClick={() => approveId && approveMut.mutate(approveId)}
              disabled={approveMut.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {approveMut.isPending ? 'Creating…' : 'Approve & Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectId} onOpenChange={() => setRejectId(null)}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-sm">
          <DialogHeader><DialogTitle>Reject Request</DialogTitle></DialogHeader>
          <div className="space-y-1.5 py-2">
            <label className="text-sm font-medium text-slate-300">Reason *</label>
            <Input
              placeholder="Not a good fit at this time"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectId(null)} className="text-slate-400">Cancel</Button>
            <Button
              onClick={() => rejectId && rejectMut.mutate(rejectId)}
              disabled={!rejectReason.trim() || rejectMut.isPending}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {rejectMut.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
