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
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Copy, Check, Eye, UserCheck, UserX, Trash2, Link,
  Users, Clock, ClipboardList, CheckCircle2, Sparkles,
  UserPlus, Package, Search, Loader2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Best-effort error message extraction from an unknown thrown value. */
function errMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'object' && e !== null) {
    const rec = e as { message?: unknown; body?: { message?: unknown } }
    if (typeof rec.message === 'string' && rec.message) return rec.message
    if (typeof rec.body?.message === 'string' && rec.body.message) return rec.body.message
  }
  return 'Unknown error'
}

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
  session_id?: string | null
  submitted_at?: string | null
  created_at: string
  employee_id?: string | null
  buddy_employee_id?: string | null
  submission?: PreJoineeSubmission | null
}

interface EmployeeOption {
  id: string
  first_name: string
  last_name: string
  employee_code: string
  designation?: string | null
  department?: string | null
}

interface AssetOption {
  id: string
  asset_code: string
  name: string
  serial_number?: string | null
  category_name?: string | null
}

interface ExistingEmployee {
  id: string
  employee_code: string
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  status: string
  joining_date?: string | null
}

interface RehireCheckData {
  invitationId: string
  existing_employee: ExistingEmployee
  match_reason: 'email' | 'phone' | 'pan' | 'aadhaar'
}

interface ApproveResponse {
  action_required?: 'rehire_check'
  existing_employee?: ExistingEmployee
  match_reason?: string
  employee_id?: string
  message?: string
  rehired?: boolean
}

