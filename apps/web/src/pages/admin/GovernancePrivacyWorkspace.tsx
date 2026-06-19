/**
 * GovernancePrivacyWorkspace — /admin/governance/privacy
 *
 * Program 3: Governance & Privacy Workspace.
 * Surfaces existing DB infrastructure as an operational workspace:
 *   – Compliance Controls catalog (SOC2, DPDPA, ISO 27001)
 *   – PII Access audit log
 *   – Erasure Requests (GDPR Art. 17 / DPDPA §12)
 *   – Privacy Health KPIs
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, FileX2, Eye, XCircle,
  Plus, Database, Activity,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrivacyHealth {
  erasure_requests: {
    open:         number
    breached_sla: number
    completed:    number
    total:        number
  }
  flagged_pii_access_30d: number
  control_health: {
    total:       number
    implemented: number
    verified:    number
    in_progress: number
    not_started: number
    waived:      number
  }
}

interface ComplianceControl {
  control_id:      string
  framework:       string
  category:        string
  control_text:    string
  implementation:  string
  status:          string
  owner:           string
  last_reviewed:   string | null
  next_review_date: string | null
  latest_evidence: {
    pass:           boolean
    snapshot_date:  string
    failure_reason: string | null
  } | null
}

interface PiiAccessLog {
  id:             number
  accessor_id:    string
  accessor_role:  string
  accessed_table: string
  accessed_fields: string[]
  access_purpose: string
  justification:  string | null
  record_count:   number | null
  accessed_at:    string
  flagged:        boolean
  flag_reason:    string | null
  source_ip:      string | null
}

interface ComplianceEvaluation {
  id:           string
  entity_type:  string
  entity_id:    string
  rule_id:      string | null
  compliant:    boolean
  severity:     string
  violations:   string[]
  evaluated_at: string
}

interface RetentionRun {
  id:                  string
  run_at:              string
  tables_scanned:      string[]
  records_evaluated:   number
  records_deleted:     number
  records_anonymized:  number
  records_retained:    number
  duration_ms:         number | null
  errors:              unknown[]
  triggered_by:        string
}

interface ErasureRequest {
  id:               string
  subject_email:    string | null
  subject_name:     string | null
  employee_id:      string | null
  requested_at:     string
  request_source:   string
  status:           string
  sla_deadline:     string | null
  sla_breached:     boolean
  rejection_reason: string | null
  completed_at:     string | null
  notes:            string | null
}

// ── Status configs ────────────────────────────────────────────────────────────

const CONTROL_STATUS: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  verified:    { label: 'Verified',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  implemented: { label: 'Implemented', color: 'bg-blue-50   text-blue-700   border-blue-200',     icon: CheckCircle2 },
  in_progress: { label: 'In Progress', color: 'bg-amber-50  text-amber-700  border-amber-200',    icon: Clock        },
  not_started: { label: 'Not Started', color: 'bg-gray-100  text-gray-600   border-gray-200',     icon: XCircle      },
  waived:      { label: 'Waived',      color: 'bg-purple-50 text-purple-700 border-purple-200',   icon: CheckCircle2 },
}

const ERASURE_STATUS: Record<string, { label: string; color: string }> = {
  pending:     { label: 'Pending',     color: 'bg-amber-50  text-amber-700  border-amber-200'  },
  in_progress: { label: 'In Progress', color: 'bg-blue-50   text-blue-700   border-blue-200'   },
  completed:   { label: 'Completed',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:    { label: 'Rejected',    color: 'bg-red-50    text-red-700    border-red-200'    },
  partial:     { label: 'Partial',     color: 'bg-orange-50 text-orange-700 border-orange-200' },
  on_hold:     { label: 'On Hold',     color: 'bg-gray-100  text-gray-600   border-gray-200'   },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GovernancePrivacyWorkspace() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('health')
  const [controlSearch, setControlSearch] = useState('')
  const [controlFramework, setControlFramework] = useState('all')
  const [piiPurpose, setPiiPurpose] = useState('all')
  const [piiFlag, setPiiFlag] = useState('all')
  const [erasureStatus, setErasureStatus] = useState('all')
  const [erasureModal, setErasureModal] = useState(false)
  const [erasureForm, setErasureForm] = useState({ subject_email: '', subject_name: '', request_source: 'hr_admin', notes: '' })
  const [updateModal, setUpdateModal] = useState<ErasureRequest | null>(null)
  const [updateForm, setUpdateForm] = useState({ status: '', notes: '' })
  const [evalCompliant, setEvalCompliant] = useState('all')
  const [evalSeverity,  setEvalSeverity]  = useState('all')
  const [retentionBy,   setRetentionBy]   = useState('all')

  // ── Queries ────────────────────────────────────────────────────────────────

  const healthQ = useQuery<PrivacyHealth>({
    queryKey: ['privacy-health'],
    queryFn:  () => api.get('/governance/privacy/health'),
  })

  const controlParams = new URLSearchParams({ limit: '200' })
  if (controlSearch)           controlParams.set('search', controlSearch)
  if (controlFramework !== 'all') controlParams.set('framework', controlFramework)

  const controlsQ = useQuery<{ data: ComplianceControl[]; total: number }>({
    queryKey: ['compliance-controls', controlSearch, controlFramework],
    queryFn:  () => api.get(`/governance/privacy/controls?${controlParams}`),
    enabled:  tab === 'controls',
  })

  const piiParams = new URLSearchParams({ limit: '100' })
  if (piiPurpose !== 'all') piiParams.set('purpose', piiPurpose)
  if (piiFlag    !== 'all') piiParams.set('flagged', piiFlag)

  const piiQ = useQuery<{ data: PiiAccessLog[]; total: number }>({
    queryKey: ['pii-access', piiPurpose, piiFlag],
    queryFn:  () => api.get(`/governance/privacy/pii-access?${piiParams}`),
    enabled:  tab === 'pii',
  })

  const erasureParams = new URLSearchParams({ limit: '100' })
  if (erasureStatus !== 'all') erasureParams.set('status', erasureStatus)

  const erasureQ = useQuery<{ data: ErasureRequest[]; total: number }>({
    queryKey: ['erasure-requests', erasureStatus],
    queryFn:  () => api.get(`/governance/privacy/erasure-requests?${erasureParams}`),
    enabled:  tab === 'erasure',
  })

  const evalParams = new URLSearchParams({ limit: '100' })
  if (evalCompliant !== 'all') evalParams.set('compliant', evalCompliant)
  if (evalSeverity  !== 'all') evalParams.set('severity',  evalSeverity)

  const evaluationsQ = useQuery<{ data: ComplianceEvaluation[]; total: number }>({
    queryKey: ['compliance-evaluations', evalCompliant, evalSeverity],
    queryFn:  () => api.get(`/governance/privacy/evaluations?${evalParams}`),
    enabled:  tab === 'evaluations',
  })

  const retentionParams = new URLSearchParams({ limit: '20' })
  if (retentionBy !== 'all') retentionParams.set('triggered_by', retentionBy)

  const retentionQ = useQuery<{ data: RetentionRun[]; total: number }>({
    queryKey: ['retention-runs', retentionBy],
    queryFn:  () => api.get(`/governance/privacy/retention-runs?${retentionParams}`),
    enabled:  tab === 'retention',
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createErasureMutation = useMutation({
    mutationFn: () => api.post('/governance/privacy/erasure-requests', {
      ...erasureForm,
      subject_email: erasureForm.subject_email || null,
      subject_name:  erasureForm.subject_name  || null,
      notes:         erasureForm.notes         || null,
    }),
    onSuccess: () => {
      toast.success('Erasure request created')
      setErasureModal(false)
      setErasureForm({ subject_email: '', subject_name: '', request_source: 'hr_admin', notes: '' })
      qc.invalidateQueries({ queryKey: ['erasure-requests'] })
      qc.invalidateQueries({ queryKey: ['privacy-health'] })
    },
    onError: () => toast.error('Failed to create erasure request'),
  })

  const updateErasureMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch(`/governance/privacy/erasure-requests/${id}`, {
        status: updateForm.status,
        notes:  updateForm.notes || null,
      }),
    onSuccess: () => {
      toast.success('Request updated')
      setUpdateModal(null)
      qc.invalidateQueries({ queryKey: ['erasure-requests'] })
      qc.invalidateQueries({ queryKey: ['privacy-health'] })
    },
    onError: () => toast.error('Update failed'),
  })

  const health = healthQ.data

  return (
    <PageContainer>
      <PageHeader
        title="Governance & Privacy"
        subtitle="Compliance controls, PII access audit, and data erasure requests"
        actions={
          <Button variant="ghost" size="sm" onClick={() => {
            qc.invalidateQueries({ queryKey: ['privacy-health'] })
            qc.invalidateQueries({ queryKey: ['compliance-controls'] })
            qc.invalidateQueries({ queryKey: ['pii-access'] })
            qc.invalidateQueries({ queryKey: ['erasure-requests'] })
            qc.invalidateQueries({ queryKey: ['compliance-evaluations'] })
            qc.invalidateQueries({ queryKey: ['retention-runs'] })
          }}>
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="health">Privacy Health</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="pii">PII Access Log</TabsTrigger>
          <TabsTrigger value="erasure">
            Erasure Requests
            {health?.erasure_requests.breached_sla ? (
              <span className="ml-1.5 h-4 w-4 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center">
                {health.erasure_requests.breached_sla}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
          <TabsTrigger value="retention">Retention Runs</TabsTrigger>
        </TabsList>

        {/* ── Health Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="health">
          {healthQ.isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
          ) : health ? (
            <div className="grid gap-4">
              {/* Erasure KPIs */}
              <SectionCard title="Data Erasure (GDPR / DPDPA)">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Open Requests',   value: health.erasure_requests.open,         color: health.erasure_requests.open > 0 ? 'text-amber-600' : 'text-foreground' },
                    { label: 'SLA Breached',    value: health.erasure_requests.breached_sla, color: health.erasure_requests.breached_sla > 0 ? 'text-red-600' : 'text-foreground' },
                    { label: 'Completed (All)', value: health.erasure_requests.completed,    color: 'text-emerald-600' },
                    { label: 'Total Requests',  value: health.erasure_requests.total,        color: 'text-foreground' },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg border p-3">
                      <p className={cn('text-2xl font-bold', k.color)}>{k.value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
                    </div>
                  ))}
                </div>
                {health.erasure_requests.breached_sla > 0 && (
                  <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">
                      <strong>{health.erasure_requests.breached_sla}</strong> erasure request{health.erasure_requests.breached_sla > 1 ? 's have' : ' has'} exceeded the 30-day SLA.
                      Review the Erasure Requests tab immediately.
                    </p>
                  </div>
                )}
              </SectionCard>

              {/* PII Access */}
              <SectionCard title="PII Access (Last 30 Days)">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className={cn('text-2xl font-bold', health.flagged_pii_access_30d > 0 ? 'text-red-600' : 'text-foreground')}>
                      {health.flagged_pii_access_30d}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Flagged Access Events</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-sm text-muted-foreground pt-1">
                      {health.flagged_pii_access_30d === 0
                        ? '✓ No anomalous PII access detected'
                        : 'Review flagged events in the PII Access Log tab'}
                    </p>
                  </div>
                </div>
              </SectionCard>

              {/* Control Health */}
              <SectionCard title="Compliance Controls">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Total Controls', value: health.control_health.total, color: 'text-foreground' },
                    { label: 'Verified',        value: health.control_health.verified,    color: 'text-emerald-600' },
                    { label: 'Implemented',     value: health.control_health.implemented, color: 'text-blue-600'    },
                    { label: 'In Progress',     value: health.control_health.in_progress, color: 'text-amber-600'   },
                    { label: 'Not Started',     value: health.control_health.not_started, color: health.control_health.not_started > 0 ? 'text-red-600' : 'text-foreground' },
                    { label: 'Waived',          value: health.control_health.waived,      color: 'text-purple-600'  },
                  ].map(k => (
                    <div key={k.label} className="rounded-lg border p-3">
                      <p className={cn('text-2xl font-bold', k.color)}>{k.value}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </div>
          ) : null}
        </TabsContent>

        {/* ── Controls Tab ──────────────────────────────────────────────────── */}
        <TabsContent value="controls">
          <SectionCard>
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search controls..."
                  className="pl-8 h-8 text-sm"
                  value={controlSearch}
                  onChange={e => setControlSearch(e.target.value)}
                />
              </div>
              <Select value={controlFramework} onValueChange={setControlFramework}>
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue placeholder="All frameworks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Frameworks</SelectItem>
                  <SelectItem value="SOC2">SOC 2</SelectItem>
                  <SelectItem value="DPDPA2023">DPDPA 2023</SelectItem>
                  <SelectItem value="ISO27001">ISO 27001</SelectItem>
                  <SelectItem value="Internal">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {controlsQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (
              <div className="divide-y divide-border">
                {(controlsQ.data?.data ?? []).map(c => {
                  const sm = CONTROL_STATUS[c.status]
                  return (
                    <div key={c.control_id} className="py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-mono font-bold text-muted-foreground">{c.control_id}</span>
                            <Badge variant="outline" className="text-[10px]">{c.framework}</Badge>
                            <Badge variant="outline" className="text-[10px] capitalize">{c.category.replace('_', ' ')}</Badge>
                            {sm && (
                              <Badge variant="outline" className={cn('text-[10px]', sm.color)}>
                                {sm.label}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1">{c.control_text}</p>
                          {c.implementation && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.implementation}</p>
                          )}
                        </div>
                        {c.latest_evidence && (
                          <div className={cn(
                            'flex-shrink-0 rounded-full h-6 w-6 flex items-center justify-center',
                            c.latest_evidence.pass ? 'bg-emerald-100' : 'bg-red-100',
                          )}>
                            {c.latest_evidence.pass
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                              : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── PII Access Log Tab ────────────────────────────────────────────── */}
        <TabsContent value="pii">
          <SectionCard>
            <div className="flex gap-3 mb-4">
              <Select value={piiPurpose} onValueChange={setPiiPurpose}>
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue placeholder="All purposes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Purposes</SelectItem>
                  <SelectItem value="payroll_run">Payroll Run</SelectItem>
                  <SelectItem value="hr_review">HR Review</SelectItem>
                  <SelectItem value="audit">Audit</SelectItem>
                  <SelectItem value="bulk_export">Bulk Export</SelectItem>
                  <SelectItem value="employee_self">Employee Self</SelectItem>
                  <SelectItem value="compliance_report">Compliance</SelectItem>
                  <SelectItem value="erasure_request">Erasure</SelectItem>
                </SelectContent>
              </Select>
              <Select value={piiFlag} onValueChange={setPiiFlag}>
                <SelectTrigger className="h-8 text-sm w-36">
                  <SelectValue placeholder="All events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="true">Flagged Only</SelectItem>
                  <SelectItem value="false">Normal Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {piiQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (piiQ.data?.data ?? []).length === 0 ? (
              <div className="py-12 text-center">
                <Eye className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No PII access log entries</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(piiQ.data?.data ?? []).map(e => (
                  <div key={e.id} className={cn('py-3 flex items-start gap-3', e.flagged && 'bg-red-50/30')}>
                    <div className={cn(
                      'mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0',
                      e.flagged ? 'bg-red-100' : 'bg-muted',
                    )}>
                      {e.flagged
                        ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        : <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{e.accessed_table}</span>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {e.access_purpose.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{e.accessor_role}</span>
                        {e.flagged && (
                          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                            Flagged
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {e.record_count != null && (
                          <span className="text-xs text-muted-foreground">{e.record_count} record{e.record_count !== 1 ? 's' : ''}</span>
                        )}
                        {e.accessed_fields.length > 0 && (
                          <span className="text-xs text-muted-foreground">{e.accessed_fields.slice(0, 3).join(', ')}{e.accessed_fields.length > 3 ? '…' : ''}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{format(new Date(e.accessed_at), 'dd MMM yyyy HH:mm')}</span>
                      </div>
                      {e.flag_reason && (
                        <p className="text-xs text-destructive mt-0.5">{e.flag_reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Erasure Requests Tab ──────────────────────────────────────────── */}
        <TabsContent value="erasure">
          <SectionCard>
            <div className="flex items-center justify-between mb-4">
              <Select value={erasureStatus} onValueChange={setErasureStatus}>
                <SelectTrigger className="h-8 text-sm w-36">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setErasureModal(true)}>
                <Plus className="h-4 w-4 mr-1.5" /> New Request
              </Button>
            </div>

            {erasureQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (erasureQ.data?.data ?? []).length === 0 ? (
              <div className="py-12 text-center">
                <FileX2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No erasure requests</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(erasureQ.data?.data ?? []).map(r => {
                  const sm = ERASURE_STATUS[r.status]
                  return (
                    <div key={r.id} className={cn('py-3.5 flex items-start gap-3', r.sla_breached && 'bg-red-50/30')}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{r.subject_name ?? r.subject_email ?? 'Unknown subject'}</p>
                          {sm && <Badge variant="outline" className={cn('text-[10px]', sm.color)}>{sm.label}</Badge>}
                          <Badge variant="outline" className="text-[10px] capitalize">{r.request_source.replace('_', ' ')}</Badge>
                          {r.sla_breached && (
                            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                              SLA Breached
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                          {r.subject_email && r.subject_name && <span>{r.subject_email}</span>}
                          <span>Requested {format(new Date(r.requested_at), 'dd MMM yyyy')}</span>
                          {r.sla_deadline && (
                            <span className={r.sla_breached ? 'text-red-600 font-medium' : ''}>
                              SLA: {format(new Date(r.sla_deadline), 'dd MMM yyyy')}
                            </span>
                          )}
                          {r.completed_at && <span>Completed {format(new Date(r.completed_at), 'dd MMM yyyy')}</span>}
                        </div>
                      </div>
                      {['pending','in_progress','on_hold'].includes(r.status) && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => { setUpdateModal(r); setUpdateForm({ status: '', notes: '' }) }}
                        >
                          Update
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Compliance Evaluations Tab ────────────────────────────────── */}
        <TabsContent value="evaluations">
          <SectionCard>
            <div className="flex gap-3 mb-4">
              <Select value={evalCompliant} onValueChange={setEvalCompliant}>
                <SelectTrigger className="h-8 text-sm w-36">
                  <SelectValue placeholder="All results" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Results</SelectItem>
                  <SelectItem value="false">Non-Compliant</SelectItem>
                  <SelectItem value="true">Compliant</SelectItem>
                </SelectContent>
              </Select>
              <Select value={evalSeverity} onValueChange={setEvalSeverity}>
                <SelectTrigger className="h-8 text-sm w-32">
                  <SelectValue placeholder="All severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
              {evaluationsQ.data && (
                <span className="ml-auto self-center text-xs text-muted-foreground">
                  {evaluationsQ.data.total} result{evaluationsQ.data.total !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {evaluationsQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (evaluationsQ.data?.data ?? []).length === 0 ? (
              <div className="py-12 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No evaluations found</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(evaluationsQ.data?.data ?? []).map(e => {
                  const sevColor = e.severity === 'critical' ? 'bg-red-50 text-red-700 border-red-200'
                    : e.severity === 'high'    ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : e.severity === 'warning' ? 'bg-amber-50  text-amber-700  border-amber-200'
                    :                            'bg-gray-100  text-gray-600   border-gray-200'
                  return (
                    <div key={e.id} className={cn('py-3 flex items-start gap-3', !e.compliant && 'bg-red-50/20')}>
                      <div className={cn('mt-0.5 h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0',
                        e.compliant ? 'bg-emerald-100' : 'bg-red-100')}>
                        {e.compliant
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          : <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium capitalize">{e.entity_type}</span>
                          <span className="text-xs font-mono text-muted-foreground">{e.entity_id.slice(0, 8)}</span>
                          {e.rule_id && <Badge variant="outline" className="text-[10px]">{e.rule_id}</Badge>}
                          <Badge variant="outline" className={cn('text-[10px] capitalize', sevColor)}>{e.severity}</Badge>
                          <Badge variant="outline" className={cn('text-[10px]',
                            e.compliant ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200')}>
                            {e.compliant ? 'Compliant' : 'Non-Compliant'}
                          </Badge>
                        </div>
                        {e.violations.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {e.violations.slice(0, 3).join(' · ')}{e.violations.length > 3 ? ` +${e.violations.length - 3} more` : ''}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(e.evaluated_at), 'dd MMM yyyy HH:mm')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── Retention Runs Tab ────────────────────────────────────────────── */}
        <TabsContent value="retention">
          <SectionCard>
            <div className="flex gap-3 mb-4">
              <Select value={retentionBy} onValueChange={setRetentionBy}>
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue placeholder="All triggers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Triggers</SelectItem>
                  <SelectItem value="scheduler">Scheduler</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="test">Test</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {retentionQ.isLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
            ) : (retentionQ.data?.data ?? []).length === 0 ? (
              <div className="py-12 text-center">
                <Database className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No retention runs recorded</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {(retentionQ.data?.data ?? []).map(r => {
                  const hasErrors = Array.isArray(r.errors) && r.errors.length > 0
                  return (
                    <div key={r.id} className={cn('py-3.5', hasErrors && 'bg-amber-50/30')}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {format(new Date(r.run_at), 'dd MMM yyyy HH:mm')}
                          </span>
                          <Badge variant="outline" className="text-[10px] capitalize">{r.triggered_by}</Badge>
                          {hasErrors && (
                            <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                              {r.errors.length} error{r.errors.length > 1 ? 's' : ''}
                            </Badge>
                          )}
                          {r.duration_ms != null && (
                            <span className="text-xs text-muted-foreground">{(r.duration_ms / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: 'Evaluated', value: r.records_evaluated, color: 'text-foreground' },
                          { label: 'Deleted',   value: r.records_deleted,   color: r.records_deleted   > 0 ? 'text-red-600'     : 'text-foreground' },
                          { label: 'Anonymized',value: r.records_anonymized,color: r.records_anonymized > 0 ? 'text-amber-600'   : 'text-foreground' },
                          { label: 'Retained',  value: r.records_retained,  color: 'text-emerald-600' },
                        ].map(k => (
                          <div key={k.label} className="rounded border p-2">
                            <p className={cn('text-sm font-semibold', k.color)}>{k.value.toLocaleString()}</p>
                            <p className="text-[10px] text-muted-foreground">{k.label}</p>
                          </div>
                        ))}
                      </div>
                      {r.tables_scanned.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Tables: {r.tables_scanned.join(', ')}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* New Erasure Request Dialog */}
      <Dialog open={erasureModal} onOpenChange={setErasureModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Erasure Request</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Subject Email</Label>
              <Input className="mt-1" value={erasureForm.subject_email} onChange={e => setErasureForm(f => ({ ...f, subject_email: e.target.value }))} placeholder="subject@example.com" />
            </div>
            <div>
              <Label>Subject Name</Label>
              <Input className="mt-1" value={erasureForm.subject_name} onChange={e => setErasureForm(f => ({ ...f, subject_name: e.target.value }))} />
            </div>
            <div>
              <Label>Source</Label>
              <Select value={erasureForm.request_source} onValueChange={v => setErasureForm(f => ({ ...f, request_source: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="subject">Data Subject</SelectItem>
                  <SelectItem value="hr_admin">HR Admin</SelectItem>
                  <SelectItem value="regulator">Regulator</SelectItem>
                  <SelectItem value="legal">Legal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input className="mt-1" value={erasureForm.notes} onChange={e => setErasureForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErasureModal(false)}>Cancel</Button>
            <Button disabled={createErasureMutation.isPending} onClick={() => createErasureMutation.mutate()}>
              {createErasureMutation.isPending ? 'Creating...' : 'Create Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Erasure Request Dialog */}
      <Dialog open={!!updateModal} onOpenChange={() => setUpdateModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Erasure Request</DialogTitle></DialogHeader>
          {updateModal && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">{updateModal.subject_name ?? updateModal.subject_email}</p>
              <div>
                <Label>New Status</Label>
                <Select value={updateForm.status} onValueChange={v => setUpdateForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Input className="mt-1" value={updateForm.notes} onChange={e => setUpdateForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateModal(null)}>Cancel</Button>
            <Button
              disabled={!updateForm.status || updateErasureMutation.isPending}
              onClick={() => updateModal && updateErasureMutation.mutate(updateModal.id)}
            >
              {updateErasureMutation.isPending ? 'Updating...' : 'Update'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
