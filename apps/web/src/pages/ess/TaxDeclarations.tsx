import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Loader2, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { uploadEmployeeFile } from '@/lib/supabase-storage'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type DeclarationStatus =
  | 'draft'
  | 'declared'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'revision_requested'
  | 'locked'
  | 'payroll_applied'
  | 'archived'

type DocumentState = 'uploaded' | 'under_review' | 'verified' | 'rejected'

interface DeclarationProof {
  id: string
  file_name: string
  document_state: DocumentState
  uploaded_at: string
}

interface Declaration {
  id: string
  financial_year: string
  declaration_category: string
  section: string
  description: string
  declared_amount: number
  approved_amount: number | null
  status: DeclarationStatus
  rejection_reason: string | null
  submitted_at: string | null
  reviewed_at: string | null
  declaration_proofs: DeclarationProof[]
}

interface TaxRegimeElection {
  id: string
  financial_year: string
  regime: 'old' | 'new'
  effective_from: string
}

interface TDSProjection {
  id: string
  projection_month: string
  tds_this_month: number
  regime: 'old' | 'new'
  taxable_income_projected: number
  gross_income_projected: number
}

// Declaration category → display label mapping (matches DB enum)
const CATEGORY_LABELS: Record<string, string> = {
  '80C':               'Section 80C',
  '80D':               'Section 80D (Medical Insurance)',
  '80E':               'Section 80E (Education Loan)',
  '80G':               'Section 80G (Donations)',
  '80TTA':             'Section 80TTA (Savings Interest)',
  'HRA':               'HRA (House Rent Allowance)',
  'LTA':               'LTA (Leave Travel Allowance)',
  'home_loan_principal': 'Home Loan Principal',
  'home_loan_interest':  'Home Loan Interest (Sec 24)',
  'NPS':               'NPS (Section 80CCD)',
  'standard_deduction': 'Standard Deduction',
  'professional_tax':  'Professional Tax',
  'other':             'Other',
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCurrentFinancialYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  if (month >= 4) return `${year}-${String(year + 1).slice(2)}`
  return `${year - 1}-${String(year).slice(2)}`
}

function getPreviousFinancialYear(fy: string): string {
  const startYear = parseInt(fy.split('-')[0])
  return `${startYear - 1}-${String(startYear).slice(2)}`
}

function statusBadgeVariant(status: DeclarationStatus): string {
  switch (status) {
    case 'approved':        return 'success'
    case 'payroll_applied': return 'success'
    case 'rejected':        return 'destructive'
    case 'revision_requested': return 'destructive'
    case 'submitted':       return 'secondary'
    case 'under_review':    return 'secondary'
    case 'locked':          return 'secondary'
    default:                return 'outline'
  }
}

function statusLabel(status: DeclarationStatus): string {
  switch (status) {
    case 'declared':           return 'Declared'
    case 'submitted':          return 'Submitted'
    case 'under_review':       return 'Under Review'
    case 'approved':           return 'Approved'
    case 'rejected':           return 'Rejected'
    case 'revision_requested': return 'Needs Revision'
    case 'locked':             return 'Locked'
    case 'payroll_applied':    return 'Payroll Applied'
    case 'archived':           return 'Archived'
    default:                   return status
  }
}

function proofStateBadgeVariant(state: DocumentState): string {
  switch (state) {
    case 'verified':    return 'success'
    case 'rejected':    return 'destructive'
    case 'under_review': return 'secondary'
    default:            return 'outline'
  }
}

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style:                 'currency',
    currency:              'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

// ── Form types ────────────────────────────────────────────────────────────────

interface DeclForm {
  declaration_category: string
  section: string
  description: string
  declared_amount: string
}

const defaultDeclForm: DeclForm = {
  declaration_category: '80C',
  section:              '',
  description:          '',
  declared_amount:      '',
}

