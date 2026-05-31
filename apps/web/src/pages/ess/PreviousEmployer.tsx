/**
 * PreviousEmployer — /ess/tax/previous-employer
 *
 * ESS page for employees to declare previous employer details for the
 * current financial year. Supports create, edit (pending/under_review),
 * and delete (pending only).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Loader2, AlertCircle, Info,
  Building2, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { Label }         from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { api }  from '@/lib/api/client'
import { cn }   from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const CURRENT_FY  = '2025-26'
const FY_OPTIONS  = ['2025-26', '2024-25', '2023-24']

// ── Types ─────────────────────────────────────────────────────────────────────

type RecordStatus = 'pending' | 'under_review' | 'verified' | 'rejected'

interface PrevEmployerRecord {
  id: string
  financial_year: string
  employer_name: string
  employer_tan: string | null
  gross_income: number
  tds_deducted: number
  pf_deducted: number
  professional_tax: number
  employment_from: string | null
  employment_to: string | null
  remarks: string | null
  status: RecordStatus
  rejection_reason: string | null
  created_at: string
  updated_at: string
}

interface FormState {
  employer_name: string
  employer_tan: string
  gross_income: string
  tds_deducted: string
  pf_deducted: string
  professional_tax: string
  employment_from: string
  employment_to: string
  remarks: string
}

const EMPTY_FORM: FormState = {
  employer_name: '',
  employer_tan: '',
  gross_income: '',
  tds_deducted: '0',
  pf_deducted: '0',
  professional_tax: '0',
  employment_from: '',
  employment_to: '',
  remarks: '',
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RecordStatus }) {
  const map: Record<RecordStatus, { label: string; cls: string }> = {
    pending:      { label: 'Pending',      cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    under_review: { label: 'Under Review', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
    verified:     { label: 'Verified',     cls: 'bg-green-100 text-green-800 border-green-200' },
    rejected:     { label: 'Rejected',     cls: 'bg-red-100 text-red-800 border-red-200' },
  }
  const { label, cls } = map[status] ?? map.pending
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', cls)}>
      {label}
    </Badge>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ records }: { records: PrevEmployerRecord[] }) {
  const totalSalary = records.reduce((s, r) => s + r.gross_income, 0)
  const totalTds    = records.reduce((s, r) => s + r.tds_deducted, 0)
  const totalPf     = records.reduce((s, r) => s + r.pf_deducted, 0)

  const items = [
    { label: 'Total Previous Salary', value: inr(totalSalary) },
    { label: 'Total Previous TDS',    value: inr(totalTds) },
    { label: 'Total Previous PF',     value: inr(totalPf) },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      {items.map(({ label, value }) => (
        <Card key={label}>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PreviousEmployer() {
  const qc = useQueryClient()
  const [fy, setFy]               = useState(CURRENT_FY)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<PrevEmployerRecord | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [deleteId, setDeleteId]   = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: records = [], isLoading, isError } = useQuery<PrevEmployerRecord[]>({
    queryKey: ['prev-employer-my', fy],
    queryFn:  () => api.get(`/payroll/statutory/tds/previous-employment/my?financial_year=${fy}`).then((r: any) => r?.data ?? []),
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['prev-employer-my', fy] })

  const buildPayload = (f: FormState) => ({
    financial_year:   fy,
    employer_name:    f.employer_name.trim(),
    employer_tan:     f.employer_tan.trim() || null,
    gross_income:     parseFloat(f.gross_income) || 0,
    tds_deducted:     parseFloat(f.tds_deducted) || 0,
    pf_deducted:      parseFloat(f.pf_deducted) || 0,
    professional_tax: parseFloat(f.professional_tax) || 0,
    employment_from:  f.employment_from || null,
    employment_to:    f.employment_to   || null,
    remarks:          f.remarks.trim()  || null,
  })

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      api.post('/payroll/statutory/tds/previous-employment/my', payload),
    onSuccess: () => {
      toast.success('Previous employer declaration added.')
      invalidate()
      closeDialog()
    },
    onError: () => toast.error('Failed to save declaration. Please try again.'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof buildPayload> }) =>
      api.put(`/payroll/statutory/tds/previous-employment/my/${id}`, payload),
    onSuccess: () => {
      toast.success('Declaration updated.')
      invalidate()
      closeDialog()
    },
    onError: () => toast.error('Failed to update declaration.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/payroll/statutory/tds/previous-employment/my/${id}`),
    onSuccess: () => {
      toast.success('Declaration deleted.')
      invalidate()
      setDeleteId(null)
    },
    onError: () => toast.error('Failed to delete declaration.'),
  })

  // ── Handlers ───────────────────────────────────────────────────────────────

  function openCreate() {
    setEditRecord(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(r: PrevEmployerRecord) {
    setEditRecord(r)
    setForm({
      employer_name:    r.employer_name,
      employer_tan:     r.employer_tan ?? '',
      gross_income:     String(r.gross_income),
      tds_deducted:     String(r.tds_deducted),
      pf_deducted:      String(r.pf_deducted),
      professional_tax: String(r.professional_tax),
      employment_from:  r.employment_from ?? '',
      employment_to:    r.employment_to   ?? '',
      remarks:          r.remarks         ?? '',
    })
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditRecord(null)
    setForm(EMPTY_FORM)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.employer_name.trim()) {
      toast.error('Employer name is required.')
      return
    }
    if (!form.gross_income || isNaN(parseFloat(form.gross_income))) {
      toast.error('Gross income is required.')
      return
    }
    const payload = buildPayload(form)
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  function setField(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const isDeleting = deleteMutation.isPending

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Previous Employer Details"
        subtitle="Declare income and tax deductions from your previous employers for the selected financial year."
      />

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          These details will be included in your annual tax computation.
          Please upload Form 16 for verification.
        </span>
      </div>

      {/* FY selector */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Label className="text-sm font-medium whitespace-nowrap">Financial Year</Label>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FY_OPTIONS.map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Previous Employer
        </Button>
      </div>

      {/* Summary */}
      {records.length > 0 && <SummaryCards records={records} />}

      {/* Records table */}
      <SectionCard title="Declarations" icon={<Building2 className="h-4 w-4" />}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading declarations…</span>
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>Failed to load declarations.</span>
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Building2 className="h-8 w-8 opacity-40" />
            <p className="text-sm">No previous employer declarations for FY {fy}.</p>
            <Button variant="outline" size="sm" onClick={openCreate} className="mt-2 gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add Declaration
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Employer Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">TAN</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Gross Income</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">TDS Deducted</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">PF Deducted</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Period</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr className="border-b hover:bg-muted/30 transition-colors" key={r.id}>
                    <td className="px-4 py-2.5 font-medium">{r.employer_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">
                      {r.employer_tan ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.gross_income)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.tds_deducted)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.pf_deducted)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {r.employment_from && r.employment_to
                        ? `${r.employment_from} → ${r.employment_to}`
                        : r.employment_from
                        ? `From ${r.employment_from}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={r.status} />
                        {r.status === 'rejected' && r.rejection_reason && (
                          <p className="text-xs text-red-600 max-w-[180px] truncate" title={r.rejection_reason}>
                            {r.rejection_reason}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {(r.status === 'pending' || r.status === 'under_review') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(r)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {r.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(r.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {r.status === 'verified' && (
                          <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editRecord ? 'Edit Previous Employer' : 'Add Previous Employer'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Employer Name */}
            <div className="space-y-1.5">
              <Label htmlFor="employer_name">
                Employer Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="employer_name"
                placeholder="ABC Pvt Ltd"
                value={form.employer_name}
                onChange={e => setField('employer_name', e.target.value)}
                required
              />
            </div>

            {/* TAN */}
            <div className="space-y-1.5">
              <Label htmlFor="employer_tan">Employer TAN</Label>
              <Input
                id="employer_tan"
                placeholder="ABCD12345E"
                value={form.employer_tan}
                onChange={e => setField('employer_tan', e.target.value.toUpperCase())}
                className="font-mono"
              />
            </div>

            {/* Income row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gross_income">
                  Gross Income (₹) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="gross_income"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.gross_income}
                  onChange={e => setField('gross_income', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tds_deducted">TDS Deducted (₹)</Label>
                <Input
                  id="tds_deducted"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.tds_deducted}
                  onChange={e => setField('tds_deducted', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pf_deducted">PF Deducted (₹)</Label>
                <Input
                  id="pf_deducted"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.pf_deducted}
                  onChange={e => setField('pf_deducted', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="professional_tax">Professional Tax (₹)</Label>
                <Input
                  id="professional_tax"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={form.professional_tax}
                  onChange={e => setField('professional_tax', e.target.value)}
                />
              </div>
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="employment_from">Employment From</Label>
                <DateInput
                  id="employment_from"
                  value={form.employment_from}
                  onChange={v => setField('employment_from', v)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="employment_to">Employment To</Label>
                <DateInput
                  id="employment_to"
                  value={form.employment_to}
                  onChange={v => setField('employment_to', v)}
                />
              </div>
            </div>

            {/* Remarks */}
            <div className="space-y-1.5">
              <Label htmlFor="remarks">Remarks</Label>
              <textarea
                id="remarks"
                placeholder="Optional notes or comments…"
                value={form.remarks}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setField('remarks', e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={closeDialog} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editRecord ? 'Save Changes' : 'Add Declaration'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Declaration?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone. The declaration will be permanently removed.
          </p>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isDeleting}
              className="gap-2"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
