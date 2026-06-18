/**
 * ImportWorkspace — Universal Master Import Framework
 *
 * Provides a full step-based import workflow for all 9 master types:
 * employees, shifts, departments, designations, work_locations,
 * cost_centers, salary_components, leave_types, holiday_calendar
 *
 * Steps: download → upload → validate → import → complete
 */

import * as React from 'react'
import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import {
  Users,
  Clock,
  CalendarDays,
  Landmark,
  Building2,
  Briefcase,
  MapPin,
  DollarSign,
  Umbrella,
  Sun,
  Wallet,
  BookOpen,
  UserCheck,
  Globe,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileSpreadsheet,
  ChevronRight,
  Loader2,
  RotateCcw,
  History,
  RefreshCw,
  Filter,
  ArrowRight,
  Layers,
  Scale,
  Package,
  FileText,
  CreditCard,
  Heart,
  TrendingUp,
  BarChart3,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader } from '@/components/layout/PageHeader'
import { SectionCard } from '@/components/layout/SectionCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api } from '@/lib/api/client'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type MasterType =
  | 'states'
  | 'clusters'
  | 'sites'
  | 'employees'
  | 'shifts'
  | 'rosters'
  | 'departments'
  | 'designations'
  | 'work_locations'
  | 'cost_centers'
  | 'salary_components'
  | 'leave_types'
  | 'holiday_calendar'
  // Enterprise operational masters
  | 'grades'
  | 'payroll_groups'
  | 'employment_categories'
  | 'statutory_groups'
  | 'asset_categories'
  // Payroll masters
  | 'salary_structures'
  // Enterprise onboarding imports
  | 'employee_compensation'
  | 'employee_bank_details'
  | 'leave_opening_balances'
  | 'shift_assignments'
  | 'compensation_revisions'
  // Reference data
  | 'document_types'
  | 'identity_types'
  | 'relationship_types'

type Step = 'download' | 'upload' | 'validate' | 'import' | 'complete'
// NOTE: must match backend ImportMode — 'create_only' / 'update_only', NOT 'create' / 'update'
type Mode = 'upsert' | 'create_only' | 'update_only' | 'validate_only'
type ActiveTab = 'import' | 'history'

// Flattened per-error row (derived from ValidatedRow.errors + .warnings on response)
interface ValidationRow {
  rowNumber: number
  field: string
  error: string
  severity: 'error' | 'warning'
}

// Matches backend ValidatedRow shape
interface BackendRowError {
  field:    string
  message:  string
  severity: 'error' | 'warning'
}
interface BackendValidatedRow {
  rowNumber:    number
  errors:       BackendRowError[]
  warnings:     BackendRowError[]
  isValid:      boolean
  isDuplicate?: boolean
}

// Backend ValidationResult (as returned by POST /import/validate)
interface BackendValidationResult {
  totalRows:     number
  validRows:     number
  invalidRows:   number
  duplicateRows: number
  rows:          BackendValidatedRow[]
}

// Frontend-normalised result (errors flattened for display)
interface ValidationResult {
  totalRows:     number
  validRows:     number
  invalidRows:   number
  duplicateRows: number
  rows:          ValidationRow[]
}

/** Flatten backend validation rows (one row per error/warning) for the error table. */
function flattenValidationRows(backend: BackendValidationResult): ValidationResult {
  const flatRows: ValidationRow[] = []
  for (const vr of backend.rows) {
    for (const e of vr.errors) {
      flatRows.push({ rowNumber: vr.rowNumber, field: e.field, error: e.message, severity: e.severity })
    }
    for (const w of vr.warnings) {
      flatRows.push({ rowNumber: vr.rowNumber, field: w.field, error: w.message, severity: w.severity })
    }
  }
  return {
    totalRows:     backend.totalRows,
    validRows:     backend.validRows,
    invalidRows:   backend.invalidRows,
    duplicateRows: backend.duplicateRows,
    rows:          flatRows,
  }
}

interface ImportResult {
  importJobId: string
  created: number
  updated: number
  failed: number
  skipped: number
}

interface ImportJob {
  id: string
  masterType: MasterType
  fileName: string
  mode: Mode
  totalRows: number
  validRows: number
  created: number
  updated: number
  failed: number
  skipped: number
  status: 'pending' | 'validating' | 'completed' | 'failed'
  durationMs?: number
  createdAt: string
}

interface ImportJobRow {
  id: string
  row_number: number
  status: 'created' | 'updated' | 'failed' | 'skipped'
  errors: Array<{ field: string; message: string; severity: 'error' | 'warning' }> | null
  warnings: Array<{ field: string; message: string; severity: 'error' | 'warning' }> | null
  row_data:         Record<string, unknown> | null
  normalized_data:  Record<string, unknown> | null
  record_id:        string | null
}

interface FlatJobRow {
  rowNumber: number
  field: string
  error: string
  severity: 'error' | 'warning'
}

// ─── Session Persistence ──────────────────────────────────────────────────────

// Sensitive master types whose row data must not be written to localStorage
const SENSITIVE_IMPORT_TYPES: MasterType[] = ['employee_compensation', 'compensation_revisions', 'employee_bank_details']
// Max rows to persist — very large files are re-uploaded after refresh
const SESSION_ROW_LIMIT = 5_000
const SESSION_TTL_MS    = 24 * 60 * 60 * 1000  // 24 h

interface ImportSessionSnapshot {
  masterType: MasterType
  step: Exclude<Step, 'download' | 'complete'>
  fileName: string
  mode: Mode
  parsedRows: Record<string, string>[]
  validationResult: ValidationResult | null
  savedAt: number
}

function sessionKey(t: MasterType)       { return `hrms_import_${t}` }

function saveSession(snap: ImportSessionSnapshot) {
  if (SENSITIVE_IMPORT_TYPES.includes(snap.masterType)) return
  if (snap.parsedRows.length > SESSION_ROW_LIMIT) return
  try {
    localStorage.setItem(sessionKey(snap.masterType), JSON.stringify(snap))
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[Import] session saved  ${snap.masterType} @ ${snap.step}  rows=${snap.parsedRows.length}`)
    }
  } catch { /* quota exceeded */ }
}

function validateSessionIntegrity(data: unknown): data is ImportSessionSnapshot {
  if (!data || typeof data !== 'object') return false
  const s = data as Record<string, unknown>
  return (
    typeof s.masterType === 'string' &&
    MASTER_CONFIGS.some(c => c.type === s.masterType) &&
    typeof s.step === 'string' &&
    ['upload', 'validate', 'import'].includes(s.step) &&
    typeof s.fileName === 'string' &&
    typeof s.mode === 'string' &&
    ['upsert', 'create_only', 'update_only', 'validate_only'].includes(s.mode) &&
    Array.isArray(s.parsedRows) &&
    typeof s.savedAt === 'number'
  )
}

function loadSession(t: MasterType): ImportSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(sessionKey(t))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!validateSessionIntegrity(parsed)) {
      if (process.env.NODE_ENV === 'development') console.warn(`[Import] corrupt session evicted  key=${sessionKey(t)}`)
      localStorage.removeItem(sessionKey(t)); return null
    }
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      if (process.env.NODE_ENV === 'development') console.debug(`[Import] stale session evicted  key=${sessionKey(t)}`)
      localStorage.removeItem(sessionKey(t)); return null
    }
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[Import] session loaded  ${parsed.masterType} @ ${parsed.step}  rows=${parsed.parsedRows.length}`)
    }
    return parsed
  } catch { return null }
}

function clearSession(t: MasterType) {
  try {
    localStorage.removeItem(sessionKey(t))
    if (process.env.NODE_ENV === 'development') console.debug(`[Import] session cleared  key=${sessionKey(t)}`)
  } catch { /* ignore */ }
}

function validateSessionStep(snap: ImportSessionSnapshot): Exclude<Step, 'download' | 'complete'> {
  const { step, parsedRows, validationResult } = snap
  if ((step === 'validate' || step === 'import') && parsedRows.length === 0) return 'upload'
  if (step === 'import' && !validationResult) return 'validate'
  return step
}

