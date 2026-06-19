import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ownerApi } from '@/lib/api/ownerApi'
import { toast } from 'sonner'
import { AlertTriangle, Bug, MessageSquare, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface ErrorReport {
  id: string
  tenant_id: string | null
  message: string
  url: string | null
  severity: 'error' | 'crash' | 'feedback'
  status: 'new' | 'triaged' | 'resolved' | 'dismissed'
  user_note: string | null
  owner_note: string | null
  stack?: string | null
  user_agent?: string | null
  sentry_event_id?: string | null
  created_at: string
  resolved_at: string | null
  tenants?: { name: string; slug: string } | null
}

const STATUSES = ['new', 'triaged', 'resolved', 'dismissed'] as const
const SEVERITY_ICON = { crash: AlertTriangle, error: Bug, feedback: MessageSquare }
const STATUS_STYLE: Record<string, string> = {
  new:       'bg-warning/15 text-warning',
  triaged:   'bg-info/15 text-info',
  resolved:  'bg-success/15 text-success',
  dismissed: 'bg-muted text-muted-foreground',
}

function fmtWhen(d: string) {
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '—'
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function OwnerErrorReports() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<string>('new')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery<{ data: ErrorReport[]; meta: { new_count: number } }>({
    queryKey: ['owner-error-reports', filter],
    queryFn:  () => ownerApi.get(`/owner/error-reports?status=${filter}&limit=200`),
    placeholderData: (prev) => prev,
  })
  const reports = data?.data ?? []

  const { data: detail } = useQuery<{ data: ErrorReport }>({
    queryKey: ['owner-error-report', openId],
    queryFn:  () => ownerApi.get(`/owner/error-reports/${openId}`),
    enabled:  !!openId,
  })

  const patchMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      ownerApi.patch(`/owner/error-reports/${id}`, { status }),
    onSuccess: () => {
      toast.success('Updated')
      qc.invalidateQueries({ queryKey: ['owner-error-reports'] })
      qc.invalidateQueries({ queryKey: ['owner-error-report'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  const d = detail?.data

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Error Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Problems reported by users across all tenants.</p>
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {(['all', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize transition-colors ${
              filter === s ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}{s === 'new' && data?.meta?.new_count ? ` (${data.meta.new_count})` : ''}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 w-full bg-muted animate-pulse rounded" /></td></tr>
              ))}
              {!isLoading && isError && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm">
                  <span className="text-destructive">Couldn’t load reports.</span>{' '}
                  <button onClick={() => refetch()} className="font-semibold text-foreground underline underline-offset-2">Retry</button>
                </td></tr>
              )}
              {!isLoading && !isError && reports.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No reports {filter !== 'all' ? `(${filter})` : ''}.</td></tr>
              )}
              {reports.map((r) => {
                const Icon = SEVERITY_ICON[r.severity] ?? Bug
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 capitalize text-foreground"><Icon className="h-4 w-4 text-muted-foreground" />{r.severity}</span></td>
                    <td className="px-4 py-3 max-w-md truncate text-foreground" title={r.message}>{r.message}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.tenants?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                    <td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => setOpenId(r.id)}>View</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Error report</DialogTitle></DialogHeader>
          {d && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-semibold text-foreground">{d.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {d.tenants?.name ?? 'Unknown tenant'} · {fmtWhen(d.created_at)} · {d.severity}
                </p>
              </div>
              {d.user_note && (
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">User note</p>
                  <p className="text-foreground">{d.user_note}</p>
                </div>
              )}
              {d.url && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" />{d.url}</p>
              )}
              {d.stack && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Stack</p>
                  <pre className="max-h-60 overflow-auto rounded-lg bg-muted p-3 text-xs text-foreground/80 whitespace-pre-wrap">{d.stack}</pre>
                </div>
              )}
              {d.sentry_event_id && <p className="text-xs text-muted-foreground">Sentry event: <code>{d.sentry_event_id}</code></p>}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {STATUSES.filter((st) => st !== d?.status).map((st) => (
              <Button key={st} variant="outline" size="sm" className="capitalize"
                disabled={patchMut.isPending}
                onClick={() => openId && patchMut.mutate({ id: openId, status: st })}>
                Mark {st}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
