/**
 * MastersConfig — /admin/masters
 *
 * Unified admin page for managing all HR master data tables:
 *  • Work Locations        (/masters/work-locations)
 *  • Cost Centers          (/masters/cost-centers)
 *  • Identity Types        (/masters/identity-types)
 *  • Relationship Types    (/masters/relationship-types)
 *  • Document Types        (/masters/document-types)
 *  • Salary Components     (/masters/salary-components)
 *  • Salary Structures     (/masters/salary-structures)
 *
 * Access: super_admin, hr_admin only.
 * Design rules: design system tokens only — no raw hex / bg-gray-*.
 */

import { toast }                                  from 'sonner'
import { useState, useEffect, Fragment }         from 'react'
import { useSearchParams, useNavigate }          from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  MapPin, Banknote, FileText, Users, ShieldAlert,
  Plus, Pencil, Trash2, Loader2, Check, X, ToggleLeft,
  Building2, DollarSign, CreditCard, CalendarDays,
} from 'lucide-react'

import { PageContainer }        from '@/components/layout/PageContainer'
import { PageHeader }           from '@/components/layout/PageHeader'
import { SectionCard }          from '@/components/layout/SectionCard'
import { OrgGovernancePanel }   from '@/components/org/OrgGovernancePanel'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { Input }         from '@/components/ui/input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Generic master record ──────────────────────────────────────────────────────

interface MasterRecord {
  id:        string
  name:      string
  code?:     string
  [key: string]: unknown
}

// ── Tab definitions ────────────────────────────────────────────────────────────

type TabId =
  | 'work-locations'
  | 'cost-centers'
  | 'identity-types'
  | 'relationship-types'
  | 'important-date-types'
  | 'document-types'
  | 'salary-components'
  | 'salary-structures'

interface TabDef {
  id:         TabId
  label:      string
  icon:       React.ComponentType<{ className?: string }>
  endpoint:   string
  fields:     FieldDef[]
  /** Extra columns shown in the table beyond name/code/status */
  extraCols?: ExtraCol[]
}

interface FieldDef {
  key:         string
  label:       string
  type:        'text' | 'select' | 'boolean' | 'number'
  required?:   boolean
  options?:    { value: string; label: string }[]
  placeholder?: string
}

interface ExtraCol {
  key:    string
  label:  string
  render: (row: MasterRecord) => React.ReactNode
}

const COMP_TYPE_BADGE: Record<string, 'success' | 'destructive' | 'secondary'> = {
  earning:               'success',
  deduction:             'destructive',
  employer_contribution: 'secondary',
}

