/**
 * AuditTrail — /admin/audit-trail  (RPT-04)
 *
 * HR-admin view of the generic audit_logs table — the DB-change trail written
 * by logAction across instrumented routes. Filter by table, action, actor,
 * date range; expand a row to see the old/new data diff; export to CSV.
 *
 * Access: hr_admin / super_admin.
 */

import { Fragment, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  FileSearch, RefreshCw, Download, ChevronDown, ChevronRight, ShieldCheck,
} from 'lucide-react'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Badge }         from '@/components/ui/badge'
import { Button }        from '@/components/ui/button'
import { DateInput }     from '@/components/ui/date-input'
import { api }           from '@/lib/api/client'
import { useAuthStore }  from '@/stores/authStore'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditRow {
  id:                string
  table_name:        string
  record_id:         string
  action:            'INSERT' | 'UPDATE' | 'DELETE'
  performed_by:      string | null
  performed_by_name: string | null
  on_behalf_of:      string | null
  old_data:          Record<string, unknown> | null
  new_data:          Record<string, unknown> | null
  created_at:        string
}

interface AuditResponse {
  data: AuditRow[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 50

function actionBadge(a: AuditRow['action']): string {
  switch (a) {
    case 'INSERT': return 'text-success border-success/30 bg-success/10'
    case 'UPDATE': return 'text-warning border-warning/30 bg-warning/10'
    case 'DELETE': return 'text-destructive border-destructive/30 bg-destructive/10'
    default:       return ''
  }
}

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditTrail() {
  const { profile } = useAuthStore()
  const isAdmin = ['super_admin', 'hr_admin'].includes(profile?.role ?? '')

  const [tableName, setTableName] = useState('all')
  const [action, setAction]       = useState('all')
  const [from, setFrom]           = useState('')
  const [to, setTo]               = useState('')
  const [page, setPage]           = useState(0)
  const [expanded, setExpanded]   = useState<string | null>(null)

  const { data: tables = [] } = useQuery<string[]>({
    queryKey: ['audit-logs', 'tables'],
    queryFn:  () => api.get<{ data: string[] }>('/enterprise/audit/logs/tables').then(r => r.data ?? []),
    enabled:  isAdmin,
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading, isFetching, refetch } = useQuery<AuditResponse>({
    queryKey: ['audit-logs', tableName, action, from, to, page],
    queryFn:  () => {
      const p = new URLSearchParams()
      if (tableName !== 'all') p.set('table_name', tableName)
      if (action !== 'all')    p.set('action', action)
      if (from) p.set('from', new Date(from + 'T00:00:00').toISOString())
      if (to)   p.set('to', new Date(to + 'T23:59:59').toISOString())
      p.set('limit', String(PAGE_SIZE))
      p.set('offset', String(page * PAGE_SIZE))
      return api.get(`/enterprise/audit/logs?${p.toString()}`)
    },
    enabled: isAdmin,
    placeholderData: keepPreviousData,
  })

  const rows  = data?.data ?? []
  const total = data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  function exportCsv() {
    const headers = ['Timestamp', 'Table', 'Action', 'Record ID', 'Performed By', 'On Behalf Of']
    const lines = rows.map(r => [
      fmtDateTime(r.created_at), r.table_name, r.action, r.record_id,
      r.performed_by_name ?? r.performed_by ?? '', r.on_behalf_of ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  if (!isAdmin) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-2 text-muted-foreground">
          <ShieldCheck className="h-8 w-8" />
          <p className="text-sm">The audit trail is available to HR admins only.</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Audit Trail"
        subtitle="System-wide record of data changes — who changed what, and when"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Table</label>
            <select
              value={tableName}
              onChange={e => { setTableName(e.target.value); setPage(0) }}
              className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground min-w-[180px]"
            >
              <option value="all">All tables</option>
              {tables.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Action</label>
            <select
              value={action}
              onChange={e => { setAction(e.target.value); setPage(0) }}
              className="text-sm border border-border rounded-md px-3 py-2 bg-background text-foreground"
            >
              <option value="all">All</option>
              <option value="INSERT">Insert</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
            <DateInput value={from} onChange={(v: string) => { setFrom(v); setPage(0) }} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
            <DateInput value={to} onChange={(v: string) => { setTo(v); setPage(0) }} />
          </div>
          {(tableName !== 'all' || action !== 'all' || from || to) && (
            <Button variant="ghost" size="sm" onClick={() => { setTableName('all'); setAction('all'); setFrom(''); setTo(''); setPage(0) }}>
              Clear
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard title={`Audit Records${total ? ` · ${total}` : ''}`}>
        {isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <FileSearch className="h-8 w-8" />
            <p className="text-sm">No audit records match the filters.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="w-8" />
                    <th className="text-left py-2 px-3 text-xs font-medium">When</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Table</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Action</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Performed By</th>
                    <th className="text-left py-2 px-3 text-xs font-medium">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const isOpen = expanded === r.id
                    const hasDetail = r.old_data || r.new_data
                    return (
                      <Fragment key={r.id}>
                        <tr
                          className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                        >
                          <td className="px-2 text-muted-foreground">
                            {hasDetail ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                          <td className="py-2 px-3 text-xs font-mono">{r.table_name}</td>
                          <td className="py-2 px-3"><Badge variant="outline" className={cn('text-[10px]', actionBadge(r.action))}>{r.action}</Badge></td>
                          <td className="py-2 px-3 text-xs">{r.performed_by_name ?? <span className="text-muted-foreground/60">System</span>}</td>
                          <td className="py-2 px-3 text-[10px] font-mono text-muted-foreground">{r.record_id.slice(0, 8)}…</td>
                        </tr>
                        {isOpen && hasDetail && (
                          <tr className="bg-muted/10 border-b border-border/50">
                            <td />
                            <td colSpan={5} className="py-2 px-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Before</p>
                                  <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{r.old_data ? JSON.stringify(r.old_data, null, 2) : '—'}</pre>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">After</p>
                                  <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{r.new_data ? JSON.stringify(r.new_data, null, 2) : '—'}</pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
                <span className="text-xs text-muted-foreground">Page {page + 1} of {maxPage + 1}</span>
                <Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage(p => Math.min(maxPage, p + 1))}>Next</Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </PageContainer>
  )
}
