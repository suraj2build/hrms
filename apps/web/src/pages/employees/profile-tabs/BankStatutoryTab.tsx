/**
 * EmployeeProfile › Bank & Statutory tab.
 * Split out of the former monolithic EmployeeProfile.tsx.
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Edit2, Landmark, Loader2 } from 'lucide-react'
import { AadhaarVerifyCard } from '@/components/trust/AadhaarVerifyCard'
import { TooltipProvider } from '@/components/payroll/StatutoryBadges'
import {
  EmptySection, Grid2, KV,
  type FullProfile, type HolidayGroupRow, type StateRow, type Section,
} from './shared'

interface BankStatutoryTabProps {
  id: string | undefined
  isAdmin: boolean
  subTab: string
  visited: Set<Section>
  bs: FullProfile['bank_statutory'] | undefined
  bsHolidayGroupId: string | null
  compensationStructureName: string | undefined
}

export function BankStatutoryTab({
  id, isAdmin, subTab, visited, bs, bsHolidayGroupId, compensationStructureName,
}: BankStatutoryTabProps) {
  const qc = useQueryClient()

  const { data: esiEligData } = useQuery<{ data: { continuation_until?: string | null }[] }>({
    queryKey: ['esi-elig-profile', id],
    queryFn:  () => api.get(`/payroll/statutory/esi/eligibility?employee_id=${id}&active_only=true`),
    enabled:  !!id && visited.has('compensation'),
    staleTime: 120_000,
  })
  const esiEligRow = esiEligData?.data?.[0] ?? null

  // Holiday groups (for employee holiday calendar group tag)
  const { data: holidayGroupsData } = useQuery<{ data: HolidayGroupRow[] }>({
    queryKey: ['holiday-groups-list'],
    queryFn:  () => api.get('/masters/holiday-groups'),
    enabled:  !!id && visited.has('compensation'),
    staleTime: 5 * 60_000,
  })
  const holidayGroups = (holidayGroupsData?.data ?? []).filter((g) => g.is_active !== false)

  // Configured PT + LWF states — used for state override dropdowns (only show
  // states the tenant has actually set up, not the full list of 28)
  // PT/LWF state endpoints return a RAW ARRAY (not { data: [...] }). Normalize to
  // match the shared ['ptax-states'] / ['lwf-states'] cache shape used elsewhere.
  const { data: ptaxStates } = useQuery<{ state_code: string; state_name: string; enabled: boolean }[]>({
    queryKey: ['ptax-states'],
    queryFn:  () => api.get('/payroll/statutory/ptax/states')
      .then((r: unknown) => Array.isArray(r) ? r as StateRow[] : Array.isArray((r as { data?: unknown })?.data) ? (r as { data: StateRow[] }).data : []),
    enabled:  !!id && visited.has('compensation'),
    staleTime: 5 * 60_000,
  })
  const { data: lwfStates } = useQuery<{ state_code: string; state_name: string; enabled: boolean }[]>({
    queryKey: ['lwf-states'],
    queryFn:  () => api.get('/payroll/statutory/lwf/states')
      .then((r: unknown) => Array.isArray(r) ? r as StateRow[] : Array.isArray((r as { data?: unknown })?.data) ? (r as { data: StateRow[] }).data : []),
    enabled:  !!id && visited.has('compensation'),
    staleTime: 5 * 60_000,
  })
  const configuredPtLwfStates = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of ptaxStates ?? []) if (s.enabled) map.set(s.state_code, s.state_name)
    for (const s of lwfStates  ?? []) if (s.enabled) map.set(s.state_code, s.state_name)
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [ptaxStates, lwfStates])

  // Continuation period — operational data shown read-only on ESI status card
  const profileToday = new Date().toISOString().slice(0, 10)
  const esiContinuationActive = !!(esiEligRow?.continuation_until && esiEligRow.continuation_until >= profileToday)

  const [editBankOpen, setEditBankOpen] = useState(false)
  const [bankForm, setBankForm] = useState({
    bank_name: '', account_number: '', ifsc_code: '', branch_name: '',
    account_type: '' as 'savings' | 'current' | 'salary' | '',
    pan_number: '', aadhaar_number: '', uan_number: '', pf_number: '',
    esi_number: '', pt_applicable: false, lwf_applicable: false,
    tax_regime: 'new' as 'old' | 'new',
    pt_state_code:    '',
    lwf_state_code:   '',
    holiday_group_id: '',
  })
  // Open the editor with the WHOLE form reset from saved data (not merged), so
  // both the Bank and Statutory edit buttons show a faithful snapshot and never
  // carry stale values or default flags between edits. Masked fields
  // (account_number, aadhaar) load blank — blank means "keep unchanged".
  function openBankEditor() {
    setBankForm({
      bank_name:      bs?.bank_name    ?? '',
      account_number: '',
      ifsc_code:      bs?.ifsc         ?? '',
      branch_name:    bs?.branch       ?? '',
      account_type:   (bs?.account_type ?? '') as 'savings' | 'current' | 'salary' | '',
      pan_number:     bs?.pan          ?? '',
      aadhaar_number: '',
      uan_number:     bs?.uan          ?? '',
      pf_number:      bs?.pf_number    ?? '',
      esi_number:     bs?.esi_number   ?? '',
      pt_applicable:  bs?.pt_applicable  ?? false,
      lwf_applicable: bs?.lwf_applicable ?? false,
      tax_regime:     (bs?.tax_regime ?? 'new') as 'old' | 'new',
      // PT / LWF state: from bank-statutory response (merged from state config).
      pt_state_code:    bs?.pt_state_code    ?? '',
      lwf_state_code:   bs?.lwf_state_code   ?? '',
      holiday_group_id: (bs as { holiday_group_id?: string | null } | null | undefined)?.holiday_group_id ?? '',
    })
    setEditBankOpen(true)
  }
  const bankMutation = useMutation({
    mutationFn: () => {
      // A blanked clearable field sends null → the API erases it. Masked fields
      // (account_number, aadhaar) are sent ONLY when the admin typed a new value,
      // so leaving them blank keeps the existing (masked) value untouched.
      const clr = (v: string) => (v && v.trim() !== '' ? v.trim() : null)
      const body: Record<string, unknown> = {
        bank_name:      clr(bankForm.bank_name),
        ifsc_code:      clr(bankForm.ifsc_code),
        branch_name:    clr(bankForm.branch_name),
        account_type:   bankForm.account_type || null,
        pan_number:     clr(bankForm.pan_number),
        uan_number:     clr(bankForm.uan_number),
        pf_number:      clr(bankForm.pf_number),
        esi_number:     clr(bankForm.esi_number),
        pt_applicable:  bankForm.pt_applicable,
        lwf_applicable: bankForm.lwf_applicable,
        tax_regime:     bankForm.tax_regime,
        pt_state_code:    bankForm.pt_state_code    || null,
        lwf_state_code:   bankForm.lwf_state_code   || null,
        holiday_group_id: bankForm.holiday_group_id || null,
      }
      if (bankForm.account_number.trim()) body.account_number = bankForm.account_number.trim()
      if (bankForm.aadhaar_number.trim()) body.aadhaar_number = bankForm.aadhaar_number.trim()

      return api.put(`/employees/${id}/bank-statutory`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['epf-elig-profile', id] })
      qc.invalidateQueries({ queryKey: ['esi-elig-profile', id] })
      setEditBankOpen(false)
      toast.success('Bank & Statutory details updated')
    },
    onError: (e: Error) => toast.error('Save failed', { description: e.message }),
  })

  return (
    <>
      {subTab === 'bank' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Bank Details</CardTitle>
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                    onClick={openBankEditor}>
                    <Edit2 className="h-3.5 w-3.5" />{bs ? 'Edit' : 'Add'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!bs ? <EmptySection icon={Landmark} title="No bank info available" subtitle={isAdmin ? 'Click Edit to add bank details' : undefined} /> : (
                <Grid2>
                  <KV label="Bank Name"      value={bs.bank_name} />
                  <KV label="Account Number" value={bs.account_number_masked} />
                  <KV label="IFSC Code"      value={bs.ifsc} />
                  <KV label="Branch"         value={bs.branch} />
                  <KV label="Account Type"   value={bs.account_type} />
                </Grid2>
              )}
            </CardContent>
          </Card>

          {/* Aadhaar verification — HR only (consent-gated, Phase 1) */}
          {isAdmin && id && <AadhaarVerifyCard employeeId={id} />}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Statutory</CardTitle>
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                    onClick={openBankEditor}>
                    <Edit2 className="h-3.5 w-3.5" />{bs ? 'Edit' : 'Add'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!bs ? <EmptySection icon={Landmark} title="No statutory info available" /> : (
                <div className="space-y-4">
                  {/* Identity numbers */}
                  <Grid2>
                    <KV label="PAN"       value={bs.pan} />
                    <KV label="Aadhaar"   value={bs.aadhaar_masked} />
                    <KV label="UAN"       value={bs.uan} />
                    <KV label="PF Number" value={bs.pf_number} />
                    <KV label="ESI"       value={bs.esi_number} />
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Badge variant={bs.pt_applicable  ? 'success' : 'secondary'} className="rounded-full text-[10px]">
                        PT {bs.pt_applicable ? 'Applicable' : 'Exempt'}
                      </Badge>
                      <Badge variant={bs.lwf_applicable ? 'success' : 'secondary'} className="rounded-full text-[10px]">
                        LWF {bs.lwf_applicable ? 'Applicable' : 'Exempt'}
                      </Badge>
                      {bs.tax_regime && <Badge variant="outline" className="rounded-full text-[10px] capitalize">{bs.tax_regime} Regime</Badge>}
                    </div>
                    {/* PT state — override > site > auto */}
                    <KV
                      label="PT State"
                      value={bs.pt_state_code || (bs.site_state_code ? `Auto from site (${bs.site_state_code})` : 'Not configured')}
                    />
                    {/* LWF state — override > site > auto */}
                    <KV
                      label="LWF State"
                      value={bs.lwf_state_code || (bs.site_state_code ? `Auto from site (${bs.site_state_code})` : 'Not configured')}
                    />
                    {/* Holiday group */}
                    {bsHolidayGroupId && holidayGroups.length > 0 && (
                      <KV label="Holiday Group"
                        value={holidayGroups.find((g) => g.id === bsHolidayGroupId)?.name ?? bsHolidayGroupId} />
                    )}
                  </Grid2>

                  <TooltipProvider>
                  {/* EPF compliance status card */}
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">EPF Status</span>
                    <p className="text-xs text-muted-foreground">
                      PF applicability and ceiling mode are configured in the assigned salary structure.
                      {compensationStructureName
                        ? <> Current structure: <span className="font-medium text-foreground">{compensationStructureName}</span>. Edit via the Compensation tab.</>
                        : <> No salary structure is assigned yet.</>
                      }
                    </p>
                  </div>

                  {/* ESI compliance status card */}
                  <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">ESI Status</span>
                    <p className="text-xs text-muted-foreground">
                      ESI applicability is set on the assigned salary structure
                      {compensationStructureName
                        ? <> (<span className="font-medium text-foreground">{compensationStructureName}</span>)</>
                        : ' (no structure assigned yet)'}
                      . Ceiling and rates are configured on the{' '}
                      <a href="/admin/payroll/statutory/esi" className="text-primary underline underline-offset-2">ESI compliance page</a>.
                    </p>
                    {/* Continuation period — genuinely per-employee operational data */}
                    {esiContinuationActive && esiEligRow?.continuation_until && (
                      <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 mt-1">
                        <p className="text-[10px] text-warning leading-snug">
                          ESI contributions continue until <span className="font-semibold">{esiEligRow.continuation_until}</span> — salary crossed threshold mid-period.
                        </p>
                      </div>
                    )}
                  </div>
                  </TooltipProvider>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={editBankOpen} onOpenChange={setEditBankOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bank &amp; Statutory Details</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Bank account, statutory identifiers and scheme applicability for this employee.</p>
          </DialogHeader>
          <div className="space-y-0 max-h-[75vh] overflow-y-auto pr-2">

            {/* ── Section 1: Bank Account ───────────────────────────────── */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 mb-4">
              <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] items-center justify-center font-bold">1</span>
                Bank Account
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-muted-foreground">Bank Name</Label><Input className="mt-1 h-8 text-xs" value={bankForm.bank_name} onChange={e=>setBankForm(f=>({...f,bank_name:e.target.value}))}/></div>
                <div>
                  <Label className="text-xs text-muted-foreground">Account Type</Label>
                  <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={bankForm.account_type} onChange={e=>setBankForm(f=>({...f,account_type:e.target.value as 'savings' | 'current' | 'salary' | ''}))}>
                    <option value="">— Select —</option>
                    {['savings','current','salary'].map(t=><option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                  </select>
                </div>
                <div><Label className="text-xs text-muted-foreground">Account Number</Label><Input className="mt-1 h-8 text-xs font-mono" placeholder="Leave blank to keep existing (masked)" value={bankForm.account_number} onChange={e=>setBankForm(f=>({...f,account_number:e.target.value}))}/></div>
                <div><Label className="text-xs text-muted-foreground">IFSC Code</Label><Input className="mt-1 h-8 text-xs font-mono uppercase" value={bankForm.ifsc_code} onChange={e=>setBankForm(f=>({...f,ifsc_code:e.target.value.toUpperCase()}))}/></div>
                <div className="col-span-2"><Label className="text-xs text-muted-foreground">Branch Name</Label><Input className="mt-1 h-8 text-xs" value={bankForm.branch_name} onChange={e=>setBankForm(f=>({...f,branch_name:e.target.value}))}/></div>
              </div>
            </div>

            {/* ── Section 2: Statutory Identifiers ─────────────────────── */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 mb-4">
              <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] items-center justify-center font-bold">2</span>
                Statutory Identifiers
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div><Label className="text-xs text-muted-foreground">PAN Number</Label><Input className="mt-1 h-8 text-xs font-mono uppercase" value={bankForm.pan_number} onChange={e=>setBankForm(f=>({...f,pan_number:e.target.value.toUpperCase()}))}/></div>
                <div><Label className="text-xs text-muted-foreground">Aadhaar</Label><Input className="mt-1 h-8 text-xs font-mono" placeholder="Leave blank to keep" value={bankForm.aadhaar_number} onChange={e=>setBankForm(f=>({...f,aadhaar_number:e.target.value}))}/></div>
                <div>
                  <Label className="text-xs text-muted-foreground">Tax Regime</Label>
                  <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none" value={bankForm.tax_regime} onChange={e=>setBankForm(f=>({...f,tax_regime:e.target.value as 'old'|'new'}))}>
                    <option value="new">New Regime</option>
                    <option value="old">Old Regime</option>
                  </select>
                </div>
                <div><Label className="text-xs text-muted-foreground">UAN</Label><Input className="mt-1 h-8 text-xs font-mono" value={bankForm.uan_number} onChange={e=>setBankForm(f=>({...f,uan_number:e.target.value}))}/></div>
                <div><Label className="text-xs text-muted-foreground">PF Number</Label><Input className="mt-1 h-8 text-xs font-mono" value={bankForm.pf_number} onChange={e=>setBankForm(f=>({...f,pf_number:e.target.value}))}/></div>
                <div><Label className="text-xs text-muted-foreground">ESI Number</Label><Input className="mt-1 h-8 text-xs font-mono" value={bankForm.esi_number} onChange={e=>setBankForm(f=>({...f,esi_number:e.target.value}))}/></div>
              </div>
            </div>

            {/* ── Section 3: Scheme Applicability ──────────────────────── */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 mb-4">
              <p className="text-xs font-semibold text-foreground mb-0.5 flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] items-center justify-center font-bold">3</span>
                Scheme Applicability
              </p>
              <p className="text-[10px] text-muted-foreground mb-3 ml-6">
                PF / ESI follow the salary structure. PT and LWF state auto-derive from the assigned site
                {bs?.site_state_code ? <> (<span className="font-medium text-foreground">{bs.site_state_code}</span>)</> : ' — configure state on the site first'}.
                Toggle off to exempt this individual.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <Switch checked={bankForm.pt_applicable} onCheckedChange={v=>setBankForm(f=>({...f,pt_applicable:v}))} />
                  <div>
                    <p className="text-xs font-medium">PT Applicable</p>
                    <p className="text-[10px] text-muted-foreground">Off = exempt from Professional Tax.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                  <Switch checked={bankForm.lwf_applicable} onCheckedChange={v=>setBankForm(f=>({...f,lwf_applicable:v}))} />
                  <div>
                    <p className="text-xs font-medium">LWF Applicable</p>
                    <p className="text-[10px] text-muted-foreground">Off = exempt from Labour Welfare Fund.</p>
                  </div>
                </div>
              </div>

              {/* State override — for employees working in a different state than their site */}
              {(bankForm.pt_state_code || bankForm.lwf_state_code || !bs?.site_state_code) && (
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/50 mt-1">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">PT State Override</Label>
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none"
                      value={bankForm.pt_state_code} onChange={e => setBankForm(f => ({ ...f, pt_state_code: e.target.value }))}>
                      <option value="">{bs?.site_state_code ? `Auto from site (${bs.site_state_code})` : '— No site state —'}</option>
                      {configuredPtLwfStates.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">LWF State Override</Label>
                    <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none"
                      value={bankForm.lwf_state_code} onChange={e => setBankForm(f => ({ ...f, lwf_state_code: e.target.value }))}>
                      <option value="">{bs?.site_state_code ? `Auto from site (${bs.site_state_code})` : '— No site state —'}</option>
                      {configuredPtLwfStates.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
                    </select>
                  </div>
                </div>
              )}
              {bs?.site_state_code && !bankForm.pt_state_code && !bankForm.lwf_state_code && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  State overrides hidden — auto using site state <span className="font-medium text-foreground">{bs.site_state_code}</span>.{' '}
                  <button type="button" className="text-primary underline underline-offset-2"
                    onClick={() => setBankForm(f => ({ ...f, pt_state_code: bs.site_state_code ?? '', lwf_state_code: bs.site_state_code ?? '' }))}>
                    Override
                  </button>
                </p>
              )}
            </div>

            {/* ── Section 4: Calendar ───────────────────────────────────── */}
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] items-center justify-center font-bold">4</span>
                Calendar
              </p>
              <div>
                <Label className="text-xs text-muted-foreground">Holiday Calendar Group</Label>
                <p className="text-[10px] text-muted-foreground mb-1">Which group's holidays apply. Overrides the site's default group.</p>
                <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none"
                  value={bankForm.holiday_group_id} onChange={e => setBankForm(f => ({ ...f, holiday_group_id: e.target.value }))}>
                  <option value="">Inherit from site</option>
                  {holidayGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}{g.state_code ? ` (${g.state_code})` : ''}</option>
                  ))}
                </select>
              </div>
            </div>

          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={()=>setEditBankOpen(false)}>Cancel</Button>
            <Button size="sm" disabled={bankMutation.isPending} onClick={()=>bankMutation.mutate()}>
              {bankMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
