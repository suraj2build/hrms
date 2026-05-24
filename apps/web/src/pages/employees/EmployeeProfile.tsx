/**
 * EmployeeProfile — /employees/:id
 * 6 sections × 19 sub-tabs, left card + right panel layout.
 *
 * New sub-tabs (Phase 3 — Enterprise Master):
 *   Employment › workforce       — Workforce Assignment (dept/grade/cost-center)
 *   Employment › shift-schedule  — Shift & Attendance Context + history
 *   Compensation › payroll-ctx   — Payroll Context (revisions, bank verification)
 *   Core › onboarding            — Onboarding Status tracker
 *   Documents tab enhanced with mandatory doc indicators
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useBasePath } from '@/lib/routing'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  User, UserCircle, Briefcase, History, Building2, LogOut,
  DollarSign, Landmark, FileText, Files, Globe,
  Users, Award, CreditCard, Camera, Loader2,
  BookOpen, Plus, Trash2, Edit2, X, Check, Pencil,
  AlarmClock, Clock, ChevronLeft, ChevronRight,
  MapPin, LayoutGrid, CalendarClock, GraduationCap,
  AlertTriangle, CheckCircle2, Banknote, TrendingUp,
  KeyRound, ShieldCheck, ShieldOff, ShieldAlert, Mail, Send, Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { uploadEmployeeFile, getSignedUrl } from '@/lib/supabase-storage'

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = 'core' | 'employment' | 'compensation' | 'documents' | 'relationships' | 'assets'

const FIRST_SUB: Record<Section, string> = {
  core:          'profile',
  employment:    'workforce',
  compensation:  'compensation',
  documents:     'documents',
  relationships: 'family',
  assets:        'access-card',
}

// Mandatory document types — used to show missing-doc warnings
const MANDATORY_DOC_TYPES = [
  'Offer Letter', 'ID Proof', 'Address Proof', 'PAN Card',
  'Educational Certificate', 'Experience Letter',
]

interface FullProfile {
  employee: {
    id: string; first_name: string; last_name: string; email: string; phone: string | null
    employee_code: string; joining_date: string | null; status: string
    site_id:   string | null; roster_id:   string | null
    sites:   { id: string; name: string; timezone: string } | null
    rosters: { id: string; name: string; cycle_days: number } | null
  }
  personal_info: {
    gender: string | null; dob: string | null; marital_status: string | null
    blood_group: string | null; nationality: string | null; profile_photo: string | null
  } | null
  job_info: {
    id: string; employment_type: string; effective_from: string; effective_to: string | null
    departments:    { id: string; name: string } | null
    designations:   { id: string; name: string } | null
    grades:         { id: string; name: string; code: string } | null
    work_locations: { id: string; name: string; city: string } | null
    shifts:         { id: string; name: string; start_time?: string; end_time?: string } | null
    manager:        { id: string; first_name: string; last_name: string; employee_code: string } | null
    cost_center:    { id: string; name: string; code: string } | null
  } | null
  compensation: {
    id: string; ctc_annual: number; ctc_monthly: number
    structure: { id: string; name: string; code: string } | null
    components: Array<{
      id: string; sequence: number; calculation_type: string; value: number
      name: string | null; code: string | null
      component_type: 'earning' | 'deduction' | 'employer_contribution' | null
      is_basic: boolean; affects_pf: boolean; affects_nlc: boolean
      monthly_amount: number; annual_amount: number
    }>
    totals: {
      gross_monthly: number; gross_annual: number
      basic_monthly: number; basic_annual: number
      deductions_monthly: number; deductions_annual: number
      employer_contributions_monthly: number; employer_contributions_annual: number
      net_monthly: number; net_annual: number
    } | null
  } | null
  bank_statutory: {
    bank_name: string | null; account_number_masked: string | null; ifsc: string | null
    branch: string | null; account_type: string | null; pan: string | null
    aadhaar_masked: string | null; uan: string | null; pf_number: string | null
    esi_number: string | null; pt_applicable: boolean; lwf_applicable: boolean
    tax_regime: string | null
  } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val?: string | null) { return val ?? '—' }

function fmtDate(s?: string | null) {
  if (!s) return '—'
  return new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('default', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtMoney(n?: number | null) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

const STATUS_VARIANT: Record<string, 'success' | 'secondary' | 'warning' | 'destructive'> = {
  active: 'success', inactive: 'secondary', on_notice: 'warning', separated: 'destructive',
}

function KV({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value ?? '—'}</p>
    </div>
  )
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
}

function EmptySection({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      <Icon className="h-7 w-7 opacity-30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {subtitle && <p className="text-xs">{subtitle}</p>}
    </div>
  )
}

function AssignableField({
  label, value, futureValue, futureDate, onAssign, canAssign,
}: {
  label: string
  value?: string | null
  futureValue?: string | null
  futureDate?: string | null
  onAssign: () => void
  canAssign: boolean
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{value ?? '—'}</p>
          {futureValue && (
            <p className="text-[10px] text-warning mt-0.5 flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
              {futureValue} from {futureDate}
            </p>
          )}
        </div>
        {canAssign && (
          <button
            onClick={onAssign}
            className="flex-shrink-0 text-[10px] text-muted-foreground hover:text-foreground border border-border hover:border-primary/50 rounded px-1.5 py-0.5 transition-colors"
          >
            Reassign
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EmployeeProfile() {
  const { id }       = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc           = useQueryClient()
  const { profile: authProfile } = useAuthStore()
  const basePath     = useBasePath()
  const tenantId     = (authProfile as any)?.tenant_id ?? ''
  const isAdmin      = ['super_admin', 'hr_admin'].includes(authProfile?.role ?? '')

  const [section,  setSection]  = useState<Section>('core')
  const [subTab,   setSubTab]   = useState('profile')
  const [visited,  setVisited]  = useState(new Set<Section>(['core']))

  function changeSection(s: Section) {
    setSection(s)
    setSubTab(FIRST_SUB[s])
    setVisited(prev => new Set([...prev, s]))
  }

  // ── Core query ─────────────────────────────────────────────────────────────
  const { data: fpData, isLoading } = useQuery<FullProfile>({
    queryKey: ['employee-full', id],
    queryFn:  () => api.get(`/employees/${id}/full-profile`),
    enabled:  !!id,
    staleTime: 60_000,
  })
  const emp  = fpData?.employee
  const pi   = fpData?.personal_info
  const job  = fpData?.job_info
  const comp = fpData?.compensation
  const bs   = fpData?.bank_statutory

  // ── Lazy queries ───────────────────────────────────────────────────────────
  const { data: jobHistoryData } = useQuery<{ data: any[] }>({
    queryKey: ['job-history-all', id], queryFn: () => api.get(`/employees/${id}/job-history`),
    enabled: !!id && visited.has('employment'), staleTime: 30_000,
  })
  const { data: prevEmpData } = useQuery<{ data: any[] }>({
    queryKey: ['prev-employment', id], queryFn: () => api.get(`/employees/${id}/previous-employment`),
    enabled: !!id && visited.has('employment'), staleTime: 30_000,
  })
  const { data: separationData } = useQuery({
    queryKey: ['separation', id],
    queryFn: async (): Promise<{ data: any }> => {
      try {
        return await api.get<{ data: any }>(`/employees/${id}/separation`)
      } catch (e: any) {
        if (String(e?.message ?? '').includes('404') || e?.status === 404) return { data: null }
        throw e
      }
    },
    enabled: !!id && visited.has('employment'), staleTime: 30_000,
  })
  const { data: contractsData } = useQuery<{ data: any[] }>({
    queryKey: ['contracts', id], queryFn: () => api.get(`/employees/${id}/contracts`),
    enabled: !!id && visited.has('compensation'), staleTime: 30_000,
  })
  const { data: docsData } = useQuery<{ data: any[] }>({
    queryKey: ['emp-docs', id], queryFn: () => api.get(`/employees/${id}/documents`),
    enabled: !!id && visited.has('documents'), staleTime: 30_000,
  })
  const { data: pvData } = useQuery<{ data: any[] }>({
    queryKey: ['passport-visa', id], queryFn: () => api.get(`/employees/${id}/passport-visa`),
    enabled: !!id && visited.has('documents'), staleTime: 30_000,
  })
  const { data: familyData } = useQuery<{ data: any[] }>({
    queryKey: ['family', id], queryFn: () => api.get(`/employees/${id}/family`),
    enabled: !!id && visited.has('relationships'), staleTime: 30_000,
  })
  const { data: nominationsData } = useQuery<{ data: any[] }>({
    queryKey: ['nominations', id], queryFn: () => api.get(`/employees/${id}/nominations`),
    enabled: !!id && visited.has('relationships'), staleTime: 30_000,
  })
  const { data: accessCardsData } = useQuery<{ data: any[] }>({
    queryKey: ['access-cards', id], queryFn: () => api.get(`/employees/${id}/access-cards`),
    enabled: !!id && visited.has('assets'), staleTime: 30_000,
  })

  // ── New: Shift history ─────────────────────────────────────────────────────
  const { data: shiftHistoryData } = useQuery<{ data: any[] }>({
    queryKey: ['shift-history', id],
    queryFn:  () => api.get(`/employees/${id}/shift-history`),
    enabled:  !!id && visited.has('employment'),
    staleTime: 60_000,
  })

  // ── New: Onboarding status ─────────────────────────────────────────────────
  interface OnboardingStatus {
    session: { id: string; status: string; created_at: string; updated_at: string } | null
    draft:   { id: string; status: string; confidence_score: number | null; created_at: string; updated_at: string }
    documents: { total: number; extracted: number; failed: number; items: any[] }
  }
  const { data: onboardingData } = useQuery<{ data: OnboardingStatus | null }>({
    queryKey: ['onboarding-status', id],
    queryFn:  () => api.get(`/employees/${id}/onboarding-status`),
    enabled:  !!id && visited.has('core'),
    staleTime: 120_000,
  })
  const onboardingStatus = onboardingData?.data ?? null

  // ── User Account (lazy, admin only) ────────────────────────────────────────
  interface UserAccountData {
    status:    'no_account' | 'pending_verification' | 'active' | 'suspended'
    profile:   { id: string; role: string; is_active: boolean; full_name: string; created_at: string } | null
    auth_user: { email: string; email_confirmed_at: string | null; last_sign_in_at: string | null; created_at: string } | null
    email:     string | null
  }
  const { data: userAccountData, refetch: refetchUserAccount } = useQuery<UserAccountData>({
    queryKey: ['user-account', id],
    queryFn:  () => api.get(`/employees/${id}/user-account`),
    enabled:  !!id && visited.has('core') && isAdmin,
    staleTime: 30_000,
  })

  // ── Important Dates (lazy, admin-only write; all can read) ───────────────────
  interface ImportantDateRow {
    id:           string
    date_type_id: string
    event_date:   string
    year_known:   boolean
    notes:        string | null
    updated_at:   string
    important_date_types?: { id: string; code: string; name: string; is_system: boolean } | null
  }
  interface ImportantDateType { id: string; code: string; name: string; is_system: boolean; is_active: boolean }
  const { data: importantDatesData, isLoading: importantDatesLoading } = useQuery<{ data: ImportantDateRow[] }>({
    queryKey: ['important-dates', id],
    queryFn:  () => api.get(`/employees/${id}/important-dates`),
    enabled:  !!id && visited.has('core'),
    staleTime: 60_000,
  })
  const { data: dateTypesData } = useQuery<{ data: ImportantDateType[] }>({
    queryKey: ['important-date-types'],
    queryFn:  () => api.get('/masters/important-date-types'),
    enabled:  !!id && visited.has('core'),
    staleTime: 300_000,
  })
  const importantDates   = importantDatesData?.data ?? []
  const availDateTypes   = (dateTypesData?.data ?? []).filter((dt: ImportantDateType) => dt.is_active)
  const [idateDlgOpen,   setIdateDlgOpen]   = useState(false)
  const [idateEditRow,   setIdateEditRow]   = useState<ImportantDateRow | null>(null)
  const [idateForm,      setIdateForm]      = useState({ date_type_id: '', event_date: '', year_known: true, notes: '' })

  const upsertImportantDateMut = useMutation({
    mutationFn: (f: typeof idateForm) =>
      api.post(`/employees/${id}/important-dates`, {
        date_type_id: f.date_type_id,
        event_date:   f.event_date,
        year_known:   f.year_known,
        notes:        f.notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Important date saved')
      qc.invalidateQueries({ queryKey: ['important-dates', id] })
      setIdateDlgOpen(false)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Failed to save date'),
  })

  const deleteImportantDateMut = useMutation({
    mutationFn: (dateId: string) => api.delete(`/employees/${id}/important-dates/${dateId}`),
    onSuccess: () => {
      toast.success('Important date removed')
      qc.invalidateQueries({ queryKey: ['important-dates', id] })
    },
    onError: () => toast.error('Failed to remove date'),
  })

  const [accountDlgOpen, setAccountDlgOpen] = useState(false)
  const [accountForm,    setAccountForm]    = useState({
    email:              '',
    role:               'employee' as 'employee' | 'manager',
    temporary_password: '',
    send_invite:        false,   // primary = direct creation
    is_active:          true,
  })
  // Holds auto-generated credentials after a successful direct-creation so admin can copy them
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null)

  const createAccountMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/user-account`, {
      email:              accountForm.email,
      role:               accountForm.role,
      temporary_password: accountForm.send_invite ? undefined : (accountForm.temporary_password || undefined),
      send_invite:        accountForm.send_invite,
      is_active:          accountForm.is_active,
    }),
    onSuccess: (res: any) => {
      const genPwd = res?.data?.generated_password as string | undefined
      if (genPwd) {
        // Stay open — show credentials panel so admin can copy the password
        setCreatedCredentials({ email: accountForm.email, password: genPwd })
      } else {
        toast.success(accountForm.send_invite ? 'Invite sent successfully' : 'Account created')
        setAccountDlgOpen(false)
        setAccountForm({ email: '', role: 'employee', temporary_password: '', send_invite: false, is_active: true })
      }
      refetchUserAccount()
    },
    onError: (e: Error) => toast.error('Failed to create account', { description: e.message }),
  })

  const patchAccountMutation = useMutation({
    mutationFn: (action: 'suspend' | 'reactivate') => api.patch(`/employees/${id}/user-account`, { action }),
    onSuccess: (_, action) => {
      toast.success(action === 'suspend' ? 'Account suspended' : 'Account reactivated')
      refetchUserAccount()
    },
    onError: (e: Error) => toast.error('Failed to update account', { description: e.message }),
  })

  // ── New: Payroll revisions (lazy, admin only) ──────────────────────────────
  const { data: payrollRevisionsData, refetch: refetchRevisions } = useQuery<{ data: any[] }>({
    queryKey: ['payroll-revisions', id],
    queryFn:  () => api.get(`/payroll/revisions?employee_id=${id}`),
    enabled:  !!id && visited.has('compensation') && isAdmin,
    staleTime: 60_000,
  })

  // ── New: Compensation history timeline (lazy) ───────────────────────────────
  const { data: compensationHistoryData, refetch: refetchCompHistory } = useQuery<{ data: any[] }>({
    queryKey: ['compensation-history', id],
    queryFn:  () => api.get(`/employees/${id}/compensation/history`),
    enabled:  !!id && visited.has('compensation'),
    staleTime: 60_000,
  })

  // ── Compensation revision state ─────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const [revisionOpen, setRevisionOpen]   = useState(false)
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null)
  const [rejectReason, setRejectReason]   = useState('')
  const [revisionForm, setRevisionForm] = useState({
    revision_type:    'increment',
    effective_date:   today,
    reason:           '',
    new_ctc_annual:   '',
    notes:            '',
  })

  const pendingRevisions = useMemo(
    () => (payrollRevisionsData?.data ?? []).filter(
      (r: any) => !['approved', 'rejected', 'withdrawn'].includes(r.status)
    ),
    [payrollRevisionsData],
  )

  const initiateRevisionMutation = useMutation({
    mutationFn: () => api.post('/payroll/revisions', {
      employee_id:       id,
      revision_type:     revisionForm.revision_type,
      effective_date:    revisionForm.effective_date,
      reason:            revisionForm.reason,
      new_ctc_annual:    Number(revisionForm.new_ctc_annual),
      before_ctc_annual: comp?.ctc_annual ?? undefined,
      notes:             revisionForm.notes || undefined,
    }),
    onSuccess: () => {
      toast.success('Revision initiated — pending approval')
      setRevisionOpen(false)
      setRevisionForm({ revision_type: 'increment', effective_date: today, reason: '', new_ctc_annual: '', notes: '' })
      refetchRevisions()
    },
    onError: (e: Error) => toast.error('Failed to initiate revision', { description: e.message }),
  })

  const approveRevisionMutation = useMutation({
    mutationFn: (revId: string) => api.post(`/payroll/revisions/${revId}/approve`),
    onSuccess: () => {
      toast.success('Revision approved')
      refetchRevisions()
      refetchCompHistory()
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
    },
    onError: (e: Error) => toast.error('Failed to approve revision', { description: e.message }),
  })

  const rejectRevisionMutation = useMutation({
    mutationFn: ({ revId, reason }: { revId: string; reason: string }) =>
      api.post(`/payroll/revisions/${revId}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      toast.success('Revision rejected')
      setRejectTarget(null)
      setRejectReason('')
      refetchRevisions()
    },
    onError: (e: Error) => toast.error('Failed to reject revision', { description: e.message }),
  })

  // ── Setup / Edit Compensation state ─────────────────────────────────────────
  const [setupCompOpen, setSetupCompOpen] = useState(false)
  const [setupCompForm, setSetupCompForm] = useState({
    salary_structure_id: '',
    ctc_annual: '',
    effective_from: today,
    components: [{ salary_component_id: '', calculation_type: 'fixed', value: '' }] as Array<{
      salary_component_id: string; calculation_type: string; value: string
    }>,
  })

  const { data: salaryStructuresData } = useQuery<{ data: Array<{ id: string; name: string; code: string }> }>({
    queryKey: ['salary-structures-list'],
    queryFn:  () => api.get('/masters/salary-structures'),
    enabled:  setupCompOpen,
    staleTime: 120_000,
  })

  const { data: salaryComponentsData } = useQuery<{ data: Array<{ id: string; name: string; code: string; component_type: string }> }>({
    queryKey: ['salary-components-list'],
    queryFn:  () => api.get('/masters/salary-components'),
    enabled:  setupCompOpen,
    staleTime: 120_000,
  })

  // When a structure is selected, offer to auto-load its component templates
  const { data: structureComponentsData } = useQuery<{
    data: Array<{ salary_component_id: string; calculation_type: string; default_value: number }>
  }>({
    queryKey: ['structure-components', setupCompForm.salary_structure_id],
    queryFn:  () => api.get(`/masters/salary-structures/${setupCompForm.salary_structure_id}/components`),
    enabled:  !!setupCompForm.salary_structure_id && setupCompOpen,
    staleTime: 120_000,
  })

  const setupCompMutation = useMutation({
    mutationFn: () => api.post(`/employees/${id}/compensation`, {
      ...(setupCompForm.salary_structure_id ? { salary_structure_id: setupCompForm.salary_structure_id } : {}),
      ctc_annual:     Number(setupCompForm.ctc_annual),
      effective_from: setupCompForm.effective_from,
      components: setupCompForm.components
        .filter(c => c.salary_component_id && c.value)
        .map(c => ({
          salary_component_id: c.salary_component_id,
          calculation_type:    c.calculation_type,
          value:               Number(c.value),
        })),
    }),
    onSuccess: () => {
      toast.success('Compensation configured successfully')
      setSetupCompOpen(false)
      setSetupCompForm({ salary_structure_id: '', ctc_annual: '', effective_from: today, components: [{ salary_component_id: '', calculation_type: 'fixed', value: '' }] })
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['compensation-history', id] })
    },
    onError: (e: Error) => toast.error('Failed to configure compensation', { description: e.message }),
  })

  // ── Org context ────────────────────────────────────────────────────────────
  interface OrgContextData {
    site:              { id: string; name: string; timezone: string } | null
    roster:            { id: string; name: string; cycle_days: number } | null
    roster_source:     'employee' | 'site' | null
    effective_from:    string | null
    source:            'history' | 'employee'
    upcoming_holidays: { date: string; name: string; is_optional: boolean }[]
  }

  const { data: orgCtxData, refetch: refetchOrgCtx } = useQuery<{ data: OrgContextData }>({
    queryKey: ['emp-org-context', id],
    queryFn:  () => api.get(`/employees/${id}/org-context`),
    enabled:  !!id && visited.has('employment'),
    staleTime: 60_000,
  })
  const orgCtx = orgCtxData?.data

  const [orgDlgOpen, setOrgDlgOpen] = useState(false)
  const [orgForm, setOrgForm]       = useState({ site_id: '', roster_id: '', effective_from: new Date().toISOString().slice(0, 10), reason: '' })

  const orgMutation = useMutation({
    mutationFn: (body: typeof orgForm) =>
      api.post(`/employees/${id}/org-context`, {
        site_id:        body.site_id        || null,
        roster_id:      body.roster_id      || null,
        effective_from: body.effective_from,
        reason:         body.reason         || null,
      }),
    onSuccess: () => { setOrgDlgOpen(false); refetchOrgCtx(); toast.success('Organisation context updated') },
    onError:   (e: Error) => toast.error('Failed to update org context', { description: e.message }),
  })

  const { data: sitesListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['sites-list'],
    queryFn:  () => api.get('/masters/sites'),
    enabled:  orgDlgOpen,
    staleTime: 120_000,
  })
  const { data: rostersListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['rosters-list'],
    queryFn:  () => api.get('/masters/rosters'),
    enabled:  orgDlgOpen,
    staleTime: 120_000,
  })
  const sitesList   = sitesListData?.data   ?? []
  const rostersList = rostersListData?.data ?? []

  // ── Operational assignment state ──────────────────────────────────────────
  type AssignTarget =
    | 'department' | 'designation' | 'grade' | 'manager'
    | 'cost_center' | 'employment_type' | 'work_location' | 'shift'
    | null
  const [assignTarget, setAssignTarget] = useState<AssignTarget>(null)
  const [assignForm, setAssignForm] = useState({
    value: '', effective_from: new Date().toISOString().slice(0, 10), reason: '',
  })

  function openAssign(target: AssignTarget) {
    setAssignTarget(target)
    setAssignForm({ value: '', effective_from: new Date().toISOString().slice(0, 10), reason: '' })
  }

  // ── Master data for assignment dialogs (lazy — loads only when dialog opens) ─
  const { data: deptListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['masters-departments'], queryFn: () => api.get('/masters/departments'),
    enabled: assignTarget === 'department', staleTime: 300_000,
  })
  const { data: desigListData } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['masters-designations'], queryFn: () => api.get('/masters/designations'),
    enabled: assignTarget === 'designation', staleTime: 300_000,
  })
  const { data: gradeListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['masters-grades'], queryFn: () => api.get('/masters/grades'),
    enabled: assignTarget === 'grade', staleTime: 300_000,
  })
  const { data: ccListData } = useQuery<{ data: { id: string; name: string; code: string }[] }>({
    queryKey: ['masters-cost-centers'], queryFn: () => api.get('/masters/cost-centers'),
    enabled: assignTarget === 'cost_center', staleTime: 300_000,
  })
  const { data: wlListData } = useQuery<{ data: { id: string; name: string; city: string }[] }>({
    queryKey: ['masters-work-locations'], queryFn: () => api.get('/masters/work-locations'),
    enabled: assignTarget === 'work_location', staleTime: 300_000,
  })
  const { data: shiftListData } = useQuery<{ data: { id: string; name: string; code: string; start_time: string; end_time: string }[] }>({
    queryKey: ['masters-shifts'], queryFn: () => api.get('/masters/shifts'),
    enabled: assignTarget === 'shift', staleTime: 300_000,
  })
  const { data: managerListData } = useQuery<{ data: any[]; total: number }>({
    queryKey: ['employees-active-list'],
    queryFn: () => api.get('/employees?status=active&limit=500'),
    enabled: assignTarget === 'manager', staleTime: 120_000,
  })

  const EMPLOYMENT_TYPES = ['permanent', 'contract', 'intern', 'probation', 'consultant'] as const

  // Field → master list options
  const assignOptions: Record<string, { id: string; label: string }[]> = {
    department:      (deptListData?.data  ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.code})` })),
    designation:     (desigListData?.data ?? []).map(r => ({ id: r.id, label: r.name })),
    grade:           (gradeListData?.data ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.code})` })),
    cost_center:     (ccListData?.data    ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.code})` })),
    work_location:   (wlListData?.data    ?? []).map(r => ({ id: r.id, label: r.city ? `${r.name} · ${r.city}` : r.name })),
    shift:           (shiftListData?.data ?? []).map(r => ({ id: r.id, label: `${r.name} (${r.start_time}–${r.end_time})` })),
    manager:         (managerListData?.data ?? []).filter((e: any) => e.id !== id).map((e: any) => ({ id: e.id, label: `${e.first_name} ${e.last_name} #${e.employee_code}` })),
    employment_type: EMPLOYMENT_TYPES.map(t => ({ id: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
  }

  // Field → display config
  const ASSIGN_CONFIG: Record<string, { title: string; fieldKey: string; currentLabel: string }> = {
    department:      { title: 'Reassign Department',      fieldKey: 'department_id',      currentLabel: job?.departments?.name ?? '—'  },
    designation:     { title: 'Reassign Designation',     fieldKey: 'designation_id',     currentLabel: job?.designations?.name ?? '—' },
    grade:           { title: 'Reassign Grade / Band',    fieldKey: 'grade_id',           currentLabel: job?.grades ? `${job.grades.name} (${job.grades.code})` : '—' },
    manager:         { title: 'Reassign Reporting Manager', fieldKey: 'manager_id',       currentLabel: job?.manager ? `${job.manager.first_name} ${job.manager.last_name}` : '—' },
    cost_center:     { title: 'Reassign Cost Center',     fieldKey: 'cost_center_id',     currentLabel: job?.cost_center ? `${job.cost_center.name} (${job.cost_center.code})` : '—' },
    work_location:   { title: 'Reassign Work Location',   fieldKey: 'work_location_id',   currentLabel: job?.work_locations ? `${job.work_locations.name}` : '—' },
    employment_type: { title: 'Change Employment Type',   fieldKey: 'employment_type',    currentLabel: job?.employment_type ?? '—' },
    shift:           { title: 'Apply Shift Override',      fieldKey: 'shift_id',           currentLabel: job?.shifts?.name ?? '—' },
  }

  // ── Job-field assignment (creates new job_history record carrying forward all other values) ─
  const jobAssignMutation = useMutation({
    mutationFn: async ({ fieldKey, value, effective_from, reason }: {
      fieldKey: string; value: string; effective_from: string; reason: string
    }) => {
      if (!job) throw new Error('No current job record to carry forward')
      const body: Record<string, unknown> = {
        employment_type:  job.employment_type,
        department_id:    job.departments?.id    ?? null,
        designation_id:   job.designations?.id   ?? null,
        grade_id:         job.grades?.id         ?? null,
        manager_id:       job.manager?.id        ?? null,
        cost_center_id:   job.cost_center?.id    ?? null,
        work_location_id: job.work_locations?.id ?? null,
        shift_id:         job.shifts?.id         ?? null,
        effective_from,
        reason_for_change: reason || undefined,
        is_current: true,
      }
      // Override only the target field
      body[fieldKey] = value || null
      return api.post(`/employees/${id}/job-history`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['job-history-all', id] })
      setAssignTarget(null)
      toast.success('Assignment updated')
    },
    onError: (e: Error) => toast.error('Assignment failed', { description: e.message }),
  })

  // ── Shift-specific assignment (separate endpoint) ───────────────────────────
  const shiftAssignMutation = useMutation({
    mutationFn: ({ shift_id, effective_from }: { shift_id: string; effective_from: string }) =>
      api.post('/masters/employee-shifts/assign', { employee_id: id, shift_id, effective_from }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      qc.invalidateQueries({ queryKey: ['shift-history', id] })
      setAssignTarget(null)
      toast.success('Shift assigned')
    },
    onError: (e: Error) => toast.error('Shift assignment failed', { description: e.message }),
  })

  // Derive future-dated job assignment (first future record per field)
  const futureJobRecord = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return (jobHistoryData?.data ?? []).find(
      (r: any) => r.effective_from > today && r.is_current
    ) ?? null
  }, [jobHistoryData])

  // ── Photo upload ───────────────────────────────────────────────────────────
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadEmployeeFile(tenantId, id!, 'photos', file)
      await api.put(`/employees/${id}/personal-info`, { profile_photo: path })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); toast.success('Photo updated') },
    onError:   () => toast.error('Photo upload failed'),
  })

  // ── URL-driven edit mode (?edit=true opens profile edit; ?tab=X jumps section) ──
  useEffect(() => {
    if (searchParams.get('edit') === 'true') {
      setEditProfile(true)
      // Remove the param so Back/refresh doesn't re-trigger
      setSearchParams(prev => { prev.delete('edit'); return prev }, { replace: true })
    }
    const tabParam = searchParams.get('tab')
    if (tabParam) {
      // Map known tab slugs → section + subTab
      const TAB_MAP: Record<string, { section: Section; subTab: string }> = {
        personal:     { section: 'core',         subTab: 'personal'     },
        employment:   { section: 'employment',   subTab: 'job'          },
        compensation: { section: 'compensation', subTab: 'compensation' },
        documents:    { section: 'documents',    subTab: 'docs'         },
        separation:   { section: 'employment',   subTab: 'separation'   },
        payroll:      { section: 'compensation', subTab: 'payroll-ctx'  },
      }
      const mapped = TAB_MAP[tabParam]
      if (mapped) {
        setSection(mapped.section)
        setSubTab(mapped.subTab)
        setVisited(prev => new Set([...prev, mapped.section]))
      }
      setSearchParams(prev => { prev.delete('tab'); return prev }, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // run once on mount — searchParams is stable at mount

  // ── Profile edit ───────────────────────────────────────────────────────────
  const [editProfile, setEditProfile] = useState(false)
  const [profileForm, setProfileForm] = useState<any>({})
  const profileMutation = useMutation({
    mutationFn: (d: any) => api.put(`/employees/${id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); setEditProfile(false); toast.success('Saved') },
    onError:   () => toast.error('Save failed'),
  })

  // ── Personal info edit ─────────────────────────────────────────────────────
  const [editPI, setEditPI] = useState(false)
  const [piForm, setPiForm] = useState<any>({})
  const piMutation = useMutation({
    mutationFn: (d: any) => api.put(`/employees/${id}/personal-info`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee-full', id] }); setEditPI(false); toast.success('Saved') },
    onError:   () => toast.error('Save failed'),
  })

  // ── Job history ────────────────────────────────────────────────────────────
  const [addJobOpen, setAddJobOpen] = useState(false)
  const [jobForm, setJobForm]       = useState<any>({})
  const addJobMutation = useMutation({
    mutationFn: (d: any) => api.post(`/employees/${id}/job-history`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['job-history-all', id] }); qc.invalidateQueries({ queryKey: ['employee-full', id] }); setAddJobOpen(false); toast.success('Position added') },
    onError:   () => toast.error('Failed to add position'),
  })

  // ── Previous employment ────────────────────────────────────────────────────
  const [addPrevOpen, setAddPrevOpen] = useState(false)
  const [prevForm, setPrevForm]       = useState<any>({})
  const addPrevMutation = useMutation({
    mutationFn: (d: any) => api.post(`/employees/${id}/previous-employment`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prev-employment', id] }); setAddPrevOpen(false); toast.success('Added') },
    onError:   () => toast.error('Failed'),
  })
  const delPrevMutation = useMutation({
    mutationFn: (prevId: string) => api.delete(`/employees/${id}/previous-employment/${prevId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prev-employment', id] }); toast.success('Employment record removed') },
    onError:   (e: Error) => toast.error('Failed to remove record', { description: e.message }),
  })

  // ── Passport / Visa ────────────────────────────────────────────────────────
  const [addPvOpen, setAddPvOpen] = useState(false)
  const [pvForm, setPvForm]       = useState<any>({ record_type: 'passport' })
  const addPvMutation = useMutation({
    mutationFn: (d: any) => api.post(`/employees/${id}/passport-visa`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['passport-visa', id] }); setAddPvOpen(false); toast.success('Added') },
    onError:   () => toast.error('Failed'),
  })
  const delPvMutation = useMutation({
    mutationFn: (pvId: string) => api.delete(`/employees/${id}/passport-visa/${pvId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['passport-visa', id] }); toast.success('Record deleted') },
    onError:   (e: Error) => toast.error('Failed to delete record', { description: e.message }),
  })

  // ── Family ─────────────────────────────────────────────────────────────────
  const [addFamOpen, setAddFamOpen] = useState(false)
  const [famForm, setFamForm]       = useState<any>({})
  const addFamMutation = useMutation({
    mutationFn: (d: any) => api.post(`/employees/${id}/family`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['family', id] }); setAddFamOpen(false); toast.success('Added') },
    onError:   () => toast.error('Failed'),
  })
  const delFamMutation = useMutation({
    mutationFn: (famId: string) => api.delete(`/employees/${id}/family/${famId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['family', id] }); toast.success('Family member removed') },
    onError:   (e: Error) => toast.error('Failed to remove family member', { description: e.message }),
  })

  // ── Access cards ───────────────────────────────────────────────────────────
  const [addCardOpen, setAddCardOpen] = useState(false)
  const [cardForm, setCardForm]       = useState<any>({})
  const addCardMutation = useMutation({
    mutationFn: (d: any) => api.post(`/employees/${id}/access-cards`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['access-cards', id] }); setAddCardOpen(false); toast.success('Card issued') },
    onError:   () => toast.error('Failed'),
  })
  const updateCardMutation = useMutation({
    mutationFn: ({ cardId, status }: { cardId: string; status: string }) =>
      api.put(`/employees/${id}/access-cards/${cardId}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['access-cards', id] }); toast.success('Card status updated') },
    onError:   (e: Error) => toast.error('Failed to update card status', { description: e.message }),
  })

  // ── Document upload ────────────────────────────────────────────────────────
  const docInputRef  = useRef<HTMLInputElement>(null)
  const [docMeta, setDocMeta]   = useState<{ name: string; doc_type: string } | null>(null)
  const [docFile, setDocFile]   = useState<File | null>(null)
  const [docMetaOpen, setDocMetaOpen] = useState(false)
  const uploadDocMutation = useMutation({
    mutationFn: async ({ file, name, doc_type }: { file: File; name: string; doc_type: string }) => {
      const path = await uploadEmployeeFile(tenantId, id!, 'documents', file)
      await api.post(`/employees/${id}/documents`, { name, doc_type, storage_path: path, file_size: file.size, mime_type: file.type })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emp-docs', id] }); setDocMetaOpen(false); setDocMeta(null); setDocFile(null); toast.success('Document uploaded') },
    onError:   () => toast.error('Upload failed'),
  })
  const delDocMutation = useMutation({
    mutationFn: (docId: string) => api.delete(`/employees/${id}/documents/${docId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emp-docs', id] }); toast.success('Document deleted') },
    onError:   (e: Error) => toast.error('Failed to delete document', { description: e.message }),
  })

  const openSignedUrl = useCallback(async (path: string) => {
    try { window.open(await getSignedUrl(path), '_blank') }
    catch { toast.error('Could not open file') }
  }, [])

  // ── Roster today (Work Configuration panel) ────────────────────────────────
  interface RosterToday {
    id: string; date: string; shift_id: string
    shifts: { id: string; name: string; code: string | null; start_time: string; end_time: string }
  }
  const { data: rosterTodayData } = useQuery<{ data: RosterToday | null }>({
    queryKey: ['employee-roster-today', id],
    queryFn:  () => api.get(`/attendance/roster/employee/${id}`),
    enabled:  !!id && isAdmin,
    staleTime: 60_000,
  })
  const rosterToday = rosterTodayData?.data ?? null

  // ── Monthly attendance summary ─────────────────────────────────────────────
  const [attMonth, setAttMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const attFrom = `${attMonth}-01`
  const attTo   = useMemo(() => {
    const [y, m] = attMonth.split('-').map(Number)
    return new Date(y, m, 0).toISOString().slice(0, 10)
  }, [attMonth])

  interface AttSummary { total_days: number; payable_days: number; lop_days: number; present: number; absent: number; late: number }
  const { data: attResp, isLoading: attLoading } = useQuery<{ summary: AttSummary }>({
    queryKey: ['employee-attendance-summary', id, attMonth],
    queryFn:  () => api.get(`/attendance/${id}?from=${attFrom}&to=${attTo}`),
    enabled:  !!id,
    staleTime: 60_000,
  })
  const attSummary = attResp?.summary

  // ── Loading guard ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }
  if (!emp) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground text-sm">Employee not found.</p>
        <Button variant="outline" size="sm" className="mt-4" asChild>
          <Link to={`${basePath}/employees`}>Back to People</Link>
        </Button>
      </div>
    )
  }

  const initials = `${emp.first_name?.[0] ?? ''}${emp.last_name?.[0] ?? ''}`.toUpperCase()

  const SECTIONS: Array<{ key: Section; label: string }> = [
    { key: 'core',          label: 'Core' },
    { key: 'employment',    label: 'Employment' },
    { key: 'compensation',  label: 'Compensation' },
    { key: 'documents',     label: 'Documents' },
    { key: 'relationships', label: 'Relationships' },
    { key: 'assets',        label: 'Assets' },
  ]

  const SUB_TABS: Record<Section, Array<{ key: string; label: string; icon: React.ElementType }>> = {
    core:          [
      { key: 'profile',    label: 'Profile',        icon: User       },
      { key: 'personal',   label: 'Personal Info',  icon: UserCircle },
      { key: 'jobinfo',    label: 'Job Info',        icon: Briefcase  },
      { key: 'onboarding',      label: 'Onboarding',       icon: GraduationCap },
      { key: 'important-dates', label: 'Important Dates',   icon: CalendarClock },
      ...(isAdmin ? [{ key: 'account', label: 'User Account', icon: KeyRound }] : []),
    ],
    employment:    [
      { key: 'workforce',       label: 'Workforce',        icon: LayoutGrid    },
      { key: 'shift-schedule',  label: 'Shift & Schedule', icon: CalendarClock },
      { key: 'position-history', label: 'Position History', icon: History      },
      { key: 'prev-employment', label: 'Prev. Employment', icon: Building2     },
      { key: 'separation',      label: 'Separation',       icon: LogOut        },
      { key: 'organization',    label: 'Organization',     icon: Landmark      },
    ],
    compensation:  [
      { key: 'compensation', label: 'Compensation',  icon: DollarSign },
      { key: 'bank',         label: 'Bank & Statutory', icon: Landmark },
      { key: 'payroll-ctx',  label: 'Payroll Context', icon: Banknote  },
      { key: 'contracts',    label: 'Contracts',      icon: FileText   },
    ],
    documents:     [{ key: 'documents', label: 'Documents', icon: Files }, { key: 'passport-visa', label: 'Passport & Visa', icon: Globe }],
    relationships: [{ key: 'family', label: 'Family', icon: Users }, { key: 'nomination', label: 'Nomination', icon: Award }],
    assets:        [{ key: 'access-card', label: 'Access Card', icon: CreditCard }],
  }

  return (
    <div className="flex gap-6 items-start">

      {/* ── Left Card ── */}
      <div className="w-72 flex-shrink-0 sticky top-4">
        <Card className="overflow-hidden">
          <div className="h-32 bg-gradient-to-br from-primary/60 via-primary/30 to-accent/25 relative">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2">
              <div className="relative">
                <div className="h-20 w-20 rounded-full ring-4 ring-card bg-primary/20 flex items-center justify-center">
                  <span className="text-xl font-bold text-primary">{initials}</span>
                </div>
                {photoMutation.isPending && (
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-12 pb-5 px-5 flex flex-col items-center gap-3">
            <div className="text-center">
              <p className="font-display text-base font-semibold text-foreground">{emp.first_name} {emp.last_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {job?.designations?.name ?? job?.departments?.name ?? '—'}
              </p>
            </div>

            <Badge variant={STATUS_VARIANT[emp.status] ?? 'secondary'} className="rounded-full text-[10px] capitalize">
              {emp.status.replace('_', ' ')}
            </Badge>

            <div className="w-full space-y-2 pt-2 border-t border-border">
              {[
                { label: 'Employee Code',   value: emp.employee_code },
                { label: 'Employment Type', value: job?.employment_type ? job.employment_type.charAt(0).toUpperCase() + job.employment_type.slice(1) : '—' },
                { label: 'Joining Date',    value: fmtDate(emp.joining_date) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-foreground text-right max-w-[140px] truncate">{value}</span>
                </div>
              ))}
            </div>

            {/* ── Org Hierarchy Chain ── */}
            {(emp.sites || job?.work_locations || job?.departments || job?.cost_center) && (
              <div className="w-full pt-2 border-t border-border space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                  Org Placement
                </p>
                {[
                  emp.sites         ? { label: emp.sites.name,              icon: 'Globe',    isLast: !job?.work_locations && !job?.departments && !job?.cost_center } : null,
                  job?.work_locations ? { label: job.work_locations.name,   icon: 'MapPin',   isLast: !job?.departments && !job?.cost_center } : null,
                  job?.departments  ? { label: job.departments.name,        icon: 'Building2',isLast: !job?.cost_center } : null,
                  job?.cost_center  ? { label: `${job.cost_center.code}`,   icon: 'DollarSign',isLast: true } : null,
                ].filter(Boolean).map((item, idx) => item && (
                  <div key={idx} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="text-muted-foreground/30 w-3 text-[9px] shrink-0 font-mono">
                      {item.isLast ? '└' : '├'}
                    </span>
                    {item.icon === 'Globe'      && <Globe       className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                    {item.icon === 'MapPin'     && <MapPin      className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                    {item.icon === 'Building2'  && <Building2   className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                    {item.icon === 'DollarSign' && <DollarSign  className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                    <span className="truncate">{item.label}</span>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={photoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) photoMutation.mutate(f); e.target.value = '' }}
            />
            <Button
              variant="outline" size="sm" className="w-full gap-1.5 text-xs mt-1"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoMutation.isPending}
            >
              <Camera className="h-3.5 w-3.5" />Update Photo
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link to={`${basePath}/employees`} className="hover:text-foreground transition-colors">People</Link>
          <span>/</span>
          <span className="text-foreground font-medium">{emp.first_name} {emp.last_name}</span>
        </nav>

        {/* Section chips */}
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => changeSection(s.key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                section === s.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Sub-tab nav */}
        <div className="flex items-center gap-0 border-b border-border overflow-x-auto">
          {SUB_TABS[section].map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setSubTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                  subTab === tab.key
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />{tab.label}
              </button>
            )
          })}
        </div>

        {/* ── Tab content ── */}
        <div className="space-y-4">

          {/* CORE › Profile */}
          {subTab === 'profile' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Profile</CardTitle>
                  {!editProfile
                    ? <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                        onClick={() => { setProfileForm({ first_name: emp.first_name, last_name: emp.last_name, email: emp.email, phone: emp.phone ?? '', joining_date: emp.joining_date?.slice(0,10) ?? '', status: emp.status }); setEditProfile(true) }}>
                        <Edit2 className="h-3.5 w-3.5" />Edit
                      </Button>
                    : <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => profileMutation.mutate(profileForm)} disabled={profileMutation.isPending}><Check className="h-3.5 w-3.5 text-success" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditProfile(false)}><X className="h-3.5 w-3.5" /></Button>
                      </div>}
                </div>
              </CardHeader>
              <CardContent>
                <Grid2>
                  {([{ label: 'First Name', key: 'first_name' }, { label: 'Last Name', key: 'last_name' }, { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' }, { label: 'Joining Date', key: 'joining_date', type: 'date' }] as Array<{label:string;key:string;type?:string}>).map(f => (
                    <div key={f.key}>
                      <p className="text-xs text-muted-foreground mb-1">{f.label}</p>
                      {editProfile
                        ? <Input className="h-7 text-xs" type={f.type ?? 'text'} value={profileForm[f.key] ?? ''} onChange={e => setProfileForm((p: any) => ({ ...p, [f.key]: e.target.value }))} />
                        : <p className="text-sm font-medium">{fmt((emp as any)[f.key])}</p>}
                    </div>
                  ))}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Status</p>
                    {editProfile
                      ? <select className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={profileForm.status ?? ''} onChange={e => setProfileForm((p: any) => ({ ...p, status: e.target.value }))}>
                          {['active','inactive','on_notice','separated'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                        </select>
                      : <Badge variant={STATUS_VARIANT[emp.status] ?? 'secondary'} className="rounded-full text-[10px] capitalize">{emp.status.replace('_',' ')}</Badge>}
                  </div>
                </Grid2>
              </CardContent>
            </Card>
          )}

          {/* CORE › Personal Info */}
          {subTab === 'personal' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Personal Information</CardTitle>
                  {!editPI
                    ? <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                        onClick={() => { setPiForm({ gender: pi?.gender ?? '', dob: pi?.dob?.slice(0,10) ?? '', nationality: pi?.nationality ?? '', marital_status: pi?.marital_status ?? '', blood_group: pi?.blood_group ?? '' }); setEditPI(true) }}>
                        <Edit2 className="h-3.5 w-3.5" />Edit
                      </Button>
                    : <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => piMutation.mutate(piForm)} disabled={piMutation.isPending}><Check className="h-3.5 w-3.5 text-success" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditPI(false)}><X className="h-3.5 w-3.5" /></Button>
                      </div>}
                </div>
              </CardHeader>
              <CardContent>
                {!pi && !editPI
                  ? <EmptySection icon={BookOpen} title="No personal info on record" subtitle="Click Edit to add information" />
                  : (
                    <Grid2>
                      {([{ label: 'Gender', key: 'gender', opts: ['','Male','Female','Other','Prefer not to say'] }, { label: 'Date of Birth', key: 'dob', type: 'date' }, { label: 'Nationality', key: 'nationality' }, { label: 'Marital Status', key: 'marital_status', opts: ['','Single','Married','Divorced','Widowed'] }, { label: 'Blood Group', key: 'blood_group', opts: ['','A+','A-','B+','B-','AB+','AB-','O+','O-'] }] as Array<{label:string;key:string;type?:string;opts?:string[]}>).map(f => (
                        <div key={f.key}>
                          <p className="text-xs text-muted-foreground mb-1">{f.label}</p>
                          {editPI
                            ? f.opts
                              ? <select className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={piForm[f.key] ?? ''} onChange={e => setPiForm((p: any) => ({ ...p, [f.key]: e.target.value }))}>{f.opts.map(o => <option key={o} value={o}>{o || '—'}</option>)}</select>
                              : <Input className="h-7 text-xs" type={f.type ?? 'text'} value={piForm[f.key] ?? ''} onChange={e => setPiForm((p: any) => ({ ...p, [f.key]: e.target.value }))} />
                            : <p className="text-sm font-medium">{fmt((pi as any)?.[f.key])}</p>}
                        </div>
                      ))}
                    </Grid2>
                  )}
              </CardContent>
            </Card>
          )}

          {/* CORE › Job Info (read-only) */}
          {subTab === 'jobinfo' && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Current Job Information</CardTitle></CardHeader>
              <CardContent>
                {!job
                  ? <EmptySection icon={Briefcase} title="No job info" subtitle="Add a position in Position History." />
                  : <>
                      <Grid2>
                        <KV label="Department"      value={job.departments?.name} />
                        <KV label="Designation"     value={job.designations?.name} />
                        <KV label="Grade"           value={job.grades?.name} />
                        <KV label="Manager"         value={job.manager ? `${job.manager.first_name} ${job.manager.last_name}` : undefined} />
                        <KV label="Effective From"  value={fmtDate(job.effective_from)} />
                        <KV label="Employment Type" value={job.employment_type} />
                        <KV label="Work Location"   value={job.work_locations?.name} />
                        <KV label="Shift"           value={job.shifts?.name} />
                      </Grid2>

                      {/* ── Site + Roster ── */}
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Organisation Assignment</p>
                        <Grid2>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Site</p>
                            {emp?.sites
                              ? <>
                                  <p className="text-sm font-medium text-foreground">{emp.sites.name}</p>
                                  <p className="text-xs text-muted-foreground font-mono">{emp.sites.timezone}</p>
                                </>
                              : <p className="text-sm text-muted-foreground">Not assigned</p>
                            }
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Roster</p>
                            {emp?.rosters
                              ? <>
                                  <p className="text-sm font-medium text-foreground">{emp.rosters.name}</p>
                                  <p className="text-xs text-muted-foreground">{emp.rosters.cycle_days}-day cycle</p>
                                </>
                              : emp?.sites
                                ? <p className="text-sm text-muted-foreground italic">Inherited from site</p>
                                : <p className="text-sm text-muted-foreground">No roster</p>
                            }
                          </div>
                        </Grid2>
                      </div>

                      <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
                        To change job details, add a new record in Position History.
                      </p>
                    </>}
              </CardContent>
            </Card>
          )}

          {/* CORE › Job Info — Work Configuration (admin only) */}
          {subTab === 'jobinfo' && job && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlarmClock className="h-4 w-4 text-muted-foreground" />
                  Work Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Shift Override</p>
                  {job.shifts
                    ? <Badge variant="secondary" className="rounded-full text-xs border border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">{job.shifts.name}</Badge>
                    : <span className="text-xs text-muted-foreground italic">None — policy resolves</span>}
                </div>
                {isAdmin && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Today's Roster</p>
                    {rosterToday
                      ? <Badge variant="secondary" className="rounded-full text-xs">{rosterToday.shifts.name} (override)</Badge>
                      : <span className="text-xs text-muted-foreground">No override — rotation policy applies</span>}
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Work Location</p>
                  {job.work_locations
                    ? <span className="font-medium text-foreground">{job.work_locations.name}{job.work_locations.city && <span className="text-xs text-muted-foreground ml-1">· {job.work_locations.city}</span>}</span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Reporting Manager</p>
                  {job.manager
                    ? <span className="font-medium text-foreground">{job.manager.first_name} {job.manager.last_name}<span className="text-xs text-muted-foreground ml-1">#{job.manager.employee_code}</span></span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* CORE › Job Info — Monthly Attendance */}
          {subTab === 'jobinfo' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    Attendance — {attMonth}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                      const d = new Date(`${attMonth}-01`); d.setMonth(d.getMonth() - 1)
                      setAttMonth(d.toISOString().slice(0, 7))
                    }}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                      const d = new Date(`${attMonth}-01`); d.setMonth(d.getMonth() + 1)
                      setAttMonth(d.toISOString().slice(0, 7))
                    }}><ChevronRight className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {attLoading
                  ? <div className="flex items-center gap-1.5 py-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="text-xs">Loading…</span></div>
                  : attSummary
                    ? (
                      <div className="grid grid-cols-3 gap-3 text-center">
                        {[
                          { label: 'Total Days',   value: attSummary.total_days,   cls: 'text-foreground' },
                          { label: 'Payable Days', value: attSummary.payable_days ?? attSummary.present, cls: 'text-success' },
                          { label: 'LOP Days',     value: attSummary.lop_days     ?? attSummary.absent,  cls: 'text-destructive' },
                        ].map(({ label, value, cls }) => (
                          <div key={label} className="p-2 rounded-md bg-muted/40">
                            <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                            <p className={`text-lg font-bold ${cls}`}>{value}</p>
                          </div>
                        ))}
                      </div>
                    )
                    : <p className="text-xs text-muted-foreground">No data for this month.</p>}
              </CardContent>
            </Card>
          )}

          {/* ─────────────────────────────────────────────────────────────────
              CORE › Onboarding Status
          ──────────────────────────────────────────────────────────────────── */}
          {subTab === 'onboarding' && (
            <div className="space-y-4">
              {!onboardingStatus
                ? (
                  <Card>
                    <CardContent className="pt-6">
                      <EmptySection icon={GraduationCap} title="No onboarding session linked" subtitle="This employee was not onboarded via the AI onboarding workflow." />
                    </CardContent>
                  </Card>
                )
                : (
                  <>
                    {/* Session overview */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <GraduationCap className="h-4 w-4 text-muted-foreground" />
                          Onboarding Session
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Session Status</p>
                            <Badge
                              variant={
                                onboardingStatus.session?.status === 'employee_created' ? 'success' :
                                onboardingStatus.session?.status === 'rejected'         ? 'destructive' :
                                onboardingStatus.session?.status === 'hr_review'        ? 'warning' :
                                'secondary'
                              }
                              className="rounded-full text-[10px] capitalize"
                            >
                              {(onboardingStatus.session?.status ?? '—').replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Draft Status</p>
                            <Badge variant="outline" className="rounded-full text-[10px] capitalize">
                              {(onboardingStatus.draft.status ?? '—').replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">AI Confidence Score</p>
                            <p className="text-sm font-medium">
                              {onboardingStatus.draft.confidence_score != null
                                ? `${Math.round(onboardingStatus.draft.confidence_score * 100)}%`
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Session Initiated</p>
                            <p className="text-sm font-medium">{fmtDate(onboardingStatus.session?.created_at)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Document completeness */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-semibold">Document Extraction Summary</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-3 gap-3 text-center mb-4">
                          {[
                            { label: 'Uploaded',  value: onboardingStatus.documents.total,     cls: 'text-foreground'    },
                            { label: 'Extracted', value: onboardingStatus.documents.extracted, cls: 'text-success'       },
                            { label: 'Failed',    value: onboardingStatus.documents.failed,    cls: 'text-destructive'   },
                          ].map(({ label, value, cls }) => (
                            <div key={label} className="p-2 rounded-md bg-muted/40">
                              <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                              <p className={`text-lg font-bold ${cls}`}>{value}</p>
                            </div>
                          ))}
                        </div>
                        {onboardingStatus.documents.items.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border">
                                  {['Document Type', 'Extraction', 'Uploaded'].map(h => (
                                    <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {onboardingStatus.documents.items.map((doc: any) => (
                                  <tr key={doc.id} className="border-b border-border/50">
                                    <td className="px-3 py-2 capitalize font-medium">{(doc.document_type ?? '—').replace(/_/g, ' ')}</td>
                                    <td className="px-3 py-2">
                                      <Badge
                                        variant={
                                          doc.extraction_status === 'completed' ? 'success'     :
                                          doc.extraction_status === 'failed'    ? 'destructive' :
                                          doc.extraction_status === 'pending'   ? 'secondary'   : 'outline'
                                        }
                                        className="rounded-full text-[9px] capitalize"
                                      >
                                        {doc.extraction_status ?? 'pending'}
                                      </Badge>
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">{fmtDate(doc.uploaded_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────────
              CORE › User Account
          ──────────────────────────────────────────────────────────────────── */}
          {subTab === 'account' && isAdmin && (() => {
            const acct    = userAccountData
            const status  = acct?.status ?? null

            const STATUS_CONFIG = {
              no_account:           { label: 'No Account',           icon: ShieldAlert, cls: 'text-muted-foreground', bg: 'bg-muted/60',      badge: 'secondary'   },
              pending_verification: { label: 'Pending Verification', icon: Mail,        cls: 'text-warning',          bg: 'bg-warning/8',     badge: 'warning'     },
              active:               { label: 'Active',               icon: ShieldCheck, cls: 'text-success',          bg: 'bg-success/8',     badge: 'success'     },
              suspended:            { label: 'Suspended',            icon: ShieldOff,   cls: 'text-destructive',      bg: 'bg-destructive/8', badge: 'destructive' },
            } as const

            const cfg = status ? STATUS_CONFIG[status] : STATUS_CONFIG.no_account
            const StatusIcon = cfg.icon

            return (
              <div className="space-y-4">
                {/* Status card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                      Portal Access
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Status indicator */}
                    <div className={cn('flex items-center gap-3 rounded-lg p-3 mb-4', cfg.bg)}>
                      <div className="h-8 w-8 rounded-full bg-background/60 flex items-center justify-center flex-shrink-0">
                        <StatusIcon className={cn('h-4 w-4', cfg.cls)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-semibold', cfg.cls)}>{cfg.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {status === 'no_account'
                            ? 'This employee has no portal login. Create an account to grant ESS access.'
                            : status === 'pending_verification'
                            ? `Invite sent to ${acct?.auth_user?.email ?? '—'}. Employee must click the link to activate.`
                            : status === 'active'
                            ? `Active since ${fmtDate(acct?.auth_user?.email_confirmed_at)}. Last login: ${acct?.auth_user?.last_sign_in_at ? fmtDate(acct.auth_user.last_sign_in_at) : 'Never'}.`
                            : `Account suspended. Employee cannot log in.`}
                        </p>
                      </div>
                      {/* CTA buttons */}
                      <div className="flex-shrink-0 flex gap-2">
                        {status === 'no_account' && (
                          <Button size="sm" className="h-7 text-xs gap-1.5"
                            onClick={() => {
                              setAccountForm(f => ({ ...f, email: emp?.email ?? '' }))
                              setAccountDlgOpen(true)
                            }}
                          >
                            <Send className="h-3 w-3" />
                            Create Account
                          </Button>
                        )}
                        {(status === 'pending_verification' || status === 'active') && (
                          <Button size="sm" variant="outline"
                            className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                            onClick={() => patchAccountMutation.mutate('suspend')}
                            disabled={patchAccountMutation.isPending}
                          >
                            Suspend
                          </Button>
                        )}
                        {status === 'suspended' && (
                          <Button size="sm" variant="outline"
                            className="h-7 text-xs text-success border-success/40 hover:bg-success/10"
                            onClick={() => patchAccountMutation.mutate('reactivate')}
                            disabled={patchAccountMutation.isPending}
                          >
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Account details grid */}
                    {acct?.profile && acct.auth_user && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <KV label="Login Email"   value={acct.auth_user.email} />
                        <KV label="Portal Role"   value={acct.profile.role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} />
                        <KV label="Account Created" value={fmtDate(acct.profile.created_at)} />
                        <KV label="Email Confirmed" value={acct.auth_user.email_confirmed_at ? fmtDate(acct.auth_user.email_confirmed_at) : 'Not yet'} />
                        <KV label="Last Sign In"  value={acct.auth_user.last_sign_in_at ? fmtDate(acct.auth_user.last_sign_in_at) : 'Never'} />
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Account Status</p>
                          <Badge variant={cfg.badge as any} className="rounded-full text-[10px]">
                            {cfg.label}
                          </Badge>
                        </div>
                      </div>
                    )}

                    {status === 'no_account' && (
                      <div className="mt-2 text-center py-4 text-muted-foreground">
                        <KeyRound className="h-6 w-6 mx-auto mb-2 opacity-30" />
                        <p className="text-xs">No portal access has been configured for this employee.</p>
                        <p className="text-xs mt-0.5">Click "Create Account" to set up login credentials and ESS access.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Access scope info */}
                {status && status !== 'no_account' && acct?.profile && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold">Access Scope</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {acct.profile.role === 'employee' && (
                          <div className="flex items-start gap-2.5">
                            <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-medium">Employee Self-Service (ESS)</p>
                              <p className="text-xs text-muted-foreground">View payslips, apply leave, raise regularisations, manage personal info</p>
                            </div>
                          </div>
                        )}
                        {acct.profile.role === 'manager' && (
                          <>
                            <div className="flex items-start gap-2.5">
                              <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-sm font-medium">Employee Self-Service (ESS)</p>
                                <p className="text-xs text-muted-foreground">All standard ESS capabilities for own profile</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2.5">
                              <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-sm font-medium">Team Management</p>
                                <p className="text-xs text-muted-foreground">Approve/reject team leave & regularisation requests, view team attendance</p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )
          })()}

          {/* ─────────────────────────────────────────────────────────────────
              CORE › Important Dates
          ──────────────────────────────────────────────────────────────────── */}
          {subTab === 'important-dates' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Important Dates</CardTitle>
                  {isAdmin && (
                    <Button
                      size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                      onClick={() => {
                        setIdateForm({ date_type_id: '', event_date: '', year_known: true, notes: '' })
                        setIdateEditRow(null)
                        setIdateDlgOpen(true)
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />Add Date
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {importantDatesLoading ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…
                  </div>
                ) : importantDates.length === 0 ? (
                  <EmptySection
                    icon={CalendarClock}
                    title="No important dates recorded"
                    subtitle={isAdmin ? "Add birthday, anniversary, or custom dates to enable event-triggered leave." : "No dates on record."}
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {importantDates.map((row: ImportantDateRow) => {
                      const d        = new Date(`${row.event_date}T00:00:00`)
                      const display  = row.year_known
                        ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                        : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                      return (
                        <div key={row.id} className="flex items-center gap-3 py-2.5">
                          <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{row.important_date_types?.name ?? row.date_type_id}</p>
                            <p className="text-xs text-muted-foreground">{display}{!row.year_known && ' (year unknown)'}</p>
                            {row.notes && !row.notes.startsWith('Auto-seeded') && <p className="text-xs text-muted-foreground mt-0.5 italic">{row.notes}</p>}
                          </div>
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                                setIdateForm({
                                  date_type_id: row.date_type_id,
                                  event_date:   row.event_date.slice(0, 10),
                                  year_known:   row.year_known,
                                  notes:        (row.notes?.startsWith('Auto-seeded') ? '' : row.notes) ?? '',
                                })
                                setIdateEditRow(row)
                                setIdateDlgOpen(true)
                              }}>
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => {
                                if (confirm(`Remove ${row.important_date_types?.name ?? 'this date'}?`)) {
                                  deleteImportantDateMut.mutate(row.id)
                                }
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Important Date upsert dialog */}
          <Dialog open={idateDlgOpen} onOpenChange={setIdateDlgOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{idateEditRow ? 'Edit Important Date' : 'Add Important Date'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">Date Type</Label>
                  <Select
                    value={idateForm.date_type_id}
                    onValueChange={v => setIdateForm(p => ({ ...p, date_type_id: v }))}
                    disabled={!!idateEditRow}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availDateTypes.map((dt: ImportantDateType) => (
                        <SelectItem key={dt.id} value={dt.id} className="text-xs">{dt.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={idateForm.event_date}
                    onChange={e => setIdateForm(p => ({ ...p, event_date: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="year-known"
                    checked={idateForm.year_known}
                    onCheckedChange={v => setIdateForm(p => ({ ...p, year_known: v }))}
                  />
                  <Label htmlFor="year-known" className="text-xs cursor-pointer">Year is known</Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. As per government ID"
                    value={idateForm.notes}
                    onChange={e => setIdateForm(p => ({ ...p, notes: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setIdateDlgOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={!idateForm.date_type_id || !idateForm.event_date || upsertImportantDateMut.isPending}
                  onClick={() => upsertImportantDateMut.mutate(idateForm)}
                >
                  {upsertImportantDateMut.isPending && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* ─────────────────────────────────────────────────────────────────
              EMPLOYMENT › Workforce Assignment
          ──────────────────────────────────────────────────────────────────── */}
          {subTab === 'workforce' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                    Workforce Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!job
                    ? <EmptySection icon={LayoutGrid} title="No job assignment" subtitle="Add a position record to set the workforce assignment." />
                    : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <AssignableField
                          label="Department"
                          value={job.departments?.name}
                          futureValue={futureJobRecord?.departments?.name}
                          futureDate={futureJobRecord?.effective_from}
                          onAssign={() => openAssign('department')}
                          canAssign={isAdmin}
                        />
                        <AssignableField
                          label="Designation"
                          value={job.designations?.name}
                          futureValue={futureJobRecord?.designations?.name}
                          futureDate={futureJobRecord?.effective_from}
                          onAssign={() => openAssign('designation')}
                          canAssign={isAdmin}
                        />
                        <AssignableField
                          label="Grade / Band"
                          value={job.grades ? `${job.grades.name} (${job.grades.code})` : null}
                          futureValue={futureJobRecord?.grades ? `${futureJobRecord.grades.name} (${futureJobRecord.grades.code})` : null}
                          futureDate={futureJobRecord?.effective_from}
                          onAssign={() => openAssign('grade')}
                          canAssign={isAdmin}
                        />
                        <AssignableField
                          label="Employment Type"
                          value={job.employment_type ? job.employment_type.charAt(0).toUpperCase() + job.employment_type.slice(1) : null}
                          futureValue={futureJobRecord?.employment_type}
                          futureDate={futureJobRecord?.effective_from}
                          onAssign={() => openAssign('employment_type')}
                          canAssign={isAdmin}
                        />
                        <AssignableField
                          label="Reporting Manager"
                          value={job.manager ? `${job.manager.first_name} ${job.manager.last_name} #${job.manager.employee_code}` : null}
                          futureValue={futureJobRecord?.manager ? `${futureJobRecord.manager.first_name} ${futureJobRecord.manager.last_name}` : null}
                          futureDate={futureJobRecord?.effective_from}
                          onAssign={() => openAssign('manager')}
                          canAssign={isAdmin}
                        />
                        <AssignableField
                          label="Work Location"
                          value={job.work_locations ? `${job.work_locations.name}${job.work_locations.city ? ` · ${job.work_locations.city}` : ''}` : null}
                          onAssign={() => openAssign('work_location')}
                          canAssign={isAdmin}
                        />
                        <AssignableField
                          label="Cost Center"
                          value={job.cost_center ? `${job.cost_center.name} (${job.cost_center.code})` : null}
                          onAssign={() => openAssign('cost_center')}
                          canAssign={isAdmin}
                        />
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Assigned Since</p>
                          <p className="text-sm font-medium">{fmtDate(job.effective_from)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Payroll Group</p>
                          <p className="text-sm text-muted-foreground italic text-[11px]">Not configured in schema</p>
                        </div>
                      </div>
                    )}
                </CardContent>
              </Card>

              {/* Org context panel — Site & Roster */}
              {job && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        Site &amp; Roster Assignment
                      </CardTitle>
                      {isAdmin && (
                        <button
                          onClick={() => {
                            setOrgForm({
                              site_id:        orgCtx?.site?.id   ?? '',
                              roster_id:      orgCtx?.roster?.id ?? '',
                              effective_from: new Date().toISOString().slice(0, 10),
                              reason:         '',
                            })
                            setOrgDlgOpen(true)
                          }}
                          className="text-[10px] text-muted-foreground hover:text-foreground border border-border hover:border-primary/50 rounded px-1.5 py-0.5 transition-colors"
                        >
                          Reassign
                        </button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Grid2>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Site</p>
                        {orgCtx?.site
                          ? <><p className="text-sm font-medium">{orgCtx.site.name}</p><p className="text-xs text-muted-foreground font-mono">{orgCtx.site.timezone}</p></>
                          : <p className="text-sm text-muted-foreground">Not assigned</p>}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Roster</p>
                        {orgCtx?.roster
                          ? <><p className="text-sm font-medium">{orgCtx.roster.name}</p><p className="text-xs text-muted-foreground">{orgCtx.roster.cycle_days}-day cycle{orgCtx.roster_source === 'site' ? ' · inherited from site' : ''}</p></>
                          : <p className="text-sm text-muted-foreground">No roster</p>}
                      </div>
                    </Grid2>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────────
              EMPLOYMENT › Shift & Schedule
          ──────────────────────────────────────────────────────────────────── */}
          {subTab === 'shift-schedule' && (
            <div className="space-y-4">
              {/* Current shift summary */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      Shift &amp; Schedule
                    </CardTitle>
                    {isAdmin && (
                      <button
                        onClick={() => openAssign('shift')}
                        className="text-[10px] text-muted-foreground hover:text-foreground border border-border hover:border-primary/50 rounded px-1.5 py-0.5 transition-colors"
                      >
                        Apply Override
                      </button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <Grid2>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Shift Override</p>
                      {job?.shifts
                        ? <>
                            <p className="text-sm font-medium">{job.shifts.name}</p>
                            {(job.shifts.start_time || job.shifts.end_time) && (
                              <p className="text-xs text-muted-foreground">{job.shifts.start_time} – {job.shifts.end_time}</p>
                            )}
                          </>
                        : <p className="text-sm text-muted-foreground italic">No override — rotation policy resolves shift</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Today's Roster</p>
                      {rosterToday
                        ? <><p className="text-sm font-medium">{rosterToday.shifts.name}</p><p className="text-xs text-muted-foreground">{rosterToday.shifts.start_time} – {rosterToday.shifts.end_time}</p></>
                        : <p className="text-sm text-muted-foreground italic">No date override — policy applies</p>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Weekly Off</p>
                      <p className="text-sm text-muted-foreground italic">Via roster policy</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Attendance Policy</p>
                      <p className="text-sm text-muted-foreground italic">Site-level default</p>
                    </div>
                  </Grid2>
                </CardContent>
              </Card>

              {/* Shift assignment history */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Shift Assignment History
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {!(shiftHistoryData?.data?.length)
                    ? <div className="px-6 pb-6"><EmptySection icon={AlarmClock} title="No shift history" subtitle="No shift assignments recorded for this employee." /></div>
                    : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              {['Shift', 'Code', 'Hours', 'Effective From', 'Status'].map(h => (
                                <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {shiftHistoryData!.data.map((row: any) => (
                              <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                                <td className="px-4 py-2 font-medium">{row.shifts?.name ?? '—'}</td>
                                <td className="px-4 py-2 font-mono text-muted-foreground">{row.shifts?.code ?? '—'}</td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  {row.shifts?.start_time && row.shifts?.end_time
                                    ? `${row.shifts.start_time}–${row.shifts.end_time}`
                                    : '—'}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap">{fmtDate(row.effective_from)}</td>
                                <td className="px-4 py-2">
                                  {row.is_current
                                    ? <Badge variant="success" className="rounded-full text-[9px]">Current</Badge>
                                    : <Badge variant="secondary" className="rounded-full text-[9px]">Past</Badge>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* EMPLOYMENT › Position History */}
          {subTab === 'position-history' && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Position History</CardTitle>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setJobForm({ employment_type: 'permanent', effective_from: new Date().toISOString().slice(0,10), is_current: true }); setAddJobOpen(true) }}>
                    <Plus className="h-3.5 w-3.5" />Add Record
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!(jobHistoryData?.data?.length)
                  ? <div className="px-6 pb-6"><EmptySection icon={History} title="No position history" /></div>
                  : <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border">{['Dept','Designation','Manager','Eff. From','Eff. To'].map(h=><th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                        <tbody>
                          {jobHistoryData!.data.map((row: any) => (
                            <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="px-4 py-2">{row.departments?.name ?? '—'}</td>
                              <td className="px-4 py-2">{row.designations?.name ?? '—'}</td>
                              <td className="px-4 py-2">{row.manager ? `${row.manager.first_name} ${row.manager.last_name}` : '—'}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{fmtDate(row.effective_from)}</td>
                              <td className="px-4 py-2 whitespace-nowrap">{row.is_current ? <Badge variant="success" className="rounded-full text-[9px]">Current</Badge> : fmtDate(row.effective_to)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>}
              </CardContent>
            </Card>
          )}

          {/* EMPLOYMENT › Previous Employment */}
          {subTab === 'prev-employment' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setPrevForm({}); setAddPrevOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Employment</Button>
              </div>
              {!(prevEmpData?.data?.length)
                ? <Card><CardContent className="pt-6"><EmptySection icon={Building2} title="No previous employment records" /></CardContent></Card>
                : prevEmpData!.data.map((pe: any) => (
                  <Card key={pe.id}>
                    <CardContent className="pt-4 pb-4 flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{pe.company_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{pe.designation}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(pe.from_date)} – {pe.to_date ? fmtDate(pe.to_date) : 'Present'}</p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delPrevMutation.mutate(pe.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {/* EMPLOYMENT › Separation */}
          {subTab === 'separation' && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Separation</CardTitle></CardHeader>
              <CardContent>
                {!separationData?.data
                  ? <EmptySection icon={LogOut} title="No separation record" subtitle="Employee is currently active." />
                  : <Grid2>
                      <KV label="Type"            value={separationData.data.separation_type} />
                      <KV label="Initiated By"    value={separationData.data.initiated_by} />
                      <KV label="Notice Date"     value={fmtDate(separationData.data.notice_date)} />
                      <KV label="Last Working Day" value={fmtDate(separationData.data.last_working_date)} />
                      <KV label="Exit Reason"     value={separationData.data.exit_reason} />
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant={separationData.data.exit_interview_done ? 'success' : 'secondary'} className="rounded-full text-[10px]">{separationData.data.exit_interview_done ? '✓' : '✗'} Exit Interview</Badge>
                        <Badge variant={separationData.data.clearance_done ? 'success' : 'secondary'} className="rounded-full text-[10px]">{separationData.data.clearance_done ? '✓' : '✗'} Clearance</Badge>
                      </div>
                    </Grid2>}
              </CardContent>
            </Card>
          )}

          {/* EMPLOYMENT › Organization */}
          {subTab === 'organization' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-muted-foreground" />
                      Organisation Assignment
                    </CardTitle>
                    {isAdmin && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                        setOrgForm({
                          site_id:        orgCtx?.site?.id        ?? '',
                          roster_id:      orgCtx?.roster?.id      ?? '',
                          effective_from: new Date().toISOString().slice(0, 10),
                          reason:         '',
                        })
                        setOrgDlgOpen(true)
                      }}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Site</p>
                    {orgCtx?.site
                      ? <div><p className="font-medium">{orgCtx.site.name}</p><p className="text-xs text-muted-foreground font-mono">{orgCtx.site.timezone}</p></div>
                      : <span className="text-xs text-muted-foreground">Not assigned</span>}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Roster</p>
                    {orgCtx?.roster
                      ? <div>
                          <p className="font-medium">{orgCtx.roster.name}</p>
                          {orgCtx.roster_source === 'site' && (
                            <p className="text-xs text-muted-foreground">Inherited from site</p>
                          )}
                        </div>
                      : <span className="text-xs text-muted-foreground">No roster</span>}
                  </div>
                  {orgCtx?.effective_from && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Effective From</p>
                      <p className="text-xs font-medium">{orgCtx.effective_from}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Source</p>
                    <Badge variant={orgCtx?.source === 'history' ? 'outline' : 'secondary'} className="rounded-full text-[10px]">
                      {orgCtx?.source === 'history' ? 'History record' : 'Current fields'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Upcoming Holidays */}
              {(orgCtx?.upcoming_holidays?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">Upcoming Holidays</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {orgCtx!.upcoming_holidays.map((h) => (
                      <div key={h.date} className="flex items-center justify-between text-sm py-1 border-b border-border/40 last:border-0">
                        <div>
                          <p className="font-medium text-xs">{h.name}</p>
                          <p className="text-[10px] text-muted-foreground">{h.date}</p>
                        </div>
                        {h.is_optional && <Badge variant="outline" className="rounded-full text-[10px]">Optional</Badge>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Edit Dialog */}
              <Dialog open={orgDlgOpen} onOpenChange={setOrgDlgOpen}>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Update Organisation Assignment</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Site</label>
                      <select value={orgForm.site_id} onChange={(e) => setOrgForm((p) => ({ ...p, site_id: e.target.value }))}
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50">
                        <option value="">— None —</option>
                        {sitesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Roster</label>
                      <select value={orgForm.roster_id} onChange={(e) => setOrgForm((p) => ({ ...p, roster_id: e.target.value }))}
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50">
                        <option value="">— None —</option>
                        {rostersList.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Effective From *</label>
                      <Input type="date" value={orgForm.effective_from} onChange={(e) => setOrgForm((p) => ({ ...p, effective_from: e.target.value }))} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Reason</label>
                      <Input value={orgForm.reason} onChange={(e) => setOrgForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Transfer, restructure…" className="h-8 text-xs" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => setOrgDlgOpen(false)}>Cancel</Button>
                    <Button size="sm" disabled={orgMutation.isPending || !orgForm.effective_from}
                      onClick={() => orgMutation.mutate(orgForm)}>
                      {orgMutation.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* COMPENSATION › Compensation */}
          {subTab === 'compensation' && (
            <div className="space-y-4">
            {/* Pending revision banner — admin only */}
            {isAdmin && pendingRevisions.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                  <span className="text-sm font-medium text-warning">
                    {pendingRevisions.length} revision{pendingRevisions.length > 1 ? 's' : ''} pending approval
                  </span>
                </div>
                {pendingRevisions.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between text-xs mt-1 pl-6">
                    <span className="text-muted-foreground">
                      <span className="capitalize font-medium text-foreground">{r.revision_type}</span>
                      {r.new_ctc_annual ? ` — ${fmtMoney(r.new_ctc_annual)} p.a.` : ''}
                      {r.effective_date ? ` eff. ${fmtDate(r.effective_date)}` : ''}
                    </span>
                    <div className="flex gap-1 ml-2">
                      <Button size="sm" variant="outline" className="h-6 text-[10px] text-success border-success/40"
                        disabled={approveRevisionMutation.isPending}
                        onClick={() => approveRevisionMutation.mutate(r.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] text-destructive border-destructive/40"
                        onClick={() => { setRejectTarget(r.id); setRejectReason('') }}>
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Compensation</CardTitle>
                  {isAdmin && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        onClick={() => {
                          setSetupCompForm(f => ({
                            ...f,
                            ctc_annual:     comp?.ctc_annual ? String(comp.ctc_annual) : '',
                            effective_from: today,
                            components:     comp?.components?.length
                              ? comp.components.map(c => ({
                                  salary_component_id: c.id,
                                  calculation_type:    c.calculation_type ?? 'fixed',
                                  value:               String(c.value),
                                }))
                              : [{ salary_component_id: '', calculation_type: 'fixed', value: '' }],
                          }))
                          setSetupCompOpen(true)
                        }}>
                        <Edit2 className="h-3.5 w-3.5" />{comp ? 'Edit Compensation' : 'Set Up'}
                      </Button>
                      {comp && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                          onClick={() => setRevisionOpen(true)}>
                          <TrendingUp className="h-3.5 w-3.5" />Initiate Revision
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!comp
                  ? <EmptySection icon={DollarSign} title="No salary components configured" />
                  : <>
                      {/* Header: structure + CTC */}
                      <div className="flex flex-wrap items-center gap-3 mb-4">
                        <Badge variant="outline" className="rounded-full text-xs">
                          {comp.structure?.name ?? 'Custom Structure'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Annual CTC: <span className="font-semibold text-foreground">{fmtMoney(comp.ctc_annual)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Monthly CTC: <span className="font-semibold text-foreground">{fmtMoney(comp.ctc_monthly)}</span>
                        </span>
                      </div>

                      {/* Component table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              {['Component', 'Type', 'Calc Type', 'Monthly', 'Annual'].map(h => (
                                <th key={h} className="text-left text-muted-foreground font-semibold px-3 py-2">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(comp.components ?? [])
                              .slice()
                              .sort((a, b) => a.sequence - b.sequence)
                              .map((c) => {
                                const typeVariant =
                                  c.component_type === 'earning'              ? 'success'     :
                                  c.component_type === 'deduction'            ? 'destructive' :
                                  c.component_type === 'employer_contribution' ? 'secondary'   : 'outline'
                                const typeLabel =
                                  c.component_type === 'earning'              ? 'Earning'      :
                                  c.component_type === 'deduction'            ? 'Deduction'    :
                                  c.component_type === 'employer_contribution' ? 'Employer Con.' : c.component_type ?? '—'
                                const calcLabel = (c.calculation_type ?? '').replace(/_/g, ' ')
                                return (
                                  <tr key={c.id} className="border-b border-border/50">
                                    <td className="px-3 py-2 font-medium">
                                      {c.name ?? '—'}
                                      {c.is_basic && (
                                        <Badge variant="outline" className="ml-1.5 rounded-full text-[9px] py-0">Basic</Badge>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      <Badge variant={typeVariant} className="rounded-full text-[10px]">{typeLabel}</Badge>
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground capitalize">{calcLabel}</td>
                                    <td className="px-3 py-2 tabular-nums">{fmtMoney(c.monthly_amount)}</td>
                                    <td className="px-3 py-2 tabular-nums">{fmtMoney(c.annual_amount)}</td>
                                  </tr>
                                )
                              })
                            }
                          </tbody>
                          {/* Totals footer */}
                          {comp.totals && (
                            <tfoot>
                              <tr className="border-t-2 border-border bg-muted/30">
                                <td className="px-3 py-2 font-semibold text-foreground" colSpan={3}>Gross Earnings</td>
                                <td className="px-3 py-2 font-semibold tabular-nums">{fmtMoney(comp.totals.gross_monthly)}</td>
                                <td className="px-3 py-2 font-semibold tabular-nums">{fmtMoney(comp.totals.gross_annual)}</td>
                              </tr>
                              {comp.totals.deductions_annual > 0 && (
                                <tr className="border-t border-border/60">
                                  <td className="px-3 py-2 text-destructive font-medium" colSpan={3}>Total Deductions</td>
                                  <td className="px-3 py-2 text-destructive tabular-nums">{fmtMoney(comp.totals.deductions_monthly)}</td>
                                  <td className="px-3 py-2 text-destructive tabular-nums">{fmtMoney(comp.totals.deductions_annual)}</td>
                                </tr>
                              )}
                              <tr className="border-t-2 border-border bg-success/5">
                                <td className="px-3 py-2 font-bold text-success" colSpan={3}>Net Take-Home</td>
                                <td className="px-3 py-2 font-bold text-success tabular-nums">{fmtMoney(comp.totals.net_monthly)}</td>
                                <td className="px-3 py-2 font-bold text-success tabular-nums">{fmtMoney(comp.totals.net_annual)}</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>

                      {/* Summary chips */}
                      {comp.totals && (
                        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-border text-xs">
                          <span className="text-muted-foreground">
                            Basic: <span className="font-semibold text-foreground">{fmtMoney(comp.totals.basic_monthly)}/mo</span>
                          </span>
                          {comp.totals.employer_contributions_annual > 0 && (
                            <span className="text-muted-foreground">
                              Employer Contributions: <span className="font-semibold text-foreground">{fmtMoney(comp.totals.employer_contributions_monthly)}/mo</span>
                            </span>
                          )}
                        </div>
                      )}
                    </>}
              </CardContent>
            </Card>

            {/* Compensation History Timeline */}
            {(compensationHistoryData?.data?.length ?? 0) > 1 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Compensation History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        {['Effective From', 'To', 'Annual CTC', 'Monthly CTC', 'Status'].map(h => (
                          <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compensationHistoryData!.data.map((h: any) => (
                        <tr key={h.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2 whitespace-nowrap">{fmtDate(h.effective_from)}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{h.effective_to ? fmtDate(h.effective_to) : '—'}</td>
                          <td className="px-4 py-2 tabular-nums font-medium">{fmtMoney(h.ctc_annual)}</td>
                          <td className="px-4 py-2 tabular-nums">{fmtMoney(h.ctc_monthly)}</td>
                          <td className="px-4 py-2">
                            {h.is_active
                              ? <Badge variant="success" className="rounded-full text-[9px]">Active</Badge>
                              : <Badge variant="secondary" className="rounded-full text-[9px]">Closed</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            )}
          </div>
          )}

          {/* Initiate Revision Dialog */}
          <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Initiate Compensation Revision</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Revision Type *</label>
                  <select
                    value={revisionForm.revision_type}
                    onChange={e => setRevisionForm(p => ({ ...p, revision_type: e.target.value }))}
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50"
                  >
                    {['increment','promotion','revision','correction','restructure','retro'].map(t => (
                      <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">New Annual CTC *</label>
                  <Input
                    type="number"
                    placeholder="e.g. 1200000"
                    value={revisionForm.new_ctc_annual}
                    onChange={e => setRevisionForm(p => ({ ...p, new_ctc_annual: e.target.value }))}
                    className="h-8 text-xs"
                  />
                  {comp?.ctc_annual && revisionForm.new_ctc_annual && (
                    <p className="text-[10px] text-muted-foreground">
                      {fmtMoney(comp.ctc_annual)} → {fmtMoney(Number(revisionForm.new_ctc_annual))}
                      {' '}
                      <span className={Number(revisionForm.new_ctc_annual) >= comp.ctc_annual ? 'text-success' : 'text-destructive'}>
                        ({Number(revisionForm.new_ctc_annual) >= comp.ctc_annual ? '+' : ''}
                        {(((Number(revisionForm.new_ctc_annual) - comp.ctc_annual) / comp.ctc_annual) * 100).toFixed(1)}%)
                      </span>
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Effective Date *</label>
                  <Input
                    type="date"
                    value={revisionForm.effective_date}
                    onChange={e => setRevisionForm(p => ({ ...p, effective_date: e.target.value }))}
                    className="h-8 text-xs"
                  />
                  {revisionForm.effective_date > today && (
                    <p className="text-[10px] text-warning">Future-dated revision — will apply to payroll on this date</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Reason *</label>
                  <Input
                    placeholder="Annual increment, promotion…"
                    value={revisionForm.reason}
                    onChange={e => setRevisionForm(p => ({ ...p, reason: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setRevisionOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={
                    initiateRevisionMutation.isPending ||
                    !revisionForm.new_ctc_annual ||
                    !revisionForm.reason ||
                    !revisionForm.effective_date
                  }
                  onClick={() => initiateRevisionMutation.mutate()}
                >
                  {initiateRevisionMutation.isPending ? 'Submitting…' : 'Submit for Approval'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Setup / Edit Compensation Dialog */}
          <Dialog open={setupCompOpen} onOpenChange={setSetupCompOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{comp ? 'Edit Compensation' : 'Set Up Compensation'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
                {/* Salary Structure */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Salary Structure (optional)</label>
                    {setupCompForm.salary_structure_id && (structureComponentsData?.data?.length ?? 0) > 0 && (
                      <Button
                        type="button" size="sm" variant="outline" className="h-5 text-[10px] px-2"
                        onClick={() => {
                          const scs = structureComponentsData?.data ?? []
                          if (scs.length > 0) {
                            setSetupCompForm(f => ({
                              ...f,
                              components: scs.map(c => ({
                                salary_component_id: c.salary_component_id,
                                calculation_type:    c.calculation_type ?? 'fixed',
                                value:               String(c.default_value ?? ''),
                              })),
                            }))
                          }
                        }}
                      >
                        Load from structure
                      </Button>
                    )}
                  </div>
                  <select
                    value={setupCompForm.salary_structure_id}
                    onChange={e => setSetupCompForm(p => ({ ...p, salary_structure_id: e.target.value }))}
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 ring-primary/50"
                  >
                    <option value="">— None / Custom —</option>
                    {(salaryStructuresData?.data ?? []).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                {/* Annual CTC */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Annual CTC *</label>
                  <Input
                    type="number"
                    placeholder="e.g. 1200000"
                    value={setupCompForm.ctc_annual}
                    onChange={e => setSetupCompForm(p => ({ ...p, ctc_annual: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                {/* Effective From */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Effective From *</label>
                  <Input
                    type="date"
                    value={setupCompForm.effective_from}
                    onChange={e => setSetupCompForm(p => ({ ...p, effective_from: e.target.value }))}
                    className="h-8 text-xs"
                  />
                  {setupCompForm.effective_from > today && (
                    <p className="text-[10px] text-warning">Future-dated — payroll will use this from the effective date onwards</p>
                  )}
                </div>
                {/* Components */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Salary Components *</label>
                    <Button
                      type="button" size="sm" variant="ghost" className="h-6 text-[10px] gap-0.5 px-2"
                      onClick={() => setSetupCompForm(p => ({
                        ...p,
                        components: [...p.components, { salary_component_id: '', calculation_type: 'fixed', value: '' }],
                      }))}
                    >
                      <Plus className="h-3 w-3" /> Add Row
                    </Button>
                  </div>
                  {setupCompForm.components.map((row, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-muted/30 rounded-md p-1.5">
                      <select
                        value={row.salary_component_id}
                        onChange={e => setSetupCompForm(p => {
                          const cs = [...p.components]; cs[i] = { ...cs[i], salary_component_id: e.target.value }; return { ...p, components: cs }
                        })}
                        className="flex-1 h-7 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 ring-primary/50 min-w-0"
                      >
                        <option value="">Select component</option>
                        {(salaryComponentsData?.data ?? []).map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.component_type?.replace('_', ' ')})</option>
                        ))}
                      </select>
                      <select
                        value={row.calculation_type}
                        onChange={e => setSetupCompForm(p => {
                          const cs = [...p.components]; cs[i] = { ...cs[i], calculation_type: e.target.value }; return { ...p, components: cs }
                        })}
                        className="w-28 h-7 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 ring-primary/50 flex-shrink-0"
                      >
                        <option value="fixed">Fixed ₹/yr</option>
                        <option value="pct_of_ctc">% of CTC</option>
                        <option value="pct_of_basic">% of Basic</option>
                      </select>
                      <Input
                        type="number"
                        placeholder={row.calculation_type === 'fixed' ? '₹/yr' : '%'}
                        value={row.value}
                        onChange={e => setSetupCompForm(p => {
                          const cs = [...p.components]; cs[i] = { ...cs[i], value: e.target.value }; return { ...p, components: cs }
                        })}
                        className="w-20 h-7 text-xs flex-shrink-0"
                      />
                      {setupCompForm.components.length > 1 && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive flex-shrink-0 p-0.5"
                          onClick={() => setSetupCompForm(p => ({ ...p, components: p.components.filter((_, j) => j !== i) }))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground pl-1">
                    Fixed amounts in ₹/year. Percentages as 0–100 (e.g. Basic 40% of CTC → enter 40).
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setSetupCompOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  disabled={
                    setupCompMutation.isPending ||
                    !setupCompForm.ctc_annual ||
                    !setupCompForm.effective_from ||
                    !setupCompForm.components.some(c => c.salary_component_id && c.value)
                  }
                  onClick={() => setupCompMutation.mutate()}
                >
                  {setupCompMutation.isPending ? 'Saving…' : comp ? 'Update Compensation' : 'Set Up Compensation'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* COMPENSATION › Bank & Statutory */}
          {subTab === 'bank' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Bank Details</CardTitle></CardHeader>
                <CardContent>
                  {!bs ? <EmptySection icon={Landmark} title="No bank info available" /> : (
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
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Statutory</CardTitle></CardHeader>
                <CardContent>
                  {!bs ? <EmptySection icon={Landmark} title="No statutory info available" /> : (
                    <Grid2>
                      <KV label="PAN"       value={bs.pan} />
                      <KV label="Aadhaar"   value={bs.aadhaar_masked} />
                      <KV label="UAN"       value={bs.uan} />
                      <KV label="PF Number" value={bs.pf_number} />
                      <KV label="ESI"       value={bs.esi_number} />
                      <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <Badge variant={bs.pt_applicable  ? 'success' : 'secondary'} className="rounded-full text-[10px]">PT {bs.pt_applicable  ? 'Applicable' : 'N/A'}</Badge>
                        <Badge variant={bs.lwf_applicable ? 'success' : 'secondary'} className="rounded-full text-[10px]">LWF {bs.lwf_applicable ? 'Applicable' : 'N/A'}</Badge>
                        {bs.tax_regime && <Badge variant="outline" className="rounded-full text-[10px] capitalize">{bs.tax_regime} Regime</Badge>}
                      </div>
                    </Grid2>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* COMPENSATION › Contracts */}
          {subTab === 'contracts' && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Contracts</CardTitle></CardHeader>
              <CardContent className="p-0">
                {!(contractsData?.data?.length)
                  ? <div className="px-6 pb-6"><EmptySection icon={FileText} title="No contracts" /></div>
                  : <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border">{['Type','Start','End','File'].map(h=><th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2">{h}</th>)}</tr></thead>
                        <tbody>
                          {contractsData!.data.map((c: any) => (
                            <tr key={c.id} className="border-b border-border/50">
                              <td className="px-4 py-2 capitalize">{c.contract_type}</td>
                              <td className="px-4 py-2">{fmtDate(c.start_date)}</td>
                              <td className="px-4 py-2">{c.end_date ? fmtDate(c.end_date) : '—'}</td>
                              <td className="px-4 py-2">
                                {c.storage_path
                                  ? <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => openSignedUrl(c.storage_path)}>View PDF</Button>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>}
              </CardContent>
            </Card>
          )}

          {/* ─────────────────────────────────────────────────────────────────
              COMPENSATION › Payroll Context
          ──────────────────────────────────────────────────────────────────── */}
          {subTab === 'payroll-ctx' && (
            <div className="space-y-4">

              {/* ── Pending revision banner ── */}
              {isAdmin && pendingRevisions.length > 0 && (
                <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
                    <span className="text-sm font-semibold text-warning">
                      {pendingRevisions.length} pending revision{pendingRevisions.length > 1 ? 's' : ''} awaiting approval
                    </span>
                  </div>
                  {pendingRevisions.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 bg-background/60 rounded-lg px-3 py-2 text-xs">
                      <div className="flex-1 min-w-0">
                        <span className="capitalize font-medium">{(r.revision_type ?? '—').replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground mx-1.5">→</span>
                        <span className="font-semibold tabular-nums">{fmtMoney(r.new_ctc_annual)}</span>
                        <span className="text-muted-foreground ml-1.5">eff. {fmtDate(r.effective_date)}</span>
                        {r.reason && <span className="text-muted-foreground ml-1.5 truncate">· {r.reason}</span>}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-success border-success/30 hover:bg-success/10"
                          disabled={approveRevisionMutation.isPending}
                          onClick={() => approveRevisionMutation.mutate(r.id)}
                        >
                          {approveRevisionMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => { setRejectTarget(r.id); setRejectReason('') }}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* CTC snapshot */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-muted-foreground" />
                      Compensation Snapshot
                    </CardTitle>
                    {isAdmin && comp && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                        onClick={() => setRevisionOpen(true)}
                      >
                        <TrendingUp className="h-3 w-3" />
                        Initiate Revision
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!comp
                    ? <EmptySection icon={Banknote} title="No compensation on record" />
                    : (
                      <Grid2>
                        <KV label="Annual CTC"    value={fmtMoney(comp.ctc_annual)} />
                        <KV label="Monthly CTC"   value={fmtMoney(comp.ctc_monthly)} />
                        <KV label="Net Take-Home" value={comp.totals ? fmtMoney(comp.totals.net_monthly) + '/mo' : undefined} />
                        <KV label="Salary Structure" value={comp.structure?.name} />
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Bank Verified</p>
                          {bs?.account_number_masked
                            ? <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                <span className="text-sm font-medium text-success">Bank on record</span>
                              </div>
                            : <div className="flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                                <span className="text-sm text-warning">No bank details</span>
                              </div>}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">PAN Status</p>
                          {bs?.pan
                            ? <div className="flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                <span className="text-sm font-medium">{bs.pan}</span>
                              </div>
                            : <div className="flex items-center gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                                <span className="text-sm text-warning">PAN not on file</span>
                              </div>}
                        </div>
                      </Grid2>
                    )}
                </CardContent>
              </Card>

              {/* Salary revision history — admin only */}
              {isAdmin && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      Salary Revision History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {!(payrollRevisionsData?.data?.length)
                      ? <div className="px-6 pb-6"><EmptySection icon={TrendingUp} title="No revisions recorded" subtitle="Compensation revisions will appear here once logged." /></div>
                      : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border">
                                {['Effective From', 'Previous CTC', 'Revised CTC', 'Status', 'Reason'].map(h => (
                                  <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {payrollRevisionsData!.data.map((r: any) => (
                                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20">
                                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(r.effective_date)}</td>
                                  <td className="px-4 py-2 tabular-nums">{r.before_ctc_annual ? fmtMoney(r.before_ctc_annual) : '—'}</td>
                                  <td className="px-4 py-2 tabular-nums font-medium">{r.new_ctc_annual ? fmtMoney(r.new_ctc_annual) : '—'}</td>
                                  <td className="px-4 py-2">
                                    <Badge
                                      variant={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'destructive' : 'secondary'}
                                      className="rounded-full text-[9px] capitalize"
                                    >
                                      {r.status ?? '—'}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-2 text-muted-foreground max-w-[160px] truncate">{r.reason ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </CardContent>
                </Card>
              )}

              {/* ── Compensation History Timeline ── */}
              {isAdmin && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Compensation History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {!(compensationHistoryData?.data?.length)
                      ? <div className="px-6 pb-6"><EmptySection icon={History} title="No history" subtitle="Past compensation records will appear here." /></div>
                      : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border">
                                {['Effective From', 'Annual CTC', 'Monthly CTC', 'Status'].map(h => (
                                  <th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {compensationHistoryData!.data.map((row: any) => (
                                <tr key={row.id} className={cn('border-b border-border/50', row.is_active && 'bg-success/4')}>
                                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(row.effective_from)}</td>
                                  <td className="px-4 py-2 tabular-nums font-medium">{fmtMoney(row.ctc_annual)}</td>
                                  <td className="px-4 py-2 tabular-nums">{fmtMoney(row.ctc_monthly)}</td>
                                  <td className="px-4 py-2">
                                    {row.is_active
                                      ? <Badge variant="success" className="rounded-full text-[9px]">Active</Badge>
                                      : <Badge variant="secondary" className="rounded-full text-[9px]">Closed</Badge>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                  </CardContent>
                </Card>
              )}

              {/* ── Initiate Revision dialog ── */}
              {isAdmin && (
                <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-sm">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        Initiate Compensation Revision
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                      {/* Revision type */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Revision Type</Label>
                        <Select value={revisionForm.revision_type} onValueChange={v => setRevisionForm(f => ({ ...f, revision_type: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[
                              { v: 'increment',    l: 'Increment'     },
                              { v: 'promotion',    l: 'Promotion'     },
                              { v: 'revision',     l: 'Revision'      },
                              { v: 'correction',   l: 'Correction'    },
                              { v: 'restructure',  l: 'Restructure'   },
                              { v: 'retro',        l: 'Retro Arrears' },
                            ].map(({ v, l }) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* New CTC */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">New Annual CTC <span className="text-destructive">*</span></Label>
                        <Input
                          type="number"
                          className="h-8 text-xs"
                          placeholder="e.g. 600000"
                          value={revisionForm.new_ctc_annual}
                          onChange={e => setRevisionForm(f => ({ ...f, new_ctc_annual: e.target.value }))}
                        />
                        {/* Delta preview */}
                        {revisionForm.new_ctc_annual && comp && (() => {
                          const newCTC  = Number(revisionForm.new_ctc_annual)
                          const delta   = newCTC - (comp.ctc_annual ?? 0)
                          const pct     = comp.ctc_annual > 0 ? ((delta / comp.ctc_annual) * 100).toFixed(1) : '—'
                          const isUp    = delta >= 0
                          return (
                            <p className={cn('text-[11px] mt-1', isUp ? 'text-success' : 'text-destructive')}>
                              {fmtMoney(comp.ctc_annual)} → {fmtMoney(newCTC)}
                              <span className="ml-1.5 font-semibold">({isUp ? '+' : ''}{fmtMoney(delta)} / {pct}%)</span>
                            </p>
                          )
                        })()}
                      </div>
                      {/* Effective date */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Effective Date <span className="text-destructive">*</span></Label>
                        <Input
                          type="date"
                          className="h-8 text-xs"
                          value={revisionForm.effective_date}
                          onChange={e => setRevisionForm(f => ({ ...f, effective_date: e.target.value }))}
                        />
                        {revisionForm.effective_date > today && (
                          <p className="text-[10px] text-warning">Future revision — will be applied to payroll from {fmtDate(revisionForm.effective_date)}</p>
                        )}
                      </div>
                      {/* Reason */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. Annual increment 2025"
                          value={revisionForm.reason}
                          onChange={e => setRevisionForm(f => ({ ...f, reason: e.target.value }))}
                        />
                      </div>
                      {/* Notes */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="Additional context..."
                          value={revisionForm.notes}
                          onChange={e => setRevisionForm(f => ({ ...f, notes: e.target.value }))}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="ghost" size="sm" onClick={() => setRevisionOpen(false)}>Cancel</Button>
                      <Button
                        size="sm"
                        disabled={!revisionForm.new_ctc_annual || !revisionForm.reason || initiateRevisionMutation.isPending}
                        onClick={() => initiateRevisionMutation.mutate()}
                      >
                        {initiateRevisionMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                        Submit for Approval
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

            </div>
          )}

          {/* ── Reject revision reason dialog (global — accessible from any sub-tab) ── */}
          <Dialog open={rejectTarget !== null} onOpenChange={open => { if (!open) { setRejectTarget(null); setRejectReason('') } }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Reject Revision</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <p className="text-sm text-muted-foreground">Provide a reason so the employee knows what to address.</p>
                <Input
                  placeholder="e.g. Budget not approved for this cycle"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => { setRejectTarget(null); setRejectReason('') }}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!rejectReason.trim() || rejectRevisionMutation.isPending}
                  onClick={() => rejectRevisionMutation.mutate({ revId: rejectTarget!, reason: rejectReason.trim() })}
                >
                  {rejectRevisionMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Confirm Rejection
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* DOCUMENTS › Documents */}
          {subTab === 'documents' && (
            <div className="space-y-4">
              {/* Missing mandatory docs warning */}
              {(() => {
                const uploadedTypes = (docsData?.data ?? []).map((d: any) => (d.doc_type ?? '').trim())
                const missing = MANDATORY_DOC_TYPES.filter(
                  t => !uploadedTypes.some((u: string) => u.toLowerCase().includes(t.toLowerCase()))
                )
                if (!missing.length) return null
                return (
                  <div className="flex items-start gap-2 p-3 rounded-md border border-warning/40 bg-warning/5">
                    <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-warning">Missing mandatory documents</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{missing.join(', ')}</p>
                    </div>
                  </div>
                )
              })()}

              <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Documents</CardTitle>
                  <>
                    <input ref={docInputRef} type="file" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (!f) return; setDocFile(f); setDocMeta({ name: f.name.replace(/\.[^.]+$/, ''), doc_type: '' }); setDocMetaOpen(true); e.target.value = '' }} />
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => docInputRef.current?.click()}>
                      <Plus className="h-3.5 w-3.5" />Upload
                    </Button>
                  </>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!(docsData?.data?.length)
                  ? <div className="px-6 pb-6"><EmptySection icon={Files} title="No documents" subtitle="Upload documents using the button above." /></div>
                  : <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-border">{['Name','Type','Mandatory','Uploaded',''].map(h=><th key={h} className="text-left text-muted-foreground font-semibold px-4 py-2">{h}</th>)}</tr></thead>
                        <tbody>
                          {docsData!.data.map((d: any) => {
                            const isMandatory = MANDATORY_DOC_TYPES.some(
                              t => (d.doc_type ?? '').toLowerCase().includes(t.toLowerCase())
                            )
                            return (
                            <tr key={d.id} className="border-b border-border/50">
                              <td className="px-4 py-2 font-medium">{d.name}</td>
                              <td className="px-4 py-2 text-muted-foreground">{d.doc_type}</td>
                              <td className="px-4 py-2">
                                {isMandatory
                                  ? <Badge variant="outline" className="rounded-full text-[9px] border-success text-success">Required</Badge>
                                  : <span className="text-muted-foreground text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground">{fmtDate(d.created_at)}</td>
                              <td className="px-4 py-2">
                                <div className="flex gap-1">
                                  {d.storage_path && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openSignedUrl(d.storage_path)}><Files className="h-3 w-3" /></Button>}
                                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => delDocMutation.mutate(d.id)}><Trash2 className="h-3 w-3" /></Button>
                                </div>
                              </td>
                            </tr>
                          )})}
                        </tbody>
                      </table>
                    </div>}
              </CardContent>
            </Card>
            </div>
          )}

          {/* DOCUMENTS › Passport & Visa */}
          {subTab === 'passport-visa' && (
            <div className="space-y-4">
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setPvForm({ record_type: 'passport' }); setAddPvOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Passport</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setPvForm({ record_type: 'visa' }); setAddPvOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Visa</Button>
              </div>
              {(['passport', 'visa'] as const).map(rt => {
                const items = (pvData?.data ?? []).filter((p: any) => p.record_type === rt)
                return (
                  <Card key={rt}>
                    <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold capitalize">{rt}s</CardTitle></CardHeader>
                    <CardContent>
                      {!items.length
                        ? <p className="text-xs text-muted-foreground">No {rt} records.</p>
                        : <div className="space-y-3">{items.map((pv: any) => {
                            const soon = pv.expiry_date && new Date(pv.expiry_date) < new Date(Date.now() + 90*24*60*60*1000)
                            return (
                              <div key={pv.id} className="flex items-start justify-between p-3 rounded-md border border-border bg-muted/20">
                                <div>
                                  <p className="text-sm font-semibold">{pv.doc_number}</p>
                                  <p className="text-xs text-muted-foreground">{pv.country}{pv.visa_type ? ` · ${pv.visa_type}` : ''}</p>
                                  <p className="text-xs text-muted-foreground">Expires: {fmtDate(pv.expiry_date)}</p>
                                  {soon && <Badge variant="warning" className="rounded-full text-[9px] mt-1">Expiring soon</Badge>}
                                </div>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delPvMutation.mutate(pv.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                              </div>
                            )
                          })}</div>}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* RELATIONSHIPS › Family */}
          {subTab === 'family' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setFamForm({}); setAddFamOpen(true) }}><Plus className="h-3.5 w-3.5" />Add Member</Button>
              </div>
              {!(familyData?.data?.length)
                ? <Card><CardContent className="pt-6"><EmptySection icon={Users} title="No family members" /></CardContent></Card>
                : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{familyData!.data.map((fm: any) => (
                    <Card key={fm.id}>
                      <CardContent className="pt-4 pb-4 flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold">{fm.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{fm.relationship_type?.name ?? '—'}</p>
                          {fm.dob && <p className="text-xs text-muted-foreground">{fmtDate(fm.dob)}</p>}
                          {fm.is_dependent && <Badge variant="outline" className="rounded-full text-[9px] mt-1">Dependent</Badge>}
                        </div>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => delFamMutation.mutate(fm.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </CardContent>
                    </Card>
                  ))}</div>}
            </div>
          )}

          {/* RELATIONSHIPS › Nomination */}
          {subTab === 'nomination' && (
            <div className="space-y-4">
              {(['pf', 'gratuity', 'esi', 'superannuation'] as const).map(scheme => {
                const schemeNoms = (nominationsData?.data ?? []).filter((n: any) => n.scheme === scheme)
                return (
                  <Card key={scheme}>
                    <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold uppercase">{scheme}</CardTitle></CardHeader>
                    <CardContent>
                      {!schemeNoms.length
                        ? <p className="text-xs text-muted-foreground">No nominations for this scheme.</p>
                        : <div className="space-y-2">{schemeNoms.map((n: any) => (
                          <div key={n.id} className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30">
                            <span className="font-medium">{n.nominee_name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{n.share_percentage}%</span>
                              {n.is_minor && <Badge variant="warning" className="rounded-full text-[9px]">Minor</Badge>}
                            </div>
                          </div>
                        ))}</div>}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* ASSETS › Access Card */}
          {subTab === 'access-card' && (
            <div className="space-y-3">
              {isAdmin && !(accessCardsData?.data ?? []).some((c: any) => c.status === 'active') && (
                <div className="flex justify-end">
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={() => { setCardForm({ issued_date: new Date().toISOString().slice(0,10) }); setAddCardOpen(true) }}><Plus className="h-3.5 w-3.5" />Issue Card</Button>
                </div>
              )}
              {!(accessCardsData?.data?.length)
                ? <Card><CardContent className="pt-6"><EmptySection icon={CreditCard} title="No access cards" /></CardContent></Card>
                : accessCardsData!.data.map((card: any) => {
                    const STATUS_MAP: Record<string, string> = { active: 'success', returned: 'secondary', deactivated: 'secondary', lost: 'destructive' }
                    const v: any = STATUS_MAP[card.status as string] ?? 'secondary'
                    return (
                      <Card key={card.id}>
                        <CardContent className="pt-4 pb-4 flex items-start justify-between">
                          <div>
                            <p className="text-sm font-semibold font-mono">{card.card_number}</p>
                            <p className="text-xs text-muted-foreground">Issued: {fmtDate(card.issued_date)}</p>
                            {card.returned_date && <p className="text-xs text-muted-foreground">Returned: {fmtDate(card.returned_date)}</p>}
                            <Badge variant={v} className="rounded-full text-[10px] mt-1 capitalize">{card.status}</Badge>
                          </div>
                          {isAdmin && card.status === 'active' && (
                            <div className="flex gap-1">
                              {(['returned','lost','deactivated'] as const).map(s => (
                                <Button key={s} size="sm" variant="outline" className="h-6 text-[10px] capitalize"
                                  onClick={() => updateCardMutation.mutate({ cardId: card.id, status: s })}>{s}</Button>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })}
            </div>
          )}

        </div>
      </div>

      {/* ── Dialogs ── */}

      {/* Add Job History */}
      <Dialog open={addJobOpen} onOpenChange={setAddJobOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Position Record</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Employment Type</Label>
              <select className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none" value={jobForm.employment_type ?? 'permanent'} onChange={e => setJobForm((p:any)=>({...p,employment_type:e.target.value}))}>
                {['permanent','contract','intern','probation','consultant'].map(o=><option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Effective From</Label>
              <Input className="mt-1 h-8 text-xs" type="date" value={jobForm.effective_from ?? ''} onChange={e=>setJobForm((p:any)=>({...p,effective_from:e.target.value}))} />
            </div>
            <div>
              <Label className="text-xs">Reason for Change</Label>
              <Input className="mt-1 h-8 text-xs" value={jobForm.reason_for_change ?? ''} onChange={e=>setJobForm((p:any)=>({...p,reason_for_change:e.target.value}))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddJobOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addJobMutation.mutate(jobForm)} disabled={addJobMutation.isPending}>
              {addJobMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Previous Employment */}
      <Dialog open={addPrevOpen} onOpenChange={setAddPrevOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Previous Employment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {([{label:'Company',key:'company_name'},{label:'Designation',key:'designation'},{label:'Reason for Leaving',key:'reason_for_leaving'}] as const).map(f=>(
              <div key={f.key}><Label className="text-xs">{f.label}</Label><Input className="mt-1 h-8 text-xs" value={prevForm[f.key]??''} onChange={e=>setPrevForm((p:any)=>({...p,[f.key]:e.target.value}))}/></div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">From</Label><Input className="mt-1 h-8 text-xs" type="date" value={prevForm.from_date??''} onChange={e=>setPrevForm((p:any)=>({...p,from_date:e.target.value}))}/></div>
              <div><Label className="text-xs">To</Label><Input className="mt-1 h-8 text-xs" type="date" value={prevForm.to_date??''} onChange={e=>setPrevForm((p:any)=>({...p,to_date:e.target.value}))}/></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddPrevOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addPrevMutation.mutate(prevForm)} disabled={addPrevMutation.isPending}>
              {addPrevMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Passport / Visa */}
      <Dialog open={addPvOpen} onOpenChange={setAddPvOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add {pvForm.record_type === 'visa' ? 'Visa' : 'Passport'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {([{label:'Document Number',key:'doc_number'},{label:'Country',key:'country'},{label:'Place of Issue',key:'place_of_issue'},...(pvForm.record_type==='visa'?[{label:'Visa Type',key:'visa_type'}]:[])] as Array<{label:string;key:string}>).map(f=>(
              <div key={f.key}><Label className="text-xs">{f.label}</Label><Input className="mt-1 h-8 text-xs" value={pvForm[f.key]??''} onChange={e=>setPvForm((p:any)=>({...p,[f.key]:e.target.value}))}/></div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Issue Date</Label><Input className="mt-1 h-8 text-xs" type="date" value={pvForm.issue_date??''} onChange={e=>setPvForm((p:any)=>({...p,issue_date:e.target.value}))}/></div>
              <div><Label className="text-xs">Expiry Date</Label><Input className="mt-1 h-8 text-xs" type="date" value={pvForm.expiry_date??''} onChange={e=>setPvForm((p:any)=>({...p,expiry_date:e.target.value}))}/></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddPvOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addPvMutation.mutate(pvForm)} disabled={addPvMutation.isPending}>
              {addPvMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Family Member */}
      <Dialog open={addFamOpen} onOpenChange={setAddFamOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Family Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input className="mt-1 h-8 text-xs" value={famForm.name??''} onChange={e=>setFamForm((p:any)=>({...p,name:e.target.value}))}/></div>
            <div><Label className="text-xs">Date of Birth</Label><Input className="mt-1 h-8 text-xs" type="date" value={famForm.dob??''} onChange={e=>setFamForm((p:any)=>({...p,dob:e.target.value}))}/></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fam_dep" checked={!!famForm.is_dependent} onChange={e=>setFamForm((p:any)=>({...p,is_dependent:e.target.checked}))} className="rounded" />
              <Label htmlFor="fam_dep" className="text-xs">Dependent</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddFamOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addFamMutation.mutate(famForm)} disabled={addFamMutation.isPending}>
              {addFamMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue Access Card */}
      <Dialog open={addCardOpen} onOpenChange={setAddCardOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Issue Access Card</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Card Number</Label><Input className="mt-1 h-8 text-xs" value={cardForm.card_number??''} onChange={e=>setCardForm((p:any)=>({...p,card_number:e.target.value}))}/></div>
            <div><Label className="text-xs">Issued Date</Label><Input className="mt-1 h-8 text-xs" type="date" value={cardForm.issued_date??''} onChange={e=>setCardForm((p:any)=>({...p,issued_date:e.target.value}))}/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>setAddCardOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={()=>addCardMutation.mutate(cardForm)} disabled={addCardMutation.isPending}>
              {addCardMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Operational Assignment Dialog ── */}
      <Dialog open={!!assignTarget} onOpenChange={open => { if (!open) setAssignTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          {assignTarget && (() => {
            const cfg   = ASSIGN_CONFIG[assignTarget]
            const opts  = assignOptions[assignTarget] ?? []
            const isPending = assignTarget === 'shift'
              ? shiftAssignMutation.isPending
              : jobAssignMutation.isPending

            // Recent history for this field (last 4 job_history rows)
            const historyRows: any[] = (jobHistoryData?.data ?? []).slice(0, 4)

            // Past effective date warning
            const today = new Date().toISOString().slice(0, 10)
            const isPast = assignForm.effective_from && assignForm.effective_from < today

            function handleSubmit() {
              if (!assignForm.value || !assignForm.effective_from) return
              if (assignTarget === 'shift') {
                shiftAssignMutation.mutate({ shift_id: assignForm.value, effective_from: assignForm.effective_from })
              } else {
                jobAssignMutation.mutate({
                  fieldKey:       cfg.fieldKey,
                  value:          assignForm.value,
                  effective_from: assignForm.effective_from,
                  reason:         assignForm.reason,
                })
              }
            }

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-sm">{cfg.title}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Current assignment */}
                  <div className="p-2.5 rounded-md bg-muted/50 border border-border text-xs">
                    <span className="text-muted-foreground">Current: </span>
                    <span className="font-medium text-foreground">{cfg.currentLabel}</span>
                  </div>

                  {/* New value */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">New {cfg.title.replace('Reassign ', '').replace('Change ', '')}</Label>
                    <select
                      className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                      value={assignForm.value}
                      onChange={e => setAssignForm(p => ({ ...p, value: e.target.value }))}
                    >
                      <option value="">— Select —</option>
                      {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>

                  {/* Effective from */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Effective From *</Label>
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={assignForm.effective_from}
                      onChange={e => setAssignForm(p => ({ ...p, effective_from: e.target.value }))}
                    />
                    {isPast && (
                      <p className="text-[10px] text-warning flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Backdated assignment — will be recorded with a past effective date
                      </p>
                    )}
                  </div>

                  {/* Reason — not shown for shift (shift endpoint doesn't take reason) */}
                  {assignTarget !== 'shift' && (
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Reason for Change</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="Promotion, restructure, transfer…"
                        value={assignForm.reason}
                        onChange={e => setAssignForm(p => ({ ...p, reason: e.target.value }))}
                      />
                    </div>
                  )}

                  {/* Recent history preview */}
                  {historyRows.length > 0 && assignTarget !== 'shift' && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">Recent Changes</p>
                      <div className="space-y-1">
                        {historyRows.map((row: any, i: number) => {
                          const val =
                            assignTarget === 'department'      ? row.departments?.name      :
                            assignTarget === 'designation'     ? row.designations?.name     :
                            assignTarget === 'grade'           ? row.grades?.name           :
                            assignTarget === 'manager'         ? (row.manager ? `${row.manager.first_name} ${row.manager.last_name}` : null) :
                            assignTarget === 'cost_center'     ? row.cost_centers?.name     :
                            assignTarget === 'work_location'   ? row.work_locations?.name   :
                            assignTarget === 'employment_type' ? row.employment_type        : null
                          if (!val) return null
                          return (
                            <div key={row.id ?? i} className="flex items-center justify-between text-[10px] py-1 border-b border-border/40 last:border-0">
                              <span className="text-foreground font-medium">{val}</span>
                              <span className="text-muted-foreground">{fmtDate(row.effective_from)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Shift history — shown when reassigning shift */}
                  {assignTarget === 'shift' && (shiftHistoryData?.data?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1.5">Shift History</p>
                      <div className="space-y-1">
                        {(shiftHistoryData!.data ?? []).slice(0, 4).map((row: any) => (
                          <div key={row.id} className="flex items-center justify-between text-[10px] py-1 border-b border-border/40 last:border-0">
                            <span className="text-foreground font-medium">{row.shifts?.name ?? '—'}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{fmtDate(row.effective_from)}</span>
                              {row.is_current && <Badge variant="success" className="rounded-full text-[8px] py-0">Current</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="ghost" size="sm" onClick={() => setAssignTarget(null)}>Cancel</Button>
                  <Button
                    size="sm"
                    disabled={!assignForm.value || !assignForm.effective_from || isPending}
                    onClick={handleSubmit}
                  >
                    {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    Confirm Assignment
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Document metadata */}
      {/* ── Create User Account dialog ──────────────────────────────────────── */}
      <Dialog open={accountDlgOpen} onOpenChange={open => {
        if (!open) {
          setAccountDlgOpen(false)
          setCreatedCredentials(null)
          setAccountForm({ email: '', role: 'employee', temporary_password: '', send_invite: false, is_active: true })
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              {createdCredentials ? 'Account Created — Save Credentials' : 'Create Portal Account'}
            </DialogTitle>
          </DialogHeader>

          {createdCredentials ? (
            /* ── Credentials panel: shown only when password was auto-generated ── */
            <div className="space-y-4 py-1">
              <p className="text-xs text-muted-foreground">
                Share these credentials with the employee. The password will <strong>not</strong> be shown again.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Login Email</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-background border border-border rounded px-2 py-1.5 select-all">
                      {createdCredentials.email}
                    </code>
                    <Button
                      variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(createdCredentials.email); toast.success('Email copied') }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Temporary Password</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-background border border-border rounded px-2 py-1.5 select-all">
                      {createdCredentials.password}
                    </code>
                    <Button
                      variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0"
                      onClick={() => { navigator.clipboard.writeText(createdCredentials.password); toast.success('Password copied') }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                The employee should change this password on first login.
              </p>
            </div>
          ) : (
            /* ── Account creation form ─────────────────────────────────────────── */
            <div className="space-y-3 py-1">
              {/* Login email */}
              <div className="space-y-1.5">
                <Label htmlFor="acc-email" className="text-xs">Login Email <span className="text-destructive">*</span></Label>
                <Input
                  id="acc-email"
                  type="email"
                  className="h-8 text-xs"
                  placeholder="employee@company.com"
                  value={accountForm.email}
                  onChange={e => setAccountForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <Label htmlFor="acc-role" className="text-xs">Portal Role</Label>
                <Select
                  value={accountForm.role}
                  onValueChange={v => setAccountForm(f => ({ ...f, role: v as 'employee' | 'manager' }))}
                >
                  <SelectTrigger id="acc-role" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee" className="text-xs">Employee — ESS self-service portal</SelectItem>
                    <SelectItem value="manager"  className="text-xs">Manager — ESS + team approval access</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Flow toggle: Direct vs Invite */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="grid grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setAccountForm(f => ({ ...f, send_invite: false }))}
                    className={cn(
                      'py-2 px-3 text-xs font-medium transition-colors text-left',
                      !accountForm.send_invite
                        ? 'bg-primary/8 text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <p className="font-semibold">Direct Creation</p>
                    <p className="text-[10px] opacity-70 mt-0.5">Set password now, activate immediately</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountForm(f => ({ ...f, send_invite: true }))}
                    className={cn(
                      'py-2 px-3 text-xs font-medium transition-colors text-left border-l border-border',
                      accountForm.send_invite
                        ? 'bg-primary/8 text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <p className="font-semibold">Send Invite</p>
                    <p className="text-[10px] opacity-70 mt-0.5">Employee sets own password via email</p>
                  </button>
                </div>

                {/* Direct creation: password field */}
                {!accountForm.send_invite && (
                  <div className="p-3 border-t border-border space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="acc-pwd" className="text-xs">
                        Temporary Password
                        <span className="text-muted-foreground ml-1">(auto-generated if blank)</span>
                      </Label>
                      <Input
                        id="acc-pwd"
                        type="text"
                        className="h-8 text-xs font-mono"
                        placeholder="Min 8 chars — leave blank to auto-generate"
                        value={accountForm.temporary_password}
                        onChange={e => setAccountForm(f => ({ ...f, temporary_password: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium">Activate Immediately</p>
                        <p className="text-[10px] text-muted-foreground">Employee can log in right away</p>
                      </div>
                      <Switch
                        checked={accountForm.is_active}
                        onCheckedChange={v => setAccountForm(f => ({ ...f, is_active: v }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {createdCredentials ? (
              <Button size="sm" onClick={() => {
                setAccountDlgOpen(false)
                setCreatedCredentials(null)
                setAccountForm({ email: '', role: 'employee', temporary_password: '', send_invite: false, is_active: true })
              }}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setAccountDlgOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!accountForm.email || createAccountMutation.isPending}
                  onClick={() => createAccountMutation.mutate()}
                >
                  {createAccountMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Send className="h-3.5 w-3.5" />}
                  {accountForm.send_invite ? 'Send Invite' : 'Create Account'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document metadata */}
      <Dialog open={docMetaOpen} onOpenChange={open => { if (!open) { setDocMetaOpen(false); setDocFile(null) } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Document Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Document Name</Label><Input className="mt-1 h-8 text-xs" value={docMeta?.name??''} onChange={e=>setDocMeta((p:any)=>({...p,name:e.target.value}))}/></div>
            <div><Label className="text-xs">Document Type</Label><Input className="mt-1 h-8 text-xs" placeholder="e.g. Offer Letter, ID Proof" value={docMeta?.doc_type??''} onChange={e=>setDocMeta((p:any)=>({...p,doc_type:e.target.value}))}/></div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={()=>{setDocMetaOpen(false);setDocFile(null)}}>Cancel</Button>
            <Button size="sm"
              disabled={!docMeta?.name || !docMeta?.doc_type || uploadDocMutation.isPending || !docFile}
              onClick={()=>docFile && uploadDocMutation.mutate({ file: docFile, name: docMeta!.name, doc_type: docMeta!.doc_type })}>
              {uploadDocMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
