/**
 * EssDocuments — /ess/documents
 *
 * Employee view of their own HR documents — contracts, letters, identity records.
 * Read-only access: employees can view and request documents; upload goes through HR.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Download, Eye, AlertTriangle, Loader2,
  FileImage, File, FileBadge, FolderOpen, Info,
  Upload, Trash2, CalendarClock, ShieldAlert,
  Fingerprint, Plane, BadgeCheck,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'
import { SubTabs }       from '@/components/ui/SubTabs'
import { toast }         from 'sonner'
import { uploadEmployeeFile } from '@/lib/supabase-storage'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmpDocument {
  id:                    string
  name:                  string
  doc_type:              string
  storage_path:          string | null
  /** 1-hour signed download URL returned by the API — use this for View/Download */
  signed_url:            string | null
  signed_url_expires_in: number | null
  file_size:             number | null
  mime_type:             string | null
  expires_at:            string | null
  /** true when the employee uploaded this document themselves (deletable) */
  is_own:                boolean
  created_at:            string
}

type ExpiryBucket = 'overdue' | 'due_7' | 'due_30' | 'due_90'
type ExpiryCategory = 'document' | 'identity' | 'passport' | 'visa' | 'contract'

interface ExpiryItem {
  id:            string
  category:      ExpiryCategory
  label:         string
  detail:        string | null
  due_date:      string
  days_to_due:   number
  bucket:        ExpiryBucket
}

interface ExpirySummary {
  total: number
  by_bucket: Record<ExpiryBucket, number>
}

interface EmpContract {
  id:            string
  contract_type: string
  start_date:    string | null
  end_date:      string | null
  status:        string
  storage_path:  string | null
  /** Signed download URL if available */
  signed_url:    string | null
  created_at:    string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ mime }: { mime: string | null }) {
  if (!mime) return <File className="h-4 w-4 text-muted-foreground" />
  if (mime.includes('pdf'))   return <FileText className="h-4 w-4 text-destructive" />
  if (mime.includes('image')) return <FileImage className="h-4 w-4 text-info" />
  return <FileBadge className="h-4 w-4 text-muted-foreground" />
}

const CONTRACT_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  active:      'success',
  draft:       'warning',
  expired:     'secondary',
  terminated:  'destructive',
}

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  appointment:  'Appointment Letter',
  renewal:      'Renewal',
  amendment:    'Amendment',
  nda:          'NDA',
  other:        'Other',
}

// ── Expiry presentation ─────────────────────────────────────────────────────────

const BUCKET_META: Record<ExpiryBucket, { label: string; variant: 'destructive' | 'warning' | 'secondary'; tone: string }> = {
  overdue: { label: 'Expired',      variant: 'destructive', tone: 'text-destructive' },
  due_7:   { label: 'Due ≤ 7 days', variant: 'destructive', tone: 'text-destructive' },
  due_30:  { label: 'Due ≤ 30 days',variant: 'warning',     tone: 'text-warning' },
  due_90:  { label: 'Due ≤ 90 days',variant: 'secondary',   tone: 'text-muted-foreground' },
}

const EXPIRY_CATEGORY_META: Record<ExpiryCategory, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  document: { label: 'Document', icon: FileText },
  identity: { label: 'Identity', icon: Fingerprint },
  passport: { label: 'Passport', icon: Plane },
  visa:     { label: 'Visa',     icon: BadgeCheck },
  contract: { label: 'Contract', icon: FileBadge },
}

/** Document types an employee may upload themselves (constraint-valid). */
const UPLOAD_DOC_TYPES: { value: string; label: string }[] = [
  { value: 'certificate', label: 'Certificate' },
  { value: 'aadhaar',     label: 'Aadhaar' },
  { value: 'pan',         label: 'PAN' },
  { value: 'other',       label: 'Other' },
]