interface PreJoineeSubmission {
  // Candidate-confirmed identity/role (may differ from HR's invite — see edited_fields)
  confirmed_first_name?: string | null
  confirmed_last_name?: string | null
  confirmed_email?: string | null
  confirmed_phone?: string | null
  confirmed_designation?: string | null
  confirmed_department?: string | null
  confirmed_joining_date?: string | null
  edited_fields?: string[]
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
  pending:   { label: 'Pending',   className: 'bg-warning/15 text-warning border-warning/30' },
  submitted: { label: 'Submitted', className: 'bg-info/15 text-info border-info/30' },
  approved:  { label: 'Approved',  className: 'bg-success/15 text-success border-success/30' },
  rejected:  { label: 'Rejected',  className: 'bg-destructive/15 text-destructive border-destructive/30' },
  expired:   { label: 'Expired',   className: 'bg-muted text-muted-foreground border-border' },
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

// ── RH-01 Rehire Check Dialog ─────────────────────────────────────────────────

const MATCH_REASON_LABEL: Record<string, string> = {
  email:   'email address',
  phone:   'phone number',
  pan:     'PAN number',
  aadhaar: 'Aadhaar number',
}

const EMPLOYEE_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active:     { label: 'Active',     className: 'bg-success/15 text-success border-success/30' },
  inactive:   { label: 'Inactive',   className: 'bg-muted text-muted-foreground border-border' },
  terminated: { label: 'Terminated', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  on_leave:   { label: 'On Leave',   className: 'bg-warning/15 text-warning border-warning/30' },
}

interface RehireCheckDialogProps {
  data: RehireCheckData | null
  onClose: () => void
  onRehire: (invitationId: string, employeeId: string) => void
  onNewEmployee: (invitationId: string) => void
  isPending: boolean
}

function RehireCheckDialog({ data, onClose, onRehire, onNewEmployee, isPending }: RehireCheckDialogProps) {
  if (!data) return null
  const { existing_employee: emp, match_reason, invitationId } = data
  const statusCfg = EMPLOYEE_STATUS_CONFIG[emp.status] ?? { label: emp.status, className: 'bg-muted text-muted-foreground border-border' }

  return (
    <Dialog open={!!data} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-warning" />
            Existing Employee Found
          </DialogTitle>
          <DialogDescription>
            This candidate matches an existing employee record by <strong>{MATCH_REASON_LABEL[match_reason] ?? match_reason}</strong>.
            How would you like to proceed?
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{emp.first_name} {emp.last_name}</p>
              <p className="text-xs text-muted-foreground font-mono">{emp.employee_code}</p>
            </div>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.className}`}>
              {statusCfg.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Email</p>
              <p className="text-xs truncate">{emp.email}</p>
            </div>
            {emp.phone && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Phone</p>
                <p className="text-xs">{emp.phone}</p>
              </div>
            )}
            {emp.joining_date && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Last Joining</p>
                <p className="text-xs">{formatDate(emp.joining_date)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground bg-warning/10 border border-warning/30 rounded-md p-3">
          <p><strong>Rehire:</strong> Reactivates this existing record. Employment history is preserved.</p>
          <p><strong>New Employee:</strong> Creates a separate record. Only use if this is truly a different person.</p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-primary/30 text-primary hover:bg-primary/10"
            disabled={isPending}
            onClick={() => onNewEmployee(invitationId)}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Users className="h-3.5 w-3.5 mr-1.5" />}
            Create as New Employee
          </Button>
          <Button
            size="sm"
            className="bg-success hover:bg-success/90 text-success-foreground"
            disabled={isPending}
            onClick={() => onRehire(invitationId, emp.id)}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5 mr-1.5" />}
            Rehire
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, accent,
}: { label: string; value: number; icon: React.ElementType; accent: string }) {
  return (
    <div className="surface-premium lift-hover flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className={`gloss-sheen flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-black/5 shadow-sm ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-3xl font-bold tracking-tight tabular-nums">{value}</p>
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
              {(() => {
                const edited = new Set(s.edited_fields ?? [])
                const idRows: { key: string; label: string; value?: string | null }[] = [
                  { key: 'first_name',   label: 'First Name',   value: s.confirmed_first_name ?? joinee?.first_name },
                  { key: 'last_name',    label: 'Last Name',    value: s.confirmed_last_name ?? joinee?.last_name },
                  { key: 'email',        label: 'Email',        value: s.confirmed_email ?? joinee?.email },
                  { key: 'phone',        label: 'Phone',        value: s.confirmed_phone },
                  { key: 'designation',  label: 'Designation',  value: s.confirmed_designation ?? joinee?.designation },
                  { key: 'department',   label: 'Department',   value: s.confirmed_department ?? joinee?.department },
                  { key: 'joining_date', label: 'Joining Date', value: formatDate(s.confirmed_joining_date ?? joinee?.joining_date) },
                ]
                return (
                  <Section title="Candidate-Confirmed Details">
                    {edited.size > 0 && (
                      <div className="mb-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                        The candidate changed {edited.size} HR-provided field{edited.size > 1 ? 's' : ''}. Review the highlighted value{edited.size > 1 ? 's' : ''} below.
                      </div>
                    )}
                    {idRows.map((r) =>
                      r.value === undefined || r.value === null || r.value === '' ? null : (
                        <div key={r.key} className="flex gap-3 py-1.5 items-center">
                          <span className="w-40 shrink-0 text-sm text-muted-foreground">{r.label}</span>
                          <span className="text-sm font-medium">{r.value}</span>
                          {edited.has(r.key) && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Edited</span>
                          )}
                        </div>
                      )
                    )}
                  </Section>
                )
              })()}

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
  const navigate = useNavigate()
  const { copied, copy } = useCopyText()

  // ── AI Review push state (id of the invitation currently being pushed)
  const [pushingId, setPushingId] = useState<string | null>(null)

  // ── Dialog state
  const [inviteOpen, setInviteOpen] = useState(false)
  const [form, setForm] = useState<InviteForm>(EMPTY_FORM)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  // ── Drawer state
  const [drawerJoinee, setDrawerJoinee] = useState<PreJoinee | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // ── Buddy dialog
  const [buddyTarget, setBuddyTarget]   = useState<PreJoinee | null>(null)
  const [buddySearch, setBuddySearch]   = useState('')
  const [buddyPicked, setBuddyPicked]   = useState<EmployeeOption | null>(null)

