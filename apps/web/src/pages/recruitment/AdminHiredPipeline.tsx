/**
 * AdminHiredPipeline — /admin/recruitment/hired
 *
 * Shows all hired candidates and their preboarding status.
 * Allows HR to initiate preboarding (creates pre-joinee invitation) with one click.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  UserCheck, ArrowRight, CheckCircle2,
  RefreshCw, Mail, Calendar, Briefcase,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { Label }         from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HiredApplication {
  id:                       string
  status:                   string
  offer_amount:             number | null
  expected_joining:         string | null
  preboarding_initiated_at: string | null
  pre_joinee_invitation_id: string | null
  created_at:               string
  updated_at:               string
  candidates: {
    id:            string
    first_name:    string
    last_name:     string
    email:         string
    phone:         string | null
    current_title: string | null
  } | null
  job_requisitions: {
    id:    string
    title: string
    departments: { name: string } | null
  } | null
  pre_joinee: {
    id:          string
    status:      string
    joining_date: string
    submitted_at: string | null
  } | null
}

const PRE_JOINEE_STATUS: Record<string, { label: string; className: string }> = {
  pending:   { label: 'Invitation Sent',  className: 'bg-info/10   text-info   border-info/30'   },
  submitted: { label: 'Form Submitted',   className: 'bg-warning/10  text-warning  border-warning/30'  },
  approved:  { label: 'Approved',         className: 'bg-success/10 text-success border-success/30' },
  rejected:  { label: 'Rejected',         className: 'bg-destructive/10    text-destructive    border-destructive/30'    },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminHiredPipeline() {
  const qc = useQueryClient()
  const [filter, setFilter]           = useState<'all' | 'pending' | 'initiated'>('all')
  const [modalOpen, setModalOpen]     = useState(false)
  const [targetApp, setTargetApp]     = useState<HiredApplication | null>(null)
  const [joiningDate, setJoiningDate] = useState('')
  const [designation, setDesignation] = useState('')
  const [dept, setDept]               = useState('')

  const params = new URLSearchParams({ preboarding_status: filter, limit: '100' })
  const { data, isLoading, refetch } = useQuery<{ data: HiredApplication[]; total: number }>({
    queryKey: ['recruitment', 'hired', filter],
    queryFn:  () => api.get(`/recruitment/hired?${params}`),
  })

  const initiateMutation = useMutation({
    mutationFn: (appId: string) =>
      api.post(`/recruitment/applications/${appId}/initiate-preboarding`, {
        joining_date: joiningDate,
        designation:  designation || null,
        department:   dept || null,
      }),
    onSuccess: () => {
      toast.success('Preboarding initiated — invitation email sent to candidate')
      setModalOpen(false)
      setTargetApp(null)
      qc.invalidateQueries({ queryKey: ['recruitment', 'hired'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Failed to initiate preboarding'),
  })

  function openModal(app: HiredApplication) {
    setTargetApp(app)
    setJoiningDate(app.expected_joining ?? '')
    setDesignation(app.job_requisitions?.title ?? '')
    setDept(app.job_requisitions?.departments?.name ?? '')
    setModalOpen(true)
  }

  const rows = data?.data ?? []
  const pending   = rows.filter(r => !r.pre_joinee_invitation_id).length
  const initiated = rows.filter(r => r.pre_joinee_invitation_id).length

  return (
    <PageContainer>
      <PageHeader
        title="Hired Pipeline"
        subtitle="Manage hired candidates and initiate preboarding"
        actions={
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Awaiting Preboarding', value: pending,   color: 'text-warning',   bg: 'bg-warning/10',   icon: AlertCircle },
          { label: 'Preboarding Sent',      value: initiated, color: 'text-info',    bg: 'bg-info/10',    icon: Mail        },
          { label: 'Total Hired',           value: rows.length, color: 'text-success', bg: 'bg-success/10', icon: UserCheck  },
        ].map(s => (
          <div key={s.label} className={cn('rounded-xl border p-4 flex items-center gap-3', s.bg)}>
            <div className={cn('h-8 w-8 rounded-full flex items-center justify-center bg-white/60')}>
              <s.icon className={cn('h-4 w-4', s.color)} />
            </div>
            <div>
              <p className={cn('text-xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <SectionCard>
        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(['all', 'pending', 'initiated'] as const).map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              onClick={() => setFilter(f)}
              className="capitalize"
            >
              {f === 'pending' ? 'Awaiting Preboarding' : f === 'initiated' ? 'Preboarding Sent' : 'All Hired'}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <UserCheck className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No hired candidates{filter !== 'all' ? ` in this filter` : ''}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map(app => {
              const cand = app.candidates
              const name = cand ? `${cand.first_name} ${cand.last_name}` : '—'
              const pj   = app.pre_joinee
              const statusMeta = pj ? PRE_JOINEE_STATUS[pj.status] : null

              return (
                <div key={app.id} className="py-3.5 flex items-center gap-4">
                  {/* Avatar */}
                  <div className="h-9 w-9 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-success">
                    {cand?.first_name?.[0] ?? '?'}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {cand?.email && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" /> {cand.email}
                        </span>
                      )}
                      {app.job_requisitions && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Briefcase className="h-3 w-3" /> {app.job_requisitions.title}
                          {app.job_requisitions.departments?.name && ` · ${app.job_requisitions.departments.name}`}
                        </span>
                      )}
                      {app.expected_joining && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          Joining {format(new Date(app.expected_joining), 'dd MMM yyyy')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Preboarding status */}
                  <div className="flex items-center gap-3">
                    {pj ? (
                      <div className="flex flex-col items-end gap-1">
                        {statusMeta && (
                          <Badge variant="outline" className={cn('text-[11px]', statusMeta.className)}>
                            {statusMeta.label}
                          </Badge>
                        )}
                        {app.preboarding_initiated_at && (
                          <span className="text-[10px] text-muted-foreground">
                            Sent {format(new Date(app.preboarding_initiated_at), 'dd MMM')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[11px]">
                        Preboarding Pending
                      </Badge>
                    )}

                    {!pj ? (
                      <Button
                        size="sm"
                        className="bg-success hover:bg-success/90 text-success-foreground gap-1.5"
                        onClick={() => openModal(app)}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Start Preboarding
                      </Button>
                    ) : (
                      <Link to="/admin/onboarding/pre-joinee">
                        <Button size="sm" variant="outline" className="gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          View Invitation
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Initiate Preboarding Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Preboarding</DialogTitle>
          </DialogHeader>

          {targetApp && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p className="font-medium">
                  {targetApp.candidates?.first_name} {targetApp.candidates?.last_name}
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {targetApp.candidates?.email} · {targetApp.job_requisitions?.title}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="joining_date">Joining Date *</Label>
                  <Input
                    id="joining_date"
                    type="date"
                    value={joiningDate}
                    onChange={e => setJoiningDate(e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="designation">Designation</Label>
                  <Input
                    id="designation"
                    value={designation}
                    onChange={e => setDesignation(e.target.value)}
                    placeholder={targetApp.job_requisitions?.title ?? 'e.g. Software Engineer'}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="dept">Department</Label>
                  <Input
                    id="dept"
                    value={dept}
                    onChange={e => setDept(e.target.value)}
                    placeholder={targetApp.job_requisitions?.departments?.name ?? 'e.g. Engineering'}
                    className="mt-1"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                This will create a pre-joinee invitation and send an email to{' '}
                <strong>{targetApp.candidates?.email}</strong> with a link to fill their joining form.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              disabled={!joiningDate || initiateMutation.isPending}
              onClick={() => targetApp && initiateMutation.mutate(targetApp.id)}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              {initiateMutation.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
