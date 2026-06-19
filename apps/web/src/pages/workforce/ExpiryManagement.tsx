/**
 * ExpiryManagement — /admin/workforce/expiry-management  (Program 3A · P3.4)
 *
 * Single operational view of workforce lifecycle risk: documents, identity,
 * passports, visas, contracts and probation confirmations — bucketed by urgency
 * (Overdue / Due 7d / Due 30d / Due 90d). All data comes from GET /workforce/expiry
 * — the one lifecycle-expiry source. No expiry logic lives in the UI; this is a
 * read-only aggregation layer (no duplicate data storage).
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, Clock, CalendarClock, CalendarDays, Loader2, AlertCircle,
  FileText, Fingerprint, Plane, StickyNote, FileSignature, UserCheck, Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Input }         from '@/components/ui/input'
import { api } from '@/lib/api/client'
import { cn }  from '@/lib/utils'

type Bucket = 'overdue' | 'due_7' | 'due_30' | 'due_90'
type Category = 'document' | 'identity' | 'passport' | 'visa' | 'contract' | 'probation'

interface RiskItem {
  id: string
  category: Category
  source_table: string
  source_id: string
  employee_id: string
  employee_name: string
  employee_code: string | null
  department_id: string | null
  department_name: string | null
  label: string
  detail: string | null
  due_date: string
  days_to_due: number
  bucket: Bucket
  severity: string
}
interface ExpiryResp {
  data: RiskItem[]
  summary: {
    total: number
    by_bucket: Record<Bucket, number>
    by_category: Record<Category, Record<Bucket, number>>
  }
  departments: { id: string; name: string }[]
}

const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

const BUCKET_META: Record<Bucket, { label: string; icon: LucideIcon; cls: string; chip: string }> = {
  overdue: { label: 'Overdue',     icon: AlertTriangle, cls: 'text-destructive',   chip: 'bg-destructive text-destructive border-destructive' },
  due_7:   { label: 'Due in 7 days',  icon: Clock,         cls: 'text-warning', chip: 'bg-warning text-warning border-warning' },
  due_30:  { label: 'Due in 30 days', icon: CalendarClock, cls: 'text-info',  chip: 'bg-info text-info border-info' },
  due_90:  { label: 'Due in 90 days', icon: CalendarDays,  cls: 'text-muted-foreground', chip: 'bg-muted text-muted-foreground border-border' },
}
const BUCKET_ORDER: Bucket[] = ['overdue', 'due_7', 'due_30', 'due_90']

const CATEGORY_META: Record<Category, { label: string; icon: LucideIcon }> = {
  document:  { label: 'Documents', icon: FileText },
  identity:  { label: 'Identity',  icon: Fingerprint },
  passport:  { label: 'Passport',  icon: StickyNote },
  visa:      { label: 'Visa',      icon: Plane },
  contract:  { label: 'Contracts', icon: FileSignature },
  probation: { label: 'Probation', icon: UserCheck },
}
const CATEGORY_ORDER: Category[] = ['document', 'identity', 'passport', 'visa', 'contract', 'probation']

export function ExpiryManagement() {
  const { data: res, isLoading, isError } = useQuery<ExpiryResp>({
    queryKey: ['workforce-expiry'],
    queryFn:  () => api.get('/workforce/expiry?within_days=90'),
    staleTime: 60_000,
  })

  const [category, setCategory] = useState<Category | 'all'>('all')
  const [deptId, setDeptId]     = useState<string>('all')
  const [search, setSearch]     = useState('')

  const all = useMemo(() => res?.data ?? [], [res?.data])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(i =>
      (category === 'all' || i.category === category) &&
      (deptId === 'all' || i.department_id === deptId) &&
      (!q || i.employee_name.toLowerCase().includes(q) || (i.employee_code ?? '').toLowerCase().includes(q) || i.label.toLowerCase().includes(q)),
    )
  }, [all, category, deptId, search])

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { overdue: 0, due_7: 0, due_30: 0, due_90: 0 }
    for (const i of filtered) c[i.bucket]++
    return c
  }, [filtered])

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="Expiry Management" subtitle="Workforce lifecycle risk" />
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Computing lifecycle risk…
        </div>
      </PageContainer>
    )
  }
  if (isError || !res) {
    return (
      <PageContainer>
        <PageHeader title="Expiry Management" subtitle="Workforce lifecycle risk" />
        <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground">
          <AlertCircle className="h-7 w-7" /><p className="text-sm">Couldn't load the expiry register.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader title="Expiry Management" subtitle="Documents · Identity · Passport · Visa · Contracts · Probation — lifecycle risk" />

      {/* Bucket summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {BUCKET_ORDER.map(b => {
          const M = BUCKET_META[b]
          return (
            <div key={b} className={cn('rounded-lg border p-3', M.chip)}>
              <div className="flex items-center gap-1.5 text-xs font-medium"><M.icon className="h-3.5 w-3.5" /> {M.label}</div>
              <p className="text-2xl font-semibold mt-1">{counts[b]}</p>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategory('all')}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium', category === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border')}
          >All</button>
          {CATEGORY_ORDER.map(cat => {
            const M = CATEGORY_META[cat]
            const n = all.filter(i => i.category === cat).length
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={cn('flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium', category === cat ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border')}
              >
                <M.icon className="h-3 w-3" /> {M.label}<span className="opacity-60">({n})</span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={deptId}
            onChange={e => setDeptId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="all">All departments</option>
            {res.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Employee or document…" className="h-8 w-52 pl-7 text-xs" />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <SectionCard title="Lifecycle risk">
          <p className="py-8 text-center text-sm text-muted-foreground">
            No lifecycle risks match the current filters. Capture expiry dates on documents, identity records, passports/visas and contracts to populate this view.
          </p>
        </SectionCard>
      ) : (
        BUCKET_ORDER.filter(b => filtered.some(i => i.bucket === b)).map(b => {
          const M = BUCKET_META[b]
          const rows = filtered.filter(i => i.bucket === b)
          return (
            <SectionCard key={b} title={`${M.label} (${rows.length})`} icon={<M.icon className={cn('h-4 w-4', M.cls)} />}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                      <th className="text-left py-2 px-3 text-xs font-medium">Item</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Employee</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Department</th>
                      <th className="text-left py-2 px-3 text-xs font-medium">Due</th>
                      <th className="text-right py-2 px-3 text-xs font-medium">{b === 'overdue' ? 'Overdue' : 'In'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(i => {
                      const CM = CATEGORY_META[i.category]
                      return (
                        <tr key={i.id} className="border-b border-border/50">
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <CM.icon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs font-medium">{i.label}</span>
                              <Badge variant="outline" className="text-[10px]">{CM.label}</Badge>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-xs">
                            {i.employee_name}{i.employee_code ? <span className="text-muted-foreground"> · {i.employee_code}</span> : null}
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">{i.department_name ?? '—'}</td>
                          <td className="py-2 px-3 text-xs">{fmtDate(i.due_date)}</td>
                          <td className={cn('py-2 px-3 text-xs text-right font-medium', M.cls)}>
                            {b === 'overdue' ? `${Math.abs(i.days_to_due)}d ago` : `${i.days_to_due}d`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )
        })
      )}
    </PageContainer>
  )
}
