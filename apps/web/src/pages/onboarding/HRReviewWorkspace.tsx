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
import { DateInput } from '@/components/ui/date-input'
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
  document_type: string
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
  source_document_type: string | null
  is_conflicting: boolean
  is_hr_override?: boolean
  conflict_values?: Array<{ value: string; source: string }>
}

interface DraftProfile {
  id: string
  session_id: string
  status: string
  validation_errors?: string[]
  validation_warnings?: string[]
  duplicate_risk?: string | null
  exception_approved?: boolean
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
  draft_profile?: { id: string; status: string; overall_confidence?: number | null } | null
  documents?: OnboardingDocument[]
}

interface ValidationResult {
  validation_errors: string[]
  validation_warnings: string[]
  duplicate_risk: boolean
  identity_flags?: string[]
  status: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Values must exactly match the CHECK constraint in migration 109_employee_onboarding.sql
const DOC_TYPES = [
  { value: 'aadhaar',             label: 'Aadhaar Card',         icon: '🪪' },
  { value: 'pan',                 label: 'PAN Card',             icon: '💳' },
  { value: 'passport',            label: 'Passport',             icon: '📕' },
  { value: 'driving_license',     label: 'Driving License',      icon: '🪪' },
  { value: 'resume',              label: 'Resume / CV',          icon: '📄' },
  { value: 'offer_letter',        label: 'Offer Letter',         icon: '📋' },
  { value: 'experience_letter',   label: 'Experience Letter',    icon: '🏢' },
  { value: 'relieving_letter',    label: 'Relieving Letter',     icon: '📑' },
  { value: 'joining_letter',      label: 'Joining Letter',       icon: '✉️'  },
  { value: 'salary_slip',         label: 'Salary Slip',          icon: '💰' },
  { value: 'compensation_letter', label: 'Compensation Letter',  icon: '📃' },
  { value: 'bank_proof',          label: 'Bank Proof',           icon: '🏦' },
  { value: 'pf_uan_document',     label: 'PF / UAN Document',   icon: '🔖' },
  { value: 'esi_document',        label: 'ESI Document',         icon: '🏥' },
  { value: 'tax_document',        label: 'Tax Document (Form 16 etc.)', icon: '📊' },
  { value: 'other',               label: 'Other Document',       icon: '📎' },
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
      { key: 'first_name',   label: 'First Name' },
      { key: 'last_name',    label: 'Last Name' },
      { key: 'email',        label: 'Email' },
      { key: 'phone',        label: 'Phone' },
      { key: 'dob',          label: 'Date of Birth' },
      { key: 'gender',       label: 'Gender' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { key: 'address_line1',    label: 'Address Line 1' },
      { key: 'address_city',     label: 'City' },
      { key: 'address_state',    label: 'State' },
      { key: 'address_pincode',  label: 'Pincode' },
    ],
  },
  {
    title: 'Employment',
    fields: [
      { key: 'joining_date',     label: 'Joining Date' },
      { key: 'employment_type',  label: 'Employment Type' },
      { key: 'department_id',    label: 'Department' },
      { key: 'designation_id',   label: 'Designation' },
      { key: 'grade_id',         label: 'Grade' },
      { key: 'employee_code',    label: 'Employee Code' },
    ],
  },
  {
    title: 'Compliance',
    fields: [
      { key: 'pan_number',  label: 'PAN Number' },
      { key: 'uan_number',  label: 'UAN Number' },
      { key: 'esi_number',  label: 'ESI Number' },
      { key: 'pf_number',   label: 'PF Number' },
    ],
  },
  {
    title: 'Payroll & Banking',
    fields: [
      { key: 'bank_name',           label: 'Bank Name' },
      { key: 'bank_account_number', label: 'Account Number' },
      { key: 'bank_ifsc',           label: 'IFSC Code' },
      { key: 'bank_account_type',   label: 'Account Type' },
      { key: 'ctc_annual',          label: 'Annual CTC' },
    ],
  },
]

// ── Dropdown config ───────────────────────────────────────────────────────────

type FieldOption = { value: string; label: string }

