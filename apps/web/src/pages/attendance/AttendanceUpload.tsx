/**
 * AttendanceUpload — /attendance/upload
 *
 * CSV bulk-upload flow for HR admins:
 *   1. Download sample CSV to learn the required format
 *   2. Pick a CSV file from disk
 *   3. Preview first 20 rows, see inline validation warnings
 *   4. Confirm & submit → server processes, recomputes attendance
 *   5. View per-row success / error summary
 *
 * Design rules: design-system tokens only — no raw hex / bg-gray-* / text-blue-*.
 */

import { useState, useRef, useCallback }         from 'react'
import { useMutation }                            from '@tanstack/react-query'
import {
  Upload, Download, FileText, CheckCircle2,
  XCircle, AlertTriangle, Loader2, ShieldAlert, X,
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

import { PageContainer }         from '@/components/layout/PageContainer'
import { PageHeader }            from '@/components/layout/PageHeader'
import { SectionCard }           from '@/components/layout/SectionCard'
import { Button }                from '@/components/ui/button'
import { OperationalErrorBanner } from '@/components/async'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { api }                   from '@/lib/api/client'
import { useAuthStore }          from '@/stores/authStore'
import { cn }                    from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

const REQUIRED_COLUMNS = ['employee_code', 'datetime'] as const
const OPTIONAL_COLUMNS = ['source'] as const

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/

interface PreviewRow {
  /** 1-indexed line number in the file (header = 1). */
  line:          number
  /** Raw field values keyed by lower-cased column name. */
  fields:        Record<string, string>
  /** Validation warnings for this row (pre-submit, client-side only). */
  warnings:      string[]
}

interface FailedRow {
  line:  number
  row:   string
  error: string
}

interface UploadResult {
  total_rows:           number
  success_rows:         number
  failed_rows:          FailedRow[]
  recompute_targets?:   number
  recompute_background?: boolean
}

// ── CSV helpers ────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current  = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else { inQuotes = !inQuotes }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function validateRow(fields: Record<string, string>): string[] {
  const warnings: string[] = []

  if (!fields.employee_code) warnings.push('employee_code is empty')

  if (!fields.datetime) warnings.push('datetime is empty')
  else if (!DATETIME_RE.test(fields.datetime))
    warnings.push(`datetime "${fields.datetime}" — expected YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS`)

  return warnings
}

/**
 * Compute preview directions: group rows by (employee_code, date), sort by time,
 * assign IN/OUT alternately — mirrors the server-side logic so the preview
 * shows the user exactly which punches become IN vs OUT before they submit.
 */
