/**
 * Letter Generation Module — Admin Page
 *
 * Tabs:
 *  1. Templates       — list / create / edit Handlebars templates + approval chains
 *  2. Generate        — 3-step wizard: select employee → preview → confirm & generate
 *  3. Approval Inbox  — letters awaiting approval from this user
 *  4. All Letters     — master list of every letter (any status)
 *  5. ESS Requests    — pending employee requests (fulfill / reject)
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, Eye, CheckCircle2, XCircle,
  Send, RefreshCw, ChevronRight,
  BookOpen, Wand2, ClipboardList, Star, Inbox,
  AlertTriangle, Clock, BadgeCheck, MoreHorizontal, Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { cn } from '@/lib/utils'
import { SubTabs } from '@/components/ui/SubTabs'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button }             from '@/components/ui/button'
import { Input }              from '@/components/ui/input'

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label }    from '@/components/ui/label'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { sanitizeHtml } from '@/lib/sanitize'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LetterTemplate {
  id: string
  name: string
  code: string
  category: 'hr_initiated' | 'ess_requestable'
  letter_type: string
  subject_template: string
  body_html: string
  variables: { key: string; label: string; required: boolean }[]
  requires_approval: boolean
  approval_levels: number
  is_active: boolean
  approval_chains?: { level: number; approver_role: string; label: string }[]
}

interface GeneratedLetter {
  id: string
  subject: string
  approval_status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'issued'
  current_level: number
  issued_at: string | null
  created_at: string
  missing_vars: string[]
  template: { name: string; letter_type: string; category: string }
  employee: { full_name: string; employee_code: string; designation: string }
  body_html?: string
  variable_values?: Record<string, string>
}

interface EssRequest {
  id: string
  reason: string
  status: 'pending' | 'processing' | 'fulfilled' | 'rejected'
  requested_at: string
  processed_at: string | null
  rejection_reason: string | null
  template: { name: string; letter_type: string }
  employee: { full_name: string; employee_code: string; designation: string; departments?: { name: string } }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d.length === 10 ? d + 'T12:00:00Z' : d)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(dt.getTime())) return '—'
  return `${String(dt.getUTCDate()).padStart(2,'0')}-${M[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:            { label: 'Draft',           cls: 'bg-muted text-muted-foreground' },
    pending_approval: { label: 'Pending Approval', cls: 'bg-warning/15 text-warning' },
    approved:         { label: 'Approved',         cls: 'bg-success/15 text-success' },
    rejected:         { label: 'Rejected',         cls: 'bg-destructive/15 text-destructive' },
    issued:           { label: 'Issued',           cls: 'bg-primary/15 text-primary' },
    pending:          { label: 'Pending',          cls: 'bg-warning/15 text-warning' },
    fulfilled:        { label: 'Fulfilled',        cls: 'bg-success/15 text-success' },
  }
  const m = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground' }
  return (
    <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full', m.cls)}>
      {m.label}
    </span>
  )
}

const LETTER_TYPES = [
  { value: 'offer',          label: 'Offer Letter' },
  { value: 'appointment',    label: 'Appointment Letter' },
  { value: 'confirmation',   label: 'Confirmation Letter' },
  { value: 'increment',      label: 'Increment Letter' },
  { value: 'relieving',      label: 'Relieving Letter' },
  { value: 'experience',     label: 'Experience Certificate' },
  { value: 'salary',         label: 'Salary Certificate' },
  { value: 'warning',        label: 'Warning Letter' },
  { value: 'custom',         label: 'Custom' },
]

const COMMON_VARS = [
  '{{employee_name}}', '{{employee_code}}', '{{designation}}', '{{department}}',
  '{{date_of_joining}}', '{{gross_salary}}', '{{net_salary}}', '{{basic_salary}}',
  '{{today}}', '{{current_date}}', '{{years_of_service}}',
  '{{address_line1}}', '{{city}}', '{{state}}', '{{pan_number}}',
]

// ── Table primitives ──────────────────────────────────────────────────────────

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn('text-left text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wide px-3 py-2.5 whitespace-nowrap', className)}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={cn('px-3 py-2.5 text-[13px] text-foreground/85', className)}>
      {children}
    </td>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function Empty({ icon: Icon, message }: { icon: React.ComponentType<{className?:string}>; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/50 gap-2">
      <Icon className="h-8 w-8" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Template Editor Dialog ────────────────────────────────────────────────────

function TemplateEditorDialog({
  template,
  onClose,
}: {
  template?: LetterTemplate | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const isEdit = !!template

  const [name,           setName]           = useState(template?.name ?? '')
  const [code,           setCode]           = useState(template?.code ?? '')
  const [category,       setCategory]       = useState(template?.category ?? 'hr_initiated')
  const [letterType,     setLetterType]     = useState(template?.letter_type ?? 'custom')
  const [subjectTmpl,    setSubjectTmpl]    = useState(template?.subject_template ?? '')
  const [bodyHtml,       setBodyHtml]       = useState(template?.body_html ?? '')
  const [reqApproval,    setReqApproval]    = useState(template?.requires_approval ?? false)
  const [approvalLevels, setApprovalLevels] = useState(template?.approval_levels ?? 1)
  const [chain, setChain]  = useState<{level:number;approver_role:string;label:string}[]>(
    template?.approval_chains ?? []
  )
  const [saving, setSaving] = useState(false)

  function insertVar(v: string) {
    setBodyHtml(prev => prev + v)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        name, code, category, letter_type: letterType,
        subject_template: subjectTmpl, body_html: bodyHtml,
        requires_approval: reqApproval, approval_levels: approvalLevels,
        approval_chain: reqApproval ? chain : [],
      }
      if (isEdit) {
        await api.put(`/letters/templates/${template!.id}`, payload)
      } else {
        await api.post('/letters/templates', payload)
      }
      qc.invalidateQueries({ queryKey: ['letter-templates'] })
      onClose()
    } catch (err) {
      toast.error('Failed to save template', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Template' : 'New Letter Template'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 mt-2">
          {/* Left — metadata */}
          <div className="col-span-1 space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Template Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Offer Letter" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Code * (unique)</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toLowerCase().replace(/\s+/g, '_'))} placeholder="offer_letter" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Letter Type *</Label>
              <Select value={letterType} onValueChange={setLetterType}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LETTER_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={v => setCategory(v as 'hr_initiated' | 'ess_requestable')}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hr_initiated"   className="text-xs">HR Initiated</SelectItem>
                  <SelectItem value="ess_requestable" className="text-xs">ESS Requestable</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Approval */}
            <div className="border rounded-md p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="req-approval"
                  checked={reqApproval}
                  onChange={e => setReqApproval(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="req-approval" className="text-xs font-medium">Requires Approval</label>
              </div>
              {reqApproval && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Approval Levels</Label>
                    <Select value={String(approvalLevels)} onValueChange={v => setApprovalLevels(Number(v))}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1,2,3].map(n => <SelectItem key={n} value={String(n)} className="text-xs">Level {n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {Array.from({ length: approvalLevels }, (_, i) => {
                    const row = chain.find(c => c.level === i + 1) ?? { level: i+1, approver_role: 'hr_admin', label: `Level ${i+1}` }
                    return (
                      <div key={i} className="space-y-1">
                        <Label className="text-xs">Level {i+1} Role</Label>
                        <Select
                          value={row.approver_role}
                          onValueChange={v => {
                            const newChain = [...chain.filter(c => c.level !== i+1), { level: i+1, approver_role: v, label: row.label }]
                            setChain(newChain.sort((a,b) => a.level - b.level))
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hr_admin"    className="text-xs">HR Admin</SelectItem>
                            <SelectItem value="manager"     className="text-xs">Manager</SelectItem>
                            <SelectItem value="super_admin" className="text-xs">Super Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </>
              )}
            </div>

            {/* Variable quick-insert */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Quick Insert Variables</Label>
              <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                {COMMON_VARS.map(v => (
                  <button
                    key={v}
                    onClick={() => insertVar(v)}
                    className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 hover:bg-primary/20 transition-colors font-mono"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right — editor */}
          <div className="col-span-2 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Subject Line (supports variables)</Label>
              <Input
                value={subjectTmpl}
                onChange={e => setSubjectTmpl(e.target.value)}
                placeholder="e.g. Offer Letter – {{employee_name}}"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Letter Body (HTML + Handlebars)</Label>
              <textarea
                value={bodyHtml}
                onChange={e => setBodyHtml(e.target.value)}
                rows={22}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                placeholder={`<p>Dear {{employee_name}},</p>\n\n<p>We are pleased to confirm your appointment as <strong>{{designation}}</strong>...</p>`}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name || !code || !letterType}>
            {saving ? 'Saving…' : isEdit ? 'Update Template' : 'Create Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Generate Letter Dialog (3-step wizard) ────────────────────────────────────

function GenerateLetterDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<1|2|3>(1)
  const [templateId, setTemplateId]   = useState('')
  const [employeeId, setEmployeeId]   = useState('')
  const [extraVars, setExtraVars]     = useState<Record<string,string>>({})
  const [generated, setGenerated]     = useState<GeneratedLetter | null>(null)
  const [generating, setGenerating]   = useState(false)
  const [submitting, setSubmitting]   = useState(false)

  const { data: tmplData } = useQuery({
    queryKey: ['letter-templates-active'],
    queryFn: () => api.get<{ data: LetterTemplate[] }>('/letters/templates?active=true'),
  })
  const templates = tmplData?.data ?? []
  const selectedTemplate = templates.find(t => t.id === templateId)

  const { data: varData } = useQuery({
    queryKey: ['letter-vars', employeeId],
    queryFn: () => api.get<{ data: Record<string, string> }>(`/letters/variables/${employeeId}`),
    enabled: !!employeeId,
  })
  const resolvedVars = varData?.data ?? {}

  async function generate() {
    setGenerating(true)
    try {
      const res = await api.post<{ data: GeneratedLetter; missing_vars: string[] }>('/letters/generate', {
        template_id: templateId, employee_id: employeeId, extra_vars: extraVars,
      })
      setGenerated(res.data)
      setStep(3)
      // ESS's letters list reads the same generated/issued letters under
      // ['ess-my-letters'] — invalidate alongside the admin list so an
      // employee sees it without a manual refresh.
      qc.invalidateQueries({ queryKey: ['letters-issued'] })
      qc.invalidateQueries({ queryKey: ['ess-my-letters'] })
    } catch (err) {
      toast.error('Failed to generate letter', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setGenerating(false)
    }
  }

  async function submitForApproval() {
    if (!generated) return
    setSubmitting(true)
    try {
      await api.post(`/letters/issued/${generated.id}/submit-for-approval`, {})
      qc.invalidateQueries({ queryKey: ['letters-issued'] })
      qc.invalidateQueries({ queryKey: ['ess-my-letters'] })
      onClose()
    } catch (err) {
      toast.error('Failed to submit for approval', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  async function issueNow() {
    if (!generated) return
    setSubmitting(true)
    try {
      await api.post(`/letters/issued/${generated.id}/issue`, {})
      qc.invalidateQueries({ queryKey: ['letters-issued'] })
      qc.invalidateQueries({ queryKey: ['ess-my-letters'] })
      onClose()
    } catch (err) {
      toast.error('Failed to issue letter', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate Letter</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          {['Select Template & Employee', 'Preview & Fill Gaps', 'Confirm & Issue'].map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                step > i + 1 ? 'bg-primary text-primary-foreground'
                  : step === i + 1 ? 'bg-primary/20 text-primary ring-1 ring-primary'
                  : 'bg-muted text-muted-foreground'
              )}>{i + 1}</div>
              <span className={step === i + 1 ? 'text-foreground font-medium' : ''}>{s}</span>
              {i < 2 && <ChevronRight className="h-3 w-3" />}
            </div>
          ))}
        </div>

        {/* Step 1: Select */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Letter Template *</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                      {t.requires_approval && <span className="ml-1 text-warning">(requires approval)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Employee *</Label>
              <EmployeeSelector
                value={employeeId}
                onChange={(v) => setEmployeeId(typeof v === 'string' ? v : (v[0] ?? ''))}
                placeholder="Search employee by name or code…"
                className="w-full"
              />
            </div>
          </div>
        )}

        {/* Step 2: Preview + fill gaps */}
        {step === 2 && selectedTemplate && (
          <div className="space-y-4">
            {/* Show resolved variables */}
            <div className="border rounded-md p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Auto-resolved Variables</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-h-32 overflow-y-auto">
                {Object.entries(resolvedVars).filter(([,v]) => v).map(([k,v]) => (
                  <div key={k} className="flex items-center gap-1 text-xs">
                    <span className="font-mono text-primary/70">{`{{${k}}}`}</span>
                    <span className="text-muted-foreground truncate">= {v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Extra/override variables */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fill / Override Variables</p>
              {(selectedTemplate.variables ?? []).filter((v) => !resolvedVars[v.key] || v.key in extraVars).map(v => (
                <div key={v.key} className="flex items-center gap-2">
                  <Label className="text-xs w-40 text-right shrink-0">{v.label}</Label>
                  <Input
                    value={extraVars[v.key] ?? ''}
                    onChange={e => setExtraVars(prev => ({ ...prev, [v.key]: e.target.value }))}
                    placeholder={resolvedVars[v.key] ?? `Enter ${v.label}…`}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
              {(selectedTemplate.variables ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">All variables will be auto-resolved from employee data.</p>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && generated && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              Letter generated successfully
            </div>
            {generated.missing_vars.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/25 rounded-md text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <strong>Missing variables:</strong> {generated.missing_vars.join(', ')} — these will appear blank in the letter.
                </div>
              </div>
            )}
            <div className="border rounded-md p-3 space-y-1 text-xs">
              <div><span className="text-muted-foreground">Subject:</span> {generated.subject}</div>
              <div><span className="text-muted-foreground">Status:</span> {statusBadge(generated.approval_status)}</div>
            </div>
            <div
              className="border rounded-md p-4 text-xs prose prose-sm max-w-none max-h-48 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(generated.body_html) }}
            />
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => setStep(2)} disabled={!templateId || !employeeId}>
                Next: Preview
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={generate} disabled={generating}>
                {generating ? 'Generating…' : 'Generate Letter'}
              </Button>
            </>
          )}
          {step === 3 && generated && (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              {selectedTemplate?.requires_approval ? (
                <Button onClick={submitForApproval} disabled={submitting}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  {submitting ? 'Submitting…' : 'Submit for Approval'}
                </Button>
              ) : (
                <Button onClick={issueNow} disabled={submitting}>
                  <BadgeCheck className="h-3.5 w-3.5 mr-1.5" />
                  {submitting ? 'Issuing…' : 'Issue to Employee'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Letter Detail Dialog ───────────────────────────────────────────────────────

function LetterDetailDialog({
  letterId,
  onClose,
}: {
  letterId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [comment, setComment]   = useState('')
  const [acting, setActing]     = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['letter-detail', letterId],
    queryFn: () => api.get<{ data: GeneratedLetter & {
      template: LetterTemplate & { approval_chains: { level: number; approver_role: string; label: string }[] }
      approval_log: { level: number; action: string; comments: string; acted_at: string; actor: { full_name: string } }[]
    }}>(`/letters/issued/${letterId}`),
  })
  const letter = data?.data

  async function act(action: 'approve' | 'reject' | 'issue') {
    setActing(true)
    try {
      if (action === 'approve') await api.post(`/letters/issued/${letterId}/approve`, { comments: comment })
      if (action === 'reject')  await api.post(`/letters/issued/${letterId}/reject`,  { comments: comment })
      if (action === 'issue')   await api.post(`/letters/issued/${letterId}/issue`, {})
      qc.invalidateQueries({ queryKey: ['letters-issued'] })
      qc.invalidateQueries({ queryKey: ['letter-detail', letterId] })
      qc.invalidateQueries({ queryKey: ['ess-my-letters'] })
      onClose()
    } catch (err) {
      toast.error(`Failed to ${action} letter`, { description: err instanceof Error ? err.message : undefined })
    } finally {
      setActing(false)
    }
  }

  const chains = letter?.template?.approval_chains ?? []
  const log    = letter?.approval_log ?? []

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Letter Detail
            {letter && statusBadge(letter.approval_status)}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : letter ? (
          <div className="space-y-4">
            {/* Meta */}
            <div className="grid grid-cols-3 gap-3 text-xs border rounded-md p-3">
              <div><span className="text-muted-foreground">Employee:</span> {letter.employee?.full_name}</div>
              <div><span className="text-muted-foreground">Code:</span> {letter.employee?.employee_code}</div>
              <div><span className="text-muted-foreground">Type:</span> {letter.template?.letter_type}</div>
              <div><span className="text-muted-foreground">Created:</span> {fmt(letter.created_at)}</div>
              <div><span className="text-muted-foreground">Issued:</span> {fmt(letter.issued_at)}</div>
              {letter.missing_vars?.length > 0 && (
                <div className="col-span-3 text-warning flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Missing: {letter.missing_vars.join(', ')}
                </div>
              )}
            </div>

            {/* Body preview */}
            <div
              className="border rounded-md p-4 text-xs prose prose-sm max-w-none max-h-52 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(letter.body_html) }}
            />

            {/* Approval chain */}
            {chains.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Approval Chain</p>
                <div className="flex items-center gap-2">
                  {chains.map((c, i) => {
                    const done    = log.find(l => l.level === c.level && l.action === 'approved')
                    const current = letter.current_level === c.level && letter.approval_status === 'pending_approval'
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <div className={cn(
                          'flex flex-col items-center gap-0.5 p-2 border rounded-md text-[10px] min-w-[80px] text-center',
                          done    && 'border-success/40 bg-success/5 text-success',
                          current && 'border-warning/40 bg-warning/5 text-warning',
                          !done && !current && 'border-border text-muted-foreground',
                        )}>
                          {done    ? <CheckCircle2 className="h-3 w-3" /> : current ? <Clock className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border-2 border-current" />}
                          <span>L{c.level}</span>
                          <span className="font-medium">{c.label}</span>
                        </div>
                        {i < chains.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Approval log */}
            {log.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Activity Log</p>
                <div className="space-y-1">
                  {log.map((entry, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <div className={cn(
                        'w-1.5 h-1.5 rounded-full mt-1 shrink-0',
                        entry.action === 'approved' ? 'bg-success'
                          : entry.action === 'rejected' ? 'bg-destructive'
                          : 'bg-muted-foreground'
                      )} />
                      <div className="flex-1">
                        <span className="font-medium">{entry.actor?.full_name}</span>
                        <span className="text-muted-foreground"> {entry.action} at level {entry.level}</span>
                        {entry.comments && <span className="text-muted-foreground"> — "{entry.comments}"</span>}
                      </div>
                      <span className="text-muted-foreground">{fmt(entry.acted_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action bar */}
            {letter.approval_status === 'pending_approval' && (
              <div className="border-t pt-3 space-y-2">
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Comments (optional)…"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => act('reject')} disabled={acting} className="text-destructive border-destructive/40 hover:bg-destructive/10">
                    <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
                  </Button>
                  <Button size="sm" onClick={() => act('approve')} disabled={acting}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
                  </Button>
                </div>
              </div>
            )}
            {letter.approval_status === 'approved' && (
              <div className="flex justify-end pt-2">
                <Button size="sm" onClick={() => act('issue')} disabled={acting}>
                  <BadgeCheck className="h-3.5 w-3.5 mr-1.5" /> Issue to Employee
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">Letter not found</div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

type Tab = 'templates' | 'generate' | 'approval-inbox' | 'all-letters' | 'ess-requests'

export function LettersAdmin() {
  const qc = useQueryClient()
  const [tab,         setTab]         = useState<Tab>('templates')
  const [search,      setSearch]      = useState('')
  const [editTmpl,    setEditTmpl]    = useState<LetterTemplate | null | undefined>(undefined) // undefined = closed
  const [showGenerate, setShowGenerate] = useState(false)
  const [detailId,    setDetailId]    = useState<string | null>(null)

  // ── Templates ──────────────────────────────────────────────────────────────
  const { data: tmplData, isLoading: tmplLoading, refetch: refetchTmpl } = useQuery({
    queryKey: ['letter-templates'],
    queryFn: () => api.get<{ data: LetterTemplate[] }>('/letters/templates'),
    staleTime: 60_000,
  })
  const templates = (tmplData?.data ?? []).filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.letter_type.includes(search)
  )

  const toggleActive = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`/letters/templates/${id}`, { is_active }),
    onSuccess: (_data, { is_active }) => {
      qc.invalidateQueries({ queryKey: ['letter-templates'] })
      toast.success(`Template ${is_active ? 'activated' : 'deactivated'}`)
    },
    onError: (e: Error) => toast.error('Failed to update template status', { description: e.message }),
  })

  const seedTemplates = useMutation<{ data: { created: number; skipped: number } }, Error>({
    mutationFn: () => api.post('/letters/templates/seed-standard', {}),
    onSuccess: (res) => {
      const { created, skipped } = res.data
      toast.success('Standard letter templates loaded', {
        description: created > 0
          ? `${created} added${skipped > 0 ? `, ${skipped} already existed` : ''}. Edit wording/branding as needed.`
          : 'All standard templates already exist.',
      })
      qc.invalidateQueries({ queryKey: ['letter-templates'] })
    },
    onError: (e: Error) => toast.error('Failed to load standard templates', { description: e.message }),
  })

  // ── All Letters ────────────────────────────────────────────────────────────
  const [letterStatus, setLetterStatus] = useState('all')
  const { data: lettersData, isLoading: lettersLoading, refetch: refetchLetters } = useQuery({
    queryKey: ['letters-issued', letterStatus],
    queryFn: () => api.get<{ data: GeneratedLetter[]; total: number }>(
      `/letters/issued${letterStatus !== 'all' ? `?status=${letterStatus}` : ''}`
    ),
    staleTime: 30_000,
    enabled: tab === 'all-letters' || tab === 'approval-inbox',
  })
  const letters = lettersData?.data ?? []
  const approvalInbox = letters.filter(l => l.approval_status === 'pending_approval')

  // ── ESS Requests ───────────────────────────────────────────────────────────
  const { data: reqData, isLoading: reqLoading, refetch: refetchReq } = useQuery({
    queryKey: ['ess-requests'],
    queryFn: () => api.get<{ data: EssRequest[]; total: number }>('/letters/requests?status=pending'),
    staleTime: 30_000,
    enabled: tab === 'ess-requests',
  })
  const essRequests = reqData?.data ?? []

  const [actingReqId, setActingReqId] = useState<string | null>(null)

  const fulfillReq = async (id: string) => {
    setActingReqId(id)
    try {
      await api.post(`/letters/requests/${id}/fulfill`, {})
      // ESS reads its own request/letter status under ['my-letter-requests'] and
      // ['ess-my-letters'] — invalidate so the employee sees the fulfilled
      // request without a manual refresh.
      qc.invalidateQueries({ queryKey: ['ess-requests'] })
      qc.invalidateQueries({ queryKey: ['my-letter-requests'] })
      qc.invalidateQueries({ queryKey: ['ess-my-letters'] })
    } catch (err) {
      toast.error('Failed to fulfill request', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setActingReqId(null)
    }
  }
  const rejectReq = async (id: string) => {
    setActingReqId(id)
    try {
      await api.post(`/letters/requests/${id}/reject`, { reason: 'Declined by HR' })
      qc.invalidateQueries({ queryKey: ['ess-requests'] })
      qc.invalidateQueries({ queryKey: ['my-letter-requests'] })
    } catch (err) {
      toast.error('Failed to reject request', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setActingReqId(null)
    }
  }

  const TABS = [
    { id: 'templates'      as Tab, label: 'Templates',      icon: BookOpen      },
    { id: 'generate'       as Tab, label: 'Generate',       icon: Wand2         },
    { id: 'approval-inbox' as Tab, label: 'Approval Inbox', icon: Inbox,        badge: approvalInbox.length },
    { id: 'all-letters'    as Tab, label: 'All Letters',    icon: ClipboardList },
    { id: 'ess-requests'   as Tab, label: 'ESS Requests',   icon: Star,         badge: essRequests.length },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PageHeader
        title="Letter Generation"
        subtitle="Manage templates, generate letters, and handle approvals"
        className="px-6 py-4 border-b border-border/50 flex-shrink-0"
        actions={
          <Button onClick={() => setShowGenerate(true)} size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Generate Letter
          </Button>
        }
      />

      {/* Tabs */}
      <SubTabs<typeof tab>
        tabs={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon, badge: t.badge }))}
        value={tab}
        onChange={(v) => { setTab(v); setSearch('') }}
        className="px-6 flex-shrink-0"
      />

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">

        {/* ── TEMPLATES TAB ─────────────────────────────────────────────────── */}
        {tab === 'templates' && (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 h-8 text-xs"
                  placeholder="Search templates…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchTmpl()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => seedTemplates.mutate()}
                disabled={seedTemplates.isPending}
                title="Load the best-practice standard letter templates (idempotent)">
                {seedTemplates.isPending
                  ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5 mr-1.5" />}
                Load Standard Library
              </Button>
              <Button size="sm" onClick={() => setEditTmpl(null)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Template
              </Button>
            </div>

            <div className="border border-border/50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr>
                    <Th>Name</Th>
                    <Th>Type</Th>
                    <Th>Category</Th>
                    <Th>Approval</Th>
                    <Th>Status</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {tmplLoading ? (
                    <tr><td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
                  ) : templates.length === 0 ? (
                    <tr><td colSpan={6}><Empty icon={BookOpen} message="No templates yet — create your first one" /></td></tr>
                  ) : templates.map(t => (
                    <tr key={t.id} className="hover:bg-sidebar-accent/50 transition-colors">
                      <Td>
                        <div className="font-medium text-foreground">{t.name}</div>
                        <div className="text-muted-foreground font-mono text-[11px]">{t.code}</div>
                      </Td>
                      <Td>{LETTER_TYPES.find(lt => lt.value === t.letter_type)?.label ?? t.letter_type}</Td>
                      <Td>
                        <span className={cn(
                          'text-[11px] px-2 py-0.5 rounded-full font-medium',
                          t.category === 'ess_requestable' ? 'bg-info/10 text-info' : 'bg-muted text-muted-foreground'
                        )}>
                          {t.category === 'ess_requestable' ? 'ESS Requestable' : 'HR Initiated'}
                        </span>
                      </Td>
                      <Td>
                        {t.requires_approval ? (
                          <span className="text-[11px] text-warning">{t.approval_levels}-level</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">None</span>
                        )}
                      </Td>
                      <Td>
                        <button
                          onClick={() => toggleActive.mutate({ id: t.id, is_active: !t.is_active })}
                          className={cn(
                            'text-[11px] px-2 py-0.5 rounded-full font-medium cursor-pointer transition-colors',
                            t.is_active ? 'bg-success/15 text-success hover:bg-success/25'
                              : 'bg-muted text-muted-foreground hover:bg-muted/70'
                          )}
                        >
                          {t.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </Td>
                      <Td>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem onClick={() => setEditTmpl(t)}>
                              <Eye className="h-3.5 w-3.5 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setShowGenerate(true) }}>
                              <Wand2 className="h-3.5 w-3.5 mr-2" /> Generate Letter
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── GENERATE TAB ────────────────────────────────────────────────────── */}
        {tab === 'generate' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Wand2 className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-foreground">Generate a New Letter</h3>
              <p className="text-sm text-muted-foreground mt-1">Select a template and employee to begin the 3-step wizard</p>
            </div>
            <Button onClick={() => setShowGenerate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Start Generating
            </Button>
          </div>
        )}

        {/* ── APPROVAL INBOX TAB ────────────────────────────────────────────── */}
        {tab === 'approval-inbox' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {approvalInbox.length} letter{approvalInbox.length !== 1 ? 's' : ''} awaiting approval
              </p>
              <Button variant="outline" size="sm" onClick={() => refetchLetters()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="border border-border/50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr>
                    <Th>Employee</Th>
                    <Th>Letter</Th>
                    <Th>Level</Th>
                    <Th>Created</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {lettersLoading ? (
                    <tr><td colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
                  ) : approvalInbox.length === 0 ? (
                    <tr><td colSpan={5}><Empty icon={Inbox} message="No letters pending your approval" /></td></tr>
                  ) : approvalInbox.map(l => (
                    <tr key={l.id} className="hover:bg-sidebar-accent/50 transition-colors">
                      <Td>
                        <div className="font-medium">{l.employee?.full_name}</div>
                        <div className="text-muted-foreground text-[11px]">{l.employee?.employee_code}</div>
                      </Td>
                      <Td>{l.template?.name}</Td>
                      <Td>
                        <span className="text-xs text-warning">Level {l.current_level}</span>
                      </Td>
                      <Td>{fmt(l.created_at)}</Td>
                      <Td>
                        <Button variant="outline" size="sm" onClick={() => setDetailId(l.id)} className="h-7 text-xs">
                          Review
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── ALL LETTERS TAB ───────────────────────────────────────────────── */}
        {tab === 'all-letters' && (
          <>
            <div className="flex items-center gap-3">
              <Select value={letterStatus} onValueChange={setLetterStatus}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"              className="text-xs">All Statuses</SelectItem>
                  <SelectItem value="draft"            className="text-xs">Draft</SelectItem>
                  <SelectItem value="pending_approval" className="text-xs">Pending Approval</SelectItem>
                  <SelectItem value="approved"         className="text-xs">Approved</SelectItem>
                  <SelectItem value="rejected"         className="text-xs">Rejected</SelectItem>
                  <SelectItem value="issued"           className="text-xs">Issued</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => refetchLetters()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground ml-auto">{lettersData?.total ?? 0} total</span>
            </div>

            <div className="border border-border/50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr>
                    <Th>Employee</Th>
                    <Th>Letter</Th>
                    <Th>Status</Th>
                    <Th>Issued</Th>
                    <Th>Created</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {lettersLoading ? (
                    <tr><td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
                  ) : letters.length === 0 ? (
                    <tr><td colSpan={6}><Empty icon={ClipboardList} message="No letters found" /></td></tr>
                  ) : letters.map(l => (
                    <tr key={l.id} className="hover:bg-sidebar-accent/50 transition-colors">
                      <Td>
                        <div className="font-medium">{l.employee?.full_name}</div>
                        <div className="text-muted-foreground text-[11px]">{l.employee?.employee_code} · {l.employee?.designation}</div>
                      </Td>
                      <Td>
                        <div className="font-medium">{l.template?.name}</div>
                        {l.missing_vars?.length > 0 && (
                          <div className="text-warning text-[10px] flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {l.missing_vars.length} missing var{l.missing_vars.length > 1 ? 's' : ''}
                          </div>
                        )}
                      </Td>
                      <Td>{statusBadge(l.approval_status)}</Td>
                      <Td>{fmt(l.issued_at)}</Td>
                      <Td>{fmt(l.created_at)}</Td>
                      <Td>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailId(l.id)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── ESS REQUESTS TAB ─────────────────────────────────────────────── */}
        {tab === 'ess-requests' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{essRequests.length} pending request{essRequests.length !== 1 ? 's' : ''}</p>
              <Button variant="outline" size="sm" onClick={() => refetchReq()}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="border border-border/50 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/30 border-b border-border/40">
                  <tr>
                    <Th>Employee</Th>
                    <Th>Requested Letter</Th>
                    <Th>Reason</Th>
                    <Th>Requested</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {reqLoading ? (
                    <tr><td colSpan={5} className="py-12 text-center text-sm text-muted-foreground">Loading…</td></tr>
                  ) : essRequests.length === 0 ? (
                    <tr><td colSpan={5}><Empty icon={Star} message="No pending ESS requests" /></td></tr>
                  ) : essRequests.map(r => (
                    <tr key={r.id} className="hover:bg-sidebar-accent/50 transition-colors">
                      <Td>
                        <div className="font-medium">{r.employee?.full_name}</div>
                        <div className="text-muted-foreground text-[11px]">
                          {r.employee?.employee_code} · {r.employee?.departments?.name}
                        </div>
                      </Td>
                      <Td>{r.template?.name}</Td>
                      <Td className="max-w-[200px] truncate">{r.reason || <span className="text-muted-foreground text-[11px]">—</span>}</Td>
                      <Td>{fmt(r.requested_at)}</Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm" className="h-7 text-xs"
                            onClick={() => fulfillReq(r.id)}
                            disabled={actingReqId === r.id}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Fulfill
                          </Button>
                          <Button
                            variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                            onClick={() => rejectReq(r.id)}
                            disabled={actingReqId === r.id}
                          >
                            <XCircle className="h-3 w-3 mr-1" /> Reject
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────────────── */}
      {editTmpl !== undefined && (
        <TemplateEditorDialog
          template={editTmpl}
          onClose={() => setEditTmpl(undefined)}
        />
      )}
      {showGenerate && (
        <GenerateLetterDialog onClose={() => setShowGenerate(false)} />
      )}
      {detailId && (
        <LetterDetailDialog letterId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}
