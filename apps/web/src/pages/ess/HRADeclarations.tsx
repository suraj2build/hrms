/**
 * HRADeclarations — /ess/tax/hra-declarations
 *
 * ESS page for employees to declare HRA details (rent paid, landlord info)
 * for the current financial year.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Loader2, AlertCircle, Info,
  Home, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
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

const CURRENT_FY = '2025-26'
const FY_OPTIONS = ['2025-26', '2024-25', '2023-24']

const METRO_CITIES = ['Mumbai', 'Delhi', 'Kolkata', 'Chennai']

// Annual rent threshold above which landlord PAN is required (₹1,00,000)
const PAN_REQUIRED_THRESHOLD = 100000

// ── Types ─────────────────────────────────────────────────────────────────────

type RecordStatus = 'pending' | 'under_review' | 'verified' | 'rejected'

interface HRARecord {
  id: string
  financial_year: string
  from_month: string     // YYYY-MM
  to_month: string       // YYYY-MM
  monthly_rent: number
  landlord_name: string | null
  landlord_pan: string | null
  landlord_address: string | null
  city: string | null
  is_metro: boolean
  status: RecordStatus
  rejection_reason: string | null
  verification_notes: string | null
  created_at: string
}

interface FormState {
  from_month: string
  to_month: string
  monthly_rent: string
  landlord_name: string
  landlord_pan: string
  landlord_address: string
  city: string
  is_metro: boolean
}

const EMPTY_FORM: FormState = {
  from_month:       '',
  to_month:         '',
  monthly_rent:     '',
  landlord_name:    '',
  landlord_pan:     '',
  landlord_address: '',
  city:             '',
  is_metro:         false,
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

// ── Months between from and to ────────────────────────────────────────────────

function monthsBetween(from: string, to: string): number {
  if (!from || !to) return 0
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const diff = (ty - fy) * 12 + (tm - fm) + 1
  return Math.max(0, diff)
}

// ── Main component ────────────────────────────────────────────────────────────

export function HRADeclarations() {
  const qc = useQueryClient()
  const [fy, setFy]               = useState(CURRENT_FY)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<HRARecord | null>(null)
  const [form, setForm]           = useState<FormState>(EMPTY_FORM)
  const [deleteId, setDeleteId]   = useState<string | null>(null)

  // ── Computed previews ──────────────────────────────────────────────────────

  const monthlyRentNum   = parseFloat(form.monthly_rent) || 0
  const months           = monthsBetween(form.from_month, form.to_month)
  const estimatedAnnual  = monthlyRentNum * months
  const panWarning       = estimatedAnnual > PAN_REQUIRED_THRESHOLD && !form.landlord_pan.trim()

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: records = [], isLoading, isError } = useQuery<HRARecord[]>({
    queryKey: ['hra-my', fy],
    queryFn:  () => api.get(`/payroll/statutory/tds/hra/my?financial_year=${fy}`).then((r: any) => r?.data ?? []),
  })

  const totalAnnualRent = records.reduce((s, r) => {
    const m = monthsBetween(r.from_month, r.to_month)
    return s + r.monthly_rent * m
  }, 0)

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['hra-my', fy] })

  const buildPayload = (f: FormState) => ({
    financial_year:   fy,
    from_month:       f.from_month,
    to_month:         f.to_month,
    monthly_rent:     parseFloat(f.monthly_rent) || 0,
    landlord_name:    f.landlord_name.trim()    || null,
    landlord_pan:     f.landlord_pan.trim()     || null,
    landlord_address: f.landlord_address.trim() || null,
    city:             f.city.trim()             || null,
    is_metro:         f.is_metro,
  })

  const createMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      api.post('/payroll/statutory/tds/hra/my', payload),
    onSuccess: () => {
      toast.success('HRA declaration added.')
      invalidate()
      closeDialog()
    },
    onError: () => toast.error('Failed to save declaration.'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReturnType<typeof buildPayload> }) =>
      api.put(`/payroll/statutory/tds/hra/my/${id}`, payload),
    onSuccess: () => {
      toast.success('Declaration updated.')
      invalidate()
      closeDialog()
    },
    onError: () => toast.error('Failed to update declaration.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/payroll/statutory/tds/hra/my/${id}`),
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

  function openEdit(r: HRARecord) {
    setEditRecord(r)
    setForm({
      from_month:       r.from_month,
      to_month:         r.to_month,
      monthly_rent:     String(r.monthly_rent),
      landlord_name:    r.landlord_name    ?? '',
      landlord_pan:     r.landlord_pan     ?? '',
      landlord_address: r.landlord_address ?? '',
      city:             r.city             ?? '',
      is_metro:         r.is_metro,
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
    if (!form.from_month || !form.to_month) {
      toast.error('From Month and To Month are required.')
      return
    }
    if (!form.monthly_rent || isNaN(parseFloat(form.monthly_rent))) {
      toast.error('Monthly rent is required.')
      return
    }
    const payload = buildPayload(form)
    if (editRecord) {
      updateMutation.mutate({ id: editRecord.id, payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  function setField(key: keyof FormState, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const isSaving  = createMutation.isPending || updateMutation.isPending
  const isDeleting = deleteMutation.isPending

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="HRA Declarations"
        subtitle="Declare your rent paid and landlord information for HRA exemption computation."
      />

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          HRA exemption will be computed based on your declarations, salary structure,
          and the city of residence. Ensure declarations match your rent agreement.
        </span>
      </div>

      {/* FY selector + Add button */}
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
          Add HRA Declaration
        </Button>
      </div>

      {/* Summary */}
      {records.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Total Annual Rent Declared</p>
              <p className="text-xl font-semibold tabular-nums">{inr(totalAnnualRent)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-1">Declarations Count</p>
              <p className="text-xl font-semibold">{records.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Records table */}
      <SectionCard title="HRA Declarations" icon={<Home className="h-4 w-4" />}>
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
            <Home className="h-8 w-8 opacity-40" />
            <p className="text-sm">No HRA declarations for FY {fy}.</p>
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
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Period</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Monthly Rent</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-right">Annual Rent</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Landlord</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">PAN</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">City</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const m = monthsBetween(r.from_month, r.to_month)
                  const annual = r.monthly_rent * m
                  return (
                    <tr className="border-b hover:bg-muted/30 transition-colors" key={r.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-sm">
                        {r.from_month} → {r.to_month}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{inr(r.monthly_rent)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{inr(annual)}</td>
                      <td className="px-4 py-2.5 text-sm">{r.landlord_name ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {r.landlord_pan ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm">
                        {r.city
                          ? `${r.city}${r.is_metro ? ' (Metro)' : ''}`
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
                          {r.verification_notes && r.status !== 'rejected' && (
                            <p className="text-xs text-muted-foreground max-w-[180px] truncate" title={r.verification_notes}>
                              {r.verification_notes}
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
                  )
                })}
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
              {editRecord ? 'Edit HRA Declaration' : 'Add HRA Declaration'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Period */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="from_month">
                  From Month <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="from_month"
                  type="month"
                  value={form.from_month}
                  onChange={e => setField('from_month', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to_month">
                  To Month <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="to_month"
                  type="month"
                  value={form.to_month}
                  onChange={e => setField('to_month', e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Monthly rent + preview */}
            <div className="space-y-1.5">
              <Label htmlFor="monthly_rent">
                Monthly Rent (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="monthly_rent"
                type="number"
                min={0}
                placeholder="0"
                value={form.monthly_rent}
                onChange={e => setField('monthly_rent', e.target.value)}
                required
              />
              {monthlyRentNum > 0 && months > 0 && (
                <p className="text-xs text-muted-foreground">
                  Estimated Annual Rent:{' '}
                  <span className="font-medium text-foreground">{inr(estimatedAnnual)}</span>
                  {' '}({months} month{months !== 1 ? 's' : ''})
                </p>
              )}
            </div>

            {/* Landlord Name */}
            <div className="space-y-1.5">
              <Label htmlFor="landlord_name">Landlord Name</Label>
              <Input
                id="landlord_name"
                placeholder="John Doe"
                value={form.landlord_name}
                onChange={e => setField('landlord_name', e.target.value)}
              />
            </div>

            {/* Landlord PAN */}
            <div className="space-y-1.5">
              <Label htmlFor="landlord_pan">Landlord PAN</Label>
              <Input
                id="landlord_pan"
                placeholder="ABCDE1234F"
                value={form.landlord_pan}
                onChange={e => setField('landlord_pan', e.target.value.toUpperCase())}
                className="font-mono"
              />
              {panWarning && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    PAN required if annual rent exceeds ₹1,00,000. Estimated annual rent
                    is {inr(estimatedAnnual)}.
                  </span>
                </div>
              )}
            </div>

            {/* Landlord Address */}
            <div className="space-y-1.5">
              <Label htmlFor="landlord_address">Landlord Address</Label>
              <Input
                id="landlord_address"
                placeholder="123, MG Road, Mumbai"
                value={form.landlord_address}
                onChange={e => setField('landlord_address', e.target.value)}
              />
            </div>

            {/* City + Metro toggle */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="Mumbai"
                  value={form.city}
                  onChange={e => setField('city', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Metro City?</Label>
                <div className="flex items-center gap-2 h-9">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={form.is_metro}
                    onClick={() => setField('is_metro', !form.is_metro)}
                    className={cn(
                      'h-5 w-9 rounded-full transition-colors relative',
                      form.is_metro ? 'bg-primary' : 'bg-muted border border-border'
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                      form.is_metro ? 'translate-x-4' : 'translate-x-0.5'
                    )} />
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {form.is_metro ? 'Yes (40%)' : 'No (50%)'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight">
                  Metro cities: {METRO_CITIES.join(', ')}
                </p>
              </div>
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
            <DialogTitle>Delete HRA Declaration?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone. The HRA declaration will be permanently removed.
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
