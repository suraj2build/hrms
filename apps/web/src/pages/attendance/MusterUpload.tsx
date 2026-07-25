/**
 * MusterUpload — HR Muster Roll Upload
 *
 * Flow:
 *  1. HR selects a date range and downloads the pre-filled Excel template
 *  2. HR fills the Status column (P / A / HLF) in the template
 *  3. HR uploads the filled file — the page parses it client-side and shows a preview
 *  4. HR clicks "Apply" — the data is sent to the API and attendance_daily is updated
 *  5. Upload history is shown at the bottom for audit purposes
 *
 * Muster wins: uploaded statuses overwrite any biometric-derived status for that day.
 * Punch records (raw logs) are left untouched — they remain for audit.
 * Payroll-locked periods are rejected row-by-row with an error message.
 */

import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import {
  Upload, Download, FileSpreadsheet, CheckCircle2,
  AlertTriangle, Loader2, RotateCcw, ChevronDown, ChevronUp,
  History,
} from 'lucide-react'

import { api }        from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { Button }     from '@/components/ui/button'
import { Badge }      from '@/components/ui/badge'
import { DateInput }  from '@/components/ui/date-input'
import { cn }         from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type MusterStatus = 'P' | 'A' | 'HLF'

interface ParsedRow {
  employee_code: string
  date:          string
  status:        MusterStatus
}

interface UploadError {
  row:           number
  employee_code: string
  date:          string
  reason:        string
}

interface UploadResult {
  upload_id:     string
  row_count:     number
  success_count: number
  error_count:   number
  errors:        UploadError[]
}

interface UploadHistory {
  id:            string
  filename:      string
  period_from:   string
  period_to:     string
  row_count:     number
  success_count: number
  error_count:   number
  created_at:    string
  uploaded_by:   string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUSES = new Set<string>(['P', 'A', 'HLF'])

function today() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonth() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function fmtDate(iso: string) {
  const s = iso
  const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2,'0')}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

