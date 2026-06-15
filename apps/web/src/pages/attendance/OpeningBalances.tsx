/**
 * OpeningBalances — /admin/leave/opening-balances
 *
 * HR-admin screen to seed employees' OPENING leave balances during migration /
 * onboarding. Two modes:
 *   • By Employee — pick an employee, set days per leave type, save.
 *   • Bulk Upload — download a sample CSV, fill it, upload, preview, commit.
 *
 * Both write the cache + ledger consistently via the set_opening_balance RPC
 * (POST /attendance/leave/opening-balance[/bulk]).
 *
 * Access: hr_admin / super_admin only (enforced by the API too).
 */

import { useMemo, useRef, useState }               from 'react'
import { useQuery, useMutation, useQueryClient }    from '@tanstack/react-query'
import {
  Upload, Download, UserCog, Loader2, ShieldAlert,
  CheckCircle2, AlertCircle, FileSpreadsheet,
} from 'lucide-react'
import Papa from 'papaparse'

import { PageContainer }    from '@/components/layout/PageContainer'
import { PageHeader }       from '@/components/layout/PageHeader'
import { SectionCard }      from '@/components/layout/SectionCard'
import { Button }           from '@/components/ui/button'
import { Input }            from '@/components/ui/input'
import { EmployeeSelector } from '@/components/filters/EmployeeSelector'
import { toast }            from 'sonner'
import { api }              from '@/lib/api/client'
import { useAuthStore }     from '@/stores/authStore'
import { cn }               from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveType { id: string; name: string; is_paid: boolean }
interface BalanceRow { leave_type_id: string; balance: number }
interface ParsedRow { employee_code: string; leave_type: string; days: number }
interface BulkResult {
  total: number; succeeded: number; failed: number; year: number
  results: Array<{ row: number; ok: boolean; message?: string }>
}

const CURRENT_YEAR = new Date().getFullYear()

// ── Component ───────────────────────────────────────────────────────────────────

