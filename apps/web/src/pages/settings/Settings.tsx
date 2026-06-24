/**
 * Company Settings — /admin/settings
 *
 * Sections:
 *   1. Company Profile    — name, industry, size, country, timezone (editable)
 *   2. Company Logo       — upload / preview
 *   3. Employee Code      — prefix configuration with live preview
 *   4. Getting Started    — checklist of first-time setup items
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Upload, CheckCircle2, Circle,
  Hash, RefreshCw, AlertCircle, Globe,
  ArrowRight, Pencil, X, Check,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge }        from '@/components/ui/badge'
import { Button }       from '@/components/ui/button'
import { PageHeader }   from '@/components/layout/PageHeader'
import { useAuthStore } from '@/stores/authStore'
import { api }          from '@/lib/api/client'
import { uploadCompanyLogo, getSignedUrl } from '@/lib/supabase-storage'
import { toast }        from 'sonner'
import { cn }           from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SetupChecklist {
  departments:       number
  designations:      number
  grades:            number
  sites:             number
  work_locations:    number
  leave_types:       number
  salary_components: number
}

interface CompanyData {
  id:           string
  name:         string
  slug:         string
  plan:         string
  logo_url:     string | null
  industry:     string | null
  size_range:   string | null
  country:      string | null
  timezone:     string | null
  settings:     Record<string, unknown>
  employee_code: {
    prefix:      string
    last_number: number
    example:     string
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  'Technology','Retail','Manufacturing','Healthcare','Finance',
  'Education','Hospitality','Construction','Logistics','Media',
  'Consulting','Other',
]

const SIZE_RANGES = ['1-10','11-50','51-200','201-500','501-2000','2001-5000','5001+']

const TIMEZONES = [
  { value: 'Asia/Kolkata',      label: 'IST — India (UTC+5:30)'          },
  { value: 'UTC',               label: 'UTC — Coordinated Universal Time' },
  { value: 'Asia/Dubai',        label: 'GST — Gulf Standard (UTC+4)'     },
  { value: 'Asia/Singapore',    label: 'SGT — Singapore (UTC+8)'         },
  { value: 'Europe/London',     label: 'GMT — London (UTC+0)'            },
  { value: 'America/New_York',  label: 'EST — New York (UTC-5)'          },
  { value: 'America/Los_Angeles','label': 'PST — Los Angeles (UTC-8)'    },
  { value: 'Australia/Sydney',  label: 'AEST — Sydney (UTC+10)'          },
]

// ── Logo display helper ────────────────────────────────────────────────────────

function useLogo(logoPath: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!logoPath) { setUrl(null); return }
    // If it's already a full URL (http/data), use directly
    if (logoPath.startsWith('http') || logoPath.startsWith('data:')) {
      setUrl(logoPath); return
    }
    // Otherwise it's a storage path — get a signed URL
    getSignedUrl(logoPath, 3600).then(setUrl).catch(() => setUrl(null))
  }, [logoPath])

  return url
}

// ── Getting Started checklist items ───────────────────────────────────────────

// section key → the section items map to (null = different page, navigate normally)
const SECTION_KEYS: Record<string, string> = {
  '/admin/settings?focus=logo':    'logo',
  '/admin/settings?focus=company': 'company',
  '/admin/settings?focus=empcode': 'empcode',
}

function GettingStarted({
  data,
  checklist,
  onActivate,
}: {
  data:       CompanyData
  checklist:  SetupChecklist | undefined
  onActivate: (section: string) => void
}) {
  const navigate = useNavigate()

  const cl = checklist  // shorthand

  const items = [
    // ── Phase 1: Company Setup ────────────────────────────────────────────────
    {
      group: 'Company Setup',
      done:  !!data.logo_url,
      label: 'Upload company logo',
      hint:  'Appears on payslips and employee-facing documents',
      href:  '/admin/settings?focus=logo',
    },
    {
      group: 'Company Setup',
      done:  !!data.timezone && data.timezone !== 'UTC',
      label: 'Set your timezone',
      hint:  'Used for attendance cutoffs and payroll scheduling',
      href:  '/admin/settings?focus=company',
    },
    {
      group: 'Company Setup',
      done:  data.employee_code.prefix !== 'EMP' && data.employee_code.prefix !== 'SK',
      label: 'Configure employee code prefix',
      hint:  `Next code will be ${data.employee_code.example}`,
      href:  '/admin/settings?focus=empcode',
    },
    // ── Phase 2: Organisation Structure ───────────────────────────────────────
    {
      group: 'Organisation',
      done:  (cl?.departments ?? 0) > 0,
      label: 'Create departments',
      hint:  'Group employees into business units and teams',
      href:  '/admin/organization',
    },
    {
      group: 'Organisation',
      done:  (cl?.designations ?? 0) > 0,
      label: 'Add designations / roles',
      hint:  'Define job titles used across the organisation',
      href:  '/admin/organization',
    },
    {
      group: 'Organisation',
      done:  (cl?.grades ?? 0) > 0,
      label: 'Set up pay grades',
      hint:  'Pay bands used for compensation and benefits mapping',
      href:  '/admin/masters/grades',
    },
    // ── Phase 3: Locations ────────────────────────────────────────────────────
    {
      group: 'Locations',
      done:  (cl?.sites ?? 0) > 0,
      label: 'Add office sites',
      hint:  'Physical office locations employees are attached to',
      href:  '/admin/masters/sites',
    },
    {
      group: 'Locations',
      done:  (cl?.work_locations ?? 0) > 0,
      label: 'Configure work locations',
      hint:  'WFH, on-site, hybrid — used for attendance & compliance',
      href:  '/admin/masters/work-locations',
    },
    // ── Phase 4: First Employee ───────────────────────────────────────────────
    {
      group: 'Workforce',
      done:  data.employee_code.last_number > 0,
      label: 'Add your first employee',
      hint:  'Start building your workforce roster',
      href:  '/admin/employees/new',
    },
    // ── Phase 5: Payroll & Leave ──────────────────────────────────────────────
    {
      group: 'Payroll & Leave',
      done:  (cl?.leave_types ?? 0) > 0,
      label: 'Configure leave types & policies',
      hint:  'Define leave entitlements for your workforce',
      href:  '/admin/leave-types',
    },
    {
      group: 'Payroll & Leave',
      done:  (cl?.salary_components ?? 0) > 0,
      label: 'Set up salary components',
      hint:  'Define CTC structure, allowances and deductions',
      href:  '/admin/payroll/salary-components',
    },
  ]

  const doneCount  = items.filter(i => i.done).length
  const totalCount = items.length
  const pct        = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // Reduce into groups for section headers
  const groups = items.reduce<{ label: string; items: typeof items }[]>((acc, item) => {
    const last = acc[acc.length - 1]
    if (last && last.label === item.group) { last.items.push(item) }
    else { acc.push({ label: item.group, items: [item] }) }
    return acc
  }, [])

  function handleClick(href: string) {
    const section = SECTION_KEYS[href]
    if (section) {
      onActivate(section)
    } else {
      navigate(href)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              Getting Started
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {doneCount} of {totalCount} steps complete
            </CardDescription>
          </div>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        {/* Progress bar */}
        <div className="mt-2.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-success transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-1">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-3 mb-0.5">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                    item.done ? 'opacity-50' : 'hover:bg-muted/50 cursor-pointer',
                  )}
                  onClick={() => !item.done && item.href && handleClick(item.href)}
                >
                  {item.done
                    ? <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
                    : <Circle       className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-medium', item.done && 'line-through text-muted-foreground')}>
                      {item.label}
                    </p>
                    {!item.done && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{item.hint}</p>
                    )}
                  </div>
                  {!item.done && (
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ── Logo upload card ───────────────────────────────────────────────────────────

function LogoCard({
  logoPath,
  tenantId,
  onSaved,
  activateTick,
}: {
  logoPath:      string | null | undefined
  tenantId:      string
  onSaved:       (path: string) => void
  activateTick?: number   // increment to open; 0/undefined = idle
}) {
  const cardRef      = useRef<HTMLDivElement>(null)
  const logoUrl      = useLogo(logoPath)
  const inputRef     = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview,   setPreview  ] = useState<string | null>(null)

  useEffect(() => {
    if (!activateTick) return
    setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      inputRef.current?.click()
    }, 100)
  }, [activateTick])

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPG, SVG)')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2 MB')
      return
    }

    // Show local preview immediately
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target?.result as string)
    reader.readAsDataURL(file)

    setUploading(true)
    try {
      const path    = await uploadCompanyLogo(tenantId, file)
      const signUrl = await getSignedUrl(path, 3600)
      // Save path to tenant via API
      await api.patch('/workspace/company', { logo_url: path })
      onSaved(path)
      setPreview(signUrl)
      toast.success('Logo updated')
    } catch (e: unknown) {
      setPreview(null)
      toast.error('Upload failed', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const displayUrl = preview ?? logoUrl

  return (
    <Card ref={cardRef} id="section-logo">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Company Logo
        </CardTitle>
        <CardDescription className="text-xs">
          Shown on payslips and employee-facing pages. PNG, JPG or SVG · max 2 MB.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-5">
          {/* Preview */}
          <div
            className={cn(
              'h-20 w-20 rounded-xl border-2 border-dashed flex items-center justify-center flex-shrink-0 overflow-hidden transition-colors',
              displayUrl ? 'border-border bg-muted/20' : 'border-muted-foreground/25 bg-muted/10',
            )}
          >
            {displayUrl
              ? <img src={displayUrl} alt="Company logo" className="h-full w-full object-contain" />
              : <Building2 className="h-8 w-8 text-muted-foreground/30" />
            }
          </div>

          {/* Drop zone */}
          <div
            className="flex-1 border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/[0.02] transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Uploading…
              </div>
            ) : (
              <>
                <Upload className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1.5" />
                <p className="text-sm font-medium text-foreground">
                  {displayUrl ? 'Replace logo' : 'Upload logo'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Drag & drop or click to browse
                </p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ── Employee Code card ─────────────────────────────────────────────────────────

function EmployeeCodeCard({ data, onSaved, activateTick }: {
  data:          CompanyData['employee_code']
  onSaved:       (prefix: string) => void
  activateTick?: number
}) {
  const cardRef               = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [prefix,  setPrefix ] = useState(data.prefix)
  const [saving,  setSaving ] = useState(false)

  useEffect(() => {
    if (!activateTick) return
    setEditing(true)
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }, [activateTick])

  const preview = `${prefix.toUpperCase() || '?'}${String(data.last_number + 1).padStart(4, '0')}`
  const isValid = /^[A-Z0-9_-]{1,10}$/.test(prefix.toUpperCase())

  async function save() {
    if (!isValid) return
    setSaving(true)
    try {
      await api.patch('/workspace/employee-code', { prefix: prefix.toUpperCase() })
      onSaved(prefix.toUpperCase())
      setEditing(false)
      toast.success('Employee code prefix updated')
    } catch (e: unknown) {
      toast.error('Failed to update prefix', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setPrefix(data.prefix)
    setEditing(false)
  }

  return (
    <Card ref={cardRef} id="section-empcode">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          Employee Code Prefix
        </CardTitle>
        <CardDescription className="text-xs">
          Auto-generated ID format for new employees. Example: <span className="font-mono font-semibold text-foreground">{data.example}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          {editing ? (
            <div className="flex items-center gap-2 flex-1">
              <div className="relative">
                <input
                  autoFocus
                  value={prefix}
                  maxLength={10}
                  onChange={e => setPrefix(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
                  className={cn(
                    'h-9 w-28 rounded-md border px-3 text-sm font-mono uppercase outline-none focus:ring-2',
                    isValid ? 'border-input focus:ring-primary/30' : 'border-destructive focus:ring-destructive/30',
                  )}
                />
              </div>
              <span className="text-muted-foreground text-sm">→</span>
              <span className={cn(
                'font-mono text-sm px-2.5 py-1 rounded-md bg-muted font-semibold',
                isValid ? 'text-foreground' : 'text-muted-foreground',
              )}>
                {preview}
              </span>
              {!isValid && (
                <span className="text-[11px] text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Letters, numbers, - or _
                </span>
              )}
              <div className="flex gap-1 ml-auto">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancel} disabled={saving}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" className="h-7 w-7" onClick={save} disabled={!isValid || saving}>
                  {saving
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />
                  }
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-1">
              <span className="font-mono text-lg font-bold text-foreground tracking-wide">
                {data.prefix}
              </span>
              <span className="text-muted-foreground text-xs">prefix</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-sm text-muted-foreground">
                Next: <span className="text-foreground font-semibold">{data.example}</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">
                {data.last_number} issued so far
              </span>
              <Button
                size="sm" variant="ghost"
                className="h-7 text-xs gap-1.5 ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" /> Edit
              </Button>
            </div>
          )}
        </div>
        {!editing && (
          <p className="text-[11px] text-muted-foreground mt-3 bg-muted/40 rounded-md px-3 py-2">
            Changing the prefix only affects <strong>new</strong> employees. Existing codes are never renamed.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Company Profile edit card ─────────────────────────────────────────────────

function CompanyProfileCard({ data, onSaved, activateTick }: {
  data:          CompanyData
  onSaved:       (d: Partial<CompanyData>) => void
  activateTick?: number
}) {
  const cardRef               = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [form,    setForm   ] = useState({
    name:       data.name       ?? '',
    industry:   data.industry   ?? '',
    size_range: data.size_range ?? '',
    country:    data.country    ?? 'IN',
    timezone:   data.timezone   ?? 'Asia/Kolkata',
  })
  const [saving, setSaving] = useState(false)

  // Open edit mode + scroll when checklist activates this card
  useEffect(() => {
    if (!activateTick) return
    setEditing(true)
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }, [activateTick])

  async function save() {
    setSaving(true)
    try {
      await api.patch('/workspace/company', form)
      onSaved(form)
      setEditing(false)
      toast.success('Company profile updated')
    } catch (e: unknown) {
      toast.error('Failed to save', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setForm({
      name:       data.name       ?? '',
      industry:   data.industry   ?? '',
      size_range: data.size_range ?? '',
      country:    data.country    ?? 'IN',
      timezone:   data.timezone   ?? 'Asia/Kolkata',
    })
    setEditing(false)
  }

  const labelCls = 'text-xs text-muted-foreground'
  const valCls   = 'font-medium mt-0.5'
  const inputCls = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30'
  const selectCls = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 appearance-none'

  return (
    <Card ref={cardRef} id="section-company">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            Company Profile
          </CardTitle>
          {!editing && (
            <Button
              size="sm" variant="ghost"
              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Company Name *</label>
                <input className={cn(inputCls, 'mt-1')} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Country</label>
                <input className={cn(inputCls, 'mt-1')} value={form.country} maxLength={5}
                  placeholder="IN" onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <label className={labelCls}>Industry</label>
                <select className={cn(selectCls, 'mt-1')} value={form.industry}
                  onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}>
                  <option value="">— select —</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Company Size</label>
                <select className={cn(selectCls, 'mt-1')} value={form.size_range}
                  onChange={e => setForm(f => ({ ...f, size_range: e.target.value }))}>
                  <option value="">— select —</option>
                  {SIZE_RANGES.map(s => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Timezone</label>
                <select className={cn(selectCls, 'mt-1')} value={form.timezone}
                  onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}>
                  {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={save} disabled={!form.name.trim() || saving} className="h-7 text-xs gap-1.5">
                {saving ? <><RefreshCw className="h-3 w-3 animate-spin" /> Saving…</> : <><Check className="h-3 w-3" /> Save changes</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel} disabled={saving} className="h-7 text-xs">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className={labelCls}>Company Name</p><p className={valCls}>{data.name ?? '—'}</p></div>
            <div><p className={labelCls}>Slug</p><p className={cn(valCls, 'font-mono text-xs')}>{data.slug ?? '—'}</p></div>
            <div><p className={labelCls}>Industry</p><p className={valCls}>{data.industry ?? '—'}</p></div>
            <div><p className={labelCls}>Company Size</p><p className={valCls}>{data.size_range ?? '—'}</p></div>
            <div><p className={labelCls}>Country</p><p className={valCls}>{data.country ?? '—'}</p></div>
            <div><p className={labelCls}>Timezone</p>
              <p className={valCls}>{TIMEZONES.find(t => t.value === data.timezone)?.label ?? data.timezone ?? '—'}</p>
            </div>
            <div><p className={labelCls}>Plan</p>
              <Badge variant="info" className="mt-0.5 text-[10px]">{data.plan?.toUpperCase() ?? 'STARTER'}</Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Settings() {
  const { tenant }  = useAuthStore()
  const qc          = useQueryClient()

  // tick-based activation: each key holds a counter; incrementing it fires
  // the card's useEffect even if clicked twice in a row (boolean can't do that)
  const [ticks, setTicks] = useState<Record<string, number>>({
    company: 0, logo: 0, empcode: 0,
  })

  const activate = useCallback((section: string) => {
    setTicks(prev => ({ ...prev, [section]: (prev[section] ?? 0) + 1 }))
  }, [])

  const { data: raw, isLoading, isError } = useQuery<{ data: CompanyData }>({
    queryKey:  ['workspace-company'],
    queryFn:   () => api.get('/workspace/company'),
    staleTime: 30_000,
  })

  const { data: checklistRaw } = useQuery<{ data: SetupChecklist }>({
    queryKey:  ['workspace-setup-checklist'],
    queryFn:   () => api.get('/workspace/setup-checklist'),
    staleTime: 30_000,
  })

  const company   = raw?.data
  const checklist = checklistRaw?.data

  function refresh() { qc.invalidateQueries({ queryKey: ['workspace-company'] }) }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        {[1,2,3,4].map(i => <div key={i} className="h-36 bg-muted rounded-xl animate-pulse" />)}
      </div>
    )
  }

  if (isError || !company) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
          <p className="text-sm font-medium">Failed to load company settings</p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={refresh}>Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Company Settings"
        subtitle="Tenant identity, preferences and configuration"
        actions={<Globe className="h-5 w-5 text-muted-foreground/40" />}
      />

      {/* Company Profile */}
      <CompanyProfileCard
        data={company}
        activateTick={ticks.company}
        onSaved={(updated) => {
          qc.setQueryData(['workspace-company'], (old: { data: CompanyData } | undefined) => ({
            ...old, data: { ...old?.data, ...updated } as CompanyData,
          }))
        }}
      />

      {/* Logo Upload */}
      <LogoCard
        logoPath={company.logo_url}
        tenantId={company.id ?? tenant?.id ?? ''}
        activateTick={ticks.logo}
        onSaved={(path) => {
          qc.setQueryData(['workspace-company'], (old: { data: CompanyData } | undefined) => ({
            ...old, data: { ...old?.data, logo_url: path } as CompanyData,
          }))
        }}
      />

      {/* Employee Code */}
      <EmployeeCodeCard
        data={company.employee_code}
        activateTick={ticks.empcode}
        onSaved={(prefix) => {
          qc.setQueryData(['workspace-company'], (old: { data: CompanyData } | undefined) => ({
            ...old, data: {
              ...old?.data,
              employee_code: { ...old?.data?.employee_code, prefix, example: `${prefix}${String((old?.data?.employee_code?.last_number ?? 0) + 1).padStart(4, '0')}` },
            } as CompanyData,
          }))
        }}
      />


      {/* Getting Started Checklist */}
      <GettingStarted data={company} checklist={checklist} onActivate={activate} />
    </div>
  )
}
