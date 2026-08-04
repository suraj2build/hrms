/**
 * TaxPlanner — /ess/salary/tax-planner
 *
 * Unified IT tax workspace with two tabs:
 *   Tab 1: "Plan & Declare"  — multi-plan builder, live tax preview, submit as active FY declaration
 *   Tab 2: "Status & Proofs" — declaration status per item, proof upload, projected TDS, regime election
 *
 * Replaces the standalone TaxDeclarations page (/ess/declarations).
 * Route /ess/declarations redirects here via App.tsx.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, ChevronRight, Loader2, CheckCircle2,
  TrendingDown, Calculator, FileText,
  BadgeCheck, IndianRupee, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { MetricCard, MetricRow } from '@/components/dashboard/MetricCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api }               from '@/lib/api/client'
import { useAuthStore }      from '@/stores/authStore'
import { uploadEmployeeFile } from '@/lib/supabase-storage'
import { cn, formatCurrency, fmtDate } from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => formatCurrency(n)

function getCurrentFinancialYear(): string {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1
  if (month >= 4) return `${year}-${String(year + 1).slice(2)}`
  return `${year - 1}-${String(year).slice(2)}`
}

function getPreviousFinancialYear(fy: string): string {
  const startYear = parseInt(fy.split('-')[0])
  return `${startYear - 1}-${String(startYear).slice(2)}`
}

const CURRENT_FY = getCurrentFinancialYear()
const PREV_FY    = getPreviousFinancialYear(CURRENT_FY)
const FY_OPTIONS = [CURRENT_FY, PREV_FY]

// ── Types: Plan & Declare ─────────────────────────────────────────────────────

interface TaxComponent {
  id: string
  display_name: string
  section_code: string
  max_limit: number | null
  parent_group: string
  is_active: boolean
  regime_applicable: 'old' | 'new' | 'both'
  description?: string
}

interface ComponentsResponse {
  data: TaxComponent[]
  grouped: {
    chapter_via: TaxComponent[]
    hra: TaxComponent[]
    house_property: TaxComponent[]
    other_income: TaxComponent[]
    tds_tcs: TaxComponent[]
    previous_employment: TaxComponent[]
  }
}

interface TaxPlan {
  id: string
  plan_name: string
  tax_regime: 'old' | 'new'
  status: 'draft' | 'submitted' | 'active'
  is_primary: boolean
  projected_tax: number | null
  projected_monthly_tds: number | null
  projected_taxable_income: number | null
  items_count: number
}

interface PlanItem {
  id: string
  component_id: string
  declared_amount: number
  component: TaxComponent
}

interface SlabDetail {
  income_range: string
  rate: number
  tax: number
}

interface ComputeResult {
  taxable_income: number
  annual_tax: number
  monthly_tds: number
  regime: 'old' | 'new'
  deductions_breakdown: Record<string, number>
  slab_details: SlabDetail[]
  old_regime_tax: number
  new_regime_tax: number
  recommended_regime: 'old' | 'new'
  tax_saving_with_optimal: number
}

// ── Types: Status & Proofs ────────────────────────────────────────────────────

type DeclarationStatus =
  | 'draft' | 'declared' | 'submitted' | 'under_review'
  | 'approved' | 'rejected' | 'revision_requested'
  | 'locked' | 'payroll_applied' | 'archived'

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

// ── Constants: Status & Proofs ────────────────────────────────────────────────

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

// ── Status helpers ────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success'

function statusBadgeVariant(status: DeclarationStatus): BadgeVariant {
  switch (status) {
    case 'approved':            return 'success'
    case 'payroll_applied':     return 'success'
    case 'rejected':            return 'destructive'
    case 'revision_requested':  return 'destructive'
    case 'submitted':           return 'secondary'
    case 'under_review':        return 'secondary'
    case 'locked':              return 'secondary'
    default:                    return 'outline'
  }
}

function statusLabel(status: DeclarationStatus): string {
  switch (status) {
    case 'declared':            return 'Declared'
    case 'submitted':           return 'Submitted'
    case 'under_review':        return 'Under Review'
    case 'approved':            return 'Approved'
    case 'rejected':            return 'Rejected'
    case 'revision_requested':  return 'Needs Revision'
    case 'locked':              return 'Locked'
    case 'payroll_applied':     return 'Payroll Applied'
    case 'archived':            return 'Archived'
    default:                    return status
  }
}

function proofStateBadgeVariant(state: DocumentState): BadgeVariant {
  switch (state) {
    case 'verified':    return 'success'
    case 'rejected':    return 'destructive'
    case 'under_review': return 'secondary'
    default:            return 'outline'
  }
}

// ── Sub-components: Plan & Declare ────────────────────────────────────────────

function SummaryMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function ProgressBar({ current, max }: { current: number; max: number | null }) {
  if (!max) return null
  const pct  = Math.min(100, (current / max) * 100)
  const over = current > max
  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{inr(current)} declared</span>
        <span>Max {inr(max)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', over ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

interface DeclarationCardProps {
  title: string
  icon: React.ReactNode
  components: TaxComponent[]
  planItems: PlanItem[]
  planId: string
  onSaved: () => void
}

function DeclarationCard({ title, icon, components, planItems, planId, onSaved }: DeclarationCardProps) {
  const [open, setOpen]       = useState(false)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const qc = useQueryClient()

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {}
      components.forEach(c => {
        const existing = planItems.find(pi => pi.component_id === c.id)
        init[c.id] = existing ? String(existing.declared_amount) : ''
      })
      setAmounts(init)
    }
  }, [open, components, planItems])

  const totalDeclared = components.reduce((sum, c) => {
    const item = planItems.find(pi => pi.component_id === c.id)
    return sum + (item?.declared_amount ?? 0)
  }, 0)

  const maxLimit = components.length === 1 ? components[0].max_limit : null

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = Object.entries(amounts)
        .filter(([, v]) => v !== '' && Number(v) > 0)
        .map(([component_id, declared_amount]) => ({ component_id, declared_amount: Number(declared_amount) }))
      await api.post(`/payroll/statutory/tds/plans/my/${planId}/items`, { items })
    },
    onSuccess: () => {
      toast.success('Declarations saved')
      qc.invalidateQueries({ queryKey: ['plan-items', planId] })
      setOpen(false)
      onSaved()
    },
    onError: () => toast.error('Failed to save declarations'),
  })

  return (
    <>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-medium text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tabular-nums text-primary">{inr(totalDeclared)}</span>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Edit <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <ProgressBar current={totalDeclared} max={maxLimit} />
        {components.length > 0 && (
          <div className="mt-2 space-y-1">
            {components.slice(0, 3).map(c => {
              const item = planItems.find(pi => pi.component_id === c.id)
              if (!item || item.declared_amount === 0) return null
              return (
                <div key={c.id} className="flex justify-between text-xs text-muted-foreground">
                  <span>{c.display_name}</span>
                  <span className="tabular-nums">{inr(item.declared_amount)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {icon} {title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {components.map(c => {
              const val      = amounts[c.id] ?? ''
              const num      = Number(val)
              const overLimit = c.max_limit && num > c.max_limit
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{c.display_name}</label>
                    {c.section_code && (
                      <span className="text-xs text-muted-foreground">{c.section_code}</span>
                    )}
                  </div>
                  {c.max_limit && (
                    <p className="text-xs text-muted-foreground">Max limit: {inr(c.max_limit)}</p>
                  )}
                  <Input
                    type="number"
                    placeholder="0"
                    value={val}
                    min={0}
                    max={c.max_limit ?? undefined}
                    onChange={e => setAmounts(prev => ({ ...prev, [c.id]: e.target.value }))}
                    className={cn(overLimit && 'border-destructive')}
                  />
                  {overLimit && (
                    <p className="text-xs text-destructive">
                      Exceeds max limit of {inr(c.max_limit!)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-between items-center pt-2 border-t">
            <span className="text-sm text-muted-foreground">
              Total:{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {inr(Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0))}
              </span>
            </span>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Live Tax Preview ──────────────────────────────────────────────────────────

interface TaxPreviewProps {
  planId: string
  regime: 'old' | 'new'
  onRegimeChange: (r: 'old' | 'new') => void
  refreshTrigger: number
  onSubmit: () => void
  isSubmitting: boolean
  planStatus: string
}

function TaxPreview({
  planId, regime, onRegimeChange, refreshTrigger, onSubmit, isSubmitting, planStatus,
}: TaxPreviewProps) {
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['plan-compute', planId, refreshTrigger],
    queryFn: async () => {
      const res = await api.get<{ data: ComputeResult }>(
        `/payroll/statutory/tds/plans/my/${planId}/compute`
      )
      return res.data
    },
    enabled: !!planId,
    staleTime: 0,
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data) return null

  const displayTax   = regime === 'old' ? data.old_regime_tax : data.new_regime_tax
  const saving       = Math.abs(data.old_regime_tax - data.new_regime_tax)
  const betterRegime = data.recommended_regime

  return (
    <div className="space-y-4">
      {/* Regime toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1">Regime:</span>
        {(['old', 'new'] as const).map(r => (
          <button
            key={r}
            onClick={() => onRegimeChange(r)}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium transition-colors',
              regime === r
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {r === 'old' ? 'Old Regime' : 'New Regime'}
          </button>
        ))}
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 gap-3">
        <SummaryMetric label="Taxable Income" value={inr(data.taxable_income)} />
        <SummaryMetric
          label="Annual Tax"
          value={inr(displayTax)}
          sub={`${regime === 'old' ? 'Old' : 'New'} regime`}
        />
        <SummaryMetric
          label="Monthly TDS"
          value={inr(Math.round(displayTax / 12))}
          sub="Approx. per month"
        />
      </div>

      {/* Regime comparison */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Regime Comparison
        </p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className={cn(
            'rounded p-2',
            betterRegime === 'old'
              ? 'bg-success/10 dark:bg-success/20 border border-success/30 dark:border-success'
              : '',
          )}>
            <p className="text-xs text-muted-foreground">Old Regime</p>
            <p className="font-semibold tabular-nums">{inr(data.old_regime_tax)}</p>
            {betterRegime === 'old' && (
              <p className="text-xs text-success mt-0.5">Recommended</p>
            )}
          </div>
          <div className={cn(
            'rounded p-2',
            betterRegime === 'new'
              ? 'bg-success/10 dark:bg-success/20 border border-success/30 dark:border-success'
              : '',
          )}>
            <p className="text-xs text-muted-foreground">New Regime</p>
            <p className="font-semibold tabular-nums">{inr(data.new_regime_tax)}</p>
            {betterRegime === 'new' && (
              <p className="text-xs text-success mt-0.5">Recommended</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t">
          <TrendingDown className="h-3.5 w-3.5 text-success" />
          Save{' '}
          <span className="font-semibold text-foreground">{inr(saving)}</span>
          {' '}by choosing{' '}
          <span className="font-semibold capitalize text-success">
            {betterRegime} regime
          </span>
        </div>
      </div>

      {/* Recommended badge */}
      <div className="flex items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-primary" />
        <span className="text-sm">
          Recommended:{' '}
          <Badge variant="outline" className="ml-1 capitalize font-semibold">
            {data.recommended_regime} Regime
          </Badge>
        </span>
      </div>

      {/* Slab breakdown */}
      {data.slab_details?.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium">Income Range</th>
                <th className="text-right p-2 font-medium">Rate</th>
                <th className="text-right p-2 font-medium">Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.slab_details.map((s, i) => (
                <tr key={i}>
                  <td className="p-2">{s.income_range}</td>
                  <td className="p-2 text-right">{s.rate}%</td>
                  <td className="p-2 text-right tabular-nums">{inr(s.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Submit / Active */}
      {planStatus === 'draft' ? (
        <Button className="w-full" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <CheckCircle2 className="h-4 w-4 mr-2" />}
          Set as Active Declaration
        </Button>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">
            Active Declaration
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function TaxPlanner() {
  const { profile } = useAuthStore()
  const qc = useQueryClient()

  // Shared state
  const [fy, setFy]             = useState(CURRENT_FY)
  const [activeTab, setActiveTab] = useState<'plan' | 'status'>('plan')

  // Plan & Declare state
  const [activePlanId, setActivePlanId]   = useState<string | null>(null)
  const [regime, setRegime]               = useState<'old' | 'new'>('old')
  const [newPlanOpen, setNewPlanOpen]     = useState(false)
  const [newPlanName, setNewPlanName]     = useState('')
  const [newPlanRegime, setNewPlanRegime] = useState<'old' | 'new'>('old')
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  // Status & Proofs state
  const fileInputRef                        = useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget]     = useState<string | null>(null)
  const [uploadingId, setUploadingId]       = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setRefreshTrigger(t => t + 1), 500)
  }, [])

  // ── Queries: Plan & Declare ──────────────────────────────────────────────────

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ['tax-plans', fy],
    queryFn: async () => {
      const res = await api.get<{ data: TaxPlan[] }>(
        `/payroll/statutory/tds/plans/my?financial_year=${fy}`
      )
      return res.data
    },
    staleTime: 60_000,
  })

  const { data: componentsData, isLoading: compLoading } = useQuery({
    queryKey: ['tds-components', 'both'],
    queryFn: async () => {
      const res = await api.get<ComponentsResponse>(
        '/payroll/statutory/tds/components?regime=both'
      )
      return res
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: planItems, isLoading: itemsLoading } = useQuery({
    queryKey: ['plan-items', activePlanId],
    queryFn: async () => {
      const res = await api.get<{ data: PlanItem[] }>(
        `/payroll/statutory/tds/plans/my/${activePlanId}/items`
      )
      return res.data
    },
    enabled: !!activePlanId,
  })

  // ── Queries: Status & Proofs ─────────────────────────────────────────────────

  const { data: regimeElection } = useQuery<TaxRegimeElection | null>({
    queryKey: ['tds', 'regime', 'my', fy],
    queryFn: () =>
      api.get<{ data?: TaxRegimeElection | null }>(`/payroll/statutory/tds/regime/my?financial_year=${fy}`)
        .then(r => r.data ?? null),
    enabled: activeTab === 'status',
  })

  const { data: declarations = [] } = useQuery<Declaration[]>({
    queryKey: ['tds', 'declarations', 'my', fy],
    queryFn: () =>
      api.get<{ data?: Declaration[] }>(`/payroll/statutory/tds/declarations/my?financial_year=${fy}`)
        .then(r => r.data ?? []),
    enabled: activeTab === 'status',
  })

  const { data: projections = [] } = useQuery<TDSProjection[]>({
    queryKey: ['tds', 'projections', 'my', fy],
    queryFn: () =>
      api.get<{ data?: TDSProjection[] }>(`/payroll/statutory/tds/projections/my?financial_year=${fy}`)
        .then(r => r.data ?? []),
    enabled: activeTab === 'status',
  })

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (plansData && plansData.length > 0 && !activePlanId) {
      const primary = plansData.find(p => p.is_primary) ?? plansData[0]
      setActivePlanId(primary.id)
      setRegime(primary.tax_regime)
    }
  }, [plansData, activePlanId])

  // ── Mutations: Plan & Declare ────────────────────────────────────────────────

  const createPlanMutation = useMutation({
    mutationFn: async () => {
      const planCount   = plansData?.length ?? 0
      const defaultName = newPlanName.trim() || `Plan ${String.fromCharCode(65 + planCount)}`
      const res = await api.post<{ data: TaxPlan }>('/payroll/statutory/tds/plans/my', {
        plan_name:      defaultName,
        financial_year: fy,
        tax_regime:     newPlanRegime,
      })
      return res.data
    },
    onSuccess: plan => {
      toast.success(`${plan.plan_name} created`)
      qc.invalidateQueries({ queryKey: ['tax-plans', fy] })
      setActivePlanId(plan.id)
      setRegime(plan.tax_regime)
      setNewPlanOpen(false)
      setNewPlanName('')
    },
    onError: () => toast.error('Failed to create plan'),
  })

  // Stable per-mount UUID sent as Idempotency-Key to prevent a double-click/
  // network retry from re-running the submit (recomputation + declaration
  // upsert + regime-election sync) a second time. Rotated after success.
  const submitPlanKey = useRef(crypto.randomUUID())

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!activePlanId) throw new Error('No active plan')
      const res = await api.post<{ data: { plan_id: string; status: string } }>(
        `/payroll/statutory/tds/plans/my/${activePlanId}/submit`,
        {},
        { headers: { 'Idempotency-Key': submitPlanKey.current } },
      )
      return res.data
    },
    onSuccess: () => {
      submitPlanKey.current = crypto.randomUUID()
      toast.success('Plan submitted as active declaration')
      qc.invalidateQueries({ queryKey: ['tax-plans', fy] })
    },
    onError: () => toast.error('Failed to submit plan'),
  })

  // Auto-create Plan A on first visit
  const hasCreatedDefault = useRef(false)
  useEffect(() => {
    if (
      !plansLoading &&
      plansData !== undefined &&
      plansData.length === 0 &&
      !hasCreatedDefault.current
    ) {
      hasCreatedDefault.current = true
      api.post<{ data: TaxPlan }>('/payroll/statutory/tds/plans/my', {
        plan_name:      'Plan A',
        financial_year: fy,
        tax_regime:     'old',
      }).then(res => {
        qc.invalidateQueries({ queryKey: ['tax-plans', fy] })
        setActivePlanId(res.data.id)
      }).catch(() => { /* silent — may already exist */ })
    }
  }, [plansLoading, plansData, fy, qc])

  // ── Mutations: Status & Proofs ───────────────────────────────────────────────

  const submitDeclaration = useMutation({
    mutationFn: (id: string) =>
      api.post(`/payroll/statutory/tds/declarations/${id}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tds', 'declarations', 'my', fy] })
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
      qc.invalidateQueries({ queryKey: ['tds', 'declarations', 'my', fy] })
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

  // ── Derived ──────────────────────────────────────────────────────────────────

  const plans      = plansData ?? []
  const activePlan = plans.find(p => p.id === activePlanId)
  const items      = planItems ?? []
  const grouped    = componentsData?.grouped
  const loading    = plansLoading || compLoading

  // Status & Proofs derived
  const groupedDeclarations = declarations.reduce<Record<string, Declaration[]>>((acc, d) => {
    if (!acc[d.declaration_category]) acc[d.declaration_category] = []
    acc[d.declaration_category].push(d)
    return acc
  }, {})
  const totalDeclared = declarations.reduce((s, d) => s + d.declared_amount, 0)
  const totalApproved = declarations.reduce((s, d) => s + (d.approved_amount ?? 0), 0)
  const pendingCount  = declarations.filter(
    d => d.status === 'submitted' || d.status === 'under_review'
  ).length
  const needsRevision = declarations.filter(d => d.status === 'revision_requested')

  function canSubmit(d: Declaration): boolean {
    return d.status === 'declared' || d.status === 'revision_requested'
  }

  function canUploadProof(d: Declaration): boolean {
    return ['declared', 'submitted', 'revision_requested'].includes(d.status)
      && !d.declaration_proofs?.some(p => p.document_state === 'verified')
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      {/* Hidden file input for proof uploads */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={e => {
          const file = e.target.files?.[0]
          if (!file || !uploadTarget) return
          setUploadingId(uploadTarget)
          uploadProof.mutate({ declId: uploadTarget, file })
          e.target.value = ''
        }}
      />

      <PageHeader
        title="Tax Planner"
        subtitle={`Plan and manage your IT declarations for FY ${fy}`}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={fy}
              onChange={e => { setFy(e.target.value); setActivePlanId(null) }}
              className="text-sm border rounded-md px-2 py-1.5 bg-background"
            >
              {FY_OPTIONS.map(f => <option key={f}>FY {f}</option>)}
            </select>
            {activeTab === 'plan' && (
              <Button onClick={() => setNewPlanOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-1" /> New Plan
              </Button>
            )}
          </div>
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as 'plan' | 'status')}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="plan">Plan &amp; Declare</TabsTrigger>
          <TabsTrigger value="status">Status &amp; Proofs</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Plan & Declare ──────────────────────────────────────────── */}
        <TabsContent value="plan" className="space-y-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Plan selector tabs */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {plans.map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => { setActivePlanId(plan.id); setRegime(plan.tax_regime) }}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                      activePlanId === plan.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    )}
                  >
                    {plan.plan_name}
                    {plan.status === 'submitted' || plan.is_primary ? (
                      <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1 border-success/30 text-success">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1">Draft</Badge>
                    )}
                  </button>
                ))}
                {plans.length < 5 && (
                  <button
                    onClick={() => setNewPlanOpen(true)}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> New
                  </button>
                )}
              </div>

              {activePlanId && grouped ? (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* LEFT: Declaration cards (60%) */}
                  <div className="lg:col-span-3 space-y-3">
                    <SectionCard title="Section 80C Investments" className="p-0">
                      <div className="p-4">
                        <DeclarationCard
                          title="Section 80C (Max ₹1.5L)"
                          icon={<IndianRupee className="h-4 w-4 text-primary" />}
                          components={grouped.chapter_via.filter(c => c.section_code?.startsWith('80C'))}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title="Other Chapter VI-A Deductions" className="p-0">
                      <div className="p-4 space-y-3">
                        <DeclarationCard
                          title="80D, 80E, 80G, 80TTA & Others"
                          icon={<FileText className="h-4 w-4 text-primary" />}
                          components={grouped.chapter_via.filter(c => !c.section_code?.startsWith('80C'))}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title="House Rent Allowance (HRA)" className="p-0">
                      <div className="p-4">
                        <DeclarationCard
                          title="HRA Exemption"
                          icon={<FileText className="h-4 w-4 text-warning" />}
                          components={grouped.hra}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title="House Property (Sec 24b)" className="p-0">
                      <div className="p-4">
                        <DeclarationCard
                          title="Home Loan Interest u/s 24(b)"
                          icon={<FileText className="h-4 w-4 text-primary" />}
                          components={grouped.house_property}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title="Previous Employment" className="p-0">
                      <div className="p-4">
                        <DeclarationCard
                          title="Previous Employer Income & TDS"
                          icon={<FileText className="h-4 w-4 text-warning" />}
                          components={grouped.previous_employment}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title="Other Income / TDS-TCS" className="p-0">
                      <div className="p-4 space-y-3">
                        <DeclarationCard
                          title="Other Income"
                          icon={<FileText className="h-4 w-4 text-primary" />}
                          components={grouped.other_income}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                        <DeclarationCard
                          title="TDS / TCS Credits"
                          icon={<Calculator className="h-4 w-4 text-primary" />}
                          components={grouped.tds_tcs}
                          planItems={items}
                          planId={activePlanId}
                          onSaved={triggerRefresh}
                        />
                      </div>
                    </SectionCard>
                  </div>

                  {/* RIGHT: Live Tax Preview (40%) */}
                  <div className="lg:col-span-2">
                    <SectionCard title="Live Tax Preview" className="sticky top-4">
                      {itemsLoading ? (
                        <div className="flex h-48 items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <TaxPreview
                          planId={activePlanId}
                          regime={regime}
                          onRegimeChange={setRegime}
                          refreshTrigger={refreshTrigger}
                          onSubmit={() => submitMutation.mutate()}
                          isSubmitting={submitMutation.isPending}
                          planStatus={activePlan?.status ?? 'draft'}
                        />
                      )}
                    </SectionCard>
                  </div>
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  <div className="text-center space-y-2">
                    <Calculator className="h-10 w-10 mx-auto opacity-30" />
                    <p>No plans yet. Create a plan to get started.</p>
                    <Button onClick={() => setNewPlanOpen(true)} variant="outline" size="sm">
                      <Plus className="h-4 w-4 mr-1" /> Create Plan A
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Status & Proofs ─────────────────────────────────────────── */}
        <TabsContent value="status" className="space-y-4">

          {/* Needs revision banner */}
          {needsRevision.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-destructive mb-1">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {needsRevision.length} declaration
                  {needsRevision.length > 1 ? 's' : ''} need
                  {needsRevision.length === 1 ? 's' : ''} revision
                </span>
              </div>
              {needsRevision.map(d => (
                <div key={d.id} className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                  <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-medium">
                      {CATEGORY_LABELS[d.declaration_category] ?? d.declaration_category}
                    </span>
                    {d.rejection_reason ? ` — ${d.rejection_reason}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Summary chips */}
          {declarations.length > 0 && (
            <MetricRow cols={3}>
              <MetricCard label="Total Declared" value={inr(totalDeclared)} compact />
              <MetricCard label="Total Approved" value={inr(totalApproved)} variant="success" compact />
              <MetricCard label="Pending Review" value={pendingCount} compact />
            </MetricRow>
          )}

          {/* Tax Regime (read-only — set automatically when a plan is submitted) */}
          <SectionCard title="Tax Regime">
            {regimeElection ? (
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex items-center gap-2 rounded-lg border-2 px-4 py-3',
                  'border-primary bg-primary/5',
                )}>
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-semibold capitalize">
                      {regimeElection.regime} Regime
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Elected on {fmtDate(regimeElection.effective_from)}
                    </p>
                  </div>
                  <Badge variant="default" className="ml-2 text-xs">Active</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  To change your regime, submit a different plan from the{' '}
                  <button
                    className="text-primary underline underline-offset-2 hover:no-underline"
                    onClick={() => setActiveTab('plan')}
                  >
                    Plan &amp; Declare
                  </button>{' '}
                  tab.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <p className="text-sm">
                  No regime elected for FY {fy} yet.{' '}
                  <button
                    className="text-primary underline underline-offset-2 hover:no-underline"
                    onClick={() => setActiveTab('plan')}
                  >
                    Submit a plan
                  </button>{' '}
                  to set your regime.
                </p>
              </div>
            )}
          </SectionCard>

          {/* My Declarations */}
          <SectionCard title="My Declarations">
            {declarations.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">
                No declarations for FY {fy}.{' '}
                <button
                  className="text-primary underline underline-offset-2 hover:no-underline"
                  onClick={() => setActiveTab('plan')}
                >
                  Submit a plan
                </button>{' '}
                to populate your declarations.
              </p>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedDeclarations).map(([category, decls]) => (
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
                            const proofCount    = d.declaration_proofs?.length ?? 0
                            const verifiedProof = d.declaration_proofs?.find(
                              p => p.document_state === 'verified'
                            )
                            return (
                              <tr
                                key={d.id}
                                className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                              >
                                <td className="py-2 px-3">
                                  <p className="text-xs font-medium text-foreground">{d.section}</p>
                                  <p className="text-[10px] text-muted-foreground">{d.description}</p>
                                </td>
                                <td className="py-2 px-3 text-right text-xs font-mono">
                                  {inr(d.declared_amount)}
                                </td>
                                <td className="py-2 px-3 text-right text-xs font-mono">
                                  {d.approved_amount != null ? (
                                    <span className="text-success font-medium">
                                      {inr(d.approved_amount)}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  <Badge
                                    variant={statusBadgeVariant(d.status)}
                                    className="text-[10px] capitalize"
                                  >
                                    {statusLabel(d.status)}
                                  </Badge>
                                  {(d.status === 'revision_requested' || d.status === 'rejected')
                                    && d.rejection_reason && (
                                    <p className="text-[10px] text-destructive mt-0.5">
                                      {d.rejection_reason}
                                    </p>
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  {proofCount === 0 ? (
                                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                      None
                                    </Badge>
                                  ) : verifiedProof ? (
                                    <Badge variant="success" className="text-[10px]">Verified</Badge>
                                  ) : (
                                    <Badge
                                      variant={proofStateBadgeVariant(d.declaration_proofs[0].document_state)}
                                      className="text-[10px] capitalize"
                                    >
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
                                        disabled={
                                          submitDeclaration.isPending &&
                                          submitDeclaration.variables === d.id
                                        }
                                        onClick={() => submitDeclaration.mutate(d.id)}
                                      >
                                        {submitDeclaration.isPending &&
                                          submitDeclaration.variables === d.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin mr-0.5 inline" />
                                        ) : null}
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
                                        {uploadingId === d.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin mr-0.5 inline" />
                                        ) : null}
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

          {/* Projected TDS */}
          <SectionCard title="Projected TDS">
            {projections.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">
                No projections available for FY {fy}.
              </p>
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
                      {projections.map(p => (
                        <tr
                          key={p.id}
                          className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                        >
                          <td className="py-2 px-3 text-foreground text-xs">{p.projection_month}</td>
                          <td className="py-2 px-3 text-right font-medium text-foreground text-xs font-mono">
                            {inr(p.tds_this_month)}
                          </td>
                          <td className="py-2 px-3 text-right text-xs font-mono text-muted-foreground">
                            {inr(p.taxable_income_projected)}
                          </td>
                          <td className="py-2 px-3">
                            <Badge
                              variant={p.regime === 'new' ? 'success' : 'secondary'}
                              className="text-[10px] capitalize"
                            >
                              {p.regime}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3 italic">
                  Projections are estimates based on your current declarations and may change
                  as income or declarations update.
                </p>
              </>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ── New Plan Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={newPlanOpen} onOpenChange={setNewPlanOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Tax Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Plan Name</label>
              <Input
                placeholder={`Plan ${String.fromCharCode(65 + plans.length)}`}
                value={newPlanName}
                onChange={e => setNewPlanName(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Tax Regime</label>
              <div className="flex gap-2 mt-1.5">
                {(['old', 'new'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setNewPlanRegime(r)}
                    className={cn(
                      'flex-1 py-2 rounded-lg border text-sm font-medium transition-colors',
                      newPlanRegime === r
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input bg-background hover:bg-muted',
                    )}
                  >
                    {r === 'old' ? 'Old Regime' : 'New Regime'}
                  </button>
                ))}
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => createPlanMutation.mutate()}
              disabled={createPlanMutation.isPending}
            >
              {createPlanMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : null}
              Create Plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </PageContainer>
  )
}
