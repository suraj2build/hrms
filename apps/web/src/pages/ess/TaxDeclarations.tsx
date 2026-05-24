import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus } from 'lucide-react'
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
import { cn } from '@/lib/utils'

interface TaxRegimeElection {
  id: string
  financial_year: string
  elected_regime: 'old' | 'new'
  locked: boolean
  locked_at: string | null
}

interface Declaration {
  id: string
  financial_year: string
  declaration_type: string
  section_code: string
  section_name: string
  declared_amount: number
  status: 'pending' | 'verified' | 'rejected'
  rejection_reason: string | null
  proof_submitted: boolean
}

interface TDSProjection {
  month: string
  projected_tds: number
  regime: 'old' | 'new'
}

type SectionCode = '80C' | '80D' | '80CCD' | 'HRA' | 'LTA' | 'other'
const SECTION_CODES: SectionCode[] = ['80C', '80D', '80CCD', 'HRA', 'LTA', 'other']

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

function declarationStatusVariant(status: Declaration['status']): string {
  switch (status) {
    case 'pending': return 'warning'
    case 'verified': return 'success'
    case 'rejected': return 'destructive'
    default: return 'secondary'
  }
}

interface DeclForm {
  section_code: SectionCode
  section_name: string
  declared_amount: string
}

const defaultDeclForm: DeclForm = {
  section_code: '80C',
  section_name: '',
  declared_amount: '',
}