// =============================================================================
export function TaxDeclarations() {
  const qc = useQueryClient()
  const { profile } = useAuthStore()
  const currentFY  = getCurrentFinancialYear()
  const previousFY = getPreviousFinancialYear(currentFY)

  const [selectedFY, setSelectedFY]       = useState(currentFY)
  const [declDialogOpen, setDeclDialogOpen] = useState(false)
  const [declForm, setDeclForm]           = useState<DeclForm>(defaultDeclForm)

  // Proof upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget]   = useState<string | null>(null)
  const [uploadingId, setUploadingId]     = useState<string | null>(null)

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: regime } = useQuery<TaxRegimeElection | null>({
    queryKey: ['tds', 'regime', 'my', selectedFY],
    queryFn:  () => api.get(`/payroll/statutory/tds/regime/my?financial_year=${selectedFY}`).then((r: any) => r.data ?? null),
  })

  const { data: declarations = [] } = useQuery<Declaration[]>({
    queryKey: ['tds', 'declarations', 'my', selectedFY],
    queryFn:  () =>
      api.get(`/payroll/statutory/tds/declarations/my?financial_year=${selectedFY}`).then((r: any) => r.data ?? []),
  })

  const { data: projections = [] } = useQuery<TDSProjection[]>({
    queryKey: ['tds', 'projections', 'my', selectedFY],
    queryFn:  () =>
      api.get(`/payroll/statutory/tds/projections/my?financial_year=${selectedFY}`).then((r: any) => r.data ?? []),
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const electRegime = useMutation({
    mutationFn: (regime: 'old' | 'new') =>
      api.put('/payroll/statutory/tds/regime/my', { financial_year: selectedFY, regime }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'regime', 'my', selectedFY] })
      toast.success('Tax regime updated')
    },
    onError: (e: Error) => toast.error('Failed to update tax regime', { description: e.message }),
  })

  const addDeclaration = useMutation({
    mutationFn: (body: Omit<DeclForm, 'declared_amount'> & { declared_amount: number; financial_year: string }) =>
      api.post('/payroll/statutory/tds/declarations/my', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'declarations', 'my', selectedFY] })
      setDeclDialogOpen(false)
      setDeclForm(defaultDeclForm)
      toast.success('Declaration added')
    },
    onError: (e: Error) => toast.error('Failed to add declaration', { description: e.message }),
  })

  const submitDeclaration = useMutation({
    mutationFn: (id: string) =>
      api.post(`/payroll/statutory/tds/declarations/${id}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'declarations', 'my', selectedFY] })
      toast.success('Declaration submitted for review')
    },
    onError: (e: Error) => toast.error('Failed to submit declaration', { description: e.message }),
  })

  const uploadProof = useMutation({
    mutationFn: async ({ declId, file }: { declId: string; file: File }) => {
      if (!profile?.tenant_id || !profile?.employee_id) {
        throw new Error('Profile not linked to an employee record')
      }
      const storagePath = await uploadEmployeeFile(
        profile.tenant_id,
        profile.employee_id,
        'documents',
        file,
      )
      return api.post(`/payroll/statutory/tds/declarations/${declId}/proof`, {
        file_name:       file.name,
        storage_path:    storagePath,
        mime_type:       file.type || undefined,
        file_size_bytes: file.size || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'declarations', 'my', selectedFY] })
      setUploadingId(null)
      setUploadTarget(null)
      toast.success('Proof uploaded successfully')
    },
    onError: (e: Error) => {
      setUploadingId(null)
      setUploadTarget(null)
      toast.error('Proof upload failed', { description: e.message })
    },
  })

  // ── Computed ─────────────────────────────────────────────────────────────────

  // Group by category
  const grouped = declarations.reduce<Record<string, Declaration[]>>((acc, d) => {
    const key = d.declaration_category
    if (!acc[key]) acc[key] = []
    acc[key].push(d)
    return acc
  }, {})

  const totalDeclared  = declarations.reduce((s, d) => s + d.declared_amount, 0)
  const totalApproved  = declarations.reduce((s, d) => s + (d.approved_amount ?? 0), 0)
  const pendingCount   = declarations.filter(d => d.status === 'submitted' || d.status === 'under_review').length
  const needsRevision  = declarations.filter(d => d.status === 'revision_requested')

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleDeclSubmit(e: React.FormEvent) {
    e.preventDefault()
    addDeclaration.mutate({
      declaration_category: declForm.declaration_category,
      section:              declForm.section,
      description:          declForm.description,
      declared_amount:      parseFloat(declForm.declared_amount),
      financial_year:       selectedFY,
    })
  }

  const fyOptions = [currentFY, previousFY]

  // Can the employee submit this declaration for review?
  function canSubmit(d: Declaration): boolean {
    return d.status === 'declared' || d.status === 'revision_requested'
  }

  // Can the employee upload proof for this declaration?
  function canUploadProof(d: Declaration): boolean {
    return ['declared', 'submitted', 'revision_requested'].includes(d.status)
      && !d.declaration_proofs?.some(p => p.document_state === 'verified')
  }

  return (
    <PageContainer>
      {/* Hidden file input for proof uploads */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file || !uploadTarget) return
          setUploadingId(uploadTarget)
          uploadProof.mutate({ declId: uploadTarget, file })
          e.target.value = ''
        }}
      />

      <PageHeader
        title="Tax Declarations"
        subtitle="Manage your tax regime election, declarations, and projected TDS"
        actions={
          <select
            value={selectedFY}
            onChange={e => setSelectedFY(e.target.value)}
            className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
          >
            {fyOptions.map(fy => (
              <option key={fy} value={fy}>FY {fy}</option>
            ))}
          </select>
        }
      />

      {/* Needs Revision banner */}
      {needsRevision.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 mb-4">
          <div className="flex items-center gap-2 text-destructive mb-1">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm font-medium">
              {needsRevision.length} declaration{needsRevision.length > 1 ? 's' : ''} need{needsRevision.length === 1 ? 's' : ''} revision
            </span>
          </div>
          {needsRevision.map(d => (
            <div key={d.id} className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
              <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{CATEGORY_LABELS[d.declaration_category] ?? d.declaration_category}</span>
                {d.rejection_reason ? ` — ${d.rejection_reason}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Summary chips ───────────────────────────────────────────────────── */}
      {declarations.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Total Declared</p>
            <p className="text-base font-semibold">{fmtINR(totalDeclared)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Total Approved</p>
            <p className="text-base font-semibold text-success">{fmtINR(totalApproved)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground mb-1">Pending Review</p>
            <p className="text-base font-semibold">{pendingCount}</p>
          </div>
        </div>
      )}

      {/* ── Tax Regime Election ─────────────────────────────────────────────── */}
      <SectionCard title="Tax Regime Election" className="mb-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['old', 'new'] as const).map(r => {
              const isSelected = regime?.regime === r
              return (
                <button
                  key={r}
                  disabled={electRegime.isPending}
                  onClick={() => electRegime.mutate(r)}
                  className={cn(
                    'rounded-lg border-2 p-4 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-sidebar-accent'
                      : 'border-border hover:border-primary/50',
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-foreground capitalize">{r} Regime</p>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </div>
                  {r === 'old' ? (
                    <p className="text-xs text-muted-foreground">
                      Allows deductions under 80C, 80D, HRA, LTA, and other sections. Suitable if you have
                      high investments and eligible deductions.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Lower tax slabs with no deductions. Suitable if you prefer simplicity and have fewer
                      eligible deductions.
                    </p>
                  )}
                  {isSelected && (
                    <Badge variant="default" className="mt-2 text-xs">Selected</Badge>
                  )}
                </button>
              )
            })}
          </div>
          {!regime && (
            <p className="text-xs text-muted-foreground">
              No regime elected for FY {selectedFY}. New regime is applied by default.
            </p>
          )}
        </div>
      </SectionCard>

      {/* ── My Declarations ─────────────────────────────────────────────────── */}
      <SectionCard
        title="My Declarations"
        className="mb-6"
        action={
          <Button size="sm" onClick={() => setDeclDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Declaration
          </Button>
        }
      >
        {declarations.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No declarations for FY {selectedFY}.</p>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([category, decls]) => (
              <div key={category}>
                <h4 className="text-sm font-semibold text-foreground mb-2">
                  {CATEGORY_LABELS[category] ?? category}
                </h4>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                        <th className="text-left py-2 px-3 text-xs font-medium">Section / Description</th>
                        <th className="text-right py-2 px-3 text-xs font-medium">Declared</th>
                        <th className="text-right py-2 px-3 text-xs font-medium">Approved</th>
                        <th className="text-left py-2 px-3 text-xs font-medium">Status</th>
                        <th className="text-left py-2 px-3 text-xs font-medium">Proof</th>
                        <th className="text-left py-2 px-3 text-xs font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decls.map(d => {
                        const proofCount  = d.declaration_proofs?.length ?? 0
                        const verifiedProof = d.declaration_proofs?.find(p => p.document_state === 'verified')
                        return (
                          <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="py-2 px-3">
                              <p className="text-xs font-medium text-foreground">{d.section}</p>
                              <p className="text-[10px] text-muted-foreground">{d.description}</p>
                            </td>
                            <td className="py-2 px-3 text-right text-xs font-mono">
                              {fmtINR(d.declared_amount)}
                            </td>
                            <td className="py-2 px-3 text-right text-xs font-mono">
                              {d.approved_amount != null
                                ? <span className="text-success font-medium">{fmtINR(d.approved_amount)}</span>
                                : <span className="text-muted-foreground">—</span>
                              }
                            </td>
                            <td className="py-2 px-3">
                              <Badge variant={statusBadgeVariant(d.status) as any} className="text-[10px] capitalize">
                                {statusLabel(d.status)}
                              </Badge>
                              {d.status === 'revision_requested' && d.rejection_reason && (
                                <p className="text-[10px] text-destructive mt-0.5">{d.rejection_reason}</p>
                              )}
                              {d.status === 'rejected' && d.rejection_reason && (
                                <p className="text-[10px] text-destructive mt-0.5">{d.rejection_reason}</p>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {proofCount === 0 ? (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">None</Badge>
                              ) : verifiedProof ? (
                                <Badge variant="success" className="text-[10px]">Verified</Badge>
                              ) : (
                                <Badge variant={proofStateBadgeVariant(d.declaration_proofs[0].document_state) as any} className="text-[10px] capitalize">
                                  {d.declaration_proofs[0].document_state}
                                </Badge>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1">
                                {canSubmit(d) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px]"
                                    disabled={submitDeclaration.isPending && submitDeclaration.variables === d.id}
                                    onClick={() => submitDeclaration.mutate(d.id)}
                                  >
                                    {submitDeclaration.isPending && submitDeclaration.variables === d.id
                                      ? <Loader2 className="h-3 w-3 animate-spin mr-0.5 inline" />
                                      : null}
                                    Submit
                                  </Button>
                                )}
                                {canUploadProof(d) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px]"
                                    disabled={uploadingId === d.id}
                                    onClick={() => {
                                      setUploadTarget(d.id)
                                      fileInputRef.current?.click()
                                    }}
                                  >
                                    {uploadingId === d.id
                                      ? <Loader2 className="h-3 w-3 animate-spin mr-0.5 inline" />
                                      : null}
                                    Upload Proof
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Projected TDS ───────────────────────────────────────────────────── */}
      <SectionCard title="Projected TDS">
        {projections.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No projections available for FY {selectedFY}.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="text-left py-2 px-3 text-xs font-medium">Month</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">TDS This Month</th>
                    <th className="text-right py-2 px-3 text-xs font-medium">Projected Taxable Income</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {projections.map((p) => (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 text-foreground text-xs">{p.projection_month}</td>
                      <td className="py-2 px-3 text-right font-medium text-foreground text-xs font-mono">
                        {fmtINR(p.tds_this_month)}
                      </td>
                      <td className="py-2 px-3 text-right text-xs font-mono text-muted-foreground">
                        {fmtINR(p.taxable_income_projected)}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={p.regime === 'new' ? 'success' : 'secondary'} className="text-[10px] capitalize">
                          {p.regime}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3 italic">
              Projections are estimates based on your current declarations and may change as income or declarations update.
            </p>
          </>
        )}
      </SectionCard>

      {/* ── Add Declaration Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={declDialogOpen}
        onOpenChange={open => { if (!open) { setDeclDialogOpen(false); setDeclForm(defaultDeclForm) } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Declaration</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDeclSubmit} className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Category *</label>
              <select
                value={declForm.declaration_category}
                onChange={e => setDeclForm(f => ({ ...f, declaration_category: e.target.value }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                required
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Section *</label>
              <Input
                value={declForm.section}
                onChange={e => setDeclForm(f => ({ ...f, section: e.target.value }))}
                placeholder="e.g. 80C"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description *</label>
              <Input
                value={declForm.description}
                onChange={e => setDeclForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. LIC Premium, PPF, ELSS Mutual Fund"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Declared Amount (₹) *</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={declForm.declared_amount}
                onChange={e => setDeclForm(f => ({ ...f, declared_amount: e.target.value }))}
                placeholder="e.g. 50000"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setDeclDialogOpen(false); setDeclForm(defaultDeclForm) }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addDeclaration.isPending}>
                {addDeclaration.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Add Declaration
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