/** Fixed-choice fields — no API fetch needed */
const ENUM_OPTIONS: Record<string, FieldOption[]> = {
  gender: [
    { value: 'male',             label: 'Male' },
    { value: 'female',           label: 'Female' },
    { value: 'other',            label: 'Other' },
    { value: 'prefer_not_to_say',label: 'Prefer not to say' },
  ],
  employment_type: [
    { value: 'permanent',  label: 'Permanent' },
    { value: 'contract',   label: 'Contract' },
    { value: 'intern',     label: 'Intern' },
    { value: 'probation',  label: 'Probation' },
    { value: 'consultant', label: 'Consultant' },
  ],
  bank_account_type: [
    { value: 'savings', label: 'Savings' },
    { value: 'current', label: 'Current' },
    { value: 'salary',  label: 'Salary' },
  ],
}

/** Master-driven fields — values are UUIDs, fetched from API */
const MASTER_FIELD_KEYS: Record<string, string> = {
  department_id:  'departments',
  designation_id: 'designations',
  grade_id:       'grades',
}

// ── Source badge config ───────────────────────────────────────────────────────

const SOURCE_BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  aadhaar:              { label: 'Aadhaar',       className: 'bg-blue-100 text-blue-700 border-blue-200' },
  pan:                  { label: 'PAN',            className: 'bg-orange-100 text-orange-700 border-orange-200' },
  passport:             { label: 'Passport',       className: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  driving_license:      { label: 'DL',             className: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
  resume:               { label: 'Resume',         className: 'bg-purple-100 text-purple-700 border-purple-200' },
  offer_letter:         { label: 'Offer',          className: 'bg-green-100 text-green-700 border-green-200' },
  experience_letter:    { label: 'Exp. Letter',    className: 'bg-teal-100 text-teal-700 border-teal-200' },
  relieving_letter:     { label: 'Relieving',      className: 'bg-teal-100 text-teal-700 border-teal-200' },
  joining_letter:       { label: 'Joining',        className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  salary_slip:          { label: 'Salary Slip',    className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  compensation_letter:  { label: 'CTC Letter',     className: 'bg-lime-100 text-lime-700 border-lime-200' },
  bank_proof:           { label: 'Bank Proof',     className: 'bg-sky-100 text-sky-700 border-sky-200' },
  pf_uan_document:      { label: 'PF/UAN',         className: 'bg-violet-100 text-violet-700 border-violet-200' },
  esi_document:         { label: 'ESI',            className: 'bg-rose-100 text-rose-700 border-rose-200' },
  tax_document:         { label: 'Tax Doc',        className: 'bg-amber-100 text-amber-700 border-amber-200' },
  other:                { label: 'Other',          className: 'bg-muted text-muted-foreground border-border' },
  hr_override:          { label: 'Manual',         className: 'bg-slate-100 text-slate-600 border-slate-200' },
}

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

function SourceBadge({ source, isHrOverride }: { source: string | null; isHrOverride?: boolean }) {
  const key = isHrOverride ? 'hr_override' : (source ?? '')
  const cfg = SOURCE_BADGE_CONFIG[key]
  if (!cfg && !source) return <span className="text-[10px] text-muted-foreground">—</span>
  const { label, className } = cfg ?? { label: source!.replace(/_/g, ' '), className: 'bg-muted text-muted-foreground border-border' }
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0 text-[9px] font-semibold leading-4 whitespace-nowrap ${className}`}>
      {isHrOverride && <span className="mr-0.5">✎</span>}
      {label}
    </span>
  )
}

function ExtractionStatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    pending:    'outline',
    processing: 'warning',
    extracted:  'success',
    completed:  'success',
    failed:     'destructive',
    rejected:   'destructive',
  }
  const label: Record<string, string> = {
    rejected: '⛔ rejected',
  }
  return (
    <Badge variant={map[status] ?? 'outline'} className="text-[9px] px-1.5 py-0">
      {label[status] ?? status}
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
  /** If set, renders a Select dropdown instead of a plain text input */
  options?: FieldOption[]
  /** Resolved human-readable display text (for UUID → name master fields) */
  displayValue?: string
}

/** Fields whose value is an ISO date (YYYY-MM-DD) — use DateInput for edit + format for display */
const DATE_FIELDS = new Set(['joining_date', 'dob', 'date_of_birth', 'probation_end_date'])

/** Format ISO date to readable DD-MMM-YYYY for display */
function fmtIsoDate(iso: string | null): string {
  if (!iso || iso.length < 10) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (!y || !m || !d || m < 1 || m > 12) return iso
  return `${String(d).padStart(2,'0')}-${months[m-1]}-${y}`
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
  options,
  displayValue,
}: FieldRowProps) {
  const [editValue, setEditValue] = useState('')
  const isDateField = DATE_FIELDS.has(fieldKey)

  const extractedField = fields.find((f) => f.field_name === fieldKey)
  const rawValue =
    ((draft as unknown) as Record<string, unknown>)?.[fieldKey] as string | null ??
    extractedField?.value ??
    null

  // For display: use resolved human-readable name if available (master fields show UUID otherwise)
  const shownValue = displayValue ?? rawValue

  const isEditing = editingField === fieldKey
  const isConflicting = extractedField?.is_conflicting ?? false
  const isHrOverride = extractedField?.is_hr_override ?? false
  const confidence = extractedField?.confidence_score ?? null
  const sourceDocType = extractedField?.source_document_type ?? null

  function handleStartEdit() {
    setEditValue(rawValue ?? '')
    onStartEdit(fieldKey)
  }

  function handleSave() {
    if (options && options.length > 0 && !editValue) return  // don't save blank selection
    onSaveOverride(fieldKey, editValue)
  }

  return (
    <div
      className={`grid grid-cols-[160px_1fr_56px_90px_32px] items-center gap-2 px-3 py-2 rounded-md transition-colors group ${
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
          options && options.length > 0 ? (
            <Select value={editValue} onValueChange={(v) => setEditValue(v)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : isDateField ? (
            <DateInput
              value={editValue}
              onChange={(iso) => setEditValue(iso)}
              className="h-7 text-xs"
            />
          ) : (
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
          )
        ) : (
          <span
            className={`text-sm truncate block ${
              shownValue ? 'text-foreground' : 'text-muted-foreground italic'
            }`}
          >
            {shownValue
              ? (isDateField ? fmtIsoDate(shownValue) : shownValue)
              : 'Not extracted'}
          </span>
        )}
      </div>

      {/* Confidence */}
      <div className="text-right">
        <ConfidenceBadge score={confidence} />
      </div>

      {/* Source badge */}
      <div className="flex justify-end">
        <SourceBadge source={sourceDocType} isHrOverride={isHrOverride} />
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
        document_type: docType,
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

  // ── Document viewer (preview the actual uploaded file) ──
  const [viewer, setViewer] = useState<{ open: boolean; loading: boolean; url: string | null; name: string; mime: string }>(
    { open: false, loading: false, url: null, name: '', mime: '' },
  )

  async function openDocumentViewer(doc: OnboardingDocument) {
    setViewer({ open: true, loading: true, url: null, name: doc.file_name, mime: '' })
    try {
      const { data, error } = await supabase.storage
        .from('employee-files')
        .createSignedUrl(doc.storage_path, 3600)
      if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not load document')
      const ext = (doc.file_name.split('.').pop() ?? '').toLowerCase()
      const mime = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)
        ? 'image'
        : ext === 'pdf'
        ? 'pdf'
        : 'other'
      setViewer({ open: true, loading: false, url: data.signedUrl, name: doc.file_name, mime })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load document')
      setViewer({ open: false, loading: false, url: null, name: '', mime: '' })
    }
  }

  const [activeTab, setActiveTab] = useState<'extracted' | 'validation'>('extracted')
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  // Drives live polling + the progress banner while extraction is running
  const [isExtracting, setIsExtracting] = useState(false)

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: sessionData, isLoading: sessionLoading } = useQuery<{ data: OnboardingSession }>({
    queryKey: ['onboarding-session', sessionId],
    queryFn: () => api.get(`/onboarding/sessions/${sessionId}`),
    enabled: !!sessionId,
    staleTime: 30_000,
    // While an extraction is running, poll so per-document status updates
    // (pending → processing → extracted/failed) appear live in the UI.
    refetchInterval: isExtracting ? 1200 : false,
  })

  const session = sessionData?.data

  // promotedDraftId: set immediately from the extraction response so the draft
  // query fires without waiting for the session to refetch and return draft_profile.id
  const [promotedDraftId, setPromotedDraftId] = useState<string | null>(null)
  const draftProfileId = session?.draft_profile?.id ?? promotedDraftId ?? null

  // Documents come from the session response (GET /sessions/:id returns them inline)
  const documents: OnboardingDocument[] = session?.documents ?? []

  // Document types flagged by the last identity check (name/DOB mismatch vs Aadhaar)
  const flaggedDocTypes = new Set(
    (validationResult?.identity_flags ?? []).map((t) => t.toLowerCase().replace(/[\s-]/g, '_')),
  )
  const isDocFlagged = (dt: string) => flaggedDocTypes.has(dt.toLowerCase().replace(/[\s-]/g, '_'))

  const { data: draftData, isLoading: draftLoading } = useQuery<{ data: DraftProfile }>({
    queryKey: ['onboarding-draft', draftProfileId],
    queryFn: () => api.get(`/onboarding/drafts/${draftProfileId}`),
    enabled: !!draftProfileId,
    staleTime: 30_000,
  })

  const draft = draftData?.data ?? null
  const fields = draft?.fields ?? []

  // ── Master data for dropdowns ──────────────────────────────────────────────
  const { data: deptData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments'),
    staleTime: 5 * 60_000,
  })
  const { data: desgData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ['designations'],
    queryFn: () => api.get('/designations'),
    staleTime: 5 * 60_000,
  })
  const { data: gradeData } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ['grades'],
    queryFn: () => api.get('/grades'),
    staleTime: 5 * 60_000,
  })

  const masterOptions: Record<string, FieldOption[]> = {
    departments:  (deptData?.data  ?? []).map((d) => ({ value: d.id, label: d.name })),
    designations: (desgData?.data  ?? []).map((d) => ({ value: d.id, label: d.name })),
    grades:       (gradeData?.data ?? []).map((d) => ({ value: d.id, label: d.name })),
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const { mutate: runExtraction, isPending: extracting } = useMutation({
    mutationFn: () => api.post<{ data: { documents_extracted: number; draft_profile_id: string | null; doc_errors?: Array<{ docId: string; step: string; reason: string }> } }>(
      `/onboarding/sessions/${sessionId}/extract`, {}
    ),
    onMutate: () => setIsExtracting(true),
    onSettled: () => setIsExtracting(false),
    onSuccess: async (resp) => {
      const count = resp?.data?.documents_extracted ?? 0
      const profileId = resp?.data?.draft_profile_id
      const docErrors = resp?.data?.doc_errors ?? []

      // Promote the draft id immediately so the draft query fires right away
      // without waiting for the session refetch to return draft_profile.id
      if (profileId) setPromotedDraftId(profileId)

      if (count > 0) {
        toast.success(`Extraction complete — ${count} document${count !== 1 ? 's' : ''} processed`)
        setActiveTab('extracted')
      } else {
        const firstError = docErrors[0]
        const description = firstError
          ? `${firstError.step}: ${firstError.reason}`
          : 'Check document status — it may have failed to download or parse.'
        toast.warning('Extraction ran but 0 documents were processed', { description })
      }

      // Small delay so the DB writes (doc status + draft profile) are fully committed
      // before we pull fresh data
      await new Promise(r => setTimeout(r, 600))
      await qc.invalidateQueries({ queryKey: ['onboarding-session', sessionId] })
      if (profileId) {
        await qc.invalidateQueries({ queryKey: ['onboarding-draft', profileId] })
      }
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

  const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')

  const { mutate: approveAndCreate, isPending: approving } = useMutation<{ data: { employee_id: string; employee_code: string; exception_pass?: boolean } }, Error, { exception_pass?: boolean; exception_reason?: string }>({
    mutationFn: (vars: { exception_pass?: boolean; exception_reason?: string }) =>
      api.post<{ data: { employee_id: string; employee_code: string; exception_pass?: boolean } }>(
        `/onboarding/drafts/${draftProfileId}/approve`,
        vars.exception_pass ? { exception_pass: true, exception_reason: vars.exception_reason } : {},
      ),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['onboarding-session', sessionId] })
      const code = resp.data?.employee_code
      if (resp.data?.exception_pass) {
        toast.success('Employee created with exception', {
          description: `${code} — document follow-up required`,
        })
      } else {
        toast.success('Employee created', { description: code ? `Employee code: ${code}` : undefined })
      }
      setExceptionDialogOpen(false)
      if (resp.data?.employee_id) navigate(`/admin/employees/${resp.data.employee_id}`)
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

  // Seed validationResult from persisted draft data on load — so "Approve with
  // Exception" button shows even after a page reload without re-running validation.
  const effectiveValidation: ValidationResult | null =
    validationResult ??
    (draft && (draft.validation_errors || draft.status === 'validation_pending')
      ? {
          validation_errors:   draft.validation_errors   ?? [],
          validation_warnings: draft.validation_warnings ?? [],
          duplicate_risk:      !!draft.duplicate_risk,
          identity_flags:      [],
          status:              draft.status,
        }
      : null)

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
              {(() => { const d=new Date(session.created_at.length===10?session.created_at+'T12:00:00Z':session.created_at); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(d.getTime())?'—':`${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}` })()}
            </p>
          </div>

          {/* Documents list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Documents ({documents.length})
              </p>
            </div>

            {/* Live extraction progress */}
            {isExtracting && documents.length > 0 && (() => {
              const done = documents.filter((d) =>
                ['extracted', 'completed', 'failed'].includes(d.extraction_status)).length
              const processingDoc = documents.find((d) => d.extraction_status === 'processing')
              const pct = Math.round((done / documents.length) * 100)
              return (
                <div className="mx-3 mb-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="text-[11px] font-medium text-foreground">
                      Extracting… {done} of {documents.length}
                    </span>
                  </div>
                  {processingDoc && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      Processing: {processingDoc.document_type.replace(/_/g, ' ')} — {processingDoc.file_name}
                    </p>
                  )}
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#047857] via-[#0F766E] to-[#1E40AF] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })()}

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
                    className={`w-full text-left px-3 py-2 rounded-md transition-colors border ${
                      doc.extraction_status === 'rejected' || isDocFlagged(doc.document_type)
                        ? 'border-destructive/40 bg-destructive/5'
                        : selectedDocId === doc.id
                        ? 'bg-primary/10 border-primary/20'
                        : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base leading-none">
                        {DOC_TYPE_ICON[doc.document_type] ?? '📎'}
                      </span>
                      <span className="text-xs font-medium text-foreground truncate flex-1">
                        {doc.document_type.replace(/_/g, ' ')}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        title="View document"
                        onClick={(e) => { e.stopPropagation(); void openDocumentViewer(doc) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); void openDocumentViewer(doc) } }}
                        className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mb-1">
                      {doc.file_name}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <ExtractionStatusBadge status={doc.extraction_status} />
                      <ConfidenceBadge score={doc.confidence_score ?? null} />
                      {isDocFlagged(doc.document_type) && (
                        <Badge variant="destructive" className="text-[9px] px-1.5 py-0 gap-0.5">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Identity mismatch
                        </Badge>
                      )}
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
                    <div className="grid grid-cols-[160px_1fr_56px_90px_32px] gap-2 px-3 pb-1 border-b border-border">
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
                        {section.fields.map(({ key, label }) => {
                          // Resolve dropdown options
                          const enumOpts = ENUM_OPTIONS[key]
                          const masterKey = MASTER_FIELD_KEYS[key]
                          const opts = enumOpts ?? (masterKey ? masterOptions[masterKey] : undefined)

                          // Resolve UUID → human-readable name for master fields
                          const rawVal = ((draft as any)?.[key] as string | null) ?? null
                          const displayVal = masterKey && rawVal
                            ? (masterOptions[masterKey]?.find((o) => o.value === rawVal)?.label ?? rawVal)
                            : undefined

                          return (
                            <FieldRow
                              key={key}
                              fieldKey={key}
                              label={label}
                              draft={draft}
                              fields={fields}
                              editingField={editingField}
                              onStartEdit={(k) => setEditingField(k)}
                              onSaveOverride={(fieldName, value) => saveOverride({ fieldName, value })}
                              onCancelEdit={() => setEditingField(null)}
                              options={opts}
                              displayValue={displayVal}
                            />
                          )
                        })}
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
                    <span className="text-xl">{DOC_TYPE_ICON[selectedDoc.document_type] ?? '📎'}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground capitalize">
                        {selectedDoc.document_type.replace(/_/g, ' ')}
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

                  {/* Rejection reason */}
                  {selectedDoc.extraction_status === 'rejected' && (selectedDoc as any).extraction_error && (
                    <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2">
                      <p className="text-[10px] text-destructive font-medium mb-0.5 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Document Rejected
                      </p>
                      <p className="text-[10px] text-destructive/80 leading-relaxed">
                        {(selectedDoc as any).extraction_error}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Re-upload the correct document for this candidate.
                      </p>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => openDocumentViewer(selectedDoc)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View Document
                  </Button>

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
                  onClick={() => approveAndCreate({})}
                >
                  {approving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5 mr-2" />
                  )}
                  {approving ? 'Creating Employee…' : 'Approve & Create Employee'}
                </Button>
              )}

              {/* Exception pass — shown when validation has errors but draft exists */}
              {!canApprove && draftProfileId &&
                effectiveValidation &&
                effectiveValidation.validation_errors.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start h-9 border-warning/40 text-warning hover:bg-warning/5"
                  disabled={approving}
                  onClick={() => { setExceptionReason(''); setExceptionDialogOpen(true) }}
                >
                  <UserCheck className="h-3.5 w-3.5 mr-2" />
                  Approve with Exception
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

      {/* ── Exception Approval Dialog ────────────────────────────────────────── */}
      <Dialog open={exceptionDialogOpen} onOpenChange={setExceptionDialogOpen}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Approve with Exception
            </DialogTitle>
            <DialogDescription>
              This candidate has validation issues. The employee will be created but flagged for document follow-up.
            </DialogDescription>
          </DialogHeader>

          {effectiveValidation && effectiveValidation.validation_errors.length > 0 && (
            <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 space-y-1.5">
              <p className="text-xs font-medium text-destructive">Overriding {effectiveValidation.validation_errors.length} error{effectiveValidation.validation_errors.length > 1 ? 's' : ''}:</p>
              {effectiveValidation.validation_errors.map((e, i) => (
                <p key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-destructive mt-0.5">•</span>{e}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Reason for exception <span className="text-muted-foreground">(optional)</span></Label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
              placeholder="e.g. Candidate joining urgently — bank proof to be submitted within 7 days"
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setExceptionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-warning hover:bg-warning/90 text-warning-foreground"
              disabled={approving}
              onClick={() => approveAndCreate({ exception_pass: true, exception_reason: exceptionReason || undefined })}
            >
              {approving ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <UserCheck className="h-3.5 w-3.5 mr-2" />}
              {approving ? 'Creating…' : 'Confirm & Create Employee'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Document Viewer ──────────────────────────────────────────────────── */}
      <Dialog
        open={viewer.open}
        onOpenChange={(o) => setViewer((v) => ({ ...v, open: o }))}
      >
        <DialogContent className="max-w-4xl w-[calc(100%-2rem)] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-sm flex items-center gap-2 min-w-0">
              <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{viewer.name || 'Document'}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">Document preview</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 bg-muted/30 overflow-auto flex items-center justify-center">
            {viewer.loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : !viewer.url ? (
              <p className="text-sm text-muted-foreground">Could not load document.</p>
            ) : viewer.mime === 'image' ? (
              <img src={viewer.url} alt={viewer.name} className="max-w-full max-h-full object-contain" />
            ) : (
              <iframe src={viewer.url} title={viewer.name} className="w-full h-full border-0" />
            )}
          </div>

          <DialogFooter className="px-4 py-3 border-t border-border">
            {viewer.url && (
              <Button variant="outline" size="sm" asChild>
                <a href={viewer.url} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
