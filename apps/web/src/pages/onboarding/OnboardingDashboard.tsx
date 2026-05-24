import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users, Clock, AlertTriangle, CheckCircle2, XCircle,
  Plus, Search, Filter, Eye, Archive, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { StatCard } from '@/components/dashboard/StatCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OnboardingSession {
  id: string
  candidate_name: string | null
  status: string
  document_count: number
  avg_confidence: number | null
  assigned_to: string | null
  created_at: string
  tenant_id: string
}

interface OnboardingDashboardStats {
  total_sessions: number
  pending_review: number
  extraction_failed: number
  approved_this_month: number
  rejected: number
  draft_ready?: number
  active?: number
}

interface SessionsResponse {
  data: OnboardingSession[]
  total?: number
}

interface CreateSessionResponse {
  data: OnboardingSession
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  extracting: 'Extracting',
  draft_ready: 'Draft Ready',
  hr_review: 'HR Review',
  approval_pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  employee_created: 'Employee Created',
  archived: 'Archived',
}

type BadgeVariant = 'outline' | 'warning' | 'info' | 'success' | 'destructive' | 'secondary' | 'default'

function getStatusBadgeVariant(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    active: 'outline',
    extracting: 'warning',
    draft_ready: 'info',
    hr_review: 'warning',
    approval_pending: 'warning',
    approved: 'success',
    rejected: 'destructive',
    employee_created: 'success',
    archived: 'secondary',
  }
  return map[status] ?? 'outline'
}

function ConfidencePill({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>
  const pct = Math.round(score * 100)
  const cls =
    pct >= 85 ? 'text-success' :
    pct >= 60 ? 'text-warning' :
                'text-destructive'
  return <span className={`text-xs font-mono font-medium ${cls}`}>{pct}%</span>
}

// ── Status breakdown mini-chart ───────────────────────────────────────────────

function StatusBreakdown({ sessions }: { sessions: OnboardingSession[] }) {
  const counts: Record<string, number> = {}
  for (const s of sessions) {
    counts[s.status] = (counts[s.status] ?? 0) + 1
  }
  const total = sessions.length || 1
  const entries = Object.entries(counts).sort(([, a], [, b]) => b - a)

  return (
    <div className="space-y-2">
      {entries.map(([status, count]) => {
        const pct = Math.round((count / total) * 100)
        const variant = getStatusBadgeVariant(status)
        return (
          <div key={status} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <Badge variant={variant} className="text-[10px] px-1.5 py-0">
                  {STATUS_LABELS[status] ?? status}
                </Badge>
                <span className="text-xs text-muted-foreground">{count}</span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    variant === 'success' ? 'bg-success' :
                    variant === 'warning' ? 'bg-warning' :
                    variant === 'destructive' ? 'bg-destructive' :
                    variant === 'info' ? 'bg-info' :
                    'bg-muted-foreground/40'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        )
      })}
      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No sessions yet</p>
      )}
    </div>
  )
}

// ── New Onboarding Dialog ─────────────────────────────────────────────────────

interface NewOnboardingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (sessionId: string) => void
}