  // ── Asset dialog
  const [assetTarget, setAssetTarget]   = useState<PreJoinee | null>(null)
  const [assetPicked, setAssetPicked]   = useState<Set<string>>(new Set())

  // ── RH-01: Rehire check dialog
  const [rehireCheck, setRehireCheck] = useState<RehireCheckData | null>(null)

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

  // ── Buddy search query (fires when buddy dialog open + search ≥ 2 chars) ───
  const { data: buddySearchResp, isFetching: buddyFetching } = useQuery<{ data: EmployeeOption[] }>({
    queryKey: ['employee-search', buddySearch],
    queryFn: () => api.get(`/employees?search=${encodeURIComponent(buddySearch)}&limit=20&status=active`),
    enabled: !!buddyTarget && buddySearch.length >= 2,
    staleTime: 30_000,
  })
  const buddyOptions: EmployeeOption[] = buddySearchResp?.data ?? []

  // ── Available assets query (fires when asset dialog open) ─────────────────
  const { data: assetsResp, isLoading: assetsLoading } = useQuery<{ data: AssetOption[] }>({
    queryKey: ['assets-available'],
    queryFn: () => api.get('/assets?status=available'),
    enabled: !!assetTarget,
    staleTime: 60_000,
  })
  const availableAssets: AssetOption[] = assetsResp?.data ?? []

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
    onError: (e: unknown) => toast.error('Failed to create invitation', {
      description: errMessage(e),
    }),
  })

  const approveMutation = useMutation({
    mutationFn: ({ id, action, employee_id }: { id: string; action?: 'rehire' | 'new_employee'; employee_id?: string }) =>
      api.post<ApproveResponse>(
        `/onboarding/pre-joinee/${id}/approve`,
        action ? { action, employee_id } : undefined,
      ),
    onSuccess: (data, vars) => {
      if (data?.action_required === 'rehire_check' && data.existing_employee) {
        setRehireCheck({
          invitationId:      vars.id,
          existing_employee: data.existing_employee,
          match_reason:      (data.match_reason ?? 'email') as RehireCheckData['match_reason'],
        })
        return
      }
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      qc.invalidateQueries({ queryKey: ['pre-joinee-stats'] })
      setDrawerOpen(false)
      setRehireCheck(null)
      if (data?.rehired) {
        toast.success('Candidate rehired — existing employee record reactivated')
      } else {
        toast.success('Candidate approved — employee record created')
      }
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

  const setBuddyMutation = useMutation({
    mutationFn: ({ id, buddy_employee_id }: { id: string; buddy_employee_id: string | null }) =>
      api.patch(`/onboarding/pre-joinee/${id}/buddy`, { buddy_employee_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      toast.success(buddyPicked ? `Buddy assigned — ${buddyPicked.first_name} will be notified` : 'Buddy removed')
      setBuddyTarget(null)
      setBuddySearch('')
      setBuddyPicked(null)
    },
    onError: () => toast.error('Failed to assign buddy'),
  })

  const assignAssetMutation = useMutation({
    mutationFn: ({ assetId, employeeId }: { assetId: string; employeeId: string }) =>
      api.post(`/assets/${assetId}/assign`, { employee_id: employeeId }),
  })

  async function handleAssignAssets() {
    if (!assetTarget?.employee_id || assetPicked.size === 0) return
    const employeeId = assetTarget.employee_id
    let success = 0
    for (const assetId of assetPicked) {
      try {
        await assignAssetMutation.mutateAsync({ assetId, employeeId })
        success++
      } catch { /* continue on individual failures */ }
    }
    qc.invalidateQueries({ queryKey: ['assets-available'] })
    toast.success(`${success} asset${success !== 1 ? 's' : ''} assigned to ${assetTarget.first_name}`)
    setAssetTarget(null)
    setAssetPicked(new Set())
  }

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

  async function openInAiReview(joinee: PreJoinee) {
    if (joinee.session_id) {
      navigate(`/admin/onboarding/${joinee.session_id}/review`)
      return
    }
    setPushingId(joinee.id)
    try {
      const res = await api.post<{ data?: { session_id?: string } }>(
        `/onboarding/pre-joinee/${joinee.id}/push-to-review`,
      )
      const sessionId = res?.data?.session_id
      if (!sessionId) {
        toast.error('Could not open in AI Review')
        return
      }
      qc.invalidateQueries({ queryKey: ['pre-joinee-list'] })
      toast.success('Sent to AI Review')
      navigate(`/admin/onboarding/${sessionId}/review`)
    } catch (e: unknown) {
      toast.error('Failed to send to AI Review', {
        description: errMessage(e),
      })
    } finally {
      setPushingId(null)
    }
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
        <StatCard label="Total Invitations" value={stats.total}     icon={Users}          accent="bg-info/15 text-info" />
        <StatCard label="Pending"           value={stats.pending}   icon={Clock}          accent="bg-warning/15 text-warning" />
        <StatCard label="Submitted"         value={stats.submitted} icon={ClipboardList}  accent="bg-info/15 text-info" />
        <StatCard label="Approved"          value={stats.approved}  icon={CheckCircle2}   accent="bg-success/15 text-success" />
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
                          <Button
                            size="sm"
                            onClick={() => openInAiReview(inv)}
                            disabled={pushingId === inv.id}
                            className="h-7 px-2 text-xs"
                          >
                            <Sparkles className="mr-1 h-3 w-3" />
                            {pushingId === inv.id ? 'Opening…' : 'Open in AI Review'}
                          </Button>
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
                              <Check className="mr-1 h-3 w-3 text-success" />
                            ) : (
                              <Link className="mr-1 h-3 w-3" />
                            )}
                            Copy Link
                          </Button>
                        )}
                        {inv.status === 'approved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setBuddyTarget(inv); setBuddyPicked(null); setBuddySearch('') }}
                            className="h-7 px-2 text-xs gap-1"
                          >
                            <UserPlus className="h-3 w-3" />
                            {inv.buddy_employee_id ? 'Change Buddy' : 'Assign Buddy'}
                          </Button>
                        )}
                        {inv.status === 'approved' && inv.employee_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setAssetTarget(inv); setAssetPicked(new Set()) }}
                            className="h-7 px-2 text-xs gap-1"
                          >
                            <Package className="h-3 w-3" />
                            Assign Assets
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
                    <Check className="h-3.5 w-3.5 text-success" />
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
        onApprove={id => approveMutation.mutate({ id })}
        onReject={(id, notes) => rejectMutation.mutate({ id, notes })}
        approving={approveMutation.isPending}
        rejecting={rejectMutation.isPending}
      />

      {/* ── Buddy Assignment Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!buddyTarget} onOpenChange={v => { if (!v) { setBuddyTarget(null); setBuddySearch(''); setBuddyPicked(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-[#15B8A6]" />
              Assign Buddy — {buddyTarget?.first_name} {buddyTarget?.last_name}
            </DialogTitle>
            <DialogDescription>
              Select an employee to be the onboarding buddy. They'll receive an email with their responsibilities.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or employee code…"
                value={buddySearch}
                onChange={e => { setBuddySearch(e.target.value); setBuddyPicked(null) }}
                className="pl-9"
                autoFocus
              />
              {buddyFetching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Picked badge */}
            {buddyPicked && (
              <div className="flex items-center justify-between rounded-md border border-[#15B8A6]/40 bg-[#15B8A6]/5 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{buddyPicked.first_name} {buddyPicked.last_name}</p>
                  <p className="text-xs text-muted-foreground">{buddyPicked.employee_code}{buddyPicked.designation ? ` · ${buddyPicked.designation}` : ''}</p>
                </div>
                <button type="button" onClick={() => setBuddyPicked(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Suggestions list */}
            {buddySearch.length >= 2 && !buddyPicked && (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {buddyOptions.length === 0 && !buddyFetching && (
                  <p className="py-4 text-center text-sm text-muted-foreground">No employees found</p>
                )}
                {buddyOptions.map(emp => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => { setBuddyPicked(emp); setBuddySearch('') }}
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-sm font-medium">{emp.first_name} {emp.last_name}</p>
                    <p className="text-xs text-muted-foreground">{emp.employee_code}{emp.designation ? ` · ${emp.designation}` : ''}{emp.department ? ` · ${emp.department}` : ''}</p>
                  </button>
                ))}
              </div>
            )}

            {buddySearch.length < 2 && !buddyPicked && (
              <p className="text-xs text-muted-foreground text-center py-2">Type at least 2 characters to search employees</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setBuddyTarget(null); setBuddySearch(''); setBuddyPicked(null) }}>Cancel</Button>
            <Button
              onClick={() => buddyTarget && setBuddyMutation.mutate({ id: buddyTarget.id, buddy_employee_id: buddyPicked?.id ?? null })}
              disabled={!buddyPicked || setBuddyMutation.isPending}
              className="bg-[#15B8A6] hover:bg-[#0d9488] text-white"
            >
              {setBuddyMutation.isPending ? 'Assigning…' : 'Assign Buddy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Asset Assignment Dialog ─────────────────────────────────────────── */}
      <Dialog open={!!assetTarget} onOpenChange={v => { if (!v) { setAssetTarget(null); setAssetPicked(new Set()) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-[#2E6FE6]" />
              Assign Assets — {assetTarget?.first_name} {assetTarget?.last_name}
            </DialogTitle>
            <DialogDescription>
              Select available assets to assign. The assignment will be recorded in the asset ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="py-1">
            {assetsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading available assets…</span>
              </div>
            ) : availableAssets.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No available assets in inventory</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                {availableAssets.map(asset => {
                  const picked = assetPicked.has(asset.id)
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        const next = new Set(assetPicked)
                        picked ? next.delete(asset.id) : next.add(asset.id)
                        setAssetPicked(next)
                      }}
                      className={`w-full text-left px-3 py-2.5 transition-colors flex items-center gap-3 ${picked ? 'bg-[#2E6FE6]/5 border-l-2 border-[#2E6FE6]' : 'hover:bg-muted/40'}`}
                    >
                      <div className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center ${picked ? 'bg-[#2E6FE6] border-[#2E6FE6]' : 'border-border'}`}>
                        {picked && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{asset.name}</p>
                        <p className="text-xs text-muted-foreground">{asset.asset_code}{asset.serial_number ? ` · SN: ${asset.serial_number}` : ''}{asset.category_name ? ` · ${asset.category_name}` : ''}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {assetPicked.size > 0 && (
              <p className="text-xs text-[#2E6FE6] font-medium mt-2">{assetPicked.size} asset{assetPicked.size !== 1 ? 's' : ''} selected</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssetTarget(null); setAssetPicked(new Set()) }}>Cancel</Button>
            <Button
              onClick={handleAssignAssets}
              disabled={assetPicked.size === 0 || assignAssetMutation.isPending}
              className="bg-[#2E6FE6] hover:bg-[#2563eb] text-white"
            >
              {assignAssetMutation.isPending ? 'Assigning…' : `Assign ${assetPicked.size > 0 ? assetPicked.size + ' ' : ''}Asset${assetPicked.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── RH-01: Rehire Check Dialog ─────────────────────────────────────── */}
      <RehireCheckDialog
        data={rehireCheck}
        onClose={() => setRehireCheck(null)}
        onRehire={(invitationId, employeeId) =>
          approveMutation.mutate({ id: invitationId, action: 'rehire', employee_id: employeeId })
        }
        onNewEmployee={(invitationId) =>
          approveMutation.mutate({ id: invitationId, action: 'new_employee' })
        }
        isPending={approveMutation.isPending}
      />
    </Wrapper>
  )
}

