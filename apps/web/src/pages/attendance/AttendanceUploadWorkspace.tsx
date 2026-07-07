/**
 * AttendanceUploadWorkspace — /admin/attendance/upload-workspace
 *
 * Sprint S7-A2: Operational attendance upload workspace for HR admins.
 *
 * Sections:
 *  1. Upload Panel           — drag/drop file, CSV/XLSX, preview, submit
 *  2. Upload Health Summary  — GET /attendance/upload-health status banner
 *  3. Recent Uploads Table   — GET /attendance/upload-sessions (30 s poll)
 *  4. Validation Error View  — row-level errors + downloadable error CSV
 *  5. Replay Warning UX      — duplicate_warning banner + confirmation
 *  6. Payroll Readiness Impact — impact banner when failures/stale uploads exist
 *  7. Operational Timeline    — deep-links into ObservabilityConsole
 */

import { useState, useRef, useCallback, useMemo, Fragment, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useNavigate }                             from 'react-router-dom'
import {
  Upload, Download, FileText, CheckCircle2, XCircle,
  AlertTriangle, Loader2, ShieldAlert, X, RefreshCw,
  Activity, Clock, History, TrendingDown, ExternalLink,
  RotateCcw, AlertCircle, Calendar,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { toast }  from 'sonner'
import * as XLSX  from 'xlsx'

import { PageContainer }          from '@/components/layout/PageContainer'
import { PageHeader }             from '@/components/layout/PageHeader'
import { SectionCard }            from '@/components/layout/SectionCard'
import { Button }                 from '@/components/ui/button'
import { Badge }                  from '@/components/ui/badge'
import { AsyncStatusBadge }       from '@/components/async'
import { OperationalErrorBanner } from '@/components/async'
import { MetricCard, MetricRow }  from '@/components/dashboard/MetricCard'
import { api }                    from '@/lib/api/client'
import { supabase }               from '@/lib/supabase/client'
import { useAuthStore }           from '@/stores/authStore'
import { cn }                     from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_COLUMNS  = ['employee_code', 'datetime'] as const
const OPTIONAL_COLUMNS  = ['source'] as const
// Accept both YYYY-MM-DD and DD-MM-YYYY (biometric devices often export DD-MM-YYYY)
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})[T ]\d{2}:\d{2}(:\d{2})?$/

// ── Types ─────────────────────────────────────────────────────────────────────

interface PreviewRow {
  line:     number
  fields:   Record<string, string>
  warnings: string[]
}

interface FailedRow {
  line:  number
  row:   string
  error: string
}

interface DuplicateWarning {
  upload_session_id: string
  uploaded_at:       string
}

interface UploadResult {
  total_rows:           number
  success_rows:         number
  failed_rows:          FailedRow[]
  duplicate_warning:    DuplicateWarning | null
  recompute_targets?:   number
  recompute_background?: boolean
}

interface UploadJobRef {
  job_id:     string
  total_rows: number
  filename:   string
}

interface UploadJob {
  id:             string
  status:         'queued' | 'processing' | 'completed' | 'failed'
  total_rows:     number
  processed_rows: number
  success_rows:   number
  failed_rows:    number
  skipped_rows:   number
  row_errors:     FailedRow[]
  error?:         string | null
  created_at:     string
  started_at?:    string | null
  completed_at?:  string | null
}

interface UploadedDateRange {
  from:           string   // YYYY-MM-DD
  to:             string   // YYYY-MM-DD
  employee_count: number
}

interface UploadHealthSummary {
  total_last_30d:   number
  completed:        number
  failed:           number
  orphaned:         number
  partial_failures: number
  replay_uploads:   number
}

interface UploadHealthFailure {
  id:             string
  file_name:      string | null
  created_at:     string
  error_message:  string | null
  result_summary: Record<string, unknown> | null
}

interface AttendanceUploadHealth {
  status:                 'healthy' | 'degraded' | 'critical'
  summary:                UploadHealthSummary
  recent_failures:        UploadHealthFailure[]
  stale_uploads:          Array<{ id: string; file_name: string | null; created_at: string }>
  last_successful_upload: string | null
}

