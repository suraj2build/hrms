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
import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import {
  Users,
  Clock,
  Building2,
  Briefcase,
  MapPin,
  DollarSign,
  Umbrella,
  Sun,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  FileSpreadsheet,
  ChevronRight,
  Loader2,
  RotateCcw,
  History,
  RefreshCw,
  Filter,
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
  | 'employees'
  | 'shifts'
  | 'departments'
  | 'designations'
  | 'work_locations'
  | 'cost_centers'
  | 'salary_components'
  | 'leave_types'
  | 'holiday_calendar'

type Step = 'download' | 'upload' | 'validate' | 'import' | 'complete'
type Mode = 'upsert' | 'create' | 'update' | 'validate_only'
type ActiveTab = 'import' | 'history'

interface ValidationRow {
  rowNumber: number
  field: string
  error: string
  severity: 'error' | 'warning'
}

interface ValidationResult {
  totalRows: number
  validRows: number
  invalidRows: number
  duplicateRows?: number
  rows: ValidationRow[]
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
  rowNumber: number
  status: 'valid' | 'invalid' | 'skipped'
  field?: string
  error?: string
  severity?: 'error' | 'warning'
}

// ─── Master Config ─────────────────────────────────────────────────────────────

interface MasterConfig {
  type: MasterType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  requiredFields: string[]
  optionalFields: string[]
}

const MASTER_CONFIGS: MasterConfig[] = [
  {
    type: 'employees',
    label: 'Employees',
    description: 'Bulk import employee records with personal and job details',
    icon: Users,
    requiredFields: ['employee_code', 'first_name', 'last_name', 'email', 'department', 'designation'],
    optionalFields: ['phone', 'date_of_birth', 'date_of_joining', 'work_location', 'manager_code'],
  },
  {
    type: 'shifts',
    label: 'Shifts',
    description: 'Define work shift schedules and timing configurations',
    icon: Clock,
    requiredFields: ['shift_code', 'shift_name', 'start_time', 'end_time'],
    optionalFields: ['grace_in', 'grace_out', 'break_duration', 'is_night_shift'],
  },
  {
    type: 'departments',
    label: 'Departments',
    description: 'Organisational units and department hierarchy',
    icon: Building2,
    requiredFields: ['department_code', 'department_name'],
    optionalFields: ['parent_department', 'cost_center', 'head_employee_code'],
  },
  {
    type: 'designations',
    label: 'Designations',
    description: 'Job titles and designation grade mappings',
    icon: Briefcase,
    requiredFields: ['designation_code', 'designation_name'],
    optionalFields: ['grade', 'department', 'is_manager_role'],
  },
  {
    type: 'work_locations',
    label: 'Work Locations',
    description: 'Office sites, branches and remote work setups',
    icon: MapPin,
    requiredFields: ['location_code', 'location_name', 'city', 'country'],
    optionalFields: ['address', 'state', 'pin_code', 'timezone'],
  },
  {
    type: 'cost_centers',
    label: 'Cost Centers',
    description: 'Financial cost centers for payroll allocation',
    icon: DollarSign,
    requiredFields: ['cost_center_code', 'cost_center_name'],
    optionalFields: ['parent_cost_center', 'gl_code', 'description'],
  },
  {
    type: 'salary_components',
    label: 'Salary Components',
    description: 'Earnings, deductions and reimbursement components',
    icon: DollarSign,
    requiredFields: ['component_code', 'component_name', 'type'],
    optionalFields: ['calculation_type', 'is_taxable', 'is_pf_applicable', 'sequence'],
  },
  {
    type: 'leave_types',
    label: 'Leave Types',
    description: 'Leave policies, accrual rules and approval flows',
    icon: Umbrella,
    requiredFields: ['leave_code', 'leave_name', 'annual_quota'],
    optionalFields: ['carry_forward_limit', 'encashable', 'half_day_allowed', 'approval_levels'],
  },
  {
    type: 'holiday_calendar',
    label: 'Holiday Calendar',
    description: 'Public and restricted holidays by location or policy',
    icon: Sun,
    requiredFields: ['holiday_date', 'holiday_name', 'holiday_type'],
    optionalFields: ['applicable_locations', 'description', 'is_optional'],
  },
]

const MODE_LABELS: Record<Mode, string> = {
  upsert: 'Create + Update (Upsert)',
  create: 'Create Only',
  update: 'Update Only',
  validate_only: 'Validate Only',
}

const STATUS_BADGE_VARIANT: Record<ImportJob['status'], 'outline' | 'success' | 'destructive' | 'warning'> = {
  pending: 'outline',
  completed: 'success',
  failed: 'destructive',
  validating: 'warning',
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
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()

  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  // ── Global State ──────────────────────────────────────────────────────────
  const [selectedMaster, setSelectedMaster] = useState<MasterType | null>(null)
  const [currentStep, setCurrentStep] = useState<Step>('download')
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<Mode>('upsert')
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('import')

  // ── History Filters ───────────────────────────────────────────────────────
  const [historyMasterFilter, setHistoryMasterFilter] = useState<string>('all')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all')
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [errorPage, setErrorPage] = useState(1)

  // ── File Upload ───────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const masterConfig = selectedMaster ? MASTER_CONFIGS.find(m => m.type === selectedMaster) ?? null : null

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
      // fallback: generate from known fields
      const cfg = MASTER_CONFIGS.find(m => m.type === selectedMaster)
      if (cfg) {
        const headers = [...cfg.requiredFields, ...cfg.optionalFields]
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.aoa_to_sheet([headers])
        XLSX.utils.book_append_sheet(wb, ws, 'Template')
        XLSX.writeFile(wb, `${selectedMaster}_import_template.xlsx`)
      }
    } finally {
      setIsDownloading(false)
    }
  }

  // ── Step 2: Parse File ─────────────────────────────────────────────────────
  function parseFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase()
    setFileName(file.name)

    if (ext === 'csv') {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          setParsedRows(result.data)
        },
      })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        const data = e.target?.result
        if (!data) return
        const wb = XLSX.read(data, { type: 'binary' })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
        setParsedRows(rows)
      }
      reader.readAsBinaryString(file)
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
      api.post<ValidationResult>('/import/validate', {
        masterType: selectedMaster,
        rows: parsedRows,
        mode,
      }),
    onSuccess: (data) => {
      setValidationResult(data)
      if (data.invalidRows === 0) {
        toast.success('Validation passed', { description: `All ${data.totalRows} rows are valid.` })
      } else {
        toast.success('Validation complete', { description: `${data.invalidRows} row${data.invalidRows !== 1 ? 's' : ''} have errors. Review before importing.` })
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

  // ── Step 4: Import ─────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: () =>
      api.post<ImportResult>('/import/run', {
        masterType: selectedMaster,
        rows: parsedRows,
        fileName,
        mode,
      }),
    onSuccess: (data) => {
      setImportResult(data)
      setCurrentStep('complete')
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] })
      toast.success('Import complete', {
        description: `${data.created} created, ${data.updated} updated, ${data.failed} failed.`,
      })
    },
    onError: (e: Error) => toast.error('Import failed', { description: e.message }),
  })

  // ── Import History ─────────────────────────────────────────────────────────
  const { data: jobsData, isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['import-jobs'],
    queryFn: () => api.get<{ data: ImportJob[] }>('/import/jobs'),
    enabled: activeTab === 'history',
  })

  const allJobs = jobsData?.data ?? []
  const filteredJobs = allJobs.filter(j => {
    const matchMaster = historyMasterFilter === 'all' || j.masterType === historyMasterFilter
    const matchStatus = historyStatusFilter === 'all' || j.status === historyStatusFilter
    return matchMaster && matchStatus
  })

  // ── Expanded Job Rows ──────────────────────────────────────────────────────
  const { data: expandedRowsData } = useQuery({
    queryKey: ['import-job-rows', expandedJobId],
    queryFn: () =>
      api.get<{ data: ImportJobRow[] }>(`/import/jobs/${expandedJobId}/rows?status=invalid`),
    enabled: !!expandedJobId,
  })

  const expandedRows = expandedRowsData?.data ?? []

  // ── Reset Workflow ─────────────────────────────────────────────────────────
  function resetWorkflow() {
    setCurrentStep('download')
    setParsedRows([])
    setFileName('')
    setMode('upsert')
    setValidationResult(null)
    setImportResult(null)
    setErrorPage(1)
  }

  function selectMaster(type: MasterType) {
    if (selectedMaster !== type) {
      setSelectedMaster(type)
      resetWorkflow()
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
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
        <TabsContent value="import" className="space-y-6">

          {/* Section 1: Master Type Selector */}
          <SectionCard
            title="Select Master Type"
            description="Choose the data category you want to import"
            icon={<FileSpreadsheet className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 gap-3">
              {MASTER_CONFIGS.map((cfg) => {
                const Icon = cfg.icon
                const isSelected = selectedMaster === cfg.type
                return (
                  <button
                    key={cfg.type}
                    type="button"
                    onClick={() => selectMaster(cfg.type)}
                    className={cn(
                      'flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all duration-150',
                      'hover:border-primary/60 hover:bg-muted/40',
                      isSelected
                        ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                        : 'border-border bg-card',
                    )}
                  >
                    <div
                      className={cn(
                        'rounded-md p-2',
                        isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className={cn('text-sm font-semibold', isSelected ? 'text-primary' : 'text-foreground')}>
                        {cfg.label}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{cfg.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </SectionCard>

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
              {/* Step Indicator */}
              <div className="flex justify-center mb-8">
                <StepIndicator current={currentStep} />
              </div>

              {/* Step 1: Download Template */}
              {currentStep === 'download' && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="rounded-full bg-primary/10 p-4">
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
                <div className="space-y-6">
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
                      {mode === 'upsert' && 'Creates new records and updates existing ones based on unique identifiers.'}
                      {mode === 'create' && 'Only creates new records. Existing records are skipped.'}
                      {mode === 'update' && 'Only updates existing records. New records are skipped.'}
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
                <div className="space-y-6">
                  {/* Run Validation CTA */}
                  {!validationResult && !validateMutation.isPending && (
                    <div className="flex flex-col items-center gap-4 py-6">
                      <div className="rounded-full bg-warning/10 p-4">
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
                  )}

                  {validateMutation.isPending && (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Validating rows…</p>
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
                                    key={i}
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
                <div className="space-y-6">
                  {!importMutation.isPending && !importMutation.isSuccess && (
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
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Complete */}
              {currentStep === 'complete' && importResult && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="rounded-full bg-success/10 p-5">
                      <CheckCircle2 className="h-10 w-10 text-success" />
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-foreground">Import Complete!</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Your <span className="font-semibold">{masterConfig.label}</span> data has been imported successfully.
                      </p>
                    </div>
                  </div>

                  {/* Result cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label="Created" value={importResult.created} variant="success" />
                    <StatCard label="Updated" value={importResult.updated} variant="neutral" />
                    <StatCard label="Failed" value={importResult.failed} variant="destructive" />
                    <StatCard label="Skipped" value={importResult.skipped} variant="warning" />
                  </div>

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
        <TabsContent value="history" className="space-y-4">
          <SectionCard
            title="Import History"
            description="All import jobs across master types"
            icon={<History className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button variant="outline" size="sm" onClick={() => refetchJobs()}>
                <RefreshCw className="h-4 w-4" />
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
              <div className="flex items-center justify-center py-10 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading import history…</span>
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
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
                                {new Date(job.createdAt).toLocaleDateString()}{' '}
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
                                  {expandedRows.length === 0 ? (
                                    <p className="text-xs text-muted-foreground py-2">
                                      {job.failed === 0 ? 'No errors for this import job.' : 'Loading error details…'}
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
                                          {expandedRows.map((row, i) => (
                                            <tr
                                              key={i}
                                              className={cn(
                                                'border-b border-border last:border-0',
                                                row.severity === 'error' ? 'bg-destructive/5' : 'bg-warning/5',
                                              )}
                                            >
                                              <td className="px-3 py-1.5 font-mono text-muted-foreground">{row.rowNumber}</td>
                                              <td className="px-3 py-1.5 font-mono text-foreground">{row.field ?? '—'}</td>
                                              <td className="px-3 py-1.5 text-foreground">{row.error ?? '—'}</td>
                                              <td className="px-3 py-1.5">
                                                {row.severity && (
                                                  <Badge variant={row.severity === 'error' ? 'destructive' : 'warning'}>
                                                    {row.severity}
                                                  </Badge>
                                                )}
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