const TABS: TabDef[] = [
  {
    id:       'work-locations',
    label:    'Work Locations',
    icon:     MapPin,
    endpoint: '/masters/work-locations',
    fields: [
      { key: 'name',    label: 'Name',    type: 'text', required: true },
      { key: 'code',    label: 'Code',    type: 'text', placeholder: 'e.g. HO' },
      { key: 'city',    label: 'City',    type: 'text' },
      { key: 'state',   label: 'State',   type: 'text' },
      { key: 'country', label: 'Country', type: 'text', placeholder: 'India' },
      { key: 'pincode', label: 'Pincode', type: 'text' },
    ],
    extraCols: [
      { key: 'city',  label: 'City',  render: (r) => r.city  as string || '—' },
      { key: 'state', label: 'State', render: (r) => r.state as string || '—' },
    ],
  },
  {
    id:       'cost-centers',
    label:    'Cost Centers',
    icon:     Building2,
    endpoint: '/masters/cost-centers',
    fields: [
      { key: 'name',        label: 'Name',        type: 'text', required: true },
      { key: 'code',        label: 'Code',        type: 'text' },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Optional' },
    ],
  },
  {
    id:       'identity-types',
    label:    'Identity Types',
    icon:     CreditCard,
    endpoint: '/masters/identity-types',
    fields: [
      { key: 'name',        label: 'Name',        type: 'text', required: true },
      { key: 'code',        label: 'Code',        type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  {
    id:       'relationship-types',
    label:    'Relationship Types',
    icon:     Users,
    endpoint: '/masters/relationship-types',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
    ],
  },
  {
    id:       'important-date-types',
    label:    'Important Date Types',
    icon:     CalendarDays,
    endpoint: '/masters/important-date-types',
    fields: [
      { key: 'name',        label: 'Name',        type: 'text', required: true },
      { key: 'code',        label: 'Code',        type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  {
    id:       'document-types',
    label:    'Document Types',
    icon:     FileText,
    endpoint: '/masters/document-types',
    fields: [
      { key: 'name',         label: 'Name',         type: 'text', required: true },
      { key: 'code',         label: 'Code',         type: 'text', required: true },
      { key: 'description',  label: 'Description',  type: 'text' },
      { key: 'is_mandatory', label: 'Mandatory',    type: 'boolean' },
    ],
    extraCols: [
      {
        key: 'is_mandatory', label: 'Mandatory',
        render: (r) => r.is_mandatory
          ? <Badge variant="warning" className="rounded-full text-[10px]">Required</Badge>
          : <span className="text-xs text-muted-foreground">Optional</span>,
      },
    ],
  },
  {
    id:       'salary-components',
    label:    'Salary Components',
    icon:     DollarSign,
    endpoint: '/masters/salary-components',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true },
      {
        key: 'component_type', label: 'Type', type: 'select', required: true,
        options: [
          { value: 'earning',               label: 'Earning' },
          { value: 'deduction',             label: 'Deduction' },
          { value: 'employer_contribution', label: 'Employer Contribution' },
        ],
      },
      { key: 'is_taxable',        label: 'Taxable',        type: 'boolean' },
      { key: 'is_pf_applicable',  label: 'PF Applicable',  type: 'boolean' },
      { key: 'is_esi_applicable', label: 'ESI Applicable', type: 'boolean' },
      { key: 'is_variable',       label: 'Variable',       type: 'boolean' },
      { key: 'display_order',     label: 'Display Order',  type: 'number' },
    ],
    extraCols: [
      {
        key: 'component_type', label: 'Type',
        render: (r) => {
          const t = r.component_type as string
          const variant = COMP_TYPE_BADGE[t] ?? 'secondary'
          const label = t === 'employer_contribution' ? 'Employer' : t
          return <Badge variant={variant} className="rounded-full text-[10px] capitalize">{label}</Badge>
        },
      },
    ],
  },
  {
    id:       'salary-structures',
    label:    'Salary Structures',
    icon:     Banknote,
    endpoint: '/masters/salary-structures',
    fields: [
      { key: 'name',        label: 'Name',        type: 'text', required: true },
      { key: 'code',        label: 'Code',        type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyForm(fields: FieldDef[]): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.type === 'boolean') form[f.key] = false
    else if (f.type === 'number') form[f.key] = 0
    else form[f.key] = ''
  }
  return form
}

// ── Inline form ───────────────────────────────────────────────────────────────

interface InlineFormProps {
  fields:    FieldDef[]
  initial?:  Record<string, unknown>
  onSubmit:  (data: Record<string, unknown>) => void
  onCancel:  () => void
  isPending: boolean
  submitLabel?: string
}

function InlineForm({ fields, initial, onSubmit, onCancel, isPending, submitLabel = 'Save' }: InlineFormProps) {
  const [form, setForm] = useState<Record<string, unknown>>(
    initial ? { ...initial } : emptyForm(fields),
  )

  function set(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Coerce numbers
    const out = { ...form }
    for (const f of fields) {
      if (f.type === 'number' && typeof out[f.key] === 'string') {
        out[f.key] = parseInt(out[f.key] as string, 10) || 0
      }
    }
    onSubmit(out)
  }

  return (
    <form onSubmit={handleSubmit} className="p-3 rounded-md border border-border bg-muted/20 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
            </label>

            {f.type === 'text' && (
              <Input
                className="h-7 text-xs"
                placeholder={f.placeholder ?? f.label}
                value={form[f.key] as string ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.required}
              />
            )}

            {f.type === 'number' && (
              <Input
                type="number"
                className="h-7 text-xs"
                value={form[f.key] as number ?? 0}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}

            {f.type === 'select' && (
              <select
                className="flex h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 ring-primary/50"
                value={form[f.key] as string ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.required}
              >
                <option value="">Select…</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}

            {f.type === 'boolean' && (
              <div className="flex items-center h-7 gap-2">
                <input
                  type="checkbox"
                  id={`form-${f.key}`}
                  checked={form[f.key] as boolean ?? false}
                  onChange={(e) => set(f.key, e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <label htmlFor={`form-${f.key}`} className="text-xs text-foreground select-none cursor-pointer">
                  {f.label}
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="sm" className="h-7 text-xs gap-1" disabled={isPending}>
          {isPending
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Check className="h-3 w-3" />}
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          <X className="h-3 w-3 mr-1" />
          Cancel
        </Button>
      </div>
    </form>
  )
}

// ── Master tab content ────────────────────────────────────────────────────────

function MasterTab({ tab }: { tab: TabDef }) {
  const qc = useQueryClient()
  const [showAdd,  setShowAdd]  = useState(false)
  const [editId,   setEditId]   = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Query ────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery<{ data: MasterRecord[] }>({
    queryKey: ['masters', tab.id],
    queryFn:  () => api.get<{ data: MasterRecord[] }>(tab.endpoint),
    staleTime: 60_000,
  })
  const rows = data?.data ?? []

  // ── Create mutation ──────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(tab.endpoint, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['masters', tab.id] }); setShowAdd(false); toast.success('Created') },
    onError: (e: Error) => toast.error('Failed to create record', { description: e.message }),
  })

  // ── Update mutation ──────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`${tab.endpoint}/${id}`, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['masters', tab.id] }); setEditId(null); toast.success('Updated') },
    onError: (e: Error) => toast.error('Failed to update record', { description: e.message }),
  })

  // ── Delete mutation ──────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`${tab.endpoint}/${id}`),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['masters', tab.id] }); setDeletingId(null); toast.success('Deleted') },
    onError:    (e: Error) => { setDeletingId(null); toast.error('Failed to delete record', { description: e.message }) },
  })

  // ── Toggle active ────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.put(`${tab.endpoint}/${id}`, { is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['masters', tab.id] }); toast.success('Status updated') },
    onError: (e: Error) => toast.error('Failed to update status', { description: e.message }),
  })

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm">Loading…</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <p className="text-sm text-destructive">Failed to load data</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Add form */}
      {showAdd && (
        <InlineForm
          fields={tab.fields}
          onSubmit={(body) => createMutation.mutate(body)}
          onCancel={() => setShowAdd(false)}
          isPending={createMutation.isPending}
          submitLabel="Add"
        />
      )}

      {/* Table */}
      {rows.length === 0 && !showAdd && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <tab.icon className="h-7 w-7 opacity-30" />
          <p className="text-sm font-medium text-foreground">No records yet</p>
          <p className="text-xs">Click "+ Add" to create the first entry.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Name</th>
                {tab.fields.some((f) => f.key === 'code') && (
                  <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Code</th>
                )}
                {(tab.extraCols ?? []).map((col) => (
                  <th key={col.key} className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">
                    {col.label}
                  </th>
                ))}
                <th className="text-left text-xs font-semibold text-muted-foreground py-2 px-3">Status</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      'border-b border-border/50 hover:bg-muted/20 transition-colors',
                      !row.is_active && 'opacity-50',
                    )}
                  >
                    <td className="py-2 px-3 font-medium text-foreground">{row.name}</td>
                    {tab.fields.some((f) => f.key === 'code') && (
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs">
                        {row.code as string || '—'}
                      </td>
                    )}
                    {(tab.extraCols ?? []).map((col) => (
                      <td key={col.key} className="py-2 px-3">
                        {col.render(row)}
                      </td>
                    ))}
                    <td className="py-2 px-3">
                      <Badge
                        variant={row.is_active ? 'success' : 'secondary'}
                        className="rounded-full text-[10px]"
                      >
                        {row.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Toggle active */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title={row.is_active ? 'Deactivate' : 'Activate'}
                          onClick={() =>
                            toggleMutation.mutate({ id: row.id, is_active: !row.is_active })
                          }
                          disabled={toggleMutation.isPending}
                        >
                          <ToggleLeft className="h-3.5 w-3.5" />
                        </Button>

                        {/* Edit */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Edit"
                          onClick={() => setEditId(editId === row.id ? null : row.id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        {/* Delete */}
                        {deletingId === row.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                              onClick={() => deleteMutation.mutate(row.id)}
                              disabled={deleteMutation.isPending}
                            >
                              {deleteMutation.isPending
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : 'Delete?'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-[10px]"
                              onClick={() => setDeletingId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                            title="Delete"
                            onClick={() => setDeletingId(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Inline edit form */}
                  {editId === row.id && (
                    <tr className="border-b border-border/50 bg-muted/10">
                      <td colSpan={3 + (tab.extraCols?.length ?? 0)} className="px-3 pb-3 pt-1">
                        <InlineForm
                          fields={tab.fields}
                          initial={row as Record<string, unknown>}
                          onSubmit={(body) =>
                            updateMutation.mutate({ id: row.id, body })
                          }
                          onCancel={() => setEditId(null)}
                          isPending={updateMutation.isPending}
                          submitLabel="Update"
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground px-1 mt-2">
            {rows.length} record{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Floating add button at bottom */}
      {!showAdd && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add {tab.label.replace(/s$/, '')}
        </Button>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MastersConfig() {
  const { profile } = useAuthStore()
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'hr_admin'

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') ?? 'work-locations') as TabId
  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  // Bare /admin/masters → canonical first-tab URL so the sidebar highlights correctly
  useEffect(() => {
    if (!searchParams.get('tab')) {
      navigate('/admin/masters?tab=work-locations', { replace: true })
    }
  }, [searchParams, navigate])

  const isOrgTab = ['work-locations', 'cost-centers'].includes(currentTab.id)

  return (
    <PageContainer>
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          title={currentTab.label}
          subtitle="Master data configuration — managed from the Setup sidebar"
        />
        {isOrgTab && (
          <OrgGovernancePanel className="shrink-0 w-52 mt-1" />
        )}
      </div>

      {/* Access guard */}
      {!isAdmin && (
        <SectionCard>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <ShieldAlert className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">Access restricted</p>
            <p className="text-xs">Only HR admins can manage master data.</p>
          </div>
        </SectionCard>
      )}

      {isAdmin && (
        <SectionCard
          title={currentTab.label}
          icon={<currentTab.icon className="h-4 w-4 text-muted-foreground" />}
        >
          <MasterTab key={currentTab.id} tab={currentTab} />
        </SectionCard>
      )}
    </PageContainer>
  )
}
