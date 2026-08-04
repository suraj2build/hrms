/**
 * EmployeeProfile — /employees/:id
 *
 * Shell that owns state shared across 2+ tabs — the full-profile query and its
 * derivations (emp/pi/job/comp/bs/addresses/emergencyContacts), job history
 * (read by the aside, the Workforce tab, and the Shift & Roster assign
 * dialog), the hero/tab-bar/aside chrome, photo upload, the profile-edit
 * state (written by the hero's "Edit Profile" button, read by the Overview
 * tab), the cross-tab attendance-recompute confirm dialog, and the
 * documents/education shared "open signed URL" helper.
 *
 * Each tab component below is always rendered (so its hooks run in the same
 * order every render, exactly as when this was one function) but internally
 * returns null unless `subTab` matches — this preserves each tab's original
 * query/mutation behavior with zero change while still splitting the JSX and
 * tab-local state into separate files. See profile-tabs/ for the 12 tabs and
 * profile-tabs/shared.tsx for common types/helpers.
 *
 * Split out of the former monolithic EmployeeProfile.tsx (5,036 lines).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useBasePath } from '@/lib/routing'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  User, UserCircle, Briefcase, Building2, LogOut,
  DollarSign, Landmark, Files, Globe,
  Users, CreditCard, Camera, Loader2,
  Edit2,
  MapPin, LayoutGrid, CalendarClock, GraduationCap,
  KeyRound, Mail,
  Phone,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { useVersionConflict, withExpectedVersion } from '@/hooks/useVersionConflict'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { SubTabs } from '@/components/ui/SubTabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { uploadEmployeeFile, getSignedUrl } from '@/lib/supabase-storage'
import { SignedImage } from '@/components/SignedImage'
import {
  type Section, type FullProfile, type AddressRow, type EmergencyContactRow, type JobHistoryRow,
} from './profile-tabs/shared'
import { STATUS_VARIANT, fmtDate } from './profile-tabs/format-helpers'
import { OverviewTab } from './profile-tabs/OverviewTab'
import { PersonalTab } from './profile-tabs/PersonalTab'
import { EducationTab } from './profile-tabs/EducationTab'
import { UserAccountTab } from './profile-tabs/UserAccountTab'
import { WorkforceTab } from './profile-tabs/WorkforceTab'
import { ShiftScheduleTab } from './profile-tabs/ShiftScheduleTab'
import { SeparationTab } from './profile-tabs/SeparationTab'
import { CompensationTab } from './profile-tabs/CompensationTab'
import { BankStatutoryTab } from './profile-tabs/BankStatutoryTab'
import { DocumentsTab } from './profile-tabs/DocumentsTab'
import { FamilyTab } from './profile-tabs/FamilyTab'
import { AccessCardTab } from './profile-tabs/AccessCardTab'

export function EmployeeProfile() {
  const { id }       = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc           = useQueryClient()
  const { profile: authProfile } = useAuthStore()
  const basePath     = useBasePath()
  const tenantId     = (authProfile as { tenant_id?: string } | null)?.tenant_id ?? ''
  const isAdmin      = ['super_admin', 'hr_admin'].includes(authProfile?.role ?? '')

  const [, setSection]  = useState<Section>('core')
  const [subTab,   setSubTab]   = useState('profile')
  const [visited,  setVisited]  = useState(new Set<Section>(['core']))
  const [cdlg, setCdlg] = useState<{ msg: string; act: () => void } | null>(null)

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
  const bsHolidayGroupId = (bs as { holiday_group_id?: string | null } | null | undefined)?.holiday_group_id ?? null
  const addresses: AddressRow[]          = (fpData as { addresses?: AddressRow[] } | undefined)?.addresses ?? []
  const emergencyContacts: EmergencyContactRow[]  = (fpData as { emergency_contacts?: EmergencyContactRow[] } | undefined)?.emergency_contacts ?? []

  const { data: jobHistoryData } = useQuery<{ data: JobHistoryRow[] }>({
    queryKey: ['job-history-all', id], queryFn: () => api.get(`/employees/${id}/job-history`),
    enabled: !!id, staleTime: 30_000,
  })

  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const path = await uploadEmployeeFile(tenantId, id!, 'photos', file)
      await api.put(`/employees/${id}/personal-info`, { profile_photo: path })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      // Employee List's avatar column and Org Chart nodes read the same
      // profile_photo under ['employees', ...] keys.
      qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Photo updated')
    },
    onError:   () => toast.error('Photo upload failed'),
  })

  const [editProfile, setEditProfile] = useState(false)
  const [profileForm, setProfileForm] = useState<Record<string, string>>({})
  const profileVersionConflict = useVersionConflict([['employee-full', id]])
  const profileMutation = useMutation({
    mutationFn: (d: Record<string, string>) => api.put(`/employees/${id}`, withExpectedVersion(d, emp)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-full', id] })
      // Name/email/phone/status edited here are also shown in Employee List
      // and Org Chart under separate ['employees', ...] keys.
      qc.invalidateQueries({ queryKey: ['employees'] })
      setEditProfile(false)
      toast.success('Saved')
    },
    onError:   (e: Error) => {
      if (profileVersionConflict(e)) return
      toast.error('Save failed')
    },
  })

  const openSignedUrl = useCallback(async (path: string | null | undefined) => {
    if (!path) return
    try { window.open(await getSignedUrl(path), '_blank') }
    catch { toast.error('Could not open file') }
  }, [])

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
        employment:   { section: 'employment',   subTab: 'workforce'    },
        compensation: { section: 'compensation', subTab: 'compensation' },
        documents:    { section: 'documents',    subTab: 'documents'    },
        separation:   { section: 'employment',   subTab: 'separation'   },
        payroll:      { section: 'compensation', subTab: 'compensation' },
        account:      { section: 'core',         subTab: 'account'      },
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

  const tenureMonths = emp.joining_date
    ? Math.floor((Date.now() - new Date(emp.joining_date + 'T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    : null
  const tenureStr = tenureMonths == null ? '—'
    : tenureMonths < 1 ? '< 1 month'
    : tenureMonths < 12 ? `${tenureMonths}m`
    : `${Math.floor(tenureMonths / 12)}y ${tenureMonths % 12}m`

  const SUB_TABS: Record<Section, Array<{ key: string; label: string; icon: React.ElementType }>> = {
    core:          [
      { key: 'profile',    label: 'Overview',       icon: User          },
      { key: 'personal',   label: 'Personal',       icon: UserCircle    },
      { key: 'education',  label: 'Education',       icon: GraduationCap },
      ...(isAdmin ? [{ key: 'account', label: 'User Account', icon: KeyRound }] : []),
    ],
    employment:    [
      { key: 'workforce',       label: 'Job & Position',   icon: LayoutGrid    },
      { key: 'shift-schedule',  label: 'Shift & Roster',   icon: CalendarClock },
      { key: 'separation',      label: 'Separation',       icon: LogOut        },
    ],
    compensation:  [
      { key: 'compensation', label: 'Compensation',  icon: DollarSign },
      { key: 'bank',         label: 'Bank & Statutory', icon: Landmark },
    ],
    documents:     [{ key: 'documents', label: 'Documents', icon: Files }],
    relationships: [{ key: 'family', label: 'Family & Nominees', icon: Users }],
    assets:        [{ key: 'access-card', label: 'Access Card', icon: CreditCard }],
  }

  // Single flat tab list (section attached for query-gating via `visited`).
  const ALL_TABS = (Object.keys(SUB_TABS) as Section[])
    .flatMap(sec => SUB_TABS[sec].map(t => ({ ...t, section: sec })))

  return (
    <div className="space-y-6">

      {/* ── Profile Hero ── */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-primary/12 via-primary/6 to-transparent" />
        <div className="relative flex flex-col md:flex-row md:items-end gap-5 px-6 pt-6 pb-0 md:px-8">
          {/* Avatar */}
          <div className="relative h-20 w-20 shrink-0">
            <div className="h-20 w-20 rounded-2xl ring-4 ring-card bg-muted border border-border flex items-center justify-center overflow-hidden shadow-md">
              <SignedImage
                path={pi?.profile_photo}
                alt={`${emp.first_name} ${emp.last_name}`}
                className="h-full w-full object-cover"
                fallback={<span className="text-2xl font-black text-primary tracking-tight select-none">{initials}</span>}
              />
            </div>
            {photoMutation.isPending && (
              <div className="absolute inset-0 rounded-2xl bg-background/70 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            )}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0 pb-5">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ring-primary/20">
                {emp.employee_code}
              </span>
              <Badge
                variant={STATUS_VARIANT[emp.status] ?? 'secondary'}
                className="rounded-full text-[10px] font-bold uppercase tracking-widest px-2.5"
              >
                {emp.status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              {emp.first_name} {emp.last_name}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {job?.designations?.name ?? '—'}
              {job?.departments?.name && <> <span className="mx-1.5 text-border">·</span> {job.departments.name}</>}
              {job?.manager && <> <span className="mx-1.5 text-border">·</span> Reports to {job.manager.first_name} {job.manager.last_name}</>}
            </p>
          </div>

          {/* Actions */}
          {isAdmin && (
            <div className="flex items-center gap-2 pb-5 shrink-0">
              <Button
                variant="outline" size="sm" className="gap-1.5 h-8"
                onClick={() => {
                  setProfileForm({ first_name: emp.first_name, last_name: emp.last_name, email: emp.email, phone: emp.phone ?? '', joining_date: emp.joining_date?.slice(0,10) ?? '', status: emp.status })
                  setEditProfile(true)
                  setSubTab('profile')
                  setSection('core')
                  setVisited(v => new Set(v).add('core'))
                }}
              >
                <Edit2 className="h-3.5 w-3.5" /> Edit Profile
              </Button>
            </div>
          )}
        </div>

        {/* Meta strip */}
        <div className="relative grid grid-cols-2 md:grid-cols-5 border-t border-border mt-0">
          {[
            { label: 'Tenure',        value: tenureStr },
            { label: 'Grade',         value: job?.grades?.name ?? '—' },
            { label: 'Type',          value: job?.employment_type ? job.employment_type.charAt(0).toUpperCase() + job.employment_type.slice(1) : '—' },
            { label: 'Date Joined',   value: fmtDate(emp.joining_date) },
            { label: 'Site',          value: emp.sites?.name ?? '—' },
          ].map((m, i) => (
            <div key={m.label} className={cn(
              'px-4 py-3 flex flex-col gap-0.5',
              i > 0 && 'md:border-l border-border',
              i === 1 && 'border-l border-border',
              i === 3 && 'md:border-l border-l border-t md:border-t-0 border-border',
              i === 4 && 'border-l border-border',
            )}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{m.label}</p>
              <p className="text-sm font-semibold text-foreground truncate">{m.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tab bar (grouped by section via dividers) ── */}
      <SubTabs
        tabs={ALL_TABS.map(t => ({ id: t.key, label: t.label, icon: t.icon, group: t.section }))}
        value={subTab}
        onChange={(key) => {
          const t = ALL_TABS.find(x => x.key === key)
          if (!t) return
          setSection(t.section)
          setVisited(v => new Set(v).add(t.section))
          setSubTab(t.key)
        }}
        className="flex-wrap"
      />

      {/* ── Two-column workspace ── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-4 min-w-0">

          <OverviewTab
            id={id}
            subTab={subTab}
            visited={visited}
            editProfile={editProfile}
            setEditProfile={setEditProfile}
            profileForm={profileForm}
            setProfileForm={setProfileForm}
            profileMutation={profileMutation}
          />

          <PersonalTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
            pi={pi}
            addresses={addresses}
            emergencyContacts={emergencyContacts}
          />

          <EducationTab
            id={id}
            isAdmin={isAdmin}
            tenantId={tenantId}
            subTab={subTab}
            visited={visited}
            openSignedUrl={openSignedUrl}
          />

          <UserAccountTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
            employeeEmail={emp.email}
          />

          <WorkforceTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
            emp={emp}
            job={job}
            jobHistoryData={jobHistoryData}
            setSubTab={setSubTab}
            setCdlg={setCdlg}
          />

          <ShiftScheduleTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
            job={job}
            jobHistoryData={jobHistoryData}
            setSubTab={setSubTab}
            setCdlg={setCdlg}
          />

          <SeparationTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
          />

          <CompensationTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
            comp={comp}
            setCdlg={setCdlg}
          />

          <BankStatutoryTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
            bs={bs}
            bsHolidayGroupId={bsHolidayGroupId}
            compensationStructureName={comp?.structure?.name}
          />

          <DocumentsTab
            id={id}
            isAdmin={isAdmin}
            tenantId={tenantId}
            subTab={subTab}
            visited={visited}
            openSignedUrl={openSignedUrl}
          />

          <FamilyTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
          />

          <AccessCardTab
            id={id}
            isAdmin={isAdmin}
            subTab={subTab}
            visited={visited}
          />

        </div>

        {/* ── Right aside ── */}
        <aside className="space-y-4 xl:sticky xl:top-4">
          {/* Contact */}
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="px-4 pt-4 pb-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">Contact</p>
              <div className="space-y-2.5">
                <a href={`mailto:${emp.email}`} className="flex items-center gap-2.5 text-[13px] text-foreground hover:text-primary transition-colors group">
                  <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                  </div>
                  <span className="truncate">{emp.email}</span>
                </a>
                {emp.phone && (
                  <div className="flex items-center gap-2.5 text-[13px] text-foreground">
                    <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <span className="font-mono tabular-nums text-sm">{emp.phone}</span>
                  </div>
                )}
              </div>
              <input
                ref={photoInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) photoMutation.mutate(f); e.target.value = '' }}
              />
              <Button
                variant="outline" size="sm"
                className="w-full mt-3 gap-2 text-xs"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoMutation.isPending}
              >
                <Camera className="h-3.5 w-3.5" />
                {photoMutation.isPending ? 'Uploading…' : 'Upload Photo'}
              </Button>
            </div>
          </div>

          {/* Organisation */}
          {(emp.sites || job?.work_locations || job?.departments || job?.cost_center) && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="px-4 pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">Organisation</p>
                <ul className="space-y-2.5">
                  {[
                    { Icon: Globe,      label: emp.sites?.name },
                    { Icon: MapPin,     label: job?.work_locations?.name },
                    { Icon: Building2,  label: job?.departments?.name },
                    { Icon: DollarSign, label: job?.cost_center ? `${job.cost_center.name ?? ''} (${job.cost_center.code ?? ''})`.trim() : null },
                  ].filter(item => item.label).map(({ Icon, label }, idx) => (
                    <li key={idx} className="flex items-center gap-2.5 text-[13px]">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-foreground truncate">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Position History */}
          {(jobHistoryData?.data?.length ?? 0) > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="px-4 pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-3">Position History</p>
                <ul className="space-y-3">
                  {(jobHistoryData!.data ?? []).slice(0, 3).map((row, i: number) => (
                    <li key={i} className="flex gap-3">
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Briefcase className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-foreground leading-tight truncate">
                          {row.designations?.name ?? row.departments?.name ?? '—'}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-muted-foreground mt-0.5">
                          {fmtDate(row.effective_from)}
                          {row.is_current && <span className="ml-1.5 text-primary font-sans font-medium">· current</span>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={!!cdlg}
        message={cdlg?.msg ?? ''}
        onConfirm={() => { cdlg?.act(); setCdlg(null) }}
        onCancel={() => setCdlg(null)}
      />
    </div>
  )
}