/** Relative expiry hint, e.g. "in 12 days" / "23 days ago". */
function expiryHint(days: number): string {
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  if (days === 0) return 'today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// ── Document row ──────────────────────────────────────────────────────────────

interface DocRowProps {
  doc:         EmpDocument
  refreshing:  boolean
  deleting:    boolean
  onView:      (doc: EmpDocument) => void
  onDownload:  (doc: EmpDocument) => void
  onDelete:    (doc: EmpDocument) => void
}

/** Days until a YYYY-MM-DD date (negative = past). null when no date. */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const due = Date.parse(dateStr.slice(0, 10) + 'T00:00:00Z')
  const now = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  return Math.round((due - now) / 86_400_000)
}

function DocRow({ doc, refreshing, deleting, onView, onDownload, onDelete }: DocRowProps) {
  // Presence check only — never open storage_path directly (relative path, not URL)
  const hasFile = !!(doc.signed_url || doc.storage_path)
  const expDays = daysUntil(doc.expires_at)
  const expBucket: ExpiryBucket | null =
    expDays === null ? null : expDays < 0 ? 'overdue' : expDays <= 7 ? 'due_7' : expDays <= 30 ? 'due_30' : expDays <= 90 ? 'due_90' : null

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <FileIcon mime={doc.mime_type} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-foreground truncate">{doc.name}</p>
            {doc.is_own && <Badge variant="outline" className="rounded-full text-[9px] px-1.5">Uploaded by you</Badge>}
            {expBucket && (
              <Badge variant={BUCKET_META[expBucket].variant} className="rounded-full text-[9px] px-1.5">
                {expBucket === 'overdue' ? 'Expired' : `Expires ${expiryHint(expDays!)}`}
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {doc.doc_type.replace(/_/g, ' ')}
            {doc.file_size ? ` · ${fmtSize(doc.file_size)}` : ''}
            {' · '}{fmtDate(doc.created_at)}
            {doc.expires_at ? ` · expires ${fmtDate(doc.expires_at)}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {hasFile ? (
          <>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View" disabled={refreshing} onClick={() => onView(doc)}>
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download" disabled={refreshing} onClick={() => onDownload(doc)}>
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            </Button>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground italic">No file</span>
        )}
        {doc.is_own && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" title="Delete" disabled={deleting} onClick={() => onDelete(doc)}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Threshold (ms) before the 1-hour signed URL TTL at which we pro-actively
 * refresh.  Set to 55 minutes so URLs are refreshed with a 5-minute buffer.
 * Also used on click to detect a stale URL before opening.
 */
const URL_REFRESH_THRESHOLD_MS = 55 * 60 * 1000   // 55 min of 60 min TTL

export function EssDocuments() {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()
  const employeeId  = profile?.employee_id ?? null
  const tenantId    = profile?.tenant_id ?? null
  const [activeTab, setActiveTab] = useState<'documents' | 'contracts' | 'expiry'>('documents')

  // Track which document (by id) is currently being URL-refreshed so we can
  // show a spinner on the correct row's buttons.
  const [refreshingDocId, setRefreshingDocId] = useState<string | null>(null)
  // Track which contract is being refreshed
  const [refreshingContractId, setRefreshingContractId] = useState<string | null>(null)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)

  // ── Upload form state ────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false)
  const [upFile, setUpFile]   = useState<File | null>(null)
  const [upName, setUpName]   = useState('')
  const [upType, setUpType]   = useState('certificate')
  const [upExpiry, setUpExpiry] = useState('')
  const [uploading, setUploading] = useState(false)

  const {
    data: docData,
    isLoading: docLoading,
    refetch: refetchDocs,
    dataUpdatedAt: docUpdatedAt,
  } = useQuery<EmpDocument[]>({
    queryKey: ['ess-documents', employeeId],
    queryFn:  () => api.get<{ data: EmpDocument[] }>('/ess/me/documents').then(r => r.data),
    enabled:  !!employeeId,
    // Pro-active refresh every 45 min ensures signed URLs (1h TTL) never expire
    // while the tab is in focus, eliminating the need for on-click refresh in most cases.
    staleTime:       45 * 60 * 1000,
    refetchInterval: 45 * 60 * 1000,
  })

  const {
    data: expiryData,
    isLoading: expiryLoading,
  } = useQuery<{ data: ExpiryItem[]; summary: ExpirySummary }>({
    queryKey: ['ess-expiry', employeeId],
    queryFn:  () => api.get('/ess/me/expiry'),
    enabled:  !!employeeId,
  })

  const {
    data: contractData,
    isLoading: contractLoading,
    refetch: refetchContracts,
    dataUpdatedAt: contractUpdatedAt,
  } = useQuery<EmpContract[]>({
    queryKey: ['ess-contracts', employeeId],
    queryFn:  () => api.get<{ data: EmpContract[] }>(`/employees/${employeeId}/contracts`).then(r => r.data),
    enabled:  !!employeeId,
    staleTime:       45 * 60 * 1000,
    refetchInterval: 45 * 60 * 1000,
  })

  const documents = docData ?? []
  const contracts = contractData ?? []

  // ── Signed-URL helpers ───────────────────────────────────────────────────────
  // Opens a window synchronously (avoids Safari popup blocking) then redirects
  // to either the cached URL (if fresh) or a freshly fetched one.
  const openDocUrl = useCallback(async (doc: EmpDocument, mode: 'view' | 'download') => {
    const isUrlStale = !doc.signed_url || (Date.now() - docUpdatedAt) > URL_REFRESH_THRESHOLD_MS

    // Open immediately to stay within the synchronous click handler — prevents
    // popup blocking in Safari and Firefox. If we need a fresh URL we redirect
    // the already-opened window after the async fetch.
    const win = mode === 'view'
      ? window.open(isUrlStale ? 'about:blank' : doc.signed_url!, '_blank', 'noopener,noreferrer')
      : null

    if (!isUrlStale && doc.signed_url) {
      if (mode === 'download') {
        const a = document.createElement('a')
        a.href = doc.signed_url; a.download = doc.name
        a.rel = 'noopener noreferrer'; a.target = '_blank'; a.click()
      }
      return
    }

    // URL is stale — fetch fresh data
    setRefreshingDocId(doc.id)
    try {
      const result   = await refetchDocs()
      const freshDoc = (result.data ?? []).find(d => d.id === doc.id)
      const freshUrl = freshDoc?.signed_url ?? null

      if (!freshUrl) {
        win?.close()
        toast.error('Document URL unavailable', { description: 'The file may have been removed. Contact HR.' })
        return
      }

      if (mode === 'view' && win) {
        win.location.href = freshUrl
      } else if (mode === 'download') {
        const a = document.createElement('a')
        a.href = freshUrl; a.download = doc.name
        a.rel = 'noopener noreferrer'; a.target = '_blank'; a.click()
      }
    } catch {
      win?.close()
      toast.error('Failed to refresh document URL — please try again')
    } finally {
      setRefreshingDocId(null)
    }
  }, [docUpdatedAt, refetchDocs])

  const openContractUrl = useCallback(async (contract: EmpContract) => {
    const isUrlStale = !contract.signed_url || (Date.now() - contractUpdatedAt) > URL_REFRESH_THRESHOLD_MS

    const win = window.open(
      isUrlStale ? 'about:blank' : contract.signed_url!,
      '_blank',
      'noopener,noreferrer',
    )

    if (!isUrlStale && contract.signed_url) return

    setRefreshingContractId(contract.id)
    try {
      const result       = await refetchContracts()
      const freshContract = (result.data ?? []).find(c => c.id === contract.id)
      const freshUrl      = freshContract?.signed_url ?? null

      if (!freshUrl) {
        win?.close()
        toast.error('Contract URL unavailable', { description: 'Contact HR.' })
        return
      }
      if (win) win.location.href = freshUrl
    } catch {
      win?.close()
      toast.error('Failed to refresh contract URL — please try again')
    } finally {
      setRefreshingContractId(null)
    }
  }, [contractUpdatedAt, refetchContracts])

  // ── Upload + delete ──────────────────────────────────────────────────────────
  async function handleUpload() {
    if (!upFile || !employeeId || !tenantId) return
    if (upFile.size > 5 * 1024 * 1024) { toast.error('File exceeds 5 MB limit'); return }
    setUploading(true)
    try {
      const path = await uploadEmployeeFile(tenantId, employeeId, 'documents', upFile)
      await api.post('/ess/me/documents', {
        name:         upName.trim() || upFile.name,
        doc_type:     upType,
        storage_path: path,
        file_size:    upFile.size,
        mime_type:    upFile.type || null,
        expires_at:   upExpiry || undefined,
      })
      toast.success('Document uploaded')
      setUploadOpen(false); setUpFile(null); setUpName(''); setUpType('certificate'); setUpExpiry('')
      // Same backend documents table also backs the HR vault (['documents'])
      // and the employee profile documents tab (['emp-docs', id]) — invalidate
      // by prefix so uploading from ESS doesn't leave those views stale.
      qc.invalidateQueries({ queryKey: ['ess-documents', employeeId] })
      qc.invalidateQueries({ queryKey: ['ess-expiry', employeeId] })
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: ['emp-docs'] })
    } catch (e) {
      toast.error('Upload failed', { description: e instanceof Error ? e.message : 'Please try again' })
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(doc: EmpDocument) {
    setDeletingDocId(doc.id)
    try {
      await api.delete(`/ess/me/documents/${doc.id}`)
      toast.success('Document deleted')
      qc.invalidateQueries({ queryKey: ['ess-documents', employeeId] })
      qc.invalidateQueries({ queryKey: ['ess-expiry', employeeId] })
      qc.invalidateQueries({ queryKey: ['documents'] })
      qc.invalidateQueries({ queryKey: ['emp-docs'] })
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : 'Please try again' })
    } finally {
      setDeletingDocId(null)
    }
  }

  if (!employeeId) {
    return (
      <PageContainer>
        <PageHeader title="My Documents" subtitle="HR documents and contracts" />
        <SectionCard>
          <div className="flex flex-col items-center gap-2 py-12">
            <AlertTriangle className="h-7 w-7 text-warning opacity-60" />
            <p className="text-sm font-medium text-foreground">Profile not linked</p>
            <p className="text-xs text-muted-foreground">Contact HR to link your account to an employee record.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  const expiryItems   = expiryData?.data ?? []
  const expiryActive  = expiryItems.filter(i => i.bucket === 'overdue' || i.bucket === 'due_7' || i.bucket === 'due_30').length

  const tabs = [
    { key: 'documents' as const,  label: 'Documents',     count: documents.length  },
    { key: 'contracts' as const,  label: 'Contracts',     count: contracts.length  },
    { key: 'expiry'    as const,  label: 'Expiry Alerts', count: expiryActive || undefined },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="My Documents"
        subtitle="Your HR documents, contracts, and official letters"
      />

      {/* ── Tab strip ──────────────────────────────────────────────────────── */}
      <SubTabs<typeof activeTab>
        tabs={tabs.map(t => ({ id: t.key, label: t.label, badge: t.count }))}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* ── Documents tab ─────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <SectionCard
          title="HR Documents"
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          action={!uploadOpen && (
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" />Upload
            </Button>
          )}
        >
          {uploadOpen && (
            <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">File (max 5 MB)</label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={e => { const f = e.target.files?.[0] ?? null; setUpFile(f); if (f && !upName) setUpName(f.name) }}
                    className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary/10 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Name</label>
                  <Input className="h-9 text-sm" placeholder="Document name" value={upName} onChange={e => setUpName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type</label>
                  <select
                    value={upType}
                    onChange={e => setUpType(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {UPLOAD_DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Expiry date (optional)</label>
                  <Input className="h-9 text-sm" type="date" value={upExpiry} onChange={e => setUpExpiry(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => { setUploadOpen(false); setUpFile(null); setUpName(''); setUpExpiry('') }}>Cancel</Button>
                <Button size="sm" onClick={handleUpload} disabled={!upFile || uploading}>
                  {uploading && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Upload
                </Button>
              </div>
            </div>
          )}
          {docLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading documents…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-12">
              <FolderOpen className="h-9 w-9 text-muted-foreground opacity-40" />
              <p className="text-sm font-medium text-foreground">No documents on record</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Documents uploaded by HR appear here — offer letters, ID proofs, certificates. You can also upload your own with the button above.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {documents.map(doc => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  refreshing={refreshingDocId === doc.id}
                  deleting={deletingDocId === doc.id}
                  onView={(d)     => openDocUrl(d, 'view')}
                  onDownload={(d) => openDocUrl(d, 'download')}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Contracts tab ─────────────────────────────────────────────────── */}
      {activeTab === 'contracts' && (
        <SectionCard
          title="Employment Contracts"
          icon={<FileBadge className="h-4 w-4 text-muted-foreground" />}
        >
          {contractLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading contracts…
            </div>
          ) : contracts.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-12">
              <FileBadge className="h-9 w-9 text-muted-foreground opacity-40" />
              <p className="text-sm font-medium text-foreground">No contracts on record</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Your employment contracts will appear here once uploaded by HR.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {contracts.map(c => (
                <div key={c.id} className="border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        {CONTRACT_TYPE_LABEL[c.contract_type] ?? c.contract_type}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fmtDate(c.start_date)}
                        {c.end_date ? ` → ${fmtDate(c.end_date)}` : ' — No end date'}
                      </p>
                    </div>
                    <Badge
                      variant={CONTRACT_STATUS_VARIANT[c.status] ?? 'outline'}
                      className="rounded-full text-[10px] capitalize"
                    >
                      {c.status}
                    </Badge>
                  </div>
                  {(c.signed_url || c.storage_path) && (
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        disabled={refreshingContractId === c.id}
                        onClick={() => openContractUrl(c)}
                      >
                        {refreshingContractId === c.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Eye className="h-3 w-3" />
                        }
                        View PDF
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Expiry Alerts tab ─────────────────────────────────────────────── */}
      {activeTab === 'expiry' && (
        <SectionCard
          title="Expiry Alerts"
          description="Your documents, identity records, passport, visa and contracts approaching expiry. Keep them current to avoid disruptions."
          icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
        >
          {expiryLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking expiries…
            </div>
          ) : expiryItems.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-12">
              <BadgeCheck className="h-9 w-9 text-success opacity-50" />
              <p className="text-sm font-medium text-foreground">Nothing expiring</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                None of your records are overdue or due within the next year. We'll alert you here when something needs renewal.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {expiryItems
                .slice()
                .sort((a, b) => a.days_to_due - b.days_to_due)
                .map(item => {
                  const meta   = EXPIRY_CATEGORY_META[item.category]
                  const bucket = BUCKET_META[item.bucket]
                  const Icon   = meta?.icon ?? FileText
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-muted', bucket.tone)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {meta?.label ?? item.category}
                            {item.detail ? ` · ${item.detail}` : ''}
                            {' · '}{fmtDate(item.due_date)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={cn('text-[10px] font-medium tabular-nums', bucket.tone)}>
                          {item.bucket === 'overdue' ? `expired ${expiryHint(item.days_to_due)}` : expiryHint(item.days_to_due)}
                        </span>
                        <Badge variant={bucket.variant} className="rounded-full text-[9px]">{bucket.label}</Badge>
                      </div>
                    </div>
                  )
                })}
              <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2 mt-1">
                <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
                <span>For passport, visa or identity records managed by HR, raise an HR support ticket to update them. Self-uploaded documents can be replaced from the Documents tab.</span>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Info note ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2.5">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-info" />
        <span>
          To request a copy of a document or report a missing file, please raise an HR support ticket. All documents are stored securely and accessible only by you and authorized HR personnel.
        </span>
      </div>
    </PageContainer>
  )
}
