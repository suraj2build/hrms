/**
 * EssPolicies — /ess/policies
 *
 * Employee view of published company policies.
 * Shows all published policies with acknowledgement status and
 * opens a read/ack dialog when the employee clicks a policy.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield, Clock, Users, CreditCard, FileText, ExternalLink,
  GraduationCap, Heart, Monitor, BookOpen, Loader2, CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { toast }           from 'sonner'
import { useSearchParams } from 'react-router-dom'

import { PageContainer } from '@/components/layout/PageContainer'
import { PageHeader }    from '@/components/layout/PageHeader'
import { SectionCard }   from '@/components/layout/SectionCard'
import { Button }        from '@/components/ui/button'
import { Badge }         from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api }           from '@/lib/api/client'
import { cn }            from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type AckStatus  = 'not_required' | 'pending' | 'acknowledged'
type PolicyCategory = 'leave' | 'compensation' | 'conduct' | 'recruitment' | 'learning' | 'health' | 'it' | 'other'

interface Policy {
  id:                       string
  title:                    string
  category:                 PolicyCategory
  description:              string | null
  content:                  string | null
  file_url:                 string | null
  version:                  number
  requires_acknowledgement: boolean
  effective_from:           string | null
  published_at:             string | null
  ack_status:               AckStatus
}

// ── Category config ───────────────────────────────────────────────────────────

const CATEGORY_META: Record<PolicyCategory, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  leave:        { icon: Clock,         label: 'Leave & Attendance' },
  compensation: { icon: CreditCard,    label: 'Compensation & Benefits' },
  conduct:      { icon: Shield,        label: 'Code of Conduct' },
  recruitment:  { icon: Users,         label: 'Recruitment & Onboarding' },
  learning:     { icon: GraduationCap, label: 'Learning & Development' },
  health:       { icon: Heart,         label: 'Health & Wellness' },
  it:           { icon: Monitor,       label: 'IT & Security' },
  other:        { icon: FileText,      label: 'Other' },
}

function ackBadge(status: AckStatus) {
  switch (status) {
    case 'acknowledged': return { variant: 'success' as const, label: 'Acknowledged', icon: CheckCircle2 }
    case 'pending':      return { variant: 'outline'  as const, label: 'Ack Required',  icon: AlertCircle }
    default:             return null
  }
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EssPolicies() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  // ?policy=<id> deep-link — opens the policy dialog directly
  const [openId, setOpenId] = useState<string | null>(searchParams.get('policy'))
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const { data: policies = [], isLoading } = useQuery<Policy[]>({
    queryKey: ['ess-policies', categoryFilter],
    queryFn:  () => {
      const qs = categoryFilter !== 'all' ? `?category=${categoryFilter}` : ''
      return api.get<{ data: Policy[] }>(`/policies${qs}`).then(r => r.data ?? [])
    },
  })

  const { data: detail } = useQuery<Policy | null>({
    queryKey: ['ess-policies', 'detail', openId],
    queryFn:  () => api.get<{ data: Policy | null }>(`/policies/${openId}`).then(r => r.data ?? null),
    enabled:  !!openId,
  })

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/policies/${id}/ack`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ess-policies'] })
      toast.success('Policy acknowledged — thank you!')
    },
    onError: (e: Error) => toast.error('Failed to acknowledge', { description: e.message }),
  })

  const openPolicy = (id: string) => {
    setOpenId(id)
    setSearchParams({ policy: id })
  }

  const closePolicy = () => {
    setOpenId(null)
    setSearchParams({})
  }

  // Group by category for display
  const categoriesPresent = Array.from(new Set(policies.map(p => p.category)))
  const pendingCount = policies.filter(p => p.ack_status === 'pending').length

  // Category options for filter chips
  const categoryOptions = categoriesPresent.map(c => ({ value: c, label: CATEGORY_META[c]?.label ?? c }))

  return (
    <PageContainer>
      <PageHeader
        title="Company Policies"
        subtitle={pendingCount > 0
          ? `${pendingCount} polic${pendingCount !== 1 ? 'ies' : 'y'} awaiting your acknowledgement`
          : 'HR policies, codes of conduct, and employee guidelines'}
      />

      {/* Pending ack banner */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 mb-4">
          <AlertCircle className="h-4 w-4 text-warning shrink-0" />
          <p className="text-sm text-warning font-medium">
            {pendingCount} polic{pendingCount !== 1 ? 'ies require' : 'y requires'} your acknowledgement. Please read and confirm below.
          </p>
        </div>
      )}

      {/* Category filter chips */}
      {categoryOptions.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'text-xs px-3 py-1 rounded-full border transition-colors',
              categoryFilter === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            All
          </button>
          {categoryOptions.map(c => (
            <button
              key={c.value}
              onClick={() => setCategoryFilter(c.value)}
              className={cn(
                'text-xs px-3 py-1 rounded-full border transition-colors',
                categoryFilter === c.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/50',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <SectionCard title={`Policies${policies.length > 0 ? ` (${policies.length})` : ''}`}>
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : policies.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <BookOpen className="h-8 w-8" />
            <p className="text-sm">No policies published yet.</p>
            <p className="text-xs">Check back later or raise an HR ticket for queries.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {policies.map(p => {
              const CatIcon = CATEGORY_META[p.category]?.icon ?? FileText
              const ab = ackBadge(p.ack_status)
              const AckIcon = ab?.icon
              return (
                <button
                  key={p.id}
                  onClick={() => openPolicy(p.id)}
                  className={cn(
                    'w-full text-left rounded-lg border p-3.5 hover:bg-muted/30 transition-colors',
                    p.ack_status === 'pending' ? 'border-warning/30 bg-warning/5' : 'border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <CatIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{p.title}</p>
                        {p.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ab && AckIcon && (
                        <Badge variant={ab.variant} className={cn(
                          'text-[10px] flex items-center gap-1',
                          ab.variant === 'outline' && 'border-warning/40 text-warning bg-warning/10',
                        )}>
                          <AckIcon className="h-2.5 w-2.5" />{ab.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground pl-6">
                    <span>{CATEGORY_META[p.category]?.label ?? p.category}</span>
                    {p.effective_from && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Effective {fmtDate(p.effective_from)}</span>}
                    <span>v{p.version}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ── Policy detail dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!openId} onOpenChange={o => { if (!o) closePolicy() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6">{detail.title}</DialogTitle>
              </DialogHeader>

              {/* Meta */}
              <div className="flex items-center gap-2 flex-wrap -mt-1">
                <Badge variant="outline" className="text-[10px]">{CATEGORY_META[detail.category]?.label}</Badge>
                <span className="text-[10px] text-muted-foreground">v{detail.version}</span>
                {detail.effective_from && <span className="text-[10px] text-muted-foreground">Effective {fmtDate(detail.effective_from)}</span>}
                {detail.published_at && <span className="text-[10px] text-muted-foreground">Published {fmtDate(detail.published_at)}</span>}

                {detail.ack_status === 'acknowledged' && (
                  <Badge variant="success" className="text-[10px] gap-1 ml-auto">
                    <CheckCircle2 className="h-2.5 w-2.5" />Acknowledged
                  </Badge>
                )}
                {detail.ack_status === 'pending' && (
                  <Badge variant="outline" className="text-[10px] gap-1 border-warning/40 text-warning bg-warning/10 ml-auto">
                    <AlertCircle className="h-2.5 w-2.5" />Acknowledgement Required
                  </Badge>
                )}
              </div>

              {/* Description */}
              {detail.description && (
                <p className="text-sm text-muted-foreground border border-border rounded-md p-3 bg-muted/20">{detail.description}</p>
              )}

              {/* Content — scrollable */}
              <div className="flex-1 overflow-y-auto rounded-md border border-border p-4 bg-muted/10 min-h-0">
                {detail.content ? (
                  <pre className="text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">{detail.content}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground italic text-center py-6">No content added. See the linked document below.</p>
                )}
              </div>

              {/* External document link */}
              {detail.file_url && (
                <a
                  href={detail.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open full document
                </a>
              )}

              {/* Ack action */}
              {detail.ack_status === 'pending' && (
                <div className="rounded-md border border-warning/30 bg-warning/5 p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Acknowledge this policy</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      By clicking below you confirm that you have read and understood this policy.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledge.mutate(detail.id)}
                  >
                    {acknowledge.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                    I Acknowledge
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