export function TaxDeclarations() {
  const qc = useQueryClient()
  const currentFY = getCurrentFinancialYear()
  const previousFY = getPreviousFinancialYear(currentFY)

  const [selectedFY, setSelectedFY] = useState(currentFY)
  const [declDialogOpen, setDeclDialogOpen] = useState(false)
  const [declForm, setDeclForm] = useState<DeclForm>(defaultDeclForm)

  const { data: regime } = useQuery<TaxRegimeElection>({
    queryKey: ['tds', 'regime', selectedFY],
    queryFn: () => api.get(`/payroll/statutory/tds/regime?financial_year=${selectedFY}`).then((r: any) => r.data),
  })

  const { data: declarations = [] } = useQuery<Declaration[]>({
    queryKey: ['tds', 'declarations', selectedFY],
    queryFn: () =>
      api.get(`/payroll/statutory/tds/declarations/my?financial_year=${selectedFY}`).then((r: any) => r.data),
  })

  const { data: projections = [] } = useQuery<TDSProjection[]>({
    queryKey: ['tds', 'projections', selectedFY],
    queryFn: () =>
      api.get(`/payroll/statutory/tds/projections/my?financial_year=${selectedFY}`).then((r: any) => r.data),
  })

  const electRegime = useMutation({
    mutationFn: (elected_regime: 'old' | 'new') =>
      api.post('/payroll/statutory/tds/regime', { financial_year: selectedFY, elected_regime }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'regime', selectedFY] })
      toast.success('Tax regime updated')
    },
    onError: (e: Error) => toast.error('Failed to update tax regime', { description: e.message }),
  })

  const addDeclaration = useMutation({
    mutationFn: (body: { section_code: string; section_name: string; declared_amount: number; financial_year: string }) =>
      api.post('/payroll/statutory/tds/declarations', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'declarations', selectedFY] })
      setDeclDialogOpen(false)
      setDeclForm(defaultDeclForm)
      toast.success('Declaration added')
    },
    onError: (e: Error) => toast.error('Failed to add declaration', { description: e.message }),
  })

  // Group declarations by section_code
  const grouped = declarations.reduce<Record<string, Declaration[]>>((acc, d) => {
    const key = d.section_code
    if (!acc[key]) acc[key] = []
    acc[key].push(d)
    return acc
  }, {})

  function handleDeclSubmit(e: React.FormEvent) {
    e.preventDefault()
    addDeclaration.mutate({
      section_code: declForm.section_code,
      section_name: declForm.section_name,
      declared_amount: parseFloat(declForm.declared_amount),
      financial_year: selectedFY,
    })
  }

  const fyOptions = [currentFY, previousFY]

  return (
    <PageContainer>
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

      {/* Section 1: Tax Regime Election */}
      <SectionCard title="Tax Regime Election" className="mb-6">
        <div className="space-y-4">
          {regime?.locked ? (
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="secondary" className="flex items-center gap-1">
                <Lock className="h-3 w-3" />
                Locked
              </Badge>
              {regime.locked_at && (
                <span className="text-xs text-muted-foreground">
                  as of {new Date(regime.locked_at).toLocaleDateString()}
                </span>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['old', 'new'] as const).map(r => {
              const isSelected = regime?.elected_regime === r
              const isLocked = regime?.locked ?? false
              return (
                <button
                  key={r}
                  disabled={isLocked || electRegime.isPending}
                  onClick={() => !isLocked && electRegime.mutate(r)}
                  className={cn(
                    'rounded-lg border-2 p-4 text-left transition-all',
                    isSelected
                      ? 'border-primary bg-sidebar-accent'
                      : 'border-border hover:border-primary/50',
                    isLocked && 'cursor-not-allowed opacity-70'
                  )}
                >
                  <p className="text-sm font-semibold text-foreground mb-1 capitalize">{r} Regime</p>
                  {r === 'old' ? (
                    <p className="text-xs text-muted-foreground">
                      Allows deductions under 80C, 80D, HRA, LTA and other sections. Suitable if you have high
                      investments and eligible deductions.
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
        </div>
      </SectionCard>

      {/* Section 2: My Declarations */}
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
            {Object.entries(grouped).map(([section, decls]) => (
              <div key={section}>
                <h4 className="text-sm font-semibold text-foreground mb-2">Section {section}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2 px-3 font-medium">Section</th>
                        <th className="text-left py-2 px-3 font-medium">Description</th>
                        <th className="text-right py-2 px-3 font-medium">Declared Amount</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium">Proof</th>
                        <th className="text-left py-2 px-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decls.map(d => (
                        <tr key={d.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                          <td className="py-2 px-3 font-mono text-xs">{d.section_code}</td>
                          <td className="py-2 px-3 text-foreground">{d.section_name}</td>
                          <td className="py-2 px-3 text-right font-medium text-foreground">
                            ₹{d.declared_amount.toLocaleString('en-IN')}
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant={declarationStatusVariant(d.status) as any}>
                              {d.status}
                            </Badge>
                            {d.status === 'rejected' && d.rejection_reason && (
                              <p className="text-xs text-destructive mt-1">{d.rejection_reason}</p>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {d.proof_submitted ? (
                              <Badge variant="success" className="text-xs">Submitted</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">Not submitted</Badge>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {!d.proof_submitted && (d.status === 'pending' || d.status === 'verified') && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  // Deferred: show proof_submitted = true optimistically
                                  qc.setQueryData<Declaration[]>(
                                    ['tds', 'declarations', selectedFY],
                                    prev => prev?.map(item =>
                                      item.id === d.id ? { ...item, proof_submitted: true } : item
                                    )
                                  )
                                }}
                              >
                                Upload Proof
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Section 3: Projected TDS */}
      <SectionCard title="Projected TDS">
        {projections.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No projections available for FY {selectedFY}.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">Month</th>
                    <th className="text-right py-2 px-3 font-medium">Projected TDS</th>
                    <th className="text-left py-2 px-3 font-medium">Regime</th>
                  </tr>
                </thead>
                <tbody>
                  {projections.map((p, idx) => (
                    <tr key={idx} className="border-b border-border hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-3 text-foreground">{p.month}</td>
                      <td className="py-2 px-3 text-right font-medium text-foreground">
                        ₹{p.projected_tds.toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 px-3 capitalize text-muted-foreground">{p.regime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3 italic">
              Projections are estimates based on your current declarations
            </p>
          </>
        )}
      </SectionCard>

      {/* Add Declaration Dialog */}
      <Dialog open={declDialogOpen} onOpenChange={open => { if (!open) { setDeclDialogOpen(false); setDeclForm(defaultDeclForm) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Declaration</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDeclSubmit} className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Section Code *</label>
              <select
                value={declForm.section_code}
                onChange={e => setDeclForm(f => ({ ...f, section_code: e.target.value as SectionCode }))}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
                required
              >
                {SECTION_CODES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description *</label>
              <Input
                value={declForm.section_name}
                onChange={e => setDeclForm(f => ({ ...f, section_name: e.target.value }))}
                placeholder="e.g. Life Insurance Premium"
                required
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Declared Amount (₹) *</label>
              <Input
                type="number"
                min="0"
                step="1"
                value={declForm.declared_amount}
                onChange={e => setDeclForm(f => ({ ...f, declared_amount: e.target.value }))}
                placeholder="e.g. 50000"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { setDeclDialogOpen(false); setDeclForm(defaultDeclForm) }}>
                Cancel
              </Button>
              <Button type="submit" disabled={addDeclaration.isPending}>
                Add Declaration
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