export function OpeningBalances() {
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const isAdmin = ['hr_admin', 'super_admin'].includes(profile?.role ?? '')

  const [tab, setTab]   = useState<'single' | 'bulk'>('single')
  const [year, setYear] = useState<number>(CURRENT_YEAR)

  // ── Leave types (shared) ────────────────────────────────────────────────────
  const { data: ltData } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave-types'],
    queryFn:  () => api.get('/masters/leave-types'),
    staleTime: 60_000,
  })
  const leaveTypes = useMemo(() => (ltData?.data ?? []).filter(l => l.is_paid !== false), [ltData])

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Opening Leave Balances" subtitle="Seed starting leave balances for employees" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can set opening balances.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Opening Leave Balances"
        subtitle="Seed starting leave balances during migration or onboarding"
      />

      {/* Year + mode toggle */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm text-muted-foreground">Year</label>
        <Input
          type="number"
          value={year}
          onChange={e => setYear(parseInt(e.target.value || String(CURRENT_YEAR), 10))}
          className="w-28 h-8"
        />
        <div className="ml-auto inline-flex rounded-lg border border-border p-0.5">
          <button
            onClick={() => setTab('single')}
            className={cn('px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5',
              tab === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          >
            <UserCog className="h-4 w-4" /> By Employee
          </button>
          <button
            onClick={() => setTab('bulk')}
            className={cn('px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5',
              tab === 'bulk' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          >
            <Upload className="h-4 w-4" /> Bulk Upload
          </button>
        </div>
      </div>

      {tab === 'single'
        ? <SingleEntry leaveTypes={leaveTypes} year={year} onSaved={() => qc.invalidateQueries({ queryKey: ['leave-balance'] })} />
        : <BulkUpload leaveTypes={leaveTypes} year={year} onCommitted={() => qc.invalidateQueries({ queryKey: ['leave-balance'] })} />}
    </PageContainer>
  )
}

// ── By Employee ─────────────────────────────────────────────────────────────────

function SingleEntry({ leaveTypes, year, onSaved }: { leaveTypes: LeaveType[]; year: number; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState('')
  const [edits, setEdits]           = useState<Record<string, string>>({})

  const { data: balData, isFetching } = useQuery<{ data: BalanceRow[] }>({
    queryKey: ['leave-balance', employeeId, year],
    queryFn:  () => api.get(`/attendance/leave/balance/${employeeId}`),
    enabled:  !!employeeId,
    staleTime: 10_000,
  })
  const currentByType = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of balData?.data ?? []) m[r.leave_type_id] = r.balance
    return m
  }, [balData])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(edits).filter(([, v]) => v.trim() !== '')
      if (entries.length === 0) throw new Error('Enter at least one balance')
      const settled = await Promise.allSettled(entries.map(([leave_type_id, v]) =>
        api.post('/attendance/leave/opening-balance', {
          employee_id: employeeId, leave_type_id, days: Number(v), year,
        }),
      ))
      const failed = settled.filter(s => s.status === 'rejected').length
      return { ok: entries.length - failed, failed }
    },
    onSuccess: ({ ok, failed }) => {
      if (failed) toast.warning(`${ok} saved, ${failed} failed`)
      else toast.success(`Opening balances saved (${ok})`)
      setEdits({})
      onSaved()
    },
    onError: (e: any) => toast.error('Save failed', { description: (e as Error)?.message }),
  })

  return (
    <SectionCard title="Set balances for one employee" icon={<UserCog className="h-4 w-4 text-muted-foreground" />}>
      <div className="space-y-4">
        <div className="max-w-md">
          <label className="text-xs text-muted-foreground mb-1 block">Employee</label>
          <EmployeeSelector value={employeeId} onChange={v => { setEmployeeId(v as string); setEdits({}) }} placeholder="Select employee…" />
        </div>

        {!employeeId ? (
          <p className="text-sm text-muted-foreground">Pick an employee to set their opening balances.</p>
        ) : leaveTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paid leave types configured. Create them under Leave Types first.</p>
        ) : (
          <>
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Leave Type</th>
                    <th className="px-3 py-2 font-medium">Current ({year})</th>
                    <th className="px-3 py-2 font-medium">New opening balance (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.map(lt => (
                    <tr key={lt.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium text-foreground">{lt.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {isFetching ? '…' : (currentByType[lt.id] ?? 0)}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number" min={0} max={365} step="0.5"
                          value={edits[lt.id] ?? ''}
                          placeholder={String(currentByType[lt.id] ?? 0)}
                          onChange={e => setEdits(p => ({ ...p, [lt.id]: e.target.value }))}
                          className="w-32 h-8"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-1.5">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save balances
              </Button>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  )
}

// ── Bulk Upload ─────────────────────────────────────────────────────────────────

function BulkUpload({ leaveTypes, year, onCommitted }: { leaveTypes: LeaveType[]; year: number; onCommitted: () => void }) {
  const [rows, setRows]             = useState<ParsedRow[]>([])
  const [parseErrors, setErrors]    = useState<string[]>([])
  const [filename, setFilename]     = useState('')
  const [result, setResult]         = useState<BulkResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function downloadSample() {
    const sampleType = leaveTypes[0]?.name ?? 'EL'
    const csv = [
      'employee_code,leave_type,days',
      `EMP001,${sampleType},12`,
      `EMP002,${sampleType},9.5`,
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'opening-balances-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFile(file: File) {
    setResult(null)
    setFilename(file.name)
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase(),
      complete: (res) => {
        const out: ParsedRow[] = []
        const errs: string[] = []
        res.data.forEach((raw, idx) => {
          const line = idx + 2 // +1 header, +1 to 1-index
          const code = String(raw['employee_code'] ?? '').trim()
          const lt   = String(raw['leave_type'] ?? '').trim()
          const daysS = String(raw['days'] ?? '').trim()
          if (!code && !lt && !daysS) return
          if (!code) { errs.push(`Row ${line}: missing employee_code`); return }
          if (!lt)   { errs.push(`Row ${line} (${code}): missing leave_type`); return }
          const days = Number(daysS)
          if (daysS === '' || Number.isNaN(days) || days < 0 || days > 365) {
            errs.push(`Row ${line} (${code}): invalid days "${daysS}" — use a number 0–365`); return
          }
          out.push({ employee_code: code, leave_type: lt, days })
        })
        setRows(out)
        setErrors(errs)
        if (out.length === 0 && errs.length === 0) errs.push('No data rows found')
      },
      error: (err) => { setRows([]); setErrors([`Failed to parse CSV: ${err.message}`]) },
    })
  }

  const commitMutation = useMutation({
    mutationFn: () => api.post<{ data: BulkResult }>('/attendance/leave/opening-balance/bulk', { year, rows }),
    onSuccess: (res) => {
      setResult(res.data)
      if (res.data.failed) toast.warning(`${res.data.succeeded} applied, ${res.data.failed} failed`)
      else toast.success(`Opening balances applied (${res.data.succeeded})`)
      onCommitted()
    },
    onError: (e: any) => toast.error('Upload failed', { description: (e as Error)?.message }),
  })

  return (
    <div className="space-y-4">
      <SectionCard title="Bulk upload" icon={<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload a CSV with columns <code className="text-xs bg-muted px-1 py-0.5 rounded">employee_code</code>,{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">leave_type</code>,{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">days</code>. Balances are set for <strong>{year}</strong>.
            Leave type is matched by name (e.g. EL, CL, SL).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadSample} className="gap-1.5">
              <Download className="h-4 w-4" /> Download sample CSV
            </Button>
            <input
              ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
              <Upload className="h-4 w-4" /> Choose CSV file
            </Button>
            {filename && <span className="text-sm text-muted-foreground self-center">{filename}</span>}
          </div>
        </div>
      </SectionCard>

      {parseErrors.length > 0 && (
        <SectionCard title={`Issues (${parseErrors.length})`} icon={<AlertCircle className="h-4 w-4 text-destructive" />}>
          <ul className="text-sm text-destructive space-y-1 max-h-48 overflow-auto">
            {parseErrors.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </SectionCard>
      )}

      {rows.length > 0 && (
        <SectionCard title={`Preview (${rows.length} valid rows)`}>
          <div className="overflow-x-auto border border-border rounded-lg max-h-80">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Employee code</th>
                  <th className="px-3 py-2 font-medium">Leave type</th>
                  <th className="px-3 py-2 font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1.5">{r.employee_code}</td>
                    <td className="px-3 py-1.5">{r.leave_type}</td>
                    <td className="px-3 py-1.5">{r.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-3">
            <Button onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending} className="gap-1.5">
              {commitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Apply {rows.length} rows
            </Button>
          </div>
        </SectionCard>
      )}

      {result && (
        <SectionCard title="Result" icon={<CheckCircle2 className="h-4 w-4 text-success" />}>
          <div className="flex gap-6 text-sm mb-3">
            <span>Total: <strong>{result.total}</strong></span>
            <span className="text-success">Succeeded: <strong>{result.succeeded}</strong></span>
            <span className={result.failed ? 'text-destructive' : ''}>Failed: <strong>{result.failed}</strong></span>
          </div>
          {result.failed > 0 && (
            <ul className="text-sm text-destructive space-y-1 max-h-48 overflow-auto">
              {result.results.filter(r => !r.ok).map((r, i) => <li key={i}>• Row {r.row}: {r.message}</li>)}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  )
}