interface UploadSession {
  id:               string
  status:           string
  file_name:        string
  file_size:        number
  created_at:       string
  result_summary:   {
    total_rows:   number
    success_rows: number
    failed_rows:  number
    is_replay?:   boolean
  } | null
  content_checksum: string | null
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function validateRow(fields: Record<string, string>): string[] {
  const w: string[] = []
  if (!fields.employee_code) w.push('employee_code is empty')
  if (!fields.datetime)      w.push('datetime is empty')
  else if (!DATETIME_RE.test(fields.datetime))
    w.push(`datetime "${fields.datetime}" — expected YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS`)
  return w
}

function normaliseDatePart(raw: string): string {
  // DD-MM-YYYY → YYYY-MM-DD so sort/group keys are consistent
  return /^\d{2}-\d{2}-\d{4}$/.test(raw) ? raw.split('-').reverse().join('-') : raw
}

function assignPreviewDirections(rows: { employee_code: string; datetime: string }[]): ('IN' | 'OUT' | '')[] {
  const directions: ('IN' | 'OUT' | '')[] = new Array(rows.length).fill('')
  const groups = new Map<string, number[]>()
  rows.forEach((row, idx) => {
    if (!row.employee_code || !DATETIME_RE.test(row.datetime)) return
    const date = normaliseDatePart(row.datetime.split(/[T ]/)[0])
    const key  = `${row.employee_code}::${date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(idx)
  })
  for (const [, indices] of groups) {
    // Sort by normalised datetime so DD-MM-YYYY and YYYY-MM-DD both sort correctly
    const sorted = [...indices].sort((a, b) => {
      const normA = rows[a].datetime.replace(/^(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')
      const normB = rows[b].datetime.replace(/^(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1')
      return normA.localeCompare(normB)
    })
    const n = sorted.length
    sorted.forEach((origIdx, pos) => {
      if (pos === 0)       directions[origIdx] = 'IN'
      else if (pos === n - 1) directions[origIdx] = 'OUT'
      else                 directions[origIdx] = pos % 2 === 0 ? 'IN' : 'OUT'
    })
  }
  return directions
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtBytes(bytes: number | null | undefined) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Module-scope so the object reference is stable across renders.
// Defined inside the component previously — caused a new object allocation
// every render, making React unable to detect stability for derived values.
const HEALTH_COLORS: Record<
  'healthy' | 'degraded' | 'critical',
  { bg: string; text: string; icon: React.ElementType }
> = {
  healthy:  { bg: 'bg-success/10 border-success/20',           text: 'text-success',     icon: CheckCircle2 },
  degraded: { bg: 'bg-warning/10 border-warning/20',           text: 'text-warning',     icon: AlertTriangle },
  critical: { bg: 'bg-destructive/10 border-destructive/20',   text: 'text-destructive', icon: XCircle },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AttendanceUploadWorkspace() {
  const { profile }  = useAuthStore()
  const isAdmin      = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')
  const qc           = useQueryClient()
  const navigate     = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Upload panel state ────────────────────────────────────────────────────
  const [fileName,    setFileName]    = useState<string | null>(null)
  const [csvText,     setCsvText]     = useState<string | null>(null)
  const [headers,     setHeaders]     = useState<string[]>([])
  const [missingCols, setMissingCols] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [totalRows,   setTotalRows]   = useState(0)
  const [result,            setResult]            = useState<UploadResult | null>(null)
  const [parseError,        setParseError]        = useState<string | null>(null)
  const [isDragging,        setIsDragging]        = useState(false)
  const [uploadedDateRange, setUploadedDateRange] = useState<UploadedDateRange | null>(null)
  const [activeJobId,       setActiveJobId]       = useState<string | null>(null)
  const [storageUploading,  setStorageUploading]  = useState(false)

  // ── Replay confirmation state ─────────────────────────────────────────────
  const [pendingReplay,   setPendingReplay]   = useState<string | null>(null)  // csvText to replay
  const [replayConfirmed, setReplayConfirmed] = useState(false)

  // ── Section 3: Recent uploads drill-down + show-all ──────────────────────
  const [expandedRows,   setExpandedRows]   = useState<Set<string>>(new Set())
  const [showAllUploads, setShowAllUploads] = useState(false)
  const UPLOADS_DEFAULT_LIMIT = 5
  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Section 2: Upload health ──────────────────────────────────────────────
  // staleTime == refetchInterval so a remount within the window doesn't trigger
  // both an immediate mount-refetch AND the interval at once (double-fetch).
  // placeholderData keeps the previous value visible during background refreshes,
  // preventing the "no uploads" empty-state from flashing on every 30 s poll.
  const {
    data:    healthData,
    isError: healthError,
  } = useQuery<AttendanceUploadHealth>({
    queryKey:        ['attendance-upload-health'],
    queryFn:         () => api.get<AttendanceUploadHealth>('/attendance/upload-health'),
    refetchInterval: 30_000,
    staleTime:       30_000,
    placeholderData: keepPreviousData,
    retry:           2,
  })

  // ── On mount: recover active job from server so the progress bar
  //    survives page navigation (activeJobId is local state, cleared on nav).
  useEffect(() => {
    api.get<UploadJob | null>('/attendance/upload/active-job')
      .then((job) => { if (job?.id) setActiveJobId(job.id) })
      .catch(() => {})
  }, [])

  // ── Active upload job polling ─────────────────────────────────────────────
  const { data: jobData } = useQuery<UploadJob>({
    queryKey:        ['attendance-upload-job', activeJobId],
    queryFn:         () => api.get<UploadJob>(`/attendance/upload/jobs/${activeJobId}`),
    enabled:         !!activeJobId,
    refetchInterval: (query) => {
      const d = query.state.data
      if (!d || d.status === 'completed' || d.status === 'failed') return false
      return 2_000
    },
  })

  useEffect(() => {
    if (!activeJobId || !jobData) return
    if (jobData.status !== 'completed' && jobData.status !== 'failed') return

    setActiveJobId(null)

    const failedCount = jobData.failed_rows ?? 0
    setResult({
      total_rows:           jobData.total_rows,
      success_rows:         jobData.success_rows,
      failed_rows:          jobData.row_errors ?? [],
      duplicate_warning:    null,
      recompute_background: true,
    })

    if (jobData.status === 'failed') {
      toast.error('Upload failed', { description: jobData.error ?? 'Processing error — check the upload history for details.' })
    } else {
      toast[failedCount > 0 ? 'warning' : 'success']('Attendance uploaded', {
        description: `${jobData.success_rows}/${jobData.total_rows} rows imported.${failedCount > 0 ? ` ${failedCount} failed.` : ''}`,
      })
    }
    qc.invalidateQueries({ queryKey: ['attendance-upload-sessions'] })
    qc.invalidateQueries({ queryKey: ['attendance-upload-health'] })
  }, [jobData, activeJobId, qc])

  // ── Section 3: Recent uploads ─────────────────────────────────────────────
  const {
    data:    recentData,
  } = useQuery<UploadSession[]>({
    queryKey:        ['attendance-upload-sessions'],
    queryFn:         () => api.get<{ data: UploadSession[] }>('/attendance/upload-sessions').then(r => r.data),
    refetchInterval: 30_000,
    staleTime:       30_000,
    placeholderData: keepPreviousData,
    retry:           2,
  })

  // ── XLSX → CSV ────────────────────────────────────────────────────────────
  function xlsxToCsv(buffer: ArrayBuffer): string {
    const wb   = XLSX.read(new Uint8Array(buffer), { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return ''
    return XLSX.utils.sheet_to_csv(sheet, { forceQuotes: false, blankrows: false })
  }

  // ── File processing ───────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    setResult(null)
    setParseError(null)
    setPendingReplay(null)
    setReplayConfirmed(false)
    setFileName(file.name)

    let text: string
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'xlsx' || ext === 'xls') {
      try {
        text = xlsxToCsv(await file.arrayBuffer())
        if (!text) {
          setParseError('The spreadsheet appears to be empty or could not be read.')
          setHeaders([]); setPreviewRows([]); setMissingCols([]); setTotalRows(0)
          return
        }
      } catch (err) {
        setParseError(`Failed to parse spreadsheet: ${err instanceof Error ? err.message : String(err)}`)
        setHeaders([]); setPreviewRows([]); setMissingCols([]); setTotalRows(0)
        return
      }
    } else {
      text = await file.text()
    }

    setCsvText(text)
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      setParseError('File must contain a header row and at least one data row.')
      setHeaders([]); setPreviewRows([]); setMissingCols([]); setTotalRows(0)
      return
    }

    const headerCols = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim())
    setHeaders(headerCols)
    const missing = REQUIRED_COLUMNS.filter(c => !headerCols.includes(c))
    setMissingCols(missing)

    const dataLines = lines.slice(1)
    setTotalRows(dataLines.length)

    // ── Extract uploaded date range + unique employee count ───────────────────
    const dtColIdx  = headerCols.indexOf('datetime')
    const empColIdx = headerCols.indexOf('employee_code')
    if (dtColIdx >= 0 && missing.length === 0) {
      const allDates: string[] = []
      const allEmployees = new Set<string>()
      for (const line of dataLines) {
        const cols = parseCsvLine(line)
        const dt   = cols[dtColIdx]?.trim()
        const emp  = cols[empColIdx]?.trim()
        if (dt && DATETIME_RE.test(dt)) allDates.push(normaliseDatePart(dt.split(/[T ]/)[0]))
        if (emp) allEmployees.add(emp)
      }
      if (allDates.length > 0) {
        allDates.sort()
        setUploadedDateRange({
          from:           allDates[0],
          to:             allDates[allDates.length - 1],
          employee_count: allEmployees.size,
        })
      } else {
        setUploadedDateRange(null)
      }
    } else {
      setUploadedDateRange(null)
    }

    const allRowMaps: { employee_code: string; datetime: string }[] = []
    const preview: PreviewRow[] = []
    for (let i = 0; i < Math.min(20, dataLines.length); i++) {
      const fields = parseCsvLine(dataLines[i])
      const rowMap: Record<string, string> = {}
      headerCols.forEach((col, idx) => { rowMap[col] = fields[idx] ?? '' })
      allRowMaps.push({ employee_code: rowMap.employee_code ?? '', datetime: rowMap.datetime ?? '' })
      preview.push({ line: i + 2, fields: rowMap, warnings: missing.length > 0 ? [] : validateRow(rowMap) })
    }
    const dirs = assignPreviewDirections(allRowMaps)
    dirs.forEach((dir, i) => { if (preview[i]) preview[i].fields.__direction = dir })
    setPreviewRows(preview)
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
    e.target.value = ''
  }, [processFile])

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }, [processFile])

  // ── Clear ──────────────────────────────────────────────────────────────────
  function handleClear() {
    setFileName(null); setCsvText(null); setHeaders([]); setMissingCols([])
    setPreviewRows([]); setTotalRows(0); setResult(null); setParseError(null)
    setPendingReplay(null); setReplayConfirmed(false); setUploadedDateRange(null)
    setActiveJobId(null); setStorageUploading(false)
  }

  // ── Upload mutation (posts storage path — tiny body, no timeout risk) ────────
  const uploadMutation = useMutation<UploadJobRef, Error, { storagePath: string; filename: string; totalRows: number }>({
    mutationFn: ({ storagePath, filename, totalRows }) =>
      api.post<UploadJobRef>('/attendance/upload', { storage_path: storagePath, filename, total_rows: totalRows }),
    onSuccess: (data) => {
      setActiveJobId(data.job_id)
      toast.info('Upload queued', { description: `${data.total_rows.toLocaleString()} rows are being processed in the background.` })
    },
    onError: e => toast.error('Upload failed', { description: e.message }),
  })

  async function uploadToStorage(csv: string): Promise<string | null> {
    // Ensure the JWT is fresh before uploading directly to Supabase Storage.
    // Tabs left open in the background may have a stale access token that
    // auto-refresh hasn't re-issued yet — this causes "exp claim timestamp
    // check failed" from the Storage API even though the user is logged in.
    // getSession() triggers a silent token refresh when the token is expired.
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
    if (sessionErr || !session) {
      toast.error('Session expired', {
        description: 'Your session has expired. Please refresh the page and log in again.',
      })
      return null
    }

    const safeFilename = (fileName ?? 'attendance_upload.csv').replace(/[^a-z0-9._\- ]/gi, '_')
    const storagePath  = `${profile!.tenant_id}/${Date.now()}-${safeFilename}`
    const blob = new Blob([csv], { type: 'text/csv' })
    const { error } = await supabase.storage
      .from('attendance-uploads')
      .upload(storagePath, blob, { contentType: 'text/csv', upsert: false })
    if (error) {
      const isJwtError = /exp|jwt|token|expired/i.test(error.message)
      toast.error(isJwtError ? 'Session expired' : 'File upload failed', {
        description: isJwtError
          ? 'Your session expired during upload. Refresh the page and try again.'
          : error.message,
      })
      return null
    }
    return storagePath
  }

  async function handleSubmit(csv?: string) {
    const content = csv ?? csvText
    if (!content) return
    setResult(null)
    setActiveJobId(null)
    setStorageUploading(true)
    try {
      const storagePath = await uploadToStorage(content)
      if (!storagePath) return
      uploadMutation.mutate({ storagePath, filename: fileName ?? 'attendance_upload.csv', totalRows })
    } finally {
      setStorageUploading(false)
    }
  }

  async function handleReplayConfirm() {
    setReplayConfirmed(true)
    setPendingReplay(null)
    if (!csvText) return
    setStorageUploading(true)
    try {
      const storagePath = await uploadToStorage(csvText)
      if (!storagePath) return
      uploadMutation.mutate({ storagePath, filename: fileName ?? 'attendance_upload.csv', totalRows })
    } finally {
      setStorageUploading(false)
    }
  }

  function handleDownloadSample() {
    api.getRaw('/attendance/sample-csv')
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = 'attendance_upload_sample.csv'; a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => toast.error('Failed to download sample CSV'))
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const hasErrors    = previewRows.some(r => r.warnings.length > 0)
  const canSubmit    = !!csvText && missingCols.length === 0 && !parseError && !pendingReplay
  const isJobActive  = !!activeJobId && (!jobData || (jobData.status !== 'completed' && jobData.status !== 'failed'))
  const isProcessing = storageUploading || uploadMutation.isPending || isJobActive

  // Section 6: Payroll impact assessment
  const payrollImpact = useMemo(() => {
    if (!healthData) return null
    const { status, summary, stale_uploads } = healthData
    if (status === 'healthy') return null
    const issues: string[] = []
    if (summary.failed > 0)
      issues.push(`${summary.failed} failed upload${summary.failed > 1 ? 's' : ''} in last 30 days`)
    if (summary.orphaned > 0)
      issues.push(`${summary.orphaned} orphaned session${summary.orphaned > 1 ? 's' : ''}`)
    if (stale_uploads.length > 0)
      issues.push(`${stale_uploads.length} stale upload${stale_uploads.length > 1 ? 's' : ''} (>48h old)`)
    if (summary.partial_failures > 0)
      issues.push(`${summary.partial_failures} partial upload${summary.partial_failures > 1 ? 's' : ''} (some rows failed)`)
    return issues.length > 0 ? { severity: status, issues } : null
  }, [healthData])

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Attendance Upload Workspace" subtitle="Operational upload management for HR admins" />
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">HR admin access required.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Attendance Upload Workspace"
        subtitle="Bulk-import attendance records — with health monitoring, replay detection and payroll impact visibility"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm" className="gap-1.5 text-xs"
              onClick={() => {
                // invalidateQueries rather than direct refetch() — this
                // marks both queries stale and lets React Query decide whether
                // to re-fetch (honours staleTime), avoiding double-fetches.
                qc.invalidateQueries({ queryKey: ['attendance-upload-health'],    exact: true })
                qc.invalidateQueries({ queryKey: ['attendance-upload-sessions'],  exact: true })
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="space-y-4">

        {/* ════════════════════════════════════════════════════════════════
            SECTION 2 — Upload Health Summary
        ════════════════════════════════════════════════════════════════ */}
        {/* HealthStatusCard is a pure sub-component (below) that uses the
            module-scope HEALTH_COLORS map.  No IIFE needed — avoids an
            anonymous function recreation on every render. */}
        {healthData && <HealthStatusCard healthData={healthData} />}

        {healthError && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            Health data unavailable — check backend connectivity.
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SECTION 6 — Payroll Readiness Impact
        ════════════════════════════════════════════════════════════════ */}
        {payrollImpact && (
          <div className={cn(
            'rounded-md border p-3 flex items-start gap-3',
            payrollImpact.severity === 'critical'
              ? 'bg-destructive/10 border-destructive/20'
              : 'bg-warning/10 border-warning/20',
          )}>
            <TrendingDown className={cn(
              'h-4 w-4 flex-shrink-0 mt-0.5',
              payrollImpact.severity === 'critical' ? 'text-destructive' : 'text-warning',
            )} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Payroll readiness at risk</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Attendance data issues may affect payroll accuracy for the current period.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {payrollImpact.issues.map((issue) => (
                  <li key={issue} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="h-1 w-1 rounded-full bg-muted-foreground flex-shrink-0" />
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              variant="outline" size="sm" className="text-xs h-7 gap-1.5 flex-shrink-0"
              onClick={() => navigate('/admin/attendance/payroll-readiness')}
            >
              <ExternalLink className="h-3 w-3" />
              View readiness
            </Button>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SECTION 5 — Replay Warning UX (shown when duplicate detected)
        ════════════════════════════════════════════════════════════════ */}
        {result?.duplicate_warning && !replayConfirmed && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
            <div className="flex items-start gap-3">
              <RotateCcw className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Duplicate upload detected</p>
                <p className="text-sm text-muted-foreground mt-1">
                  An identical CSV was already uploaded{' '}
                  <strong>{fmtDate(result.duplicate_warning.uploaded_at)}</strong>.
                  Re-uploading the same file will insert duplicate attendance records if any
                  punches were not yet present — and may distort payroll calculations.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={handleReplayConfirm}
                    disabled={isProcessing}
                  >
                    {isProcessing
                      ? <><Loader2 className="h-3 w-3 animate-spin" />Replaying…</>
                      : 'Yes, replay upload anyway'
                    }
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs"
                    onClick={handleClear}
                    disabled={isProcessing}
                  >
                    Cancel — discard this file
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SECTION 1 — Upload Panel
        ════════════════════════════════════════════════════════════════ */}
        <SectionCard
          title="Upload CSV / XLSX"
          icon={<Upload className="h-4 w-4 text-muted-foreground" />}
          action={
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleDownloadSample}>
              <Download className="h-3 w-3" />
              Sample CSV
            </Button>
          }
        >
          {/* Drag-drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'relative flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 cursor-pointer transition-colors',
              isDragging
                ? 'border-primary bg-primary/5'
                : fileName
                  ? 'border-border bg-muted/20 hover:bg-muted/30'
                  : 'border-border/60 bg-muted/10 hover:bg-muted/20 hover:border-border',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls"
              className="hidden"
              onChange={handleFileChange}
              disabled={isProcessing}
            />

            {storageUploading ? (
              <><Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Uploading file… (direct to storage, bypasses server)</p></>
            ) : uploadMutation.isPending ? (
              <><Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Starting import job…</p></>
            ) : fileName ? (
              <>
                <FileText className="h-8 w-8 text-primary" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">{fileName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {totalRows} data rows · Click or drag to replace
                  </p>
                </div>
                <button
                  className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground"
                  onClick={e => { e.stopPropagation(); handleClear() }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">
                    Drag &amp; drop or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">CSV or XLSX · one row per punch event</p>
                </div>
              </>
            )}
          </div>

          {/* Column format hint */}
          <div className="mt-3 p-3 rounded-md bg-muted/40 border border-border text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground text-[11px]">Required columns</p>
            <p className="font-mono">
              {REQUIRED_COLUMNS.join(', ')}
              <span className="ml-2 opacity-60">(optional: {OPTIONAL_COLUMNS.join(', ')})</span>
            </p>
            <p>
              <strong>datetime</strong> — <span className="font-mono">YYYY-MM-DD HH:MM</span> or <span className="font-mono">DD-MM-YYYY HH:MM</span> (biometric export format also accepted) in <em>tenant local time</em> (not UTC)
            </p>
            <p className="text-muted-foreground/80">
              One row = one punch event. System groups by employee + date, sorts by time, assigns <strong className="text-foreground">1st = IN, 2nd = OUT, 3rd = IN…</strong> automatically.
            </p>
          </div>

          {/* Parse error */}
          {parseError && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}

          {/* Missing columns */}
          {missingCols.length > 0 && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Missing required columns: <span className="font-mono font-semibold">{missingCols.join(', ')}</span>.
                Fix the CSV and re-upload.
              </span>
            </div>
          )}

          {/* Progress bar — storage upload phase */}
          {storageUploading && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-muted-foreground">Uploading file directly to Supabase Storage…</p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full w-2/3 rounded-full bg-primary animate-pulse" />
              </div>
            </div>
          )}
          {/* Progress bar — job creation phase */}
          {uploadMutation.isPending && (
            <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
            </div>
          )}

          {/* Progress bar — background job processing */}
          {isJobActive && jobData && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {jobData.status === 'queued' ? 'Queued — processing will start shortly…' : 'Processing in background…'}
                </span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums font-mono">
                    {jobData.processed_rows.toLocaleString()} / {jobData.total_rows.toLocaleString()} rows
                  </span>
                  <button
                    type="button"
                    className="text-[10px] underline underline-offset-2 opacity-60 hover:opacity-100"
                    onClick={() => setActiveJobId(null)}
                    title="Dismiss this job tracker (upload continues in background)"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${jobData.total_rows > 0 ? Math.min(100, (jobData.processed_rows / jobData.total_rows) * 100) : 0}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                You can navigate away — the import will continue and you can return here to check the result.
              </p>
            </div>
          )}
          {isJobActive && !jobData && (
            <div className="mt-3 space-y-1">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full w-1/4 rounded-full bg-primary animate-pulse" />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-[10px] underline underline-offset-2 opacity-60 hover:opacity-100"
                  onClick={() => setActiveJobId(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Upload failure */}
          {uploadMutation.isError && (
            <div className="mt-3">
              <OperationalErrorBanner
                error={uploadMutation.error?.message ?? 'Upload failed.'}
                severity="high"
                remediationText="Check that your CSV is well-formed and all required columns are present, then retry."
                onRetry={() => { void handleSubmit() }}
                retrying={uploadMutation.isPending}
              />
            </div>
          )}
        </SectionCard>

        {/* ════════════════════════════════════════════════════════════════
            SECTION 1b — CSV Preview Table
        ════════════════════════════════════════════════════════════════ */}
        {previewRows.length > 0 && !result && (
          <SectionCard
            title={`Preview — first ${previewRows.length} of ${totalRows} rows`}
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            action={
              <div className="flex items-center gap-3">
                {hasErrors ? (
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {previewRows.filter(r => r.warnings.length > 0).length} row(s) with issues
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Preview looks valid
                  </span>
                )}
                <Button
                  onClick={() => handleSubmit()}
                  disabled={!canSubmit || isProcessing}
                  size="sm"
                  className="gap-1.5 h-7"
                >
                  {isProcessing
                    ? <><Loader2 className="h-3 w-3 animate-spin" />{isJobActive ? 'Processing…' : 'Uploading…'}</>
                    : <><Upload className="h-3 w-3" />Submit {totalRows} rows</>
                  }
                </Button>
              </div>
            }
          >
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold w-10">#</th>
                    {headers.map(col => (
                      <th key={col} className={cn(
                        'px-3 py-2 text-left font-semibold',
                        REQUIRED_COLUMNS.includes(col as typeof REQUIRED_COLUMNS[number])
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                      )}>
                        {col}
                        {REQUIRED_COLUMNS.includes(col as typeof REQUIRED_COLUMNS[number]) && (
                          <span className="ml-1 text-[9px] text-primary align-super">*</span>
                        )}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left text-primary font-semibold">Direction</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(row => {
                    const bad = row.warnings.length > 0
                    return (
                      <tr key={row.line} className={cn(
                        'border-b border-border/50 last:border-0',
                        bad ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/30',
                      )}>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.line}</td>
                        {headers.map(col => (
                          <td key={col} className={cn(
                            'px-3 py-2 font-mono',
                            !row.fields[col] && REQUIRED_COLUMNS.includes(col as typeof REQUIRED_COLUMNS[number])
                              ? 'text-destructive'
                              : 'text-foreground',
                          )}>
                            {row.fields[col] || <span className="text-destructive/60 italic">empty</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          {row.fields.__direction === 'IN' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-success/15 text-success">IN</span>
                          )}
                          {row.fields.__direction === 'OUT' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">OUT</span>
                          )}
                          {!row.fields.__direction && (
                            <span className="text-muted-foreground/50 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {bad ? (
                            <div className="flex flex-col gap-0.5">
                              {row.warnings.map((w, i) => (
                                <span key={i} className="flex items-center gap-1 text-destructive text-[10px]">
                                  <XCircle className="h-2.5 w-2.5 flex-shrink-0" />{w}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {totalRows > 20 && (
              <p className="mt-2 text-xs text-center text-muted-foreground">
                Showing first 20 rows — {totalRows - 20} more not previewed.
              </p>
            )}
          </SectionCard>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SECTION 4 — Upload Result + Validation Error Viewer
        ════════════════════════════════════════════════════════════════ */}
        {result && (!result.duplicate_warning || replayConfirmed) && (
          <SectionCard
            title="Upload Result"
            icon={
              result.failed_rows.length === 0
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <AlertTriangle className="h-4 w-4 text-warning" />
            }
          >
            {/* Summary chips */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-md bg-muted/40 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">Total Rows</p>
                <p className="font-display text-2xl font-bold text-foreground">{result.total_rows}</p>
              </div>
              <div className="p-3 rounded-md bg-success/10 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">Succeeded</p>
                <p className="font-display text-2xl font-bold text-success">{result.success_rows}</p>
              </div>
              <div className={cn('p-3 rounded-md text-center', result.failed_rows.length > 0 ? 'bg-destructive/10' : 'bg-muted/40')}>
                <p className="text-[10px] text-muted-foreground mb-0.5">Failed</p>
                <p className={cn('font-display text-2xl font-bold', result.failed_rows.length > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                  {result.failed_rows.length}
                </p>
              </div>
            </div>

            {/* FIX 5 — Uploaded Period summary */}
            {uploadedDateRange && result.success_rows > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-primary/8 border border-primary/20 mb-4">
                <Calendar className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-primary">
                    Uploaded period: {uploadedDateRange.from} → {uploadedDateRange.to}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {uploadedDateRange.employee_count} employee{uploadedDateRange.employee_count !== 1 ? 's' : ''} · {result.success_rows} rows processed
                    · Attendance recompute triggered
                  </p>
                </div>
              </div>
            )}

            {/* Full success */}
            {result.failed_rows.length === 0 && result.success_rows > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-success/10 border border-success/20 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                All {result.success_rows} row{result.success_rows !== 1 ? 's' : ''} imported. Attendance recomputed.
              </div>
            )}

            {/* Zero imported — no errors either (duplicates or sealed periods) */}
            {result.failed_rows.length === 0 && result.success_rows === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-sm text-warning">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                No rows were imported. All records may already exist, or all dates fall in a payroll-sealed period.
              </div>
            )}

            {/* Partial success — never shown as plain success */}
            {result.failed_rows.length > 0 && result.success_rows > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-sm text-warning mb-4">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                <strong>Partial import:</strong>&nbsp;
                {result.success_rows} succeeded, {result.failed_rows.length} failed — see error details below.
                Payroll may be incomplete for affected employees.
              </div>
            )}

            {/* Error table (Section 4) */}
            {result.failed_rows.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Failed rows ({result.failed_rows.length})
                  </p>
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                    onClick={() => {
                      const rows = result.failed_rows.map(
                        fr => `"${(fr.row ?? '').replace(/"/g, '""')}","${fr.error.replace(/"/g, '""')}"`
                      )
                      const blob = new Blob([`row_data,error\n${rows.join('\n')}`], { type: 'text/csv' })
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob); a.download = 'attendance_upload_failed_rows.csv'; a.click()
                    }}
                  >
                    <Download className="h-3 w-3" />
                    Download error CSV
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold w-14">Line</th>
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Row data</th>
                        <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.failed_rows.map((fr) => (
                        <tr key={fr.line} className="border-b border-border/50 last:border-0 bg-destructive/5">
                          <td className="px-3 py-2 tabular-nums text-destructive font-semibold">{fr.line}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground max-w-xs truncate" title={fr.row}>
                            {fr.row || '—'}
                          </td>
                          <td className="px-3 py-2 text-destructive">
                            <span className="flex items-center gap-1">
                              <XCircle className="h-3 w-3 flex-shrink-0" />
                              {fr.error}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="mt-4">
              <Button variant="outline" size="sm" onClick={handleClear} className="gap-2">
                <Upload className="h-3.5 w-3.5" />
                Upload another file
              </Button>
            </div>
          </SectionCard>
        )}

        {/* ════════════════════════════════════════════════════════════════
            SECTION 3 — Recent Uploads Table
        ════════════════════════════════════════════════════════════════ */}
        <SectionCard
          title="Recent Uploads"
          icon={<History className="h-4 w-4 text-muted-foreground" />}
          action={
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Auto-refreshes every 30s
            </span>
          }
        >
          {!recentData || recentData.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Activity className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No attendance uploads recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-3 py-2 w-6" />
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Uploaded</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">File</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Size</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Status</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Rows</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Success</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Failed</th>
                    <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Replay?</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllUploads ? recentData : recentData.slice(0, UPLOADS_DEFAULT_LIMIT)).map(sess => {
                    const summary = sess.result_summary
                    const isPartial = (summary?.failed_rows ?? 0) > 0 && (summary?.success_rows ?? 0) > 0
                    return (
                      <Fragment key={sess.id}>
                        <tr
                          onClick={() => toggleRow(sess.id)}
                          className={cn(
                            'border-b border-border/50 last:border-0 transition-colors hover:bg-muted/20 cursor-pointer select-none',
                            sess.status === 'failed' && 'bg-destructive/5',
                            isPartial && 'bg-warning/5',
                          )}
                        >
                          <td className="px-3 py-2 w-6">
                            {expandedRows.has(sess.id)
                              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                            {fmtDate(sess.created_at)}
                          </td>
                          <td className="px-3 py-2 text-foreground max-w-[160px] truncate" title={sess.file_name}>
                            {sess.file_name}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {fmtBytes(sess.file_size)}
                          </td>
                          <td className="px-3 py-2">
                            <AsyncStatusBadge status={sess.status} />
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {summary?.total_rows ?? '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-success">
                            {summary?.success_rows ?? '—'}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            <span className={cn(
                              (summary?.failed_rows ?? 0) > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground',
                            )}>
                              {summary?.failed_rows ?? '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {summary?.is_replay ? (
                              <Badge variant="warning" className="text-[10px] h-4 rounded-full">Replay</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                        {expandedRows.has(sess.id) && (
                          <tr className="bg-muted/10 border-b border-border/50">
                            <td colSpan={9} className="px-6 py-3">
                              <div className="space-y-2">
                                {/* Row breakdown bar */}
                                {summary && summary.total_rows > 0 && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                      <span>Row breakdown</span>
                                      <span>{summary.success_rows} success · {summary.failed_rows} failed · {summary.total_rows} total</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                                      <div
                                        className="h-full bg-success"
                                        style={{ width: `${(summary.success_rows / summary.total_rows) * 100}%` }}
                                      />
                                      {summary.failed_rows > 0 && (
                                        <div
                                          className="h-full bg-destructive"
                                          style={{ width: `${(summary.failed_rows / summary.total_rows) * 100}%` }}
                                        />
                                      )}
                                    </div>
                                  </div>
                                )}
                                {/* Meta row */}
                                <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
                                  <span>Session ID: <span className="font-mono text-foreground/60">{sess.id.slice(0, 8)}…</span></span>
                                  {sess.content_checksum && (
                                    <span>Checksum: <span className="font-mono text-foreground/60">{sess.content_checksum.slice(0, 12)}…</span></span>
                                  )}
                                  {summary?.is_replay && (
                                    <Badge variant="warning" className="text-[10px] h-4 rounded-full">Replay upload</Badge>
                                  )}
                                  {sess.status === 'failed' && (
                                    <span className="text-destructive font-medium">Upload failed — check server logs</span>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(recentData?.length ?? 0) > UPLOADS_DEFAULT_LIMIT && (
            <div className="border-t border-border px-4 py-2 text-center">
              <button
                onClick={() => setShowAllUploads(v => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAllUploads
                  ? 'Show less ↑'
                  : `Show ${(recentData?.length ?? 0) - UPLOADS_DEFAULT_LIMIT} more ↓`}
              </button>
            </div>
          )}
        </SectionCard>


      </div>
    </PageContainer>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

// ── HealthStatusCard ──────────────────────────────────────────────────────────
// Extracted from an IIFE to a proper sub-component so React can optimise it
// (stable reference, no anonymous function created on each parent render).
// Uses the module-scope HEALTH_COLORS map — no per-render object allocation.

interface HealthStatusCardProps {
  healthData: AttendanceUploadHealth
}

function HealthStatusCard({ healthData }: HealthStatusCardProps) {
  const cfg  = HEALTH_COLORS[healthData.status]
  const Icon = cfg.icon
  return (
    <div className={cn('rounded-md border p-4', cfg.bg)}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Status */}
        <div className="flex items-center gap-2">
          <Icon className={cn('h-5 w-5', cfg.text)} />
          <div>
            <p className={cn('text-sm font-semibold capitalize', cfg.text)}>
              Upload pipeline {healthData.status}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last successful:{' '}
              {healthData.last_successful_upload
                ? fmtDate(healthData.last_successful_upload)
                : 'No successful uploads recorded'}
            </p>
          </div>
        </div>

        {/* Metric chips */}
        <MetricRow cols={3}>
          <MetricCard compact label="Total (30d)"  value={healthData.summary.total_last_30d}    variant="neutral" />
          <MetricCard compact label="Completed"    value={healthData.summary.completed}          variant={healthData.summary.completed > 0 ? 'success' : 'neutral'} />
          <MetricCard compact label="Failed"       value={healthData.summary.failed}             variant={healthData.summary.failed > 0 ? 'destructive' : 'neutral'} />
          <MetricCard compact label="Partial"      value={healthData.summary.partial_failures}   variant={healthData.summary.partial_failures > 0 ? 'warning' : 'neutral'} />
          <MetricCard compact label="Orphaned"     value={healthData.summary.orphaned}           variant={healthData.summary.orphaned > 0 ? 'warning' : 'neutral'} />
          <MetricCard compact label="Replays"      value={healthData.summary.replay_uploads}     variant="neutral" />
        </MetricRow>
      </div>

      {/* Recent failures */}
      {healthData.recent_failures.length > 0 && (
        <div className="mt-3 border-t border-border/30 pt-3">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Recent failures ({healthData.recent_failures.length})
          </p>
          <div className="space-y-1">
            {healthData.recent_failures.slice(0, 3).map(f => (
              <div key={f.id} className="flex items-center gap-2 text-xs">
                <XCircle className="h-3 w-3 text-destructive flex-shrink-0" />
                <span className="text-muted-foreground">{fmtDate(f.created_at)}</span>
                <span className="text-destructive truncate">{f.error_message ?? 'Unknown error'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

