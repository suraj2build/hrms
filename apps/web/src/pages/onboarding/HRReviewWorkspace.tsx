import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Upload, AlertTriangle, CheckCircle2, XCircle,
  Pencil, Check, X, ChevronRight, Loader2, Eye,
  Cpu, ShieldCheck, UserCheck, ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { createClient } from '@supabase/supabase-js'
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

// ── Supabase Storage ──────────────────────────────────────────────────────────

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)

async function uploadOnboardingFile(
  tenantId: string,
  sessionId: string,
  file: File,
): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const path = `onboarding/${tenantId}/${sessionId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('employee-files')
    .upload(path, file, { upsert: true })
  if (error) throw new Error(error.message)
  return path
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OnboardingDocument {
  id: string
  session_id: string
  doc_type: string
  file_name: string
  storage_path: string
  extraction_status: string
  confidence_score: number | null
  extracted_fields?: ExtractedField[]
  created_at: string
}

interface ExtractedField {
  field_name: string
  value: string | null
  confidence_score: number | null
  source_doc_type: string | null
  is_conflicting: boolean
  conflict_values?: Array<{ value: string; source: string }>
}

interface DraftProfile {
  id: string
  session_id: string
  status: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  dob?: string
  gender?: string
  address_line1?: string
  address_city?: string
  address_state?: string
  address_pincode?: string
  joining_date?: string
  employment_type?: string
  department?: string
  designation?: string
  employee_code?: string
  pan_number?: string
  uan_number?: string
  esi_number?: string
  pf_number?: string
  bank_name?: string
  bank_account_number?: string
  bank_ifsc?: string
  ctc_annual?: string
  fields: ExtractedField[]
}

interface OnboardingSession {
  id: string
  candidate_name: string | null
  status: string
  assigned_to: string | null
  created_at: string
  draft_profile_id: string | null
  documents?: OnboardingDocument[]
}

interface ValidationResult {
  validation_errors: string[]
  validation_warnings: string[]
  duplicate_risk: boolean
  status: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card', icon: '🪪' },
  { value: 'pan', label: 'PAN Card', icon: '💳' },
  { value: 'passport', label: 'Passport', icon: '📕' },
  { value: 'resume', label: 'Resume / CV', icon: '📄' },
  { value: 'offer_letter', label: 'Offer Letter', icon: '📋' },
  { value: 'salary_slip', label: 'Salary Slip', icon: '💰' },
  { value: 'bank_proof', label: 'Bank Proof', icon: '🏦' },
  { value: 'experience_letter', label: 'Experience Letter', icon: '🏢' },
  { value: 'pf_uan_document', label: 'PF / UAN Document', icon: '🔖' },
  { value: 'driving_license', label: 'Driving License', icon: '🪪' },
  { value: 'degree_certificate', label: 'Degree Certificate', icon: '🎓' },
  { value: 'birth_certificate', label: 'Birth Certificate', icon: '📜' },
  { value: 'form_16', label: 'Form 16', icon: '📊' },
  { value: 'other', label: 'Other Document', icon: '📎' },
]

const DOC_TYPE_ICON: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map(({ value, icon }) => [value, icon])
)

type BadgeVariant = 'outline' | 'warning' | 'info' | 'success' | 'destructive' | 'secondary' | 'default'

const SESSION_STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'outline',
  extracting: 'warning',
  draft_ready: 'info',
  hr_review: 'warning',
  approval_pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  employee_created: 'success',
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  extracting: 'Extracting',
  draft_ready: 'Draft Ready',
  hr_review: 'HR Review',
  approval_pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  employee_created: 'Employee Created',
}

const FIELD_SECTIONS: Array<{ title: string; fields: Array<{ key: string; label: string }> }> = [
  {
    title: 'Identity',
    fields: [
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'dob', label: 'Date of Birth' },
      { key: 'gender', label: 'Gender' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { key: 'address_line1', label: 'Address Line 1' },
      { key: 'address_city', label: 'City' },
      { key: 'address_state', label: 'State' },
      { key: 'address_pincode', label: 'Pincode' },
    ],
  },
  {
    title: 'Employment',
    fields: [
      { key: 'joining_date', label: 'Joining Date' },
      { key: 'employment_type', label: 'Employment Type' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'employee_code', label: 'Employee Code' },
    ],
  },
  {
    title: 'Compliance',
    fields: [
      { key: 'pan_number', label: 'PAN Number' },
      { key: 'uan_number', label: 'UAN Number' },
      { key: 'esi_number', label: 'ESI Number' },
      { key: 'pf_number', label: 'PF Number' },
    ],
  },
  {
    title: 'Payroll & Banking',
    fields: [
      { key: 'bank_name', label: 'Bank Name' },
      { key: 'bank_account_number', label: 'Account Number' },
      { key: 'bank_ifsc', label: 'IFSC Code' },
      { key: 'ctc_annual', label: 'Annual CTC' },
    ],
  },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>
  const pct = Math.round(score * 100)
  const cls =
    pct >= 85 ? 'text-success' :
    pct >= 60 ? 'text-warning' :
                'text-destructive'
  return <span className={`text-xs font-mono font-medium ${cls}`}>{pct}%</span>
}

function ExtractionStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    pending: 'outline',
    processing: 'warning',
    completed: 'success',
    failed: 'destructive',
  }
  return (
    <Badge variant={map[status] ?? 'outline'} className="text-[9px] px-1.5 py-0">
      {status}
    </Badge>
  )
}

interface FieldRowProps {
  fieldKey: string
  label: string
  draft: DraftProfile | null
  fields: ExtractedField[]
  editingField: string | null
  onStartEdit: (key: string) => void
  onSaveOverride: (fieldName: string, value: string) => void
  onCancelEdit: () => void
}

function FieldRow({
  fieldKey,
  label,
  draft,
  fields,
  editingField,
  onStartEdit,
  onSaveOverride,
  onCancelEdit,
}: FieldRowProps) {
  const [editValue, setEditValue] = useState('')

  const extractedField = fields.find((f) => f.field_name === fieldKey)
  const currentValue =
    ((draft as unknown) as Record<string, unknown>)?.[fieldKey] as string | null ??
    extractedField?.value ??
    null

  const isEditing = editingField === fieldKey
  const isConflicting = extractedField?.is_conflicting ?? false
  const confidence = extractedField?.confidence_score ?? null
  const sourceDocType = extractedField?.source_doc_type ?? null

  function handleStartEdit() {
    setEditValue(currentValue ?? '')
    onStartEdit(fieldKey)
  }

  function handleSave() {
    onSaveOverride(fieldKey, editValue)
  }

  return (
    <div
      className={`grid grid-cols-[160px_1fr_64px_80px_32px] items-center gap-2 px-3 py-2 rounded-md transition-colors group ${
        isConflicting
          ? 'bg-warning/5 border border-warning/30 ring-1 ring-warning/20'
          : 'hover:bg-muted/30'
      }`}
    >
      {/* Label */}
      <div className="flex items-center gap-1.5 min-w-0">
        {isConflicting && (
          <AlertTriangle className="h-3 w-3 text-warning flex-shrink-0" />
        )}
        <span className="text-xs text-muted-foreground truncate">{label}</span>
      </div>

      {/* Value / Edit Input */}
      <div className="min-w-0">
        {isEditing ? (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onCancelEdit()
            }}
            className="h-7 text-xs"
            autoFocus
          />
        ) : (
          <span
            className={`text-sm truncate block ${
              currentValue ? 'text-foreground' : 'text-muted-foreground italic'
            }`}
          >
            {currentValue ?? 'Not extracted'}
          </span>
        )}
      </div>

      {/* Confidence */}
      <div className="text-right">
        <ConfidenceBadge score={confidence} />
      </div>

      {/* Source */}
      <div className="text-right">
        {sourceDocType ? (
          <span className="text-[10px] text-muted-foreground">
            {DOC_TYPE_ICON[sourceDocType] ?? '📎'} {sourceDocType.replace('_', ' ')}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">—</span>
        )}
      </div>

      {/* Edit actions */}
      <div className="flex items-center justify-end gap-0.5">
        {isEditing ? (
          <>
            <button
              onClick={handleSave}
              className="p-0.5 rounded hover:text-success transition-colors"
              title="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onCancelEdit}
              className="p-0.5 rounded hover:text-destructive transition-colors"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            onClick={handleStartEdit}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Upload Document Dialog ────────────────────────────────────────────────────

interface UploadDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  tenantId: string
  onUploaded: () => void
}

function UploadDocDialog({ open, onOpenChange, sessionId, tenantId, onUploaded }: UploadDocDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    if (!file || !docType) return
    setUploading(true)
    setError(null)
    try {
      const storagePath = await uploadOnboardingFile(tenantId, sessionId, file)
      await api.post(`/onboarding/sessions/${sessionId}/documents`, {
        doc_type: docType,
        file_name: file.name,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: file.type,
      })
      onUploaded()
      setFile(null)
      setDocType('')
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Document</DialogTitle>
          <DialogDescription>
            Upload a document and select its type for AI extraction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger>
                <SelectValue placeholder="Select document type…" />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="mr-2">{t.icon}</span>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>File</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                file ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-muted-foreground/40'
              }`}
            >
              {file ? (
                <div className="space-y-1">
                  <FileText className="h-6 w-6 text-primary mx-auto" />
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    onClick={() => setFile(null)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Click to choose a file
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                    PDF, JPG, PNG — max 20 MB
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || !docType || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

interface RejectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftId: string
  onRejected: () => void
}

function RejectDialog({ open, onOpenChange, draftId, onRejected }: RejectDialogProps) {
  const [reason, setReason] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      api.post(`/onboarding/drafts/${draftId}/reject`, { reason }),
    onSuccess: () => {
      onRejected()
      setReason('')
      onOpenChange(false)
      toast.success('Draft rejected', { description: 'The rejection reason has been recorded.' })
    },
    onError: (e: Error) => toast.error('Failed to reject draft', { description: e.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Draft Profile</DialogTitle>
          <DialogDescription>
            Provide a reason for rejection. This will be recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Rejection Reason</Label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Aadhaar number does not match PAN card details…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutate()}
            disabled={!reason.trim() || isPending}
          >
            {isPending ? 'Rejecting…' : 'Reject Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function HRReviewWorkspace() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { tenant } = useAuthStore()

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'extracted' | 'validation'>('extracted')
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: sessionData, isLoading: sessionLoading } = useQuery<{ data: OnboardingSession }>({
    queryKey: ['onboarding-session', sessionId],
    queryFn: () => api.get(`/onboarding/sessions/${sessionId}`),
    enabled: !!sessionId,
    staleTime: 30_000,
  })

  const { data: docsData } = useQuery<{ data: OnboardingDocument[] }>({
    queryKey: ['onboarding-docs', sessionId],
    queryFn: () => api.get(`/onboarding/sessions/${sessionId}/documents`),
    enabled: !!sessionId,
    staleTime: 30_000,
  })

  const session = sessionData?.data
  const draftProfileId = session?.draft_profile_id ?? null

  const { data: draftData, isLoading: draftLoading } = useQuery<{ data: DraftProfile }>({
    queryKey: ['onboarding-draft', draftProfileId],
    queryFn: () => api.get(`/onboarding/drafts/${draftProfileId}`),
    enabled: !!draftProfileId,
    staleTime: 30_000,
  })

  const draft = draftData?.data ?? null
  const fields = draft?.fields ?? []
  const documents = docsData?.data ?? session?.documents ?? []

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const { mutate: runExtraction, isPending: extracting } = useMutation({
    mutationFn: () => api.post(`/onboarding/sessions/${sessionId}/extract`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-session', sessionId] })
      qc.invalidateQueries({ queryKey: ['onboarding-docs', sessionId] })
      toast.success('Extraction started', { description: 'AI is processing the uploaded documents.' })
    },
    onError: (e: Error) => toast.error('Extraction failed', { description: e.message }),
  })

  const { mutate: runValidation, isPending: validating } = useMutation({
    mutationFn: () => api.post<{ data: ValidationResult }>(`/onboarding/drafts/${draftProfileId}/validate`, {}),
    onSuccess: (resp) => {
      setValidationResult(resp.data)
      setActiveTab('validation')
      const errCount = resp.data?.validation_errors?.length ?? 0
      if (errCount > 0) {
        toast.error(`Validation found ${errCount} error${errCount !== 1 ? 's' : ''}`, { description: 'Review the Validation tab for details.' })
      } else {
        toast.success('Validation passed', { description: 'No errors found. Draft is ready for approval.' })
      }
    },
    onError: (e: Error) => toast.error('Validation failed', { description: e.message }),
  })

  const { mutate: approveAndCreate, isPending: approving } = useMutation<{ data: { employee_id: string; employee_code: string } }, Error, void>({
    mutationFn: () => api.post<{ data: { employee_id: string; employee_code: string } }>(`/onboarding/drafts/${draftProfileId}/approve`, {}),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['onboarding-session', sessionId] })
      const code = resp.data?.employee_code
      toast.success('Employee created', { description: code ? `Employee code: ${code}` : 'Navigating to employee profile…' })
      if (resp.data?.employee_id) {
        navigate(`/admin/employees/${resp.data.employee_id}`)
      }
    },
    onError: (e: Error) => toast.error('Failed to create employee', { description: e.message }),
  })

  const { mutate: saveOverride } = useMutation({
    mutationFn: ({ fieldName, value }: { fieldName: string; value: string }) =>
      api.patch(`/onboarding/drafts/${draftProfileId}/fields`, {
        overrides: [{ field_name: fieldName, value }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding-draft', draftProfileId] })
      setEditingField(null)
      toast.success('Field override saved')
    },
    onError: (e: Error) => toast.error('Failed to save override', { description: e.message }),
  })

  // ── Derived ───────────────────────────────────────────────────────────────────

  const selectedDoc = selectedDocId
    ? documents.find((d) => d.id === selectedDocId) ?? null
    : null

  const conflictedFields = fields.filter((f) => f.is_conflicting)

  const canApprove =
    session?.status === 'approval_pending' ||
    draft?.status === 'approval_pending'

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Session not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/onboarding')}>
          Back to Onboarding
        </Button>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground"
          onClick={() => navigate('/admin/onboarding')}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Onboarding
        </Button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
        <span className="text-sm font-medium truncate">
          {session.candidate_name ?? 'Unnamed Candidate'}
        </span>
        <Badge
          variant={SESSION_STATUS_VARIANT[session.status] ?? 'outline'}
          className="text-[10px]"
        >
          {SESSION_STATUS_LABELS[session.status] ?? session.status}
        </Badge>
        {conflictedFields.length > 0 && (
          <Badge variant="warning" className="text-[10px]">
            <AlertTriangle className="h-2.5 w-2.5 mr-1" />
            {conflictedFields.length} conflict{conflictedFields.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* ── Three-panel layout ───────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left Panel: Session + Documents ────────────────────────────── */}
        <div className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-card">

          {/* Session info */}
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Session
            </p>
            <p className="text-sm font-medium text-foreground">
              {session.candidate_name ?? 'Unnamed'}
            </p>
            {session.assigned_to && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Assigned to: {session.assigned_to}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(session.created_at).toLocaleDateString([], {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
          </div>

          {/* Documents list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Documents ({documents.length})
              </p>
            </div>

            <div className="px-2 space-y-0.5">
              {documents.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6 px-4">
                  No documents yet. Add one to start extraction.
                </p>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id === selectedDocId ? null : doc.id)}
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                      selectedDocId === doc.id
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base leading-none">
                        {DOC_TYPE_ICON[doc.doc_type] ?? '📎'}
                      </span>
                      <span className="text-xs font-medium text-foreground truncate">
                        {doc.doc_type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mb-1">
                      {doc.file_name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <ExtractionStatusBadge status={doc.extraction_status} />
                      <ConfidenceBadge score={doc.confidence_score ?? null} />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Add Document */}
          <div className="px-3 py-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={() => setUploadDialogOpen(true)}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Add Document
            </Button>
          </div>
        </div>

        {/* ── Center Panel: Tabs ─────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-border px-4 bg-card flex-shrink-0">
            {(
              [
                { key: 'extracted', label: 'Extracted Data' },
                { key: 'validation', label: 'Validation' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                {key === 'validation' && validationResult?.validation_errors?.length ? (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold">
                    {validationResult.validation_errors.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'extracted' && (
              <div className="space-y-6 max-w-3xl">
                {!draft && !draftLoading && (
                  <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                    <Cpu className="h-10 w-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-medium text-foreground">No extracted data yet</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Add documents and run AI extraction to populate fields.
                      </p>
                    </div>
                  </div>
                )}

                {draftLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {draft && !draftLoading && (
                  <>
                    {/* Column headers */}
                    <div className="grid grid-cols-[160px_1fr_64px_80px_32px] gap-2 px-3 pb-1 border-b border-border">
                      {['Field', 'Value', 'Confidence', 'Source', ''].map((h) => (
                        <span key={h} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {h}
                        </span>
                      ))}
                    </div>

                    {FIELD_SECTIONS.map((section) => (
                      <div key={section.title} className="space-y-1">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-3 pt-2">
                          {section.title}
                        </h3>
                        {section.fields.map(({ key, label }) => (
                          <FieldRow
                            key={key}
                            fieldKey={key}
                            label={label}
                            draft={draft}
                            fields={fields}
                            editingField={editingField}
                            onStartEdit={(k) => setEditingField(k)}
                            onSaveOverride={(fieldName, value) =>
                              saveOverride({ fieldName, value })
                            }
                            onCancelEdit={() => setEditingField(null)}
                          />
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {activeTab === 'validation' && (
              <div className="space-y-5 max-w-2xl">
                {!validationResult && (
                  <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                    <ShieldCheck className="h-10 w-10 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-medium text-foreground">No validation run yet</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Click "Run Validation" to check the draft profile for issues.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!draftProfileId || validating}
                      onClick={() => runValidation()}
                    >
                      {validating ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      {validating ? 'Validating…' : 'Run Validation'}
                    </Button>
                  </div>
                )}

                {validationResult && (
                  <>
                    {/* Duplicate risk */}
                    {validationResult.duplicate_risk && (
                      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-warning/30 bg-warning/5">
                        <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-warning">Potential Duplicate</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            An employee with similar details may already exist in the system.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Errors */}
                    {validationResult.validation_errors.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-destructive uppercase tracking-wide">
                          Errors ({validationResult.validation_errors.length})
                        </p>
                        <div className="space-y-1.5">
                          {validationResult.validation_errors.map((err, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/5 border border-destructive/20"
                            >
                              <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-foreground">{err}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warnings */}
                    {validationResult.validation_warnings.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-warning uppercase tracking-wide">
                          Warnings ({validationResult.validation_warnings.length})
                        </p>
                        <div className="space-y-1.5">
                          {validationResult.validation_warnings.map((w, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning/5 border border-warning/20"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-foreground">{w}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* All clear */}
                    {validationResult.validation_errors.length === 0 &&
                      validationResult.validation_warnings.length === 0 &&
                      !validationResult.duplicate_risk && (
                        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-success/30 bg-success/5">
                          <CheckCircle2 className="h-4 w-4 text-success" />
                          <p className="text-sm font-medium text-success">
                            All checks passed — ready for approval
                          </p>
                        </div>
                      )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => runValidation()}
                      disabled={validating}
                    >
                      {validating ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Re-run Validation
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel ────────────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col bg-card overflow-y-auto">
          <div className="p-4 space-y-5">

            {/* Active document preview */}
            {selectedDoc ? (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Selected Document
                </p>
                <div className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{DOC_TYPE_ICON[selectedDoc.doc_type] ?? '📎'}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground capitalize">
                        {selectedDoc.doc_type.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {selectedDoc.file_name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ExtractionStatusBadge status={selectedDoc.extraction_status} />
                    <ConfidenceBadge score={selectedDoc.confidence_score ?? null} />
                  </div>

                  {/* Fields from this doc */}
                  {selectedDoc.extracted_fields && selectedDoc.extracted_fields.length > 0 ? (
                    <div className="space-y-1 pt-1 border-t border-border">
                      <p className="text-[10px] text-muted-foreground font-medium">Extracted Fields</p>
                      {selectedDoc.extracted_fields.map((f) => (
                        <div key={f.field_name} className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground capitalize truncate">
                            {f.field_name.replace(/_/g, ' ')}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] text-foreground truncate max-w-[80px]">
                              {f.value ?? '—'}
                            </span>
                            <ConfidenceBadge score={f.confidence_score ?? null} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
                      {selectedDoc.extraction_status === 'completed'
                        ? 'No fields extracted from this document.'
                        : 'Run extraction to populate fields.'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <Eye className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1.5" />
                <p className="text-[11px] text-muted-foreground">
                  Select a document to preview its extracted fields
                </p>
              </div>
            )}

            {/* Conflict resolution */}
            {conflictedFields.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-warning uppercase tracking-wide flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  Conflicts ({conflictedFields.length})
                </p>
                <div className="space-y-3">
                  {conflictedFields.map((f) => (
                    <div
                      key={f.field_name}
                      className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2"
                    >
                      <p className="text-xs font-medium text-foreground capitalize">
                        {f.field_name.replace(/_/g, ' ')}
                      </p>
                      {f.conflict_values?.map((cv, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] text-foreground font-mono truncate">
                              {cv.value}
                            </p>
                            <p className="text-[9px] text-muted-foreground">
                              from {cv.source.replace(/_/g, ' ')}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2 flex-shrink-0"
                            onClick={() =>
                              saveOverride({
                                fieldName: f.field_name,
                                value: cv.value,
                              })
                            }
                          >
                            Accept
                          </Button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Actions
              </p>

              {/* Extract */}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-9"
                disabled={extracting || documents.length === 0}
                onClick={() => runExtraction()}
              >
                {extracting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Cpu className="h-3.5 w-3.5 mr-2" />
                )}
                {extracting ? 'Extracting…' : 'Extract Documents'}
              </Button>

              {/* Validate */}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start h-9"
                disabled={!draftProfileId || validating}
                onClick={() => runValidation()}
              >
                {validating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 mr-2" />
                )}
                {validating ? 'Validating…' : 'Run Validation'}
              </Button>

              {/* Approve */}
              {canApprove && (
                <Button
                  size="sm"
                  className="w-full justify-start h-9 bg-success hover:bg-success/90 text-success-foreground"
                  disabled={approving}
                  onClick={() => approveAndCreate()}
                >
                  {approving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5 mr-2" />
                  )}
                  {approving ? 'Creating Employee…' : 'Approve & Create Employee'}
                </Button>
              )}

              {/* Reject */}
              {draftProfileId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start h-9 text-destructive border-destructive/30 hover:bg-destructive/5 hover:border-destructive/50"
                  onClick={() => setRejectDialogOpen(true)}
                >
                  <XCircle className="h-3.5 w-3.5 mr-2" />
                  Reject
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      <UploadDocDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        sessionId={sessionId!}
        tenantId={tenant?.id ?? 'default'}
        onUploaded={() => {
          qc.invalidateQueries({ queryKey: ['onboarding-docs', sessionId] })
          qc.invalidateQueries({ queryKey: ['onboarding-session', sessionId] })
        }}
      />

      {draftProfileId && (
        <RejectDialog
          open={rejectDialogOpen}
          onOpenChange={setRejectDialogOpen}
          draftId={draftProfileId}
          onRejected={() => {
            qc.invalidateQueries({ queryKey: ['onboarding-session', sessionId] })
          }}
        />
      )}
    </div>
  )
}