function findLatestSession(): ImportSessionSnapshot | null {
  let best: ImportSessionSnapshot | null = null
  for (const cfg of MASTER_CONFIGS) {
    const snap = loadSession(cfg.type)
    if (snap && (!best || snap.savedAt > best.savedAt)) best = snap
  }
  return best
}

// ─── Master Config ─────────────────────────────────────────────────────────────

interface MasterConfig {
  type: MasterType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  requiredFields: string[]
  optionalFields: string[]
  /** Visual group key — used to render section headers in the selector */
  group?: string
  /** Optional dependency step number within a group (e.g. 1 = upload first) */
  groupStep?: number
}

// ─── Import Groups ─────────────────────────────────────────────────────────────
// Org imports must follow this order: Sites → Work Locations → Cost Centers
// (work_locations reference sites via site_code)

interface ImportGroupDef {
  key: string
  label: string
  note?: string
}

const IMPORT_GROUPS: ImportGroupDef[] = [
  {
    key: 'organization',
    label: 'Organization',
    note: 'Import in order — Work Locations reference Sites via site_code',
  },
  { key: 'people',     label: 'People & Structure' },
  { key: 'payroll',    label: 'Payroll & Leave' },
  { key: 'enterprise', label: 'Enterprise Masters', note: 'Grades, payroll groups, statutory groups, categories' },
  { key: 'onboarding', label: 'Enterprise Onboarding', note: 'Compensations, revisions, balances, assignments' },
  { key: 'reference',  label: 'Reference Data', note: 'Document types, identity types, relationship types' },
]

