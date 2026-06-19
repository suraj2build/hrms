/**
 * TaxGovernance — /admin/payroll/tax-governance
 *
 * Admin-only page for IT declaration governance:
 * declaration window, regime policy, proof settings, and compliance dashboard.
 *
 * Access: hr_admin and super_admin only.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, Loader2, AlertCircle, Calendar, ShieldCheck,
  FileCheck, BarChart3, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { DateInput }     from '@/components/ui/date-input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

const CURRENT_FY = '2025-26'
const FY_OPTIONS = ['2025-26', '2024-25']

// ── Types ─────────────────────────────────────────────────────────────────────

interface GovernanceSettings {
  financial_year: string
  // Declaration window
  window_open_date: string
  window_close_date: string
  grace_period_date: string
  lock_date: string
  // Regime policy
  default_regime: 'old' | 'new'
  allow_regime_switching: boolean
  regime_lock_date: string
  // Proof settings
  proof_mandatory: boolean
  max_file_size_mb: number
  allowed_formats: string[]
}

interface ComplianceStats {
  total_employees: number
  submitted: number
  pending: number
  proofs_under_review: number
  rejected: number
}

interface RiskItem {
  employee_id: string
  employee_name: string
  employee_code: string
  section: string
  declared_amount: number
  risk_reason: string
  risk_level: 'high' | 'medium' | 'low'
}

interface ComplianceData {
  stats: ComplianceStats
  risk_items: RiskItem[]
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DateField({
  label,
  value,
  onChange,
  helpText,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  helpText?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
      <DateInput value={value ?? ''} onChange={onChange} />
    </div>
  )
}

function ToggleField({
  label,
  value,
  onChange,
  helpText,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  helpText?: string
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}
      </div>
      <div className="flex gap-2">
        {[true, false].map(opt => (
          <button
            key={String(opt)}
            onClick={() => onChange(opt)}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
              value === opt
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-input bg-background hover:bg-muted'
            )}
          >
            {opt ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  )
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', color)}>
      <p className="text-2xl font-bold tabular-nums">{value.toLocaleString('en-IN')}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function TaxGovernance() {
  const { profile } = useAuthStore()
  const qc          = useQueryClient()
  const [fy, setFy] = useState(CURRENT_FY)
  const [dirty, setDirty] = useState(false)

  // Local form state — mirrors GovernanceSettings
  const [form, setForm] = useState<Partial<GovernanceSettings>>({})

  const isAdmin = profile?.role === 'hr_admin' || profile?.role === 'super_admin'

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: govData, isLoading: govLoading } = useQuery({
    queryKey: ['tax-governance', fy],
    queryFn: async () => {
      const res = await api.get<{ data: GovernanceSettings }>(`/payroll/statutory/tds/governance?financial_year=${fy}`)
      return res.data
    },
    enabled: isAdmin,
    staleTime: 60_000,
  })

  const { data: complianceData, isLoading: compLoading } = useQuery({
    queryKey: ['tax-compliance', fy],
    queryFn: () => api.get<ComplianceData>(`/payroll/statutory/tds/compliance?financial_year=${fy}`),
    enabled: isAdmin,
    staleTime: 2 * 60_000,
  })

  // Sync API data → form on load/FY change
  useEffect(() => {
    if (govData) {
      setForm(govData)
      setDirty(false)
    }
  }, [govData])

  const update = <K extends keyof GovernanceSettings>(key: K, value: GovernanceSettings[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  // ── Save mutation ──────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.put('/payroll/statutory/tds/governance', { ...form, financial_year: fy })
    },
    onSuccess: () => {
      toast.success('Tax governance settings saved')
      qc.invalidateQueries({ queryKey: ['tax-governance', fy] })
      setDirty(false)
    },
    onError: () => toast.error('Failed to save settings'),
  })

  // ── Access guard ────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex h-64 items-center justify-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Access denied. This page is for HR admins only.</span>
        </div>
      </PageContainer>
    )
  }

  const ALLOWED_FORMATS = ['pdf', 'jpg', 'jpeg', 'png']

  const toggleFormat = (fmt: string) => {
    const current = form.allowed_formats ?? []
    const next = current.includes(fmt) ? current.filter(f => f !== fmt) : [...current, fmt]
    update('allowed_formats', next)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageContainer>
      <PageHeader
        title="Tax Governance"
        subtitle="IT declaration window, regime policy, and proof settings"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={fy}
              onChange={e => { setFy(e.target.value); setForm({}) }}
              className="text-sm border rounded-md px-2 py-1.5 bg-background"
            >
              {FY_OPTIONS.map(f => <option key={f}>{f}</option>)}
            </select>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save
            </Button>
          </div>
        }
      />

      {govLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="window">
          <TabsList className="mb-4">
            <TabsTrigger value="window">
              <Calendar className="h-3.5 w-3.5 mr-1.5" /> Declaration Window
            </TabsTrigger>
            <TabsTrigger value="regime">
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Regime Policy
            </TabsTrigger>
            <TabsTrigger value="proofs">
              <FileCheck className="h-3.5 w-3.5 mr-1.5" /> Proof Settings
            </TabsTrigger>
            <TabsTrigger value="compliance">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Compliance
            </TabsTrigger>
          </TabsList>

          {/* ── 1. Declaration Window ─────────────────────────────────── */}
          <TabsContent value="window">
            <SectionCard title="Declaration Window Configuration">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl">
                <DateField
                  label="Window Open Date"
                  value={form.window_open_date ?? ''}
                  onChange={v => update('window_open_date', v)}
                  helpText="Date from which employees can start submitting declarations"
                />
                <DateField
                  label="Window Close Date"
                  value={form.window_close_date ?? ''}
                  onChange={v => update('window_close_date', v)}
                  helpText="Last date for submission of declarations"
                />
                <DateField
                  label="Grace Period End Date"
                  value={form.grace_period_date ?? ''}
                  onChange={v => update('grace_period_date', v)}
                  helpText="Extended deadline for late submissions (optional)"
                />
                <DateField
                  label="Lock Date"
                  value={form.lock_date ?? ''}
                  onChange={v => update('lock_date', v)}
                  helpText="After this date, no changes are allowed"
                />
              </div>
              <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Lock Date must be after Window Close Date. After locking, all declarations are frozen for payroll processing.
                </span>
              </div>
            </SectionCard>
          </TabsContent>

          {/* ── 2. Regime Policy ──────────────────────────────────────── */}
          <TabsContent value="regime">
            <SectionCard title="Tax Regime Policy">
              <div className="max-w-lg space-y-2">
                <div className="py-2">
                  <p className="text-sm font-medium mb-2">Default Regime</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Applied to employees who have not explicitly chosen a regime
                  </p>
                  <div className="flex gap-2">
                    {(['old', 'new'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => update('default_regime', r)}
                        className={cn(
                          'flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors',
                          form.default_regime === r
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-input bg-background hover:bg-muted'
                        )}
                      >
                        {r === 'old' ? 'Old Regime' : 'New Regime'}
                      </button>
                    ))}
                  </div>
                </div>

                <ToggleField
                  label="Allow Regime Switching"
                  value={form.allow_regime_switching ?? true}
                  onChange={v => update('allow_regime_switching', v)}
                  helpText="Permit employees to switch between old and new regime during the window"
                />

                <DateField
                  label="Regime Lock Date"
                  value={form.regime_lock_date ?? ''}
                  onChange={v => update('regime_lock_date', v)}
                  helpText="After this date, employees cannot change their regime election"
                />
              </div>
            </SectionCard>
          </TabsContent>

          {/* ── 3. Proof Settings ─────────────────────────────────────── */}
          <TabsContent value="proofs">
            <SectionCard title="Declaration Proof Settings">
              <div className="max-w-lg space-y-4">
                <ToggleField
                  label="Proof Mandatory"
                  value={form.proof_mandatory ?? false}
                  onChange={v => update('proof_mandatory', v)}
                  helpText="Require employees to upload proof documents for each declaration"
                />

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Max File Size (MB)</label>
                  <p className="text-xs text-muted-foreground">Maximum size per uploaded document</p>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={form.max_file_size_mb ?? 5}
                    onChange={e => update('max_file_size_mb', Number(e.target.value))}
                    className="max-w-[120px]"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Allowed File Formats</p>
                  <p className="text-xs text-muted-foreground">Select the file types employees can upload</p>
                  <div className="flex flex-wrap gap-2">
                    {ALLOWED_FORMATS.map(fmt => {
                      const selected = (form.allowed_formats ?? []).includes(fmt)
                      return (
                        <button
                          key={fmt}
                          onClick={() => toggleFormat(fmt)}
                          className={cn(
                            'px-3 py-1.5 rounded border text-xs font-medium uppercase transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-input bg-background hover:bg-muted'
                          )}
                        >
                          .{fmt}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </SectionCard>
          </TabsContent>

          {/* ── 4. Compliance Dashboard ───────────────────────────────── */}
          <TabsContent value="compliance">
            {compLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : complianceData ? (
              <div className="space-y-5">
                {/* Summary chips */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  <StatChip label="Total Employees" value={complianceData.stats.total_employees} />
                  <StatChip
                    label="Submitted"
                    value={complianceData.stats.submitted}
                    color="border-success/40 dark:border-success"
                  />
                  <StatChip
                    label="Pending"
                    value={complianceData.stats.pending}
                    color="border-warning/40 dark:border-warning"
                  />
                  <StatChip
                    label="Proofs Under Review"
                    value={complianceData.stats.proofs_under_review}
                    color="border-info/40 dark:border-info"
                  />
                  <StatChip
                    label="Rejected"
                    value={complianceData.stats.rejected}
                    color="border-destructive/30"
                  />
                </div>

                {/* Risk table */}
                <SectionCard title="High-Risk Declarations">
                  {complianceData.risk_items.length === 0 ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <ShieldCheck className="h-4 w-4 text-success" />
                      No high-risk declarations flagged for this period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left py-2 px-3 font-medium">Employee</th>
                            <th className="text-left py-2 px-3 font-medium">Section</th>
                            <th className="text-right py-2 px-3 font-medium">Declared Amount</th>
                            <th className="text-left py-2 px-3 font-medium">Risk Reason</th>
                            <th className="text-center py-2 px-3 font-medium">Risk Level</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {complianceData.risk_items.map((item, i) => (
                            <tr key={i} className="hover:bg-muted/20 transition-colors">
                              <td className="py-2 px-3">
                                <p className="font-medium">{item.employee_name}</p>
                                <p className="text-muted-foreground">{item.employee_code}</p>
                              </td>
                              <td className="py-2 px-3">{item.section}</td>
                              <td className="py-2 px-3 text-right tabular-nums">{inr(item.declared_amount)}</td>
                              <td className="py-2 px-3 max-w-xs truncate">{item.risk_reason}</td>
                              <td className="py-2 px-3 text-center">
                                <Badge
                                  variant={
                                    item.risk_level === 'high'
                                      ? 'destructive'
                                      : item.risk_level === 'medium'
                                      ? 'outline'
                                      : 'secondary'
                                  }
                                  className="capitalize text-[10px]"
                                >
                                  {item.risk_level}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </SectionCard>
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
                <AlertCircle className="h-5 w-5" />
                <span>Failed to load compliance data.</span>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  )
}