function fmtDateTime(iso: string) {
  const d = new Date(iso)
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (isNaN(d.getTime())) return '—'
  const hr = String(d.getHours()).padStart(2,'0')
  const mn = String(d.getMinutes()).padStart(2,'0')
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()} ${hr}:${mn}`
}

function normaliseHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase()
}

/** Parse the uploaded Excel file and return valid muster rows. */
function parseExcel(file: File): Promise<{ rows: ParsedRow[]; parseErrors: string[] }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data  = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb    = XLSX.read(data, { type: 'array' })

        // Find the "Muster" sheet (first sheet if not found by name)
        const sheetName = wb.SheetNames.includes('Muster')
          ? 'Muster'
          : wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]

        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })

        if (rawRows.length === 0) {
          resolve({ rows: [], parseErrors: ['File is empty'] })
          return
        }

        // Resolve columns by HEADER NAME, not fixed position. The template
        // (routes/attendance/muster-upload.ts) writes
        // ['Employee Code', 'Employee Name', 'Date', 'Status (P / A / HLF)'] —
        // reordering, inserting, or deleting a column while editing the file
        // must not silently misattribute a value to the wrong field. This is
        // the exact bug class that corrupted salary upload data this week;
        // the header row is the only safe source of truth for column
        // position, never a hardcoded index.
        const headerRow  = rawRows[0].map(normaliseHeader)
        const empCodeIdx = headerRow.findIndex(h => h === 'employee code')
        const dateIdx    = headerRow.findIndex(h => h === 'date')
        const statusIdx  = headerRow.findIndex(h => h.startsWith('status'))

        const missing: string[] = []
        if (empCodeIdx === -1) missing.push('Employee Code')
        if (dateIdx    === -1) missing.push('Date')
        if (statusIdx  === -1) missing.push('Status')
        if (missing.length > 0) {
          resolve({
            rows: [],
            parseErrors: [
              `Missing required column(s): ${missing.join(', ')}. Re-download a fresh template — don't rename or reorder the header row.`,
            ],
          })
          return
        }

        const parseErrors: string[] = []
        const rows: ParsedRow[]     = []

        // Row 0 is the header — skip it
        for (let i = 1; i < rawRows.length; i++) {
          const raw = rawRows[i]
          const empCode = String(raw[empCodeIdx] ?? '').trim()
          const dateVal = String(raw[dateIdx] ?? '').trim()
          const status  = String(raw[statusIdx] ?? '').trim().toUpperCase()

          // Skip blank status rows — they mean "no change"
          if (!status) continue

          if (!empCode) {
            parseErrors.push(`Row ${i + 1}: missing employee code`)
            continue
          }

          // Normalise Excel date serial → string if needed
          let date = dateVal
          if (/^\d+$/.test(dateVal)) {
            // Excel date serial
            const d = XLSX.SSF.parse_date_code(Number(dateVal))
            date = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            parseErrors.push(`Row ${i + 1} (${empCode}): invalid date "${dateVal}" — use YYYY-MM-DD`)
            continue
          }

          if (!VALID_STATUSES.has(status)) {
            parseErrors.push(`Row ${i + 1} (${empCode}): invalid status "${String(raw[statusIdx])}" — use P, A, or HLF`)
            continue
          }

          rows.push({ employee_code: empCode, date, status: status as MusterStatus })
        }

        resolve({ rows, parseErrors })
      } catch (err) {
        resolve({ rows: [], parseErrors: [`Failed to parse Excel file: ${(err as Error).message}`] })
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MusterUpload() {
  const qc = useQueryClient()
  const { profile } = useAuthStore()

  // Only hr_admin / super_admin should see this page (enforced by backend too)
  const isAdmin = ['hr_admin', 'super_admin'].includes(profile?.role ?? '')

  // ── Date range state ──────────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState(firstOfMonth())
  const [toDate,   setToDate]   = useState(today())

  // ── Upload state ──────────────────────────────────────────────────────────
  const [parsedRows,   setParsedRows]   = useState<ParsedRow[]>([])
  const [parseErrors,  setParseErrors]  = useState<string[]>([])
  const [filename,     setFilename]     = useState('')
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [showErrors,   setShowErrors]   = useState(false)
  const [isParsing,    setIsParsing]    = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── History query ─────────────────────────────────────────────────────────
  const { data: historyData, refetch: refetchHistory } = useQuery<{ data: UploadHistory[] }>({
    queryKey:  ['muster-upload-history'],
    queryFn:   () => api.get('/attendance/muster/uploads'),
    staleTime: 60_000,
  })
  const history = historyData?.data ?? []

  // ── Download template ─────────────────────────────────────────────────────
  const [isDownloading, setIsDownloading] = useState(false)

  async function downloadTemplate() {
    if (!fromDate || !toDate || fromDate > toDate) {
      toast.error('Invalid date range', { description: '"From" must be on or before "To"' })
      return
    }
    setIsDownloading(true)
    try {
      // api.getRaw uses the same relative URL + auth header as all other api calls
      // (routes through the Vite proxy in dev, VITE_API_URL in prod)
      const res  = await api.getRaw(`/attendance/muster/upload/template?from=${fromDate}&to=${toDate}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `muster-${fromDate}-to-${toDate}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Template downloaded')
    } catch (err: unknown) {
      toast.error('Download failed', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setIsDownloading(false)
    }
  }

  // ── File selection & parsing ──────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsParsing(true)
    setUploadResult(null)
    setFilename(file.name)

    const { rows, parseErrors: errs } = await parseExcel(file)
    setParsedRows(rows)
    setParseErrors(errs)
    setIsParsing(false)

    if (errs.length && !rows.length) {
      toast.error(`File has ${errs.length} error(s) — no valid rows found`)
    } else if (rows.length) {
      toast.success(`Parsed ${rows.length.toLocaleString()} rows${errs.length ? ` (${errs.length} skipped)` : ''}`)
    }

    // Reset input so the same file can be re-selected after changes
    e.target.value = ''
  }, [])

  // ── Apply upload ──────────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: () => api.post<UploadResult>('/attendance/muster/upload', {
      filename,
      rows: parsedRows,
    }),
    onSuccess: (res) => {
      const result = (res as { data?: UploadResult }).data ?? res
      setUploadResult(result)
      setParsedRows([])
      setFilename('')
      setShowErrors(result.error_count > 0)
      if (result.error_count === 0) {
        toast.success(`✅ ${(result.success_count ?? 0).toLocaleString()} attendance records updated`)
      } else if (result.success_count > 0) {
        toast.warning(`Applied ${(result.success_count ?? 0).toLocaleString()} rows — ${result.error_count} failed`)
      } else {
        toast.error(`Upload failed — all ${result.error_count} rows had errors`)
      }
      qc.invalidateQueries({ queryKey: ['muster-upload-history'] })
      refetchHistory()
    },
    onError: (err: Error) => {
      toast.error('Upload failed', { description: err.message })
    },
  })

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // Simulate file input change
    const dt = new DataTransfer()
    dt.items.add(file)
    if (fileInputRef.current) {
      fileInputRef.current.files = dt.files
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }

  // ── Status badge helper ───────────────────────────────────────────────────
  function StatusBadge({ status }: { status: MusterStatus }) {
    const map: Record<MusterStatus, { label: string; cls: string }> = {
      P:   { label: 'Present',  cls: 'bg-success/10 text-success border-success/30'    },
      A:   { label: 'Absent',   cls: 'bg-destructive/10 text-destructive border-destructive/30' },
      HLF: { label: 'Half Day', cls: 'bg-warning/10 text-warning border-warning/30'    },
    }
    const { label, cls } = map[status]
    return (
      <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border', cls)}>
        {label}
      </span>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
        HR Admin access required to use this feature.
      </div>
    )
  }

  return (
    <div className="space-y-5 p-1">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-foreground">Muster Upload</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upload daily attendance status (P / A / HLF) for all employees.
          Muster overrides biometric-derived status. Punches are kept for audit.
        </p>
      </div>

      {/* ── Step 1 — Download Template ─────────────────────────────────────── */}
      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span>
          <p className="text-sm font-medium text-foreground">Download Template</p>
        </div>
        <p className="text-xs text-muted-foreground ml-7">
          Select the period, download the pre-filled template, fill in the Status column (P / A / HLF) and re-upload below.
        </p>
        <div className="ml-7 flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground font-medium">From</label>
            <DateInput
              value={fromDate}
              onChange={setFromDate}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground font-medium">To</label>
            <DateInput
              value={toDate}
              onChange={setToDate}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={downloadTemplate}
            disabled={isDownloading || !fromDate || !toDate}
          >
            {isDownloading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />
            }
            Download Template
          </Button>
        </div>
      </div>

      {/* ── Step 2 — Upload Filled File ────────────────────────────────────── */}
      <div className="rounded-lg border border-border/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span>
          <p className="text-sm font-medium text-foreground">Upload Filled File</p>
        </div>

        {/* Drop zone */}
        <div
          className={cn(
            'ml-7 relative rounded-lg border-2 border-dashed transition-colors cursor-pointer',
            parsedRows.length > 0
              ? 'border-success/40 bg-success/5'
              : 'border-border/50 hover:border-primary/40 hover:bg-muted/40',
          )}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            {isParsing ? (
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            ) : parsedRows.length > 0 ? (
              <CheckCircle2 className="h-8 w-8 text-success" />
            ) : (
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground/40" />
            )}
            <p className="text-sm font-medium text-foreground">
              {isParsing
                ? 'Parsing file…'
                : parsedRows.length > 0
                  ? `${filename} — ${parsedRows.length.toLocaleString()} rows ready`
                  : 'Drop Excel file here or click to browse'
              }
            </p>
            {!isParsing && !parsedRows.length && (
              <p className="text-xs text-muted-foreground">.xlsx or .xls · up to 150,000 rows</p>
            )}
          </div>
        </div>

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <div className="ml-7 rounded-md border border-warning/40 bg-warning/5 p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
              <span className="text-xs font-semibold text-warning">{parseErrors.length} row(s) skipped during parsing</span>
            </div>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {parseErrors.slice(0, 20).map((e, i) => (
                <li key={i} className="text-[11px] text-muted-foreground">• {e}</li>
              ))}
              {parseErrors.length > 20 && (
                <li className="text-[11px] text-muted-foreground">… and {parseErrors.length - 20} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Preview: status breakdown */}
        {parsedRows.length > 0 && (
          <div className="ml-7 rounded-md border border-border/60 bg-muted/20 px-4 py-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4 text-xs">
                {(['P', 'A', 'HLF'] as MusterStatus[]).map(s => {
                  const count = parsedRows.filter(r => r.status === s).length
                  return count > 0 ? (
                    <div key={s} className="flex items-center gap-1.5">
                      <StatusBadge status={s} />
                      <span className="font-medium text-foreground">{count.toLocaleString()}</span>
                    </div>
                  ) : null
                })}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => {
                  setParsedRows([])
                  setParseErrors([])
                  setFilename('')
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 3 — Apply ─────────────────────────────────────────────────── */}
      {parsedRows.length > 0 && (
        <div className="rounded-lg border border-border/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span>
            <p className="text-sm font-medium text-foreground">Apply to Attendance</p>
          </div>
          <p className="text-xs text-muted-foreground ml-7">
            This will update <strong>{parsedRows.length.toLocaleString()}</strong> attendance records.
            Existing biometric-derived statuses will be overwritten. This cannot be undone.
          </p>
          <div className="ml-7">
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => uploadMutation.mutate()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Upload className="h-3.5 w-3.5" />
              }
              {uploadMutation.isPending
                ? `Applying ${parsedRows.length.toLocaleString()} rows…`
                : `Apply ${parsedRows.length.toLocaleString()} rows`
              }
            </Button>
          </div>
        </div>
      )}

      {/* ── Upload Result ─────────────────────────────────────────────────── */}
      {uploadResult && (
        <div className={cn(
          'rounded-lg border p-4 space-y-3',
          uploadResult.error_count === 0
            ? 'border-success/40 bg-success/5'
            : uploadResult.success_count > 0
              ? 'border-warning/40 bg-warning/5'
              : 'border-destructive/40 bg-destructive/5',
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {uploadResult.error_count === 0
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <AlertTriangle className="h-4 w-4 text-warning" />
              }
              <p className="text-sm font-medium text-foreground">Upload Complete</p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {(uploadResult.success_count ?? 0).toLocaleString()} applied · {(uploadResult.error_count ?? 0).toLocaleString()} failed
            </Badge>
          </div>

          {uploadResult.error_count > 0 && (
            <div>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowErrors(v => !v)}
              >
                {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showErrors ? 'Hide' : 'Show'} {uploadResult.errors.length} error{uploadResult.errors.length !== 1 ? 's' : ''}
              </button>

              {showErrors && (
                <div className="mt-2 rounded-md border border-border/60 overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Row</th>
                        <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Employee Code</th>
                        <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Date</th>
                        <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {uploadResult.errors.map((e, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-3 py-1.5 text-muted-foreground">{e.row}</td>
                          <td className="px-3 py-1.5 font-mono">{e.employee_code}</td>
                          <td className="px-3 py-1.5">{e.date}</td>
                          <td className="px-3 py-1.5 text-destructive/80">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Upload History ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/40">
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upload History</p>
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetchHistory()}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>

        {history.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
            No uploads yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/10">
                <tr>
                  <th className="px-4 py-2 text-left text-muted-foreground font-medium">File</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Period</th>
                  <th className="px-3 py-2 text-right text-muted-foreground font-medium">Rows</th>
                  <th className="px-3 py-2 text-right text-muted-foreground font-medium">Applied</th>
                  <th className="px-3 py-2 text-right text-muted-foreground font-medium">Errors</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">Uploaded By</th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {history.map(h => (
                  <tr key={h.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 font-medium text-foreground truncate max-w-[200px]" title={h.filename}>
                      <div className="flex items-center gap-1.5">
                        <FileSpreadsheet className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
                        <span className="truncate">{h.filename}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {fmtDate(h.period_from)} → {fmtDate(h.period_to)}
                    </td>
                    <td className="px-3 py-2 text-right">{(h.row_count ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-success font-medium">{(h.success_count ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      {h.error_count > 0
                        ? <span className="text-destructive font-medium">{(h.error_count ?? 0).toLocaleString()}</span>
                        : <span className="text-muted-foreground/50">—</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{h.uploaded_by ?? '—'}</td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDateTime(h.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
