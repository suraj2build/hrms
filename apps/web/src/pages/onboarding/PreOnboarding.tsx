/**
 * PreOnboarding — Pre-Joinee Invitation Management
 *
 * Route: /admin/onboarding/pre-joinee
 *
 * Features:
 *  - Stats strip: Total | Pending | Submitted | Approved
 *  - "+ Invite Candidate" dialog with invite-link copybox on success
 *  - Table of all invitations with status badges + actions
 *  - Side drawer for reviewing submitted forms with Approve / Reject
 */

import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Copy, Check, Eye, UserCheck, UserX, Trash2, Link,
  Users, Clock, ClipboardList, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { DateInput } from '@/components/ui/date-input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ── Types ─────────────────────────────────────────────────────────────────────

type InviteStatus = 'pending' | 'submitted' | 'approved' | 'rejected' | 'expired'

interface PreJoinee {
  id: string
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  designation?: string | null
  department?: string | null
  joining_date: string
  status: InviteStatus
  invite_token: string
  invite_url?: string | null
  submitted_at?: string | null
  created_at: string
  submission?: PreJoineeSubmission | null
}

interface PreJoineeSubmission {
  // Personal
  dob?: string | null
  gender?: string | null
  blood_group?: string | null
  marital_status?: string | null
  nationality?: string | null
  // Address
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
  // Emergency contact
  emergency_name?: string | null
  emergency_relation?: string | null
  emergency_phone?: string | null
  // Bank
  bank_name?: string | null
  account_number?: string | null
  ifsc?: string | null
  // Compliance
  pan?: string | null
  aadhaar?: string | null
  uan?: string | null
  // Documents / declaration
  documents_uploaded?: boolean
  declaration_accepted?: boolean
}

interface PreJoineeListResponse {
  data: PreJoinee[]
  total?: number
}

interface StatsResponse {
  total: number
  pending: number
  submitted: number
  approved: number
}

interface InviteForm {
  first_name: string
  last_name: string
  email: string
  phone: string
  designation: string
  department: string
  joining_date: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

const STATUS_CONFIG: Record<InviteStatus, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'bg-amber-100 text-amber-800 border-amber-200' },
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  approved:  { label: 'Approved',  className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rejected:  { label: 'Rejected',  className: 'bg-red-100 text-red-800 border-red-200' },
  expired:   { label: 'Expired',   className: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function StatusBadge({ status }: { status: InviteStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.expired
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function useCopyText() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }
  return { copied, copy }
}

const EMPTY_FORM: InviteForm = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  designation: '',
  department: '',
  joining_date: '',
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, accent,
}: { label: string; value: number; icon: React.ElementType; accent: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
    </div>
  )
}

// ── Submission Review Drawer ──────────────────────────────────────────────────

interface ReviewDrawerProps {
  joinee: PreJoinee | null
  open: boolean
  onClose: () => void
  onApprove: (id: string) => void
  onReject: (id: string, notes: string) => void
  approving: boolean
  rejecting: boolean
}

