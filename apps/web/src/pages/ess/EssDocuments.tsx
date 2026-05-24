/**
 * EssDocuments — /ess/documents
 *
 * Employee view of their own HR documents — contracts, letters, identity records.
 * Read-only access: employees can view and request documents; upload goes through HR.
 *
 * Tokens only — no raw hex / bg-gray-*.
 */

import { useState }  from 'react'
import { useQuery }  from '@tanstack/react-query'
import {
  FileText, Download, Eye, AlertTriangle, Loader2,
  FileImage, File, FileBadge, FolderOpen, Info,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmpDocument {
  id:           string
  name:         string
  doc_type:     string
  storage_path: string | null
  file_size:    number | null
  mime_type:    string | null
  created_at:   string
}

interface EmpContract {
  id:            string
  contract_type: string
  start_date:    string | null
  end_date:      string | null
  status:        string
  storage_path:  string | null
  created_at:    string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(`${s}T12:00:00Z`).toLocaleDateString([], {
    day: 'numeric', month: 'short', year: 'numeric',
  })
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

// ── Document row ──────────────────────────────────────────────────────────────

function DocRow({ doc }: { doc: EmpDocument }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-0 gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <FileIcon mime={doc.mime_type} />
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{doc.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {doc.doc_type.replace(/_/g, ' ')}
            {doc.file_size ? ` · ${fmtSize(doc.file_size)}` : ''}
            {' · '}{fmtDate(doc.created_at)}
          </p>
        </div>
      </div>
      {doc.storage_path ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <span className="text-[10px] text-muted-foreground italic flex-shrink-0">No file</span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function EssDocuments() {
  const { profile } = useAuthStore()
  const employeeId  = profile?.employee_id ?? null
  const [activeTab, setActiveTab] = useState<'documents' | 'contracts'>('documents')

  const { data: docData, isLoading: docLoading } = useQuery<EmpDocument[]>({
    queryKey: ['ess-documents', employeeId],
    queryFn:  () => api.get(`/employees/${employeeId}/documents`).then((r: any) => r.data),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  const { data: contractData, isLoading: contractLoading } = useQuery<EmpContract[]>({
    queryKey: ['ess-contracts', employeeId],
    queryFn:  () => api.get(`/employees/${employeeId}/contracts`).then((r: any) => r.data),
    enabled:  !!employeeId,
    staleTime: 60_000,
  })

  const documents = docData ?? []
  const contracts = contractData ?? []

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

  const tabs = [
    { key: 'documents' as const,  label: 'Documents',  count: documents.length  },
    { key: 'contracts' as const,  label: 'Contracts',  count: contracts.length  },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="My Documents"
        subtitle="Your HR documents, contracts, and official letters"
      />

      {/* ── Tab strip ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-border pb-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5',
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full',
                activeTab === t.key ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Documents tab ─────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <SectionCard
          title="HR Documents"
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        >
          {docLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading documents…
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 py-12">
              <FolderOpen className="h-9 w-9 text-muted-foreground opacity-40" />
              <p className="text-sm font-medium text-foreground">No documents on record</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
                Documents uploaded by HR will appear here — offer letters, ID proofs, certificates, and more.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {documents.map(doc => <DocRow key={doc.id} doc={doc} />)}
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
                  {c.storage_path && (
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                        <Eye className="h-3 w-3" /> View PDF
                      </Button>
                    </div>
                  )}
                </div>
              ))}
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