function NewOnboardingDialog({ open, onOpenChange, onCreated }: NewOnboardingDialogProps) {
  const [candidateName, setCandidateName] = useState('')
  const [assignedTo, setAssignedTo] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      api.post<CreateSessionResponse>('/onboarding/sessions', {
        candidate_name: candidateName.trim() || null,
        assigned_to: assignedTo.trim() || null,
      }),
    onSuccess: (resp) => {
      onCreated(resp.data.id)
      setCandidateName('')
      setAssignedTo('')
      onOpenChange(false)
      toast.success('Onboarding session created', { description: candidateName.trim() || 'Unnamed candidate' })
    },
    onError: (e: Error) => toast.error('Failed to create session', { description: e.message }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Onboarding Session</DialogTitle>
          <DialogDescription>
            Start an AI-assisted onboarding session. Upload documents after creation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="candidate-name">Candidate Name</Label>
            <Input
              id="candidate-name"
              placeholder="e.g. Priya Sharma (optional)"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Can be added or updated later from the review workspace.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assigned-to">Assign To</Label>
            <Input
              id="assigned-to"
              placeholder="e.g. hr@company.com (optional)"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create & Open'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function OnboardingDashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: statsData, isLoading: statsLoading } = useQuery<{ data: OnboardingDashboardStats }>({
    queryKey: ['onboarding-dashboard'],
    queryFn: () => api.get('/onboarding/dashboard'),
    staleTime: 60_000,
  })

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<SessionsResponse>({
    queryKey: ['onboarding-sessions', statusFilter],
    queryFn: () =>
      api.get(
        `/onboarding/sessions${statusFilter !== 'all' ? `?status=${statusFilter}` : '?limit=50'}`
      ),
    staleTime: 30_000,
  })

  const { mutate: archiveSession, variables: archivingId } = useMutation({
    mutationFn: (id: string) => api.delete(`/onboarding/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-sessions'] })
      qc.invalidateQueries({ queryKey: ['onboarding-dashboard'] })
      toast.success('Session archived')
    },
    onError: (e: Error) => toast.error('Failed to archive session', { description: e.message }),
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

  const stats = statsData?.data
  const sessions = sessionsData?.data ?? []

  const filtered = sessions.filter((s) => {
    if (!search.trim()) return true
    const name = s.candidate_name?.toLowerCase() ?? ''
    return name.includes(search.toLowerCase())
  })

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Employee Onboarding"
        subtitle="AI-assisted document-driven onboarding"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['onboarding-sessions'] })
                qc.invalidateQueries({ queryKey: ['onboarding-dashboard'] })
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setNewDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Onboarding
            </Button>
          </div>
        }
      />

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total Sessions"
          value={statsLoading ? '—' : (stats?.total_sessions ?? 0)}
          icon={Users}
          iconColor="text-foreground"
          iconBg="bg-muted"
        />
        <StatCard
          title="Pending Review"
          value={statsLoading ? '—' : (stats?.pending_review ?? 0)}
          icon={Clock}
          iconColor="text-warning"
          iconBg="bg-warning/10"
        />
        <StatCard
          title="Extraction Failed"
          value={statsLoading ? '—' : (stats?.extraction_failed ?? 0)}
          icon={AlertTriangle}
          iconColor="text-destructive"
          iconBg="bg-destructive/10"
        />
        <StatCard
          title="Approved This Month"
          value={statsLoading ? '—' : (stats?.approved_this_month ?? 0)}
          icon={CheckCircle2}
          iconColor="text-success"
          iconBg="bg-success/10"
        />
        <StatCard
          title="Rejected"
          value={statsLoading ? '—' : (stats?.rejected ?? 0)}
          icon={XCircle}
          iconColor="text-muted-foreground"
          iconBg="bg-muted"
        />
      </div>

      {/* ── Main two-column area ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Sessions Table (2/3) ───────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search candidate…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44 h-9">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="extracting">Extracting</SelectItem>
                  <SelectItem value="draft_ready">Draft Ready</SelectItem>
                  <SelectItem value="hr_review">HR Review</SelectItem>
                  <SelectItem value="approval_pending">Pending Approval</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="employee_created">Employee Created</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Table */}
          <SectionCard
            noPadding
            description={
              !sessionsLoading
                ? `${filtered.length} session${filtered.length !== 1 ? 's' : ''}`
                : undefined
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['Candidate', 'Status', 'Documents', 'Confidence', 'Assigned To', 'Created', 'Actions'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border animate-pulse">
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 bg-muted rounded w-20" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                        {search || statusFilter !== 'all'
                          ? 'No sessions match your filters.'
                          : 'No onboarding sessions yet. Click "New Onboarding" to get started.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((session) => (
                      <tr
                        key={session.id}
                        className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate(`/admin/onboarding/${session.id}/review`)}
                      >
                        {/* Candidate */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div
                            className="font-medium text-foreground cursor-pointer hover:text-primary transition-colors"
                            onClick={() => navigate(`/admin/onboarding/${session.id}/review`)}
                          >
                            {session.candidate_name ?? (
                              <span className="text-muted-foreground italic">Unnamed</span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                            {session.id.slice(0, 8)}…
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Badge variant={getStatusBadgeVariant(session.status)} className="text-[10px] whitespace-nowrap">
                            {STATUS_LABELS[session.status] ?? session.status}
                          </Badge>
                        </td>

                        {/* Documents */}
                        <td className="px-4 py-3 text-sm text-center" onClick={(e) => e.stopPropagation()}>
                          <span className="text-muted-foreground">
                            {session.document_count ?? 0}
                          </span>
                        </td>

                        {/* Confidence */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <ConfidencePill score={session.avg_confidence ?? null} />
                        </td>

                        {/* Assigned To */}
                        <td className="px-4 py-3 text-sm text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          {session.assigned_to ?? '—'}
                        </td>

                        {/* Created */}
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {formatDate(session.created_at)}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2"
                              onClick={() => navigate(`/admin/onboarding/${session.id}/review`)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              Review
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                              disabled={archivingId === session.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                archiveSession(session.id)
                              }}
                            >
                              <Archive className="h-3.5 w-3.5 mr-1" />
                              {archivingId === session.id ? '…' : 'Archive'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>

        {/* ── Right column (1/3) ────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Quick Stats */}
          <SectionCard title="Quick Stats" icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">Draft Ready</span>
                <Badge variant="info" className="text-[10px]">
                  {stats?.draft_ready ?? sessions.filter(s => s.status === 'draft_ready').length}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">In HR Review</span>
                <Badge variant="warning" className="text-[10px]">
                  {stats?.pending_review ?? sessions.filter(s => s.status === 'hr_review').length}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">Extraction Failed</span>
                <Badge variant="destructive" className="text-[10px]">
                  {stats?.extraction_failed ?? sessions.filter(s => s.status === 'extracting').length}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">Employees Created</span>
                <Badge variant="success" className="text-[10px]">
                  {sessions.filter(s => s.status === 'employee_created').length}
                </Badge>
              </div>
            </div>
          </SectionCard>

          {/* Status Breakdown */}
          <SectionCard title="Status Breakdown">
            <StatusBreakdown sessions={sessions} />
          </SectionCard>

          {/* Tips */}
          <SectionCard title="Workflow Guide">
            <ol className="space-y-2 text-xs text-muted-foreground list-none">
              {[
                'Create a new session for the candidate.',
                'Upload documents (Aadhaar, PAN, resume, etc.).',
                'Run AI extraction to parse all fields.',
                'Review the draft profile and resolve conflicts.',
                'Run validation, then approve to create the employee.',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>

      {/* ── New Onboarding Dialog ────────────────────────────────────────────── */}
      <NewOnboardingDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={(id) => navigate(`/admin/onboarding/${id}/review`)}
      />
    </PageContainer>
  )
}