function ReviewDrawer({ joinee, open, onClose, onApprove, onReject, approving, rejecting }: ReviewDrawerProps) {
  const [rejectNotes, setRejectNotes] = useState('')
  const [showRejectBox, setShowRejectBox] = useState(false)
  const s = joinee?.submission

  function handleApprove() {
    if (!joinee) return
    onApprove(joinee.id)
  }

  function handleReject() {
    if (!joinee) return
    if (!showRejectBox) { setShowRejectBox(true); return }
    if (!rejectNotes.trim()) { toast.error('Please enter rejection notes'); return }
    onReject(joinee.id, rejectNotes)
  }

  function Row({ label, value }: { label: string; value?: string | null | boolean }) {
    if (value === undefined || value === null || value === '') return null
    return (
      <div className="flex gap-3 py-1.5">
        <span className="w-40 shrink-0 text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">
          {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}
        </span>
      </div>
    )
  }

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
        {children}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) { onClose(); setShowRejectBox(false); setRejectNotes('') } }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-5 border-b">
          <SheetTitle>Submission Review</SheetTitle>
          {joinee && (
            <p className="text-sm text-muted-foreground">
              {joinee.first_name} {joinee.last_name} · {joinee.email}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!s ? (
            <p className="text-sm text-muted-foreground">No submission data available.</p>
          ) : (
            <>
              <Section title="Personal Info">
                <Row label="Date of Birth" value={formatDate(s.dob)} />
                <Row label="Gender" value={s.gender} />
                <Row label="Blood Group" value={s.blood_group} />
                <Row label="Marital Status" value={s.marital_status} />
                <Row label="Nationality" value={s.nationality} />
              </Section>

              <Section title="Address">
                <Row label="Address Line 1" value={s.address_line1} />
                <Row label="Address Line 2" value={s.address_line2} />
                <Row label="City" value={s.city} />
                <Row label="State" value={s.state} />
                <Row label="Pincode" value={s.pincode} />
              </Section>

              <Section title="Emergency Contact">
                <Row label="Name" value={s.emergency_name} />
                <Row label="Relation" value={s.emergency_relation} />
                <Row label="Phone" value={s.emergency_phone} />
              </Section>

              <Section title="Bank Details">
                <Row label="Bank Name" value={s.bank_name} />
                <Row label="Account Number" value={s.account_number} />
                <Row label="IFSC Code" value={s.ifsc} />
              </Section>

              <Section title="Compliance">
                <Row label="PAN" value={s.pan} />
                <Row label="Aadhaar" value={s.aadhaar} />
                <Row label="UAN" value={s.uan} />
              </Section>

              <Section title="Documents & Declaration">
                <Row label="Documents Uploaded" value={s.documents_uploaded} />
                <Row label="Declaration Accepted" value={s.declaration_accepted} />
              </Section>
            </>
          )}

          {showRejectBox && (
            <div className="space-y-2 pt-2">
              <Label htmlFor="reject-notes">Rejection Notes <span className="text-destructive">*</span></Label>
              <textarea
                id="reject-notes"
                value={rejectNotes}
                onChange={e => setRejectNotes(e.target.value)}
                placeholder="Provide a reason for rejection..."
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
          )}
        </div>

        {joinee?.status === 'submitted' && (
          <div className="border-t px-6 py-4 flex items-center gap-3 bg-background">
            <Button
              className="flex-1"
              onClick={handleApprove}
              disabled={approving || rejecting}
            >
              <UserCheck className="mr-2 h-4 w-4" />
              {approving ? 'Approving…' : 'Approve & Create Employee'}
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
              onClick={handleReject}
              disabled={approving || rejecting}
            >
              <UserX className="mr-2 h-4 w-4" />
              {rejecting ? 'Rejecting…' : showRejectBox ? 'Confirm Reject' : 'Reject'}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function PreOnboarding({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient()
  const { copied, copy } = useCopyText()

  // ── Dialog state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  // ── Drawer state
  const [drawerJoinee, setDrawerJoinee] = useState<PreJoinee | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: statsData } = useQuery<StatsResponse>({
    queryKey: ['pre-joinee-stats'],
    queryFn: () => api.get('/onboarding/pre-joinee/stats'),
  })

  const { data: listData, isLoading } = useQuery<PreJoineeListResponse>({
    queryKey: ['pre-joinee-list'],
    queryFn: () => api.get('/onboarding/pre-joinee'),
  })

  const invitations: PreJoinee[] = listData?.data ?? []

  // ── Master data for dropdowns ──────────────────────────────────────────────
  const { data: deptResp } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments'),
    staleTime: 300_000,
  })
  const departments = deptResp?.data ?? []

  const { data: desigResp } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['designations'],
    queryFn: () => api.get('/designations'),
    staleTime: 300_000,
  })
  const designations = desigResp?.data ?? []

  const stats = {
    total: statsData?.total ?? invitations.length,
    pending: statsData?.pending ?? invitations.filter(i => i.status === 'pending').length,
    submitted: statsData?.submitted ?? invitations.filter(i => i.status === 'submitted').length,
    approved: statsData?.approved ?? invitations.filter(i => i.status === 'approved').length,
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  const inviteMutation = useMutation({
    mutationFn: (payload: InviteForm) =>
      api.post<{ data?: { invite_url?: string; invite_token?: string; email_sent?: boolean } }>('/onboarding/pre-joinee', payload),
    onSuccess: (data: { data?: { invite_url?: string; invite_token?: string; email_sent?: boolean } }) => {
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      qc.invalidateQueries({ queryKey: ['pre-joinee-stats'] })
      const path = data?.data?.invite_url ?? `/pre-join/${data?.data?.invite_token ?? ''}`
      const url = path.startsWith('http') ? path : `${window.location.origin}${path}`
      setInviteLink(url)
      toast.success(
        data?.data?.email_sent
          ? 'Invitation created — email sent to candidate'
          : 'Invitation created — share the link below (email not sent)',
      )
    },
    onError: (e: any) => toast.error('Failed to create invitation', {
      description: e?.message ?? e?.body?.message ?? 'Unknown error',
    }),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/onboarding/pre-joinee/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      qc.invalidateQueries({ queryKey: ['pre-joinee-stats'] })
      setDrawerOpen(false)
      toast.success('Candidate approved — employee record created')
    },
    onError: () => toast.error('Failed to approve candidate'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api.post(`/onboarding/pre-joinee/${id}/reject`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      qc.invalidateQueries({ queryKey: ['pre-joinee-stats'] })
      setDrawerOpen(false)
      toast.success('Candidate rejected')
    },
    onError: () => toast.error('Failed to reject candidate'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/onboarding/pre-joinee/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      qc.invalidateQueries({ queryKey: ['pre-joinee-stats'] })
      setDeleteId(null)
      toast.success('Invitation deleted')
    },
    onError: () => toast.error('Failed to delete invitation'),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleInviteSubmit() {
    if (!form.first_name.trim()) { toast.error('First name is required'); return }
    if (!form.last_name.trim())  { toast.error('Last name is required'); return }
    if (!form.email.trim())      { toast.error('Email is required'); return }
    if (!form.joining_date)      { toast.error('Joining date is required'); return }
    inviteMutation.mutate(form)
  }

  function handleDialogClose() {
    setInviteOpen(false)
    setForm(EMPTY_FORM)
    setInviteLink(null)
  }

  function openReview(joinee: PreJoinee) {
    setDrawerJoinee(joinee)
    setDrawerOpen(true)
  }

  function getInviteUrl(joinee: PreJoinee) {
    const path = joinee.invite_url ?? `/pre-join/${joinee.invite_token}`
    return path.startsWith('http') ? path : `${window.location.origin}${path}`
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const Wrapper = embedded ? Fragment : PageContainer
  return (
    <Wrapper>
      {embedded ? (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Invite Candidate
          </Button>
        </div>
      ) : (
        <PageHeader
          title="Pre-Onboarding"
          subtitle="Invite candidates to fill their details before Day 1"
          actions={
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Invite Candidate
            </Button>
          }
        />
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Invitations" value={stats.total}     icon={Users}          accent="bg-indigo-100 text-indigo-600" />
        <StatCard label="Pending"           value={stats.pending}   icon={Clock}          accent="bg-amber-100 text-amber-600" />
        <StatCard label="Submitted"         value={stats.submitted} icon={ClipboardList}  accent="bg-blue-100 text-blue-600" />
        <StatCard label="Approved"          value={stats.approved}  icon={CheckCircle2}   accent="bg-emerald-100 text-emerald-600" />
      </div>

      {/* Table */}
      <SectionCard title="Invitations" description="All pre-joinee invitations and their current status">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading invitations…</div>
        ) : invitations.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No invitations yet. Click "Invite Candidate" to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 pr-4">Name</th>
                  <th className="pb-3 pr-4">Email</th>
                  <th className="pb-3 pr-4">Joining Date</th>
                  <th className="pb-3 pr-4">Designation</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 pr-4">Submitted</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invitations.map(inv => (
                  <tr key={inv.id} className="group hover:bg-muted/30 transition-colors">
                    <td className="py-3 pr-4 font-medium">
                      {inv.first_name} {inv.last_name}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{inv.email}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(inv.joining_date)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{inv.designation ?? '—'}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatDate(inv.submitted_at)}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        {inv.status === 'submitted' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReview(inv)}
                            className="h-7 px-2 text-xs"
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            View Submission
                          </Button>
                        )}
                        {inv.status === 'submitted' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => approveMutation.mutate(inv.id)}
                              disabled={approveMutation.isPending}
                              className="h-7 px-2 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            >
                              <UserCheck className="mr-1 h-3 w-3" />
                              Approve
                            </Button>
                            <RejectInlineButton
                              onReject={notes => rejectMutation.mutate({ id: inv.id, notes })}
                              disabled={rejectMutation.isPending}
                            />
                          </>
                        )}
                        {inv.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const url = getInviteUrl(inv)
                              copy(url, inv.id)
                              toast.success('Invite link copied')
                            }}
                            className="h-7 px-2 text-xs"
                          >
                            {copied === inv.id ? (
                              <Check className="mr-1 h-3 w-3 text-emerald-600" />
                            ) : (
                              <Link className="mr-1 h-3 w-3" />
                            )}
                            Copy Link
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteId(inv.id)}
                          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={v => { if (!v) handleDialogClose() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite Candidate</DialogTitle>
            <DialogDescription>
              Send a pre-onboarding form link to the candidate. They can fill their details before Day 1.
            </DialogDescription>
          </DialogHeader>

          {inviteLink ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Invitation sent! Share this link with the candidate:
              </p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
                <Link className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-mono text-foreground">{inviteLink}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { copy(inviteLink, 'invite'); toast.success('Link copied') }}
                  className="h-7 shrink-0 px-2 text-xs"
                >
                  {copied === 'invite' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={handleDialogClose}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="first_name">First Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="first_name"
                    value={form.first_name}
                    onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last_name">Last Name <span className="text-destructive">*</span></Label>
                  <Input
                    id="last_name"
                    value={form.last_name}
                    onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                    placeholder="Doe"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="email">Email <span className="text-destructive">*</span></Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="john.doe@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98765 43210"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="joining_date">Joining Date <span className="text-destructive">*</span></Label>
                  <DateInput
                    id="joining_date"
                    value={form.joining_date}
                    onChange={v => setForm(f => ({ ...f, joining_date: v }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="designation">Designation</Label>
                  <Select
                    value={form.designation}
                    onValueChange={v => setForm(f => ({ ...f, designation: v }))}
                  >
                    <SelectTrigger id="designation">
                      <SelectValue placeholder="Select designation" />
                    </SelectTrigger>
                    <SelectContent>
                      {designations.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No designations — add in Setup</div>
                      )}
                      {designations.map(d => (
                        <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="department">Department</Label>
                  <Select
                    value={form.department}
                    onValueChange={v => setForm(f => ({ ...f, department: v }))}
                  >
                    <SelectTrigger id="department">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No departments — add in Setup</div>
                      )}
                      {departments.map(d => (
                        <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={handleDialogClose}>Cancel</Button>
                <Button onClick={handleInviteSubmit} disabled={inviteMutation.isPending}>
                  {inviteMutation.isPending ? 'Sending…' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Invitation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this invitation? The candidate's invite link will be invalidated.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submission Review Drawer */}
      <ReviewDrawer
        joinee={drawerJoinee}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerJoinee(null) }}
        onApprove={id => approveMutation.mutate(id)}
        onReject={(id, notes) => rejectMutation.mutate({ id, notes })}
        approving={approveMutation.isPending}
        rejecting={rejectMutation.isPending}
      />
    </Wrapper>
  )
}

// ── Inline reject button with popover notes ────────────────────────────────────

function RejectInlineButton({ onReject, disabled }: { onReject: (notes: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-xs border-red-300 text-red-700 hover:bg-red-50"
      >
        <UserX className="mr-1 h-3 w-3" />
        Reject
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Rejection notes…"
        className="h-7 w-36 text-xs"
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); setNotes('') }
          if (e.key === 'Enter' && notes.trim()) { onReject(notes); setOpen(false); setNotes('') }
        }}
      />
      <Button
        size="sm"
        variant="destructive"
        onClick={() => { if (notes.trim()) { onReject(notes); setOpen(false); setNotes('') } else { toast.error('Notes required') } }}
        disabled={disabled}
        className="h-7 px-2 text-xs"
      >
        OK
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => { setOpen(false); setNotes('') }}
        className="h-7 px-2 text-xs"
      >
        ✕
      </Button>
    </div>
  )
}