function assignPreviewDirections(rows: { employee_code: string; datetime: string }[]): ('IN' | 'OUT' | '')[] {
  const directions: ('IN' | 'OUT' | '')[] = new Array(rows.length).fill('')
  const groups = new Map<string, number[]>()

  rows.forEach((row, idx) => {
    if (!row.employee_code || !DATETIME_RE.test(row.datetime)) return
    const date = row.datetime.split(/[T ]/)[0]
    const key  = `${row.employee_code}::${date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(idx)
  })

  for (const [, indices] of groups) {
    const sorted = [...indices].sort((a, b) =>
      rows[a].datetime.localeCompare(rows[b].datetime)
    )
    sorted.forEach((originalIdx, pos) => {
      directions[originalIdx] = pos % 2 === 0 ? 'IN' : 'OUT'
    })
  }
  return directions
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AttendanceUpload() {
  const { profile } = useAuthStore()
  const isAdmin     = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── State ──────────────────────────────────────────────────────────────────
  const [fileName,    setFileName]    = useState<string | null>(null)
  const [csvText,     setCsvText]     = useState<string | null>(null)
  const [headers,     setHeaders]     = useState<string[]>([])
  const [missingCols, setMissingCols] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [totalRows,   setTotalRows]   = useState(0)
  const [result,      setResult]      = useState<UploadResult | null>(null)
  const [parseError,  setParseError]  = useState<string | null>(null)

  // ── Download sample ────────────────────────────────────────────────────────
  function handleDownloadSample() {
    api.getRaw('/attendance/sample-csv')
      .then((res) => res.blob())
      .then((blob) => {
        const url  = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href     = url
        link.download = 'attendance_upload_sample.csv'
        link.click()
        URL.revokeObjectURL(url)
      })
      .catch((err) => {
        console.error('Sample CSV download failed', err)
      })
  }

  // ── XLSX → CSV converter ────────────────────────────────────────────────────
  function xlsxToCsv(buffer: ArrayBuffer): string {
    const workbook  = XLSX.read(new Uint8Array(buffer), { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return ''
    const sheet = workbook.Sheets[sheetName]
    // sheet_to_csv produces RFC-4180 CSV with CRLF line endings
    return XLSX.utils.sheet_to_csv(sheet, { forceQuotes: false, blankrows: false })
  }

  // ── File pick + parse ──────────────────────────────────────────────────────
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setResult(null)
      setParseError(null)
      setFileName(file.name)

      // Convert XLSX/XLS to CSV text first; CSV files pass through as-is
      let text: string
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (ext === 'xlsx' || ext === 'xls') {
        try {
          const buffer = await file.arrayBuffer()
          text = xlsxToCsv(buffer)
          if (!text) {
            setParseError('The spreadsheet appears to be empty or could not be read.')
            setHeaders([]); setPreviewRows([]); setMissingCols([]); setTotalRows(0)
            e.target.value = ''
            return
          }
        } catch (err) {
          setParseError(`Failed to parse spreadsheet: ${err instanceof Error ? err.message : String(err)}`)
          setHeaders([]); setPreviewRows([]); setMissingCols([]); setTotalRows(0)
          e.target.value = ''
          return
        }
      } else {
        text = await file.text()
      }

      setCsvText(text)

      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length < 2) {
        setParseError('The file must contain a header row and at least one data row.')
        setHeaders([]); setPreviewRows([]); setMissingCols([]); setTotalRows(0)
        e.target.value = ''
        return
      }

      const headerCols = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim())
      setHeaders(headerCols)

      const missing = REQUIRED_COLUMNS.filter((c) => !headerCols.includes(c))
      setMissingCols(missing)

      const dataLines = lines.slice(1)
      setTotalRows(dataLines.length)

      // Preview: first 20 rows
      const allRowMaps: { employee_code: string; datetime: string }[] = []
      const preview: PreviewRow[] = []
      for (let i = 0; i < Math.min(20, dataLines.length); i++) {
        const fields = parseCsvLine(dataLines[i])
        const rowMap: Record<string, string> = {}
        headerCols.forEach((col, idx) => { rowMap[col] = fields[idx] ?? '' })
        allRowMaps.push({ employee_code: rowMap.employee_code ?? '', datetime: rowMap.datetime ?? '' })
        preview.push({
          line:     i + 2,
          fields:   rowMap,
          warnings: missing.length > 0 ? [] : validateRow(rowMap),
        })
      }
      // Compute preview directions for the first 20 rows
      const dirs = assignPreviewDirections(allRowMaps)
      dirs.forEach((dir, i) => { if (preview[i]) preview[i].fields.__direction = dir })
      setPreviewRows(preview)

      // Reset file input so the same file can be re-picked after clearing
      e.target.value = ''
    },
    [],
  )

  // ── Clear ──────────────────────────────────────────────────────────────────
  function handleClear() {
    setFileName(null)
    setCsvText(null)
    setHeaders([])
    setMissingCols([])
    setPreviewRows([])
    setTotalRows(0)
    setResult(null)
    setParseError(null)
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const uploadMutation = useMutation<UploadResult, Error, string>({
    mutationFn: (csv_content) =>
      api.post<UploadResult>('/attendance/upload', { csv_content }),
    onSuccess: (data) => {
      setResult(data)
      toast.success('Attendance uploaded', {
        description: `${data.success_rows} of ${data.total_rows} row(s) imported successfully.`,
      })
    },
    onError: (e: Error) => toast.error('Upload failed', { description: e.message }),
  })

  function handleSubmit() {
    if (!csvText) return
    setResult(null)
    uploadMutation.mutate(csvText)
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const hasErrors    = previewRows.some((r) => r.warnings.length > 0)
  const canSubmit    = !!csvText && missingCols.length === 0 && !parseError

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <PageHeader
        title="Attendance Upload"
        subtitle="Bulk-import attendance records via CSV"
      />

      {/* Access guard */}
      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-muted-foreground">
              HR admin access required to upload attendance data.
            </p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <div className="space-y-4">

          {/* ── Action strip ─────────────────────────────────────────────── */}
          <SectionCard
            title="Upload CSV / XLSX"
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="flex flex-wrap items-center gap-3">

              {/* Download sample */}
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleDownloadSample}
              >
                <Download className="h-3.5 w-3.5" />
                Download Sample CSV
              </Button>

              {/* File picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                size="sm"
                className="gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                <Upload className="h-3.5 w-3.5" />
                {fileName ? 'Replace File' : 'Choose CSV / XLSX File'}
              </Button>

              {/* Selected file name */}
              {fileName && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  {fileName}
                  <button
                    className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={handleClear}
                    title="Clear"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>

            {/* Column format reminder */}
            <div className="mt-4 p-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground space-y-1.5">
              <p className="font-semibold text-foreground">Required columns</p>
              <p className="font-mono">
                {REQUIRED_COLUMNS.join(', ')}
                <span className="ml-2 text-muted-foreground/70">(+ optional: {OPTIONAL_COLUMNS.join(', ')})</span>
              </p>
              <p>
                <span className="font-medium">datetime</span> — <span className="font-mono">YYYY-MM-DD HH:MM</span> or <span className="font-mono">YYYY-MM-DD HH:MM:SS</span> in <strong>tenant local time</strong> (e.g. IST — <em>not</em> UTC)
              </p>
              <p className="text-muted-foreground/80">
                One row = one punch event. The system groups punches by employee + date, sorts by time,
                and automatically assigns direction: <span className="font-medium text-foreground">1st punch = IN, 2nd = OUT, 3rd = IN…</span>
              </p>
            </div>
          </SectionCard>

          {/* ── Parse error ───────────────────────────────────────────────── */}
          {parseError && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}

          {/* ── Missing columns warning ───────────────────────────────────── */}
          {missingCols.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Missing required columns:{' '}
                <span className="font-mono font-semibold">{missingCols.join(', ')}</span>.
                Please fix the CSV and re-upload.
              </span>
            </div>
          )}

          {/* ── Preview table ──────────────────────────────────────────────── */}
          {previewRows.length > 0 && (
            <SectionCard
              title={`Preview — first ${previewRows.length} of ${totalRows} rows`}
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
              action={
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {hasErrors && (
                    <span className="flex items-center gap-1 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {previewRows.filter((r) => r.warnings.length > 0).length} row(s) with issues
                    </span>
                  )}
                  {!hasErrors && !missingCols.length && (
                    <span className="flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Preview looks valid
                    </span>
                  )}
                </div>
              }
            >
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-3 py-2 text-left text-muted-foreground font-semibold w-12">#</th>
                      {/* Show all CSV headers but highlight required ones */}
                      {headers.map((col) => (
                        <th
                          key={col}
                          className={cn(
                            'px-3 py-2 text-left font-semibold',
                            REQUIRED_COLUMNS.includes(col as typeof REQUIRED_COLUMNS[number])
                              ? 'text-foreground'
                              : 'text-muted-foreground',
                          )}
                        >
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
                    {previewRows.map((row) => {
                      const hasWarning = row.warnings.length > 0
                      return (
                        <tr
                          key={row.line}
                          className={cn(
                            'border-b border-border/50 last:border-0 transition-colors',
                            hasWarning
                              ? 'bg-destructive/5 hover:bg-destructive/10'
                              : 'hover:bg-muted/30',
                          )}
                        >
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.line}</td>
                          {headers.map((col) => (
                            <td
                              key={col}
                              className={cn(
                                'px-3 py-2 font-mono',
                                !row.fields[col] && REQUIRED_COLUMNS.includes(col as typeof REQUIRED_COLUMNS[number])
                                  ? 'text-destructive'
                                  : 'text-foreground',
                              )}
                            >
                              {row.fields[col] || (
                                <span className="text-destructive/70 italic">empty</span>
                              )}
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
                            {hasWarning ? (
                              <div className="flex flex-col gap-0.5">
                                {row.warnings.map((w, i) => (
                                  <span key={i} className="flex items-center gap-1 text-destructive text-[10px]">
                                    <XCircle className="h-3 w-3 flex-shrink-0" />
                                    {w}
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
                <p className="mt-2 text-xs text-muted-foreground text-center">
                  Showing first 20 rows — {totalRows - 20} more row(s) not previewed.
                </p>
              )}

              {/* Submit */}
              <div className="mt-4 space-y-3">
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || uploadMutation.isPending}
                  className="gap-2"
                >
                  {uploadMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" />Uploading…</>
                  ) : (
                    <><Upload className="h-3.5 w-3.5" />Submit {totalRows} Row{totalRows !== 1 ? 's' : ''}</>
                  )}
                </Button>

                {/* Upload failure — prominent retry banner */}
                {uploadMutation.isError && (
                  <OperationalErrorBanner
                    error={uploadMutation.error?.message ?? 'Upload failed — the server rejected the request.'}
                    severity="high"
                    remediationText="Check that your CSV is well-formed and all required columns (employee_code, datetime) are present. Then retry."
                    onRetry={() => csvText && uploadMutation.mutate(csvText)}
                    retrying={uploadMutation.isPending}
                  />
                )}
              </div>
            </SectionCard>
          )}

          {/* ── Upload progress indicator ─────────────────────────────────── */}
          {uploadMutation.isPending && (
            <div className="p-4 rounded-md bg-muted/50 border border-border text-sm">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Processing {totalRows} row{totalRows !== 1 ? 's' : ''}…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Resolving employee codes, inserting punch logs and recomputing attendance.
                  </p>
                </div>
              </div>
              {/* Animated indeterminate progress bar */}
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
              </div>
            </div>
          )}

          {/* ── Result summary ────────────────────────────────────────────── */}
          {result && (
            <SectionCard
              title="Upload Result"
              icon={
                result.failed_rows.length === 0
                  ? <CheckCircle2 className="h-4 w-4 text-success" />
                  : <AlertTriangle className="h-4 w-4 text-warning" />
              }
            >
              {/* Summary chips */}
              <div className="mb-4">
                <MetricRow cols={3}>
                  <MetricCard label="Total Rows" value={result.total_rows} variant="neutral" />
                  <MetricCard label="Succeeded" value={result.success_rows} variant="success" />
                  <MetricCard
                    label="Failed"
                    value={result.failed_rows.length}
                    variant={result.failed_rows.length > 0 ? 'destructive' : 'neutral'}
                  />
                </MetricRow>
              </div>

              {/* Success banner */}
              {result.failed_rows.length === 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-success/10 border border-success/20 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  All {result.success_rows} punch{result.success_rows !== 1 ? 'es' : ''} imported successfully.
                  {result.recompute_targets ? ` Attendance is being recomputed for ${result.recompute_targets} day(s) in the background — changes will reflect shortly.` : ' Attendance has been recomputed.'}
                </div>
              )}

              {/* Partial success */}
              {result.failed_rows.length > 0 && result.success_rows > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-sm text-warning mb-4">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  {result.success_rows} row{result.success_rows !== 1 ? 's' : ''} imported.{' '}
                  {result.failed_rows.length} row{result.failed_rows.length !== 1 ? 's' : ''} failed — see details below.
                </div>
              )}

              {/* Error table */}
              {result.failed_rows.length > 0 && (
                <>
                  <div className="flex items-center justify-between mb-2 mt-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      Failed rows ({result.failed_rows.length})
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => {
                        // Build a CSV with the original columns + an error column
                        const header = 'row_data,error'
                        const rows = result.failed_rows.map(fr =>
                          `"${(fr.row ?? '').replace(/"/g, '""')}","${fr.error.replace(/"/g, '""')}"`
                        )
                        const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
                        const url  = URL.createObjectURL(blob)
                        const a    = document.createElement('a')
                        a.href     = url
                        a.download = 'attendance_upload_failed_rows.csv'
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      <Download className="h-3 w-3" />
                      Download failed rows
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold w-16">Line</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Row data</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.failed_rows.map((fr, i) => (
                          <tr
                            key={i}
                            className="border-b border-border/50 last:border-0 bg-destructive/5"
                          >
                            <td className="px-3 py-2 tabular-nums text-destructive font-semibold">{fr.line}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground max-w-[300px] truncate" title={fr.row}>
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

              {/* Upload another */}
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={handleClear} className="gap-2">
                  <Upload className="h-3.5 w-3.5" />
                  Upload Another File
                </Button>
              </div>
            </SectionCard>
          )}

        </div>
      )}
    </PageContainer>
  )
}