// Per-group accent palette — soft tinted section boxes + matching card icons.
// Opacity-based so it reads correctly in both light and dark mode.
const GROUP_ACCENT: Record<string, { box: string; label: string; icon: string }> = {
  organization: { box: 'bg-blue-500/[0.05] border-blue-500/15',     label: 'text-blue-600 dark:text-blue-400',     icon: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  people:       { box: 'bg-violet-500/[0.05] border-violet-500/15',  label: 'text-violet-600 dark:text-violet-400', icon: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  payroll:      { box: 'bg-emerald-500/[0.05] border-emerald-500/15', label: 'text-emerald-600 dark:text-emerald-400', icon: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  enterprise:   { box: 'bg-amber-500/[0.06] border-amber-500/20',    label: 'text-amber-600 dark:text-amber-400',   icon: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  onboarding:   { box: 'bg-cyan-500/[0.05] border-cyan-500/15',      label: 'text-cyan-600 dark:text-cyan-400',     icon: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  reference:    { box: 'bg-slate-500/[0.06] border-slate-500/15',    label: 'text-slate-600 dark:text-slate-300',   icon: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
}
const DEFAULT_ACCENT = { box: 'bg-muted/40 border-border', label: 'text-muted-foreground', icon: 'bg-muted text-muted-foreground' }

// IMPORTANT: requiredFields / optionalFields MUST match the actual CSV column keys
// defined in apps/api/src/lib/import-engine/templates.ts — these are what the
// backend validator expects and what appears in the downloaded template.
const MASTER_CONFIGS: MasterConfig[] = [
  // ── Organization ────────────────────────────────────────────────────────────
  {
    type: 'states',
    label: 'States',
    description: 'India state/UT master — GST code and PT/LWF flags',
    icon: Globe,
    requiredFields: ['code', 'name'],
    optionalFields: ['region', 'pt_applicable', 'lwf_applicable', 'lwf_frequency'],
    group: 'organization',
    groupStep: 0.4,
  },
  {
    type: 'clusters',
    label: 'Clusters',
    description: 'Operational site groupings — import before Sites',
    icon: Layers,
    requiredFields: ['code', 'name'],
    optionalFields: ['region', 'parent_code', 'manager_code', 'description'],
    group: 'organization',
    groupStep: 0.6,
  },
  {
    type: 'sites',
    label: 'Sites',
    description: 'Campus and branch locations — link State/Cluster/Cost Center/Parent by code',
    icon: Globe,
    requiredFields: ['code', 'name'],
    optionalFields: [
      'short_name', 'site_type', 'status', 'opening_date',
      'state_code', 'cluster_code', 'cost_center_code', 'parent_site_code', 'region', 'zone',
      'location', 'address_line1', 'address_line2', 'city', 'district', 'pincode', 'country', 'timezone',
      'latitude', 'longitude', 'geofence_radius_m',
      'gstin', 'pf_registration_no', 'esi_registration_no', 'pt_registration_no', 'lwf_registration_no', 'shops_estab_reg_no', 'factory_license_no',
      'contact_person', 'contact_phone', 'contact_email', 'sanctioned_headcount',
    ],
    group: 'organization',
    groupStep: 1,
  },
  {
    type: 'work_locations',
    label: 'Work Locations',
    description: 'Office addresses — link to Sites via site_code',
    icon: MapPin,
    requiredFields: ['code', 'name'],
    optionalFields: ['site_code', 'city', 'state', 'country', 'pincode'],
    group: 'organization',
    groupStep: 2,
  },
  {
    type: 'cost_centers',
    label: 'Cost Centers',
    description: 'Financial cost centers for payroll allocation',
    icon: DollarSign,
    requiredFields: ['code', 'name'],
    optionalFields: ['description'],
    group: 'organization',
    groupStep: 3,
  },
  // ── People & Structure ───────────────────────────────────────────────────────
  {
    type: 'employees',
    label: 'Employees',
    description: 'Bulk import employee records with personal and job details',
    icon: Users,
    requiredFields: ['employee_code', 'first_name', 'last_name', 'email', 'joining_date', 'employment_type'],
    optionalFields: ['phone', 'status', 'department_code', 'designation_code', 'grade_code', 'manager_employee_code', 'work_location_code', 'pan_number', 'uan_number'],
    group: 'people',
  },
  {
    type: 'departments',
    label: 'Departments',
    description: 'Organisational units and department hierarchy',
    icon: Building2,
    requiredFields: ['code', 'name'],
    optionalFields: ['parent_code'],
    group: 'people',
  },
  {
    type: 'designations',
    label: 'Designations',
    description: 'Job titles and designation grade mappings',
    icon: Briefcase,
    requiredFields: ['code', 'name'],
    optionalFields: ['department_code', 'level'],
    group: 'people',
  },
  {
    type: 'shifts',
    label: 'Shifts',
    description: 'Define work shift schedules and timing configurations',
    icon: Clock,
    requiredFields: ['code', 'name', 'start_time', 'end_time'],
    optionalFields: ['grace_minutes', 'is_night_shift'],
    group: 'people',
  },
  {
    type: 'rosters',
    label: 'Rosters (Weekly-Off)',
    description: 'Weekly-off / rotation policies — Mon-Fri, 6-day, custom patterns',
    icon: CalendarDays,
    requiredFields: ['code', 'name'],
    optionalFields: ['description', 'cycle_days', 'weekly_off_days', 'is_active'],
    group: 'people',
  },
  // ── Payroll & Leave ──────────────────────────────────────────────────────────
  {
    type: 'salary_components',
    label: 'Salary Components',
    description: 'Earnings, deductions and reimbursement components',
    icon: DollarSign,
    requiredFields: ['code', 'name', 'component_type'],
    optionalFields: ['is_taxable', 'is_pf_applicable', 'is_esi_applicable'],
    group: 'payroll',
  },
  {
    type: 'leave_types',
    label: 'Leave Types',
    description: 'Leave policies and payability configuration',
    icon: Umbrella,
    requiredFields: ['name'],
    optionalFields: ['is_paid', 'allow_sandwich'],
    group: 'payroll',
  },
  {
    type: 'holiday_calendar',
    label: 'Holiday Calendar',
    description: 'Public and restricted holidays by location or policy',
    icon: Sun,
    requiredFields: ['date', 'name'],
    optionalFields: ['holiday_type'],
    group: 'payroll',
  },
  // ── Enterprise masters ────────────────────────────────────────────────────────
  {
    type: 'grades',
    label: 'Grades / Bands',
    description: 'Pay grades and bands with CTC min/max ranges',
    icon: BarChart3,
    requiredFields: ['code', 'name'],
    optionalFields: ['description', 'level_order', 'ctc_min_annual', 'ctc_max_annual'],
    group: 'enterprise',
  },
  {
    type: 'payroll_groups',
    label: 'Payroll Groups',
    description: 'Payroll processing cycles and payout schedules',
    icon: Layers,
    requiredFields: ['code', 'name'],
    optionalFields: ['cycle_type', 'cycle_start_day', 'cutoff_day', 'payout_day', 'currency_code'],
    group: 'enterprise',
  },
  {
    type: 'employment_categories',
    label: 'Employment Categories',
    description: 'Engagement classification with statutory eligibility flags',
    icon: Briefcase,
    requiredFields: ['code', 'name'],
    optionalFields: ['description', 'benefits_eligible', 'pf_applicable', 'esi_applicable', 'notice_period_days', 'probation_days'],
    group: 'enterprise',
  },
  {
    type: 'statutory_groups',
    label: 'Statutory Groups',
    description: 'State-wise PF / ESI / PT / LWF compliance configuration',
    icon: Scale,
    requiredFields: ['code', 'name'],
    optionalFields: ['state', 'pf_enabled', 'esi_enabled', 'pt_enabled', 'lwf_enabled', 'pf_wage_ceiling', 'esi_wage_ceiling'],
    group: 'enterprise',
  },
  {
    type: 'asset_categories',
    label: 'Asset Categories',
    description: 'Asset classification and depreciation rules',
    icon: Package,
    requiredFields: ['code', 'name'],
    optionalFields: ['description', 'depreciation_method', 'useful_life_years', 'requires_return'],
    group: 'enterprise',
  },
  {
    type: 'salary_structures',
    label: 'Salary Structures',
    description: 'Named CTC packages that group salary components',
    icon: DollarSign,
    requiredFields: ['code', 'name'],
    optionalFields: ['description', 'is_default'],
    group: 'enterprise',
  },
  // ── Enterprise onboarding ──────────────────────────────────────────────────
  {
    type: 'employee_compensation',
    label: 'Employee Compensation',
    description: 'Bulk-set CTC and salary structures for employees',
    icon: Wallet,
    requiredFields: ['employee_code', 'effective_from', 'ctc_annual'],
    optionalFields: ['salary_structure_code', 'notes'],
    group: 'onboarding',
  },
  {
    type: 'employee_bank_details',
    label: 'Employee Bank & Statutory',
    description: 'Bank account + PAN / UAN / PF / ESI details per employee',
    icon: Landmark,
    requiredFields: ['employee_code'],
    optionalFields: ['bank_name', 'account_number', 'ifsc_code', 'branch_name', 'account_type', 'pan_number', 'uan_number', 'pf_number', 'esi_number', 'tax_regime'],
    group: 'onboarding',
  },
  {
    type: 'compensation_revisions',
    label: 'Compensation Revisions',
    description: 'Bulk-initiate pending CTC revisions (increment, promotion, correction)',
    icon: TrendingUp,
    requiredFields: ['employee_code', 'revision_type', 'effective_date', 'new_ctc_annual', 'reason'],
    optionalFields: ['notes'],
    group: 'onboarding',
  },
  {
    type: 'leave_opening_balances',
    label: 'Leave Opening Balances',
    description: 'Set opening leave balances (with carry-forward) for the year',
    icon: BookOpen,
    requiredFields: ['employee_code', 'leave_type_name', 'balance'],
    optionalFields: ['year', 'carry_forward_balance'],
    group: 'onboarding',
  },
  {
    type: 'shift_assignments',
    label: 'Shift Assignments',
    description: 'Assign employees to shifts with effective dates',
    icon: UserCheck,
    requiredFields: ['employee_code', 'shift_code', 'effective_from'],
    optionalFields: [],
    group: 'onboarding',
  },
  // ── Reference data ────────────────────────────────────────────────────────────
  {
    type: 'document_types',
    label: 'Document Types',
    description: 'Document classification for employee records (Aadhaar, PAN, etc.)',
    icon: FileText,
    requiredFields: ['code', 'name'],
    optionalFields: ['description', 'is_mandatory'],
    group: 'reference',
  },
  {
    type: 'identity_types',
    label: 'Identity Types',
    description: 'Identity document types (Passport, Driving Licence, etc.)',
    icon: CreditCard,
    requiredFields: ['code', 'name'],
    optionalFields: ['description'],
    group: 'reference',
  },
  {
    type: 'relationship_types',
    label: 'Relationship Types',
    description: 'Nominee / dependent relationship types (Spouse, Father, etc.)',
    icon: Heart,
    requiredFields: ['code', 'name'],
    optionalFields: [],
    group: 'reference',
  },
]

const MODE_LABELS: Record<Mode, string> = {
  upsert:        'Create + Update (Upsert)',
  create_only:   'Create Only',
  update_only:   'Update Only',
  validate_only: 'Validate Only',
}

// Backend statuses: pending → validating → validated → importing → completed | failed
const STATUS_BADGE_VARIANT: Record<string, 'outline' | 'success' | 'destructive' | 'warning'> = {
  pending:    'outline',
  validating: 'warning',
  validated:  'warning',
  importing:  'warning',
  completed:  'success',
  failed:     'destructive',
}

// ─── Step Indicator ────────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'download', label: 'Template' },
  { key: 'upload', label: 'Upload' },
  { key: 'validate', label: 'Validate' },
  { key: 'import', label: 'Import' },
  { key: 'complete', label: 'Complete' },
]

const STEP_ORDER: Step[] = ['download', 'upload', 'validate', 'import', 'complete']

function StepIndicator({ current }: { current: Step }) {
  const currentIdx = STEP_ORDER.indexOf(current)
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, idx) => {
        const done = idx < currentIdx
        const active = idx === currentIdx
        return (
          <React.Fragment key={step.key}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  'h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors',
                  done && 'bg-success border-success text-white',
                  active && 'bg-primary border-primary text-primary-foreground',
                  !done && !active && 'bg-muted border-border text-muted-foreground',
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <span>{idx + 1}</span>}
              </div>
              <span
                className={cn(
                  'text-[11px] font-medium',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-0.5 w-12 mb-5 mx-1 transition-colors',
                  idx < currentIdx ? 'bg-success' : 'bg-border',
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  variant: 'neutral' | 'success' | 'destructive' | 'warning'
}

function StatCard({ label, value, variant }: StatCardProps) {
  const colorMap = {
    neutral: 'text-foreground',
    success: 'text-success',
    destructive: 'text-destructive',
    warning: 'text-warning',
  }
  const bgMap = {
    neutral: 'bg-muted/50',
    success: 'bg-success/10',
    destructive: 'bg-destructive/10',
    warning: 'bg-warning/10',
  }
  return (
    <div className={cn('rounded-lg p-4 flex flex-col gap-1', bgMap[variant])}>
      <span className={cn('text-2xl font-bold', colorMap[variant])}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ImportWorkspace() {
  const { profile, isLoading: authLoading } = useAuthStore()
  const queryClient = useQueryClient()

  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  // ── Auth loading deadlock guard ───────────────────────────────────────────
  // authLoading stays true until external auth-init code calls setLoading(false).
  // If that call never arrives (network timeout, init error), the page spins forever.
  // After 5 s we release the gate and fall through to the role check.
  const [authTimedOut, setAuthTimedOut] = useState(false)
  useEffect(() => {
    if (!authLoading) return
    const t = setTimeout(() => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[ImportWorkspace] authLoading gate timed out after 5 s — proceeding with role check')
      }
      setAuthTimedOut(true)
    }, 5_000)
    return () => clearTimeout(t)
  }, [authLoading])

  // ── Initial Session — computed once per mount ─────────────────────────────
  // useRef keeps the value stable across re-renders without lazy-fn overhead.
  // The conditional write runs only on the first render (when current === undefined).
  const _initSnap = useRef<ImportSessionSnapshot | null | undefined>(undefined)
  if (_initSnap.current === undefined) _initSnap.current = findLatestSession()
  const initialSession = _initSnap.current

  // ── Global State ──────────────────────────────────────────────────────────
  // Initial values derived from the single initialSession read — no async race.
  const [selectedMaster, setSelectedMaster] = useState<MasterType | null>(initialSession?.masterType ?? null)
  // Collapse the master picker once a type is chosen so the workflow sits right
  // at the top (no scrolling past the full grid). Re-opened via "Change master".
  const [pickerOpen, setPickerOpen] = useState<boolean>(!initialSession?.masterType)
  const [currentStep, setCurrentStep] = useState<Step>(initialSession ? validateSessionStep(initialSession) : 'download')
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>(initialSession?.parsedRows ?? [])
  const [fileName, setFileName] = useState<string>(initialSession?.fileName ?? '')
  const [mode, setMode] = useState<Mode>(initialSession?.mode ?? 'upsert')
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(initialSession?.validationResult ?? null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('import')
  // True when a previous session was auto-applied on mount or master switch
  const [sessionRestoredNotice, setSessionRestoredNotice] = useState<boolean>(initialSession !== null)
  // Mutation timeout flags — set after deadline to expose cancel UI (set to false on mutation settle)
  const [validateTimedOut, setValidateTimedOut] = useState(false)
  const [importTimedOut, setImportTimedOut] = useState(false)

  // ── History Filters ───────────────────────────────────────────────────────
  const [historyMasterFilter, setHistoryMasterFilter] = useState<string>('all')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all')
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [errorPage, setErrorPage] = useState(1)

  // ── File Upload ───────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const masterConfig = selectedMaster ? MASTER_CONFIGS.find(m => m.type === selectedMaster) ?? null : null

  // ── Session Persistence ───────────────────────────────────────────────────
  // Ref mirror of current session-relevant state — read by the unmount cleanup
  // to save the latest snapshot without stale closure capture.
  const sessionStateRef = useRef({ selectedMaster, currentStep, fileName, mode, parsedRows, validationResult })
  useEffect(() => {
    sessionStateRef.current = { selectedMaster, currentStep, fileName, mode, parsedRows, validationResult }
  })

  // Auto-save on state changes. Guards: skip empty state, skip terminal steps.
  useEffect(() => {
    if (!selectedMaster) return
    if (currentStep === 'download' || currentStep === 'complete') return
    if (parsedRows.length === 0) return   // never persist blank state
    saveSession({
      masterType:      selectedMaster,
      step:            currentStep as Exclude<Step, 'download' | 'complete'>,
      fileName,
      mode,
      parsedRows,
      validationResult,
      savedAt:         Date.now(),
    })
  }, [selectedMaster, currentStep, fileName, mode, parsedRows, validationResult])

  // Save on route navigation / unmount — catches in-flight mutation state that
  // the auto-save effect may not have captured (mutation onSuccess fires async).
  useEffect(() => {
    return () => {
      const s = sessionStateRef.current
      if (!s.selectedMaster) return
      if (s.currentStep === 'download' || s.currentStep === 'complete') return
      if (s.parsedRows.length === 0) return
      saveSession({
        masterType:       s.selectedMaster,
        step:             s.currentStep as Exclude<Step, 'download' | 'complete'>,
        fileName:         s.fileName,
        mode:             s.mode,
        parsedRows:       s.parsedRows,
        validationResult: s.validationResult,
        savedAt:          Date.now(),
      })
    }
  }, [])

  // Navigation guard — warn before leaving when a file has been uploaded
  useEffect(() => {
    if (!(['upload', 'validate', 'import'] as Step[]).includes(currentStep) || !selectedMaster) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [currentStep, selectedMaster])

  // ── Step 1: Download Template ──────────────────────────────────────────────
  const [isDownloading, setIsDownloading] = useState(false)

  async function handleDownloadTemplate() {
    if (!selectedMaster) return
    setIsDownloading(true)
    try {
      const response = await api.getRaw(`/import/templates/${selectedMaster}`)
      const text = await response.text()
      const parsed = Papa.parse<string[]>(text, { header: false })
      const rows = parsed.data as string[][]

      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, 'Template')
      XLSX.writeFile(wb, `${selectedMaster}_import_template.xlsx`)
    } catch (err) {
      // Fallback: generate from MASTER_CONFIGS when API is unreachable.
      // Column names match templates.ts exactly (no * suffixes in header row).
      const cfg = MASTER_CONFIGS.find(m => m.type === selectedMaster)
      if (cfg) {
        const required = cfg.requiredFields
        const optional = cfg.optionalFields
        const headerRow = [
          ...required.map((f) => `${f} *`),   // * suffix = visual hint only
          ...optional,
        ]
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.aoa_to_sheet([
          // Instruction row (informational — delete before upload)
          ['# Required fields marked with *. Delete this row before uploading. Date format: YYYY-MM-DD.'],
          headerRow,
        ])
        XLSX.utils.book_append_sheet(wb, ws, 'Template')
        XLSX.writeFile(wb, `${selectedMaster}_import_template.xlsx`)
      }
    } finally {
      setIsDownloading(false)
    }
  }

  // ── Step 2: Parse File ─────────────────────────────────────────────────────

  /**
   * Normalise column names produced by the template download:
   *   - Strip trailing " *" (required-field marker added by generateCSV)
   *   - Trim whitespace
   * This ensures re-uploads of downloaded templates work without manual editing.
   */
  function normaliseKey(k: string): string {
    // Strip the trailing " *" required-marker, trim, and lower-case so header
    // casing from third-party editors (e.g. "Employee_Code") still matches the
    // lower-case snake_case keys every master template uses.
    return k.replace(/\s*\*\s*$/, '').trim().toLowerCase()
  }

  /**
   * Convert a parsed cell to a string. Excel stores dates as serial numbers;
   * with cellDates:true SheetJS hands us JS Date objects, which we normalise to
   * the YYYY-MM-DD the validator requires — otherwise an edited xlsx re-upload
   * fails with "Invalid date format".
   */
  function cellToString(cell: unknown): string {
    if (cell instanceof Date && !isNaN(cell.getTime())) {
      const y = cell.getFullYear()
      const m = String(cell.getMonth() + 1).padStart(2, '0')
      const d = String(cell.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    return String(cell ?? '')
  }

  function parseFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    setFileName(file.name)

    if (ext === 'csv') {
      // Pre-process: strip instruction comment rows (lines starting with #)
      file.text().then((text) => {
        const cleanedLines = text
          .split(/\r?\n/)
          .filter((line) => !line.trimStart().startsWith('#'))
          .join('\n')

        Papa.parse<Record<string, string>>(cleanedLines, {
          header: true,
          skipEmptyLines: true,
          transformHeader: normaliseKey,
          complete: (result) => {
            setParsedRows(result.data)
          },
        })
      })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const data = e.target?.result
        if (!data || !(data instanceof ArrayBuffer)) return
        const wb = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]

        // Get raw array-of-arrays to skip # comment rows before building objects
        const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]

        // Find the first non-comment row — that's the header
        const headerIdx = raw.findIndex(
          (row) => row.length > 0 && !String(row[0] ?? '').trimStart().startsWith('#'),
        )
        if (headerIdx === -1) { setParsedRows([]); return }

        const headers = raw[headerIdx].map((h) => normaliseKey(String(h)))
        const dataRows = raw.slice(headerIdx + 1).filter(
          (row) => row.some((cell) => String(cell ?? '').trim() !== '') &&
                   !String(row[0] ?? '').trimStart().startsWith('#'),
        )

        const rows: Record<string, string>[] = dataRows.map((row) => {
          const obj: Record<string, string> = {}
          headers.forEach((h, i) => { obj[h] = cellToString(row[i]) })
          return obj
        })
        setParsedRows(rows)
      }
      reader.readAsArrayBuffer(file)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() {
    setIsDragging(false)
  }

  // ── Step 3: Validate ───────────────────────────────────────────────────────
  const validateMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: BackendValidationResult }>('/import/validate', {
        masterType: selectedMaster,
        rows: parsedRows,
        mode,
      }),
    onSuccess: (response) => {
      const raw = response.data
      // Flatten per-row error arrays into individual display rows
      const data = flattenValidationRows(raw)
      setValidationResult(data)
      if (raw.invalidRows === 0) {
        toast.success('Validation passed', { description: `All ${raw.totalRows} rows are valid.` })
      } else {
        toast.success('Validation complete', { description: `${raw.invalidRows} row${raw.invalidRows !== 1 ? 's' : ''} have errors. Review before importing.` })
      }
    },
    onError: (e: Error) => toast.error('Validation failed', { description: e.message }),
  })

  const ERROR_PAGE_SIZE = 50
  const errorRows = validationResult?.rows ?? []
  const totalErrorPages = Math.ceil(errorRows.length / ERROR_PAGE_SIZE)
  const pagedErrorRows = errorRows.slice((errorPage - 1) * ERROR_PAGE_SIZE, errorPage * ERROR_PAGE_SIZE)

  function handleDownloadErrorReport() {
    if (!validationResult) return
    const csvRows = [
      ['Row #', 'Field', 'Error', 'Severity'],
      ...validationResult.rows.map(r => [String(r.rowNumber), r.field, r.error, r.severity]),
    ]
    const csvContent = Papa.unparse(csvRows)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedMaster}_validation_errors.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function handleDownloadFailureReport() {
    if (failedFlatRows.length === 0) return
    const csvRows = [
      ['Row #', 'Field', 'Error', 'Severity'],
      ...failedFlatRows.map(r => [String(r.rowNumber), r.field, r.error, r.severity]),
    ]
    const csvContent = Papa.unparse(csvRows)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedMaster}_import_failures_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // ── Step 4: Import ─────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: () =>
      api.post<{ data: ImportResult }>('/import/run', {
        masterType: selectedMaster,
        rows: parsedRows,
        fileName,
        mode,
      }),
    onSuccess: (response) => {
      if (selectedMaster) clearSession(selectedMaster)
      const data = response.data
      setImportResult(data)
      setCurrentStep('complete')
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] })

      // Bust the master-page cache so changes are visible immediately
      const MASTER_QUERY_KEYS: Record<string, string[]> = {
        grades:                ['grades'],
        departments:           ['departments'],
        designations:          ['designations'],
        cost_centers:          ['cost-centers'],
        work_locations:        ['work-locations'],
        sites:                 ['sites'],
        states:                ['states'],
        clusters:              ['clusters'],
        shifts:                ['shifts'],
        leave_types:           ['leave-types'],
        rosters:               ['rosters'],
        payroll_groups:        ['payroll-groups'],
        employment_categories: ['employment-categories'],
        statutory_groups:      ['statutory-groups'],
        asset_categories:      ['asset-categories'],
        salary_structures:     ['salary-structures'],
        holiday_calendar:      ['holiday-calendar'],
        employee_bank_details: ['employees'],
      }
      const keysToInvalidate = selectedMaster ? (MASTER_QUERY_KEYS[selectedMaster] ?? []) : []
      for (const k of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }

      toast.success('Import complete', {
        description: `${data.created} created, ${data.updated} updated, ${data.failed} failed.`,
      })
    },
    onError: (e: Error) => toast.error('Import failed', { description: e.message }),
  })

  // ── Mutation Timeout Guards ───────────────────────────────────────────────
  // If a mutation hangs indefinitely the spinner never clears. After the deadline
  // we expose a cancel UI so the user always has an escape hatch.
  useEffect(() => {
    if (!validateMutation.isPending) { setValidateTimedOut(false); return }
    const t = setTimeout(() => setValidateTimedOut(true), 60_000)
    return () => clearTimeout(t)
  }, [validateMutation.isPending])

  useEffect(() => {
    if (!importMutation.isPending) { setImportTimedOut(false); return }
    const t = setTimeout(() => setImportTimedOut(true), 120_000)
    return () => clearTimeout(t)
  }, [importMutation.isPending])

  // ── Dev-mode render gate trace ────────────────────────────────────────────
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    console.debug('[ImportWorkspace] render gate', {
      authLoading, authTimedOut, isAdmin, selectedMaster, currentStep,
      parsedRows: parsedRows.length, hasValidation: !!validationResult,
      sessionRestored: sessionRestoredNotice,
      validatePending: validateMutation.isPending, validateTimedOut,
      importPending: importMutation.isPending, importTimedOut,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, selectedMaster, parsedRows.length, authLoading, authTimedOut,
      validateMutation.isPending, importMutation.isPending, validateTimedOut, importTimedOut])

  // ── Import History ─────────────────────────────────────────────────────────
  // staleTime: 60 s so switching tabs (import → history → import → history) within
  // the window does not trigger a redundant refetch on every re-enable.
  // placeholderData: keepPreviousData keeps the jobs table visible (no blank flash)
  // while a background refresh runs after the stale window elapses.
  const { data: jobsData, isLoading: jobsLoading, isFetching: jobsFetching, isError: jobsError } = useQuery({
    queryKey: ['import-jobs'],
    queryFn: () => api.get<{ data: ImportJob[] }>('/import/jobs'),
    enabled: activeTab === 'history',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: 2,
  })

  const allJobs = jobsData?.data ?? []
  const filteredJobs = allJobs.filter(j => {
    const matchMaster = historyMasterFilter === 'all' || j.masterType === historyMasterFilter
    const matchStatus = historyStatusFilter === 'all' || j.status === historyStatusFilter
    return matchMaster && matchStatus
  })

  // ── Expanded Job Rows ──────────────────────────────────────────────────────
  // staleTime: 60 s — row errors for a completed job never change; caching prevents
  // a re-fetch every time the user collapses and re-expands the same job row.
  const { data: expandedRowsData, isLoading: expandedRowsLoading, isError: expandedRowsError } = useQuery({
    queryKey: ['import-job-rows', expandedJobId],
    queryFn: () =>
      api.get<{ data: ImportJobRow[] }>(`/import/jobs/${expandedJobId}/rows?status=invalid`),
    enabled: !!expandedJobId,
    staleTime: 60_000,
    retry: 1,
  })

  const expandedRows = expandedRowsData?.data ?? []
  const expandedFlatRows: FlatJobRow[] = expandedRows.flatMap(row => [
    ...(row.errors ?? []).map(e => ({ rowNumber: row.row_number, field: e.field, error: e.message, severity: e.severity })),
    ...(row.warnings ?? []).map(w => ({ rowNumber: row.row_number, field: w.field, error: w.message, severity: 'warning' as const })),
  ])

  // ── Complete Step — Failed Row Details ────────────────────────────────────
  // staleTime: 5 min — failed rows for a finished job are immutable; no need to
  // ever refetch unless the user explicitly resets and comes back via history.
  const { data: failedRowsData, isLoading: failedRowsLoading, isError: failedRowsError } = useQuery({
    queryKey: ['import-failed-rows', importResult?.importJobId],
    queryFn: () =>
      api.get<{ data: ImportJobRow[] }>(`/import/jobs/${importResult!.importJobId}/rows?status=failed&limit=100`),
    enabled: currentStep === 'complete' && !!importResult?.importJobId && (importResult?.failed ?? 0) > 0,
    staleTime: 5 * 60_000,
    retry: 2,
  })
  const failedFlatRows: FlatJobRow[] = (failedRowsData?.data ?? []).flatMap(row => [
    ...(row.errors ?? []).map(e => ({ rowNumber: row.row_number, field: e.field, error: e.message, severity: e.severity })),
    ...(row.warnings ?? []).map(w => ({ rowNumber: row.row_number, field: w.field, error: w.message, severity: 'warning' as const })),
  ])

  // ── Reset Workflow ─────────────────────────────────────────────────────────
  function resetWorkflow() {
    if (selectedMaster) clearSession(selectedMaster)
    validateMutation.reset()
    importMutation.reset()
    setCurrentStep('download')
    setParsedRows([])
    setFileName('')
    setMode('upsert')
    setValidationResult(null)
    setImportResult(null)
    setErrorPage(1)
    setSessionRestoredNotice(false)
  }

  function selectMaster(type: MasterType) {
    if (selectedMaster === type) return
    // Reset mutation state so prior validation/import errors don't bleed into the new master
    validateMutation.reset()
    importMutation.reset()
    setSelectedMaster(type)
    setPickerOpen(false)   // collapse picker → surface the workflow immediately
    const snap = loadSession(type)
    if (snap) {
      const safeStep = validateSessionStep(snap)
      setCurrentStep(safeStep)
      setFileName(snap.fileName)
      setMode(snap.mode)
      setParsedRows(snap.parsedRows)
      setValidationResult(snap.validationResult)
      setSessionRestoredNotice(true)
    } else {
      setCurrentStep('download')
      setParsedRows([])
      setFileName('')
      setMode('upsert')
      setValidationResult(null)
      setSessionRestoredNotice(false)
    }
    setImportResult(null)
    setErrorPage(1)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  // isLoading is true while Zustand persist middleware rehydrates the auth store.
  // Render a spinner rather than the access-restriction wall to avoid a false-negative flash.
  if (authLoading && !authTimedOut) {
    return (
      <PageContainer>
        <PageHeader title="Import" subtitle="Universal Master Import Framework" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    )
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Import" subtitle="Universal Master Import Framework" />
        <SectionCard>
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <XCircle className="h-10 w-10 text-destructive" />
            <p className="text-foreground font-medium">Access Restricted</p>
            <p className="text-sm text-muted-foreground">You need HR Admin or Super Admin role to access bulk import.</p>
          </div>
        </SectionCard>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Universal Import"
        subtitle="Bulk import master data from CSV or XLSX files"
        breadcrumb={[{ label: 'System' }, { label: 'Import' }]}
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
        <TabsList>
          <TabsTrigger value="import">
            <Upload className="h-4 w-4" />
            Import Data
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="h-4 w-4" />
            Import History
          </TabsTrigger>
        </TabsList>

        {/* ── Import Tab ─────────────────────────────────────────────────── */}
        {/* forceMount keeps the import workflow DOM (drag-drop, step indicator,
            master grid) mounted when the user switches to the History tab.
            Without forceMount, Radix unmounts the inactive TabsContent by default
            → switching back causes a full remount and visual flash even though
            parent-level state (parsedRows, currentStep, etc.) is preserved.
            The `hidden` class drives visibility via CSS — no remount. */}
        <TabsContent value="import" forceMount className={cn('space-y-4', activeTab !== 'import' && 'hidden')}>

          {/* Section 1: Master Type Selector — collapses once a type is picked */}
          {pickerOpen && (
          <SectionCard
            title="Select Master Type"
            description="Choose the data category you want to import"
            icon={<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}
            action={selectedMaster && (
              <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>Close</Button>
            )}
          >
            <div className="space-y-4">
              {IMPORT_GROUPS.map((group) => {
                const groupConfigs = MASTER_CONFIGS.filter(c => c.group === group.key)
                if (groupConfigs.length === 0) return null
                const accent = GROUP_ACCENT[group.key] ?? DEFAULT_ACCENT
                return (
                  <div key={group.key} className={cn('rounded-xl border p-3.5 space-y-3', accent.box)}>
                    {/* Group header */}
                    <div className="flex items-center justify-between gap-3">
                      <p className={cn('text-xs font-bold uppercase tracking-wider', accent.label)}>
                        {group.label}
                      </p>
                      {group.note && (
                        <span className="text-[10px] text-muted-foreground/60 italic shrink-0 truncate hidden sm:block">
                          {group.note}
                        </span>
                      )}
                    </div>

                    {/* Card grid — compact horizontal tiles */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                      {groupConfigs.map((cfg) => {
                        const Icon = cfg.icon
                        const isSelected = selectedMaster === cfg.type
                        return (
                          <button
                            key={cfg.type}
                            type="button"
                            onClick={() => selectMaster(cfg.type)}
                            title={cfg.description}
                            className={cn(
                              'group/card flex items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-all duration-150',
                              isSelected
                                ? 'border-primary ring-1 ring-primary/30 bg-primary/[0.04]'
                                : 'border-border/70 hover:border-primary/40 hover:shadow-sm',
                            )}
                          >
                            <div
                              className={cn(
                                'rounded-md p-1.5 shrink-0',
                                isSelected ? 'bg-primary/10 text-primary' : accent.icon,
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className={cn('text-[13px] font-semibold truncate', isSelected ? 'text-primary' : 'text-foreground')}>
                                  {cfg.label}
                                </p>
                                {cfg.groupStep && (
                                  <span className="text-[10px] font-bold text-muted-foreground/45 shrink-0 tabular-nums">
                                    #{cfg.groupStep}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-snug">{cfg.description}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
          )}

          {/* Collapsed selected-master bar — keeps the workflow at the top */}
          {!pickerOpen && selectedMaster && masterConfig && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="rounded-md bg-primary/10 p-1.5 text-primary shrink-0">
                  <masterConfig.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{masterConfig.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {IMPORT_GROUPS.find(g => g.key === masterConfig.group)?.label ?? 'Master data'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => setPickerOpen(true)}>
                <RotateCcw className="h-3.5 w-3.5" /> Change master
              </Button>
            </div>
          )}

          {/* Section 2: Import Workflow */}
          {selectedMaster && masterConfig && (
            <SectionCard
              title={`Import ${masterConfig.label}`}
              description="Follow the steps to validate and import your data"
              icon={<Upload className="h-4 w-4 text-muted-foreground" />}
              action={
                currentStep !== 'download' && (
                  <Button variant="ghost" size="sm" onClick={resetWorkflow}>
                    <RotateCcw className="h-4 w-4" />
                    Start Over
                  </Button>
                )
              }
            >
              {/* Session restored notice — auto-applied, no manual resume needed */}
              {sessionRestoredNotice && fileName && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <RotateCcw className="h-4 w-4 text-primary flex-shrink-0" />
                    <span className="text-sm text-foreground truncate">
                      Session restored:&nbsp;<span className="font-mono text-xs">{fileName}</span>
                      &nbsp;—&nbsp;resuming from&nbsp;<span className="font-medium capitalize">{currentStep}</span> step
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSessionRestoredNotice(false)}>
                    Dismiss
                  </Button>
                </div>
              )}

              {/* Step Indicator */}
              <div className="flex justify-center mb-8">
                <StepIndicator current={currentStep} />
              </div>

              {/* Step 1: Download Template */}
              {currentStep === 'download' && (
                <div className="space-y-5">
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="rounded-full bg-primary/10 p-3">
                      <Download className="h-8 w-8 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="text-foreground font-medium">Download the Import Template</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Use this template to prepare your data. Required fields are marked with *.
                      </p>
                    </div>
                    <Button onClick={handleDownloadTemplate} disabled={isDownloading}>
                      {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {isDownloading ? 'Downloading...' : 'Download Sample Template'}
                    </Button>
                  </div>

                  {/* Field list */}
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                      Template Fields — {masterConfig.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {masterConfig.requiredFields.map(f => (
                        <Badge key={f} variant="default" className="font-mono text-xs">
                          {f} *
                        </Badge>
                      ))}
                      {masterConfig.optionalFields.map(f => (
                        <Badge key={f} variant="outline" className="font-mono text-xs">
                          {f}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">* Required fields</p>
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={() => setCurrentStep('upload')}>
                      Next: Upload File
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 2: Upload File */}
              {currentStep === 'upload' && (
                <div className="space-y-5">
                  {/* Drag-and-drop zone */}
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors',
                      isDragging
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50 hover:bg-muted/40',
                    )}
                  >
                    <div className={cn('rounded-full p-3', isDragging ? 'bg-primary/10' : 'bg-muted')}>
                      <Upload className={cn('h-6 w-6', isDragging ? 'text-primary' : 'text-muted-foreground')} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {isDragging ? 'Drop your file here' : 'Drag & drop or click to upload'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Supports .csv and .xlsx files</p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>

                  {/* File preview */}
                  {fileName && parsedRows.length > 0 && (
                    <div className="rounded-lg border border-success/30 bg-success/5 p-4 flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
                        <p className="text-xs text-muted-foreground">{parsedRows.length} rows parsed successfully</p>
                      </div>
                      <Badge variant="success">{parsedRows.length} rows</Badge>
                    </div>
                  )}

                  {/* Import Mode */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Import Mode</label>
                    <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                      <SelectTrigger className="w-full sm:w-72">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(MODE_LABELS) as [Mode, string][]).map(([key, label]) => (
                          <SelectItem key={key} value={key}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {mode === 'upsert'        && 'Creates new records and updates existing ones based on unique identifiers.'}
                      {mode === 'create_only'   && 'Only creates new records. Existing records are skipped.'}
                      {mode === 'update_only'   && 'Only updates existing records. New records are skipped.'}
                      {mode === 'validate_only' && 'Validates data without making any changes to the database.'}
                    </p>
                  </div>

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setCurrentStep('download')}>
                      Back
                    </Button>
                    <Button
                      onClick={() => setCurrentStep('validate')}
                      disabled={parsedRows.length === 0}
                    >
                      Next: Validate
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Validate */}
              {currentStep === 'validate' && (
                <div className="space-y-5">
                  {/* Run Validation CTA */}
                  {!validationResult && !validateMutation.isPending && (
                    parsedRows.length === 0 ? (
                      // Impossible state guard: arrived at validate with no rows
                      // (session demote should prevent this, but defend explicitly)
                      <div className="flex flex-col items-center gap-4 py-6">
                        <div className="rounded-full bg-warning/10 p-3">
                          <AlertTriangle className="h-8 w-8 text-warning" />
                        </div>
                        <div className="text-center">
                          <p className="text-foreground font-medium">No Data to Validate</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Go back and upload a file before running validation.
                          </p>
                        </div>
                        <Button variant="outline" onClick={() => setCurrentStep('upload')}>
                          Back to Upload
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4 py-6">
                        <div className="rounded-full bg-warning/10 p-3">
                          <CheckCircle2 className="h-8 w-8 text-warning" />
                        </div>
                        <div className="text-center">
                          <p className="text-foreground font-medium">Ready to Validate</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {parsedRows.length} rows from <span className="font-mono">{fileName}</span> will be checked
                          </p>
                        </div>
                        <Button onClick={() => validateMutation.mutate()}>
                          <CheckCircle2 className="h-4 w-4" />
                          Run Validation
                        </Button>
                      </div>
                    )
                  )}

                  {validateMutation.isPending && (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Validating rows…</p>
                      {validateTimedOut && (
                        <div className="flex flex-col items-center gap-2 mt-2">
                          <p className="text-xs text-warning">Taking longer than expected. The server may be slow.</p>
                          <Button variant="outline" size="sm" onClick={() => validateMutation.reset()}>
                            Cancel and Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {validateMutation.isError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
                      <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                      <p className="text-sm text-destructive">{(validateMutation.error as Error).message}</p>
                    </div>
                  )}

                  {/* Validation Result */}
                  {validationResult && (
                    <div className="space-y-4">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard label="Total Rows" value={validationResult.totalRows} variant="neutral" />
                        <StatCard label="Valid Rows" value={validationResult.validRows} variant="success" />
                        <StatCard label="Invalid Rows" value={validationResult.invalidRows} variant="destructive" />
                        <StatCard label="Duplicates" value={validationResult.duplicateRows ?? 0} variant="warning" />
                      </div>

                      {/* Success state */}
                      {validationResult.invalidRows === 0 && (
                        <div className="rounded-lg border border-success/30 bg-success/5 p-4 flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-success" />
                          <p className="text-sm font-medium text-success">
                            All {validationResult.totalRows} rows passed validation.
                          </p>
                        </div>
                      )}

                      {/* Error Table */}
                      {validationResult.invalidRows > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">
                              Validation Errors ({validationResult.rows.length})
                            </p>
                            <Button variant="outline" size="sm" onClick={handleDownloadErrorReport}>
                              <Download className="h-4 w-4" />
                              Download Error Report
                            </Button>
                          </div>

                          <div className="rounded-lg border border-border overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border bg-muted/50">
                                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-16">Row #</th>
                                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Field</th>
                                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Error</th>
                                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-24">Severity</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pagedErrorRows.map((row, i) => (
                                  <tr
                                    key={`${row.rowNumber}-${row.field}-${i}`}
                                    className={cn(
                                      'border-b border-border last:border-0',
                                      row.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5',
                                    )}
                                  >
                                    <td className="px-3 py-2 text-muted-foreground font-mono">{row.rowNumber}</td>
                                    <td className="px-3 py-2 font-mono text-xs text-foreground">{row.field}</td>
                                    <td className="px-3 py-2 text-foreground">{row.error}</td>
                                    <td className="px-3 py-2">
                                      <Badge variant={row.severity === 'error' ? 'destructive' : 'warning'}>
                                        {row.severity}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Pagination */}
                          {totalErrorPages > 1 && (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>
                                Page {errorPage} of {totalErrorPages} ({validationResult.rows.length} errors)
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={errorPage === 1}
                                  onClick={() => setErrorPage(p => p - 1)}
                                >
                                  Previous
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={errorPage === totalErrorPages}
                                  onClick={() => setErrorPage(p => p + 1)}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Re-run */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setValidationResult(null); validateMutation.reset() }}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Re-run Validation
                      </Button>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setCurrentStep('upload')}>
                      Back
                    </Button>
                    <Button
                      onClick={() => setCurrentStep('import')}
                      disabled={!validationResult || mode === 'validate_only'}
                    >
                      Next: Import
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Import */}
              {currentStep === 'import' && (
                <div className="space-y-5">
                  {/* Show summary+action whenever not running — isSuccess is excluded because
                      currentStep transitions to 'complete' atomically with isSuccess=true in
                      React 18 batching, so checking it here only creates a blank-panel race. */}
                  {!importMutation.isPending && (
                    <>
                      {/* Summary */}
                      <div className="rounded-lg border border-border bg-muted/30 p-5 space-y-3">
                        <p className="text-sm font-semibold text-foreground">Import Summary</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-muted-foreground">Master Type</span>
                            <p className="font-medium text-foreground capitalize mt-0.5">
                              {masterConfig.label}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total Rows</span>
                            <p className="font-medium text-foreground mt-0.5">{parsedRows.length}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Valid Rows</span>
                            <p className="font-medium text-success mt-0.5">
                              {validationResult?.validRows ?? parsedRows.length}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">File</span>
                            <p className="font-mono text-xs text-foreground mt-0.5 truncate">{fileName}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Mode</span>
                            <div className="mt-0.5">
                              <Badge variant="info">{MODE_LABELS[mode]}</Badge>
                            </div>
                          </div>
                        </div>
                      </div>

                      {importMutation.isError && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
                          <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                          <p className="text-sm text-destructive">{(importMutation.error as Error).message}</p>
                        </div>
                      )}

                      <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setCurrentStep('validate')}>
                          Back
                        </Button>
                        <Button onClick={() => importMutation.mutate()}>
                          <Upload className="h-4 w-4" />
                          Run Import
                        </Button>
                      </div>
                    </>
                  )}

                  {importMutation.isPending && (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Importing data, please wait…</p>
                      {importTimedOut && (
                        <div className="flex flex-col items-center gap-2 mt-2">
                          <p className="text-xs text-warning">This is taking longer than expected.</p>
                          <p className="text-xs text-muted-foreground">The import may still be running server-side. Check Import History before retrying.</p>
                          <Button variant="outline" size="sm" onClick={() => { importMutation.reset(); setCurrentStep('import') }}>
                            Dismiss and Check History
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Complete — importResult is ephemeral (not persisted).
                  On refresh the session clears and step resets to download, so this
                  fallback only fires in the edge case where importResult is lost
                  while currentStep somehow remains 'complete'. */}
              {currentStep === 'complete' && !importResult && (
                <div className="flex flex-col items-center gap-4 py-10">
                  <CheckCircle2 className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Import finished. Check Import History for results.</p>
                  <Button variant="outline" onClick={resetWorkflow}>
                    <RotateCcw className="h-4 w-4" />
                    Start New Import
                  </Button>
                </div>
              )}

              {currentStep === 'complete' && importResult && (
                <div className="space-y-5">
                  {importResult.failed === 0 ? (
                    <div className="flex flex-col items-center gap-4 py-4">
                      <div className="rounded-full bg-success/10 p-5">
                        <CheckCircle2 className="h-10 w-10 text-success" />
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-foreground">Import Complete!</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          All <span className="font-semibold">{masterConfig.label}</span> rows imported successfully.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 py-4">
                      <div className="rounded-full bg-warning/10 p-5">
                        <AlertTriangle className="h-10 w-10 text-warning" />
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-foreground">Import Completed with Errors</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          <span className="font-semibold text-destructive">{importResult.failed} rows failed</span>
                          {importResult.created > 0 && `, ${importResult.created} created`}
                          {importResult.updated > 0 && `, ${importResult.updated} updated`}
                          {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Result cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Created" value={importResult.created} variant="success" />
                    <StatCard label="Updated" value={importResult.updated} variant="neutral" />
                    <StatCard label="Failed" value={importResult.failed} variant="destructive" />
                    <StatCard label="Skipped" value={importResult.skipped} variant="warning" />
                  </div>

                  {/* Failed row loading indicator */}
                  {importResult.failed > 0 && failedRowsLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading failure details…
                    </div>
                  )}
                  {importResult.failed > 0 && failedRowsError && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                      Could not load failure details. Check Import History for row-level errors.
                    </div>
                  )}

                  {/* Failed row details */}
                  {importResult.failed > 0 && failedFlatRows.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">
                          Failed Rows ({failedFlatRows.length})
                        </p>
                        <Button variant="outline" size="sm" onClick={handleDownloadFailureReport}>
                          <Download className="h-4 w-4" />
                          Download Failure Report
                        </Button>
                      </div>
                      <div className="rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/50">
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-16">Row #</th>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Field</th>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Error</th>
                              <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground w-24">Severity</th>
                            </tr>
                          </thead>
                          <tbody>
                            {failedFlatRows.map((row, i) => (
                              <tr key={`${row.rowNumber}-${row.field}-${i}`} className="border-b border-border last:border-0 bg-destructive/5">
                                <td className="px-3 py-2 text-muted-foreground font-mono">{row.rowNumber}</td>
                                <td className="px-3 py-2 font-mono text-xs text-foreground">{row.field}</td>
                                <td className="px-3 py-2 text-foreground">{row.error}</td>
                                <td className="px-3 py-2">
                                  <Badge variant={row.severity === 'error' ? 'destructive' : 'warning'}>
                                    {row.severity}
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 justify-center">
                    <Button variant="outline" onClick={resetWorkflow}>
                      <RotateCcw className="h-4 w-4" />
                      Import More
                    </Button>
                    <Button onClick={() => { setActiveTab('history'); resetWorkflow() }}>
                      <History className="h-4 w-4" />
                      View Import History
                    </Button>
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </TabsContent>

        {/* ── History Tab ────────────────────────────────────────────────── */}
        {/* Same forceMount strategy — keeps history table mounted so the jobs
            query result is never discarded when switching back to the import tab. */}
        <TabsContent value="history" forceMount className={cn('space-y-4', activeTab !== 'history' && 'hidden')}>
          <SectionCard
            title="Import History"
            description="All import jobs across master types"
            icon={<History className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button
                variant="outline"
                size="sm"
                disabled={jobsFetching}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['import-jobs'], exact: true })}
              >
                {jobsFetching
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />
                }
                Refresh
              </Button>
            }
          >
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Filters:</span>
              </div>
              <Select value={historyMasterFilter} onValueChange={setHistoryMasterFilter}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="All Master Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Master Types</SelectItem>
                  {MASTER_CONFIGS.map(cfg => (
                    <SelectItem key={cfg.type} value={cfg.type}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={historyStatusFilter} onValueChange={setHistoryStatusFilter}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="validating">Validating</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Jobs Table */}
            {jobsLoading ? (
              <div className="flex items-center justify-center py-8 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading import history…</span>
              </div>
            ) : jobsError ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                <XCircle className="h-8 w-8 text-destructive/50" />
                <p className="text-sm text-muted-foreground">Failed to load import history.</p>
                <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['import-jobs'], exact: true })}>
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <History className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No import jobs found.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Date</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Master Type</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">File</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Mode</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Total</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Valid</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Created</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Updated</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Failed</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Status</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredJobs.map((job) => {
                        const isExpanded = expandedJobId === job.id
                        const masterLabel = MASTER_CONFIGS.find(m => m.type === job.masterType)?.label ?? job.masterType
                        return (
                          <React.Fragment key={job.id}>
                            <tr
                              className={cn(
                                'border-b border-border last:border-0 cursor-pointer transition-colors',
                                isExpanded ? 'bg-muted/50' : 'hover:bg-muted/30',
                              )}
                              onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                            >
                              <td className="px-3 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                                {(() => { const _d = new Date(job.createdAt); const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return isNaN(_d.getTime()) ? '—' : `${String(_d.getUTCDate()).padStart(2,'0')}-${_M[_d.getUTCMonth()]}-${_d.getUTCFullYear()}` })()}{' '}
                                <span className="text-muted-foreground/60">
                                  {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 font-medium text-foreground">{masterLabel}</td>
                              <td className="px-3 py-2.5 text-muted-foreground font-mono text-xs max-w-[140px] truncate">
                                {job.fileName}
                              </td>
                              <td className="px-3 py-2.5">
                                <Badge variant="outline" className="text-xs">{MODE_LABELS[job.mode]}</Badge>
                              </td>
                              <td className="px-3 py-2.5 text-right text-foreground">{job.totalRows}</td>
                              <td className="px-3 py-2.5 text-right text-success">{job.validRows}</td>
                              <td className="px-3 py-2.5 text-right text-success">{job.created}</td>
                              <td className="px-3 py-2.5 text-right text-foreground">{job.updated}</td>
                              <td className="px-3 py-2.5 text-right text-destructive">{job.failed}</td>
                              <td className="px-3 py-2.5">
                                <Badge variant={STATUS_BADGE_VARIANT[job.status]} className="capitalize">
                                  {job.status}
                                </Badge>
                              </td>
                              <td className="px-3 py-2.5 text-right text-muted-foreground text-xs">
                                {job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}s` : '—'}
                              </td>
                            </tr>

                            {/* Expanded row errors */}
                            {isExpanded && (
                              <tr className="border-b border-border bg-muted/20">
                                <td colSpan={11} className="px-4 py-3">
                                  {expandedRowsLoading ? (
                                    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Loading error details…
                                    </div>
                                  ) : expandedRowsError ? (
                                    <div className="flex items-center gap-2 py-2 text-xs text-destructive">
                                      <XCircle className="h-3 w-3" />
                                      Could not load row errors.
                                    </div>
                                  ) : expandedFlatRows.length === 0 ? (
                                    <p className="text-xs text-muted-foreground py-2">
                                      No errors recorded for this import job.
                                    </p>
                                  ) : (
                                    <div className="rounded-md border border-border overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-muted/60 border-b border-border">
                                            <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Row #</th>
                                            <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Field</th>
                                            <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Error</th>
                                            <th className="px-3 py-2 text-left text-muted-foreground font-semibold">Severity</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {expandedFlatRows.map((row, i) => (
                                            <tr
                                              key={`${row.rowNumber}-${row.field}-${i}`}
                                              className={cn(
                                                'border-b border-border last:border-0',
                                                row.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5',
                                              )}
                                            >
                                              <td className="px-3 py-1.5 font-mono text-muted-foreground">{row.rowNumber}</td>
                                              <td className="px-3 py-1.5 font-mono text-foreground">{row.field}</td>
                                              <td className="px-3 py-1.5 text-foreground">{row.error}</td>
                                              <td className="px-3 py-1.5">
                                                <Badge variant={row.severity === 'error' ? 'destructive' : 'warning'}>
                                                  {row.severity}
                                                </Badge>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
